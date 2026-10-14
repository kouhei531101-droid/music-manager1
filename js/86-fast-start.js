/* =========================================================
   86-fast-start.js ― 起動を速く・Pin の曲を先に（スマホ版 v8.20.0）
   ・計測（8,000曲の控えがある2回目の起動。ヘッドレスの Edge）で、音楽フォルダを選んだあとの時間の内訳は
     メニューの件数（renderSidebarCounts：1回 35〜90ms を4回）・画面の描き直し（renderAll 2回）・曲情報の控えの読み込み（IndexedDB 36〜158ms）が大きかった。
     それぞれ次のようにした（このファイルだけで包む。今までの処理・保存データの形は変えない）
   ① 曲情報の控え（IndexedDB）を、起動してすぐ裏で読み始める（スマホは毎回フォルダを選び直すので、選んでいる間に読み終わる）
   ② メニューの件数は、続けて呼ばれたらまとめて1回だけ（少しあとに）数える。画面の描き直しを先にする
   ③ 曲情報を裏で読むとき（増えた曲・初めての読み込み）は、Pin の曲（曲の Pin・Pin したアルバムとアーティストの曲）・予約・前回の続きの曲を先に読む
   ④ 「前回の続き」：最後に再生していた曲・位置・再生の並び（最大 1,000曲）を ui.lastSession に覚えておき、
     次に開いて曲の一覧ができたらすぐ、その曲を一時停止の状態で用意する（▶ で続きから再生。再生中ボタン・再生画面・予約もすぐ使える）
     ui は localStorage（見た目の設定。バックアップには入れない）
   ・スマホ（読み取り専用モード）はブラウザの決まりで、開くたびに音楽フォルダを選び直す必要がある（前回のファイルにはアクセスできない）。
     そのため「選び直す前」には再生できないが、選んだ直後に控えから一覧（Pin の区切り・前回の続き）をすぐ作り、全体の確認は裏で続ける
   ========================================================= */

var fastStart = { resumed: false, countsTimer: 0, countsAt: 0 };

/* ---------- ① 控えを先に読む ---------- */
try { if (typeof libIndexEnsureLoaded === 'function') libIndexEnsureLoaded().catch(function () { /* 選んだあとに読み直す */ }); } catch (e) { /* 無視 */ }

/* ---------- ② メニューの件数をまとめる ---------- */
(function () {
  var f = window.renderSidebarCounts;
  if (typeof f !== 'function') return;
  var run = function () { fastStart.countsTimer = 0; fastStart.countsAt = Date.now(); try { f(); } catch (e) { console.warn(e); } };
  window.renderSidebarCounts = function () {
    // 曲が無い（起動直後・未接続）ときと、しばらく呼ばれていないときはすぐ。続けて呼ばれたら少し待ってまとめて1回
    if (!library.tracks.length || (!fastStart.countsTimer && Date.now() - fastStart.countsAt > 1500)) { if (fastStart.countsTimer) { clearTimeout(fastStart.countsTimer); fastStart.countsTimer = 0; } run(); return; }
    if (fastStart.countsTimer) clearTimeout(fastStart.countsTimer);
    fastStart.countsTimer = setTimeout(run, 250);
  };
})();

/* ---------- ③ Pin の曲を先に読む ---------- */
// 先に読む曲のパス（曲の Pin・予約・前回の続き・Pin したアルバムとアーティストの曲）
function fastStartPriorityPaths() {
  var set = new Set();
  (db.pinnedSongs || []).forEach(function (p) { set.add(p); });
  (db.upNext || []).forEach(function (x) { set.add(x && typeof x === 'object' ? x.path : x); });
  if (ui.lastSession && ui.lastSession.path) set.add(ui.lastSession.path);
  var pa = new Set((db.pinnedAlbums || []).map(function (p) { return p.key; }));
  var pr = new Set((db.pinnedArtists || []).map(function (p) { return p.key; }));
  if (pa.size || pr.size) {
    library.tracks.forEach(function (t) {
      try {
        if (pa.size && pa.has(albumKeyOf(t))) set.add(t.path);
        else if (pr.size && typeof artistNameOf === 'function' && pr.has(artistNameOf(t))) set.add(t.path);
      } catch (e) { /* 無視 */ }
    });
  }
  return set;
}
(function () {
  var f = window.readMetadataInBackground;
  if (typeof f !== 'function') return;
  window.readMetadataInBackground = function (token, list, full) {
    try {
      if (list && list.length > 1) {
        var pri = fastStartPriorityPaths();
        if (pri.size) {
          var a = [], b = [];
          list.forEach(function (t) { (pri.has(t.path) ? a : b).push(t); });
          if (a.length) list = a.concat(b);
        }
      }
    } catch (e) { console.warn(e); }
    return f.call(this, token, list, full);
  };
})();

/* ---------- ④ 前回の続き ---------- */
var RESUME_QUEUE_MAX = 1000;
function _resumeSave() {
  try {
    var a = player.audio;
    if (!a || !player.currentPath) return;
    var q = player.baseQueue && player.baseQueue.length ? player.baseQueue : player.queue;
    var i = q.indexOf(player.currentPath);
    var from = 0, qq = q;
    if (q.length > RESUME_QUEUE_MAX) { from = Math.max(0, Math.min(q.length - RESUME_QUEUE_MAX, i - Math.floor(RESUME_QUEUE_MAX / 2))); qq = q.slice(from, from + RESUME_QUEUE_MAX); }
    ui.lastSession = { path: player.currentPath, time: Math.floor(a.currentTime || 0), label: player.label || '', queue: qq, index: i >= 0 ? i - from : -1,
                  playlistId: player.playlistId || null, at: Date.now() };
    saveUi();
  } catch (e) { /* 見た目の設定なので失敗しても続ける */ }
}
var _resumeLast = 0;
function _resumeTick() { if (Date.now() - _resumeLast > 5000) { _resumeLast = Date.now(); _resumeSave(); } }
// 一覧ができたら、前回の曲を一時停止の状態で用意する（1回だけ。何か再生したあとはしない）
async function fastStartResume() {
  if (fastStart.resumed) return;
  var r = ui.lastSession;
  if (!r || !r.path || player.currentPath || !library.byPath[r.path]) return;
  fastStart.resumed = true;
  var t = library.byPath[r.path];
  var q = Array.isArray(r.queue) ? r.queue.filter(function (p) { return typeof p === 'string'; }) : [];
  if (q.indexOf(r.path) < 0) q = [r.path];
  player.baseQueue = q.slice();
  player.queue = q.slice();
  player.index = q.indexOf(r.path);
  player.label = r.label || '';
  player.playlistId = r.playlistId || null;
  player.currentPath = r.path;
  try {
    var file = await t.handle.getFile();
    if (player.currentPath !== r.path || player.audio.getAttribute('src')) return;   // 待っている間にほかの曲を再生した
    if (player.url) URL.revokeObjectURL(player.url);
    player.url = URL.createObjectURL(file);
    player.audio.src = player.url;
    player.listen = { path: r.path, acc: 0, lastT: null, counted: false };
    var time = +r.time || 0;
    if (time > 0) player.audio.addEventListener('loadedmetadata', function () { try { if (player.currentPath === r.path && player.audio.paused) player.audio.currentTime = Math.min(time, Math.max(0, (player.audio.duration || time) - 1)); } catch (e) { /* 無視 */ } }, { once: true });
  } catch (e) {
    console.warn('前回の続きの曲を用意できませんでした', r.path, e);
  }
  if (typeof updatePlayerUi === 'function') updatePlayerUi();
  if (typeof updatePlayingHighlight === 'function') updatePlayingHighlight();
}
(function () {
  // 一覧を作ったとき（控えから先に作ったときも）に前回の続きを用意する
  var st = window._setTracks;
  if (typeof st === 'function') {
    window._setTracks = function () {
      var r = st.apply(this, arguments);
      if (!fastStart.resumed && ui.lastSession && ui.lastSession.path) setTimeout(function () { fastStartResume().catch(function (e) { console.warn(e); }); }, 0);
      return r;
    };
  }
  var hook = function () {
    var a = player.audio;
    if (!a || a._fsHooked) return;
    a._fsHooked = true;
    a.addEventListener('timeupdate', _resumeTick);
    a.addEventListener('pause', _resumeSave);
    a.addEventListener('play', function () { fastStart.resumed = true; _resumeSave(); });
    a.addEventListener('ended', _resumeSave);
  };
  var ip = window.initPlayer;
  if (typeof ip === 'function') window.initPlayer = function () { var r = ip.apply(this, arguments); try { hook(); } catch (e) { console.warn(e); } return r; };
  hook();
  window.addEventListener('pagehide', _resumeSave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') _resumeSave(); });
})();

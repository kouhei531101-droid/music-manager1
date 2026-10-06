/* =========================================================
   06-player.js ― 「再生バー」（画面下に常に表示）
   ・再生 / 一時停止、前の曲 / 次の曲、シークバー、音量、消音、リピート
   ・再生する曲の並び（再生キュー）は、曲一覧の表示順やプレイリストの順
   ・曲ファイルは読むだけ（ブラウザの中で再生する。ファイルは書き換えない）
   ========================================================= */

var player = {
  audio: null,
  queue: [],          // 再生する曲の相対パスの並び（シャッフル中は混ぜた順）
  baseQueue: [],      // 元の順（シャッフルをオフにしたら戻す）
  index: -1,          // 今の曲の位置
  label: '',          // 再生元（「曲一覧」「プレイリスト：○○」など）
  url: null,          // 今の曲の一時URL（blob:）
  currentPath: null,
  seeking: false,
  loadToken: 0,
  errorSkips: 0
};

function initPlayer() {
  var a = document.getElementById('audio-player');
  player.audio = a;
  var vol = Number(db.settings.volume);
  a.volume = isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.8;
  document.getElementById('pb-volume').value = Math.round(a.volume * 100);

  a.addEventListener('timeupdate', updateSeekUi);
  a.addEventListener('timeupdate', _trackListen);   // 再生回数（v2.2）
  a.addEventListener('loadedmetadata', function () {
    updateSeekUi();
    // 長さが分からなかった曲は、ここで分かった長さを表示に使う
    var t = library.byPath[player.currentPath];
    if (t && !t.duration && isFinite(a.duration)) t.duration = a.duration;
  });
  a.addEventListener('play', updatePlayButtons);
  a.addEventListener('pause', updatePlayButtons);
  a.addEventListener('playing', function () { player.errorSkips = 0; });
  a.addEventListener('ended', onTrackEnded);
  a.addEventListener('error', function () {
    if (!a.getAttribute('src')) return;   // src を外したときのエラーは無視
    var name = player.currentPath ? splitPath(player.currentPath).name : '';
    showToast('「' + name + '」を再生できませんでした（このブラウザが対応していない形式の可能性があります）。', true);
    // 続けて失敗するときは止める（全部の曲が再生できない場合に空回りしないように）
    player.errorSkips++;
    if (player.errorSkips < Math.min(5, player.queue.length)) {
      var n = nextIndex(player.index);
      if (n >= 0 && n !== player.index) playAt(n);
    }
  });

  // シークバー
  var seek = document.getElementById('pb-seek');
  seek.addEventListener('input', function () {
    player.seeking = true;
    var d = a.duration;
    if (isFinite(d)) document.getElementById('pb-time').textContent = _pbTime(seek.value / 1000 * d);
  });
  seek.addEventListener('change', function () {
    var d = a.duration;
    if (isFinite(d) && d > 0) a.currentTime = seek.value / 1000 * d;
    player.seeking = false;
  });

  // 音量
  var vol = document.getElementById('pb-volume');
  vol.addEventListener('input', function () {
    a.volume = vol.value / 100;
    if (a.muted && vol.value > 0) a.muted = false;
    updateVolumeUi();
  });
  vol.addEventListener('change', function () { db.settings.volume = a.volume; saveDB(); });

  // キーボード：スペースで再生 / 一時停止（入力欄・ボタンの上では効かない）
  document.addEventListener('keydown', function (ev) {
    if (ev.code !== 'Space' || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    var dlg = document.getElementById('dialog-modal');
    if (dlg && !dlg.hidden) return;   // ダイアログ表示中は効かない
    var t = ev.target;
    if (t && t.closest && t.closest('input, textarea, select, button, [contenteditable]')) return;
    ev.preventDefault();
    togglePlay();
  });

  // キーボードのメディアキー・OS の再生表示
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', function () { togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', function () { togglePlay(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { playPrev(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { playNext(true); });
    } catch (e) { /* 対応していない操作は無視 */ }
  }
  applyIcons(document.getElementById('player-bar'));
  updatePlayerUi();
}

/* ---------- 再生の開始 ---------- */
// paths の並びを再生キューにして、startIndex の曲から再生する
function playQueue(paths, startIndex, label) {
  if (!paths || !paths.length) return;
  player.baseQueue = paths.slice();
  player.label = label || '';
  player.playlistId = null;   // プレイリストから再生したときは、07-playlists.js の playPlaylist() が付け直す（v5.6）
  player.errorSkips = 0;
  startIndex = startIndex || 0;
  if (player._shuffleStart) { startIndex = Math.floor(Math.random() * paths.length); player._shuffleStart = false; }   // シャッフル再生ボタン（v7.5）：最初の曲もばらばらに
  if (db.settings.shuffle) {   // シャッフル中：選んだ曲を先頭に、残りを混ぜる
    player.queue = _shuffledFrom(player.baseQueue, startIndex);
    playAt(0);
  } else {
    player.queue = player.baseQueue.slice();
    playAt(startIndex);
  }
}

/* ---------- シャッフル（v2.2） ---------- */
// list の firstIndex 番目の曲を先頭にして、残りをばらばらに並べる
function _shuffledFrom(list, firstIndex) {
  var rest = list.slice();
  var first = firstIndex >= 0 && firstIndex < rest.length ? rest.splice(firstIndex, 1) : [];
  for (var i = rest.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp; }
  return first.concat(rest);
}
function toggleShuffle() {
  db.settings.shuffle = !db.settings.shuffle;
  saveDB();
  var cur = player.currentPath;
  if (player.baseQueue.length) {
    if (db.settings.shuffle) {
      // 今の曲を先頭にして残りを混ぜる（今の曲はそのまま続く）
      player.queue = _shuffledFrom(player.baseQueue, Math.max(0, player.baseQueue.indexOf(cur)));
      player.index = 0;
    } else {
      // 元の順に戻して、今の曲の位置から続ける
      player.queue = player.baseQueue.slice();
      player.index = cur ? player.queue.indexOf(cur) : -1;
    }
  }
  updatePlayerUi();
  showToast(db.settings.shuffle ? 'シャッフル：オン' : 'シャッフル：オフ（元の順に戻しました）');
}

async function playAt(i, skips) {
  skips = skips || 0;
  if (i < 0 || i >= player.queue.length) return;
  if (skips >= player.queue.length) {
    showToast('再生できる曲が見つかりませんでした。', true);
    stopPlayback();
    return;
  }
  player.index = i;
  var path = player.queue[i];
  var t = library.byPath[path];
  var token = ++player.loadToken;
  var file = null;
  if (t) {
    try { file = await t.handle.getFile(); } catch (e) { console.warn(e); file = null; }
  }
  if (token !== player.loadToken) return;   // 待っている間に別の曲が押された
  if (!file) {
    showToast((isInTrash(path) ? '削除フォルダにある曲' : '見つからない曲') + '「' + splitPath(path).name + '」をとばしました。');
    var n = nextIndex(i);
    if (n < 0 || n === i) { stopPlayback(); return; }
    return playAt(n, skips + 1);
  }
  if (player.url) URL.revokeObjectURL(player.url);
  player.url = URL.createObjectURL(file);
  player.currentPath = path;
  player.audio.src = player.url;
  player.listen = { path: path, acc: 0, lastT: null, counted: false };   // 今回の再生で聞いた長さ
  updatePlayerUi();
  updatePlayingHighlight();
  try {
    await player.audio.play();
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // 次の曲に切り替わった
    console.warn('play() failed', e);
  }
}

// 次の曲の位置（最後まで来たら、全曲リピート中なら先頭、そうでなければ -1）
function nextIndex(i) {
  if (i + 1 < player.queue.length) return i + 1;
  if (db.settings.repeat !== 'all') return -1;
  if (db.settings.shuffle && player.queue.length > 1) {
    // 全曲リピートで一周したら混ぜ直す。直前の曲が先頭に来て続けて流れないようにする
    var last = player.queue[player.queue.length - 1];
    var q = _shuffledFrom(player.baseQueue, -1);
    if (q[0] === last) { var t = q[0]; q[0] = q[1]; q[1] = t; }
    player.queue = q;
  }
  return 0;
}

function togglePlay() {
  var a = player.audio;
  if (!a.getAttribute('src')) {
    if (player.queue.length && player.index >= 0) { playAt(player.index); return; }
    playAllVisible();
    return;
  }
  if (a.paused) a.play().catch(function (e) { console.warn(e); });
  else a.pause();
}

// byUser: ボタンを押したとき true（最後の曲なら知らせる）
function playNext(byUser) {
  if (!player.queue.length) return;
  var n = nextIndex(player.index);
  if (n < 0) { if (byUser) showToast('最後の曲です。'); return; }
  playAt(n);
}

function playPrev() {
  if (!player.queue.length) return;
  var a = player.audio;
  if (a.currentTime > 3 || player.index <= 0 && db.settings.repeat !== 'all') { a.currentTime = 0; return; }
  var p = player.index - 1;
  if (p < 0) p = player.queue.length - 1;
  playAt(p);
}

function onTrackEnded() {
  if (db.settings.repeat === 'one') {
    player.listen = { path: player.currentPath, acc: 0, lastT: null, counted: false };   // 1曲リピートは、繰り返すたびに1回
    player.audio.currentTime = 0; player.audio.play().catch(function () {}); return;
  }
  var n = nextIndex(player.index);
  if (n < 0) { updatePlayButtons(); return; }   // 最後の曲で止まる
  playAt(n);
}

/* ---------- 再生回数（v2.2）：半分か30秒の短い方を聞いたら1回。シークで飛ばした分は数えない ---------- */
function _trackListen() {
  var L = player.listen;
  if (!L || L.counted || L.path !== player.currentPath) return;
  var t = player.audio.currentTime;
  if (L.lastT !== null) { var d = t - L.lastT; if (d > 0 && d < 1.5) L.acc += d; }
  L.lastT = t;
  var dur = player.audio.duration;
  var need = isFinite(dur) && dur > 0 ? Math.min(30, dur / 2) : 30;
  if (L.acc >= need) { L.counted = true; if (typeof recordPlay === 'function') recordPlay(L.path); }
}
function stopPlayback() {
  var a = player.audio;
  a.pause();
  a.removeAttribute('src');
  try { a.load(); } catch (e) { /* 無視 */ }
  if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
  updatePlayerUi();
}

/* ---------- リピート・消音 ---------- */
var REPEAT_LABELS = { off: 'リピート：なし', all: 'リピート：全曲', one: 'リピート：1曲' };
function cycleRepeat() {
  var order = ['off', 'all', 'one'];
  var cur = order.indexOf(db.settings.repeat);
  db.settings.repeat = order[(cur + 1) % order.length];
  saveDB();
  updatePlayerUi();
  showToast(REPEAT_LABELS[db.settings.repeat]);
}
function toggleMute() {
  player.audio.muted = !player.audio.muted;
  updateVolumeUi();
}

/* ---------- 表示の更新 ---------- */
function updatePlayerUi() {
  var titleEl = document.getElementById('pb-title');
  var subEl = document.getElementById('pb-sub');
  if (!titleEl) return;
  var path = player.currentPath;
  if (!path) {
    titleEl.textContent = '曲が選ばれていません';
    subEl.textContent = '曲一覧やプレイリストの ▶ で再生します';
  } else {
    var t = library.byPath[path];
    var title = t ? t.title : stripExt(splitPath(path).name);
    var sub = t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '';
    titleEl.textContent = title;
    titleEl.title = path;
    // アーティストへのリンク・アルバムへのリンク（v3.1）
    var lbl = player.label ? '（' + player.label + (player.queue.length ? ' ' + (player.index + 1) + '/' + player.queue.length : '') + '）' : '';
    subEl.innerHTML = (t ? artistAlbumLinksHtml(t) + '　' : '') + escapeHtml(lbl);
    subEl.title = (sub ? sub + '　' : '') + lbl;
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try {
        var am = t && typeof artKeyOf === 'function' ? art.mem.get(artKeyOf(t)) : null;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title, artist: t ? t.artist : '', album: t ? t.album : '',
          artwork: am && am.url ? [{ src: am.url, sizes: ART_THUMB_SIZE + 'x' + ART_THUMB_SIZE, type: 'image/jpeg' }] : []
        });
      } catch (e) { /* 無視 */ }
    }
  }
  // 再生バーのジャケット（13-artwork.js）
  if (typeof artUpdatePlayer === 'function') artUpdatePlayer(path ? (library.byPath[path] || null) : null);
  // 歌詞パネル（15-lyrics.js）：曲が変わっていたら切り替える
  if (typeof lyricsOnPlayerUpdate === 'function') lyricsOnPlayerUpdate();
  if (typeof npOnPlayerUpdate === 'function') npOnPlayerUpdate();   // 再生画面（v5.1。37-now-playing.js）
  var sh = document.getElementById('pb-shuffle');
  if (sh) {
    sh.classList.toggle('active', !!db.settings.shuffle);
    sh.setAttribute('aria-pressed', db.settings.shuffle ? 'true' : 'false');
    sh.title = 'シャッフル：' + (db.settings.shuffle ? 'オン' : 'オフ') + '（押すと切り替え）';
  }
  var rp = document.getElementById('pb-repeat');
  var mode = db.settings.repeat || 'off';
  rp.innerHTML = ICONS.repeat + (mode === 'one' ? '<span class="pb-repeat-one">1</span>' : '');
  rp.classList.toggle('active', mode !== 'off');
  rp.title = REPEAT_LABELS[mode] + '（押すと切り替え）';
  updatePlayButtons();
  updateSeekUi();
  updateVolumeUi();
}
function updatePlayButtons() {
  var b = document.getElementById('pb-play');
  if (!b) return;
  var playing = player.audio && !player.audio.paused && !!player.audio.getAttribute('src');
  b.innerHTML = playing ? ICONS.pause : ICONS.play;
  b.title = playing ? '一時停止' : '再生';
  if (typeof updateCardPlayButtons === 'function') updateCardPlayButtons();   // アルバムカードの再生ボタン（v3.5）
}
function updateSeekUi() {
  var a = player.audio;
  if (!a) return;
  var d = a.duration;
  var has = !!a.getAttribute('src') && isFinite(d) && d > 0;
  document.getElementById('pb-dur').textContent = has ? formatDuration(d) : '0:00';
  if (player.seeking) return;
  document.getElementById('pb-time').textContent = has ? _pbTime(a.currentTime) : '0:00';
  document.getElementById('pb-seek').value = has ? Math.round(a.currentTime / d * 1000) : 0;
}
// 再生バーの時間表示（0秒は「0:00」）
function _pbTime(sec) { return sec >= 0.5 ? formatDuration(sec) : '0:00'; }
function updateVolumeUi() {
  var m = document.getElementById('pb-mute');
  if (!m) return;
  var muted = player.audio.muted || player.audio.volume === 0;
  m.innerHTML = muted ? ICONS.mute : ICONS.volume;
  m.title = player.audio.muted ? '消音を解除' : '消音';
}

/* ---------- ファイル整理との連携 ----------
   再生中の曲を移動・名前変更するときは、いったん再生を止めてファイルを手放し、
   終わったら新しい場所から同じ位置で再開する */
function playerReleaseIfAffected(paths) {
  if (!player.currentPath || paths.indexOf(player.currentPath) < 0) return null;
  var a = player.audio;
  var st = { path: player.currentPath, time: a.currentTime || 0, wasPlaying: !a.paused };
  player.loadToken++;
  a.pause();
  a.removeAttribute('src');
  try { a.load(); } catch (e) { /* 無視 */ }
  if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
  return st;
}
// 再生キューのパスを付け替える（map: { 変更前: 変更後 }）
function playerApplyPathMapping(map) {
  player.queue = player.queue.map(function (p) { return map[p] || p; });
  player.baseQueue = player.baseQueue.map(function (p) { return map[p] || p; });
  if (player.currentPath && map[player.currentPath]) player.currentPath = map[player.currentPath];
}
async function playerRestore(st, map) {
  if (!st) return;
  var path = map[st.path] || st.path;
  var t = library.byPath[path];
  player.currentPath = path;
  if (!t) { updatePlayerUi(); return; }   // 削除フォルダへ移した曲などは止めたまま
  try {
    var file = await t.handle.getFile();
    player.url = URL.createObjectURL(file);
    var a = player.audio;
    a.src = player.url;
    await new Promise(function (resolve) {
      a.addEventListener('loadedmetadata', resolve, { once: true });
      a.addEventListener('error', resolve, { once: true });
    });
    try { a.currentTime = st.time; } catch (e) { /* 無視 */ }
    if (st.wasPlaying) await a.play().catch(function () {});
  } catch (e) {
    console.warn('再生の再開に失敗', e);
  }
  updatePlayerUi();
  updatePlayingHighlight();
}

/* =========================================================
   39-playlist-play.js ― 「プレイリストの play画面」（v5.6）
   ・v5.1 の再生画面（37-now-playing.js）に、プレイリストの部分を足した画面。部品（ジャケット・曲名・操作・ビジュアライザー・歌詞）は共通
   ・開き方：プレイリストから再生しているとき（player.playlistId）は、再生バーのジャケットでこの画面が開く。
     プレイリストの画面の「play画面を開く」ボタン（そのプレイリストを再生していなければ、先頭から再生して開く）。
     tools の「プレイリスト再生時に play画面を自動で開く」（db.settings.plAutoOpen。初期はオフ）
   ・上：プレイリストの表紙（入っている曲のジャケットを4枚並べたモザイク）・プレイリスト名・曲数と合計時間
   ・右（スマホ幅は下）：キュー（プレイリストの全曲。再生中の曲を強調し、その位置まで自動でスクロール。「次」の印が次に再生する3曲）。
     行を押すとその曲から再生。シャッフル中は「再生順」と「プレイリストの順」を切り替えて見られる（ui.plpQueueView）。
     プレイリストの順では、↑↓で並べ替え・×で外す（07-playlists.js の movePlaylistTrack / removePlaylistTrack）。
     変えたら、再生中の並び（player.queue）にも反映する（シャッフルでなければプレイリストの順のまま、シャッフル中は外した曲を抜く・足した曲を最後に）
   ========================================================= */

function plpPlaylist() { return player.playlistId ? getPlaylist(player.playlistId) : null; }
function plpActive() { return !!(np.open && np.plMode && plpPlaylist()); }
// プレイリストの play画面を開く
function openPlaylistPlay(id) {
  var p = getPlaylist(id);
  if (!p) return;
  if (player.playlistId !== id || !player.currentPath) { playPlaylist(id, 0); if (player.playlistId !== id) return; }
  if (np.open) { np.plMode = true; npRender(); return; }
  openNowPlaying({ playlist: true });
}
// プレイリストを変えたあと、再生中の並びに反映する
function plpSyncQueue(id) {
  var p = getPlaylist(id);
  if (!p || player.playlistId !== id) return;
  var cur = player.currentPath;
  player.baseQueue = p.tracks.slice();
  if (!db.settings.shuffle) player.queue = p.tracks.slice();
  else {
    var have = new Set(p.tracks);
    player.queue = player.queue.filter(function (x) { return have.has(x); });
    var inQ = new Set(player.queue);
    p.tracks.forEach(function (x) { if (!inQ.has(x)) player.queue.push(x); });
  }
  var i = player.queue.indexOf(cur);
  if (i >= 0) player.index = i;
  if (typeof updatePlayerUi === 'function') updatePlayerUi();
}

/* ---------- 画面 ---------- */
function _plpEnsure(el) {
  if (el.querySelector('#np-pl-head')) return;
  var head = document.createElement('div');
  head.className = 'np-pl-head'; head.id = 'np-pl-head';
  el.querySelector('.np-main').insertAdjacentElement('beforebegin', head);
  var q = document.createElement('section');
  q.className = 'np-queue'; q.id = 'np-queue'; q.setAttribute('aria-label', 'キュー');
  el.querySelector('.np-main').appendChild(q);
  q.addEventListener('click', function (ev) {
    var p = plpPlaylist();
    if (!p) return;
    var v = ev.target.closest('[data-plp-view]');
    if (v) { ui.plpQueueView = v.getAttribute('data-plp-view'); saveUi(); plpRender(true); return; }
    var b = ev.target.closest('[data-plp-act]');
    if (b) {
      var i = +b.getAttribute('data-i'), act = b.getAttribute('data-plp-act');
      if (act === 'up') movePlaylistTrack(p.id, i, i - 1);
      else if (act === 'down') movePlaylistTrack(p.id, i, i + 1);
      else if (act === 'remove') removePlaylistTrack(p.id, i);
      plpSyncQueue(p.id);
      plpRender(false);
      var nb = q.querySelector('[data-plp-act="' + act + '"][data-i="' + (act === 'up' ? i - 1 : act === 'down' ? i + 1 : i) + '"]'); if (nb && !nb.disabled) nb.focus({ preventScroll: true });
      return;
    }
    var row = ev.target.closest('[data-plp-row]');
    if (!row) return;
    var k = +row.getAttribute('data-plp-row');
    if (_plpView() === 'play') playAt(k);
    else playPlaylist(p.id, k);
  });
}
function _plpView() { return db.settings.shuffle && ui.plpQueueView === 'play' ? 'play' : 'list'; }
// プレイリストの表紙：入っている曲のジャケットを違うアルバムから4枚（足りなければあるだけ）
function playlistCoverHtml(p) {
  var seen = new Set(), picks = [];
  for (var i = 0; i < p.tracks.length && picks.length < 4; i++) {
    var t = library.byPath[p.tracks[i]];
    if (!t) continue;
    var k = albumKeyOf(t);
    if (seen.has(k)) continue;
    seen.add(k); picks.push(t);
  }
  if (!picks.length) return '<span class="plp-cover plp-cover-none">' + ICONS.playlist + '</span>';
  return '<span class="plp-cover plp-cover-' + (picks.length >= 4 ? 4 : 1) + '">' + (picks.length >= 4 ? picks : picks.slice(0, 1)).map(function (t) { return artThumbHtml(t, 'art-plp'); }).join('') + '</span>';
}
function plpRender(scroll) {
  var el = document.getElementById('now-playing');
  if (!el) return;
  var p = np.plMode ? plpPlaylist() : null;
  el.classList.toggle('np-pl-mode', !!p);
  _plpEnsure(el);
  var head = document.getElementById('np-pl-head'), q = document.getElementById('np-queue');
  if (!p) { head.innerHTML = ''; q.innerHTML = ''; return; }
  var total = 0; p.tracks.forEach(function (x) { var t = library.byPath[x]; if (t) total += t.duration || 0; });
  var coverKey = p.id + '|' + p.tracks.length + '|' + p.tracks.slice(0, 12).join('|');
  if (head.getAttribute('data-key') !== coverKey) {
    head.setAttribute('data-key', coverKey);
    head.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:-4px;left:-10px" onclick="copyUiLabel(\'プレイリストの play画面\', event)" title="クリックで「プレイリストの play画面」をコピー">□</span>' +
      playlistCoverHtml(p) +
      '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-6px;left:40px" onclick="copyUiLabel(\'プレイリストの表紙\', event)" title="クリックで「プレイリストの表紙」をコピー">□</span>' +
      '<div class="plp-head-text"><div class="plp-kicker">playlist</div><div class="plp-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="plp-meta">' + p.tracks.length + '曲' + (total ? ' ・ ' + formatTotalDuration(total) : '') + '</div></div>';
    artObserve(head);
  }
  var view = _plpView(), order = view === 'play' ? player.queue : p.tracks;
  var curPath = player.currentPath, nextSet = new Map();
  for (var n = 1; n <= 3; n++) { var np_ = player.queue[player.index + n]; if (np_ && !nextSet.has(np_)) nextSet.set(np_, n); }
  var h = '<div class="plp-q-head"><span class="plp-q-title">キュー</span><span class="plp-q-count">' + order.length + '曲</span>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-4px;right:-4px" onclick="copyUiLabel(\'キュー\', event)" title="クリックで「キュー」をコピー">□</span>' +
    (db.settings.shuffle ? '<span class="plp-q-views" role="group" aria-label="キューの並び">' +
      '<button class="np-mode' + (view === 'play' ? ' active' : '') + '" data-plp-view="play" aria-pressed="' + (view === 'play') + '">再生順</button>' +
      '<button class="np-mode' + (view === 'list' ? ' active' : '') + '" data-plp-view="list" aria-pressed="' + (view === 'list') + '">プレイリストの順</button></span>' : '') + '</div>' +
    '<ol class="plp-q-list">';
  order.forEach(function (path, i) {
    var t = library.byPath[path], cur = path === curPath && (view === 'list' || i === player.index), nx = nextSet.get(path);
    h += '<li class="plp-q-row' + (cur ? ' is-current' : '') + (t ? '' : ' missing') + '" data-plp-row="' + i + '" data-path="' + escapeHtml(path) + '" title="押すとこの曲から再生">' +
      '<span class="plp-q-no">' + (cur ? ICONS.volume : (i + 1)) + '</span>' +
      '<span class="plp-q-text"><span class="plp-q-name">' + escapeHtml(t ? t.title : trackDisplayTitle(path)) + '</span><span class="plp-q-sub">' + escapeHtml(t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '見つかりません') + '</span></span>' +
      (nx ? '<span class="plp-q-next" title="' + nx + '曲あとに再生">次' + (nx > 1 ? nx : '') + '</span>' : '') +
      '<span class="plp-q-dur">' + (t ? formatDuration(t.duration) : '') + '</span>' +
      (view === 'list' ? '<span class="plp-q-btns">' +
        '<button class="btn-icon" data-plp-act="up" data-i="' + i + '" title="上へ" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>' + ICONS.up + '</button>' +
        '<button class="btn-icon" data-plp-act="down" data-i="' + i + '" title="下へ" aria-label="下へ"' + (i === order.length - 1 ? ' disabled' : '') + '>' + ICONS.down + '</button>' +
        '<button class="btn-icon btn-icon-danger" data-plp-act="remove" data-i="' + i + '" title="プレイリストから外す（ファイルは消えません）" aria-label="プレイリストから外す">' + ICONS.x + '</button></span>' : '') +
      '</li>';
  });
  h += '</ol>';
  var list0 = q.querySelector('.plp-q-list'), keepTop = list0 ? list0.scrollTop : 0;
  q.innerHTML = h;
  var list = q.querySelector('.plp-q-list'), curEl = q.querySelector('.plp-q-row.is-current');
  if (list) {
    if (scroll !== false && curEl) list.scrollTop = Math.max(0, curEl.offsetTop - list.offsetTop - list.clientHeight / 3);
    else list.scrollTop = keepTop;
  }
}

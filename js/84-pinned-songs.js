/* =========================================================
   84-pinned-songs.js ― 曲の Pin（スマホ版 v8.18.0）
   ・Pin した曲を、songs（曲一覧）の先頭の「Pin の区切り（曲）」に並べる。通常の一覧にも残す（両方に出る。曲数は通常の一覧で数え、二重に数えない）
   ・保存：db.pinnedSongs＝曲の相対パスの配列（並び＝Pin の順。PC版と同じ名前と形。バックアップ・復元に含む。古いデータ・バックアップは空）
   ・入口：曲の行の「曲の Pin ボタン」（曲名の右の丸いボタン。Pin 中はオレンジ）、曲の長押しのメニュー（82-up-next.js）の「Pin する／Pin を外す」。
     押したあとのトーストに「元に戻す」
   ・並べ替え：Pin の区切りの見出しの「並べ替え」で「曲の Pin の並べ替えモード」（行の右に ↑ ↓。指で押しやすい大きさ）。tools の「Pin の曲」でも ↑ ↓
   ・Pin の区切りの見出しには「▷ 再生」（Pin の順に連続再生）と「シャッフル再生」
   ・検索中は、検索に合う Pin だけを出す（並べ替えモードは、Pin が全部見えているときだけ）
   ・ファイル整理で場所が変わったときは付け替える（applyPathMapping を包む）
   ・ファイルは一切触らない
   ・スマホ版 v8.25.4：Pin した曲は album の「Pin の区切り」にも「Pin の曲のカード」（ジャケットのカード）で並ぶ（95-pin-song-cards.js）。
     データ（db.pinnedSongs）は今までのまま（今までに Pin した曲もそのままカードに出る）。メニューの言葉は「この曲を Pin 止め」。
     アルバムの曲一覧の曲の行にも曲の Pin ボタン
   ========================================================= */

var songPin = { sorting: false };
var _pinnedSongSet = { src: null, len: -1, set: null };
function pinnedSongList() {
  if (!Array.isArray(db.pinnedSongs)) db.pinnedSongs = [];
  return db.pinnedSongs;
}
function pinnedSongKeys() {
  var list = pinnedSongList();
  if (_pinnedSongSet.src !== list || _pinnedSongSet.len !== list.length) _pinnedSongSet = { src: list, len: list.length, set: new Set(list) };
  return _pinnedSongSet.set;
}
function isSongPinned(path) { return !!path && pinnedSongKeys().has(path); }
function _songTitle(p) { var t = library.byPath[p]; return t ? t.title : stripExt(splitPath(p).name); }
function _songPinChanged() {
  _pinnedSongSet.src = null;
  if (currentPage === 'library') { var y = window.scrollY; renderLibraryPage(); window.scrollTo(0, y); }
  if (currentPage === 'settings') renderSetPinnedSongs();
  // スマホ版 v8.25.4：album の Pin の区切りの「Pin の曲のカード」・アルバムの曲一覧の曲の Pin ボタン（95-pin-song-cards.js）
  if (currentPage === 'albums' && typeof renderAlbumsPage === 'function') { var ya = window.scrollY; renderAlbumsPage(); window.scrollTo(0, ya); }
}

/* ---------- Pin する・外す ---------- */
function togglePinSong(path) {
  if (!path) return;
  var list = pinnedSongList(), name = _songTitle(path);
  if (isSongPinned(path)) {
    var pos = list.indexOf(path);
    db.pinnedSongs = list.filter(function (p) { return p !== path; });
    saveDB(); _songPinChanged();
    showToast('曲「' + name + '」の Pin を外しました。', false, { label: '元に戻す', fn: function () {
      if (isSongPinned(path)) return;
      var l = pinnedSongList().slice(); l.splice(Math.min(pos, l.length), 0, path); db.pinnedSongs = l; saveDB(); _songPinChanged();
    } });
  } else {
    db.pinnedSongs = list.concat([path]);
    saveDB(); _songPinChanged();
    showToast('曲「' + name + '」を Pin 止めしました（album の Pin の区切りと songs の先頭に出ます）。', false, { label: '元に戻す', fn: function () {
      db.pinnedSongs = pinnedSongList().filter(function (p) { return p !== path; }); saveDB(); _songPinChanged();
    } });
  }
}
function unpinSongs(paths) {
  var ks = new Set(paths), before = pinnedSongList().length;
  db.pinnedSongs = pinnedSongList().filter(function (p) { return !ks.has(p); });
  if (db.pinnedSongs.length === before) return 0;
  saveDB(); _songPinChanged();
  return before - db.pinnedSongs.length;
}
function movePinnedSong(i, dir) {
  var list = pinnedSongList().slice(), j = i + dir;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
  var x = list[i]; list[i] = list[j]; list[j] = x;
  db.pinnedSongs = list;
  saveDB(); _songPinChanged();
}
// 見えている Pin の中で path を1つ動かす（並べ替えモードの ↑ ↓）
function movePinnedSongPath(path, dir) { movePinnedSong(pinnedSongList().indexOf(path), dir); }

/* ---------- 曲の Pin ボタン ---------- */
function songPinBtnHtml(path) {
  var on = isSongPinned(path);
  return '<button type="button" class="song-pin-btn' + (on ? ' is-pinned' : '') + '" data-song-pin="' + escapeHtml(path) + '" aria-pressed="' + on + '"' +
    ' title="' + (on ? 'Pin を外す' : 'この曲を Pin 止め（album の Pin の区切りと songs の先頭に出す）') + '" aria-label="' + (on ? 'Pin を外す' : 'この曲を Pin 止め') + '">' + ICONS.pin + '</button>';
}

/* ---------- songs の「Pin の区切り（曲）」 ---------- */
function _songPinSectionHtml() {
  var all = pinnedSongList();
  if (!all.length || !libView.list.length) return '';
  var idx = new Map();
  libView.list.forEach(function (t, i) { idx.set(t.path, i); });
  var shown = all.filter(function (p) { return idx.has(p); });
  if (!shown.length) return '';
  var full = shown.length === all.filter(function (p) { return !!library.byPath[p]; }).length;
  if (!full) songPin.sorting = false;
  var sorting = songPin.sorting;
  var h = '<section class="song-pin-sec' + (sorting ? ' is-editing' : '') + '" aria-label="Pin の区切り（曲）">' +
    '<div class="art-section-head song-pin-head"><span class="album-section-icon">' + ICONS.pin + '</span>Pin<span class="album-section-count">' + shown.length + '曲</span>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static" onclick="copyUiLabel(\'Pin の区切り（曲）\', event)" title="クリックで「Pin の区切り（曲）」をコピー">□</span>' +
      '<span class="song-pin-btns">' +
        '<button type="button" class="btn-inline-small" data-song-pin-act="play" title="Pin の曲を Pin の順に再生">' + ICONS.play + '再生</button>' +
        '<button type="button" class="btn-inline-small" data-song-pin-act="shuffle" title="Pin の曲をシャッフル再生" aria-label="Pin の曲をシャッフル再生">' + ICONS.shuffle + '</button>' +
        (shown.length > 1 ? '<button type="button" class="btn-inline-small' + (sorting ? ' active' : '') + '" data-song-pin-act="sort"' + (full ? '' : ' disabled title="検索中は並べ替えできません（検索を消すと並べ替えられます）"') + '>' + (sorting ? '完了' : '並べ替え') + '</button>' : '') +
      '</span></div>' +
    '<table class="lib-table lib-pin-table"><tbody>';
  shown.forEach(function (p, k) {
    var row = _libRowHtml(library.byPath[p], idx.get(p));
    if (sorting) {   // 並べ替えモード：行の最後に ↑ ↓
      row = row.replace(/<\/tr>$/, '') .replace(/<td class="col-edit">[\s\S]*?<\/td>$/, '') +
        '<td class="col-edit song-pin-move"><button type="button" class="btn-icon" data-song-pin-move="-1" data-path="' + escapeHtml(p) + '" title="1つ上へ" aria-label="1つ上へ"' + (k === 0 ? ' disabled' : '') + '>' + ICONS.up + '</button>' +
        '<button type="button" class="btn-icon" data-song-pin-move="1" data-path="' + escapeHtml(p) + '" title="1つ下へ" aria-label="1つ下へ"' + (k === shown.length - 1 ? ' disabled' : '') + '>' + ICONS.down + '</button></td></tr>';
    }
    h += row;
  });
  h += '</tbody></table>' +
    '<div class="art-section-head song-rest-head">曲<span class="album-section-count">' + libView.list.length + '曲</span></div></section>';
  return h;
}

/* ---------- tools の「Pin の曲」 ---------- */
function renderSetPinnedSongs() {
  var el = document.getElementById('set-pinned-songs');
  if (!el) return;
  var list = pinnedSongList();
  if (!list.length) { el.innerHTML = '<p class="panel-meta">Pin した曲はありません。</p>'; return; }
  var h = '<p class="panel-meta">' + list.length + '曲（上から順に album の Pin の区切りと songs の先頭に並びます）</p><ul class="hidden-album-list pinned-album-list">';
  list.forEach(function (p, i) {
    var t = library.byPath[p];
    h += '<li><span class="pinned-album-no">' + (i + 1) + '</span><span class="hidden-album-name">' + escapeHtml(_songTitle(p)) + '</span>' +
      '<span class="hidden-album-sub">' + escapeHtml(t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '') +
        (library.tracks.length && !t ? ' <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span>' +
      '<span class="pinned-album-btns">' +
        '<button class="btn-inline-small" data-spin-move="-1" data-i="' + i + '" title="1つ上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn-inline-small" data-spin-move="1" data-i="' + i + '" title="1つ下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn-inline-small" data-spin-off="' + i + '">外す</button></span></li>';
  });
  h += '</ul><div class="btn-row"><button class="btn-inline-small" id="pinned-songs-all">すべて外す</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-spin-move]').forEach(function (b) { b.addEventListener('click', function () { movePinnedSong(+b.getAttribute('data-i'), +b.getAttribute('data-spin-move')); }); });
  el.querySelectorAll('[data-spin-off]').forEach(function (b) {
    b.addEventListener('click', function () { var p = list[+b.getAttribute('data-spin-off')]; if (unpinSongs([p])) showToast('曲「' + _songTitle(p) + '」の Pin を外しました。'); });
  });
  document.getElementById('pinned-songs-all').addEventListener('click', async function () {
    var ok = await showConfirm({ title: 'Pin をすべて外す', message: list.length + '曲の Pin を外します（曲は通常の一覧に残ります。ファイルは変わりません）。', okText: 'すべて外す', danger: true });
    if (!ok) return;
    var n = unpinSongs(list.slice());
    showToast(n + '曲の Pin を外しました。');
  });
}

// songs の表の前に Pin の区切り（曲）を入れる（もうあれば何もしない）
function _songPinInject() {
  try {
    var body = document.getElementById('lib-body');
    if (!body || body.querySelector(':scope > .song-pin-sec')) return;
    var tbl = body.querySelector(':scope > table.lib-table');
    var sec = tbl ? _songPinSectionHtml() : '';
    if (!sec) return;
    tbl.insertAdjacentHTML('beforebegin', sec);
    // 列の幅をそろえるため、通常の表の見出しの行を写して、見えない見出しにする
    var th = tbl.querySelector('thead'), pt = body.querySelector('.lib-pin-table');
    if (th && pt) { var c = th.cloneNode(true); c.className = 'lib-pin-thead'; c.setAttribute('aria-hidden', 'true'); c.querySelectorAll('input').forEach(function (x) { x.remove(); }); pt.insertBefore(c, pt.firstChild); }
    artObserve(body.querySelector('.song-pin-sec'));
  } catch (e) { console.warn(e); }
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // 曲の行：曲名の右に曲の Pin ボタン
  var rh = window._libRowHtml;
  if (typeof rh === 'function') {
    window._libRowHtml = function (t, i) {
      var h = rh.apply(this, arguments);
      return h.replace('</button></div><div class="lib-sub">', '</button>' + songPinBtnHtml(t.path) + '</div><div class="lib-sub">');
    };
  }
  // songs を描いたあと：Pin の区切り（曲）を表の前に。
  //   47-shuffle-play.js などが PAGE_RENDERERS.library を元の関数のまま包んでいるので、名前で呼ばれたときと画面の切り替えのときの両方で足す（2回は足さない）
  var rl = window.renderLibraryPage;
  if (typeof rl === 'function') window.renderLibraryPage = function () { var r = rl.apply(this, arguments); _songPinInject(); return r; };
  var pr = PAGE_RENDERERS.library;
  if (typeof pr === 'function') PAGE_RENDERERS.library = function () { var r = pr.apply(this, arguments); _songPinInject(); return r; };
  // tools
  var rs = window.renderSettingsPage;
  if (typeof rs === 'function') {
    window.renderSettingsPage = function () { var r = rs.apply(this, arguments); try { renderSetPinnedSongs(); } catch (e) { console.warn(e); } return r; };
    if (typeof PAGE_RENDERERS !== 'undefined' && PAGE_RENDERERS.settings === rs) PAGE_RENDERERS.settings = window.renderSettingsPage;
  }
  // ファイル整理で場所が変わったとき
  var am = window.applyPathMapping;
  if (typeof am === 'function') {
    window.applyPathMapping = function (map) {
      var r = am.apply(this, arguments);
      try {
        var ch = false, seen = new Set();
        db.pinnedSongs = pinnedSongList().map(function (p) { if (map[p]) { ch = true; return map[p]; } return p; }).filter(function (p) { if (seen.has(p)) { ch = true; return false; } seen.add(p); return true; });
        if (ch) { _pinnedSongSet.src = null; saveDB(); }
      } catch (e) { console.warn(e); }
      return r;
    };
  }
})();
// 押したとき（Pin ボタン・Pin の区切りの見出しのボタン・↑ ↓）。どの画面の曲の行でも
document.addEventListener('click', function (ev) {
  if (!ev.target.closest) return;
  var b = ev.target.closest('[data-song-pin], [data-song-pin-act], [data-song-pin-move]');
  if (!b || b.disabled) return;
  ev.preventDefault(); ev.stopPropagation();
  if (b.hasAttribute('data-song-pin')) { togglePinSong(b.getAttribute('data-song-pin')); return; }
  if (b.hasAttribute('data-song-pin-move')) {
    var p = b.getAttribute('data-path'), d = +b.getAttribute('data-song-pin-move');
    movePinnedSongPath(p, d);
    var nb = document.querySelector('[data-song-pin-move="' + d + '"][data-path="' + (window.CSS && CSS.escape ? CSS.escape(p) : p) + '"]');
    if (nb && !nb.disabled) { try { nb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    return;
  }
  var act = b.getAttribute('data-song-pin-act');
  var paths = pinnedSongList().filter(function (x) { return !!library.byPath[x]; });
  if (act === 'sort') { songPin.sorting = !songPin.sorting; var y = window.scrollY; renderLibraryPage(); window.scrollTo(0, y); }
  else if (act === 'play' && paths.length) playQueue(paths, 0, 'Pin の曲');
  else if (act === 'shuffle' && paths.length) shufflePlay(function () { playQueue(paths, 0, 'Pin の曲'); });
}, true);

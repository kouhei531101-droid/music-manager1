/* =========================================================
   28-pinned-artists.js ― アーティストの Pin（v3.9）
   ・Pin したアーティストを、artist の「アーティスト一覧」（縦のリスト）の先頭の「アーティストの Pin の区切り」の下に並べる
     （その下に「アーティスト　〇人」の区切りと通常の一覧。v8.12.4 から Pin したアーティストも通常の一覧に残す：両方に出る）
   ・考え方はアルバムの Pin（v3.4〜v3.5。26-pinned-albums.js）と同じ
   ・保存：db.pinnedArtists = [{ key:アーティストの目印（アーティスト名＝21-artists.js の artistNameOf）, name, at }]
     （並び＝Pin した順。バックアップ・復元に含む。古いデータ・バックアップは空として読む）
     Pin の中の順番は tools の「Pin のアーティスト」の「↑」「↓」で入れ替えられる
   ・入口：アーティスト一覧の各行の「アーティストの Pin ボタン」、アーティストの見出しの写真の左上の「アーティストの見出しの Pin ボタン」。
     押したあとのトーストに「元に戻す」
   ・「アーティスト不明」（アーティストのタグが無い曲）は Pin できない（目印が空で、曲情報を直すと中身が変わるため）
   ・検索中は、検索に合う Pin だけを先頭に
   ・目印が変わったとき（曲情報の編集でアーティスト名を変えた）は 17-tag-edit.js の _renameAlbumKeysAfter() から
     renamePinnedArtistsAfter() を呼んで付け替える（そのアーティストの曲が全部同じ新しい名前に移ったときだけ）
   ・ファイルは一切触らない
   ========================================================= */

var _pinnedArtistSet = { src: null, len: -1, set: null };
function pinnedArtistKeys() {
  var list = db.pinnedArtists || [];
  if (_pinnedArtistSet.src !== list || _pinnedArtistSet.len !== list.length) {
    _pinnedArtistSet = { src: list, len: list.length, set: new Set(list.map(function (p) { return p.key; })) };
  }
  return _pinnedArtistSet.set;
}
function isArtistPinned(name) { return !!name && pinnedArtistKeys().has(name); }

// 一覧（検索のあと）を、Pin（Pin の順）と通常の一覧に分ける
function splitPinnedArtists(list) {
  var ps = pinnedArtistKeys();
  if (!ps.size) return { pinned: [], rest: list };
  var byKey = new Map(), rest = [];
  list.forEach(function (ar) { if (ar.name && ps.has(ar.name)) byKey.set(ar.name, ar); else rest.push(ar); });
  var pinned = [];
  (db.pinnedArtists || []).forEach(function (p) { var ar = byKey.get(p.key); if (ar) pinned.push(ar); });
  return { pinned: pinned, rest: rest };
}

/* ---------- Pin する・外す ---------- */
function _rerenderAfterArtistPin() {
  if (currentPage === 'artists') renderArtistsPage();
  else if (currentPage === 'settings') renderSetPinnedArtists();
}
// ar：{ name }（buildArtists のアーティスト）。opts.undo：トーストに「元に戻す」を付ける
function togglePinArtist(ar, opts) {
  if (!ar || !ar.name) return;
  opts = opts || {};
  var label = ar.name;
  var undo = opts.undo ? { label: '元に戻す', fn: function () { togglePinArtist(ar); _rerenderAfterArtistPin(); } } : null;
  if (isArtistPinned(ar.name)) {
    var pos = (db.pinnedArtists || []).findIndex(function (p) { return p.key === ar.name; }), rec = db.pinnedArtists[pos];
    unpinArtists([ar.name]);
    if (undo) undo.fn = function () {   // 外したのを元に戻す：同じ位置に Pin し直す
      if (isArtistPinned(rec.key)) return;
      var list = (db.pinnedArtists || []).slice(); list.splice(Math.min(pos, list.length), 0, rec); db.pinnedArtists = list; saveDB();
      _rerenderAfterArtistPin();
    };
    showToast('アーティスト「' + label + '」の Pin を外しました。', false, undo);
  } else {
    db.pinnedArtists = (db.pinnedArtists || []).concat([{ key: ar.name, name: ar.name, at: nowIso() }]);
    saveDB();
    showToast('アーティスト「' + label + '」を Pin しました（アーティスト一覧の先頭に出ます）。', false, undo);
  }
}
function unpinArtists(keys) {
  var ks = new Set(keys), before = (db.pinnedArtists || []).length;
  db.pinnedArtists = (db.pinnedArtists || []).filter(function (p) { return !ks.has(p.key); });
  if (db.pinnedArtists.length === before) return 0;
  saveDB();
  if (currentPage === 'settings') renderSetPinnedArtists();
  return before - db.pinnedArtists.length;
}
// Pin の中の順番を入れ替える（tools の「↑」「↓」）
function movePinnedArtist(i, dir) {
  var list = (db.pinnedArtists || []).slice(), j = i + dir;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
  var x = list[i]; list[i] = list[j]; list[j] = x;
  db.pinnedArtists = list;
  saveDB();
  renderSetPinnedArtists();
}

// Pin の並べ替え（v4.1）：アーティスト一覧の Pin の区切りの中でドラッグしたとき。fromName を toName の位置へ
function movePinnedArtistKey(fromName, toName) {
  var list = (db.pinnedArtists || []).slice();
  var fi = list.findIndex(function (p) { return p.key === fromName; }), ti = list.findIndex(function (p) { return p.key === toName; });
  if (fi < 0 || ti < 0 || fi === ti) return false;
  var x = list.splice(fi, 1)[0];
  list.splice(ti, 0, x);
  db.pinnedArtists = list;
  saveDB();
  return true;
}

/* ---------- アーティスト一覧の行のボタン ---------- */
// アーティストの Pin ボタン（行の右端）。i＝artistView.list の番号。「アーティスト不明」には付けない
function artistPinBtnHtml(ar, i, withLabel) {
  if (!ar.name) return '';
  var on = isArtistPinned(ar.name);
  return '<span class="art-item-pin' + (on ? ' is-pinned' : '') + '" role="button" tabindex="0" data-art-pin="' + i + '" aria-pressed="' + on + '"' +
    ' title="' + (on ? 'Pin を外す' : 'Pin する（アーティスト一覧の先頭に出す）') + '" aria-label="' + (on ? 'Pin を外す' : 'Pin する') + '">' + ICONS.pin + '</span>' +
    (withLabel ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:2px;right:2px" onclick="copyUiLabel(\'アーティストの Pin ボタン\', event)" title="クリックで「アーティストの Pin ボタン」をコピー">□</span>' : '');
}

/* ---------- tools の「Pin のアーティスト」 ---------- */
function renderSetPinnedArtists() {
  var el = document.getElementById('set-pinned-artists');
  if (!el) return;
  var list = db.pinnedArtists || [];
  if (!list.length) { el.innerHTML = '<p class="panel-meta">Pin したアーティストはいません。</p>'; return; }
  var present = new Set();
  if (library.tracks.length) library.tracks.forEach(function (t) { present.add(artistNameOf(t)); });
  var h = '<p class="panel-meta">' + list.length + '人（上から順にアーティスト一覧の先頭に並びます）</p><ul class="hidden-album-list pinned-album-list">';
  list.forEach(function (x, i) {
    h += '<li><span class="pinned-album-no">' + (i + 1) + '</span><span class="hidden-album-name">' + escapeHtml(x.name || x.key) + '</span>' +
      '<span class="hidden-album-sub">' + (x.at ? formatDateTime(x.at) : '') +
        (library.tracks.length && !present.has(x.key) ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span>' +
      '<span class="pinned-album-btns">' +
        '<button class="btn-inline-small" data-apin-move="-1" data-i="' + i + '" title="1つ上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn-inline-small" data-apin-move="1" data-i="' + i + '" title="1つ下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn-inline-small" data-apin-off="' + i + '">外す</button></span></li>';
  });
  h += '</ul><div class="btn-row"><button class="btn-inline-small" id="pinned-artists-all">すべて外す</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-apin-move]').forEach(function (b) {
    b.addEventListener('click', function () { movePinnedArtist(+b.getAttribute('data-i'), +b.getAttribute('data-apin-move')); });
  });
  el.querySelectorAll('[data-apin-off]').forEach(function (b) {
    b.addEventListener('click', function () { var x = list[+b.getAttribute('data-apin-off')]; if (unpinArtists([x.key])) showToast('アーティスト「' + (x.name || x.key) + '」の Pin を外しました。'); });
  });
  document.getElementById('pinned-artists-all').addEventListener('click', async function () {
    var ok = await showConfirm({ title: 'Pin をすべて外す', message: list.length + '人のアーティストの Pin を外します（アーティストは通常の一覧に戻ります。ファイルは変わりません）。', okText: 'すべて外す' });
    if (!ok) return;
    var n = unpinArtists(list.map(function (x) { return x.key; }));
    showToast(n + '人の Pin を外しました。');
  });
}

/* ---------- 目印が変わったとき ---------- */
// map：{ 古い名前: 新しい名前 }。同じ名前になった2つ目以降は外す（先の位置を使う）。変えたら true
function renamePinnedArtistKeys(map) {
  if (!db.pinnedArtists || !db.pinnedArtists.length) return false;
  var changed = false, seen = new Set(), out = [];
  db.pinnedArtists.forEach(function (p) {
    var nk = map[p.key] || p.key;
    if (nk !== p.key) changed = true;
    if (seen.has(nk)) { changed = true; return; }
    seen.add(nk);
    out.push(nk === p.key ? p : Object.assign({}, p, { key: nk, name: nk }));
  });
  if (changed) db.pinnedArtists = out;
  return changed;
}
// 曲情報の編集のあと：before＝編集前の { 曲のパス: アーティスト名 }。
// 古い名前の曲が全部編集され、全部同じ新しい名前（空でない）になったときだけ付け替える（前回選んだアーティストも）
function renamePinnedArtistsAfter(before, changedPaths) {
  if (!before) return;
  var changed = new Set(changedPaths), olds = {};
  changedPaths.forEach(function (p) { if (before[p]) olds[before[p]] = true; });
  var map = {};
  Object.keys(olds).forEach(function (oldName) {
    var members = Object.keys(before).filter(function (p) { return before[p] === oldName; });
    if (!members.every(function (p) { return changed.has(p); })) return;   // 残っている曲がある＝元のアーティストはそのまま
    var news = new Set(members.map(function (p) { var t = library.byPath[p]; return t ? artistNameOf(t) : ''; }));
    if (news.size !== 1) return;
    var nn = Array.from(news)[0];
    if (!nn || nn === oldName) return;
    map[oldName] = nn;
  });
  if (!Object.keys(map).length) return;
  renamePinnedArtistKeys(map);
  if (typeof renameWesternArtistKeys === 'function') renameWesternArtistKeys(map);   // アーティストごとの洋楽の指定（v5.0）
  if (ui.lastArtist && map[ui.lastArtist]) { ui.lastArtist = map[ui.lastArtist]; saveUi(); }
  if (artistView.open && map[artistView.open]) artistView.open = map[artistView.open];
}

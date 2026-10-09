/* =========================================================
   26-pinned-albums.js ― アルバムの Pin（v3.4）
   ・Pin したアルバムを、album の一覧の先頭の「Pin の区切り」の下に並べる（どの並べ替えでも先頭。v8.12.4 から通常の一覧にも残す：両方に出る）
   ・保存：db.pinnedAlbums = [{ key:アルバムの目印（albumKeyOf）, name, artist, at }]（並び＝Pin した順。バックアップ・復元に含む）
     Pin の中の順番は、Pin した順（古いものが先）。tools の「Pin のアルバム」の「↑」「↓」で入れ替えられる
   ・入口：アルバムの見出しの「Pin ボタン」（ピンのアイコンだけ。押すたびに Pin／外す）。
     アルバムカードには、Pin 中の目印（小さなピン）だけを出す（カードから直接は変えない：押し間違えやすいため）
   ・検索中は、検索に合う Pin だけを先頭に。非表示のアルバム（v3.0）は、Pin していても一覧には出さない（非表示が優先）
   ・目印が変わったときは 14-albums.js の migrateAlbumKeys()、17-tag-edit.js の _renameAlbumKeysAfter() が付け替える
   ・v4.1：Pin の並べ替え、Pin のみボタン（Pin したアルバムだけを表示。db.settings.albumPinOnly）
   ・v8.7.8：Pin の並べ替えは「Pin の並べ替えボタン」→「Pin の並べ替えモード」の間だけ、カードをドラッグ（60-pin-sort-drag.js。
     Pointer Events）・キーボードの ← →。モード外のカードはドラッグできない（前の HTML5 のドラッグと「←」「→」ボタンはやめた）
   ・ファイルは一切触らない
   ========================================================= */

var _pinnedSet = { src: null, len: -1, set: null };
function pinnedAlbumKeys() {
  var list = db.pinnedAlbums || [];
  if (_pinnedSet.src !== list || _pinnedSet.len !== list.length) {
    _pinnedSet = { src: list, len: list.length, set: new Set(list.map(function (p) { return p.key; })) };
  }
  return _pinnedSet.set;
}
function isAlbumPinned(key) { return pinnedAlbumKeys().has(key); }

// 一覧（検索・非表示の絞り込み・並べ替えのあと）を、Pin（Pin の順）と通常の一覧に分ける
function splitPinnedAlbums(list) {
  var ps = pinnedAlbumKeys();
  if (!ps.size) return { pinned: [], rest: list };
  var byKey = new Map(), rest = [];
  list.forEach(function (a) { if (ps.has(a.key)) byKey.set(a.key, a); else rest.push(a); });
  var pinned = [];
  (db.pinnedAlbums || []).forEach(function (p) { var a = byKey.get(p.key); if (a) pinned.push(a); });
  return { pinned: pinned, rest: rest };
}

/* ---------- Pin する・外す ---------- */
// opts.undo：トーストに「元に戻す」を付ける（カードの Pin ボタン。v3.5）
function togglePinAlbum(a, opts) {
  if (!a) return;
  opts = opts || {};
  var undo = opts.undo ? { label: '元に戻す', fn: function () { togglePinAlbum(a); if (currentPage === 'albums') renderAlbumsPage(); else if (currentPage === 'artists') renderArtistsPage(); } } : null;
  if (isAlbumPinned(a.key)) {
    var pos = (db.pinnedAlbums || []).findIndex(function (p) { return p.key === a.key; }), rec = db.pinnedAlbums[pos];
    unpinAlbums([a.key]);
    if (undo) undo.fn = function () {   // 外したのを元に戻す：同じ位置に Pin し直す
      var list = (db.pinnedAlbums || []).slice(); list.splice(Math.min(pos, list.length), 0, rec); db.pinnedAlbums = list; saveDB();
      if (currentPage === 'albums') renderAlbumsPage(); else if (currentPage === 'artists') renderArtistsPage();
    };
    showToast('アルバム「' + a.name + '」の Pin を外しました。', false, undo);
  } else {
    db.pinnedAlbums = (db.pinnedAlbums || []).concat([{ key: a.key, name: a.name, artist: a.artist || '', at: nowIso() }]);
    saveDB();
    if (currentPage === 'albums') renderAlbumsPage();
    showToast('アルバム「' + a.name + '」を Pin しました（album の一覧の先頭に出ます）。', false, undo);
  }
}
function unpinAlbums(keys) {
  var ks = new Set(keys), before = (db.pinnedAlbums || []).length;
  db.pinnedAlbums = (db.pinnedAlbums || []).filter(function (p) { return !ks.has(p.key); });
  if (db.pinnedAlbums.length === before) return 0;
  saveDB();
  if (currentPage === 'albums') renderAlbumsPage();
  if (currentPage === 'settings') renderSetPinnedAlbums();
  return before - db.pinnedAlbums.length;
}
// Pin の中の順番を入れ替える（tools の「↑」「↓」）
function movePinnedAlbum(i, dir) {
  var list = (db.pinnedAlbums || []).slice(), j = i + dir;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
  var x = list[i]; list[i] = list[j]; list[j] = x;
  db.pinnedAlbums = list;
  saveDB();
  renderSetPinnedAlbums();
}

/* ---------- tools の「Pin のアルバム」 ---------- */
function renderSetPinnedAlbums() {
  var el = document.getElementById('set-pinned-albums');
  if (!el) return;
  var list = db.pinnedAlbums || [];
  if (!list.length) { el.innerHTML = '<p class="panel-meta">Pin したアルバムはありません。</p>'; return; }
  var present = new Set();
  if (library.tracks.length) buildAlbums().forEach(function (a) { present.add(a.key); });
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var h = '<p class="panel-meta">' + list.length + '枚（上から順に album の一覧の先頭に並びます）</p><ul class="hidden-album-list pinned-album-list">';
  list.forEach(function (x, i) {
    h += '<li><span class="pinned-album-no">' + (i + 1) + '</span><span class="hidden-album-name">' + escapeHtml(x.name) + '</span>' +
      '<span class="hidden-album-sub">' + escapeHtml(x.artist || '') + (x.at ? ' ・ ' + formatDateTime(x.at) : '') +
        (hs.has(x.key) ? ' ・ <span class="text-warn">非表示のアルバム（一覧には出ません）</span>' : '') +
        (library.tracks.length && !present.has(x.key) ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span>' +
      '<span class="pinned-album-btns">' +
        '<button class="btn-inline-small" data-pin-move="-1" data-i="' + i + '" title="1つ上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn-inline-small" data-pin-move="1" data-i="' + i + '" title="1つ下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn-inline-small" data-pin-off="' + i + '">外す</button></span></li>';
  });
  h += '</ul><div class="btn-row"><button class="btn-inline-small" id="pinned-albums-all">すべて外す</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-pin-move]').forEach(function (b) {
    b.addEventListener('click', function () { movePinnedAlbum(+b.getAttribute('data-i'), +b.getAttribute('data-pin-move')); });
  });
  el.querySelectorAll('[data-pin-off]').forEach(function (b) {
    b.addEventListener('click', function () { var x = list[+b.getAttribute('data-pin-off')]; if (unpinAlbums([x.key])) showToast('アルバム「' + x.name + '」の Pin を外しました。'); });
  });
  document.getElementById('pinned-albums-all').addEventListener('click', async function () {
    var ok = await showConfirm({ title: 'Pin をすべて外す', message: list.length + '枚のアルバムの Pin を外します（アルバムは通常の一覧に戻ります。ファイルは変わりません）。', okText: 'すべて外す' });
    if (!ok) return;
    var n = unpinAlbums(list.map(function (x) { return x.key; }));
    showToast(n + '枚の Pin を外しました。');
  });
}

/* ---------- 目印が変わったとき ---------- */
function renamePinnedAlbumKeys(map) {
  if (!db.pinnedAlbums || !db.pinnedAlbums.length) return false;
  var changed = false, seen = new Set(), out = [];
  db.pinnedAlbums.forEach(function (p) {
    var nk = map[p.key] || p.key;
    if (nk !== p.key) changed = true;
    if (seen.has(nk)) { changed = true; return; }
    seen.add(nk);
    out.push(nk === p.key ? p : Object.assign({}, p, { key: nk }));
  });
  if (changed) db.pinnedAlbums = out;
  return changed;
}

/* ---------- Pin の並べ替え（v4.1） ----------
   Pin の区切りの中で fromKey のアルバムを toKey のアルバムの位置へ動かす（db.pinnedAlbums の順＝tools の ↑↓ と同じデータ）。
   検索中で一部しか見えていなくても、目印で動かすので見えていない Pin の位置は変わらない */
function movePinnedAlbumKey(fromKey, toKey) {
  var list = (db.pinnedAlbums || []).slice();
  var fi = list.findIndex(function (p) { return p.key === fromKey; }), ti = list.findIndex(function (p) { return p.key === toKey; });
  if (fi < 0 || ti < 0 || fi === ti) return false;
  var x = list.splice(fi, 1)[0];
  list.splice(ti, 0, x);
  db.pinnedAlbums = list;
  saveDB();
  return true;
}
// Pin の区切りの i 番目（今見えている順）を j 番目の位置へ
function movePinnedAlbumShown(i, j) {
  var ps = albView.pinned || [];
  if (i < 0 || j < 0 || i >= ps.length || j >= ps.length || i === j) return;
  if (movePinnedAlbumKey(ps[i].key, ps[j].key)) renderAlbumsPage();
}
// Pin の並べ替えボタン（見出しの「並べ替え」「完了」）：Pin の並べ替えモードを切り替える（v8.7.8 からカードはドラッグで動かす）。
// 検索・絞り込みで Pin の一部しか見えていないとき（albView.pinSortBlocked）は入らない
function togglePinSorting(on) {
  var next = typeof on === 'boolean' ? on : !albView.pinSorting;
  if (next && albView.pinSortBlocked) next = false;
  albView.pinSorting = next;
  renderAlbumsPage();
}

/* ---------- Pin のみボタン（v4.1） ----------
   オンのときは Pin したアルバムだけを並べ、通常の一覧は出さない（検索は効く）。
   Pin が今の音楽フォルダに1枚も無いときはボタンを出さない（オンのままでも、ふつうの一覧を出す）。
   「非表示のアルバム」を見ている間は効かない（非表示が優先。ボタンは押せない） */
function pinnedAlbumsPresentCount(albums) {
  var ps = pinnedAlbumKeys();
  if (!ps.size) return 0;
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var n = 0;
  albums.forEach(function (a) { if (ps.has(a.key) && !hs.has(a.key)) n++; });
  return n;
}
function isPinOnlyActive(presentN) {
  return !!db.settings.albumPinOnly && !albView.showHidden && presentN > 0;
}
function togglePinOnly(on) {
  db.settings.albumPinOnly = typeof on === 'boolean' ? on : !db.settings.albumPinOnly;
  saveDB();
  albView.limit = ALB_PAGE_SIZE;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}
function renderPinOnlyToggle(presentN) {
  var b = document.getElementById('alb-pin-only');
  if (!b) return;
  var on = isPinOnlyActive(presentN);
  b.hidden = !presentN;
  b.disabled = !!albView.showHidden;
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.innerHTML = ICONS.pin;   // アイコンだけ（状態は色・title・aria-pressed で伝える）
  b.title = albView.showHidden ? 'Pin のみ（非表示のアルバムを見ている間は使えません）'
    : 'Pin のみ（' + presentN + '枚）：' + (on ? 'ふつうの一覧に戻る' : 'Pin したアルバムだけを表示する');
  b.setAttribute('aria-label', 'Pin のみ（' + presentN + '枚）');
}

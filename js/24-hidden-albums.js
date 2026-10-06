/* =========================================================
   24-hidden-albums.js ― 非表示のアルバム（v3.0）
   ・アルバムを album の一覧（検索結果・アルバム数も）に出さないようにする。ファイルは一切触らない
   ・保存：db.hiddenAlbums = [{ key:アルバムの目印（albumKeyOf）, name, artist, at:非表示にした日時 }]（バックアップ・復元に含む）
     name・artist は、tools の一覧で、今は見つからないアルバム（フォルダを移したなど）も分かるように控えておく
   ・入口：アルバムの見出しの「非表示にする」ボタン。戻すのは、直後のトーストの「元に戻す」、
     アルバムのフィルターバーの「非表示のアルバム（N）」（オンで非表示のアルバムだけを出し、カードの「表示に戻す」）、
     tools の「非表示のアルバム」（1つずつ・すべて）
   ・カスタム順の位置は db.albumOrder に残したまま（戻すと元の位置）。目印が変わったときは 14-albums.js の migrateAlbumKeys()、
     17-tag-edit.js の _renameAlbumKeysAfter() が付け替える
   ・album 以外（artist・songs・new songs・heavy rotation・プレイリスト）では、曲もアルバムもそのまま出す
   ========================================================= */

var _hiddenSet = { src: null, len: -1, set: null };
// 非表示の目印の集まり（db.hiddenAlbums が変わったときだけ作り直す）
// 非表示のアルバムの曲のパス（v7.9。Seasons Song・upbeat music で除く）。非表示の一覧・曲情報が変わったら作り直す
var _hiddenTracks = { sig: null, set: new Set() };
function hiddenAlbumsSig() { return (db.hiddenAlbums || []).map(function (h) { return h.key; }).join('\n'); }
function hiddenTrackPaths() {
  var sig = hiddenAlbumsSig() + '|' + (library.metaRev || 0) + '|' + library.tracks.length;
  if (_hiddenTracks.sig === sig) return _hiddenTracks.set;
  var set = new Set(), hs = hiddenAlbumKeys();
  if (hs.size) buildAlbums().forEach(function (a) { if (hs.has(a.key)) a.tracks.forEach(function (t) { set.add(t.path); }); });
  _hiddenTracks = { sig: sig, set: set };
  return set;
}
// 非表示にした・戻したあと：ほかの画面の件数の控えを捨てて、サイドバーの件数を合わせる
function _hiddenChanged() {
  if (typeof _wesCount !== 'undefined') _wesCount.at = 0;
  if (typeof sea !== 'undefined') sea.cache = null;
  if (typeof upb !== 'undefined') upb.cache = null;
}
function hiddenAlbumKeys() {
  var list = db.hiddenAlbums || [];
  if (_hiddenSet.src !== list || _hiddenSet.len !== list.length) {
    _hiddenSet = { src: list, len: list.length, set: new Set(list.map(function (h) { return h.key; })) };
  }
  return _hiddenSet.set;
}
function isAlbumHidden(key) { return hiddenAlbumKeys().has(key); }
// 今の曲の中にある非表示のアルバムの数（フィルターバーの「非表示のアルバム（N）」）
function countHiddenAlbumsPresent(albums) {
  var hs = hiddenAlbumKeys();
  if (!hs.size) return 0;
  var n = 0;
  (albums || buildAlbums()).forEach(function (a) { if (hs.has(a.key)) n++; });
  return n;
}

/* ---------- 非表示にする・戻す ---------- */
function hideAlbum(a) {
  if (!a || isAlbumHidden(a.key)) return;
  var nb = typeof albumListNeighborKey === 'function' ? albumListNeighborKey(a.key) : null;   // 隣のアルバム（v6.4。一覧が変わる前に）
  db.hiddenAlbums = (db.hiddenAlbums || []).concat([{ key: a.key, name: a.name, artist: a.artist || '', at: nowIso() }]);
  saveDB();
  _hiddenChanged();
  var key = a.key, name = a.name;
  if (albView.openKey === key) backToAlbumListNear(nb);   // 見出しから：一覧の隣のアルバムの位置へ戻る
  else { var y0 = window.scrollY; renderAlbumsPage(); if (currentPage === 'albums' && nb) flashAlbumCard(nb, y0); }   // カードから：位置はそのまま、隣を強調
  renderSidebarCounts();
  showToast('アルバム「' + name + '」を非表示にしました（ファイルは変わりません）。', false, { label: '元に戻す', fn: function () { unhideAlbums([key]); } });
}
function unhideAlbums(keys) {
  var ks = new Set(keys);
  var before = (db.hiddenAlbums || []).length;
  db.hiddenAlbums = (db.hiddenAlbums || []).filter(function (h) { return !ks.has(h.key); });
  if (db.hiddenAlbums.length === before) return 0;
  saveDB();
  _hiddenChanged();
  if (['seasons', 'upbeat', 'western'].indexOf(currentPage) >= 0) renderCurrentPage();
  if (albView.showHidden && !countHiddenAlbumsPresent()) albView.showHidden = false;   // 非表示のアルバムが無くなったら、ふつうの一覧へ
  if (currentPage === 'albums') renderAlbumsPage();
  if (currentPage === 'settings') renderSetHiddenAlbums();
  renderSidebarCounts();
  return before - db.hiddenAlbums.length;
}
function unhideAlbumFromUi(key, name) {
  if (unhideAlbums([key])) showToast('アルバム「' + name + '」を表示に戻しました。');
}
// アルバムのフィルターバーの切り替え：オンのときは非表示のアルバムだけを出す
function toggleHiddenAlbumsView(on) {
  albView.showHidden = typeof on === 'boolean' ? on : !albView.showHidden;
  albView.limit = ALB_PAGE_SIZE;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}
// フィルターバーの「非表示のアルバム（N）」ボタン（N が 0 で、切り替えもオフのときは隠す）
function renderHiddenAlbumsToggle(albums) {
  var b = document.getElementById('alb-hidden-toggle');
  if (!b) return;
  var n = countHiddenAlbumsPresent(albums);
  b.hidden = !n && !albView.showHidden;
  b.classList.toggle('active', !!albView.showHidden);
  b.setAttribute('aria-pressed', albView.showHidden ? 'true' : 'false');
  b.innerHTML = ICONS.eyeOff;   // アイコンだけ（件数は title・aria-label で伝える）
  b.title = '非表示のアルバム（' + n + '枚）：' + (albView.showHidden ? 'ふつうの一覧に戻る' : '非表示にしたアルバムだけを出す（ここから表示に戻せます）');
  b.setAttribute('aria-label', '非表示のアルバム（' + n + '枚）');
}

/* ---------- tools の「非表示のアルバム」 ---------- */
function renderSetHiddenAlbums() {
  var el = document.getElementById('set-hidden-albums');
  if (!el) return;
  var list = (db.hiddenAlbums || []).slice();
  if (!list.length) { el.innerHTML = '<p class="panel-meta">非表示のアルバムはありません。</p>'; return; }
  var present = new Set();
  if (library.tracks.length) buildAlbums().forEach(function (a) { present.add(a.key); });
  list.sort(function (a, b) { return compareAlbumText(albumTextKey(a.name), albumTextKey(b.name)); });
  var h = '<p class="panel-meta">' + list.length + '枚</p><ul class="hidden-album-list">';
  list.forEach(function (x, i) {
    h += '<li><span class="hidden-album-name">' + escapeHtml(x.name) + '</span>' +
      '<span class="hidden-album-sub">' + escapeHtml(x.artist || '') + (x.at ? ' ・ ' + formatDateTime(x.at) : '') +
        (library.tracks.length && !present.has(x.key) ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span>' +
      '<button class="btn-inline-small" data-i="' + i + '">表示に戻す</button></li>';
  });
  h += '</ul><div class="btn-row"><button class="btn-inline-small" id="hidden-albums-all">すべて表示に戻す</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('.hidden-album-list button').forEach(function (b) {
    b.addEventListener('click', function () { var x = list[+b.getAttribute('data-i')]; unhideAlbumFromUi(x.key, x.name); });
  });
  document.getElementById('hidden-albums-all').addEventListener('click', async function () {
    var ok = await showConfirm({ title: '非表示のアルバムをすべて表示に戻す', message: list.length + '枚のアルバムを、album の一覧に戻します（ファイルは変わりません）。', okText: 'すべて戻す' });
    if (!ok) return;
    var n = unhideAlbums(list.map(function (x) { return x.key; }));
    showToast(n + '枚のアルバムを表示に戻しました。');
  });
}

/* ---------- 目印が変わったとき（まとめ方の変更・曲情報の編集） ---------- */
// map：{ 古い目印: 新しい目印 }。同じアルバムになったものは1つにまとめる
function renameHiddenAlbumKeys(map) {
  if (!db.hiddenAlbums || !db.hiddenAlbums.length) return false;
  var changed = false, seen = new Set(), out = [];
  db.hiddenAlbums.forEach(function (h) {
    var nk = map[h.key] || h.key;
    if (nk !== h.key) changed = true;
    if (seen.has(nk)) { changed = true; return; }
    seen.add(nk);
    out.push(nk === h.key ? h : Object.assign({}, h, { key: nk }));
  });
  if (changed) db.hiddenAlbums = out;
  return changed;
}

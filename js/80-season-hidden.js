/* =========================================================
   80-season-hidden.js ― Seasons Song の「非表示の曲」（スマホ版 v8.13.0）
   ・Seasons Song の曲一覧から、曲を外して見えなくする（ファイル・ライブラリ・ほかの画面はそのまま）
   ・全季節共通：曲は1つの季節にしか入らない（46-seasons.js の seasonOf）ので、曲ごとに1つの印。
     季節を手で変えても非表示のまま
   ・保存：db.seasonHidden = { 曲の相対パス: 非表示にした日時（ISO） }（バックアップ・復元に含む。古いバックアップに無ければ空）
   ・非表示の曲は Seasons Song の一覧・季節のタブの件数・ヘッダーの件数・サイドバーの件数・連続再生・シャッフル再生から除く
   ・入口：曲の表の「季節」の列の「非表示」ボタン（季節の非表示ボタン）。戻すのは、直後のトーストの「元に戻す」、
     季節の見出しの「非表示の曲を表示（N）」（非表示の曲の表示切り替え。オンで非表示の曲も薄く出し「戻す」ボタン）、
     tools の「Seasons Song の非表示の曲」（1曲ずつ・すべて）
   ・ファイル整理で動かしたときは 46-seasons.js の seasonApplyPathMapping() が付け替える
   ========================================================= */

function seasonHiddenMap() {
  if (!db.seasonHidden || typeof db.seasonHidden !== 'object' || Array.isArray(db.seasonHidden)) db.seasonHidden = {};
  return db.seasonHidden;
}
function isSeasonHidden(path) { return Object.prototype.hasOwnProperty.call(seasonHiddenMap(), path); }
// 控えの目印（非表示の曲が変わったら変わる）
function seasonHiddenSig() { var k = Object.keys(seasonHiddenMap()); return k.length + ':' + k.join('\n').length + ':' + (sea.hidRev || 0); }

// 非表示にした・戻したあと：控えを捨てて、画面と件数を合わせる
function _seaHiddenChanged() {
  sea.cache = null; sea.hidRev = (sea.hidRev || 0) + 1;
  if (!Object.keys(seasonHiddenMap()).length) sea.showHidden = false;   // 非表示の曲が無くなったら切り替えも戻す
  if (currentPage === 'seasons') { var y = window.scrollY; renderSeasonsPage(); window.scrollTo(0, y); }
  if (currentPage === 'settings') renderSetSeasonHidden();
  renderSidebarCounts();
}

/* ---------- 非表示にする・戻す ---------- */
function seasonHideSong(path) {
  if (!path || isSeasonHidden(path)) return;
  var t = library.byPath[path], name = t ? t.title : path;
  seasonHiddenMap()[path] = nowIso();
  saveDB();
  _seaHiddenChanged();
  showToast('「' + name + '」を Seasons Song で非表示にしました（ほかの画面・ファイルはそのままです）。', false,
    { label: '元に戻す', fn: function () { if (seasonUnhideSongs([path])) showToast('「' + name + '」を表示に戻しました。'); } });
}
// 戻す（戻した曲の数を返す）
function seasonUnhideSongs(paths) {
  var m = seasonHiddenMap(), n = 0;
  (paths || []).forEach(function (p) { if (Object.prototype.hasOwnProperty.call(m, p)) { delete m[p]; n++; } });
  if (!n) return 0;
  saveDB();
  _seaHiddenChanged();
  return n;
}
function seasonUnhideFromUi(path) {
  var t = library.byPath[path];
  if (seasonUnhideSongs([path])) showToast('「' + (t ? t.title : path) + '」を表示に戻しました。');
}
// 非表示の曲の表示切り替え（季節の見出しの「非表示の曲を表示」）
function toggleSeasonHiddenView(on) {
  sea.showHidden = typeof on === 'boolean' ? on : !sea.showHidden;
  var y = window.scrollY; renderSeasonsPage(); window.scrollTo(0, y);
}

/* ---------- tools の「Seasons Song の非表示の曲」 ---------- */
function renderSetSeasonHidden() {
  var el = document.getElementById('set-season-hidden');
  if (!el) return;
  var m = seasonHiddenMap(), paths = Object.keys(m);
  if (!paths.length) { el.innerHTML = '<p class="panel-meta">非表示の曲はありません。</p>'; return; }
  var list = paths.map(function (p) { var t = library.byPath[p]; return { path: p, title: t ? t.title : stripExt(p.split('/').pop()), artist: t ? (t.artist || '') : '', found: !!t, at: m[p] }; });
  list.sort(function (a, b) { return compareAlbumText(albumTextKey(a.title), albumTextKey(b.title)); });
  var h = '<p class="panel-meta">' + list.length + '曲</p><ul class="hidden-album-list">';
  list.forEach(function (x, i) {
    h += '<li><span class="hidden-album-name">' + escapeHtml(x.title) + '</span>' +
      '<span class="hidden-album-sub">' + escapeHtml(x.artist) + (x.at ? ' ・ ' + formatDateTime(x.at) : '') +
        (library.tracks.length && !x.found ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span>' +
      '<button class="btn-inline-small" data-sh-i="' + i + '">表示に戻す</button></li>';
  });
  h += '</ul><div class="btn-row"><button class="btn-inline-small" id="season-hidden-all">すべて表示に戻す</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-sh-i]').forEach(function (b) {
    b.addEventListener('click', function () { seasonUnhideFromUi(list[+b.getAttribute('data-sh-i')].path); });
  });
  document.getElementById('season-hidden-all').addEventListener('click', async function () {
    var ok = await showConfirm({ title: 'Seasons Song の非表示の曲をすべて表示に戻す', message: list.length + '曲を、Seasons Song の一覧に戻します（ファイルは変わりません）。', okText: 'すべて戻す' });
    if (!ok) return;
    var n = seasonUnhideSongs(list.map(function (x) { return x.path; }));
    showToast(n + '曲を表示に戻しました。');
  });
}

/* =========================================================
   25-navigation.js ― アルバムへのリンク・アーティストへのリンク・戻るボタン（v3.1）
   ・アルバムへのリンク／アーティストへのリンク：曲の行・再生バー・歌詞の見出しなどのアルバム名・アーティスト名。
       押すと、そのアルバムの曲一覧／そのアーティストの画面を開く（リンクの所だけ。行を押したときの再生の動きは変えない）。
       アーティストの画面の無い名前（タグが無くフォルダ名から推定した名前）は押せない。
       非表示のアルバム（v3.0）も開ける（見出しのボタンが「表示に戻す」になる）
   ・戻るボタン：各画面のヘッダーの左の「←」。アプリの中の画面の移動を覚えておき（保存しない）、ひとつ前の画面
       （画面・開いていたアルバム／アーティスト・スクロール位置）に戻る。ブラウザの戻る（Alt+←・マウスの戻るボタン）でも同じ
       （history.pushState で、アドレスは変えずに履歴だけ足す。file:// でも動く）
   ・画面の移動（showPage・openAlbum・openArtist・backToAlbumList・backToArtistList）はこのファイルで包んで、
     移動の前の状態を覚える。1回の操作の中で何度移動しても、覚えるのは最初の状態だけ
   ========================================================= */

/* ---------- アルバムへのリンク・アーティストへのリンク ---------- */
var _artistNames = { rev: -1, tracks: null, set: null };
// アーティストの画面がある名前（artist 画面のまとめ方と同じ：アルバムアーティスト → アーティスト）
function _artistNameSet() {
  if (_artistNames.tracks !== library.tracks || _artistNames.rev !== library.metaRev) {
    var s = new Set();
    library.tracks.forEach(function (t) { var n = artistNameOf(t); if (n) s.add(n); });
    _artistNames = { rev: library.metaRev, tracks: library.tracks, set: s };
  }
  return _artistNames.set;
}
// 曲のアーティスト名を押したときに開くアーティストの画面の名前（無ければ ''）
function artistLinkTarget(t) {
  if (!t || (!t.tagArtist && !t.tagAlbumArtist)) return '';   // タグが無い（フォルダ名から推定した）アーティストは押せない
  var names = _artistNameSet();
  if (t.tagArtist && names.has(t.tagArtist)) return t.tagArtist;
  var n = artistNameOf(t);   // コンピレーションで曲のアーティストの画面が無いときは、アルバムアーティストの画面
  return n && names.has(n) ? n : '';
}
function artistLinkHtml(t, text) {
  text = text == null ? (t ? t.artist : '') : text;
  if (!text) return '';
  var target = artistLinkTarget(t);
  if (!target) return escapeHtml(text);
  return '<a class="nav-link link-artist" href="#" data-go-artist="' + escapeHtml(target) + '" title="アーティスト「' + escapeHtml(target) + '」の画面を開く">' + escapeHtml(text) + '</a>';
}
function albumLinkHtml(t, text) {
  text = text == null ? (t ? t.album : '') : text;
  if (!text) return '';
  if (!t || !library.byPath[t.path]) return escapeHtml(text);
  return '<a class="nav-link link-album" href="#" data-go-album="' + escapeHtml(t.path) + '" title="アルバム「' + escapeHtml(text) + '」の曲一覧を開く">' + escapeHtml(text) + '</a>';
}
// 「アーティスト ・ アルバム」の1行（曲の下の小さな文字など）
function artistAlbumLinksHtml(t) {
  if (!t) return '';
  return [artistLinkHtml(t), albumLinkHtml(t)].filter(Boolean).join(' ・ ');
}
// アルバムの見出しのアーティスト：アルバムアーティスト、コンピレーションの「〇〇 ほか」は 〇〇 さんへ
function albumArtistLinkHtml(a) {
  if (!a || !a.artist) return '';
  var names = _artistNameSet();
  if (a.albumArtist) return names.has(a.albumArtist) ? _artistA(a.albumArtist, a.artist) : escapeHtml(a.artist);
  var first = a.tracks[0], target = artistLinkTarget(first);
  if (!target) return escapeHtml(a.artist);
  var m = a.artist.match(/^(.*) ほか$/);
  return m ? _artistA(target, m[1]) + ' ほか' : _artistA(target, a.artist);
}
function _artistA(target, text) {
  return '<a class="nav-link link-artist" href="#" data-go-artist="' + escapeHtml(target) + '" title="アーティスト「' + escapeHtml(target) + '」の画面を開く">' + escapeHtml(text) + '</a>';
}

// 押したとき：リンクの所だけを受け取り、行の再生などには伝えない（捕まえる段階で止める）
function goToAlbumOfTrack(path) {
  var t = library.byPath[path];
  if (!t) return;
  var key = albumKeyOf(t), albums = buildAlbums(), a = null;
  for (var i = 0; i < albums.length; i++) if (albums[i].key === key) { a = albums[i]; break; }
  if (!a) return;
  if (currentPage !== 'albums') showPage('albums');
  openAlbum(a);
}
function goToArtist(name) {
  if (!name) return;
  if (currentPage !== 'artists') showPage('artists');
  openArtist(name);
}
document.addEventListener('click', function (ev) {
  var a = ev.target.closest && ev.target.closest('[data-go-album],[data-go-artist]');
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (a.hasAttribute('data-go-album')) goToAlbumOfTrack(a.getAttribute('data-go-album'));
  else goToArtist(a.getAttribute('data-go-artist'));
}, true);
document.addEventListener('dblclick', function (ev) {   // リンクのダブルクリックで曲が再生されないように
  if (ev.target.closest && ev.target.closest('[data-go-album],[data-go-artist]')) { ev.preventDefault(); ev.stopPropagation(); }
}, true);

/* ---------- 戻るボタン（画面の移動の履歴） ---------- */
var NAV_MAX = 50;
// ブラウザの戻るで、ブラウザが自分でスクロール位置を戻さないようにする（このアプリが覚えた位置に戻す）
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* 無視 */ }
var nav = { stack: [], depth: 0, restoring: false, history: false, seq: 0, batch: false };
function _navSnapshot() {
  var s = { page: currentPage, scroll: window.scrollY };
  if (currentPage === 'albums') s.album = { key: albView.openKey, path: albView.openPath, ret: albView.ret, limit: albView.limit, showHidden: !!albView.showHidden };
  if (currentPage === 'artists') s.artist = { open: artistView.open, ret: artistView.ret, listScroll: artistView.listScroll };
  if (currentPage === 'library') s.lib = { limit: libView.limit };
  return s;
}
function _navKey(s) {
  return s.page + '|' + (s.album ? (s.album.key || '') + '|' + s.album.showHidden : '') + '|' + (s.artist ? (s.artist.open === null ? '\u0001' : s.artist.open) : '');
}
// 画面を移す関数を包む：移る前の状態を覚え、移った後に画面が変わっていれば履歴に足す
function _navWrap(name) {
  var orig = window[name];
  window[name] = function () {
    if (nav.restoring || nav.depth) { nav.depth++; try { return orig.apply(this, arguments); } finally { nav.depth--; } }
    var before = _navSnapshot();
    nav.depth++;
    var r;
    try { r = orig.apply(this, arguments); } finally { nav.depth--; }
    if (before.page && _navKey(before) !== _navKey(_navSnapshot())) _navPush(before);   // 起動したときの最初の画面は覚えない
    return r;
  };
}
['showPage', 'openAlbum', 'openArtist', 'backToAlbumList', 'backToArtistList'].forEach(_navWrap);

// 覚える：離れる前の状態 s に番号を付け、ブラウザの履歴にも同じ番号の項目を1つ足す（アドレスは変えない）
function _navPush(s) {
  // 1回の操作（同じクリックの中）で「画面を移す → アルバム・アーティストを開く」と続けて移っても、覚えるのは最初の状態だけ
  if (nav.batch) return;
  nav.batch = true;
  setTimeout(function () { nav.batch = false; }, 0);
  s.id = ++nav.seq;
  nav.stack.push(s);
  if (nav.stack.length > NAV_MAX) nav.stack.shift();
  try { history.pushState({ mmNav: s.id }, ''); nav.history = true; } catch (e) { nav.history = false; }
  renderNavBackButtons();
}
// 「戻る」ボタン：ブラウザの履歴と合わせるため、ブラウザの戻るを使う（使えないときは直接）
function navBackFromUi() {
  if (!nav.stack.length) return;
  if (nav.history) history.back(); else navBack();
}
function navBack() {
  var s = nav.stack.pop();
  if (!s) return;
  nav.restoring = true;
  try {
    if (s.page === 'albums' && s.album) {
      albView.openKey = s.album.key; albView.openPath = s.album.path; albView.ret = s.album.ret; albView.showHidden = s.album.showHidden;
    }
    if (s.page === 'artists' && s.artist) { artistView.open = s.artist.open; artistView.ret = s.artist.ret; artistView.listScroll = s.artist.listScroll || 0; }
    if (currentPage !== s.page) showPage(s.page);   // 別の画面に移ると、読み込んだ数が最初に戻るので、下で戻す
    if (s.album) albView.limit = Math.max(ALB_PAGE_SIZE, s.album.limit || 0);
    if (s.lib) libView.limit = Math.max(LIB_PAGE_SIZE, s.lib.limit || 0);
    renderCurrentPage();
    window.scrollTo(0, s.scroll || 0);
    requestAnimationFrame(function () { window.scrollTo(0, s.scroll || 0); });   // 描き終わってから、もう一度（高さが決まってから）
  } finally { nav.restoring = false; }
  renderNavBackButtons();
}
// ブラウザの戻る：戻った先の履歴の番号より新しく覚えた状態を、新しい順に戻す（最後に戻した状態が、戻った先の画面）。
//   進む・ページを開き直す前の履歴は、覚えている状態が無いので何もしない
window.addEventListener('popstate', function (ev) {
  var id = ev.state && typeof ev.state.mmNav === 'number' ? ev.state.mmNav : 0;
  while (nav.stack.length && nav.stack[nav.stack.length - 1].id > id) navBack();
});
// 各画面のヘッダーの「戻る」ボタン（履歴が無いときは押せない）
function renderNavBackButtons() {
  var none = !nav.stack.length;
  document.querySelectorAll('.nav-back-btn').forEach(function (b) { b.disabled = none; });
}
function initNavBackButtons() {
  document.querySelectorAll('.page .page-header').forEach(function (hd, i) {
    if (hd.querySelector('.nav-back-btn')) return;
    var w = document.createElement('span');
    w.className = 'nav-back-wrap';
    w.innerHTML = '<button class="btn-ghost-small btn-ghost-icon nav-back-btn" onclick="navBackFromUi()" title="ひとつ前の画面に戻る" aria-label="ひとつ前の画面に戻る" disabled>' + ICONS.back + '</button>' +
      '<span class="ui-label-tag ui-label-tag-ondark" style="top:-9px;left:-8px" onclick="copyUiLabel(\'戻るボタン\', event)" title="クリックで「戻るボタン」をコピー">□</span>';
    hd.insertBefore(w, hd.firstChild);
  });
  renderNavBackButtons();
}
initNavBackButtons();   // 各画面のヘッダーに「戻る」ボタンを足す（HTML はこのファイルより前にある）

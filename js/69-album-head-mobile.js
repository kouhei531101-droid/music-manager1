/* =========================================================
   69-album-head-mobile.js ― スマホ版：アルバムの見出しの Google検索ボタン・洋楽の指定ボタンの置き場所（スマホ版 v8.9.4）
   ・スマホ幅（760px 以下）のアルバムの見出しでは、アルバム名の右にある Google検索ボタン（.album-google-wrap）と
     洋楽の指定ボタン（.album-western-wrap。36-western.js）を、下のボタンの行（.btn-row）のフォルダを開くボタンの右へ移す
     （ボタンの要素ごと移すので、押したときの働き〔data-act="google"／"western"〕と色〔洋楽・手動の指定〕は変わらない）
   ・見た目（40px の丸）は style.css の「スマホ版 v8.9.2」のブロックの中（v8.9.4 の行）
   ・アルバムの見出しを描くたび（renderAlbumDetail のあと）に移す。見出しのタグボタン（64-card-menu.js）もここで足す
     （64 は renderAlbumsPage を包んでいるが、画面の描き直し〔PAGE_RENDERERS.albums〕は包む前の関数を呼ぶので、洋楽の指定などのあとにタグボタンが消えていた）。PC 幅との境目をまたいで幅が変わったら描き直す
   ========================================================= */

function albumHeadMobileNarrow() { return isMobileLayout(); }   // スマホ版 v8.10.1：横向きのスマホも（59-mobile.js）
function albumHeadMobileApply() {
  if (!albumHeadMobileNarrow()) return;
  var head = document.querySelector('#alb-body .album-head:not(.artist-head)');
  if (!head) return;
  var row = head.querySelector('.album-head-info .btn-row');
  if (!row) return;
  ['.album-google-wrap', '.album-western-wrap'].forEach(function (sel) {
    var w = head.querySelector('.album-head-title ' + sel);
    if (w) row.appendChild(w);   // フォルダを開くボタン（.album-folder-btns）のあとへ
  });
}
// アルバムの曲一覧を描いたあと（renderAlbumDetail。renderAlbumsPage の中から名前で呼ばれるので、画面の描き直し〔PAGE_RENDERERS〕のときも通る）
(function () {
  var f = window.renderAlbumDetail;
  if (typeof f !== 'function') return;
  window.renderAlbumDetail = function () { var r = f.apply(this, arguments); try { if (typeof renderHeadTagButton === 'function') renderHeadTagButton(); albumHeadMobileApply(); } catch (e) { console.warn(e); } return r; };
})();
// スマホ幅と PC 幅の境目をまたいだら、見出しを描き直す（PC 幅ではアルバム名の右に戻る）
(function () {
  var last = albumHeadMobileNarrow();
  window.addEventListener('resize', debounce(function () {
    var now = albumHeadMobileNarrow();
    if (now === last) return;
    last = now;
    if (typeof currentPage !== 'undefined' && currentPage === 'albums' && typeof albView !== 'undefined' && albView.current) renderAlbumsPage();
  }, 150));
})();

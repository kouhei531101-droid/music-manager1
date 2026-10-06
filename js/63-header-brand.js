/* =========================================================
   63-header-brand.js ― スマホ版：アプリ名と版を各画面のヘッダーの見出しの左に（スマホ版 v8.7.3）
   ・スマホ幅（760px 以下）では、サイドバーのロゴ（「MUSIC」と版。#app-version-label）を隠し、
     各画面のヘッダー（.page-header。album・artist・songs・playlist・設定 など全部）の見出しの左に
     「ヘッダーのアプリ名」（.hdr-brand：「MUSIC」と小さな版番号）を出す。ヘッダーのアイコン（.page-header-icon）は代わりに隠す
   ・版番号は 11-changelog.js の APP_VERSION（最新の版）から入れる（手で書かない）
   ・押すと「version」（バージョン管理＝更新履歴）の画面を開く
   ========================================================= */

function renderHeaderBrands() {
  document.querySelectorAll('.page .page-header').forEach(function (hd) {
    var h1 = hd.querySelector('h1');
    if (!h1) return;
    var b = hd.querySelector('.hdr-brand');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'hdr-brand';
      b.addEventListener('click', function () { if (typeof showPage === 'function') showPage('versions'); });
      h1.insertAdjacentElement('beforebegin', b);
    }
    var v = typeof APP_VERSION === 'string' ? APP_VERSION : '';
    b.innerHTML = '<span class="hdr-brand-title">Music</span><span class="hdr-brand-ver">' + escapeHtml(v) + '</span>';
    b.title = 'Music ' + v + '（押すと更新履歴）';
    b.setAttribute('aria-label', 'Music ' + v + '：更新履歴を開く');
  });
}
renderHeaderBrands();

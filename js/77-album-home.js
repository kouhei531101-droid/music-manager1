/* =========================================================
   77-album-home.js ― スマホ版：album を押したら、並べ替えなどはそのままでアルバム一覧に戻る（スマホ版 v8.12.1）
   ・下部メニューバー／ナビレール（66-bottom-nav.js）・サイドバーの「album」、album の画面のヘッダーの見出し「album」を押したとき：
       開いているアルバムの曲一覧を閉じて、album の一覧を出す（albumsHome。一覧から開いた曲一覧なら開いたカードの位置へ、それ以外は先頭へ）
       そのまま：並べ替え（標準・アルバム名・アーティスト・カスタム順・昇順／降順）・グループ（ソートキー・タグ・ジャンル・年代）・
                 検索・タグとジャンルの絞り込み・Pin のみ・非表示のアルバムの表示
       戻すもの：開いている曲一覧・スクロール位置・「さらに表示」の数・Pin の並べ替えモード
     （v8.1〜8.12 は、見出しの「album」を押すと 51-album-reset.js の resetAlbumsView で並べ替え・グループ・検索・絞り込みまで最初の状態に戻していた。
       メニューの album は並べ替えを保っていたが、曲一覧を開いていると一覧に戻らなかった）
   ・検索・絞り込みも残す理由：フィルターアイコンの点（.has-dot）で絞り込み中と分かり、「その他（…）」の「絞り込みを全部解除」で一度に戻せるため。
     画面を切り替えただけで消えると、もう一度入れ直す手間がかかる
   ・押したときの働きを capture で先に受けて、51 の resetAlbumsView・66 の showPage を止める（51・66 のファイルはそのまま）
   ========================================================= */

function albumsHome() {
  if (typeof albView === 'undefined') return;
  // album の画面で一覧から開いた曲一覧なら、PC版 v8.7.11 の showAlbumList と同じく、一覧の中の開いたカードの位置へ戻る
  if (currentPage === 'albums' && albView.openKey && albView.ret && albView.ret.page === 'albums' && typeof backToAlbumList === 'function') {
    albView.pinSorting = false;
    backToAlbumList();
    if (typeof syncBottomNav === 'function') syncBottomNav(false);
    return;
  }
  albView.openKey = null; albView.openPath = null; albView.ret = null;   // 曲一覧を閉じる
  albView.pinSorting = false;
  albView.limit = ALB_PAGE_SIZE;
  if (currentPage !== 'albums') showPage('albums');   // showPage が描いて先頭へ（下部メニューバーの強調も showPage の包みで合わせる）
  else {
    renderAlbumsPage();
    window.scrollTo(0, 0);
    if (typeof syncBottomNav === 'function') syncBottomNav(false);
  }
}

// メニューの「album」（下部メニューバー・ナビレール・サイドバー）
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('#bottom-nav .bnav-item[data-page="albums"], #sidebar .nav-item[data-page="albums"]');
  if (!b) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  albumsHome();
}, true);

// album の画面のヘッダーの見出し「album」（51-album-reset.js の「最初の状態に戻す」の代わり）
(function () {
  var h = document.querySelector('#page-albums .page-header h1');
  if (!h) return;
  var t = 'アルバム一覧の先頭に戻る（並べ替え・グループ・検索・絞り込みはそのまま）';
  h.title = t; h.setAttribute('aria-label', t);
  h.addEventListener('click', function (ev) { ev.stopImmediatePropagation(); albumsHome(); }, true);
  h.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopImmediatePropagation(); albumsHome(); } }, true);
})();

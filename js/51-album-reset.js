/* =========================================================
   51-album-reset.js ― album のタイトルで最初の状態に戻す（v8.1）
   ・album の画面のヘッダーのタイトル「album」（アルバムのタイトル）を押すと、並べ替え・検索・絞り込みなどを最初の状態に戻し、一覧の先頭を出す
     戻すもの：検索欄・並べ替え（標準＝アルバム名→アーティスト）・タグとジャンルの絞り込み・Pin のみ・Pin の並べ替え中・非表示のアルバムの切り替え・
              グループ（なし）・「さらに表示」の数・開いているアルバムの曲一覧
     消さないもの：カスタム順・Pin・ソートキーなどの保存データ（「自分で並べる」を選んでいても、選択を標準に戻すだけ）
   ・中央に置く CSS（.page-header h1 の pointer-events: none）は残し、album の h1 だけ押せるようにする（style.css の #page-albums .page-header h1）
   ========================================================= */

function resetAlbumsView() {
  albView.query = '';
  var s = document.getElementById('alb-search'); if (s) s.value = '';
  setAlbumSortSpec(albumSortStandardSpec());
  ui.albumTagFilter = ''; ui.albumGenreFilter = ''; saveUi();
  db.settings.albumPinOnly = false;
  db.settings.albumGroup = 'none';
  saveDB();
  albView.showHidden = false;
  albView.pinSorting = false;
  albView.openKey = null; albView.openPath = null; albView.ret = null;
  albView.limit = ALB_PAGE_SIZE;
  if (currentPage !== 'albums') showPage('albums');
  renderAlbumsPage();
  window.scrollTo(0, 0);
  showToast('album を最初の状態に戻しました');
}
(function () {
  var h = document.querySelector('#page-albums .page-header h1');
  if (!h) return;
  h.title = '最初の状態に戻す（並べ替え・検索・絞り込みを初期にして、一覧の先頭へ）';
  h.setAttribute('role', 'button');
  h.setAttribute('tabindex', '0');
  h.setAttribute('aria-label', 'album を最初の状態に戻す');
  h.addEventListener('click', resetAlbumsView);
  h.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); resetAlbumsView(); } });
})();

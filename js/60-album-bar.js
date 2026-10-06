/* =========================================================
   60-album-bar.js ― スマホ版：アルバムの曲一覧では再生バーを隠す（スマホ版 v8.7.1）
   ・album の画面でアルバムを開いている間（アルバムの曲一覧。albView.current がある）だけ、body に .alb-detail-open を付ける
   ・style.css（スマホ幅 760px 以下）：.alb-detail-open のときは再生バー（#player-bar）を出さず、--player-h を 0 にして
     本文の下の余白・歌詞パネル・トースト・スクロールボタンの位置も再生バーの分を詰める（最後の曲までスクロールで見える）
   ・再生は止めない（見た目だけ）。アルバム一覧・ほかの画面に移ると、今までどおり再生バーを出す
   ・きっかけ：showPage（画面の切り替え）と renderAlbumsPage（アルバムを開く・一覧に戻る・描き直し）のあと
   ========================================================= */

function syncAlbumDetailBar() {
  var on = typeof currentPage !== 'undefined' && currentPage === 'albums' && typeof albView !== 'undefined' && !!albView.current;
  document.body.classList.toggle('alb-detail-open', on);
}
['showPage', 'renderAlbumsPage'].forEach(function (name) {
  var f = window[name];
  if (typeof f !== 'function') return;
  window[name] = function () {
    var r = f.apply(this, arguments);
    try { syncAlbumDetailBar(); } catch (e) { console.warn(e); }
    return r;
  };
});

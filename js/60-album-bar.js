/* =========================================================
   60-album-bar.js ― スマホ版：album の画面では再生バーを隠す（スマホ版 v8.7.1。v8.7.5 からアルバム一覧でも）
   ・album の画面でアルバムを開いている間（アルバムの曲一覧。albView.current がある）だけ、body に .alb-detail-open を付ける
   ・style.css（スマホ幅 760px 以下）：.alb-detail-open のときは再生バー（#player-bar）を出さず、--player-h を 0 にして
     本文の下の余白・歌詞パネル・トースト・スクロールボタンの位置も再生バーの分を詰める（最後の曲までスクロールで見える）
   ・再生は止めない（見た目だけ）。スマホ版 v8.9.4：album だけでなく、全部の画面で再生バーを出さない
     （クラス名は前のまま .alb-detail-open。PC 幅〔761px 以上〕では style.css の指定が効かないので、今までどおり再生バー）。
     再生画面へは、左下の「再生中ボタン」（65-album-play-np.js）から
   ・きっかけ：showPage（画面の切り替え）と renderAlbumsPage（アルバムを開く・一覧に戻る・描き直し）のあと
   ========================================================= */

function syncAlbumDetailBar() {
  // v8.7.5：アルバムの曲一覧だけでなく、アルバム一覧（album の画面全部）でも再生バーを出さない
  // スマホ版 v8.9.4：全部の画面で出さない
  var on = true;
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

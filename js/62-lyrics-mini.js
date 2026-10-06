/* =========================================================
   62-lyrics-mini.js ― スマホ版：縮小した歌詞パネルを、歌詞があるときだけ出す（スマホ版 v8.7.2）
   ・スマホ幅で歌詞パネルを縮小しているとき（画面下の1行の帯）、今の曲に歌詞が無い（「歌詞が見つかりません」）・
     歌詞を探している途中（「歌詞を探しています…」）・曲を選んでいない（「曲を再生すると歌詞が表示されます」）ときは、帯ごと出さない
     （body に .lyr-mini-empty。style.css で帯を隠し、--lyr-bottom を 0 にして下の余白も詰める）
   ・歌詞が見つかった曲では、今までどおり帯に今の行を出す
   ・歌詞パネルを開いた（元の大きさ）ときは今までどおり：「歌詞が見つかりません。」と、歌詞の入力・Google で検索のボタンも出る。
     開くのは再生バーの「歌詞」ボタン
   ・15-lyrics.js の _updateLyricsMini（帯の文字を決める所）を包んで、そのたびに合わせる
   ========================================================= */

function syncLyricsMiniEmpty() {
  var has = !!(typeof lyr !== 'undefined' && lyr.path && lyr.result && lyr.result.source !== 'none');
  document.body.classList.toggle('lyr-mini-empty', !has);
}
(function () {
  var f = window._updateLyricsMini;
  if (typeof f !== 'function') return;
  window._updateLyricsMini = function () {
    var r = f.apply(this, arguments);
    try { syncLyricsMiniEmpty(); } catch (e) { console.warn(e); }
    return r;
  };
})();
document.addEventListener('DOMContentLoaded', syncLyricsMiniEmpty);
if (document.readyState !== 'loading') syncLyricsMiniEmpty();

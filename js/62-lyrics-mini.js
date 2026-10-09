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

/* ---------- スマホ版 v8.9.4：歌詞パネルの入口 ----------
   ・再生バーを全部の画面で出さなくなった（60-album-bar.js）ので、再生バーの「歌詞」ボタンの代わりに
     ① 再生画面の時間付き歌詞の場所：時間付きの歌詞が無い曲では「歌詞パネルを開く（入力・検索）」ボタンを出す。歌詞がある曲は、歌詞の行を押すと開く
     ② 再生中ボタンの長押し（65-album-play-np.js）
   ・開くときは再生画面を閉じてから、歌詞パネルを元の大きさに（歌詞の入力・Google で検索のボタンも今までどおり） */
function npOpenLyricsPanel() {
  var open = function () { if (typeof setLyricsCollapsed === 'function') setLyricsCollapsed(false); };
  if (typeof np !== 'undefined' && np.open && typeof closeNowPlaying === 'function') closeNowPlaying(open); else open();
}
(function () {
  var f = window._npLyricsUi;
  if (typeof f !== 'function') return;
  window._npLyricsUi = function () {
    var r = f.apply(this, arguments);
    try {
      var box = document.getElementById('np-lyrics');
      if (box && isMobileLayout() && box.querySelector('.np-lyr-none') && player.currentPath) {
        box.innerHTML = '<button type="button" class="np-lyr-panel-btn" id="np-lyr-panel-btn" title="歌詞パネルを開く（歌詞の入力・Google で検索）">' + ICONS.lyrics + '歌詞パネルを開く（入力・検索）</button>';
      }
    } catch (e) { console.warn(e); }
    return r;
  };
})();
document.addEventListener('click', function (ev) {
  if (!isMobileLayout() || !ev.target.closest) return;   // スマホ版 v8.10.1：横向きのスマホも
  if (ev.target.closest('#np-lyr-panel-btn')) { ev.preventDefault(); npOpenLyricsPanel(); return; }
  // スマホ版 v8.12.3：今の行を押したときは、歌詞パネルではなく「歌詞の重ね表示」（78-np-lyrics-over.js）を開く
  if (ev.target.closest('#now-playing .np-lyrics .np-lyr.active')) {
    ev.preventDefault();
    if (typeof npLyrOverOpen === 'function') npLyrOverOpen(); else npOpenLyricsPanel();
  }
});
if (document.readyState !== 'loading') syncLyricsMiniEmpty();

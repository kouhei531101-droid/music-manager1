/* =========================================================
   71-np-landscape.js ― スマホ版：再生画面の横向き（スマホ版 v8.10）
   ・スマホを横向きにしたとき（NP_LAND_MQ：横長で高さ 500px 以下・幅 1000px 以下）は、再生画面を
     「左の列」（メインのビジュアル・曲リスト）と「右の列」（上部のボタン列・曲名・操作）の2列にする
     （並べ方・大きさは style.css 末尾の「スマホ版 v8.10：再生画面の横向き」。条件の文字は CSS と同じにする）
   ・幅が 760px を超える横向き（812px・915px など）でも、68-np-onescreen.js の npOneNarrow() がスマホの扱いにする
     （曲リストボタンはスマホ幅だけの設定 ui.npListMobile・円の中心はメインのビジュアルの真ん中）
   ・再生画面に、横向きのときは class「np-land」を付ける
   ・向きを変えたとき（orientationchange・条件の切り替わり）は、少し待ってから resize を出し直す。
     キャンバスの大きさ（37）・ジャケットの並び（40）・曲リスト（50）・曲名の1行収め（55）・状態の class（68）は、それぞれの resize の処理で測り直す
     （端末によっては向きを変えた直後は画面の大きさがまだ古いので、2回出す）。回転CD・レコードの回転や再生はそのまま（止めない）
   ========================================================= */

var NP_LAND_MQ = '(orientation: landscape) and (max-height: 500px) and (max-width: 1000px)';
var _npLandMql = window.matchMedia ? window.matchMedia(NP_LAND_MQ) : null;

function npOneLand() { return !!(_npLandMql && _npLandMql.matches); }

// 横向きの class を付け外しする（68-np-onescreen.js の npOneSync のあとに）
function npLandSync() {
  var el = document.getElementById('now-playing');
  if (el) el.classList.toggle('np-land', npOneLand());
}
(function () {
  var f = window.npOneSync;
  if (typeof f !== 'function') return;
  window.npOneSync = function () {
    var r = f.apply(this, arguments);
    try { npLandSync(); } catch (e) { console.warn(e); }
    return r;
  };
})();

// 向きを変えたとき：少し待ってから測り直す
var _npLandTimers = [];
function npLandRelayout() {
  _npLandTimers.forEach(clearTimeout);
  _npLandTimers = [120, 450].map(function (ms) {
    return setTimeout(function () {
      if (typeof np !== 'undefined') np.vizAt = 0;   // 円の中心を測り直す
      npLandSync();
      window.dispatchEvent(new Event('resize'));
    }, ms);
  });
}
window.addEventListener('orientationchange', npLandRelayout);
if (_npLandMql) {
  if (_npLandMql.addEventListener) _npLandMql.addEventListener('change', npLandRelayout);
  else if (_npLandMql.addListener) _npLandMql.addListener(npLandRelayout);
}

/* =========================================================
   55-np-title-fit.js ― 再生画面の曲名を1行に収める（v8.3.4）
   ・再生画面・プレイリストの play画面の曲名（#np-title）は、いつも1行で出す（style.css で折り返さない）。
     入らないときは、実際の幅を測って文字を小さくする（元の大きさの 45% まで）。それでも入らなければ末尾を「…」で省略し、
     title（マウスを乗せると出る説明）で全文を見せる。短い曲名は元の大きさのまま（大きくはしない）
   ・測り直すとき：曲が変わった（npRender のあと）、曲名の幅が変わった（ResizeObserver。画面の幅・曲リストの出し入れ・
     回転CD の切り替え・スマホ幅との切り替えもこれで分かる）、文字の形（Webフォント）を読み終えたとき
   ========================================================= */

var NP_TITLE_MIN_RATIO = 0.45;   // 元の大きさに対して、ここまで小さくする
var nptf = { ro: null, lastW: -1, lastText: null, raf: 0 };

function npTitleFit() {
  var el = document.getElementById('np-title');
  if (!el || typeof np === 'undefined' || !np.open) return;
  var text = el.textContent || '';
  el.style.fontSize = '';                         // まず CSS の元の大きさに戻して測る
  var w = el.clientWidth;
  nptf.lastW = w; nptf.lastText = text;
  el.title = text;                                // 全文（省略したときも見える）
  if (!w || el.scrollWidth <= w + 1) return;      // 入っている（短い曲名はそのまま）
  var base = parseFloat(getComputedStyle(el).fontSize) || 30, min = Math.max(11, base * NP_TITLE_MIN_RATIO);
  var size = Math.max(min, Math.floor(base * w / el.scrollWidth * 10) / 10);
  el.style.fontSize = size + 'px';
  // 文字の幅は大きさにほぼ比例するが、ずれることがあるので、はみ出していれば少しずつ小さくする
  for (var i = 0; i < 12 && size > min && el.scrollWidth > w + 1; i++) {
    size = Math.max(min, size - Math.max(0.5, size * 0.03));
    el.style.fontSize = size + 'px';
  }
  // 最小でも入らないときは、CSS の text-overflow: ellipsis で「…」になる
}
function _nptfSchedule() {
  if (nptf.raf) return;
  nptf.raf = requestAnimationFrame(function () { nptf.raf = 0; npTitleFit(); });
}
function _nptfObserve() {
  var el = document.getElementById('np-title');
  if (!el || nptf.ro || typeof ResizeObserver === 'undefined') return;
  nptf.ro = new ResizeObserver(function () {
    // 幅が変わったときだけ（文字の大きさを変えると高さが変わって呼ばれるが、そのときは測り直さない）
    if (el.clientWidth !== nptf.lastW || el.textContent !== nptf.lastText) _nptfSchedule();
  });
  nptf.ro.observe(el);
}

// 再生画面を描いたあと（曲が変わった・開いた）に合わせる
(function () {
  var f = window.npRender;
  if (typeof f !== 'function') return;
  window.npRender = function () {
    var r = f.apply(this, arguments);
    try { _nptfObserve(); npTitleFit(); } catch (e) { console.warn(e); }
    return r;
  };
})();
window.addEventListener('resize', function () { if (typeof np !== 'undefined' && np.open) _nptfSchedule(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { _nptfSchedule(); });

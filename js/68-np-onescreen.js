/* =========================================================
   68-np-onescreen.js ― スマホ版：再生画面を「ひと画面」に（スマホ版 v8.9）
   ・スマホ幅（760px 以下）の再生画面は、縦にスクロールせずに
       上部のボタン列 → メインのビジュアル → 曲名 → アーティスト・アルバム → 再生元 →（時間付き歌詞）→ シークバー → 再生操作 → 音量
     が全部見えるように並べる（並べ方・大きさは style.css 末尾の「スマホ版 v8.9：再生画面をひと画面に」）
   ・メインのビジュアル：プレイヤー表示（54-spin-cd.js）が「ジャケット」ならジャケットの並び（40-coverflow.js）だけを、
     回転CD・カセット・レコード・MD ならそれだけを、残りの高さに収まる最大の大きさで真ん中に出す（上下に2つは並べない）
   ・曲リスト（再生画面のアルバムの曲リスト〔50-np-album.js〕・プレイリストの play画面のキュー〔39-playlist-play.js〕）：
     スマホ幅では「曲リスト」ボタンを押したときだけ、メインのビジュアルの場所に出す（リストの中だけスクロール）。
     出す・隠すはスマホ幅だけの設定 ui.npListMobile（初期は隠す）。PC 幅の設定 ui.npAlbumList は変えない
   ・再生画面に、今の状態を表す class を付ける：.np-one（スマホ幅）・.np-list-open（スマホ幅で曲リストを出している）
   ・ビジュアライザーの「円」：スマホ幅では、円の中心をメインのビジュアルの真ん中に合わせる（37-now-playing.js の _npVizCenter を包む）
   ========================================================= */

// スマホ版 v8.10：横向きのスマホ（71-np-landscape.js の npOneLand）も、幅が 760px を超えていてもスマホの扱い（曲リストボタン・円の中心）にする
function npOneNarrow() { return isMobileLayout() || (typeof npOneLand === 'function' && npOneLand()); }   // スマホ版 v8.10.1：59-mobile.js の isMobileLayout
function npListMobileOn() { return ui.npListMobile === true; }

// スマホ幅では、アルバムの曲リストを出すかどうかをスマホ幅だけの設定で決める
(function () {
  var f = window.npAlbumListOn;
  if (typeof f !== 'function') return;
  window.npAlbumListOn = function () {
    if (npOneNarrow()) return npListMobileOn();
    return f.apply(this, arguments);
  };
})();

// 曲リストボタン：スマホ幅ではスマホ幅だけの設定を切り替える（PC 幅は今までどおり 50-np-album.js）
document.addEventListener('click', function (ev) {
  var tg = ev.target.closest && ev.target.closest('#np-al-toggle');
  if (!tg || !npOneNarrow()) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  ui.npListMobile = !npListMobileOn(); saveUi();
  if (typeof npal !== 'undefined') npal.key = '';
  if (typeof npAlbumRender === 'function') npAlbumRender(true);
}, true);

// 状態の class と、プレイリストの play画面の曲リストボタンを合わせる
function npOneSync() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  var narrow = npOneNarrow(), pl = typeof np !== 'undefined' && !!np.plMode;
  var tg = document.getElementById('np-al-toggle');
  if (narrow && pl && tg) {
    // プレイリストの play画面でも、スマホ幅では曲リストボタンでキューを出す・隠す
    var on = npListMobileOn();
    tg.hidden = false;
    tg.classList.toggle('active', on); tg.setAttribute('aria-pressed', String(on));
    tg.title = on ? 'キューを隠す' : 'キューを出す';
  }
  var open = narrow && npListMobileOn() && (pl || el.classList.contains('np-al-mode'));
  el.classList.toggle('np-list-open', open);
  el.classList.toggle('np-one', narrow);
}
['npAlbumRender', 'spinCdApply'].forEach(function (name) {
  var f = window[name];
  if (typeof f !== 'function') return;
  window[name] = function () {
    var r = f.apply(this, arguments);
    try { npOneSync(); } catch (e) { console.warn(e); }
    return r;
  };
});
window.addEventListener('resize', debounce(function () {
  if (typeof np !== 'undefined' && np.open) { if (typeof npal !== 'undefined') npal.key = ''; if (typeof npAlbumRender === 'function') npAlbumRender(true); npOneSync(); }
}, 150));

// 「円」の中心：スマホ幅では、メインのビジュアル（ジャケットの並びは中央のジャケット、ほかは CD・カセット・レコード・MD の本体）の真ん中。
// 半径はジャケットなら一辺の 0.6 倍、ほかは短い辺の半分（ビジュアルの縁から線が伸びる）。曲リストを出しているとき・見えないときは今までどおり画面の真ん中
(function () {
  var f = window._npVizCenter;
  if (typeof f !== 'function') return;
  window._npVizCenter = function (cv) {
    if (!npOneNarrow()) return f.apply(this, arguments);
    var now = performance.now();
    if (np.vizAt && now - np.vizAt < 500) return np.vizC;
    np.vizAt = now; np.vizC = null;
    var el = document.getElementById('now-playing');
    if (!el || !cv.clientWidth || el.classList.contains('np-list-open')) return null;
    var jk = el.classList.contains('np-jacket-mode');
    var t = jk ? el.querySelector('.np-flow-item.is-center')
      : el.querySelector('.np-cd-mode .np-cd-disc, .np-cs-mode .np-cs-body, .np-rc-mode .np-rc-platter, .np-md-mode .np-md-body');
    if (!t) return null;
    var r = t.getBoundingClientRect(), cr = cv.getBoundingClientRect(), k = cv.width / cv.clientWidth;
    if (r.width < 1) return null;
    np.vizC = { x: (r.left + r.width / 2 - cr.left) * k, y: (r.top + r.height / 2 - cr.top) * k, r: (jk ? r.width * 0.6 : Math.min(r.width, r.height) / 2) * k };
    return np.vizC;
  };
})();

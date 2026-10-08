/* =========================================================
   73-np-viz-settings.js ― スマホ版：オーディオビジュアライザーの「描き方」の組み合わせと「描き方の設定」（スマホ版 v8.11）
   ・保存の形は PC版 v8.7.8（61-np-viz-settings.js）と同じ（バックアップを PC版 ⇔ スマホ版で持ち回せる）：
       db.settings.vizModes：['circle','bars','wave'] の一部（重ねる順は NVZ_ORDER。空の配列＝「なし」）
       db.settings.vizBars：'few' | 'normal' | 'many'（バーの数。円の線の本数も 48／96／144 本に連動）
       db.settings.vizThick：'thin' | 'normal' | 'thick'（バーと円の線の太さ。波形の線は変えない）
       db.settings.vizGlow：true | false（光：残像・光る先端・はじける粒。スマホ版は保存が無いときはオン〔v8.9.5〜8.10 の見た目のまま〕）
     古い ui.vizMode（1つの文字列）は、vizModes が無いとき1回だけ配列に直す（_nvzMigrate）。前の版に戻したときのため、ui.vizMode にも先頭を書く
   ・「なし」：キャンバスを隠し、描くループ（37 の _npStartLoop）も回さない
   ・描くのは 70-np-viz-trail.js（_npDraw。npVizCfg() を見て 円 → バー → 波形 → 光の粒 の順に重ねる）。
     メニューは 67-np-viz-menu.js（ⓘ の描き方ボタン・描き方メニュー）
   ========================================================= */

var NVZ_ORDER = ['circle', 'bars', 'wave'];        // 重ねる順（奥から）
var NVZ_LABEL = { bars: 'バー', wave: '波形', circle: '円' };
var NVZ_MENU_ORDER = ['bars', 'wave', 'circle'];   // メニューの並び
// バーの数：k はスマホ版の「ふつう」（キャンバスの幅 30 点に1本。375px 幅で 25本）に対する倍率。circ は円の線の本数
var NVZ_BARS = { few: { label: '少ない', k: 0.5, min: 7, max: 28, circ: 48 }, normal: { label: 'ふつう', k: 1, min: 14, max: 56, circ: 96 }, many: { label: '多い', k: 1.6, min: 22, max: 90, circ: 144 } };
// 太さ：bar はバーの幅（1本分の場所に対する割合。スマホ版の「ふつう」は 0.74）、line は円の線の太さの倍率
var NVZ_THICK = { thin: { label: '細い', bar: 0.45, line: 0.6 }, normal: { label: 'ふつう', bar: 0.74, line: 1 }, thick: { label: '太い', bar: 0.9, line: 1.7 } };

/* ---------- 設定 ---------- */
// 古い ui.vizMode（'bars'|'wave'|'circle'）→ db.settings.vizModes（配列）。直したら true
function _nvzMigrate() {
  var s = db.settings;
  if (Array.isArray(s.vizModes)) return false;
  var m = typeof ui !== 'undefined' ? ui.vizMode : null;
  s.vizModes = NVZ_LABEL[m] ? [m] : ['bars'];
  return true;
}
function npVizCfg() {
  if (_nvzMigrate()) saveDB();
  var s = db.settings;
  var modes = NVZ_ORDER.filter(function (k) { return s.vizModes.indexOf(k) >= 0; });
  return { modes: modes, bars: NVZ_BARS[s.vizBars] ? s.vizBars : 'normal', thick: NVZ_THICK[s.vizThick] ? s.vizThick : 'normal', glow: s.vizGlow !== false };
}
function npVizModes() { return npVizCfg().modes; }
// 変える（patch：{ modes, bars, thick, glow } の一部）
function setNpViz(patch) {
  _nvzMigrate();
  var s = db.settings;
  if (patch.modes) s.vizModes = NVZ_ORDER.filter(function (k) { return patch.modes.indexOf(k) >= 0; });
  if (patch.bars && NVZ_BARS[patch.bars]) s.vizBars = patch.bars;
  if (patch.thick && NVZ_THICK[patch.thick]) s.vizThick = patch.thick;
  if (typeof patch.glow === 'boolean') s.vizGlow = patch.glow;
  saveDB();
  ui.vizMode = s.vizModes.length ? NVZ_MENU_ORDER.filter(function (k) { return s.vizModes.indexOf(k) >= 0; })[0] : 'bars'; saveUi();   // 前の版との互換
  if (!npVizCfg().glow && typeof _npvSparksClear === 'function') _npvSparksClear();
  if (typeof _npModesUi === 'function') _npModesUi();
  _nvzApplyRunning();
}
// 「なし」なら描くのをやめてキャンバスを消す。何か選んでいれば（再生画面を開いていれば）描き始める
function _nvzApplyRunning() {
  var cv = document.getElementById('np-viz');
  var none = !npVizModes().length;
  if (cv) cv.hidden = none;
  if (none) {
    if (typeof _npStopLoop === 'function') _npStopLoop();
    if (cv && cv.width) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    if (typeof _npvSparksClear === 'function') _npvSparksClear();
  } else if (typeof np !== 'undefined' && np.open) { _npSizeCanvas(); _npStartLoop(); }
}
// 37 の npMode()（1つだけの描き方）も、いちばん手前の描き方を返す（ほかから使われても困らないように。「なし」は 'none'）
window.npMode = function () { var m = npVizModes(); return m.length ? m[m.length - 1] : 'none'; };
// 今の組み合わせの名前（例「バー＋波形」。なしは「なし」）
function npVizSummary() {
  var m = npVizModes();
  if (!m.length) return 'なし';
  return NVZ_MENU_ORDER.filter(function (k) { return m.indexOf(k) >= 0; }).map(function (k) { return NVZ_LABEL[k]; }).join('＋');
}

// 「なし」のときは描くループを回さない（37 の _npStartLoop を包む）
(function () {
  var start = window._npStartLoop;
  if (typeof start === 'function') window._npStartLoop = function () { if (!npVizModes().length) { _nvzApplyRunning(); return; } return start.apply(this, arguments); };
})();

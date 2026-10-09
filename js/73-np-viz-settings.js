/* =========================================================
   73-np-viz-settings.js ― スマホ版：オーディオビジュアライザーの「描き方」の組み合わせと「描き方の設定」（スマホ版 v8.11）
   ・保存の形は PC版 v8.7.8（61-np-viz-settings.js）と同じ（バックアップを PC版 ⇔ スマホ版で持ち回せる）：
       db.settings.vizModes：['circle','bars','wave'] の一部（重ねる順は NVZ_ORDER。空の配列＝「なし」）
       db.settings.vizBars：'few' | 'normal' | 'many'（バーの数。円の線の本数も 48／96／144 本に連動）
       db.settings.vizThick：'thin' | 'normal' | 'thick'（バーと円の線の太さ。波形の線は変えない）
       db.settings.vizGlow：true | false（光：残像・光る先端・はじける粒。スマホ版は保存が無いときはオン〔v8.9.5〜8.10 の見た目のまま〕）
       光の調整（スマホ版 v8.11.1。PC版と同じ）：db.settings.vizGlowAmt（光の量 0〜200）・vizSparkAmt（粒の数 0〜200）・
         vizSparkHeight（はじける高さ 50〜200）・vizTrailAmt（残像の長さ 0〜200）。単位は %、保存が無いときは 100。光がオンのときだけ効く
     古い ui.vizMode（1つの文字列）は、vizModes が無いとき1回だけ配列に直す（_nvzMigrate）。前の版に戻したときのため、ui.vizMode にも先頭を書く
   ・「なし」：キャンバスを隠し、描くループ（37 の _npStartLoop）も回さない
   ・描くのは 70-np-viz-trail.js（_npDraw。npVizCfg() を見て 円 → バー → 波形 → 光の粒 の順に重ねる）。
     メニューは 67-np-viz-menu.js（ⓘ の描き方ボタン・描き方メニュー）
   ========================================================= */

// スマホ版 v8.12：描き方を12種類ふやした（75-np-viz-more.js。ID は PC版と同じ）。知らない ID は読み込みで捨てる（NVZ_ORDER にあるものだけ）
var NVZ_ORDER = ['hills', 'blob', 'pulse', 'circle', 'ring', 'orbs', 'ribbon', 'mirror', 'bars', 'led', 'updown', 'lines', 'dotwave', 'wave', 'neon'];   // 重ねる順（奥から。PC版 v8.7.10 と同じ）
var NVZ_LABEL = { bars: 'バー', wave: '波形', circle: '円', blob: 'ブロブ', mirror: '上下対称', ribbon: '色の波', hills: '塗りの山', dotwave: 'ドット波', pulse: 'パルス',
  led: 'LED', orbs: '光る粒', neon: 'ネオン', ring: 'リング', updown: '上下バー', lines: '波線' };
// 正式な名前（DESIGN.md・title）
var NVZ_NAME = { bars: 'バー', wave: '波形', circle: '円', blob: '波打つブロブ', mirror: '上下対称バー', ribbon: '重なる色の波', hills: '塗りの山', dotwave: 'ドット波',
  pulse: '同心円パルス', led: 'LEDバー', orbs: '光る粒', neon: 'ネオン波形', ring: '揺れるリング', updown: '上下バー', lines: '平行の波線' };
var NVZ_MENU_ORDER = ['bars', 'wave', 'circle', 'blob', 'mirror', 'ribbon', 'hills', 'dotwave', 'pulse', 'led', 'orbs', 'neon', 'ring', 'updown', 'lines'];   // メニューの並び
var NVZ_MAX = 4;   // 同時に重ねられる数（PC版 v8.7.10 と同じ4つまで。保存に5つ以上あれば、重ねる順の先頭から4つだけ残す。スマホでも4つ重ねて描く時間は数 ms）
// バーの数：k はスマホ版の「ふつう」（キャンバスの幅 30 点に1本。375px 幅で 25本）に対する倍率。circ は円の線の本数
var NVZ_BARS = { few: { label: '少ない', k: 0.5, min: 7, max: 28, circ: 48 }, normal: { label: 'ふつう', k: 1, min: 14, max: 56, circ: 96 }, many: { label: '多い', k: 1.6, min: 22, max: 90, circ: 144 } };
// 太さ：bar はバーの幅（1本分の場所に対する割合。スマホ版の「ふつう」は 0.74）、line は円の線の太さの倍率
var NVZ_THICK = { thin: { label: '細い', bar: 0.45, line: 0.6 }, normal: { label: 'ふつう', bar: 0.74, line: 1 }, thick: { label: '太い', bar: 0.9, line: 1.7 } };
// 光の調整（スマホ版 v8.11.1）：key＝db.settings の名前、prop＝npVizCfg() の名前、min・max（%）。既定はどれも 100
var NVZ_TUNE = [
  { key: 'vizGlowAmt', prop: 'glowAmt', label: '光の量', min: 0, max: 200, help: '先端の輝き・にじみ・尾の明るさ' },
  { key: 'vizSparkAmt', prop: 'sparkAmt', label: '粒の数', min: 0, max: 200, help: 'はじける粒・落ちながら出る粒の量（0 で粒なし）' },
  { key: 'vizSparkHeight', prop: 'sparkHeight', label: 'はじける高さ', min: 50, max: 200, help: '強く鳴ったときに粒が届く高さ' },
  { key: 'vizTrailAmt', prop: 'trailAmt', label: '残像の長さ', min: 0, max: 200, help: 'ピークが落ちる速さ・尾の残り方（0 で残像なし）' }
];
// 光の飛び方（スマホ版 v8.12.2。PC版と同じ）：db.settings.vizSparkStyle。円の粒だけに効く。無い・知らない値は 'fall'
// 曲に合わせて広がる（スマホ版 v8.12.2。PC版と同じ）：db.settings.vizGrow（true/false。既定 false）・vizGrowAmt（広がり方 0〜200%。既定 100）
var NVZ_GROW_T = { key: 'vizGrowAmt', prop: 'growAmt', label: '広がり方', min: 0, max: 200, help: '曲の始めと終わりの大きさの差' };
var NVZ_SPARK_STYLE = { fall: { label: '花火' }, ray: { label: '放射の粒' }, beam: { label: '光の筋' } };
function _nvzTuneVal(t, v) { v = Math.round(+v); return isFinite(v) ? Math.max(t.min, Math.min(t.max, v)) : 100; }

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
  if (modes.length > NVZ_MAX) modes = modes.slice(0, NVZ_MAX);   // v8.12：5つ以上は重ねる順の先頭4つだけ
  var cfg = { modes: modes, bars: NVZ_BARS[s.vizBars] ? s.vizBars : 'normal', thick: NVZ_THICK[s.vizThick] ? s.vizThick : 'normal', glow: s.vizGlow !== false };
  NVZ_TUNE.forEach(function (t) { cfg[t.prop] = s[t.key] == null ? 100 : _nvzTuneVal(t, s[t.key]); });   // 光の調整（v8.11.1）
  cfg.sparkStyle = NVZ_SPARK_STYLE[s.vizSparkStyle] ? s.vizSparkStyle : 'fall';   // 光の飛び方（v8.12.2）
  cfg.grow = s.vizGrow === true; cfg.growAmt = s.vizGrowAmt == null ? 100 : _nvzTuneVal(NVZ_GROW_T, s.vizGrowAmt);   // 曲に合わせて広がる（v8.12.2）
  return cfg;
}
function npVizModes() { return npVizCfg().modes; }
// 変える（patch：{ modes, bars, thick, glow } の一部）
function setNpViz(patch) {
  _nvzMigrate();
  var s = db.settings;
  if (patch.modes) s.vizModes = NVZ_ORDER.filter(function (k) { return patch.modes.indexOf(k) >= 0; }).slice(0, NVZ_MAX);   // 知らない ID は捨て、4つまで
  if (patch.bars && NVZ_BARS[patch.bars]) s.vizBars = patch.bars;
  if (patch.thick && NVZ_THICK[patch.thick]) s.vizThick = patch.thick;
  if (typeof patch.glow === 'boolean') s.vizGlow = patch.glow;
  NVZ_TUNE.forEach(function (t) { if (patch[t.prop] != null) s[t.key] = _nvzTuneVal(t, patch[t.prop]); });   // 光の調整（v8.11.1）
  if (typeof patch.grow === 'boolean') s.vizGrow = patch.grow;   // 曲に合わせて広がる（v8.12.2）
  if (patch.growAmt != null) s.vizGrowAmt = _nvzTuneVal(NVZ_GROW_T, patch.growAmt);
  if (patch.sparkStyle) s.vizSparkStyle = NVZ_SPARK_STYLE[patch.sparkStyle] ? patch.sparkStyle : 'fall';   // 光の飛び方（v8.12.2）
  saveDB();
  ui.vizMode = ['bars', 'wave', 'circle'].filter(function (k) { return s.vizModes.indexOf(k) >= 0; })[0] || 'bars'; saveUi();   // 前の版との互換（前の版が知っている3種類だけ）
  if (!npVizCfg().glow && typeof _npvSparksClear === 'function') _npvSparksClear();
  if (typeof _npModesUi === 'function') _npModesUi();
  _nvzApplyRunning();
}
// 光の調整のスライダーを動かしている間（スマホ版 v8.11.1）：値だけを変えて保存し、メニューは書き直さない（指の下のスライダーが入れ替わらないように）。
// 保存（saveDB）は指を離したとき（save = true）だけ
function setNpVizTune(prop, value, save) {
  var t = NVZ_TUNE.concat([NVZ_GROW_T]).filter(function (x) { return x.prop === prop; })[0];   // v8.12.2：広がり方のスライダーも
  if (!t) return;
  _nvzMigrate();
  db.settings[t.key] = _nvzTuneVal(t, value);
  if (save) saveDB();
}
// 光の調整を全部 100% に戻す
function resetNpVizTune() {
  var p = {};
  NVZ_TUNE.forEach(function (t) { p[t.prop] = 100; });
  setNpViz(p);
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
window.npMode = function () { var m = npVizModes(); var x = m.length ? m[m.length - 1] : 'none'; return { bars: 1, wave: 1, circle: 1 }[x] || x === 'none' ? x : 'bars'; };   // 37 は3種類しか知らないので、新しい描き方は 'bars' と答える
// 今の組み合わせの名前（例「バー＋波形」。なしは「なし」）
function npVizSummary() {
  var m = npVizModes();
  if (!m.length) return 'なし';
  var names = NVZ_MENU_ORDER.filter(function (k) { return m.indexOf(k) >= 0; }).map(function (k) { return NVZ_NAME[k]; });
  return names.length >= 3 ? names.slice(0, 2).join('＋') + '＋ほか' + (names.length - 2) : names.join('＋');   // 3つ以上は「バー＋ネオン波形＋ほか2」
}

// 「なし」のときは描くループを回さない（37 の _npStartLoop を包む）
(function () {
  var start = window._npStartLoop;
  if (typeof start === 'function') window._npStartLoop = function () { if (!npVizModes().length) { _nvzApplyRunning(); return; } return start.apply(this, arguments); };
})();

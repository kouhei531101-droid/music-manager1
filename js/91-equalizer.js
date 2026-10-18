/* =========================================================
   91-equalizer.js ― スマホ版：「音質ボタン」と「音質パネル」（イコライザー。スマホ版 v8.24.0）
   ・音の通り道（37-now-playing.js の _npEnsureAudioGraph から eqBuildChain を呼ぶ。createMediaElementSource は 37 で1回だけ）
       audio 要素 → 10本のフィルター（BiquadFilterNode を直列）→ プリアンプ（GainNode）→ スピーカー
                                     └→ ビジュアライザー（AnalyserNode。プリアンプの前から見る）
     audio 要素はアプリに1つだけ（#audio-player。曲の切り替えも同じ要素。クロスフェードは無い）なので、全部の曲に効く
   ・バンド：60Hz（lowshelf）・170・310・600・1k・3k・6k・12k・14k（peaking。Q 1.2）・16kHz（highshelf）
   ・プリセット（db.settings.eqPreset）：flat フラット／heavy ヘビー／rock ロック／pop ポップ／bass 低音強調／vocal ボーカル／
     jazz ジャズ／classical クラシック／dance ダンス。無い・知らない値（古いバックアップ・PC版のバックアップ）は flat
   ・プリアンプ（全体の音量）：選んだプリセットの「10本を合わせた周波数特性」をフィルターと同じ式で計算し、いちばん持ち上がる量だけ下げる
     （音割れ〔クリップ〕を防ぐ。最大 −12dB）。フラットは 0dB（フィルターのゲインも全部 0 で素通しと同じ）
   ・切り替え：ゲインは setTargetAtTime（時定数 0.04秒）でなめらかに変える（プツッという音を防ぐ）
   ・音の通り道を作るのは、①再生画面を開いたとき（今まで通り）、②フラット以外を選んでいて、利用者が画面を触ったあとの再生のとき
     （画面が隠れている間・まだ一度も触っていないときは作らない。AudioContext が止まったままだと音が出なくなるため）
   ・AudioContext が止まっていたら、再生のたび（37）と画面を触ったとき（ここ）に resume する
   ・保存は db.settings（バックアップに入る。復元のあとは eqAfterRestore で合わせる）
   ========================================================= */

var EQ_BANDS = [
  { f: 60, type: 'lowshelf', label: '60' }, { f: 170, type: 'peaking', label: '170' }, { f: 310, type: 'peaking', label: '310' },
  { f: 600, type: 'peaking', label: '600' }, { f: 1000, type: 'peaking', label: '1k' }, { f: 3000, type: 'peaking', label: '3k' },
  { f: 6000, type: 'peaking', label: '6k' }, { f: 12000, type: 'peaking', label: '12k' }, { f: 14000, type: 'peaking', label: '14k' },
  { f: 16000, type: 'highshelf', label: '16k' }
];
var EQ_Q = 1.2;          // peaking の幅
var EQ_TC = 0.04;        // 切り替えのなめらかさ（setTargetAtTime の時定数・秒）
var EQ_PRE_MAX = 12;     // プリアンプで下げる最大（dB）
// プリセット（dB。上の10バンドの順）。Winamp・Android の標準イコライザーの値を参考に、やりすぎない量にした。
//   12k・14k・16k は近くて重なる（合わせると足し算で大きくなる）ので、高音は控えめの値にしている
var EQ_PRESETS = [
  { id: 'flat',      name: 'フラット',   desc: 'イコライザーなし（素通し）', g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'heavy',     name: 'ヘビー',     desc: 'ヘビーメタル：重い低音と、ギターの歪み・シンバルの抜け', g: [6, 4, 0, -2, 0, 3, 4, 2, 1, 1] },
  { id: 'rock',      name: 'ロック',     desc: '低音と高音を上げ、中音を少し下げる', g: [5, 3, -2, -3, -1, 2, 4, 3, 2, 2] },
  { id: 'pop',       name: 'ポップ',     desc: '中低音〜中音（声）を前に', g: [-1, 2, 3, 3, 2, 0, -1, -1, -1, -1] },
  { id: 'bass',      name: '低音強調',   desc: 'ベース・バスドラムを強く', g: [6, 5, 2, 1, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal',     name: 'ボーカル',   desc: '声のあたり（1k〜3k）を上げ、低音を少し下げる', g: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1] },
  { id: 'jazz',      name: 'ジャズ',     desc: 'あたたかい低音と、やわらかく伸びる高音', g: [3, 2, 1, 2, -1, -1, 0, 1, 1, 2] },
  { id: 'classical', name: 'クラシック', desc: '低音と高音を少し、中音は自然に', g: [4, 3, 1, -1, -2, 0, 2, 2, 1, 1] },
  { id: 'dance',     name: 'ダンス',     desc: '強い低音と、明るい高音', g: [6, 4, 2, 0, -1, 0, 2, 2, 1, 1] }
];
var eqSt = { filters: null, pre: null, ctx: null };

/* ---------- 設定 ---------- */
function eqPresetOf(id) { return EQ_PRESETS.filter(function (p) { return p.id === id; })[0] || EQ_PRESETS[0]; }
// 今の音質の ID（無い・知らない値はフラット）
function eqPresetId(s) { s = s || (typeof db !== 'undefined' && db.settings) || {}; return eqPresetOf(s.eqPreset).id; }
function eqPresetName(s) { return eqPresetOf(eqPresetId(s)).name; }

/* ---------- 周波数特性の計算（Web Audio のフィルターと同じ式。プリアンプとグラフに使う） ---------- */
var EQ_FS = 48000;
function _eqCoef(type, f0, gainDb) {
  var A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / EQ_FS, c = Math.cos(w0), s = Math.sin(w0), b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    var al = s / (2 * EQ_Q);
    b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
  } else {
    var sq = 2 * Math.sqrt(A) * (s / 2 * Math.SQRT2);   // 2√A・α（傾き S = 1）
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq);
      a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq;
    } else {
      b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq);
      a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq;
    }
  }
  return [b0, b1, b2, a0, a1, a2];
}
function _eqMagDb(co, f) {
  var w = 2 * Math.PI * f / EQ_FS, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  var nr = co[0] + co[1] * c1 + co[2] * c2, ni = -(co[1] * s1 + co[2] * s2);
  var dr = co[3] + co[4] * c1 + co[5] * c2, di = -(co[4] * s1 + co[5] * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
var EQ_GRID = (function () { var a = []; for (var i = 0; i < 120; i++) a.push(20 * Math.pow(1000, i / 119)); return a; })();   // 20Hz〜20kHz
var _eqCurveCache = {};
// 10本を合わせた特性（dB の並び。EQ_GRID の周波数ごと）
function eqCurve(id) {
  if (_eqCurveCache[id]) return _eqCurveCache[id];
  var p = eqPresetOf(id), cos = EQ_BANDS.map(function (b, i) { return _eqCoef(b.type, b.f, p.g[i]); });
  var out = EQ_GRID.map(function (f) { return cos.reduce(function (sum, co) { return sum + _eqMagDb(co, f); }, 0); });
  return (_eqCurveCache[id] = out);
}
// プリアンプ（dB。0 以下）：いちばん持ち上がる量だけ下げる
function eqPreampDb(id) {
  var mx = Math.max.apply(null, eqCurve(id));
  return mx > 0.05 ? -Math.min(EQ_PRE_MAX, Math.round(mx * 10) / 10) : 0;
}

/* ---------- 音の通り道 ---------- */
// 37 の _npEnsureAudioGraph から1回だけ呼ばれる。src（MediaElementSource）→ フィルター10本 → プリアンプ。
// 戻り値：{ out: スピーカーへつなぐ所, viz: ビジュアライザーへつなぐ所 }
function eqBuildChain(ctx, src) {
  if (!ctx || !src || !ctx.createBiquadFilter) return null;
  var p = eqPresetOf(eqPresetId());
  // 先に全部作ってから（途中で失敗しても src は何にもつながっていない）つなぐ
  var filters = EQ_BANDS.map(function (b, i) {
    var f = ctx.createBiquadFilter();
    f.type = b.type; f.frequency.value = b.f; if (b.type === 'peaking') f.Q.value = EQ_Q;
    f.gain.value = p.g[i];
    return f;
  });
  var pre = ctx.createGain();
  pre.gain.value = Math.pow(10, eqPreampDb(p.id) / 20);
  src.connect(filters[0]);
  for (var i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i]);
  filters[filters.length - 1].connect(pre);
  eqSt.filters = filters; eqSt.pre = pre; eqSt.ctx = ctx;
  return { out: pre, viz: filters[filters.length - 1] };
}
// 今の設定をフィルターに入れる（なめらかに）
function eqApply() {
  if (!eqSt.filters || !eqSt.ctx) return;
  var p = eqPresetOf(eqPresetId()), t = eqSt.ctx.currentTime;
  var go = function (param, v) {
    try { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.setTargetAtTime(v, t, EQ_TC); }
    catch (e) { param.value = v; }
  };
  eqSt.filters.forEach(function (f, i) { go(f.gain, p.g[i]); });
  go(eqSt.pre.gain, Math.pow(10, eqPreampDb(p.id) / 20));
}
// フラット以外を選んでいるのに音の通り道がまだ無いとき、作る（利用者が画面を触ったあと・画面が見えているときだけ）
function _eqEnsureGraph() {
  if (eqPresetId() === 'flat' || (typeof np !== 'undefined' && np.ctx)) return;
  if (document.hidden || typeof _npEnsureAudioGraph !== 'function' || typeof player === 'undefined' || !player.audio) return;
  var ua = navigator.userActivation;
  if (!ua || !ua.hasBeenActive) return;   // まだ一度も触っていない（自動再生の決まりで AudioContext が動かないことがある）
  _npEnsureAudioGraph();
}

/* ---------- 選ぶ ---------- */
function setEqPreset(id) {
  var p = eqPresetOf(id);
  db.settings.eqPreset = p.id;
  saveDB();
  _eqEnsureGraph();
  if (typeof _npResume === 'function') _npResume();   // 押した操作のあとなので、止まっていれば動かす
  eqApply();
  eqBtnUi();
  eqRenderPanel();
}
// 復元のあと（10-settings-backup.js から）：古いバックアップは eqPreset が無いのでフラット
function eqAfterRestore() { eqApply(); eqBtnUi(); }

/* ---------- 音質ボタン（再生画面の音量の行の右端。#np-eq-btn） ---------- */
var EQ_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<line x1="5" y1="4" x2="5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="20"/>' +
  '<rect x="2.5" y="12" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="6.5" width="5" height="3" rx="1" fill="currentColor"/><rect x="16.5" y="14" width="5" height="3" rx="1" fill="currentColor"/></svg>';
function _eqEnsureBtn() {
  var host = document.getElementById('now-playing');
  if (!host || document.getElementById('np-eq-btn')) return;
  var row = host.querySelector('.np-volume');
  if (!row) return;
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'np-btn np-btn-sm np-eq-btn';
  b.id = 'np-eq-btn';
  b.setAttribute('aria-haspopup', 'dialog');
  b.innerHTML = EQ_ICON;
  b.addEventListener('click', function () { openEqPanel(); });
  row.appendChild(b);
  eqBtnUi();
}
function eqBtnUi() {
  var b = document.getElementById('np-eq-btn');
  if (!b) return;
  var id = eqPresetId(), on = id !== 'flat';
  b.classList.toggle('active', on);
  b.title = '音質：' + eqPresetName();
  b.setAttribute('aria-label', '音質を選ぶ（今：' + eqPresetName() + '）');
}

/* ---------- 音質パネル（ダイアログ） ---------- */
// 特性のグラフ（SVG。横は 20Hz〜20kHz の対数、縦は ±9dB）。big：パネルの上の大きいグラフ
function _eqCurveSvg(id, big) {
  var W = big ? 300 : 64, H = big ? 90 : 26, R = 9;   // R：上下 ±9dB を枠いっぱいに
  var c = eqCurve(id), pts = c.map(function (d, i) {
    var x = i / (c.length - 1) * W, y = H / 2 - Math.max(-R, Math.min(R, d)) / R * (H / 2 - 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var h = '<svg class="eq-curve' + (big ? ' eq-curve-big' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" class="eq-zero"/>';
  return h + '<polyline points="' + pts + '" class="eq-line"/></svg>';
}
function _eqPanelHtml() {
  var cur = eqPresetOf(eqPresetId()), pre = eqPreampDb(cur.id);
  var ok = !!(window.AudioContext || window.webkitAudioContext);
  var h = '<div class="eq-now"><span class="eq-now-label">今の音質</span><strong class="eq-now-name">' + escapeHtml(cur.name) + '</strong>' +
    '<span class="eq-now-pre">' + (pre ? 'プリアンプ ' + pre.toFixed(1) + 'dB' : 'イコライザーなし') + '</span></div>' +
    '<div class="eq-now-desc">' + escapeHtml(cur.desc) + '</div>' +
    '<div class="eq-graph">' + _eqCurveSvg(cur.id, true) +
      '<div class="eq-graph-labels">' + EQ_BANDS.map(function (b, i) {
        var g = cur.g[i];
        return '<span class="' + (g > 0 ? 'is-up' : g < 0 ? 'is-down' : '') + '"><b>' + (g > 0 ? '+' : '') + g + '</b>' + b.label + '</span>';
      }).join('') + '</div></div>' +
    '<div class="eq-chips" role="radiogroup" aria-label="音質のプリセット">' + EQ_PRESETS.map(function (p) {
      var on = p.id === cur.id;
      return '<button type="button" class="eq-chip' + (on ? ' is-cur' : '') + '" role="radio" aria-checked="' + on + '" data-eq="' + p.id + '" title="' + escapeHtml(p.desc) + '">' +
        _eqCurveSvg(p.id, false) + '<span class="eq-chip-name">' + escapeHtml(p.name) + '</span></button>';
    }).join('') + '</div>';
  if (!ok) h += '<p class="dialog-hint">このブラウザは音質の切り替え（Web Audio）に対応していません。</p>';
  else h += '<p class="dialog-hint">選ぶとすぐ切り替わります（再生中の曲にも、次の曲にも効きます）。音が割れないよう、全体の音量（プリアンプ）を自動で少し下げます。</p>';
  return h;
}
function eqRenderPanel() {
  var root = document.getElementById('eq-panel');
  if (root && root.isConnected) root.innerHTML = _eqPanelHtml();
}
function openEqPanel() {
  if (typeof npVizMenuClose === 'function') npVizMenuClose(false);
  _eqEnsureGraph();
  if (typeof _npResume === 'function') _npResume();
  openDialog({
    title: '音質パネル',
    size: 'small',
    body: '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'音質パネル\', event)" title="クリックで「音質パネル」をコピー">□</span><div id="eq-panel" class="eq-panel"></div>',
    buttons: [{ label: '閉じる', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (body) {
      var root = body.querySelector('#eq-panel');
      root.innerHTML = _eqPanelHtml();
      root.addEventListener('click', function (ev) {
        var c = ev.target.closest && ev.target.closest('[data-eq]');
        if (c) setEqPreset(c.getAttribute('data-eq'));
      });
    }
  });
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // 再生画面を作ったとき：音量の行の右端に音質ボタンを足す
  var f = window._npEnsureDom;
  if (typeof f === 'function') {
    window._npEnsureDom = function () {
      var r = f.apply(this, arguments);
      try { _eqEnsureBtn(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生が始まったとき：フラット以外なら、再生画面を開いていなくても音の通り道を作る
  var a = document.getElementById('audio-player');
  if (a) a.addEventListener('play', function () { try { _eqEnsureGraph(); } catch (e) { console.warn(e); } });
  // 画面を触ったとき：AudioContext が止まっていたら動かす（自動再生の決まりで止まっていた場合の保険）
  document.addEventListener('pointerdown', function () {
    if (typeof np !== 'undefined' && np.ctx && np.ctx.state === 'suspended' && typeof _npResume === 'function') _npResume();
  }, true);
})();

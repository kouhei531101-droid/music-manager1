/* =========================================================
   91-equalizer.js ― スマホ版：「音質ボタン」と「音質パネル」・「音質の調整」（イコライザー。スマホ版 v8.24.0。v8.25.3 で音質の調整）
   ・音の通り道（37-now-playing.js の _npEnsureAudioGraph から eqBuildChain を呼ぶ。createMediaElementSource は 37 で1回だけ）
       audio 要素 → 10本のフィルター（BiquadFilterNode を直列）→ プリアンプ（GainNode）→ スピーカー
                                     └→ ビジュアライザー（AnalyserNode。プリアンプの前から見る）
     audio 要素はアプリに1つだけ（#audio-player。曲の切り替えも同じ要素。クロスフェードは無い）なので、全部の曲に効く
   ・バンド：60Hz（lowshelf）・170・310・600・1k・3k・6k・12k・14k（peaking。Q 1.2）・16kHz（highshelf）
   ・プリセット（db.settings.eqPreset）：flat フラット／heavy ヘビー／rock ロック／pop ポップ／bass 低音強調／vocal ボーカル／
     jazz ジャズ／classical クラシック／dance ダンス。無い・知らない値（古いバックアップ・PC版のバックアップ）は flat
   ・音質の調整（v8.25.3。PC版 v8.7.81 の np-eq-common.js と同じ値・同じ形）：フラット以外のプリセットは、
     10バンド（−12〜+12dB）とプリアンプ（−12〜+6dB・自動）を調整できる。調整した値は db.settings.eqCustom（プリセットごと）。
     フラットは調整しない（いつも素通し）。画面は横向きのスライダーを縦に11本（指で操作しやすいように）
   ・プリアンプ（全体の音量）：「自動」は、10本を合わせた周波数特性をフィルターと同じ式で計算し、いちばん持ち上がる量だけ下げる
     （音割れ〔クリップ〕を防ぐ。最大 −12dB）。フラットは 0dB（フィルターのゲインも全部 0 で素通しと同じ）
   ・切り替え：ゲインは setTargetAtTime（時定数 0.04秒）でなめらかに変える（プツッという音を防ぐ）。調整中もフィルターは作り直さない
   ・音の通り道を作るのは、①再生画面を開いたとき（今まで通り）、②フラット以外を選んでいて、利用者が画面を触ったあとの再生のとき
     （画面が隠れている間・まだ一度も触っていないときは作らない。AudioContext が止まったままだと音が出なくなるため）
   ・AudioContext が止まっていたら、再生のたび（37）と画面を触ったとき（ここ）に resume する
   ・保存は db.settings.eqPreset・db.settings.eqCustom（バックアップに入る。復元のあとは eqAfterRestore で合わせる）。
     調整中（スライダーを動かしている間）は保存しない。「保存」を押したときだけ
   ・上半分（値・計算・パネルの中身と動き）は PC版の np-eq-common.js と同じ中身。下半分がスマホ版の音・保存・ボタン・ダイアログ
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
// 「音質の調整」の範囲（PC版 v8.7.81・スマホ版 v8.25.3）：各バンドは −12〜+12dB、プリアンプは −12〜+6dB。どちらも 0.5dB きざみ
var EQ_G_MIN = -12, EQ_G_MAX = 12, EQ_P_MIN = -12, EQ_P_MAX = 6, EQ_STEP = 0.5;
// プリセット（dB。上の10バンドの順）。Winamp・Android の標準イコライザーの値を参考に、やりすぎない量にした。
//   12k・14k・16k は近くて重なる（合わせると足し算で大きくなる）ので、高音は控えめの値にしている。
//   ここの値は「初期の値」。調整した値は db.settings.eqCustom に入る（下の「音質の調整」）
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

/* ---------- プリセット ---------- */
// ID からプリセット（無い・知らない値はフラット）
function eqPresetOf(id) { return EQ_PRESETS.filter(function (p) { return p.id === id; })[0] || EQ_PRESETS[0]; }

/* ---------- 音質の調整（プリセットごとに調整した値。PC版 v8.7.81・スマホ版 v8.25.3。PC版とスマホ版で同じ形） ----------
   ・保存は db.settings.eqCustom = { プリセットのID: { g: [10バンドの dB], pre: プリアンプの dB（null は「自動」） } }
     調整していないプリセットは入れない（初期の値のまま）。フラットは調整しない（いつも全部 0 の素通し）
   ・無い（古いバックアップ）・形のおかしい値は「調整なし」として読む。範囲の外の値は範囲に収める */
// 数にして、きざみ（step。無ければ EQ_STEP）にそろえ、範囲に収める（だめなら null）
function _eqNum(v, lo, hi, step) {
  v = Number(v);
  if (!isFinite(v)) return null;
  step = step || EQ_STEP;
  v = Math.round(v / step) * step;
  v = Math.round(v * 10) / 10;   // 0.1 の誤差（0.30000000000000004 など）を消す
  return Math.max(lo, Math.min(hi, v)) + 0;   // + 0：−0 を 0 に
}
// 調整した値1つを確かめて { g, pre } にする（だめなら null）
function eqCustomClean(c, id) {
  if (!c || typeof c !== 'object' || id === 'flat' || !EQ_PRESETS.some(function (p) { return p.id === id; })) return null;
  if (!Array.isArray(c.g) || c.g.length !== EQ_BANDS.length) return null;
  var g = [];
  for (var i = 0; i < c.g.length; i++) { var v = _eqNum(c.g[i], EQ_G_MIN, EQ_G_MAX); if (v === null) return null; g.push(v); }
  // プリアンプは 0.1dB まで（「自動」をオフにしたときの値〔−5.4dB など〕をそのまま残す）
  var pre = (c.pre === null || c.pre === undefined || c.pre === '') ? null : _eqNum(c.pre, EQ_P_MIN, EQ_P_MAX, 0.1);
  return { g: g, pre: pre };
}
// 調整した値の全部（確かめたもの。無ければ {}）。cm：db.settings.eqCustom（再生画面ウィンドウでは届いた state.eqCustom）
function eqCustomAll(cm) {
  var out = {};
  if (!cm || typeof cm !== 'object') return out;
  EQ_PRESETS.forEach(function (p) {
    if (!Object.prototype.hasOwnProperty.call(cm, p.id)) return;
    var c = eqCustomClean(cm[p.id], p.id);
    if (c) out[p.id] = c;
  });
  return out;
}
function eqCustomOf(id, cm) {
  return cm && typeof cm === 'object' && Object.prototype.hasOwnProperty.call(cm, id) ? eqCustomClean(cm[id], id) : null;
}
function eqIsCustom(id, cm) { return !!eqCustomOf(id, cm); }
// 今使う10バンドの値（調整していれば調整した値、なければ初期の値）
function eqGains(id, cm) { var c = eqCustomOf(id, cm); return (c ? c.g : eqPresetOf(id).g).slice(); }
// 名前（調整したプリセットは「ロック（調整済み）」）
function eqLabelOf(id, cm) { return eqPresetOf(id).name + (eqIsCustom(id, cm) ? '（調整済み）' : ''); }
// 復元の確認の表に出す文（「なし」か「2件（ロック・ポップ）」）
function eqCustomText(s) {
  var m = eqCustomAll(s && s.eqCustom), ids = Object.keys(m);
  return ids.length ? ids.length + '件（' + ids.map(function (id) { return eqPresetOf(id).name; }).join('・') + '）' : 'なし';
}
// 2つの値（{ g, pre }）が同じか
function _eqSame(a, b) {
  if (!a || !b) return !a && !b;
  if (a.pre !== b.pre) return false;
  for (var i = 0; i < EQ_BANDS.length; i++) if (a.g[i] !== b.g[i]) return false;
  return true;
}

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
var _eqCurveCache = {}, _eqCurveCount = 0;
// 10本を合わせた特性（dB の並び。EQ_GRID の周波数ごと）。g：10バンドの値（調整中は動かすたびに変わるので、覚えるのは 200通りまで）
function eqCurveOf(g) {
  var key = g.join(',');
  if (_eqCurveCache[key]) return _eqCurveCache[key];
  var cos = EQ_BANDS.map(function (b, i) { return _eqCoef(b.type, b.f, g[i]); });
  var out = EQ_GRID.map(function (f) { return cos.reduce(function (sum, co) { return sum + _eqMagDb(co, f); }, 0); });
  if (++_eqCurveCount > 200) { _eqCurveCache = {}; _eqCurveCount = 1; }
  return (_eqCurveCache[key] = out);
}
// 自動のプリアンプ（dB。0 以下）：いちばん持ち上がる量だけ下げる（音割れを防ぐ。最大 −12dB）
function eqAutoPreDb(g) {
  var mx = Math.max.apply(null, eqCurveOf(g));
  return mx > 0.05 ? -Math.min(EQ_PRE_MAX, Math.round(mx * 10) / 10) : 0;
}
// 今使うプリアンプ（dB）：調整で決めた値があればそれ、なければ自動
function eqPreampDb(id, cm) {
  var c = eqCustomOf(id, cm);
  return c && c.pre !== null ? c.pre : eqAutoPreDb(c ? c.g : eqPresetOf(id).g);
}

/* ---------- 音質ボタンの絵（縦の3本のつまみ。PC版・スマホ版で同じ） ---------- */
var EQ_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<line x1="5" y1="4" x2="5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="20"/>' +
  '<rect x="2.5" y="12" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="6.5" width="5" height="3" rx="1" fill="currentColor"/><rect x="16.5" y="14" width="5" height="3" rx="1" fill="currentColor"/></svg>';

/* ---------- 音質パネルの中身 ---------- */
function _eqEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// dB の表示（+3dB・−1.5dB・0dB）
function eqDbText(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)) + 'dB'; }
// 周波数の表示（60Hz・1kHz）
function eqHzText(b) { return b.f >= 1000 ? (b.f / 1000) + 'kHz' : b.f + 'Hz'; }
// 特性のグラフの線（SVG の points）
function _eqCurvePts(g, W, H) {
  var R = 9, c = eqCurveOf(g);   // R：上下 ±9dB を枠いっぱいに
  return c.map(function (d, i) {
    var x = i / (c.length - 1) * W, y = H / 2 - Math.max(-R, Math.min(R, d)) / R * (H / 2 - 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}
// 特性のグラフ（SVG。横は 20Hz〜20kHz の対数、縦は ±9dB）。g：10バンドの値。big：パネルの上の大きいグラフ
function _eqCurveSvg(g, big) {
  var W = big ? 300 : 64, H = big ? 90 : 26;
  return '<svg class="eq-curve' + (big ? ' eq-curve-big' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" class="eq-zero"/>' +
    '<polyline points="' + _eqCurvePts(g, W, H) + '" class="eq-line"/></svg>';
}
// 音質パネルの中身（今の音質・グラフ・10バンドの値・「このプリセットを調整」・プリセットのチップ）。
// curId：今の音質の ID。ok：音を変えられるか（false なら案内）。cm：調整した値（db.settings.eqCustom）。チップは [data-eq="ID"]
function eqPanelHtml(curId, ok, cm) {
  var cur = eqPresetOf(curId), g = eqGains(cur.id, cm), pre = eqPreampDb(cur.id, cm), mine = eqIsCustom(cur.id, cm);
  var h = '<div class="eq-now"><span class="eq-now-label">今の音質</span><strong class="eq-now-name">' + _eqEsc(cur.name) + '</strong>' +
    (mine ? '<span class="eq-badge" title="初期の値から調整しています">調整済み</span>' : '') +
    '<span class="eq-now-pre">' + (cur.id === 'flat' ? 'イコライザーなし' : 'プリアンプ ' + eqDbText(pre)) + '</span></div>' +
    '<div class="eq-now-desc">' + _eqEsc(cur.desc) + '</div>' +
    '<div class="eq-graph">' + _eqCurveSvg(g, true) +
      '<div class="eq-graph-labels">' + EQ_BANDS.map(function (b, i) {
        var v = g[i];
        return '<span class="' + (v > 0 ? 'is-up' : v < 0 ? 'is-down' : '') + '"><b>' + (v > 0 ? '+' : '') + v + '</b>' + b.label + '</span>';
      }).join('') + '</div></div>';
  // 「このプリセットを調整」ボタン（音質の調整を開く）。フラットは調整しない
  if (ok) {
    h += '<div class="eq-acts">' + (cur.id === 'flat'
      ? '<span class="eq-acts-note">フラットは調整できません（いつも素通し）。調整するときは、ほかのプリセットを選んでください</span>'
      : '<button type="button" class="btn-cancel eq-edit-btn" data-eq-act="edit" title="「' + _eqEsc(cur.name) + '」の10バンドとプリアンプを調整します">' + EQ_ICON + 'このプリセットを調整</button>') + '</div>';
  }
  h += '<div class="eq-chips" role="radiogroup" aria-label="音質のプリセット">' + EQ_PRESETS.map(function (p) {
      var on = p.id === cur.id, c = eqIsCustom(p.id, cm);
      return '<button type="button" class="eq-chip' + (on ? ' is-cur' : '') + (c ? ' is-custom' : '') + '" role="radio" aria-checked="' + on + '" data-eq="' + p.id + '"' +
        ' title="' + _eqEsc(p.desc + (c ? '（調整済み）' : '')) + '" aria-label="' + _eqEsc(eqLabelOf(p.id, cm)) + '">' +
        _eqCurveSvg(eqGains(p.id, cm), false) + '<span class="eq-chip-name">' + (c ? '<i class="eq-dot" aria-hidden="true"></i>' : '') + _eqEsc(p.name) + '</span></button>';
    }).join('') + '</div>';
  if (!ok) h += '<p class="dialog-hint">このブラウザは音質の切り替え（Web Audio）に対応していません。</p>';
  else h += '<p class="dialog-hint">選ぶとすぐ切り替わります（再生中の曲にも、次の曲にも効きます）。音が割れないよう、全体の音量（プリアンプ）を自動で少し下げます。点の付いたプリセットは調整済みです。</p>';
  return h;
}
// 「音質の調整」の中身（ed：{ id, g, pre〔null は自動〕, saved〔保存してある調整。無ければ null〕 }）
function eqEditHtml(ed) {
  var p = eqPresetOf(ed.id);
  var row = function (key, label, v, lo, hi, aria) {
    return '<div class="eq-sl' + (key === 'pre' ? ' eq-sl-pre' : '') + '">' +
      '<label class="eq-sl-f" for="eq-sl-' + key + '">' + label + '</label>' +
      '<input type="range" class="eq-sl-in" id="eq-sl-' + key + '" data-eq-band="' + key + '" min="' + lo + '" max="' + hi + '" step="' + EQ_STEP + '" value="' + v + '" aria-label="' + _eqEsc(aria) + '">' +
      '<output class="eq-sl-v" for="eq-sl-' + key + '" data-eq-out="' + key + '">' + eqDbText(v) + '</output></div>';
  };
  var pre = ed.pre !== null ? ed.pre : eqAutoPreDb(ed.g);
  return '<div class="eq-edit" data-eq-editing="' + ed.id + '">' +
    '<div class="eq-now"><span class="eq-now-label">音質の調整</span><strong class="eq-now-name">' + _eqEsc(p.name) + '</strong>' +
      '<span class="eq-now-pre eq-ed-state" data-eq-state>' + _eqEditState(ed) + '</span></div>' +
    '<div class="eq-graph eq-ed-graph">' + _eqCurveSvg(ed.g, true) + '</div>' +
    '<div class="eq-sliders" role="group" aria-label="10バンドの調整（−12〜+12dB）">' +
      EQ_BANDS.map(function (b, i) { return row(String(i), eqHzText(b), ed.g[i], EQ_G_MIN, EQ_G_MAX, eqHzText(b) + 'の強さ'); }).join('') +
    '</div>' +
    '<div class="eq-pre-head"><span>プリアンプ（全体の音量）</span>' +
      '<button type="button" class="eq-auto' + (ed.pre === null ? ' is-on' : '') + '" data-eq-act="auto" aria-pressed="' + (ed.pre === null) + '" title="オン：音が割れないよう、10バンドに合わせて自動で下げます">自動</button></div>' +
    '<div class="eq-sliders">' + row('pre', '全体', pre, EQ_P_MIN, EQ_P_MAX, 'プリアンプ（全体の音量）') + '</div>' +
    '<div class="eq-ed-btns">' +
      '<button type="button" class="btn-cancel eq-reset-btn" data-eq-act="reset" title="このプリセットの最初の値にします（「保存」を押すと決まります）">初期に戻す</button>' +
      '<span class="eq-ed-sp"></span>' +
      '<button type="button" class="btn-cancel" data-eq-act="cancel">キャンセル</button>' +
      '<button type="button" class="btn-save" data-eq-act="save">保存</button></div>' +
    '<p class="dialog-hint">動かすとすぐ音に反映されます（聞きながら調整できます）。「保存」で決まり、「キャンセル」で元の音に戻ります。' +
      '「初期に戻す」はこのプリセットの最初の値にします（「保存」を押すと決まります）。プリアンプの「自動」がオンのときは、音が割れないよう自動で下げます。</p>' +
    '</div>';
}
// 調整の状態の文（初期の値／調整済み／変更あり）
function _eqEditState(ed) {
  var now = { g: ed.g, pre: ed.pre }, def = { g: eqPresetOf(ed.id).g, pre: null };
  if (!_eqSame(now, ed.saved || def)) return '変更あり（まだ保存していません）';
  return _eqSame(now, def) ? '初期の値' : '調整済み';
}

/* ---------- 音質パネルの動き（「音質パネル」と「音質の調整」の切り替え・スライダー） ----------
   root：パネルの入れ物（#eq-panel・#npw-eq-body）。api：
     cm()：調整した値　cur()：今の音質の ID　ok()：音を変えられるか　pick(id)：プリセットを選んだ
     live(id, g, preDb)：調整中の値をすぐ音に（保存しない）　save(id, 値〔null は初期に戻す〕)：保存　cancel()：保存してある値の音に戻す
   ・スライダーを動かしている間は、画面の数字だけすぐ変え、グラフと音（live）は 1コマ（requestAnimationFrame）に1回にまとめる。
     保存（localStorage）は「保存」を押したときだけ */
function eqPanelCtl(root, api) {
  var ed = null, raf = 0;
  function render() { root.innerHTML = ed ? eqEditHtml(ed) : eqPanelHtml(api.cur(), api.ok(), api.cm()); }
  function preDb() { return ed.pre !== null ? ed.pre : eqAutoPreDb(ed.g); }
  function start() {
    var id = api.cur();
    if (id === 'flat' || !api.ok()) return;
    var c = eqCustomOf(id, api.cm());
    ed = { id: id, g: eqGains(id, api.cm()), pre: c ? c.pre : null, saved: c };
    render();
    var s = root.querySelector('.eq-sl-in');
    if (s) { try { s.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
  // 画面の数字・スライダー・グラフ・状態の文を今の値に合わせる（all：10本のスライダーの位置も）
  function sync(all) {
    if (!ed) return;
    if (all) ed.g.forEach(function (v, i) { _set(String(i), v); });
    _set('pre', preDb(), true);
    var a = root.querySelector('.eq-auto');
    if (a) { a.classList.toggle('is-on', ed.pre === null); a.setAttribute('aria-pressed', String(ed.pre === null)); }
    var ln = root.querySelector('.eq-ed-graph .eq-line');
    if (ln) ln.setAttribute('points', _eqCurvePts(ed.g, 300, 90));
    var st = root.querySelector('[data-eq-state]');
    if (st) st.textContent = _eqEditState(ed);
  }
  function _set(key, v, slider) {
    var o = root.querySelector('[data-eq-out="' + key + '"]'), s = root.querySelector('[data-eq-band="' + key + '"]');
    if (o) o.textContent = eqDbText(v);
    if (s && (slider || String(s.value) !== String(v))) s.value = v;
  }
  function tick() {
    raf = 0;
    if (!ed) return;
    sync(false);
    api.live(ed.id, ed.g.slice(), preDb());
  }
  function later() { if (!raf) raf = requestAnimationFrame(tick); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } ed = null; }
  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!ed || !t || !t.getAttribute || t.getAttribute('data-eq-band') === null) return;
    var k = t.getAttribute('data-eq-band'), v = Number(t.value);
    if (k === 'pre') ed.pre = _eqNum(v, EQ_P_MIN, EQ_P_MAX, 0.1);   // 動かしたら「自動」はオフ
    else ed.g[+k] = _eqNum(v, EQ_G_MIN, EQ_G_MAX);
    var o = root.querySelector('[data-eq-out="' + k + '"]');
    if (o) o.textContent = eqDbText(k === 'pre' ? ed.pre : ed.g[+k]);   // 数字はすぐ
    later();
  });
  root.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-eq-act]');
    if (a) {
      var act = a.getAttribute('data-eq-act');
      if (act === 'edit') { start(); return; }
      if (!ed) return;
      if (act === 'save') {
        var id = ed.id, val = { g: ed.g.slice(), pre: ed.pre };
        if (_eqSame(val, { g: eqPresetOf(id).g, pre: null })) val = null;   // 初期の値と同じなら「調整なし」にする
        stop(); api.save(id, val); render();
      } else if (act === 'cancel') {
        stop(); api.cancel(); render();
      } else if (act === 'reset') {
        ed.g = eqPresetOf(ed.id).g.slice(); ed.pre = null; sync(true); later();
      } else if (act === 'auto') {
        ed.pre = ed.pre === null ? preDb() : null; sync(false); later();
      }
      return;
    }
    var c = !ed && ev.target.closest && ev.target.closest('[data-eq]');
    if (c) api.pick(c.getAttribute('data-eq'));
  });
  return {
    render: function () { if (!ed) render(); },             // 「音質パネル」を作り直す（調整中は作り直さない）
    editing: function () { return ed ? ed.id : ''; },      // 調整中のプリセットの ID（調整中でなければ ''）
    cancel: function () { if (ed) { stop(); api.cancel(); } }   // 閉じたとき：保存していない調整は捨てて、元の音に戻す
  };
}

/* =========================================================
   ここから下はスマホ版だけ（音・保存・ボタン・ダイアログ）
   ========================================================= */
var eqSt = { filters: null, pre: null, ctx: null };
var eqCtl = null;   // 開いている音質パネル（ダイアログ）の動き（上の eqPanelCtl）

/* ---------- 設定 ---------- */
// 今の音質の ID（無い・知らない値はフラット）
function eqPresetId(s) { s = s || (typeof db !== 'undefined' && db.settings) || {}; return eqPresetOf(s.eqPreset).id; }
// 今の音質の名前（調整したプリセットは「ロック（調整済み）」）
function eqPresetName(s) { s = s || (typeof db !== 'undefined' && db.settings) || {}; return eqLabelOf(eqPresetId(s), s.eqCustom); }
// 調整した値（db.settings.eqCustom）
function eqCm() { return (typeof db !== 'undefined' && db.settings && db.settings.eqCustom) || null; }
function eqSupported() { return !!(window.AudioContext || window.webkitAudioContext); }

/* ---------- 音の通り道 ---------- */
// 37 の _npEnsureAudioGraph から1回だけ呼ばれる。src（MediaElementSource）→ フィルター10本 → プリアンプ。
// 戻り値：{ out: スピーカーへつなぐ所, viz: ビジュアライザーへつなぐ所 }
function eqBuildChain(ctx, src) {
  if (!ctx || !src || !ctx.createBiquadFilter) return null;
  var id = eqPresetId(), g = eqGains(id, eqCm());
  // 先に全部作ってから（途中で失敗しても src は何にもつながっていない）つなぐ
  var filters = EQ_BANDS.map(function (b, i) {
    var f = ctx.createBiquadFilter();
    f.type = b.type; f.frequency.value = b.f; if (b.type === 'peaking') f.Q.value = EQ_Q;
    f.gain.value = g[i];
    return f;
  });
  var pre = ctx.createGain();
  pre.gain.value = Math.pow(10, eqPreampDb(id, eqCm()) / 20);
  src.connect(filters[0]);
  for (var i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i]);
  filters[filters.length - 1].connect(pre);
  eqSt.filters = filters; eqSt.pre = pre; eqSt.ctx = ctx;
  return { out: pre, viz: filters[filters.length - 1] };
}
// フィルター10本とプリアンプに値を入れる（なめらかに。作り直さない）
function _eqSetParams(g, preDb) {
  if (!eqSt.filters || !eqSt.ctx) return;
  var t = eqSt.ctx.currentTime;
  var go = function (param, v) {
    try { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.setTargetAtTime(v, t, EQ_TC); }
    catch (e) { param.value = v; }
  };
  eqSt.filters.forEach(function (f, i) { go(f.gain, g[i]); });
  go(eqSt.pre.gain, Math.pow(10, preDb / 20));
}
// 今の設定（保存してある値）をフィルターに入れる
function eqApply() {
  var id = eqPresetId();
  _eqSetParams(eqGains(id, eqCm()), eqPreampDb(id, eqCm()));
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

/* ---------- 音質の調整（v8.25.3） ---------- */
// 調整中の値をすぐ音に（保存しない。動かしている間に何度も呼ばれる。フィルターは作り直さず、値だけなめらかに変える）
function eqPreview(id, g, preDb) {
  if (id !== eqPresetId() || id === 'flat') return;
  var c = eqCustomClean({ g: g, pre: preDb }, id);
  if (!c) return;
  if (!eqSt.filters) { _eqEnsureGraph(); if (typeof _npResume === 'function') _npResume(); }
  _eqSetParams(c.g, c.pre);
}
// 「保存」：調整した値を保存して音に効かせる。val が null なら調整を消す（初期の値に戻す）
function eqSaveCustom(id, val) {
  if (eqPresetOf(id).id !== id || id === 'flat') return;
  var m = eqCustomAll(eqCm()), c = val ? eqCustomClean(val, id) : null;
  if (c) m[id] = c; else delete m[id];
  if (Object.keys(m).length) db.settings.eqCustom = m; else delete db.settings.eqCustom;
  saveDB();
  eqApply();
  eqBtnUi();
  eqRenderPanel();
  if (typeof showToast === 'function') showToast(c ? '「' + eqPresetOf(id).name + '」の調整を保存しました' : '「' + eqPresetOf(id).name + '」を初期の値に戻しました');
}
// 復元のあと（10-settings-backup.js から）：古いバックアップは eqPreset・eqCustom が無いので、フラット・調整なし
function eqAfterRestore() {
  if (eqCtl && eqCtl.editing()) eqCtl.cancel();
  eqApply(); eqBtnUi(); eqRenderPanel();
}

/* ---------- 音質ボタン（再生画面の音量の行の右端。#np-eq-btn） ---------- */
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

/* ---------- 音質パネル（ダイアログ）と音質の調整 ---------- */
function eqRenderPanel() {
  var root = document.getElementById('eq-panel');
  if (!eqCtl || !root || !root.isConnected) return;
  var ed = eqCtl.editing();
  if (ed && ed !== eqPresetId()) eqCtl.cancel();
  eqCtl.render();
}
function openEqPanel() {
  if (typeof npVizMenuClose === 'function') npVizMenuClose(false);
  _eqEnsureGraph();
  if (typeof _npResume === 'function') _npResume();
  var ctl = null;
  openDialog({
    title: '音質パネル',
    size: 'small',
    body: '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'音質パネル\', event)" title="クリックで「音質パネル」をコピー">□</span><div id="eq-panel" class="eq-panel"></div>',
    buttons: [{ label: '閉じる', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (body) {
      var root = body.querySelector('#eq-panel');
      ctl = eqCtl = eqPanelCtl(root, {
        cm: eqCm, cur: function () { return eqPresetId(); }, ok: eqSupported,
        pick: setEqPreset, live: eqPreview, save: eqSaveCustom, cancel: eqApply
      });
      eqCtl.render();
    }
  }).then(function () {
    // 閉じた（閉じる・×・Esc・別のダイアログ）：保存していない調整は捨てて、元の音に戻す
    if (eqCtl === ctl) eqCtl = null;   // 続けて開き直したときは、新しいパネルの方は残す
    if (ctl) ctl.cancel();
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

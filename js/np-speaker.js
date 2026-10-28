/* =========================================================
   np-speaker.js ― 再生画面のプレイヤー表示「スピーカーのモード」の共通部品（PC版 v8.7.86・スマホ版 v8.25.7。両版で同じ中身）
   ・見た目：ジャケットの左右に「左スピーカー」「右スピーカー」（木目の箱。上にツイーター、下にウーファーのコーン）、
     ジャケットの下に「アンプのパネル」（金属の板。電源ランプ・左右の「VU メーター」・ピークランプ・つまみ）
   ・動き：コーンは低音に合わせて膨らみ・震える、ツイーターは高音に合わせて小さく動く、VU メーターの針は音の大きさ（RMS）に合わせて
     なめらかに振れて、ゆっくり戻る（ばねと抵抗の計算）。ピークランプは大きな音（波形の山が -1dB を超えた・針が +3 を超えた）で 0.35秒光る。
     一時停止中は針が 0（左端）に戻り、コーンも止まる。動かすのは transform と opacity だけ（毎フレームのレイアウト計算・影・ぼかしは無し）
   ・左右の音：今ある AnalyserNode と同じ所（音質〔イコライザー〕の後、37 の np.vizSrc）から ChannelSplitter で左右に分け、
     左右それぞれに小さな AnalyserNode（fftSize 1024）をつなぐ（npSpkSplit）。音の通り道には何も足さない（枝を足すだけ）。
     AudioContext は作らない。分けられないとき・モノラルの曲（右が無音）は、左右とも同じ値
   ・この file は画面の中の再生画面（PC版 90-np-speaker.js・スマホ版 97-np-speaker.js）と、
     PC版の再生画面ウィンドウ・小窓（np-window-remote.js）の両方が読む。ほかのファイルに頼らない
   ========================================================= */

// プレイヤー表示ボタンのアイコン（スピーカーの箱・ツイーター・ウーファー。01-core.js の _svg と同じ書き方）
var NP_SPK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="7" r="1.8"/><circle cx="12" cy="14.5" r="4"/><circle cx="12" cy="14.5" r="1.2"/></svg>';

// 音の値の目安（調整するときはここだけ）
var NP_SPK = {
  VU_FULL: 0.447,     // 針が右端（+3 VU）になる RMS（0 VU ＝ -10 dBFS。最近の曲で 0 の前後、静かな曲で -10 あたり）
  PEAK: 0.89,         // ピークランプ：波形の山（-1 dBFS）
  PEAK_HOLD: 0.35,    // ピークランプが光っている秒数
  LOW_HZ: [35, 160],  // コーン（低音）を見る周波数
  HIGH_HZ: [3500, 14000],   // ツイーター（高音）を見る周波数
  LOW_FLOOR: 110, LOW_SPAN: 100,    // 低音の値（帯の平均。0〜255）→ 0〜1
  HIGH_FLOOR: 80, HIGH_SPAN: 90,    // 高音の値（帯の平均と最大の真ん中。0〜255）→ 0〜1
  CONE: 0.075,        // コーンの膨らみ（最大で 7.5% 大きく）
  SHAKE: 0.012,       // コーンの震え
  TWEET: 0.14,        // ツイーターの動き
  ANGLE: 46           // 針の振れ（左端 -46°〜右端 +46°）
};

/* ---------- VU メーターの目盛り（SVG。1回だけ作る） ---------- */
// 目盛りの位置 p（0〜1）は電圧に比例（本物の VU メーターと同じ）：p = 10^((VU - 3) / 20)
function _npSpkP(vu) { return Math.pow(10, (vu - 3) / 20); }
var _npSpkFaceSvg = '';
function npSpkFaceSvg() {
  if (_npSpkFaceSvg) return _npSpkFaceSvg;
  // 針の付け根は (50, 62)（窓の下の外）。目盛りは半径 46 の弧
  var cx = 50, cy = 62, R = 46, A = NP_SPK.ANGLE * Math.PI / 180;
  function pt(p, r) { var a = -A + 2 * A * p; return [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)]; }
  function arc(p0, p1, r) { var a = pt(p0, r), b = pt(p1, r); return 'M' + a[0] + ' ' + a[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + b[0] + ' ' + b[1]; }
  var p0 = _npSpkP(0), s = '';
  s += '<path d="' + arc(0, p0, R) + '" stroke="#2a2118" stroke-width="0.9" fill="none"/>';
  s += '<path d="' + arc(p0, 1, R) + '" stroke="#c0281c" stroke-width="2.6" fill="none"/>';
  s += '<path d="' + arc(p0, 1, R - 2.2) + '" stroke="#c0281c" stroke-width="0.6" fill="none"/>';
  [[-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'], [-3, '3'], [-2, ''], [-1, ''], [0, '0'], [1, ''], [2, ''], [3, '+3']].forEach(function (x) {
    var p = _npSpkP(x[0]), red = x[0] > 0, big = x[1] !== '';
    var a = pt(p, R), b = pt(p, R + (big ? 5 : 3));
    s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + (red ? '#c0281c' : '#2a2118') + '" stroke-width="' + (big ? 0.9 : 0.6) + '"/>';
    if (x[1]) { var t = pt(p, R + 10); s += '<text x="' + t[0] + '" y="' + (+t[1] + 1.6).toFixed(2) + '" fill="' + (x[0] >= 0 ? '#c0281c' : '#2a2118') + '" font-size="5" text-anchor="middle">' + x[1] + '</text>'; }
  });
  // 下の小さな目盛り（％）と「VU」の文字
  [0, 0.25, 0.5, 0.75, 1].forEach(function (p) { var a = pt(p, R - 7), b = pt(p, R - 9.5); s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="#2a2118" stroke-width="0.5"/>'; });
  s += '<path d="' + arc(0, 1, R - 7) + '" stroke="#2a2118" stroke-width="0.4" fill="none"/>';
  s += '<text x="50" y="44" fill="#2a2118" font-size="8" font-weight="700" text-anchor="middle" letter-spacing="0.5">VU</text>';
  s += '<text x="7" y="10" fill="#2a2118" font-size="4.2">−</text><text x="91" y="10" fill="#c0281c" font-size="4.2">+</text>';
  _npSpkFaceSvg = '<svg class="np-sp-scale" viewBox="0 0 100 56" preserveAspectRatio="xMidYMid meet" aria-hidden="true" font-family="Arial, Helvetica, sans-serif">' + s + '</svg>';
  return _npSpkFaceSvg;
}

/* ---------- 部品（HTML） ----------
   lbl(name, cls)：□（名前のコピー）の HTML を返す関数（画面の中の再生画面と再生画面ウィンドウで作り方が違うので渡してもらう）。
   bodyAttr：ジャケット（.np-sp-body）に付ける属性（ウィンドウは disabled） */
function npSpkHtml(lbl, bodyAttr) {
  function speaker(side, name) {
    return '<span class="np-sp-spk np-sp-spk-' + side + '" role="img" aria-label="' + name + '">' +
      '<span class="np-sp-baffle">' +
        '<span class="np-sp-tw"><span class="np-sp-tw-dome" data-sp="tw-' + side + '"></span></span>' +
        '<span class="np-sp-woofer"><span class="np-sp-cone" data-sp="cone-' + side + '"><span class="np-sp-cap"></span></span></span>' +
        '<span class="np-sp-port"></span>' +
      '</span>' + lbl(name, 'np-sp-labeltag-' + side) + '</span>';
  }
  function meter(side, ch) {
    return '<span class="np-sp-vu np-sp-vu-' + side + '" role="img" aria-label="VU メーター（' + ch + '）">' +
      '<span class="np-sp-face">' + npSpkFaceSvg() + '<span class="np-sp-ch">' + ch + '</span>' +
        '<span class="np-sp-needle" data-sp="needle-' + side + '"></span><span class="np-sp-hub"></span><span class="np-sp-glass"></span></span>' +
      '<span class="np-sp-peak-wrap"><span class="np-sp-peak" data-sp="peak-' + side + '"></span>PEAK</span>' +
      '</span>';
  }
  return '<div class="np-sp-big" id="np-sp-big">' +
      '<div class="np-sp-stage">' +
        speaker('l', '左スピーカー') +
        '<button type="button" class="np-sp-body" id="np-sp-body"' + (bodyAttr || '') + ' title="ジャケットを大きく表示" aria-label="ジャケット（スピーカーのモード）"><span class="np-sp-art" id="np-sp-art"></span></button>' +
        speaker('r', '右スピーカー') +
      '</div>' +
      '<div class="np-sp-amp" role="group" aria-label="アンプのパネル">' +
        '<span class="np-sp-amp-l"><span class="np-sp-brand">MUSIC MANAGER</span><span class="np-sp-model">STEREO AMPLIFIER</span>' +
          '<span class="np-sp-power"><span class="np-sp-lamp"></span>POWER</span></span>' +
        meter('l', 'L') + meter('r', 'R') +
        '<span class="np-sp-amp-r"><span class="np-sp-knob" aria-hidden="true"></span><span class="np-sp-knob-label">VOLUME</span></span>' +
        lbl('アンプのパネル', 'np-sp-labeltag-amp') +
      '</div>' +
      lbl('スピーカーのモード', 'np-sp-labeltag') +
    '</div>';
}

/* ---------- 左右の音（ChannelSplitter）。st：37 の np（ctx・analyser・vizSrc） ---------- */
function npSpkSplit(st) {
  if (!st || !st.ctx || !st.analyser) return null;
  if (st.spk) return st.spk;
  var r = { L: st.analyser, R: st.analyser, stereo: false };
  try {
    if (st.vizSrc && st.ctx.createChannelSplitter) {
      var sp = st.ctx.createChannelSplitter(2);
      var mk = function () { var a = st.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.5; a.minDecibels = -90; a.maxDecibels = -20; return a; };
      var aL = mk(), aR = mk();
      st.vizSrc.connect(sp);   // 今の通り道はそのまま。枝を1本足すだけ（音は出力へ流れない）
      sp.connect(aL, 0); sp.connect(aR, 1);
      r = { L: aL, R: aR, stereo: true, splitter: sp };
    }
  } catch (e) { console.warn('スピーカーのモード：左右に分けられないので、左右とも同じ値にします', e); r = { L: st.analyser, R: st.analyser, stereo: false }; }
  st.spk = r;
  return r;
}
// 1つの AnalyserNode から、RMS・山・低音・高音を読む（配列はノードごとに1回だけ作る）
function _npSpkReadOne(an, sr, o) {
  if (!an._spkT) { an._spkT = new Float32Array(an.fftSize); an._spkF = new Uint8Array(an.frequencyBinCount); }
  var T = an._spkT, F = an._spkF, i, s = 0, pk = 0;
  an.getFloatTimeDomainData(T);
  for (i = 0; i < T.length; i++) { var v = T[i]; s += v * v; if (v > pk) pk = v; else if (-v > pk) pk = -v; }
  an.getByteFrequencyData(F);
  // 帯の値：low は平均、high は平均と最大の真ん中（高音の帯は広いので、1つの音〔細い山〕でも動くように）
  var hz = sr / an.fftSize, band = function (f, useMax) {
    var a = Math.max(1, Math.floor(f[0] / hz)), b = Math.min(F.length - 1, Math.max(a, Math.ceil(f[1] / hz))), t = 0, m = 0;
    for (var k = a; k <= b; k++) { t += F[k]; if (F[k] > m) m = F[k]; }
    t /= (b - a + 1);
    return useMax ? (t + m) / 2 : t;
  };
  // 解析の目盛り（minDecibels・maxDecibels）が違う AnalyserNode（分けられなかったときの 37 の analyser）は 0〜255 を揃える
  var adj = (an.maxDecibels - an.minDecibels) / 70, off = (an.minDecibels + 90) / 70 * 255;
  o.rms = Math.sqrt(s / T.length); o.pk = pk;
  o.low = Math.min(1, Math.max(0, (band(NP_SPK.LOW_HZ) * adj + off - NP_SPK.LOW_FLOOR) / NP_SPK.LOW_SPAN));
  o.high = Math.min(1, Math.max(0, (band(NP_SPK.HIGH_HZ, true) * adj + off - NP_SPK.HIGH_FLOOR) / NP_SPK.HIGH_SPAN));
}
// 左右の値を読む。戻り値 [rmsL, rmsR, lowL, lowR, highL, highR, peakL, peakR]（out を使い回す）
var _npSpkA = {}, _npSpkB = {};
function npSpkRead(st, out) {
  out = out || [0, 0, 0, 0, 0, 0, 0, 0];
  var sp = npSpkSplit(st);
  if (!sp) { for (var i = 0; i < 8; i++) out[i] = 0; return out; }
  var sr = st.ctx.sampleRate || 48000;
  _npSpkReadOne(sp.L, sr, _npSpkA);
  if (sp.R !== sp.L) _npSpkReadOne(sp.R, sr, _npSpkB);
  var b = sp.R !== sp.L && !(_npSpkB.pk < 1e-6 && _npSpkA.pk > 1e-4) ? _npSpkB : _npSpkA;   // モノラルの曲（右が無音）は左の値
  out[0] = _npSpkA.rms; out[1] = b.rms; out[2] = _npSpkA.low; out[3] = b.low; out[4] = _npSpkA.high; out[5] = b.high; out[6] = _npSpkA.pk; out[7] = b.pk;
  return out;
}

/* ---------- 動かす ----------
   root：#np-sp-big。sp：状態（npSpkState() で作る）。lv：npSpkRead の値（null なら全部 0）。dt：前からの秒。
   playing：再生中か。reduced：動きを減らす（コーン・ツイーターは動かさず、針はゆっくり）。戻り値：まだ動いている（止まり切っていない）か */
function npSpkState() { return { root: null, el: null, n: [0, 0], v: [0, 0], c: [0, 0], t: [0, 0], pk: [0, 0], ph: 0, w: {} }; }
function _npSpkEls(root) {
  var q = function (k) { return root.querySelector('[data-sp="' + k + '"]'); };
  return { needle: [q('needle-l'), q('needle-r')], cone: [q('cone-l'), q('cone-r')], tw: [q('tw-l'), q('tw-r')], peak: [q('peak-l'), q('peak-r')] };
}
// 前と同じ値なら書かない（スタイルの書き換えを減らす）
function _npSpkSet(sp, key, el, prop, val) { if (!el || sp.w[key] === val) return; sp.w[key] = val; el.style[prop] = val; }
function npSpkFrame(root, sp, lv, dt, playing, reduced) {
  if (!root) return false;
  if (sp.root !== root) { sp.root = root; sp.el = _npSpkEls(root); sp.w = {}; }
  dt = Math.min(0.05, Math.max(0.001, dt || 0.016));
  sp.ph += dt;
  var moving = false, E = sp.el;
  for (var ch = 0; ch < 2; ch++) {
    var on = playing && lv;
    // VU メーターの針：上がるときは少し速く（わずかに行き過ぎる）、下がるときはゆっくり戻る
    var tgt = on ? Math.min(1.1, lv[ch] / NP_SPK.VU_FULL) : 0, pos = sp.n[ch], vel = sp.v[ch];
    if (reduced) { pos += (tgt - pos) * Math.min(1, dt * 5); vel = 0; }
    else {
      var up = tgt > pos, k = up ? 220 : 34, c = up ? 22 : 10.5;
      vel += (k * (tgt - pos) - c * vel) * dt; pos += vel * dt;
    }
    if (pos < -0.025) { pos = -0.025; vel = 0; }   // 左のピン（止め）
    if (pos > 1.1) { pos = 1.1; vel = 0; }          // 右のピン
    sp.n[ch] = pos; sp.v[ch] = vel;
    if (Math.abs(tgt - pos) > 0.003 || Math.abs(vel) > 0.01) moving = true;
    // コーン（低音）・ツイーター（高音）
    var bl = on && !reduced ? lv[2 + ch] : 0, hi = on && !reduced ? lv[4 + ch] : 0;
    sp.c[ch] += (bl - sp.c[ch]) * Math.min(1, dt * (bl > sp.c[ch] ? 32 : 11));
    sp.t[ch] += (hi - sp.t[ch]) * Math.min(1, dt * (hi > sp.t[ch] ? 40 : 14));
    if (sp.c[ch] > 0.002 || sp.t[ch] > 0.002) moving = true;
    // ピークランプ
    if (on && (lv[6 + ch] > NP_SPK.PEAK || pos > 1.0)) sp.pk[ch] = NP_SPK.PEAK_HOLD; else sp.pk[ch] = Math.max(0, sp.pk[ch] - dt);
    if (sp.pk[ch] > 0) moving = true;
    // 書く（transform と opacity だけ）
    var cb = sp.c[ch], sc = 1 + NP_SPK.CONE * cb * cb + (cb > 0.05 ? Math.sin(sp.ph * 83 + ch * 1.7) * NP_SPK.SHAKE * cb : 0);
    _npSpkSet(sp, 'n' + ch, E.needle[ch], 'transform', 'rotate(' + (-NP_SPK.ANGLE + 2 * NP_SPK.ANGLE * Math.max(-0.03, pos)).toFixed(2) + 'deg)');
    _npSpkSet(sp, 'c' + ch, E.cone[ch], 'transform', 'scale(' + sc.toFixed(4) + ')');
    _npSpkSet(sp, 't' + ch, E.tw[ch], 'transform', 'scale(' + (1 + NP_SPK.TWEET * sp.t[ch]).toFixed(3) + ')');
    _npSpkSet(sp, 'p' + ch, E.peak[ch], 'opacity', sp.pk[ch] > 0 ? '1' : '0.16');
  }
  return moving;
}

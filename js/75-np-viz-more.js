/* =========================================================
   75-np-viz-more.js ― スマホ版：オーディオビジュアライザーの描き方を12種類ふやす（スマホ版 v8.12）
   ・描き方の ID（db.settings.vizModes に入る。PC版と同じ）：
       blob 波打つブロブ／mirror 上下対称バー／ribbon 重なる色の波／hills 塗りの山／dotwave ドット波／pulse 同心円パルス／
       led LEDバー／orbs 光る粒／neon ネオン波形／ring 揺れるリング／updown 上下バー／lines 平行の波線
   ・70-np-viz-trail.js の _npDraw が、選んだ描き方を重ねる順（73 の NVZ_ORDER）に NPV_MORE[ID](o) で呼ぶ。
     o = { g, W, H, col（テーマ色 "r,g,b"）, amp, dt, t（秒）, glow（光を描くか：光オン かつ 動きを減らす設定でない）, cfg, cv, dark, k（バーの数の倍率）, th（太さの倍率）}
   ・色：青・シアン・紫・赤・緑・オレンジのネオンの色（NPV_PAL。ライトのテーマでは濃いめ。スマホ幅はキャンバス全体がうすい〔0.55〕ので、はっきりした色にする）。
     ネオン波形・LEDバーはテーマ色（ジャケットの代表色）も使う
   ・設定の効き方：バーの数 → 線・点・列・玉の数、太さ → 線の太さ・列の幅・点の大きさ、光 → にじむ光（光の調整の「光の量」で明るさ）、
     残像の長さ → LEDバーの浮くピークの点・上下バーの棒の先の点の落ち方（70 の _npvPeaks）。粒の数・はじける高さ → LEDバーではじける粒（70 の _npvEmit・_npvSpark。バー・円と同じ）
   ・円の中心に合わせるもの（ブロブ・同心円パルス・揺れるリング）は 37／68 の _npVizCenter（メインのビジュアルの真ん中。無いときは画面の真ん中）
   ・負荷：配列は使い回し、光は「同じ線を太く・うすく重ねる」か Path2D にまとめて塗る（shadowBlur は使わない）
   ========================================================= */

var NPV_PAL = {
  dark: { blue: '70,150,255', cyan: '40,220,240', purple: '170,110,255', red: '255,80,110', green: '60,230,150', orange: '255,165,60', white: '235,245,255' },
  light: { blue: '25,100,210', cyan: '0,140,170', purple: '120,60,220', red: '215,30,70', green: '0,150,95', orange: '225,115,15', white: '40,50,90' }
};
var npvm = { orbs: null, smA: null, smB: null, lastBands: {} };

/* ---------- 共通の部品 ---------- */
// 周波数を n 本に分けた値（0〜1。低い音から。対数っぽく間引く）。同じフレームで同じ n は使い回す
function _vzBands(n) {
  var c = npvm.lastBands[n];
  if (c && c.stamp === npvm.stamp) return c.v;
  var v = c && c.v.length === n ? c.v : new Float32Array(n), fl = np.freq.length;
  for (var j = 0; j < n; j++) {
    var a0 = Math.floor(Math.pow(j / n, 1.7) * fl * 0.75), a1 = Math.max(a0 + 1, Math.floor(Math.pow((j + 1) / n, 1.7) * fl * 0.75)), s = 0;
    for (var q = a0; q < a1; q++) s += np.freq[q];
    v[j] = s / (a1 - a0) / 255;
  }
  npvm.lastBands[n] = { stamp: npvm.stamp, v: v };
  return v;
}
// 低・中・高の音の強さ（0〜1）
function _vzLevels() {
  var b = _vzBands(12);
  return { low: (b[0] + b[1] + b[2]) / 3, mid: (b[4] + b[5] + b[6]) / 3, high: (b[8] + b[9] + b[10]) / 3, all: (b[0] + b[2] + b[4] + b[6] + b[8]) / 5 };
}
// 時間の波形を P 点に間引いて、前のフレームの形へなめらかに近づけた配列（-1〜1）。name ごとに別の入れ物
function _vzWave(name, P, follow, dt) {
  var w = np.wave, n = w.length, win = Math.min(1024, n), start = 0, lim = n - win;
  for (var i = 1; i < lim; i++) { if (w[i - 1] < 128 && w[i] >= 128) { start = i; break; } }
  var sm = npvm[name] && npvm[name].length === P ? npvm[name] : (npvm[name] = new Float32Array(P));
  var kk = 1 - Math.pow(1 - follow, Math.max(0.25, dt * 60)), step = win / (P - 1);
  for (var p = 0; p < P; p++) { var t = (w[start + Math.min(win - 1, Math.round(p * step))] - 128) / 128; sm[p] += (t - sm[p]) * kk; }
  return sm;
}
// 点の並び（xs, ys）を2次曲線でなめらかにつないだ線を path に足す（closed：輪にする）
function _vzSmooth(g, xs, ys, n, closed) {
  if (closed) {
    g.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
    for (var i = 0; i < n; i++) { var j = (i + 1) % n; g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2); }
    g.closePath();
  } else {
    g.moveTo(xs[0], ys[0]);
    for (var q = 1; q < n - 1; q++) g.quadraticCurveTo(xs[q], ys[q], (xs[q] + xs[q + 1]) / 2, (ys[q] + ys[q + 1]) / 2);
    g.lineTo(xs[n - 1], ys[n - 1]);
  }
}
var _vzX = new Float32Array(512), _vzY = new Float32Array(512);
// 光るように線を描く（光：同じ線を太く・うすく2回重ねてから芯）。pathFn(g) で線を作る
function _vzGlowStroke(o, pathFn, rgb, lw, alpha) {
  var g = o.g;
  g.beginPath(); pathFn(g);
  if (o.glow) {
    if (o.dark) g.globalCompositeOperation = 'lighter';
    g.lineWidth = lw * 5; g.strokeStyle = 'rgba(' + rgb + ',' + _npvA(o.dark ? 0.10 : 0.07) + ')'; g.stroke();
    g.lineWidth = lw * 2.4; g.strokeStyle = 'rgba(' + rgb + ',' + _npvA(o.dark ? 0.22 : 0.14) + ')'; g.stroke();
    g.globalCompositeOperation = 'source-over';
  }
  g.lineWidth = lw; g.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')'; g.stroke();
}
function _vzCenter(o, fallbackY) {
  var c = typeof _npVizCenter === 'function' ? _npVizCenter(o.cv) : null;
  return c ? c : { x: o.W / 2, y: o.H * (fallbackY || 0.45), r: Math.min(o.W, o.H) * 0.22 };
}
function _vzUnit(o) { return Math.max(1.5, Math.min(o.W, o.H) / 300); }

var NPV_MORE = {};

/* ---------- 1. 波打つブロブ：音で輪郭がうねる、何重もの細い線の輪 ---------- */
NPV_MORE.blob = function (o) {
  var g = o.g, c = _vzCenter(o), P = 72, lv = _vzLevels(), n = Math.max(3, Math.round(6 * o.k)), t = o.t, u = _vzUnit(o);
  var R = Math.max(c.r * 1.12, Math.min(o.W, o.H) * 0.2), pal = o.pal;
  for (var i = 0; i < n; i++) {
    var f = i / (n - 1), ri = R * (0.62 + 0.5 * f);
    for (var p = 0; p < P; p++) {
      var th = p / P * Math.PI * 2;
      var d = lv.low * 0.55 * Math.sin(2 * th + t * 0.7 + i * 0.35) + lv.mid * 0.45 * Math.sin(3 * th - t * 0.9 + i * 0.25) + lv.high * 0.35 * Math.sin(5 * th + t * 1.4 - i * 0.2) + 0.05 * Math.sin(4 * th + t * 0.5);
      var rr = ri * (1 + d * 0.32 * o.amp);
      _vzX[p] = c.x + Math.cos(th) * rr; _vzY[p] = c.y + Math.sin(th) * rr;
    }
    var rgb = f < 0.5 ? pal.blue : pal.cyan, al = (0.35 + 0.5 * (1 - Math.abs(f - 0.6))).toFixed(3);
    if (i === n - 1) _vzGlowStroke(o, function (gg) { _vzSmooth(gg, _vzX, _vzY, P, true); }, rgb, u * 0.9 * o.th, al);
    else { g.beginPath(); _vzSmooth(g, _vzX, _vzY, P, true); g.lineWidth = u * 0.6 * o.th; g.strokeStyle = 'rgba(' + rgb + ',' + al + ')'; g.stroke(); }
  }
};

/* ---------- 2. 上下対称バー：中央の横線から上下に伸びる細い線の密集 ---------- */
NPV_MORE.mirror = function (o) {
  var g = o.g, W = o.W, H = o.H, u = _vzUnit(o), n = Math.max(24, Math.min(240, Math.round(W / 9 * o.k))), half = Math.ceil(n / 2), b = _vzBands(half), mid = H * 0.55, A = H * 0.2 * o.amp, gap = W / n, pal = o.pal;
  var path = [new Path2D(), new Path2D()];
  for (var i = 0; i < n; i++) {
    var d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2), v = b[Math.min(half - 1, Math.floor(d * half))];
    var h = Math.max(1, v * A * (1.1 - d * 0.5) * (0.75 + 0.25 * Math.sin(i * 1.7 + o.t * 3)));
    var x = i * gap + gap / 2, pp = path[d < 0.45 ? 0 : 1];
    pp.moveTo(x, mid - h); pp.lineTo(x, mid + h);
  }
  g.lineCap = 'butt';
  [[path[0], pal.red], [path[1], pal.orange]].forEach(function (x) {
    if (o.glow) { if (o.dark) g.globalCompositeOperation = 'lighter'; g.lineWidth = Math.max(2, gap * 0.9) * o.th; g.strokeStyle = 'rgba(' + x[1] + ',' + _npvA(o.dark ? 0.12 : 0.08) + ')'; g.stroke(x[0]); g.globalCompositeOperation = 'source-over'; }
    g.lineWidth = Math.max(1, gap * 0.38) * o.th; g.strokeStyle = 'rgba(' + x[1] + ',0.85)'; g.stroke(x[0]);
  });
  g.lineCap = 'round';
  g.fillStyle = 'rgba(' + pal.orange + ',0.6)'; g.fillRect(0, mid - Math.max(1, u * 0.4), W, Math.max(1.5, u * 0.8));   // 中央の横線
};

/* ---------- 3. 重なる色の波：2〜3色の滑らかな波線が交差・ねじれる帯 ---------- */
NPV_MORE.ribbon = function (o) {
  var g = o.g, W = o.W, H = o.H, u = _vzUnit(o), lv = _vzLevels(), mid = H * 0.55, P = 64, S = Math.max(3, Math.round(5 * o.k)), pal = o.pal, t = o.t;
  var cols = [[pal.green, lv.low, 1.0, 0], [pal.blue, lv.mid, 1.35, 2.1], [pal.purple, lv.high, 0.8, 4.2]];
  cols.forEach(function (cc) {
    var A = H * (0.06 + cc[1] * 0.16) * o.amp;
    for (var s = 0; s < S; s++) {
      var tw = Math.cos(s / S * Math.PI + t * 0.6 + cc[3]);   // ねじれ（帯の幅が場所で変わる）
      for (var p = 0; p < P; p++) {
        var x = p / (P - 1) * W, ph = x / W * Math.PI * 2 * cc[2] + t * 0.9 + cc[3];
        _vzX[p] = x; _vzY[p] = mid + Math.sin(ph) * A * (0.6 + 0.4 * tw * Math.cos(ph * 0.5 + s * 0.4));
      }
      var al = s === Math.floor(S / 2) ? 0.9 : 0.35;
      if (s === Math.floor(S / 2)) _vzGlowStroke(o, function (gg) { _vzSmooth(gg, _vzX, _vzY, P, false); }, cc[0], u * 0.9 * o.th, al);
      else { g.beginPath(); _vzSmooth(g, _vzX, _vzY, P, false); g.lineWidth = u * 0.45 * o.th; g.strokeStyle = 'rgba(' + cc[0] + ',' + al + ')'; g.stroke(); }
    }
  });
};

/* ---------- 4. 塗りの山：半透明の色の山（低・中・高音）が重なる ---------- */
NPV_MORE.hills = function (o) {
  var g = o.g, W = o.W, H = o.H, b = _vzBands(18), base = H, P = 48, t = o.t, pal = o.pal;
  var layers = [[pal.red, 0, 6, 0.18], [pal.blue, 6, 12, 0.45], [pal.green, 12, 18, 0.72]];
  layers.forEach(function (L, li) {
    for (var p = 0; p < P; p++) {
      var x = p / (P - 1) * W, y = 0;
      for (var j = L[1]; j < L[2]; j++) {   // 帯の数だけ山（位置はゆっくり動く）
        var cx = W * (L[3] + (j - L[1] - 2.5) * 0.09 + 0.04 * Math.sin(t * 0.3 + j)), w = W * 0.07;
        y += b[j] * Math.exp(-((x - cx) * (x - cx)) / (2 * w * w));
      }
      _vzX[p] = x; _vzY[p] = base - Math.min(1.2, y) * H * 0.42 * o.amp;
    }
    g.beginPath(); g.moveTo(0, base); g.lineTo(_vzX[0], _vzY[0]);
    for (var q = 1; q < P - 1; q++) g.quadraticCurveTo(_vzX[q], _vzY[q], (_vzX[q] + _vzX[q + 1]) / 2, (_vzY[q] + _vzY[q + 1]) / 2);
    g.lineTo(_vzX[P - 1], _vzY[P - 1]); g.lineTo(W, base); g.closePath();
    var gr = g.createLinearGradient(0, base - H * 0.45, 0, base);
    gr.addColorStop(0, 'rgba(' + L[0] + ',' + (o.dark ? 0.55 : 0.45) + ')'); gr.addColorStop(1, 'rgba(' + L[0] + ',0.08)');
    g.fillStyle = gr; g.fill();
    if (o.glow) {   // 稜線を光らせる
      g.beginPath(); _vzSmooth(g, _vzX, _vzY, P, false);
      if (o.dark) g.globalCompositeOperation = 'lighter';
      g.lineWidth = _vzUnit(o) * 1.2 * o.th; g.strokeStyle = 'rgba(' + L[0] + ',' + _npvA(o.dark ? 0.7 : 0.5) + ')'; g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
  });
};

/* ---------- 5. ドット波：点を並べた波形 ---------- */
NPV_MORE.dotwave = function (o) {
  var g = o.g, W = o.W, H = o.H, u = _vzUnit(o), P = Math.max(24, Math.min(200, Math.round(72 * o.k))), sm = _vzWave('smDot', P, o.reduced ? 0.4 : 0.2, o.dt), mid = H * 0.55, A = H * 0.3 * o.amp, pal = o.pal;
  var core = new Path2D(), halo = new Path2D(), echo = new Path2D(), r = u * 1.3 * o.th;
  for (var p = 0; p < P; p++) {
    var x = (p + 0.5) / P * W, y = mid + sm[p] * A, e = mid + sm[p] * A * 0.55 + Math.sin(p * 0.7 + o.t * 2) * u * 3;
    core.moveTo(x + r, y); core.arc(x, y, r, 0, 6.283);
    halo.moveTo(x + r * 3, y); halo.arc(x, y, r * 3, 0, 6.283);
    echo.moveTo(x + r * 0.7, e); echo.arc(x, e, r * 0.7, 0, 6.283);
  }
  g.fillStyle = 'rgba(' + pal.cyan + ',0.35)'; g.fill(echo);
  if (o.glow) { if (o.dark) g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(' + pal.blue + ',' + _npvA(o.dark ? 0.16 : 0.1) + ')'; g.fill(halo); g.globalCompositeOperation = 'source-over'; }
  g.fillStyle = 'rgba(' + pal.blue + ',0.9)'; g.fill(core);
};

/* ---------- 6. 同心円パルス：ドットの同心円が鼓動し、中心が光る ---------- */
NPV_MORE.pulse = function (o) {
  var g = o.g, c = _vzCenter(o), lv = _vzLevels(), u = _vzUnit(o), n = Math.max(3, Math.round(4 * o.k)), pal = o.pal;
  // 輪はメインのビジュアルの縁のすぐ外から広がる（内側はジャケット・CD に隠れるため）
  var R0 = Math.max(c.r * 1.06, Math.min(o.W, o.H) * 0.08), span = Math.min(o.W, o.H) * 0.34, beat = 1 + lv.low * 0.25 * o.amp, r0 = u * 1.7 * o.th;
  for (var i = 0; i < n; i++) {
    var f = n > 1 ? i / (n - 1) : 0, rr = (R0 + span * f) * (1 + (beat - 1) * (1 - f * 0.5)), m = Math.round(18 + 16 * (i + 1) * o.k), p = new Path2D(), halo = new Path2D(), rot = o.t * 0.2 * (i % 2 ? 1 : -1);
    var rd = r0 * (1.25 - f * 0.45) * (0.85 + lv.all * 0.6);
    for (var j = 0; j < m; j++) { var a = j / m * Math.PI * 2 + rot, x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr; p.moveTo(x + rd, y); p.arc(x, y, rd, 0, 6.283); if (o.glow) { halo.moveTo(x + rd * 2.6, y); halo.arc(x, y, rd * 2.6, 0, 6.283); } }
    var rgb = i % 2 ? pal.cyan : pal.blue;
    if (o.glow) { if (o.dark) g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(' + rgb + ',' + _npvA(o.dark ? 0.14 : 0.1) + ')'; g.fill(halo); g.globalCompositeOperation = 'source-over'; }
    g.fillStyle = 'rgba(' + rgb + ',' + (1 - f * 0.45).toFixed(3) + ')'; g.fill(p);
  }
  var R = R0 + span;
  // 中心の光（音が大きいほど大きく）
  var cr = R * (0.12 + lv.all * 0.25 * o.amp), gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, cr * (o.glow ? 2.2 : 1.2));
  gr.addColorStop(0, 'rgba(' + pal.white + ',' + (o.dark ? 0.95 : 0.8) + ')'); gr.addColorStop(0.35, 'rgba(' + pal.cyan + ',' + (o.glow ? _npvA(0.6) : '0.5') + ')'); gr.addColorStop(1, 'rgba(' + pal.cyan + ',0)');
  if (o.dark) g.globalCompositeOperation = 'lighter';
  g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, cr * (o.glow ? 2.2 : 1.2), 0, 6.283); g.fill();
  g.globalCompositeOperation = 'source-over';
};

/* ---------- 7. LEDバー：段で光るバー＋上に浮くピークの点 ---------- */
NPV_MORE.led = function (o) {
  var g = o.g, W = o.W, H = o.H, n = Math.max(8, Math.min(64, Math.round(W / 46 * o.k))), b = _vzBands(n), gap = W / n, bw = gap * Math.min(0.92, 0.62 * o.th), cells = 18, ch = H * 0.5 / cells, pal = o.pal;
  var pk = _npvPeaks(b, n, 'ledPk', 'ledHold', o.dt, false);
  // 光オンのとき：ピークの点から粒がはじける（粒の数・はじける高さが効く。バーと同じ作り）
  if (o.glow) {
    if (!npvm.ledPrev || npvm.ledPrev.length !== n) { npvm.ledPrev = new Float32Array(n); npvm.ledLo = new Float32Array(n); }
    var sz = Math.max(2.6, bw * 0.17);
    _npvEmit(pk, npvm.ledPrev, b, npvm.ledLo, n, o.dt, function (i, power, e) {
      var x0 = i * gap + gap / 2 + (Math.random() - 0.5) * bw * 0.6, y0 = H - Math.min(cells, pk[i] * cells * o.amp * 1.1 + 1) * ch;
      if (e < 0) { _npvSpark(x0, y0, 0, -1, H * 0.3 * power, sz); return; }
      var bv = _npvBurstV(e, H, H * 0.05, y0 + H * 0.12);
      _npvSpark(x0, y0, 0, -1, bv.v, sz * (1 + e * 0.8), 0.9 * (1 - e * 0.6), bv.life, e);
    }, 'riseLed');
  }
  var lit = [new Path2D(), new Path2D(), new Path2D()], dim = new Path2D(), peaks = new Path2D();
  for (var i = 0; i < n; i++) {
    var x = i * gap + (gap - bw) / 2, on = Math.round(b[i] * cells * o.amp * 1.1);
    for (var c = 0; c < cells; c++) {
      var y = H - (c + 1) * ch + ch * 0.18, h = ch * 0.64;
      if (c < on) lit[c < cells * 0.5 ? 0 : c < cells * 0.8 ? 1 : 2].rect(x, y, bw, h); else if (c < on + 3) dim.rect(x, y, bw, h);
    }
    var py = H - Math.min(cells, pk[i] * cells * o.amp * 1.1 + 1) * ch - ch * 0.4;
    peaks.rect(x, py, bw, ch * 0.45);
  }
  g.fillStyle = 'rgba(' + o.col + ',0.12)'; g.fill(dim);
  g.fillStyle = 'rgba(' + pal.cyan + ',0.85)'; g.fill(lit[0]);
  g.fillStyle = 'rgba(' + o.col + ',0.9)'; g.fill(lit[1]);
  g.fillStyle = 'rgba(' + pal.purple + ',0.95)'; g.fill(lit[2]);
  if (o.glow) { if (o.dark) g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(' + pal.white + ',' + _npvA(0.95) + ')'; g.fill(peaks); g.globalCompositeOperation = 'source-over'; }
  else { g.fillStyle = 'rgba(' + pal.white + ',0.8)'; g.fill(peaks); }
};

/* ---------- 8. 光る粒：色とりどりの玉が漂い、音で膨らむ ---------- */
NPV_MORE.orbs = function (o) {
  var g = o.g, W = o.W, H = o.H, u = _vzUnit(o), N = Math.max(6, Math.min(40, Math.round(16 * o.k))), b = _vzBands(16), pal = o.pal;
  var cs = [pal.blue, pal.cyan, pal.purple, pal.red, pal.green, pal.orange];
  if (!npvm.orbs || npvm.orbs.length !== N) {
    npvm.orbs = [];
    for (var i = 0; i < N; i++) npvm.orbs.push({ x: Math.random() * W, y: H * (0.2 + Math.random() * 0.65), vx: (Math.random() - 0.5) * W * 0.03, vy: (Math.random() - 0.5) * H * 0.02, c: i % cs.length, band: i % 16, ph: Math.random() * 6.28 });
  }
  var sp = o.reduced ? 0.3 : 1;
  if (o.dark) g.globalCompositeOperation = 'lighter';
  npvm.orbs.forEach(function (p) {
    p.vx += (Math.random() - 0.5) * W * 0.01 * o.dt; p.vy += (Math.random() - 0.5) * H * 0.01 * o.dt;
    p.vx *= 0.995; p.vy *= 0.995;
    p.x += p.vx * o.dt * sp; p.y += p.vy * o.dt * sp;
    if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
    if (p.y < H * 0.12) p.vy = Math.abs(p.vy); if (p.y > H * 0.9) p.vy = -Math.abs(p.vy);
    var v = b[p.band], r = u * (2 + v * 7 * o.amp) * o.th * (0.9 + 0.1 * Math.sin(o.t * 2 + p.ph)), rgb = cs[p.c];
    if (o.glow) { g.fillStyle = 'rgba(' + rgb + ',' + _npvA(o.dark ? 0.16 : 0.12) + ')'; g.beginPath(); g.arc(p.x, p.y, r * 2.8, 0, 6.283); g.fill(); }
    g.fillStyle = 'rgba(' + rgb + ',' + (0.55 + v * 0.45).toFixed(3) + ')'; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.fill();
  });
  g.globalCompositeOperation = 'source-over';
};

/* ---------- 9. ネオン波形：光る1本の滑らかな線 ---------- */
NPV_MORE.neon = function (o) {
  var W = o.W, H = o.H, u = _vzUnit(o), P = 110, sm = _vzWave('smNeon', P, o.reduced ? 0.4 : 0.22, o.dt), mid = H * 0.55, A = H * 0.32 * o.amp;
  for (var p = 0; p < P; p++) { _vzX[p] = p / (P - 1) * W; _vzY[p] = mid + sm[p] * A * (0.35 + 0.65 * Math.sin(p / (P - 1) * Math.PI)); }
  _vzGlowStroke(o, function (gg) { _vzSmooth(gg, _vzX, _vzY, P, false); }, o.col, u * 1.4 * o.th, '0.95');
  if (o.dark) { o.g.beginPath(); _vzSmooth(o.g, _vzX, _vzY, P, false); o.g.lineWidth = u * 0.5 * o.th; o.g.strokeStyle = 'rgba(255,250,245,0.85)'; o.g.stroke(); }   // 白い芯
};

/* ---------- 10. 揺れるリング：ぎざぎざに震える輪 ---------- */
NPV_MORE.ring = function (o) {
  var c = _vzCenter(o), lv = _vzLevels(), u = _vzUnit(o), P = Math.max(60, Math.min(360, Math.round(180 * o.k))), w = np.wave, wl = w.length, pal = o.pal;
  var R = Math.max(c.r * 1.25, Math.min(o.W, o.H) * 0.24);
  [[0, pal.red, 1], [97, pal.purple, 0.55]].forEach(function (L) {
    for (var p = 0; p < P; p++) {
      var a = p / P * Math.PI * 2, s = (w[(p * 5 + L[0]) % wl] - 128) / 128;
      var rr = R * (1 + (s * 0.18 + Math.sin(a * 7 + o.t * 2) * 0.015) * (0.4 + lv.all * 1.6) * o.amp);
      _vzX[p] = c.x + Math.cos(a) * rr; _vzY[p] = c.y + Math.sin(a) * rr;
    }
    _vzGlowStroke(o, function (gg) { gg.moveTo(_vzX[0], _vzY[0]); for (var q = 1; q < P; q++) gg.lineTo(_vzX[q], _vzY[q]); gg.closePath(); }, L[1], u * (L[2] > 0.9 ? 1.2 : 0.7) * o.th, L[2].toFixed(2));
  });
};

/* ---------- 11. 上下バー：上に伸びる棒と、下に反転して散る点 ---------- */
NPV_MORE.updown = function (o) {
  var g = o.g, W = o.W, H = o.H, u = _vzUnit(o), n = Math.max(12, Math.min(96, Math.round(W / 22 * o.k))), b = _vzBands(n), gap = W / n, y0 = H * 0.66, pal = o.pal;
  var up = new Path2D(), dots = new Path2D(), tips = new Path2D(), r = u * 1.4 * o.th;
  var pk = _npvPeaks(b, n, 'udPk', 'udHold', o.dt, !o.glow);   // 棒の先の点（残像の長さで落ち方が変わる。光オフでは今の高さ）
  for (var i = 0; i < n; i++) {
    var x = i * gap + gap / 2, v = b[i], h = Math.max(2, v * H * 0.3 * o.amp);
    up.moveTo(x, y0); up.lineTo(x, y0 - h);
    var ph = Math.max(2, pk[i] * H * 0.3 * o.amp) + u * 2.5; tips.moveTo(x + r, y0 - ph); tips.arc(x, y0 - ph, r, 0, 6.283);
    var m = Math.round(v * 6 * o.amp);
    for (var j = 0; j < m; j++) {
      var dy = (j + 1) * u * 6 * (0.8 + v), dx = Math.sin(i * 12.9898 + j * 78.233) * gap * 0.45;
      dots.moveTo(x + dx + r, y0 + dy); dots.arc(x + dx, y0 + dy, r * (1 - j / 8), 0, 6.283);
    }
  }
  g.lineCap = 'butt';
  if (o.glow) { if (o.dark) g.globalCompositeOperation = 'lighter'; g.lineWidth = gap * 0.7 * o.th; g.strokeStyle = 'rgba(' + pal.blue + ',' + _npvA(o.dark ? 0.14 : 0.1) + ')'; g.stroke(up); g.globalCompositeOperation = 'source-over'; }
  g.lineWidth = Math.max(1.5, gap * 0.28) * o.th; g.strokeStyle = 'rgba(' + pal.blue + ',0.9)'; g.stroke(up);
  g.lineCap = 'round';
  g.fillStyle = 'rgba(' + pal.red + ',0.85)'; g.fill(dots);
  if (o.dark && o.glow) g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(' + pal.cyan + ',' + (o.glow ? _npvA(0.95) : '0.8') + ')'; g.fill(tips);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(' + pal.blue + ',0.5)'; g.fillRect(0, y0, W, Math.max(1, u * 0.5));
};

/* ---------- 12. 平行の波線：3本の波線が少しずつ遅れて揺れる ---------- */
NPV_MORE.lines = function (o) {
  var W = o.W, H = o.H, u = _vzUnit(o), lv = _vzLevels(), P = 64, gapY = H * 0.07, mid = H * 0.55, pal = o.pal, t = o.t;
  var lvls = [lv.low, lv.mid, lv.high];
  for (var i = 0; i < 3; i++) {
    var y0 = mid + (i - 1) * gapY, A = gapY * (0.25 + lvls[i] * 1.1) * o.amp, wl = 3 + o.k * 2;
    for (var p = 0; p < P; p++) { var x = p / (P - 1) * W; _vzX[p] = x; _vzY[p] = y0 + Math.sin(x / W * Math.PI * 2 * wl - t * 2.2 + i * 0.7) * A; }
    _vzGlowStroke(o, function (gg) { _vzSmooth(gg, _vzX, _vzY, P, false); }, i === 1 ? pal.white : pal.green, u * 1.1 * o.th, '0.9');
  }
};

// 70 の _npDraw から呼ぶ入口（id：描き方、base：o の元になる値）
function npvDrawMore(id, base) {
  var f = NPV_MORE[id];
  if (!f) return;
  npvm.stamp = base.stamp;
  var cfg = base.cfg;
  var o = Object.assign({}, base, {
    t: (performance.now() / 1000) * (base.reduced ? 0.35 : 1),
    k: (typeof NVZ_BARS !== 'undefined' && NVZ_BARS[cfg.bars]) ? NVZ_BARS[cfg.bars].k : 1,
    th: (typeof NVZ_THICK !== 'undefined' && NVZ_THICK[cfg.thick]) ? NVZ_THICK[cfg.thick].line : 1,
    pal: base.dark ? NPV_PAL.dark : NPV_PAL.light
  });
  f(o);
}

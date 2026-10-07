/* =========================================================
   70-np-viz-trail.js ― スマホ版：オーディオビジュアライザーの「残像」と、ゆったりした「波形」（スマホ版 v8.9.5）
   ・37-now-playing.js の描く関数 _npDraw を置き換える（音のつなぎ方・色・円の中心〔_npVizCenter〕・描くきっかけは 37 のまま）
   ・バー・円：棒ごとに「ピーク」（少し前のいちばん高い値）を覚えておき、ゆっくり下げる（1秒で約 TRAIL_FALL）。
     今の棒の先からピークまでを、うすいグラデーションの「尾」で塗り、ピークの所に細い線（キャップ）を置く。
     キャンバスを前のフレームと重ね塗りしないので、背景（ジャケットの色・プレイヤー表示）に色が溜まって汚れることはない
     一時停止すると今の棒は下がり、尾とキャップがゆっくり落ちて消える
   ・波形：① オシロスコープのように、上向きに 0 を横切る所から描き始めて左右のぶれを止める ② 1024 サンプル分を WAVE_POINTS 点に間引く
     ③ 点ごとに前のフレームの値へ WAVE_FOLLOW の割合だけ近づける（時間方向のなめらかさ）④ 点と点を2次曲線でなめらかにつなぐ。
     振幅は音の大きさに合わせるので、音に反応している感じは残る
   ・動きを減らす設定（np.reduced）：尾を出さず（ピーク＝今の値）、波形はもっとゆっくり（WAVE_FOLLOW_REDUCED）。描く回数は 37 のまま（約8回/秒）
   ・負荷：配列は1回だけ作って使い回す。描くのはバー最大96本＋尾・波形 WAVE_POINTS 点だけ
   ========================================================= */

var NPV_TRAIL_FALL = 0.55;        // ピークが1秒で下がる量（0〜1。1＝棒の一番上から下まで）
var NPV_TRAIL_HOLD = 0.12;        // ピークを下げ始めるまでの時間（秒）
var NPV_WAVE_POINTS = 96;         // 波形の点の数（今までは 1024 点）
var NPV_WAVE_WINDOW = 1024;       // 波形に使うサンプル数（2048 のうち）
var NPV_WAVE_FOLLOW = 0.18;       // 波形が1フレーム（60fps 換算）で今の形へ近づく割合
var NPV_WAVE_FOLLOW_REDUCED = 0.5;   // 動きを減らす設定（描く回数が少ないので1回で多めに）
var npv = { peak: null, hold: null, cpeak: null, chold: null, waveS: null, lastT: 0 };

function _npvArr(name, n) { if (!npv[name] || npv[name].length !== n) npv[name] = new Float32Array(n); return npv[name]; }
// ピークを今の値まで上げる・時間とともに下げる。返り値はピークの配列
function _npvPeaks(vals, n, pName, hName, dt, reduced) {
  var pk = _npvArr(pName, n), hd = _npvArr(hName, n), fall = NPV_TRAIL_FALL * dt;
  for (var i = 0; i < n; i++) {
    var v = vals[i];
    if (reduced || v >= pk[i]) { pk[i] = v; hd[i] = NPV_TRAIL_HOLD; }
    else if (hd[i] > 0) hd[i] -= dt;
    else pk[i] = Math.max(v, pk[i] - fall);
  }
  return pk;
}
var _npvBarVals = null, _npvCircVals = null;

var _npDrawV1 = window._npDraw;   // 37 の今までの描き方（比べるときのために残す。使っていない）
window._npDraw = function () {
  var cv = document.getElementById('np-viz');
  if (!cv || !cv.width) return;
  var g = cv.getContext('2d'), W = cv.width, H = cv.height;
  var now = performance.now(), dt = npv.lastT ? Math.min(0.25, (now - npv.lastT) / 1000) : 1 / 60;
  npv.lastT = now;
  g.clearRect(0, 0, W, H);
  var col = _npColor(), amp = np.reduced ? 0.5 : 1, reduced = !!np.reduced;
  if (np.analyser) { np.analyser.getByteFrequencyData(np.freq); np.analyser.getByteTimeDomainData(np.wave); }
  else { np.freq = np.freq || new Uint8Array(1024); np.wave = np.wave || new Uint8Array(2048).fill(128); }
  var mode = npMode();
  if (mode === 'wave') _npvDrawWave(g, W, H, col, amp, dt, reduced);
  else if (mode === 'circle') _npvDrawCircle(g, W, H, col, amp, dt, reduced, cv);
  else _npvDrawBars(g, W, H, col, amp, dt, reduced);
};

/* ---------- バー ---------- */
function _npvDrawBars(g, W, H, col, amp, dt, reduced) {
  var nb = Math.max(24, Math.min(96, Math.floor(W / 18))), gap = W / nb, bw = gap * 0.7, fl = np.freq.length;
  if (!_npvBarVals || _npvBarVals.length !== nb) _npvBarVals = new Float32Array(nb);
  for (var j = 0; j < nb; j++) {
    var a0 = Math.floor(Math.pow(j / nb, 1.7) * fl * 0.75), a1 = Math.max(a0 + 1, Math.floor(Math.pow((j + 1) / nb, 1.7) * fl * 0.75)), s = 0;
    for (var q = a0; q < a1; q++) s += np.freq[q];
    _npvBarVals[j] = s / (a1 - a0) / 255;
  }
  var pk = _npvPeaks(_npvBarVals, nb, 'peak', 'hold', dt, reduced), full = H * 0.55 * amp, capH = Math.max(2, H / 300);
  for (var k = 0; k < nb; k++) {
    var vv = _npvBarVals[k], bh = Math.max(2, vv * full), x = k * gap + (gap - bw) / 2;
    // 尾：今の棒の先からピークまで、上ほどうすく
    var ph = pk[k] * full;
    if (!reduced && ph > bh + 1) {
      var tg = g.createLinearGradient(0, H - ph, 0, H - bh);
      tg.addColorStop(0, 'rgba(' + col + ',0.04)');
      tg.addColorStop(1, 'rgba(' + col + ',' + (0.12 + vv * 0.25).toFixed(3) + ')');
      g.fillStyle = tg;
      g.fillRect(x, H - ph, bw, ph - bh);
    }
    g.fillStyle = 'rgba(' + col + ',' + (0.25 + vv * 0.6).toFixed(3) + ')';
    g.fillRect(x, H - bh, bw, bh);
    // キャップ：ピークの所の細い線（下がるほどうすく）
    if (!reduced && pk[k] > 0.02) {
      g.fillStyle = 'rgba(' + col + ',' + (0.3 + pk[k] * 0.5).toFixed(3) + ')';
      g.fillRect(x, H - ph - capH, bw, capH);
    }
  }
}

/* ---------- 円 ---------- */
function _npvDrawCircle(g, W, H, col, amp, dt, reduced, cv) {
  var vc = _npVizCenter(cv);
  var cx = vc ? vc.x : W / 2, cy = vc ? vc.y : H / 2, r0 = Math.max(Math.min(W, H) * 0.22, vc ? vc.r : 0), bars = 96, fl = np.freq.length;
  if (!_npvCircVals || _npvCircVals.length !== bars) _npvCircVals = new Float32Array(bars);
  for (var k = 0; k < bars; k++) _npvCircVals[k] = np.freq[Math.floor(Math.pow(k / bars, 1.6) * fl * 0.7)] / 255;
  var pk = _npvPeaks(_npvCircVals, bars, 'cpeak', 'chold', dt, reduced);
  var lw = Math.max(2, Math.min(W, H) / 160);
  g.lineCap = 'round';
  for (var i = 0; i < bars; i++) {
    var v = _npvCircVals[i], len = r0 * 0.9 * v * amp + 2, plen = r0 * 0.9 * pk[i] * amp + 2, ang = i / bars * Math.PI * 2 - Math.PI / 2;
    var c = Math.cos(ang), s = Math.sin(ang);
    // 尾：今の線の先からピークまで、細くうすく
    if (!reduced && plen > len + 2) {
      g.lineWidth = lw * 0.8;
      g.strokeStyle = 'rgba(' + col + ',' + (0.08 + pk[i] * 0.22).toFixed(3) + ')';
      g.beginPath(); g.moveTo(cx + c * (r0 + len), cy + s * (r0 + len)); g.lineTo(cx + c * (r0 + plen), cy + s * (r0 + plen)); g.stroke();
      // ピークの点
      g.fillStyle = 'rgba(' + col + ',' + (0.25 + pk[i] * 0.5).toFixed(3) + ')';
      g.beginPath(); g.arc(cx + c * (r0 + plen), cy + s * (r0 + plen), lw * 0.75, 0, Math.PI * 2); g.fill();
    }
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(' + col + ',' + (0.35 + v * 0.6).toFixed(3) + ')';
    g.beginPath(); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * (r0 + len), cy + s * (r0 + len)); g.stroke();
  }
}

/* ---------- 波形 ---------- */
function _npvDrawWave(g, W, H, col, amp, dt, reduced) {
  var w = np.wave, n = w.length, win = Math.min(NPV_WAVE_WINDOW, n), P = NPV_WAVE_POINTS;
  // 上向きに 0（128）を横切る所から描き始める（左右のぶれを止める）
  var start = 0, lim = n - win;
  for (var i = 1; i < lim; i++) { if (w[i - 1] < 128 && w[i] >= 128) { start = i; break; } }
  var sm = _npvArr('waveS', P);
  var follow = reduced ? NPV_WAVE_FOLLOW_REDUCED : NPV_WAVE_FOLLOW;
  var k = 1 - Math.pow(1 - follow, Math.max(0.25, dt * 60));   // 描く間隔が変わっても同じ速さで近づく
  var step = win / (P - 1);
  for (var p = 0; p < P; p++) {
    var t = (w[start + Math.min(win - 1, Math.round(p * step))] - 128) / 128;
    sm[p] += (t - sm[p]) * k;
  }
  var mid = H * 0.55, A = H * 0.35 * amp, dx = W / (P - 1);
  g.lineWidth = Math.max(2, W / 500); g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(' + col + ',0.85)';
  g.beginPath();
  g.moveTo(0, mid + sm[0] * A);
  for (var q = 1; q < P - 1; q++) {
    var x0 = q * dx, y0 = mid + sm[q] * A, x1 = (q + 1) * dx, y1 = mid + sm[q + 1] * A;
    g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);   // 点と点の中点を通る2次曲線（なめらか）
  }
  g.lineTo(W, mid + sm[P - 1] * A);
  g.stroke();
}

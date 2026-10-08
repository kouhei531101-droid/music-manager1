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
   ・負荷：配列は1回だけ作って使い回す。描くのはバー最大56本・円96本（v8.9.6〜8.9.7 は56本。スマホ版 v8.10 で 37 と同じ96本に戻した）＋尾・粒（最大 NPV_SPARK_MAX 個）・波形 WAVE_POINTS 点だけ
   ・スマホ版 v8.9.6：花火のように光る残像（光るキャップ・はじける粒）。下の「花火のように光る残像」
   ・スマホ版 v8.9.7：はじける高さを上がり方で変える（強いほど高く、最大は画面の上端を超える）。NPV_RISE_* ・ _npvBurstV
   ・スマホ版 v8.11：描き方を組み合わせられる（73-np-viz-settings.js の npVizCfg()。PC版 v8.7.8 と同じ保存の形）。
     重ねる順（奥から）：円 → バー → 波形 → 光の粒（粒はまとめて1回だけ動かして描く）。「なし」は何も描かない
     バーの数・円の線の本数（NVZ_BARS）・太さ（NVZ_THICK）を設定から。光がオフ（cfg.glow）のときは、残像・光る先端・粒を出さない
     （動きを減らす設定と同じ描き方。振幅は変えない）。波形はゆったりした描き方（96点・なめらか）のまま、光がオンなら線のまわりにうすい光
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
  // スマホ版 v8.11：組み合わせ（奥から 円 → バー → 波形 → 光の粒）。plain：残像・光る先端・粒を出さない（光がオフ・動きを減らす設定）
  var cfg = typeof npVizCfg === 'function' ? npVizCfg() : { modes: [npMode()], bars: 'normal', thick: 'normal', glow: true };
  if (!cfg.modes.length) { _npvSparksClear(); return; }
  var plain = reduced || !cfg.glow, sparkle = !plain && (cfg.modes.indexOf('bars') >= 0 || cfg.modes.indexOf('circle') >= 0);
  if (!sparkle) _npvSparksClear();   // v8.9.6：波形だけ・動きを減らす設定（v8.11：光がオフ）では粒を消す
  cfg.modes.forEach(function (m) {
    if (m === 'circle') _npvDrawCircle(g, W, H, col, amp, dt, plain, cv, cfg);
    else if (m === 'bars') _npvDrawBars(g, W, H, col, amp, dt, plain, cfg);
    else if (m === 'wave') _npvDrawWave(g, W, H, col, amp, dt, reduced, !plain);
  });
  if (sparkle) _npvSparksDraw(g, H, col, _npvDark(), dt);
};

/* ---------- スマホ版 v8.9.6：花火のように光る残像（粒＝スパーク） ----------
   ・ピークのキャップ（円は先端の点）を光らせる：ダークは加算合成（lighter）で、テーマ色のにじみ＋白に近い芯。
     ライトは加算合成だと白に飛んで見えないので、ふつうの重ね方で、テーマ色を濃いめ・にじみを弱く
   ・ピークが落ちていく間、キャップから小さな光の粒がはじけ、重力で少し落ちながら瞬いて消える（寿命 0.4〜0.9秒）。
     ピークが大きく上がった瞬間（強い音）は、上がった量に合わせて多めにはじける。色はテーマ色と金色
   ・粒は NPV_SPARK_MAX 個までの入れ物を使い回す（新しく作らない）。動きを減らす設定では出さない。毎回キャンバスを消すので背景に色は溜まらない */
var NPV_SPARK_MAX = 200;          // 同時に出す粒の上限
var NPV_SPARK_RATE = 3.2;         // ピークが落ちている棒1本から、1秒あたりに出る粒の数（ピークの高さを掛ける）
var NPV_SPARK_BURST = 0.005;      // ピークの上がりがこれ以下になった（上がりきった）とき、
var NPV_RISE_MIN = 0.08;          // 少し前のいちばん低い値からこれ以上上がっていたら、はじける（スマホ版 v8.9.7）
var NPV_RISE_FULL = 0.35;         // 音の強さ（下の _npvAmp）がこれだけ上がったら「いちばん強い」（強さ 1）
var NPV_LOW_RECOVER = 0.5;        // 「少し前のいちばん低い値」が1秒で今の値へ戻る量（約0.5〜2秒の窓）
var NPV_SPARK_GRAV = 0.55;        // 重力（キャンバスの高さ×この値 /秒²）
var NPV_HEIGHT_CURVE = 1.6;       // 強さ→高さのカーブ（強さ^1.6。強い音ほど急に高く）
/* スマホ版 v8.9.7：はじける高さを、上がり方で変える
   ・強さ e ＝ (音の強さ(ピーク) − 音の強さ(少し前のいちばん低い値)) ÷ NPV_RISE_FULL（0〜1）。音の強さ ＝ 10^(2×(値−1))
     （棒の値は dB〔対数〕なので、聞こえないほど小さい音の上下でも値が大きく動く。強さに直して、本当に大きく鳴ったときだけ高くはじける）
   ・飛ぶ高さ ＝ 小：キャンバスの高さの 5% 〜 最大：キャップから画面の上端までの距離＋高さの 12%（画面の上を超える）を e^1.6 で結ぶ。
     初速 ＝ √(2 × 重力 × 飛ぶ高さ)。数 1〜9 個・大きさ・明るさも e で増やす。寿命は頂上に着くまでの時間に合わせて伸ばす（最大 2.4秒）
   ・キャンバス（#np-viz）は前から再生画面全体を覆う（position: absolute・幅と高さ 100%・pointer-events: none）ので、
     画面の上端まで描ける。上のボタンの操作は邪魔しない */
var npvSp = { pool: null, n: 0 };
function _npvSparkPool() {
  if (!npvSp.pool) { npvSp.pool = []; for (var i = 0; i < NPV_SPARK_MAX; i++) npvSp.pool.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, gold: false, ph: 0, e: 0, minY: 0 }); }
  return npvSp.pool;
}
// 粒を1つ出す（空きが無ければ出さない）。x,y：出る位置、dx,dy：主に飛ぶ向き（単位ベクトル）、sp：速さ（キャンバスの点/秒）
// v8.9.7：spread（広がりの角度）・life（寿命の秒）・e（強さ。記録用）を足した（省くと今までどおり）
function _npvSpark(x, y, dx, dy, sp, size, spread, life, e) {
  var pool = _npvSparkPool();
  if (npvSp.n >= NPV_SPARK_MAX) return;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (p.on) continue;
    var burst = life != null;
    var a = (Math.random() - 0.5) * (spread != null ? spread : 1.6), c = Math.cos(a), s = Math.sin(a), v = sp * (burst ? 0.85 + Math.random() * 0.25 : 0.45 + Math.random() * 0.75);
    p.on = true; p.x = x; p.y = y;
    p.vx = (dx * c - dy * s) * v; p.vy = (dx * s + dy * c) * v;
    p.max = burst ? life * (0.9 + Math.random() * 0.2) : 0.4 + Math.random() * 0.5; p.life = p.max; p.e = e == null ? -1 : e; p.minY = y;
    p.size = size * (0.6 + Math.random() * 0.8); p.gold = Math.random() < 0.45; p.ph = Math.random() * 6.28;
    npvSp.n++;
    return;
  }
}
function _npvSparksClear() { if (npvSp.pool && npvSp.n) { for (var i = 0; i < npvSp.pool.length; i++) npvSp.pool[i].on = false; npvSp.n = 0; } }
// 粒を動かして描く（重力で少し落ちる・瞬く・小さくなって消える）
function _npvSparksDraw(g, H, col, dark, dt) {
  var pool = npvSp.pool;
  if (!pool || !npvSp.n) return;
  var grav = H * NPV_SPARK_GRAV, t = performance.now() / 1000, gold = dark ? '255,214,120' : '196,128,24';
  // スマホ版 v8.11：粒を色（テーマ色・金色）×明るさ4段階ごとにまとめて塗る（1つずつ塗ると、描き方を重ねたときに重い）
  var LV = 4, B = npvSp.buckets || (npvSp.buckets = []);
  for (var bi = 0; bi < LV * 2; bi++) B[bi] = null;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; npvSp.n--; if (window.__npvLog) window.__npvLog.push([p.e, p.minY]); continue; }
    p.vy += grav * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < p.minY) p.minY = p.y;
    var k = p.life / p.max, tw = 0.55 + 0.45 * Math.sin(t * 22 + p.ph), r = p.size * (0.5 + 0.5 * k);
    var lv = Math.min(LV - 1, Math.floor(k * tw * LV)), idx = (p.gold ? LV : 0) + lv;
    var bk = B[idx] || (B[idx] = { halo: new Path2D(), core: new Path2D() });
    bk.halo.moveTo(p.x + r * 2.6, p.y); bk.halo.arc(p.x, p.y, r * 2.6, 0, 6.283);   // にじみ
    bk.core.moveTo(p.x + r, p.y); bk.core.arc(p.x, p.y, r, 0, 6.283);               // 芯
  }
  if (dark) g.globalCompositeOperation = 'lighter';
  for (var j = 0; j < LV * 2; j++) {
    var b = B[j];
    if (!b) continue;
    var c = j >= LV ? gold : col, a = ((j % LV) + 0.5) / LV;
    g.fillStyle = 'rgba(' + c + ',' + (a * (dark ? 0.35 : 0.25)).toFixed(3) + ')'; g.fill(b.halo);
    g.fillStyle = dark ? 'rgba(255,250,235,' + (a * 0.9).toFixed(3) + ')' : 'rgba(' + c + ',' + (a * 0.95).toFixed(3) + ')'; g.fill(b.core);
  }
  g.globalCompositeOperation = 'source-over';
}
function _npvDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
var _npvPrevBar = null, _npvPrevCirc = null, _npvLoBar = null, _npvLoCirc = null;
// ピークの変化から粒を出す。prev：前のフレームのピーク、vals：今の値、lo：少し前のいちばん低い値（v8.9.7）。
// はじけるのは、ピークが上がっている間ではなく「上がりきった」フレーム（音の解析はなめらかにしてあり、急な音でも数フレームかけて上がるため。
// 上がり始めではじけると上昇量が小さく測れてしまう）。上がっている途中かどうかは npv.rising（棒ごと）
// at(i, 強さの種類, e)：i 本目から1つ出す（落ちていく間の小さな粒は e = -1、はじける粒は e = 0〜1）
function _npvEmit(pk, prev, vals, lo, n, dt, at, key) {
  var rising = npv[key] && npv[key].length === n ? npv[key] : (npv[key] = new Uint8Array(n));
  for (var i = 0; i < n; i++) {
    var v = vals[i], jump = pk[i] - prev[i];
    lo[i] = Math.min(v, lo[i] + NPV_LOW_RECOVER * dt);
    var rise = pk[i] - lo[i];
    if (jump > NPV_SPARK_BURST) rising[i] = 1;   // まだ上がっている
    else if (rising[i]) {   // 上がりきった
      rising[i] = 0;
      if (rise > NPV_RISE_MIN) {
        var e = Math.min(1, (_npvAmp(pk[i]) - _npvAmp(lo[i])) / NPV_RISE_FULL), m = 1 + Math.round(e * 8);
        if (e > 0.02) for (var b = 0; b < m; b++) at(i, 1.4, e);
      }
      lo[i] = v;   // 使った上昇量は1回だけ
    }
    else if (jump < 0 && pk[i] > 0.05 && Math.random() < NPV_SPARK_RATE * pk[i] * dt) at(i, 0.8, -1);
    prev[i] = pk[i];
  }
}
// 棒の値（0〜1。dB）→ 音の強さ（0〜1。値 1 で 1、0.5 で 0.1、0 で 0.01）
function _npvAmp(v) { return Math.pow(10, 2 * (v - 1)); }
// はじける粒の初速と寿命：dist（強さ 1 で届かせたい距離）まで e^カーブで結んだ高さへ届く速さ
function _npvBurstV(e, H, minDist, dist) {
  var h = minDist + Math.max(0, dist - minDist) * Math.pow(e, NPV_HEIGHT_CURVE), g = H * NPV_SPARK_GRAV;
  var v0 = Math.sqrt(2 * g * h);
  return { v: v0, life: Math.min(2.4, Math.max(0.5, v0 / g * 1.15 + 0.2)) };
}
// 上の角を丸めた四角（roundRect が無いブラウザはふつうの四角）
function _npvRect(g, x, y, w, h, r) {
  if (g.roundRect && h > r) { g.beginPath(); g.roundRect(x, y, w, h, [r, r, 0, 0]); g.fill(); } else g.fillRect(x, y, w, h);
}

/* ---------- バー（スマホ版 v8.9.6：本数を約6割に減らして太く・角を丸く） ---------- */
// reduced：残像・光る先端・粒を出さない（動きを減らす設定・光がオフ）。cfg：描き方の設定（スマホ版 v8.11。バーの数・太さ）
function _npvDrawBars(g, W, H, col, amp, dt, reduced, cfg) {
  var dark = _npvDark();
  var bc = (typeof NVZ_BARS !== 'undefined' && cfg && NVZ_BARS[cfg.bars]) || { k: 1, min: 14, max: 56 }, tc = (typeof NVZ_THICK !== 'undefined' && cfg && NVZ_THICK[cfg.thick]) || { bar: 0.74 };
  var nb = Math.max(bc.min, Math.min(bc.max, Math.floor(W * bc.k / 30))), gap = W / nb, bw = gap * tc.bar, fl = np.freq.length, rad = Math.min(bw * 0.3, 8);
  if (!_npvBarVals || _npvBarVals.length !== nb) { _npvBarVals = new Float32Array(nb); _npvPrevBar = new Float32Array(nb); _npvLoBar = new Float32Array(nb); }
  for (var j = 0; j < nb; j++) {
    var a0 = Math.floor(Math.pow(j / nb, 1.7) * fl * 0.75), a1 = Math.max(a0 + 1, Math.floor(Math.pow((j + 1) / nb, 1.7) * fl * 0.75)), s = 0;
    for (var q = a0; q < a1; q++) s += np.freq[q];
    _npvBarVals[j] = s / (a1 - a0) / 255;
  }
  var pk = _npvPeaks(_npvBarVals, nb, 'peak', 'hold', dt, reduced), full = H * 0.55 * amp, capH = Math.max(3, H / 220);
  if (!reduced) _npvEmit(pk, _npvPrevBar, _npvBarVals, _npvLoBar, nb, dt, function (i, power, e) {
    var x0 = i * gap + gap / 2 + (Math.random() - 0.5) * bw * 0.6, y0 = H - pk[i] * full - capH, sz = Math.max(2.6, bw * 0.17);
    if (e < 0) { _npvSpark(x0, y0, 0, -1, H * 0.3 * power, sz); return; }
    var bv = _npvBurstV(e, H, H * 0.05, y0 + H * 0.12);   // 最大はキャップから画面の上端＋高さの 12% 上まで
    _npvSpark(x0, y0, 0, -1, bv.v, sz * (1 + e * 0.8), 0.9 * (1 - e * 0.6), bv.life, e);
  }, 'riseBar');
  // スマホ版 v8.11：重ねて描いても重くならないよう、尾は1つのグラデーション（画面の下から上へ明るく）でまとめて塗り、
  // 光るキャップもまとめて1回で塗る（v8.9.5〜8.10 は棒ごとにグラデーションを作り、合成の切り替えも棒ごと）
  if (!reduced) {
    var tgA = g.createLinearGradient(0, H - full, 0, H);
    tgA.addColorStop(0, 'rgba(' + col + ',' + (dark ? 0.42 : 0.3) + ')');
    tgA.addColorStop(1, 'rgba(' + col + ',0.05)');
    g.fillStyle = tgA;
    g.beginPath();
    for (var t1 = 0; t1 < nb; t1++) {
      var bh1 = Math.max(2, _npvBarVals[t1] * full), ph1 = pk[t1] * full;
      if (ph1 > bh1 + 1) g.rect(t1 * gap + (gap - bw) / 2, H - ph1, bw, ph1 - bh1);
    }
    g.fill();
  }
  for (var k = 0; k < nb; k++) {
    var vv = _npvBarVals[k], bh = Math.max(2, vv * full), x = k * gap + (gap - bw) / 2;
    g.fillStyle = 'rgba(' + col + ',' + (0.25 + vv * 0.6).toFixed(3) + ')';
    _npvRect(g, x, H - bh, bw, bh, rad);
  }
  // 光るキャップ（にじみ＋芯）：明るさはピークの平均から
  if (!reduced) {
    var ps = 0, pn = 0;
    for (var c1 = 0; c1 < nb; c1++) if (pk[c1] > 0.02) { ps += pk[c1]; pn++; }
    if (pn) {
      var ca = 0.35 + ps / pn * 0.55, halo = new Path2D(), core = new Path2D();
      for (var c2 = 0; c2 < nb; c2++) {
        if (pk[c2] <= 0.02) continue;
        var x2 = c2 * gap + (gap - bw) / 2, cy = H - pk[c2] * full - capH;
        if (dark) { halo.rect(x2 - bw * 0.12, cy - capH * 1.6, bw * 1.24, capH * 4.2); core.rect(x2 + bw * 0.08, cy, bw * 0.84, capH); }
        else { halo.rect(x2 - bw * 0.06, cy - capH, bw * 1.12, capH * 3); core.rect(x2, cy, bw, capH); }
      }
      if (dark) g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(' + col + ',' + (ca * (dark ? 0.35 : 0.18)).toFixed(3) + ')'; g.fill(halo);
      g.fillStyle = dark ? 'rgba(255,248,230,' + (ca * 0.85).toFixed(3) + ')' : 'rgba(' + col + ',' + Math.min(1, ca + 0.15).toFixed(3) + ')'; g.fill(core);
      g.globalCompositeOperation = 'source-over';
    }
  }
  // 粒は _npDraw の最後でまとめて動かして描く（スマホ版 v8.11。円と重ねても2回動かさない）
}

/* ---------- 円（スマホ版 v8.9.6：先端が光り、外へ粒が散る）----------
   ・スマホ版 v8.10：線の本数・太さを 37-now-playing.js の元の描き方と同じ（96本・太さ max(2, 短い辺/160)）に戻した
     （v8.9.6〜8.9.7 は 56本・太さ max(3, 短い辺/95)）。粒の大きさは v8.9.7 のまま（NPV_CIRC_SPARK_LW の太さから決める）。
     本数が増えた分、粒が増えすぎないよう、出す粒を NPV_CIRC_SPARK_KEEP の割合に間引く（全体の粒の数は 56本のときとほぼ同じ） */
var NPV_CIRC_BARS = 96;                    // 円の線の本数（37 の元の描き方と同じ）
var NPV_CIRC_SPARK_KEEP = 56 / 96;         // 円の粒を出す割合（v8.9.7 の 56本のときと同じくらいの数にする）
function NPV_CIRC_SPARK_LW(W, H) { return Math.max(3, Math.min(W, H) / 95); }   // 粒の大きさの元にする太さ（v8.9.7 の線の太さ）
function _npvDrawCircle(g, W, H, col, amp, dt, reduced, cv, cfg) {
  var dark = _npvDark(), vc = _npVizCenter(cv);
  var bc = (typeof NVZ_BARS !== 'undefined' && cfg && NVZ_BARS[cfg.bars]) || null, tc = (typeof NVZ_THICK !== 'undefined' && cfg && NVZ_THICK[cfg.thick]) || { line: 1 };
  var cx = vc ? vc.x : W / 2, cy = vc ? vc.y : H / 2, r0 = Math.max(Math.min(W, H) * 0.22, vc ? vc.r : 0), bars = bc ? bc.circ : NPV_CIRC_BARS, fl = np.freq.length;
  var keep = Math.min(1, 56 / bars);   // 粒の数が本数によらず v8.9.7（56本）と同じくらいになるように間引く
  if (!_npvCircVals || _npvCircVals.length !== bars) { _npvCircVals = new Float32Array(bars); _npvPrevCirc = new Float32Array(bars); _npvLoCirc = new Float32Array(bars); }
  for (var k = 0; k < bars; k++) _npvCircVals[k] = np.freq[Math.floor(Math.pow(k / bars, 1.6) * fl * 0.7)] / 255;
  var pk = _npvPeaks(_npvCircVals, bars, 'cpeak', 'chold', dt, reduced);
  var lw = Math.max(2, Math.min(W, H) / 160) * tc.line, slw = NPV_CIRC_SPARK_LW(W, H);   // 線の太さ（37 と同じ × 太さの設定）・粒の大きさの元
  if (!reduced) _npvEmit(pk, _npvPrevCirc, _npvCircVals, _npvLoCirc, bars, dt, function (i, power, e) {
    if (Math.random() > keep) return;   // 本数が増えた分を間引く（v8.10 の NPV_CIRC_SPARK_KEEP〔56/96〕を本数に合わせて）
    var ang = i / bars * Math.PI * 2 - Math.PI / 2, c = Math.cos(ang), s = Math.sin(ang), d = r0 + r0 * 0.9 * pk[i] * amp + 2, sz = Math.max(1.6, slw * 0.32);
    var x0 = cx + c * d, y0 = cy + s * d;
    if (e < 0) { _npvSpark(x0, y0, c, s, r0 * 0.9 * power, sz); return; }
    // 最大は、その向きで画面の端まで＋短い辺の 12%（画面の外まで飛ぶ）
    var tx = c > 0.001 ? (W - x0) / c : c < -0.001 ? -x0 / c : 1e9, ty = s > 0.001 ? (H - y0) / s : s < -0.001 ? -y0 / s : 1e9;
    var bv = _npvBurstV(e, H, r0 * 0.3, Math.min(tx, ty) + Math.min(W, H) * 0.12);
    _npvSpark(x0, y0, c, s, bv.v, sz * (1 + e * 0.8), 0.9 * (1 - e * 0.6), bv.life, e);
  }, 'riseCirc');
  g.lineCap = 'round';
  // スマホ版 v8.11：尾は円の中心からの1つのグラデーション（外側ほど明るく）でまとめて描き、光る先端もまとめて1回で塗る（軽くするため）
  if (!reduced) {
    var rg = g.createRadialGradient(cx, cy, r0, cx, cy, r0 + r0 * 0.9 * amp + 2);
    rg.addColorStop(0, 'rgba(' + col + ',0.05)');
    rg.addColorStop(1, 'rgba(' + col + ',' + (dark ? 0.45 : 0.32) + ')');
    g.lineWidth = lw * 0.7; g.strokeStyle = rg;
    g.beginPath();
    for (var t1 = 0; t1 < bars; t1++) {
      var l1 = r0 * 0.9 * _npvCircVals[t1] * amp + 2, p1 = r0 * 0.9 * pk[t1] * amp + 2;
      if (p1 <= l1 + 2) continue;
      var a1 = t1 / bars * Math.PI * 2 - Math.PI / 2, c1 = Math.cos(a1), s1 = Math.sin(a1);
      g.moveTo(cx + c1 * (r0 + l1), cy + s1 * (r0 + l1)); g.lineTo(cx + c1 * (r0 + p1), cy + s1 * (r0 + p1));
    }
    g.stroke();
  }
  g.lineWidth = lw;
  for (var i = 0; i < bars; i++) {
    var v = _npvCircVals[i], len = r0 * 0.9 * v * amp + 2, ang = i / bars * Math.PI * 2 - Math.PI / 2;
    var c = Math.cos(ang), s = Math.sin(ang);
    g.strokeStyle = 'rgba(' + col + ',' + (0.35 + v * 0.6).toFixed(3) + ')';
    g.beginPath(); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * (r0 + len), cy + s * (r0 + len)); g.stroke();
  }
  // 光る先端（ピークの点）：明るさはピークの平均から
  if (!reduced) {
    var ps = 0, pn = 0, halo = new Path2D(), core = new Path2D();
    for (var t2 = 0; t2 < bars; t2++) {
      if (pk[t2] <= 0.02) continue;
      ps += pk[t2]; pn++;
      var a2 = t2 / bars * Math.PI * 2 - Math.PI / 2, p2 = r0 + r0 * 0.9 * pk[t2] * amp + 2, px = cx + Math.cos(a2) * p2, py = cy + Math.sin(a2) * p2;
      halo.moveTo(px + lw * 1.5, py); halo.arc(px, py, lw * 1.5, 0, 6.283);
      core.moveTo(px + lw * 0.6, py); core.arc(px, py, lw * 0.6, 0, 6.283);
    }
    if (pn) {
      var ca = 0.35 + ps / pn * 0.55;
      if (dark) g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(' + col + ',' + (ca * (dark ? 0.35 : 0.2)).toFixed(3) + ')'; g.fill(halo);
      g.fillStyle = dark ? 'rgba(255,248,230,' + (ca * 0.85).toFixed(3) + ')' : 'rgba(' + col + ',' + Math.min(1, ca + 0.15).toFixed(3) + ')'; g.fill(core);
      g.globalCompositeOperation = 'source-over';
    }
  }
  // 粒は _npDraw の最後でまとめて動かして描く（スマホ版 v8.11）
}

/* ---------- 波形 ---------- */
// glow：線のまわりにうすい光（スマホ版 v8.11。光がオンのとき。なめらかさ・速さは変えない）
function _npvDrawWave(g, W, H, col, amp, dt, reduced, glow) {
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
  if (glow) {   // 同じ線を太く・うすく先に重ねて、にじむ光に（shadowBlur より軽い）
    var lw0 = g.lineWidth, dark = _npvDark();
    if (dark) g.globalCompositeOperation = 'lighter';
    g.lineWidth = lw0 * 4; g.strokeStyle = 'rgba(' + col + ',' + (dark ? 0.16 : 0.1) + ')'; g.stroke();
    g.lineWidth = lw0 * 2.2; g.strokeStyle = 'rgba(' + col + ',' + (dark ? 0.22 : 0.14) + ')'; g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = lw0; g.strokeStyle = 'rgba(' + col + ',0.85)';
  }
  g.stroke();
}

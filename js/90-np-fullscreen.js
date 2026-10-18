/* =========================================================
   90-np-fullscreen.js ― 再生画面の「全画面ボタン」（スマホ版 v8.23.8）
   ・再生画面（#now-playing）の上部のボタン列、閉じるボタン（×）のすぐ左の丸いボタン（#np-fs-btn）
   ・押すと全画面（document.documentElement.requestFullscreen()。利用者の操作が必要なのでボタンを押したときだけ）
     → 全画面の間は screen.orientation.lock() で画面の向きをアプリが決める
   ・向きの自動切り替え：スマホ本体の「画面の自動回転」がオフでも、端末の傾き（devicemotion の重力の向き。
     無ければ deviceorientation の beta / gamma から計算）を見て、
       横に倒した → lock('landscape-primary' / 'landscape-secondary')（左右どちらに倒したかで選ぶ）
       縦に戻した → lock('portrait-primary')
     バタつかないように、角度に余裕（縦：傾き 30° 以内、横：60〜120°。その間と逆さま・平らに置いたときは今のまま）と
     持続（同じ向きが 0.6 秒続いたら切り替え）を入れる
   ・後始末：全画面ボタンをもう一度押す・再生画面を閉じる・Android の戻る操作などで全画面が終わったら、
     fullscreenchange で orientation.unlock() とセンサーの停止を必ず行う
   ・使えない端末（requestFullscreen・screen.orientation.lock が無い、タッチの無い PC、iPhone など）ではボタンを出さない。
     押したあとに失敗したときは、全画面を戻して「この端末では使えません」のトースト
   ・保存するものは無い（設定・バックアップには関わらない）
   ========================================================= */

var npFs = { on: false, sensing: false, cur: '', cand: '', candSince: 0, motionOk: false, locking: false };
var NPFS_HOLD_MS = 600;       // 同じ向きがこの時間続いたら切り替える（ヒステリシス）
var NPFS_MIN_TILT = 0.45;     // 平らに近い（画面の面の傾きの成分が小さい）ときは判断しない（重力の 45% 未満）
var NPFS_ICON_ENTER = _svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>', 16);
var NPFS_ICON_EXIT = _svg('<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>', 16);

/* ---------- 使えるかどうか ---------- */
function _npfsReq(el) { return el.requestFullscreen || el.webkitRequestFullscreen || null; }
function _npfsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function npFsSupported() {
  try {
    if (!_npfsReq(document.documentElement)) return false;
    if (!window.screen || !screen.orientation || typeof screen.orientation.lock !== 'function') return false;
    // タッチの無い PC では向きを変えられないので出さない
    if (window.matchMedia && !matchMedia('(pointer: coarse)').matches) return false;
    return true;
  } catch (e) { return false; }
}

/* ---------- 全画面ボタン ---------- */
function _npfsEnsureBtn() {
  var host = document.getElementById('now-playing');
  if (!host || document.getElementById('np-fs-btn')) return;
  if (!npFsSupported()) return;   // 使えない端末では出さない
  var top = host.querySelector('.np-top');
  if (!top) return;
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'np-lyr-toggle np-fs-btn';   // np-lyr-toggle：v8.23.4 の「閉じるボタンと同じ丸いボタン・アイコン 16px」の指定をそのまま使う
  b.id = 'np-fs-btn';
  b.addEventListener('click', function () { npFsToggle(); });
  var close = top.querySelector('#np-close');
  if (close) top.insertBefore(b, close); else top.appendChild(b);
  _npfsBtnUi();
}
// アイコン・名前を「全画面に入る／出る」で切り替える
function _npfsBtnUi() {
  var b = document.getElementById('np-fs-btn');
  if (!b) return;
  var on = !!_npfsElement();
  var label = on ? '全画面を終わる（向きを元に戻す）' : '全画面にする（傾けると縦・横が切り替わる）';
  b.innerHTML = on ? NPFS_ICON_EXIT : NPFS_ICON_ENTER;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.classList.toggle('active', on);
}

/* ---------- 入る・出る ---------- */
function npFsToggle() {
  if (_npfsElement()) { npFsExit(); return; }
  npFsEnter();
}
function npFsEnter() {
  var de = document.documentElement, req = _npfsReq(de);
  if (!req || !npFsSupported()) { showToast('この端末では使えません'); return; }
  var p;
  try { p = req.call(de, { navigationUI: 'hide' }); } catch (e) { console.warn('全画面にできません', e); showToast('この端末では使えません'); return; }
  Promise.resolve(p).then(function () {
    npFs.on = true;
    // 最初は今の画面の向きで固定し、あとはセンサーで切り替える
    var t = (screen.orientation && screen.orientation.type) || 'portrait-primary';
    if (t.indexOf('portrait') === 0) t = 'portrait-primary';
    return _npfsLock(t).then(function (ok) {
      if (!ok) { showToast('この端末では使えません'); npFsExit(); return; }
      _npfsStartSensor();
      _npfsBtnUi();
    });
  }).catch(function (e) {
    console.warn('全画面にできません', e);
    showToast('この端末では使えません');
    _npfsCleanup();
  });
}
function npFsExit() {
  _npfsCleanup();   // fullscreenchange でも呼ぶが、先に止めておく（2回呼んでも安全）
  if (!_npfsElement()) return;
  var ex = document.exitFullscreen || document.webkitExitFullscreen;
  try {
    var p = ex && ex.call(document);
    if (p && p.catch) p.catch(function (e) { console.warn('全画面を終われません', e); });
  } catch (e) { console.warn('全画面を終われません', e); }
}
// 向きを固定する。成功したら true（失敗しても例外は外に出さない）
function _npfsLock(type) {
  try {
    var p = screen.orientation.lock(type);
    return Promise.resolve(p).then(function () { npFs.cur = type; return true; }, function (e) { console.warn('向きを固定できません', type, e); return false; });
  } catch (e) { console.warn('向きを固定できません', type, e); return Promise.resolve(false); }
}
// 後始末：センサーを止め、向きの固定を外す
function _npfsCleanup() {
  npFs.on = false;
  _npfsStopSensor();
  npFs.cur = ''; npFs.cand = ''; npFs.candSince = 0;
  try { if (screen.orientation && typeof screen.orientation.unlock === 'function') screen.orientation.unlock(); } catch (e) { /* 固定していなければ何もしない */ }
  _npfsBtnUi();
}
function _npfsOnChange() {
  if (_npfsElement()) { _npfsBtnUi(); return; }
  _npfsCleanup();   // 戻る操作などで全画面が終わったとき
}
document.addEventListener('fullscreenchange', _npfsOnChange);
document.addEventListener('webkitfullscreenchange', _npfsOnChange);

/* ---------- 傾きのセンサー ---------- */
function _npfsStartSensor() {
  if (npFs.sensing) return;
  npFs.sensing = true; npFs.motionOk = false; npFs.cand = ''; npFs.candSince = 0;
  window.addEventListener('devicemotion', _npfsOnMotion);
  window.addEventListener('deviceorientation', _npfsOnOrient);
}
function _npfsStopSensor() {
  if (!npFs.sensing) return;
  npFs.sensing = false;
  window.removeEventListener('devicemotion', _npfsOnMotion);
  window.removeEventListener('deviceorientation', _npfsOnOrient);
}
// devicemotion：重力を含む加速度（端末の向きの軸。立てて持つと y が＋、右の辺を上にすると x が＋）
function _npfsOnMotion(ev) {
  var g = ev.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  npFs.motionOk = true;
  _npfsFeed(g.x / 9.81, g.y / 9.81);
}
// deviceorientation（devicemotion が来ない端末用）：beta / gamma から「上」の向き（端末の軸）を計算
//   上 ＝（−cosβ・sinγ, sinβ, cosβ・cosγ）
function _npfsOnOrient(ev) {
  if (npFs.motionOk || ev.beta == null || ev.gamma == null) return;
  var b = ev.beta * Math.PI / 180, c = ev.gamma * Math.PI / 180;
  _npfsFeed(-Math.cos(b) * Math.sin(c), Math.sin(b));
}
// x, y（重力の大きさを 1 とした、画面の面の中の「上」の向き）から、向きを決める
function _npfsFeed(x, y) {
  if (!npFs.on || !_npfsElement()) return;
  if (Math.sqrt(x * x + y * y) < NPFS_MIN_TILT) { npFs.cand = ''; return; }   // 平らに近い：判断しない
  var a = Math.atan2(x, y) * 180 / Math.PI;   // 0°＝縦（上が上）、＋90°＝右の辺が上、−90°＝左の辺が上
  var want = '';
  if (Math.abs(a) <= 30) want = 'portrait-primary';
  else if (a >= 60 && a <= 120) want = 'landscape-primary';     // 左に倒した（端末の上が左）
  else if (a <= -60 && a >= -120) want = 'landscape-secondary'; // 右に倒した（端末の上が右）
  // 境目・逆さまのときは今のまま
  if (!want || want === npFs.cur) { npFs.cand = ''; return; }
  var now = Date.now();
  if (want !== npFs.cand) { npFs.cand = want; npFs.candSince = now; return; }
  if (now - npFs.candSince < NPFS_HOLD_MS || npFs.locking) return;
  npFs.locking = true;
  _npfsLock(want).then(function () { npFs.locking = false; npFs.cand = ''; });
}
// アプリが隠れている間はセンサーを止める
document.addEventListener('visibilitychange', function () {
  if (document.hidden) _npfsStopSensor();
  else if (npFs.on && _npfsElement()) _npfsStartSensor();
});

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // 再生画面を作ったとき：全画面ボタンを足す
  var f = window._npEnsureDom;
  if (typeof f === 'function') {
    window._npEnsureDom = function () {
      var r = f.apply(this, arguments);
      try { _npfsEnsureBtn(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生画面を閉じたとき：全画面を終わる（向きの固定・センサーも fullscreenchange で後始末）
  var h = window._npHide;
  if (typeof h === 'function') {
    window._npHide = function () {
      try { if (npFs.on || _npfsElement()) npFsExit(); } catch (e) { console.warn(e); }
      return h.apply(this, arguments);
    };
  }
})();

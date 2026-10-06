/* =========================================================
   57-record.js ― 再生画面の「レコード」（v8.5）
   ・再生画面・プレイリストの play画面の左に、レコードプレーヤー（プレーヤー台・プラッター・黒い盤・中央のレーベル・トーンアーム）を出す
     （回転CD・カセットテープと同じ場所。どれか1つ。切り替えは 54-spin-cd.js の「プレイヤー表示ボタン」。db.settings.npVisual === 'record'）
   ・盤：中央のレーベルにその曲のジャケット（無い曲はテーマの色の既定のレーベル）。再生中は回り（約1.8秒で1回転。CSS の animation、
     transform: rotate だけ）、一時停止・停止中は animation-play-state: paused でその角度のまま止まる。溝の光の反射（.np-rc-shine）は回さない
   ・トーンアーム：支点を中心に回す角度 --arm（transform: rotate）と、針を下ろしているか（.is-down）で表す。
       止めている・一時停止中 → アームレスト（盤の外。RC_REST）に戻す（いったん針を上げてから動く）
       再生中 → 盤の上へ動いて針を下ろし、再生位置（currentTime / duration）に合わせて外周（RC_OUT）から内周（RC_IN）へゆっくり進む
       曲が変わった・シークした（角度が大きく変わる）→ 針を上げて、その位置へ動いてから下ろす
   ・再生画面を閉じている・レコードでないときは計算しない。prefers-reduced-motion では回さず、アームは動きを付けずにその位置へ（style.css）
   ・プレーヤー台を押すとジャケット拡大表示
   ========================================================= */

var rec = { path: undefined, bound: false, ang: null, down: false, busy: false, goal: null, t1: 0, t2: 0 };
// トーンアームの角度（度。0 で真下＝アームレスト。大きいほど盤の内側へ）。プレーヤー台の幅を 100 としたときの
// 支点 (88, 14)・アームの長さ 54・盤の中心 (40, 40) から、針が外周（半径 32）・内周（半径 14）に来る角度を求めた値
var RC_REST = 0, RC_OUT = 27.3, RC_IN = 46.9;
var RC_SMALL = 1.5;   // これより小さい角度の変化は、針を下ろしたまま動かす
// プレイヤー表示ボタンの絵（レコード）
var RC_ICON = _svg('<circle cx="10" cy="13" r="8"/><circle cx="10" cy="13" r="2.2"/><path d="M19 3v9l-4 4"/><circle cx="19" cy="3" r="1"/>');

function _rcEnsure(el) {
  var box = el.querySelector('#np-rc-big');
  if (box) return box;
  var main = npVisFrame(el);   // v8.5：プレイヤー表示の枠の中に置く
  if (!main) return null;
  box = document.createElement('div');
  box.className = 'np-rc-big'; box.id = 'np-rc-big';
  box.innerHTML =
    '<button type="button" class="np-rc-body" id="np-rc-body" title="ジャケットを大きく表示" aria-label="レコード（押すとジャケットを大きく表示）">' +
      '<span class="np-rc-platter" aria-hidden="true">' +                       // プラッター（銀色の台）
        '<span class="np-rc-disc" id="np-rc-disc">' +                           // 回る盤（溝・レーベル）
          '<span class="np-rc-label" id="np-rc-label"></span>' +
        '</span>' +
        '<span class="np-rc-shine"></span><span class="np-rc-spindle"></span>' + // 回らない光の反射・中心の軸
      '</span>' +
      '<span class="np-rc-rest" aria-hidden="true"></span>' +                    // アームレスト
      '<span class="np-rc-pivot" aria-hidden="true"></span>' +                   // トーンアームの支点の台
      '<span class="np-rc-arm" id="np-rc-arm" aria-hidden="true"><span class="np-rc-arm-in">' +   // トーンアーム（回す・上げ下げ）
        '<span class="np-rc-weight"></span><span class="np-rc-rod"></span><span class="np-rc-head"></span>' +
      '</span></span>' +
      '<span class="np-rc-cap" aria-hidden="true"></span>' +
      '<span class="np-rc-knob" aria-hidden="true"></span><span class="np-rc-speed" aria-hidden="true">33⅓</span>' +
    '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight np-rc-labeltag" onclick="copyUiLabel(\'レコード\', event)" title="クリックで「レコード」をコピー">□</span>';
  main.appendChild(box);
  box.querySelector('#np-rc-body').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  return box;
}
function _rcBind() {
  if (rec.bound || !player.audio) return;
  rec.bound = true;
  ['play', 'playing', 'pause', 'ended', 'emptied', 'timeupdate', 'seeked', 'loadedmetadata'].forEach(function (e) { player.audio.addEventListener(e, _rcUpdate); });
}
function _rcOn() {
  var el = document.getElementById('now-playing');
  return !!(el && el.classList.contains('np-rc-mode') && typeof np !== 'undefined' && np.open);
}
// 見た目を合わせる（54-spin-cd.js の spinCdApply から。曲が変わったときだけレーベルを作り直す）
function recordApply() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  var box = _rcEnsure(el);
  if (!box || !el.classList.contains('np-rc-mode')) { rec.ang = null; return; }   // 次に出したときは、アームをすぐその位置に置く
  _rcBind();
  var path = player.currentPath || null;
  if (rec.path !== path) {
    rec.path = path;
    var t = path ? library.byPath[path] : null;
    box.querySelector('#np-rc-label').innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    box.querySelector('#np-rc-body').disabled = !path;
    artObserve(box);
  }
  _rcUpdate();
}
// 今あるべきアームの位置
function _rcTarget() {
  var a = player.audio, playing = !!(a && !a.paused && !a.ended && player.currentPath);
  if (!playing) return { ang: RC_REST, down: false };
  var d = a.duration, p = isFinite(d) && d > 0 ? Math.min(1, Math.max(0, a.currentTime / d)) : 0;
  return { ang: Math.round((RC_OUT + p * (RC_IN - RC_OUT)) * 100) / 100, down: true };
}
function _rcArm() { var b = document.getElementById('np-rc-big'); return b ? b.querySelector('#np-rc-arm') : null; }
function _rcSet(arm, ang, down) {
  if (ang != null) { arm.style.setProperty('--arm', ang + 'deg'); rec.ang = ang; }
  if (down != null) { arm.classList.toggle('is-down', down); rec.down = down; }
}
function _rcClear() { clearTimeout(rec.t1); clearTimeout(rec.t2); rec.t1 = rec.t2 = 0; rec.busy = false; rec.goal = null; }
function _rcUpdate() {
  if (!_rcOn()) return;
  var arm = _rcArm();
  if (!arm) return;
  var tg = _rcTarget();
  // はじめて（または表示を切り替えた直後）：動かさずにその位置へ置く
  if (rec.ang === null) {
    _rcClear();
    arm.classList.add('no-anim');
    _rcSet(arm, tg.ang, tg.down);
    void arm.offsetWidth;
    arm.classList.remove('no-anim');
    return;
  }
  if (rec.busy && rec.goal && rec.goal.down === tg.down && Math.abs(rec.goal.ang - tg.ang) < RC_SMALL) return;   // 同じ所へ動いている途中
  var diff = Math.abs(tg.ang - rec.ang);
  if (!rec.busy && diff < RC_SMALL && rec.down === tg.down) {   // 再生中の少しの前進：針を下ろしたまま
    arm.style.transitionDuration = '';
    _rcSet(arm, tg.ang, null);
    return;
  }
  // 大きく動く（再生を始めた・止めた・曲が変わった・シークした）：針を上げて → 動いて → （再生中なら）下ろす
  _rcClear();
  if (np.reduced) { _rcSet(arm, tg.ang, tg.down); return; }
  rec.busy = true; rec.goal = tg;
  var dur = Math.min(1.6, 0.45 + diff / 30);   // 動く角度が大きいほど少し長く（秒）
  var lift = rec.down ? 300 : 0;
  _rcSet(arm, null, false);
  rec.t1 = setTimeout(function () {
    arm.style.transitionDuration = dur + 's';
    _rcSet(arm, tg.ang, null);
    rec.t2 = setTimeout(function () {
      arm.style.transitionDuration = '';
      _rcSet(arm, null, tg.down);
      rec.busy = false; rec.goal = null;
      _rcUpdate();   // 動いている間に進んだ分を合わせる
    }, dur * 1000);
  }, lift);
}

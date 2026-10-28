/* =========================================================
   97-np-speaker.js ― スマホ版：再生画面のプレイヤー表示「スピーカーのモード」（スマホ版 v8.25.7。PC版 v8.7.86 の 90-np-speaker.js と同じ働き）
   ・選び方：再生画面の上の「プレイヤー表示ボタン」（54-spin-cd.js）を押すたびに
     ジャケット → 回転CD → カセット → レコード → MD → スピーカー → ジャケット … と切り替わる。
     保存は今までのプレイヤー表示と同じ db.settings.npVisual（'speaker'）。バックアップ・復元の対象（古いバックアップはそのまま読める）
   ・部品（np-speaker.js の npSpkHtml）：プレイヤー表示の枠（#np-vis-frame）の中に「スピーカーのモード」#np-sp-big ＞
     上の段（「左スピーカー」・ジャケット #np-sp-body・「右スピーカー」）＋「アンプのパネル」（電源ランプ・「VU メーター」L／R・ピークランプ・つまみ）。
     スマホの並びでは、ジャケットのタップで一時停止／再生・左右のフリックで曲送り（89-np-vis-gesture.js。回転CD などと同じ）
   ・スマホ幅：全体（スピーカー・ジャケット・アンプ）を枠に入る大きさに縮める（比はそのまま。style.css の「スピーカーのモード」）
   ・動かす：この file の小さな requestAnimationFrame のループ。音飛び対策（スマホ版 v8.25.2）と同じく 1秒 30回まで（37 の NP_VIZ_FPS）。
     値は今ある AnalyserNode と同じ所から左右に分けて読む（np-speaker.js の npSpkRead。AudioContext は作らない）。
     一時停止・曲が無いときは、針が 0 に戻ってコーンが止まり切ったらループを止める（再生したらまた回す）。
     「動きを減らす」（prefers-reduced-motion。37 の np.reduced）では 0.12秒に1回だけ、コーンは動かさない
   ========================================================= */

var spk = { raf: 0, last: 0, st: null, lv: [0, 0, 0, 0, 0, 0, 0, 0], path: undefined, bound: false };

function npSpeakerOn() { return typeof npVisual === 'function' && npVisual() === 'speaker'; }
// 比較表（10-settings-backup.js の復元の確認）に出す名前（54 の npVisual と同じ読み方）
function npVisualLabel(settings) {
  var s = settings || {}, v = s.npVisual;
  if (v === 'none' || v === 'flow') v = 'jacket';
  var x = (typeof NP_VISUALS !== 'undefined' ? NP_VISUALS : []).filter(function (y) { return y[0] === v; })[0];
  return x ? x[1] : (s.npSpinCd === false ? 'ジャケット' : '回転CD');
}

function _npSpeakerEnsure(el) {
  var box = el.querySelector('#np-sp-big');
  if (box) return box;
  var frame = typeof npVisFrame === 'function' ? npVisFrame(el) : null;
  if (!frame) return null;
  var lbl = function (name, cls) {
    return '<span class="ui-label-tag ui-label-tag-onlight ' + cls + '" onclick="copyUiLabel(\'' + name + '\', event)" title="クリックで「' + name + '」をコピー">□</span>';
  };
  frame.insertAdjacentHTML('beforeend', npSpkHtml(lbl, ''));
  box = frame.querySelector('#np-sp-big');
  box.querySelector('#np-sp-body').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  return box;
}
// 54 の spinCdApply から呼ばれる（表示を切り替えたとき・再生画面を描くたび）
function npSpeakerApply() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  _npSpeakerBind();
  if (!el.classList.contains('np-sp-mode')) { _npSpeakerStop(); return; }
  var box = _npSpeakerEnsure(el);
  if (!box) return;
  var path = player.currentPath || null;
  if (spk.path !== path) {
    spk.path = path;
    var t = path ? library.byPath[path] : null;
    box.querySelector('#np-sp-art').innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    box.querySelector('#np-sp-body').disabled = !path;
    artObserve(box);
  }
  _npSpeakerStart();
}

/* ---------- ループ（1秒 30回まで） ---------- */
function _npSpeakerCan() { return np.open && !document.hidden && npSpeakerOn(); }
function _npSpeakerStart() {
  if (spk.raf || !_npSpeakerCan()) return;
  spk.last = 0;
  spk.raf = requestAnimationFrame(_npSpeakerStep);
}
function _npSpeakerStop() { if (spk.raf) { cancelAnimationFrame(spk.raf); spk.raf = 0; } }
function _npSpeakerStep(ts) {
  spk.raf = 0;
  if (!_npSpeakerCan()) return;
  // 37 のビジュアライザーと同じ間引き：ふつうは 1秒 NP_VIZ_FPS（30）回（NP_VIZ_GAP_SLACK だけ早めでも描く）、動きを減らすは 0.12秒に1回
  var fps = typeof NP_VIZ_FPS !== 'undefined' ? NP_VIZ_FPS : 30, slack = typeof NP_VIZ_GAP_SLACK !== 'undefined' ? NP_VIZ_GAP_SLACK : 4;
  var gap = np.reduced ? 120 : 1000 / fps - slack;
  if (spk.last && ts - spk.last < gap && ts >= spk.last) { spk.raf = requestAnimationFrame(_npSpeakerStep); return; }
  var dt = spk.last ? (ts - spk.last) / 1000 : 1 / 30;
  spk.last = ts;
  var a = player.audio, playing = !!(a && !a.paused && !a.ended && a.getAttribute('src'));
  // 音の解析（np.analyser）は再生画面を開いたときに 37 が作る。ここでは作らない（操作の無いときに作ると音が止まるため）
  var lv = playing && np.analyser ? npSpkRead(np, spk.lv) : null;
  if (!spk.st) spk.st = npSpkState();
  var moving = npSpkFrame(document.getElementById('np-sp-big'), spk.st, lv, dt, playing, np.reduced);
  if (!playing && !moving) return;   // 止まり切った：ループを止める（再生したら _npSpeakerStart）
  spk.raf = requestAnimationFrame(_npSpeakerStep);
}
function _npSpeakerBind() {
  if (spk.bound || !player.audio) return;
  spk.bound = true;
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (e) { player.audio.addEventListener(e, _npSpeakerStart); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) _npSpeakerStart(); });
}
// 再生画面を開いたとき（37 の _npStartLoop。73 が包んだものをさらに包む。ビジュアライザーが「なし」でも回す）
(function () {
  var start = window._npStartLoop;
  if (typeof start === 'function') window._npStartLoop = function () { try { _npSpeakerStart(); } catch (e) { console.warn(e); } return start.apply(this, arguments); };
})();

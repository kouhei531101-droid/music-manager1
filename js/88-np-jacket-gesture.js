/* =========================================================
   88-np-jacket-gesture.js ― スマホ版：再生画面の「ジャケットの操作」（スマホ版 v8.23.5）
   ・対象：再生画面（#now-playing）のプレイヤー表示が「ジャケット」のときの「ジャケットの並び」（#np-flow。40-coverflow.js）。
     スマホの並び（68-np-onescreen.js の npOneNarrow()：幅 760px 以下・横向きのスマホ）のときだけ。PC 幅は今まで通り
   ・左へフリック → 次の曲（「次の曲」ボタンと同じ playNext(true)。予約〔82-up-next.js〕があれば予約が先）
     右へフリック → 前の曲（「前の曲」ボタンと同じ playPrev()。3秒より後ろなら曲の頭に戻る）
     フリックの条件：指を離した位置が、押した位置から横に JG_FLICK_PX 以上・横の動きが縦より大きい
     動かしている間は、今まで通りジャケットの並びが指についてくる（40 の flow.drag）。条件に届かなければ元の位置に戻る（曲は変わらない）
   ・タップ（ほとんど動かさずに離す）→ 一時停止／再生（「再生／一時停止」ボタンと同じ togglePlay()）。
     中央に一瞬だけ ▶／❚❚ の印を出し、ジャケットを軽く沈ませる（prefers-reduced-motion では印だけ）
   ・二重に動かない作り：タップは click（40 の click の受け口 → flowActivate）の1か所だけで扱う。touchend・pointerup では何もしない。
     フリック・引っぱりの直後の click は 40 の flow.justDragged で無視する
   ・縦の動き：.np-flow は touch-action: pan-y なので、縦に動かすとブラウザのスクロールになり pointercancel が来る → 何もしない（元の位置に戻すだけ）
   ・今までの動き（スマホの並びでは置き換え）：
       中央（再生中の曲）のジャケットを押す → ジャケット拡大表示　→　一時停止／再生 に変更
       前後のジャケットを押す → その曲を再生　→　一時停止／再生 に変更
       左右にスワイプ → 並びを見るだけ（曲は変わらず5秒で戻る）　→　次の曲／前の曲 に変更
     ジャケット拡大表示は、PC 幅のジャケットの並びでは今まで通り
   ・スマホ版 v8.23.6：回転CD・カセット・レコード・MD でも同じ操作にした（89-np-vis-gesture.js）。そのため判定・曲送り・一時停止／再生・印を
     共通の部品（npGestureFlickDir・npGestureSkip・npGestureToggle・npGestureBadge）に分けた。
     印の向きの直し：v8.23.5 は togglePlay() のあとの状態で決めていたため、再生を始めたのに ❚❚ が出ていた → 押す前の状態で決める
   ・保存データ・バックアップには触らない
   ========================================================= */

var JG_FLICK_PX = 50;   // フリックとみなす横の移動（px）

// 今、スマホの並びのジャケット操作にするかどうか
function npJacketGestureOn() {
  return typeof npOneNarrow === 'function' ? npOneNarrow() : (typeof isMobileLayout === 'function' && isMobileLayout());
}

// 40-coverflow.js の指を離したときから呼ばれる（引っぱったときだけ）。扱ったら true（40 の今までの「並びを見る」はしない）
function npJacketFlickEnd(ev) {
  if (!npJacketGestureOn()) return false;
  if (flow.idleTimer) { clearTimeout(flow.idleTimer); flow.idleTimer = 0; }
  var dx = 0, dy = 0;
  if (ev && ev.type === 'pointerup') { dx = ev.clientX - flow.x0; dy = ev.clientY - (flow.y0 || ev.clientY); }
  flow.drag = 0;
  npGestureSkip(npGestureFlickDir(dx, dy));
  // 再生中の曲を中央に（曲が変わっていれば、指の位置からなめらかに次の曲へ。変わらなければ元の位置へ戻る）
  flow.view = Math.max(0, player.index);
  flowRender();
  return true;
}

// ジャケットを押したとき（40 の click の受け口）：スマホの並びでは一時停止／再生
(function () {
  var f = window.flowActivate;
  if (typeof f !== 'function') return;
  window.flowActivate = function (it) {
    if (!npJacketGestureOn()) return f.apply(this, arguments);
    if (flow.idleTimer) { clearTimeout(flow.idleTimer); flow.idleTimer = 0; }
    var willPlay = npGestureToggle();
    _jgTapFeedback(willPlay);
  };
})();

/* ---------- 共通の部品（スマホ版 v8.23.6 で分けた。ジャケットの並びと、回転CD・カセット・レコード・MD の両方で使う） ---------- */
// フリックの判定：横に JG_FLICK_PX 以上・横の動きが縦より大きければ 'next'（左へ）／'prev'（右へ）、そうでなければ ''
function npGestureFlickDir(dx, dy) {
  if (Math.abs(dx) < JG_FLICK_PX || Math.abs(dx) <= Math.abs(dy)) return '';
  return dx < 0 ? 'next' : 'prev';
}
// 曲送り：'next' → 次の曲 playNext(true)、'prev' → 前の曲 playPrev()。曲リストが空なら何もしない。送ったら true
function npGestureSkip(dir) {
  if (!dir || !player.queue || !player.queue.length) return false;
  if (dir === 'next') playNext(true); else playPrev();
  return true;
}
// 一時停止／再生（togglePlay()）。戻り値：再生を始めたら true、止めたら false
//   押す前の状態で決める（v8.23.5 は押したあとの paused で決めていたため、印が逆〔始めたのに ❚❚〕になっていたのを直した）
function npGestureToggle() {
  var a = player.audio;
  var willPlay = !(a && a.getAttribute('src') && !a.paused);
  togglePlay();
  return willPlay;
}
// 「タップの印」（.np-jg-badge）を box の真ん中に一瞬出す（再生を始めた → ▶、止めた → ❚❚）
function npGestureBadge(box, willPlay) {
  if (!box) return;
  var badge = null;
  for (var i = 0; i < box.children.length; i++) if (box.children[i].classList.contains('np-jg-badge')) badge = box.children[i];
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'np-jg-badge';
    badge.setAttribute('aria-hidden', 'true');
    box.appendChild(badge);
  }
  badge.innerHTML = willPlay ? ICONS.play : ICONS.pause;
  badge.classList.remove('is-show'); void badge.offsetWidth; badge.classList.add('is-show');
}

// タップの手ごたえ（ジャケットの並び）：中央に ▶／❚❚ の印を一瞬出し、中央のジャケットを軽く沈ませる
function _jgTapFeedback(willPlay) {
  var box = document.getElementById('np-flow');
  if (!box) return;
  npGestureBadge(box, willPlay);
  var cur = box.querySelector('.np-flow-item.is-center');
  if (cur) { cur.classList.remove('np-jg-tap'); void cur.offsetWidth; cur.classList.add('np-jg-tap'); }
}

// ジャケットの名前（指を置いたとき・読み上げ）：スマホの並びでは操作に合わせる
(function () {
  var f = window._flowPlace;
  if (typeof f !== 'function') return;
  window._flowPlace = function () {
    var r = f.apply(this, arguments);
    if (npJacketGestureOn()) {
      flow.items.forEach(function (el) {
        if (!el.classList.contains('is-center')) return;
        var lbl = 'ジャケット：押すと一時停止／再生、左へはらうと次の曲、右へはらうと前の曲';
        el.title = lbl; el.setAttribute('aria-label', lbl);
      });
    }
    return r;
  };
})();

// 引っぱっている間の説明：スマホの並びでは「離すと再生」（40 の「押すと再生・5秒で戻る」の代わり）
(function () {
  var f = window._flowCaption;
  if (typeof f !== 'function') return;
  window._flowCaption = function () {
    var r = f.apply(this, arguments);
    if (npJacketGestureOn()) {
      var h = document.querySelector('#np-flow-caption .np-flow-cap-hint');
      if (h) h.textContent = '指を離すと再生';
    }
    return r;
  };
})();

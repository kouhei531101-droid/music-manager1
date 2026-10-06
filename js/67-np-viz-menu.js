/* =========================================================
   67-np-viz-menu.js ― スマホ版：再生画面の「描き方ボタン」（ⓘ）と「描き方メニュー」（スマホ版 v8.8）
   ・再生画面（37-now-playing.js）の上部左にあった、オーディオビジュアライザーの描き方の選択（「バー」「波形」「円」の文字の切り替え。#np-modes）を隠し、
     代わりに丸の中に「i」のボタンを1つだけ置く（「描き方ボタン」#np-viz-btn。大きさ・丸の形は右側の閉じるボタンと同じ）
   ・押すと、ボタンのすぐ下に小さなメニュー（「描き方メニュー」#np-viz-menu）が開き、「バー」「波形」「円」をアイコン＋名前で選べる。今の選択に ✓
     選ぶとすぐ切り替わって閉じる。メニューの外を押す・もう一度ボタンを押す・Esc でも閉じる（Esc は再生画面ごとは閉じない）
   ・選択の保存・切り替えは今までどおり（ui.vizMode を変えて saveUi、37 の _npModesUi で描き直す）。隠した #np-modes もそのまま更新される
   ・スマホ版では PC 幅でも同じ（文字の切り替えは出さない）
   ========================================================= */

// 描き方のアイコン（バー＝縦棒、波形＝波線、円＝放射状の円）
var NP_VIZ_ICONS = {
  bars: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="3" height="9" rx="1"/><rect x="8" y="6" width="3" height="15" rx="1"/><rect x="13" y="9" width="3" height="12" rx="1"/><rect x="18" y="3" width="3" height="18" rx="1"/></svg>',
  wave: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0 1.5 3 2 3"/></svg>',
  circle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>'
};
var NP_VIZ_INFO_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6.5" r="1.7"/><rect x="10.5" y="10" width="3" height="9.5" rx="1.3"/></svg>';
var NP_VIZ_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// 描き方ボタンと描き方メニューを、再生画面の上部に足す（1回だけ）
function npVizMenuSetup() {
  var el = document.getElementById('now-playing');
  if (!el || document.getElementById('np-viz-btn')) return;
  var modes = el.querySelector('#np-modes');
  if (!modes) return;
  var wrap = document.createElement('span');
  wrap.className = 'np-viz-wrap';
  wrap.innerHTML =
    '<button type="button" class="np-viz-btn" id="np-viz-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="np-viz-menu" title="ビジュアライザーの描き方" aria-label="ビジュアライザーの描き方">' + NP_VIZ_INFO_ICON + '</button>' +
    '<div class="np-viz-menu" id="np-viz-menu" role="menu" aria-label="描き方メニュー" hidden></div>';
  modes.insertAdjacentElement('beforebegin', wrap);
  modes.classList.add('np-modes-hidden');   // 文字の切り替えは隠す（中身は 37 がそのまま更新する）

  var btn = wrap.querySelector('#np-viz-btn');
  var menu = wrap.querySelector('#np-viz-menu');
  btn.addEventListener('click', function () { if (menu.hidden) npVizMenuOpen(); else npVizMenuClose(); });
  menu.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-viz]');
    if (!b) return;
    ui.vizMode = b.getAttribute('data-viz'); saveUi();
    if (typeof _npModesUi === 'function') _npModesUi();
    npVizMenuClose(true);
  });
  npVizMenuRender();
}

// メニューの中身（今の選択に ✓）
function npVizMenuRender() {
  var menu = document.getElementById('np-viz-menu');
  if (!menu || typeof NP_MODES === 'undefined') return;
  var m = typeof npMode === 'function' ? npMode() : '';
  menu.innerHTML = NP_MODES.map(function (x) {
    var on = x[0] === m;
    return '<button type="button" class="np-viz-item' + (on ? ' is-cur' : '') + '" role="menuitemradio" aria-checked="' + on + '" data-viz="' + x[0] + '" title="' + x[1] + '" aria-label="' + x[1] + '">' +
      '<span class="np-viz-ico">' + (NP_VIZ_ICONS[x[0]] || '') + '</span><span class="np-viz-name">' + x[1] + '</span>' +
      '<span class="np-viz-check">' + (on ? NP_VIZ_CHECK : '') + '</span></button>';
  }).join('');
}

// 開いている間は、上部（.np-top）を本文（.np-main）より手前にする（メニューが本文の下に隠れて押せなくならないように）
function _npVizTopRaise(on) {
  var t = document.querySelector('#now-playing .np-top');
  if (t) t.classList.toggle('np-top-menu-open', !!on);
}
function npVizMenuOpen() {
  var menu = document.getElementById('np-viz-menu'), btn = document.getElementById('np-viz-btn');
  if (!menu || !btn) return;
  npVizMenuRender();
  menu.hidden = false;
  _npVizTopRaise(true);
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('is-open');
  var cur = menu.querySelector('.is-cur') || menu.querySelector('.np-viz-item');
  if (cur) { try { cur.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
function npVizMenuClose(focusBtn) {
  var menu = document.getElementById('np-viz-menu'), btn = document.getElementById('np-viz-btn');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  _npVizTopRaise(false);
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('is-open');
    if (focusBtn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
}

// メニューの外を押したら閉じる（そのタップでは、下にあるボタン・リンクを押さない）
var _npVizSwallowUntil = 0;
document.addEventListener('pointerdown', function (ev) {
  var menu = document.getElementById('np-viz-menu');
  if (!menu || menu.hidden) return;
  if (ev.target.closest('.np-viz-wrap')) return;
  npVizMenuClose(false);
  _npVizSwallowUntil = Date.now() + 700;
}, true);
document.addEventListener('click', function (ev) {
  if (!_npVizSwallowUntil) return;
  var on = Date.now() < _npVizSwallowUntil;
  _npVizSwallowUntil = 0;
  if (on) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
// Esc はメニューだけ閉じる（再生画面は閉じない）
document.addEventListener('keydown', function (ev) {
  var menu = document.getElementById('np-viz-menu');
  if (ev.key !== 'Escape' || !menu || menu.hidden) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  npVizMenuClose(true);
}, true);

// 再生画面を作ったとき・描き方が変わったとき・閉じたときに合わせる
(function () {
  var f = window._npEnsureDom;
  if (typeof f === 'function') {
    window._npEnsureDom = function () {
      var r = f.apply(this, arguments);
      try { npVizMenuSetup(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  var g = window._npModesUi;
  if (typeof g === 'function') {
    window._npModesUi = function () {
      var r = g.apply(this, arguments);
      try { npVizMenuRender(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  var h = window._npHide;
  if (typeof h === 'function') {
    window._npHide = function () {
      try { npVizMenuClose(false); } catch (e) { console.warn(e); }
      return h.apply(this, arguments);
    };
  }
})();
// すでに再生画面ができていたとき
npVizMenuSetup();

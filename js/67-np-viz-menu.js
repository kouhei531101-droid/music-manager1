/* =========================================================
   67-np-viz-menu.js ― スマホ版：再生画面の「描き方ボタン」（ⓘ）と「描き方メニュー」（スマホ版 v8.8）
   ・再生画面（37-now-playing.js）の上部左にあった、オーディオビジュアライザーの描き方の選択（「バー」「波形」「円」の文字の切り替え。#np-modes）を隠し、
     代わりに丸の中に「i」のボタンを1つだけ置く（「描き方ボタン」#np-viz-btn。大きさ・丸の形は右側の閉じるボタンと同じ）
   ・押すと、ボタンのすぐ下に小さなメニュー（「描き方メニュー」#np-viz-menu）が開き、「バー」「波形」「円」をアイコン＋名前で選べる。今の選択に ✓
     選ぶとすぐ切り替わって閉じる。メニューの外を押す・もう一度ボタンを押す・Esc でも閉じる（Esc は再生画面ごとは閉じない）
   ・選択の保存：v8.8〜8.10 は ui.vizMode（1つ）。スマホ版 v8.11 から db.settings.vizModes ほか（73-np-viz-settings.js の setNpViz）。隠した #np-modes は 37 がそのまま更新する
   ・スマホ版では PC 幅でも同じ（文字の切り替えは出さない）
   ・スマホ版 v8.11：描き方メニューを「描き方」の複数選択と「描き方の設定」にした（保存・描き方は 73-np-viz-settings.js・70-np-viz-trail.js）
       描き方：バー・波形・円・なし の4つのチップ（アイコン＋名前）。バー・波形・円は押すたびにオン／オフ（いくつでも重ねられる。✓ と色で今の状態）。
       「なし」を押すと全部オフ（ビジュアライザーを出さない）。選んでもメニューは閉じない
       描き方の設定：バーの数（少ない／ふつう／多い。円の線も 48／96／144 本）・太さ（細い／ふつう／太い）・光（オン／オフ）
     閉じる：メニューの外を押す・もう一度 ⓘ・Esc（再生画面は閉じない）。曲が変わるたび（npRender）には、中身が同じなら書き直さない
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
    var b = ev.target.closest('button');
    if (!b || typeof setNpViz !== 'function') return;
    var sel = null;
    if (b.hasAttribute('data-viz')) {   // バー・波形・円：オン／オフ
      var k = b.getAttribute('data-viz'), m = npVizModes().slice(), i = m.indexOf(k);
      if (i >= 0) m.splice(i, 1); else m.push(k);
      setNpViz({ modes: m }); sel = '[data-viz="' + k + '"]';
    } else if (b.hasAttribute('data-viz-none')) { setNpViz({ modes: [] }); sel = '[data-viz-none]'; }
    else if (b.hasAttribute('data-nvz-bars')) { setNpViz({ bars: b.getAttribute('data-nvz-bars') }); sel = '[data-nvz-bars="' + b.getAttribute('data-nvz-bars') + '"]'; }
    else if (b.hasAttribute('data-nvz-thick')) { setNpViz({ thick: b.getAttribute('data-nvz-thick') }); sel = '[data-nvz-thick="' + b.getAttribute('data-nvz-thick') + '"]'; }
    else if (b.hasAttribute('data-nvz-glow')) { setNpViz({ glow: b.getAttribute('data-nvz-glow') === 'on' }); sel = '[data-nvz-glow="' + b.getAttribute('data-nvz-glow') + '"]'; }
    if (sel) { var f = menu.querySelector(sel); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } }
  });
  npVizMenuRender();
}

// 「なし」のアイコン（斜線の円）
NP_VIZ_ICONS.none = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/></svg>';
// 設定の段（少ない／ふつう／多い など）
function _npVizSeg(name, cur, table) {
  return '<div class="np-viz-seg" role="radiogroup">' + Object.keys(table).map(function (k) {
    return '<button type="button" class="np-viz-seg-btn' + (k === cur ? ' active' : '') + '" role="radio" aria-checked="' + (k === cur) + '" data-nvz-' + name + '="' + k + '">' + table[k].label + '</button>';
  }).join('') + '</div>';
}
// メニューの中身（スマホ版 v8.11：描き方の複数選択＋描き方の設定）。中身が同じなら書き直さない（押している最中に部品が入れ替わらないように）
function npVizMenuRender() {
  var menu = document.getElementById('np-viz-menu'), btn = document.getElementById('np-viz-btn');
  if (!menu || typeof npVizCfg !== 'function') return;
  var cfg = npVizCfg(), none = !cfg.modes.length, sum = npVizSummary();
  if (btn) {
    var t = 'ビジュアライザーの描き方：' + sum + (cfg.glow && !none ? '・光' : '');
    if (btn.title !== t) { btn.title = t; btn.setAttribute('aria-label', t); }
    btn.classList.toggle('is-none', none);
  }
  var chip = function (k, on, attr, name) {
    return '<button type="button" class="np-viz-chip' + (on ? ' is-cur' : '') + '" role="menuitemcheckbox" aria-checked="' + on + '" ' + attr + ' title="' + name + '" aria-label="' + name + '">' +
      '<span class="np-viz-ico">' + NP_VIZ_ICONS[k] + '</span><span class="np-viz-name">' + name + '</span>' +
      '<span class="np-viz-check">' + (on ? NP_VIZ_CHECK : '') + '</span></button>';
  };
  var off = none ? ' is-off' : '';
  var html =
    '<div class="np-viz-mtitle">描き方<span class="np-viz-msub">（いくつでも重ねられます）</span></div>' +
    '<div class="np-viz-chips">' + NVZ_MENU_ORDER.map(function (k) { return chip(k, cfg.modes.indexOf(k) >= 0, 'data-viz="' + k + '"', NVZ_LABEL[k]); }).join('') +
      chip('none', none, 'data-viz-none="1"', 'なし') + '</div>' +
    '<div class="np-viz-mtitle np-viz-set-title">描き方の設定</div>' +
    '<div class="np-viz-row' + off + '"><span class="np-viz-row-label">バーの数</span>' + _npVizSeg('bars', cfg.bars, NVZ_BARS) + '</div>' +
    '<div class="np-viz-row' + off + '"><span class="np-viz-row-label">太さ</span>' + _npVizSeg('thick', cfg.thick, NVZ_THICK) + '</div>' +
    '<div class="np-viz-row' + off + '"><span class="np-viz-row-label">光</span>' + _npVizSeg('glow', cfg.glow ? 'on' : 'off', { on: { label: 'オン' }, off: { label: 'オフ' } }) + '</div>' +
    '<p class="np-viz-note">円の線：' + NVZ_BARS[cfg.bars].circ + '本。光：残像・光る先端・はじける粒' + (typeof np !== 'undefined' && np.reduced ? '（動きを減らす設定のため、残像と粒は出しません）' : '') + '</p>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'描き方メニュー\', event)" title="クリックで「描き方メニュー」をコピー">□</span>';
  if (menu._npvHtml === html) return;
  menu._npvHtml = html;
  menu.innerHTML = html;
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
  var cur = menu.querySelector('.np-viz-chip.is-cur') || menu.querySelector('.np-viz-chip');
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

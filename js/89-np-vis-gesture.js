/* =========================================================
   89-np-vis-gesture.js ― スマホ版：再生画面の「プレイヤー表示の操作」（スマホ版 v8.23.6）
   ・対象：再生画面（#now-playing）のプレイヤー表示が「回転CD」「カセット」「レコード」「MD」のときの、プレイヤー表示の枠（#np-vis-frame。54-spin-cd.js）の中の本体
       回転CD   … #np-cd-disc（.np-cd-disc。54-spin-cd.js）
       カセット … #np-cs-body（.np-cs-body。56-cassette.js）
       レコード … #np-rc-body（.np-rc-body。57-record.js）
       MD       … #np-md-body（.np-md-body。58-md.js）
       スピーカー … #np-sp-body（.np-sp-body。スピーカーのモードのジャケット。97-np-speaker.js。スマホ版 v8.25.7）
     スマホの並び（88-np-jacket-gesture.js の npJacketGestureOn()＝68 の npOneNarrow()：幅 760px 以下・横向きのスマホ）のときだけ。PC 幅は今まで通り
     「ジャケット」のときは 88-np-jacket-gesture.js（ジャケットの並び）が受け持つ
   ・動き（88 の「ジャケットの操作」と同じ。判定・曲送り・一時停止／再生・印は 88 の共通の部品を使う）：
       左へフリック → 次の曲（npGestureSkip('next')＝playNext(true)）、右へフリック → 前の曲（npGestureSkip('prev')＝playPrev()）
       フリックの条件：npGestureFlickDir（横に JG_FLICK_PX〔50px〕以上・横の動きが縦より大きい）
       タップ → 一時停止／再生（npGestureToggle()）。プレイヤー表示の枠の真ん中に ▶／❚❚ の「タップの印」（npGestureBadge）を一瞬出す
   ・動かしている間の見た目：本体の置き場所（.np-cd-big など）を、指の横の動きの 3割（最大 36px）だけ横にずらす（CSS の translate。
     置き場所の transform〔真ん中に置く translate(-50%,-50%)〕や、中で回っている絵の animation には触らない）。離すと元の位置へ戻る
   ・二重に動かない作り：タップは click の1か所だけで扱う（枠で先に受け取り〔capture〕、本体の「ジャケット拡大表示」へは渡さない）。
     touchend・pointerup では一時停止／再生をしない。指を 8px より動かしたあとの click は無視する（フリック・引っぱりのあと）
   ・縦の動き：本体は touch-action: pan-y（style.css）なので、縦に動かすとブラウザの動きになり pointercancel が来る → 何もしない（元の位置に戻すだけ）。
     pointerup まで来ても、縦の動きが大きいときは npGestureFlickDir が '' なので曲は変わらない
   ・今までの動き（スマホの並びでは置き換え）：本体を押す → ジャケット拡大表示　→　一時停止／再生 に変更。PC 幅は今まで通りジャケット拡大表示
   ・対象外：歌詞の重ね表示（78。開いている間はプレイヤーの上に重なるので、下の本体には指が届かない）・曲リスト（68 の .np-list-open。枠を隠す）
   ・保存データ・バックアップには触らない
   ========================================================= */

var NPVG_BODY_SEL = '.np-cd-disc, .np-cs-body, .np-rc-body, .np-md-body, .np-sp-body';   // 押せる本体（スマホ版 v8.25.7：スピーカーのモードのジャケット .np-sp-body も）
var NPVG_BIG_SEL = '.np-cd-big, .np-cs-big, .np-rc-big, .np-md-big, .np-sp-big';        // 本体の置き場所（動かしている間に横へずらす）
var NPVG_MOVE_PX = 8;      // これより動かしたらタップではない
var NPVG_NUDGE = 0.3;      // 指の動きに対する、ずらす割合
var NPVG_NUDGE_MAX = 36;   // ずらす最大（px）
var npvg = { bound: false, id: null, x0: 0, y0: 0, moved: false, big: null, movedAt: 0 };

// 今、プレイヤー表示の操作にするかどうか（スマホの並び かつ 回転CD・カセット・レコード・MD のどれか）
function npVisGestureOn() {
  var el = document.getElementById('now-playing');
  return !!(el && el.classList.contains('np-vis-mode') && typeof npJacketGestureOn === 'function' && npJacketGestureOn());
}

// 置き場所のずれを元に戻す（なめらかに）
function _npvgReset() {
  var big = npvg.big;
  npvg.id = null; npvg.big = null;
  if (!big || !big.style.translate) return;
  big.classList.add('np-vg-back');
  big.style.translate = '';
  setTimeout(function () { big.classList.remove('np-vg-back'); }, 260);
}

// プレイヤー表示の枠に、指の受け口を付ける（1回だけ）
function _npvgBind(frame) {
  if (npvg.bound || !frame) return;
  npvg.bound = true;

  frame.addEventListener('pointerdown', function (ev) {
    if (!npVisGestureOn() || !ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    var body = ev.target.closest(NPVG_BODY_SEL);
    if (!body || body.disabled || !frame.contains(body)) return;
    npvg.id = ev.pointerId; npvg.x0 = ev.clientX; npvg.y0 = ev.clientY; npvg.moved = false;
    npvg.big = body.closest(NPVG_BIG_SEL);
    if (npvg.big) npvg.big.classList.remove('np-vg-back');
    try { body.setPointerCapture(ev.pointerId); } catch (e) { /* 取れなくても動く */ }
  });

  frame.addEventListener('pointermove', function (ev) {
    if (npvg.id !== ev.pointerId) return;
    var dx = ev.clientX - npvg.x0, dy = ev.clientY - npvg.y0;
    if (!npvg.moved && (Math.abs(dx) > NPVG_MOVE_PX || Math.abs(dy) > NPVG_MOVE_PX)) npvg.moved = true;
    if (npvg.big && npvg.moved && Math.abs(dx) > Math.abs(dy)) {   // 横の動きのときだけ、少し横へずらす
      var n = Math.max(-NPVG_NUDGE_MAX, Math.min(NPVG_NUDGE_MAX, dx * NPVG_NUDGE));
      npvg.big.style.translate = Math.round(n) + 'px 0';
    }
  });

  frame.addEventListener('pointerup', function (ev) {
    if (npvg.id !== ev.pointerId) return;
    var dx = ev.clientX - npvg.x0, dy = ev.clientY - npvg.y0;
    if (npvg.moved) npvg.movedAt = Date.now();   // このあとに来る click は無視する
    _npvgReset();
    if (npvg.moved) npGestureSkip(npGestureFlickDir(dx, dy));
  });

  // 縦のスクロールなど、ブラウザに指を取られたとき：何もしない（元の位置に戻すだけ）
  frame.addEventListener('pointercancel', function (ev) {
    if (npvg.id !== ev.pointerId) return;
    if (npvg.moved) npvg.movedAt = Date.now();
    _npvgReset();
  });

  // 押したとき（click の1か所だけで扱う）：本体の「ジャケット拡大表示」より先に受け取る
  frame.addEventListener('click', function (ev) {
    if (!npVisGestureOn()) return;   // PC 幅は今まで通り（ジャケット拡大表示）
    var body = ev.target.closest(NPVG_BODY_SEL);
    if (!body || !frame.contains(body)) return;   // 名前のコピー（□）などはそのまま
    ev.stopPropagation(); ev.preventDefault();
    if (Date.now() - npvg.movedAt < 500) return;   // フリック・引っぱりのあと
    if (!player.currentPath) return;
    npGestureBadge(frame, npGestureToggle());
  }, true);

  // 絵を引っぱったときのブラウザの「画像のドラッグ」を止める（スマホの並びだけ）
  frame.addEventListener('dragstart', function (ev) { if (npVisGestureOn()) ev.preventDefault(); });
}

// 本体の名前（指を置いたとき・読み上げ）：スマホの並びでは操作に合わせる。PC 幅は元の名前に戻す
var NPVG_NAMES = { 'np-cd-disc': '回転CD', 'np-cs-body': 'カセットテープ', 'np-rc-body': 'レコード', 'np-md-body': 'MD', 'np-sp-body': 'スピーカーのモード' };
function _npvgLabels(el) {
  var on = typeof npJacketGestureOn === 'function' && npJacketGestureOn();   // スマホの並びかどうか（本体が見えるのはプレイヤー表示の枠を出しているときだけ）
  Object.keys(NPVG_NAMES).forEach(function (id) {
    var b = el.querySelector('#' + id);
    if (!b) return;
    if (!b.hasAttribute('data-npvg-title')) {   // 元の名前を覚えておく（1回だけ）
      b.setAttribute('data-npvg-title', b.title || '');
      b.setAttribute('data-npvg-label', b.getAttribute('aria-label') || '');
    }
    var title = on ? '押すと一時停止／再生、左へはらうと次の曲、右へはらうと前の曲' : b.getAttribute('data-npvg-title');
    var label = on ? NPVG_NAMES[id] + '：' + title : b.getAttribute('data-npvg-label');
    if (b.title !== title) b.title = title;
    if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
  });
}

// プレイヤー表示を合わせるたび（54 の spinCdApply）に、受け口を付けて名前を合わせる
(function () {
  var f = window.spinCdApply;
  if (typeof f !== 'function') return;
  window.spinCdApply = function () {
    var r = f.apply(this, arguments);
    try {
      var el = document.getElementById('now-playing');
      if (el) {
        _npvgBind(el.querySelector('#np-vis-frame'));
        _npvgLabels(el);
      }
    } catch (e) { console.warn(e); }
    return r;
  };
})();

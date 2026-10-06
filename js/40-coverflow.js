/* =========================================================
   40-coverflow.js ― 再生画面の「ジャケットの並び」（カバーフロー。v5.7）
   ・再生画面（v5.1）とプレイリストの play画面（v5.6）の大きなジャケットの所を、再生の並び（player.queue。シャッフル中は再生順）の
     ジャケットを横に並べた形にした。中央が見ている曲（ふだんは再生中の曲）、左が前の曲、右が次の曲（少し小さく・薄く・暗く、中央の後ろに重なる）。
     その外側にもう1枚ずつ、さらに小さく薄く出す（中央の前後3枚まで作り、描くのはそれだけ。数千曲でも軽い）
   ・スライド：左右のスワイプ・マウスのドラッグ・横スクロール（トラックパッド）・キーボードの ← →。スライドしても曲は変わらない。
     下の「ジャケットの並びの説明」に、中央に来た曲の曲名・アーティストを出す。5秒操作が無ければ、再生中の曲の位置に戻る
   ・クリック：前後（または中央に来た別の曲）のジャケットを押すと、その曲を再生（キューの行と同じ）。再生中の曲のジャケットを押すとジャケット拡大表示。
     ドラッグ・スワイプで動かした直後のクリックは無視する
   ・曲が変わったら、なめらかにスライドして新しい曲が中央に来る（prefers-reduced-motion では動きを短く）
   ・並びの端：先頭の左・最後の右は空。リピートが「全曲」のときは反対側の曲を見せる
   ========================================================= */

var flow = { view: 0, drag: 0, items: new Map(), dragging: false, moved: false, x0: 0, wheel: 0, idleTimer: 0, lastQueue: null, colorPath: null };
var FLOW_RANGE = 3;          // 中央の前後に作る枚数
var FLOW_IDLE_MS = 5000;     // 操作が無ければ再生中の曲に戻るまで

function _flowQueue() { return player.queue || []; }
function _flowIndexAt(i) {   // 並びの番号（端を越えたら、リピート全曲のときだけ反対側へ）
  var n = _flowQueue().length;
  if (!n) return -1;
  if (i >= 0 && i < n) return i;
  if ((db.settings.repeat || 'off') === 'all' && n > 1) return ((i % n) + n) % n;
  return -1;
}
// 見た目：e は中央からのずれ（枚数。途中の値もある）
function _flowStyle(e) {
  var a = Math.abs(e), s = e < 0 ? -1 : 1, narrow = window.innerWidth <= 760;
  var step1 = narrow ? 0.34 : 0.42, step2 = narrow ? 0.18 : 0.24;
  var x = s * (a <= 1 ? step1 * a : step1 + step2 * Math.min(a - 1, 2));
  var scale = 1 - (a <= 1 ? 0.22 * a : 0.22 + 0.14 * Math.min(a - 1, 2));
  var op = a <= 1 ? 1 - 0.3 * a : Math.max(0, 0.7 - 0.45 * (a - 1));
  var br = 1 - 0.32 * Math.min(a, 1.5);
  return { x: x, scale: scale, op: op, br: br, z: 100 - Math.round(a * 10) };
}
function _flowEnsure() {
  var main = document.querySelector('#now-playing .np-main');
  if (!main) return null;
  var box = document.getElementById('np-flow');
  if (box) return box;
  var wrap = document.createElement('div');
  wrap.className = 'np-flow-wrap';
  wrap.innerHTML = '<div class="np-flow" id="np-flow" role="group" aria-label="ジャケットの並び（左右にスライド・押すとその曲を再生）" tabindex="0"></div>' +
    '<div class="np-flow-caption" id="np-flow-caption" aria-live="polite"></div>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;left:0" onclick="copyUiLabel(\'ジャケットの並び\', event)" title="クリックで「ジャケットの並び」をコピー">□</span>';
  var art = document.getElementById('np-art');
  art.insertAdjacentElement('beforebegin', wrap);
  box = wrap.querySelector('#np-flow');
  _flowBind(box);
  return box;
}
// 描く：中央の前後 FLOW_RANGE 枚の要素を作り（足りない分だけ）、位置を合わせる
function flowRender(snap) {
  var box = _flowEnsure();
  if (!box) return;
  var q = _flowQueue();
  if (flow.lastQueue !== q || snap) { flow.lastQueue = q; }
  if (!flow.dragging && !flow.idleTimer) flow.view = Math.max(0, player.index);
  var want = new Map();
  for (var o = -FLOW_RANGE; o <= FLOW_RANGE; o++) {
    var k = flow.view + o, qi = _flowIndexAt(k);
    if (qi < 0) continue;
    want.set(k, qi);
  }
  // 要らなくなったものを外す（v6.2：並びの番号が同じでも、曲〔パス〕が違えば作り直す。
  //   別のプレイリストを再生した・シャッフルした・キューを並べ替えたあと、前の曲のジャケットが残っていた）
  flow.items.forEach(function (el, k) { if (!want.has(k) || +el.getAttribute('data-q') !== want.get(k) || el.getAttribute('data-path') !== (q[want.get(k)] || '')) { el.remove(); flow.items.delete(k); } });
  var added = false;
  want.forEach(function (qi, k) {
    if (flow.items.has(k)) return;
    var path = q[qi], t = library.byPath[path];
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'np-flow-item';
    el.setAttribute('data-k', k); el.setAttribute('data-q', qi); el.setAttribute('data-path', path || '');
    el.innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    if (snap) el.classList.add('no-anim');
    box.appendChild(el);
    flow.items.set(k, el);
    added = true;
  });
  if (added) artObserve(box);
  _flowPlace(snap);
  _flowCaption();
  // 代表色（ビジュアライザー）：再生中の曲のジャケットから
  var cur = flow.items.get(Math.max(0, player.index));
  if (cur && flow.colorPath !== player.currentPath && typeof _npWatchArtColor === 'function') {
    flow.colorPath = player.currentPath;
    _npWatchArtColor(cur, library.byPath[player.currentPath] || null);
  }
}
function _flowPlace(snap) {
  var reduced = np.reduced;
  flow.items.forEach(function (el, k) {
    var e = k - flow.view - flow.drag, st = _flowStyle(e), qi = +el.getAttribute('data-q'), t = library.byPath[_flowQueue()[qi]];
    el.style.setProperty('--fx', st.x);
    el.style.setProperty('--fs', st.scale);
    el.style.opacity = st.op.toFixed(3);
    el.style.filter = st.br < 0.999 ? 'brightness(' + st.br.toFixed(3) + ')' : '';
    el.style.zIndex = st.z;
    el.classList.toggle('is-center', Math.round(e) === 0);
    el.classList.toggle('is-playing', qi === player.index);
    el.classList.toggle('is-hidden', st.op <= 0.02);
    el.classList.toggle('no-anim', !!snap || flow.dragging || reduced === 'none');
    el.tabIndex = Math.round(e) === 0 ? 0 : -1;
    var title = t ? t.title : trackDisplayTitle(_flowQueue()[qi] || '');
    var lbl = qi === player.index ? (Math.round(e) === 0 ? '再生中：' + title + '（押すとジャケットを大きく表示）' : '再生中：' + title) : (e < 0 ? '前の曲' : '次の曲') + '：' + title + '（押すと再生）';
    el.title = lbl; el.setAttribute('aria-label', lbl);
  });
  var box = document.getElementById('np-flow');
  if (box) box.classList.toggle('reduced', !!np.reduced);
  if (snap) requestAnimationFrame(function () { flow.items.forEach(function (el) { el.classList.remove('no-anim'); }); });
}
// 中央に来た曲の説明（再生中の曲と違うときは「押すと再生」）
function _flowCaption() {
  var cap = document.getElementById('np-flow-caption');
  if (!cap) return;
  var k = Math.round(flow.view + flow.drag), qi = _flowIndexAt(k);
  if (qi < 0 || qi === player.index) { cap.innerHTML = ''; cap.classList.remove('is-other'); return; }
  var t = library.byPath[_flowQueue()[qi]];
  cap.classList.add('is-other');
  cap.innerHTML = '<span class="np-flow-cap-kind">' + (qi < player.index ? '前の曲' : '次の曲') + '</span><span class="np-flow-cap-title">' + escapeHtml(t ? t.title : trackDisplayTitle(_flowQueue()[qi])) + '</span>' +
    (t && t.artist ? '<span class="np-flow-cap-sub">' + escapeHtml(t.artist) + '</span>' : '') + '<span class="np-flow-cap-hint">押すと再生・5秒で戻る</span>';
}
// 見ている位置を動かす（曲は変わらない）
function flowSlide(step) {
  var n = _flowQueue().length;
  if (!n) return;
  var v = flow.view + step;
  if ((db.settings.repeat || 'off') !== 'all') v = Math.max(0, Math.min(n - 1, v));
  flow.view = v;
  _flowTouch();
  flowRender();
}
function _flowTouch() {
  if (flow.idleTimer) clearTimeout(flow.idleTimer);
  flow.idleTimer = setTimeout(function () { flow.idleTimer = 0; flow.view = Math.max(0, player.index); if (np.open) flowRender(); }, FLOW_IDLE_MS);
}
function _flowBind(box) {
  var W = function () { var c = box.querySelector('.np-flow-item'); return c ? c.offsetWidth : 300; };
  // v5.8 で直した：押した瞬間に setPointerCapture すると、マウスの click の相手が並びの入れ物になり、どのジャケットを押したか分からなかった。
  //   今は、引っぱったと分かってから（マウス 10px・タッチ 12px 以上動いたら）だけ捕まえる。動かさずに離したときは、ふつうの click で
  //   押したジャケットが分かる（タッチのあとの click・キーボードの Enter／スペースも同じ）。念のため、相手が入れ物のときは押した所（elementFromPoint）で探す
  box.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    flow.dragging = true; flow.moved = false; flow.x0 = ev.clientX; flow.drag = 0; flow.pid = ev.pointerId;
    flow.slop = ev.pointerType === 'mouse' ? 10 : 12;
  });
  box.addEventListener('pointermove', function (ev) {
    if (!flow.dragging || ev.pointerId !== flow.pid) return;
    var dx = ev.clientX - flow.x0;
    if (!flow.moved && Math.abs(dx) > flow.slop) {
      flow.moved = true;
      try { box.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }   // 引っぱり始めてから捕まえる（外に出ても追える）
    }
    if (!flow.moved) return;
    var step = W() * (window.innerWidth <= 760 ? 0.34 : 0.42);
    flow.drag = -dx / step;
    var n = _flowQueue().length;
    if ((db.settings.repeat || 'off') !== 'all') flow.drag = Math.max(-flow.view - 0.3, Math.min(n - 1 - flow.view + 0.3, flow.drag));
    _flowPlace(); _flowCaption();
  });
  var end = function (ev) {
    if (!flow.dragging) return;
    flow.dragging = false;
    if (flow.moved) { var st = Math.round(flow.drag); flow.drag = 0; flowSlide(st); flow.justDragged = Date.now(); return; }
    flow.drag = 0; _flowPlace();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('click', function (ev) {
    if (flow.justDragged && Date.now() - flow.justDragged < 400) { ev.preventDefault(); return; }   // ドラッグの終わりはクリックにしない
    var it = ev.target.closest && ev.target.closest('.np-flow-item');
    if (!it && ev.detail > 0) { var hit = document.elementFromPoint(ev.clientX, ev.clientY); it = hit && hit.closest ? hit.closest('.np-flow-item') : null; }
    if (it && box.contains(it)) flowActivate(it);
  });
  // 横スクロール（トラックパッド・Shift＋ホイール）
  box.addEventListener('wheel', function (ev) {
    var dx = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : (ev.shiftKey ? ev.deltaY : 0);
    if (!dx) return;
    ev.preventDefault();
    flow.wheel += dx;
    if (Math.abs(flow.wheel) >= 70) { flowSlide(flow.wheel > 0 ? 1 : -1); flow.wheel = 0; }
  }, { passive: false });
}
// ジャケットを押したとき：再生中の曲なら拡大表示、ほかの曲ならその曲を再生（キューの番号＝再生の並びの番号）
function flowActivate(it) {
  var qi = +it.getAttribute('data-q');
  if (!(qi >= 0)) return;
  if (qi === player.index) { if (player.currentPath) openArtworkViewer(); return; }
  if (flow.idleTimer) { clearTimeout(flow.idleTimer); flow.idleTimer = 0; }
  playAt(qi);
}
// キーボードの ← →（再生画面を開いているとき。入力欄・つまみの上では効かない）
document.addEventListener('keydown', function (ev) {
  if (!np.open || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  var t = ev.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
  var av = document.getElementById('art-viewer'), dlg = document.getElementById('dialog-modal');
  if ((av && !av.hidden) || (dlg && !dlg.hidden)) return;
  ev.preventDefault();
  flowSlide(ev.key === 'ArrowLeft' ? -1 : 1);
});
window.addEventListener('resize', function () { if (np.open) _flowPlace(true); });

/* =========================================================
   72-pin-sort-drag.js ― Pin の並べ替えモードのドラッグ（スマホ版 v8.11。PC版 v8.7.8 の 60-pin-sort-drag.js と同じ作り）
   ・スマホ版との違い：
       ① 自動スクロールの下の端は、画面の下に固定した部品（下部メニューバー・縮小した歌詞の帯・再生中ボタン・読み込みの帯）の上
          （横向きのナビレールは左の帯なので数えない）。_pinBottomLimit
       ② Pin の区切りはスマホ幅では1行の横スクロールだが、並べ替えモード中（.is-editing）は今までどおり折り返しのグリッドに戻すので、
          カードは上下左右にドラッグして動かす（横スクロールのままにはしない）
       ③ 長押しのメニュー（48-album-context-menu.js。0.55秒）は、モード中のカードでは出さない（isPinSortTarget）。
          ドラッグは指が 5px 以上動いてから始まる。モード中のカードだけ touch-action: none（モード外の一覧はいつもどおりスクロールできる）
   ・Pin の並べ替えボタン（Pin の区切りの見出し）を押すと「Pin の並べ替えモード」（albView.pinSorting。14-albums.js が描く）
     カード（.pin-sort-card、data-pin-key）を Pointer Events でドラッグして動かす（マウス・タッチ・ペン共通。HTML5 のドラッグは使わない）
       持ち上げたカード：複製（.pin-sort-ghost）が少し大きく・影付きでポインターに付いてくる。元のカードは点線の「空き」になり、
       ほかのカードは FLIP（動く前と後の位置の差を transform で縮める）で滑らかに場所を空ける
       画面の上下の端に近づくと自動で縦にスクロール。Esc でドラッグをやめる（元の位置に戻る）
     キーボード：カードにフォーカスして ← →（↑ ↓ も）で1つ動かす、Home / End で先頭・最後へ
     モードの終わり方：「完了」（同じボタン）か Esc（ドラッグしていないとき）
   ・保存先：db.pinnedAlbums の順（tools の「Pin のアルバム」の ↑↓ と同じデータ。バックアップ・復元に含む）
     見えている Pin（albView.pinned）の並びを、db.pinnedAlbums の中で見えている Pin が入っていた位置に入れ直す
     （非表示のアルバム・今の音楽フォルダに無い Pin の位置は変わらない）
   ・検索・絞り込みで Pin の一部しか見えていないときは、並べ替えボタンを押せない（14-albums.js の albView.pinSortBlocked）
   ・Pin の再生ボタン／Pin のシャッフル再生ボタン（Pin の区切りの見出し）は 62-album-set-play.js
   ========================================================= */

/* ---------- 並びの保存 ---------- */
// keys：見えている Pin の新しい並び（目印）。db.pinnedAlbums の中の同じ目印の位置（集合）に、この順で入れ直す
function applyPinnedOrderShown(keys) {
  var list = (db.pinnedAlbums || []).slice();
  var ks = new Set(keys);
  var slots = [], recs = new Map();
  list.forEach(function (p, i) { if (ks.has(p.key)) { slots.push(i); recs.set(p.key, p); } });
  if (slots.length !== keys.length) return false;
  var changed = false;
  slots.forEach(function (pos, n) { var r = recs.get(keys[n]); if (list[pos] !== r) changed = true; list[pos] = r; });
  if (!changed) return false;
  db.pinnedAlbums = list;
  saveDB();
  return true;
}
// 今の Pin の並び（目印の配列。確認・不具合調べ用）
function pinnedAlbumOrder() { return (db.pinnedAlbums || []).map(function (p) { return p.key; }); }

// Pin の並べ替えモードのカードか（48-album-context-menu.js の右クリック・長押しメニューを止める）
function isPinSortTarget(target) {
  return !!(albView.pinSorting && target && target.closest && target.closest('.album-pin-grid.pin-sort-mode'));
}

/* ---------- ドラッグ ---------- */
var pinDrag = null;   // { card, grid, ghost, id, sx, sy, x, y, offX, offY, started, raf, startKeys, topLimit, bottomLimit }
var PIN_DRAG_START = 5;   // この px 以上動いたらドラッグ開始（それまではただの押下）

function _pinGridCards(grid) { return Array.prototype.slice.call(grid.querySelectorAll(':scope > .pin-sort-card')); }
function _pinKeysOf(grid) { return _pinGridCards(grid).map(function (c) { return c.getAttribute('data-pin-key'); }); }

// FLIP：mutate() の前後の位置の差を transform で付け、0 へ戻して滑らかに動かす（動かしているカード自身は除く）
function _pinFlip(grid, mutate, skip) {
  var cards = _pinGridCards(grid);
  var first = new Map();
  cards.forEach(function (c) { if (c !== skip) first.set(c, c.getBoundingClientRect()); });
  mutate();
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cards.forEach(function (c) {
    if (c === skip || !first.has(c)) return;
    c.style.transition = 'none';
    c.style.transform = '';
    if (reduce) return;
    var a = first.get(c), b = c.getBoundingClientRect();
    var dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    void c.offsetWidth;   // いったん描かせてから戻す
    c.style.transition = 'transform 0.22s cubic-bezier(.2,.7,.3,1)';
    c.style.transform = '';
  });
}

// ポインターの位置から、空き（動かしているカード）を入れる位置を決めて動かす
function _pinDragUpdateTarget() {
  var d = pinDrag;
  if (!d || !d.started) return;
  var cards = _pinGridCards(d.grid), gr = d.grid.getBoundingClientRect();
  var px = d.x, py = d.y;
  if (px < gr.left - 40 || px > gr.right + 40 || py < gr.top - 40 || py > gr.bottom + 40) return;   // Pin の区切りから大きく外れたら動かさない
  // 並びの中の位置（transform を含まない offset で比べる）
  var best = -1, bestD = Infinity;
  cards.forEach(function (c, i) {
    var l = gr.left + c.offsetLeft, t = gr.top + c.offsetTop, w = c.offsetWidth, h = c.offsetHeight;
    if (px >= l && px <= l + w && py >= t && py <= t + h) { best = i; bestD = -1; return; }
    if (bestD < 0) return;
    var cx = l + w / 2, cy = t + h / 2, dd = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (dd < bestD) { bestD = dd; best = i; }
  });
  var cur = cards.indexOf(d.card);
  if (best < 0 || best === cur) return;
  _pinFlip(d.grid, function () {
    if (best > cur) d.grid.insertBefore(d.card, cards[best].nextSibling);
    else d.grid.insertBefore(d.card, cards[best]);
  }, d.card);
}

function _pinGhostMove() {
  var d = pinDrag;
  if (!d || !d.ghost) return;
  d.ghost.style.left = (d.x - d.offX) + 'px';
  d.ghost.style.top = (d.y - d.offY) + 'px';
}

// 画面の上下の端に近いときの自動スクロール（縦）
function _pinAutoScrollLoop() {
  var d = pinDrag;
  if (!d || !d.started) return;
  var edge = 70, dy = 0;
  if (d.y < d.topLimit + edge) dy = -Math.ceil((d.topLimit + edge - d.y) / edge * 16);
  else if (d.y > d.bottomLimit - edge) dy = Math.ceil((d.y - (d.bottomLimit - edge)) / edge * 16);
  if (dy) {
    var before = window.scrollY;
    window.scrollBy(0, Math.max(-24, Math.min(24, dy)));
    if (window.scrollY !== before) _pinDragUpdateTarget();
  }
  d.raf = requestAnimationFrame(_pinAutoScrollLoop);
}

// 自動スクロールの下の端（スマホ版）：画面の下半分にある固定の部品（下部メニューバー・縮小した歌詞の帯・再生中ボタン・読み込みの帯・再生バー）の上の端。
// 本文より左にある部品（横向きのナビレールとその中の再生中ボタン）は数えない
function _pinBottomLimit() {
  var lim = window.innerHeight, main = document.getElementById('main'), ml = main ? main.getBoundingClientRect().left : 0;
  ['bottom-nav', 'lyrics-panel', 'alb-np-fab', 'player-bar', 'load-progress'].forEach(function (id) {
    var e = document.getElementById(id) || document.querySelector('.' + id);
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return;
    var r = e.getBoundingClientRect();
    if (r.height < 1 || r.right <= ml + 1 || r.top < window.innerHeight * 0.5) return;
    lim = Math.min(lim, r.top);
  });
  return lim;
}
function _pinDragBegin() {
  var d = pinDrag, r = d.card.getBoundingClientRect();
  d.started = true;
  d.offX = d.sx - r.left; d.offY = d.sy - r.top;
  // 複製は「album-pin-grid」の箱に入れて body に置く（Pin の区切りのカードと同じ大きさ・文字の見た目になるように）
  var c = d.card.cloneNode(true);
  c.removeAttribute('tabindex'); c.removeAttribute('data-pin-album'); c.removeAttribute('data-pin-key'); c.removeAttribute('role');
  c.classList.remove('is-drag-source');
  var g = document.createElement('div');
  g.className = 'album-pin-grid pin-sort-ghost';
  g.setAttribute('aria-hidden', 'true');
  g.appendChild(c);
  g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
  document.body.appendChild(g);
  d.ghost = g;
  _pinGhostMove();
  d.card.classList.add('is-drag-source');
  document.body.classList.add('pin-dragging');
  d.topLimit = 0;
  d.bottomLimit = _pinBottomLimit();
  d.raf = requestAnimationFrame(_pinAutoScrollLoop);
}

// ドラッグの終わり（cancel：元の並びに戻す）
function _pinDragEnd(cancel) {
  var d = pinDrag;
  if (!d) return;
  pinDrag = null;
  if (d.raf) cancelAnimationFrame(d.raf);
  try { d.card.releasePointerCapture(d.id); } catch (e) { /* 無視 */ }
  document.body.classList.remove('pin-dragging');
  if (!d.started) return;
  var key = d.card.getAttribute('data-pin-key');
  var finish = function () {
    if (d.ghost) d.ghost.remove();
    d.card.classList.remove('is-drag-source');
    var keys = _pinKeysOf(d.grid);
    var changed = !cancel && keys.join('\n') !== d.startKeys.join('\n') && applyPinnedOrderShown(keys);
    if (cancel || changed) {
      var y = window.scrollY;
      renderAlbumsPage();
      window.scrollTo(0, y);
    }
    _pinFocusCard(key);
  };
  // 複製を空きの位置へ吸い込ませてから消す
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (cancel || reduce || !d.ghost) { finish(); return; }
  var r = d.card.getBoundingClientRect();
  d.ghost.classList.add('is-dropping');
  d.ghost.style.left = r.left + 'px'; d.ghost.style.top = r.top + 'px';
  var done = false, fin = function () { if (done) return; done = true; finish(); };
  d.ghost.addEventListener('transitionend', fin);
  setTimeout(fin, 260);
}

function _pinFocusCard(key) {
  var c = Array.prototype.find.call(document.querySelectorAll('#alb-body .pin-sort-card'), function (x) { return x.getAttribute('data-pin-key') === key; });
  if (c) try { c.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
}

/* ---------- キーボード：← → で1つ動かす ---------- */
function _pinKeyMove(card, key) {
  var grid = card.closest('.album-pin-grid');
  var keys = _pinKeysOf(grid), k = card.getAttribute('data-pin-key'), i = keys.indexOf(k), j = i;
  if (key === 'ArrowLeft' || key === 'ArrowUp') j = i - 1;
  else if (key === 'ArrowRight' || key === 'ArrowDown') j = i + 1;
  else if (key === 'Home') j = 0;
  else if (key === 'End') j = keys.length - 1;
  if (j < 0 || j >= keys.length || j === i) return;
  keys.splice(i, 1); keys.splice(j, 0, k);
  if (applyPinnedOrderShown(keys)) {
    var y = window.scrollY;
    renderAlbumsPage();
    window.scrollTo(0, y);
    _pinFocusCard(k);
  }
}

/* ---------- 受け付け（最初に1回だけ） ---------- */
(function () {
  var body = document.getElementById('alb-body');
  if (!body) return;
  body.addEventListener('pointerdown', function (ev) {
    if (!albView.pinSorting || pinDrag) return;
    var card = ev.target.closest && ev.target.closest('.album-pin-grid.pin-sort-mode > .pin-sort-card');
    if (!card) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();   // 文字の選択・画像のドラッグを始めない
    try { card.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    pinDrag = { card: card, grid: card.parentNode, ghost: null, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
      offX: 0, offY: 0, started: false, raf: 0, startKeys: _pinKeysOf(card.parentNode) };
    try { card.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
  });
  body.addEventListener('pointermove', function (ev) {
    var d = pinDrag;
    if (!d || ev.pointerId !== d.id) return;
    d.x = ev.clientX; d.y = ev.clientY;
    if (!d.started) {
      if (Math.abs(d.x - d.sx) < PIN_DRAG_START && Math.abs(d.y - d.sy) < PIN_DRAG_START) return;
      _pinDragBegin();
    }
    ev.preventDefault();
    _pinGhostMove();
    _pinDragUpdateTarget();
  });
  body.addEventListener('pointerup', function (ev) { if (pinDrag && ev.pointerId === pinDrag.id) _pinDragEnd(false); });
  body.addEventListener('pointercancel', function (ev) { if (pinDrag && ev.pointerId === pinDrag.id) _pinDragEnd(true); });
  body.addEventListener('lostpointercapture', function (ev) { if (pinDrag && ev.pointerId === pinDrag.id && !pinDrag.started) _pinDragEnd(true); });
  // モード中は、カードの画像を HTML5 のドラッグで持ち出さない
  body.addEventListener('dragstart', function (ev) { if (isPinSortTarget(ev.target)) ev.preventDefault(); });

  // キーボード（カードにフォーカスしているとき）
  body.addEventListener('keydown', function (ev) {
    if (!albView.pinSorting) return;
    var card = ev.target.closest && ev.target.closest('.pin-sort-card');
    if (!card || card !== ev.target) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(ev.key) >= 0) {
      ev.preventDefault(); ev.stopPropagation();
      if (!pinDrag) _pinKeyMove(card, ev.key);
    } else if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault(); ev.stopPropagation();   // 再生・一時停止（スペース）やカードを開く動きはしない
    }
  });

  // Esc：ドラッグ中はやめる（元の位置へ）。ドラッグしていなければモードを終わる
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !albView.pinSorting || currentPage !== 'albums') return;
    var dlg = document.getElementById('dialog-modal');
    if (dlg && !dlg.hidden) return;
    if (typeof acm !== 'undefined' && acm.el) return;
    ev.preventDefault();
    if (pinDrag) { _pinDragEnd(true); return; }
    togglePinSorting(false);
    var sb = document.querySelector('#alb-body [data-act="pin-sort"]');
    if (sb) try { sb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
  });
  // 右クリック：モード中のカードではメニューを出さない
  document.addEventListener('contextmenu', function (ev) { if (isPinSortTarget(ev.target)) ev.preventDefault(); }, true);
})();

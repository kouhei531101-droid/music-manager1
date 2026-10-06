/* =========================================================
   45-album-scroll.js ― album の一覧のスクロールボタン（v7.2）
   ・album の一覧（アルバムの曲一覧ではない）のとき、右下に浮いた丸いボタンを縦に4つ：
       一番上へ（⤒）／▲（1画面分上へ）／▼（1画面分下へ）／一番下へ（⤓）
   ・位置は再生バー・歌詞パネル・読み込みの進み具合の帯の上（--player-h・--lyr-bottom・--load-h・--lyr-right）
   ・一番下へ：少しずつ読み込んでいる続き（「さらに表示」）を 200枚ずつ最後まで出してから、本当の一番下へ（その間はボタンに読み込み中の印）
   ・一番上で ▲・一番上へ、一番下（続きも無い）で ▼・一番下へ は押せない（薄く）。ページがスクロールできないときは出さない
   ========================================================= */

var albScroll = { el: null, raf: 0, busy: false };

function _albScrollEnsure() {
  if (albScroll.el) return albScroll.el;
  var el = document.createElement('div');
  el.id = 'alb-scroll-btns';
  el.className = 'alb-scroll';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'スクロールボタン');
  var b = function (act, icon, name) { return '<button type="button" class="alb-scroll-btn" data-scroll="' + act + '" title="' + name + '" aria-label="' + name + '">' + icon + '</button>'; };
  el.innerHTML =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-12px;left:-10px" onclick="copyUiLabel(\'スクロールボタン\', event)" title="クリックで「スクロールボタン」をコピー">□</span>' +
    b('top', _svg('<path d="M6 4h12"/><path d="M12 20V8"/><path d="M7 13l5-5 5 5"/>'), '一番上へ') +
    b('up', _svg('<path d="M12 7l7 9H5z" fill="currentColor"/>'), '1画面分上へ') +
    b('down', _svg('<path d="M12 17l7-9H5z" fill="currentColor"/>'), '1画面分下へ') +
    b('bottom', _svg('<path d="M6 20h12"/><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/>'), '一番下へ（続きを全部表示）');
  document.body.appendChild(el);
  el.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-scroll]');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-scroll'), page = Math.max(200, window.innerHeight - 220);
    if (act === 'top') window.scrollTo({ top: 0, behavior: window.scrollY > window.innerHeight * 3 ? 'auto' : 'smooth' });   // 遠いときはすぐ（なめらかだと長くかかる）
    else if (act === 'up') window.scrollBy({ top: -page, behavior: 'smooth' });
    else if (act === 'down') window.scrollBy({ top: page, behavior: 'smooth' });
    else albumScrollToBottom();
  });
  albScroll.el = el;
  return el;
}
function _albScrollActive() {
  return currentPage === 'albums' && !albView.openKey && !!document.querySelector('#alb-body .album-main-grid') && !document.body.classList.contains('np-open') && !document.body.classList.contains('abe-open');
}
function _albAllShown() { return !document.getElementById('alb-more'); }
// ボタンを出す・押せるかを合わせる
function albScrollUpdate() {
  var el = _albScrollEnsure();
  var se = document.documentElement, max = se.scrollHeight - window.innerHeight;
  var on = _albScrollActive() && (max > 40 || !_albAllShown());
  el.hidden = !on;
  if (!on) return;
  var y = window.scrollY, atTop = y <= 2, atBottom = y >= max - 2;
  el.querySelector('[data-scroll="top"]').disabled = atTop;
  el.querySelector('[data-scroll="up"]').disabled = atTop;
  el.querySelector('[data-scroll="down"]').disabled = atBottom && _albAllShown();
  el.querySelector('[data-scroll="bottom"]').disabled = (atBottom && _albAllShown()) || albScroll.busy;
}
function _albScrollSoon() { if (!albScroll.raf) albScroll.raf = requestAnimationFrame(function () { albScroll.raf = 0; albScrollUpdate(); }); }

// 一番下へ：続きを最後まで出してから（200枚ずつ、1回ごとに画面を描かせる）
async function albumScrollToBottom() {
  if (albScroll.busy) return;
  albScroll.busy = true;
  var btn = _albScrollEnsure().querySelector('[data-scroll="bottom"]');
  btn.classList.add('is-loading'); btn.disabled = true;
  try {
    for (var i = 0; i < 100 && document.getElementById('alb-more') && _albScrollActive(); i++) {
      albLoadMore();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); });
    }
    if (_albScrollActive()) window.scrollTo(0, document.documentElement.scrollHeight);
  } finally {
    albScroll.busy = false;
    btn.classList.remove('is-loading');
    albScrollUpdate();
  }
}

window.addEventListener('scroll', _albScrollSoon, { passive: true });
window.addEventListener('resize', _albScrollSoon);
// album の一覧を描いたあと・画面を移ったあとに合わせる（関数を包む）
(function () {
  ['renderAlbumsPage', 'showPage', 'openNowPlaying', 'openAlbumBulkEdit'].forEach(function (n) {
    var f = window[n];
    if (typeof f !== 'function') return;
    window[n] = function () { var r = f.apply(this, arguments); _albScrollSoon(); return r; };
  });
  document.addEventListener('click', function () { setTimeout(_albScrollSoon, 50); }, true);   // 閉じる操作など（再生画面・一括編集）のあと
  window.addEventListener('popstate', function () { setTimeout(_albScrollSoon, 50); });
})();

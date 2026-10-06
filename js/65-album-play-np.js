/* =========================================================
   65-album-play-np.js ― スマホ版：album の画面で再生したら再生画面を開く・「再生中ボタン」（スマホ版 v8.7.5）
   ・album の画面（アルバム一覧・アルバムの曲一覧）では再生バーを出さない（60-album-bar.js）ので、
     そこで再生を始めたときは、再生と同時に再生画面（フルスクリーン。37-now-playing.js）を開く。閉じると元の画面に戻り、再生は続く
     対象：カードの再生ボタン（一時停止中の続きの再生も）・アルバムの見出しの「アルバムを再生」「シャッフル」・曲の行の ▷ と行のタップ・
           長押しのメニューの「再生」「シャッフル再生」（どれも playAlbum を通るので、playAlbum を包む）
   ・「再生中ボタン」（#alb-np-fab）：album の画面で曲が選ばれているとき、画面の左下（スクロールボタンの反対側）に出す丸いボタン。
     再生中は3本の棒が上下に動く（一時停止中は止まる。動きを減らす設定では動かさない）。押すと再生画面を開く
   ・スマホ幅（760px 以下）だけ。ほかの画面（songs・artist・playlist など）は今までどおり再生バー
   ========================================================= */

function _apnOn() { return window.innerWidth <= 760 && typeof currentPage !== 'undefined' && currentPage === 'albums'; }
function _apnOpen() {
  if (typeof np !== 'undefined' && np.open) return;
  if (typeof openNowPlaying === 'function') openNowPlaying({ playlist: false });
}
// album の画面で再生したら再生画面も開く
(function () {
  var f = window.playAlbum;
  if (typeof f !== 'function') return;
  window.playAlbum = function () {
    var r = f.apply(this, arguments);
    try { if (_apnOn()) _apnOpen(); } catch (e) { console.warn(e); }
    return r;
  };
})();
// カードの再生ボタンで、一時停止中のアルバムの続きを再生したとき（playAlbum を通らない）
(function () {
  var f = window._cardAct;
  if (typeof f !== 'function') return;
  window._cardAct = function (el) {
    var wasPaused = !!(player.audio && player.audio.paused);
    var r = f.apply(this, arguments);
    try {
      if (_apnOn() && el && el.getAttribute('data-card-act') === 'play' && wasPaused && player.audio && !player.audio.paused) _apnOpen();
    } catch (e) { console.warn(e); }
    return r;
  };
})();

/* ---------- 再生中ボタン ---------- */
var apnBound = false;
function renderAlbumNpFab() {
  if (!apnBound && player.audio) { apnBound = true; ['play', 'pause', 'ended', 'emptied'].forEach(function (e) { player.audio.addEventListener(e, renderAlbumNpFab); }); }
  var b = document.getElementById('alb-np-fab');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button'; b.id = 'alb-np-fab'; b.className = 'alb-np-fab'; b.hidden = true;
    b.innerHTML = '<span class="anf-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-8px;right:-8px" onclick="copyUiLabel(\'再生中ボタン\', event)" title="クリックで「再生中ボタン」をコピー">□</span>';
    b.addEventListener('click', function (ev) { if (ev.target.closest('.ui-label-tag')) return; _apnOpen(); });
    document.body.appendChild(b);
  }
  var show = _apnOn() && !!player.currentPath && !(typeof np !== 'undefined' && np.open);
  b.hidden = !show;
  document.body.classList.toggle('alb-fab-on', show);   // 下の余白をボタンの分だけ広げる（最後のカード・曲がボタンに隠れないように）
  if (!show) return;
  var playing = !!(player.audio && !player.audio.paused);
  var t = library.byPath[player.currentPath];
  var title = t ? t.title : '';
  b.classList.toggle('is-playing', playing);
  var lbl = (playing ? '再生中' : '一時停止中') + (title ? '：' + title : '') + '（押すと再生画面）';
  b.title = lbl; b.setAttribute('aria-label', lbl);
}
['showPage', 'renderAlbumsPage', 'updatePlayerUi', 'openNowPlaying', '_npHide'].forEach(function (name) {
  var f = window[name];
  if (typeof f !== 'function') return;
  window[name] = function () {
    var r = f.apply(this, arguments);
    try { renderAlbumNpFab(); } catch (e) { console.warn(e); }
    return r;
  };
});
window.addEventListener('resize', renderAlbumNpFab);

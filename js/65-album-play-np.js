/* =========================================================
   65-album-play-np.js ― スマホ版：album の画面で再生したら再生画面を開く・「再生中ボタン」（スマホ版 v8.7.5）
   ・album の画面（アルバム一覧・アルバムの曲一覧）では再生バーを出さない（60-album-bar.js）ので、
     そこで再生を始めたときは、再生と同時に再生画面（フルスクリーン。37-now-playing.js）を開く。閉じると元の画面に戻り、再生は続く
     対象：カードの再生ボタン（一時停止中の続きの再生も）・アルバムの見出しの「アルバムを再生」「シャッフル」・曲の行の ▷ と行のタップ・
           長押しのメニューの「再生」「シャッフル再生」（どれも playAlbum を通るので、playAlbum を包む）
   ・「再生中ボタン」（#alb-np-fab）：album の画面で曲が選ばれているとき、画面の左下（スクロールボタンの反対側）に出す丸いボタン。
     再生中は3本の棒が上下に動く（一時停止中は止まる。動きを減らす設定では動かさない）。押すと再生画面を開く
   ・スマホ幅（760px 以下）だけ。ほかの画面（songs・artist・playlist など）は今までどおり再生バー
   ・スマホ版 v8.9.4：再生バーを全部の画面で出さなくなった（60-album-bar.js）ので、album だけでなく全部の画面で
     ・再生を始めたら再生画面を開く（playAlbum ではなく、もとの playQueue を包む。曲一覧の行・▷、artist の再生、playlist の連続再生・曲、
       new songs・heavy rotation・Seasons Song・upbeat music・重複している曲の再生、シャッフル再生もここを通る）。
       プレイリストからの再生は、playPlaylist が playQueue のあとで再生中のプレイリストを決めるので、少し待ってから開く（プレイリストの play画面になる）
     ・再生中ボタンを出す。再生中ボタンを長押し（0.55秒）すると、歌詞パネルを元の大きさで開く（62-lyrics-mini.js の npOpenLyricsPanel）
   ========================================================= */

function _apnOn() { return isMobileLayout(); }   // スマホ版 v8.10.1：横向きのスマホも（59-mobile.js）   // スマホ版 v8.9.4：全部の画面（v8.7.5〜8.9.3 は album の画面だけ）
function _apnOpen() {
  if (typeof np !== 'undefined' && np.open) return;
  if (typeof openNowPlaying === 'function') openNowPlaying();   // 再生中のプレイリストがあればプレイリストの play画面（37 が決める）
}
// 再生を始めたら再生画面も開く（スマホ版 v8.9.4 から playQueue を包む。v8.7.5〜8.9.3 は album の playAlbum だけ）
(function () {
  var f = window.playQueue;
  if (typeof f !== 'function') return;
  window.playQueue = function () {
    var r = f.apply(this, arguments);
    try { if (_apnOn() && !(typeof np !== 'undefined' && np.open)) setTimeout(function () { if (player.currentPath) _apnOpen(); }, 0); } catch (e) { console.warn(e); }
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
    b.addEventListener('click', function (ev) { if (ev.target.closest('.ui-label-tag')) return; if (b._lp) { b._lp = false; return; } _apnOpen(); });
    // スマホ版 v8.9.4：長押し（0.55秒）で歌詞パネルを元の大きさで開く（再生バーの「歌詞」ボタンの代わり）
    var lpT = 0;
    b.addEventListener('pointerdown', function () { b._lp = false; clearTimeout(lpT); lpT = setTimeout(function () { b._lp = true; if (typeof npOpenLyricsPanel === 'function') npOpenLyricsPanel(); }, 550); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { b.addEventListener(n, function () { clearTimeout(lpT); }); });
    b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
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
  var lbl = (playing ? '再生中' : '一時停止中') + (title ? '：' + title : '') + '（押すと再生画面・長押しで歌詞パネル）';
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

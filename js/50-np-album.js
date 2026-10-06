/* =========================================================
   50-np-album.js ― 再生画面のアルバムの曲リスト（v8.0）
   ・ふつうの再生画面（プレイリストの play画面ではないとき）に、今の曲のアルバムの曲を曲順で並べる（再生画面のアルバムの曲リスト）。
     見た目・行の作りはプレイリストの play画面のキュー（39-playlist-play.js の .plp-q-*）と同じ。今の曲は強調し、見える位置までスクロール
   ・何から再生していても（songs・シャッフルなど）今の曲のアルバムを出す。曲が変わって別のアルバムになったら切り替える
   ・行を押すと、そのアルバムを曲順でその曲から再生する（再生の並びはアルバムの曲順に切り替わる。シャッフルがオンなら今までどおり混ぜる）
   ・上の「曲リスト」ボタンで出す・隠す（ui.npAlbumList。初期は出す）。PC は右、スマホ幅は下
   ========================================================= */

var npal = { key: '', albumByPath: null, rev: -1 };

function npAlbumListOn() { return ui.npAlbumList !== false; }
// 曲のパス → アルバム（曲情報が変わったら作り直す）
function _npalAlbumOf(path) {
  if (!npal.albumByPath || npal.rev !== library.metaRev + ':' + library.tracks.length) {
    var m = new Map();
    buildAlbums().forEach(function (a) { a.tracks.forEach(function (t) { m.set(t.path, a); }); });
    npal.albumByPath = m; npal.rev = library.metaRev + ':' + library.tracks.length;
  }
  return npal.albumByPath.get(path) || null;
}
function _npalEnsure(el) {
  var sec = el.querySelector('#np-album-list');
  if (sec) return sec;
  // 「曲リスト」ボタン（歌詞ボタンの右）
  var lt = el.querySelector('#np-lyr-toggle'), tg = document.createElement('button');
  tg.className = 'np-lyr-toggle np-al-toggle'; tg.id = 'np-al-toggle';
  tg.innerHTML = ICONS.album + '曲リスト'; tg.setAttribute('aria-label', '曲リスト');
  lt.insertAdjacentElement('afterend', tg);
  tg.addEventListener('click', function () { ui.npAlbumList = !npAlbumListOn(); saveUi(); npal.key = ''; npAlbumRender(true); });
  sec = document.createElement('section');
  sec.className = 'np-queue np-al-list'; sec.id = 'np-album-list'; sec.setAttribute('aria-label', '再生画面のアルバムの曲リスト');
  el.querySelector('.np-main').appendChild(sec);
  sec.addEventListener('click', function (ev) {
    var row = ev.target.closest('[data-npal-row]'); if (!row) return;
    var a = _npalAlbumOf(player.currentPath); if (!a) return;
    var i = +row.getAttribute('data-npal-row');
    if (a.tracks[i] && a.tracks[i].path === player.currentPath) return;   // 今の曲
    playAlbum(a, i);
  });
  return sec;
}
// 描く（今の曲・アルバムが変わったときだけ作り直す）。scroll：今の曲が見えるようにスクロールする
function npAlbumRender(scroll) {
  var el = document.getElementById('now-playing');
  if (!el || typeof np === 'undefined') return;
  var sec = _npalEnsure(el), tg = document.getElementById('np-al-toggle');
  var on = npAlbumListOn(), a = player.currentPath ? _npalAlbumOf(player.currentPath) : null;
  var show = on && !np.plMode && !!a;
  el.classList.toggle('np-al-mode', show);
  tg.hidden = !!np.plMode || !a;
  tg.classList.toggle('active', on); tg.setAttribute('aria-pressed', String(on));
  tg.title = on ? '今の曲のアルバムの曲リストを隠す' : '今の曲のアルバムの曲リストを出す';
  if (!show) { sec.innerHTML = ''; npal.key = ''; return; }
  var key = a.key + '|' + a.tracks.length + '|' + player.currentPath;
  if (npal.key === key && sec.firstChild) return;
  var albumChanged = !npal.key || npal.key.split('|')[0] !== a.key;
  npal.key = key;
  var h = '<div class="plp-q-head npal-head">' + artThumbHtml(a.cover, 'npal-art') +
      '<span class="npal-head-text"><span class="plp-kicker">album</span><span class="npal-name" title="' + escapeHtml(a.name) + '">' + escapeHtml(a.name) + '</span>' +
      '<span class="plp-q-count">' + escapeHtml(a.artist || '') + (a.artist ? ' ・ ' : '') + a.tracks.length + '曲' + (a.duration ? ' ・ ' + formatTotalDuration(a.duration) : '') + '</span></span>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-4px;right:-4px" onclick="copyUiLabel(\'再生画面のアルバムの曲リスト\', event)" title="クリックで「再生画面のアルバムの曲リスト」をコピー">□</span></div>' +
    '<ol class="plp-q-list">';
  a.tracks.forEach(function (t, i) {
    var cur = t.path === player.currentPath, o = albumTrackOrder(t), no = o.has ? (a.multiDisc ? o.disc + '-' + o.track : o.track) : (i + 1);
    h += '<li class="plp-q-row' + (cur ? ' is-current' : '') + '" data-npal-row="' + i + '" title="' + (cur ? '再生中の曲' : '押すとアルバムの曲順でこの曲から再生') + '">' +
      '<span class="plp-q-no">' + (cur ? ICONS.volume : no) + '</span>' +
      '<span class="plp-q-text"><span class="plp-q-name">' + escapeHtml(t.title) + '</span><span class="plp-q-sub">' + escapeHtml(t.artist || '') + '</span></span>' +
      '<span class="plp-q-dur">' + formatDuration(t.duration) + '</span></li>';
  });
  var list0 = sec.querySelector('.plp-q-list'), keepTop = list0 && !albumChanged ? list0.scrollTop : 0;
  sec.innerHTML = h + '</ol>';
  artObserve(sec);
  var list = sec.querySelector('.plp-q-list'), curEl = sec.querySelector('.plp-q-row.is-current');
  if (list) {
    if (scroll !== false && curEl) list.scrollTop = Math.max(0, curEl.offsetTop - list.offsetTop - list.clientHeight / 3);
    else list.scrollTop = keepTop;
  }
}
// 画面の大きさが変わったら（PC とスマホの並びが変わる）、今の曲が見える位置へ
window.addEventListener('resize', debounce(function () { if (typeof np !== 'undefined' && np.open) { npal.key = ''; npAlbumRender(true); } }, 200));
// 再生画面を描いたあとに合わせる（37-now-playing.js の npRender の最後で plpRender が呼ばれる）
(function () {
  var f = window.plpRender;
  if (typeof f !== 'function') return;
  window.plpRender = function () { var r = f.apply(this, arguments); try { npAlbumRender(); } catch (e) { console.warn(e); } return r; };
})();

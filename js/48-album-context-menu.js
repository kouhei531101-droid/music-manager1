/* =========================================================
   48-album-context-menu.js ― アルバムのジャケットの右クリックメニュー（v7.6）
   ・アルバムのジャケット（album の一覧のカード〔Pin・ソートキーの枠の中も〕・アルバムの見出しの写真・artist の右側のカード・
     new songs のアルバム表示・Western music のカード）の上で右クリック（スマホは長押し）すると、ブラウザのメニューの代わりに
     小さな「アルバムの右クリックメニュー」：プレイリストに追加…／再生／シャッフル再生
   ・「プレイリストに追加…」は v6.8 のチェック式の「プレイリストに追加」ダイアログを、そのアルバムの全曲で開く
   ・閉じる：外側を押す・Esc・スクロール・画面の大きさが変わったとき。画面の端ではみ出ないように位置を直す
   ・長押し：0.55秒、指が 10px 以上動いたら（スクロール）やめる。メニューを出したあとのクリック（カードを開く）は1回だけ無視する
   ========================================================= */

var acm = { el: null, album: null, lpTimer: 0, lpX: 0, lpY: 0, suppressClick: 0, openedAt: 0 };

// 押した所からアルバムを探す（ジャケットの上だけ）
function _acmAlbumAt(target) {
  if (!target || !target.closest) return null;
  if (typeof isPinSortTarget === 'function' && isPinSortTarget(target)) return null;   // Pin の並べ替えモードのカードでは出さない（v8.7.8）
  var art = target.closest('.card-art-wrap, .art-card, .album-head-art');
  if (!art) return null;
  if (art.classList.contains('album-head-art')) return albView.current || null;
  var card = art.closest('.album-card');
  if (!card) return null;
  var g = function (attr) { var v = card.getAttribute(attr); return v === null ? -1 : +v; };
  var i;
  if ((i = g('data-album')) >= 0) return (albView.list || [])[i] || null;
  if ((i = g('data-pin-album')) >= 0) return (albView.pinned || [])[i] || null;
  if ((i = g('data-artist-album')) >= 0) return artistView.current && artistView.current.albums ? artistView.current.albums[i] || null : null;
  if ((i = g('data-ns-album')) >= 0) return (newSongsView.albums || [])[i] || null;
  if ((i = g('data-wes-album')) >= 0) return (westernView.list || [])[i] || null;
  return null;
}

function closeAlbumContextMenu() {
  if (!acm.el) return;
  acm.el.remove(); acm.el = null; acm.album = null;
}
function openAlbumContextMenu(a, x, y) {
  closeAlbumContextMenu();
  if (!a || !a.tracks || !a.tracks.length) return;
  var el = document.createElement('div');
  el.className = 'acm';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'アルバム「' + a.name + '」のメニュー');
  var item = function (act, icon, label) { return '<button type="button" class="acm-item" role="menuitem" data-acm="' + act + '">' + icon + '<span>' + label + '</span></button>'; };
  el.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;right:-6px" onclick="copyUiLabel(\'アルバムの右クリックメニュー\', event)" title="クリックで「アルバムの右クリックメニュー」をコピー">□</span>' +
    '<div class="acm-head" title="' + escapeHtml(a.name) + '">' + escapeHtml(a.name) + '<span class="acm-sub">' + a.tracks.length + '曲</span></div>' +
    item('add', ICONS.plus, 'プレイリストに追加…') + item('play', ICONS.play, '再生') + item('shuffle', ICONS.shuffle, 'シャッフル再生');
  document.body.appendChild(el);
  acm.el = el; acm.album = a; acm.openedAt = Date.now();
  // 画面の端ではみ出ないように
  var r = el.getBoundingClientRect(), m = 6;
  var left = Math.min(x, window.innerWidth - r.width - m), top = Math.min(y, window.innerHeight - r.height - m);
  el.style.left = Math.max(m, left) + 'px'; el.style.top = Math.max(m, top) + 'px';
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acm]'); if (!b) return;
    var act = b.getAttribute('data-acm'), al = acm.album;
    closeAlbumContextMenu();
    if (!al) return;
    var paths = al.tracks.map(function (t) { return t.path; });
    if (act === 'add') openAddToPlaylistDialog(paths, null, 'アルバム「' + al.name + '」の全曲');
    else if (act === 'play') playAlbum(al, 0);
    else if (act === 'shuffle') shufflePlay(function () { playAlbum(al, 0); });
  });
  var first = el.querySelector('.acm-item'); if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
}

// 右クリック（スマホのブラウザが長押しで出す contextmenu も、ここで受ける）
document.addEventListener('contextmenu', function (ev) {
  var a = _acmAlbumAt(ev.target);
  if (!a) return;
  ev.preventDefault();
  if (acm.el && Date.now() - acm.openedAt < 800) return;   // 長押しで出したばかり
  openAlbumContextMenu(a, ev.clientX, ev.clientY);
  if (ev.pointerType === 'touch' || (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents)) acm.suppressClick = Date.now();
});
// 長押し（タッチ）
document.addEventListener('pointerdown', function (ev) {
  if (acm.el && !acm.el.contains(ev.target)) closeAlbumContextMenu();   // 外側を押したら閉じる
  if (ev.pointerType !== 'touch') return;
  var a = _acmAlbumAt(ev.target);
  if (!a) return;
  acm.lpX = ev.clientX; acm.lpY = ev.clientY;
  clearTimeout(acm.lpTimer);
  acm.lpTimer = setTimeout(function () { acm.lpTimer = 0; openAlbumContextMenu(a, acm.lpX, acm.lpY); acm.suppressClick = Date.now(); }, 550);
}, true);
document.addEventListener('pointermove', function (ev) {
  if (acm.lpTimer && (Math.abs(ev.clientX - acm.lpX) > 10 || Math.abs(ev.clientY - acm.lpY) > 10)) { clearTimeout(acm.lpTimer); acm.lpTimer = 0; }
}, true);
['pointerup', 'pointercancel'].forEach(function (n) { document.addEventListener(n, function () { if (acm.lpTimer) { clearTimeout(acm.lpTimer); acm.lpTimer = 0; } }, true); });
// 長押しでメニューを出したあとの「クリック」（カードを開く）は無視する
document.addEventListener('click', function (ev) {
  if (acm.suppressClick && Date.now() - acm.suppressClick < 900 && !(acm.el && acm.el.contains(ev.target))) { ev.preventDefault(); ev.stopPropagation(); acm.suppressClick = 0; }
}, true);
document.addEventListener('keydown', function (ev) {
  if (!acm.el) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeAlbumContextMenu(); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    var items = Array.prototype.slice.call(acm.el.querySelectorAll('.acm-item')), i = items.indexOf(document.activeElement);
    i = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i].focus(); ev.preventDefault();
  }
}, true);
window.addEventListener('scroll', function () { if (acm.el) closeAlbumContextMenu(); }, true);
window.addEventListener('resize', closeAlbumContextMenu);

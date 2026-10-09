/* =========================================================
   64-card-menu.js ― スマホ版：カードのタグ・非表示ボタンを、長押しのメニューとアルバムの見出しへ（スマホ版 v8.7.4）
   ・アルバムカードのジャケットの上の「ソートキー・タグボタン」（左下）と「カードの非表示ボタン」（右上）は出さない（style.css）。
     カードの Pin ボタン・Pin の目印・カードの再生ボタンはそのまま
   ・代わりに
     ① アルバムの右クリックメニュー（長押しのメニュー。48-album-context-menu.js）に「ソートキー・タグを編集」と
        「このアルバムを非表示」（非表示のアルバムなら「非表示を解除」）を足す（再生・シャッフル再生・プレイリストに追加… の下）
     ② アルバムの見出しのジャケット写真の右下（YouTube検索ボタンの左）に「見出しのタグボタン」を足す
        （見出しの写真の非表示ボタン〔右上〕は前からある。タグが付いていれば見出しの曲数の行にタグのバッジ・ソートキーも前から出る）
   ・押したときの働きは今までと同じ関数（openSortKeyPopup・hideAlbum・unhideAlbumFromUi）
   ========================================================= */

// ① 長押しのメニューに足す
(function () {
  var f = window.openAlbumContextMenu;
  if (typeof f !== 'function') return;
  window.openAlbumContextMenu = function (a, x, y) {
    var r = f.apply(this, arguments);
    var el = acm.el;
    if (!el || !a) return r;
    var hidden = typeof isAlbumHidden === 'function' && isAlbumHidden(a.key);
    var sep = document.createElement('div');
    sep.className = 'acm-sep';
    el.appendChild(sep);
    var mk = function (act, icon, label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'acm-item'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-acm-x', act);
      b.innerHTML = icon + '<span>' + label + '</span>';
      el.appendChild(b);
    };
    mk('tag', ICONS.tag, 'ソートキー・タグを編集');
    mk(hidden ? 'unhide' : 'hide', hidden ? ICONS.eye : ICONS.eyeOff, hidden ? '非表示を解除' : 'このアルバムを非表示');
    // 足した分で画面からはみ出ないように位置を直す
    var rr = el.getBoundingClientRect(), m = 6;
    if (rr.bottom > window.innerHeight - m) el.style.top = Math.max(m, window.innerHeight - rr.height - m) + 'px';
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acm-x]'); if (!b) return;
      var act = b.getAttribute('data-acm-x'), al = acm.album;
      closeAlbumContextMenu();
      if (al) cardMenuAct(act, al);
    });
    return r;
  };
})();
// タグ・非表示の働き（長押しのメニュー・見出しのタグボタンで共通）
function cardMenuAct(act, a) {
  if (act === 'tag') openSortKeyPopup(a, _cardMenuAnchor(a));
  else if (act === 'hide') hideAlbum(a);
  else if (act === 'unhide') unhideAlbumFromUi(a.key, a.name);
}
// ソートキー・タグの入力を出す目印の要素（カードのジャケット／見出しの写真）
function _cardMenuAnchor(a) {
  if (albView.current && albView.current.key === a.key) { var h = document.querySelector('#page-albums .album-head-art'); if (h) return h; }
  // v8.12.4：Pin のアルバムは Pin の区切りと通常の一覧の2か所にカードがあるので、画面に見えているカードを先に使う
  var cs = Array.prototype.slice.call(document.querySelectorAll('[data-card-key="' + (window.CSS && CSS.escape ? CSS.escape(a.key) : a.key) + '"]'));
  var c = cs.find(function (x) { var r = x.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < window.innerHeight; }) || cs[0];
  var w = c && c.closest('.card-art-wrap');
  return w || c || document.querySelector('#page-albums .page-header') || document.body;
}

// ② アルバムの見出しのタグボタン
function renderHeadTagButton() {
  var a = albView.current;
  var ov = document.querySelector('#page-albums .album-head-art-wrap .album-art-overlay');
  if (!a || !ov || ov.querySelector('.head-art-tag')) return;
  var sk = typeof getAlbumSortKey === 'function' ? getAlbumSortKey(a.key) : '';
  var tg = typeof albumTagOf === 'function' ? albumTagOf(a.key) : null;
  var w = document.createElement('span');
  w.className = 'head-art-tag-wrap';
  var lbl = 'ソートキー・タグ' + (sk ? '：' + sk : '') + '（押すと変更）';
  w.innerHTML = '<button class="art-overlay-btn head-art-tag' + (sk || tg ? ' has-key' : '') + '" title="' + escapeHtml(lbl) + '" aria-label="' + escapeHtml(lbl) + '">' + ICONS.tag + '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;left:-4px" onclick="copyUiLabel(\'見出しのタグボタン\', event)" title="クリックで「見出しのタグボタン」をコピー">□</span>';
  ov.insertBefore(w, ov.firstChild);
  w.querySelector('button').addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (albView.current) openSortKeyPopup(albView.current, ev.currentTarget);
  });
}
(function () {
  var f = window.renderAlbumsPage;
  if (typeof f !== 'function') return;
  window.renderAlbumsPage = function () { var r = f.apply(this, arguments); try { renderHeadTagButton(); } catch (e) { console.warn(e); } return r; };
})();

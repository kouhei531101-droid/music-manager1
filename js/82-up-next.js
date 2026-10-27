/* =========================================================
   82-up-next.js ― スマホ版：「次に再生」「キューの最後に追加」（予約）（スマホ版 v8.16.0）
   ・予約（db.upNext＝[{ path: 曲の相対パス, kind: 'next'|'last' }]。PC版と同じ形）は、今の再生の並び（player.queue）とは別に持ち、曲が終わったとき・「次の曲」のときに、
     予約があれば先頭から1曲ずつ取り出して流す。シャッフル・全曲リピートの影響を受けず、必ず次に流れる。
     予約を全部流し終えたら、元の再生の並びの続き（予約の前に流れていた曲の次）に戻る
   ・流している予約の曲は、そのあいだだけ player.queue の今の曲の次（player.index＋1）に差し込む（再生画面のジャケットの並び・曲数の表示が合うように）。
     その曲から離れたら（次へ・前へ・ほかの曲を押した・新しく再生を始めた）並びから外す。差し込んだ位置は upn.at
   ・「次に再生」：予約の先頭側（前に「次に再生」で入れた曲の後ろ。何曲かのときはその順のまま）。「キューの最後に追加」：予約の最後に足す（PC版と同じ）
   ・何も再生していない（再生バーに曲が無い）ときは、予約せずにその曲（アルバムなら1曲目）から再生する（PC版と同じ）。
     一時停止中は予約に入れるだけ。曲が無い状態で ▶（togglePlay）を押したときは、残っている予約を先に流す
   ・入口：曲の行（songs・new songs・heavy rotation・Seasons Song・upbeat music・アルバムの曲・プレイリストの曲・再生画面の曲リスト）の長押し（PC 幅は右クリック）→「曲のメニュー」、
     アルバムの長押しのメニュー（48-album-context-menu.js）、songs の選択操作バー
   ・予約の一覧：「次に再生（予約）」ダイアログ（並べ替え〔↑↓〕・1曲ずつ外す・「予約をすべてクリア」）。再生画面の左上の「予約の札」（次に再生 N）と曲のメニューから開く
   ・保存：db.upNext（開き直しても残る。バックアップに含む。古いデータ・バックアップに無ければ空）。ファイル整理で場所が変わったら付け替える
   ========================================================= */

// アイコン：次に再生（▶＋線）・キューの最後に追加（線＋＋）
ICONS.playNext = _svg('<polygon points="4 5 11 9.5 4 14 4 5"/><line x1="14" y1="7" x2="21" y2="7"/><line x1="14" y1="12" x2="21" y2="12"/><line x1="4" y1="18" x2="21" y2="18"/>');
ICONS.queueAdd = _svg('<line x1="3" y1="6" x2="16" y2="6"/><line x1="3" y1="12" x2="16" y2="12"/><line x1="3" y1="18" x2="11" y2="18"/><line x1="18" y1="14" x2="18" y2="22"/><line x1="14" y1="18" x2="22" y2="18"/>');

var upn = { at: -1, cur: null };   // at：流している予約の曲を player.queue に差し込んだ位置（無ければ -1）、cur：その曲のパス

function upNextList() {
  if (!Array.isArray(db.upNext)) db.upNext = [];
  return db.upNext;
}
function _upPath(it) { return it && typeof it === 'object' ? it.path : it; }
function _upSave() { saveDB(); upNextRefresh(); }
function _upTitle(path) { var t = library.byPath[path]; return t ? t.title : stripExt(splitPath(path).name); }
function _upPlayingReserved() { return upn.at >= 0 && player.queue[upn.at] === upn.cur && player.index === upn.at; }

/* ---------- 予約する ---------- */
// mode：'next'（次に再生）／'last'（キューの最後に追加）。paths は曲の順
function upNextAdd(paths, mode, label) {
  paths = (paths || []).filter(function (p) { return typeof p === 'string' && p; });
  if (!paths.length) return;
  var name = '「' + _upTitle(paths[0]) + '」' + (paths.length > 1 ? '（ほか ' + (paths.length - 1) + ' 曲）' : '');
  if (!player.currentPath) {   // 何も再生していない：予約せずにその曲から再生（PC版と同じ）
    playQueue(paths, 0, label || (paths.length > 1 ? '選んだ曲' : '曲'));
    showToast('再生：' + name);
    return;
  }
  var list = upNextList(), before = list.slice();
  var items = paths.map(function (p) { return { path: p, kind: mode === 'next' ? 'next' : 'last' }; });
  if (mode === 'next') {
    var at = 0;
    while (at < list.length && list[at].kind === 'next') at++;   // 前に「次に再生」で入れた曲の後ろ
    Array.prototype.splice.apply(list, [at, 0].concat(items));
  } else Array.prototype.push.apply(list, items);
  _upSave();
  showToast((mode === 'next' ? '次に再生：' : 'キューの最後に追加：') + name, false,
    { label: '元に戻す', fn: function () { db.upNext = before; _upSave(); showToast('予約を元に戻しました'); } });
}
// 予約の先頭を今すぐ流す（無ければ false）
function upNextPlayFirst() {
  var list = upNextList();
  if (!list.length) return false;
  var path = _upPath(list.shift());
  _upSave();
  if (_upPlayingReserved()) {          // 予約の曲の続き：同じ場所を入れ替える
    player.queue[upn.at] = path;
  } else {
    var at = Math.max(0, player.index + 1);
    player.queue.splice(at, 0, path);
    upn.at = at;
    if (!player.label) player.label = '次に再生';
  }
  upn.cur = path;
  _upOrigPlayAt(upn.at);
  return true;
}
// 流している予約の曲を並びから外す（離れるとき）。外したら true
function _upDetach() {
  if (upn.at < 0) return false;
  var at = upn.at;
  upn.at = -1;
  if (player.queue[at] !== upn.cur) { upn.cur = null; return false; }
  player.queue.splice(at, 1);
  if (player.index >= at) player.index--;
  upn.cur = null;
  return true;
}

/* ---------- 並べ替え・外す・クリア ---------- */
function upNextMove(i, d) {
  var list = upNextList(), j = i + d;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
  var x = list[i]; list[i] = list[j]; list[j] = x;
  _upSave();
}
function upNextRemove(i) {
  var list = upNextList();
  if (i < 0 || i >= list.length) return;
  var p = list.splice(i, 1)[0], before = list.slice(); before.splice(i, 0, p);
  _upSave();
  showToast('予約から外しました：「' + _upTitle(_upPath(p)) + '」', false, { label: '元に戻す', fn: function () { db.upNext = before; _upSave(); } });
}
async function upNextClear() {
  var list = upNextList();
  if (!list.length) return;
  var ok = await showConfirm({ title: '予約をすべてクリア', message: '「次に再生（予約）」の ' + list.length + ' 曲をすべて外します（曲ファイル・プレイリストはそのままです）。', okText: 'すべてクリア', danger: true });
  if (!ok) { openUpNextDialog(); return; }
  var before = list.slice();
  db.upNext = [];
  _upSave();
  showToast('予約をすべてクリアしました', false, { label: '元に戻す', fn: function () { db.upNext = before; _upSave(); } });
}

/* ---------- 「次に再生（予約）」ダイアログ ---------- */
function _upDialogBody() {
  var list = upNextList();
  var h = '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'次に再生（予約）\', event)" title="クリックで「次に再生（予約）」をコピー">□</span>';
  if (_upPlayingReserved()) h += '<p class="upn-now">いま流している予約の曲：<strong>' + escapeHtml(_upTitle(upn.cur)) + '</strong></p>';
  if (!list.length) return h + '<p class="upn-empty">予約はありません。曲やアルバムを長押しして「次に再生」「キューの最後に追加」を選ぶと、ここにたまります。</p>';
  h += '<p class="upn-hint">上から順に、今の曲の次に流れます（シャッフル中でもこの順）。流し終えたら元の再生の並びの続きに戻ります。</p><ol class="upn-list">';
  list.forEach(function (it, i) {
    var p = _upPath(it), t = library.byPath[p];
    h += '<li class="upn-row' + (t ? '' : ' missing') + '"><span class="upn-no">' + (i + 1) + '</span>' +
      '<span class="upn-text"><span class="upn-title">' + escapeHtml(_upTitle(p)) + '</span><span class="upn-sub">' + escapeHtml(t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '見つからない曲（とばします）') + '</span></span>' +
      '<button type="button" class="btn-icon" data-upn="up" data-i="' + i + '" title="上へ" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>' + ICONS.up + '</button>' +
      '<button type="button" class="btn-icon" data-upn="down" data-i="' + i + '" title="下へ" aria-label="下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>' + ICONS.down + '</button>' +
      '<button type="button" class="btn-icon btn-icon-danger" data-upn="remove" data-i="' + i + '" title="予約から外す" aria-label="予約から外す">' + ICONS.x + '</button></li>';
  });
  return h + '</ol>';
}
function openUpNextDialog() {
  var n = upNextList().length;
  openDialog({
    title: '次に再生（予約）' + (n ? '　' + n + '曲' : ''),
    size: 'small',
    body: '<div id="upn-dlg">' + _upDialogBody() + '</div>',
    buttons: (n ? [{ label: '予約をすべてクリア', value: 'clear', cls: 'btn-cancel upn-clear-btn' }] : []).concat([{ label: '閉じる', value: 'ok', cls: 'btn-save', isDefault: true }]),
    onOpen: function (body) {
      var box = body.querySelector('#upn-dlg');
      box.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-upn]'); if (!b || b.disabled) return;
        var act = b.getAttribute('data-upn'), i = +b.getAttribute('data-i');
        if (act === 'up') upNextMove(i, -1); else if (act === 'down') upNextMove(i, 1); else if (act === 'remove') upNextRemove(i);
        var nb = box.querySelector('[data-upn="' + act + '"][data-i="' + (act === 'up' ? i - 1 : act === 'down' ? i + 1 : Math.min(i, upNextList().length - 1)) + '"]');
        if (nb && !nb.disabled) { try { nb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
      });
    }
  }).then(function (v) { if (v === 'clear') upNextClear(); });
}
// 予約が変わったら：開いているダイアログ・再生画面の札を合わせる
function upNextRefresh() {
  var box = document.getElementById('upn-dlg');
  if (box && box.isConnected) {
    box.innerHTML = _upDialogBody();
    var n = upNextList().length, ttl = document.getElementById('dialog-title');
    if (ttl) ttl.textContent = '次に再生（予約）' + (n ? '　' + n + '曲' : '');
    var cb = document.querySelector('#dialog-footer .upn-clear-btn'); if (cb) cb.hidden = !n;
  }
  _upChip();
}

/* ---------- 再生画面の「予約の札」 ---------- */
function _upChip() {
  var host = document.getElementById('now-playing');
  if (!host) return;
  var el = document.getElementById('np-upnext-chip');
  var n = upNextList().length;
  if (!n) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'np-upnext-chip';
    el.className = 'np-upnext-chip';
    el.addEventListener('click', function () { openUpNextDialog(); });
    host.appendChild(el);
  }
  el.hidden = false;
  el.innerHTML = ICONS.playNext + '<span>次に再生 ' + n + '</span>';
  el.title = '次に再生（予約）：' + n + '曲（押すと一覧・並べ替え）';
  el.setAttribute('aria-label', el.title);
}

/* ---------- 曲のメニュー（曲の行の長押し・右クリック） ---------- */
var upm = { el: null, paths: null, lpTimer: 0, lpX: 0, lpY: 0, suppressClick: 0, openedAt: 0, row: null };
var UPM_ROW_SEL = '.lib-row[data-path], .pl-track[data-path], .plp-q-row[data-path]';
function _upmRowAt(target) {
  if (!target || !target.closest) return null;
  if (target.closest('input, textarea, select, .acm, .upm')) return null;
  return target.closest(UPM_ROW_SEL);
}
function closeSongMenu() { if (upm.el) { upm.el.remove(); upm.el = null; upm.paths = null; } }
function openSongMenu(paths, x, y, title) {
  closeSongMenu();
  if (typeof closeAlbumContextMenu === 'function') closeAlbumContextMenu();
  paths = (paths || []).filter(Boolean);
  if (!paths.length) return;
  var el = document.createElement('div');
  el.className = 'acm upm';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', '曲のメニュー');
  var item = function (act, icon, label) { return '<button type="button" class="acm-item" role="menuitem" data-upm="' + act + '">' + icon + '<span>' + label + '</span></button>'; };
  var n = upNextList().length;
  el.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;right:-6px" onclick="copyUiLabel(\'曲のメニュー\', event)" title="クリックで「曲のメニュー」をコピー">□</span>' +
    '<div class="acm-head" title="' + escapeHtml(title) + '">' + escapeHtml(title) + (paths.length > 1 ? '<span class="acm-sub">' + paths.length + '曲</span>' : '') + '</div>' +
    item('next', ICONS.playNext, '次に再生') + item('last', ICONS.queueAdd, 'キューの最後に追加') + item('add', ICONS.plus, 'プレイリストに追加…') +
    (paths.length === 1 && typeof isSongPinned === 'function' ? item('pin', ICONS.pin, isSongPinned(paths[0]) ? 'Pin を外す' : 'この曲を Pin 止め') : '') +   // スマホ版 v8.18.0（84-pinned-songs.js）。v8.25.4 から「この曲を Pin 止め」（album の Pin の区切りに Pin の曲のカードで出る）
    (typeof openFileWriteDialog === 'function' ? item('write', ICONS.download, 'ファイルに書き込む…') : '') +   // スマホ版 v8.17.0（83-tag-file-write.js）
    (n ? '<div class="acm-sep"></div>' + item('view', ICONS.playlist, '次に再生（予約）を見る（' + n + '曲）') : '');
  document.body.appendChild(el);
  upm.el = el; upm.paths = paths; upm.openedAt = Date.now();
  var r = el.getBoundingClientRect(), m = 6;
  el.style.left = Math.max(m, Math.min(x, window.innerWidth - r.width - m)) + 'px';
  el.style.top = Math.max(m, Math.min(y, window.innerHeight - r.height - m)) + 'px';
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-upm]'); if (!b) return;
    var act = b.getAttribute('data-upm'), ps = upm.paths;
    closeSongMenu();
    if (act === 'next') upNextAdd(ps, 'next', title);
    else if (act === 'last') upNextAdd(ps, 'last', title);
    else if (act === 'add') openAddToPlaylistDialog(ps, null, ps.length > 1 ? ps.length + '曲' : '「' + _upTitle(ps[0]) + '」');
    else if (act === 'view') openUpNextDialog();
    else if (act === 'pin') togglePinSong(ps[0]);
    else if (act === 'write') openFileWriteDialog(ps, ps.length > 1 ? title : '「' + _upTitle(ps[0]) + '」');
  });
  var first = el.querySelector('.acm-item'); if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
function _upmOpenForRow(row, x, y) {
  var p = row.getAttribute('data-path');
  if (!p) return;
  // songs の選択中の行なら、選んだ曲をまとめて
  if (row.classList.contains('is-selected') && typeof libView !== 'undefined' && libView.selected && libView.selected.has(p) && libView.selected.size > 1 && typeof selectedPathsInViewOrder === 'function') {
    openSongMenu(selectedPathsInViewOrder(), x, y, '選んだ曲');
    return;
  }
  openSongMenu([p], x, y, _upTitle(p));
}
document.addEventListener('contextmenu', function (ev) {
  var row = _upmRowAt(ev.target);
  if (!row) return;
  ev.preventDefault();
  if (upm.el && Date.now() - upm.openedAt < 800) return;   // 長押しで出したばかり
  _upmOpenForRow(row, ev.clientX, ev.clientY);
  if (ev.pointerType === 'touch' || (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents)) upm.suppressClick = Date.now();
});
document.addEventListener('pointerdown', function (ev) {
  if (upm.el && !upm.el.contains(ev.target)) closeSongMenu();
  if (ev.pointerType !== 'touch') return;
  var row = _upmRowAt(ev.target);
  if (!row) return;
  upm.lpX = ev.clientX; upm.lpY = ev.clientY; upm.row = row;
  clearTimeout(upm.lpTimer);
  upm.lpTimer = setTimeout(function () {
    upm.lpTimer = 0;
    if (!upm.row || !upm.row.isConnected) return;
    _upmOpenForRow(upm.row, upm.lpX, upm.lpY);
    upm.suppressClick = Date.now();
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* 無視 */ } }
  }, 550);
}, true);
document.addEventListener('pointermove', function (ev) {
  if (upm.lpTimer && (Math.abs(ev.clientX - upm.lpX) > 10 || Math.abs(ev.clientY - upm.lpY) > 10)) { clearTimeout(upm.lpTimer); upm.lpTimer = 0; }
}, true);
['pointerup', 'pointercancel'].forEach(function (n) { document.addEventListener(n, function () { if (upm.lpTimer) { clearTimeout(upm.lpTimer); upm.lpTimer = 0; } }, true); });
// 長押しでメニューを出したあとの「クリック」（行を押した扱い＝再生など）は1回だけ無視する
document.addEventListener('click', function (ev) {
  if (upm.suppressClick && Date.now() - upm.suppressClick < 900 && !(upm.el && upm.el.contains(ev.target))) { ev.preventDefault(); ev.stopPropagation(); upm.suppressClick = 0; }
}, true);
document.addEventListener('keydown', function (ev) {
  if (!upm.el) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSongMenu(); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    var items = Array.prototype.slice.call(upm.el.querySelectorAll('.acm-item')), i = items.indexOf(document.activeElement);
    i = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i].focus(); ev.preventDefault();
  }
}, true);
window.addEventListener('scroll', function () { if (upm.el) closeSongMenu(); }, true);
window.addEventListener('resize', closeSongMenu);

/* ---------- 今までの処理につなぐ ---------- */
var _upOrigPlayAt = window.playAt;
(function () {
  // playAt：流している予約の曲から離れるときは並びから外す（番号のずれも直す）
  window.playAt = function (i, skips) {
    if (upn.at >= 0 && i !== upn.at) {
      var at = upn.at;
      if (_upDetach() && i > at) i--;
    }
    return _upOrigPlayAt.call(this, i, skips);
  };
  // 新しく再生を始めたとき（曲・アルバム・プレイリストを押した）：差し込みは捨てる（予約は残す）
  var pq = window.playQueue;
  window.playQueue = function () { upn.at = -1; upn.cur = null; return pq.apply(this, arguments); };
  // 次の曲：予約があれば先に流す
  var pn = window.playNext;
  window.playNext = function (byUser) {
    if (upNextList().length) { upNextPlayFirst(); return; }
    if (_upPlayingReserved()) { _upDetach(); }
    return pn.apply(this, arguments);
  };
  // 曲が終わったとき（1曲リピートはそのまま）
  var te = window.onTrackEnded;
  window.onTrackEnded = function () {
    if (db.settings.repeat !== 'one') {
      if (upNextList().length) { upNextPlayFirst(); return; }
      if (_upPlayingReserved()) _upDetach();
    }
    return te.apply(this, arguments);
  };
  // 曲が無い状態で ▶：予約を先に
  var tp = window.togglePlay;
  window.togglePlay = function () {
    if (player.audio && !player.audio.getAttribute('src') && !player.currentPath && upNextList().length) { upNextPlayFirst(); return; }
    return tp.apply(this, arguments);
  };
  // シャッフルの切り替え・プレイリストの並びの反映は並びを作り直すので、予約の曲をいったん外して、あとで今の曲の次に戻す
  var wrapRebuild = function (fn) {
    return function () {
      if (!_upPlayingReserved()) { upn.at = -1; return fn.apply(this, arguments); }
      var cur = upn.cur, savedPath = player.currentPath;
      _upDetach();
      player.currentPath = player.queue[player.index] || null;
      var r = fn.apply(this, arguments);
      player.currentPath = savedPath;
      var at = Math.max(0, player.index + 1);
      player.queue.splice(at, 0, cur);
      upn.at = at; upn.cur = cur; player.index = at;
      if (typeof updatePlayerUi === 'function') updatePlayerUi();
      return r;
    };
  };
  if (typeof window.toggleShuffle === 'function') window.toggleShuffle = wrapRebuild(window.toggleShuffle);
  if (typeof window.plpSyncQueue === 'function') window.plpSyncQueue = wrapRebuild(window.plpSyncQueue);
  // ファイル整理で場所が変わったとき：予約も付け替える
  var am = window.applyPathMapping;
  if (typeof am === 'function') {
    window.applyPathMapping = function (map) {
      var r = am.apply(this, arguments);
      try {
        var list = upNextList(), ch = false;
        for (var i = 0; i < list.length; i++) { var q = _upPath(list[i]); if (map[q]) { list[i] = { path: map[q], kind: list[i].kind || 'last' }; ch = true; } }
        if (upn.cur && map[upn.cur]) upn.cur = map[upn.cur];
        if (ch) saveDB();
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生画面：予約の札、ラベル
  var ed = window._npEnsureDom;
  if (typeof ed === 'function') window._npEnsureDom = function () { var r = ed.apply(this, arguments); try { _upChip(); } catch (e) { console.warn(e); } return r; };
  var nr = window.npRender;
  if (typeof nr === 'function') {
    window.npRender = function () {
      var r = nr.apply(this, arguments);
      try {
        _upChip();
        if (_upPlayingReserved()) { var l = document.getElementById('np-label'); if (l) l.textContent = '次に再生（予約）' + (upNextList().length ? '　あと ' + upNextList().length + '曲' : ''); }
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  // アルバムの長押しのメニュー：「次に再生」「キューの最後に追加」（再生・シャッフル再生の下）
  var ac = window.openAlbumContextMenu;
  if (typeof ac === 'function') {
    window.openAlbumContextMenu = function (a, x, y) {
      var r = ac.apply(this, arguments);
      var el = typeof acm !== 'undefined' ? acm.el : null;
      if (!el || !a) return r;
      var after = el.querySelector('[data-acm="shuffle"]');
      var mk = function (act, icon, label) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'acm-item'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-acm-upn', act);
        b.innerHTML = icon + '<span>' + label + '</span>';
        return b;
      };
      var b1 = mk('next', ICONS.playNext, '次に再生'), b2 = mk('last', ICONS.queueAdd, 'キューの最後に追加');
      if (after) { after.insertAdjacentElement('afterend', b2); after.insertAdjacentElement('afterend', b1); } else { el.appendChild(b1); el.appendChild(b2); }
      var rr = el.getBoundingClientRect(), m = 6;
      if (rr.bottom > window.innerHeight - m) el.style.top = Math.max(m, window.innerHeight - rr.height - m) + 'px';
      el.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-acm-upn]'); if (!b) return;
        var al = acm.album;
        closeAlbumContextMenu();
        if (!al) return;
        // アルバムの曲順で全部
        upNextAdd(al.tracks.map(function (t) { return t.path; }), b.getAttribute('data-acm-upn'), 'アルバム：' + al.name);   // al.tracks はアルバムの曲順（playAlbum と同じ）
      });
      return r;
    };
  }
  // songs の選択操作バー：「次に再生」「キューの最後に追加」
  var sb = window.updateLibSelectBar;
  if (typeof sb === 'function') {
    window.updateLibSelectBar = function () {
      var r = sb.apply(this, arguments);
      var bar = document.getElementById('lib-select-bar');
      if (bar && !bar.hidden && !bar.querySelector('[data-upn-sel]')) {
        var clr = bar.querySelector('button[onclick^="clearLibSelection"]');
        ['next', 'last'].forEach(function (m) {
          var b = document.createElement('button');
          b.className = 'btn-inline-small'; b.setAttribute('data-upn-sel', m);
          b.innerHTML = (m === 'next' ? ICONS.playNext + '次に再生' : ICONS.queueAdd + 'キューの最後に追加');
          b.addEventListener('click', function () { upNextAdd(selectedPathsInViewOrder(), m, '曲一覧（選んだ曲）'); });
          if (clr) bar.insertBefore(b, clr); else bar.appendChild(b);
        });
      }
      return r;
    };
  }
})();

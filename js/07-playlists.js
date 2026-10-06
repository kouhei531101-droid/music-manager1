/* =========================================================
   07-playlists.js ― 「プレイリスト」画面
   ・プレイリスト一覧（左）：作成・選択
   ・プレイリストの曲（右）：連続再生・名前を変更・削除、曲の並べ替え（↑↓・ドラッグ）・外す
   ・プレイリストに追加ダイアログ（曲一覧の「＋」・選択操作バーから使う）
   プレイリストは db.playlists に保存。曲は音楽フォルダからの相対パスで持つ
   ========================================================= */

var plView = { dragFrom: -1 };

PAGE_RENDERERS.playlists = renderPlaylistsPage;

/* ---------- データの操作（どれも操作のたびにすぐ保存する） ---------- */
function getPlaylist(id) {
  for (var i = 0; i < db.playlists.length; i++) if (db.playlists[i].id === id) return db.playlists[i];
  return null;
}
function createPlaylist(name) {
  var p = { id: newId(), name: name, tracks: [], createdAt: nowIso(), updatedAt: nowIso() };
  db.playlists.push(p);
  saveDB();
  renderSidebarCounts();
  return p;
}
function touchPlaylist(p) { p.updatedAt = nowIso(); saveDB(); }

// 曲を追加する。すでに入っている曲は追加しない。{ added, skipped } を返す
function addTracksToPlaylist(id, paths) {
  var p = getPlaylist(id);
  if (!p) return { added: 0, skipped: 0 };
  var have = new Set(p.tracks), added = 0, skipped = 0;
  paths.forEach(function (path) {
    if (have.has(path)) { skipped++; return; }
    p.tracks.push(path); have.add(path); added++;
  });
  touchPlaylist(p);
  return { added: added, skipped: skipped };
}
function movePlaylistTrack(id, from, to) {
  var p = getPlaylist(id);
  if (!p || from === to || from < 0 || to < 0 || from >= p.tracks.length || to >= p.tracks.length) return;
  var item = p.tracks.splice(from, 1)[0];
  p.tracks.splice(to, 0, item);
  touchPlaylist(p);
  renderPlaylistsPage();
}
function removePlaylistTrack(id, index) {
  var p = getPlaylist(id);
  if (!p || index < 0 || index >= p.tracks.length) return;
  var path = p.tracks[index];
  p.tracks.splice(index, 1);
  touchPlaylist(p);
  renderPlaylistsPage();
  showToast('「' + trackDisplayTitle(path) + '」をプレイリストから外しました（ファイルはそのままです）');
}
// ファイル整理で移動・名前変更したとき、プレイリストの曲の場所を付け替える（map: { 変更前: 変更後 }）
function replacePathsInPlaylists(map) {
  var changed = 0;
  db.playlists.forEach(function (p) {
    var touched = false;
    p.tracks = p.tracks.map(function (t) {
      if (map[t]) { changed++; touched = true; return map[t]; }
      return t;
    });
    if (touched) p.updatedAt = nowIso();
  });
  return changed;
}
function trackDisplayTitle(path) {
  var t = library.byPath[path];
  return t ? t.title : stripExt(splitPath(path).name);
}

/* ---------- ダイアログを使う操作 ---------- */
async function createPlaylistInteractive() {
  var name = await showPrompt({
    title: '新しいプレイリスト',
    label: 'プレイリストの名前',
    value: 'プレイリスト ' + (db.playlists.length + 1),
    okText: '作成',
    validate: function (v) { return v.trim() ? '' : '名前を入力してください。'; }
  });
  if (name == null) return null;
  var p = createPlaylist(name.trim());
  ui.lastPlaylistId = p.id; saveUi();
  if (currentPage === 'playlists') renderPlaylistsPage();
  showToast('プレイリスト「' + p.name + '」を作りました');
  return p;
}
async function renamePlaylistInteractive(id) {
  var p = getPlaylist(id);
  if (!p) return;
  var name = await showPrompt({
    title: 'プレイリストの名前を変更',
    label: '新しい名前',
    value: p.name,
    okText: '変更',
    validate: function (v) { return v.trim() ? '' : '名前を入力してください。'; }
  });
  if (name == null || name.trim() === p.name) return;
  p.name = name.trim();
  touchPlaylist(p);
  renderPlaylistsPage();
}
async function deletePlaylistInteractive(id) {
  var p = getPlaylist(id);
  if (!p) return;
  var ok = await showConfirm({
    title: 'プレイリストを削除',
    message: 'プレイリスト「<strong>' + escapeHtml(p.name) + '</strong>」（' + p.tracks.length + '曲）を削除します。<br>' +
      '曲のファイルは消えません（プレイリストの登録だけがなくなります）。<br>' +
      '<span class="dialog-hint">念のため、先に「設定・バックアップ」でバックアップしておくと元に戻せます。</span>',
    okText: '削除する',
    danger: true
  });
  if (!ok) return;
  db.playlists = db.playlists.filter(function (x) { return x.id !== id; });
  saveDB();
  if (ui.lastPlaylistId === id) { ui.lastPlaylistId = db.playlists.length ? db.playlists[0].id : null; saveUi(); }
  renderSidebarCounts();
  renderPlaylistsPage();
  showToast('プレイリスト「' + p.name + '」を削除しました');
}

// プレイリストに追加ダイアログ
// プレイリストに追加ダイアログ（v6.8 でチェック式に）：プレイリストの一覧にチェックを付けて「追加」。複数のプレイリストにまとめて追加でき、
//   一覧の中で新しいプレイリストも作れる。曲がもう全部入っているプレイリストは「追加済み」（チェック済み・薄く・変えられない）。
//   一部だけ入っているときは「n曲は追加済み」と出し、追加しても同じ曲は重ねない（今までの追加と同じ）。
//   チェックを外してもプレイリストからは外さない（外すのはプレイリストの画面の × で。押し間違いで曲が消えないように）
//   fromId：プレイリストの曲から開いたとき、そのプレイリストに「表示中」の印
async function openAddToPlaylistDialog(paths, fromId, what) {   // what（v7.6）：メッセージに出す名前（例：アルバム「〇〇」の全曲）
  if (!paths || !paths.length) return;
  var uniq = Array.from(new Set(paths));
  var h = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'プレイリストに追加ダイアログ\', event)" title="クリックで「プレイリストに追加ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">' + (what ? escapeHtml(what) + '（' + uniq.length + '曲）を追加するプレイリストにチェックを付けてください（いくつでも）。' : uniq.length === 1
      ? '「' + escapeHtml(trackDisplayTitle(uniq[0])) + '」を追加するプレイリストにチェックを付けてください（いくつでも）。'
      : uniq.length + '曲を追加するプレイリストにチェックを付けてください（いくつでも）。') + '</p>' +
    '<div class="choice-list pl-check-list">';
  db.playlists.forEach(function (p) {
    var has = new Set(p.tracks), n = uniq.filter(function (x) { return has.has(x); }).length, all = n === uniq.length;
    h += '<label class="choice-item' + (all ? ' is-added' : '') + '"><input type="checkbox" name="dlg-pl" value="' + p.id + '"' + (all ? ' checked disabled' : '') + '>' +
      '<span class="choice-name">' + escapeHtml(p.name) + (fromId != null && p.id === fromId ? '<span class="choice-current">表示中</span>' : '') +
        (all ? '<span class="choice-added">追加済み</span>' : n ? '<span class="choice-added">' + n + '曲は追加済み</span>' : '') + '</span>' +
      '<span class="count-badge-sm">' + p.tracks.length + '曲</span></label>';
  });
  h += '<label class="choice-item choice-new"><input type="checkbox" name="dlg-pl-new" value="__new"' + (db.playlists.length ? '' : ' checked') + '>' +
    '<span class="choice-name">新しいプレイリストを作って追加</span></label>' +
    '<input type="text" class="form-input dialog-enter" id="dlg-new-pl-name" placeholder="新しいプレイリストの名前" value="' + escapeHtml('プレイリスト ' + (db.playlists.length + 1)) + '">' +
    '</div><p class="dialog-hint">「追加済み」は、もう入っているプレイリストです（ここでは外しません。外すときはプレイリストの画面の × で）。</p><div class="dialog-error" id="dlg-pl-error"></div>';
  var ids = [], newName = null;
  var v = await openDialog({
    title: 'プレイリストに追加', body: h, size: 'small',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '追加', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (body) {
      var input = body.querySelector('#dlg-new-pl-name');
      input.addEventListener('input', function () { body.querySelector('input[name="dlg-pl-new"]').checked = !!input.value.trim(); });   // 名前を入れたら「新しいプレイリスト」にチェック
    },
    beforeClose: function (value, body) {
      if (value !== 'ok') return true;
      ids = Array.prototype.map.call(body.querySelectorAll('input[name="dlg-pl"]:checked:not(:disabled)'), function (c) { return +c.value; });
      newName = body.querySelector('input[name="dlg-pl-new"]').checked ? body.querySelector('#dlg-new-pl-name').value.trim() : null;
      if (newName === '') { body.querySelector('#dlg-pl-error').textContent = '新しいプレイリストの名前を入力してください。'; return false; }
      if (!ids.length && newName === null) { body.querySelector('#dlg-pl-error').textContent = '追加するプレイリストにチェックを付けてください。'; return false; }
      return true;
    }
  });
  if (v !== 'ok') return;
  if (newName !== null) { var newP = createPlaylist(newName); if (newP) ids.push(newP.id); }
  var names = [], added = 0, skipped = 0, last = null;
  ids.forEach(function (id) {
    var p = getPlaylist(id); if (!p) return;
    var r = addTracksToPlaylist(p.id, uniq);
    names.push('「' + p.name + '」'); added += r.added; skipped += r.skipped; last = p;
  });
  if (!last) return;
  if (fromId == null) { ui.lastPlaylistId = last.id; saveUi(); }   // プレイリストの画面から追加したときは、見ているプレイリストのまま
  renderSidebarCounts();
  if (currentPage === 'playlists') renderPlaylistsPage();
  if (typeof np !== 'undefined' && np.open && np.plMode && typeof plpRender === 'function') { if (typeof plpSyncQueue === 'function' && player.playlistId && ids.indexOf(player.playlistId) >= 0) plpSyncQueue(player.playlistId); plpRender(false); }   // play画面（v6.8）
  showToast(names.join('・') + 'に 計' + added + '曲追加しました' + (skipped ? '（' + skipped + '曲はすでに入っていたので追加していません）' : ''));
}

/* ---------- 再生 ---------- */
function playPlaylist(id, start) {
  var p = getPlaylist(id);
  if (!p || !p.tracks.length) { showToast('このプレイリストには曲がありません。'); return; }
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください（サイドバーの接続状態）。', true); return; }
  playQueue(p.tracks, start || 0, 'プレイリスト：' + p.name);
  player.playlistId = p.id;   // どのプレイリストから再生しているか（v5.6。プレイリストの play画面）
  if (typeof npOnPlayerUpdate === 'function') npOnPlayerUpdate();
  // プレイリスト再生時に play画面を自動で開く（tools。初期はオフ）
  if (db.settings.plAutoOpen && typeof openNowPlaying === 'function' && !(typeof np !== 'undefined' && np.open)) openNowPlaying({ playlist: true });
}

/* ---------- 描画 ---------- */
// プレイリストの曲の見出しのアイコンだけのボタン（v7.1）
ICONS.screenPlay = _svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8"/><path d="M10.5 8.2v5.6l4.6-2.8z" fill="currentColor"/>');
ICONS.folderCopy = _svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6"/><path d="M9.5 13.5L12 16l2.5-2.5"/>');
function _plIconBtn(act, icon, name, title, disabled, label, danger) {
  return '<span class="plp-open-wrap"><button class="btn-inline-small pl-icon-btn' + (danger ? ' btn-inline-danger' : '') + '" data-act="' + act + '"' + (disabled ? ' disabled' : '') +
    ' title="' + escapeHtml(name + '：' + title) + '" aria-label="' + escapeHtml(name) + '">' + icon + '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'' + label + '\', event)" title="クリックで「' + label + '」をコピー">□</span></span>';
}
function renderPlaylistsPage() {
  var listEl = document.getElementById('pl-list');
  var detailEl = document.getElementById('pl-detail');
  if (!listEl) return;
  document.getElementById('pl-count').textContent = db.playlists.length ? db.playlists.length + '件' : '';
  var sel = getPlaylist(ui.lastPlaylistId);
  if (!sel && db.playlists.length) { sel = db.playlists[0]; ui.lastPlaylistId = sel.id; saveUi(); }

  // プレイリスト一覧
  if (!db.playlists.length) {
    listEl.innerHTML = '<div class="empty-msg small">まだプレイリストがありません。<br>上の「新しいプレイリスト」から作れます。</div>';
  } else {
    listEl.innerHTML = db.playlists.map(function (p) {
      return '<button class="pl-item' + (sel && p.id === sel.id ? ' active' : '') + '" data-pl="' + p.id + '">' +
        '<span class="pl-item-name">' + escapeHtml(p.name) + '</span><span class="count-badge-sm">' + p.tracks.length + '曲</span></button>';
    }).join('');
  }

  // プレイリストの曲
  if (!sel) {
    detailEl.innerHTML = '<div class="empty-msg">左のプレイリスト一覧から選ぶか、新しく作ってください。</div>';
    return;
  }
  var total = 0, missing = 0;
  sel.tracks.forEach(function (path) {
    var t = library.byPath[path];
    if (t) total += t.duration || 0; else missing++;
  });
  var h = '<div class="pl-detail-head">' +
    '<h2 class="pl-detail-name">' + escapeHtml(sel.name) + '</h2>' +
    '<div class="pl-detail-meta">' + sel.tracks.length + '曲' + (total ? ' ・ ' + formatTotalDuration(total) : '') +
      (missing && library.scanned ? ' ・ <span class="text-warn">' + missing + '曲が見つかりません</span>' : '') + '</div>' +
    '<div class="btn-row">' +
      '<button class="btn-save" data-act="play-all"' + (sel.tracks.length ? '' : ' disabled') + '>' + ICONS.play + '連続再生</button>' +
      _plIconBtn('shuffle-play', ICONS.shuffle, 'シャッフル再生', 'このプレイリストをばらばらの順で再生します（シャッフルをオンにします）', !sel.tracks.length, 'シャッフル再生ボタン') +   // v7.5
      // v7.1：連続再生のほかはアイコンだけのボタン（名前は title・aria-label。□ラベルの名前は今までどおり）
      _plIconBtn('add-albums', ICONS.album, 'アルバム追加', 'アルバムを選んで、その曲をこのプレイリストの最後に追加します', false, 'アルバム追加ボタン') +   // v6.9（44-playlist-add-albums.js）
      _plIconBtn('play-screen', ICONS.screenPlay, 'play画面を開く', 'プレイリストの play画面を開く（このプレイリストを再生していなければ、先頭から再生します）', !sel.tracks.length, 'play画面を開くボタン') +   // v5.6
      _plIconBtn('copy-folder', ICONS.folderCopy, 'フォルダにコピー', 'このプレイリストの曲ファイルを、選んだフォルダへコピーします（元のファイルは変わりません）', !sel.tracks.length, 'フォルダにコピーボタン') +   // v6.7
      _plIconBtn('rename', ICONS.edit, '名前を変更', 'プレイリストの名前を変更', false, '名前を変更ボタン') +
      '<span class="pl-head-sep" aria-hidden="true"></span>' +   // 削除は間をあけて赤で
      _plIconBtn('delete', ICONS.trash, 'プレイリストを削除', 'プレイリストを削除（曲ファイルは消えません）', false, 'プレイリストを削除ボタン', true) +
    '</div></div>';
  if (!sel.tracks.length) {
    h += '<div class="empty-msg">まだ曲がありません。「曲一覧」の各曲の「＋」ボタン、または曲にチェックを入れて「プレイリストに追加」で追加できます。</div>';
  } else {
    h += '<ol class="pl-tracks">';
    sel.tracks.forEach(function (path, i) {
      var t = library.byPath[path];
      var isMissing = !t && library.scanned;
      var title = trackDisplayTitle(path);
      var subHtml = t ? artistAlbumLinksHtml(t) : escapeHtml(isInTrash(path) ? '削除フォルダ内にあります' : (library.scanned ? '見つかりません：' + path : ''));   // リンク（v3.1）
      h += '<li class="pl-track' + (isMissing ? ' missing' : '') + (path === player.currentPath ? ' is-playing' : '') + '" draggable="true" data-i="' + i + '">' +
        '<span class="pl-grip" title="ドラッグで並べ替え">' + ICONS.grip + '</span>' +
        '<span class="pl-no">' + (i + 1) + '</span>' +
        '<button class="btn-icon btn-play-row" data-act="play" data-i="' + i + '" title="この曲から再生"' + (isMissing ? ' disabled' : '') + '>' + ICONS.play + '</button>' +
        artThumbHtml(t) +
        '<span class="pl-track-text" title="' + escapeHtml(path) + '"><span class="pl-track-title">' + escapeHtml(title) + '</span>' +
          '<span class="pl-track-sub">' + subHtml + '</span></span>' +
        '<span class="pl-dur">' + (t ? formatDuration(t.duration) : '') + '</span>' +
        '<span class="pl-track-btns">' +
          '<button class="btn-icon" data-act="up" data-i="' + i + '" title="上へ"' + (i === 0 ? ' disabled' : '') + '>' + ICONS.up + '</button>' +
          '<button class="btn-icon" data-act="down" data-i="' + i + '" title="下へ"' + (i === sel.tracks.length - 1 ? ' disabled' : '') + '>' + ICONS.down + '</button>' +
          '<button class="btn-icon btn-icon-danger" data-act="remove" data-i="' + i + '" title="プレイリストから外す（ファイルは消えません）">' + ICONS.x + '</button>' +
        '</span></li>';
    });
    h += '</ol>';
  }
  detailEl.innerHTML = h;
  artObserve(detailEl);   // 見えている曲のジャケット画像だけ読み込む
}

// 再生中の曲の色だけ付け直す
function updatePlaylistPlayingHighlight() {
  var sel = getPlaylist(ui.lastPlaylistId);
  if (!sel) return;
  document.querySelectorAll('#pl-detail .pl-track').forEach(function (li) {
    li.classList.toggle('is-playing', sel.tracks[+li.getAttribute('data-i')] === player.currentPath);
  });
}

/* ---------- 操作の受け付け（最初に1回だけ登録） ---------- */
function initPlaylistsPage() {
  document.getElementById('pl-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-pl]');
    if (!b) return;
    ui.lastPlaylistId = +b.getAttribute('data-pl'); saveUi();
    renderPlaylistsPage();
  });
  var detail = document.getElementById('pl-detail');
  detail.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var id = ui.lastPlaylistId, i = +b.getAttribute('data-i');
    switch (b.getAttribute('data-act')) {
      case 'play-all': playPlaylist(id, 0); break;
      case 'shuffle-play': shufflePlay(function () { playPlaylist(id, 0); }); break;   // v7.5
      case 'play-screen': openPlaylistPlay(id); break;   // v5.6
      case 'play': playPlaylist(id, i); break;
      case 'rename': renamePlaylistInteractive(id); break;
      case 'delete': deletePlaylistInteractive(id); break;
      case 'up': movePlaylistTrack(id, i, i - 1); break;
      case 'down': movePlaylistTrack(id, i, i + 1); break;
      case 'remove': removePlaylistTrack(id, i); break;
    }
  });
  // ドラッグで並べ替え
  detail.addEventListener('dragstart', function (ev) {
    var li = ev.target.closest('.pl-track');
    if (!li) return;
    plView.dragFrom = +li.getAttribute('data-i');
    li.classList.add('dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(plView.dragFrom)); } catch (e) { /* 無視 */ }
  });
  detail.addEventListener('dragover', function (ev) {
    var li = ev.target.closest('.pl-track');
    if (!li || plView.dragFrom < 0) return;
    ev.preventDefault();
    detail.querySelectorAll('.drag-over').forEach(function (x) { if (x !== li) x.classList.remove('drag-over'); });
    li.classList.add('drag-over');
  });
  detail.addEventListener('dragleave', function (ev) {
    var li = ev.target.closest('.pl-track');
    if (li && !li.contains(ev.relatedTarget)) li.classList.remove('drag-over');
  });
  detail.addEventListener('drop', function (ev) {
    var li = ev.target.closest('.pl-track');
    if (!li || plView.dragFrom < 0) return;
    ev.preventDefault();
    var from = plView.dragFrom, to = +li.getAttribute('data-i');
    plView.dragFrom = -1;
    movePlaylistTrack(ui.lastPlaylistId, from, to);
  });
  detail.addEventListener('dragend', function () {
    plView.dragFrom = -1;
    detail.querySelectorAll('.dragging, .drag-over').forEach(function (x) { x.classList.remove('dragging', 'drag-over'); });
  });
}

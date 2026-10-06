/* =========================================================
   08-organizer.js ― 「ファイル整理」画面（見た目と操作の受け付け）
   ・フォルダ一覧（左）：フォルダを選ぶ／新しいフォルダ
   ・フォルダの中身（右）：ファイル名の変更・別のフォルダへ移動・削除フォルダへ移動
   ・操作履歴（下）：これまでの整理操作。「直前の操作を元に戻す」
   実際のファイル操作・確認ダイアログ・履歴の記録は 09-file-ops.js
   ========================================================= */

var orgView = { selected: new Set() };

PAGE_RENDERERS.organizer = renderOrganizerPage;

function orgCurrentFolder() {
  var f = ui.orgFolder || '';
  return library.folders.indexOf(f) >= 0 ? f : '';
}

/* ---------- 描画 ---------- */
function renderOrganizerPage() {
  if (typeof renderDuplicatePanel === 'function') { _dupBindOnce(); renderDuplicatePanel(); }   // 重複チェック（v4.7。34-duplicates.js）
  var main = document.getElementById('org-main');
  var connectMsg = document.getElementById('org-connect-msg');
  if (!isConnected()) {
    main.hidden = true;
    if (!connectMsg) {
      connectMsg = document.createElement('div');
      connectMsg.id = 'org-connect-msg';
      main.parentNode.insertBefore(connectMsg, main);
    }
    connectMsg.innerHTML = welcomeCardHtml();
    connectMsg.hidden = false;
    renderOrgHistory();
    updateOrgUndoButton();
    return;
  }
  if (connectMsg) connectMsg.hidden = true;
  main.hidden = false;
  renderOrgFolders();
  renderOrgFiles();
  renderOrgHistory();
  updateOrgUndoButton();
}

// フォルダ一覧（階層を字下げで表示）
function renderOrgFolders() {
  var el = document.getElementById('org-folders');
  var cur = orgCurrentFolder();
  var counts = {};
  library.tracks.forEach(function (t) { counts[t.folder] = (counts[t.folder] || 0) + 1; });
  el.innerHTML = '<div class="org-folder-list">' + library.folders.map(function (f) {
    var depth = f ? f.split('/').length : 0;
    var name = f ? splitPath(f).name : (fsa.folderName || '音楽フォルダ') + '（直下）';
    return '<button class="org-folder' + (f === cur ? ' active' : '') + '" data-folder="' + escapeHtml(f) + '" style="padding-left:' + (10 + depth * 16) + 'px" title="' + escapeHtml(folderLabel(f)) + '">' +
      '<span class="org-folder-icon">' + ICONS.folder + '</span><span class="org-folder-name">' + escapeHtml(name) + '</span>' +
      (counts[f] ? '<span class="count-badge-sm">' + counts[f] + '曲</span>' : '') + '</button>';
  }).join('') + '</div>' +
  (library.trashFiles ? '<p class="org-trash-note">削除フォルダの中：' + library.trashFiles + ' ファイル（一覧には出しません。完全に消したいときはエクスプローラーで削除フォルダを開いて消してください）</p>' : '');
}

// フォルダの中身（選んだフォルダの直下の曲ファイル）
function renderOrgFiles() {
  var el = document.getElementById('org-files');
  var cur = orgCurrentFolder();
  var files = library.tracks.filter(function (t) { return t.folder === cur; })
    .sort(function (a, b) { return JA_COLLATOR.compare(a.name, b.name); });
  // 見えなくなったファイルの選択は外す
  var inFolder = new Set(files.map(function (t) { return t.path; }));
  orgView.selected.forEach(function (p) { if (!inFolder.has(p)) orgView.selected.delete(p); });
  var n = orgView.selected.size;
  var allChecked = files.length && files.every(function (t) { return orgView.selected.has(t.path); });

  var h = '<div class="org-files-head">' +
    '<h2 class="panel-title">フォルダの中身</h2>' +
    '<div class="org-path" title="' + escapeHtml(folderLabel(cur)) + '">' + ICONS.folder + '<span>' + escapeHtml(cur ? (fsa.folderName + ' / ' + cur.split('/').join(' / ')) : (fsa.folderName || '') + '（直下）') + '</span></div>' +
    '</div>' +
    '<div class="org-toolbar">' +
      '<label class="org-checkall"><input type="checkbox" data-act="checkall"' + (allChecked ? ' checked' : '') + (files.length ? '' : ' disabled') + '>すべて選ぶ</label>' +
      '<span class="select-count">' + (n ? n + '件を選択中' : '') + '</span>' +
      '<button class="btn-inline-small" data-act="move"' + (n ? '' : ' disabled') + '>' + ICONS.move + '別のフォルダへ移動</button>' +
      '<button class="btn-inline-small btn-inline-danger" data-act="trash"' + (n ? '' : ' disabled') + '>' + ICONS.trash + '削除フォルダへ移動</button>' +
    '</div>';
  if (!files.length) {
    h += '<div class="empty-msg small">このフォルダの直下には曲ファイルがありません。<br>左のフォルダ一覧から別のフォルダを選んでください。</div>';
  } else {
    h += '<ul class="org-file-list">' + files.map(function (t) {
      var sel = orgView.selected.has(t.path);
      return '<li class="org-file' + (sel ? ' is-selected' : '') + '">' +
        '<input type="checkbox" data-act="check" data-path="' + escapeHtml(t.path) + '"' + (sel ? ' checked' : '') + '>' +
        '<span class="org-file-text"><span class="org-file-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="org-file-sub">' + escapeHtml([t.tagTitle, t.tagArtist].filter(Boolean).join(' ・ ')) + '</span></span>' +
        '<span class="org-file-size">' + (t.size ? formatBytes(t.size) : '') + '</span>' +
        '<button class="btn-icon" data-act="rename" data-path="' + escapeHtml(t.path) + '" title="ファイル名を変更">' + ICONS.edit + '</button>' +
        '</li>';
    }).join('') + '</ul>';
  }
  el.innerHTML = h;
}

// 操作履歴
var FILE_OP_LABELS = { rename: '名前の変更', move: 'フォルダ間の移動', trash: '削除フォルダへ移動', mkdir: 'フォルダの作成', tagedit: 'タグの編集' };
function renderOrgHistory() {
  var el = document.getElementById('org-history');
  if (!el) return;
  if (!db.history.length) {
    el.innerHTML = '<div class="empty-msg small">まだ整理操作はありません。</div>';
    return;
  }
  var latest = findUndoableEntry();
  var shown = db.history.slice(0, 50);
  el.innerHTML = '<ul class="history-list">' + shown.map(function (h) {
    // アルバムの一括編集（v5.9）：曲の変更のほかに、アルバムの設定（タグ・ソートキー・洋楽の指定）の行も出す
    var hItems = h.albumSettings && h.albumSettings.length && typeof abeSettingsRows === 'function' ? h.items.concat(abeSettingsRows(h.albumSettings)) : h.items;
    var first = hItems[0] || {};
    var summary = h.type === 'mkdir' ? ('「' + first.to + '」') : ('「' + (first.from || '') + '」→「' + (first.to || '') + '」');
    if (hItems.length > 1) summary += ' ほか' + (hItems.length - 1) + '件';
    return '<li class="history-item' + (h.undone ? ' undone' : '') + '">' +
      '<div class="history-line">' +
        '<span class="history-time">' + formatDateTime(h.at) + '</span>' +
        '<span class="history-type type-' + escapeHtml(h.type) + '">' + escapeHtml(h.label || FILE_OP_LABELS[h.type] || h.type) + '</span>' +
        '<span class="history-count">' + hItems.length + '件</span>' +
        (h.note ? '<span class="history-note">' + escapeHtml(h.note) + '</span>' : '') +   // 重複の整理など（v4.7）
        (h.undone ? '<span class="history-state">元に戻し済み（' + formatDateTime(h.undoneAt) + '）</span>' : '') +
        (latest && latest.id === h.id ? '<button class="btn-inline-small" onclick="undoLastOperation()">' + ICONS.undo + '元に戻す</button>' : '') +
      '</div>' +
      '<details class="history-details"><summary>' + escapeHtml(summary) + '</summary>' + changeTableHtml(hItems.map(function (i) { return { from: i.from || '（新規作成）', to: i.to }; })) + '</details>' +
      '</li>';
  }).join('') + '</ul>' +
  (db.history.length > shown.length ? '<p class="dialog-hint">ほか ' + (db.history.length - shown.length) + ' 件の古い履歴があります（最大 ' + HISTORY_MAX + ' 件まで保存）。</p>' : '');
}
function updateOrgUndoButton() {
  var b = document.getElementById('org-undo-btn');
  if (!b) return;
  var e = findUndoableEntry();
  b.disabled = !e;
  b.title = e ? '「' + (e.label || FILE_OP_LABELS[e.type] || e.type) + '」（' + formatDateTime(e.at) + '）を元に戻します' : '元に戻せる操作はありません';
}

/* ---------- 操作 ---------- */
function orgSelectFolder(f) {
  ui.orgFolder = f; saveUi();
  orgView.selected.clear();
  renderOrgFolders();
  renderOrgFiles();
}

// ファイル名の変更（拡張子は変えない）
async function orgRenameFile(path) {
  var sp = splitPath(path);
  var ext = extOf(sp.name);
  var dotExt = ext ? '.' + sp.name.slice(sp.name.lastIndexOf('.') + 1) : '';
  var base = stripExt(sp.name);
  var v = await showPrompt({
    title: 'ファイル名の変更',
    label: '新しいファイル名',
    value: base,
    suffix: dotExt,
    hint: '拡張子（' + (dotExt || 'なし') + '）は変わりません。次の画面で「変更前 → 変更後」を確認してから実行します。',
    okText: '次へ（確認）',
    validate: function (val) {
      var n = _normalizeNewBase(val, dotExt);
      var err = validateFileName(n + dotExt);
      if (err) return err;
      if (n + dotExt === sp.name) return '今と同じ名前です。';
      return '';
    }
  });
  if (v == null) return;
  var newName = _normalizeNewBase(v, dotExt) + dotExt;
  await runFileOperation('rename', [{ from: path, to: joinPath(sp.dir, newName) }]);
}
// 入力の最後に拡張子まで書かれていたら取り除く（「曲.mp3.mp3」にならないように）
function _normalizeNewBase(val, dotExt) {
  var n = val.trim();
  if (dotExt && n.toLowerCase().slice(-dotExt.length) === dotExt.toLowerCase()) n = n.slice(0, -dotExt.length).trim();
  return n;
}

// 選んだファイルを別のフォルダへ移動
async function orgMoveSelected() {
  var paths = Array.from(orgView.selected);
  if (!paths.length) return;
  var cur = orgCurrentFolder();
  var dest = await openFolderPickerDialog(cur, paths.length);
  if (dest == null) return;
  await runFileOperation('move', paths.map(function (p) { return { from: p, to: joinPath(dest, splitPath(p).name) }; }));
}

// 選んだファイルを削除フォルダへ移動（元のフォルダ構成のまま）
async function orgTrashSelected() {
  var paths = Array.from(orgView.selected);
  if (!paths.length) return;
  await runFileOperation('trash', paths.map(function (p) { return { from: p, to: TRASH_FOLDER_NAME + '/' + p }; }));
}

// 新しいフォルダ（今選んでいるフォルダの中に作る）
async function orgCreateFolder() {
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var cur = orgCurrentFolder();
  var name = await showPrompt({
    title: '新しいフォルダ',
    label: 'フォルダの名前',
    value: '新しいフォルダ',
    message: '作る場所：<strong>' + escapeHtml(cur ? fsa.folderName + ' / ' + cur.split('/').join(' / ') : fsa.folderName + '（直下）') + '</strong>',
    okText: '次へ（確認）',
    validate: function (v) {
      var n = v.trim();
      var err = validateFileName(n);
      if (err) return err;
      if (!cur && n === TRASH_FOLDER_NAME) return '「' + TRASH_FOLDER_NAME + '」は削除用に使う名前のため使えません。';
      if (!cur && n === TAG_BACKUP_FOLDER_NAME) return '「' + TAG_BACKUP_FOLDER_NAME + '」はタグ編集の控え用に使う名前のため使えません。';
      return '';
    }
  });
  if (name == null) return;
  await runFileOperation('mkdir', [{ to: joinPath(cur, name.trim()) }]);
}

// 移動先選択ダイアログ。選んだフォルダの相対パスを返す（キャンセルは null）
async function openFolderPickerDialog(excludeFolder, count) {
  var h = '<p class="dialog-message">' + count + '件のファイルの移動先フォルダを選んでください。</p><div class="choice-list folder-choice-list">';
  library.folders.forEach(function (f) {
    var depth = f ? f.split('/').length : 0;
    var name = f ? splitPath(f).name : (fsa.folderName || '音楽フォルダ') + '（直下）';
    var same = f === excludeFolder;
    h += '<label class="choice-item' + (same ? ' disabled' : '') + '" style="padding-left:' + (10 + depth * 16) + 'px">' +
      '<input type="radio" name="dlg-folder" value="' + escapeHtml(f) + '"' + (same ? ' disabled' : '') + '>' +
      ICONS.folder + '<span class="choice-name">' + escapeHtml(name) + '</span>' + (same ? '<span class="dialog-hint">（今のフォルダ）</span>' : '') + '</label>';
  });
  h += '</div><p class="dialog-hint">新しいフォルダに移したいときは、先にフォルダ一覧の「新しいフォルダ」で作ってください。</p><div class="dialog-error" id="dlg-folder-error"></div>';
  var chosen = null;
  var v = await openDialog({
    title: '移動先のフォルダを選ぶ',
    body: h,
    size: 'small',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true }
    ],
    beforeClose: function (value, body) {
      if (value !== 'ok') return true;
      var r = body.querySelector('input[name="dlg-folder"]:checked');
      if (!r) { body.querySelector('#dlg-folder-error').textContent = '移動先のフォルダを選んでください。'; return false; }
      chosen = r.value;
      return true;
    }
  });
  return v === 'ok' ? chosen : null;
}

/* ---------- 操作の受け付け（最初に1回だけ登録） ---------- */
function initOrganizerPage() {
  document.getElementById('org-folders').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-folder]');
    if (b) orgSelectFolder(b.getAttribute('data-folder'));
  });
  var files = document.getElementById('org-files');
  files.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act');
    if (act === 'rename') orgRenameFile(b.getAttribute('data-path'));
    else if (act === 'move') orgMoveSelected();
    else if (act === 'trash') orgTrashSelected();
  });
  files.addEventListener('change', function (ev) {
    var el = ev.target.closest('input[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'check') {
      var p = el.getAttribute('data-path');
      if (el.checked) orgView.selected.add(p); else orgView.selected.delete(p);
    } else if (act === 'checkall') {
      var cur = orgCurrentFolder();
      library.tracks.forEach(function (t) {
        if (t.folder !== cur) return;
        if (el.checked) orgView.selected.add(t.path); else orgView.selected.delete(t.path);
      });
    }
    renderOrgFiles();
  });
}

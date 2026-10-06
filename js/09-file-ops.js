/* =========================================================
   09-file-ops.js ― ファイル整理の実行（PC上のファイルを実際に変更する部分）
   流れ：実行前チェック → 確認ダイアログ（変更前 → 変更後）→ 書き込みの許可 → 実行
        → 操作履歴に記録 → プレイリスト等のパスを付け替え → 音楽フォルダを読み直す
   安全のための決まり：
   ・ファイルを完全に削除する処理は作らない（「削除」は削除フォルダへの移動）
   ・移動先に同じ名前があるときは上書きせず、実行しない
   ・「元に戻す」は操作履歴の新しいものから1つずつ
   ========================================================= */

var fileOps = { busy: false };

/* ---------- 1つのファイルを移動（名前変更も「同じフォルダ内の移動」として扱う） ---------- */
async function moveFileByPath(fromPath, toPath) {
  var f = splitPath(fromPath), t = splitPath(toPath);
  var srcDir = await getDirHandleByPath(f.dir, false);
  var srcHandle = await srcDir.getFileHandle(f.name);
  var dstDir = await getDirHandleByPath(t.dir, true);   // 削除フォルダ用に、途中のフォルダが無ければ作る
  var sameDir = f.dir === t.dir;
  // 大文字・小文字だけの変更（Windows では同じ名前とみなされる）は、一時的な名前を経由する
  var caseOnly = sameDir && f.name !== t.name && f.name.toLowerCase() === t.name.toLowerCase();
  if (caseOnly) {
    var tmp = t.name + '.mm-tmp-' + Date.now();
    await _moveHandle(srcHandle, srcDir, dstDir, tmp);
    var tmpHandle = await dstDir.getFileHandle(tmp);
    await _moveHandle(tmpHandle, dstDir, dstDir, t.name);
    return;
  }
  if (await entryExists(dstDir, t.name)) throw new Error('移動先に同じ名前のファイル（またはフォルダ）があります');
  await _moveHandle(srcHandle, srcDir, dstDir, t.name);
}

// ブラウザの move() が使えればそれで移動。使えなければ「コピー → 大きさを確認 → 元を取り除く」
async function _moveHandle(handle, srcDir, dstDir, newName) {
  var oldName = handle.name;
  if (typeof handle.move === 'function') {
    try {
      await handle.move(dstDir, newName);
      return;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw e;
      console.warn('move() が使えなかったため、コピーで移動します', e);
      // move() が途中まで成功していないか確認（元が無く、移動先にあれば成功とみなす）
      var srcGone = !(await entryExists(srcDir, oldName));
      if (srcGone && await entryExists(dstDir, newName)) return;
    }
  }
  var file = await handle.getFile();
  var newHandle = await dstDir.getFileHandle(newName, { create: true });
  var w = await newHandle.createWritable();
  try {
    await w.write(file);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch (e2) { /* 無視 */ }
    // 途中まで作ったコピー（自分で作ったもの）だけを片付ける。元のファイルには触らない
    try { await dstDir.removeEntry(newName); } catch (e3) { /* 無視 */ }
    throw e;
  }
  var copied = await newHandle.getFile();
  if (copied.size !== file.size) {
    throw new Error('コピーしたファイルの大きさが元と一致しません（元のファイルはそのまま残しています）');
  }
  // コピーが確かにできたので、元の場所から取り除く（＝移動の完了）
  await srcDir.removeEntry(oldName);
}

// フォルダを作る
async function createFolderByPath(path) {
  var sp = splitPath(path);
  var parent = await getDirHandleByPath(sp.dir, false);
  if (await entryExists(parent, sp.name)) throw new Error('同じ名前のフォルダ（またはファイル）がすでにあります');
  await parent.getDirectoryHandle(sp.name, { create: true });
}

// 空のフォルダを取り除く（「フォルダの作成」を元に戻すときだけ使う。中身があれば取り除かない）
async function removeEmptyFolderByPath(path) {
  var sp = splitPath(path);
  var parent = await getDirHandleByPath(sp.dir, false);
  var dir = await parent.getDirectoryHandle(sp.name);
  for await (var entry of dir.values()) {   // eslint-disable-line no-unused-vars
    throw new Error('フォルダが空ではないため、取り除きませんでした（中のファイルを守るため）');
  }
  await parent.removeEntry(sp.name);   // recursive を付けない＝空のフォルダしか消せない
}

/* ---------- エラーの説明 ---------- */
function describeFsError(e) {
  if (!e) return '不明なエラー';
  switch (e.name) {
    case 'NotFoundError': return '見つかりません（ほかのアプリで移動・削除された可能性があります）';
    case 'NotAllowedError': case 'SecurityError': return '書き込みが許可されていません';
    case 'NoModificationAllowedError': return 'ファイルが使用中か、書き込みできない場所です';
    case 'InvalidModificationError': return 'この変更はできません';
    case 'QuotaExceededError': return 'ディスクの空き容量が足りません';
    case 'TypeMismatchError': return '同じ名前のフォルダがあります';
    default: return e.message || String(e);
  }
}

/* ---------- 実行前チェック ----------
   問題があればエラーの一覧を返す（1件でもあれば何も実行しない）。
   削除フォルダへの移動で同じ名前がすでにある場合は「名前 (2).mp3」のように番号を付ける */
async function checkFilePlan(type, plan) {
  var errors = [];
  var planned = new Set();
  for (var k = 0; k < plan.length; k++) {
    var item = plan[k];
    try {
      if (type === 'mkdir' || type === 'rmdir') {
        var exists = await pathExists(item.to);
        if (type === 'mkdir' && exists) errors.push('「' + item.to + '」はすでにあります。');
        if (type === 'rmdir' && !exists) errors.push('「' + item.to + '」が見つかりません。');
        continue;
      }
      if (!(await pathExists(item.from))) { errors.push('「' + item.from + '」が見つかりません。'); continue; }
      if (type === 'trash') {
        item.to = await _uniqueTrashPath(item.to, planned);
      } else {
        var caseOnly = splitPath(item.from).dir === splitPath(item.to).dir && item.from !== item.to && item.from.toLowerCase() === item.to.toLowerCase();
        if (item.from === item.to) errors.push('「' + item.from + '」は変更前と変更後が同じです。');
        else if (!caseOnly && await pathExists(item.to)) errors.push('「' + item.to + '」はすでにあります（上書きはしません）。');
      }
      if (planned.has(item.to.toLowerCase())) errors.push('「' + item.to + '」に複数のファイルが重なります。');
      planned.add(item.to.toLowerCase());
    } catch (e) {
      errors.push('「' + (item.from || item.to) + '」を確認できませんでした：' + describeFsError(e));
    }
  }
  return errors;
}
async function _uniqueTrashPath(to, planned) {
  var sp = splitPath(to);
  var ext = sp.name.lastIndexOf('.') > 0 ? sp.name.slice(sp.name.lastIndexOf('.')) : '';
  var base = ext ? sp.name.slice(0, -ext.length) : sp.name;
  for (var n = 1; n < 1000; n++) {
    var cand = joinPath(sp.dir, n === 1 ? sp.name : base + ' (' + n + ')' + ext);
    if (!planned.has(cand.toLowerCase()) && !(await pathExists(cand))) return cand;
  }
  throw new Error('削除フォルダに同じ名前のファイルが多すぎます');
}

/* ---------- パスの付け替え（プレイリスト・曲情報の控え・再生キュー・選択） ---------- */
function applyPathMapping(map) {
  if (!Object.keys(map).length) return;
  replacePathsInPlaylists(map);
  Object.keys(map).forEach(function (from) {
    if (tagCache[from]) { tagCache[map[from]] = tagCache[from]; delete tagCache[from]; }
    if (db.playStats && db.playStats[from]) { db.playStats[map[from]] = db.playStats[from]; delete db.playStats[from]; }   // 再生回数
    if (typeof firstSeen !== 'undefined' && firstSeen[from]) { firstSeen[map[from]] = firstSeen[from]; delete firstSeen[from]; }   // 追加日
  });
  saveTagCache();
  if (typeof saveFirstSeen === 'function') saveFirstSeen();
  // 入力した歌詞の紐付け（曲の相対パス）も付け替える
  if (db.lyrics) {
    Object.keys(map).forEach(function (from) {
      if (db.lyrics[from]) { db.lyrics[map[from]] = db.lyrics[from]; delete db.lyrics[from]; }
    });
  }
  if (typeof lyricsCacheClear === 'function') lyricsCacheClear();
  if (typeof seasonApplyPathMapping === 'function') seasonApplyPathMapping(map);
  if (typeof upbeatApplyPathMapping === 'function') upbeatApplyPathMapping(map);   // upbeat music の手の BPM・控え（v7.8）   // Seasons Song の手の指定・歌詞の点数（v7.4）
  // アプリ内の曲情報の上書きと、「タグの編集」の履歴（曲・控えの場所）も付け替える
  if (db.tagOverrides) {
    Object.keys(map).forEach(function (from) {
      if (db.tagOverrides[from]) { db.tagOverrides[map[from]] = db.tagOverrides[from]; delete db.tagOverrides[from]; }
    });
  }
  db.history.forEach(function (h) {
    if (h.type !== 'tagedit') return;
    h.items.forEach(function (it) {
      if (it.path && map[it.path]) it.path = map[it.path];
      if (it.backup && map[it.backup]) it.backup = map[it.backup];
    });
  });
  if (typeof userPicMovePaths === 'function') userPicMovePaths(map).catch(function (e) { console.warn(e); });   // アプリ内のジャケット
  playerApplyPathMapping(map);
  var sel = new Set();
  libView.selected.forEach(function (p) { sel.add(map[p] || p); });
  libView.selected = sel;
  orgView.selected.clear();
}

/* ---------- 整理操作の実行 ----------
   type: 'rename' | 'move' | 'trash' | 'mkdir'、plan: [{ from, to }]（mkdir は { to } だけ） */
// opts（v4.7 重複チェック）：confirmExtra＝確認の文に足す HTML、after(res, entry)＝実行して読み直したあとに呼ぶ、note＝操作履歴に出す説明
async function runFileOperation(type, plan, opts) {
  opts = opts || {};
  if (fileOps.busy) { showToast('ほかの整理操作を実行中です。終わってからもう一度お試しください。', true); return; }
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var label = FILE_OP_LABELS[type] || type;

  // 1. 実行前チェック
  showBusy('確認しています…');
  var errors;
  try { errors = await checkFilePlan(type, plan); } finally { hideBusy(); }
  if (errors.length) {
    await showAlert({ title: label + 'を実行できません', message: '次の理由のため、何も変更していません。<ul class="error-list">' + errors.map(function (m) { return '<li>' + escapeHtml(m) + '</li>'; }).join('') + '</ul>' });
    return;
  }

  // 2. 確認ダイアログ（変更前 → 変更後）
  var msg = {
    rename: 'ファイル名を次のように変更します。',
    move: plan.length + '件のファイルを次のフォルダへ移動します。',
    trash: plan.length + '件のファイルを「' + TRASH_FOLDER_NAME + '」へ移動します（ファイルは消えません。元のフォルダ構成のまま移します）。',
    mkdir: '次のフォルダを作ります。'
  }[type] || '';
  var ok = await showConfirm({
    title: label + 'の確認',
    message: msg + (opts.confirmExtra || '') + '<br><span class="dialog-hint">実行後は「ファイル整理」の操作履歴に残り、「直前の操作を元に戻す」で戻せます。プレイリストの曲の場所も自動で付け替えます。</span>',
    rows: plan.map(function (i) { return { from: i.from || '（新規作成）', to: i.to }; }),
    okText: '実行する'
  });
  if (!ok) return;

  // 3. 書き込みの許可（初回はブラウザの確認が出る）
  if (!(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: 'ブラウザの確認で「変更を保存」（編集を許可）を選ぶと実行できます。何も変更していません。' });
    return;
  }

  // 4. 実行
  var res = await _executePlan(type, plan, label + 'を実行中…');

  // 5. 操作履歴に記録（成功した分だけ）
  var entry = null;
  if (res.done.length) {
    entry = { id: newId(), type: type, at: nowIso(), items: res.done, undone: false, undoneAt: '' };
    if (opts.note) entry.note = opts.note;
    db.history.unshift(entry);
    if (db.history.length > HISTORY_MAX) db.history.length = HISTORY_MAX;
  }
  await _finishOperation(res, type);
  if (opts.after) { opts.after(res, entry); saveDB(); renderAll(); }
  _reportResult(label, res);
}

// 計画どおりに1件ずつ実行し、成功・失敗を返す
async function _executePlan(type, plan, busyText) {
  fileOps.busy = true;
  showBusy(busyText);
  var playState = (type === 'mkdir' || type === 'rmdir') ? null : playerReleaseIfAffected(plan.map(function (i) { return i.from; }));
  var done = [], failed = [];
  try {
    for (var k = 0; k < plan.length; k++) {
      var item = plan[k];
      if (plan.length > 1) document.getElementById('busy-text').textContent = busyText + '（' + (k + 1) + ' / ' + plan.length + '）';
      try {
        if (type === 'mkdir') await createFolderByPath(item.to);
        else if (type === 'rmdir') await removeEmptyFolderByPath(item.to);
        else await moveFileByPath(item.from, item.to);
        done.push({ from: item.from, to: item.to });
      } catch (e) {
        console.error('整理操作の失敗', item, e);
        failed.push({ item: item, message: describeFsError(e) });
      }
    }
  } finally {
    fileOps.busy = false;
  }
  var map = {};
  if (type !== 'mkdir' && type !== 'rmdir') done.forEach(function (i) { map[i.from] = i.to; });
  return { done: done, failed: failed, map: map, playState: playState };
}

// パスの付け替え → 保存 → 読み直し → 再生の再開
// v7.3：音楽フォルダ全体は読み直さず、動かした曲だけを一覧に反映する（04-library.js の libraryApplyFileOp）。
//   全体の読み直しは 1万曲で約8秒かかっていた（フォルダを全部たどる所）。反映できなかったときだけ全体を読み直す
async function _finishOperation(res, type) {
  applyPathMapping(res.map);
  saveDB();
  document.getElementById('busy-text').textContent = '一覧を更新しています…';
  try {
    var ok = false;
    try { ok = typeof libraryApplyFileOp === 'function' && await libraryApplyFileOp(type || 'move', res); } catch (e) { console.warn('一覧の部分的な更新に失敗', e); ok = false; }
    if (!ok) { document.getElementById('busy-text').textContent = '音楽フォルダを読み直しています…'; await scanLibrary(); }
  } finally { hideBusy(); }
  await playerRestore(res.playState, res.map);
  renderAll();
}

function _reportResult(label, res, successMsg) {
  if (!res.failed.length) {
    showToast(successMsg || (label + 'を実行しました（' + res.done.length + '件）。操作履歴に記録しました。'));
    return;
  }
  showAlert({
    title: label + '：一部を実行できませんでした',
    size: 'large',
    message: '成功：' + res.done.length + '件 ／ 失敗：' + res.failed.length + '件' +
      (res.done.length ? '（成功した分は操作履歴に記録しました）' : '') +
      '<ul class="error-list">' + res.failed.map(function (f) {
        return '<li>' + escapeHtml(f.item.from || f.item.to) + '：' + escapeHtml(f.message) + '</li>';
      }).join('') + '</ul>'
  });
}

/* ---------- 元に戻す ---------- */
function findUndoableEntry() {
  for (var i = 0; i < db.history.length; i++) if (!db.history[i].undone) return db.history[i];
  return null;
}

async function undoLastOperation() {
  if (fileOps.busy) { showToast('ほかの整理操作を実行中です。', true); return; }
  var entry = findUndoableEntry();
  if (!entry) { showToast('元に戻せる操作はありません。'); return; }
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  if (entry.type === 'tagedit') { await undoTagEdit(entry); return; }   // タグの編集は 17-tag-edit.js で戻す
  var label = FILE_OP_LABELS[entry.type] || entry.type;
  var type, plan;
  if (entry.type === 'mkdir') {
    type = 'rmdir';
    plan = entry.items.map(function (i) { return { to: i.to }; });
  } else {
    type = 'move';
    plan = entry.items.slice().reverse().map(function (i) { return { from: i.to, to: i.from }; });
  }

  showBusy('確認しています…');
  var errors;
  try { errors = await checkFilePlan(type, plan); } finally { hideBusy(); }
  if (errors.length) {
    await showAlert({ title: '元に戻せません', message: '次の理由のため、何も変更していません（ほかのアプリでファイルが動かされた可能性があります）。<ul class="error-list">' + errors.map(function (m) { return '<li>' + escapeHtml(m) + '</li>'; }).join('') + '</ul>' });
    return;
  }
  var ok = await showConfirm({
    title: '直前の操作を元に戻す',
    message: '「<strong>' + escapeHtml(label) + '</strong>」（' + formatDateTime(entry.at) + '、' + entry.items.length + '件）を元に戻します。' +
      (type === 'rmdir' ? '<br><span class="dialog-hint">作ったフォルダを取り除きます。中にファイルがある場合は取り除きません。</span>' : ''),
    rows: plan.map(function (i) { return type === 'rmdir' ? { from: i.to, to: '（フォルダを取り除く）' } : { from: i.from, to: i.to }; }),
    okText: '元に戻す'
  });
  if (!ok) return;
  if (!(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: '何も変更していません。' });
    return;
  }
  var res = await _executePlan(type, plan, '元に戻しています…');

  // 履歴の更新：全部戻せたら「元に戻し済み」。一部だけなら、戻せなかった分を残す
  if (!res.failed.length) {
    entry.undone = true;
    if (entry.dupPlaylists && typeof restoreDupPlaylists === 'function') restoreDupPlaylists(entry);   // 重複の整理のプレイリストの付け替えも戻す（v4.7）
    entry.undoneAt = nowIso();
  } else {
    var failedKeys = new Set(res.failed.map(function (f) { return (f.item.to || '') + '|' + (f.item.from || ''); }));
    entry.items = entry.items.filter(function (i) {
      // 元の操作 {from:A, to:B} は、戻す操作では {from:B, to:A}（rmdir は {to:B}）
      var key = entry.type === 'mkdir' ? (i.to + '|') : (i.from + '|' + i.to);
      return failedKeys.has(key);
    });
  }
  await _finishOperation(res, type);
  _reportResult('元に戻す', res, '「' + label + '」を元に戻しました（' + res.done.length + '件）。');
}

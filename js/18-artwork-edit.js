/* =========================================================
   18-artwork-edit.js ― ジャケットを自分で設定する（v2.0）
   ・入口：アルバムの見出しの「ジャケットを設定」（アルバムの全曲）、
          曲情報の編集ダイアログの「ジャケットを設定…」（その曲・まとめて編集では選んだ曲）
   ・ジャケットの設定ダイアログ：今の画像と新しい画像を並べて表示。画像は
     「画像ファイルを選ぶ」・ドラッグ＆ドロップ・クリップボードから貼り付け（Ctrl+V）で選ぶ。
     大きい画像は長い辺 1400px の JPEG に縮小（正方形でなくても切り抜かない）。「ジャケットを外す」もできる
   ・「音楽ファイルに埋め込む」（mp3・m4a・flac）：17-tag-edit.js の writeTagsSafely()（控え→一時ファイル→確認→置き換え）
     それ以外（ogg・wav など、または埋め込まない）：アプリ内に保存（13-artwork.js の userPic…。バックアップには含めない）
   ・操作履歴に「タグの編集」として残り、「直前の操作を元に戻す」で戻せる
   ========================================================= */

var ART_EMBED_MAX = 1400;                    // 埋め込む画像の長い辺の上限（px）
var ART_EMBED_MAX_BYTES = 1.5 * 1024 * 1024; // これより大きいファイルは JPEG に作り直す

/* ---------- 画像を用意する（大きすぎれば縮小・JPEG に） ---------- */
async function prepareArtworkImage(blob) {
  var src = new Uint8Array(await blob.arrayBuffer());
  var bmp;
  try { bmp = await createImageBitmap(blob); }
  catch (e) { throw _tagErr('画像として読めませんでした（jpg・png・webp などの画像を選んでください）'); }
  var w = bmp.width, h = bmp.height;
  var mime = _sniffImageMime(src);
  // JPEG・PNG で大きすぎなければ、そのまま使う（画質を落とさない）
  if ((mime === 'image/jpeg' || mime === 'image/png') && Math.max(w, h) <= ART_EMBED_MAX && src.length <= ART_EMBED_MAX_BYTES) {
    if (bmp.close) bmp.close();
    return { mime: mime, bytes: src, width: w, height: h, resized: false, origW: w, origH: h, origSize: src.length };
  }
  var s = Math.min(1, ART_EMBED_MAX / Math.max(w, h));
  var nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
  var c = document.createElement('canvas');
  c.width = nw; c.height = nh;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';   // 透明な部分は白にする（JPEG は透明を持てないため）
  ctx.fillRect(0, 0, nw, nh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, nw, nh);
  if (bmp.close) bmp.close();
  var out = await new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.9); });
  if (!out) throw _tagErr('画像を縮小できませんでした');
  return { mime: 'image/jpeg', bytes: new Uint8Array(await out.arrayBuffer()), width: nw, height: nh, resized: true, origW: w, origH: h, origSize: src.length };
}
function _picSummary(pic) {
  return pic.width + '×' + pic.height + '・約 ' + formatBytes(pic.bytes.length) + '（' + (pic.mime === 'image/png' ? 'PNG' : 'JPEG') + '）';
}

/* ---------- ジャケットの設定ダイアログ ---------- */
async function openArtworkEditor(tracks, targetLabel) {
  tracks = (tracks || []).filter(Boolean);
  if (!tracks.length) return;
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var nW = tracks.filter(function (t) { return tagWriteKind(t.ext); }).length;
  var checked = nW > 0 && ui.tagWriteToFile !== false;
  var st = { pic: null, curUrl: null, newUrl: null, closed: false };
  var body =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'ジャケットの設定ダイアログ\', event)" title="クリックで「ジャケットの設定ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">対象：' + escapeHtml(targetLabel || '') + '（' + tracks.length + '曲）</p>' +
    '<div class="aw-compare">' +
      '<div class="aw-box"><div class="aw-label">今のジャケット</div><div class="aw-img" id="aw-current">' + ICONS.music + '</div><div class="aw-cap" id="aw-current-cap">調べています…</div></div>' +
      '<div class="aw-arrow">→</div>' +
      '<div class="aw-box aw-drop" id="aw-drop"><div class="aw-label">新しい画像</div>' +
        '<div class="aw-img aw-img-new" id="aw-new"><span class="aw-drop-hint">ここに画像をドラッグ<br>または Ctrl+V で貼り付け</span></div>' +
        '<div class="aw-cap" id="aw-new-cap">まだ選ばれていません</div></div>' +
    '</div>' +
    '<div class="btn-row aw-pick-row"><button type="button" class="btn-inline-small" id="aw-pick">' + ICONS.image + '画像ファイルを選ぶ</button>' +
      '<input type="file" id="aw-file" accept="image/*" hidden></div>' +
    '<p class="dialog-hint">jpg・png・webp などが使えます。長い辺が ' + ART_EMBED_MAX + 'px より大きい画像や大きなファイルは、' + ART_EMBED_MAX + 'px の JPEG に縮小して使います（正方形でない画像も切り抜かずにそのまま使います）。</p>' +
    '<label class="tagedit-write"><input type="checkbox" id="aw-write"' + (checked ? ' checked' : '') + (nW ? '' : ' disabled') + '>音楽ファイルに埋め込む</label>' +
    '<p class="dialog-hint">' + (nW
      ? 'mp3・m4a・flac は、書き込む前に元のファイルを「' + TAG_BACKUP_FOLDER_NAME + '」へコピーし、書き込んだ結果（音声データ・ほかのタグ・画像）を確かめてから置き換えます。'
      : '') +
      (nW < tracks.length || !nW ? 'ogg・wav など埋め込めない形式の曲（または埋め込まないとき）は、この PC のブラウザ内に保存してアプリの中だけで表示します。<strong>画像が大きいため、バックアップ（JSON）には含まれません。</strong>' : 'チェックを外すと、この PC のブラウザ内に保存してアプリの中だけで表示します（バックアップには含まれません）。') +
    '</p>' +
    '<p class="dialog-hint tagedit-itunes">' + TAG_ITUNES_NOTE + '</p>' +
    '<div class="dialog-error" id="aw-error"></div>';

  var onPaste = null;
  var v = await openDialog({
    title: 'ジャケットの設定', body: body, size: 'large',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: 'ジャケットを外す', value: 'remove', cls: 'btn-cancel btn-cancel-danger' },
      { label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true }
    ],
    onOpen: function (b) {
      var err = b.querySelector('#aw-error');
      // 今のジャケット
      artFindOriginal(tracks[0]).then(async function (found) {
        if (st.closed) return;
        var cap = b.querySelector('#aw-current-cap');
        if (!found) { cap.textContent = 'ジャケット画像なし'; return; }
        st.curUrl = URL.createObjectURL(found.blob);
        b.querySelector('#aw-current').innerHTML = '<img src="' + st.curUrl + '" alt="今のジャケット">';
        var dims = '';
        try { var bm = await createImageBitmap(found.blob); dims = bm.width + '×' + bm.height + '・'; if (bm.close) bm.close(); } catch (e) { /* 無視 */ }
        cap.textContent = ART_SOURCE_LABELS[found.source] + '（' + dims + '約 ' + formatBytes(found.blob.size) + '）' + (tracks.length > 1 ? '・1曲目' : '');
      });
      // 新しい画像を受け取る
      async function take(blob) {
        err.textContent = '';
        if (!blob) { err.textContent = '画像が見つかりませんでした。'; return; }
        try {
          var pic = await prepareArtworkImage(blob);
          if (st.closed) return;
          st.pic = pic;
          if (st.newUrl) URL.revokeObjectURL(st.newUrl);
          st.newUrl = URL.createObjectURL(new Blob([pic.bytes], { type: pic.mime }));
          b.querySelector('#aw-new').innerHTML = '<img src="' + st.newUrl + '" alt="新しい画像">';
          b.querySelector('#aw-new-cap').textContent = _picSummary(pic) +
            (pic.resized ? '　元の画像 ' + pic.origW + '×' + pic.origH + '・約 ' + formatBytes(pic.origSize) + ' から縮小' : '');
        } catch (e) { err.textContent = (e && e.message) ? e.message : '画像を読めませんでした。'; }
      }
      var file = b.querySelector('#aw-file');
      b.querySelector('#aw-pick').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () { if (file.files && file.files[0]) take(file.files[0]); file.value = ''; });
      var drop = b.querySelector('#aw-drop');
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('drag-over'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); drop.classList.remove('drag-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        take(f && /^image\//.test(f.type || 'image/') ? f : null);
      });
      onPaste = function (e) {
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); take(items[i].getAsFile()); return; }
        }
        err.textContent = 'クリップボードに画像がありません。画像をコピーしてから貼り付けてください。';
      };
      document.addEventListener('paste', onPaste);
    },
    beforeClose: function (value, b) {
      if (value === 'ok' && !st.pic) { b.querySelector('#aw-error').textContent = '新しい画像を選んでください。'; return false; }
      st.write = !!(b.querySelector('#aw-write') || {}).checked;
      return true;
    }
  });
  st.closed = true;
  if (onPaste) document.removeEventListener('paste', onPaste);
  if (st.curUrl) URL.revokeObjectURL(st.curUrl);
  if (st.newUrl) URL.revokeObjectURL(st.newUrl);
  if (v !== 'ok' && v !== 'remove') return;
  if (nW) { ui.tagWriteToFile = st.write; saveUi(); }
  await runArtworkEdit(tracks, v === 'ok' ? st.pic : null, st.write);
}

/* ---------- 実行 ---------- */
async function runArtworkEdit(tracks, pic, write) {
  if (fileOps.busy) { showToast('ほかの操作を実行中です。終わってからもう一度お試しください。', true); return; }
  var items = [];
  for (var q = 0; q < tracks.length; q++) {
    var t = tracks[q], mode = (write && tagWriteKind(t.ext)) ? 'file' : 'app-picture';
    if (!pic) {   // 外す：外す画像が無い曲は対象にしない
      if (mode === 'file') {
        var has = await readTrackPicture(await t.handle.getFile());
        var upf = await userPicGet(t.path).catch(function () { return null; });
        if (!has && !upf) continue;
      } else if (!(await artFindOriginal(t))) continue;
    }
    items.push({ t: t, path: t.path, mode: mode });
  }
  if (!items.length) { showToast(pic ? '対象の曲がありません。' : 'ジャケットは設定されていません（変更なし）。'); return; }
  var nFile = items.filter(function (i) { return i.mode === 'file'; }).length, nApp = items.length - nFile;
  var ok = await showConfirm({
    title: 'ジャケットの変更の確認',
    message: '対象：<strong>' + items.length + '曲</strong><br>' +
      '音楽ファイルに埋め込む：<strong>' + nFile + '曲</strong>' + (nFile ? '（書き込む前に元のファイルを「' + TAG_BACKUP_FOLDER_NAME + '」フォルダへコピーします）' : '') + '<br>' +
      'アプリ内だけで変える：<strong>' + nApp + '曲</strong>' + (nApp ? '（この PC のブラウザ内に保存。バックアップには含まれません）' : '') + '<br>' +
      (pic ? '新しい画像：<strong>' + escapeHtml(_picSummary(pic)) + '</strong>' : '<strong>ジャケット画像を外します</strong>' + (nFile ? '（埋め込まれている画像をすべて外します）' : '')) +
      '<br><span class="dialog-hint">操作履歴に残り、「直前の操作を元に戻す」で戻せます。' + (nFile ? TAG_ITUNES_NOTE : '') + '</span>',
    rows: items.map(function (i) {
      return { from: i.t.name, to: (pic ? '新しいジャケット（' + pic.width + '×' + pic.height + '）' : 'ジャケットを外す') + (i.mode === 'file' ? '' : '（アプリ内）') };
    }),
    okText: '変更する'
  });
  if (!ok) return;
  if (nFile && !(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: 'ブラウザの確認で「変更を保存」（編集を許可）を選ぶと実行できます。何も変更していません。' });
    return;
  }
  fileOps.busy = true;
  showBusy('ジャケットを変更しています…');
  var entryId = newId();
  var playState = playerReleaseIfAffected(items.filter(function (i) { return i.mode === 'file'; }).map(function (i) { return i.path; }));
  var stamp = _tagStamp(), done = [], failed = [];
  var label = pic ? '新しいジャケット（' + _picSummary(pic) + '）' : 'ジャケットを外す';
  try {
    for (var k = 0; k < items.length; k++) {
      var i = items[k];
      if (items.length > 1) document.getElementById('busy-text').textContent = 'ジャケットを変更しています…（' + (k + 1) + ' / ' + items.length + '）';
      try {
        // アプリ内のジャケットがあれば、元に戻せるように控えてから置き換え・消す
        var prevRec = await userPicGet(i.path).catch(function () { return null; });
        var undoKey = 'undo:' + entryId + ':' + i.path;
        if (i.mode === 'file') {
          var r = await writeTagsSafely(i.t, { picture: pic }, stamp);
          await _refreshTrackFromFile(i.t);
          if (prevRec) { await userPicSet(undoKey, prevRec); await userPicDelete(i.path); }   // ファイルに書いたので、アプリ内の分は外す
          done.push({ path: i.path, mode: 'file', backup: r.backupPath, beforeHash: r.beforeHash, afterHash: r.afterHash,
            changes: { picture: pic ? 'set' : 'remove' }, before: {}, prevPicKey: prevRec ? undoKey : null, from: i.path + '　ジャケット', to: label });
        } else {
          if (prevRec) await userPicSet(undoKey, prevRec);
          await userPicSet(i.path, pic
            ? { blob: new Blob([pic.bytes], { type: pic.mime }), mime: pic.mime, width: pic.width, height: pic.height, at: Date.now() }
            : { removed: true, at: Date.now() });
          done.push({ path: i.path, mode: 'app-picture', changes: { picture: pic ? 'set' : 'remove' }, before: {}, prevPicKey: prevRec ? undoKey : null,
            from: i.path + '　ジャケット', to: label + '（アプリ内）' });
        }
      } catch (e) {
        console.error('ジャケットの変更に失敗', i.path, e);
        failed.push({ path: i.path, message: (e && e.name === 'TagWriteError') ? e.message : describeFsError(e) });
      }
    }
    if (done.length) {
      db.history.unshift({ id: entryId, type: 'tagedit', at: nowIso(), items: done, undone: false, undoneAt: '' });
      if (db.history.length > HISTORY_MAX) db.history.length = HISTORY_MAX;
    }
    saveDB();
    saveTagCache();
    await artInvalidateTracks(done.map(function (d) { return library.byPath[d.path]; }));
  } finally {
    fileOps.busy = false;
    hideBusy();
  }
  await playerRestore(playState, {});
  renderAll();
  if (!failed.length) { showToast('ジャケットを変更しました（' + done.length + '曲）。操作履歴に記録しました。'); return; }
  await showAlert({
    title: '一部の曲を変更できませんでした', size: 'large',
    message: '成功：' + done.length + '曲 ／ 失敗：' + failed.length + '曲。失敗した曲のファイルは変更していません。' +
      '<ul class="error-list">' + failed.map(function (f) { return '<li>' + escapeHtml(f.path) + '：' + escapeHtml(f.message) + '</li>'; }).join('') + '</ul>'
  });
}

// 元に戻すとき（17-tag-edit.js の undoTagEdit から）：アプリ内のジャケットを前の状態に戻す
async function restoreUserPicForUndo(item) {
  if (item.prevPicKey) {
    var rec = await userPicGet(item.prevPicKey);
    if (rec) await userPicSet(item.path, rec); else await userPicDelete(item.path);
    await userPicDelete(item.prevPicKey);
  } else if (item.mode === 'app-picture') {
    await userPicDelete(item.path);
  }
}

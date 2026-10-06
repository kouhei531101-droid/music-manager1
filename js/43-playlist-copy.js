/* =========================================================
   43-playlist-copy.js ― プレイリストをフォルダにコピー（v6.7）
   ・入口：プレイリストの曲の見出しの「フォルダにコピー」ボタン（data-act="copy-folder"）
   ・コピー先：フォルダ選択の画面（showDirectoryPicker、書き込みあり）で選んだフォルダの中に、プレイリスト名のフォルダを作ってコピーする
     （ファイル名に使えない文字は「_」に置き換える）。元の曲ファイルは読むだけ（移動・変更はしない）
   ・コピーの確認ダイアログ：曲の数・合計サイズ・コピー先と、設定（番号を付ける・同じ名前のとき・.m3u8 を作る）
     コピー先が音楽フォルダの中なら注意を出す（曲が二重に読み込まれるため）
   ・コピー中の表示：何曲中何曲・何MB、「中止」（途中のファイルは書き込みを取り消す）
   ・コピーの結果：コピーできた曲・飛ばした曲・失敗した曲（理由つき）を分けて出す
   ========================================================= */

var PLC_BAD_CHARS = /[\\\/:*?"<>|\u0000-\u001f]/g;
// ファイル名・フォルダ名に使えない文字を置き換える（末尾の点・空白も。空なら「名前なし」）
function plcSafeName(s) {
  var v = String(s || '').replace(PLC_BAD_CHARS, '_').replace(/[\s.]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(v)) v = '_' + v;
  return v.slice(0, 150) || '名前なし';
}
function _plcPad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
// 同じ名前があるとき「名前 (2).拡張子」…で空いている名前
async function _plcFreeName(dir, name) {
  var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (var n = 2; n < 1000; n++) { var c = base + ' (' + n + ')' + ext; if (!(await entryExists(dir, c))) return c; }
  throw new Error('別の名前を決められませんでした');
}

async function copyPlaylistToFolder(id) {
  var p = getPlaylist(id);
  if (!p || !p.tracks.length) { showToast('このプレイリストには曲がありません。'); return; }
  if (!window.showDirectoryPicker) {
    await showAlert({ title: 'このブラウザでは使えません', message: 'フォルダにコピーは、パソコン版の Google Chrome または Microsoft Edge で使えます（フォルダを選んで書き込む機能が必要です）。' });
    return;
  }
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  // 1. コピー先を選ぶ
  var dest;
  try { dest = await window.showDirectoryPicker({ id: 'mm-playlist-copy', mode: 'readwrite' }); }
  catch (e) { if (e && e.name === 'AbortError') return; await showAlert({ title: 'フォルダを選べませんでした', message: escapeHtml(describeFsError(e)) }); return; }
  try {
    var q = await dest.queryPermission({ mode: 'readwrite' });
    if (q !== 'granted' && (await dest.requestPermission({ mode: 'readwrite' })) !== 'granted') { await showAlert({ title: '書き込みが許可されませんでした', message: '何もコピーしていません。' }); return; }
  } catch (e) { /* 許可の確かめができないブラウザはそのまま進む */ }
  // 音楽フォルダの中か（同じフォルダも）
  var inside = null;
  try { inside = (await fsa.root.isSameEntry(dest)) ? [] : await fsa.root.resolve(dest); } catch (e) { inside = null; }
  // 2. 曲と合計サイズ
  var items = [], total = 0;
  showBusy('曲の大きさを調べています…');
  try {
    for (var i = 0; i < p.tracks.length; i++) {
      var t = library.byPath[p.tracks[i]], size = 0;
      if (t) { try { size = (await t.handle.getFile()).size; } catch (e) { size = 0; } }
      items.push({ no: i + 1, path: p.tracks[i], t: t, size: size });
      total += size;
    }
  } finally { hideBusy(); }
  var folderName = plcSafeName(p.name), width = Math.max(3, String(items.length).length);
  var missing = items.filter(function (x) { return !x.t; }).length;
  var body = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'コピーの確認ダイアログ\', event)" title="クリックで「コピーの確認ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">プレイリスト「<strong>' + escapeHtml(p.name) + '</strong>」の曲ファイルをコピーします。元の曲ファイルは読むだけで、移動・変更はしません。</p>' +
    '<table class="plc-sum"><tr><th>曲の数</th><td>' + items.length + '曲' + (missing ? '（うち ' + missing + '曲は見つからないためコピーできません）' : '') + '</td></tr>' +
      '<tr><th>合計サイズ</th><td>' + formatBytes(total) + '</td></tr>' +
      '<tr><th>コピー先</th><td>' + escapeHtml(dest.name) + ' ／ <strong>' + escapeHtml(folderName) + '</strong>（このフォルダを作って、その中へ）</td></tr></table>' +
    (inside ? '<p class="plc-warn">⚠ コピー先が音楽フォルダ「' + escapeHtml(fsa.folderName || '') + '」の中です。コピーした曲も読み込まれて、曲・アルバムが二重に出ます。音楽フォルダの外を選ぶことをおすすめします。</p>' : '') +
    '<div class="plc-opts">' +
      '<label class="tagedit-write"><input type="checkbox" id="plc-number" checked>ファイル名の先頭にプレイリストの順番の番号を付ける（例：' + _plcPad(1, width) + '_曲名.mp3）</label>' +
      '<div class="plc-dup"><span>同じ名前のファイルがあるとき：</span>' +
        '<label class="dup-opt"><input type="radio" name="plc-dup" value="skip" checked>飛ばす</label>' +
        '<label class="dup-opt"><input type="radio" name="plc-dup" value="rename">別の名前にして両方残す</label>' +
        '<span class="dialog-hint">（上書きはしません）</span></div>' +
      '<label class="tagedit-write"><input type="checkbox" id="plc-m3u" checked>プレイリストのファイル（' + escapeHtml(folderName) + '.m3u8）も作る</label>' +
    '</div>';
  var opts = null;
  var v = await openDialog({
    title: 'フォルダにコピー', body: body, size: 'large',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: 'コピーする', value: 'ok', cls: 'btn-save', isDefault: true }],
    beforeClose: function (value, b) {
      if (value === 'ok') opts = { number: b.querySelector('#plc-number').checked, dup: b.querySelector('input[name="plc-dup"]:checked').value, m3u: b.querySelector('#plc-m3u').checked };
      return true;
    }
  });
  if (v !== 'ok' || !opts) return;
  await _plcRun(p, items, total, dest, folderName, width, opts);
}

async function _plcRun(p, items, total, dest, folderName, width, opts) {
  var st = { cancel: false, done: false, bytes: 0, i: 0 };
  // コピー中の表示（ダイアログ。「中止」を押すと、今のファイルの書き込みを取り消して止まる）
  var dlg = openDialog({
    title: 'フォルダにコピー中', size: 'small',
    body: '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'コピー中の表示\', event)" title="クリックで「コピー中の表示」をコピー">□</span>' +
      '<div class="plc-prog"><div class="plc-prog-text" id="plc-prog-text">準備しています…</div><div class="plc-bar"><div class="plc-bar-fill" id="plc-bar-fill"></div></div><div class="plc-prog-sub" id="plc-prog-sub"></div></div>',
    buttons: [{ label: '中止', value: 'stop', cls: 'btn-cancel btn-cancel-danger', isDefault: true }],
    cancelValue: 'stop',   // × と Esc も「中止」と同じ
    beforeClose: function () {
      if (st.done) return true;
      st.cancel = true;
      var s = document.getElementById('plc-prog-sub'); if (s) s.textContent = '中止しています…（今のファイルの書き込みを取り消しています）';
      return false;
    }
  });
  var show = function (name) {
    var te = document.getElementById('plc-prog-text'), fe = document.getElementById('plc-bar-fill'), se = document.getElementById('plc-prog-sub');
    if (!te) return;
    te.textContent = Math.min(st.i + 1, items.length) + ' / ' + items.length + '曲　' + (st.bytes / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB';
    fe.style.width = (total ? Math.min(100, st.bytes / total * 100) : st.i / items.length * 100).toFixed(1) + '%';
    if (name && !st.cancel) se.textContent = name;
  };
  var copied = [], skipped = [], failed = [], m3u = [], cancelledAt = -1, dir = null, m3uName = '';
  try {
    dir = await dest.getDirectoryHandle(folderName, { create: true });
  } catch (e) {
    st.done = true; closeDialog('stop'); await dlg;
    await showAlert({ title: 'コピーできませんでした', message: 'コピー先のフォルダ「' + escapeHtml(folderName) + '」を作れませんでした：' + escapeHtml(describeFsError(e)) + '<br>何もコピーしていません。' });
    return;
  }
  for (st.i = 0; st.i < items.length; st.i++) {
    var x = items[st.i];
    if (st.cancel) { cancelledAt = st.i; break; }
    var name = '';
    try {
      if (!x.t) throw new Error(isInTrash(x.path) ? '削除フォルダ内にあります' : '音楽フォルダに見つかりません');
      name = plcSafeName((opts.number ? _plcPad(x.no, width) + '_' : '') + x.t.name);
      show(name);
      if (await entryExists(dir, name)) {
        if (opts.dup === 'skip') { skipped.push({ x: x, name: name, why: '同じ名前のファイルがあるため飛ばしました' }); m3u.push({ x: x, name: name }); st.bytes += x.size; continue; }
        name = await _plcFreeName(dir, name);
      }
      var file = await x.t.handle.getFile();   // 元のファイルは読むだけ
      var fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
      var ok = false, start = st.bytes;
      try {
        var reader = file.stream().getReader();
        for (;;) {
          if (st.cancel) throw { plcCancel: true };
          var r = await reader.read();
          if (r.done) break;
          await w.write(r.value);
          st.bytes += r.value.byteLength; show();
        }
        await w.close(); ok = true;
      } finally {
        if (!ok) {
          try { await w.abort(); } catch (e2) { /* 無視 */ }
          try { await dir.removeEntry(name); } catch (e3) { /* 作りかけの空のファイルを片付ける */ }
          st.bytes = start;
        }
      }
      copied.push({ x: x, name: name });
      m3u.push({ x: x, name: name });
    } catch (e) {
      if (e && e.plcCancel) { cancelledAt = st.i; break; }
      failed.push({ x: x, name: name, why: e && e.message && !e.name ? e.message : describeFsError(e) });
      st.bytes += x.size;
    }
  }
  // プレイリストのファイル（.m3u8。曲はコピー先のフォルダの中の相対パス＝ファイル名）
  var m3uErr = '';
  if (opts.m3u && m3u.length) {
    try {
      m3uName = plcSafeName(folderName + '.m3u8');
      if (await entryExists(dir, m3uName)) m3uName = opts.dup === 'skip' ? '' : await _plcFreeName(dir, m3uName);
      if (m3uName) {
        var text = '#EXTM3U\n#PLAYLIST:' + p.name + '\n' + m3u.map(function (m) {
          var t = m.x.t; return '#EXTINF:' + Math.round(t.duration || -1) + ',' + (t.artist ? t.artist + ' - ' : '') + (t.title || t.name) + '\n' + m.name;
        }).join('\n') + '\n';
        var mh = await dir.getFileHandle(m3uName, { create: true }), mw = await mh.createWritable();
        await mw.write(new Blob([text], { type: 'audio/x-mpegurl' })); await mw.close();
      } else m3uErr = '同じ名前のプレイリストのファイルがあるため作りませんでした';
    } catch (e) { m3uErr = describeFsError(e); m3uName = ''; }
  }
  st.done = true;
  closeDialog('stop');
  await dlg;
  // 3. コピーの結果
  var notDone = cancelledAt >= 0 ? items.slice(cancelledAt) : [];
  var li = function (list, f) { return '<ul class="plc-list">' + list.slice(0, 200).map(f).join('') + (list.length > 200 ? '<li>ほか ' + (list.length - 200) + '曲</li>' : '') + '</ul>'; };
  var title = function (x) { return escapeHtml(x.t ? (x.t.title || x.t.name) : trackDisplayTitle(x.path)); };
  var msg = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'コピーの結果\', event)" title="クリックで「コピーの結果」をコピー">□</span>' +
    '<p>コピー先：' + escapeHtml(dest.name) + ' ／ ' + escapeHtml(folderName) + '</p>' +
    (cancelledAt >= 0 ? '<p class="plc-warn">途中で中止しました（' + notDone.length + '曲はコピーしていません。作りかけのファイルは残していません）。</p>' : '') +
    '<h3 class="plc-h">コピーできた曲：' + copied.length + '曲</h3>' + (copied.length ? li(copied, function (c) { return '<li>' + escapeHtml(c.name) + '</li>'; }) : '') +
    '<h3 class="plc-h">飛ばした曲：' + skipped.length + '曲</h3>' + (skipped.length ? li(skipped, function (c) { return '<li>' + escapeHtml(c.name) + '：' + escapeHtml(c.why) + '</li>'; }) : '') +
    '<h3 class="plc-h">失敗した曲：' + failed.length + '曲</h3>' + (failed.length ? li(failed, function (c) { return '<li class="text-warn">' + c.x.no + '. ' + title(c.x) + '：' + escapeHtml(c.why) + '</li>'; }) : '') +
    (opts.m3u ? '<p class="dialog-hint">プレイリストのファイル：' + (m3uName ? escapeHtml(m3uName) + '（' + m3u.length + '曲）' : escapeHtml(m3uErr || '曲が無いため作りませんでした')) + '</p>' : '');
  await showAlert({ title: 'フォルダにコピーの結果', message: msg, size: 'large' });
}

// プレイリストの曲の見出しのボタン（07-playlists.js の detail の click とは別に受ける）
(function () {
  var d = document.getElementById('pl-detail');
  if (!d) return;
  d.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-act="copy-folder"]');
    if (!b || b.disabled) return;
    copyPlaylistToFolder(ui.lastPlaylistId);
  });
})();

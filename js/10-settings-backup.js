/* =========================================================
   10-settings-backup.js ― 「設定・バックアップ」画面
   ・音楽フォルダ設定：接続状態・フォルダの選び直し・再接続・読み直し・曲情報の読み直し
   ・バックアップ・復元：db（プレイリスト・操作履歴・設定）を JSON で書き出し／読み込み
   ・保存容量：53-storage-usage.js（v8.2。保存容量の使用状況・キャッシュの削除）
   ========================================================= */

PAGE_RENDERERS.settings = renderSettingsPage;

function renderSettingsPage() {
  applyUiLabelSetting();
  renderSetFolder();
  if (typeof renderSetMemo === 'function') renderSetMemo();   // 情報のメモファイル（v2.7）
  if (typeof renderSetHiddenAlbums === 'function') renderSetHiddenAlbums();   // 非表示のアルバム（v3.0）
  if (typeof renderSetPinnedAlbums === 'function') renderSetPinnedAlbums();   // Pin のアルバム（v3.4）
  if (typeof renderSetPinnedArtists === 'function') renderSetPinnedArtists();   // Pin のアーティスト（v3.9）
  if (typeof renderSetAlbumTags === 'function') renderSetAlbumTags();   // タグの設定（v4.4）
  if (typeof renderSetArtistCopy === 'function') renderSetArtistCopy();   // アーティスト名のコピー（スマホ版 v8.12.5）
  if (typeof renderSetGenreSuggest === 'function') renderSetGenreSuggest();   // ジャンルの候補（v4.5）
  if (typeof renderSetWestern === 'function') renderSetWestern();   // Western music の設定（v5.0）
  if (typeof renderSetSeasons === 'function') renderSetSeasons();   // Seasons Song の設定（v7.4）
  if (typeof renderSetNpBg === 'function') renderSetNpBg();   // 再生画面の背景（スマホ版 v8.14.0。81-np-bg.js）
  renderSetBackupMeta();
  renderSetStorage();
  if (typeof renderTagBackupInfo === 'function') renderTagBackupInfo();   // タグ編集前の控え（17-tag-edit.js）
}

// 復元前の比較表の「アーティスト名の自動コピー」の文字（スマホ版 v8.12.5）。例「ソートキー ON・タグ OFF」
function _artistCopyOnOffText(s) {
  s = s || {};
  return 'ソートキー ' + (s.artistCopySortKey ? 'ON' : 'OFF') + '・タグ ' + (s.artistCopyTag ? 'ON' : 'OFF');
}

/* ---------- 音楽フォルダ設定 ---------- */
function renderSetFolder() {
  var el = document.getElementById('set-folder');
  if (!el) return;
  var stateText = {
    none: '<span class="conn-dot dot-off"></span>未接続',
    prompt: '<span class="conn-dot dot-wait"></span>許可待ち（「再接続」を押してください）',
    granted: '<span class="conn-dot dot-on"></span>接続中',
    unsupported: '<span class="conn-dot dot-off"></span>このブラウザは非対応（Chrome / Edge で開いてください）'
  }[fsa.state] || '';
  var h = '<dl class="set-dl">' +
    '<dt>状態</dt><dd class="set-state">' + stateText + '</dd>' +
    '<dt>音楽フォルダ</dt><dd>' + (fsa.folderName ? escapeHtml(fsa.folderName) : '（まだ選ばれていません）') + '</dd>';
  if (isConnected()) {
    h += '<dt>曲の数</dt><dd>' + library.tracks.length + '曲（フォルダ ' + Math.max(0, library.folders.length - 1) + '個）</dd>' +
      '<dt>削除フォルダ</dt><dd>' + library.trashFiles + ' ファイル</dd>';
  }
  // 最終読み込み（v2.6）：最後に読み込みを終えた日時・曲数・アルバム数・かかった時間・読めなかった曲
  if (typeof lastLoadHtml === 'function' && fsa.root) {
    h += '<dt>最終読み込み</dt><dd class="last-load" id="set-last-load">' + lastLoadHtml() +
      '<span class="ui-label-tag" style="position:static;margin-left:6px" onclick="copyUiLabel(\'最終読み込み\', event)" title="クリックで「最終読み込み」をコピー">□</span></dd>' +
      '<dt>最終の全確認</dt><dd id="set-last-full">' + lastFullCheckHtml() +
      '<span class="ui-label-tag" style="position:static;margin-left:6px" onclick="copyUiLabel(\'最終の全確認\', event)" title="クリックで「最終の全確認」をコピー">□</span></dd>';
  }
  h += '</dl><div class="btn-row">';
  if (fsa.supported) {
    if (fsa.state === 'prompt') h += '<button class="btn-save" onclick="reconnectMusicFolder()">' + ICONS.link + '再接続</button>';
    h += '<button class="' + (fsa.root ? 'btn-cancel' : 'btn-save') + '" onclick="pickMusicFolder()">' + ICONS.folder + (fsa.root ? '音楽フォルダを選び直す' : '音楽フォルダを選ぶ') + '</button>';
    if (isConnected()) {
      h += '<button class="btn-cancel" data-rescan onclick="rescanLibraryFromUi()">' + ICONS.refresh + '読み直す</button>' +
        '<button class="btn-cancel" data-rescan onclick="runFullCheck()">' + ICONS.refresh + '全曲をきちんと確認</button>' +
        '<button class="btn-cancel" data-rescan onclick="rereadAllTags()">' + ICONS.refresh + '曲情報を読み直す</button>';
    }
  }
  h += '</div>' + (fsa.root ? _loadSettingsHtml() : '') +
    (typeof musicFolderWinPathHtml === 'function' ? musicFolderWinPathHtml() : '') +   // 音楽フォルダの場所（v4.8）
    '<p class="panel-desc">フォルダの場所はこのブラウザに記憶されます。ブラウザを開き直したときは、サイドバーの接続状態の「再接続」を押してください。<br>' +
    '曲一覧の表示・再生ではファイルを読むだけで、書き換えません。ファイル整理を実行するときだけ、ブラウザが書き込みの許可を求めます。</p>';
  el.innerHTML = h;
}

// 読み込みの設定（v2.7）：高速モード・全確認の間隔（音楽フォルダ設定の中）
function _loadSettingsHtml() {
  var days = +db.settings.fullCheckDays;
  return '<div class="load-settings"><span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:4px" onclick="copyUiLabel(\'読み込みの設定\', event)" title="クリックで「読み込みの設定」をコピー">□</span>' +
    '<label class="tagedit-write"><input type="checkbox" ' + (db.settings.fastMode !== false ? 'checked ' : '') + 'onchange="setFastMode(this.checked)">高速モード（おすすめ）</label>' +
    '<label class="load-days">全曲をきちんと確認する間隔：<select onchange="setFullCheckDays(this.value)">' +
      [[1, '1日'], [3, '3日'], [7, '7日'], [14, '14日'], [30, '30日'], [0, '自動ではしない']].map(function (o) {
        return '<option value="' + o[0] + '"' + (days === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
    '<p class="panel-desc">高速モードでは、起動・「読み直す」のとき、フォルダの中の曲の名前だけを見て、増えた曲の曲情報だけを読みます（今までの曲はファイルを開きません）。' +
    '<br><strong>アプリの外（iTunes など）で曲名などのタグだけを変えた曲は、「全曲をきちんと確認」するまで反映されません。</strong>このアプリで変えた曲（曲情報の編集・ファイル整理・ジャケットの設定）は、その場で反映されます。' +
    '<br>「全曲をきちんと確認」は、全曲の大きさ・更新日時を確かめて、変わった曲だけ読み直します。上の間隔がたつと、次の起動・読み直すのときに自動で行います。高速モードをオフにすると毎回行います。</p></div>';
}
function setFastMode(on) { db.settings.fastMode = !!on; saveDB(); renderSetFolder(); }
function setFullCheckDays(v) { db.settings.fullCheckDays = Math.max(0, parseInt(v, 10) || 0); saveDB(); renderSetFolder(); }

// 曲情報の控えを消して、タグを全部読み直す
async function rereadAllTags() {
  if (isLibraryLoading()) { showToast('読み込み中です。終わってから、もう一度押してください。'); return; }
  var ok = await showConfirm({
    title: '曲情報を読み直す',
    message: '保存してある曲情報の控えを消して、すべての曲のタグ（曲名・アーティスト・アルバム・ジャンル・発売年・長さなど）を読み直します。<br>曲が多いと少し時間がかかります。音楽ファイルは変更しません。',
    okText: '読み直す'
  });
  if (!ok) return;
  if (isLibraryLoading()) return;   // 確認の間に始まっていた
  clearTagCache();
  // メモファイルは使わず、大きさ・更新日時が同じ曲も必ずタグを読み直す（v3.2）
  await scanLibrary({ full: true, noMemo: true, force: true });   // 進み具合は「読み込みの進み具合」に出て、終わったら「読み込み完了」
}

/* ---------- バックアップ（書き出し） ---------- */
function _backupStamp() {
  var d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
}
async function exportBackup() {
  // v8.2：プレイリストなどの保存場所を開けていないとき、中身が空のバックアップになるので確かめる
  if (typeof dbStore !== 'undefined' && dbStore.mode === 'broken') {
    var go = await showConfirm({ title: 'バックアップの書き出し', danger: true, okText: 'それでも書き出す',
      message: 'プレイリスト・操作履歴などを読み込めていないため、それらが空のバックアップになります。<br>ページを開き直してから書き出すことをおすすめします。' });
    if (!go) return;
  }
  db.settings.lastBackupAt = nowIso();
  saveDB();
  // 再生画面の背景の「自分の画像」（スマホ版 v8.14.0。81-np-bg.js。IndexedDB にあるので JSON に入れる。無ければ入れない）
  var npBgImage = typeof npBgBackupData === 'function' ? await npBgBackupData() : null;
  var payload = {
    app: 'music-manager',
    format: 1,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    musicFolderName: fsa.folderName || db.settings.musicFolderName || '',
    data: db
  };
  if (npBgImage) payload.npBgImage = npBgImage;
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'music-manager-backup-' + _backupStamp() + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  renderSetBackupMeta();
  showToast('バックアップを書き出しました（ダウンロードフォルダを確認してください）');
}
function renderSetBackupMeta() {
  var el = document.getElementById('set-backup-meta');
  if (!el) return;
  el.textContent = '今のデータ：プレイリスト ' + db.playlists.length + '件 ・ 操作履歴 ' + db.history.length + '件' +
    (db.settings.lastBackupAt ? '　／　最後のバックアップ：' + formatDateTime(db.settings.lastBackupAt) : '　／　まだバックアップしていません');
}

/* ---------- 復元（読み込み） ---------- */
async function onRestoreFileChosen(input) {
  var f = input.files && input.files[0];
  input.value = '';   // 同じファイルをもう一度選べるように
  if (!f) return;
  var obj;
  try { obj = JSON.parse(await f.text()); }
  catch (e) { await showAlert({ title: '復元できません', message: 'ファイルを読み込めませんでした（JSON ファイルではないようです）。今のデータはそのままです。' }); return; }

  // 形のチェック：Music Manager のバックアップか
  var data = null;
  if (obj && obj.app === 'music-manager' && obj.data && typeof obj.data === 'object') data = obj.data;
  else if (obj && Array.isArray(obj.playlists)) data = obj;   // db をそのまま保存したファイルにも対応
  if (!data || !Array.isArray(data.playlists)) {
    await showAlert({ title: '復元できません', message: 'このファイルは Music Manager のバックアップではないようです。今のデータはそのままです。' });
    return;
  }
  var next = normalizeDB(data);
  var v = await openDialog({
    title: 'バックアップから復元',
    size: 'small',
    body: '<div class="dialog-message">今のデータは、バックアップの内容で<strong>上書き</strong>されます。</div>' +
      '<table class="kv-table">' +
      '<tr><th></th><th>今のデータ</th><th>バックアップ</th></tr>' +
      '<tr><td>プレイリスト</td><td>' + db.playlists.length + '件</td><td>' + next.playlists.length + '件</td></tr>' +
      '<tr><td>操作履歴</td><td>' + db.history.length + '件</td><td>' + next.history.length + '件</td></tr>' +
      '<tr><td>アルバムのカスタム順</td><td>' + (db.albumOrder || []).length + '枚分</td><td>' + next.albumOrder.length + '枚分</td></tr>' +
      '<tr><td>入力した歌詞</td><td>' + Object.keys(db.lyrics || {}).length + '曲分</td><td>' + Object.keys(next.lyrics).length + '曲分</td></tr>' +
      '<tr><td>再生回数の記録</td><td>' + Object.keys(db.playStats || {}).length + '曲分</td><td>' + Object.keys(next.playStats).length + '曲分</td></tr>' +
      '<tr><td>アプリ内の曲情報の上書き</td><td>' + Object.keys(db.tagOverrides || {}).length + '曲分</td><td>' + Object.keys(next.tagOverrides).length + '曲分</td></tr>' +
      '<tr><td>非表示のアルバム</td><td>' + (db.hiddenAlbums || []).length + '枚</td><td>' + next.hiddenAlbums.length + '枚</td></tr>' +
      '<tr><td>Pin したアルバム</td><td>' + (db.pinnedAlbums || []).length + '枚</td><td>' + next.pinnedAlbums.length + '枚</td></tr>' +
      '<tr><td>Western music の設定</td><td>' + ({ tags: 'ソートキー', sortkey: 'ソートキー', chars: '文字', both: '両方' })[db.westernMethod || 'sortkey'] + '・指定 ' + (Object.keys(db.westernAlbums || {}).length + Object.keys(db.westernArtists || {}).length) + '件</td><td>' + ({ tags: 'ソートキー', sortkey: 'ソートキー', chars: '文字', both: '両方' })[next.westernMethod || 'sortkey'] + '・指定 ' + (Object.keys(next.westernAlbums || {}).length + Object.keys(next.westernArtists || {}).length) + '件</td></tr>' +
      '<tr><td>重複ではない の印</td><td>' + (db.dupIgnore || []).length + '件</td><td>' + (next.dupIgnore || []).length + '件</td></tr>' +
      '<tr><td>ジャンルの候補</td><td>' + (Array.isArray(db.genreSuggest) ? db.genreSuggest.length + '個' : '自動') + '</td><td>' + (Array.isArray(next.genreSuggest) ? next.genreSuggest.length + '個' : '自動（音楽フォルダから作る）') + '</td></tr>' +
      '<tr><td>アルバムのタグ</td><td>' + (db.albumTags || []).length + '個・' + Object.keys(db.albumTagOf || {}).length + '枚に付与</td><td>' + (next.albumTags || []).length + '個・' + Object.keys(next.albumTagOf || {}).length + '枚に付与</td></tr>' +
      '<tr><td>アルバムのソートキー</td><td>' + Object.keys(db.albumSortKeys || {}).length + '枚分</td><td>' + Object.keys(next.albumSortKeys || {}).length + '枚分</td></tr>' +
      '<tr><td>upbeat music（手で入れた BPM・基準）</td><td>' + Object.keys(db.bpmManual || {}).length + '曲・' + (db.settings.upbeatMin || 140) + '以上</td><td>' + Object.keys(next.bpmManual || {}).length + '曲・' + ((next.settings && next.settings.upbeatMin) || 140) + '以上</td></tr>' +
      '<tr><td>Seasons Song（手で決めた季節）</td><td>' + Object.keys(db.seasonOverride || {}).length + '曲' + (db.seasonWords ? '・言葉を変更' : '') + '</td><td>' + Object.keys(next.seasonOverride || {}).length + '曲' + (next.seasonWords ? '・言葉を変更' : '') + '</td></tr>' +
      '<tr><td>Seasons Song（非表示にした曲）</td><td>' + Object.keys(db.seasonHidden || {}).length + '曲</td><td>' + Object.keys(next.seasonHidden || {}).length + '曲</td></tr>' +   // v8.13.0
      '<tr><td>ソートキーの枠の代表ジャケット</td><td>' + Object.keys(db.skCovers || {}).length + '件</td><td>' + Object.keys(next.skCovers || {}).length + '件</td></tr>' +
      '<tr><td>Pin したアーティスト</td><td>' + (db.pinnedArtists || []).length + '人</td><td>' + next.pinnedArtists.length + '人</td></tr>' +
      // アーティスト名の自動コピー（スマホ版 v8.12.5。79-artist-copy.js）：ソートキー／タグ の ON/OFF
      '<tr><td>アーティスト名の自動コピー</td><td>' + _artistCopyOnOffText(db.settings) + '</td><td>' + _artistCopyOnOffText(next.settings) + '</td></tr>' +
      // 再生画面の背景（スマホ版 v8.14.0。81-np-bg.js）：背景の種類・覆いの濃さ・自分の画像。古いバックアップに無ければ「なし」、画像が無ければ今の画像はそのまま
      (typeof npBgSummary === 'function' ? '<tr><td>再生画面の背景</td><td>' + npBgSummary(db.settings) + (npBgHasImage() ? '・自分の画像あり' : '') + '</td><td>' + npBgSummary(next.settings) +
        (npBgBackupHasImage(obj) ? '・自分の画像あり' : (npBgHasImage() ? '（画像は入っていないので今の画像のまま）' : '')) + '</td></tr>' : '') +
      '<tr><td>書き出した日時</td><td>—</td><td>' + (obj.exportedAt ? formatDateTime(obj.exportedAt) : '不明') + '</td></tr>' +
      '<tr><td>音楽フォルダ</td><td>' + escapeHtml(fsa.folderName || '—') + '</td><td>' + escapeHtml(obj.musicFolderName || '不明') + '</td></tr>' +
      '</table>' +
      '<p class="dialog-hint">音楽ファイル自体は変わりません。心配なときは「今のデータを書き出してから復元」を選ぶと、今のデータも JSON で保存してから復元します。</p>',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: '今のデータを書き出してから復元', value: 'backup-first', cls: 'btn-cancel' },
      { label: '復元する', value: 'ok', cls: 'btn-danger', isDefault: true }
    ]
  });
  if (v !== 'ok' && v !== 'backup-first') return;
  if (v === 'backup-first') await exportBackup();

  // 復元前のデータを控え、保存に失敗したら元に戻す（ロールバック）
  // v8.2：基本の設定（localStorage）とプレイリスト・操作履歴など（IndexedDB）の両方に書けたときだけ復元したことにする（52-data-store.js）
  if (typeof dbStoreReplaceAll === 'function') {
    var okSave = await dbStoreReplaceAll(next);
    if (!okSave) {
      var er = dbStore.lastError;
      await showAlert({ title: '復元に失敗しました', message: '保存できませんでした' + (er && typeof isQuotaError === 'function' && isQuotaError(er) ? '（ブラウザの保存容量が足りません）' : (er && er.message ? '（' + escapeHtml(er.message) + '）' : '')) + '。元のデータは保持されています。' });
      return;
    }
  } else {
    var snapshot = JSON.stringify(db);
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(next));
      db = next;
    } catch (e) {
      console.error('復元の保存に失敗', e);
      db = JSON.parse(snapshot);
      try { localStorage.setItem(DB_KEY, snapshot); } catch (e2) { /* 元のデータはメモリ上に残っている */ }
      await showAlert({ title: '復元に失敗しました', message: '保存できませんでした（ブラウザの保存容量が足りない可能性があります）。元のデータは保持されています。' });
      return;
    }
  }
  // 設定を画面に反映
  if (player.audio) {
    player.audio.volume = Math.min(1, Math.max(0, Number(db.settings.volume) || 0.8));
    document.getElementById('pb-volume').value = Math.round(player.audio.volume * 100);
  }
  ui.lastPlaylistId = db.playlists.length ? db.playlists[0].id : null; saveUi();
  renderAll();
  if (typeof lyricsReload === 'function') lyricsReload();   // 入力した歌詞が変わったかもしれないので表示し直す
  // アプリ内の曲情報の上書きが変わったかもしれないので、曲の表示を作り直す
  library.tracks.forEach(function (t) {
    var c = tagCache[t.path];
    if (c && c.v === TAG_CACHE_VERSION) applyCacheToTrack(t, c); else { t.tagTitle = ''; t.tagArtist = ''; t.tagAlbum = ''; t.tagAlbumArtist = ''; }
    fillDisplayFields(t);
  });
  if (typeof migrateAlbumKeys === 'function') migrateAlbumKeys();   // 古いバックアップのカスタム順などの目印を今のまとめ方に（v2.9）
  if (typeof npBgAfterRestore === 'function') await npBgAfterRestore(obj);   // 再生画面の背景（自分の画像を入れ替えて表示を合わせる。スマホ版 v8.14.0）
  renderAll();
  showToast('バックアップから復元しました（プレイリスト ' + db.playlists.length + '件）');
}

/* ---------- 保存容量 ----------
   v8.2 から「保存容量の使用状況」として 53-storage-usage.js の renderSetStorage() に移した */

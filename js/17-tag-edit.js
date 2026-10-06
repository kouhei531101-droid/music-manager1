/* =========================================================
   17-tag-edit.js ― 曲情報の編集（曲名・アーティスト・アルバム・アルバムアーティスト）
   ・入口：曲一覧の編集ボタン（鉛筆）・選択操作バーの「まとめて編集」、
          アルバムの見出しの「アルバム情報を編集」・アルバムの曲リストの編集ボタン
   ・ダイアログ：曲情報の編集ダイアログ／まとめて編集ダイアログ／アルバム情報の編集ダイアログ（曲名の一覧付き）
   ・「音楽ファイルのタグにも書き込む」を選んだとき（mp3・m4a・flac）：
       ① 元のファイルを「タグ編集前の控え」へコピー（元のフォルダ構成のまま・日時付きの名前）
       ② 新しい内容を一時ファイルに書く → ③ 読み直して、タグ・音声データ・ほかのタグを確かめる
       ④ 確かめられたときだけ元のファイルを置き換え（置き換え後も読み直して確かめる）
     失敗したら元のファイルには触らず、エラーを表示する
   ・書き込まない／書けない形式（ogg・wav など）は、アプリ内の上書き表示（db.tagOverrides）で変える
   ・操作履歴に「タグの編集」として残し、「直前の操作を元に戻す」で控えから戻せる
   ========================================================= */

var TAG_ITUNES_NOTE = '※ iTunes で管理している曲は、iTunes 側の表示がすぐには変わらないことがあります。';

/* ---------- 今の値 ---------- */
function currentTagValues(t) {
  return { title: t.tagTitle || '', artist: t.tagArtist || '', album: t.tagAlbum || '', albumArtist: t.tagAlbumArtist || '',
           genre: t.tagGenre || '', year: t.tagYear ? String(t.tagYear) : '' };   // genre・year は v3.2
}
// ジャンルの候補（v3.2）：音楽フォルダの曲にあるジャンル（多い順）＋よく使うもの
var GENRE_SUGGEST = ['J-Pop', 'Pop', 'Rock', 'Anime', 'Soundtrack', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop', 'R&B', 'K-Pop', 'Dance', 'Folk', 'Metal', 'Instrumental', 'Game'];
// ジャンル欄の候補（v4.5 から tools の「ジャンルの候補」の並び順。32-genre-suggest.js）
function _genreDatalistHtml() {
  var list = typeof genreSuggestList === 'function' ? genreSuggestList() : GENRE_SUGGEST;
  return '<datalist id="te-genre-list">' + list.map(function (g) { return '<option value="' + escapeHtml(g) + '">'; }).join('') + '</datalist>';
}
// 発売年の入力チェック（v3.2）：空欄か、4桁の数字だけ
function _yearInputError(b, ids) {
  for (var i = 0; i < ids.length; i++) {
    var el = b.querySelector('#' + ids[i]);
    if (el && el.value.trim() && !/^\d{4}$/.test(el.value.trim())) { el.focus(); return '発売年は4桁の数字（例：2019）で入力してください。'; }
  }
  return '';
}
function _kindLabel(t) {
  var k = tagWriteKind(t.ext);
  return t.ext.toUpperCase() + (k ? '（ファイルに書き込めます）' : '（ファイルには安全に書き込めない形式のため、アプリ内の表示だけを変えます）');
}
function _fieldsHtml(values, placeholders, idPrefix) {
  return TAG_FIELDS.map(function (f) {
    // ジャンルは候補から選べる、発売年は4桁の数字（v3.2）
    var extra = f === 'genre' ? ' list="te-genre-list"' : f === 'year' ? ' inputmode="numeric" maxlength="4"' : '';
    return '<div class="form-group' + (f === 'genre' || f === 'year' ? ' form-group-half' : '') + '"><label for="' + idPrefix + f + '">' + TAG_FIELD_LABELS[f] + '</label>' +
      '<input type="text" class="form-input dialog-enter" id="' + idPrefix + f + '" value="' + escapeHtml(values[f] || '') + '"' +
      (placeholders && placeholders[f] ? ' placeholder="' + escapeHtml(placeholders[f]) + '"' : '') + extra + ' autocomplete="off"></div>';
  }).join('') + _genreDatalistHtml();
}
function _writeOptionHtml(anyWritable, anyUnwritable) {
  var checked = anyWritable && ui.tagWriteToFile !== false;   // 書き込める曲が無いときは外した状態で表示
  return '<label class="tagedit-write"><input type="checkbox" id="te-write"' + (checked ? ' checked' : '') + (anyWritable ? '' : ' disabled') + '>' +
      '音楽ファイルのタグにも書き込む</label>' +
    '<p class="dialog-hint">' + (anyWritable
      ? '書き込む前に元のファイルを音楽フォルダ直下の「' + TAG_BACKUP_FOLDER_NAME + '」へコピーし、書き込んだ結果を確かめてから置き換えます（ジャケット画像・歌詞・トラック番号などほかのタグと音声はそのまま）。チェックを外すと、アプリ内の表示だけを変えます（バックアップに含まれます）。'
      : 'この形式はファイルに安全に書き込めないため、アプリ内の表示だけを変えます（バックアップに含まれます）。') +
    (anyWritable && anyUnwritable ? '<br>ogg・wav など書き込めない形式の曲は、アプリ内の表示だけを変えます。' : '') + '</p>' +
    '<p class="dialog-hint tagedit-itunes">' + TAG_ITUNES_NOTE + '</p>';
}

/* ---------- 曲情報の編集ダイアログ（1曲） ---------- */
async function openTrackTagEditor(path) {
  var t = library.byPath[path];
  if (!t) { showToast('曲が見つかりません。', true); return; }
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var cur = currentTagValues(t);
  var ov = db.tagOverrides[path];
  var body =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'曲情報の編集ダイアログ\', event)" title="クリックで「曲情報の編集ダイアログ」をコピー">□</span>' +
    '<div class="tagedit-file">' + ICONS.file + '<span>' + escapeHtml(path) + '</span><span class="tagedit-kind">' + escapeHtml(_kindLabel(t)) + '</span></div>' +
    (ov ? '<p class="tagedit-override-note">この曲は、アプリ内で上書きした曲情報を表示しています（' + Object.keys(ov).map(function (f) { return TAG_FIELD_LABELS[f]; }).join('・') + '）。</p>' : '') +
    '<div class="tagedit-art"><span class="art-thumb" id="te-art-thumb">' + ICONS.music + '</span>' +
      '<div class="tagedit-art-text"><div class="tagedit-art-label">ジャケット</div>' +
      '<button type="button" class="btn-inline-small" data-dialog-value="artwork">' + ICONS.image + 'ジャケットを設定…</button></div></div>' +
    _fieldsHtml(cur, { title: t.titleGuessed ? t.title + '（ファイル名から推定）' : '' }, 'te-') +
    _writeOptionHtml(!!tagWriteKind(t.ext), !tagWriteKind(t.ext)) +
    '<div class="dialog-error" id="te-error"></div>';
  var result = null;
  var buttons = [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }];
  if (ov) buttons.push({ label: 'アプリ内の上書きを消す', value: 'clear-override', cls: 'btn-cancel btn-cancel-danger' });
  buttons.push({ label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true });
  artLoadForTrack(t).then(function (res) { var el = document.getElementById('te-art-thumb'); if (el && res && res.url) el.innerHTML = '<img src="' + res.url + '" alt="">'; });
  var v = await openDialog({
    title: '曲情報の編集', body: body, size: 'small', buttons: buttons,
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var ch = {};
      var ye = _yearInputError(b, ['te-year']);
      if (ye) { b.querySelector('#te-error').textContent = ye; return false; }
      TAG_FIELDS.forEach(function (f) { var x = b.querySelector('#te-' + f).value.trim(); if (x !== cur[f]) ch[f] = x; });
      if (!Object.keys(ch).length) { b.querySelector('#te-error').textContent = '変更がありません。'; return false; }
      result = { changes: ch, write: !!(b.querySelector('#te-write') || {}).checked };
      return true;
    }
  });
  if (v === 'clear-override') { await clearTagOverride(path); return; }
  if (v === 'artwork') { await openArtworkEditor([t], '曲「' + t.title + '」'); return; }   // ジャケットの設定ダイアログへ
  if (v !== 'ok' || !result) return;
  _rememberWriteChoice(result.write, t);
  await runTagEdit([{ path: path, changes: result.changes }], result.write);
}
function _rememberWriteChoice(write, t) {
  if (!t || tagWriteKind(t.ext)) { ui.tagWriteToFile = write; saveUi(); }
}

/* ---------- まとめて編集ダイアログ（複数曲・空欄は変更しない） ---------- */
async function openBulkTagEditor(paths) {
  var tracks = paths.map(function (p) { return library.byPath[p]; }).filter(Boolean);
  if (!tracks.length) return;
  if (tracks.length === 1) return openTrackTagEditor(tracks[0].path);
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var ph = {};
  TAG_FIELDS.forEach(function (f) {
    var vals = tracks.map(function (t) { return currentTagValues(t)[f]; });
    var same = vals.every(function (x) { return x === vals[0]; });
    ph[f] = '変更しない（今：' + (same ? (vals[0] || '空欄') : '曲ごとに違います') + '）';
  });
  var nW = tracks.filter(function (t) { return tagWriteKind(t.ext); }).length;
  var body =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'曲情報の編集ダイアログ\', event)" title="クリックで「曲情報の編集ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">' + tracks.length + '曲の曲情報をまとめて変えます。<strong>入力した項目だけ</strong>をすべての曲に適用し、空欄の項目は変更しません。</p>' +
    '<div class="tagedit-art"><span class="art-thumb" id="te-art-thumb">' + ICONS.music + '</span>' +
      '<div class="tagedit-art-text"><div class="tagedit-art-label">ジャケット</div>' +
      '<button type="button" class="btn-inline-small" data-dialog-value="artwork">' + ICONS.image + '選んだ曲のジャケットを設定…</button></div></div>' +
    _fieldsHtml({}, ph, 'te-') +
    _writeOptionHtml(nW > 0, nW < tracks.length) +
    '<div class="dialog-error" id="te-error"></div>';
  var result = null;
  artLoadForTrack(tracks[0]).then(function (res) { var el = document.getElementById('te-art-thumb'); if (el && res && res.url) el.innerHTML = '<img src="' + res.url + '" alt="">'; });
  var v = await openDialog({
    title: '曲情報をまとめて編集', body: body, size: 'small',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true }],
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var ch = {};
      var ye = _yearInputError(b, ['te-year']);
      if (ye) { b.querySelector('#te-error').textContent = ye; return false; }
      TAG_FIELDS.forEach(function (f) { var x = b.querySelector('#te-' + f).value.trim(); if (x) ch[f] = x; });
      if (!Object.keys(ch).length) { b.querySelector('#te-error').textContent = '変更する項目を入力してください（空欄の項目は変更しません）。'; return false; }
      result = { changes: ch, write: !!(b.querySelector('#te-write') || {}).checked };
      return true;
    }
  });
  if (v === 'artwork') { await openArtworkEditor(tracks, '選んだ曲'); return; }   // ジャケットの設定ダイアログへ
  if (v !== 'ok' || !result) return;
  if (nW) { ui.tagWriteToFile = result.write; saveUi(); }
  await runTagEdit(tracks.map(function (t) { return { path: t.path, changes: result.changes }; }), result.write);
}

/* ---------- アルバム情報の編集ダイアログ ----------
   アルバム名・アルバムアーティスト（全曲に適用）と、曲名の一覧（曲順に、曲ごとの曲名・アーティスト）をまとめて編集する。
   開いたときの値から変えた項目だけを、その曲に適用する（変更のない曲は書き込まない） */
function _albumTrackNo(a, t) {
  var o = albumTrackOrder(t);
  return o.has ? (a.multiDisc ? o.disc + '-' + pad2(o.track) : String(o.track)) : '—';
}
async function openAlbumTagEditor(a) {
  if (!a || !a.tracks.length) return;
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  var init = { album: a.byFolder ? '' : a.name, albumArtist: a.albumArtist || '' };
  // ジャンル・発売年（v3.2）：全曲が同じならその値、曲ごとに違えば空欄で「（曲ごとに異なる）」。空欄のままなら変更しない
  var gyNote = {};
  ['genre', 'year'].forEach(function (f) {
    var vals = a.tracks.map(function (t) { return currentTagValues(t)[f]; });
    var same = vals.every(function (x) { return x === vals[0]; });
    init[f] = same ? vals[0] : '';
    gyNote[f] = same ? (vals[0] ? '' : '（空欄：変更しない）') : '（曲ごとに異なる。空欄なら変更しない）';
  });
  var tracks = a.tracks.slice();   // 曲順
  var initT = tracks.map(function (t) { return { title: t.tagTitle || '', artist: t.tagArtist || '' }; });
  var nW = tracks.filter(function (t) { return tagWriteKind(t.ext); }).length;
  var rows = tracks.map(function (t, i) {
    return '<div class="te-track-row">' +
      '<input type="checkbox" class="te-track-check" data-i="' + i + '" aria-label="' + escapeHtml((i + 1) + '曲目を選ぶ（ファイル削除用）') + '">' +
      '<span class="te-track-no">' + escapeHtml(_albumTrackNo(a, t)) + '</span>' +
      '<input type="text" class="form-input dialog-enter te-track-title" id="te-tt-' + i + '" value="' + escapeHtml(initT[i].title) + '"' +
        (t.titleGuessed ? ' placeholder="' + escapeHtml(t.title + '（ファイル名から推定）') + '"' : '') + ' aria-label="' + escapeHtml((i + 1) + '曲目の曲名') + '" autocomplete="off">' +
      '<input type="text" class="form-input dialog-enter te-track-artist" id="te-ta-' + i + '" value="' + escapeHtml(initT[i].artist) + '"' +
        ' placeholder="アーティスト" aria-label="' + escapeHtml((i + 1) + '曲目のアーティスト') + '" autocomplete="off">' +
      '<span class="te-track-kind" title="' + escapeHtml(_kindLabel(t)) + '">' + escapeHtml(t.ext.toUpperCase()) + '</span>' +
      '</div>';
  }).join('');
  var body =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'アルバム情報の編集ダイアログ\', event)" title="クリックで「アルバム情報の編集ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">アルバム「<strong>' + escapeHtml(a.name) + '</strong>」（' + tracks.length + '曲）の曲情報をまとめて編集します。変えた項目だけを保存し、変更のない曲は書き込みません。</p>' +
    (a.byFolder ? '<p class="dialog-hint">このアルバムは、曲にアルバム名のタグが無いためフォルダでまとめています。アルバム名を入れると、その名前でまとまります。</p>' : '') +
    '<div class="te-album-fields">' +
      '<div class="form-group"><label for="te-album">アルバム名（全曲）</label><input type="text" class="form-input dialog-enter" id="te-album" value="' + escapeHtml(init.album) + '"' + (a.byFolder ? ' placeholder="' + escapeHtml(a.name) + '"' : '') + ' autocomplete="off"></div>' +
      '<div class="form-group"><label for="te-albumArtist">アルバムアーティスト（全曲）</label><input type="text" class="form-input dialog-enter" id="te-albumArtist" value="' + escapeHtml(init.albumArtist) + '" placeholder="（空欄なら曲ごとのアーティストでまとめます）" autocomplete="off">' +
        // コンピレーションにする（v2.9）：アルバムアーティストを Various Artists にすると、どこに置いても1枚にまとまる
        '<button type="button" class="btn-inline-small te-compilation-btn" onclick="document.getElementById(\'te-albumArtist\').value = \'Various Artists\'" title="アルバムアーティストを「Various Artists」にして、曲ごとにアーティストが違うアルバムを1枚にまとめます">コンピレーションにする（Various Artists）</button></div>' +
      // ジャンル・発売年（全曲。v3.2）
      '<div class="form-group"><label for="te-genre">ジャンル（全曲）</label><input type="text" class="form-input dialog-enter" id="te-genre" list="te-genre-list" value="' + escapeHtml(init.genre) + '" placeholder="' + escapeHtml(gyNote.genre || 'ジャンル') + '" autocomplete="off"></div>' +
      '<div class="form-group"><label for="te-year">発売年（全曲）</label><input type="text" class="form-input dialog-enter" id="te-year" inputmode="numeric" maxlength="4" value="' + escapeHtml(init.year) + '" placeholder="' + escapeHtml(gyNote.year || '例：2019') + '" autocomplete="off"></div>' +
      // ソートキー（v4.3）：アプリの中だけ（ファイルには書かない）。空にすると解除
      '<div class="form-group te-sortkey-group"><label for="te-sortkey">ソートキー（アプリ内だけ）</label><input type="text" class="form-input dialog-enter" id="te-sortkey" maxlength="100" value="' + escapeHtml(getAlbumSortKey(a.key)) + '" placeholder="並べ替え用の文字（空欄なら無し）" autocomplete="off">' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:0" onclick="copyUiLabel(\'ソートキー欄\', event)" title="クリックで「ソートキー欄」をコピー">□</span></div>' +
      // タグ（v4.4）：アプリの中だけ。1枚に1つ
      '<div class="form-group te-tag-group"><label>タグ（アプリ内だけ。1つ）</label>' + albumTagChoiceHtml((albumTagOf(a.key) || {}).id || '', 'te-tag') +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:0" onclick="copyUiLabel(\'タグ欄\', event)" title="クリックで「タグ欄」をコピー">□</span></div>' +
      (typeof westernFieldHtml === 'function' ? westernFieldHtml(a) : '') +   // 洋楽の指定欄（v5.0）
      _genreDatalistHtml() +
    '</div>' +
    // 曲名の一覧
    '<div class="te-tracks">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:2px;right:4px" onclick="copyUiLabel(\'曲名の一覧\', event)" title="クリックで「曲名の一覧」をコピー">□</span>' +
      '<div class="te-tracks-title">曲名の一覧（曲順）</div>' +
      '<div class="te-track-row te-track-head"><input type="checkbox" class="te-track-check-all" title="全部選ぶ／外す" aria-label="全部選ぶ／外す"><span class="te-track-no">曲番号</span><span>曲名</span><span>アーティスト</span><span class="te-track-kind"></span></div>' +
      rows +
    '</div>' +
    _writeOptionHtml(nW > 0, nW < tracks.length) +
    '<div class="dialog-error" id="te-error"></div>';
  var result = null;
  var v = await openDialog({
    title: 'アルバム情報の編集', body: body, size: 'large',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: 'ファイル削除', value: 'delete-files', cls: 'btn-cancel btn-cancel-danger' },
      { label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true }
    ],
    onOpen: function (b) {
      var all = b.querySelector('.te-track-check-all');
      all.addEventListener('change', function () { b.querySelectorAll('.te-track-check').forEach(function (c) { c.checked = all.checked; }); });
    },
    beforeClose: function (value, b) {
      if (value === 'delete-files') {   // チェックした曲（無ければアルバムの全曲）を削除フォルダへ
        var picked = [];
        b.querySelectorAll('.te-track-check').forEach(function (c) { if (c.checked) picked.push(tracks[+c.getAttribute('data-i')]); });
        result = { deleteTracks: picked.length ? picked : tracks.slice() };
        return true;
      }
      if (value !== 'ok') return true;
      var albumCh = {};
      var ye = _yearInputError(b, ['te-year']);
      if (ye) { b.querySelector('#te-error').textContent = ye; return false; }
      ['album', 'albumArtist'].forEach(function (f) { var x = b.querySelector('#te-' + f).value.trim(); if (x !== init[f]) albumCh[f] = x; });
      ['genre', 'year'].forEach(function (f) { var x = b.querySelector('#te-' + f).value.trim(); if (x && x !== init[f]) albumCh[f] = x; });   // 空欄は変更しない（v3.2）
      var plan = [];
      tracks.forEach(function (t, i) {
        var ch = Object.assign({}, albumCh);
        var tt = b.querySelector('#te-tt-' + i).value.trim(), ta = b.querySelector('#te-ta-' + i).value.trim();
        if (tt !== initT[i].title) ch.title = tt;
        if (ta !== initT[i].artist) ch.artist = ta;
        if (Object.keys(ch).length) plan.push({ path: t.path, changes: ch });
      });
      var skNew = b.querySelector('#te-sortkey').value.replace(/\s+/g, ' ').trim(), skChanged = skNew !== getAlbumSortKey(a.key);
      var tgEl = b.querySelector('input[name="te-tag"]:checked'), tgNew = tgEl ? tgEl.value : '', tgChanged = tgNew !== ((albumTagOf(a.key) || {}).id || '');
      var wNew = typeof readWesternField === 'function' ? readWesternField(b) : null, wCur = typeof (db.westernAlbums || {})[a.key] === 'boolean' ? db.westernAlbums[a.key] : null, wChanged = wNew !== wCur;
      if (!plan.length && !skChanged && !tgChanged && !wChanged) { b.querySelector('#te-error').textContent = '変更がありません。'; return false; }
      result = { plan: plan, write: !!(b.querySelector('#te-write') || {}).checked, sortKey: skChanged ? skNew : null, tag: tgChanged ? tgNew : null, western: wChanged ? { v: wNew } : null };
      return true;
    }
  });
  if (v === 'delete-files' && result && result.deleteTracks) {
    // ファイル削除：完全には消さず、ファイル整理と同じ仕組みで「削除フォルダ」へ元のフォルダ構成のまま移す
    //（確認ダイアログ・操作履歴・元に戻す。プレイリスト・入力した歌詞・再生回数なども一緒に付け替わり、元に戻すと元どおり）
    // v6.4：アルバムの曲が全部無くなったら、一覧の先頭ではなく、削除したアルバムの隣のアルバムの位置に戻る
    var wasOpen = albView.openKey === a.key, nb = wasOpen && typeof albumListNeighborKey === 'function' ? albumListNeighborKey(a.key) : null;
    await runFileOperation('trash', result.deleteTracks.map(function (t) { return { from: t.path, to: TRASH_FOLDER_NAME + '/' + t.path }; }));
    if (wasOpen && currentPage === 'albums' && !buildAlbums().some(function (x) { return x.key === a.key; })) backToAlbumListNear(nb);
    return;
  }
  if (v !== 'ok' || !result) return;
  // ソートキー（v4.3）：今の目印に先に保存する（アルバム名などを変えて目印が変わったら、runTagEdit の中で付け替わる）
  if (result.sortKey !== null) setAlbumSortKey(a.key, result.sortKey);
  if (result.tag !== null) setAlbumTag(a.key, result.tag);   // タグ（v4.4）
  if (result.western) setWesternAlbum(a.key, result.western.v);   // 洋楽の指定（v5.0）
  if (!result.plan.length) { renderAll(); showToast('アルバムの設定（ソートキー・タグ・洋楽の指定）を変更しました。'); return; }
  if (nW) { ui.tagWriteToFile = result.write; saveUi(); }
  await runTagEdit(result.plan, result.write);
}

/* ---------- 実行 ---------- */
async function runTagEdit(plan, writeToFile) {
  if (fileOps.busy) { showToast('ほかの操作を実行中です。終わってからもう一度お試しください。', true); return; }
  // 曲ごとに、今の値と違う項目だけにする
  var items = [];
  plan.forEach(function (p) {
    var t = library.byPath[p.path];
    if (!t) return;
    var cur = currentTagValues(t), ch = {};
    Object.keys(p.changes).forEach(function (f) { if (p.changes[f] !== cur[f]) ch[f] = p.changes[f]; });
    if (!Object.keys(ch).length) return;
    items.push({ path: p.path, t: t, changes: ch, before: cur, mode: (writeToFile && tagWriteKind(t.ext)) ? 'file' : 'app' });
  });
  if (!items.length) { showToast('変更がありません（すでに同じ内容です）。'); return; }
  var nFile = items.filter(function (i) { return i.mode === 'file'; }).length, nApp = items.length - nFile;
  var rows = [];
  items.forEach(function (i) {
    Object.keys(i.changes).forEach(function (f) {
      rows.push({ from: i.t.name + '　' + TAG_FIELD_LABELS[f] + '「' + (i.before[f] || '空欄') + '」', to: TAG_FIELD_LABELS[f] + '「' + (i.changes[f] || '空欄') + '」' + (i.mode === 'app' ? '（アプリ内）' : '') });
    });
  });
  var unwritable = items.filter(function (i) { return writeToFile && !tagWriteKind(i.t.ext); });
  var ok = await showConfirm({
    title: '曲情報の変更の確認',
    message: '対象：<strong>' + items.length + '曲</strong><br>' +
      '音楽ファイルに書き込む：<strong>' + nFile + '曲</strong>' + (nFile ? '（書き込む前に元のファイルを「' + TAG_BACKUP_FOLDER_NAME + '」フォルダへコピーします）' : '') + '<br>' +
      'アプリ内の表示だけを変える：<strong>' + nApp + '曲</strong>' +
      (unwritable.length ? '<br><span class="dialog-hint">' + unwritable.length + '曲（' + Array.from(new Set(unwritable.map(function (i) { return i.t.ext; }))).join('・') + '）はファイルに安全に書き込めない形式のため、アプリ内の表示だけを変えます。</span>' : '') +
      '<br><span class="dialog-hint">操作履歴に残り、「直前の操作を元に戻す」で戻せます。' + (nFile ? TAG_ITUNES_NOTE : '') + '</span>',
    rows: rows,
    okText: '変更する'
  });
  if (!ok) return;
  if (nFile && !(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: 'ブラウザの確認で「変更を保存」（編集を許可）を選ぶと実行できます。何も変更していません。' });
    return;
  }
  fileOps.busy = true;
  showBusy('曲情報を変更しています…');
  var keysBefore = _albumKeySnapshot();
  var playState = playerReleaseIfAffected(items.filter(function (i) { return i.mode === 'file'; }).map(function (i) { return i.path; }));
  var stamp = _tagStamp(), done = [], failed = [];
  try {
    for (var k = 0; k < items.length; k++) {
      var i = items[k];
      if (items.length > 1) document.getElementById('busy-text').textContent = '曲情報を変更しています…（' + (k + 1) + ' / ' + items.length + '）';
      var label = { from: i.path + '　' + _changeSummary(i.changes, i.before), to: _changeSummary(i.changes, i.changes) + (i.mode === 'app' ? '（アプリ内）' : '') };
      try {
        if (i.mode === 'file') {
          var r = await writeTagsSafely(i.t, i.changes, stamp);
          await _refreshTrackFromFile(i.t);
          _removeOverrideFields(i.path, Object.keys(i.changes));   // ファイルに書いたので、同じ項目のアプリ内の上書きは外す
          done.push({ path: i.path, mode: 'file', backup: r.backupPath, beforeHash: r.beforeHash, afterHash: r.afterHash, changes: i.changes, before: _pick(i.before, i.changes), from: label.from, to: label.to });
        } else {
          var prev = db.tagOverrides[i.path] ? JSON.parse(JSON.stringify(db.tagOverrides[i.path])) : null;
          db.tagOverrides[i.path] = Object.assign({}, db.tagOverrides[i.path] || {}, i.changes);
          _refreshTrackDisplay(i.t);
          done.push({ path: i.path, mode: 'app', prevOverride: prev, changes: i.changes, before: _pick(i.before, i.changes), from: label.from, to: label.to });
        }
      } catch (e) {
        console.error('曲情報の変更に失敗', i.path, e);
        failed.push({ path: i.path, message: (e && e.name === 'TagWriteError') ? e.message : describeFsError(e) });
      }
    }
    if (done.length) {
      _renameAlbumKeysAfter(keysBefore, done.map(function (d) { return d.path; }));
      if (typeof addGenreSuggestFrom === 'function') addGenreSuggestFrom(done);   // 一覧に無いジャンルを候補に足す（v4.5）
      db.history.unshift({ id: newId(), type: 'tagedit', at: nowIso(), items: done, undone: false, undoneAt: '' });
      if (db.history.length > HISTORY_MAX) db.history.length = HISTORY_MAX;
    }
    saveDB();
    saveTagCache();
  } finally {
    fileOps.busy = false;
    hideBusy();
  }
  await playerRestore(playState, {});
  if (typeof lyricsCacheClear === 'function') lyricsCacheClear();
  renderAll();
  if (!failed.length) { showToast('曲情報を変更しました（' + done.length + '曲）。操作履歴に記録しました。'); return; }
  await showAlert({
    title: '一部の曲を変更できませんでした', size: 'large',
    message: '成功：' + done.length + '曲 ／ 失敗：' + failed.length + '曲。失敗した曲のファイルは変更していません。' +
      '<ul class="error-list">' + failed.map(function (f) { return '<li>' + escapeHtml(f.path) + '：' + escapeHtml(f.message) + '</li>'; }).join('') + '</ul>'
  });
}
function _pick(obj, keysObj) { var o = {}; Object.keys(keysObj).forEach(function (k) { o[k] = obj[k]; }); return o; }
function _changeSummary(changes, values) {
  return Object.keys(changes).map(function (f) { return TAG_FIELD_LABELS[f] + '「' + (values[f] || '空欄') + '」'; }).join(' ');
}
function _tagStamp() {
  var d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/* ---------- ファイルへの安全な書き込み ---------- */
async function _writeWhole(fileHandle, bytes) {
  var w = await fileHandle.createWritable();   // ブラウザは別名に書いてから差し替えるので、途中で失敗しても元は残る
  try { await w.write(bytes); await w.close(); }
  catch (e) { try { await w.abort(); } catch (e2) { /* 無視 */ } throw e; }
}
async function _readAll(fileHandle) { return new Uint8Array(await (await fileHandle.getFile()).arrayBuffer()); }

async function writeTagsSafely(t, changes, stamp) {
  var kind = tagWriteKind(t.ext);
  if (!kind) throw _tagErr('この形式にはファイルへ書き込めません');
  var orig = await _readAll(t.handle);
  var beforeHash = await sha256Hex(orig);
  // 新しい内容を作り、まずメモリ上で確かめる（ここで失敗すれば控えも一時ファイルも作らない）
  var built = buildTaggedFile(kind, orig, changes);
  await verifyTaggedFile(kind, orig, built, t.name, changes);
  var builtHash = await sha256Hex(built);
  // ① 元のファイルを控えにコピー
  var backupPath = await _saveTagBackup(t, orig, beforeHash, stamp);
  // ② 一時ファイルに書く
  var dir = await getDirHandleByPath(t.folder, false);
  var tmpName = t.name + '.mm-tagtmp-' + Date.now();
  var tmpHandle = await dir.getFileHandle(tmpName, { create: true });
  try {
    await _writeWhole(tmpHandle, built);
    // ③ 一時ファイルを読み直して確かめる
    var tmpBytes = await _readAll(tmpHandle);
    if (await sha256Hex(tmpBytes) !== builtHash) throw _tagErr('一時ファイルに正しく書けたことを確かめられませんでした');
    await verifyTaggedFile(kind, orig, tmpBytes, t.name, changes);
    // ④ 読み込んだあとで元のファイルが変わっていないか確かめてから置き換える
    if (await sha256Hex(await _readAll(t.handle)) !== beforeHash) throw _tagErr('読み込んだあとで元のファイルが変わりました');
    await _writeWhole(t.handle, tmpBytes);
    if (await sha256Hex(await _readAll(t.handle)) !== builtHash) {
      await _writeWhole(t.handle, orig);   // 念のため元の内容に戻す
      throw _tagErr('置き換えた結果を確かめられなかったため、元の内容に戻しました');
    }
  } finally {
    try { await dir.removeEntry(tmpName); } catch (e) { /* 自分で作った一時ファイルだけを片付ける */ }
  }
  return { backupPath: backupPath, beforeHash: beforeHash, afterHash: builtHash };
}
// タグ編集前の控え：<控えフォルダ>/<元のフォルダ>/<曲名> [編集前 日時].<拡張子>
async function _saveTagBackup(t, orig, hash, stamp) {
  var dotExt = t.name.lastIndexOf('.') > 0 ? t.name.slice(t.name.lastIndexOf('.')) : '';
  var dirPath = joinPath(TAG_BACKUP_FOLDER_NAME, t.folder);
  var name = stripExt(t.name) + ' [編集前 ' + stamp + ']' + dotExt;
  var dir = await getDirHandleByPath(dirPath, true);
  for (var n = 2; await entryExists(dir, name); n++) {
    if (n > 999) throw _tagErr('控えの名前を決められませんでした');
    name = stripExt(t.name) + ' [編集前 ' + stamp + ' (' + n + ')]' + dotExt;
  }
  var fh = await dir.getFileHandle(name, { create: true });
  await _writeWhole(fh, orig);
  if (await sha256Hex(await _readAll(fh)) !== hash) throw _tagErr('控えのコピーを確かめられなかったため、書き込みをやめました');
  return joinPath(dirPath, name);
}

/* ---------- 表示・控えの更新 ---------- */
// ファイルを書き換えたあと：曲情報の控え（tagCache）と曲の表示を、ファイルの新しい内容で更新する
async function _refreshTrackFromFile(t) {
  var file = await t.handle.getFile();
  var tags = await readTrackTags(file);
  var old = tagCache[t.path];
  var c = { v: TAG_CACHE_VERSION, s: file.size, m: file.lastModified, t: tags.title, a: tags.artist, l: tags.album,
            aa: tags.albumArtist, n: tags.track, k: tags.disc, d: old && old.d ? old.d : Math.round(tags.duration * 10) / 10 };
  if (tags.compilation) c.cp = 1;   // コンピレーションの印（v2.9）
  if (tags.genre) c.g = tags.genre;  // ジャンル・発売年（v3.1）
  if (tags.year) c.y = tags.year;
  c.f = TAG_DETAIL_VERSION;
  tagCache[t.path] = c;
  applyCacheToTrack(t, c);
  t.metaLoaded = true;
  fillDisplayFields(t);
}
function _refreshTrackDisplay(t) {
  var c = tagCache[t.path];
  if (c && c.v === TAG_CACHE_VERSION) applyCacheToTrack(t, c);
  else { t.tagTitle = ''; t.tagArtist = ''; t.tagAlbum = ''; t.tagAlbumArtist = ''; }
  fillDisplayFields(t);
}
function _removeOverrideFields(path, fields) {
  var ov = db.tagOverrides[path];
  if (!ov) return;
  fields.forEach(function (f) { delete ov[f]; });
  if (!Object.keys(ov).length) delete db.tagOverrides[path];
}
async function clearTagOverride(path) {
  var ok = await showConfirm({
    title: 'アプリ内の上書きを消す',
    message: 'この曲のアプリ内で上書きした曲情報を消して、ファイルのタグ（またはファイル名・フォルダ名からの推定）の表示に戻します。ファイルは変わりません。',
    okText: '消す', danger: true
  });
  if (!ok) return;
  var t = library.byPath[path];
  var keysBefore = _albumKeySnapshot();
  var prev = db.tagOverrides[path];
  delete db.tagOverrides[path];
  if (t) _refreshTrackDisplay(t);
  _renameAlbumKeysAfter(keysBefore, [path]);
  db.history.unshift({ id: newId(), type: 'tagedit', at: nowIso(), undone: false, undoneAt: '',
    items: [{ path: path, mode: 'app', prevOverride: prev, changes: {}, before: {}, from: path + '　アプリ内の上書き', to: '上書きを消す（アプリ内）' }] });
  saveDB();
  renderAll();
  showToast('アプリ内の上書きを消しました。');
}

/* ---------- アルバムのカスタム順を引き継ぐ ----------
   アルバム名などを変えてアルバムの目印が変わったとき、そのアルバムの曲が全部同じ新しいアルバムに移ったなら、
   カスタム順の位置を新しい目印に引き継ぐ */
function _albumKeySnapshot() {
  var m = {}, ar = {};
  library.tracks.forEach(function (t) { m[t.path] = albumKeyOf(t); ar[t.path] = artistNameOf(t); });
  // アーティストの目印（名前）も控える（アーティストの Pin の付け替え用。v3.9）。数えられない所に置き、アルバム側の処理には混ぜない
  Object.defineProperty(m, '__artists', { value: ar, enumerable: false });
  return m;
}
function _renameAlbumKeysAfter(before, changedPaths) {
  if (typeof renamePinnedArtistsAfter === 'function') renamePinnedArtistsAfter(before.__artists, changedPaths);   // アーティストの Pin（v3.9）
  var changed = new Set(changedPaths), olds = {};
  changedPaths.forEach(function (p) { if (before[p]) olds[before[p]] = true; });
  Object.keys(olds).forEach(function (oldKey) {
    var members = Object.keys(before).filter(function (p) { return before[p] === oldKey; });
    if (!members.every(function (p) { return changed.has(p); })) return;   // 残っている曲がある＝元のアルバムはそのまま
    var newKeys = new Set(members.map(function (p) { var t = library.byPath[p]; return t ? albumKeyOf(t) : ''; }));
    if (newKeys.size !== 1) return;
    var newKey = Array.from(newKeys)[0];
    if (!newKey || newKey === oldKey) return;
    var idx = db.albumOrder.indexOf(oldKey);
    if (idx >= 0) {
      if (db.albumOrder.indexOf(newKey) >= 0) db.albumOrder.splice(idx, 1);   // 既にあるアルバムに合流したとき
      else db.albumOrder[idx] = newKey;
    }
    if (albView.openKey === oldKey) albView.openKey = newKey;
    if (typeof renameHiddenAlbumKeys === 'function') { var hm = {}; hm[oldKey] = newKey; renameHiddenAlbumKeys(hm); }   // 非表示のアルバム（v3.0）
    if (typeof renamePinnedAlbumKeys === 'function') { var pm = {}; pm[oldKey] = newKey; renamePinnedAlbumKeys(pm); }   // Pin（v3.4）
    if (typeof renameAlbumSortKeys === 'function') { var sm = {}; sm[oldKey] = newKey; renameAlbumSortKeys(sm); }   // ソートキー（v4.3）
    if (typeof renameAlbumTagKeys === 'function') { var tm = {}; tm[oldKey] = newKey; renameAlbumTagKeys(tm); }   // タグ（v4.4）
    if (typeof renameWesternAlbumKeys === 'function') { var wm = {}; wm[oldKey] = newKey; renameWesternAlbumKeys(wm); }   // 洋楽の指定（v5.0）
    if (typeof renameSkCoverAlbumKeys === 'function') { var cm = {}; cm[oldKey] = newKey; renameSkCoverAlbumKeys(cm); }   // ソートキーの枠の代表ジャケット（v6.0）
  });
}

/* ---------- 元に戻す（操作履歴の「タグの編集」） ---------- */
async function undoTagEdit(entry) {
  var items = entry.items.slice();
  var rows = items.map(function (i) {
    var to = i.mode === 'file' ? '控えから元のファイルに戻す'
      : (i.mode === 'app-picture' ? (i.prevPicKey ? '前のアプリ内のジャケットに戻す' : 'アプリ内のジャケットを消す')
      : (i.prevOverride ? '前のアプリ内の上書きに戻す' : 'アプリ内の上書きを消す'));
    return { from: i.to && i.path ? i.path + '　' + i.to : i.path, to: to };
  });
  // アルバムの一括編集（v5.9）：アルバムの設定（タグ・ソートキー・洋楽の指定）も変更前に戻す
  var setList = entry.albumSettings && entry.albumSettings.length && !entry.settingsUndone ? entry.albumSettings : [];
  if (setList.length && typeof abeSettingsRows === 'function') abeSettingsRows(setList).forEach(function (r) { var m = /^(「.*?」) (.*)$/.exec(r.from) || ['', '', r.from]; rows.push({ from: m[1] + ' ' + r.to, to: m[2] + 'に戻す（アプリ内）' }); });
  var opLabel = entry.label || 'タグの編集';
  var nFile = items.filter(function (i) { return i.mode === 'file'; }).length;
  var ok = await showConfirm({
    title: '直前の操作を元に戻す',
    message: '「<strong>' + escapeHtml(opLabel) + '</strong>」（' + formatDateTime(entry.at) + (items.length ? '、' + items.length + '曲' : '') + (setList.length ? '、アルバムの設定 ' + setList.length + '枚' : '') + '）を元に戻します。' +
      (nFile ? '<br><span class="dialog-hint">ファイルに書き込んだ曲は「' + TAG_BACKUP_FOLDER_NAME + '」の控えから戻します（控えは残ります）。編集のあとでファイルが変わっている曲は戻しません。</span>' : ''),
    rows: rows, okText: '元に戻す'
  });
  if (!ok) return;
  if (nFile && !(await ensureWritePermission())) { await showAlert({ title: '書き込みが許可されませんでした', message: '何も変更していません。' }); return; }
  fileOps.busy = true;
  showBusy('元に戻しています…');
  var keysBefore = _albumKeySnapshot();
  var playState = playerReleaseIfAffected(items.filter(function (i) { return i.mode === 'file'; }).map(function (i) { return i.path; }));
  var done = [], failed = [];
  try {
    for (var k = 0; k < items.length; k++) {
      var i = items[k];
      try {
        if (i.mode === 'file') {
          var fh = await getFileHandleByPath(i.path);
          if (await sha256Hex(await _readAll(fh)) !== i.afterHash) throw _tagErr('編集のあとでファイルが変わっているため、戻しませんでした（ほかのソフトでタグが変わった可能性があります）');
          var bb = await _readAll(await getFileHandleByPath(i.backup));
          if (await sha256Hex(bb) !== i.beforeHash) throw _tagErr('控えのファイルが編集前の内容と一致しません');
          await _writeWhole(fh, bb);
          if (await sha256Hex(await _readAll(fh)) !== i.beforeHash) throw _tagErr('戻した結果を確かめられませんでした（控えは残っています）');
          var t = library.byPath[i.path];
          if (t) await _refreshTrackFromFile(t);
          if (i.prevPicKey && typeof restoreUserPicForUndo === 'function') await restoreUserPicForUndo(i);   // 一緒に外したアプリ内のジャケット
        } else if (i.mode === 'app-picture') {
          await restoreUserPicForUndo(i);
        } else {
          if (i.prevOverride) db.tagOverrides[i.path] = i.prevOverride; else delete db.tagOverrides[i.path];
          var t2 = library.byPath[i.path];
          if (t2) _refreshTrackDisplay(t2);
        }
        done.push(i);
      } catch (e) {
        console.error('元に戻せませんでした', i.path, e);
        failed.push({ item: i, message: (e && e.name === 'TagWriteError') ? e.message : describeFsError(e) });
      }
    }
    _renameAlbumKeysAfter(keysBefore, done.map(function (d) { return d.path; }));
    // アルバムの設定（v5.9）：曲の目印が元に戻ってから、変更前の値を入れる（1回だけ）
    if (setList.length && typeof abeUndoSettings === 'function') { abeUndoSettings(setList); entry.settingsUndone = true; }
    // ジャケットを変えていた曲は、表示の控えを捨てて取り出し直す
    await artInvalidateTracks(done.filter(function (d) { return d.changes && 'picture' in d.changes; }).map(function (d) { return library.byPath[d.path]; }));
    if (!failed.length) { entry.undone = true; entry.undoneAt = nowIso(); }
    else entry.items = failed.map(function (f) { return f.item; });
    saveDB();
    saveTagCache();
  } finally {
    fileOps.busy = false;
    hideBusy();
  }
  await playerRestore(playState, {});
  if (typeof lyricsCacheClear === 'function') lyricsCacheClear();
  renderAll();
  if (!failed.length) { showToast('「' + opLabel + '」を元に戻しました（' + (done.length ? done.length + '曲' : '') + (done.length && setList.length ? '・' : '') + (setList.length ? 'アルバムの設定 ' + setList.length + '枚' : '') + '）。'); return; }
  await showAlert({
    title: '一部を元に戻せませんでした', size: 'large',
    message: '戻した：' + done.length + '曲 ／ 戻せなかった：' + failed.length + '曲（操作履歴に残しています）' +
      '<ul class="error-list">' + failed.map(function (f) { return '<li>' + escapeHtml(f.item.path) + '：' + escapeHtml(f.message) + '</li>'; }).join('') + '</ul>'
  });
}

/* ---------- タグ編集前の控え（設定・バックアップ） ---------- */
// 控えフォルダの中のファイルを全部数える（[{ path, size }]）
async function listTagBackups() {
  var out = [];
  var root;
  try { root = await getDirHandleByPath(TAG_BACKUP_FOLDER_NAME, false); }
  catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return out; throw e; }
  async function walk(dir, rel) {
    for await (var h of dir.values()) {
      var p = rel ? rel + '/' + h.name : h.name;
      if (h.kind === 'directory') await walk(h, p);
      else out.push({ path: joinPath(TAG_BACKUP_FOLDER_NAME, p), size: (await h.getFile()).size });
    }
  }
  await walk(root, '');
  return out;
}
async function renderTagBackupInfo() {
  var el = document.getElementById('set-tagbackup');
  if (!el) return;
  if (!isConnected()) { el.innerHTML = '<p class="panel-desc">音楽フォルダにつなぐと表示します。</p>'; return; }
  el.innerHTML = '<p class="panel-meta">数えています…</p>';
  try {
    var list = await listTagBackups();
    var total = list.reduce(function (s, x) { return s + x.size; }, 0);
    el.innerHTML = '<p class="panel-meta">控え：' + list.length + ' ファイル・約 ' + formatBytes(total) + '（音楽フォルダ直下の「' + TAG_BACKUP_FOLDER_NAME + '」フォルダ）</p>' +
      '<div class="btn-row"><button class="btn-inline-small btn-inline-danger" onclick="moveTagBackupsToTrash()"' + (list.length ? '' : ' disabled') + '>' + ICONS.trash + '控えを削除フォルダへ移す</button>' +
      '<button class="btn-inline-small" onclick="renderTagBackupInfo()">' + ICONS.refresh + '数え直す</button></div>';
  } catch (e) {
    el.innerHTML = '<p class="panel-meta">数えられませんでした：' + escapeHtml(describeFsError(e)) + '</p>';
  }
}
async function moveTagBackupsToTrash() {
  var list = await listTagBackups();
  if (!list.length) { showToast('控えはありません。'); return; }
  // ファイル整理と同じ仕組み（確認ダイアログ・操作履歴・元に戻す）で、削除フォルダへ元のフォルダ構成のまま移す
  await runFileOperation('trash', list.map(function (x) { return { from: x.path, to: TRASH_FOLDER_NAME + '/' + x.path }; }));
  renderTagBackupInfo();
}

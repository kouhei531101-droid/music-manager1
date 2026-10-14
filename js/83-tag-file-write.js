/* =========================================================
   83-tag-file-write.js ― 「ファイルに書き込む」（スマホ版 v8.17.0）
   ・アプリ内の曲情報（アプリ内の上書き・入力した歌詞・アルバムのソートキー・ファイル名のトラック番号・アプリで設定したジャケット〔無ければフォルダの cover.jpg など〕）を、
     曲ファイルのタグに書き込む。中身は 16-tag-writer.js（buildTaggedFile：タグの部分だけ作り直し、ほかのフレーム・音声データはそのまま）と
     verifyTaggedFile（音声データが元と同じか・変えていないタグがそのままか・読み戻して期待どおりか）
   ・対応形式：mp3（ID3v2）・m4a/m4b/mp4（ilst）・flac（VORBIS_COMMENT＋PICTURE）。ほかの形式は書き込まず「失敗」に理由を出す
   ・書き込み先：
     - フォルダを選べるブラウザ（PC の Chrome / Edge。fsa.readOnly でない）：元の曲ファイルをそのまま上書きする（控えは作らない。元に戻せない）
     - スマホ（読み取り専用モード。Android の Chrome などは元のファイルに書き込めない）：タグを書き込んだ曲ファイルを新しく作り、
       「保存（ダウンロード）」または「共有」で渡す（元のファイルは変わらない。差し替えは利用者が行う）
   ・空の値は書かない（タグを消すことはしない）。ファイルのタグと同じ値の項目は書かない
   ・入口：曲のメニュー（82）・アルバムの長押しのメニュー・songs の選択操作バー・曲情報の編集／まとめて編集／アルバム情報の編集のダイアログの「ファイルに書き込む…」
   ・流れ：「ファイルに書き込む」（書き込む項目を選ぶ）→「書き込みの確認」（曲数・項目・元に戻せません）→「書き込み中」（進み具合・中止）→「書き込みの結果」
   ========================================================= */

// 書き込む項目（選ぶ単位）。fields は 16-tag-writer.js の項目名（picture はジャケット）
var TFW_ITEMS = [
  { k: 'basic', label: '曲名・アーティスト・アルバム・アルバムアーティスト', fields: ['title', 'artist', 'album', 'albumArtist'] },
  { k: 'genreYear', label: 'ジャンル・発売年', fields: ['genre', 'year'] },
  { k: 'track', label: 'トラック番号（タグに無い曲は、ファイル名の番号）', fields: ['track'] },
  { k: 'sort', label: 'アルバムの読み（アルバムのソートキー）', fields: ['albumSort'] },
  { k: 'lyrics', label: '歌詞（アプリで入力した歌詞）', fields: ['lyrics'] },
  { k: 'picture', label: 'ジャケット（アプリで設定した画像。無ければフォルダの cover.jpg など）', fields: ['picture'] }
];
var TFW_FORMATS = 'mp3・m4a・flac';

function _tfwDirect() { return !fsa.readOnly; }   // 元のファイルを上書きできるか
function _tfwChosen() {
  var c = ui.tfwItems;
  if (!c || typeof c !== 'object') c = {};
  var out = {};
  TFW_ITEMS.forEach(function (it) { out[it.k] = c[it.k] !== false; });
  return out;
}

/* ---------- アプリ内の値を集める（曲ごと） ---------- */
async function _tfwValues(t, chosen) {
  var v = {}, ov = (db.tagOverrides || {})[t.path] || {}, cur = currentTagValues(t);
  var pick = function (f) { var x = ov[f] != null ? String(ov[f]) : cur[f]; return (x || '').trim(); };
  if (chosen.basic) ['title', 'artist', 'album', 'albumArtist'].forEach(function (f) { v[f] = pick(f); });
  if (chosen.genreYear) ['genre', 'year'].forEach(function (f) { v[f] = pick(f); });
  if (chosen.track) {
    var o = typeof albumTrackOrder === 'function' ? albumTrackOrder(t) : null;
    if (o && o.has) v.track = String(o.track);
  }
  if (chosen.sort && typeof getAlbumSortKey === 'function' && typeof albumKeyOf === 'function') {
    var sk = getAlbumSortKey(albumKeyOf(t)); if (sk) v.albumSort = String(sk).trim();
  }
  if (chosen.lyrics) { var ly = (db.lyrics || {})[t.path]; if (ly && ly.text && ly.text.trim()) v.lyrics = ly.text.replace(/\r\n?/g, '\n').trim(); }
  if (chosen.picture && typeof artFindOriginal === 'function') {
    try {
      var found = await artFindOriginal(t);
      if (found && (found.source === 'app' || found.source === 'folder') && found.blob) {
        var bytes = new Uint8Array(await found.blob.arrayBuffer());
        var mime = found.blob.type || (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg');
        if (mime !== 'image/png') mime = 'image/jpeg';
        var w = 0, h = 0;
        try { var bmp = await createImageBitmap(found.blob); w = bmp.width; h = bmp.height; if (bmp.close) bmp.close(); } catch (e) { /* 大きさが分からなくても書ける */ }
        v.picture = { mime: mime, bytes: bytes, width: w, height: h, source: found.source };
      }
    } catch (e) { console.warn('ジャケットを読めません', t.path, e); }
  }
  return v;
}
// ファイルのタグと比べて、書き込む変更だけにする（空の値・同じ値は書かない）
async function _tfwChanges(file, v) {
  var ch = {}, tags = await readTrackTags(file);
  ['title', 'artist', 'album', 'albumArtist', 'genre'].forEach(function (f) { if (v[f] && v[f] !== (tags[f] || '')) ch[f] = v[f]; });
  if (v.year && String(_yearOf(v.year) || '') !== String(tags.year || '')) ch.year = v.year;
  if (v.track && (parseInt(v.track, 10) || 0) !== (tags.track || 0)) ch.track = v.track;
  if (v.albumSort) ch.albumSort = v.albumSort;   // 読みは今の値を読めないので、いつも書く（同じ値なら中身は同じ）
  if (v.lyrics) { var ol = await readTrackLyrics(file); if (!ol || ol.text !== v.lyrics) ch.lyrics = v.lyrics; }
  if (v.picture) {
    var op = await readTrackPicture(file);
    if (!op || !_bytesEqual(op.bytes, v.picture.bytes)) ch.picture = { mime: v.picture.mime, bytes: v.picture.bytes, width: v.picture.width, height: v.picture.height };
  }
  return ch;
}

/* ---------- 「ファイルに書き込む」：項目を選ぶ → 確認 ---------- */
async function openFileWriteDialog(paths, what) {
  var tracks = (paths || []).map(function (p) { return library.byPath[p]; }).filter(Boolean);
  if (!tracks.length) { showToast('書き込む曲がありません。', true); return; }
  var ok = tracks.filter(function (t) { return !!tagWriteKind(t.ext); }), ng = tracks.length - ok.length;
  var chosen = _tfwChosen(), direct = _tfwDirect();
  var body = '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'ファイルに書き込む\', event)" title="クリックで「ファイルに書き込む」をコピー">□</span>' +
    '<p class="tfw-target">' + escapeHtml(what || (tracks.length === 1 ? '「' + tracks[0].title + '」' : tracks.length + '曲')) + '　<strong>' + ok.length + '曲</strong>に書き込みます' +
      (ng ? '<br><span class="text-warn">' + ng + '曲は書き込めない形式です（' + TFW_FORMATS + ' だけ）。その曲はとばします。</span>' : '') + '</p>' +
    '<div class="tfw-items" role="group" aria-label="書き込む項目">' + TFW_ITEMS.map(function (it) {
      return '<label class="tagedit-write tfw-item"><input type="checkbox" data-tfw="' + it.k + '"' + (chosen[it.k] ? ' checked' : '') + '>' + escapeHtml(it.label) + '</label>';
    }).join('') + '</div>' +
    '<p class="tfw-note">アプリ内の曲情報（上書きした曲名など・入力した歌詞・ソートキー・設定したジャケット）を、曲ファイルのタグに書きます。空の項目と、ファイルと同じ値の項目は書きません（タグを消すことはしません）。音声データは変えません。</p>' +
    (direct ? '<p class="tfw-warn">' + ICONS.trash + '元の曲ファイルをそのまま上書きします。控えは作らないので<strong>元に戻せません</strong>。</p>'
      : '<p class="tfw-warn">スマホでは元の曲ファイルを直接書き換えられないため、<strong>タグを書き込んだ曲ファイルを新しく作って保存（ダウンロード）・共有</strong>します。元のファイルは変わりません（差し替えは手で行ってください）。</p>') +
    '<div class="dialog-error" id="tfw-error"></div>';
  var picked = null;
  var v = await openDialog({
    title: 'ファイルに書き込む', size: 'small', body: body,
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '次へ（確認）', value: 'ok', cls: 'btn-save', isDefault: true }],
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var c = {};
      b.querySelectorAll('[data-tfw]').forEach(function (x) { c[x.getAttribute('data-tfw')] = x.checked; });
      if (!TFW_ITEMS.some(function (it) { return c[it.k]; })) { b.querySelector('#tfw-error').textContent = '書き込む項目を1つ以上選んでください。'; return false; }
      if (!ok.length) { b.querySelector('#tfw-error').textContent = '書き込める形式（' + TFW_FORMATS + '）の曲がありません。'; return false; }
      picked = c;
      return true;
    }
  });
  if (v !== 'ok' || !picked) return;
  ui.tfwItems = picked; saveUi();
  var names = TFW_ITEMS.filter(function (it) { return picked[it.k]; }).map(function (it) { return it.label.replace(/（.*$/, ''); });
  var conf = await showConfirm({
    title: '書き込みの確認', danger: direct, okText: direct ? '上書きする（元に戻せません）' : '書き込んだファイルを作る',
    message: '<strong>' + ok.length + '曲</strong>の曲ファイルに、次の項目を書き込みます。<br>' + escapeHtml(names.join('・')) +
      (direct ? '<br><br><strong>元の曲ファイルを上書きします。元に戻せません。</strong>' : '<br><br>元のファイルは変えず、書き込んだファイルを作って保存・共有します。') +
      (ng ? '<br>（書き込めない形式の ' + ng + '曲はとばします）' : '')
  });
  if (!conf) return;
  if (direct && !(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: '曲ファイルへの書き込みの許可が得られませんでした。何も変更していません。' });
    return;
  }
  await runFileWrite(tracks, picked, direct);
}

/* ---------- 書き込む ---------- */
async function runFileWrite(tracks, chosen, direct) {
  var st = { cancel: false, done: false, i: 0 };
  var res = { ok: [], same: [], fail: [], files: [] };
  openDialog({
    title: '書き込み中', size: 'small',
    body: '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'書き込み中\', event)" title="クリックで「書き込み中」をコピー">□</span>' +
      '<div class="plc-prog"><div class="plc-prog-text" id="tfw-prog-text">準備しています…</div><div class="plc-bar"><div class="plc-bar-fill" id="tfw-bar-fill"></div></div><div class="plc-prog-sub" id="tfw-prog-sub"></div></div>',
    buttons: [{ label: '中止', value: 'stop', cls: 'btn-cancel btn-cancel-danger', isDefault: true }],
    cancelValue: 'stop',
    beforeClose: function () {
      if (st.done) return true;
      st.cancel = true;
      var s = document.getElementById('tfw-prog-sub'); if (s) s.textContent = '中止しています…（今の曲が終わったら止めます）';
      return false;
    }
  });
  var show = function (t) {
    var te = document.getElementById('tfw-prog-text'), fe = document.getElementById('tfw-bar-fill'), se = document.getElementById('tfw-prog-sub');
    if (!te) return;
    te.textContent = Math.min(st.i + 1, tracks.length) + ' / ' + tracks.length + '曲';
    fe.style.width = (st.i / tracks.length * 100).toFixed(1) + '%';
    if (se && !st.cancel) se.textContent = t ? t.title : '';
  };
  for (st.i = 0; st.i < tracks.length && !st.cancel; st.i++) {
    var t = tracks[st.i];
    show(t);
    var kind = tagWriteKind(t.ext);
    if (!kind) { res.fail.push({ t: t, reason: 'この形式（.' + (t.ext || '?') + '）には書き込めません（' + TFW_FORMATS + ' だけ）' }); continue; }
    try {
      var file = await t.handle.getFile();
      var orig = new Uint8Array(await file.arrayBuffer());
      var v = await _tfwValues(t, chosen);
      var ch = await _tfwChanges(file, v);
      if (!Object.keys(ch).length) { res.same.push(t); continue; }
      var nb = buildTaggedFile(kind, orig, ch);
      await verifyTaggedFile(kind, orig, nb, file.name, ch);
      if (direct) {
        var ps = typeof playerReleaseIfAffected === 'function' ? playerReleaseIfAffected([t.path]) : null;
        try {
          var w = await t.handle.createWritable();
          try { await w.write(nb); await w.close(); } catch (e) { try { await w.abort(); } catch (e2) { /* 無視 */ } throw e; }
        } finally { if (ps && typeof playerRestore === 'function') await playerRestore(ps, {}); }
        // アプリ内の情報を今のファイルに合わせる（書いた項目の上書きは、ファイルと同じになったので外す）
        try { await _refreshTrackFromFile(t); } catch (e) { console.warn(e); }
        var wrote = Object.keys(ch).filter(function (f) { return TAG_FIELDS.indexOf(f) >= 0; });
        if (wrote.length && typeof _removeOverrideFields === 'function') _removeOverrideFields(t.path, wrote);
        if (ch.picture && typeof artInvalidateTracks === 'function') { try { await artInvalidateTracks([t]); } catch (e) { /* 無視 */ } }
      } else {
        res.files.push({ name: file.name, blob: new Blob([nb], { type: file.type || 'application/octet-stream' }) });
      }
      res.ok.push({ t: t, fields: Object.keys(ch) });
    } catch (e) {
      console.warn('ファイルに書き込めません', t.path, e);
      res.fail.push({ t: t, reason: (e && e.message) || String(e) });
    }
  }
  var stopped = st.cancel && st.i < tracks.length;
  st.done = true;
  closeDialog('stop');
  if (direct && res.ok.length) {
    if (typeof saveTagCache === 'function') saveTagCache();
    saveDB();
    if (typeof renderAll === 'function') renderAll();
  }
  await _tfwShowResult(res, direct, stopped ? tracks.length - st.i : 0);
}

/* ---------- 書き込みの結果 ---------- */
function _tfwSave(f) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(f.blob); a.download = f.name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function _tfwShowResult(res, direct, rest) {
  var lab = function (fs) { return fs.map(function (f) { return f === 'picture' ? 'ジャケット' : TAG_FIELD_LABELS[f] || f; }).join('・'); };
  var h = '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'書き込みの結果\', event)" title="クリックで「書き込みの結果」をコピー">□</span>' +
    '<p class="tfw-sum"><strong>成功 ' + res.ok.length + '</strong>　／　変更なし ' + res.same.length + '　／　<span' + (res.fail.length ? ' class="text-warn"' : '') + '>失敗 ' + res.fail.length + '</span>' +
    (rest ? '　／　中止したので書かなかった曲 ' + rest : '') + '</p>';
  if (res.ok.length) h += '<details class="tfw-list"><summary>' + (direct ? '上書きした曲' : '書き込んだファイルを作った曲') + '（' + res.ok.length + '）</summary><ul>' +
    res.ok.map(function (x) { return '<li>' + escapeHtml(x.t.title) + '<span class="tfw-sub">' + escapeHtml(lab(x.fields)) + '</span></li>'; }).join('') + '</ul></details>';
  if (res.fail.length) h += '<div class="tfw-list tfw-fails"><div class="tfw-fails-title">失敗した曲と理由</div><ul>' +
    res.fail.map(function (x) { return '<li>' + escapeHtml(x.t.title) + '<span class="tfw-sub">' + escapeHtml(x.reason) + '</span></li>'; }).join('') + '</ul></div>';
  if (!direct && res.files.length) {
    var canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([res.files[0].blob], res.files[0].name, { type: res.files[0].blob.type })] })); } catch (e) { canShare = false; }
    h += '<div class="tfw-files"><div class="tfw-fails-title">書き込んだファイル（元のファイルは変わっていません）</div><ul>' +
      res.files.map(function (f, i) { return '<li><span class="tfw-fname">' + escapeHtml(f.name) + '</span><button type="button" class="btn-inline-small" data-tfw-dl="' + i + '">' + ICONS.download + '保存</button></li>'; }).join('') + '</ul>' +
      '<div class="btn-row">' + (res.files.length > 1 ? '<button type="button" class="btn-inline-small" data-tfw-dl-all="1">' + ICONS.download + 'すべて保存（ダウンロード）</button>' : '') +
      (canShare ? '<button type="button" class="btn-inline-small" data-tfw-share="1">' + ICONS.upload + '共有する</button>' : '') + '</div>' +
      '<p class="tfw-note">保存したファイルは「ダウンロード」フォルダなどに入ります。元の曲と差し替えるときは、ファイルを移してから音楽フォルダを選び直してください。</p></div>';
  }
  await openDialog({
    title: '書き込みの結果', size: 'small', body: h,
    buttons: [{ label: '閉じる', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (body) {
      body.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-tfw-dl], [data-tfw-dl-all], [data-tfw-share]'); if (!b) return;
        if (b.hasAttribute('data-tfw-dl')) _tfwSave(res.files[+b.getAttribute('data-tfw-dl')]);
        else if (b.hasAttribute('data-tfw-dl-all')) res.files.forEach(function (f, i) { setTimeout(function () { _tfwSave(f); }, i * 400); });
        else if (b.hasAttribute('data-tfw-share')) {
          var fs = res.files.map(function (f) { return new File([f.blob], f.name, { type: f.blob.type }); });
          navigator.share({ files: fs, title: '曲ファイル' }).catch(function (e) { if (e && e.name !== 'AbortError') showToast('共有できませんでした（' + e.message + '）', true); });
        }
      });
    }
  });
}

/* ---------- 入口をつなぐ ---------- */
(function () {
  // 曲情報の編集・まとめて編集・アルバム情報の編集のダイアログに「ファイルに書き込む…」（押すとそのダイアログを閉じて開く）
  var addBtn = function (name, getPaths, getWhat) {
    var f = window[name];
    if (typeof f !== 'function') return;
    window[name] = function () {
      var args = arguments, flag = { on: false };
      var p = f.apply(this, args);
      try {
        var body = document.getElementById('dialog-body');
        if (body && !body.querySelector('.tfw-open-btn')) {
          var w = document.createElement('div');
          w.className = 'tfw-open-row';
          w.innerHTML = '<button type="button" class="btn-inline-small tfw-open-btn" data-dialog-value="tfw">' + ICONS.download + 'ファイルに書き込む…</button>' +
            '<span class="tfw-open-hint">アプリ内の曲情報・歌詞・ジャケットを曲ファイルのタグに書きます</span>';
          var err = body.querySelector('.dialog-error');
          if (err) body.insertBefore(w, err); else body.appendChild(w);
          w.querySelector('button').addEventListener('click', function () { flag.on = true; }, true);
        }
      } catch (e) { console.warn(e); }
      return Promise.resolve(p).then(function (r) {
        if (flag.on) return openFileWriteDialog(getPaths.apply(null, args), getWhat.apply(null, args));
        return r;
      });
    };
  };
  addBtn('openTrackTagEditor', function (path) { return [path]; }, function (path) { var t = library.byPath[path]; return t ? '「' + t.title + '」' : ''; });
  addBtn('openBulkTagEditor', function (paths) { return paths || []; }, function (paths) { return (paths || []).length + '曲'; });
  addBtn('openAlbumTagEditor', function (a) { return a && a.tracks ? a.tracks.map(function (t) { return t.path; }) : []; }, function (a) { return a ? 'アルバム「' + a.name + '」' : ''; });
  // アルバムの長押しのメニュー
  var ac = window.openAlbumContextMenu;
  if (typeof ac === 'function') {
    window.openAlbumContextMenu = function (a) {
      var r = ac.apply(this, arguments);
      var el = typeof acm !== 'undefined' ? acm.el : null;
      if (!el || !a) return r;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'acm-item'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-acm-tfw', '1');
      b.innerHTML = ICONS.download + '<span>ファイルに書き込む…</span>';
      el.appendChild(b);
      var rr = el.getBoundingClientRect(), m = 6;
      if (rr.bottom > window.innerHeight - m) el.style.top = Math.max(m, window.innerHeight - rr.height - m) + 'px';
      b.addEventListener('click', function () {
        var al = acm.album;
        closeAlbumContextMenu();
        if (al) openFileWriteDialog(al.tracks.map(function (t) { return t.path; }), 'アルバム「' + al.name + '」');
      });
      return r;
    };
  }
  // songs の選択操作バー
  var sb = window.updateLibSelectBar;
  if (typeof sb === 'function') {
    window.updateLibSelectBar = function () {
      var r = sb.apply(this, arguments);
      var bar = document.getElementById('lib-select-bar');
      if (bar && !bar.hidden && !bar.querySelector('[data-tfw-sel]')) {
        var clr = bar.querySelector('button[onclick^="clearLibSelection"]');
        var b = document.createElement('button');
        b.className = 'btn-inline-small'; b.setAttribute('data-tfw-sel', '1');
        b.innerHTML = ICONS.download + 'ファイルに書き込む…';
        b.addEventListener('click', function () { openFileWriteDialog(selectedPathsInViewOrder(), '選んだ曲'); });
        if (clr) bar.insertBefore(b, clr); else bar.appendChild(b);
      }
      return r;
    };
  }
})();

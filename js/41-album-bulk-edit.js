/* =========================================================
   41-album-bulk-edit.js ― アルバムの一括編集（v5.9）
   ・入口：アルバムのフィルターバーの「一覧で編集」ボタン（一括編集ボタン）
   ・画面：全画面の「アルバムの一括編集」。
       一括編集のヘッダー（件数・一括編集の検索欄・列の表示）／一括入力バー（行にチェック → 列にまとめて入れる）／
       一括編集の表（1行＝1アルバム。セルがそのまま入力欄。変えたセルは色が変わる）／更新バー（変更の件数・取り消す・更新ボタン）
   ・対象：開いたときの album の並び・検索・絞り込み（タグ・ジャンル・Pin のみ・非表示のアルバム）に合うアルバム
   ・更新ボタン：確認ダイアログ（変更前 → 変更後）→ まとめて反映
       アルバム名・アルバムアーティスト・ジャンル・発売年 … 曲ファイルに書き込む（17-tag-edit.js の writeTagsSafely：控え→一時ファイル→検証→置き換え）。
                                                          ogg・wav などはアプリ内の上書き（db.tagOverrides）
       タグ・ソートキー・洋楽の指定 … アプリ内の設定
     操作履歴に「アルバムの一括編集（〇枚）」として1件残し、「元に戻す」でまとめて戻せる（設定は entry.albumSettings）
   ・表は 100 行ずつ描く（下までスクロールしたら続き）。1500枚でも最初の描画は 100 行分だけ
   ========================================================= */

var ABE_CHUNK = 100;
// 列（id・見出し・入力の種類）。file：曲ファイルに書く項目（f はタグの項目名）
var ABE_COLS = [
  { id: 'art', label: 'ジャケット' },
  { id: 'name', label: 'アルバム名', edit: 'text', file: 'album', fixed: true },
  { id: 'albumArtist', label: 'アルバムアーティスト', edit: 'text', file: 'albumArtist' },
  { id: 'genre', label: 'ジャンル', edit: 'text', file: 'genre' },
  { id: 'year', label: '発売年', edit: 'text', file: 'year' },
  { id: 'tag', label: 'タグ', edit: 'select' },
  { id: 'sortKey', label: 'ソートキー', edit: 'text' },
  { id: 'western', label: '洋楽の指定', edit: 'select' },
  { id: 'count', label: '曲数' },
  { id: 'kind', label: '形式' }
];
// 一括入力できる列（アルバム名は、同じ名前にすると1枚にまとまってしまうので入れない）
var ABE_BULK_COLS = ['albumArtist', 'genre', 'year', 'tag', 'sortKey', 'western'];

var abe = { open: false, all: [], view: [], shown: 0, edits: {}, checked: new Set(), query: '', pushed: false, leaving: false, busy: false };

function _abeColOf(id) { for (var i = 0; i < ABE_COLS.length; i++) if (ABE_COLS[i].id === id) return ABE_COLS[i]; return null; }
function _abeHiddenCols() { return Array.isArray(ui.abeHideCols) ? ui.abeHideCols : []; }

/* ---------- 対象のアルバム・元の値 ---------- */
// 今の album の並び・検索・絞り込みに合うアルバム（14-albums.js の renderAlbumsPage と同じ決め方）
function _abeTargetAlbums() {
  var albums = buildAlbums();
  var list = getAlbumList(albums);
  if (typeof isPinOnlyActive === 'function' && !albView.showHidden && isPinOnlyActive(pinnedAlbumsPresentCount(albums))) list = splitPinnedAlbums(list).pinned;
  return list;
}
function _abeOrig(a) {
  var o = { name: a.byFolder ? '' : a.name, albumArtist: a.albumArtist || '', mixed: {} };
  ['genre', 'year'].forEach(function (f) {
    var vals = a.tracks.map(function (t) { return currentTagValues(t)[f]; });
    var same = vals.every(function (x) { return x === vals[0]; });
    o[f] = same ? vals[0] : '';
    o.mixed[f] = !same;
  });
  o.tag = (albumTagOf(a.key) || {}).id || '';
  o.sortKey = getAlbumSortKey(a.key);
  var wv = (db.westernAlbums || {})[a.key];
  o.western = wv === true ? '1' : wv === false ? '0' : '';
  return o;
}
function _abeRow(a) {
  var exts = [], unw = [];
  a.tracks.forEach(function (t) { if (exts.indexOf(t.ext) < 0) exts.push(t.ext); if (!tagWriteKind(t.ext) && unw.indexOf(t.ext) < 0) unw.push(t.ext); });
  var au = typeof westernAuto === 'function' ? westernAuto(a) : { w: false };
  var ar = (db.westernArtists || {})[a.sortArtist || ''];
  var autoW = typeof ar === 'boolean' ? ar : au.w;
  return { a: a, key: a.key, o: _abeOrig(a), exts: exts, unw: unw, autoW: autoW };
}

/* ---------- 値・変更 ---------- */
function _abeVal(r, col) { var e = abe.edits[r.key]; return e && col in e ? e[col] : r.o[col]; }
function _abeNormSortKey(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, typeof ALBUM_SORTKEY_MAX === 'number' ? ALBUM_SORTKEY_MAX : 100); }
// その列が本当に変わるか（ジャンル・発売年は空欄なら変更しない。アルバム名などは前後の空白を除いて比べる）
function _abeChanged(r, col) {
  var e = abe.edits[r.key];
  if (!e || !(col in e)) return false;
  var v = e[col], o = r.o[col];
  if (col === 'genre' || col === 'year') { v = String(v).trim(); return !!v && v !== o; }
  if (col === 'name' || col === 'albumArtist') return String(v).trim() !== o;
  if (col === 'sortKey') return _abeNormSortKey(v) !== o;
  return v !== o;
}
function _abeInvalid(r, col) {
  if (col !== 'year') return false;
  var v = String(_abeVal(r, 'year') || '').trim();
  return !!v && !/^\d{4}$/.test(v);
}
function _abeRowChanged(r) {
  if (!abe.edits[r.key]) return false;
  for (var i = 0; i < ABE_COLS.length; i++) if (ABE_COLS[i].edit && _abeChanged(r, ABE_COLS[i].id)) return true;
  return false;
}
function _abeRowByKey(key) { for (var i = 0; i < abe.all.length; i++) if (abe.all[i].key === key) return abe.all[i]; return null; }
function _abeSetEdit(r, col, v) {
  if (!abe.edits[r.key]) abe.edits[r.key] = {};
  abe.edits[r.key][col] = v;
  if (!_abeChanged(r, col) && !_abeInvalid(r, col)) delete abe.edits[r.key][col];
  if (!Object.keys(abe.edits[r.key]).length) delete abe.edits[r.key];
}

// 変更の計画：{ albums, tracks:[{ path, t, changes, before, mode }], settings:[{ key, name, ch:{ sortKey?, tag?, western? } }], rows, nFile, nApp, invalid }
function _abePlan() {
  var p = { albums: 0, tracks: [], settings: [], rows: [], nFile: 0, nAppTrack: 0, invalid: 0 };
  abe.all.forEach(function (r) {
    if (!abe.edits[r.key]) return;
    if (_abeInvalid(r, 'year')) { p.invalid++; return; }
    var any = false, ach = {}, fileLabels = [];
    ABE_COLS.forEach(function (c) {
      if (!c.file || !_abeChanged(r, c.id)) return;
      ach[c.file] = String(_abeVal(r, c.id)).trim();
      fileLabels.push(c);
    });
    var nf = 0, na = 0;
    if (Object.keys(ach).length) {
      r.a.tracks.forEach(function (t) {
        var cur = currentTagValues(t), ch = {};
        Object.keys(ach).forEach(function (f) { if (ach[f] !== cur[f]) ch[f] = ach[f]; });
        if (!Object.keys(ch).length) return;
        var mode = tagWriteKind(t.ext) ? 'file' : 'app';
        p.tracks.push({ path: t.path, t: t, changes: ch, before: cur, mode: mode });
        if (mode === 'file') nf++; else na++;
      });
      if (nf + na) any = true;
      fileLabels.forEach(function (c) {
        var from = c.id === 'name' ? (r.a.byFolder ? '（フォルダ名：' + r.a.name + '）' : r.o.name) : (r.o.mixed[c.id] ? '（曲ごとに異なる）' : r.o[c.id]);
        p.rows.push({ from: '「' + r.a.name + '」 ' + c.label + '「' + (from || '空欄') + '」', to: c.label + '「' + (ach[c.file] || '空欄') + '」' + (na ? (nf ? '（ファイル ' + nf + '曲・アプリ内 ' + na + '曲）' : '（アプリ内 ' + na + '曲）') : '（ファイル ' + nf + '曲）') });
      });
    }
    var sch = {};
    if (_abeChanged(r, 'sortKey')) sch.sortKey = { b: r.o.sortKey, a: _abeNormSortKey(_abeVal(r, 'sortKey')) };
    if (_abeChanged(r, 'tag')) sch.tag = { b: r.o.tag, a: _abeVal(r, 'tag') };
    if (_abeChanged(r, 'western')) sch.western = { b: _abeWesBool(r.o.western), a: _abeWesBool(_abeVal(r, 'western')) };
    if (Object.keys(sch).length) {
      any = true;
      p.settings.push({ key: r.key, name: r.a.name, ch: sch });
      Object.keys(sch).forEach(function (f) {
        p.rows.push({ from: '「' + r.a.name + '」 ' + _abeSetLabel(f) + '「' + _abeSetText(f, sch[f].b) + '」', to: _abeSetLabel(f) + '「' + _abeSetText(f, sch[f].a) + '」（アプリ内）' });
      });
    }
    if (any) p.albums++;
  });
  p.nFile = p.tracks.filter(function (i) { return i.mode === 'file'; }).length;
  p.nAppTrack = p.tracks.length - p.nFile;
  p.nSettings = p.settings.reduce(function (s, x) { return s + Object.keys(x.ch).length; }, 0);
  return p;
}
function _abeWesBool(v) { return v === '1' ? true : v === '0' ? false : null; }
function _abeSetLabel(f) { return f === 'sortKey' ? 'ソートキー' : f === 'tag' ? 'タグ' : '洋楽の指定'; }
function _abeSetText(f, v) {
  if (f === 'tag') { var t = v ? albumTagById(v) : null; return t ? t.name : 'なし'; }
  if (f === 'western') return v === true ? '洋楽にする' : v === false ? '洋楽から外す' : '自動';
  return v || '空欄';
}
// 操作履歴に出す行（08-organizer.js・元に戻すの確認から使う）
function abeSettingsRows(list) {
  var rows = [];
  (list || []).forEach(function (s) {
    Object.keys(s.ch).forEach(function (f) {
      rows.push({ from: '「' + s.name + '」 ' + _abeSetLabel(f) + '「' + _abeSetText(f, s.ch[f].b) + '」', to: _abeSetLabel(f) + '「' + _abeSetText(f, s.ch[f].a) + '」（アプリ内）' });
    });
  });
  return rows;
}
// 元に戻す：アルバムの設定を変更前の値に（曲の情報を戻して目印が元に戻ったあとで呼ぶ）
function abeUndoSettings(list) {
  (list || []).forEach(function (s) {
    if (s.ch.sortKey) setAlbumSortKey(s.key, s.ch.sortKey.b);
    if (s.ch.tag) setAlbumTag(s.key, s.ch.tag.b);
    if (s.ch.western && typeof setWesternAlbum === 'function') setWesternAlbum(s.key, s.ch.western.b);
  });
}

/* ---------- 画面の骨組み ---------- */
function _abeEnsureDom() {
  var el = document.getElementById('album-bulk-edit');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'album-bulk-edit';
  el.className = 'abe';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'abe-title');
  el.innerHTML =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;left:6px" onclick="copyUiLabel(\'アルバムの一括編集\', event)" title="クリックで「アルバムの一括編集」をコピー">□</span>' +
    // 一括編集のヘッダー
    '<div class="abe-head">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:2px;right:6px" onclick="copyUiLabel(\'一括編集のヘッダー\', event)" title="クリックで「一括編集のヘッダー」をコピー">□</span>' +
      '<h2 id="abe-title" class="abe-title">アルバムの一括編集</h2>' +
      '<span class="abe-count" id="abe-count"></span>' +
      '<div class="search-box abe-search-box"><span class="search-icon">' + ICONS.search + '</span>' +
        '<input type="search" id="abe-search" class="form-input" placeholder="この表の中を検索" autocomplete="off" aria-label="一括編集の検索欄"></div>' +
      '<span class="abe-cols-wrap"><button type="button" class="btn-inline-small" id="abe-cols-btn" aria-expanded="false">列の表示</button>' +
        '<div class="abe-cols-pop" id="abe-cols-pop" hidden></div></span>' +
      '<button type="button" class="btn-icon abe-close" id="abe-close" title="閉じる" aria-label="アルバムの一括編集を閉じる">' + ICONS.x + '</button>' +
    '</div>' +
    // 一括入力バー（行にチェックしたときだけ）
    '<div class="abe-bulk" id="abe-bulk" hidden>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:2px;right:6px" onclick="copyUiLabel(\'一括入力バー\', event)" title="クリックで「一括入力バー」をコピー">□</span>' +
      '<span class="abe-bulk-n" id="abe-bulk-n"></span>' +
      '<select class="form-input abe-bulk-col" id="abe-bulk-col" aria-label="入れる列">' +
        ABE_BULK_COLS.map(function (id) { return '<option value="' + id + '">' + escapeHtml(_abeColOf(id).label) + '</option>'; }).join('') + '</select>' +
      '<span class="abe-bulk-val" id="abe-bulk-val"></span>' +
      '<button type="button" class="btn-save abe-bulk-apply" id="abe-bulk-apply">選んだ行に入れる</button>' +
      '<button type="button" class="btn-inline-small" id="abe-bulk-clear">選択を外す</button>' +
      // 一括削除ボタン（v6.6）：選んだアルバムの曲を「削除フォルダ」へ（アルバムの「ファイル削除」と同じ仕組み）
      '<span class="abe-bulk-delete-wrap"><button type="button" class="btn-cancel btn-cancel-danger abe-bulk-delete" id="abe-bulk-delete">' + ICONS.trash + '選んだアルバムを削除</button>' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'一括削除ボタン\', event)" title="クリックで「一括削除ボタン」をコピー">□</span></span>' +
    '</div>' +
    // 一括編集の表
    '<div class="abe-scroll" id="abe-scroll">' +
      '<span class="ui-label-tag ui-label-tag-onlight abe-table-label" onclick="copyUiLabel(\'一括編集の表\', event)" title="クリックで「一括編集の表」をコピー">□</span>' +
      '<table class="abe-table" id="abe-table"><thead><tr>' +
        '<th class="abe-c-chk"><input type="checkbox" id="abe-check-all" title="表示している行を全部選ぶ／外す" aria-label="表示している行を全部選ぶ／外す"></th>' +
        ABE_COLS.map(function (c) { return '<th class="abe-c-' + c.id + '">' + escapeHtml(c.label) + '</th>'; }).join('') +
        '<th class="abe-c-reset"></th>' +
      '</tr></thead><tbody id="abe-tbody"></tbody></table>' +
      '<div class="abe-more" id="abe-more"></div>' +
    '</div>' +
    // 更新バー
    '<div class="abe-foot">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:2px;right:6px" onclick="copyUiLabel(\'更新バー\', event)" title="クリックで「更新バー」をコピー">□</span>' +
      '<div class="abe-summary" id="abe-summary" aria-live="polite"></div>' +
      '<button type="button" class="btn-cancel" id="abe-reset-all">変更を全部取り消す</button>' +
      '<span class="abe-update-wrap"><button type="button" class="btn-save abe-update" id="abe-update">更新</button>' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'更新ボタン\', event)" title="クリックで「更新ボタン」をコピー">□</span></span>' +
    '</div>' +
    '<datalist id="abe-genre-list"></datalist>';
  document.body.appendChild(el);
  _abeBind(el);
  return el;
}

/* ---------- 開く・閉じる ---------- */
function openAlbumBulkEdit() {
  if (!isConnected() || !library.scanned) { showToast('先に音楽フォルダを読み込んでください。', true); return; }
  if (fileOps.busy) { showToast('ほかの操作を実行中です。終わってからもう一度お試しください。', true); return; }
  var el = _abeEnsureDom();
  abe.all = _abeTargetAlbums().map(_abeRow);
  abe.edits = {}; abe.checked = new Set(); abe.query = '';
  document.getElementById('abe-search').value = '';
  document.getElementById('abe-genre-list').innerHTML = (typeof genreSuggestList === 'function' ? genreSuggestList() : GENRE_SUGGEST).map(function (g) { return '<option value="' + escapeHtml(g) + '">'; }).join('');
  abe.open = true;
  el.hidden = false;
  document.body.classList.add('abe-open');
  try { history.pushState({ mmABE: 1 }, ''); abe.pushed = true; } catch (e) { abe.pushed = false; }
  _abeApplyHiddenCols();
  _abeRenderColsPop();
  _abeBulkValHtml();
  _abeFilter();
  applyUiLabelSetting();
  setTimeout(function () { var s = document.getElementById('abe-search'); if (s) s.focus(); }, 0);
}
function _abeDirtyCount() { var n = 0; abe.all.forEach(function (r) { if (_abeRowChanged(r)) n++; }); return n; }
// 閉じる（変更が残っていれば確かめる）。戻る（popstate）からは fromPop
async function closeAlbumBulkEdit(fromPop) {
  if (!abe.open) return;
  var n = _abeDirtyCount();
  if (n) {
    if (fromPop) { try { history.pushState({ mmABE: 1 }, ''); abe.pushed = true; } catch (e) { abe.pushed = false; } }   // 確かめる間は画面を残す
    var ok = await showConfirm({ title: 'アルバムの一括編集を閉じる', message: '変更が <strong>' + n + '件</strong>（アルバム）あります。破棄しますか？<br><span class="dialog-hint">「更新」を押すまで、曲ファイルもアプリの設定も変わっていません。</span>', okText: '破棄して閉じる', danger: true });
    if (!ok) return;
    abe.edits = {};
  }
  if (abe.pushed) { abe.pushed = false; abe.leaving = true; history.back(); return; }   // 足した履歴を戻す（popstate で隠す）
  _abeHide();
}
function _abeHide() {
  abe.open = false; abe.leaving = false;
  var el = document.getElementById('album-bulk-edit');
  if (el) el.hidden = true;
  document.body.classList.remove('abe-open');
  document.getElementById('abe-tbody').innerHTML = '';
  abe.all = []; abe.view = []; abe.edits = {}; abe.checked = new Set();
  var b = document.getElementById('alb-bulk-btn'); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
}
window.addEventListener('popstate', function () {
  if (!abe.open) return;
  abe.pushed = false;
  if (abe.leaving || !_abeDirtyCount()) { _abeHide(); return; }
  closeAlbumBulkEdit(true);
});
window.addEventListener('beforeunload', function (ev) {
  if (abe.open && _abeDirtyCount()) { ev.preventDefault(); ev.returnValue = ''; }
});
document.addEventListener('keydown', function (ev) {
  if (!abe.open || ev.key !== 'Escape') return;
  var dlg = document.getElementById('dialog-modal'), busy = document.getElementById('busy-overlay');
  if ((dlg && !dlg.hidden) || (busy && !busy.hidden)) return;
  var pop = document.getElementById('abe-cols-pop');
  if (pop && !pop.hidden) { _abeColsPop(false); return; }
  ev.preventDefault();
  closeAlbumBulkEdit();
});

/* ---------- 表の描画 ---------- */
function _abeSearchText(r) {
  var tg = albumTagById(_abeVal(r, 'tag'));
  return [r.a.name, r.a.artist, _abeVal(r, 'name'), _abeVal(r, 'albumArtist'), _abeVal(r, 'genre') || r.a.genre, _abeVal(r, 'sortKey'), tg ? tg.name : ''].join(' ').toLowerCase();
}
function _abeFilter() {
  var terms = abe.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  abe.view = terms.length ? abe.all.filter(function (r) { var h = _abeSearchText(r); return terms.every(function (w) { return h.indexOf(w) >= 0; }); }) : abe.all.slice();
  var sc = document.getElementById('abe-scroll'); if (sc) sc.scrollTop = 0;
  _abeRenderBody(ABE_CHUNK);
  _abeUpdateCount();
}
function _abeUpdateCount() {
  document.getElementById('abe-count').textContent = abe.view.length === abe.all.length ? abe.all.length + '枚' : abe.view.length + '枚 / ' + abe.all.length + '枚';
}
function _abeRenderBody(n) {
  var tb = document.getElementById('abe-tbody');
  abe.shown = Math.min(abe.view.length, Math.max(n, ABE_CHUNK));
  tb.innerHTML = abe.view.slice(0, abe.shown).map(_abeRowHtml).join('');
  if (!abe.view.length) tb.innerHTML = '<tr class="abe-empty"><td colspan="' + (ABE_COLS.length + 2) + '">' + (abe.all.length ? '検索に当てはまるアルバムがありません。' : '対象のアルバムがありません。') + '</td></tr>';
  artObserve(tb);
  _abeWatchMore();
  _abeSyncCheckAll();
  _abeSummary();
}
function _abeMore() {
  if (abe.shown >= abe.view.length) return false;
  var tb = document.getElementById('abe-tbody'), n = Math.min(abe.view.length, abe.shown + ABE_CHUNK);
  tb.insertAdjacentHTML('beforeend', abe.view.slice(abe.shown, n).map(_abeRowHtml).join(''));
  abe.shown = n;
  artObserve(tb);
  _abeWatchMore();
  return true;
}
var _abeIo = null;
function _abeWatchMore() {
  var more = document.getElementById('abe-more'), sc = document.getElementById('abe-scroll');
  if (_abeIo) { _abeIo.disconnect(); _abeIo = null; }
  more.textContent = abe.shown < abe.view.length ? '続きを読み込んでいます…（' + abe.shown + ' / ' + abe.view.length + '枚）' : '';
  if (abe.shown >= abe.view.length || !('IntersectionObserver' in window)) return;
  _abeIo = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) _abeMore(); }, { root: sc, rootMargin: '0px 0px 600px 0px' });
  _abeIo.observe(more);
}
function _abeCellCls(r, col) { return 'abe-c-' + col + (_abeChanged(r, col) ? ' is-changed' : '') + (_abeInvalid(r, col) ? ' is-invalid' : ''); }
// 1行の HTML（列の並びは見出しと同じ：チェック・ABE_COLS の順・取り消す）
function _abeRowHtml(r) {
  var a = r.a, k = escapeHtml(r.key), ch = _abeRowChanged(r);
  var h = '<tr class="abe-row' + (ch ? ' is-changed' : '') + (abe.checked.has(r.key) ? ' is-checked' : '') + '" data-key="' + k + '">';
  h += '<td class="abe-c-chk"><input type="checkbox" class="abe-check"' + (abe.checked.has(r.key) ? ' checked' : '') + ' aria-label="' + escapeHtml('「' + a.name + '」を選ぶ') + '"></td>';
  h += '<td class="abe-c-art">' + artThumbHtml(a.cover, 'abe-art') + '</td>';
  ABE_COLS.forEach(function (c) {
    if (!c.edit) return;
    var v = _abeVal(r, c.id), lab = escapeHtml(c.label);
    h += '<td class="' + _abeCellCls(r, c.id) + '" data-label="' + lab + '">';
    if (c.id === 'tag') {
      h += '<select class="abe-in" data-col="tag" aria-label="' + lab + '"><option value="">なし</option>' +
        (db.albumTags || []).map(function (t) { return '<option value="' + escapeHtml(t.id) + '"' + (t.id === v ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>'; }).join('') + '</select>';
    } else if (c.id === 'western') {
      h += '<select class="abe-in" data-col="western" aria-label="' + lab + '">' +
        [['', '自動（' + (r.autoW ? '洋楽' : '洋楽ではない') + '）'], ['1', '洋楽にする'], ['0', '洋楽から外す']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>'; }).join('') + '</select>';
    } else {
      var ph = c.id === 'name' ? (a.byFolder ? a.name + '（フォルダ名）' : '') : c.id === 'albumArtist' ? '曲ごとのアーティスト' : c.id === 'genre' ? (r.o.mixed.genre ? '（曲ごとに異なる）' : '') : c.id === 'year' ? (r.o.mixed.year ? '（曲ごとに異なる）' : '例：2019') : c.id === 'sortKey' ? 'なし' : '';
      h += '<input type="text" class="abe-in" data-col="' + c.id + '" value="' + escapeHtml(v) + '"' + (ph ? ' placeholder="' + escapeHtml(ph) + '"' : '') +
        (c.id === 'genre' ? ' list="abe-genre-list"' : '') + (c.id === 'year' ? ' inputmode="numeric" maxlength="4"' : '') + (c.id === 'sortKey' ? ' maxlength="100"' : '') +
        ' aria-label="' + escapeHtml(a.name + '：' + c.label) + '" autocomplete="off" spellcheck="false">';
    }
    h += '</td>';
  });
  h += '<td class="abe-c-count" data-label="曲数">' + a.tracks.length + '曲</td>';
  h += '<td class="abe-c-kind" data-label="形式">' + r.exts.map(function (x) {
    var no = r.unw.indexOf(x) >= 0;
    return '<span class="abe-kind' + (no ? ' is-app' : '') + '"' + (no ? ' title="この形式はファイルに書けないため、アルバム名などはアプリ内の上書きになります"' : '') + '>' + escapeHtml(x.toUpperCase()) + (no ? '※' : '') + '</span>';
  }).join('') + '</td>';
  h += '<td class="abe-c-reset"><button type="button" class="btn-icon abe-row-reset" title="この行の変更を取り消す" aria-label="' + escapeHtml('「' + a.name + '」の変更を取り消す') + '"' + (ch ? '' : ' hidden') + '>' + ICONS.undo + '</button></td>';
  return h + '</tr>';
}

/* ---------- 列の表示 ---------- */
function _abeApplyHiddenCols() {
  var t = document.getElementById('abe-table'), hid = _abeHiddenCols();
  ABE_COLS.forEach(function (c) { t.classList.toggle('abe-hide-' + c.id, hid.indexOf(c.id) >= 0 && !c.fixed); });
}
function _abeRenderColsPop() {
  var hid = _abeHiddenCols();
  document.getElementById('abe-cols-pop').innerHTML = '<div class="abe-cols-title">表示する列</div>' + ABE_COLS.map(function (c) {
    return '<label class="abe-cols-item"><input type="checkbox" data-col="' + c.id + '"' + (hid.indexOf(c.id) < 0 || c.fixed ? ' checked' : '') + (c.fixed ? ' disabled' : '') + '>' + escapeHtml(c.label) + '</label>';
  }).join('');
}
function _abeColsPop(show) {
  var pop = document.getElementById('abe-cols-pop'), b = document.getElementById('abe-cols-btn');
  pop.hidden = !show; b.setAttribute('aria-expanded', String(!!show));
}

/* ---------- 一括入力バー ---------- */
function _abeBulkValHtml() {
  var col = document.getElementById('abe-bulk-col').value, box = document.getElementById('abe-bulk-val');
  if (col === 'tag') box.innerHTML = '<select class="form-input" id="abe-bulk-input" aria-label="入れる値"><option value="">なし</option>' + (db.albumTags || []).map(function (t) { return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>'; }).join('') + '</select>';
  else if (col === 'western') box.innerHTML = '<select class="form-input" id="abe-bulk-input" aria-label="入れる値"><option value="">自動</option><option value="1">洋楽にする</option><option value="0">洋楽から外す</option></select>';
  else box.innerHTML = '<input type="text" class="form-input" id="abe-bulk-input" aria-label="入れる値" autocomplete="off"' + (col === 'genre' ? ' list="abe-genre-list"' : '') + (col === 'year' ? ' inputmode="numeric" maxlength="4" placeholder="例：2019"' : ' placeholder="' + (col === 'albumArtist' ? '空欄なら曲ごとのアーティスト' : col === 'sortKey' ? '空欄なら解除' : 'ジャンル') + '"') + '>';
}
function _abeBulkBar() {
  var n = abe.checked.size, bar = document.getElementById('abe-bulk');
  bar.hidden = !n;
  document.getElementById('abe-bulk-n').textContent = n + '枚を選択中';
}
function _abeSyncCheckAll() {
  var all = document.getElementById('abe-check-all');
  var nIn = abe.view.filter(function (r) { return abe.checked.has(r.key); }).length;
  all.checked = !!abe.view.length && nIn === abe.view.length;
  all.indeterminate = nIn > 0 && nIn < abe.view.length;
  _abeBulkBar();
}
function _abeBulkApply() {
  var col = document.getElementById('abe-bulk-col').value, inp = document.getElementById('abe-bulk-input');
  var v = inp.value;
  if (col === 'year' && v.trim() && !/^\d{4}$/.test(v.trim())) { showToast('発売年は4桁の数字（例：2019）で入力してください。', true); inp.focus(); return; }
  if (col === 'genre' && !v.trim()) { showToast('ジャンルが空欄です（空欄は「変更しない」になります）。', true); inp.focus(); return; }
  var n = 0;
  abe.checked.forEach(function (key) { var r = _abeRowByKey(key); if (r) { _abeSetEdit(r, col, v); n++; } });
  _abeRerenderKeep();
  showToast(n + '枚の「' + _abeColOf(col).label + '」に入れました（まだ保存していません。「更新」で反映します）。');
}
// 今の表示の行数・スクロール位置を保ったまま描き直す
function _abeRerenderKeep() {
  var sc = document.getElementById('abe-scroll'), y = sc.scrollTop, x = sc.scrollLeft;
  _abeRenderBody(abe.shown);
  sc.scrollTop = y; sc.scrollLeft = x;
}

/* ---------- 変更の件数（更新バー） ---------- */
var _abeSumRaf = 0;
function _abeSummarySoon() { if (!_abeSumRaf) _abeSumRaf = requestAnimationFrame(function () { _abeSumRaf = 0; _abeSummary(); }); }
function _abeSummary() {
  var p = _abePlan(), el = document.getElementById('abe-summary'), btn = document.getElementById('abe-update');
  var nAll = p.nFile + p.nAppTrack + p.nSettings;
  if (!p.albums && !p.invalid) el.innerHTML = '<span class="abe-sum-none">変更はまだありません。セルを直接書き換えて、最後に「更新」を押します。</span>';
  else el.innerHTML = '変更：<strong>' + p.albums + '枚</strong>　ファイルに書き込む：<strong>' + p.nFile + '曲</strong>　アプリ内だけ：<strong>' + (p.nAppTrack + p.nSettings) + '件</strong>' +
    (p.nAppTrack ? '<span class="abe-sum-sub">（曲 ' + p.nAppTrack + '・設定 ' + p.nSettings + '）</span>' : '') +
    (p.invalid ? '<span class="abe-sum-bad">発売年が4桁の数字でない行：' + p.invalid + '枚</span>' : '');
  btn.disabled = !nAll || !!p.invalid;
  btn.textContent = nAll ? '更新（' + p.albums + '枚）' : '更新';
  document.getElementById('abe-reset-all').disabled = !Object.keys(abe.edits).length;
}

/* ---------- 操作 ---------- */
function _abeRowOfEl(el) { var tr = el.closest('tr.abe-row'); return tr ? { tr: tr, r: _abeRowByKey(tr.getAttribute('data-key')) } : null; }
function _abeUpdateRowMarks(tr, r) {
  ABE_COLS.forEach(function (c) {
    if (!c.edit) return;
    var td = tr.querySelector('td.abe-c-' + c.id);
    if (td) { td.classList.toggle('is-changed', _abeChanged(r, c.id)); td.classList.toggle('is-invalid', _abeInvalid(r, c.id)); }
  });
  var ch = _abeRowChanged(r);
  tr.classList.toggle('is-changed', ch);
  tr.querySelector('.abe-row-reset').hidden = !ch;
}
// セルの移動（↑↓・Enter）：同じ列の上下の行へ。まだ描いていない行は先に描く
function _abeMove(input, dir) {
  var tr = input.closest('tr.abe-row'), col = input.getAttribute('data-col');
  var next = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
  if (!next && dir > 0 && _abeMore()) next = tr.nextElementSibling;
  if (!next) return;
  var t = next.querySelector('.abe-in[data-col="' + col + '"]');
  if (!t) return;
  t.focus();
  if (t.select) try { t.select(); } catch (e) { /* 無視 */ }
  t.scrollIntoView({ block: 'nearest' });
}
function _abeBind(el) {
  document.getElementById('abe-close').addEventListener('click', function () { closeAlbumBulkEdit(); });
  var q = document.getElementById('abe-search'), qt = 0;
  q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { abe.query = q.value; _abeFilter(); }, 150); });
  document.getElementById('abe-cols-btn').addEventListener('click', function (ev) { ev.stopPropagation(); _abeColsPop(document.getElementById('abe-cols-pop').hidden); });
  document.getElementById('abe-cols-pop').addEventListener('change', function (ev) {
    var c = ev.target.getAttribute('data-col'); if (!c) return;
    var hid = _abeHiddenCols().filter(function (x) { return x !== c; });
    if (!ev.target.checked) hid.push(c);
    ui.abeHideCols = hid; saveUi();
    _abeApplyHiddenCols();
  });
  el.addEventListener('click', function (ev) {
    var pop = document.getElementById('abe-cols-pop');
    if (!pop.hidden && !ev.target.closest('.abe-cols-wrap')) _abeColsPop(false);
  });
  document.getElementById('abe-bulk-col').addEventListener('change', _abeBulkValHtml);
  document.getElementById('abe-bulk-apply').addEventListener('click', _abeBulkApply);
  document.getElementById('abe-bulk-clear').addEventListener('click', function () { abe.checked.clear(); _abeRerenderKeep(); });
  document.getElementById('abe-bulk-delete').addEventListener('click', function () { runAlbumBulkDelete(); });
  document.getElementById('abe-bulk-val').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); _abeBulkApply(); } });
  document.getElementById('abe-check-all').addEventListener('change', function () {
    var on = this.checked;
    abe.view.forEach(function (r) { if (on) abe.checked.add(r.key); else abe.checked.delete(r.key); });
    document.querySelectorAll('#abe-tbody tr.abe-row').forEach(function (tr) { tr.classList.toggle('is-checked', on); tr.querySelector('.abe-check').checked = on; });
    _abeSyncCheckAll();
  });
  document.getElementById('abe-reset-all').addEventListener('click', async function () {
    var n = _abeDirtyCount();
    if (n && !(await showConfirm({ title: '変更を全部取り消す', message: 'この画面で入れた変更（' + n + '枚）を全部取り消して、元の値に戻します。', okText: '全部取り消す', danger: true }))) return;
    abe.edits = {};
    _abeRerenderKeep();
  });
  document.getElementById('abe-update').addEventListener('click', function () { runAlbumBulkUpdate(); });
  var tb = document.getElementById('abe-tbody');
  var onEdit = function (ev) {
    var inp = ev.target; if (!inp.classList || !inp.classList.contains('abe-in')) return;
    var o = _abeRowOfEl(inp); if (!o || !o.r) return;
    _abeSetEdit(o.r, inp.getAttribute('data-col'), inp.value);
    _abeUpdateRowMarks(o.tr, o.r);
    _abeSummarySoon();
  };
  tb.addEventListener('input', onEdit);
  tb.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('abe-check')) {
      var o = _abeRowOfEl(ev.target); if (!o) return;
      if (ev.target.checked) abe.checked.add(o.r.key); else abe.checked.delete(o.r.key);
      o.tr.classList.toggle('is-checked', ev.target.checked);
      _abeSyncCheckAll();
      return;
    }
    onEdit(ev);
  });
  tb.addEventListener('click', function (ev) {
    var b = ev.target.closest('.abe-row-reset'); if (!b) return;
    var o = _abeRowOfEl(b); if (!o) return;
    delete abe.edits[o.r.key];
    o.tr.outerHTML = _abeRowHtml(o.r);
    artObserve(tb);
    _abeSummary();
  });
  tb.addEventListener('keydown', function (ev) {
    var inp = ev.target; if (!inp.classList || !inp.classList.contains('abe-in') || ev.isComposing) return;
    var text = inp.tagName === 'INPUT';
    if (ev.key === 'Enter') { ev.preventDefault(); _abeMove(inp, ev.shiftKey ? -1 : 1); }
    else if (text && ev.key === 'ArrowDown' && !ev.altKey) { ev.preventDefault(); _abeMove(inp, 1); }
    else if (text && ev.key === 'ArrowUp' && !ev.altKey) { ev.preventDefault(); _abeMove(inp, -1); }
  });
}

/* ---------- 選んだアルバムを削除（v6.6） ----------
   アルバムの「ファイル削除」と同じ runFileOperation('trash')：曲ファイルを音楽フォルダの「削除フォルダ」へ元のフォルダ構成のまま移す
   （完全には消さない。操作履歴に残り、「直前の操作を元に戻す」で戻せる）。確認の画面にアルバムの枚数・曲の数・アルバム名の一覧。
   まだ「更新」していない入力は、残るアルバムの分はそのまま残す（削除したアルバムの分は捨てる。目印が変わって残せなかった分は知らせる） */
var ABE_DEL_NAMES_MAX = 15;
async function runAlbumBulkDelete() {
  if (abe.busy) return;
  if (fileOps.busy) { showToast('ほかの操作を実行中です。終わってからもう一度お試しください。', true); return; }
  // 選んだアルバム（今の曲の並びで探し直す）
  var fresh = {}; buildAlbums().forEach(function (a) { fresh[a.key] = a; });
  var targets = abe.all.filter(function (r) { return abe.checked.has(r.key); }).map(function (r) { return fresh[r.key] || r.a; });
  if (!targets.length) { showToast('削除するアルバムを選んでください（行の左のチェック）。', true); return; }
  var plan = [], ownerOf = {};
  targets.forEach(function (a) { a.tracks.forEach(function (t) { if (ownerOf[t.path]) return; ownerOf[t.path] = a.key; plan.push({ from: t.path, to: TRASH_FOLDER_NAME + '/' + t.path }); }); });
  var editedDel = targets.filter(function (a) { return abe.edits[a.key]; }).length;
  var names = targets.slice(0, ABE_DEL_NAMES_MAX).map(function (a) { return '<li>' + escapeHtml(a.name) + (a.artist ? '<span class="abe-del-artist"> ／ ' + escapeHtml(a.artist) + '</span>' : '') + '（' + a.tracks.length + '曲）</li>'; }).join('') +
    (targets.length > ABE_DEL_NAMES_MAX ? '<li class="abe-del-more">ほか ' + (targets.length - ABE_DEL_NAMES_MAX) + '枚</li>' : '');
  var otherEdits = Object.keys(abe.edits).filter(function (k) { return !targets.some(function (a) { return a.key === k; }); }).length;
  var extra = '<div class="abe-del-summary"><strong>アルバム ' + targets.length + '枚・曲 ' + plan.length + '曲</strong>を削除します。<ul class="abe-del-list">' + names + '</ul>' +
    '<span class="dialog-hint">' + (otherEdits ? 'ほかのアルバムに入力中の、まだ「更新」していない変更（' + otherEdits + '枚）は、そのまま残ります。' : '') +
    (editedDel ? '削除するアルバムに入力中の変更（' + editedDel + '枚）は捨てます。' : '') + '</span></div>';
  abe.busy = true;
  var result = null;
  try {
    await runFileOperation('trash', plan, { confirmExtra: extra, note: 'アルバムの一括編集から ' + targets.length + '枚', after: function (res) { result = res; } });
  } finally { abe.busy = false; }
  if (!result) return;   // キャンセル・実行できなかった
  // アルバムごとに成功・失敗を分ける（1曲でも失敗したアルバムは「失敗」。成功した曲は削除フォルダに移っている）
  var failedPaths = {}; result.failed.forEach(function (f) { failedPaths[f.item.from] = f.message; });
  var okAlbums = [], ngAlbums = [];
  targets.forEach(function (a) {
    var ng = a.tracks.filter(function (t) { return failedPaths[t.path] !== undefined; });
    if (ng.length) ngAlbums.push({ a: a, ng: ng }); else okAlbums.push(a);
  });
  // 表を作り直す：残るアルバムは同じ並びのまま、入力中の変更も残す
  var lost = 0;
  if (abe.open) {
    var now = {}; buildAlbums().forEach(function (a) { now[a.key] = a; });
    var deleted = new Set(okAlbums.map(function (a) { return a.key; }));
    var rows = [];
    abe.all.forEach(function (r) {
      if (deleted.has(r.key)) { delete abe.edits[r.key]; abe.checked.delete(r.key); return; }
      var a = now[r.key];
      if (!a) { if (abe.edits[r.key]) lost++; delete abe.edits[r.key]; abe.checked.delete(r.key); return; }   // 目印が変わった・曲が無くなった
      rows.push(_abeRow(a));
    });
    abe.all = rows;
    _abeFilter();
  }
  if (!ngAlbums.length) {
    showToast(okAlbums.length + '枚（' + result.done.length + '曲）を「' + TRASH_FOLDER_NAME + '」へ移しました。操作履歴から元に戻せます。' + (lost ? '（入力中の変更 ' + lost + '枚分は、アルバムが見つからなくなったため残せませんでした）' : ''));
    return;
  }
  await showAlert({
    title: '一部のアルバムを削除できませんでした', size: 'large',
    message: '<p>削除できたアルバム：<strong>' + okAlbums.length + '枚</strong>（削除フォルダへ移しました。操作履歴から元に戻せます）</p>' +
      (okAlbums.length ? '<ul class="error-list abe-del-ok">' + okAlbums.slice(0, ABE_DEL_NAMES_MAX).map(function (a) { return '<li>' + escapeHtml(a.name) + '</li>'; }).join('') + (okAlbums.length > ABE_DEL_NAMES_MAX ? '<li>ほか ' + (okAlbums.length - ABE_DEL_NAMES_MAX) + '枚</li>' : '') + '</ul>' : '') +
      '<p>削除できなかったアルバム：<strong>' + ngAlbums.length + '枚</strong>（失敗した曲は元の場所に残っています。成功した曲だけ削除フォルダへ移しました）</p>' +
      '<ul class="error-list">' + ngAlbums.map(function (x) { return '<li>' + escapeHtml(x.a.name) + '：' + x.ng.map(function (t) { return escapeHtml(t.name + '（' + failedPaths[t.path] + '）'); }).join('、') + '</li>'; }).join('') + '</ul>' +
      (lost ? '<p class="dialog-hint">入力中の変更 ' + lost + '枚分は、アルバムが見つからなくなったため残せませんでした。</p>' : '')
  });
}

/* ---------- 更新（まとめて反映） ---------- */
async function runAlbumBulkUpdate() {
  if (abe.busy) return;
  if (fileOps.busy) { showToast('ほかの操作を実行中です。終わってからもう一度お試しください。', true); return; }
  var p = _abePlan();
  if (p.invalid) { showToast('発売年は4桁の数字（例：2019）で入力してください。', true); return; }
  if (!p.tracks.length && !p.settings.length) { showToast('変更がありません。'); return; }
  var unw = p.tracks.filter(function (i) { return i.mode === 'app'; });
  var ok = await showConfirm({
    title: 'アルバムの一括編集の確認',
    message: '対象：<strong>' + p.albums + '枚</strong><br>' +
      '音楽ファイルに書き込む：<strong>' + p.nFile + '曲</strong>' + (p.nFile ? '（書き込む前に元のファイルを「' + TAG_BACKUP_FOLDER_NAME + '」フォルダへコピーします）' : '') + '<br>' +
      'アプリ内だけの変更：<strong>' + (p.nAppTrack + p.nSettings) + '件</strong>（曲の表示 ' + p.nAppTrack + '曲・タグ／ソートキー／洋楽の指定 ' + p.nSettings + '件）' +
      (unw.length ? '<br><span class="dialog-hint">' + unw.length + '曲（' + Array.from(new Set(unw.map(function (i) { return i.t.ext; }))).join('・') + '）はファイルに安全に書き込めない形式のため、アプリ内の表示だけを変えます。</span>' : '') +
      '<br><span class="dialog-hint">操作履歴に「アルバムの一括編集（' + p.albums + '枚）」として1件残り、「直前の操作を元に戻す」でまとめて戻せます。' + (p.nFile ? TAG_ITUNES_NOTE : '') + '</span>',
    rows: p.rows,
    okText: '更新する'
  });
  if (!ok) return;
  if (p.nFile && !(await ensureWritePermission())) {
    await showAlert({ title: '書き込みが許可されませんでした', message: 'ブラウザの確認で「変更を保存」（編集を許可）を選ぶと実行できます。何も変更していません。' });
    return;
  }
  abe.busy = true;
  fileOps.busy = true;
  showBusy('アルバムの一括編集を反映しています…');
  var busyText = document.getElementById('busy-text');
  var keysBefore = _albumKeySnapshot();
  var oldFirst = abe.all.map(function (r) { return r.a.tracks[0] ? r.a.tracks[0].path : ''; });   // あとで同じアルバムを探す用
  var playState = playerReleaseIfAffected(p.tracks.filter(function (i) { return i.mode === 'file'; }).map(function (i) { return i.path; }));
  var stamp = _tagStamp(), done = [], failed = [], settingsDone = [];
  try {
    // ① アプリ内の設定（今の目印に保存。アルバム名などで目印が変わったら、あとの付け替えで一緒に移る）
    p.settings.forEach(function (s) {
      if (s.ch.sortKey) setAlbumSortKey(s.key, s.ch.sortKey.a);
      if (s.ch.tag) setAlbumTag(s.key, s.ch.tag.a);
      if (s.ch.western && typeof setWesternAlbum === 'function') setWesternAlbum(s.key, s.ch.western.a);
      settingsDone.push(s);
    });
    // ② 曲ごとの書き込み（ファイル）・アプリ内の上書き
    for (var k = 0; k < p.tracks.length; k++) {
      var i = p.tracks[k];
      busyText.textContent = 'アルバムの一括編集を反映しています…（' + (k + 1) + ' / ' + p.tracks.length + '曲）';
      var label = { from: i.path + '　' + _changeSummary(i.changes, i.before), to: _changeSummary(i.changes, i.changes) + (i.mode === 'app' ? '（アプリ内）' : '') };
      try {
        if (i.mode === 'file') {
          var r = await writeTagsSafely(i.t, i.changes, stamp);
          await _refreshTrackFromFile(i.t);
          _removeOverrideFields(i.path, Object.keys(i.changes));
          done.push({ path: i.path, mode: 'file', backup: r.backupPath, beforeHash: r.beforeHash, afterHash: r.afterHash, changes: i.changes, before: _pick(i.before, i.changes), from: label.from, to: label.to });
        } else {
          var prev = db.tagOverrides[i.path] ? JSON.parse(JSON.stringify(db.tagOverrides[i.path])) : null;
          db.tagOverrides[i.path] = Object.assign({}, db.tagOverrides[i.path] || {}, i.changes);
          _refreshTrackDisplay(i.t);
          done.push({ path: i.path, mode: 'app', prevOverride: prev, changes: i.changes, before: _pick(i.before, i.changes), from: label.from, to: label.to });
          if (k % 40 === 39) await new Promise(function (res) { setTimeout(res, 0); });   // 画面を止めない
        }
      } catch (e) {
        console.error('アルバムの一括編集：曲情報の変更に失敗', i.path, e);
        failed.push({ path: i.path, message: (e && e.name === 'TagWriteError') ? e.message : describeFsError(e) });
      }
    }
    if (done.length) {
      _renameAlbumKeysAfter(keysBefore, done.map(function (d) { return d.path; }));   // カスタム順・Pin・非表示・タグ・ソートキー・洋楽の指定の付け替え
      if (typeof addGenreSuggestFrom === 'function') addGenreSuggestFrom(done);
    }
    if (done.length || settingsDone.length) {
      db.history.unshift({ id: newId(), type: 'tagedit', label: 'アルバムの一括編集（' + p.albums + '枚）', at: nowIso(), items: done, albumSettings: settingsDone, undone: false, undoneAt: '' });
      if (db.history.length > HISTORY_MAX) db.history.length = HISTORY_MAX;
    }
    saveDB();
    saveTagCache();
  } finally {
    fileOps.busy = false;
    abe.busy = false;
    hideBusy();
  }
  await playerRestore(playState, {});
  if (typeof lyricsCacheClear === 'function') lyricsCacheClear();
  renderAll();
  // 表を新しい内容で作り直す（同じアルバムを、最初の曲で探す。変更は空に）
  if (abe.open) {
    var albums = buildAlbums(), byPath = {};
    albums.forEach(function (a) { a.tracks.forEach(function (t) { byPath[t.path] = a; }); });
    var seen = new Set(), rows = [];
    oldFirst.forEach(function (path, idx) {
      var a = byPath[path] || null;
      if (!a) a = _abeFindByKey(albums, abe.all[idx].key);
      if (a && !seen.has(a.key)) { seen.add(a.key); rows.push(_abeRow(a)); }
    });
    abe.all = rows; abe.edits = {}; abe.checked = new Set();
    _abeFilter();
  }
  var nA = p.albums;
  if (!failed.length) { showToast('アルバムの一括編集を反映しました（' + nA + '枚・' + done.length + '曲）。操作履歴に記録しました。'); return; }
  await showAlert({
    title: '一部の曲を変更できませんでした', size: 'large',
    message: '成功：' + done.length + '曲 ／ 失敗：' + failed.length + '曲。失敗した曲のファイルは変更していません（成功した分はそのまま反映しています）。' +
      '<ul class="error-list">' + failed.map(function (f) { return '<li>' + escapeHtml(f.path) + '：' + escapeHtml(f.message) + '</li>'; }).join('') + '</ul>'
  });
}
function _abeFindByKey(albums, key) { for (var i = 0; i < albums.length; i++) if (albums[i].key === key) return albums[i]; return null; }

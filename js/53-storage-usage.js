/* =========================================================
   53-storage-usage.js ― 「設定・バックアップ」の「保存容量の使用状況」（v8.2）
   ・小さな保存場所（localStorage・約5MB）：基本の設定・見た目の設定・移行前の古い控え・読めなかったデータの控え・
     ほかのアプリ（file:// で開く garden-journal など。同じ枠を分け合う）を項目ごとに出す
   ・大きな保存場所（IndexedDB）：プレイリスト・操作履歴など（項目ごと）・移行前のデータの控え・曲情報の控え・
     ジャケット画像の控え・アプリ内で設定したジャケット、ブラウザ全体の使用量
   ・「キャッシュを削除」→「キャッシュの削除」ダイアログ：作り直せる控えだけを選んで消す
       ジャケット画像の控え（縮小画像）／移行前の古い曲情報の控え（localStorage に残った物。今は使っていない時だけ）
     プレイリスト・操作履歴・再生回数・入力した歌詞などのデータは消さない
   ・大きさは文字数の目安（localStorage の「約5MB」と同じ数え方）。画像は実際のバイト数
   ========================================================= */

var LS_LIMIT_CHARS = 5 * 1024 * 1024;   // localStorage の目安（約5MB 相当の文字数）
var LEGACY_LS_KEYS = [TAG_CACHE_KEY, 'musicManager_firstSeen'];   // v2.6 までの曲情報の控え・追加日（v2.7 から IndexedDB）

// localStorage の中身を種類ごとに数える
function lsUsageGroups() {
  var g = { db: 0, ui: 0, legacy: 0, broken: 0, mmOther: 0, others: {}, total: 0, brokenKeys: [] };
  var n = 0;
  try { n = localStorage.length; } catch (e) { return g; }
  for (var i = 0; i < n; i++) {
    var k = localStorage.key(i), v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) { v = ''; }
    var size = String(k).length + v.length;
    g.total += size;
    if (k === DB_KEY) g.db += size;
    else if (k === UI_KEY) g.ui += size;
    else if (LEGACY_LS_KEYS.indexOf(k) >= 0) g.legacy += size;
    else if (k.indexOf(DB_KEY + '_broken_') === 0) { g.broken += size; g.brokenKeys.push(k); }
    else if (k.indexOf('musicManager_') === 0) g.mmOther += size;
    else {
      // ほかのアプリは名前の頭（gardenJournal_… → gardenJournal）でまとめる
      var app = String(k).split(/[_\-.:]/)[0] || k;
      g.others[app] = (g.others[app] || 0) + size;
    }
  }
  return g;
}
function _usageRow(label, size, note, cls) {
  return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td class="su-size">' + (typeof size === 'number' ? formatBytes(size) : size) + '</td><td class="su-note">' + (note || '') + '</td></tr>';
}
function _usageBar(used, limit) {
  var pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
  return '<div class="storage-bar"><div class="storage-fill' + (pct > 80 ? ' warn' : '') + '" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
    '<p class="panel-meta">使用量：約 ' + formatBytes(used) + ' ／ 目安 ' + formatBytes(limit) + '（' + pct + '%）</p>';
}

function renderSetStorage() {
  var el = document.getElementById('set-storage');
  if (!el) return;
  var mode = typeof dbStore !== 'undefined' ? dbStore.mode : 'local';
  var g = lsUsageGroups();
  var otherApps = Object.keys(g.others).map(function (k) { return [k, g.others[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  var otherTotal = otherApps.reduce(function (s, x) { return s + x[1]; }, 0);
  var modeText = {
    idb: 'プレイリスト・操作履歴などは「大きな保存場所」に保存しています。',
    local: '<strong>大きな保存場所を使えないため、すべて「小さな保存場所」に保存しています</strong>（いっぱいになりやすい状態です）。',
    broken: '<strong>大きな保存場所を開けませんでした。ページを開き直してください</strong>（プレイリストなどの変更は保存されません）。',
    pending: '起動中です…'
  }[mode] || '';

  var h = '<p class="panel-desc su-mode">' + modeText + '</p>' +
    // ① 小さな保存場所
    '<div class="su-section" id="su-local">' +
      '<h3 class="su-title">小さな保存場所（localStorage・約5MB）' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'小さな保存場所\', event)" title="クリックで「小さな保存場所」をコピー">□</span></h3>' +
      _usageBar(g.total, LS_LIMIT_CHARS) +
      '<table class="su-table">' +
        _usageRow(mode === 'local' ? '保存データ（全部）' : '基本の設定', g.db, 'バックアップ対象') +
        _usageRow('見た目の設定', g.ui, '最後に開いた画面など') +
        (g.legacy ? _usageRow('移行前の古い控え（曲情報）', g.legacy, '今は使っていなければ「キャッシュを削除」で消せます', 'su-warn') : '') +
        (g.broken ? _usageRow('読めなかった保存データの控え（' + g.brokenKeys.length + '件）', g.broken, '前に壊れていたデータの控え（念のため残しています）') : '') +
        (g.mmOther ? _usageRow('その他（Music Manager）', g.mmOther, '') : '') +
        (otherTotal ? _usageRow('ほかのアプリ', otherTotal, '同じパソコンで index.html を開くアプリと同じ枠を分け合っています（' +
            otherApps.slice(0, 4).map(function (x) { return escapeHtml(x[0]) + ' ' + formatBytes(x[1]); }).join('・') + '）', otherTotal > LS_LIMIT_CHARS * 0.5 ? 'su-warn' : '') : '') +
      '</table>' +
    '</div>' +
    // ② 大きな保存場所
    '<div class="su-section" id="su-idb">' +
      '<h3 class="su-title">大きな保存場所（IndexedDB）' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'大きな保存場所\', event)" title="クリックで「大きな保存場所」をコピー">□</span></h3>' +
      '<p class="panel-meta" id="su-estimate">ブラウザ全体の使用量：計算中…</p>' +
      '<table class="su-table" id="su-idb-table"><tr><td colspan="3">計算中…</td></tr></table>' +
    '</div>' +
    // ③ 操作ボタン
    '<div class="btn-row su-actions">' +
      '<button class="btn-cancel" onclick="openClearCacheDialog()">' + ICONS.trash + 'キャッシュを削除</button>' +
      '<button class="btn-cancel" onclick="renderSetStorage()">' + ICONS.refresh + '表示を更新</button>' +
    '</div>' +
    (typeof artPrebuildHtml === 'function' ? artPrebuildHtml() : '') +
    '<p class="panel-desc">「キャッシュ」は、音楽ファイルからもう一度作れる控え（縮小したジャケット画像など）です。消してもプレイリスト・操作履歴・再生回数・入力した歌詞などは消えません。<br>' +
    'バックアップ（JSON）には、プレイリスト・操作履歴・設定など（バックアップ対象）が入ります。画像やキャッシュは入りません。</p>';
  el.innerHTML = h;
  _renderIdbUsage();
}

// 大きな保存場所の中身（非同期で数えて表に入れる）
async function _renderIdbUsage() {
  var rows = '';
  // プレイリスト・操作履歴など
  if (typeof dbStoreStats === 'function' && typeof dbStore !== 'undefined' && dbStore.mode === 'idb') {
    try {
      var st = await dbStoreStats();
      var keys = Object.keys(st.items).sort(function (a, b) { return st.items[b] - st.items[a]; });
      rows += _usageRow('<strong>プレイリスト・操作履歴など</strong>', st.total, 'バックアップ対象');
      var small = 0;
      keys.forEach(function (k) {
        if (st.items[k] < 2048) { small += st.items[k]; return; }   // 小さい項目はまとめる
        rows += _usageRow('　' + escapeHtml(DB_HEAVY_LABELS[k] || k), st.items[k],
          k === 'history' ? (db.history || []).length + '件（最大 ' + HISTORY_MAX + ' 件）' :
          k === 'playStats' ? Object.keys(db.playStats || {}).length + '曲分' :
          k === 'lyrics' ? Object.keys(db.lyrics || {}).length + '曲分' :
          k === 'playlists' ? (db.playlists || []).length + '件' : '', 'su-sub');
      });
      if (small) rows += _usageRow('　その他の設定（アルバム・アーティストなど）', small, '', 'su-sub');
      if (st.backups) rows += _usageRow('移行前のデータの控え', st.backups, 'v8.1 までの保存データをそのまま控えています' +
        (st.hasLegacy ? ' <button class="btn-inline-small" onclick="exportLegacyBackup()">' + ICONS.download + '書き出す</button>' : ''));
    } catch (e) {
      rows += _usageRow('プレイリスト・操作履歴など', '—', '読み取れませんでした');
    }
  }
  // 曲情報の控え
  try {
    var n = Object.keys(tagCache || {}).length;
    rows += _usageRow('曲情報の控え', n ? JSON.stringify(tagCache).length : 0, n + '曲分（キャッシュ。「曲情報を読み直す」で作り直せます）');
  } catch (e) { /* 無視 */ }
  // ジャケット画像の控え・アプリ内で設定したジャケット
  if (typeof artIdbStats === 'function') {
    try { var a = await artIdbStats(); rows += _usageRow('ジャケット画像の控え', a.bytes, a.count + 'アルバム分（キャッシュ。消しても次に表示するとき作り直します）'); }
    catch (e) { rows += _usageRow('ジャケット画像の控え', '—', '読み取れませんでした'); }
  }
  if (typeof userPicCount === 'function') {
    try { var up = await userPicCount(); rows += _usageRow('アプリ内で設定したジャケット', '—', up + '曲分（ogg・wav など。画像が大きいためバックアップには入りません）'); }
    catch (e) { /* 無視 */ }
  }
  var t = document.getElementById('su-idb-table');
  if (t) t.innerHTML = rows || '<tr><td colspan="3">ありません</td></tr>';
  // ブラウザ全体（このアプリとほかの file:// アプリの合計）
  var est = document.getElementById('su-estimate');
  if (est) {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var e = await navigator.storage.estimate();
        est.textContent = 'ブラウザ全体の使用量（ほかの file:// アプリを含む）：約 ' + formatBytes(e.usage || 0) + (e.quota ? ' ／ 上限 約 ' + formatBytes(e.quota) : '');
      } catch (err) { est.textContent = 'ブラウザ全体の使用量：読み取れませんでした'; }
    } else est.textContent = '';
  }
}

/* ---------- キャッシュの削除 ---------- */
// localStorage に残った移行前の曲情報の控えが、もう使われていないか（大きな保存場所に曲情報の控えがあるか）
async function _legacyLsUnused() {
  var has = LEGACY_LS_KEYS.some(function (k) { try { return localStorage.getItem(k) != null; } catch (e) { return false; } });
  if (!has || typeof _libTx !== 'function') return false;
  try { var rec = await _libTx('readonly', function (s) { return s.get(LIB_INDEX_KEY); }); return !!(rec && rec.v === 1); }
  catch (e) { return false; }
}
async function openClearCacheDialog() {
  var legacy = await _legacyLsUnused();
  var g = lsUsageGroups();
  var art = null;
  try { if (typeof artIdbStats === 'function') art = await artIdbStats(); } catch (e) { art = null; }
  var body = '<div class="dialog-message">消す控えを選んでください。音楽ファイル・プレイリスト・操作履歴・再生回数・入力した歌詞などは消えません。</div>' +
    '<div class="cc-list" id="cc-list">' +
      '<label class="cc-item"><input type="checkbox" data-cc="art" checked> ジャケット画像の控え（縮小画像' + (art ? '・' + art.count + 'アルバム分・約 ' + formatBytes(art.bytes) : '') + '）' +
        '<span class="cc-note">次に表示するときに、音楽ファイルからもう一度作ります</span></label>' +
      (legacy ? '<label class="cc-item"><input type="checkbox" data-cc="legacy" checked> 移行前の古い曲情報の控え（小さな保存場所・約 ' + formatBytes(g.legacy) + '）' +
        '<span class="cc-note">v2.7 から別の場所に移した残りで、今は使っていません</span></label>' : '') +
    '</div>';
  var chosen = null;
  var v = await openDialog({
    title: 'キャッシュの削除',
    size: 'small',
    body: body,
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '削除する', value: 'ok', cls: 'btn-danger', isDefault: true }],
    beforeClose: function (val, b) {
      if (val !== 'ok') return true;
      chosen = {};
      b.querySelectorAll('[data-cc]').forEach(function (c) { chosen[c.getAttribute('data-cc')] = c.checked; });
      if (!chosen.art && !chosen.legacy) { showToast('消す控えを選んでください。'); return false; }
      return true;
    }
  });
  if (v !== 'ok' || !chosen) return;
  var done = [];
  if (chosen.art && typeof artIdbClear === 'function') {
    try {
      if (typeof artPrebuildStop === 'function') artPrebuildStop(true);
      await artIdbClear();
      if (typeof artReset === 'function') artReset();
      done.push('ジャケット画像の控え');
    } catch (e) { showToast('ジャケット画像の控えを消せませんでした：' + (e && e.message ? e.message : e), true); }
  }
  if (chosen.legacy && legacy) {
    LEGACY_LS_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } });
    done.push('移行前の古い曲情報の控え');
  }
  renderAll();
  if (done.length) showToast(done.join('・') + 'を消しました。');
}

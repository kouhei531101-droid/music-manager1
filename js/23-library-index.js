/* =========================================================
   23-library-index.js ― 曲情報の控え（IndexedDB）と「情報のメモファイル」（v2.7）
   ・曲情報の控え（tagCache）と追加日（firstSeen）は、v2.6 まで localStorage に入れていたが、
     曲が多いと容量（約5MB）を超えて保存できず、毎回全曲を読み直していた。v2.7 から IndexedDB に置く
       DB：musicManager_library / store：index / key：'current'
       { v:1, folder:音楽フォルダ名, savedAt, changedAt, fullCheckAt, tagCache, firstSeen }
     古い localStorage の控えは、最初の起動で IndexedDB に移し、移せたら localStorage から消す
   ・情報のメモファイル：音楽フォルダ直下の「.music-manager-index.json.gz」（gzip で縮めた JSON）
       { format, formatVersion, tagVersion, appVersion, createdAt, folderName, fullCheckAt, count,
         tracks:[[相対パス, 大きさ, 更新日時, 曲名, アーティスト, アルバム, アルバムアーティスト, トラック, ディスク, 長さ, 追加日, コンピレーションの印(1/0。v2.9)], …] }
       （v2.9 で12番目の欄を足した。v3.1 で13番目にジャンル、14番目に発売年、v3.2 で15番目に控えの詳しさの版。
         古いメモファイルは欄が少ないままで読める。15番目が無い曲は、読み込みのときに裏でタグを読み直して補う）
     画像・歌詞の本文は入れない。ブラウザの控えが空のとき・メモファイルの方が新しいときに読み、一覧をすぐ作る。
     書き出しは「一時ファイル（.music-manager-index.tmp）に書く → 読み直して確かめる → 本体を置き換える → 一時ファイルを取り除く」。
     書き込みの許可が無いときは書かずに続ける（tools の「今すぐ書き出す」で許可を求める）。壊れたメモファイルは使わない
   ========================================================= */

var LIB_DB_NAME = 'musicManager_library', LIB_STORE = 'index', LIB_INDEX_KEY = 'current';
var MEMO_FILE_NAME = '.music-manager-index.json.gz';
var MEMO_TMP_NAME = '.music-manager-index.tmp';
var MEMO_FORMAT = 'music-manager-index', MEMO_FORMAT_VERSION = 1;
var LIB_SAVE_DELAY = 800;         // 控えの保存をまとめる待ち時間（ミリ秒）
var LIB_SAVE_DELAY_BUSY = 5000;   // 曲情報を読んでいる間の待ち時間

var libIndex = {
  loaded: false, loading: null,
  folder: '',        // 控えの音楽フォルダ名
  savedAt: 0,        // 最後に保存した日時
  changedAt: 0,      // 中身が最後に変わった日時（メモファイルと比べる）
  fullCheckAt: 0,    // 最終の全確認
  memoAt: 0,         // このブラウザが最後に書き出した・取り込んだメモファイルの更新日時（自分で書いたメモファイルを取り込み直さないため）
  saveTimer: 0
};

/* ---------- IndexedDB ---------- */
var _libDbPromise = null;
function _libDb() {
  if (!_libDbPromise) {
    _libDbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(LIB_DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(LIB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { _libDbPromise = null; reject(req.error); };
    });
  }
  return _libDbPromise;
}
function _libTx(mode, fn) {
  return _libDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(LIB_STORE, mode), result;
      var r = fn(tx.objectStore(LIB_STORE));
      if (r) r.onsuccess = function () { result = r.result; };
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}

// 控えを読む（1回だけ。何度呼んでも同じ Promise）
function libIndexEnsureLoaded() {
  if (libIndex.loaded) return Promise.resolve();
  if (!libIndex.loading) libIndex.loading = _libIndexLoad().then(function () { libIndex.loaded = true; });
  return libIndex.loading;
}
async function _libIndexLoad() {
  var rec = null;
  try { rec = await _libTx('readonly', function (s) { return s.get(LIB_INDEX_KEY); }); }
  catch (e) { console.warn('曲情報の控え（IndexedDB）を読めませんでした', e); }
  if (rec && rec.v === 1) {
    tagCache = rec.tagCache || {};
    firstSeen = rec.firstSeen || {};
    libIndex.folder = rec.folder || '';
    libIndex.savedAt = rec.savedAt || 0;
    libIndex.changedAt = rec.changedAt || rec.savedAt || 0;
    libIndex.fullCheckAt = rec.fullCheckAt || 0;
    libIndex.memoAt = rec.memoAt || 0;
    return;
  }
  // v2.6 までの localStorage の控えを移す（あれば）
  var oldTags = null, oldSeen = null;
  try { oldTags = JSON.parse(localStorage.getItem(TAG_CACHE_KEY) || 'null'); } catch (e) { oldTags = null; }
  try { oldSeen = JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || 'null'); } catch (e) { oldSeen = null; }
  if (oldTags || oldSeen) {
    tagCache = oldTags || {};
    firstSeen = oldSeen || {};
    libIndex.folder = db.settings.musicFolderName || fsa.folderName || '';
    libIndex.changedAt = Date.now();
    // 前の版は起動のたびに全曲の大きさ・更新日時を確かめていたので、全確認したものとして扱う（すぐに長い全確認をしない）
    libIndex.fullCheckAt = Object.keys(tagCache).length ? Date.now() : 0;
    try {
      await libIndexSaveNow();
      localStorage.removeItem(TAG_CACHE_KEY);
      localStorage.removeItem(FIRST_SEEN_KEY);
    } catch (e) { console.warn('曲情報の控えを IndexedDB に移せませんでした（次回また試します）', e); }
  }
}
// 中身が変わった（曲情報・追加日）。少し待ってまとめて保存
function libIndexChanged() {
  libIndex.changedAt = Date.now();
  libIndexSaveSoon();
}
function libIndexSaveSoon() {
  if (!libIndex.loaded) return;   // 読む前の空の控えで上書きしない
  if (libIndex.saveTimer) clearTimeout(libIndex.saveTimer);
  // 曲情報を読んでいる間は、保存の回数を減らす（1回の保存で全曲分を書くため）
  libIndex.saveTimer = setTimeout(function () { libIndex.saveTimer = 0; libIndexSaveNow().catch(function (e) { console.warn('曲情報の控えを保存できませんでした', e); }); },
    library.metaRunning ? LIB_SAVE_DELAY_BUSY : LIB_SAVE_DELAY);
}
function libIndexSaveNow() {
  if (libIndex.saveTimer) { clearTimeout(libIndex.saveTimer); libIndex.saveTimer = 0; }
  libIndex.folder = fsa.folderName || libIndex.folder;
  libIndex.savedAt = Date.now();
  var rec = { v: 1, folder: libIndex.folder, savedAt: libIndex.savedAt, changedAt: libIndex.changedAt, fullCheckAt: libIndex.fullCheckAt,
              memoAt: libIndex.memoAt, tagCache: tagCache, firstSeen: firstSeen };
  return _libTx('readwrite', function (s) { return s.put(rec, LIB_INDEX_KEY); });
}
// 閉じる前・ほかのタブに移るときに、まだ保存していない分を保存
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && libIndex.saveTimer) libIndexSaveNow().catch(function () { /* 無視 */ });
});
window.addEventListener('pagehide', function () { if (libIndex.saveTimer) libIndexSaveNow().catch(function () { /* 無視 */ }); });

/* ---------- 情報のメモファイル ---------- */
function memoEnabled() { return db.settings.memoFile !== false; }
var memoState = { status: '', message: '' };   // 'ok'・'no-permission'・'error'・'broken'（画面の表示用。保存しない）

async function _memoFileHandle(create) {
  return fsa.root.getFileHandle(MEMO_FILE_NAME, { create: !!create });
}
// メモファイルの大きさ・更新日時（無ければ null）
async function memoFileInfo() {
  if (!fsa.root) return null;
  try { var f = await (await _memoFileHandle(false)).getFile(); return { size: f.size, at: f.lastModified }; }
  catch (e) { return null; }
}
async function memoFileExists() { return !!(await memoFileInfo()); }

async function _gzip(text) {
  var s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(s).blob();
}
async function _gunzipText(blob) {
  var s = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(s).text();
}
// 読んで確かめる（形式が違う・壊れているときは null）
async function _memoParse(blob) {
  var obj = JSON.parse(await _gunzipText(blob));
  if (!obj || obj.format !== MEMO_FORMAT || obj.formatVersion !== MEMO_FORMAT_VERSION || !Array.isArray(obj.tracks)) throw new Error('メモファイルの形式が違います');
  return obj;
}
async function memoRead() {
  var fh;
  try { fh = await _memoFileHandle(false); } catch (e) { return null; }   // 無い
  try { return await _memoParse(await fh.getFile()); }
  catch (e) {
    console.warn('情報のメモファイルが読めないので使いません（通常の読み込みを続けます）', e);
    memoState = { status: 'broken', message: 'メモファイルが壊れていたため使いませんでした（次の書き出しで作り直します）' };
    return null;
  }
}
// メモファイルの中身を控えに取り込む（曲情報はメモファイルの値、追加日は早い方）。at：メモファイルの更新日時
function memoApply(obj, at) {
  var sameTagVersion = obj.tagVersion === TAG_CACHE_VERSION, n = 0;
  obj.tracks.forEach(function (r) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !r[0]) return;
    var p = r[0];
    if (sameTagVersion) {
      tagCache[p] = { v: TAG_CACHE_VERSION, s: r[1] || 0, m: r[2] || 0, t: r[3] || '', a: r[4] || '', l: r[5] || '', aa: r[6] || '', n: r[7] || 0, k: r[8] || 0, d: r[9] || 0 };
      if (r[11]) tagCache[p].cp = 1;
      if (r[12]) tagCache[p].g = String(r[12]);
      if (r[13]) tagCache[p].y = +r[13] || 0;
      if (r[14]) tagCache[p].f = +r[14] || 0;
      n++;
    }
    if (r[10] && (!firstSeen[p] || r[10] < firstSeen[p])) firstSeen[p] = r[10];
  });
  if (obj.fullCheckAt && obj.fullCheckAt > libIndex.fullCheckAt) libIndex.fullCheckAt = obj.fullCheckAt;
  // 控えはメモファイルと同じ時点の内容になった（メモファイルを書き直さない・次は取り込み直さない）
  libIndex.changedAt = Math.max(libIndex.changedAt, at || 0);
  libIndex.memoAt = at || 0;
  libIndexSaveSoon();
  return n;
}
// 読み込みの始めに呼ぶ：ブラウザの控えが空か、メモファイルの方が新しければ取り込む。取り込んだ曲数を返す
async function memoUseIfNewer() {
  if (!memoEnabled() || !fsa.root) return 0;
  var info = await memoFileInfo();
  if (!info) return 0;
  var empty = !Object.keys(tagCache).length || (libIndex.folder && libIndex.folder !== fsa.folderName);
  if (!empty && info.at <= Math.max(libIndex.changedAt, libIndex.memoAt)) return 0;   // ブラウザの控えの方が新しい（または自分で書いたメモファイル）
  var obj = await memoRead();
  if (!obj) return 0;
  if (empty) { tagCache = {}; }   // 別の音楽フォルダの控えは使わない
  return memoApply(obj, info.at);
}
function _memoBuild() {
  var rows = [];
  library.tracks.forEach(function (t) {
    var c = tagCache[t.path];
    if (!c || c.v !== TAG_CACHE_VERSION) return;
    rows.push([t.path, c.s || 0, c.m || 0, c.t || '', c.a || '', c.l || '', c.aa || '', c.n || 0, c.k || 0, c.d || 0, firstSeen[t.path] || 0, c.cp ? 1 : 0, c.g || '', c.y || 0, c.f || 0]);
  });
  return { format: MEMO_FORMAT, formatVersion: MEMO_FORMAT_VERSION, tagVersion: TAG_CACHE_VERSION, appVersion: APP_VERSION,
           createdAt: new Date().toISOString(), folderName: fsa.folderName, fullCheckAt: libIndex.fullCheckAt, count: rows.length, tracks: rows };
}
// 書き出す。interactive：ボタンから（書き込みの許可を求めてよい）。書けたら true
async function memoWrite(interactive) {
  if (!isConnected() || !library.tracks.length) return false;
  var perm = 'denied';
  try { perm = await fsa.root.queryPermission({ mode: 'readwrite' }); } catch (e) { /* 下で扱う */ }
  if (perm !== 'granted') {
    if (!interactive || !(await ensureWritePermission())) {
      memoState = { status: 'no-permission', message: '書き込みの許可が無いため、まだ書き出していません（「今すぐ書き出す」で許可すると書き出せます）' };
      _memoRenderIfShown();
      return false;
    }
  }
  try {
    var obj = _memoBuild();
    var blob = await _gzip(JSON.stringify(obj));
    // 1. 一時ファイルに書く → 2. 読み直して確かめる
    var tmp = await fsa.root.getFileHandle(MEMO_TMP_NAME, { create: true });
    var w = await tmp.createWritable();
    try { await w.write(blob); await w.close(); } catch (e) { try { await w.abort(); } catch (e2) { /* 無視 */ } throw e; }
    var check = await _memoParse(await tmp.getFile());
    if (check.count !== obj.count) throw new Error('書き出した内容を確かめられませんでした');
    // 3. 一時ファイルの名前を本体の名前に変えて置き換える（途中で止まっても、前のメモファイルか新しいメモファイルのどちらかが残る）
    var moved = false;
    if (typeof tmp.move === 'function') { try { await tmp.move(MEMO_FILE_NAME); moved = true; } catch (e) { /* 下の方法で */ } }
    if (!moved) {
      // move() が使えないとき：本体に書く（ブラウザは別名に書いてから差し替える）→ 自分で作った一時ファイルを取り除く
      var fh = await _memoFileHandle(true);
      var w2 = await fh.createWritable();
      try { await w2.write(blob); await w2.close(); } catch (e) { try { await w2.abort(); } catch (e2) { /* 無視 */ } throw e; }
      try { await fsa.root.removeEntry(MEMO_TMP_NAME); } catch (e) { /* 残っても一覧には出ない */ }
    }
    var done = await memoFileInfo();
    libIndex.memoAt = done ? done.at : Date.now();
    libIndexSaveSoon();
    memoState = { status: 'ok', message: '' };
    _memoRenderIfShown();
    return true;
  } catch (e) {
    console.warn('情報のメモファイルを書き出せませんでした', e);
    memoState = { status: 'error', message: '書き出せませんでした：' + (e && e.message ? e.message : e) };
    _memoRenderIfShown();
    return false;
  }
}
// 読み込みが終わったとき：変化があれば（またはメモファイルが無い・古ければ）黙って書き出す
async function memoAutoWrite() {
  if (!memoEnabled() || !isConnected()) return;
  var info = await memoFileInfo();
  if (info && info.at >= libIndex.changedAt) return;   // 変化なし（メモファイルの方が新しいか同じ）
  await memoWrite(false);
}

/* ---------- tools の「情報のメモファイル」欄 ---------- */
function _memoRenderIfShown() { if (currentPage === 'settings') renderSetMemo(); }
function renderSetMemo() {
  var el = document.getElementById('set-memo');
  if (!el) return;
  var on = memoEnabled();
  var h = '<label class="tagedit-write"><input type="checkbox" ' + (on ? 'checked ' : '') + 'onchange="setMemoEnabled(this.checked)">情報のメモファイルを使う（おすすめ）</label>' +
    '<dl class="set-dl"><dt>最終書き出し</dt><dd id="memo-at">' + (fsa.root ? '確認中…' : '（音楽フォルダが選ばれていません）') + '</dd>' +
    '<dt>大きさ</dt><dd id="memo-size">—</dd></dl>';
  if (memoState.message) h += '<p class="panel-desc ' + (memoState.status === 'ok' ? '' : 'text-warn') + '">' + escapeHtml(memoState.message) + '</p>';
  h += '<div class="btn-row">' +
    '<button class="btn-cancel" onclick="memoWriteFromUi()"' + (isConnected() ? '' : ' disabled') + '>' + ICONS.download + '今すぐ書き出す</button>' +
    '<button class="btn-inline-small btn-inline-danger" onclick="memoMoveToTrash()"' + (isConnected() ? '' : ' disabled') + '>' + ICONS.trash + '削除フォルダへ移す</button></div>';
  el.innerHTML = h;
  memoFileInfo().then(function (info) {
    var a = document.getElementById('memo-at'), s = document.getElementById('memo-size');
    if (!a) return;
    a.textContent = info ? formatDateTime(info.at) : (fsa.root ? 'まだありません' : '—');
    if (s) s.textContent = info ? formatBytes(info.size) + '（' + Object.keys(tagCache).length + '曲分の曲情報）' : '—';
  });
}
function setMemoEnabled(on) {
  db.settings.memoFile = !!on; saveDB();
  if (on && isConnected() && !isLibraryLoading()) memoAutoWrite().then(_memoRenderIfShown);
  renderSetMemo();
}
async function memoWriteFromUi() {
  if (isLibraryLoading()) { showToast('読み込み中です。終わってから、もう一度押してください。'); return; }
  showBusy('情報のメモファイルを書き出しています…');
  var ok;
  try { ok = await memoWrite(true); } finally { hideBusy(); }
  showToast(ok ? '情報のメモファイルを書き出しました。' : memoState.message, !ok);
  renderSetMemo();
}
// 削除フォルダへ移す（ファイル整理と同じ確認・操作履歴・元に戻す）。移したらメモファイルは使わない設定にする
async function memoMoveToTrash() {
  if (!(await memoFileExists())) { showToast('メモファイルはありません。'); return; }
  var before = db.settings.memoFile;
  db.settings.memoFile = false;   // 移したあとの読み込みで作り直さないように
  await runFileOperation('trash', [{ from: MEMO_FILE_NAME, to: TRASH_FOLDER_NAME + '/' + MEMO_FILE_NAME }]);
  if (await memoFileExists()) db.settings.memoFile = before;   // やめた・できなかった
  else showToast('メモファイルを削除フォルダへ移し、情報のメモファイルを使わない設定にしました。');
  saveDB();
  renderSetMemo();
}

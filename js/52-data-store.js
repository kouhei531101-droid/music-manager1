/* =========================================================
   52-data-store.js ― 保存データの置き場所（v8.2）
   ・v8.1 までは保存データ（db）を丸ごと localStorage の 'musicManager_v1' に入れていた。
     localStorage は約5MB しかなく、しかも file:// で開くほかのアプリ（garden-journal など）と同じ枠を分け合うため、
     操作履歴（曲情報の編集・一括編集で大きくなる）・再生回数などが増えると「保存容量がいっぱい」になって保存できなかった。
   ・v8.2 からは2か所に分ける
       小さな保存場所（localStorage 'musicManager_v1'）＝「基本の設定」：settings・nextId・アルバムのタグの一覧・洋楽／季節の言葉など
         形：{ storeV: 2, schema, settings, nextId, albumTags, westernMethod, westernWords, westernGenres, seasonWords }
       大きな保存場所（IndexedDB 'musicManager_store' / store 'kv'）＝「プレイリスト・操作履歴など」：DB_HEAVY_KEYS の項目
         key 'h:項目名' → JSON の文字列、key 'meta' → { v:1, savedAt, keys }
         key 'light' → 基本の設定の写し（JSON の文字列。localStorage だけ消えたときに使う）
         key 'legacyBackup' → { at, raw }（最初の移行のときの localStorage の中身をそのまま控える。元に戻すとき用）
         key 'prevHeavyBackup' → { at, data }（古い形のデータで移し直す前の、大きな保存場所の中身の控え）
   ・起動の流れ：01-core.js が localStorage を読んで db を作る（古い形なら全部入り、新しい形なら基本の設定だけ）
       → 12-init.js が dbStoreInit() を待つ → ここで大きな保存場所を読んで db に合わせる／古い形なら移す → 画面を作る
   ・移す手順：①最初の中身を legacyBackup に控える → ②大きな保存場所に全部書く → ③読み直して同じか確かめる
       → ④確かめられたら localStorage を「基本の設定」だけに書き換える（ここで初めて localStorage が小さくなる）。
       途中で失敗したら localStorage は古い形のまま残し、今までどおり localStorage だけで動く（次回また移す）
   ・保存（saveDB）：基本の設定はすぐ localStorage に。大きな保存場所へは少し待ってまとめて、変わった項目だけ書く
       （閉じる前・別のタブに移るときは、待たずに書く）
   ・保存に失敗したとき（容量不足など）は、アプリを止めずに「容量不足のお知らせ」を出す（1回目はダイアログ、2回目からはお知らせ）
   ========================================================= */

var STORE_DB_NAME = 'musicManager_store', STORE_KV = 'kv';
// 大きな保存場所に置く項目（それ以外は基本の設定として localStorage に残す）
var DB_HEAVY_KEYS = ['playlists', 'history', 'playStats', 'lyrics', 'tagOverrides', 'albumOrder', 'hiddenAlbums', 'pinnedAlbums', 'pinnedArtists',
  'artistCovers', 'albumTagOf', 'albumSortKeys', 'westernAlbums', 'westernArtists', 'dupIgnore', 'genreSuggest', 'bpmManual', 'seasonOverride', 'skCovers', 'seasonHidden'];
// 画面に出すときの名前（保存容量の使用状況）
var DB_HEAVY_LABELS = {
  playlists: 'プレイリスト', history: '操作履歴', playStats: '再生回数の記録', lyrics: '入力した歌詞', tagOverrides: 'アプリ内の曲情報の上書き',
  albumOrder: 'アルバムのカスタム順', hiddenAlbums: '非表示のアルバム', pinnedAlbums: 'Pin したアルバム', pinnedArtists: 'Pin したアーティスト',
  artistCovers: 'アーティストの代表ジャケット', albumTagOf: 'アルバムに付けたタグ', albumSortKeys: 'アルバムのソートキー',
  westernAlbums: '洋楽の指定（アルバム）', westernArtists: '洋楽の指定（アーティスト）', dupIgnore: '重複ではない の印', genreSuggest: 'ジャンルの候補',
  bpmManual: '手で入れた BPM', seasonOverride: '手で決めた季節', skCovers: 'ソートキーの枠の代表ジャケット',
  seasonHidden: 'Seasons Song で非表示にした曲'   // v8.13.0
};
var DB_STORE_SAVE_DELAY = 400;   // 大きな保存場所へ書くまでの待ち時間（ミリ秒）

var dbStore = {
  mode: 'pending',   // 'pending' 起動中／'idb' 2か所に保存／'local' localStorage だけ（大きな保存場所が使えない・移せなかった）／'broken' 大きな保存場所を読めなかった
  saved: {},         // 大きな保存場所に最後に書いた中身（項目名 → JSON の文字列。'light' は基本の設定の写し）。同じなら書かない
  timer: 0,
  chain: Promise.resolve(true),
  lastError: null,
  noticeShown: false, lastToastAt: 0,
  migratedNow: false
};

/* ---------- IndexedDB ---------- */
var _storeDbPromise = null;
function _storeDb() {
  if (!_storeDbPromise) {
    _storeDbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('このブラウザでは IndexedDB が使えません')); return; }
      var req = indexedDB.open(STORE_DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE_KV); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { _storeDbPromise = null; reject(req.error); };
      req.onblocked = function () { console.warn('保存場所（IndexedDB）がほかのタブにふさがれています'); };
    });
  }
  return _storeDbPromise;
}
// 決まった時間で諦める（開けないまま画面が出ないのを防ぐ）
function _withTimeout(p, ms, msg) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error(msg || '時間切れ')); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}
// まとめて読む { key: 値 }
function _storeGetAll() {
  return _storeDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE_KV, 'readonly'), st = tx.objectStore(STORE_KV), out = {};
      var req = st.openCursor();
      req.onsuccess = function () { var c = req.result; if (!c) return; out[String(c.key)] = c.value; c.continue(); };
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}
// まとめて書く { key: 値 }（1つのトランザクション。途中で失敗したら全部書かれない）
function _storePutMany(map) {
  return _storeDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE_KV, 'readwrite'), st = tx.objectStore(STORE_KV);
      Object.keys(map).forEach(function (k) { st.put(map[k], k); });
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('保存が中止されました')); };
    });
  });
}

/* ---------- 基本の設定（localStorage）と大きな項目に分ける ---------- */
function dbLightJson(d) {
  d = d || db;
  var o = { storeV: 2 };
  Object.keys(d).forEach(function (k) { if (DB_HEAVY_KEYS.indexOf(k) < 0 && k !== 'storeV') o[k] = d[k]; });
  return JSON.stringify(o);
}
function _heavyStrings(d) {
  d = d || db;
  var out = {};
  DB_HEAVY_KEYS.forEach(function (k) { out[k] = JSON.stringify(d[k] === undefined ? null : d[k]); });
  return out;
}
function _isEmptyVal(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return !v.length;
  if (typeof v === 'object') return !Object.keys(v).length;
  return false;
}
function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

/* ---------- 起動：大きな保存場所を読む／古い形を移す（12-init.js から呼ぶ） ---------- */
// 思わぬ失敗でも「起動中」のまま（何も保存されない）にならないようにする
async function dbStoreStart() {
  try { await dbStoreInit(); }
  catch (e) {
    console.error('dbStoreInit で思わぬ失敗', e);
    dbStore.lastError = e;
    var light = null;
    try { light = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e2) { light = null; }
    dbStore.mode = (light && light.storeV === 2) ? 'broken' : 'local';
  }
  return dbStore.mode;
}

async function dbStoreInit() {
  var rawStr = null, raw = null;
  try { rawStr = localStorage.getItem(DB_KEY); raw = rawStr ? JSON.parse(rawStr) : null; } catch (e) { raw = null; }   // 壊れていたら 01-core.js の loadDB が別のキーに控え済み
  var all;
  try { all = await _withTimeout(_storeGetAll(), 8000, '保存場所（IndexedDB）を開けませんでした（時間切れ）'); }
  catch (e) {
    console.error('dbStoreInit: IndexedDB を開けません', e);
    dbStore.lastError = e;
    if (raw && raw.storeV === 2) {
      // プレイリストなどは大きな保存場所にあるのに読めない。空のまま上書きしないように、大きな項目は保存しない
      dbStore.mode = 'broken';
      setTimeout(function () {
        showAlert({ title: '保存データを読み込めませんでした',
          message: 'プレイリスト・操作履歴などを置いているブラウザ内の保存場所（IndexedDB）を開けませんでした。<br>' +
            'ほかの Music Manager のタブを閉じてから、このページを開き直してください。<br>' +
            '<strong>このまま使うと、プレイリストなどの変更は保存されません。</strong>（' + escapeHtml(e && e.message ? e.message : String(e)) + '）' });
      }, 300);
    } else {
      dbStore.mode = 'local';   // 古い形のまま、今までどおり localStorage だけで動く
    }
    return dbStore.mode;
  }

  var hasHeavy = !!all.meta;
  var heavyFromIdb = {};
  DB_HEAVY_KEYS.forEach(function (k) {
    var s = all['h:' + k];
    if (typeof s === 'string') { try { heavyFromIdb[k] = JSON.parse(s); } catch (e) { console.warn('保存データの一部を読めませんでした', k, e); } }
  });

  if (raw && raw.storeV === 2) {
    // 新しい形：基本の設定（localStorage）＋大きな保存場所
    var merged = Object.assign({}, raw, heavyFromIdb);
    db = normalizeDB(merged);
    dbStore.mode = 'idb';
    DB_HEAVY_KEYS.forEach(function (k) { if (typeof all['h:' + k] === 'string') dbStore.saved[k] = all['h:' + k]; });
    if (typeof all.light === 'string') dbStore.saved.light = all.light;
    if (!hasHeavy) {
      setTimeout(function () {
        showAlert({ title: 'プレイリストなどの保存データが見つかりません',
          message: 'ブラウザ内の保存場所（IndexedDB）に、プレイリスト・操作履歴などのデータがありませんでした（ブラウザのデータを消した可能性があります）。<br>' +
            '「設定・バックアップ」の「バックアップから復元」で、書き出しておいたバックアップ（JSON）から戻せます。' });
      }, 300);
    }
    return dbStore.mode;
  }

  if (raw) {
    // 古い形（v8.1 まで）：localStorage に全部入っている → 大きな保存場所へ移す
    try {
      var safety = {};
      if (!all.legacyBackup) safety.legacyBackup = { at: nowIso(), raw: rawStr };   // 最初の移行のときの中身をそのまま控える
      if (hasHeavy) {
        // 前に移したことがある（古い版のタブが書き戻した等）。今の大きな保存場所の中身も控える
        var prev = {};
        DB_HEAVY_KEYS.forEach(function (k) { if (typeof all['h:' + k] === 'string') prev[k] = all['h:' + k]; });
        safety.prevHeavyBackup = { at: nowIso(), data: prev };
      }
      if (Object.keys(safety).length) await _storePutMany(safety);
    } catch (e) {
      console.error('移行前の控えを保存できませんでした', e);
      dbStore.mode = 'local'; dbStore.lastError = e;
      return dbStore.mode;
    }
    var src = Object.assign({}, raw);
    if (hasHeavy) {
      // 古い形の方が空の項目は、大きな保存場所の中身を使う（古い版のタブが空のまま書き戻したときに消えないように）
      DB_HEAVY_KEYS.forEach(function (k) { if (_isEmptyVal(src[k]) && !_isEmptyVal(heavyFromIdb[k])) src[k] = heavyFromIdb[k]; });
    }
    db = normalizeDB(src);
    var ok = false;
    try {
      var strs = _heavyStrings(db), put = {};
      DB_HEAVY_KEYS.forEach(function (k) { put['h:' + k] = strs[k]; });
      put.light = strs.light = dbLightJson(db);
      put.meta = { v: 1, savedAt: nowIso(), keys: DB_HEAVY_KEYS.slice() };
      await _storePutMany(put);
      // 読み直して確かめる
      var back = await _storeGetAll();
      ok = DB_HEAVY_KEYS.every(function (k) { return back['h:' + k] === strs[k]; }) && back.light === strs.light;
      if (ok) dbStore.saved = strs;
    } catch (e) {
      console.error('保存データを大きな保存場所に移せませんでした', e);
      dbStore.lastError = e;
      ok = false;
    }
    if (!ok) { dbStore.mode = 'local'; return dbStore.mode; }   // localStorage は古い形のまま残っている
    try {
      localStorage.setItem(DB_KEY, dbLightJson(db));
    } catch (e) {
      // 基本の設定は元の中身より小さいので、ふつうは失敗しない。失敗したら（大きな保存場所に確かめて書けているので）
      // 古い形を取り除いてから書き直す。それでも書けないときは、次の起動で大きな保存場所の写し（light）から読む
      console.error('localStorage を書き換えられませんでした', e);
      dbStore.lastError = e;
      try { localStorage.removeItem(DB_KEY); localStorage.setItem(DB_KEY, dbLightJson(db)); } catch (e2) { console.error('基本の設定を書けませんでした', e2); }
    }
    dbStore.mode = 'idb';
    dbStore.migratedNow = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* 無視 */ }
    setTimeout(function () { showToast('保存データ（プレイリスト・操作履歴など）を、容量の大きいブラウザ内の保存場所に移しました。'); }, 600);
    return dbStore.mode;
  }

  // localStorage に何もない（初めて・またはブラウザの localStorage だけ消えた）
  if (hasHeavy) {
    var lightCopy = null;
    try { lightCopy = typeof all.light === 'string' ? JSON.parse(all.light) : null; } catch (e) { lightCopy = null; }
    db = normalizeDB(Object.assign({}, lightCopy || db, heavyFromIdb));
    DB_HEAVY_KEYS.forEach(function (k) { if (typeof all['h:' + k] === 'string') dbStore.saved[k] = all['h:' + k]; });
    try { localStorage.setItem(DB_KEY, dbLightJson(db)); } catch (e) { /* 次の保存でまた書く */ }
  }
  dbStore.mode = 'idb';
  return dbStore.mode;
}

/* ---------- 保存（01-core.js の saveDB から呼ぶ） ---------- */
function dbStoreSave() {
  if (dbStore.mode === 'pending') return true;   // 起動中（読み終わったら置き換わる）
  if (dbStore.mode === 'local') {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) { console.error('saveDB error', e); notifyStorageProblem(e, 'local'); return false; }
  }
  // 'idb'・'broken'：基本の設定はすぐ書く
  var ok = true;
  try { localStorage.setItem(DB_KEY, dbLightJson(db)); }
  catch (e) { console.error('saveDB error（基本の設定）', e); notifyStorageProblem(e, 'light'); ok = false; }
  if (dbStore.mode === 'idb') {
    if (dbStore.timer) clearTimeout(dbStore.timer);
    dbStore.timer = setTimeout(function () { dbStore.timer = 0; dbStoreFlush(); }, DB_STORE_SAVE_DELAY);
  } else if (dbStore.mode === 'broken') {
    _storageToast('プレイリスト・操作履歴などの変更は保存されていません（保存場所を開けませんでした。ページを開き直してください）。');
  }
  return ok;
}
// 待たずに大きな保存場所へ書く。成功したら true（順番に1つずつ書く）
function dbStoreFlush() {
  if (dbStore.timer) { clearTimeout(dbStore.timer); dbStore.timer = 0; }
  dbStore.chain = dbStore.chain.then(function () {
    if (dbStore.mode !== 'idb') return true;
    var strs = _heavyStrings(db), put = {}, changed = [];
    DB_HEAVY_KEYS.forEach(function (k) { if (strs[k] !== dbStore.saved[k]) { put['h:' + k] = strs[k]; changed.push(k); } });
    strs.light = dbLightJson(db);
    if (strs.light !== dbStore.saved.light) { put.light = strs.light; changed.push('light'); }
    if (!changed.length) return true;
    put.meta = { v: 1, savedAt: nowIso(), keys: DB_HEAVY_KEYS.slice() };
    return _storePutMany(put).then(function () {
      changed.forEach(function (k) { dbStore.saved[k] = strs[k]; });
      return true;
    }).catch(function (e) {
      console.error('保存データを書けませんでした（IndexedDB）', e);
      dbStore.lastError = e;
      notifyStorageProblem(e, 'idb');
      return false;
    });
  });
  return dbStore.chain;
}
// 閉じる前・ほかのタブに移るときに、まだ書いていない分を書く
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dbStore.timer) dbStoreFlush(); });
window.addEventListener('pagehide', function () { if (dbStore.timer) dbStoreFlush(); });

// 中身を丸ごと置き換える（復元）。基本の設定と大きな保存場所の両方に書けたら true。失敗したら元に戻して false
async function dbStoreReplaceAll(next) {
  var before = db;
  var beforeLight = null;
  try { beforeLight = localStorage.getItem(DB_KEY); } catch (e) { beforeLight = null; }
  if (dbStore.mode === 'broken') { dbStore.lastError = new Error('保存場所（IndexedDB）を開けていません'); return false; }
  db = next;
  if (dbStore.mode === 'local' || dbStore.mode === 'pending') {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) {
      dbStore.lastError = e; db = before;
      try { if (beforeLight != null) localStorage.setItem(DB_KEY, beforeLight); } catch (e2) { /* 元のデータはメモリ上に残っている */ }
      return false;
    }
  }
  try {
    localStorage.setItem(DB_KEY, dbLightJson(db));
    var ok = await dbStoreFlush();
    if (!ok) throw dbStore.lastError || new Error('保存できませんでした');
    return true;
  } catch (e) {
    console.error('復元の保存に失敗', e);
    dbStore.lastError = e;
    db = before;
    try { if (beforeLight != null) localStorage.setItem(DB_KEY, beforeLight); } catch (e2) { /* 無視 */ }
    dbStore.saved = {};   // 途中まで書いたかもしれないので、元の中身を全部書き直す
    await dbStoreFlush();
    return false;
  }
}

// 別のタブで変更されたとき（12-init.js の storage イベント）
function dbStoreOnStorageEvent(ev) {
  if (ev.key !== DB_KEY || !ev.newValue) return;
  var parsed;
  try { parsed = JSON.parse(ev.newValue); } catch (e) { return; }
  if (!parsed || parsed.storeV !== 2) {
    // 古い版のタブが全部入りで書いた。メモリだけ合わせる（次の起動のときに移す）
    db = normalizeDB(parsed); renderAll(); return;
  }
  if (dbStore.mode !== 'idb') return;
  // 大きな保存場所は少し遅れて書かれるので、待ってから読む
  setTimeout(function () {
    _storeGetAll().then(function (all) {
      var merged = {};
      var light; try { light = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { light = null; }
      if (!light) return;
      Object.assign(merged, light);
      DB_HEAVY_KEYS.forEach(function (k) {
        var s = all['h:' + k];
        if (typeof s === 'string') { try { merged[k] = JSON.parse(s); dbStore.saved[k] = s; } catch (e) { /* 無視 */ } }
      });
      db = normalizeDB(merged);
      renderAll();
    }).catch(function (e) { console.warn('別のタブの変更を読めませんでした', e); });
  }, 1200);
}

/* ---------- 容量不足のお知らせ ---------- */
function _storageToast(msg) {
  var now = Date.now();
  if (now - dbStore.lastToastAt < 8000) return;   // 続けて出しすぎない
  dbStore.lastToastAt = now;
  showToast(msg, true, { label: '保存容量を見る', fn: openStorageUsage });
}
function notifyStorageProblem(e, where) {
  var quota = isQuotaError(e);
  var what = where === 'idb' ? 'プレイリスト・操作履歴など' : (where === 'light' ? '基本の設定' : '保存データ');
  var msg = quota ? 'ブラウザの保存容量がいっぱいで、' + what + 'を保存できませんでした。'
                  : what + 'を保存できませんでした（' + (e && e.message ? e.message : String(e)) + '）。';
  if (!dbStore.noticeShown && typeof openDialog === 'function') {
    dbStore.noticeShown = true;
    openDialog({
      title: '容量不足のお知らせ',
      size: 'small',
      body: '<div class="dialog-message">' + escapeHtml(msg) + '<br>アプリはこのまま使えますが、今の変更は保存されていない可能性があります。<br>' +
        '「設定・バックアップ」の<strong>保存容量の使用状況</strong>で、何が容量を使っているか確かめられます。' +
        (where === 'local' || where === 'light' ? '<br>同じパソコンで index.html を開くほかのアプリ（garden-journal など）と、ブラウザの小さな保存場所（約5MB）を分け合っています。' : '') +
        '<br>念のため、<strong>バックアップを書き出して</strong>おくことをおすすめします。</div>',
      buttons: [
        { label: '閉じる', value: 'close', cls: 'btn-cancel' },
        { label: 'バックアップを書き出す', value: 'backup', cls: 'btn-cancel' },
        { label: '保存容量の使用状況を見る', value: 'usage', cls: 'btn-save', isDefault: true }
      ]
    }).then(function (v) {
      if (v === 'usage') openStorageUsage();
      else if (v === 'backup' && typeof exportBackup === 'function') exportBackup();
    });
    return;
  }
  _storageToast(msg);
}
// 「設定・バックアップ」の「保存容量の使用状況」を開く
function openStorageUsage() {
  showPage('settings');
  setTimeout(function () {
    var el = document.getElementById('set-storage-panel');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

/* ---------- 保存容量の使用状況のための数字 ---------- */
// 大きな保存場所の項目ごとの大きさ（文字数。localStorage の「約5MB」と同じ数え方の目安）と控えの大きさ
function dbStoreStats() {
  return _storeGetAll().then(function (all) {
    var items = {}, total = 0, backups = 0;
    Object.keys(all).forEach(function (k) {
      var v = all[k];
      if (k.indexOf('h:') === 0 && typeof v === 'string') { items[k.slice(2)] = v.length; total += v.length; }
      else if (k === 'legacyBackup' && v && typeof v.raw === 'string') backups += v.raw.length;
      else if (k === 'prevHeavyBackup' && v && v.data) Object.keys(v.data).forEach(function (x) { backups += String(v.data[x]).length; });
    });
    return { items: items, total: total, backups: backups, hasLegacy: !!all.legacyBackup, hasPrev: !!all.prevHeavyBackup };
  });
}
// 移行前のデータの控えを JSON で書き出す（バックアップと同じ形。復元で読み込める）
async function exportLegacyBackup() {
  var all = await _storeGetAll();
  var rec = all.legacyBackup;
  if (!rec || typeof rec.raw !== 'string') { showToast('移行前のデータの控えはありません。'); return; }
  var data; try { data = JSON.parse(rec.raw); } catch (e) { showToast('控えを読めませんでした。', true); return; }
  var payload = { app: 'music-manager', format: 1, appVersion: 'v8.1 まで（移行前の控え）', exportedAt: rec.at || nowIso(),
                  musicFolderName: (data.settings && data.settings.musicFolderName) || '', data: data };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'music-manager-移行前の控え-' + String(rec.at || '').slice(0, 10) + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  showToast('移行前のデータの控えを書き出しました（ダウンロードフォルダを確認してください）');
}

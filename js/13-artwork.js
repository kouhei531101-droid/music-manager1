/* =========================================================
   13-artwork.js ― ジャケット画像
   ・探す順番：①曲ファイルに埋め込まれた画像 → ②曲と同じフォルダの cover / folder / front / albumart 系の jpg・png
              → ③仮画像（音符のアイコン）
   ・同じアルバム（フォルダ＋アルバム名）は1回だけ取り出し、小さく縮小して IndexedDB に控える
     （localStorage やバックアップ JSON には入れない。「設定・バックアップ」の保存容量から消せる）
   ・曲一覧・プレイリストの曲では、画面に見えている行の分だけ読み込む（遅延読み込み）
   ・object URL（blob:）は、使わなくなったら解放する
   ・速さのための工夫（v2.5）：
       控え（IndexedDB）はまとめて1回で読む（見えているカードの分を一度に）。控えにある物は「同時に取り出す数」の枠を使わない
       画面から外れた要求は取り消す（見えている物だけを取り出す）。曲情報がまだの曲は、その曲の曲情報を先に読む
       控えに無い物は、画面の上の物から先に取り出す
   ・ジャケット拡大表示：再生バーのジャケットを押すと、元の大きさの画像を表示
   ・音楽ファイル・画像ファイルは読むだけ
   ========================================================= */

var ART_THUMB_SIZE = 400;       // 控えに保存する画像の大きさ（長い辺のピクセル）。v1.2 でアルバムカード用に 320→400
                                // （大きさの違う古い控えは、使うときに取り出し直す）
var ART_MEM_MAX = 1000;         // メモリに持っておくアルバム数（超えたら古いものから解放）。v2.5 で 300→1000
                                // （控えの画像は 1枚 30KB 前後。songs を行き来したときの取り出し直しを減らす）
var ART_CONCURRENCY = 3;        // 同時に取り出す数
var ART_FOLDER_IMAGE_RE = /^(cover|folder|front|albumart)[^\\/]*\.(jpe?g|png)$/i;
var ART_FOLDER_PRIORITY = ['cover', 'folder', 'front', 'albumart'];
var ART_SOURCE_LABELS = { app: 'アプリ内で設定した画像', embedded: '曲ファイルに埋め込まれた画像', folder: 'フォルダの画像', none: 'ジャケット画像なし' };

var art = {
  mem: new Map(),       // アルバムの key → { url（blob: または null）, source }。Map の順番＝最近使った順
  loading: new Map(),   // key → Promise（同じアルバムを同時に2回取り出さない）
  waiting: new Map(),   // key → { track, els:Set }（読み込み待ちの表示場所）
  queue: [],            // 控えに無く、曲ファイル・フォルダから取り出す物（key。後ろほど新しく見えた物）
  lookup: [],           // 控えをまとめて読む待ち（key）
  lookupTimer: 0,
  active: 0,
  observer: null,
  pinnedKey: null,      // 再生バーで使っている key（解放しない）
  gen: 0,               // リセットのたびに増やす（古い読み込み結果を捨てるため）
  viewerUrl: null,
  viewerToken: 0
};

// 同じアルバムの目印：音楽フォルダ名 / フォルダ | アルバム名
// v6.2：アルバム名のタグが無い曲（表示のアルバム名はフォルダ名から推定）は、曲ごとの目印にする。
//   同じフォルダのアルバム名の無い曲（シングルなど）が、どれも最初に読んだ曲のジャケットになっていたため
function artKeyOf(t) {
  if (t.albumGuessed || !t.album) return (fsa.folderName || '') + '/' + t.folder + '|#' + t.name;
  return (fsa.folderName || '') + '/' + t.folder + '|' + (t.album || '');
}

/* ---------- IndexedDB（縮小したジャケット画像の控え） ---------- */
var ART_DB_NAME = 'musicManager_artwork';
var ART_STORE = 'thumbs';
var _artDbPromise = null;
function _artDb() {
  if (!_artDbPromise) {
    _artDbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(ART_DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(ART_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { _artDbPromise = null; reject(req.error); };
    });
  }
  return _artDbPromise;
}
function _artTx(mode, fn) {
  return _artDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(ART_STORE, mode);
      var result;
      var r = fn(tx.objectStore(ART_STORE));
      if (r) r.onsuccess = function () { result = r.result; };
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}
function artIdbGet(key) { return _artTx('readonly', function (s) { return s.get(key); }); }
// まとめて読む（1回の読み取りで複数件。v2.5）。{ key: 控え } を返す（無い物は入らない）
function artIdbGetMany(keys) {
  return _artDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(ART_STORE, 'readonly'), st = tx.objectStore(ART_STORE), out = {};
      keys.forEach(function (k) { var r = st.get(k); r.onsuccess = function () { if (r.result) out[k] = r.result; }; });
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}
// 控えが使えるか（大きさが今の設定と同じ物だけ）
function _artRecOk(rec) { return !!(rec && rec.blob && rec.size === ART_THUMB_SIZE); }
function artIdbSet(key, value) { return _artTx('readwrite', function (s) { return s.put(value, key); }); }
function artIdbClear() { return _artTx('readwrite', function (s) { return s.clear(); }); }
function artIdbDelete(key) { return _artTx('readwrite', function (s) { return s.delete(key); }); }

/* ---------- アプリ内で設定したジャケット（ogg・wav など、ファイルに書き込めない曲。v2.0） ----------
   別の IndexedDB（musicManager_userArtwork / pics）に { blob, mime, width, height, removed, at } を曲の相対パスで保存。
   removed:true は「ジャケットを外した」（埋め込み・フォルダの画像も表示しない）。
   画像は大きいので、バックアップ JSON には入れない */
var USER_ART_DB = 'musicManager_userArtwork', USER_ART_STORE = 'pics';
var _userArtDbPromise = null;
function _userArtDb() {
  if (!_userArtDbPromise) {
    _userArtDbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(USER_ART_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(USER_ART_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { _userArtDbPromise = null; reject(req.error); };
    });
  }
  return _userArtDbPromise;
}
function _userArtTx(mode, fn) {
  return _userArtDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(USER_ART_STORE, mode), result;
      var r = fn(tx.objectStore(USER_ART_STORE));
      if (r) r.onsuccess = function () { result = r.result; };
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}
function userPicGet(key) { return _userArtTx('readonly', function (s) { return s.get(key); }); }
function userPicSet(key, rec) { return _userArtTx('readwrite', function (s) { return s.put(rec, key); }); }
function userPicDelete(key) { return _userArtTx('readwrite', function (s) { return s.delete(key); }); }
function userPicCount() {
  return _userArtTx('readonly', function (s) { return s.getAllKeys(); }).then(function (keys) {
    return (keys || []).filter(function (k) { k = String(k); return k.indexOf('undo:') !== 0 && k.indexOf('artist:') !== 0; }).length;
  });
}
// ファイル整理で曲を移動・名前変更したとき、アプリ内のジャケットも付け替える
async function userPicMovePaths(map) {
  var froms = Object.keys(map || {});
  for (var i = 0; i < froms.length; i++) {
    try {
      var rec = await userPicGet(froms[i]);
      if (rec) { await userPicSet(map[froms[i]], rec); await userPicDelete(froms[i]); }
    } catch (e) { console.warn('アプリ内のジャケットを付け替えられませんでした', froms[i], e); }
  }
}
// 件数と合計サイズ（設定・バックアップの保存容量で表示）
function artIdbStats() {
  return _artDb().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var count = 0, bytes = 0;
      var tx = idb.transaction(ART_STORE, 'readonly');
      var req = tx.objectStore(ART_STORE).openCursor();
      req.onsuccess = function () {
        var c = req.result;
        if (!c) return;
        count++;
        if (c.value && c.value.blob) bytes += c.value.blob.size;
        c.continue();
      };
      tx.oncomplete = function () { resolve({ count: count, bytes: bytes }); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

/* ---------- 画像を探す ---------- */
// 元の大きさの画像を探す。{ blob, source, name } または null
async function artFindOriginal(t) {
  // アプリ内で設定したジャケット（ogg・wav など）があれば、それを一番に使う
  try {
    var up = await userPicGet(t.path);
    if (up) {
      if (up.removed) return null;
      if (up.blob) return { blob: up.blob, source: 'app', name: '' };
    }
  } catch (e) { /* 使えなくても続ける */ }
  try {
    var file = await t.handle.getFile();
    var pic = await readTrackPicture(file);
    if (pic) return { blob: new Blob([pic.bytes], { type: pic.mime }), source: 'embedded', name: '' };
  } catch (e) { console.warn('埋め込み画像を読めませんでした', t.path, e); }
  try {
    var img = await _artFindFolderImage(t.folder);
    if (img) return { blob: img, source: 'folder', name: img.name };
  } catch (e) { console.warn('フォルダの画像を読めませんでした', t.folder, e); }
  return null;
}
// 同じフォルダの cover / folder / front / albumart 系の画像（大文字小文字は区別しない）
async function _artFindFolderImage(folder) {
  var dir = await getDirHandleByPath(folder, false);
  var best = null, bestRank = 99;
  for await (var h of dir.values()) {
    if (h.kind !== 'file' || !ART_FOLDER_IMAGE_RE.test(h.name)) continue;
    var lower = h.name.toLowerCase();
    var rank = 99;
    for (var i = 0; i < ART_FOLDER_PRIORITY.length; i++) { if (lower.indexOf(ART_FOLDER_PRIORITY[i]) === 0) { rank = i; break; } }
    if (rank < bestRank || (rank === bestRank && best && JA_COLLATOR.compare(h.name, best.name) < 0)) { best = h; bestRank = rank; }
  }
  return best ? best.getFile() : null;
}
// 小さく縮小して JPEG にする（読めない画像なら null）
//   v2.5 で createImageBitmap の縮小＋OffscreenCanvas も試したが、この方法の方が速く（20枚で 0.78秒 対 1.35秒）、
//   どちらも画面を止める長い処理は出なかったので、今までの方法のまま
async function _artMakeThumb(blob) {
  try {
    var bmp = await createImageBitmap(blob);
    var s = Math.min(1, ART_THUMB_SIZE / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return await new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.82); });
  } catch (e) {
    console.warn('ジャケット画像を縮小できませんでした', e);
    return null;
  }
}
// アルバムの画像を用意する：控え（IndexedDB）→ 取り出して縮小 → 控えに保存
//   skipIdb：控えに無いことが分かっている（まとめ読みで確かめ済み）
async function _artResolve(key, t, skipIdb) {
  if (!skipIdb) {
    try {
      var rec = await artIdbGet(key);
      if (_artRecOk(rec)) return { blob: rec.blob, source: rec.source || 'embedded' };
    } catch (e) { /* 控えが使えなくても続ける */ }
  }
  var found = await artFindOriginal(t);
  if (!found) return { blob: null, source: 'none' };   // 「無い」は控えに残さない（あとで画像を置いたら見つかるように）
  var thumb = await _artMakeThumb(found.blob);
  if (!thumb) return { blob: null, source: 'none' };
  try { await artIdbSet(key, { blob: thumb, source: found.source, size: ART_THUMB_SIZE, at: Date.now() }); } catch (e) { console.warn('ジャケット画像の控えを保存できませんでした', e); }
  return { blob: thumb, source: found.source };
}

// 曲のアルバム画像を取得（{ url, source }）。同じアルバムは1回だけ取り出す
function artLoadForTrack(t, skipIdb) {
  var key = artKeyOf(t);
  var m = art.mem.get(key);
  if (m) { _artTouch(key, m); return Promise.resolve(m); }
  if (art.loading.has(key)) return art.loading.get(key);
  var gen = art.gen;
  var p = _artResolve(key, t, skipIdb).then(function (r) {
    art.loading.delete(key);
    if (gen !== art.gen) return { url: null, source: 'none' };
    return _artRemember(key, r.blob, r.source);
  }, function (e) {
    art.loading.delete(key);
    console.warn('ジャケット画像の読み込みエラー', e);
    return { url: null, source: 'none' };
  });
  art.loading.set(key, p);
  return p;
}
function _artTouch(key, m) { art.mem.delete(key); art.mem.set(key, m); }
// メモリの控えに入れる（object URL を作る）
function _artRemember(key, blob, source) {
  var old = art.mem.get(key);
  if (old) return old;
  var entry = { url: blob ? URL.createObjectURL(blob) : null, source: source };
  art.mem.set(key, entry);
  _artEvict();
  return entry;
}
// メモリに持つ数を超えたら、古いものから object URL を解放する
function _artEvict() {
  if (art.mem.size <= ART_MEM_MAX) return;
  var it = art.mem.keys();
  while (art.mem.size > ART_MEM_MAX) {
    var n = it.next();
    if (n.done) break;
    var k = n.value;
    if (k === art.pinnedKey) continue;
    var m = art.mem.get(k);
    if (m && m.url) URL.revokeObjectURL(m.url);
    art.mem.delete(k);
  }
}
// 全部解放する（音楽フォルダを変えたとき・控えを消したとき）
function artReset() {
  art.gen++;
  art.mem.forEach(function (m) { if (m.url) URL.revokeObjectURL(m.url); });
  art.mem.clear();
  art.loading.clear();
  art.waiting.clear();
  art.queue = [];
  art.lookup = [];
  art.pinnedKey = null;
  var pb = document.getElementById('pb-art');
  if (pb) { pb.removeAttribute('data-key'); }
}

// ジャケットを変えた曲のアルバムの控え（メモリ・IndexedDB）を捨てて、次に表示するとき取り出し直す（v2.0）
async function artInvalidateTracks(tracks) {
  var keys = {};
  (tracks || []).forEach(function (t) { if (t) keys[artKeyOf(t)] = true; });
  var list = Object.keys(keys);
  for (var i = 0; i < list.length; i++) {
    var k = list[i], m = art.mem.get(k);
    if (m && m.url) URL.revokeObjectURL(m.url);
    art.mem.delete(k);
    art.loading.delete(k);
    try { await artIdbDelete(k); } catch (e) { /* 無視 */ }
  }
  var pb = document.getElementById('pb-art');
  if (pb && keys[pb.getAttribute('data-key')]) pb.removeAttribute('data-key');   // 再生バーのジャケットも取り直す
}

/* ---------- 一覧のサムネイル（遅延読み込み） ---------- */
// 行の中に置くサムネイルの HTML。すでにメモリにあればすぐ画像、無ければ仮画像で、見えたら読み込む
function artThumbHtml(t, extraCls) {
  var cls = 'art-thumb' + (extraCls ? ' ' + extraCls : '');
  if (!t) return '<span class="' + cls + ' art-none">' + ICONS.music + '</span>';
  var key = artKeyOf(t), ka = ' data-art-key="' + escapeHtml(key) + '"';   // この場所が出すべき画像の目印（v6.2）
  var m = art.mem.get(key);
  if (m) {
    return m.url
      ? '<span class="' + cls + '"' + ka + '><img src="' + m.url + '" alt="" decoding="async"></span>'
      : '<span class="' + cls + ' art-none"' + ka + '>' + ICONS.music + '</span>';
  }
  return '<span class="' + cls + ' art-pending" data-art-path="' + escapeHtml(t.path) + '"' + ka + '>' + ICONS.music + '</span>';
}
// 描き直したあとに呼ぶ：まだ画像の無いサムネイルを見張り、画面に入ったら読み込む
//   v2.5：画像が付くまで見張り続け、画面から外れたら待ちから外す（見えている物を先に）
function artObserve(container) {
  if (!container) return;
  if (!art.observer) {
    if (!('IntersectionObserver' in window)) return;
    art.observer = new IntersectionObserver(_artOnIntersect, { rootMargin: '200px 0px' });
  }
  container.querySelectorAll('.art-pending[data-art-path]').forEach(function (el) { art.observer.observe(el); });
}
function _artOnIntersect(entries) {
  entries.forEach(function (en) {
    var el = en.target;
    if (!el.isConnected || !el.hasAttribute('data-art-path')) { art.observer.unobserve(el); _artForget(el); return; }
    var t = library.byPath[el.getAttribute('data-art-path')];
    if (!t) { art.observer.unobserve(el); return; }
    if (!en.isIntersecting) { el._artSeen = false; _artForget(el); return; }   // 画面から外れた：待ちから外す
    el._artSeen = true;
    if (t.metaLoaded) { _artRequest(t, el); return; }
    // 曲情報（アルバム名）がまだ：その曲だけ先に読んでから（裏の読み込みの順番を待たない）
    if (typeof readTrackMetaNow !== 'function') return;
    readTrackMetaNow(t).then(function (ok) {
      if (ok && el.isConnected && el._artSeen && el.hasAttribute('data-art-path')) _artRequest(t, el);
    });
  });
}
// 画面から外れた・描き直された表示場所を、待ちから外す
function _artForget(el) {
  var key = el._artKey;
  if (!key) return;
  var w = art.waiting.get(key);
  if (!w) return;
  w.els.delete(el);
  if (!w.els.size) art.waiting.delete(key);   // 待っている場所が無くなった（取り出し中の物はそのまま終わらせ、メモリに残す）
}
function _artRequest(t, el) {
  var key = artKeyOf(t);
  if (el._artKey && el._artKey !== key) _artForget(el);   // 前に別の画像を待っていた（v6.2）：その待ちから外す
  el._artKey = key;
  el.setAttribute('data-art-key', key);
  var m = art.mem.get(key);
  if (m) { _artTouch(key, m); _artDone(el, m, key); return; }
  var w = art.waiting.get(key);
  if (!w) { w = { track: t, els: new Set() }; art.waiting.set(key, w); }
  w.els.add(el);
  if (w.stage) return;   // 同じアルバムは1回だけ
  if (art.loading.has(key)) {   // ほかの所（再生バーなど）で取り出し中：終わったら付ける
    w.stage = 'loading';
    art.loading.get(key).then(function (res) {
      var ww = art.waiting.get(key);
      if (ww) { ww.els.forEach(function (x) { _artDone(x, res, key); }); art.waiting.delete(key); }
    });
    return;
  }
  w.stage = 'lookup';
  art.lookup.push(key);
  // 同じ時に見えた物をまとめて、控えを1回で読む
  if (!art.lookupTimer) art.lookupTimer = setTimeout(_artFlushLookup, 0);
}
function _artFlushLookup() {
  art.lookupTimer = 0;
  var keys = art.lookup.filter(function (k) { return art.waiting.has(k); });
  art.lookup = [];
  if (!keys.length) return;
  var gen = art.gen;
  artIdbGetMany(keys).then(function (recs) { return recs; }, function () { return {}; }).then(function (recs) {
    if (gen !== art.gen) return;
    // 取り出しは art.queue の後ろから行うので、画面の上の物（先に見えた物）が先になるよう逆順に積む
    keys.slice().reverse().forEach(function (k) {
      var w = art.waiting.get(k);
      var rec = recs[k];
      if (_artRecOk(rec)) {
        var m = _artRemember(k, rec.blob, rec.source || 'embedded');
        if (w) { w.els.forEach(function (el) { _artDone(el, m, k); }); art.waiting.delete(k); }
        return;
      }
      if (!w) return;                    // 待っている間に画面から外れた
      w.stage = 'queue';
      art.queue.push(k);                  // 控えに無い：曲ファイル・フォルダから取り出す
    });
    _artPump();
  });
}
function _artPump() {
  while (art.active < ART_CONCURRENCY && art.queue.length) {
    var key = art.queue.pop();   // 新しく見えたものから先に
    var w = art.waiting.get(key);
    if (!w) continue;            // もう画面に無い（スクロールで通り過ぎた・描き直された）
    var alive = false;
    w.els.forEach(function (el) { if (el.isConnected) alive = true; });
    if (!alive) { art.waiting.delete(key); continue; }
    art.active++;
    (function (key, w) {
      artLoadForTrack(w.track, true).then(function (res) {
        var ww = art.waiting.get(key);
        if (ww) { ww.els.forEach(function (el) { _artDone(el, res, key); }); art.waiting.delete(key); }
      }).finally(function () {
        art.active--;
        _artPump();
      });
    })(key, w);
  }
}
// 画像を当てる（v6.2：当てる直前に、その場所が今もこの目印の画像を待っているかを確かめる。違えば捨てる）
function _artDone(el, res, key) {
  if (key && (el._artKey !== key || (el.getAttribute('data-art-key') || key) !== key)) return;   // 遅れて終わった別の曲の画像
  if (art.observer) art.observer.unobserve(el);
  if (el.isConnected) _artApply(el, res);
}
function _artApply(el, res) {
  el.classList.remove('art-pending');
  el.removeAttribute('data-art-path');
  if (res && res.url) { el.classList.remove('art-none'); el.innerHTML = '<img src="' + res.url + '" alt="" decoding="async">'; }
  else {
    el.classList.add('art-none');
    var oldImg = el.querySelector('img'); if (oldImg) el.innerHTML = el.classList.contains('album-sk-bg') ? '' : ICONS.music;   // 仮画像：前の画像を確実に消す（v6.2）
    if (el.hasAttribute('data-sk-alts') && typeof skBgFallback === 'function') skBgFallback(el);   // ソートキーの枠の背景：次の候補のアルバム（v6.0）
  }
}

/* ---------- 再生バーのジャケット ---------- */
function artUpdatePlayer(t) {
  var el = document.getElementById('pb-art');
  if (!el) return;
  if (!t) {
    el.removeAttribute('data-key');
    el.classList.add('art-none');
    el.innerHTML = ICONS.music;
    art.pinnedKey = null;
    return;
  }
  var key = artKeyOf(t);
  if (el.getAttribute('data-key') === key) return;   // 同じアルバムなら何もしない
  el.setAttribute('data-key', key);
  art.pinnedKey = key;
  el.classList.add('art-none');
  el.innerHTML = ICONS.music;
  artLoadForTrack(t).then(function (res) {
    if (el.getAttribute('data-key') !== key) return;
    if (res.url) { el.classList.remove('art-none'); el.innerHTML = '<img src="' + res.url + '" alt="">'; }
    // OS の再生表示（メディアキーの表示など）にもジャケットを出す
    if (res.url && 'mediaSession' in navigator && navigator.mediaSession.metadata) {
      try { navigator.mediaSession.metadata.artwork = [{ src: res.url, sizes: ART_THUMB_SIZE + 'x' + ART_THUMB_SIZE, type: 'image/jpeg' }]; } catch (e) { /* 無視 */ }
    }
  });
}

/* ---------- ジャケット拡大表示 ---------- */
function _ensureArtViewer() {
  var ov = document.getElementById('art-viewer');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'art-viewer';
  ov.className = 'art-viewer-overlay';
  ov.hidden = true;
  ov.innerHTML =
    '<div class="art-viewer-box" role="dialog" aria-modal="true" aria-label="ジャケット拡大表示">' +
      '<span class="ui-label-tag ui-label-tag-ondark" style="top:6px;left:8px" onclick="copyUiLabel(\'ジャケット拡大表示\', event)" title="クリックで「ジャケット拡大表示」をコピー">□</span>' +
      '<button class="art-viewer-close" onclick="closeArtworkViewer()" title="閉じる">' + ICONS.x + '</button>' +
      '<div class="art-viewer-image" id="art-viewer-image"></div>' +
      '<div class="art-viewer-title" id="art-viewer-title"></div>' +
      '<div class="art-viewer-sub" id="art-viewer-sub"></div>' +
      '<div class="art-viewer-source" id="art-viewer-source"></div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function (ev) { if (ev.target === ov) closeArtworkViewer(); });
  document.addEventListener('keydown', function (ev) { if (!ov.hidden && ev.key === 'Escape') closeArtworkViewer(); });
  return ov;
}
// path を省略すると再生中の曲（アルバムの見出しからは、そのアルバムの曲を渡す）
async function openArtworkViewer(path) {
  path = (typeof path === 'string' && path) ? path : player.currentPath;
  if (!path) { showToast('再生中の曲がありません。'); return; }
  var token = ++art.viewerToken;
  var t = library.byPath[path];
  var ov = _ensureArtViewer();
  var imgBox = document.getElementById('art-viewer-image');
  document.getElementById('art-viewer-title').textContent = t ? t.title : stripExt(splitPath(path).name);
  document.getElementById('art-viewer-sub').textContent = t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '';
  document.getElementById('art-viewer-source').textContent = '読み込み中…';
  imgBox.innerHTML = '<div class="art-viewer-placeholder">' + ICONS.music + '</div>';
  ov.hidden = false;
  var found = t ? await artFindOriginal(t) : null;
  if (ov.hidden || token !== art.viewerToken) return;   // 待っている間に閉じた・別の画像を開いた
  _artViewerRevoke();
  if (found) {
    art.viewerUrl = URL.createObjectURL(found.blob);
    imgBox.innerHTML = '<img src="' + art.viewerUrl + '" alt="ジャケット画像">';
    document.getElementById('art-viewer-source').textContent = ART_SOURCE_LABELS[found.source] + (found.name ? '（' + found.name + '）' : '');
  } else {
    document.getElementById('art-viewer-source').textContent = 'この曲にはジャケット画像がありません（曲ファイルにも、同じフォルダの cover.jpg などにも見つかりませんでした）';
  }
}
function closeArtworkViewer() {
  var ov = document.getElementById('art-viewer');
  if (!ov) return;
  ov.hidden = true;
  document.getElementById('art-viewer-image').innerHTML = '';
  _artViewerRevoke();
}
function _artViewerRevoke() {
  if (art.viewerUrl) { URL.revokeObjectURL(art.viewerUrl); art.viewerUrl = null; }
}

/* ---------- ジャケットの控えを前もって作る（tools。v2.5） ----------
   全アルバムの縮小画像を、裏で1つずつ作って IndexedDB に控える（作り終わると、どの画面でもすぐ出る）。
   画面に見えている物の取り出しを優先し、それが動いている間は待つ。途中で止められる。
   すでに控えがあるアルバムは飛ばす。画像が無いアルバムは数えるだけ（控えには残さない） */
var artPre = { running: false, stop: false, done: 0, total: 0, none: 0, skipped: 0 };
async function artPrebuildStart() {
  if (artPre.running) return;
  if (!fsa.root || !library.tracks.length) { showToast('先に音楽フォルダを選んでください。'); return; }
  if (isLibraryLoading()) { showToast('曲情報を読み込み中です。読み終わってから、もう一度押してください。'); return; }
  // 押した時点で「作成中」にする（控えの一覧を読む間に、もう一度押されても2つ動かないように）
  artPre = { running: true, stop: false, done: 0, total: 0, none: 0, skipped: 0, startedAt: Date.now() };
  _artPreRender();
  var gen = art.gen;
  var byKey = {};
  library.tracks.forEach(function (t) { var k = artKeyOf(t); if (!byKey[k]) byKey[k] = t; });
  var have = {};
  try { (await _artTx('readonly', function (s) { return s.getAllKeys(); }) || []).forEach(function (k) { have[k] = true; }); } catch (e) { /* 無くても続ける */ }
  var list = Object.keys(byKey).filter(function (k) { return !have[k]; });
  artPre.total = list.length;
  artPre.skipped = Object.keys(byKey).length - list.length;
  _artPreRender();
  for (var i = 0; i < list.length; i++) {
    // 画面に見えている物の取り出し中は待つ（そちらが先）
    while (!artPre.stop && gen === art.gen && (art.active > 0 || art.queue.length || art.lookup.length)) await new Promise(function (r) { setTimeout(r, 150); });
    if (artPre.stop || gen !== art.gen) break;
    var k = list[i];
    try {
      var r = art.mem.has(k) ? art.mem.get(k) : await _artResolve(k, byKey[k], true);
      if (!r || !(r.blob || r.url)) artPre.none++;
    } catch (e) { artPre.none++; }
    artPre.done++;
    if (artPre.done % 5 === 0 || artPre.done === list.length) _artPreRender();
  }
  var stopped = artPre.stop || gen !== art.gen;
  artPre.running = false;
  _artPreRender();
  if (currentPage === 'settings') renderSetStorage();
  showToast(stopped ? 'ジャケットの控え作りを止めました（' + artPre.done + ' / ' + artPre.total + '）。'
                    : (artPre.done - artPre.none > 0
                        ? 'ジャケットの控えを作りました（' + (artPre.done - artPre.none) + 'アルバム分' + (artPre.none ? '・画像なし ' + artPre.none : '') + '）。'
                        : 'ジャケットの控えは、すべて作ってあります' + (artPre.none ? '（画像の無いアルバム ' + artPre.none + '）' : '') + '。'));
}
// 止める（force：控えを消すときなど。ボタンのときは、始めた直後の押し間違い〔ダブルクリック〕を無視する）
function artPrebuildStop(force) {
  if (!artPre.running) return;
  if (force !== true && Date.now() - (artPre.startedAt || 0) < 800) return;
  artPre.stop = true;
  _artPreRender();
}
// 進み具合の表示（tools の「ジャケット画像の控え」の下）
function artPrebuildHtml() {
  return '<div class="art-prebuild" id="art-prebuild">' + _artPreInner() + '</div>';
}
function _artPreInner() {
  if (artPre.running) {
    var pct = artPre.total ? Math.round(artPre.done / artPre.total * 100) : 100;
    return '<div class="storage-bar"><div class="storage-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
      '<span class="panel-meta">作成中 ' + artPre.done + ' / ' + artPre.total + ' アルバム' + (artPre.stop ? '（止めています…）' : '') + '</span>' +
      '<button class="btn-inline-small" onclick="artPrebuildStop()"' + (artPre.stop ? ' disabled' : '') + '>止める</button>';
  }
  return '<button class="btn-inline-small" onclick="artPrebuildStart()">' + ICONS.image + 'ジャケットの控えを前もって作る</button>' +
    '<span class="panel-meta">全アルバムの縮小画像を裏で作っておくと、どの画面でもジャケットがすぐ出ます（曲の多いときに）。</span>';
}
function _artPreRender() {
  var el = document.getElementById('art-prebuild');
  if (el) el.innerHTML = _artPreInner();
  if (typeof renderLoadProgress === 'function') renderLoadProgress(true);   // 読み込みの進み具合の ③（v2.6）
}

/* ---------- ジャケット画像の控えを消す（設定・バックアップ） ---------- */
async function clearArtworkCacheInteractive() {
  var ok = await showConfirm({
    title: 'ジャケット画像の控えを消す',
    message: 'ブラウザ内に保存した、縮小済みのジャケット画像の控えを消します。<br>音楽ファイル・画像ファイルは変わりません。次に表示するときに、もう一度取り出します。',
    okText: '消す'
  });
  if (!ok) return;
  artPrebuildStop(true);
  try { await artIdbClear(); } catch (e) { showToast('消せませんでした：' + (e && e.message ? e.message : e), true); return; }
  artReset();
  renderAll();
  showToast('ジャケット画像の控えを消しました。');
}

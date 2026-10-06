/* =========================================================
   02-folder-access.js ― 音楽フォルダへのアクセス（File System Access API）
   ・音楽フォルダを選ぶ／次回起動時の再接続（ハンドルは IndexedDB に保存）
   ・サイドバーの「接続状態」と「非対応のお知らせ」の表示
   ・相対パスからフォルダ・ファイルのハンドルを取り出す
   ・ファイル整理のときだけ「書き込みの許可」をもらう
     （曲一覧の表示・再生は読み取りの許可だけで動き、ファイルを書き換えない）
   ・v8.7：showDirectoryPicker の無いブラウザ（Android の Chrome など）は「読み取り専用モード（スマホ）」。
     <input type="file" webkitdirectory>（フォルダごと）か <input type="file" multiple>（曲ファイルをまとめて）で選んだファイルから、
     FileSystemHandle と同じ形の読み取り専用の入れ物（_VDir / _VFile。values()・getFile()・getDirectoryHandle()・getFileHandle() など）を作り、
     fsa.root に入れる。今までの読み込み・タグ・ジャケット・歌詞・再生の処理はそのまま動く。書き込みはすべて断る（NotAllowedError）。
     ハンドルを覚えておけないので、開くたびに選び直す（曲情報の控えはフォルダの名前とパスで照合して使い直す）
   ========================================================= */

var fsa = {
  picker: typeof window.showDirectoryPicker === 'function',   // PC の Chrome / Edge（フォルダを覚えておける・書き込める）
  supported: true,   // v8.7：picker が無くても、ファイルを選ぶ方法で読み込める
  readOnly: typeof window.showDirectoryPicker !== 'function', // v8.7：読み取り専用モード（スマホ）
  root: null,        // 音楽フォルダのハンドル（読み取り専用モードでは _VDir）
  folderName: '',
  state: 'none'      // 'none' 未接続 / 'prompt' 許可待ち / 'granted' 接続中 / 'unsupported' 非対応
};

/* ---------- 読み取り専用モード（スマホ）：選んだファイルから作る、FileSystemHandle と同じ形の入れ物（v8.7） ---------- */
function _vfsErr(name, msg) {
  try { return new DOMException(msg, name); } catch (e) { var er = new Error(msg); er.name = name; return er; }
}
function _vfsPerm(o) { return Promise.resolve(o && o.mode === 'readwrite' ? 'denied' : 'granted'); }
function _vfsDeny() { return Promise.reject(_vfsErr('NotAllowedError', '読み取り専用モード（スマホ）では書き込めません')); }
function _VFile(name, file) { this.kind = 'file'; this.name = name; this._file = file; }
_VFile.prototype.getFile = function () { return Promise.resolve(this._file); };
_VFile.prototype.createWritable = _vfsDeny;
_VFile.prototype.move = _vfsDeny;
_VFile.prototype.remove = _vfsDeny;
_VFile.prototype.queryPermission = _vfsPerm;
_VFile.prototype.requestPermission = _vfsPerm;
_VFile.prototype.isSameEntry = function (o) { return Promise.resolve(o === this); };
function _VDir(name) { this.kind = 'directory'; this.name = name; this._c = new Map(); }
_VDir.prototype.values = async function* () { for (var v of Array.from(this._c.values())) yield v; };
_VDir.prototype.keys = async function* () { for (var k of Array.from(this._c.keys())) yield k; };
_VDir.prototype.entries = async function* () { for (var e of Array.from(this._c.entries())) yield e; };
_VDir.prototype[Symbol.asyncIterator] = _VDir.prototype.entries;
_VDir.prototype.getDirectoryHandle = function (name, o) {
  var h = this._c.get(name);
  if (h && h.kind === 'directory') return Promise.resolve(h);
  if (h) return Promise.reject(_vfsErr('TypeMismatchError', name + ' はファイルです'));
  if (o && o.create) return _vfsDeny();
  return Promise.reject(_vfsErr('NotFoundError', name + ' が見つかりません'));
};
_VDir.prototype.getFileHandle = function (name, o) {
  var h = this._c.get(name);
  if (h && h.kind === 'file') return Promise.resolve(h);
  if (h) return Promise.reject(_vfsErr('TypeMismatchError', name + ' はフォルダです'));
  if (o && o.create) return _vfsDeny();
  return Promise.reject(_vfsErr('NotFoundError', name + ' が見つかりません'));
};
_VDir.prototype.removeEntry = _vfsDeny;
_VDir.prototype.move = _vfsDeny;
_VDir.prototype.queryPermission = _vfsPerm;
_VDir.prototype.requestPermission = _vfsPerm;
_VDir.prototype.isSameEntry = function (o) { return Promise.resolve(o === this); };
// 選んだファイル → 入れ物の木。kind 'dir'：フォルダごと（webkitRelativePath の先頭がフォルダの名前）／'files'：曲ファイルをまとめて
var VFS_FILES_ROOT_NAME = 'スマホで選んだ曲';
function _vfsBuild(files, kind) {
  var rootName = '', root = null;
  files.forEach(function (f) {
    var rel = (kind === 'dir' && f.webkitRelativePath) ? f.webkitRelativePath : f.name;
    var parts = rel.split('/').filter(Boolean);
    if (kind === 'dir' && parts.length > 1) { if (!rootName) rootName = parts[0]; parts = parts.slice(1); }
    if (!root) root = new _VDir('');
    var d = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var c = d._c.get(parts[i]);
      if (!c || c.kind !== 'directory') { c = new _VDir(parts[i]); d._c.set(parts[i], c); }
      d = c;
    }
    var nm = parts[parts.length - 1];
    if (nm) d._c.set(nm, new _VFile(nm, f));
  });
  if (root) root.name = rootName || VFS_FILES_ROOT_NAME;
  return root;
}
// ファイルを選ぶ画面を出す。kind 'dir'（フォルダごと。使えなければ曲ファイルをまとめて）／'files'
function pickMusicFallback(kind) {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  var dirOk = kind !== 'files' && 'webkitdirectory' in inp;
  if (dirOk) { inp.webkitdirectory = true; inp.setAttribute('webkitdirectory', ''); }
  else inp.accept = 'audio/*,.mp3,.m4a,.mp4,.aac,.flac,.ogg,.oga,.opus,.wav,.wma,.lrc,.txt';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', function () {
    var files = Array.from(inp.files || []);
    inp.remove();
    if (files.length) useMusicFiles(files, dirOk ? 'dir' : 'files');
  });
  inp.click();
}
// 選んだファイルを音楽フォルダとして使う（テストからも呼べる）
async function useMusicFiles(files, kind) {
  var root = _vfsBuild(files, kind);
  if (!root) return;
  var changed = fsa.root && fsa.folderName !== root.name;
  fsa.root = root;
  fsa.folderName = root.name;
  fsa.state = 'granted';
  db.settings.musicFolderName = root.name; saveDB();
  // 曲情報の控え（IndexedDB）を先に読む：前と同じ名前のフォルダなら、控え（タグ・追加日）をパスで照合して使い直す
  if (typeof libIndexEnsureLoaded === 'function') { try { await libIndexEnsureLoaded(); } catch (e) { console.warn(e); } }
  if (typeof resetLibraryForNewFolder === 'function') resetLibraryForNewFolder(root.name);
  renderAll();
  if (changed && db.playlists.length) showToast('音楽フォルダを「' + root.name + '」に変更しました。プレイリストの曲は、このフォルダからの位置で探します。');
  await scanLibrary();
}

/* ---------- IndexedDB（フォルダのハンドルの保存場所） ---------- */
var HANDLE_DB_NAME = 'musicManager_handles';
var HANDLE_STORE = 'handles';
var HANDLE_KEY_ROOT = 'musicRoot';

function openHandleDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(HANDLE_STORE); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbGet(key) {
  return openHandleDB().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(HANDLE_STORE, 'readonly');
      var r = tx.objectStore(HANDLE_STORE).get(key);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  });
}
function idbSet(key, value) {
  return openHandleDB().then(function (idb) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(value, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

/* ---------- 起動時：前回の音楽フォルダを探す ---------- */
async function initFolderAccess() {
  if (fsa.readOnly) {   // v8.7：読み取り専用モード（スマホ）は、開くたびに選び直す
    fsa.state = 'none';
    renderAll();
    return;
  }
  if (!fsa.supported) {
    fsa.state = 'unsupported';
    renderAll();
    return;
  }
  try {
    var h = await idbGet(HANDLE_KEY_ROOT);
    if (h) {
      fsa.root = h;
      fsa.folderName = h.name;
      var p = await h.queryPermission({ mode: 'read' });
      fsa.state = (p === 'granted') ? 'granted' : 'prompt';
    }
  } catch (e) {
    console.warn('前回の音楽フォルダを読み込めませんでした', e);
  }
  renderAll();
  if (fsa.state === 'granted') await scanLibrary();
}

/* ---------- 音楽フォルダを選ぶ（変更する） ---------- */
async function pickMusicFolder() {
  if (!fsa.picker) { pickMusicFallback('dir'); return; }   // v8.7：読み取り専用モード（スマホ）
  if (!fsa.supported) { showToast('このブラウザでは音楽フォルダを開けません（Chrome / Edge を使ってください）', true); return; }
  var h;
  try {
    // 読み取りの許可だけをもらう（書き込みはファイル整理を実行するときに改めて聞く）
    h = await window.showDirectoryPicker({ id: 'musicManagerRoot', mode: 'read', startIn: 'music' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // 選ぶのをやめた
    console.error(e);
    showToast('フォルダを開けませんでした：' + (e && e.message ? e.message : e), true);
    return;
  }
  var changed = fsa.root && fsa.folderName !== h.name;
  fsa.root = h;
  fsa.folderName = h.name;
  fsa.state = 'granted';
  try { await idbSet(HANDLE_KEY_ROOT, h); } catch (e) { console.warn('フォルダの記憶に失敗', e); }
  db.settings.musicFolderName = h.name; saveDB();
  if (typeof resetLibraryForNewFolder === 'function') resetLibraryForNewFolder(h.name);
  renderAll();
  if (changed && db.playlists.length) {
    showToast('音楽フォルダを「' + h.name + '」に変更しました。プレイリストの曲は、このフォルダからの位置で探します。');
  }
  await scanLibrary();
}

/* ---------- 再接続（ブラウザを開き直したあとの許可） ---------- */
async function reconnectMusicFolder() {
  if (!fsa.root || fsa.readOnly) { return pickMusicFolder(); }
  try {
    var p = await fsa.root.requestPermission({ mode: 'read' });
    if (p === 'granted') {
      fsa.state = 'granted';
      renderAll();
      await scanLibrary();
    } else {
      showToast('許可されませんでした。もう一度「再接続」を押してください。', true);
    }
  } catch (e) {
    console.error(e);
    showToast('再接続できませんでした。「音楽フォルダを選ぶ」から選び直してください。', true);
  }
}

// 読み取り中に許可が外れたとき
function markPermissionLost() {
  fsa.state = 'prompt';
  renderAll();
}

/* ---------- 書き込みの許可（ファイル整理の実行時だけ） ----------
   必ずボタンを押した直後（確認ダイアログの「実行する」の直後）に呼ぶ */
async function ensureWritePermission() {
  if (!fsa.root || fsa.readOnly) return false;   // v8.7：読み取り専用モード（スマホ）では書き込まない
  try {
    var q = await fsa.root.queryPermission({ mode: 'readwrite' });
    if (q === 'granted') return true;
    var r = await fsa.root.requestPermission({ mode: 'readwrite' });
    return r === 'granted';
  } catch (e) {
    console.error('書き込みの許可エラー', e);
    return false;
  }
}

/* ---------- 相対パス → ハンドル ---------- */
async function getDirHandleByPath(dirPath, create) {
  var h = fsa.root;
  if (!h) throw new Error('音楽フォルダにつながっていません');
  var parts = dirPath ? dirPath.split('/') : [];
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    h = await h.getDirectoryHandle(parts[i], { create: !!create });
  }
  return h;
}
async function getFileHandleByPath(path) {
  var sp = splitPath(path);
  var dir = await getDirHandleByPath(sp.dir, false);
  return dir.getFileHandle(sp.name);
}

// フォルダの中に、その名前のファイル（またはフォルダ）があるか
async function entryExists(dirHandle, name) {
  try { await dirHandle.getFileHandle(name); return true; }
  catch (e) {
    if (e && e.name === 'TypeMismatchError') return true;   // 同じ名前のフォルダがある
    if (e && e.name !== 'NotFoundError') throw e;
  }
  try { await dirHandle.getDirectoryHandle(name); return true; }
  catch (e) {
    if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return e.name === 'TypeMismatchError';
    throw e;
  }
}
// 相対パスの場所に何かあるか（途中のフォルダがなければ false）
async function pathExists(path) {
  var sp = splitPath(path);
  var dir;
  try { dir = await getDirHandleByPath(sp.dir, false); }
  catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return false; throw e; }
  return entryExists(dir, sp.name);
}

/* ---------- 接続状態（サイドバー）と非対応のお知らせ ---------- */
function renderConnectionStatus() {
  var el = document.getElementById('conn-status');
  if (el) {
    var html = '';
    if (fsa.readOnly && fsa.state !== 'granted') {   // v8.7：読み取り専用モード（スマホ）
      html = '<div class="conn-line"><span class="conn-dot dot-off"></span>未接続（スマホ）</div>' +
             '<div class="conn-sub">開くたびに選び直します</div>' +
             '<button class="conn-btn" onclick="pickMusicFolder()">音楽フォルダを選ぶ</button>' +
             '<button class="conn-btn" onclick="pickMusicFallback(\'files\')">曲ファイルを選ぶ</button>';
    } else if (fsa.readOnly) {
      html = '<div class="conn-line"><span class="conn-dot dot-on"></span>読み込み済み（スマホ）</div>' +
             '<div class="conn-sub" title="' + escapeHtml(fsa.folderName) + '">' + escapeHtml(fsa.folderName) + '</div>' +
             '<button class="conn-btn" onclick="pickMusicFolder()">選び直す</button>';
    } else if (fsa.state === 'unsupported') {
      html = '<div class="conn-line"><span class="conn-dot dot-off"></span>このブラウザは非対応</div>' +
             '<div class="conn-sub">Chrome / Edge で開いてください</div>';
    } else if (fsa.state === 'granted') {
      html = '<div class="conn-line"><span class="conn-dot dot-on"></span>接続中</div>' +
             '<div class="conn-sub" title="' + escapeHtml(fsa.folderName) + '">' + escapeHtml(fsa.folderName) + '</div>';
    } else if (fsa.state === 'prompt') {
      html = '<div class="conn-line"><span class="conn-dot dot-wait"></span>許可待ち</div>' +
             '<div class="conn-sub">' + escapeHtml(fsa.folderName) + '</div>' +
             '<button class="conn-btn" onclick="reconnectMusicFolder()">再接続</button>';
    } else {
      html = '<div class="conn-line"><span class="conn-dot dot-off"></span>未接続</div>' +
             '<button class="conn-btn" onclick="pickMusicFolder()">音楽フォルダを選ぶ</button>';
    }
    el.innerHTML = html;
  }
  var banner = document.getElementById('unsupported-banner');
  if (banner) banner.hidden = fsa.supported;
  if (typeof renderReadonlyBanner === 'function') renderReadonlyBanner();   // v8.7：読み取り専用モードの表示（59-mobile.js）
}

function isConnected() { return !!fsa.root && fsa.state === 'granted'; }

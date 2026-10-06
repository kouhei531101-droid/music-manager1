/* =========================================================
   04-library.js ― 音楽フォルダの読み込み（曲とフォルダのリスト作り）
   ・音楽フォルダの中を全部たどって、曲ファイルとフォルダの一覧を作る
     （音楽フォルダ直下の「削除フォルダ」の中は一覧に出さない）
   ・曲情報（タグ）をあとから少しずつ読み、結果を「曲情報の控え」に保存して次回は読み直さない
   ・ここではファイルを読むだけ。書き換えは一切しない
   ・v2.7 高速モード（初期値オン）：
       起動・「読み直す」では、まず控えから一覧をすぐ出し、裏でフォルダの中の名前だけを見て、
       増えた曲だけ曲情報を読む（なくなった曲は一覧から外す）。今までの曲はファイルを開かない。
       「全曲をきちんと確認」（大きさ・更新日時で変わった曲を読み直す）は、tools のボタンか、
       前回から db.settings.fullCheckDays 日（初期値7日）たったとき自動で行う
     フォルダは同時に SCAN_CONCURRENCY 個ずつたどる。削除フォルダ・タグ編集前の控え・名前が「.」で始まる物は中を見ない
   ========================================================= */

var AUDIO_EXTS = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'webm'];
var TAG_CACHE_VERSION = 2;   // v1.2 でトラック番号・ディスク番号・アルバムアーティストを追加（古い控えは読み直す）
// 控えの「詳しさ」の版（v3.2）：3 ＝ コンピレーションの印・ジャンル・発売年まで読んだ控え（控えの f）。
//   これより古い控えの曲は、一覧はそのまま使い、裏でタグを読み直して補う（大きさ・更新日時が同じでも）
var TAG_DETAIL_VERSION = 3;
function tagCacheNeedsDetail(c) { return !!c && (c.f || 0) < TAG_DETAIL_VERSION; }
var SCAN_CONCURRENCY = 8;    // フォルダを同時にたどる数（v2.7）
var META_WORKERS = 4;        // 曲情報を同時に読む数（v2.7 で 2→4。16,200曲で約2.6倍速くなった）
var FULL_CHECK_WORKERS = 4;  // 全確認で大きさ・更新日時を同時に確かめる数

var library = {
  tracks: [],      // 曲 { path, name, folder, ext, handle, title, artist, album, duration, size, lastModified, ... }
  byPath: {},      // 相対パス → 曲
  folders: [''],   // すべてのフォルダの相対パス（'' は音楽フォルダ直下）。削除フォルダは除く
  trashFiles: 0,   // 削除フォルダの中のファイル数（参考表示）
  scanning: false,
  scanToken: 0,
  scanned: false,
  metaTotal: 0,
  metaDone: 0,
  metaRunning: false
};

/* ---------- 曲情報の控え（tagCache） ----------
   { 相対パス: { v, s:大きさ, m:更新日時, t:曲名, a:アーティスト, l:アルバム, aa, n, k, d:長さ(秒) } }
   v2.7 から IndexedDB に保存（23-library-index.js。起動時に libIndexEnsureLoaded() で読む）。
   全確認のときは、ファイルの大きさと更新日時が変わっていたら読み直す */
var tagCache = {};
function saveTagCache() { if (typeof libIndexChanged === 'function') libIndexChanged(); }
function clearTagCache() {
  tagCache = {};
  if (typeof libIndexChanged === 'function') libIndexChanged();
}

/* ---------- 追加日（アプリが初めてその曲を見つけた日時。v2.2） ----------
   { 相対パス: ミリ秒 }。いちばん最初の読み込み（まだ何も記録が無いとき）は、ファイルの更新日時を使う。
   曲情報の控えと同じくバックアップ対象外（曲情報を読み直しても消えない）。移動・名前変更で付け替える。
   v2.7 から曲情報の控えと一緒に IndexedDB に保存 */
var FIRST_SEEN_KEY = 'musicManager_firstSeen';   // v2.6 までの保存場所（移すときだけ使う）
var firstSeen = {};
function saveFirstSeen() { if (typeof libIndexChanged === 'function') libIndexChanged(); }

/* ---------- 曲データを作る ---------- */
// handle が無い（控えから先に一覧を作ったとき）は、使うときにパスから探す代わりの物を入れる
function makeTrack(path, handle) {
  var sp = splitPath(path);
  var t = {
    path: path, name: sp.name, folder: sp.dir, ext: extOf(sp.name), handle: handle || _lazyFileHandle(path),
    tagTitle: '', tagArtist: '', tagAlbum: '', tagAlbumArtist: '', tagTrack: 0, tagDisc: 0, duration: 0, size: 0, lastModified: 0, metaLoaded: false
  };
  var c = tagCache[path];
  if (c && c.v === TAG_CACHE_VERSION) { applyCacheToTrack(t, c); t.metaLoaded = true; }   // 控えがあればアルバム名も分かっている
  t.firstSeen = firstSeen[path] || 0;
  fillDisplayFields(t);
  return t;
}
// 控えから作った一覧の曲のファイル（フォルダをたどり終わる前に再生・表示されたときは、パスから探す。v2.7）
function _lazyFileHandle(path) {
  var real = null;
  function get() {
    if (real) return Promise.resolve(real);
    var sp = splitPath(path);
    return getDirHandleByPath(sp.dir, false).then(function (d) { return d.getFileHandle(sp.name); }).then(function (h) { real = h; return h; });
  }
  return {
    kind: 'file', name: splitPath(path).name, lazy: true,
    getFile: function () { return get().then(function (h) { return h.getFile(); }); },
    createWritable: function (o) { return get().then(function (h) { return h.createWritable(o); }); }
  };
}
function applyCacheToTrack(t, c) {
  t.tagCompilation = !!c.cp;   // コンピレーションの印（v2.9。v2.8 までの控えには無い）
  t.tagGenre = c.g || '';      // ジャンル・発売年（v3.1。v3.0 までの控えには無い）
  t.tagYear = c.y || 0;
  t.tagTitle = c.t || ''; t.tagArtist = c.a || ''; t.tagAlbum = c.l || '';
  t.tagAlbumArtist = c.aa || ''; t.tagTrack = c.n || 0; t.tagDisc = c.k || 0;
  t.duration = c.d || 0; t.size = c.s || 0; t.lastModified = c.m || 0;
}
// 表示用の曲名・アーティスト・アルバム。タグが無ければファイル名とフォルダ名から推定する
//   例）「アーティスト/アルバム/01 曲名.mp3」→ 曲名「曲名」、アルバム「アルバム」、アーティスト「アーティスト」
function fillDisplayFields(t) {
  // アプリ内の上書き（17-tag-edit.js）があれば、ファイルのタグより優先する
  var ov = db.tagOverrides && db.tagOverrides[t.path];
  t.overridden = !!ov;
  if (ov) {
    if ('title' in ov) t.tagTitle = ov.title;
    if ('artist' in ov) t.tagArtist = ov.artist;
    if ('album' in ov) t.tagAlbum = ov.album;
    if ('albumArtist' in ov) t.tagAlbumArtist = ov.albumArtist;
    if ('genre' in ov) t.tagGenre = ov.genre;         // ジャンル・発売年（v3.2）
    if ('year' in ov) t.tagYear = +ov.year || 0;
  }
  var dirs = t.folder ? t.folder.split('/') : [];
  var base = stripExt(t.name);
  var guessTitle = base.replace(/^\d{1,3}(-\d{1,3})?[\s._-]+(?=\S)/, '') || base;
  t.title = t.tagTitle || guessTitle;
  t.titleGuessed = !t.tagTitle;
  t.album = t.tagAlbum || (dirs.length ? dirs[dirs.length - 1] : '');
  t.albumGuessed = !t.tagAlbum;
  t.artist = t.tagArtist || (dirs.length >= 2 ? dirs[dirs.length - 2] : '');
  t.artistGuessed = !t.tagArtist;
  t.search = (t.title + ' ' + t.artist + ' ' + t.album + ' ' + t.name + ' ' + t.folder).toLowerCase();
  library.metaRev = (library.metaRev || 0) + 1;   // 曲情報が変わった目印（アルバムのまとめ方の控えを作り直す。14-albums.js。v2.9）
}

/* ---------- 音楽フォルダを読み込む ----------
   opts.full：全曲をきちんと確認する（大きさ・更新日時で変わった曲を読み直す）。
   戻るのはフォルダをたどり終えたとき。曲情報はそのあと裏で読む */
async function scanLibrary(opts) {
  opts = opts || {};
  if (!isConnected()) return;
  var token = ++library.scanToken;
  library.scanning = true;
  library.scanFound = 0;
  library.metaFailed = 0;
  library.lastAdded = 0; library.lastRemoved = 0;
  if (typeof loadProgressBegin === 'function') loadProgressBegin();   // 読み込みの進み具合（v2.6）
  renderConnectionStatus();

  // 控え（IndexedDB）と情報のメモファイル
  if (typeof libIndexEnsureLoaded === 'function') await libIndexEnsureLoaded();
  if (token !== library.scanToken) return;
  if (libIndex.folder && fsa.folderName && libIndex.folder !== fsa.folderName && !library.tracks.length) { tagCache = {}; firstSeen = {}; }   // 別の音楽フォルダの控え
  var fromMemo = 0;
  // 「曲情報を読み直す」のときはメモファイルを使わない（v3.1 まで：消した控えをメモファイルから戻してしまい、読み直しにならなかった）
  if (!opts.noMemo) { try { fromMemo = await memoUseIfNewer(); } catch (e) { console.warn('情報のメモファイルを使えませんでした', e); } }
  if (token !== library.scanToken) return;
  var full = _needFullCheck(opts);
  library.lastMode = full ? 'full' : 'fast';
  library.lastFromMemo = fromMemo;

  // まだ一覧が無ければ、控えからすぐに一覧を作る（フォルダの確認は裏で）
  var fromCache = false;
  if (!library.tracks.length && Object.keys(tagCache).length) {
    _setTracks(Object.keys(tagCache).sort().map(function (p) { return makeTrack(p, null); }), null, library.trashFiles);
    library.scanned = true;
    fromCache = true;
    renderAll();
  }

  // ① フォルダの中を探す（名前だけ）
  var found;
  try {
    found = await _walkMusicFolder(fsa.root, token);
  } catch (e) {
    console.error('音楽フォルダの読み込みエラー', e);
    if (token === library.scanToken) {
      library.scanning = false;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) markPermissionLost();
      else if (e && e.name === 'NotFoundError') showToast('音楽フォルダが見つかりません（移動・名前変更された可能性があります）。「音楽フォルダを選ぶ」から選び直してください。', true);
      else showToast('音楽フォルダの読み込みに失敗しました：' + (e && e.message ? e.message : e), true);
      if (typeof loadProgressFinish === 'function') loadProgressFinish('failed', e && e.name === 'NotFoundError' ? '音楽フォルダが見つかりません' : (e && e.message ? e.message : String(e)));
      renderAll();
    }
    return;
  }
  if (!found || token !== library.scanToken) return;   // 途中で読み直しが始まった

  // 今の一覧と比べる：同じ曲なら、ファイルの手がかり（handle）を入れ替えるだけ
  var prev = library.byPath, added = 0, same = library.tracks.length === found.files.length;
  found.files.forEach(function (f) { if (!prev[f.path]) { added++; same = false; } });
  var firstLoad = !library.tracks.length;   // 控えも一覧も無い（初めての読み込み）：増えた・なくなったは出さない
  library.lastAdded = firstLoad ? 0 : added;
  library.lastRemoved = firstLoad ? 0 : Math.max(0, library.tracks.length - (found.files.length - added));
  if (same) {
    found.files.forEach(function (f) { prev[f.path].handle = f.handle; });
    library.folders = found.folders;
    library.trashFiles = found.trash;
  } else {
    _setTracks(found.files.map(function (f) { return makeTrack(f.path, f.handle); }), found.folders, found.trash);
  }
  library.scanning = false;
  library.scanned = true;

  // ② 曲情報を読む：高速モードは増えた曲（控えの無い曲）と、古い版の控えの曲（ジャンル・発売年などを補う。v3.2）、全確認は全曲
  var need = full ? library.tracks.slice() : library.tracks.filter(function (t) { return !t.metaLoaded || tagCacheNeedsDetail(tagCache[t.path]); });
  library.metaUpgradeN = full ? 0 : need.filter(function (t) { return t.metaLoaded; }).length;
  _metaForce = !!opts.force;   // 「曲情報を読み直す」：大きさ・更新日時が同じでも読み直す
  library.metaRunning = true;   // すぐ ② に入る（その間に「読み直す」が二重に始まらないように）
  if (typeof loadProgressStage === 'function') loadProgressStage('meta');
  if (!same) renderAll();
  else { renderSidebarCounts(); renderConnectionStatus(); if (currentPage === 'settings' || currentPage === 'organizer') renderCurrentPage(); }
  readMetadataInBackground(token, need, full);   // 待たない（裏で進める）
}
// ファイル整理のあと、動かした曲だけを一覧に反映する（v7.3。全体の読み直しの代わり）
//   type：move／trash／rename（map は { 変更前: 変更後 }）・mkdir・rmdir（plan の to がフォルダ）
//   ・削除フォルダへ移した曲は一覧から外し、削除フォルダの数を足す（削除フォルダの中の曲は今までどおり一覧に入れない）
//   ・削除フォルダから戻した曲・移した先の曲は、その場所のファイルを確かめてから一覧に足す（曲情報は控え〔applyPathMapping で付け替え済み〕から。無ければ裏で読む）
//   ・確かめられなかった曲があれば false（呼ぶ側は全体を読み直す）
async function libraryApplyFileOp(type, res, plan) {
  if (!library.scanned || library.scanning) return false;
  if (type === 'mkdir' || type === 'rmdir') {
    var fs = new Set(library.folders);
    (res.done || []).forEach(function (i) { if (isInTrash(i.to)) return; if (type === 'mkdir') fs.add(i.to); else fs.delete(i.to); });
    library.folders = Array.from(fs).sort(JA_COLLATOR.compare);
    return true;
  }
  var map = res.map || {}, froms = Object.keys(map);
  if (!froms.length) return true;
  var drop = new Set(), adds = [];
  froms.forEach(function (from) {
    var to = map[from];
    if (isInTrash(from)) library.trashFiles = Math.max(0, library.trashFiles - 1); else drop.add(from);
    if (isInTrash(to)) library.trashFiles++; else adds.push(to);
  });
  // 足す曲のファイルを確かめる（handle も取る）
  var handles = {};
  try {
    await Promise.all(adds.map(function (p) { return getFileHandleByPath(p).then(function (h) { handles[p] = h; }); }));
  } catch (e) { console.warn('動かした曲を確かめられなかったため、全体を読み直します', e); return false; }
  var tracks = library.tracks.filter(function (t) { return !drop.has(t.path); });
  var need = [];
  adds.forEach(function (p) {
    if (library.byPath[p] && !drop.has(p)) return;
    var t = makeTrack(p, handles[p]);
    if (!firstSeen[p]) { firstSeen[p] = Date.now(); t.firstSeen = firstSeen[p]; }
    tracks.push(t);
    if (!t.metaLoaded) need.push(t);
  });
  tracks.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });   // 全体の読み直しと同じ並び
  // フォルダの一覧：移した先のフォルダ（と親）を足す。元のフォルダは空でも残る（フォルダ自体は消えないので、読み直しと同じ）
  var fs2 = new Set(library.folders);
  adds.forEach(function (p) { var d = splitPath(p).dir; while (d && !fs2.has(d)) { fs2.add(d); d = splitPath(d).dir; } });
  _setTracks(tracks, Array.from(fs2).sort(JA_COLLATOR.compare), library.trashFiles);
  library.metaRev = (library.metaRev || 0) + 1;
  library.lastAdded = 0; library.lastRemoved = 0;
  libIndexChanged();
  if (need.length && typeof readTrackMetaNow === 'function') {   // 控えの無い曲だけ、その場で曲情報を読む
    await Promise.all(need.map(function (t) { return readTrackMetaNow(t).catch(function () { return false; }); }));
    libIndexChanged();
  }
  if (typeof memoAutoWrite === 'function') memoAutoWrite().catch(function (e) { console.warn(e); });   // 情報のメモファイル（変化があれば）
  return true;
}
function _setTracks(tracks, folders, trash) {
  library.tracks = tracks;
  library.byPath = {};
  tracks.forEach(function (t) { library.byPath[t.path] = t; });
  if (folders) library.folders = folders;
  else {   // 控えから作ったとき：曲のパスからフォルダの一覧を作る
    var set = { '': true };
    tracks.forEach(function (t) { var d = t.folder; while (d && !set[d]) { set[d] = true; d = splitPath(d).dir; } });
    library.folders = Object.keys(set).sort(JA_COLLATOR.compare);
  }
  library.trashFiles = trash || 0;
}
// 全確認が必要か
function _needFullCheck(opts) {
  if (opts.full) return true;
  if (db.settings.fastMode === false) return true;               // 高速モードがオフ（毎回きちんと確認）
  if (!Object.keys(tagCache).length) return false;              // 控えが無い：全曲が「増えた曲」になるので同じ
  var days = +db.settings.fullCheckDays;
  if (!libIndex.fullCheckAt) return !!days;
  return days > 0 && Date.now() - libIndex.fullCheckAt > days * 86400000;
}
// フォルダを同時にいくつかたどって、曲ファイル（名前と handle）とフォルダの一覧を作る（v2.7）
function _walkMusicFolder(root, token) {
  return new Promise(function (resolve, reject) {
    var queue = [{ dir: root, rel: '', trash: false }], active = 0, done = false;
    var files = [], folders = [''], trash = 0;
    function finish(v, err) { if (done) return; done = true; if (err) reject(err); else resolve(v); }
    function pump() {
      if (done) return;
      if (token !== library.scanToken) { finish(null); return; }
      while (active < SCAN_CONCURRENCY && queue.length) {
        var job = queue.shift();
        active++;
        readDir(job).then(function () { active--; pump(); }, function (e) { finish(null, e); });
      }
      if (!active && !queue.length) {
        files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
        folders.sort(JA_COLLATOR.compare);
        finish({ files: files, folders: folders, trash: trash });
      }
    }
    async function readDir(job) {
      for await (var h of job.dir.values()) {
        if (done) return;
        if (job.trash) {   // 削除フォルダの中は数だけ数える
          if (h.kind === 'directory') queue.push({ dir: h, rel: '', trash: true }); else trash++;
          continue;
        }
        if (h.name.charAt(0) === '.') continue;   // 隠しファイル・隠しフォルダ（情報のメモファイルも）は見ない
        var p = job.rel ? job.rel + '/' + h.name : h.name;
        if (h.kind === 'directory') {
          if (!job.rel && h.name === TAG_BACKUP_FOLDER_NAME) continue;   // タグ編集前の控えは一覧に出さない
          if (!job.rel && h.name === TRASH_FOLDER_NAME) { queue.push({ dir: h, rel: '', trash: true }); continue; }
          folders.push(p);
          queue.push({ dir: h, rel: p, trash: false });
        } else if (AUDIO_EXTS.indexOf(extOf(h.name)) >= 0) {
          files.push({ path: p, handle: h });
          library.scanFound = files.length;
          if (typeof loadProgressTick === 'function') loadProgressTick();
        }
      }
    }
    pump();
  });
}
// 起動時（12-init.js・02-folder-access.js から）：控えを読んでから読み込む
async function startLibraryLoad() {
  await libIndexEnsureLoaded();
  return scanLibrary();
}
// 「全曲をきちんと確認」（tools）
async function runFullCheck() {
  if (!isConnected()) { showToast('先に音楽フォルダにつないでください。', true); return; }
  if (isLibraryLoading()) { showToast('読み込み中です。終わってから、もう一度押してください。'); return; }
  await scanLibrary({ full: true });
}

// 別の音楽フォルダに切り替えたとき（同じ名前のフォルダを選び直したときは、控えをそのまま使う。v2.7）
function resetLibraryForNewFolder(newName) {
  library.scanToken++;
  library.tracks = []; library.byPath = {}; library.folders = ['']; library.trashFiles = 0;
  library.scanned = false; library.scanning = false;
  if (!(newName && libIndex.folder === newName)) {
    clearTagCache();
    firstSeen = {}; saveFirstSeen();   // 別の音楽フォルダなので追加日も最初から
    libIndex.fullCheckAt = 0;
    libIndex.folder = newName || '';
  }
  if (typeof artReset === 'function') artReset();   // ジャケット画像のメモリも解放
}

/* ---------- 曲情報を裏で読む ---------- */
var _metaDirty = false, _metaFsInitial = false, _metaForce = false;
// 1曲の曲情報を読む（控えが新しければ控えを使う）。変わったら true
// force：大きさ・更新日時が同じでも、必ずタグを読み直す（「曲情報を読み直す」・古い控えを補うとき。v3.2）
async function _readOneTrackMeta(t, force) {
  var dirty = false;
  var file = await t.handle.getFile();
  if (!firstSeen[t.path]) { firstSeen[t.path] = _metaFsInitial ? (file.lastModified || Date.now()) : Date.now(); dirty = true; }
  t.firstSeen = firstSeen[t.path];
  var c = tagCache[t.path];
  if (force || _metaForce || tagCacheNeedsDetail(c) || !(c && c.v === TAG_CACHE_VERSION && c.s === file.size && c.m === file.lastModified)) {
    var tags = await readTrackTags(file);
    if (!tags.duration) tags.duration = await probeDuration(file);
    c = { v: TAG_CACHE_VERSION, s: file.size, m: file.lastModified, t: tags.title, a: tags.artist, l: tags.album,
          aa: tags.albumArtist, n: tags.track, k: tags.disc, d: Math.round(tags.duration * 10) / 10 };
    if (tags.compilation) c.cp = 1;   // コンピレーションの印（v2.9）
    if (tags.genre) c.g = tags.genre;  // ジャンル（v3.1）
    if (tags.year) c.y = tags.year;    // 発売年（v3.1）
    c.f = TAG_DETAIL_VERSION;          // ここまで読んだ控え（v3.2）
    tagCache[t.path] = c;
    dirty = true;
  }
  applyCacheToTrack(t, c);
  fillDisplayFields(t);
  t.metaLoaded = true;
  return dirty;
}
// 画面に見えている曲の曲情報を、裏の読み込みの順番を待たずに先に読む（ジャケットを早く出すため。v2.5）
//   同じ曲を2回読まないよう、読み込み中の Promise を t._metaP に持つ
function readTrackMetaNow(t) {
  if (!t) return Promise.resolve(false);
  if (t.metaLoaded) return Promise.resolve(true);
  if (!t._metaP) {
    t._metaP = _readOneTrackMeta(t).then(function (d) { if (d) _metaDirty = true; return true; },
      function (e) { console.warn('曲情報を読めませんでした:', t.path, e); return false; });
  }
  return t._metaP;
}
// list：読む曲（高速モードは増えた曲だけ、全確認は全曲）。full：全確認（終わったら最終の全確認を記録）
// 古い控えの曲（ジャンル・発売年などが無い）を、裏の順番を待たずに今すぐ補う（開いたアルバムの曲。v3.2）。補ったら onDone
function readTrackDetailNow(tracks, onDone) {
  var ps = [];
  tracks.forEach(function (t) {
    if (!t || !tagCacheNeedsDetail(tagCache[t.path])) return;
    if (!t._metaP) {
      t._metaP = _readOneTrackMeta(t, true).then(function (d) { if (d) _metaDirty = true; return true; },
        function (e) { console.warn('曲情報を読めませんでした:', t.path, e); return false; });
    }
    ps.push(t._metaP);
  });
  if (!ps.length) return false;
  Promise.all(ps).then(function () {
    if (!library.metaRunning && _metaDirty) { libIndexChanged(); _metaDirty = false; }   // 読み込みの外で補ったときは、ここで保存
    if (onDone) onDone();
  });
  return true;
}
async function readMetadataInBackground(token, list, full) {
  list = list || library.tracks.slice();
  library.metaTotal = list.length;
  library.metaDone = 0;
  library.metaRunning = true;
  var idx = 0, lastRender = Date.now();
  // 途中の描き直しの間隔：曲が多いほど長く（16,200曲で約8秒。描き直し自体が重いため。進み具合は帯に出る。v2.7）
  var renderEvery = Math.max(1500, Math.min(10000, library.tracks.length / 2));
  _metaDirty = false;
  _metaFsInitial = Object.keys(firstSeen).length === 0;   // いちばん最初の読み込み

  async function worker() {
    while (idx < list.length) {
      if (token !== library.scanToken) return;
      var t = list[idx++];
      if (t._metaP) { if (!(await t._metaP)) library.metaFailed++; }   // 画面の都合で先に読んだ（読んでいる）曲
      else {
        try { if (await _readOneTrackMeta(t)) _metaDirty = true; }
        catch (e) { console.warn('曲情報を読めませんでした:', t.path, e); library.metaFailed++; }
      }
      delete t._metaP;
      library.metaDone++;
      if (typeof loadProgressTick === 'function') loadProgressTick();
      if (Date.now() - lastRender > renderEvery) {
        lastRender = Date.now();
        if (_metaDirty) { libIndexChanged(); _metaDirty = false; }
        onMetadataProgress(false);
      }
    }
  }
  var workers = [];
  for (var wi = 0; wi < (full ? FULL_CHECK_WORKERS : META_WORKERS); wi++) workers.push(worker());
  await Promise.all(workers);
  if (token !== library.scanToken) return;
  // 一覧に無くなった曲の控えを消す（削除フォルダへ移したものなど）
  var removed = 0;
  Object.keys(tagCache).forEach(function (p) { if (!library.byPath[p]) { delete tagCache[p]; removed++; } });
  if (full || (list.length && list.length === library.tracks.length)) libIndex.fullCheckAt = Date.now();   // 全曲を読んだ（初回も）
  if (_metaDirty || removed || library.lastAdded) libIndex.changedAt = Date.now();   // 変わったときだけ（メモファイルの書き出しの目安にもなる）
  libIndexSaveNow().catch(function (e) { console.warn('曲情報の控えを保存できませんでした', e); });   // 読み終わったらすぐ保存
  _metaDirty = false;
  library.metaRunning = false;
  _metaForce = false;
  onMetadataProgress(true);
  if (typeof loadProgressFinish === 'function') loadProgressFinish('done');
  if (typeof memoAutoWrite === 'function') memoAutoWrite().catch(function (e) { console.warn(e); });   // 情報のメモファイル（変化があれば）
}

// 読み進んだら、今の画面と再生バーを更新する
function onMetadataProgress(finished) {
  renderLibScanStatus();
  if (finished && typeof migrateAlbumKeys === 'function') migrateAlbumKeys();   // アルバムのまとめ方の変更（v2.9）で変わった目印を引き継ぐ
  if (finished) renderSidebarCounts();   // アルバム数はアルバム名を読み終わってから決まる
  // ファイル整理は操作中に描き直すと選択がちらつくので、読み終わったときだけ描き直す
  // 一覧をたくさん読み込んでいるときは、途中で描き直すと重いので、読み終わったときだけ描き直す（v2.4）
  var heavyList = (currentPage === 'library' && libView.limit > LIB_PAGE_SIZE) || (currentPage === 'albums' && albView.limit > ALB_PAGE_SIZE);
  if (finished || (!heavyList && ['library', 'playlists', 'albums', 'artists', 'newsongs', 'western'].indexOf(currentPage) >= 0)) renderCurrentPage();
  if (typeof updatePlayerUi === 'function') updatePlayerUi();
}

// 形式の中から長さが読めなかったとき、audio 要素に読ませて長さを調べる（再生はしない）
function probeDuration(file) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var a = new Audio();
    var done = false;
    var timer = null;
    function finish(d) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      try { a.load(); } catch (e) { /* 無視 */ }
      URL.revokeObjectURL(url);
      resolve(isFinite(d) && d > 0 ? d : 0);
    }
    a.preload = 'metadata';
    a.onloadedmetadata = function () { finish(a.duration); };
    a.onerror = function () { finish(0); };
    timer = setTimeout(function () { finish(0); }, 8000);
    a.src = url;
  });
}

/* ---------- 読み込み状況 ----------
   v2.6 から、songs のフィルターバーの下の表示はやめて、どの画面でも見える「読み込みの進み具合」（22-load-progress.js）にまとめた */
function renderLibScanStatus() {
  if (typeof renderLoadProgress === 'function') renderLoadProgress();
}

// 画面の「読み直す」ボタン（読み込み中は二重に始めない。終わったら「読み込み完了」が出る）
async function rescanLibraryFromUi() {
  if (!fsa.root) { pickMusicFolder(); return; }
  if (fsa.state !== 'granted') { reconnectMusicFolder(); return; }
  if (isLibraryLoading()) { showToast('読み込み中です。終わってから、もう一度押してください。'); return; }
  await scanLibrary();   // 高速モード（増えた曲・なくなった曲だけ）。前回の全確認から日がたっていれば全確認
}

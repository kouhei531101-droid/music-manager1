/* =========================================================
   01-core.js ― 共通の土台
   ・保存データ（db）の読み書き（localStorage）
   ・画面の切り替え（サイドバーのメニュー項目）
   ・お知らせ（トースト）／ダイアログ（確認・入力・お知らせ）／実行中の表示
   ・アイコン（線で描いたSVG）・呼び方コピー（□）・小さな便利関数
   ========================================================= */

/* ---------- 保存キー ----------
   file:// で開くと、同じPCの他の file:// アプリ（garden-journal など）と
   localStorage / IndexedDB を共有するため、必ず「musicManager_」で始まる名前にする。 */
var DB_KEY = 'musicManager_v1';              // 文字データ（v8.1 までは全部。v8.2 からは基本の設定だけ。プレイリスト・操作履歴などは IndexedDB musicManager_store。52-data-store.js）。バックアップ対象
var TAG_CACHE_KEY = 'musicManager_tagCache'; // 曲情報の控え（タグの読み取り結果）。バックアップ対象外
var UI_KEY = 'musicManager_ui';              // 見た目の設定（最後に開いた画面など）。バックアップ対象外
var TRASH_FOLDER_NAME = '削除フォルダ';       // 「削除」したファイルの移動先（音楽フォルダ直下）
var TAG_BACKUP_FOLDER_NAME = 'タグ編集前の控え'; // タグを書き込む前の元ファイルのコピー置き場（音楽フォルダ直下。17-tag-edit.js）
var HISTORY_MAX = 200;                        // 操作履歴を残す件数

/* ---------- 保存データ（db） ---------- */
function freshDB() {
  return {
    schema: 1,
    playlists: [],   // { id, name, tracks:[音楽フォルダからの相対パス], createdAt, updatedAt }
    history: [],     // ファイル整理の操作履歴（新しい順）{ id, type, at, items:[{from,to}], undone, undoneAt }
    settings: { volume: 0.8, sortKey: 'title', sortDir: 'asc', repeat: 'off', lastBackupAt: '', musicFolderName: '',
                albumSortKey: 'standard', albumSortDir: 'asc', albumSortV13: true,   // 古い版のために残す（v4.0 からは albumSort が本体）
                // 並べ替えの設定（v4.0。29-album-sort.js）：mode 'fields'（項目で並べる）/ 'custom'（自分で並べる）、fields は優先の順
                albumSort: { mode: 'fields', fields: [{ key: 'name', dir: 'asc' }, { key: 'artist', dir: 'asc' }] },
                shuffle: false, showUiLabels: true,
                albumPinOnly: false,
                plAutoOpen: false,    // プレイリスト再生時に play画面を自動で開く（v5.6）
                npSpinCd: true,       // 再生画面の「回転CD」を出す（v8.3。54-spin-cd.js。無い古いデータ・バックアップはオンとして読む）
                npVisual: 'cd',       // 再生画面のプレイヤー表示（v8.4。'cd' 回転CD／'cassette' カセットテープ／'none' なし。無いときは npSpinCd から読む）
                albumGroup: 'none',   // album 一覧のグループ表示（none／tag／genre／decade。v5.3。38-album-groups.js）  // album の「Pin のみ」（Pin したアルバムだけを表示。v4.1。26-pinned-albums.js）
                fastMode: true,       // 高速モード（v2.7）：起動・読み直すでは増えた曲・なくなった曲だけ
                fullCheckDays: 7,     // 全曲をきちんと確認する間隔（日。0＝自動ではしない）
                memoFile: true },     // 情報のメモファイルを使う
    albumOrder: [],  // アルバムのカスタム順（アルバムの目印の並び。14-albums.js の albumKeyOf）
    lyrics: {},      // 入力した歌詞 { 曲の相対パス: { text, updatedAt } }（15-lyrics.js）
    playStats: {},   // 再生回数 { 曲の相対パス: { c:回数, l:最終再生, h:[最近の再生日時] } }（20-heavy-rotation.js）
    artistCovers: {},// アーティストの代表ジャケットの選択 { アーティスト名: { album:アルバムの目印 } または { custom:true } }（21-artists.js）
    tagOverrides: {},// アプリ内の曲情報の上書き { 曲の相対パス: { title?, artist?, album?, albumArtist? } }（17-tag-edit.js）
    hiddenAlbums: [],// 非表示のアルバム [{ key:アルバムの目印, name, artist, at }]（24-hidden-albums.js。v3.0）
    pinnedAlbums: [],// Pin したアルバム [{ key:アルバムの目印, name, artist, at }]（並び＝一覧の先頭の順。26-pinned-albums.js。v3.4）
    albumTags: [{ id: 'single', name: 'single', color: 'blue' }, { id: 'album', name: 'album', color: 'green' }, { id: 'best', name: 'BEST', color: 'orange' }, { id: 'mini', name: 'MINI', color: 'purple' }, { id: 'western', name: '洋楽', color: 'teal' }],   // アルバムのタグの一覧（v5.2 から「洋楽」も）（並び＝並べ替えの順。31-album-tags.js。v4.4）
    albumTagOf: {},   // アルバムに付けたタグ { アルバムの目印: タグの id }（v4.4）
    westernMethod: 'sortkey', // 洋楽の自動の判定の方法（'sortkey' ソートキーで判定〔v6.5 の初期。v6.4 までの 'tags' タグで判定もこれとして読む〕／'chars' 文字の種類／'both' 両方）
    westernWords: null,    // 判定に使う言葉（null＝初期：洋楽・Western music。v5.2）
    westernGenres: null,   // 邦楽のジャンル（null＝初期の一覧。36-western.js。v5.0）
    westernAlbums: {},     // アルバムごとの洋楽の指定 { アルバムの目印: true／false }
    westernArtists: {},    // アーティストごとの洋楽の指定 { アーティスト名: true／false }
    dupIgnore: [],   // 重複チェックの「重複ではない」の印 [{ key, paths, label, at }]（34-duplicates.js。v4.7）
    genreSuggest: null,// ジャンルの候補（並び＝表示順。null＝まだ作っていない→自動の候補で作る。32-genre-suggest.js。v4.5）
    seasonWords: null, // Seasons Song の判定に使う言葉 { spring:[…], summer, fall, winter }（null＝初期の一覧。46-seasons.js。v7.4）
    bpmManual: {},     // 手で入れた BPM { 曲の相対パス: BPM }（49-upbeat.js。v7.8）。基準の BPM は settings.upbeatMin（初期 140）
    seasonOverride: {},// 手で決めた季節 { 曲の相対パス: 'spring'|'summer'|'fall'|'winter'|'none' }（v7.4）
    skCovers: {},     // ソートキーの枠の代表ジャケット { ソートキーの正規化した文字: アルバムの目印 }（42-sortkey-cover.js。v6.0）
    albumSortKeys: {},// アルバムのソートキー { アルバムの目印: 'ソートキー' }（30-album-sortkey.js。v4.3）
    pinnedArtists: [],// Pin したアーティスト [{ key:アーティストの目印（名前）, name, at }]（並び＝一覧の先頭の順。28-pinned-artists.js。v3.9）
    nextId: 1
  };
}

// 古いデータ・バックアップを読み込んだときに、足りない項目を補って形をそろえる
function normalizeDB(data) {
  var base = freshDB();
  if (!data || typeof data !== 'object') return base;
  var out = {
    schema: 1,
    playlists: [],
    history: [],
    settings: Object.assign({}, base.settings, (data.settings && typeof data.settings === 'object') ? data.settings : {}),
    albumOrder: Array.isArray(data.albumOrder) ? data.albumOrder.filter(function (k) { return typeof k === 'string' && k; }) : [],
    lyrics: {},
    tagOverrides: {},
    playStats: {},
    artistCovers: {},
    // 非表示のアルバム（v3.0 で追加。古いデータ・バックアップには無いので空のまま）
    hiddenAlbums: Array.isArray(data.hiddenAlbums) ? data.hiddenAlbums.filter(function (h) { return h && typeof h.key === 'string' && h.key; })
      .map(function (h) { return { key: h.key, name: String(h.name || ''), artist: String(h.artist || ''), at: h.at || nowIso() }; }) : [],
    // Pin（v3.4 で追加。古いデータ・バックアップには無いので空のまま）
    pinnedAlbums: Array.isArray(data.pinnedAlbums) ? data.pinnedAlbums.filter(function (h) { return h && typeof h.key === 'string' && h.key; })
      .map(function (h) { return { key: h.key, name: String(h.name || ''), artist: String(h.artist || ''), at: h.at || nowIso() }; }) : [],
    // アーティストの Pin（v3.9 で追加。古いデータ・バックアップには無いので空のまま。同じ名前は1つだけ）
    pinnedArtists: Array.isArray(data.pinnedArtists) ? (function () {
      var seen = new Set();
      return data.pinnedArtists.filter(function (h) { if (!h || typeof h.key !== 'string' || !h.key || seen.has(h.key)) return false; seen.add(h.key); return true; })
        .map(function (h) { return { key: h.key, name: String(h.name || h.key), at: h.at || nowIso() }; });
    })() : [],
    nextId: (typeof data.nextId === 'number' && data.nextId > 0) ? data.nextId : 1
  };
  // v1.3 の移行（1回だけ）：アルバムの並べ替えの初期値を「標準（アーティスト→アルバム名）」にする。
  // v1.2 までの保存データ・バックアップには albumSortV13 が無いので、ここで標準にそろえる
  // （out.settings は初期値と混ぜたあとなので、元のデータ側に印があるかで判定する）
  if (!(data.settings && data.settings.albumSortV13)) {
    out.settings.albumSortKey = 'standard';
    out.settings.albumSortDir = 'asc';
    out.settings.albumSortV13 = true;
  }
  // v4.0 の移行：並べ替えの設定を新しい形（albumSort）に。無ければ古い albumSortKey / albumSortDir から同じ並びを作る
  var srcSort = data.settings && data.settings.albumSort;
  //   起動したとき（このファイルを読んだ時点）は 29-album-sort.js がまだ無いので、元の値をそのまま残し、使うとき（albumSortSpec()）に形をそろえる
  //   （v4.4 で修正：v4.0〜v4.3 は起動のたびに並べ替えの設定が「標準」に戻っていた）
  if (typeof normalizeAlbumSortSpec === 'function') {
    out.settings.albumSort = (srcSort && normalizeAlbumSortSpec(srcSort)) || albumSortSpecFromLegacy(out.settings.albumSortKey, out.settings.albumSortDir);
  } else {
    out.settings.albumSort = (srcSort && typeof srcSort === 'object') ? srcSort : null;
  }
  // アルバムのタグ（v4.4。31-album-tags.js）：古いデータは初期のタグ一覧・付与なし。起動したときは 31 を読んだあとで形をそろえる
  if (typeof normalizeAlbumTags === 'function') {
    var nt = normalizeAlbumTags(data.albumTags, data.albumTagOf);
    out.albumTags = nt.tags; out.albumTagOf = nt.tagOf;
  } else {
    out.albumTags = Array.isArray(data.albumTags) ? data.albumTags : undefined;
    out.albumTagOf = (data.albumTagOf && typeof data.albumTagOf === 'object') ? data.albumTagOf : {};
  }
  var maxId = 0;
  (Array.isArray(data.playlists) ? data.playlists : []).forEach(function (p) {
    if (!p || typeof p !== 'object') return;
    var pl = {
      id: typeof p.id === 'number' ? p.id : 0,
      name: String(p.name || '無題のプレイリスト'),
      tracks: Array.isArray(p.tracks) ? p.tracks.filter(function (t) { return typeof t === 'string' && t; }) : [],
      createdAt: p.createdAt || nowIso(),
      updatedAt: p.updatedAt || p.createdAt || nowIso()
    };
    maxId = Math.max(maxId, pl.id);
    out.playlists.push(pl);
  });
  (Array.isArray(data.history) ? data.history : []).forEach(function (h) {
    if (!h || typeof h !== 'object' || !Array.isArray(h.items)) return;
    var entry = {
      id: typeof h.id === 'number' ? h.id : 0,
      type: String(h.type || ''),
      at: h.at || nowIso(),
      items: h.items.filter(function (i) { return i && typeof i.to === 'string'; }),
      undone: !!h.undone,
      undoneAt: h.undoneAt || ''
    };
    // アルバムの一括編集（v6.x）の見出し・アルバムの設定の控え（v8.2 から読み直しても残す。前は開き直すと消えていた）
    if (typeof h.label === 'string' && h.label) entry.label = h.label;
    if (Array.isArray(h.albumSettings) && h.albumSettings.length) entry.albumSettings = h.albumSettings;
    if (h.settingsUndone) entry.settingsUndone = true;
    maxId = Math.max(maxId, entry.id);
    out.history.push(entry);
  });
  // アプリ内の曲情報の上書き（v1.5 で追加。古いデータ・バックアップには無いので空のまま）
  if (data.tagOverrides && typeof data.tagOverrides === 'object') {
    Object.keys(data.tagOverrides).forEach(function (k) {
      var v = data.tagOverrides[k], o = {};
      if (!k || !v || typeof v !== 'object') return;
      ['title', 'artist', 'album', 'albumArtist', 'genre', 'year'].forEach(function (f) { if (typeof v[f] === 'string') o[f] = v[f]; });   // genre・year は v3.2
      if (Object.keys(o).length) out.tagOverrides[k] = o;
    });
  }
  // 再生回数・アーティストの代表ジャケットの選択（v2.2 で追加。古いデータには無いので空のまま）
  if (data.playStats && typeof data.playStats === 'object') {
    Object.keys(data.playStats).forEach(function (k) {
      var v = data.playStats[k];
      if (!k || !v || typeof v !== 'object') return;
      out.playStats[k] = { c: +v.c || 0, l: +v.l || 0, h: Array.isArray(v.h) ? v.h.filter(function (x) { return typeof x === 'number'; }).slice(-50) : [] };
    });
  }
  // Western music の設定（v5.0 で追加。古いデータ・バックアップには無いので、初期の一覧・指定なし）
  // v5.2：判定の方法（古いデータは新しい初期値「タグで判定」）と、判定に使う言葉
  out.westernMethod = data.westernMethod === 'chars' || data.westernMethod === 'both' ? data.westernMethod : 'sortkey';   // v6.5：'tags'（v6.4 まで）→ 'sortkey'
  out.westernWords = Array.isArray(data.westernWords) ? data.westernWords.filter(function (g) { return typeof g === 'string' && g.trim(); }).map(function (g) { return g.trim().slice(0, 40); }) : null;
  if (out.westernWords && !out.westernWords.length) out.westernWords = null;
  out.westernGenres = Array.isArray(data.westernGenres) ? data.westernGenres.filter(function (g) { return typeof g === 'string' && g.trim(); }).map(function (g) { return g.trim().slice(0, 40); }) : null;
  ['westernAlbums', 'westernArtists'].forEach(function (k) {
    out[k] = {};
    if (data[k] && typeof data[k] === 'object') Object.keys(data[k]).forEach(function (x) { if (typeof data[k][x] === 'boolean') out[k][x] = data[k][x]; });
  });
  // 重複ではない の印（v4.7 で追加。古いデータ・バックアップには無いので空のまま）
  out.dupIgnore = Array.isArray(data.dupIgnore) ? data.dupIgnore.filter(function (x) { return x && typeof x.key === 'string' && Array.isArray(x.paths); })
    .map(function (x) { return { key: x.key, paths: x.paths.filter(function (p) { return typeof p === 'string'; }), label: String(x.label || ''), at: x.at || nowIso() }; }) : [];
  // ジャンルの候補（v4.5 で追加。古いデータ・バックアップには無いので null＝あとで自動の候補で作る）。空白・同じ名前（大文字小文字は区別しない）は除く
  out.genreSuggest = null;
  if (Array.isArray(data.genreSuggest)) {
    var gseen = {};
    out.genreSuggest = [];
    data.genreSuggest.forEach(function (g) {
      if (typeof g !== 'string') return;
      var v = g.trim().slice(0, 60), low = v.toLowerCase();
      if (!v || gseen[low] || out.genreSuggest.length >= 500) return;
      gseen[low] = true; out.genreSuggest.push(v);
    });
  }
  // Seasons Song（v7.4 で追加。古いデータ・バックアップには無いので初期の言葉・指定なし）
  out.seasonWords = null;
  if (data.seasonWords && typeof data.seasonWords === 'object') {
    out.seasonWords = {};
    ['spring', 'summer', 'fall', 'winter'].forEach(function (k) { out.seasonWords[k] = Array.isArray(data.seasonWords[k]) ? data.seasonWords[k].filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim().slice(0, 40); }) : []; });
  }
  // upbeat music の手で入れた BPM（v7.8 で追加。古いデータ・バックアップには無いので空）
  out.bpmManual = {};
  if (data.bpmManual && typeof data.bpmManual === 'object') Object.keys(data.bpmManual).forEach(function (k) { var v = +data.bpmManual[k]; if (k && v >= 30 && v <= 300) out.bpmManual[k] = Math.round(v * 10) / 10; });
  out.seasonOverride = {};
  if (data.seasonOverride && typeof data.seasonOverride === 'object') Object.keys(data.seasonOverride).forEach(function (k) { var v = data.seasonOverride[k]; if (k && ['spring', 'summer', 'fall', 'winter', 'none'].indexOf(v) >= 0) out.seasonOverride[k] = v; });
  // ソートキーの枠の代表ジャケット（v6.0 で追加。古いデータ・バックアップには無いので空＝自動）
  out.skCovers = {};
  // v6.1：表示位置付きの形 { album, x, y, z } も読む（x・y は 0〜100、z は 1〜2。42-sortkey-cover.js より先に読み込まれるので、ここで直接そろえる）
  if (data.skCovers && typeof data.skCovers === 'object') Object.keys(data.skCovers).forEach(function (k) {
    var v = data.skCovers[k];
    if (!k) return;
    if (typeof v === 'string') { if (v) out.skCovers[k] = v; return; }
    if (!v || typeof v !== 'object') return;
    var num = function (x, lo, hi, d) { x = +x; return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
    var e = { album: typeof v.album === 'string' ? v.album : '', x: num(v.x, 0, 100, 50), y: num(v.y, 0, 100, 50), z: num(v.z, 1, 2, 1) };
    if (e.x === 50 && e.y === 50 && e.z === 1) { if (e.album) out.skCovers[k] = e.album; } else out.skCovers[k] = e;
  });
  // アルバムのソートキー（v4.3 で追加。古いデータ・バックアップには無いので空のまま）
  out.albumSortKeys = {};
  if (data.albumSortKeys && typeof data.albumSortKeys === 'object') {
    Object.keys(data.albumSortKeys).forEach(function (k) {
      var v = data.albumSortKeys[k];
      if (k && typeof v === 'string' && v.trim()) out.albumSortKeys[k] = v.trim().slice(0, 100);
    });
  }
  if (data.artistCovers && typeof data.artistCovers === 'object') {
    Object.keys(data.artistCovers).forEach(function (k) {
      var v = data.artistCovers[k];
      if (v && typeof v === 'object' && (typeof v.album === 'string' || v.custom === true)) out.artistCovers[k] = v.custom ? { custom: true } : { album: v.album };
    });
  }
  // 入力した歌詞（v1.4 で追加。古いデータ・バックアップには無いので空のまま）
  if (data.lyrics && typeof data.lyrics === 'object') {
    Object.keys(data.lyrics).forEach(function (k) {
      var v = data.lyrics[k];
      if (k && v && typeof v.text === 'string' && v.text.trim()) out.lyrics[k] = { text: v.text, updatedAt: v.updatedAt || nowIso() };
    });
  }
  out.nextId = Math.max(out.nextId, maxId + 1);
  // id が無い（0 の）ものに番号を振る
  out.playlists.forEach(function (p) { if (!p.id) p.id = out.nextId++; });
  out.history.forEach(function (h) { if (!h.id) h.id = out.nextId++; });
  if (out.history.length > HISTORY_MAX) out.history.length = HISTORY_MAX;
  return out;
}

function loadDB() {
  var raw = null;
  try {
    raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    console.error('loadDB error', e);
    // 壊れていたデータは消さずに別のキーへ控えておく（上書きで失われないように）
    try { if (raw) localStorage.setItem(DB_KEY + '_broken_' + Date.now(), raw); } catch (e2) { /* 容量不足なら諦める */ }
    return null;
  }
}

// 操作が1つ終わるたびにすぐ呼ぶ
// v8.2：基本の設定は localStorage、プレイリスト・操作履歴などは IndexedDB に分けて保存する（52-data-store.js の dbStoreSave）
function saveDB() {
  if (typeof dbStoreSave === 'function') return dbStoreSave();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    console.error('saveDB error', e);
    showToast('保存に失敗しました（ブラウザの保存容量がいっぱいの可能性があります）。', true);
    return false;
  }
}

function newId() { return db.nextId++; }

var db = loadDB() || freshDB();

/* ---------- 見た目の設定（バックアップ対象外） ---------- */
function loadUi() {
  var base = { lastPage: 'library', lastPlaylistId: null, orgFolder: '', lyricsCollapsed: false, lyricsFont: 17 };
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { saved = {}; }
  // v1.6 の移行：歌詞パネルは常に表示になった。v1.4〜1.5 で「閉じていた」（lyricsOpen:false）なら「縮小」、
  // 「開いていた」なら元の大きさで表示する（今までの画面の広さに近いまま使えるように）
  if (typeof saved.lyricsCollapsed !== 'boolean' && typeof saved.lyricsOpen === 'boolean') saved.lyricsCollapsed = !saved.lyricsOpen;
  delete saved.lyricsOpen;
  return Object.assign(base, saved);
}
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 見た目の設定なので失敗しても続ける */ }
}
var ui = loadUi();

/* ---------- 画面の切り替え ---------- */
var PAGES = {
  albums: 'アルバム',
  artists: 'アーティスト',
  library: '曲一覧',
  newsongs: 'new songs',
  heavy: 'heavy rotation',
  western: 'Western music',   // 洋楽のアルバム（v5.0。36-western.js）
  seasons: 'Seasons Song',    // 季節の曲（v7.4。46-seasons.js）
  upbeat: 'upbeat music',     // リズムの速い曲（v7.8。49-upbeat.js）
  playlists: 'プレイリスト',
  organizer: 'ファイル整理',
  settings: '設定・バックアップ',
  versions: 'バージョン管理'
};
var PAGE_RENDERERS = {};   // 各ファイルで PAGE_RENDERERS.xxx = 描画関数 を登録する
var currentPage = null;

function showPage(name) {
  if (!PAGES[name]) name = 'library';
  // 別の画面から来たときは、songs・album の一覧を最初の分から表示する（前に読み込んだ全部を一度に描き直さない。v2.4）
  if (name !== currentPage) {
    if (typeof libView !== 'undefined') libView.limit = LIB_PAGE_SIZE;
    if (typeof albView !== 'undefined') albView.limit = ALB_PAGE_SIZE;
  }
  currentPage = name;
  document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
  document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-page') === name); });
  ui.lastPage = name; saveUi();
  renderCurrentPage();
  window.scrollTo(0, 0);
}

// 今表示している画面だけを描き直す（スクロール位置はそのまま）
function renderCurrentPage() {
  var fn = PAGE_RENDERERS[currentPage];
  if (typeof fn === 'function') fn();
}

// サイドバーの件数バッジ
function renderSidebarCounts() {
  var a = document.getElementById('nav-count-library');
  if (a) a.textContent = (typeof library !== 'undefined' && library.tracks.length) ? String(library.tracks.length) : '';
  var al = document.getElementById('nav-count-albums');
  if (al) al.textContent = (typeof library !== 'undefined' && library.tracks.length && typeof buildAlbums === 'function') ? String(_countAlbums()) : '';
  var ac = document.getElementById('nav-count-artists');
  if (ac) ac.textContent = (typeof library !== 'undefined' && library.tracks.length && typeof artistNameOf === 'function') ? String(new Set(library.tracks.map(artistNameOf)).size) : '';
  var wc = document.getElementById('nav-count-western');   // Western music（v5.0）
  if (wc) wc.textContent = (typeof library !== 'undefined' && library.tracks.length && typeof westernCount === 'function') ? String(westernCount()) : '';
  var sc = document.getElementById('nav-count-seasons');   // Seasons Song（v7.4）
  if (sc) sc.textContent = (typeof library !== 'undefined' && library.tracks.length && typeof seasonCount === 'function') ? String(seasonCount()) : '';
  var ub = document.getElementById('nav-count-upbeat');   // upbeat music（v7.8）
  if (ub) ub.textContent = (typeof library !== 'undefined' && library.tracks.length && typeof upbeatCount === 'function' && typeof upb !== 'undefined' && upb.loaded) ? String(upbeatCount()) : '';
  var b = document.getElementById('nav-count-playlists');
  if (b) b.textContent = db.playlists.length ? String(db.playlists.length) : '';
}

// □の表示設定（v2.2）：オフなら body に hide-ui-labels
function applyUiLabelSetting() {
  if (typeof applyTheme === 'function') applyTheme();   // tools を開いたときの「画面の色」の選択も合わせる（v3.7）
  document.body.classList.toggle('hide-ui-labels', db.settings.showUiLabels === false);
  var cb = document.getElementById('set-show-labels');
  if (cb) cb.checked = db.settings.showUiLabels !== false;
  var pa = document.getElementById('set-pl-autoopen');   // v5.6
  if (pa) pa.checked = !!db.settings.plAutoOpen;
}
/* ---------- 画面の色（v3.7） ----------
   ui.theme：'light'（初期値。今までの見た目）・'dark'（ブラックモード）・'auto'（パソコンの設定 prefers-color-scheme に合わせる）。
   この PC の見た目の設定なので musicManager_ui に保存（バックアップには入れない）。<html data-theme="dark"> を付け外しするだけで、
   CSS の色の変数（style.css の :root[data-theme="dark"]）がすぐ切り替わる。起動時は index.html の head で先に当てる */
var _themeMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function currentThemeSetting() { return ui.theme === 'dark' || ui.theme === 'auto' ? ui.theme : 'light'; }
function applyTheme() {
  var t = currentThemeSetting();
  var dark = t === 'dark' || (t === 'auto' && !!(_themeMq && _themeMq.matches));
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('#set-theme input[name="theme"]').forEach(function (r) { r.checked = r.value === t; });
}
function setTheme(v) {
  ui.theme = v === 'dark' || v === 'auto' ? v : 'light';
  saveUi();
  applyTheme();
}
if (_themeMq) {   // 「自動」のとき、パソコンの設定が変わったらすぐ合わせる
  var _onThemeMq = function () { if (currentThemeSetting() === 'auto') applyTheme(); };
  if (_themeMq.addEventListener) _themeMq.addEventListener('change', _onThemeMq); else if (_themeMq.addListener) _themeMq.addListener(_onThemeMq);
}
function setShowUiLabels(on) {
  db.settings.showUiLabels = !!on;
  saveDB();
  applyUiLabelSetting();
}
// 全体を描き直す（復元のあとなど）
function renderAll() {
  applyUiLabelSetting();
  renderSidebarCounts();
  if (typeof renderConnectionStatus === 'function') renderConnectionStatus();
  renderCurrentPage();
  if (typeof updatePlayerUi === 'function') updatePlayerUi();
}

/* ---------- アイコン（線で描いたSVG。stroke="currentColor" で周りの文字色になる） ---------- */
function _svg(inner, size) {
  size = size || 18;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}
var ICONS = {
  logo: _svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 40),
  lyrics: _svg('<path d="M4 6h11"/><path d="M4 11h11"/><path d="M4 16h7"/><path d="M19 17V6l3-1"/><circle cx="17.5" cy="17.5" r="1.8"/>', 16),
  image: _svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>', 16),
  shuffle: _svg('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>', 16),
  user: _svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  sparkle: _svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>'),
  fire: _svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-4 3 0-3-1-5-3-7 0 4-5 7-5 13 0 4 3 7 7 7z"/>'),
  youtube: _svg('<rect x="2" y="5" width="20" height="14" rx="4"/><polygon points="10 9 15.5 12 10 15 10 9" fill="currentColor" stroke="none"/>', 16),
  collapse: _svg('<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>', 16),
  album: _svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 5a7 7 0 0 0-7 7"/>'),
  music: _svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  playlist: _svg('<line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="11" x2="15" y2="11"/><line x1="3" y1="16" x2="10" y2="16"/><path d="M18 18V8l4-1"/><circle cx="16" cy="18" r="2"/>'),
  folder: _svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  folderPlus: _svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>', 16),
  settings: _svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  versions: _svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  play: _svg('<polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/>', 16),
  pause: _svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>', 16),
  prev: _svg('<polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="5" y2="5"/>', 16),
  next: _svg('<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>', 16),
  volume: _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>', 16),
  mute: _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>', 16),
  repeat: _svg('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>', 16),
  plus: _svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 16),
  edit: _svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>', 15),
  trash: _svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>', 15),
  up: _svg('<polyline points="18 15 12 9 6 15"/>', 15),
  down: _svg('<polyline points="6 9 12 15 18 9"/>', 15),
  x: _svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 16),
  move: _svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 10 15 13 12 16"/><line x1="8" y1="13" x2="15" y2="13"/>', 16),
  undo: _svg('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>', 16),
  refresh: _svg('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>', 16),
  search: _svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 16),
  link: _svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', 16),
  download: _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', 16),
  upload: _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 16),
  grip: _svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>', 14),
  eyeOff: _svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>', 16),
  pin: _svg('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>', 16),
  // Google 検索ボタンの「G」（v3.8。4色の弧と横棒を自分で描いたもの。ロゴ画像は使わない）
  googleG: '<svg class="icon-google-g" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke-width="3.2">' +
    '<path class="g-blue" d="M20 12 A8 8 0 0 1 16 18.93 M12.6 12 H20.6"/>' +
    '<path class="g-green" d="M16 18.93 A8 8 0 0 1 5.07 16"/>' +
    '<path class="g-yellow" d="M5.07 16 A8 8 0 0 1 5.07 8"/>' +
    '<path class="g-red" d="M5.07 8 A8 8 0 0 1 17.66 6.34"/></svg>',
  // 並べ替えボタン（v4.0）：長さの違う3本の線と下向きの矢印
  sortLines: _svg('<line x1="4" y1="6" x2="13" y2="6"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/><polyline points="15 15 18 18 21 15"/><line x1="18" y1="6" x2="18" y2="18"/>', 16),
  // ソートキー（v4.3）：タグ
  tag: _svg('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>', 14),
  // フォルダの場所をコピー（v4.8）：重なった2枚の紙
  copyPath: _svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 16),
  // Western music（v5.0）：地球
  globe: _svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', 18),
  back: _svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', 16),
  eye: _svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>', 16),
  file: _svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 14)
};

// data-icon="名前" の要素に SVG を入れる（サイドバーとページヘッダーで同じ SVG を使うため）
function applyIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
    var name = el.getAttribute('data-icon');
    if (ICONS[name] && !el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', ICONS[name]);
  });
}

/* ---------- 呼び方コピー（□） ---------- */
function copyUiLabel(name, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  copyTextToClipboard(name);
  showToast('「' + name + '」をコピーしました（貼り付けて使ってください）');
}
function copyTextToClipboard(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) { console.error('copyTextToClipboard failed:', e); }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
  } catch (e) { /* 無視 */ }
}

/* ---------- お知らせ（トースト） ---------- */
// action：{ label, fn }（トーストの中のボタン。例：「元に戻す」。v3.0）。ボタン付きは長めに出す
function showToast(msg, isError, action) {
  var area = document.getElementById('toast-area');
  if (!area) { console.log(msg); return; }
  var el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '') + (action ? ' toast-has-action' : '');
  var txt = document.createElement('span');
  txt.textContent = msg;
  el.appendChild(txt);
  if (action) {
    var b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', function () { if (el.parentNode) el.parentNode.removeChild(el); action.fn(); });
    el.appendChild(b);
  }
  area.appendChild(el);
  // 同時に出すのは4つまで（古いものから消す）
  while (area.children.length > 4) area.removeChild(area.firstChild);
  var stay = action ? 8000 : (isError ? 6000 : 3200);
  setTimeout(function () { el.classList.add('toast-hide'); }, stay);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, stay + 600);
}

/* ---------- 実行中の表示 ---------- */
function showBusy(text) {
  var ov = document.getElementById('busy-overlay');
  document.getElementById('busy-text').textContent = text || '実行中…';
  ov.hidden = false;
}
function hideBusy() { document.getElementById('busy-overlay').hidden = true; }

/* ---------- ダイアログ（モーダル） ----------
   1つのモーダルを使い回す。openDialog は押したボタンの value を返す（閉じた・Esc は null）。 */
var _dialog = { resolve: null, beforeClose: null };

function ensureDialogModal() {
  var ov = document.getElementById('dialog-modal');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'dialog-modal';
  ov.className = 'modal-overlay';
  ov.hidden = true;
  ov.innerHTML =
    '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="dialog-title">' +
      '<div class="modal-header"><h2 id="dialog-title"></h2>' +
        '<button class="btn-icon modal-close" data-dialog-value="__cancel" title="閉じる">' + ICONS.x + '</button></div>' +
      '<div class="modal-body" id="dialog-body"></div>' +
      '<div class="modal-footer" id="dialog-footer"></div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-dialog-value]');
    if (b && !b.disabled) closeDialog(b.getAttribute('data-dialog-value'));
  });
  document.addEventListener('keydown', function (ev) {
    if (ov.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closeDialog('__cancel'); }
    else if (ev.key === 'Enter' && ev.target && ev.target.classList && ev.target.classList.contains('dialog-enter')) {
      ev.preventDefault();
      var d = ov.querySelector('.modal-footer [data-default]');
      if (d) d.click();
    }
  });
  return ov;
}

// opts: { title, body(HTML), size:'small'|'large', buttons:[{label, value, cls, isDefault}], onOpen(bodyEl), beforeClose(value, bodyEl) → false で閉じない }
function openDialog(opts) {
  var ov = ensureDialogModal();
  if (_dialog.resolve) { var old = _dialog.resolve; _dialog.resolve = null; old(null); }
  var box = ov.querySelector('.modal-box');
  box.className = 'modal-box ' + (opts.size === 'large' ? 'modal-large' : 'modal-small');
  document.getElementById('dialog-title').textContent = opts.title || '';
  var body = document.getElementById('dialog-body');
  body.innerHTML = opts.body || '';
  var footer = document.getElementById('dialog-footer');
  footer.innerHTML = (opts.buttons || [{ label: 'OK', value: 'ok', cls: 'btn-save', isDefault: true }]).map(function (b) {
    return '<button class="' + (b.cls || 'btn-cancel') + '" data-dialog-value="' + escapeHtml(b.value) + '"' + (b.isDefault ? ' data-default="1"' : '') + '>' + escapeHtml(b.label) + '</button>';
  }).join('');
  ov.hidden = false;
  _dialog.beforeClose = opts.beforeClose || null;
  _dialog.cancelValue = opts.cancelValue || null;   // v6.7：× と Esc もこのボタンと同じにする（beforeClose を通す）
  var p = new Promise(function (resolve) { _dialog.resolve = resolve; });
  if (opts.onOpen) opts.onOpen(body);
  var focusEl = body.querySelector('input:not([type=radio]):not([type=checkbox]), textarea') || footer.querySelector('[data-default]');
  if (focusEl) setTimeout(function () { focusEl.focus(); if (focusEl.select) try { focusEl.select(); } catch (e) {} }, 30);
  return p;
}

function closeDialog(value) {
  var ov = document.getElementById('dialog-modal');
  if (!ov || ov.hidden) return;
  var body = document.getElementById('dialog-body');
  if (value === '__cancel' && _dialog.cancelValue) value = _dialog.cancelValue;
  if (value !== '__cancel' && _dialog.beforeClose) {
    if (_dialog.beforeClose(value, body) === false) return;
  }
  ov.hidden = true;
  var r = _dialog.resolve; _dialog.resolve = null; _dialog.beforeClose = null;
  if (r) r(value === '__cancel' ? null : value);
}

// 確認ダイアログ。rows を渡すと「変更前 → 変更後」の表を出す。true / false を返す
function showConfirm(opts) {
  var html = '';
  if (opts.message) html += '<div class="dialog-message">' + opts.message + '</div>';
  if (opts.rows && opts.rows.length) html += changeTableHtml(opts.rows);
  return openDialog({
    title: opts.title || '確認',
    body: html,
    size: (opts.rows && opts.rows.length) ? 'large' : 'small',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: opts.okText || 'OK', value: 'ok', cls: opts.danger ? 'btn-danger' : 'btn-save', isDefault: true }
    ]
  }).then(function (v) { return v === 'ok'; });
}

// 変更前 → 変更後 の表
function changeTableHtml(rows) {
  var max = 300;
  var h = '<div class="change-table-wrap"><table class="change-table"><thead><tr><th>変更前</th><th></th><th>変更後</th></tr></thead><tbody>';
  rows.slice(0, max).forEach(function (r) {
    h += '<tr><td>' + escapeHtml(r.from || '（なし）') + '</td><td class="change-arrow">→</td><td>' + escapeHtml(r.to || '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (rows.length > max) h += '<p class="dialog-hint">ほか ' + (rows.length - max) + ' 件</p>';
  return h;
}

// お知らせダイアログ（OK だけ）
function showAlert(opts) {
  return openDialog({
    title: opts.title || 'お知らせ',
    body: '<div class="dialog-message">' + (opts.message || '') + '</div>',
    size: opts.size || 'small',
    buttons: [{ label: 'OK', value: 'ok', cls: 'btn-save', isDefault: true }]
  });
}

// 入力ダイアログ。入力した文字列を返す（キャンセルは null）
function showPrompt(opts) {
  var body =
    (opts.message ? '<div class="dialog-message">' + opts.message + '</div>' : '') +
    '<div class="form-group"><label>' + escapeHtml(opts.label || '') + '</label>' +
    '<div class="prompt-row"><input type="text" class="form-input dialog-enter" id="dialog-prompt-input" value="' + escapeHtml(opts.value || '') + '" autocomplete="off">' +
    (opts.suffix ? '<span class="dialog-suffix">' + escapeHtml(opts.suffix) + '</span>' : '') +
    '</div></div>' +
    (opts.hint ? '<p class="dialog-hint">' + opts.hint + '</p>' : '') +
    '<div class="dialog-error" id="dialog-prompt-error"></div>';
  var result = null;
  return openDialog({
    title: opts.title || '入力',
    body: body,
    size: 'small',
    buttons: [
      { label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' },
      { label: opts.okText || 'OK', value: 'ok', cls: 'btn-save', isDefault: true }
    ],
    beforeClose: function (value, bodyEl) {
      if (value !== 'ok') return true;
      var v = bodyEl.querySelector('#dialog-prompt-input').value;
      var err = opts.validate ? opts.validate(v) : '';
      if (err) { bodyEl.querySelector('#dialog-prompt-error').textContent = err; return false; }
      result = v;
      return true;
    }
  }).then(function (v) { return v === 'ok' ? result : null; });
}

/* ---------- 小さな便利関数 ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nowIso() { return new Date().toISOString(); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatDateTime(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function formatDuration(sec) {
  if (!sec || !isFinite(sec) || sec <= 0) return '--:--';
  sec = Math.round(sec);
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
}
function formatTotalDuration(sec) {
  sec = Math.round(sec || 0);
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? h + '時間' + m + '分' : m + '分';
}
function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// パス（音楽フォルダからの相対パス、区切りは「/」）
function splitPath(p) {
  var i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}
function joinPath(dir, name) { return dir ? dir + '/' + name : name; }
function extOf(name) {
  var i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
function stripExt(name) {
  var i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
function folderLabel(dir) { return dir || '（音楽フォルダ直下）'; }
function isInTrash(path) { return path === TRASH_FOLDER_NAME || path.indexOf(TRASH_FOLDER_NAME + '/') === 0; }

// 日本語向けの並べ替え（数字は数の大きさで比べる：2 < 10）
var JA_COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

// ファイル名・フォルダ名として使えるか（Windows の決まりに合わせる）。問題があればメッセージを返す
function validateFileName(name) {
  if (!name || !name.trim()) return '名前を入力してください。';
  if (/[\\/:*?"<>|]/.test(name)) return '次の文字は使えません： \\ / : * ? " < > |';
  if (/[\u0000-\u001f]/.test(name)) return '使えない文字が含まれています。';
  if (/[. ]$/.test(name)) return '名前の最後に「.」や空白は使えません。';
  if (/^\s/.test(name)) return '名前の先頭に空白は使えません。';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return 'Windows で予約されている名前のため使えません。';
  if (name.length > 200) return '名前が長すぎます（200文字まで）。';
  return '';
}

/* ---------- 下までスクロールしたら続きを読み込む（v2.4） ----------
   一覧の最後に置いた目印（loadMoreHtml）が画面の下から 800px 以内に入ったら fn を呼ぶ。
   fn の中で続きを足したら、また watchLoadMore で目印を見張る（まだ画面内なら続けて読み込む）。
   key ごとに1つだけ見張る（描き直したら前の見張りは外す） */
var _loadMoreObservers = {};
function watchLoadMore(key, el, fn) {
  if (_loadMoreObservers[key]) { _loadMoreObservers[key].disconnect(); delete _loadMoreObservers[key]; }
  if (!el || !('IntersectionObserver' in window)) return;   // 使えないブラウザでは予備のボタンで読み込む
  var io = new IntersectionObserver(function (entries) {
    if (!entries.some(function (e) { return e.isIntersecting; })) return;
    io.disconnect();
    delete _loadMoreObservers[key];
    fn();
  }, { rootMargin: '0px 0px 800px 0px' });
  _loadMoreObservers[key] = io;
  io.observe(el);
}
// 一覧に戻ったとき、開いていたカードの位置に戻して少しだけ強調する（v2.4）
//   savedY：開く前のスクロール位置。そこに戻してもカードが画面外なら、カードが真ん中に来るようにする
function restoreListPosition(cardEl, savedY) {
  window.scrollTo(0, savedY || 0);
  if (!cardEl) return;
  var r = cardEl.getBoundingClientRect();
  var bottomLimit = window.innerHeight - (parseFloat(getComputedStyle(document.body).getPropertyValue('--lyr-bottom')) || 0);
  if (r.top < 0 || r.bottom > bottomLimit) cardEl.scrollIntoView({ block: 'center' });
  cardEl.classList.remove('card-flash');
  void cardEl.offsetWidth;   // 同じカードで続けて強調するとき、アニメーションを最初から
  cardEl.classList.add('card-flash');
  setTimeout(function () { cardEl.classList.remove('card-flash'); }, 1600);
}
// 一覧の最後の目印（読み込み中の表示と、念のための予備ボタン）
function loadMoreHtml(id, rest, unit) {
  return '<div class="load-more" id="' + id + '"><span class="load-more-text">下へスクロールすると続きを表示します（残り ' + rest + ' ' + unit + '）</span>' +
    '<button class="btn-inline-small load-more-btn" data-act="more">続きを表示</button></div>';
}

function debounce(fn, ms) {
  var t = null;
  return function () {
    var args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(self, args); }, ms);
  };
}

/* =========================================================
   46-seasons.js ― 「Seasons Song」画面（季節の曲。v7.4）
   ・曲名と歌詞の中の季節の言葉で、曲を Spring／Summer／Fall／Winter に分ける（音楽ファイルには書き込まない）
   ・判定：曲名に出た言葉は 3点、歌詞に出た言葉は 1点（同じ言葉は歌詞で3回まで）。いちばん点の高い季節にする。
     3点に届かない・いちばんが2つ以上あるときは、どの季節にも入れない
     判定に使う言葉（db.seasonWords。null＝初期の一覧）：ふつうの言葉／「~」で始まる弱い言葉（曲名に出たとき、
     または同じ季節のふつうの言葉が歌詞に出ているときだけ数える。例 ~fall ~海）／「-」で始まる除く言葉（先に文から取り除く。例 -青春 -fall in love）。
     英字の言葉は単語として（前後が英字でない所だけ）、日本語は文字の並びで探す。全角半角・大文字小文字は区別しない
   ・歌詞は、入力した歌詞（db.lyrics）→ 同じフォルダの 曲名.lrc／曲名.txt → 曲ファイルに埋め込まれた歌詞（歌詞パネルと同じ順）。
     全曲の歌詞を読むのは重いので、「歌詞を調べる」で裏で少しずつ読み（フォルダごとに1回だけ中を見る・同時に3つまで）、
     季節ごとの点数だけを控え（IndexedDB musicManager_seasons。曲の大きさ・更新日時・言葉の一覧の目印付き）に残す。歌詞の本文は残さない
   ・手で決める：曲の行の「季節」の選択（自動／Spring／Summer／Fall／Winter／外す）。db.seasonOverride { 曲の相対パス: 'spring'…|'none' }、
     自動の判定より優先。バックアップに含む。ファイル整理で動かしたら付け替える（09-file-ops.js の applyPathMapping から）
   ========================================================= */

var SEASONS = [
  { id: 'spring', name: 'Spring', ja: '春', color: '#e2729b' },
  { id: 'summer', name: 'Summer', ja: '夏', color: '#e0a21b' },
  { id: 'fall', name: 'Fall', ja: '秋', color: '#c4622d' },
  { id: 'winter', name: 'Winter', ja: '冬', color: '#4f8fd0' }
];
var SEASON_WORDS_DEFAULT = {
  spring: ['春', '桜', 'さくら', 'サクラ', '卒業', '花見', '入学', '新学期', '菜の花', '花吹雪', '春風', '-青春', '-思春期', '-春日', 'spring', 'cherry blossom', 'sakura', '~april'],
  summer: ['夏', '花火', '蝉', 'セミ', '夏祭り', '向日葵', 'ひまわり', '浴衣', '夏休み', '入道雲', '線香花火', '~海', '~ビーチ', '~太陽', 'summer', 'beach', '~sunshine', '~july', '~august'],
  fall: ['秋', '紅葉', '月見', '落ち葉', '枯葉', '秋桜', 'コスモス', '鈴虫', '十五夜', '-秋葉原', '-秋元', '-秋田', 'autumn', 'fall leaves', 'falling leaves', '~fall', '~leaves', '~september', '~october', '~november', '-fall in love', '-fall apart', '-fall down', '-fall for'],
  winter: ['冬', '雪', '粉雪', 'クリスマス', '聖夜', '白い息', 'サンタ', '雪だるま', '雪の華', '大晦日', '-雪辱', 'winter', 'snow', 'christmas', 'xmas', 'santa', 'snowflake', '~december', '~cold']
};
var SEA_PAGE = 200, SEA_CONCURRENCY = 3;
var sea = { lyr: {}, loaded: false, scanning: false, stop: false, done: 0, total: 0, rev: 0, cache: null, view: [], limit: SEA_PAGE };

ICONS.seasons = _svg('<path d="M12 3c2 3 2 6 0 9-2-3-2-6 0-9z"/><path d="M12 12c3-1 6 0 8 2-3 1-6 0-8-2z"/><path d="M12 12c-3-1-6 0-8 2 3 1 6 0 8-2z"/><path d="M12 12v9"/>');
var SEASON_ICONS = {
  spring: _svg('<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c-1.6-3.4 1.6-5.6 0-7.3M14.1 11.3c3-2.3 5.6.5 7.3-1M13.3 14c2.4 3 .1 5.9 1.4 7.6M10.7 14c-2.4 3-.1 5.9-1.4 7.6M9.9 11.3c-3-2.3-5.6.5-7.3-1"/>', 16),
  summer: _svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 16),
  fall: _svg('<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19l9-9"/>', 16),
  winter: _svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>', 16)
};

/* ---------- 言葉 ---------- */
function seasonWords() { return db.seasonWords && typeof db.seasonWords === 'object' ? db.seasonWords : SEASON_WORDS_DEFAULT; }
function _seaNorm(s) { return String(s || '').normalize('NFKC').toLowerCase(); }
function _seaEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 言葉の一覧から、比べるための形を作る（言葉が変わったときだけ）
var _seaCompiled = { src: null, rev: '', ex: [], seasons: {} };
function _seaCompile() {
  var w = seasonWords();
  var src = JSON.stringify(w);
  if (_seaCompiled.src === src) return _seaCompiled;
  var ex = [], seasons = {};
  SEASONS.forEach(function (s) {
    seasons[s.id] = [];
    (w[s.id] || []).forEach(function (raw) {
      var v = String(raw || '').trim(); if (!v) return;
      var kind = v[0] === '-' ? 'ex' : v[0] === '~' ? 'weak' : 'strong';
      var word = _seaNorm(kind === 'strong' ? v : v.slice(1)).trim(); if (!word) return;
      var re = /^[a-z0-9 '\-]+$/.test(word) ? new RegExp('(^|[^a-z])' + _seaEsc(word).replace(/ /g, '\\s+') + '(?=$|[^a-z])', 'g') : new RegExp(_seaEsc(word), 'g');
      if (kind === 'ex') ex.push(re); else seasons[s.id].push({ word: word, weak: kind === 'weak', re: re });
    });
  });
  var h = 0; for (var i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  _seaCompiled = { src: src, rev: String(h), ex: ex, seasons: seasons };
  return _seaCompiled;
}
// 文の中の季節ごとの出た言葉：{ spring: { strong: n, weak: n, words: [] }, … }（同じ言葉は3回まで）
function _seaHits(text) {
  var c = _seaCompile(), t = _seaNorm(text), out = {};
  c.ex.forEach(function (re) { re.lastIndex = 0; t = t.replace(re, ' '); });
  SEASONS.forEach(function (s) {
    var o = { strong: 0, weak: 0, words: [] };
    c.seasons[s.id].forEach(function (w) {
      w.re.lastIndex = 0; var m = t.match(w.re), n = m ? Math.min(3, m.length) : 0;
      if (!n) return;
      if (w.weak) o.weak += n; else o.strong += n;
      o.words.push(w.word);
    });
    out[s.id] = o;
  });
  return out;
}
// 歌詞の点数（弱い言葉は、同じ季節のふつうの言葉があるときだけ）：[spring, summer, fall, winter]
function _seaLyricScore(text) {
  var h = _seaHits(text);
  return SEASONS.map(function (s) { var o = h[s.id]; return o.strong + (o.strong ? o.weak : 0); });
}

/* ---------- 判定 ---------- */
// { id: 季節 or ''、src: 'manual'|'auto'、score:[…]、why }
function seasonOf(t) {
  var ov = (db.seasonOverride || {})[t.path];
  if (ov) return { id: ov === 'none' ? '' : ov, src: 'manual', why: '手で決めた季節' };
  return _seaAuto(t);
}
var _seaTitleMemo = new Map();   // 曲名の判定の控え（曲名と言葉が同じなら使い回す）
function _seaTitleHits(t) {
  var rev = _seaCompile().rev, m = _seaTitleMemo.get(t.path);
  if (m && m.title === t.title && m.rev === rev) return m.hits;
  var hits = _seaHits(t.title || '');
  _seaTitleMemo.set(t.path, { title: t.title, rev: rev, hits: hits });
  return hits;
}
function _seaAuto(t) {
  var title = _seaTitleHits(t);
  var sc = SEASONS.map(function (s) { var o = title[s.id]; return (o.strong + o.weak) * 3; });   // 曲名は弱い言葉も数える
  var ly = _seaLyricsScoreOf(t);
  if (ly) for (var i = 0; i < 4; i++) sc[i] += ly[i];
  var best = -1, bi = -1, second = -1;
  sc.forEach(function (v, i) { if (v > best) { second = best; best = v; bi = i; } else if (v > second) second = v; });
  if (best < 3 || best === second) return { id: '', src: 'auto', score: sc, why: best > 0 ? '点が足りない・同点' : '季節の言葉なし' };
  var words = title[SEASONS[bi].id].words;
  return { id: SEASONS[bi].id, src: 'auto', score: sc, why: (words.length ? '曲名「' + words.join('・') + '」' : '') + (ly && ly[bi] ? (words.length ? '＋' : '') + '歌詞 ' + ly[bi] + '点' : '') };
}
function _seaLyricsScoreOf(t) {
  var u = db.lyrics && db.lyrics[t.path];
  if (u && u.text) return _seaLyricScore(u.text);   // 入力した歌詞（いつも今の言葉で）
  var r = sea.lyr[t.path], c = _seaCompile();
  if (!r) return null;   // 言葉を変えたあと調べ直すまでは、前の言葉での点数を使う（調べ直しは裏で始まる）
  return [r[3], r[4], r[5], r[6]];
}
// 全曲を季節に分ける（控え。曲情報・言葉・手の指定・歌詞の点数が変わったら作り直す）
function seasonGroups() {
  var hid = typeof hiddenTrackPaths === 'function' ? hiddenTrackPaths() : new Set();   // 非表示のアルバムの曲は除く（v7.9）
  var key = (library.metaRev || 0) + '|' + library.tracks.length + '|' + _seaCompile().rev + '|' + sea.rev + '|' + JSON.stringify(db.seasonOverride || {}).length + '|' + Object.keys(db.lyrics || {}).length + '|' + hid.size + ':' + (typeof hiddenAlbumsSig === 'function' ? hiddenAlbumsSig().length : 0);
  if (sea.cache && sea.cache.key === key) return sea.cache;
  var g = { key: key, spring: [], summer: [], fall: [], winter: [], info: new Map() };
  library.tracks.forEach(function (t) { if (hid.has(t.path)) return; var r = seasonOf(t); g.info.set(t.path, r); if (r.id) g[r.id].push(t); });
  SEASONS.forEach(function (s) { g[s.id].sort(function (a, b) { return compareAlbumText(albumTextKey(a.title), albumTextKey(b.title)); }); });
  sea.cache = g;
  return g;
}
function seasonCount() {
  if (!library.tracks.length) return 0;
  var g = seasonGroups(); return g.spring.length + g.summer.length + g.fall.length + g.winter.length;
}
function setSeasonOverride(path, v) {
  if (!db.seasonOverride || typeof db.seasonOverride !== 'object') db.seasonOverride = {};
  if (!v) delete db.seasonOverride[path]; else db.seasonOverride[path] = v;
  saveDB(); sea.cache = null; sea.rev++;
}
// ファイル整理で動かしたとき（09-file-ops.js の applyPathMapping から）
function seasonApplyPathMapping(map) {
  var ov = db.seasonOverride || {}, ch = false;
  Object.keys(map).forEach(function (f) {
    if (ov[f]) { ov[map[f]] = ov[f]; delete ov[f]; ch = true; }
    if (sea.lyr[f]) { sea.lyr[map[f]] = sea.lyr[f]; delete sea.lyr[f]; }
  });
  sea.cache = null; sea.rev++;
  if (sea.loaded) _seaSaveSoon();
}

/* ---------- 歌詞の点数の控え（IndexedDB） ---------- */
var _seaDbP = null;
function _seaDb() {
  if (_seaDbP) return _seaDbP;
  _seaDbP = new Promise(function (res, rej) {
    var q = indexedDB.open('musicManager_seasons', 1);
    q.onupgradeneeded = function () { q.result.createObjectStore('lyr'); };
    q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
  });
  return _seaDbP;
}
// 音楽フォルダを変えたら、控えを読み直す
function _seaCheckFolder() { if (sea.loaded && sea.folder !== fsa.folderName) { sea.loaded = false; sea.lyr = {}; sea.cache = null; _seaTitleMemo.clear(); } }
async function seasonLoadCache() {
  _seaCheckFolder();
  if (sea.loaded) return;
  try {
    var d = await _seaDb();
    var rec = await new Promise(function (res, rej) { var r = d.transaction('lyr').objectStore('lyr').get('current'); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
    if (rec && rec.folder === fsa.folderName && rec.data) sea.lyr = rec.data;
  } catch (e) { console.warn('季節の控えを読めませんでした', e); }
  sea.loaded = true; sea.folder = fsa.folderName; sea.rev++; sea.cache = null;
}
var _seaSaveT = 0;
function _seaSaveSoon() { clearTimeout(_seaSaveT); _seaSaveT = setTimeout(_seaSave, 1500); }
async function _seaSave() {
  try { var d = await _seaDb(); d.transaction('lyr', 'readwrite').objectStore('lyr').put({ folder: fsa.folderName, at: Date.now(), data: sea.lyr }, 'current'); }
  catch (e) { console.warn('季節の控えを保存できませんでした', e); }
}
// まだ調べていない曲（大きさ・更新日時・言葉が控えと違う曲も）
function _seaNeed() {
  var rev = _seaCompile().rev;
  return library.tracks.filter(function (t) {
    if (db.lyrics && db.lyrics[t.path] && db.lyrics[t.path].text) return false;
    var r = sea.lyr[t.path], c = tagCache[t.path];
    return !r || r[2] !== rev || (c && c.s && r[0] && (r[0] !== c.s || r[1] !== c.m));   // 曲ファイルが変わった
  });
}

/* ---------- 歌詞を調べる（裏で少しずつ） ---------- */
async function seasonScanLyrics() {
  if (sea.scanning || !library.scanned || !isConnected()) return;
  await seasonLoadCache();
  var need = _seaNeed();
  // 非表示のアルバムの曲は後回し（v7.9。戻したときにすぐ出るよう、最後には調べる）
  var hidP = typeof hiddenTrackPaths === 'function' ? hiddenTrackPaths() : new Set();
  if (hidP.size) need = need.filter(function (t) { return !hidP.has(t.path); }).concat(need.filter(function (t) { return hidP.has(t.path); }));
  if (!need.length) { _seaProgressUi(); return; }
  sea.scanning = true; sea.stop = false; sea.done = 0; sea.total = need.length;
  var rev = _seaCompile().rev, byFolder = new Map();
  need.forEach(function (t) { if (!byFolder.has(t.folder)) byFolder.set(t.folder, []); byFolder.get(t.folder).push(t); });
  var folders = Array.from(byFolder.keys()), fi = 0, lastUi = 0, lastCount = Date.now();
  _seaProgressUi();
  async function worker() {
    while (fi < folders.length && !sea.stop) {
      var folder = folders[fi++], list = byFolder.get(folder), names = {};
      try { var dir = await getDirHandleByPath(folder, false); for await (var h of dir.values()) if (h.kind === 'file' && /\.(lrc|txt)$/i.test(h.name)) names[h.name.toLowerCase()] = h; } catch (e) { /* フォルダが無い */ }
      for (var k = 0; k < list.length && !sea.stop; k++) {
        var t = list[k], text = '';
        try {
          var base = stripExt(t.name).toLowerCase(), hf = names[base + '.lrc'] || names[base + '.txt'];
          if (hf) text = decodeTextBytes(new Uint8Array(await (await hf.getFile()).arrayBuffer())).replace(/\[[^\]]*\]/g, ' ');
          else if (/^(mp3|m4a|m4b|mp4|aac|flac|ogg|opus)$/.test(t.ext)) { var emb = await readTrackLyrics(await t.handle.getFile()); text = emb && emb.text ? emb.text : ''; }
        } catch (e) { text = ''; }
        var sc = text ? _seaLyricScore(text) : [0, 0, 0, 0], c = tagCache[t.path] || {}, fs = c.s, fm = c.m;
        if (!fs) { try { var ff = await t.handle.getFile(); fs = ff.size; fm = ff.lastModified; } catch (e) { fs = 0; fm = 0; } }   // 曲情報の控えがまだ無い曲
        sea.lyr[t.path] = [fs || 0, fm || 0, rev, sc[0], sc[1], sc[2], sc[3]];
        sea.done++;
        if (Date.now() - lastUi > 400) { lastUi = Date.now(); _seaProgressUi(); }   // 進み具合（軽い）
        if (Date.now() - lastCount > 3000) { lastCount = Date.now(); sea.rev++; sea.cache = null; if (currentPage === 'seasons') _seaTabsUi(); renderSidebarCounts(); }   // 件数は3秒ごと（全曲を分け直すため）
        if (sea.done % 300 === 0) _seaSaveSoon();
      }
    }
  }
  var ws = []; for (var i = 0; i < SEA_CONCURRENCY; i++) ws.push(worker());
  await Promise.all(ws);
  sea.scanning = false; sea.rev++; sea.cache = null;
  await _seaSave();
  _seaProgressUi();
  renderSidebarCounts();
  if (currentPage === 'seasons') renderSeasonsPage();
}
function _seaProgressUi() {
  var el = document.getElementById('sea-progress');
  if (!el) return;
  var need = sea.scanning ? sea.total - sea.done : (sea.loaded && library.scanned ? _seaNeed().length : 0);
  if (sea.scanning) {
    el.innerHTML = '<span class="sea-prog-text">歌詞を調べています… ' + sea.done + ' / ' + sea.total + '曲（' + Math.floor(sea.done / Math.max(1, sea.total) * 100) + '%）</span>' +
      '<span class="sea-bar"><span class="sea-bar-fill" style="width:' + (sea.done / Math.max(1, sea.total) * 100).toFixed(1) + '%"></span></span>' +
      '<button class="btn-inline-small" id="sea-stop">止める</button>';
  } else {
    el.innerHTML = '<span class="sea-prog-text">' + (need ? '歌詞をまだ調べていない曲：' + need + '曲（今は曲名だけで判定しています）' : '全曲の歌詞を調べました。') + '</span>' +
      (need ? '<button class="btn-inline-small" id="sea-start">歌詞を調べる</button>' : '');
  }
}

/* ---------- 画面 ---------- */
function _seaTab() { return SEASONS.some(function (s) { return s.id === ui.seasonTab; }) ? ui.seasonTab : 'spring'; }
function _seaTabsUi() {
  var g = seasonGroups(), cur = _seaTab();
  document.getElementById('sea-tabs').innerHTML = SEASONS.map(function (s) {
    return '<button class="sea-tab' + (s.id === cur ? ' active' : '') + '" data-sea-tab="' + s.id + '" style="--sea-c:' + s.color + '" aria-pressed="' + (s.id === cur) + '">' + SEASON_ICONS[s.id] + '<span>' + s.name + '</span><span class="sea-tab-n">' + g[s.id].length + '</span></button>';
  }).join('');
}
function renderSeasonsPage() {
  var body = document.getElementById('sea-body'), count = document.getElementById('sea-count');
  if (!body) return;
  if (!isConnected() || !library.scanned) { body.innerHTML = isConnected() ? '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>' : welcomeCardHtml(); count.textContent = ''; return; }
  _seaCheckFolder();
  if (!sea.loaded) { seasonLoadCache().then(function () { if (currentPage === 'seasons') renderSeasonsPage(); seasonScanLyrics(); }); }
  var g = seasonGroups(), cur = _seaTab(), s = SEASONS.filter(function (x) { return x.id === cur; })[0];
  count.textContent = (g.spring.length + g.summer.length + g.fall.length + g.winter.length) + '曲';
  _seaTabsUi();
  _seaProgressUi();
  var q = (document.getElementById('sea-search').value || '').trim().toLowerCase();
  sea.view = q ? g[cur].filter(function (t) { return t.search.indexOf(q) >= 0; }) : g[cur];
  if (!sea.view.length) { body.innerHTML = '<div class="empty-msg">' + (q ? '検索に当てはまる曲がありません。' : s.name + '（' + s.ja + '）の曲はまだありません。曲名・歌詞に季節の言葉がある曲がここに出ます（tools の「Seasons Song の設定」で言葉を足せます）。') + '</div>'; return; }
  var shown = sea.view.slice(0, sea.limit);
  body.innerHTML = '<div class="sea-head" style="--sea-c:' + s.color + '">' + SEASON_ICONS[cur] + '<span class="sea-head-name">' + s.name + '</span><span class="sea-head-n">' + sea.view.length + '曲</span>' +
      '<button class="btn-save sea-play-all" data-sea-act="play-all">' + ICONS.play + '連続再生</button>' + shuffleBtnHtml('data-sea-act="shuffle"', 'この季節の曲をばらばらの順で再生') + '</div>' +
    songTableHtml(shown, { extra: { head: '季節', cell: function (t) { return _seaCellHtml(t, g.info.get(t.path)); } } }) +
    (sea.view.length > shown.length ? loadMoreHtml('sea-more', sea.view.length - shown.length, '曲') : '');
  artObserve(body);
  watchLoadMore('sea', document.getElementById('sea-more'), function () { sea.limit += SEA_PAGE; var y = window.scrollY; renderSeasonsPage(); window.scrollTo(0, y); });
}
// 行の「季節」の選択（自動／各季節／外す）
function _seaCellHtml(t, r) {
  var ov = (db.seasonOverride || {})[t.path] || '', auto = _seaAuto(t), an = auto.id ? SEASONS.filter(function (s) { return s.id === auto.id; })[0].name : 'なし';
  return '<select class="sea-select" data-sea-path="' + escapeHtml(t.path) + '" title="' + escapeHtml(r.src === 'manual' ? '手で決めた季節（自動：' + an + '）' : '自動：' + (auto.why || '')) + '" aria-label="季節を選ぶ">' +
    '<option value=""' + (!ov ? ' selected' : '') + '>自動（' + an + '）</option>' +
    SEASONS.map(function (s) { return '<option value="' + s.id + '"' + (ov === s.id ? ' selected' : '') + '>' + s.name + '</option>'; }).join('') +
    '<option value="none"' + (ov === 'none' ? ' selected' : '') + '>外す</option></select>';
}
function initSeasonsPage() {
  var tabs = document.getElementById('sea-tabs'), body = document.getElementById('sea-body');
  if (!tabs) return;
  tabs.addEventListener('click', function (ev) { var b = ev.target.closest('[data-sea-tab]'); if (!b) return; ui.seasonTab = b.getAttribute('data-sea-tab'); saveUi(); sea.limit = SEA_PAGE; renderSeasonsPage(); window.scrollTo(0, 0); });
  document.getElementById('sea-search').addEventListener('input', debounce(function () { sea.limit = SEA_PAGE; renderSeasonsPage(); }, 180));
  document.getElementById('sea-progress').addEventListener('click', function (ev) {
    if (ev.target.closest('#sea-stop')) { sea.stop = true; return; }
    if (ev.target.closest('#sea-start')) seasonScanLyrics();
  });
  bindSongTable(body, function () { return sea.view; }, function () { var s = SEASONS.filter(function (x) { return x.id === _seaTab(); })[0]; return 'Seasons Song ' + s.name; });
  body.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="more"]')) { sea.limit += SEA_PAGE; renderSeasonsPage(); return; }
    if (ev.target.closest('[data-sea-act="shuffle"]') && sea.view.length) { var s2 = SEASONS.filter(function (x) { return x.id === _seaTab(); })[0]; shufflePlay(function () { playQueue(sea.view.map(function (t) { return t.path; }), 0, 'Seasons Song ' + s2.name); }); return; }   // v7.5
    if (ev.target.closest('[data-sea-act="play-all"]') && sea.view.length) { var s = SEASONS.filter(function (x) { return x.id === _seaTab(); })[0]; playQueue(sea.view.map(function (t) { return t.path; }), 0, 'Seasons Song ' + s.name); }
  });
  body.addEventListener('change', function (ev) {
    var sel = ev.target.closest('[data-sea-path]'); if (!sel) return;
    var path = sel.getAttribute('data-sea-path'), t = library.byPath[path];
    setSeasonOverride(path, sel.value);
    var y = window.scrollY; renderSeasonsPage(); window.scrollTo(0, y); renderSidebarCounts();
    showToast('「' + (t ? t.title : path) + '」の季節を' + (sel.value === '' ? '自動にしました' : sel.value === 'none' ? 'どの季節にも入れないようにしました' : '「' + SEASONS.filter(function (s) { return s.id === sel.value; })[0].name + '」にしました') + '。');
  });
}
PAGE_RENDERERS.seasons = renderSeasonsPage;

/* ---------- tools の「Seasons Song の設定」 ---------- */
// 言葉を変えたら、少し待って歌詞を調べ直す（続けて変えたときは最後の1回だけ。調べ中なら止めてからやり直す）
var _seaRescanT = 0;
function _seaRescanSoon() {
  clearTimeout(_seaRescanT);
  _seaRescanT = setTimeout(async function () {
    if (sea.scanning) { sea.stop = true; for (var i = 0; i < 100 && sea.scanning; i++) await new Promise(function (r) { setTimeout(r, 100); }); }
    if (library.scanned && library.tracks.length) seasonScanLyrics();
  }, 4000);
}
function renderSetSeasons() {
  var el = document.getElementById('set-seasons');
  if (!el) return;
  var w = seasonWords(), ov = db.seasonOverride || {}, nOv = Object.keys(ov).length;
  var h = '<p class="panel-desc">曲名に出た言葉は 3点、歌詞に出た言葉は 1点で数え、いちばん点の高い季節に分けます（3点に届かない・同点のときは分けません）。' +
    '「~」で始まる言葉は弱い言葉（曲名に出たとき、または同じ季節のふつうの言葉が歌詞にあるときだけ数える）、「-」で始まる言葉は除く言葉（先に取り除く。例：-青春、-fall in love）。英字は単語として探します。全角半角・大文字小文字は区別しません。</p>';
  SEASONS.forEach(function (s) {
    h += '<h3 class="wes-set-title"><span class="sea-set-icon" style="color:' + s.color + '">' + SEASON_ICONS[s.id] + '</span>' + s.name + '（' + s.ja + '）</h3>' +
      '<div class="wes-genre-chips">' + (w[s.id] || []).map(function (x, i) { return '<span class="wes-chip' + (x[0] === '-' ? ' sea-chip-ex' : x[0] === '~' ? ' sea-chip-weak' : '') + '">' + escapeHtml(x) + '<button class="wes-chip-x" data-sw-del="' + s.id + ':' + i + '" title="「' + escapeHtml(x) + '」を外す" aria-label="「' + escapeHtml(x) + '」を外す">×</button></span>'; }).join('') + '</div>' +
      '<div class="btn-row tag-set-add"><input type="text" class="form-input" data-sw-new="' + s.id + '" maxlength="40" placeholder="例：' + escapeHtml(s.id === 'spring' ? '桜色、~april、-青春' : s.id === 'summer' ? '夏空、~海' : s.id === 'fall' ? '秋風、~fall' : '雪景色、~cold') + '" aria-label="' + s.name + 'の言葉を足す">' +
      '<button class="btn-inline-small" data-sw-add="' + s.id + '">' + ICONS.plus + '追加</button></div>';
  });
  h += '<div class="btn-row"><button class="btn-inline-small" id="sw-reset">言葉を初期に戻す</button>' +
    (nOv ? '<button class="btn-inline-small" id="sw-ov-clear">手で決めた季節をすべて解除（' + nOv + '曲）</button>' : '') + '</div>' +
    '<p class="panel-meta">手で決めた季節：' + nOv + '曲。言葉を変えると、曲名の判定はすぐ変わり、歌詞は裏で調べ直します（進み具合は Seasons Song の画面に出ます）。</p>';
  el.innerHTML = h;
  var save = function (nw, msg) { db.seasonWords = nw; saveDB(); sea.cache = null; renderSetSeasons(); renderSidebarCounts(); if (msg) showToast(msg); _seaRescanSoon(); };
  var copy = function () { var o = {}; SEASONS.forEach(function (s) { o[s.id] = (w[s.id] || []).slice(); }); return o; };
  el.querySelectorAll('[data-sw-del]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-sw-del').split(':'), o = copy(); o[p[0]].splice(+p[1], 1); save(o); }); });
  var add = function (sid) {
    var inp = el.querySelector('[data-sw-new="' + sid + '"]'), v = inp.value.trim().slice(0, 40);
    if (!v) return;
    var o = copy(); if (o[sid].some(function (x) { return _seaNorm(x) === _seaNorm(v); })) { showToast('「' + v + '」は、もうあります。', true); return; }
    o[sid].push(v); save(o);
    var ni = document.querySelector('[data-sw-new="' + sid + '"]'); if (ni) ni.focus();
  };
  el.querySelectorAll('[data-sw-add]').forEach(function (b) { b.addEventListener('click', function () { add(b.getAttribute('data-sw-add')); }); });
  el.querySelectorAll('[data-sw-new]').forEach(function (inp) { inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(inp.getAttribute('data-sw-new')); } }); });
  el.querySelector('#sw-reset').addEventListener('click', function () { db.seasonWords = null; saveDB(); sea.cache = null; renderSetSeasons(); renderSidebarCounts(); showToast('季節の言葉を初期に戻しました。'); _seaRescanSoon(); });
  var oc = el.querySelector('#sw-ov-clear');
  if (oc) oc.addEventListener('click', async function () {
    if (!(await showConfirm({ title: '手で決めた季節をすべて解除', message: nOv + '曲の手で決めた季節を解除して、自動の判定に戻します。', okText: '解除する', danger: true }))) return;
    db.seasonOverride = {}; saveDB(); sea.cache = null; sea.rev++; renderSetSeasons(); renderSidebarCounts();
  });
}

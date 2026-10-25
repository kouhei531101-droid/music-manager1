/* =========================================================
   85-anime-songs.js ― 「Anime Songs」画面（スマホ版 v8.19.0。Western music〔36-western.js〕と同じ作り）
   ・アニメの曲のアルバムを並べる画面。メニューにアイコンと件数、ヘッダー（件数）、フィルターバー（検索・並べ替え〔album と共通〕・連続再生・シャッフル再生）、
     アルバムの一覧（カード）。カードを押すと album の曲一覧へ、「Anime Songs に戻る」で元の位置に戻る
   ・判定（ソートキーは使わない）：アルバムの曲のどれか1曲のジャンルのタグ、またはアプリのアルバムのタグ（31-album-tags.js）の名前に、
     判定に使う言葉（db.animeWords。null＝初期 ANIME_WORDS_DEFAULT）が入っていれば Anime Songs に入れる。
     比べるときは全角半角・大文字小文字・空白・「-」「_」「・」「.」を区別しない（_aniKey）
   ・アルバムごとの指定（db.animeOverride＝{ アルバムの目印: true（入れる）／false（外す） }。無ければ自動）：アルバム情報の編集の「Anime Songs の指定」
   ・曲ごとの指定（スマホ版 v8.20.0。db.animeSongOverride＝{ 曲の相対パス: 'in'（入れる）／'out'（外す） }。PC版と同じ）：
     曲情報の編集の「Anime Songs の指定（自動／入れる／外す）」（選ぶとすぐ保存）、曲の長押しのメニューの「Anime Songs に入れる／外す／自動に戻す」（選んだ曲はまとめて）。
     判定の順番：曲の指定 → アルバムの指定 → 自動（ジャンル・タグ）。曲を「入れる」にしたアルバムは Anime Songs のアルバム一覧に出す。
     「外す」にした曲は、自動の判定（ジャンル）にも連続再生にも使わない
   ・非表示のアルバムは出さない
   ・設定（animeWords・animeOverride）はバックアップ・復元に含む（PC版と同じ名前）。古いデータに無ければ初期の言葉・指定なし
   ・tools の「Anime Songs の設定」：判定に使う言葉の一覧（追加・× で外す・初期に戻す）、アルバムの指定の件数と解除
   ・スマホ版 v8.25.0：フィルターバーに「表示の切り替え」（#ani-mode。「作品」〔初期〕／「アルバム」。ui.animeMode）を足した。
     作品の一覧・作品の画面・作品名・作品の画像は 93-anime-works.js（PC版 v8.7.77 の 84-anime-works.js と同じ作り・同じデータ）
   ========================================================= */

var ANIME_WORDS_DEFAULT = ['Anime', 'アニメ', 'アニソン', 'Anisong', 'アニメソング', 'Animation', 'アニメーション'];
var ANI_PAGE_SIZE = 200;
var animeView = { query: '', limit: ANI_PAGE_SIZE, list: [] };
ICONS.anime = _svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/><path d="M10 11.5v5l4.5-2.5z" fill="currentColor"/>');
if (typeof PAGES !== 'undefined') PAGES.anime = 'Anime Songs';
if (typeof BNAV_SHORT !== 'undefined') BNAV_SHORT.anime = 'Anime';

/* ---------- 判定 ---------- */
function animeWords() { return Array.isArray(db.animeWords) ? db.animeWords : ANIME_WORDS_DEFAULT; }
function _aniKey(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\-_.・･]+/g, ''); }
var _aniWordKeys = { src: null, keys: [] };
function _aniWordsNorm() {
  var w = animeWords();
  if (_aniWordKeys.src !== w || _aniWordKeys.len !== w.length) _aniWordKeys = { src: w, len: w.length, keys: w.map(_aniKey).filter(Boolean) };
  return _aniWordKeys.keys;
}
function _aniHit(s) { var k = _aniKey(s); if (!k) return false; var ks = _aniWordsNorm(); for (var i = 0; i < ks.length; i++) if (k.indexOf(ks[i]) >= 0) return true; return false; }
// 自動の判定：{ a:true/false, why }
function animeSongOv(path) { var v = (db.animeSongOverride || {})[path]; return v === 'in' || v === 'out' ? v : ''; }
function animeAuto(a) {
  for (var i = 0; i < a.tracks.length; i++) {
    var t = a.tracks[i], g = t.tagGenre || t.genre || '';
    if (animeSongOv(t.path) === 'out') continue;   // 「外す」にした曲は判定に使わない（v8.20.0）
    if (g && _aniHit(g)) return { a: true, why: 'ジャンル「' + g + '」' };
  }
  var tg = typeof albumTagOf === 'function' ? albumTagOf(a.key) : null;
  if (tg && (_aniHit(tg.name) || _aniHit(tg.id))) return { a: true, why: 'タグ「' + tg.name + '」' };
  return { a: false, why: '' };
}
function animeOf(a) {
  // 曲の指定（v8.20.0）：1曲でも「入れる」ならアルバムも出す。全部の曲が「外す」なら出さない
  var ins = 0, outs = 0;
  a.tracks.forEach(function (t) { var s = animeSongOv(t.path); if (s === 'in') ins++; else if (s === 'out') outs++; });
  if (ins) return { a: true, why: '曲の指定（入れる ' + ins + '曲）', manual: true, songs: true };
  if (outs && outs === a.tracks.length) return { a: false, why: '全部の曲を外す指定', manual: true };
  var v = (db.animeOverride || {})[a.key];
  if (typeof v === 'boolean') return { a: v, why: v ? 'Anime Songs に入れる指定' : 'Anime Songs から外す指定', manual: true };
  return animeAuto(a);
}
function isAnimeAlbum(a) { return animeOf(a).a; }
// 曲が Anime Songs に入るか：曲の指定 → アルバムの指定 → 自動
function isAnimeTrack(t, a) {
  var s = animeSongOv(t.path);
  if (s) return s === 'in';
  var v = (db.animeOverride || {})[a.key];
  if (typeof v === 'boolean') return v;
  return animeAuto(a).a;
}
// 曲の指定：v＝'in'／'out'／''（自動に戻す）
function setAnimeSongs(paths, v) {
  if (!db.animeSongOverride || typeof db.animeSongOverride !== 'object' || Array.isArray(db.animeSongOverride)) db.animeSongOverride = {};
  var o = db.animeSongOverride, n = 0;
  (paths || []).forEach(function (p) { if (!p) return; if (v === 'in' || v === 'out') { if (o[p] !== v) { o[p] = v; n++; } } else if (o[p]) { delete o[p]; n++; } });
  _aniCount.len = -1;
  saveDB();
  if (currentPage === 'anime') renderAnimePage();
  if (currentPage === 'settings') renderSetAnime();
  if (typeof renderSidebarCounts === 'function') renderSidebarCounts();
  return n;
}
function setAnimeAlbum(key, v) {
  if (!db.animeOverride || typeof db.animeOverride !== 'object') db.animeOverride = {};
  if (v === true || v === false) db.animeOverride[key] = v; else delete db.animeOverride[key];
  _aniCount.len = -1;
  saveDB();
}
function renameAnimeAlbumKeys(map) {
  var o = db.animeOverride || {}, ch = false;
  Object.keys(map).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(o, k)) { o[map[k]] = o[k]; delete o[k]; ch = true; } });
  return ch;
}

/* ---------- アルバム情報の編集の「Anime Songs の指定」 ---------- */
function animeFieldHtml(a) {
  var v = (db.animeOverride || {})[a.key], cur = typeof v === 'boolean' ? (v ? '1' : '0') : '';
  var au = animeAuto(a);
  return '<div class="form-group te-western-group te-anime-group"><label>Anime Songs の指定（アプリ内だけ）</label><div class="te-western-opts">' +
    [['', '自動（今は' + (au.a ? '入る：' + au.why : '入らない') + '）'], ['1', '入れる'], ['0', '外す']].map(function (o) {
      return '<label class="dup-opt"><input type="radio" name="te-anime" value="' + o[0] + '"' + (o[0] === cur ? ' checked' : '') + '>' + escapeHtml(o[1]) + '</label>';
    }).join('') + '</div>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:0" onclick="copyUiLabel(\'Anime Songs の指定欄\', event)" title="クリックで「Anime Songs の指定欄」をコピー">□</span></div>';
}
function readAnimeField(b) {
  var r = b.querySelector('input[name="te-anime"]:checked');
  if (!r) return undefined;   // 欄が無い
  return r.value === '1' ? true : r.value === '0' ? false : null;
}

/* ---------- 件数（メニュー） ---------- */
var _aniCount = { at: 0, n: 0, len: -1 };
function animeCount() {
  if (!library.tracks.length) return 0;
  if (_aniCount.len === library.tracks.length && Date.now() - _aniCount.at < 3000) return _aniCount.n;
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set(), n = 0;
  buildAlbums().forEach(function (a) { if (!hs.has(a.key) && isAnimeAlbum(a)) n++; });
  _aniCount = { at: Date.now(), n: n, len: library.tracks.length };
  return n;
}

/* ---------- 画面 ---------- */
// 表示：'works' 作品（スマホ版 v8.25.0 から初期。93-anime-works.js）／'albums' アルバム
function _aniMode() { return ui.animeMode === 'albums' || typeof renderAnimeWorks !== 'function' ? 'albums' : 'works'; }
function getAnimeAlbums() {
  var albums = buildAlbums();
  _prepareAlbumSortKeys(albums);
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var all = albums.filter(function (a) { return !hs.has(a.key) && isAnimeAlbum(a); });
  var list = all;
  var q = animeView.query.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
  if (terms.length) list = list.filter(function (a) {
    var h = (a.name + ' ' + a.artist + ' ' + a.artists.join(' ') + (a.sortKey ? ' ' + a.sortKey : '') + (a.tagName ? ' ' + a.tagName : '') + (a.genre ? ' ' + a.genre : '')).toLowerCase();
    return terms.every(function (w) { return h.indexOf(w) >= 0; });
  });
  list = sortAlbumsBySetting(list, true);   // album と同じ並び（カスタム順も。スマホ版 v8.23.0 から共通の関数）
  return { all: all, list: list };
}
function _animeCardHtml(a, i) {
  var sk = getAlbumSortKey(a.key), tg = albumTagOf(a.key);
  return '<button class="album-card" data-ani-album="' + i + '" title="' + escapeHtml(a.name + (a.artist ? ' ／ ' + a.artist : '')) + '">' +
    albumCardArtHtml(a, { play: true, pin: true, sortkey: true, labels: i === 0 }) +
    '<span class="album-card-name' + (a.byFolder ? ' guessed' : '') + '">' + escapeHtml(a.name) + '</span>' +
    (tg || sk ? '<span class="album-card-labels">' + albumTagBadgeHtml(a.key) + albumCardSortKeyHtml(a) + '</span>' : '') +
    '<span class="album-card-artist">' + escapeHtml(a.artist || '　') + '</span>' +
    '<span class="album-card-count" title="' + albumCardCountTitle(a, a.tracks.length + '曲') + '">' + a.tracks.length + '曲' + albumCardGenreHtml(a) + '</span></button>';
}
function renderAnimePage() {
  var body = document.getElementById('ani-body'), countEl = document.getElementById('ani-count'), bar = document.getElementById('ani-filter-bar');
  if (!body) return;
  if (!isConnected()) { body.innerHTML = welcomeCardHtml(); countEl.textContent = ''; bar.hidden = true; return; }
  if (!library.scanned) { body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>'; bar.hidden = true; return; }
  bar.hidden = false;
  var mode = _aniMode(), md = document.getElementById('ani-mode');
  if (md) md.innerHTML = [['works', '作品'], ['albums', 'アルバム']].map(function (o) { return '<button class="tab-btn' + (o[0] === mode ? ' active' : '') + '" data-ani-mode="' + o[0] + '" aria-pressed="' + (o[0] === mode) + '">' + o[1] + '</button>'; }).join('');
  var sw = document.querySelector('#page-anime .album-sort-wrap'); if (sw) sw.hidden = mode === 'works';   // 作品の表示では並べ替え（album と共通）を使わない
  if (mode === 'works') { renderAnimeWorks(); return; }   // 作品の一覧・作品の画面（93-anime-works.js）
  var r = getAnimeAlbums();
  animeView.list = r.list;
  _aniCount = { at: Date.now(), n: r.all.length, len: library.tracks.length };
  var nb = document.getElementById('nav-count-anime'); if (nb) nb.textContent = String(r.all.length);
  var sb = document.getElementById('ani-sort-btn'); if (sb && typeof fillAlbumSortButton === 'function') fillAlbumSortButton(sb, '（album と共通）');
  var filtered = r.list.length !== r.all.length;
  countEl.textContent = filtered ? r.list.length + '枚 / 全' + r.all.length + '枚' : r.all.length + '枚';
  ['ani-play', 'ani-shuffle'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !r.list.length; });
  if (!r.list.length) {
    body.innerHTML = '<div class="empty-msg">' + (r.all.length ? '当てはまるアルバムがありません。' :
      'Anime Songs のアルバムがありません。曲のジャンルのタグ、またはアルバムのタグの名前に「' + escapeHtml(animeWords().join('」「')) + '」のどれかが入っているアルバムがここに出ます。' +
      'アルバム情報の編集の「Anime Songs の指定」で入れることもできます（判定に使う言葉は tools の「Anime Songs の設定」で変えられます）。') + '</div>';
    return;
  }
  var shown = r.list.slice(0, animeView.limit);
  body.innerHTML = '<div class="album-grid ani-grid"><span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'Anime Songs のアルバム一覧\', event)" title="クリックで「Anime Songs のアルバム一覧」をコピー">□</span>' +
    shown.map(_animeCardHtml).join('') + '</div>' +
    (r.list.length > shown.length ? loadMoreHtml('ani-more', r.list.length - shown.length, '枚') : '') +
    '<p class="lib-legend">Anime Songs かどうかは、曲のジャンルのタグとアルバムのタグの名前に「' + escapeHtml(animeWords().join('」「')) + '」が入っているかで自動で決めています（ソートキーは使いません）。違うときは、アルバム情報の編集の「Anime Songs の指定」で直せます。</p>';
  artObserve(body);
  watchLoadMore('ani', document.getElementById('ani-more'), animeLoadMore);
}
function animeLoadMore() {
  var list = animeView.list, from = animeView.limit, to = Math.min(list.length, from + ANI_PAGE_SIZE);
  var grid = document.querySelector('#ani-body .ani-grid'), more = document.getElementById('ani-more');
  if (!grid || from >= list.length) return;
  grid.insertAdjacentHTML('beforeend', list.slice(from, to).map(function (a, k) { return _animeCardHtml(a, from + k); }).join(''));
  animeView.limit = to;
  artObserve(grid);
  if (!more) return;
  if (to >= list.length) { more.remove(); return; }
  more.querySelector('.load-more-text').textContent = '下へスクロールすると続きを表示します（残り ' + (list.length - to) + ' 枚）';
  watchLoadMore('ani', more, animeLoadMore);
}
// アルバムの曲一覧の「Anime Songs に戻る」
function returnToAnimeFromAlbum(ret) {
  animeView.limit = Math.max(ANI_PAGE_SIZE, ret.limit || 0);
  showPage('anime');
  var idx = animeView.list.findIndex(function (x) { return x.key === ret.key; });
  if (idx >= animeView.limit) { animeView.limit = Math.ceil((idx + 1) / ANI_PAGE_SIZE) * ANI_PAGE_SIZE; renderAnimePage(); }
  restoreListPosition(idx >= 0 ? document.querySelector('#ani-body [data-ani-album="' + idx + '"]') : null, ret.scroll);
}
// 連続再生：表示中のアルバムの曲を、アルバムの並び・曲順でつなげる
function _animePaths() { if (_aniMode() === 'works') return animeWorksPlayPaths(); var ps = []; animeView.list.forEach(function (a) { a.tracks.forEach(function (t) { if (isAnimeTrack(t, a)) ps.push(t.path); }); }); return ps; }   // v8.20.0：外した曲は入れない
function initAnimePage() {
  var search = document.getElementById('ani-search');
  if (!search) return;
  search.addEventListener('input', debounce(function () { animeView.query = search.value; animeView.limit = ANI_PAGE_SIZE; renderAnimePage(); window.scrollTo(0, 0); }, 180));
  document.getElementById('ani-sort-btn').addEventListener('click', function () {
    var p = openAlbumSortDialog();
    Promise.resolve(p).then(function () { if (currentPage === 'anime') { animeView.limit = ANI_PAGE_SIZE; renderAnimePage(); } });
  });
  var md = document.getElementById('ani-mode');   // 表示の切り替え（スマホ版 v8.25.0）
  if (md) md.addEventListener('click', function (ev) { var b = ev.target.closest('[data-ani-mode]'); if (!b) return; ui.animeMode = b.getAttribute('data-ani-mode'); saveUi(); animeView.limit = ANI_PAGE_SIZE; renderAnimePage(); window.scrollTo(0, 0); });
  document.getElementById('ani-play').addEventListener('click', function () { var ps = _animePaths(); if (ps.length) playQueue(ps, 0, 'Anime Songs'); });
  document.getElementById('ani-shuffle').addEventListener('click', function () { var ps = _animePaths(); if (ps.length) shufflePlay(function () { playQueue(ps, 0, 'Anime Songs'); }); });
  document.getElementById('ani-body').addEventListener('click', function (ev) {
    if (_aniMode() === 'works') return;   // 作品の表示の操作は 93-anime-works.js
    if (ev.target.closest('[data-act="more"]')) { animeLoadMore(); return; }
    if (ev.target.closest('[data-card-act]')) return;   // カードの再生・Pin ボタン（27-card-actions.js）
    var c = ev.target.closest('[data-ani-album]');
    if (!c) return;
    var a = animeView.list[+c.getAttribute('data-ani-album')];
    if (a) { var ret = { page: 'anime', scroll: window.scrollY, limit: animeView.limit }; showPage('albums'); openAlbum(a, ret); }
  });
}

/* ---------- tools の「Anime Songs の設定」 ---------- */
function renderSetAnime() {
  var el = document.getElementById('set-anime');
  if (!el) return;
  var words = animeWords(), isDef = !Array.isArray(db.animeWords), ov = db.animeOverride || {};
  var nIn = Object.keys(ov).filter(function (k) { return ov[k] === true; }).length, nOut = Object.keys(ov).filter(function (k) { return ov[k] === false; }).length;
  el.innerHTML = '<div class="ani-set-title">判定に使う言葉' + (isDef ? '（初期のまま）' : '') + '</div>' +
    '<div class="ani-words">' + words.map(function (w, i) {
      return '<span class="ani-word">' + escapeHtml(w) + '<button type="button" class="ani-word-x" data-ani-word-x="' + i + '" title="「' + escapeHtml(w) + '」を外す" aria-label="「' + escapeHtml(w) + '」を外す">' + ICONS.x + '</button></span>';
    }).join('') + (words.length ? '' : '<span class="panel-meta">（言葉がありません。自動では1枚も入りません）</span>') + '</div>' +
    '<div class="ani-word-add"><input type="text" class="form-input" id="ani-word-input" placeholder="言葉を足す（例：特撮）" maxlength="40">' +
      '<button type="button" class="btn-inline-small" id="ani-word-add">' + ICONS.plus + '追加</button>' +
      '<button type="button" class="btn-inline-small" id="ani-word-reset"' + (isDef ? ' disabled' : '') + '>初期に戻す</button></div>' +
    '<p class="panel-desc">曲のジャンルのタグか、アルバムのタグの名前に、どれかの言葉が入っていると Anime Songs に入ります（全角半角・大文字小文字・空白・「-」「_」は区別しません）。ソートキーは使いません。</p>' +
    '<div class="ani-set-title">アルバムごとの指定</div><p class="panel-meta">入れる ' + nIn + '枚・外す ' + nOut + '枚（アルバム情報の編集の「Anime Songs の指定」で変えられます）</p>' +
    (nIn + nOut ? '<div class="btn-row"><button type="button" class="btn-inline-small" id="ani-ov-clear">指定をすべて解除（自動に戻す）</button></div>' : '') +
    _aniSongOvListHtml();
  var save = function (list) { db.animeWords = list; _aniWordKeys.src = null; _aniCount.len = -1; saveDB(); renderSetAnime(); renderSidebarCounts(); };
  el.querySelectorAll('[data-ani-word-x]').forEach(function (b) { b.addEventListener('click', function () { var l = words.slice(); l.splice(+b.getAttribute('data-ani-word-x'), 1); save(l); }); });
  var add = function () {
    var inp = document.getElementById('ani-word-input'), w = inp.value.replace(/\s+/g, ' ').trim();
    if (!w) return;
    if (words.some(function (x) { return _aniKey(x) === _aniKey(w); })) { showToast('「' + w + '」はもうあります。'); return; }
    save(words.concat([w]));
    setTimeout(function () { var i2 = document.getElementById('ani-word-input'); if (i2) i2.focus(); }, 0);
  };
  document.getElementById('ani-word-add').addEventListener('click', add);
  document.getElementById('ani-word-input').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  document.getElementById('ani-word-reset').addEventListener('click', function () { db.animeWords = null; _aniWordKeys.src = null; _aniCount.len = -1; saveDB(); renderSetAnime(); renderSidebarCounts(); });
  el.querySelectorAll('[data-ani-song-off]').forEach(function (b) { b.addEventListener('click', function () { setAnimeSongs([b.getAttribute('data-ani-song-off')], ''); }); });
  var sc2 = document.getElementById('ani-song-clear');
  if (sc2) sc2.addEventListener('click', async function () {
    var ks = Object.keys(db.animeSongOverride || {});
    var ok = await showConfirm({ title: '曲の指定をすべて解除', message: ks.length + '曲の Anime Songs の指定を外して、アルバムの指定・自動の判定に戻します。', okText: '解除する' });
    if (ok) setAnimeSongs(ks, '');
  });
  var oc = document.getElementById('ani-ov-clear');
  if (oc) oc.addEventListener('click', async function () {
    var ok = await showConfirm({ title: 'Anime Songs の指定をすべて解除', message: (nIn + nOut) + '枚のアルバムの指定を外して、自動の判定に戻します。', okText: '解除する' });
    if (!ok) return;
    db.animeOverride = {}; _aniCount.len = -1; saveDB(); renderSetAnime(); renderSidebarCounts();
  });
}

// tools：曲ごとの指定の一覧（v8.20.0）
function _aniSongOvListHtml() {
  var o = db.animeSongOverride || {}, ks = Object.keys(o);
  var h = '<div class="ani-set-title">曲ごとの指定</div>';
  if (!ks.length) return h + '<p class="panel-meta">ありません（曲の長押しのメニュー・曲情報の編集の「Anime Songs の指定」で付けられます）</p>';
  ks.sort(function (x, y) { return JA_COLLATOR.compare(x, y); });
  h += '<p class="panel-meta">' + ks.length + '曲</p><ul class="hidden-album-list ani-song-ov-list">' + ks.map(function (p) {
    var t = library.byPath[p];
    return '<li><span class="hidden-album-name">' + escapeHtml(t ? t.title : stripExt(splitPath(p).name)) + '</span>' +
      '<span class="hidden-album-sub">' + (o[p] === 'in' ? '入れる' : '外す') + (t ? ' ・ ' + escapeHtml([t.artist, t.album].filter(Boolean).join(' ・ ')) : (library.tracks.length ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '')) + '</span>' +
      '<button class="btn-inline-small" data-ani-song-off="' + escapeHtml(p) + '">解除</button></li>';
  }).join('') + '</ul><div class="btn-row"><button type="button" class="btn-inline-small" id="ani-song-clear">曲の指定をすべて解除</button></div>';
  return h;
}
// 曲情報の編集の「Anime Songs の指定」の欄（選ぶとすぐ保存）
function animeSongFieldHtml(path) {
  var cur = animeSongOv(path);
  return '<div class="form-group te-western-group te-anime-group"><label>Anime Songs の指定（自動／入れる／外す。選ぶとすぐ反映）</label><div class="te-western-opts">' +
    [['', '自動'], ['in', '入れる'], ['out', '外す']].map(function (o) {
      return '<label class="dup-opt"><input type="radio" name="te-anime-song" data-ani-song-path="' + escapeHtml(path) + '" value="' + o[0] + '"' + (o[0] === cur ? ' checked' : '') + '>' + o[1] + '</label>';
    }).join('') + '</div>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:0" onclick="copyUiLabel(\'Anime Songs の指定欄（曲）\', event)" title="クリックで「Anime Songs の指定欄（曲）」をコピー">□</span></div>';
}
document.addEventListener('change', function (ev) {
  var r = ev.target.closest && ev.target.closest('input[name="te-anime-song"]');
  if (!r) return;
  var p = r.getAttribute('data-ani-song-path'), v = r.value, t = library.byPath[p];
  setAnimeSongs([p], v);
  showToast('「' + (t ? t.title : p) + '」の Anime Songs の指定：' + (v === 'in' ? '入れる' : v === 'out' ? '外す' : '自動'));
});

/* ---------- 今までの処理につなぐ ---------- */
PAGE_RENDERERS.anime = renderAnimePage;
(function () {
  // メニューの件数
  var sc = window.renderSidebarCounts;
  if (typeof sc === 'function') {
    window.renderSidebarCounts = function () {
      var r = sc.apply(this, arguments);
      var el = document.getElementById('nav-count-anime');
      if (el) { try { el.textContent = library.tracks.length ? String(animeCount()) : ''; } catch (e) { /* 無視 */ } }
      return r;
    };
  }
  // tools
  var rs = window.renderSettingsPage;
  if (typeof rs === 'function') {
    window.renderSettingsPage = function () { var r = rs.apply(this, arguments); try { renderSetAnime(); } catch (e) { console.warn(e); } return r; };
    if (PAGE_RENDERERS.settings === rs) PAGE_RENDERERS.settings = window.renderSettingsPage;
  }
  // アルバムの目印が変わったとき（洋楽の指定と同じ所で）
  var rw = window.renameWesternAlbumKeys;
  if (typeof rw === 'function') window.renameWesternAlbumKeys = function (map) { var r = rw.apply(this, arguments); var r2 = renameAnimeAlbumKeys(map); return r || r2; };
  // アルバムの曲一覧の「Anime Songs に戻る」
  var bb = window._setAlbumBackBtn;
  if (typeof bb === 'function') {
    window._setAlbumBackBtn = function (show) {
      var r = bb.apply(this, arguments);
      var b = document.getElementById('alb-back-btn');
      if (b && albView.ret && albView.ret.page === 'anime') b.innerHTML = ICONS.up + 'Anime Songs に戻る';
      return r;
    };
  }
  var bl = window.backToAlbumList;
  if (typeof bl === 'function') {
    window.backToAlbumList = function () {
      var ret = albView.ret;
      if (ret && ret.page === 'anime') { albView.openKey = null; albView.openPath = null; albView.ret = null; returnToAnimeFromAlbum(ret); return; }
      return bl.apply(this, arguments);
    };
  }
  // 長押しのメニュー：Anime Songs のカード
  var aa = window._acmAlbumAt;
  if (typeof aa === 'function') {
    window._acmAlbumAt = function (target) {
      var r = aa.apply(this, arguments);
      if (r || !target || !target.closest) return r;
      var art = target.closest('.card-art-wrap, .art-card');
      var card = art && art.closest('.album-card[data-ani-album]');
      return card ? animeView.list[+card.getAttribute('data-ani-album')] || null : null;
    };
  }
  // カードの Pin ボタンのあと、Anime Songs の画面も描き直す
  var ca = window._cardAct;
  if (typeof ca === 'function') {
    window._cardAct = function (el) { var r = ca.apply(this, arguments); if (currentPage === 'anime' && el.getAttribute('data-card-act') === 'pin') renderAnimePage(); return r; };
  }
  // 曲情報の編集：「Anime Songs の指定」の欄を足す（v8.20.0）
  var te = window.openTrackTagEditor;
  if (typeof te === 'function') {
    window.openTrackTagEditor = function (path) {
      var p = te.apply(this, arguments);
      try {
        var body = document.getElementById('dialog-body');
        if (body && library.byPath[path] && !body.querySelector('input[name="te-anime-song"]')) {
          var w = document.createElement('div'); w.innerHTML = animeSongFieldHtml(path);
          var err = body.querySelector('.tfw-open-row') || body.querySelector('.dialog-error');
          if (err) body.insertBefore(w.firstChild, err); else body.appendChild(w.firstChild);
        }
      } catch (e) { console.warn(e); }
      return p;
    };
  }
  // 曲の長押しのメニュー：「Anime Songs に入れる／外す／自動に戻す」（v8.20.0。選んだ曲はまとめて）
  var sm = window.openSongMenu;
  if (typeof sm === 'function') {
    window.openSongMenu = function (paths, x, y, title) {
      var r = sm.apply(this, arguments);
      var el = typeof upm !== 'undefined' ? upm.el : null;
      if (!el) return r;
      var ps = (paths || []).filter(Boolean), cur = ps.length === 1 ? animeSongOv(ps[0]) : null;
      var sep = document.createElement('div'); sep.className = 'acm-sep'; el.appendChild(sep);
      [['in', 'Anime Songs に入れる'], ['out', 'Anime Songs から外す'], ['', 'Anime Songs の指定を自動に戻す']].forEach(function (o) {
        if (cur !== null && cur === o[0]) return;   // 1曲のときは今の状態の項目は出さない
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'acm-item'; b.setAttribute('role', 'menuitem');
        b.innerHTML = ICONS.anime + '<span>' + o[1] + '</span>';
        b.addEventListener('click', function () {
          closeSongMenu();
          var n = setAnimeSongs(ps, o[0]);
          showToast((ps.length > 1 ? ps.length + '曲を' : '「' + _songTitle(ps[0]) + '」を') + (o[0] === 'in' ? ' Anime Songs に入れました' : o[0] === 'out' ? ' Anime Songs から外しました' : ' 自動の判定に戻しました') + (n ? '' : '（変わりませんでした）'));
        });
        el.appendChild(b);
      });
      var rr = el.getBoundingClientRect(), m = 6;
      if (rr.bottom > window.innerHeight - m) el.style.top = Math.max(m, window.innerHeight - rr.height - m) + 'px';
      return r;
    };
  }
  // ファイル整理で場所が変わったとき：曲の指定を付け替える
  var am = window.applyPathMapping;
  if (typeof am === 'function') {
    window.applyPathMapping = function (map) {
      var r = am.apply(this, arguments);
      try { var o = db.animeSongOverride || {}, ch = false; Object.keys(map).forEach(function (f) { if (o[f]) { o[map[f]] = o[f]; delete o[f]; ch = true; } }); if (ch) saveDB(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 非表示にした・戻したとき
  var hc = window._hiddenChanged;
  if (typeof hc === 'function') window._hiddenChanged = function () { var r = hc.apply(this, arguments); _aniCount.len = -1; if (currentPage === 'anime') renderAnimePage(); return r; };
})();
initAnimePage();
// 下部メニューバー（66 が先に作っている）の短い名前を「Anime」に
(function () { var l = document.querySelector('#bottom-nav .bnav-item[data-page="anime"] .bnav-label'); if (l) l.textContent = 'Anime'; })();

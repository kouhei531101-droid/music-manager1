/* =========================================================
   36-western.js ― 「Western music」画面（洋楽のアルバム。v5.0）
   ・v6.5：自動の判定を「タグで判定」から「ソートキーで判定」に変えた（db.westernMethod：'sortkey' 初期／'chars' 文字の種類／'both' 両方。
       v6.4 までの 'tags' は 'sortkey' として読む）。ソートキーで判定：アルバムのソートキーが「判定に使う言葉」（初期は「洋楽」「Western music」）
       そのもの、またはその言葉で始まる（例「洋楽」「洋楽 ロック」「Western Music 70s」）なら洋楽。途中に含むだけ（例「非洋楽」）は当たらない。
       比べるときは全角半角・大文字小文字・空白・- _ . を無視する。曲のジャンルのタグ・アプリのアルバムのタグでは判定しない（タグそのものは残る）
   ・v5.2（v6.4 まで）：自動の判定の初期値を「タグで判定」に変えた（db.westernMethod：'tags' 初期／'chars' 文字の種類／'both' 両方）。
       タグで判定：アルバムの曲のジャンルのタグ（どれか1曲でも）か、アプリのアルバムのタグの名前に「判定に使う言葉」
       （db.westernWords。初期は「洋楽」「Western music」）が入っていれば洋楽。比べるときは全角半角・大文字小文字・空白・- _ . を無視する
       （「Western Music」「western-music」「WESTERN MUSIC」も当たる。「Western」だけは当たらない：Country & Western などと区別するため。
       必要なら tools で言葉に「Western」を足す）。両方：タグで当たるか、文字の種類で洋楽なら洋楽
   ・洋楽の判定（アルバムごと。強い順）：
       ① アルバムごとの洋楽の指定（db.westernAlbums = { アルバムの目印: true 洋楽にする / false 洋楽から外す }）
       ② アーティストごとの洋楽の指定（db.westernArtists = { アーティスト名: true / false }。そのアーティストのアルバム全部に効く。
          アーティスト名はアルバムの並べ替えと同じ a.sortArtist＝アルバムアーティスト、無ければ曲順で1曲目のアーティスト）
       ③ 自動：ジャンルが「邦楽のジャンル」（db.westernGenres。末尾が * なら前方一致。大文字小文字・全角半角は区別しない）なら洋楽ではない。
          そうでなければ、アーティスト名とアルバム名に日本語の文字（ひらがな・カタカナ・漢字・半角カナ）が無く、
          文字の半分以上が英字などのラテン文字なら洋楽（「Mr.Children」のような英語名の日本のアーティストは①②で直す）
   ・保存（バックアップ・復元に含む）：db.westernGenres（null＝初期の一覧）・db.westernAlbums・db.westernArtists。
     目印・アーティスト名が変わったときは付け替える（migrateAlbumKeys・_renameAlbumKeysAfter・renamePinnedArtistsAfter から）
   ・画面：album と同じアルバムカード（再生・Pin・ソートキー・タグボタン。非表示ボタンは付けない）。並べ替えは album と共通の設定（並べ替えボタン）。
     検索・タグの絞り込み・ジャンルの絞り込み（Western music 専用の選択。ui.westernTagFilter / westernGenreFilter）。
     表示の切り替え「アルバム／アーティスト」（アーティスト：洋楽のアルバムのアーティストの一覧 → 押すと artist の画面）。
     非表示のアルバムは出さない。Pin の区切りは作らない（Pin したアルバムもふつうの並びの中に出る）
   ・カードを押すと album のアルバムの曲一覧（ヘッダーの「Western music に戻る」でこの位置に戻る）
   ========================================================= */

var WESTERN_GENRES_DEFAULT = ['J-*', 'JPop', 'JRock', '邦楽', '歌謡曲', '演歌', 'Enka', 'Kayokyoku', 'アニメ', 'Anime', 'アニソン', 'ボーカロイド', 'Vocaloid'];
var WESTERN_WORDS_DEFAULT = ['洋楽', 'Western music'];
var WESTERN_METHODS = [['sortkey', 'ソートキーで判定（初期）'], ['chars', '文字の種類で判定'], ['both', '両方（どちらかで洋楽なら洋楽）']];
var WES_PAGE_SIZE = 200;
var westernView = { query: '', limit: WES_PAGE_SIZE, list: [], artists: [], ret: null };
var _WES_JP_RE = /[぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々〆ヵヶ]/;
var _WES_LATIN_RE = /[A-Za-zÀ-ɏ]/g;
var _WES_LETTER_RE = /\p{L}/gu;

PAGE_RENDERERS.western = renderWesternPage;

function westernGenres() { return Array.isArray(db.westernGenres) ? db.westernGenres : WESTERN_GENRES_DEFAULT; }
function _wesNorm(s) { return String(s || '').normalize('NFKC').toLowerCase().trim(); }
function isJapaneseGenre(g) {
  var v = _wesNorm(g);
  if (!v) return false;
  return westernGenres().some(function (p) {
    var q = _wesNorm(p);
    if (!q) return false;
    if (q.charAt(q.length - 1) === '*') return v.indexOf(q.slice(0, -1)) === 0;
    return v === q;
  });
}
function westernMethod() { var m = db.westernMethod; return m === 'chars' || m === 'both' ? m : 'sortkey'; }   // v6.4 までの 'tags' も 'sortkey'
function westernWords() { return Array.isArray(db.westernWords) && db.westernWords.length ? db.westernWords : WESTERN_WORDS_DEFAULT; }
// 比べるための形：全角半角・大文字小文字をそろえ、空白・- _ . ・ を取る
function _wesKey(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\-_.・･]+/g, ''); }
var _wesWordKeys = { src: null, keys: [] };
function _wesWordsNorm() {
  var ws = westernWords();
  if (_wesWordKeys.src !== ws || _wesWordKeys.len !== ws.length) _wesWordKeys = { src: ws, len: ws.length, keys: ws.map(_wesKey).filter(Boolean) };
  return _wesWordKeys.keys;
}
function _wesTextHit(s) { var k = _wesKey(s); if (!k) return ''; var ks = _wesWordsNorm(); for (var i = 0; i < ks.length; i++) if (k.indexOf(ks[i]) >= 0) return s; return ''; }
// ソートキーで判定（v6.5）：{ hit, why }。ソートキーが判定に使う言葉そのもの、またはその言葉で始まるなら洋楽
//   （「含む」にしないのは、枠のグループに使う別のソートキー〔例「非洋楽」「J-POP 洋楽カバー」〕を洋楽にしないため）
function westernBySortKey(a) {
  var sk = typeof getAlbumSortKey === 'function' ? getAlbumSortKey(a.key) : '';
  var k = _wesKey(sk);
  if (k) { var ks = _wesWordsNorm(); for (var i = 0; i < ks.length; i++) if (ks[i] && k.indexOf(ks[i]) === 0) return { hit: true, why: 'ソートキー「' + sk + '」' }; }
  return { hit: false, why: sk ? 'ソートキー「' + sk + '」が「' + westernWords().join('」「') + '」で始まらない' : 'ソートキーが無い' };
}
// （v6.4 まで）タグで判定：曲のジャンルのタグ・アプリのアルバムのタグの名前。v6.5 からは使わない
function westernByTags(a) {
  for (var i = 0; i < a.tracks.length; i++) { var g = a.tracks[i].tagGenre; if (g && _wesTextHit(g)) return { hit: true, why: 'ジャンルのタグ「' + g + '」' }; }
  var tg = typeof albumTagOf === 'function' ? albumTagOf(a.key) : null;
  if (tg && _wesTextHit(tg.name)) return { hit: true, why: 'アルバムのタグ「' + tg.name + '」' };
  return { hit: false, why: 'ジャンル・アルバムのタグに「' + westernWords().join('」「') + '」が無い' };
}
// 自動の判定：{ w: 洋楽か, why: 理由 }（v5.2 から判定の方法しだい）
function westernAuto(a) {
  var m = westernMethod();
  if (m !== 'chars') {
    var t = westernBySortKey(a);
    if (t.hit || m === 'sortkey') return { w: t.hit, why: t.why };
  }
  return westernByChars(a);
}
// 文字の種類で判定（v5.0 の自動の判定）
function westernByChars(a) {
  if (a.genre && isJapaneseGenre(a.genre)) return { w: false, why: '邦楽のジャンル（' + a.genre + '）' };
  var text = (a.sortArtist || '') + ' ' + (a.byFolder ? '' : a.name || '');
  if (_WES_JP_RE.test(text)) return { w: false, why: '名前に日本語の文字がある' };
  var letters = (text.match(_WES_LETTER_RE) || []).length, latin = (text.match(_WES_LATIN_RE) || []).length;
  if (!letters) return { w: false, why: '名前に文字が無い' };
  if (latin * 2 >= letters) return { w: true, why: '名前が英字などのラテン文字' };
  return { w: false, why: '名前がラテン文字ではない' };
}
// 判定：{ w, src: 'album'|'artist'|'auto', why }
function westernOf(a) {
  var am = db.westernAlbums || {}, rm = db.westernArtists || {};
  if (typeof am[a.key] === 'boolean') return { w: am[a.key], src: 'album', why: 'アルバムの指定' };
  var ar = a.sortArtist || '';
  if (ar && typeof rm[ar] === 'boolean') return { w: rm[ar], src: 'artist', why: 'アーティスト「' + ar + '」の指定' };
  var au = westernAuto(a);
  return { w: au.w, src: 'auto', why: '自動：' + au.why };
}
function isWesternAlbum(a) { return westernOf(a).w; }

/* ---------- 指定する ---------- */
function _wesSet(mapName, key, v) {
  if (!key) return false;
  if (!db[mapName] || typeof db[mapName] !== 'object') db[mapName] = {};
  var cur = typeof db[mapName][key] === 'boolean' ? db[mapName][key] : null;
  if (cur === v) return false;
  if (v === null) delete db[mapName][key]; else db[mapName][key] = !!v;
  saveDB();
  _wesCount.at = 0;
  return true;
}
function setWesternAlbum(key, v) { return _wesSet('westernAlbums', key, v); }
function setWesternArtist(name, v) { return _wesSet('westernArtists', name, v); }
function renameWesternAlbumKeys(map) {
  var m = db.westernAlbums, ch = false;
  if (!m) return false;
  Object.keys(map).forEach(function (o) { var n = map[o]; if (!n || n === o || typeof m[o] !== 'boolean') return; if (typeof m[n] !== 'boolean') m[n] = m[o]; delete m[o]; ch = true; });
  return ch;
}
function renameWesternArtistKeys(map) {
  var m = db.westernArtists, ch = false;
  if (!m) return false;
  Object.keys(map).forEach(function (o) { var n = map[o]; if (!n || n === o || typeof m[o] !== 'boolean') return; if (typeof m[n] !== 'boolean') m[n] = m[o]; delete m[o]; ch = true; });
  return ch;
}

/* ---------- 洋楽の指定のメニュー（見出し・artist から） ---------- */
function _wesStateText(v) { return v === true ? '洋楽にする' : v === false ? '洋楽から外す' : '自動'; }
// kind：'album'（a はアルバム）／'artist'（a は { name }）
function openWesternMenu(kind, a, anchor) {
  if (typeof closeFolderMenu === 'function') closeFolderMenu();
  var mapName = kind === 'album' ? 'westernAlbums' : 'westernArtists', key = kind === 'album' ? a.key : a.name;
  var cur = typeof (db[mapName] || {})[key] === 'boolean' ? db[mapName][key] : null;
  var autoText;
  if (kind === 'album') { var au = westernAuto(a), ar = (db.westernArtists || {})[a.sortArtist || '']; autoText = typeof ar === 'boolean' ? 'アーティストの指定：' + (ar ? '洋楽' : '洋楽ではない') : '自動の判定（' + WESTERN_METHODS.filter(function (x) { return x[0] === westernMethod(); })[0][1].replace(/（.*）/, '') + '）：' + (au.w ? '洋楽' : '洋楽ではない') + '（' + au.why + '）'; }
  else autoText = 'アルバムごとの自動の判定に任せる';
  var opts = [[null, '自動', autoText], [true, '洋楽にする', kind === 'album' ? 'このアルバムを Western music に出す' : 'このアーティストのアルバムを全部 Western music に出す'], [false, '洋楽から外す', kind === 'album' ? 'このアルバムを Western music に出さない' : 'このアーティストのアルバムを全部出さない']];
  var el = document.createElement('div');
  el.className = 'sortkey-pop folder-menu western-menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', '洋楽の指定');
  el.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'洋楽の指定\', event)" title="クリックで「洋楽の指定」をコピー">□</span>' +
    '<div class="sortkey-pop-title">' + ICONS.globe + '洋楽の指定<span class="sortkey-pop-album">' + escapeHtml(kind === 'album' ? a.name : a.name) + '</span></div>' +
    '<div class="folder-menu-list">' + opts.map(function (o, i) {
      var on = o[0] === cur;
      return '<button type="button" class="folder-menu-item' + (on ? ' is-current' : '') + '" role="menuitemradio" aria-checked="' + on + '" data-wm="' + i + '">' +
        '<span class="western-menu-check">' + (on ? '●' : '○') + '</span><span class="folder-menu-name"><strong>' + o[1] + '</strong><br><span class="western-menu-sub">' + escapeHtml(o[2]) + '</span></span></button>';
    }).join('') + '</div>';
  document.body.appendChild(el);
  var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, mg = 8;
  var top = r.bottom + 6; if (top + h > window.innerHeight - mg) top = r.top - h - 6;
  el.style.left = Math.round(Math.min(Math.max(mg, r.left), window.innerWidth - w - mg)) + 'px';
  el.style.top = Math.round(Math.min(Math.max(mg, top), window.innerHeight - h - mg)) + 'px';
  var close = function () { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); el.remove(); if (document.body.contains(anchor)) { try { anchor.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } };
  var onDown = function (ev) { if (!el.contains(ev.target)) close(); };
  var onKey = function (ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { var items = Array.from(el.querySelectorAll('[data-wm]')), i = items.indexOf(document.activeElement); ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  };
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-wm]');
    if (!b) return;
    var v = opts[+b.getAttribute('data-wm')][0];
    close();
    if (_wesSet(mapName, key, v)) {
      showToast((kind === 'album' ? 'アルバム「' : 'アーティスト「') + a.name + '」の洋楽の指定を「' + _wesStateText(v) + '」にしました。', false,
        { label: '元に戻す', fn: function () { _wesSet(mapName, key, cur); renderSidebarCounts(); renderCurrentPage(); } });
      renderSidebarCounts(); renderCurrentPage();
    }
  });
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  setTimeout(function () { var f = el.querySelector('.is-current') || el.querySelector('[data-wm]'); if (f) f.focus(); }, 0);
}
// アルバムの見出しの「洋楽の指定ボタン」（アルバム名の行。Google検索ボタンの右）
function albumWesternButtonHtml(a) {
  var s = westernOf(a);
  return '<span class="album-western-wrap"><button class="album-google-btn album-western-btn' + (s.w ? ' is-western' : '') + (s.src !== 'auto' ? ' is-manual' : '') + '" data-act="western"' +
    ' title="洋楽の指定（今：' + (s.w ? 'Western music に出す' : 'Western music に出さない') + '。' + escapeHtml(s.why) + '）" aria-label="洋楽の指定（今：' + (s.w ? '洋楽' : '洋楽ではない') + '）">' + ICONS.globe + '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-8px;right:-10px" onclick="copyUiLabel(\'洋楽の指定ボタン\', event)" title="クリックで「洋楽の指定ボタン」をコピー">□</span></span>';
}
// アーティストの見出しの「アーティストの洋楽の指定ボタン」（写真の右上）
function artistWesternButtonHtml(ar) {
  if (!ar.name) return '';
  var v = (db.westernArtists || {})[ar.name];
  return '<span class="head-art-hide-wrap"><button class="art-overlay-btn head-art-western' + (v === true ? ' is-western' : v === false ? ' is-not-western' : '') + '" data-act="artist-western"' +
    ' title="洋楽の指定（今：' + _wesStateText(typeof v === 'boolean' ? v : null) + '）" aria-label="洋楽の指定（今：' + _wesStateText(typeof v === 'boolean' ? v : null) + '）">' + ICONS.globe + '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-12px;right:-2px" onclick="copyUiLabel(\'アーティストの洋楽の指定ボタン\', event)" title="クリックで「アーティストの洋楽の指定ボタン」をコピー">□</span></span>';
}
// アルバム情報の編集ダイアログの「洋楽の指定欄」
function westernFieldHtml(a) {
  var v = (db.westernAlbums || {})[a.key], cur = typeof v === 'boolean' ? (v ? '1' : '0') : '';
  var au = westernAuto(a), ar = (db.westernArtists || {})[a.sortArtist || ''];
  var autoNote = typeof ar === 'boolean' ? 'アーティストの指定：' + (ar ? '洋楽' : '洋楽ではない') : '今は' + (au.w ? '洋楽' : '洋楽ではない');
  return '<div class="form-group te-western-group"><label>洋楽の指定（Western music。アプリ内だけ）</label><div class="te-western-opts">' +
    [['', '自動（' + autoNote + '）'], ['1', '洋楽にする'], ['0', '洋楽から外す']].map(function (o) {
      return '<label class="dup-opt"><input type="radio" name="te-western" value="' + o[0] + '"' + (o[0] === cur ? ' checked' : '') + '>' + escapeHtml(o[1]) + '</label>';
    }).join('') + '</div>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:0" onclick="copyUiLabel(\'洋楽の指定欄\', event)" title="クリックで「洋楽の指定欄」をコピー">□</span></div>';
}
function readWesternField(b) {
  var r = b.querySelector('input[name="te-western"]:checked');
  var v = r ? r.value : '';
  return v === '1' ? true : v === '0' ? false : null;
}

/* ---------- 件数（サイドバー） ---------- */
var _wesCount = { at: 0, n: 0, len: -1 };
function westernCount() {
  if (!library.tracks.length) return 0;
  if (_wesCount.len === library.tracks.length && Date.now() - _wesCount.at < 3000) return _wesCount.n;
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set(), n = 0;
  buildAlbums().forEach(function (a) { if (!hs.has(a.key) && isWesternAlbum(a)) n++; });
  _wesCount = { at: Date.now(), n: n, len: library.tracks.length };
  return n;
}

/* ---------- 画面 ---------- */
function _wesMode() { return ui.westernMode === 'artists' ? 'artists' : 'albums'; }
function getWesternAlbums() {
  var albums = buildAlbums();
  _prepareAlbumSortKeys(albums);
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var all = albums.filter(function (a) { return !hs.has(a.key) && isWesternAlbum(a); });
  var list = all;
  var tf = ui.westernTagFilter || '', gf = ui.westernGenreFilter || '';
  if (tf && tf !== '__none' && !albumTagById(tf)) tf = '';
  if (tf) list = list.filter(function (a) { return albumMatchesTagFilter(a, tf); });
  if (gf) list = list.filter(function (a) { return albumMatchesGenreFilter(a, gf); });
  var q = westernView.query.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
  if (terms.length) list = list.filter(function (a) {
    var h = (a.name + ' ' + a.artist + ' ' + a.artists.join(' ') + (a.sortKey ? ' ' + a.sortKey : '') + (a.tagName ? ' ' + a.tagName : '') + (a.genre ? ' ' + a.genre : '')).toLowerCase();
    return terms.every(function (w) { return h.indexOf(w) >= 0; });
  });
  var spec = albumSortSpec();
  if (spec.mode === 'custom') list = _applyCustomOrder(list.slice().sort(compareAlbumsStandard));   // 自分で並べた順（album のカスタム順）
  else list = list.slice().sort(albumComparatorFor(spec.fields));
  return { all: all, list: list };
}
function _westernCardHtml(a, i) {
  var sk = getAlbumSortKey(a.key), tg = albumTagOf(a.key);
  return '<button class="album-card" data-wes-album="' + i + '" title="' + escapeHtml(a.name + (a.artist ? ' ／ ' + a.artist : '')) + '">' +
    albumCardArtHtml(a, { play: true, pin: true, sortkey: true, labels: i === 0 }) +
    '<span class="album-card-name' + (a.byFolder ? ' guessed' : '') + '">' + escapeHtml(a.name) + '</span>' +
    (tg || sk ? '<span class="album-card-labels">' + albumTagBadgeHtml(a.key) + albumCardSortKeyHtml(a) + '</span>' : '') +
    '<span class="album-card-artist">' + escapeHtml(a.artist || '　') + '</span>' +
    '<span class="album-card-count" title="' + albumCardCountTitle(a, a.tracks.length + '曲') + '">' + a.tracks.length + '曲' + albumCardGenreHtml(a) + '</span></button>';
}
function _wesFilterSelects(all) {
  // タグ
  var ts = document.getElementById('wes-tag-filter'), tags = db.albumTags || [], tf = ui.westernTagFilter || '';
  if (ts) {
    ts.parentElement.hidden = !tags.length;
    ts.innerHTML = '<option value="">タグ：すべて</option>' + tags.map(function (t) { return '<option value="' + escapeHtml(t.id) + '">タグ：' + escapeHtml(t.name) + '</option>'; }).join('') + '<option value="__none">タグなし</option>';
    ts.value = tf && (tf === '__none' || albumTagById(tf)) ? tf : '';
    ts.classList.toggle('active', !!ts.value);
  }
  // ジャンル
  var gsel = document.getElementById('wes-genre-filter'), gf = ui.westernGenreFilter || '';
  if (gsel) {
    var cnt = {}, none = 0;
    all.forEach(function (a) { if (a.genre) cnt[a.genre] = (cnt[a.genre] || 0) + 1; else none++; });
    var gs = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x] || JA_COLLATOR.compare(x, y); });
    if (gf && gf !== '__none' && !cnt[gf]) gs.push(gf);
    gsel.parentElement.hidden = !gs.length && !gf;
    gsel.innerHTML = '<option value="">ジャンル：すべて</option>' + gs.map(function (g) { return '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + '（' + (cnt[g] || 0) + '）</option>'; }).join('') + '<option value="__none">ジャンルなし（' + none + '）</option>';
    gsel.value = gf;
    gsel.classList.toggle('active', !!gf);
  }
  var sb = document.getElementById('wes-sort-btn');
  if (sb) fillAlbumSortButton(sb, '（album と共通）');   // 最初の1項目だけ表示（v6.3。29-album-sort.js）
  var md = document.getElementById('wes-mode'), mode = _wesMode();
  if (md) md.innerHTML = [['albums', 'アルバム'], ['artists', 'アーティスト']].map(function (o) { return '<button class="tab-btn' + (o[0] === mode ? ' active' : '') + '" data-wes-mode="' + o[0] + '" aria-pressed="' + (o[0] === mode) + '">' + o[1] + '</button>'; }).join('');
}
function renderWesternPage() {
  var body = document.getElementById('wes-body'), countEl = document.getElementById('wes-count'), bar = document.getElementById('wes-filter-bar');
  if (!body) return;
  if (!isConnected()) { body.innerHTML = welcomeCardHtml(); countEl.textContent = ''; bar.hidden = true; return; }
  if (!library.scanned) { body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>'; bar.hidden = true; return; }
  bar.hidden = false;
  var r = getWesternAlbums(), mode = _wesMode();
  _wesFilterSelects(r.all);
  westernView.list = r.list;
  _wesCount = { at: Date.now(), n: r.all.length, len: library.tracks.length };
  var nb = document.getElementById('nav-count-western'); if (nb) nb.textContent = String(r.all.length);   // サイドバーの件数もそろえる
  var filtered = r.list.length !== r.all.length;
  if (mode === 'artists') {
    var m = new Map();
    r.list.forEach(function (a) { var n = a.sortArtist || ''; var x = m.get(n); if (!x) { x = { name: n, albums: [] }; m.set(n, x); } x.albums.push(a); });
    var ars = Array.from(m.values()).sort(function (x, y) { return compareAlbumText(albumTextKey(x.name), albumTextKey(y.name)); });
    westernView.artists = ars;
    countEl.textContent = ars.length + '人' + (filtered ? '（' + r.list.length + '枚）' : '');
    if (!ars.length) { body.innerHTML = '<div class="empty-msg">' + (r.all.length ? '当てはまるアーティストがいません。' : _wesEmptyText()) + '</div>'; return; }
    body.innerHTML = '<section class="panel wes-artist-list"><span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'洋楽のアーティスト一覧\', event)" title="クリックで「洋楽のアーティスト一覧」をコピー">□</span>' +
      ars.map(function (x, i) {
        return '<button class="pl-item art-item" data-wes-artist="' + i + '" title="' + escapeHtml(x.name || UNKNOWN_ARTIST_LABEL) + ' の画面を開く">' + artThumbHtml(x.albums[0].cover, 'art-item-thumb') +
          '<span class="art-item-text"><span class="art-item-name">' + escapeHtml(x.name || UNKNOWN_ARTIST_LABEL) + '</span><span class="art-item-meta">洋楽のアルバム ' + x.albums.length + '枚</span></span></button>';
      }).join('') + '</section>';
    artObserve(body);
    return;
  }
  countEl.textContent = filtered ? r.list.length + '枚 / 全' + r.all.length + '枚' : r.all.length + '枚';
  if (!r.list.length) { body.innerHTML = '<div class="empty-msg">' + (r.all.length ? '当てはまるアルバムがありません。' : _wesEmptyText()) + '</div>'; return; }
  var shown = r.list.slice(0, westernView.limit);
  body.innerHTML = '<div class="album-grid wes-grid"><span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'洋楽のアルバム一覧\', event)" title="クリックで「洋楽のアルバム一覧」をコピー">□</span>' +
    shown.map(_westernCardHtml).join('') + '</div>' +
    (r.list.length > shown.length ? loadMoreHtml('wes-more', r.list.length - shown.length, '枚') : '') +
    '<p class="lib-legend">洋楽かどうかは、' + (westernMethod() === 'chars' ? 'アルバムアーティストとアルバム名の文字・ジャンル' : westernMethod() === 'both' ? 'アルバムのソートキー（「' + westernWords().join('」「') + '」で始まるか）と、名前の文字' : 'アルバムのソートキーが「' + westernWords().join('」「') + '」（またはその言葉で始まる）か') + 'で自動で決めています。違うときは、アルバムの見出しの洋楽の指定ボタン、artist の画面、tools の「Western music の設定」で直せます。</p>';
  artObserve(body);
  watchLoadMore('wes', document.getElementById('wes-more'), westernLoadMore);
}
// 洋楽が1枚も無いときの案内（v6.5：ソートキーで判定なら、ソートキーの入れ方を案内）
function _wesEmptyText() {
  if (westernMethod() === 'chars') return '洋楽のアルバムがありません（tools の「Western music の設定」やアルバムの見出しの洋楽の指定ボタンで指定できます）。';
  return '洋楽のアルバムがありません。アルバムのソートキーに「' + escapeHtml(westernWords()[0] || '洋楽') + '」と入れると、ここに出ます' +
    '（「' + escapeHtml(westernWords().join('」「')) + '」そのもの、またはその言葉で始まるソートキー。例：「洋楽 ロック」）。' +
    'ソートキーは、アルバムカードのソートキー・タグボタン、アルバムの見出し、アルバム情報の編集、アルバムの一括編集で入れられます。判定の方法を「文字の種類」にすることもできます。';
}
function westernLoadMore() {
  var list = westernView.list, from = westernView.limit, to = Math.min(list.length, from + WES_PAGE_SIZE);
  var grid = document.querySelector('#wes-body .wes-grid'), more = document.getElementById('wes-more');
  if (!grid || from >= list.length) return;
  grid.insertAdjacentHTML('beforeend', list.slice(from, to).map(function (a, k) { return _westernCardHtml(a, from + k); }).join(''));
  westernView.limit = to;
  artObserve(grid);
  if (!more) return;
  if (to >= list.length) { more.remove(); return; }
  more.querySelector('.load-more-text').textContent = '下へスクロールすると続きを表示します（残り ' + (list.length - to) + ' 枚）';
  watchLoadMore('wes', more, westernLoadMore);
}
// アルバムの曲一覧の「Western music に戻る」
function returnToWesternFromAlbum(ret) {
  westernView.limit = Math.max(WES_PAGE_SIZE, ret.limit || 0);
  showPage('western');
  var idx = westernView.list.findIndex(function (x) { return x.key === ret.key; });
  if (idx >= westernView.limit) { westernView.limit = Math.ceil((idx + 1) / WES_PAGE_SIZE) * WES_PAGE_SIZE; renderWesternPage(); }
  restoreListPosition(idx >= 0 ? document.querySelector('#wes-body [data-wes-album="' + idx + '"]') : null, ret.scroll);
}
function initWesternPage() {
  var search = document.getElementById('wes-search');
  search.addEventListener('input', debounce(function () { westernView.query = search.value; westernView.limit = WES_PAGE_SIZE; renderWesternPage(); window.scrollTo(0, 0); }, 180));
  document.getElementById('wes-sort-btn').addEventListener('click', openAlbumSortDialog);
  document.getElementById('wes-tag-filter').addEventListener('change', function (ev) { ui.westernTagFilter = ev.target.value; saveUi(); westernView.limit = WES_PAGE_SIZE; renderWesternPage(); window.scrollTo(0, 0); });
  document.getElementById('wes-genre-filter').addEventListener('change', function (ev) { ui.westernGenreFilter = ev.target.value; saveUi(); westernView.limit = WES_PAGE_SIZE; renderWesternPage(); window.scrollTo(0, 0); });
  document.getElementById('wes-mode').addEventListener('click', function (ev) { var b = ev.target.closest('[data-wes-mode]'); if (!b) return; ui.westernMode = b.getAttribute('data-wes-mode'); saveUi(); renderWesternPage(); window.scrollTo(0, 0); });
  document.getElementById('wes-body').addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="more"]')) { westernLoadMore(); return; }
    var c = ev.target.closest('[data-wes-album]');
    if (c) {
      var a = westernView.list[+c.getAttribute('data-wes-album')];
      if (a) { var ret = { page: 'western', scroll: window.scrollY, limit: westernView.limit }; showPage('albums'); openAlbum(a, ret); }
      return;
    }
    var r = ev.target.closest('[data-wes-artist]');
    if (r) { var x = westernView.artists[+r.getAttribute('data-wes-artist')]; if (x) { showPage('artists'); openArtist(x.name); } }
  });
}

/* ---------- tools の「Western music の設定」 ---------- */
function renderSetWestern() {
  var el = document.getElementById('set-western');
  if (!el) return;
  var gs = westernGenres(), am = db.westernAlbums || {}, rm = db.westernArtists || {};
  var names = {};
  if (library.tracks.length) buildAlbums().forEach(function (a) { names[a.key] = a.name + (a.artist ? ' ／ ' + a.artist : ''); });
  var m = westernMethod(), ws = westernWords();
  var h = '<p class="panel-meta">洋楽の判定：①アルバムの指定 → ②アーティストの指定 → ③自動（下の方法）。今は ' + (library.tracks.length ? westernCount() + '枚が洋楽' : '音楽フォルダを読み込むと枚数が出ます') + '。</p>' +
    '<h3 class="wes-set-title">自動の判定の方法<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'洋楽の判定の方法\', event)" title="クリックで「洋楽の判定の方法」をコピー">□</span></h3>' +
    '<div class="te-western-opts wes-method" role="radiogroup" aria-label="洋楽の判定の方法">' + WESTERN_METHODS.map(function (x) {
      return '<label class="dup-opt"><input type="radio" name="wes-method" value="' + x[0] + '"' + (m === x[0] ? ' checked' : '') + '>' + x[1] + '</label>';
    }).join('') + '</div>' +
    '<p class="panel-desc">ソートキーで判定：アルバムのソートキーが、下の「判定に使う言葉」そのもの、またはその言葉で始まれば洋楽（例：「洋楽」「洋楽 ロック」「Western Music 70s」。途中に含むだけの「非洋楽」などは当たりません）。曲のジャンルのタグ・アルバムのタグでは判定しません。文字の種類で判定：アーティスト名・アルバム名に日本語の文字が無く英字などが主なら洋楽（邦楽のジャンルは除く）。</p>' +
    '<h3 class="wes-set-title">判定に使う言葉<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'判定に使う言葉\', event)" title="クリックで「判定に使う言葉」をコピー">□</span></h3>' +
    '<p class="panel-desc">全角半角・大文字小文字・空白・「-」「_」は区別しません（「Western music」は「western-music」「WESTERN MUSIC」にも当たります。「Western」で始まるソートキーにも当てたいときは「Western」を足してください）。</p>' +
    '<div class="wes-genre-chips">' + ws.map(function (g, i) { return '<span class="wes-chip">' + escapeHtml(g) + '<button class="wes-chip-x" data-ww-del="' + i + '" title="「' + escapeHtml(g) + '」を外す" aria-label="「' + escapeHtml(g) + '」を外す">×</button></span>'; }).join('') + '</div>' +
    '<div class="btn-row tag-set-add"><input type="text" class="form-input" id="wes-word-new" maxlength="40" placeholder="例：Western、洋楽ロック" aria-label="判定に使う言葉を足す">' +
      '<button class="btn-inline-small" id="wes-word-add">' + ICONS.plus + '追加</button><button class="btn-inline-small" id="wes-word-reset">初期に戻す</button></div>' +
    '<h3 class="wes-set-title">邦楽のジャンル（文字の種類で判定するときに使う）<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'邦楽のジャンル\', event)" title="クリックで「邦楽のジャンル」をコピー">□</span></h3>' +
    '<p class="panel-desc">このジャンルのアルバムは、名前が英字でも洋楽にしません（末尾の * は「〜で始まる」。例：J-* は J-Pop・J-Rock など）。大文字小文字・全角半角は区別しません。</p>' +
    '<div class="wes-genre-chips">' + gs.map(function (g, i) { return '<span class="wes-chip">' + escapeHtml(g) + '<button class="wes-chip-x" data-wg-del="' + i + '" title="「' + escapeHtml(g) + '」を外す" aria-label="「' + escapeHtml(g) + '」を外す">×</button></span>'; }).join('') + '</div>' +
    '<div class="btn-row tag-set-add"><input type="text" class="form-input" id="wes-genre-new" maxlength="40" placeholder="例：City Pop、K-*" aria-label="邦楽のジャンルを足す">' +
      '<button class="btn-inline-small" id="wes-genre-add">' + ICONS.plus + '追加</button><button class="btn-inline-small" id="wes-genre-reset">初期の一覧に戻す</button></div>' +
    '<h3 class="wes-set-title">洋楽の指定（手動）<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'洋楽の指定の一覧\', event)" title="クリックで「洋楽の指定の一覧」をコピー">□</span></h3>';
  var ak = Object.keys(am), rk = Object.keys(rm);
  if (!ak.length && !rk.length) h += '<p class="panel-meta">手動の指定はありません（アルバムの見出しの洋楽の指定ボタン・アルバム情報の編集・artist の画面で指定できます）。</p>';
  else {
    h += '<ul class="hidden-album-list">' +
      rk.map(function (k) { return '<li><span class="hidden-album-name">' + escapeHtml(k || '（アーティスト不明）') + '</span><span class="hidden-album-sub">アーティスト ・ ' + (rm[k] ? '洋楽にする' : '洋楽から外す') + '</span><button class="btn-inline-small" data-wr-off="' + escapeHtml(k) + '">解除</button></li>'; }).join('') +
      ak.map(function (k) { return '<li><span class="hidden-album-name">' + escapeHtml(names[k] || k.split('\u0001').slice(1).join(' ／ ') || k) + '</span><span class="hidden-album-sub">アルバム ・ ' + (am[k] ? '洋楽にする' : '洋楽から外す') + (library.tracks.length && !names[k] ? ' ・ <span class="text-warn">今の音楽フォルダには見つかりません</span>' : '') + '</span><button class="btn-inline-small" data-wa-off="' + escapeHtml(k) + '">解除</button></li>'; }).join('') +
      '</ul><div class="btn-row"><button class="btn-inline-small" id="wes-manual-clear">手動の指定をすべて解除</button></div>';
  }
  el.innerHTML = h;
  var redraw = function () { _wesCount.at = 0; renderSetWestern(); renderSidebarCounts(); };
  el.querySelectorAll('input[name="wes-method"]').forEach(function (r) { r.addEventListener('change', function () { db.westernMethod = r.value; saveDB(); redraw(); showToast('洋楽の判定の方法を「' + WESTERN_METHODS.filter(function (x) { return x[0] === r.value; })[0][1] + '」にしました（' + westernCount() + '枚）。'); }); });
  el.querySelectorAll('[data-ww-del]').forEach(function (b) { b.addEventListener('click', function () { var l = ws.slice(); l.splice(+b.getAttribute('data-ww-del'), 1); db.westernWords = l.length ? l : null; saveDB(); redraw(); }); });
  var addWord = function () {
    var inp = el.querySelector('#wes-word-new'), v = inp.value.trim().slice(0, 40);
    if (!v) return;
    if (ws.some(function (g) { return _wesKey(g) === _wesKey(v); })) { showToast('「' + v + '」は、もうあります。', true); return; }
    db.westernWords = ws.concat([v]); saveDB(); redraw();
    var ni = document.getElementById('wes-word-new'); if (ni) ni.focus();
  };
  el.querySelector('#wes-word-add').addEventListener('click', addWord);
  el.querySelector('#wes-word-new').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addWord(); } });
  el.querySelector('#wes-word-reset').addEventListener('click', function () { db.westernWords = null; saveDB(); redraw(); showToast('判定に使う言葉を初期（洋楽・Western music）に戻しました。'); });
  var at = el.querySelector('#wes-add-tag');
  if (at) at.addEventListener('click', function () {
    var used = (db.albumTags || []).map(function (t) { return t.color; });
    var color = (ALBUM_TAG_COLORS.filter(function (c) { return used.indexOf(c[0]) < 0; })[0] || ALBUM_TAG_COLORS[5])[0];
    if (!albumTagById('western')) db.albumTags = (db.albumTags || []).concat([{ id: 'western', name: '洋楽', color: color }]);
    saveDB(); redraw(); if (typeof renderSetAlbumTags === 'function') renderSetAlbumTags();
    showToast('アルバムのタグに「洋楽」を足しました。アルバムカードのソートキー・タグボタンで付けると、Western music に出ます。');
  });
  el.querySelectorAll('[data-wg-del]').forEach(function (b) { b.addEventListener('click', function () { var l = gs.slice(); l.splice(+b.getAttribute('data-wg-del'), 1); db.westernGenres = l; saveDB(); redraw(); }); });
  var add = function () {
    var inp = el.querySelector('#wes-genre-new'), v = inp.value.trim().slice(0, 40);
    if (!v) return;
    if (gs.some(function (g) { return _wesNorm(g) === _wesNorm(v); })) { showToast('「' + v + '」は、もうあります。', true); return; }
    db.westernGenres = gs.concat([v]); saveDB(); redraw();
    var ni = document.getElementById('wes-genre-new'); if (ni) ni.focus();
  };
  el.querySelector('#wes-genre-add').addEventListener('click', add);
  el.querySelector('#wes-genre-new').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  el.querySelector('#wes-genre-reset').addEventListener('click', function () { db.westernGenres = null; saveDB(); redraw(); showToast('邦楽のジャンルを初期の一覧に戻しました。'); });
  el.querySelectorAll('[data-wa-off]').forEach(function (b) { b.addEventListener('click', function () { setWesternAlbum(b.getAttribute('data-wa-off'), null); redraw(); }); });
  el.querySelectorAll('[data-wr-off]').forEach(function (b) { b.addEventListener('click', function () { setWesternArtist(b.getAttribute('data-wr-off'), null); redraw(); }); });
  var clr = el.querySelector('#wes-manual-clear');
  if (clr) clr.addEventListener('click', async function () {
    var ok = await showConfirm({ title: '洋楽の手動の指定をすべて解除', message: 'アルバム ' + ak.length + '枚・アーティスト ' + rk.length + '人の指定を解除し、自動の判定に戻します（ファイルは変わりません）。', okText: 'すべて解除' });
    if (!ok) return;
    db.westernAlbums = {}; db.westernArtists = {}; saveDB(); redraw(); showToast('洋楽の手動の指定をすべて解除しました。');
  });
}

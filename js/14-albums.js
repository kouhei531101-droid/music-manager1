/* =========================================================
   14-albums.js ― 「アルバム」画面
   ・アルバム一覧：アルバムカード（大きめのジャケット画像・アルバム名・アーティスト・曲数）のグリッド
     アルバムのフィルターバー：検索（アルバム名・アーティスト）と並べ替えの選択
       （標準＝アルバム名→アーティスト〔v2.3〕／アルバム名／アーティスト／自分で並べる＝カスタム順）
     カスタム順の編集モード：カードをドラッグ、または「← 前へ」「後ろへ →」で並べ替え（db.albumOrder に保存）
   ・アルバムの曲一覧：カードを押すと表示
     アルバムの見出し（ジャケット・アルバム名・アーティスト・曲数・合計時間・アルバムを再生・アルバム一覧に戻る）
     アルバムの曲リスト（曲順＝ディスク番号→トラック番号。行を押すとアルバムの曲順で連続再生）
   ・アルバムのまとめ方：アルバム名＋アルバムアーティスト（なければアーティスト）。
     タグにアルバム名が無い曲はフォルダ単位でまとめ、フォルダ名をアルバム名にする
   ・ジャケット画像は 13-artwork.js を使い回す（控え・見えている分だけ読み込み・仮画像）
   ========================================================= */

var albView = {
  query: '',
  openKey: null,     // 開いているアルバムの目印（null ならアルバム一覧）
  openPath: null,    // 開いたときの代表の曲（曲情報の読み込みで目印が変わっても同じアルバムを探せるように）
  limit: 200,        // 一度に並べるカードの数
  list: [],          // 今表示しているアルバム一覧
  current: null,     // 今開いているアルバム
  dragFrom: -1,      // カスタム順でドラッグ中のカードの位置
  pinDragFrom: -1,   // Pin の区切りの中でドラッグ中のカードの位置（v4.1）
  pinSorting: false, // Pin の並べ替え（見出しの「並べ替え」を押している間。v4.1）
  focusAfter: null   // 並べ替えたあと、動かしたカードのボタンにフォーカスを戻すため
};
var ALB_PAGE_SIZE = 200;
// 並べ方（v4.0 から設定は 29-album-sort.js の albumSortSpec()）：'custom'（自分で並べる）か 'fields'（項目で並べる）
function albumSortMode() {
  return albumSortSpec().mode === 'custom' ? 'custom' : 'fields';
}

PAGE_RENDERERS.albums = renderAlbumsPage;

/* ---------- 曲順 ---------- */
// ファイル名の先頭の数字（「03 曲名.mp3」→ 3、「1-08 曲名.mp3」→ ディスク1の8曲目）
function _albumFileNumbers(name) {
  var m = name.match(/^(\d{1,2})-(\d{1,3})(?=[\s._-])/);
  if (m) return { disc: +m[1], track: +m[2] };
  m = name.match(/^(\d{1,3})(?=[\s._-])/);
  if (m) return { disc: 0, track: +m[1] };
  return null;
}
// 曲順の目安：タグのディスク番号・トラック番号 → 無ければファイル名の先頭の数字
function albumTrackOrder(t) {
  var f = _albumFileNumbers(t.name);
  var track = t.tagTrack || (f ? f.track : 0);
  var disc = t.tagDisc || (f ? f.disc : 0) || 1;
  return { disc: disc, track: track, has: track > 0 };
}
// ディスク番号 → トラック番号。番号の無い曲は後ろにまとめてファイル名順
function compareAlbumTracks(a, b) {
  var ka = albumTrackOrder(a), kb = albumTrackOrder(b);
  if (ka.has !== kb.has) return ka.has ? -1 : 1;
  if (ka.has) {
    if (ka.disc !== kb.disc) return ka.disc - kb.disc;
    if (ka.track !== kb.track) return ka.track - kb.track;
  }
  return JA_COLLATOR.compare(a.path, b.path);
}

/* ---------- アルバムにまとめる ----------
   曲がどのアルバムに入るかの目印（v2.9 でコンピレーションをまとめるように見直し）：
     1. アルバムアーティストがある          → アルバム名＋アルバムアーティスト        'A|名前|アルバムアーティスト'（今までどおり）
     2. コンピレーションの印がある（TCMP・cpil・COMPILATION=1。同じフォルダの同じアルバム名の曲に1曲でも印があれば、その全曲）
                                            → アルバム名＋コンピレーション             'C|名前'
     3. 同じフォルダに、同じアルバム名でアーティストの違う曲がある（iTunes の Compilations/アルバム名 など）
                                            → アルバム名＋フォルダ                    'D|名前|フォルダ'
     4. それ以外                            → アルバム名＋曲のアーティスト            'A|名前|アーティスト'（今までどおり。
                                              別々のアーティストのフォルダの「Best」は別のアルバムのまま）
     アルバム名が無い曲                     → フォルダ                                'F|フォルダ'
   2・3 はフォルダごとの集計（_albumFolderMix()）が要る。曲情報が変わるたび（fillDisplayFields が library.metaRev を増やす）に作り直す */
var _albMix = { rev: -1, tracks: null, multi: null, comp: null };
function _albumFolderMix() {
  if (_albMix.tracks === library.tracks && _albMix.rev === library.metaRev) return _albMix;
  var first = new Map(), multi = new Set(), comp = new Set();
  library.tracks.forEach(function (t) {
    if (!t.tagAlbum || t.tagAlbumArtist) return;
    var k = t.folder + '\u0001' + t.tagAlbum, ar = t.tagArtist || '';
    if (t.tagCompilation) comp.add(k);
    if (!first.has(k)) first.set(k, ar);
    else if (first.get(k) !== ar) multi.add(k);
  });
  _albMix = { rev: library.metaRev, tracks: library.tracks, multi: multi, comp: comp };
  return _albMix;
}
function albumKeyOf(t) {
  if (!t.tagAlbum) return 'F\u0001' + t.folder;
  if (t.tagAlbumArtist) return 'A\u0001' + t.tagAlbum + '\u0001' + t.tagAlbumArtist;
  var mix = _albumFolderMix(), fk = t.folder + '\u0001' + t.tagAlbum;
  if (t.tagCompilation || mix.comp.has(fk)) return 'C\u0001' + t.tagAlbum;
  if (mix.multi.has(fk)) return 'D\u0001' + t.tagAlbum + '\u0001' + t.folder;
  return 'A\u0001' + t.tagAlbum + '\u0001' + (t.tagArtist || '');
}
// v2.8 までの目印（カスタム順・代表ジャケットの選択を引き継ぐときだけ使う）
function _albumKeyV28(t) {
  return t.tagAlbum ? 'A\u0001' + t.tagAlbum + '\u0001' + (t.tagAlbumArtist || t.tagArtist || '') : 'F\u0001' + t.folder;
}
// まとめ方が変わって目印が変わったアルバムの、カスタム順の位置・代表ジャケットの選択を引き継ぐ（v2.9）
//   分かれていた複数のアルバムのうち、カスタム順で先にあった位置を使う。今もある目印は変えない。変えたら true
function migrateAlbumKeys() {
  var current = new Set(), oldToNew = new Map();
  library.tracks.forEach(function (t) {
    var nk = albumKeyOf(t), ok = _albumKeyV28(t);
    current.add(nk);
    if (ok !== nk && !oldToNew.has(ok)) oldToNew.set(ok, nk);
  });
  if (!oldToNew.size) return false;
  var changed = false;
  if (db.albumOrder && db.albumOrder.length) {
    var seen = new Set(), out = [];
    db.albumOrder.forEach(function (k) {
      var nk = (!current.has(k) && oldToNew.has(k)) ? oldToNew.get(k) : k;
      if (nk !== k) changed = true;
      if (seen.has(nk)) { changed = true; return; }   // 同じアルバムになった2つ目以降は外す（先の位置を使う）
      seen.add(nk); out.push(nk);
    });
    db.albumOrder = out;
  }
  Object.keys(db.artistCovers || {}).forEach(function (n) {
    var v = db.artistCovers[n];
    if (v && v.album && !current.has(v.album) && oldToNew.has(v.album)) { v.album = oldToNew.get(v.album); changed = true; }
  });
  // 非表示のアルバム（v3.0）
  var hmap = {};
  (db.hiddenAlbums || []).forEach(function (h) { if (!current.has(h.key) && oldToNew.has(h.key)) hmap[h.key] = oldToNew.get(h.key); });
  if (Object.keys(hmap).length && renameHiddenAlbumKeys(hmap)) changed = true;
  // Pin（v3.4）
  var pmap = {};
  (db.pinnedAlbums || []).forEach(function (p) { if (!current.has(p.key) && oldToNew.has(p.key)) pmap[p.key] = oldToNew.get(p.key); });
  if (Object.keys(pmap).length && typeof renamePinnedAlbumKeys === 'function' && renamePinnedAlbumKeys(pmap)) changed = true;
  // ソートキー（v4.3）
  var smap = {};
  Object.keys(db.albumSortKeys || {}).forEach(function (k) { if (!current.has(k) && oldToNew.has(k)) smap[k] = oldToNew.get(k); });
  if (Object.keys(smap).length && typeof renameAlbumSortKeys === 'function' && renameAlbumSortKeys(smap)) changed = true;
  // タグ（v4.4）
  var tmap = {};
  Object.keys(db.albumTagOf || {}).forEach(function (k) { if (!current.has(k) && oldToNew.has(k)) tmap[k] = oldToNew.get(k); });
  if (Object.keys(tmap).length && typeof renameAlbumTagKeys === 'function' && renameAlbumTagKeys(tmap)) changed = true;
  // 洋楽の指定（v5.0）
  var wmap = {};
  Object.keys(db.westernAlbums || {}).forEach(function (k) { if (!current.has(k) && oldToNew.has(k)) wmap[k] = oldToNew.get(k); });
  if (Object.keys(wmap).length && typeof renameWesternAlbumKeys === 'function' && renameWesternAlbumKeys(wmap)) changed = true;
  // ソートキーの枠の代表ジャケット（v6.0。値がアルバムの目印）
  var cmap = {};
  Object.keys(db.skCovers || {}).forEach(function (k) { var v = typeof skCoverAlbumKeyOf === 'function' ? skCoverAlbumKeyOf(db.skCovers[k]) : db.skCovers[k]; if (v && !current.has(v) && oldToNew.has(v)) cmap[v] = oldToNew.get(v); });
  if (Object.keys(cmap).length && typeof renameSkCoverAlbumKeys === 'function' && renameSkCoverAlbumKeys(cmap)) changed = true;
  if (albView.openKey && !current.has(albView.openKey) && oldToNew.has(albView.openKey)) albView.openKey = oldToNew.get(albView.openKey);
  if (changed) saveDB();
  return changed;
}
// アルバムの数だけ数える（サイドバーの件数バッジ用。非表示のアルバムは数えない。v3.0）
function _countAlbums() {
  var s = new Set();
  library.tracks.forEach(function (t) { s.add(albumKeyOf(t)); });
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : null;
  if (hs && hs.size) hs.forEach(function (k) { s.delete(k); });
  return s.size;
}
function buildAlbums() {
  var map = new Map();
  library.tracks.forEach(function (t) {
    var key = albumKeyOf(t), name;
    if (t.tagAlbum) {
      name = t.tagAlbum;
    } else {   // アルバム名が無い曲はフォルダでまとめ、フォルダ名をアルバム名にする
      name = t.folder ? splitPath(t.folder).name : (fsa.folderName || '音楽フォルダ') + '（直下）';
    }
    var a = map.get(key);
    if (!a) {
      a = { key: key, name: name, byFolder: !t.tagAlbum, albumArtist: t.tagAlbum ? (t.tagAlbumArtist || '') : '', tracks: [], artists: [],
            compilation: key.charAt(0) === 'C' };
      map.set(key, a);
    }
    a.tracks.push(t);
    if (t.artist && a.artists.indexOf(t.artist) < 0) a.artists.push(t.artist);
  });
  var list = [];
  map.forEach(function (a) {
    a.tracks.sort(compareAlbumTracks);
    // 並べ替えに使うアーティスト（v2.3）：アルバムアーティスト → 無ければ曲順で1曲目のアーティスト
    var firstArtist = (a.tracks[0] && a.tracks[0].artist) || a.artists[0] || '';
    a.sortArtist = a.albumArtist || firstArtist;
    // 表示するアーティスト：曲ごとに違うときは「1曲目のアーティスト ほか」（並べ替えと同じ人を先に出す。v2.9 でまとめたアルバムも同じ）
    a.artist = a.albumArtist || (a.artists.length > 1 ? firstArtist + ' ほか' : (a.artists[0] || ''));
    a.multiArtist = !a.albumArtist && a.artists.length > 1;   // 曲ごとにアーティストが違う（コンピレーションなど）
    a.duration = a.tracks.reduce(function (s, t) { return s + (t.duration || 0); }, 0);
    _albumGenreYear(a);   // ジャンル・発売年（v3.1）
    a.cover = a.tracks[0];   // ジャケット画像は曲順で最初の曲から
    a.multiDisc = a.tracks.some(function (t) { return albumTrackOrder(t).disc > 1; });
    list.push(a);
  });
  return list;
}

// ジャンル・発売年（v3.1）：ジャンルは曲の数がいちばん多いもの（同じ数なら曲順で先のもの）、
//   発売年は同じならその年、違えば「最初–最後」。どちらも無い曲は数えない
function _albumGenreYear(a) {
  var count = {}, best = '', bestN = 0, ymin = 0, ymax = 0;
  a.tracks.forEach(function (t) {
    if (t.tagGenre) {
      var n = (count[t.tagGenre] || 0) + 1; count[t.tagGenre] = n;
      if (n > bestN) { bestN = n; best = t.tagGenre; }
    }
    if (t.tagYear) { if (!ymin || t.tagYear < ymin) ymin = t.tagYear; if (t.tagYear > ymax) ymax = t.tagYear; }
  });
  a.genre = best;
  a.year = ymin ? (ymin === ymax ? String(ymin) : ymin + '–' + ymax) : '';
  a.yearFirst = ymin || 0;   // 並べ替え用（範囲なら最初の年。無ければ 0。v4.0）
}

/* ---------- 並べ替え（文字の順番） ----------
   ① 英字 A-Z（大文字小文字・全角半角を区別しない）
   ② かな（ひらがな・カタカナは同じ扱いの50音順。濁音・半濁音・小さい字は元の字の近く）
   ③ その他（漢字・数字・記号など。文字コード順）
   先頭の空白・記号（「[Ado2024]」の「[」など）は飛ばして判定する。空欄は最後 */
var _ALB_COLLATOR = new Intl.Collator('ja', { numeric: true });
function albumTextKey(s) {
  var raw = String(s || '').normalize('NFKC').trim();   // NFKC：全角英数→半角、半角カナ→全角
  if (!raw) return { empty: true, cat: 9, norm: '', raw: '' };
  var base = raw.replace(/^[\s\p{P}\p{S}]+/u, '') || raw;   // 先頭の空白・記号を飛ばす（全部記号ならそのまま）
  var norm = base.toLowerCase().replace(/[\u30A1-\u30F6]/g, function (c) {   // カタカナ → ひらがな
    return String.fromCharCode(c.charCodeAt(0) - 0x60);
  });
  var c0 = norm.charAt(0);
  var cat = /[a-z]/.test(c0) ? 0 : (/[\u3041-\u3096\u309D\u309E]/.test(c0) ? 1 : 2);
  return { empty: false, cat: cat, norm: norm, raw: raw };
}
function compareAlbumText(x, y) {
  if (x.empty !== y.empty) return x.empty ? 1 : -1;
  if (x.cat !== y.cat) return x.cat - y.cat;
  var r;
  if (x.cat === 2) r = x.norm < y.norm ? -1 : (x.norm > y.norm ? 1 : 0);   // その他：文字コード順
  else r = _ALB_COLLATOR.compare(x.norm, y.norm);                            // 英字・かな：辞書の順
  if (!r) r = x.raw < y.raw ? -1 : (x.raw > y.raw ? 1 : 0);                // 同じなら元の文字で（安定した順に）
  return r;
}
function _prepareAlbumSortKeys(albums) {
  albums.forEach(function (a) {
    a._skArtist = albumTextKey(a.sortArtist);   // 「ほか」は付けずに比べる
    a._skName = albumTextKey(a.name);
    a.sortKey = typeof getAlbumSortKey === 'function' ? getAlbumSortKey(a.key) : '';   // ソートキー（v4.3）
    a._skSort = albumTextKey(a.sortKey);
    var tg = typeof albumTagOf === 'function' ? albumTagOf(a.key) : null;   // タグ（v4.4）
    a.tagName = tg ? tg.name : '';
    a._tagOrd = tg ? albumTagOrder(a.key) : -1;
    a._skGenre = albumTextKey(a.genre);   // ジャンル（v4.6）
  });
}
// 標準の並び（v2.3）：① アルバム名 → ② アーティスト（アルバムアーティスト、無ければ曲順で1曲目のアーティスト）
function compareAlbumsStandard(a, b) {
  var r = compareAlbumText(a._skName, b._skName);
  if (!r) r = compareAlbumText(a._skArtist, b._skArtist);
  if (!r) r = a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
  return r;
}
// カスタム順：保存した順に並べ、入っていない新しいアルバムは末尾に標準の並びで足す
function _applyCustomOrder(standardSorted) {
  var pos = new Map();
  (db.albumOrder || []).forEach(function (k, i) { if (!pos.has(k)) pos.set(k, i); });
  var known = standardSorted.filter(function (a) { return pos.has(a.key); })
    .sort(function (a, b) { return pos.get(a.key) - pos.get(b.key); });
  var added = standardSorted.filter(function (a) { return !pos.has(a.key); });
  return known.concat(added);
}
function getAlbumList(albums) {
  _prepareAlbumSortKeys(albums);
  var mode = albumSortMode();
  // 非表示のアルバム（v3.0）：ふつうは外す。「非表示のアルバム」の切り替えがオンのときは、非表示のアルバムだけ
  var hs = hiddenAlbumKeys();
  var arr = hs.size || albView.showHidden
    ? albums.filter(function (a) { return albView.showHidden ? hs.has(a.key) : !hs.has(a.key); })
    : albums.slice();
  var q = mode === 'custom' ? '' : albView.query.trim().toLowerCase();   // カスタム順の編集中は検索しない
  // タグの絞り込み（v4.4。カスタム順の編集中はしない）
  var tf = mode === 'custom' || typeof albumTagFilter !== 'function' ? '' : albumTagFilter();
  if (tf) arr = arr.filter(function (a) { return albumMatchesTagFilter(a, tf); });
  // ジャンルの絞り込み（v4.6。カスタム順の編集中はしない）
  var gf = mode === 'custom' || typeof albumGenreFilter !== 'function' ? '' : albumGenreFilter();
  if (gf) arr = arr.filter(function (a) { return albumMatchesGenreFilter(a, gf); });
  var terms = q ? q.split(/\s+/) : [];
  if (terms.length) {
    // まとめたアルバム（コンピレーション）は、参加しているどのアーティストの名前でも見つかる（v2.9）
    // ソートキー（v4.3）・タグ名（v4.4）・ジャンル（v4.6）でも見つかる
    arr = arr.filter(function (a) { var h = (a.name + ' ' + a.artist + ' ' + a.artists.join(' ') + (a.sortKey ? ' ' + a.sortKey : '') + (a.tagName ? ' ' + a.tagName : '') + (a.genre ? ' ' + a.genre : '')).toLowerCase(); return terms.every(function (w) { return h.indexOf(w) >= 0; }); });
  }
  if (mode === 'custom') return _applyCustomOrder(arr.sort(compareAlbumsStandard));
  // 項目で並べる（v4.0）：チェックした項目を優先の順に。全部同じなら標準の並び
  arr.sort(albumComparatorFor(albumSortSpec().fields));
  return arr;
}

/* ---------- 描画 ---------- */
function renderAlbumsPage() {
  renderAlbumSortButton();   // 並べ替えボタン（v4.0）
  if (typeof renderAlbumTagFilter === 'function') renderAlbumTagFilter();   // タグの絞り込み（v4.4）
  if (typeof renderAlbumGroupSelect === 'function') renderAlbumGroupSelect();   // グループの切り替え（v5.3）
  var body = document.getElementById('alb-body');
  var countEl = document.getElementById('alb-count');
  var filterBar = document.getElementById('alb-filter-bar');
  _setAlbumBackBtn(false);
  if (!isConnected()) {
    body.innerHTML = welcomeCardHtml();
    countEl.textContent = '';
    filterBar.hidden = true;
    return;
  }
  if (!library.scanned) {
    body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>';
    countEl.textContent = '';
    filterBar.hidden = true;
    return;
  }
  var albums = buildAlbums();
  var hiddenN = countHiddenAlbumsPresent(albums);
  if (typeof renderAlbumGenreFilter === 'function') renderAlbumGenreFilter(albums);   // ジャンルの絞り込み（v4.6）
  var visibleN = albums.length - hiddenN;   // ヘッダーの件数は非表示のアルバムを除く（v3.0）
  countEl.textContent = visibleN + '枚';
  renderHiddenAlbumsToggle(albums);

  // アルバムの曲一覧（開いているとき）
  if (albView.openKey) {
    var a = null;
    for (var i = 0; i < albums.length; i++) if (albums[i].key === albView.openKey) { a = albums[i]; break; }
    if (!a && albView.openPath) {   // 曲情報を読み込んだ結果まとめ方が変わったときは、代表の曲を含むアルバムを探す
      for (var j = 0; j < albums.length && !a; j++) {
        if (albums[j].tracks.some(function (t) { return t.path === albView.openPath; })) a = albums[j];
      }
    }
    if (a) { albView.openKey = a.key; filterBar.hidden = true; _setAlbumBackBtn(true); renderAlbumDetail(a, body); return; }
    albView.openKey = null;
  }

  // アルバム一覧
  _setAlbumBackBtn(false);
  filterBar.hidden = false;
  albView.current = null;
  // Pin のみ（v4.1）：Pin したアルバムだけを並べる（非表示のアルバムを見ている間は効かない）
  var pinPresentN = pinnedAlbumsPresentCount(albums);
  var pinOnly = isPinOnlyActive(pinPresentN);
  renderPinOnlyToggle(pinPresentN);
  var custom = albumSortMode() === 'custom' && !albView.showHidden && !pinOnly;   // 非表示のアルバム・Pin のみを見ている間は、カスタム順の編集はしない
  _updateAlbumSearchBox(custom);
  var list = getAlbumList(albums);
  // Pin（v3.4）：先頭の「Pin の区切り」の下に並べ、通常の一覧には重ねて出さない（非表示のアルバムを見ている間は分けない）
  var sp = albView.showHidden ? { pinned: [], rest: list } : splitPinnedAlbums(list);
  albView.pinned = sp.pinned;
  if (sp.pinned.length < 2) albView.pinSorting = false;
  var fullList = pinOnly ? sp.pinned : list;
  list = pinOnly ? [] : sp.rest;
  // グループ表示（v5.3。38-album-groups.js）：並べ替えたあとの一覧をグループに分け、グループの順につなげたものを albView.list にする
  var grouped = typeof albumGroupActive === 'function' && albumGroupActive(custom, pinOnly) && list.length;
  albView.groups = grouped ? albumGroupsOf(list) : null;
  if (grouped) list = [].concat.apply([], albView.groups.map(function (g) { return g.albums; }));
  // ソートキーのまとまり（v5.4）：同じソートキーのアルバムを、最初に出てくる位置に集める（albView.list もその順）
  var clustered = !grouped && typeof albumClusterActive === 'function' && albumClusterActive(custom, pinOnly) && list.length;
  albView.clusters = clustered ? albumSortKeyClusters(list) : null;
  if (clustered) list = [].concat.apply([], albView.clusters.map(function (it) { return it.cluster ? it.cluster.albums : [it.album]; }));
  albView.list = list;
  if (albView.showHidden) countEl.textContent = '非表示 ' + hiddenN + '枚';
  else if (pinOnly) countEl.textContent = 'Pin ' + (albView.query.trim() ? sp.pinned.length + '枚 / 全' + pinPresentN + '枚' : pinPresentN + '枚');
  else if (!custom && (albView.query.trim() || (typeof albumTagFilter === 'function' && albumTagFilter()) || (typeof albumGenreFilter === 'function' && albumGenreFilter()))) countEl.textContent = fullList.length + '枚 / 全' + visibleN + '枚';
  if (!fullList.length) {
    body.innerHTML = '<div class="empty-msg">' + (pinOnly ? '検索に当てはまる Pin のアルバムがありません。' : albView.showHidden ? (albView.query.trim() ? '検索に当てはまる非表示のアルバムがありません。' : '非表示のアルバムはありません。')
      : visibleN ? '検索に当てはまるアルバムがありません。' : albums.length ? 'すべてのアルバムを非表示にしています（「非表示のアルバム」から戻せます）。' : '曲が見つかりませんでした。') + '</div>';
    return;
  }
  var shown = custom ? list : list.slice(0, albView.limit);   // カスタム順の編集中は全部並べる（どこへでも動かせるように）
  var h = '';
  if (sp.pinned.length) {   // Pin の区切り（v3.4）
    var ps = albView.pinSorting;
    h += '<div class="album-section-head album-pin-head"><span class="album-section-icon">' + ICONS.pin + '</span>Pin<span class="album-section-count">' + sp.pinned.length + '枚</span>' +
      // Pin の並べ替えボタン（v4.1）：押すと「← 前へ」「後ろへ →」で動かせる（タッチの画面用。パソコンはそのままドラッグでも動かせる）
      (sp.pinned.length > 1 ? '<span class="pin-sort-wrap"><button class="btn-inline-small pin-sort-btn' + (ps ? ' active' : '') + '" data-act="pin-sort" aria-pressed="' + ps + '" title="' +
        (ps ? 'Pin の並べ替えを終わる' : 'Pin したアルバムの順番を変える（パソコンはカードをドラッグしても動かせます）') + '">' + (ps ? '完了' : ICONS.grip + '並べ替え') + '</button>' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'Pin の並べ替えボタン\', event)" title="クリックで「Pin の並べ替えボタン」をコピー">□</span></span>' : '') +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-6px;right:0" onclick="copyUiLabel(\'Pin の区切り\', event)" title="クリックで「Pin の区切り」をコピー">□</span></div>' +
      (ps ? '<p class="pin-sort-hint">カードをドラッグするか「←」「→」で順番を変えます。並びは自動で保存されます（tools の「Pin のアルバム」と同じ順番）。</p>' : '') +
      '<div class="album-grid album-pin-grid' + (ps ? ' is-editing' : '') + '">' + sp.pinned.map(function (a, i) { return _albumCardHtml(a, i, false, sp.pinned.length, true); }).join('') + '</div>' +
      (list.length ? '<div class="album-section-head">アルバム<span class="album-section-count">' + (fullList.length - sp.pinned.length) + '枚</span></div>' : '');
  }
  if (custom) {
    // カスタム順の編集モード
    h += '<div class="album-custom-bar">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'カスタム順の編集モード\', event)" title="クリックで「カスタム順の編集モード」をコピー">□</span>' +
      '<div class="album-custom-text"><strong>カスタム順の編集モード</strong>　カードをドラッグするか、「← 前へ」「後ろへ →」で並べ替えます。並びは自動で保存されます（この間、検索はお休み）。' +
      '<br><span class="dialog-hint">カスタム順に入っていない新しいアルバムは、末尾に標準の並びで追加されます。</span></div>' +
      '<button class="btn-inline-small" data-act="reset-custom">' + ICONS.undo + '標準の並びに戻す</button>' +
      '</div>';
  }
  if (albView.groups) {   // グループ表示（v5.3）
    var gh = albumGroupedHtml(albView.groups, albView.limit);
    h += gh.html;
    if (gh.openTotal > gh.shown) h += loadMoreHtml('alb-more', gh.openTotal - gh.shown, '枚');
  } else if (albView.clusters) {   // ソートキーのまとまり（v5.4）
    var ch = albumClusterGridHtml(albView.clusters, albView.limit);
    h += ch.html;
    if (ch.total > ch.shown) h += loadMoreHtml('alb-more', ch.total - ch.shown, '枚');
  } else {
  if (list.length) h += '<div class="album-grid album-main-grid' + (custom ? ' is-editing' : '') + '">' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'アルバム一覧\', event)" title="クリックで「アルバム一覧」をコピー">□</span>';
  if (list.length) {
    h += shown.map(function (a, i) { return _albumCardHtml(a, i, custom, shown.length); }).join('');
    h += '</div>';
  }
  if (list.length > shown.length) h += loadMoreHtml('alb-more', list.length - shown.length, '枚');
  }
  h += '<p class="lib-legend">うすい文字のアルバム名は、曲にアルバム名のタグが無かったためフォルダ名を使っています。</p>';
  body.innerHTML = h;
  artObserve(body);   // 見えているカードのジャケット画像だけ読み込む
  watchLoadMore('alb', document.getElementById('alb-more'), albLoadMore);
  if (albView.focusAfter) {   // 前へ・後ろへで動かしたあと、同じボタンにフォーカスを戻す
    var fb = body.querySelector('[data-act="' + albView.focusAfter.act + '"][data-i="' + albView.focusAfter.i + '"]');
    if (fb && !fb.disabled) fb.focus();
    albView.focusAfter = null;
  }
}

// アルバムカード1枚（カスタム順の編集中は、ドラッグできる形と前へ・後ろへボタン）
// pinSection：Pin の区切りの中のカード（data-pin-album。v3.4）
function _albumCardHtml(a, i, custom, total, pinSection) {
  var pinSort = pinSection && albView.pinSorting;   // Pin の並べ替え中（v4.1）：カードのボタンは出さない
  if (pinSort) custom = true;
  var inner =
    // ジャケット＋カードの再生ボタン・Pin ボタン（v3.5）・非表示ボタン（v3.6）。27-card-actions.js。
    // カスタム順の編集中はボタンを出さない（Pin 中の目印だけ）。非表示のアルバムを見ているときは再生と「表示に戻す」
    albumCardArtHtml(a, { play: !custom, pin: !custom && !albView.showHidden, hide: custom ? false : (albView.showHidden ? 'unhide' : 'hide'),
      sortkey: !custom && !albView.showHidden, labels: i === 0 && !pinSection }) +   // ソートキーボタン（v4.3）
    '<span class="album-card-name' + (a.byFolder ? ' guessed' : '') + '">' + escapeHtml(a.name) + '</span>' +
    // タグのバッジ（v4.4）とソートキー（v4.3）：入っていれば、アルバム名の下に小さく
    ((typeof albumTagOf === 'function' && albumTagOf(a.key)) || getAlbumSortKey(a.key) ? '<span class="album-card-labels">' + (typeof albumTagBadgeHtml === 'function' ? albumTagBadgeHtml(a.key) : '') + albumCardSortKeyHtml(a) + '</span>' : '') +
    '<span class="album-card-artist">' + escapeHtml(a.artist || '　') + '</span>' +
    // 曲数の行に、ジャンル・発売年（v4.6。33-album-genre.js）を続ける
    '<span class="album-card-count" title="' + albumCardCountTitle(a, a.tracks.length + '曲' + (a.byFolder ? ' ・ フォルダでまとめたアルバム' : '')) + '">' + a.tracks.length + '曲' + (a.byFolder ? ' ・ フォルダでまとめたアルバム' : '') + albumCardGenreHtml(a) + '</span>';
    // 非表示のアルバムを見ているときの「表示に戻す」は、v3.6 からジャケットの右上のボタン（カードの非表示ボタンと同じ位置）
  var title = escapeHtml(a.name + (a.artist ? ' ／ ' + a.artist : ''));
  // Pin の区切りのカード：ドラッグで Pin の中だけ並べ替えられる（v4.1。data-pin-drag）
  if (pinSort) {
    return '<div class="album-card" draggable="true" data-pin-album="' + i + '" data-pin-drag="1" title="' + title + '（ドラッグで並べ替え）">' + inner +
      '<span class="album-move-btns pin-move-btns">' +
        '<button class="btn-inline-small" data-act="pin-move-prev" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="1つ前へ" aria-label="1つ前へ">←</button>' +
        '<button class="btn-inline-small" data-act="pin-move-next" data-i="' + i + '"' + (i === total - 1 ? ' disabled' : '') + ' title="1つ後ろへ" aria-label="1つ後ろへ">→</button>' +
      '</span></div>';
  }
  if (pinSection) return '<button class="album-card" draggable="' + (total > 1) + '" data-pin-album="' + i + '"' + (total > 1 ? ' data-pin-drag="1"' : '') + ' title="' + title + '">' + inner + '</button>';
  if (custom) {
    return '<div class="album-card" draggable="true" data-album="' + i + '" title="' + title + '（ドラッグで並べ替え）">' + inner +
      '<span class="album-move-btns">' +
        '<button class="btn-inline-small" data-act="move-prev" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="1つ前へ">← 前へ</button>' +
        '<button class="btn-inline-small" data-act="move-next" data-i="' + i + '"' + (i === total - 1 ? ' disabled' : '') + ' title="1つ後ろへ">後ろへ →</button>' +
      '</span></div>';
  }
  return '<button class="album-card" data-album="' + i + '" title="' + title + '">' + inner + '</button>';
}
// 続きのアルバム（ALB_PAGE_SIZE 枚）をグリッドの最後に足す（v2.4）
function albLoadMore() {
  if (albView.groups || albView.clusters) {   // グループ表示（v5.3）・ソートキーのまとまり（v5.4）：枚数を増やして描き直す（スクロールの位置はそのまま）
    var y = window.scrollY; albView.limit += ALB_PAGE_SIZE; renderAlbumsPage(); window.scrollTo(0, y); return;
  }
  var list = albView.list, from = albView.limit, to = Math.min(list.length, from + ALB_PAGE_SIZE);
  var grid = document.querySelector('#alb-body .album-main-grid'), more = document.getElementById('alb-more');
  if (!grid || from >= list.length) return;
  grid.insertAdjacentHTML('beforeend', list.slice(from, to).map(function (a, k) { return _albumCardHtml(a, from + k, false, list.length); }).join(''));
  albView.limit = to;
  artObserve(grid);
  if (!more) return;
  if (to >= list.length) { more.remove(); return; }
  more.querySelector('.load-more-text').textContent = '下へスクロールすると続きを表示します（残り ' + (list.length - to) + ' 枚）';
  watchLoadMore('alb', more, albLoadMore);
}

// カスタム順の編集中は検索欄を使えなくする
function _updateAlbumSearchBox(custom) {
  var s = document.getElementById('alb-search');
  if (!s) return;
  s.disabled = custom;
  s.placeholder = custom ? 'カスタム順の編集中は検索できません' : 'アルバム名・アーティストで検索';
  if (custom && s.value) { s.value = ''; albView.query = ''; }
}

// アルバムの曲一覧
function renderAlbumDetail(a, body) {
  albView.current = a;
  // 古い版の控えの曲（ジャンル・発売年が無い）は、このアルバムの曲を先に補って、補えたら見出しを描き直す（v3.2）
  if (typeof readTrackDetailNow === 'function') {
    readTrackDetailNow(a.tracks, function () { if (currentPage === 'albums' && albView.current && albView.current.key === a.key) renderAlbumsPage(); });
  }
  var h = '<div class="album-detail">' +
    // アルバムの見出し
    '<div class="album-head">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'アルバムの見出し\', event)" title="クリックで「アルバムの見出し」をコピー">□</span>' +
      // v2.8：ジャケットの右の列の一番上にアルバム名（v2.1 の「幅いっぱいの1行」はやめて、見出しを低くした）
      '<div class="album-head-art-wrap">' +
        '<button class="album-head-art" data-act="art" title="ジャケットを大きく表示">' + artThumbHtml(a.cover, 'art-large') + '</button>' +
        // 見出しの写真の Pin ボタン（左上）・見出しの写真の非表示ボタン（右上）（v3.8。ボタン列から写真の上へ。いつも見える）
        '<span class="head-art-pin-wrap"><button class="art-overlay-btn head-art-pin' + (isAlbumPinned(a.key) ? ' is-pinned' : '') + '" data-act="pin-album" aria-pressed="' + isAlbumPinned(a.key) + '"' +
          ' title="' + (isAlbumPinned(a.key) ? 'Pin を外す（album の一覧の先頭から外す）' : 'Pin する（album の一覧の先頭に出す）') + '" aria-label="' + (isAlbumPinned(a.key) ? 'Pin を外す' : 'Pin する') + '">' + ICONS.pin + '</button>' +
          '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-12px;left:-2px" onclick="copyUiLabel(\'見出しの写真の Pin ボタン\', event)" title="クリックで「見出しの写真の Pin ボタン」をコピー">□</span></span>' +
        '<span class="head-art-hide-wrap">' + (isAlbumHidden(a.key)
          ? '<button class="art-overlay-btn head-art-hide is-hidden-state" data-act="unhide-album" aria-pressed="true" title="表示に戻す（このアルバムを album の一覧に戻す）" aria-label="表示に戻す">' + ICONS.eye + '</button>'
          : '<button class="art-overlay-btn head-art-hide" data-act="hide-album" aria-pressed="false" title="非表示にする（このアルバムを album の一覧に出さない。ファイルは変わりません。あとで戻せます）" aria-label="非表示にする">' + ICONS.eyeOff + '</button>') +
          '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-12px;right:-2px" onclick="copyUiLabel(\'見出しの写真の非表示ボタン\', event)" title="クリックで「見出しの写真の非表示ボタン」をコピー">□</span></span>' +
        // ジャケットの右下に重ねるボタン（YouTube検索ボタン・ジャケットの設定ボタン）。写真のボタンとは別の要素なので拡大表示と干渉しない
        '<div class="album-art-overlay">' +
          '<span class="album-yt-wrap"><button class="art-overlay-btn btn-youtube" data-act="youtube" title="YouTubeでアルバムを検索" aria-label="YouTubeでアルバムを検索">' + ICONS.youtube + '</button>' +
            '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;left:-4px" onclick="copyUiLabel(\'YouTube検索ボタン\', event)" title="クリックで「YouTube検索ボタン」をコピー">□</span></span>' +
          '<span class="album-art-set-wrap"><button class="art-overlay-btn album-art-set" data-act="set-art" title="ジャケットを設定（アルバムの全曲）" aria-label="ジャケットを設定（アルバムの全曲）">' + ICONS.image + '</button>' +
            '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;right:-4px" onclick="copyUiLabel(\'ジャケットの設定ボタン\', event)" title="クリックで「ジャケットの設定ボタン」をコピー">□</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="album-head-info">' +
        // アルバム名のすぐ右に Google検索ボタン（v3.8。アルバム名は幅に合わせて縮めるが、ボタンは縮めない）
        '<div class="album-head-title"><h2 class="album-head-name">' + escapeHtml(a.name) + '</h2>' +
          '<span class="album-google-wrap"><button class="album-google-btn" data-act="google" title="Googleでアルバムを検索" aria-label="Googleでアルバムを検索">' + ICONS.googleG + '</button>' +
          '<span class="ui-label-tag ui-label-tag-onlight" style="top:-8px;right:-10px" onclick="copyUiLabel(\'Google検索ボタン\', event)" title="クリックで「Google検索ボタン」をコピー">□</span></span>' +
          (typeof albumWesternButtonHtml === 'function' ? albumWesternButtonHtml(a) : '') + '</div>' +   // 洋楽の指定ボタン（v5.0）
        '<div class="album-head-artist">' + albumArtistLinkHtml(a) + '</div>' +   // アーティストへのリンク（v3.1）
        '<div class="album-head-meta">' +
          // ジャンル・発売年（v3.1。無ければ出さない）
          (typeof albumTagBadgeHtml === 'function' ? albumTagBadgeHtml(a.key, 'album-head-tag') : '') +   // タグのバッジ（v4.4）
          (typeof albumHeadSortKeyHtml === 'function' ? albumHeadSortKeyHtml(a) : '') +   // 見出しのソートキー（v4.9）
          ((a.genre || a.year) ? '<span class="album-genre-year" title="ジャンル・発売年">' + escapeHtml([a.genre, a.year].filter(Boolean).join(' ・ ')) + '</span> ・ ' : '') +
          a.tracks.length + '曲' + (a.duration ? ' ・ ' + formatTotalDuration(a.duration) : '') +
          (a.byFolder ? ' ・ <span class="album-head-byfolder">フォルダでまとめたアルバム</span>' : '') + '</div>' +
        '<div class="btn-row">' +
          '<button class="btn-save" data-act="play-all">' + ICONS.play + 'アルバムを再生</button>' +
          shuffleBtnHtml('data-act="shuffle-all"', 'このアルバムをばらばらの順で再生') +   // v7.5（47-shuffle-play.js）
          '<button class="btn-inline-small" data-act="add-all" title="アルバムの全曲をプレイリストに追加">+ playlist add</button>' +
          '<button class="btn-inline-small" data-act="edit-album">' + ICONS.edit + 'アルバム情報を編集</button>' +
          // フォルダを開くボタン・フォルダの場所をコピーボタン（v4.8。35-album-folder.js）
          (typeof albumFolderButtonsHtml === 'function' ? albumFolderButtonsHtml(a) : '') +
          // Pin ボタン（v3.4）・非表示にするボタン（v3.0）は、v3.8 で写真の上へ移した
        '</div>' +
      '</div>' +
    '</div>' +
    // アルバムの曲リスト
    '<div class="album-tracks-wrap">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'アルバムの曲リスト\', event)" title="クリックで「アルバムの曲リスト」をコピー">□</span>' +
      '<table class="lib-table album-track-table"><thead><tr>' +
        '<th class="col-no">No</th><th class="col-play"></th><th class="col-title">title</th><th class="col-dur">length</th><th class="col-yt"></th><th class="col-add"></th><th class="col-edit"></th>' +
      '</tr></thead><tbody>';
  var lastDisc = null;
  a.tracks.forEach(function (t, i) {
    var o = albumTrackOrder(t);
    if (a.multiDisc && o.has && o.disc !== lastDisc) {
      h += '<tr class="album-disc-row"><td colspan="7">ディスク ' + o.disc + '</td></tr>';
      lastDisc = o.disc;
    } else if (a.multiDisc && !o.has && lastDisc !== 'none') {
      h += '<tr class="album-disc-row"><td colspan="7">曲番号なし</td></tr>';
      lastDisc = 'none';
    }
    var no = o.has ? (a.multiDisc ? o.disc + '-' + pad2(o.track) : String(o.track)) : '—';
    var showArtist = t.artist && t.artist !== a.artist;
    // new songs のアルバム表示から開いたときは、その期間に追加した曲に「NEW」の印（v4.2）
    var isNew = albView.ret && albView.ret.page === 'newsongs' && t.firstSeen && t.firstSeen >= albView.ret.newSince;
    h += '<tr class="lib-row album-row' + (t.path === player.currentPath ? ' is-playing' : '') + '" data-i="' + i + '" title="押すと、ここからアルバムの曲順で再生">' +
      '<td class="col-no">' + no + '</td>' +
      '<td class="col-play"><button class="btn-icon btn-play-row" data-act="play" data-i="' + i + '" title="この曲から再生">' + ICONS.play + '</button></td>' +
      '<td class="col-title"><div class="lib-title-row"><div class="lib-title' + (t.titleGuessed ? ' guessed' : '') + '">' + escapeHtml(t.title) + '</div>' +
        (isNew ? '<span class="song-new-mark" title="new songs の期間に追加した曲（' + escapeHtml(formatDateShort(t.firstSeen)) + '）">NEW</span>' : '') + '</div>' +
        (showArtist ? '<div class="album-row-artist">' + artistLinkHtml(t) + '</div>' : '') + '</td>' +
      '<td class="col-dur">' + formatDuration(t.duration) + '</td>' +
      // 曲の YouTube ボタン（v7.7）：アーティスト名＋曲名で YouTube を検索（新しいタブ）。見出しの YouTube ボタンと同じ赤いアイコン
      '<td class="col-yt"><button class="btn-icon btn-row-youtube" data-act="track-youtube" data-i="' + i + '" title="' + escapeHtml('YouTubeで検索：' + trackSearchText(a, t)) + '" aria-label="' + escapeHtml('YouTubeで「' + trackSearchText(a, t) + '」を検索') + '">' + ICONS.youtube + '</button></td>' +
      '<td class="col-add"><button class="btn-icon" data-act="add" data-i="' + i + '" title="プレイリストに追加">' + ICONS.plus + '</button></td>' +
      '<td class="col-edit"><button class="btn-row-edit btn-row-edit-icon" data-act="edit" data-i="' + i + '" title="曲情報を編集" aria-label="曲情報を編集">' + ICONS.edit + '</button></td>' +
      '</tr>';
  });
  h += '</tbody></table></div></div>';
  body.innerHTML = h;
  artObserve(body);
  fitAlbumHeadName();
}

/* ---------- アルバム名の文字の大きさ（v2.1） ----------
   標準は「30文字が1行に収まる大きさ」（見出しの幅 ÷ 30。上限 32px）。
   それでも入らない長いアルバム名は、改行せずに文字を小さくして1行に収める（最小 13px）。それでも入らなければ「…」。
   ウィンドウ幅の変化・歌詞パネルの縮小／元の大きさの切り替えで計算し直す */
// アルバム名の文字の大きさ（v2.8 で見直し）：ジャケットの右の列の幅に ALBUM_NAME_CHARS 文字が入る大きさが標準（上限 MAX）。
//   それより長い名前は小さくして収め、MIN でも入らなければ「…」（全文は title）。
//   v2.1 は見出しの幅いっぱいで 30文字・13〜32px だったが、右の列は狭い（パソコン幅で約380px、スマホ幅で約220px）ので、
//   30文字を基準にすると 13px 前後になり小さすぎるため、20文字を基準にし、標準の大きさは 16〜28px、
//   長い名前を縮めるときは 13px まで（スマホ幅の短い名前も 16px は保つ）
var ALBUM_NAME_CHARS = 20, ALBUM_NAME_MAX_PX = 28, ALBUM_NAME_STD_MIN_PX = 16, ALBUM_NAME_MIN_PX = 13;
// v3.8：アルバム名のすぐ右に Google検索ボタンがあるので、使える幅＝行の幅－ボタン（と間）の幅 で計算する。
//   アルバム名は中身の幅まで（その右にボタン）、使える幅を超える分だけ縮み、最小でも入らなければ「…」
function fitAlbumHeadName() {
  var el = document.querySelector('#alb-body .album-head-name');
  if (!el) return;
  // 使える幅＝行の幅－（アルバム名の右のボタン〔Google検索ボタン・洋楽の指定ボタン（v5.0）〕の幅＋間＋左の余白）
  var row = el.parentElement, avail = el.clientWidth;
  if (row && row.classList.contains('album-head-title')) {
    avail = row.clientWidth;
    Array.prototype.forEach.call(row.children, function (c) { if (c !== el) avail -= c.offsetWidth + 6 + (parseFloat(getComputedStyle(c).marginLeft) || 0) + (parseFloat(getComputedStyle(c).marginRight) || 0); });
  }
  if (!avail || avail <= 0) return;
  var std = Math.min(ALBUM_NAME_MAX_PX, Math.max(ALBUM_NAME_STD_MIN_PX, Math.floor(avail / ALBUM_NAME_CHARS)));
  el.style.fontSize = std + 'px';
  if (el.scrollWidth > avail + 1) {
    var size = Math.max(ALBUM_NAME_MIN_PX, Math.floor(std * avail / el.scrollWidth));
    el.style.fontSize = size + 'px';
    while (size > ALBUM_NAME_MIN_PX && el.scrollWidth > avail + 1) { size--; el.style.fontSize = size + 'px'; }
  }
  el.title = el.textContent;   // 「…」になったときは、マウスを乗せると全文が見える
}
window.addEventListener('resize', debounce(fitAlbumHeadName, 120));

// 並べ替えの選択（v3.9 までのボタン列）は v4.0 で「並べ替えボタン」＋「並べ替えの設定ダイアログ」（29-album-sort.js）に置き換えた

/* ---------- 操作 ---------- */
// アルバムのヘッダーの「アルバム一覧に戻る」（アルバムの曲一覧を開いている間だけ）
function _setAlbumBackBtn(show) {
  var b = document.getElementById('alb-back-btn');
  if (!b) return;
  b.hidden = !show;
  // アーティストの画面から開いたときは、そのアーティストの画面に戻る（v2.4）
  var toArtist = albView.ret && albView.ret.page === 'artists';
  var toNew = albView.ret && albView.ret.page === 'newsongs';   // new songs のアルバム表示から開いたとき（v4.2）
  var toWes = albView.ret && albView.ret.page === 'western';   // Western music から開いたとき（v5.0）
  b.innerHTML = ICONS.up + (toArtist ? '「' + escapeHtml(albView.ret.artistLabel) + '」に戻る' : toNew ? 'new songs に戻る' : toWes ? 'Western music に戻る' : 'アルバム一覧に戻る');
}
// アルバムを開く。ret：戻り先（省略すると、今のアルバム一覧のスクロール位置と表示枚数を覚える）
function openAlbum(a, ret) {
  albView.ret = ret || { page: 'albums', scroll: window.scrollY, limit: albView.limit };
  albView.ret.key = a.key;
  albView.openKey = a.key;
  albView.openPath = a.cover ? a.cover.path : null;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}
// 戻る：開く前の一覧の位置（開いていたアルバムのカードが見える位置）に戻す。
// 検索・並べ替え・カスタム順の編集中の状態はそのまま（albView.query・db.settings に残っている）
function backToAlbumList() {
  var ret = albView.ret;
  albView.openKey = null;
  albView.openPath = null;
  albView.ret = null;
  if (ret && ret.page === 'artists' && typeof returnToArtistFromAlbum === 'function') { returnToArtistFromAlbum(ret); return; }
  if (ret && ret.page === 'newsongs' && typeof returnToNewSongsFromAlbum === 'function') { returnToNewSongsFromAlbum(ret); return; }   // v4.2
  if (ret && ret.page === 'western' && typeof returnToWesternFromAlbum === 'function') { returnToWesternFromAlbum(ret); return; }   // v5.0
  albView.limit = Math.max(ALB_PAGE_SIZE, (ret && ret.limit) || 0);
  renderAlbumsPage();
  if (!ret) return;
  var idx = albView.list.findIndex(function (x) { return x.key === ret.key; });
  // グループ表示（v5.3）：そのカードのグループを開き、そこまで描く
  if (albView.groups && idx >= 0 && typeof albumGroupEnsureVisible === 'function') { if (albumGroupEnsureVisible(ret.key)) renderAlbumsPage(); }
  else if (idx >= 0 && idx >= albView.limit && albumSortMode() !== 'custom') {
    // 自動読み込みでまだ表示していない所なら、そのカードまで読み込んでから戻す
    albView.limit = Math.ceil((idx + 1) / ALB_PAGE_SIZE) * ALB_PAGE_SIZE;
    renderAlbumsPage();
  }
  var pidx = idx < 0 ? (albView.pinned || []).findIndex(function (x) { return x.key === ret.key; }) : -1;   // Pin（v3.4）
  restoreListPosition(idx >= 0 ? document.querySelector('#alb-body [data-album="' + idx + '"]')
    : pidx >= 0 ? document.querySelector('#alb-body [data-pin-album="' + pidx + '"]') : null, ret.scroll);
}
// 一覧から消えるアルバムの隣（v6.4）：次のアルバム、最後なら前のアルバム。Pin の区切りの中なら Pin の中で（Pin が1枚だけなら通常の一覧の先頭）。
//   削除・非表示で一覧が変わる前に呼ぶ（albView.list・albView.pinned は最後に描いた一覧の並び）
function albumListNeighborKey(key) {
  var lists = [albView.pinned || [], albView.list || []];
  for (var j = 0; j < lists.length; j++) {
    var l = lists[j], i = l.findIndex(function (x) { return x.key === key; });
    if (i < 0) continue;
    var n = l[i + 1] || l[i - 1];
    if (n) return n.key;
    if (j === 0 && albView.list && albView.list[0]) return albView.list[0].key;
    return null;
  }
  return null;
}
// 一覧の中のそのアルバムのカードを、見える位置にして少しの間強調する（v6.4。scrollY：今の位置を保つとき）
function flashAlbumCard(key, scrollY) {
  var idx = (albView.list || []).findIndex(function (x) { return x.key === key; });
  if (idx >= 0 && idx >= albView.limit && !albView.groups && albumSortMode() !== 'custom') {
    albView.limit = Math.ceil((idx + 1) / ALB_PAGE_SIZE) * ALB_PAGE_SIZE; renderAlbumsPage();
  }
  var pidx = idx < 0 ? (albView.pinned || []).findIndex(function (x) { return x.key === key; }) : -1;
  var el = idx >= 0 ? document.querySelector('#alb-body [data-album="' + idx + '"]') : pidx >= 0 ? document.querySelector('#alb-body [data-pin-album="' + pidx + '"]') : null;
  if (el) restoreListPosition(el, scrollY);
}
// 開いていたアルバムが一覧から消えたとき（削除・非表示。v6.4）：一覧に戻り、隣のアルバムの位置へ（並べ替え・グループ・検索・絞り込み・読み込んだ数はそのまま）
function backToAlbumListNear(neighborKey) {
  var ret = albView.ret;
  if (ret && ret.page === 'albums' && neighborKey) ret.key = neighborKey;
  backToAlbumList();
}
// カスタム順：from 番目のカードを to 番目へ動かして保存
function moveAlbumCustom(from, to) {
  var list = albView.list;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  var keys = list.map(function (a) { return a.key; });
  var item = keys.splice(from, 1)[0];
  keys.splice(to, 0, item);
  // 今は見えていないアルバム（非表示のアルバム・別のフォルダへ移したものなど）は、今までの位置に残す（v3.0。戻したとき元の位置に出る）
  //   元にする並び：非表示のアルバムも含めた今のカスタム順（まだ保存していない所は標準の並び）＋ 今の音楽フォルダに無いアルバムの保存済みの順番
  var all = buildAlbums();
  _prepareAlbumSortKeys(all);
  all.sort(compareAlbumsStandard);
  var base = _applyCustomOrder(all).map(function (a) { return a.key; });
  var baseSet = new Set(base);
  (db.albumOrder || []).forEach(function (k) { if (!baseSet.has(k)) { base.push(k); baseSet.add(k); } });
  var shownSet = new Set(keys), out = [], vi = 0;
  base.forEach(function (k) { out.push(shownSet.has(k) ? keys[vi++] : k); });
  while (vi < keys.length) out.push(keys[vi++]);
  db.albumOrder = out;
  saveDB();
  renderAlbumsPage();
}
// 標準の並びに戻す（カスタム順を消す）
async function resetAlbumCustomOrder() {
  var ok = await showConfirm({
    title: '標準の並びに戻す',
    message: '自分で並べたアルバムの順番（カスタム順）を消して、標準の並び（アーティスト → アルバム名）に戻します。<br>' +
      '<span class="dialog-hint">音楽ファイルは変わりません。念のため、先に「設定・バックアップ」でバックアップしておくと元に戻せます。</span>',
    okText: '標準の並びに戻す',
    danger: true
  });
  if (!ok) return;
  db.albumOrder = [];
  saveDB();
  renderAlbumsPage();
  showToast('カスタム順を消して、標準の並びに戻しました（このまま並べ替えできます）。');
}
/* ---------- YouTube でアルバムを検索（新しいタブで開くだけ。結果は取り込まない） ----------
   アルバム名：タグ（アプリ内の上書き・編集後の値）。タグが無くフォルダでまとめたアルバムは、フォルダ名を使う
   アーティスト：アルバムアーティスト → 無ければ曲のアーティスト（タグ・上書きの値で、全曲が同じときだけ）。
                フォルダ名から推定したアーティストは使わない。無ければアルバム名だけで検索 */
function albumSearchInfo(a) {
  var artist = a.albumArtist || '';
  if (!artist) {
    var tagArtists = [];
    a.tracks.forEach(function (t) { if (t.tagArtist && tagArtists.indexOf(t.tagArtist) < 0) tagArtists.push(t.tagArtist); });
    if (tagArtists.length === 1) artist = tagArtists[0];
  }
  return { album: a.name, artist: artist };
}
function albumYouTubeUrl(a) {
  var info = albumSearchInfo(a);
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(info.album + (info.artist ? ' ' + info.artist : ''));
}
// Google でアルバムを検索（v3.8）。検索語は YouTube と同じ決まり（アルバム名＋アーティスト。アーティストが決まらなければアルバム名だけ）
function albumGoogleUrl(a) {
  var info = albumSearchInfo(a);
  return 'https://www.google.com/search?q=' + encodeURIComponent(info.album + (info.artist ? ' ' + info.artist : ''));
}
function searchAlbumOnGoogle(a) {
  if (!a) return;
  window.open(albumGoogleUrl(a), '_blank', 'noopener');
}
// 曲の検索語（v7.7）：その曲のアーティスト（タグ。無ければアルバムのアーティスト）＋曲名
function trackSearchText(a, t) {
  var artist = t.tagArtist || (a ? albumSearchInfo(a).artist : '') || '';
  return (artist ? artist + ' ' : '') + (t.title || '');
}
function searchTrackOnYouTube(a, t) {
  if (!t) return;
  window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(trackSearchText(a, t)), '_blank', 'noopener');
}
function searchAlbumOnYouTube(a) {
  if (!a) return;
  window.open(albumYouTubeUrl(a), '_blank', 'noopener');
}
function playAlbum(a, start) {
  if (!a || !a.tracks.length) return;
  playQueue(a.tracks.map(function (t) { return t.path; }), start || 0, 'アルバム：' + a.name);
}
// 再生中の行の色だけを付け直す
function updateAlbumPlayingHighlight() {
  var a = albView.current;
  if (!a) return;
  document.querySelectorAll('#alb-body .album-row').forEach(function (r) {
    var t = a.tracks[+r.getAttribute('data-i')];
    r.classList.toggle('is-playing', !!t && t.path === player.currentPath);
  });
}

/* ---------- 操作の受け付け（最初に1回だけ登録） ---------- */
function initAlbumsPage() {
  var search = document.getElementById('alb-search');
  search.addEventListener('input', debounce(function () {
    albView.query = search.value;
    albView.limit = ALB_PAGE_SIZE;
    renderAlbumsPage();
    window.scrollTo(0, 0);   // 検索を変えたら先頭から（v2.4）
  }, 180));

  document.getElementById('alb-sort-btn').addEventListener('click', openAlbumSortDialog);   // 並べ替えボタン（v4.0）

  var albBody = document.getElementById('alb-body');
  albBody.addEventListener('click', function (ev) {
    // アルバム一覧の中のボタン（カスタム順の前へ・後ろへ・標準の並びに戻す）
    var btn = ev.target.closest('[data-act]');
    var act0 = btn ? btn.getAttribute('data-act') : '';
    if (act0 === 'move-prev' || act0 === 'move-next') {
      var mi = +btn.getAttribute('data-i'), to = act0 === 'move-prev' ? mi - 1 : mi + 1;
      albView.focusAfter = { act: act0, i: to };
      moveAlbumCustom(mi, to);
      return;
    }
    if (act0 === 'reset-custom') { resetAlbumCustomOrder(); return; }
    // グループの見出し（v5.3）：押すと折りたたむ／開く。すべて開く／閉じる
    var gt = ev.target.closest('[data-group-toggle]');
    if (gt) {
      var gk = gt.getAttribute('data-group-toggle'), y0 = window.scrollY;
      setAlbumGroupClosed(gk, !albumGroupClosed(gk)); renderAlbumsPage(); window.scrollTo(0, y0);
      var nb = Array.prototype.find.call(albBody.querySelectorAll('[data-group-toggle]'), function (x) { return x.getAttribute('data-group-toggle') === gk; }); if (nb) nb.focus({ preventScroll: true });
      return;
    }
    var ga = ev.target.closest('[data-group-all]');
    if (ga && albView.groups) {
      var open = ga.getAttribute('data-group-all') === 'open';
      albView.groups.forEach(function (g) { setAlbumGroupClosed(g.key, !open); });
      albView.limit = ALB_PAGE_SIZE; var y1 = window.scrollY; renderAlbumsPage(); window.scrollTo(0, y1);
      return;
    }
    // Pin の並べ替え（v4.1）
    if (act0 === 'pin-sort') { togglePinSorting(); var sb = albBody.querySelector('[data-act="pin-sort"]'); if (sb) sb.focus(); return; }
    if (act0 === 'pin-move-prev' || act0 === 'pin-move-next') {
      var pi = +btn.getAttribute('data-i'), pto = act0 === 'pin-move-prev' ? pi - 1 : pi + 1;
      albView.focusAfter = { act: act0, i: pto };
      movePinnedAlbumShown(pi, pto);
      return;
    }
    var pcard = ev.target.closest('[data-pin-album]');   // Pin の区切りの中のカード（v3.4）
    if (pcard && albView.pinSorting) return;   // 並べ替え中は開かない
    if (pcard) { var pa = (albView.pinned || [])[+pcard.getAttribute('data-pin-album')]; if (pa) openAlbum(pa); return; }
    var card = ev.target.closest('[data-album]');
    if (card) { var a0 = albView.list[+card.getAttribute('data-album')]; if (a0) openAlbum(a0); return; }
    var a = albView.current;
    var el = ev.target.closest('[data-act]');
    if (el) {
      var act = el.getAttribute('data-act'), i = +el.getAttribute('data-i');
      if (act === 'more') { albLoadMore(); return; }   // 予備のボタン
      if (!a) return;
      if (act === 'play-all') playAlbum(a, 0);
      else if (act === 'shuffle-all') shufflePlay(function () { playAlbum(a, 0); });   // v7.5
      else if (act === 'play') playAlbum(a, i);
      else if (act === 'add') { if (a.tracks[i]) openAddToPlaylistDialog([a.tracks[i].path]); }
      else if (act === 'add-all') openAddToPlaylistDialog(a.tracks.map(function (t) { return t.path; }));
      else if (act === 'edit') { if (a.tracks[i]) openTrackTagEditor(a.tracks[i].path); }
      else if (act === 'edit-album') openAlbumTagEditor(a);
      else if (act === 'youtube') searchAlbumOnYouTube(a);
      else if (act === 'track-youtube') searchTrackOnYouTube(a, a.tracks[i]);   // 曲の YouTube ボタン（v7.7）
      else if (act === 'google') searchAlbumOnGoogle(a);
      else if (act === 'open-folder') albumFolderAction(a, 'open', el);   // v4.8
      else if (act === 'head-sortkey') openSortKeyPopup(a, el);   // 見出しのソートキー（v4.9）
      else if (act === 'western') openWesternMenu('album', a, el);   // 洋楽の指定（v5.0）
      else if (act === 'copy-folder') albumFolderAction(a, 'copy', el);
      else if (act === 'back') backToAlbumList();
      else if (act === 'art') openArtworkViewer(a.cover.path);
      else if (act === 'set-art') openArtworkEditor(a.tracks, 'アルバム「' + a.name + '」');
      else if (act === 'hide-album') hideAlbum(a);
      else if (act === 'pin-album') { togglePinAlbum(a); renderAlbumsPage(); }
      else if (act === 'unhide-album') { unhideAlbumFromUi(a.key, a.name); renderAlbumsPage(); }
      return;
    }
    // 行のどこを押しても、その曲からアルバムの曲順で再生
    var row = ev.target.closest('.album-row');
    if (row && a) playAlbum(a, +row.getAttribute('data-i'));
  });

  // カスタム順：アルバムカードをドラッグで並べ替え
  // Pin の区切りの中だけのドラッグ（v4.1）：通常の一覧とは行き来しない
  albBody.addEventListener('dragstart', function (ev) {
    var pc = ev.target.closest && ev.target.closest('[data-pin-drag]');
    if (!pc) return;
    albView.pinDragFrom = +pc.getAttribute('data-pin-album');
    pc.classList.add('dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'pin:' + albView.pinDragFrom); } catch (e) { /* 無視 */ }
  });
  albBody.addEventListener('dragover', function (ev) {
    var pc = ev.target.closest && ev.target.closest('[data-pin-drag]');
    if (!pc || albView.pinDragFrom < 0) return;
    ev.preventDefault();
    albBody.querySelectorAll('.album-card.drag-over').forEach(function (x) { if (x !== pc) x.classList.remove('drag-over'); });
    pc.classList.add('drag-over');
  });
  albBody.addEventListener('drop', function (ev) {
    var pc = ev.target.closest && ev.target.closest('[data-pin-drag]');
    if (!pc || albView.pinDragFrom < 0) return;
    ev.preventDefault();
    var from = albView.pinDragFrom;
    albView.pinDragFrom = -1;
    movePinnedAlbumShown(from, +pc.getAttribute('data-pin-album'));
  });
  albBody.addEventListener('dragstart', function (ev) {
    var card = ev.target.closest && ev.target.closest('.album-card[draggable="true"][data-album]');
    if (!card) return;
    albView.dragFrom = +card.getAttribute('data-album');
    card.classList.add('dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(albView.dragFrom)); } catch (e) { /* 無視 */ }
  });
  albBody.addEventListener('dragover', function (ev) {
    var card = ev.target.closest && ev.target.closest('.album-card[draggable="true"][data-album]');
    if (!card || albView.dragFrom < 0) return;
    ev.preventDefault();
    albBody.querySelectorAll('.album-card.drag-over').forEach(function (x) { if (x !== card) x.classList.remove('drag-over'); });
    card.classList.add('drag-over');
  });
  albBody.addEventListener('drop', function (ev) {
    var card = ev.target.closest && ev.target.closest('.album-card[draggable="true"][data-album]');
    if (!card || albView.dragFrom < 0) return;
    ev.preventDefault();
    var from = albView.dragFrom, to = +card.getAttribute('data-album');
    albView.dragFrom = -1;
    moveAlbumCustom(from, to);
  });
  albBody.addEventListener('dragend', function () {
    albView.dragFrom = -1;
    albView.pinDragFrom = -1;
    albBody.querySelectorAll('.dragging, .drag-over').forEach(function (x) { x.classList.remove('dragging', 'drag-over'); });
  });
}

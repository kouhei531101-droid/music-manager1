/* =========================================================
   93-anime-works.js ― Anime Songs の「作品」（スマホ版 v8.25.0。PC版 v8.7.77 の 84-anime-works.js と同じ作り・同じデータ）
   ・Anime Songs 画面の表示の切り替えに「作品」（初期）を足す。2段構え：
       「作品の一覧」（#ani-body の .ani-work-grid）：アニメ（作品）ごとの「作品カード」（画像・作品名・曲数）を並べる。最後に「作品名なし」
       「作品の画面」：カードを押すと開く。上に「作品の見出し」（#ani-work-head：大きな画像・作品名・曲数・
         「作品一覧に戻る」・連続再生・シャッフル再生・「画像を登録／画像を変更」・「画像を解除」・「作品名を変える」）、
         下に「作品の曲一覧」（曲の表。再生・プレイリストに追加・曲情報の編集・長押しのメニューは今までどおり。右の列「作品名」で曲ごとに変えられる）
       戻る：「作品一覧に戻る」・ヘッダーの戻るボタン・ブラウザの戻る（25-navigation.js の履歴に作品の画面も覚える）
   ・作品名の決め方（Anime Songs に入る曲ごと。上ほど強い）：
       ① 曲ごとの指定 db.animeSongWork = { 曲の相対パス: '作品名' }
       ② アルバムごとの指定 db.animeAlbumWork = { アルバムの目印: '作品名' }
       ③ 自動（tools で切れる。db.settings.animeWorkAuto が false でなければ）：アルバム名・曲名の
          「TVアニメ『…』」「アニメ「…」」「劇場版「…」」「映画『…』」や、ただの『…』の中の文字
       ④ どれも無ければ「作品名なし」（一覧の最後にまとめる）
     タグ（ジャンル・コメントなど）からは取らない（03-tag-reader.js はコメント・グループのタグを読んでいない。CODE_GUIDE の「洋楽の判定」の調べを参照）
     作品は作品名を _aniKey（全角半角・大文字小文字・空白・記号の一部を区別しない）でそろえた「作品の目印」でまとめる
   ・作品名の付け方：曲の長押しのメニュー（PC 幅は右クリック）の「Anime Songs の作品名を付ける…」（選んだ曲はまとめて）、作品の曲一覧の「作品名」の列のボタン
       →「作品名の入力ダイアログ」（作品名・候補・「この曲だけ／アルバムごと」）。空にして保存すると指定を解除（自動に戻す）。
     作品の見出しの「作品名を変える」：その作品の曲すべてに新しい作品名を付ける（アルバムの Anime Songs の曲がすべてこの作品ならアルバムごと、そうでなければ曲ごと）
   ・作品の画像（自分で登録＋自動で代用）：
       登録した画像 db.animeWorkImages = { 作品の目印: { name, type, w, h, at, data } }（長い辺 600px までに縮めた JPEG の data URL。
       69-np-bg.js の再生画面の背景の自分の画像と同じ形・同じ大きな保存場所〔52 の DB_HEAVY_KEYS〕。バックアップ・復元に含む）
       登録していない作品は、作品の中の最初のアルバムのジャケット（13-artwork.js のサムネイル）を出す。「作品名なし」は登録できない
       登録の入口：作品の見出しの「画像を登録」（ファイルを選ぶ）・見出しの画像へのドラッグ・作品の画面を開いているときの Ctrl+V。
       解除：見出しの「画像を解除」、tools の「Anime Songs の設定」の「作品の画像」の一覧
   ・保存データの名前・形はスマホ版と同じ（どちらのバックアップも、もう片方で復元できる）。古いデータ・バックアップには無いので空（01-core.js の normalizeAnimeWorks）
   ・読み取り専用モード（スマホ）でも使える（作品名・画像はアプリの中だけの設定で、音楽ファイルには書かないため。再生画面の背景の自分の画像と同じ決まり）
   ・アルバムの目印が変わったら renameAnimeWorkAlbumKeys()（14・17 から）、ファイル整理で曲が動いたら曲の作品名を付け替える
   ========================================================= */

var AW_NONE_LABEL = '作品名なし';
var AW_IMG_MAX = 600, AW_IMG_QUALITY = 0.85;   // 作品の画像：長い辺 600px・JPEG の画質 0.85（1枚おおよそ 30〜80KB）
var AW_NAME_MAX = 100;
var aniWork = { open: null, all: [], list: [], cur: null, songs: [], listScroll: 0, urls: {} };

/* ---------- 作品名 ---------- */
function animeWorkAuto() { return !(db.settings && db.settings.animeWorkAuto === false); }
// 『』「」の中の作品名を読み取る（上の形ほど先に見る）
var AW_GUESS_RES = [
  /(?:TV|ＴＶ|テレビ)?\s*アニメ(?:ーション)?\s*(?:映画)?\s*[「『]([^」』]{1,80})[」』]/,
  /(?:劇場版|映画)\s*[「『]([^」』]{1,80})[」』]/,
  /『([^』]{1,80})』/
];
function animeWorkGuessText(s) {
  s = String(s || '');
  if (!s) return '';
  for (var i = 0; i < AW_GUESS_RES.length; i++) { var m = AW_GUESS_RES[i].exec(s); if (m && m[1].trim()) return _awCleanName(m[1]); }
  return '';
}
function animeWorkGuess(t, a) { return animeWorkGuessText(a && a.name) || animeWorkGuessText(t.album) || animeWorkGuessText(t.title); }
function _awCleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, AW_NAME_MAX); }
// 曲の作品名：{ name, src: 'song' 曲の指定／'album' アルバムの指定／'auto' 自動／'' なし }
function animeWorkOf(t, a) {
  var s = (db.animeSongWork || {})[t.path];
  if (s) return { name: s, src: 'song' };
  var al = a ? (db.animeAlbumWork || {})[a.key] : '';
  if (al) return { name: al, src: 'album' };
  if (animeWorkAuto()) { var g = animeWorkGuess(t, a); if (g) return { name: g, src: 'auto' }; }
  return { name: '', src: '' };
}
// 作品の目印（'' は作品名なし）
function animeWorkKey(name) { return name ? (_aniKey(name) || String(name)) : ''; }
var AW_SRC_LABEL = { song: '曲の指定', album: 'アルバムの指定', auto: '自動で読み取り', '': 'なし' };
// Anime Songs に入る曲か（スマホ版は 85 の isAnimeTrack）
function _awIsAnime(t, a) { return isAnimeTrack(t, a); }
function _awAlbumMap() { var m = new Map(); buildAlbums().forEach(function (a) { m.set(a.key, a); }); return m; }

/* ---------- 作品にまとめる ---------- */
// [{ key, name, none, items:[{ t, a }], songs:[t], albums:[a], cover }]（作品名の順。作品名なしは最後）
function buildAnimeWorks() {
  var albums = buildAlbums();
  _prepareAlbumSortKeys(albums);
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var list = sortAlbumsBySetting(albums.filter(function (a) { return !hs.has(a.key); }), true);   // album の並べ替えの設定どおり（作品の中の曲の並び）
  var m = new Map();
  list.forEach(function (a) {
    a.tracks.forEach(function (t) {
      if (!_awIsAnime(t, a)) return;
      var w = animeWorkOf(t, a), k = animeWorkKey(w.name), x = m.get(k);
      if (!x) { x = { key: k, name: k ? w.name : AW_NONE_LABEL, none: !k, items: [], songs: [], albums: [], cover: null }; m.set(k, x); }
      x.items.push({ t: t, a: a }); x.songs.push(t);
      if (x.albums.indexOf(a) < 0) x.albums.push(a);
    });
  });
  var works = Array.from(m.values());
  works.forEach(function (x) { x.cover = (x.albums[0] && x.albums[0].cover) || x.songs[0]; });
  works.sort(function (x, y) { return (x.none - y.none) || JA_COLLATOR.compare(x.name, y.name); });
  return works;
}
function _awTerms() { var q = (animeView.query || '').trim().toLowerCase(); return q ? q.split(/\s+/) : []; }
function _awSongHit(t, terms) { return terms.every(function (w) { return t.search.indexOf(w) >= 0; }); }
function _awWorkHit(w, terms) {
  var n = w.name.toLowerCase();
  return terms.every(function (q) { return n.indexOf(q) >= 0 || w.songs.some(function (t) { return t.search.indexOf(q) >= 0; }); });
}

/* ---------- 作品の画像 ---------- */
function animeWorkImage(key) { var o = key ? (db.animeWorkImages || {})[key] : null; return o && o.data ? o : null; }
// data URL → 画面に出す URL（Blob の URL を作って使い回す。描き直すたびに長い data URL を HTML に入れないように）
function _awImgUrl(key) {
  var o = animeWorkImage(key);
  if (!o) return '';
  var c = aniWork.urls[key];
  if (c && c.at === o.at && c.len === o.data.length) return c.url;
  if (c) { try { URL.revokeObjectURL(c.url); } catch (e) { /* 無視 */ } }
  try {
    var mm = /^data:([^;]+);base64,(.*)$/.exec(o.data), bin = atob(mm[2]), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u8], { type: mm[1] }));
    aniWork.urls[key] = { at: o.at, len: o.data.length, url: url };
    return url;
  } catch (e) { return o.data; }
}
function _awForgetUrl(key) { var c = aniWork.urls[key]; if (c) { try { URL.revokeObjectURL(c.url); } catch (e) { /* 無視 */ } delete aniWork.urls[key]; } }
// 作品の画像の HTML（登録した画像。無ければジャケット）
function _awArtHtml(w, cls) {
  var u = w.key ? _awImgUrl(w.key) : '';
  if (u) return '<span class="art-thumb ' + cls + ' ani-work-pic"><img src="' + escapeHtml(u) + '" alt="" decoding="async"></span>';
  return artThumbHtml(w.cover, cls);
}
// 画像ファイル → 縮めた JPEG の data URL
function animeWorkShrink(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, AW_IMG_MAX / Math.max(w, h || 1));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var cx = cv.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cw, ch);   // 透明な所は白に（JPEG は透明を持てないため）
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      try { res({ data: cv.toDataURL('image/jpeg', AW_IMG_QUALITY), w: cw, h: ch }); } catch (e) { rej(e); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('画像として読めませんでした')); };
    img.src = url;
  });
}
function _awImgBytes(o) { return o && o.data ? Math.round((o.data.length - o.data.indexOf(',') - 1) * 0.75) : 0; }
async function animeWorkSetImage(w, file) {
  if (!w || w.none || !file) return;
  if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || '')) { showToast('画像のファイルを選んでください。', true); return; }
  var r;
  try { r = await animeWorkShrink(file); } catch (e) { showToast('画像を読めませんでした' + (e && e.message ? '（' + e.message + '）' : '') + '。', true); return; }
  if (!db.animeWorkImages || typeof db.animeWorkImages !== 'object' || Array.isArray(db.animeWorkImages)) db.animeWorkImages = {};
  var had = !!db.animeWorkImages[w.key];
  db.animeWorkImages[w.key] = { name: w.name, type: 'image/jpeg', w: r.w, h: r.h, at: nowIso(), data: r.data };
  saveDB();
  _awRedraw();
  showToast('「' + w.name + '」の画像を' + (had ? '変更' : '登録') + 'しました（' + r.w + '×' + r.h + '・約 ' + formatBytes(_awImgBytes(db.animeWorkImages[w.key])) + '）。');
}
function animeWorkPickImage(w) {
  if (!w || w.none) return;
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
  inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; inp.remove(); if (f) animeWorkSetImage(w, f); });
  document.body.appendChild(inp);
  inp.click();
}
async function animeWorkRemoveImage(key, name) {
  if (!animeWorkImage(key)) return;
  var ok = await showConfirm({ title: '作品の画像を解除', message: '「' + escapeHtml(name || key) + '」に登録した画像を外します（アプリに保存した縮小画像を消します。元の画像ファイルはそのままです）。<br>解除すると、作品の曲のジャケットを代わりに出します。', okText: '解除する', danger: true });
  if (!ok) return;
  delete db.animeWorkImages[key];
  _awForgetUrl(key);
  saveDB();
  _awRedraw();
  showToast('「' + (name || key) + '」の画像を解除しました。');
}

/* ---------- 作品名の指定 ---------- */
function _awSnapshot() { return { s: Object.assign({}, db.animeSongWork || {}), a: Object.assign({}, db.animeAlbumWork || {}), i: Object.assign({}, db.animeWorkImages || {}) }; }
function _awRestore(snap) { db.animeSongWork = snap.s; db.animeAlbumWork = snap.a; db.animeWorkImages = snap.i; saveDB(); _awRedraw(); }
function _awMaps() {
  ['animeSongWork', 'animeAlbumWork'].forEach(function (k) { if (!db[k] || typeof db[k] !== 'object' || Array.isArray(db[k])) db[k] = {}; });
}
// 描き直し（Anime Songs・tools を開いているとき）
function _awRedraw() {
  if (currentPage === 'anime') { var y = window.scrollY; renderAnimePage(); window.scrollTo(0, y); }
  if (currentPage === 'settings' && typeof renderSetAnime === 'function') renderSetAnime();
}
// 作品名の入力ダイアログ：paths の曲に作品名を付ける（空なら指定を解除）
async function openAnimeWorkNameDialog(paths, title) {
  paths = (paths || []).filter(function (p) { return library.byPath[p]; });
  if (!paths.length) return;
  var amap = _awAlbumMap(), tracks = paths.map(function (p) { return library.byPath[p]; });
  var albumKeys = [];
  tracks.forEach(function (t) { var k = albumKeyOf(t); if (albumKeys.indexOf(k) < 0) albumKeys.push(k); });
  var cur = tracks.length === 1 ? animeWorkOf(tracks[0], amap.get(albumKeys[0])) : null;
  var names = [];
  buildAnimeWorks().forEach(function (w) { if (!w.none) names.push(w.name); });
  var label = title || (tracks.length === 1 ? '「' + tracks[0].title + '」' : tracks.length + '曲');
  var anyAnime = tracks.some(function (t) { var a = amap.get(albumKeyOf(t)); return a && _awIsAnime(t, a); });
  var body = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'作品名の入力ダイアログ\', event)" title="クリックで「作品名の入力ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">対象：' + escapeHtml(label) + '（' + tracks.length + '曲）</p>' +
    (cur ? '<p class="dialog-hint">今の作品名：' + (cur.name ? '「' + escapeHtml(cur.name) + '」（' + AW_SRC_LABEL[cur.src] + '）' : AW_NONE_LABEL) + '</p>' : '') +
    (anyAnime ? '' : '<p class="dialog-hint text-warn">この曲は今 Anime Songs に入っていません。作品名は Anime Songs に入る曲だけに使います。</p>') +
    '<div class="form-group"><label for="ani-work-name-input">作品名（アニメの名前）</label>' +
      '<input type="text" class="form-input dialog-enter" id="ani-work-name-input" maxlength="' + AW_NAME_MAX + '" list="ani-work-name-list" autocomplete="off" value="' + escapeHtml(cur ? cur.name : '') + '" placeholder="例：けいおん！">' +
      '<datalist id="ani-work-name-list">' + names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join('') + '</datalist></div>' +
    '<div class="form-group"><label>付ける範囲</label><div class="te-western-opts">' +
      '<label class="dup-opt"><input type="radio" name="ani-work-scope" value="song" checked>この曲だけ（' + tracks.length + '曲）</label>' +
      '<label class="dup-opt"><input type="radio" name="ani-work-scope" value="album">アルバムごと（' + albumKeys.length + '枚の曲すべて）</label></div></div>' +
    '<p class="dialog-hint">空にして保存すると、指定を解除して自動（アルバム名・曲名の『』から読み取り）に戻します。「アルバムごと」にすると、そのアルバムの曲ごとの指定は外します。アプリの中だけの設定で、曲ファイルは変わりません。</p>' +
    '<div class="dialog-error" id="ani-work-name-error"></div>';
  var res = null;
  var v = await openDialog({
    title: 'Anime Songs の作品名', body: body, size: 'small',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '保存', value: 'ok', cls: 'btn-save', isDefault: true }],
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var sc = b.querySelector('input[name="ani-work-scope"]:checked');
      res = { name: _awCleanName(b.querySelector('#ani-work-name-input').value), scope: sc ? sc.value : 'song' };
      return true;
    }
  });
  if (v !== 'ok' || !res) return;
  var snap = _awSnapshot();
  _awMaps();
  if (res.scope === 'album') {
    albumKeys.forEach(function (k) {
      if (res.name) db.animeAlbumWork[k] = res.name; else delete db.animeAlbumWork[k];
      var a = amap.get(k);
      if (a) a.tracks.forEach(function (t) { delete db.animeSongWork[t.path]; });
    });
  } else {
    paths.forEach(function (p) { if (res.name) db.animeSongWork[p] = res.name; else delete db.animeSongWork[p]; });
  }
  saveDB();
  _awRedraw();
  showToast(label + 'の作品名を' + (res.name ? '「' + res.name + '」にしました' : '解除しました（自動に戻しました）') + (res.scope === 'album' ? '（アルバムごと）' : '') + '。', false,
    { label: '元に戻す', fn: function () { _awRestore(snap); } });
}
// 作品の見出しの「作品名を変える」：作品の曲すべてに新しい作品名を付ける
async function animeWorkRename(w) {
  if (!w) return;
  var v = await showPrompt({
    title: w.none ? '作品名を付ける' : '作品名を変える', label: '作品名（アニメの名前）', value: w.none ? '' : w.name, okText: '保存',
    message: 'この作品の ' + w.songs.length + '曲（アルバム ' + w.albums.length + '枚）に付けます。',
    hint: 'アルバムの Anime Songs の曲がすべてこの作品なら「アルバムごと」、そうでなければ「曲ごと」の指定になります。同じ名前の作品があれば、まとまります。曲ファイルは変わりません。',
    validate: function (x) { return _awCleanName(x) ? '' : '作品名を入れてください。'; }
  });
  if (v === null) return;
  var name = _awCleanName(v), nk = animeWorkKey(name);
  if (!w.none && name === w.name) return;
  var snap = _awSnapshot(), paths = new Set(w.songs.map(function (t) { return t.path; }));
  _awMaps();
  var doneAlbum = {};
  w.items.forEach(function (it) {
    var t = it.t, a = it.a, src = animeWorkOf(t, a).src;
    if (src === 'song') { db.animeSongWork[t.path] = name; return; }
    if (src === 'album') { db.animeAlbumWork[a.key] = name; return; }
    if (doneAlbum[a.key] === undefined) doneAlbum[a.key] = a.tracks.every(function (x) { return !_awIsAnime(x, a) || paths.has(x.path); });
    if (doneAlbum[a.key]) db.animeAlbumWork[a.key] = name; else db.animeSongWork[t.path] = name;
  });
  // 画像も新しい作品名へ（新しい名前の作品に画像が無いときだけ移す）
  if (w.key && nk !== w.key && db.animeWorkImages && db.animeWorkImages[w.key] && !db.animeWorkImages[nk]) {
    db.animeWorkImages[nk] = Object.assign({}, db.animeWorkImages[w.key], { name: name });
    delete db.animeWorkImages[w.key];
    _awForgetUrl(w.key);
  } else if (db.animeWorkImages && db.animeWorkImages[nk]) db.animeWorkImages[nk].name = name;
  aniWork.open = nk;
  saveDB();
  _awRedraw();
  showToast((w.none ? '作品名を「' : '作品名を「' + w.name + '」から「') + name + '」にしました（' + w.songs.length + '曲）。', false, { label: '元に戻す', fn: function () { aniWork.open = w.key; _awRestore(snap); } });
}
// アルバムの目印が変わったとき（14 の migrateAlbumKeys・17 の _renameAlbumKeysAfter から）
function renameAnimeWorkAlbumKeys(map) {
  var m = db.animeAlbumWork, ch = false;
  if (!m) return false;
  Object.keys(map).forEach(function (o) { var n = map[o]; if (!n || n === o || !m[o]) return; if (!m[n]) m[n] = m[o]; delete m[o]; ch = true; });
  return ch;
}

/* ---------- 画面 ---------- */
// 85 の renderAnimePage から（表示「作品」のとき）
function renderAnimeWorks() {
  var body = document.getElementById('ani-body'), countEl = document.getElementById('ani-count');
  var works = buildAnimeWorks(), terms = _awTerms();
  aniWork.all = works;
  if (aniWork.open !== null) {
    var w = works.filter(function (x) { return x.key === aniWork.open; })[0];
    if (w) { _awRenderWork(w, terms, body, countEl); return; }
    aniWork.open = null;
  }
  aniWork.cur = null;
  var list = terms.length ? works.filter(function (x) { return _awWorkHit(x, terms); }) : works;
  aniWork.list = list;
  var nSongs = works.reduce(function (s, x) { return s + x.songs.length; }, 0);
  countEl.textContent = list.length !== works.length ? list.length + '作品 / 全' + works.length + '作品' : works.length + '作品・' + nSongs + '曲';
  _awPlayBtns(list.length > 0);
  if (!list.length) {
    body.innerHTML = '<div class="empty-msg">' + (works.length ? '当てはまる作品がありません。' : (typeof _aniEmptyText === 'function' ? _aniEmptyText() : 'Anime Songs の曲がありません。')) + '</div>';
    return;
  }
  body.innerHTML = '<div class="album-grid ani-work-grid"><span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'Anime Songs の作品一覧\', event)" title="クリックで「Anime Songs の作品一覧」をコピー">□</span>' +
    list.map(_awCardHtml).join('') + '</div>' +
    '<p class="lib-legend">作品名は ①曲ごとの指定 ②アルバムごとの指定 ③アルバム名・曲名の『』（「TVアニメ「…」」なども）から自動で読み取り、の順で決めます。作品名が分からない曲は「' + AW_NONE_LABEL + '」にまとめます。' +
      '作品名は、曲の長押しのメニューの「Anime Songs の作品名を付ける…」や、作品の画面の曲の「作品名」ボタンで付けられます。画像は作品の画面の「画像を登録」で登録できます（登録していない作品はジャケットを出します）。</p>';
  artObserve(body);
}
function _awCardHtml(w, i) {
  return '<button type="button" class="album-card ani-work-card' + (w.none ? ' is-none' : '') + '" data-ani-work="' + i + '" title="' + escapeHtml(w.name + '（' + w.songs.length + '曲）') + '">' +
    _awArtHtml(w, 'art-card') +
    '<span class="album-card-name">' + escapeHtml(w.name) + '</span>' +
    '<span class="album-card-count">' + w.songs.length + '曲・アルバム ' + w.albums.length + '枚</span></button>';
}
function _awRenderWork(w, terms, body, countEl) {
  aniWork.cur = w;
  var songs = terms.length ? w.songs.filter(function (t) { return _awSongHit(t, terms); }) : w.songs;
  aniWork.songs = songs;
  countEl.textContent = songs.length !== w.songs.length ? songs.length + '曲 / 全' + w.songs.length + '曲' : w.songs.length + '曲';
  _awPlayBtns(songs.length > 0);
  var img = animeWorkImage(w.key);
  var head = '<section class="panel ani-work-head" id="ani-work-head">' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'作品の見出し\', event)" title="クリックで「作品の見出し」をコピー">□</span>' +
    '<div class="ani-work-head-art"' + (w.none ? '' : ' data-aw-drop="1" title="画像をここにドラッグしても登録できます"') + '>' + _awArtHtml(w, 'art-card') + '</div>' +
    '<div class="ani-work-head-text">' +
      '<button type="button" class="btn-inline-small ani-work-back" data-aw-act="back">' + ICONS.back + '作品一覧に戻る</button>' +
      '<h2 class="ani-work-title">' + escapeHtml(w.name) + '</h2>' +
      '<div class="ani-work-meta">' + w.songs.length + '曲・アルバム ' + w.albums.length + '枚 ・ 画像：' + (img ? '登録した画像' : w.none ? 'ジャケット（作品名なしは画像を登録できません）' : 'ジャケット（自動）') + '</div>' +
      '<div class="ani-work-btns">' +
        '<button type="button" class="btn-save" data-aw-act="play"' + (songs.length ? '' : ' disabled') + '>' + ICONS.play + '連続再生</button>' +
        '<button type="button" class="btn-inline-small pl-icon-btn shuffle-play-btn" data-aw-act="shuffle" title="シャッフル再生" aria-label="シャッフル再生"' + (songs.length ? '' : ' disabled') + '>' + ICONS.shuffle + '</button>' +
        (w.none ? '' : '<button type="button" class="btn-inline-small" data-aw-act="img">' + ICONS.image + (img ? '画像を変更' : '画像を登録') + '</button>' +
          (img ? '<button type="button" class="btn-inline-small" data-aw-act="img-off">画像を解除</button>' : '')) +
        '<button type="button" class="btn-inline-small" data-aw-act="rename">' + ICONS.edit + (w.none ? '作品名を付ける' : '作品名を変える') + '</button>' +
      '</div></div></section>';
  var shown = songs.slice(0, animeView.limit);
  var table = songs.length ? songTableHtml(shown, { extra: { head: '作品名', cell: function (t) {
    return '<button type="button" class="btn-inline-small ani-work-song-btn" data-aw-song="' + escapeHtml(t.path) + '" title="この曲の作品名を変える">作品名</button>';
  } } }) + (songs.length > shown.length ? loadMoreHtml('ani-more', songs.length - shown.length, '曲') : '') : '<div class="empty-msg">当てはまる曲がありません。</div>';
  body.innerHTML = head + '<div class="ani-work-songs"><span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'作品の曲一覧\', event)" title="クリックで「作品の曲一覧」をコピー">□</span>' + table + '</div>';
  artObserve(body);
  if (songs.length > shown.length) watchLoadMore('ani', document.getElementById('ani-more'), function () { animeView.limit += ANI_PAGE_SIZE; var y = window.scrollY; renderAnimePage(); window.scrollTo(0, y); });
}
function _awPlayBtns(on) {
  ['ani-play', 'ani-shuffle'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !on; });
}
// フィルターバーの連続再生・シャッフル再生（85 の _animePaths から）：作品の画面ならその作品の曲、一覧なら表示中の作品の曲を順に
function animeWorksPlayPaths() {
  if (aniWork.cur) return aniWork.songs.map(function (t) { return t.path; });
  var out = [];
  aniWork.list.forEach(function (w) { w.songs.forEach(function (t) { out.push(t.path); }); });
  return out;
}
function openAnimeWork(key) {
  aniWork.listScroll = window.scrollY;
  aniWork.open = key;
  animeView.limit = ANI_PAGE_SIZE;
  if (currentPage === 'anime') { renderAnimePage(); window.scrollTo(0, 0); }
}
function closeAnimeWork() {
  var key = aniWork.open;
  aniWork.open = null;
  animeView.limit = ANI_PAGE_SIZE;
  if (currentPage !== 'anime') return;
  renderAnimePage();
  var idx = aniWork.list.findIndex(function (x) { return x.key === key; });
  restoreListPosition(idx >= 0 ? document.querySelector('#ani-body [data-ani-work="' + idx + '"]') : null, aniWork.listScroll);
}
function _awPlay(shuffle) {
  var w = aniWork.cur; if (!w) return;
  var ps = aniWork.songs.map(function (t) { return t.path; });
  if (!ps.length) return;
  var go = function () { playQueue(ps, 0, 'Anime Songs：' + w.name); };
  if (shuffle) shufflePlay(go); else go();
}
function initAnimeWorks() {
  var body = document.getElementById('ani-body');
  if (!body) return;
  bindSongTable(body, function () { return _aniMode() === 'works' && aniWork.cur ? aniWork.songs : []; }, function () { return 'Anime Songs：' + (aniWork.cur ? aniWork.cur.name : ''); });
  body.addEventListener('click', function (ev) {
    if (_aniMode() !== 'works') return;
    if (ev.target.closest('[data-act="more"]')) { animeView.limit += ANI_PAGE_SIZE; var y = window.scrollY; renderAnimePage(); window.scrollTo(0, y); return; }
    var c = ev.target.closest('[data-ani-work]');
    if (c) { var w0 = aniWork.list[+c.getAttribute('data-ani-work')]; if (w0) openAnimeWork(w0.key); return; }
    var s = ev.target.closest('[data-aw-song]');
    if (s) { openAnimeWorkNameDialog([s.getAttribute('data-aw-song')]); return; }
    var b = ev.target.closest('[data-aw-act]');
    if (!b) return;
    var act = b.getAttribute('data-aw-act'), w = aniWork.cur;
    if (act === 'back') closeAnimeWork();
    else if (act === 'play') _awPlay(false);
    else if (act === 'shuffle') _awPlay(true);
    else if (act === 'img') animeWorkPickImage(w);
    else if (act === 'img-off' && w) animeWorkRemoveImage(w.key, w.name);
    else if (act === 'rename') animeWorkRename(w);
  });
  // 見出しの画像へのドラッグで登録
  body.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('[data-aw-drop]'); if (!d) return; ev.preventDefault(); d.classList.add('drag-over'); });
  body.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('[data-aw-drop]'); if (d) d.classList.remove('drag-over'); });
  body.addEventListener('drop', function (ev) {
    var d = ev.target.closest && ev.target.closest('[data-aw-drop]'); if (!d) return;
    ev.preventDefault(); d.classList.remove('drag-over');
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) animeWorkSetImage(aniWork.cur, f);
  });
  // 作品の画面を開いているときの Ctrl+V（画像の貼り付け）
  document.addEventListener('paste', function (ev) {
    if (currentPage !== 'anime' || _aniMode() !== 'works' || !aniWork.cur || aniWork.cur.none) return;
    var ov = document.getElementById('dialog-modal');
    if (ov && !ov.hidden) return;
    if (ev.target.closest && ev.target.closest('input, textarea')) return;
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { ev.preventDefault(); animeWorkSetImage(aniWork.cur, items[i].getAsFile()); return; }
  });
}

/* ---------- tools の「Anime Songs の設定」に「作品」の欄を足す ---------- */
function _awSetHtml() {
  var am = db.animeAlbumWork || {}, sm = db.animeSongWork || {}, im = db.animeWorkImages || {};
  var na = Object.keys(am).length, ns = Object.keys(sm).length, ik = Object.keys(im);
  var used = {};
  if (library.tracks.length) buildAnimeWorks().forEach(function (w) { if (w.key) used[w.key] = true; });
  var total = ik.reduce(function (s, k) { return s + _awImgBytes(im[k]); }, 0);
  ik.sort(function (x, y) { return JA_COLLATOR.compare(im[x].name || x, im[y].name || y); });
  return '<div class="ani-work-set" id="set-anime-works">' +
    '<div class="ani-set-title">作品（作品名・作品の画像）<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'Anime Songs の作品の設定\', event)" title="クリックで「Anime Songs の作品の設定」をコピー">□</span></div>' +
    '<label class="ani-work-set-check"><input type="checkbox" id="ani-work-auto"' + (animeWorkAuto() ? ' checked' : '') + '>アルバム名・曲名の『』から作品名を自動で読み取る（「TVアニメ「…」」「劇場版「…」」なども）</label>' +
    '<p class="panel-meta">作品名の指定：アルバム ' + na + '枚・曲 ' + ns + '曲' + (na + ns ? '' : '（曲の長押しのメニューの「Anime Songs の作品名を付ける…」で付けられます）') + '</p>' +
    (na + ns ? '<div class="btn-row"><button type="button" class="btn-inline-small" id="ani-work-name-clear">作品名の指定をすべて解除</button></div>' : '') +
    '<p class="panel-meta">作品の画像：' + ik.length + '件' + (ik.length ? '（約 ' + formatBytes(total) + '。長い辺 600px の JPEG に縮めて保存し、バックアップに含みます）' : '（Anime Songs の作品の画面の「画像を登録」で登録できます）') + '</p>' +
    (ik.length ? '<ul class="hidden-album-list ani-work-set-list">' + ik.map(function (k) {
      return '<li><img class="ani-work-set-thumb" src="' + escapeHtml(_awImgUrl(k)) + '" alt=""><span class="hidden-album-name">' + escapeHtml(im[k].name || k) + '</span>' +
        '<span class="hidden-album-sub">' + (im[k].w || '?') + '×' + (im[k].h || '?') + '・約 ' + formatBytes(_awImgBytes(im[k])) + (library.tracks.length && !used[k] ? ' ・ <span class="text-warn">今はこの作品の曲がありません</span>' : '') + '</span>' +
        '<button type="button" class="btn-inline-small" data-aw-img-off="' + escapeHtml(k) + '">解除</button></li>';
    }).join('') + '</ul>' : '') +
    '</div>';
}
function _awSetBind(el) {
  var cb = el.querySelector('#ani-work-auto');
  if (cb) cb.addEventListener('change', function () { db.settings.animeWorkAuto = cb.checked; saveDB(); _awRedraw(); });
  var nc = el.querySelector('#ani-work-name-clear');
  if (nc) nc.addEventListener('click', async function () {
    var na = Object.keys(db.animeAlbumWork || {}).length, ns = Object.keys(db.animeSongWork || {}).length;
    var ok = await showConfirm({ title: '作品名の指定をすべて解除', message: 'アルバム ' + na + '枚・曲 ' + ns + '曲の作品名の指定を外して、自動の読み取りに戻します（作品の画像はそのままです）。', okText: 'すべて解除' });
    if (!ok) return;
    var snap = _awSnapshot();
    db.animeAlbumWork = {}; db.animeSongWork = {}; saveDB(); _awRedraw();
    showToast('作品名の指定をすべて解除しました。', false, { label: '元に戻す', fn: function () { _awRestore(snap); } });
  });
  el.querySelectorAll('[data-aw-img-off]').forEach(function (b) {
    b.addEventListener('click', function () { var k = b.getAttribute('data-aw-img-off'), o = (db.animeWorkImages || {})[k]; animeWorkRemoveImage(k, o && o.name); });
  });
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // tools（85 の renderSettingsPage の包みから renderSetAnime が呼ばれる）
  var rs = window.renderSetAnime;
  if (typeof rs === 'function') {
    window.renderSetAnime = function () {
      var r = rs.apply(this, arguments);
      var el = document.getElementById('set-anime');
      if (el) { try { el.insertAdjacentHTML('beforeend', _awSetHtml()); _awSetBind(el); } catch (e) { console.warn('Anime Songs の作品の設定', e); } }
      return r;
    };
  }
  // ファイル整理で曲が動いたとき：曲の作品名も付け替える
  var am = window.applyPathMapping;
  if (typeof am === 'function') {
    window.applyPathMapping = function (map) {
      var r = am.apply(this, arguments);
      try { var m = db.animeSongWork, ch = false; if (m) Object.keys(map).forEach(function (f) { if (m[f] && map[f]) { m[map[f]] = m[f]; delete m[f]; ch = true; } }); if (ch) saveDB(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 曲の長押しのメニュー（82-up-next.js。PC 幅は右クリック）に「Anime Songs の作品名を付ける…」
  var sm = window.openSongMenu;
  if (typeof sm === 'function') {
    window.openSongMenu = function (paths, x, y, title) {
      var r = sm.apply(this, arguments);
      var el = typeof upm !== 'undefined' ? upm.el : null;
      var ps = (paths || []).filter(Boolean);
      if (!el || !ps.length) return r;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'acm-item'; b.setAttribute('role', 'menuitem');
      b.innerHTML = ICONS.anime + '<span>Anime Songs の作品名を付ける…</span>';
      b.addEventListener('click', function () { closeSongMenu(); openAnimeWorkNameDialog(ps, ps.length > 1 ? ps.length + '曲（選んだ曲）' : ''); });
      el.appendChild(b);
      var rr = el.getBoundingClientRect(), mg = 6;
      if (rr.bottom > window.innerHeight - mg) el.style.top = Math.max(mg, window.innerHeight - rr.height - mg) + 'px';
      return r;
    };
  }
  // 戻るボタン・ブラウザの戻る（25-navigation.js）：作品の画面を開いた・閉じたも履歴に覚える
  if (typeof _navSnapshot === 'function' && typeof _navWrap === 'function') {
    var ns = window._navSnapshot, nk = window._navKey, nb = window.navBack;
    window._navSnapshot = function () { var s = ns.apply(this, arguments); if (s && s.page === 'anime') s.aniWork = aniWork.open; return s; };
    window._navKey = function (s) { return nk.apply(this, arguments) + (s && s.page === 'anime' ? '|aw:' + (s.aniWork === null || s.aniWork === undefined ? '\u0001' : s.aniWork) : ''); };
    window.navBack = function () {
      var s = nav.stack[nav.stack.length - 1];
      if (s && s.page === 'anime' && 'aniWork' in s) aniWork.open = s.aniWork === undefined ? null : s.aniWork;
      return nb.apply(this, arguments);
    };
    ['openAnimeWork', 'closeAnimeWork'].forEach(_navWrap);
  }
})();
initAnimeWorks();

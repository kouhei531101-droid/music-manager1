/* =========================================================
   81-np-bg.js ― 「再生画面の背景」（スマホ版 v8.14.0）
   ・再生画面（#now-playing）のいちばん奥に背景の絵（#np-bg）を敷き、その上に「背景の覆い」（.np-bg-veil）を重ねて
     文字・ボタン・ジャケット・歌詞の重ね表示を読みやすくする（ライトでは白っぽく、ブラックでは暗く覆う。濃さは3段）
   ・背景の種類（db.settings.npBg）：
       'none'   … なし（今まで通り。背景の色だけ）
       テンプレート … NPBG_TEMPLATES の id（PC版と同じ11種：forest 森・meadow 草原・mountain 山・river 川・sea 海・space 宇宙・geometric 幾何学・
                     sunset 夕焼け・sakura 桜・autumn 紅葉・snow 雪景色）
                     画像ファイルは使わず、インライン SVG（グラデーション・図形）で描く。オフラインで動き、軽い
       'auto'   … 自動（曲ごとに切替）。曲が変わるたびにテンプレートから選ぶ。同じ曲ではいつも同じ（曲の相対パスから決める）。
                   Seasons Song の季節（46-seasons.js の seasonOf）に入る曲は Spring→桜・Summer→海・Fall→紅葉・Winter→雪景色（PC版と同じ）
       'custom' … 自分の画像。画像は縮めて（長い辺 1600px の JPEG）IndexedDB 'musicManager_npBg' / 'img' / 'custom' に保存
                   （{ blob, type, w, h, at }）。画像が無いときは「なし」と同じ。長い辺は PC版と同じ 1920px
   ・絵の種類（db.settings.npBgStyle。スマホ版 v8.14.1）：'photo' 写真（初期）／'illust' イラスト。テンプレート・自動に効く。
     写真は bg-photos/〈id〉.jpg（Wikimedia Commons。撮影者・ライセンスは NPBG_PHOTO_CREDITS＝bg-photos/credits.json と同じ）。
     再生画面では表示中の1枚だけ読み、右下に「Photo: 撮影者 / ライセンス」（#np-bg-credit）。サムネイルはその場で縮めて1枚ずつ作る。
     写真を読めないとき（置いていない等）は同じ id のイラストで出す。オフライン用の控えは sw.js（写真用の控え music-manager-bgphotos-v1）
   ・スマホ版 v8.15.0：npBg に 'jacket'（ジャケット：再生中の曲のジャケット）・'repJacket'（代表ジャケット：アーティストの代表ジャケット。
     無ければアルバムのジャケット）。画像の無い曲は自動と同じテンプレート。
     表示の調整（すべての背景に共通）：npBgFit 'cover' 画面に合わせる／'contain' 全体を表示／'scale' 拡大（npBgScale 100〜300%）、
     位置 npBgPosX／npBgPosY（0〜100%）、ぼかし npBgBlur（0〜30px）。無い古いデータは cover・50・50・0（今まで通り）。
     再生画面では、どの背景も .np-bg-art ＞ .np-bg-pic（background-image。イラストは data URL の SVG）にして、CSS の変数で大きさ・位置・ぼかしを付ける
   ・覆いの濃さ（db.settings.npBgVeil）：'light' うすい／'normal' ふつう／'strong' こい（無い・知らない値は 'normal'）
   ・選ぶ場所：tools の「再生画面の背景（tools）」（#set-np-bg）と、再生画面の描き方メニュー（ⓘ）の先頭の「背景」の行 →「背景の選択」ダイアログ。
     どちらも「背景の選択肢」（サムネイルの並び。.npbg-grid）で、押すとすぐ変わる
   ・バックアップ：設定（npBg・npBgVeil）は db.settings に入るのでそのまま含まれる。自分の画像はバックアップ JSON の npBgImage
     （{ type, w, h, at, data: data URL }）に入れる（10-settings-backup.js）。復元で npBgImage が無い（古いバックアップ）ときは、今の画像はそのまま
   ・保存データの既存の形は変えない（settings に2つ足すだけ。無いときは「なし」「ふつう」）
   ========================================================= */

var NPBG_TEMPLATES = [
  { id: 'forest', name: '森' },
  { id: 'meadow', name: '草原' },
  { id: 'mountain', name: '山' },
  { id: 'river', name: '川' },
  { id: 'sea', name: '海' },
  { id: 'space', name: '宇宙' },
  { id: 'geometric', name: '幾何学' },
  { id: 'sunset', name: '夕焼け' },
  { id: 'sakura', name: '桜' },
  { id: 'autumn', name: '紅葉' },
  { id: 'snow', name: '雪景色' }
];
var NPBG_SPECIAL = { none: 'なし（今まで通り）', auto: '自動（曲ごとに切替）', custom: '自分の画像', jacket: 'ジャケット', repJacket: '代表ジャケット' };   // 文言は PC版と同じ
// 表示の調整（スマホ版 v8.15.0。すべての背景に共通）：大きさ npBgFit・拡大率 npBgScale（100〜300%。「拡大」のとき）・位置 npBgPosX／npBgPosY（0〜100%。50 が中央）・ぼかし npBgBlur（0〜30px。0 はオフ）
var NPBG_FITS = { cover: { label: '画面に合わせる' }, contain: { label: '全体を表示' }, scale: { label: '拡大' } };
var NPBG_LOOK_KEYS = { fit: 'npBgFit', scale: 'npBgScale', x: 'npBgPosX', y: 'npBgPosY', blur: 'npBgBlur' };
var NPBG_VEILS = { light: { label: 'うすい' }, normal: { label: 'ふつう' }, strong: { label: 'こい' } };
// 自動のとき、Seasons Song の季節に入る曲の背景（PC版と同じ。季節が分からない曲は全テンプレートから曲のパスで決める）
var NPBG_SEASON_TPL = { spring: 'sakura', summer: 'sea', fall: 'autumn', winter: 'snow' };
var NPBG_IMG_MAX = 1920;        // 自分の画像の長い辺（px。PC版と同じ）
var NPBG_IMG_QUALITY = 0.85;    // JPEG の質
var NPBG_DB = 'musicManager_npBg', NPBG_STORE = 'img', NPBG_KEY = 'custom';

// 絵の種類（スマホ版 v8.14.1。PC版と同じ形）：db.settings.npBgStyle＝'photo' 写真／'illust' イラスト（無い・知らない値は 'photo'）。
// テンプレートと「自動」は選んだ種類で出す。写真は bg-photos/〈id〉.jpg（横 1600px。表示中の1枚だけ読む）。読めないときは同じ id のイラスト
var NPBG_STYLES = { photo: { label: '写真' }, illust: { label: 'イラスト' } };
var NPBG_PHOTO_DIR = 'bg-photos/';
// 写真の撮影者・ライセンス（bg-photos/credits.json と同じ中身。Wikimedia Commons。縮小して使っている）
var NPBG_PHOTO_CREDITS = {
  forest: { file: "forest.jpg", title: "Spruce forest at Holma.jpg", author: "W.carter", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Spruce_forest_at_Holma.jpg" },
  meadow: { file: "meadow.jpg", title: "Schönwald im Schwarzwald, Escheckstraße -- 2025 -- 0147.jpg", author: "Dietmar Rabich", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Sch%C3%B6nwald_im_Schwarzwald,_Escheckstra%C3%9Fe_--_2025_--_0147.jpg" },
  mountain: { file: "mountain.jpg", title: "Zagedan Lakes, Mountain cirque, Caucasus Mountains.jpg", author: "Vyacheslav Argenberg", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Zagedan_Lakes,_Mountain_cirque,_Caucasus_Mountains.jpg" },
  river: { file: "river.jpg", title: "Spiti River Kaza Himachal Jun18 D72 7232.jpg", author: "Timothy A. Gonsalves", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Spiti_River_Kaza_Himachal_Jun18_D72_7232.jpg" },
  sea: { file: "sea.jpg", title: "Baltic Sea view from Schmiedeberg hill in Rerik, 2025-06-23.jpg", author: "Radomianin", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Baltic_Sea_view_from_Schmiedeberg_hill_in_Rerik,_2025-06-23.jpg" },
  space: { file: "space.jpg", title: "018 Human looking at the stars during Perseids with the Milky Way in the background Photo by Giles Laurent.jpg", author: "Giles Laurent", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:018_Human_looking_at_the_stars_during_Perseids_with_the_Milky_Way_in_the_background_Photo_by_Giles_Laurent.jpg" },
  geometric: { file: "geometric.jpg", title: "Sunlight on the curved honeycomb glass façade of the hotel Andaz mixed with interior lighting at sunset in Singapore.jpg", author: "Basile Morin", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Sunlight_on_the_curved_honeycomb_glass_fa%C3%A7ade_of_the_hotel_Andaz_mixed_with_interior_lighting_at_sunset_in_Singapore.jpg" },
  sunset: { file: "sunset.jpg", title: "Rapanui Rock during sunset, Sumner, Christchurch, New Zealand.jpg", author: "Michal Klajban", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Rapanui_Rock_during_sunset,_Sumner,_Christchurch,_New_Zealand.jpg" },
  sakura: { file: "sakura.jpg", title: "Cherry blossoms (Somei Yoshino), Nagai Botanical Garden, April 2026 -1488.jpg", author: "Laitche", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Cherry_blossoms_(Somei_Yoshino),_Nagai_Botanical_Garden,_April_2026_-1488.jpg" },
  autumn: { file: "autumn.jpg", title: "Fagus sylvatica with autumn leaf color in Biosphärenreservat Rhön - Still.jpg", author: "Markusmachtphotos", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Fagus_sylvatica_with_autumn_leaf_color_in_Biosph%C3%A4renreservat_Rh%C3%B6n_-_Still.jpg" },
  snow: { file: "snow.jpg", title: "Winter in Tatry Mountains - Poland.jpg", author: "Radek Kucharski", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Winter_in_Tatry_Mountains_-_Poland.jpg" }
};
var NPBG_THUMB_W = 150, NPBG_THUMB_H = 200;   // 写真のサムネイル（縮めた画像をその場で作ってメモリに持つ）

var npBgSt = { url: null, info: null, loaded: false, shownKey: null, seq: 0, thumbs: {}, thumbQ: [], thumbBusy: false, photoBad: {}, repUrls: {} };

/* ---------- 設定 ---------- */
function _npbgIsTpl(id) { return NPBG_TEMPLATES.some(function (t) { return t.id === id; }); }
function npBgSetting(s) {
  s = s || db.settings || {};
  var v = s.npBg;
  return v === 'auto' || v === 'custom' || v === 'jacket' || v === 'repJacket' || _npbgIsTpl(v) ? v : 'none';
}
function _npbgIsJk(id) { return id === 'jacket' || id === 'repJacket'; }
function _npbgNum(v, min, max, def) { v = Math.round(+v); return v === v && v != null ? Math.max(min, Math.min(max, v)) : def; }
// 表示の調整の今の値（無い古いデータは 画面に合わせる・中央・ぼかしなし＝今まで通り）
function npBgLook(s) {
  s = s || db.settings || {};
  return { fit: NPBG_FITS[s.npBgFit] ? s.npBgFit : 'cover', scale: _npbgNum(s.npBgScale, 100, 300, 100),
    x: _npbgNum(s.npBgPosX, 0, 100, 50), y: _npbgNum(s.npBgPosY, 0, 100, 50), blur: _npbgNum(s.npBgBlur, 0, 30, 0) };
}
function _npbgPosName(x, y) {
  var h = x <= 20 ? '左' : x >= 80 ? '右' : '', v = y <= 20 ? '上' : y >= 80 ? '下' : '';
  return x === 50 && y === 50 ? '中央' : (h + v || '中央') + '（' + x + '%・' + y + '%）';
}
// 比較表の文字（例「画面に合わせる・中央・ぼかし 12px」）
function npBgLookText(s) {
  var k = npBgLook(s);
  return NPBG_FITS[k.fit].label + (k.fit === 'scale' ? ' ' + k.scale + '%' : '') + '・' + _npbgPosName(k.x, k.y) + '・ぼかし ' + (k.blur ? k.blur + 'px' : 'なし');
}
// 変える（patch：{ fit, scale, x, y, blur } の一部）。save：保存して選択肢を描き直す（スライダーを動かしている間は false）
function setNpBgLook(patch, save) {
  var cur = npBgLook();
  Object.keys(NPBG_LOOK_KEYS).forEach(function (k) {
    if (patch[k] == null) return;
    var v = k === 'fit' ? (NPBG_FITS[patch.fit] ? patch.fit : 'cover') : k === 'scale' ? _npbgNum(patch.scale, 100, 300, cur.scale) : k === 'blur' ? _npbgNum(patch.blur, 0, 30, cur.blur) : _npbgNum(patch[k], 0, 100, cur[k]);
    db.settings[NPBG_LOOK_KEYS[k]] = v;
  });
  _npbgApplyLook();
  if (save !== false) { saveDB(); npBgRefreshPickers(); }
}
// 再生画面に表示の調整を付ける（CSS の変数。style.css の .np-bg-pic が使う）
function _npbgApplyLook(host) {
  host = host || document.getElementById('now-playing');
  if (!host) return;
  var k = npBgLook();
  host.setAttribute('data-np-bg-fit', k.fit);
  host.style.setProperty('--npbg-x', k.x + '%');
  host.style.setProperty('--npbg-y', k.y + '%');
  host.style.setProperty('--npbg-s', String(k.scale / 100));
  host.style.setProperty('--npbg-blur', k.blur + 'px');
}
function npBgVeil(s) { s = s || db.settings || {}; return NPBG_VEILS[s.npBgVeil] ? s.npBgVeil : 'normal'; }
function npBgStyle(s) { s = s || db.settings || {}; return s.npBgStyle === 'illust' ? 'illust' : 'photo'; }
function npBgPhotoUrl(id) { var c = NPBG_PHOTO_CREDITS[id]; return NPBG_PHOTO_DIR + (c ? c.file : id + '.jpg'); }
function npBgName(id) {
  if (NPBG_SPECIAL[id]) return NPBG_SPECIAL[id];
  var t = NPBG_TEMPLATES.filter(function (x) { return x.id === id; })[0];
  return t ? t.name : NPBG_SPECIAL.none;
}
// 復元前の比較表などの文字（例「自動（曲ごとに切替）・写真・覆い ふつう」）
function npBgSummary(s) {
  return npBgName(npBgSetting(s)) + '・' + NPBG_STYLES[npBgStyle(s)].label + '・覆い ' + NPBG_VEILS[npBgVeil(s)].label + '・' + npBgLookText(s);
}
function setNpBgStyle(v) {
  db.settings.npBgStyle = v === 'illust' ? 'illust' : 'photo';
  saveDB();
  npBgApply();
  npBgRefreshPickers();
}
function setNpBg(id) {
  db.settings.npBg = id === 'auto' || id === 'custom' || _npbgIsJk(id) || _npbgIsTpl(id) ? id : 'none';
  saveDB();
  npBgApply();
  npBgRefreshPickers();
}
function setNpBgVeil(v) {
  db.settings.npBgVeil = NPBG_VEILS[v] ? v : 'normal';
  saveDB();
  npBgApply();
  npBgRefreshPickers();
}

/* ---------- 自動：曲から決める ---------- */
function _npbgHash(str) {   // FNV-1a（同じ文字ならいつも同じ数）
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function npBgAutoFor(path) {
  if (!path) return 'meadow';
  try {
    var t = typeof library !== 'undefined' && library.byPath ? library.byPath[path] : null;
    if (t && typeof seasonOf === 'function') {
      var s = seasonOf(t);
      if (s && NPBG_SEASON_TPL[s.id] && !(typeof isSeasonHidden === 'function' && isSeasonHidden(path))) return NPBG_SEASON_TPL[s.id];
    }
  } catch (e) { /* 季節が分からなくても続ける */ }
  return NPBG_TEMPLATES[_npbgHash(path) % NPBG_TEMPLATES.length].id;
}
// 今出すべき背景（'none'／テンプレートの id／'custom'）
function npBgCurrent() {
  var s = npBgSetting();
  if (s === 'auto') return npBgAutoFor(typeof player !== 'undefined' ? player.currentPath : null);
  if (s === 'custom') return npBgSt.url ? 'custom' : 'none';
  return s;
}

/* ---------- 絵（インライン SVG。viewBox 1000×1000、画面の縦横に合わせて切り取る） ---------- */
function _npbgRand(seed) {   // 決まった並びの乱数（毎回同じ絵になるように）
  var a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function _lg(id, stops, x2, y2) {   // 線のグラデーション（既定は上→下）
  return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (x2 == null ? 0 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
    stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') + '</linearGradient>';
}
function _rg(id, stops) {
  return '<radialGradient id="' + id + '">' +
    stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') + '</radialGradient>';
}
function _pts(arr) { return arr.map(function (p) { return Math.round(p[0]) + ',' + Math.round(p[1]); }).join(' '); }
// 針葉樹（ぎざぎざの三角）
function _pine(x, b, h, w) {
  var p = [[x, b - h], [x + w * 0.3, b - h * 0.62], [x + w * 0.16, b - h * 0.62], [x + w * 0.42, b - h * 0.3], [x + w * 0.26, b - h * 0.3], [x + w * 0.5, b + 2],
    [x - w * 0.5, b + 2], [x - w * 0.26, b - h * 0.3], [x - w * 0.42, b - h * 0.3], [x - w * 0.16, b - h * 0.62], [x - w * 0.3, b - h * 0.62]];
  return '<polygon points="' + _pts(p) + '"/>';
}
// 波の線（y の高さに、幅 w・高さ a の波を横いっぱいに）
function _wave(y, w, a, off) {
  var d = 'M' + (-w + (off || 0)) + ',' + y;
  for (var x = -w + (off || 0); x < 1000 + w; x += w) d += ' q' + (w / 4) + ',' + (-a) + ' ' + (w / 2) + ',0 t' + (w / 2) + ',0';
  return d;
}
// 雪をかぶった山頂の白い部分
function _snowCap(L, A, R, k) {
  var l = [A[0] + (L[0] - A[0]) * k, A[1] + (L[1] - A[1]) * k], r = [A[0] + (R[0] - A[0]) * k, A[1] + (R[1] - A[1]) * k];
  var m1 = [l[0] + (r[0] - l[0]) * 0.3, l[1] + (r[1] - l[1]) * 0.3 - 22], m2 = [l[0] + (r[0] - l[0]) * 0.55, l[1] + (r[1] - l[1]) * 0.55 + 10], m3 = [l[0] + (r[0] - l[0]) * 0.78, l[1] + (r[1] - l[1]) * 0.78 - 18];
  return '<polygon points="' + _pts([A, r, m3, m2, m1, l]) + '"/>';
}

var NPBG_DRAW = {
  // 森：木漏れ日の差す針葉樹の森（奥ほど淡く、霧）
  forest: function (p) {
    var rnd = _npbgRand(11), cols = ['#9cc3a8', '#6d9e7f', '#467858', '#264c34'], h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#e6f3e4'], [0.45, '#b9dcc2'], [1, '#5f8f6d']]) + _rg(p + 'sun', [[0, '#fffbe2', 0.95], [1, '#fffbe2', 0]]) +
      _lg(p + 'mist', [[0, '#f4fbf2', 0], [0.5, '#f4fbf2', 0.45], [1, '#f4fbf2', 0]]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<circle cx="720" cy="170" r="300" fill="url(#' + p + 'sun)"/>';
    h += '<g fill="#fffbe6" opacity="0.16"><polygon points="690,0 740,0 560,1000 380,1000"/><polygon points="760,0 790,0 820,1000 700,1000"/><polygon points="660,0 676,0 260,1000 190,1000"/></g>';
    cols.forEach(function (c, i) {
      var base = 560 + i * 120, n = 15 - i * 2, hh = 200 + i * 70;
      h += '<g fill="' + c + '">';
      for (var k = 0; k <= n; k++) {
        var x = -40 + (1080 / n) * k + (rnd() - 0.5) * (1080 / n) * 0.6, th = hh * (0.7 + rnd() * 0.5);
        h += _pine(x, base + rnd() * 30, th, th * 0.42);
      }
      h += '<rect x="0" y="' + base + '" width="1000" height="' + (1000 - base) + '"/></g>';
      if (i < 3) h += '<rect x="0" y="' + (base - 40) + '" width="1000" height="110" fill="url(#' + p + 'mist)"/>';
    });
    return h;
  },
  // 草原：青空と白い雲、なだらかな丘、一本の木、小さな花
  meadow: function (p) {
    var rnd = _npbgRand(23), h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#7dbbef'], [0.55, '#c9e6fb'], [1, '#eef8ff']]) + _rg(p + 'sun', [[0, '#fff8d6', 0.9], [1, '#fff8d6', 0]]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<circle cx="690" cy="190" r="170" fill="url(#' + p + 'sun)"/><circle cx="690" cy="190" r="58" fill="#fffbe8"/>';
    [[210, 250, 1], [560, 150, 0.8], [880, 360, 0.9], [380, 420, 0.6]].forEach(function (c) {
      h += '<g fill="#ffffff" opacity="0.92" transform="translate(' + c[0] + ' ' + c[1] + ') scale(' + c[2] + ')"><ellipse cx="0" cy="0" rx="90" ry="34"/><ellipse cx="-50" cy="8" rx="56" ry="26"/><ellipse cx="45" cy="-14" rx="58" ry="36"/><ellipse cx="80" cy="10" rx="50" ry="22"/></g>';
    });
    h += '<path d="M0,600 Q250,520 500,585 T1000,560 V1000 H0Z" fill="#b4da92"/>';
    h += '<g transform="translate(300 600)"><rect x="-7" y="-20" width="14" height="44" fill="#6b5236"/><g fill="#4f8f3f"><circle cx="0" cy="-58" r="44"/><circle cx="-34" cy="-30" r="32"/><circle cx="34" cy="-32" r="34"/></g></g>';
    h += '<path d="M0,700 Q300,610 620,690 T1000,660 V1000 H0Z" fill="#86c267"/>';
    h += '<path d="M0,810 Q350,710 700,800 T1000,770 V1000 H0Z" fill="#5fa84b"/>';
    var fc = ['#ffffff', '#ffe066', '#ff9fc1', '#f3e9ff'];
    h += '<g>';
    for (var i = 0; i < 90; i++) {
      var y = 830 + rnd() * 170, x = rnd() * 1000;
      h += '<circle cx="' + Math.round(x) + '" cy="' + Math.round(y) + '" r="' + (3 + rnd() * 5 * (y - 780) / 220).toFixed(1) + '" fill="' + fc[Math.floor(rnd() * fc.length)] + '"/>';
    }
    return h + '</g>';
  },
  // 山：夜明けの空、雪をかぶった連山、湖
  mountain: function (p) {
    var h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#26315f'], [0.35, '#5d65a0'], [0.58, '#e9b3a4'], [0.72, '#fde2c6']]) + _lg(p + 'lk', [[0, '#7b80b3'], [1, '#232a52']]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<polygon fill="#a3a5c8" points="' + _pts([[-50, 650], [80, 480], [200, 570], [330, 440], [470, 570], [600, 460], [740, 590], [880, 450], [1050, 610], [1050, 1000], [-50, 1000]]) + '"/>';
    var mid = [[-50, 720], [150, 520], [270, 610], [420, 320], [600, 630], [760, 410], [900, 560], [1050, 470], [1050, 1000], [-50, 1000]];
    h += '<polygon fill="#575c8c" points="' + _pts(mid) + '"/>';
    h += '<g fill="#f4f5ff">' + _snowCap(mid[0], mid[1], mid[2], 0.32) + _snowCap(mid[2], mid[3], mid[4], 0.3) + _snowCap(mid[4], mid[5], mid[6], 0.3) + _snowCap(mid[6], mid[7], [1150, 600], 0.3) + '</g>';
    h += '<rect x="0" y="760" width="1000" height="240" fill="url(#' + p + 'lk)"/>';
    h += '<g stroke="#ffe6d0" stroke-linecap="round" opacity="0.45"><path d="M380,800 h240" stroke-width="4"/><path d="M430,835 h140" stroke-width="3"/><path d="M460,870 h80" stroke-width="3"/><path d="M200,900 h90" stroke-width="2"/><path d="M720,880 h110" stroke-width="2"/></g>';
    h += '<polygon fill="#1e2346" points="' + _pts([[-50, 1000], [-50, 770], [120, 800], [260, 900], [330, 1000]]) + '"/>';
    h += '<polygon fill="#1e2346" points="' + _pts([[1050, 1000], [1050, 740], [880, 790], [760, 920], [690, 1000]]) + '"/>';
    return h;
  },
  // 川：緑の谷を手前へ流れてくる川
  river: function (p) {
    var rnd = _npbgRand(37), h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#9fd3f3'], [0.55, '#e6f5ff']]) + _lg(p + 'w', [[0, '#d9f2ff'], [0.4, '#86c6ec'], [1, '#2f86c4']]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<path d="M0,560 Q160,470 330,530 T650,500 T1000,540 V1000 H0Z" fill="#a8cfb0"/>';
    h += '<path d="M0,600 Q250,560 500,590 T1000,585 V1000 H0Z" fill="#86bd7e"/>';
    // 川（奥の細い所から手前へ広がる）
    var riv = 'M492,560 C450,610 600,650 530,720 S300,860 230,1000 L780,1000 C700,880 780,800 650,730 S520,610 510,560 Z';
    h += '<path d="' + riv + '" fill="#e9e3c4" transform="translate(0 4) scale(1.0)" stroke="#e9e3c4" stroke-width="22" stroke-linejoin="round"/>';
    h += '<path d="' + riv + '" fill="url(#' + p + 'w)"/>';
    h += '<g fill="none" stroke="#ffffff" stroke-linecap="round" opacity="0.55"><path d="M500,600 q12,6 20,0" stroke-width="2"/><path d="M520,680 q20,8 40,0" stroke-width="3"/><path d="M450,780 q30,10 60,0" stroke-width="3"/><path d="M560,820 q30,10 60,0" stroke-width="3"/><path d="M360,900 q40,12 80,0" stroke-width="4"/><path d="M560,930 q50,12 100,0" stroke-width="4"/></g>';
    // 両岸の木
    h += '<g fill="#4c8a4a">';
    for (var i = 0; i < 14; i++) {
      var left = i % 2 === 0, x = left ? 40 + rnd() * 330 : 640 + rnd() * 330, y = 600 + rnd() * 120, r = 16 + (y - 590) * 0.28 + rnd() * 10;
      h += '<circle cx="' + Math.round(x) + '" cy="' + Math.round(y - r) + '" r="' + Math.round(r) + '"/>';
    }
    h += '</g>';
    h += '<path d="M0,1000 V820 Q120,790 230,1000 Z" fill="#5e9b55"/><path d="M1000,1000 V800 Q860,800 780,1000 Z" fill="#5e9b55"/>';
    return h;
  },
  // 海：青空と太陽、水平線、光る海面と波
  sea: function (p) {
    var h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#5fa6e0'], [0.56, '#d4ebf9']]) + _lg(p + 'o', [[0, '#5aa7d6'], [0.4, '#2a6fa8'], [1, '#123e6c']]) +
      _rg(p + 'sun', [[0, '#fffbe8', 0.95], [1, '#fffbe8', 0]]) + _lg(p + 'rf', [[0, '#ffffff', 0.5], [1, '#ffffff', 0.05]]) + '</defs>';
    h += '<rect width="1000" height="560" fill="url(#' + p + 's)"/>';
    h += '<circle cx="500" cy="320" r="210" fill="url(#' + p + 'sun)"/><circle cx="500" cy="320" r="56" fill="#fffdf2"/>';
    h += '<g fill="#ffffff" opacity="0.7"><ellipse cx="200" cy="200" rx="150" ry="16"/><ellipse cx="260" cy="225" rx="90" ry="10"/><ellipse cx="810" cy="150" rx="130" ry="14"/><ellipse cx="760" cy="430" rx="110" ry="10"/></g>';
    h += '<rect y="560" width="1000" height="440" fill="url(#' + p + 'o)"/>';
    h += '<polygon points="470,560 530,560 640,1000 360,1000" fill="url(#' + p + 'rf)"/>';
    h += '<g fill="none" stroke="#ffffff" stroke-linecap="round">';
    for (var i = 0; i < 13; i++) {
      var y = 575 + Math.pow(i, 1.55) * 9.5, w = 40 + i * 14, a = 3 + i * 1.3;
      h += '<path d="' + _wave(Math.round(y), w, a, (i * 37) % w) + '" stroke-width="' + (1 + i * 0.35).toFixed(1) + '" opacity="' + (0.18 + i * 0.02).toFixed(2) + '"/>';
    }
    return h + '</g>';
  },
  // 夕焼け：橙から紫の空、沈む太陽、水面の光、丘の影と鳥
  sunset: function (p) {
    var h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#1f1842'], [0.28, '#5a2a6e'], [0.46, '#c8456b'], [0.55, '#f2784f'], [0.6, '#ffc670']]) + _lg(p + 'wt', [[0, '#b04a5a'], [0.3, '#6a2c58'], [1, '#24163a']]) +
      _rg(p + 'sun', [[0, '#ffe7a8', 0.9], [1, '#ff9a5a', 0]]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<circle cx="500" cy="600" r="330" fill="url(#' + p + 'sun)"/><circle cx="500" cy="600" r="115" fill="#ffe2a0"/>';
    h += '<g fill="#7a2f6e" opacity="0.55"><ellipse cx="260" cy="330" rx="220" ry="14"/><ellipse cx="720" cy="380" rx="260" ry="16"/><ellipse cx="420" cy="455" rx="190" ry="10"/><ellipse cx="840" cy="250" rx="160" ry="10"/></g>';
    h += '<rect y="600" width="1000" height="400" fill="url(#' + p + 'wt)"/>';
    h += '<g fill="#ffcf86" opacity="0.75"><rect x="400" y="618" width="200" height="6" rx="3"/><rect x="430" y="645" width="140" height="6" rx="3"/><rect x="455" y="675" width="90" height="5" rx="2.5"/><rect x="470" y="710" width="60" height="5" rx="2.5"/><rect x="480" y="750" width="40" height="4" rx="2"/></g>';
    h += '<path d="M0,1000 V640 Q140,600 260,660 T420,760 Q380,900 300,1000 Z" fill="#1a1230"/>';
    h += '<path d="M1000,1000 V620 Q880,590 780,650 Q680,720 700,1000 Z" fill="#1a1230"/>';
    h += '<g fill="none" stroke="#2a1838" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M300,250 q14,-12 26,0 q12,-12 26,0"/><path d="M370,210 q10,-9 20,0 q10,-9 20,0"/><path d="M640,190 q12,-10 22,0 q10,-10 22,0"/></g>';
    return h;
  },
  // 宇宙：深い藍の空、星雲、星、輪のある星
  space: function (p) {
    var rnd = _npbgRand(53), h = '';
    h += '<defs><radialGradient id="' + p + 'bg" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#2d1f60"/><stop offset="0.55" stop-color="#0d1030"/><stop offset="1" stop-color="#05060f"/></radialGradient>' +
      _rg(p + 'n1', [[0, '#b25be0', 0.5], [1, '#b25be0', 0]]) + _rg(p + 'n2', [[0, '#2fb7cf', 0.38], [1, '#2fb7cf', 0]]) + _rg(p + 'n3', [[0, '#ff6fa8', 0.3], [1, '#ff6fa8', 0]]) +
      _lg(p + 'pl', [[0, '#ffd2a0'], [0.6, '#d07a72'], [1, '#5a2f62']], 1, 1) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 'bg)"/>';
    h += '<ellipse cx="620" cy="380" rx="440" ry="250" fill="url(#' + p + 'n1)" transform="rotate(-20 620 380)"/>';
    h += '<ellipse cx="300" cy="720" rx="380" ry="220" fill="url(#' + p + 'n2)" transform="rotate(15 300 720)"/>';
    h += '<ellipse cx="820" cy="820" rx="260" ry="180" fill="url(#' + p + 'n3)"/>';
    h += '<ellipse cx="500" cy="500" rx="720" ry="90" fill="#ffffff" opacity="0.05" transform="rotate(-32 500 500)"/>';
    h += '<g fill="#ffffff">';
    for (var i = 0; i < 170; i++) h += '<circle cx="' + Math.round(rnd() * 1000) + '" cy="' + Math.round(rnd() * 1000) + '" r="' + (0.7 + rnd() * rnd() * 2.6).toFixed(1) + '" opacity="' + (0.45 + rnd() * 0.55).toFixed(2) + '"/>';
    h += '</g><g stroke="#ffffff" stroke-linecap="round" opacity="0.8">';
    [[180, 160], [430, 820], [880, 520]].forEach(function (s) { h += '<path d="M' + (s[0] - 14) + ',' + s[1] + ' h28 M' + s[0] + ',' + (s[1] - 14) + ' v28" stroke-width="1.6"/><circle cx="' + s[0] + '" cy="' + s[1] + '" r="2.6" fill="#ffffff" stroke="none"/>'; });
    h += '</g>';
    h += '<g transform="rotate(-18 640 240)"><ellipse cx="640" cy="240" rx="135" ry="28" fill="none" stroke="#ffe5c4" stroke-opacity="0.55" stroke-width="6"/></g>';
    h += '<circle cx="640" cy="240" r="72" fill="url(#' + p + 'pl)"/>';
    h += '<g transform="rotate(-18 640 240)"><path d="M505,240 A135,28 0 0 0 775,240" fill="none" stroke="#ffe5c4" stroke-opacity="0.75" stroke-width="6"/></g>';
    return h;
  },
  // 幾何学：ゆがめた格子を三角に分けたローポリ（藍→紫→桃）と、細い線の図形
  geometric: function (p) {
    var rnd = _npbgRand(71), N = 8, c = 1000 / N, v = [], h = '';
    for (var r = 0; r <= N; r++) {
      v[r] = [];
      for (var k = 0; k <= N; k++) {
        var edgeX = k === 0 || k === N, edgeY = r === 0 || r === N;
        v[r][k] = [k * c + (edgeX ? 0 : (rnd() - 0.5) * c * 0.7), r * c + (edgeY ? 0 : (rnd() - 0.5) * c * 0.7)];
      }
    }
    var col = function (a, b, d) {
      var cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3, t = (cx + cy) / 2000;
      return 'hsl(' + Math.round(222 + t * 95 + (rnd() - 0.5) * 10) + ' ' + Math.round(52 + rnd() * 12) + '% ' + Math.round(26 + t * 14 + (rnd() - 0.5) * 12) + '%)';
    };
    h += '<g stroke-width="1" stroke-linejoin="round">';
    for (r = 0; r < N; r++) for (k = 0; k < N; k++) {
      var A = v[r][k], B = v[r][k + 1], C = v[r + 1][k + 1], D = v[r + 1][k], f1 = col(A, B, C), f2 = col(A, C, D);
      h += '<polygon points="' + _pts([A, B, C]) + '" fill="' + f1 + '" stroke="' + f1 + '"/><polygon points="' + _pts([A, C, D]) + '" fill="' + f2 + '" stroke="' + f2 + '"/>';
    }
    h += '</g><g fill="none" stroke="#ffffff" opacity="0.18">';
    h += '<circle cx="500" cy="500" r="300" stroke-width="2"/><circle cx="500" cy="500" r="220" stroke-width="1.5"/>';
    var hex = []; for (var i = 0; i < 6; i++) { var an = Math.PI / 3 * i + Math.PI / 6; hex.push([500 + Math.cos(an) * 400, 500 + Math.sin(an) * 400]); }
    h += '<polygon points="' + _pts(hex) + '" stroke-width="2"/><polygon points="' + _pts([[500, 260], [708, 620], [292, 620]]) + '" stroke-width="1.5"/></g>';
    return h;
  },
  // 桜：淡い桃色の空、枝いっぱいの桜、舞う花びら
  sakura: function (p) {
    var rnd = _npbgRand(83), h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#bfe0f5'], [0.5, '#fde6ef'], [1, '#fbd3e2']]) + _rg(p + 'gl', [[0, '#ffffff', 0.7], [1, '#ffffff', 0]]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<circle cx="560" cy="300" r="320" fill="url(#' + p + 'gl)"/>';
    h += '<path d="M0,760 Q260,700 520,760 T1000,740 V1000 H0Z" fill="#e9c6d4"/><path d="M0,860 Q300,800 640,860 T1000,850 V1000 H0Z" fill="#d9a9bd"/>';
    // 幹と枝（左上から右へ張り出す）
    h += '<g fill="none" stroke="#6b4a4f" stroke-linecap="round">' +
      '<path d="M120,1000 C150,820 170,650 260,520 S420,330 560,260" stroke-width="34"/>' +
      '<path d="M250,540 C330,520 420,540 520,500" stroke-width="16"/>' +
      '<path d="M380,390 C430,300 470,220 540,160" stroke-width="13"/>' +
      '<path d="M540,265 C640,250 720,290 820,260" stroke-width="11"/>' +
      '<path d="M200,640 C140,580 90,560 20,560" stroke-width="14"/></g>';
    // 花の房（たくさんの丸）
    var cl = [[560, 250, 150], [450, 330, 130], [760, 270, 120], [520, 160, 100], [300, 470, 120], [500, 500, 110], [80, 550, 110], [860, 230, 90], [660, 380, 90]];
    var pinks = ['#ffd6e5', '#ffc2d8', '#ffb0cc', '#ffe8f0', '#ff9fc1'];
    h += '<g>';
    cl.forEach(function (c) {
      for (var i = 0; i < 26; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * c[2];
        h += '<circle cx="' + Math.round(c[0] + Math.cos(a) * d) + '" cy="' + Math.round(c[1] + Math.sin(a) * d * 0.7) + '" r="' + Math.round(14 + rnd() * 22) + '" fill="' + pinks[Math.floor(rnd() * pinks.length)] + '" opacity="0.9"/>';
      }
    });
    h += '</g><g fill="#ffb7cf">';
    for (var k = 0; k < 40; k++) {
      var x = Math.round(rnd() * 1000), y = Math.round(380 + rnd() * 600), r = (4 + rnd() * 6).toFixed(1);
      h += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + (r * 0.6).toFixed(1) + '" transform="rotate(' + Math.round(rnd() * 180) + ' ' + x + ' ' + y + ')" opacity="' + (0.6 + rnd() * 0.4).toFixed(2) + '"/>';
    }
    return h + '</g>';
  },
  // 紅葉：赤・橙・黄の木々と、舞い落ちる葉
  autumn: function (p) {
    var rnd = _npbgRand(97), h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#f6d7a8'], [0.5, '#f3b77a'], [1, '#d9773f']]) + _rg(p + 'sun', [[0, '#fff3d0', 0.85], [1, '#fff3d0', 0]]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<circle cx="380" cy="230" r="260" fill="url(#' + p + 'sun)"/>';
    var layers = [[560, ['#d98a4a', '#e0a05a', '#c97a45'], 0.55, 60], [680, ['#c94a2a', '#e06a2a', '#d9902e', '#b8402a'], 0.85, 85], [820, ['#a8321f', '#d4501f', '#e6a02a', '#c23a24'], 1, 115]];
    layers.forEach(function (L) {
      var base = L[0], cs = L[1], r0 = L[3];
      h += '<g opacity="' + L[2] + '">';
      for (var x = -40; x < 1080; x += r0 * 1.15) {
        var cx = x + (rnd() - 0.5) * r0 * 0.5, cy = base - r0 * (0.6 + rnd() * 0.5);
        h += '<rect x="' + Math.round(cx - r0 * 0.08) + '" y="' + Math.round(cy) + '" width="' + Math.round(r0 * 0.16) + '" height="' + Math.round(base - cy + 20) + '" fill="#5a3324"/>';
        for (var j = 0; j < 5; j++) h += '<circle cx="' + Math.round(cx + (rnd() - 0.5) * r0) + '" cy="' + Math.round(cy - rnd() * r0 * 0.7) + '" r="' + Math.round(r0 * (0.45 + rnd() * 0.3)) + '" fill="' + cs[Math.floor(rnd() * cs.length)] + '"/>';
      }
      h += '<rect x="0" y="' + base + '" width="1000" height="' + (1000 - base) + '" fill="' + (L[2] < 1 ? '#c98a52' : '#8a3a22') + '"/></g>';
    });
    h += '<g>';
    var lc = ['#e0442a', '#f28c28', '#f2c230', '#c2321f'];
    for (var k = 0; k < 34; k++) {
      var lx = Math.round(rnd() * 1000), ly = Math.round(rnd() * 900), s = (0.6 + rnd() * 0.8).toFixed(2);
      h += '<path d="M0,-12 L4,-4 L12,-6 L7,1 L10,9 L1,5 L0,12 L-1,5 L-10,9 L-7,1 L-12,-6 L-4,-4 Z" fill="' + lc[Math.floor(rnd() * lc.length)] + '" transform="translate(' + lx + ' ' + ly + ') rotate(' + Math.round(rnd() * 360) + ') scale(' + s + ')" opacity="0.9"/>';
    }
    return h + '</g>';
  },
  // 雪景色：冬の空、雪の丘、雪をかぶった木、降る雪
  snow: function (p) {
    var rnd = _npbgRand(109), h = '';
    h += '<defs>' + _lg(p + 's', [[0, '#8fa9cf'], [0.5, '#c9d8ec'], [1, '#eef3fa']]) + _lg(p + 'g', [[0, '#ffffff'], [1, '#dfe8f4']]) + '</defs>';
    h += '<rect width="1000" height="1000" fill="url(#' + p + 's)"/>';
    h += '<polygon fill="#b9c6dc" points="' + _pts([[-50, 640], [160, 470], [330, 580], [520, 420], [720, 590], [880, 480], [1050, 600], [1050, 1000], [-50, 1000]]) + '"/>';
    h += '<path d="M0,660 Q260,600 540,650 T1000,630 V1000 H0Z" fill="#e7eef8"/>';
    var tree = function (x, b, hh) {
      var w = hh * 0.45;
      return '<g>' + '<g fill="#2f5a4e">' + _pine(x, b, hh, w) + '</g>' +
        '<g fill="#ffffff"><polygon points="' + _pts([[x, b - hh], [x + w * 0.22, b - hh * 0.7], [x - w * 0.22, b - hh * 0.7]]) + '"/>' +
        '<polygon points="' + _pts([[x - w * 0.3, b - hh * 0.62], [x + w * 0.3, b - hh * 0.62], [x + w * 0.16, b - hh * 0.55], [x - w * 0.16, b - hh * 0.55]]) + '"/>' +
        '<polygon points="' + _pts([[x - w * 0.42, b - hh * 0.3], [x + w * 0.42, b - hh * 0.3], [x + w * 0.26, b - hh * 0.24], [x - w * 0.26, b - hh * 0.24]]) + '"/></g></g>';
    };
    [[90, 700, 200], [300, 700, 210], [370, 730, 270], [520, 690, 130], [650, 700, 230], [735, 725, 170], [920, 700, 210]].forEach(function (t) { h += tree(t[0], t[1], t[2]); });
    h += '<path d="M0,760 Q300,700 620,770 T1000,750 V1000 H0Z" fill="url(#' + p + 'g)"/>';
    h += '<g fill="#ffffff">';
    for (var k = 0; k < 140; k++) h += '<circle cx="' + Math.round(rnd() * 1000) + '" cy="' + Math.round(rnd() * 1000) + '" r="' + (1.5 + rnd() * rnd() * 5).toFixed(1) + '" opacity="' + (0.55 + rnd() * 0.45).toFixed(2) + '"/>';
    return h + '</g>';
  }
};
var _npbgSvgSeq = 0;
// テンプレートの SVG。中のグラデーションの id は出すたびに変える
// （同じページに何枚も出し、隠れている画面の中の同じ id を参照すると色が出ないことがあるため）
function npBgSvg(id) {
  var f = NPBG_DRAW[id];
  if (!f) return '';
  var p = 'npbg' + (++_npbgSvgSeq) + '-';
  return '<svg class="np-bg-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' + f(p) + '</svg>';
}

// イラストを画像（data URL）にする。再生画面では写真と同じ扱い（大きさ・位置・ぼかし）にするため。中の id は画像の中だけなのでぶつからない
var _npbgSvgUrlMemo = {};
function npBgSvgUrl(id) {
  var f = NPBG_DRAW[id];
  if (!f) return '';
  if (!_npbgSvgUrlMemo[id]) _npbgSvgUrlMemo[id] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">' + f('i-') + '</svg>');
  return _npbgSvgUrlMemo[id];
}

/* ---------- ジャケット・代表ジャケット（スマホ版 v8.15.0） ----------
   ジャケット：再生中の曲のジャケット（13-artwork.js の artLoadForTrack。縮小した控えの画像 400px）。アルバムが変わると切り替わる
   代表ジャケット：再生中の曲のアーティストの代表ジャケット（artist 画面で選んだもの：db.artistCovers〔独自の画像は userPic の artist:名前〕）。
     選んでいなければ、その曲のアルバムの代表のジャケット
   どちらも、画像が無い曲・曲が無いときは「自動（曲ごとに切替）」と同じテンプレート（選んだ絵の種類） */
var _npbgAlb = { rev: '', byKey: null };
function _npbgAlbumByKey(key) {
  var rev = library.metaRev + ':' + library.tracks.length;
  if (!_npbgAlb.byKey || _npbgAlb.rev !== rev) {
    var m = new Map();
    try { buildAlbums().forEach(function (a) { m.set(a.key, a); }); } catch (e) { /* 無視 */ }
    _npbgAlb.byKey = m; _npbgAlb.rev = rev;
  }
  return _npbgAlb.byKey.get(key) || null;
}
function _npbgAlbumOfTrack(t) {
  if (typeof _npalAlbumOf === 'function') { try { return _npalAlbumOf(t.path); } catch (e) { /* 無視 */ } }
  return _npbgAlbumByKey(albumKeyOf(t));
}
// どの画像を出すかの目印（同じなら描き直さない）
function _npbgJkKey(kind, t) {
  if (!t) return '';
  if (kind === 'jacket') return 'a:' + artKeyOf(t);
  var n = typeof artistNameOf === 'function' ? artistNameOf(t) : '', sel = (db.artistCovers || {})[n];
  if (sel && sel.custom) return 'u:' + n;
  if (sel && sel.album) return 'k:' + sel.album;
  var a = _npbgAlbumOfTrack(t);
  return 'a:' + (a && a.cover ? artKeyOf(a.cover) : artKeyOf(t));
}
// 画像の URL（無ければ null）
function _npbgJkUrl(kind, t) {
  if (!t || typeof artLoadForTrack !== 'function') return Promise.resolve(null);
  var fromTrack = function (tr) { return artLoadForTrack(tr).then(function (r) { return r && r.url ? r.url : null; }, function () { return null; }); };
  if (kind === 'jacket') return fromTrack(t);
  var n = typeof artistNameOf === 'function' ? artistNameOf(t) : '', sel = (db.artistCovers || {})[n];
  var albumCover = function () {
    var a = sel && sel.album ? _npbgAlbumByKey(sel.album) : null;
    if (!a) a = _npbgAlbumOfTrack(t);
    return fromTrack(a && a.cover ? a.cover : t);
  };
  if (sel && sel.custom && typeof userPicGet === 'function') {
    if (npBgSt.repUrls[n]) return Promise.resolve(npBgSt.repUrls[n]);
    return userPicGet('artist:' + n).then(function (rec) {
      if (rec && rec.blob) { npBgSt.repUrls[n] = URL.createObjectURL(rec.blob); return npBgSt.repUrls[n]; }
      return albumCover();
    }, albumCover);
  }
  return albumCover();
}

/* ---------- 再生画面に出す ---------- */
function _npbgEnsureLayer() {
  var host = document.getElementById('now-playing');
  if (!host) return null;
  var el = document.getElementById('np-bg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'np-bg';
  el.className = 'np-bg';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="np-bg-veil"></div>';
  host.insertBefore(el, host.firstChild);   // いちばん奥（ビジュアライザーのキャンバスより後ろ）
  return el;
}
// 今の設定・曲に合わせる（force：同じでも作り直す）
function npBgApply(force) {
  var host = document.getElementById('now-playing');
  if (!host) return;
  var cur = npBgCurrent(), path = typeof player !== 'undefined' ? player.currentPath : null;
  var t = path && typeof library !== 'undefined' && library.byPath ? library.byPath[path] : null;
  var photo = _npbgIsTpl(cur) && npBgStyle() === 'photo' && !npBgSt.photoBad[cur];
  var key = cur === 'custom' ? 'custom:' + (npBgSt.url || '') : _npbgIsJk(cur) ? cur + ':' + _npbgJkKey(cur, t) + ':' + npBgStyle() : (photo ? 'photo:' : '') + cur;
  host.classList.toggle('np-has-bg', cur !== 'none');
  host.setAttribute('data-np-bg-veil', npBgVeil());
  host.setAttribute('data-np-bg', cur);
  _npbgApplyLook(host);
  if (!force && key === npBgSt.shownKey) return;
  npBgSt.shownKey = key;
  var layer = _npbgEnsureLayer();
  if (!layer) return;
  var seq = ++npBgSt.seq;
  _npbgCredit(null);
  if (_npbgIsJk(cur)) {
    // ジャケット・代表ジャケット：画像が無ければ「自動」と同じテンプレート
    _npbgJkUrl(cur, t).then(function (u) {
      if (seq !== npBgSt.seq) return;
      if (u) _npbgPut(layer, 'url', u); else _npbgShowTpl(layer, npBgAutoFor(path), seq);
    });
    return;
  }
  if (_npbgIsTpl(cur)) { _npbgShowTpl(layer, cur, seq); return; }
  _npbgPut(layer, cur === 'none' ? null : 'url', npBgSt.url);
}
// テンプレートを出す（写真は読み終わってから。表示中の1枚だけ読む。読めなければ同じ id のイラスト）
function _npbgShowTpl(layer, id, seq) {
  if (npBgStyle() !== 'photo' || npBgSt.photoBad[id]) { _npbgPut(layer, 'url', npBgSvgUrl(id)); return; }
  var url = npBgPhotoUrl(id), img = new Image();
  img.onload = function () { if (seq !== npBgSt.seq) return; _npbgPut(layer, 'url', url); _npbgCredit(id); };
  img.onerror = function () {
    if (seq !== npBgSt.seq) return;
    npBgSt.photoBad[id] = true;   // このページを開いている間はイラストにする
    console.warn('背景の写真を読めません（イラストで出します）', url);
    _npbgPut(layer, 'url', npBgSvgUrl(id));
  };
  img.src = url;
}
// 背景の層に絵を入れる（kind：'url' 画像／'svg' イラスト／null なし）。前の絵はふわっと消す
function _npbgPut(layer, kind, v) {
  var veil = layer.querySelector('.np-bg-veil');
  var olds = layer.querySelectorAll('.np-bg-art');
  var art = null;
  if (kind) {
    art = document.createElement('div');
    art.className = 'np-bg-art';
    // 中の .np-bg-pic に画像を敷き、表示の調整（大きさ・位置・ぼかし）は #now-playing の CSS の変数で付ける
    var pic = document.createElement('div');
    pic.className = 'np-bg-pic';
    pic.style.backgroundImage = 'url("' + (kind === 'svg' ? npBgSvgUrl(v) : v) + '")';
    art.appendChild(pic);
    layer.insertBefore(art, veil);
  }
  var reduced = typeof np !== 'undefined' && np.reduced;
  if (art && !reduced && olds.length) {
    art.classList.add('is-in');   // 透明から（style.css の transition で 0.6 秒）
    requestAnimationFrame(function () { requestAnimationFrame(function () { art.classList.remove('is-in'); }); });
    setTimeout(function () { olds.forEach(function (o) { if (o.parentNode) o.remove(); }); }, 700);
  } else {
    olds.forEach(function (o) { o.remove(); });
  }
}

// 写真の撮影者の表示（再生画面の右下の小さな「Photo: 撮影者 / ライセンス」。押すと写真のページ）
function _npbgCredit(id) {
  var host = document.getElementById('now-playing');
  if (!host) return;
  var el = document.getElementById('np-bg-credit');
  var c = id ? NPBG_PHOTO_CREDITS[id] : null;
  host.classList.toggle('np-has-photo', !!c);
  if (!c) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('a');
    el.id = 'np-bg-credit';
    el.className = 'np-bg-credit';
    el.target = '_blank'; el.rel = 'noopener';
    host.appendChild(el);
  }
  el.hidden = false;
  el.href = c.source;
  el.textContent = 'Photo: ' + c.author + ' / ' + c.license;
  el.title = c.title + '（' + c.author + '・' + c.license + '・Wikimedia Commons。縮小して使用）';
}

/* ---------- 写真のサムネイル（その場で縮めてメモリに持つ。1枚ずつ読むので重くならない） ---------- */
function _npbgPhotoThumbHtml(id, cls) {
  var u = npBgSt.thumbs[id];
  if (u === 'svg' || npBgSt.photoBad[id]) return '<span class="' + cls + '">' + npBgSvg(id) + '</span>';
  if (!u) _npbgThumbQueue(id);
  return '<span class="' + cls + ' npbg-thumb-photo" data-npbg-photo="' + id + '"' + (u ? ' style="background-image:url(&quot;' + u + '&quot;)"' : '') + '></span>';
}
function _npbgThumbQueue(id) {
  if (npBgSt.thumbs[id] || npBgSt.thumbQ.indexOf(id) >= 0) return;
  npBgSt.thumbQ.push(id);
  if (!npBgSt.thumbBusy) { npBgSt.thumbBusy = true; setTimeout(_npbgThumbNext, 0); }
}
function _npbgThumbNext() {
  var id = npBgSt.thumbQ.shift();
  if (!id) { npBgSt.thumbBusy = false; return; }
  var url = npBgPhotoUrl(id), img = new Image();
  var done = function (u) {
    npBgSt.thumbs[id] = u;
    document.querySelectorAll('[data-npbg-photo="' + id + '"]').forEach(function (e) {
      if (u === 'svg') e.innerHTML = npBgSvg(id); else e.style.backgroundImage = 'url("' + u + '")';
    });
    setTimeout(_npbgThumbNext, 0);
  };
  img.onload = function () {
    try {
      var cv = document.createElement('canvas'); cv.width = NPBG_THUMB_W; cv.height = NPBG_THUMB_H;
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.max(NPBG_THUMB_W / w, NPBG_THUMB_H / h);
      cv.getContext('2d').drawImage(img, (NPBG_THUMB_W - w * k) / 2, (NPBG_THUMB_H - h * k) / 2, w * k, h * k);
      cv.toBlob(function (b) { done(b ? URL.createObjectURL(b) : url); }, 'image/jpeg', 0.8);
    } catch (e) { done(url); }   // file:// で開いたときなど、縮められなければ元の写真をそのまま小さく出す
  };
  img.onerror = function () { npBgSt.photoBad[id] = true; done('svg'); };
  img.src = url;
}

/* ---------- 自分の画像（IndexedDB） ---------- */
var _npbgDbP = null;
function _npbgDb() {
  if (_npbgDbP) return _npbgDbP;
  _npbgDbP = new Promise(function (res, rej) {
    if (!window.indexedDB) { rej(new Error('IndexedDB を使えません')); return; }
    var q = indexedDB.open(NPBG_DB, 1);
    q.onupgradeneeded = function () { q.result.createObjectStore(NPBG_STORE); };
    q.onsuccess = function () { res(q.result); };
    q.onerror = function () { rej(q.error); };
  });
  _npbgDbP.catch(function () { _npbgDbP = null; });
  return _npbgDbP;
}
function _npbgReq(mode, fn) {
  return _npbgDb().then(function (d) {
    return new Promise(function (res, rej) {
      var tx = d.transaction(NPBG_STORE, mode), st = tx.objectStore(NPBG_STORE), r = fn(st);
      tx.oncomplete = function () { res(r && 'result' in r ? r.result : undefined); };
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error || new Error('保存を中止しました')); };
    });
  });
}
function npBgImageGet() { return _npbgReq('readonly', function (st) { return st.get(NPBG_KEY); }).catch(function (e) { console.warn('背景の画像を読めません', e); return null; }); }
function _npbgSetUrl(rec) {
  if (npBgSt.url) { try { URL.revokeObjectURL(npBgSt.url); } catch (e) { /* 無視 */ } }
  npBgSt.url = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
  npBgSt.info = rec && rec.blob ? { w: rec.w || 0, h: rec.h || 0, size: rec.blob.size || 0, at: rec.at || '' } : null;
}
function npBgLoad() {
  return npBgImageGet().then(function (rec) {
    _npbgSetUrl(rec);
    npBgSt.loaded = true;
    npBgApply(true);
    npBgRefreshPickers();
  });
}
function npBgHasImage() { return !!npBgSt.url; }
// 画像ファイル → 縮めた JPEG の Blob
function _npbgShrink(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, NPBG_IMG_MAX / Math.max(w, h || 1));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var cx = cv.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, cw, ch);   // 透明な所は黒に
      cx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      cv.toBlob(function (b) { if (b) res({ blob: b, w: cw, h: ch }); else rej(new Error('画像を縮められませんでした')); }, 'image/jpeg', NPBG_IMG_QUALITY);
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('画像として読めませんでした')); };
    img.src = url;
  });
}
async function npBgImageSave(blob, w, h, at) {
  var rec = { blob: blob, type: blob.type || 'image/jpeg', w: w || 0, h: h || 0, at: at || nowIso() };
  await _npbgReq('readwrite', function (st) { return st.put(rec, NPBG_KEY); });
  _npbgSetUrl(rec);
}
async function npBgPickImage(file) {
  if (!file) return;
  if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|bmp|avif|heic)$/i.test(file.name || '')) { showToast('画像のファイルを選んでください', true); return; }
  try {
    var r = await _npbgShrink(file);
    await npBgImageSave(r.blob, r.w, r.h);
    db.settings.npBg = 'custom'; saveDB();
    npBgApply(true);
    npBgRefreshPickers();
    showToast('背景に自分の画像を設定しました（' + r.w + '×' + r.h + '・' + Math.max(1, Math.round(r.blob.size / 1024)) + 'KB）');
  } catch (e) {
    console.warn(e);
    showToast('画像を設定できませんでした' + (e && e.message ? '（' + e.message + '）' : ''), true);
  }
}
async function npBgRemoveImage() {
  if (!npBgHasImage()) return;
  var ok = await showConfirm({ title: '自分の画像を外す', message: '再生画面の背景に設定した自分の画像を外します（このアプリに保存した縮小画像を消します。元の画像ファイルはそのままです）。<br>背景は「なし」に戻ります。', okText: '外す', danger: true });
  if (!ok) return;
  try { await _npbgReq('readwrite', function (st) { return st.delete(NPBG_KEY); }); } catch (e) { console.warn(e); showToast('画像を外せませんでした', true); return; }
  _npbgSetUrl(null);
  if (npBgSetting() === 'custom') db.settings.npBg = 'none';
  saveDB();
  npBgApply(true);
  npBgRefreshPickers();
  showToast('自分の画像を外しました');
}

/* ---------- バックアップ・復元（10-settings-backup.js から） ---------- */
function _npbgBlobToDataUrl(blob) {
  return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(blob); });
}
// バックアップ JSON に入れる中身（画像が無ければ null）
async function npBgBackupData() {
  try {
    var rec = await npBgImageGet();
    if (!rec || !rec.blob) return null;
    return { type: rec.type || rec.blob.type || 'image/jpeg', w: rec.w || 0, h: rec.h || 0, at: rec.at || '', data: await _npbgBlobToDataUrl(rec.blob) };
  } catch (e) { console.warn('背景の画像をバックアップに入れられません', e); return null; }
}
// バックアップの npBgImage：{ data: data URL, ... }（このアプリ）か、data URL の文字そのもの・{ dataUrl } も読む（PC版の形が違っても読めるように）
function _npbgImgData(o) {
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object') return typeof o.data === 'string' ? o.data : typeof o.dataUrl === 'string' ? o.dataUrl : typeof o.url === 'string' ? o.url : '';
  return '';
}
function _npbgValidImage(o) { return /^data:image\/[a-z0-9.+-]+;base64,/i.test(_npbgImgData(o)); }
function npBgBackupHasImage(obj) { return !!(obj && _npbgValidImage(obj.npBgImage)); }
// 復元：バックアップに画像があれば入れ替える。無ければ今の画像はそのまま。最後に表示を合わせる
async function npBgAfterRestore(obj) {
  if (npBgBackupHasImage(obj)) {
    try {
      var im = obj.npBgImage, m = _npbgImgData(im).match(/^data:([^;]+);base64,(.*)$/);
      var bin = atob(m[2]), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await npBgImageSave(new Blob([u8], { type: m[1] }), im.w || im.width, im.h || im.height, im.at);
    } catch (e) { console.warn('背景の画像を復元できません', e); showToast('再生画面の背景の画像は復元できませんでした（ほかのデータは復元しました）', true); }
  }
  npBgApply(true);
  npBgRefreshPickers();
}

/* ---------- 背景の選択肢（サムネイルの並び） ---------- */
var NP_BG_NONE_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/></svg>';
var NP_BG_PLUS_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5-8 9"/></svg>';
var NP_BG_JK_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.2"/></svg>';
// ジャケット・代表ジャケットのサムネイル：再生中の曲の画像をあとで入れる（曲が無い・画像が無ければアイコンのまま）
function _npbgJkThumbHtml(id, cls) { return '<span class="' + cls + ' npbg-thumb-jk" data-npbg-jk="' + id + '">' + NP_BG_JK_ICON + '</span>'; }
function _npbgFillJk(root) {
  var t = typeof player !== 'undefined' && player.currentPath && library.byPath ? library.byPath[player.currentPath] : null;
  if (!t || !root) return;
  root.querySelectorAll('[data-npbg-jk]').forEach(function (el) {
    _npbgJkUrl(el.getAttribute('data-npbg-jk'), t).then(function (u) {
      if (!u) return;
      el.innerHTML = ''; el.classList.add('has-img'); el.style.backgroundImage = 'url("' + u + '")';
    });
  });
}
function _npbgThumb(id) {
  if (_npbgIsJk(id)) return _npbgJkThumbHtml(id, 'npbg-thumb');
  if (id === 'none') return '<span class="npbg-thumb npbg-thumb-none">' + NP_BG_NONE_ICON + '</span>';
  var photo = npBgStyle() === 'photo';
  if (id === 'auto') return '<span class="npbg-thumb npbg-thumb-auto">' + ['sakura', 'sea', 'autumn', 'snow'].map(function (t) { return photo ? _npbgPhotoThumbHtml(t, 'npbg-auto-cell') : '<span>' + npBgSvg(t) + '</span>'; }).join('') + '<span class="npbg-auto-mark">AUTO</span></span>';
  if (id === 'custom') return npBgSt.url ? '<span class="npbg-thumb npbg-thumb-img" style="background-image:url(&quot;' + npBgSt.url + '&quot;)"></span>' : '<span class="npbg-thumb npbg-thumb-add">' + NP_BG_PLUS_ICON + '</span>';
  return photo ? _npbgPhotoThumbHtml(id, 'npbg-thumb') : '<span class="npbg-thumb">' + npBgSvg(id) + '</span>';
}
function npBgPickerHtml() {
  var cur = npBgSetting(), veil = npBgVeil(), style = npBgStyle();
  var ids = ['none', 'auto', 'jacket', 'repJacket'].concat(NPBG_TEMPLATES.map(function (t) { return t.id; })).concat(['custom']);
  // 絵の種類（写真／イラスト）：テンプレートと「自動」の出し方
  var h = '<div class="npbg-row npbg-style-row"><span class="npbg-row-label">絵の種類</span><div class="np-viz-seg npbg-seg" role="radiogroup" aria-label="背景の絵の種類（写真／イラスト）">' +
    Object.keys(NPBG_STYLES).map(function (k) { return '<button type="button" class="np-viz-seg-btn' + (k === style ? ' active' : '') + '" role="radio" aria-checked="' + (k === style) + '" data-npbg-style="' + k + '">' + NPBG_STYLES[k].label + '</button>'; }).join('') + '</div></div>';
  h += '<div class="npbg-grid" role="radiogroup" aria-label="再生画面の背景">' + ids.map(function (id) {
    var on = id === cur, name = npBgName(id);
    var tip = id === 'auto' ? '自動（曲ごとに切替）：曲が変わるたびにテンプレートから選びます。同じ曲ではいつも同じ背景' :
      id === 'custom' ? (npBgSt.url ? '自分の画像' : '自分の画像を選ぶ（スマホ・パソコンの画像ファイル）') : id === 'none' ? 'なし（今まで通り）' :
      id === 'jacket' ? 'ジャケット：再生中の曲のジャケット（曲が変わると切り替わる。無い曲は自動の背景）' :
      id === 'repJacket' ? '代表ジャケット：再生中の曲のアーティストの代表ジャケット（artist 画面で選んだもの。無ければアルバムのジャケット）' : '背景：' + name;
    return '<button type="button" class="npbg-opt' + (on ? ' is-cur' : '') + '" role="radio" aria-checked="' + on + '" data-npbg="' + id + '" title="' + tip + '">' +
      _npbgThumb(id) + '<span class="npbg-name">' + (({ none: 'なし', auto: '自動' })[id] || name) + '</span></button>';
  }).join('') + '</div>';
  h += '<div class="npbg-row"><span class="npbg-row-label">覆いの濃さ</span><div class="np-viz-seg npbg-seg" role="radiogroup" aria-label="背景の覆いの濃さ">' +
    Object.keys(NPBG_VEILS).map(function (k) { return '<button type="button" class="np-viz-seg-btn' + (k === veil ? ' active' : '') + '" role="radio" aria-checked="' + (k === veil) + '" data-npbg-veil="' + k + '">' + NPBG_VEILS[k].label + '</button>'; }).join('') + '</div></div>';
  h += npBgLookHtml();
  h += '<div class="npbg-row npbg-custom-row"><span class="npbg-row-label">自分の画像</span>' +
    '<button type="button" class="btn-inline-small" data-npbg-pick="1">' + ICONS.image + (npBgSt.url ? '画像を選び直す' : '画像を選ぶ') + '</button>' +
    (npBgSt.url ? '<button type="button" class="btn-inline-small btn-inline-danger" data-npbg-remove="1">' + ICONS.trash + '自分の画像を外す</button>' +
      '<span class="npbg-img-info">' + (npBgSt.info ? npBgSt.info.w + '×' + npBgSt.info.h + '・' + Math.max(1, Math.round(npBgSt.info.size / 1024)) + 'KB' : '') + '</span>' : '') +
    '<input type="file" accept="image/*" hidden data-npbg-file="1"></div>';
  var auto = cur === 'auto' && typeof player !== 'undefined' && player.currentPath ? '（今の曲：' + npBgName(npBgAutoFor(player.currentPath)) + '）' : '';
  h += '<p class="npbg-note">「絵の種類」で、テンプレートを写真とイラストのどちらで出すかを選びます（写真は再生画面で表示中の1枚だけ読み込み、右下に撮影者を表示します）。' +
    '「ジャケット」は再生中の曲のジャケット、「代表ジャケット」はそのアーティストの代表ジャケット（artist 画面で選んだもの。無ければアルバムのジャケット）を出します。ジャケットの無い曲は「自動」と同じ背景になります。ジャケットは小さな画像なので「ぼかし」を付けるときれいです。' +
    '「表示の調整」の大きさ・位置・ぼかしは、すべての背景に共通で、すぐ反映されます。' +
    '「自動（曲ごとに切替）」は曲が変わるたびに、選んだ種類のテンプレートから選びます' + auto + '。同じ曲ではいつも同じ背景です。Seasons Song の季節に入る曲は Spring→桜・Summer→海・Fall→紅葉・Winter→雪景色 になります。' +
    '背景の上には、文字が読みやすいよう覆い（ライトは白っぽく、ブラックは暗く）を重ねます。自分の画像は縮めて（長い辺 ' + NPBG_IMG_MAX + 'px）このブラウザに保存し、バックアップにも入ります。</p>';
  return h;
}
// 「表示の調整」（大きさ・位置・ぼかし。すべての背景に共通）
var NPBG_POS9 = [[0, 0, '左上'], [50, 0, '上'], [100, 0, '右上'], [0, 50, '左'], [50, 50, '中央'], [100, 50, '右'], [0, 100, '左下'], [50, 100, '下'], [100, 100, '右下']];
function _npbgRange(k, label, min, max, step, v, unit, help) {
  return '<label class="npbg-range"><span class="npbg-range-name">' + label + '</span>' +
    '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '" data-npbg-range="' + k + '" aria-label="' + label + '（' + help + '）">' +
    '<output class="npbg-range-val" data-npbg-range-val="' + k + '">' + _npbgRangeText(k, v) + '</output></label>';
}
function _npbgRangeText(k, v) { v = +v; return k === 'blur' ? (v ? v + 'px' : 'なし') : v + '%'; }
function npBgLookHtml() {
  var k = npBgLook();
  var h = '<div class="npbg-look"><div class="npbg-look-title">表示の調整<span class="npbg-look-sub">（すべての背景に共通）</span>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:4px" onclick="copyUiLabel(\'背景の表示の調整\', event)" title="クリックで「背景の表示の調整」をコピー">□</span>' +
    '<button type="button" class="npbg-look-reset" data-npbg-look-reset="1" title="画面に合わせる・中央・ぼかしなし に戻す">元に戻す</button></div>';
  h += '<div class="npbg-row"><span class="npbg-row-label">大きさ</span><div class="np-viz-seg npbg-seg" role="radiogroup" aria-label="背景の大きさ">' +
    Object.keys(NPBG_FITS).map(function (f) { return '<button type="button" class="np-viz-seg-btn' + (f === k.fit ? ' active' : '') + '" role="radio" aria-checked="' + (f === k.fit) + '" data-npbg-fit="' + f + '">' + NPBG_FITS[f].label + '</button>'; }).join('') + '</div></div>';
  if (k.fit === 'scale') h += _npbgRange('scale', '拡大率', 100, 300, 10, k.scale, '%', '100〜300%');
  h += '<div class="npbg-row npbg-pos-row"><span class="npbg-row-label">位置</span><div class="npbg-pos9" role="group" aria-label="背景の位置（9か所）">' +
    NPBG_POS9.map(function (q) { var on = q[0] === k.x && q[1] === k.y; return '<button type="button" class="npbg-pos-btn' + (on ? ' is-cur' : '') + '" data-npbg-pos="' + q[0] + ',' + q[1] + '" title="' + q[2] + '" aria-label="位置：' + q[2] + '" aria-pressed="' + on + '"><span></span></button>'; }).join('') +
    '</div><div class="npbg-pos-sliders">' + _npbgRange('x', '左右', 0, 100, 1, k.x, '%', '0 で左端・100 で右端') + _npbgRange('y', '上下', 0, 100, 1, k.y, '%', '0 で上端・100 で下端') + '</div></div>';
  h += _npbgRange('blur', 'ぼかし', 0, 30, 1, k.blur, 'px', '0 でぼかしなし。ジャケットは 8〜16px くらいがおすすめ');
  return h + '</div>';
}
// root の中に選択肢を描く（押したときの処理は1回だけ付ける）
function npBgRenderPicker(root) {
  if (!root) return;
  if (root._npbgDragging) return;   // スライダーを動かしている間は描き直さない
  root.innerHTML = npBgPickerHtml();
  root.classList.add('npbg-picker');
  _npbgFillJk(root);
  if (root._npbgBound) return;
  root._npbgBound = true;
  root.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-npbg')) {
      var id = b.getAttribute('data-npbg');
      if (id === 'custom' && !npBgSt.url) { var f = root.querySelector('[data-npbg-file]'); if (f) f.click(); return; }
      setNpBg(id);
      var nb = root.querySelector('[data-npbg="' + id + '"]'); if (nb) { try { nb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    } else if (b.hasAttribute('data-npbg-fit')) {
      var fv = b.getAttribute('data-npbg-fit');
      setNpBgLook({ fit: fv });
      var nf = root.querySelector('[data-npbg-fit="' + fv + '"]'); if (nf) { try { nf.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    } else if (b.hasAttribute('data-npbg-pos')) {
      var pv = b.getAttribute('data-npbg-pos').split(',');
      setNpBgLook({ x: +pv[0], y: +pv[1] });
      var np2 = root.querySelector('[data-npbg-pos="' + pv.join(',') + '"]'); if (np2) { try { np2.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    } else if (b.hasAttribute('data-npbg-look-reset')) {
      setNpBgLook({ fit: 'cover', scale: 100, x: 50, y: 50, blur: 0 });
    } else if (b.hasAttribute('data-npbg-style')) {
      var st = b.getAttribute('data-npbg-style');
      setNpBgStyle(st);
      var ns = root.querySelector('[data-npbg-style="' + st + '"]'); if (ns) { try { ns.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    } else if (b.hasAttribute('data-npbg-veil')) {
      var v = b.getAttribute('data-npbg-veil');
      setNpBgVeil(v);
      var nv = root.querySelector('[data-npbg-veil="' + v + '"]'); if (nv) { try { nv.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
    } else if (b.hasAttribute('data-npbg-pick')) {
      var fi = root.querySelector('[data-npbg-file]'); if (fi) fi.click();
    } else if (b.hasAttribute('data-npbg-remove')) npBgRemoveImage();
  });
  // 表示の調整のスライダー：動かしている間は値と文字だけ（すぐ反映）、離したら保存して描き直す
  root.addEventListener('input', function (ev) {
    var r = ev.target.closest && ev.target.closest('[data-npbg-range]');
    if (!r) return;
    root._npbgDragging = true;
    var k = r.getAttribute('data-npbg-range'), patch = {}; patch[k] = +r.value;
    setNpBgLook(patch, false);
    var o = root.querySelector('[data-npbg-range-val="' + k + '"]'); if (o) o.textContent = _npbgRangeText(k, r.value);
    if (k === 'x' || k === 'y') root.querySelectorAll('.npbg-pos-btn.is-cur').forEach(function (e) { e.classList.remove('is-cur'); });
  });
  // スライダーの上のキー（← → など）は再生画面の操作（前後の曲）に渡さない
  root.addEventListener('keydown', function (ev) { if (ev.target.closest && ev.target.closest('[data-npbg-range]') && ev.key !== 'Escape' && ev.key !== 'Tab') ev.stopPropagation(); });
  root.addEventListener('change', function (ev) {
    var rg = ev.target.closest && ev.target.closest('[data-npbg-range]');
    if (rg) {
      root._npbgDragging = false;
      var k2 = rg.getAttribute('data-npbg-range'), p2 = {}; p2[k2] = +rg.value;
      setNpBgLook(p2, true);
      var nr = root.querySelector('[data-npbg-range="' + k2 + '"]'); if (nr) { try { nr.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
      return;
    }
    var fi = ev.target.closest && ev.target.closest('[data-npbg-file]');
    if (!fi) return;
    var file = fi.files && fi.files[0];
    fi.value = '';
    if (file) npBgPickImage(file);
  });
}
// 開いている選択肢（tools・ダイアログ）と描き方メニューの「背景」の行を描き直す
function npBgRefreshPickers() {
  document.querySelectorAll('.npbg-picker').forEach(function (r) { if (r.isConnected) npBgRenderPicker(r); });
  _npbgMenuRow();
}

/* ---------- tools の「再生画面の背景（tools）」 ---------- */
function renderSetNpBg() {
  var el = document.getElementById('set-np-bg');
  if (!el) return;
  var host = el.querySelector('.npbg-picker-host');
  if (!host) {
    el.innerHTML = '<div class="npbg-picker-host"></div>' + npBgCreditsHtml();
    host = el.querySelector('.npbg-picker-host');
  }
  npBgRenderPicker(host);
}
// 「写真の撮影者・ライセンス」の一覧（tools。開閉できる）
function npBgCreditsHtml() {
  return '<details class="npbg-credits"><summary>写真の撮影者・ライセンス（' + NPBG_TEMPLATES.length + '枚）' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:6px" onclick="copyUiLabel(\'写真の撮影者・ライセンス\', event)" title="クリックで「写真の撮影者・ライセンス」をコピー">□</span></summary>' +
    '<p class="npbg-note">写真は Wikimedia Commons のものを、条件（撮影者・ライセンスの表示）に従って縮小して使っています。題名を押すと元の写真のページを開きます。</p><ul class="npbg-credit-list">' +
    NPBG_TEMPLATES.map(function (t) {
      var c = NPBG_PHOTO_CREDITS[t.id];
      if (!c) return '';
      return '<li><span class="npbg-credit-name">' + escapeHtml(t.name) + '</span>' +
        '<a href="' + escapeHtml(c.source) + '" target="_blank" rel="noopener">' + escapeHtml(c.title) + '</a>' +
        '<span class="npbg-credit-sub">撮影：' + escapeHtml(c.author) + ' ／ ' + escapeHtml(c.license) + '</span></li>';
    }).join('') + '</ul></details>';
}

/* ---------- 「背景の選択」ダイアログ（再生画面の描き方メニューから） ---------- */
function openNpBgDialog() {
  if (typeof npVizMenuClose === 'function') npVizMenuClose(false);
  openDialog({
    title: '背景の選択',   // v8.14.2：ダイアログの名前に合わせた（PC版と同じ）
    size: 'small',
    body: '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;float:right" onclick="copyUiLabel(\'背景の選択\', event)" title="クリックで「背景の選択」をコピー">□</span><div id="npbg-dlg"></div>',
    buttons: [{ label: '閉じる', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (body) { npBgRenderPicker(body.querySelector('#npbg-dlg')); }
  });
}

/* ---------- 「背景ボタン」（スマホ版 v8.14.2。再生画面の上の列、描き方ボタン ⓘ の右） ----------
   風景（山と太陽を枠で囲んだ）アイコンの丸いボタン。押すと「背景の選択」ダイアログを直接開く。大きさは描き方ボタンと同じ（40px。400px 以下は 36px） */
var NP_BG_BTN_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="16" cy="9.2" r="1.7"/><path d="M3.5 17.5l5.2-6 3.8 4.3 2.4-2.6 5.6 5.8"/></svg>';
function _npbgEnsureBtn() {
  var host = document.getElementById('now-playing');
  if (!host || document.getElementById('np-bg-btn')) return;
  var top = host.querySelector('.np-top');
  if (!top) return;
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'np-viz-btn np-bg-btn';
  b.id = 'np-bg-btn';
  b.title = '背景を選ぶ';
  b.setAttribute('aria-label', '背景を選ぶ');
  b.setAttribute('aria-haspopup', 'dialog');
  b.innerHTML = NP_BG_BTN_ICON;
  b.addEventListener('click', function () { openNpBgDialog(); });
  var after = top.querySelector('.np-viz-wrap');
  if (after) after.insertAdjacentElement('afterend', b);
  else { var lt = top.querySelector('#np-lyr-toggle'); if (lt) top.insertBefore(b, lt); else top.appendChild(b); }
}

/* ---------- 描き方メニュー（67-np-viz-menu.js）の先頭の「背景」の行 ---------- */
function _npbgMenuRow() {
  var menu = document.getElementById('np-viz-menu');
  if (!menu) return;
  var row = menu.querySelector('.npbg-mrow');
  if (!row) {
    row = document.createElement('div');
    row.className = 'npbg-mrow';
    menu.insertBefore(row, menu.firstChild);
  }
  var cur = npBgSetting(), shown = npBgCurrent(), photo = npBgStyle() === 'photo' && _npbgIsTpl(shown), key = cur + '|' + shown + '|' + (npBgSt.url || '') + '|' + (photo ? 'p' : 'i');
  if (row._key === key) return;   // 同じなら書き直さない（絵の id は毎回変わるので、中身ではなく選択で比べる）
  row._key = key;
  var html = '<span class="npbg-mrow-label">背景</span>' +
    '<button type="button" class="npbg-mrow-btn" data-npbg-open="1" title="再生画面の背景を選ぶ" aria-label="再生画面の背景を選ぶ（今：' + npBgName(cur) + '）">' +
      '<span class="npbg-mrow-thumb">' + (shown === 'none' ? NP_BG_NONE_ICON : shown === 'custom' ? '<span class="npbg-thumb-img" style="background-image:url(&quot;' + npBgSt.url + '&quot;)"></span>' : _npbgIsJk(shown) ? NP_BG_JK_ICON : photo ? _npbgPhotoThumbHtml(shown, 'npbg-thumb-img') : npBgSvg(shown)) + '</span>' +
      '<span class="npbg-mrow-name">' + npBgName(cur) + (cur === 'auto' && shown !== 'none' ? '：' + npBgName(shown) : '') + '</span>' +
      '<span class="npbg-mrow-go">選ぶ</span></button>';
  row.innerHTML = html;
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // 再生画面を作ったとき：背景の層・背景ボタンを足し、描き方メニューに「背景」の行
  var f = window._npEnsureDom;
  if (typeof f === 'function') {
    window._npEnsureDom = function () {
      var r = f.apply(this, arguments);
      try {
        _npbgEnsureLayer();
        _npbgEnsureBtn();   // 背景ボタン（v8.14.2）
        var menu = document.getElementById('np-viz-menu');
        if (menu && !menu._npbgBound) {
          menu._npbgBound = true;
          menu.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('[data-npbg-open]')) openNpBgDialog(); });
        }
        _npbgMenuRow();
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 描き方メニューを描き直したら「背景」の行を付け直す
  var m = window.npVizMenuRender;
  if (typeof m === 'function') {
    window.npVizMenuRender = function () {
      var r = m.apply(this, arguments);
      try { _npbgMenuRow(); } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生画面を描くたび（曲が変わったときなど）：背景を合わせる（同じなら何もしない）
  var n = window.npRender;
  if (typeof n === 'function') {
    window.npRender = function () {
      var r = n.apply(this, arguments);
      try { if (typeof np === 'undefined' || np.open) { npBgApply(false); if (npBgSetting() === 'auto') _npbgMenuRow(); } } catch (e) { console.warn(e); }
      return r;
    };
  }
})();
// 自分の画像を読み込んでおく（起動時に1回）
npBgLoad();

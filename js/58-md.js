/* =========================================================
   58-md.js ― 再生画面の「MD」（ミニディスク。v8.6。v8.6.1 でカラースケルトン〔半透明〕に作り替え）
   ・再生画面・プレイリストの play画面のプレイヤー表示の枠に、再生中の曲の MD を出す
     （回転CD・カセットテープ・レコードと同じ場所。どれか1つ。切り替えは 54-spin-cd.js の「プレイヤー表示ボタン」。db.settings.npVisual === 'md'）
   ・見た目（v8.6.1）：半透明の色付きのシェル（左上の角を斜めに切り欠き、縁の明るい光・成形の段差・ねじ穴のへこみ）越しに、
     中の銀色のディスク全体（虹色の回折の光・中央の金属のハブ）が透けて見える。上の真ん中に小さな▲と「INSERT THIS END」の刻印、
     MDシャッターは半透明のシェルの一部として控えめに（動かさない）。右側に小さな縦長の紙のラベル（その曲のジャケットの小さな絵・曲名・
     アーティスト・「74」「MD」の表記）。実在のメーカーのロゴは使わない
   ・シェルの色：その曲のジャケットの代表色（37-now-playing.js の _npDominant）の色合い。ジャケットが無い・読めないときは、
     曲ごとに黄・紫・赤・緑・青から決まった色（パスから計算）。明るさと透け具合はテーマ（ライト・ブラック）の色の変数で決める
   ・動き：再生中は中のディスクが回る（CSS の animation。transform: rotate だけ）。一時停止・停止中は animation-play-state: paused で
     その角度のまま止まり、再開するとそこから回る。光の反射（.np-md-shine）は回さない。
     prefers-reduced-motion では回さない（style.css）。再生画面を閉じている（display:none）ときは動かない
   ・大きさ・置き方はカセットテープ・レコード（v8.5.1）と同じ：枠の右端にそろえて 1.3倍、左は画面の左端で見切れてよい（ラベルは右側なので切れない）
   ・MD を押すとジャケット拡大表示
   ========================================================= */

var mdv = { path: undefined, watch: 0 };
var MD_HUES = [[48, 85], [272, 55], [356, 72], [152, 55], [208, 68]];   // ジャケットの無い曲の色合い（黄・紫・赤・緑・青）と鮮やかさ（%）
// プレイヤー表示ボタンの絵（MD）
var MD_ICON = _svg('<path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/><circle cx="10.5" cy="13" r="5"/><circle cx="10.5" cy="13" r="1.4"/><path d="M16 8h2.5v7H16z"/>');

function _mdEnsure(el) {
  var box = el.querySelector('#np-md-big');
  if (box) return box;
  var frame = typeof npVisFrame === 'function' ? npVisFrame(el) : null;   // プレイヤー表示の枠の中に置く
  if (!frame) return null;
  box = document.createElement('div');
  box.className = 'np-md-big'; box.id = 'np-md-big';
  box.innerHTML =
    '<span class="np-md-shadow" aria-hidden="true"></span>' +
    '<button type="button" class="np-md-body" id="np-md-body" title="ジャケットを大きく表示" aria-label="MD（押すとジャケットを大きく表示）">' +
      '<span class="np-md-disc" aria-hidden="true"></span>' +                     // 中のディスク（回る）
      '<span class="np-md-shine" aria-hidden="true"></span>' +                    // ディスクの光の反射（回さない）
      '<span class="np-md-front" aria-hidden="true"></span>' +                    // 手前の半透明のシェル
      '<span class="np-md-shutter" aria-hidden="true"></span>' +                  // MDシャッター（半透明・動かさない）
      '<span class="np-md-rim" aria-hidden="true"></span>' +                      // 成形の段差
      '<span class="np-md-hole np-md-hole-1" aria-hidden="true"></span><span class="np-md-hole np-md-hole-2" aria-hidden="true"></span>' +
      '<span class="np-md-hole np-md-hole-3" aria-hidden="true"></span><span class="np-md-hole np-md-hole-4" aria-hidden="true"></span>' +
      '<span class="np-md-insert" aria-hidden="true"><span class="np-md-arrow"></span>INSERT THIS END</span>' +
      '<span class="np-md-label">' +                                               // 右端に貼った横長の紙のラベル（v8.6.2）
        '<span class="np-md-art" id="np-md-art"></span>' +                         // 左：ジャケットの小さな絵
        '<span class="np-md-ltext">' +                                             // 右：曲名・アーティスト、下に「74」「MD」
          '<span class="np-md-title" id="np-md-title"></span><span class="np-md-artist" id="np-md-artist"></span>' +
          '<span class="np-md-mark"><span class="np-md-cap">74</span><span class="np-md-logo">MD</span></span>' +
        '</span>' +
      '</span>' +
    '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight np-md-labeltag" onclick="copyUiLabel(\'MD\', event)" title="クリックで「MD」をコピー">□</span>';
  frame.appendChild(box);
  box.querySelector('#np-md-body').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  return box;
}
// 見た目を合わせる（54-spin-cd.js の spinCdApply から。曲が変わったときだけラベルと色を作り直す）
function mdApply() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  var box = _mdEnsure(el);
  if (!box || !el.classList.contains('np-md-mode')) return;
  var path = player.currentPath || null;
  if (mdv.path === path) return;
  mdv.path = path;
  var t = path ? library.byPath[path] : null;
  var artEl = box.querySelector('#np-md-art');
  artEl.innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
  var title = path ? (t ? t.title : stripExt(splitPath(path).name)) : '曲が選ばれていません';
  var ti = box.querySelector('#np-md-title'), ar = box.querySelector('#np-md-artist');
  ti.textContent = title; ti.title = title;
  ar.textContent = t && t.artist ? t.artist : ''; ar.title = ar.textContent;
  box.querySelector('#np-md-body').disabled = !path;
  artObserve(box);
  _mdColor(box, artEl, path || '');
}

/* ---------- シェルの色 ---------- */
function _mdSetColor(box, hs) {
  box.style.setProperty('--md-h', hs[0]);
  box.style.setProperty('--md-s', hs[1] + '%');
}
// 曲ごとに決まった色（パスから計算。同じ曲はいつも同じ色）
function _mdHashColor(key) {
  var h = 0;
  for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return MD_HUES[Math.abs(h) % MD_HUES.length];
}
// 代表色（r,g,b）→ 色合い（度）と鮮やかさ（%。シェルとして見えるよう 40〜80% に）。色の少ない（白黒に近い）ジャケットは null
function _mdHueOf(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.06) return null;
  var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round((h * 60 + 360) % 360);
  var l = (mx + mn) / 2, s = d / (1 - Math.abs(2 * l - 1));
  return [h, Math.round(Math.min(80, Math.max(40, s * 100)))];
}
function _mdColor(box, artEl, key) {
  clearTimeout(mdv.watch);
  // 毎回ジャケットから求める（24×24 に縮めるだけなので軽い。ジャケットを変えたときもすぐ色が合う）
  _mdSetColor(box, _mdHashColor(key));   // 画像を読むまで（読めなければそのまま）は曲ごとの色
  var tries = 0;
  var done = function (img) {
    if (mdv.path !== key && (mdv.path || '') !== key) return;
    var c = typeof _npDominant === 'function' ? _npDominant(img) : null, hs = c ? _mdHueOf(c) : null;
    if (!hs) hs = _mdHashColor(key);
    _mdSetColor(box, hs);
  };
  var check = function () {
    if ((mdv.path || '') !== key) return;
    var img = artEl.querySelector('img');
    if (img && img.complete && img.naturalWidth) { done(img); return; }
    if (img && !img.complete) { img.addEventListener('load', function () { done(img); }, { once: true }); return; }
    if (artEl.querySelector('.art-none:not(.art-pending)')) return;   // ジャケットが無い曲は曲ごとの色のまま
    if (++tries < 30) mdv.watch = setTimeout(check, 200);
  };
  check();
}

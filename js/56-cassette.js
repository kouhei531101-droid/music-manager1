/* =========================================================
   56-cassette.js ― 再生画面の「カセットテープ」（v8.4）
   ・再生画面・プレイリストの play画面の左に、再生中の曲のカセットテープを出す（回転CD と同じ場所。どちらか一方。
     切り替えは 54-spin-cd.js の「プレイヤー表示ボタン」。db.settings.npVisual === 'cassette'）
   ・見た目：カセット本体（ねじ・下の台形の部分）、ラベル（その曲のジャケットを背景に、上の白い帯に A面の印・曲名・アーティスト）、
     真ん中の窓（左右のリールと巻かれたテープ）。ジャケットの無い曲は、テーマの紫とオレンジの既定のラベル
   ・動き：再生中は左右のリールが回る（CSS の animation。transform: rotate だけ）。一時停止・停止中は animation-play-state: paused で
     その角度のまま止まり、再開するとそこから回る（回転CD と同じ）。再生位置に合わせて、左の巻いたテープが減り右が増える
     （巻いたテープの円の transform: scale。面積が変わらないように半径を計算。audio の timeupdate〔1秒に約4回〕で合わせる）
   ・再生画面を閉じている・カセットテープでないとき（display:none）は回らない・計算しない。prefers-reduced-motion では回さない
   ・カセットを押すとジャケット拡大表示
   ========================================================= */

var cst = { path: undefined, bound: false, l: -1, r: -1 };
var CST_HUB = 0.4;   // 巻いたテープの円の大きさ（いっぱいのとき 1）に対する、リールの芯の大きさ
// プレイヤー表示ボタンの絵（カセットテープ）
var CST_ICON = _svg('<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><path d="M10 11h4"/><path d="M6.5 19l1.5-3h8l1.5 3"/>');

// カセットテープの本体（.np-main の先頭）：置き場所 .np-cs-big ＞ 押せる本体 .np-cs-body ＞ ラベル・窓・下の部分・ねじ
function _cstEnsure(el) {
  var box = el.querySelector('#np-cs-big');
  if (box) return box;
  var main = npVisFrame(el);   // v8.5：プレイヤー表示の枠の中に置く
  if (!main) return null;
  box = document.createElement('div');
  box.className = 'np-cs-big'; box.id = 'np-cs-big';
  box.innerHTML =
    '<button type="button" class="np-cs-body" id="np-cs-body" title="ジャケットを大きく表示" aria-label="カセットテープ（押すとジャケットを大きく表示）">' +
      '<span class="np-cs-label">' +                                             // ラベル（ジャケットの絵）
        '<span class="np-cs-art" id="np-cs-art"></span>' +
        '<span class="np-cs-strip"><span class="np-cs-side">A</span>' +           // 上の白い帯：A面・曲名・アーティスト
          '<span class="np-cs-title" id="np-cs-title"></span><span class="np-cs-artist" id="np-cs-artist"></span></span>' +
        '<span class="np-cs-window" aria-hidden="true">' +                        // 窓：巻いたテープとリール
          '<span class="np-cs-pack np-cs-pack-l"></span><span class="np-cs-pack np-cs-pack-r"></span>' +
          '<span class="np-cs-reel np-cs-reel-l"></span><span class="np-cs-reel np-cs-reel-r"></span>' +
        '</span>' +
      '</span>' +
      '<span class="np-cs-bottom" aria-hidden="true"></span>' +                  // 下の台形の部分（テープの出る所）
      '<span class="np-cs-screw np-cs-screw-1" aria-hidden="true"></span><span class="np-cs-screw np-cs-screw-2" aria-hidden="true"></span>' +
      '<span class="np-cs-screw np-cs-screw-3" aria-hidden="true"></span><span class="np-cs-screw np-cs-screw-4" aria-hidden="true"></span>' +
    '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight np-cs-labeltag" onclick="copyUiLabel(\'カセットテープ\', event)" title="クリックで「カセットテープ」をコピー">□</span>';
  main.appendChild(box);
  box.querySelector('#np-cs-body').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  return box;
}
function _cstBind() {
  if (cst.bound || !player.audio) return;
  cst.bound = true;
  ['timeupdate', 'loadedmetadata', 'seeked', 'emptied', 'ended'].forEach(function (e) { player.audio.addEventListener(e, _cstProgress); });
}
// 見た目を合わせる（54-spin-cd.js の spinCdApply から。曲が変わったときだけラベルを作り直す）
function cassetteApply() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  var box = _cstEnsure(el);
  if (!box || !el.classList.contains('np-cs-mode')) return;
  _cstBind();
  var path = player.currentPath || null;
  if (cst.path !== path) {
    cst.path = path;
    var t = path ? library.byPath[path] : null;
    box.querySelector('#np-cs-art').innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    var title = path ? (t ? t.title : stripExt(splitPath(path).name)) : '曲が選ばれていません';
    var ti = box.querySelector('#np-cs-title'), ar = box.querySelector('#np-cs-artist');
    ti.textContent = title; ti.title = title;
    ar.textContent = t && t.artist ? t.artist : ''; ar.title = ar.textContent;
    box.querySelector('#np-cs-body').disabled = !path;
    artObserve(box);
  }
  _cstProgress();
}
// 再生位置 → 左右の巻いたテープの大きさ（テープの量＝円の面積が、左から右へ移る）
function _cstProgress() {
  if (typeof np === 'undefined' || !np.open) return;
  var el = document.getElementById('now-playing'), box = document.getElementById('np-cs-big');
  if (!el || !box || !el.classList.contains('np-cs-mode')) return;
  var a = player.audio, d = a ? a.duration : 0, p = (a && isFinite(d) && d > 0 && player.currentPath) ? Math.min(1, Math.max(0, a.currentTime / d)) : 0;
  var h2 = CST_HUB * CST_HUB;
  var l = Math.round(Math.sqrt(h2 + (1 - p) * (1 - h2)) * 1000) / 1000, r = Math.round(Math.sqrt(h2 + p * (1 - h2)) * 1000) / 1000;
  if (l === cst.l && r === cst.r) return;
  cst.l = l; cst.r = r;
  box.style.setProperty('--cs-l', l);
  box.style.setProperty('--cs-r', r);
}

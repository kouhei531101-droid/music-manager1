/* =========================================================
   54-spin-cd.js ― 再生画面の「回転CD」（v8.3。v8.3.1 で大きく）と「プレイヤー表示」の切り替え（v8.4）
   ・再生画面・プレイリストの play画面の左に、再生中の曲の大きな CD（中心に穴・透明のハブ・外周のふち・光沢）を出し、
     再生中は回し、一時停止・停止中は止める。v8.3.1：ジャケットの約2倍の大きさにして、画面の左端から約1/3 はみ出す（見切れる）置き方にした。
     ジャケットの並び（40-coverflow.js。前後の曲の四角いジャケット）と曲名・操作は、CD の右（スマホ幅は CD の下）に小さめに並べ直す（style.css）
   ・回すのは CSS の animation（.np-cd-spin の transform: rotate だけ）。止めるときは animation-play-state: paused なので、
     止めた角度のまま止まり、再開するとそこから回る。曲が変わっても回っている入れ物はそのままで、中の画像だけ差し替える（角度は飛ばない）
   ・ディスクの絵はその曲のジャケット（13-artwork.js の artThumbHtml の控えをそのまま使う）。画像が無い曲は銀色の既定のディスク
   ・CD を押すとジャケット拡大表示（今までの大きなジャケットと同じ）
   ・v8.4：回転CD とカセットテープ（56-cassette.js）のどちらを出すかを「プレイヤー表示」として選ぶ（db.settings.npVisual：'cd'／'cassette'／'none'）。
     上の「プレイヤー表示ボタン」を押すたびに 回転CD → カセットテープ → レコード（v8.5。57-record.js）→ MD（v8.6。58-md.js）→ なし → 回転CD … と切り替わる。バックアップ・復元の対象。
     npVisual が無い古いデータ・バックアップは、v8.3 の db.settings.npSpinCd（false ならなし、それ以外は回転CD）として読む。
     前の版でも同じ見た目になるよう、npSpinCd も合わせて書く（カセットテープ・なしのときは false）。「なし」は今までの表示
   ・再生画面を閉じている・隠している（display:none）ときは回らない。prefers-reduced-motion では回さない（style.css）
   ========================================================= */

var scd = { bound: false, path: undefined };
// 回転CD の絵（ディスクと回る矢印。曲リストボタンのディスクの絵と見分けられるように）
var SCD_ICON = _svg('<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M18.6 2.6v3.6H15"/>');

// プレイヤー表示の順（ボタンを押すと次へ）。v8.5 でレコード（57-record.js）、v8.6 で MD（58-md.js）を足した
var NP_VISUALS = [['cd', '回転CD'], ['cassette', 'カセット'], ['record', 'レコード'], ['md', 'MD'], ['none', 'なし']];
var NP_VISUAL_LONG = { cd: '回転CD', cassette: 'カセットテープ', record: 'レコード', md: 'MD（ミニディスク）', none: 'なし（今までの表示）' };   // ボタンの説明に使う名前
// 今のプレイヤー表示（v8.4。古いデータは npSpinCd から読む）
function npVisual() {
  var st = db.settings || {}, v = st.npVisual;
  if (NP_VISUALS.some(function (x) { return x[0] === v; })) return v;
  return st.npSpinCd === false ? 'none' : 'cd';
}
function setNpVisual(v) {
  db.settings.npVisual = v;
  db.settings.npSpinCd = v === 'cd';   // 前の版（v8.3）で開いても、なるべく同じ見た目に
  saveDB();
  spinCdApply();
}
function spinCdOn() { return npVisual() === 'cd'; }

// 「プレイヤー表示ボタン」（曲リストボタン〔無ければ歌詞ボタン〕の右。v8.3 の「回転CD」ボタンを v8.4 で切り替えボタンにした）
function _scdEnsureToggle(el) {
  var tg = el.querySelector('#np-vis-toggle');
  if (tg) return tg;
  var after = el.querySelector('#np-al-toggle') || el.querySelector('#np-lyr-toggle');
  if (!after) return null;
  tg = document.createElement('button');
  tg.className = 'np-lyr-toggle np-vis-toggle'; tg.id = 'np-vis-toggle';
  after.insertAdjacentElement('afterend', tg);
  tg.addEventListener('click', function () {
    var cur = npVisual(), i = NP_VISUALS.findIndex(function (x) { return x[0] === cur; });
    setNpVisual(NP_VISUALS[(i + 1) % NP_VISUALS.length][0]);
  });
  return tg;
}
function _npVisualName(v) { var x = NP_VISUALS.find(function (y) { return y[0] === v; }); return x ? x[1] : ''; }
// 「プレイヤー表示の枠」（v8.5。.np-main の先頭。回転CD・カセットテープ・レコードはこの中に置く。大きさは表示の種類によらず同じ〔style.css〕）
function npVisFrame(el) {
  var fr = el.querySelector('#np-vis-frame');
  if (fr) return fr;
  var main = el.querySelector('.np-main');
  if (!main) return null;
  fr = document.createElement('div');
  fr.className = 'np-vis-frame'; fr.id = 'np-vis-frame';
  main.insertBefore(fr, main.firstChild);
  return fr;
}
// 回転CD の本体（プレイヤー表示の枠の中）：置き場所 .np-cd-big ＞ 押せる円 .np-cd-disc ＞ 回る .np-cd-spin（ジャケット）＋ 回らない飾り .np-cd-deco
function _scdEnsureDisc(el) {
  var box = el.querySelector('#np-cd-big');
  if (box) return box;
  var main = npVisFrame(el);   // v8.5：プレイヤー表示の枠の中に置く
  if (!main) return null;
  box = document.createElement('div');
  box.className = 'np-cd-big'; box.id = 'np-cd-big';
  box.innerHTML = '<button type="button" class="np-cd-disc" id="np-cd-disc" title="ジャケットを大きく表示" aria-label="回転CD（押すとジャケットを大きく表示）">' +
      '<span class="np-cd-spin" id="np-cd-spin"></span><span class="np-cd-deco" aria-hidden="true"></span></button>' +
    '<span class="ui-label-tag ui-label-tag-onlight np-cd-label" onclick="copyUiLabel(\'回転CD\', event)" title="クリックで「回転CD」をコピー">□</span>';
  main.appendChild(box);
  box.querySelector('#np-cd-disc').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  return box;
}
// 再生・一時停止に合わせて回す・止める（audio の出来事を1回だけ見張る。回転CD・カセットテープ共通）
function _scdBind() {
  if (scd.bound || !player.audio) return;
  scd.bound = true;
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (e) { player.audio.addEventListener(e, _scdPlayState); });
}
function _scdPlayState() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  el.classList.toggle('np-is-playing', !!(player.audio && !player.audio.paused && !player.audio.ended && player.currentPath));
}

// 見た目を合わせる（再生画面を描くたび・ジャケットの並びを動かすたびに呼ばれる。曲が変わったときだけ画像を差し替える）
function spinCdApply() {
  var el = document.getElementById('now-playing');
  if (!el) return;
  _scdBind();
  var vis = npVisual(), on = vis === 'cd', tg = _scdEnsureToggle(el), box = _scdEnsureDisc(el);
  if (tg) {
    var next = NP_VISUALS[(NP_VISUALS.findIndex(function (x) { return x[0] === vis; }) + 1) % NP_VISUALS.length][0];
    var icon = vis === 'cassette' && typeof CST_ICON !== 'undefined' ? CST_ICON : vis === 'record' && typeof RC_ICON !== 'undefined' ? RC_ICON : vis === 'md' && typeof MD_ICON !== 'undefined' ? MD_ICON : SCD_ICON;
    tg.innerHTML = icon + _npVisualName(vis);
    tg.classList.toggle('active', vis !== 'none');
    tg.setAttribute('aria-label', 'プレイヤー表示：' + _npVisualName(vis));
    tg.title = 'プレイヤー表示：' + NP_VISUAL_LONG[vis] + '（押すと「' + (next === 'none' ? 'なし' : NP_VISUAL_LONG[next]) + '」に切り替え）';
  }
  el.classList.add('np-vis-mode');   // 左にプレイヤー表示の枠を置く並び（v8.5：「なし」でも同じ並びにして、切り替えても大きさ・位置を変えない）
  el.classList.toggle('np-cd-mode', on);
  el.classList.toggle('np-cs-mode', vis === 'cassette');
  el.classList.toggle('np-rc-mode', vis === 'record');
  el.classList.toggle('np-md-mode', vis === 'md');
  _scdPlayState();
  if (typeof cassetteApply === 'function') cassetteApply();
  if (typeof recordApply === 'function') recordApply();
  if (typeof mdApply === 'function') mdApply();
  if (!box || !on) return;
  var path = player.currentPath || null;
  if (scd.path !== path) {
    scd.path = path;
    var t = path ? library.byPath[path] : null, spin = box.querySelector('#np-cd-spin');
    spin.innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    box.querySelector('#np-cd-disc').disabled = !path;
    artObserve(box);
  }
}

// ジャケットの並びの位置合わせ（npRender → flowRender の中）のあとに合わせる
(function () {
  var f = window._flowPlace;
  if (typeof f !== 'function') return;
  window._flowPlace = function () { var r = f.apply(this, arguments); try { spinCdApply(); } catch (e) { console.warn(e); } return r; };
})();

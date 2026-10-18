/* =========================================================
   00-view-mode.js ― 表示モード（スマホ版 v8.24.1）
   ・tools の「表示モード」（#set-view-mode）で「自動」「スマホ表示」「PC表示」を選ぶ
       自動     ：タッチ端末（pointer: coarse かつ maxTouchPoints > 0）で、画面の短い辺が 1200px 以下（タブレットの大きさ）なら
                  スマホ表示にする。マウスが主の PC は今までどおり画面の幅で決める
       スマホ表示：画面の幅に関係なく、スマホの並び（下部メニューバー・再生画面のひと画面・フリック・全画面ボタンなど）にする
       PC表示   ：今までどおり画面の幅で決める（幅 760px 以下・横向きのスマホだけスマホの並び）
   ・しくみ：style.css の「スマホ幅」の @media の条件の文字を、その場で書き換える（CSSOM の MediaList.mediaText）
       (max-width: 700/760/900/1000px) → いつも当てはまる「(min-width: 0px)」
       (max-height: 500px)（横向きのスマホの条件）→ いつも当てはまる（＝横向きなら横向きのスマホの並び）
       (min-width: 761px / 1001px)（PC 幅だけの条件）→ 当てはまらない「(max-width: 0px)」
       それより細かい幅（400px・480px など）・高さの条件は書き換えない（本当の画面の大きさで決まる）
     JS の判定（59-mobile.js の isMobileLayout、71-np-landscape.js の npOneLand）も vmMql() で同じ書き換えをした条件を見る
   ・切り替えはその場で反映する（ページの読み込み直しはしない＝スマホで音楽フォルダを選び直さなくてよい）
   ・保存：localStorage の 'musicManager_viewMode'（'auto' / 'mobile' / 'pc'）。端末ごとの好みなのでバックアップには入れない
   ・index.html の <head> で style.css の直後に読み込む（最初の描画の前に当てる。ほかの js より前）
   ・html に class「view-mobile」（スマホ表示を当てているとき）を付ける
   ========================================================= */

var VIEW_MODE_KEY = 'musicManager_viewMode';
var VIEW_MODE_NAMES = { auto: '自動', mobile: 'スマホ表示', pc: 'PC表示' };

// 保存している表示モード（無い・壊れているときは「自動」）
function viewModeSetting() {
  var v = null;
  try { v = localStorage.getItem(VIEW_MODE_KEY); } catch (e) { v = null; }
  return v === 'mobile' || v === 'pc' ? v : 'auto';
}

// タッチが主のタブレット（またはスマホ）か
function viewModeIsTouchTablet() {
  try {
    var coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    var touch = (navigator.maxTouchPoints || 0) > 0;
    var s = window.screen || {}, shortSide = Math.min(s.width || 0, s.height || 0);
    return coarse && touch && shortSide > 0 && shortSide <= 1200;
  } catch (e) { return false; }
}

// 今、スマホ表示を当てるか（画面の幅でのスマホの並びとは別に「幅に関係なく」当てるか）
function viewModeForced() {
  var m = viewModeSetting();
  if (m === 'mobile') return true;
  if (m === 'pc') return false;
  return viewModeIsTouchTablet();
}

var _vm = { forced: false, rules: null, mqls: {} };

// メディアクエリの条件の文字を書き換える（スマホ表示を当てていないときはそのまま）
function vmMq(text) {
  if (!_vm.forced) return text;
  return String(text)
    .replace(/\(\s*max-width\s*:\s*(700|760|900|1000)px\s*\)/g, '(min-width: 0px)')
    .replace(/\(\s*max-height\s*:\s*500px\s*\)/g, '(min-width: 0px)')
    .replace(/\(\s*min-width\s*:\s*(761|1001)px\s*\)/g, '(max-width: 0px)');
}
// JS 用：書き換えた条件の matchMedia（同じ条件は使い回す）
function vmMql(text) {
  if (!window.matchMedia) return null;
  var q = vmMq(text);
  return _vm.mqls[q] || (_vm.mqls[q] = window.matchMedia(q));
}

// style.css などの @media を集める（最初の1回だけ。元の条件を控えておき、切り替えのときに戻せるようにする）
function _vmCollectRules() {
  if (_vm.rules) return _vm.rules;
  var list = [];
  var walk = function (rules) {
    if (!rules) return;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.media && typeof r.media.mediaText === 'string' && r.cssRules) list.push({ rule: r, orig: r.media.mediaText });
      if (r.cssRules) walk(r.cssRules);
    }
  };
  _vm.cssOk = false;
  for (var i = 0; i < document.styleSheets.length; i++) {
    var sh = document.styleSheets[i], rules = null;
    try { rules = sh.cssRules; } catch (e) { rules = null; }   // 別のサイトの CSS（文字のフォント）は読めないので飛ばす
    if (rules && sh.href && /style\.css(\?|$)/.test(sh.href)) _vm.cssOk = true;
    walk(rules);
  }
  _vm.rules = list;
  return list;
}

// 今の設定を画面に当てる（CSS の条件・html の class）
// style.css の中身を読めないとき（file:// で開いたときなど）は、CSS と JS の判定がずれないよう、スマホ表示を当てない
function applyViewMode() {
  _vmCollectRules();
  _vm.forced = viewModeForced() && _vm.cssOk;
  document.documentElement.classList.toggle('view-mobile', _vm.forced);
  var list = _vmCollectRules();
  list.forEach(function (it) {
    var want = _vm.forced ? vmMq(it.orig) : it.orig;
    try { if (it.rule.media.mediaText !== want) it.rule.media.mediaText = want; } catch (e) { /* 書き換えられないときはそのまま */ }
  });
  return _vm.forced;
}

// 最初の描画の前に当てる（style.css は読み込み済み）
try { applyViewMode(); } catch (e) { console.warn('表示モードを当てられませんでした', e); }

/* ---------- tools の「表示モード」 ---------- */
// 選んだとき：保存して、その場で反映する
function setViewMode(v) {
  v = v === 'mobile' || v === 'pc' ? v : 'auto';
  try { localStorage.setItem(VIEW_MODE_KEY, v); } catch (e) { /* 保存できなくても今回は反映する */ }
  applyViewMode();
  // 並びが変わったので、測り直し・描き直す
  try { if (typeof npLandBind === 'function') npLandBind(); } catch (e) { console.warn(e); }
  try { window.dispatchEvent(new Event('resize')); } catch (e) { /* 古いブラウザ */ }
  try { if (typeof npOneSync === 'function') npOneSync(); } catch (e) { console.warn(e); }
  try { if (typeof npLandRelayout === 'function') npLandRelayout(); } catch (e) { console.warn(e); }
  try { if (typeof renderAll === 'function') renderAll(); } catch (e) { console.warn(e); }
  renderViewModeSetting();
  if (typeof showToast === 'function') showToast('表示モードを「' + VIEW_MODE_NAMES[v] + '」にしました');
}

// 「表示モード」の欄（ラジオボタンと、今どちらで表示しているか）を合わせる
function renderViewModeSetting() {
  var box = document.getElementById('set-view-mode');
  if (!box) return;
  var m = viewModeSetting();
  box.querySelectorAll('input[name="view-mode"]').forEach(function (r) { r.checked = r.value === m; });
  var info = document.getElementById('set-view-mode-now');
  if (!info) return;
  var mobileNow = vmMql('(max-width: 760px), (orientation: landscape) and (max-height: 500px) and (max-width: 1000px)');
  var isMobile = mobileNow ? mobileNow.matches : window.innerWidth <= 760;
  var why;
  if (m === 'mobile') why = '「スマホ表示」を選んでいるため';
  else if (m === 'pc') why = '画面の幅で決めています';
  else why = viewModeIsTouchTablet() ? 'タッチ端末なのでスマホ表示にしています' : 'マウスの端末なので画面の幅で決めています';
  if (viewModeForced() && !_vm.cssOk) why = 'このファイルの開き方（file:// など）では切り替えられないため、画面の幅で決めています';
  info.textContent = 'いまの表示：' + (isMobile ? 'スマホの並び' : 'PC の並び') + '（' + why + '）';
}

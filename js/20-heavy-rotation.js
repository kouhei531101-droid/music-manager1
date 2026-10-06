/* =========================================================
   20-heavy-rotation.js ― 再生回数の記録と「heavy rotation」画面（v2.2）
   ・再生回数：1回の再生で「半分」か「30秒」の短い方を聞いたら1回（06-player.js が recordPlay を呼ぶ。
     シークで飛ばした分は数えない）
   ・db.playStats = { 曲の相対パス: { c:回数, l:最終再生（ミリ秒）, h:[最近の再生日時（最大50件）] } }
     バックアップ・復元に含む。ファイル整理で移動・名前変更しても付いていく（09-file-ops.js の applyPathMapping）
   ・heavy rotation：回数の多い順。期間（全期間／直近7日・30日・90日）を選べる。期間の回数は最近50回分の記録から数える
   ・回数のリセットは tools（設定・バックアップ）から（確認付き）
   ========================================================= */

var PLAY_HISTORY_MAX = 50;
var HEAVY_PERIODS = [[0, '全期間'], [7, '直近7日'], [30, '直近30日'], [90, '直近90日']];
var heavyView = { list: [] };

PAGE_RENDERERS.heavy = renderHeavyPage;

function recordPlay(path) {
  if (!path) return;
  var s = db.playStats[path] || { c: 0, l: 0, h: [] };
  var now = Date.now();
  s.c = (s.c || 0) + 1;
  s.l = now;
  s.h = (s.h || []).concat([now]).slice(-PLAY_HISTORY_MAX);
  db.playStats[path] = s;
  saveDB();
  if (currentPage === 'heavy') renderHeavyPage();
}
function playCountOf(path, days) {
  var s = db.playStats[path];
  if (!s) return 0;
  if (!days) return s.c || 0;
  var since = Date.now() - days * 86400000;
  return (s.h || []).filter(function (x) { return x >= since; }).length;
}
function getHeavyList() {
  var days = +(ui.heavyDays || 0);
  return library.tracks.map(function (t) { return { t: t, n: playCountOf(t.path, days) }; })
    .filter(function (x) { return x.n > 0; })
    .sort(function (a, b) { return (b.n - a.n) || ((db.playStats[b.t.path].l || 0) - (db.playStats[a.t.path].l || 0)); })
    .slice(0, 500);
}
function renderHeavyPage() {
  var days = +(ui.heavyDays || 0);
  document.getElementById('hr-days').innerHTML = HEAVY_PERIODS.map(function (o) {
    return '<button class="tab-btn' + (o[0] === days ? ' active' : '') + '" data-days="' + o[0] + '">' + o[1] + '</button>';
  }).join('');
  var body = document.getElementById('hr-body'), countEl = document.getElementById('hr-count');
  if (!isConnected()) { body.innerHTML = welcomeCardHtml(); countEl.textContent = ''; return; }
  if (!library.scanned) { body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>'; return; }
  var items = getHeavyList();
  heavyView.list = items.map(function (x) { return x.t; });
  countEl.textContent = items.length + '曲';
  if (!items.length) { body.innerHTML = '<div class="empty-msg">この期間に再生した曲はまだありません。曲を半分（または30秒）以上聞くと1回と数えます。</div>'; return; }
  body.innerHTML = songTableHtml(heavyView.list, { extra: { head: '回数・最終再生', cell: function (t, i) {
    var s = db.playStats[t.path] || {};
    return '<span class="play-count">' + items[i].n + '回</span><span class="song-sub">' + formatDateShort(s.l) + '</span>';
  } } }) + '<p class="lib-legend">曲を半分（短い曲以外は30秒）以上聞くと1回と数えます。期間を選んだときは、曲ごとに最近50回分の記録から数えます。</p>';
  artObserve(body);
}
async function resetPlayCounts() {
  var n = Object.keys(db.playStats || {}).length;
  var ok = await showConfirm({
    title: '再生回数のリセット',
    message: '記録した再生回数と最終再生日時（' + n + '曲分）をすべて消します。heavy rotation は空になります。<br><span class="dialog-hint">音楽ファイルは変わりません。念のため、先にバックアップしておくと元に戻せます。</span>',
    okText: 'リセットする', danger: true
  });
  if (!ok) return;
  db.playStats = {};
  saveDB();
  renderAll();
  showToast('再生回数をリセットしました。');
}
function initHeavyPage() {
  document.getElementById('hr-days').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-days]'); if (!b) return;
    ui.heavyDays = +b.getAttribute('data-days'); saveUi(); renderHeavyPage();
  });
  bindSongTable(document.getElementById('hr-body'), function () { return heavyView.list; }, 'heavy rotation');
  document.getElementById('hr-play').addEventListener('click', function () {
    var l = heavyView.list; if (l.length) playQueue(l.map(function (t) { return t.path; }), 0, 'heavy rotation');
  });
}

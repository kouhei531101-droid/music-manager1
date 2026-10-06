/* =========================================================
   47-shuffle-play.js ― シャッフル再生ボタン（v7.5）
   ・「連続再生」などの再生ボタンの右に、シャッフルのアイコンだけのボタン（title・aria-label「シャッフル再生」）
     プレイリストの曲（07）・アルバムの曲一覧（14）・artist（21。v2.2 からの文字のボタンをアイコンだけに）・Seasons Song（46）・
     songs・new songs・heavy rotation のヘッダー（index.html。ここで受ける）
   ・動き：再生バーのシャッフルをオンにして（表示もオン）、その一覧をばらばらの順で、最初の曲もばらばらに選んで再生する。
     オフに戻すと、今までどおり元の順（連続再生と同じ並び）に戻って今の曲から続く
   ・曲が無いときは押せない
   ========================================================= */

// fn：今までの「再生」の処理（playQueue を呼ぶもの）。その中の playQueue が、最初の曲をばらばらに選ぶ
function shufflePlay(fn) {
  if (!db.settings.shuffle) { db.settings.shuffle = true; saveDB(); }
  player._shuffleStart = true;
  try { fn(); } finally { player._shuffleStart = false; }
  updatePlayerUi();
}
// 一覧の中に置くボタン（attrs：data-act など。label：title の説明）
function shuffleBtnHtml(attrs, label, disabled) {
  return '<button type="button" class="btn-inline-small pl-icon-btn shuffle-play-btn" ' + attrs + (disabled ? ' disabled' : '') +
    ' title="' + escapeHtml('シャッフル再生：' + label + '（シャッフルをオンにします）') + '" aria-label="シャッフル再生">' + ICONS.shuffle + '</button>';
}
// ヘッダーのボタン（songs・new songs・heavy rotation）
(function () {
  var on = function (id, fn) { var b = document.getElementById(id); if (b) b.addEventListener('click', function () { if (!b.disabled) shufflePlay(fn); }); };
  on('lib-shuffle', function () { if (typeof playAllVisible === 'function') playAllVisible(); });
  on('ns-shuffle', function () { var l = newSongsView.list; if (l.length) playQueue(l.map(function (t) { return t.path; }), 0, 'new songs'); });
  on('hr-shuffle', function () { var l = heavyView.list; if (l.length) playQueue(l.map(function (t) { return t.path; }), 0, 'heavy rotation'); });
  // 曲が無いときは押せない（各画面を描いたあとに合わせる）
  var sync = function () {
    var set = function (id, n) { var b = document.getElementById(id); if (b) b.disabled = !n; };
    set('lib-shuffle', typeof libView !== 'undefined' && libView.list ? libView.list.length : 0);
    set('ns-shuffle', typeof newSongsView !== 'undefined' && newSongsView.list ? newSongsView.list.length : 0);
    set('hr-shuffle', typeof heavyView !== 'undefined' && heavyView.list ? heavyView.list.length : 0);
  };
  ['library', 'newsongs', 'heavy'].forEach(function (k) {
    var f = PAGE_RENDERERS[k];
    if (typeof f === 'function') PAGE_RENDERERS[k] = function () { var r = f.apply(this, arguments); sync(); return r; };
  });
})();

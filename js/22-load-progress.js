/* =========================================================
   22-load-progress.js ― 読み込みの進み具合（v2.6）
   ・どの画面でも見える「読み込みの進み具合」の帯（再生バーの上。スマホ幅は歌詞パネルの上）
       ① フォルダの中を探す（見つかった曲の数）→ ② 曲情報を読む（1234 / 3000曲・％・残り時間の目安）
       → ③ ジャケットの控えを作る（tools の「ジャケットの控えを前もって作る」を押したときだけ）
   ・読み込み中は body に library-loading を付ける（「読み直す」ボタンの回るアイコン・押せない表示）
   ・終わったら「読み込み完了：3000曲・300アルバム（12.3秒）」をトーストで出し、
     「最終読み込み」を ui.lastLoad に保存（tools の音楽フォルダ設定に表示）
   ・表示の更新は 0.25 秒に1回まで（読み込みを遅くしない）
   対象：起動時の自動読み込み・「読み直す」・音楽フォルダの変更・再接続・「曲情報を読み直す」・ファイル整理のあと
   （どれも 04-library.js の scanLibrary() を通るので、そこから呼ぶ）
   ========================================================= */

var LOAD_PROGRESS_INTERVAL = 250;   // 表示を更新する間隔（ミリ秒）
var loadProg = {
  active: false,      // ①② の読み込み中
  startAt: 0,         // 読み込みを始めた時刻（performance.now）
  startWall: 0,       // 同じ（日時。最終読み込みに使う）
  stageAt: 0,         // 今の段階を始めた時刻
  stage: '',          // 'scan'（①）・'meta'（②）
  lastPaint: 0,
  timer: 0
};

// 読み込み中か（①② の途中。二重に始めないために使う）
function isLibraryLoading() {
  return !!(library.scanning || library.metaRunning);
}

/* ---------- 04-library.js から呼ぶ ---------- */
function loadProgressBegin() {
  loadProg.active = true;
  loadProg.stage = 'scan';
  loadProg.startAt = loadProg.stageAt = performance.now();
  loadProg.startWall = Date.now();
  // 前回の読み込みが終わらないままページを閉じていたら、その日時を覚えておく（最終読み込みに「前回は中断」と出す）
  if (ui.loadRunningSince && !loadProg.prevInterrupted) loadProg.prevInterrupted = ui.loadRunningSince;
  ui.loadRunningSince = loadProg.startWall;   // 途中でページを閉じたときに「中断」と分かるように
  saveUi();
  _loadProgressState();
  renderLoadProgress(true);
}
function loadProgressStage(stage) {
  loadProg.stage = stage;
  loadProg.stageAt = performance.now();
  renderLoadProgress(true);
}
// 件数が増えたとき（間引いて描く）
function loadProgressTick() {
  var now = performance.now();
  if (now - loadProg.lastPaint >= LOAD_PROGRESS_INTERVAL) { renderLoadProgress(true); return; }
  if (!loadProg.timer) loadProg.timer = setTimeout(function () { loadProg.timer = 0; renderLoadProgress(true); }, LOAD_PROGRESS_INTERVAL);
}
// 終わり。status：'done'（完了）・'failed'（失敗）
function loadProgressFinish(status, message) {
  if (!loadProg.active) return;
  loadProg.active = false;
  var sec = Math.round((performance.now() - loadProg.startAt) / 100) / 10;
  var albums = 0;
  try { albums = typeof _countAlbums === 'function' ? _countAlbums() : 0; } catch (e) { /* 数えられなくても続ける */ }
  var rec = {
    at: Date.now(), status: status, sec: sec,
    tracks: library.tracks.length, albums: albums,
    failed: library.metaFailed || 0, message: message || '',
    prevInterrupted: loadProg.prevInterrupted || 0,
    mode: library.lastMode || 'full', added: library.lastAdded || 0, removed: library.lastRemoved || 0, fromMemo: library.lastFromMemo || 0
  };
  loadProg.prevInterrupted = 0;
  ui.lastLoad = rec;
  delete ui.loadRunningSince;
  saveUi();
  _loadProgressState();
  renderLoadProgress(true);
  if (status === 'done') {
    showToast('読み込み完了' + (rec.mode === 'full' ? '（全確認）' : '') + '：' + rec.tracks + '曲・' + rec.albums + 'アルバム（' + sec + '秒）' +
      _loadChangeText(rec) + (rec.failed ? '。読めなかった曲 ' + rec.failed + '曲' : ''), false);
  }
  if (currentPage === 'settings' && typeof renderSetFolder === 'function') renderSetFolder();
}

/* ---------- 表示 ---------- */
// body のクラス（「読み直す」ボタンの回るアイコン、帯の分の余白）
function _loadProgressState() {
  var showing = loadProg.active || (typeof artPre !== 'undefined' && artPre.running);
  document.body.classList.toggle('library-loading', !!loadProg.active);
  document.body.classList.toggle('load-progress-on', !!showing);
}
function renderLoadProgress(force) {
  var el = document.getElementById('load-progress');
  if (!el) return;
  var now = performance.now();
  if (!force && now - loadProg.lastPaint < LOAD_PROGRESS_INTERVAL) { loadProgressTick(); return; }
  loadProg.lastPaint = now;
  _loadProgressState();
  var d = _loadProgressData();
  if (!d) { el.hidden = true; return; }
  el.hidden = false;
  var bar = el.querySelector('.lp-fill'), txt = el.querySelector('.lp-text'), stop = el.querySelector('.lp-stop');
  el.classList.toggle('is-indeterminate', d.pct === null);
  bar.style.transform = d.pct === null ? '' : 'scaleX(' + (Math.max(1, d.pct) / 100) + ')';
  txt.textContent = d.text;
  stop.hidden = !d.canStop;
}
// 今の段階の表示内容 { text, pct（null＝全体の数がまだ分からない）, canStop }
function _loadProgressData() {
  var now = performance.now();
  if (loadProg.active && loadProg.stage === 'scan') {
    return { pct: null, canStop: false,
      text: '① フォルダの中を確認しています… 見つかった曲 ' + (library.scanFound || 0) + '曲' +
        (library.scanned && library.tracks.length ? '（一覧は前回の控えから表示中）' : '') };
  }
  if (loadProg.active && loadProg.stage === 'meta') {
    var done = library.metaDone || 0, total = library.metaTotal || 0;
    var pct = total ? Math.floor(done / total * 100) : 0;
    return { pct: pct, canStop: false,
      text: (library.lastMode === 'full' ? '② 全曲を確認しています '
        : library.metaUpgradeN ? '② 曲情報を補っています（ジャンル・発売年など） ' : '② 新しい曲の曲情報を読んでいます ') +
        done + ' / ' + total + '曲（' + pct + '%）' + _loadEta(done, total, now - loadProg.stageAt) +
        (library.metaFailed ? '・読めなかった曲 ' + library.metaFailed : '') };
  }
  if (typeof artPre !== 'undefined' && artPre.running) {
    var p = artPre.total ? Math.floor(artPre.done / artPre.total * 100) : 0;
    return { pct: p, canStop: true,
      text: '③ ジャケットの控えを作っています ' + artPre.done + ' / ' + artPre.total + 'アルバム（' + p + '%）' +
        _loadEta(artPre.done, artPre.total, Date.now() - (artPre.startedAt || Date.now())) };
  }
  return null;
}
// 残り時間の目安（始めて1.5秒以上・少し進んでから出す）
function _loadEta(done, total, elapsedMs) {
  if (!total || done < 10 || elapsedMs < 1500 || done >= total) return '';
  var rest = (total - done) * elapsedMs / done / 1000;
  if (rest < 60) return '・残り 約' + Math.max(1, Math.round(rest)) + '秒';
  return '・残り 約' + Math.round(rest / 60) + '分';
}

// 増えた曲・なくなった曲（v2.7）
function _loadChangeText(r) {
  var a = [];
  if (r.added) a.push('新しい曲 ' + r.added);
  if (r.removed) a.push('なくなった曲 ' + r.removed);
  return a.length ? '・' + a.join('・') : '';
}
// 最終の全確認（v2.7）
function lastFullCheckHtml() {
  var at = (typeof libIndex !== 'undefined') ? libIndex.fullCheckAt : 0;
  var days = +db.settings.fullCheckDays;
  if (!at) return 'まだありません';
  var next = days > 0 ? '（次は ' + formatDateTime(at + days * 86400000).slice(0, 10) + ' 以降の読み込みで自動）' : '（自動ではしない設定）';
  return formatDateTime(at) + ' ' + next;
}

/* ---------- 最終読み込み（tools の音楽フォルダ設定に表示） ---------- */
function lastLoadHtml() {
  if (loadProg.active) return '読み込み中…';
  var r = ui.lastLoad;
  var h = '';
  if (r && r.at) {
    h = formatDateTime(r.at) + '（' + (r.status === 'failed'
      ? '失敗' + (r.message ? '：' + escapeHtml(r.message) : '')
      : (r.mode === 'full' ? '全確認・' : r.mode === 'fast' ? '高速・' : '') + r.tracks + '曲・' + r.albums + 'アルバム・' + r.sec + '秒' + _loadChangeText(r) +
        (r.fromMemo ? '・メモファイルから ' + r.fromMemo + '曲' : '') +
        (r.failed ? '・<span class="last-load-warn">読めなかった曲 ' + r.failed + '曲</span>' : '')) + '）';
  }
  var cut = ui.loadRunningSince || (r && r.prevInterrupted);   // 終わらないままページを閉じた読み込み
  if (cut) h += (h ? '<br>' : '') + '<span class="last-load-warn">' + formatDateTime(cut) + ' に始めた読み込みは、途中で終わっていました（中断）</span>';
  return h || 'まだありません';
}

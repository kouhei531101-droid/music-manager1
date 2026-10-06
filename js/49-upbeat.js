/* =========================================================
   49-upbeat.js ― 「upbeat music」画面（リズムの速い曲。v7.8）
   ・BPM が基準（db.settings.upbeatMin。初期 140）以上の曲を集める。音楽ファイルには書き込まない
   ・BPM の求め方（強い順）：
       ① 手で入れた BPM（db.bpmManual { 曲の相対パス: BPM }。バックアップに含む）
       ② 曲ファイルのタグの BPM（mp3 TBPM・m4a tmpo・flac/ogg BPM。03-tag-reader.js の readTrackBpm）
       ③ 音の解析で推定：曲の中ほど約30秒を 22050Hz・モノラルで取り出し（mp3 はその部分のバイトだけを、ほかの形式は全体をデコード）、
          約23ms ごとの音の強さの増え方（低い音と高い音を分けて足す）を作り、その自己相関の山から BPM を求める。
          半分・2倍の誤りを減らすため、低い音（キック・スネア）の刻みも見て選ぶ（estimateBpm の説明）
   ・②③ は「BPM を調べる」で裏で1曲ずつ（デコードはブラウザが別の所で行う）。結果は控え（IndexedDB musicManager_bpm）に
     { 相対パス: [大きさ, 更新日時, BPM, 出どころ 't' タグ／'e' 推定／'x' 求められなかった, 版] } で残し、2回目からは変わった曲だけ
   ========================================================= */

var UPB_VER = 1, UPB_SR = 22050, UPB_HOP = 512, UPB_SECONDS = 30, UPB_PAGE = 200;
var upb = { data: {}, loaded: false, folder: null, scanning: false, stop: false, done: 0, total: 0, rev: 0, cache: null, view: [], limit: UPB_PAGE, ctx: null, lastMs: 0 };

ICONS.upbeat = _svg('<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>');

function upbeatMin() { var v = +db.settings.upbeatMin; return v >= 40 && v <= 300 ? v : 140; }

/* ---------- BPM の推定（音の解析） ---------- */
function _upbCtx() {
  if (!upb.ctx) { var C = window.OfflineAudioContext || window.webkitOfflineAudioContext; upb.ctx = C ? new C(1, UPB_SR, UPB_SR) : null; }
  return upb.ctx;
}
// 解析に使うバイト：mp3 は中ほどの約30秒分（バイトの途中からでもデコードできる）、ほかは全体
async function _upbBytes(t, file) {
  if ((t.ext === 'mp3' || t.ext === 'aac') && file.size > 1500000) {
    var dur = t.duration || 0, rate = dur > 0 ? file.size / dur : 16000;   // 1秒あたりのバイト
    var len = Math.min(file.size, Math.round(rate * (UPB_SECONDS + 4))), start = Math.max(0, Math.round(file.size * 0.45 - len / 2));
    return await file.slice(start, start + len).arrayBuffer();
  }
  if (file.size > 60 * 1024 * 1024) throw new Error('大きすぎるファイル');
  return await file.arrayBuffer();
}
// AudioBuffer（またはモノラルの Float32Array と sampleRate）から BPM を求める。{ bpm, conf }
// 音の強さの増え方（全体と低い音）の自己相関から、拍として最もそろっている速さを選ぶ。
//   ・その速さの1拍・2拍・4拍の間隔がそろって強いほど高い点。低〜中の音（キック・スネア）が拍ごとに刻んでいるかも足す
//   ・低い音がその速さで刻んでいない（ハイハットの細かい刻みだけ）なら下げる（2倍に測る誤り）。低い音が2倍の速さでも刻んでいれば下げる（半分に測る誤り）
//   ・よくある速さ（135 前後）に少し寄せる。合成のドラム（72〜185 BPM、8ビート・4つ打ち、スネアの音色2種類）129曲すべて ±4% 以内
function estimateBpm(samples, sr) {
  var SECONDS = UPB_SECONDS, HOP0 = UPB_HOP, SR0 = UPB_SR;
  var n = samples.length, take = Math.min(n, sr * SECONDS), off = Math.max(0, Math.floor((n - take) / 2));
  var hop = Math.round(HOP0 * sr / SR0), frames = Math.floor(take / hop);
  if (frames < 200) return { bpm: 0, conf: 0 };
  var lowE = new Float32Array(frames), highE = new Float32Array(frames), midE = new Float32Array(frames), lp = 0, lp2 = 0, prev = 0, a = 0.06, a2 = 0.5;   // 低い音（〜200Hz）・低〜中の音（〜2.4kHz。キック・スネア）・高い音（差分）
  for (var f = 0; f < frames; f++) {
    var sl = 0, sh = 0, base = off + f * hop;
    var sm = 0;
    for (var k = 0; k < hop; k++) { var x = samples[base + k] || 0; lp += a * (x - lp); lp2 += a2 * (x - lp2); var d = x - prev; prev = x; sl += lp * lp; sm += lp2 * lp2; sh += d * d; }
    lowE[f] = Math.log(1e-6 + sl); highE[f] = Math.log(1e-6 + sh); midE[f] = Math.log(1e-6 + sm);
  }
  // onL：拍の刻みを見る用（低〜中の音＝キック・スネア。ハイハットは入りにくい）、on：全体
  var on = new Float32Array(frames), onL = new Float32Array(frames);
  for (var i = 1; i < frames; i++) { onL[i] = Math.max(0, midE[i] - midE[i - 1]); on[i] = onL[i] + Math.max(0, highE[i] - highE[i - 1]); }
  var fps = sr / hop;
  var minLag = Math.floor(fps * 60 / 260), maxLag = Math.ceil(fps * 60 / 14);
  var acOf = function (sig) {
    var m = 0, z = 0, k2, out = new Float32Array(maxLag + 2), c = new Float32Array(frames);
    for (k2 = 0; k2 < frames; k2++) m += sig[k2]; m /= frames;
    for (k2 = 0; k2 < frames; k2++) { c[k2] = sig[k2] - m; z += c[k2] * c[k2]; }
    if (z <= 0) return out;
    for (var lag = minLag; lag <= maxLag + 1; lag++) { var s = 0; for (var p = 0; p + lag < frames; p++) s += c[p] * c[p + lag]; out[lag] = s / z; }
    return out;
  };
  var ac = acOf(on), acL = acOf(onL);
  var at = function (arr, bpm) { var l = fps * 60 / bpm, l0 = Math.floor(l), fr = l - l0; if (l0 < minLag || l0 + 1 > maxLag + 1) return 0; return Math.max(0, arr[l0] * (1 - fr) + arr[l0 + 1] * fr); };
  var acAt = function (bpm) { return at(ac, bpm); };
  // 拍の強さ：その BPM の拍（1拍・2拍・4拍の間隔）がそろって強いか。裏拍（半拍）だけが強いものは下げる
  var best = -1, bestB = 0;
  for (var b = 60; b <= 200; b += 0.5) {
    var sc = acAt(b) + 0.8 * acAt(b / 2) + 0.6 * acAt(b / 4) + 1.0 * at(acL, b) - 0.8 * at(acL, b * 2);   // 低い音がその2倍の速さでも刻んでいれば、遅すぎる   // 低い音（キック・スネア）が拍ごとにそろうか
    var pr = Math.exp(-0.5 * Math.pow(Math.log2(b / 135) / 1.2, 2));   // よくある速さ（135 前後）に少し寄せる
    if (at(acL, b) < 0.3 * at(acL, b / 2)) sc *= 0.6;   // 低い音（キック・スネア）が、その速さでは刻んでいない（ハイハットの細かい刻みだけ）
    sc *= pr;
    if (sc > best) { best = sc; bestB = b; }
  }
  // 細かく（±1 を 0.1 刻み）
  var fine = bestB, fb = -1;
  for (var c = bestB - 1; c <= bestB + 1; c += 0.1) { var v = acAt(c) + 0.5 * acAt(c / 2); if (v > fb) { fb = v; fine = c; } }
  return { bpm: Math.round(fine * 10) / 10, conf: Math.round(best * 100) / 100 };
}
async function estimateTrackBpm(t) {
  var file = await t.handle.getFile();
  var ctx = _upbCtx();
  if (!ctx) throw new Error('このブラウザでは音の解析ができません');
  var buf = await _upbBytes(t, file);
  var ab = await new Promise(function (res, rej) { var p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
  var ch = ab.numberOfChannels, len = ab.length, mono = ab.getChannelData(0);
  if (ch > 1) { var m = new Float32Array(len), c1 = ab.getChannelData(1); for (var i = 0; i < len; i++) m[i] = (mono[i] + c1[i]) * 0.5; mono = m; }
  return estimateBpm(mono, ab.sampleRate);
}

/* ---------- BPM（出どころ付き） ---------- */
// { bpm, src: 'manual'|'tag'|'est'|'' }
function bpmOf(t) {
  var m = (db.bpmManual || {})[t.path];
  if (m) return { bpm: m, src: 'manual' };
  var r = upb.data[t.path];
  if (r && r[2] > 0) return { bpm: r[2], src: r[3] === 't' ? 'tag' : 'est' };
  return { bpm: 0, src: r ? 'none' : '' };
}
var UPB_SRC_LABEL = { manual: '手で入力', tag: 'タグ', est: '推定', none: '求められず', '': 'まだ' };
function setBpmManual(path, v) {
  if (!db.bpmManual || typeof db.bpmManual !== 'object') db.bpmManual = {};
  if (v > 0) db.bpmManual[path] = Math.round(v * 10) / 10; else delete db.bpmManual[path];
  saveDB(); upb.cache = null; upb.rev++;
}
function upbeatList() {
  var hid = typeof hiddenTrackPaths === 'function' ? hiddenTrackPaths() : new Set();   // 非表示のアルバムの曲は除く（v7.9）
  var key = (library.metaRev || 0) + '|' + library.tracks.length + '|' + upb.rev + '|' + upbeatMin() + '|' + hid.size + ':' + (typeof hiddenAlbumsSig === 'function' ? hiddenAlbumsSig().length : 0);
  if (upb.cache && upb.cache.key === key) return upb.cache.list;
  var min = upbeatMin(), list = library.tracks.filter(function (t) { return !hid.has(t.path) && bpmOf(t).bpm >= min; });
  upb.cache = { key: key, list: list };
  return list;
}
function upbeatCount() { return library.tracks.length ? upbeatList().length : 0; }
function upbeatApplyPathMapping(map) {
  var mm = db.bpmManual || {};
  Object.keys(map).forEach(function (f) { if (mm[f]) { mm[map[f]] = mm[f]; delete mm[f]; } if (upb.data[f]) { upb.data[map[f]] = upb.data[f]; delete upb.data[f]; } });
  upb.cache = null; upb.rev++;
  if (upb.loaded) _upbSaveSoon();
}

/* ---------- 控え（IndexedDB） ---------- */
var _upbDbP = null;
function _upbDb() {
  if (_upbDbP) return _upbDbP;
  _upbDbP = new Promise(function (res, rej) { var q = indexedDB.open('musicManager_bpm', 1); q.onupgradeneeded = function () { q.result.createObjectStore('bpm'); }; q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; });
  return _upbDbP;
}
async function upbeatLoadCache() {
  if (upb.loaded && upb.folder !== fsa.folderName) { upb.loaded = false; upb.data = {}; }
  if (upb.loaded) return;
  try {
    var d = await _upbDb();
    var rec = await new Promise(function (res, rej) { var r = d.transaction('bpm').objectStore('bpm').get('current'); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
    if (rec && rec.folder === fsa.folderName && rec.data) upb.data = rec.data;
  } catch (e) { console.warn('BPM の控えを読めませんでした', e); }
  upb.loaded = true; upb.folder = fsa.folderName; upb.cache = null; upb.rev++;
}
var _upbSaveT = 0;
function _upbSaveSoon() { clearTimeout(_upbSaveT); _upbSaveT = setTimeout(_upbSave, 2000); }
async function _upbSave() { try { var d = await _upbDb(); d.transaction('bpm', 'readwrite').objectStore('bpm').put({ folder: fsa.folderName, at: Date.now(), data: upb.data }, 'current'); } catch (e) { console.warn('BPM の控えを保存できませんでした', e); } }
function _upbNeed() {
  return library.tracks.filter(function (t) {
    var r = upb.data[t.path], c = tagCache[t.path];
    return !r || r[4] !== UPB_VER || (c && c.s && r[0] && (r[0] !== c.s || r[1] !== c.m));
  });
}

/* ---------- BPM を調べる（裏で1曲ずつ） ---------- */
async function upbeatScan() {
  if (upb.scanning || !library.scanned || !isConnected()) return;
  await upbeatLoadCache();
  var need = _upbNeed();
  // 非表示のアルバムの曲は後回し（v7.9。戻したときにすぐ出るよう、最後には調べる）
  var hidP = typeof hiddenTrackPaths === 'function' ? hiddenTrackPaths() : new Set();
  if (hidP.size) need = need.filter(function (t) { return !hidP.has(t.path); }).concat(need.filter(function (t) { return hidP.has(t.path); }));
  if (!need.length) { _upbProgressUi(); return; }
  // 新しい順ではなく、アルバムの順（フォルダ順）に。手で入れた曲もタグは調べる
  upb.scanning = true; upb.stop = false; upb.done = 0; upb.total = need.length;
  var lastUi = 0, lastCount = Date.now(), t0 = Date.now(), estN = 0, estMs = 0;
  _upbProgressUi();
  for (var i = 0; i < need.length && !upb.stop; i++) {
    var t = need[i], c = tagCache[t.path] || {}, rec;
    try {
      var file = await t.handle.getFile(), tb = await readTrackBpm(file);
      var fs = c.s || file.size, fm = c.s ? c.m : file.lastModified;   // 曲情報の控えと同じ目印（曲ファイルが変わったと分かるように）
      if (tb > 0) rec = [fs, fm, tb, 't', UPB_VER];
      else {
        var s = Date.now(), r = await estimateTrackBpm(t);
        estN++; estMs += Date.now() - s;
        rec = [fs, fm, r.bpm, r.bpm > 0 ? 'e' : 'x', UPB_VER];
      }
    } catch (e) { rec = [c.s || 0, c.m || 0, 0, 'x', UPB_VER]; }
    upb.data[t.path] = rec;
    upb.done++;
    if (estN) upb.lastMs = Math.round(estMs / estN);
    if (Date.now() - lastUi > 400) { lastUi = Date.now(); _upbProgressUi(); }
    if (Date.now() - lastCount > 3000) { lastCount = Date.now(); upb.cache = null; upb.rev++; renderSidebarCounts(); if (currentPage === 'upbeat') _upbCountUi(); }
    if (upb.done % 100 === 0) _upbSaveSoon();
    await new Promise(function (r2) { setTimeout(r2, 0); });   // 画面を止めない
  }
  upb.scanning = false; upb.cache = null; upb.rev++;
  await _upbSave();
  _upbProgressUi();
  renderSidebarCounts();
  if (currentPage === 'upbeat') renderUpbeatPage();
}
function _upbProgressUi() {
  var el = document.getElementById('upb-progress');
  if (!el) return;
  if (upb.scanning) {
    el.innerHTML = '<span>BPM を調べています… ' + upb.done + ' / ' + upb.total + '曲（' + Math.floor(upb.done / Math.max(1, upb.total) * 100) + '%' + (upb.lastMs ? '・推定 1曲 約' + (upb.lastMs / 1000).toFixed(2) + '秒' : '') + '）</span>' +
      '<span class="sea-bar"><span class="sea-bar-fill" style="width:' + (upb.done / Math.max(1, upb.total) * 100).toFixed(1) + '%"></span></span><button class="btn-inline-small" id="upb-stop">止める</button>';
  } else {
    var need = upb.loaded && library.scanned ? _upbNeed().length : 0;
    el.innerHTML = '<span>' + (need ? 'BPM をまだ調べていない曲：' + need + '曲' : '全曲の BPM を調べました。') + '</span>' + (need ? '<button class="btn-inline-small" id="upb-start">' + (upb.done ? '再開' : 'BPM を調べる') + '</button>' : '');
  }
}

/* ---------- 画面 ---------- */
function _upbSort() { return ['bpm-desc', 'bpm-asc', 'title'].indexOf(ui.upbeatSort) >= 0 ? ui.upbeatSort : 'bpm-desc'; }
function _upbCountUi() { var c = document.getElementById('upb-count'); if (c) c.textContent = upbeatList().length + '曲'; }
function renderUpbeatPage() {
  var body = document.getElementById('upb-body');
  if (!body) return;
  if (!isConnected() || !library.scanned) { body.innerHTML = isConnected() ? '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>' : welcomeCardHtml(); document.getElementById('upb-count').textContent = ''; return; }
  if (!upb.loaded || upb.folder !== fsa.folderName) { upbeatLoadCache().then(function () { if (currentPage === 'upbeat') renderUpbeatPage(); upbeatScan(); }); }
  var minEl = document.getElementById('upb-min'); if (document.activeElement !== minEl) minEl.value = upbeatMin();
  document.getElementById('upb-sort').value = _upbSort();
  _upbProgressUi(); _upbCountUi();
  var q = (document.getElementById('upb-search').value || '').trim().toLowerCase(), sort = _upbSort();
  var list = upbeatList().filter(function (t) { return !q || t.search.indexOf(q) >= 0; }).slice();
  list.sort(sort === 'title' ? function (a, b) { return compareAlbumText(albumTextKey(a.title), albumTextKey(b.title)); }
    : function (a, b) { var d = bpmOf(b).bpm - bpmOf(a).bpm; return (sort === 'bpm-asc' ? -d : d) || compareAlbumText(albumTextKey(a.title), albumTextKey(b.title)); });
  upb.view = list;
  if (!list.length) { body.innerHTML = '<div class="empty-msg">' + (q ? '検索に当てはまる曲がありません。' : 'BPM ' + upbeatMin() + ' 以上の曲はまだありません。' + (upb.scanning || _upbNeed().length ? '（BPM を調べ終わると増えます）' : '基準の BPM を下げると出てきます。')) + '</div>'; return; }
  var shown = list.slice(0, upb.limit);
  body.innerHTML = '<div class="sea-head upb-head">' + ICONS.upbeat + '<span class="sea-head-name">BPM ' + upbeatMin() + ' 以上</span><span class="sea-head-n">' + list.length + '曲</span>' +
      '<button class="btn-save sea-play-all" data-upb-act="play-all">' + ICONS.play + '連続再生</button>' + shuffleBtnHtml('data-upb-act="shuffle"', 'この一覧をばらばらの順で再生') + '</div>' +
    songTableHtml(shown, { extra: { head: 'BPM', cell: function (t) { var b = bpmOf(t); return '<button class="upb-bpm upb-src-' + b.src + '" data-upb-edit="' + escapeHtml(t.path) + '" title="' + escapeHtml('BPM ' + b.bpm + '（' + UPB_SRC_LABEL[b.src] + '）。押すと手で入力・修正') + '" aria-label="' + escapeHtml('BPM ' + b.bpm + '、' + UPB_SRC_LABEL[b.src] + '。手で入力') + '"><span class="upb-bpm-n">' + Math.round(b.bpm) + '</span><span class="upb-src">' + UPB_SRC_LABEL[b.src] + '</span></button>'; } } }) +
    (list.length > shown.length ? loadMoreHtml('upb-more', list.length - shown.length, '曲') : '');
  artObserve(body);
  watchLoadMore('upb', document.getElementById('upb-more'), function () { upb.limit += UPB_PAGE; var y = window.scrollY; renderUpbeatPage(); window.scrollTo(0, y); });
}
// BPM を手で入力・修正（空欄で手の値を消して、タグ・推定に戻す）
async function editTrackBpm(path) {
  var t = library.byPath[path]; if (!t) return;
  var b = bpmOf(t), m = (db.bpmManual || {})[path];
  var v = await showPrompt({ title: 'BPM を手で入力', message: '「' + escapeHtml(t.title) + '」の BPM（今は ' + (b.bpm || '—') + '・' + UPB_SRC_LABEL[b.src] + '）。空欄にすると手の値を消して、タグ・推定に戻します。', label: 'BPM', suffix: 'BPM', value: m ? String(m) : '', okText: '保存',
    validate: function (x) { x = String(x).trim(); if (!x) return ''; var k = parseFloat(x.normalize('NFKC')); return k >= 30 && k <= 300 ? '' : 'BPM は 30〜300 の数で入力してください。'; } });
  if (v === null || v === undefined) return;
  var n = parseFloat(String(v).normalize('NFKC'));
  setBpmManual(path, String(v).trim() ? n : 0);
  renderUpbeatPage(); renderSidebarCounts();
  showToast(String(v).trim() ? '「' + t.title + '」の BPM を ' + n + ' にしました。' : '「' + t.title + '」の手の BPM を消しました。');
}
function initUpbeatPage() {
  var body = document.getElementById('upb-body');
  if (!body) return;
  var min = document.getElementById('upb-min');
  var setMin = function (v) { v = Math.round(+v); if (!(v >= 40 && v <= 300)) return; db.settings.upbeatMin = v; saveDB(); upb.cache = null; upb.limit = UPB_PAGE; renderUpbeatPage(); renderSidebarCounts(); };
  min.addEventListener('change', function () { setMin(min.value); });
  document.getElementById('upb-min-down').addEventListener('click', function () { setMin(upbeatMin() - 5); });
  document.getElementById('upb-min-up').addEventListener('click', function () { setMin(upbeatMin() + 5); });
  document.getElementById('upb-sort').addEventListener('change', function (ev) { ui.upbeatSort = ev.target.value; saveUi(); renderUpbeatPage(); });
  document.getElementById('upb-search').addEventListener('input', debounce(function () { upb.limit = UPB_PAGE; renderUpbeatPage(); }, 180));
  document.getElementById('upb-progress').addEventListener('click', function (ev) { if (ev.target.closest('#upb-stop')) upb.stop = true; else if (ev.target.closest('#upb-start')) upbeatScan(); });
  bindSongTable(body, function () { return upb.view; }, 'upbeat music');
  body.addEventListener('click', function (ev) {
    var e = ev.target.closest('[data-upb-edit]'); if (e) { editTrackBpm(e.getAttribute('data-upb-edit')); return; }
    if (ev.target.closest('[data-act="more"]')) { upb.limit += UPB_PAGE; renderUpbeatPage(); return; }
    var lbl = 'upbeat music（BPM ' + upbeatMin() + '〜）', paths = upb.view.map(function (t) { return t.path; });
    if (ev.target.closest('[data-upb-act="play-all"]') && paths.length) playQueue(paths, 0, lbl);
    else if (ev.target.closest('[data-upb-act="shuffle"]') && paths.length) shufflePlay(function () { playQueue(paths, 0, lbl); });
  });
}
PAGE_RENDERERS.upbeat = renderUpbeatPage;

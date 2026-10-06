/* =========================================================
   37-now-playing.js ― 「再生画面」とオーディオビジュアライザー（v5.1）
   ・入口：再生バーのジャケット（v5.1 から「再生画面を開く」）。ジャケット拡大表示は、再生画面の大きなジャケットを押すと開く
   ・閉じる：「閉じる」ボタン・Esc・ブラウザの戻る（開いたときに履歴を1つ足す）
   ・中身：大きなジャケット、曲名・アーティスト・アルバム（リンク。押すと再生画面を閉じてその画面へ）、再生元、
     再生操作（前・再生／一時停止・次・シャッフル・リピート）、シーク、音量・消音、時間付き歌詞（前後の行も。切り替えは保存 ui.npLyrics）
   ・オーディオビジュアライザー：Web Audio API。最初に再生画面を開いたとき（利用者の操作のあと）に AudioContext を作り、
     既存の audio 要素を createMediaElementSource で1回だけつなぐ（audio → 出力、audio → AnalyserNode の2本。音は今までどおり出る）。
     描き方は「バー」「波形」「円」（ui.vizMode）。色はジャケットの代表色（取れなければテーマの色）を、ライト・ブラックの背景で見えるよう明るさを合わせる。
     再生画面を閉じている・タブが隠れているときは描かない。prefers-reduced-motion では 1秒に約8回だけ描き、動きを小さくする
   ・AudioContext が止まっている（ブラウザの自動再生の決まり）と音が出ないので、再生のたびに resume する
   ========================================================= */

var np = { open: false, pushed: false, afterClose: null, ctx: null, src: null, analyser: null, freq: null, wave: null, raf: 0, lastDraw: 0,
  color: null, colorKey: '', path: null, lyrIdx: -2, reduced: false };
var NP_MODES = [['bars', 'バー'], ['wave', '波形'], ['circle', '円']];
function npMode() { var m = ui.vizMode; return NP_MODES.some(function (x) { return x[0] === m; }) ? m : 'bars'; }

/* ---------- Web Audio（1回だけつなぐ） ---------- */
function _npEnsureAudioGraph() {
  if (np.ctx || !player.audio) return !!np.ctx;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    np.ctx = new AC();
    np.src = np.ctx.createMediaElementSource(player.audio);   // 1回だけ（2回目はエラーになる）
    np.analyser = np.ctx.createAnalyser();
    np.analyser.fftSize = 2048;
    np.analyser.smoothingTimeConstant = 0.8;
    np.src.connect(np.ctx.destination);   // 音はそのまま出す
    np.src.connect(np.analyser);          // 形を見るためだけの枝分かれ
    np.freq = new Uint8Array(np.analyser.frequencyBinCount);
    np.wave = new Uint8Array(np.analyser.fftSize);
    // つないだあとは AudioContext が止まっていると音が出ないので、再生のたびに動かす
    player.audio.addEventListener('play', _npResume);
    player.audio.addEventListener('playing', _npResume);
    _npResume();
    return true;
  } catch (e) {
    console.warn('オーディオビジュアライザーを使えません', e);
    np.ctx = null;
    return false;
  }
}
function _npResume() { if (np.ctx && np.ctx.state === 'suspended') np.ctx.resume().catch(function () {}); }

/* ---------- 開く・閉じる ---------- */
// opts.playlist：プレイリストの play画面（v5.6）。指定が無ければ、プレイリストから再生中ならプレイリストの play画面
function openNowPlaying(opts) {
  var el = _npEnsureDom();
  np.plMode = opts && typeof opts.playlist === 'boolean' ? opts.playlist : !!(player.playlistId && typeof getPlaylist === 'function' && getPlaylist(player.playlistId));
  if (np.open) { npRender(); return; }
  np.open = true;
  el.hidden = false;
  document.body.classList.add('np-open');
  _npEnsureAudioGraph();   // 利用者の操作（ジャケットを押した）のあとなので、ここで作れる
  np.reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { history.pushState({ mmNP: 1 }, ''); np.pushed = true; } catch (e) { np.pushed = false; }
  npRender();
  _npStartLoop();
  setTimeout(function () { var c = document.getElementById('np-close'); if (c) c.focus(); }, 0);
}
// 閉じる。then：閉じたあとにすること（リンクで別の画面へ移るとき）
function closeNowPlaying(then) {
  if (!np.open) { if (then) then(); return; }
  np.afterClose = then || null;
  if (np.pushed) { np.pushed = false; history.back(); return; }   // 足した履歴を戻す（popstate で閉じる）
  _npHide();
}
function _npHide() {
  np.open = false;
  if (typeof flow !== 'undefined') { flow.shown = false; if (flow.idleTimer) { clearTimeout(flow.idleTimer); flow.idleTimer = 0; } }   // v5.7
  var el = document.getElementById('now-playing');
  if (el) el.hidden = true;
  document.body.classList.remove('np-open');
  _npStopLoop();
  var fn = np.afterClose; np.afterClose = null;
  var art = document.getElementById('pb-art'); if (art && !fn) { try { art.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  if (fn) setTimeout(fn, 0);
}
window.addEventListener('popstate', function () { if (np.open) { np.pushed = false; _npHide(); } });
document.addEventListener('keydown', function (ev) {
  if (!np.open || ev.key !== 'Escape') return;
  var av = document.getElementById('art-viewer'), dlg = document.getElementById('dialog-modal');
  if ((av && !av.hidden) || (dlg && !dlg.hidden) || document.querySelector('.sortkey-pop')) return;   // 上に出ているものを先に閉じる
  ev.preventDefault();
  closeNowPlaying();
});
document.addEventListener('visibilitychange', function () { if (document.hidden) _npStopLoop(); else if (np.open) _npStartLoop(); });

/* ---------- 画面 ---------- */
function _npEnsureDom() {
  var el = document.getElementById('now-playing');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'now-playing';
  el.className = 'np';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '再生画面');
  el.innerHTML =
    '<canvas class="np-viz" id="np-viz" aria-hidden="true"></canvas>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:8px;left:8px" onclick="copyUiLabel(\'再生画面\', event)" title="クリックで「再生画面」をコピー">□</span>' +
    '<div class="np-top">' +
      '<div class="np-modes" role="group" aria-label="オーディオビジュアライザーの描き方" id="np-modes"></div>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static" onclick="copyUiLabel(\'オーディオビジュアライザー\', event)" title="クリックで「オーディオビジュアライザー」をコピー">□</span>' +
      '<button class="np-lyr-toggle" id="np-lyr-toggle" aria-pressed="false">' + ICONS.lyrics + '歌詞</button>' +
      '<button class="np-close" id="np-close" title="再生画面を閉じる（Esc）" aria-label="再生画面を閉じる">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="np-main">' +
      '<button class="np-art" id="np-art" title="ジャケットを大きく表示"></button>' +
      '<div class="np-info">' +
        '<div class="np-title" id="np-title"></div>' +
        '<div class="np-sub" id="np-sub"></div>' +
        '<div class="np-label" id="np-label"></div>' +
        '<div class="np-lyrics" id="np-lyrics" aria-live="off"></div>' +
        '<div class="np-seek"><span class="np-time" id="np-time">0:00</span><input type="range" id="np-seek" min="0" max="1000" value="0" step="1" aria-label="再生位置"><span class="np-time" id="np-dur">0:00</span></div>' +
        '<div class="np-controls">' +
          '<button class="np-btn" id="np-shuffle" aria-pressed="false">' + ICONS.shuffle + '</button>' +
          '<button class="np-btn" id="np-prev" title="前の曲" aria-label="前の曲">' + ICONS.prev + '</button>' +
          '<button class="np-btn np-play" id="np-play"></button>' +
          '<button class="np-btn" id="np-next" title="次の曲" aria-label="次の曲">' + ICONS.next + '</button>' +
          '<button class="np-btn" id="np-repeat"></button>' +
        '</div>' +
        '<div class="np-volume"><button class="np-btn np-btn-sm" id="np-mute"></button><input type="range" id="np-volume" min="0" max="100" aria-label="音量"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  el.querySelector('#np-close').addEventListener('click', function () { closeNowPlaying(); });
  el.querySelector('#np-art').addEventListener('click', function () { if (player.currentPath) openArtworkViewer(); });
  el.querySelector('#np-play').addEventListener('click', function () { togglePlay(); });
  el.querySelector('#np-prev').addEventListener('click', function () { playPrev(); });
  el.querySelector('#np-next').addEventListener('click', function () { playNext(true); });
  el.querySelector('#np-shuffle').addEventListener('click', function () { toggleShuffle(); npRender(); });
  el.querySelector('#np-repeat').addEventListener('click', function () { cycleRepeat(); npRender(); });
  el.querySelector('#np-mute').addEventListener('click', function () { toggleMute(); _npVolumeUi(); });
  el.querySelector('#np-lyr-toggle').addEventListener('click', function () { ui.npLyrics = !npLyricsOn(); saveUi(); npRender(); });
  el.querySelector('#np-modes').addEventListener('click', function (ev) { var b = ev.target.closest('[data-viz]'); if (!b) return; ui.vizMode = b.getAttribute('data-viz'); saveUi(); _npModesUi(); });
  var seek = el.querySelector('#np-seek');
  seek.addEventListener('input', function () { player.seeking = true; var d = player.audio.duration; if (isFinite(d)) document.getElementById('np-time').textContent = _pbTime(seek.value / 1000 * d); });
  seek.addEventListener('change', function () { var d = player.audio.duration; if (isFinite(d) && d > 0) player.audio.currentTime = seek.value / 1000 * d; player.seeking = false; });
  var vol = el.querySelector('#np-volume');
  vol.addEventListener('input', function () {
    player.audio.volume = vol.value / 100; if (player.audio.muted && vol.value > 0) player.audio.muted = false;
    document.getElementById('pb-volume').value = vol.value; updateVolumeUi(); _npVolumeUi();
  });
  vol.addEventListener('change', function () { db.settings.volume = player.audio.volume; saveDB(); });
  // アーティスト・アルバムのリンク：再生画面を閉じてから移る
  el.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-np-go]');
    if (!a) return;
    ev.preventDefault();
    var kind = a.getAttribute('data-np-go'), v = a.getAttribute('data-v');
    closeNowPlaying(function () { if (kind === 'album') goToAlbumOfTrack(v); else goToArtist(v); });
  });
  var a = player.audio;
  ['play', 'pause', 'loadedmetadata', 'volumechange'].forEach(function (e) { a.addEventListener(e, function () { if (np.open) { _npControlsUi(); _npVolumeUi(); } }); });
  a.addEventListener('timeupdate', function () { if (np.open) { _npSeekUi(); _npLyricsUi(); } });
  window.addEventListener('resize', function () { if (np.open) _npSizeCanvas(); });
  return el;
}
function npLyricsOn() { return ui.npLyrics !== false; }
// 曲が変わったとき（06-player.js の updatePlayerUi から）
function npOnPlayerUpdate() { if (np.open) npRender(); }
function npRender() {
  if (!np.open) return;
  var path = player.currentPath, t = path ? library.byPath[path] : null;
  document.getElementById('np-title').textContent = path ? (t ? t.title : stripExt(splitPath(path).name)) : '曲が選ばれていません';
  var sub = '';
  if (t) {
    var ar = t.artist ? '<a href="#" class="np-link" data-np-go="artist" data-v="' + escapeHtml(artistNameOf(t) || t.artist) + '" title="アーティストの画面を開く">' + escapeHtml(t.artist) + '</a>' : '';
    var al = t.album ? '<a href="#" class="np-link" data-np-go="album" data-v="' + escapeHtml(t.path) + '" title="アルバムの曲一覧を開く">' + escapeHtml(t.album) + '</a>' : '';
    sub = [ar, al].filter(Boolean).join('<span class="np-dot"> ・ </span>');
  }
  document.getElementById('np-sub').innerHTML = sub || (path ? '' : '曲一覧やプレイリストの ▶ で再生します');
  document.getElementById('np-label').textContent = player.label ? player.label + (player.queue.length ? '　' + (player.index + 1) + ' / ' + player.queue.length : '') : '';
  // ジャケット（アルバムカードと同じ控えの画像）
  var artEl = document.getElementById('np-art');
  if (np.path !== path) {
    np.path = path; np.lyrIdx = -2;
    artEl.innerHTML = t ? artThumbHtml(t, 'art-np') : '<span class="art-thumb art-np art-none">' + ICONS.music + '</span>';
    artEl.disabled = !path;
    artObserve(artEl);
    _npWatchArtColor(artEl, t);
  }
  _npModesUi(); _npControlsUi(); _npSeekUi(); _npVolumeUi();
  var lt = document.getElementById('np-lyr-toggle'), on = npLyricsOn();
  lt.classList.toggle('active', on); lt.setAttribute('aria-pressed', on ? 'true' : 'false');
  lt.title = on ? '時間付き歌詞を隠す' : '時間付き歌詞を出す';
  document.getElementById('np-lyrics').hidden = !on;
  np.lyrIdx = -2; _npLyricsUi();
  if (typeof flowRender === 'function') { flowRender(!flow.shown); flow.shown = true; }   // ジャケットの並び（v5.7。40-coverflow.js）
  if (typeof plpRender === 'function') plpRender();   // プレイリストの play画面（v5.6）
  _npSizeCanvas();
}
function _npModesUi() {
  var m = npMode();
  document.getElementById('np-modes').innerHTML = NP_MODES.map(function (x) {
    return '<button class="np-mode' + (x[0] === m ? ' active' : '') + '" data-viz="' + x[0] + '" aria-pressed="' + (x[0] === m) + '" title="描き方：' + x[1] + '">' + x[1] + '</button>';
  }).join('');
}
function _npControlsUi() {
  var playing = player.audio && !player.audio.paused && !!player.audio.getAttribute('src');
  var p = document.getElementById('np-play'); p.innerHTML = playing ? ICONS.pause : ICONS.play; p.title = playing ? '一時停止' : '再生'; p.setAttribute('aria-label', p.title);
  var sh = document.getElementById('np-shuffle'); sh.classList.toggle('active', !!db.settings.shuffle); sh.setAttribute('aria-pressed', db.settings.shuffle ? 'true' : 'false');
  sh.title = 'シャッフル：' + (db.settings.shuffle ? 'オン' : 'オフ'); sh.setAttribute('aria-label', sh.title);
  var mode = db.settings.repeat || 'off', rp = document.getElementById('np-repeat');
  rp.innerHTML = ICONS.repeat + (mode === 'one' ? '<span class="pb-repeat-one">1</span>' : ''); rp.classList.toggle('active', mode !== 'off');
  rp.title = REPEAT_LABELS[mode]; rp.setAttribute('aria-label', rp.title);
}
function _npSeekUi() {
  var a = player.audio, d = a.duration, has = !!a.getAttribute('src') && isFinite(d) && d > 0;
  document.getElementById('np-dur').textContent = has ? formatDuration(d) : '0:00';
  if (player.seeking) return;
  document.getElementById('np-time').textContent = has ? _pbTime(a.currentTime) : '0:00';
  document.getElementById('np-seek').value = has ? Math.round(a.currentTime / d * 1000) : 0;
}
function _npVolumeUi() {
  var a = player.audio, m = document.getElementById('np-mute'), muted = a.muted || a.volume === 0;
  m.innerHTML = muted ? ICONS.mute : ICONS.volume; m.title = a.muted ? '消音を解除' : '消音'; m.setAttribute('aria-label', m.title);
  document.getElementById('np-volume').value = Math.round(a.volume * 100);
}
// 時間付き歌詞：今の行を大きく、前の1行・後の2行をうすく
function _npLyricsUi() {
  var box = document.getElementById('np-lyrics');
  if (!box || box.hidden) return;
  var r = typeof lyr !== 'undefined' && lyr.path === player.currentPath ? lyr.result : null;
  if (!r || !r.lines) {
    if (np.lyrIdx !== -3) { box.innerHTML = '<p class="np-lyr-none">' + (player.currentPath ? (r && r.plain ? '時間付きの歌詞ではないため、ここには出しません（歌詞パネルで見られます）。' : '時間付きの歌詞はありません。') : '') + '</p>'; np.lyrIdx = -3; }
    return;
  }
  var lines = r.lines, now = (player.audio.currentTime || 0) + 0.15, lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].time <= now) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === np.lyrIdx) return;
  np.lyrIdx = idx;
  var h = '';
  for (var i = idx - 1; i <= idx + 2; i++) {
    if (i < 0 || i >= lines.length) { h += '<p class="np-lyr np-lyr-empty">&nbsp;</p>'; continue; }
    h += '<p class="np-lyr' + (i === idx ? ' active' : '') + '">' + (lines[i].text ? escapeHtml(lines[i].text) : '♪') + '</p>';
  }
  box.innerHTML = h;
}

/* ---------- 色 ---------- */
function _npWatchArtColor(artEl, t) {
  np.color = null;
  var key = t ? t.path : '';
  np.colorKey = key;
  var tries = 0;
  var check = function () {
    if (np.colorKey !== key || !np.open) return;
    var img = artEl.querySelector('img');
    if (img && img.complete && img.naturalWidth) { np.color = _npDominant(img); return; }
    if (img && !img.complete) { img.addEventListener('load', function () { if (np.colorKey === key) np.color = _npDominant(img); }, { once: true }); return; }
    if (++tries < 30) setTimeout(check, 200);
  };
  check();
}
// ジャケットの代表色：小さく縮めて、鮮やかさで重みを付けた平均
function _npDominant(img) {
  try {
    var c = document.createElement('canvas'); c.width = c.height = 24;
    var g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
    var d = g.getImageData(0, 0, 24, 24).data, r = 0, gr = 0, b = 0, w = 0;
    for (var i = 0; i < d.length; i += 4) {
      var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), wt = 1 + (mx - mn) / 32;
      r += d[i] * wt; gr += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
    }
    return [r / w, gr / w, b / w];
  } catch (e) { return null; }
}
// 背景（ライト・ブラック）に合わせて見える明るさにした色 'r,g,b'
function _npColor() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var c = np.color;
  if (!c) { var v = getComputedStyle(document.documentElement).getPropertyValue(dark ? '--primary' : '--primary-mid').trim(); c = _npParseColor(v) || [90, 80, 180]; }
  var hsl = _rgbToHsl(c[0], c[1], c[2]);
  hsl[1] = Math.max(hsl[1], 0.45);
  hsl[2] = dark ? Math.min(Math.max(hsl[2], 0.6), 0.75) : Math.min(Math.max(hsl[2], 0.3), 0.45);
  var rgb = _hslToRgb(hsl[0], hsl[1], hsl[2]);
  return Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]);
}
function _npParseColor(v) {
  var m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(v);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return [h, s, l];
}
function _hslToRgb(h, s, l) {
  var f = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  if (!s) return [l * 255, l * 255, l * 255];
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

/* ---------- 描く ---------- */
function _npSizeCanvas() {
  var cv = document.getElementById('np-viz');
  if (!cv) return;
  var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
}
// 「円」の中心と半径（canvas の点の単位）：中央のジャケットの中心・ジャケットの一辺の 0.6 倍。0.5秒ごとに測り直す（並びが変わってもついていく）。
// スマホ幅（縦にスクロールする）・ジャケットが無いときは null（今までどおり画面の真ん中）
function _npVizCenter(cv) {
  var now = performance.now();
  if (np.vizAt && now - np.vizAt < 500) return np.vizC;
  np.vizAt = now; np.vizC = null;
  if (window.innerWidth <= 760) return null;
  var it = document.querySelector('#now-playing .np-flow-item.is-center'), box = document.getElementById('np-flow');
  if (!it || !box || !cv.clientWidth) return null;
  var br = box.getBoundingClientRect(), cr = cv.getBoundingClientRect(), k = cv.width / cv.clientWidth;
  np.vizC = { x: (br.left + br.width / 2 - cr.left) * k, y: (br.top + it.offsetTop + it.offsetHeight / 2 - cr.top) * k, r: it.offsetWidth * 0.6 * k };
  return np.vizC;
}
function _npStartLoop() {
  if (np.raf || !np.open || document.hidden) return;
  var step = function (ts) {
    np.raf = 0;
    if (!np.open || document.hidden) return;
    if (!np.reduced || ts - np.lastDraw > 120) { np.lastDraw = ts; _npDraw(); }
    np.raf = requestAnimationFrame(step);
  };
  np.raf = requestAnimationFrame(step);
}
function _npStopLoop() { if (np.raf) { cancelAnimationFrame(np.raf); np.raf = 0; } }
function _npDraw() {
  var cv = document.getElementById('np-viz');
  if (!cv || !cv.width) return;
  var g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  var playing = player.audio && !player.audio.paused;
  var col = _npColor(), amp = np.reduced ? 0.5 : 1;
  if (np.analyser) { np.analyser.getByteFrequencyData(np.freq); np.analyser.getByteTimeDomainData(np.wave); }
  else { np.freq = np.freq || new Uint8Array(1024); np.wave = np.wave || new Uint8Array(2048).fill(128); }
  var mode = npMode();
  if (mode === 'wave') {
    g.lineWidth = Math.max(2, W / 500); g.strokeStyle = 'rgba(' + col + ',0.85)';
    g.beginPath();
    var n = np.wave.length, mid = H * 0.55;
    for (var i = 0; i < n; i += 2) { var x = i / (n - 1) * W, y = mid + (np.wave[i] - 128) / 128 * H * 0.35 * amp; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  } else if (mode === 'circle') {
    // v8.6.4：PC 幅では、円の中心を中央のジャケットの中心に、大きさをジャケットに合わせる（ジャケットの後ろから線が伸びる）
    var vc = _npVizCenter(cv);
    var cx = vc ? vc.x : W / 2, cy = vc ? vc.y : H / 2, r0 = Math.max(Math.min(W, H) * 0.22, vc ? vc.r : 0), bars = 96, fl = np.freq.length;
    g.lineWidth = Math.max(2, Math.min(W, H) / 160); g.lineCap = 'round';
    for (var k = 0; k < bars; k++) {
      var v = np.freq[Math.floor(Math.pow(k / bars, 1.6) * fl * 0.7)] / 255;
      var len = r0 * 0.9 * v * amp + 2, ang = k / bars * Math.PI * 2 - Math.PI / 2;
      g.strokeStyle = 'rgba(' + col + ',' + (0.35 + v * 0.6).toFixed(3) + ')';
      g.beginPath(); g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len)); g.stroke();
    }
  } else {
    var nb = Math.max(24, Math.min(96, Math.floor(W / 18))), gap = W / nb, bw = gap * 0.7, fl2 = np.freq.length;
    for (var j = 0; j < nb; j++) {
      var a0 = Math.floor(Math.pow(j / nb, 1.7) * fl2 * 0.75), a1 = Math.max(a0 + 1, Math.floor(Math.pow((j + 1) / nb, 1.7) * fl2 * 0.75)), s = 0;
      for (var q = a0; q < a1; q++) s += np.freq[q];
      var vv = s / (a1 - a0) / 255, bh = Math.max(2, vv * H * 0.55 * amp);
      g.fillStyle = 'rgba(' + col + ',' + (0.25 + vv * 0.6).toFixed(3) + ')';
      g.fillRect(j * gap + (gap - bw) / 2, H - bh, bw, bh);
    }
  }
  if (!playing && !np.analyser) { /* 何も鳴っていない：線だけ */ }
}

/* =========================================================
   78-np-lyrics-over.js ― スマホ版：再生画面の「歌詞の重ね表示」（スマホ版 v8.12.3）
   ・スマホ幅（横向きのスマホも。isMobileLayout）の再生画面で、上部のボタン列の「歌詞」ボタン（#np-lyr-toggle）を押すと、
     歌詞をプレイヤー（ジャケット・曲名・再生操作など）の上に重ねて出す（#np-lyr-over）。
     下のプレイヤーは少しグレー（彩度・明るさを落とす＋半透明の覆い）にして、歌詞を読みやすくする
   ・中身：見出し（曲名と「歌詞を閉じる」ボタン）・歌詞の本文（縦にスクロール）・下の「歌詞パネルを開く（入力・検索）」ボタン
     - 時間付きの歌詞：全部の行を出し、今の行を強調して真ん中へ自動スクロール。手でスクロールしたら少し止める
       （15-lyrics.js の LYRICS_SCROLL_PAUSE_MS）。行を押すとその位置から再生
     - 時間の無い歌詞：本文をそのまま出す
     - 歌詞が無い・探している途中：お知らせの文
   ・閉じる：「歌詞を閉じる」ボタン・Esc。再生画面を閉じたときも閉じる（開いた状態は保存しない。次に再生画面を開くとプレイヤーから）
   ・時間付き歌詞の今の1行（.np-lyrics の .np-lyr.active）を押したときも、歌詞パネルではなくこの重ね表示を開く（62-lyrics-mini.js）
   ・スマホ幅では、今の1行の表示を「歌詞」ボタンの保存（ui.npLyrics）に関係なくいつも出す（ボタンが重ね表示の切り替えになったため）
   ・PC 幅は今までどおり（「歌詞」ボタンは時間付き歌詞の表示・非表示）
   ・保存データ・バックアップには触らない
   ========================================================= */

var npLo = { open: false, path: null, result: null, idx: -2 };

function npLyrOverOn() { return npLo.open && typeof isMobileLayout === 'function' && isMobileLayout(); }

/* ---------- 部品を作る（1回だけ。#now-playing の中の一番手前） ---------- */
function _npLoEnsureDom() {
  var host = document.getElementById('now-playing');
  if (!host) return null;
  var el = document.getElementById('np-lyr-over');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'np-lyr-over';
  el.className = 'np-lyr-over';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '歌詞の重ね表示');
  el.innerHTML =
    '<div class="np-lo-head">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static" onclick="copyUiLabel(\'歌詞の重ね表示\', event)" title="クリックで「歌詞の重ね表示」をコピー">□</span>' +
      '<div class="np-lo-title" id="np-lo-title"></div>' +
      '<button type="button" class="np-lo-close" id="np-lo-close" title="歌詞を閉じる（Esc）" aria-label="歌詞を閉じる">' + ICONS.x + '<span>閉じる</span></button>' +
    '</div>' +
    '<div class="np-lo-body" id="np-lo-body" tabindex="-1"></div>' +
    '<div class="np-lo-foot">' +
      '<button type="button" class="np-lo-panel-btn" id="np-lo-panel-btn" title="歌詞パネルを開く（歌詞の入力・Google で検索）">' + ICONS.lyrics + '歌詞パネルを開く（入力・検索）</button>' +
    '</div>';
  host.appendChild(el);
  el.querySelector('#np-lo-close').addEventListener('click', function () { npLyrOverClose(); });
  el.querySelector('#np-lo-panel-btn').addEventListener('click', function () { npLyrOverClose(); if (typeof npOpenLyricsPanel === 'function') npOpenLyricsPanel(); });
  var body = el.querySelector('#np-lo-body');
  // 行を押すと、その位置から再生
  body.addEventListener('click', function (ev) {
    var ln = ev.target.closest('.np-lo-line');
    var r = npLo.result;
    if (!ln || !r || !r.lines || npLo.path !== player.currentPath) return;
    var l = r.lines[+ln.getAttribute('data-i')];
    if (!l) return;
    player.audio.currentTime = l.time;
    if (player.audio.paused) player.audio.play().catch(function () {});
    npLo.scrollPauseUntil = 0;
    _npLoActive(true);
  });
  // 手でスクロールしたら、自動スクロールを少し止める
  var pause = function () { npLo.scrollPauseUntil = Date.now() + (typeof LYRICS_SCROLL_PAUSE_MS === 'number' ? LYRICS_SCROLL_PAUSE_MS : 4000); };
  ['wheel', 'touchmove', 'pointerdown'].forEach(function (n) { body.addEventListener(n, pause, { passive: true }); });
  if (player.audio) player.audio.addEventListener('timeupdate', function () { if (npLyrOverOn()) _npLoActive(false); });
  return el;
}

/* ---------- 開く・閉じる ---------- */
function npLyrOverOpen() {
  if (!(typeof isMobileLayout === 'function' && isMobileLayout())) return;
  var el = _npLoEnsureDom();
  if (!el) return;
  npLo.open = true;
  npLo.path = null; npLo.result = null;   // 中身を作り直す
  npLo.scrollPauseUntil = 0;
  npLyrOverSync();
  setTimeout(function () { var c = document.getElementById('np-lo-close'); if (c && npLo.open) { try { c.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } }, 0);
}
function npLyrOverClose() {
  var was = npLo.open;
  npLo.open = false;
  npLyrOverSync();
  if (was) { var b = document.getElementById('np-lyr-toggle'); if (b && np.open) { try { b.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } }
}
function npLyrOverToggle() { if (npLo.open) npLyrOverClose(); else npLyrOverOpen(); }

/* ---------- 表示を合わせる（開いているか・曲・歌詞が変わったか） ---------- */
function npLyrOverSync() {
  var host = document.getElementById('now-playing');
  if (!host) return;
  var on = npLyrOverOn() && np.open;
  var el = document.getElementById('np-lyr-over');
  host.classList.toggle('np-lyr-over-open', on);
  if (el) el.hidden = !on;
  // 「歌詞」ボタン：スマホ幅では重ね表示の切り替え
  var lt = document.getElementById('np-lyr-toggle');
  if (lt && typeof isMobileLayout === 'function' && isMobileLayout()) {
    lt.classList.toggle('active', on); lt.setAttribute('aria-pressed', on ? 'true' : 'false');
    lt.title = on ? '歌詞を閉じる' : '歌詞をプレイヤーの上に重ねて表示';
  }
  if (!on || !el) return;
  var path = player.currentPath || null;
  var r = typeof lyr !== 'undefined' && lyr.path === path ? lyr.result : null;
  if (npLo.path !== path || npLo.result !== r) {
    npLo.path = path; npLo.result = r; npLo.idx = -2;
    _npLoRender(path, r);
  }
  _npLoActive(false);
}
function _npLoRender(path, r) {
  var t = path ? library.byPath[path] : null;
  var title = path ? (t ? t.title : stripExt(splitPath(path).name)) : '歌詞';
  var tEl = document.getElementById('np-lo-title');
  tEl.textContent = title; tEl.title = title;
  var body = document.getElementById('np-lo-body');
  var h;
  if (!path) h = '<p class="np-lo-msg">曲を再生すると歌詞が表示されます。</p>';
  else if (!r) h = '<p class="np-lo-msg">歌詞を探しています…</p>';
  else if (r.source === 'none') h = '<p class="np-lo-msg">歌詞が見つかりません。<br>下の「歌詞パネルを開く」から、歌詞の入力・Google で検索ができます。</p>';
  else if (r.lines) {
    h = '<div class="np-lo-lines">' + r.lines.map(function (l, i) {
      return '<p class="np-lo-line' + (l.text ? '' : ' np-lo-blank') + '" data-i="' + i + '" title="' + formatDuration(l.time) + ' から再生">' + (l.text ? escapeHtml(l.text) : '♪') + '</p>';
    }).join('') + '</div>';
  } else h = '<div class="np-lo-plain">' + escapeHtml(r.plain) + '</div>';
  body.innerHTML = h;
  body.scrollTop = 0;
  document.getElementById('np-lo-panel-btn').disabled = !path;
}
// 時間付き歌詞の今の行を強調して、真ん中へ動かす
function _npLoActive(force) {
  var r = npLo.result;
  if (!r || !r.lines || npLo.path !== player.currentPath) return;
  var lines = r.lines, now = (player.audio.currentTime || 0) + 0.15, lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].time <= now) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === npLo.idx && force !== true) return;
  var first = npLo.idx === -2;
  npLo.idx = idx;
  var body = document.getElementById('np-lo-body');
  if (!body) return;
  var prev = body.querySelector('.np-lo-line.active');
  if (prev) prev.classList.remove('active');
  if (idx < 0) return;
  var el = body.querySelector('.np-lo-line[data-i="' + idx + '"]');
  if (!el) return;
  el.classList.add('active');
  if (force !== true && Date.now() < (npLo.scrollPauseUntil || 0)) return;   // 手でスクロールした直後は動かさない
  var top = el.offsetTop - body.clientHeight / 2 + el.offsetHeight / 2;
  body.scrollTo({ top: Math.max(0, top), behavior: first ? 'auto' : 'smooth' });
}

/* ---------- 今までの処理につなぐ ---------- */
// 「歌詞」ボタン：スマホ幅では重ね表示の切り替え（37 の ui.npLyrics の切り替えより先に受ける。PC 幅は今までどおり）
document.addEventListener('click', function (ev) {
  if (!ev.target.closest) return;
  var tg = ev.target.closest('#np-lyr-toggle');
  if (!tg || !(typeof isMobileLayout === 'function' && isMobileLayout())) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  npLyrOverToggle();
}, true);
// Esc：重ね表示を開いているときは、再生画面より先に重ね表示だけ閉じる
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape' || !npLyrOverOn() || !np.open) return;
  var av = document.getElementById('art-viewer'), dlg = document.getElementById('dialog-modal');
  if ((av && !av.hidden) || (dlg && !dlg.hidden)) return;   // 上に出ているものを先に閉じる
  ev.preventDefault(); ev.stopImmediatePropagation();
  npLyrOverClose();
}, true);
(function () {
  // 再生画面を描くたび：スマホ幅では今の1行をいつも出し、重ね表示を合わせる
  var r0 = window.npRender;
  if (typeof r0 === 'function') {
    window.npRender = function () {
      var r = r0.apply(this, arguments);
      try {
        if (np.open && typeof isMobileLayout === 'function' && isMobileLayout()) {
          var box = document.getElementById('np-lyrics');
          if (box && box.hidden) { box.hidden = false; np.lyrIdx = -2; _npLyricsUi(); }
        }
        npLyrOverSync();
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生画面を閉じたら、重ね表示も閉じる
  var h0 = window._npHide;
  if (typeof h0 === 'function') {
    window._npHide = function () {
      npLo.open = false;
      try { npLyrOverSync(); } catch (e) { console.warn(e); }
      return h0.apply(this, arguments);
    };
  }
  // 歌詞を読み込み終わった・曲が変わったとき（15-lyrics.js の _updateLyricsMini のあと）
  var u0 = window._updateLyricsMini;
  if (typeof u0 === 'function') {
    window._updateLyricsMini = function () {
      var r = u0.apply(this, arguments);
      try { if (npLo.open) npLyrOverSync(); } catch (e) { console.warn(e); }
      return r;
    };
  }
})();
// 画面の向き・幅が変わって PC 幅になったら覆いを外す（スマホ幅に戻ったら開いていた状態に戻す）
window.addEventListener('resize', function () { if (typeof np !== 'undefined' && np.open) { try { npLyrOverSync(); } catch (e) { /* 無視 */ } } });

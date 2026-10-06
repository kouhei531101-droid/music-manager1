/* =========================================================
   15-lyrics.js ― 歌詞
   ・歌詞パネルは常に表示。歌詞ボタン（再生バー）・歌詞の見出しの縮小ボタンで「縮小した歌詞パネル」と切り替え（状態は保存）
       パソコン幅：通常は右側（幅 360px）、縮小すると細い帯（縦書きの「歌詞」）
       スマホ幅：通常は再生バーの上の帯（画面の4割ほど）、縮小すると1行（今の行）だけ
   ・歌詞の検索ボタン：Google で「曲名 アーティスト 歌詞」を新しいタブで検索（結果は取り込まない）
   ・歌詞の探し方（この順）：
       ① アプリ内で入力・編集した歌詞（db.lyrics。曲の相対パスで紐付け、バックアップ対象）
       ② 曲と同じフォルダの同じ名前の歌詞ファイル（曲名.lrc → 曲名.txt。大文字小文字は区別しない）
       ③ 曲ファイルに埋め込まれた歌詞（ID3 USLT/SYLT、m4a ©lyr、flac・ogg LYRICS/UNSYNCEDLYRICS）
     インターネットからは取ってこない。音楽ファイル・歌詞ファイルは読むだけ
   ・時間付き歌詞（LRC・SYLT）：今の行を強調して自動スクロール（手でスクロールしたら数秒止める）。行を押すとその位置から再生
   ・歌詞の入力ダイアログ：貼り付け・編集（LRC 形式も可）・入力した歌詞の削除（確認付き）
   ========================================================= */

var LYRICS_FONT_DEFAULT = 17, LYRICS_FONT_MIN = 12, LYRICS_FONT_MAX = 30;
var LYRICS_SCROLL_PAUSE_MS = 4000;          // 手でスクロールしたら、自動スクロールを止める時間
var LYRICS_MAX_CHARS = 100000;              // 入力できる歌詞の長さ（保存容量を守るため）
var LYRICS_SOURCE_LABELS = { user: '入力した歌詞', lrc: 'lrcファイル', txt: 'txtファイル', embedded: '曲ファイルに埋め込み', none: '' };

var lyr = {
  path: null,          // 歌詞パネルに出している曲
  token: 0,            // 読み込みの順番（古い結果を捨てるため）
  result: null,        // { source, name, raw, lines:[{time,text}] または null, plain }
  activeIdx: -1,       // 強調している行
  userScrollUntil: 0,  // この時刻までは自動スクロールしない
  cache: new Map()     // 相対パス → 歌詞ファイル・埋め込みの読み取り結果（入力した歌詞は入れない）
};

/* ---------- LRC 形式を読む ---------- */
// [mm:ss.xx] で始まる行を時間付きの行にする。時間付きの行が2つ未満なら null（時間なし歌詞として扱う）
function parseLrc(text) {
  var out = [], offset = 0;
  var re = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
    var om = line.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (om) { offset = parseInt(om[1], 10) / 1000; return; }
    var times = [], rest = line, m;
    while ((m = rest.match(re))) {
      times.push(+m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3]) : 0));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) return;   // [ar:…] などの情報行・時間の無い行は使わない
    rest = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();   // 単語ごとの時間（拡張 LRC）は外す
    times.forEach(function (t) { out.push({ time: t, text: rest }); });
  });
  if (out.length < 2) return null;
  out.forEach(function (l) { l.time = Math.max(0, l.time - offset); });   // offset がプラスなら歌詞を早める
  out.sort(function (a, b) { return a.time - b.time; });
  return out;
}
function _lyricsFromText(source, raw, name) {
  var text = String(raw || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (!text.trim()) return null;
  var lines = parseLrc(text);
  return { source: source, name: name || '', raw: text, lines: lines, plain: lines ? '' : text.trim() };
}

/* ---------- 歌詞を探す ---------- */
async function loadLyricsFor(path) {
  // ① 入力した歌詞
  var u = db.lyrics && db.lyrics[path];
  if (u && u.text) { var r0 = _lyricsFromText('user', u.text); if (r0) return r0; }
  if (lyr.cache.has(path)) return lyr.cache.get(path);
  var t = library.byPath[path];
  var res = { source: 'none', name: '', raw: '', lines: null, plain: '' };
  if (t) {
    // ② 同じフォルダの 曲名.lrc → 曲名.txt
    try {
      var dir = await getDirHandleByPath(t.folder, false);
      var base = stripExt(t.name).toLowerCase(), lrc = null, txt = null;
      for await (var h of dir.values()) {
        if (h.kind !== 'file') continue;
        var n = h.name.toLowerCase();
        if (n === base + '.lrc') lrc = h; else if (n === base + '.txt') txt = h;
      }
      var hf = lrc || txt;
      if (hf) {
        var f = await hf.getFile();
        var r1 = _lyricsFromText(lrc ? 'lrc' : 'txt', decodeTextBytes(new Uint8Array(await f.arrayBuffer())), hf.name);
        if (r1) res = r1;
      }
    } catch (e) { console.warn('歌詞ファイルを読めませんでした', path, e); }
    // ③ 曲ファイルに埋め込まれた歌詞
    if (res.source === 'none') {
      try {
        var emb = await readTrackLyrics(await t.handle.getFile());
        if (emb && emb.synced) {
          res = { source: 'embedded', name: 'SYLT', raw: emb.text, lines: emb.synced.slice().sort(function (a, b) { return a.time - b.time; }), plain: '' };
        } else if (emb && emb.text) {
          var r2 = _lyricsFromText('embedded', emb.text, '');
          if (r2) res = r2;
        }
      } catch (e) { console.warn('埋め込み歌詞を読めませんでした', path, e); }
    }
  }
  lyr.cache.set(path, res);
  if (lyr.cache.size > 60) lyr.cache.delete(lyr.cache.keys().next().value);   // 古いものから捨てる
  return res;
}
function lyricsCacheClear() { lyr.cache.clear(); }

/* ---------- 歌詞パネル（常に表示。歌詞ボタンで「縮小した歌詞パネル」と切り替え） ---------- */
function isLyricsCollapsed() { return !!ui.lyricsCollapsed; }
function setLyricsCollapsed(collapsed) {
  ui.lyricsCollapsed = !!collapsed;
  saveUi();
  _applyLyricsPanelState();
  lyricsOnTime(true);   // 元の大きさに戻したとき、今の行まで動かす
  if (typeof fitAlbumHeadName === 'function') fitAlbumHeadName();   // 本文の幅が変わるので、アルバム名の大きさを計算し直す
  if (typeof artistsRelayoutIfNeeded === 'function') artistsRelayoutIfNeeded();   // artist の2列／1列（v3.3）
}
function toggleLyricsCollapsed() { setLyricsCollapsed(!ui.lyricsCollapsed); }
// 以前の名前（v1.4）。true＝元の大きさ、false＝縮小
function toggleLyricsPanel(force) { setLyricsCollapsed(typeof force === 'boolean' ? !force : !ui.lyricsCollapsed); }
function _applyLyricsPanelState() {
  var panel = document.getElementById('lyrics-panel');
  if (!panel) return;
  var collapsed = !!ui.lyricsCollapsed;
  panel.hidden = false;
  panel.classList.toggle('is-collapsed', collapsed);
  document.body.classList.toggle('lyr-collapsed', collapsed);
  document.body.classList.toggle('lyr-expanded', !collapsed);
  var btn = document.getElementById('pb-lyrics');
  if (btn) {
    btn.classList.toggle('active', !collapsed);
    btn.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
    btn.title = collapsed ? '歌詞パネルを元の大きさに戻す' : '歌詞パネルを縮小する';
  }
  var mini = document.getElementById('lyrics-mini');
  if (mini) mini.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  _applyLyricsFont();
}
// 再生バーの表示を更新するたびに呼ばれる：曲が変わっていたら読み直す
function lyricsOnPlayerUpdate() {
  if ((player.currentPath || null) !== lyr.path) lyricsReload();
  else _renderLyricsHead();   // 曲情報の編集などで曲名が変わったとき
}
// 今の曲の歌詞を読み直して表示する（パネルは常に表示なので、いつでも読む）
async function lyricsReload() {
  var path = player.currentPath || null;
  lyr.path = path;
  lyr.result = null;
  lyr.activeIdx = -1;
  var token = ++lyr.token;
  _renderLyricsHead();
  var body = document.getElementById('lyrics-body');
  if (!path) {
    body.innerHTML = '<div class="lyrics-empty"><p>曲を再生すると歌詞が表示されます。</p>' +
      '<p class="dialog-hint">曲一覧・アルバム・プレイリストの ▶ で再生してください。</p></div>';
    _updateLyricsMini();
    return;
  }
  body.innerHTML = '<div class="lyrics-empty">歌詞を探しています…</div>';
  _updateLyricsMini('歌詞を探しています…');
  var res = await loadLyricsFor(path);
  if (token !== lyr.token) return;   // 待っている間に曲が変わった
  lyr.result = res;
  _renderLyricsHead();
  _renderLyricsBody();
  lyricsOnTime(true);
  _updateLyricsMini();
}
// 今の曲名・アーティスト（アプリ内の上書き・編集後の値。推定したアーティストは使わない）
function _lyricsSongInfo() {
  var path = lyr.path;
  if (!path) return null;
  var t = library.byPath[path];
  var title = t ? t.title : stripExt(splitPath(path).name);
  var artist = t ? (t.tagArtist || '') : '';
  return { title: title, artist: artist };
}
function _renderLyricsHead() {
  var path = lyr.path;
  var t = path ? library.byPath[path] : null;
  var titleEl = document.getElementById('lyrics-title'), subEl = document.getElementById('lyrics-sub');
  titleEl.textContent = path ? (t ? t.title : stripExt(splitPath(path).name)) : '歌詞';
  titleEl.title = titleEl.textContent;   // 長い曲名は「…」で省略するので、全文はマウスを乗せると見える
  subEl.innerHTML = t ? artistAlbumLinksHtml(t) : '';   // アーティストへのリンク・アルバムへのリンク（v3.1）
  subEl.title = t ? [t.artist, t.album].filter(Boolean).join(' ・ ') : '';
  var r = lyr.result, src = '';
  if (r && r.source !== 'none') {
    src = LYRICS_SOURCE_LABELS[r.source] + (r.name ? '（' + r.name + '）' : '') + (r.lines ? ' ・ 時間付き' : '');
  }
  var srcEl = document.getElementById('lyrics-source');
  srcEl.textContent = src || '　';
  srcEl.title = src;
  srcEl.classList.toggle('is-empty', !src);   // 無いときも場所は残す（見出しの高さを変えない）
  document.getElementById('lyrics-edit-btn').disabled = !path;
  document.getElementById('lyrics-search-btn').disabled = !path;   // 曲が選ばれていないときは押せない
}
function _renderLyricsBody() {
  var body = document.getElementById('lyrics-body');
  var r = lyr.result;
  if (!r || r.source === 'none') {
    body.innerHTML = '<div class="lyrics-empty"><p>歌詞が見つかりません。</p>' +
      '<p class="dialog-hint">曲と同じフォルダに「' + escapeHtml(lyr.path ? stripExt(splitPath(lyr.path).name) : '曲名') + '.lrc」か「.txt」を置くか、ここで入力できます。' +
      'Google で探した歌詞は、コピーして「歌詞を入力する」に貼り付けられます。</p>' +
      '<div class="lyrics-empty-btns">' +
        '<button class="btn-save" onclick="openLyricsEditor()">' + ICONS.edit + '歌詞を入力する</button>' +
        '<button class="btn-cancel lyrics-search-btn2" onclick="searchLyricsOnGoogle()" title="Googleで歌詞を検索" aria-label="Googleで歌詞を検索">' + ICONS.search + 'Googleで歌詞を検索</button>' +
      '</div></div>';
    return;
  }
  if (r.lines) {
    body.innerHTML = '<div class="lyrics-lines">' + r.lines.map(function (l, i) {
      return '<p class="lyr-line' + (l.text ? '' : ' lyr-blank') + '" data-i="' + i + '" title="' + formatDuration(l.time) + ' から再生">' + (l.text ? escapeHtml(l.text) : '♪') + '</p>';
    }).join('') + '</div>';
  } else {
    body.innerHTML = '<div class="lyrics-plain">' + escapeHtml(r.plain) + '</div>';
  }
  body.scrollTop = 0;
}

/* ---------- 縮小した歌詞パネルの1行表示（スマホ幅で使う。パソコン幅は縦書きの「歌詞」） ---------- */
function _updateLyricsMini(msg) {
  var el = document.getElementById('lyrics-mini-line');
  if (!el) return;
  var text = msg || '';
  if (!text) {
    var r = lyr.result;
    if (!lyr.path) text = '曲を再生すると歌詞が表示されます';
    else if (!r) text = '歌詞を探しています…';
    else if (r.source === 'none') text = '歌詞が見つかりません';
    else if (r.lines) {
      var l = lyr.activeIdx >= 0 ? r.lines[lyr.activeIdx] : null;
      text = l ? (l.text || '♪') : '♪';
    } else {
      text = (r.plain.split('\n').filter(function (x) { return x.trim(); })[0] || '♪');
    }
  }
  el.textContent = text;
}

/* ---------- Google で歌詞を検索（新しいタブで開くだけ。結果は取り込まない） ---------- */
function lyricsSearchUrl(info) {
  var q = info.title + (info.artist ? ' ' + info.artist : '') + ' 歌詞';
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}
function searchLyricsOnGoogle() {
  var info = _lyricsSongInfo();
  if (!info) { showToast('曲が選ばれていません。'); return; }
  window.open(lyricsSearchUrl(info), '_blank', 'noopener');
}

/* ---------- 時間付き歌詞：今の行を強調・自動スクロール ---------- */
function lyricsOnTime(force) {
  if (!lyr.result || !lyr.result.lines || lyr.path !== player.currentPath) return;
  var lines = lyr.result.lines, now = (player.audio.currentTime || 0) + 0.15;
  // 今の時間より前で一番新しい行（二分探索）
  var lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].time <= now) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === lyr.activeIdx && force !== true) return;
  var body = document.getElementById('lyrics-body');
  var prev = body.querySelector('.lyr-line.active');
  if (prev) prev.classList.remove('active');
  lyr.activeIdx = idx;
  _updateLyricsMini();
  if (idx < 0) return;
  var el = body.querySelector('.lyr-line[data-i="' + idx + '"]');
  if (!el) return;
  el.classList.add('active');
  if (ui.lyricsCollapsed) return;                  // 縮小中は本文が見えないので動かさない
  if (Date.now() < lyr.userScrollUntil) return;   // 手でスクロールした直後は動かさない
  var top = el.offsetTop - body.clientHeight / 2 + el.offsetHeight / 2;
  body.scrollTo({ top: Math.max(0, top), behavior: force === true ? 'auto' : 'smooth' });
}
function _lyricsUserScrolled() { lyr.userScrollUntil = Date.now() + LYRICS_SCROLL_PAUSE_MS; }

/* ---------- 文字の大きさ ---------- */
function changeLyricsFont(step) {
  var cur = +ui.lyricsFont || LYRICS_FONT_DEFAULT;
  ui.lyricsFont = Math.min(LYRICS_FONT_MAX, Math.max(LYRICS_FONT_MIN, cur + step * 2));
  saveUi();
  _applyLyricsFont();
  lyricsOnTime(true);
}
function _applyLyricsFont() {
  var body = document.getElementById('lyrics-body');
  if (body) body.style.fontSize = (+ui.lyricsFont || LYRICS_FONT_DEFAULT) + 'px';
}

/* ---------- 歌詞の入力ダイアログ ---------- */
async function openLyricsEditor() {
  var path = lyr.path || player.currentPath;
  if (!path) { showToast('再生中の曲がありません。'); return; }
  var t = library.byPath[path];
  var mine = db.lyrics && db.lyrics[path];
  var initial = mine ? mine.text : (lyr.path === path && lyr.result ? lyr.result.raw : '');
  var body =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'歌詞の入力ダイアログ\', event)" title="クリックで「歌詞の入力ダイアログ」をコピー">□</span>' +
    '<div class="dialog-message"><strong>' + escapeHtml(t ? t.title : stripExt(splitPath(path).name)) + '</strong>' +
      (t && t.artist ? '　' + escapeHtml(t.artist) : '') + '</div>' +
    '<textarea class="form-textarea lyrics-edit-text" id="lyrics-edit-text" rows="16" spellcheck="false" placeholder="ここに歌詞を貼り付けます">' + escapeHtml(initial || '') + '</textarea>' +
    '<p class="dialog-hint">LRC 形式（[01:23.45]歌詞 のように時間付き）もそのまま貼り付けられます。保存するとアプリの中（バックアップの対象）に保存され、' +
      '曲ファイルや歌詞ファイルは変わりません。' + (mine ? '' : (initial ? '今表示している歌詞を下書きとして入れています。' : '')) + '</p>' +
    '<div class="dialog-error" id="lyrics-edit-error"></div>';
  var buttons = [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }];
  if (mine) buttons.push({ label: '入力した歌詞を削除', value: 'delete', cls: 'btn-cancel btn-cancel-danger' });
  buttons.push({ label: '保存', value: 'ok', cls: 'btn-save', isDefault: true });
  var text = '';
  var v = await openDialog({
    title: '歌詞の入力・編集',
    body: body,
    size: 'large',
    buttons: buttons,
    onOpen: function (b) {
      // 全部選んだ状態にならないよう、カーソルを先頭に置く（openDialog が入力欄を選ぶため少し待つ）
      setTimeout(function () { var ta = b.querySelector('#lyrics-edit-text'); if (ta) { ta.setSelectionRange(0, 0); ta.scrollTop = 0; } }, 80);
    },
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      text = b.querySelector('#lyrics-edit-text').value.replace(/\r\n?/g, '\n');
      var err = '';
      if (!text.trim()) err = '歌詞が空です。入力した歌詞を消したいときは「入力した歌詞を削除」を使ってください。';
      else if (text.length > LYRICS_MAX_CHARS) err = '長すぎます（' + LYRICS_MAX_CHARS + '文字まで）。';
      if (err) { b.querySelector('#lyrics-edit-error').textContent = err; return false; }
      return true;
    }
  });
  if (v === 'ok') {
    var before = db.lyrics[path];
    db.lyrics[path] = { text: text, updatedAt: nowIso() };
    if (!saveDB()) {   // 保存容量が足りないときは元に戻す
      if (before) db.lyrics[path] = before; else delete db.lyrics[path];
      await showAlert({ title: '保存できませんでした', message: 'ブラウザの保存容量が足りない可能性があります。入力した歌詞は保存されていません。' });
      return;
    }
    showToast('歌詞を保存しました。');
    lyricsReload();
  } else if (v === 'delete') {
    var ok = await showConfirm({
      title: '入力した歌詞を削除',
      message: '「' + escapeHtml(t ? t.title : splitPath(path).name) + '」の、アプリで入力した歌詞を削除します。<br>' +
        '削除すると、歌詞ファイル（lrc・txt）や曲ファイルに埋め込まれた歌詞があればそちらを表示します（ファイルは変わりません）。',
      okText: '削除する',
      danger: true
    });
    if (!ok) return;
    delete db.lyrics[path];
    saveDB();
    showToast('入力した歌詞を削除しました。');
    lyricsReload();
  }
}

/* ---------- 起動時に1回だけ ---------- */
function initLyrics() {
  applyIcons(document.getElementById('lyrics-panel'));
  var body = document.getElementById('lyrics-body');
  // 行を押すと、その位置から再生
  body.addEventListener('click', function (ev) {
    var el = ev.target.closest('.lyr-line');
    if (!el || !lyr.result || !lyr.result.lines || lyr.path !== player.currentPath) return;
    var l = lyr.result.lines[+el.getAttribute('data-i')];
    if (!l) return;
    player.audio.currentTime = l.time;
    if (player.audio.paused) player.audio.play().catch(function () {});
    lyr.userScrollUntil = 0;
    lyricsOnTime(true);
  });
  // 手でスクロールしたら、自動スクロールを少し止める
  ['wheel', 'touchmove', 'pointerdown'].forEach(function (n) { body.addEventListener(n, _lyricsUserScrolled, { passive: true }); });
  body.addEventListener('keydown', _lyricsUserScrolled);
  player.audio.addEventListener('timeupdate', function () { lyricsOnTime(false); });
  player.audio.addEventListener('seeked', function () { lyricsOnTime(true); });
  _applyLyricsPanelState();
  lyricsReload();   // 曲が無いときは案内を出す
}

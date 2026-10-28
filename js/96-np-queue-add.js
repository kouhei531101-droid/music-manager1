/* =========================================================
   96-np-queue-add.js ― スマホ版：再生画面の「キューに追加ボタン」と「キューに追加パネル」（スマホ版 v8.25.6。PC版 v8.7.85 と同じ名前・同じ中身）
   ・再生画面の曲リスト（再生画面のアルバムの曲リスト〔50-np-album.js〕・プレイリストの play画面のキュー〔39-playlist-play.js〕）の見出しに
     「キューに追加ボタン」（＋追加）を足す。「次に再生（予約）」ダイアログ（82-up-next.js）にも「＋曲を追加」（再生画面を開いているときだけ）
   ・押すと再生画面の下から「キューに追加パネル」（#np-qa）が出る。上の「キューに追加のタブ」で3つを切り替える（最後に選んだタブは ui.npQaTab）
       Pin のアルバム   ：Pin したアルバム（db.pinnedAlbums の順。非表示のアルバムは出さない）をジャケット付きで。押すとそのアルバムの曲の一覧（「← Pin のアルバム」で戻る）
       最近再生した曲   ：再生の記録（db.playStats の最終再生）の新しい順に NPQA_RECENT_MAX 曲
       heavy rotation  ：heavy rotation の画面と同じ中身（20-heavy-rotation.js の getHeavyList。同じ期間 ui.heavyDays・回数の多い順）
   ・各曲・各アルバムに「次に再生」「最後に追加」。足す処理は今の 82-up-next.js の upNextAdd（トースト「元に戻す」付き・予約の札もすぐ変わる）。パネルは開いたまま
   ・重さ：一覧はパネルを開いたとき・タブを替えたときだけ作る。行は NPQA_CHUNK 行ずつ描き、下までスクロールしたら続きを足す。
     ジャケットは 13-artwork.js の artThumbHtml・artObserve（再生画面の中だけ見張る。見えた行の分だけ読む）。再生画面を閉じたらパネルも閉じて中身を消す
   ========================================================= */

var NPQA_RECENT_MAX = 50;   // 「最近再生した曲」に出す曲の数
var NPQA_CHUNK = 60;        // 一度に描く行の数
var NPQA_TABS = [['pin', 'Pin のアルバム'], ['recent', '最近再生した曲'], ['heavy', 'heavy rotation']];
var npqa = { open: false, tab: 'pin', album: null, rows: [], list: null, shown: 0, amap: null, rev: '' };

function _npqaLbl(name, style) {
  return '<span class="ui-label-tag ui-label-tag-onlight" style="' + (style || 'position:static') + '" onclick="copyUiLabel(\'' + name + '\', event)" title="クリックで「' + name + '」をコピー">□</span>';
}
function npqaTab() { return NPQA_TABS.some(function (t) { return t[0] === ui.npQaTab; }) ? ui.npQaTab : 'pin'; }

/* ---------- 一覧のもと ---------- */
function _npqaAlbumMap() {
  var rev = library.metaRev + ':' + library.tracks.length;
  if (!npqa.amap || npqa.rev !== rev) {
    var m = new Map();
    buildAlbums().forEach(function (a) { m.set(a.key, a); });
    npqa.amap = m; npqa.rev = rev;
  }
  return npqa.amap;
}
function _npqaWhen(ms) {
  if (!ms) return '';
  var d = new Date(ms), now = new Date(), hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return '今日 ' + hm;
  return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
// タブの中身：{ albums | items:[{ t, s }], note, empty }
function _npqaData(tab) {
  var out = {};
  if (!library.tracks.length) { out.empty = '曲がまだ読み込まれていません。音楽フォルダを読み込んでください。'; return out; }
  if (tab === 'pin') {
    var map = _npqaAlbumMap(), hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : null;
    out.albums = (db.pinnedAlbums || []).map(function (pa) { return map.get(pa.key); }).filter(function (a) { return a && !(hs && hs.has(a.key)); });
    if (!out.albums.length) out.empty = 'Pin したアルバムはありません。album の画面で、アルバムの見出しの Pin ボタンを押すと、ここに並びます。';
  } else if (tab === 'recent') {
    var st = db.playStats || {}, arr = [];
    Object.keys(st).forEach(function (p) { var s = st[p]; if (s && s.l && library.byPath[p]) arr.push([p, s.l]); });
    arr.sort(function (x, y) { return y[1] - x[1]; });
    out.items = arr.slice(0, NPQA_RECENT_MAX).map(function (x) { return { t: library.byPath[x[0]], s: _npqaWhen(x[1]) }; });
    out.note = '新しい順に最大 ' + NPQA_RECENT_MAX + ' 曲（曲を半分〔または30秒〕以上聞くと記録します）';
    if (!out.items.length) out.empty = 'まだ再生の記録がありません。曲を半分（または30秒）以上聞くと、ここに並びます。';
  } else {
    var days = +(ui.heavyDays || 0), label = '全期間';
    (typeof HEAVY_PERIODS !== 'undefined' ? HEAVY_PERIODS : []).forEach(function (o) { if (o[0] === days) label = o[1]; });
    out.items = (typeof getHeavyList === 'function' ? getHeavyList() : []).map(function (x) { var s = (db.playStats || {})[x.t.path] || {}; return { t: x.t, s: x.n + '回' + (s.l ? ' ・ ' + formatDateShort(s.l) : '') }; });
    out.note = 'heavy rotation の画面と同じ（期間：' + label + '・回数の多い順）';
    if (!out.items.length) out.empty = 'この期間（' + label + '）に再生した曲はまだありません。期間は heavy rotation の画面で選べます。';
  }
  return out;
}

/* ---------- キューに追加ボタン（曲リストの見出し） ---------- */
function _npqaBtnHtml() {
  return '<button type="button" class="np-qa-btn" data-npqa-open="1" aria-haspopup="dialog" aria-expanded="' + npqa.open + '" title="キューに曲を追加（Pin のアルバム・最近再生した曲・heavy rotation から選ぶ）" aria-label="キューに追加">' +
    ICONS.plus + '<span>追加</span></button>' + _npqaLbl('キューに追加ボタン', 'position:static');
}
function npqaDecorate() {
  var el = document.getElementById('now-playing'); if (!el) return;
  el.querySelectorAll('.np-queue .plp-q-head').forEach(function (h) {
    if (h.querySelector('.np-qa-btn')) return;
    h.insertAdjacentHTML('beforeend', _npqaBtnHtml());
  });
}
// 曲リストを描いたあとに足す（50-np-album.js の npAlbumRender は、プレイリストの play画面の plpRender のあとにも呼ばれる）
(function () {
  var f = window.npAlbumRender;
  if (typeof f !== 'function') return;
  window.npAlbumRender = function () { var r = f.apply(this, arguments); try { npqaDecorate(); } catch (e) { console.warn(e); } return r; };
})();
// 再生画面を閉じたら、パネルも閉じて中身を消す（下の一覧のサムネイルの見張りに混ざらないように）
(function () {
  var f = window._npHide;
  if (typeof f !== 'function') return;
  window._npHide = function () { npqaClose(true); return f.apply(this, arguments); };
})();
// 予約が変わったら：パネルの見出しの予約の数（82-up-next.js の upNextRefresh を包む）
(function () {
  var f = window.upNextRefresh;
  if (typeof f !== 'function') return;
  window.upNextRefresh = function () { var r = f.apply(this, arguments); try { _npqaCount(); } catch (e) { console.warn(e); } return r; };
})();

/* ---------- キューに追加パネル ---------- */
function _npqaEnsure() {
  var p = document.getElementById('np-qa');
  if (p) return p;
  var host = document.getElementById('now-playing'); if (!host) return null;
  host.insertAdjacentHTML('beforeend',
    '<div class="np-qa-back-drop" id="np-qa-drop" hidden></div>' +
    '<section class="np-qa" id="np-qa" hidden role="dialog" aria-label="キューに追加パネル">' +
      '<div class="np-qa-head"><span class="np-qa-title">' + ICONS.plus + 'キューに追加</span><span class="np-qa-n" id="np-qa-n"></span>' + _npqaLbl('キューに追加パネル') +
        '<button type="button" class="np-qa-close" id="np-qa-close" aria-label="キューに追加パネルを閉じる">' + ICONS.x + '閉じる</button></div>' +
      '<div class="np-qa-tabs" id="np-qa-tabs" role="tablist" aria-label="キューに追加のタブ">' +
        NPQA_TABS.map(function (t) { return '<button type="button" class="np-qa-tab" role="tab" data-npqa-tab="' + t[0] + '" aria-selected="false">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="np-qa-note" id="np-qa-note" hidden></div>' +
      '<div class="np-qa-body" id="np-qa-body" role="tabpanel" aria-label="キューに追加の一覧"></div>' +
    '</section>');
  p = document.getElementById('np-qa');
  document.getElementById('np-qa-close').addEventListener('click', function () { npqaClose(); });
  document.getElementById('np-qa-drop').addEventListener('click', function () { npqaClose(); });
  document.getElementById('np-qa-tabs').addEventListener('click', function (ev) { var b = ev.target.closest('[data-npqa-tab]'); if (b) _npqaSetTab(b.getAttribute('data-npqa-tab'), true); });
  var body = document.getElementById('np-qa-body');
  body.addEventListener('click', _npqaBodyClick);
  body.addEventListener('scroll', function () { if (body.scrollTop + body.clientHeight > body.scrollHeight - 200) _npqaMore(); }, { passive: true });
  return p;
}
function npqaOpen() {
  if (typeof np === 'undefined' || !np.open) return;
  var p = _npqaEnsure(); if (!p) return;
  npqa.open = true;
  p.hidden = false; document.getElementById('np-qa-drop').hidden = false;
  document.getElementById('now-playing').classList.add('is-qa-open');
  _npqaBtns();
  _npqaCount();
  _npqaSetTab(npqaTab(), false);
  var t = p.querySelector('.np-qa-tab.active'); if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
// clear：中身も消す（再生画面を閉じたとき）
function npqaClose(clear) {
  var p = document.getElementById('np-qa');
  if (!p) return;
  var was = npqa.open;
  npqa.open = false;
  p.hidden = true; document.getElementById('np-qa-drop').hidden = true;
  var el = document.getElementById('now-playing'); if (el) el.classList.remove('is-qa-open');
  if (clear || was) { document.getElementById('np-qa-body').innerHTML = ''; npqa.rows = []; npqa.list = null; }
  _npqaBtns();
  if (was && !clear) { var b = document.querySelector('#now-playing .np-qa-btn'); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } }
}
function _npqaBtns() { document.querySelectorAll('#now-playing .np-qa-btn').forEach(function (b) { b.classList.toggle('active', npqa.open); b.setAttribute('aria-expanded', String(npqa.open)); }); }
function _npqaCount() {
  var el = document.getElementById('np-qa-n'); if (!el) return;
  var n = upNextList().length;
  el.textContent = n ? '予約 ' + n + '曲' : '予約なし';
}
function _npqaSetTab(tab, user) {
  if (!NPQA_TABS.some(function (t) { return t[0] === tab; })) tab = 'pin';
  if (user && tab !== npqa.tab) npqa.album = null;
  npqa.tab = tab;
  if (user && ui.npQaTab !== tab) { ui.npQaTab = tab; saveUi(); }
  document.querySelectorAll('#np-qa [data-npqa-tab]').forEach(function (b) { var on = b.getAttribute('data-npqa-tab') === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  _npqaRender();
}

/* ---------- 描く ---------- */
function _npqaAddBtns(i, what) {
  return '<span class="np-qa-btns"><button type="button" class="np-qa-add" data-npqa-add="next" data-npqa-i="' + i + '" title="' + what + 'を次に再生（今の曲の次に流す）" aria-label="' + what + 'を次に再生">' + ICONS.playNext + '<span>次に再生</span></button>' +
    '<button type="button" class="np-qa-add" data-npqa-add="last" data-npqa-i="' + i + '" title="' + what + 'をキューの最後に追加" aria-label="' + what + 'をキューの最後に追加">' + ICONS.queueAdd + '<span>最後に追加</span></button></span>';
}
function _npqaSongRow(t, sub, withArt, no) {
  var i = npqa.rows.push({ paths: [t.path], label: '曲' }) - 1;
  return '<li class="np-qa-row">' + (withArt ? artThumbHtml(t, 'np-qa-art') : '<span class="np-qa-no">' + escapeHtml(no) + '</span>') +
    '<span class="np-qa-text"><span class="np-qa-t">' + escapeHtml(t.title) + '</span><span class="np-qa-a">' + escapeHtml(t.artist || '') + (sub ? '<span class="np-qa-s">' + escapeHtml(sub) + '</span>' : '') + '</span></span>' +
    _npqaAddBtns(i, 'この曲') + '</li>';
}
function _npqaRender() {
  var body = document.getElementById('np-qa-body'), note = document.getElementById('np-qa-note');
  if (!body) return;
  var d = _npqaData(npqa.tab);
  npqa.rows = []; npqa.list = null; npqa.shown = 0;
  note.textContent = d.note && !d.empty ? d.note : ''; note.hidden = !note.textContent;
  if (d.empty) { body.innerHTML = '<p class="np-qa-empty">' + escapeHtml(d.empty) + '</p>'; return; }
  if (npqa.tab === 'pin') {
    var a = npqa.album ? d.albums.find(function (x) { return x.key === npqa.album; }) : null;
    if (npqa.album && !a) npqa.album = null;
    if (a) {   // アルバムの曲の一覧
      var ai = npqa.rows.push({ paths: a.tracks.map(function (t) { return t.path; }), label: 'Pin のアルバム' }) - 1;
      body.innerHTML = '<button type="button" class="np-qa-backbtn" data-npqa-back="1">' + ICONS.back + 'Pin のアルバム</button>' +
        '<div class="np-qa-album-head">' + artThumbHtml(a.cover, 'np-qa-art np-qa-art-l') +
          '<span class="np-qa-text"><span class="np-qa-t">' + escapeHtml(a.name) + '</span><span class="np-qa-a">' + escapeHtml(a.artist || '') + (a.artist ? ' ・ ' : '') + a.tracks.length + '曲' + (a.duration ? ' ・ ' + formatTotalDuration(a.duration) : '') + '</span>' +
          '<span class="np-qa-whole">アルバムごと：' + _npqaAddBtns(ai, 'アルバムの全曲（' + a.tracks.length + '曲）') + '</span></span></div>' +
        '<ol class="np-qa-list">' + a.tracks.map(function (t, i) { var o = albumTrackOrder(t); return _npqaSongRow(t, formatDuration(t.duration), false, o.has ? (a.multiDisc ? o.disc + '-' + o.track : String(o.track)) : String(i + 1)); }).join('') + '</ol>';
    } else {
      body.innerHTML = '<ol class="np-qa-list">' + d.albums.map(function (x) {
        var i = npqa.rows.push({ paths: x.tracks.map(function (t) { return t.path; }), label: 'Pin のアルバム' }) - 1;
        return '<li class="np-qa-row np-qa-albrow"><button type="button" class="np-qa-open" data-npqa-album="' + escapeHtml(x.key) + '" title="「' + escapeHtml(x.name) + '」の曲を見る">' + artThumbHtml(x.cover, 'np-qa-art np-qa-art-m') +
          '<span class="np-qa-text"><span class="np-qa-t">' + escapeHtml(x.name) + '</span><span class="np-qa-a">' + escapeHtml(x.artist || '') + (x.artist ? ' ・ ' : '') + x.tracks.length + '曲</span></span></button>' +
          _npqaAddBtns(i, 'アルバムの全曲（' + x.tracks.length + '曲）') + '</li>';
      }).join('') + '</ol>';
    }
    body.scrollTop = 0;
    artObserve(body);
    return;
  }
  body.innerHTML = '<ol class="np-qa-list"></ol>';
  body.scrollTop = 0;
  npqa.list = d.items;
  _npqaMore();
}
// 続きの行を描く（最近再生した曲・heavy rotation）
function _npqaMore() {
  var L = npqa.list; if (!npqa.open || !L || npqa.shown >= L.length) return;
  var ol = document.querySelector('#np-qa-body .np-qa-list'); if (!ol) return;
  var end = Math.min(L.length, npqa.shown + NPQA_CHUNK), h = '';
  for (var i = npqa.shown; i < end; i++) h += _npqaSongRow(L[i].t, L[i].s, true);
  npqa.shown = end;
  var tmp = document.createElement('ol'); tmp.innerHTML = h;
  var frag = document.createDocumentFragment(); while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  ol.appendChild(frag);
  artObserve(ol);
}

/* ---------- 押したとき ---------- */
function _npqaBodyClick(ev) {
  var b = ev.target.closest('[data-npqa-add]');
  if (b) {
    var r = npqa.rows[+b.getAttribute('data-npqa-i')]; if (!r || !r.paths.length) return;
    upNextAdd(r.paths, b.getAttribute('data-npqa-add'), r.label);   // 82-up-next.js（トースト「元に戻す」付き。予約の札も変わる）
    _npqaCount();
    b.classList.add('is-done'); setTimeout(function () { b.classList.remove('is-done'); }, 1200);
    return;
  }
  var o = ev.target.closest('[data-npqa-album]');
  if (o) { npqa.album = o.getAttribute('data-npqa-album'); _npqaRender(); var bk = document.querySelector('#np-qa-body .np-qa-backbtn'); if (bk) { try { bk.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } } return; }
  if (ev.target.closest('[data-npqa-back]')) {
    var key = npqa.album; npqa.album = null; _npqaRender();
    var el = Array.prototype.find.call(document.querySelectorAll('#np-qa-body [data-npqa-album]'), function (x) { return x.getAttribute('data-npqa-album') === key; });
    if (el) { el.scrollIntoView({ block: 'center' }); try { el.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
}
// 曲リストの見出しの「＋追加」（描き直されても効くよう、document で受ける）
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('[data-npqa-open]');
  if (!b) return;
  ev.preventDefault(); ev.stopPropagation();
  if (npqa.open) npqaClose(); else npqaOpen();
});
// Esc：パネルを先に閉じる（再生画面は閉じない）
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape' || !npqa.open) return;
  var dlg = document.getElementById('dialog-modal'); if (dlg && !dlg.hidden) return;   // ダイアログを先に閉じる
  ev.preventDefault(); ev.stopImmediatePropagation();
  npqaClose();
}, true);

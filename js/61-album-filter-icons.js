/* =========================================================
   61-album-filter-icons.js ― スマホ版：アルバムのフィルターバーをアイコンにしてヘッダーへ（スマホ版 v8.7.2）
   ・スマホ幅（760px 以下）では、album の「アルバムのフィルターバー」（#alb-filter-bar：検索欄・並べ替えボタン・一括編集ボタン・
     タグの絞り込み・ジャンルの絞り込み・グループの切り替え・Pin のみボタン・非表示のアルバム）を隠し、
     「アルバムのヘッダー」の2行目（読み直すボタンの右）に「フィルターアイコン」（.alb-ficons）を並べる：
       検索（虫眼鏡。押すとヘッダーの中に検索欄が開く）／並べ替え／タグ／ジャンル（ジャンルがあるときだけ）／グループ／その他（…）
     「その他」には Pin のみ・非表示のアルバム・一覧で編集・絞り込みを全部解除
   ・タグ・ジャンル・グループ・その他を押すと、画面の下から「絞り込みシート」（#alb-fsheet）が開き、選ぶとすぐ反映して閉じる
   ・今までの部品（フィルターバーの select・ボタン）は隠したまま残し、そこへ値を入れて change / input / click を起こすので、
     絞り込み・並べ替え・保存（ui・db.settings）の仕組みは今までと同じ
   ・絞り込み中（すべて・なし・標準 以外）の項目は、アイコンの右上に点（.has-dot）。Pin のみ・非表示のアルバムがオンのときは「その他」に点
   ・アイコンの名前：aria-label・title。長押し（0.5秒）でアイコンの下に名前（.alb-ficon-tip）を出す
   ・アルバムの曲一覧を開いている間（フィルターバーが隠れている間）はアイコンも出さない
   ========================================================= */

var af = { tipTimer: 0, lpTimer: 0, lpAt: 0 };
var AF_ICON_GENRE = _svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M9 9l11-2"/>');
var AF_ICON_GROUP = _svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');
var AF_ICON_MORE = _svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>');
// フィルターアイコンの順と名前
var AF_ITEMS = [
  { f: 'search', name: '検索', icon: function () { return ICONS.search; } },
  { f: 'sort', name: '並べ替え', icon: function () { return ICONS.sortLines; } },
  { f: 'tag', name: 'タグで絞り込む', icon: function () { return ICONS.tag; } },
  { f: 'genre', name: 'ジャンルで絞り込む', icon: function () { return AF_ICON_GENRE; } },
  { f: 'group', name: 'グループ表示', icon: function () { return AF_ICON_GROUP; } },
  { f: 'more', name: 'その他（Pin のみ・非表示のアルバム・一覧で編集・全部解除）', icon: function () { return AF_ICON_MORE; } }
];

function _afEnsure() {
  var head = document.querySelector('#page-albums .page-header .header-actions');
  if (!head) return null;
  var row = head.querySelector('.alb-ficons');
  if (row) return row;
  row = document.createElement('div');
  row.className = 'alb-ficons';
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', 'フィルターアイコン');
  row.innerHTML = AF_ITEMS.map(function (it) {
    return '<button type="button" class="btn-ghost-small btn-ghost-icon alb-ficon" data-f="' + it.f + '" aria-label="' + it.name + '" title="' + it.name + '">' + it.icon() + '</button>';
  }).join('') +
    '<span class="alb-hsearch-wrap"><input type="search" id="alb-hsearch" class="alb-hsearch" placeholder="アルバム名・アーティスト" aria-label="アルバムを検索" autocomplete="off">' +
    '<button type="button" class="btn-ghost-small btn-ghost-icon alb-hsearch-close" aria-label="検索欄を閉じる" title="検索欄を閉じる">' + ICONS.x + '</button></span>' +
    '<span class="alb-ficon-tip" hidden></span>' +
    '<span class="ui-label-tag ui-label-tag-ondark" style="top:-8px;right:-6px" onclick="copyUiLabel(\'フィルターアイコン\', event)" title="クリックで「フィルターアイコン」をコピー">□</span>';
  head.appendChild(row);
  row.addEventListener('click', function (ev) {
    if (af.lpAt && Date.now() - af.lpAt < 700) { ev.preventDefault(); return; }   // 長押しで名前を出したあとのクリックは無視
    var b = ev.target.closest('.alb-ficon');
    if (b) { _afAct(b.getAttribute('data-f')); return; }
    if (ev.target.closest('.alb-hsearch-close')) _afSearch(false);
  });
  var hs = row.querySelector('#alb-hsearch');
  hs.addEventListener('input', function () {
    var s = document.getElementById('alb-search');
    if (!s) return;
    s.value = hs.value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  hs.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' || ev.key === 'Enter') { ev.preventDefault(); _afSearch(false); } });
  // 長押しで名前
  row.addEventListener('contextmenu', function (ev) { if (ev.target.closest('.alb-ficon')) ev.preventDefault(); });
  row.addEventListener('pointerdown', function (ev) {
    var b = ev.target.closest('.alb-ficon');
    if (!b || ev.pointerType !== 'touch') return;
    clearTimeout(af.lpTimer);
    af.lpTimer = setTimeout(function () { af.lpAt = Date.now(); _afTip(b); }, 500);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { row.addEventListener(n, function () { clearTimeout(af.lpTimer); }); });
  return row;
}
function _afTip(b) {
  var row = b.closest('.alb-ficons'), tip = row.querySelector('.alb-ficon-tip');
  tip.textContent = b.getAttribute('aria-label');
  tip.hidden = false;
  var rr = row.getBoundingClientRect(), br = b.getBoundingClientRect();
  tip.style.left = Math.max(0, Math.min(rr.width - 10, br.left - rr.left + br.width / 2)) + 'px';
  clearTimeout(af.tipTimer);
  af.tipTimer = setTimeout(function () { tip.hidden = true; }, 1600);
}

/* ---------- 押したとき ---------- */
function _afAct(f) {
  if (f === 'search') { _afSearch(true); return; }
  if (f === 'sort') { var sb = document.getElementById('alb-sort-btn'); if (sb) sb.click(); return; }
  if (f === 'tag') { _afSelectSheet('alb-tag-filter', 'タグで絞り込む'); return; }
  if (f === 'genre') { _afSelectSheet('alb-genre-filter', 'ジャンルで絞り込む'); return; }
  if (f === 'group') { _afSelectSheet('alb-group', 'グループ表示'); return; }
  if (f === 'more') _afMoreSheet();
}
function _afSearch(open) {
  var row = _afEnsure();
  if (!row) return;
  row.classList.toggle('is-search', open);
  var hs = row.querySelector('#alb-hsearch'), s = document.getElementById('alb-search');
  if (open) { hs.value = s ? s.value : ''; setTimeout(function () { try { hs.focus(); } catch (e) { /* 無視 */ } }, 0); }
  afSync();
}
// select の選択肢を絞り込みシートで選ぶ
function _afSelectSheet(selId, title) {
  var sel = document.getElementById(selId);
  if (!sel) return;
  var items = Array.from(sel.options).map(function (o) { return { v: o.value, label: o.textContent, cur: o.value === sel.value }; });
  _afSheet(title, items, function (v) {
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));   // 今までの onchange（setAlbumTagFilter など）が動く
  });
}
function _afMoreSheet() {
  var pin = document.getElementById('alb-pin-only'), hid = document.getElementById('alb-hidden-toggle'), items = [];
  if (pin && !pin.hidden) items.push({ v: 'pin', label: 'Pin のみ：' + (pin.classList.contains('active') ? 'オン（押すとふつうの一覧）' : 'オフ（押すと Pin したアルバムだけ）'), cur: pin.classList.contains('active'), disabled: pin.disabled, icon: ICONS.pin });
  if (hid && !hid.hidden) items.push({ v: 'hidden', label: '非表示のアルバム：' + (hid.classList.contains('active') ? 'オン（押すとふつうの一覧）' : 'オフ（押すと非表示にしたアルバムだけ）'), cur: hid.classList.contains('active'), icon: ICONS.eyeOff });
  items.push({ v: 'bulk', label: '一覧で編集（今の並び・絞り込みのアルバムを表で編集）', icon: ICONS.edit });
  items.push({ v: 'clear', label: '絞り込みを全部解除（検索・タグ・ジャンル・Pin のみ・非表示）', icon: ICONS.x, disabled: !_afAnyFilter() });
  _afSheet('その他', items, function (v) {
    if (v === 'pin') { if (pin) pin.click(); }
    else if (v === 'hidden') { if (hid) hid.click(); }
    else if (v === 'bulk') { var bb = document.getElementById('alb-bulk-btn'); if (bb) bb.click(); }
    else if (v === 'clear') afClearAll();
  });
}
// 絞り込みを全部解除（並べ替え・グループは絞り込みではないのでそのまま）
function afClearAll() {
  var s = document.getElementById('alb-search');
  if (s && s.value) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
  var hs = document.getElementById('alb-hsearch'); if (hs) hs.value = '';
  ['alb-tag-filter', 'alb-genre-filter'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && el.value) { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  var pin = document.getElementById('alb-pin-only'); if (pin && pin.classList.contains('active') && typeof togglePinOnly === 'function') togglePinOnly(false);
  if (albView.showHidden && typeof toggleHiddenAlbumsView === 'function') toggleHiddenAlbumsView(false);
  var row = document.querySelector('.alb-ficons'); if (row) row.classList.remove('is-search');
  afSync();
  showToast('絞り込みを全部解除しました');
}
function _afAnyFilter() {
  var s = document.getElementById('alb-search'), t = document.getElementById('alb-tag-filter'), g = document.getElementById('alb-genre-filter'), p = document.getElementById('alb-pin-only');
  return !!((s && s.value) || (t && t.value) || (g && g.value) || (p && p.classList.contains('active')) || albView.showHidden);
}

/* ---------- 絞り込みシート（画面の下から出る選択肢の一覧） ---------- */
function _afSheet(title, items, onPick) {
  var sh = document.getElementById('alb-fsheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'alb-fsheet'; sh.className = 'alb-fsheet'; sh.hidden = true;
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    document.body.appendChild(sh);
    sh.addEventListener('click', function (ev) {
      if (ev.target === sh || ev.target.closest('.afs-close')) { _afSheetClose(); return; }
      var it = ev.target.closest('.afs-item');
      if (!it || it.disabled) return;
      var fn = sh._onPick; _afSheetClose();
      if (fn) fn(it.getAttribute('data-v'));
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !sh.hidden) _afSheetClose(); });
  }
  sh._onPick = onPick;
  sh.setAttribute('aria-label', title);
  sh.innerHTML = '<div class="afs-panel">' +
    '<div class="afs-head"><span class="afs-title">' + escapeHtml(title) + '</span>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="position:static" onclick="copyUiLabel(\'絞り込みシート\', event)" title="クリックで「絞り込みシート」をコピー">□</span>' +
    '<button type="button" class="afs-close" aria-label="閉じる">' + ICONS.x + '</button></div>' +
    '<div class="afs-list">' + items.map(function (it) {
      return '<button type="button" class="afs-item' + (it.cur ? ' is-cur' : '') + '" data-v="' + escapeHtml(it.v) + '"' + (it.disabled ? ' disabled' : '') + '>' +
        '<span class="afs-check">' + (it.icon || (it.cur ? '✓' : '')) + '</span><span class="afs-label">' + escapeHtml(it.label) + '</span>' + (it.icon && it.cur ? '<span class="afs-on">✓</span>' : '') + '</button>';
    }).join('') + '</div></div>';
  sh.hidden = false;
  var cur = sh.querySelector('.afs-item.is-cur') || sh.querySelector('.afs-item');
  if (cur) try { cur.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
}
function _afSheetClose() { var sh = document.getElementById('alb-fsheet'); if (sh) { sh.hidden = true; sh._onPick = null; } }

/* ---------- 表示を合わせる（点・出す出さない） ---------- */
function afSync() {
  var row = _afEnsure();
  if (!row) return;
  var bar = document.getElementById('alb-filter-bar');
  row.hidden = !!(bar && bar.hidden);   // アルバムの曲一覧ではアイコンも出さない
  var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var gw = document.querySelector('#alb-genre-filter'), genreOn = gw && !gw.parentElement.hidden;
  var sortCustom = false;
  try { sortCustom = typeof albumSortSpec === 'function' && typeof _albumSortIsStandard === 'function' && !_albumSortIsStandard(albumSortSpec()); } catch (e) { /* 無視 */ }
  var pin = document.getElementById('alb-pin-only');
  var dots = {
    search: !!val('alb-search'), sort: sortCustom, tag: !!val('alb-tag-filter'), genre: !!val('alb-genre-filter'),
    group: (db.settings.albumGroup || 'none') !== 'none',
    more: !!((pin && pin.classList.contains('active')) || albView.showHidden)
  };
  row.querySelectorAll('.alb-ficon').forEach(function (b) {
    var f = b.getAttribute('data-f');
    b.classList.toggle('has-dot', !!dots[f]);
    if (f === 'genre') b.hidden = !genreOn;
    var base = (AF_ITEMS.find(function (x) { return x.f === f; }) || {}).name || '';
    var lbl = base + (dots[f] ? '（' + (f === 'search' ? '検索中：' + val('alb-search') : '指定中') + '）' : '');
    b.setAttribute('aria-label', lbl); b.title = lbl;
  });
}
// アルバムの画面を描くたびに合わせる
(function () {
  var f = window.renderAlbumsPage;
  if (typeof f !== 'function') return;
  window.renderAlbumsPage = function () { var r = f.apply(this, arguments); try { afSync(); } catch (e) { console.warn(e); } return r; };
})();
document.addEventListener('DOMContentLoaded', afSync);
if (document.readyState !== 'loading') afSync();

/* =========================================================
   29-album-sort.js ― アルバムの並べ替えの設定（v4.0）
   ・album のフィルターバーの「並べ替えボタン」（アイコン＋今の並びの短い表示）を押すと「並べ替えの設定ダイアログ」が開く
     （v3.9 までの「並べ替えの選択」＝標準／アルバム名／アーティスト／自分で並べる のボタン列は、これに置き換えた）
   ・ダイアログ：
       「項目で並べる」／「自分で並べる（カスタム順）」の切り替え（ラジオ）
       並べ替えの項目（アルバム名・アーティスト・発売年）をチェックで選ぶ（1つ以上）。チェックした項目は上から優先
       （1番目で並べ、同じなら2番目…）。「↑」「↓」で優先の順番を入れ替え。項目ごとに昇順／降順（発売年は古い順／新しい順）
       「標準（アルバム名→アーティスト）に戻す」、並びの例（先頭5件）、「適用」「キャンセル」
   ・保存：db.settings.albumSort = { mode:'fields'|'custom', fields:[{ key:'name'|'artist'|'year', dir:'asc'|'desc' }] }
     （バックアップに含む）。古い albumSortKey / albumSortDir は 01-core.js の normalizeDB() で新しい形に移す。
     古い版でも読めるように、albumSortKey / albumSortDir も近い値にそろえて書いておく
   ・文字の順番は今までどおり（14-albums.js の albumTextKey / compareAlbumText）。空欄・発売年の無いアルバムは向きに関係なく最後。
     全部同じなら標準の並び（アルバム名→アーティスト）
   ・Pin の区切りは今までどおり Pin した順（並べ替えの設定に関係しない）
   ========================================================= */

var ALBUM_SORT_FIELDS = {
  name:   { label: 'アルバム名', asc: '昇順（A→Z・あ→ん）', desc: '降順（Z→A・ん→あ）', short: 'アルバム名' },
  artist: { label: 'アーティスト', asc: '昇順（A→Z・あ→ん）', desc: '降順（Z→A・ん→あ）', short: 'アーティスト' },
  year:   { label: '発売年', asc: '古い順', desc: '新しい順', short: '発売年' },
  genre:  { label: 'ジャンル', asc: '昇順（A→Z・あ→ん）', desc: '降順（Z→A・ん→あ）', short: 'ジャンル' },   // v4.6
  tag:    { label: 'タグ', asc: 'tools の順', desc: '逆の順', short: 'タグ' },   // v4.4（31-album-tags.js）
  sortkey: { label: 'ソートキー', asc: '昇順（A→Z・あ→ん）', desc: '降順（Z→A・ん→あ）', short: 'ソートキー' }   // v4.3（30-album-sortkey.js）
};
var ALBUM_SORT_KEYS = ['name', 'artist', 'year', 'genre', 'sortkey', 'tag'];
function albumSortStandardSpec() { return { mode: 'fields', fields: [{ key: 'name', dir: 'asc' }, { key: 'artist', dir: 'asc' }] }; }

// 古い形（v3.9 まで：albumSortKey = standard / name / artist / custom、albumSortDir = asc / desc）から新しい形へ（同じ並びになる）
function albumSortSpecFromLegacy(key, dir) {
  var d = dir === 'desc' ? 'desc' : 'asc';
  if (key === 'name') return { mode: 'fields', fields: [{ key: 'name', dir: d }, { key: 'artist', dir: d }] };
  if (key === 'artist') return { mode: 'fields', fields: [{ key: 'artist', dir: d }, { key: 'name', dir: d }] };
  var s = albumSortStandardSpec();
  if (key === 'custom') s.mode = 'custom';
  return s;
}
// 形をそろえる（壊れた値・重複は捨てる。項目が1つも無ければ標準）
function normalizeAlbumSortSpec(v) {
  if (!v || typeof v !== 'object') return null;
  var seen = {}, fields = [];
  (Array.isArray(v.fields) ? v.fields : []).forEach(function (f) {
    if (!f || !ALBUM_SORT_FIELDS[f.key] || seen[f.key]) return;
    seen[f.key] = true;
    var o = { key: f.key, dir: f.dir === 'desc' ? 'desc' : 'asc' };
    if (f.key === 'sortkey') o.missing = f.missing === 'last' ? 'last' : 'name';   // ソートキーが無いアルバム：アルバム名を使う（初期値）／最後に回す
    fields.push(o);
  });
  if (!fields.length) fields = albumSortStandardSpec().fields;
  return { mode: v.mode === 'custom' ? 'custom' : 'fields', fields: fields };
}
function albumSortSpec() {
  var s = normalizeAlbumSortSpec(db.settings.albumSort);
  if (!s) { s = albumSortSpecFromLegacy(db.settings.albumSortKey, db.settings.albumSortDir); db.settings.albumSort = s; }
  return s;
}
// 設定を保存する（古い版のために albumSortKey / albumSortDir も近い値にそろえる）
function setAlbumSortSpec(spec) {
  var s = normalizeAlbumSortSpec(spec);
  db.settings.albumSort = s;
  var f = s.fields;
  if (s.mode === 'custom') { db.settings.albumSortKey = 'custom'; db.settings.albumSortDir = 'asc'; }
  else if (f.length === 2 && f[0].key === 'name' && f[1].key === 'artist' && f[0].dir === 'asc' && f[1].dir === 'asc') { db.settings.albumSortKey = 'standard'; db.settings.albumSortDir = 'asc'; }
  else if (f[0].key === 'name' || f[0].key === 'artist') { db.settings.albumSortKey = f[0].key; db.settings.albumSortDir = f[0].dir; }
  else { db.settings.albumSortKey = 'standard'; db.settings.albumSortDir = 'asc'; }
  saveDB();
}
function _albumSortIsStandard(s) {
  var f = s.fields;
  return s.mode === 'fields' && f.length === 2 && f[0].key === 'name' && f[0].dir === 'asc' && f[1].key === 'artist' && f[1].dir === 'asc';
}

// 項目で並べる比べ方（_prepareAlbumSortKeys のあとで使う。a.yearFirst は発売年の最初の年、無ければ 0）
function _cmpAlbumField(f, a, b) {
  var dir = f.dir === 'desc' ? -1 : 1;
  if (f.key === 'year') {
    var ya = a.yearFirst || 0, yb = b.yearFirst || 0;
    if (!ya !== !yb) return ya ? -1 : 1;   // 発売年の無いアルバムは向きに関係なく最後
    return (ya - yb) * dir;
  }
  if (f.key === 'genre') {   // ジャンル（v4.6）：ジャンルが無いアルバムは向きに関係なく最後
    var ga = a._skGenre, gb = b._skGenre;
    if (ga.empty !== gb.empty) return ga.empty ? 1 : -1;
    return compareAlbumText(ga, gb) * dir;
  }
  if (f.key === 'tag') {   // タグ（v4.4）：tools の順。タグが無いアルバムは向きに関係なく最後
    var ta = a._tagOrd, tb = b._tagOrd;
    if ((ta < 0) !== (tb < 0)) return ta < 0 ? 1 : -1;
    return (ta - tb) * dir;
  }
  if (f.key === 'sortkey') {   // ソートキー（v4.3）：無いアルバムはアルバム名で（または最後に）。数字は自然な順
    var sa = a._skSort, sb = b._skSort;
    if (f.missing === 'last') { if (sa.empty !== sb.empty) return sa.empty ? 1 : -1; }
    else { if (sa.empty) sa = a._skName; if (sb.empty) sb = b._skName; }
    if (sa.empty !== sb.empty) return sa.empty ? 1 : -1;
    return compareSortKeyText(sa, sb) * dir;
  }
  var x = f.key === 'name' ? a._skName : a._skArtist, y = f.key === 'name' ? b._skName : b._skArtist;
  if (x.empty !== y.empty) return x.empty ? 1 : -1;     // 空欄は向きに関係なく最後
  return compareAlbumText(x, y) * dir;
}
function albumComparatorFor(fields) {
  return function (a, b) {
    for (var i = 0; i < fields.length; i++) { var r = _cmpAlbumField(fields[i], a, b); if (r) return r; }
    return compareAlbumsStandard(a, b);   // 全部同じなら標準の並び
  };
}

/* ---------- 並べ替えボタン ---------- */
function albumSortSummary(s) {
  if (s.mode === 'custom') return '自分で並べる';
  if (_albumSortIsStandard(s)) return '標準';
  return s.fields.map(function (f) {
    var d = ALBUM_SORT_FIELDS[f.key];
    return d.short + (f.key === 'year' ? (f.dir === 'desc' ? '（新しい順）' : '（古い順）') : (f.dir === 'desc' ? '（降順）' : ''));
  }).join('→');
}
// ボタンに出す短い表示（v6.3）：最初の1項目だけ。2項目以上あれば「…」を付ける（全部の並びは title・aria-label）
function albumSortShort(s) {
  if (s.mode === 'custom' || _albumSortIsStandard(s) || !s.fields.length) return albumSortSummary(s);
  var f = s.fields[0], d = ALBUM_SORT_FIELDS[f.key];
  return d.short + (f.key === 'year' ? (f.dir === 'desc' ? '（新しい順）' : '（古い順）') : (f.dir === 'desc' ? '（降順）' : '')) + (s.fields.length > 1 ? '…' : '');
}
// 並べ替えボタンの中身・title・aria-label（album と Western music の並べ替えボタンで共通。v6.3）
function fillAlbumSortButton(b, extra) {
  if (!b) return;
  var s = albumSortSpec(), sum = albumSortSummary(s);
  b.innerHTML = ICONS.sortLines + '<span class="album-sort-label">並べ替え：</span><span class="album-sort-sum">' + escapeHtml(albumSortShort(s)) + '</span>';
  b.title = '並べ替えの設定を開く' + (extra || '') + '（今の並び：' + (s.mode === 'custom' ? '自分で並べる（カスタム順）' : s.fields.map(function (f) { return ALBUM_SORT_FIELDS[f.key].label + ' ' + ALBUM_SORT_FIELDS[f.key][f.dir]; }).join(' → ')) + '）';
  b.setAttribute('aria-label', '並べ替え：' + sum);
  b.classList.toggle('is-custom', s.mode === 'custom');
}
function renderAlbumSortButton() {
  fillAlbumSortButton(document.getElementById('alb-sort-btn'));
}

/* ---------- 並べ替えの設定ダイアログ ---------- */
async function openAlbumSortDialog() {
  var cur = albumSortSpec();
  // 下書き：rows＝3項目すべて（チェックしたものが上、その順が優先）
  var draft = { mode: cur.mode, rows: [] };
  cur.fields.forEach(function (f) { draft.rows.push({ key: f.key, dir: f.dir, on: true, missing: f.missing || 'name' }); });
  ALBUM_SORT_KEYS.forEach(function (k) { if (!draft.rows.some(function (r) { return r.key === k; })) draft.rows.push({ key: k, dir: k === 'year' ? 'desc' : 'asc', on: false, missing: 'name' }); });
  // 並びの例に使うアルバム（非表示を除く。Pin も含めた全体）
  var sample = [];
  if (library.tracks.length) {
    var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
    sample = buildAlbums().filter(function (a) { return !hs.has(a.key); });
    _prepareAlbumSortKeys(sample);
  }
  var body = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'並べ替えの設定ダイアログ\', event)" title="クリックで「並べ替えの設定ダイアログ」をコピー">□</span>' +
    '<div class="asort-modes" role="radiogroup" aria-label="並べ方">' +
      '<label class="asort-mode"><input type="radio" name="asort-mode" value="fields">項目で並べる</label>' +
      '<label class="asort-mode"><input type="radio" name="asort-mode" value="custom">自分で並べる（カスタム順）</label>' +
    '</div>' +
    '<div id="asort-fields-wrap">' +
      '<p class="dialog-hint">チェックした項目で並べます。上の項目が先（1番目で並べ、同じなら2番目…）。「↑」「↓」で順番を変えられます。</p>' +
      '<ol class="asort-list" id="asort-list"></ol>' +
      '<div class="btn-row"><button type="button" class="btn-inline-small" id="asort-standard">' + ICONS.undo + '標準（アルバム名→アーティスト）に戻す</button></div>' +
    '</div>' +
    '<p class="dialog-hint" id="asort-custom-hint" hidden>アルバムカードをドラッグするか「← 前へ」「後ろへ →」で、自分で並べます（カスタム順の編集モード）。並びは自動で保存されます。</p>' +
    '<div class="asort-preview-wrap"><div class="asort-preview-title">並びの例（先頭5件）</div><ol class="asort-preview" id="asort-preview"></ol></div>' +
    '<div class="dialog-error" id="asort-error"></div>';
  var draw = function (b) {
    b.querySelector('input[name="asort-mode"][value="' + draft.mode + '"]').checked = true;
    var custom = draft.mode === 'custom';
    b.querySelector('#asort-fields-wrap').hidden = custom;
    b.querySelector('#asort-custom-hint').hidden = !custom;
    var n = 0;
    b.querySelector('#asort-list').innerHTML = draft.rows.map(function (r, i) {
      var d = ALBUM_SORT_FIELDS[r.key];
      if (r.on) n++;
      return '<li class="asort-row' + (r.on ? ' is-on' : '') + '" data-i="' + i + '">' +
        '<span class="asort-no">' + (r.on ? n : '') + '</span>' +
        '<label class="asort-check"><input type="checkbox" data-asort-on="' + i + '"' + (r.on ? ' checked' : '') + '>' + d.label + '</label>' +
        '<span class="asort-dir" role="group" aria-label="' + d.label + 'の向き">' +
          '<button type="button" class="asort-dir-btn' + (r.dir === 'asc' ? ' active' : '') + '" data-asort-dir="asc" data-i="' + i + '" aria-pressed="' + (r.dir === 'asc') + '"' + (r.on ? '' : ' disabled') + '>' + d.asc + '</button>' +
          '<button type="button" class="asort-dir-btn' + (r.dir === 'desc' ? ' active' : '') + '" data-asort-dir="desc" data-i="' + i + '" aria-pressed="' + (r.dir === 'desc') + '"' + (r.on ? '' : ' disabled') + '>' + d.desc + '</button>' +
        '</span>' +
        '<span class="asort-move">' +
          '<button type="button" class="btn-inline-small" data-asort-move="-1" data-i="' + i + '" title="優先を上げる" aria-label="' + d.label + 'の優先を上げる"' + (r.on && i > 0 ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="btn-inline-small" data-asort-move="1" data-i="' + i + '" title="優先を下げる" aria-label="' + d.label + 'の優先を下げる"' + (r.on && i < draft.rows.length - 1 && draft.rows[i + 1].on ? '' : ' disabled') + '>↓</button>' +
        '</span>' +
        // ソートキーが無いアルバムの扱い（v4.3）
        (r.key === 'sortkey' ? '<span class="asort-missing" role="group" aria-label="ソートキーが無いアルバム"><span class="asort-missing-cap">無いアルバム：</span>' +
          '<button type="button" class="asort-dir-btn' + (r.missing !== 'last' ? ' active' : '') + '" data-asort-missing="name" data-i="' + i + '" aria-pressed="' + (r.missing !== 'last') + '"' + (r.on ? '' : ' disabled') + '>アルバム名を使う</button>' +
          '<button type="button" class="asort-dir-btn' + (r.missing === 'last' ? ' active' : '') + '" data-asort-missing="last" data-i="' + i + '" aria-pressed="' + (r.missing === 'last') + '"' + (r.on ? '' : ' disabled') + '>最後に回す</button></span>' : '') +
        '</li>';
    }).join('');
    b.querySelector('#asort-error').textContent = !custom && !n ? '並べ替えの項目を1つ以上選んでください。' : '';
    // 並びの例
    var pv = b.querySelector('#asort-preview');
    if (!sample.length) { pv.innerHTML = '<li class="asort-pv-empty">（アルバムがありません）</li>'; return; }
    var list;
    if (custom) list = _applyCustomOrder(sample.slice().sort(compareAlbumsStandard));
    else list = sample.slice().sort(albumComparatorFor(draft.rows.filter(function (r) { return r.on; })));
    pv.innerHTML = list.slice(0, 5).map(function (a) {
      return '<li><span class="asort-pv-name">' + escapeHtml(a.name) + '</span><span class="asort-pv-sub">' + escapeHtml(a.artist || '（アーティスト無し）') + (a.genre ? ' ・ ' + escapeHtml(a.genre) : '') + (a.year ? ' ・ ' + escapeHtml(a.year) : '') + (a.sortKey ? ' ・ キー「' + escapeHtml(a.sortKey) + '」' : '') + (a.tagName ? ' ・ タグ「' + escapeHtml(a.tagName) + '」' : '') + '</span></li>';
    }).join('');
  };
  var v = await openDialog({
    title: '並べ替えの設定', body: body, size: 'small',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '適用', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (b) {
      draw(b);
      b.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t.name === 'asort-mode') { draft.mode = t.value; draw(b); return; }
        var on = t.getAttribute && t.getAttribute('data-asort-on');
        if (on !== null && on !== undefined) {
          var r = draft.rows.splice(+on, 1)[0];
          r.on = t.checked;
          // チェックしたら、チェック済みの最後へ。外したら、チェックしていない先頭へ
          var pos = draft.rows.filter(function (x) { return x.on; }).length;
          draft.rows.splice(pos, 0, r);
          draw(b);
          var cb = b.querySelector('[data-asort-on="' + draft.rows.indexOf(r) + '"]'); if (cb) cb.focus();
        }
      });
      b.addEventListener('click', function (ev) {
        var ms = ev.target.closest('[data-asort-missing]');   // ソートキーが無いアルバムの扱い（v4.3）
        if (ms) { var mi2 = +ms.getAttribute('data-i'); draft.rows[mi2].missing = ms.getAttribute('data-asort-missing'); draw(b); var nm = b.querySelector('[data-asort-missing="' + ms.getAttribute('data-asort-missing') + '"][data-i="' + mi2 + '"]'); if (nm) nm.focus(); return; }
        var d = ev.target.closest('[data-asort-dir]');
        if (d) { draft.rows[+d.getAttribute('data-i')].dir = d.getAttribute('data-asort-dir'); var k = +d.getAttribute('data-i'); draw(b); var nb = b.querySelector('[data-asort-dir="' + d.getAttribute('data-asort-dir') + '"][data-i="' + k + '"]'); if (nb) nb.focus(); return; }
        var m = ev.target.closest('[data-asort-move]');
        if (m) {
          var i = +m.getAttribute('data-i'), j = i + (+m.getAttribute('data-asort-move'));
          if (j < 0 || j >= draft.rows.length || !draft.rows[j].on) return;
          var x = draft.rows[i]; draft.rows[i] = draft.rows[j]; draft.rows[j] = x;
          draw(b);
          var mb = b.querySelector('[data-asort-move="' + m.getAttribute('data-asort-move') + '"][data-i="' + j + '"]');
          if (mb && !mb.disabled) mb.focus(); else { var alt = b.querySelector('[data-asort-on="' + j + '"]'); if (alt) alt.focus(); }
          return;
        }
        if (ev.target.closest('#asort-standard')) {
          draft.mode = 'fields';
          draft.rows = [{ key: 'name', dir: 'asc', on: true }, { key: 'artist', dir: 'asc', on: true }, { key: 'year', dir: 'desc', on: false }, { key: 'genre', dir: 'asc', on: false }, { key: 'sortkey', dir: 'asc', on: false, missing: 'name' }, { key: 'tag', dir: 'asc', on: false }];
          draw(b);
        }
      });
    },
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      if (draft.mode === 'fields' && !draft.rows.some(function (r) { return r.on; })) { b.querySelector('#asort-error').textContent = '並べ替えの項目を1つ以上選んでください。'; return false; }
      return true;
    }
  });
  if (v !== 'ok') return;
  setAlbumSortSpec({ mode: draft.mode, fields: draft.rows.filter(function (r) { return r.on; }).map(function (r) { return { key: r.key, dir: r.dir, missing: r.missing }; }) });
  albView.limit = ALB_PAGE_SIZE;
  if (currentPage === 'western' && typeof renderWesternPage === 'function') { westernView.limit = WES_PAGE_SIZE; renderWesternPage(); }   // Western music からも同じ設定（v5.0）
  else renderAlbumsPage();
  window.scrollTo(0, 0);   // 並べ替えを変えたら先頭から（v2.4）
}

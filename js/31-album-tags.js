/* =========================================================
   31-album-tags.js ― アルバムのタグ（v4.4）
   ・タグ＝アルバムの種類分けのラベル（初期は single / album / BEST / MINI）。1枚のアルバムに付けられるタグは1つ
     （並べ替えに使うので、どのタグで並べるか迷わないように）
   ・保存（バックアップ・復元に含む。ファイルは触らない）：
       db.albumTags  = [{ id, name, color }]（並び＝tools の順＝並べ替えの順）
       db.albumTagOf = { アルバムの目印（albumKeyOf）: タグの id }
     古いデータ・バックアップは、初期のタグ一覧・付与なしとして読む（01-core.js の normalizeDB()）
     目印が変わったとき（migrateAlbumKeys()・曲情報の編集 _renameAlbumKeysAfter()）は renameAlbumTagKeys() で付け替える
     タグを削除したら、そのタグを付けていたアルバムからも外す
   ・付け方：アルバム情報の編集ダイアログの「タグ」欄、アルバムカードの「ソートキー・タグボタン」→「ソートキー・タグの入力」（30-album-sortkey.js）
   ・表示：カードのアルバム名の下と、アルバムの見出しの曲数の行に、色付きの小さな「タグのバッジ」
   ・並べ替え：並べ替えの設定の項目「タグ」（tools の順。タグが無いアルバムは向きに関係なく最後）
   ・絞り込み：アルバムのフィルターバーの「タグの絞り込み」（すべて／各タグ／タグなし。この PC の見た目の設定 ui.albumTagFilter）。検索でもタグ名で見つかる
   ========================================================= */

// 色（白い文字が読める濃さ。ライト・ブラックどちらの面の上でも見分けやすいもの）
var ALBUM_TAG_COLORS = [
  ['blue', '青', '#3f5fc8'], ['green', '緑', '#2b7a4b'], ['red', '赤', '#b23a3a'], ['orange', 'オレンジ', '#b5541d'],
  ['purple', '紫', '#7445b8'], ['teal', '青緑', '#12727a'], ['olive', '黄土', '#7a6317'], ['gray', '灰', '#5b6470']
];
function albumTagDefaults() {
  return [{ id: 'single', name: 'single', color: 'blue' }, { id: 'album', name: 'album', color: 'green' },
          { id: 'best', name: 'BEST', color: 'orange' }, { id: 'mini', name: 'MINI', color: 'purple' },
          { id: 'western', name: '洋楽', color: 'teal' }];   // v5.2：Western music のタグで判定に使う
}
function albumTagColorHex(c) {
  for (var i = 0; i < ALBUM_TAG_COLORS.length; i++) if (ALBUM_TAG_COLORS[i][0] === c) return ALBUM_TAG_COLORS[i][2];
  return ALBUM_TAG_COLORS[7][2];
}
// normalizeDB 用：タグ一覧と付与の形をそろえる（tags が配列でなければ＝古いデータ：初期のタグ一覧）。付与は、ある タグの id だけ残す
function normalizeAlbumTags(tags, tagOf) {
  var out = [], seen = {}, seenName = {};
  var okColor = function (c) { return ALBUM_TAG_COLORS.some(function (x) { return x[0] === c; }) ? c : 'gray'; };
  if (Array.isArray(tags)) {
    tags.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || !t.id || seen[t.id]) return;
      var name = String(t.name || '').trim().slice(0, 30);
      if (!name || seenName[name.toLowerCase()]) return;
      seen[t.id] = true; seenName[name.toLowerCase()] = true;
      out.push({ id: t.id, name: name, color: okColor(t.color) });
    });
  } else {
    out = albumTagDefaults();
    out.forEach(function (t) { seen[t.id] = true; });
  }
  var of = {};
  if (tagOf && typeof tagOf === 'object') Object.keys(tagOf).forEach(function (k) { if (k && typeof tagOf[k] === 'string' && seen[tagOf[k]]) of[k] = tagOf[k]; });
  return { tags: out, tagOf: of };
}

/* ---------- 読む・付ける ---------- */
var _albumTagIdx = { src: null, len: -1, map: null };
function _tagIndexMap() {
  var list = db.albumTags || [];
  if (_albumTagIdx.src !== list || _albumTagIdx.len !== list.length) {
    var m = new Map(); list.forEach(function (t, i) { m.set(t.id, i); });
    _albumTagIdx = { src: list, len: list.length, map: m };
  }
  return _albumTagIdx.map;
}
function albumTagById(id) { var i = _tagIndexMap().get(id); return i === undefined ? null : db.albumTags[i]; }
function albumTagOf(key) { var id = (db.albumTagOf || {})[key]; return id ? albumTagById(id) : null; }
// 並べ替え用の順番（tools の順。無ければ -1）
function albumTagOrder(key) { var id = (db.albumTagOf || {})[key]; if (!id) return -1; var i = _tagIndexMap().get(id); return i === undefined ? -1 : i; }
// 付ける（id が空なら外す）。変わったら true
function setAlbumTag(key, id) {
  if (!key) return false;
  if (!db.albumTagOf || typeof db.albumTagOf !== 'object') db.albumTagOf = {};
  var cur = db.albumTagOf[key] || '';
  if (id && !albumTagById(id)) id = '';
  if (cur === (id || '')) return false;
  if (id) db.albumTagOf[key] = id; else delete db.albumTagOf[key];
  saveDB();
  return true;
}
function renameAlbumTagKeys(map) {
  var m = db.albumTagOf;
  if (!m) return false;
  var changed = false;
  Object.keys(map).forEach(function (oldKey) {
    var nk = map[oldKey];
    if (!nk || nk === oldKey || !m[oldKey]) return;
    if (!m[nk]) m[nk] = m[oldKey];
    delete m[oldKey];
    changed = true;
  });
  return changed;
}
function countAlbumsWithTag(id) {
  var n = 0, m = db.albumTagOf || {};
  Object.keys(m).forEach(function (k) { if (m[k] === id) n++; });
  return n;
}

/* ---------- 表示 ---------- */
// タグのバッジ（色付き）
function albumTagBadgeHtml(key, cls) {
  var t = albumTagOf(key);
  return t ? '<span class="album-tag-badge' + (cls ? ' ' + cls : '') + '" style="--tag-c:' + albumTagColorHex(t.color) + '" title="タグ：' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</span>' : '';
}
// ソートキー・タグの入力の中のタグの選択（ボタンの列。なし＋各タグ）
function albumTagChoiceHtml(curId, name) {
  var h = '<div class="tag-choices" role="radiogroup" aria-label="タグ">' +
    '<label class="tag-choice"><input type="radio" name="' + name + '" value=""' + (!curId ? ' checked' : '') + '><span class="tag-choice-none">なし</span></label>';
  (db.albumTags || []).forEach(function (t) {
    h += '<label class="tag-choice"><input type="radio" name="' + name + '" value="' + escapeHtml(t.id) + '"' + (curId === t.id ? ' checked' : '') + '>' +
      '<span class="album-tag-badge" style="--tag-c:' + albumTagColorHex(t.color) + '">' + escapeHtml(t.name) + '</span></label>';
  });
  return h + '</div>';
}

/* ---------- タグの絞り込み（フィルターバー） ---------- */
// ui.albumTagFilter：'' すべて／タグの id／'__none' タグなし
function albumTagFilter() {
  var f = ui.albumTagFilter || '';
  if (f && f !== '__none' && !albumTagById(f)) f = '';
  return f;
}
function albumMatchesTagFilter(a, f) {
  if (!f) return true;
  var id = (db.albumTagOf || {})[a.key];
  if (id && !albumTagById(id)) id = '';
  return f === '__none' ? !id : id === f;
}
function renderAlbumTagFilter() {
  var sel = document.getElementById('alb-tag-filter');
  if (!sel) return;
  var f = albumTagFilter(), tags = db.albumTags || [];
  sel.parentElement.hidden = !tags.length;
  sel.innerHTML = '<option value="">タグ：すべて</option>' + tags.map(function (t) {
    return '<option value="' + escapeHtml(t.id) + '"' + (f === t.id ? ' selected' : '') + '>タグ：' + escapeHtml(t.name) + '</option>';
  }).join('') + '<option value="__none"' + (f === '__none' ? ' selected' : '') + '>タグなし</option>';
  sel.value = f;
  sel.classList.toggle('active', !!f);
}
function setAlbumTagFilter(v) {
  ui.albumTagFilter = v || ''; saveUi();
  albView.limit = ALB_PAGE_SIZE;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}

/* ---------- tools の「タグの設定」 ---------- */
function renderSetAlbumTags() {
  var el = document.getElementById('set-album-tags');
  if (!el) return;
  var tags = db.albumTags || [];
  var h = '<p class="panel-meta">' + tags.length + '個（上から順に、並べ替えの「タグ」の順番になります）</p>';
  if (tags.length) {
    h += '<ul class="hidden-album-list tag-set-list">';
    tags.forEach(function (t, i) {
      var n = countAlbumsWithTag(t.id);
      h += '<li><span class="pinned-album-no">' + (i + 1) + '</span>' +
        '<span class="album-tag-badge" style="--tag-c:' + albumTagColorHex(t.color) + '">' + escapeHtml(t.name) + '</span>' +
        '<input type="text" class="form-input tag-set-name" data-tag-name="' + i + '" value="' + escapeHtml(t.name) + '" maxlength="30" aria-label="タグ「' + escapeHtml(t.name) + '」の名前">' +
        '<select class="form-input tag-set-color" data-tag-color="' + i + '" aria-label="タグ「' + escapeHtml(t.name) + '」の色">' +
          ALBUM_TAG_COLORS.map(function (c) { return '<option value="' + c[0] + '"' + (t.color === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select>' +
        '<span class="hidden-album-sub">' + n + '枚</span>' +
        '<span class="pinned-album-btns">' +
          '<button class="btn-inline-small" data-tag-move="-1" data-i="' + i + '" title="1つ上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn-inline-small" data-tag-move="1" data-i="' + i + '" title="1つ下へ"' + (i === tags.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn-inline-small" data-tag-del="' + i + '">削除</button></span></li>';
    });
    h += '</ul>';
  } else h += '<p class="panel-meta">タグはありません。</p>';
  h += '<div class="btn-row tag-set-add"><input type="text" class="form-input" id="tag-set-new" maxlength="30" placeholder="新しいタグの名前（例：LIVE）" aria-label="新しいタグの名前">' +
    '<button class="btn-inline-small" id="tag-set-add-btn">' + ICONS.plus + '追加</button>' +
    '<button class="btn-inline-small" id="tag-set-reset">初期のタグを足す</button></div>' +
    '<div class="dialog-error" id="tag-set-error"></div>';
  el.innerHTML = h;
  var err = el.querySelector('#tag-set-error');
  var nameTaken = function (name, exceptId) { return (db.albumTags || []).some(function (t) { return t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase(); }); };
  el.querySelectorAll('[data-tag-name]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var t = tags[+inp.getAttribute('data-tag-name')], v = inp.value.trim().slice(0, 30);
      if (!v) { err.textContent = 'タグの名前を入れてください。'; inp.value = t.name; return; }
      if (nameTaken(v, t.id)) { err.textContent = '「' + v + '」は、もうあります。'; inp.value = t.name; return; }
      t.name = v; saveDB(); renderSetAlbumTags(); showToast('タグの名前を「' + v + '」にしました。');
    });
  });
  el.querySelectorAll('[data-tag-color]').forEach(function (s) {
    s.addEventListener('change', function () { tags[+s.getAttribute('data-tag-color')].color = s.value; saveDB(); renderSetAlbumTags(); });
  });
  el.querySelectorAll('[data-tag-move]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = +b.getAttribute('data-i'), j = i + (+b.getAttribute('data-tag-move'));
      if (j < 0 || j >= tags.length) return;
      var list = tags.slice(), x = list[i]; list[i] = list[j]; list[j] = x; db.albumTags = list; saveDB(); renderSetAlbumTags();
      var nb = document.querySelector('#set-album-tags [data-tag-move="' + b.getAttribute('data-tag-move') + '"][data-i="' + j + '"]'); if (nb && !nb.disabled) nb.focus();
    });
  });
  el.querySelectorAll('[data-tag-del]').forEach(function (b) {
    b.addEventListener('click', async function () {
      var t = tags[+b.getAttribute('data-tag-del')], n = countAlbumsWithTag(t.id);
      var ok = await showConfirm({ title: 'タグを削除', message: 'タグ「' + escapeHtml(t.name) + '」を削除します。' + (n ? 'このタグを付けている <strong>' + n + '枚</strong> のアルバムからも外れます。' : '使っているアルバムはありません。') + '（ファイルは変わりません）', okText: '削除', danger: true });
      if (!ok) return;
      deleteAlbumTag(t.id);
      showToast('タグ「' + t.name + '」を削除しました。');
    });
  });
  var add = function () {
    var inp = el.querySelector('#tag-set-new'), v = inp.value.trim().slice(0, 30);
    if (!v) { err.textContent = 'タグの名前を入れてください。'; return; }
    if (nameTaken(v, '')) { err.textContent = '「' + v + '」は、もうあります。'; return; }
    var used = (db.albumTags || []).map(function (t) { return t.color; });
    var color = (ALBUM_TAG_COLORS.filter(function (c) { return used.indexOf(c[0]) < 0; })[0] || ALBUM_TAG_COLORS[7])[0];
    db.albumTags = (db.albumTags || []).concat([{ id: 't' + Date.now().toString(36), name: v, color: color }]);
    saveDB(); renderSetAlbumTags(); showToast('タグ「' + v + '」を追加しました。');
    var ni = document.getElementById('tag-set-new'); if (ni) ni.focus();
  };
  el.querySelector('#tag-set-add-btn').addEventListener('click', add);
  el.querySelector('#tag-set-new').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  el.querySelector('#tag-set-reset').addEventListener('click', function () {
    var added = 0;
    albumTagDefaults().forEach(function (d) { if (!albumTagById(d.id) && !nameTaken(d.name, '')) { db.albumTags = (db.albumTags || []).concat([d]); added++; } });
    if (added) { saveDB(); renderSetAlbumTags(); }
    showToast(added ? '初期のタグを ' + added + '個足しました。' : '初期のタグは、もう全部あります。');
  });
}
function deleteAlbumTag(id) {
  db.albumTags = (db.albumTags || []).filter(function (t) { return t.id !== id; });
  var m = db.albumTagOf || {};
  Object.keys(m).forEach(function (k) { if (m[k] === id) delete m[k]; });
  if (ui.albumTagFilter === id) { ui.albumTagFilter = ''; saveUi(); }
  saveDB();
  if (currentPage === 'settings') renderSetAlbumTags();
}

// 起動したとき：01-core.js の normalizeDB() はこのファイルより先に動くので、ここで形をそろえる（古いデータは初期のタグ一覧）
(function () {
  var r = normalizeAlbumTags(db.albumTags, db.albumTagOf);
  db.albumTags = r.tags; db.albumTagOf = r.tagOf;
})();

/* =========================================================
   30-album-sortkey.js ― アルバムのソートキー（v4.3）
   ・ソートキー＝利用者が自由に入れる、並べ替え用の文字（例「Beatles 1967」「さ 001」）。アプリの中だけの設定で、曲ファイルには書かない
   ・保存：db.albumSortKeys = { アルバムの目印（albumKeyOf）: 'ソートキー' }（バックアップ・復元に含む。古いデータは空）
     目印が変わったとき（まとめ方の変更 migrateAlbumKeys()・曲情報の編集 _renameAlbumKeysAfter()）は renameAlbumSortKeys() で付け替える
   ・入れ方：
       アルバムカードの「ソートキーボタン」（左下。タグのアイコン。見せ方はカードのほかのボタンと同じ v3.5 の決まり）
         → 「ソートキーの入力」（カードの近くに出る小さな入力欄。Enter で保存、Esc・外を押すと取消。空にして保存すると解除）
       アルバム情報の編集ダイアログの「ソートキー」欄
   ・入っていれば、カードのアルバム名の下に小さく表示（タグのアイコン＋文字）
   ・並べ替え：並べ替えの設定ダイアログ（29-album-sort.js）の項目「ソートキー」。ソートキーが無いアルバムは
     「アルバム名を代わりに使う」（初期値）か「最後に回す」を選べる。文字の順番は今までどおりで、数字は自然な順（2 < 10）
   ・検索：ソートキーでも見つかる（14-albums.js の getAlbumList()）
   ・ファイルのタグ（TSOA／soal／ALBUMSORT）は、今回は読みも書きもしない
   ========================================================= */

var ALBUM_SORTKEY_MAX = 100;

function getAlbumSortKey(key) {
  var m = db.albumSortKeys;
  return (m && typeof m[key] === 'string') ? m[key] : '';
}
// 保存（空なら解除）。変わったら true
function setAlbumSortKey(key, text) {
  if (!key) return false;
  var v = String(text || '').replace(/\s+/g, ' ').trim().slice(0, ALBUM_SORTKEY_MAX);
  if (!db.albumSortKeys || typeof db.albumSortKeys !== 'object') db.albumSortKeys = {};
  if ((db.albumSortKeys[key] || '') === v) return false;
  if (v) db.albumSortKeys[key] = v; else delete db.albumSortKeys[key];
  saveDB();
  if (typeof _wesCount !== 'undefined') _wesCount.at = 0;   // Western music の件数（v6.5：ソートキーで判定するため）
  return true;
}
// 目印の付け替え（map：{ 古い目印: 新しい目印 }）。新しい目印に既にソートキーがあれば、そちらを残す。変えたら true
function renameAlbumSortKeys(map) {
  var m = db.albumSortKeys;
  if (!m) return false;
  var changed = false;
  Object.keys(map).forEach(function (oldKey) {
    var nk = map[oldKey];
    if (!nk || nk === oldKey || typeof m[oldKey] !== 'string') return;
    if (!m[nk]) m[nk] = m[oldKey];
    delete m[oldKey];
    changed = true;
  });
  return changed;
}

// ソートキーどうしの比べ方：文字の順番は今までどおり（英字→かな→その他、空欄は最後、先頭の記号は飛ばす）。
// 数字は自然な順（「その他」に入る数字始まりのキーも 2 < 10 になるよう、辞書の順で比べる）
function compareSortKeyText(x, y) {
  if (x.empty !== y.empty) return x.empty ? 1 : -1;
  if (x.cat !== y.cat) return x.cat - y.cat;
  var r = _ALB_COLLATOR.compare(x.norm, y.norm);
  if (!r) r = x.raw < y.raw ? -1 : (x.raw > y.raw ? 1 : 0);
  return r;
}

/* ---------- カードのソートキーの表示 ---------- */
function albumCardSortKeyHtml(a) {
  var k = getAlbumSortKey(a.key);
  return k ? '<span class="album-card-sortkey" title="ソートキー：' + escapeHtml(k) + '">' + ICONS.tag + '<span class="album-card-sortkey-text">' + escapeHtml(k) + '</span></span>' : '';
}

// 見出しのソートキー（v4.9）：アルバムの見出しの曲数の行（タグのバッジの右）。押すとソートキー・タグの入力。無ければ出さない
function albumHeadSortKeyHtml(a) {
  var k = getAlbumSortKey(a.key);
  if (!k) return '';
  return '<button type="button" class="album-head-sortkey" data-act="head-sortkey" title="ソートキー：' + escapeHtml(k) + '（押すと変更）" aria-label="ソートキー：' + escapeHtml(k) + '（押すと変更）">' +
    ICONS.tag + '<span class="album-head-sortkey-text">' + escapeHtml(k) + '</span></button>';
}

/* ---------- ソートキーの入力（小さな入力欄） ---------- */
var _sortKeyPop = null;
function closeSortKeyPopup(save) {
  var p = _sortKeyPop;
  if (!p) return;
  _sortKeyPop = null;
  document.removeEventListener('pointerdown', p.onDown, true);
  window.removeEventListener('resize', p.onResize);
  var val = p.el.querySelector('input.sortkey-pop-input').value;
  var tgEl = p.el.querySelector('input[name="sk-tag"]:checked'), tagVal = tgEl ? tgEl.value : null;   // タグ（v4.4）
  p.el.remove();
  if (save) {
    var had = getAlbumSortKey(p.album.key), hadTag = typeof albumTagOf === 'function' ? ((albumTagOf(p.album.key) || {}).id || '') : '';
    var chK = setAlbumSortKey(p.album.key, val);
    var chT = tagVal !== null && typeof setAlbumTag === 'function' && setAlbumTag(p.album.key, tagVal);
    if (chK || chT) {
      var now = getAlbumSortKey(p.album.key), nowTag = chT ? albumTagOf(p.album.key) : null;
      var msg = chK && !chT ? (now ? 'アルバム「' + p.album.name + '」のソートキーを「' + now + '」にしました。' : 'アルバム「' + p.album.name + '」のソートキーを外しました。')
        : chT && !chK ? (nowTag ? 'アルバム「' + p.album.name + '」にタグ「' + nowTag.name + '」を付けました。' : 'アルバム「' + p.album.name + '」のタグを外しました。')
        : 'アルバム「' + p.album.name + '」のソートキーとタグを変更しました。';
      showToast(msg, false, { label: '元に戻す', fn: function () { setAlbumSortKey(p.album.key, had); if (typeof setAlbumTag === 'function') setAlbumTag(p.album.key, hadTag); _rerenderAfterSortKey(); } });
      _rerenderAfterSortKey();
    }
  }
  if (p.anchor && document.body.contains(p.anchor)) { try { p.anchor.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
function _rerenderAfterSortKey() {
  if (currentPage === 'albums') renderAlbumsPage();
  else if (currentPage === 'artists') renderArtistsPage();
  else if (currentPage === 'newsongs' && typeof renderNewSongsPage === 'function') renderNewSongsPage();
  else if (currentPage === 'western' && typeof renderWesternPage === 'function') renderWesternPage();
}
function openSortKeyPopup(a, anchor) {
  closeSortKeyPopup(false);
  var el = document.createElement('div');
  el.className = 'sortkey-pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'ソートキー・タグの入力');
  el.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'ソートキー・タグの入力\', event)" title="クリックで「ソートキー・タグの入力」をコピー">□</span>' +
    '<div class="sortkey-pop-title">' + ICONS.tag + 'ソートキー・タグ<span class="sortkey-pop-album">' + escapeHtml(a.name) + '</span></div>' +
    // タグ（v4.4）：なし＋各タグから1つ
    (typeof albumTagChoiceHtml === 'function' && (db.albumTags || []).length ? '<div class="sortkey-pop-sub">タグ</div>' + albumTagChoiceHtml((albumTagOf(a.key) || {}).id || '', 'sk-tag') + '<div class="sortkey-pop-sub">ソートキー</div>' : '') +
    '<input type="text" class="form-input sortkey-pop-input" maxlength="' + ALBUM_SORTKEY_MAX + '" value="' + escapeHtml(getAlbumSortKey(a.key)) + '" placeholder="並べ替え用の文字（空にすると解除）" aria-label="ソートキー" autocomplete="off">' +
    '<div class="sortkey-pop-hint">Enter で保存・Esc で取消。並べ替えの設定で「ソートキー」「タグ」を選ぶと、その順に並びます。</div>' +
    '<div class="sortkey-pop-btns"><button type="button" class="btn-cancel" data-sk="cancel">取消</button><button type="button" class="btn-save" data-sk="save">保存</button></div>';
  document.body.appendChild(el);
  try { anchor.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 無視 */ }
  // 置き場所：ボタンの下（入らなければ上）。画面の幅からはみ出さない
  var place = function () {
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, m = 8;
    var left = Math.min(Math.max(m, r.left), window.innerWidth - w - m);
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - m) top = r.top - h - 6;
    top = Math.min(Math.max(m, top), window.innerHeight - h - m);   // 画面の高さからもはみ出さない
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  };
  place();
  var input = el.querySelector('input.sortkey-pop-input');
  el.addEventListener('keydown', function (ev) {   // タグを選んでいるときも Enter・Esc が効く
    if (ev.target === input) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); closeSortKeyPopup(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSortKeyPopup(false); }
  });
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); closeSortKeyPopup(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSortKeyPopup(false); }
  });
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-sk]');
    if (b) closeSortKeyPopup(b.getAttribute('data-sk') === 'save');
  });
  var onDown = function (ev) { if (!el.contains(ev.target)) closeSortKeyPopup(false); };
  var onResize = function () { place(); };
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onResize);
  _sortKeyPop = { el: el, album: a, anchor: anchor, onDown: onDown, onResize: onResize };
  setTimeout(function () { input.focus(); input.select(); }, 0);
}

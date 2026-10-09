/* =========================================================
   79-artist-copy.js ― アーティスト名のコピー（スマホ版 v8.12.5）
   ・アルバムの「ソートキー」（30-album-sortkey.js）と「タグ」（31-album-tags.js）に、そのアルバムのアーティスト名を入れる
     （ソートキー・タグはアルバムごとの設定。曲ごとではない）
   ・入れるアーティスト名：アルバムアーティスト → 無ければ曲のアーティスト（全曲が同じ1人のときだけ）。
     決まらないアルバム（コンピレーション・アーティストのタグが無い）は何もしない（14-albums.js の albumSearchInfo() と同じ決まり）
   ・タグは「1枚に1つ」の決まりなので、アーティスト名と同じ名前のタグ（大文字・小文字は区別しない）を使い、無ければ作る
     （同じ名前のタグは2つ作らない。タグの名前は30文字まで）
   ・画面：tools の「アーティスト名のコピー（tools）」
       自動コピーの切り替え（ソートキー／タグ を別々に ON/OFF）…
         ON の間は、曲情報を読み終わったとき（起動・読み直し・曲の追加）と、曲情報・アルバム情報の編集のあとに、
         空のアルバムにだけ入れる（入っている所は上書きしない）。ON にしたときも、その場で空の所に入れる
       一括コピーボタン…確認のうえ、全アルバムに入れる（「空の所だけ」か「上書きも」を選ぶ）。トーストの「元に戻す」で戻せる
   ・保存：db.settings.artistCopySortKey／db.settings.artistCopyTag（true/false。初期 false。バックアップ・復元に含む）。
     入れた値は今までどおり db.albumSortKeys・db.albumTags・db.albumTagOf（形は変えない）
   ・ファイルは一切触らない
   ========================================================= */

// そのアルバムに入れるアーティスト名（決まらなければ ''）
function artistCopyNameOf(a) {
  if (!a) return '';
  var n = typeof albumSearchInfo === 'function' ? albumSearchInfo(a).artist : (a.albumArtist || '');
  return String(n || '').replace(/\s+/g, ' ').trim();
}

// アーティスト名のタグを探す（無ければ create のとき作る）。タグの id を返す（作れなければ ''）
function _artistCopyTagId(name, create) {
  var v = String(name || '').trim().slice(0, 30);
  if (!v) return '';
  var lower = v.toLowerCase();
  var hit = (db.albumTags || []).find(function (t) { return t.name.toLowerCase() === lower; });
  if (hit) return hit.id;
  if (!create) return '';
  var used = (db.albumTags || []).map(function (t) { return t.color; });
  var free = ALBUM_TAG_COLORS.filter(function (c) { return used.indexOf(c[0]) < 0; });
  var color = (free[0] || ALBUM_TAG_COLORS[(db.albumTags || []).length % ALBUM_TAG_COLORS.length])[0];
  var id, n = 0;
  do { id = 'ar' + Date.now().toString(36) + (n ? '-' + n : ''); n++; } while (albumTagById(id));
  db.albumTags = (db.albumTags || []).concat([{ id: id, name: v, color: color }]);
  return id;
}

/* ---------- 入れる（自動・一括で共通） ----------
   o = { sortKey:true/false, tag:true/false, overwrite:true/false, dry:true（数えるだけ） }
   戻り値 { sortKey:入れた数, tag:入れた数, newTags:作ったタグの数（dry のときは作る予定の数） } */
function artistCopyApply(o) {
  var res = { sortKey: 0, tag: 0, newTags: 0 };
  if (!library.tracks.length || (!o.sortKey && !o.tag)) return res;
  if (!db.albumSortKeys || typeof db.albumSortKeys !== 'object') db.albumSortKeys = {};
  if (!db.albumTagOf || typeof db.albumTagOf !== 'object') db.albumTagOf = {};
  var planned = new Set();   // dry のとき：作る予定のタグの名前（重ねて数えない）
  buildAlbums().forEach(function (a) {
    var name = artistCopyNameOf(a);
    if (!name) return;
    if (o.sortKey) {
      var sk = name.slice(0, ALBUM_SORTKEY_MAX), cur = getAlbumSortKey(a.key);
      if ((!cur || o.overwrite) && cur !== sk) { if (!o.dry) db.albumSortKeys[a.key] = sk; res.sortKey++; }
    }
    if (o.tag) {
      var curId = db.albumTagOf[a.key] || '';
      if (curId && !albumTagById(curId)) curId = '';
      if (curId && !o.overwrite) return;
      var tid = _artistCopyTagId(name, false);
      if (curId && tid && curId === tid) return;   // もう同じタグ
      if (!tid) {
        var nm = name.slice(0, 30).toLowerCase();
        if (o.dry) { if (!planned.has(nm)) { planned.add(nm); res.newTags++; } res.tag++; return; }
        tid = _artistCopyTagId(name, true);
        res.newTags++;
      }
      if (!o.dry) db.albumTagOf[a.key] = tid;
      res.tag++;
    }
  });
  if (!o.dry && (res.sortKey || res.tag)) {
    saveDB();
    if (typeof _wesCount !== 'undefined') _wesCount.at = 0;   // Western music の件数（ソートキーで判定するため。30-album-sortkey.js と同じ）
  }
  return res;
}

// 自動コピー：ON の項目だけ、空の所に入れる。入れたら true
function artistCopyAuto() {
  var s = db.settings || {};
  if (!s.artistCopySortKey && !s.artistCopyTag) return false;
  if (!library.scanned || library.scanning || library.metaRunning) return false;   // 曲情報を読み終わってから（途中はアルバムの目印が変わるため）
  var r = artistCopyApply({ sortKey: !!s.artistCopySortKey, tag: !!s.artistCopyTag, overwrite: false });
  return !!(r.sortKey || r.tag);
}
function _artistCopyAutoAndRender() {
  if (artistCopyAuto() && typeof renderCurrentPage === 'function') renderCurrentPage();
}

/* ---------- 自動で動くきっかけ ---------- */
// ① 曲情報を読み終わったとき（起動・読み直し・曲の追加。04-library.js の onMetadataProgress(true)）
(function () {
  var f = window.onMetadataProgress;
  if (typeof f !== 'function') return;
  window.onMetadataProgress = function (finished) {
    var r = f.apply(this, arguments);
    if (finished) { try { _artistCopyAutoAndRender(); } catch (e) { console.warn(e); } }
    return r;
  };
})();
// ② 曲情報・アルバム情報の編集のあと（17-tag-edit.js の _renameAlbumKeysAfter()。目印の付け替えが済んでから、描き直しのあとで）
(function () {
  var f = window._renameAlbumKeysAfter;
  if (typeof f !== 'function') return;
  window._renameAlbumKeysAfter = function () {
    var r = f.apply(this, arguments);
    setTimeout(function () { try { _artistCopyAutoAndRender(); } catch (e) { console.warn(e); } }, 0);
    return r;
  };
})();

/* ---------- 元に戻す（一括コピー・ON にしたとき） ---------- */
function _artistCopySnapshot() {
  return { sk: Object.assign({}, db.albumSortKeys || {}), tags: (db.albumTags || []).slice(), of: Object.assign({}, db.albumTagOf || {}) };
}
function _artistCopyRestore(snap) {
  db.albumSortKeys = snap.sk; db.albumTags = snap.tags; db.albumTagOf = snap.of;
  saveDB();
  if (typeof _wesCount !== 'undefined') _wesCount.at = 0;
  if (typeof renderCurrentPage === 'function') renderCurrentPage();
  showToast('アーティスト名のコピーを元に戻しました。');
}
function _artistCopyResultText(r) {
  var p = [];
  if (r.sortKey) p.push('ソートキー ' + r.sortKey + '枚');
  if (r.tag) p.push('タグ ' + r.tag + '枚' + (r.newTags ? '（新しいタグ ' + r.newTags + '個）' : ''));
  return p.join('・');
}

/* ---------- tools の「アーティスト名のコピー（tools）」 ---------- */
function renderSetArtistCopy() {
  var el = document.getElementById('set-artist-copy');
  if (!el) return;
  var s = db.settings || {};
  var h =
    '<div class="ac-sub-title">自動コピー</div>' +
    '<label class="tagedit-write"><input type="checkbox" id="ac-auto-sk"' + (s.artistCopySortKey ? ' checked' : '') + '>ソートキーが空のアルバムに、アーティスト名を自動で入れる</label>' +
    '<label class="tagedit-write"><input type="checkbox" id="ac-auto-tag"' + (s.artistCopyTag ? ' checked' : '') + '>タグが空のアルバムに、アーティスト名のタグを自動で付ける</label>' +
    '<p class="panel-desc">ON の間は、曲情報を読み終わったとき（起動・読み直し・曲の追加）と曲情報・アルバム情報の編集のあとに、空のアルバムにだけ入れます（入っている所は変えません）。ON の間は、空にしても次の読み込み・編集でまた入ります。</p>' +
    '<div class="ac-sub-title">一括コピー</div>' +
    '<div class="ac-bulk-opts">' +
      '<label class="tagedit-write"><input type="checkbox" id="ac-bulk-sk" checked>ソートキー</label>' +
      '<label class="tagedit-write"><input type="checkbox" id="ac-bulk-tag">タグ</label>' +
    '</div>' +
    '<div class="ac-bulk-opts" role="radiogroup" aria-label="入れ方">' +
      '<label class="tagedit-write"><input type="radio" name="ac-bulk-mode" value="empty" checked>空の所だけ</label>' +
      '<label class="tagedit-write"><input type="radio" name="ac-bulk-mode" value="overwrite">上書きも（入っている値をアーティスト名に置き換える）</label>' +
    '</div>' +
    '<div class="btn-row"><span class="ac-bulk-wrap" style="position:relative;display:inline-block"><button class="btn-inline-small" id="ac-bulk-btn">一括コピー</button>' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-6px" onclick="copyUiLabel(\'一括コピーボタン\', event)" title="クリックで「一括コピーボタン」をコピー">□</span></span></div>';
  el.innerHTML = h;
  var onAuto = function (key, box) {
    box.addEventListener('change', function () {
      db.settings[key] = box.checked;
      saveDB();
      if (!box.checked) { showToast('自動コピーを OFF にしました（入れた値はそのまま残ります）。'); return; }
      if (!library.scanned || library.metaRunning) { showToast('自動コピーを ON にしました（曲情報を読み終わったら、空の所に入れます）。'); return; }
      var snap = _artistCopySnapshot();
      var r = artistCopyApply({ sortKey: key === 'artistCopySortKey', tag: key === 'artistCopyTag', overwrite: false });
      var t = _artistCopyResultText(r);
      showToast('自動コピーを ON にしました。' + (t ? '空の所に入れました：' + t : '空の所はありませんでした。'), false,
        t ? { label: '元に戻す', fn: function () { _artistCopyRestore(snap); } } : null);
    });
  };
  onAuto('artistCopySortKey', el.querySelector('#ac-auto-sk'));
  onAuto('artistCopyTag', el.querySelector('#ac-auto-tag'));
  el.querySelector('#ac-bulk-btn').addEventListener('click', async function () {
    var o = { sortKey: el.querySelector('#ac-bulk-sk').checked, tag: el.querySelector('#ac-bulk-tag').checked,
      overwrite: (el.querySelector('input[name="ac-bulk-mode"]:checked') || {}).value === 'overwrite' };
    if (!o.sortKey && !o.tag) { showToast('「ソートキー」か「タグ」を選んでください。', true); return; }
    if (!isConnected() || !library.scanned) { showToast('音楽フォルダを読み込んでから使ってください。', true); return; }
    if (library.metaRunning) { showToast('曲情報を読み込んでいます。読み終わってから使ってください。', true); return; }
    var d = artistCopyApply(Object.assign({ dry: true }, o));
    if (!d.sortKey && !d.tag) { showToast('入れる所はありませんでした（' + (o.overwrite ? 'もう全部アーティスト名です' : '空の所がありません') + '）。'); return; }
    var ok = await showConfirm({
      title: 'アーティスト名を一括コピー',
      message: '全アルバムの' + [o.sortKey ? 'ソートキー' : '', o.tag ? 'タグ' : ''].filter(Boolean).join('・') + 'に、アーティスト名を入れます（' + (o.overwrite ? '<strong>入っている値も置き換えます</strong>' : '空の所だけ') + '）。<br>' +
        (d.sortKey ? 'ソートキー：<strong>' + d.sortKey + '枚</strong><br>' : '') +
        (d.tag ? 'タグ：<strong>' + d.tag + '枚</strong>' + (d.newTags ? '（アーティスト名の新しいタグを <strong>' + d.newTags + '個</strong> 作ります）' : '') + '<br>' : '') +
        '<span class="dialog-hint">アーティストが決まらないアルバム（コンピレーションなど）は変えません。ファイルは変わりません。あとのトーストの「元に戻す」で戻せます。念のため先にバックアップしておくと安心です。</span>',
      okText: '一括コピー', danger: o.overwrite
    });
    if (!ok) return;
    var snap = _artistCopySnapshot();
    var r = artistCopyApply(o);
    showToast('アーティスト名を入れました：' + (_artistCopyResultText(r) || '0枚'), false, { label: '元に戻す', fn: function () { _artistCopyRestore(snap); } });
    if (typeof renderSetAlbumTags === 'function') renderSetAlbumTags();
  });
}

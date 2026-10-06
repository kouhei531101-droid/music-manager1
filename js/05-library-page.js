/* =========================================================
   05-library-page.js ― 「曲一覧」画面
   ・曲一覧のフィルターバー（検索欄・並べ替え）
   ・選択操作バー（チェックした曲をプレイリストに追加・再生）
   ・曲一覧の本文エリア（曲リストの表）／はじめにカード（未接続のとき）
   ========================================================= */

var libView = {
  query: '',
  limit: 500,            // 表示している曲数（下までスクロールすると LIB_PAGE_SIZE ずつ増える。v2.4）
  selected: new Set(),   // チェックした曲の相対パス
  list: []               // 今表示している並び（検索・並べ替え後）
};
var LIB_PAGE_SIZE = 500;
var SORT_OPTIONS = [
  ['title', '曲名'], ['artist', 'アーティスト'], ['album', 'アルバム'], ['duration', '長さ'],
  ['name', 'ファイル名'], ['folder', 'フォルダ'], ['lastModified', '更新日']
];

PAGE_RENDERERS.library = renderLibraryPage;

/* ---------- 検索・並べ替え ---------- */
function _cmpTrack(a, b, key) {
  if (key === 'duration' || key === 'lastModified') return (a[key] || 0) - (b[key] || 0);
  var x = a[key] || '', y = b[key] || '';
  if (!x && y) return 1;
  if (x && !y) return -1;
  return JA_COLLATOR.compare(x, y);
}
function getLibraryList() {
  var q = libView.query.trim().toLowerCase();
  var terms = q ? q.split(/\s+/) : [];
  var arr = terms.length
    ? library.tracks.filter(function (t) { return terms.every(function (w) { return t.search.indexOf(w) >= 0; }); })
    : library.tracks.slice();
  var key = db.settings.sortKey || 'title';
  var dir = db.settings.sortDir === 'desc' ? -1 : 1;
  arr.sort(function (a, b) {
    var r = _cmpTrack(a, b, key);
    if (!r && key === 'artist') r = _cmpTrack(a, b, 'album');   // アーティスト順のときはアルバムでもそろえる
    if (!r) r = JA_COLLATOR.compare(a.path, b.path);            // 同じならフォルダ＋ファイル名順（曲番号順）
    return r * dir;
  });
  return arr;
}

/* ---------- 描画 ---------- */
function renderLibraryPage() {
  renderLibSortTabs();
  renderLibScanStatus();
  var body = document.getElementById('lib-body');
  var countEl = document.getElementById('lib-count');
  if (!isConnected()) {
    body.innerHTML = welcomeCardHtml();
    countEl.textContent = '';
    libView.list = [];
    updateLibSelectBar();
    return;
  }
  if (!library.scanned) {
    body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>';
    countEl.textContent = '';
    return;
  }
  var list = getLibraryList();
  libView.list = list;
  countEl.textContent = libView.query.trim() ? (list.length + '曲 / 全' + library.tracks.length + '曲') : (list.length + '曲');
  if (!list.length) {
    body.innerHTML = '<div class="empty-msg">' + (library.tracks.length
      ? '検索に当てはまる曲がありません。'
      : '音楽フォルダの中に曲ファイル（' + AUDIO_EXTS.join(' / ') + '）が見つかりませんでした。') + '</div>';
    updateLibSelectBar();
    return;
  }
  var shown = list.slice(0, libView.limit);
  var allChecked = list.every(function (t) { return libView.selected.has(t.path); });
  var h = '<table class="lib-table"><thead><tr>' +
    '<th class="col-check"><input type="checkbox" data-act="checkall" title="絞り込み中の曲をすべて選ぶ（まだ表示していない曲も含む）"' + (allChecked ? ' checked' : '') + '></th>' +
    '<th class="col-play"></th><th class="col-art"></th>' +
    '<th class="col-title">曲名</th><th class="col-artist">アーティスト</th><th class="col-album">アルバム</th>' +
    '<th class="col-dur">長さ</th><th class="col-folder">フォルダ</th><th class="col-add"></th><th class="col-edit"></th>' +
    '</tr></thead><tbody id="lib-tbody">' + shown.map(_libRowHtml).join('') + '</tbody></table>';
  if (list.length > shown.length) h += loadMoreHtml('lib-more', list.length - shown.length, '曲');
  h += '<p class="lib-legend">うすい文字は、曲情報（タグ）が無かったためファイル名・フォルダ名から推定した値です。</p>';
  body.innerHTML = h;
  artObserve(body);   // 見えている行のジャケット画像だけ読み込む
  watchLoadMore('lib', document.getElementById('lib-more'), libLoadMore);
  updateLibSelectBar();
}
// 検索・並べ替えを変えたとき：最初の分だけを表示し直して、一覧の先頭へ（v2.4）
function resetLibraryScroll() {
  libView.limit = LIB_PAGE_SIZE;
  renderLibraryPage();
  var top = document.getElementById('page-library');
  if (top && window.scrollY > top.offsetTop) window.scrollTo(0, 0);
}
// 曲リストの1行
function _libRowHtml(t, i) {
  var sel = libView.selected.has(t.path);
  return '<tr class="lib-row' + (t.path === player.currentPath ? ' is-playing' : '') + (sel ? ' is-selected' : '') + '" data-i="' + i + '">' +
    '<td class="col-check"><input type="checkbox" data-act="check" data-i="' + i + '"' + (sel ? ' checked' : '') + '></td>' +
    '<td class="col-play"><button class="btn-icon btn-play-row" data-act="play" data-i="' + i + '" title="この曲から再生">' + ICONS.play + '</button></td>' +
    '<td class="col-art">' + artThumbHtml(t) + '</td>' +
    '<td class="col-title"><div class="lib-title-row"><div class="lib-title' + (t.titleGuessed ? ' guessed' : '') + '" title="' + escapeHtml(t.path) + '">' + escapeHtml(t.title) + '</div>' +
      '<button class="title-edit" data-act="edit" data-i="' + i + '" title="曲名を編集" aria-label="曲名を編集">' + ICONS.edit + '</button>' + '</div>' +
      '<div class="lib-sub">' + artistAlbumLinksHtml(t) + '</div></td>' +   // アーティストへのリンク・アルバムへのリンク（v3.1）
    '<td class="col-artist' + (t.artistGuessed ? ' guessed' : '') + '">' + artistLinkHtml(t) + '</td>' +
    '<td class="col-album' + (t.albumGuessed ? ' guessed' : '') + '">' + albumLinkHtml(t) + '</td>' +
    '<td class="col-dur">' + formatDuration(t.duration) + '</td>' +
    '<td class="col-folder" title="' + escapeHtml(folderLabel(t.folder)) + '">' + escapeHtml(folderLabel(t.folder)) + '</td>' +
    '<td class="col-add"><button class="btn-icon" data-act="add" data-i="' + i + '" title="プレイリストに追加">' + ICONS.plus + '</button></td>' +
    '<td class="col-edit"><button class="btn-row-edit" data-act="edit" data-i="' + i + '" title="曲情報を編集" aria-label="曲情報を編集">' + ICONS.edit + '<span class="btn-row-edit-label">編集</span></button></td>' +
    '</tr>';
}
// 続きの曲（LIB_PAGE_SIZE 曲）を表の最後に足す（表全体は描き直さないのでスクロール位置は動かない）
function libLoadMore() {
  var list = libView.list, from = libView.limit, to = Math.min(list.length, from + LIB_PAGE_SIZE);
  var tbody = document.getElementById('lib-tbody'), more = document.getElementById('lib-more');
  if (!tbody || from >= list.length) return;
  tbody.insertAdjacentHTML('beforeend', list.slice(from, to).map(function (t, k) { return _libRowHtml(t, from + k); }).join(''));
  libView.limit = to;
  artObserve(tbody);
  if (!more) return;
  if (to >= list.length) { more.remove(); return; }
  more.querySelector('.load-more-text').textContent = '下へスクロールすると続きを表示します（残り ' + (list.length - to) + ' 曲）';
  watchLoadMore('lib', more, libLoadMore);
}

// 並べ替え（タブ状のボタン列。選択中をもう一度押すと昇順/降順が切り替わる）
function renderLibSortTabs() {
  var el = document.getElementById('lib-sort-tabs');
  if (!el) return;
  var key = db.settings.sortKey, desc = db.settings.sortDir === 'desc';
  el.innerHTML = SORT_OPTIONS.map(function (o) {
    var active = o[0] === key;
    return '<button class="tab-btn' + (active ? ' active' : '') + '" data-sort="' + o[0] + '">' + o[1] + (active ? (desc ? ' ↓' : ' ↑') : '') + '</button>';
  }).join('');
}

// はじめにカード（未接続・許可待ち・非対応のとき）
function welcomeCardHtml() {
  if (!fsa.supported) {
    return '<div class="welcome-card"><h2>このブラウザでは音楽フォルダを開けません</h2>' +
      '<p>Google Chrome または Microsoft Edge（パソコン版）で <code>index.html</code> を開いてください。</p></div>';
  }
  if (fsa.root && fsa.state === 'prompt') {
    return '<div class="welcome-card"><h2>音楽フォルダに再接続してください</h2>' +
      '<p>前回の音楽フォルダ「<strong>' + escapeHtml(fsa.folderName) + '</strong>」を読むには、ブラウザの許可が必要です。</p>' +
      '<div class="btn-row"><button class="btn-save" onclick="reconnectMusicFolder()">' + ICONS.link + '再接続する</button>' +
      '<button class="btn-cancel" onclick="pickMusicFolder()">別のフォルダを選ぶ</button></div></div>';
  }
  return '<div class="welcome-card"><h2>はじめに：音楽フォルダを選んでください</h2>' +
    '<ol><li>下の「音楽フォルダを選ぶ」を押します。</li>' +
    '<li>曲が入っているフォルダ（例：ミュージック）を選び、「フォルダーの選択」→ ブラウザの確認で「ファイルを表示」を押します。</li>' +
    '<li>中の曲（' + AUDIO_EXTS.join(' / ') + '）がこの曲一覧に並びます。</li></ol>' +
    '<p class="welcome-note">曲一覧の表示や再生では、音楽ファイルを書き換えません。ファイル名の変更や移動は「ファイル整理」で、確認のあとに行います。</p>' +
    '<div class="btn-row"><button class="btn-save" onclick="pickMusicFolder()">' + ICONS.folder + '音楽フォルダを選ぶ</button></div></div>';
}

/* ---------- 選択操作バー ---------- */
function updateLibSelectBar() {
  var bar = document.getElementById('lib-select-bar');
  if (!bar) return;
  // 一覧から消えた曲の選択は外す
  libView.selected.forEach(function (p) { if (!library.byPath[p]) libView.selected.delete(p); });
  var n = libView.selected.size;
  bar.hidden = n === 0;
  if (!n) { bar.innerHTML = ''; return; }
  bar.innerHTML =
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'選択操作バー\', event)" title="クリックで「選択操作バー」をコピー">□</span>' +
    '<span class="select-count">' + n + '曲を選択中</span>' +
    '<button class="btn-inline-small" onclick="addSelectedToPlaylist()">' + ICONS.plus + 'プレイリストに追加</button>' +
    '<button class="btn-inline-small" onclick="playSelected()">' + ICONS.play + '選んだ曲を再生</button>' +
    '<button class="btn-inline-small" onclick="openBulkTagEditor(selectedPathsInViewOrder())">' + ICONS.edit + 'まとめて編集</button>' +
    '<button class="btn-inline-small" onclick="clearLibSelection()">選択を解除</button>';
}
function selectedPathsInViewOrder() {
  var sel = libView.selected;
  var inView = libView.list.filter(function (t) { return sel.has(t.path); }).map(function (t) { return t.path; });
  // 検索で見えなくなった選択曲も最後に付ける
  sel.forEach(function (p) { if (inView.indexOf(p) < 0 && library.byPath[p]) inView.push(p); });
  return inView;
}
function addSelectedToPlaylist() { openAddToPlaylistDialog(selectedPathsInViewOrder()); }
function playSelected() {
  var paths = selectedPathsInViewOrder();
  if (paths.length) playQueue(paths, 0, '曲一覧（選んだ曲）');
}
function clearLibSelection() { libView.selected.clear(); renderLibraryPage(); }

/* ---------- 再生 ---------- */
function playFromLibrary(i) {
  var list = libView.list;
  if (!list[i]) return;
  playQueue(list.map(function (t) { return t.path; }), i, '曲一覧');
}
function playAllVisible() {
  if (!isConnected()) { showToast('先に音楽フォルダを選んでください。', true); return; }
  if (!libView.list.length) libView.list = getLibraryList();
  if (!libView.list.length) { showToast('再生できる曲がありません。'); return; }
  playFromLibrary(0);
}

// 再生中の行の色だけを付け直す（表全体は描き直さない）
function updatePlayingHighlight() {
  var rows = document.querySelectorAll('#lib-body .lib-row');
  rows.forEach(function (r) {
    var t = libView.list[+r.getAttribute('data-i')];
    r.classList.toggle('is-playing', !!t && t.path === player.currentPath);
  });
  if (typeof updatePlaylistPlayingHighlight === 'function') updatePlaylistPlayingHighlight();
  if (typeof updateAlbumPlayingHighlight === 'function') updateAlbumPlayingHighlight();
}

/* ---------- 操作の受け付け（最初に1回だけ登録） ---------- */
function initLibraryPage() {
  var search = document.getElementById('lib-search');
  search.addEventListener('input', debounce(function () {
    libView.query = search.value;
    resetLibraryScroll();
  }, 180));

  document.getElementById('lib-sort-tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-sort]');
    if (!b) return;
    var key = b.getAttribute('data-sort');
    if (db.settings.sortKey === key) db.settings.sortDir = db.settings.sortDir === 'desc' ? 'asc' : 'desc';
    else { db.settings.sortKey = key; db.settings.sortDir = 'asc'; }
    saveDB();
    resetLibraryScroll();
  });

  var body = document.getElementById('lib-body');
  body.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var i = +el.getAttribute('data-i');
    if (act === 'play') playFromLibrary(i);
    else if (act === 'add') { var t = libView.list[i]; if (t) openAddToPlaylistDialog([t.path]); }
    else if (act === 'edit') { var te = libView.list[i]; if (te) openTrackTagEditor(te.path); }
    else if (act === 'more') libLoadMore();   // 予備のボタン
  });
  body.addEventListener('change', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'check') {
      var t = libView.list[+el.getAttribute('data-i')];
      if (!t) return;
      if (el.checked) libView.selected.add(t.path); else libView.selected.delete(t.path);
      var row = el.closest('tr'); if (row) row.classList.toggle('is-selected', el.checked);
      updateLibSelectBar();
    } else if (act === 'checkall') {
      libView.list.forEach(function (t) {   // 絞り込み中の曲すべて（まだ表示していない曲も含む。v2.4）
        if (el.checked) libView.selected.add(t.path); else libView.selected.delete(t.path);
      });
      renderLibraryPage();
    }
  });
  // 行をダブルクリックでも再生
  body.addEventListener('dblclick', function (ev) {
    if (ev.target.closest('button, input')) return;
    var row = ev.target.closest('.lib-row');
    if (row) playFromLibrary(+row.getAttribute('data-i'));
  });
}

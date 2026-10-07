/* =========================================================
   19-new-songs.js ― 「new songs」画面（最近追加した曲）と、曲の表の共通部品（v2.2）
   ・追加日＝アプリが初めてその曲を見つけた日時（04-library.js の firstSeen。
     一番最初の読み込みのときは、ファイルの更新日時を使う）
   ・期間（直近7日／30日／90日／全期間）と件数を選べる（見た目の設定として保存）
   ・v4.2：表示の切り替え「アルバム」（初期値）／「曲」（ui.newSongsMode。この PC の見た目の設定）
       アルバム表示（new songs のアルバム表示）：期間内に追加した曲を含むアルバムのカード（新しいアルバムカード）を、
         アルバムの追加日（そのアルバムの中で一番新しく追加した曲の追加日）の新しい順に。件数はアルバムの枚数（20／50／100／200枚）。
         カードには追加日（7日以内は「今日」「3日前」など）と「新しい曲 3 / 12曲」。カードの再生・Pin ボタンは album と同じ（非表示ボタンは付けない）。
         非表示のアルバム（v3.0）は出さない（曲表示には出る）。押すと album のアルバムの曲一覧を開き、新しい曲に「NEW」の印。
         アルバムの曲一覧の「new songs に戻る」で、このカードの位置に戻る
       曲表示：今までの曲の表（件数は 50／100／200／500曲）
   ・再生・プレイリストに追加・編集は曲一覧と同じ
   ・songTableHtml()／bindSongTable() は heavy rotation（20-heavy-rotation.js）・artist（21-artists.js）でも使う
   ========================================================= */

var NEW_SONGS_DAYS = [[7, '直近7日'], [30, '直近30日'], [90, '直近90日'], [0, '全期間']];
var NEW_SONGS_LIMITS = [50, 100, 200, 500];
var newSongsView = { list: [], albums: [] };

PAGE_RENDERERS.newsongs = renderNewSongsPage;

/* ---------- 曲の表（共通） ----------
   list：曲の配列。opts.extra：{ head, cell(t, i) } 追加の列（追加日・再生回数など）。opts.label：再生元の名前 */
function songTableHtml(list, opts) {
  opts = opts || {};
  var h = '<table class="lib-table song-table"><thead><tr>' +
    '<th class="col-play"></th><th class="col-art"></th><th class="col-title">title</th><th class="col-album">アルバム</th>' +
    (opts.extra ? '<th class="col-extra">' + opts.extra.head + '</th>' : '') +
    '<th class="col-dur">length</th><th class="col-add"></th><th class="col-edit"></th></tr></thead><tbody>';   // スマホ版 v8.9.2：見出しを title／length に（アルバムの曲リストとそろえる）
  list.forEach(function (t, i) {
    h += '<tr class="lib-row song-row' + (t.path === player.currentPath ? ' is-playing' : '') + '" data-i="' + i + '">' +
      '<td class="col-play"><button class="btn-icon btn-play-row" data-act="play" data-i="' + i + '" title="この曲から再生">' + ICONS.play + '</button></td>' +
      '<td class="col-art">' + artThumbHtml(t) + '</td>' +
      '<td class="col-title"><div class="lib-title' + (t.titleGuessed ? ' guessed' : '') + '" title="' + escapeHtml(t.path) + '">' + escapeHtml(t.title) + '</div>' +
        '<div class="song-sub">' + artistLinkHtml(t) + '</div></td>' +   // アーティストへのリンク・アルバムへのリンク（v3.1）
      '<td class="col-album' + (t.albumGuessed ? ' guessed' : '') + '">' + albumLinkHtml(t) + '</td>' +
      (opts.extra ? '<td class="col-extra">' + opts.extra.cell(t, i) + '</td>' : '') +
      '<td class="col-dur">' + formatDuration(t.duration) + '</td>' +
      '<td class="col-add"><button class="btn-icon" data-act="add" data-i="' + i + '" title="プレイリストに追加">' + ICONS.plus + '</button></td>' +
      '<td class="col-edit"><button class="btn-row-edit btn-row-edit-icon" data-act="edit" data-i="' + i + '" title="曲情報を編集" aria-label="曲情報を編集">' + ICONS.edit + '</button></td>' +
      '</tr>';
  });
  return h + '</tbody></table>';
}
// 表の操作（再生・追加・編集・ダブルクリックで再生）。getList：今の並びを返す関数
function bindSongTable(container, getList, label) {
  container.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || !el.hasAttribute('data-i')) return;
    var list = getList(), i = +el.getAttribute('data-i'), t = list[i];
    if (!t) return;
    var act = el.getAttribute('data-act');
    if (act === 'play') playQueue(list.map(function (x) { return x.path; }), i, typeof label === 'function' ? label() : label);
    else if (act === 'add') openAddToPlaylistDialog([t.path]);
    else if (act === 'edit') openTrackTagEditor(t.path);
  });
  container.addEventListener('dblclick', function (ev) {
    if (ev.target.closest('button, input')) return;
    var row = ev.target.closest('.song-row');
    if (!row) return;
    var list = getList();
    playQueue(list.map(function (x) { return x.path; }), +row.getAttribute('data-i'), typeof label === 'function' ? label() : label);
  });
}
function formatDateShort(ms) {
  if (!ms) return '—';
  var d = new Date(ms);
  return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
}

/* ---------- new songs ---------- */
var NEW_ALBUM_LIMITS = [20, 50, 100, 200];
function newSongsMode() { return ui.newSongsMode === 'songs' ? 'songs' : 'albums'; }
function _newSongsSince() {
  var days = +(ui.newSongsDays == null ? 30 : ui.newSongsDays);
  return days ? Date.now() - days * 86400000 : 0;
}
function getNewSongs() {
  var limit = +(ui.newSongsLimit || 200);
  var since = _newSongsSince();
  return library.tracks.filter(function (t) { return t.firstSeen && t.firstSeen >= since; })
    .sort(function (a, b) { return (b.firstSeen - a.firstSeen) || JA_COLLATOR.compare(a.path, b.path); })
    .slice(0, limit);
}
// アルバム表示：期間内に追加した曲を含むアルバム（非表示のアルバムは除く）を、アルバムの追加日の新しい順に。
// 戻り値 { albums（a._nsLatest・a._nsNew を付ける）, hiddenN（除いた非表示のアルバムの数）, total（件数で切る前の枚数） }
function getNewAlbums() {
  var since = _newSongsSince(), limit = +(ui.newAlbumLimit || 50);
  var info = new Map();
  library.tracks.forEach(function (t) {
    if (!t.firstSeen || t.firstSeen < since) return;
    var k = albumKeyOf(t), x = info.get(k);
    if (!x) info.set(k, { latest: t.firstSeen, n: 1 });
    else { x.n++; if (t.firstSeen > x.latest) x.latest = t.firstSeen; }
  });
  if (!info.size) return { albums: [], hiddenN: 0, total: 0 };
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set(), hiddenN = 0;
  var list = buildAlbums().filter(function (a) {
    var x = info.get(a.key);
    if (!x) return false;
    if (hs.has(a.key)) { hiddenN++; return false; }
    a._nsLatest = x.latest; a._nsNew = x.n;
    return true;
  });
  _prepareAlbumSortKeys(list);
  list.sort(function (a, b) { return (b._nsLatest - a._nsLatest) || compareAlbumsStandard(a, b); });
  return { albums: list.slice(0, limit), hiddenN: hiddenN, total: list.length };
}
// 追加日の短い表示：7日以内は「今日」「昨日」「3日前」、それより前は「9/25」（今年でなければ「2025/9/25」）
function newAddedLabel(ms) {
  if (!ms) return '';
  var d = new Date(ms), now = new Date();
  var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var diff = Math.round((day0 - dd) / 86400000);
  if (diff <= 0) return '今日追加';
  if (diff === 1) return '昨日追加';
  if (diff < 7) return diff + '日前に追加';
  return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate() + ' 追加';
}
// 新しいアルバムカード（album のアルバムカードと同じ部品。再生・Pin ボタンあり、非表示ボタンなし）
function _newAlbumCardHtml(a, i) {
  var all = a.tracks.length, n = a._nsNew;
  return '<button class="album-card ns-album-card" data-ns-album="' + i + '" title="' + escapeHtml(a.name + (a.artist ? ' ／ ' + a.artist : '')) + '">' +
    albumCardArtHtml(a, { play: true, pin: true, hide: false }) +
    '<span class="album-card-name' + (a.byFolder ? ' guessed' : '') + '">' + escapeHtml(a.name) + '</span>' +
    '<span class="album-card-artist">' + escapeHtml(a.artist || '　') + '</span>' +
    '<span class="ns-album-meta"><span class="ns-album-date" title="' + escapeHtml(formatDateShort(a._nsLatest)) + '">' + newAddedLabel(a._nsLatest) + '</span>' +
      '<span class="ns-album-count">' + (n >= all ? all + '曲' : '新しい曲 <strong>' + n + '</strong> / ' + all + '曲') + '</span></span>' +
    '</button>';
}
function renderNewSongsPage() {
  var mode = newSongsMode();
  var days = +(ui.newSongsDays == null ? 30 : ui.newSongsDays), limit = +(ui.newSongsLimit || 200), alimit = +(ui.newAlbumLimit || 50);
  document.getElementById('ns-mode').innerHTML = [['albums', 'アルバム'], ['songs', '曲']].map(function (o) {
    return '<button class="tab-btn' + (o[0] === mode ? ' active' : '') + '" data-mode="' + o[0] + '" aria-pressed="' + (o[0] === mode) + '">' + o[1] + '</button>';
  }).join('');
  document.getElementById('ns-days').innerHTML = NEW_SONGS_DAYS.map(function (o) {
    return '<button class="tab-btn' + (o[0] === days ? ' active' : '') + '" data-days="' + o[0] + '">' + o[1] + '</button>';
  }).join('');
  document.getElementById('ns-limit').innerHTML = (mode === 'albums' ? NEW_ALBUM_LIMITS : NEW_SONGS_LIMITS).map(function (n) {
    var cur = mode === 'albums' ? alimit : limit;
    return '<button class="tab-btn' + (n === cur ? ' active' : '') + '" data-limit="' + n + '">' + n + (mode === 'albums' ? '枚' : '曲') + '</button>';
  }).join('');
  var body = document.getElementById('ns-body'), countEl = document.getElementById('ns-count');
  if (!isConnected()) { body.innerHTML = welcomeCardHtml(); countEl.textContent = ''; return; }
  if (!library.scanned) { body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>'; return; }
  var legend = '<p class="lib-legend">追加日は、このアプリが初めてその曲を見つけた日です（最初に音楽フォルダを読み込んだときにあった曲は、ファイルの更新日）。</p>';
  if (mode === 'albums') {
    var r = getNewAlbums();
    newSongsView.albums = r.albums;
    newSongsView.list = [];
    r.albums.forEach(function (a) { a.tracks.forEach(function (t) { if (t.firstSeen && t.firstSeen >= _newSongsSince()) newSongsView.list.push(t); }); });   // ヘッダーの「再生」：アルバムの順・曲順で新しい曲だけ
    countEl.textContent = r.albums.length + '枚' + (r.total > r.albums.length ? ' / ' + r.total + '枚' : '');
    if (!r.albums.length) {
      body.innerHTML = '<div class="empty-msg">この期間に追加した曲はありません。' + (r.hiddenN ? '（非表示のアルバムだけです。「曲」で表示すると見られます）' : '') + (library.metaRunning ? '（曲情報を読み込み中です）' : '') + '</div>';
      return;
    }
    body.innerHTML = '<div class="album-grid ns-album-grid">' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'new songs のアルバム表示\', event)" title="クリックで「new songs のアルバム表示」をコピー">□</span>' +
        r.albums.map(_newAlbumCardHtml).join('') + '</div>' +
      (r.total > r.albums.length ? '<p class="lib-legend">ほかに ' + (r.total - r.albums.length) + '枚あります（件数で増やせます）。</p>' : '') +
      (r.hiddenN ? '<p class="lib-legend">非表示のアルバム ' + r.hiddenN + '枚は出していません（「曲」で表示すると、その曲も出ます）。</p>' : '') +
      '<p class="lib-legend">アルバムは、そのアルバムの中で一番新しく追加した曲の日付の順です。「新しい曲 3 / 12曲」は、この期間に追加した曲の数です。</p>' + legend;
    // □ラベル（最初のカードだけ）
    var c0 = body.querySelector('.ns-album-card .card-art-wrap');
    if (c0) c0.insertAdjacentHTML('beforeend', '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:4px;left:4px" onclick="copyUiLabel(\'新しいアルバムカード\', event)" title="クリックで「新しいアルバムカード」をコピー">□</span>');
    artObserve(body);
    return;
  }
  var list = getNewSongs();
  newSongsView.list = list;
  newSongsView.albums = [];
  countEl.textContent = list.length + '曲';
  if (!list.length) {
    body.innerHTML = '<div class="empty-msg">この期間に追加した曲はありません。' + (library.metaRunning ? '（曲情報を読み込み中です）' : '') + '</div>';
    return;
  }
  body.innerHTML = songTableHtml(list, { extra: { head: '追加日', cell: function (t) { return formatDateShort(t.firstSeen); } } }) + legend;
  artObserve(body);
}
// アルバムの曲一覧から「new songs に戻る」：そのカードの位置へ（v4.2）
function returnToNewSongsFromAlbum(ret) {
  showPage('newsongs');
  var idx = (newSongsView.albums || []).findIndex(function (x) { return x.key === ret.key; });
  restoreListPosition(idx >= 0 ? document.querySelector('#ns-body [data-ns-album="' + idx + '"]') : null, ret.scroll);
}
function initNewSongsPage() {
  document.getElementById('ns-mode').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-mode]'); if (!b) return;
    ui.newSongsMode = b.getAttribute('data-mode'); saveUi(); renderNewSongsPage(); window.scrollTo(0, 0);
  });
  document.getElementById('ns-days').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-days]'); if (!b) return;
    ui.newSongsDays = +b.getAttribute('data-days'); saveUi(); renderNewSongsPage();
  });
  document.getElementById('ns-limit').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-limit]'); if (!b) return;
    if (newSongsMode() === 'albums') ui.newAlbumLimit = +b.getAttribute('data-limit'); else ui.newSongsLimit = +b.getAttribute('data-limit');
    saveUi(); renderNewSongsPage();
  });
  var nsBody = document.getElementById('ns-body');
  // 新しいアルバムカード → album のアルバムの曲一覧（戻り先は new songs のこのカード）
  nsBody.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-ns-album]');
    if (!c) return;
    var a = (newSongsView.albums || [])[+c.getAttribute('data-ns-album')];
    if (!a) return;
    var ret = { page: 'newsongs', scroll: window.scrollY, newSince: _newSongsSince() };
    showPage('albums'); openAlbum(a, ret);
  });
  bindSongTable(nsBody, function () { return newSongsView.list; }, 'new songs');
  document.getElementById('ns-play').addEventListener('click', function () {
    var l = newSongsView.list; if (l.length) playQueue(l.map(function (t) { return t.path; }), 0, 'new songs');
  });
}

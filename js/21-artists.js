/* =========================================================
   21-artists.js ― 「artist」画面（v2.2）
   ・アーティスト一覧：アーティストカード（代表ジャケット・アーティスト名・アルバム数・曲数）のグリッド。検索あり
     並びは album と同じ文字の順番（英字→かな→その他、14-albums.js の albumTextKey / compareAlbumText）
   ・まとめ方：曲のアルバムアーティスト → 無ければアーティスト（タグ・アプリ内の上書きの値）。
     フォルダ名から推定したアーティストは使わず、アーティストのタグが無い曲は「アーティスト不明」にまとめて最後に置く
   ・代表ジャケット：初期値はそのアーティストの最初のアルバム（標準の並び）のジャケット。
     代表ジャケットの設定ダイアログで、そのアーティストのアルバムのジャケットから選ぶか、画像（ファイル・ドラッグ・貼り付け）を設定。
     アプリ内だけに保存（曲ファイルには書かない）。どのアルバムかの選択は db.artistCovers（バックアップに含む）、
     独自の画像は 13-artwork.js の userPic（キー artist:名前。画像が大きいのでバックアップには含めない）
   ・アーティストの画面：アルバムカード一覧と全曲の一覧、再生・シャッフル再生。ヘッダーに「アーティスト一覧に戻る」
   ・v3.3：playlist と同じ2列の作りにした
       左：アーティスト一覧（縦のリスト。小さな代表ジャケット・名前・アルバム数／曲数。選んでいる人を強調。
           右側をスクロールしても見えるように sticky、リストの中だけスクロールする）
       右：アーティストの内容（今までのアーティストの画面の中身）
     本文の幅が ARTIST_WIDE_MIN px より狭いとき（スマホ幅・歌詞パネルを開いた狭いウィンドウ）は1列：
       アーティスト一覧 → 押すとアーティストの内容に切り替わり、「アーティスト一覧に戻る」で戻る
     広いときは、選んでいないとき前回選んだアーティスト（ui.lastArtist）か先頭を自動で選び、「アーティスト一覧に戻る」は隠す
   ・v3.9：アーティストの Pin（28-pinned-artists.js）。アーティスト一覧の先頭に「Pin　〇人」の区切りと Pin したアーティスト、
       その下に「アーティスト　〇人」の区切りと通常の一覧。artistView.list は Pin→通常の順（行の data-artist の番号もこの順）
   ・v8.12.4：Pin したアーティストも通常の一覧に残す（Pin の区切りと通常の一覧の両方に出る。artistRowIndex() で行を探す）
   ========================================================= */
var ARTIST_WIDE_MIN = 640;   // 2列にする本文の幅（これより狭いと1列）

var UNKNOWN_ARTIST_LABEL = 'アーティスト不明';
var artistView = { query: '', open: null, list: [], current: null, songs: [], picUrls: {}, listScroll: 0, wide: true };

PAGE_RENDERERS.artists = renderArtistsPage;

function artistNameOf(t) { return t.tagAlbumArtist || t.tagArtist || ''; }

// アーティストにまとめる：{ name, tracks, albums（標準の並び）, cover（代表ジャケットにする曲）, custom }
function buildArtists() {
  var map = new Map();
  library.tracks.forEach(function (t) {
    var n = artistNameOf(t);
    if (!map.has(n)) map.set(n, { name: n, tracks: [], albumKeys: new Set() });
    var ar = map.get(n);
    ar.tracks.push(t);
    ar.albumKeys.add(albumKeyOf(t));
  });
  var albums = buildAlbums();
  _prepareAlbumSortKeys(albums);
  albums.sort(compareAlbumsStandard);
  var list = [];
  map.forEach(function (ar) {
    // 自分のアルバム（半分より多くの曲がこのアーティスト）を先に、コンピレーションなど曲ごとにアーティストが違うアルバムは「参加アルバム」として後に（v2.9）
    var own = [], guest = [];
    albums.forEach(function (a) {
      if (!ar.albumKeys.has(a.key)) return;
      if (!a.multiArtist) { own.push(a); return; }
      var mine = a.tracks.filter(function (t) { return artistNameOf(t) === ar.name; }).length;
      (mine * 2 > a.tracks.length ? own : guest).push(a);
    });
    ar.albums = own.concat(guest);
    ar.ownCount = own.length;
    var sel = db.artistCovers[ar.name];
    ar.custom = !!(sel && sel.custom);
    var chosen = sel && sel.album ? ar.albums.filter(function (a) { return a.key === sel.album; })[0] : null;
    ar.coverAlbum = chosen || ar.albums[0] || null;
    ar.cover = ar.coverAlbum ? ar.coverAlbum.cover : ar.tracks[0];
    ar._sk = albumTextKey(ar.name);
    list.push(ar);
  });
  list.sort(function (a, b) { return compareAlbumText(a._sk, b._sk); });   // 空（アーティスト不明）は最後
  return list;
}
function _artistLabel(name) { return name || UNKNOWN_ARTIST_LABEL; }

/* ---------- 代表ジャケットの表示 ---------- */
function _artistCoverHtml(ar, cls) {
  if (ar.custom) return '<span class="art-thumb ' + cls + ' art-none" data-artist-pic="' + escapeHtml(ar.name) + '">' + ICONS.user + '</span>';
  return artThumbHtml(ar.cover, cls);
}
// 独自の画像（userPic の artist:名前）を読み込んで差し込む
function _fillArtistPics(container) {
  container.querySelectorAll('[data-artist-pic]').forEach(function (el) {
    var name = el.getAttribute('data-artist-pic');
    var put = function (url) { if (url) { el.classList.remove('art-none'); el.innerHTML = '<img src="' + url + '" alt="">'; } };
    if (artistView.picUrls[name]) { put(artistView.picUrls[name]); return; }
    userPicGet('artist:' + name).then(function (rec) {
      if (!rec || !rec.blob) return;
      artistView.picUrls[name] = URL.createObjectURL(rec.blob);
      put(artistView.picUrls[name]);
    }).catch(function () { /* 無視 */ });
  });
}
function _forgetArtistPic(name) {
  if (artistView.picUrls[name]) { URL.revokeObjectURL(artistView.picUrls[name]); delete artistView.picUrls[name]; }
}

/* ---------- 描画 ---------- */
function _artistCountText(ar) {
  return (ar.ownCount ? 'アルバム ' + ar.ownCount + '枚' : '') + (ar.albums.length > ar.ownCount ? (ar.ownCount ? '・' : '') + '参加 ' + (ar.albums.length - ar.ownCount) + '枚' : '') + ' ・ ' + ar.tracks.length + '曲';
}
function renderArtistsPage() {
  var body = document.getElementById('art-body'), countEl = document.getElementById('art-count');
  var filterBar = document.getElementById('art-filter-bar'), back = document.getElementById('art-back-btn');
  back.hidden = true;
  if (!isConnected()) { body.innerHTML = welcomeCardHtml(); countEl.textContent = ''; filterBar.hidden = true; return; }
  if (!library.scanned) { body.innerHTML = '<div class="empty-msg">音楽フォルダを読み込んでいます…</div>'; filterBar.hidden = true; return; }
  var artists = buildArtists();
  countEl.textContent = artists.length + '人';
  var find = function (name) { for (var i = 0; i < artists.length; i++) if (artists[i].name === name) return artists[i]; return null; };
  // 2列にするか（本文の幅で決める。スマホ幅・歌詞パネルを開いた狭いウィンドウは1列）
  var wide = (body.clientWidth || window.innerWidth) >= ARTIST_WIDE_MIN;
  artistView.wide = wide;
  var sel = artistView.open !== null ? find(artistView.open) : null;
  if (!sel) artistView.open = null;
  if (!sel && wide && artists.length) {   // 広いとき：前回選んだアーティスト、無ければ先頭（Pin があれば Pin の先頭。v3.9）
    sel = (ui.lastArtist !== undefined && ui.lastArtist !== null ? find(ui.lastArtist) : null) || splitPinnedArtists(artists).pinned[0] || artists[0];
    artistView.open = sel.name;
  }
  back.hidden = wide || !sel;          // 「アーティスト一覧に戻る」は1列のときだけ
  filterBar.hidden = !wide && !!sel;   // 1列でアーティストの内容を見ている間は検索欄を隠す
  var q = artistView.query.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
  var list = terms.length ? artists.filter(function (ar) { var h = _artistLabel(ar.name).toLowerCase(); return terms.every(function (w) { return h.indexOf(w) >= 0; }); }) : artists;
  // Pin（v3.9）：先頭に並べる（検索中は合うものだけ）。
  //   v8.12.4：Pin したアーティストも通常の一覧に残す（artistView.list＝Pin＋通常の全部。同じ人が2回入るので、
  //   行は data-artist の番号で拾い、人数は通常の一覧の数で数える。artistView.pinnedN＝Pin の区切りの行数）
  var sp = splitPinnedArtists(list);
  var restN = list.length;
  list = sp.pinned.concat(list);
  artistView.list = list;
  artistView.pinnedN = sp.pinned.length;
  if (terms.length) countEl.textContent = restN + '人 / 全' + artists.length + '人';
  // 左：アーティスト一覧（縦のリスト）
  var oldPanel = body.querySelector('.art-list-panel');
  if (oldPanel) artistView.listScroll = oldPanel.scrollTop;
  var h = '<div class="art-layout ' + (wide ? 'is-wide' : 'is-narrow') + (sel ? ' has-detail' : '') + '">' +
    '<section class="panel art-list-panel" aria-label="アーティスト一覧">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'アーティスト一覧\', event)" title="クリックで「アーティスト一覧」をコピー">□</span>';
  if (!list.length) h += '<div class="empty-msg small">' + (artists.length ? '検索に当てはまるアーティストがいません。' : '曲が見つかりませんでした。') + '</div>';
  var labeledPin = false;
  list.forEach(function (ar, i) {
    if (sp.pinned.length && i === 0) {   // アーティストの Pin の区切り（v3.9）
      h += '<div class="art-section-head art-pin-head"><span class="album-section-icon">' + ICONS.pin + '</span>Pin<span class="album-section-count">' + sp.pinned.length + '人</span>' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:0;right:22px" onclick="copyUiLabel(\'アーティストの Pin の区切り\', event)" title="クリックで「アーティストの Pin の区切り」をコピー">□</span></div>';
    }
    if (sp.pinned.length && i === sp.pinned.length) {
      h += '<div class="art-section-head art-rest-head">アーティスト<span class="album-section-count">' + restN + '人</span></div>';   // v8.12.4：Pin も含めた人数
    }
    var active = sel && ar.name === sel.name;
    var pinned = i < sp.pinned.length;
    var withLabel = !labeledPin && !!ar.name; if (withLabel) labeledPin = true;   // □ラベルは最初のボタンだけ
    var pinDrag = pinned && sp.pinned.length > 1;   // Pin の区切りの中はドラッグで並べ替えられる（v4.1）
    h += '<button class="pl-item art-item' + (active ? ' active' : '') + (pinned ? ' is-pinned-artist' : '') + '" data-artist="' + i + '"' + (pinDrag ? ' draggable="true" data-apin-drag="1"' : '') +
      ' title="' + escapeHtml(_artistLabel(ar.name)) + (pinDrag ? '（ドラッグで Pin の中の順番を変えられます）' : '') + '"' + (active ? ' aria-current="true"' : '') + '>' +
      _artistCoverHtml(ar, 'art-item-thumb') +
      '<span class="art-item-text"><span class="art-item-name' + (ar.name ? '' : ' guessed') + '">' + escapeHtml(_artistLabel(ar.name)) + '</span>' +
      '<span class="art-item-meta">' + _artistCountText(ar) + '</span></span>' + artistPinBtnHtml(ar, i, withLabel) + '</button>';
  });
  if (artists.length && !artists[artists.length - 1].name) h += '<p class="lib-legend">「' + UNKNOWN_ARTIST_LABEL + '」は、アーティストのタグが無い曲です（フォルダ名からは推定しません）。曲情報の編集でアーティストを入れると、そのアーティストにまとまります。</p>';
  h += '</section>' +
    // 右：アーティストの内容
    '<section class="art-detail-panel" aria-label="アーティストの内容">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'アーティストの内容\', event)" title="クリックで「アーティストの内容」をコピー">□</span>' +
      '<div id="art-detail"></div></section></div>';
  body.innerHTML = h;
  var panel = body.querySelector('.art-list-panel');
  if (wide) {
    panel.scrollTop = artistView.listScroll || 0;
    panel.addEventListener('scroll', function () { artistView.listScroll = panel.scrollTop; }, { passive: true });
    // 選んでいるアーティストがリストの見える所に無ければ（リンク・戻るで来たときなど）、真ん中に来るようにする
    var act = panel.querySelector('.art-item.active');
    if (act && (act.offsetTop < panel.scrollTop || act.offsetTop + act.offsetHeight > panel.scrollTop + panel.clientHeight)) {
      panel.scrollTop = Math.max(0, act.offsetTop - panel.clientHeight / 2);
      artistView.listScroll = panel.scrollTop;
    }
  }
  if (sel) renderArtistDetail(sel, document.getElementById('art-detail'));
  else artistView.current = null;
  artObserve(body);
  _fillArtistPics(body);
}
// 本文の幅が 2列／1列 の境目をまたいだら描き直す（ウィンドウの大きさ・歌詞パネルの開け閉め）
function artistsRelayoutIfNeeded() {
  if (currentPage !== 'artists') return;
  var body = document.getElementById('art-body');
  if (!body || !body.querySelector('.art-layout')) return;
  var wide = body.clientWidth >= ARTIST_WIDE_MIN;
  if (wide !== artistView.wide) renderArtistsPage();
}
window.addEventListener('resize', debounce(artistsRelayoutIfNeeded, 150));

// アーティストの画面
function renderArtistDetail(ar, body) {
  artistView.current = ar;
  var songs = [];
  ar.albums.forEach(function (a) { a.tracks.forEach(function (t) { if (artistNameOf(t) === ar.name) songs.push(t); }); });
  artistView.songs = songs;
  var dur = songs.reduce(function (s, t) { return s + (t.duration || 0); }, 0);
  var h = '<div class="artist-detail">' +
    '<div class="album-head artist-head">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'アーティストの画面\', event)" title="クリックで「アーティストの画面」をコピー">□</span>' +
      // v2.8：アルバムの見出しと同じ並び（写真の右の列の一番上に名前）
      '<div class="album-head-art-wrap"><div class="album-head-art artist-head-art">' + _artistCoverHtml(ar, 'art-large') + '</div>' +
        // アーティストの見出しの Pin ボタン（v3.9。写真の左上。アルバムの見出しと同じ。「アーティスト不明」には付けない）
        (ar.name ? '<span class="head-art-pin-wrap"><button class="art-overlay-btn head-art-pin' + (isArtistPinned(ar.name) ? ' is-pinned' : '') + '" data-act="artist-pin" aria-pressed="' + isArtistPinned(ar.name) + '"' +
          ' title="' + (isArtistPinned(ar.name) ? 'Pin を外す（アーティスト一覧の先頭から外す）' : 'Pin する（アーティスト一覧の先頭に出す）') + '" aria-label="' + (isArtistPinned(ar.name) ? 'Pin を外す' : 'Pin する') + '">' + ICONS.pin + '</button>' +
          '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-12px;left:-2px" onclick="copyUiLabel(\'アーティストの見出しの Pin ボタン\', event)" title="クリックで「アーティストの見出しの Pin ボタン」をコピー">□</span></span>' : '') +
        (typeof artistWesternButtonHtml === 'function' ? artistWesternButtonHtml(ar) : '') +   // アーティストの洋楽の指定ボタン（v5.0。写真の右上）
      '</div>' +
        '<div class="album-head-info">' +
          '<h2 class="album-head-name artist-head-name">' + escapeHtml(_artistLabel(ar.name)) + '</h2>' +
          '<div class="album-head-meta">アーティスト ・ アルバム ' + ar.ownCount + '枚' + (ar.albums.length > ar.ownCount ? '（参加 ' + (ar.albums.length - ar.ownCount) + '枚）' : '') +
            ' ・ ' + songs.length + '曲' + (dur ? ' ・ ' + formatTotalDuration(dur) : '') + '</div>' +
          '<div class="btn-row">' +
            '<button class="btn-save" data-act="artist-play">' + ICONS.play + '再生</button>' +
            shuffleBtnHtml('data-act="artist-shuffle"', 'このアーティストの曲をばらばらの順で再生') +   // v7.5 からアイコンだけ
            '<button class="btn-inline-small" data-act="artist-cover">' + ICONS.image + '代表ジャケットを変更</button>' +
          '</div>' +
        '</div>' +
    '</div>' +
    (ar.ownCount ? '<h3 class="artist-section-title">アルバム</h3>' : '') +
    '<div class="album-grid artist-album-grid">';
  ar.albums.forEach(function (a, i) {
    if (i === ar.ownCount) {   // 参加アルバム（コンピレーションなど。v2.9）
      h += '</div><h3 class="artist-section-title">参加アルバム<span class="artist-section-sub">（コンピレーションなど、曲ごとにアーティストが違うアルバム）</span></h3>' +
        '<div class="album-grid artist-album-grid">';
    }
    var mine = a.multiArtist ? a.tracks.filter(function (t) { return artistNameOf(t) === ar.name; }).length : 0;
    h += '<button class="album-card" data-artist-album="' + i + '" title="' + escapeHtml(a.name) + '">' + albumCardArtHtml(a, { play: true, pin: true }) +   // カードのボタン（v3.5）
      '<span class="album-card-name' + (a.byFolder ? ' guessed' : '') + '">' + escapeHtml(a.name) + '</span>' +
      (i >= ar.ownCount ? '<span class="album-card-artist">' + escapeHtml(a.artist) + '</span>' : '') +
      '<span class="album-card-count" title="' + albumCardCountTitle(a, a.tracks.length + '曲' + (i >= ar.ownCount ? '（うち ' + mine + '曲）' : '')) + '">' + a.tracks.length + '曲' + (i >= ar.ownCount ? '（うち ' + mine + '曲）' : '') + albumCardGenreHtml(a) + '</span></button>';   // ジャンル・発売年（v4.6）
  });
  h += '</div><h3 class="artist-section-title">全曲</h3><div class="artist-songs">' + songTableHtml(songs) + '</div></div>';
  body.innerHTML = h;
  artObserve(body);
  _fillArtistPics(body);
  if (typeof fitAlbumHeadName === 'function') _fitNameIn(body.querySelector('.artist-head-name'));
}
function _fitNameIn(el) {
  if (!el || !el.clientWidth) return;
  var std = Math.min(ALBUM_NAME_MAX_PX, Math.max(ALBUM_NAME_STD_MIN_PX, Math.floor(el.clientWidth / ALBUM_NAME_CHARS)));   // アルバム名と同じ決まり（v2.8）
  el.style.fontSize = std + 'px';
  var size = std;
  while (size > ALBUM_NAME_MIN_PX && el.scrollWidth > el.clientWidth + 1) { size--; el.style.fontSize = size + 'px'; }
  el.title = el.textContent;
}

/* ---------- 操作 ---------- */
function openArtist(name) {
  artistView.ret = { scroll: window.scrollY, name: name };   // 一覧に戻ったとき、このカードの位置に戻す（v2.4）
  artistView.open = name;
  ui.lastArtist = name; saveUi();   // 次に artist を開いたとき（2列）に選んでおく（v3.3）
  renderArtistsPage();
  window.scrollTo(0, 0);
}
// アーティスト一覧の行の番号（data-artist）を名前で探す（v8.12.4）。Pin したアーティストは Pin の区切りと通常の一覧の2か所にあるので、
//   inPin＝true なら Pin の区切りの中、false なら通常の一覧の中を先に探す（無ければもう一方）
function artistRowIndex(name, inPin) {
  var l = artistView.list || [], n = artistView.pinnedN || 0, i;
  var from = inPin ? 0 : n, to = inPin ? n : l.length;
  for (i = from; i < to; i++) if (l[i] && l[i].name === name) return i;
  for (i = 0; i < l.length; i++) if (l[i] && l[i].name === name) return i;
  return -1;
}
function backToArtistList() {
  var ret = artistView.ret;
  artistView.open = null;
  artistView.ret = null;
  renderArtistsPage();
  if (!ret) return;
  var idx = artistRowIndex(ret.name, !!ret.fromPin);   // v8.12.4：開いた側（Pin の区切り／通常の一覧）の行へ
  restoreListPosition(idx >= 0 ? document.querySelector('#art-body [data-artist="' + idx + '"]') : null, ret.scroll);
}
// アーティストの画面から開いたアルバムの「戻る」：アーティストの画面の、そのアルバムのカードの位置へ（v2.4）
function returnToArtistFromAlbum(ret) {
  artistView.open = ret.artist;
  showPage('artists');
  var cur = artistView.current;
  var idx = cur ? cur.albums.findIndex(function (x) { return x.key === ret.key; }) : -1;
  restoreListPosition(idx >= 0 ? document.querySelector('#art-body [data-artist-album="' + idx + '"]') : null, ret.scroll);
}
function playArtist(shuffle) {
  var songs = artistView.songs;
  if (!songs.length) return;
  if (shuffle && !db.settings.shuffle) { db.settings.shuffle = true; saveDB(); if (typeof updatePlayerUi === 'function') updatePlayerUi(); }   // シャッフル再生はシャッフルをオンにして始める
  var start = shuffle ? Math.floor(Math.random() * songs.length) : 0;
  playQueue(songs.map(function (t) { return t.path; }), start, 'アーティスト：' + _artistLabel(artistView.current.name));
}

/* ---------- 代表ジャケットの設定ダイアログ ---------- */
async function openArtistCoverEditor(ar) {
  var st = { pic: null, newUrl: null, closed: false };
  var sel = db.artistCovers[ar.name];
  var h = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'代表ジャケットの設定ダイアログ\', event)" title="クリックで「代表ジャケットの設定ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">「' + escapeHtml(_artistLabel(ar.name)) + '」の代表ジャケットを選びます。アプリの中だけの設定で、曲ファイルは変わりません。</p>' +
    '<div class="ac-choices">' +
      '<label class="ac-choice"><input type="radio" name="ac" value="__default"' + (!sel ? ' checked' : '') + '><span class="ac-thumb">' + (ar.albums[0] ? artThumbHtml(ar.albums[0].cover, 'art-card') : '') + '</span><span class="ac-name">標準（最初のアルバム）</span></label>';
  ar.albums.forEach(function (a, i) {
    h += '<label class="ac-choice"><input type="radio" name="ac" value="a' + i + '"' + (sel && sel.album === a.key ? ' checked' : '') + '><span class="ac-thumb">' + artThumbHtml(a.cover, 'art-card') + '</span><span class="ac-name">' + escapeHtml(a.name) + '</span></label>';
  });
  h += '<label class="ac-choice ac-custom" id="ac-drop"><input type="radio" name="ac" value="__custom"' + (sel && sel.custom ? ' checked' : '') + '>' +
      '<span class="ac-thumb art-thumb art-card art-none" id="ac-custom-img" data-artist-pic="' + escapeHtml(sel && sel.custom ? ar.name : '') + '">' + ICONS.image + '</span>' +
      '<span class="ac-name">画像を設定<br><span class="dialog-hint">ドラッグ・Ctrl+V・下のボタン</span></span></label>' +
    '</div>' +
    '<div class="btn-row aw-pick-row"><button type="button" class="btn-inline-small" id="ac-pick">' + ICONS.image + '画像ファイルを選ぶ</button><input type="file" id="ac-file" accept="image/*" hidden></div>' +
    '<p class="dialog-hint">どのアルバムのジャケットにしたかはバックアップに含まれます。「画像を設定」で選んだ画像は、この PC のブラウザ内に保存し、画像が大きいため<strong>バックアップ（JSON）には含まれません</strong>。</p>' +
    '<div class="dialog-error" id="ac-error"></div>';
  var onPaste = null, choice = null;
  var v = await openDialog({
    title: '代表ジャケットの設定', body: h, size: 'large',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '保存', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (b) {
      artObserve(b);
      if (sel && sel.custom) _fillArtistPics(b);
      var err = b.querySelector('#ac-error');
      async function take(blob) {
        err.textContent = '';
        if (!blob) { err.textContent = '画像が見つかりませんでした。'; return; }
        try {
          var pic = await prepareArtworkImage(blob);
          if (st.closed) return;
          st.pic = pic;
          if (st.newUrl) URL.revokeObjectURL(st.newUrl);
          st.newUrl = URL.createObjectURL(new Blob([pic.bytes], { type: pic.mime }));
          var box = b.querySelector('#ac-custom-img'); box.classList.remove('art-none'); box.innerHTML = '<img src="' + st.newUrl + '" alt="">';
          b.querySelector('input[value="__custom"]').checked = true;
        } catch (e) { err.textContent = (e && e.message) || '画像を読めませんでした。'; }
      }
      var file = b.querySelector('#ac-file');
      b.querySelector('#ac-pick').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () { if (file.files && file.files[0]) take(file.files[0]); file.value = ''; });
      var drop = b.querySelector('#ac-drop');
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('drag-over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('drag-over'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; take(f || null); });
      onPaste = function (e) {
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); take(items[i].getAsFile()); return; }
      };
      document.addEventListener('paste', onPaste);
    },
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var r = b.querySelector('input[name="ac"]:checked');
      choice = r ? r.value : '__default';
      if (choice === '__custom' && !st.pic && !(sel && sel.custom)) { b.querySelector('#ac-error').textContent = '画像を選んでください（ドラッグ・Ctrl+V・「画像ファイルを選ぶ」）。'; return false; }
      return true;
    }
  });
  st.closed = true;
  if (onPaste) document.removeEventListener('paste', onPaste);
  if (st.newUrl) URL.revokeObjectURL(st.newUrl);
  if (v !== 'ok') return;
  try {
    if (choice === '__custom') {
      if (st.pic) await userPicSet('artist:' + ar.name, { blob: new Blob([st.pic.bytes], { type: st.pic.mime }), mime: st.pic.mime, width: st.pic.width, height: st.pic.height, at: Date.now() });
      db.artistCovers[ar.name] = { custom: true };
    } else {
      await userPicDelete('artist:' + ar.name).catch(function () {});
      if (choice === '__default') delete db.artistCovers[ar.name];
      else db.artistCovers[ar.name] = { album: ar.albums[+choice.slice(1)].key };
    }
  } catch (e) { await showAlert({ title: '保存できませんでした', message: escapeHtml((e && e.message) || String(e)) }); return; }
  _forgetArtistPic(ar.name);
  saveDB();
  renderArtistsPage();
  showToast('代表ジャケットを変更しました。');
}

/* ---------- 操作の受け付け ---------- */
function initArtistsPage() {
  var search = document.getElementById('art-search');
  search.addEventListener('input', debounce(function () { artistView.query = search.value; renderArtistsPage(); }, 180));
  var body = document.getElementById('art-body');
  // アーティストの Pin ボタン（v3.9）：行の中にあるので、行を選ぶより先に受け取る
  var pinFromRow = function (el) {
    var i0 = +el.getAttribute('data-art-pin'), ar = artistView.list[i0];
    if (!ar) return;
    var inPin = i0 < (artistView.pinnedN || 0);   // 押したのが Pin の区切りの行か（v8.12.4）
    togglePinArtist(ar, { undo: true });
    renderArtistsPage();
    var nb = document.querySelector('#art-body [data-art-pin="' + artistRowIndex(ar.name, inPin) + '"]');   // 押した行のボタンにフォーカスを戻す（キーボードで続けて操作できるように）
    if (nb && document.activeElement === document.body) { try { nb.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  };
  body.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var el = ev.target.closest && ev.target.closest('[data-art-pin]');
    if (!el || el !== ev.target) return;
    ev.preventDefault(); ev.stopPropagation();
    pinFromRow(el);
  });
  body.addEventListener('click', function (ev) {
    var pin = ev.target.closest('[data-art-pin]');
    if (pin) { ev.preventDefault(); pinFromRow(pin); return; }
    var card = ev.target.closest('[data-artist]');
    if (card) {
      var ci = +card.getAttribute('data-artist'), ar = artistView.list[ci];
      if (ar) { openArtist(ar.name); if (artistView.ret) artistView.ret.fromPin = ci < (artistView.pinnedN || 0); }   // fromPin：戻るとき Pin の行へ（v8.12.4）
      return;
    }
    var ac = ev.target.closest('[data-artist-album]');
    if (ac && artistView.current) {   // アルバムカード → 既存のアルバムの曲一覧へ
      var a = artistView.current.albums[+ac.getAttribute('data-artist-album')];
      if (a) {
        var ret = { page: 'artists', artist: artistView.current.name, artistLabel: _artistLabel(artistView.current.name), scroll: window.scrollY };
        showPage('albums'); openAlbum(a, ret);
      }
      return;
    }
    var b = ev.target.closest('[data-act]');
    if (!b || !artistView.current) return;
    var act = b.getAttribute('data-act');
    if (act === 'artist-play') playArtist(false);
    else if (act === 'artist-shuffle') playArtist(true);
    else if (act === 'artist-cover') openArtistCoverEditor(artistView.current);
    else if (act === 'artist-western') openWesternMenu('artist', artistView.current, b);   // v5.0
    else if (act === 'artist-pin') { togglePinArtist(artistView.current, { undo: true }); renderArtistsPage(); }   // v3.9
  });
  // Pin の区切りの中だけのドラッグ（v4.1）
  var apinFrom = null;
  body.addEventListener('dragstart', function (ev) {
    var r = ev.target.closest && ev.target.closest('[data-apin-drag]');
    if (!r) return;
    var ar = artistView.list[+r.getAttribute('data-artist')];
    apinFrom = ar ? ar.name : null;
    r.classList.add('dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'apin'); } catch (e) { /* 無視 */ }
  });
  body.addEventListener('dragover', function (ev) {
    var r = ev.target.closest && ev.target.closest('[data-apin-drag]');
    if (!r || apinFrom === null) return;
    ev.preventDefault();
    body.querySelectorAll('.art-item.drag-over').forEach(function (x) { if (x !== r) x.classList.remove('drag-over'); });
    r.classList.add('drag-over');
  });
  body.addEventListener('drop', function (ev) {
    var r = ev.target.closest && ev.target.closest('[data-apin-drag]');
    if (!r || apinFrom === null) return;
    ev.preventDefault();
    var to = artistView.list[+r.getAttribute('data-artist')], from = apinFrom;
    apinFrom = null;
    if (to && movePinnedArtistKey(from, to.name)) renderArtistsPage();
  });
  body.addEventListener('dragend', function () {
    apinFrom = null;
    body.querySelectorAll('.art-item.dragging, .art-item.drag-over').forEach(function (x) { x.classList.remove('dragging', 'drag-over'); });
  });
  bindSongTable(body, function () { return artistView.songs; }, function () { return 'アーティスト：' + (artistView.current ? _artistLabel(artistView.current.name) : ''); });
}

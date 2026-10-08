/* =========================================================
   38-album-groups.js ― album 一覧の「グループ表示」（v5.3）
   ・アルバムのフィルターバーの「グループの切り替え」：なし／タグ／ジャンル／年代（db.settings.albumGroup。バックアップに含む）
       タグ：tools の「アルバムのタグ」の並び順で「single 〇枚」「album 〇枚」…、最後に「タグなし 〇枚」
       ジャンル：アルバムの多い順、最後に「ジャンルなし」。年代：新しい順（「2020年代」）、最後に「発売年なし」
     グループの中の並びは並べ替えの設定（v4.0）のまま。空のグループは出さない（検索・絞り込みのあとで分ける）
   ・グループの見出し（タグのグループの見出しなど）を押すと折りたたむ／開く（この PC の見た目の設定 ui.albumGroupClosed）。「すべて開く」「すべて閉じる」
   ・Pin の区切りは今までどおり一番上。カスタム順の編集中・Pin のみ・非表示のアルバムを見ている間はグループにしない
   ・自動読み込み：開いているグループのカードを上から 200枚ずつ（続きは描き直して足す）。戻り位置：戻ったらそのカードのグループを開いて、その位置へ
   ・Western music には付けていない（洋楽だけの一覧なので、まずは album だけにした）
   ========================================================= */

var ALBUM_GROUP_MODES = [['none', 'なし'], ['sortkey', 'ソートキー（枠で囲む）'], ['tag', 'タグ'], ['genre', 'ジャンル'], ['decade', '年代']];   // sortkey は v5.4（ソートキーのまとまり）
function albumGroupMode() { var m = db.settings.albumGroup; return ALBUM_GROUP_MODES.some(function (x) { return x[0] === m; }) ? m : 'none'; }
function albumGroupActive(custom, pinOnly) { var m = albumGroupMode(); return m !== 'none' && m !== 'sortkey' && !custom && !pinOnly && !albView.showHidden; }
// ソートキーのまとまり（v5.4）を使うか
function albumClusterActive(custom, pinOnly) { return albumGroupMode() === 'sortkey' && !custom && !pinOnly && !albView.showHidden; }
function _grpClosedKey(k) { return albumGroupMode() + ':' + k; }
function albumGroupClosed(k) { return !!(ui.albumGroupClosed && ui.albumGroupClosed[_grpClosedKey(k)]); }
function setAlbumGroupClosed(k, closed) {
  if (!ui.albumGroupClosed || typeof ui.albumGroupClosed !== 'object') ui.albumGroupClosed = {};
  if (closed) ui.albumGroupClosed[_grpClosedKey(k)] = true; else delete ui.albumGroupClosed[_grpClosedKey(k)];
  saveUi();
}
// 並べ替えたあとの一覧をグループに分ける：[{ key, label, badge, albums }]（空のグループは入れない）
function albumGroupsOf(list) {
  var mode = albumGroupMode(), m = new Map(), none = [];
  var put = function (k, a) { var g = m.get(k); if (!g) { g = []; m.set(k, g); } g.push(a); };
  list.forEach(function (a) {
    if (mode === 'tag') { var t = albumTagOf(a.key); if (t) put(t.id, a); else none.push(a); }
    else if (mode === 'genre') { if (a.genre) put(a.genre, a); else none.push(a); }
    else if (mode === 'decade') { if (a.yearFirst) put(String(Math.floor(a.yearFirst / 10) * 10), a); else none.push(a); }
  });
  var out = [];
  if (mode === 'tag') {
    (db.albumTags || []).forEach(function (t) { var g = m.get(t.id); if (g) out.push({ key: t.id, label: t.name, badge: '<span class="album-tag-badge album-group-badge" style="--tag-c:' + albumTagColorHex(t.color) + '">' + escapeHtml(t.name) + '</span>', albums: g }); });
    if (none.length) out.push({ key: '__none', label: 'タグなし', badge: '', albums: none });
  } else if (mode === 'genre') {
    Array.from(m.keys()).sort(function (x, y) { return m.get(y).length - m.get(x).length || JA_COLLATOR.compare(x, y); })
      .forEach(function (k) { out.push({ key: k, label: k, badge: '', albums: m.get(k) }); });
    if (none.length) out.push({ key: '__none', label: 'ジャンルなし', badge: '', albums: none });
  } else if (mode === 'decade') {
    Array.from(m.keys()).sort(function (x, y) { return +y - +x; }).forEach(function (k) { out.push({ key: k, label: k + '年代', badge: '', albums: m.get(k) }); });
    if (none.length) out.push({ key: '__none', label: '発売年なし', badge: '', albums: none });
  }
  return out;
}
// グループ表示の本文（カードは開いているグループだけを、上から limit 枚まで）。{ html, openTotal, shown }
function albumGroupedHtml(groups, limit) {
  var h = '<div class="album-group-tools"><span class="album-group-caption">' + escapeHtml(ALBUM_GROUP_MODES.filter(function (x) { return x[0] === albumGroupMode(); })[0][1]) + 'でグループ表示 ・ ' + groups.length + 'グループ</span>' +
    '<button class="btn-inline-small" data-group-all="open">すべて開く</button><button class="btn-inline-small" data-group-all="close">すべて閉じる</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'グループ表示\', event)" title="クリックで「グループ表示」をコピー">□</span></div>';
  var idx = 0, shown = 0, openTotal = 0;
  groups.forEach(function (g, gi) {
    var closed = albumGroupClosed(g.key);
    h += '<section class="album-group' + (closed ? ' is-closed' : '') + '" data-group-sec="' + escapeHtml(g.key) + '">' +
      // v8.7.8：見出しの行に、グループの再生ボタン・グループのシャッフル再生ボタン（62-album-set-play.js）を並べる（折りたたむボタンの中には入れない）
      '<div class="album-group-headrow">' +
      '<button class="album-group-head" data-group-toggle="' + escapeHtml(g.key) + '" aria-expanded="' + !closed + '" title="押すと' + (closed ? '開く' : '折りたたむ') + '">' +
        '<span class="album-group-chev">' + ICONS.down + '</span>' + (g.badge || '<span class="album-group-label">' + escapeHtml(g.label) + '</span>') +
        '<span class="album-section-count">' + g.albums.length + '枚</span></button>' +
      (typeof albumSetPlayBtnsHtml === 'function' ? albumSetPlayBtnsHtml({ act: 'grp', kind: 'group', key: g.key, name: '「' + g.label + '」', btnName: 'グループ', albums: g.albums, labels: gi === 0 }) : '') +
      '</div>' +
      (gi === 0 ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:2px;right:0" onclick="copyUiLabel(\'グループの見出し\', event)" title="クリックで「グループの見出し」をコピー">□</span>' : '');
    if (!closed) {
      openTotal += g.albums.length;
      var cards = '';
      g.albums.forEach(function (a, k) { if (shown < limit) { cards += _albumCardHtml(a, idx + k, false, 0); shown++; } });
      h += '<div class="album-grid album-main-grid album-group-grid">' + cards + '</div>';
    }
    h += '</section>';
    idx += g.albums.length;
  });
  return { html: h, openTotal: openTotal, shown: shown };
}
// 戻ったとき：そのアルバムのグループを開き、そのカードまで描くよう枚数を合わせる。変えたら true
function albumGroupEnsureVisible(key) {
  var gs = albView.groups;
  if (!gs) return false;
  var changed = false, pos = 0;
  for (var i = 0; i < gs.length; i++) {
    var g = gs[i], j = g.albums.findIndex(function (a) { return a.key === key; });
    if (j < 0) { if (!albumGroupClosed(g.key)) pos += g.albums.length; continue; }
    if (albumGroupClosed(g.key)) { setAlbumGroupClosed(g.key, false); changed = true; }
    pos += j;
    if (pos >= albView.limit) { albView.limit = Math.ceil((pos + 1) / ALB_PAGE_SIZE) * ALB_PAGE_SIZE; changed = true; }
    return changed;
  }
  return false;
}
function renderAlbumGroupSelect() {
  var sel = document.getElementById('alb-group');
  if (!sel) return;
  var m = albumGroupMode();
  sel.innerHTML = ALBUM_GROUP_MODES.map(function (x) { return '<option value="' + x[0] + '">グループ：' + x[1] + '</option>'; }).join('');
  sel.value = m;
  sel.classList.toggle('active', m !== 'none');
}
function setAlbumGroupMode(v) {
  db.settings.albumGroup = v; saveDB();
  albView.limit = ALB_PAGE_SIZE;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}

/* ---------- ソートキーのまとまり（v5.4） ----------
   グループの切り替えで「ソートキー（枠で囲む）」を選ぶと、並べ替えの設定どおりの並びのまま、同じソートキーのアルバム（2枚以上）を、
   そのソートキーで一番先に出てくる位置に集めて、1つの枠（ソートキーの枠）で囲む。枠はグリッドの幅いっぱいの1ブロックで、中にカードを並べる。
   枠の背景と枠線は、ソートキーの文字から決まる色（ライト・ブラックで明るさを変える）。左上にソートキーと枚数のラベル。
   ソートキーが無いアルバム・同じソートキーが1枚だけのアルバムは、ふつうのカードのまま。比べるときは全角半角・大文字小文字・前後の空白を区別しない
   v5.5：枠を全部先に並べ、枠に入らないアルバムは「その他 〇枚」の見出しの下にまとめる（どちらも並べ替えの設定どおりの順） */
function _skClusterKey(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
// 並びを、ふつうのアルバムとまとまりの並びにする：[{ album } | { cluster: { key, label, albums } }]
function albumSortKeyClusters(list) {
  var byKey = new Map();
  list.forEach(function (a) { var k = _skClusterKey(a.sortKey || getAlbumSortKey(a.key)); if (!k) return; var g = byKey.get(k); if (!g) { g = []; byKey.set(k, g); } g.push(a); });
  // v5.5：枠（2枚以上のまとまり）を全部先に、そのあとに枠に入らないアルバム（1枚だけのソートキー・ソートキーなし）を並べる
  var done = new Set(), clusters = [], rest = [];
  list.forEach(function (a) {
    var k = _skClusterKey(a.sortKey || getAlbumSortKey(a.key)), g = k ? byKey.get(k) : null;
    if (!g || g.length < 2) { rest.push({ album: a }); return; }
    if (done.has(k)) return;
    done.add(k);
    clusters.push({ cluster: { key: k, label: a.sortKey || getAlbumSortKey(a.key), albums: g } });
  });
  return clusters.concat(rest);
}
// ソートキーから決まる色相（0〜359）
function _skHue(k) { var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360; return h; }
// 本文：上から limit 枚まで（まとまりは途中で切らない）。{ html, total, shown }
function albumClusterGridHtml(items, limit) {
  var h = '<div class="album-grid album-main-grid album-sk-grid">' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-14px;right:0" onclick="copyUiLabel(\'アルバム一覧\', event)" title="クリックで「アルバム一覧」をコピー">□</span>';
  var idx = 0, shown = 0, total = 0, labeled = false, restN = 0, headed = false;
  items.forEach(function (it) { total += it.cluster ? it.cluster.albums.length : 1; if (!it.cluster) restN++; });
  var hasCluster = items.length && !!items[0].cluster;
  for (var i = 0; i < items.length && shown < limit; i++) {
    var it = items[i];
    if (!it.cluster) {
      // 枠のあとの「その他 〇枚」の見出し（v5.5。枠が1つも無いときは出さない）
      if (hasCluster && !headed) {
        headed = true;
        h += '<div class="album-section-head album-sk-rest-head">その他<span class="album-section-count">' + restN + '枚</span>' +
          '<span class="ui-label-tag ui-label-tag-onlight" style="top:-6px;right:0" onclick="copyUiLabel(\'ソートキーの枠に入らないアルバム\', event)" title="クリックで「ソートキーの枠に入らないアルバム」をコピー">□</span></div>';
      }
      h += _albumCardHtml(it.album, idx, false, 0); idx++; shown++; continue;
    }
    var c = it.cluster;
    // v6.0：枠の背景に代表ジャケットを薄く敷く（42-sortkey-cover.js）。ラベルと右上の小さなボタンで代表ジャケットを選ぶ
    var bg = typeof skClusterBgHtml === 'function' ? skClusterBgHtml(c) : '', canPick = typeof openSkCoverPicker === 'function';
    h += '<section class="album-sk-cluster' + (bg ? ' has-sk-bg' : '') + '" style="--sk-h:' + _skHue(c.key) + '" aria-label="ソートキー「' + escapeHtml(c.label) + '」のアルバム ' + c.albums.length + '枚">' + bg +
      (canPick ? '<button type="button" class="album-sk-label" data-sk-cover="' + escapeHtml(c.key) + '" title="押すと代表ジャケット（枠の背景）を選べます">' : '<div class="album-sk-label">') +
        ICONS.tag + '<span class="album-sk-name">' + escapeHtml(c.label) + '</span><span class="album-sk-count">' + c.albums.length + '枚</span>' + (canPick ? '</button>' : '</div>') +
      (canPick ? skCoverButtonHtml(c, !labeled) : '') +
      // v8.7.8：ソートキーの再生ボタン・ソートキーのシャッフル再生ボタン（62-album-set-play.js。枠の右上、代表ジャケットを選ぶボタンの左）
      (typeof albumSetPlayBtnsHtml === 'function' ? '<span class="album-sk-play">' + albumSetPlayBtnsHtml({ act: 'grp', kind: 'sk', key: c.key, name: '「' + c.label + '」', btnName: 'ソートキー', albums: c.albums, labels: !labeled }) + '</span>' : '') +
      (!labeled ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:44px" onclick="copyUiLabel(\'ソートキーの枠\', event)" title="クリックで「ソートキーの枠」をコピー">□</span>' +
        (bg ? '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:4px;right:6px" onclick="copyUiLabel(\'ソートキーの枠の背景\', event)" title="クリックで「ソートキーの枠の背景」をコピー">□</span>' : '') : '') +
      '<div class="album-sk-cards">' + c.albums.map(function (a, k) { return _albumCardHtml(a, idx + k, false, 0); }).join('') + '</div></section>';
    labeled = true;
    idx += c.albums.length; shown += c.albums.length;
  }
  return { html: h + '</div>', total: total, shown: shown };
}

/* =========================================================
   44-playlist-add-albums.js ― プレイリストにアルバム追加（v6.9）・タブと並べ替え（v7.0）
   ・入口：プレイリストの曲の見出しの「連続再生」の右の「アルバム追加」ボタン（data-act="add-albums"）
   ・アルバム追加ダイアログ：上にタブ（アルバム／ソートキー／アーティスト／タグ）、検索欄・並べ替えの切り替え・件数、その下に一覧（チェック式）。
       アルバム：1枚ずつ。ソートキー：同じソートキー（全角半角・大文字小文字・空白をそろえる）のアルバム全部。
       アーティスト：artist 画面と同じまとめ方。そのアーティストのアルバム（自分のアルバム）全部と、参加アルバムの中のそのアーティストの曲。
       タグ：アルバムのタグごとのアルバム全部。
     タブをまたいでチェックでき、下の「選択中」はタブをまたいだ合計（重なる曲は1回だけ）。チェックした順の番号はタブをまたいで通し番号。
     非表示のアルバムはどのタブでも除き、枚数・曲数にも入れない（検索しても出さない）。1500枚でも軽いように 100件ずつ描く
   ・並べ替え：アルバム＝album の設定どおり／アルバム名／アーティスト／発売年（新しい順）／ソートキー／タグ、
     ほかのタブ＝名前順／枚数の多い順。最後に選んだタブと並べ替えは ui.paaTab・ui.paaSort に覚える
   ・全曲が入っているものは「追加済み」（チェックできない）、一部だけなら「一部追加済み（n/m曲）」
   ・追加：チェックした順に、各グループの中は album の並べ替えの設定どおりのアルバム順・曲順で、プレイリストの最後へ（入っている曲は重ねない）。
     トーストで何枚・何曲を出し、「元に戻す」で今回足した曲だけを外す
   ========================================================= */

var PAA_CHUNK = 100;
var PAA_TABS = [['album', 'アルバム'], ['sortkey', 'ソートキー'], ['artist', 'アーティスト'], ['tag', 'タグ']];
var PAA_SORTS = {
  album: [['setting', 'album の並び'], ['name', 'アルバム名'], ['artist', 'アーティスト'], ['year', '発売年（新しい順）'], ['sortkey', 'ソートキー'], ['tag', 'タグ']],
  group: [['name', '名前順'], ['count', '枚数の多い順']],
  tag: [['name', 'tools の順'], ['count', '枚数の多い順']]   // タグは tools の順が並べ替えの順
};

// 非表示を除いたアルバム（album の並べ替えの設定どおりの順）
function _paaAlbums() {
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var arr = buildAlbums().filter(function (a) { return !hs.has(a.key); });
  _prepareAlbumSortKeys(arr);
  var spec = albumSortSpec();
  arr.sort(spec.mode === 'custom' ? compareAlbumsStandard : albumComparatorFor(spec.fields));
  return arr;
}
// 各タブの項目：{ id, name, sub, albums（設定どおりの順）, paths（追加する曲の順）, cover }
function _paaBuild(base) {
  var pos = new Map(); base.forEach(function (a, i) { pos.set(a.key, i); });
  var mk = function (id, name, albums, paths) {
    albums.sort(function (x, y) { return pos.get(x.key) - pos.get(y.key); });
    return { id: id, name: name, albums: albums, paths: paths || [].concat.apply([], albums.map(function (a) { return a.tracks.map(function (t) { return t.path; }); })), cover: albums[0] ? albums[0].cover : null };
  };
  var out = { album: base.map(function (a) { var it = mk('a:' + a.key, a.name, [a]); it.sub = a.artist || ''; it.album = a; return it; }) };
  // ソートキー
  var sk = new Map();
  base.forEach(function (a) { var raw = getAlbumSortKey(a.key), k = typeof _skClusterKey === 'function' ? _skClusterKey(raw) : raw.toLowerCase(); if (!k) return; if (!sk.has(k)) sk.set(k, { label: raw, albums: [] }); sk.get(k).albums.push(a); });
  out.sortkey = []; sk.forEach(function (g, k) { out.sortkey.push(mk('s:' + k, g.label, g.albums)); });
  // アーティスト（artist 画面と同じまとめ方。参加アルバムはそのアーティストの曲だけ）
  out.artist = [];
  if (typeof buildArtists === 'function') {
    buildArtists().forEach(function (ar) {
      var albs = ar.albums.filter(function (a) { return pos.has(a.key); });
      if (!albs.length) return;
      albs.sort(function (x, y) { return pos.get(x.key) - pos.get(y.key); });
      var own = new Set(ar.albums.slice(0, ar.ownCount).map(function (a) { return a.key; })), paths = [];
      albs.forEach(function (a) { a.tracks.forEach(function (t) { if (own.has(a.key) || artistNameOf(t) === ar.name) paths.push(t.path); }); });
      var it = mk('r:' + ar.name, ar.name || UNKNOWN_ARTIST_LABEL, albs, paths);
      var guest = albs.filter(function (a) { return !own.has(a.key); }).length;
      it.sub = guest ? '参加アルバム ' + guest + '枚はこのアーティストの曲だけ' : '';
      out.artist.push(it);
    });
  }
  // タグ（tools の順）
  out.tag = [];
  (db.albumTags || []).forEach(function (tg) {
    var albs = base.filter(function (a) { var t = albumTagOf(a.key); return t && t.id === tg.id; });
    if (albs.length) { var it = mk('t:' + tg.id, tg.name, albs); it.tagColor = albumTagColorHex(tg.color); out.tag.push(it); }
  });
  return out;
}
function _paaSorted(tab, list, sort) {
  var l = list.slice();
  if (tab === 'album') {
    if (sort === 'setting') return l;
    var f = sort === 'year' ? [{ key: 'year', dir: 'desc' }] : [{ key: sort, dir: 'asc' }];
    var cmp = albumComparatorFor(f);
    return l.sort(function (x, y) { return cmp(x.album, y.album); });
  }
  if (sort === 'count') return l.sort(function (x, y) { return y.albums.length - x.albums.length || compareAlbumText(albumTextKey(x.name), albumTextKey(y.name)); });
  if (tab === 'tag') return l;   // tools の順
  return l.sort(function (x, y) { return compareAlbumText(albumTextKey(x.name), albumTextKey(y.name)); });
}

async function openAddAlbumsToPlaylist(id) {
  var p = getPlaylist(id);
  if (!p) return;
  if (!library.scanned || !library.tracks.length) { showToast('先に音楽フォルダを読み込んでください。', true); return; }
  var base = _paaAlbums(), data = _paaBuild(base), have = new Set(p.tracks), byId = {};
  Object.keys(data).forEach(function (k) { data[k].forEach(function (it) { it.n = it.paths.filter(function (x) { return have.has(x); }).length; byId[it.id] = it; }); });
  var tab = ui.paaTab && data[ui.paaTab] ? ui.paaTab : 'album';
  var sorts = Object.assign({}, ui.paaSort || {});
  var picked = [];          // チェックした順（項目の id。タブをまたぐ）
  var view = [], shown = 0, io = null, q = '';
  var body = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'アルバム追加ダイアログ\', event)" title="クリックで「アルバム追加ダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">「<strong>' + escapeHtml(p.name) + '</strong>」に追加するものにチェックを付けてください（いくつでも。タブをまたいで選べます）。チェックした順に、アルバムの曲順で最後に追加します。</p>' +
    '<div class="paa-tabs tab-row" role="tablist" aria-label="追加するものの種類">' + PAA_TABS.map(function (t) { return '<button type="button" class="tab-btn" role="tab" data-paa-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') +
      '<span class="ui-label-tag ui-label-tag-onlight" style="position:static;margin-left:4px" onclick="copyUiLabel(\'アルバム追加のタブ\', event)" title="クリックで「アルバム追加のタブ」をコピー">□</span></div>' +
    '<div class="paa-top"><div class="search-box paa-search"><span class="search-icon">' + ICONS.search + '</span>' +
      '<input type="search" id="paa-q" class="form-input" autocomplete="off" aria-label="アルバム追加の検索欄"></div>' +
      '<select class="form-input paa-sort" id="paa-sort" aria-label="アルバム追加の並べ替え"></select>' +
      '<span class="paa-count" id="paa-count"></span></div>' +
    '<div class="paa-list" id="paa-list" role="list"></div>' +
    '<div class="paa-picked" id="paa-picked"></div><div class="dialog-error" id="paa-error"></div>';
  var rowHtml = function (it) {
    var total = it.paths.length, full = it.n && it.n === total, at = picked.indexOf(it.id);
    var cnt = tab === 'album' ? total + '曲' : it.albums.length + '枚・' + total + '曲';
    var name = (it.tagColor ? '<span class="album-tag-badge" style="--tag-c:' + it.tagColor + '">' + escapeHtml(it.name) + '</span>' : escapeHtml(it.name));
    return '<label class="paa-row' + (full ? ' is-added' : '') + (at >= 0 ? ' is-on' : '') + '" role="listitem">' +
      '<input type="checkbox" data-paa="' + escapeHtml(it.id) + '"' + (full ? ' checked disabled' : at >= 0 ? ' checked' : '') + ' aria-label="' + escapeHtml(it.name) + '">' +
      artThumbHtml(it.cover, 'paa-art') +
      '<span class="paa-text"><span class="paa-name">' + name + '</span><span class="paa-sub">' + escapeHtml(it.sub || '') + '</span></span>' +
      (full ? '<span class="choice-added">追加済み</span>' : it.n ? '<span class="choice-added">一部追加済み（' + it.n + '/' + total + '曲）</span>' : '') +
      (at >= 0 ? '<span class="paa-order">' + (at + 1) + '</span>' : '') +
      '<span class="paa-n">' + cnt + '</span></label>';
  };
  var v = await openDialog({
    title: 'アルバム追加', body: body, size: 'large',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '追加', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (b) {
      var list = b.querySelector('#paa-list'), qi = b.querySelector('#paa-q'), sel = b.querySelector('#paa-sort'), timer = 0;
      var more = function () {
        if (io) { io.disconnect(); io = null; }
        var old = list.querySelector('.paa-more'); if (old) old.remove();
        var n = Math.min(view.length, shown + PAA_CHUNK), h = '';
        for (var k = shown; k < n; k++) h += rowHtml(view[k]);
        list.insertAdjacentHTML('beforeend', h);
        shown = n;
        artObserve(list);
        if (shown < view.length) {
          list.insertAdjacentHTML('beforeend', '<div class="paa-more">続きを読み込んでいます…（' + shown + ' / ' + view.length + '件）</div>');
          io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) more(); }, { root: list, rootMargin: '0px 0px 300px 0px' });
          io.observe(list.querySelector('.paa-more'));
        }
      };
      var draw = function () {
        var terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean), src = _paaSorted(tab, data[tab], sorts[tab]);
        view = terms.length ? src.filter(function (it) {
          var h = (it.name + ' ' + (it.sub || '') + ' ' + (tab === 'album' ? it.album.artists.join(' ') : '')).toLowerCase();
          return terms.every(function (w) { return h.indexOf(w) >= 0; });
        }) : src;
        list.innerHTML = view.length ? '' : '<div class="empty-msg small">' + (data[tab].length ? '当てはまるものがありません。' : tab === 'sortkey' ? 'ソートキーの付いたアルバムがありません。' : tab === 'tag' ? 'タグの付いたアルバムがありません。' : '項目がありません。') + '</div>';
        list.scrollTop = 0; shown = 0;
        if (view.length) more();
        var unit = tab === 'album' ? '枚' : '件';
        b.querySelector('#paa-count').textContent = terms.length ? view.length + unit + ' / 全' + data[tab].length + unit : data[tab].length + unit;
      };
      var setTab = function (t) {
        tab = t; ui.paaTab = t; saveUi();
        b.querySelectorAll('[data-paa-tab]').forEach(function (x) { var on = x.getAttribute('data-paa-tab') === t; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
        var opts = PAA_SORTS[t === 'album' ? 'album' : t === 'tag' ? 'tag' : 'group'];
        if (!opts.some(function (o) { return o[0] === sorts[t]; })) sorts[t] = opts[0][0];
        sel.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">並べ替え：' + o[1] + '</option>'; }).join('');
        sel.value = sorts[t];
        qi.placeholder = { album: 'アルバム名・アーティストで検索', sortkey: 'ソートキーで検索', artist: 'アーティストで検索', tag: 'タグで検索' }[t];
        draw();
      };
      var pickedUi = function () {
        var set = new Set(), albs = new Set();
        picked.forEach(function (pid) { var it = byId[pid]; it.paths.forEach(function (x) { if (!have.has(x)) set.add(x); }); it.albums.forEach(function (a) { albs.add(a.key); }); });
        b.querySelector('#paa-picked').innerHTML = picked.length ? '選択中：<strong>' + picked.length + '件</strong>（アルバム ' + albs.size + '枚・追加する曲 ' + set.size + '曲）' + ' <span class="dialog-hint">' + escapeHtml(picked.slice(0, 5).map(function (pid) { return byId[pid].name; }).join('、') + (picked.length > 5 ? ' ほか' : '')) + '</span>' : '<span class="dialog-hint">まだ選んでいません。</span>';
      };
      list.addEventListener('change', function (ev) {
        var c = ev.target; if (!c.hasAttribute('data-paa')) return;
        var pid = c.getAttribute('data-paa'), at = picked.indexOf(pid);
        if (c.checked && at < 0) picked.push(pid); else if (!c.checked && at >= 0) picked.splice(at, 1);
        list.querySelectorAll('input[data-paa]').forEach(function (x) {   // 番号を付け直す（見えている行だけ）
          var k = x.getAttribute('data-paa'), pos2 = picked.indexOf(k), row = x.closest('.paa-row'), o = row.querySelector('.paa-order');
          row.classList.toggle('is-on', pos2 >= 0);
          if (pos2 >= 0) { if (!o) { o = document.createElement('span'); o.className = 'paa-order'; row.insertBefore(o, row.querySelector('.paa-n')); } o.textContent = pos2 + 1; } else if (o) o.remove();
        });
        pickedUi();
      });
      b.querySelector('.paa-tabs').addEventListener('click', function (ev) { var t = ev.target.closest('[data-paa-tab]'); if (t) { qi.value = ''; q = ''; setTab(t.getAttribute('data-paa-tab')); } });
      sel.addEventListener('change', function () { sorts[tab] = sel.value; ui.paaSort = Object.assign({}, ui.paaSort || {}, sorts); saveUi(); draw(); });
      qi.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { q = qi.value; draw(); }, 150); });
      qi.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });
      setTab(tab); pickedUi();
      setTimeout(function () { qi.focus(); }, 40);
    },
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      if (!picked.length) { b.querySelector('#paa-error').textContent = '追加するものにチェックを付けてください。'; return false; }
      return true;
    }
  });
  if (io) { io.disconnect(); io = null; }
  if (v !== 'ok' || !picked.length) return;
  var paths = [], albsAll = new Set();
  picked.forEach(function (pid) { var it = byId[pid]; paths = paths.concat(it.paths); it.albums.forEach(function (a) { albsAll.add(a.key); }); });   // チェックした順・グループの中は設定どおり
  paths = paths.filter(function (x, i) { return paths.indexOf(x) === i; });   // 重なる曲は1回だけ（最初に出てきた位置）
  var before = new Set(p.tracks);
  var r = addTracksToPlaylist(p.id, paths);
  var added = []; var seen = new Set(); paths.forEach(function (x) { if (!before.has(x) && !seen.has(x)) { seen.add(x); added.push(x); } });
  renderSidebarCounts();
  if (currentPage === 'playlists') renderPlaylistsPage();
  if (typeof plpSyncQueue === 'function' && player.playlistId === p.id) plpSyncQueue(p.id);
  var addedSet = new Set(added), nA = 0;
  albsAll.forEach(function (k) { var a = base.find(function (x) { return x.key === k; }); if (a && a.tracks.some(function (t) { return addedSet.has(t.path); })) nA++; });
  showToast('「' + p.name + '」に ' + nA + '枚・' + r.added + '曲を追加しました' + (r.skipped ? '（' + r.skipped + '曲はすでに入っていたので追加していません）' : '') + '。', false, r.added ? { label: '元に戻す', fn: function () {
    var pp = getPlaylist(p.id); if (!pp) return;
    pp.tracks = pp.tracks.filter(function (x) { return !addedSet.has(x); });
    touchPlaylist(pp);
    renderSidebarCounts();
    if (currentPage === 'playlists') renderPlaylistsPage();
    if (typeof plpSyncQueue === 'function' && player.playlistId === pp.id) plpSyncQueue(pp.id);
    showToast('アルバム追加を取り消しました（' + added.length + '曲を外しました）。');
  } } : null);
}

(function () {
  var d = document.getElementById('pl-detail');
  if (!d) return;
  d.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-act="add-albums"]');
    if (!b || b.disabled) return;
    openAddAlbumsToPlaylist(ui.lastPlaylistId);
  });
})();

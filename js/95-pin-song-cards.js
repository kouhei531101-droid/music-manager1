/* =========================================================
   95-pin-song-cards.js ― Pin の曲のカード（スマホ版 v8.25.4。PC版 v8.7.82 の 87-pin-song-cards.js と同じ作り）
   ・Pin した曲（db.pinnedSongs。84-pinned-songs.js の「曲の Pin」と同じデータ。今までの Pin の曲はそのまま残り、カードにも出る）を、
     album の「Pin の区切り」の中に、Pin のアルバムのカードと同じ大きさ・同じ見た目のジャケットのカードで並べる
     （「Pin の曲のカード」。Pin のアルバムのカードのすぐ下。スマホ幅では Pin のアルバムと同じく1行の横スクロール）
       カード：その曲のジャケット・曲名・アーティスト名・「曲 ・ アルバム名」。ジャケットの右上に小さな音符の印（Pin の曲の印）で
       アルバムの Pin と見分ける。左上は Pin ボタン（押すと Pin を外す）、右下はカードの再生ボタン（Pin の曲をここから再生）
   ・カードを押すと、その曲のアルバムの曲一覧（アルバムの詳細の画面）を「Pin の曲だけの表示」で開く（その1曲の行だけを出す）。
     曲の行の上の「Pin の曲の表示の帯」の「アルバムの全曲を見る」で全曲に、「Pin の曲だけに戻す」で1曲に戻る。
     見出しの「アルバムを再生」などの操作は今までと同じ。「アルバム一覧に戻る」で、開いた Pin の曲のカードの位置へ戻る
   ・Pin する・外す：曲の長押しのメニューの「この曲を Pin 止め」「Pin を外す」（82-up-next.js。Pin の曲のカードを長押ししても出る）、
     アルバムの曲一覧・songs の曲の行の「曲の Pin ボタン」（84-pinned-songs.js の songPinBtnHtml）、Pin の曲のカードの Pin ボタン
   ・並べ替え：Pin の区切りの「並べ替え」→「Pin の並べ替えモード」でカードをドラッグ（72-pin-sort-drag.js。
     Pin の曲のカードは Pin の曲のカードの中だけで動く）。tools の「Pin の曲」の ↑ ↓ でも（同じ db.pinnedSongs の順）
   ・検索・絞り込み：アルバムが一覧に出ている曲と、検索の言葉が曲名などに合う曲だけを出す。非表示のアルバムの曲は出さない
   ・ファイル整理で場所が変わったときの付け替えは 84-pinned-songs.js。ファイルは触らない
   ========================================================= */

/* ---------- 一覧に出す Pin の曲 ---------- */
// 今の音楽フォルダにある Pin の曲（非表示のアルバムの曲は除く）：[{ t:曲, a:アルバム }]（Pin の順）
function pinSongEntries(albums) {
  var paths = pinnedSongList();
  if (!paths.length) return [];
  var want = new Set(paths), found = new Map();
  albums.forEach(function (a) { a.tracks.forEach(function (t) { if (want.has(t.path)) found.set(t.path, { t: t, a: a }); }); });
  if (!found.size) return [];
  var hs = typeof hiddenAlbumKeys === 'function' ? hiddenAlbumKeys() : new Set();
  var out = [];
  paths.forEach(function (p) { var x = found.get(p); if (x && !hs.has(x.a.key)) out.push(x); });
  return out;
}
function _pscText(t) { return (t.search || [t.title, t.artist, t.album].join(' ')).toLowerCase(); }
// 検索・絞り込みに合うものだけ。list：検索・絞り込みのあとのアルバム一覧
function pinSongFilter(entries, list) {
  var q = (albView.query || '').trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
  var other = (typeof albumTagFilter === 'function' && albumTagFilter()) || (typeof albumGenreFilter === 'function' && albumGenreFilter());
  if (!terms.length && !other) return entries.slice();
  var inList = new Set(list.map(function (a) { return a.key; }));
  return entries.filter(function (x) {
    if (inList.has(x.a.key)) return true;
    if (other || !terms.length) return false;
    var s = _pscText(x.t);
    return terms.every(function (w) { return s.indexOf(w) >= 0; });
  });
}

/* ---------- Pin の曲のカード ---------- */
function _pscIsCurrent(t) { return t.path === player.currentPath; }
function _pscPlayBtnHtml(t) {
  var cur = _pscIsCurrent(t), playing = cur && typeof _cardIsPlaying === 'function' && _cardIsPlaying();
  return '<span class="card-act card-act-play pin-song-play' + (cur ? ' is-current' : '') + '" role="button" tabindex="0" data-psc-act="play" data-state="' + (playing ? 'pause' : 'play') + '"' +
    ' title="' + (playing ? '一時停止' : cur ? '続きを再生' : 'この曲から Pin の曲を再生') + '" aria-label="' + (playing ? '一時停止' : 'この曲を再生') + '">' + (playing ? ICONS.pause : ICONS.play) + '</span>';
}
function pinSongCardHtml(x, i, total, sorting) {
  var t = x.t, a = x.a;
  var title = escapeHtml(t.title + (t.artist ? ' ／ ' + t.artist : '') + '（アルバム「' + a.name + '」の曲）');
  var lbl = function (name, style) { return i === 0 && !sorting ? '<span class="ui-label-tag ui-label-tag-onlight" style="' + style + '" onclick="copyUiLabel(\'' + name + '\', event)" title="クリックで「' + name + '」をコピー">□</span>' : ''; };
  var inner = '<span class="card-art-wrap">' + artThumbHtml(t, 'art-card') +
      // Pin の曲の印（右上の小さな音符。アルバムの Pin と見分ける）
      '<span class="pin-song-badge" title="Pin の曲（アルバムの中の1曲だけを Pin）" aria-hidden="true">' + ICONS.music + '</span>' +
      (sorting ? '' : '<span class="card-act card-act-pin is-pinned" role="button" tabindex="0" data-psc-act="unpin" aria-pressed="true" title="Pin を外す" aria-label="Pin を外す">' + ICONS.pin + '</span>' + _pscPlayBtnHtml(t)) +
      lbl('Pin の曲のカード', 'bottom:4px;left:4px') +
    '</span>' +
    '<span class="album-card-name">' + escapeHtml(t.title) + '</span>' +
    '<span class="album-card-artist">' + escapeHtml(t.artist || a.artist || '　') + '</span>' +
    '<span class="album-card-count pin-song-album" title="' + escapeHtml('アルバム「' + a.name + '」') + '">曲 ・ ' + escapeHtml(a.name) + '</span>';
  if (sorting) {
    return '<div class="album-card pin-sort-card pin-song-card" role="listitem" tabindex="0" data-pin-song="' + i + '" data-pin-key="' + escapeHtml(t.path) + '"' +
      ' title="' + title + '（ドラッグで並べ替え。キーボードは ← →）" aria-label="' + title + '（Pin の曲 ' + (i + 1) + ' / ' + total + '番目。← → で動かす）">' + inner + '</div>';
  }
  return '<button type="button" class="album-card pin-song-card" data-pin-song="' + i + '" data-path="' + escapeHtml(t.path) + '" title="' + title + '（押すとこの曲だけを表示）">' + inner + '</button>';
}
// Pin の曲のカードの並び（14-albums.js の Pin の区切りの中）
function pinSongGridHtml(list, sorting) {
  return '<div class="album-grid album-pin-grid pin-song-grid' + (sorting ? ' is-editing pin-sort-mode' : '') + '" aria-label="Pin の曲のカード"' + (sorting ? ' role="list"' : '') + '>' +
    list.map(function (x, i) { return pinSongCardHtml(x, i, list.length, sorting); }).join('') + '</div>';
}
// 並べ替えモードの並びの保存：見えている Pin の曲（paths）の並びを、db.pinnedSongs の中でそれらが入っていた位置に入れ直す
function applyPinnedSongOrderShown(paths) {
  var list = pinnedSongList().slice(), ks = new Set(paths), slots = [];
  list.forEach(function (p, i) { if (ks.has(p)) slots.push(i); });
  if (slots.length !== paths.length) return false;
  var changed = false;
  slots.forEach(function (pos, n) { if (list[pos] !== paths[n]) changed = true; list[pos] = paths[n]; });
  if (!changed) return false;
  db.pinnedSongs = list;
  if (typeof _pinnedSongSet !== 'undefined') _pinnedSongSet.src = null;
  saveDB();
  return true;
}
function _pscCardEl(path) {
  return Array.prototype.find.call(document.querySelectorAll('#alb-body .pin-song-card[data-pin-song]'), function (c) {
    var x = (albView.pinSongs || [])[+c.getAttribute('data-pin-song')];
    return x && x.t.path === path;
  }) || null;
}

/* ---------- カードを押したとき ---------- */
// Pin の曲のカードから開く：アルバムの曲一覧を「Pin の曲だけの表示」で
function openPinSongCard(i) {
  var x = (albView.pinSongs || [])[i];
  if (!x) return;
  albView.pinSongShowAll = false;
  openAlbum(x.a, { page: 'albums', scroll: window.scrollY, limit: albView.limit, pinSong: x.t.path, pinSongKey: x.a.key });
}
function _pscAct(el) {
  var card = el.closest('.pin-song-card');
  var x = card ? (albView.pinSongs || [])[+card.getAttribute('data-pin-song')] : null;
  if (!x) return;
  var act = el.getAttribute('data-psc-act');
  if (act === 'unpin') { if (isSongPinned(x.t.path)) togglePinSong(x.t.path); }
  else if (act === 'play') {
    if (_pscIsCurrent(x.t) && typeof togglePlay === 'function') { togglePlay(); return; }   // 再生中の曲：一時停止／再開
    var list = albView.pinSongs || [];
    playQueue(list.map(function (y) { return y.t.path; }), list.indexOf(x), 'Pin の曲');
  }
}
document.addEventListener('click', function (ev) {
  var el = ev.target.closest && ev.target.closest('[data-psc-act]');
  if (!el) return;
  ev.preventDefault(); ev.stopPropagation();   // カードは開かない
  _pscAct(el);
}, true);
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var el = ev.target.closest && ev.target.closest('[data-psc-act]');
  if (!el || el !== ev.target) return;
  ev.preventDefault(); ev.stopPropagation();
  _pscAct(el);
}, true);
(function () {
  var body = document.getElementById('alb-body');
  if (!body) return;
  body.addEventListener('click', function (ev) {
    // Pin の曲の表示の帯の「アルバムの全曲を見る」「Pin の曲だけに戻す」
    var v = ev.target.closest('[data-psc-view]');
    if (v) { albView.pinSongShowAll = v.getAttribute('data-psc-view') === 'all'; var y = window.scrollY; renderAlbumsPage(); window.scrollTo(0, y); return; }
    var card = ev.target.closest('.pin-song-card[data-pin-song]');
    if (!card || albView.pinSorting) return;
    openPinSongCard(+card.getAttribute('data-pin-song'));
  });
})();

/* ---------- アルバムの曲一覧の「Pin の曲だけの表示」 ---------- */
function _pscOpenPath(a) {
  var ret = albView.ret, p = ret && ret.page === 'albums' && ret.pinSong;
  if (!p || ret.key !== ret.pinSongKey || !a || !a.tracks.some(function (t) { return t.path === p; })) return null;
  return p;
}
function _pscDecorateDetail(a, body) {
  var p = _pscOpenPath(a);
  if (!p || !body) return;
  var detail = body.querySelector('.album-detail'), wrap = body.querySelector('.album-tracks-wrap');
  if (!detail || !wrap) return;
  var all = !!albView.pinSongShowAll, t = library.byPath[p];
  detail.classList.add('is-pin-song-view');
  detail.classList.toggle('is-pin-song-only', !all);
  body.querySelectorAll('.album-row').forEach(function (r) {
    var on = r.getAttribute('data-path') === p;
    r.classList.toggle('is-pin-song-row', on);
    r.classList.toggle('pin-song-other', !on && !all);
  });
  wrap.insertAdjacentHTML('beforebegin', '<div class="pin-song-bar" id="pin-song-bar">' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-8px;right:4px" onclick="copyUiLabel(\'Pin の曲の表示の帯\', event)" title="クリックで「Pin の曲の表示の帯」をコピー">□</span>' +
    '<span class="pin-song-bar-icon" aria-hidden="true">' + ICONS.music + '</span>' +
    '<span class="pin-song-bar-text">' + (all
      ? 'アルバムの全' + a.tracks.length + '曲を表示しています（Pin の曲「' + escapeHtml(t ? t.title : '') + '」は色付きの行）'
      : 'Pin の曲「' + escapeHtml(t ? t.title : '') + '」だけを表示しています（アルバムの全' + a.tracks.length + '曲のうち1曲）') + '</span>' +
    '<button type="button" class="btn-inline-small pin-song-bar-btn" data-psc-view="' + (all ? 'one' : 'all') + '">' + (all ? 'Pin の曲だけに戻す' : 'アルバムの全曲を見る') + '</button>' +
    '</div>');
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // 曲の長押しのメニュー（82-up-next.js）：Pin の曲のカードでも出す（並べ替えモードのカードは data-path が無いので出さない）
  if (typeof UPM_ROW_SEL === 'string') UPM_ROW_SEL += ', .pin-song-card[data-path]';
  // アルバムの曲一覧を描いたあと（69-album-head-mobile.js のあと）：Pin の曲だけの表示
  var rd = window.renderAlbumDetail;
  if (typeof rd === 'function') window.renderAlbumDetail = function (a, body) { var r = rd.apply(this, arguments); try { _pscDecorateDetail(a, body); } catch (e) { console.warn(e); } return r; };
  // アルバム一覧に戻る：Pin の曲のカードから開いたときは、そのカードの位置へ
  var bk = window.backToAlbumList;
  if (typeof bk === 'function') {
    window.backToAlbumList = function () {
      var ret = albView.ret, p = ret && ret.page === 'albums' && ret.pinSong && ret.key === ret.pinSongKey ? ret.pinSong : null;
      albView.pinSongShowAll = false;
      if (!p) return bk.apply(this, arguments);
      ret.key = '\u0000pin-song';   // 元の処理ではアルバムのカードを探さない（スクロールの位置だけ戻す）
      var r = bk.apply(this, arguments);
      var el = _pscCardEl(p);
      if (el) restoreListPosition(el, ret.scroll);
      return r;
    };
  }
  // カードの再生ボタンの形（27-card-actions.js）：Pin の曲のカードは曲で見る
  var uc = window.updateCardPlayButtons;
  if (typeof uc === 'function') {
    window.updateCardPlayButtons = function () {
      var r = uc.apply(this, arguments);
      try {
        document.querySelectorAll('#alb-body .pin-song-card[data-pin-song] .pin-song-play').forEach(function (b) {
          var x = (albView.pinSongs || [])[+b.closest('.pin-song-card').getAttribute('data-pin-song')];
          if (x) b.outerHTML = _pscPlayBtnHtml(x.t);
        });
      } catch (e) { console.warn(e); }
      return r;
    };
  }
})();

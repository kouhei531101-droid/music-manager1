/* =========================================================
   27-card-actions.js ― アルバムカードのボタン（v3.5）
   ・カードの再生ボタン（▷）：アルバムを曲順で最初から再生（「アルバムを再生」と同じ。シャッフルがオンなら今までの再生と同じ扱い）。
       再生中のアルバムのカードは一時停止のボタン（押すと一時停止／再開）になり、いつも見える
   ・カードの Pin ボタン：Pin する／外す（v3.4 の目印だったピンをボタンにした）。押したあとのトーストに「元に戻す」
   ・カードの非表示ボタン（v3.6。右上）：アルバムを非表示にする（v3.0 と同じ。トーストに「元に戻す」）。
       非表示のアルバムを見ているときは、同じ位置に「表示に戻す」（目のアイコン。いつも見える）。
       artist の「アーティストの内容」のカードには付けない（非表示は album の一覧だけに効くので、押しても見た目が変わらず分かりにくいため）
   ・カードは <button> なので、中のボタンは span[role=button]。押したときは document の捕まえる段階（capture）で受け取って止めるので、
     カードは開かない。キーボードでは Enter・スペース
   ・見せ方：マウスのある環境では、Pin 中のピンと再生中の ▷（一時停止）はいつも、そのほかはカードにマウスを乗せたとき・フォーカスしたときに出す。
     タッチの環境（hover が無い）ではいつも出す
   ・どこに出すか：album の一覧（Pin の区切りも）と、artist の「アーティストの内容」のアルバムカード（参加アルバムも）。
     カスタム順の編集中はボタンを出さない（ドラッグとぶつかるため。Pin 中の目印だけ）。非表示のアルバムを見ているときは再生だけ
   ========================================================= */

// 今再生している曲のアルバムの目印（無ければ ''）
function _cardCurrentAlbumKey() {
  var t = player.currentPath ? library.byPath[player.currentPath] : null;
  return t ? albumKeyOf(t) : '';
}
function _cardIsPlaying() { return !!(player.audio && !player.audio.paused && player.audio.getAttribute('src')); }

// カードのジャケット＋ボタン。opts：{ play, pin, hide:'hide'|'unhide'|false, labels }（出すボタン。labels：□ラベルを付ける＝一覧の最初のカード）。
// ボタンを出さないときも Pin 中の目印は出す
function albumCardArtHtml(a, opts) {
  opts = opts || {};
  var key = escapeHtml(a.key);
  var lbl = function (name, style) {
    return opts.labels ? '<span class="ui-label-tag ui-label-tag-onlight" style="' + style + '" onclick="copyUiLabel(\'' + name + '\', event)" title="クリックで「' + name + '」をコピー">□</span>' : '';
  };
  var pinned = typeof isAlbumPinned === 'function' && isAlbumPinned(a.key);
  var h = '<span class="card-art-wrap">' + artThumbHtml(a.cover, 'art-card');
  if (opts.pin) {
    h += '<span class="card-act card-act-pin' + (pinned ? ' is-pinned' : '') + '" role="button" tabindex="0" data-card-act="pin" data-card-key="' + key + '"' +
      ' aria-pressed="' + pinned + '" title="' + (pinned ? 'Pin を外す' : 'Pin する（album の一覧の先頭に出す）') + '" aria-label="' + (pinned ? 'Pin を外す' : 'Pin する') + '">' + ICONS.pin + '</span>';
  } else if (pinned) {
    h += '<span class="album-pin-mark" title="Pin 中">' + ICONS.pin + '</span>';
  }
  if (opts.hide) {   // カードの非表示ボタン（v3.6）
    var un = opts.hide === 'unhide';
    h += '<span class="card-act card-act-hide' + (un ? ' is-hidden-state' : '') + '" role="button" tabindex="0" data-card-act="' + (un ? 'unhide' : 'hide') + '" data-card-key="' + key + '"' +
      ' title="' + (un ? '表示に戻す（album の一覧に戻す）' : '非表示にする（album の一覧に出さない。ファイルは変わりません）') + '" aria-label="' + (un ? '表示に戻す' : '非表示にする') + '">' +
      (un ? ICONS.eye : ICONS.eyeOff) + '</span>';
  }
  if (opts.sortkey) {   // ソートキーボタン（v4.3。左下）
    var sk = typeof getAlbumSortKey === 'function' ? getAlbumSortKey(a.key) : '';
    h += '<span class="card-act card-act-sortkey' + (sk ? ' has-key' : '') + '" role="button" tabindex="0" data-card-act="sortkey" data-card-key="' + key + '"' +
      ' title="ソートキー・タグ（' + (sk ? 'ソートキー：' + escapeHtml(sk) + '。' : '') + '押すと変更）" aria-label="ソートキー・タグ' + (sk ? '：' + escapeHtml(sk) : '') + '">' + ICONS.tag + '</span>';
  }
  h += lbl('アルバムカード', opts.sortkey ? 'top:40px;left:50%' : 'bottom:4px;left:4px') + (opts.pin ? lbl('カードの Pin ボタン', 'top:40px;left:8px') : '') +
    (opts.sortkey ? lbl('ソートキー・タグボタン', 'bottom:40px;left:8px') : '') +
    (opts.hide ? lbl('カードの非表示ボタン', 'top:40px;right:8px') : '') + (opts.play ? lbl('カードの再生ボタン', 'bottom:52px;right:10px') : '');
  if (opts.play) {
    var cur = a.key === _cardCurrentAlbumKey(), playing = cur && _cardIsPlaying();
    h += '<span class="card-act card-act-play' + (cur ? ' is-current' : '') + '" role="button" tabindex="0" data-card-act="play" data-card-key="' + key + '"' +
      ' data-state="' + (playing ? 'pause' : 'play') + '" title="' + (playing ? '一時停止' : cur ? '続きを再生' : 'このアルバムを再生') + '" aria-label="' + (playing ? '一時停止' : 'このアルバムを再生') + '">' +
      (playing ? ICONS.pause : ICONS.play) + '</span>';
  }
  return h + '</span>';
}

// 画面に出ているアルバムから目印で探す（無ければ作り直して探す）
function _cardAlbumByKey(key) {
  var lists = [albView.pinned || [], albView.list || [], (typeof newSongsView !== 'undefined' && newSongsView.albums) || [], (typeof westernView !== 'undefined' && westernView.list) || []];
  if (artistView.current) lists.push(artistView.current.albums);
  for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (lists[i][j].key === key) return lists[i][j];
  var all = buildAlbums();
  for (var k = 0; k < all.length; k++) if (all[k].key === key) return all[k];
  return null;
}
function _cardAct(el) {
  var a = _cardAlbumByKey(el.getAttribute('data-card-key'));
  if (!a) return;
  var act = el.getAttribute('data-card-act');
  if (act === 'play') {
    if (a.key === _cardCurrentAlbumKey()) togglePlay();   // 再生中のアルバム：一時停止／再開
    else playAlbum(a, 0);
  } else if (act === 'pin') {
    togglePinAlbum(a, { undo: true });
    if (currentPage === 'albums') renderAlbumsPage();
    else if (currentPage === 'artists') renderArtistsPage();
    else if (currentPage === 'newsongs') renderNewSongsPage();   // new songs のアルバム表示（v4.2）
    else if (currentPage === 'western') renderWesternPage();   // Western music（v5.0）
  } else if (act === 'sortkey') {     // ソートキーの入力（v4.3）
    openSortKeyPopup(a, el);
  } else if (act === 'hide') {        // v3.6：v3.0 と同じ（一覧から外し、トーストに「元に戻す」）
    hideAlbum(a);
  } else if (act === 'unhide') {
    unhideAlbumFromUi(a.key, a.name);
  }
}
document.addEventListener('click', function (ev) {
  var el = ev.target.closest && ev.target.closest('[data-card-act]');
  if (!el) return;
  ev.preventDefault();
  ev.stopPropagation();   // カードは開かない
  _cardAct(el);
}, true);
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var el = ev.target.closest && ev.target.closest('[data-card-act]');
  if (!el || el !== ev.target) return;
  ev.preventDefault();
  ev.stopPropagation();
  _cardAct(el);
}, true);

// 再生・一時停止・曲が変わったとき：カードの再生ボタンの形を合わせる（06-player.js の updatePlayButtons から）
function updateCardPlayButtons() {
  var els = document.querySelectorAll('.card-act-play');
  if (!els.length) return;
  var curKey = _cardCurrentAlbumKey(), playing = _cardIsPlaying();
  els.forEach(function (el) {
    var cur = el.getAttribute('data-card-key') === curKey, st = cur && playing ? 'pause' : 'play';
    el.classList.toggle('is-current', cur);
    if (el.getAttribute('data-state') === st) return;
    el.setAttribute('data-state', st);
    el.innerHTML = st === 'pause' ? ICONS.pause : ICONS.play;
    el.title = st === 'pause' ? '一時停止' : cur ? '続きを再生' : 'このアルバムを再生';
    el.setAttribute('aria-label', st === 'pause' ? '一時停止' : 'このアルバムを再生');
  });
}

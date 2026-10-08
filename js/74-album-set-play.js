/* =========================================================
   74-album-set-play.js ― アルバムのまとまりの再生ボタン（スマホ版 v8.11。PC版 v8.7.8 の 62-album-set-play.js と同じ。スマホ版は ▷ もアイコンだけ〔style.css〕・再生を始めると再生画面が開く〔65-album-play-np.js の playQueue〕）
   ・album の一覧のまとまり（Pin の区切り・ソートキーの枠・グループ表示の各グループ）の見出しに、
     「再生」（▷ 再生）と「シャッフル再生」（シャッフルのアイコン）の2つのボタンを同じ見た目・同じ作りで置く
       Pin の区切り      ：Pin の再生ボタン／Pin のシャッフル再生ボタン（data-act="pin-play|pin-shuffle"。並べ替えモード中は押せない）
       ソートキーの枠    ：ソートキーの再生ボタン／ソートキーのシャッフル再生ボタン（data-act="grp-play|grp-shuffle" data-grp-kind="sk"）
       グループの見出し  ：グループの再生ボタン／グループのシャッフル再生ボタン（同 data-grp-kind="group"。タグ・ジャンル・年代）
   ・再生：まとまりの表示の順（並べ替えの設定・Pin の並べ替えのとおり）に、各アルバムの曲をアルバムの曲順どおりつなげて連続再生
     シャッフル再生：まとまりの全曲を曲単位で混ぜる（47-shuffle-play.js の shufflePlay：シャッフルをオンにし、最初の曲もばらばら）
     ※ 再生バーのシャッフルがオンのときは「再生」も混ざる（アルバムの「アルバムを再生」と同じ決まり）
   ・対象は、そのまとまりに今出ているアルバム（検索・タグやジャンルの絞り込みのあとの一覧から作ったまとまり。非表示のアルバムは入らない）。
     折りたたんだグループ・自動読み込みでまだ描いていないカードも、まとまりに入っていれば対象
   ・再生元の表示：「Pin のアルバム」「ソートキー：〇〇」「タグ：〇〇」「ジャンル：〇〇」「年代：〇〇」
   ========================================================= */

// 2つのボタンの HTML。o = { act:'pin'|'grp', kind, key, name（ボタンの名前の頭。例「Pin」）, albums, disabled, labels（□ラベルを付ける） }
function albumSetPlayBtnsHtml(o) {
  var n = o.albums.length, tn = o.albums.reduce(function (s, a) { return s + a.tracks.length; }, 0);
  var dis = o.disabled || !tn ? ' disabled' : '';
  var data = o.act === 'pin' ? '' : ' data-grp-kind="' + o.kind + '" data-grp-key="' + escapeHtml(o.key) + '"';
  var lbl = function (name) { return o.labels ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'' + name + '\', event)" title="クリックで「' + name + '」をコピー">□</span>' : ''; };
  var who = escapeHtml(o.name);
  return '<span class="set-play-btns">' +
    '<span class="set-play-wrap"><button type="button" class="btn-inline-small set-play-btn" data-act="' + o.act + '-play"' + data + dis +
      ' title="' + who + 'を再生：表示の順に、各アルバムを曲順どおりつなげて再生（' + n + '枚・' + tn + '曲）" aria-label="' + who + 'を再生">' + ICONS.play + '再生</button>' + lbl(o.btnName + 'の再生ボタン') + '</span>' +
    '<span class="set-play-wrap"><button type="button" class="btn-inline-small pl-icon-btn shuffle-play-btn set-shuffle-btn" data-act="' + o.act + '-shuffle"' + data + dis +
      ' title="' + who + 'をシャッフル再生：全曲（' + tn + '曲）をばらばらの順で再生（シャッフルをオンにします）" aria-label="' + who + 'をシャッフル再生">' + ICONS.shuffle + '</button>' + lbl(o.btnName + 'のシャッフル再生ボタン') + '</span>' +
    '</span>';
}
// アルバムの並び albums を、アルバムごとに曲順どおりつなげて再生（shuffle：曲単位で混ぜる）。label：再生元の表示
function playAlbumSet(albums, shuffle, label) {
  var paths = [];
  (albums || []).forEach(function (a) { a.tracks.forEach(function (t) { paths.push(t.path); }); });
  if (!paths.length) return false;
  var go = function () { playQueue(paths, 0, label); };
  if (shuffle) shufflePlay(go); else go();
  return true;
}
// Pin の区切り（見えている Pin。表示の順＝並べ替えた順）
function playPinnedAlbums(shuffle) { return playAlbumSet(albView.pinned || [], shuffle, 'Pin のアルバム'); }
// ソートキーの枠・グループの見出しのボタンから：そのまとまりを探して再生
function albumSetOf(kind, key) {
  if (kind === 'sk') {
    var it = (albView.clusters || []).filter(function (x) { return x.cluster && x.cluster.key === key; })[0];
    return it ? { albums: it.cluster.albums, label: 'ソートキー：' + it.cluster.label } : null;
  }
  if (kind === 'group') {
    var g = (albView.groups || []).filter(function (x) { return x.key === key; })[0];
    if (!g) return null;
    var mode = ALBUM_GROUP_MODES.filter(function (x) { return x[0] === albumGroupMode(); })[0];
    return { albums: g.albums, label: (mode ? mode[1] + '：' : '') + g.label };
  }
  return null;
}
function playAlbumSetFromBtn(btn, shuffle) {
  var s = albumSetOf(btn.getAttribute('data-grp-kind'), btn.getAttribute('data-grp-key'));
  if (s) playAlbumSet(s.albums, shuffle, s.label);
}

/* =========================================================
   32-genre-suggest.js ― ジャンルの候補（v4.5）
   ・曲情報の編集・アルバム情報の編集ダイアログの「ジャンル」欄の候補（datalist。自由入力も今までどおり）を、tools の「ジャンルの候補」で管理する
   ・保存：db.genreSuggest = ['J-Pop', 'Rock', ...]（並び＝候補の表示順。バックアップ・復元に含む）
     まだ無いとき（古いデータ）は、今までの自動の候補（音楽フォルダにあるジャンルを多い順＋よく使うもの）で、
     音楽フォルダを読み込んだあと最初に使うときに作る
   ・名前の変更・削除は候補の一覧だけを変える（曲ファイルのジャンルは書き換えない）
   ・ダイアログで一覧に無いジャンルを入れて保存したら、候補の最後に自動で足す
   ・「取り込む」：音楽フォルダにあって一覧に無いジャンルを、多い順に最後へ足す
   ========================================================= */

var GENRE_SUGGEST_MAX = 500;

// 音楽フォルダにあるジャンルと曲数・アルバム数
function _genreCounts() {
  var tracks = {}, albums = {};
  library.tracks.forEach(function (t) {
    var g = t.tagGenre;
    if (!g) return;
    tracks[g] = (tracks[g] || 0) + 1;
    (albums[g] = albums[g] || new Set()).add(albumKeyOf(t));
  });
  return { tracks: tracks, albums: albums };
}
// 今までの自動の候補（v3.2）：音楽フォルダにあるジャンル（多い順）＋よく使うもの
function autoGenreSuggest() {
  var c = _genreCounts().tracks;
  var list = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || JA_COLLATOR.compare(a, b); });
  var low = new Set(list.map(function (g) { return g.toLowerCase(); }));
  GENRE_SUGGEST.forEach(function (g) { if (!low.has(g.toLowerCase())) list.push(g); });
  return list.slice(0, GENRE_SUGGEST_MAX);
}
// 候補の一覧（無ければ自動の候補で作る。音楽フォルダを読み込む前は保存しない）
function genreSuggestList() {
  if (Array.isArray(db.genreSuggest)) return db.genreSuggest;
  var auto = autoGenreSuggest();
  if (library.scanned) { db.genreSuggest = auto; saveDB(); }
  return auto;
}
function _genreIndexOf(name) {
  var low = String(name).toLowerCase();
  return genreSuggestList().findIndex(function (g) { return g.toLowerCase() === low; });
}
// 候補に足す（同じ名前〔大文字小文字は区別しない〕があれば足さない）。足したら true
function addGenreSuggest(name, noSave) {
  var v = String(name || '').trim().slice(0, 60);
  if (!v || _genreIndexOf(v) >= 0) return false;
  var list = genreSuggestList().slice();
  if (list.length >= GENRE_SUGGEST_MAX) return false;
  list.push(v);
  db.genreSuggest = list;
  if (!noSave) saveDB();
  return true;
}
// 曲情報の編集で入れたジャンルのうち、一覧に無いものを足す（17-tag-edit.js の runTagEdit から）
function addGenreSuggestFrom(done) {
  var added = 0;
  done.forEach(function (d) { if (d.changes && d.changes.genre && addGenreSuggest(d.changes.genre, true)) added++; });
  if (added) saveDB();
  return added;
}

/* ---------- tools の「ジャンルの候補」 ---------- */
function renderSetGenreSuggest() {
  var el = document.getElementById('set-genre-suggest');
  if (!el) return;
  var list = genreSuggestList(), cnt = _genreCounts();
  var missing = Object.keys(cnt.tracks).filter(function (g) { return _genreIndexOf(g) < 0; });
  var h = '<p class="panel-meta">' + list.length + '個（上から順に、ジャンル欄の候補に出ます）' +
    (library.scanned ? '' : '　<span class="text-warn">音楽フォルダを読み込むと、使っている曲数が出ます</span>') + '</p>';
  if (list.length) {
    h += '<ul class="hidden-album-list genre-set-list">';
    list.forEach(function (g, i) {
      var nt = cnt.tracks[g] || 0, na = cnt.albums[g] ? cnt.albums[g].size : 0;
      h += '<li><span class="pinned-album-no">' + (i + 1) + '</span>' +
        '<input type="text" class="form-input genre-set-name" data-genre-name="' + i + '" value="' + escapeHtml(g) + '" maxlength="60" aria-label="ジャンルの候補「' + escapeHtml(g) + '」の名前">' +
        '<span class="hidden-album-sub">' + (nt ? nt + '曲・' + na + '枚' : '使っていない') + '</span>' +
        '<span class="pinned-album-btns">' +
          '<button class="btn-inline-small" data-genre-move="-1" data-i="' + i + '" title="1つ上へ" aria-label="「' + escapeHtml(g) + '」を1つ上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn-inline-small" data-genre-move="1" data-i="' + i + '" title="1つ下へ" aria-label="「' + escapeHtml(g) + '」を1つ下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn-inline-small" data-genre-del="' + i + '">削除</button></span></li>';
    });
    h += '</ul>';
  } else h += '<p class="panel-meta">候補はありません（ジャンル欄には自由に入れられます）。</p>';
  h += '<div class="btn-row tag-set-add"><input type="text" class="form-input" id="genre-set-new" maxlength="60" placeholder="新しいジャンル（例：City Pop）" aria-label="新しいジャンルの候補">' +
    '<button class="btn-inline-small" id="genre-set-add-btn">' + ICONS.plus + '追加</button>' +
    '<button class="btn-inline-small" id="genre-set-import"' + (missing.length ? '' : ' disabled') + ' title="音楽フォルダにあって一覧に無いジャンルを、多い順に最後へ足します">音楽フォルダから取り込む（' + missing.length + '個）</button></div>' +
    '<p class="dialog-hint">名前の変更・削除は候補の一覧だけを変えます（曲ファイルのジャンルは変わりません。曲のジャンルを変えるときは、曲情報の編集・アルバム情報の編集で）。ダイアログで一覧に無いジャンルを入れて保存すると、候補の最後に自動で足します。</p>' +
    '<div class="dialog-error" id="genre-set-error"></div>';
  el.innerHTML = h;
  var err = el.querySelector('#genre-set-error');
  var save = function (l) { db.genreSuggest = l; saveDB(); renderSetGenreSuggest(); };
  el.querySelectorAll('[data-genre-name]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var i = +inp.getAttribute('data-genre-name'), old = list[i], v = inp.value.trim().slice(0, 60);
      if (!v) { err.textContent = 'ジャンルの名前を入れてください。'; inp.value = old; return; }
      var j = _genreIndexOf(v);
      if (j >= 0 && j !== i) { err.textContent = '「' + v + '」は、もうあります。'; inp.value = old; return; }
      var l = list.slice(); l[i] = v; save(l);
      showToast('ジャンルの候補「' + old + '」を「' + v + '」にしました（曲ファイルのジャンルは変わりません）。');
    });
  });
  el.querySelectorAll('[data-genre-move]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = +b.getAttribute('data-i'), j = i + (+b.getAttribute('data-genre-move'));
      if (j < 0 || j >= list.length) return;
      var l = list.slice(), x = l[i]; l[i] = l[j]; l[j] = x; save(l);
      var nb = document.querySelector('#set-genre-suggest [data-genre-move="' + b.getAttribute('data-genre-move') + '"][data-i="' + j + '"]'); if (nb && !nb.disabled) nb.focus();
    });
  });
  el.querySelectorAll('[data-genre-del]').forEach(function (b) {
    b.addEventListener('click', async function () {
      var i = +b.getAttribute('data-genre-del'), g = list[i], nt = cnt.tracks[g] || 0;
      var ok = await showConfirm({ title: 'ジャンルの候補を削除', message: 'ジャンルの候補「' + escapeHtml(g) + '」を一覧から削除します。' +
        (nt ? '<br>このジャンルの曲（' + nt + '曲）のジャンルは変わりません（「取り込む」でまた候補に足せます）。' : ''), okText: '削除', danger: true });
      if (!ok) return;
      var l = genreSuggestList().filter(function (x) { return x !== g; }); save(l);
      showToast('ジャンルの候補「' + g + '」を削除しました。');
    });
  });
  var add = function () {
    var inp = el.querySelector('#genre-set-new'), v = inp.value.trim().slice(0, 60);
    if (!v) { err.textContent = 'ジャンルの名前を入れてください。'; return; }
    if (_genreIndexOf(v) >= 0) { err.textContent = '「' + v + '」は、もうあります。'; return; }
    if (!addGenreSuggest(v)) { err.textContent = '候補は ' + GENRE_SUGGEST_MAX + '個までです。'; return; }
    renderSetGenreSuggest(); showToast('ジャンルの候補「' + v + '」を追加しました。');
    var ni = document.getElementById('genre-set-new'); if (ni) ni.focus();
  };
  el.querySelector('#genre-set-add-btn').addEventListener('click', add);
  el.querySelector('#genre-set-new').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  el.querySelector('#genre-set-import').addEventListener('click', function () {
    var n = 0;
    missing.sort(function (a, b) { return cnt.tracks[b] - cnt.tracks[a]; }).forEach(function (g) { if (addGenreSuggest(g, true)) n++; });
    if (n) saveDB();
    renderSetGenreSuggest();
    showToast(n ? '音楽フォルダから ' + n + '個のジャンルを取り込みました。' : '取り込むジャンルはありません。');
  });
}

/* =========================================================
   33-album-genre.js ― アルバムカードのジャンル表示・ジャンルの絞り込み（v4.6）
   ・カードのジャンル：アルバムのジャンル（v3.1 の決まり：曲の数がいちばん多いもの。14-albums.js の _albumGenreYear()）と発売年を、
     カードの曲数の行に「10曲 ・ J-Pop ・ 2019」と続けて出す（アルバムの見出しと同じ並び。行を増やさないのでカードの高さは変わらない。
     長いと「…」、title で全文）。ジャンルも発売年も無ければ出さない。album の一覧（Pin の区切りも）と artist のカードに付ける
   ・ジャンルの絞り込み：アルバムのフィルターバー（タグの絞り込みの右）。「ジャンル：すべて／各ジャンル（アルバムの多い順）／ジャンルなし」。
     この PC の見た目の設定（ui.albumGenreFilter）。カスタム順の編集中は効かない（14-albums.js の getAlbumList()）
   ・並べ替えの項目「ジャンル」は 29-album-sort.js、検索でジャンル名でも見つかるのは 14-albums.js
   ========================================================= */

// カードの曲数の行に続けるジャンル・発売年（無ければ ''）
function albumCardGenreHtml(a) {
  var s = [a.genre, a.year].filter(Boolean).join(' ・ ');
  return s ? ' ・ <span class="album-card-genre">' + escapeHtml(s) + '</span>' : '';
}
function albumCardCountTitle(a, base) {
  var s = [a.genre, a.year].filter(Boolean).join(' ・ ');
  return escapeHtml(base + (s ? ' ・ ' + s : ''));
}

/* ---------- ジャンルの絞り込み ---------- */
// ui.albumGenreFilter：'' すべて／ジャンル名／'__none' ジャンルなし
function albumGenreFilter() { return ui.albumGenreFilter || ''; }
function albumMatchesGenreFilter(a, f) {
  if (!f) return true;
  return f === '__none' ? !a.genre : a.genre === f;
}
// 選べるジャンル（今の音楽フォルダのアルバムのジャンル。アルバムの多い順）
function renderAlbumGenreFilter(albums) {
  var sel = document.getElementById('alb-genre-filter');
  if (!sel) return;
  var cnt = {}, none = 0;
  albums.forEach(function (a) { if (a.genre) cnt[a.genre] = (cnt[a.genre] || 0) + 1; else none++; });
  var gs = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x] || JA_COLLATOR.compare(x, y); });
  var f = albumGenreFilter();
  if (f && f !== '__none' && !cnt[f]) gs.push(f);   // 今は無いジャンルを選んでいるときも、選んだまま見せる（0枚）
  sel.parentElement.hidden = !gs.length && !f;
  sel.innerHTML = '<option value="">ジャンル：すべて</option>' + gs.map(function (g) {
    return '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + '（' + (cnt[g] || 0) + '）</option>';
  }).join('') + '<option value="__none">ジャンルなし（' + none + '）</option>';
  sel.value = f;
  sel.classList.toggle('active', !!f);
  sel.title = f ? 'ジャンルで絞り込み中：' + (f === '__none' ? 'ジャンルなし' : f) : 'ジャンルで絞り込む';
}
function setAlbumGenreFilter(v) {
  ui.albumGenreFilter = v || ''; saveUi();
  albView.limit = ALB_PAGE_SIZE;
  renderAlbumsPage();
  window.scrollTo(0, 0);
}

/* =========================================================
   34-duplicates.js ― 重複チェック（v4.7。file 画面の「重複チェック」欄）
   ・調べ方（選べる）：
       name    ：曲名＋アーティストが同じ（大文字小文字・全角半角・空白の違いは同じとみなす）
       nameDur ：上に加えて、長さがほぼ同じ（±2秒）
       content ：ファイルの中身が同じ（まず大きさが同じもの同士だけを選び、中身を SHA-256 で比べる。重い）
     付記を無視する（「(Remastered)」「- 2019 Remaster」「[Bonus Track]」など、同じ録音の付記だけ。Live・Remix などは別の曲として残す）
     同じアルバムの中だけの重複は除く（別テイクなど。中身が同じで調べるときは除かない）／コンピレーション（曲ごとにアーティストが違うアルバム）の曲は除く
   ・16,200曲でも止まらないよう、少しずつ調べて進み具合を出す（中止できる）。曲ファイルは読むだけ
   ・結果：重複のグループごとに、曲名・アーティスト・アルバム・長さ・形式・ビットレート（大きさ÷長さのおおよそ）・大きさ・場所・追加日・再生回数。
     各曲の ▷ で聞き比べ。「残す曲」（初期は推奨：音質→再生回数→先に追加した曲。根拠を表示）
   ・整理：残さない曲を「削除フォルダ」へ移す（09-file-ops.js の runFileOperation。確認ダイアログ・元のフォルダ構成・操作履歴・元に戻す）。
     グループごと、またはまとめて。完全削除はしない。
     プレイリストの付け替え（初期はオン）：移した曲の入っていたプレイリストの場所を、残す曲に付け替える（同じプレイリストに残す曲が既にあれば、移した曲の分は外す）。
       元に戻すと、プレイリストも元に戻す（そのあと手で変えていなければ）
     再生回数・アプリ内の上書き・追加日は移した曲に付いたまま（元に戻すとそのまま戻るように）。入力した歌詞は、残す曲に無ければ写す
   ・重複ではない：グループに印を付けると、次から出さない（db.dupIgnore。バックアップに含む）。同じ曲がさらに増えたときは、また出す
   ========================================================= */

var dupView = { opts: null, running: false, cancel: false, groups: null, keep: {}, doneAt: 0, took: 0, stats: null };
var DUP_NOTE_RE = /\s*[\(\[（［【]([^\)\]）］】]*(remaster|リマスター|mono|stereo|モノラル|ステレオ|explicit|clean|bonus|ボーナス|album ver|single ver|original ver|radio edit|deluxe)[^\)\]）］】]*)[\)\]）］】]/gi;
var DUP_DASH_RE = /\s+[-–—]\s+([^-–—]*(remaster|リマスター|mono|stereo|explicit|bonus|album version|single version|radio edit)[^-–—]*)$/i;

function dupDefaultOpts() { return { mode: 'nameDur', ignoreNotes: true, excludeSameAlbum: true, excludeComp: false, relink: true }; }
function dupOpts() {
  var o = Object.assign(dupDefaultOpts(), ui.dupOpts || {});
  if (['name', 'nameDur', 'content'].indexOf(o.mode) < 0) o.mode = 'nameDur';
  return o;
}
// 比べるための文字：全角半角・大文字小文字・空白をそろえる（付記を無視するときは付記を取る）
function dupNormText(s, ignoreNotes) {
  var v = String(s || '').normalize('NFKC');
  if (ignoreNotes) { v = v.replace(DUP_NOTE_RE, ' ').replace(DUP_DASH_RE, ''); }
  return v.toLowerCase().replace(/[\s　]+/g, ' ').trim();
}
function _dupArtist(t) { return t.tagArtist || t.artist || ''; }

/* ---------- 重複ではない（印） ---------- */
function _dupIgnored(key, paths) {
  var list = db.dupIgnore || [];
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x.key !== key) continue;
    var set = new Set(x.paths);
    if (paths.every(function (p) { return set.has(p); })) return true;   // 印を付けたときの曲だけなら出さない（増えたらまた出す）
  }
  return false;
}
function markDupNotDuplicate(g) {
  db.dupIgnore = (db.dupIgnore || []).concat([{ key: g.key, paths: g.tracks.map(function (t) { return t.path; }), label: g.label, at: nowIso() }]);
  saveDB();
}
function clearDupIgnore() { db.dupIgnore = []; saveDB(); }

/* ---------- 調べる ---------- */
function _dupYield() { return new Promise(function (r) { setTimeout(r, 0); }); }
function _dupProgress(text, ratio) {
  var el = document.getElementById('dup-progress');
  if (!el) return;
  el.hidden = false;
  el.querySelector('.dup-progress-text').textContent = text;
  el.querySelector('.dup-progress-bar span').style.width = Math.round(Math.min(1, Math.max(0, ratio)) * 100) + '%';
}
async function _dupHash(t) {
  var fh = t.handle && t.handle.getFile ? t.handle : await getFileHandleByPath(t.path);
  var file = await fh.getFile();
  var buf = await file.arrayBuffer();
  var h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
}
async function runDuplicateCheck() {
  if (dupView.running) return;
  if (!isConnected() || !library.scanned) { showToast('先に音楽フォルダを読み込んでください。', true); return; }
  var o = dupOpts();
  dupView.running = true; dupView.cancel = false; dupView.groups = null; dupView.keep = {}; dupView.opts = o;
  renderDuplicatePanel();
  var t0 = performance.now(), tracks = library.tracks.slice(), n = tracks.length, buckets = new Map(), CH = 800;
  try {
    // 1. まとめる（名前、または大きさ）
    for (var i = 0; i < n; i++) {
      var t = tracks[i], k;
      if (o.mode === 'content') { if (!t.size) continue; k = 's' + t.size; }
      else {
        var ti = dupNormText(t.title, o.ignoreNotes), ar = dupNormText(_dupArtist(t), o.ignoreNotes);
        if (!ti) continue;
        k = ti + '\u0001' + ar;
      }
      var arr = buckets.get(k); if (arr) arr.push(t); else buckets.set(k, [t]);
      if (i % CH === CH - 1) { _dupProgress('曲を比べています… ' + (i + 1) + ' / ' + n + '曲', (i + 1) / n * (o.mode === 'content' ? 0.1 : 1)); await _dupYield(); if (dupView.cancel) throw 'cancel'; }
    }
    var cands = [];
    buckets.forEach(function (arr, k) { if (arr.length > 1) cands.push({ key: k, tracks: arr }); });
    // 2. 長さ（±2秒）で分ける
    if (o.mode === 'nameDur') {
      var split = [];
      cands.forEach(function (g) {
        var s = g.tracks.slice().sort(function (a, b) { return (a.duration || 0) - (b.duration || 0); }), cur = [s[0]];
        for (var j = 1; j < s.length; j++) {
          if (Math.abs((s[j].duration || 0) - (cur[cur.length - 1].duration || 0)) <= 2) cur.push(s[j]);
          else { if (cur.length > 1) split.push({ key: g.key + '\u0001' + Math.round(cur[0].duration || 0), tracks: cur }); cur = [s[j]]; }
        }
        if (cur.length > 1) split.push({ key: g.key + '\u0001' + Math.round(cur[0].duration || 0), tracks: cur });
      });
      cands = split;
    }
    // 3. 中身（同じ大きさの曲だけ読む）
    if (o.mode === 'content') {
      var total = cands.reduce(function (s, g) { return s + g.tracks.length; }, 0), readN = 0, byHash = [];
      for (var c = 0; c < cands.length; c++) {
        var hm = new Map();
        for (var m = 0; m < cands[c].tracks.length; m++) {
          var tr = cands[c].tracks[m], hsh;
          try { hsh = await _dupHash(tr); } catch (e) { hsh = null; }
          readN++;
          _dupProgress('ファイルの中身を比べています… ' + readN + ' / ' + total + '曲（大きさが同じ曲だけ）', 0.1 + 0.9 * readN / Math.max(1, total));
          if (dupView.cancel) throw 'cancel';
          if (!hsh) continue;
          var ha = hm.get(hsh); if (ha) ha.push(tr); else hm.set(hsh, [tr]);
        }
        hm.forEach(function (arr, h) { if (arr.length > 1) byHash.push({ key: 'h' + h, tracks: arr }); });
        await _dupYield();
      }
      cands = byHash;
    }
    // 4. 除外と印
    var albumOf = new Map(), compKeys = new Set();
    if (o.excludeComp) buildAlbums().forEach(function (a) { if (a.multiArtist) compKeys.add(a.key); });
    var groups = [], hiddenN = 0;
    cands.forEach(function (g) {
      var ts = g.tracks;
      if (o.excludeComp) ts = ts.filter(function (t) { return !compKeys.has(albumKeyOf(t)); });
      if (ts.length < 2) return;
      if (o.excludeSameAlbum && o.mode !== 'content') {   // 中身が同じ（ファイルの写し）は、同じアルバムの中でも重複として出す
        var ks = new Set(ts.map(function (t) { var k = albumOf.get(t.path); if (!k) { k = albumKeyOf(t); albumOf.set(t.path, k); } return k; }));
        if (ks.size < 2) return;
      }
      var gg = { key: g.key, tracks: ts, label: (ts[0].title || '') + ' ／ ' + (_dupArtist(ts[0]) || '（アーティスト無し）') };
      if (_dupIgnored(gg.key, ts.map(function (t) { return t.path; }))) { hiddenN++; return; }
      groups.push(gg);
    });
    groups.sort(function (a, b) { return JA_COLLATOR.compare(a.label, b.label); });
    groups.forEach(function (g) { g.rec = dupRecommend(g.tracks); dupView.keep[g.key] = g.rec.path; });
    dupView.groups = groups;
    dupView.stats = { hiddenN: hiddenN, tracks: n };
    dupView.took = Math.round(performance.now() - t0);
    dupView.doneAt = Date.now();
  } catch (e) {
    if (e !== 'cancel') { console.error(e); showToast('重複チェックを続けられませんでした：' + ((e && e.message) || e), true); }
    else showToast('重複チェックを中止しました。');
    dupView.groups = null;
  } finally {
    dupView.running = false;
    var p = document.getElementById('dup-progress'); if (p) p.hidden = true;
    renderDuplicatePanel();
  }
}

/* ---------- 残す曲の推奨 ---------- */
var DUP_LOSSLESS = { flac: 1, wav: 1, aiff: 1, aif: 1, alac: 1 };
function dupKbps(t) { return t.size && t.duration ? Math.round(t.size * 8 / t.duration / 1000) : 0; }
function _dupPlays(t) { var s = db.playStats && db.playStats[t.path]; return s ? (s.c || 0) : 0; }
// 推奨：① 劣化しない形式（FLAC・WAV など） ② ビットレート（32kbps 以上の差） ③ 再生回数 ④ 先に追加した曲 ⑤ 場所の文字の順
function dupRecommend(ts) {
  var cmp = function (a, b) {
    var la = DUP_LOSSLESS[a.ext] ? 1 : 0, lb = DUP_LOSSLESS[b.ext] ? 1 : 0;
    if (la !== lb) return { r: lb - la, why: '劣化しない形式（' + (la ? a : b).ext.toUpperCase() + '）' };
    var ka = dupKbps(a), kb = dupKbps(b);
    if (Math.abs(ka - kb) >= 32) return { r: kb - ka, why: '音質が一番よい（約' + Math.max(ka, kb) + 'kbps）' };
    var pa = _dupPlays(a), pb = _dupPlays(b);
    if (pa !== pb) return { r: pb - pa, why: '再生回数が一番多い（' + Math.max(pa, pb) + '回）' };
    var fa = a.firstSeen || 0, fb = b.firstSeen || 0;
    if (fa !== fb && fa && fb) return { r: fa - fb, why: '先に追加した曲' };
    return { r: a.path < b.path ? -1 : 1, why: '音質・再生回数が同じなので、場所の文字の順で先の曲' };
  };
  var best = ts[0], why = '';
  for (var i = 1; i < ts.length; i++) { var c = cmp(best, ts[i]); if (c.r > 0) { best = ts[i]; } }
  // 根拠：推奨の曲と、2番目の曲との違い
  var second = ts.filter(function (t) { return t !== best; }).sort(function (a, b) { return cmp(a, b).r; })[0];
  why = second ? cmp(best, second).why : '';
  return { path: best.path, why: why };
}

/* ---------- 画面 ---------- */
function _dupFmtSize(b) { return b ? (b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.round(b / 1024) + 'KB') : '—'; }
function renderDuplicatePanel() {
  var el = document.getElementById('dup-body');
  if (!el) return;
  var o = dupOpts();
  var h = '<div class="dup-options">' +
    '<div class="dup-opt-row" role="radiogroup" aria-label="重複の判定"><span class="dup-opt-cap">判定</span>' +
      [['name', '曲名＋アーティスト'], ['nameDur', '曲名＋アーティスト＋長さ（±2秒）'], ['content', 'ファイルの中身が同じ（重い）']].map(function (m) {
        return '<label class="dup-opt"><input type="radio" name="dup-mode" value="' + m[0] + '"' + (o.mode === m[0] ? ' checked' : '') + '>' + m[1] + '</label>';
      }).join('') + '</div>' +
    '<div class="dup-opt-row"><span class="dup-opt-cap">条件</span>' +
      '<label class="dup-opt"><input type="checkbox" data-dup-opt="ignoreNotes"' + (o.ignoreNotes ? ' checked' : '') + (o.mode === 'content' ? ' disabled' : '') + '>付記を無視（Remastered・Bonus Track など）</label>' +
      '<label class="dup-opt"><input type="checkbox" data-dup-opt="excludeSameAlbum"' + (o.excludeSameAlbum ? ' checked' : '') + (o.mode === 'content' ? ' disabled title="中身が同じファイル（写し）は、同じアルバムの中でも重複として出します"' : '') + '>同じアルバムの中だけの重複は除く</label>' +
      '<label class="dup-opt"><input type="checkbox" data-dup-opt="excludeComp"' + (o.excludeComp ? ' checked' : '') + '>コンピレーションの曲は除く</label></div>' +
    '<div class="btn-row"><button class="btn-save" id="dup-run"' + (dupView.running ? ' disabled' : '') + '>' + ICONS.search + '重複を調べる</button>' +
      (dupView.running ? '<button class="btn-cancel" id="dup-cancel">中止</button>' : '') +
      ((db.dupIgnore || []).length ? '<button class="btn-inline-small" id="dup-clear-ignore" title="「重複ではない」の印を全部外す">「重複ではない」の印（' + db.dupIgnore.length + '件）を外す</button>' : '') + '</div>' +
    '</div>' +
    '<div class="dup-progress" id="dup-progress"' + (dupView.running ? '' : ' hidden') + '><div class="dup-progress-bar"><span></span></div><div class="dup-progress-text">準備しています…</div></div>';
  var gs = dupView.groups;
  if (gs && !dupView.running) {
    var cnt = gs.reduce(function (s, g) { return s + g.tracks.length; }, 0), moveN = cnt - gs.length;
    h += '<div class="dup-summary"><strong>重複のグループ ' + gs.length + '件・' + cnt + '曲</strong>（' + dupView.stats.tracks + '曲を ' + (dupView.took / 1000).toFixed(1) + '秒で調べました' +
      (dupView.stats.hiddenN ? '。「重複ではない」の印で ' + dupView.stats.hiddenN + '件を出していません' : '') + '）</div>';
    if (gs.length) {
      h += '<div class="dup-bulk"><label class="dup-opt"><input type="checkbox" data-dup-opt="relink"' + (o.relink ? ' checked' : '') + '>プレイリストの曲を、残す曲に付け替える</label>' +
        '<button class="btn-inline-small dup-danger" id="dup-all">' + ICONS.trash + 'まとめて整理（残さない ' + moveN + '曲を削除フォルダへ）</button>' +
        '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-4px" onclick="copyUiLabel(\'まとめて整理\', event)" title="クリックで「まとめて整理」をコピー">□</span></div>';
      h += '<div class="dup-groups">';
      gs.forEach(function (g, gi) {
        var keep = dupView.keep[g.key];
        h += '<section class="dup-group" data-dup-g="' + gi + '">' +
          (gi === 0 ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'重複のグループ\', event)" title="クリックで「重複のグループ」をコピー">□</span>' : '') +
          '<div class="dup-group-head"><span class="dup-group-no">' + (gi + 1) + '</span><span class="dup-group-title">' + escapeHtml(g.label) + '</span><span class="dup-group-count">' + g.tracks.length + '曲</span>' +
            '<span class="dup-group-btns"><button class="btn-inline-small" data-dup-act="ignore" data-g="' + gi + '" title="このグループを次から出さない">重複ではない</button>' +
            '<button class="btn-inline-small dup-danger" data-dup-act="tidy" data-g="' + gi + '">' + ICONS.trash + 'このグループを整理</button></span></div>' +
          '<div class="dup-rec">推奨：' + escapeHtml(g.rec.why || '—') + '</div>' +
          '<div class="dup-table-wrap"><table class="lib-table dup-table"><thead><tr><th>残す</th><th></th><th class="dup-th-wide">曲名 ／ アーティスト</th><th class="dup-th-wide">アルバム</th><th>長さ</th><th>形式</th><th>ビットレート</th><th>大きさ</th><th>追加日</th><th>再生</th><th>場所</th></tr></thead><tbody>';
        g.tracks.forEach(function (t, ti) {
          var isKeep = t.path === keep, rec = t.path === g.rec.path;
          h += '<tr class="dup-row' + (isKeep ? ' is-keep' : ' is-move') + '">' +
            '<td class="dup-keep"><label title="この曲を残す"><input type="radio" name="dup-keep-' + gi + '" data-dup-keep="' + gi + '" data-t="' + ti + '"' + (isKeep ? ' checked' : '') + '>' +
              (isKeep ? '<span class="dup-keep-label">残す</span>' : '<span class="dup-move-label">移す</span>') + '</label>' + (rec ? '<span class="dup-rec-mark" title="推奨">推奨</span>' : '') + '</td>' +
            '<td><button class="btn-icon btn-play-row" data-dup-play="' + gi + '" data-t="' + ti + '" title="この曲を再生（聞き比べ）" aria-label="' + escapeHtml(t.title) + ' を再生">' + ICONS.play + '</button></td>' +
            '<td class="dup-title"><div class="lib-title">' + escapeHtml(t.title) + '</div><div class="song-sub">' + escapeHtml(_dupArtist(t) || '—') + '</div></td>' +
            '<td class="dup-album">' + escapeHtml(t.album || '—') + '</td>' +
            '<td>' + formatDuration(t.duration) + '</td><td>' + escapeHtml((t.ext || '').toUpperCase()) + '</td>' +
            '<td title="大きさ÷長さのおおよそ">' + (dupKbps(t) ? '約' + dupKbps(t) + 'kbps' : '—') + '</td><td>' + _dupFmtSize(t.size) + '</td>' +
            '<td>' + formatDateShort(t.firstSeen) + '</td><td>' + _dupPlays(t) + '回</td>' +
            '<td class="dup-path" title="' + escapeHtml(t.path) + '">' + escapeHtml(t.path) + '</td></tr>';
        });
        h += '</tbody></table></div></section>';
      });
      h += '</div>';
    } else h += '<p class="panel-meta">重複は見つかりませんでした。</p>';
  }
  el.innerHTML = h;
}
function _dupBindOnce() {
  var el = document.getElementById('dup-body');
  if (!el || el._dupBound) return;
  el._dupBound = true;
  el.addEventListener('change', function (ev) {
    var t = ev.target, o = dupOpts();
    if (t.name === 'dup-mode') { o.mode = t.value; ui.dupOpts = o; saveUi(); renderDuplicatePanel(); return; }
    var k = t.getAttribute && t.getAttribute('data-dup-opt');
    if (k) { o[k] = t.checked; ui.dupOpts = o; saveUi(); if (k !== 'relink') renderDuplicatePanel(); return; }
    var g = t.getAttribute && t.getAttribute('data-dup-keep');
    if (g !== null && g !== undefined) {
      var grp = dupView.groups[+g]; dupView.keep[grp.key] = grp.tracks[+t.getAttribute('data-t')].path;
      var sc = window.scrollY; renderDuplicatePanel(); window.scrollTo(0, sc);
      var r = el.querySelector('[data-dup-keep="' + g + '"][data-t="' + t.getAttribute('data-t') + '"]'); if (r) r.focus({ preventScroll: true });
    }
  });
  el.addEventListener('click', function (ev) {
    if (ev.target.closest('#dup-run')) { runDuplicateCheck(); return; }
    if (ev.target.closest('#dup-cancel')) { dupView.cancel = true; return; }
    if (ev.target.closest('#dup-clear-ignore')) {
      showConfirm({ title: '「重複ではない」の印を外す', message: db.dupIgnore.length + '件の印を外します（次に調べると、また重複として出ます）。', okText: '外す' }).then(function (ok) { if (ok) { clearDupIgnore(); renderDuplicatePanel(); showToast('「重複ではない」の印を外しました。'); } });
      return;
    }
    if (ev.target.closest('#dup-all')) { tidyDuplicateGroups(dupView.groups.slice()); return; }
    var pl = ev.target.closest('[data-dup-play]');
    if (pl) { var g0 = dupView.groups[+pl.getAttribute('data-dup-play')]; playQueue(g0.tracks.map(function (x) { return x.path; }), +pl.getAttribute('data-t'), '重複チェック'); return; }
    var b = ev.target.closest('[data-dup-act]');
    if (!b) return;
    var grp = dupView.groups[+b.getAttribute('data-g')];
    if (b.getAttribute('data-dup-act') === 'ignore') {
      markDupNotDuplicate(grp);
      dupView.groups = dupView.groups.filter(function (x) { return x !== grp; });
      dupView.stats.hiddenN++;
      var sc = window.scrollY; renderDuplicatePanel(); window.scrollTo(0, sc);
      showToast('「' + grp.label + '」を重複ではないとしました（次から出しません）。');
    } else tidyDuplicateGroups([grp]);
  });
}

/* ---------- 整理（残さない曲を削除フォルダへ） ---------- */
async function tidyDuplicateGroups(groups) {
  if (!groups.length) return;
  var plan = [], keepOf = {}, relink = dupOpts().relink;
  groups.forEach(function (g) {
    var keep = dupView.keep[g.key] || g.rec.path;
    g.tracks.forEach(function (t) { if (t.path !== keep) { plan.push({ from: t.path, to: TRASH_FOLDER_NAME + '/' + t.path }); keepOf[t.path] = keep; } });
  });
  if (!plan.length) return;
  // プレイリストの付け替えの準備（元に戻すときのために、今の並びを控える）
  var before = [], relinkN = 0;
  if (relink) db.playlists.forEach(function (p) {
    var hit = p.tracks.filter(function (x) { return keepOf[x]; }).length;
    if (hit) { before.push({ id: p.id, tracks: p.tracks.slice() }); relinkN += hit; }
  });
  await runFileOperation('trash', plan, {
    note: '重複の整理：' + groups.length + 'グループ',
    confirmExtra: '<br><strong>重複の整理</strong>：' + groups.length + 'グループで、残さない ' + plan.length + '曲を移します。' +
      (relink ? (relinkN ? 'プレイリストの ' + relinkN + 'か所を、残す曲に付け替えます。' : '') : 'プレイリストは付け替えません（移した曲は、プレイリストでは見つからない曲になります）。'),
    after: function (res, entry) {
      var movedFrom = {};
      res.done.forEach(function (d) { movedFrom[d.to] = d.from; });
      // 入力した歌詞：残す曲に無ければ写す（移した曲の分はそのまま残る）
      res.done.forEach(function (d) {
        var k = keepOf[d.from], ly = db.lyrics && db.lyrics[d.to];
        if (k && ly && !db.lyrics[k]) db.lyrics[k] = JSON.parse(JSON.stringify(ly));
      });
      if (relink && before.length && entry) {
        var recs = [];
        before.forEach(function (b0) {
          var p = db.playlists.find(function (x) { return x.id === b0.id; });
          if (!p) return;
          var out = [], seen = new Set(p.tracks.filter(function (x) { return !movedFrom[x]; }));
          p.tracks.forEach(function (x) {
            var orig = movedFrom[x];
            if (!orig) { out.push(x); return; }
            var k = keepOf[orig];
            if (seen.has(k)) return;   // 残す曲が既にある：移した曲の分は外す
            seen.add(k); out.push(k);
          });
          p.tracks = out; p.updatedAt = nowIso();
          recs.push({ id: p.id, before: b0.tracks, after: out.slice() });
        });
        entry.dupPlaylists = recs;
      }
      if (entry) entry.note = '重複の整理（' + groups.length + 'グループ）';
      saveDB();
      // 結果の一覧から、移した曲を外す
      var gone = new Set(res.done.map(function (d) { return d.from; }));
      if (dupView.groups) {
        dupView.groups = dupView.groups.map(function (g) { return Object.assign({}, g, { tracks: g.tracks.filter(function (t) { return !gone.has(t.path); }) }); })
          .filter(function (g) { return g.tracks.length > 1; });
      }
    }
  });
  renderDuplicatePanel();
}
// 元に戻したとき（09-file-ops.js の undoLastOperation から）：プレイリストを整理の前に戻す（そのあと手で変えていなければ）
function restoreDupPlaylists(entry) {
  (entry.dupPlaylists || []).forEach(function (r) {
    var p = db.playlists.find(function (x) { return x.id === r.id; });
    if (p && JSON.stringify(p.tracks) === JSON.stringify(r.after)) { p.tracks = r.before.slice(); p.updatedAt = nowIso(); }
  });
}

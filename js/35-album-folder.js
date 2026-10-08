/* =========================================================
   35-album-folder.js ― アルバムのフォルダを開く・場所をコピー（v4.8）
   ・ブラウザ（file://）からは Windows のエクスプローラーを直接開けないので、次の2つで手伝う
     「フォルダを開くボタン」（アルバムの見出しのボタン列。フォルダのアイコン）：file（ファイル整理）画面に移り、
        そのアルバムの曲が入っているフォルダを選んだ状態にする（フォルダ一覧でその位置までスクロールし、一瞬光らせる）。
        戻るボタン（v3.1）でアルバムの見出しに戻れる（showPage は 25-navigation.js で履歴に残る）
     「フォルダの場所をコピーボタン」（その右。コピーのアイコン）：音楽フォルダの場所（Windows のパス。tools の「音楽フォルダの場所」）
        ＋アルバムのフォルダの相対パス（区切りは \）をコピーし、エクスプローラーのアドレス欄に貼り付けるよう案内。
        場所が入っていなければ相対パスだけをコピーし、tools で入れるよう案内
   ・曲が複数のフォルダにまたがるアルバム（コンピレーションなど）は、どちらのボタンも小さなメニュー（フォルダの選択。曲数付き）を出す
   ・音楽フォルダの場所は、この PC 用の設定（ui.musicFolderWinPath。バックアップには入らない）
   ========================================================= */

// アルバムの曲が入っているフォルダ（曲の多い順）：[{ folder, n }]
function albumFolders(a) {
  var m = new Map();
  a.tracks.forEach(function (t) { m.set(t.folder, (m.get(t.folder) || 0) + 1); });
  return Array.from(m.entries()).map(function (e) { return { folder: e[0], n: e[1] }; })
    .sort(function (x, y) { return y.n - x.n || JA_COLLATOR.compare(x.folder, y.folder); });
}
function musicFolderWinPath() { return String(ui.musicFolderWinPath || '').trim(); }
function setMusicFolderWinPath(v) {
  var s = String(v || '').trim().replace(/^"+|"+$/g, '').replace(/\//g, '\\').replace(/\\+$/, '');
  ui.musicFolderWinPath = s; saveUi();
  return s;
}
// 音楽フォルダの中の相対パス（'' は音楽フォルダ直下）→ Windows のパス（場所が無ければ相対パス）
function folderWinPath(folder) {
  var rel = String(folder || '').replace(/\//g, '\\');
  var base = musicFolderWinPath();
  if (!base) return rel;
  return rel ? base + '\\' + rel : base;
}

/* ---------- file 画面で開く ---------- */
function openFolderInOrganizer(folder) {
  showPage('organizer');
  if (typeof orgSelectFolder === 'function') orgSelectFolder(folder);
  // フォルダ一覧の中で、そのフォルダが見える所へ（一覧の中だけをスクロール）し、一瞬光らせる
  var list = document.querySelector('#org-folders .org-folder-list');
  var btn = null;
  if (list) list.querySelectorAll('.org-folder').forEach(function (b) { if (b.getAttribute('data-folder') === folder) btn = b; });
  if (btn && list) {
    list.scrollTop = Math.max(0, btn.offsetTop - list.offsetTop - list.clientHeight / 2 + btn.offsetHeight / 2);
    btn.classList.remove('card-flash'); void btn.offsetWidth; btn.classList.add('card-flash');
    setTimeout(function () { btn.classList.remove('card-flash'); }, 1600);
    try { btn.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
  }
  // 画面は、フォルダの中身が見える所へ（スマホ幅では一覧の下に中身がある）
  var files = document.getElementById('org-files');
  if (files && (typeof isMobileLayout === 'function' ? isMobileLayout() : window.innerWidth <= 700)) files.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

/* ---------- 場所をコピー ---------- */
function copyFolderPath(folder) {
  var p = folderWinPath(folder), base = musicFolderWinPath();
  copyTextToClipboard(p || (fsa.folderName || ''));
  if (base) showToast('フォルダの場所「' + p + '」をコピーしました。エクスプローラーのアドレス欄に貼り付けてください。');
  else showToast('音楽フォルダの中の場所「' + (p || '（直下）') + '」をコピーしました。tools の「音楽フォルダの場所」に Windows のパスを入れると、エクスプローラーでそのまま開ける場所をコピーできます。', false,
    { label: 'tools を開く', fn: function () { showPage('settings'); var i = document.getElementById('set-win-path'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } } });
}

/* ---------- 見出しのボタン・フォルダの選択メニュー ---------- */
function albumFolderButtonsHtml(a) {
  var n = albumFolders(a).length;
  return '<span class="album-folder-btns">' +
    '<button class="btn-inline-small btn-icon-only" data-act="open-folder" title="このアルバムのフォルダを file で開く' + (n > 1 ? '（' + n + 'か所）' : '') + '" aria-label="このアルバムのフォルダを file で開く">' + ICONS.folder + '</button>' +
    '<button class="btn-inline-small btn-icon-only" data-act="copy-folder" title="このアルバムのフォルダの場所をコピー（エクスプローラーのアドレス欄に貼り付け）" aria-label="フォルダの場所をコピー">' + ICONS.copyPath + '</button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:-10px;right:-6px" onclick="copyUiLabel(\'フォルダを開くボタン\', event)" title="クリックで「フォルダを開くボタン」をコピー">□</span></span>';
}
var _folderMenu = null;
function closeFolderMenu() {
  var m = _folderMenu;
  if (!m) return;
  _folderMenu = null;
  document.removeEventListener('pointerdown', m.onDown, true);
  document.removeEventListener('keydown', m.onKey, true);
  m.el.remove();
  if (m.anchor && document.body.contains(m.anchor)) { try { m.anchor.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
// act：'open'（file で開く）／'copy'（場所をコピー）。フォルダが1つならすぐ実行、複数ならメニュー
function albumFolderAction(a, act, anchor) {
  var fs = albumFolders(a);
  if (!fs.length) return;
  if (fs.length === 1) { if (act === 'open') openFolderInOrganizer(fs[0].folder); else copyFolderPath(fs[0].folder); return; }
  closeFolderMenu();
  var el = document.createElement('div');
  el.className = 'sortkey-pop folder-menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'フォルダの選択');
  el.innerHTML = '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'フォルダの選択\', event)" title="クリックで「フォルダの選択」をコピー">□</span>' +
    '<div class="sortkey-pop-title">' + ICONS.folder + (act === 'open' ? 'file で開くフォルダ' : '場所をコピーするフォルダ') + '</div>' +
    '<div class="folder-menu-list">' + fs.map(function (f, i) {
      return '<button type="button" class="folder-menu-item" role="menuitem" data-fm="' + i + '" title="' + escapeHtml(folderWinPath(f.folder) || '（音楽フォルダの直下）') + '">' +
        '<span class="folder-menu-name">' + escapeHtml(f.folder || '（音楽フォルダの直下）') + '</span><span class="count-badge-sm">' + f.n + '曲</span></button>';
    }).join('') + '</div>';
  document.body.appendChild(el);
  var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, mg = 8;
  var top = r.bottom + 6; if (top + h > window.innerHeight - mg) top = r.top - h - 6;
  el.style.left = Math.round(Math.min(Math.max(mg, r.left), window.innerWidth - w - mg)) + 'px';
  el.style.top = Math.round(Math.min(Math.max(mg, top), window.innerHeight - h - mg)) + 'px';
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-fm]');
    if (!b) return;
    var f = fs[+b.getAttribute('data-fm')].folder;
    closeFolderMenu();
    if (act === 'open') openFolderInOrganizer(f); else copyFolderPath(f);
  });
  var onDown = function (ev) { if (!el.contains(ev.target)) closeFolderMenu(); };
  var onKey = function (ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeFolderMenu(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      var items = Array.from(el.querySelectorAll('[data-fm]')), i = items.indexOf(document.activeElement);
      ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  _folderMenu = { el: el, anchor: anchor, onDown: onDown, onKey: onKey };
  setTimeout(function () { var f0 = el.querySelector('[data-fm]'); if (f0) f0.focus(); }, 0);
}

/* ---------- tools の「音楽フォルダの場所」 ---------- */
function musicFolderWinPathHtml() {
  return '<div class="win-path-row"><span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:4px" onclick="copyUiLabel(\'音楽フォルダの場所\', event)" title="クリックで「音楽フォルダの場所」をコピー">□</span>' +
    '<label for="set-win-path" class="win-path-label">音楽フォルダの場所（Windows のパス）</label>' +
    '<input type="text" class="form-input" id="set-win-path" value="' + escapeHtml(musicFolderWinPath()) + '" placeholder="例：C:\\Users\\あなた\\Music\\iTunes\\iTunes Media" autocomplete="off" spellcheck="false" onchange="this.value = setMusicFolderWinPath(this.value); showToast(this.value ? \'音楽フォルダの場所を保存しました。\' : \'音楽フォルダの場所を空にしました。\')">' +
    '<p class="panel-desc">ブラウザからは音楽フォルダの本当の場所が分からないため、一度だけ入れてください（エクスプローラーでフォルダを開き、アドレス欄の文字をコピーして貼り付け）。アルバムの見出しの「フォルダの場所をコピー」で、エクスプローラーでそのまま開ける場所をコピーできます。この PC 用の設定で、バックアップには入りません。</p></div>';
}

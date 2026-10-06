/* =========================================================
   12-init.js ― 起動処理（必ず最後に読み込む）
   ========================================================= */

(async function initApp() {
  // v8.2：プレイリスト・操作履歴などを大きな保存場所（IndexedDB）から読み、古い形なら移してから画面を作る（52-data-store.js）
  if (typeof dbStoreStart === 'function') await dbStoreStart();

  applyIcons(document);
  var vl = document.getElementById('app-version-label');
  if (vl) vl.textContent = APP_VERSION;

  // サイドバーのメニュー項目
  document.querySelectorAll('.nav-item').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      showPage(a.getAttribute('data-page'));
    });
  });

  initAlbumsPage();
  initArtistsPage();
  initNewSongsPage();
  initHeavyPage();
  if (typeof initWesternPage === 'function') initWesternPage();   // Western music（v5.0）
  if (typeof initSeasonsPage === 'function') initSeasonsPage();   // Seasons Song（v7.4）
  if (typeof initUpbeatPage === 'function') initUpbeatPage();   // upbeat music（v7.8）
  initLibraryPage();
  initPlaylistsPage();
  initOrganizerPage();
  applyUiLabelSetting();
  initPlayer();
  initLyrics();

  if (!fsa.supported) fsa.state = 'unsupported';
  renderConnectionStatus();
  renderSidebarCounts();
  showPage(ui.lastPage || 'library');

  // 前回の音楽フォルダを探して、許可があれば読み込む
  initFolderAccess();

  // 別のタブで同じアプリを開いて変更したときは、最新のデータを読み直す
  window.addEventListener('storage', function (ev) {
    if (typeof dbStoreOnStorageEvent === 'function') { dbStoreOnStorageEvent(ev); return; }   // v8.2
    if (ev.key !== DB_KEY || !ev.newValue) return;
    var d = loadDB();
    if (d) { db = d; renderAll(); }
  });
})();

/* =========================================================
   92-tools-groups.js ― tools 画面の「グループ」と折りたたみ（スマホ版 v8.24.4。PC版 82-tools-groups.js と同じ作り）
   ・tools（#page-settings）の欄を、グループ（.set-group）にまとめてある（index.html）
       音楽フォルダ（folder）／バックアップと復元（backup）／表示の設定（display）／再生と再生画面（play）／
       Pin（pin）／アルバムの分類（album）／特集画面の設定（special）／記録と保存容量（data）
   ・グループの見出し（.set-group-head）を押すと開く／閉じる。上の「すべて開く」「すべて閉じる」でまとめて
   ・開き閉じは見た目の設定として musicManager_ui の toolsGroups（{ グループのid: true／false }）に保存する。
     バックアップには入れない。保存が無いグループは TOOLS_GROUPS_DEFAULT（最初は音楽フォルダ・バックアップと復元だけ開く）
   ・ほかの画面から tools の欄へ飛ぶときは revealToolsGroupOf(要素) でその欄のグループを開いてから動かす
   ========================================================= */

// 最初（保存が無いとき）に開いておくグループ
var TOOLS_GROUPS_DEFAULT = { folder: true, backup: true };

// そのグループが開いているか（保存 → 無ければ最初の決まり）
function toolsGroupIsOpen(id) {
  var s = ui.toolsGroups;
  if (s && typeof s[id] === 'boolean') return s[id];
  return !!TOOLS_GROUPS_DEFAULT[id];
}

// 1つのグループの見た目を開く／閉じるにする（保存はしない）
function _toolsGroupShow(g, open) {
  g.classList.toggle('is-open', open);
  var b = g.querySelector('.set-group-head');
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// 保存してある開き閉じを全部のグループに当てる（読み込んだとき）
function applyToolsGroups() {
  document.querySelectorAll('#page-settings .set-group').forEach(function (g) {
    _toolsGroupShow(g, toolsGroupIsOpen(g.getAttribute('data-group')));
  });
}

// 開く／閉じるを決めて保存する
function setToolsGroupOpen(id, open) {
  var s = (ui.toolsGroups && typeof ui.toolsGroups === 'object') ? ui.toolsGroups : {};
  s[id] = !!open;
  ui.toolsGroups = s;
  saveUi();
  var g = document.getElementById('setg-' + id);
  if (g) _toolsGroupShow(g, !!open);
}

// 見出しを押したとき
function toggleToolsGroup(id) { setToolsGroupOpen(id, !toolsGroupIsOpen(id)); }

// 「すべて開く」「すべて閉じる」
function setAllToolsGroups(open) {
  var s = {};
  document.querySelectorAll('#page-settings .set-group').forEach(function (g) {
    s[g.getAttribute('data-group')] = !!open;
    _toolsGroupShow(g, !!open);
  });
  ui.toolsGroups = s;
  saveUi();
}

// tools の中の要素が入っているグループを開く（閉じていると scrollIntoView できないため。35-album-folder.js・52-data-store.js から）
function revealToolsGroupOf(el) {
  var g = el && el.closest ? el.closest('.set-group') : null;
  if (g && !g.classList.contains('is-open')) setToolsGroupOpen(g.getAttribute('data-group'), true);
}

applyToolsGroups();

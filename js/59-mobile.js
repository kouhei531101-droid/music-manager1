/* =========================================================
   59-mobile.js ― スマホ（Android）で使うための部分（v8.7）
   ・「読み取り専用モードの表示」（#readonly-banner）：showDirectoryPicker の無いブラウザ（fsa.readOnly。02-folder-access.js）で、
     本文の上に「読み取り専用モード（スマホ）」を出す。音楽フォルダを選ぶ前は、選び方の案内と「音楽フォルダを選ぶ」「曲ファイルを選ぶ」ボタン
   ・書き込みの止め方：音楽ファイルに書き込む機能（曲情報・ジャケットのファイルへの書き込み、ファイル整理、プレイリストのフォルダへのコピー など）は
       ① ensureWritePermission() が false を返す（02）→ 各画面の「書き込みが許可されませんでした」を「スマホでは使えません」の説明に置き換える
       ② ファイル整理の操作・フォルダへのコピーは、押した時点で「スマホでは使えません（PCで操作してください）」と出して何もしない
       ③ 見た目：body.readonly-mode で、該当のボタンをうすくする（ファイル整理の画面には説明を出す）
     アプリの中だけのデータ（プレイリスト・再生回数・アプリ内の曲情報の上書き・ソートキーなど）は今までどおり使える
   ・PWA：http(s) で開いたときだけ service worker（sw.js）を登録する（file:// では登録しない）
   ・長押し：48-album-context-menu.js は contextmenu を受けているので、スマホのブラウザの長押しでもアルバムのメニューが出る
   ========================================================= */

var RO_MSG = 'スマホでは使えません（PCで操作してください）';

// スマホ版 v8.10.1：スマホの並び（下部メニューバー・フィルターアイコン・再生中ボタンなど）にするかどうか。
// style.css の「スマホ幅」の @media と同じ条件：幅 760px 以下、または横向きのスマホ（横長で高さ 500px 以下・幅 1000px 以下。71-np-landscape.js の NP_LAND_MQ と同じ）。
// 今までの「window.innerWidth <= 760」の代わりに使う（横向きで幅が 760px を超えるスマホでも PC の並びにしない）
var MOBILE_MQ = '(max-width: 760px), (orientation: landscape) and (max-height: 500px) and (max-width: 1000px)';
var _mobileMql = window.matchMedia ? window.matchMedia(MOBILE_MQ) : null;
function isMobileLayout() { return _mobileMql ? _mobileMql.matches : window.innerWidth <= 760; }

// 読み取り専用モードの表示（02 の renderConnectionStatus から呼ばれる）
function renderReadonlyBanner() {
  var el = document.getElementById('readonly-banner');
  document.body.classList.toggle('readonly-mode', !!fsa.readOnly);
  if (!el) return;
  el.hidden = !fsa.readOnly;
  if (!fsa.readOnly) return;
  var loaded = fsa.state === 'granted';
  var tag = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:6px" onclick="copyUiLabel(\'読み取り専用モードの表示\', event)" title="クリックで「読み取り専用モードの表示」をコピー">□</span>';
  if (!loaded) {
    el.className = 'readonly-banner is-start';
    el.innerHTML = tag +
      '<div class="ro-title">読み取り専用モード（スマホ）</div>' +
      '<p class="ro-text">スマホに入れた音楽フォルダを選んでください。スマホでは、アプリを開くたびに選び直します（前に読み込んだ曲の情報は覚えているので、2回目からは早くなります）。</p>' +
      '<div class="ro-btns"><button class="btn-save" onclick="pickMusicFolder()">' + ICONS.folder + '音楽フォルダを選ぶ</button>' +
      '<button class="btn-cancel" onclick="pickMusicFallback(\'files\')">' + ICONS.music + '曲ファイルを選ぶ</button></div>' +
      '<p class="ro-hint">フォルダを選べないときは「曲ファイルを選ぶ」で曲をまとめて選べます。曲情報の書き込み・ファイル整理などは、PC で操作してください。</p>';
  } else {
    el.className = 'readonly-banner is-loaded';
    el.innerHTML = tag +
      '<span class="ro-title">読み取り専用モード（スマホ）</span>' +
      '<span class="ro-text">「' + escapeHtml(fsa.folderName) + '」を読み込みました。曲情報の書き込み・ファイル整理などは PC で。</span>' +
      '<button class="btn-cancel ro-repick" onclick="pickMusicFolder()">音楽フォルダを選び直す</button>';
  }
}

// ① 「書き込みが許可されませんでした」を、スマホ向けの説明に置き換える
(function () {
  var f = window.showAlert;
  if (typeof f !== 'function') return;
  window.showAlert = function (opts) {
    if (fsa.readOnly && opts && opts.title === '書き込みが許可されませんでした') {
      opts = Object.assign({}, opts, { title: 'スマホでは使えません',
        message: '読み取り専用モード（スマホ）では、音楽ファイルへの書き込みはできません。PC で操作してください。何も変更していません。' });
    }
    return f.call(this, opts);
  };
})();
// ② 押した時点で止める機能（ファイル整理・プレイリストのフォルダへのコピー）
(function () {
  ['orgRenameFile', 'orgMoveSelected', 'orgTrashSelected', 'orgCreateFolder', 'copyPlaylistToFolder'].forEach(function (name) {
    var f = window[name];
    if (typeof f !== 'function') return;
    window[name] = function () {
      if (fsa.readOnly) { showToast(RO_MSG, true); return Promise.resolve(); }
      return f.apply(this, arguments);
    };
  });
})();
// ③ ファイル整理の画面の説明
function _roOrganizerNote() {
  var body = document.querySelector('#page-organizer .page-body');
  if (!body) return;
  var n = body.querySelector('.ro-org-note');
  if (!fsa.readOnly) { if (n) n.remove(); return; }
  if (n) return;
  n = document.createElement('div');
  n.className = 'ro-org-note';
  n.textContent = 'ファイル整理（名前の変更・移動・削除フォルダへ移動・フォルダの作成）は、' + RO_MSG + '。フォルダの中身を見ることはできます。';
  body.insertBefore(n, body.firstChild);
}

// スマホで初めて開いたときは、歌詞パネルを縮小で始める（スマホの画面では、歌詞パネルが本文の大半をおおってしまうため。
// 1回だけ。あとで出した・縮めたのはそのまま覚える）。12-init.js の initLyrics より前に読まれるので、最初の表示から縮小になる
if (fsa.readOnly && isMobileLayout() && !ui.mobileStartDone) {
  ui.lyricsCollapsed = true;
  ui.mobileStartDone = true;
  saveUi();
}

// PWA：http(s) のときだけ service worker を登録（file:// では何もしない）
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('service worker を登録できませんでした', e); });
  });
}

document.addEventListener('DOMContentLoaded', function () { renderReadonlyBanner(); _roOrganizerNote(); });
if (document.readyState !== 'loading') { renderReadonlyBanner(); _roOrganizerNote(); }

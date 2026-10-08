/* =========================================================
   66-bottom-nav.js ― スマホ版：下部メニューバー（スマホ版 v8.8）
   ・スマホ幅（760px 以下）では、サイドバー（#sidebar）を隠し、画面の一番下に固定した「下部メニューバー」（#bottom-nav）で画面を切り替える
   ・項目はサイドバーのメニュー（.sidebar-nav の .nav-item）から作る（アイコンは同じ ICONS、ラベルは短く）。
     項目が多いので、バーの中を指で左右にスクロールして選ぶ（scroll-snap で1項目ずつ止まる）
   ・今の画面の項目は強調表示。画面を開いたとき・切り替えたときは、その項目がバーの真ん中あたりに来るよう自動でスクロールする
   ・バーの左右に続きがあるときは、端をうすくぼかして「まだある」と分かるようにする（.can-left / .can-right）
   ・再生画面（フルスクリーン。body.np-open）の間と、文字の入力中（スマホのキーボードが出ている間。body.bnav-kbd）は隠す
   ・高さは style.css の --bnav-h。再生バー・歌詞パネル・トースト・スクロールボタン・再生中ボタン・本文の下の余白は、この高さの分だけ上に積む
   ・本文を左右にスワイプして画面を切り替える機能は入れていない（Pin の区切りなどの横スクロールとぶつかるため）
   ・PC 幅（761px 以上）では出さない（style.css で display:none）
   ・スマホ版 v8.10.1：横向きのスマホでは、画面の左端の縦の帯「ナビレール」になる（style.css の「スマホ版 v8.10.1：横向き」）。
     中は上下にスクロールするので、端のぼかし（.can-left＝上に続きがある／.can-right＝下に続きがある）と今の項目へのスクロールも上下で行う（_bnavVertical）
   ========================================================= */

// 下部メニューバーのラベル（サイドバーより短く。無い画面はサイドバーのラベルのまま）
var BNAV_SHORT = {
  albums: 'album', artists: 'artist', library: 'songs', playlists: 'playlist',
  newsongs: 'new', heavy: 'heavy', western: 'Western', seasons: 'Seasons', upbeat: 'upbeat',
  organizer: 'file', settings: 'tools', versions: 'version'
};

function _bnavReduceMotion() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 下部メニューバーを作る（サイドバーのメニュー項目から）
function buildBottomNav() {
  var nav = document.getElementById('bottom-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    document.body.appendChild(nav);
  }
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', '下部メニューバー');
  var html = '<div class="bnav-scroll" id="bnav-scroll">';
  document.querySelectorAll('#sidebar .sidebar-nav > *').forEach(function (el) {
    if (el.classList.contains('nav-sep')) { html += '<span class="bnav-sep" aria-hidden="true"></span>'; return; }
    if (!el.classList.contains('nav-item')) return;
    var page = el.getAttribute('data-page');
    var ic = el.querySelector('.nav-icon'), lb = el.querySelector('.nav-label');
    var icon = ic ? (ic.getAttribute('data-icon') || '') : '';
    var full = lb ? lb.textContent : page;
    var label = BNAV_SHORT[page] || full;
    html += '<button type="button" class="bnav-item" data-page="' + escapeHtml(page) + '" title="' + escapeHtml(el.getAttribute('title') || full) + '" aria-label="' + escapeHtml(full) + '">' +
      '<span class="bnav-icon" data-icon="' + escapeHtml(icon) + '"></span><span class="bnav-label">' + escapeHtml(label) + '</span></button>';
  });
  html += '</div>' +
    '<span class="ui-label-tag ui-label-tag-ondark" style="top:2px;right:4px" onclick="copyUiLabel(\'下部メニューバー\', event)" title="クリックで「下部メニューバー」をコピー">□</span>';
  nav.innerHTML = html;
  if (typeof applyIcons === 'function') applyIcons(nav);

  var sc = nav.querySelector('.bnav-scroll');
  sc.addEventListener('click', function (ev) {
    var b = ev.target.closest('.bnav-item');
    if (!b) return;
    var page = b.getAttribute('data-page');
    if (typeof showPage === 'function') showPage(page);
  });
  sc.addEventListener('scroll', _bnavEdges, { passive: true });
  syncBottomNav(true);
}

// ナビレール（横向き。項目が縦に並ぶ）かどうか（スマホ版 v8.10.1）
function _bnavVertical(sc) { return getComputedStyle(sc).flexDirection === 'column'; }
// 端のぼかし（左右〔ナビレールは上下〕に続きがあるか）
function _bnavEdges() {
  var nav = document.getElementById('bottom-nav');
  var sc = document.getElementById('bnav-scroll');
  if (!nav || !sc) return;
  var v = _bnavVertical(sc);
  var pos = v ? sc.scrollTop : sc.scrollLeft, max = v ? sc.scrollHeight - sc.clientHeight : sc.scrollWidth - sc.clientWidth;
  nav.classList.toggle('can-left', pos > 2);
  nav.classList.toggle('can-right', pos < max - 2);
}

// 今の画面の項目を強調し、その項目が見える位置（真ん中あたり）へスクロールする
function syncBottomNav(instant) {
  var nav = document.getElementById('bottom-nav');
  var sc = document.getElementById('bnav-scroll');
  if (!nav || !sc) return;
  var cur = typeof currentPage !== 'undefined' ? currentPage : null;
  var act = null;
  sc.querySelectorAll('.bnav-item').forEach(function (b) {
    var on = b.getAttribute('data-page') === cur;
    b.classList.toggle('active', on);
    if (on) { b.setAttribute('aria-current', 'page'); act = b; } else b.removeAttribute('aria-current');
  });
  if (act && sc.clientWidth > 0) {
    var beh = (instant || _bnavReduceMotion()) ? 'auto' : 'smooth';
    if (_bnavVertical(sc)) {   // ナビレール（横向き）：上下の真ん中あたりへ
      var top = act.offsetTop - (sc.clientHeight - act.offsetHeight) / 2;
      sc.scrollTo({ top: Math.max(0, Math.min(top, sc.scrollHeight - sc.clientHeight)), behavior: beh });
    } else {
      var left = act.offsetLeft - (sc.clientWidth - act.offsetWidth) / 2;
      left = Math.max(0, Math.min(left, sc.scrollWidth - sc.clientWidth));
      sc.scrollTo({ left: left, behavior: beh });
    }
  }
  _bnavEdges();
}

// 画面を切り替えたら合わせる
(function () {
  var f = window.showPage;
  if (typeof f !== 'function') return;
  window.showPage = function () {
    var r = f.apply(this, arguments);
    try { syncBottomNav(false); } catch (e) { console.warn(e); }
    return r;
  };
})();

// 文字の入力中（スマホのキーボードが出ている間）は隠す。範囲（音量など）・チェックボックスは対象外
var BNAV_TEXT_TYPES = { text: 1, search: 1, email: 1, url: 1, tel: 1, number: 1, password: 1 };
function _bnavIsTextField(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && !!BNAV_TEXT_TYPES[(el.getAttribute('type') || 'text').toLowerCase()];
}
document.addEventListener('focusin', function (ev) {
  if (_bnavIsTextField(ev.target)) document.body.classList.add('bnav-kbd');
});
document.addEventListener('focusout', function () {
  // 次の入力欄へ移るときに一瞬出ないよう、少し待ってから確かめる
  setTimeout(function () {
    document.body.classList.toggle('bnav-kbd', _bnavIsTextField(document.activeElement));
  }, 60);
});

// 画面の幅が変わったとき（向きを変えたときなど）は、今の項目が見える位置に戻す
window.addEventListener('resize', debounce(function () { syncBottomNav(true); }, 150));

buildBottomNav();

/* =========================================================
   94-artist-cover-pos.js ― アーティストの見出しの代表ジャケットの「拡大・位置の調整」
   （スマホ版 v8.25.1・PC版 v8.7.79。両版で同じ中身。PC版のファイル名は 86-artist-cover-pos.js）
   ・対象：artist 画面で1人のアーティストを開いたときの見出し（アーティストの画面の .artist-head）の代表ジャケットだけ。
     アーティスト一覧の小さな代表ジャケット・再生画面の背景（代表ジャケット）は今までどおり（調整は使わない）
   ・画面の名前
       位置を調整ボタン（.acp-open-btn）       ：見出しの代表ジャケットの下の真ん中に重ねたボタン「位置を調整」。押すと調整モード
       代表ジャケットの調整モード（.artist-head.is-acp-editing）：見出しの右の列が「代表ジャケットの調整バー」に変わり、
                                              代表ジャケットに点線の枠が付く。ピン・洋楽の指定・位置を調整ボタンは隠す
       代表ジャケットの調整バー（#acp-bar）     ：拡大のスライダー（1.00〜3.00倍）・「元に戻す」（初期の表示＝拡大なし・真ん中）・
                                              「キャンセル」・「保存」
   ・操作：画像をドラッグ＝位置を動かす（右へ動かす＝左側が見える）。拡大は PC＝マウスのホイール・スライダー、
     スマホ＝2本指のピンチ・スライダー。キーボードは画像にフォーカスして矢印＝位置、＋／－＝拡大、Enter＝保存、Esc＝キャンセル
   ・画像そのものは変えない。CSS だけで見せ方を変える：
       .artist-head-art に --acp-x / --acp-y（見せる位置 0〜100%）と --acp-z（拡大率 1〜3 倍）を付け、
       img の object-position と transform: scale()（中心は同じ位置）で表す（割合なので、ジャケットの枠の大きさが変わっても同じ所が見える）
   ・保存：db.artistCovers[アーティスト名].pos = { x, y, z }（アーティストごと。代表ジャケットの選択と同じ所なのでバックアップ・復元に含む）
       形：{ album:アルバムの目印, pos? } ／ { custom:true, pos? } ／ { pos }（標準〔最初のアルバム〕のまま調整だけ）。
       初期の表示（x 50・y 50・z 1）のときは pos を持たない。pos が無い古いデータ・バックアップは「初期の表示」として読む（01-core.js の normalizeDB）
   ・代表ジャケットを別のもの（別のアルバム・標準・画像を設定）に変えたら、調整は初期に戻す（21-artists.js の openArtistCoverEditor）。
     同じものを選び直して保存したときは引き継ぐ
   ・スマホ版の読み取り専用モードでも使える（アプリの中だけの設定で、音楽ファイルには書かない）
   ========================================================= */

var ACP_Z_MIN = 1, ACP_Z_MAX = 3;   // 拡大率の範囲（倍）
// 調整モードの状態（ar：開いているアーティスト、pos：今の表示、orig：入る前の表示、ptrs：押している指・マウス）
var acp = { ar: null, name: null, pos: null, orig: null, head: null, art: null, ptrs: {}, drag: null, pinch: null };

var ACP_ICON = _svg('<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>', 14);

/* ---------- 保存の形 ---------- */
// { x, y, z } にそろえる（範囲の外・数でない値は直す）
function _acpClean(p) {
  var n = function (v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  p = p || {};
  return { x: Math.round(n(p.x, 0, 100, 50) * 10) / 10, y: Math.round(n(p.y, 0, 100, 50) * 10) / 10, z: Math.round(n(p.z, ACP_Z_MIN, ACP_Z_MAX, 1) * 100) / 100 };
}
function _acpIsDefault(p) { return !p || (p.x === 50 && p.y === 50 && p.z === 1); }
// アーティストの今の調整（無ければ null＝初期の表示）
function artistCoverPosOf(name) {
  var e = (db.artistCovers || {})[name];
  return e && e.pos ? _acpClean(e.pos) : null;
}
// 保存する（初期の表示なら pos を消す。選択も調整も無くなったら項目ごと消す）
function setArtistCoverPos(name, p) {
  if (!db.artistCovers) db.artistCovers = {};
  var cur = db.artistCovers[name], e = {};
  if (cur && cur.custom) e.custom = true;
  else if (cur && typeof cur.album === 'string') e.album = cur.album;
  var c = p ? _acpClean(p) : null;
  if (c && !_acpIsDefault(c)) e.pos = c;
  if (e.custom || e.album !== undefined || e.pos) db.artistCovers[name] = e; else delete db.artistCovers[name];
  saveDB();
}
// バックアップの復元の確認の表に出す文字（10-settings-backup.js）
function _acpBackupText(d) {
  var m = (d && d.artistCovers) || {}, sel = 0, pos = 0;
  Object.keys(m).forEach(function (k) { var v = m[k]; if (!v) return; if (v.custom || v.album) sel++; if (v.pos) pos++; });
  return '選択 ' + sel + '人・調整 ' + pos + '人';
}

/* ---------- 見せ方（CSS の変数） ---------- */
function _acpApply(art, p, force) {
  if (!art) return;
  if (!p || (!force && _acpIsDefault(p))) {
    art.classList.remove('is-acp');
    ['--acp-x', '--acp-y', '--acp-z'].forEach(function (k) { art.style.removeProperty(k); });
    return;
  }
  art.classList.add('is-acp');
  art.style.setProperty('--acp-x', p.x + '%');
  art.style.setProperty('--acp-y', p.y + '%');
  art.style.setProperty('--acp-z', String(p.z));
}

/* ---------- 見出しに付ける（renderArtistDetail のあと） ---------- */
function _acpDecorate(ar, body) {
  var head = body && body.querySelector('.artist-head');
  if (!head) return;
  var art = head.querySelector('.artist-head-art'), wrap = head.querySelector('.album-head-art-wrap');
  if (!art || !wrap) return;
  _acpApply(art, artistCoverPosOf(ar.name));
  wrap.insertAdjacentHTML('beforeend',
    '<span class="acp-open-wrap"><button type="button" class="acp-open-btn" data-acp-open="1" title="代表ジャケットの拡大・位置を調整します（画像そのものは変えません）">' + ACP_ICON + '<span>位置を調整</span></button>' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="bottom:-12px;right:-14px" onclick="copyUiLabel(\'位置を調整ボタン\', event)" title="クリックで「位置を調整ボタン」をコピー">□</span></span>');
  wrap.querySelector('[data-acp-open]').addEventListener('click', function (ev) { ev.stopPropagation(); _acpEnter(ar, head, null); });
  // 調整の途中で描き直されたとき（曲情報の読み直しなど）：同じアーティストなら、調整モードを続ける
  if (acp.name === ar.name && acp.pos) _acpEnter(ar, head, acp.pos);
  else _acpReset();
}
function _acpReset() { acp = { ar: null, name: null, pos: null, orig: null, head: null, art: null, ptrs: {}, drag: null, pinch: null }; }

/* ---------- 代表ジャケットの調整モード ---------- */
function _acpEnter(ar, head, keepPos) {
  var art = head.querySelector('.artist-head-art'), info = head.querySelector('.album-head-info');
  if (!art || !info) return;
  var saved = artistCoverPosOf(ar.name) || { x: 50, y: 50, z: 1 };
  acp.ar = ar; acp.name = ar.name; acp.head = head; acp.art = art;
  acp.orig = saved;
  acp.pos = _acpClean(keepPos || saved);
  acp.ptrs = {}; acp.drag = null; acp.pinch = null;
  head.classList.add('is-acp-editing');
  art.setAttribute('tabindex', '0');
  art.setAttribute('role', 'application');
  art.setAttribute('aria-label', '代表ジャケット（ドラッグで位置、ホイール・ピンチで拡大。矢印キーで位置、＋－で拡大）');
  var old = info.querySelector('#acp-bar'); if (old) old.remove();
  info.insertAdjacentHTML('beforeend',
    '<div class="acp-bar" id="acp-bar" role="group" aria-label="代表ジャケットの調整バー">' +
      '<span class="ui-label-tag ui-label-tag-onlight" style="top:-4px;right:-18px" onclick="copyUiLabel(\'代表ジャケットの調整バー\', event)" title="クリックで「代表ジャケットの調整バー」をコピー">□</span>' +
      '<div class="acp-title">代表ジャケットの調整</div>' +
      '<div class="acp-hint">画像をドラッグで位置、ホイール・ピンチ・スライダーで拡大。画像そのものは変わりません</div>' +
      '<label class="acp-zoom"><span class="acp-zoom-label">拡大</span><input type="range" id="acp-zoom" min="' + ACP_Z_MIN * 100 + '" max="' + ACP_Z_MAX * 100 + '" step="1" aria-label="拡大率"><output id="acp-zoom-val" class="acp-zoom-val"></output></label>' +
      '<div class="acp-btns">' +
        '<button type="button" class="btn-inline-small" data-acp="reset" title="初期の表示（拡大なし・真ん中）に戻します。「保存」で決まります">' + ICONS.undo + '元に戻す</button>' +
        '<button type="button" class="btn-cancel" data-acp="cancel">キャンセル</button>' +
        '<button type="button" class="btn-save" data-acp="save">保存</button>' +
      '</div>' +
    '</div>');
  var bar = info.querySelector('#acp-bar'), zs = bar.querySelector('#acp-zoom');
  zs.addEventListener('input', function () { acp.pos.z = +zs.value / 100; _acpShow(); });
  bar.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acp]');
    if (!b) return;
    ev.stopPropagation();
    var k = b.getAttribute('data-acp');
    if (k === 'reset') { acp.pos = { x: 50, y: 50, z: 1 }; _acpShow(); }
    else if (k === 'cancel') _acpExit(false);
    else if (k === 'save') _acpExit(true);
  });
  _acpBindArt(art);
  _acpShow();
  if (!keepPos) { try { art.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}
// 今の表示を画像・スライダーに出す
function _acpShow() {
  if (!acp.art) return;
  acp.pos = _acpClean(acp.pos);
  _acpApply(acp.art, acp.pos, true);
  var bar = acp.head && acp.head.querySelector('#acp-bar');
  if (!bar) return;
  var zs = bar.querySelector('#acp-zoom'), zv = bar.querySelector('#acp-zoom-val');
  if (zs && document.activeElement !== zs) zs.value = Math.round(acp.pos.z * 100);
  if (zv) zv.textContent = acp.pos.z.toFixed(2) + '倍';
}
// 調整モードを終わる（save：保存する）
function _acpExit(save) {
  var name = acp.name, pos = acp.pos, head = acp.head, art = acp.art;
  if (!head) { _acpReset(); return; }
  var changed = save && JSON.stringify(_acpClean(pos)) !== JSON.stringify(_acpClean(acp.orig));
  if (save) setArtistCoverPos(name, pos);
  head.classList.remove('is-acp-editing');
  if (art) {
    art.removeAttribute('tabindex'); art.removeAttribute('role'); art.removeAttribute('aria-label');
    art.classList.remove('is-acp-dragging');
    _acpApply(art, save ? artistCoverPosOf(name) : acp.orig);
  }
  var bar = head.querySelector('#acp-bar'); if (bar) bar.remove();
  _acpReset();
  if (save) showToast(changed ? '代表ジャケットの表示（拡大・位置）を保存しました。' : '代表ジャケットの表示は変わっていません。');
  var ob = head.querySelector('[data-acp-open]'); if (ob) { try { ob.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
}

/* ---------- ドラッグ・ホイール・ピンチ・キーボード ---------- */
// 画像を dx・dy（px）動かしたときの位置の変化（%）。object-fit: cover で枠からはみ出す分（ox・oy）と拡大を合わせて計算する
//   見える所の位置 = 枠の幅×(1−z)×x/100 − z×はみ出し×x/100 なので、x を 1% 動かすと画像は (枠の幅×(z−1) ＋ z×はみ出し)/100 px 動く
function _acpSpan(art) {
  var r = art.getBoundingClientRect(), W = r.width || 1, H = r.height || 1;
  var img = art.querySelector('img'), ox = 0, oy = 0;
  if (img && img.naturalWidth && img.naturalHeight) {
    var s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    ox = Math.max(0, img.naturalWidth * s - W); oy = Math.max(0, img.naturalHeight * s - H);
  }
  return { w: W, h: H, sx: W * (acp.pos.z - 1) + acp.pos.z * ox, sy: H * (acp.pos.z - 1) + acp.pos.z * oy };
}
function _acpBindArt(art) {
  if (art._acpBound) return;   // 同じ要素に2回付けない
  art._acpBound = true;
  var editing = function () { return acp.art === art && acp.head && acp.head.classList.contains('is-acp-editing'); };
  var startDrag = function (p) {
    var sp = _acpSpan(art);
    acp.drag = { x: p.x, y: p.y, px: acp.pos.x, py: acp.pos.y, sx: sp.sx, sy: sp.sy };
  };
  var dist = function () { var k = Object.keys(acp.ptrs); if (k.length < 2) return 0; var a = acp.ptrs[k[0]], b = acp.ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); };
  art.addEventListener('pointerdown', function (ev) {
    if (!editing() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.preventDefault();
    try { art.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
    acp.ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var n = Object.keys(acp.ptrs).length;
    if (n >= 2) { acp.drag = null; acp.pinch = { d: dist() || 1, z: acp.pos.z }; }
    else { acp.pinch = null; startDrag(acp.ptrs[ev.pointerId]); }
    art.classList.add('is-acp-dragging');
    try { art.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
  });
  art.addEventListener('pointermove', function (ev) {
    if (!editing() || !acp.ptrs[ev.pointerId]) return;
    acp.ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (acp.pinch && Object.keys(acp.ptrs).length >= 2) {   // 2本指：指の間の広さの割合で拡大
      acp.pos.z = Math.min(ACP_Z_MAX, Math.max(ACP_Z_MIN, acp.pinch.z * dist() / acp.pinch.d));
      _acpShow();
    } else if (acp.drag) {   // 1本指・マウス：動かした向きに画像が動く
      var d = acp.drag;
      if (d.sx > 0.5) acp.pos.x = Math.min(100, Math.max(0, d.px - (ev.clientX - d.x) / d.sx * 100));
      if (d.sy > 0.5) acp.pos.y = Math.min(100, Math.max(0, d.py - (ev.clientY - d.y) / d.sy * 100));
      _acpShow();
    }
  });
  var up = function (ev) {
    if (!acp.ptrs[ev.pointerId]) return;
    delete acp.ptrs[ev.pointerId];
    var k = Object.keys(acp.ptrs);
    acp.pinch = null;
    if (k.length === 1) startDrag(acp.ptrs[k[0]]);   // ピンチのあと残った1本指で続けて動かせる
    else { acp.drag = null; art.classList.remove('is-acp-dragging'); }
  };
  art.addEventListener('pointerup', up);
  art.addEventListener('pointercancel', up);
  art.addEventListener('dragstart', function (ev) { if (editing()) ev.preventDefault(); });
  // ホイール：上へ回す＝拡大（調整モードの間だけ。ふだんはページのスクロール）
  art.addEventListener('wheel', function (ev) {
    if (!editing()) return;
    ev.preventDefault();
    var dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    acp.pos.z = Math.min(ACP_Z_MAX, Math.max(ACP_Z_MIN, acp.pos.z * Math.exp(-dy * 0.0015)));
    _acpShow();
  }, { passive: false });
  art.addEventListener('keydown', function (ev) {
    if (!editing()) return;
    var k = ev.key, step = ev.shiftKey ? 10 : 2;
    if (k === 'ArrowLeft') acp.pos.x += step;        // 左へ動かす＝右側が見える
    else if (k === 'ArrowRight') acp.pos.x -= step;
    else if (k === 'ArrowUp') acp.pos.y += step;
    else if (k === 'ArrowDown') acp.pos.y -= step;
    else if (k === '+' || k === '=' || k === ';') acp.pos.z += 0.05;
    else if (k === '-' || k === '_') acp.pos.z -= 0.05;
    else if (k === 'Enter') { ev.preventDefault(); _acpExit(true); return; }
    else if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); _acpExit(false); return; }
    else return;
    ev.preventDefault();
    _acpShow();
  });
}

/* ---------- 今までの処理につなぐ ---------- */
(function () {
  // アーティストの画面を描いたあとに、見出しの代表ジャケットへ調整を付ける（21-artists.js）
  var orig = window.renderArtistDetail;
  if (typeof orig !== 'function') return;
  window.renderArtistDetail = function (ar, body) {
    var r = orig.apply(this, arguments);
    try { _acpDecorate(ar, body); } catch (e) { console.warn('代表ジャケットの調整', e); }
    return r;
  };
})();

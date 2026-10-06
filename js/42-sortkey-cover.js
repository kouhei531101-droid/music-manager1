/* =========================================================
   42-sortkey-cover.js ― ソートキーの枠の背景（v6.0）・表示位置（v6.1）
   ・album のグループ「ソートキー（枠で囲む）」（38-album-groups.js）のソートキーの枠の背景に、
     そのまとまりの代表ジャケットを、枠いっぱいに薄く敷く（ソートキーの枠の背景。ぼかし・濃さは style.css の .album-sk-bg img）。
     枠の色（ソートキーから決まる色相の背景・枠線・ラベル）はそのまま残し、その上に重ねる
   ・代表ジャケット：初期はまとまりの中の先頭のアルバム（並べ替えの設定どおりの並びで最初）。
     ジャケットの無いアルバムは飛ばして次のアルバム（最大6枚まで試す）。全部無ければ今までの色だけ
   ・代表ジャケットを選ぶ：枠のラベル、または枠の右上の小さなボタン → 代表ジャケットを選ぶダイアログ
   ・表示位置（v6.1）：ダイアログの「表示位置」で、見せる位置（横・縦 0〜100%）と拡大率（1.0〜2.0 倍）を枠ごとに決める。
     枠の背景の div に --sk-x / --sk-y / --sk-z を付け、CSS の object-position と transform で表す（割合なので、枠の大きさが変わっても同じ所が見える）
   ・保存：db.skCovers { ソートキーの正規化した文字: アルバムの目印（文字。v6.0 の形）| { album, x, y, z }（v6.1） }。
     位置・拡大率が初期（50%・50%・1倍）なら v6.0 と同じ文字の形で保存する。バックアップに含む。アルバムの目印が変わったら付け替える
   ・画像はジャケットの控え（13-artwork.js の遅延読み込み）を使い、見えている枠だけ読む
   ========================================================= */

var SK_COVER_TRY = 6;   // ジャケットの無いアルバムを飛ばして試す枚数
var SK_POS_DEFAULT = { x: 50, y: 50, z: 1 };
var SK_ZOOM_MAX = 2;

/* ---------- 保存 ---------- */
// 1件を { album, x, y, z } にそろえる（v6.0 の文字の形も読む）
function _skEntry(v) {
  if (typeof v === 'string') return { album: v, x: 50, y: 50, z: 1 };
  if (!v || typeof v !== 'object') return { album: '', x: 50, y: 50, z: 1 };
  var n = function (x, lo, hi, d) { x = +x; return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  return { album: typeof v.album === 'string' ? v.album : '', x: n(v.x, 0, 100, 50), y: n(v.y, 0, 100, 50), z: n(v.z, 1, SK_ZOOM_MAX, 1) };
}
function _skIsDefaultPos(e) { return e.x === 50 && e.y === 50 && e.z === 1; }
function skCoverEntry(normKey) { return _skEntry((db.skCovers || {})[normKey]); }
function skCoverOf(normKey) { return skCoverEntry(normKey).album; }
// 選ぶ（albumKey が空なら自動）。pos：{ x, y, z }（省略なら今のまま）。変わったら true
function setSkCover(normKey, albumKey, pos) {
  if (!normKey) return false;
  if (!db.skCovers || typeof db.skCovers !== 'object') db.skCovers = {};
  var cur = skCoverEntry(normKey);
  var e = _skEntry({ album: albumKey || '', x: pos ? pos.x : cur.x, y: pos ? pos.y : cur.y, z: pos ? pos.z : cur.z });
  e.x = Math.round(e.x * 10) / 10; e.y = Math.round(e.y * 10) / 10; e.z = Math.round(e.z * 100) / 100;
  if (cur.album === e.album && cur.x === e.x && cur.y === e.y && cur.z === e.z) return false;
  if (!e.album && _skIsDefaultPos(e)) delete db.skCovers[normKey];
  else if (_skIsDefaultPos(e)) db.skCovers[normKey] = e.album;   // v6.0 と同じ形
  else db.skCovers[normKey] = e;
  saveDB();
  return true;
}
// アルバムの目印の付け替え（map：{ 古い目印: 新しい目印 }）
function renameSkCoverAlbumKeys(map) {
  var m = db.skCovers, ch = false;
  if (!m) return false;
  Object.keys(m).forEach(function (k) {
    var v = m[k];
    if (typeof v === 'string') { var nk = map[v]; if (nk && nk !== v) { m[k] = nk; ch = true; } }
    else if (v && typeof v === 'object' && v.album) { var nk2 = map[v.album]; if (nk2 && nk2 !== v.album) { v.album = nk2; ch = true; } }
  });
  return ch;
}
// 選んだアルバムの目印の一覧（14-albums.js の migrateAlbumKeys から）
function skCoverAlbumKeyOf(v) { return typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.album === 'string' ? v.album : ''); }
// 代表ジャケットの候補の並び（選んだアルバムを先頭に、あとは枠の中の並び）
function _skCoverCandidates(c, selKey) {
  var list = c.albums.slice(), sel = selKey === undefined ? skCoverOf(c.key) : selKey;
  if (sel) { for (var i = 0; i < list.length; i++) if (list[i].key === sel) { list.unshift(list.splice(i, 1)[0]); break; } }
  return list;
}

/* ---------- ソートキーの枠の背景 ---------- */
function _skPosStyle(e) {
  return '--sk-x:' + e.x + '%;--sk-y:' + e.y + '%;--sk-z:' + e.z;
}
// 枠の先頭に置く背景の HTML（38-album-groups.js の albumClusterGridHtml から）
function skClusterBgHtml(c) {
  var cands = _skCoverCandidates(c).filter(function (a) { return a.cover; }).slice(0, SK_COVER_TRY);
  if (!cands.length) return '';
  var e = skCoverEntry(c.key);
  var attrs = ' aria-hidden="true" style="' + _skPosStyle(e) + '"', cls = 'album-sk-bg' + (e.z > 1 ? ' is-zoomed' : '');
  var m = art.mem.get(artKeyOf(cands[0].cover));
  if (m && m.url) return '<div class="' + cls + '"' + attrs + '><img src="' + m.url + '" alt="" decoding="async"></div>';
  // まだ控えから出していない（または1枚目に画像が無い）：見えたら読む。画像が無ければ次の候補（skBgFallback）
  return '<div class="' + cls + ' art-pending"' + attrs + ' data-art-path="' + escapeHtml(cands[0].cover.path) + '" data-sk-alts="' +
    escapeHtml(cands.slice(1).map(function (a) { return a.cover.path; }).join('\n')) + '"></div>';
}
// 13-artwork.js の _artApply から：画像が無かったとき、次の候補のアルバムで読み直す
function skBgFallback(el) {
  var alts = (el.getAttribute('data-sk-alts') || '').split('\n').filter(Boolean);
  if (!alts.length) { el.removeAttribute('data-sk-alts'); return; }
  el.setAttribute('data-sk-alts', alts.slice(1).join('\n'));
  el.classList.remove('art-none');
  el.classList.add('art-pending');
  el.setAttribute('data-art-path', alts[0]);
  if (art.observer) art.observer.observe(el);
}
// 枠の右上の小さなボタン（代表ジャケットを選ぶボタン）
function skCoverButtonHtml(c, first) {
  return '<span class="album-sk-cover-wrap"><button type="button" class="album-sk-cover-btn" data-sk-cover="' + escapeHtml(c.key) + '" title="代表ジャケットを選ぶ（枠の背景・表示位置）" aria-label="' + escapeHtml('「' + c.label + '」の代表ジャケットを選ぶ') + '">' + ICONS.image + '</button>' +
    (first ? '<span class="ui-label-tag ui-label-tag-onlight" style="top:-9px;right:-6px" onclick="copyUiLabel(\'代表ジャケットを選ぶボタン\', event)" title="クリックで「代表ジャケットを選ぶボタン」をコピー">□</span>' : '') + '</span>';
}

/* ---------- 代表ジャケットを選ぶ（ダイアログ） ---------- */
// 選んだアルバム（selKey）のとき、実際に背景に出る画像の URL（ジャケットの無いアルバムは飛ばす）
async function _skPreviewUrl(c, selKey) {
  var cands = _skCoverCandidates(c, selKey).filter(function (a) { return a.cover; }).slice(0, SK_COVER_TRY);
  for (var i = 0; i < cands.length; i++) {
    var r = await artLoadForTrack(cands[i].cover);
    if (r && r.url) return r.url;
  }
  return '';
}
// 表示位置の欄（v6.1）：プレビュー（実際の枠と同じ縦横比）・簡単な選択・横／縦／拡大のスライダー・初期に戻す
function _skPosHtml(c, ratio) {
  var quick = [['左上', 0, 0], ['上', 50, 0], ['右上', 100, 0], ['左', 0, 50], ['真ん中', 50, 50], ['右', 100, 50], ['左下', 0, 100], ['下', 50, 100], ['右下', 100, 100]];
  return '<div class="sk-pos">' +
    '<span class="ui-label-tag ui-label-tag-onlight" style="top:4px;right:6px" onclick="copyUiLabel(\'表示位置\', event)" title="クリックで「表示位置」をコピー">□</span>' +
    '<div class="sk-pos-title">表示位置</div>' +
    '<div class="sk-pos-body">' +
      '<div class="sk-pos-preview-wrap">' +
        '<div class="album-sk-cluster sk-pos-preview" id="skp-preview" style="--sk-h:' + _skHue(c.key) + ';aspect-ratio:' + ratio.toFixed(3) + ';width:min(100%, ' + Math.round(240 * ratio) + 'px)" title="ドラッグで位置を合わせる">' +
          '<div class="album-sk-bg" id="skp-bg"></div>' +
          '<span class="album-sk-label sk-pos-plabel">' + ICONS.tag + '<span class="album-sk-name">' + escapeHtml(c.label) + '</span></span>' +
        '</div>' +
        '<div class="dialog-hint sk-pos-hint">プレビューは実際の枠と同じ縦横比です。画像をドラッグして位置を合わせられます。</div>' +
      '</div>' +
      '<div class="sk-pos-ctrls">' +
        '<div class="sk-pos-quick" role="group" aria-label="簡単な位置">' + quick.map(function (q) { return '<button type="button" class="btn-inline-small" data-skq="' + q[1] + ',' + q[2] + '">' + q[0] + '</button>'; }).join('') + '</div>' +
        '<label class="sk-pos-range">横<input type="range" id="skp-x" min="0" max="100" step="1"><output id="skp-xo"></output></label>' +
        '<label class="sk-pos-range">縦<input type="range" id="skp-y" min="0" max="100" step="1"><output id="skp-yo"></output></label>' +
        '<label class="sk-pos-range">拡大<input type="range" id="skp-z" min="1" max="' + SK_ZOOM_MAX + '" step="0.05"><output id="skp-zo"></output></label>' +
        '<button type="button" class="btn-inline-small sk-pos-reset" id="skp-reset">' + ICONS.undo + '初期に戻す</button>' +
        '<div class="dialog-hint">横の位置は、ジャケットが枠より横に余るとき（縦長の枠・拡大したとき）に効きます。</div>' +
      '</div>' +
    '</div></div>';
}
async function openSkCoverPicker(normKey) {
  var c = null;
  (albView.clusters || []).forEach(function (it) { if (it.cluster && it.cluster.key === normKey) c = it.cluster; });
  if (!c) return;
  var ent = skCoverEntry(normKey), sel = ent.album;
  if (sel && !c.albums.some(function (a) { return a.key === sel; })) sel = '';   // 選んだアルバムがもう枠に無い：自動と同じ
  // 実際の枠の縦横比（見つからなければ 3:1）
  var ratio = 3;
  var btn = Array.prototype.find.call(document.querySelectorAll('#alb-body [data-sk-cover]'), function (x) { return x.getAttribute('data-sk-cover') === normKey; });
  var sec = btn && btn.closest('.album-sk-cluster');
  if (sec) { var rc = sec.getBoundingClientRect(); if (rc.width > 0 && rc.height > 0) ratio = rc.width / rc.height; }
  ratio = Math.min(8, Math.max(0.3, ratio));
  var h = '<span class="ui-label-tag ui-label-tag-onlight" style="top:6px;right:8px" onclick="copyUiLabel(\'代表ジャケットを選ぶダイアログ\', event)" title="クリックで「代表ジャケットを選ぶダイアログ」をコピー">□</span>' +
    '<p class="dialog-message">ソートキー「<strong>' + escapeHtml(c.label) + '</strong>」の枠の背景に薄く敷くジャケットと、その表示位置を選びます。アプリの中だけの設定で、曲ファイルは変わりません（バックアップに含まれます）。</p>' +
    '<div class="ac-choices sk-cover-choices">' +
      '<label class="ac-choice"><input type="radio" name="skc" value=""' + (!sel ? ' checked' : '') + '><span class="ac-thumb">' + artThumbHtml(c.albums[0].cover, 'art-card') + '</span><span class="ac-name">自動（先頭のアルバム）</span></label>';
  c.albums.forEach(function (a, i) {
    h += '<label class="ac-choice"><input type="radio" name="skc" value="' + i + '"' + (sel === a.key ? ' checked' : '') + '><span class="ac-thumb">' + artThumbHtml(a.cover, 'art-card') + '</span><span class="ac-name" title="' + escapeHtml(a.name) + '">' + escapeHtml(a.name) + '</span></label>';
  });
  h += '</div><p class="dialog-hint">ジャケットの無いアルバムを選んだときは、枠の中の次のアルバムのジャケットを使います。</p>' + _skPosHtml(c, ratio);
  var pick = null, pos = { x: ent.x, y: ent.y, z: ent.z }, token = 0;
  var v = await openDialog({
    title: '代表ジャケットを選ぶ', body: h, size: 'large',
    buttons: [{ label: 'キャンセル', value: 'cancel', cls: 'btn-cancel' }, { label: '保存', value: 'ok', cls: 'btn-save', isDefault: true }],
    onOpen: function (b) {
      artObserve(b);
      var bg = b.querySelector('#skp-bg'), pv = b.querySelector('#skp-preview');
      var xs = b.querySelector('#skp-x'), ys = b.querySelector('#skp-y'), zs = b.querySelector('#skp-z');
      var show = function () {   // 今の位置をプレビュー・スライダーに出す（すぐ反映）
        bg.setAttribute('style', _skPosStyle(pos));
        bg.classList.toggle('is-zoomed', pos.z > 1);
        xs.value = pos.x; ys.value = pos.y; zs.value = pos.z;
        b.querySelector('#skp-xo').textContent = Math.round(pos.x) + '%';
        b.querySelector('#skp-yo').textContent = Math.round(pos.y) + '%';
        b.querySelector('#skp-zo').textContent = (+pos.z).toFixed(2) + '倍';
      };
      var selKey = function () { var r = b.querySelector('input[name="skc"]:checked'); return r && r.value !== '' ? c.albums[+r.value].key : ''; };
      var loadImg = function () {   // 選んだアルバムの画像をプレビューに
        var my = ++token;
        _skPreviewUrl(c, selKey()).then(function (url) {
          if (my !== token) return;
          bg.innerHTML = url ? '<img src="' + url + '" alt="" draggable="false">' : '';
          pv.classList.toggle('sk-pos-noimg', !url);
        });
      };
      b.querySelector('.sk-cover-choices').addEventListener('change', loadImg);
      b.querySelectorAll('[data-skq]').forEach(function (q) {
        q.addEventListener('click', function () { var p = q.getAttribute('data-skq').split(','); pos.x = +p[0]; pos.y = +p[1]; show(); });
      });
      xs.addEventListener('input', function () { pos.x = +xs.value; show(); });
      ys.addEventListener('input', function () { pos.y = +ys.value; show(); });
      zs.addEventListener('input', function () { pos.z = +zs.value; show(); });
      b.querySelector('#skp-reset').addEventListener('click', function () { pos = { x: 50, y: 50, z: 1 }; show(); });
      // プレビューの上でドラッグ：画像を動かした向きに合わせて位置を変える（右へ動かす＝左側が見える）
      var drag = null;
      pv.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        drag = { x: ev.clientX, y: ev.clientY, px: pos.x, py: pos.y, w: pv.clientWidth, h: pv.clientHeight };
        try { pv.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
        pv.classList.add('is-dragging');
        ev.preventDefault();
      });
      pv.addEventListener('pointermove', function (ev) {
        if (!drag) return;
        pos.x = Math.min(100, Math.max(0, drag.px - (ev.clientX - drag.x) / drag.w * 100 * 1.5));
        pos.y = Math.min(100, Math.max(0, drag.py - (ev.clientY - drag.y) / drag.h * 100 * 1.5));
        show();
      });
      var end = function () { if (!drag) return; drag = null; pv.classList.remove('is-dragging'); pos.x = Math.round(pos.x); pos.y = Math.round(pos.y); show(); };
      pv.addEventListener('pointerup', end); pv.addEventListener('pointercancel', end);
      show();
      loadImg();
    },
    beforeClose: function (value, b) {
      if (value !== 'ok') return true;
      var r = b.querySelector('input[name="skc"]:checked');
      pick = r && r.value !== '' ? c.albums[+r.value].key : '';
      return true;
    }
  });
  token++;
  if (v !== 'ok' || pick === null) return;
  if (!setSkCover(normKey, pick, pos)) return;
  var y = window.scrollY;
  renderAlbumsPage();
  window.scrollTo(0, y);
  showToast('「' + c.label + '」の代表ジャケット（表示位置）を保存しました。');
}
// ラベル・ボタンを押したとき（アルバム一覧の本文エリア）
(function () {
  var body = document.getElementById('alb-body');
  if (!body) return;
  body.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-sk-cover]');
    if (!b || !body.contains(b)) return;
    ev.preventDefault();
    openSkCoverPicker(b.getAttribute('data-sk-cover'));
  });
})();

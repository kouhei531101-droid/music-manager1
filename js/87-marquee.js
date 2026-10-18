/* =========================================================
   87-marquee.js ― 長い曲名を流して見せる「流れる表示」（スマホ版 v8.22.0）
   ・対象：再生画面の曲名（#np-title）・アーティストとアルバムの行（#np-sub）、再生バーの曲名（#pb-title）
   ・入りきるときは今まで通り止まったまま（中央ぞろえ）。入りきらないときだけ流す
   ・スマホ版 v8.22.1：切れ目なしのループ（電光掲示板・ティッカー型）。文字の後ろにすき間（2.5em）を空けて同じ文字をもう1つ並べ（.mq-dup。aria-hidden）、
     「文字の幅＋すき間」だけ一定の速さ（毎秒 35px）で左へ流し続ける（止まる時間は無し。最初に出したときだけ 1 秒待つ）。
     中身：#np-title など ＞ .mq-track（動かす）＞ .mq-inner（元の中身）・.mq-gap・.mq-dup（写し）
   ・曲名は、まず今まで通り文字を小さくして入れる（55-np-title-fit.js）。ただし小さくしすぎると読みにくいので、
     流れる表示が使えるときは元の大きさの 75% まで（今までは 45%）にして、それでも入らなければ流す
   ・動きは Web Animations（transform だけ）で軽く。再生画面を閉じたら止める。曲が変わった・幅や向きが変わった（ResizeObserver）ときに測り直す。
     同じ文字で描き直したとき（再生・一時停止など）は流れている位置を引き継ぐ
   ・曲名（再生画面）を押すと、流れる表示を一時停止／再開（ほかの押す動きは無い所なので重ならない）。アーティストとアルバムの行はリンクがあるので押しても止めない
   ・動きを減らす設定（prefers-reduced-motion）では流さず、今まで通り「…」で省略
   ========================================================= */

var MQ_SPEED = 35, MQ_START_DELAY = 1.0, MQ_GAP_EM = 2.5;   // 速さ（px/秒）・最初に出したときに待つ秒数・すき間（文字の大きさの倍）
var MQ_TARGETS = ['np-title', 'np-sub', 'pb-title'];
var mq = { state: {}, ro: null, reduced: false };
(function () {
  var m = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq.reduced = !!(m && m.matches);
  if (m && m.addEventListener) m.addEventListener('change', function () { mq.reduced = m.matches; MQ_TARGETS.forEach(function (id) { marqueeApply(id); }); });
})();
// 曲名を小さくする下限：流れる表示が使えるときは 75% まで（55-np-title-fit.js の NP_TITLE_MIN_RATIO）
if (!mq.reduced && typeof NP_TITLE_MIN_RATIO !== 'undefined') NP_TITLE_MIN_RATIO = 0.75;

function _mqVisible(id) {
  if (id === 'pb-title') return true;
  return typeof np !== 'undefined' && np.open;
}
// el の中身を流れる表示にする（入りきらないときだけ）
function marqueeApply(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var st = mq.state[id] || (mq.state[id] = { key: '', anim: null, paused: false });
  // 包み（.mq-track ＞ .mq-inner）。描き直されて中身が入れ替わっていたら包み直す。前の写し・すき間は外してから測る
  var track = el.querySelector(':scope > .mq-track'), inner = track && track.querySelector(':scope > .mq-inner');
  if (!track || !inner || el.childNodes.length !== 1) {
    track = document.createElement('span'); track.className = 'mq-track';
    inner = document.createElement('span'); inner.className = 'mq-inner';
    while (el.firstChild) inner.appendChild(el.firstChild);
    track.appendChild(inner); el.appendChild(track);
  } else track.querySelectorAll(':scope > .mq-gap, :scope > .mq-dup').forEach(function (x) { x.remove(); });
  var prevTime = st.anim && st.anim.currentTime, prevKey = st.key;
  if (st.anim) { st.anim.cancel(); st.anim = null; }
  el.classList.remove('mq-on', 'mq-paused');
  if (mq.reduced || !_mqVisible(id) || !inner.textContent.trim()) { st.key = ''; return; }
  var w = el.clientWidth, sw = el.scrollWidth;   // 包みは流すとき以外は inline（「…」の省略が効くように）なので、外側の scrollWidth で測る
  if (!w || sw <= w + 1) { st.key = ''; return; }   // 入りきる：止まったまま
  // すき間と写しを足す（写しは読み上げない・押せない）
  var gap = document.createElement('span'); gap.className = 'mq-gap'; gap.setAttribute('aria-hidden', 'true');
  var dup = document.createElement('span'); dup.className = 'mq-dup'; dup.setAttribute('aria-hidden', 'true');
  Array.prototype.forEach.call(inner.childNodes, function (n) { dup.appendChild(n.cloneNode(true)); });
  dup.querySelectorAll('a, button, [tabindex]').forEach(function (x) { x.setAttribute('tabindex', '-1'); });
  track.appendChild(gap); track.appendChild(dup);
  el.classList.add('mq-on');
  var dist = inner.getBoundingClientRect().width + gap.getBoundingClientRect().width;   // 1回分：文字の幅＋すき間（写しの先頭が元の先頭の位置に来る）
  if (!(dist > 0)) dist = sw + (parseFloat(getComputedStyle(el).fontSize) || 16) * MQ_GAP_EM;
  var key = inner.textContent + '|' + w + '|' + sw;
  var same = key === prevKey && prevTime != null;
  st.anim = track.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-dist) + 'px)' }],
    { duration: dist / MQ_SPEED * 1000, iterations: Infinity, easing: 'linear', delay: same ? 0 : MQ_START_DELAY * 1000 });
  if (same) st.anim.currentTime = Math.max(0, prevTime - (prevTime >= MQ_START_DELAY * 1000 && st.hadDelay ? MQ_START_DELAY * 1000 : 0));   // 同じ文字の描き直し：流れている位置を引き継ぐ
  else st.paused = false;
  st.hadDelay = !same;
  st.key = key;
  if (st.paused) { st.anim.pause(); el.classList.add('mq-paused'); }
}
// スマホ版 v8.24.2：次のフレームの前に1回だけ marqueeApply する（同じフレームの中で何度呼ばれても1回）
var _mqSoonIds = {}, _mqSoonRaf = 0;
function marqueeSoon(id) {
  _mqSoonIds[id] = true;
  if (_mqSoonRaf) return;
  _mqSoonRaf = requestAnimationFrame(function () {
    _mqSoonRaf = 0;
    var ids = Object.keys(_mqSoonIds); _mqSoonIds = {};
    ids.forEach(function (x) { try { marqueeApply(x); } catch (e) { console.warn(e); } });
  });
}
function marqueeStopAll() {
  Object.keys(mq.state).forEach(function (id) { var s = mq.state[id]; if (s.anim && id !== 'pb-title') { s.anim.cancel(); s.anim = null; s.key = ''; } });
}
function _mqObserve() {
  if (mq.ro || typeof ResizeObserver === 'undefined') return;
  var last = {};
  mq.ro = new ResizeObserver(function (entries) {
    entries.forEach(function (en) {
      var id = en.target.id, w = Math.round(en.contentRect.width);
      if (last[id] === w) return;   // 幅が変わったときだけ（高さの変化では測り直さない）
      last[id] = w;
      requestAnimationFrame(function () { marqueeApply(id); });
    });
  });
  MQ_TARGETS.forEach(function (id) { var el = document.getElementById(id); if (el && !el._mqObs) { el._mqObs = true; mq.ro.observe(el); } });
}

(function () {
  // 再生画面の曲名：55-np-title-fit.js で文字を小さくしたあとに判定する
  var tf = window.npTitleFit;
  if (typeof tf === 'function') {
    window.npTitleFit = function () {
      var el = document.getElementById('np-title');
      // 流れる表示の包みを外してから測る（55 は文字の幅で大きさを決める）
      if (el) { var inn = el.querySelector(':scope > .mq-track > .mq-inner'); if (inn && el.childNodes.length === 1) { var tx = inn.textContent; el.textContent = tx; } }
      var r = tf.apply(this, arguments);
      try {
        marqueeApply('np-title'); _mqObserve();
        // 55 の ResizeObserver は「文字が変わったか」を textContent で見るので、写しを足したあとの文字を覚えさせる（何度も測り直さないように）
        if (el && typeof nptf !== 'undefined') { nptf.lastText = el.textContent; nptf.lastW = el.clientWidth; }
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  // 再生画面を描いたあと：アーティストとアルバムの行
  var nr = window.npRender;
  if (typeof nr === 'function') window.npRender = function () { var r = nr.apply(this, arguments); try { marqueeApply('np-sub'); _mqObserve(); } catch (e) { console.warn(e); } return r; };
  // 再生バーの曲名
  var up = window.updatePlayerUi;
  // スマホ版 v8.24.2：測るのは次のフレームの前に1回だけ（続けて呼ばれてもまとめる。一覧を作り直した直後に、その場で画面全体の並べ直しを起こさない）
  if (typeof up === 'function') window.updatePlayerUi = function () { var r = up.apply(this, arguments); try { marqueeSoon('pb-title'); _mqObserve(); } catch (e) { console.warn(e); } return r; };
  // 再生画面を閉じたら止める（電池のため）
  var hd = window._npHide;
  if (typeof hd === 'function') window._npHide = function () { try { marqueeStopAll(); } catch (e) { /* 無視 */ } return hd.apply(this, arguments); };
})();
// 曲名（再生画面）を押すと一時停止／再開
document.addEventListener('click', function (ev) {
  var el = ev.target.closest && ev.target.closest('#np-title.mq-on');
  if (!el) return;
  var st = mq.state['np-title'];
  if (!st || !st.anim) return;
  st.paused = !st.paused;
  if (st.paused) st.anim.pause(); else st.anim.play();
  el.classList.toggle('mq-paused', st.paused);
});
window.addEventListener('resize', function () { MQ_TARGETS.forEach(function (id) { if (id !== 'np-title') marqueeSoon(id); }); });   // v8.24.2：次のフレームの前にまとめて

/* =========================================================
   sw.js ― スマホで「ホーム画面に追加」したときのための service worker（v8.7）
   ・アプリの部品（index.html・style.css・js・アイコンなど、このフォルダの中のファイル）だけを控えておく
   ・ネットにつながるときは毎回新しいものを取りに行き（アプリを更新したらすぐ反映）、つながらないときだけ控えを使う
   ・音楽ファイルはアプリが blob: で再生するので、ここを通らない（控えない）。ほかのサイト（文字のフォントなど）も控えない
   ・登録は 59-mobile.js（http / https で開いたときだけ。file:// では登録しない）
   ========================================================= */

var CACHE_NAME = 'music-manager-app-v8.15.0';
// 再生画面の背景の写真（スマホ版 v8.14.1。bg-photos/。計 約4.3MB）は、アプリの控えとは別の控えに入れて、版を上げても消さない。
// 入れ方：install のときに、まだ控えていない写真だけを取りに行く（つながらないときは飛ばし、表示したときに控える）。
// 取り出し方：控えにあればそれを使い（写真は変わらないため）、無ければ取りに行って控える
var PHOTO_CACHE = 'music-manager-bgphotos-v1';
var PHOTO_FILES = ['forest', 'meadow', 'mountain', 'river', 'sea', 'space', 'geometric', 'sunset', 'sakura', 'autumn', 'snow'].map(function (id) { return './bg-photos/' + id + '.jpg'; });
var PHOTO_RE = /\/bg-photos\/[^/]+\.jpg$/i;

self.addEventListener('install', function (ev) {
  self.skipWaiting();
  ev.waitUntil(caches.open(PHOTO_CACHE).then(function (c) {
    return Promise.all(PHOTO_FILES.map(function (u) {
      return c.match(u).then(function (hit) { return hit || c.add(u); }).catch(function () { /* つながらない・置いていない写真は飛ばす */ });
    }));
  }).catch(function () {}));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('music-manager-app-') === 0 && k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
// 音楽・画像のファイル（アプリの部品ではないもの）は控えない
var SKIP_RE = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wma|json)(\?|$)/i;
self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP_RE.test(url.pathname)) return;
  if (PHOTO_RE.test(url.pathname)) {   // 再生画面の背景の写真：控えを先に使う
    ev.respondWith(caches.open(PHOTO_CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  ev.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});

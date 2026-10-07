/* =========================================================
   sw.js ― スマホで「ホーム画面に追加」したときのための service worker（v8.7）
   ・アプリの部品（index.html・style.css・js・アイコンなど、このフォルダの中のファイル）だけを控えておく
   ・ネットにつながるときは毎回新しいものを取りに行き（アプリを更新したらすぐ反映）、つながらないときだけ控えを使う
   ・音楽ファイルはアプリが blob: で再生するので、ここを通らない（控えない）。ほかのサイト（文字のフォントなど）も控えない
   ・登録は 59-mobile.js（http / https で開いたときだけ。file:// では登録しない）
   ========================================================= */

var CACHE_NAME = 'music-manager-app-v8.9.5';

self.addEventListener('install', function () { self.skipWaiting(); });
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
  ev.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});

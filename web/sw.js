/* 城市资本家 City Tycoon — Service Worker */
const CACHE_NAME = 'citytycoon-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/engine.js',
  './js/ai.js',
  './js/ui.js',
  './js/main.js',
  './js/multiplayer.js',
  './manifest.json'
];

// 安装时缓存所有资源
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        console.log('[SW] 缓存游戏资源');
        return cache.addAll(ASSETS);
      })
      .catch(function (err) {
        console.log('[SW] 缓存失败:', err);
      })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// 拦截请求，优先使用缓存
self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  // 跳过WebSocket请求
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function (cached) {
        // 有缓存则返回，否则从网络获取并缓存
        if (cached) {
          return cached;
        }
        return fetch(event.request)
          .then(function (response) {
            if (!response || response.status !== 200) {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(function (cache) {
                cache.put(event.request, responseToCache);
              });
            return response;
          })
          .catch(function (err) {
            console.log('[SW] 网络请求失败:', err);
            // 如果是HTML请求，返回离线页面
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// 监听消息
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* 城市资本家 City Tycoon — Service Worker */
const CACHE_NAME = 'citytycoon-v2';
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

// 拦截请求：同源资源采用“网络优先、缓存兜底”
// 这样改了 CSS/JS 后刷新即可生效，不需要每次手动升级 CACHE_NAME；
// 断网时仍会回落到缓存，离线可玩不受影响。
self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  // 跳过WebSocket请求
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(function (cache) {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(function () {
        console.log('[SW] 网络不可用，回落缓存');
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
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

// 虾群IM - Service Worker
// 缓存名称和版本
const CACHE_NAME = 'shrimp-im-v2';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// 安装事件 - 缓存核心资源
self.addEventListener('install', event => {
  console.log('Service Worker 安装中...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('正在缓存核心资源:', CACHE_URLS);
        // 逐个缓存资源，避免单个失败导致整体失败
        return Promise.all(
          CACHE_URLS.map(url => {
            return fetch(url, { credentials: 'same-origin' })
              .then(response => {
                if (response.ok) {
                  return cache.put(url, response);
                }
                console.warn('缓存失败，资源不可用:', url, response.status);
                return Promise.resolve();
              })
              .catch(err => {
                console.warn('缓存失败，网络错误:', url, err.message);
                return Promise.resolve(); // 继续缓存其他资源
              });
          })
        );
      })
      .then(() => {
        console.log('核心资源缓存完成');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('缓存初始化失败:', error);
        // 即使缓存失败也继续激活
        return self.skipWaiting();
      })
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  console.log('Service Worker 激活中...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('清理旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker 激活完成');
      return self.clients.claim();
    })
  );
});

// 获取事件 - 临时禁用缓存，直接传递所有请求
self.addEventListener('fetch', event => {
  // 跳过所有非GET请求
  if (event.request.method !== 'GET') return;
  
  // 跳过chrome-extension协议（浏览器插件）
  const url = new URL(event.request.url);
  if (url.protocol === 'chrome-extension:') return;
  
  // 跳过WebSocket连接
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  
  // 对于API请求，直接获取，不缓存
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // 对于manifest.json和favicon.ico，确保能正常获取
  if (event.request.url.includes('/manifest.json') || event.request.url.includes('/favicon.ico')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // 如果响应有效，尝试缓存（可选）
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseToCache))
              .catch(err => console.warn('缓存manifest/favicon失败:', err));
          }
          return response;
        })
        .catch(error => {
          console.warn('无法获取manifest/favicon:', error);
          // 尝试从缓存获取
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // 默认行为：尝试缓存优先，但失败时直接网络请求
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // 如果缓存中有且有效，直接返回
        if (cachedResponse) {
          console.log('从缓存返回:', event.request.url);
          return cachedResponse;
        }
        
        // 否则直接网络请求
        return fetch(event.request);
      })
      .catch(error => {
        console.error('缓存匹配失败，直接网络请求:', error);
        return fetch(event.request);
      })
  );
});

// 后台同步（需要浏览器支持）
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    console.log('后台同步消息...');
    // 这里可以同步离线时发送的消息
  }
});

// 推送通知（需要浏览器支持）
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : '虾群IM新消息',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 'message'
    },
    actions: [
      { action: 'open', title: '打开应用' },
      { action: 'close', title: '关闭' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('虾群IM', options)
  );
});

// 通知点击处理
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
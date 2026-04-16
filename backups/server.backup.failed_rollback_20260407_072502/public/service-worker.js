// 虾群IM - Service Worker
// 缓存名称和版本
const CACHE_NAME = 'shrimp-im-v1';
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
        return cache.addAll(CACHE_URLS);
      })
      .then(() => {
        console.log('核心资源缓存完成');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('缓存失败:', error);
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

// 获取事件 - 缓存优先，网络回退策略
self.addEventListener('fetch', event => {
  // 跳过WebSocket连接
  const url = new URL(event.request.url);
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  
  // 跳过非GET请求
  if (event.request.method !== 'GET') return;
  
  // 对于API请求，使用网络优先策略
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // API响应不缓存
          return response;
        })
        .catch(error => {
          console.error('API请求失败:', error);
          return new Response(JSON.stringify({ 
            error: '网络连接失败',
            offline: true 
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // 对于静态资源，使用缓存优先策略
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          console.log('从缓存返回:', event.request.url);
          return cachedResponse;
        }
        
        // 没有缓存，请求网络
        return fetch(event.request)
          .then(networkResponse => {
            // 检查是否为有效响应
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // 克隆响应以缓存
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
                console.log('新增缓存:', event.request.url);
              });
            
            return networkResponse;
          })
          .catch(() => {
            // 网络失败，对于HTML页面返回离线页面
            if (event.request.headers.get('Accept')?.includes('text/html')) {
              return caches.match('/index.html');
            }
            
            // 其他资源返回占位符
            return new Response('离线模式: 资源不可用', {
              headers: { 'Content-Type': 'text/plain' }
            });
          });
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
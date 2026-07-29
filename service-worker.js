/* =========================================================
   CHECKLIST ML — service-worker.js  (Parte 2/3)
   PWA: cache offline + push notifications
   ========================================================= */

const CACHE_NAME = 'checklist-ml-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/page.css',
  '/js/core.js',
  '/js/firebase.js',
  '/js/app.js',
  '/js/page.js',
  '/js/seed.js',
  '/assets/favicon.svg',
  '/assets/logo.svg',
  '/pages/home.html',
  '/pages/atividades.html',
  '/pages/arquivos.html',
  '/pages/IA.html',
  '/pages/perfil.html',
  '/pages/admin.html',
  '/pages/relatorios.html',
  '/pages/kanban.html',
  '/pages/calendario.html',
  '/pages/gamificacao.html',
  '/pages/foco.html',
  '/pages/custom.html',
  '/locales/pt-BR.json',
  '/locales/en.json',
  '/locales/es.json',
  '/manifest.json',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
];

/* ========== INSTALL ========== */
self.addEventListener('install', (event) => {
  console.log('👷 Service Worker instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Cacheando assets...');
      return cache.addAll(ASSETS).catch(err => {
        console.warn('⚠️ Alguns assets não puderam ser cacheados:', err);
      });
    })
  );
  self.skipWaiting();
});

/* ========== ACTIVATE ========== */
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker ativo');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

/* ========== FETCH (Cache First, Network Fallback) ========== */
self.addEventListener('fetch', (event) => {
  // Não cachear requisições de API
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('googleapis') ||
      event.request.url.includes('deepseek.com') ||
      event.request.url.includes('firebaseio.com') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Atualizar cache em background
        fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback - retornar página principal
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

/* ========== PUSH NOTIFICATIONS ========== */
self.addEventListener('push', (event) => {
  let data = { title: 'Checklist ML', body: 'Nova atividade pendente', icon: '/assets/favicon.svg' };
  
  if (event.data) {
    try {
      const payload = event.data.json();
      data.title = payload.title || data.title;
      data.body = payload.body || data.body;
      data.icon = payload.icon || data.icon;
      data.badge = payload.badge || data.icon;
      data.tag = payload.tag || 'checklist-ml';
      data.data = payload.data || {};
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.icon,
    tag: data.tag,
    data: data.data,
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Fechar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/index.html');
    })
  );
});

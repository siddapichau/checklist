/* =========================================================
   CHECKLIST ML — service-worker.js
   PWA resiliente: shell offline, atualização segura e push
   ========================================================= */

// v8 = recuperação de navegação no APK e cache de instalação resiliente.
// v10 = página Macros + botão de adicionar arquivo + claim de admin de uso único.
// v11 = correção do bug da API Key do DeepSeek (leitura de settings/admin
//       liberada para usuários autenticados, cache em sessionStorage).
// v12 = menu superior com dropdowns no desktop, IA com fallback via proxy
//       CORS + diagnóstico, atividades em cards compactos por status,
//       categorias por checkbox e horário de alerta por atividade.
// v13 = correção do crash da página Atividades (TDZ de STATUS_GROUPS deixava
//       a lista vazia e "Nova atividade" sem efeito), IA com proxy próprio
//       (Cloudflare Worker) + cadeia de canais em js/ai.js, e menu superior
//       inteligente com abertura/fechamento por hover com atraso.
// v14 = página Notas & Recados (recadinhos com lembrete, imagem .webp e
//       categorias próprias), correção dos botões Compartilhar/Comentários
//       (modais locais que executam os handlers da página) e diagnóstico das
//       regras do Firestore no teste de conexão da IA.
// v15 = Parte 2: 🤖 Ajuda desta página (js/help-ai.js + descrição por página),
//       Notas como lembretes (abas a vir/passadas, feito/pendente, sem
//       exclusão automática) e Macros com e-mail + campos c1–c10.
// v16 = correções da página Perfil (senha/reset), IA mais inteligente com
//       multi-pergunta, filtro para nunca trazer atividades futuras, remoção
//       do botão "Testar conexão" da página IA, exclusão definitiva de
//       atividades com modal próprio, botão "Não irei fazer hoje" e
//       remoção das atividades pré-programadas do seed.
// v17 = DADOS 100% NA NUVEM: Firestore como fonte da verdade, localStorage
//       apenas como cache visual/rápido. Escritas com fila de reenvio,
//       pull inicial do servidor, notificações/histórico da IA/pomodoro
//       sincronizados por usuário, chaves da IA fora do localStorage.
// v18 = Horário operacional fixo em São Paulo/SP (America/Sao_Paulo, UTC-3),
//       aprendizado contínuo da IA por usuário em Firestore e outbox persistente
//       para reenviar escritas pendentes mesmo após fechar o app offline.
const CACHE_NAME = 'checklist-ml-v18-sp-ia-learning-cloud';
const NETWORK_TIMEOUT_MS = 8000;
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
  '/js/ai.js',
  '/js/help-ai.js',
  '/assets/favicon.svg',
  '/assets/logo.svg',
  '/assets/logo-modern.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/pages/home.html',
  '/pages/atividades.html',
  '/pages/arquivos.html',
  '/pages/macros.html',
  '/pages/IA.html',
  '/pages/perfil.html',
  '/pages/admin.html',
  '/pages/relatorios.html',
  '/pages/kanban.html',
  '/pages/calendario.html',
  '/pages/notas.html',
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

/* ========== CICLO DE VIDA ========== */
self.addEventListener('install', event => {
  // cache.addAll é atômico: se uma CDN estiver indisponível, nenhum arquivo era
  // salvo e o APK podia ficar sem fallback. Cada arquivo agora é independente.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async asset => {
      try {
        await cache.add(asset);
      } catch (err) {
        console.warn('Asset não cacheado nesta instalação:', asset, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApiRequest(request) {
  const url = request.url;
  return url.includes('firestore') || url.includes('googleapis') ||
    url.includes('deepseek.com') || url.includes('api.groq.com') || url.includes('firebaseio.com');
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheResponse(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

async function navigationResponse(request) {
  // Network-first evita que uma tela HTML antiga/corrompida fique presa no APK.
  // Em conexão lenta a tentativa tem timeout e volta para o shell já cacheado.
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      cacheResponse(request, response.clone()).catch(() => {});
      return response;
    }
    throw new Error('Resposta de navegação inválida');
  } catch (err) {
    const cached = await caches.match(request) || await caches.match('/index.html');
    if (cached) return cached;
    return new Response(
      '<!doctype html><title>Sem conexão</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:24px"><h1>Sem conexão</h1><p>Verifique a internet e tente novamente.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function assetResponse(event) {
  const request = event.request;
  const cached = await caches.match(request);
  if (cached) {
    // Stale-while-revalidate mantém o app imediato, mas atualiza o próximo uso.
    // Não usamos event.waitUntil aqui porque a resposta já está em uma função
    // assíncrona; alguns WebViews rejeitam waitUntil fora do handler inicial.
    fetch(request).then(response => cacheResponse(request, response)).catch(() => {});
    return cached;
  }
  try {
    const response = await fetchWithTimeout(request);
    cacheResponse(request, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/* ========== FETCH ========== */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || isApiRequest(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  event.respondWith(assetResponse(event));
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

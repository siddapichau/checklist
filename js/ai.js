/* =========================================================
   CHECKLIST ML — ai.js
   Camada única de conexão com a IA (DeepSeek), usada pela
   página "IA Assistente" e pelo diagnóstico do Painel Admin.

   POR QUE ESTE ARQUIVO EXISTE
   ---------------------------
   A API do DeepSeek passou a rejeitar chamadas feitas direto do
   navegador: a resposta do preflight (OPTIONS) não traz o cabeçalho
   Access-Control-Allow-Origin, então o próprio navegador cancela a
   requisição com "Failed to fetch" ANTES de ela chegar ao servidor.
   Isso acontece mesmo com a API Key correta e com saldo na conta —
   e é exatamente o sintoma de "a IA não funciona, mas a chave está certa".

   Não existe conserto possível apenas no front-end: a chamada precisa
   sair de um servidor. Por isso a ordem de tentativas é:

     1. PROXY PRÓPRIO (recomendado)  → 100% confiável, sem limites de
        terceiros. Basta publicar o Cloudflare Worker de
        `proxy/cloudflare-worker.js` (grátis, ~5 min) e colar a URL em
        Administração → API / IA.
     2. CONEXÃO DIRETA                → só funciona se o DeepSeek voltar
        a liberar CORS, ou em WebView/APK sem checagem de origem.
     3. PROXIES CORS PÚBLICOS         → melhor esforço. São serviços de
        terceiros, com limite de uso e instabilidade; servem de
        salva-vidas, não de solução definitiva.
   ========================================================= */

(function () {
  const DEEPSEEK_HOST = 'https://api.deepseek.com';
  const CHAT_PATH = '/chat/completions';
  const MODELS_PATH = '/models';

  /* Proxies CORS públicos que encaminham POST + cabeçalho Authorization.
     Ordenados do mais confiável para o menos. */
  const PUBLIC_PROXIES = [
    { name: 'cors.workers.dev', wrap: url => 'https://test.cors.workers.dev/?' + url },
    { name: 'cors.lol',         wrap: url => 'https://api.cors.lol/?url=' + encodeURIComponent(url) },
    { name: 'thingproxy',       wrap: url => 'https://thingproxy.freeboard.io/fetch/' + url },
    { name: 'corsproxy.io',     wrap: url => 'https://corsproxy.io/?url=' + encodeURIComponent(url) },
  ];

  const normalizeBase = (url) => String(url || '').trim().replace(/\/+$/, '');

  // Normaliza a URL do proxy: remove a barra final E qualquer sufixo de
  // endpoint da API (chat/completions, models) que o usuário possa ter colado
  // por engano — o caminho correto é adicionado depois em buildAttempts.
  const normalizeProxy = (url) => String(url || '')
    .trim()
    .replace(/\/(v1\/)?(chat\/completions|models)\/?$/i, '')
    .replace(/\/+$/, '');

  /* Monta a lista ordenada de tentativas para um caminho da API. */
  function buildAttempts(path, { mode = 'auto', proxyUrl = '' } = {}) {
    const custom = normalizeProxy(proxyUrl);
    const attempts = [];

    const addCustom = () => {
      if (!custom) return;
      attempts.push({ kind: 'custom', label: 'proxy próprio', url: custom + path });
    };
    const addDirect = () => {
      attempts.push({ kind: 'direct', label: 'conexão direta', url: DEEPSEEK_HOST + path });
      attempts.push({ kind: 'direct', label: 'conexão direta (v1)', url: DEEPSEEK_HOST + '/v1' + path });
    };
    const addPublic = () => {
      PUBLIC_PROXIES.forEach(p =>
        attempts.push({ kind: 'proxy', label: 'proxy ' + p.name, url: p.wrap(DEEPSEEK_HOST + path) }));
    };

    if (mode === 'custom') { addCustom(); }
    else if (mode === 'direct') { addDirect(); }
    else if (mode === 'proxy') { addCustom(); addPublic(); }
    else { addCustom(); addDirect(); addPublic(); } // auto

    // Modo "custom" sem URL salva não pode ficar sem nenhuma tentativa.
    if (!attempts.length) { addDirect(); addPublic(); }
    return attempts;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  /* Traduz o código HTTP em uma instrução acionável para o usuário. */
  function httpError(status, detail) {
    const map = {
      400: 'A IA recusou o formato do pedido (400). Tente uma pergunta mais curta.',
      401: 'Chave da API inválida, expirada ou revogada (401). Gere uma nova em platform.deepseek.com e salve em Administração → API / IA.',
      402: 'Saldo insuficiente na conta DeepSeek (402). Recarregue em platform.deepseek.com.',
      403: 'Acesso negado pela API (403). Confirme se a chave pertence à conta DeepSeek correta.',
      429: 'Limite de requisições atingido (429). Aguarde alguns segundos e tente novamente.',
    };
    let msg = map[status];
    if (!msg && (status === 408 || status === 504)) msg = 'A IA demorou demais para responder. Tente novamente.';
    if (!msg && status >= 500) msg = `Servidor instável no momento (${status}). Tente novamente em instantes.`;
    if (!msg) msg = `Erro na API do DeepSeek (${status})${detail ? ': ' + detail : ''}`;

    const err = new Error(msg);
    err.status = status;
    // 401/402/403 são problemas de conta: trocar de canal não resolve, então
    // interrompe a cadeia em vez de martelar todos os proxies.
    err.fatal = [401, 402, 403].includes(status);
    return err;
  }

  const channelIcon = { custom: '🛡️', direct: '🔗', proxy: '🛰️' };

  /* Envia o chat completion percorrendo a cadeia de canais. */
  async function chat({ apiKey, systemPrompt, question, mode, proxyUrl, onProgress, timeoutMs = 45000 }) {
    if (!apiKey) throw new Error('Nenhuma API Key do DeepSeek configurada.');

    const attempts = buildAttempts(CHAT_PATH, { mode, proxyUrl });
    const tried = [];
    let lastError = null;

    for (const attempt of attempts) {
      try {
        if (onProgress) onProgress(attempt);
        const response = await fetchWithTimeout(attempt.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: question },
            ],
            temperature: 0.7,
            max_tokens: 1500,
          }),
        }, timeoutMs);

        if (!response.ok) {
          let detail = '';
          try { detail = (await response.clone().json())?.error?.message || ''; } catch (e) {}
          throw httpError(response.status, detail);
        }

        // Alguns proxies devolvem o JSON embrulhado em texto — parse tolerante.
        let result;
        const raw = await response.text();
        try { result = JSON.parse(raw); }
        catch (e) { throw new Error('O canal "' + attempt.label + '" devolveu uma resposta inválida.'); }

        const answer = result?.choices?.[0]?.message?.content;
        if (!answer) {
          if (result?.error?.message) throw httpError(result.error.code || 500, result.error.message);
          throw new Error('A IA respondeu sem conteúdo. Tente novamente.');
        }

        return { answer, channel: (channelIcon[attempt.kind] || '') + ' ' + attempt.label, attempt };
      } catch (err) {
        lastError = err;
        tried.push(attempt.label + ' → ' + (err.name === 'AbortError' ? 'tempo esgotado' : (err.message || 'falhou')));
        if (err.fatal) break;
      }
    }

    const error = lastError || new Error('Sem conexão com a IA');
    error.tried = tried;
    throw error;
  }

  /* Testa um canal específico com GET /models (leve e barato). */
  async function probe(attempt, apiKey, timeoutMs = 15000) {
    try {
      const res = await fetchWithTimeout(attempt.url, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
      }, timeoutMs);
      if (res.ok) return { ok: true, icon: '✅', detail: 'Canal acessível — a IA deve responder por aqui.' };

      // Tenta ler a mensagem real devolvida pelo proxy/DeepSeek.
      let detail = 'Canal respondeu HTTP ' + res.status + '.';
      try {
        const j = await res.clone().json();
        if (j?.error?.message) detail = 'HTTP ' + res.status + ': ' + j.error.message;
      } catch (_) { /* mantém o texto genérico */ }

      if (res.status === 401) return { ok: false, icon: '❌', detail: 'Canal acessível, mas a chave foi rejeitada (401). ' + detail };
      if (res.status === 402) return { ok: false, icon: '❌', detail: 'Canal acessível, mas a conta DeepSeek está sem saldo (402).' };
      return { ok: false, icon: '⚠️', detail };
    } catch (err) {
      return {
        ok: false, icon: '❌',
        detail: err?.name === 'AbortError'
          ? 'Sem resposta a tempo (rede lenta ou serviço fora do ar).'
          : 'Bloqueado pelo navegador (CORS) ou sem internet.',
      };
    }
  }

  /* Diagnóstico completo: chave + cada canal disponível. */
  async function diagnose({ apiKey, mode, proxyUrl, onStep }) {
    const rows = [];
    const push = (row) => { rows.push(row); if (onStep) onStep(rows); return row; };

    const modeLabel = {
      auto: 'Automático (proxy próprio → direto → proxies públicos)',
      custom: 'Somente proxy próprio',
      direct: 'Somente conexão direta',
      proxy: 'Somente proxies',
    }[mode] || 'Automático';
    push({ icon: 'ℹ️', title: 'Modo de conexão', detail: modeLabel });

    if (!apiKey) {
      push({ icon: '❌', title: 'API Key do DeepSeek', detail: 'Nenhuma chave encontrada. Salve em Administração → API / IA.' });
      return rows;
    }
    push({ icon: '✅', title: 'API Key do DeepSeek', detail: 'Chave encontrada (banco ou cache do navegador).' });

    if (!normalizeProxy(proxyUrl)) {
      push({
        icon: '⚠️', title: 'Proxy próprio não configurado',
        detail: 'O DeepSeek bloqueia chamadas diretas do navegador (CORS). Publique o Cloudflare Worker de proxy/cloudflare-worker.js (grátis) e cole a URL em Administração → API / IA. É o único caminho 100% confiável.',
      });
    }

    for (const attempt of buildAttempts(MODELS_PATH, { mode, proxyUrl })) {
      const result = await probe(attempt, apiKey);
      push({ icon: result.icon, title: 'Canal: ' + attempt.label, detail: result.detail });
    }
    return rows;
  }

  window.AIClient = {
    chat, probe, diagnose, buildAttempts, fetchWithTimeout, normalizeBase,
    PUBLIC_PROXIES, DEEPSEEK_HOST, CHAT_PATH, MODELS_PATH,
  };
})();

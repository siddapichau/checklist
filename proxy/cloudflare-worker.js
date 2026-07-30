/**
 * Checklist ML — Proxy da IA (Cloudflare Worker)
 * ================================================================
 * POR QUE ISSO É NECESSÁRIO
 * A API do DeepSeek não responde ao preflight CORS do navegador. Resultado:
 * o Chrome cancela a chamada com "Failed to fetch" antes de ela sair da
 * máquina, mesmo com a API Key correta e saldo na conta. A única correção
 * real é fazer a chamada sair de um servidor — é o que este Worker faz.
 *
 * ----------------------------------------------------------------
 * COMO PUBLICAR (grátis, ~5 minutos, sem cartão de crédito)
 * ----------------------------------------------------------------
 * 1. Acesse https://dash.cloudflare.com → "Workers & Pages" → "Create"
 *    → "Start with Hello World!" → "Deploy".
 * 2. Clique em "Edit code", apague tudo, cole ESTE arquivo inteiro e
 *    clique em "Deploy".
 * 3. Copie a URL do worker (algo como
 *    https://checklist-ia.SEU-USUARIO.workers.dev).
 * 4. No app: Administração → API / IA → cole a URL no campo
 *    "URL do proxy da IA" → Salvar. Pronto, a IA passa a funcionar.
 *
 * ----------------------------------------------------------------
 * SEGURANÇA (recomendado, opcional)
 * ----------------------------------------------------------------
 * • Restrinja as origens: troque ALLOWED_ORIGINS pela(s) URL(s) do seu app.
 *   Com '*' qualquer site pode usar o seu worker como proxy.
 * • Guarde a chave no servidor: em Settings → Variables, crie a variável
 *   secreta DEEPSEEK_API_KEY. Assim o Worker usa a chave dele mesmo e o
 *   navegador nunca precisa conhecê-la (mais seguro). Se a variável existir,
 *   ela tem prioridade sobre o cabeçalho Authorization enviado pelo app.
 */

// Use ['https://seu-app.web.app', 'https://seu-usuario.github.io'] em produção.
const ALLOWED_ORIGINS = ['*'];

const UPSTREAM = 'https://api.deepseek.com';
// Somente rotas de leitura/chat da API — evita transformar o worker em proxy aberto.
const ALLOWED_PATHS = [/^\/(v1\/)?chat\/completions$/, /^\/(v1\/)?models$/];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // Preflight: o passo que a API do DeepSeek deixa de responder.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Healthcheck: abrir a URL do worker no navegador confirma o deploy.
    if (path === '/' || path === '/health') {
      return json({ ok: true, service: 'checklist-ml-ia-proxy', upstream: UPSTREAM }, 200, origin);
    }

    // Extrai o endpoint da API, mesmo que o caminho venha duplicado
    // (ex.: quem colou a URL completa do endpoint no campo do proxy,
    // tipo https://worker.dev/chat/completions/chat/completions).
    const m = path.match(/\/(v1\/)?(chat\/completions|models)$/);
    const fwdPath = m ? '/' + m[0].replace(/^\//, '') : null;
    if (!fwdPath || !ALLOWED_PATHS.some(re => re.test(fwdPath))) {
      return json({ error: { message: 'Rota não permitida por este proxy: ' + path } }, 404, origin);
    }

    // A chave do ambiente (mais segura) tem prioridade — a menos que esteja
    // vazia (ex.: variável criada sem valor no dashboard), caso em que
    // voltamos a usar a chave enviada pelo app em vez de quebrar com 401.
    const clientAuth = request.headers.get('Authorization') || '';
    const envKey = env?.DEEPSEEK_API_KEY ? String(env.DEEPSEEK_API_KEY).trim() : '';
    const auth = envKey ? 'Bearer ' + envKey : clientAuth;
    if (!auth) {
      return json({ error: { message: 'API Key ausente. Envie o cabeçalho Authorization ou defina DEEPSEEK_API_KEY no Worker.' } }, 401, origin);
    }

    try {
      const upstream = await fetch(UPSTREAM + fwdPath + url.search, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body: request.method === 'GET' ? undefined : await request.text(),
      });

      const body = await upstream.text();

      // Erro do upstream: converte em JSON limpo com a mensagem real, para o
      // app mostrar o motivo exato (chave inválida, sem saldo, etc.) em vez
      // de um "erro desconhecido".
      if (!upstream.ok) {
        let message = body;
        try {
          const parsed = JSON.parse(body);
          message = parsed?.error?.message
            || (typeof parsed?.error === 'string' ? parsed.error : body);
        } catch (_) { /* mantém o texto original */ }
        return new Response(
          JSON.stringify({ error: { message: String(message).slice(0, 1000), status: upstream.status } }),
          { status: upstream.status, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      // Sucesso: repassa status e corpo, adicionando os headers CORS.
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          ...cors,
        },
      });
    } catch (err) {
      return json({ error: { message: 'Falha ao contatar a API do DeepSeek: ' + (err?.message || err) } }, 502, origin);
    }
  },
};

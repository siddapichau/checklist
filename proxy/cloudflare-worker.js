/**
 * Checklist ML — IA Proxy (Cloudflare Worker)
 * Suporte para DeepSeek e Groq (ou qualquer host OpenAI-compatible)
 * ================================================================
 */

const ALLOWED_ORIGINS = ['*'];

// Hosts padrão
const DEEPSEEK_HOST = 'https://api.deepseek.com';
const GROQ_HOST = 'https://api.groq.com/openai/v1';

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

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Healthcheck
    if (path === '/' || path === '/health') {
      return json({ ok: true, service: 'checklist-ml-ia-proxy' }, 200, origin);
    }

    // Determina o host de destino
    // 1. Prioridade para parâmetro ?host=
    // 2. Fallback para DeepSeek
    let upstreamHost = url.searchParams.get('host') || DEEPSEEK_HOST;
    upstreamHost = upstreamHost.replace(/\/+$/, '');

    // Extrai o endpoint
    const m = path.match(/\/(v1\/)?(chat\/completions|models)$/);
    const fwdPath = m ? '/' + m[0].replace(/^\//, '') : null;
    
    if (!fwdPath) {
       return json({ error: { message: 'Rota não permitida por este proxy: ' + path } }, 404, origin);
    }

    // Auth
    const clientAuth = request.headers.get('Authorization') || '';
    
    // Variáveis de ambiente opcionais para segurança extra (se definidas no Cloudflare)
    let envKey = '';
    if (upstreamHost.includes('deepseek')) envKey = env?.DEEPSEEK_API_KEY;
    else if (upstreamHost.includes('groq')) envKey = env?.GROQ_API_KEY;
    
    const auth = (envKey && envKey.trim()) ? 'Bearer ' + envKey.trim() : clientAuth;
    
    if (!auth) {
      return json({ error: { message: 'API Key ausente.' } }, 401, origin);
    }

    try {
      const upstreamResponse = await fetch(upstreamHost + fwdPath + url.search, {
        method: request.method,
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': auth 
        },
        body: request.method === 'GET' ? undefined : await request.text(),
      });

      const body = await upstreamResponse.text();

      if (!upstreamResponse.ok) {
        let message = body;
        try {
          const parsed = JSON.parse(body);
          message = parsed?.error?.message || parsed?.message || body;
        } catch (_) {}
        return new Response(
          JSON.stringify({ error: { message: String(message).slice(0, 1000), status: upstreamResponse.status } }),
          { status: upstreamResponse.status, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      return new Response(body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
          ...cors,
        },
      });
    } catch (err) {
      return json({ error: { message: 'Falha ao contatar a API: ' + (err?.message || err) } }, 502, origin);
    }
  },
};

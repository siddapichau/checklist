/* =========================================================
   CHECKLIST ML — help-ai.js
   Assistente contextual "🤖 Ajuda desta página".

   O que faz
   ---------
   - Injeta um botão flutuante "🤖 Ajuda desta página" em qualquer
     página do app (as páginas rodam dentro de iframes do shell).
   - Abre um painel que (1) explica COMO a página funciona — sempre
     disponível, mesmo offline ou sem chave de IA — e (2) permite
     fazer perguntas à IA, com a MESMA cadeia de conexão do js/ai.js
     (usada na página "IA Assistente" e no Painel Admin → API / IA).
   - A pergunta vai com o contexto da página atual: a IA já sabe onde
     o usuário está e o que a página faz, então responde dicas,
     otimizações e dúvidas específicas daquele lugar.

   Uso (em cada página, após carregar core.js, page.js e ai.js):
     PageHelpAI.mount({
       pageId: 'atividades',
       title: 'Atividades',
       intro: 'Uma frase resumindo a página',
       sections: [ { icon: '📋', title: 'Criar atividade', body: '...' } ],
       tips: [ 'Dica 1', 'Dica 2' ],
       quickQuestions: [ 'Como funciona esta página?', 'Como otimizar meu uso?' ],
       context: () => 'dados ao vivo da página (opcional)',
     });
   ========================================================= */

(function () {
  'use strict';

  const esc = (s) => (window.page && window.page.esc) ? window.page.esc(s) : String(s == null ? '' : s);

  let current = null;       // configuração da página montada
  let overlayEl = null;     // modal
  let btnEl = null;         // botão flutuante

  /* ---------- estilos (injetados uma única vez por documento) ---------- */
  const CSS = `
#phaBtn{position:fixed;right:18px;bottom:18px;z-index:900;display:inline-flex;align-items:center;gap:8px;
  padding:11px 16px;border:0;border-radius:999px;background:var(--primary,#2563EB);color:#fff;
  font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 10px 24px -10px rgba(37,99,235,.65);transition:.18s}
#phaBtn:hover{transform:translateY(-2px);box-shadow:0 14px 30px -10px rgba(37,99,235,.7)}
#phaOverlay{z-index:1200}
.pha-modal{width:min(660px,100%)}
.pha-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.pha-head h2{margin:0;font-size:19px}
.pha-close{border:0;background:var(--bg-secondary,#F1F5F9);border-radius:50%;width:34px;height:34px;
  cursor:pointer;font-size:13px;color:var(--text-secondary,#64748B);flex-shrink:0;transition:.15s}
.pha-close:hover{background:var(--line,#E2E8F0);color:var(--text,#1E293B)}
.pha-intro{font-size:13.5px;color:var(--text-secondary,#64748B);line-height:1.55;
  background:var(--bg-secondary,#F1F5F9);border:1px solid var(--line,#E2E8F0);border-radius:10px;
  padding:11px 13px;margin-bottom:12px}
.pha-sec{margin:14px 0}
.pha-sec h3{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;
  color:var(--muted,#94A3B8);margin-bottom:8px}
.pha-item{display:flex;gap:10px;padding:8px 11px;border:1px solid var(--line,#E2E8F0);border-radius:10px;
  background:var(--card,#fff);margin-bottom:6px;font-size:13px;line-height:1.5}
.pha-item .pha-ico{font-size:15px;line-height:1.4}
.pha-item b{display:block;font-size:13px;color:var(--text,#1E293B)}
.pha-item small{color:var(--text-secondary,#64748B)}
.pha-tips{display:flex;flex-direction:column;gap:6px;padding:0;margin:0;list-style:none}
.pha-tips li{font-size:13px;color:var(--text-secondary,#64748B);line-height:1.5;padding-left:20px;position:relative}
.pha-tips li::before{content:'💡';position:absolute;left:0;top:0;font-size:12px}
.pha-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.pha-chips button{border:1px dashed var(--line,#E2E8F0);background:transparent;border-radius:999px;
  padding:5px 12px;font-size:12px;cursor:pointer;color:var(--text-secondary,#64748B);transition:.15s}
.pha-chips button:hover{border-color:var(--primary,#2563EB);color:var(--primary,#2563EB)}
.pha-status{font-size:12px;color:var(--muted,#94A3B8);margin-top:8px;display:none;line-height:1.45}
.pha-answer{margin-top:12px;font-size:13.5px;line-height:1.65;color:var(--text,#1E293B)}
.pha-answer .pha-channel{display:block;font-size:11.5px;color:var(--muted,#94A3B8);margin-bottom:6px}
/* resposta da IA formatada (mesmo visual da página IA Assistente) */
.pha-answer .ai-md p{margin:8px 0}
.pha-answer .ai-md .ai-md-title{font-size:13.5px;font-weight:800;color:var(--primary,#2563EB);
  margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--primary-light,#DBEAFE)}
.pha-answer .ai-md .ai-md-title:first-child{margin-top:0}
.pha-answer .ai-md .ai-md-list{margin:4px 0 10px;padding-left:6px;display:flex;flex-direction:column;gap:5px;list-style:none}
.pha-answer .ai-md .ai-md-list li{position:relative;padding:6px 9px 6px 24px;background:var(--bg-secondary,#F8FAFC);
  border:1px solid var(--line,#E2E8F0);border-radius:8px;line-height:1.5}
.pha-answer .ai-md ul.ai-md-list>li::before{content:'•';position:absolute;left:10px;top:6px;font-weight:800;color:var(--primary,#2563EB)}
.pha-answer .ai-md ol.ai-md-list{list-style:decimal;padding-left:24px}
.pha-answer .ai-md ol.ai-md-list>li{padding-left:6px}
.pha-answer .ai-md ol.ai-md-list>li::marker{color:var(--primary,#2563EB);font-weight:800}
.pha-answer .ai-md .ai-md-hr{border:0;border-top:1px dashed var(--line,#CBD5E1);margin:12px 0}
.pha-answer .ai-md code{background:var(--bg-secondary,#F1F5F9);border:1px solid var(--line,#E2E8F0);border-radius:5px;padding:1px 5px;font-size:12px}
.pha-note{display:block;font-size:11.5px;color:var(--muted,#94A3B8);margin-top:10px;line-height:1.5}
`;

  function injectStyles() {
    if (document.getElementById('pha-styles')) return;
    const st = document.createElement('style');
    st.id = 'pha-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- montagem ---------- */
  function mount(cfg) {
    if (!cfg || !cfg.pageId) return;
    current = Object.assign({
      title: 'Esta página',
      intro: '',
      sections: [],
      tips: [],
      quickQuestions: [],
      context: null,
    }, cfg);
    injectStyles();
    buildButton();
    buildModal();
    return { open, close };
  }

  function buildButton() {
    if (document.getElementById('phaBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'phaBtn';
    btn.type = 'button';
    btn.innerHTML = '🤖 Ajuda desta página';
    btn.title = 'Tire dúvidas, veja dicas e entenda como esta página funciona';
    btn.onclick = open;
    document.body.appendChild(btn);
    btnEl = btn;
  }

  function buildModal() {
    if (document.getElementById('phaOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.id = 'phaOverlay';
    // O pop-up NÃO fecha ao clicar fora (overlay): evita perder a digitação
    // por um toque acidental — só fecha no botão ✕.
    overlay.innerHTML = `
      <div class="modal pha-modal" role="dialog" aria-label="Ajuda desta página">
        <div class="pha-head">
          <h2>🤖 Ajuda desta página</h2>
          <button type="button" class="pha-close" onclick="PageHelpAI.close()" title="Fechar">✕</button>
        </div>
        <div class="pha-body" id="phaBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlayEl = overlay;
  }

  function open() {
    if (!current) return;
    renderLocal();
    overlayEl.classList.remove('hidden');
  }

  function close() {
    if (overlayEl) overlayEl.classList.add('hidden');
  }

  /* ---------- conteúdo local (sempre disponível) ---------- */
  function renderLocal() {
    const c = current;
    const sectionsHtml = (c.sections || []).map(s => `
      <div class="pha-item">
        <span class="pha-ico">${s.icon || '•'}</span>
        <div><b>${esc(s.title || '')}</b><small>${esc(s.body || '')}</small></div>
      </div>`).join('');
    const tipsHtml = (c.tips || []).map(t => `<li>${esc(t)}</li>`).join('');
    const chipsHtml = (c.quickQuestions || []).map((q, i) =>
      `<button type="button" onclick="PageHelpAI.quick('${i}')">${esc(q)}</button>`).join('');

    document.getElementById('phaBody').innerHTML = `
      ${c.intro ? `<div class="pha-intro">${esc(c.intro)}</div>` : ''}
      ${sectionsHtml ? `<div class="pha-sec"><h3>ℹ️ Como esta página funciona</h3>${sectionsHtml}</div>` : ''}
      ${tipsHtml ? `<div class="pha-sec"><h3>💡 Dicas rápidas</h3><ul class="pha-tips">${tipsHtml}</ul></div>` : ''}
      <div class="pha-sec">
        <h3>❓ Pergunte à IA sobre esta página</h3>
        <div class="pha-chips">${chipsHtml}</div>
        <textarea id="phaQuestion" rows="3" placeholder="Ex: Como funciona esta página? / Quais os passos para ...? / Tem como otimizar ...?"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-primary" id="phaAskBtn" onclick="PageHelpAI.ask()">✨ Perguntar à IA</button>
          <button type="button" class="btn btn-secondary" onclick="PageHelpAI.copyHelp()" title="Copiar o guia desta página">📋 Copiar guia</button>
        </div>
        <div class="pha-status" id="phaStatus"></div>
        <div class="pha-answer" id="phaAnswer"></div>
      </div>`;
  }

  /* ---------- perguntas rápidas ---------- */
  function quick(idx) {
    const c = current || {};
    const q = (c.quickQuestions || [])[idx];
    if (!q) return;
    const ta = document.getElementById('phaQuestion');
    if (ta) ta.value = q;
    if (ta) ta.focus();
  }

  /* ---------- configuração da IA (mesma lógica da página IA) ---------- */
  async function aiConfig() {
    let provider = 'deepseek';
    try {
      const adminCfg = await page.getAdminConfig();
      provider = adminCfg.aiProvider || provider;
    } catch (e) {}
    let apiKey = '';
    try {
      apiKey = provider === 'groq' ? await page.getGroqKey() : await page.getDeepseekKey();
    } catch (e) {}
    return { apiKey, provider, mode: page.getAIMode(), proxyUrl: page.getAIProxyUrl() };
  }

  function buildSystemPrompt() {
    const c = current;
    const lines = [
      'Você é o assistente "🤖 Ajuda desta página" do sistema de gestão operacional de um Centro Logístico do Mercado Livre (Checklist ML).',
      `O usuário está agora na página "${c.title}" (id: ${c.pageId}).`,
      '',
      'COMO ESTA PÁGINA FUNCIONA (use como base, não invente outros recursos):',
    ];
    if (c.intro) lines.push(c.intro);
    (c.sections || []).forEach(s => lines.push(`- ${s.title}: ${s.body}`));
    if ((c.tips || []).length) {
      lines.push('', 'DICAS ÚTEIS PARA ESTA PÁGINA:');
      c.tips.forEach(t => lines.push('- ' + t));
    }
    if (typeof c.context === 'function') {
      try {
        const ctx = c.context();
        if (ctx) lines.push('', 'DADOS ATUAIS DO USUÁRIO NESTA PÁGINA:', String(ctx));
      } catch (e) {}
    }
    lines.push('',
      'Responda em português, de forma clara, prática e objetiva. Use emojis e passos numerados quando fizer sentido.',
      'Formatação obrigatória: seções com título "## emoji Título", uma linha em branco entre seções, itens de lista começando com "- ", passos numerados "1. 2. 3." e frases curtas. Separe blocos grandes com uma linha "---".',
      'Nunca mostre IDs numéricos internos (ex.: [1722123456789]); cite registros sempre pelo nome/título.',
      'Se a pergunta for sobre outra página ou sobre o sistema em geral, responda brevemente e direcione para a página certa.');
    return lines.join('\n');
  }

  /* ---------- resposta local (fallback sem IA) ---------- */
  function localAnswer(question) {
    const c = current;
    const q = String(question || '').toLowerCase();
    const list = (arr) => arr.map(t => '- ' + t).join('\n');

    if (q.includes('como funciona') || q.includes('o que faz') || q.includes('o que é') || q.includes('como usar') || q.includes('explica')) {
      let r = `🤖 **Como funciona a página "${c.title}"**\n\n${c.intro || ''}\n\n`;
      (c.sections || []).forEach(s => { r += `**${s.title}**\n${s.body}\n\n`; });
      return r;
    }
    if (q.includes('dica') || q.includes('otimiz') || q.includes('melhor') || q.includes('produtiv')) {
      let r = `💡 **Dicas para aproveitar melhor "${c.title}":**\n\n${list(c.tips || [])}`;
      if (!(c.tips || []).length) r = `💡 **Dicas:** use a IA configurada para receber sugestões personalizadas desta página.`;
      return r;
    }
    return `🤖 **Sobre "${c.title}":**\n\n${c.intro || ''}\n\n${list((c.tips || []).slice(0, 3))}\n\nPara uma resposta mais específica, configure a chave da IA (Administração → API / IA) — assim a IA analisa seus dados reais.`;
  }

  /* O renderizador completo mora em js/ai.js (AIClient.formatAnswer): títulos
     de seção, listas espaçadas, separadores e remoção de IDs técnicos. */
  function formatAnswer(text) {
    if (window.AIClient && typeof AIClient.formatAnswer === 'function') return AIClient.formatAnswer(text);
    return esc(String(text || ''))
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>');
  }

  /* ---------- perguntar ---------- */
  async function ask() {
    const c = current;
    if (!c) return;
    const ta = document.getElementById('phaQuestion');
    const question = (ta ? ta.value : '').trim();
    if (!question) { if (page && page.toast) page.toast('Digite uma pergunta sobre esta página', 'warning'); return; }

    const btn = document.getElementById('phaAskBtn');
    const status = document.getElementById('phaStatus');
    const answer = document.getElementById('phaAnswer');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Perguntando...'; }
    if (status) { status.style.display = 'block'; status.textContent = 'Conectando à IA…'; }
    if (answer) answer.innerHTML = '';

    const local = localAnswer(question);
    let cfg = { apiKey: '', provider: 'deepseek', mode: 'auto', proxyUrl: '' };

    try {
      cfg = await aiConfig();
      if (!cfg.apiKey) {
        if (status) status.textContent = 'Modo offline — sem chave da IA configurada nesta conta.';
        showAnswer(
          local +
          '\n\n— 🤖 Esta explicação foi gerada localmente. Para respostas com análise dos seus dados, um administrador deve configurar a chave em Administração → API / IA.',
          '', true);
      } else {
        const { answer: aiAnswer, channel } = await AIClient.chat({
          apiKey: cfg.apiKey,
          systemPrompt: buildSystemPrompt(),
          question,
          mode: cfg.mode,
          provider: cfg.provider,
          proxyUrl: cfg.proxyUrl,
          onProgress: (attempt) => { if (status) status.textContent = `Conectando (${attempt.label})…`; },
        });
        if (status) status.textContent = '';
        showAnswer(aiAnswer, channel, false);
      }
      core.log('ai_help', (page.getUser() || {}).id, (c.pageId + ': ' + question).slice(0, 80));
    } catch (err) {
      if (status) status.textContent = '';
      const hint = err && err.status
        ? err.message
        : 'A IA não respondeu agora (sem internet, CORS ou limite dos canais). Use "Testar conexão" na página IA Assistente para diagnosticar.';
      showAnswer(`⚠️ **Não foi possível consultar a IA.**\n\n${hint}\n\n---\n\n` + local, '', true);
    }

    if (btn) { btn.disabled = false; btn.textContent = '✨ Perguntar à IA'; }
  }

  function showAnswer(text, channel, isLocal) {
    const el = document.getElementById('phaAnswer');
    if (!el) return;
    el.innerHTML = `
      ${channel ? `<span class="pha-channel">Respondido via ${esc(channel)}</span>` : ''}
      <div class="ai-md">${formatAnswer(text)}</div>
      ${isLocal ? '<span class="pha-note">ℹ️ Resposta local da página (a IA real está disponível quando a API Key estiver configurada).</span>' : ''}`;
  }

  /* ---------- copiar o guia da página ---------- */
  function copyHelp() {
    const c = current;
    if (!c) return;
    let text = `🤖 GUIA — ${c.title}\n\n${c.intro || ''}\n\n`;
    (c.sections || []).forEach(s => { text += `• ${s.title}: ${s.body}\n`; });
    text += `\n💡 Dicas:\n` + (c.tips || []).map(t => `- ${t}`).join('\n');
    const done = () => { if (page && page.toast) page.toast('Guia copiado! 📋', 'success'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else fallbackCopy(text, done);
    } catch (e) { fallbackCopy(text, done); }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  window.PageHelpAI = { mount, open, close, ask, quick, copyHelp };
})();

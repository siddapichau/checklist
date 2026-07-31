/* Shared iframe helpers: keeps every page visually identical to the shell. */
(function () {
  const root = document.documentElement;
  const applyCustomTheme = (theme) => {
    try {
      const data = core.getLocalDB();
      if ((data.customThemes || []).some(item => item.id === theme)) core.applyCustomTheme(theme);
    } catch (_) {}
  };
  const apply = (theme, mode) => {
    root.dataset.theme = theme || 'ocean';
    root.dataset.mode = mode === 'auto'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : (mode || 'light');
    applyCustomTheme(root.dataset.theme);
  };
  try {
    const parentRoot = window.parent.document.documentElement;
    apply(parentRoot.dataset.theme, parentRoot.dataset.mode);
    new MutationObserver(() => apply(parentRoot.dataset.theme, parentRoot.dataset.mode))
      .observe(parentRoot, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
    const syncStyle = () => {
      const source = window.parent.document.getElementById('custom-theme-style');
      if (!source) return;
      let target = document.getElementById('custom-theme-style');
      if (!target) { target = document.createElement('style'); target.id = 'custom-theme-style'; document.head.appendChild(target); }
      target.textContent = source.textContent;
    };
    syncStyle();
    new MutationObserver(syncStyle).observe(window.parent.document.head, { childList: true, subtree: true, characterData: true });
  } catch (_) {
    const settings = core.getLocalDB().settings;
    apply(settings.theme, settings.mode);
  }
  window.addEventListener('message', event => {
    if (event.data?.type === 'themeChanged') apply(event.data.theme, event.data.mode);
    if (event.data?.type === 'firebaseSync') {
      // Re-renderizar a página se a função render() existir
      if (typeof render === 'function') render();
      // Em notas e atividades, também recarregar categorias pois podem vir de settings
      if (event.data.collection === 'settings' && typeof initCategories === 'function') initCategories();
    }
  });
})();

const Page = {
  getUser() { return core.getCurrentUser(); }, getDB() { return core.getLocalDB(); }, saveDB(d) { core.saveLocalDB(d); },
  toast(msg, type) { core.toast(msg, type); }, chromeNotification(title, body, type) { core.chromeNotification(title, body, type); }, esc(s) { return core.escapeHTML(s); },
  _post(message) { if (window.parent && window.parent !== window) window.parent.postMessage(message, window.location.origin); },
  reload() { this._post({ type: 'reload' }); }, navigate(page) { this._post({ type: 'navigate', page }); },
  openModal(html) { this._post({ type: 'modal', html }); }, closeModal() { this._post({ type: 'closeModal' }); },
  syncDocument(collection, id, data) { this._post({ type: 'firebaseSync', collection, id, data }); },
  deleteDocument(collection, id) { this._post({ type: 'firebaseDelete', collection, id }); }, syncSettings(settings) { this._post({ type: 'firebaseSettings', settings }); },
  syncGamification(userId, stats) { this._post({ type: 'firebaseGamification', userId, stats }); },
  syncWidgets(userId, widgets) { this._post({ type: 'firebaseWidgets', userId, widgets }); },
  async getAdminConfig() { if (!window.parent?.fireSync) throw new Error('Sincronização Firebase indisponível'); return window.parent.fireSync.getAdminConfig(); },
  async saveAdminConfig(config) { if (!window.parent?.fireSync) throw new Error('Sincronização Firebase indisponível'); return window.parent.fireSync.saveAdminConfig(config); },
  async getDeepseekKey() { return window.parent?.fireSync ? window.parent.fireSync.getDeepseekKey() : ''; },
  async getGroqKey() { return window.parent?.fireSync?.getGroqKey ? window.parent.fireSync.getGroqKey() : ''; },
  getAIMode() { return window.parent?.fireSync?.getAIMode ? window.parent.fireSync.getAIMode() : 'auto'; },
  getAIProxyUrl() { return window.parent?.fireSync?.getAIProxyUrl ? window.parent.fireSync.getAIProxyUrl() : ''; },
  async i18nReady() { await core.tReady(); }, t(key, fallback) { return core.t(key, fallback); }, applyI18n(root) { core.applyI18n(root || document); },
  getTheme() { return core.getLocalDB().settings.theme; }, getMode() { return core.getLocalDB().settings.mode; }, getLanguage() { return core.getCurrentLang(); },
  setLanguage(lang) { core.setLanguage(lang); setTimeout(() => location.reload(), 100); },

  /* ---------- IA Helper Genérico por Página ---------- */
  _pageDescriptions: {
    'home': 'Visão Geral: dashboard com métricas filtradas por período (dia, 7d, 30d) sempre do dia atual para trás, sem futuro. Widgets arrastáveis, atrasadas, pendentes do período, progresso.',
    'atividades': 'Atividades: criação, edição, status, prioridades, categorias, recorrência, comentários, anexos. Filtros por status, categoria, data. Atrasadas são destacadas.',
    'kanban': 'Kanban: quadro com colunas por status (pendente, analisando, finalizada). Arraste cards para mudar status. Útil para fluxo visual.',
    'calendario': 'Calendário: visualiza tarefas e notas em grade mensal/semanal. Clique em um dia para ver detalhes, crie nova no dia clicado.',
    'notas': 'Notas & Recadinhos: cada nota tem data e hora do aviso. Ao entrar vê ativas (hoje/futuro), aba pendentes (passou da data e não feita), já passaram, feitas. Só é excluída manualmente, marca como feita.',
    'gamificacao': 'Conquistas: pontos por finalizar, sequência diária (streak), badges por marcos (primeira, 5, 25, 100), ranking semanal.',
    'foco': 'Modo Foco / Pomodoro: timer 25min com pausas, bloqueia distrações, conta sessões do dia, pode selecionar tarefa para focar.',
    'custom': 'Personalizar: cria temas custom com cores primária, secundária, etc. Aplica tema claro/escuro por usuário.',
    'arquivos': 'Arquivos: biblioteca de links, documentos, planilhas, vídeos. Thumbnail auto por tipo, busca e categorias.',
    'macros': 'Macros: modelos de mensagem com variáveis {{nome}} e campos {c1}..{c10}. Tipo texto ou e-mail (abre Gmail com destinatários e conteúdo copiado para colar com Ctrl+V).',
    'relatorios': 'Relatórios: gráficos modernos de status, categoria, prioridade, tempo médio, tendências semanal/mensal, tabela detalhada, export CSV. Filtro por período sempre para trás.',
    'IA': 'IA Assistente: chat com a IA configurada (DeepSeek/Groq) via proxy próprio. Pode tirar dúvidas de qualquer página, pedir dicas, otimizar textos.',
    'perfil': 'Meu Perfil: edita nome, avatar, senha, preferências de tema (claro/escuro/auto) por usuário, idioma.',
    'admin': 'Painel Admin: gerencia usuários, cargos, menu, categorias, notas, posts, arquivos, aparência padrão, chaves de IA (DeepSeek/Groq) salvas em settings/admin.'
  },

  getPageIdFromURL(){
    try{
      const path=window.location.pathname||'';
      const m=path.match(/\/pages\/([^\.\?]+)\.html/);
      return m?m[1]:'home';
    }catch{return 'home';}
  },

  getPageDescription(pageId){
    return this._pageDescriptions[pageId] || 'Página do Checklist ML.';
  },

  injectAIFloat(){
    if(document.getElementById('aiFloatBtn')) return;
    // Não injetar no admin se já tem muito conteúdo? Mas vamos injetar em todas exceto se já tem botão próprio grande
    const style=document.createElement('style');
    style.textContent=`
      #aiFloatBtn{position:fixed;bottom:22px;right:22px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#06B6D4);color:#fff;border:0;box-shadow:0 8px 24px rgba(37,99,235,.35);font-size:26px;cursor:pointer;z-index:9999;display:flex;align-items:center;justify-content:center;transition:.2s}
      #aiFloatBtn:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 12px 32px rgba(37,99,235,.45)}
      #aiFloatPanel{position:fixed;bottom:90px;right:22px;width:min(380px,92vw);max-height:70vh;background:var(--card,#fff);border:1px solid var(--line,#E2E8F0);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.18);z-index:9999;display:none;flex-direction:column;overflow:hidden;animation:slideUp .25s ease}
      #aiFloatPanel.open{display:flex}
      #aiFloatPanel .ai-head{padding:14px 16px;border-bottom:1px solid var(--line,#E2E8F0);display:flex;justify-content:space-between;align-items:center;font-weight:800}
      #aiFloatPanel .ai-body{padding:12px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px}
      #aiFloatPanel .ai-input-row{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#E2E8F0);background:var(--bg-secondary,#F8FAFC)}
      #aiFloatPanel .ai-input-row input{flex:1}
      #aiFloatPanel .ai-msg{padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.5;max-width:90%}
      #aiFloatPanel .ai-msg.user{align-self:flex-end;background:var(--primary,#2563EB);color:#fff}
      #aiFloatPanel .ai-msg.bot{align-self:flex-start;background:var(--bg-secondary,#F1F5F9);color:var(--text,#1E293B);border:1px solid var(--line,#E2E8F0)}
      #aiFloatPanel .ai-quick{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
      #aiFloatPanel .ai-quick button{border:1px solid var(--line,#E2E8F0);background:var(--card,#fff);border-radius:20px;padding:5px 10px;font-size:11px;cursor:pointer}
    `;
    document.head.appendChild(style);

    const btn=document.createElement('button');
    btn.id='aiFloatBtn';
    btn.title='Assistente IA — tire dúvidas desta página';
    btn.innerHTML='🤖';
    btn.onclick=()=>Page.toggleAIPanel();
    document.body.appendChild(btn);

    const panel=document.createElement('div');
    panel.id='aiFloatPanel';
    const pageId=Page.getPageIdFromURL();
    const desc=Page.getPageDescription(pageId);
    panel.innerHTML=`
      <div class="ai-head"><span>🤖 IA — ${page.esc(pageId)}</span><button style="border:0;background:transparent;font-size:18px;cursor:pointer" onclick="Page.toggleAIPanel()">✕</button></div>
      <div class="ai-body" id="aiFloatBody">
        <div class="ai-msg bot"><b>Como funciona ${page.esc(pageId)}?</b><br>${page.esc(desc)}</div>
        <div class="ai-quick" id="aiQuickBtns"></div>
        <div id="aiFloatAnswers"></div>
      </div>
      <div class="ai-input-row"><input type="text" id="aiFloatInput" placeholder="Pergunte algo sobre esta página..." onkeydown="if(event.key==='Enter')Page.sendAIFloat()"><button class="btn btn-primary btn-sm" onclick="Page.sendAIFloat()">Enviar</button></div>
    `;
    document.body.appendChild(panel);

    // quick buttons per page
    const quickMap={
      'home':['Como funciona o dashboard?','Dicas de produtividade','O que significa cada widget?'],
      'atividades':['Como criar atividade recorrente?','Como usar prioridades?','O que fazer com atrasadas?'],
      'notas':['Como funciona o lembrete?','Quando uma nota fica pendente?','Como organizar minhas notas?'],
      'macros':['Como usar {c1} a {c10}?','Exemplo de macro de e-mail','Dicas de texto rápido'],
      'relatorios':['Explique os gráficos','Como melhorar taxa de conclusão?','O que é tempo médio?'],
      'kanban':['Como mover cards?','Para que serve o Kanban?'],
      'calendario':['Como funciona o calendário?','Como criar atividade em um dia?'],
      'arquivos':['Como organizar arquivos?','Que tipos são suportados?'],
      'IA':['Como configurar a IA?','Diferença DeepSeek e Groq?']
    };
    const quicks=quickMap[pageId]||['Como funciona esta página?','Me dê dicas','Otimize meu fluxo'];
    const qContainer=panel.querySelector('#aiQuickBtns');
    qContainer.innerHTML=quicks.map(q=>`<button onclick="Page.askAIFloat('${page.esc(q).replace(/'/g,"\\'")}')">${page.esc(q)}</button>`).join('');
  },

  toggleAIPanel(){
    const p=document.getElementById('aiFloatPanel');
    if(!p) return;
    p.classList.toggle('open');
  },

  async askAIFloat(q){
    const input=document.getElementById('aiFloatInput');
    if(input) input.value=q;
    return this.sendAIFloat();
  },

  async sendAIFloat(){
    const input=document.getElementById('aiFloatInput');
    const body=document.getElementById('aiFloatBody');
    const answers=document.getElementById('aiFloatAnswers');
    if(!input||!body) return;
    const question=(input.value||'').trim();
    if(!question) return;
    // add user message
    const userMsg=document.createElement('div');
    userMsg.className='ai-msg user';
    userMsg.textContent=question;
    answers.appendChild(userMsg);
    input.value='';
    body.scrollTop=body.scrollHeight;

    const botMsg=document.createElement('div');
    botMsg.className='ai-msg bot';
    botMsg.textContent='🤖 Pensando...';
    answers.appendChild(botMsg);
    body.scrollTop=body.scrollHeight;

    try{
      const key=await this.getDeepseekKey().catch(()=> '') || await this.getGroqKey().catch(()=> '');
      const pageId=this.getPageIdFromURL();
      const desc=this.getPageDescription(pageId);
      const data=this.getDB();
      const user=this.getUser()||{};
      let context=`Você é assistente do Checklist ML, página ${pageId}. Descrição: ${desc}. Usuário: ${user.name||user.username||'operador'}. Data hoje: ${core.today()}.`;
      // add some stats
      if(pageId==='home'||pageId==='relatorios'||pageId==='atividades'){
        const tasks=(data.tasks||[]).filter(t=>!user.id||!t.owner||String(t.owner)===String(user.id||user.uid));
        const today=core.today();
        const pending=tasks.filter(t=>t.status!=='finished'&&t.date<=today).length;
        context+=` Tarefas totais do usuário ${tasks.length}, pendentes até hoje ${pending}.`;
      }
      if(!key){
        botMsg.innerHTML=`<b>🤖 Dica offline:</b><br>${page.esc(this.getOfflineAnswer(pageId, question))}`;
        body.scrollTop=body.scrollHeight;
        return;
      }
      let aiProvider='deepseek';
      try{ const cfg=await this.getAdminConfig(); aiProvider=cfg.aiProvider||'deepseek'; }catch{}
      // ensure AIClient available (from parent or current)
      const client=window.AIClient || window.parent?.AIClient;
      if(!client){
        botMsg.innerHTML=`<b>🤖</b><br>${page.esc(this.getOfflineAnswer(pageId, question))} <br><small style="color:var(--muted)">(IA offline nesta página, mas a dica acima ajuda)</small>`;
        return;
      }
      const res=await client.chat({
        apiKey:key,
        provider:aiProvider,
        systemPrompt:context+' Responda em pt-BR, curto, prático, com bullets se útil. Explique como funciona a página quando perguntado.',
        question,
        mode:this.getAIMode(),
        proxyUrl:this.getAIProxyUrl()
      });
      botMsg.textContent=res.answer||'Sem resposta';
      botMsg.innerHTML=`${page.esc(res.answer).replace(/\\n/g,'<br>')}`;
    }catch(err){
      botMsg.textContent='⚠️ '+(err.message||'Erro IA') + ' — ' + this.getOfflineAnswer(this.getPageIdFromURL(), question);
    }
    body.scrollTop=body.scrollHeight;
  },

  getOfflineAnswer(pageId, q){
    const base=this.getPageDescription(pageId);
    const lower=(q||'').toLowerCase();
    if(lower.includes('como funciona')){
      return base;
    }
    if(pageId==='atividades'&&lower.includes('atras')){
      return 'Atrasadas são tarefas com data menor que hoje e status diferente de finalizada. Use o filtro de pendentes e finalize primeiro as urgentes.';
    }
    if(pageId==='notas'){
      return 'Notas têm data/hora do aviso. Ao entrar você vê ativas (hoje/futuro). Passou da data fica pendente até marcar como feita. Só exclui manualmente.';
    }
    if(pageId==='macros'){
      return 'Use {c1}..{c10} no texto, ex: Olá {c1}, seu pedido {c2}. Ao usar, preencha os campos. Tipo e-mail abre Gmail com Para e Assunto, conteúdo copiado para Ctrl+V.';
    }
    if(pageId==='home'){
      return 'Dashboard mostra só até hoje, sem futuro. Filtre por Dia, 7 dias, 30 dias. Widgets são arrastáveis. Atrasadas ficam em destaque.';
    }
    if(pageId==='relatorios'){
      return 'Relatórios: status, categoria, prioridade, tempo médio, tendências. Filtre por período para ver evolução. Taxa <40% indica gargalo.';
    }
    return base + ' Dica: use os filtros da página para focar no que importa e mantenha a rotina de marcar como feito.';
  }
};
window.page = Page;

// Auto-inject floating IA button após carregar DOM (exceto na página IA que já tem chat completo)
setTimeout(()=>{
  try{
    const pid=Page.getPageIdFromURL();
    if(pid!=='IA'){ // IA page já tem assistente completo
      Page.injectAIFloat();
    }
  }catch{}
}, 600);


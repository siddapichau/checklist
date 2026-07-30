/* =========================================================
   CHECKLIST ML — core.js  (Parte 1/3 + 3/3)
   Módulo central: utilitários, dados, validação, i18n,
   temas custom, dark mode, gamificação, automação
   ========================================================= */

const Core = {
  /* ---------- DADOS LOCAIS (fallback se Firebase offline) ---------- */
  _localKey: 'checklist-ml-local',

  _defaults: {
    settings: {
      brand: 'Checklist ML',
      theme: 'ocean',        // ocean | mercado | forest | custom
      mode: 'light',          // light | dark | auto
      logo: '',
      favicon: '',
      language: 'pt-BR',      // pt-BR | en | es
      menuOrder: ['home','atividades','kanban','calendario','gamificacao','foco','custom','arquivos','macros','relatorios','IA','perfil','admin'],
      // Segredos de integração (ex.: DeepSeek) não pertencem ao localStorage.
      // Eles ficam em settings/admin no Firestore, com leitura restrita ao admin.
      menuItems: [
        { id:'home',         label:'Visão geral',   icon:'📊', visible:true },
        { id:'atividades',   label:'Atividades',    icon:'✅', visible:true },
        { id:'kanban',       label:'Kanban',        icon:'📋', visible:true },
        { id:'calendario',   label:'Calendário',    icon:'📅', visible:true },
        { id:'gamificacao',  label:'Conquistas',    icon:'🏆', visible:true },
        { id:'foco',         label:'Modo Foco',     icon:'🎯', visible:true },
        { id:'custom',       label:'Personalizar',  icon:'🎨', visible:true },
        { id:'arquivos',     label:'Arquivos',      icon:'📁', visible:true },
        { id:'macros',       label:'Macros',        icon:'💬', visible:true },
        { id:'relatorios',   label:'Relatórios',    icon:'📈', visible:true },
        { id:'IA',           label:'IA Assistente', icon:'🤖', visible:true },
        { id:'perfil',       label:'Meu Perfil',    icon:'👤', visible:true },
        { id:'admin',        label:'Painel Admin',   icon:'⚙️', visible:true, adminOnly:true },
      ],
      categories: ['Operação','Segurança','Logística','Manutenção','Qualidade','RH','Geral','Dicas'],
    },
    customThemes: [
      // { id, name, primary, secondary, accent, bg, mode, createdBy, createdAt }
    ],
    users: [],
    tasks: [],
    files: [],
    posts: [],
    macros: [],
    logs: [],
    gamification: {
      // { userId: { points, badges: [id], streak, lastActiveDate, weeklyPoints: { 'YYYY-WW': n }, achievements: [] } }
    },
    comments: {
      // { taskId: [{ id, userId, userName, text, createdAt }] }
    },
    automations: [
      // { id, name, trigger, conditions, action, enabled }
      // Padrão: "se atrasada > 2 dias, notificar admin"
      { id: 'a1', name: 'Notificar admin de atrasos', trigger: 'task_late', conditions: { daysLate: 2 }, action: 'notify_admin', enabled: true },
      { id: 'a2', name: 'Criar próxima recorrente ao finalizar', trigger: 'task_finished', conditions: { hasRecurrence: true }, action: 'create_recurrence', enabled: true },
    ],
    dashboardWidgets: [
      // { id, type, x, y, w, h, visible }
      { id: 'w1', type: 'metrics',     visible: true, size: 'full' },
      { id: 'w2', type: 'late',        visible: true, size: 'half' },
      { id: 'w3', type: 'next',        visible: true, size: 'half' },
      { id: 'w4', type: 'weekProgress',visible: true, size: 'half' },
      { id: 'w5', type: 'posts',       visible: true, size: 'half' },
      { id: 'w6', type: 'ranking',     visible: false, size: 'half' },
      { id: 'w7', type: 'pomodoro',    visible: false, size: 'half' },
    ],
  },

  getLocalDB() {
    try {
      const raw = localStorage.getItem(this._localKey);
      if (!raw) return JSON.parse(JSON.stringify(this._defaults));
      const data = JSON.parse(raw);
      // Merge with defaults to add new fields
      return this._migrate(data);
    } catch {
      return JSON.parse(JSON.stringify(this._defaults));
    }
  },

  // Migração: adiciona campos novos que não existem em dados antigos
  _migrate(data) {
    const defaults = JSON.parse(JSON.stringify(this._defaults));
    data = data && typeof data === 'object' ? data : {};

    data.settings = { ...defaults.settings, ...(data.settings || {}) };
    ['users', 'tasks', 'files', 'posts', 'macros', 'logs', 'customThemes', 'automations', 'dashboardWidgets']
      .forEach(key => { if (!Array.isArray(data[key])) data[key] = defaults[key]; });
    ['gamification', 'comments'].forEach(key => {
      if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) data[key] = defaults[key];
    });

    // Nunca mantenha segredos no navegador. Versões anteriores gravavam a chave
    // do DeepSeek em settings; ela passa a existir somente no documento privado
    // settings/admin do Firestore.
    if (Object.prototype.hasOwnProperty.call(data.settings, 'deepseekKey')) {
      delete data.settings.deepseekKey;
    }

    // Migração de menu. Remove uma entrada inválida de versões antigas e inclui
    // páginas novas sem apagar a ordem definida pelo administrador.
    const validMenuIds = new Set(defaults.settings.menuItems.map(item => item.id));
    data.settings.menuItems = (Array.isArray(data.settings.menuItems) ? data.settings.menuItems : [])
      .filter(item => item && validMenuIds.has(item.id));
    const existingMenuIds = new Set(data.settings.menuItems.map(item => item.id));
    defaults.settings.menuItems.forEach(item => {
      if (!existingMenuIds.has(item.id)) data.settings.menuItems.push({ ...item });
    });
    // Padroniza o nome exibido no menu sem apagar a personalização dos demais itens.
    const adminMenuItem = data.settings.menuItems.find(item => item.id === 'admin');
    if (adminMenuItem && (!adminMenuItem.label || adminMenuItem.label === 'Administração')) {
      adminMenuItem.label = 'Painel Admin';
    }

    data.settings.menuOrder = (Array.isArray(data.settings.menuOrder) ? data.settings.menuOrder : [])
      .filter(id => validMenuIds.has(id));
    const existingOrderIds = new Set(data.settings.menuOrder);
    defaults.settings.menuOrder.forEach(id => {
      if (!existingOrderIds.has(id)) data.settings.menuOrder.push(id);
    });

    if (!Array.isArray(data.settings.categories)) data.settings.categories = [...defaults.settings.categories];
    if (!data.settings.language) data.settings.language = 'pt-BR';
    return data;
  },

  saveLocalDB(data) {
    localStorage.setItem(this._localKey, JSON.stringify(data));
  },

  /* ---------- USUÁRIO ATUAL ---------- */
  getCurrentUser() {
    try {
      return JSON.parse(sessionStorage.getItem('currentUser') || 'null');
    } catch { return null; }
  },

  setCurrentUser(user) {
    if (user) sessionStorage.setItem('currentUser', JSON.stringify(user));
    else sessionStorage.removeItem('currentUser');
  },

  getRememberedUser() {
    try {
      return JSON.parse(localStorage.getItem('rememberUser') || 'null');
    } catch { return null; }
  },

  setRememberedUser(user) {
    if (user) localStorage.setItem('rememberUser', JSON.stringify(user));
    else localStorage.removeItem('rememberUser');
  },

  /* ---------- VALIDAÇÃO DE SENHA ---------- */
  validatePassword(pass) {
    const errors = [];
    if (pass.length < 8) errors.push('Mínimo 8 caracteres');
    if (!/[A-Z]/.test(pass)) errors.push('Pelo menos 1 letra maiúscula');
    if (!/[a-z]/.test(pass)) errors.push('Pelo menos 1 letra minúscula');
    const digits = (pass.match(/\d/g) || []).length;
    if (digits < 2) errors.push('Pelo menos 2 números');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) errors.push('Pelo menos 1 caractere especial');
    return { valid: errors.length === 0, errors };
  },

  passwordStrength(pass) {
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.length >= 12) score++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
    if ((pass.match(/\d/g) || []).length >= 2) score++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) score++;
    return Math.min(score, 5);
  },

  /* ---------- SEGURANÇA ---------- */
  escapeHTML(str = '') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /* ---------- HASH SIMPLES (para senhas locais) ---------- */
  async hashPassword(pass) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pass + '_checklist_ml_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async verifyPassword(pass, hash) {
    const h = await this.hashPassword(pass);
    return h === hash;
  },

  /* ---------- TOAST ---------- */
  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');

    // As páginas são carregadas em um iframe e devem delegar o toast ao shell.
    // No shell, window.parent === window. Postar uma mensagem para si mesmo fazia
    // App.handleMessage chamar core.toast novamente em um loop infinito.
    if (!container && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'toast', message, toastType: type }, window.location.origin);
      return;
    }

    if (container) {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
      t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${this.escapeHTML(message)}</span>`;
      container.appendChild(t);
      setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
    }
  },

  /* ---------- CHROME STYLE NOTIFICATION ALERT ---------- */
  chromeNotification(title, body, type = 'info') {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch(e) {}
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission().catch(() => {});
    }

    let container = document.getElementById('chromeNotifContainer');
    if (!container && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'chromeNotif', title, body, notifType: type }, window.location.origin);
      return;
    }

    if (!container) {
      container = document.createElement('div');
      container.id = 'chromeNotifContainer';
      container.className = 'chrome-notif-container';
      document.body.appendChild(container);
    }

    const notif = document.createElement('div');
    notif.className = `chrome-notif ${type}`;
    notif.innerHTML = `
      <div class="chrome-notif-header">
        <div class="chrome-notif-brand">
          <span>🌐</span> <span>Google Chrome • Alerta</span>
        </div>
        <button class="chrome-notif-close" onclick="this.closest('.chrome-notif').remove()">×</button>
      </div>
      <div class="chrome-notif-title">${this.escapeHTML(title)}</div>
      <div class="chrome-notif-body">${this.escapeHTML(body)}</div>
    `;

    container.appendChild(notif);
    setTimeout(() => {
      notif.style.animation = 'slideDown .3s ease reverse forwards';
      setTimeout(() => notif.remove(), 300);
    }, 6000);
  },

  /* ---------- DATA / HORA ---------- */
  today() { return new Date().toISOString().slice(0, 10); },
  now() { return new Date().toISOString(); },
  formatDate(dateStr) {
    if (!dateStr) return 'Sem data';
    const lang = this.getCurrentLang();
    const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(locale, { day:'2-digit', month:'short', year:'numeric' });
  },
  formatDateTime(ts) {
    if (!ts) return '';
    const lang = this.getCurrentLang();
    const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es-ES' : 'pt-BR';
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    return d.toLocaleDateString(locale, { day:'2-digit', month:'short' }) + ' ' +
           d.toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit' });
  },
  daysUntil(dateStr) {
    if (!dateStr) return Infinity;
    const now = new Date(); now.setHours(0,0,0,0);
    const target = new Date(dateStr + 'T00:00:00');
    return Math.ceil((target - now) / 86400000);
  },

  /* ---------- COMPRESSÃO DE IMAGEM ---------- */
  compressImage(file, maxWidth = 256, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/webp', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /* ---------- AVATARES PRÉ-DEFINIDOS (20 opções) ---------- */
  defaultAvatars: ['😀','😎','🦊','🐱','🐶','🦁','🐯','🐸','🐵','🦉',
                    '🚀','⚡','🔥','💎','🎯','🏆','🌟','🎨','🎮','🤖'],

  /* ---------- ID GENERATOR ---------- */
  genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },

  /* ---------- LOG ---------- */
  log(action, userId, details = '') {
    try {
      const data = this.getLocalDB();
      data.logs.unshift({
        id: this.genId(), action, userId, details, timestamp: this.now()
      });
      if (data.logs.length > 500) data.logs = data.logs.slice(0, 500);
      this.saveLocalDB(data);
    } catch (e) { console.warn('log error:', e); }
  },

  /* ====================================================================
     PARTE 3/3 — FUNCIONALIDADES AVANÇADAS
     ==================================================================== */

  /* ---------- i18n (Internacionalização) ---------- */
  _i18nCache: null,
  getCurrentLang() {
    try {
      const settings = this.getLocalDB().settings;
      return settings?.language || 'pt-BR';
    } catch { return 'pt-BR'; }
  },

  setLanguage(lang) {
    const data = this.getLocalDB();
    data.settings.language = lang;
    this.saveLocalDB(data);
    this._i18nCache = null;
    // Notificar o app principal apenas quando esta função roda dentro de um iframe.
    // Postar para a própria janela é desnecessário e abre espaço para loops de eventos.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'languageChanged', lang }, window.location.origin);
      }
    } catch(e) {}
  },

  /**
   * t('key', fallback) - retorna a tradução para a chave
   * Usa arquivos /locales/{lang}.json
   * Sistema de fallback: en (padrão) -> valor passado
   */
  async _loadLocale(lang) {
    if (this._i18nCache && this._i18nCache[lang]) return this._i18nCache[lang];
    try {
      // core.js também roda dentro de /pages/*.html; nesse caso o caminho
      // relativo anterior apontava para /pages/locales e a tradução falhava.
      const localePath = window.location.pathname.includes('/pages/')
        ? `../locales/${lang}.json`
        : `locales/${lang}.json`;
      const res = await fetch(localePath);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      if (!this._i18nCache) this._i18nCache = {};
      this._i18nCache[lang] = data;
      return data;
    } catch {
      return null;
    }
  },

  /**
   * t('key.subkey', 'fallback') - tradução síncrona usando cache
   */
  t(key, fallback = '') {
    if (!this._i18nCache || !this._i18nCache[this.getCurrentLang()]) {
      return fallback || key;
    }
    const dict = this._i18nCache[this.getCurrentLang()];
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return fallback || key;
    }
    return cur;
  },

  /**
   * tReady(lang) - pre-carrega um idioma
   */
  async tReady(lang) {
    return await this._loadLocale(lang || this.getCurrentLang());
  },

  /**
   * applyI18n(root) - substitui todos os elementos com data-i18n="key" no escopo
   */
  applyI18n(root = document) {
    const lang = this.getCurrentLang();
    if (!this._i18nCache || !this._i18nCache[lang]) {
      // Carrega em background se não estiver cacheado
      this._loadLocale(lang).then(() => this.applyI18n(root));
      return;
    }
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = this.t(key, el.textContent);
      el.textContent = val;
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = this.t(key, el.placeholder || '');
      el.placeholder = val;
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const val = this.t(key, el.title || '');
      el.title = val;
    });
  },

  /* ---------- DARK MODE AUTOMÁTICO (prefers-color-scheme) ---------- */
  _mediaQuery: null,
  _mediaListener: null,
  initAutoTheme() {
    const data = this.getLocalDB();
    const mode = data.settings.mode || 'light';
    if (mode === 'auto') {
      this._setupAutoThemeListener();
      this.applyAutoTheme();
    } else {
      this._removeAutoThemeListener();
    }
  },

  _setupAutoThemeListener() {
    if (this._mediaQuery) return;
    this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this._mediaListener = () => this.applyAutoTheme();
    if (this._mediaQuery.addEventListener) {
      this._mediaQuery.addEventListener('change', this._mediaListener);
    } else if (this._mediaQuery.addListener) {
      this._mediaQuery.addListener(this._mediaListener);
    }
  },

  _removeAutoThemeListener() {
    if (this._mediaQuery && this._mediaListener) {
      if (this._mediaQuery.removeEventListener) {
        this._mediaQuery.removeEventListener('change', this._mediaListener);
      } else if (this._mediaQuery.removeListener) {
        this._mediaQuery.removeListener(this._mediaListener);
      }
    }
    this._mediaQuery = null;
    this._mediaListener = null;
  },

  applyAutoTheme() {
    if (!this._mediaQuery) return;
    const actual = this._mediaQuery.matches ? 'dark' : 'light';
    try {
      document.documentElement.dataset.mode = actual;
    } catch(e) {}
  },

  /* ---------- TEMAS CUSTOMIZADOS ---------- */
  getCustomThemes() {
    const data = this.getLocalDB();
    return data.customThemes || [];
  },

  saveCustomTheme(theme) {
    const data = this.getLocalDB();
    if (!data.customThemes) data.customThemes = [];
    if (theme.id) {
      // Editar
      const idx = data.customThemes.findIndex(t => t.id === theme.id);
      if (idx >= 0) data.customThemes[idx] = { ...data.customThemes[idx], ...theme };
    } else {
      // Criar
      theme.id = 'ct-' + this.genId();
      theme.createdAt = this.now();
      data.customThemes.push(theme);
    }
    this.saveLocalDB(data);
    return theme;
  },

  deleteCustomTheme(id) {
    const data = this.getLocalDB();
    data.customThemes = (data.customThemes || []).filter(t => t.id !== id);
    this.saveLocalDB(data);
  },

  applyCustomTheme(themeId) {
    const data = this.getLocalDB();
    const theme = (data.customThemes || []).find(t => t.id === themeId);
    if (!theme) return false;

    // Cria um <style> com variáveis CSS
    let styleEl = document.getElementById('custom-theme-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-theme-style';
      document.head.appendChild(styleEl);
    }

    const light = theme.mode === 'light' || !theme.mode;
    const root = light ? `[data-theme="${themeId}"]` : `[data-theme="${themeId}"][data-mode="dark"]`;

    styleEl.textContent = `
      ${root} {
        --primary:${theme.primary};
        --primary-hover:${theme.secondary || theme.primary};
        --primary-light:${this._lighten(theme.primary, 0.85)};
        --primary-rgb:${this._hexToRgb(theme.primary)};
        --accent:${theme.accent || theme.primary};
        --accent-light:${this._lighten(theme.accent || theme.primary, 0.85)};
        --bg:${theme.bg};
        --bg-secondary:${this._lighten(theme.bg, 0.05)};
        --card:${light ? '#FFFFFF' : this._lighten(theme.bg, 0.08)};
        --card-hover:${light ? '#F8FAFC' : this._lighten(theme.bg, 0.12)};
        --text:${light ? '#1E293B' : '#F1F5F9'};
        --text-secondary:${light ? '#64748B' : '#94A3B8'};
        --muted:${light ? '#94A3B8' : '#64748B'};
        --line:${light ? '#E2E8F0' : this._lighten(theme.bg, 0.2)};
      }
    `;

    document.documentElement.dataset.theme = themeId;
    return true;
  },

  // Helpers de cor
  _hexToRgb(hex) {
    const m = hex.replace('#', '').match(/.{1,2}/g);
    if (!m) return '37,99,235';
    return m.map(x => parseInt(x, 16)).join(',');
  },

  _lighten(hex, amount) {
    const m = hex.replace('#', '');
    if (m.length !== 6) return hex;
    const r = parseInt(m.slice(0,2), 16);
    const g = parseInt(m.slice(2,4), 16);
    const b = parseInt(m.slice(4,6), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return '#' + [mix(r), mix(g), mix(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  },

  /* ---------- GAMIFICAÇÃO ---------- */
  _achievements: [
    { id: 'first_task',  icon: '🌱', name: 'Primeira atividade', desc: 'Concluiu sua primeira atividade',  condition: (stats) => stats.totalFinished >= 1 },
    { id: 'task_5',      icon: '⭐', name: '5 atividades',       desc: 'Concluiu 5 atividades',             condition: (stats) => stats.totalFinished >= 5 },
    { id: 'task_25',     icon: '🌟', name: '25 atividades',      desc: 'Concluiu 25 atividades',            condition: (stats) => stats.totalFinished >= 25 },
    { id: 'task_100',    icon: '💯', name: '100 atividades',     desc: 'Concluiu 100 atividades',           condition: (stats) => stats.totalFinished >= 100 },
    { id: 'streak_3',    icon: '🔥', name: 'Sequência 3 dias',   desc: '3 dias consecutivos concluindo',   condition: (stats) => stats.streak >= 3 },
    { id: 'streak_7',    icon: '🔥', name: 'Semana perfeita',    desc: '7 dias consecutivos',               condition: (stats) => stats.streak >= 7 },
    { id: 'streak_30',   icon: '🏆', name: 'Mês perfeito',       desc: '30 dias consecutivos',              condition: (stats) => stats.streak >= 30 },
    { id: 'urgent_done', icon: '🚨', name: 'Velocista',          desc: 'Concluiu uma atividade urgente',    condition: (stats) => stats.urgentFinished >= 1 },
    { id: 'early_bird',  icon: '🐦', name: 'Pássaro madrugador',  desc: 'Concluiu atividade antes do prazo', condition: (stats) => stats.earlyFinishes >= 1 },
    { id: 'recurrence',  icon: '🔁', name: 'Recorrente',         desc: 'Concluiu uma atividade recorrente', condition: (stats) => stats.recurrenceFinished >= 1 },
  ],

  getAchievements() { return this._achievements; },

  getUserStats(userId) {
    const data = this.getLocalDB();
    const gam = data.gamification || {};
    if (!gam[userId]) {
      gam[userId] = {
        points: 0, badges: [], streak: 0, lastActiveDate: null,
        weeklyPoints: {}, achievements: [],
        totalFinished: 0, urgentFinished: 0, earlyFinishes: 0, recurrenceFinished: 0,
      };
      data.gamification = gam;
      this.saveLocalDB(data);
    }
    return gam[userId];
  },

  _ensureGamEntry(data, userId) {
    if (!data.gamification) data.gamification = {};
    if (!data.gamification[userId]) {
      data.gamification[userId] = {
        points: 0, badges: [], streak: 0, lastActiveDate: null,
        weeklyPoints: {}, achievements: [],
        totalFinished: 0, urgentFinished: 0, earlyFinishes: 0, recurrenceFinished: 0,
      };
    }
  },

  /**
   * awardPoints(userId, task, action) - dá pontos por uma ação
   * action: 'finish' | 'create' | 'urgent_finish' | 'early_finish' | 'recurrence_finish'
   */
  awardPoints(userId, task, action = 'finish') {
    if (!userId) return null;
    const data = this.getLocalDB();
    this._ensureGamEntry(data, userId);
    const stats = data.gamification[userId];

    let points = 0;
    if (action === 'finish') {
      points = 10;
      if (task.priority === 'high') points += 5;
      if (task.priority === 'urgent') points += 10;
      if (task.recurrence && task.recurrence !== 'none') points += 5;
      stats.totalFinished++;
      if (task.priority === 'urgent') stats.urgentFinished++;
      if (task.recurrence && task.recurrence !== 'none') stats.recurrenceFinished++;
      // Early: finished before due date
      if (task.date && task.finishedAt) {
        const due = new Date(task.date + 'T23:59:59');
        const done = new Date(task.finishedAt);
        if (done < due) stats.earlyFinishes++;
      }
    } else if (action === 'create') {
      points = 1;
    }

    stats.points += points;

    // Streak: se última atividade foi ontem, incrementa; se foi hoje, mantém; senão reseta
    const today = this.today();
    if (stats.lastActiveDate !== today) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yest = yesterday.toISOString().slice(0, 10);
      if (stats.lastActiveDate === yest) {
        stats.streak = (stats.streak || 0) + 1;
      } else if (stats.lastActiveDate && stats.lastActiveDate < yest) {
        stats.streak = 1;
      } else {
        stats.streak = Math.max(stats.streak || 0, 1);
      }
      stats.lastActiveDate = today;
    }

    // Pontos semanais
    const weekKey = this._getWeekKey(new Date());
    stats.weeklyPoints[weekKey] = (stats.weeklyPoints[weekKey] || 0) + points;

    // Verificar achievements
    stats.badges = stats.badges || [];
    stats.achievements = stats.achievements || [];
    this._achievements.forEach(a => {
      if (a.condition(stats) && !stats.achievements.includes(a.id)) {
        stats.achievements.push(a.id);
        stats.badges.push({ id: a.id, earnedAt: this.now() });
      }
    });

    data.gamification[userId] = stats;
    this.saveLocalDB(data);
    return { points, total: stats.points, newBadges: stats.badges.slice(-3) };
  },

  /**
   * updateStreakIfNeeded - chamado em cada carregamento
   * se o dia de hoje não tem atividade, o streak continua (até resetar)
   */
  updateStreak(userId) {
    if (!userId) return;
    const data = this.getLocalDB();
    this._ensureGamEntry(data, userId);
    const stats = data.gamification[userId];
    const today = this.today();

    // Se o usuário não fez nada hoje nem ontem, reseta o streak
    if (stats.lastActiveDate) {
      const last = new Date(stats.lastActiveDate + 'T00:00:00');
      const now = new Date(today + 'T00:00:00');
      const diffDays = Math.floor((now - last) / 86400000);
      if (diffDays > 1) {
        stats.streak = 0;
        data.gamification[userId] = stats;
        this.saveLocalDB(data);
      }
    }
  },

  _getWeekKey(d) {
    const year = d.getFullYear();
    const onejan = new Date(year, 0, 1);
    const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  },

  getWeeklyRanking(limit = 10) {
    const data = this.getLocalDB();
    const users = data.users || [];
    const gam = data.gamification || {};
    const weekKey = this._getWeekKey(new Date());
    const arr = users.map(u => {
      const s = gam[u.id] || gam[u.uid] || { points: 0, weeklyPoints: {}, streak: 0 };
      return {
        userId: u.id || u.uid,
        name: u.name || u.username || 'Usuário',
        avatar: u.avatar || '👤',
        role: u.role || 'member',
        points: s.weeklyPoints?.[weekKey] || 0,
        total: s.points || 0,
        streak: s.streak || 0,
      };
    });
    arr.sort((a, b) => b.points - a.points || b.total - a.total);
    return arr.slice(0, limit);
  },

  getAllRanking(limit = 20) {
    const data = this.getLocalDB();
    const users = data.users || [];
    const gam = data.gamification || {};
    const arr = users.map(u => {
      const s = gam[u.id] || gam[u.uid] || { points: 0, streak: 0 };
      return {
        userId: u.id || u.uid,
        name: u.name || u.username || 'Usuário',
        avatar: u.avatar || '👤',
        role: u.role || 'member',
        points: s.points || 0,
        streak: s.streak || 0,
        badges: (s.badges || []).length,
      };
    });
    arr.sort((a, b) => b.points - a.points);
    return arr.slice(0, limit);
  },

  /* ---------- COMENTÁRIOS EM ATIVIDADES ---------- */
  getComments(taskId) {
    const data = this.getLocalDB();
    return (data.comments && data.comments[taskId]) || [];
  },

  addComment(taskId, userId, userName, text) {
    if (!text || !text.trim()) return null;
    const data = this.getLocalDB();
    if (!data.comments) data.comments = {};
    if (!data.comments[taskId]) data.comments[taskId] = [];
    const c = {
      id: this.genId(),
      userId, userName: userName || 'Anônimo',
      avatar: '',
      text: text.trim(),
      createdAt: this.now(),
    };
    data.comments[taskId].push(c);
    this.saveLocalDB(data);
    return c;
  },

  deleteComment(taskId, commentId) {
    const data = this.getLocalDB();
    if (data.comments && data.comments[taskId]) {
      data.comments[taskId] = data.comments[taskId].filter(c => c.id !== commentId);
      this.saveLocalDB(data);
    }
  },

  /* ---------- AUTOMAÇÕES / WORKFLOW ---------- */
  getAutomations() {
    const data = this.getLocalDB();
    return data.automations || [];
  },

  saveAutomations(autos) {
    const data = this.getLocalDB();
    data.automations = autos;
    this.saveLocalDB(data);
  },

  /**
   * runAutomations(trigger, payload) - executa automações após um evento
   * trigger: 'task_late' | 'task_finished' | 'task_created'
   * payload: dados do evento
   */
  runAutomations(trigger, payload = {}) {
    const autos = this.getAutomations().filter(a => a.enabled && a.trigger === trigger);
    const results = [];

    autos.forEach(auto => {
      try {
        if (trigger === 'task_late') {
          const daysLate = payload.daysLate || 0;
          const cond = auto.conditions?.daysLate || 0;
          if (daysLate >= cond && auto.action === 'notify_admin') {
            const task = payload.task || {};
            const recipients = Array.isArray(payload.recipientIds) && payload.recipientIds.length
              ? payload.recipientIds
              : ['admin'];
            const dateKey = payload.dateKey || this.today();
            let created = false;

            recipients.forEach(recipientId => {
              const notification = this._createNotification(
                recipientId,
                '⏰ Atividade atrasada',
                `"${task.title || 'Atividade'}" está ${daysLate} dia(s) atrasada(s)`,
                'warning',
                {
                  dedupeKey: `automation:${auto.id}:late:${task.id || task.title || 'task'}:${dateKey}`,
                  data: { page: 'atividades', taskId: task.id },
                  // Avisos de varredura no login ficam na central, sem inundar a tela.
                  showToast: !payload.silent,
                  showBrowser: !payload.silent,
                }
              );
              created = created || Boolean(notification);
            });
            results.push({ auto, ok: true, created });
          }
        } else if (trigger === 'task_finished') {
          const task = payload.task;
          if (auto.action === 'create_recurrence' && task.recurrence && task.recurrence !== 'none') {
            // Cria a próxima recorrente
            const data = this.getLocalDB();
            const nextDate = this._nextRecurrenceDate(task.date, task.recurrence);
            if (nextDate) {
              const newTask = {
                ...task,
                id: Date.now() + Math.floor(Math.random() * 1000),
                status: 'pending',
                date: nextDate,
                createdAt: this.now(),
                finishedAt: null,
                comments: undefined,
              };
              delete newTask.finishedAt;
              data.tasks.unshift(newTask);
              this.saveLocalDB(data);
              this._createNotification(
                payload.userId,
                '🔁 Nova atividade recorrente',
                `Criada próxima: ${task.title} (${nextDate})`,
                'info'
              );
              results.push({ auto, ok: true, newTask });
            }
          }
        }
      } catch (err) {
        console.warn('automation error:', err);
        results.push({ auto, ok: false, error: err.message });
      }
    });

    return results;
  },

  _nextRecurrenceDate(dateStr, recurrence) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (recurrence === 'daily') d.setDate(d.getDate() + 1);
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
    else return null;
    return d.toISOString().slice(0, 10);
  },

  _createNotification(userId, title, body, type = 'info', options = {}) {
    try {
      if (!userId) return null;
      const {
        dedupeKey = '',
        data = null,
        showToast = true,
        showBrowser = true,
      } = options;
      const key = 'cl-notifications-' + userId;
      const list = JSON.parse(localStorage.getItem(key) || '[]');

      // Uma mesma automação pode ser avaliada mais de uma vez (login, reload e
      // sincronização). A chave torna a criação idempotente e impede spam.
      if (dedupeKey && list.some(notification => notification.dedupeKey === dedupeKey)) {
        return null;
      }

      const notification = {
        id: this.genId(), title, body, type, read: false, timestamp: this.now(),
        ...(dedupeKey ? { dedupeKey } : {}),
        ...(data ? { data } : {}),
      };
      list.unshift(notification);
      if (list.length > 50) list.length = 50;
      localStorage.setItem(key, JSON.stringify(list));

      if (showBrowser && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch(e) {}
      }
      if (showToast) this.toast(`${title}: ${body}`, type);
      return notification;
    } catch(e) {
      console.warn('notify:', e);
      return null;
    }
  },

  getNotifications(userId) {
    try {
      return JSON.parse(localStorage.getItem('cl-notifications-' + userId) || '[]');
    } catch { return []; }
  },

  markAllNotificationsRead(userId) {
    const list = this.getNotifications(userId);
    list.forEach(n => n.read = true);
    localStorage.setItem('cl-notifications-' + userId, JSON.stringify(list));
  },

  /**
   * checkLateAutomations - verifica somente as tarefas do usuário que iniciou
   * a sessão. Cada aviso é criado uma vez por tarefa/automação/dia e entra na
   * central de notificações sem abrir vários toasts ao fazer login.
   */
  checkLateAutomations(userId) {
    if (!userId) return;
    const data = this.getLocalDB();
    const today = this.today();
    const late = data.tasks.filter(task =>
      task.owner === userId && task.date && task.date < today &&
      task.status !== 'finished' && task.status !== 'notdone'
    );
    const adminIds = (data.users || [])
      .filter(account => account.role === 'admin' && !account.banned)
      .map(account => account.id || account.uid)
      .filter(Boolean);
    const recipientIds = adminIds.length ? adminIds : [userId];

    late.forEach(task => {
      const daysLate = Math.floor((new Date(today) - new Date(task.date)) / 86400000);
      this.runAutomations('task_late', {
        task,
        daysLate,
        recipientIds,
        silent: true,
        dateKey: today,
      });
    });
  },

  /* ---------- DASHBOARD WIDGETS ---------- */
  getDashboardWidgets() {
    const data = this.getLocalDB();
    return data.dashboardWidgets || [];
  },

  saveDashboardWidgets(widgets) {
    const data = this.getLocalDB();
    data.dashboardWidgets = widgets;
    this.saveLocalDB(data);
  },

  /* ---------- MODE FOCO / POMODORO STATE ---------- */
  _pomodoroState: null,
  getPomodoroState() {
    try {
      return JSON.parse(localStorage.getItem('cl-pomodoro') || 'null');
    } catch { return null; }
  },
  setPomodoroState(state) {
    this._pomodoroState = state;
    if (state) localStorage.setItem('cl-pomodoro', JSON.stringify(state));
    else localStorage.removeItem('cl-pomodoro');
  },
};

// Expor globalmente
window.core = Core;

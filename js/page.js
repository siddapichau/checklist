/* =========================================================
   CHECKLIST ML — page.js
   Script compartilhado para páginas dentro dos iframes
   + i18n, herança de tema, auto dark mode
   ========================================================= */

// Herdar tema do parent (incluindo custom themes e auto mode)
(function inheritTheme() {
  try {
    const parentDoc = window.parent.document.documentElement;
    const theme = parentDoc.dataset.theme || 'ocean';
    let mode = parentDoc.dataset.mode || 'light';

    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;

    // Se mode=auto, escutar mudanças do sistema
    if (mode === 'auto' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        document.documentElement.dataset.mode = mq.matches ? 'dark' : 'light';
      };
      apply();
      if (mq.addEventListener) mq.addEventListener('change', apply);
      else if (mq.addListener) mq.addListener(apply);
    }
  } catch(e) {
    document.documentElement.dataset.theme = localStorage.getItem('cl-theme') || 'ocean';
    document.documentElement.dataset.mode = localStorage.getItem('cl-mode') || 'light';
  }
})();

// Observar mudanças de tema no parent
try {
  const observer = new MutationObserver(() => {
    const pd = window.parent.document.documentElement;
    document.documentElement.dataset.theme = pd.dataset.theme;
    document.documentElement.dataset.mode = pd.dataset.mode;
  });
  observer.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme','data-mode'] });
} catch(e) {}

// Herdar custom theme style do parent
try {
  const parentStyle = window.parent.document.getElementById('custom-theme-style');
  if (parentStyle) {
    let styleEl = document.getElementById('custom-theme-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-theme-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = parentStyle.textContent;
  }
} catch(e) {}

// Helpers para comunicação com parent
const Page = {
  getUser() { return core.getCurrentUser(); },
  getDB() { return core.getLocalDB(); },
  saveDB(d) { core.saveLocalDB(d); },
  toast(msg, type) { core.toast(msg, type); },
  esc(s) { return core.escapeHTML(s); },
  _post(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, window.location.origin);
    }
  },
  reload() { this._post({ type: 'reload' }); },
  navigate(page) { this._post({ type: 'navigate', page }); },
  openModal(html) { this._post({ type: 'modal', html }); },
  closeModal() { this._post({ type: 'closeModal' }); },
  syncDocument(collection, id, data) {
    this._post({ type: 'firebaseSync', collection, id, data });
  },
  deleteDocument(collection, id) {
    this._post({ type: 'firebaseDelete', collection, id });
  },
  syncSettings(settings) {
    this._post({ type: 'firebaseSettings', settings });
  },
  // Configurações privadas usam os métodos do FireSync do shell, que conversa
  // com o Firestore sob as regras do usuário autenticado. Nunca use localStorage
  // para chaves de API.
  async getAdminConfig() {
    if (!window.parent || window.parent === window || !window.parent.fireSync) {
      throw new Error('Sincronização Firebase indisponível');
    }
    return window.parent.fireSync.getAdminConfig();
  },
  async saveAdminConfig(config) {
    if (!window.parent || window.parent === window || !window.parent.fireSync) {
      throw new Error('Sincronização Firebase indisponível');
    }
    return window.parent.fireSync.saveAdminConfig(config);
  },
  async getDeepseekKey() {
    if (!window.parent || window.parent === window || !window.parent.fireSync) return '';
    return window.parent.fireSync.getDeepseekKey();
  },

  // i18n helpers
  async i18nReady() {
    await core.tReady();
  },
  t(key, fallback) { return core.t(key, fallback); },
  applyI18n(root) { core.applyI18n(root || document); },

  // Theme
  getTheme() { return core.getLocalDB().settings.theme; },
  getMode() { return core.getLocalDB().settings.mode; },
  getLanguage() { return core.getCurrentLang(); },
  setLanguage(lang) {
    core.setLanguage(lang);
    // Re-renderizar a página atual
    setTimeout(() => location.reload(), 100);
  },
};

window.page = Page;

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
  async getAdminConfig() { if (!window.parent?.fireSync) throw new Error('Sincronização Firebase indisponível'); return window.parent.fireSync.getAdminConfig(); },
  async saveAdminConfig(config) { if (!window.parent?.fireSync) throw new Error('Sincronização Firebase indisponível'); return window.parent.fireSync.saveAdminConfig(config); },
  async getDeepseekKey() { return window.parent?.fireSync ? window.parent.fireSync.getDeepseekKey() : ''; },
  async getGroqKey() { return window.parent?.fireSync?.getGroqKey ? window.parent.fireSync.getGroqKey() : ''; },
  getAIMode() { return window.parent?.fireSync?.getAIMode ? window.parent.fireSync.getAIMode() : 'auto'; },
  getAIProxyUrl() { return window.parent?.fireSync?.getAIProxyUrl ? window.parent.fireSync.getAIProxyUrl() : ''; },
  async i18nReady() { await core.tReady(); }, t(key, fallback) { return core.t(key, fallback); }, applyI18n(root) { core.applyI18n(root || document); },
  getTheme() { return core.getLocalDB().settings.theme; }, getMode() { return core.getLocalDB().settings.mode; }, getLanguage() { return core.getCurrentLang(); },
  setLanguage(lang) { core.setLanguage(lang); setTimeout(() => location.reload(), 100); },
};
window.page = Page;

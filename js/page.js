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
  _post(message) { 
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, window.location.origin);
        // Log para debug
        if (message.type === 'firebaseSync') {
          console.log('📤 Página → Shell: firebaseSync', message.collection, message.id);
        }
      } else {
        console.warn('⚠️ postMessage: parent não disponível ou já é o parent');
      }
    } catch(e) {
      console.error('❌ Erro ao enviar mensagem para parent:', e);
    }
  },
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
  /* Dados do usuário na NUVEM (notificações, histórico/memória da IA, pomodoro...):
     settings/{section}/user/{uid} no Firestore — só o dono lê/escreve. */
  async syncUserPref(section, data) {
    const userId = core.getCurrentUser()?.id || core.getCurrentUser()?.uid;
    if (!section || !userId || !window.parent?.fireSync) return false;
    try { return await window.parent.fireSync.pushUserPref(section, userId, data); }
    catch (e) { return false; }
  },
  async getUserPref(section) {
    const userId = core.getCurrentUser()?.id || core.getCurrentUser()?.uid;
    if (!section || !userId || !window.parent?.fireSync) return null;
    try { return await window.parent.fireSync.getUserPref(section, userId); }
    catch (e) { return null; }
  },
  async i18nReady() { await core.tReady(); }, t(key, fallback) { return core.t(key, fallback); }, applyI18n(root) { core.applyI18n(root || document); },
  getTheme() { return core.getLocalDB().settings.theme; }, getMode() { return core.getLocalDB().settings.mode; }, getLanguage() { return core.getCurrentLang(); },
  setLanguage(lang) { core.setLanguage(lang); setTimeout(() => location.reload(), 100); },
};
window.page = Page;

/* Shared iframe helpers: keeps every page visually identical to the shell. */
(function () {
  const root = document.documentElement;
  const applyCustomTheme = (theme) => {
    try {
      const data = core.getLocalDB();
      if ((data.customThemes || []).some(item => item.id === theme)) core.applyCustomTheme(theme);
    } catch (_) {}
  };
  const apply = (theme, mode, fontScale) => {
    root.dataset.theme = theme || 'ocean';
    root.dataset.mode = mode === 'auto'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : (mode || 'light');
    root.dataset.fontScale = fontScale || 'normal';
    applyCustomTheme(root.dataset.theme);
  };
  try {
    const parentRoot = window.parent.document.documentElement;
    apply(parentRoot.dataset.theme, parentRoot.dataset.mode, parentRoot.dataset.fontScale);
    new MutationObserver(() => apply(parentRoot.dataset.theme, parentRoot.dataset.mode, parentRoot.dataset.fontScale))
      .observe(parentRoot, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-font-scale'] });
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
    apply(settings.theme, settings.mode, localStorage.getItem('cl-font-scale') || 'normal');
  }
  // Debounce global para re-renderizar páginas via firebaseSync (evita flickering)
  let _pageSyncDebounce = null;
  window.addEventListener('message', event => {
    if (event.data?.type === 'themeChanged') apply(event.data.theme, event.data.mode);
    if (event.data?.type === 'firebaseSync') {
      // Debounce: só re-renderizar 1x a cada 600ms para evitar flickering
      if (_pageSyncDebounce) clearTimeout(_pageSyncDebounce);
      _pageSyncDebounce = setTimeout(() => {
        _pageSyncDebounce = null;
        if (event.data.collection === 'settings' && typeof initCategories === 'function') initCategories();
        // Deixar cada página decidir se re-renderiza (algumas já têm listener próprio com debounce)
        if (typeof render === 'function' && typeof debouncedRender !== 'function') render();
      }, 600);
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

  /* A página vive no iframe, mas o FireSync e sua outbox vivem no shell.
     Chamar diretamente registra a escrita antes de a aba poder ser suspensa;
     postMessage continua como fallback para uma incorporação diferente. */
  async syncDocument(collection, id, data) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.pushDocument) return sync.pushDocument(collection, id, data);
    this._post({ type: 'firebaseSync', collection, id, data });
    return false;
  },
  async deleteDocument(collection, id) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.deleteDocument) return sync.deleteDocument(collection, id);
    this._post({ type: 'firebaseDelete', collection, id });
    return false;
  },
  async syncSettings(settings) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.pushSettings) return sync.pushSettings(settings);
    this._post({ type: 'firebaseSettings', settings });
    return false;
  },
  async syncGamification(userId, stats) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.pushGamification) return sync.pushGamification(userId, stats);
    this._post({ type: 'firebaseGamification', userId, stats });
    return false;
  },
  async syncWidgets(userId, widgets) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.pushDashboardWidgets) return sync.pushDashboardWidgets(userId, widgets);
    this._post({ type: 'firebaseWidgets', userId, widgets });
    return false;
  },
  isSyncReady() {
    const sync = window.parent?.fireSync || window.fireSync;
    const userId = core.getCurrentUser()?.uid || core.getCurrentUser()?.id;
    return Boolean(sync?.isInitialSyncReady?.(userId));
  },
  async uploadLibraryAsset(fileId, file, kind = 'resource', onProgress) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (!sync?.uploadLibraryAsset) throw new Error('Upload Firebase indisponível nesta página.');
    return sync.uploadLibraryAsset(fileId, file, kind, onProgress);
  },
  async deleteLibraryAssets(fileRecord) {
    const sync = window.parent?.fireSync || window.fireSync;
    if (sync?.deleteLibraryAssets) return sync.deleteLibraryAssets(fileRecord);
    return false;
  },
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

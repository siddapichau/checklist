/* =========================================================
   CHECKLIST ML — page.js
   Script compartilhado para páginas dentro dos iframes
   ========================================================= */

// Herdar tema do parent
(function inheritTheme() {
  try {
    const parentDoc = window.parent.document.documentElement;
    document.documentElement.dataset.theme = parentDoc.dataset.theme || 'ocean';
    document.documentElement.dataset.mode = parentDoc.dataset.mode || 'light';
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

// Helpers para comunicação com parent
const Page = {
  getUser() { return core.getCurrentUser(); },
  getDB() { return core.getLocalDB(); },
  saveDB(d) { core.saveLocalDB(d); },
  toast(msg, type) { core.toast(msg, type); },
  esc(s) { return core.escapeHTML(s); },
  reload() { window.parent.postMessage({ type: 'reload' }, '*'); },
  navigate(page) { window.parent.postMessage({ type: 'navigate', page }, '*'); },
  openModal(html) { window.parent.postMessage({ type: 'modal', html }, '*'); },
  closeModal() { window.parent.postMessage({ type: 'closeModal' }, '*'); },
};

window.page = Page;

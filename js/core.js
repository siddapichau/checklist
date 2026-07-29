/* =========================================================
   CHECKLIST ML — core.js  (Parte 1/3)
   Módulo central: utilitários, helpers de dados, validação
   ========================================================= */

const Core = {
  /* ---------- DADOS LOCAIS (fallback se Firebase offline) ---------- */
  _localKey: 'checklist-ml-local',

  _defaults: {
    settings: {
      brand: 'Checklist ML',
      theme: 'ocean',        // ocean | mercado | forest
      mode: 'light',          // light | dark
      logo: '',               // URL ou base64
      favicon: '',            // URL ou base64
      menuOrder: ['home','atividades','arquivos','IA','perfil','admin'],
      deepseekKey: '',
      menuItems: [
        { id:'home',       label:'Visão geral',   icon:'📊', visible:true },
        { id:'atividades', label:'Atividades',    icon:'✅', visible:true },
        { id:'arquivos',   label:'Arquivos',      icon:'📁', visible:true },
        { id:'IA',         label:'IA Assistente', icon:'🤖', visible:true },
        { id:'perfil',     label:'Meu Perfil',    icon:'👤', visible:true },
        { id:'admin',      label:'Administração', icon:'⚙️', visible:true, adminOnly:true },
      ],
      categories: ['Operação','Segurança','Logística','Manutenção','Qualidade','RH','Geral','Dicas'],
    },
    users: [],
    tasks: [],
    files: [],
    posts: [],
    logs: [],
  },

  getLocalDB() {
    try {
      const raw = localStorage.getItem(this._localKey);
      if (!raw) return JSON.parse(JSON.stringify(this._defaults));
      return JSON.parse(raw);
    } catch {
      return JSON.parse(JSON.stringify(this._defaults));
    }
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
    if (!/[0-9].*[0-9]/.test(pass) && !/\d.*\d/.test(pass)) {
      const digits = (pass.match(/\d/g) || []).length;
      if (digits < 2) errors.push('Pelo menos 2 números');
    }
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
    // Dispara evento para o app principal
    window.parent.postMessage({ type: 'toast', message, toastType: type }, '*');

    // Se estiver no contexto principal
    const container = document.getElementById('toastContainer');
    if (container) {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
      t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${this.escapeHTML(message)}</span>`;
      container.appendChild(t);
      setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
    }
  },

  /* ---------- DATA / HORA ---------- */
  today() { return new Date().toISOString().slice(0, 10); },
  now() { return new Date().toISOString(); },
  formatDate(dateStr) {
    if (!dateStr) return 'Sem data';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
  },
  formatDateTime(ts) {
    if (!ts) return '';
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
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
    const data = this.getLocalDB();
    data.logs.unshift({
      id: this.genId(), action, userId, details, timestamp: this.now()
    });
    if (data.logs.length > 500) data.logs = data.logs.slice(0, 500);
    this.saveLocalDB(data);
  },
};

// Expor globalmente
window.core = Core;

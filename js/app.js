/* =========================================================
   CHECKLIST ML — app.js  (Parte 1/3)
   Controlador principal: auth, navegação, tema, sidebar
   ========================================================= */

const App = {
  currentUser: null,
  currentPage: 'home',
  settings: null,

  /* ========== INICIALIZAÇÃO ========== */
  async init() {
    // Carregar configurações
    const data = core.getLocalDB();
    this.settings = data.settings;

    // Aplicar tema salvo
    this.applyTheme(this.settings.theme, this.settings.mode);

    // Verificar se há usuário logado
    this.currentUser = core.getCurrentUser();

    if (!this.currentUser) {
      // Verificar "lembrar login"
      this.currentUser = core.getRememberedUser();
      if (this.currentUser) core.setCurrentUser(this.currentUser);
    }

    // Listener de mensagens dos iframes
    window.addEventListener('message', (e) => this.handleMessage(e));

    // Listener do Firebase Auth
    auth.onAuthStateChanged(async (fbUser) => {
      if (fbUser && !this.currentUser) {
        // Usuário logado via Firebase mas não temos sessão local
        await this.syncFirebaseUser(fbUser);
      }
    });

    // Mostrar tela correta
    document.getElementById('loadingScreen').classList.add('hidden');

    if (this.currentUser) {
      this.showApp();
    } else {
      this.showLogin();
    }
  },

  /* ========== TELAS ========== */
  showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('loginBrandName').textContent = this.settings.brand;
  },

  showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    this.renderSidebar();
    this.updateUserInfo();
    this.navigate(location.hash.slice(1) || 'home');
  },

  /* ========== LOGIN / CADASTRO ========== */
  switchTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    this.clearErrors();
  },

  clearErrors() {
    document.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
  },

  showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg; el.classList.add('show');
  },

  togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
    else { input.type = 'password'; btn.textContent = '👁'; }
  },

  checkPasswordStrength(pass) {
    const score = core.passwordStrength(pass);
    const bar = document.getElementById('passStrengthBar');
    const text = document.getElementById('passStrengthText');
    const levels = [
      { w: '0%', c: '#E2E8F0', t: '' },
      { w: '20%', c: '#EF4444', t: 'Muito fraca' },
      { w: '40%', c: '#F59E0B', t: 'Fraca' },
      { w: '60%', c: '#F59E0B', t: 'Razoável' },
      { w: '80%', c: '#10B981', t: 'Forte' },
      { w: '100%', c: '#059669', t: 'Muito forte' },
    ];
    const l = levels[score];
    bar.style.width = l.w; bar.style.background = l.c;
    text.textContent = l.t;
  },

  async handleLogin(e) {
    e.preventDefault();
    this.clearErrors();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const remember = document.getElementById('rememberMe').checked;

    // Tentar login Firebase primeiro
    try {
      // Procurar email pelo username ou usar como email
      let email = username;
      if (!username.includes('@')) {
        const data = core.getLocalDB();
        const user = data.users.find(u => u.username === username || u.user === username);
        if (user) email = user.email;
        else email = username + '@checklist.local';
      }

      const cred = await auth.signInWithEmailAndPassword(email, password);
      await this.loginSuccess(cred.user, remember);
      return;
    } catch (fbErr) {
      // Se falhou no Firebase, tentar login local (fallback)
      const data = core.getLocalDB();
      const user = data.users.find(u =>
        (u.username === username || u.user === username || u.email === username) && !u.banned
      );

      if (user) {
        const valid = await core.verifyPassword(password, user.passHash);
        if (valid) {
          this.currentUser = {
            id: user.id, uid: user.uid || user.id,
            username: user.username || user.user,
            email: user.email, name: user.name,
            lastName: user.lastName || '', phone: user.phone || '',
            address: user.address || '',
            avatar: user.avatar || '', avatarType: user.avatarType || 'emoji',
            role: user.role || 'member', provider: 'local'
          };
          core.setCurrentUser(this.currentUser);
          if (remember) core.setRememberedUser(this.currentUser);
          core.log('login', this.currentUser.id, 'Login local');
          this.showApp();
          core.toast('Bem-vindo de volta, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
          return;
        }
      }

      this.showError('loginError', 'Usuário ou senha incorretos');
    }
  },

  async loginSuccess(fbUser, remember) {
    // Buscar/criar perfil no Firestore
    const docRef = db.collection('users').doc(fbUser.uid);
    let doc = await docRef.get();
    let profile;

    if (doc.exists) {
      profile = doc.data();
    } else {
      // Primeiro login — criar perfil básico
      profile = {
        username: fbUser.email.split('@')[0],
        email: fbUser.email,
        name: fbUser.displayName || fbUser.email.split('@')[0],
        lastName: '',
        phone: '',
        address: '',
        avatar: fbUser.photoURL || '',
        avatarType: fbUser.photoURL ? 'google' : 'emoji',
        role: 'member',
        banned: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: fbUser.providerData[0]?.providerId || 'password'
      };
      await docRef.set(profile);

      // Também salvar localmente
      const data = core.getLocalDB();
      data.users.push({ id: fbUser.uid, ...profile });
      core.saveLocalDB(data);
    }

    if (profile.banned) {
      await auth.signOut();
      this.showError('loginError', 'Sua conta foi suspensa. Contate o administrador.');
      return;
    }

    this.currentUser = {
      id: fbUser.uid, uid: fbUser.uid,
      username: profile.username,
      email: profile.email,
      name: profile.name,
      lastName: profile.lastName || '',
      phone: profile.phone || '',
      address: profile.address || '',
      avatar: profile.avatar || '',
      avatarType: profile.avatarType || 'emoji',
      role: profile.role || 'member',
      provider: profile.provider || 'password'
    };

    core.setCurrentUser(this.currentUser);
    if (remember) core.setRememberedUser(this.currentUser);

    core.log('login', this.currentUser.id, 'Login Firebase');
    this.showApp();
    core.toast('Bem-vindo, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
  },

  async handleRegister(e) {
    e.preventDefault();
    this.clearErrors();

    const username = document.getElementById('regUser').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;

    // Validações
    if (username.length < 3) return this.showError('regError', 'Usuário deve ter pelo menos 3 caracteres');
    if (password !== passConfirm) return this.showError('regError', 'As senhas não coincidem');

    const validation = core.validatePassword(password);
    if (!validation.valid) return this.showError('regError', validation.errors.join(', '));

    // Verificar se usuário já existe localmente
    const data = core.getLocalDB();
    if (data.users.find(u => u.username === username || u.user === username))
      return this.showError('regError', 'Este nome de usuário já está em uso');

    try {
      // Criar no Firebase Auth
      const cred = await auth.createUserWithEmailAndPassword(email, password);

      // Atualizar displayName
      await cred.user.updateProfile({ displayName: username });

      // Criar perfil no Firestore
      const profile = {
        username, email,
        name: username, lastName: '', phone: '', address: '',
        avatar: '', avatarType: 'emoji',
        role: 'member', banned: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: 'password'
      };
      await db.collection('users').doc(cred.user.uid).set(profile);

      // Salvar localmente
      data.users.push({ id: cred.user.uid, ...profile });
      core.saveLocalDB(data);

      await this.loginSuccess(cred.user, false);
      core.toast('Conta criada com sucesso!', 'success');
    } catch (err) {
      let msg = 'Erro ao criar conta';
      if (err.code === 'auth/email-already-in-use') msg = 'Este e-mail já está cadastrado';
      else if (err.code === 'auth/weak-password') msg = 'Senha muito fraca';
      else if (err.code === 'auth/invalid-email') msg = 'E-mail inválido';
      else msg = err.message;
      this.showError('regError', msg);
    }
  },

  async loginGoogle() {
    try {
      const result = await auth.signInWithPopup(googleProvider);
      await this.loginSuccess(result.user, true);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        core.toast('Erro ao fazer login com Google: ' + err.message, 'error');
      }
    }
  },

  async syncFirebaseUser(fbUser) {
    try {
      const doc = await db.collection('users').doc(fbUser.uid).get();
      if (doc.exists) {
        const profile = doc.data();
        if (!profile.banned) {
          this.currentUser = {
            id: fbUser.uid, uid: fbUser.uid,
            username: profile.username,
            email: profile.email,
            name: profile.name,
            lastName: profile.lastName || '',
            phone: profile.phone || '',
            address: profile.address || '',
            avatar: profile.avatar || '',
            avatarType: profile.avatarType || 'emoji',
            role: profile.role || 'member',
            provider: profile.provider || 'google.com'
          };
          core.setCurrentUser(this.currentUser);
          this.showApp();
        }
      }
    } catch (err) {
      console.warn('syncFirebaseUser:', err);
    }
  },

  async handleLogout() {
    core.log('logout', this.currentUser?.id || 'unknown');
    try { await auth.signOut(); } catch {}
    core.setCurrentUser(null);
    core.setRememberedUser(null);
    this.currentUser = null;
    this.showLogin();
    core.toast('Você saiu da sua conta', 'info');
  },

  /* ========== NAVEGAÇÃO ========== */
  navigate(page) {
    if (!this.currentUser) return;

    // Verificar permissão de admin
    if (page === 'admin' && this.currentUser.role !== 'admin') {
      core.toast('Acesso restrito a administradores', 'warning');
      page = 'home';
    }

    this.currentPage = page;
    const frame = document.getElementById('pageFrame');
    frame.src = `pages/${page}.html`;

    // Atualizar breadcrumb
    const items = this.settings.menuItems;
    const item = items.find(i => i.id === page);
    const icon = item ? item.icon : '📄';
    const label = item ? item.label : page;
    document.getElementById('breadcrumb').textContent = `${icon} ${label}`;

    // Atualizar nav ativa
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === page));

    // Fechar sidebar no mobile
    this.closeSidebar();

    // Hash URL
    history.replaceState({}, '', '#' + page);
  },

  /* ========== SIDEBAR ========== */
  renderSidebar() {
    const nav = document.getElementById('sidebarNav');
    const items = this.settings.menuItems;
    const order = this.settings.menuOrder || items.map(i => i.id);

    let html = '<div class="nav-section"><div class="nav-section-title">Menu</div>';

    order.forEach(id => {
      const item = items.find(i => i.id === id);
      if (!item || !item.visible) return;
      if (item.adminOnly && this.currentUser.role !== 'admin') return;

      const isActive = this.currentPage === id ? 'active' : '';
      const badge = this.getBadge(id);

      html += `<div class="nav-item ${isActive}" data-page="${id}" onclick="App.navigate('${id}')">
        <span class="icon">${item.icon}</span>
        <span>${item.label}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ''}
      </div>`;
    });

    html += '</div>';
    nav.innerHTML = html;

    // Aplicar configurações de marca
    document.getElementById('sidebarBrand').textContent = this.settings.brand;
    document.title = this.settings.brand;

    // Logo customizado
    if (this.settings.logo) {
      document.getElementById('sidebarLogo').src = this.settings.logo;
    }

    // Favicon customizado
    if (this.settings.favicon) {
      document.querySelector('link[rel="icon"]').href = this.settings.favicon;
    }
  },

  getBadge(pageId) {
    if (pageId !== 'atividades') return '';
    const data = core.getLocalDB();
    const today = core.today();
    const late = data.tasks.filter(t => t.date && t.date < today && t.status !== 'finished' && t.status !== 'notdone');
    return late.length > 0 ? late.length : '';
  },

  updateUserInfo() {
    if (!this.currentUser) return;
    const u = this.currentUser;
    const initial = (u.name || u.username || '?')[0].toUpperCase();

    // Sidebar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (u.avatar && (u.avatarType === 'google' || u.avatarType === 'upload')) {
      sidebarAvatar.innerHTML = `<img src="${u.avatar}" alt="">`;
    } else if (u.avatar) {
      sidebarAvatar.textContent = u.avatar;
    } else {
      sidebarAvatar.textContent = initial;
    }
    document.getElementById('sidebarName').textContent = u.name || u.username;
    document.getElementById('sidebarRole').textContent = u.role;

    // Topbar
    const topbarAvatar = document.getElementById('topbarAvatar');
    if (u.avatar && (u.avatarType === 'google' || u.avatarType === 'upload')) {
      topbarAvatar.innerHTML = `<img src="${u.avatar}" alt="">`;
    } else if (u.avatar) {
      topbarAvatar.textContent = u.avatar;
    } else {
      topbarAvatar.textContent = initial;
    }
    document.getElementById('topbarName').textContent = u.name || u.username;

    // Botão de tema
    document.getElementById('btnTheme').textContent = this.settings.mode === 'dark' ? '☀️' : '🌙';
  },

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('show');
  },

  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
  },

  /* ========== TEMA ========== */
  applyTheme(theme, mode) {
    document.documentElement.dataset.theme = theme || 'ocean';
    document.documentElement.dataset.mode = mode || 'light';
    localStorage.setItem('cl-theme', theme);
    localStorage.setItem('cl-mode', mode);
    this.settings.theme = theme;
    this.settings.mode = mode;

    // Salvar
    const data = core.getLocalDB();
    data.settings.theme = theme;
    data.settings.mode = mode;
    core.saveLocalDB(data);
  },

  toggleTheme() {
    const newMode = this.settings.mode === 'dark' ? 'light' : 'dark';
    this.applyTheme(this.settings.theme, newMode);
    document.getElementById('btnTheme').textContent = newMode === 'dark' ? '☀️' : '🌙';
    // Notificar iframes
    const frame = document.getElementById('pageFrame');
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'themeChanged', theme: this.settings.theme, mode: newMode }, '*');
    }
  },

  setTheme(theme) {
    this.applyTheme(theme, this.settings.mode);
    this.renderSidebar();
  },

  /* ========== QUICK NEW TASK ========== */
  quickNewTask() {
    this.navigate('atividades');
    // Avisar o iframe para abrir o modal
    setTimeout(() => {
      const frame = document.getElementById('pageFrame');
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'newTask' }, '*');
      }
    }, 500);
  },

  /* ========== MENSAGENS DOS IFRAMES ========== */
  handleMessage(e) {
    const msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'toast':
        core.toast(msg.message, msg.toastType || 'info');
        break;
      case 'navigate':
        this.navigate(msg.page);
        break;
      case 'reload':
        this.renderSidebar();
        this.updateUserInfo();
        break;
      case 'themeChanged':
        this.applyTheme(msg.theme, msg.mode);
        break;
      case 'modal':
        this.showModal(msg.html);
        break;
      case 'closeModal':
        this.closeModal();
        break;
      case 'getUser':
        // iframe pedindo dados do usuário
        if (e.source) e.source.postMessage({ type: 'userData', user: this.currentUser }, '*');
        break;
      case 'updateBadge':
        this.renderSidebar();
        break;
    }
  },

  /* ========== MODAL ========== */
  showModal(html) {
    const container = document.getElementById('modalContainer');
    container.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">${html}</div>
    </div>`;
  },

  closeModal() {
    document.getElementById('modalContainer').innerHTML = '';
  },
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => App.init());

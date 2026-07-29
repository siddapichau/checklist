/* =========================================================
   CHECKLIST ML — app.js  (Parte 2/3)
   Controlador principal: auth, navegação, tema, sidebar,
   atalhos de teclado, busca global, sync, PWA
   ========================================================= */

const App = {
  currentUser: null,
  currentPage: 'home',
  settings: null,

  /* ========== INICIALIZAÇÃO ========== */
  async init() {
    // Registrar Service Worker
    this.registerSW();

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
      if (fbUser) {
        if (!this.currentUser) {
          await this.syncFirebaseUser(fbUser);
        }
        // Iniciar sync se não foi iniciado ainda
        if (this.currentUser && !fireSync._syncing) {
          fireSync.start(this.currentUser.uid || this.currentUser.id);
        }
      }
    });

    // Iniciar sync para usuário logado (mesmo local)
    if (this.currentUser && (this.currentUser.uid || this.currentUser.id)) {
      fireSync.start(this.currentUser.uid || this.currentUser.id);
    }

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Firebase Sync event listener
    window.addEventListener('firebaseSync', (e) => {
      if (e.detail.type === 'tasks') {
        this.renderSidebar();
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

  /* ========== SERVICE WORKER & PWA ========== */
  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .then((reg) => {
          console.log('✅ Service Worker registrado:', reg.scope);
          
          // Check for updates
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                core.toast('Nova versão disponível! Recarregue para atualizar.', 'info');
              }
            });
          });

          // Request push notification permission
          this.requestPushPermission(reg);
        })
        .catch(err => console.warn('SW registration failed:', err));
    }

    // PWA install prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      
      // Show install button after 5 seconds if not installed
      setTimeout(() => {
        if (deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
          this.showInstallBanner();
        }
      }, 5000);
    });

    // Store for install
    window._pwaInstall = () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(result => {
          console.log('PWA install:', result.outcome);
          deferredPrompt = null;
          const banner = document.getElementById('pwaBanner');
          if (banner) banner.remove();
        });
      }
    };
  },

  /* Request push notification permission */
  requestPushPermission(swReg) {
    if (!('Notification' in window) || !('PushManager' in window)) return;

    // Check current permission
    if (Notification.permission === 'granted') {
      this.subscribeToPush(swReg);
    } else if (Notification.permission !== 'denied') {
      // Ask after user has been using the app for a while
      setTimeout(() => {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            this.subscribeToPush(swReg);
          }
        });
      }, 30000); // 30 seconds delay before asking
    }
  },

  async subscribeToPush(swReg) {
    try {
      // Using VAPID would require a server, so we use a simple approach:
      // Store that user wants notifications
      localStorage.setItem('cl-push-enabled', 'true');
      console.log('🔔 Push notifications enabled');

      // Note: Full FCM integration requires a server-side component
      // to send messages via Firebase Admin SDK. The service worker
      // is already configured to receive and display push notifications.
      // To send notifications, use Firebase Cloud Messaging API with
      // the server key from Firebase Console > Cloud Messaging.

    } catch (err) {
      console.warn('Push subscription failed:', err);
    }
  },

  showInstallBanner() {
    const banner = document.createElement('div');
    banner.id = 'pwaBanner';
    banner.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9998;
      background:var(--card,#fff);border:1px solid var(--line,#E2E8F0);border-radius:12px;
      padding:14px 20px;display:flex;align-items:center;gap:12px;
      box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:14px;color:var(--text);
      animation:slideUp .4s ease;
    `;
    banner.innerHTML = `
      <span style="font-size:24px">📱</span>
      <span style="flex:1"><b>Instalar app</b><br><small style="color:var(--muted)">Use como aplicativo no seu celular</small></span>
      <button onclick="window._pwaInstall()" style="background:var(--primary);color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer;white-space:nowrap">Instalar</button>
      <button onclick="this.parentElement.remove()" style="border:0;background:none;cursor:pointer;font-size:18px;color:var(--muted)">×</button>
    `;
    document.body.appendChild(banner);
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
          fireSync.start(this.currentUser.uid || this.currentUser.id);
          core.toast('Bem-vindo de volta, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
          return;
        }
      }

      this.showError('loginError', 'Usuário ou senha incorretos');
    }
  },

  async loginSuccess(fbUser, remember) {
    const docRef = db.collection('users').doc(fbUser.uid);
    let doc = await docRef.get();
    let profile;

    if (doc.exists) {
      profile = doc.data();
    } else {
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
    
    // Iniciar Firebase sync
    fireSync.start(this.currentUser.uid || this.currentUser.id);
    
    core.toast('Bem-vindo, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
  },

  async handleRegister(e) {
    e.preventDefault();
    this.clearErrors();

    const username = document.getElementById('regUser').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;

    if (username.length < 3) return this.showError('regError', 'Usuário deve ter pelo menos 3 caracteres');
    if (password !== passConfirm) return this.showError('regError', 'As senhas não coincidem');

    const validation = core.validatePassword(password);
    if (!validation.valid) return this.showError('regError', validation.errors.join(', '));

    const data = core.getLocalDB();
    if (data.users.find(u => u.username === username || u.user === username))
      return this.showError('regError', 'Este nome de usuário já está em uso');

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: username });

      const profile = {
        username, email,
        name: username, lastName: '', phone: '', address: '',
        avatar: '', avatarType: 'emoji',
        role: 'member', banned: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: 'password'
      };
      await db.collection('users').doc(cred.user.uid).set(profile);

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
          fireSync.start(this.currentUser.uid || this.currentUser.id);
        }
      }
    } catch (err) {
      console.warn('syncFirebaseUser:', err);
    }
  },

  async handleLogout() {
    core.log('logout', this.currentUser?.id || 'unknown');
    fireSync.stop();
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

    if (page === 'admin' && this.currentUser.role !== 'admin') {
      core.toast('Acesso restrito a administradores', 'warning');
      page = 'home';
    }

    this.currentPage = page;
    const frame = document.getElementById('pageFrame');
    frame.src = `pages/${page}.html`;

    // Animação de transição
    frame.style.opacity = '0';
    frame.style.transform = 'translateY(6px)';
    frame.style.transition = 'opacity .2s ease, transform .2s ease';
    frame.onload = () => {
      frame.style.opacity = '1';
      frame.style.transform = 'none';
      frame.onload = null;
    };

    const items = this.settings.menuItems;
    const item = items.find(i => i.id === page);
    const icon = item ? item.icon : '📄';
    const label = item ? item.label : page;
    document.getElementById('breadcrumb').textContent = `${icon} ${label}`;

    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === page));

    this.closeSidebar();
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

    document.getElementById('sidebarBrand').textContent = this.settings.brand;
    document.title = this.settings.brand;

    if (this.settings.logo) {
      document.getElementById('sidebarLogo').src = this.settings.logo;
    }
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

    const topbarAvatar = document.getElementById('topbarAvatar');
    if (u.avatar && (u.avatarType === 'google' || u.avatarType === 'upload')) {
      topbarAvatar.innerHTML = `<img src="${u.avatar}" alt="">`;
    } else if (u.avatar) {
      topbarAvatar.textContent = u.avatar;
    } else {
      topbarAvatar.textContent = initial;
    }
    document.getElementById('topbarName').textContent = u.name || u.username;

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

    const data = core.getLocalDB();
    data.settings.theme = theme;
    data.settings.mode = mode;
    core.saveLocalDB(data);
  },

  toggleTheme() {
    const newMode = this.settings.mode === 'dark' ? 'light' : 'dark';
    this.applyTheme(this.settings.theme, newMode);
    document.getElementById('btnTheme').textContent = newMode === 'dark' ? '☀️' : '🌙';
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
    setTimeout(() => {
      const frame = document.getElementById('pageFrame');
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'newTask' }, '*');
      }
    }, 500);
  },

  /* ========== KEYBOARD SHORTCUTS ========== */
  setupKeyboardShortcuts() {
    let gKeyPressed = false;
    let gKeyTimeout = null;

    document.addEventListener('keydown', (e) => {
      // Ignorar se foco está em input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+K: Busca global
      if (ctrl && key === 'k') {
        e.preventDefault();
        this.openGlobalSearch();
        return;
      }

      // Ctrl+? ou apenas ?: Mostrar ajuda
      if (key === '?' || (ctrl && key === '/')) {
        e.preventDefault();
        this.showShortcutHelp();
        return;
      }

      // G + H: Ir para home
      if (key === 'g') {
        gKeyPressed = true;
        clearTimeout(gKeyTimeout);
        gKeyTimeout = setTimeout(() => { gKeyPressed = false; }, 1000);
        return;
      }

      if (gKeyPressed && key === 'h') {
        e.preventDefault();
        gKeyPressed = false;
        this.navigate('home');
        return;
      }

      if (gKeyPressed && key === 'a') {
        e.preventDefault();
        gKeyPressed = false;
        this.navigate('atividades');
        return;
      }

      gKeyPressed = false;

      // N: Nova atividade
      if (key === 'n') {
        e.preventDefault();
        this.quickNewTask();
        return;
      }

      // T: Alternar tema
      if (key === 't') {
        e.preventDefault();
        this.toggleTheme();
        return;
      }
    });
  },

  openGlobalSearch() {
    const existing = document.getElementById('globalSearchModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'globalSearchModal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);
      display:flex;align-items:flex-start;justify-content:center;padding-top:15vh;
      animation:fadeIn .2s ease;
    `;
    overlay.onclick = function(e) { if (e.target === this) this.remove(); };

    overlay.innerHTML = `
      <div style="background:var(--card,#fff);border-radius:16px;width:min(600px,95vw);box-shadow:0 25px 60px rgba(0,0,0,.3);overflow:hidden;animation:slideUp .25s ease">
        <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line,#E2E8F0)">
          <span style="font-size:20px">🔍</span>
          <input type="text" id="globalSearchInput" placeholder="Buscar em atividades, arquivos e notícias..."
            style="flex:1;border:0;outline:none;font-size:16px;background:transparent;color:var(--text,#1E293B)"
            oninput="App.performGlobalSearch(this.value)">
          <kbd style="background:var(--bg-secondary,#F1F5F9);padding:4px 8px;border-radius:6px;font-size:11px;color:var(--muted)">ESC</kbd>
        </div>
        <div id="globalSearchResults" style="max-height:50vh;overflow-y:auto;padding:8px">
          <div class="empty"><p>Digite para buscar...</p></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
      const input = document.getElementById('globalSearchInput');
      if (input) input.focus();
    }, 100);

    // Close on ESC
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  performGlobalSearch(query) {
    const results = document.getElementById('globalSearchResults');
    if (!results) return;

    const q = query.toLowerCase().trim();

    if (q.length < 2) {
      results.innerHTML = '<div class="empty"><p>Digite pelo menos 2 caracteres...</p></div>';
      return;
    }

    const data = core.getLocalDB();
    let html = '';

    // Buscar em tasks
    const matchedTasks = (data.tasks || []).filter(t =>
      t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
    ).slice(0, 5);

    if (matchedTasks.length > 0) {
      html += '<div style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)">✅ Atividades</div>';
      matchedTasks.forEach(t => {
        html += `<div class="search-result-item" onclick="App.navigate('atividades');document.getElementById('globalSearchModal').remove()"
          style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;cursor:pointer;transition:.15s">
          <span>${t.status === 'finished' ? '✅' : '⬜'}</span>
          <div style="flex:1"><b style="font-size:14px">${core.escapeHTML(t.title)}</b>
          <small style="display:block;color:var(--muted)">${core.formatDate(t.date)} · ${core.escapeHTML(t.category || 'Geral')}</small></div>
        </div>`;
      });
    }

    // Buscar em arquivos
    const matchedFiles = (data.files || []).filter(f =>
      f.title.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q)
    ).slice(0, 3);

    if (matchedFiles.length > 0) {
      html += '<div style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)">📁 Arquivos</div>';
      matchedFiles.forEach(f => {
        html += `<a href="${f.url}" target="_blank" class="search-result-item"
          style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;cursor:pointer;text-decoration:none;color:inherit;transition:.15s">
          <span>📄</span><div style="flex:1"><b style="font-size:14px">${core.escapeHTML(f.title)}</b>
          <small style="display:block;color:var(--muted)">${core.escapeHTML(f.category || 'Geral')}</small></div></a>`;
      });
    }

    // Buscar em posts
    const matchedPosts = (data.posts || []).filter(p =>
      p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q)
    ).slice(0, 3);

    if (matchedPosts.length > 0) {
      html += '<div style="padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)">📰 Notícias</div>';
      matchedPosts.forEach(p => {
        html += `<div class="search-result-item"
          style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;cursor:pointer;transition:.15s">
          <span>📰</span><div style="flex:1"><b style="font-size:14px">${core.escapeHTML(p.title)}</b>
          <small style="display:block;color:var(--muted)">${p.category || 'Geral'} · ${core.formatDateTime(p.publishedAt)}</small></div></div>`;
      });
    }

    if (!html) {
      html = '<div class="empty"><div class="icon">🔍</div><p>Nenhum resultado para <b>' + core.escapeHTML(q) + '</b></p></div>';
    }

    results.innerHTML = html;
  },

  showShortcutHelp() {
    const existing = document.getElementById('shortcutHelpModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'shortcutHelpModal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:center;
      animation:fadeIn .2s ease;
    `;
    overlay.onclick = function(e) { if (e.target === this) this.remove(); };

    const shortcuts = [
      ['Ctrl + K', 'Busca global', '🔍'],
      ['N', 'Nova atividade', '✅'],
      ['T', 'Alternar tema claro/escuro', '🌙'],
      ['G H', 'Ir para Home', '📊'],
      ['G A', 'Ir para Atividades', '✅'],
      ['?', 'Mostrar esta ajuda', '❓'],
      ['ESC', 'Fechar modais', '✕'],
    ];

    overlay.innerHTML = `
      <div style="background:var(--card,#fff);border-radius:16px;width:min(440px,95vw);box-shadow:0 25px 60px rgba(0,0,0,.3);overflow:hidden;animation:slideUp .25s ease;padding:28px">
        <h2 style="margin:0 0 4px;font-size:20px;color:var(--text)">⌨️ Atalhos de teclado</h2>
        <p style="color:var(--muted);margin-bottom:20px">Dicas para usar o Checklist ML mais rápido</p>
        <div style="display:grid;gap:8px">
          ${shortcuts.map(s => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:var(--bg-secondary,#F1F5F9)">
              <kbd style="background:var(--card,#fff);border:1px solid var(--line);padding:4px 10px;border-radius:6px;font-size:13px;font-weight:700;font-family:monospace;min-width:60px;text-align:center;color:var(--text)">${s[0]}</kbd>
              <span style="font-size:18px;width:28px;text-align:center">${s[2]}</span>
              <span style="color:var(--text-secondary)">${s[1]}</span>
            </div>
          `).join('')}
        </div>
        <button onclick="this.closest('#shortcutHelpModal').remove()" class="btn btn-primary" style="width:100%;margin-top:20px">Entendi!</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
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
        if (e.source) e.source.postMessage({ type: 'userData', user: this.currentUser }, '*');
        break;
      case 'updateBadge':
        this.renderSidebar();
        break;
      case 'firebaseSync':
        // Forward to fireSync
        if (msg.collection && msg.data) {
          fireSync.pushDocument(msg.collection, msg.id, msg.data);
        }
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

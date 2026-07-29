/* =========================================================
   CHECKLIST ML — app.js  (Parte 2/3 + 3/3)
   Controlador principal: auth, navegação, tema, sidebar,
   atalhos de teclado, busca global, sync, PWA,
   i18n, temas custom, dark mode auto, automações, gamificação
   ========================================================= */

const App = {
  currentUser: null,
  currentPage: 'home',
  settings: null,

  /* ========== INICIALIZAÇÃO ========== */
  async init() {
    // Registrar Service Worker
    this.registerSW();

    // Verificar se há código de redefinição de senha na URL
    this.handlePasswordResetCode();

    // Carregar configurações
    const data = core.getLocalDB();
    this.settings = data.settings;

    // Inicializar auto dark mode
    core.initAutoTheme();

    // Pré-carregar idioma
    await core.tReady(this.settings.language);

    // Aplicar tema (incluindo custom themes e auto mode)
    this.applyTheme(this.settings.theme, this.settings.mode);

    // Inicializar gamificação (streak do dia)
    const user = core.getCurrentUser();
    if (user) {
      core.updateStreak(user.id || user.uid);
    }

    // Rodar automações de atraso (silencioso)
    try { core.checkLateAutomations(); } catch(e) { console.warn('checkLateAutomations:', e); }

    // Verificar se há usuário logado
    this.currentUser = core.getCurrentUser();

    if (!this.currentUser) {
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
        if (this.currentUser && !fireSync._syncing) {
          fireSync.start(this.currentUser.uid || this.currentUser.id);
        }
      }
    });

    if (this.currentUser && (this.currentUser.uid || this.currentUser.id)) {
      fireSync.start(this.currentUser.uid || this.currentUser.id);
    }

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Firebase Sync event listener
    window.addEventListener('firebaseSync', (e) => {
      if (e.detail.type === 'tasks') this.renderSidebar();
    });

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
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                core.toast('Nova versão disponível! Recarregue para atualizar.', 'info');
              }
            });
          });
          this.requestPushPermission(reg);
        })
        .catch(err => console.warn('SW registration failed:', err));
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      setTimeout(() => {
        if (deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
          this.showInstallBanner();
        }
      }, 5000);
    });

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

  requestPushPermission(swReg) {
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted') {
      this.subscribeToPush(swReg);
    } else if (Notification.permission !== 'denied') {
      setTimeout(() => {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') this.subscribeToPush(swReg);
        });
      }, 30000);
    }
  },

  async subscribeToPush(swReg) {
    try {
      localStorage.setItem('cl-push-enabled', 'true');
      console.log('🔔 Push notifications enabled');
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
    this.injectLanguageSwitcher();
    this.injectNotificationButton();
    this.navigate(location.hash.slice(1) || 'home');
  },

  /* ========== LOGIN / CADASTRO ========== */
  switchTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    document.getElementById('forgotForm')?.classList.add('hidden');
    this.clearErrors();
  },

  /**
   * Mostra o formulário de "esqueci minha senha"
   */
  showForgotPassword(e) {
    if (e) e.preventDefault();
    // Esconde tabs e mostra só o form de recuperação
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('forgotForm').classList.remove('hidden');
    this.clearErrors();
    setTimeout(() => document.getElementById('forgotEmail')?.focus(), 100);
  },

  /**
   * Envia o e-mail de recuperação de senha via Firebase Auth
   */
  async handleForgotPassword(e) {
    e.preventDefault();
    this.clearErrors();
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) {
      this.showError('forgotError', 'Digite um e-mail válido');
      return;
    }
    const errEl = document.getElementById('forgotError');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '⏳ Enviando...';

    try {
      // Usa o fluxo hospedado e seguro do Firebase. Não passamos uma URL de
      // continuação: ela precisaria estar em "Authorized domains" e era a
      // causa de auth/unauthorized-continue-uri em instalações novas.
      // O template padrão do Firebase funciona mesmo quando a edição do
      // template está bloqueada no Console.
      auth.useDeviceLanguage();
      await auth.sendPasswordResetEmail(email);
      // Sucesso: mostrar modal
      document.getElementById('forgotSentModal').classList.remove('hidden');
      document.getElementById('forgotForm').classList.add('hidden');
      document.getElementById('forgotEmail').value = '';
    } catch (err) {
      let msg = 'Erro ao enviar e-mail de recuperação';
      if (err.code === 'auth/user-not-found') {
        // Por segurança, não revelamos se o e-mail existe
        // Mesmo assim, mostramos o modal de "enviado"
        document.getElementById('forgotSentModal').classList.remove('hidden');
        document.getElementById('forgotForm').classList.add('hidden');
        document.getElementById('forgotEmail').value = '';
        btn.disabled = false;
        btn.textContent = '📧 Enviar link de recuperação';
        return;
      } else if (err.code === 'auth/invalid-email') msg = 'E-mail inválido';
      else if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde alguns minutos';
      else msg = err.message;
      this.showError('forgotError', msg);
    } finally {
      btn.disabled = false;
      btn.textContent = '📧 Enviar link de recuperação';
    }
  },

  /**
   * Detecta quando o usuário volta do e-mail com um código de redefinição
   * (o link no e-mail aponta para ?oobCode=XXXX)
   */
  async handlePasswordResetCode() {
    const url = new URL(window.location.href);
    const oobCode = url.searchParams.get('oobCode');
    const mode = url.searchParams.get('mode');
    if (mode === 'resetPassword' && oobCode) {
      try {
        // Verifica se o código é válido
        await auth.verifyPasswordResetCode(oobCode);
        // Pede nova senha em um modal
        this.showResetPasswordModal(oobCode);
      } catch (err) {
        core.toast('Link de recuperação inválido ou expirado', 'error');
      }
    }
  },

  showResetPasswordModal(oobCode) {
    const html = `
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🔑</div>
        <h2 style="margin-bottom:8px">Definir nova senha</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px">Escolha uma senha forte (mín. 8 chars, maiúsc, minúsc, 2 núm, especial)</p>
      </div>
      <label><span>Nova senha</span>
        <div class="input-group">
          <input type="password" id="newPassReset" required placeholder="Sua nova senha" oninput="App.checkPasswordStrength(this.value)">
          <button type="button" class="toggle-pass" onclick="App.togglePassword('newPassReset', this)">👁</button>
        </div>
        <div class="pass-strength"><div class="pass-strength-bar" id="passStrengthBarReset"></div></div>
        <small class="text-muted" id="passStrengthTextReset"></small>
      </label>
      <label><span>Confirmar nova senha</span>
        <div class="input-group">
          <input type="password" id="newPassConfirmReset" required placeholder="Repita a senha">
          <button type="button" class="toggle-pass" onclick="App.togglePassword('newPassConfirmReset', this)">👁</button>
        </div>
      </label>
      <div class="form-error" id="resetError"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="btnConfirmReset" onclick="App.confirmPasswordReset('${oobCode}')">💾 Redefinir senha</button>
      </div>
    `;
    this.showModal(html);
  },

  async confirmPasswordReset(oobCode) {
    const newPass = document.getElementById('newPassReset').value;
    const confirm = document.getElementById('newPassConfirmReset').value;
    const errEl = document.getElementById('resetError');
    errEl.classList.remove('show'); errEl.textContent = '';

    if (newPass !== confirm) {
      errEl.textContent = 'As senhas não coincidem';
      errEl.classList.add('show');
      return;
    }
    const validation = core.validatePassword(newPass);
    if (!validation.valid) {
      errEl.textContent = validation.errors.join(', ');
      errEl.classList.add('show');
      return;
    }
    const btn = document.getElementById('btnConfirmReset');
    btn.disabled = true;
    btn.textContent = '⏳ Redefinindo...';
    try {
      await auth.confirmPasswordReset(oobCode, newPass);
      this.closeModal();
      core.toast('Senha redefinida com sucesso! Faça login novamente.', 'success');
      // Limpar URL
      window.history.replaceState({}, '', window.location.pathname);
      this.showLogin();
    } catch (err) {
      errEl.textContent = err.message || 'Erro ao redefinir senha';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Redefinir senha';
    }
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
    const levels = [
      { w: '0%', c: '#E2E8F0', t: '' },
      { w: '20%', c: '#EF4444', t: 'Muito fraca' },
      { w: '40%', c: '#F59E0B', t: 'Fraca' },
      { w: '60%', c: '#F59E0B', t: 'Razoável' },
      { w: '80%', c: '#10B981', t: 'Forte' },
      { w: '100%', c: '#059669', t: 'Muito forte' },
    ];
    const l = levels[score];
    // Prioriza o campo visível (o formulário de cadastro continua no DOM
    // enquanto o modal de redefinição está aberto).
    const resetInput = document.getElementById('newPassReset');
    const isReset = resetInput && resetInput.offsetParent !== null;
    const bar = document.getElementById(isReset ? 'passStrengthBarReset' : 'passStrengthBar');
    const text = document.getElementById(isReset ? 'passStrengthTextReset' : 'passStrengthText');
    if (bar) { bar.style.width = l.w; bar.style.background = l.c; }
    if (text) text.textContent = l.t;
  },

  async handleLogin(e) {
    e.preventDefault();
    this.clearErrors();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const remember = document.getElementById('rememberMe').checked;

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

    // Inicializa gamificação
    core.getUserStats(this.currentUser.id);

    core.log('login', this.currentUser.id, 'Login Firebase');
    this.showApp();
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
          core.getUserStats(this.currentUser.id);
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
    // Limpar elementos injetados
    document.getElementById('langSwitcher')?.remove();
    document.getElementById('notifButton')?.remove();
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
    const label = item ? this.tr(item.label, item.id) : page;
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
      const label = this.tr(item.label, item.id);

      html += `<div class="nav-item ${isActive}" data-page="${id}" onclick="App.navigate('${id}')">
        <span class="icon">${item.icon}</span>
        <span>${label}</span>
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

    document.getElementById('btnTheme').textContent = this.getThemeIcon();
  },

  /* ========== TEMA ========== */
  applyTheme(theme, mode) {
    document.documentElement.dataset.theme = theme || 'ocean';
    // Se mode = 'auto', escutar o sistema
    if (mode === 'auto') {
      this._setupAutoListener();
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      document.documentElement.dataset.mode = mq.matches ? 'dark' : 'light';
    } else {
      this._removeAutoListener();
      document.documentElement.dataset.mode = mode || 'light';
    }
    localStorage.setItem('cl-theme', theme);
    localStorage.setItem('cl-mode', mode);
    this.settings.theme = theme;
    this.settings.mode = mode;

    // Aplicar tema custom se necessário
    const data = core.getLocalDB();
    const customThemes = data.customThemes || [];
    const isCustom = customThemes.find(t => t.id === theme);
    if (isCustom) {
      core.applyCustomTheme(theme);
    } else {
      // Remover custom-theme-style se tema não-custom
      const el = document.getElementById('custom-theme-style');
      if (el) el.textContent = '';
    }

    const data2 = core.getLocalDB();
    data2.settings.theme = theme;
    data2.settings.mode = mode;
    core.saveLocalDB(data2);

    // Atualizar ícone do botão
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = this.getThemeIcon();
  },

  _setupAutoListener() {
    if (this._autoMqlistener) return;
    this._autoMq = window.matchMedia('(prefers-color-scheme: dark)');
    this._autoMqlistener = () => {
      const actual = this._autoMq.matches ? 'dark' : 'light';
      document.documentElement.dataset.mode = actual;
    };
    if (this._autoMq.addEventListener) {
      this._autoMq.addEventListener('change', this._autoMqlistener);
    } else if (this._autoMq.addListener) {
      this._autoMq.addListener(this._autoMqlistener);
    }
  },
  _removeAutoListener() {
    if (this._autoMq && this._autoMqlistener) {
      if (this._autoMq.removeEventListener) {
        this._autoMq.removeEventListener('change', this._autoMqlistener);
      } else if (this._autoMq.removeListener) {
        this._autoMq.removeListener(this._autoMqlistener);
      }
    }
    this._autoMq = null;
    this._autoMqlistener = null;
  },

  getThemeIcon() {
    const mode = this.settings.mode;
    if (mode === 'auto') return '🌓';
    return mode === 'dark' ? '☀️' : '🌙';
  },

  /**
   * Cycle: light -> dark -> auto -> light
   */
  toggleTheme() {
    const cycle = ['light', 'dark', 'auto'];
    const idx = cycle.indexOf(this.settings.mode);
    const newMode = cycle[(idx + 1) % cycle.length];
    this.applyTheme(this.settings.theme, newMode);
    core.toast(
      newMode === 'auto' ? 'Modo automático (segue o sistema)' :
      newMode === 'dark' ? 'Modo escuro' : 'Modo claro',
      'info'
    );
    const frame = document.getElementById('pageFrame');
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'themeChanged', theme: this.settings.theme, mode: newMode }, '*');
    }
  },

  setTheme(theme) {
    this.applyTheme(theme, this.settings.mode);
    this.renderSidebar();
  },

  /* ========== LANGUAGE SWITCHER (i18n) ========== */
  injectLanguageSwitcher() {
    if (document.getElementById('langSwitcher')) return;
    const topbar = document.querySelector('.topbar-actions');
    if (!topbar) return;

    const wrap = document.createElement('div');
    wrap.id = 'langSwitcher';
    wrap.className = 'lang-switcher';
    wrap.innerHTML = `
      <button onclick="App.toggleLangMenu(event)" title="Idioma">
        🌐 <span>${this.getLangLabel(this.settings.language)}</span>
      </button>
      <div class="lang-menu hidden" id="langMenu">
        <button onclick="App.changeLang('pt-BR')" data-lang="pt-BR">🇧🇷 Português</button>
        <button onclick="App.changeLang('en')" data-lang="en">🇺🇸 English</button>
        <button onclick="App.changeLang('es')" data-lang="es">🇪🇸 Español</button>
      </div>
    `;
    topbar.insertBefore(wrap, topbar.firstChild);
    this.updateLangMenuActive();
  },

  getLangLabel(lang) {
    return { 'pt-BR': 'PT', 'en': 'EN', 'es': 'ES' }[lang] || 'PT';
  },

  toggleLangMenu(e) {
    e?.stopPropagation();
    const menu = document.getElementById('langMenu');
    if (menu) menu.classList.toggle('hidden');
  },

  async changeLang(lang) {
    if (this.settings.language === lang) {
      document.getElementById('langMenu')?.classList.add('hidden');
      return;
    }
    core.setLanguage(lang);
    await core.tReady(lang);
    this.settings.language = lang;

    // Atualizar interface
    this.updateLangMenuActive();
    this.renderSidebar();
    document.querySelector('#langSwitcher button span').textContent = this.getLangLabel(lang);
    document.getElementById('langMenu')?.classList.add('hidden');

    // Recarregar página atual para aplicar i18n
    const frame = document.getElementById('pageFrame');
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'languageChanged', lang }, '*');
    }
    // Recarregar a página após pequeno delay
    setTimeout(() => {
      const page = this.currentPage;
      frame.src = `pages/${page}.html?lang=${lang}&t=${Date.now()}`;
    }, 200);

    core.toast(lang === 'pt-BR' ? 'Idioma: Português' : lang === 'en' ? 'Language: English' : 'Idioma: Español', 'success');
  },

  updateLangMenuActive() {
    document.querySelectorAll('#langMenu button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === this.settings.language);
    });
  },

  /* ========== NOTIFICATION BUTTON ========== */
  injectNotificationButton() {
    if (document.getElementById('notifButton')) return;
    const topbar = document.querySelector('.topbar-actions');
    if (!topbar) return;

    const wrap = document.createElement('div');
    wrap.id = 'notifButton';
    wrap.className = 'lang-switcher';
    wrap.innerHTML = `
      <button class="notif-btn" onclick="App.toggleNotifMenu(event)" title="Notificações">
        🔔
        <span class="notif-dot hidden" id="notifDot"></span>
      </button>
      <div class="notif-dropdown hidden" id="notifMenu">
        <h4>
          <span>Notificações</span>
          <button onclick="App.markAllRead()">Marcar lidas</button>
        </h4>
        <div id="notifList"></div>
      </div>
    `;
    // Inserir antes do language switcher se existir, senão no início
    const langSw = document.getElementById('langSwitcher');
    if (langSw) topbar.insertBefore(wrap, langSw);
    else topbar.insertBefore(wrap, topbar.firstChild);

    this.renderNotifications();
  },

  toggleNotifMenu(e) {
    e?.stopPropagation();
    const menu = document.getElementById('notifMenu');
    if (menu) menu.classList.toggle('hidden');
    if (menu && !menu.classList.contains('hidden')) {
      this.renderNotifications();
    }
  },

  renderNotifications() {
    const list = document.getElementById('notifList');
    const dot = document.getElementById('notifDot');
    if (!list) return;

    if (!this.currentUser) return;
    const notifs = core.getNotifications(this.currentUser.id || this.currentUser.uid);
    const unread = notifs.filter(n => !n.read).length;

    if (dot) dot.classList.toggle('hidden', unread === 0);

    if (notifs.length === 0) {
      list.innerHTML = '<div class="notif-empty">Nenhuma notificação</div>';
      return;
    }

    list.innerHTML = notifs.slice(0, 20).map(n => `
      <div class="notif-item ${!n.read ? 'unread' : ''}" onclick="App.openNotif('${n.id}')">
        <div class="notif-icon">${n.type === 'warning' ? '⚠️' : n.type === 'error' ? '❌' : 'ℹ️'}</div>
        <div class="notif-content">
          <b>${core.escapeHTML(n.title)}</b>
          <small>${core.escapeHTML(n.body)}</small>
          <small style="margin-top:2px">${core.formatDateTime(n.timestamp)}</small>
        </div>
      </div>
    `).join('');
  },

  openNotif(id) {
    if (!this.currentUser) return;
    const notifs = core.getNotifications(this.currentUser.id || this.currentUser.uid);
    const n = notifs.find(x => x.id === id);
    if (n) {
      n.read = true;
      localStorage.setItem('cl-notifications-' + (this.currentUser.id || this.currentUser.uid), JSON.stringify(notifs));
    }
    this.renderNotifications();
    document.getElementById('notifMenu')?.classList.add('hidden');
    if (n?.data?.page) this.navigate(n.data.page);
  },

  markAllRead() {
    if (!this.currentUser) return;
    core.markAllNotificationsRead(this.currentUser.id || this.currentUser.uid);
    this.renderNotifications();
  },

  /* ========== i18n helper ========== */
  tr(label, id) {
    if (!id) return label;
    return core.t('nav.' + id, label);
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
      // ESC fecha menus
      if (e.key === 'Escape') {
        document.getElementById('langMenu')?.classList.add('hidden');
        document.getElementById('notifMenu')?.classList.add('hidden');
      }

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && key === 'k') {
        e.preventDefault();
        this.openGlobalSearch();
        return;
      }
      if (key === '?' || (ctrl && key === '/')) {
        e.preventDefault();
        this.showShortcutHelp();
        return;
      }
      if (key === 'g') {
        gKeyPressed = true;
        clearTimeout(gKeyTimeout);
        gKeyTimeout = setTimeout(() => { gKeyPressed = false; }, 1000);
        return;
      }
      if (gKeyPressed && key === 'h') { e.preventDefault(); gKeyPressed = false; this.navigate('home'); return; }
      if (gKeyPressed && key === 'a') { e.preventDefault(); gKeyPressed = false; this.navigate('atividades'); return; }
      if (gKeyPressed && key === 'k') { e.preventDefault(); gKeyPressed = false; this.navigate('kanban'); return; }
      if (gKeyPressed && key === 'c') { e.preventDefault(); gKeyPressed = false; this.navigate('calendario'); return; }

      gKeyPressed = false;

      if (key === 'n') { e.preventDefault(); this.quickNewTask(); return; }
      if (key === 't') { e.preventDefault(); this.toggleTheme(); return; }
    });

    // Fechar menus ao clicar fora
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#langSwitcher')) {
        document.getElementById('langMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('#notifButton')) {
        document.getElementById('notifMenu')?.classList.add('hidden');
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
    setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 100);

    const escHandler = (e) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
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
    if (!html) html = '<div class="empty"><div class="icon">🔍</div><p>Nenhum resultado para <b>' + core.escapeHTML(q) + '</b></p></div>';
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
      ['T', 'Tema (claro/escuro/auto)', '🌓'],
      ['G H', 'Ir para Home', '📊'],
      ['G A', 'Ir para Atividades', '✅'],
      ['G K', 'Ir para Kanban', '📋'],
      ['G C', 'Ir para Calendário', '📅'],
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
        this.renderNotifications();
        break;
      case 'themeChanged':
        this.applyTheme(msg.theme, msg.mode);
        break;
      case 'languageChanged':
        // Recarrega o iframe para aplicar i18n
        this.settings.language = msg.lang;
        document.querySelector('#langSwitcher button span').textContent = this.getLangLabel(msg.lang);
        this.updateLangMenuActive();
        this.renderSidebar();
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
        this.renderNotifications();
        break;
      case 'firebaseSync':
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

document.addEventListener('DOMContentLoaded', () => App.init());

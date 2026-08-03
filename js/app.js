/* =========================================================
   CHECKLIST ML — app.js (v19 - Firebase Only + reCAPTCHA Enterprise)
   Refatoração completa:
   - 100% Firebase Auth (sem fallback local passHash)
   - reCAPTCHA Enterprise ativo (site key 6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO)
   - Login, cadastro, verificação de email, reset de senha, troca de senha
   - App Check com reCAPTCHA Enterprise Provider

   Ações reCAPTCHA:
     LOGIN, REGISTER, FORGOT_PASSWORD, PASSWORD_RESET, VERIFY_EMAIL,
     GOOGLE_LOGIN, CHANGE_PASSWORD, RESEND_VERIFICATION

   Backend Java exemplo (fornecido pelo usuário) deve validar token:
     Event event = Event.newBuilder().setSiteKey(recaptchaKey).setToken(token).build();
     Assessment response = client.createAssessment(parent, Assessment.newBuilder().setEvent(event).build());
   ========================================================= */

const App = {
  currentUser: null,
  currentPage: 'home',
  settings: null,
  _authListenerAttached: false,
  _initDone: false,
  _swUpdateRequested: false,
  _recoveryListenersAttached: false,
  _lastConnectionRecovery: 0,
  _alertTimer: null,

  MENU_GROUPS: [
    { id: 'operacao',    icon: '📋', label: 'Operação',      items: ['home', 'atividades', 'kanban', 'calendario', 'notas'] },
    { id: 'produtividade', icon: '🎯', label: 'Produtividade', items: ['gamificacao', 'foco'] },
    { id: 'recursos',    icon: '🗂️', label: 'Recursos',      items: ['arquivos', 'macros', 'relatorios'] },
    { id: 'ferramentas', icon: '🧰', label: 'Ferramentas',   items: ['custom', 'IA'] },
    { id: 'sistema',     icon: '⚙️', label: 'Sistema',       items: ['perfil', 'admin'] },
  ],

  RECAPTCHA_SITE_KEY: '6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO',

  /* ========== reCAPTCHA Helper ========== */
  async getRecaptchaToken(action = 'LOGIN') {
    try {
      if (window.getRecaptchaToken && typeof window.getRecaptchaToken === 'function') {
        const token = await window.getRecaptchaToken(action);
        if (token && window.fireSync && fireSync.logRecaptchaAssessment) {
          // Log não bloqueia
          fireSync.logRecaptchaAssessment(action, token).catch(()=>{});
        }
        return token;
      }
      // Fallback direto grecaptcha
      if (window.grecaptcha && grecaptcha.enterprise) {
        return await new Promise((resolve) => {
          grecaptcha.enterprise.ready(async () => {
            try {
              const t = await grecaptcha.enterprise.execute(this.RECAPTCHA_SITE_KEY, { action });
              resolve(t);
            } catch { resolve(null); }
          });
        });
      }
    } catch (e) {
      console.warn('getRecaptchaToken falhou:', e);
    }
    return null;
  },

  // Wrapper usado no onClick exemplo do usuário:
  // function onClick(e) { e.preventDefault(); grecaptcha.enterprise.ready(async () => { const token = await grecaptcha.enterprise.execute('SITE_KEY', {action: 'LOGIN'}); }); }
  async onClickRecaptcha(e, action = 'LOGIN') {
    if (e && e.preventDefault) e.preventDefault();
    return await this.getRecaptchaToken(action);
  },

  /* ========== INICIALIZAÇÃO ========== */
  async init() {
    if (this._initDone) return;
    this._initDone = true;

    this.registerSW();
    // Tratar todos os modos de oobCode: resetPassword, verifyEmail, recoverEmail
    this.handleAuthActionFromURL();

    const data = core.getLocalDB();
    this.settings = data.settings;

    core.initAutoTheme();
    this.applyFontSize();
    await core.tReady(this.settings.language);

    // Firebase Auth é a ÚNICA fonte de verdade para sessão.
    // Não usamos mais rememberUser local sem Firebase; usamos persistence do SDK.

    this.applyUserTheme();
    // Tentar atualizar streak se houver sessão anterior em cache (mas vai ser sobrescrito pelo onAuth)
    try {
      const cached = core.getCurrentUser();
      if (cached) { this.currentUser = cached; core.updateStreak(cached.id || cached.uid); }
    } catch(e) {}

    window.addEventListener('message', (e) => this.handleMessage(e));

    if (!this._authListenerAttached) {
      this._authListenerAttached = true;
      auth.onAuthStateChanged(async (fbUser) => {
        try {
          if (fbUser) {
            console.log('🔥 Auth state: logado', fbUser.uid, 'emailVerified:', fbUser.emailVerified);
            // Verificação de email obrigatória para provider password, mas liberada para Google
            const isGoogle = fbUser.providerData.some(p => p.providerId === 'google.com');
            if (!isGoogle && !fbUser.emailVerified) {
              // Usuário logado mas email não verificado -> mostrar modal de verificação
              console.log('✉️ Email não verificado, exigindo verificação');
              // Não chamar sync ainda, apenas manter sessão mas mostrar verificação
              // Mas still sync para buscar perfil? Sim, vamos sync e mostrar modal
              await this.syncFirebaseUser(fbUser, true); // true = suppress showApp
              this.showEmailVerificationRequired(fbUser);
              document.getElementById('loadingScreen')?.classList.add('hidden');
              this.showLogin(); // Esconde app, mas deixa modal de verificação
              document.getElementById('emailVerifyModal')?.classList.remove('hidden');
              document.getElementById('verifyEmailText').textContent =
                `Enviamos um link de confirmação para ${fbUser.email}. Verifique seu e-mail antes de continuar.`;
              return;
            }

            const localUid = this.currentUser?.uid || this.currentUser?.id;
            if (!this.currentUser || localUid !== fbUser.uid) {
              await this.syncFirebaseUser(fbUser);
            } else if (this.currentUser &&
                       this.isBootstrapAdminEmail(fbUser.email) &&
                       this.currentUser.role !== 'admin') {
              const claimed = await this.claimBootstrapAdmin(fbUser, this.currentUser);
              if (claimed.role === 'admin') {
                this.currentUser = { ...this.currentUser, role: 'admin' };
                core.setCurrentUser(this.currentUser);
                this.updateUserInfo();
                this.renderSidebar();
                fireSync.stop();
                fireSync.start(fbUser.uid);
              }
            }
            if (this.currentUser && (this.currentUser.uid || this.currentUser.id)) {
              const uid = this.currentUser.uid || this.currentUser.id;
              if (uid === fbUser.uid) {
                fireSync.start(uid);
                // Em atualizações de página o Firebase pode restaurar a sessão
                // depois do fallback que mostra o login. Se já temos o usuário
                // em cache e ele é o mesmo do Auth, garanta a volta ao app.
                this.showApp();
              }
            }
          } else {
            console.log('🔥 Auth state: deslogado');
            if (fireSync._syncing) fireSync.stop();
            // Limpar currentUser se estava logado e agora deslogou
            if (this.currentUser) {
              this.currentUser = null;
              core.setCurrentUser(null);
              core.setRememberedUser(null);
              // Se estava no app, voltar pro login
              const appScreen = document.getElementById('appScreen');
              if (appScreen && !appScreen.classList.contains('hidden')) {
                this.showLogin();
              }
            }
          }
        } catch(err) {
          console.warn('onAuthStateChanged erro:', err);
        }
      });
    }

    this.setupKeyboardShortcuts();
    this.setupAppRecovery();

    window.addEventListener('firebaseSync', (e) => {
      const type = e.detail?.type;
      if (type === 'users') this.refreshCurrentUserFromDB();
      if (type === 'tasks') this.renderSidebar();
      if (type === 'settings') {
        this.settings = core.getLocalDB().settings;
        this.applyUserTheme();
        this.renderSidebar();
        this.updateLangMenuActive();
      }
      if (type === 'notifications') this.renderNotifications();
      const frame = document.getElementById('pageFrame');
      if (frame?.contentWindow) {
        frame.contentWindow.postMessage({ type: 'firebaseSync', collection: type }, '*');
      }
    });

    setTimeout(() => {
      const loading = document.getElementById('loadingScreen');
      if (loading) loading.classList.add('hidden');
    }, 500);
    document.getElementById('loadingScreen')?.classList.add('hidden');

    // A decisão de mostrar app ou login será tomada pelo onAuthStateChanged,
    // mas fazemos um fallback rápido para não piscar.
    const fbCurrent = auth.currentUser;
    if (fbCurrent && fbCurrent.emailVerified) {
      // Já tem auth, mas sync será feito; enquanto isso mostra loading -> onAuth vai mostrar app
      this.currentUser = core.getCurrentUser(); // pode ser null ainda
      if (this.currentUser) this.showApp();
    } else if (!fbCurrent) {
      // Sem Firebase user, mostrar login
      this.showLogin();
    }
  },

  /* ========== SERVICE WORKER & PWA ========== */
  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'flushOutbox') {
          try { fireSync._flushOutbox(); } catch (e) { console.warn('flushOutbox SW:', e); }
        }
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!this._swUpdateRequested) return;
        this._swUpdateRequested = false;
        try {
          if (sessionStorage.getItem('cl-sw-reloaded') === '1') return;
          sessionStorage.setItem('cl-sw-reloaded', '1');
        } catch(e) {}
        window.location.reload();
      });

      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .then((reg) => {
          console.log('✅ Service Worker registrado:', reg.scope);
          const activateUpdate = (worker) => {
            if (!worker || !navigator.serviceWorker.controller) return;
            this._swUpdateRequested = true;
            core.toast('Atualizando o aplicativo para mantê-lo estável…', 'info');
            worker.postMessage({ type: 'SKIP_WAITING' });
          };
          if (reg.waiting) activateUpdate(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed') activateUpdate(newWorker);
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

  setupAppRecovery() {
    if (this._recoveryListenersAttached) return;
    this._recoveryListenersAttached = true;

    const recover = (reason) => {
      const uid = this.currentUser?.uid || this.currentUser?.id;
      const now = Date.now();
      const staleConnection = reason === 'visible' && now - this._lastConnectionRecovery > 60000;
      if (uid && auth.currentUser?.uid === uid && (!fireSync._syncing || staleConnection)) {
        if (staleConnection) fireSync.stop();
        fireSync.start(uid);
        this._lastConnectionRecovery = now;
      }
      const frame = document.getElementById('pageFrame');
      if (this.currentUser && frame && !frame.getAttribute('src')) {
        this.navigate(this.currentPage || 'home');
      }
      console.log('♻️ Recuperação do app:', reason);
    };

    window.addEventListener('online', () => recover('online'));
    window.addEventListener('pageshow', event => {
      if (event.persisted) recover('pageshow');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recover('visible');
    });
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
    if (document.getElementById('pwaBanner')) return;
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
    document.getElementById('loginScreen')?.classList.remove('hidden');
    document.getElementById('appScreen')?.classList.add('hidden');
    const brandEl = document.getElementById('loginBrandName');
    if (brandEl) brandEl.textContent = this.settings?.brand || 'Checklist ML';
    // Garantir que a aba login é a ativa quando volta
    // Não força se o usuário estava em forgotForm? Deixa o tab switch decidir.
  },

  showApp() {
    document.getElementById('loginScreen')?.classList.add('hidden');
    document.getElementById('appScreen')?.classList.remove('hidden');
    // Esconder modais de verificação/login
    document.getElementById('emailVerifyModal')?.classList.add('hidden');
    document.getElementById('forgotSentModal')?.classList.add('hidden');
    try { core.checkLateAutomations(this.currentUser?.id || this.currentUser?.uid); } catch(e) {
      console.warn('checkLateAutomations:', e);
    }
    this.renderSidebar();
    this.updateUserInfo();
    this.injectLanguageSwitcher();
    this.injectNotificationButton();
    this.startTaskAlertMonitor();
    const page = location.hash.slice(1) || 'home';
    this.navigate(page);
  },

  /* ========== TABS LOGIN / CADASTRO ========== */
  switchTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginForm')?.classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm')?.classList.toggle('hidden', tab !== 'register');
    document.getElementById('forgotForm')?.classList.add('hidden');
    this.clearErrors();
  },

  showForgotPassword(e) {
    if (e) e.preventDefault();
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('forgotForm')?.classList.remove('hidden');
    this.clearErrors();
    setTimeout(() => document.getElementById('forgotEmail')?.focus(), 100);
  },

  /* ========== ESQUECI MINHA SENHA - 100% Firebase + reCAPTCHA ========== */
  async handleForgotPassword(e) {
    e.preventDefault();
    this.clearErrors();
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) {
      this.showError('forgotError', 'Digite um e-mail válido');
      return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Verificando...';

    try {
      const token = await this.getRecaptchaToken('FORGOT_PASSWORD');
      console.log('reCAPTCHA token para FORGOT_PASSWORD:', token ? 'OK' : 'null (continuando)');

      btn.textContent = '⏳ Enviando e-mail...';
      auth.useDeviceLanguage();
      await auth.sendPasswordResetEmail(email);

      document.getElementById('forgotSentModal')?.classList.remove('hidden');
      document.getElementById('forgotForm')?.classList.add('hidden');
      document.getElementById('forgotEmail').value = '';
      core.toast('Link de recuperação enviado!', 'success');
    } catch (err) {
      console.warn('Forgot password erro:', err);
      if (err.code === 'auth/user-not-found') {
        // Por segurança, mostrar mesma mensagem
        document.getElementById('forgotSentModal')?.classList.remove('hidden');
        document.getElementById('forgotForm')?.classList.add('hidden');
        document.getElementById('forgotEmail').value = '';
        return;
      } else if (err.code === 'auth/invalid-email') {
        this.showError('forgotError', 'E-mail inválido');
      } else if (err.code === 'auth/too-many-requests') {
        this.showError('forgotError', 'Muitas tentativas. Aguarde alguns minutos.');
      } else {
        this.showError('forgotError', err.message || 'Erro ao enviar. Verifique sua conexão.');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  /* ========== Tratamento de oobCode na URL: resetPassword, verifyEmail, recoverEmail ========== */
  async handleAuthActionFromURL() {
    try {
      const url = new URL(window.location.href);
      const oobCode = url.searchParams.get('oobCode');
      const mode = url.searchParams.get('mode');
      if (!oobCode || !mode) return;

      console.log('🔗 Auth action detectada na URL:', mode);

      if (mode === 'resetPassword') {
        try {
          const email = await auth.verifyPasswordResetCode(oobCode);
          console.log('Reset para:', email);
          this.showResetPasswordModal(oobCode, email);
        } catch (err) {
          core.toast('Link de recuperação inválido ou expirado. Solicite um novo.', 'error');
          this.showError('loginError', 'Link de redefinição expirado. Use "Esqueci minha senha" novamente.');
          this.showLogin();
        }
      } else if (mode === 'verifyEmail') {
        try {
          await auth.applyActionCode(oobCode);
          core.toast('E-mail verificado com sucesso! Você já pode entrar. ✅', 'success');
          this.showModal(`
            <div style="text-align:center">
              <div style="font-size:64px;margin-bottom:16px">✅</div>
              <h2 style="margin-bottom:12px">E-mail verificado!</h2>
              <p style="color:var(--text-secondary);margin-bottom:20px">Seu e-mail foi confirmado. Agora você tem acesso completo ao Checklist ML.</p>
              <button class="btn btn-primary" onclick="App.closeModal();App.switchTab('login')">Ir para o login</button>
            </div>
          `);
          window.history.replaceState({}, '', window.location.pathname);
          // Se já estiver logado, recarregar user para atualizar emailVerified
          if (auth.currentUser) {
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
              setTimeout(() => this.showApp(), 800);
            }
          }
        } catch (err) {
          console.warn('verifyEmail erro:', err);
          core.toast('Link de verificação inválido ou expirado.', 'error');
          this.showModal(`
            <div style="text-align:center">
              <div style="font-size:64px;margin-bottom:16px">⚠️</div>
              <h2 style="margin-bottom:12px">Link expirado</h2>
              <p style="color:var(--text-secondary);margin-bottom:20px">O link de verificação expirou. Faça login e solicite um novo.</p>
              <button class="btn btn-primary" onclick="App.closeModal()">Fechar</button>
            </div>
          `);
        }
      } else if (mode === 'recoverEmail') {
        try {
          const info = await auth.checkActionCode(oobCode);
          const restoredEmail = info['data']['email'];
          await auth.applyActionCode(oobCode);
          await auth.sendPasswordResetEmail(restoredEmail);
          core.toast(`E-mail restaurado para ${restoredEmail}. Verifique a redefinição de senha.`, 'success');
          this.showModal(`
            <div style="text-align:center">
              <div style="font-size:48px;margin-bottom:12px">🔄</div>
              <h2>E-mail recuperado</h2>
              <p style="margin:16px 0">Seu e-mail foi restaurado para <b>${restoredEmail}</b>. Um e-mail de redefinição de senha foi enviado.</p>
              <button class="btn btn-primary" onclick="App.closeModal()">OK</button>
            </div>
          `);
          window.history.replaceState({}, '', window.location.pathname);
        } catch (err) {
          core.toast('Falha ao recuperar e-mail: ' + (err.message || ''), 'error');
        }
      }
    } catch (err) {
      console.warn('handleAuthActionFromURL geral:', err);
    }
  },

  /* Alias para compatibilidade com código antigo que chamava handlePasswordResetCode */
  async handlePasswordResetCode() {
    return this.handleAuthActionFromURL();
  },

  showResetPasswordModal(oobCode, email = '') {
    const safeEmail = email ? `para <b>${core.escapeHTML(email)}</b>` : '';
    const html = `
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🔑</div>
        <h2 style="margin-bottom:8px">Definir nova senha</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:4px">Redefinindo senha ${safeEmail}</p>
        
      </div>
      <label><span>Nova senha</span>
        <div class="input-group">
          <input type="password" id="newPassReset" required placeholder="Mín. 8 chars, maiúsc, minúsc, 2 núm, especial" oninput="App.checkPasswordStrength(this.value)" autocomplete="new-password">
          <button type="button" class="toggle-pass" onclick="App.togglePassword('newPassReset', this)">👁</button>
        </div>
        <div class="pass-strength"><div class="pass-strength-bar" id="passStrengthBarReset"></div></div>
        <small class="text-muted" id="passStrengthTextReset"></small>
      </label>
      <label><span>Confirmar nova senha</span>
        <div class="input-group">
          <input type="password" id="newPassConfirmReset" required placeholder="Repita a nova senha" autocomplete="new-password">
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
    if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }

    if (!newPass || !confirm) {
      if (errEl) { errEl.textContent = 'Preencha todos os campos'; errEl.classList.add('show'); }
      return;
    }
    if (newPass !== confirm) {
      if (errEl) { errEl.textContent = 'As senhas não coincidem'; errEl.classList.add('show'); }
      return;
    }
    const validation = core.validatePassword(newPass);
    if (!validation.valid) {
      if (errEl) { errEl.textContent = validation.errors.join(', '); errEl.classList.add('show'); }
      return;
    }
    const btn = document.getElementById('btnConfirmReset');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }

    try {
      const token = await this.getRecaptchaToken('PASSWORD_RESET');
      console.log('reCAPTCHA token PASSWORD_RESET:', token ? 'OK' : 'null');

      if (btn) btn.textContent = '⏳ Redefinindo...';
      await auth.confirmPasswordReset(oobCode, newPass);
      this.closeModal();
      core.toast('Senha redefinida com sucesso! Faça login com a nova senha.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
      this.showLogin();
      this.switchTab('login');
    } catch (err) {
      console.warn('confirmPasswordReset erro:', err);
      const msg = err.code === 'auth/expired-action-code' ? 'Link expirado. Solicite um novo.'
        : err.code === 'auth/invalid-action-code' ? 'Link inválido.'
        : err.code === 'auth/weak-password' ? 'Senha muito fraca.'
        : err.message || 'Erro ao redefinir senha';
      if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Redefinir senha'; }
    }
  },

  clearErrors() {
    document.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
  },

  showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('show'); }
  },

  togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
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
    const resetInput = document.getElementById('newPassReset');
    const isReset = resetInput && resetInput.offsetParent !== null;
    const bar = document.getElementById(isReset ? 'passStrengthBarReset' : 'passStrengthBar');
    const text = document.getElementById(isReset ? 'passStrengthTextReset' : 'passStrengthText');
    if (bar) { bar.style.width = l.w; bar.style.background = l.c; }
    if (text) text.textContent = l.t;
  },

  /* ========== LOGIN 100% FIREBASE + reCAPTCHA ENTERPRISE ========== */
  async handleLogin(e) {
    e.preventDefault();
    this.clearErrors();
    const email = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const remember = document.getElementById('rememberMe').checked;

    if (!email || !email.includes('@')) {
      this.showError('loginError', 'Digite um e-mail válido');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Aguarde...'; }

    try {
      const token = await this.getRecaptchaToken('LOGIN');
      console.log('reCAPTCHA LOGIN token:', token ? 'gerado' : 'null (App Check ainda protege)');

      if (btn) btn.textContent = '⏳ Entrando...';

      // Firebase Persistence: LOCAL = lembrar, SESSION = esquecer ao fechar
      const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);

      const cred = await auth.signInWithEmailAndPassword(email, password);

      // Verificação de email para contas password
      if (!cred.user.emailVerified) {
        // Verifica se provider é password (Google não precisa)
        const isGoogle = cred.user.providerData.some(p => p.providerId === 'google.com');
        if (!isGoogle) {
          console.log('Email não verificado, bloqueando acesso e oferecendo reenvio');
          this.showEmailVerificationRequired(cred.user);
          document.getElementById('emailVerifyModal')?.classList.remove('hidden');
          if (btn) { btn.disabled = false; btn.textContent = origText; }
          return;
        }
      }

      await this.loginSuccess(cred.user, remember);
      return;
    } catch (err) {
      console.warn('Firebase login erro:', err.code, err.message);
      let msg = 'E-mail ou senha incorretos';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'E-mail ou senha incorretos. Verifique ou use "Esqueci minha senha".';
      } else if (err.code === 'auth/invalid-email') msg = 'E-mail inválido';
      else if (err.code === 'auth/user-disabled') msg = 'Conta desativada. Contate o administrador.';
      else if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Tente mais tarde.';
      else if (err.code === 'auth/network-request-failed') msg = 'Falha de rede. Verifique sua conexão.';
      else msg = err.message || msg;
      this.showError('loginError', msg);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  /* ========== VERIFICAÇÃO DE EMAIL ========== */
  showEmailVerificationRequired(fbUser) {
    const modal = document.getElementById('emailVerifyModal');
    if (!modal) return;
    const textEl = document.getElementById('verifyEmailText');
    if (textEl) textEl.textContent = `Seu e-mail ${fbUser.email} ainda não foi verificado. Enviamos um link de verificação. Você precisa verificar antes de acessar o app.`;
    modal.classList.remove('hidden');
  },

  async checkEmailVerified() {
    const btn = document.getElementById('btnCheckVerified');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
    try {
      const user = auth.currentUser;
      if (!user) {
        core.toast('Nenhum usuário logado. Faça login novamente.', 'warning');
        document.getElementById('emailVerifyModal')?.classList.add('hidden');
        this.showLogin();
        return;
      }
      await user.reload();
      if (user.emailVerified) {
        core.toast('E-mail verificado! Bem-vindo! ✅', 'success');
        document.getElementById('emailVerifyModal')?.classList.add('hidden');
        await this.loginSuccess(user, true);
      } else {
        core.toast('E-mail ainda não verificado. Verifique sua caixa de entrada e clique no link.', 'warning');
        const errEl = document.getElementById('verifyError');
        if (errEl) {
          errEl.textContent = 'Ainda não verificado. Verifique spam e clique no link, depois tente novamente.';
          errEl.classList.remove('hidden');
          errEl.classList.add('show');
        }
      }
    } catch (err) {
      core.toast('Erro ao verificar: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  },

  async resendVerification() {
    const btn = document.getElementById('btnResendVerify');
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
    try {
      const token = await this.getRecaptchaToken('RESEND_VERIFICATION');
      console.log('reCAPTCHA RESEND_VERIFICATION:', token ? 'OK' : 'null');

      const user = auth.currentUser;
      if (!user) {
        core.toast('Faça login novamente para reenviar.', 'warning');
        return;
      }
      await user.sendEmailVerification();
      core.toast(`E-mail de verificação reenviado para ${user.email}! 📧 Verifique sua caixa de entrada.`, 'success');
      const errEl = document.getElementById('verifyError');
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); errEl.classList.remove('show'); }
    } catch (err) {
      console.warn('resendVerification erro:', err);
      let msg = err.message;
      if (err.code === 'auth/too-many-requests') msg = 'Muitas solicitações. Aguarde alguns minutos.';
      const errEl = document.getElementById('verifyError');
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); errEl.classList.add('show'); }
      core.toast(msg, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  },

  /* ========== Bootstrap Admin Claim ========== */
  isBootstrapAdminEmail(email) {
    return String(email || '').trim().toLowerCase() === 'wesleystudio@gmail.com';
  },

  _bootstrapMarker(fbUser) {
    return {
      claimedBy: fbUser.uid,
      email: fbUser.email,
      claimedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  },

  async claimBootstrapAdmin(fbUser, profile) {
    if (!this.isBootstrapAdminEmail(fbUser?.email) || profile?.role === 'admin') return profile;
    try {
      const bootstrapDoc = await db.collection('settings').doc('bootstrap').get();
      if (bootstrapDoc.exists) {
        const marker = bootstrapDoc.data();
        if (marker.claimedBy === fbUser.uid) {
          console.log('👑 Bootstrap marker existe para este UID - definindo role admin local');
          localStorage.setItem('cl-bootstrap-local-claimed', '1');
          try {
            const data = core.getLocalDB();
            const local = data.users.find(u => u.id === fbUser.uid || u.uid === fbUser.uid);
            if (local) { local.role = 'admin'; core.saveLocalDB(data); }
          } catch(e) {}
          return { ...profile, role: 'admin' };
        } else {
          console.log('⚠️ Bootstrap marker já foi usado por outra conta');
          return profile;
        }
      }
      console.log('👑 Marcador bootstrap não existe - tentando promover para admin');
      const batch = db.batch();
      batch.update(db.collection('users').doc(fbUser.uid), { role: 'admin' });
      batch.set(db.collection('settings').doc('bootstrap'), this._bootstrapMarker(fbUser));
      await batch.commit();
      console.log('👑 Claim de administrador executado (uso único consumido)');
      localStorage.setItem('cl-bootstrap-local-claimed', '1');
      core.toast('👑 Sua conta agora é administradora! O acesso de uso único foi encerrado automaticamente.', 'success');
      try {
        const data = core.getLocalDB();
        const local = data.users.find(u => u.id === fbUser.uid || u.uid === fbUser.uid);
        if (local) { local.role = 'admin'; core.saveLocalDB(data); }
      } catch(e) {}
      return { ...profile, role: 'admin' };
    } catch (err) {
      console.warn('Claim de admin não executado:', err.code || err.message);
      return profile;
    }
  },

  async createProfileDoc(docRef, profileForFirestore, profileForLocal, fbUser) {
    if (this.isBootstrapAdminEmail(fbUser.email)) {
      try {
        const batch = db.batch();
        batch.set(docRef, profileForFirestore);
        batch.set(db.collection('settings').doc('bootstrap'), this._bootstrapMarker(fbUser));
        await batch.commit();
        console.log('Perfil admin criado (claim de uso único consumido)');
        return profileForLocal;
      } catch (claimErr) {
        console.warn('Claim já utilizado ou regra antiga; criando perfil como membro:', claimErr.code);
        const memberFS = { ...profileForFirestore, role: 'member' };
        await docRef.set(memberFS);
        return { ...profileForLocal, role: 'member' };
      }
    }
    await docRef.set(profileForFirestore);
    return profileForLocal;
  },

  /* ========== Login Success - 100% Firebase ========== */
  async loginSuccess(fbUser, remember) {
    console.log('loginSuccess para', fbUser.uid, fbUser.email, 'verified:', fbUser.emailVerified);
    let profile = null;

    try {
      const docRef = db.collection('users').doc(fbUser.uid);
      const doc = await docRef.get();

      if (doc.exists) {
        profile = doc.data();
        console.log('Perfil existente:', profile.username);
      } else {
        console.log('Criando novo perfil para', fbUser.uid);
        const profileForFirestore = {
          username: (fbUser.email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g,'').slice(0,20),
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email.split('@')[0],
          lastName: '',
          phone: '',
          address: '',
          daysOff: [],
          dayOffDates: [],
          avatar: fbUser.photoURL || '',
          googlePhoto: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: this.isBootstrapAdminEmail(fbUser.email) ? 'admin' : 'member',
          banned: false,
          emailVerified: fbUser.emailVerified,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          provider: fbUser.providerData[0]?.providerId || 'password'
        };
        const profileForLocal = { ...profileForFirestore, createdAt: core.now() };

        try {
          profile = await this.createProfileDoc(docRef, profileForFirestore, profileForLocal, fbUser);
          console.log('Perfil criado no Firestore');
        } catch(setErr) {
          console.warn('Erro ao criar perfil no Firestore:', setErr.code, setErr.message);
          profile = profileForLocal;
        }

        try {
          const data = core.getLocalDB();
          if (!data.users.find(u => u.id === fbUser.uid)) {
            data.users.push({ id: fbUser.uid, uid: fbUser.uid, ...profile });
            core.saveLocalDB(data);
          }
        } catch(localErr) {
          console.warn('Erro ao salvar usuário local cache:', localErr);
        }
      }

      if (profile && profile.banned) {
        try { await auth.signOut(); } catch(e) {}
        this.showError('loginError', 'Sua conta foi suspensa. Contate o administrador.');
        return;
      }
    } catch (err) {
      console.error('loginSuccess getDoc erro:', err);
      if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
        profile = {
          username: (fbUser.email?.split('@')[0] || 'user'),
          email: fbUser.email || '',
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuário',
          lastName: '', phone: '', address: '',
          daysOff: [],
          dayOffDates: [],
          avatar: fbUser.photoURL || '',
          googlePhoto: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: 'member',
          banned: false,
          emailVerified: fbUser.emailVerified,
          createdAt: core.now(),
          provider: fbUser.providerData[0]?.providerId || 'google.com'
        };
        core.toast('Login feito. Seus dados serão sincronizados em breve.', 'warning');
      } else {
        core.toast('Erro ao carregar perfil: ' + err.message, 'error');
        profile = {
          username: fbUser.email?.split('@')[0] || 'user',
          email: fbUser.email || '',
          name: fbUser.displayName || 'Usuário',
          role: 'member', banned: false,
          avatar: fbUser.photoURL || '', avatarType: 'emoji',
          provider: 'google.com', emailVerified: fbUser.emailVerified
        };
      }
    }

    profile = await this.claimBootstrapAdmin(fbUser, profile);

    if (!profile) {
      this.showError('loginError', 'Erro ao carregar perfil. Tente novamente.');
      return;
    }

    this.currentUser = {
      id: fbUser.uid, uid: fbUser.uid,
      username: profile.username || fbUser.email?.split('@')[0] || 'user',
      email: profile.email || fbUser.email,
      name: profile.name || fbUser.displayName || profile.username,
      lastName: profile.lastName || '',
      phone: profile.phone || '',
      address: profile.address || '',
      daysOff: Array.isArray(profile.daysOff) ? profile.daysOff : [],
      dayOffDates: Array.isArray(profile.dayOffDates) ? profile.dayOffDates : (Array.isArray(profile.daysOffDates) ? profile.daysOffDates : []),
      avatar: profile.avatar || fbUser.photoURL || '',
      googlePhoto: profile.googlePhoto || fbUser.photoURL || '',
      avatarType: profile.avatarType || (fbUser.photoURL ? 'google' : 'emoji'),
      fontScale: profile.fontScale || 'normal',
      role: profile.role || 'member',
      provider: profile.provider || 'password',
      emailVerified: fbUser.emailVerified
    };

    core.setCurrentUser(this.currentUser);
    if (remember) core.setRememberedUser(this.currentUser);

    if (profile && profile.theme) {
      core.setUserThemePref(this.currentUser.id, profile.theme, profile.mode || 'auto');
    }
    this.applyUserTheme();
    this.applyFontSize(this.currentUser.fontScale || null);

    try { core.getUserStats(this.currentUser.id); } catch(e) {}
    try { core.log('login', this.currentUser.id, 'Login'); } catch(e) {}

    // Atualiza emailVerified no Firestore se mudou
    if (fbUser.emailVerified && profile.emailVerified !== true) {
      try { db.collection('users').doc(fbUser.uid).update({ emailVerified: true }).catch(()=>{}); } catch(e) {}
    }

    this.showApp();
    setTimeout(() => {
      const uid = this.currentUser?.uid || this.currentUser?.id;
      if (uid && auth.currentUser?.uid === uid) fireSync.start(uid);
    }, 500);
    core.toast('Bem-vindo, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
  },

  /* ========== CADASTRO 100% FIREBASE + reCAPTCHA ========== */
  async handleRegister(e) {
    e.preventDefault();
    this.clearErrors();

    const username = document.getElementById('regUser').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value;
    const passConfirm = document.getElementById('regPassConfirm').value;

    if (username.length < 3) return this.showError('regError', 'Nome deve ter pelo menos 3 caracteres');
    if (password !== passConfirm) return this.showError('regError', 'As senhas não coincidem');

    const validation = core.validatePassword(password);
    if (!validation.valid) return this.showError('regError', validation.errors.join(', '));

    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Aguarde...'; }

    try {
      const token = await this.getRecaptchaToken('REGISTER');
      console.log('reCAPTCHA REGISTER token:', token ? 'OK' : 'null');

      if (btn) btn.textContent = '⏳ Criando conta...';

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: username });

      // Enviar verificação de email imediatamente
      const actionCodeSettings = {
        url: window.location.origin + '/index.html',
        handleCodeInApp: false
      };
      try {
        await cred.user.sendEmailVerification(actionCodeSettings);
        console.log('Verification email enviado para', email);
      } catch (verErr) {
        console.warn('Falha ao enviar verificação:', verErr);
      }

      const profileFS = {
        username: username.replace(/[^a-zA-Z0-9_]/g,'').slice(0,20),
        email,
        name: username, lastName: '', phone: '', address: '',
        daysOff: [],
        dayOffDates: [],
        avatar: '', avatarType: 'emoji',
        role: this.isBootstrapAdminEmail(email) ? 'admin' : 'member',
        banned: false,
        emailVerified: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: 'password'
      };
      const profileLocal = { ...profileFS, createdAt: core.now() };

      let savedProfile = profileLocal;
      try {
        savedProfile = await this.createProfileDoc(
          db.collection('users').doc(cred.user.uid), profileFS, profileLocal, cred.user
        );
      } catch(setErr) {
        console.warn('Erro ao criar user no Firestore:', setErr);
      }

      try {
        const data = core.getLocalDB();
        data.users.push({ id: cred.user.uid, uid: cred.user.uid, ...savedProfile });
        core.saveLocalDB(data);
      } catch(e) {}

      // Mostrar modal de verificação de email, não logar automaticamente no app
      this.showEmailVerificationRequired(cred.user);
      document.getElementById('emailVerifyModal')?.classList.remove('hidden');
      document.getElementById('verifyEmailText').textContent =
        `Conta criada! Enviamos um e-mail de verificação para ${email}. Verifique sua caixa de entrada antes de acessar.`;

      core.toast('Conta criada! Verifique seu e-mail para ativar. ✉️', 'success');

      // Não chamar loginSuccess ainda; usuário deve verificar. Mas deixar auth logado para facilitar resend.

    } catch (err) {
      console.warn('handleRegister erro:', err);
      let msg = 'Erro ao criar conta';
      if (err.code === 'auth/email-already-in-use') msg = 'Este e-mail já está cadastrado. Use "Esqueci minha senha" se necessário.';
      else if (err.code === 'auth/weak-password') msg = 'Senha muito fraca';
      else if (err.code === 'auth/invalid-email') msg = 'E-mail inválido';
      else if (err.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde um pouco.';
      else msg = err.message;
      this.showError('regError', msg);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  /* ========== GOOGLE LOGIN + reCAPTCHA ========== */
  async loginGoogle() {
    const btn = document.querySelector('.btn-google');
    const origContent = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Aguarde...'; }

    try {
      const token = await this.getRecaptchaToken('GOOGLE_LOGIN');
      console.log('reCAPTCHA GOOGLE_LOGIN token:', token ? 'OK' : 'null');

      if (btn) btn.innerHTML = '⏳ Aguarde Google...';

      console.log('Iniciando login Google...');
      auth.useDeviceLanguage();
      const result = await auth.signInWithPopup(googleProvider);
      console.log('Popup OK', result.user.uid, 'verified:', result.user.emailVerified);
      // Google users já são verified, mas ainda checar
      await this.loginSuccess(result.user, true);
    } catch (err) {
      console.error('loginGoogle erro:', err);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        core.toast('Login cancelado', 'info');
      } else if (err.code === 'auth/popup-blocked') {
        core.toast('Popup bloqueado pelo navegador. Permita popups para este site.', 'error');
      } else if (err.code === 'auth/unauthorized-domain') {
        core.toast('Domínio não autorizado no Firebase. Adicione o domínio em Authentication > Authorized domains', 'error');
      } else if (err.code === 'auth/operation-not-allowed') {
        core.toast('Login Google não habilitado no Console Firebase > Authentication > Sign-in method', 'error');
      } else if (err.code === 'auth/too-many-requests') {
        core.toast('Muitas tentativas. Aguarde um pouco.', 'error');
      } else {
        core.toast('Erro ao fazer login com Google: ' + (err.message || err.code), 'error');
      }
      this.showLogin();
      document.getElementById('loadingScreen')?.classList.add('hidden');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origContent; }
    }
  },

  async syncFirebaseUser(fbUser, suppressShowApp = false) {
    if (!fbUser || !fbUser.uid) return;
    try {
      console.log('syncFirebaseUser', fbUser.uid);
      const doc = await db.collection('users').doc(fbUser.uid).get();
      if (doc.exists) {
        let profile = doc.data();
        profile = await this.claimBootstrapAdmin(fbUser, profile);
        if (profile.banned) {
          try { await auth.signOut(); } catch(e) {}
          this.showError('loginError', 'Conta suspensa');
          this.showLogin();
          return;
        }
        this.currentUser = {
          id: fbUser.uid, uid: fbUser.uid,
          username: profile.username || fbUser.email?.split('@')[0],
          email: profile.email || fbUser.email,
          name: profile.name || fbUser.displayName || profile.username,
          lastName: profile.lastName || '',
          phone: profile.phone || '',
          address: profile.address || '',
          daysOff: Array.isArray(profile.daysOff) ? profile.daysOff : [],
          dayOffDates: Array.isArray(profile.dayOffDates) ? profile.dayOffDates : (Array.isArray(profile.daysOffDates) ? profile.daysOffDates : []),
          avatar: profile.avatar || fbUser.photoURL || '',
          googlePhoto: profile.googlePhoto || fbUser.photoURL || '',
          avatarType: profile.avatarType || 'emoji',
          fontScale: profile.fontScale || 'normal',
          role: profile.role || 'member',
          provider: profile.provider || (fbUser.providerData[0]?.providerId || 'password'),
          emailVerified: fbUser.emailVerified
        };
        core.setCurrentUser(this.currentUser);
        if (profile && profile.theme) {
          core.setUserThemePref(this.currentUser.id, profile.theme, profile.mode || 'auto');
        }
        this.applyUserTheme();
        this.applyFontSize(this.currentUser.fontScale || null);
        try { core.getUserStats(this.currentUser.id); } catch(e) {}
        if (!suppressShowApp) this.showApp();
      } else {
        console.log('Usuário Firebase sem doc, criando...');
        await this.loginSuccess(fbUser, true);
      }
    } catch (err) {
      console.warn('syncFirebaseUser erro:', err.code, err.message);
      if (err.code === 'permission-denied') {
        core.toast('Sem permissão para carregar o perfil. Tente novamente.', 'warning');
        this.currentUser = {
          id: fbUser.uid, uid: fbUser.uid,
          username: fbUser.email?.split('@')[0] || 'user',
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email?.split('@')[0],
          daysOff: [],
          dayOffDates: [],
          avatar: fbUser.photoURL || '',
          googlePhoto: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: 'member',
          provider: 'google.com',
          emailVerified: fbUser.emailVerified
        };
        core.setCurrentUser(this.currentUser);
        if (!suppressShowApp) this.showApp();
      }
    }
  },

  async handleLogout() {
    try { core.log('logout', this.currentUser?.id || 'unknown'); } catch(e) {}
    fireSync.stop();
    try { await auth.signOut(); } catch {}
    core.setCurrentUser(null);
    core.setRememberedUser(null);
    this.currentUser = null;
    this.showLogin();
    document.getElementById('langSwitcher')?.remove();
    document.getElementById('notifButton')?.remove();
    document.getElementById('emailVerifyModal')?.classList.add('hidden');
    core.toast('Você saiu da sua conta.', 'info');
  },

  /* ========== NAVEGAÇÃO ========== */
  navigate(page) {
    if (!this.currentUser) return;

    const allowedPages = new Set((this.settings?.menuItems || []).map(item => item.id));
    if (!allowedPages.has(page)) page = 'home';

    if (page === 'admin' && this.currentUser.role !== 'admin') {
      core.toast('Acesso restrito a administradores', 'warning');
      page = 'home';
    }

    this.currentPage = page;
    const frame = document.getElementById('pageFrame');
    if (!frame) return;
    frame.src = `pages/${page}.html`;

    frame.style.opacity = '0';
    frame.style.transform = 'translateY(6px)';
    frame.style.transition = 'opacity .2s ease, transform .2s ease';
    frame.onload = () => {
      frame.style.opacity = '1';
      frame.style.transform = 'none';
      frame.onload = null;
    };

    const items = this.settings?.menuItems || [];
    const item = items.find(i => i.id === page);
    const icon = item ? item.icon : '📄';
    const label = item ? this.tr(item.label, item.id) : page;
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.textContent = `${icon} ${label}`;

    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === page));
    document.querySelectorAll('.topnav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.page === page));
    document.querySelectorAll('.topnav-group').forEach(g =>
      g.classList.toggle('has-active', Boolean(g.querySelector(`.topnav-item[data-page="${page}"]`))));

    this.closeSidebar();
    this.closeTopnavMenus();
    try { history.replaceState({}, '', '#' + page); } catch(e) {}
  },

  closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  },
  toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('open');
  },

  renderSidebar() {
    if (!this.settings?.menuItems) return;
    const items = this.settings.menuItems;
    const order = this.settings.menuOrder || items.map(i => i.id);

    const visibleItems = order
      .map(id => items.find(i => i.id === id))
      .filter(item => item && item.visible && (!item.adminOnly || this.currentUser?.role === 'admin'));

    const nav = document.getElementById('sidebarNav');
    if (nav) {
      let html = '<div class="nav-section"><div class="nav-section-title">Menu</div>';
      visibleItems.forEach(item => {
        const isActive = this.currentPage === item.id ? 'active' : '';
        const badge = this.getBadge(item.id);
        const label = this.tr(item.label, item.id);
        html += `<div class="nav-item ${isActive}" data-page="${item.id}" onclick="App.navigate('${item.id}')">
          <span class="icon">${item.icon}</span>
          <span>${label}</span>
          ${badge ? `<span class="badge">${badge}</span>` : ''}
        </div>`;
      });
      html += '</div>';
      nav.innerHTML = html;
    }

    this.renderTopnav(visibleItems);

    const brandEl = document.getElementById('sidebarBrand');
    if (brandEl) brandEl.textContent = this.settings.brand;
    const topBrandEl = document.getElementById('topbarBrand');
    if (topBrandEl) topBrandEl.textContent = this.settings.brand;
    document.title = this.settings.brand || 'Checklist ML';

    if (this.settings.logo) {
      const logoEl = document.getElementById('sidebarLogo');
      if (logoEl) logoEl.src = this.settings.logo;
      const topLogoEl = document.getElementById('topbarLogo');
      if (topLogoEl) topLogoEl.src = this.settings.logo;
    }
    if (this.settings.favicon) {
      const fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = this.settings.favicon;
    }
  },

  renderTopnav(visibleItems) {
    const nav = document.getElementById('topnav');
    if (!nav || !Array.isArray(visibleItems)) return;

    const html = this.MENU_GROUPS.map(group => {
      const groupItems = visibleItems.filter(item => group.items.includes(item.id));
      if (!groupItems.length) return '';

      const badgeTotal = groupItems.reduce((sum, item) => sum + (parseInt(this.getBadge(item.id), 10) || 0), 0);
      const hasActive = groupItems.some(item => item.id === this.currentPage);

      const menuItems = groupItems.map(item => {
        const badge = this.getBadge(item.id);
        return `<div class="topnav-item ${this.currentPage === item.id ? 'active' : ''}" data-page="${item.id}" onclick="App.navigate('${item.id}')">
          <span class="icon">${item.icon}</span>
          <span>${this.tr(item.label, item.id)}</span>
          ${badge ? `<span class="badge">${badge}</span>` : ''}
        </div>`;
      }).join('');

      return `<div class="topnav-group ${hasActive ? 'has-active' : ''}" data-group="${group.id}">
        <button type="button" class="topnav-trigger" onclick="App.toggleTopnavMenu('${group.id}', event)"
          aria-haspopup="true" aria-expanded="false">
          <span>${group.icon}</span>
          <span>${this.tr(group.label, 'group-' + group.id)}</span>
          <span class="caret">▾</span>
          ${badgeTotal ? `<span class="trigger-badge">${badgeTotal}</span>` : ''}
        </button>
        <div class="topnav-menu" role="menu">${menuItems}</div>
      </div>`;
    }).join('');

    nav.innerHTML = html;
    this.bindTopnavHover();
  },

  _topnavHoverDelay: { open: 110, close: 260 },
  _topnavTimers: { open: null, close: null },
  _topnavBound: false,

  supportsHover() {
    return window.matchMedia?.('(hover:hover) and (pointer:fine) and (min-width:1025px)').matches;
  },

  bindTopnavHover() {
    const nav = document.getElementById('topnav');
    if (!nav) return;
    if (this._topnavBound) return;
    this._topnavBound = true;

    const clearTimers = () => {
      clearTimeout(this._topnavTimers.open);
      clearTimeout(this._topnavTimers.close);
    };

    nav.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch' || !this.supportsHover()) return;
      const group = e.target.closest?.('.topnav-group');
      if (!group) return;
      clearTimers();
      const anyOpen = document.querySelector('.topnav-group.open');
      const delay = anyOpen && anyOpen !== group ? 0 : this._topnavHoverDelay.open;
      this._topnavTimers.open = setTimeout(() => this.openTopnavMenu(group), delay);
    }, true);

    nav.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch' || !this.supportsHover()) return;
      if (!e.target.closest?.('.topnav-group')) return;
      clearTimeout(this._topnavTimers.open);
      clearTimeout(this._topnavTimers.close);
      this._topnavTimers.close = setTimeout(() => {
        if (!document.querySelector('.topnav-group:hover')) this.closeTopnavMenus();
      }, this._topnavHoverDelay.close);
    }, true);

    nav.addEventListener('mouseleave', () => {
      if (!this.supportsHover()) return;
      clearTimeout(this._topnavTimers.open);
      clearTimeout(this._topnavTimers.close);
      this._topnavTimers.close = setTimeout(() => {
        if (!document.querySelector('.topnav-group:hover')) this.closeTopnavMenus();
      }, this._topnavHoverDelay.close);
    });

    nav.addEventListener('focusin', (e) => {
      if (this._topnavEscaped) return;
      const group = e.target.closest?.('.topnav-group');
      if (group) this.openTopnavMenu(group);
    });
    nav.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._topnavEscaped = true;
        this.closeTopnavMenus();
        e.target.closest?.('.topnav-group')?.querySelector('.topnav-trigger')?.focus();
        setTimeout(() => { this._topnavEscaped = false; }, 0);
      }
    });
  },

  openTopnavMenu(group) {
    if (!group) return;
    document.querySelectorAll('.topnav-group.open').forEach(g => {
      if (g !== group) {
        g.classList.remove('open');
        g.querySelector('.topnav-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });
    group.classList.add('open');
    group.querySelector('.topnav-trigger')?.setAttribute('aria-expanded', 'true');
    this.positionTopnavMenu(group);
  },

  positionTopnavMenu(group) {
    const menu = group.querySelector('.topnav-menu');
    if (!menu) return;
    group.classList.remove('align-right');
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) group.classList.add('align-right');
  },

  toggleTopnavMenu(groupId, event) {
    if (event) event.stopPropagation();
    const group = document.querySelector(`.topnav-group[data-group="${groupId}"]`);
    if (!group) return;
    clearTimeout(this._topnavTimers.open);
    clearTimeout(this._topnavTimers.close);
    if (group.classList.contains('open')) this.closeTopnavMenus();
    else this.openTopnavMenu(group);
  },

  closeTopnavMenus() {
    clearTimeout(this._topnavTimers.open);
    clearTimeout(this._topnavTimers.close);
    document.querySelectorAll('.topnav-group.open').forEach(g => {
      g.classList.remove('open');
      g.querySelector('.topnav-trigger')?.setAttribute('aria-expanded', 'false');
    });
  },

  startTaskAlertMonitor() {
    if (this._alertTimer) return;
    const tick = () => {
      try { this._checkTaskAlerts(); } catch (e) { console.warn('taskAlerts:', e); }
    };
    this._alertTimer = setInterval(tick, 30000);
    setTimeout(tick, 4000);
  },

  _checkTaskAlerts() {
    if (!this.currentUser) return;
    const uid = this.currentUser.id || this.currentUser.uid;
    const today = core.today();
    const nowParts = core._zonedParts();
    const hhmm = String(nowParts.hour).padStart(2, '0') + ':' + String(nowParts.minute).padStart(2, '0');
    const data = core.getLocalDB();

    (data.tasks || []).forEach(task => {
      if (!task.alertTime || task.date !== today) return;
      if (task.alertTime > hhmm) return;
      if (task.status === 'finished' || task.status === 'notdone') return;
      if (task.owner && uid && String(task.owner) !== String(uid)) return;

      const marker = `cl-alert-${task.id}-${task.date}-${task.alertTime}`;
      try { if (localStorage.getItem(marker)) return; } catch (e) {}
      try { localStorage.setItem(marker, '1'); } catch (e) {}

      const title = '⏰ Lembrete de atividade';
      const body = `${task.alertTime} — ${task.title}`;
      core._createNotification(uid, title, body, 'warning', {
        dedupeKey: `alert:${task.id}:${task.date}:${task.alertTime}`,
        data: { page: 'atividades', taskId: task.id },
        showToast: false,
        showBrowser: false,
      });
      core.chromeNotification(title, body, 'warning');
      try { this.renderNotifications(); } catch (e) {}
    });

    (data.notes || []).forEach(note => {
      if (note.done) return;
      if (!note.remind || !note.time || note.date !== today) return;
      if (note.time > hhmm) return;
      if (note.owner && uid && String(note.owner) !== String(uid)) return;

      const marker = `cl-alert-note-${note.id}-${note.date}-${note.time}`;
      try { if (localStorage.getItem(marker)) return; } catch (e) {}
      try { localStorage.setItem(marker, '1'); } catch (e) {}

      const title = '📝 Lembrete de nota';
      const body = `${note.time} — ${note.title}`;
      core._createNotification(uid, title, body, 'info', {
        dedupeKey: `alert:note:${note.id}:${note.date}:${note.time}`,
        data: { page: 'notas', noteId: note.id },
        showToast: false,
        showBrowser: false,
      });
      core.chromeNotification(title, body, 'info');
      try { this.renderNotifications(); } catch (e) {}
    });

    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith('cl-alert-') && !key.includes(`-${today}-`))
        .forEach(key => localStorage.removeItem(key));
    } catch (e) {}
  },

  getBadge(pageId) {
    if (pageId !== 'atividades') return '';
    try {
      const data = core.getLocalDB();
      const today = core.today();
      const late = data.tasks.filter(t => t.date && t.date < today && !core.isDayOff(t.date, this.currentUser) && t.status !== 'finished' && t.status !== 'notdone');
      return late.length > 0 ? late.length : '';
    } catch { return ''; }
  },

  refreshCurrentUserFromDB() {
    if (!this.currentUser) return;
    const uid = this.currentUser.uid || this.currentUser.id;
    const profile = (core.getLocalDB().users || []).find(u => String(u.uid || u.id) === String(uid));
    if (!profile) return;
    this.currentUser = {
      ...this.currentUser,
      ...profile,
      id: uid,
      uid,
      daysOff: Array.isArray(profile.daysOff) ? profile.daysOff : (this.currentUser.daysOff || []),
      dayOffDates: Array.isArray(profile.dayOffDates) ? profile.dayOffDates : (Array.isArray(profile.daysOffDates) ? profile.daysOffDates : (this.currentUser.dayOffDates || [])),
      googlePhoto: profile.googlePhoto || this.currentUser.googlePhoto || '',
      fontScale: profile.fontScale || this.currentUser.fontScale || 'normal',
    };
    core.setCurrentUser(this.currentUser);
    this.applyFontSize(this.currentUser.fontScale || null);
    this.updateUserInfo();
  },

  updateUserInfo() {
    if (!this.currentUser) return;
    const u = this.currentUser;
    const initial = (u.name || u.username || '?')[0].toUpperCase();

    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) {
      if (u.avatar && (u.avatarType === 'google' || u.avatarType === 'upload')) {
        sidebarAvatar.innerHTML = `<img src="${u.avatar}" alt="">`;
      } else if (u.avatar) {
        sidebarAvatar.textContent = u.avatar;
      } else {
        sidebarAvatar.textContent = initial;
      }
    }
    const sName = document.getElementById('sidebarName');
    if (sName) sName.textContent = u.name || u.username;
    const sRole = document.getElementById('sidebarRole');
    if (sRole) {
      const roles = { member: ['👤', 'Membro'], editor: ['✏️', 'Editor'], admin: ['⚙️', 'Admin'] };
      const [icon, label] = roles[u.role] || roles.member;
      sRole.textContent = `${icon} ${label}`;
      sRole.className = `role role-badge ${u.role || 'member'}`;
      sRole.title = `Cargo: ${label}${u.emailVerified ? ' • E-mail verificado' : ' • Verifique e-mail'}`;
    }

    const topbarAvatar = document.getElementById('topbarAvatar');
    if (topbarAvatar) {
      if (u.avatar && (u.avatarType === 'google' || u.avatarType === 'upload')) {
        topbarAvatar.innerHTML = `<img src="${u.avatar}" alt="">`;
      } else if (u.avatar) {
        topbarAvatar.textContent = u.avatar;
      } else {
        topbarAvatar.textContent = initial;
      }
    }
    const tName = document.getElementById('topbarName');
    if (tName) tName.textContent = u.name || u.username;

    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) btnTheme.textContent = this.getThemeIcon();
  },

  applyUserTheme() {
    const resolved = core.resolveTheme(this.currentUser);
    this.applyTheme(resolved.theme, resolved.mode);
  },

  applyTheme(theme, mode, sync = false) {
    if (!theme) return;
    document.documentElement.dataset.theme = theme || 'ocean';
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
    if (this.settings) {
      this.settings.theme = theme;
      this.settings.mode = mode;
    }

    const data = core.getLocalDB();
    const customThemes = data.customThemes || [];
    const isCustom = customThemes.find(t => t.id === theme);
    if (isCustom) {
      core.applyCustomTheme(theme);
    } else {
      const el = document.getElementById('custom-theme-style');
      if (el) el.textContent = '';
    }

    const data2 = core.getLocalDB();
    data2.settings.theme = theme;
    data2.settings.mode = mode;
    core.saveLocalDB(data2);

    const uid = this.currentUser && (this.currentUser.id || this.currentUser.uid);
    if (uid) core.setUserThemePref(uid, theme, mode);

    if (sync && uid) {
      fireSync.pushDocument('users', uid, { theme, mode });
    }

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
    const mode = this.settings?.mode || 'light';
    if (mode === 'auto') return '🌓';
    return mode === 'dark' ? '☀️' : '🌙';
  },

  toggleTheme() {
    if (!this.settings) return;
    const cycle = ['light', 'dark', 'auto'];
    const idx = cycle.indexOf(this.settings.mode);
    const newMode = cycle[(idx + 1) % cycle.length];
    this.applyTheme(this.settings.theme, newMode, true);
    core.toast(
      newMode === 'auto' ? 'Modo automático (segue o sistema)' :
      newMode === 'dark' ? 'Modo escuro' : 'Modo claro',
      'info'
    );
    const frame = document.getElementById('pageFrame');
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: 'themeChanged', theme: this.settings.theme, mode: newMode }, '*');
    }
  },

  applyFontSize(scale = null, sync = false) {
    const uid = this.currentUser && (this.currentUser.id || this.currentUser.uid);
    const key = uid ? `cl-font-scale:${uid}` : 'cl-font-scale';
    const value = scale || localStorage.getItem(key) || localStorage.getItem('cl-font-scale') || 'normal';
    document.documentElement.dataset.fontScale = value === 'large' ? 'large' : 'normal';
    localStorage.setItem('cl-font-scale', document.documentElement.dataset.fontScale);
    if (uid) localStorage.setItem(key, document.documentElement.dataset.fontScale);
    const btn = document.getElementById('btnFontSize');
    if (btn) btn.textContent = document.documentElement.dataset.fontScale === 'large' ? '🔡' : '🔠';
    if (sync && uid) {
      fireSync.pushDocument('users', uid, { fontScale: document.documentElement.dataset.fontScale });
    }
    const frame = document.getElementById('pageFrame');
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'fontScaleChanged', fontScale: document.documentElement.dataset.fontScale }, '*');
  },

  toggleFontSize() {
    const next = document.documentElement.dataset.fontScale === 'large' ? 'normal' : 'large';
    this.applyFontSize(next, true);
    core.toast(next === 'large' ? 'Fonte maior ativada' : 'Fonte normal ativada', 'info');
  },

  setTheme(theme) {
    if (!this.settings) return;
    this.applyTheme(theme, this.settings.mode);
    this.renderSidebar();
  },

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

    if (this.currentUser) {
      fireSync.pushDocument('users', this.currentUser.id, { language: lang });
    }

    this.updateLangMenuActive();
    this.renderSidebar();
    const span = document.querySelector('#langSwitcher button span');
    if (span) span.textContent = this.getLangLabel(lang);
    document.getElementById('langMenu')?.classList.add('hidden');

    const frame = document.getElementById('pageFrame');
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: 'languageChanged', lang }, '*');
    }
    setTimeout(() => {
      const page = this.currentPage;
      if (frame) frame.src = `pages/${page}.html?lang=${lang}&t=${Date.now()}`;
    }, 200);

    core.toast(lang === 'pt-BR' ? 'Idioma: Português' : lang === 'en' ? 'Language: English' : 'Idioma: Español', 'success');
  },

  updateLangMenuActive() {
    document.querySelectorAll('#langMenu button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === this.settings.language);
    });
  },

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
    const uid = this.currentUser.id || this.currentUser.uid;
    const notifs = core.getNotifications(uid);
    const n = notifs.find(x => x.id === id);
    if (n) {
      core.markNotificationRead(uid, id);
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

  tr(label, id) {
    if (!id) return label;
    return core.t('nav.' + id, label);
  },

  quickNewTask() {
    this.navigate('atividades');
    setTimeout(() => {
      const frame = document.getElementById('pageFrame');
      if (frame?.contentWindow) {
        frame.contentWindow.postMessage({ type: 'newTask' }, '*');
      }
    }, 500);
  },

  setupKeyboardShortcuts() {
    let gKeyPressed = false;
    let gKeyTimeout = null;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('langMenu')?.classList.add('hidden');
        document.getElementById('notifMenu')?.classList.add('hidden');
        this.closeTopnavMenus();
        document.getElementById('emailVerifyModal')?.classList.add('hidden');
        document.getElementById('forgotSentModal')?.classList.add('hidden');
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

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#langSwitcher')) {
        document.getElementById('langMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('#notifButton')) {
        document.getElementById('notifMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('.topnav-group')) {
        this.closeTopnavMenus();
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

  handleMessage(e) {
    if (e.origin !== window.location.origin) return;
    const msg = e.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'firebaseSync') {
      console.log('📤 Mensagem firebaseSync recebida:', msg.collection, msg.id);
    }

    switch (msg.type) {
      case 'toast':
        core.toast(msg.message, msg.toastType || 'info');
        break;
      case 'chromeNotif':
        core.chromeNotification(msg.title, msg.body, msg.notifType || 'info');
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
        this.applyTheme(msg.theme, msg.mode, true);
        break;
      case 'languageChanged':
        this.settings.language = msg.lang;
        const span = document.querySelector('#langSwitcher button span');
        if (span) span.textContent = this.getLangLabel(msg.lang);
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
        if (e.source) e.source.postMessage({ type: 'userData', user: this.currentUser }, window.location.origin);
        break;
      case 'updateBadge':
        this.renderSidebar();
        this.renderNotifications();
        break;
      case 'firebaseSync':
        if (msg.collection && msg.id !== undefined && msg.data) {
          console.log('📤 Enviando para Firestore:', msg.collection, msg.id);
          fireSync.pushDocument(msg.collection, msg.id, msg.data).then(ok => {
            if (!ok) console.warn('⚠️ pushDocument retornou false para', msg.collection, msg.id);
          }).catch(err => {
            console.error('❌ Erro no pushDocument:', err);
          });
        }
        break;
      case 'firebaseDelete':
        if (msg.collection && msg.id !== undefined) {
          console.log('🗑️ Deletando do Firestore:', msg.collection, msg.id);
          fireSync.deleteDocument(msg.collection, msg.id);
        }
        break;
      case 'firebaseSettings':
        if (msg.settings) fireSync.pushSettings(msg.settings);
        break;
      case 'firebaseGamification':
        if (msg.userId && msg.stats) fireSync.pushGamification(msg.userId, msg.stats);
        break;
      case 'firebaseWidgets':
        if (msg.userId && msg.widgets) fireSync.pushDashboardWidgets(msg.userId, msg.widgets);
        break;
      case 'firebaseUserPref':
        if (msg.section && msg.userId && msg.data) {
          fireSync.pushUserPref(msg.section, msg.userId, msg.data);
        }
        break;
    }
  },

  showModal(html) {
    const container = document.getElementById('modalContainer');
    if (!container) return;
    // O pop-up só fecha no botão X (ou nas ações do próprio conteúdo):
    // clicar fora não fecha, para ninguém perder uma edição por acidente.
    container.innerHTML = `<div class="modal-overlay">
      <div class="modal"><button type="button" class="modal-close-x" onclick="App.closeModal()" title="Fechar">✕</button>${html}</div>
    </div>`;
  },

  closeModal() {
    const c = document.getElementById('modalContainer');
    if (c) c.innerHTML = '';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  setTimeout(() => App.init(), 100);
}

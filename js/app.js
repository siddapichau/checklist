/* =========================================================
   CHECKLIST ML — app.js  (CORRIGIDO última atualização)
   Controlador principal: auth, navegação, tema, sidebar,
   FIX travamento login Google + regras Firestore
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

  /* ========== INICIALIZAÇÃO ========== */
  async init() {
    if (this._initDone) return;
    this._initDone = true;

    // Registrar Service Worker
    this.registerSW();
    this.handlePasswordResetCode();

    // Carregar configurações
    const data = core.getLocalDB();
    this.settings = data.settings;

    core.initAutoTheme();
    await core.tReady(this.settings.language);
    this.applyTheme(this.settings.theme, this.settings.mode);

    // Verificar se há usuário logado (session + remember)
    this.currentUser = core.getCurrentUser();
    if (!this.currentUser) {
      this.currentUser = core.getRememberedUser();
      if (this.currentUser) core.setCurrentUser(this.currentUser);
    }
    if (this.currentUser) {
      try { core.updateStreak(this.currentUser.id || this.currentUser.uid); } catch(e) {}
    }

    window.addEventListener('message', (e) => this.handleMessage(e));

    // Listener do Firebase Auth - UMA VEZ SÓ e com proteção anti-loop
    if (!this._authListenerAttached) {
      this._authListenerAttached = true;
      auth.onAuthStateChanged(async (fbUser) => {
        try {
          if (fbUser) {
            console.log('🔥 Auth state: logado', fbUser.uid);
            const localUid = this.currentUser?.uid || this.currentUser?.id;
            // Uma sessão lembrada pode pertencer a outra conta Firebase. Sempre
            // recarregue o perfil quando os UIDs não coincidem.
            if (!this.currentUser || localUid !== fbUser.uid) {
              await this.syncFirebaseUser(fbUser);
            } else if (this.currentUser &&
                       this.isBootstrapAdminEmail(fbUser.email) &&
                       this.currentUser.role !== 'admin') {
              // Sessão restaurada como membro: o claim de uso único ainda não
              // foi consumido — tente agora, senão o badge ficaria "membro".
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
              if (uid === fbUser.uid && !uid.includes('local-')) {
                fireSync.start(uid);
              }
            }
          } else {
            console.log('🔥 Auth state: deslogado');
            // Não fazer logout automático se usuário é local
            // Apenas parar o FireSync
            if (fireSync._syncing) fireSync.stop();
          }
        } catch(err) {
          console.warn('onAuthStateChanged erro:', err);
        }
      });
    }

    // Iniciar FireSync imediatamente se já tem usuário Firebase
    if (this.currentUser && (this.currentUser.uid || this.currentUser.id)) {
      const uid = this.currentUser.uid || this.currentUser.id;
      if (uid && !uid.includes('local-') && auth.currentUser?.uid === uid) {
        fireSync.start(uid);
      }
    }

    this.setupKeyboardShortcuts();
    this.setupAppRecovery();

    window.addEventListener('firebaseSync', (e) => {
      const type = e.detail?.type;
      if (type === 'tasks') this.renderSidebar();
      if (type === 'settings') {
        this.settings = core.getLocalDB().settings;
        this.applyTheme(this.settings.theme, this.settings.mode);
        this.renderSidebar();
        this.updateLangMenuActive();
      }
    });

    // Esconder loading SEMPRE, mesmo com erro
    setTimeout(() => {
      const loading = document.getElementById('loadingScreen');
      if (loading) loading.classList.add('hidden');
    }, 500);

    document.getElementById('loadingScreen')?.classList.add('hidden');

    if (this.currentUser) {
      this.showApp();
    } else {
      this.showLogin();
    }
  },

  /* ========== SERVICE WORKER & PWA ========== */
  registerSW() {
    if ('serviceWorker' in navigator) {
      // Um update do shell deve assumir o controle e recarregar uma única vez.
      // Isso evita que o APK fique preso em arquivos HTML/JS de versões diferentes.
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

  /* ========== RECUPERAÇÃO APÓS PAUSA / REDE ========== */
  setupAppRecovery() {
    if (this._recoveryListenersAttached) return;
    this._recoveryListenersAttached = true;

    const recover = (reason) => {
      const uid = this.currentUser?.uid || this.currentUser?.id;
      // Android pode suspender WebViews e encerrar conexões do Firestore enquanto
      // o app está em segundo plano. Ao voltar depois de algum tempo, renovamos
      // os listeners mesmo se o SDK ainda marcar o sync como ativo.
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
  },

  showApp() {
    document.getElementById('loginScreen')?.classList.add('hidden');
    document.getElementById('appScreen')?.classList.remove('hidden');
    // A verificação é idempotente por tarefa/automação/dia e não abre toasts de
    // login. Assim, tarefas atrasadas aparecem na central sem spam.
    try { core.checkLateAutomations(this.currentUser?.id || this.currentUser?.uid); } catch(e) {
      console.warn('checkLateAutomations:', e);
    }
    this.renderSidebar();
    this.updateUserInfo();
    this.injectLanguageSwitcher();
    this.injectNotificationButton();
    const page = location.hash.slice(1) || 'home';
    this.navigate(page);
  },

  /* ========== LOGIN / CADASTRO ========== */
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
    btn.textContent = '⏳ Enviando...';

    try {
      auth.useDeviceLanguage();
      await auth.sendPasswordResetEmail(email);
      document.getElementById('forgotSentModal')?.classList.remove('hidden');
      document.getElementById('forgotForm')?.classList.add('hidden');
      document.getElementById('forgotEmail').value = '';
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        document.getElementById('forgotSentModal')?.classList.remove('hidden');
        document.getElementById('forgotForm')?.classList.add('hidden');
        document.getElementById('forgotEmail').value = '';
        return;
      } else if (err.code === 'auth/invalid-email') {
        this.showError('forgotError', 'E-mail inválido');
      } else if (err.code === 'auth/too-many-requests') {
        this.showError('forgotError', 'Muitas tentativas. Aguarde alguns minutos');
      } else {
        this.showError('forgotError', err.message || 'Erro ao enviar');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  async handlePasswordResetCode() {
    try {
      const url = new URL(window.location.href);
      const oobCode = url.searchParams.get('oobCode');
      const mode = url.searchParams.get('mode');
      if (mode === 'resetPassword' && oobCode) {
        await auth.verifyPasswordResetCode(oobCode);
        this.showResetPasswordModal(oobCode);
      }
    } catch (err) {
      core.toast('Link de recuperação inválido ou expirado', 'error');
    }
  },

  showResetPasswordModal(oobCode) {
    const html = `
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🔑</div>
        <h2 style="margin-bottom:8px">Definir nova senha</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px">Escolha uma senha forte</p>
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
    if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }

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
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Redefinindo...'; }
    try {
      await auth.confirmPasswordReset(oobCode, newPass);
      this.closeModal();
      core.toast('Senha redefinida com sucesso! Faça login novamente.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
      this.showLogin();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Erro ao redefinir senha'; errEl.classList.add('show'); }
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

  async handleLogin(e) {
    e.preventDefault();
    this.clearErrors();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const remember = document.getElementById('rememberMe').checked;

    // Feedback imediato - desabilitar botão
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Entrando...'; }

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
      console.warn('Firebase login falhou, tentando local:', fbErr.code);
      // Fallback local
      try {
        const data = core.getLocalDB();
        const user = data.users.find(u =>
          (u.username === username || u.user === username || u.email === username) && !u.banned
        );

        if (user && user.passHash) {
          const valid = await core.verifyPassword(password, user.passHash);
          if (valid) {
            // Promoção bootstrap offline: verifica se o marcador settings/bootstrap
            // já existe no Firestore para evitar promoção duplicada.
            let role = user.role || 'member';
            if (this.isBootstrapAdminEmail(user.email) && role !== 'admin') {
              try {
                const bootstrapDoc = await db.collection('settings').doc('bootstrap').get();
                if (bootstrapDoc.exists) {
                  // Marcador existe - verificar se é o mesmo UID
                  const marker = bootstrapDoc.data();
                  if (marker.claimedBy === user.uid || marker.claimedBy === user.id) {
                    // Mesmo UID - o usuário já foi promovido antes
                    role = 'admin';
                    user.role = 'admin';
                    localStorage.setItem('cl-bootstrap-local-claimed', '1');
                    core.saveLocalDB(data);
                  }
                  // UID diferente = claim foi usado por outra conta, não fazer nada
                } else if (!localStorage.getItem('cl-bootstrap-local-claimed')) {
                  // Marcador não existe E localStorage não tem o flag
                  // Tentar promover via Firestore (vai criar o marcador)
                  try {
                    const batch = db.batch();
                    batch.update(db.collection('users').doc(user.uid || user.id), { role: 'admin' });
                    batch.set(db.collection('settings').doc('bootstrap'), {
                      claimedBy: user.uid || user.id,
                      email: user.email,
                      claimedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    await batch.commit();
                    role = 'admin';
                    user.role = 'admin';
                    localStorage.setItem('cl-bootstrap-local-claimed', '1');
                    core.saveLocalDB(data);
                    core.toast('👑 Conta promotionada para Admin!', 'success');
                  } catch(fireErr) {
                    console.warn('Erro ao promover via Firestore:', fireErr.code);
                    // Fallback: marcar localmente se as regras forem antigas
                    role = 'admin';
                    user.role = 'admin';
                    localStorage.setItem('cl-bootstrap-local-claimed', '1');
                    core.saveLocalDB(data);
                  }
                }
              } catch(checkErr) {
                console.warn('Erro ao verificar bootstrap marker:', checkErr.code);
                // Se não conseguir verificar, marcar localmente (fallback)
                if (!localStorage.getItem('cl-bootstrap-local-claimed')) {
                  role = 'admin';
                  user.role = 'admin';
                  localStorage.setItem('cl-bootstrap-local-claimed', '1');
                  core.saveLocalDB(data);
                }
              }
            }

            this.currentUser = {
              id: user.id, uid: user.uid || user.id,
              username: user.username || user.user,
              email: user.email, name: user.name,
              lastName: user.lastName || '', phone: user.phone || '',
              address: user.address || '',
              avatar: user.avatar || '', avatarType: user.avatarType || 'emoji',
              role: role, provider: 'local'
            };
            core.setCurrentUser(this.currentUser);
            if (remember) core.setRememberedUser(this.currentUser);
            core.log('login', this.currentUser.id, 'Login local');
            this.showApp();
            if (auth.currentUser?.uid === (this.currentUser.uid || this.currentUser.id)) {
              fireSync.start(this.currentUser.uid || this.currentUser.id);
            }
            core.toast('Bem-vindo de volta, ' + (this.currentUser.name || this.currentUser.username) + '!', 'success');
            return;
          }
        }

        // Se o usuário não existe localmente mas o email é o bootstrap admin,
        // cria uma conta local admin automaticamente — apenas UMA vez por
        // navegador (marcador local), igual ao claim do Firestore.
        if (!user && username.includes('@') && this.isBootstrapAdminEmail(username) &&
            !localStorage.getItem('cl-bootstrap-local-claimed')) {
          localStorage.setItem('cl-bootstrap-local-claimed', '1');
          const newId = 'local-' + core.genId();
          const passHash = await core.hashPassword(password);
          const newUser = {
            id: newId, uid: newId,
            username: username.split('@')[0].replace(/[^a-zA-Z0-9_]/g,'').slice(0,20),
            email: username,
            name: 'Admin', lastName: '',
            phone: '', address: '',
            avatar: '', avatarType: 'emoji',
            role: 'admin', banned: false,
            passHash: passHash,
            createdAt: core.now(),
            provider: 'local'
          };
          data.users.push(newUser);
          core.saveLocalDB(data);
          this.currentUser = {
            id: newId, uid: newId,
            username: newUser.username,
            email: newUser.email, name: newUser.name,
            lastName: '', phone: '', address: '',
            avatar: '', avatarType: 'emoji',
            role: 'admin', provider: 'local'
          };
          core.setCurrentUser(this.currentUser);
          if (remember) core.setRememberedUser(this.currentUser);
          core.log('login', this.currentUser.id, 'Admin bootstrap local');
          this.showApp();
          core.toast('Conta Admin criada e logada! Bem-vindo! ⚙️', 'success');
          return;
        }
      } catch(localErr) {
        console.warn('Local login erro:', localErr);
      }
      this.showError('loginError', 'Usuário ou senha incorretos');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  isBootstrapAdminEmail(email) {
    return String(email || '').trim().toLowerCase() === 'wesleystudio@gmail.com';
  },

  /* Dados do marcador de uso único gravado em settings/bootstrap */
  _bootstrapMarker(fbUser) {
    return {
      claimedBy: fbUser.uid,
      email: fbUser.email,
      claimedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  },

  /* ---------------------------------------------------------------
     CLAIM DE ADMINISTRADOR DE USO ÚNICO.
     Promove a conta bootstrap a admin em UMA operação atômica que também
     cria o marcador settings/bootstrap. As regras do Firestore só aceitam
     essa escrita enquanto o marcador não existir — e ele nunca pode ser
     alterado ou apagado. Resultado: funciona exatamente 1 vez e depois
     ninguém (nem esta conta) consegue reutilizar esse caminho.
     
     FLUXO:
     1. Verifica se o marcador settings/bootstrap já existe no Firestore
     2. Se não existir: tenta promover E criar o marcador (operação atômica)
     3. Se existir E é o mesmo UID: define role=admin localmente
     4. Se existir E é UID diferente: não faz nada (já foi usado)
     --------------------------------------------------------------- */
  async claimBootstrapAdmin(fbUser, profile) {
    if (!this.isBootstrapAdminEmail(fbUser?.email) || profile?.role === 'admin') return profile;
    
    // PRIMEIRO: verificar se o marcador já existe no Firestore
    try {
      const bootstrapDoc = await db.collection('settings').doc('bootstrap').get();
      
      if (bootstrapDoc.exists) {
        // Marcador já existe - verificar se é o mesmo UID
        const marker = bootstrapDoc.data();
        if (marker.claimedBy === fbUser.uid) {
          // Mesmo UID - o usuário JÁ foi promovido antes, só definir localmente
          console.log('👑 Bootstrap marker existe para este UID - definindo role admin local');
          localStorage.setItem('cl-bootstrap-local-claimed', '1');
          try {
            const data = core.getLocalDB();
            const local = data.users.find(u => u.id === fbUser.uid || u.uid === fbUser.uid);
            if (local) { local.role = 'admin'; core.saveLocalDB(data); }
          } catch(e) {}
          return { ...profile, role: 'admin' };
        } else {
          // UID diferente - o claim foi usado por outra conta
          console.log('⚠️ Bootstrap marker já foi usado por outra conta');
          return profile;
        }
      }
      
      // Marcador não existe - tentar promover E criar o marcador
      console.log('👑 Marcador bootstrap não existe - tentando promover para admin');
      
      const batch = db.batch();
      batch.update(db.collection('users').doc(fbUser.uid), { role: 'admin' });
      batch.set(db.collection('settings').doc('bootstrap'), this._bootstrapMarker(fbUser));
      await batch.commit();
      
      console.log('👑 Claim de administrador executado (uso único consumido)');
      localStorage.setItem('cl-bootstrap-local-claimed', '1');
      core.toast('👑 Sua conta agora é administradora! O acesso de uso único foi encerrado automaticamente.', 'success');
      
      // Refletir imediatamente no cache local
      try {
        const data = core.getLocalDB();
        const local = data.users.find(u => u.id === fbUser.uid || u.uid === fbUser.uid);
        if (local) { local.role = 'admin'; core.saveLocalDB(data); }
      } catch(e) {}
      return { ...profile, role: 'admin' };
      
    } catch (err) {
      console.warn('Claim de admin não executado:', err.code || err.message);
      
      // Se permissão negada na leitura, pode ser que as regras ainda não estão atualizadas
      // ou o marcador já existe. Tentar uma abordagem mais simples.
      if (err.code === 'permission-denied') {
        try {
          // Verificar localStorage primeiro
          if (localStorage.getItem('cl-bootstrap-local-claimed')) {
            console.log('👑 LocalStorage indica claim já usado - definindo role admin local');
            try {
              const data = core.getLocalDB();
              const local = data.users.find(u => u.id === fbUser.uid || u.uid === fbUser.uid);
              if (local) { local.role = 'admin'; core.saveLocalDB(data); }
            } catch(e) {}
            return { ...profile, role: 'admin' };
          }
        } catch(e) {}
        
        // Mostrar o aviso no máximo 1x por dia por navegador
        const last = Number(localStorage.getItem('cl-bootstrap-warn-ts') || 0);
        if (Date.now() - last > 86400000) {
          localStorage.setItem('cl-bootstrap-warn-ts', String(Date.now()));
          core.toast('⚠️ Não foi possível verificar o status do claim de admin. Verifique se as regras do Firestore foram atualizadas.', 'warning');
        }
      }
      return profile;
    }
  },

  /* Cria o perfil no Firestore. Para o e-mail bootstrap, o perfil admin e o
     marcador de uso único são gravados na MESMA operação atômica; se o claim
     já tiver sido consumido, o perfil é criado normalmente como membro. */
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

  async loginSuccess(fbUser, remember) {
    console.log('loginSuccess para', fbUser.uid, fbUser.email);
    let profile = null;
    let docExists = false;

    try {
      const docRef = db.collection('users').doc(fbUser.uid);
      const doc = await docRef.get();
      docExists = doc.exists;

      if (doc.exists) {
        profile = doc.data();
        console.log('Perfil existente:', profile.username);
      } else {
        console.log('Criando novo perfil para', fbUser.uid);
        // Criar perfil novo - usar objeto limpo sem FieldValue para localStorage
        const profileForFirestore = {
          username: (fbUser.email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g,'').slice(0,20),
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email.split('@')[0],
          lastName: '',
          phone: '',
          address: '',
          avatar: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: this.isBootstrapAdminEmail(fbUser.email) ? 'admin' : 'member',
          banned: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          provider: fbUser.providerData[0]?.providerId || 'password'
        };

        // Para localDB: converter serverTimestamp para ISO string
        const profileForLocal = {
          ...profileForFirestore,
          createdAt: new Date().toISOString()
        };

        try {
          // Se for o e-mail bootstrap, grava perfil admin + marcador de uso
          // único na mesma operação; senão cria perfil de membro comum.
          profile = await this.createProfileDoc(docRef, profileForFirestore, profileForLocal, fbUser);
          console.log('Perfil criado no Firestore');
        } catch(setErr) {
          console.warn('Erro ao criar perfil no Firestore (pode ser regra):', setErr.code, setErr.message);
          // Mesmo com erro no Firestore, continuar com perfil local
          // O isNotBanned corrigido nas regras vai permitir depois
        }

        profile = profile || profileForLocal;
        docExists = true;

        // Salvar local
        try {
          const data = core.getLocalDB();
          // Evitar duplicado
          if (!data.users.find(u => u.id === fbUser.uid)) {
            data.users.push({ id: fbUser.uid, uid: fbUser.uid, ...profile });
            core.saveLocalDB(data);
          }
        } catch(localErr) {
          console.warn('Erro ao salvar usuário local:', localErr);
        }
      }

      if (profile && profile.banned) {
        try { await auth.signOut(); } catch(e) {}
        this.showError('loginError', 'Sua conta foi suspensa. Contate o administrador.');
        return;
      }

    } catch (err) {
      console.error('loginSuccess getDoc erro (mas continuando):', err);
      // Fallback: se erro de permissão, criar perfil mínimo local para não travar
      if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
        profile = {
          username: (fbUser.email?.split('@')[0] || 'user'),
          email: fbUser.email || '',
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuário',
          lastName: '', phone: '', address: '',
          avatar: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: 'member',
          banned: false,
          createdAt: new Date().toISOString(),
          provider: fbUser.providerData[0]?.providerId || 'google.com'
        };
        core.toast('Login feito, mas perfil no Firestore sem permissão. Verifique firestore.rules', 'warning');
      } else {
        // Outro erro - mostrar e não travar
        core.toast('Erro ao carregar perfil: ' + err.message, 'error');
        // ainda assim criar perfil básico para não travar página
        profile = profile || {
          username: fbUser.email?.split('@')[0] || 'user',
          email: fbUser.email || '',
          name: fbUser.displayName || 'Usuário',
          role: 'member', banned: false,
          avatar: fbUser.photoURL || '', avatarType: 'emoji',
          provider: 'google.com'
        };
      }
    }

    // O endereço configurado como administrador inicial reivindica o cargo
    // através do claim de USO ÚNICO (batch perfil + marcador settings/bootstrap).
    profile = await this.claimBootstrapAdmin(fbUser, profile);

    // Garantir profile
    if (!profile) {
      console.error('Profile nulo após tentativas');
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
      avatar: profile.avatar || fbUser.photoURL || '',
      avatarType: profile.avatarType || (fbUser.photoURL ? 'google' : 'emoji'),
      role: profile.role || 'member',
      provider: profile.provider || 'password'
    };

    core.setCurrentUser(this.currentUser);
    if (remember) core.setRememberedUser(this.currentUser);

    try { core.getUserStats(this.currentUser.id); } catch(e) {}
    try { core.log('login', this.currentUser.id, 'Login Firebase'); } catch(e) {}

    this.showApp();
    // O listener de Auth também pode chegar aqui; FireSync.start é idempotente
    // para o UID e não cria listeners duplicados.
    setTimeout(() => {
      const uid = this.currentUser?.uid || this.currentUser?.id;
      if (uid && auth.currentUser?.uid === uid) fireSync.start(uid);
    }, 500);
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

    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: username });

      const profileFS = {
        username, email,
        name: username, lastName: '', phone: '', address: '',
        avatar: '', avatarType: 'emoji',
        role: this.isBootstrapAdminEmail(email) ? 'admin' : 'member', banned: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: 'password'
      };
      const profileLocal = { ...profileFS, createdAt: new Date().toISOString() };

      let savedProfile = profileLocal;
      try {
        // Perfil bootstrap admin + marcador de uso único na mesma operação;
        // se o claim já foi consumido, a conta nasce como membro.
        savedProfile = await this.createProfileDoc(
          db.collection('users').doc(cred.user.uid), profileFS, profileLocal, cred.user
        );
      } catch(setErr) {
        console.warn('Erro ao criar user no Firestore:', setErr);
      }

      data.users.push({ id: cred.user.uid, uid: cred.user.uid, ...savedProfile, passHash: await core.hashPassword(password) });
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
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  async loginGoogle() {
    const btn = document.querySelector('.btn-google');
    const origContent = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Aguarde...'; }

    try {
      console.log('Iniciando login Google...');
      const result = await auth.signInWithPopup(googleProvider);
      console.log('Popup OK', result.user.uid);
      await this.loginSuccess(result.user, true);
    } catch (err) {
      console.error('loginGoogle erro:', err);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        // Silencioso
        core.toast('Login cancelado', 'info');
      } else if (err.code === 'auth/popup-blocked') {
        core.toast('Popup bloqueado pelo navegador. Permita popups para este site.', 'error');
      } else if (err.code === 'auth/unauthorized-domain') {
        core.toast('Domínio não autorizado no Firebase. Adicione o domínio em Authentication > Authorized domains', 'error');
      } else if (err.code === 'auth/operation-not-allowed') {
        core.toast('Login Google não habilitado no Console Firebase > Authentication > Sign-in method', 'error');
      } else {
        core.toast('Erro ao fazer login com Google: ' + (err.message || err.code), 'error');
      }
      // Garantir que tela de login continue visível e não trave
      this.showLogin();
      document.getElementById('loadingScreen')?.classList.add('hidden');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origContent; }
    }
  },

  async syncFirebaseUser(fbUser) {
    if (!fbUser || !fbUser.uid) return;
    try {
      console.log('syncFirebaseUser', fbUser.uid);
      const doc = await db.collection('users').doc(fbUser.uid).get();
      if (doc.exists) {
        let profile = doc.data();
        profile = await this.claimBootstrapAdmin(fbUser, profile);
        if (!profile.banned) {
          this.currentUser = {
            id: fbUser.uid, uid: fbUser.uid,
            username: profile.username || fbUser.email?.split('@')[0],
            email: profile.email || fbUser.email,
            name: profile.name || fbUser.displayName || profile.username,
            lastName: profile.lastName || '',
            phone: profile.phone || '',
            address: profile.address || '',
            avatar: profile.avatar || fbUser.photoURL || '',
            avatarType: profile.avatarType || 'emoji',
            role: profile.role || 'member',
            provider: profile.provider || 'google.com'
          };
          core.setCurrentUser(this.currentUser);
          try { core.getUserStats(this.currentUser.id); } catch(e) {}
          this.showApp();
          // Sync já será iniciado pelo onAuthStateChanged ou init
        } else {
          try { await auth.signOut(); } catch(e) {}
          this.showError('loginError', 'Conta suspensa');
          this.showLogin();
        }
      } else {
        // Doc não existe, mas auth existe: criar perfil
        console.log('Usuário Firebase sem doc, criando...');
        await this.loginSuccess(fbUser, true);
      }
    } catch (err) {
      console.warn('syncFirebaseUser erro (não crítico):', err.code, err.message);
      // Não travar - se permission-denied, ainda mostrar login para tentar novamente
      if (err.code === 'permission-denied') {
        core.toast('Sem permissão para ler perfil Firestore. Verifique firestore.rules', 'warning');
        // Criar usuário local mínimo para não travar
        this.currentUser = {
          id: fbUser.uid, uid: fbUser.uid,
          username: fbUser.email?.split('@')[0] || 'user',
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email?.split('@')[0],
          avatar: fbUser.photoURL || '',
          avatarType: fbUser.photoURL ? 'google' : 'emoji',
          role: 'member',
          provider: 'google.com'
        };
        core.setCurrentUser(this.currentUser);
        this.showApp();
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
    // Limpar cache de sync
    core.toast('Você saiu da sua conta', 'info');
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

    this.closeSidebar();
    try { history.replaceState({}, '', '#' + page); } catch(e) {}
  },

  /* ========== SIDEBAR ========== */
  closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  },
  toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('open');
  },

  renderSidebar() {
    const nav = document.getElementById('sidebarNav');
    if (!nav || !this.settings?.menuItems) return;
    const items = this.settings.menuItems;
    const order = this.settings.menuOrder || items.map(i => i.id);

    let html = '<div class="nav-section"><div class="nav-section-title">Menu</div>';

    order.forEach(id => {
      const item = items.find(i => i.id === id);
      if (!item || !item.visible) return;
      if (item.adminOnly && this.currentUser?.role !== 'admin') return;

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

    const brandEl = document.getElementById('sidebarBrand');
    if (brandEl) brandEl.textContent = this.settings.brand;
    document.title = this.settings.brand || 'Checklist ML';

    if (this.settings.logo) {
      const logoEl = document.getElementById('sidebarLogo');
      if (logoEl) logoEl.src = this.settings.logo;
    }
    if (this.settings.favicon) {
      const fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = this.settings.favicon;
    }
  },

  getBadge(pageId) {
    if (pageId !== 'atividades') return '';
    try {
      const data = core.getLocalDB();
      const today = core.today();
      const late = data.tasks.filter(t => t.date && t.date < today && t.status !== 'finished' && t.status !== 'notdone');
      return late.length > 0 ? late.length : '';
    } catch { return ''; }
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
      sRole.title = `Cargo: ${label}`;
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

  /* ========== TEMA ========== */
  applyTheme(theme, mode) {
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
    this.applyTheme(this.settings.theme, newMode);
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

  setTheme(theme) {
    if (!this.settings) return;
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

  /* ========== KEYBOARD SHORTCUTS ========== */
  setupKeyboardShortcuts() {
    let gKeyPressed = false;
    let gKeyTimeout = null;

    document.addEventListener('keydown', (e) => {
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

  handleMessage(e) {
    // Aceite somente mensagens da página atualmente carregada no iframe. Isso
    // também impede que uma mensagem enviada para a própria janela recrie toast.
    const frameWindow = document.getElementById('pageFrame')?.contentWindow;
    if (e.origin !== window.location.origin || !frameWindow || e.source !== frameWindow) return;

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
          fireSync.pushDocument(msg.collection, msg.id, msg.data);
        }
        break;
      case 'firebaseDelete':
        if (msg.collection && msg.id !== undefined) fireSync.deleteDocument(msg.collection, msg.id);
        break;
      case 'firebaseSettings':
        if (msg.settings) fireSync.pushSettings(msg.settings);
        break;
    }
  },

  showModal(html) {
    const container = document.getElementById('modalContainer');
    if (!container) return;
    container.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">${html}</div>
    </div>`;
  },

  closeModal() {
    const c = document.getElementById('modalContainer');
    if (c) c.innerHTML = '';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
// Fallback: se DOM já carregado
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  setTimeout(() => App.init(), 100);
}

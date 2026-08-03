/* =========================================================
   CHECKLIST ML — firebase.js  (CORRIGIDO última atualização)
   Firebase SDK via CDN — Auth + Firestore + Storage + Sync
   FIX: trava no login Google + regras Realtime vs Firestore

   ARQUITETURA DE DADOS (nuvem primeiro):
   • O Firestore é a fonte da verdade. Toda escrita passa por aqui
     (write-through) e toda leitura puxa do banco (snapshot + pull inicial).
   • localStorage virou APENAS cache de leitura (carregar rápido / offline
     visual) — nunca mais é o único lugar onde um dado existe.
   • Escritas com falha transitória entram numa fila (outbox) e são
     reenviadas sozinhas até dar certo (ou a regra negar).
   • Chaves/segredos da IA NÃO ficam mais em localStorage (persistente):
     apenas sessionStorage (por aba) + Firestore (settings/admin).
   ========================================================= */

// Firebase config (fornecida pelo usuário)
const firebaseConfig = {
  apiKey: "AIzaSyAfc3ZwPacSLU2zci5IOpv1hDB1Ln1pq-U",
  authDomain: "checklist-3e70c.firebaseapp.com",
  databaseURL: "https://checklist-3e70c-default-rtdb.firebaseio.com/",
  projectId: "checklist-3e70c",
  storageBucket: "checklist-3e70c.firebasestorage.app",
  messagingSenderId: "1003296881614",
  appId: "1:1003296881614:web:14f7438b38267f3698c99f"
};

// ============================================================
// reCAPTCHA Enterprise — Ativação conforme solicitação do usuário
// Site Key: 6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO
// Head: <script src="https://www.google.com/recaptcha/enterprise.js?render=SITE_KEY"></script>
// Uso: grecaptcha.enterprise.ready + execute(action: LOGIN, REGISTER, FORGOT_PASSWORD etc)
// Backend Java example fornecido cria Assessment via RecaptchaEnterpriseServiceClient
// ============================================================
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO';
const RECAPTCHA_PROJECT_ID = 'checklist-3e70c';

// Inicializar Firebase
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
} catch(e) {
  console.warn('Firebase já inicializado ou erro:', e);
}

// Serviços
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
// Fix: evitar prompt infinito em alguns navegadores
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ------------------------------------------------------------
// Firebase App Check com reCAPTCHA Enterprise Provider
// Isso garante que TODAS as chamadas ao Firebase (Auth, Firestore)
// sejam protegidas por reCAPTCHA Enterprise, com token renovado
// automaticamente. É a integração oficial Firebase + reCAPTCHA Enterprise.
// ------------------------------------------------------------
let appCheckInstance = null;
try {
  if (firebase.appCheck) {
    const appCheck = firebase.appCheck();
    // ReCaptchaEnterpriseProvider usa a mesma Site Key
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      true // isTokenAutoRefreshEnabled = true
    );
    appCheckInstance = appCheck;
    console.log('✅ Firebase App Check ativado com reCAPTCHA Enterprise:', RECAPTCHA_ENTERPRISE_SITE_KEY);

    // DEBUG token opcional em dev: self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try { self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; } catch(e) {}
    }
  } else {
    console.warn('⚠️ firebase.appCheck() não disponível - verifique se carregou firebase-app-check-compat.js');
  }
} catch (e) {
  console.warn('⚠️ App Check activation error (continuando sem App Check):', e);
}

// ------------------------------------------------------------
// Helper global: obter token reCAPTCHA Enterprise para uma ação
// Exemplo uso: const token = await getRecaptchaToken('LOGIN');
// O token deve ser enviado ao backend Java para criar Assessment:
//
// Event event = Event.newBuilder().setSiteKey(recaptchaKey).setToken(token).build();
// CreateAssessmentRequest request = CreateAssessmentRequest.newBuilder()
//   .setParent(ProjectName.of(projectID).toString())
//   .setAssessment(Assessment.newBuilder().setEvent(event).build()).build();
// Assessment response = client.createAssessment(request);
// ------------------------------------------------------------
async function getRecaptchaToken(action = 'LOGIN') {
  const siteKey = RECAPTCHA_ENTERPRISE_SITE_KEY;
  return new Promise((resolve) => {
    try {
      if (!window.grecaptcha || !window.grecaptcha.enterprise) {
        console.warn('⚠️ grecaptcha.enterprise não carregado ainda');
        resolve(null);
        return;
      }
      window.grecaptcha.enterprise.ready(async () => {
        try {
          const token = await window.grecaptcha.enterprise.execute(siteKey, { action: action });
          console.log(`🔐 reCAPTCHA Enterprise token gerado para ação ${action}:`, token ? token.slice(0, 20) + '...' : 'null');
          // Opcional: enviar token para log/auditoria no Firestore (sem bloquear)
          try {
            if (auth.currentUser && token) {
              // Log leve de uso do reCAPTCHA (não contém score, apenas que foi gerado)
              db.collection('recaptcha_logs').add({
                uid: auth.currentUser.uid,
                action: action,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                tokenPreview: token.slice(0, 15)
              }).catch(()=>{});
            }
          } catch(e) {}
          resolve(token);
        } catch (err) {
          console.warn('❌ Erro ao executar grecaptcha.enterprise.execute:', err);
          resolve(null);
        }
      });
    } catch (err) {
      console.warn('❌ getRecaptchaToken erro:', err);
      resolve(null);
    }
  });
}

// Wrapper legado para compatibilidade com código que chamava onClick(e)
async function onRecaptchaClick(e, action = 'LOGIN') {
  if (e && e.preventDefault) e.preventDefault();
  const token = await getRecaptchaToken(action);
  return token;
}

// Expor globalmente para App.js
window.getRecaptchaToken = getRecaptchaToken;
window.onRecaptchaClick = onRecaptchaClick;
window.RECAPTCHA_SITE_KEY = RECAPTCHA_ENTERPRISE_SITE_KEY;

// Habilitar persistência offline com tratamento robusto
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence: múltiplas abas abertas - usando memória');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence: navegador não suporta');
  } else {
    console.warn('Persistence erro:', err);
  }
});

// ============================================================
// MIGRAÇÃO DE SEGURANÇA (nuvem primeiro):
// Chaves da IA e preferências de conexão NÃO podem mais viver em
// localStorage (persistente entre sessões). Elas ficam somente em
// sessionStorage (por aba) + Firestore (settings/admin). Qualquer
// resíduo antigo é removido aqui no carregamento.
// ============================================================
['cl-admin-deepseek-key', 'cl-admin-groq-key', 'cl-admin-ai-provider',
 'cl-admin-ai-mode', 'cl-admin-ai-proxy'].forEach(key => {
  try { localStorage.removeItem(key); } catch (e) {}
});

/* Helpers seguros de storage (nunca quebram em modo privado) */
function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}
function safeLocalRemove(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}
function safeSessionGet(key) {
  try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function safeSessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch (e) {}
}
function safeSessionRemove(key) {
  try { sessionStorage.removeItem(key); } catch (e) {}
}

function operationalNow() {
  try {
    if (typeof core !== 'undefined' && core.now) return core.now();
    const tz = 'America/Sao_Paulo';
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(dtf.formatToParts(new Date())
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000-03:00`;
  } catch(e) {
    return new Date().toISOString();
  }
}

/* ========== HELPER: converter datas com segurança ========== */
function safeFirestoreTimestamp(value) {
  if (!value) return null;
  if (value instanceof firebase.firestore.Timestamp) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return firebase.firestore.Timestamp.fromDate(d);
  }
  if (value instanceof Date) return firebase.firestore.Timestamp.fromDate(value);
  return null;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value.toDate) return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/* ========== FIREBASE SYNC ========== */
const FireSync = {
  _unsubscribers: [],
  _syncing: false,
  _userId: null,
  // Erros agora são contados POR COLEÇÃO: uma coleção sem permissão não pode
  // mais bloquear o envio das outras (isso fazia atividades ficarem só locais).
  _collectionErrors: {},
  _maxCollectionErrors: 5,
  // Fila de reescrita (outbox): escritas com falha transitória (offline/rede)
  // são reenviadas sozinhas até darem certo — nada fica só no cache local.
  // v18: a fila também é persistida localmente até a nuvem confirmar. Assim,
  // se o APK/WebView fechar offline, os dados voltam a subir ao reabrir.
  _outbox: [],
  _outboxFlushing: false,
  _outboxTimer: null,
  _outboxKey: 'cl-firesync-outbox-v18',

  /* Iniciar sincronização para um usuário */
  async start(userId) {
    // onAuthStateChanged, loginSuccess e a restauração de sessão podem solicitar
    // o sync quase ao mesmo tempo. Recriar listeners para o mesmo UID duplicava
    // snapshots e operações de escrita.
    if (this._syncing && this._userId === userId) {
      console.log('ℹ️ FireSync já está ativo para:', userId);
      return;
    }

    this.stop();
    this._userId = userId;
    this._collectionErrors = {};
    this._loadOutbox();

    console.log('🔄 FireSync iniciado para:', userId);

    // Se não há userId (usuário local), pular
    if (!userId || userId.includes('local-') || userId === 'unknown') {
      console.log('⚠️ Usuário local, FireSync não ativado');
      return;
    }

    // Não sincronize dados de um perfil local usando a sessão Firebase de outra
    // pessoa. Isso evita falhas de permissão e mistura de contas.
    if (!auth.currentUser || auth.currentUser.uid !== userId) {
      console.warn('⚠️ Auth ainda não corresponde ao usuário do FireSync; aguardando...');
      this._syncing = false;
      this._userId = null;
      setTimeout(() => {
        if (auth.currentUser?.uid === userId && !this._syncing) this.start(userId);
      }, 500);
      return;
    }

    this._syncing = true;

    try {
      // 1. Sincronizar tasks - APENAS do usuário
      const tasksUnsub = db.collection('tasks')
        .where('owner', '==', userId)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('tasks', snapshot, userId);
        }, err => {
          console.warn('Tasks sync error:', err.code, err.message);
          this._handleSyncError(err, 'tasks');
        });
      this._unsubscribers.push(tasksUnsub);

      // Administradores precisam ver perfis atuais para que o painel de usuários
      // consiga realmente editar cargos e bloqueios no Firestore.
      if (this._isCurrentUserAdmin()) {
        const usersUnsub = db.collection('users')
          .limit(500)
          .onSnapshot(snapshot => {
            if (!this._syncing) return;
            this._handleCollectionSync('users', snapshot, null);
          }, err => {
            console.warn('Users sync error:', err.code, err.message);
            this._handleSyncError(err, 'users', false);
          });
        this._unsubscribers.push(usersUnsub);
      }

      // 2. Sincronizar posts (todos os posts) - com try/catch para não travar se sem permissão
      const postsUnsub = db.collection('posts')
        .orderBy('publishedAt', 'desc')
        .limit(50) // limite para não travar
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('posts', snapshot, null);
        }, err => {
          console.warn('Posts sync error:', err.code, err.message);
          // Não crítico - posts pode estar vazio ou sem permissão
          this._handleSyncError(err, 'posts', false);
        });
      this._unsubscribers.push(postsUnsub);

      // 3. Sincronizar files
      const filesUnsub = db.collection('files')
        .limit(100)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('files', snapshot, null);
        }, err => {
          console.warn('Files sync error:', err.code, err.message);
          this._handleSyncError(err, 'files', false);
        });
      this._unsubscribers.push(filesUnsub);

      // 3b. Sincronizar macros (modelos de mensagem do próprio usuário)
      const macrosUnsub = db.collection('macros')
        .where('owner', '==', userId)
        .limit(200)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('macros', snapshot, userId);
        }, err => {
          console.warn('Macros sync error:', err.code, err.message);
          this._handleSyncError(err, 'macros', false);
        });
      this._unsubscribers.push(macrosUnsub);

      // 3c. Sincronizar notas/recadinhos do próprio usuário
      const notesUnsub = db.collection('notes')
        .where('owner', '==', userId)
        .limit(300)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('notes', snapshot, userId);
        }, err => {
          console.warn('Notes sync error:', err.code, err.message);
          this._handleSyncError(err, 'notes', false);
        });
      this._unsubscribers.push(notesUnsub);

      // 3d. Sincronizar gamificação do próprio usuário
      const gamUnsub = db.collection('gamification')
        .doc(userId)
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
          const remoteGam = doc.data();
          const data = core.getLocalDB();
          if (JSON.stringify(data.gamification[userId]) !== JSON.stringify(remoteGam)) {
            data.gamification[userId] = remoteGam;
            core.saveLocalDB(data);
            window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'gamification' } }));
            console.log('🏆 Gamificação sincronizada do Firestore');
          }
        }, err => {
          console.warn('Gamification sync error:', err.code, err.message);
        });
      this._unsubscribers.push(gamUnsub);

      // 3e. Sincronizar comentários (flat collection)
      const commentsUnsub = db.collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('comments', snapshot, userId);
        }, err => {
          console.warn('Comments sync error:', err.code, err.message);
        });
      this._unsubscribers.push(commentsUnsub);

      // 3f. Sincronizar automações
      const autoUnsub = db.collection('automations')
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('automations', snapshot, null);
        }, err => {
          console.warn('Automations sync error:', err.code, err.message);
        });
      this._unsubscribers.push(autoUnsub);

      // 3g. Sincronizar dashboardWidgets do usuário
      const widgetsUnsub = db.collection('dashboardWidgets')
        .doc(userId)
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
          const remoteWidgets = doc.data()?.widgets;
          if (!remoteWidgets) return;
          const data = core.getLocalDB();
          if (JSON.stringify(data.dashboardWidgets) !== JSON.stringify(remoteWidgets)) {
            data.dashboardWidgets = remoteWidgets;
            core.saveLocalDB(data);
            window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'dashboardWidgets' } }));
            console.log('📊 DashboardWidgets sincronizados do Firestore');
          }
        }, err => {
          console.warn('DashboardWidgets sync error:', err.code, err.message);
        });
      this._unsubscribers.push(widgetsUnsub);

      // 3h. Sincronizar temas customizados
      const themesUnsub = db.collection('customThemes')
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('customThemes', snapshot, null);
        }, err => {
          console.warn('CustomThemes sync error:', err.code, err.message);
        });
      this._unsubscribers.push(themesUnsub);

      // 4. Sincronizar settings (só leitura - escrita só admin)
      const settingsUnsub = db.collection('settings')
        .doc('global')
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
          try {
            const remoteSettings = doc.data();
            const data = core.getLocalDB();
            let changed = false;

            // Apenas configurações públicas do site ficam neste documento.
            // Credenciais de integrações são gravadas separadamente em settings/admin.
            // ATENÇÃO: 'theme' e 'mode' NÃO entram aqui — eles são preferências
            // POR USUÁRIO (cada um escolhe o seu). O documento global carrega o
            // tema do admin apenas como PADRÃO para quem nunca escolheu.
            const publicKeys = ['brand', 'language', 'categories',
              'notesCategories', 'menuItems', 'menuOrder', 'logo', 'favicon'];
            publicKeys.forEach(key => {
              if (!Object.prototype.hasOwnProperty.call(remoteSettings, key)) return;
              const localValue = JSON.stringify(data.settings[key]);
              const remoteValue = JSON.stringify(remoteSettings[key]);
              if (localValue !== remoteValue) {
                data.settings[key] = remoteSettings[key];
                changed = true;
              }
            });

            // Tema/modo do admin viram apenas o PADRÃO (defaultTheme/defaultMode).
            // Nunca sobrescrevem a escolha pessoal de cada usuário — isso corrige
            // o bug em que, após um tempo, o tema travava no tema do admin.
            [['theme', 'defaultTheme'], ['mode', 'defaultMode']].forEach(([src, dst]) => {
              if (!Object.prototype.hasOwnProperty.call(remoteSettings, src)) return;
              if (data.settings[dst] !== remoteSettings[src]) {
                data.settings[dst] = remoteSettings[src];
                changed = true;
              }
            });

            if (changed) {
              core.saveLocalDB(data);
              window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'settings' } }));
              console.log('🔄 Settings sincronizados do Firestore');
            }
          } catch(e) {
            console.warn('Settings sync parse error:', e);
          }
        }, err => {
          console.warn('Settings sync error:', err.code, err.message);
          this._handleSyncError(err, 'settings', false);
        });
      this._unsubscribers.push(settingsUnsub);

      // 5. Preferências/estado por usuário sincronizados da nuvem:
      //    notificações, histórico/memória da IA e configuração do Pomodoro vivem em
      //    settings/{section}/user/{uid} no Firestore (regras: só o dono lê/escreve).
      ['notifications', 'ai', 'pomodoro'].forEach(section => {
        const unsub = db.collection('settings').doc(section).collection('user').doc(userId)
          .onSnapshot(doc => {
            if (!this._syncing) return;
            if (doc.exists) this._applyUserPrefSnapshot(section, userId, doc.data());
          }, err => {
            console.warn(section + ' prefs sync error:', err.code || err.message);
          });
        this._unsubscribers.push(unsub);
      });

      // 6. Pull inicial do servidor: garante que um dispositivo com cache vazio
      //    receba TODOS os dados do usuário mesmo antes do primeiro evento de
      //    snapshot (e que dados locais ainda não enviados subam para a nuvem).
      this._pullUserData(userId).catch(err => {
        console.warn('Pull inicial falhou (snapshots seguem ativos):', err.code || err.message);
      });

      // 7. Envia qualquer escrita pendente de sessões anteriores (outbox).
      this._flushOutbox();

    } catch (err) {
      console.error('Erro ao iniciar FireSync:', err);
      this._syncing = false;
    }
  },

  _isCurrentUserAdmin() {
    const currentUser = core.getCurrentUser();
    if (currentUser?.role === 'admin') return true;
    // O e-mail bootstrap só é elevado neste fallback enquanto o claim de uso
    // único não foi consumido. Depois do claim, vale apenas o role gravado
    // no Firestore (sem re-promoção local infinita).
    const isBootstrap = account =>
      String(account?.email || '').trim().toLowerCase() === 'wesleystudio@gmail.com';
    let pendingClaim = false;
    try { pendingClaim = !localStorage.getItem('cl-bootstrap-local-claimed'); } catch(e) {}
    if (isBootstrap(currentUser) && pendingClaim) return true;
    const data = core.getLocalDB();
    const localUser = data.users
      .find(account => account.id === currentUser?.id || account.uid === currentUser?.uid);
    if (localUser?.role === 'admin') return true;
    if (isBootstrap(localUser) && pendingClaim) {
      // Auto-promover e salvar (somente pré-claim)
      localUser.role = 'admin';
      core.saveLocalDB(data);
      // Atualizar sessão
      const sessionUser = { ...currentUser, role: 'admin' };
      core.setCurrentUser(sessionUser);
      return true;
    }
    return false;
  },

  _handleSyncError(err, collection, critical = true) {
    // Erros agora são por coleção: uma coleção sem permissão não pode parar o
    // sync das outras (isso fazia atividades ficarem presas só no localStorage).
    const count = (this._collectionErrors[collection] || 0) + 1;
    this._collectionErrors[collection] = count;
    if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
      console.warn(`⚠️ Sem permissão para ${collection}. Verifique firestore.rules`);
      if (critical && count >= this._maxCollectionErrors) {
        console.warn(`🛑 Muitos erros de permissão em ${collection} — leitura desta coleção desativada (as demais continuam).`);
        if (typeof core !== 'undefined' && core.toast) {
          core.toast(`Sem permissão para sincronizar ${collection}. Verifique as regras do Firestore.`, 'warning');
        }
      }
      return;
    }
    // Outros erros: apenas log
  },

  _canPush(collection) {
    return (this._collectionErrors[collection] || 0) < this._maxCollectionErrors;
  },

  _loadOutbox() {
    try {
      const raw = safeLocalGet(this._outboxKey);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) this._outbox = list.slice(0, 1000);
    } catch(e) {
      this._outbox = [];
    }
  },

  _saveOutbox() {
    try {
      if (this._outbox.length) safeLocalSet(this._outboxKey, JSON.stringify(this._outbox.slice(0, 1000)));
      else safeLocalRemove(this._outboxKey);
    } catch(e) {}
  },

  _sanitizeOutboxData(collection, data) {
    const copy = data && typeof data === 'object' ? { ...data } : data;
    // Senhas/hashes do fallback local nunca devem ir para uma fila persistente.
    if (collection === 'users' && copy && typeof copy === 'object') {
      delete copy.pass;
      delete copy.passHash;
    }
    return copy;
  },


  _removeQueuedWrite(collection, id) {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(w =>
      w._pref || w._delete || w.collection !== collection || String(w.id) !== String(id)
    );
    if (this._outbox.length !== before) this._saveOutbox();
  },

  _removeQueuedPref(section, userId) {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(w => !(w._pref && w.section === section && w.userId === userId));
    if (this._outbox.length !== before) this._saveOutbox();
  },


  _enqueuePref(section, userId, data) {
    const existing = this._outbox.find(w => w._pref && w.section === section && w.userId === userId);
    const prefWrite = { _pref: true, section, userId, data, queuedAt: operationalNow() };
    if (existing) Object.assign(existing, prefWrite);
    else this._outbox.push(prefWrite);
    if (this._outbox.length > 1000) this._outbox.shift();
    this._saveOutbox();
    this._scheduleOutboxFlush();
  },

  _removeQueuedDelete(collection, id) {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(w => !(w._delete && w.collection === collection && String(w.id) === String(id)));
    if (this._outbox.length !== before) this._saveOutbox();
  },

  _clearError(collection) {
    if (this._collectionErrors[collection]) delete this._collectionErrors[collection];
  },

  /* Para todos os listeners */
  stop() {
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch(e) {}
    });
    this._unsubscribers = [];
    this._syncing = false;
    this._userId = null;
    this._collectionErrors = {};
    console.log('🛑 FireSync parado');
  },

  /* Sincronizar uma coleção inteira */
  _handleCollectionSync(collectionName, snapshot, userId) {
    try {
      const data = core.getLocalDB();
      const remoteDocs = [];
      let hasChanges = false;

      snapshot.forEach(doc => {
        const remoteData = doc.data();
        // Converter Timestamps para string ISO para compat com localDB
        const normalized = { ...remoteData };
        if (normalized.createdAt && normalized.createdAt.toDate) {
          normalized.createdAt = normalized.createdAt.toDate().toISOString();
        }
        if (normalized.updatedAt && normalized.updatedAt.toDate) {
          normalized.updatedAt = normalized.updatedAt.toDate().toISOString();
        }
        if (normalized.publishedAt && normalized.publishedAt.toDate) {
          normalized.publishedAt = normalized.publishedAt.toDate().toISOString();
        }
        if (normalized.finishedAt && normalized.finishedAt.toDate) {
          normalized.finishedAt = normalized.finishedAt.toDate().toISOString();
        }
        // Normalizar date de tarefas para YYYY-MM-DD (evita duplicação por comparação falha)
        if (normalized.date && normalized.date.toDate) {
          normalized.date = core.dateKeyFromLocalDate(normalized.date.toDate());
        } else if (normalized.date instanceof Date) {
          normalized.date = core.dateKeyFromLocalDate(normalized.date);
        }
        remoteDocs.push({ id: doc.id, ...normalized });
      });

      // onSnapshot não devolve documentos removidos no snapshot atual. Sem
      // tratar docChanges, um post/arquivo apagado voltava a aparecer no cache
      // local após a próxima navegação.
      const removedIds = typeof snapshot.docChanges === 'function'
        ? snapshot.docChanges().filter(change => change.type === 'removed').map(change => String(change.doc.id))
        : [];
      if (removedIds.length) {
        const removeById = list => list.filter(item => !removedIds.includes(String(item.id)));
        if (collectionName === 'tasks') data.tasks = removeById(data.tasks);
        if (collectionName === 'notes') data.notes = removeById(data.notes);
        if (collectionName === 'posts') data.posts = removeById(data.posts);
        if (collectionName === 'files') data.files = removeById(data.files);
        if (collectionName === 'macros') data.macros = removeById(data.macros);
        if (collectionName === 'users') data.users = removeById(data.users);
        hasChanges = true;
      }

      // Para tasks: filtrar as que são do usuário local
      if (collectionName === 'tasks' && userId) {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        const localNewer = [];

        // Atualizar/inserir tasks remotas no local
        remoteDocs.forEach(remote => {
          const localIdx = data.tasks.findIndex(t => String(t.id) === String(remote.id));
          if (localIdx >= 0) {
            const localUpdated = timestampMillis(data.tasks[localIdx].updatedAt || data.tasks[localIdx].createdAt);
            const remoteUpdated = timestampMillis(remote.updatedAt || remote.createdAt);
            if (remoteUpdated > localUpdated) {
              data.tasks[localIdx] = { ...data.tasks[localIdx], ...remote, id: data.tasks[localIdx].id };
              hasChanges = true;
            } else if (localUpdated > remoteUpdated) {
              // Local mais novo (editado offline): a versão local vence e
              // precisa SUBIR para a nuvem, senão o outro dispositivo nunca
              // veria a mudança.
              localNewer.push(data.tasks[localIdx]);
            }
          } else {
            data.tasks.push(remote);
            hasChanges = true;
          }
        });

        // Subir tasks locais que não estão no remoto — SEM limite de 20 docs:
        // tudo que foi criado/editado offline precisa chegar inteiro à nuvem.
        if (this._canPush('tasks')) {
          const localTasksToPush = data.tasks.filter(t =>
            t.owner === userId && !remoteIds.has(String(t.id))
          ).concat(localNewer);
          if (localTasksToPush.length > 0) {
            this._pushLocalToFirestore('tasks', localTasksToPush, userId);
          }
        }

      } else if (collectionName === 'users') {
        remoteDocs.forEach(remote => {
          const localIdx = data.users.findIndex(account =>
            String(account.id || account.uid) === String(remote.id)
          );
          const normalizedUser = { ...remote, id: remote.id, uid: remote.uid || remote.id };
          if (localIdx >= 0) {
            // Senhas locais nunca devem ser substituídas por dados remotos.
            const local = data.users[localIdx];
            const next = { ...local, ...normalizedUser, passHash: local.passHash, pass: local.pass };
            if (JSON.stringify({ ...local, passHash: undefined, pass: undefined }) !==
                JSON.stringify({ ...next, passHash: undefined, pass: undefined })) {
              data.users[localIdx] = next;
              hasChanges = true;
            }
          } else {
            data.users.push(normalizedUser);
            hasChanges = true;
          }
        });

      } else if (collectionName === 'posts') {
        remoteDocs.forEach(remote => {
          const localIdx = data.posts.findIndex(p => String(p.id) === String(remote.id));
          if (localIdx >= 0) {
            const rTime = timestampMillis(remote.updatedAt || remote.publishedAt);
            const lTime = timestampMillis(data.posts[localIdx].updatedAt || data.posts[localIdx].publishedAt);
            if (rTime > lTime) {
              data.posts[localIdx] = { ...data.posts[localIdx], ...remote, id: data.posts[localIdx].id };
              hasChanges = true;
            }
          } else {
            data.posts.push(remote);
            hasChanges = true;
          }
        });

      } else if (collectionName === 'files') {
        remoteDocs.forEach(remote => {
          const localIdx = data.files.findIndex(f => String(f.id) === String(remote.id));
          if (localIdx >= 0) {
            // Sempre atualizar files (admin pode mudar), sem disparar falso
            // positivo apenas porque IDs locais antigos são numéricos.
            const localComparable = { ...data.files[localIdx], id: String(data.files[localIdx].id) };
            const remoteComparable = { ...remote, id: String(remote.id) };
            if (JSON.stringify(localComparable) !== JSON.stringify(remoteComparable)) {
              data.files[localIdx] = { ...remote, id: data.files[localIdx].id };
              hasChanges = true;
            }
          } else {
            data.files.push(remote);
            hasChanges = true;
          }
        });

      } else if (collectionName === 'macros' && userId) {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        const localNewer = [];

        // Atualizar/inserir macros remotas no local
        remoteDocs.forEach(remote => {
          const localIdx = data.macros.findIndex(m => String(m.id) === String(remote.id));
          if (localIdx >= 0) {
            const lTime = timestampMillis(data.macros[localIdx].updatedAt || data.macros[localIdx].createdAt);
            const rTime = timestampMillis(remote.updatedAt || remote.createdAt);
            if (rTime > lTime) {
              data.macros[localIdx] = { ...data.macros[localIdx], ...remote, id: data.macros[localIdx].id };
              hasChanges = true;
            } else if (lTime > rTime) {
              // Editado offline: versão local vence e precisa subir à nuvem.
              localNewer.push(data.macros[localIdx]);
            }
          } else {
            data.macros.push(remote);
            hasChanges = true;
          }
        });

        // Subir macros locais do usuário que ainda não estão no remoto
        if (this._canPush('macros')) {
          const localMacrosToPush = data.macros.filter(m =>
            m.owner === userId && !remoteIds.has(String(m.id))
          ).concat(localNewer);
          if (localMacrosToPush.length > 0) {
            this._pushLocalToFirestore('macros', localMacrosToPush, userId);
          }
        }

      } else if (collectionName === 'notes' && userId) {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        const localNewer = [];

        // Atualizar/inserir notas remotas no cache local
        remoteDocs.forEach(remote => {
          const localIdx = data.notes.findIndex(n => String(n.id) === String(remote.id));
          if (localIdx >= 0) {
            const lTime = timestampMillis(data.notes[localIdx].updatedAt || data.notes[localIdx].createdAt);
            const rTime = timestampMillis(remote.updatedAt || remote.createdAt);
            if (rTime > lTime) {
              data.notes[localIdx] = { ...data.notes[localIdx], ...remote, id: data.notes[localIdx].id };
              hasChanges = true;
            } else if (lTime > rTime) {
              // Editado offline: versão local vence e precisa subir à nuvem.
              localNewer.push(data.notes[localIdx]);
            }
          } else {
            data.notes.push(remote);
            hasChanges = true;
          }
        });

        // Subir notas locais do usuário que ainda não estão no remoto
        if (this._canPush('notes')) {
          const localNotesToPush = data.notes.filter(n =>
            String(n.owner) === String(userId) && !remoteIds.has(String(n.id))
          ).concat(localNewer);
          if (localNotesToPush.length > 0) {
            this._pushLocalToFirestore('notes', localNotesToPush, userId);
          }
        }
      } else if (collectionName === 'comments') {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        if (!data.comments) data.comments = {};
        let changed = false;

        remoteDocs.forEach(remote => {
          const tid = remote.taskId;
          if (!tid) return;
          if (!data.comments[tid]) data.comments[tid] = [];
          const idx = data.comments[tid].findIndex(c => String(c.id) === String(remote.id));
          if (idx >= 0) {
            if (JSON.stringify(data.comments[tid][idx]) !== JSON.stringify(remote)) {
              data.comments[tid][idx] = remote;
              changed = true;
            }
          } else {
            data.comments[tid].push(remote);
            changed = true;
          }
        });

        // Removidos
        removedIds.forEach(rid => {
          Object.keys(data.comments).forEach(tid => {
            const initialLen = data.comments[tid].length;
            data.comments[tid] = data.comments[tid].filter(c => String(c.id) !== rid);
            if (data.comments[tid].length !== initialLen) changed = true;
          });
        });
        
        if (changed) {
          hasChanges = true;
          // Ordenar comentários por data
          Object.keys(data.comments).forEach(tid => {
            data.comments[tid].sort((a,b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
          });
        }
      } else if (collectionName === 'automations') {
        if (JSON.stringify(data.automations) !== JSON.stringify(remoteDocs)) {
          data.automations = remoteDocs;
          hasChanges = true;
        }
      } else if (collectionName === 'customThemes') {
        if (JSON.stringify(data.customThemes) !== JSON.stringify(remoteDocs)) {
          data.customThemes = remoteDocs;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        core.saveLocalDB(data);
        window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: collectionName } }));
        console.log(`🔄 ${collectionName} sincronizados do Firestore (${remoteDocs.length} docs)`);
      }
    } catch(e) {
      console.warn(`_handleCollectionSync ${collectionName} error:`, e);
    }
  },

  /* Push local data to Firestore - com proteção anti-loop */
  async _pushLocalToFirestore(collection, items, userId) {
    if (!items || items.length === 0) return;
    if (!this._canPush(collection)) {
      console.warn('⚠️ Muitos erros, pulando push para', collection);
      return;
    }

    // Sem limite de documentos: envia TUDO o que ficou pendente, em lotes de
    // até 20 (limite seguro do Firestore por batch). Antes o .slice(0,20)
    // deixava dados criados offline presos só no localStorage.
    for (let i = 0; i < items.length; i += 20) {
      const chunk = items.slice(i, i + 20);
      const batch = db.batch();
      let count = 0;

      for (const item of chunk) {
        try {
          const docRef = db.collection(collection).doc(String(item.id));
          const docData = { ...item };
          // Remover id duplicado e converter datas com segurança
          delete docData.id;

          // Garantir owner
          if (collection === 'tasks' || collection === 'macros') {
            docData.owner = userId;
          }

          // Converter createdAt/updatedAt para Timestamp APENAS para Firestore
          // Não modificar o objeto original
          const toSend = { ...docData };
          const createdTs = safeFirestoreTimestamp(docData.createdAt);
          const updatedTs = safeFirestoreTimestamp(docData.updatedAt);
          if (createdTs) toSend.createdAt = createdTs;
          if (updatedTs) toSend.updatedAt = updatedTs;
          if (!toSend.updatedAt) {
            toSend.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          }

          batch.set(docRef, toSend, { merge: true });
          count++;
        } catch(e) {
          console.warn('Erro ao preparar doc para push:', e);
        }
      }

      if (count > 0) {
        try {
          await batch.commit();
          console.log(`📤 ${count} ${collection} enviados ao Firestore`);
          this._clearError(collection);
        } catch (err) {
          console.warn(`Erro ao enviar ${collection}:`, err.code, err.message);
          if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
            this._bumpErrorSafe(collection);
          } else {
            // Falha transitória: agenda reenvio para não perder os dados.
            chunk.forEach(item => this._enqueueWrite(collection, item.id, item));
            this._scheduleOutboxFlush();
          }
        }
      }
    }
  },

  /* Push manual de um documento — com fila de reenvio (nada se perde) */
  async pushDocument(collection, id, dataObj) {
    // Validar que temos dados e usuário autenticado antes de tentar escrever
    if (!collection || !id || !dataObj) {
      console.warn('⚠️ pushDocument: parâmetros inválidos', { collection, id });
      return false;
    }
    
    if (!auth.currentUser) {
      console.warn('⚠️ pushDocument: usuário não autenticado, enfileirando para quando autenticar');
      this._enqueueWrite(collection, id, dataObj);
      return false;
    }
    
    try {
      console.log('📤 pushDocument → Firestore:', collection, id);
      await this._writeDoc(collection, id, dataObj);
      this._clearError(collection);
      this._removeQueuedWrite(collection, id);
      console.log('✅ pushDocument OK:', collection, id);
      return true;
    } catch (err) {
      console.error('❌ pushDocument ERRO:', collection, id, err.code, err.message);
      if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
        console.warn('⚠️ Sem permissão para escrever em', collection);
        this._bumpErrorSafe(collection);
        core.toast(`Sem permissão para sincronizar ${collection}. Verifique as regras.`, 'warning');
      }
      // Enfileira para reenvio automático (offline/rede instável).
      this._enqueueWrite(collection, id, dataObj);
      this._scheduleOutboxFlush();
      return false;
    }
  },

  /* Grava um documento no Firestore (conversões de Timestamp + limpeza) */
  async _writeDoc(collection, id, dataObj) {
    const docData = { ...dataObj };
    delete docData.id;
    // Hashes/senhas usadas no fallback local jamais devem ser enviados ao
    // Firestore nem aparecer em backups de perfis.
    if (collection === 'users') {
      delete docData.pass;
      delete docData.passHash;
    }

    const createdTs = safeFirestoreTimestamp(docData.createdAt);
    if (createdTs) docData.createdAt = createdTs;
    docData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection(collection).doc(String(id)).set(docData, { merge: true });
    console.log(`📤 ${collection}/${id} enviado ao Firestore`);
  },

  /* ---------- FILA DE REESCRITA (OUTBOX) ---------- */
  _enqueueWrite(collection, id, data) {
    const safeData = this._sanitizeOutboxData(collection, data);
    const existing = this._outbox.find(w =>
      !w._pref && !w._delete && w.collection === collection && String(w.id) === String(id)
    );
    if (existing) {
      // Mesma escrita de novo: versão mais recente vence.
      existing.data = safeData;
    } else {
      this._outbox.push({ collection, id, data: safeData, queuedAt: operationalNow() });
      if (this._outbox.length > 1000) this._outbox.shift();
    }
    this._saveOutbox();
  },

  _scheduleOutboxFlush(delay = 3000) {
    // Timer imediato quando o app está aberto + Background Sync quando o APK
    // estiver em segundo plano/offline. A outbox é persistente, então nada se
    // perde ao fechar antes de voltar a internet.
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg.sync) return reg.sync.register('firestore-outbox-sync');
          reg.active?.postMessage({ type: 'QUEUE_FIRESTORE_SYNC' });
        }).catch(() => {});
      }
    } catch(e) {}
    if (this._outboxTimer) return;
    this._outboxTimer = setTimeout(() => {
      this._outboxTimer = null;
      this._flushOutbox();
    }, delay);
  }, 

  /* Reenvia escritas pendentes até a nuvem confirmar. Escritas negadas pelas
     regras são descartadas (o dado continua no cache local); falhas
     transitórias são tentadas de novo mais tarde. */
  async _flushOutbox() {
    if (this._outboxFlushing || !this._outbox.length) return;
    if (!auth.currentUser) {
      this._scheduleOutboxFlush(5000);
      return;
    }
    this._outboxFlushing = true;
    const started = Date.now();
    try {
      while (this._outbox.length) {
        const item = this._outbox[0];
        try {
          if (item._pref) {
            await db.collection('settings').doc(item.section).collection('user').doc(item.userId)
              .set(item.data, { merge: true });
            console.log(`📤 (outbox) preferência ${item.section} enviada ao Firestore`);
          } else if (item._delete) {
            await db.collection(item.collection).doc(String(item.id)).delete();
            console.log(`🗑️ (outbox) ${item.collection}/${item.id} removido do Firestore`);
          } else {
            await this._writeDoc(item.collection, item.id, item.data);
          }
          this._clearError(item.collection || item.section);
          this._outbox.shift();
          this._saveOutbox();
        } catch (err) {
          if (err.code === 'unauthenticated') {
            // Auth ainda não restaurou: mantém a fila para tentar novamente.
            break;
          }
          if (err.code === 'permission-denied') {
            console.warn('Outbox: escrita sem permissão descartada:', item.collection || item.section, item.id || item.userId);
            this._bumpErrorSafe(item.collection || item.section);
            this._outbox.shift();
            this._saveOutbox();
          } else {
            // Erro transitório (offline): tenta de novo mais tarde.
            break;
          }
        }
        // Não segurar a interface por muito tempo em uma única rodada.
        if (Date.now() - started > 10000) break;
      }
    } finally {
      this._outboxFlushing = false;
      if (this._outbox.length) this._scheduleOutboxFlush(10000);
    }
  },

  _bumpErrorSafe(collection) {
    const count = (this._collectionErrors[collection] || 0) + 1;
    this._collectionErrors[collection] = count;
  },

  /* Push settings to Firestore - SÓ admin */
  async pushSettings(settings) {
    try {
      // Verificar se é admin antes de tentar
      const currentUser = core.getCurrentUser();
      const data = core.getLocalDB();
      const userProfile = data.users.find(u => u.id === currentUser?.id || u.id === currentUser?.uid);
      const isAdmin = currentUser?.role === 'admin' || userProfile?.role === 'admin';
      
      if (!isAdmin) {
        console.log('ℹ️ Settings push ignorado - usuário não é admin');
        return;
      }

      await db.collection('settings').doc('global').set({
        brand: settings.brand || 'Checklist ML',
        theme: settings.theme || 'ocean',
        mode: settings.mode || 'light',
        language: settings.language || 'pt-BR',
        categories: settings.categories || [],
        notesCategories: settings.notesCategories || [],
        menuItems: settings.menuItems || [],
        menuOrder: settings.menuOrder || [],
        logo: settings.logo || '',
        favicon: settings.favicon || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('📤 Settings enviados ao Firestore');
      return true;
    } catch (err) {
      console.warn('Erro ao enviar settings:', err.code, err.message);
      return false;
    }
  },

  async deleteDocument(collection, id) {
    if (!auth.currentUser) {
      this._outbox.push({ collection, id, _delete: true, queuedAt: operationalNow() });
      if (this._outbox.length > 1000) this._outbox.shift();
      this._saveOutbox();
      this._scheduleOutboxFlush();
      return false;
    }
    try {
      await db.collection(collection).doc(String(id)).delete();
      console.log(`🗑️ ${collection}/${id} removido do Firestore`);
      this._clearError(collection);
      this._removeQueuedDelete(collection, id);
      return true;
    } catch (err) {
      console.warn(`Erro ao remover ${collection}/${id}:`, err.code, err.message);
      if (err.code === 'permission-denied') {
        this._bumpErrorSafe(collection);
      } else {
        // Falha transitória/unauth temporário: enfileira a exclusão para reenvio automático.
        this._outbox.push({ collection, id, _delete: true, queuedAt: operationalNow() });
        if (this._outbox.length > 1000) this._outbox.shift();
        this._saveOutbox();
        this._scheduleOutboxFlush();
      }
      return false;
    }
  },

  /* ---------- PREFERÊNCIAS/DADOS POR USUÁRIO NA NUVEM ----------
     Notificações, histórico/memória da IA e configuração do Pomodoro ficam em
     settings/{section}/user/{uid} no Firestore (regras: só o dono lê e
     escreve). O localStorage é apenas cache de leitura. */
  async pushUserPref(section, userId, data) {
    if (!section || !userId || String(userId).includes('local-')) return false;
    if (!auth.currentUser) {
      this._enqueuePref(section, userId, data);
      return false;
    }
    try {
      await db.collection('settings').doc(section).collection('user').doc(userId)
        .set(data, { merge: true });
      this._removeQueuedPref(section, userId);
      return true;
    } catch (err) {
      console.warn('pushUserPref error:', section, err.code || err.message);
      if (err.code === 'unauthenticated') {
        this._enqueuePref(section, userId, data);
      } else if (err.code === 'permission-denied') {
        this._bumpErrorSafe(section);
      } else {
        // Falha transitória: enfileira com marcador de preferência de usuário.
        this._enqueuePref(section, userId, data);
      }
      return false;
    }
  },

  async getUserPref(section, userId, options = {}) {
    if (!section || !userId || String(userId).includes('local-')) return null;
    try {
      const doc = await db.collection('settings').doc(section).collection('user').doc(userId)
        .get(options);
      return doc.exists ? doc.data() : null;
    } catch (err) {
      console.warn('getUserPref error:', section, err.code || err.message);
      return null;
    }
  },

  /* Aplica um snapshot de preferência do usuário vindo da nuvem no cache
     local (localStorage) e avisa a interface para re-renderizar. */
  _applyUserPrefSnapshot(section, userId, pref) {
    try {
      if (section === 'notifications') {
        const key = 'cl-notifications-' + userId;
        const list = Array.isArray(pref.list) ? pref.list : [];
        const local = safeLocalGet(key);
        if (local !== JSON.stringify(list)) {
          safeLocalSet(key, JSON.stringify(list));
          window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'notifications' } }));
        }
      } else if (section === 'ai') {
        let changed = false;
        if (Array.isArray(pref.history)) {
          const key = 'cl-ai-history-' + userId;
          const json = JSON.stringify(pref.history);
          if (safeLocalGet(key) !== json) {
            safeLocalSet(key, json);
            // Migração: remove a chave antiga usada pela página IA em versões
            // anteriores para evitar dois históricos divergentes.
            safeLocalRemove('ai_history_' + userId);
            changed = true;
          }
        }
        if (pref.memory && typeof pref.memory === 'object') {
          const memKey = 'cl-ai-memory-' + userId;
          const memJson = JSON.stringify(pref.memory);
          if (safeLocalGet(memKey) !== memJson) {
            safeLocalSet(memKey, memJson);
            changed = true;
          }
        }
        if (changed) window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'ai' } }));
      } else if (section === 'pomodoro') {
        if (pref.cfg && typeof pref.cfg === 'object') {
          const key = 'cl-pomodoro-cfg';
          const json = JSON.stringify(pref.cfg);
          if (safeLocalGet(key) !== json) {
            safeLocalSet(key, json);
            window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'pomodoro' } }));
          }
        }
      }
    } catch (e) {
      console.warn('applyUserPrefSnapshot error:', section, e);
    }
  },

  /* Pull inicial no servidor (source:'server') para tasks/notas/macros do
     usuário e preferências. Garante que um aparelho novo ou com cache vazio
     receba TUDO do banco, mesmo antes do primeiro evento de snapshot. */
  async _pullUserData(userId) {
    if (!userId || userId.includes('local-')) {
      console.log('⚠️ Pull ignorado: usuário local');
      return;
    }
    
    console.log('📥 Iniciando pull de dados do Firestore para', userId);
    
    try {
      // allSettled: uma coleção sem permissão (ex.: regras antigas) não pode
      // impedir o pull das demais — cada uma é independente.
      const settled = await Promise.allSettled([
        db.collection('tasks').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('notes').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('macros').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('gamification').doc(userId).get({ source: 'server' }),
        db.collection('dashboardWidgets').doc(userId).get({ source: 'server' }),
      ]);
      const [tasksSnap, notesSnap, macrosSnap, gamSnap, widgetsSnap] = settled.map(r => r.status === 'fulfilled' ? r.value : null);

      const asSnapshot = snap => ({
        forEach: cb => snap.forEach(cb),
        docChanges: () => (typeof snap.docChanges === 'function' ? snap.docChanges() : []),
      });

      let tasksCount = 0, notesCount = 0, macrosCount = 0;
      
      if (tasksSnap) {
        this._handleCollectionSync('tasks', asSnapshot(tasksSnap), userId);
        tasksCount = tasksSnap.size || 0;
      }
      if (notesSnap) {
        this._handleCollectionSync('notes', asSnapshot(notesSnap), userId);
        notesCount = notesSnap.size || 0;
      }
      if (macrosSnap) {
        this._handleCollectionSync('macros', asSnapshot(macrosSnap), userId);
        macrosCount = macrosSnap.size || 0;
      }

      if (gamSnap && gamSnap.exists) {
        const data = core.getLocalDB();
        if (JSON.stringify(data.gamification[userId]) !== JSON.stringify(gamSnap.data())) {
          data.gamification[userId] = gamSnap.data();
          core.saveLocalDB(data);
          window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'gamification' } }));
          console.log('🏆 Gamificação carregada do Firestore');
        }
      }

      if (widgetsSnap && widgetsSnap.exists) {
        const remoteWidgets = widgetsSnap.data()?.widgets;
        if (remoteWidgets) {
          const data = core.getLocalDB();
          if (JSON.stringify(data.dashboardWidgets) !== JSON.stringify(remoteWidgets)) {
            data.dashboardWidgets = remoteWidgets;
            core.saveLocalDB(data);
            window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'dashboardWidgets' } }));
            console.log('📊 Dashboard widgets carregados do Firestore');
          }
        }
      }

      // Preferências por usuário (notificações, IA, pomodoro) vêm da nuvem.
      await Promise.allSettled(['notifications', 'ai', 'pomodoro'].map(async section => {
        try {
          const pref = await this.getUserPref(section, userId, { source: 'server' });
          if (pref) this._applyUserPrefSnapshot(section, userId, pref);
        } catch(e) {
          console.warn('Pull de preferência', section, 'falhou:', e.code);
        }
      }));

      console.log('✅ Pull concluído: tarefas=' + tasksCount + ', notas=' + notesCount + ', macros=' + macrosCount);
      
      // Notificar que os dados foram carregados para刷新 a interface
      window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'initialLoad' } }));
    } catch (err) {
      console.error('❌ Pull inicial falhou:', err.code, err.message);
      core.toast('Erro ao carregar dados do banco. Verifique sua conexão.', 'warning');
    }
  },

  async pushGamification(userId, stats) {
    if (!userId || userId.includes('local-')) return;
    try {
      await db.collection('gamification').doc(userId).set(stats, { merge: true });
      return true;
    } catch (err) { console.warn('pushGamification error:', err); return false; }
  },

  async pushDashboardWidgets(userId, widgets) {
    if (!userId || userId.includes('local-')) return;
    try {
      await db.collection('dashboardWidgets').doc(userId).set({
        widgets, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (err) { console.warn('pushDashboardWidgets error:', err); return false; }
  },

  /* Modos válidos de conexão da IA. 'custom' = usar somente o proxy próprio. */
  AI_MODES: ['auto', 'custom', 'direct', 'proxy'],

  async getAdminConfig() {
    let hasKey = false;
    let hasGroqKey = false;
    let aiProvider = 'deepseek';
    let aiMode = this.getAIMode();
    let aiProxyUrl = this.getAIProxyUrl();
    try {
      // Chaves/segredos: apenas sessionStorage (por aba) — nunca localStorage.
      hasKey = Boolean(sessionStorage.getItem('cl-admin-deepseek-key'));
      hasGroqKey = Boolean(sessionStorage.getItem('cl-admin-groq-key'));
    } catch(e) {}

    try {
      const doc = await db.collection('settings').doc('admin').get();
      if (doc.exists) {
        const data = doc.data() || {};
        if (data.deepseekKey) hasKey = true;
        if (data.groqKey) hasGroqKey = true;
        if (data.aiProvider === 'groq' || data.aiProvider === 'deepseek') aiProvider = data.aiProvider;
        if (data.aiMode && this.AI_MODES.includes(data.aiMode)) {
          aiMode = data.aiMode;
          try { sessionStorage.setItem('cl-admin-ai-mode', aiMode); } catch(e) {}
        }
        if (typeof data.aiProxyUrl === 'string') {
          aiProxyUrl = data.aiProxyUrl;
          try { sessionStorage.setItem('cl-admin-ai-proxy', aiProxyUrl); } catch(e) {}
        }
      }
    } catch (err) {
      console.warn('admin config load:', err);
    }
    return { hasDeepseekKey: hasKey, hasGroqKey, aiProvider, aiMode, aiProxyUrl, updatedAt: null };
  },

  /* Indica se o Firestore está respondendo para o ambiente atual.
     Usado pelo seed para evitar criar dados locais "frios" quando o banco
     remoto trará as atividades reais do usuário. Retorna true quando o
     cliente está autenticado E consegue ler o doc settings/admin (ou
     settings/global). Sem auth ou offline, retorna false. */
  async isAvailable() {
    try {
      if (!auth || !auth.currentUser) return false;
      // Tenta ler um doc público pequeno. Se responder (mesmo permission-denied
      // conta como "Firestore está vivo"), sabemos que o banco existe.
      await db.collection('settings').doc('global').get({ source: 'server' }).catch(err => {
        // permission-denied → Firestore OK, só bloqueou; считаем disponível
        if (err && err.code === 'permission-denied') return { exists: false };
        throw err;
      });
      return true;
    } catch (e) {
      return false;
    }
  },

  /* Modo de conexão da IA: 'auto' (proxy próprio → direto → públicos),
     'custom' (só proxy próprio), 'direct', 'proxy'. */
  getAIMode() {
    try {
      const mode = sessionStorage.getItem('cl-admin-ai-mode');
      return this.AI_MODES.includes(mode) ? mode : 'auto';
    } catch(e) { return 'auto'; }
  },

  /* URL do proxy próprio (Cloudflare Worker) — o caminho confiável para a IA,
     já que o DeepSeek bloqueia chamadas diretas do navegador por CORS. */
  getAIProxyUrl() {
    try { return (sessionStorage.getItem('cl-admin-ai-proxy') || '').trim(); }
    catch(e) { return ''; }
  },

  async getDeepseekKey() {
    // 1) sessionStorage: cache da aba atual (mais rápido; some ao fechar a
    //    aba). Nada de chave em localStorage — persistente e público.
    try {
      const sessionKey = sessionStorage.getItem('cl-admin-deepseek-key');
      if (sessionKey) return sessionKey;
    } catch(e) {}

    // 2) Firestore: documento privado settings/admin. Após a correção das
    //    rules, qualquer usuário autenticado consegue ler este doc — então
    //    a IA funciona para todos os membros do app.
    try {
      const doc = await db.collection('settings').doc('admin').get();
      if (doc.exists) {
        const data = doc.data();
        if (data && data.aiMode && this.AI_MODES.includes(data.aiMode)) {
          try { sessionStorage.setItem('cl-admin-ai-mode', data.aiMode); } catch(e) {}
        }
        if (data && typeof data.aiProxyUrl === 'string') {
          try { sessionStorage.setItem('cl-admin-ai-proxy', data.aiProxyUrl); } catch(e) {}
        }
        if (data && data.deepseekKey) {
          const key = String(data.deepseekKey || '');
          // cache da aba para chamadas subsequentes
          try { sessionStorage.setItem('cl-admin-deepseek-key', key); } catch(e) {}
          return key;
        }
      }
    } catch (err) {
      console.warn('getDeepseekKey (firestore) error:', err.code, err.message);
    }
    return '';
  },

  async getGroqKey() {
    try {
      const cached = sessionStorage.getItem('cl-admin-groq-key');
      if (cached) return cached;
    } catch(e) {}
    try {
      const doc = await db.collection('settings').doc('admin').get();
      const key = doc.exists ? String(doc.data()?.groqKey || '') : '';
      if (key) { sessionStorage.setItem('cl-admin-groq-key', key); }
      return key;
    } catch (err) { console.warn('getGroqKey error:', err); return ''; }
  },

  // ---------------------------------------------------------
  // reCAPTCHA Enterprise helpers — expostos via FireSync também
  // ---------------------------------------------------------
  getRecaptchaSiteKey() { return RECAPTCHA_ENTERPRISE_SITE_KEY; },

  async getRecaptchaToken(action = 'LOGIN') {
    if (typeof getRecaptchaToken === 'function') {
      return await getRecaptchaToken(action);
    }
    return null;
  },

  // Método que seria implementado no backend Java para verificar token
  // Aqui apenas logamos e opcionalmente enviamos para Firestore para auditoria
  async logRecaptchaAssessment(action, token, score = null) {
    try {
      if (!auth.currentUser) return;
      await db.collection('recaptcha_assessments').add({
        uid: auth.currentUser.uid,
        action: action,
        projectID: RECAPTCHA_PROJECT_ID,
        recaptchaKey: RECAPTCHA_ENTERPRISE_SITE_KEY,
        tokenPreview: token ? token.slice(0, 20) : null,
        score: score,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch(e) { console.warn('logRecaptchaAssessment:', e); }
  },

  async saveAdminConfig(config = {}) {
    const has = (field) => Object.prototype.hasOwnProperty.call(config, field);
    const deepseekKey = has('deepseekKey') ? String(config.deepseekKey || '').trim() : undefined;
    const groqKey = has('groqKey') ? String(config.groqKey || '').trim() : undefined;
    const aiProvider = has('aiProvider') && ['deepseek','groq'].includes(config.aiProvider) ? config.aiProvider : undefined;
    const aiMode = has('aiMode') && this.AI_MODES.includes(config.aiMode) ? config.aiMode : undefined;
    // Normaliza a URL do proxy: sem barra final, para concatenar os caminhos.
    const aiProxyUrl = has('aiProxyUrl')
      ? String(config.aiProxyUrl || '').trim().replace(/\/+$/, '') : undefined;

    // Cache de segredos APENAS em sessionStorage (por aba, some ao fechar).
    // O localStorage jamais recebe chaves — a fonte da verdade é o Firestore.
    if (deepseekKey !== undefined) {
      try { sessionStorage.setItem('cl-admin-deepseek-key', deepseekKey); } catch(e) {}
    }
    if (groqKey !== undefined) {
      try { sessionStorage.setItem('cl-admin-groq-key', groqKey); } catch(e) {}
    }
    if (aiProvider) {
      try { sessionStorage.setItem('cl-admin-ai-provider', aiProvider); } catch(e) {}
    }
    if (aiMode) {
      try { sessionStorage.setItem('cl-admin-ai-mode', aiMode); } catch(e) {}
    }
    if (aiProxyUrl !== undefined) {
      try { sessionStorage.setItem('cl-admin-ai-proxy', aiProxyUrl); } catch(e) {}
    }

    // Save in Firestore (merge: não apaga a chave ao salvar somente o modo)
    try {
      const payload = {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.currentUser?.uid || ''
      };
      if (deepseekKey !== undefined) payload.deepseekKey = deepseekKey;
      if (groqKey !== undefined) payload.groqKey = groqKey;
      if (aiProvider) payload.aiProvider = aiProvider;
      if (aiMode) payload.aiMode = aiMode;
      if (aiProxyUrl !== undefined) payload.aiProxyUrl = aiProxyUrl;
      await db.collection('settings').doc('admin').set(payload, { merge: true });
      console.log('🔐 Configuração privada salva no Firestore');
    } catch (err) {
      console.warn('Firestore admin config save warning:', err);
    }

    const result = {};
    if (deepseekKey !== undefined) result.hasDeepseekKey = Boolean(deepseekKey);
    if (groqKey !== undefined) result.hasGroqKey = Boolean(groqKey);
    if (aiProvider) result.aiProvider = aiProvider;
    if (aiMode) result.aiMode = aiMode;
    if (aiProxyUrl !== undefined) result.aiProxyUrl = aiProxyUrl;
    return result;
  }
};

window.fireSync = FireSync;

// Ao voltar a ficar online, reenvia imediatamente qualquer escrita pendente
// (outbox) para que nada fique retido no cache local.
window.addEventListener('online', () => {
  try { FireSync._flushOutbox(); } catch (e) {}
});

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

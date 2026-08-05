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

// Persistência de auth LOCAL por padrão: lembrar que o usuário está logado entre
// abas/recarregamentos SEM exigir marcar "lembrar de mim". Isso evita o flash
// chato em que o app mostra a tela de login por frações de segundo a cada F5.
// Se o usuário marcar "não lembrar", o handleLogin troca para SESSION na hora.
try {
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
    console.warn('Auth persistence LOCAL indisponível, continuando com default:', err.code);
  });
} catch(e) { console.warn('setPersistence falhou:', e); }

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
  if (typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return firebase.firestore.Timestamp.fromDate(d);
  }
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
  // v21: cada item da fila recebe o UID que o originou. Uma aba em que outro
  // usuário faz login nunca pode reenviar a alteração pendente de outra conta.
  _outboxKey: 'cl-firesync-outbox-v21',
  _legacyOutboxKey: 'cl-firesync-outbox-v18',
  _readyUserId: null,
  _lastServerPullAt: 0,
  _serverPullPromise: null,
  _dedupeUsers: new Set(),

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
    this._readyUserId = null;
    this._collectionErrors = {};
    this._loadOutbox(userId);

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

      // Todo usuário acompanha o PRÓPRIO perfil. Além de manter nome/avatar
      // atualizados, isso atualiza imediatamente o cargo quando um admin promove
      // alguém a editor — necessário para publicar arquivos sem relogar.
      const ownUserUnsub = db.collection('users').doc(userId)
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
          const oneDocSnapshot = {
            forEach: callback => callback(doc),
            docChanges: () => [{ type: 'modified', doc }],
          };
          this._handleCollectionSync('users', oneDocSnapshot, userId);
        }, err => {
          console.warn('Own user sync error:', err.code, err.message);
          this._handleSyncError(err, 'users', false);
        });
      this._unsubscribers.push(ownUserUnsub);

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

      // 2. Sincronizar posts (todos os posts). Não limitar a primeira leitura:
      // limite por ID/data fazia posts antigos e recursos simplesmente sumirem
      // em um navegador novo.
      const postsUnsub = db.collection('posts')
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('posts', snapshot, null);
        }, err => {
          console.warn('Posts sync error:', err.code, err.message);
          // Não crítico - posts pode estar vazio ou sem permissão
          this._handleSyncError(err, 'posts', false);
        });
      this._unsubscribers.push(postsUnsub);

      // 3. Sincronizar biblioteca completa. O antigo limit(100), sem ordenação,
      // deixava arquivos salvos fora da primeira página invisíveis em outro
      // navegador. A coleção é a fonte da verdade da biblioteca.
      const filesUnsub = db.collection('files')
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

      // 6. Pull inicial DO SERVIDOR. O cache local só acelera a primeira tela;
      //    ele nunca decide quais documentos existem. Fazemos também o pull da
      //    biblioteca compartilhada para que arquivos recém-publicados apareçam
      //    em qualquer navegador, mesmo antes do listener sair do cache.
      this.refreshFromServer(userId, { force: true }).catch(err => {
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

  _inferLegacyOutboxUser(item, fallbackUserId) {
    if (item?.uid) return String(item.uid);
    if (item?._pref && item.userId) return String(item.userId);
    if (item?.collection === 'users' && item.id) return String(item.id);
    const data = item?.data || {};
    if (data.owner) return String(data.owner);
    if (data.createdBy) return String(data.createdBy);
    // Só adota item legado quando há prova de que ele pertence ao usuário
    // atual. Nunca associe uma escrita compartilhada/desconhecida a quem
    // acabou de abrir o app em outro navegador.
    if (fallbackUserId && (item?.collection === 'tasks' || item?.collection === 'notes' || item?.collection === 'macros') &&
        String(data.owner || '') === String(fallbackUserId)) return String(fallbackUserId);
    return '';
  },

  _loadOutbox(userId) {
    try {
      const raw = safeLocalGet(this._outboxKey);
      const legacyRaw = raw ? null : safeLocalGet(this._legacyOutboxKey);
      const list = JSON.parse(raw || legacyRaw || '[]');
      this._outbox = Array.isArray(list) ? list.slice(0, 1000).map(item => {
        const uid = this._inferLegacyOutboxUser(item, userId);
        return { ...item, uid: uid || item.uid || '' };
      }) : [];
      // Migra a fila antiga para o formato que isola contas. Itens sem UID são
      // preservados para auditoria, mas nunca são enviados automaticamente.
      this._saveOutbox();
      if (legacyRaw) safeLocalRemove(this._legacyOutboxKey);
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

  _resolveWriteUser(dataObj = {}, explicitUid = '') {
    return String(explicitUid || auth.currentUser?.uid || this._userId || dataObj.owner || dataObj.createdBy || '');
  },

  _removeQueuedWrite(collection, id, uid = '') {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(item =>
      item._pref || item._delete || item.collection !== collection || String(item.id) !== String(id) ||
      (uid && String(item.uid || '') !== String(uid))
    );
    if (this._outbox.length !== before) this._saveOutbox();
  },

  _removeQueuedPref(section, userId) {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(item => !(item._pref && item.section === section && String(item.userId) === String(userId)));
    if (this._outbox.length !== before) this._saveOutbox();
  },

  _enqueuePref(section, userId, data) {
    const uid = String(userId || auth.currentUser?.uid || this._userId || '');
    const existing = this._outbox.find(item => item._pref && item.section === section && String(item.userId) === uid);
    const prefWrite = { _pref: true, section, userId: uid, uid, data, queuedAt: operationalNow() };
    if (existing) Object.assign(existing, prefWrite);
    else this._outbox.push(prefWrite);
    if (this._outbox.length > 1000) this._outbox.shift();
    this._saveOutbox();
    this._scheduleOutboxFlush();
  },

  _removeQueuedDelete(collection, id, uid = '') {
    const before = this._outbox.length;
    this._outbox = this._outbox.filter(item =>
      !(item._delete && item.collection === collection && String(item.id) === String(id) &&
        (!uid || String(item.uid || '') === String(uid)))
    );
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
    this._readyUserId = null;
    this._serverPullPromise = null;
    this._collectionErrors = {};
    console.log('🛑 FireSync parado');
  },

  /* ---------- Estado local pendente ---------- */
  _hasQueuedWrite(collection, id, userId = this._userId) {
    return (this._outbox || []).some(item =>
      !item._pref && !item._delete && item.collection === collection &&
      String(item.id) === String(id) &&
      (!userId || String(item.uid || '') === String(userId))
    );
  },

  _hasQueuedDelete(collection, id, userId = this._userId) {
    return (this._outbox || []).some(item =>
      item._delete && item.collection === collection &&
      String(item.id) === String(id) &&
      (!userId || String(item.uid || '') === String(userId))
    );
  },

  _listKeyForCollection(collectionName) {
    return ({
      tasks: 'tasks', notes: 'notes', posts: 'posts', files: 'files',
      macros: 'macros', users: 'users',
    })[collectionName] || null;
  },

  _normalizeRemoteDocument(doc) {
    const remoteData = doc.data() || {};
    // O cache visual usa strings ISO; FieldValue/Timestamp não pode entrar no
    // localStorage, pois corrompe o JSON e causa renderizações inconsistentes.
    const normalized = { ...remoteData };
    ['createdAt', 'updatedAt', 'publishedAt', 'finishedAt'].forEach(field => {
      if (normalized[field] && normalized[field].toDate) {
        normalized[field] = normalized[field].toDate().toISOString();
      }
    });
    if (normalized.date && normalized.date.toDate) {
      normalized.date = core.dateKeyFromLocalDate(normalized.date.toDate());
    } else if (normalized.date instanceof Date) {
      normalized.date = core.dateKeyFromLocalDate(normalized.date);
    } else if (typeof normalized.date === 'string' && normalized.date.length > 10) {
      normalized.date = normalized.date.slice(0, 10);
    }
    // O ID do documento Firestore é canônico; nunca deixe um campo `id`
    // legado do payload substituir a chave usada para sincronizar.
    return { ...normalized, id: String(doc.id) };
  },

  _emitCollectionSync(collectionName, count) {
    window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: collectionName } }));
    console.log(`🔄 ${collectionName} sincronizados do Firestore (${count} docs)`);
  },

  /* Sincronizar uma coleção inteira.
     O Firestore é a fonte da verdade: o cache só é atualizado a partir do
     remoto. A única exceção é uma escrita ainda presente na outbox; ela fica
     protegida até receber confirmação do servidor. O código antigo tentava
     reenviar qualquer item que estivesse no localStorage e, em duas abas,
     ressuscitava tarefas apagadas e criava duplicações. */
  _handleCollectionSync(collectionName, snapshot, userId) {
    try {
      const data = core.getLocalDB();
      const remoteDocs = [];
      snapshot.forEach(doc => remoteDocs.push(this._normalizeRemoteDocument(doc)));
      let hasChanges = false;
      const listKey = this._listKeyForCollection(collectionName);
      const activeUserId = userId || this._userId;

      const removedIds = typeof snapshot.docChanges === 'function'
        ? snapshot.docChanges().filter(change => change.type === 'removed').map(change => String(change.doc.id))
        : [];

      if (listKey && Array.isArray(data[listKey]) && removedIds.length) {
        const before = data[listKey].length;
        data[listKey] = data[listKey].filter(item => {
          const id = String(item.id);
          if (!removedIds.includes(id)) return true;
          // Se uma alteração local legítima ainda aguarda confirmação, não a
          // apague por causa de um snapshot anterior. Exclusões pendentes, por
          // outro lado, precisam permanecer ocultas imediatamente.
          return this._hasQueuedWrite(collectionName, id, activeUserId) &&
            !this._hasQueuedDelete(collectionName, id, activeUserId);
        });
        hasChanges = data[listKey].length !== before;
      }

      if (collectionName === 'comments') {
        if (!data.comments || typeof data.comments !== 'object') data.comments = {};
        let commentsChanged = false;
        remoteDocs.forEach(remote => {
          const taskId = remote.taskId;
          if (!taskId) return;
          if (!data.comments[taskId]) data.comments[taskId] = [];
          const index = data.comments[taskId].findIndex(comment => String(comment.id) === String(remote.id));
          if (index >= 0) {
            if (JSON.stringify(data.comments[taskId][index]) !== JSON.stringify(remote)) {
              data.comments[taskId][index] = remote;
              commentsChanged = true;
            }
          } else {
            data.comments[taskId].push(remote);
            commentsChanged = true;
          }
        });
        removedIds.forEach(id => {
          Object.keys(data.comments).forEach(taskId => {
            const before = data.comments[taskId].length;
            data.comments[taskId] = data.comments[taskId].filter(comment => String(comment.id) !== id);
            if (before !== data.comments[taskId].length) commentsChanged = true;
          });
        });
        if (commentsChanged) {
          Object.keys(data.comments).forEach(taskId => {
            data.comments[taskId].sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
          });
          hasChanges = true;
        }
      } else if (collectionName === 'automations') {
        // Automações são globais e administradas no Firestore. Não misturar
        // defaults antigos do cache com a lista remota.
        if (JSON.stringify(data.automations || []) !== JSON.stringify(remoteDocs)) {
          data.automations = remoteDocs;
          hasChanges = true;
        }
      } else if (collectionName === 'customThemes') {
        if (JSON.stringify(data.customThemes || []) !== JSON.stringify(remoteDocs)) {
          data.customThemes = remoteDocs;
          hasChanges = true;
        }
      } else if (listKey) {
        if (!Array.isArray(data[listKey])) data[listKey] = [];
        remoteDocs.forEach(remote => {
          const index = data[listKey].findIndex(item => String(item.id || item.uid) === String(remote.id));
          if (index >= 0) {
            const local = data[listKey][index];
            if (this._hasQueuedWrite(collectionName, remote.id, activeUserId)) return;
            const next = collectionName === 'users'
              ? { ...remote, id: remote.id, uid: remote.uid || remote.id }
              : { ...remote, id: remote.id };
            if (JSON.stringify(local) !== JSON.stringify(next)) {
              data[listKey][index] = next;
              hasChanges = true;
            }
          } else {
            const next = collectionName === 'users'
              ? { ...remote, id: remote.id, uid: remote.uid || remote.id }
              : { ...remote, id: remote.id };
            data[listKey].push(next);
            hasChanges = true;
          }
        });
      }

      if (hasChanges) {
        core.saveLocalDB(data);
        this._emitCollectionSync(collectionName, remoteDocs.length);
      }
    } catch (error) {
      console.warn(`_handleCollectionSync ${collectionName} error:`, error);
    }
  },

  /* Push manual de um documento.
     A escrita entra na outbox ANTES da tentativa de rede (write-ahead). Isso
     fecha a janela em que uma aba era colocada em segundo plano entre salvar o
     cache e receber a confirmação do Firestore. */
  async pushDocument(collection, id, dataObj) {
    if (!collection || id === undefined || id === null || !dataObj) {
      console.warn('⚠️ pushDocument: parâmetros inválidos', { collection, id });
      return false;
    }

    const uid = this._resolveWriteUser(dataObj);
    this._enqueueWrite(collection, id, dataObj, uid);

    if (!auth.currentUser) {
      console.warn('⚠️ pushDocument: aguardando restauração da autenticação');
      this._scheduleOutboxFlush();
      return false;
    }

    // A fila é ligada ao usuário que iniciou a ação. Não permita que uma aba
    // que trocou de conta escreva os dados pendentes da conta anterior.
    if (uid && String(uid) !== String(auth.currentUser.uid)) {
      console.warn('⚠️ pushDocument ignorado: UID da escrita não corresponde à sessão atual');
      return false;
    }

    try {
      console.log('📤 pushDocument → Firestore:', collection, id);
      await this._writeDoc(collection, id, dataObj);
      this._clearError(collection);
      this._removeQueuedWrite(collection, id, auth.currentUser.uid);
      console.log('✅ pushDocument OK:', collection, id);
      return true;
    } catch (err) {
      console.error('❌ pushDocument ERRO:', collection, id, err.code, err.message);
      if (err.code === 'permission-denied') {
        // Permission denied is definitive; keeping a phantom document in the
        // outbox made it reappear later and parecia uma duplicação ao usuário.
        this._removeQueuedWrite(collection, id, auth.currentUser.uid);
        this._bumpErrorSafe(collection);
        window.dispatchEvent(new CustomEvent('firebaseWriteError', {
          detail: { collection, id: String(id), code: err.code, message: err.message || '' }
        }));
        core.toast(`Sem permissão para sincronizar ${collection}. Verifique as regras.`, 'warning');
      } else {
        // Falha transitória: a entrada já está persistida; tente novamente ao
        // voltar online/ao retomar a aba.
        this._scheduleOutboxFlush();
      }
      return false;
    }
  },

  /* Grava um documento no Firestore (conversões de Timestamp + limpeza) */
  async _writeDoc(collection, id, dataObj) {
    const docData = { ...dataObj };
    delete docData.id;
    if (collection === 'users') {
      delete docData.pass;
      delete docData.passHash;
    }

    const createdTs = safeFirestoreTimestamp(docData.createdAt);
    if (createdTs) docData.createdAt = createdTs;
    // updatedAt é sempre definido pelo servidor: o relógio de um navegador
    // antigo não pode vencer uma alteração mais recente em outro dispositivo.
    docData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection(collection).doc(String(id)).set(docData, { merge: true });
    console.log(`📤 ${collection}/${id} enviado ao Firestore`);
  },

  /* ---------- FILA DE REESCRITA (OUTBOX) ---------- */
  _enqueueWrite(collection, id, data, explicitUid = '') {
    const safeData = this._sanitizeOutboxData(collection, data);
    const uid = this._resolveWriteUser(safeData, explicitUid);
    const existing = this._outbox.find(item =>
      !item._pref && !item._delete && item.collection === collection &&
      String(item.id) === String(id) && String(item.uid || '') === String(uid)
    );
    const write = { collection, id: String(id), uid, data: safeData, queuedAt: operationalNow() };
    if (existing) Object.assign(existing, write);
    else {
      this._outbox.push(write);
      if (this._outbox.length > 1000) this._outbox.shift();
    }
    this._saveOutbox();
  },

  _enqueueDelete(collection, id, explicitUid = '') {
    const uid = this._resolveWriteUser({}, explicitUid);
    const existing = this._outbox.find(item =>
      item._delete && item.collection === collection && String(item.id) === String(id) &&
      String(item.uid || '') === String(uid)
    );
    const deletion = { collection, id: String(id), uid, _delete: true, queuedAt: operationalNow() };
    if (existing) Object.assign(existing, deletion);
    else {
      this._outbox.push(deletion);
      if (this._outbox.length > 1000) this._outbox.shift();
    }
    // Uma exclusão vence uma gravação pendente do mesmo documento/usuário.
    this._removeQueuedWrite(collection, id, uid);
    this._saveOutbox();
  },

  _scheduleOutboxFlush(delay = 3000) {
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

  /* Reenvia somente itens do usuário autenticado atual. */
  async _flushOutbox() {
    if (this._outboxFlushing || !this._outbox.length) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    this._outboxFlushing = true;
    const started = Date.now();
    try {
      while (true) {
        const index = this._outbox.findIndex(item => String(item.uid || '') === String(uid));
        if (index < 0) break; // itens de outra conta aguardam o dono voltar
        const item = this._outbox[index];
        try {
          if (item._pref) {
            await db.collection('settings').doc(item.section).collection('user').doc(item.userId)
              .set(item.data, { merge: true });
          } else if (item._delete) {
            await db.collection(item.collection).doc(String(item.id)).delete();
            this._removeLocalAfterDelete(item.collection, item.id);
          } else {
            await this._writeDoc(item.collection, item.id, item.data);
          }
          this._clearError(item.collection || item.section);
          this._outbox.splice(index, 1);
          this._saveOutbox();
        } catch (err) {
          if (err.code === 'permission-denied') {
            console.warn('Outbox: escrita sem permissão descartada:', item.collection || item.section, item.id || item.userId);
            this._bumpErrorSafe(item.collection || item.section);
            this._outbox.splice(index, 1);
            this._saveOutbox();
            window.dispatchEvent(new CustomEvent('firebaseWriteError', {
              detail: { collection: item.collection || item.section, id: String(item.id || item.userId), code: err.code, message: err.message || '' }
            }));
          } else {
            // Offline/rede: mantém a escrita intacta para o próximo retorno.
            break;
          }
        }
        if (Date.now() - started > 10000) break;
      }
    } finally {
      this._outboxFlushing = false;
      if (this._outbox.some(item => String(item.uid || '') === String(uid))) this._scheduleOutboxFlush(10000);
    }
  },

  _removeLocalAfterDelete(collection, id) {
    try {
      const data = core.getLocalDB();
      if (Array.isArray(data[collection])) {
        const before = data[collection].length;
        data[collection] = data[collection].filter(doc => String(doc.id) !== String(id));
        if (before !== data[collection].length) {
          core.saveLocalDB(data);
          this._emitCollectionSync(collection, data[collection].length);
        }
      }
    } catch (error) { console.warn('limpeza local após delete outbox falhou:', error); }
  },

  _bumpErrorSafe(collection) {
    const count = (this._collectionErrors[collection] || 0) + 1;
    this._collectionErrors[collection] = count;
  },

  /* Configurações globais — somente admin. Também usam a mesma outbox para
     não deixar menu/categorias salvos apenas no navegador quando a rede cai. */
  async pushSettings(settings) {
    try {
      const currentUser = core.getCurrentUser();
      const data = core.getLocalDB();
      const profile = (data.users || []).find(user => user.id === currentUser?.id || user.uid === currentUser?.uid);
      const isAdmin = currentUser?.role === 'admin' || profile?.role === 'admin';
      if (!isAdmin) {
        console.log('ℹ️ Settings push ignorado - usuário não é admin');
        return false;
      }
      const payload = {
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
      };
      const synced = await this.pushDocument('settings', 'global', payload);
      if (synced) console.log('📤 Settings enviados ao Firestore');
      return synced;
    } catch (err) {
      console.warn('Erro ao enviar settings:', err.code || err.message);
      return false;
    }
  },

  async deleteDocument(collection, id) {
    const uid = this._resolveWriteUser();
    this._enqueueDelete(collection, id, uid);
    if (!auth.currentUser) {
      this._scheduleOutboxFlush();
      return false;
    }
    if (uid && String(uid) !== String(auth.currentUser.uid)) return false;
    try {
      await db.collection(collection).doc(String(id)).delete();
      console.log(`🗑️ ${collection}/${id} removido do Firestore`);
      this._clearError(collection);
      this._removeQueuedDelete(collection, id, auth.currentUser.uid);
      return true;
    } catch (err) {
      console.warn(`Erro ao remover ${collection}/${id}:`, err.code, err.message);
      if (err.code === 'permission-denied') {
        this._removeQueuedDelete(collection, id, auth.currentUser.uid);
        this._bumpErrorSafe(collection);
        window.dispatchEvent(new CustomEvent('firebaseWriteError', {
          detail: { collection, id: String(id), code: err.code, message: err.message || '' }
        }));
      } else {
        this._scheduleOutboxFlush();
      }
      return false;
    }
  },

  /* ---------- BIBLIOTECA DE ARQUIVOS (Firebase Storage) ---------- */
  _safeStorageFileName(name = 'arquivo') {
    const cleaned = String(name).normalize?.('NFD').replace(/[\u0300-\u036f]/g, '') || String(name);
    return cleaned.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'arquivo';
  },

  async uploadLibraryAsset(fileId, file, kind = 'resource', onProgress) {
    if (!auth.currentUser) throw new Error('Faça login antes de enviar um arquivo.');
    if (!file || typeof file.size !== 'number') throw new Error('Selecione um arquivo válido.');
    const maxBytes = kind === 'thumbnail' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(kind === 'thumbnail'
        ? 'A imagem de capa deve ter no máximo 2 MB.'
        : 'O arquivo deve ter no máximo 5 MB.');
    }
    const safeName = this._safeStorageFileName(file.name || (kind === 'thumbnail' ? 'capa' : 'arquivo'));
    const assetName = `${kind}-${Date.now()}-${safeName}`;
    const path = `files/${String(fileId)}/${assetName}`;
    const ref = storage.ref().child(path);
    const metadata = file.type ? { contentType: file.type } : undefined;
    const upload = ref.put(file, metadata);
    if (typeof onProgress === 'function' && upload?.on) {
      upload.on('state_changed', snap => {
        const total = snap.totalBytes || file.size || 1;
        onProgress(Math.round((snap.bytesTransferred / total) * 100));
      });
    }
    const snapshot = await upload;
    const url = await snapshot.ref.getDownloadURL();
    return {
      url,
      storagePath: path,
      name: file.name || safeName,
      size: file.size,
      contentType: file.type || '',
    };
  },

  async deleteLibraryAssets(fileRecord = {}) {
    const paths = [fileRecord.storagePath, fileRecord.thumbnailStoragePath].filter(Boolean);
    if (!paths.length) return true;
    const results = await Promise.allSettled(paths.map(path => storage.ref().child(path).delete()));
    // Um objeto já removido no Storage não deve impedir a exclusão do registro.
    return results.every(result => result.status === 'fulfilled' || result.reason?.code === 'storage/object-not-found');
  },

  /* ---------- PREFERÊNCIAS/DADOS POR USUÁRIO NA NUVEM ----------
     Notificações, histórico/memória da IA e configuração do Pomodoro ficam em
     settings/{section}/user/{uid} no Firestore (regras: só o dono lê e
     escreve). O localStorage é apenas cache de leitura. */
  async pushUserPref(section, userId, data) {
    if (!section || !userId || String(userId).includes('local-')) return false;
    // Write-ahead também para preferências privadas (notificações, IA e
    // pomodoro): fechar a aba logo após alterar não pode perder o estado.
    this._enqueuePref(section, userId, data);
    if (!auth.currentUser) return false;
    if (String(auth.currentUser.uid) !== String(userId)) return false;
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
        this._removeQueuedPref(section, userId);
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

  /* Retorna um snapshot completo de servidor com as remoções que precisam ser
     refletidas no cache. Só documentos SEM escrita pendente são removidos. */
  _asFullServerSnapshot(snapshot, collectionName, userId = '') {
    const remoteIds = new Set();
    snapshot.forEach(doc => remoteIds.add(String(doc.id)));
    const listKey = this._listKeyForCollection(collectionName);
    const removed = [];
    try {
      const localData = core.getLocalDB();
      const localList = listKey && Array.isArray(localData[listKey]) ? localData[listKey] : [];
      localList.forEach(item => {
        const id = String(item.id || item.uid || '');
        const belongsToUser = !userId || String(item.owner || item.id || item.uid || '') === String(userId);
        if (!id || !belongsToUser) return;
        if (this._hasQueuedDelete(collectionName, id, userId)) {
          removed.push({ doc: { id }, type: 'removed' });
        } else if (!remoteIds.has(id) && !this._hasQueuedWrite(collectionName, id, userId)) {
          // O servidor confirmou que não existe: remove cache velho, sem
          // tentar ressuscitá-lo em outro dispositivo.
          removed.push({ doc: { id }, type: 'removed' });
        }
      });
    } catch (error) { console.warn('diff remoto/local falhou:', error); }
    return {
      forEach: callback => snapshot.forEach(callback),
      docChanges: () => {
        const added = [];
        snapshot.forEach(doc => added.push({ doc, type: 'added' }));
        return added.concat(removed);
      },
    };
  },

  isInitialSyncReady(userId = this._userId) {
    return Boolean(userId && String(this._readyUserId || '') === String(userId));
  },

  async refreshFromServer(userId = this._userId, options = {}) {
    const { force = false } = options;
    if (!userId || String(auth.currentUser?.uid || '') !== String(userId)) return false;
    const now = Date.now();
    if (this._serverPullPromise) return this._serverPullPromise;
    if (!force && this.isInitialSyncReady(userId) && now - this._lastServerPullAt < 30000) return true;
    this._serverPullPromise = this._pullUserData(userId)
      .finally(() => { this._serverPullPromise = null; });
    return this._serverPullPromise;
  },

  /* Pull de servidor para dados do usuário E biblioteca compartilhada. */
  async _pullUserData(userId) {
    if (!userId || userId.includes('local-')) return false;
    if (String(auth.currentUser?.uid || '') !== String(userId)) return false;

    console.log('📥 Atualizando cache pelo Firestore para', userId);
    try {
      const settled = await Promise.allSettled([
        db.collection('tasks').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('notes').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('macros').where('owner', '==', userId).get({ source: 'server' }),
        db.collection('files').get({ source: 'server' }),
        db.collection('posts').get({ source: 'server' }),
        db.collection('gamification').doc(userId).get({ source: 'server' }),
        db.collection('dashboardWidgets').doc(userId).get({ source: 'server' }),
      ]);
      const [tasksSnap, notesSnap, macrosSnap, filesSnap, postsSnap, gamSnap, widgetsSnap] =
        settled.map(result => result.status === 'fulfilled' ? result.value : null);

      if (String(auth.currentUser?.uid || '') !== String(userId) || String(this._userId || '') !== String(userId)) {
        return false; // a conta mudou enquanto a rede respondia
      }

      if (tasksSnap) this._handleCollectionSync('tasks', this._asFullServerSnapshot(tasksSnap, 'tasks', userId), userId);
      if (notesSnap) this._handleCollectionSync('notes', this._asFullServerSnapshot(notesSnap, 'notes', userId), userId);
      if (macrosSnap) this._handleCollectionSync('macros', this._asFullServerSnapshot(macrosSnap, 'macros', userId), userId);
      if (filesSnap) this._handleCollectionSync('files', this._asFullServerSnapshot(filesSnap, 'files'), null);
      if (postsSnap) this._handleCollectionSync('posts', this._asFullServerSnapshot(postsSnap, 'posts'), null);

      if (gamSnap?.exists) {
        const data = core.getLocalDB();
        if (JSON.stringify(data.gamification[userId]) !== JSON.stringify(gamSnap.data())) {
          data.gamification[userId] = gamSnap.data();
          core.saveLocalDB(data);
          window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'gamification' } }));
        }
      }

      if (widgetsSnap?.exists) {
        const remoteWidgets = widgetsSnap.data()?.widgets;
        if (remoteWidgets) {
          const data = core.getLocalDB();
          if (JSON.stringify(data.dashboardWidgets) !== JSON.stringify(remoteWidgets)) {
            data.dashboardWidgets = remoteWidgets;
            core.saveLocalDB(data);
            window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'dashboardWidgets' } }));
          }
        }
      }

      await Promise.allSettled(['notifications', 'ai', 'pomodoro'].map(async section => {
        const pref = await this.getUserPref(section, userId, { source: 'server' });
        if (pref) this._applyUserPrefSnapshot(section, userId, pref);
      }));

      this._readyUserId = userId;
      this._lastServerPullAt = Date.now();
      window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'syncReady' } }));
      // Compatibilidade com páginas de versões anteriores.
      window.dispatchEvent(new CustomEvent('firebaseSync', { detail: { type: 'initialLoad' } }));
      console.log('✅ Cache confirmado pelo servidor para', userId);

      // Corrige apenas duplicações comprovadas de séries recorrentes antigas.
      // Tarefas normais com mesmo título/data nunca entram nesta limpeza.
      this._dedupeRecurringTasks(userId).catch(error => console.warn('dedupe recorrências:', error));
      return true;
    } catch (err) {
      console.error('❌ Pull do servidor falhou:', err.code, err.message);
      return false;
    }
  },

  async _dedupeRecurringTasks(userId) {
    if (this._dedupeUsers.has(String(userId)) || String(auth.currentUser?.uid || '') !== String(userId)) return;
    this._dedupeUsers.add(String(userId));
    try {
      const snapshot = await db.collection('tasks').where('owner', '==', userId).get({ source: 'server' });
      const groups = new Map();
      snapshot.forEach(doc => {
        const task = this._normalizeRemoteDocument(doc);
        if (!task.recurrenceRootId || !task.recurrence || task.recurrence === 'none' || !task.date) return;
        const key = `${task.recurrenceRootId}::${String(task.date).slice(0, 10)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
      });

      const operations = [];
      groups.forEach(tasks => {
        if (tasks.length < 2) return;
        const sorted = tasks.slice().sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
        const preferred = sorted[0];
        const canonicalId = core.recurrenceOccurrenceId(preferred.recurrenceRootId, preferred.date);
        const canonical = tasks.find(task => String(task.id) === canonicalId);
        const source = canonical && timestampMillis(canonical.updatedAt || canonical.createdAt) >= timestampMillis(preferred.updatedAt || preferred.createdAt)
          ? canonical : preferred;
        operations.push({ canonicalId, source, remove: tasks.filter(task => String(task.id) !== canonicalId) });
      });

      // Firestore aceita no máximo 500 operações por batch. Um grupo costuma
      // ter duas cópias, mas o lote é calculado pelo número real de deletes.
      let batch = db.batch();
      let batchSize = 0;
      for (const operation of operations) {
        const operationSize = 1 + operation.remove.length;
        if (batchSize && batchSize + operationSize > 450) {
          await batch.commit();
          batch = db.batch();
          batchSize = 0;
        }
        const payload = { ...operation.source };
        delete payload.id;
        payload.owner = userId;
        payload.recurrenceRootId = String(operation.source.recurrenceRootId);
        const createdAt = safeFirestoreTimestamp(payload.createdAt);
        if (createdAt) payload.createdAt = createdAt;
        payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        batch.set(db.collection('tasks').doc(operation.canonicalId), payload, { merge: true });
        operation.remove.forEach(task => batch.delete(db.collection('tasks').doc(String(task.id))));
        batchSize += operationSize;
      }
      if (batchSize) await batch.commit();
      if (operations.length) console.info(`🧹 ${operations.length} séries recorrentes duplicadas foram consolidadas.`);
    } finally {
      // Só rodar uma vez por sessão; o listener mantém o cache atualizado após a limpeza.
    }
  },

  async pushGamification(userId, stats) {
    if (!userId || userId.includes('local-')) return false;
    // Mesmo tratamento write-ahead das tarefas: não perder pontos se o app
    // ficar offline imediatamente após encerrar uma sessão de foco.
    return this.pushDocument('gamification', userId, stats);
  },

  async pushDashboardWidgets(userId, widgets) {
    if (!userId || userId.includes('local-')) return false;
    return this.pushDocument('dashboardWidgets', userId, { widgets });
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

/* =========================================================
   HEARTBEAT DE AUTENTICAÇÃO — lembra por tempo que está logado
   A cada 60 minutos força refresh do token Firebase (getIdToken true)
   Se falhar, faz signOut e limpa sessão.
   ========================================================= */
let firebaseHeartbeatInterval = null;
function startFirebaseAuthHeartbeat() {
  if (firebaseHeartbeatInterval) clearInterval(firebaseHeartbeatInterval);
  console.log('⏱️ Heartbeat de auth iniciado (a cada 60 min)');
  firebaseHeartbeatInterval = setInterval(async () => {
    try {
      if (!auth || !auth.currentUser) {
        console.log('⏹️ Sem usuário Firebase — parando heartbeat');
        clearInterval(firebaseHeartbeatInterval); firebaseHeartbeatInterval = null; return;
      }
      // Força renovação do token (verifica se ainda é válido)
      const token = await auth.currentUser.getIdToken(true);
      console.log('✅ Auth heartbeat OK — token renovado (últimos 5 chars:', token.slice(-5), ')');
    } catch (err) {
      console.warn('❌ Auth heartbeat falhou — sessão expirada?', err);
      try { await auth.signOut(); } catch {}
      if (typeof App !== 'undefined' && App.showLogin) App.showLogin();
      clearInterval(firebaseHeartbeatInterval); firebaseHeartbeatInterval = null;
    }
  }, 60 * 60 * 1000); // 60 minutos
}
window.startFirebaseAuthHeartbeat = startFirebaseAuthHeartbeat;

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

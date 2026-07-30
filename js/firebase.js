/* =========================================================
   CHECKLIST ML — firebase.js  (CORRIGIDO última atualização)
   Firebase SDK via CDN — Auth + Firestore + Storage + Sync
   FIX: trava no login Google + regras Realtime vs Firestore
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
  _errorCount: 0,
  _maxErrors: 5,

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
    this._errorCount = 0;

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
            const publicKeys = ['brand', 'theme', 'mode', 'language', 'categories',
              'menuItems', 'menuOrder', 'logo', 'favicon'];
            publicKeys.forEach(key => {
              if (!Object.prototype.hasOwnProperty.call(remoteSettings, key)) return;
              const localValue = JSON.stringify(data.settings[key]);
              const remoteValue = JSON.stringify(remoteSettings[key]);
              if (localValue !== remoteValue) {
                data.settings[key] = remoteSettings[key];
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
    // Se for permission-denied, não tentar infinitamente
    if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
      console.warn(`⚠️ Sem permissão para ${collection}. Verifique firestore.rules`);
      this._errorCount++;
      if (this._errorCount >= this._maxErrors && critical) {
        console.warn('🛑 Muitos erros de permissão, parando FireSync');
        this.stop();
        if (typeof core !== 'undefined' && core.toast) {
          core.toast(`Sem permissão para sincronizar ${collection}. Verifique as regras do Firestore.`, 'warning');
        }
      }
      return;
    }
    // Outros erros: apenas log
    this._errorCount++;
  },

  /* Para todos os listeners */
  stop() {
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch(e) {}
    });
    this._unsubscribers = [];
    this._syncing = false;
    this._userId = null;
    this._errorCount = 0;
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
        if (collectionName === 'posts') data.posts = removeById(data.posts);
        if (collectionName === 'files') data.files = removeById(data.files);
        if (collectionName === 'macros') data.macros = removeById(data.macros);
        if (collectionName === 'users') data.users = removeById(data.users);
        hasChanges = true;
      }

      // Para tasks: filtrar as que são do usuário local
      if (collectionName === 'tasks' && userId) {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        
        // Atualizar/inserir tasks remotas no local
        remoteDocs.forEach(remote => {
          const localIdx = data.tasks.findIndex(t => String(t.id) === String(remote.id));
          if (localIdx >= 0) {
            const localUpdated = timestampMillis(data.tasks[localIdx].updatedAt || data.tasks[localIdx].createdAt);
            const remoteUpdated = timestampMillis(remote.updatedAt || remote.createdAt);
            if (remoteUpdated > localUpdated) {
              data.tasks[localIdx] = { ...data.tasks[localIdx], ...remote, id: data.tasks[localIdx].id };
              hasChanges = true;
            }
          } else {
            data.tasks.push(remote);
            hasChanges = true;
          }
        });

        // Subir tasks locais que não estão no remoto - APENAS se não tiver muitos erros
        if (this._errorCount < 2) {
          const localTasksToPush = data.tasks.filter(t => 
            t.owner === userId && !remoteIds.has(String(t.id))
          ).slice(0, 20); // limite para não travar
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

        // Atualizar/inserir macros remotas no local
        remoteDocs.forEach(remote => {
          const localIdx = data.macros.findIndex(m => String(m.id) === String(remote.id));
          if (localIdx >= 0) {
            const lTime = timestampMillis(data.macros[localIdx].updatedAt || data.macros[localIdx].createdAt);
            const rTime = timestampMillis(remote.updatedAt || remote.createdAt);
            if (rTime > lTime) {
              data.macros[localIdx] = { ...data.macros[localIdx], ...remote, id: data.macros[localIdx].id };
              hasChanges = true;
            }
          } else {
            data.macros.push(remote);
            hasChanges = true;
          }
        });

        // Subir macros locais do usuário que ainda não estão no remoto
        if (this._errorCount < 2) {
          const localMacrosToPush = data.macros.filter(m =>
            m.owner === userId && !remoteIds.has(String(m.id))
          ).slice(0, 20);
          if (localMacrosToPush.length > 0) {
            this._pushLocalToFirestore('macros', localMacrosToPush, userId);
          }
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
    if (this._errorCount >= 2) {
      console.warn('⚠️ Muitos erros, pulando push para', collection);
      return;
    }

    const batch = db.batch();
    let count = 0;

    for (const item of items) {
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
        if (count >= 20) break; // Limite do batch reduzido para evitar travamento
      } catch(e) {
        console.warn('Erro ao preparar doc para push:', e);
      }
    }

    if (count > 0) {
      try {
        await batch.commit();
        console.log(`📤 ${count} ${collection} enviados ao Firestore`);
      } catch (err) {
        console.warn(`Erro ao enviar ${collection}:`, err.code, err.message);
        if (err.code === 'permission-denied') {
          this._errorCount++;
        }
      }
    }
  },

  /* Push manual de um documento */
  async pushDocument(collection, id, dataObj) {
    if (this._errorCount >= 3) {
      console.warn('⚠️ Push bloqueado por muitos erros');
      return false;
    }
    try {
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
      return true;
    } catch (err) {
      console.warn(`Erro ao enviar ${collection}/${id}:`, err.code, err.message);
      if (err.code === 'permission-denied') this._errorCount++;
      return false;
    }
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
    try {
      await db.collection(collection).doc(String(id)).delete();
      console.log(`🗑️ ${collection}/${id} removido do Firestore`);
      return true;
    } catch (err) {
      console.warn(`Erro ao remover ${collection}/${id}:`, err.code, err.message);
      if (err.code === 'permission-denied') this._errorCount++;
      return false;
    }
  },

  async getAdminConfig() {
    if (!this._isCurrentUserAdmin()) throw new Error('Acesso restrito a administradores');
    const doc = await db.collection('settings').doc('admin').get();
    const config = doc.exists ? doc.data() : {};
    // A tela administrativa precisa apenas saber se há uma chave salva; ela não
    // recebe o segredo de volta para evitar expô-lo desnecessariamente no DOM.
    return { hasDeepseekKey: Boolean(config.deepseekKey), updatedAt: config.updatedAt || null };
  },

  async getDeepseekKey() {
    if (!this._isCurrentUserAdmin()) return '';
    const doc = await db.collection('settings').doc('admin').get();
    return doc.exists ? String(doc.data().deepseekKey || '') : '';
  },

  async saveAdminConfig(config = {}) {
    if (!this._isCurrentUserAdmin()) throw new Error('Acesso restrito a administradores');
    const deepseekKey = String(config.deepseekKey || '').trim();
    await db.collection('settings').doc('admin').set({
      deepseekKey,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser?.uid || ''
    }, { merge: true });
    console.log('🔐 Configuração privada salva no Firestore');
    return { hasDeepseekKey: Boolean(deepseekKey) };
  }
};

window.fireSync = FireSync;

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

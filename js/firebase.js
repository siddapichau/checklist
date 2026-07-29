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

/* ========== FIREBASE SYNC ========== */
const FireSync = {
  _unsubscribers: [],
  _syncing: false,
  _userId: null,
  _errorCount: 0,
  _maxErrors: 5,

  /* Iniciar sincronização para um usuário */
  async start(userId) {
    this.stop();
    this._userId = userId;
    this._syncing = true;
    this._errorCount = 0;

    console.log('🔄 FireSync iniciado para:', userId);

    // Se não há userId (usuário local), pular
    if (!userId || userId.includes('local-') || userId === 'unknown') {
      console.log('⚠️ Usuário local, FireSync não ativado');
      this._syncing = false;
      return;
    }

    // Verificar se auth está pronto
    if (!auth.currentUser) {
      console.warn('⚠️ auth.currentUser nulo, aguardando...');
      // tentar novamente em 1s se auth ainda não estiver pronto
      setTimeout(() => {
        if (auth.currentUser && userId) this.start(userId);
      }, 1000);
      return;
    }

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

      // 4. Sincronizar settings (só leitura - escrita só admin)
      const settingsUnsub = db.collection('settings')
        .doc('global')
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
          try {
            const remoteSettings = doc.data();
            const data = core.getLocalDB();
            let changed = false;

            if (remoteSettings.brand && data.settings.brand !== remoteSettings.brand) {
              data.settings.brand = remoteSettings.brand; changed = true;
            }
            if (remoteSettings.theme && data.settings.theme !== remoteSettings.theme) {
              data.settings.theme = remoteSettings.theme; changed = true;
            }
            if (remoteSettings.mode && data.settings.mode !== remoteSettings.mode) {
              data.settings.mode = remoteSettings.mode; changed = true;
            }
            if (remoteSettings.categories) {
              const localCats = JSON.stringify(data.settings.categories || []);
              const remoteCats = JSON.stringify(remoteSettings.categories);
              if (localCats !== remoteCats) {
                data.settings.categories = remoteSettings.categories; changed = true;
              }
            }

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

      // Para tasks: filtrar as que são do usuário local
      if (collectionName === 'tasks' && userId) {
        const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
        
        // Atualizar/inserir tasks remotas no local
        remoteDocs.forEach(remote => {
          const localIdx = data.tasks.findIndex(t => String(t.id) === String(remote.id));
          if (localIdx >= 0) {
            const localUpdated = data.tasks[localIdx].updatedAt || data.tasks[localIdx].createdAt || '';
            const remoteUpdated = remote.updatedAt || remote.createdAt || '';
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

      } else if (collectionName === 'posts') {
        remoteDocs.forEach(remote => {
          const localIdx = data.posts.findIndex(p => String(p.id) === String(remote.id));
          if (localIdx >= 0) {
            const rTime = remote.updatedAt || remote.publishedAt || 0;
            const lTime = data.posts[localIdx].updatedAt || data.posts[localIdx].publishedAt || 0;
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
            // Sempre atualizar files (admin pode mudar)
            if (JSON.stringify(data.files[localIdx]) !== JSON.stringify(remote)) {
              data.files[localIdx] = { ...remote, id: data.files[localIdx].id };
              hasChanges = true;
            }
          } else {
            data.files.push(remote);
            hasChanges = true;
          }
        });
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
        if (collection === 'tasks') {
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
        brand: settings.brand,
        theme: settings.theme,
        mode: settings.mode,
        categories: settings.categories || [],
        menuItems: settings.menuItems || [],
        menuOrder: settings.menuOrder || [],
        logo: settings.logo || '',
        favicon: settings.favicon || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('📤 Settings enviados ao Firestore');
    } catch (err) {
      console.warn('Erro ao enviar settings:', err.code, err.message);
    }
  }
};

window.fireSync = FireSync;

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

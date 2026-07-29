/* =========================================================
   CHECKLIST ML — firebase.js  (Parte 2/3)
   Firebase SDK via CDN — Auth + Firestore + Storage + Sync
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
firebase.initializeApp(firebaseConfig);

// Serviços
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');

// Habilitar persistência offline
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence: múltiplas abas abertas');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence: navegador não suporta');
  }
});

/* ========== FIREBASE SYNC ========== */
const FireSync = {
  _unsubscribers: [],
  _syncing: false,
  _userId: null,

  /* Iniciar sincronização para um usuário */
  async start(userId) {
    this.stop();
    this._userId = userId;
    this._syncing = true;

    console.log('🔄 FireSync iniciado para:', userId);

    // Se não há userId (usuário local), pular
    if (!userId || userId.includes('local-') || userId === 'unknown') {
      console.log('⚠️ Usuário local, FireSync não ativado');
      return;
    }

    try {
      // 1. Sincronizar tasks
      const tasksUnsub = db.collection('tasks')
        .where('owner', '==', userId)
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('tasks', snapshot, userId);
        }, err => console.warn('Tasks sync error:', err));
      this._unsubscribers.push(tasksUnsub);

      // 2. Sincronizar posts (todos os posts, não só os do usuário)
      const postsUnsub = db.collection('posts')
        .orderBy('publishedAt', 'desc')
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('posts', snapshot, null);
        }, err => console.warn('Posts sync error:', err));
      this._unsubscribers.push(postsUnsub);

      // 3. Sincronizar files
      const filesUnsub = db.collection('files')
        .onSnapshot(snapshot => {
          if (!this._syncing) return;
          this._handleCollectionSync('files', snapshot, null);
        }, err => console.warn('Files sync error:', err));
      this._unsubscribers.push(filesUnsub);

      // 4. Sincronizar settings
      const settingsUnsub = db.collection('settings')
        .doc('global')
        .onSnapshot(doc => {
          if (!this._syncing || !doc.exists) return;
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
        }, err => console.warn('Settings sync error:', err));
      this._unsubscribers.push(settingsUnsub);

    } catch (err) {
      console.error('Erro ao iniciar FireSync:', err);
    }
  },

  /* Para todos os listeners */
  stop() {
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch(e) {}
    });
    this._unsubscribers = [];
    this._syncing = false;
    this._userId = null;
    console.log('🛑 FireSync parado');
  },

  /* Sincronizar uma coleção inteira */
  _handleCollectionSync(collectionName, snapshot, userId) {
    const data = core.getLocalDB();
    const remoteDocs = [];
    let hasChanges = false;

    snapshot.forEach(doc => {
      const remoteData = doc.data();
      remoteDocs.push({ id: doc.id, ...remoteData });
    });

    // Para tasks: filtrar as que são do usuário local
    if (collectionName === 'tasks' && userId) {
      // Remover tasks locais que estão no Firestore (substituir)
      const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
      
      // Atualizar/inserir tasks remotas no local
      remoteDocs.forEach(remote => {
        const localIdx = data.tasks.findIndex(t => String(t.id) === String(remote.id));
        if (localIdx >= 0) {
          // Atualizar se o remoto é mais recente
          const localUpdated = data.tasks[localIdx].updatedAt || data.tasks[localIdx].createdAt || '';
          const remoteUpdated = remote.updatedAt || remote.createdAt || '';
          if (remoteUpdated > localUpdated) {
            data.tasks[localIdx] = { ...remote, id: data.tasks[localIdx].id };
            hasChanges = true;
          }
        } else {
          // Nova task do remoto
          data.tasks.push(remote);
          hasChanges = true;
        }
      });

      // Subir tasks locais que não estão no remoto
      const localTasksToPush = data.tasks.filter(t => 
        t.owner === userId && !remoteIds.has(String(t.id))
      );
      this._pushLocalToFirestore('tasks', localTasksToPush, userId);

    } else if (collectionName === 'posts') {
      // Mesclar posts (remotos têm prioridade)
      const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
      
      remoteDocs.forEach(remote => {
        const localIdx = data.posts.findIndex(p => String(p.id) === String(remote.id));
        if (localIdx >= 0) {
          if ((remote.updatedAt || remote.publishedAt || 0) > (data.posts[localIdx].updatedAt || data.posts[localIdx].publishedAt || 0)) {
            data.posts[localIdx] = { ...remote, id: data.posts[localIdx].id };
            hasChanges = true;
          }
        } else {
          data.posts.push(remote);
          hasChanges = true;
        }
      });

    } else if (collectionName === 'files') {
      const remoteIds = new Set(remoteDocs.map(d => String(d.id)));
      
      remoteDocs.forEach(remote => {
        const localIdx = data.files.findIndex(f => String(f.id) === String(remote.id));
        if (localIdx >= 0) {
          data.files[localIdx] = { ...remote, id: data.files[localIdx].id };
          hasChanges = true;
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
  },

  /* Push local data to Firestore */
  async _pushLocalToFirestore(collection, items, userId) {
    const batch = db.batch();
    let count = 0;

    for (const item of items) {
      const docRef = db.collection(collection).doc(String(item.id));
      const docData = { ...item };
      // Garantir que createdAt seja um timestamp do Firestore se não existir
      if (typeof docData.createdAt === 'string') {
        docData.createdAt = firebase.firestore.Timestamp.fromDate(new Date(docData.createdAt));
      }
      if (docData.updatedAt && typeof docData.updatedAt === 'string') {
        docData.updatedAt = firebase.firestore.Timestamp.fromDate(new Date(docData.updatedAt));
      }
      batch.set(docRef, docData, { merge: true });
      count++;
      if (count >= 500) break; // Limite do batch
    }

    if (count > 0) {
      try {
        await batch.commit();
        console.log(`📤 ${count} ${collection} enviados ao Firestore`);
      } catch (err) {
        console.warn(`Erro ao enviar ${collection}:`, err);
      }
    }
  },

  /* Push manual de um documento */
  async pushDocument(collection, id, dataObj) {
    try {
      const docData = { ...dataObj };
      if (typeof docData.createdAt === 'string' && docData.createdAt) {
        docData.createdAt = firebase.firestore.Timestamp.fromDate(new Date(docData.createdAt));
      }
      docData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      
      await db.collection(collection).doc(String(id)).set(docData, { merge: true });
      console.log(`📤 ${collection}/${id} enviado ao Firestore`);
      return true;
    } catch (err) {
      console.warn(`Erro ao enviar ${collection}/${id}:`, err);
      return false;
    }
  },

  /* Push settings to Firestore */
  async pushSettings(settings) {
    try {
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
      console.warn('Erro ao enviar settings:', err);
    }
  }
};

window.fireSync = FireSync;

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

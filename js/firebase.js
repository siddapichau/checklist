/* =========================================================
   CHECKLIST ML — firebase.js  (Parte 1/3)
   Firebase SDK via CDN — Auth + Firestore + Storage
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

console.log('🔥 Firebase inicializado — projeto:', firebaseConfig.projectId);

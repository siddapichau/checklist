/* =========================================================
   CHECKLIST ML — seed.js (v19 - Firebase Only)
   NÃO cria mais usuários locais. Todo login é via Firebase Auth.
   Este arquivo apenas garante que, se Firestore responder, nada de seed
   é criado. Se offline sem Firebase, mostra mensagem para o usuário
   fazer login quando voltar online, pois não há fallback local.

   Antes v16 criava admin-001 local — removido em v19 para atender
   requisito "login apenas pelo firebase sem local. tudo 100% firebase".
   ========================================================= */

const Seed = {
  async init() {
    console.log('🌱 Seed v19 - Firebase Only: nenhum usuário local será criado. Todo acesso via Firebase Auth + reCAPTCHA Enterprise.');

    // Garantir que não existam usuários locais legacy que conflitem
    try {
      const raw = localStorage.getItem(core._localKey);
      if (raw) {
        const existing = JSON.parse(raw);
        const hasLocalLegacy = (existing.users || []).some(u => String(u.id || '').startsWith('local-') || String(u.id || '') === 'admin-001');
        if (hasLocalLegacy) {
          console.log('🧹 Removendo usuários locais legacy (admin-001, local-...), mantendo apenas perfis Firebase no cache');
          existing.users = (existing.users || []).filter(u => {
            const id = String(u.id || u.uid || '');
            // Manter apenas usuários que parecem Firebase UID (não local, não admin-001)
            return !id.startsWith('local-') && id !== 'admin-001' && !id.includes('checklist.local');
          });
          // Se sobrar user com passHash, remover hashes (não devem ir pra nuvem)
          existing.users.forEach(u => { delete u.passHash; delete u.pass; delete u.secretQuestion; delete u.secretAnswerHash; });
          localStorage.setItem(core._localKey, JSON.stringify(existing));
        }
      }
    } catch (e) { console.warn('Seed cleanup erro:', e); }

    // Se Firestore tem dados ou Auth está logado, nada a fazer
    const fireRef = (window.parent && window.parent !== window && window.parent.fireSync)
      ? window.parent.fireSync
      : (window.fireSync || null);
    if (fireRef && typeof fireRef.isAvailable === 'function') {
      try {
        const hasRemote = await fireRef.isAvailable();
        if (hasRemote) {
          console.log('🌱 Firestore disponível — seed dispensado (100% Firebase).');
          return;
        }
      } catch (e) {}
    }
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      try {
        const auth = firebase.auth();
        if (auth && auth.currentUser) {
          console.log('🌱 Firebase Auth tem usuário ativo — seed dispensado.');
          return;
        }
      } catch (e) {}
    }

    // Online sem usuário: não criar nada, apenas garantir estrutura default vazia
    try {
      const data = core.getLocalDB();
      if (!data.users || !Array.isArray(data.users)) data.users = [];
      if (!data.tasks) data.tasks = [];
      core.saveLocalDB(data);
    } catch(e) {}

    console.log('✅ Seed concluído (nenhum usuário local criado — use Firebase Auth).');
  }
};

// Executar ao carregar
Seed.init();

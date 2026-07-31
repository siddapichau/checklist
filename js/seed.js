/* =========================================================
   CHECKLIST ML — seed.js
   Dados iniciais — executado automaticamente no primeiro acesso

   IMPORTANTE (v16):
   Não criamos mais "atividades de exemplo" no seed. O usuário pediu
   explicitamente: nada de atividades pré-programadas no APK — apenas as
   que ele criar (vindas do Firestore ou cadastradas agora) devem aparecer.

   O que ainda é criado (somente se NADA existir no DB local e o Firestore
   também não responder, ex.: primeiro acesso offline antes do login):
     • Conta admin padrão (login "admin" / senha "Admin@1234") — apenas
       para entrar pela primeira vez. O usuário pode trocar a senha depois.
     • 2 posts de "boas-vindas" (somente texto, não criam atividades).

   Se já existir QUALQUER usuário no DB local OU o Firestore responder, o
   seed inteiro é pulado — o app vai usar o que vier do banco.
   ========================================================= */

const Seed = {
  async init() {
    // 1) DB local já tem usuário? → nada de seed.
    try {
      const raw = localStorage.getItem(core._localKey);
      if (raw) {
        const existing = JSON.parse(raw);
        if ((existing.users || []).length > 0) return;
      }
    } catch (e) {}

    // 2) Firestore tem dados deste ambiente? → seed dispensado.
    //    O FireSync (no shell) trará as atividades reais do usuário.
    //    Aqui checamos via window.firebase (SDK carregado pelo index.html).
    //    O seed roda no escopo do index.html (não dentro de iframe de página),
    //    então window.parent === window e o fireSync vive em window.
    const fireRef = (window.parent && window.parent !== window && window.parent.fireSync)
      ? window.parent.fireSync
      : (window.fireSync || null);
    if (fireRef && typeof fireRef.isAvailable === 'function') {
      try {
        const hasRemote = await fireRef.isAvailable();
        if (hasRemote) {
          console.log('🌱 Firestore disponível — seed dispensado (atividades vêm do banco).');
          return;
        }
      } catch (e) {}
    }
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      try {
        const auth = firebase.auth();
        // Se já existe alguém logado no Firebase Auth, o FireSync trará as
        // atividades desse usuário — não há motivo para semear.
        if (auth && auth.currentUser) {
          console.log('🌱 Firebase Auth tem usuário ativo — seed dispensado.');
          return;
        }
      } catch (e) {}
    }

    console.log('🌱 Inicializando dados padrão (somente conta admin)…');

    const data = JSON.parse(JSON.stringify(core._defaults));

    // Admin padrão: login "admin" / senha "Admin@1234". SEM atividades de exemplo.
    const adminHash = await core.hashPassword('Admin@1234');
    data.users = [{
      id: 'admin-001',
      uid: 'admin-001',
      username: 'admin',
      user: 'admin',
      email: 'admin@checklist.local',
      passHash: adminHash,
      name: 'Administrador',
      lastName: '',
      phone: '',
      address: '',
      avatar: '⚙️',
      avatarType: 'emoji',
      role: 'admin',
      banned: false,
      provider: 'local',
      createdAt: core.now()
    }];

    // SEM tarefas pré-programadas. data.tasks fica vazio (já é [] nos defaults).
    data.tasks = [];

    // Posts de boas-vindas (somente texto, sem atividades).
    data.posts = [
      {
        id: 1, title: 'Bem-vindo ao Checklist ML!',
        body: 'Este é o seu novo sistema de gestão operacional. Organize suas atividades diárias, acompanhe pendências e mantenha tudo sob controle.\n\n- Use o botão "Nova atividade" para criar tarefas\n- Configure temas e preferências em Administração\n- A IA pode ajudar a priorizar suas atividades',
        category: 'Geral',
        author: 'Administrador',
        publishedAt: Date.now()
      },
      {
        id: 2, title: 'Dica: use recorrência para atividades diárias',
        body: 'Ao criar atividades que se repetem todo dia (como conferência de abertura), marque a recorrência como "Diária" para não precisar recriar.',
        category: 'Dicas',
        author: 'Administrador',
        publishedAt: Date.now() - 86400000
      }
    ];

    // Logs iniciais
    data.logs = [
      { id: core.genId(), action: 'system_init', userId: 'system', details: 'Sistema inicializado', timestamp: core.now() }
    ];

    core.saveLocalDB(data);
    console.log('✅ Conta admin criada. Login: admin / Admin@1234 (sem atividades pré-programadas).');
  }
};

// Executar ao carregar
Seed.init();

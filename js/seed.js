/* =========================================================
   CHECKLIST ML — seed.js
   Dados iniciais — executado automaticamente no primeiro acesso
   ========================================================= */

const Seed = {
  async init() {
    const raw = localStorage.getItem(core._localKey);
    if (raw) return; // Já existe dados, não fazer seed

    console.log('🌱 Inicializando dados padrão...');

    const data = JSON.parse(JSON.stringify(core._defaults));

    // Admin padrão com senha hasheada
    const adminHash = await core.hashPassword('Admin@1234');
    data.users = [{
      id: 'admin-001',
      uid: 'admin-001',
      username: 'admin',
      user: 'admin',
      email: 'admin@checklist.local',
      passHash: adminHash,
      pass: 'Admin@1234', // fallback para compatibilidade
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

    // Atividades de exemplo
    const today = core.today();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);

    data.tasks = [
      {
        id: 1, title: 'Conferir abertura do turno',
        description: 'Verificar documentação e equipamentos de abertura',
        status: 'pending', date: today, priority: 'high',
        category: 'Operação', owner: 'admin-001',
        recurrence: 'daily', createdAt: core.now()
      },
      {
        id: 2, title: 'Verificar equipamentos de segurança',
        description: 'Checklist de EPIs e equipamentos de proteção',
        status: 'analyzing', date: today, priority: 'medium',
        category: 'Segurança', owner: 'admin-001',
        recurrence: 'daily', createdAt: core.now()
      },
      {
        id: 3, title: 'Inspeção de empilhadeiras',
        description: 'Verificar nível de combustível, freios e pneus',
        status: 'pending', date: today, priority: 'high',
        category: 'Manutenção', owner: 'admin-001',
        recurrence: 'daily', createdAt: core.now()
      },
      {
        id: 4, title: 'Conferir estoque do setor A',
        description: 'Inventário rápido do setor de picking',
        status: 'pending', date: tomorrow.toISOString().slice(0, 10), priority: 'medium',
        category: 'Logística', owner: 'admin-001',
        createdAt: core.now()
      },
      {
        id: 5, title: 'Relatório de produtividade',
        description: 'Compilar dados de produtividade do dia anterior',
        status: 'finished', date: yesterday.toISOString().slice(0, 10), priority: 'low',
        category: 'Qualidade', owner: 'admin-001',
        finishedAt: core.now(), createdAt: core.now()
      },
      {
        id: 6, title: 'Reunião de alinhamento',
        description: 'Reunião semanal com equipe',
        status: 'pending', date: yesterday.toISOString().slice(0, 10), priority: 'medium',
        category: 'RH', owner: 'admin-001',
        recurrence: 'weekly', createdAt: core.now()
      },
    ];

    // Posts de exemplo
    data.posts = [
      {
        id: 1, title: 'Bem-vindo ao Checklist ML!',
        body: 'Este é o seu novo sistema de gestão operacional. Organize suas atividades diárias, acompanhe pendências e mantenha tudo sob controle.\n\n- Use o botão "Nova atividade" para criar tarefas\n- Configure temas e preferências em Administração\n- A IA pode ajudar a priorizar suas atividades',
        category: 'Geral',
        author: 'Administrador',
        publishedAt: Date.now()
      },
      {
        id: 2, title: 'Dica: Use recorrência para atividades diárias',
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
    console.log('✅ Dados padrão criados! Login: admin / Admin@1234');
  }
};

// Executar ao carregar
Seed.init();

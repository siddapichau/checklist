## Descrição

Implementações solicitadas pelo usuário:

1. **🤖 IA funcionando de verdade**: a chamada direta ao DeepSeek era bloqueada pelo navegador (CORS — `Failed to fetch`, mesmo com API Key válida). Agora a IA tenta **conexão direta → proxy CORS** automaticamente, com timeout, mensagens de erro decodificadas (401/402/429/5xx com instruções) e **modo de conexão configurável** (Automático/Direto/Proxy) em *Administração → API / IA*. Adicionado botão **"🔌 Testar conexão"** na página da IA e no Admin, com diagnóstico passo a passo (chave → canal direto → proxy).
2. **🏷️ Categorias por caixa marcável**: o `<select multiple>` foi substituído por **chips com checkbox** com design destacado ao selecionar (multi-seleção, com override das regras globais de `label span`).
3. **⏰ Horário de alerta por atividade**: novo campo de horário no formulário; monitor no shell (a cada 30s) dispara **alerta estilo Chrome + notificação do navegador + central de notificações** no dia/hora marcados, com dedupe.
4. **📇 Cards compactos separados por status**: lista de atividades virou grade de cards pequenos agrupados por ⏰ Atrasadas → 🔍 Analisando → ⏳ Pendentes → ✅ Finalizadas → ❌ Não realizadas, com chips de data/alerta/categorias/recorrência e ações rápidas. Corrigido também o filtro de categoria para tarefas multi-categoria e IDs de tarefas string (bug latente nos handlers de clique).
5. **🖥️ Menu no topo no desktop**: instead of sidebar fixa, o desktop (≥1025px) usa **barra superior com dropdowns agrupados** (Operação, Produtividade, Recursos, Ferramentas, Sistema), abrindo no hover ou clique, com badge de atrasadas no grupo — ganhando ~260px de largura para os dados. No mobile continua a gaveta lateral. Bônus: correção do overlay da sidebar no mobile (não abria/fechava + tela escura permanente em ≤700px).

### Arquivos alterados:
- `index.html`: topbar com marca, menu superior (`#topnav`) e botão "Nova atividade"
- `css/style.css`: estilos do menu superior com dropdowns, responsividade 1024px, fix do overlay mobile
- `css/page.css`: chips de categoria por checkbox, cards compactos de atividades agrupados por status
- `js/app.js`: renderTopnav/groups, dropdowns, **monitor de alertas** de atividades, fix navegação
- `js/firebase.js`: `aiMode` em get/saveAdminConfig (merge — não apaga a chave), `getAIMode()`
- `js/page.js`: passthrough `getAIMode()`
- `pages/IA.html`: cadeia direto→proxy, timeout, erros decodificados, teste de conexão, status da IA
- `pages/admin.html`: seletor de modo de conexão + botão testar conexão na aba API / IA
- `pages/atividades.html`: categorias por checkbox, campo de horário de alerta, cards compactos por status
- `locales/*.json`: rótulos dos grupos de menu (pt-BR/en/es)
- `service-worker.js`: bump de cache para `v12-topnav-ia`

### Testes realizados (Node + stubs):
- ✅ Monitor de alertas: dispara 1x por tarefa/dia/horário, dedupe, ignora finalizadas/outros donos/futuras, prune de markers
- ✅ IA: 3 tentativas no modo auto, fallback CORS→proxy, 401 fatal interrompe cadeia, hints de erro
- ✅ Atividades: ordem dos grupos, chips de alerta/categoria, finalizada sem alerta, filtros status/categoria/atrasadas
- ✅ Menu top: grupos por perfil (admin vê "Painel Admin", membro não), badges, has-active

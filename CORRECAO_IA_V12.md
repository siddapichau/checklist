# 🔧 Correção v12 — IA offline, menu no topo, alertas e cards de atividades

## O que estava acontecendo

1. **IA não funcionava**: a página `pages/IA.html` chamava o DeepSeek diretamente
   no navegador (`fetch('https://api.deepseek.com/...')`). A API do DeepSeek
   não retorna cabeçalho `Access-Control-Allow-Origin`, então o navegador
   **bloqueia a chamada com erro de CORS** (`Failed to fetch`) antes dela chegar
   ao servidor — mesmo com a API Key correta salva no banco.
2. **Categoria difícil de marcar**: seleção era um `<select multiple>` ruim de usar.
3. **Sem horário de alerta**: atividades não tinham campo para agendar aviso.
4. **Lista de atividades em cards compridos**: ocupava a tela toda com poucos itens
   visíveis e sem separação visual por status.
5. **Menu lateral no desktop**: desperdiçava ~260px de largura o tempo todo.

## ✅ O que foi corrigido

### 1. IA com fallback via proxy CORS + diagnóstico (`pages/IA.html`, `js/firebase.js`, `pages/admin.html`)
- Nova cadeia de tentativas: **conexão direta → proxy CORS** (contorna o bloqueio
  do navegador). Timeout de 45s por tentativa.
- **Modo de conexão configurável** em *Administração → API / IA*:
  `Automático` (padrão), `Direto`, `Proxy`. Salvo em `settings/admin` no Firestore.
- **Erros decodificados**: 401 (chave inválida), 402 (sem saldo), 429 (limite),
  5xx (servidor instável) com instrução de como resolver cada um.
- **Botão "🔌 Testar conexão"** na página da IA e na aba Admin: testa chave,
  canal direto e proxy, mostrando exatamente em qual etapa está falhando.
- `saveAdminConfig` agora faz *merge*: salvar só o modo não apaga a chave.

### 2. Categorias por caixa marcável (`pages/atividades.html`, `css/page.css`)
- Substitui o select múltiplo por **chips com checkbox** (caixa marcável), com
  destaque visual ao selecionar. Suporta múltiplas categorias por atividade.

### 3. Horário de alerta por atividade (`pages/atividades.html`, `js/app.js`)
- Novo campo **⏰ Horário do alerta** no formulário da atividade.
- Monitor no shell verifica a cada 30s: atividade do dia + horário atingido →
  dispara **alerta estilo Chrome** + notificação do navegador + entrada na
  central de notificações (com dedupe e limpeza de marcadores antigos).

### 4. Cards compactos separados por status (`pages/atividades.html`, `css/page.css`)
- Lista em **grade responsiva de cards pequenos** (~235px) agrupados por:
  ⏰ Atrasadas → 🔍 Analisando → ⏳ Pendentes → ✅ Finalizadas → ❌ Não realizadas.
- Cada card mostra: prioridade (dot), título, data, ⏰ alerta, categorias,
  recorrência e ações rápidas (status, comentários, compartilhar, editar, excluir).

### 5. Menu no topo no desktop (`index.html`, `css/style.css`, `js/app.js`)
- No desktop (≥1025px) a sidebar some e o menu vai para o **topo**, agrupado em
  dropdowns: **Operação, Produtividade, Recursos, Ferramentas, Sistema**
  (abrem no hover ou no clique; badge de atrasadas aparece no grupo).
- No mobile/tablet (≤1024px) continua a **gaveta lateral** com hambúrguer.
- Correção bônus: overlay da sidebar não cobria/fechava corretamente no mobile
  (classe `open` não tinha CSS correspondente) e ficava permanentemente escuro
  em telas ≤700px.

## 📋 Deploy
- **Firestore rules**: nenhuma alteração necessária (o documento `settings/admin`
  já é lido por usuários autenticados; `aiMode` é um campo novo dentro do mesmo doc).
- Após o merge, o service worker `v12` atualiza automaticamente o cache dos clientes.

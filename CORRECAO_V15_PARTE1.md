# v15 — Parte 1/2: Tema por usuário • Dashboard com filtro • Relatórios modernos

> Pedido dividido em **2 partes** para não perder trabalho no meio do caminho.
> Esta é a **Parte 1**. A **Parte 2** (IA de ajuda, Notas como lembrete, Macros
> com e-mail e campos c1–c10) continua em um novo chat — veja o prompt no fim.

## ✅ O que entrou nesta Parte 1

### 1) 🎨 Tema por usuário (cada um escolhe o seu)
**Problema:** depois de um tempo o tema de todos travava no tema selecionado no
Admin. **Causa:** `theme`/`mode` vinham do documento **global** (`settings/global`)
e o sync sobrescrevia a escolha de cada pessoa.

**Correção:**
- `theme`/`mode` deixam de ser sincronizados do global — viram **preferência por
  usuário** (salva por conta no `localStorage` por `uid` **e** no perfil do
  Firestore, sincronizando entre dispositivos).
- O tema do Admin passa a ser apenas o **padrão** (`defaultTheme`/`defaultMode`)
  para quem **nunca escolheu** — nunca força o tema de ninguém.
- **Primeira vez:** o modo segue o **sistema operacional** (claro/escuro, via
  `prefers-color-scheme`) e usa o tema padrão do Admin. Depois, fica exatamente
  o que o usuário escolher.
- Escolhas em **Personalizar** e no **Admin** agora são salvas e sincronizadas.

Arquivos: `js/app.js`, `js/core.js` (`resolveTheme`, `getUserThemePref`,
`setUserThemePref`, `systemPrefersDark`), `js/firebase.js`, `pages/admin.html`,
`firestore.rules` (permite `mode` e `updatedAt` na atualização do próprio perfil).

### 2) 📊 Dashboard com filtro (Dia / Semana / Mês) — sempre do dia atual para trás
**Problema:** atividade de dia futuro aparecia como “pendente”.

**Correção:**
- Novo filtro **Dia / Semana / Mês** com a faixa de datas visível (persistido).
- Métricas e listas passam a refletir o período escolhido.
- Removida a lista de “próximas atividades” (que trazia o futuro): agora mostra
  as atividades **do período**, do mais recente para o mais antigo.
- **Nunca** considera datas futuras (o fim do período é sempre **hoje**).

Arquivos: `pages/home.html`.

### 3) 📈 Relatórios modernos e profissionais
**Problema:** página “muito feia”; os gráficos recebiam `var(--...)` como cor
(o Chart.js não entende variável CSS), quebrando cores — principalmente no escuro.

**Correção:**
- Hero em gradiente, **KPIs** em cards modernos, cards de gráfico com sombra/hover.
- Cores agora seguem o **tema real** (lemos o valor computado do CSS) — funciona
  no claro e no escuro; **re-renderiza** ao trocar tema/modo do sistema.
- Padrões globais do Chart.js (fonte, tooltip arredondado, legendas com pontos),
  **gradientes** em barras/áreas e bordas de donut acompanhando o card.
- **Filtro de período** (7/30/90 dias/Tudo) sempre do dia atual para trás; as
  tendências semanal (7d) e mensal (6m) usam o histórico completo.

Arquivos: `pages/relatorios.html`.

## ⚠️ Passo manual (Firebase)
Publicar o `firestore.rules` atualizado no Console do Firebase — ele agora permite
que cada usuário salve `mode`/`updatedAt` no próprio perfil (necessário para o
tema por usuário sincronizar entre dispositivos).

## 🧪 Validação
- `node --check` em `js/app.js`, `js/core.js`, `js/firebase.js`.
- Scripts inline de `home.html`, `relatorios.html`, `admin.html`, `custom.html`.
- Teste do resolvedor de tema (primeira vez → sistema; depois → escolha; padrão
  do admin como fallback; perfil sincronizado).
- Execução real do `render()` dos Relatórios com DOM/Chart mockados + teste do
  filtro de período confirmando que **datas futuras nunca aparecem** em nenhum
  período (7/30/90/Tudo).

Sem navegador/Playwright na sandbox: cliques reais e screenshots não foram
executados; a validação foi por sintaxe, execução mockada e análise de fluxo.

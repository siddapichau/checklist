# v15 — Parte 2/2: 🤖 Ajuda por página • Notas como lembretes • Macros com e-mail e c1–c10

> Continuação da v15. A **Parte 1** (tema por usuário, dashboard com filtro
> Dia/Semana/Mês, relatórios modernos) está em `CORRECAO_V15_PARTE1.md` e no
> PR #24. Esta é a **Parte 2**, no PR desta branch.

## ✅ O que entrou nesta Parte 2

### 4) 🤖 IA de ajuda em cada página — botão contextual "Ajuda desta página"
**Problema:** a IA existia só na página "IA Assistente"; nas demais páginas o
usuário não tinha dicas nem como tirar dúvidas sobre o funcionamento.

**Solução:** novo `js/help-ai.js` (`window.PageHelpAI`), integrado nas **14
páginas** do app:
- **Botão flutuante "🤖 Ajuda desta página"** no canto inferior direito de cada
  página. Abre um painel que **já entra sabendo em qual página está** e o que
  ela faz.
- O painel tem: explicação local **"Como esta página funciona"** (seções
  escritas por página), **💡 Dicas rápidas**, **perguntas rápidas** e um campo
  para **perguntar à IA** com o contexto da página (dados ao vivo: totais,
  pendentes, atrasadas etc. entram no prompt).
- Usa a **mesma cadeia de conexão do `js/ai.js`** (DeepSeek/Groq, proxy próprio
  → direto → proxies públicos). Sem chave ou offline, responde com o **guia
  local** da página (nunca fica mudo). Botão "📋 Copiar guia" em qualquer caso.
- Cada página tem descrição, seções, dicas e perguntas específicas escritas:
  home, atividades, kanban, calendario, notas, macros, foco, gamificacao,
  arquivos, IA, perfil, admin, custom, relatorios.

Arquivos: `js/help-ai.js` (novo) + `pages/*.html` (14 páginas).

### 5) 📝 Notas viram lembretes
**Problema:** a nota tinha lembrete opcional, podia ser apagada em massa pelo
admin e não havia acompanhamento de "feita".

**Correção (`pages/notas.html`):**
- **A data/hora da nota É a hora do aviso.** Removida a caixa "lembrar-me": com
  hora preenchida o lembrete fica ativo automaticamente (`remind = !!time`);
  migração converte notas antigas com hora.
- **A nota só é excluída manualmente.** Removida a limpeza automática
  "apagar notas antigas (30+ dias)" do Painel Admin.
- **Ao entrar, o usuário vê as notas que vão vir/atuais** (aba padrão
  "⏳ Vão vir / Atuais" = data de hoje ou futura) e há a aba **"✅ Já passadas"**
  para ver as vencidas.
- **Cada nota pode ser marcada como feita** (botão ✅/↩️ no card e no modal de
  visualização). **Se vencer sem ser feita, fica pendente** — a aba passada
  separa em "🔴 Pendentes" e "✅ Feitas"; card pendente com borda vermelha,
  feita esmaecida/riscada; chip de status (A vir / Hoje / Pendente / Feita) em
  todo lugar (cards, modal, calendário, compartilhar).
- Monitor de lembretes (`js/app.js`) não dispara mais para notas já feitas.

Arquivos: `pages/notas.html`, `pages/admin.html`, `js/app.js`.

### 6) 📧 Macro com e-mail
**Solução (`pages/macros.html`):**
- Novo seletor **"Tipo de modelo": 📄 Mensagem / 📧 E-mail** no editor.
- No tipo e-mail aparecem **"E-mails de destino"** (vários, separados por
  vírgula/espaço/;) e **"Assunto do e-mail"** — salvos na macro.
- No modal "Usar macro" de uma macro de e-mail: botão **"📧 Mandar e-mail"** que
  abre o **Gmail já pré-preenchido** (`mail.google.com/?view=cm&fs=1&to=…&su=…`
  → destinatários + assunto) e **copia o corpo para a área de transferência**,
  pronto para **Ctrl+V** (o Gmail não permite pré-preencher o corpo pela URL).

### 7) ⚙️ Macro com campos c1–c10
**Solução (`pages/macros.html`):**
- **Cada macro tem 10 campos (c1 a c10)**: no editor, chips `{c1}`…`{c10}`
  para inserir no texto + 10 campos com valores padrão opcionais (prévia ao
  vivo no editor).
- Ao **usar** a macro, os 10 campos aparecem (abertos quando a macro usa
  `{cN}`), já preenchidos com os padrões; **preenchendo `{c10}`, por exemplo,
  a informação entra no texto final** no lugar de `{c10}`.
- Na prévia, campo vazio fica destacado; na cópia, vazio mantém o marcador
  (mesmo comportamento das variáveis `{{...}}`).
- A lista de macros mostra o tipo (📧) e os campos c usados.

Arquivos: `pages/macros.html`.

## Arquivos
| Tipo | Arquivos |
|---|---|
| Novo | `js/help-ai.js`, `CORRECAO_V15_PARTE2.md` |
| Alterados | `pages/*.html` (14 páginas: widget de ajuda), `pages/notas.html`, `pages/admin.html`, `pages/macros.html`, `js/app.js`, `service-worker.js` (cache `v15` + `js/help-ai.js` no precache) |

## 🧪 Validação
- `node --check` em `js/help-ai.js`, `js/app.js` e nos scripts inline das 14
  páginas — 0 erros.
- Teste funcional do widget de ajuda (montar, abrir, pergunta rápida, pergunta
  à IA com fallback local, copiar guia) com DOM simulado — OK.
- Teste funcional de Notas: migração (hora → lembrete, `done`), status
  (Feita/Pendente/Hoje/A vir), abas "Vão vir / Atuais" vs "Já passadas",
  agrupamento (Pendentes/Feitas), `toggleDone` + sincronização, card com
  classe/estado correto — OK.
- Teste funcional de Macros: substituição `{c1}`–`{c10}` e `{{vars}}`,
  `extractCFields`, `insertVar` ({cN} vs {{var}}), modal de uso (e-mail +
  campos c), `getUseValues`, `sendEmailMacro` (URL do Gmail com to/su + corpo
  copiado), `saveMacro` persistindo `type/recipients/subject/cfields` — OK.

Sem navegador/Playwright na sandbox: cliques reais e screenshots não foram
executados; a validação foi por sintaxe, execução mockada e análise de fluxo
(mesmo padrão da Parte 1).

## ⚠️ Observação (sem ação manual)
- `firestore.rules` **não precisou mudar** nesta parte: as regras de `notes`
  e `macros` já permitem ao dono atualizar os próprios documentos (novos
  campos `done`, `type`, `recipients`, `subject`, `cfields` passam por elas).
- Basta republicar o app (a atualização do `service-worker.js` para `v15`
  limpa o cache antigo sozinha).

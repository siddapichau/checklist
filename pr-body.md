# v15 — Parte 2/2: 🤖 Ajuda por página • Notas como lembretes • Macros com e-mail e c1–c10

> Parte 2 da v15. A **Parte 1** (tema por usuário, dashboard com filtro
> Dia/Semana/Mês, relatórios modernos) já está no PR #24 (merged).

## O que muda

### 4) 🤖 IA de ajuda em cada página — botão contextual "Ajuda desta página"
- Novo `js/help-ai.js`: **botão flutuante "🤖 Ajuda desta página"** em **todas
  as 14 páginas**, que já entra sabendo qual página é e o que ela faz.
- Painel com **"Como esta página funciona"** (guia local por página, sempre
  disponível), **💡 Dicas rápidas**, **perguntas rápidas** e campo para
  **perguntar à IA** com contexto ao vivo da página (totais, pendentes,
  atrasadas vão no prompt).
- Usa a **mesma IA do app** (`js/ai.js`: DeepSeek/Groq via proxy próprio →
  direto → proxies públicos). Sem chave/offline responde com o guia local;
  botão "📋 Copiar guia".

### 5) 📝 Notas viram lembretes
- **A data/hora da nota é a hora do aviso**: com hora preenchida o lembrete
  fica ativo automaticamente (caixa "lembrar-me" removida; migração de notas
  antigas).
- **A nota só é excluída manualmente**: removida a limpeza automática de
  "notas antigas 30+ dias" do Admin.
- **Ao entrar, o usuário vê as notas que vão vir/atuais** (aba padrão) e tem a
  aba **"✅ Já passadas"**.
- **Cada nota pode ser marcada como feita** (✅/↩️ no card e no modal); **se
  vencer sem ser feita, fica pendente** — aba passada separa em 🔴 Pendentes e
  ✅ Feitas; chips de status em cards, modal, calendário e compartilhar.
- Monitor de lembretes não dispara para notas já feitas.

### 6) 📧 Macro com e-mail
- Novo tipo de modelo **📄 Mensagem / 📧 E-mail** no editor.
- No tipo e-mail: campos **"E-mails de destino"** e **"Assunto do e-mail"**.
- Botão **"📧 Mandar e-mail"** no modal de uso: abre o **Gmail já
  pré-preenchido** (destinatários + assunto) e **copia o corpo** — é só colar
  com **Ctrl+V**.

### 7) ⚙️ Macro com campos c1–c10
- **Cada macro tem os 10 campos (c1 a c10)**: chips `{c1}`…`{c10}` no editor +
  10 campos com valores padrão opcionais.
- Ao usar, os 10 campos aparecem preenchidos com os padrões; **`{c10}` no
  texto recebe o valor do campo c10** no texto final (prévia destaca campo
  vazio; cópia mantém o marcador, como nas variáveis `{{...}}`).
- Lista de macros mostra tipo (📧) e campos c usados.

## Arquivos
| Tipo | Arquivos |
|---|---|
| Novo | `js/help-ai.js`, `CORRECAO_V15_PARTE2.md` |
| Alterados | `pages/*.html` (14 páginas — widget de ajuda), `pages/notas.html`, `pages/admin.html`, `pages/macros.html`, `js/app.js`, `service-worker.js` (cache `v15` + precache do `js/help-ai.js`) |

## ✅ Validação
- `node --check` em `js/help-ai.js`, `js/app.js` e scripts inline das **14
  páginas** — 0 erros.
- Testes funcionais com DOM simulado: widget de ajuda (abrir, perguntas,
  fallback local, copiar guia); Notas (migração, status Feita/Pendente/Hoje/A
  vir, abas, agrupamento, `toggleDone` + sync); Macros (substituição
  `{cN}`/`{{var}}`, `extractCFields`, modal de uso, `sendEmailMacro` com URL
  Gmail to/su + corpo copiado, `saveMacro` persistindo os campos novos) — OK.

Sem navegador/Playwright na sandbox: cliques reais e screenshots não foram
executados (mesmo padrão da Parte 1); validação por sintaxe, execução mockada
e análise de fluxo.

# v14 — IA com diagnóstico de regras • botões 🔗💬 funcionais • nova página 📝 Notas & Recados

## O que muda

### 🤖 IA — mostra a causa real de "não funcionar"
- O **Teste de conexão** (página IA e Admin → API / IA) agora verifica as **regras do Firestore**: se `settings/admin` não puder ser lido, diz exatamente como publicar `firestore.rules` no Console — porque é isso que impede a chave salva de chegar a outros dispositivos (ex.: o APK do celular), mesmo estando correta.
- Status da página IA ficou honesto: sem chave, distingue "falta configuração" de "regras bloqueando a leitura".

> ⚠️ **Manual**: publicar `firestore.rules` (tem as regras novas de `notes`) no Console do Firebase e manter o proxy Cloudflare configurado — instruções na aba API / IA.

### 🔗💬 Botões mortos dos cards (atividades / kanban / calendário)
**Causa-raiz**: `page.openModal()` renderiza o modal no documento pai (`index.html`), mas os handlers (`copyShareLink`, `submitComment`, `page.closeModal`...) só existem dentro do iframe — todo botão do modal era clique morto; o QR Code nunca renderizava (procurado no documento errado).
**Fix**: modais de Compartilhar e Comentários viraram locais nas 3 páginas. Copiar (Clipboard API + fallback legado), Web Share, WhatsApp, E-mail, QR com fallback offline, comentar/listar/excluir — tudo testado e funcionando. Títulos com aspas não quebram mais os handlers (lookup por id).

### 📝 Nova página: Notas & Recados
Recadinhos/lembretes diários fora das atividades (`pages/notas.html`), no menu (Operação) com tradução PT/EN/ES:
- **Título, data, hora** + 🔔 lembrete disparado pelo monitor do shell (alerta Chrome + central, com dedupe);
- **Descrição estilo blog** (`**negrito**`, `*itálico*`, listas, H2) com leitura renderizada;
- **Imagem**: galeria SVG (6 capas), **upload convertido a .webp** (máx. 1280px), ou URL;
- **Categorias próprias** por checkbox (`notesCategories`), sem misturar com atividades;
- 📌 fixar, visões 🗂️ Cards e 📅 Calendário (com dots por dia + modal do dia), filtros, copiar texto p/ compartilhar;
- **Tudo controlado do Admin**: nova aba 📝 Notas — gerir categorias, estatísticas, excluir qualquer nota, limpeza 30+ dias (preserva fixadas);
- Sync Firestore (coleção `notes`, por usuário) + regras novas em `firestore.rules` + backup/importação incluindo notas.

### ⚡ Robustez
- `applyI18n` não entra mais em **loop infinito de microtasks quando offline** (reagendava indiferente de o fetch falhar) — congelamento de aba eliminado.
- `relatorios.html`: gráficos com guarda de CDN — "Chart is not defined" não derruba mais a página; números seguem visíveis.

## Arquivos
| Tipo | Arquivos |
|---|---|
| Novos | `pages/notas.html`, `CORRECAO_V14.md`, `PROMPTS_VERIFICACAO_APK.md` |
| Alterados | `js/core.js`, `js/app.js`, `js/firebase.js`, `js/ai.js`, `pages/atividades.html`, `pages/kanban.html`, `pages/calendario.html`, `pages/admin.html`, `pages/IA.html`, `pages/relatorios.html`, `service-worker.js` (cache `v14`), `firestore.rules`, `locales/*` (3) |

## ✅ Testes (68/68 + 14 páginas)
- Migração `core.js` — 7/7
- Notas (CRUD, lembrete, imagem webp/galeria, calendário, XSS, fixar, filtros) — 29/29
- Atividades (share/comments funcionais + CRUD) — 13/13
- `ai.js` (fallback de canais, erro fatal 401, regras Firestore) — 7/7
- Alerta de nota no monitor do shell — 3/3
- Aba Admin → Notas — 9/9
- Carregamento das **14 páginas** em DOM real — **0 erros**.

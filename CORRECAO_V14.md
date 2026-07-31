# 🔧 Correção v14 — IA, botões dos cards e nova página Notas & Recados

Quatro frentes nesta versão:

1. **IA "continua sem funcionar"** — diagnóstico agora aponta a causa-raiz real.
2. **Botões 🔗 Compartilhar e 💬 Comentar dos cards não faziam nada** — modal aberto no documento errado: corrigido para SEMPRE funcionar.
3. **Nova página 📝 Notas & Recados** — recadinhos diários fora das atividades, com lembrete, imagem .webp e categorias próprias.
4. **Loop infinito offline** — a troca de idioma podia congelar a aba sem internet. Corrigido.

---

## 1. 🤖 IA — por que "a chave está salva mas a IA não funciona"

### Causas-raiz confirmadas (fora do alcance do código)

A investigação confirmou que o código da IA já estava correto; a falha está em **configuração no Console do Firebase / Cloudflare**, não no app:

- **A. Regras do Firestore desatualizadas.** A chave do DeepSeek mora em
  `settings/admin`. As regras novas (arquivo `firestore.rules` deste projeto)
  liberam a leitura desse documento para usuários autenticados. Se o arquivo
  não foi colado no Console, a chave só existe no navegador de quem salvou —
  **em qualquer outro dispositivo (como o APK do celular) a IA não acha a chave
  e cai no modo demonstração**, parecendo quebrada.
- **B. CORS do DeepSeek.** O navegador cancela chamadas diretas à API. Sem o
  proxy próprio (Cloudflare Worker, arquivo `proxy/cloudflare-worker.js`),
  restam só proxies públicos instáveis.

### O que mudou no código

- **O teste de conexão agora checa as regras do Firestore.** A primeira linha
  do diagnóstico (página IA e Painel Admin → API / IA → 🔌 Testar conexão)
  tenta LER `settings/admin` e responde:
  - ✅ regras ok, ou
  - ❌ **instrução exata**: "Console do Firebase → Firestore Database → Regras
    → cole o conteúdo de `firestore.rules` → Publicar".
- **Status da página IA ficou honesto**: quando não acha a chave, verifica se
  as regras estão bloqueando e explica em texto claro, em vez de só dizer
  "modo demonstração".

> ✅ **Ação manual necessária** (resolve de verdade os dois pontos):
> 1. Console do Firebase → Firestore Database → **Regras** → colar `firestore.rules` → **Publicar**.
> 2. Publicar `proxy/cloudflare-worker.js` (5 min, grátis) e colar a URL em
>    *Administração → API / IA → URL do proxy da IA*.

---

## 2. 🔗💬 Compartilhar e Comentar — por que os botões "morriam"

### Causa raiz (bug de arquitetura, afetava 3 páginas)

`page.openModal(html)` envia o HTML do modal para o **documento pai**
(`index.html`). Só que as funções que os botões chamam — `copyShareLink()`,
`shareWhatsApp()`, `submitComment()`, `page.closeModal()` — existem
**na página (iframe)**, não no pai. Resultado: o modal abria bonitinho, mas
**todo botão interno era clique morto** (`ReferenceError` silencioso). O mesmo
bug deixava o QR Code em branco (o código procurava `#qrCode` no documento
errado) e quebrava comentários no Kanban e no Calendário também.

### Correção

- **Atividades** (`pages/atividades.html`): Compartilhar e Comentários viraram
  **modais locais da página**. Todos os botões executam na hora:
  - 🔗 link copiável + **QR Code** (com fallback elegante se o CDN estiver offline);
  - 📱 Web Share API (celular) com **fallback de cópia** no desktop;
  - 💬 WhatsApp e 📧 e-mail com texto pronto do resumo da atividade;
  - 💬 comentar, listar e excluir comentários funcionando, com contador vivo.
- **Kanban** (`pages/kanban.html`) e **Calendário** (`pages/calendario.html`):
  os modais de comentários/detalhes receberam a mesma correção local.
- Títulos com aspas/caracteres especiais não quebram mais os handlers: o modal
  resolve a tarefa pelo **id**, sem interpolar texto em `onclick`.

---

## 3. 📝 Nova página: Notas & Recados

Arquivo novo `pages/notas.html` + item **📝 Notas** no menu (grupo Operação).
Recadinhos/lembretes diários **fora das atividades**, todos sincronizados no
Firestore (coleção `notes`, por usuário).

| Pedido | Entrega |
|---|---|
| Título, data e hora | ✅ campos dedicados; validação bloqueia lembrete sem horário |
| Lembrete estilo calendário | ✅ o monitor do shell (a cada 30s) dispara **alerta estilo Chrome + entrada na central** no dia/hora da nota com `🔔 Lembrar-me` ligado |
| Descrição estilo blog | ✅ mini-editor com **negrito**, *itálico*, listas e H2; visualização renderizada tipo post |
| Imagem selecionada ou upload | ✅ **galeria** (6 capas geradas em SVG, zero download), **upload** convertido automaticamente para **.webp** (máx. 1280px, 85%) ou **URL** |
| Categorias estilo atividades | ✅ chips com checkbox, com **lista própria** (`notesCategories`) para não misturar com as das atividades |
| Controlado do admin | ✅ nova aba **📝 Notas** no Painel: gerir categorias, ver resumo/estatísticas, listar e **excluir qualquer nota**, limpeza em lote (30+ dias, preservando fixadas) e atalho para a página |

Extras incluídos: **📌 fixar no topo**, visão **🗂️ Cards** e **📅 Calendário**
(month grid com os recadinhos no dia), filtros (busca/categoria/período/só
lembretes), **🔗 copiar texto pronto** para compartilhar, ordenação
fixados→data→hora, e visual responsiva para celular.

### Arquivos tocados

- `js/core.js` — `notes[]`, `settings.notesCategories`, item de menu `notas`,
  migração que chega até DBs antigos sem apagar nada; **fix do loop infinito
  offline** em `applyI18n` (item 4).
- `js/app.js` — grupo Operação ganha `notas`; o monitor de alertas agora
  também varre `notes` com `remind` (dedupe por nota/dia/hora).
- `js/firebase.js` — sync da coleção `notes` (leitura do próprio usuário,
  merge por `updatedAt`, upload das ausentes) e `notesCategories` nas
  configurações globais.
- `firestore.rules` — bloco `match /notes/{noteId}`: dono lê/escreve o seu,
  admin lê/remove qualquer um. **Lembrete: publicar no Console.**
- `pages/admin.html` — aba 📝 Notas e inclusão das notas em backup, importação
  e sincronização manual com o Firebase.
- `service-worker.js` — cache `v14` + `pages/notas.html` no precache (clientes
  atualizam sozinhos).
- `locales/*.json` — rótulo do menu em PT/EN/ES.
- `pages/relatorios.html` — gráficos protegidos contra CDN offline ("Chart is
  not defined" não derruba mais a página; só o gráfico some).

---

## 4. ⚡ Loop infinito offline (bug encontrado nos testes)

`applyI18n` recarregava os textos quando o dicionário do idioma estava
indisponível — e reagendava **mesmo se o fetch tivesse falhado**. Offline e
sem cache do service worker isso virava uma cadeia infinita de microtasks que
congelava a aba. Agora só reagenda quando o load **realmente** trouxe o
dicionário. Páginas mantêm os textos-fallback e nunca mais travam por isso.

---

## ✅ Resumo dos testes

| Área | Testes | Resultado |
|---|---|---|
| Migração `core.js` (menu notas, notesCategories, notes) | 7 | ✅ |
| Página Notas (CRUD, lembrete, imagem, calendário, XSS, fixar, filtros) | 29 | ✅ |
| Atividades (share/comments funcionais + CRUD intacto) | 13 | ✅ |
| `ai.js` (fallback de canais, erro fatal, regras Firestore) | 7 | ✅ |
| Monitor de alertas dispara lembrete de nota (app.js) | 3 | ✅ |
| Aba Admin → Notas (categorias, stats, exclusão, limpeza) | 9 | ✅ |
| **Total automatizado** | **68** | **✅** |

Além disso, as **14 páginas** foram carregadas em DOM real: nenhum erro de
JavaScript no carregamento, inclusive com CDN do Chart.js indisponível.

---

## 📋 Deploy

1. **firestore.rules** — publicar o arquivo atualizado no Console do Firebase
   (contém as novas regras de `notes`). Sem isso, notas sincronizam só local.
2. **Proxy da IA** — se ainda não publicou, manter `proxy/cloudflare-worker.js`
   no ar e a URL salva em Administração → API / IA.
3. **Cache** — service worker sobe para `v14`; o APK/navegadores atualizam
   automaticamente no próximo carregamento.

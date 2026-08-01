# ✓ Checklist ML

Sistema de gestão operacional para Centros Logísticos — inspirado em Todoist, TickTick e Any.do.

## 🚀 Funcionalidades

### Core (Partes 1-2)
- **Dashboard** com métricas, progresso semanal e alertas de atraso
- **Atividades** com CRUD completo, filtros, recorrência e prioridades
- **Autenticação** com Firebase (email/senha + Google), validação de senha forte
- **3 Temas** (Ocean Blue, Mercado Livre, Forest) × 2 modos (claro/escuro)
- **Perfil** com 20 avatares, upload de imagem (comprimida para WebP), foto Google
- **Administração total** — tudo editável: temas, logo, favicon, menu, categorias, usuários, posts, arquivos, API keys
- **IA DeepSeek** integrada para análise e sugestões (com proxy próprio para contornar o bloqueio CORS)
- **Notícias/Posts** com editor estilo Blogspot
- **Biblioteca de arquivos** com categorias e thumbnails — botão **＋ Adicionar arquivo** direto na página (admin/editor)
- **Macros** 💬 — modelos de mensagens com editor rico completo (negrito, listas, links, cores, emojis), variáveis dinâmicas (`{{nome}}`, `{{data}}`, `{{hora}}`, `{{usuario}}`), cópia formatada com 1 clique e contador de uso
- **Admin de uso único** — a conta `wesleystudio@gmail.com` é promovida a admin exatamente 1 vez (marcador imutável em `settings/bootstrap`); depois o caminho fecha para sempre nas regras do Firestore
- **Sistema de cargos** — Membro, Editor, Admin (banir, resetar senha, excluir)
- **Logs** de todas as ações do sistema
- **Responsivo** — funciona em desktop e celular
- **PWA-ready** — pode ser instalado como app

### Parte 3/3 — Avançado
- **Kanban Board** com drag-and-drop entre colunas (HTML5 Drag and Drop API)
- **Calendário** mensal/semanal com grid CSS responsivo
- **Gamificação** — pontos, badges (10 conquistas), streaks diários, ranking semanal/geral
- **Temas customizados** salvos no localStorage com pré-visualização ao vivo
- **Internacionalização (i18n)** — pt-BR, en, es com 167 chaves em 15 seções
- **Modo foco / Pomodoro** com timer visual, ciclo auto e bloqueio de distrações
- **Comentários em atividades** — thread de discussão por atividade
- **Dashboard avançado** — widgets arrastáveis e configuráveis (7 widgets)
- **Workflow automation** — regras automáticas (atraso > 2 dias notifica, recorrente auto-cria)
- **Dark mode automático** — segue `prefers-color-scheme` do sistema

## 📂 Estrutura

```
/
├── index.html          # Página principal (login + app shell)
├── assets/             # Logo, favicon (SVG)
├── css/
│   ├── style.css       # CSS do app shell + temas (Parte 1 + 3)
│   └── page.css        # CSS compartilhado das páginas (Parte 1 + 3)
├── js/
│   ├── firebase.js     # Configuração Firebase
│   ├── core.js         # Utilitários centrais + i18n + gamificação + automações
│   ├── seed.js         # Dados iniciais
│   ├── app.js          # Controlador principal (auth, i18n, dark mode auto)
│   ├── ai.js           # Conexão com a IA (canais, erros, diagnóstico)
│   └── page.js         # Helpers para páginas (iframes)
├── proxy/
│   └── cloudflare-worker.js  # Proxy da IA (contorna o bloqueio CORS do DeepSeek)
├── locales/
│   ├── pt-BR.json      # Traduções português
│   ├── en.json         # Traduções inglês
│   └── es.json         # Traduções espanhol
├── pages/
│   ├── home.html       # Dashboard (com widgets arrastáveis)
│   ├── atividades.html # CRUD de atividades
│   ├── kanban.html     # Kanban Board (Parte 3)
│   ├── calendario.html # Calendário mensal/semanal (Parte 3)
│   ├── gamificacao.html# Conquistas & Ranking (Parte 3)
│   ├── foco.html       # Modo Foco / Pomodoro (Parte 3)
│   ├── custom.html     # Temas custom + Idioma + Dashboard + Automações (Parte 3)
│   ├── arquivos.html   # Biblioteca de arquivos
│   ├── IA.html         # Assistente DeepSeek
│   ├── perfil.html     # Perfil do usuário
│   ├── relatorios.html # Relatórios com gráficos
│   └── admin.html      # Painel administrativo
└── service-worker.js   # PWA + cache
```

## 🔐 Credenciais padrão

- **Usuário:** admin
- **Senha:** Admin@1234

## ⚡ Como usar

1. Abra `index.html` no navegador ou use:
   ```bash
   python3 -m http.server 8000
   ```
2. Faça login com `admin` / `Admin@1234`
3. Configure temas, idioma (PT/EN/ES), modo (claro/escuro/auto) em Administração ou Personalizar
4. Explore as novas páginas: **Kanban**, **Calendário**, **Conquistas**, **Modo Foco** e **Personalizar**

## 🔥 Firebase

- Projeto: `checklist-3e70c`
- Auth + Firestore + Storage configurados
- Persistência offline habilitada

### ☁️ Arquitetura de dados: nuvem primeiro (v17)

**Tudo que é dado do usuário vive no Firestore** — atividades, notas, macros,
comentários, gamificação, notificações, histórico da IA, configuração do
Pomodoro, layout do dashboard, arquivos, posts e configurações:

- **Escrita (write-through):** toda criação/edição/exclusão é gravada
  diretamente no Firestore. Falhas transitórias (offline/rede) entram numa
  **fila de reenvio automática (outbox)** — nada fica preso só no aparelho.
- **Leitura (read-through):** ao entrar, o app faz um **pull inicial do
  servidor** (`source: 'server'`) e mantém *snapshots* em tempo real. Um
  aparelho novo ou com cache vazio recebe todos os dados do banco.
- **localStorage = apenas cache:** serve para abrir rápido e funcionar com
  visual offline. Nunca é a única cópia de um dado — a nuvem é a fonte da
  verdade. O que fica no cache local é só o necessário para carregar a
  interface sem travar: tema/modo (preferência por usuário), período dos
  gráficos (dia/30 dias) e o espelho de leitura das coleções.
- **Chaves/segregados da IA** (DeepSeek/Groq) **não** ficam em localStorage:
  apenas na sessão da aba (`sessionStorage`) e no documento privado
  `settings/admin` do Firestore.
- **Notificações, histórico da IA e configuração do Pomodoro** ficam em
  `settings/{seção}/user/{uid}` no Firestore (só o dono lê/escreve) e são
  sincronizados entre dispositivos.
- ⚠️ **Importante:** republicue as regras do Firestore (veja
  `FIREBASE_SETUP.md` → seção 3 → "Admin de uso único") — elas incluem a
  permissão da coleção `dashboardWidgets`. É só copiar o conteúdo de
  `firestore.rules` no console e clicar em Publicar — depois basta entrar com
  `wesleystudio@gmail.com` uma vez.

## 🤖 IA DeepSeek

Configure em **Administração → API / IA**. A chave é salva no documento privado
`settings/admin` do Firestore — nunca no `localStorage` público nem nos backups.

### ⚠️ O proxy é obrigatório na prática

A API do DeepSeek **não responde ao preflight CORS**, então o navegador cancela
qualquer chamada feita direto do front-end (`Failed to fetch`) — mesmo com a
chave correta e saldo na conta. A chamada precisa sair de um servidor.

Este projeto já inclui o proxy pronto em **`proxy/cloudflare-worker.js`**
(Cloudflare Workers, plano gratuito, ~5 min, sem cartão):

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Start with Hello World!** → **Deploy**.
2. **Edit code** → cole o conteúdo de `proxy/cloudflare-worker.js` → **Deploy**.
3. Copie a URL do worker e cole em **Administração → API / IA → URL do proxy da IA**.
4. Use **🔌 Testar conexão** para confirmar (o canal "proxy próprio" fica ✅).

Sem o proxy, o app ainda tenta a conexão direta e proxies públicos gratuitos —
que funcionam de forma intermitente e têm limite de uso.

**Modos de conexão** (Administração → API / IA):
`Automático` (proxy próprio → direto → públicos), `Somente proxy próprio`,
`Somente direto`, `Somente proxies`.

> 🔒 **Mais seguro:** defina `DEEPSEEK_API_KEY` como variável secreta no próprio
> Worker. A chave passa a viver só no servidor e o navegador nunca a recebe.

## 🎮 Atalhos de teclado

- `Ctrl + K` — Busca global
- `N` — Nova atividade
- `T` — Alternar tema (claro → escuro → automático)
- `G H` — Ir para Home
- `G A` — Ir para Atividades
- `G K` — Ir para Kanban
- `G C` — Ir para Calendário
- `?` — Mostrar todos os atalhos
- `ESC` — Fechar modais

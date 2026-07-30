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
- **IA DeepSeek** integrada para análise e sugestões
- **Notícias/Posts** com editor estilo Blogspot
- **Biblioteca de arquivos** com categorias e thumbnails
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
│   └── page.js         # Helpers para páginas (iframes)
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

## 🤖 IA DeepSeek

Configure a API Key em **Administração > API / IA**. A chave é salva no documento privado `settings/admin` do Firestore, acessível apenas a administradores pelas regras em `firestore.rules`; ela não é gravada no `localStorage`, backup ou configurações públicas.

> Para disponibilizar a IA a todos os usuários em produção, use uma Cloud Function/proxy que mantenha a chave no servidor. A chamada direta pelo navegador é limitada ao administrador.

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

# ✓ Checklist ML

Sistema de gestão operacional para Centros Logísticos — inspirado em Todoist, TickTick e Any.do.

## 🚀 Funcionalidades

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

## 📂 Estrutura

```
/
├── index.html          # Página principal (login + app shell)
├── assets/             # Logo, favicon (SVG)
├── css/
│   ├── style.css       # CSS do app shell + temas
│   └── page.css        # CSS compartilhado das páginas
├── js/
│   ├── firebase.js     # Configuração Firebase
│   ├── core.js         # Utilitários centrais
│   ├── seed.js         # Dados iniciais
│   ├── app.js          # Controlador principal
│   └── page.js         # Helpers para páginas (iframes)
└── pages/
    ├── home.html       # Dashboard
    ├── atividades.html # CRUD de atividades
    ├── arquivos.html   # Biblioteca de arquivos
    ├── IA.html         # Assistente DeepSeek
    ├── perfil.html     # Perfil do usuário
    └── admin.html      # Painel administrativo
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
3. Configure temas, logo e preferências em Administração

## 🔥 Firebase

- Projeto: `checklist-3e70c`
- Auth + Firestore + Storage configurados
- Persistência offline habilitada

## 🤖 IA DeepSeek

Configure a API Key em Administração > API / IA. A IA analisa suas atividades e sugere prioridades, organização e resumos.

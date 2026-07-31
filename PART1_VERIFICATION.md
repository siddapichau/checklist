# Checklist ML — verificação da Parte 1 de 3

## Escopo

Verificados estaticamente: `index.html`, `css/style.css`, `js/app.js`, `js/core.js`,
`js/firebase.js`, `js/seed.js`, `js/page.js`, `service-worker.js`, `manifest.json`
e os recursos offline referenciados pelo service worker.

## Resultado por item

| Item | Resultado | Evidência/correção |
|---|---|---|
| Login/cadastro | OK por inspeção de fluxo | Entrar, cadastro, recuperação Firebase, Google popup, lembrar login, olho de senha, força, logout e sessão restaurada estão ligados aos handlers do `App`. Removido o fallback de senha em texto puro do seed. |
| Shell/menu | OK por inspeção de fluxo | Sidebar responsiva, overlay, topnav por hover/clique com atraso, badge, breadcrumb, notificações e atalhos (`N`, `T`, `G+H`, `Ctrl+K`, `Esc`, `?`) presentes. |
| Tema | OK por inspeção de fluxo | Claro/escuro/auto e ocean/mercado/forest; `postMessage` e `MutationObserver` sincronizam o iframe. |
| Idiomas | OK por inspeção de fluxo | PT/EN/ES usam `core.tReady`, atualização do shell e uma única recarga do iframe, sem loop. |
| Alertas | OK por inspeção de fluxo | Atividades e notas do dia usam marcador deduplicado, central do sino e alerta do navegador. |
| Notificações | OK por inspeção de fluxo | Badge, abrir/fechar, marcar lidas e navegação via `data.page`. |
| Visão Geral | OK por inspeção de código | `pages/home.html` calcula widgets usando `core.getLocalDB()` e os dados reais de tarefas. |
| Service Worker/offline | Corrigido/validado estaticamente | Cache individual resiliente, fallback de navegação, timeout de 8s e recuperação após 5s no shell. Groq foi incluída na lista de APIs que não devem ser cacheadas. |
| PWA | OK por inspeção de metadados | Manifest com nome, ícones 192/512, tema, `standalone` e `start_url`. |

## Design responsivo

As regras existentes foram conferidas para 360, 390, 768, 1366 e 1920 px:

- mobile até 600px: botões e ícones com área mínima de 44px, campos com 44px,
  filtros em uma coluna e modal com `max-height: 90vh`/rolagem;
- tablet até 1024px: sidebar em gaveta com overlay;
- desktop a partir de 1025px: sidebar substituída por topnav;
- modo escuro usa as mesmas variáveis CSS em todas as larguras.

Não há navegador Chromium/Playwright instalado nesta sandbox; portanto não foi
possível executar cliques reais, DevTools Offline ou gerar screenshots. Os itens
acima foram validados por análise de código, sintaxe, referências e fluxo.

## Validações automatizadas

- `node --check` em todos os JavaScript do escopo;
- `node --check` em todos os scripts inline das páginas HTML;
- parse de `manifest.json` e arquivos de locale;
- checagem de balanceamento básico de CSS/HTML e referências de assets;
- `git diff --check`.

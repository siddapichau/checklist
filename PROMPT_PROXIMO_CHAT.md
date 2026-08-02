# PRÓXIMO CHAT — Checklist ML / APK

## O que foi integrado nesta rodada
1. **Avatar Google reversível**: perfil agora mantém `googlePhoto` separado de `avatar/avatarType` e tem botão **↩️ Voltar para foto do Google** mesmo após trocar para emoji ou upload.
2. **Dias de folga persistidos no DB**: `daysOff` fica no perfil do usuário e sincroniza no Firestore. Ao limpar cache, volta da nuvem no login/sync.
3. **Atividades por dia + folga**: filtro ganhou **Dia específico**; tarefas de dias de folga são ocultadas sem apagar histórico; tela destaca folga e separa status pendente/realizado/análise/não realizado.
4. **IA com data correta**: perguntas com “ontem”, “dia anterior” ou “D-1” usam `core.addDays(core.today(), -1)` e separam **realizadas** vs **pendentes/em análise** no contexto enviado à IA.
5. **Sync offline/online Firebase**: outbox persistente já existente foi integrada ao Service Worker com Background Sync (`firestore-outbox-sync`) e flush ao voltar online.
6. **Notificações**: mudança de status gera notificação local/browser; folga configurada para hoje avisa que atividades não serão cobradas como pendentes; Service Worker mantém suporte a push.
7. **Exportação diária**: página Relatórios tem botões **CSV diário**, **CSV período** e **PDF diário** (impressão/salvar como PDF).
8. **Tema/acessibilidade**: botão 🔠 no topo alterna fonte normal/maior por usuário; tema claro/escuro/automático continua no botão 🌙/☀️/🌓.
9. **Correções de integridade**: removidos textos soltos que quebravam JS/HTML/manifest/service-worker e criada página `pages/export.html` válida apontando para Relatórios.

## Pontos para verificar no próximo chat/teste do APK
- Fazer login Google, trocar avatar para emoji/upload e testar **Voltar para foto do Google**.
- Marcar o dia atual como folga no Perfil, limpar cache do APK e confirmar que `daysOff` volta do Firestore.
- Em Atividades, testar filtros: Hoje, Dia específico, Semana, Mês, Atrasadas e status.
- Perguntar à IA: “resumo do dia anterior”, “o que ficou pendente ontem?” e validar data D-1.
- Testar offline: alterar status/criar atividade sem internet, fechar/abrir APK, voltar online e confirmar envio ao Firestore.
- Exportar relatório diário em CSV e PDF.
- Testar fonte maior e tema automático em páginas dentro do iframe.

## Ideias/complementos futuros
- Seletor de data no relatório diário (hoje/ontem/custom) antes de exportar.
- Dashboard de folgas por equipe/admin.
- Push remoto via FCM real com token por usuário (além da notificação local/browser atual).
- Log visual da outbox: itens pendentes, enviados e erro de regra Firestore.
- Testes automatizados com Playwright para login mockado, filtros e exportação.

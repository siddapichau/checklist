## Descrição

Implementações solicitadas pelo usuário:

1. **Sistema de Notificação estilo Alerta Google Chrome**: Adicionado componente de notificação flutuante com design idêntico aos alertas do Google Chrome (`chromeNotification`), ícone, botão de fechar e integração com a API de notificações nativa do navegador.
2. **Armazenamento de API Key no DB**: Ajustado o salvamento e carregamento da API Key do DeepSeek (`saveAdminConfig` / `getDeepseekKey`) para persistir de forma robusta no banco de dados (Firestore e DB local persistido), eliminando erros de salvamento.
3. **Página de Macros com Variável de Saudação (`{saldação}` / `{saudacao}`)**: Adicionado suporte automático à variável `{saldação}` e `{saudacao}` nas macros, puxando dinamicamente 'Bom dia', 'Boa tarde' ou 'Boa noite' conforme o horário do dia.

### Arquivos alterados:
- `css/style.css`: Estilização estilo Google Chrome notifications
- `index.html`: Container de notificações Chrome
- `js/app.js`: Manipulador de mensagens para notificações Chrome
- `js/core.js`: Implementação da função `chromeNotification`
- `js/firebase.js`: Tratamento robusto de salvamento de API Key no banco de dados sem erros
- `js/page.js`: Atalho de notificação Chrome para páginas em iframe
- `pages/macros.html`: Variáveis de saudação baseadas no horário (`{saldação}` / `{saudacao}`)

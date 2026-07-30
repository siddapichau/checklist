## Descrição

Corrige o mecanismo de promoção de administrador para o email bootstrap.

### Problema resolvido:
O usuário ficava aparecendo como 'Membro' mesmo sendo o email configurado como admin bootstrap. O mecanismo de claim único não estava verificando corretamente se o marcador já existia.

### Solução:
- claimBootstrapAdmin agora verifica PRIMEIRO se o marcador settings/bootstrap existe no Firestore
- Se existir e for o mesmo UID: define role=admin localmente
- Se existir e UID diferente: não faz nada (claim foi usado por outra conta)
- Se não existir: tenta promover E criar o marcador (operação atômica batch)
- Fallback local também verifica o marcador antes de promover

### Garantia de uso único:
- O claim funciona apenas uma vez
- Depois de usado, o marcador settings/bootstrap é criado no Firestore
- As regras do Firestore impedem re-utilização

### Arquivos alterados:
- js/app.js: Lógica de claimBootstrapAdmin e fallback local

### Status das outras solicitações:
- **Botão adicionar arquivo**: Já existe no código (pages/arquivos.html), aparece para admin/editor
- **Página Macros**: Já existe (pages/macros.html) com editor rico completo

# Checklist ML — manual de produto

Este repositório contém o manual visual (`index.html`) da especificação do Checklist ML: um checklist operacional responsivo para uso em computador e celular. O manual detalha telas, permissões, arquitetura por `pages/`, `js/`, `css/` e `assets/`, modelo Firebase, segurança da DeepSeek, temas editáveis e plano de implementação.

## Visualizar

Abra `index.html` diretamente ou rode:

```bash
python3 -m http.server 8000
```

Acesse http://localhost:8000. O projeto é um manual estático; não é o APK nem uma integração Firebase pronta.

## Conteúdo

- Visão do produto e estados de atividade.
- Mapa de `login`, `cadastro`, `home`, `atividades`, `arquivos`, `perfil`, `IA` e `admin`.
- Três temas com variantes claro/escuro totalmente configuráveis pelo Admin.
- Estrutura proposta com shell e páginas em iframe.
- Cargos membro, editor e admin, com regras de segurança.
- Benchmark de Todoist, TickTick, Trello, Asana, ClickUp, Notion, Microsoft To Do, Google Tasks, Motion e Sunsama.
- Roadmap incremental e critérios de pronto.

> A chave web do Firebase identifica o projeto, mas não deve ser tratada como segredo. Regras do Firebase, App Check e uma Cloud Function para a chave DeepSeek são obrigatórios antes de produção.

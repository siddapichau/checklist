# Flowlist

Dashboard de produtividade para organizar tarefas diárias com clareza, foco e uma experiência visual premium. O projeto foi construído sem dependências de runtime: basta abrir o `index.html` no navegador.

## O que foi entregue

- Dashboard responsivo em português do Brasil.
- Resumo de produtividade com tarefas concluídas, tarefas em andamento, horas de foco e sequência atual.
- Lista de tarefas com filtros por estado e busca instantânea.
- Criação de novas tarefas em modal com título, projeto, prazo e prioridade.
- Conclusão e reabertura de tarefas com feedback visual.
- Persistência local via `localStorage`, para que a lista sobreviva ao fechamento da página.
- Exportação da lista atual em CSV.
- Alternância entre tema claro e escuro.
- Menu lateral adaptado para dispositivos móveis.
- Estados vazios, feedbacks (toast), atalhos de teclado e elementos com rótulos acessíveis.
- Layout feito com CSS puro, sem framework ou build obrigatório.

## Como executar

### Opção 1 — abertura direta

Abra `index.html` no navegador. Esta é a forma mais rápida para visualizar o projeto.

### Opção 2 — servidor local recomendado

Um servidor local evita restrições de alguns navegadores e simula melhor um ambiente de produção:

```bash
python3 -m http.server 8000
```

Depois, acesse [http://localhost:8000](http://localhost:8000).

## Estrutura

```text
.
├── index.html    # Estrutura semântica, conteúdo e componentes
├── styles.css    # Design system, layout, responsividade e tema escuro
├── app.js        # Estado, interações e persistência local
└── README.md     # Documentação do projeto
```

## Decisões de produto e interface

O Flowlist usa uma hierarquia visual clara: o resumo mostra o contexto, a lista concentra a ação principal e os painéis laterais ajudam no planejamento sem competir com as tarefas. A paleta violeta comunica criatividade e foco, enquanto verde, âmbar e coral diferenciam estados e prioridades.

O design também considera diferentes tamanhos de tela: em telas menores, o menu lateral vira um drawer, os indicadores são reorganizados e o gráfico semanal permanece legível. A aplicação não depende de backend nesta versão; os dados são deliberadamente locais para facilitar demonstração e prototipação.

## Próximos passos sugeridos

1. Adicionar autenticação e sincronização com uma API.
2. Permitir editar e excluir tarefas, além de arrastar para reordenar.
3. Adicionar calendário, lembretes e recorrência.
4. Centralizar tokens de design em um arquivo de configuração.
5. Criar testes automatizados para estado, filtros e persistência.

## Licença

Projeto demonstrativo. Adicione a licença apropriada antes de distribuir em produção.

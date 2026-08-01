# Upgrade v18 — Horário de São Paulo, IA com aprendizado contínuo e nuvem

## Objetivo

Garantir que o Checklist ML opere com data/hora de **São Paulo/SP, Brasil (UTC-3)** e evolua a IA para um fluxo profissional de aprendizado contínuo, mantendo dados do usuário sincronizados na nuvem.

## 1. Horário operacional São Paulo/SP (UTC-3)

Foi centralizado em `js/core.js` um módulo de data/hora com:

- `TIME_ZONE = America/Sao_Paulo`
- `TIME_ZONE_OFFSET = -03:00`
- `TIME_ZONE_LABEL = São Paulo/SP, Brasil (UTC-3)`

As funções operacionais agora usam esse fuso como fonte de verdade:

- `core.today()` retorna o dia civil de São Paulo;
- `core.now()` retorna timestamp ISO com offset `-03:00`;
- `core.formatDate()` e `core.formatDateTime()` exibem datas no fuso de São Paulo;
- `core.addDays()`, `core.addMonths()`, `core.startOfWeek()`, `core.endOfWeek()` e `core.monthBounds()` evitam viradas incorretas causadas por UTC/local timezone;
- streaks, semana de gamificação, recorrência e atrasos passaram a usar data civil de São Paulo.

Também foram ajustadas páginas críticas:

- Atividades: filtros por hoje/semana/mês usam São Paulo;
- Home/Dashboard: saudação, período e progresso semanal usam São Paulo;
- Calendário/Notas: “hoje” e navegação inicial respeitam São Paulo;
- Relatórios/Gamificação/Foco/Macros/Admin: datas de relatório, semana, exportações e variáveis dinâmicas usam helpers centralizados.

## 2. IA com aprendizado contínuo por uso

A página `pages/IA.html` recebeu uma camada de memória adaptativa por usuário.

A cada consulta, o app salva:

- pergunta e resposta;
- canal usado para resposta (`proxy`, direto, fallback local etc.);
- tags de intenção detectadas, como “atrasadas”, “resumo do dia”, “ordem de execução”;
- contadores de uso/sucesso/fallback;
- contexto operacional do momento: data de São Paulo, quantidade de tarefas de hoje, atrasadas e pendentes;
- referências das principais atividades envolvidas;
- resumo curto da resposta.

Nas próximas consultas, essa memória é inserida no prompt como contexto adaptativo, com regra explícita para **não inventar atividades** e usar somente os dados fornecidos.

## 3. Salvamento em nuvem

A memória e o histórico da IA ficam em:

```text
settings/ai/user/{uid}
```

Esse caminho já é protegido por `firestore.rules`:

```text
match /settings/{settingId}/user/{userId} {
  allow read, write: if isOwner(userId);
}
```

Ou seja: cada usuário lê/escreve apenas sua própria memória.

## 4. Cache local apenas como apoio

O app mantém cache local para carregamento rápido/offline:

- `cl-ai-history-{uid}`
- `cl-ai-memory-{uid}`

A chave antiga `ai_history_{uid}` foi migrada para evitar históricos duplicados.

## 5. Outbox persistente do FireSync

Antes, a fila de reenvio existia só em memória. Se o app fechasse offline, a fila poderia ser perdida.

Agora a outbox fica persistida em:

```text
cl-firesync-outbox-v18
```

Ela é limpa automaticamente quando o Firestore confirma a gravação. Dados sensíveis de usuários (`pass`, `passHash`) são removidos antes de qualquer persistência nessa fila.

## 6. PWA/cache

O Service Worker foi atualizado para:

```text
checklist-ml-v18-sp-ia-learning-cloud
```

Isso força o app/APK a receber os novos arquivos e evita ficar preso no cache v17.

## Resultado

- Operação consistente em São Paulo/SP (UTC-3), independente do fuso do aparelho.
- IA passa a aprender padrões de uso e melhora a personalização a cada consulta.
- Histórico + memória da IA ficam salvos na nuvem por usuário.
- Escritas offline ficam em fila persistente e sobem ao reconectar.

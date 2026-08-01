# v18 — Horário São Paulo (UTC-3) • IA com aprendizado contínuo • Nuvem mais resiliente

## O que muda

### 🕒 Horário operacional São Paulo/SP — UTC-3
- Centralização de data/hora em `js/core.js` com `America/Sao_Paulo` e offset `-03:00`.
- `core.today()`, `core.now()`, `formatDate`, `formatDateTime`, semana, mês, recorrência, atraso e streak agora usam a data civil de São Paulo.
- Ajustes nas telas principais para não depender do fuso do aparelho/navegador:
  - Home/Dashboard;
  - Atividades;
  - Calendário;
  - Notas;
  - Relatórios;
  - Gamificação;
  - Foco;
  - Macros;
  - Admin/exportações.

### 🧠 IA aprende a cada uso
- Nova memória adaptativa por usuário na página **IA Assistente**.
- A cada pergunta, o app registra:
  - intenção/tags da consulta;
  - canal usado;
  - resumo curto da resposta;
  - estatísticas do contexto operacional;
  - referências de atividades relevantes;
  - contadores de uso/sucesso/fallback.
- Essa memória volta no prompt das próximas consultas para personalizar foco e recomendações, com regra explícita para **não inventar atividades**.
- Novo card visual “🧠 Aprendizado contínuo na nuvem”, com contagem, foco principal, último aprendizado, tags e botão para recarregar/limpar memória.

### ☁️ Dados salvos na nuvem
- Histórico e memória da IA ficam em `settings/ai/user/{uid}` no Firestore.
- Cache local continua existindo apenas para abertura rápida/offline:
  - `cl-ai-history-{uid}`;
  - `cl-ai-memory-{uid}`.
- Migração da chave antiga `ai_history_{uid}` para evitar histórico duplicado.
- `firestore.rules` documenta explicitamente preferências privadas por usuário, incluindo histórico/memória da IA.

### 🔁 FireSync mais profissional/resiliente
- Outbox agora é persistente em `cl-firesync-outbox-v18`.
- Se o app fechar offline, as escritas pendentes permanecem na fila e sobem ao reconectar/reabrir.
- Remoção de dados sensíveis (`pass`, `passHash`) antes de persistir itens da fila.
- Tratamento melhor para `unauthenticated`: mantém fila para tentar após restauração da sessão em vez de descartar.

### 📚 Documentação
- `README.md` atualizado com v18.
- Novo documento detalhado: `UPGRADE_V18_SAO_PAULO_IA_NUVEM.md`.
- Service Worker atualizado para `checklist-ml-v18-sp-ia-learning-cloud`.

## ✅ Validação executada

- `node --check` em todos os arquivos JS (`js/*.js`, `service-worker.js`, `proxy/cloudflare-worker.js`).
- Extração e `node --check` dos scripts inline de `pages/*.html` e `index.html`.
- `git diff --check` sem problemas.
- Teste direto dos helpers de fuso:
  - antes de `03:00Z` cai no dia anterior em São Paulo;
  - a partir de `03:00Z` vira o dia correto;
  - `addMonths('2026-01-31', 1)` ajusta para `2026-02-28`.

## Observação

A IA “aprende” por memória operacional salva por usuário (histórico, padrões e contexto), não por treinamento de pesos do modelo. Isso mantém o comportamento seguro, auditável e sincronizado na nuvem.

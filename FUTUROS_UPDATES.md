# 🚀 Futuros Updates — Roadmap de Ideias

Este documento é o plano de voo das próximas versões do **Checklist ML**.
A mesma lista aparece dentro do app em **Administração → 🚀 Futuros Updates**,
para o admin acompanhar sem precisar abrir o repositório.

**Como ler:** cada ideia traz `🎯 Impacto` (quanto vale para a operação) e
`🛠️ Esforço` (quanto custa para construir). Vitórias rápidas = impacto alto +
esforço baixo — elas devem entrar primeiro na sprint.

**Status possíveis:** 💡 Ideia · 🧪 Em estudo · 🗳️ Votação · 🚧 Em desenvolvimento · ✅ Entregue

---

## ⚡ Novas funções

| # | Ideia | O que é | Impacto | Esforço | Status |
|---|-------|---------|---------|---------|--------|
| 1 | 🎙️ **Criar atividade por voz** | Ditar a atividade pelo microfone (Web Speech API): o app transcreve e já sugere título, data e prioridade. | 🎯 Alto | 🛠️ Médio | 💡 Ideia |
| 2 | 📸 **Foto de evidência na atividade** | Anexar foto do pallet, etiqueta ou avaria direto na atividade (Firebase Storage) — prova na hora da conferência. | 🎯 Alto | 🛠️ Médio | 💡 Ideia |
| 3 | 🔔 **Notificações push nativas** | Alertas reais no celular (FCM) para horário de alerta, lembretes de notas e avisos do admin — mesmo com o app fechado. | 🎯 Alto | 🛠️ Alto | 🧪 Em estudo |
| 4 | 🔁 **Atividades recorrentes** | Repetição diária/semanal/mensal com geração automática da cópia na virada do dia operacional. | 🎯 Alto | 🛠️ Médio | 💡 Ideia |
| 5 | ✅ **Sub-itens dentro da atividade** | Checklist interno com passos marcáveis e % de progresso para atividades grandes. | 🎯 Médio | 🛠️ Baixo | 💡 Ideia |
| 6 | ⏱️ **Cronômetro por atividade** | Iniciar/pausar mede o tempo real de execução; totais alimentam os relatórios (time tracking). | 🎯 Médio | 🛠️ Médio | 💡 Ideia |
| 7 | ✍️ **Assinatura digital de turno** | Conferente assina na tela ao fechar o checklist; registro com nome, data e hora no histórico. | 🎯 Médio | 🛠️ Médio | 💡 Ideia |
| 8 | 🖨️ **Imprimir / PDF do checklist do dia** | PDF limpo das atividades do dia para porta-prancheta ou crachá. | 🎯 Médio | 🛠️ Baixo | 💡 Ideia |

## 📄 Novas páginas

| # | Ideia | O que é | Impacto | Esforço | Status |
|---|-------|---------|---------|---------|--------|
| 9 | 📺 **Mural TV (modo telão)** | Página para a TV do centro logístico: KPIs ao vivo, atrasadas em destaque, ranking do dia e atualização automática. | 🎯 Alto | 🛠️ Médio | 🧪 Em estudo |
| 10 | 🗓️ **Timeline / Gantt do turno** | Barras por data e prioridade mostrando a carga da semana — enxergar gargalos antes de estourarem. | 🎯 Médio | 🛠️ Alto | 💡 Ideia |
| 11 | 🗺️ **Mapa de calor de produtividade** | Grade hora × dia com picos de conclusão e horários mortos; base para remanejar escala. | 🎯 Médio | 🛠️ Médio | 💡 Ideia |
| 12 | 🏆 **Loja de recompensas** | Trocar pontos da gamificação por prêmios configurados pelo admin (folga, destaque no mural, brindes). | 🎯 Médio | 🛠️ Médio | 💡 Ideia |

## ⚙️ Mecanismos & integrações

| # | Ideia | O que é | Impacto | Esforço | Status |
|---|-------|---------|---------|---------|--------|
| 13 | 📥 **Importar atividades via CSV/Excel** | Colar a planilha do WMS/Google Sheets e criar atividades em lote, com pré-visualização e validação. | 🎯 Alto | 🛠️ Médio | 💡 Ideia |
| 14 | 👥 **Atribuição para membros e equipes** | Admin atribui atividades a pessoas; usuário aceita/recusa e acompanha "minhas designações". | 🎯 Alto | 🛠️ Alto | 💡 Ideia |
| 15 | 🌐 **Webhooks / API de entrada** | Sistemas externos criam atividades automaticamente (caminhão chegou → cria "Conferir carga"). | 🎯 Médio | 🛠️ Alto | 🧪 Em estudo |
| 16 | 🔐 **Login com biometria no APK** | Abrir o app com digital ou face (WebAuthn), sem digitar senha no turno corrido. | 🎯 Médio | 🛠️ Alto | 💡 Ideia |
| 17 | 💬 **Chat rápido por equipe** | Mural de mensagens do turno com menções (@nome) e vínculo direto a uma atividade. | 🎯 Médio | 🛠️ Alto | 💡 Ideia |

## 🤖 IA & automação

| # | Ideia | O que é | Impacto | Esforço | Status |
|---|-------|---------|---------|---------|--------|
| 18 | 🤖 **Relatório automático de fim de turno** | No horário marcado, a IA gera o resumo do turno (feitas, atrasadas, pendências) e envia ao admin por e-mail/WhatsApp. | 🎯 Alto | 🛠️ Médio | 💡 Ideia |
| 19 | 🔮 **Previsão de atraso** | A IA cruza o histórico e avisa cedo quais atividades têm risco de estourar o prazo, sugerindo replanejamento. | 🎯 Médio | 🛠️ Alto | 🧪 Em estudo |
| 20 | 🪄 **Macro criada por IA** | Descreva a mensagem em uma frase e a IA monta a macro completa — texto, variáveis e campos c1–c10 — pronta para salvar. | 🎯 Médio | 🛠️ Baixo | 💡 Ideia |
| 21 | 🗣️ **Perguntar à IA por voz** | Falar a pergunta na página IA Assistente e ouvir a resposta em voz alta — operação mãos livres. | 🎯 Médio | 🛠️ Médio | 💡 Ideia |

---

## 📌 Como este quadro evolui

1. **Priorize vitórias rápidas** (impacto alto + esforço baixo) para ganhar tração a cada sprint.
2. **Valide com o turno:** antes de desenvolver, confirme com quem opera se a ideia resolve dor real.
3. **Atualize o status aqui e no Admin** (`FUTURE_UPDATES` em `pages/admin.html`) conforme as ideias andam no funil: 💡 Ideia → 🧪 Em estudo → 🗳️ Votação → 🚧 Em desenvolvimento → ✅ Entregue.
4. Ideia nova? Crie uma linha na tabela certa e o mesmo objeto no array da aba — a aba renderiza sozinha.

> Última atualização: 03/08/2026 (v21 — Macros com datas relativas, modais que só fecham no X, visual da resposta da IA reformulado e esta aba de roadmap).

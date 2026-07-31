# 📲 Verificação 100% do APK — 3 prompts sequenciais

Use os 3 prompts abaixo em **3 sessões separadas**, NA ORDEM (1 → 2 → 3).
Cada um verifica um terço do app **inteiro** e manda abrir um **Pull Request**
ao final, para você revisar tudo com calma antes do merge. Juntos, os três
varrem 100% dos arquivos e das funções do APK **e** o design em computador +
celular.

---

## 🔎 PROMPT 1/3 — Base do app: shell, login, tema, alertas e Visão Geral

```text
Tarefa: verificação 100% da PARTE 1 de 3 do app (Checklist ML) + Pull Request.

PASSO 1 — ATUALIZAR O CÓDIGO
- Puxe o código mais recente do repositório (faça pull da branch principal
  main, que já contém os últimos PRs mesclados). Se começar outra sessão nova,
  clone/baixe o estado atual de main. NÃO apague nada sem entender.

PASSO 2 — O QUE VERIFICAR NESTA PARTE (testar cada item, um a um, no navegador):
Escopo: index.html, css/style.css, js/app.js, js/core.js, js/firebase.js,
js/seed.js, js/page.js, service-worker.js, manifest.json, index offline.

1. Login/cadastro: aba Entrar, Criar conta, Esqueci senha, login Google
   (popup), "Lembrar meu login", olho de mostrar senha, força de senha,
   logout e re-login com sessão lembrada.
2. Shell/menu: sidebar no mobile (abrir/fechar), menu superior no desktop
   (grupos com dropdown abrindo no hover e no clique, sem piscar), badge de
   atrasadas, breadcrumb, atalhos de teclado (N, T, G+H, Ctrl+K, Esc, ?).
3. Tema: claro/escuro/auto, temas ocean/mercado/forest, troca refletindo nas
   páginas do iframe na hora.
4. Idiomas: PT/EN/ES trocando sem erro e sem reload infinito.
5. Alertas: atividade de hoje com horário dispara alerta estilo Chrome +
   entrada na central de notificações (sino), sem repetir; nota/recadinho de
   hoje com lembrete idem.
6. Notificações: sino com badge, abrir/fechar, marcar lidas, item navega para
   a página certa.
7. Visão Geral (pages/home.html): todos os widgets carregam, números batem
   com as atividades reais, sem erro no console (F12 → Console).
8. Service Worker/offline: desligue a internet (DevTools → Network → Offline),
   recarregue — o app deve abrir em modo offline completo, sem travar na tela
   de loading (botão "Limpar cache e recarregar" só aparece depois de 5s).
9. PWA: manifest ícone/nome/tema, instalação em desktop e em celular.

PASSO 3 — DESIGN (OBRIGATÓRIO nos 3 prompts)
DevTools → modo responsivo. Teste TODAS as telas acima nas larguras:
360px, 390px (celular), 768px (tablet), 1366px e 1920px (desktop).
Corrija qualquer: texto cortado, botão que vaza, modal que não cabe na tela,
menu quebrando linha, área de toque pequena demais no celular (mín. ~40px).
Confirme também modo escuro em cada largura.

PASSO 4 — RELATAR E ENTREGAR
- Liste TUDO que verificou (ok / problema encontrado / correção aplicada).
- Corrija o que for bug real no código.
- Valide a sintaxe de todos os arquivos alterados.
- Commit na branch da sessão, push e ABRA UM PULL REQUEST para main com
  resumo completo (o que verificou, prints/descritivo, o que corrigiu).
```

---

## 📝 PROMPT 2/3 — Operação: Atividades, Kanban, Calendário e Notas

```text
Tarefa: verificação 100% da PARTE 2 de 3 do app (Checklist ML) + Pull Request.

PASSO 1 — ATUALIZAR O CÓDIGO
- Faça pull da branch main (que deve já incluir o PR da PARTE 1 mesclado).
  Confirme que o service worker subiu de versão e limpe o cache antes de
  testar (DevTools → Application → Storage → Clear).

PASSO 2 — O QUE VERIFICAR NESTA PARTE:
Escopo: pages/atividades.html, pages/kanban.html, pages/calendario.html,
pages/notas.html + trechos de sync em js/firebase.js e coleções tasks/notes
nas firestore.rules.

ATIVIDADES (testar TODOS os botões de TODOS os cards):
1. Criar/ editar/ excluir atividade (título, descrição, data, horário de
   alerta, prioridade, status, recorrência diária/semanal/mensal/custom com
   dias da semana, múltiplas categorias por checkbox).
2. Avançar status pelo clique no ícone, card movendo de grupo corretamente
   (Atrasadas → Analisando → Pendentes → Finalizadas → Não realizadas).
3. botão 🔗 COMPARTILHAR: link copia de verdade; QR Code aparece; botão
   Compartilhar (nativo/fallback), WhatsApp e E-mail abrem com texto pronto.
4. botão 💬 COMENTÁRIOS: escrever, enviar, comentário aparece na hora,
   excluir comentário próprio, contador correto. Feche e reabra — persiste.
5. Filtros: busca, status, categoria, datas (hoje/semana/atrasadas/mês).
6. Recorrência: ao finalizar uma diária, a próxima é criada sozinha.
7. Gamificação: pontos e streak sobem ao finalizar.
8. Botão "＋ Nova atividade" do topo NUNCA pode abrir sem efeito.
9. Persistência: recarregar mantém tudo; sync Firestore (online): criar em um
   navegador, atualizar no outro.

KANBAN:
10. Arrastar card entre colunas muda status; criar/editar/excluir card;
    comentários do card funcionando (mesmo teste do item 4).

CALENDÁRIO:
11. Navegar meses, Hoje, visão mês/semana, clique no dia abre lista,
    "＋ Adicionar" leva para atividades; abrir atividade pelo calendário e
    comentar nela (o comentário deve SALVAR e sumir só ao excluir).

NOTAS & RECADOS (página nova — teste completo):
12. Criar recadinho com título, data, hora, descrição estilo blog
    (**negrito**, *itálico*, lista com "-"), múltiplas categorias, 📌 fixar.
13. Imagem: galeria (clicar muda a capa), upload de jpg/png convertendo para
    .webp (inspecione: data:image/webp), URL externa, remover imagem.
14. Lembrete 🔔: exige horário; com data de hoje e hora no passado/presente,
    dispara alerta do monitor do shell em até ~30s e aparece na central.
15. Visões 🗂️ Cards e 📅 Calendário: recadinho aparece no dia certo, clique
    no dia lista, "Novo neste dia" pré-preenche a data.
16. Editar, 👁️ abrir leitura blog, 🔗 copiar texto, 🗑️ excluir, filtros.
17. Segurança: título/descrição com <script> deve aparecer como texto
    (não pode executar nada).

PASSO 3 — DESIGN (desktop + celular, mesmas larguras do Prompt 1)
Especial atenção a: grade dos cards de atividades (235px) e dos recadinhos
(160–250px) sem quebrar; modais cabendo na tela do celular com scroll; chips
de categoria sem vazar; calendário legível em 360px; botões com alvo de toque
adequado; modo escuro consistente nos cards de nota (barra de cor no topo).

PASSO 4 — RELATAR E ENTREGAR
- Relatório completo (ok / bug / correção) de TODOS os itens acima.
- Corrigir bugs reais encontrados, validar sintaxe, commit, push e
  ABRIR UM PULL REQUEST para main, mencionando também se algum teste
  depende do usuário publicar regras no Firebase.
```

---

## ⚙️ PROMPT 3/3 — Ferramentas, IA, Admin e PWA final + revisão geral do design

```text
Tarefa: verificação 100% da PARTE 3 de 3 do app (Checklist ML) + Pull Request.

PASSO 1 — ATUALIZAR O CÓDIGO
- Faça pull da branch main (deve conter os PRs das PARTES 1 e 2 mesclados).
- Limpe o cache/service worker antes de testar.

PASSO 2 — O QUE VERIFICAR NESTA PARTE:
Escopo: pages/IA.html, js/ai.js, proxy/cloudflare-worker.js, pages/admin.html,
pages/arquivos.html, pages/macros.html, pages/relatorios.html,
pages/perfil.html, pages/custom.html, pages/gamificacao.html, pages/foco.html,
locales/*.json, e navegação geral de js/app.js.

IA ASSISTENTE:
1. Status honesto da conexão; perguntas rápidas; consulta com pergunta livre.
2. Botão 🔌 Testar conexão: deve listar, EM ORDEM, regras do Firestore, chave,
   proxy próprio, conexão direta e proxies públicos — leia cada linha e
   confirme que o texto orienta exatamente o que fazer.
3. Se a chave salva não chega a outro dispositivo: verificar que o diagnóstico
   MANDA o usuário publicar firestore.rules no Console do Firebase.
4. Com DEEPSEEK_API_KEY configurado no Worker, a IA deve responder de verdade
   (se a credencial estiver disponível no ambiente).

PAINEL ADMIN (todas as abas, uma a uma):
5. Aparência (salvar marca/tema/modo/idioma/logo/favicon), Usuários (mudar
   cargo, banir, resetar senha, excluir), Menu (arrastar, ocultar, salvar),
   Notícias (publicar/excluir com imagem), Arquivos (adicionar/excluir),
   Categorias (adicionar/excluir),
6. Aba 📝 NOTAS: adicionar/remover categorias de nota, estatísticas corretas,
   excluir nota de qualquer usuário, limpeza de 30+ dias preservando fixadas,
   botão "Abrir página de notas" navega.
7. API / IA: salvar chave + URL do proxy, modo de conexão, testar conexão,
   remover chave — tudo persistindo após recarregar.
8. Backup: exportar tudo (JSON inclui notes), importar JSON anterior,
   sincronizar manual com Firebase, Logs listando e limpando.

FERRAMENTAS:
9. Arquivos (página pública): grid, busca, filtros; abrir link.
10. Macros: criar/editar/excluir/usar macro com variáveis.
11. Relatórios: números coerentes com as atividades; gráficos renderizando;
    OFFLINE a página NÃO pode quebrar (mensagem amigável em vez de erro).
12. Perfil: editar nome/dados/avatar/foto, idioma, tema da conta.
13. Personalizar: criar tema custom e aplicar; excluir.
14. Gamificação: conquistas calculadas e exibidas; Foco/Pomodoro roda,
    pausa, completa e pontua.

GERAL / REGRESSÕES:
15. Console do navegador sem erros em NENHUMA página (abrir as 14 páginas!).
16. Desligue a internet e navegue por TUDO — nenhuma página congela/loopa.
17. Navegação por hash (#atividades, #notas...) e botão voltar do navegador.
18. Service worker novo assume controle sem precisar desinstalar o APK.

PASSO 3 — DESIGN (fechamento: desktop + celular)
Revisar as 14 páginas em 360px, 768px e 1920px no modo claro E escuro.
Checklist visual: alinhamento, espaçamento entre cards, modal com rolagem,
abas do Admin com scroll horizontal quando não couberem, tabelas com
overflow-x, nada de texto vazando. O visual deve ficar perfeito, igual a um
app profissional, em computador e celular.

PASSO 4 — RELATAR E ENTREGAR
- Relatório item a item (ok / bug / correção), com atenção especial ao
  console sem erros.
- Corrigir bugs reais, validar sintaxe de todos os arquivos, commit, push e
  ABRIR UM PULL REQUEST para main com o resumo de encerramento da auditoria
  (partes 1, 2 e 3 = 100% do APK verificado).
```

---

## 📌 Como usar

1. Mande o **PROMPT 1** em uma sessão → revise e dê merge no PR.
2. Mande o **PROMPT 2** na sessão seguinte → revise e dê merge.
3. Mande o **PROMPT 3** por último → revise e dê merge.
4. Se aparecer alguma instrução pedindo "publicar regras no Firebase" ou
   "configurar proxy", execute manualmente — nenhum agente consegue fazer
   isso por você (são telas do Console do Firebase/Cloudflare).

Dica: os prompts já pedem pull da `main` no início, então sempre execute
depois do merge anterior — assim cada parte verifica também as correções
das anteriores (regressão cruzada).

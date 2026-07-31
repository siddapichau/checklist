# Prompt para continuar (Parte 2/2) — copie no novo chat

Continue o trabalho no repositório `siddapichau/checklist`, na branch
`arena/019fb9b9-checklist` (a Parte 1 já está no PR #24). Agora faça a **Parte 2**
do meu pedido original. Trabalhe direto nessa branch, commitando e dando push a
cada item, e no fim atualize/abra o PR. Se chegar perto do limite de tempo, pare
antes, gere o PR e me mande um novo prompt para continuar.

## Itens da Parte 2

4. **IA de ajuda em cada página.** Usar a nossa IA (Groq/DeepSeek já integrada em
   `js/ai.js` / `pages/IA.html`) para dar **dicas, otimizar e tirar dúvidas em cada
   página**, principalmente **explicando como cada página funciona**. Ideal: um
   botão/assistente contextual (ex.: “🤖 Ajuda desta página”) presente nas páginas,
   que já entra sabendo em qual página está e o que ela faz.

5. **Notas viram lembretes.** A data e hora colocada na nota é a **hora do aviso**
   (é para acontecer). A nota **só é excluída se o usuário excluir manualmente**.
   Ao entrar, o usuário vê as notas que **ainda vão vir ou são atuais**; deve haver
   uma **aba para ver as que já passaram**. Cada nota tem opção de **marcar se já
   fez**; se passar da data e não foi feita, fica como **pendente**.
   (Arquivos base: `pages/notas.html`, regras em `firestore.rules`.)

6. **Macro com e-mail.** Se o usuário escolher o modelo como **e-mail**, aparece um
   campo para ele informar **os e-mails de destino**, e um **botão “Mandar e-mail”**
   que abre o **gmail.com** já **pré-preenchido** (destinatários + assunto). Como não
   dá para preencher o corpo automaticamente, o texto fica pronto para o usuário só
   apertar **Ctrl+V** e colar.

7. **Macro com campos c1–c10.** Cada macro tem **10 campos** chamados **c1 a c10**.
   Quando o texto pré-escrito contém, por exemplo, `{c10}`, ao preencher esse campo
   a informação é inserida no texto final. (Arquivos base: `pages/macros.html`.)

## Contexto da Parte 1 (já feita)
Tema por usuário (cada um escolhe o seu; 1ª vez segue o sistema; admin só define o
padrão), Dashboard com filtro Dia/Semana/Mês sempre do dia atual para trás, e
Relatórios repaginados (modernos, tema claro/escuro, filtro de período).
Detalhes em `CORRECAO_V15_PARTE1.md`.

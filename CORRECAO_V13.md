# 🔧 Correção v13 — Atividades, IA e menu inteligente

Três problemas relatados, três causas-raiz encontradas e corrigidas.

---

## 1. ❌ "Atividades não funciona nem para ver nem para criar novas"

### Causa raiz (bug de JavaScript, não de dados)

O script de `pages/atividades.html` chamava `render()` **logo no início**, dentro
de uma IIFE, mas `render()` usa a constante `STATUS_GROUPS`, declarada **200
linhas abaixo**:

```js
(function initCategories() {
  ...
  render();          // ← executa aqui
})();
...
const STATUS_GROUPS = [ ... ];   // ← só é criada aqui
```

Em JavaScript, `const` fica na *temporal dead zone* até a linha da sua
declaração. O resultado era um erro fatal logo no carregamento:

```
Uncaught ReferenceError: Cannot access 'STATUS_GROUPS' before initialization
```

Esse erro **abortava o script inteiro**. Como todas as funções da página vinham
depois desse ponto, nada mais era definido — por isso:

- a lista de atividades ficava **em branco** (nenhum card aparecia);
- o botão **＋ Nova atividade** não fazia nada (`openNewTask` nem existia);
- editar, excluir, filtrar e comentar também estavam mortos.

Foi introduzido na v12, junto com o agrupamento por status.

### Correção

- A inicialização virou a função `boot()`, chamada **no fim do script**, quando
  todas as declarações já existem.
- `boot()` está dentro de `try/catch`: se algo falhar no futuro, a página mostra
  um aviso com o motivo e um botão "Tentar novamente", em vez de ficar em branco.
- A execução respeita o `DOMContentLoaded` quando o DOM ainda não terminou.

**Verificado:** 26 testes automatizados cobrindo ver, criar, editar, avançar
status, filtrar (texto/status/data/categoria), excluir e o botão "Nova
atividade" do topo. Todos passam.

---

## 2. 🤖 "A IA dá erro mesmo com a API Key certa e com saldo"

### Causa raiz (não é a sua chave, nem o seu saldo)

A API do DeepSeek **parou de responder ao preflight CORS**. Quando o navegador
faz uma chamada com `Authorization` + `Content-Type: application/json`, ele
antes envia um `OPTIONS`. A resposta do DeepSeek não traz o cabeçalho
`Access-Control-Allow-Origin`, então **o próprio navegador cancela a
requisição**:

```
Access to fetch at 'https://api.deepseek.com/v1/chat/completions'
has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Ou seja: **a chave nunca chega a ser usada** — a chamada morre no navegador,
antes de sair da máquina. É por isso que a chave correta e o saldo em dia não
resolviam. Vários apps que chamavam o DeepSeek direto do browser quebraram
da mesma forma.

A v12 tentou contornar com proxies CORS públicos, mas eles são de terceiros,
têm limite de requisições e caem com frequência — por isso o erro voltava.

### Correção: proxy próprio (a única solução confiável)

Como o bloqueio é do navegador, a chamada precisa sair de um **servidor**.
Foi adicionado `proxy/cloudflare-worker.js` — um proxy pronto para o
Cloudflare Workers (plano gratuito, sem cartão de crédito, ~5 minutos).

**Como ativar:**

1. Acesse [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
   → **Create** → **Start with Hello World!** → **Deploy**.
2. Clique em **Edit code**, apague tudo, cole o conteúdo de
   `proxy/cloudflare-worker.js` e clique em **Deploy**.
3. Copie a URL (ex.: `https://checklist-ia.seu-usuario.workers.dev`).
4. No app: **Administração → API / IA** → cole em **"URL do proxy da IA"** →
   **Salvar no banco**.
5. Clique em **🔌 Testar conexão** — o canal "proxy próprio" deve ficar ✅.

**Dica de segurança:** no Worker, em *Settings → Variables*, crie a variável
secreta `DEEPSEEK_API_KEY`. O Worker passa a usar a chave dele mesmo e o
navegador nunca precisa conhecê-la.

### Outras melhorias na IA

- **`js/ai.js`** — camada única de conexão, compartilhada entre a página da IA
  e o diagnóstico do Admin (antes o código era duplicado e divergente).
- **Ordem de tentativas:** proxy próprio → conexão direta → proxies públicos.
- **Erros que param a cadeia:** 401/402/403 são problemas de conta — a IA para
  na hora em vez de repetir a falha em todos os canais.
- **Mensagens acionáveis:** 401 = chave inválida, 402 = sem saldo, 429 = limite,
  5xx = servidor instável — cada uma com o que fazer.
- **Lista dos canais testados** aparece junto do erro, mostrando onde travou.
- **Status honesto** na página da IA: sem proxy próprio, o aviso amarelo explica
  que o navegador provavelmente vai bloquear, em vez de dizer "IA pronta".
- **Respostas inválidas** de proxies ruins (HTML em vez de JSON) viram erro
  tratado, sem quebrar a página.

**Verificado:** 22 testes da cadeia de canais + 17 testes do Worker (preflight,
encaminhamento, espelhamento de status, allowlist de rotas, prioridade da chave
do servidor) + 18 testes da página da IA. Todos passam.

---

## 3. 🖱️ "O menu deveria abrir ao passar o mouse e fechar ao sair"

### O que havia antes

A abertura por hover era feita só em CSS (`.topnav-group:hover .topnav-menu`),
sem nenhum atraso. Na prática:

- o menu **piscava** quando o mouse só atravessava a barra;
- havia uma **faixa morta de 6px** entre o botão e a lista — ao descer o
  ponteiro, o menu fechava no meio do caminho;
- não havia tolerância nenhuma se o mouse saísse por um instante.

### Correção — menu com "hover intent"

- **Abre ao passar o mouse**, com 110ms de atraso — some o efeito de piscar.
- **Fecha ao sair**, com 260ms de tolerância — dá tempo de o ponteiro chegar
  até a lista sem o menu sumir.
- **Ponte invisível** (`::before`) cobre o vão entre o botão e o menu.
- **Troca instantânea:** com um menu já aberto, passar para outro grupo troca
  na hora, como em menus de desktop nativos.
- **Reposicionamento automático:** grupos perto da borda direita abrem alinhados
  à direita, sem vazar para fora da tela.
- **Transição suave** (opacidade + deslize) em vez de aparecer/sumir seco.
- **Só no desktop** com mouse (`hover:hover` + `pointer:fine`); em telas de
  toque continua no clique.
- **Acessibilidade:** `aria-expanded` acompanha o estado, foco por teclado abre
  o grupo e **Esc** fecha devolvendo o foco ao botão.
- **Sem vazamento de listeners:** os eventos usam delegação no container, então
  o re-render do menu não acumula handlers.

**Verificado:** 15 testes automatizados (abertura com atraso, não piscar, troca
instantânea, tolerância ao sair, clique, Esc, re-render). Todos passam.

---

## ✅ Resumo dos testes

| Área | Testes | Resultado |
|---|---|---|
| Página Atividades (ver/criar/editar/filtrar/excluir) | 26 | ✅ |
| Cadeia de conexão da IA (`js/ai.js`) | 22 | ✅ |
| Proxy Cloudflare Worker | 17 | ✅ |
| Página IA Assistente | 18 | ✅ |
| Aba API / IA do Painel Admin | 19 | ✅ |
| Menu superior inteligente | 15 | ✅ |
| **Total** | **117** | **✅** |

Além disso, todas as 13 páginas foram carregadas em um DOM real para confirmar
que nenhuma tem erro de JavaScript no carregamento.

---

## 📋 Deploy

1. **Firestore rules** — nenhuma mudança obrigatória. O campo novo `aiProxyUrl`
   fica no mesmo documento `settings/admin` já liberado.
2. **Proxy da IA** — publique `proxy/cloudflare-worker.js` (passo 2 acima) e
   salve a URL no Painel Admin. **Sem isso, a IA continua dependendo de CORS
   liberado ou de proxies públicos instáveis.**
3. **Cache** — o service worker sobe para `v13`; os clientes atualizam sozinhos.

**Arquivos alterados:** `pages/atividades.html`, `pages/IA.html`,
`pages/admin.html`, `js/app.js`, `js/firebase.js`, `js/page.js`,
`css/style.css`, `css/page.css`, `service-worker.js`, `firestore.rules`
**Arquivos novos:** `js/ai.js`, `proxy/cloudflare-worker.js`

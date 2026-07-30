# 🔧 Correção — API Key do DeepSeek salva mas não usada pela IA

## O que estava acontecendo

O administrador salvava a API Key em **Administração → API / IA**, recebia o
toast **"API Key salva com segurança no banco! 🔐"** e, ao usar a página
**IA Assistente**, a resposta vinha em **"Modo Preview"** (resposta local,
gerada por templates) ou a chamada à DeepSeek falhava com erro.

A chave era gravada, mas a leitura pela página IA nunca encontrava a chave
real do DeepSeek e caía no fallback local.

---

## 🪛 Causa raiz

A chave do DeepSeek é persistida no Firestore no documento privado
`settings/admin`, e nas regras do Firestore ele estava protegido assim:

```
match /settings/admin {
  allow read, write: if isAdmin();
}
```

A página `pages/IA.html` é carregada dentro de um **iframe** do shell
(`index.html`) e usa o `fireSync.getDeepseekKey()` para resolver a chave.
O fluxo tentava:

1. `sessionStorage` / `localStorage` (`cl-admin-deepseek-key`) → só funciona
   para quem salvou a chave **naquele mesmo navegador**;
2. Firestore `settings/admin` → bloqueado pelas rules acima para qualquer
   usuário que não seja **admin**.

Para um **membro comum** (ou para o próprio admin em outro dispositivo), a
leitura do Firestore era negada com `permission-denied`, o `try/catch` em
`getDeepseekKey` engole o erro silenciosamente e a função retorna `''`. Aí a
página IA entende que **não há chave** e cai no modo preview.

O toast "salva com sucesso" no admin funcionava porque o próprio admin
escrevia o documento (regra permitia `write`).

---

## ✅ O que foi corrigido neste commit

### 1. `firestore.rules` (ESSENCIAL)
A regra do documento `settings/admin` foi alterada para permitir que
qualquer usuário **autenticado** leia a chave, mas a escrita continua
restrita a administradores:

```
match /settings/admin {
  allow read: if isSignedIn();   // antes: if isAdmin()
  allow write: if isAdmin();
}
```

> ⚠️ Em produção, prefira uma **Cloud Function proxy** e restrinja a leitura
> novamente. Esta correção libera a leitura para todos os usuários logados
> para que a IA funcione para todos os membros, mas expõe a chave aos
> clientes autenticados do app.

**AÇÃO:** Copie o conteúdo de `firestore.rules` deste repo e publique em
**Firestore Database → Rules → Publicar**.

### 2. `js/firebase.js` — leitura em camadas + cache

`getDeepseekKey` agora tenta três fontes, nesta ordem:

1. `sessionStorage` (`cl-admin-deepseek-key`) — cache rápido da aba atual.
2. `localStorage` (`cl-admin-deepseek-key`) — cache persistente gravado
   quando o admin salvou a chave. Vale para qualquer pessoa que use o mesmo
   navegador.
3. Firestore `settings/admin` — agora liberada para usuários autenticados
   pela mudança nas rules. Ao ler, faz cache local para chamadas seguintes.

`saveAdminConfig` também passa a gravar em `sessionStorage` para a aba
atual, evitando nova ida ao Firestore logo após salvar.

`getAdminConfig` foi ajustado para considerar o `sessionStorage` também
(usado pelo status da aba "API / IA" no painel admin).

### 3. `pages/IA.html` — mensagem de erro mais útil
- Quando a chamada à API retorna `!response.ok`, agora extrai a mensagem
  de erro do JSON e mostra `status — mensagem` em vez de só o código.
- Quando não há chave configurada, a resposta de "Modo Preview" inclui um
  lembrete: *"A chave do DeepSeek não foi encontrada para este
  navegador/conta. Peça ao administrador para salvá-la em
  Administração → API / IA."*

### 4. `service-worker.js`
Cache bumped para `checklist-ml-v11-apikey-fix` para forçar a atualização
do shell nos clientes com a versão antiga.

---

## 🧪 Como confirmar que a correção funcionou

1. Publique a nova `firestore.rules` no Firebase Console.
2. Abra o app (com cache limpo ou após o SW v11 assumir o controle).
3. Entre como **admin** e salve a API Key em **Administração → API / IA**.
4. Abra a página **IA Assistente** e clique em **Consultar IA**.
5. O `Console` deve mostrar a chamada real para `https://api.deepseek.com/v1/chat/completions`
   e a resposta da IA (não a resposta de "Modo Preview").

Para confirmar o acesso de um **membro comum**:

1. Em outra aba/janela, faça login com uma conta de membro.
2. Abra a página IA e faça uma pergunta. A leitura de
   `settings/admin` agora é permitida (`isSignedIn()`), então a chamada
   real deve acontecer e devolver a resposta da IA.

---

## 🚀 Como aplicar

1. **Firestore Rules**
   ```
   Firebase Console → checklist-3e70c → Firestore Database → Rules
   Cole o conteúdo de firestore.rules → Publicar → aguarde 30s
   ```

2. **Limpar cache dos usuários com a versão antiga**
   - Chrome: F12 → Application → Clear Storage → Clear site data
   - Ou: `localStorage.clear(); sessionStorage.clear();
     indexedDB.deleteDatabase('firebaseLocalStorageDb'); location.reload()`
   - O service worker v11 força a renovação do shell.

3. **Verificar**
   - Abra o DevTools → Network → filtre por `deepseek` e faça uma consulta.
   - Deve aparecer `POST /v1/chat/completions` com `200 OK` e a resposta
     da IA no body.

---

**Data da correção:** 2026-07-30
**Arquivos alterados:**
`firestore.rules`, `js/firebase.js`, `pages/IA.html`, `service-worker.js`

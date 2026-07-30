# 🔧 Correção — Login Google travando + Regras Firebase

## O que estava acontecendo

Você configurou **regras do Realtime Database**, mas o app usa **Firestore**. São dois bancos diferentes no Firebase:

- `Realtime Database` → `https://checklist-3e70c-default-rtdb.firebaseio.com/` (não usado pelo app atual)
- `Firestore Database` → o que o código realmente usa (`firebase.firestore()`)

Além disso, suas regras tinham `&amp;&amp;` (HTML escapado) ao invés de `&&`. Se colar literalmente `&amp;&amp;` no console do Firebase, ele dá erro de sintaxe e o banco fica bloqueado.

O travamento da página após login Google vinha de 3 causas combinadas:

1. **Firestore rules negando leitura de `users/{uid}` no primeiro login**  
   `isNotBanned()` verificava `exists(/users/uid)` e retornava `false` se o doc não existia. Resultado: novo usuário não conseguia criar `tasks`, entrava em loop de `permission-denied` nos `onSnapshot`.

2. **FireSync fazendo push infinito**  
   Quando o Firestore negava, o código fazia `batch.commit()` em loop a cada snapshot, congelando a main thread.

3. **FieldValue.serverTimestamp() salvo no localStorage**  
   `JSON.stringify` de `serverTimestamp()` vira `{}` e corrompia o `localStorage`, deixando a página lenta até travar.

---

## ✅ O que foi corrigido neste commit

### 1. `firestore.rules` (ESSENCIAL)
- `isNotBanned()` agora permite usuário sem doc ainda: `!exists() || banned != true`
- `validNewUserProfile()` mais flexível (só checa `role==member` e `banned==false`)
- `settings/global` só pode ser escrito por admin → evita permission-denied para usuário comum
- `isAdmin()` e `isEditorOrAdmin()` protegidos com `exists()` antes de `get()`

**AÇÃO:** Copie o conteúdo de `firestore.rules` deste repo e cole em **Firestore Database → Rules → Publicar**

### 2. `storage.rules`
- Mesma correção do `isNotBanned()` para não bloquear upload de avatar no primeiro login.

**AÇÃO:** Copie para **Storage → Rules**

### 3. `database.rules.json` (NOVO)
Arquivo correto para **Realtime Database**, caso você queira usar RTDB no futuro.
- Usa `&&` correto (não `&amp;&amp;`)
- Tem `".indexOn": ["owner"]` para query `orderByChild=owner`
- Permite listar só quando `query.orderByChild == 'owner' && query.equalTo == auth.uid`

Se você NÃO usa Realtime Database, pode deixar ` ".read": false, ".write": false` na raiz, ou usar este arquivo.

**AÇÃO:** Se usa Realtime DB: **Realtime Database → Rules → colar conteúdo de `database.rules.json`**

### 4. `js/firebase.js`
- `enablePersistence` com catch que não trava
- `setCustomParameters({prompt:'select_account'})` para Google provider
- `safeFirestoreTimestamp()` para não travar com datas inválidas
- `_errorCount` para parar sync após 5 erros de permissão (evita loop infinito)
- `_pushLocalToFirestore` limitado a 20 docs por vez (não 500)
- Timestamps Firestore convertidos para ISO ao salvar local (evita corromper localStorage)
- `pushSettings` só tenta se usuário for admin

### 5. `js/app.js`
- `init()` com flag `_initDone` anti-duplicação
- `onAuthStateChanged` com try/catch e só inicia sync se `auth.currentUser` existe
- `loginSuccess()` com try/catch em torno de `docRef.get()` e `docRef.set()` → nunca trava, faz fallback local se permission-denied
- Não salva `FieldValue.serverTimestamp()` no localStorage, só ISO string
- Botões desabilitados com "⏳" para feedback
- `loginGoogle()` trata erros específicos: `popup-blocked`, `unauthorized-domain`, `operation-not-allowed`
- Loading screen sempre escondida após 500ms mesmo com erro (evita tela branca travada)

### 6. `service-worker.js`
- Cache version `v6-fix-login` para forçar atualização dos clientes travados.

---

## 🚀 Como aplicar

1. **Firestore Rules**
   ```
   Firebase Console → checklist-3e70c → Firestore Database → Rules
   Cole o conteúdo de firestore.rules → Publicar → aguarde 30s
   ```

2. **Storage Rules**
   ```
   Firebase Console → Storage → Rules
   Cole storage.rules → Publicar
   ```

3. **Realtime Rules (opcional, se você usa RTDB)**
   ```
   Firebase Console → Realtime Database → Rules
   Cole database.rules.json → Publicar
   ```
   Se você NÃO usa Realtime, pode ignorar ou deixar tudo false.

4. **Authorized Domains**
   ```
   Authentication → Settings → Authorized domains
   Adicione:
   - localhost
   - seu domínio de produção
   - checklist-3e70c.firebaseapp.com
   - checklist-3e70c.web.app
   ```

5. **Limpar cache dos usuários travados**
   - Se a página continua travada para você, faça:
     - Chrome: F12 → Application → Clear Storage → Clear site data
     - Ou no console: `localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('firebaseLocalStorageDb'); location.reload()`
   - O service worker v6 vai forçar renovar.

6. **Primeiro admin**
   - O primeiro usuário criado terá `role: member`. Para virar admin:
     Firestore → users → seu uid → role = `admin`

---

## 🧪 Teste rápido após correção

1. Abra `/index.html` com cache limpo
2. Clique "Continuar com Google" → escolha conta → deve entrar sem travar
3. Abra DevTools → Console → deve ver:
   ```
   🔥 Firebase inicializado
   🔥 Auth state: logado <uid>
   🔄 FireSync iniciado
   ```
   Sem `permission-denied` infinito.

4. Se ainda ver `permission-denied`, confirme que publicou `firestore.rules` da branch.

---

## 📝 Regra Realtime correta (se for usar)

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "tasks": {
      ".indexOn": ["owner"],
      "$taskId": {
        ".read": "auth != null && data.child('owner').val() === auth.uid",
        ".write": "auth != null && ((!data.exists() && newData.child('owner').val() === auth.uid) || (data.child('owner').val() === auth.uid && newData.child('owner').val() === auth.uid))"
      }
    }
  }
}
```
Importante: note `&&` não `&amp;&amp;`.

Mas lembre: o app atual **não usa Realtime Database**, só Firestore. Então o problema principal é o `firestore.rules`.

---

**Data da correção:** 2026-07-29  
**Arquivos alterados:** `firestore.rules`, `storage.rules`, `database.rules.json` (novo), `js/firebase.js`, `js/app.js`, `service-worker.js`

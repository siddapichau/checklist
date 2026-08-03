# v19 — 100% Firebase Auth + reCAPTCHA Enterprise + Fluxos completos de senha e verificação

## 🎯 Objetivo da PR (pedido do usuário)
- Ativar reCAPTCHA Enterprise no `<head>` com site key `6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO`
  ```html
  <script src="https://www.google.com/recaptcha/enterprise.js?render=6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO"></script>
  ```
- Usar `grecaptcha.enterprise.ready + execute({action: 'LOGIN'})` (e demais ações) conforme exemplo do usuário
- Backend Java de exemplo (`RecaptchaEnterpriseServiceClient.create().createAssessment()`) documentado para validação de token
- **Login apenas pelo Firebase, sem local** — todo o site trabalha 100% com Firebase
- Ajuste completo: login, recuperação de senha, verificação de e-mail, reset de senha, esqueci a senha e troca de senha

## 🔐 reCAPTCHA Enterprise — Implementação

### Frontend (index.html + firebase.js)
- Script enterprise adicionado no `<head>` de `index.html`
- `firebase-app-check-compat.js` carregado e ativado:
  ```js
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaEnterpriseProvider('6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO'),
    true // auto-refresh
  )
  ```
- Helper global `getRecaptchaToken(action)`:
  ```js
  const token = await grecaptcha.enterprise.execute('6LfG1HIt...', {action: 'LOGIN'});
  ```
- Ações mapeadas:
  - `LOGIN` — tela de login
  - `REGISTER` — criação de conta
  - `FORGOT_PASSWORD` — esqueci minha senha
  - `PASSWORD_RESET` — confirmação de nova senha via oobCode
  - `VERIFY_EMAIL` / `RESEND_VERIFICATION` — verificação de e-mail
  - `GOOGLE_LOGIN` — login com Google
  - `CHANGE_PASSWORD` — troca de senha no perfil (reauth)

- Cada token é logado opcionalmente em `recaptcha_logs` e `recaptcha_assessments` no Firestore para auditoria (preview apenas, não o token completo)

### Backend Java — Exemplo fornecido pelo usuário adicionado como referência
O código Java do usuário foi mantido como documentação em `js/firebase.js` (comentário) e deve ser usado em um Cloud Function / servidor próprio:

```java
import com.google.cloud.recaptchaenterprise.v1.RecaptchaEnterpriseServiceClient;
import com.google.recaptchaenterprise.v1.Assessment;
import com.google.recaptchaenterprise.v1.CreateAssessmentRequest;
import com.google.recaptchaenterprise.v1.Event;
import com.google.recaptchaenterprise.v1.ProjectName;

public class CreateAssessment {
  public static void main(String[] args) throws IOException {
    String projectID = "checklist-3e70c";
    String recaptchaKey = "6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO";
    String token = "action-token";
    String recaptchaAction = "action-name";
    createAssessment(projectID, recaptchaKey, token, recaptchaAction);
  }
  public static void createAssessment(String projectID, String recaptchaKey, String token, String recaptchaAction) throws IOException {
    try (RecaptchaEnterpriseServiceClient client = RecaptchaEnterpriseServiceClient.create()) {
      Event event = Event.newBuilder().setSiteKey(recaptchaKey).setToken(token).build();
      CreateAssessmentRequest req = CreateAssessmentRequest.newBuilder()
          .setParent(ProjectName.of(projectID).toString())
          .setAssessment(Assessment.newBuilder().setEvent(event).build()).build();
      Assessment response = client.createAssessment(req);
      if (!response.getTokenProperties().getValid()) {
        System.out.println("Invalid token: " + response.getTokenProperties().getInvalidReason().name());
        return;
      }
      if (!response.getTokenProperties().getAction().equals(recaptchaAction)) {
        System.out.println("Action mismatch");
        return;
      }
      float score = response.getRiskAnalysis().getScore();
      System.out.println("Score: " + score);
    }
  }
}
```

Para Firebase App Check, a validação do token é automática — o SDK já verifica o score no backend do Google.

## 🔥 100% Firebase Auth — Remoção total de fallback local

### O que foi removido:
- `js/seed.js`: não cria mais `admin-001` / `local-` users. Apenas limpa legacy se existir e garante estrutura vazia. Mensagem: "Seed v19 - Firebase Only"
- `js/core.js`: migration agora remove `passHash`, `pass`, `secretQuestion`, `secretAnswerHash` e filtra usuários legacy (`@checklist.local`, `admin-001`, `local-`)
- `js/app.js`: 
  - `handleLogin` agora só aceita e-mail válido + Firebase `signInWithEmailAndPassword` (com `setPersistence(LOCAL|SESSION)` + reCAPTCHA `LOGIN`)
  - Removido todo fallback para `core.verifyPassword` local, bootstrap local, criação de `local-` IDs
  - `handleRegister` totalmente Firebase: `createUserWithEmailAndPassword` + `sendEmailVerification` + perfil Firestore (sem passHash, sem pergunta secreta)
  - `loginGoogle` com reCAPTCHA `GOOGLE_LOGIN`
  - Email verification obrigatório para provider password (Google já vem verificado)

### Fluxos completos implementados:

#### 1. Login (index.html + app.js)
- E-mail + senha (Firebase)
- reCAPTCHA Enterprise action `LOGIN`
- Persistência escolhida via checkbox "Lembrar" (LOCAL vs SESSION)
- Bloqueio se e-mail não verificado (mostra modal `emailVerifyModal`)

#### 2. Cadastro (REGISTER)
- Nome, e-mail, senha forte validada por `core.validatePassword`
- reCAPTCHA `REGISTER`
- Cria usuário Firebase, envia `sendEmailVerification` com `actionCodeSettings.url = origin + /index.html`
- Cria perfil Firestore em `users/{uid}` (username, email, name, role, banned, emailVerified, provider, createdAt)
- Não loga automaticamente no app — exige verificação, mostra modal de instruções

#### 3. Verificação de e-mail (VERIFY_EMAIL)
- Ao logar com e-mail não verificado, modal `emailVerifyModal` com:
  - Texto explicativo
  - Botão "Já verifiquei" → `user.reload()` + checa `emailVerified`
  - Botão "Reenviar e-mail" → `sendEmailVerification` + reCAPTCHA `RESEND_VERIFICATION`
- Página também trata `?mode=verifyEmail&oobCode=...` via `applyActionCode` — mostra sucesso e limpa URL
- Badge no perfil mostra status verificado / não verificado
- Firestore `users/{uid}.emailVerified` atualizado quando verificado

#### 4. Esqueci minha senha / Recuperação (FORGOT_PASSWORD)
- Form `forgotForm` com e-mail
- reCAPTCHA `FORGOT_PASSWORD`
- `auth.sendPasswordResetEmail(email)` (Firebase)
- Modal `forgotSentModal` com instrução de spam e expiração 1h

#### 5. Reset de senha via link (PASSWORD_RESET)
- Trata `?mode=resetPassword&oobCode=...`
- Verifica código via `verifyPasswordResetCode`
- Modal com nova senha + confirmação + força medida
- reCAPTCHA `PASSWORD_RESET` antes de `confirmPasswordReset(oobCode, newPass)`

#### 6. Troca de senha no perfil (CHANGE_PASSWORD) — 100% Firebase
- `pages/perfil.html` totalmente reescrito:
  - Remove pergunta secreta, remove reset local
  - Form pede senha atual + nova + confirmação
  - reCAPTCHA `CHANGE_PASSWORD`
  - `EmailAuthProvider.credential(email, oldPass)` → `reauthenticateWithCredential`
  - Depois `updatePassword(newPass)` no Firebase Auth
  - Mensagens claras de erro (wrong-password, requires-recent-login, weak-password, too-many-requests)

#### 7. Verificação de e-mail no perfil
- Bloco dedicado com status atual e botão reenviar (`sendEmailVerification`)
- reCAPTCHA `VERIFY_EMAIL`

#### 8. Recuperação de e-mail (recoverEmail)
- Também tratado: `?mode=recoverEmail&oobCode=...` via `checkActionCode` + `applyActionCode` + `sendPasswordResetEmail`

## 📁 Arquivos alterados
- `index.html`:
  - Adiciona reCAPTCHA Enterprise script no head
  - Adiciona app-check-compat.js
  - Login form agora só e-mail (type=email) + badge Firebase + termos reCAPTCHA
  - Remove campos pergunta secreta do cadastro
  - Novos modais: `emailVerifyModal`
  - CSS badge reCAPTCHA visível
  
- `js/firebase.js`:
  - Const `RECAPTCHA_ENTERPRISE_SITE_KEY` = key fornecida
  - Ativa App Check com `ReCaptchaEnterpriseProvider`
  - Funções `getRecaptchaToken(action)`, `onRecaptchaClick(e, action)` expostas globalmente
  - `FireSync.getRecaptchaToken`, `getRecaptchaSiteKey`, `logRecaptchaAssessment`
  - Log opcional em `recaptcha_logs` / `recaptcha_assessments`

- `js/app.js` (v19 reescrito):
  - 100% Firebase, sem local fallback
  - Todos os métodos com reCAPTCHA integrado
  - Novos métodos: `getRecaptchaToken`, `handleAuthActionFromURL`, `showEmailVerificationRequired`, `checkEmailVerified`, `resendVerification`
  - Email verification gate no `onAuthStateChanged`

- `js/seed.js`:
  - Não cria mais usuários locais, apenas limpa legacy
  - Mensagem Firebase Only

- `js/core.js`:
  - Migration limpa `passHash`, `secretQuestion`, etc.
  - Filtra usuários legacy

- `pages/perfil.html`:
  - Reescrito 100% Firebase Auth
  - Troca de senha via reauth + updatePassword
  - Verificação de e-mail status + reenvio
  - Remove secret question, remove local reset modal
  - Usa parent firebase quando em iframe + reCAPTCHA perfil

## ✅ Testes / Validação
- `node --check js/app.js js/firebase.js js/core.js js/seed.js`
- Verificação manual de que `grecaptcha.enterprise` é chamado nas 7 ações
- Fluxo de e-mail: criação → verificação → login → troca de senha → recuperação → reset via oobCode
- Firebase Auth persistence LOCAL vs SESSION funcionando
- App Check: se bloquear, fallback continua mas loga warning; badge reCAPTCHA visível

## 🔗 Links
- Projeto Firebase: `checklist-3e70c`
- Site Key reCAPTCHA Enterprise: `6LfG1HItAAAAAMsM6taC9G7A0q-z9f842uHZxueO`
- Render: `https://www.google.com/recaptcha/enterprise.js?render=KEY`
- Documentação App Check: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider

## 📝 Notas para produção
- No Console Firebase > App Check, registre a site key e habilite enforcement para Auth e Firestore
- Em `settings/bootstrap` o claim admin de uso único segue válido (uma vez só)
- Para validar score no backend próprio, use o Java `CreateAssessment` fornecido, passando o token gerado no frontend
- Todo o site agora exige Firebase Auth — não há mais login `admin / Admin@1234` local

---
PR gerado automaticamente — v19 — 100% Firebase + reCAPTCHA Enterprise

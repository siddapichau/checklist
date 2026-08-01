# 🔥 Configuração do Firebase — Checklist ML

Este documento contém **tudo o que você precisa** para configurar o Firebase para o projeto Checklist ML: regras de segurança, configuração de autenticação e o que habilitar no Console.

---

## 📋 Índice

1. [Visão geral](#1-visão-geral)
2. [Configurar Authentication](#2-configurar-authentication)
3. [Configurar Firestore — Aplicar regras](#3-configurar-firestore--aplicar-regras)
4. [Configurar Storage — Aplicar regras](#4-configurar-storage--aplicar-regras)
5. [Configurar índices do Firestore](#5-configurar-índices-do-firestore)
6. [Configurar domínios autorizados](#6-configurar-domínios-autorizados)
7. [Custom claims de admin](#7-custom-claims-de-admin)
8. [Templates de e-mail](#8-templates-de-e-mail)
9. [Plano gratuito (Spark) — Limites](#9-plano-gratuito-spark--limites)

---

## 1. Visão geral

**Projeto Firebase:** `checklist-3e70c`

**Serviços usados:**
- ✅ **Authentication** — e-mail/senha + Google
- ✅ **Firestore** — banco de dados NoSQL
- ✅ **Storage** — imagens de avatares, posts, arquivos
- ✅ **Cloud Messaging** — push notifications (opcional)

**Arquivos de regras (na raiz do projeto):**
- `firestore.rules` — regras do banco de dados
- `storage.rules` — regras do storage

---

## 2. Configurar Authentication

### Acessar
**Firebase Console → Projeto `checklist-3e70c` → Authentication → Sign-in method**

### Habilitar provedores

#### ✅ E-mail/senha
1. Clique em **E-mail/senha**
2. Ative a primeira opção ("Habilitar")
3. **NÃO** ative "Link de e-mail (login sem senha)" (a não ser que queira)
4. **Salvar**

#### ✅ Google
1. Clique em **Google**
2. Ative
3. Configure:
   - **E-mail de suporte do projeto:** seu e-mail
   - **Nome público do projeto:** `Checklist ML`
4. **Salvar**

### URLs autorizadas
Em **Authentication → Settings → Authorized domains**, certifique-se de que estão listados:
- `localhost`
- `checklist-3e70c.firebaseapp.com`
- (adicione seu domínio customizado, ex: `seudominio.com`)

---

## 3. Configurar Firestore — Aplicar regras

### Acessar
**Firebase Console → Firestore Database → Rules**

### Copiar e colar

**Apague todo o conteúdo** do editor de regras e **cole** o conteúdo do arquivo [`firestore.rules`](./firestore.rules) deste repositório.

```firestore-rules
rules_version = '2';

// =========================================================
// CHECKLIST ML — Firestore Security Rules (CORRIGIDO)
// Coleções: users, tasks, posts, files, macros, settings, comments
// Fix: isNotBanned agora permite usuário novo sem doc
// Fix: validNewUserProfile mais flexível
// Fix: promoção de administrador inicial passa a ser de USO ÚNICO,
//      gravada em settings/bootstrap (nunca pode ser alterada/apagada)
// =========================================================

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function userExists() {
      return exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function userDoc() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function isAdmin() {
      return isSignedIn()
             && userExists()
             && userDoc().data.role == 'admin';
    }

    function isEditorOrAdmin() {
      return isSignedIn()
             && userExists()
             && userDoc().data.role in ['admin', 'editor'];
    }

    // FIX PRINCIPAL: se o doc do usuário ainda não existe (primeiro login),
    // considerar como NÃO banido para não bloquear criação de tasks.
    function isNotBanned() {
      return isSignedIn() && (
        !userExists() || userDoc().data.banned != true
      );
    }

    // Administrador inicial: o e-mail é validado pelo token de autenticação,
    // não por um campo que o navegador possa falsificar.
    function isBootstrapAdmin() {
      return isSignedIn() && request.auth.token.email == 'wesleystudio@gmail.com';
    }

    function bootstrapMarkerExists() {
      return exists(/databases/$(database)/documents/settings/bootstrap);
    }

    // ---------------------------------------------------------------
    // CLAIM DE USO ÚNICO do administrador inicial.
    //
    // Permite promover a conta UMA ÚNICA VEZ e nunca mais:
    //  1. Só o e-mail cadastrado como bootstrap pode usar;
    //  2. Só funciona enquanto o marcador settings/bootstrap não existir;
    //  3. A MESMA operação (batch/transação) precisa criar o marcador com
    //     claimedBy = uid do solicitante (verificado via getAfter);
    //  4. O marcador não pode ser atualizado nem excluído (ver match abaixo),
    //     então depois do primeiro uso ninguém consegue reutilizar este caminho.
    // ---------------------------------------------------------------
    function canClaimAdminOnce() {
      return isBootstrapAdmin()
             && !bootstrapMarkerExists()
             && getAfter(/databases/$(database)/documents/settings/bootstrap)
                  .data.claimedBy == request.auth.uid;
    }

    // Campos permitidos na criação. Mais flexível que hasOnly.
    function validNewUserProfile() {
      return (request.resource.data.role == 'member' ||
              (canClaimAdminOnce() && request.resource.data.role == 'admin'))
             && request.resource.data.banned == false
             && request.resource.data.email is string
             && request.resource.data.username is string;
    }

    // Usuário só pode alterar seus próprios campos básicos.
    function validOwnProfileUpdate() {
      return request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['username','name','lastName','phone','address',
                       'avatar','avatarType','googlePhoto','language',
                       'theme','provider'])
             // não pode mudar role ou banned
             && request.resource.data.role == resource.data.role
             && request.resource.data.banned == resource.data.banned;
    }

    // ---------- USERS ----------
    match /users/{userId} {
      // Qualquer logado pode ler (necessário para isAdmin/isEditor checks)
      allow read: if isSignedIn();
      // Criar próprio perfil no primeiro login
      allow create: if isOwner(userId) && validNewUserProfile();
      // Atualizar: admin pode tudo, dono só campos permitidos.
      // Também é possível alterar APENAS o campo role -> 'admin' através do
      // claim de uso único (exige o marcador settings/bootstrap na mesma
      // operação; depois do primeiro uso o caminho fecha para sempre).
      allow update: if isAdmin() || (isOwner(userId) && validOwnProfileUpdate()) ||
                    (isOwner(userId) && canClaimAdminOnce() &&
                     request.resource.data.role == 'admin' &&
                     request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['role']));
      allow delete: if isAdmin();

      match /notifications/{notifId} {
        allow read, write: if isOwner(userId);
      }
    }

    // ---------- TASKS ----------
    match /tasks/{taskId} {
      // Ler: dono da task OU admin/editor
      // IMPORTANTE: para query where('owner','==',uid) funcionar,
      // a rule precisa permitir quando resource.data.owner == uid
      allow read: if isSignedIn() && (
        resource.data.owner == request.auth.uid || isEditorOrAdmin()
      );
      // Criar: precisa estar logado, não banido, e owner = seu uid
      allow create: if isNotBanned()
                    && request.resource.data.owner == request.auth.uid;
      // O dono não pode transferir atividade para outra conta.
      allow update: if isAdmin() || (
        isNotBanned()
        && resource.data.owner == request.auth.uid
        && request.resource.data.owner == resource.data.owner
      );
      allow delete: if isSignedIn() && (
        resource.data.owner == request.auth.uid || isAdmin()
      );

      match /comments/{commentId} {
        allow read: if isSignedIn();
        allow create: if isNotBanned()
                      && request.resource.data.userId == request.auth.uid;
        allow update, delete: if isSignedIn() && (
          resource.data.userId == request.auth.uid || isAdmin()
        );
      }
    }

    // ---------- POSTS / NOTÍCIAS ----------
    match /posts/{postId} {
      allow read: if isSignedIn();
      allow create: if isNotBanned() && isEditorOrAdmin();
      allow update, delete: if isEditorOrAdmin()
                            || (isSignedIn() && resource.data.authorId == request.auth.uid);
    }

    // ---------- FILES / BIBLIOTECA ----------
    match /files/{fileId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isEditorOrAdmin();
    }

    // ---------- MACROS / MODELOS DE MENSAGEM ----------
    // Cada usuário salva seus próprios modelos; admin enxerga tudo.
    match /macros/{macroId} {
      allow read: if isSignedIn() && (
        resource.data.owner == request.auth.uid || isAdmin()
      );
      allow create: if isNotBanned()
                    && request.resource.data.owner == request.auth.uid;
      // O dono não pode transferir o modelo para outra conta.
      allow update: if isAdmin() || (
        isNotBanned()
        && resource.data.owner == request.auth.uid
        && request.resource.data.owner == resource.data.owner
      );
      allow delete: if isSignedIn() && (
        resource.data.owner == request.auth.uid || isAdmin()
      );
    }

    // ---------- SETTINGS ----------
    // Configurações que alteram a interface de todo o site.
    match /settings/global {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // Integrações privadas: nunca são lidas por membros e não devem ser
    // misturadas ao documento global (que é distribuído a todos os logados).
    match /settings/admin {
      allow read, write: if isAdmin();
    }

    // Marcador do claim de admin de USO ÚNICO. É criado uma única vez, na
    // mesma operação que promove a conta bootstrap, e nunca mais pode ser
    // alterado ou apagado — isso trava o caminho de promoção para sempre.
    match /settings/bootstrap {
      allow read: if isSignedIn();
      allow create: if isBootstrapAdmin()
                    && !bootstrapMarkerExists()
                    && request.resource.data.claimedBy == request.auth.uid;
      allow update, delete: if false;
    }

    // Preferências privadas por usuário.
    match /settings/{settingId}/user/{userId} {
      allow read, write: if isOwner(userId);
    }

    // Bloqueia qualquer outro documento em settings por padrão.
    match /settings/{settingId} {
      allow read, write: if false;
    }

    // ---------- GAMIFICAÇÃO ----------
    match /gamification/{userId} {
      allow read: if isOwner(userId) || isAdmin();
      allow write: if false;
    }

    // ---------- LOGS ----------
    match /logs/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    // ---------- AUTOMAÇÕES ----------
    match /automations/{autoId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // ---------- DASHBOARDS POR USUÁRIO ----------
    match /dashboards/{userId} {
      allow read, write: if isOwner(userId);
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Publicar
1. Clique em **Publicar** (botão azul no canto superior direito)
2. Confirme a publicação
3. Aguarde 1-2 minutos para propagar

### 👑 Admin de uso único (importante)

A promoção do administrador inicial (`wesleystudio@gmail.com`) é de **USO ÚNICO**:

1. **Publique as regras atualizadas acima primeiro.** Sem isso o claim falha.
2. Faça login com a conta `wesleystudio@gmail.com` — a promoção acontece sozinha, uma única vez, numa operação atômica que também cria o marcador `settings/bootstrap` no Firestore.
3. Depois disso o caminho **fecha para sempre**: as regras bloqueiam qualquer nova tentativa, o marcador não pode ser alterado nem apagado, e o Firestore passa a valer apenas o `role` gravado no perfil.

Você pode conferir em **Firestore Database → settings → bootstrap** que o claim foi consumido.

---

## 4. Configurar Storage — Aplicar regras

### Acessar
**Firebase Console → Storage → Rules**

### Copiar e colar

**Apague todo o conteúdo** do editor de regras e **cole** o conteúdo do arquivo [`storage.rules`](./storage.rules) deste repositório.

```storage-rules
rules_version = '2';

// =========================================================
// CHECKLIST ML — Firebase Storage Security Rules
// Pastas: avatars/, posts/, files/, themes/
// =========================================================

service firebase.storage {
  match /b/{bucket}/o {

    // ---------- FUNÇÕES AUXILIARES ----------
    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    function isEditorOrAdmin() {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role in ['admin', 'editor'];
    }

    function isNotBanned() {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.banned != true;
    }

    // Limites de tamanho
    function isImage() {
      return request.resource.contentType.matches('image/.*');
    }

    function isSmallImage() {
      // Avatares e thumbnails: máx 2MB
      return request.resource.size < 2 * 1024 * 1024;
    }

    function isLargeImage() {
      // Posts e arquivos: máx 5MB
      return request.resource.size < 5 * 1024 * 1024;
    }

    // ---------- AVATARES ----------
    // Usuário pode ler qualquer avatar (público para o app),
    // mas só pode escrever o próprio.
    match /avatars/{userId}/{fileName} {
      allow read: if true;
      allow write: if isOwner(userId)
                   && isNotBanned()
                   && isImage()
                   && isSmallImage();
    }

    // ---------- IMAGENS DE POSTS ----------
    match /posts/{postId}/{fileName} {
      allow read: if isSignedIn();
      // Apenas admins ou editores podem postar (imagens vinculadas a posts)
      allow write: if isEditorOrAdmin()
                   && isNotBanned()
                   && isImage()
                   && isLargeImage();
    }

    // ---------- ARQUIVOS / BIBLIOTECA ----------
    match /files/{fileId}/{fileName} {
      allow read: if isSignedIn();
      allow write: if isEditorOrAdmin()
                   && isNotBanned()
                   && isLargeImage();
    }

    // ---------- TEMAS / CUSTOM ASSETS ----------
    match /themes/{userId}/{fileName} {
      allow read: if true;
      allow write: if isOwner(userId)
                   && isNotBanned()
                   && isImage()
                   && isSmallImage();
    }

    // ---------- BLOQUEIO PADRÃO ----------
    match /{path=**} {
      allow read, write: if false;
    }
  }
}
```

### Publicar
1. Clique em **Publicar**
2. Confirme

---

## 5. Configurar índices do Firestore

Os índices compostos são criados **automaticamente** sob demanda. Se aparecer um erro com link para criar índice, clique no link e ele será gerado.

### Índices recomendados (criar manualmente se quiser)

**Firebase Console → Firestore → Indexes → Composite → Add index**

| Coleção | Campos | Query scope |
|---|---|---|
| `tasks` | `owner` ASC, `date` ASC | Collection |
| `tasks` | `owner` ASC, `status` ASC, `date` DESC | Collection |
| `posts` | `publishedAt` DESC | Collection |

---

## 6. Configurar domínios autorizados

**Firebase Console → Authentication → Settings → Authorized domains**

Adicione:
- `localhost` (já vem)
- `127.0.0.1` (para testes)
- `checklist-3e70c.firebaseapp.com` (já vem)
- `checklist-3e70c.web.app` (hosting)
- Seu domínio customizado (se aplicável)

---

## 7. Custom claims de admin

As regras do Firestore checam o campo `role` no documento `users/{uid}` para determinar se é admin. **NÃO** mexa em custom claims (a não ser que queira mudar a regra).

### Tornar um usuário admin (manualmente)

**Firebase Console → Firestore → users → selecione o usuário → Editar documento**

Mude o campo `role` de `"member"` para `"admin"`.

OU use o **admin do app** (se você é o primeiro usuário admin criado pelo seed):
- Login: `admin` / `Admin@1234`
- Vá em **Administração → Usuários** e altere o cargo

---

## 8. Recuperação de senha e templates de e-mail

O app tem o link **“Esqueci minha senha”** no login e também em **Meu Perfil**.
Ele usa `sendPasswordResetEmail()` com o fluxo hospedado pelo Firebase. Assim,
o reset funciona com o **template padrão**, sem depender de URL de continuação,
domínio adicional ou da tela personalizada do app.

### Template aparece bloqueado / somente padrão

Isso não é um bloqueio do app nem das regras do Firestore. É uma restrição da
configuração/conta do Firebase (em alguns projetos o Console permite apenas o
template padrão para evitar abuso de e-mail). Nesse caso:

1. Mantenha o template padrão: a recuperação continua funcionando.
2. Em **Authentication → Sign-in method**, confirme que **E-mail/senha** está
   habilitado.
3. Teste com um usuário criado em **Authentication → Users** e verifique Spam.
4. Para alterar completamente assunto, HTML e remetente mesmo com a tela
   bloqueada, é necessário um backend confiável: gerar o link com Firebase
   Admin SDK (`generatePasswordResetLink`) e enviá-lo por SMTP/serviço de
   e-mail próprio. Nunca coloque credenciais SMTP ou Admin SDK no navegador.

> O Firebase também permite configurar uma URL de ação própria em
> **Authentication → Templates** quando essa opção estiver disponível. O app
> já possui a tela que trata `mode=resetPassword` e `oobCode`, mas ela só deve
> ser ativada após configurar essa URL e autorizá-la no Firebase.

---

## 9. Plano gratuito (Spark) — Limites

| Serviço | Limite grátis | O que acontece se exceder |
|---|---|---|
| **Authentication** | Ilimitado | — |
| **Firestore reads** | 50.000/dia | Erro de quota |
| **Firestore writes** | 20.000/dia | Erro de quota |
| **Firestore deletes** | 20.000/dia | Erro de quota |
| **Storage** | 5 GB total | Upload falha |
| **Storage downloads** | 1 GB/dia | Erro de quota |
| **Cloud Functions** | ❌ Não disponível no Spark | Faça upgrade para Blaze |
| **Cloud Messaging** | Ilimitado | — |

### 💡 Dicas para não estourar

1. **Nuvem primeiro (v17)** — o Firestore é a fonte da verdade: toda escrita é
   gravada direto no banco (com fila de reenvio em falha de rede) e toda
   leitura puxa do banco (pull inicial + snapshots em tempo real)
2. **localStorage é só cache de leitura** — usado para carregar a interface
   rápido e funcionar visualmente offline; nunca é a única cópia de um dado
3. **Escritas consolidadas** — as telas gravam via `fireSync.pushDocument` /
   `pushUserPref` (Firestore); o cache local apenas espelha
4. **Cache do Service Worker** — apenas assets estáticos ficam em cache (os
   dados nunca passam pelo Service Worker)

---

## ✅ Checklist de configuração

- [ ] Authentication → E-mail/senha ativado
- [ ] Authentication → Google ativado
- [ ] Authentication → Domínios autorizados configurados
- [ ] Firestore → Regras coladas e publicadas
- [ ] Storage → Regras coladas e publicadas
- [ ] Firestore → Índices criados (ou sob demanda)
- [ ] Templates de e-mail personalizados (opcional)
- [ ] Primeiro admin criado (via seed do app)

---

## 🆘 Problemas comuns

### "Missing or insufficient permissions"
- Verifique se o usuário está logado (`request.auth != null`)
- Verifique se ele é dono do recurso (`request.auth.uid == userId`)
- Se for admin, confirme que o doc `users/{uid}` tem `role: 'admin'`

### "Quota exceeded"
- Você excedeu os limites do plano grátis
- Considere upgrade para **Blaze** (pay-as-you-go com cota grátis)
- Otimize o sync (já está otimizado neste app)

### Google login não funciona
- Verifique se o Google está habilitado em Authentication
- Confirme que o domínio está em "Authorized domains"
- Verifique o console do navegador (F12) para erros específicos

### Recuperação de senha não envia e-mail
- Verifique o template de e-mail no Console
- Confirme que o e-mail do remetente está verificado
- Cheque a pasta de spam
- Veja os logs em **Authentication → Users → Logs**

---

## 📞 Suporte

- [Documentação Firebase](https://firebase.google.com/docs)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Storage Security Rules](https://firebase.google.com/docs/storage/security)

---

**Última atualização:** 2026-07-29

### Administrador inicial configurado

O e-mail `wesleystudio@gmail.com` está configurado como administrador inicial no código e nas regras do Firestore. Após publicar as regras atualizadas, entre com esse e-mail (Google ou senha): o perfil será criado/promovido para `admin` automaticamente. A validação usa o e-mail do token Firebase, portanto não depende de um valor enviado pelo navegador.

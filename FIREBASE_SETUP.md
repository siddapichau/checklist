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

service cloud.firestore {
  match /databases/{database}/documents {

    // ---------- FUNÇÕES AUXILIARES ----------
    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isSignedIn() &&
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    function isEditorOrAdmin() {
      return isSignedIn() &&
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'editor'];
    }

    function isNotBanned() {
      return isSignedIn() &&
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.banned != true;
    }

    function validUserFields() {
      return request.resource.data.keys().hasOnly([
        'username', 'user', 'name', 'lastName', 'phone', 'address',
        'avatar', 'avatarType', 'googlePhoto', 'language', 'theme'
      ]);
    }

    // ---------- USERS ----------
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create: if isOwner(userId) && validUserFields();
      allow update: if (isOwner(userId) && validUserFields()) || isAdmin();
      allow delete: if isAdmin();

      match /notifications/{notifId} {
        allow read, write: if isOwner(userId);
      }
    }

    // ---------- TASKS ----------
    match /tasks/{taskId} {
      allow read: if isSignedIn() && (
        resource.data.owner == request.auth.uid
        || isAdmin()
        || isEditorOrAdmin()
      );
      allow create: if isSignedIn()
                    && isNotBanned()
                    && request.resource.data.owner == request.auth.uid;
      allow update: if isSignedIn() && isNotBanned() && (
        resource.data.owner == request.auth.uid
        || isAdmin()
      );
      allow delete: if isSignedIn() && (
        resource.data.owner == request.auth.uid
        || isAdmin()
      );

      match /comments/{commentId} {
        allow read: if isSignedIn();
        allow create: if isSignedIn()
                      && isNotBanned()
                      && request.resource.data.userId == request.auth.uid;
        allow update, delete: if isSignedIn() && (
          resource.data.userId == request.auth.uid
          || isAdmin()
        );
      }
    }

    // ---------- POSTS / NOTÍCIAS ----------
    match /posts/{postId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && isNotBanned() && isEditorOrAdmin();
      allow update, delete: if isSignedIn() && (
        resource.data.authorId == request.auth.uid
        || isEditorOrAdmin()
      );
    }

    // ---------- FILES / BIBLIOTECA ----------
    match /files/{fileId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isSignedIn() && isEditorOrAdmin();
    }

    // ---------- SETTINGS ----------
    match /settings/{settingId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();

      match /user/{userId} {
        allow read, write: if isOwner(userId);
      }
    }

    // ---------- GAMIFICAÇÃO ----------
    match /gamification/{userId} {
      allow read: if isOwner(userId) || isAdmin();
      allow write: if false; // apenas backend
    }

    // ---------- LOGS ----------
    match /logs/{logId} {
      allow read: if isAdmin();
      allow write: if false; // apenas backend
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

    // ---------- BLOQUEIO PADRÃO ----------
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

---

## 4. Configurar Storage — Aplicar regras

### Acessar
**Firebase Console → Storage → Rules**

### Copiar e colar

**Apague todo o conteúdo** do editor de regras e **cole** o conteúdo do arquivo [`storage.rules`](./storage.rules) deste repositório.

```storage-rules
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

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

    function isNotBanned() {
      return isSignedIn() &&
             firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.banned != true;
    }

    function isImage() {
      return request.resource.contentType.matches('image/.*');
    }

    function isSmallImage() {
      return request.resource.size < 2 * 1024 * 1024;
    }

    function isLargeImage() {
      return request.resource.size < 5 * 1024 * 1024;
    }

    // Avatares
    match /avatars/{userId}/{fileName} {
      allow read: if true;
      allow write: if isOwner(userId) && isNotBanned() && isImage() && isSmallImage();
    }

    // Imagens de posts
    match /posts/{postId}/{fileName} {
      allow read: if isSignedIn();
      allow write: if isSignedIn() && isNotBanned() && isAdmin() && isImage() && isLargeImage();
    }

    // Arquivos da biblioteca
    match /files/{fileId}/{fileName} {
      allow read: if isSignedIn();
      allow write: if isSignedIn() && isNotBanned() && isAdmin() && isLargeImage();
    }

    // Temas
    match /themes/{userId}/{fileName} {
      allow read: if true;
      allow write: if isOwner(userId) && isNotBanned() && isImage() && isSmallImage();
    }

    // Bloqueio padrão
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

## 8. Templates de e-mail

Para personalizar os e-mails de verificação, redefinição de senha etc:

**Firebase Console → Authentication → Templates**

### 📧 E-mail de redefinição de senha (password reset)

Recomendação de configuração:

- **Sender name:** `Checklist ML`
- **Reply-to:** seu e-mail de suporte
- **Subject:** `Redefina sua senha do Checklist ML`
- **Body (HTML):**

```html
<p>Olá,</p>
<p>Recebemos uma solicitação para redefinir a senha da sua conta no <b>Checklist ML</b>.</p>
<p>Clique no botão abaixo para definir uma nova senha:</p>
<p style="margin:24px 0">
  <a href="%LINK%" style="background:#2563EB;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
    Redefinir senha
  </a>
</p>
<p>Ou cole este link no navegador:</p>
<p style="background:#F1F5F9;padding:10px;border-radius:6px;word-break:break-all;font-family:monospace;font-size:12px">%LINK%</p>
<p style="color:#64748B;font-size:13px;margin-top:24px">
  <b>Não solicitou essa alteração?</b><br>
  Ignore esta mensagem. Sua senha permanecerá a mesma.
</p>
<p style="color:#64748B;font-size:12px;margin-top:24px">
  Este link expira em 1 hora.
</p>
```

### 📧 E-mail de verificação de endereço

- **Subject:** `Confirme seu e-mail — Checklist ML`
- **Body:** personalizado similar ao acima

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

1. **Cache local agressivo** (já implementado) — a maioria das operações é no `localStorage`
2. **Sync seletivo** — só sincroniza `tasks`, `posts` e `files` (não `logs`, `gamification` etc)
3. **Backup local** — `localStorage` é a fonte primária, Firestore é sincronização
4. **Cache do Service Worker** — assets ficam em cache, evitando downloads

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

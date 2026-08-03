# Heartbeat de Autenticação Firebase

## Problema
Quando o usuário faz login pelo Firebase Auth, a sessão é mantida pelo SDK (persistência LOCAL). Mas se o app fica aberto por muitas horas, pode ser útil garantir ativamente que o token ainda é válido — e lembrar ao usuário que está logado.

## Solução implementada
- **Arquivo:** `js/firebase.js`
- **Função:** `startFirebaseAuthHeartbeat()`
- **Intervalo:** a cada **60 minutos** (`60 * 60 * 1000` ms)
- **Ação:** chama `auth.currentUser.getIdToken(true)` para forçar renovação do token.
- **Se falhar:** faz `auth.signOut()`, limpa a sessão e volta para a tela de login (`App.showLogin()`).

## Como é acionado
- No `onAuthStateChanged` de `js/app.js` (quando `fbUser` é detectado e `this.showApp()` é chamado).
- Também no fallback inicial (`fbCurrent`) para garantir que se já há sessão ao abrir o app, o heartbeat começa.

## Personalização
Para mudar o intervalo (ex.: a cada 30 min):
```js
// em js/firebase.js
}, 30 * 60 * 1000); // 30 minutos
```

## Observação
O Firebase Auth já renova tokens automaticamente; esse heartbeat é uma **garantia ativa** — caso o token expire (ex.: usuário desloga em outro dispositivo, ou a sessão é revogada por segurança), o app detecta na próxima hora e limpa a sessão local imediatamente.

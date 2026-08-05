/*
 * Exercita as proteções de cache/outbox sem acessar um projeto Firebase.
 * Execute: node tests/firebase-sync-logic.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

class Timestamp {
  constructor(date) { this.date = date; }
  toDate() { return this.date; }
  static fromDate(date) { return new Timestamp(date); }
}

const localStorage = storage();
const sessionStorage = storage();
const auth = {
  currentUser: { uid: 'user-a' },
  setPersistence: async () => {},
};
const firebaseAuth = () => auth;
firebaseAuth.GoogleAuthProvider = class { addScope() {} setCustomParameters() {} };
firebaseAuth.Auth = { Persistence: { LOCAL: 'LOCAL' } };

const fakeDb = {
  enablePersistence: async () => {},
  collection() { throw new Error('collection should not be used by this unit test'); },
};
const firebase = {
  apps: [],
  initializeApp() { this.apps.push({}); },
  auth: firebaseAuth,
  firestore: () => fakeDb,
  storage: () => ({}),
  firestore: Object.assign(() => fakeDb, {
    Timestamp,
    FieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) },
  }),
};

let dbData = {
  tasks: [
    { id: 'stale-task', owner: 'user-a', title: 'não existe mais' },
    { id: 'pending-task', owner: 'user-a', title: 'ainda na outbox' },
  ],
  notes: [], macros: [], posts: [], files: [], users: [], comments: {},
  gamification: {}, dashboardWidgets: [], settings: {}, customThemes: [], automations: [], logs: [],
};
const core = {
  getLocalDB: () => dbData,
  saveLocalDB: value => { dbData = value; },
  dateKeyFromLocalDate: date => date.toISOString().slice(0, 10),
  toast() {},
  now: () => '2026-08-05T12:00:00.000-03:00',
  recurrenceOccurrenceId: (root, date) => `rec-${root}-${date.replaceAll('-', '')}`,
};

const window = {
  location: { hostname: 'example.test' },
  addEventListener() {},
  dispatchEvent() {},
};
const sandbox = {
  console,
  firebase,
  window,
  self: {},
  localStorage,
  sessionStorage,
  navigator: {},
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  setTimeout,
  clearTimeout,
  Date,
  JSON,
  String,
  Number,
  Array,
  Object,
  Set,
  Map,
  Promise,
  core,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/firebase.js', 'utf8'), sandbox, { filename: 'firebase.js' });
const sync = sandbox.window.fireSync;
sync._userId = 'user-a';
sync._outbox = [{
  collection: 'tasks', id: 'pending-task', uid: 'user-a',
  data: { owner: 'user-a', title: 'ainda na outbox' }, queuedAt: 'now',
}];

function doc(id, data) { return { id, data: () => data }; }
const serverSnapshot = {
  forEach(callback) { callback(doc('remote-task', { owner: 'user-a', title: 'veio do servidor' })); },
};
const fullSnapshot = sync._asFullServerSnapshot(serverSnapshot, 'tasks', 'user-a');
sync._handleCollectionSync('tasks', fullSnapshot, 'user-a');
assert.deepEqual(
  dbData.tasks.map(task => task.id).sort(),
  ['pending-task', 'remote-task'],
  'server pull removes stale cache but preserves a write-ahead outbox entry'
);

// Outbox items are bound to their originating UID. A session for user-b must
// never flush user-a data after an account switch in the same browser.
(async () => {
  auth.currentUser = { uid: 'user-b' };
  sync._outbox = [
    { collection: 'tasks', id: 'for-user-a', uid: 'user-a', data: {} },
    { collection: 'tasks', id: 'for-user-b', uid: 'user-b', data: {} },
  ];
  const written = [];
  sync._writeDoc = async (_collection, id) => { written.push(id); };
  sync._saveOutbox = () => {};
  await sync._flushOutbox();
  assert.deepEqual(written, ['for-user-b']);
  assert.deepEqual(sync._outbox.map(item => item.id), ['for-user-a']);

  console.log('✓ firebase sync cache/outbox tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

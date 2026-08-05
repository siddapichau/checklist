/*
 * Regressões de sincronização que não dependem de um projeto Firebase real.
 * Execute: node tests/cloud-sync-regression.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

const localStorage = memoryStorage();
const sessionStorage = memoryStorage();
const document = {
  getElementById() { return null; },
  createElement() { return { style: {}, appendChild() {}, textContent: '', innerHTML: '' }; },
  body: { appendChild() {} },
};
const window = { parent: null, localStorage, sessionStorage };
window.parent = window;

const sandbox = {
  console,
  window,
  document,
  localStorage,
  sessionStorage,
  crypto: webcrypto,
  globalThis: { crypto: webcrypto },
  Intl,
  Date,
  Set,
  Map,
  Array,
  Object,
  JSON,
  String,
  Number,
  Math,
  Promise,
  TextEncoder,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/core.js', 'utf8'), sandbox, { filename: 'core.js' });
const core = sandbox.window.core;

// UUID/ID generation must be suitable for two browsers creating documents.
const firstId = core.genId('task');
const secondId = core.genId('task');
assert.notEqual(firstId, secondId, 'new documents must not reuse Date.now-only IDs');
assert.match(firstId, /^task-/);

// The same recurring series/date must always map to the same Firestore document.
assert.equal(
  core.recurrenceOccurrenceId('series-1', '2026-08-05'),
  core.recurrenceOccurrenceId('series-1', '2026-08-05'),
  'recurring occurrence ID must be deterministic'
);
assert.notEqual(
  core.recurrenceOccurrenceId('series-1', '2026-08-05'),
  core.recurrenceOccurrenceId('series-1', '2026-08-06'),
  'different dates must have different occurrence IDs'
);

// Simulate two executions of the automation (two tabs receiving the same
// completion). Only one next occurrence can be present in the cache.
const userId = 'user-a';
core.setCurrentUser({ id: userId, uid: userId });
const data = JSON.parse(JSON.stringify(core._defaults));
data.tasks = [{
  id: 'series-1',
  owner: userId,
  title: 'Ronda diária',
  date: '2026-08-04',
  status: 'finished',
  recurrence: 'daily',
  createdAt: '2026-08-04T09:00:00.000-03:00',
  updatedAt: '2026-08-04T10:00:00.000-03:00',
}];
core.saveLocalDB(data);
const task = core.getLocalDB().tasks[0];
const firstRun = core.runAutomations('task_finished', { task, userId });
const secondRun = core.runAutomations('task_finished', { task, userId });
const expectedId = core.recurrenceOccurrenceId('series-1', '2026-08-05');
const occurrences = core.getLocalDB().tasks.filter(item => item.id === expectedId);
assert.equal(occurrences.length, 1, 'two automation runs must not create duplicate tasks');
assert.equal(firstRun.filter(result => result.newTask).length, 1);
assert.equal(secondRun.filter(result => result.newTask).length, 0);

// Cached data belonging to another account must never feed the visible task UI.
const own = { id: 'own-task', owner: userId };
const foreign = { id: 'foreign-task', owner: 'other-user' };
assert.deepEqual(core.ownedTasks([own, foreign], { id: userId }), [own]);

console.log('✓ cloud-sync regression tests passed');

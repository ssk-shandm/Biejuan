import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const vue = require('vue')
const pinia = require('pinia')
const KEY = 'wrongNotebookData_v2'
const snapshot = (name = 'saved') => ({
  version: 1,
  notebooks: [{ id: 'nb_1', name, bankFile: 'bank.json', createdAt: 1 }],
  wrongEntries: [{ id: 1, questionNumber: 1, bankFile: 'bank.json', addedAt: 1, notebookId: 'nb_1' }],
  activeNotebookByBank: { 'bank.json': 'nb_1' },
  guessedRight: [],
})

function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    failWrites: false,
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (this.failWrites) throw new Error('quota exceeded')
      values.set(key, String(value))
    },
    removeItem: key => values.delete(key),
  }
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

function loadStore(t, { local = storage(), desktop = false, file = {} } = {}) {
  const timers = new Map()
  const events = new Map()
  const toasts = []
  const writes = []
  let timerId = 0
  const imports = {
    vue,
    pinia,
    '../composables/useToast': { showToast: message => toasts.push(message) },
    '../utils/questionSchema': {},
    '../services/fileService': {},
    '@tauri-apps/api/path': { appDataDir: async () => '/data', join: async (...parts) => parts.join('/') },
    '@tauri-apps/plugin-fs': {
      exists: async path => path === '/data' || file.content != null,
      mkdir: async () => {},
      readTextFile: async () => {
        if (file.readGate) await file.readGate
        if (file.failReads) throw new Error('read denied')
        return file.content
      },
      writeTextFile: async (path, content) => {
        writes.push(content)
        if (file.writeGate) await file.writeGate(content)
        if (file.failWrites) throw new Error('write denied')
        file.content = content
      },
    },
  }
  function load(path) {
    if (imports[path]) return imports[path]
    if (path !== '../utils/quizData') throw new Error('Unexpected import: ' + path)
    const url = new URL('../src/utils/quizData.ts', import.meta.url)
    if (!existsSync(url)) throw new Error('Missing quizData.ts')
    return evaluate(readFileSync(url, 'utf8'))
  }
  function evaluate(source) {
    const module = { exports: {} }
    runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports, require: load, Error,
      console: { log() {}, warn() {}, error() {} },
      localStorage: local,
      window: {
        ...(desktop ? { __TAURI_INTERNALS__: {} } : {}),
        addEventListener: (type, listener) => events.set(type, listener),
        removeEventListener: type => events.delete(type),
      },
      document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
      setTimeout: callback => { timers.set(++timerId, callback); return timerId },
      clearTimeout: id => timers.delete(id),
    })
    return module.exports
  }
  const api = evaluate(readFileSync(new URL('../src/stores/quizStore.ts', import.meta.url), 'utf8'))
  const store = api.useQuizStore(pinia.createPinia())
  t.after(() => store.$dispose())
  return {
    store, local, file, writes, toasts,
    emit: type => events.get(type)?.(),
    async flush() {
      await settle()
      for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
      await settle()
    },
  }
}

test('legacy migration keeps its source when storage is full or JSON is corrupt', async t => {
  const local = storage({ wrongQuestionsDB: '[1,2]' })
  local.failWrites = true
  const app = loadStore(t, { local })
  await settle()
  assert.equal(local.getItem('wrongQuestionsDB'), '[1,2]')
  const invalid = storage({ wrongQuestionsDB: '{broken' })
  loadStore(t, { local: invalid })
  assert.equal(invalid.getItem('wrongQuestionsDB'), '{broken')
  assert.ok(app.toasts.length > 0)
})

test('legacy migration commits notebooks and entries together and is idempotent', async t => {
  const local = storage({ wrongQuestionsDB: '[1,2]', guessedRightDB: '[3]' })
  const app = loadStore(t, { local })
  await settle()
  const data = JSON.parse(local.getItem(KEY))
  assert.equal(data.wrongEntries.length, 2)
  assert.equal(data.notebooks.length, 1)
  assert.equal(data.notebooks[0].bankFile, data.wrongEntries[0].bankFile)
  assert.equal(data.guessedRight[0].questionNumber, 3)
  assert.equal(local.getItem('wrongQuestionsDB'), null)
  const restarted = loadStore(t, { local })
  await settle()
  assert.equal(restarted.store.wrongEntries.length, app.store.wrongEntries.length)
})

test('invalid backup fields, duplicate IDs and cross-bank links never replace current data', async t => {
  const app = loadStore(t, { local: storage({ [KEY]: JSON.stringify(snapshot()) }) })
  await settle()
  const before = app.store.exportAllDataAsJson()
  const cases = [
    { ...snapshot(), notebooks: [null] },
    { ...snapshot(), wrongEntries: [null] },
    { ...snapshot(), guessedRight: {} },
    { ...snapshot(), activeNotebookByBank: [] },
    { ...snapshot(), wrongEntries: [...snapshot().wrongEntries, ...snapshot().wrongEntries] },
    { ...snapshot(), notebooks: [...snapshot().notebooks, ...snapshot().notebooks] },
    { ...snapshot(), activeNotebookByBank: { 'other.json': 'nb_1' } },
    { ...snapshot(), wrongEntries: [{ ...snapshot().wrongEntries[0], bankFile: 'other.json' }] },
    { ...snapshot(), version: 2 },
  ]
  for (const value of cases) {
    const result = app.store.importAllDataFromJson(JSON.stringify(value))
    assert.equal(result.success, false, JSON.stringify(value))
    assert.deepEqual(JSON.parse(app.store.exportAllDataAsJson()).wrongEntries, JSON.parse(before).wrongEntries)
    assert.equal(app.store.notebooks[0].name, 'saved')
  }
})

test('valid legacy backup accepts missing optional fields and a UTF-8 BOM', async t => {
  const app = loadStore(t)
  await settle()
  const data = snapshot('restored')
  delete data.guessedRight
  delete data.activeNotebookByBank
  const result = app.store.importAllDataFromJson('\uFEFF' + JSON.stringify(data))
  assert.equal(result.success, true)
  assert.equal(app.store.notebooks[0].name, 'restored')
  app.store.addWrongEntry(2, 'bank.json')
  await app.flush()
  assert.equal(new Set(app.store.wrongEntries.map(entry => entry.id)).size, 2)
})

test('browser changes survive closing before the native debounce timer fires', async t => {
  const app = loadStore(t)
  await settle()
  app.store.addWrongEntry(1, 'bank.json')
  await vue.nextTick()
  assert.equal(JSON.parse(app.local.getItem(KEY)).wrongEntries.length, 1)
  app.store.addWrongEntry(2, 'bank.json')
  app.emit('pagehide')
  assert.equal(JSON.parse(app.local.getItem(KEY)).wrongEntries.length, 2)
})

test('native hydration wins over stale browser data and never triggers an automatic write', async t => {
  let release
  const file = { content: JSON.stringify(snapshot('native')), readGate: new Promise(resolve => { release = resolve }) }
  const app = loadStore(t, { desktop: true, file, local: storage({ [KEY]: JSON.stringify(snapshot('stale')) }) })
  await settle()
  assert.equal(app.writes.length, 0)
  release()
  await app.flush()
  assert.equal(app.store.notebooks[0].name, 'native')
  assert.equal(app.writes.length, 0)
})

test('corrupt or unreadable native data is preserved rather than overwritten by fallback data', async t => {
  for (const file of [{ content: '{broken' }, { content: JSON.stringify(snapshot('native')), failReads: true }]) {
    const app = loadStore(t, { desktop: true, file, local: storage({ [KEY]: JSON.stringify(snapshot('browser')) }) })
    await settle()
    app.store.addWrongEntry(2, 'bank.json')
    await app.flush()
    assert.equal(app.writes.length, 0)
    assert.ok(app.toasts.length > 0)
  }
})

test('native writes are serialized so an older slow write cannot replace newer data', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const file = { writeGate: async () => { await gate } }
  const app = loadStore(t, { desktop: true, file })
  await settle()
  app.store.addWrongEntry(1, 'bank.json')
  await app.flush()
  assert.equal(app.writes.length, 1)
  app.store.addWrongEntry(2, 'bank.json')
  await app.flush()
  assert.equal(app.writes.length, 1)
  release()
  await settle()
  assert.equal(JSON.parse(file.content).wrongEntries.length, 2)
})

test('save failure is visible, retains the browser copy and allows later retry', async t => {
  const file = { failWrites: true }
  const app = loadStore(t, { desktop: true, file })
  await settle()
  app.store.addWrongEntry(1, 'bank.json')
  await app.flush()
  assert.ok(app.toasts.some(message => /\u4fdd\u5b58\u5931\u8d25|\u5199\u5165\u5931\u8d25/.test(message)))
  assert.equal(JSON.parse(app.local.getItem(KEY)).wrongEntries.length, 1)
  file.failWrites = false
  app.store.addWrongEntry(2, 'bank.json')
  await app.flush()
  assert.equal(JSON.parse(file.content).wrongEntries.length, 2)
})

test('bank cleanup removes only the selected bank and persists the result', async t => {
  const app = loadStore(t)
  await settle()
  app.store.addWrongEntry(1, 'first.json')
  app.store.addWrongEntry(1, 'second.json')
  app.store.addGuessedRight(2, 'first.json')
  app.store.addGuessedRight(2, 'second.json')
  await app.store.removeBanksData(['first.json'])
  assert.equal(app.store.notebooks.length, 1)
  assert.equal(app.store.wrongEntries[0].bankFile, 'second.json')
  assert.equal(app.store.guessedRightBank[0].bankFile, 'second.json')
  assert.equal(JSON.parse(app.local.getItem(KEY)).wrongEntries.length, 1)
})


test('failed migration is not hidden by a later automatic save', async t => {
  const local = storage({ wrongQuestionsDB: '{broken' })
  const app = loadStore(t, { local })
  await settle()
  app.store.addWrongEntry(3, 'new.json')
  await app.flush()
  assert.equal(local.getItem(KEY), null)
  assert.equal(local.getItem('wrongQuestionsDB'), '{broken')
})

test('invalid browser data is kept until the user explicitly restores a valid backup', async t => {
  const local = storage({ [KEY]: '{broken' })
  const app = loadStore(t, { local })
  await settle()
  app.store.addWrongEntry(3, 'new.json')
  await app.flush()
  assert.equal(local.getItem(KEY), '{broken')
  assert.equal(app.store.importAllDataFromJson(JSON.stringify(snapshot('recovered'))).success, true)
  await app.flush()
  assert.equal(JSON.parse(local.getItem(KEY)).notebooks[0].name, 'recovered')
})

test('quota failure during restore leaves the current in-memory and persisted data intact', async t => {
  const local = storage({ [KEY]: JSON.stringify(snapshot('original')) })
  const app = loadStore(t, { local })
  await settle()
  local.failWrites = true
  assert.equal(app.store.importAllDataFromJson(JSON.stringify(snapshot('replacement'))).success, false)
  assert.equal(app.store.notebooks[0].name, 'original')
  assert.equal(JSON.parse(local.getItem(KEY)).notebooks[0].name, 'original')
})

test('a newer browser snapshot recovers edits left behind by an interrupted native save', async t => {
  const file = { content: JSON.stringify({ ...snapshot('old-native'), savedAt: 100 }) }
  const local = storage({ [KEY]: JSON.stringify({ ...snapshot('new-browser'), savedAt: 200 }) })
  const app = loadStore(t, { desktop: true, file, local })
  await app.flush()
  assert.equal(app.store.notebooks[0].name, 'new-browser')
  assert.equal(JSON.parse(file.content).notebooks[0].name, 'new-browser')
})

test('an older browser snapshot never replaces newer native data', async t => {
  const file = { content: JSON.stringify({ ...snapshot('new-native'), savedAt: 200 }) }
  const local = storage({ [KEY]: JSON.stringify({ ...snapshot('old-browser'), savedAt: 100 }) })
  const app = loadStore(t, { desktop: true, file, local })
  await app.flush()
  assert.equal(app.store.notebooks[0].name, 'new-native')
  assert.equal(JSON.parse(local.getItem(KEY)).savedAt, 200)
  assert.equal(app.writes.length, 0)
})

test('browser-loaded entry IDs stay unique when generating new entries', async t => {
  const data = snapshot()
  data.wrongEntries[0].id = Date.now() + 1000000
  const app = loadStore(t, { local: storage({ [KEY]: JSON.stringify(data) }) })
  await settle()
  app.store.addWrongEntry(2, 'bank.json')
  assert.ok(app.store.wrongEntries[1].id > data.wrongEntries[0].id)
})


test('corrupt browser data with no native file cannot create an empty native replacement', async t => {
  const local = storage({ [KEY]: '{broken' })
  const app = loadStore(t, { local, desktop: true })
  await settle()
  app.store.addWrongEntry(2, 'new.json')
  app.emit('pagehide')
  await app.flush()
  assert.equal(app.writes.length, 0)
  assert.equal(local.getItem(KEY), '{broken')
  assert.equal(app.store.importAllDataFromJson(JSON.stringify(snapshot('recovered'))).success, true)
  await app.flush()
  assert.equal(JSON.parse(app.file.content).notebooks[0].name, 'recovered')
})

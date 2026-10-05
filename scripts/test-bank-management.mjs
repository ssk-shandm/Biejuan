import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/services/publicBankStorage.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function loadStorage({ desktop = true, fail = [] } = {}) {
  const module = { exports: {} }
  const calls = []
  const events = []
  class CustomEvent {
    constructor(type) { this.type = type }
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    Error,
    CustomEvent,
    window: { dispatchEvent: event => events.push(event.type) },
    require: name => {
      if (name === '@tauri-apps/api/core') return {
        invoke: async (command, args) => {
          calls.push({ command, ...args })
          if (fail.includes(args.file)) throw new Error('permission denied')
        },
      }
      if (name === '../composables/usePlatform') return { usePlatform: () => ({ isDesktopTauri: { value: desktop } }) }
      if (name === '../utils/questionSchema') return {}
      if (name === './publicBankWriter') return { PUBLIC_BANKS_CHANGED: 'public-banks-changed' }
      if (name === './generatedBankStorage') return {
        GENERATED_BANK_PREFIX: 'generated:',
        deleteGeneratedBanks: async (files, notify) => calls.push({ command: 'deleteGeneratedBanks', files: [...files], notify }),
      }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return { ...module.exports, calls, events }
}
const bank = (file, deletable) => ({ name: file, file, ...(deletable === undefined ? {} : { deletable }) })

test('backend permission makes manual JSON and AI banks editable; bundled files stay read-only', () => {
  const api = loadStorage()
  assert.equal(api.isBankDeletable(bank('/user-subjects/manual.json', true)), true)
  assert.equal(api.isBankDeletable(bank('/user-subjects/ai.json', true)), true)
  assert.equal(api.isBankDeletable(bank('/subjects/dev.json', true)), true)
  assert.equal(api.isBankDeletable(bank('/subjects/bundled.json', false)), false)
  assert.equal(api.isBankDeletable(bank('/subjects/web.json')), false)
  assert.equal(api.isBankDeletable(bank('generated:legacy')), true)
})

test('disk and legacy banks use their own deletion backends and refresh once', async () => {
  const api = loadStorage()
  const manual = bank('/user-subjects/manual.json', true)
  const result = await api.deleteManagedBanks([manual, bank('generated:legacy'), manual])
  assert.deepEqual([...result.deleted], ['/user-subjects/manual.json', 'generated:legacy'])
  assert.equal(result.errors.length, 0)
  assert.deepEqual(api.calls, [
    { command: 'delete_question_bank', file: manual.file },
    { command: 'deleteGeneratedBanks', files: ['generated:legacy'], notify: false },
  ])
  assert.deepEqual(api.events, ['public-banks-changed'])
})

test('partial failures report only successful deletions for progress and wrong-answer cleanup', async () => {
  const api = loadStorage({ fail: ['/user-subjects/failed.json'] })
  const result = await api.deleteManagedBanks([
    bank('/user-subjects/good.json', true),
    bank('/user-subjects/failed.json', true),
    bank('/subjects/bundled.json', false),
  ])
  assert.deepEqual([...result.deleted], ['/user-subjects/good.json'])
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /permission denied/)
  assert.equal(api.calls.length, 2)
  assert.deepEqual(api.events, ['public-banks-changed'])
})

test('readonly selection never calls filesystem deletion or triggers a refresh', async () => {
  const api = loadStorage()
  const result = await api.deleteManagedBanks([bank('/subjects/bundled.json', false)])
  assert.equal(result.deleted.length, 0)
  assert.equal(result.errors.length, 1)
  assert.equal(api.calls.length, 0)
  assert.equal(api.events.length, 0)
})

test('web cannot delete disk JSON even with forged permission metadata', async () => {
  const api = loadStorage({ desktop: false })
  const result = await api.deleteManagedBanks([bank('/user-subjects/manual.json', true)])
  assert.equal(result.deleted.length, 0)
  assert.equal(result.errors.length, 1)
  assert.equal(api.calls.length, 0)
})
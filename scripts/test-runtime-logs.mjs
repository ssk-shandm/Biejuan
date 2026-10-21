import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import JSZip from 'jszip'
import ts from 'typescript'

function harness(saveResult = true) {
  const saves = []
  const modules = {
    vue: { ref: value => ({ value }) },
    '../services/fileService': {
      saveExportBlob: async (name, blob) => { saves.push({ name, blob }); return saveResult },
    },
    jszip: { default: JSZip },
  }
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/composables/useRuntimeConsole.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Blob, Error,
    require: name => {
      if (!(name in modules)) throw new Error('Unexpected import ' + name)
      return modules[name]
    },
  })
  return { ...module.exports, ...module.exports.useRuntimeConsole(), saves }
}

test('runtime logs export a ZIP snapshot with text and structured entries', async () => {
  const h = harness()
  h.addRuntimeLog('info', 'first line\nsecond line')
  h.addRuntimeLog('warn', 'warning')
  const saving = h.saveRuntimeLogs()
  h.clearRuntimeLogs()
  h.addRuntimeLog('error', 'later entry')
  assert.equal(await saving, true)
  assert.equal(h.saves.length, 1)
  const { name, blob } = h.saves[0]
  assert.match(name, /^runtime-logs-.*\.zip$/)
  assert.equal(blob.type, 'application/zip')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files).sort(), ['README.txt', 'runtime-logs.json', 'runtime-logs.txt'])
  const report = JSON.parse(await zip.file('runtime-logs.json').async('string'))
  assert.equal(report.format, 'biejuan-runtime-logs')
  assert.equal(report.schemaVersion, 1)
  assert.ok(Number.isFinite(Date.parse(report.exportedAt)))
  assert.deepEqual(report.logs.map(entry => entry.level), ['info', 'warn'])
  const text = await zip.file('runtime-logs.txt').async('string')
  assert.match(text, /\[INFO\] first line\nsecond line/)
  assert.match(text, /\[WARN\] warning/)
  assert.doesNotMatch(text, /later entry/)
})

test('runtime log packages retain the current 300-entry window', () => {
  const h = harness()
  for (let index = 0; index < 305; index++) h.addRuntimeLog('info', 'entry-' + index)
  const report = h.createRuntimeLogPackage()
  assert.equal(report.logs.length, 300)
  assert.equal(report.logs[0].message, 'entry-5')
  h.runtimeLogs.value[0].message = 'changed'
  assert.equal(report.logs[0].message, 'entry-5')
})

test('log collection redacts credentials in strings, objects and Error stacks', async () => {
  const h = harness()
  h.addRuntimeLog('info', 'Authorization: Bearer string-token')
  h.addRuntimeLog('info', { apiKey: 'object-token', nested: { password: 'private-password' } })
  h.addRuntimeLog('error', new Error('api_key=error-token'))
  await h.saveRuntimeLogs()
  const zip = await JSZip.loadAsync(await h.saves[0].blob.arrayBuffer())
  for (const name of ['runtime-logs.json', 'runtime-logs.txt']) {
    const content = await zip.file(name).async('string')
    assert.doesNotMatch(content, /string-token|object-token|private-password|error-token/)
    assert.match(content, /\[REDACTED\]/)
  }
})

test('empty logs skip saving and picker cancellation propagates', async () => {
  const h = harness(false)
  assert.equal(await h.saveRuntimeLogs(), false)
  assert.equal(h.saves.length, 0)
  h.addRuntimeLog('info', 'entry')
  assert.equal(await h.saveRuntimeLogs(), false)
  assert.equal(h.runtimeLogs.value.length, 1)
})

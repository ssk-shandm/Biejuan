import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness({ gate, failAt } = {}) {
  const calls = []
  let saves = 0
  let unsubscribed = 0
  async function step(name) {
    calls.push(name)
    if (name === failAt) throw new Error('failure at ' + name)
    if (name === 'download' && gate) await gate.promise
  }
  const modules = {
    vue: { ref: value => ({ value }) },
    './useRuntimeConsole': { addRuntimeLog() {} },
    '../config/appInfo': {
      APP_VERSION_FALLBACK: '0.2.0',
      GITHUB_OWNER: 'example',
      GITHUB_REPO: 'exam',
      RELEASES_URL: 'https://example.test/releases',
      // 空数组：测试关注保存时序，不需要额外尝试加速源
      UPDATE_DOWNLOAD_ACCELERATORS: [],
    },
    '../utils/downloadSource': {
      buildDownloadCandidates: (url, accelerators) => {
        const list = []
        for (const prefix of accelerators) list.push(prefix + '/' + url)
        list.push(url)
        return list
      },
    },
    '@tauri-apps/api/core': { invoke: async command => {
      if (command === 'get_app_version') return '0.2.0'
      if (command === 'download_and_install_update') return step('download')
      if (command === 'install_prepared_update') return step('install')
      throw new Error(command)
    } },
    '@tauri-apps/api/event': { listen: async () => () => { unsubscribed++ } },
    '../stores/quizStore': { useQuizStore: () => ({ flushSavedData: () => step('notebook-' + ++saves) }) },
    '../services/learningPersistence': {
      persistLearningState: () => step('learning-' + saves),
      drainLearningWrites: options => {
        assert.equal(options.requireSaved, true)
        return step('drain-' + saves)
      },
    },
  }
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/composables/useVersion.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, window: { __TAURI_INTERNALS__: {} },
    require: name => {
      if (!(name in modules)) throw new Error('Unexpected import ' + name)
      return modules[name]
    },
  })
  const api = module.exports.useVersion()
  api.updateInfo.value = { installerUrl: 'https://example.test/setup.exe', installerName: 'exam-setup.exe' }
  return { api, calls, unsubscribed: () => unsubscribed }
}

test('update waits for both pre-download and post-download saves before installation', async () => {
  const gate = deferred()
  const h = harness({ gate })
  const update = h.api.downloadAndInstall()
  while (!h.calls.includes('download')) await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.api.isDownloading.value, true)
  assert.deepEqual(h.calls, ['notebook-1', 'learning-1', 'drain-1', 'download'])
  await h.api.downloadAndInstall() // A second click cannot start a competing installer.
  assert.equal(h.calls.filter(call => call === 'download').length, 1)
  gate.resolve()
  await update
  assert.deepEqual(h.calls, ['notebook-1', 'learning-1', 'drain-1', 'download', 'notebook-2', 'learning-2', 'drain-2', 'install'])
  assert.equal(h.api.isDownloading.value, false)
  assert.equal(h.unsubscribed(), 2)
})

for (const failAt of ['notebook-1', 'learning-1', 'drain-1', 'download', 'notebook-2', 'learning-2', 'drain-2']) {
  test(failAt + ' failure never starts installation and resets the update UI', async () => {
    const h = harness({ failAt })
    await assert.rejects(h.api.downloadAndInstall(), /failure at/)
    assert.equal(h.calls.includes('install'), false)
    assert.equal(h.api.isDownloading.value, false)
    assert.match(h.api.updateError.value, /failure at/)
    assert.equal(h.unsubscribed(), ['notebook-1', 'learning-1', 'drain-1'].includes(failAt) ? 0 : 2)
  })
}

test('installer cancellation keeps the app available for a fresh save and retry', async () => {
  const h = harness({ failAt: 'install' })
  await assert.rejects(h.api.downloadAndInstall(), /failure at install/)
  assert.equal(h.api.isDownloading.value, false)
  assert.equal(h.api.downloadProgress.value, '')
  assert.equal(h.unsubscribed(), 2)
  assert.ok(h.api.updateInfo.value)
})

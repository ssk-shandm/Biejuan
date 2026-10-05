import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/composables/useLlmSettings.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replaceAll('import.meta.env.DEV', 'false'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const defaults = JSON.parse(readFileSync(new URL('../config/llm-config.json', import.meta.url), 'utf8'))
const SESSION_KEY = 'exam.llm-converter.api-key'
const CONFIG_KEY = 'exam.llm-converter.config'

function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

function desktopFile(config = defaults) {
  return { content: JSON.stringify(config), failWrites: false }
}

function loadModule({ file = desktopFile(), desktop = true, session = storage(), local = storage() } = {}) {
  const module = { exports: {} }
  const invoke = async (command, args) => {
    if (command === 'write_llm_config') {
      if (file.failWrites) throw new Error('simulated write failure')
      file.content = args.content
    } else if (command !== 'read_llm_config') {
      throw new Error(`Unexpected command: ${command}`)
    }
    return { content: file.content, location: 'test-app-config/llm-config.txt' }
  }
  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: name => name === '@tauri-apps/api/core' ? { invoke } : require(name),
    window: desktop ? { __TAURI_INTERNALS__: {} } : {},
    sessionStorage: session,
    localStorage: local,
    URL,
  }, { filename: 'useLlmSettings.cjs' })
  return { ...module.exports, file, session, local }
}

function configWithKey(apiKey) {
  const config = structuredClone(defaults)
  config.provider.apiKey = apiKey
  return config
}

test('desktop saves the key to config and restores it with a fresh session after restart', async () => {
  const app = loadModule()
  await app.loadLlmProviderSettings()
  app.useLlmSettings().provider.apiKey = ' test-secret '
  await app.saveLlmProviderSettings()
  assert.equal(JSON.parse(app.file.content).provider.apiKey, 'test-secret')
  assert.equal(app.session.getItem(SESSION_KEY), null)
  const restarted = loadModule({ file: app.file })
  await restarted.loadLlmProviderSettings()
  assert.equal(restarted.useLlmSettings().provider.apiKey, 'test-secret')
})

test('config key takes precedence over stale session data; reload reads external edits', async () => {
  const app = loadModule({ file: desktopFile(configWithKey('file-key')), session: storage({ [SESSION_KEY]: 'stale' }) })
  await app.loadLlmProviderSettings()
  assert.equal(app.useLlmSettings().provider.apiKey, 'file-key')
  app.file.content = JSON.stringify(configWithKey('edited-key'))
  await app.loadLlmProviderSettings(true)
  assert.equal(app.useLlmSettings().provider.apiKey, 'edited-key')
  app.file.content = JSON.stringify(defaults)
  await app.loadLlmProviderSettings(true)
  assert.equal(app.useLlmSettings().provider.apiKey, '')
})

test('clear removes the saved key permanently without saving unrelated form edits', async () => {
  const app = loadModule({ file: desktopFile(configWithKey('secret')) })
  await app.loadLlmProviderSettings()
  app.useLlmSettings().provider.baseUrl = 'invalid unsaved edit'
  await app.clearLlmApiKey()
  assert.equal(JSON.parse(app.file.content).provider.apiKey, '')
  assert.equal(JSON.parse(app.file.content).provider.baseUrl, defaults.provider.baseUrl)
  assert.equal(app.useLlmSettings().provider.apiKey, '')
  const restarted = loadModule({ file: app.file })
  await restarted.loadLlmProviderSettings()
  assert.equal(restarted.useLlmSettings().provider.apiKey, '')
})

test('failed clear reports failure and does not silently discard the existing key', async () => {
  const app = loadModule({ file: desktopFile(configWithKey('secret')) })
  await app.loadLlmProviderSettings()
  app.file.failWrites = true
  await assert.rejects(app.clearLlmApiKey(), /simulated write failure/)
  assert.equal(JSON.parse(app.file.content).provider.apiKey, 'secret')
  assert.equal(app.useLlmSettings().provider.apiKey, 'secret')
})

test('legacy config without apiKey can migrate its current session key on save', async () => {
  const app = loadModule({ session: storage({ [SESSION_KEY]: 'legacy-key' }) })
  await app.loadLlmProviderSettings()
  assert.equal(app.useLlmSettings().provider.apiKey, 'legacy-key')
  await app.saveLlmProviderSettings()
  assert.equal(JSON.parse(app.file.content).provider.apiKey, 'legacy-key')
})

test('an explicitly empty saved key never revives a stale session key', async () => {
  const app = loadModule({ file: desktopFile(configWithKey('')), session: storage({ [SESSION_KEY]: 'stale' }) })
  await app.loadLlmProviderSettings()
  assert.equal(app.useLlmSettings().provider.apiKey, '')
})

test('saving JSON and resetting request defaults preserve the desktop key', async () => {
  const app = loadModule()
  await app.loadLlmProviderSettings()
  await app.saveLlmConfigText(JSON.stringify(configWithKey('json-key')))
  assert.equal(app.useLlmSettings().provider.apiKey, 'json-key')
  await app.resetLlmRequestConfig()
  assert.equal(JSON.parse(app.file.content).provider.apiKey, 'json-key')
  assert.equal(app.useLlmSettings().provider.apiKey, 'json-key')
  await assert.rejects(app.saveLlmConfigText(JSON.stringify(configWithKey(123))), /apiKey/)
})

test('browser keeps the key in session only and never writes it to persistent config', async () => {
  const app = loadModule({ desktop: false })
  await app.loadLlmProviderSettings()
  app.useLlmSettings().provider.apiKey = 'browser-key'
  await app.saveLlmProviderSettings()
  assert.equal(app.session.getItem(SESSION_KEY), 'browser-key')
  assert.equal(JSON.parse(app.local.getItem(CONFIG_KEY)).provider.apiKey, undefined)
  assert.equal(app.useLlmSettings().provider.apiKey, 'browser-key')
  await app.saveLlmConfigText(JSON.stringify(configWithKey('do-not-persist')))
  assert.equal(JSON.parse(app.local.getItem(CONFIG_KEY)).provider.apiKey, undefined)
  await app.clearLlmApiKey()
  assert.equal(app.session.getItem(SESSION_KEY), null)
  const restarted = loadModule({ desktop: false, local: app.local })
  await restarted.loadLlmProviderSettings()
  assert.equal(restarted.useLlmSettings().provider.apiKey, '')
})
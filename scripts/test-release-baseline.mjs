import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const json = path => JSON.parse(read(path))

test('upgrades keep the released application identity and notebook storage contract', () => {
  assert.equal(json('src-tauri/tauri.conf.json').identifier, 'com.exam.assistant')
  assert.equal(read('src/config/appInfo.ts').match(/GITHUB_REPO = '([^']+)'/)[1], 'Biejuan')
  const store = read('src/stores/quizStore.ts')
  assert.ok(store.includes("const COMBINED_FILE = 'quiz-data.json'"))
  assert.ok(store.includes("const COMBINED_LOCAL_KEY = 'wrongNotebookData_v2'"))
})

test('frontend, package locks and native application share the v0.2 release version', () => {
  const version = json('package.json').version
  assert.match(version, /^0\.2\.\d+$/)
  assert.equal(json('package-lock.json').version, version)
  assert.equal(json('package-lock.json').packages[''].version, version)
  assert.equal(json('src-tauri/tauri.conf.json').version, version)
  assert.equal(read('src/config/appInfo.ts').match(/APP_VERSION_FALLBACK = '([^']+)'/)[1], version)
  assert.equal(read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?version = "([^"]+)"/)[1], version)
  assert.equal(read('src-tauri/Cargo.lock').match(/\[\[package\]\]\s+name = "aaa"\s+version = "([^"]+)"/)[1], version)
})

test('native defaults use a public template instead of the writable development config', () => {
  const source = read('src-tauri/src/lib.rs')
  assert.ok(source.includes('include_str!("../../public/config/examples/llm-user-config.example.json")'))
  assert.ok(!source.includes('include_str!("../../config/llm-config.json")'))
  const defaults = json('public/config/examples/llm-user-config.example.json')
  assert.equal(String(defaults.provider.apiKey ?? '').trim(), '')
  assert.equal(defaults.privacy.allowRemoteProcessing, false)
  assert.equal(defaults.privacy.confirmBeforeSending, true)
})

test('native release does not bundle or read an external public directory', () => {
  const bundle = json('src-tauri/tauri.conf.json').bundle
  assert.ok(!bundle.resources || Object.keys(bundle.resources).length === 0)
  const source = read('src-tauri/src/lib.rs')
  assert.ok(!source.includes('.resource_dir()'))
  assert.ok(source.includes('development_content_root()'))
  assert.equal(json('package.json').scripts['test:rust'], 'cargo test --manifest-path src-tauri/Cargo.toml')
})

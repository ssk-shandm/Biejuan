import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const json = path => JSON.parse(read(path))

test('frontend, package locks and native application share one patch version', () => {
  const version = json('package.json').version
  assert.match(version, /^0\.1\.\d+$/)
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

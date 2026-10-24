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

test('current release notes and future release template use the agreed three-section format', () => {
  const version = json('package.json').version
  const headings = ['## 更新摘要', '## 详细更新', '## 安装与注意事项']
  for (const path of [`docs/RELEASE_NOTES_v${version}.md`, 'docs/RELEASE_TEMPLATE.md']) {
    assert.deepEqual(read(path).split(/\r?\n/).filter(line => /^## /.test(line)), headings)
  }
})

test('desktop window hands HTML5 drag and drop back to the web layer', () => {
  // Windows 上 wry 会接管 WebView2 的拖放并调用 SetAllowExternalDrop(false)，
  // 页面里的 dragover / drop 事件永远收不到。只有把 dragDropEnabled 设为 false
  // 才能让文档转换区域的拖入生效；这是编译进窗口的配置，前端代码改不了。
  const windows = json('src-tauri/tauri.conf.json').app.windows
  const main = windows.find(window => (window.label ?? 'main') === 'main')
  assert.ok(main, '缺少主窗口配置')
  assert.equal(main.dragDropEnabled, false, '主窗口必须设置 dragDropEnabled: false，否则 Windows 安装版无法拖入文件')
})

test('document converter keeps a drop target for dragged files', () => {
  const converter = read('src/components/AiDocumentConverter.vue')
  assert.match(converter, /@drop\.prevent="handleDrop"/, '文档转换区域必须保留 drop 处理')
  assert.match(converter, /event\.dataTransfer\?\.files/, 'drop 处理必须从 dataTransfer 读取文件')
  const main = read('src/main.ts')
  assert.match(main, /addEventListener\('drop'/, '全局 drop 拦截应保留，避免拖到空白处时 WebView 打开文件')
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

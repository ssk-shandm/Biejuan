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

function loadModule(fetch = globalThis.fetch) {
  const module = { exports: {} }
  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require,
    fetch,
    URL,
    window: {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }, { filename: 'useLlmSettings.cjs' })
  return module.exports
}

test('本地 OpenAI 网关地址可从 /v1、/models 或完整 chat endpoint 推导路由', () => {
  const { buildModelsEndpoint, buildChatCompletionsEndpoint } = loadModule()
  assert.equal(buildModelsEndpoint('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317/v1/models')
  assert.equal(buildChatCompletionsEndpoint('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317/v1/chat/completions')
  assert.equal(buildModelsEndpoint('http://localhost:8317/v1/chat/completions'), 'http://localhost:8317/v1/models')
  assert.equal(buildChatCompletionsEndpoint('http://localhost:8317/v1/models'), 'http://localhost:8317/v1/chat/completions')
})

test('本地网关只填写主机地址时，模型列表会回退尝试 /v1/models', async () => {
  const requests = []
  const { fetchAvailableModels } = loadModule(async url => {
    requests.push(url)
    if (url === 'http://127.0.0.1:8317/models') return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 })
  })
  assert.deepEqual(Array.from(await fetchAvailableModels('http://127.0.0.1:8317', '')), ['local-model'])
  assert.deepEqual(requests, ['http://127.0.0.1:8317/models', 'http://127.0.0.1:8317/v1/models'])
})

test('模型列表兼容 OpenAI、网关简化数组和 name/model 字段', async () => {
  const responses = [
    { data: [{ id: 'z-model' }, { id: 'a-model' }] },
    { models: [{ name: 'local-model' }] },
    [{ model: 'array-model' }],
  ]
  for (const payload of responses) {
    const requests = []
    const { fetchAvailableModels } = loadModule(async url => {
      requests.push(url)
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const ids = Array.from(await fetchAvailableModels('http://127.0.0.1:8317/v1', ''))
    assert.deepEqual(ids, payload.data ? ['a-model', 'z-model'] : payload.models ? ['local-model'] : ['array-model'])
    assert.equal(requests[0], 'http://127.0.0.1:8317/v1/models')
  }
})

test('模型列表请求携带密钥时使用 Bearer，空密钥不发送空 Authorization', async () => {
  const calls = []
  const { fetchAvailableModels } = loadModule(async (url, options) => {
    calls.push({ url, headers: options?.headers })
    return new Response(JSON.stringify({ data: [{ id: 'gateway-model' }] }), { status: 200 })
  })
  await fetchAvailableModels('http://localhost:8317/v1', '')
  await fetchAvailableModels('http://localhost:8317/v1', 'secret')
  assert.equal(calls[0].headers, undefined)
  assert.equal(calls[1].headers.Authorization, 'Bearer secret')
})

import { reactive, ref } from 'vue'

export interface LlmProviderSettings {
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
}

export interface LlmOcrSettings {
  enabled: boolean
  language: string
  scale: number
  minTextCharacters: number
}

export interface LlmRuntimeConfig {
  $schema?: string
  schemaVersion: 1
  provider: {
    protocol: 'openai-compatible'
    baseUrl: string
    model: string
  }
  request: {
    temperature: number
    maxOutputTokens: number
    timeoutMs: number
  }
  ocr: LlmOcrSettings
  privacy: {
    allowRemoteProcessing: boolean
    confirmBeforeSending: boolean
  }
}

type ConfigBackend = 'tauri' | 'vite-dev' | 'browser'
type ConfigPayload = { content: string; location: string }

const SESSION_KEY = 'exam.llm-converter.api-key'
const BROWSER_CONFIG_KEY = 'exam.llm-converter.config'
const LEGACY_STORAGE_KEY = 'exam.llm-converter.provider'

export const DEFAULT_LLM_BASE_URL = 'https://api.example.com/v1'
export const DEFAULT_LLM_REQUEST = Object.freeze({
  temperature: 0.1,
  maxOutputTokens: 8192,
  timeoutMs: 120000,
})
export const DEFAULT_LLM_OCR = Object.freeze({
  enabled: true,
  language: 'chi_sim+eng',
  scale: 1.8,
  minTextCharacters: 40,
})

const provider = reactive<LlmProviderSettings>({
  baseUrl: DEFAULT_LLM_BASE_URL,
  model: '',
  apiKey: '',
  ...DEFAULT_LLM_REQUEST,
})

const ocr = reactive<LlmOcrSettings>({ ...DEFAULT_LLM_OCR })
const configText = ref('')
const configLocation = ref('尚未读取')
const configBackend = ref<ConfigBackend>('browser')
const isConfigLoading = ref(false)
const isConfigReady = ref(false)
let loadPromise: Promise<void> | null = null

function defaultConfig(): LlmRuntimeConfig {
  return {
    $schema: '../public/config/schemas/llm-user-config.schema.json',
    schemaVersion: 1,
    provider: {
      protocol: 'openai-compatible',
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: '',
    },
    request: { ...DEFAULT_LLM_REQUEST },
    ocr: { ...DEFAULT_LLM_OCR },
    privacy: { allowRemoteProcessing: false, confirmBeforeSending: true },
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function normalizeConfig(value: unknown): LlmRuntimeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LLM config 根节点必须是 JSON 对象。')
  }
  const input = value as Record<string, unknown>
  const providerInput = input.provider as Record<string, unknown> | undefined
  const requestInput = input.request as Record<string, unknown> | undefined
  const ocrInput = input.ocr as Record<string, unknown> | undefined
  const privacyInput = input.privacy as Record<string, unknown> | undefined
  const baseUrl = String(providerInput?.baseUrl ?? '').trim()
  const model = String(providerInput?.model ?? '').trim()
  const temperature = Number(requestInput?.temperature)
  const maxOutputTokens = Number(requestInput?.maxOutputTokens)
  const timeoutMs = Number(requestInput?.timeoutMs)
  const scale = Number(ocrInput?.scale ?? DEFAULT_LLM_OCR.scale)
  const minTextCharacters = Number(ocrInput?.minTextCharacters ?? DEFAULT_LLM_OCR.minTextCharacters)

  if (input.schemaVersion !== 1) throw new Error('LLM config.schemaVersion 必须为 1。')
  if (!baseUrl) throw new Error('LLM config.provider.baseUrl 不能为空。')
  try { new URL(baseUrl) } catch { throw new Error('LLM config.provider.baseUrl 不是有效 URL。') }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('temperature 必须在 0 到 2 之间。')
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256) throw new Error('maxOutputTokens 必须是大于等于 256 的整数。')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('timeoutMs 必须是 1000 到 600000 之间的整数。')
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) throw new Error('ocr.scale 必须在 1 到 4 之间。')
  if (!Number.isInteger(minTextCharacters) || minTextCharacters < 0) throw new Error('ocr.minTextCharacters 必须是非负整数。')

  return {
    $schema: typeof input.$schema === 'string' ? input.$schema : defaultConfig().$schema,
    schemaVersion: 1,
    provider: { protocol: 'openai-compatible', baseUrl, model },
    request: { temperature, maxOutputTokens, timeoutMs },
    ocr: {
      enabled: ocrInput?.enabled !== false,
      language: String(ocrInput?.language ?? DEFAULT_LLM_OCR.language).trim() || DEFAULT_LLM_OCR.language,
      scale,
      minTextCharacters,
    },
    privacy: {
      allowRemoteProcessing: privacyInput?.allowRemoteProcessing === true,
      confirmBeforeSending: privacyInput?.confirmBeforeSending !== false,
    },
  }
}

function parseConfigText(text: string) {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (error) {
    throw new Error(`LLM config JSON 语法错误：${error instanceof Error ? error.message : '无法解析'}`)
  }
  return normalizeConfig(parsed)
}

function applyConfig(config: LlmRuntimeConfig) {
  provider.baseUrl = config.provider.baseUrl
  provider.model = config.provider.model
  provider.temperature = config.request.temperature
  provider.maxOutputTokens = config.request.maxOutputTokens
  provider.timeoutMs = config.request.timeoutMs
  Object.assign(ocr, config.ocr)
  configText.value = JSON.stringify(config, null, 2)
}

function captureConfig(): LlmRuntimeConfig {
  const current = configText.value ? parseConfigText(configText.value) : defaultConfig()
  current.provider.baseUrl = provider.baseUrl.trim()
  current.provider.model = provider.model.trim()
  current.request = {
    temperature: Number(provider.temperature),
    maxOutputTokens: Number(provider.maxOutputTokens),
    timeoutMs: Number(provider.timeoutMs),
  }
  current.ocr = { ...ocr }
  return normalizeConfig(current)
}

async function readConfig(): Promise<ConfigPayload> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    configBackend.value = 'tauri'
    return invoke<ConfigPayload>('read_llm_config')
  }

  if (import.meta.env.DEV) {
    const response = await fetch('/api/llm-config', { cache: 'no-store' })
    if (!response.ok) throw new Error(`开发版 config 读取失败（HTTP ${response.status}）`)
    configBackend.value = 'vite-dev'
    return response.json() as Promise<ConfigPayload>
  }

  configBackend.value = 'browser'
  const content = localStorage.getItem(BROWSER_CONFIG_KEY) ?? JSON.stringify(defaultConfig(), null, 2)
  return { content, location: '浏览器 localStorage（Web 生产版无法直接写本地文件）' }
}

async function writeConfig(content: string): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<ConfigPayload>('write_llm_config', { content })
    return result.location
  }

  if (import.meta.env.DEV) {
    const response = await fetch('/api/llm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    })
    const result = await response.json() as { ok?: boolean; location?: string; message?: string }
    if (!response.ok || !result.ok) throw new Error(result.message || `开发版 config 保存失败（HTTP ${response.status}）`)
    return result.location ?? 'config/llm-config.json'
  }

  localStorage.setItem(BROWSER_CONFIG_KEY, content)
  return '浏览器 localStorage（Web 生产版无法直接写本地文件）'
}

export async function openLlmConfigFile() {
  if (!isTauriRuntime()) throw new Error('只有桌面端支持直接打开配置文件。')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('open_llm_config_file')
}

function loadLegacySettings() {
  if (typeof window === 'undefined') return
  provider.apiKey = sessionStorage.getItem(SESSION_KEY) ?? ''
  const saved = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!saved) return
  try {
    const legacy = JSON.parse(saved) as Partial<LlmProviderSettings>
    if (typeof legacy.baseUrl === 'string') provider.baseUrl = legacy.baseUrl
    if (typeof legacy.model === 'string') provider.model = legacy.model
  } catch { /* 忽略旧版损坏数据 */ }
}

loadLegacySettings()

export async function loadLlmProviderSettings(force = false) {
  if (loadPromise && !force) return loadPromise
  loadPromise = (async () => {
    isConfigLoading.value = true
    try {
      const payload = await readConfig()
      applyConfig(parseConfigText(payload.content))
      configLocation.value = payload.location
      provider.apiKey = sessionStorage.getItem(SESSION_KEY) ?? provider.apiKey
      isConfigReady.value = true
    } finally {
      isConfigLoading.value = false
    }
  })()
  try { await loadPromise } finally { if (force) loadPromise = null }
}

export async function saveLlmProviderSettings() {
  if (!isConfigReady.value) await loadLlmProviderSettings()
  const config = captureConfig()
  const content = JSON.stringify(config, null, 2)
  configLocation.value = await writeConfig(content)
  applyConfig(config)
  if (provider.apiKey) sessionStorage.setItem(SESSION_KEY, provider.apiKey)
  else sessionStorage.removeItem(SESSION_KEY)
}

export async function saveLlmConfigText(text: string) {
  const config = parseConfigText(text)
  const content = JSON.stringify(config, null, 2)
  configLocation.value = await writeConfig(content)
  applyConfig(config)
  isConfigReady.value = true
}

export async function resetLlmRequestConfig() {
  const config = captureConfig()
  config.request = { ...DEFAULT_LLM_REQUEST }
  config.ocr = { ...DEFAULT_LLM_OCR }
  await saveLlmConfigText(JSON.stringify(config, null, 2))
}

export function clearLlmApiKey() {
  provider.apiKey = ''
  if (typeof window !== 'undefined') sessionStorage.removeItem(SESSION_KEY)
}

export function buildChatCompletionsEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

export function buildModelsEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/models') ? normalized : `${normalized}/models`
}

export async function fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(buildModelsEndpoint(baseUrl), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  })
  if (!response.ok) {
    const body = await response.text()
    let message = body
    try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body } catch { /* 保留原始错误 */ }
    throw new Error(message || `获取模型列表失败（HTTP ${response.status}）`)
  }
  const payload = await response.json() as { data?: Array<{ id?: string }> }
  const ids = (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id))
  if (!ids.length) throw new Error('模型服务未返回可用模型列表。')
  return ids.sort()
}

export function useLlmSettings() {
  return {
    provider,
    ocr,
    configText,
    configLocation,
    configBackend,
    isConfigLoading,
    isConfigReady,
    loadLlmProviderSettings,
    saveLlmProviderSettings,
    saveLlmConfigText,
    resetLlmRequestConfig,
    openLlmConfigFile,
    clearLlmApiKey,
  }
}

export type LlmPromptMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmPromptConfig = {
  id?: string
  name?: string
  version?: string
  variables?: {
    required?: string[]
    optional?: Record<string, string>
  }
  messages: LlmPromptMessage[]
  response?: {
    format?: string
    schema?: string
    root?: 'array' | 'object'
    /** 请求时附带 response_format: { type: 'json_object' }，服务商不支持时自动降级 */
    jsonObject?: boolean
  }
  request?: {
    /** false 时请求关闭模型推理（thinking），适合结构化抽取；服务商不支持时自动忽略 */
    thinking?: boolean
  }
}

export type LlmPipelineStep = {
  id: string
  prompt: string
  required?: boolean
  when?: string
  maxAttempts?: number
}

export type LlmFrameworkConfig = {
  id?: string
  displayName?: string
  outputSchema?: string
  input?: {
    chunking?: {
      enabled: boolean
      maxCharacters: number
      /** 分段字符数不超过 maxOutputTokens × 该系数，避免输出被截断 */
      outputTokenRatio?: number
    }
    analysis?: {
      maxCharacters: number
      maxLineCharacters: number
    }
    answerMatching?: {
      batchSize: number
    }
    concurrency?: number
  }
  pipeline?: LlmPipelineStep[]
}

export type LoadedLlmFramework = {
  framework: LlmFrameworkConfig
  /** 按 pipeline step id 索引的 Prompt */
  prompts: Partial<Record<string, LlmPromptConfig>>
  outputSchema: Record<string, unknown>
}

let frameworkPromise: Promise<LoadedLlmFramework> | null = null

function publicAssetUrl(path: string) {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${base}${path.replace(/^\//, '')}`
}

function normalizeConfigPath(path: string, baseDirectory: string) {
  const stack = baseDirectory.split('/').filter(Boolean)
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

async function fetchJson<T>(path: string, label: string): Promise<T> {
  const response = await fetch(publicAssetUrl(path))
  if (!response.ok) throw new Error(`${label}读取失败（HTTP ${response.status}）`)
  return response.json() as Promise<T>
}

export function loadLlmFramework() {
  if (!frameworkPromise) frameworkPromise = fetchLlmFramework()
  return frameworkPromise
}

async function fetchLlmFramework(): Promise<LoadedLlmFramework> {
  const frameworkPath = 'config/llm/framework.json'
  const framework = await fetchJson<LlmFrameworkConfig>(frameworkPath, '框架配置')
  if (!framework.pipeline?.some((step) => step.id === 'convert')) throw new Error('框架中缺少 convert 步骤')
  if (!framework.outputSchema) throw new Error('框架中缺少 outputSchema')

  const prompts: LoadedLlmFramework['prompts'] = {}
  for (const step of framework.pipeline ?? []) {
    if (!step.prompt) continue
    const prompt = await fetchJson<LlmPromptConfig>(normalizeConfigPath(step.prompt, 'config/llm'), `${step.id} Prompt`)
    if (!Array.isArray(prompt.messages) || prompt.messages.length === 0) throw new Error(`${step.id} Prompt 消息为空`)
    prompts[step.id] = prompt
  }

  const schemaPath = normalizeConfigPath(framework.outputSchema, 'config/llm')
  const outputSchema = await fetchJson<Record<string, unknown>>(schemaPath, '题库 Schema')
  return { framework, prompts, outputSchema }
}

/** 用变量渲染 Prompt 消息；空值使用 variables.optional 中的默认值，仍未提供的替换为空字符串。 */
export function renderPromptMessages(prompt: LlmPromptConfig, variables: Record<string, string>) {
  const defaults = prompt.variables?.optional ?? {}
  const valueOf = (key: string) => variables[key] || defaults[key] || ''
  return prompt.messages.map((message) => ({
    role: message.role,
    content: message.content.replace(/{{\s*([\w]+)\s*}}/g, (_, key: string) => valueOf(key)),
  }))
}

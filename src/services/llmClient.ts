import { buildChatCompletionsEndpoint } from '../composables/useLlmSettings'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmConnection = {
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
}

export type ChatOptions = {
  /** 请求 response_format: json_object；服务商不支持时自动降级为普通文本 */
  jsonMode?: boolean
  /** false 时请求关闭推理模式（thinking: { type: 'disabled' }）；服务商不支持时自动去掉该参数 */
  thinking?: boolean
  /** 日志中的请求标签，例如“分段 3/12” */
  label?: string
  signal?: AbortSignal
}

export type ChatResult = {
  content: string
  finishReason: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export type LlmLogLevel = 'info' | 'command' | 'success' | 'warning' | 'error'
export type LlmLogger = (level: LlmLogLevel, text: string) => void

/** 模型输出因 max_tokens 被截断。调用方可以缩小输入后重试。 */
export class LlmTruncatedError extends Error {
  constructor(readonly partialContent: string) {
    super('模型输出达到 maxOutputTokens 上限被截断（finish_reason=length）')
    this.name = 'LlmTruncatedError'
  }
}

class LlmHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'LlmHttpError'
  }
}

const MAX_ATTEMPTS = 3

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function isRetryable(error: unknown) {
  if (error instanceof LlmTruncatedError) return false
  if (error instanceof LlmHttpError) return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500
  const message = error instanceof Error ? error.message : String(error)
  return /empty response|without text content|no readable body|Failed to fetch|fetch failed|network|timed out|timeout|ECONNRESET|terminated|socket/i.test(message)
}

function looksLikeJsonModeUnsupported(error: unknown) {
  return error instanceof LlmHttpError
    && (error.status === 400 || error.status === 422)
    && /response_format|json_object|json mode/i.test(error.message)
}

function looksLikeThinkingUnsupported(error: unknown) {
  return error instanceof LlmHttpError
    && (error.status === 400 || error.status === 422)
    && /thinking|unrecognized|unknown (?:field|parameter)|extra (?:fields|inputs)/i.test(error.message)
}

type RequestFlags = { stream: boolean; jsonMode: boolean; disableThinking: boolean }

type StreamPart = { content: string; reasoning: string; finishReason?: string; error?: string; usage?: ChatResult['usage'] }

function parseStreamLine(line: string): StreamPart {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return { content: '', reasoning: '' }
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return { content: '', reasoning: '' }
  let payload: {
    choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string | null }>
    error?: { message?: string }
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  try {
    payload = JSON.parse(data) as typeof payload
  } catch {
    return { content: '', reasoning: '', error: `SSE 数据无法解析：${data.slice(0, 300)}` }
  }
  if (payload.error?.message) return { content: '', reasoning: '', error: payload.error.message }
  const choice = payload.choices?.[0]
  return {
    content: typeof choice?.delta?.content === 'string' ? choice.delta.content : '',
    reasoning: typeof choice?.delta?.reasoning_content === 'string' ? choice.delta.reasoning_content : '',
    finishReason: choice?.finish_reason ?? undefined,
    usage: payload.usage ? { promptTokens: payload.usage.prompt_tokens, completionTokens: payload.usage.completion_tokens } : undefined,
  }
}

/**
 * OpenAI 兼容 Chat Completions 客户端。
 * 负责流式读取、空闲超时、可重试错误的退避重试、JSON 模式降级和日志脱敏；
 * 不关心 Prompt 内容，也不依赖 Vue。
 */
export function createLlmClient(connection: LlmConnection, log: LlmLogger) {
  const endpoint = buildChatCompletionsEndpoint(connection.baseUrl)
  const safeEndpoint = endpoint.replace(/([?&](?:api[-_]?key|token)=)[^&]+/gi, '$1[REDACTED]')
  let jsonModeSupported = true
  let thinkingSwitchSupported = true

  async function requestOnce(messages: ChatMessage[], { stream, jsonMode, disableThinking }: RequestFlags, outerSignal?: AbortSignal): Promise<ChatResult> {
    const controller = new AbortController()
    const abortFromOuter = () => controller.abort()
    outerSignal?.addEventListener('abort', abortFromOuter, { once: true })
    // 流式请求使用“空闲超时”：只要持续收到数据（包括推理过程）就不会超时
    let timer = setTimeout(() => controller.abort(), connection.timeoutMs)
    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), connection.timeoutMs)
    }

    const body: Record<string, unknown> = {
      model: connection.model,
      messages,
      temperature: Number(connection.temperature),
      max_tokens: Number(connection.maxOutputTokens),
      stream,
    }
    if (jsonMode) body.response_format = { type: 'json_object' }
    // 结构化抽取不需要长推理；推理 token 会挤占 max_tokens，导致 JSON 被截断
    if (disableThinking) body.thinking = { type: 'disabled' }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const raw = await response.text()
        let message = raw
        try { message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw } catch { /* 保留原始响应 */ }
        throw new LlmHttpError(response.status, `HTTP ${response.status}：${(message || response.statusText || '空响应').slice(0, 600)}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!stream || contentType.includes('application/json')) {
        const raw = await response.text()
        let payload: {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
          error?: { message?: string }
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        try { payload = JSON.parse(raw) as typeof payload } catch { throw new Error(`模型返回了无法解析的 JSON：${raw.slice(0, 300)}`) }
        if (payload.error?.message) throw new Error(payload.error.message)
        const content = payload.choices?.[0]?.message?.content ?? ''
        const finishReason = payload.choices?.[0]?.finish_reason ?? ''
        if (finishReason === 'length') throw new LlmTruncatedError(content)
        if (!content.trim()) throw new Error(`Model response ended without text content：${raw.slice(0, 300)}`)
        return {
          content,
          finishReason,
          usage: payload.usage ? { promptTokens: payload.usage.prompt_tokens, completionTokens: payload.usage.completion_tokens } : undefined,
        }
      }

      if (!response.body) throw new Error('Model response has no readable body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let content = ''
      let finishReason = ''
      let usage: ChatResult['usage']
      const consume = (line: string) => {
        const part = parseStreamLine(line)
        if (part.error) throw new Error(part.error)
        content += part.content
        if (part.finishReason) finishReason = part.finishReason
        if (part.usage) usage = part.usage
      }
      while (true) {
        const { done, value } = await reader.read()
        resetTimer()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) consume(line)
        if (done) break
      }
      if (pending.trim()) consume(pending)
      if (finishReason === 'length') throw new LlmTruncatedError(content)
      if (!content.trim()) throw new Error(`Model response ended without text content${finishReason ? `（finish_reason=${finishReason}）` : ''}`)
      return { content, finishReason, usage }
    } catch (error) {
      if (isAbortError(error) && !outerSignal?.aborted) throw new Error(`请求超时（${connection.timeoutMs} ms 内没有收到数据）`)
      throw error
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', abortFromOuter)
    }
  }

  async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const label = options.label ? `[${options.label}] ` : ''
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // 首次使用流式；流式失败后退回非流式，兼容不支持 SSE 的代理
      const stream = attempt === 1
      const jsonMode = Boolean(options.jsonMode && jsonModeSupported)
      const disableThinking = options.thinking === false && thinkingSwitchSupported
      const startedAt = Date.now()
      try {
        const result = await requestOnce(messages, { stream, jsonMode, disableThinking }, options.signal)
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
        const tokens = result.usage?.completionTokens ? `，输出 ${result.usage.completionTokens} tokens` : ''
        log('info', `${label}模型响应 ${result.content.length.toLocaleString()} 字符，用时 ${seconds}s${tokens}`)
        return result
      } catch (error) {
        if (options.signal?.aborted) throw error
        lastError = error
        if (jsonMode && looksLikeJsonModeUnsupported(error)) {
          jsonModeSupported = false
          log('warning', `${label}服务商不支持 response_format=json_object，已切换为普通文本输出。`)
          attempt -= 1
          continue
        }
        if (disableThinking && looksLikeThinkingUnsupported(error)) {
          thinkingSwitchSupported = false
          log('warning', `${label}服务商不支持 thinking 参数，已改为默认推理设置。`)
          attempt -= 1
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
          if (!(error instanceof LlmTruncatedError)) log('error', `${label}POST ${safeEndpoint} 失败：${message}`)
          break
        }
        const delay = error instanceof LlmHttpError && error.status === 429 ? 4000 * attempt : 800 * attempt
        log('warning', `${label}请求失败（${attempt}/${MAX_ATTEMPTS}），${delay} ms 后重试：${message}`)
        await sleep(delay, options.signal)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Model request failed'))
  }

  return { chat, endpoint: safeEndpoint }
}

export type LlmClient = ReturnType<typeof createLlmClient>

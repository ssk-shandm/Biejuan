import { ref } from 'vue'
import { saveExportBlob } from '../services/fileService'

export type RuntimeLogLevel = 'info' | 'warn' | 'error'

export interface RuntimeLogEntry {
  id: number
  level: RuntimeLogLevel
  message: string
  timestamp: string
}

/** Stable, self-contained format used when sharing a runtime log report. */
export interface RuntimeLogPackage {
  format: 'biejuan-runtime-logs'
  schemaVersion: 1
  exportedAt: string
  logs: RuntimeLogEntry[]
}

const MAX_RUNTIME_LOGS = 300
const runtimeLogs = ref<RuntimeLogEntry[]>([])
let nextLogId = 1
let installed = false

const SENSITIVE_KEY_PATTERN = /(api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|password|secret)/i

function redactText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*)([^\s,;}]+)/gi, '$1[REDACTED]')
}

function stringifyValue(value: unknown): string {
  if (value instanceof Error) return redactText(value.stack || value.message)
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`

  try {
    const serialized = JSON.stringify(value, (key, nestedValue) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'
      return nestedValue
    })
    return redactText(serialized ?? String(value))
  } catch {
    return '[无法序列化的运行信息]'
  }
}

export function createRuntimeLogPackage(logs: RuntimeLogEntry[] = runtimeLogs.value): RuntimeLogPackage {
  return {
    format: 'biejuan-runtime-logs',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    // Copy entries so a download cannot be affected by subsequent console output.
    logs: logs.map(entry => ({ ...entry })),
  }
}

/** Save a redacted log snapshot through the platform-neutral export path. */
export async function saveRuntimeLogs(logs: RuntimeLogEntry[] = runtimeLogs.value): Promise<boolean> {
  if (logs.length === 0) return false
  const report = createRuntimeLogPackage(logs)
  const stamp = report.exportedAt.replace(/[:.]/g, '-')
  const text = report.logs
    .map(entry => `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}`)
    .join('\n')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('runtime-logs.json', JSON.stringify(report, null, 2))
  zip.file('runtime-logs.txt', text ? `${text}\n` : '')
  zip.file('README.txt', [
    'Biejuan runtime log package',
    `Exported at: ${report.exportedAt}`,
    `Entries: ${report.logs.length}`,
    '',
    'runtime-logs.json contains structured entries.',
    'runtime-logs.txt is a plain-text rendering for quick review.',
    'Secrets are redacted before entries are collected.',
  ].join('\n'))
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
  return saveExportBlob(`runtime-logs-${stamp}.zip`, blob)
}

function formatArguments(values: unknown[]): string {
  return values.map(stringifyValue).join(' ')
}

export function addRuntimeLog(level: RuntimeLogLevel, ...values: unknown[]) {
  const message = formatArguments(values).trim()
  if (!message) return

  runtimeLogs.value.push({
    id: nextLogId++,
    level,
    message,
    timestamp: new Date().toLocaleTimeString([], { hour12: false }),
  })

  if (runtimeLogs.value.length > MAX_RUNTIME_LOGS) {
    runtimeLogs.value.splice(0, runtimeLogs.value.length - MAX_RUNTIME_LOGS)
  }
}

function installRuntimeConsole() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  console.log = (...values) => {
    originalConsole.log(...values)
    addRuntimeLog('info', ...values)
  }
  console.info = (...values) => {
    originalConsole.info(...values)
    addRuntimeLog('info', ...values)
  }
  console.warn = (...values) => {
    originalConsole.warn(...values)
    addRuntimeLog('warn', ...values)
  }
  console.error = (...values) => {
    originalConsole.error(...values)
    addRuntimeLog('error', ...values)
  }

  window.addEventListener('error', (event) => {
    addRuntimeLog('error', '[未处理异常]', event.error || event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    addRuntimeLog('error', '[未处理 Promise 异常]', event.reason)
  })
}

installRuntimeConsole()

export function useRuntimeConsole() {
  return {
    runtimeLogs,
    addRuntimeLog,
    saveRuntimeLogs,
    clearRuntimeLogs: () => { runtimeLogs.value = [] },
  }
}

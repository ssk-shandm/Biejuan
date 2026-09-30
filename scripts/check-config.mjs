#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import {
  loadLlmFramework,
  readJsonFile,
  renderPrompt,
  resolveConfigReference,
} from './lib/llm-config.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CONFIG_DIR = join(ROOT, 'public', 'config')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const jsonFiles = walk(CONFIG_DIR).filter((file) => extname(file) === '.json')
for (const file of jsonFiles) readJsonFile(file)

const loaded = loadLlmFramework()
const promptIds = new Set()
for (const { path, config: prompt } of loaded.prompts) {
  if (promptIds.has(prompt.id)) throw new Error(`Prompt id 重复: ${prompt.id}`)
  promptIds.add(prompt.id)

  const declared = new Set([
    ...(prompt.variables?.required ?? []),
    ...Object.keys(prompt.variables?.optional ?? {}),
  ])
  const placeholders = prompt.messages.flatMap((message) =>
    [...String(message.content).matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g)].map((match) => match[1]),
  )
  const undeclared = [...new Set(placeholders)].filter((name) => !declared.has(name))
  if (undeclared.length > 0) {
    throw new Error(`${path} 使用了未声明变量: ${undeclared.join(', ')}`)
  }

  // 中间步骤（结构分析、答案匹配）输出的是辅助 JSON，可以不声明 Schema；声明了就必须指向题库 Schema
  if (prompt.response?.schema) {
    const schemaPath = resolveConfigReference(path, prompt.response.schema)
    if (schemaPath !== loaded.outputSchemaPath) {
      throw new Error(`${path} 的输出 Schema 与 framework.outputSchema 不一致`)
    }
  }

  // 用占位值渲染一次，确认必填变量和占位符一致
  const sampleValues = Object.fromEntries((prompt.variables?.required ?? []).map((name) => [name, `示例 ${name}`]))
  renderPrompt(prompt, sampleValues)
}

if (!loaded.prompts.some(({ step }) => step.id === 'convert')) throw new Error('LLM framework 缺少 convert 步骤')

const examplePath = join(CONFIG_DIR, 'examples', 'question-bank.example.json')
const exampleBank = readJsonFile(examplePath)
if (!Array.isArray(exampleBank) || exampleBank.length === 0) {
  throw new Error(`${examplePath} 必须是非空数组`)
}
const numbers = new Set()
for (const [index, question] of exampleBank.entries()) {
  for (const field of ['id', 'number', 'type', 'content', 'answer']) {
    if (!(field in question)) throw new Error(`${examplePath}[${index}] 缺少字段 ${field}`)
  }
  if (numbers.has(question.number)) throw new Error(`${examplePath} 存在重复题号 ${question.number}`)
  numbers.add(question.number)
}

const userConfigPath = join(CONFIG_DIR, 'examples', 'llm-user-config.example.json')
const userConfig = readJsonFile(userConfigPath)
if (String(userConfig.provider?.apiKey ?? '').trim() !== '') {
  throw new Error(`${userConfigPath} 不得包含真实 API Key`)
}
if (userConfig.privacy?.allowRemoteProcessing !== false) {
  throw new Error(`${userConfigPath} 必须默认禁止远程处理`)
}

const rawFiles = jsonFiles.map((file) => [file, readFileSync(file, 'utf8')])
const suspiciousKey = rawFiles.find(([file, content]) =>
  !file.endsWith('llm-user-config.schema.json') && /"apiKey"\s*:\s*"(?!\s*")/.test(content),
)
if (suspiciousKey) throw new Error(`配置中疑似包含 API Key: ${suspiciousKey[0]}`)

console.log(`[config:check] OK - ${jsonFiles.length} 个 JSON 文件，${loaded.prompts.length} 个 Prompt`)
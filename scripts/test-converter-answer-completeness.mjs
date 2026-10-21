import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import Ajv2020 from 'ajv/dist/2020.js'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/^\uFEFF/, '')
function loadTs(path, imports = {}) {
  const module = { exports: {} }
  runInNewContext(ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => imports[name] ?? require(name) })
  return module.exports
}
const contentFormat = loadTs('src/utils/contentFormat.ts')
const examStructure = loadTs('src/utils/examStructure.ts')
const { convertDocumentToQuestionBank } = loadTs('src/services/questionBankConverter.ts', {
  '../utils/contentFormat': contentFormat,
  '../utils/examStructure': examStructure,
  '../services/llmClient': { LlmTruncatedError: class extends Error {} },
  './llmClient': { LlmTruncatedError: class extends Error {} },
  '../utils/llmFramework': {
    renderPromptMessages: (prompt, variables) => prompt.messages.map(message => ({ ...message,
      content: message.content.replace(/{{\s*(\w+)\s*}}/g, (_, key) => variables[key] ?? prompt.variables?.optional?.[key] ?? ''),
    })),
  },
})
const schema = JSON.parse(read('public/config/schemas/question-bank.schema.json'))
const validate = new Ajv2020({ strict: false }).compile(schema)
const prompts = Object.fromEntries(['analyze', 'convert', 'answer-match', 'repair'].map(step => [step,
  JSON.parse(read(`public/config/llm/prompts/question-bank-${step}.prompt.json`)),
]))

async function convertCase(questions, matches) {
  let matchingCalls = 0
  const result = await convertDocumentToQuestionBank({
    framework: { framework: { input: {}, pipeline: [] }, prompts, outputSchema: schema },
    sourceName: 'generic-mixed-study-document.txt', sourceText: '第一章练习\n1. 请选择原文选项\n另一道实际试题\n参考解答与步骤\n原文解答\n后续解析',
    maxOutputTokens: 10000, resolveImagePath: id => id, log: () => {},
    validate: value => ({ valid: validate(value), errors: JSON.stringify(validate.errors) }),
    client: { chat: async (messages, options) => {
      let response
      if (options.label === '结构分析') response = { sections: [
        { startLine: 1, endLine: 3, role: 'questions', title: '第一章' },
        { startLine: 4, endLine: 6, role: 'answers', title: '第一章参考解答与步骤' },
      ] }
      else if (options.label.startsWith('答案匹配')) { matchingCalls++; response = { answers: matches } }
      else if (options.label.startsWith('分段')) response = { questions }
      else throw new Error(`Unexpected request ${options.label}`)
      return { content: JSON.stringify(response) }
    } },
  })
  return { result, matchingCalls }
}
const choice = extra => ({ startLine: 2, endLine: 2, sourceNumber: '1', type: 'single',
  content: '请选择原文选项', options: { A: '原文甲', B: '原文乙' }, answer: 'A', ...extra })

test('已有行内答案仍补独立解析，解析单独返回时不丢弃、不修改原答案', async () => {
  const { result, matchingCalls } = await convertCase([choice()], [{ key: '1', explanation: '依据：原文说明甲。\n排除：乙与条件不符。' }])
  assert.equal(matchingCalls, 1)
  assert.equal(result.questions[0].answer, 'A')
  assert.match(result.questions[0].explanation, /依据.*\n排除/)
  assert.equal(result.stats.answersMatched, 0, '补解析不应虚增补答案数量')
})

test('补解析时不覆盖已有答案；已有完整答案解析无需重复匹配', async () => {
  const { result } = await convertCase([choice()], [{ key: '1', answer: 'B', explanation: '原文解析' }])
  assert.equal(result.questions[0].answer, 'A')
  assert.equal(result.questions[0].explanation, '原文解析')
  const complete = await convertCase([choice({ explanation: '保留已有完整解析' })], [])
  assert.equal(complete.matchingCalls, 0)
  assert.equal(complete.result.questions[0].explanation, '保留已有完整解析')
})

test('开放题参考解答正常回填；只有解析没有答案时不伪造解答', async () => {
  const open = choice({ type: 'short-answer', options: undefined, answer: '', content: '按原文要求说明实验过程' })
  const { result } = await convertCase([open], [{ key: '1', answer: '原文参考步骤：先观察，再记录。', explanation: '评分依据：记录过程完整。' }])
  assert.match(result.questions[0].answer, /原文参考步骤/)
  assert.equal(result.stats.answersMatched, 1)
  const explanationOnly = await convertCase([open], [{ key: '1', explanation: '原文仅说明评价标准。' }])
  assert.equal(explanationOnly.result.questions[0].answer, '')
  assert.equal(explanationOnly.result.questions[0].explanation, '原文仅说明评价标准。')
})

test('综合题已有小问答案仍保留独立小问解析，未知 key 不回填', async () => {
  const compound = choice({ type: 'compound', options: undefined, answer: '', scenario: '实验材料',
    subQuestions: [{ id: 1, type: 'fill', content: '观察结果', answer: '原文结果' }],
  })
  const { result } = await convertCase([compound], [
    { key: '1.1', explanation: '依据：材料中的实验记录。' },
    { key: '999', answer: '假答案', explanation: '不能写入' },
  ])
  assert.equal(result.questions[0].subQuestions[0].answer, '原文结果')
  assert.match(result.questions[0].explanation, /（1）依据/)
  assert.doesNotMatch(JSON.stringify(result.questions), /假答案|不能写入/)
})

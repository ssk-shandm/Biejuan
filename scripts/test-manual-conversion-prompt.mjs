import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import Ajv2020 from 'ajv/dist/2020.js'
import ts from 'typescript'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const schema = JSON.parse(read('public/config/schemas/question-bank.schema.json'))
const convert = JSON.parse(read('public/config/llm/prompts/question-bank-convert.prompt.json'))
const module = { exports: {} }
runInNewContext(ts.transpileModule(read('src/utils/manualConversionPrompt.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: module.exports, module })
const { buildManualConversionPrompt, MANUAL_CONVERSION_EXAMPLE } = module.exports
const loaded = { prompts: { convert }, outputSchema: schema }

test('手动 Prompt 独立于中间流水线契约，包含最终数组 Schema 与可通过校验的示例', () => {
  const prompt = buildManualConversionPrompt(loaded)
  assert.ok(!prompt.includes(convert.messages.find(message => message.role === 'system').content))
  assert.doesNotMatch(prompt, /输入是一段逐行编号|根据区段描述|只输出一个 JSON 对象/)
  assert.equal(buildManualConversionPrompt({ outputSchema: schema }), prompt, '手动转换不能依赖不存在的结构分析器或中间输出')
  assert.ok(prompt.includes(JSON.stringify(schema, null, 2)))
  assert.match(prompt, /根节点必须是数组/)
  assert.match(prompt, /startLine、endLine、sourceNumber/)
  assert.doesNotMatch(prompt, /{{\s*\w+\s*}}/, '不可导出依赖内部上下文的未填变量')
  const validate = new Ajv2020({ strict: false }).compile(schema)
  assert.equal(validate(MANUAL_CONVERSION_EXAMPLE), true, JSON.stringify(validate.errors))
})

test('手动 Prompt 告知分段和输出截断风险、导入步骤及隐私，不导出连接信息', () => {
  const prompt = buildManualConversionPrompt({ ...loaded, provider: { apiKey: 'secret-key-for-test' } })
  assert.match(prompt, /自动分段、流式接收、续接/)
  assert.match(prompt, /不代表能够避开上下文或输出长度限制/)
  assert.match(prompt, /不要直接拼接多个 JSON 数组/)
  assert.match(prompt, /UTF-8.*\.json/)
  assert.match(prompt, /题库资源 → 导入 JSON 题库/)
  assert.match(prompt, /确认导入/)
  assert.doesNotMatch(prompt, /secret-key-for-test/)
  assert.throws(() => buildManualConversionPrompt({ outputSchema: {} }), /Schema 不完整/)
})

test('通用阅读契约覆盖分页重排、重述去重、章节同号、独立答案与解析，不绑定具体试卷', () => {
  const prompt = buildManualConversionPrompt(loaded)
  for (const rule of [
    '末尾和附件', '未读到不能直接判为原文没有', '无法访问文件',
    '不同章节或不同文件都可能有第 1 题', '答案/解析可能先于题号',
    '只生成一次', '已经找到答案仍要寻找对应解析', '跨页续写', '参考范文', '参考译文',
    '定位、依据、同义替换', '优先保留原语言', '不能只输出一句陈述和一个字母',
    '不能仅凭出现顺序强行配对', '报告与 JSON 是不同响应状态', '格式校验不代表答案和解析完整正确',
    '若输入可完整访问且输出可容纳，直接给完整 JSON', '不要写「未知」「待补充」等假答案',
  ]) assert.ok(prompt.includes(rule), `缺少通用阅读规则：${rule}`)
  assert.doesNotMatch(prompt, /四级|2025|146 页|197348|lazynote|55 题/, '不得把样本文档结构写死进导出提示词')
})

test('共享提示词不再强制丢弃范文或公共材料，不将单选字母误转为词语', () => {
  const readPrompt = step => JSON.parse(read(`public/config/llm/prompts/question-bank-${step}.prompt.json`).replace(/^\uFEFF/, '')).messages.map(message => message.content).join('\n')
  const conversion = readPrompt('convert')
  assert.doesNotMatch(conversion, /content 写陈述句原文，不要输出文章正文|翻译或写作题，则用 short-answer，content 写原文题目内容，answer 留空/)
  assert.match(conversion, /参考范文、参考译文/)
  assert.match(conversion, /scenario 中保留作答必需的文章材料/)
  assert.match(conversion, /不只按题型名称/)
  assert.match(conversion, /每个空有独立备选项且要求选一个时用 single/)
  assert.match(conversion, /选项保留原段落字母及对应完整段落/)
  const matching = readPrompt('answer-match')
  assert.match(matching, /single\/multiple 只取有效选项字母/)
  assert.match(matching, /即使题目已有答案/)
  assert.match(matching, /可单独返回 explanation/)
  const analysis = readPrompt('analyze')
  assert.match(analysis, /重复题解标为 answers/)
  assert.match(analysis, /唯一的题目只出现在讲解中/)
})

test('Prompt 导出不要求配置 AI，不调用模型，并使用平台文件导出处理取消和失败', () => {
  const component = read('src/components/AiModelSettings.vue')
  assert.match(component, /data-tour="prompt-export"/)
  assert.match(component, /@click='exportPrompt'/)
  const handler = component.slice(component.indexOf('async function exportPrompt'), component.indexOf('async function saveSettings'))
  assert.match(handler, /saveExportBlob/)
  assert.match(handler, /loadLlmFramework/)
  assert.match(handler, /已取消导出/)
  assert.match(handler, /catch \(error\)/)
  assert.doesNotMatch(handler, /validateConnection|provider\.|fetch\(/)
})

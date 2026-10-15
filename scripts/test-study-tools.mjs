import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { Marked } from 'marked'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
function loadTs(path, imports = {}) {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => imports[name] ?? require(name),
  })
  return module.exports
}

const { mathExtensions } = loadTs('src/utils/math.ts')
const markdown = new Marked({ extensions: mathExtensions })

test('inline and display LaTeX support powers, fractions, roots and legacy delimiters', () => {
  for (const formula of ['$x^{2}$', '$\\frac{1}{2}$', '$\\sqrt{x}$', '\\(x^2\\)', 'x^2', '2^{10}']) {
    assert.match(markdown.parse(formula), /class="katex"/)
    assert.doesNotMatch(markdown.parse(formula), /katex-error/)
  }
  for (const formula of ['$$\nx^2 + y^2\n$$', '\\[x^2\\]']) {
    assert.match(markdown.parse(formula), /katex-display/)
  }
})

test('math leaves inline code, code fences and ordinary prices untouched', () => {
  assert.doesNotMatch(markdown.parse('`$x^2$`\n\n```js\nx^2\n```'), /class="katex"/)
  assert.doesNotMatch(markdown.parse('价格 $20 和 $30，预算 $ 50'), /class="katex"/)
  assert.match(markdown.parse('![配图](https://example.com/figure.png)'), /<img /)
})

test('invalid and untrusted LaTeX never executes HTML or trusted links', () => {
  assert.match(markdown.parse('$\\notACommand{x}$'), /katex/)
  assert.doesNotMatch(markdown.parse('$\\href{javascript:alert(1)}{x}$'), /href="javascript:/)
  assert.doesNotMatch(markdown.parse('$\\htmlClass{attacker}{x}$'), /class="attacker"/)
})

test('markdown answer normalization accepts delimited powers without discarding program output', () => {
  const { stripMarkdown } = loadTs('src/utils/markdown.ts', {
    dompurify: { sanitize: value => value },
    './math': { mathExtensions },
  })
  for (const value of ['$x^{2}$', '$$x^{2}$$', '\\(x^2\\)', '\\[x^2\\]', 'x²', 'x^2']) {
    assert.equal(stripMarkdown(value), 'x^2')
  }
  assert.equal(stripMarkdown('```text\n42\n```'), '42')
  assert.equal(stripMarkdown('**答案**'), '答案')
})

test('default and inherited formats use Markdown while legacy formats remain loadable', () => {
  const { normalizeContentFormat, inheritedContentFormat } = loadTs('src/utils/contentFormat.ts')
  assert.equal(normalizeContentFormat(undefined), 'markdown')
  assert.equal(normalizeContentFormat('txt'), 'text')
  assert.equal(inheritedContentFormat('mermaid'), 'markdown')
  assert.equal(inheritedContentFormat('plantuml'), 'markdown')
})

test('question clipboard formatting includes stems and options without answers', () => {
  const { formatQuestionForClipboard } = loadTs('src/utils/questionClipboard.ts')
  const text = formatQuestionForClipboard({
    number: 3,
    type: '综合题',
    question: '请分析下面的代码。',
    format: 'markdown',
    options: {},
    answer: '不应复制',
    explanation: '解析不应复制',
    wrongDescription: '错题描述不应复制',
    images: ['https://example.com/question.png'],
    answerFormat: 'markdown',
    explanationFormat: 'markdown',
    scenarioFormat: 'markdown',
    subQuestions: [
      {
        id: 1,
        question: '输出结果是什么？',
        type: '单选题',
        format: 'markdown',
        options: { A: '1', B: '2' },
        answer: 'A',
        answerFormat: 'markdown',
      },
      {
        id: 2,
        question: '请说明原因。',
        type: '简答题',
        format: 'markdown',
        options: {},
        answer: '不应复制',
        answerFormat: 'markdown',
      },
    ],
  })

  assert.match(text, /请分析下面的代码。/)
  assert.match(text, /题目图片：\n1\. https:\/\/example\.com\/question\.png/)
  assert.match(text, /第1小题：\n输出结果是什么？\n选项：\nA\. 1\nB\. 2/)
  assert.match(text, /第2小题：\n请说明原因。/)
  assert.doesNotMatch(text, /不应复制|解析不应复制|错题描述不应复制/)
})

test('judgment question clipboard formatting supplies visible choices', () => {
  const { formatQuestionForClipboard } = loadTs('src/utils/questionClipboard.ts')
  const text = formatQuestionForClipboard({
    number: 1,
    type: '判断题',
    question: 'JavaScript 可以在浏览器中运行。',
    format: 'text',
    options: {},
    answer: 'A',
    explanation: '',
    wrongDescription: '',
    images: [],
    answerFormat: 'text',
    explanationFormat: 'text',
    scenarioFormat: 'text',
  })

  assert.match(text, /选项：\nA\. 正确\nB\. 错误/)
})

test('single-question wrong-book action has no success dialog and conversion prompts preserve math', () => {
  const component = read('src/components/QuestionDisplay.vue')
  const action = component.match(/function addToWrong\(\) \{[\s\S]*?(?=\nfunction addGuessed)/)[0]
  assert.match(action, /quizStore\.addWrongEntry/)
  assert.doesNotMatch(action, /showToast|showConfirm|alert\(/)
  for (const step of ['convert', 'answer-match', 'repair']) {
    const prompt = JSON.parse(read(`public/config/llm/prompts/question-bank-${step}.prompt.json`))
    assert.match(prompt.messages[0].content, /Markdown/)
    assert.match(prompt.messages[0].content, /LaTeX/)
    assert.match(prompt.messages[0].content, /平方/)
  }
})

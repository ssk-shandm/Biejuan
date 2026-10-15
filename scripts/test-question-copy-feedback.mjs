import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const source = readFileSync(new URL('../src/components/QuestionDisplay.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const compiled = ts.transpileModule(script + '\nmodule.exports = { copyState, copyLabel, isCopying, handleCopyQuestion }', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function setup(copy = async () => {}) {
  const props = vue.reactive({ question: { number: 1 }, questionNumber: 1, bankFile: 'bank.json', appMode: 'practice' })
  const module = { exports: {} }
  const timers = new Map()
  const calls = []
  let unmount
  let timerId = 0
  const scope = vue.effectScope()
  scope.run(() => runInNewContext(compiled, {
    module,
    exports: module.exports,
    defineProps: () => props,
    withDefaults: value => value,
    defineEmits: () => () => {},
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay })
      return timerId
    },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name === 'vue') return { ...vue, onBeforeUnmount: callback => { unmount = callback } }
      if (name === '../stores/quizStore') return { useQuizStore: () => ({}) }
      if (name === '../utils/questionClipboard') return {
        formatQuestionForClipboard: question => `question ${question.number}`,
        copyTextToClipboard: text => { calls.push(text); return copy(text) },
      }
      return {}
    },
  }))
  return {
    ...module.exports, props, timers, calls,
    dispose: () => { unmount(); scope.stop() },
  }
}

test('copy success shows persistent feedback and resets after two seconds', async t => {
  const api = setup()
  t.after(api.dispose)
  const pending = api.handleCopyQuestion()
  assert.equal(api.isCopying.value, true)
  assert.equal(api.copyLabel.value, '复制中…')
  await pending
  assert.equal(api.copyState.value, 'success')
  assert.equal(api.copyLabel.value, '已复制')
  assert.equal(api.isCopying.value, false)
  assert.deepEqual(api.calls, ['question 1'])
  const [timer] = api.timers.values()
  assert.equal(timer.delay, 2000)
  timer.callback()
  assert.equal(api.copyLabel.value, '复制题目')
  assert.equal(api.timers.size, 0)
})

test('failure shows inline retry feedback and allows another copy immediately', async t => {
  let fail = true
  const api = setup(async () => { if (fail) throw new Error('clipboard denied') })
  t.after(api.dispose)
  await api.handleCopyQuestion()
  assert.equal(api.copyState.value, 'error')
  assert.equal(api.copyLabel.value, '复制失败，重试')
  assert.equal([...api.timers.values()][0].delay, 3000)
  fail = false
  await api.handleCopyQuestion()
  assert.equal(api.copyState.value, 'success')
  assert.equal(api.calls.length, 2)
  assert.equal(api.timers.size, 1)
})

test('pending copy ignores repeated clicks', async t => {
  let finish
  const api = setup(() => new Promise(resolve => { finish = resolve }))
  t.after(api.dispose)
  const pending = api.handleCopyQuestion()
  await api.handleCopyQuestion()
  assert.equal(api.calls.length, 1)
  finish()
  await pending
  assert.equal(api.copyState.value, 'success')
})

test('navigation clears feedback and stale results cannot update the next question', async t => {
  const completions = []
  const api = setup(() => new Promise(resolve => completions.push(resolve)))
  t.after(api.dispose)
  const first = api.handleCopyQuestion()
  api.props.question = { number: 2 }
  assert.equal(api.copyState.value, 'idle')
  const second = api.handleCopyQuestion()
  completions[0]()
  await first
  assert.equal(api.copyState.value, 'copying')
  assert.equal(api.timers.size, 0)
  completions[1]()
  await second
  assert.equal(api.copyState.value, 'success')
  assert.deepEqual(api.calls, ['question 1', 'question 2'])
  api.props.bankFile = 'another-bank.json'
  assert.equal(api.copyState.value, 'idle')
  assert.equal(api.timers.size, 0)
})

test('unmount clears timers and ignores pending clipboard completions', async () => {
  const completed = setup()
  await completed.handleCopyQuestion()
  completed.dispose()
  assert.equal(completed.timers.size, 0)

  let finish
  const pendingApi = setup(() => new Promise(resolve => { finish = resolve }))
  const pending = pendingApi.handleCopyQuestion()
  pendingApi.dispose()
  finish()
  await pending
  assert.equal(pendingApi.copyState.value, 'idle')
  assert.equal(pendingApi.timers.size, 0)
})

test('copy feedback stays within the button and respects reduced motion', () => {
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /:disabled="isCopying"/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  const handler = script.match(/async function handleCopyQuestion\(\) \{[\s\S]*?(?=\nfunction addToWrong)/)[0]
  assert.doesNotMatch(handler, /showToast|showConfirm|alert\(/)
})

test('copy button reuses neighboring action-button styles', () => {
  assert.match(source, /class="wrong-btn copy-question-btn"/)
  assert.match(source, /<svg v-if="copyState !== 'idle'" class="copy-question-icon"/)
  const baseStyle = source.match(/\.copy-question-btn \{([^}]+)\}/)[1]
  assert.match(baseStyle, /background-color: var\(--color-bg-btn-secondary\)/)
  assert.match(baseStyle, /color: var\(--color-text-btn-secondary\)/)
  assert.doesNotMatch(baseStyle, /(?:^|\n)\s*(?:padding|border|border-radius|font|font-size|font-weight):/)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import * as pinia from 'pinia'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const bank = 'retry.json'
const question = number => ({ number, type: '单选题', question: `Question ${number}`, answer: 'A' })

async function setup(t, saved = new Map()) {
  const messages = []
  const exports = []
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
  }
  let store
  let unmount
  const scope = vue.effectScope()
  function evaluate(path, hooks = vue) {
    const module = { exports: {} }
    runInNewContext(ts.transpileModule(read(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: name => {
        if (name === 'vue') return hooks
        if (name === 'pinia') return pinia
        if (name.endsWith('useToast')) return {
          showToast: message => { messages.push(message); return Promise.resolve() },
          showConfirm: async () => true,
        }
        if (name.endsWith('quizStore')) return { useQuizStore: () => store }
        if (name.endsWith('learningPersistence')) return { persistLearningState: async () => {} }
        if (name.endsWith('quizData')) return evaluate('src/utils/quizData.ts')
        if (name.endsWith('fileService')) return {
          saveExportBlob: async (name, blob) => { exports.push({ name, text: await blob.text() }); return true },
        }
        return {}
      },
      localStorage, Blob, console,
      window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, history: { pushState() {} } },
      document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
      setTimeout: () => 1, clearTimeout() {},
    })
    return module.exports
  }
  store = evaluate('src/stores/quizStore.ts').useQuizStore(pinia.createPinia())
  await store.persistedDataReady
  const { useQuiz } = evaluate('src/composables/useQuiz.ts', {
    ...vue, onMounted() {}, onUnmounted: callback => { unmount = callback },
  })
  const api = scope.run(useQuiz)
  api.currentBankFile.value = bank
  t.after(() => { unmount(); scope.stop(); store.$dispose() })
  return { ...api, store, messages, exports, saved }
}

function seed(api, questions) {
  const source = api.store.createNotebook('第一轮错题', bank)
  for (const q of questions) api.store.addWrongEntryToNotebook(q.number, bank, source.id)
  api.questions.value = questions
  api.handleStartGame('wrong', false)
  return source
}

test('retry collection excludes correct, unanswered and ungraded questions without creating an empty notebook', async t => {
  const api = await setup(t)
  const source = seed(api, [question(1), question(2), question(3)])
  api.handleAnswerUpdate('A', question(1))
  api.answerSheet.value.set(2, { userAnswer: 'ungraded draft', isCorrect: null, showResult: false })
  api.handleAddToWrongBook()
  assert.equal(api.store.notebooks.length, 1)
  assert.equal(api.store.getActiveNotebook(bank).id, source.id)
  assert.match(api.messages.at(-1), /还没有再次答错/)
})

test('retry collection deduplicates wrong questions, includes failed subquestions and preserves the source', async t => {
  const api = await setup(t)
  const compound = { number: 4, type: '综合题', answer: '', subQuestions: [
    { id: 1, type: '单选题', answer: 'A' }, { id: 2, type: '单选题', answer: 'A' },
  ] }
  const source = seed(api, [question(1), question(1), question(2), question(3), compound])
  const before = JSON.stringify(api.store.getEntriesByNotebook(source.id))
  api.handleAnswerUpdate('B', question(1))
  api.handleAnswerUpdate('A', question(2))
  api.handleSubSubmit(compound, 1, 'B')
  assert.equal(api.answerSheet.value.get(4).isCorrect, null)
  api.handleAddToWrongBook()
  await vue.nextTick()
  const target = api.store.notebooks.find(nb => nb.id !== source.id)
  assert.deepEqual(Array.from(api.store.getEntriesByNotebook(target.id), entry => entry.questionNumber), [1, 4])
  assert.equal(target.bankFile, bank)
  assert.equal(api.store.getActiveNotebook(bank).id, source.id)
  assert.equal(JSON.stringify(api.store.getEntriesByNotebook(source.id)), before)
  assert.equal(api.shuffledQuestions.value.length, 5)
  assert.equal(api.answerSheet.value.get(1).isCorrect, false)
  assert.equal(api.appMode.value, 'wrong')
  api.handleAddToWrongBook()
  assert.equal(new Set(api.store.notebooks.map(nb => nb.name)).size, 3)
  const allEntryIds = api.store.wrongEntries.map(entry => entry.id)
  assert.equal(new Set(allEntryIds).size, allEntryIds.length)
})

test('new notebooks start fresh, can generate another notebook, export, remove entries and survive reload', async t => {
  const api = await setup(t)
  const source = seed(api, [question(1), question(2)])
  api.handleAnswerUpdate('B', question(1))
  api.handleAnswerUpdate('A', question(2))
  api.handleAddToWrongBook()
  const target = api.store.notebooks.find(nb => nb.id !== source.id)
  api.handleBackToHome()
  api.store.setActiveNotebook(bank, target.id)
  api.handleStartGame('wrong', false)
  assert.equal(api.answerSheet.value.size, 0)
  assert.deepEqual(Array.from(api.shuffledQuestions.value, q => q.number), [1])
  api.handleAnswerUpdate('B', question(1))
  api.handleAddToWrongBook()
  const next = api.store.notebooks.find(nb => nb.id !== source.id && nb.id !== target.id)
  assert.deepEqual(Array.from(api.store.getEntriesByNotebook(next.id), entry => entry.questionNumber), [1])
  assert.equal(api.store.getActiveNotebook(bank).id, target.id)
  await api.store.exportNotebook(next.id, api.questions.value)
  assert.deepEqual(JSON.parse(api.exports[0].text).map(q => q.number), [1])
  api.handleBackToHome()
  api.store.setActiveNotebook(bank, source.id)
  api.handleStartGame('wrong', false)
  assert.equal(api.answerSheet.value.get(1).isCorrect, false)
  assert.equal(api.answerSheet.value.get(2).isCorrect, true)
  await vue.nextTick()
  const reloaded = await setup(t, api.saved)
  reloaded.questions.value = api.questions.value
  reloaded.store.setActiveNotebook(bank, target.id)
  reloaded.handleStartGame('wrong', false)
  assert.equal(reloaded.answerSheet.value.get(1).isCorrect, false)
  assert.equal(reloaded.answerSheet.value.has(2), false)
  reloaded.store.setActiveNotebook(bank, next.id)
  reloaded.handleStartGame('wrong', false)
  assert.equal(reloaded.answerSheet.value.size, 0)
  reloaded.store.removeWrongEntry(reloaded.wrongDisplayEntryIds.value[0])
  await vue.nextTick()
  assert.equal(reloaded.shuffledQuestions.value.length, 0)
  assert.equal(reloaded.store.getEntriesByNotebook(source.id).length, 2)
})

test('legacy bank-wide progress migrates to only one notebook', async t => {
  const saved = new Map([[`wrong_session_${bank}`, JSON.stringify({
    answers: [[1, { userAnswer: 'B', isCorrect: false, showResult: true }]], currentIndex: 0,
  })]])
  const api = await setup(t, saved)
  const source = seed(api, [question(1)])
  assert.equal(api.answerSheet.value.get(1).isCorrect, false)
  assert.equal(saved.has(`wrong_session_${bank}`), false)
  assert.equal(saved.has(`wrong_session_${bank}_${source.id}`), true)
  api.handleAddToWrongBook()
  api.handleBackToHome()
  const target = api.store.notebooks.find(nb => nb.id !== source.id)
  api.store.setActiveNotebook(bank, target.id)
  api.handleStartGame('wrong', false)
  assert.equal(api.answerSheet.value.size, 0)
})

test('simplified pages remove redundant UI but retain practice, export and configuration entry points', () => {
  const manager = read('src/components/WrongNotebookManager.vue')
  assert.doesNotMatch(manager, /备份全部|恢复全部|wm-quick-start|backupAll|restoreAll/)
  assert.match(manager, /startPractice', nb.id/)
  assert.match(manager, /导出当前错题本/)
  assert.doesNotMatch(read('src/components/mobile/MobileWrongNotebookView.vue'), /backupAll|restoreAll/)
  assert.match(read('src/components/QuizToolbar.vue'), /添加到新的错题本/)
  assert.match(read('src/components/mobile/MobileQuizView.vue'), /添加到新的错题本/)
  const settings = read('src/components/SettingsPage.vue')
  assert.doesNotMatch(settings, /本地数据已就绪|settings-live-dot|settings-quick-stats|selectedBankName/)
  const converter = read('src/components/AiDocumentConverter.vue')
  const converterTemplate = converter.split('<script')[0]
  assert.doesNotMatch(converterTemplate, /provider\.model|provider\.baseUrl/)
  assert.doesNotMatch(converter, /model-summary|模型尚未配置|请先完成 AI 模型配置/)
  assert.match(converter, /if\(!modelConfigured\.value\)return'请先在“AI 模型配置”中填写并保存模型连接。'/)
  const model = read('src/components/AiModelSettings.vue')
  assert.doesNotMatch(model, /提示词与结构已就绪|framework-state/)
  assert.match(model, /测试连接/)
  assert.match(read('src/components/BankManager.vue'), /isBankSessionKey\(key, localStorage.getItem\(key\), file, notebookIds\)/)
  assert.match(read('docs/SIMPLIFY_PAGE_DISPLAY.md'), /^# 简化页面显示/)
})

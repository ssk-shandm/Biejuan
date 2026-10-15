import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
test('previous/next navigation renders only in traditional presentation; exam submission stays independent', () => {
  const template = read('src/components/shared/QuizSessionView.vue')
  assert.match(template, /<nav v-if="presentation === 'single' && totalQuestions" class="quiz-page-nav"/)
  assert.match(template, /<\/nav>\s*<div v-if="appMode === 'exam'" class="list-nav">/)
})

test('presentation switch hides side labels while keeping an accessible name and stored identifiers', () => {
  const control = read('src/components/QuizPresentationSwitch.vue')
  assert.doesNotMatch(control, /<span/)
  assert.match(control, /aria-label="桌面做题呈现：滚动 \/ 传统"/)
  const settings = read('src/components/SettingsPage.vue')
  assert.match(settings, /presentation === 'single' \? '传统' : '滚动'/)
  assert.doesNotMatch(control + settings, /一题一页|连续滚动|滚动模式/)
  assert.match(control, /modelValue === 'single'/)
  assert.match(control, /\? 'single' : 'continuous'/)
})

function evaluate(source, context = {}) {
  const module = { exports: {} }
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: name => name === 'vue' ? vue : {},
    ...context,
  })
  return module.exports
}

test('desktop preference defaults safely, survives reload and reports failed writes', () => {
  const values = new Map()
  const messages = []
  const notices = []
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
  }
  function load() {
    return evaluate(read('src/composables/useQuizPresentation.ts'), {
      localStorage: storage,
      require: name => name === 'vue' ? vue : {
        showToast: message => messages.push(message),
        showGlobalToast: (...args) => notices.push(args),
      },
    }).useQuizPresentation()
  }
  const api = load()
  assert.equal(api.presentation.value, 'continuous')
  assert.equal(notices.length, 0)
  api.setPresentation('single')
  assert.deepEqual(notices, [['已切换为传统模式', 'success', 3000]])
  api.setPresentation('single')
  api.setPresentation('invalid')
  assert.equal(notices.length, 1)
  assert.equal(load().presentation.value, 'single')
  assert.equal(notices.length, 1)
  values.set('desktopQuizPresentation', 'invalid')
  assert.equal(load().presentation.value, 'continuous')
  storage.setItem = () => { throw new Error('quota') }
  api.setPresentation('continuous')
  assert.equal(api.presentation.value, 'continuous')
  assert.deepEqual(notices.at(-1), ['已切换为滚动模式', 'success', 3000])
  assert.equal(messages.length, 1)
  storage.getItem = () => { throw new Error('denied') }
  assert.equal(load().presentation.value, 'continuous')
  assert.equal(evaluate(read('src/composables/useQuizPresentation.ts')).useQuizPresentation().presentation.value, 'continuous')
})

function quiz(t) {
  const saved = new Map()
  const scrolls = []
  const scope = vue.effectScope()
  let unmount
  const hooks = { ...vue, onMounted() {}, onUnmounted: callback => { unmount = callback } }
  const store = vue.reactive({ wrongEntries: [], getWrongEntriesByBank: () => [] })
  const source = read('src/composables/useQuiz.ts').replace('// state\n', '// state\n    serializeAnswerSheet, deserializeAnswerSheet, flushSessionSave,\n')
  const { useQuiz } = evaluate(source, {
    require: name => {
      if (name === 'vue') return hooks
      if (name.endsWith('quizStore')) return { useQuizStore: () => store }
      if (name.endsWith('useToast')) return { showToast() {} }
      if (name.endsWith('learningPersistence')) return { persistLearningState: async () => {} }
      return {}
    },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    setTimeout: () => 1, clearTimeout() {},
    window: { removeEventListener() {}, scrollTo: (...args) => scrolls.push(args) },
  })
  const api = scope.run(useQuiz)
  t.after(() => { unmount(); scope.stop() })
  api.currentBankFile.value = 'fixture.json'
  api.appMode.value = 'practice'
  return { ...api, saved, scrolls }
}

const compound = { number: 2, type: '综合题', answer: '', subQuestions: [
  { id: 1, type: '填空题', answer: 'draft' },
  { id: 2, type: '单选题', answer: 'A' },
] }

test('navigation validates boundaries and preserves shared answers and results without scrolling', t => {
  const api = quiz(t)
  const question = { number: 1, type: '单选题', answer: 'A' }
  api.shuffledQuestions.value = [question, compound]
  api.handleAnswerUpdate('A', question)
  api.handleJumpTo(1)
  assert.equal(api.currentQuestionIndex.value, 1)
  assert.equal(api.answerSheet.value.get(1).isCorrect, true)
  assert.equal(api.answerSheet.value.get(1).showResult, true)
  for (const index of [-1, 2, 1.5, NaN]) api.handleJumpTo(index)
  assert.equal(api.currentQuestionIndex.value, 1)
  api.handleJumpTo(0)
  assert.equal(api.answerSheet.value.get(1).userAnswer, 'A')
  assert.equal(api.scrolls.length, 0)
})

test('restored progress outside the bank is clamped to a renderable current question', async t => {
  const api = quiz(t)
  api.questions.value = [compound]
  for (const value of [999, -3, 1.5]) {
    api.saved.set('practice_session_fixture.json', JSON.stringify({ answers: [], order: [2], currentIndex: value }))
    api.handleStartGame('practice', false)
    await vue.nextTick()
    assert.equal(api.currentQuestionIndex.value, 0)
    assert.equal(api.shuffledQuestions.value.length, 1)
  }
})

test('compound drafts survive partial submission, serialization, restore and paging', t => {
  const api = quiz(t)
  api.shuffledQuestions.value = [compound]
  api.handleSubAnswerUpdate(compound, 1, 'draft')
  api.handleSubAnswerUpdate(compound, 2, 'A')
  assert.equal(api.answerSheet.value.get(2).isCorrect, null)
  assert.equal(api.answerSheet.value.get(2).subAnswers, undefined)
  api.handleSubSubmit(compound, 2, 'A')
  api.handleSubAnswerUpdate(compound, 2, 'B')
  assert.equal(api.answerSheet.value.get(2).subAnswers.get(2).userAnswer, 'A')
  assert.equal(api.answerSheet.value.get(2).subDrafts[1], 'draft')
  api.flushSessionSave()
  const persisted = JSON.parse(api.saved.get('practice_session_fixture.json'))
  const restored = api.deserializeAnswerSheet(persisted.answers)
  assert.equal(restored.get(2).subDrafts[1], 'draft')
  assert.equal(restored.get(2).subAnswers.get(2).isCorrect, true)
  api.answerSheet.value = restored
  api.handleJumpTo(0)
  assert.equal(api.answerSheet.value.get(2).subDrafts[1], 'draft')
  api.appMode.value = 'endorse'
  api.handleSubAnswerUpdate(compound, 1, 'changed')
  assert.equal(api.answerSheet.value.get(2).subDrafts[1], 'draft')
})

test('exam submission grades compound drafts exactly once without presentation-specific rules', t => {
  const api = quiz(t)
  api.shuffledQuestions.value = [compound]
  api.appMode.value = 'exam'
  api.handleSubAnswerUpdate(compound, 1, 'draft')
  api.handleSubAnswerUpdate(compound, 2, 'A')
  api.submitExam()
  assert.equal(api.appMode.value, 'review')
  assert.equal(api.score.value, 1)
  assert.equal(api.answerSheet.value.get(2).showResult, true)
  assert.equal(api.answerSheet.value.get(2).subAnswers.size, 2)
})

test('exam and endorse restore progress; submitting an exam retires its temporary session', async t => {
  const api = quiz(t)
  const question = { number: 1, type: '单选题', answer: 'A' }
  api.questions.value = [question, compound]
  for (const mode of ['exam', 'endorse']) {
    api.saved.set(`${mode}_session_fixture.json`, JSON.stringify({ answers: [[1, { userAnswer: 'B', isCorrect: null }]], order: [1, 2], currentIndex: 1 }))
    api.handleStartGame(mode, false)
    await vue.nextTick()
    assert.equal(api.currentQuestionIndex.value, 1)
    assert.equal(api.answerSheet.value.get(1).userAnswer, 'B')
  }
  api.handleStartGame('exam', false)
  api.submitExam()
  assert.equal(api.saved.has('exam_session_fixture.json'), false)
  const score = api.score.value
  api.submitExam()
  assert.equal(api.score.value, score)
})

test('answers persist before debounce and multi-choice grading never mutates the selected array', t => {
  const api = quiz(t)
  const question = { number: 1, type: '多选题', answer: 'AB' }
  api.shuffledQuestions.value = [question]
  const selected = ['B', 'A']
  api.handleAnswerUpdate(selected, question)
  assert.deepEqual(selected, ['B', 'A'])
  assert.equal(api.answerSheet.value.get(1).isCorrect, true)
  assert.equal(JSON.parse(api.saved.get('practice_session_fixture.json')).answers.length, 1)
})

test('all scalar question types retain their grading contract and repeated submissions do not duplicate answers', t => {
  const api = quiz(t)
  const fixtures = [
    ['单选题', 'A', 'A', true], ['多选题', 'AB', ['B', 'A'], true],
    ['判断题', 'A', 'B', false], ['填空题', 'Answer', ' answer ', true],
    ['简答题', 'reference', 'own explanation', null], ['程序分析题', '42', '42', true], ['编程题', 'return 1;', 'return 1;', true],
  ]
  fixtures.forEach(([type, answer, user, expected], index) => {
    const question = { number: index + 1, type, answer }
    api.shuffledQuestions.value.push(question)
    api.handleAnswerUpdate(user, question)
    api.handleSubmit(question)
    api.handleSubmit(question)
    assert.equal(api.answerSheet.value.get(index + 1).isCorrect, expected, type)
  })
  assert.equal(api.answerSheet.value.size, fixtures.length)
})

test('specialized practice resumes only its selected types and saved answers', async t => {
  const api = quiz(t)
  const question = { number: 1, type: '单选题', answer: 'A' }
  api.questions.value = [question, compound]
  api.specializeTypes.value = ['单选题']
  api.saved.set('specialize_session_fixture.json_单选题', JSON.stringify({ answers: [[1, { userAnswer: 'A', isCorrect: true }]], order: [1], currentIndex: 0 }))
  api.handleStartGame('specialize', false)
  await vue.nextTick()
  assert.equal(api.shuffledQuestions.value.length, 1)
  assert.equal(api.shuffledQuestions.value[0].number, 1)
  assert.equal(api.answerSheet.value.get(1).isCorrect, true)
})

test('compound renderer hydrates drafts and submitted answers, including after remount', () => {
  const source = read('src/components/CompoundQuestion.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const props = vue.reactive({ question: compound, disabled: false, subDrafts: { 1: 'draft' }, subResults: new Map([[2, { userAnswer: 'A', isCorrect: true }]]) })
  const events = []
  function mount() {
    return evaluate(source + '\nmodule.exports = { userAnswers, handleInput, isSubLocked }', {
      defineProps: () => props, withDefaults: value => value,
      defineEmits: () => (...args) => events.push(args),
    })
  }
  const api = mount()
  assert.equal(api.userAnswers.value.get(1), 'draft')
  assert.equal(api.userAnswers.value.get(2), 'A')
  assert.equal(api.isSubLocked(1), false)
  assert.equal(api.isSubLocked(2), true)
  api.handleInput(1, 'changed')
  assert.deepEqual(events[0], ['answer-update', 1, 'changed'])
  props.subDrafts = { 1: 'changed' }
  assert.equal(mount().userAnswers.value.get(1), 'changed')
  props.subDrafts = undefined
  props.subResults = undefined
  assert.equal(api.userAnswers.value.get(1), '')
})

function answerCard(defaultExpanded, defaultPinned = false) {
  const source = read('src/components/AnswerCard.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const events = []
  const props = vue.reactive({ questions: [], answerSheet: new Map(), currentIndex: 0, defaultExpanded, defaultPinned })
  const api = evaluate(source + '\nmodule.exports = { isExpanded, isPinned, togglePin, toggleExpand, handleMouseEnter, handleMouseLeave }', {
    defineProps: () => props, withDefaults: value => value,
    defineEmits: () => (...args) => events.push(args),
    require: name => name === 'vue' ? vue : { useQuizStore: () => ({}) },
  })
  return { ...api, props, events }
}

test('traditional answer card stays visible and pinned; scroll card keeps its drawer behavior', () => {
  const card = answerCard(true)
  card.props.alwaysVisible = true
  assert.equal(card.isExpanded.value, true)
  assert.equal(card.isPinned.value, false)
  card.handleMouseLeave()
  card.toggleExpand()
  card.togglePin()
  assert.equal(card.isExpanded.value, true)
  assert.equal(card.isPinned.value, false)
  const scrollCard = answerCard(false)
  scrollCard.handleMouseEnter()
  assert.equal(scrollCard.isExpanded.value, true)
  scrollCard.handleMouseLeave()
  assert.equal(scrollCard.isExpanded.value, false)
  scrollCard.toggleExpand()
  scrollCard.togglePin()
})

test('presentation switches reset only the card drawer and leave review defaults unchanged', () => {
  const template = read('src/components/shared/QuizSessionView.vue')
  const cardMarkup = template.match(/<AnswerCard[\s\S]*?\/>/)[0]
  assert.match(cardMarkup, /:key="presentation"/)
  assert.match(cardMarkup, /:default-expanded="true"/)
  assert.match(cardMarkup, /:default-pinned="presentation === 'single'"/)
  assert.match(cardMarkup, /:always-visible="presentation === 'single'"/)
  assert.doesNotMatch(template, /QuizPresentationSwitch/)
  assert.doesNotMatch(template, /setPresentation/)
  assert.match(template, /:answer-sheet="answerSheet"/)
  const continuous = answerCard(true)
  continuous.togglePin()
  const single = answerCard(false)
  assert.equal(single.isExpanded.value, false)
  assert.equal(single.isPinned.value, false)
  assert.equal(answerCard(true).isExpanded.value, true)
  const review = answerCard(true, true)
  review.handleMouseLeave()
  assert.equal(review.isExpanded.value, true)
  assert.equal(review.isPinned.value, true)
  const reviewMarkup = read('src/components/ExamReview.vue').match(/<AnswerCard[\s\S]*?\/>/)[0]
  assert.match(reviewMarkup, /:default-expanded="true"/)
  assert.match(reviewMarkup, /:default-pinned="true"/)
})

test('traditional question layout uses one divider before the navigation bar', () => {
  const template = read('src/components/shared/QuizSessionView.vue')
  assert.match(template, /\.quiz-layout\[data-presentation="single"\] \.question-list-item \{[^}]*border-bottom:0/)
  assert.match(template, /const windowStart = computed\(\(\) => presentation\.value === 'single' \? props\.currentQuestionIndex : 0\)/)
})

test('answer results separate the reference answer from the explanation', () => {
  const template = read('src/components/ResultDisplay.vue')
  assert.match(template, /class="result-section answer-block"/)
  assert.match(template, /class="result-section-title"\u003e\{\{ isShortAnswer \? '参考回答' : '参考答案' \}\}/)
  assert.match(template, /id="explanation-text"[^>]*class="result-section"/)
  assert.match(template, /class="result-section-title"\u003e解析\u003c\/div\u003e/)
})

test('viewport keeps the reading question and offset across switching and cancels stale alignment', async t => {
  const scope = vue.effectScope()
  const frames = new Map()
  const listeners = new Map()
  const tops = [96, 700, 1300]
  const indices = vue.ref([{ number: 1 }, { number: 2 }, { number: 3 }])
  const index = vue.ref(0)
  const presentation = vue.ref('continuous')
  let renderedMode = 'continuous'
  const scrolls = []
  let mounted, unmounted, frameId = 0
  const elements = tops.map((_, i) => ({ dataset: { questionIndex: String(i) }, getBoundingClientRect: () => ({ top: tops[i], height: 600 }) }))
  const root = vue.ref({
    querySelector: selector => selector === '.quiz-session-header' ? { offsetHeight: 80 } : elements[Number(selector.match(/"(\d+)"/)[1])],
    querySelectorAll: () => renderedMode === 'single' ? [elements[index.value]] : elements,
  })
  const { useDesktopQuizViewport } = evaluate(read('src/composables/useDesktopQuizViewport.ts'), {
    require: () => ({ ...vue, onMounted: callback => { mounted = callback }, onBeforeUnmount: callback => { unmounted = callback } }),
    window: {
      innerHeight: 900,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: type => listeners.delete(type),
      scrollBy: value => scrolls.push(value),
    },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: id => frames.delete(id),
  })
  const api = scope.run(() => useDesktopQuizViewport({ root, presentation, questions: indices, currentIndex: index, select: value => { index.value = value } }))
  t.after(() => { unmounted(); scope.stop() })
  async function settle() {
    for (let pass = 0; pass < 4; pass++) {
      await vue.nextTick()
      await new Promise(resolve => setImmediate(resolve))
      renderedMode = presentation.value
      for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
    }
  }
  mounted()
  await settle()
  tops[0] = -600
  tops[1] = -20
  tops[2] = 580
  listeners.get('scroll')()
  await settle()
  presentation.value = 'single'
  await settle()
  assert.equal(index.value, 1)
  assert.equal(scrolls.at(-1).top, 0)
  assert.equal(scrolls.at(-1).behavior, 'instant')
  presentation.value = 'continuous'
  await settle()
  assert.equal(index.value, 1)
  assert.equal(scrolls.at(-1).top, 0)
  const count = scrolls.length
  api.jump(-1)
  api.jump(3)
  await settle()
  assert.equal(scrolls.length, count)
  api.jump(0)
  api.jump(2)
  await settle()
  assert.equal(index.value, 2)
  assert.equal(scrolls.length, count + 2)
  tops[0] = -1100
  tops[1] = -600
  tops[2] = 96
  presentation.value = 'single'
  presentation.value = 'continuous'
  presentation.value = 'single'
  await settle()
  assert.equal(index.value, 2)
  const beforeScroll = scrolls.length
  listeners.get('scroll')()
  await settle()
  assert.equal(scrolls.length, beforeScroll)
  api.jump(1)
  unmounted()
  await settle()
  assert.equal(scrolls.length, beforeScroll)
  assert.equal(listeners.size, 0)
  assert.equal(frames.size, 0)
})

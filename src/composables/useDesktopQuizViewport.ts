import { nextTick, onMounted, onBeforeUnmount, watch, type Ref } from 'vue'
import type { Question } from '../types'
import type { QuizPresentation } from './useQuizPresentation'

type ViewportOptions = {
  root: Ref<HTMLElement | null>
  presentation: Readonly<Ref<QuizPresentation>>
  questions: Readonly<Ref<Question[]>>
  currentIndex: Readonly<Ref<number>>
  select: (index: number) => void
}

export function useDesktopQuizViewport(options: ViewportOptions) {
  const { root, presentation, questions, currentIndex, select } = options
  const positions = new Map<string, number>()
  let paused = false
  let disposed = false
  let revision = 0
  let frame: number | null = null
  let trackedIndex: number | null = null

  function questionTop() {
    const header = root.value?.querySelector<HTMLElement>('.quiz-session-header')
    return Math.max(96, (header?.offsetHeight ?? 80) + 16)
  }

  function currentElement(index = currentIndex.value) {
    return root.value?.querySelector<HTMLElement>(`[data-question-index="${index}"]`)
  }

  function positionKey(mode: QuizPresentation, index = currentIndex.value) {
    const question = questions.value[index]
    return `${mode}:${question?.number}:${index}`
  }

  function remember(mode: QuizPresentation, index = currentIndex.value) {
    const element = currentElement(index)
    if (element) positions.set(positionKey(mode, index), element.getBoundingClientRect().top)
  }

  function pause() {
    paused = true
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    return ++revision
  }

  async function align(top: number, token: number) {
    await nextTick()
    if (disposed || token !== revision) return
    function adjust() {
      const element = currentElement()
      if (!element) return
      // Clamp the reading offset so a shorter renderer cannot reveal the next question.
      const rect = element.getBoundingClientRect()
      const target = Math.max(top, questionTop() - Math.max(0, rect.height - 100))
      window.scrollBy({ top: rect.top - target, behavior: 'instant' })
    }
    adjust()
    frame = requestAnimationFrame(() => {
      if (token !== revision || disposed) return
      // Browser scroll anchoring and image layout can settle after Vue's DOM update.
      adjust()
      frame = requestAnimationFrame(() => {
        frame = null
        if (token === revision) paused = false
      })
    })
  }

  function findReadingIndex() {
    const elements = root.value?.querySelectorAll<HTMLElement>('[data-question-index]')
    if (!elements?.length) return currentIndex.value
    const line = Math.max(questionTop(), window.innerHeight * .2)
    let index = Number(elements[0]!.dataset.questionIndex)
    for (const element of elements) {
      if (element.getBoundingClientRect().top > line) break
      index = Number(element.dataset.questionIndex)
    }
    return index
  }

  function trackReading() {
    const index = findReadingIndex()
    if (index === currentIndex.value) return
    const anchor = root.value?.querySelector<HTMLElement>(`[data-question-index="${index}"]`)
    if (!anchor) return
    const top = anchor.getBoundingClientRect().top
    const token = pause()
    trackedIndex = index
    select(index)
    // Moving the rendering window changes heights above the viewport; keep its anchor steady.
    void align(top, token)
  }

  function onScroll() {
    if (paused || presentation.value !== 'continuous' || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!paused && presentation.value === 'continuous') trackReading()
    })
  }

  function jump(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= questions.value.length) return
    remember(presentation.value)
    const token = pause()
    select(index)
    void align(questionTop(), token)
  }

  watch(presentation, (mode, previous) => {
    // The synchronous watcher captures the old DOM before the presentation changes.
    // Keep the tracked session question: resizing the drawer is not reading navigation.
    const index = currentIndex.value
    remember(previous, index)
    const oldTop = currentElement(index)?.getBoundingClientRect().top ?? questionTop()
    const token = pause()
    if (index !== currentIndex.value) {
      trackedIndex = index
      select(index)
    }
    void align(positions.get(positionKey(mode, index)) ?? oldTop, token)
  }, { flush: 'sync' })

  watch([questions, currentIndex], ([list, index], [oldList]) => {
    if (list !== oldList) positions.clear()
    if (index === trackedIndex && list === oldList) {
      trackedIndex = null
      return
    }
    trackedIndex = null
    if (!paused) void align(questionTop(), pause())
  }, { flush: 'post' })

  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    void align(questionTop(), pause())
  })
  onBeforeUnmount(() => {
    disposed = true
    revision++
    window.removeEventListener('scroll', onScroll)
    if (frame !== null) cancelAnimationFrame(frame)
  })

  return { jump }
}

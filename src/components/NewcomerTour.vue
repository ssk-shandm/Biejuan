<template>
  <Teleport to="body">
    <div v-if="active && steps.length" ref="rootRef" class="tour-root">
      <svg v-if="highlight" class="tour-mask" aria-hidden="true" :viewBox="`0 0 ${viewport.width} ${viewport.height}`" :style="{ opacity: scene?.spotlightOpacity }">
        <path :d="maskPath" fill-rule="evenodd" />
        <rect class="tour-highlight" :x="highlight.left" :y="highlight.top" :width="highlight.width" :height="highlight.height" rx="10" />
      </svg>
      <section
        ref="labelRef" class="tour-label" :class="{ 'tour-label-mobile': isNarrow }" :style="labelStyle"
        role="dialog" aria-modal="true" :aria-labelledby="`tour-title-${current.key}`" :aria-describedby="`tour-desc-${current.key}`" tabindex="-1"
      >
        <div class="tour-card-content" :style="contentStyle">
          <TourCard :step="current" :index="currentIndex" :total="steps.length" :preparing="preparing" @finish="finish" @next="next" @prev="prev" />
        </div>
      </section>
      <div ref="measureRef" class="tour-label tour-measure" :style="{ width: `${measurementWidth}px` }" aria-hidden="true" inert>
        <div class="tour-card-content" :style="{ width: `${measurementWidth - 2}px`, maxHeight: `${maxCardHeight - 2}px` }">
          <TourCard :step="measurementStep" :index="measurementIndex" :total="steps.length" :preparing="true" measurement />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TourStep } from '../types'
import TourCard from './TourCard.vue'
import { getTourHighlight, getTourLabelPosition, getTourMaskPath, type TourBox } from '../utils/tourGeometry'
import { getTourContentOpacity, getTourMotionFrame, type TourScene } from '../utils/tourMotion'

const props = defineProps<{ active: boolean; steps: TourStep[]; layout?: 'desktop' | 'mobile' }>()
const emit = defineEmits<{ (event: 'finish'): void }>()
const currentIndex = ref(0)
const measurementIndex = ref(0)
const measurementWidth = ref(336)
const contentWidth = ref(336)
const contentOpacity = ref(1)
const rootRef = ref<HTMLElement | null>(null)
const labelRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const scene = ref<TourScene | null>(null)
const preparing = ref(false)
let syncVersion = 0
let previousOverflow: string | undefined
let previousFocus: HTMLElement | null = null
let resizeObserver: ResizeObserver | undefined
let motionFrame = 0
let layoutFrame = 0
let cancelMotion: (() => void) | undefined

const steps = computed(() => props.steps.filter(step => !step.onlyOn || !props.layout || step.onlyOn === props.layout))
const current = computed<TourStep>(() => steps.value[currentIndex.value] ?? { key: 'empty', title: '', description: '' })
const measurementStep = computed(() => steps.value[measurementIndex.value] ?? current.value)
const isLast = computed(() => currentIndex.value >= steps.value.length - 1)
const isNarrow = computed(() => viewport.value.width < 640)
const maxCardHeight = computed(() => isNarrow.value ? Math.floor(viewport.value.height * .5) : viewport.value.height - 32)
const highlight = computed(() => scene.value?.highlight ?? null)
const maskPath = computed(() => highlight.value ? getTourMaskPath(highlight.value, viewport.value) : '')
const labelStyle = computed(() => scene.value ? {
  top: `${scene.value.label.top}px`, left: `${scene.value.label.left}px`,
  width: `${scene.value.label.width}px`, height: `${scene.value.label.height}px`,
} : { visibility: 'hidden' as const })
const contentStyle = computed(() => ({
  width: `${contentWidth.value - 2}px`, maxHeight: `${maxCardHeight.value - 2}px`, opacity: contentOpacity.value,
}))

function findTarget(step = current.value) {
  if (!step.target) return undefined
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`))
    .find(element => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
        && !element.closest('.page-fade-leave-active, .mobile-screen-leave-active')
    })
}

function hasPageMotion(element: HTMLElement) {
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.getAnimations().some(animation => animation.playState === 'running'
      && animation.effect?.getComputedTiming().iterations !== Infinity)) return true
  }
  return false
}

async function waitForTarget(step: TourStep, version: number) {
  let previous: DOMRect | undefined
  let stableFrames = 0
  let scrolled: HTMLElement | undefined
  const deadline = performance.now() + 1800
  while (performance.now() < deadline) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (!props.active || version !== syncVersion) return undefined
    if (!step.target) return undefined
    const target = findTarget(step)
    if (!target) continue
    if (target !== scrolled) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      scrolled = target
    }
    const box = target.getBoundingClientRect()
    const stable = previous && ['left', 'top', 'width', 'height'].every(key =>
      Math.abs(box[key as keyof TourBox] - previous![key as keyof TourBox]) < .25)
    stableFrames = stable && !hasPageMotion(target) ? stableFrames + 1 : 0
    previous = box
    if (stableFrames >= 3) return target
  }
  return findTarget(step)
}

async function measureDestination(index: number, target: HTMLElement | undefined): Promise<TourScene> {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  const box = target ? getTourHighlight(target.getBoundingClientRect(), viewport.value) : null
  const sideSpace = box ? Math.max(box.left - 34, viewport.value.width - box.left - box.width - 34) : 336
  measurementWidth.value = isNarrow.value ? viewport.value.width - 32
    : Math.min(viewport.value.width - 32, sideSpace >= 260 ? Math.min(336, Math.floor(sideSpace)) : 336)
  measurementIndex.value = index
  await nextTick()
  const width = measurementWidth.value
  const height = measureRef.value?.getBoundingClientRect().height ?? 240
  const position = getTourLabelPosition(box, { width, height }, viewport.value)
  if (isNarrow.value) {
    position.left = 16
    position.top = viewport.value.height - height - Number.parseFloat(getComputedStyle(rootRef.value!).paddingBottom)
  }
  return { label: { ...position, width, height }, highlight: box, spotlightOpacity: box ? 1 : 0 }
}

function animateTo(destination: TourScene, index: number, version: number) {
  cancelMotion?.()
  const from = scene.value
  const commitContent = () => {
    currentIndex.value = index
    contentWidth.value = destination.label.width
  }
  if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commitContent()
    scene.value = destination
    contentOpacity.value = 1
    return Promise.resolve()
  }
  return new Promise<void>(resolve => {
    let started: number | undefined
    let committed = false
    const complete = () => { cancelMotion = undefined; resolve() }
    cancelMotion = () => { cancelAnimationFrame(motionFrame); complete() }
    const frame = (now: number) => {
      if (!props.active || version !== syncVersion) { complete(); return }
      started ??= now
      const progress = Math.min(1, (now - started) / 360)
      if (progress >= .2 && !committed) { commitContent(); committed = true }
      scene.value = getTourMotionFrame(from, destination, progress)
      contentOpacity.value = getTourContentOpacity(progress)
      if (progress < 1) motionFrame = requestAnimationFrame(frame)
      else complete()
    }
    motionFrame = requestAnimationFrame(frame)
  })
}

async function syncStep(index = currentIndex.value) {
  const version = ++syncVersion
  cancelMotion?.()
  preparing.value = true
  resizeObserver?.disconnect()
  const step = steps.value[index]
  if (!step) { preparing.value = false; return }
  try {
    await step.prepare?.()
    await nextTick()
    const target = await waitForTarget(step, version)
    if (!props.active || version !== syncVersion) return
    // Measure the next card offscreen at its final width before moving anything.
    const destination = await measureDestination(index, target)
    if (!props.active || version !== syncVersion) return
    labelRef.value?.focus({ preventScroll: true })
    await animateTo(destination, index, version)
    if (!props.active || version !== syncVersion) return
    if (target) resizeObserver?.observe(target)
  } finally {
    if (version === syncVersion) preparing.value = false
  }
}

function next() {
  if (preparing.value) return
  if (isLast.value) finish()
  else void syncStep(currentIndex.value + 1)
}
function prev() {
  if (!preparing.value && currentIndex.value > 0) void syncStep(currentIndex.value - 1)
}
function finish() { emit('finish') }

function onLayoutChange() {
  if (!props.active || preparing.value || layoutFrame) return
  layoutFrame = requestAnimationFrame(async () => {
    layoutFrame = 0
    if (!props.active || preparing.value) return
    const version = syncVersion
    const destination = await measureDestination(currentIndex.value, findTarget())
    if (!props.active || preparing.value || version !== syncVersion) return
    scene.value = destination
    contentWidth.value = destination.label.width
  })
}

function releasePage() {
  syncVersion += 1
  cancelMotion?.()
  cancelAnimationFrame(layoutFrame)
  layoutFrame = 0
  resizeObserver?.disconnect()
  if (previousOverflow !== undefined) {
    document.body.style.overflow = previousOverflow
    previousOverflow = undefined
  }
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
  scene.value = null
  contentOpacity.value = 1
}

watch(() => props.active, async active => {
  if (!active) { releasePage(); return }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  currentIndex.value = 0
  await syncStep()
}, { immediate: true })
watch(() => props.layout, () => {
  if (!props.active) return
  void syncStep(Math.min(currentIndex.value, Math.max(0, steps.value.length - 1)))
})

function onKeydown(event: KeyboardEvent) {
  if (!props.active) return
  if (event.key === 'Escape') { event.preventDefault(); finish() }
  if (event.key === 'ArrowRight') { event.preventDefault(); next() }
  if (event.key === 'ArrowLeft') { event.preventDefault(); prev() }
  if (event.key !== 'Tab' || !labelRef.value) return
  const buttons = Array.from(labelRef.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus() }
  else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) {
    event.preventDefault()
    buttons[0]?.focus()
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(onLayoutChange)
  window.addEventListener('resize', onLayoutChange)
  window.addEventListener('scroll', onLayoutChange, true)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onLayoutChange)
  window.removeEventListener('scroll', onLayoutChange, true)
  window.removeEventListener('keydown', onKeydown)
  releasePage()
})
</script>

<style scoped>
.tour-root { position: fixed; inset: 0; z-index: 9000; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
.tour-mask { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tour-mask path { fill: rgba(0, 0, 0, .24); }
.tour-highlight { fill: none; stroke: var(--color-accent); stroke-width: 1; }
.tour-label { position: fixed; box-sizing: border-box; overflow: hidden; border: 1px solid var(--color-border-container); border-radius: 12px; background: var(--color-bg-container); color: var(--color-text-primary); box-shadow: 0 8px 32px rgba(0, 0, 0, .12); font-family: inherit; outline: none; }
.tour-card-content { box-sizing: border-box; overflow-y: auto; }
.tour-measure { left: -10000px; top: 0; height: auto; visibility: hidden; pointer-events: none; box-shadow: none; }
</style>

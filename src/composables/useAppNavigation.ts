import { computed, ref, type Ref } from 'vue'
import type { AppMode } from '../types'

export type AppScreen = 'home' | 'quiz' | 'review' | 'wrong-notebook' | 'converter' | 'terminal' | 'settings' | 'about'

/** A presentation-level mapping; useQuiz owns the actual session and browser history. */
export function useAppNavigation(
  mode: Ref<AppMode>,
  start: (mode: AppMode) => void,
  backHome: () => void,
) {
  const overrideScreen = ref<AppScreen | null>(null)

  const screen = computed<AppScreen>(() => {
    if (overrideScreen.value) return overrideScreen.value
    if (mode.value === 'start') return 'home'
    if (mode.value === 'wrong-manage') return 'wrong-notebook'
    if (mode.value === 'review') return 'review'
    if (mode.value === 'settings' || mode.value === 'about') return mode.value
    return 'quiz'
  })
  return {
    screen,
    goHome: () => {
      overrideScreen.value = null
      backHome()
    },
    goBack: () => {
      if (overrideScreen.value) {
        overrideScreen.value = null
        return
      }
      backHome()
    },
    openSettings: () => {
      overrideScreen.value = null
      start('settings')
    },
    openConverter: () => { overrideScreen.value = 'converter' },
    openTerminal: () => { overrideScreen.value = 'terminal' },
    openWrongNotebook: () => {
      overrideScreen.value = null
      start('wrong-manage')
    },
  }
}

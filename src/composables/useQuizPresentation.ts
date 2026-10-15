import { readonly, ref } from 'vue'
import { showGlobalToast, showToast } from './useToast'

export type QuizPresentation = 'continuous' | 'single'
const STORAGE_KEY = 'desktopQuizPresentation'

function readPreference(): QuizPresentation {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'single' ? 'single' : 'continuous'
  } catch {
    return 'continuous'
  }
}

const presentation = ref<QuizPresentation>(readPreference())

export function useQuizPresentation() {
  function setPresentation(value: QuizPresentation) {
    if (value !== 'continuous' && value !== 'single') return
    if (value === presentation.value) return
    presentation.value = value
    showGlobalToast(`已切换为${value === 'single' ? '传统' : '滚动'}模式`, 'success', 3000)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      showToast('呈现方式已切换，但偏好保存失败；重启后可能恢复默认。')
    }
  }

  return { presentation: readonly(presentation), setPresentation }
}

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { usePlatform } from './usePlatform'

export type LayoutMode = 'desktop' | 'mobile'

// Width is only a hint on the web: Tauri Windows always retains its desktop UI.
export function useLayoutMode() {
  const { platform } = usePlatform()
  const width = ref(typeof window === 'undefined' ? 1024 : window.innerWidth)
  const updateWidth = () => { width.value = window.innerWidth }
  onMounted(() => window.addEventListener('resize', updateWidth))
  onUnmounted(() => window.removeEventListener('resize', updateWidth))

  const layoutMode = computed<LayoutMode>(() => {
    if (platform.value === 'android') return 'mobile'
    if (platform.value !== 'web') return 'desktop'
    return width.value < 768 ? 'mobile' : 'desktop'
  })
  return { layoutMode }
}

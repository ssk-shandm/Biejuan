import { onMounted, onUnmounted, type Ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { usePlatform } from './usePlatform'

/**
 * Handle both WebView-style `backbutton` events and Tauri's close-request
 * event. Android vendors expose the hardware/system back action differently;
 * listening to both keeps the page-level priority rules in one place.
 */
export function useAndroidBackButton(handler: () => void, enabled: Ref<boolean> | (() => boolean) = () => true) {
  const { isAndroid } = usePlatform()
  const isEnabled = () => typeof enabled === 'function' ? enabled() : enabled.value
  const shouldHandle = () => isAndroid.value && isEnabled()
  const onBackButton = (event: Event) => {
    if (!shouldHandle()) return
    event.preventDefault()
    handler()
  }

  let removeTauriListener: (() => void) | null = null
  let disposed = false

  onMounted(() => {
    window.addEventListener('backbutton', onBackButton)
    if (!isAndroid.value || !isTauri()) return

    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested((event) => {
        if (!shouldHandle()) return
        event.preventDefault()
        handler()
      }))
      .then((unlisten) => {
        if (disposed) {
          unlisten()
        } else {
          removeTauriListener = unlisten
        }
      })
      .catch((error) => console.warn('[android-back] Tauri 返回键监听初始化失败', error))
  })

  onUnmounted(() => {
    disposed = true
    window.removeEventListener('backbutton', onBackButton)
    removeTauriListener?.()
    removeTauriListener = null
  })
}
import { computed, shallowRef } from 'vue'
import { isTauri } from '@tauri-apps/api/core'

export type RuntimePlatform = 'web' | 'windows' | 'android' | 'macos' | 'linux'

function detectPlatform(): RuntimePlatform {
  // Android's WebView advertises Android in its user agent even inside Tauri.
  const agent = navigator.userAgent.toLowerCase()
  if (agent.includes('android')) return 'android'
  if (!isTauri()) return 'web'
  if (agent.includes('windows')) return 'windows'
  if (agent.includes('macintosh') || agent.includes('mac os')) return 'macos'
  if (agent.includes('linux')) return 'linux'
  return 'web'
}

// Shared across shells; never register per-component platform listeners.
const platform = shallowRef<RuntimePlatform>(typeof navigator === 'undefined' ? 'web' : detectPlatform())

export function usePlatform() {
  return {
    platform: computed(() => platform.value),
    isAndroid: computed(() => platform.value === 'android'),
    isDesktopTauri: computed(() => platform.value !== 'android' && platform.value !== 'web'),
  }
}

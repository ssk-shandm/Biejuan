import { ref } from 'vue'

const AUTO_CHECK_UPDATES_KEY = 'autoCheckUpdates'
const DEFAULT_AUTO_CHECK_UPDATES = true

function readBooleanPreference(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

const autoCheckUpdates = ref(readBooleanPreference(AUTO_CHECK_UPDATES_KEY, DEFAULT_AUTO_CHECK_UPDATES))

function setAutoCheckUpdates(value: boolean) {
  autoCheckUpdates.value = value
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(AUTO_CHECK_UPDATES_KEY, String(value))
  }
}

export function useUpdatePreferences() {
  return {
    autoCheckUpdates,
    setAutoCheckUpdates,
  }
}

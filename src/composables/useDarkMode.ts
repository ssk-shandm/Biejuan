import { ref, watch } from 'vue'

const isDarkMode = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem('darkMode') === 'true',
)

watch(
  isDarkMode,
  (value) => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('dark-mode', value)
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('darkMode', String(value))
    }
  },
  { immediate: true },
)

function toggleDarkMode() {
  isDarkMode.value = !isDarkMode.value
}

export function useDarkMode() {
  return { isDarkMode, toggleDarkMode }
}

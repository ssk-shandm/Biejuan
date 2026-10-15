import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'highlight.js/styles/atom-one-dark.css'
import 'katex/dist/katex.min.css'
import { initializeLearningPersistence, persistLearningState, persistenceError } from './services/learningPersistence'
import './styles/tokens.css'
import './styles/mobile.css'

async function boot() {
  await initializeLearningPersistence()
  const { default: AppShell } = await import('./layouts/AppShell.vue')
  const { useQuizStore } = await import('./stores/quizStore')
  const pinia = createPinia()
  await useQuizStore(pinia).persistedDataReady
  const app = createApp(AppShell)
  app.use(pinia)
  app.mount('#app')
  const { showGlobalToast } = await import('./composables/useToast')
  if (persistenceError) showGlobalToast(persistenceError, 'error', 0)
  window.addEventListener('learning-save-error', event => showGlobalToast((event as CustomEvent<string>).detail, 'error', 0))
  const flush = () => { void persistLearningState().catch(() => {}) }
  flush()
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  window.setInterval(flush, 5000)
}
void boot().catch(error => {
  const root = document.querySelector('#app')!
  root.textContent = `数据保护：启动未完成，未继续写入。请保留应用数据并重试。${String(error)}`
})

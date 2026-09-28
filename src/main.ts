import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'highlight.js/styles/atom-one-dark.css'
import AppShell from './layouts/AppShell.vue'
import './styles/tokens.css'
import './styles/mobile.css'

const app = createApp(AppShell)
app.use(createPinia())
app.mount('#app')
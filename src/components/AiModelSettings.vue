<template>
  <section class='model-settings'>
    <div class='settings-card intro-card'>
      <div>
        <span class='section-label'>模型连接</span>
        <h3>AI 模型设置</h3>
        <p>连接参数保存在当前会话中，运行配置通过外部文本文件管理。</p>
      </div>
      <span class='framework-state' :class='frameworkStatus'>
        <span class='state-dot' aria-hidden='true'></span>
        {{ frameworkStatusText }}
      </span>
    </div>

    <div class='settings-card'>
      <div class='card-heading'>
        <div>
          <span class='section-label'>OpenAI 兼容</span>
          <h3>连接参数</h3>
          <p>支持 <code>/chat/completions</code> 接口的模型服务均可使用。</p>
        </div>
      </div>
      <div class='form-grid'>
        <label class='field wide-field'>
          <span>API 基础地址</span>
          <input v-model.trim='provider.baseUrl' type='url' placeholder='https://api.example.com/v1' />
          <small>接口地址：{{ endpointPreview }}</small>
        </label>
        <div class='field'>
          <label for='provider-model'>模型</label>
          <div class='model-field'>
            <div ref='dropdownRef' class='model-input-wrap'>
              <input
                id='provider-model'
                v-model.trim='provider.model'
                type='text'
                placeholder='your-model-name'
                @focus='openDropdown'
                @click='openDropdown'
              />
              <Transition name='model-dropdown'>
                <ul v-if='isDropdownOpen && availableModels.length' class='dropdown-list' role='listbox'>
                  <li
                    v-for='id in availableModels'
                    :key='id'
                    role='option'
                    :aria-selected='id === provider.model'
                    :class='{ active: id === provider.model }'
                    @click='selectModel(id)'
                  >{{ id }}</li>
                </ul>
              </Transition>
            </div>
            <button type='button' class='fetch-btn' :disabled='isFetchingModels' @click='fetchModels'>{{ isFetchingModels ? '获取中…' : '获取列表' }}</button>
          </div>
          <small v-if='availableModels.length'>已获取 {{ availableModels.length }} 个模型，点击输入框可选择。</small>
        </div>
        <label class='field'>
          <span>API 密钥</span>
          <div class='secret-input'>
            <input v-model='provider.apiKey' class='secret-native-input' :type='apiKeyInputType' placeholder='仅在当前会话中保存' autocomplete='new-password' />
            <button type='button' class='eye-btn' :aria-label="showApiKey ? '隐藏密钥' : '显示密钥'" @click='showApiKey = !showApiKey'>
              <svg v-if='showApiKey' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
                <path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' />
                <circle cx='12' cy='12' r='3' />
              </svg>
              <svg v-else viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
                <path d='M2 12c3.5-4.5 7-6.5 10-6.5s6.5 2 10 6.5' />
                <path d='M3 3l18 18' />
              </svg>
            </button>
          </div>
          <small>密钥仅保存在当前会话中，不会写入配置文件。</small>
        </label>
      </div>
      <div class='actions'>
        <button class='primary-btn' type='button' :disabled='isSaving' @click='saveSettings'>{{ isSaving ? '保存中…' : '保存连接' }}</button>
        <button class='secondary-btn' type='button' :disabled='isTesting' @click='testConnection'>{{ isTesting ? '测试中…' : '测试连接' }}</button>
        <button v-if='provider.apiKey' class='text-btn danger' type='button' @click='removeApiKey'>清除密钥</button>
        <button v-if='isDesktopConfig' class='primary-btn' type='button' :disabled='isOpeningConfig' @click='openConfigFile'>{{ isOpeningConfig ? '打开中…' : '打开配置文件' }}</button>
        <button class='secondary-btn' type='button' :disabled='isConfigLoading' @click='reloadConfig'>{{ isConfigLoading ? '读取中…' : '重新读取配置文件' }}</button>
      </div>
      <p v-if='message' class='status' :class='messageType'>{{ message }}</p>
    </div>
  </section>
</template>

<script setup lang='ts'>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildChatCompletionsEndpoint, fetchAvailableModels, useLlmSettings } from '../composables/useLlmSettings'

const {
  provider,
  configBackend,
  isConfigLoading,
  loadLlmProviderSettings,
  saveLlmProviderSettings,
  openLlmConfigFile,
  clearLlmApiKey,
} = useLlmSettings()

const showApiKey = ref(false)
const isTesting = ref(false)
const isSaving = ref(false)
const isOpeningConfig = ref(false)
const isFetchingModels = ref(false)
const availableModels = ref<string[]>([])
const isDropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const frameworkStatus = ref<'loading' | 'ready' | 'error'>('loading')
const frameworkError = ref('')

const apiKeyInputType = computed(() => showApiKey.value ? 'text' : 'password')
const endpointPreview = computed(() => provider.baseUrl.trim() ? buildChatCompletionsEndpoint(provider.baseUrl) : '请输入 API 基础地址')
const isDesktopConfig = computed(() => configBackend.value === 'tauri')
const frameworkStatusText = computed(() => frameworkStatus.value === 'ready' ? '提示词与结构已就绪' : frameworkStatus.value === 'error' ? frameworkError.value || '框架加载失败' : '正在加载框架')

function handleOutsideClick(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) isDropdownOpen.value = false
}

onMounted(async () => {
  document.addEventListener('click', handleOutsideClick)
  try {
    await loadLlmProviderSettings()
    frameworkStatus.value = 'ready'
  } catch (error) {
    frameworkStatus.value = 'error'
    frameworkError.value = error instanceof Error ? error.message : '无法读取模型设置。'
    showMessage(frameworkError.value, 'error')
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})

function validateConnection(requireKey = true) {
  if (!provider.baseUrl.trim()) return '请输入 API 基础地址。'
  try { new URL(provider.baseUrl) } catch { return 'API 基础地址无效。' }
  if (!provider.model.trim()) return '请输入模型名称。'
  if (requireKey && !provider.apiKey.trim()) return '请输入 API 密钥。'
  return ''
}

async function saveSettings() {
  const error = validateConnection(false)
  if (error) return showMessage(error, 'error')
  isSaving.value = true
  try {
    await saveLlmProviderSettings()
    showMessage('连接设置已保存。', 'success')
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '保存失败。', 'error')
  } finally {
    isSaving.value = false
  }
}

async function reloadConfig() {
  try {
    await loadLlmProviderSettings(true)
    showMessage('已从配置文件位置重新读取配置。', 'success')
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '重新读取配置失败。', 'error')
  }
}

async function openConfigFile() {
  isOpeningConfig.value = true
  try {
    const path = await openLlmConfigFile()
    showMessage('已打开 ' + path + '。请在外部编辑器中保存，然后重新读取配置。', 'success')
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '无法打开桌面端配置文件。', 'error')
  } finally {
    isOpeningConfig.value = false
  }
}

function removeApiKey() {
  clearLlmApiKey()
  showApiKey.value = false
  showMessage('当前会话的 API 密钥已清除。', 'success')
}

function selectModel(id: string) {
  provider.model = id
  isDropdownOpen.value = false
}

function openDropdown() {
  if (availableModels.value.length) isDropdownOpen.value = true
}

async function fetchModels() {
  if (!provider.baseUrl.trim()) return showMessage('请先输入 API 基础地址。', 'error')
  try { new URL(provider.baseUrl) } catch { return showMessage('API 基础地址无效。', 'error') }
  isFetchingModels.value = true
  try {
    availableModels.value = await fetchAvailableModels(provider.baseUrl, provider.apiKey)
    isDropdownOpen.value = true
    showMessage(`已获取 ${availableModels.value.length} 个模型，点击输入框可选择。`, 'success')
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '获取模型列表失败。', 'error')
  } finally {
    isFetchingModels.value = false
  }
}

async function testConnection() {
  const error = validateConnection(true)
  if (error) return showMessage(error, 'error')
  try {
    await saveLlmProviderSettings()
  } catch (saveError) {
    return showMessage(saveError instanceof Error ? saveError.message : '保存配置失败。', 'error')
  }
  isTesting.value = true
  message.value = ''
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), Math.min(provider.timeoutMs, 30000))
  try {
    const response = await fetch(buildChatCompletionsEndpoint(provider.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.apiKey },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: 'Reply with OK only.' }], temperature: 0, max_tokens: 8 }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    if (!response.ok) throw new Error(body?.error?.message || '连接失败（HTTP ' + response.status + '）。')
    showMessage('连接成功。', 'success')
  } catch (error) {
    showMessage(error instanceof DOMException && error.name === 'AbortError' ? '连接测试超时。' : error instanceof Error ? error.message : '连接失败。', 'error')
  } finally {
    window.clearTimeout(timeout)
    isTesting.value = false
  }
}

function showMessage(text: string, type: 'success' | 'error') {
  message.value = text
  messageType.value = type
}
</script>

<style scoped>
.model-settings { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.settings-card { width: 100%; box-sizing: border-box; padding: 24px; border: 1px solid var(--color-border-divider); border-radius: 12px; background: var(--color-bg-surface); }
.intro-card, .card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.section-label { display: block; margin-bottom: 8px; color: var(--color-accent); font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h3 { margin: 0; font-size: 1.15rem; }
.intro-card p, .card-heading p { margin: 7px 0 0; color: var(--color-text-muted); line-height: 1.65; }
code { font-family: Consolas, 'Courier New', monospace; font-size: .88em; }
.framework-state, .backend-badge { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; border: 1px solid var(--color-border-divider); border-radius: 999px; padding: 7px 10px; background: var(--color-bg-container); color: var(--color-text-muted); font-size: .75rem; }
.state-dot { width: 7px; height: 7px; border-radius: 50%; background: #d49a23; }
.framework-state.ready .state-dot { background: #27ae60; }
.framework-state.error .state-dot { background: #e74c3c; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; margin-top: 22px; }
.wide-field { grid-column: 1 / -1; }
.field { min-width: 0; display: flex; flex-direction: column; gap: 7px; font-size: .84rem; font-weight: 600; }
.field small { color: var(--color-text-muted); font-size: .73rem; font-weight: 400; overflow-wrap: anywhere; }
.field input, .field select { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--color-border-input); border-radius: 8px; padding: 10px 11px; outline: none; background: var(--color-bg-input); color: var(--color-text-input); font: inherit; font-weight: 400; }
.field input:focus, .field select:focus { border-color: var(--color-accent); box-shadow: 0 0 0 3px rgba(66, 133, 244, .14); }
.secret-input { display: flex; align-items: stretch; }
.secret-input input { border-radius: 8px 0 0 8px; }
.secret-native-input::-ms-reveal, .secret-native-input::-ms-clear { display: none; }
.secret-native-input::-webkit-credentials-auto-fill-button,
.secret-native-input::-webkit-strong-password-auto-fill-button { display: none !important; visibility: hidden; }
.eye-btn { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 42px; border: 1px solid var(--color-border-btn-mode); border-left: 0; border-radius: 0 8px 8px 0; padding: 0; background: var(--color-bg-btn-secondary); color: var(--color-text-btn-secondary); cursor: pointer; }
.eye-btn:hover { color: var(--color-accent); }
.model-field { display: flex; align-items: stretch; gap: 8px; }
.model-input-wrap { position: relative; flex: 1 1 auto; min-width: 0; }
.model-input-wrap input { width: 100%; }
.fetch-btn { flex: 0 0 auto; min-height: 38px; border: 1px solid var(--color-border-btn-mode); border-radius: 8px; padding: 0 14px; background: var(--color-bg-btn-secondary); color: var(--color-text-btn-secondary); font: inherit; font-size: .82rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.fetch-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.fetch-btn:disabled, .eye-btn:disabled { opacity: .55; cursor: wait; }
.dropdown-list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; margin: 0; padding: 6px; max-height: 240px; overflow-y: auto; list-style: none; border: 1px solid var(--color-border-divider); border-radius: 8px; background: var(--color-bg-surface); box-shadow: 0 8px 24px rgba(0, 0, 0, .14); }
.model-dropdown-enter-active, .model-dropdown-leave-active { transition: opacity 160ms ease, transform 160ms ease; transform-origin: top center; }
.model-dropdown-enter-from, .model-dropdown-leave-to { opacity: 0; transform: translateY(-6px) scale(.98); }
.model-dropdown-leave-active { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .model-dropdown-enter-active, .model-dropdown-leave-active { transition: none; }
}
.dropdown-list li { padding: 8px 10px; border-radius: 6px; font-size: .84rem; font-weight: 400; color: var(--color-text-input); cursor: pointer; overflow-wrap: anywhere; }
.dropdown-list li:hover { background: var(--color-bg-surface-hover); }
.dropdown-list li.active { background: rgba(66, 133, 244, .14); color: var(--color-accent); font-weight: 600; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.primary-btn, .secondary-btn, .text-btn { min-height: 38px; border-radius: 8px; padding: 9px 15px; font: inherit; font-size: .86rem; font-weight: 600; cursor: pointer; }
.primary-btn { border: 1px solid var(--color-bg-btn-primary); background: var(--color-bg-btn-primary); color: var(--color-text-btn-primary); }
.secondary-btn { border: 1px solid var(--color-border-btn-mode); background: var(--color-bg-btn-secondary); color: var(--color-text-btn-secondary); }
.primary-btn:disabled, .secondary-btn:disabled, .text-btn:disabled { opacity: .55; cursor: wait; }
.text-btn { border: 0; background: transparent; color: var(--color-text-muted); }
.text-btn.danger { color: #b53a2d; }
.status { margin: 10px 0; padding: 10px 12px; border-radius: 7px; font-size: .85rem; }
.status.success { color: #1f7a48; background: rgba(39, 174, 96, .12); }
.status.error { color: #b53a2d; background: rgba(231, 76, 60, .12); }
@media (max-width: 620px) {
  .settings-card { padding: 18px; }
  .intro-card, .card-heading, .actions { align-items: stretch; flex-direction: column; }
  .framework-state, .backend-badge { align-self: flex-start; }
  .form-grid { grid-template-columns: 1fr; }
  .wide-field { grid-column: auto; }
}
</style>

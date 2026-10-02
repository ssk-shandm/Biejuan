<template>
  <div class="settings-page">
    <div class="settings-shell">
      <aside class="settings-leftbar">
        <div class="leftbar-header">
          <button class="back-btn" type="button" aria-label="返回首页" @click="emit('back')">
            <span aria-hidden="true">←</span>
            <span>返回</span>
          </button>

          <div class="settings-brand">
            <span class="brand-mark" aria-hidden="true">⚙</span>
            <div>
              <h1>设置</h1>
              <p>应用偏好与资源管理</p>
            </div>
          </div>
        </div>

        <div class="settings-quick-stats" aria-label="当前状态">
          <div><strong>{{ banks.length }}</strong><span>可用题库</span></div>
          <div><strong>{{ selectedBankName }}</strong><span>当前题库</span></div>
        </div>

        <nav class="settings-nav" aria-label="设置分类">
          <button
            v-for="item in settingsSections"
            :key="item.id"
            type="button"
            class="settings-nav-item"
            :class="{ active: activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'page' : undefined"
            @click="activeSection = item.id"
          >
            <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="nav-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
          </button>
        </nav>

        <div class="leftbar-footer">
          <span>当前版本</span>
          <strong>v{{ version }}</strong>
        </div>
      </aside>

      <main class="settings-rightcontent">
        <header class="content-header">
          <p class="content-eyebrow">SETTINGS</p>
          <h2>{{ activeSectionMeta.label }}</h2>
          <p>{{ activeSectionMeta.summary }}</p>
          <div class="settings-header-meta">
            <span class="settings-live-dot"></span>
            <span>本地数据已就绪</span>
            <span class="settings-header-divider"></span>
            <span>{{ banks.length }} 个题库</span>
          </div>
        </header>

        <div class="content-body">
          <div v-if="converterVisited" v-show="activeSection === 'ai-convert'">
            <AiDocumentConverter @configure="activeSection = 'ai-model'" @started="activeSection = 'runtime-terminal'" />
          </div>
          <template v-if="activeSection === 'resources'">
            <section class="settings-card">
              <div class="card-heading">
                <div>
                  <span class="section-label">本地内容</span>
                  <h3>题库资源</h3>
                  <p class="card-description">
                    下方显示应用当前可用的题库。桌面端可将 UTF-8 JSON 文件放入题库目录，再点击刷新题库；合法文件会自动加入列表，无效文件会提示原因。本机转换题库存储在应用数据中，可在这里删除。
                  </p>
                </div>
              </div>

              <div class="resource-actions">
                <button
                  class="resource-btn"
                  type="button"
                  :disabled="openingLocation !== null"
                  @click="handleOpenContentLocation('subjects')"
                >
                  <span class="resource-icon" aria-hidden="true">▤</span>
                  <span class="resource-copy">
                    <strong>题库文件</strong>
                    <small>打开 public/subjects</small>
                  </span>
                  <span class="resource-arrow" aria-hidden="true">›</span>
                </button>
                <button
                  class="resource-btn"
                  type="button"
                  :disabled="openingLocation !== null"
                  @click="handleOpenContentLocation('images')"
                >
                  <span class="resource-icon" aria-hidden="true">▧</span>
                  <span class="resource-copy">
                    <strong>题库图库</strong>
                    <small>打开 public/images</small>
                  </span>
                  <span class="resource-arrow" aria-hidden="true">›</span>
                </button>
                <button class="resource-btn" type="button" :disabled="isRefreshingBanks" :aria-busy="isRefreshingBanks" @click="emit('refreshBanks')">
                  <span class="resource-icon" aria-hidden="true">↻</span>
                  <span class="resource-copy">
                    <strong>{{ isRefreshingBanks ? '正在校验…' : '刷新题库' }}</strong>
                    <small>重新扫描并校验 JSON</small>
                  </span>
                  <span class="resource-arrow" aria-hidden="true">→</span>
                </button>
              </div>

              <BankManager :banks="banks" :selected-bank="selectedBank" />
              <p v-if="resourceMessage" class="status" :class="resourceMessageType">
                {{ resourceMessage }}
              </p>
            </section>
          </template>

          <template v-else-if="activeSection === 'ai-model'">
            <AiModelSettings />
          </template>

          <template v-else-if="activeSection === 'runtime-terminal'">
            <RuntimeTerminal />
          </template>
          <template v-else-if="activeSection === 'diagram'">
            <section class="settings-card">
              <div class="card-heading">
                <div>
                  <span class="section-label">UML 与图表</span>
                  <h3>PlantUML Server</h3>
                  <p class="card-description">
                    可填写自建或第三方 PlantUML SVG 服务地址。留空并保存即可恢复项目默认值。
                  </p>
                </div>
              </div>

              <div class="form-group">
                <label class="field-label" for="plantuml-server">服务地址</label>
                <input
                  id="plantuml-server"
                  v-model="plantUmlServer"
                  class="url-input"
                  type="url"
                  :placeholder="DEFAULT_PLANTUML_SERVER"
                  spellcheck="false"
                  @keydown.enter.prevent="savePlantUmlServer"
                />
                <p class="effective-url">
                  <span>当前生效</span>
                  <code>{{ effectivePlantUmlServer }}</code>
                </p>
              </div>

              <div class="card-actions">
                <button class="primary-btn" type="button" @click="savePlantUmlServer">保存地址</button>
                <button class="secondary-btn" type="button" @click="resetPlantUmlServer">恢复默认</button>
              </div>
              <p v-if="plantUmlMessage" class="status" :class="plantUmlMessageType">
                {{ plantUmlMessage }}
              </p>
            </section>
          </template>

          <template v-else-if="activeSection === 'preferences'">
            <section class="settings-card preferences-card">
              <div class="card-heading">
                <div>
                  <span class="section-label">应用偏好</span>
                  <h3>显示与更新</h3>
                  <p class="card-description">集中管理桌面端的显示模式和版本检查行为。</p>
                </div>
              </div>

              <div class="preference-list">
                <label class="preference-row">
                  <span class="preference-copy">
                    <strong>黑夜模式</strong>
                    <small>切换桌面端的深色界面。</small>
                  </span>
                  <input
                    class="settings-switch"
                    type="checkbox"
                    :checked="isDarkMode"
                    aria-label="黑夜模式"
                    @change="setDarkMode(($event.target as HTMLInputElement).checked)"
                  />
                </label>
                <label class="preference-row">
                  <span class="preference-copy">
                    <strong>每次启动时自动检查更新</strong>
                    <small>应用启动后自动查询 GitHub 最新 Release。</small>
                  </span>
                  <input
                    class="settings-switch"
                    type="checkbox"
                    :checked="autoCheckUpdates"
                    aria-label="每次启动时自动检查更新"
                    @change="setAutoCheckUpdates(($event.target as HTMLInputElement).checked)"
                  />
                </label>
              </div>
            </section>
          </template>

          <template v-else-if="activeSection === 'about'">
            <section class="settings-card update-card">
              <div class="card-heading">
                <div>
                  <span class="section-label">版本管理</span>
                  <h3>应用更新</h3>
                  <p>检查新版本并前往发布页面下载安装包。</p>
                </div>
                <span class="version-badge">v{{ version }}</span>
              </div>

              <div class="setting-row">
                <div>
                  <strong>检查更新</strong>
                  <p>当前安装版本为 v{{ version }}</p>
                </div>
                <button class="primary-btn" type="button" :disabled="isUpdating" @click="checkUpdate">
                  {{ isUpdating ? '检查中…' : '立即检查' }}
                </button>
              </div>

              <p v-if="updateError === 'already-latest'" class="status success">已是最新版本。</p>
              <p v-else-if="updateError" class="status error">{{ updateError }}</p>
            </section>

            <section class="settings-card about-detail">
              <header class="about-header">
                <img class="about-mark" src="/app-icon.png" alt="别卷图标" />
                <div>
                  <span class="section-label">应用信息</span>
                  <h3>{{ APP_NAME }}</h3>
                  <p>简洁、离线友好的刷题与错题复习工具</p>
                </div>
              </header>

              <dl class="about-list">
                <div>
                  <dt>版本号</dt>
                  <dd><button class="link-btn" type="button" @click="openLink(RELEASES_URL)">v{{ version }}</button></dd>
                </div>
                <div>
                  <dt>版权</dt>
                  <dd><button class="link-btn" type="button" @click="openLink(REPOSITORY_URL)">{{ COPYRIGHT_LINE }}</button></dd>
                </div>
                <div>
                  <dt>许可证</dt>
                  <dd><button class="link-btn" type="button" @click="openLink(LICENSE_URL)">{{ LICENSE_NAME }}</button></dd>
                </div>
                <div>
                  <dt>项目仓库</dt>
                  <dd>
                    <button class="link-btn repository-link" type="button" @click="openLink(REPOSITORY_URL)">
                      {{ REPOSITORY_URL }}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>图表支持</dt>
                  <dd>Mermaid / PlantUML</dd>
                </div>
              </dl>

              <p v-if="openError" class="status error">{{ openError }}</p>
            </section>
          </template>
        </div>
      </main>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AiDocumentConverter from './AiDocumentConverter.vue'
import AiModelSettings from './AiModelSettings.vue'
import RuntimeTerminal from './RuntimeTerminal.vue'
import BankManager from './BankManager.vue'
import type { BankEntry } from '../composables/useQuiz'
import { useVersion } from '../composables/useVersion'
import { useDarkMode } from '../composables/useDarkMode'
import { useUpdatePreferences } from '../composables/useUpdatePreferences'
import {
  APP_NAME,
  COPYRIGHT_LINE,
  LICENSE_NAME,
  LICENSE_URL,
  RELEASES_URL,
  REPOSITORY_URL,
} from '../config/appInfo'
import {
  DEFAULT_PLANTUML_SERVER,
  getPlantUmlServerOverride,
  loadDiagramRendererConfig,
  resetPlantUmlServerOverride,
  savePlantUmlServerOverride,
} from '../utils/diagramConfig'
import { openExternalUrl } from '../utils/openExternal'
import { openContentLocation, type ContentLocation } from '../utils/openContentLocation'

const props = defineProps<{ banks: BankEntry[]; selectedBank: string; isRefreshingBanks?: boolean }>()
const emit = defineEmits<{
  back: []
  refreshBanks: []
}>()

const settingsSections = [
  {
    id: 'preferences',
    icon: '⚙',
    label: '偏好设置',
    description: '显示与更新',
    summary: '管理黑夜模式、自动更新检查等应用偏好。',
  },
  {
    id: 'resources',
    icon: '▣',
    label: '题库资源',
    description: '题库和图库',
    summary: '定位并管理应用使用的本地题库资源。',
  },
  {
    id: 'ai-model',
    icon: '⚙',
    label: 'AI 模型配置',
    description: 'API 与模型',
    summary: '配置题库转换使用的模型服务、密钥和请求参数。',
  },
  {
    id: 'ai-convert',
    icon: '✦',
    label: '文档转换',
    description: 'Word / PDF / Excel',
    summary: '将常见文档资料提取并转换为项目题库 JSON。',
  },
  {
    id: 'diagram',
    icon: '◇',
    label: '图表渲染',
    description: 'PlantUML 服务',
    summary: '配置 UML 图表渲染服务，保留题目中的图表能力。',
  },
  {
    id: 'runtime-terminal',
    icon: '>_',
    label: '\u8FD0\u884C\u7EC8\u7AEF',
    description: '\u9879\u76EE\u8FD0\u884C\u4FE1\u606F',
    summary: '\u67E5\u770B\u9879\u76EE\u516C\u5F00\u7684\u8FD0\u884C\u65E5\u5FD7\u3001\u8B66\u544A\u548C\u9519\u8BEF\u4FE1\u606F\u3002',
  },
  {
    id: 'about',
    icon: 'ⓘ',
    label: '关于与更新',
    description: '版本、项目与许可证',
    summary: '查看项目版本、检查更新以及浏览开源信息。',
  },
] as const

type SettingsSection = (typeof settingsSections)[number]['id']

const activeSection = ref<SettingsSection>('about')
const converterVisited = ref(false)
watch(activeSection, section => { if (section === 'ai-convert') converterVisited.value = true })
const activeSectionMeta = computed(
  () => settingsSections.find((item) => item.id === activeSection.value) ?? settingsSections[0],
)
const selectedBankName = computed(() => props.banks.find((bank) => bank.file === props.selectedBank)?.name ?? '未选择')

const { version, isUpdating, updateError, checkUpdate } = useVersion()
const plantUmlServer = ref(getPlantUmlServerOverride())
const effectivePlantUmlServer = ref(DEFAULT_PLANTUML_SERVER)
const plantUmlMessage = ref('')
const plantUmlMessageType = ref<'success' | 'error'>('success')
const openingLocation = ref<ContentLocation | null>(null)
const resourceMessage = ref('')
const resourceMessageType = ref<'success' | 'error'>('success')
const openError = ref('')
const { isDarkMode, toggleDarkMode } = useDarkMode()
const { autoCheckUpdates, setAutoCheckUpdates } = useUpdatePreferences()

function setDarkMode(value: boolean) {
  if (isDarkMode.value !== value) toggleDarkMode()
}

const settingsPageLockClass = 'settings-page-open'

onBeforeMount(() => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.add(settingsPageLockClass)
  document.body.classList.add(settingsPageLockClass)
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove(settingsPageLockClass)
  document.body.classList.remove(settingsPageLockClass)
})

onMounted(async () => {
  effectivePlantUmlServer.value = (await loadDiagramRendererConfig()).plantUml.server
})

async function handleOpenContentLocation(location: ContentLocation) {
  openingLocation.value = location
  resourceMessage.value = ''

  try {
    const result = await openContentLocation(location)
    const resourceName = location === 'subjects' ? '题库位置' : '题库图库'
    resourceMessageType.value = 'success'
    resourceMessage.value = result.platform === 'desktop'
      ? `已在文件管理器中打开${resourceName}。`
      : `已在新窗口中打开${resourceName}。`
  } catch (error) {
    resourceMessageType.value = 'error'
    resourceMessage.value = error instanceof Error ? error.message : '无法打开资源位置'
  } finally {
    openingLocation.value = null
  }
}

function showPlantUmlMessage(message: string, type: 'success' | 'error') {
  plantUmlMessage.value = message
  plantUmlMessageType.value = type
}

async function savePlantUmlServer() {
  try {
    const saved = savePlantUmlServerOverride(plantUmlServer.value)
    plantUmlServer.value = saved
    effectivePlantUmlServer.value = (await loadDiagramRendererConfig()).plantUml.server
    showPlantUmlMessage(saved ? 'PlantUML 地址已保存。' : '已恢复项目默认地址。', 'success')
  } catch (error) {
    showPlantUmlMessage(error instanceof Error ? error.message : '地址格式无效', 'error')
  }
}

async function resetPlantUmlServer() {
  resetPlantUmlServerOverride()
  plantUmlServer.value = ''
  effectivePlantUmlServer.value = (await loadDiagramRendererConfig()).plantUml.server
  showPlantUmlMessage('已恢复项目默认地址。', 'success')
}

async function openLink(url: string) {
  openError.value = ''
  try {
    await openExternalUrl(url)
  } catch (error) {
    openError.value = error instanceof Error ? error.message : '无法打开链接'
  }
}

</script>

<style scoped>
:global(html.settings-page-open),
:global(body.settings-page-open) {
  overflow: hidden;
}

.settings-page {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  min-height: 0;
  padding: 24px;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--color-text-primary);
}

.settings-shell {
  width: min(1080px, 100%);
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 258px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--color-border-container);
  border-radius: 16px;
  background: var(--color-bg-container);
  box-shadow: var(--color-shadow-container);
}

.settings-leftbar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border-divider);
  background: var(--color-bg-surface);
}

.leftbar-header {
  padding: 24px 20px 18px;
  border-bottom: 1px solid var(--color-border-divider);
}

.back-btn,
.primary-btn,
.secondary-btn {
  min-height: 38px;
  border: 1px solid var(--color-border-btn-mode);
  border-radius: 8px;
  padding: 9px 15px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .18s ease, background-color .18s ease, transform .18s ease, opacity .18s ease;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  background: transparent;
  color: var(--color-text-muted);
}

.back-btn:hover,
.secondary-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.settings-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 12px;
  background: var(--color-bg-btn-primary);
  color: var(--color-text-btn-primary);
  font-size: 1.25rem;
}

.settings-brand h1 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.25;
}

.settings-brand p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: .8rem;
}

.settings-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 7px;
  padding: 18px 12px;
}

.settings-nav-item {
  position: relative;
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 12px;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color .18s ease, border-color .18s ease, color .18s ease;
}

.settings-nav-item::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: -1px;
  width: 3px;
  border-radius: 3px;
  background: transparent;
}

.settings-nav-item:hover {
  background: var(--color-bg-surface-hover);
}

.settings-nav-item.active {
  border-color: var(--color-border-divider);
  background: var(--color-bg-container);
  color: var(--color-accent);
}

.settings-nav-item.active::before {
  background: var(--color-accent);
}

.nav-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--color-bg-surface-hover);
  color: inherit;
  font-size: 1rem;
  font-weight: 700;
}

.nav-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-copy strong {
  font-size: .92rem;
}

.nav-copy small {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: .74rem;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leftbar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: auto 20px 0;
  padding: 18px 0 22px;
  border-top: 1px solid var(--color-border-divider);
  color: var(--color-text-muted);
  font-size: .78rem;
}

.leftbar-footer strong {
  color: var(--color-text-primary);
}

.settings-rightcontent {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 38px 42px;
  box-sizing: border-box;
  background: var(--color-bg-container);
}

.content-header {
  flex: 0 0 auto;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--color-border-divider);
}

.content-eyebrow,
.section-label {
  margin: 0 0 8px;
  color: var(--color-accent);
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.content-header h2 {
  margin: 0;
  font-size: 1.65rem;
  line-height: 1.25;
}

.content-header > p:last-child {
  margin: 8px 0 0;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.content-body {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 24px 12px 28px;
}

.settings-card {
  padding: 24px;
  border: 1px solid var(--color-border-divider);
  border-radius: 12px;
  background: var(--color-bg-surface);
}

.update-card {
  margin-bottom: 16px;
}

.settings-card h3 {
  margin: 0;
  font-size: 1.15rem;
}

.settings-card p {
  color: var(--color-text-muted);
}

.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.card-heading p,
.about-copy > p {
  margin: 7px 0 0;
  line-height: 1.65;
}

.version-badge {
  flex: 0 0 auto;
  border: 1px solid var(--color-border-divider);
  border-radius: 999px;
  padding: 6px 10px;
  background: var(--color-bg-container);
  color: var(--color-text-muted);
  font-size: .78rem;
  font-weight: 600;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border-divider);
}

.setting-row strong {
  display: block;
  margin-bottom: 5px;
  font-size: .94rem;
}

.setting-row p {
  margin: 0;
  font-size: .84rem;
}

.primary-btn {
  border-color: var(--color-bg-btn-primary);
  background: var(--color-bg-btn-primary);
  color: var(--color-text-btn-primary);
}

.primary-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.primary-btn:disabled,
.resource-btn:disabled {
  opacity: .55;
  cursor: wait;
}

.secondary-btn {
  background: var(--color-bg-btn-secondary);
  color: var(--color-text-btn-secondary);
}

.resource-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
}

.resource-btn {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--color-border-divider);
  border-radius: 10px;
  padding: 15px;
  background: var(--color-bg-container);
  color: var(--color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .18s ease, transform .18s ease, background-color .18s ease;
}

.resource-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  background: var(--color-bg-surface-hover);
  transform: translateY(-1px);
}

.resource-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 9px;
  background: var(--color-bg-surface-hover);
  color: var(--color-accent);
  font-size: 1.15rem;
}

.resource-copy {
  min-width: 0;
  flex: 1;
}

.resource-copy strong,
.resource-copy small {
  display: block;
}

.resource-copy strong {
  font-size: .9rem;
}

.resource-copy small {
  margin-top: 4px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: .75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-arrow {
  color: var(--color-text-muted);
  font-size: 1.4rem;
}

.form-group {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border-divider);
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: .88rem;
  font-weight: 600;
}

.url-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border-input);
  border-radius: 8px;
  padding: 11px 12px;
  outline: none;
  background: var(--color-bg-input);
  color: var(--color-text-input);
  font: inherit;
  font-size: .9rem;
  transition: border-color .18s ease, box-shadow .18s ease;
}

.url-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(66, 133, 244, .14);
}

.effective-url {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 0 0;
  font-size: .78rem;
}

.effective-url span {
  flex: 0 0 auto;
}

.effective-url code {
  min-width: 0;
  color: var(--color-text-muted);
  font-family: Consolas, 'Courier New', monospace;
  overflow-wrap: anywhere;
}

.card-actions,
.dialog-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-actions {
  margin-top: 20px;
}

.status {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  font-size: .85rem;
  line-height: 1.5;
}

.status.success {
  color: #1f7a48;
  background: rgba(39, 174, 96, .12);
}

.status.error {
  color: #b53a2d;
  background: rgba(231, 76, 60, .12);
}

.about-header {
  display: flex;
  align-items: center;
  gap: 18px;
}

.about-header h3 {
  font-size: 1.25rem;
}

.about-header p {
  margin: 6px 0 0;
}

.about-mark {
  width: 68px;
  height: 68px;
  display: block;
  object-fit: cover;
  flex: 0 0 auto;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(74, 144, 217, .22);
}

.about-list {
  margin: 24px 0 0;
  border-top: 1px solid var(--color-border-divider);
}

.about-list > div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 16px;
  padding: 15px 4px;
  border-bottom: 1px solid var(--color-border-divider);
}

.about-list dt {
  color: var(--color-text-muted);
}

.about-list dd {
  min-width: 0;
  margin: 0;
  text-align: right;
}

.link-btn {
  max-width: 100%;
  border: 0;
  padding: 0;
  background: none;
  color: var(--color-accent);
  font: inherit;
  text-align: right;
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.repository-link {
  word-break: break-all;
}


.preference-list {
  display: grid;
  gap: 12px;
}

.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 15px 0;
  border-bottom: 1px solid var(--color-border-divider);
  cursor: pointer;
}

.preference-row:last-child {
  border-bottom: 0;
}

.preference-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.preference-copy strong {
  color: var(--color-text-primary);
}

.preference-copy small {
  color: var(--color-text-muted);
  line-height: 1.5;
}

.settings-switch {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 26px;
  margin: 0;
  border: 0;
  border-radius: 999px;
  outline: none;
  appearance: none;
  background: var(--color-bg-input-disabled);
  cursor: pointer;
  transition: background-color .2s ease, box-shadow .2s ease;
}

.settings-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .22);
  transition: transform .2s ease;
}

.settings-switch:checked {
  background: var(--color-bg-btn-primary);
}

.settings-switch:checked::after {
  transform: translateX(20px);
}

.settings-switch:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 28%, transparent);
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, .48);
}

.update-dialog {
  width: min(440px, 92vw);
  padding: 26px;
  box-sizing: border-box;
  border: 1px solid var(--color-border-container);
  border-radius: 12px;
  background: var(--color-bg-container);
  color: var(--color-text-primary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .28);
}

.update-dialog h3 {
  margin-top: 0;
}

.release-notes {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.dialog-actions {
  justify-content: flex-end;
  margin-top: 20px;
}

.back-btn:focus-visible,
.primary-btn:focus-visible,
.secondary-btn:focus-visible,
.settings-nav-item:focus-visible,
.resource-btn:focus-visible,
.url-input:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .settings-page {
    height: 100vh;
    padding: 12px;
  }

  .settings-shell {
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-leftbar {
    border-right: 0;
    border-bottom: 1px solid var(--color-border-divider);
  }

  .leftbar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
  }

  .settings-brand {
    margin-top: 0;
  }

  .brand-mark {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .settings-brand p,
  .nav-copy small,
  .leftbar-footer {
    display: none;
  }

  .settings-nav {
    flex: none;
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
    padding: 10px 12px 12px;
    scrollbar-width: thin;
  }

  .settings-nav-item {
    width: auto;
    flex: 0 0 auto;
    padding: 9px 11px;
  }

  .settings-nav-item::before {
    top: auto;
    right: 10px;
    bottom: -1px;
    left: 10px;
    width: auto;
    height: 3px;
  }

  .nav-icon {
    width: 26px;
    height: 26px;
  }

  .settings-rightcontent {
    min-height: 0;
    padding: 26px 22px;
  }
}

@media (max-width: 520px) {
  .settings-brand h1 {
    font-size: 1.05rem;
  }

  .back-btn {
    padding-inline: 8px;
  }

  .settings-rightcontent {
    padding: 22px 16px;
  }

  .content-header h2 {
    font-size: 1.4rem;
  }

  .settings-card {
    padding: 18px;
  }

  .card-heading,
  .setting-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .setting-row .primary-btn {
    width: 100%;
  }

  .resource-actions {
    grid-template-columns: 1fr;
  }


  .about-header {
    align-items: flex-start;
  }

  .about-list > div {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .about-list dd,
  .link-btn {
    text-align: left;
  }

  .about-mark {
    width: 58px;
    height: 58px;
    border-radius: 17px;
  }

  .card-actions,
  .dialog-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .card-actions button,
  .dialog-actions button {
    width: 100%;
  }
}
/* Settings dashboard accents. Kept CSS-only so the desktop shell stays fast. */
.settings-quick-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 20px 4px; }
.settings-quick-stats > div { display: grid; gap: 3px; min-width: 0; padding: 10px; border: 1px solid var(--color-border-divider); border-radius: 10px; background: var(--color-bg-container); }
.settings-quick-stats strong { overflow: hidden; color: var(--color-text-primary); font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
.settings-quick-stats span { color: var(--color-text-muted); font-size: .68rem; }
.settings-header-meta { display: flex; align-items: center; gap: 8px; margin-top: 14px; color: var(--color-text-muted); font-size: .74rem; }
.settings-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px color-mix(in srgb, #22c55e 14%, transparent); animation: settings-pulse 2.4s ease-in-out infinite; }
.settings-header-divider { width: 1px; height: 13px; background: var(--color-border-divider); }
.settings-nav-item { transition: transform .18s ease, background-color .18s ease, border-color .18s ease, box-shadow .18s ease; }
.settings-nav-item:hover { transform: translateX(2px); box-shadow: 0 5px 12px rgba(15, 23, 42, .05); }
.settings-nav-item.active { box-shadow: inset 3px 0 0 var(--color-accent), 0 6px 16px rgba(15, 23, 42, .045); }
.settings-card { animation: settings-card-in .26s ease both; }
@keyframes settings-card-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
@keyframes settings-pulse { 0%, 100% { opacity: .72; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.16); } }
@media (prefers-reduced-motion: reduce) { .settings-live-dot, .settings-card, .settings-nav-item { animation: none !important; transition: none !important; } }

</style>

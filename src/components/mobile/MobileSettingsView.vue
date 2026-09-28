<template>
  <section class="mobile-settings-page" aria-label="设置">
    <header class="mobile-settings-hero">
      <div class="mobile-settings-hero-top">
        <span class="mobile-settings-eyebrow">PERSONAL WORKSPACE · 设置中心</span>
      </div>
      <h2>让学习，按你的节奏。</h2>
      <p>在这里管理题库、转换工具与使用偏好。</p>
      <div class="mobile-settings-stats">
        <div><strong>{{ banks.length }}</strong><span>可用题库</span></div>
        <div><strong>{{ modelReady ? '已就绪' : '待配置' }}</strong><span>AI 模型</span></div>
      </div>
    </header>

    <div class="mobile-settings-section-title"><span>学习与创作</span><small>01 / TOOLS</small></div>
    <div class="mobile-settings-tile-group">
      <button class="mobile-settings-tile" type="button" @click="$emit('converter')">
        <span class="mobile-settings-tile-icon tone-blue" aria-hidden="true">✦</span>
        <span class="mobile-settings-tile-copy"><strong>文档转换</strong><small>提取资料，转换为可练习的题库</small></span>
        <span class="mobile-settings-chevron" aria-hidden="true">›</span>
      </button>
      <button class="mobile-settings-tile" type="button" :aria-expanded="showAiSettings" aria-controls="mobile-ai-settings" @click="showAiSettings = !showAiSettings">
        <span class="mobile-settings-tile-icon tone-violet" aria-hidden="true">◎</span>
        <span class="mobile-settings-tile-copy"><strong>AI 模型配置 <span class="mobile-settings-tag" :class="{ ready: modelReady }">{{ modelReady ? '已配置' : '待配置' }}</span></strong><small>{{ modelReady ? provider.model : '连接模型服务，开启智能转换' }}</small></span>
        <span class="mobile-settings-chevron" :class="{ expanded: showAiSettings }" aria-hidden="true">›</span>
      </button>
      <Transition name="mobile-reveal">
        <div v-if="showAiSettings" id="mobile-ai-settings" class="mobile-settings-expanded">
          <p class="mobile-settings-hint">转换时会读取此处的模型地址、名称与本次会话中的 API Key。请勿使用不信任的服务地址。</p>
          <AiModelSettings />
        </div>
      </Transition>
    </div>

    <div class="mobile-settings-section-title"><span>资源管理</span><small>02 / LIBRARY</small></div>
    <div class="mobile-settings-tile-group">
      <button class="mobile-settings-tile" type="button" :aria-expanded="showBanks" aria-controls="mobile-bank-manager" @click="showBanks = !showBanks">
        <span class="mobile-settings-tile-icon tone-amber" aria-hidden="true">▤</span>
        <span class="mobile-settings-tile-copy"><strong>题库资源</strong><small>当前：{{ currentBankName }} · 共 {{ banks.length }} 个</small></span>
        <span class="mobile-settings-chevron" :class="{ expanded: showBanks }" aria-hidden="true">›</span>
      </button>
      <Transition name="mobile-reveal">
        <div v-if="showBanks" id="mobile-bank-manager" class="mobile-settings-expanded">
          <BankManager :banks="banks" :selected-bank="selectedBank" />
        </div>
      </Transition>
    </div>

    <div class="mobile-settings-section-title"><span>使用偏好</span><small>03 / APP</small></div>
    <div class="mobile-settings-tile-group">
      <button class="mobile-settings-tile" type="button" :aria-label="isDarkMode ? '切换为浅色模式' : '切换为深色模式'" :aria-pressed="isDarkMode" @click="$emit('toggle-dark')">
        <span class="mobile-settings-tile-icon tone-green" aria-hidden="true">{{ isDarkMode ? '☾' : '☼' }}</span>
        <span class="mobile-settings-tile-copy"><strong>深色模式</strong><small>{{ isDarkMode ? '已开启 · 轻触切换浅色' : '已关闭 · 轻触切换深色' }}</small></span>
        <span class="mobile-settings-toggle" :class="{ on: isDarkMode }" aria-hidden="true"></span>
      </button>
    </div>
    <p class="mobile-settings-footnote">题库与练习记录保存在本机。删除题库前请先确认是否需要备份。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import AiModelSettings from '../AiModelSettings.vue'
import BankManager from '../BankManager.vue'
import { DEFAULT_LLM_BASE_URL, useLlmSettings } from '../../composables/useLlmSettings'
import type { BankEntry } from '../../composables/useQuiz'

const props = defineProps<{ isDarkMode: boolean; openAiSettings?: boolean; banks: BankEntry[]; selectedBank: string }>()
const showAiSettings = ref(Boolean(props.openAiSettings))
const showBanks = ref(false)
const { provider, loadLlmProviderSettings } = useLlmSettings()
const modelReady = computed(() => Boolean(provider.baseUrl.trim() && provider.baseUrl !== DEFAULT_LLM_BASE_URL && provider.model.trim() && provider.apiKey.trim()))
const currentBankName = computed(() => props.banks.find(bank => bank.file === props.selectedBank)?.name || '未选择')
onMounted(() => { void loadLlmProviderSettings().catch(() => { /* AiModelSettings displays load errors when opened. */ }) })
watch(() => props.openAiSettings, value => { if (value) showAiSettings.value = true })
defineEmits<{
  (event: 'home'): void
  (event: 'toggle-dark'): void
  (event: 'converter'): void
}>()
</script>

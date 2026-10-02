<template>
  <component :is="tag" ref="root" class="markdown-content" :class="{ 'plain-content': resolvedFormat === 'text' }">
    <template v-if="resolvedFormat === 'text'">{{ content }}</template>
    <template v-else><div class="markdown-html" v-html="renderedDocument.html"></div></template>
  </component>
</template>

<script lang="ts">
let mermaidInitialized = false
</script>

<script setup lang="ts">
import DOMPurify from 'dompurify'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ContentFormat } from '../types'
import { normalizeContentFormat } from '../utils/contentFormat'
import { renderMarkdownDocument } from '../utils/markdown'
import { buildPlantUmlUrl, loadDiagramRendererConfig } from '../utils/diagramConfig'

const props = withDefaults(defineProps<{
  content?: string
  format?: ContentFormat
  tag?: string
}>(), {
  content: '',
  format: 'text',
  tag: 'div',
})

const root = ref<HTMLElement | null>(null)
const resolvedFormat = computed(() => normalizeContentFormat(props.format))
const renderedDocument = computed(() => renderMarkdownDocument(props.content, resolvedFormat.value))
let renderVersion = 0

async function renderDiagrams() {
  const version = ++renderVersion
  await nextTick()
  if (resolvedFormat.value === 'text' || !root.value || renderedDocument.value.diagrams.length === 0) return

  const config = await loadDiagramRendererConfig()
  const mermaidBlocks = renderedDocument.value.diagrams.some((diagram) => diagram.type === 'mermaid')
  const mermaidModule = mermaidBlocks ? await import('mermaid') : undefined
  if (mermaidModule && !mermaidInitialized) {
    mermaidModule.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
    })
    mermaidInitialized = true
  }
  if (version !== renderVersion || !root.value) return

  for (const [index, diagram] of renderedDocument.value.diagrams.entries()) {
    const container = root.value.querySelector<HTMLElement>(`[data-diagram-index="${index}"]`)
    if (!container) continue
    container.replaceChildren()

    try {
      if (diagram.type === 'mermaid' && mermaidModule) {
        const id = `mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
        const { svg } = await mermaidModule.default.render(id, diagram.source)
        if (version !== renderVersion) return
        container.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
        continue
      }

      if (!config.plantUml.enabled) {
        throw new Error('PlantUML 已在 diagram-renderer.json 中禁用')
      }
      const image = new Image()
      image.loading = 'lazy'
      image.alt = 'PlantUML 图表'
      image.src = buildPlantUmlUrl(diagram.source, config.plantUml.server)
      image.addEventListener('error', () => {
        container.textContent = 'PlantUML 图表加载失败，请检查服务器地址或网络连接。'
        container.classList.add('diagram-error')
      }, { once: true })
      container.appendChild(image)
    } catch (error) {
      container.textContent = `图表渲染失败：${error instanceof Error ? error.message : '未知错误'}`
      container.classList.add('diagram-error')
    }
  }
}

watch(() => [props.content, props.format], () => { void renderDiagrams() })
onMounted(() => { void renderDiagrams() })
</script>

<style scoped>
.markdown-content { min-width: 0; color: inherit; }
.plain-content { white-space: pre-wrap; word-break: break-word; }
.markdown-html { min-width: 0; }
.markdown-content :deep(p:first-child) { margin-top: 0; }
.markdown-content :deep(p:last-child) { margin-bottom: 0; }
.markdown-content :deep(pre) {
  overflow-x: auto;
  border: 1px solid var(--color-border-code-block);
  border-radius: 6px;
}
.markdown-content :deep(code.hljs) {
  display: block;
  padding: 12px 16px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  line-height: 1.5;
}
.markdown-content :deep(code:not(.hljs)) {
  padding: 2px 5px;
  border-radius: 3px;
  background: var(--color-bg-code-inline);
}
.markdown-content :deep(table) { display: block; overflow-x: auto; width: 100%; border-collapse: collapse; margin: 10px 0; }
.markdown-content :deep(th), .markdown-content :deep(td) {
  border: 1px solid var(--color-border-surface);
  padding: 7px 10px;
  text-align: left;
}
.markdown-content :deep(.diagram-placeholder) {
  overflow-x: auto;
  margin: 14px 0;
  padding: 12px;
  text-align: center;
  border: 1px solid var(--color-border-surface);
  border-radius: 8px;
  background: var(--color-bg-scenario);
}
.markdown-content :deep(.diagram-placeholder svg),
.markdown-content :deep(.diagram-placeholder img) { max-width: 100%; height: auto; }
.markdown-content :deep(.diagram-error) { color: var(--color-text-incorrect); text-align: left; }
</style>

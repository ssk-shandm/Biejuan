<template>
  <section class="mobile-panel mobile-converter-page">
    <div class="mobile-settings-heading">
      <div>
        <p class="mobile-kicker">本地解析 · AI 转换</p>
        <h2>文档转换</h2>
      </div>
      <button class="mobile-action mobile-back-action" type="button" @click="$emit('back')">返回</button>
    </div>
    <AiDocumentConverter @configure="$emit('configure')" @started="$emit('started')" />
  </section>
</template>

<script setup lang="ts">
import AiDocumentConverter from '../AiDocumentConverter.vue'
defineEmits<{ (event: 'back'): void; (event: 'configure'): void; (event: 'started'): void }>()
</script>

<style scoped>
.mobile-converter-page :deep(.ai-converter) { display: grid; gap: var(--space-4); }
.mobile-converter-page :deep(.panel-card),
.mobile-converter-page :deep(.settings-card) { min-width: 0; }
.mobile-converter-page :deep(.form-grid) { grid-template-columns: 1fr; }
.mobile-converter-page :deep(.output-heading) { display: grid; gap: var(--space-3); }
.mobile-converter-page :deep(.inline-actions) { display: grid; grid-template-columns: 1fr; }
.mobile-converter-page :deep(button),
.mobile-converter-page :deep(input),
.mobile-converter-page :deep(select),
.mobile-converter-page :deep(textarea) { min-height: var(--touch-target-min); box-sizing: border-box; }
</style>

<template>
  <nav class="mobile-bottom-nav" :class="{ 'mobile-bottom-nav-exam': isExam }" aria-label="答题操作">
    <button class="mobile-action" type="button" :disabled="currentIndex === 0" @click="$emit('previous')">上一题</button>
    <button class="mobile-action" type="button" @click="$emit('answerSheet')">答题卡</button>
    <button class="mobile-action mobile-primary" type="button" :disabled="currentIndex >= totalQuestions - 1" @click="$emit('next')">下一题</button>
    <button v-if="isExam" class="mobile-action mobile-submit" type="button" @click="$emit('submitExam')">交卷</button>
  </nav>
</template>

<script setup lang="ts">
defineProps<{ currentIndex: number; totalQuestions: number; isExam?: boolean }>()
defineEmits<{
  (event: 'previous'): void
  (event: 'answerSheet'): void
  (event: 'next'): void
  (event: 'submitExam'): void
}>()
</script>

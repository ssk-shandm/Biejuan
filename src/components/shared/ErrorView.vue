<template>
  <div class="app-error-view" role="alert">
    <h2>渲染错误</h2>
    <pre>{{ message }}</pre>
    <button type="button" @click="$emit('reset')">返回首页</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ message: string }>()
defineEmits<{ (event: 'reset'): void }>()
</script>

<style scoped>
.app-error-view { color: red; padding: 40px; text-align: center; }
.app-error-view pre { white-space: pre-wrap; text-align: left; }
</style>

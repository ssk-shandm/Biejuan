<template>
  <template v-if="!storageReady">
    <LoadingView />
    <ToastContainer />
  </template>
  <DesktopShell v-else-if="layoutMode === 'desktop'" />
  <MobileShell v-else />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import LoadingView from '../components/shared/LoadingView.vue'
import ToastContainer from '../components/ToastContainer.vue'
import { useQuizStore } from '../stores/quizStore'
import { useLayoutMode } from '../composables/useLayoutMode'
import DesktopShell from './DesktopShell.vue'
import MobileShell from './MobileShell.vue'

const { layoutMode } = useLayoutMode()
const quizStore = useQuizStore()
const storageReady = ref(false)
onMounted(async () => {
  await quizStore.persistedDataReady
  storageReady.value = true
})
</script>

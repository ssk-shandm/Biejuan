<template>
  <DesktopShell v-if="layoutMode === 'desktop'" />
  <MobileShell v-else />
</template>

<script setup lang="ts">
import { useLayoutMode } from '../composables/useLayoutMode'
import DesktopShell from './DesktopShell.vue'
import MobileShell from './MobileShell.vue'

const { layoutMode } = useLayoutMode()
</script>

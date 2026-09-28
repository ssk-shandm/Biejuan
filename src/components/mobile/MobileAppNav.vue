<template>
  <nav class="mobile-app-nav" aria-label="主导航">
    <button class="mobile-nav-item mobile-nav-item-home" :class="{ active: screen === 'home' }" type="button" :aria-current="screen === 'home' ? 'page' : undefined" @click="$emit('home')">
      <span class="mobile-nav-icon" aria-hidden="true">⌂</span><span class="mobile-nav-label">首页</span>
    </button>
    <button class="mobile-nav-item mobile-nav-item-wrong" :class="{ active: screen === 'wrong-notebook' }" type="button" :aria-current="screen === 'wrong-notebook' ? 'page' : undefined" @click="$emit('wrongNotebook')">
      <span class="mobile-nav-icon" aria-hidden="true">▣</span><span class="mobile-nav-label">错题本</span>
    </button>
    <button class="mobile-nav-item mobile-nav-item-settings" :class="{ active: screen === 'settings' || screen === 'converter' || screen === 'terminal' }" type="button" :aria-current="screen === 'settings' || screen === 'converter' || screen === 'terminal' ? 'page' : undefined" @click="$emit('settings')">
      <span class="mobile-nav-icon" aria-hidden="true">⚙</span><span class="mobile-nav-label">设置</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import type { AppScreen } from '../../composables/useAppNavigation'

defineProps<{ screen: AppScreen }>()
defineEmits<{
  (event: 'home'): void
  (event: 'wrongNotebook'): void
  (event: 'settings'): void
}>()
</script>
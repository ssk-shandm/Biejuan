<template>
  <Teleport to="body">
    <div v-if="updateInfo" class="dialog-overlay" @click.self="clearUpdate">
      <div class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h3 id="update-title">发现新版本 v{{ updateInfo.version }}</h3>
        <MarkdownContent
          v-if="updateInfo.releaseNotes"
          class="release-notes"
          :content="updateInfo.releaseNotes"
          format="markdown"
        />
        <p v-else class="release-notes-empty">该版本没有提供更新说明。</p>
        <p v-if="isDownloading && downloadProgress" class="download-progress" aria-live="polite">
          {{ downloadProgress }}
        </p>
        <p v-if="downloadError" class="download-error">{{ downloadError }}</p>
        <div class="dialog-actions">
          <button
            class="primary-btn"
            type="button"
            :disabled="isDownloading || !updateInfo.installerUrl || !updateInfo.installerName"
            :title="updateInfo.installerUrl ? '下载并安装 Windows 更新' : '当前 Release 没有 Windows 安装包'"
            @click="downloadAndInstallUpdate"
          >
            {{ isDownloading ? '下载中…' : '下载并安装' }}
          </button>
          <button class="secondary-btn" type="button" @click="openGitHubDownload">前往 GitHub 下载</button>
          <button class="secondary-btn" type="button" @click="clearUpdate">稍后再说</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import { useVersion } from '../composables/useVersion'
import { openExternalUrl } from '../utils/openExternal'

const {
  updateInfo,
  isDownloading,
  downloadProgress,
  updateError,
  downloadAndInstall,
  clearUpdate,
} = useVersion()
const localError = ref('')
const downloadError = computed(() => localError.value || (updateError.value && updateError.value !== 'already-latest' ? updateError.value : ''))

async function openGitHubDownload() {
  if (!updateInfo.value) return
  try {
    await openExternalUrl(updateInfo.value.downloadUrl)
    clearUpdate()
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '无法打开 GitHub 下载页面'
  }
}

async function downloadAndInstallUpdate() {
  localError.value = ''
  try {
    await downloadAndInstall()
    clearUpdate()
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '自动更新失败'
  }
}
</script>

<style scoped>
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
  width: min(560px, 92vw);
  max-height: min(720px, 90vh);
  overflow: auto;
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
  max-height: 360px;
  overflow: auto;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.release-notes-empty {
  color: var(--color-text-muted);
}

.download-progress {
  margin: 14px 0 0;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.download-error {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  color: var(--color-text-incorrect);
  background: rgba(231, 76, 60, .12);
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.primary-btn,
.secondary-btn {
  min-height: 38px;
  border: 1px solid var(--color-border-btn-mode);
  border-radius: 8px;
  padding: 9px 15px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  border-color: var(--color-bg-btn-primary);
  background: var(--color-bg-btn-primary);
  color: var(--color-text-btn-primary);
}

.secondary-btn {
  background: var(--color-bg-btn-secondary);
  color: var(--color-text-btn-secondary);
}

button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

@media (max-width: 520px) {
  .dialog-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions button {
    width: 100%;
  }
}
</style>

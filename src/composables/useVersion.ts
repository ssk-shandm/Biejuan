import { ref } from 'vue'
import { addRuntimeLog } from './useRuntimeConsole'
import {
  APP_VERSION_FALLBACK,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASES_URL,
} from '../config/appInfo'

const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type ReleaseAsset = {
  name?: unknown
  browser_download_url?: unknown
}

const version = ref(APP_VERSION_FALLBACK)
const isUpdating = ref(false)
const isDownloading = ref(false)
const downloadProgress = ref('')
const updateInfo = ref<RemoteVersion | null>(null)
const updateError = ref('')
let versionPromise: Promise<void> | null = null
let updatePromise: Promise<void> | null = null

interface RemoteVersion {
  version: string
  downloadUrl: string
  releaseNotes: string
  installerUrl: string | null
  installerName: string | null
}

export function useVersion() {

  function resolveAppVersion() {
    if (versionPromise) return versionPromise
    versionPromise = (async () => {
      if (!isDesktopRuntime()) return
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const desktopVersion = await invoke<string>('get_app_version')
        if (desktopVersion) version.value = desktopVersion
      } catch (error) {
        console.warn('读取桌面应用版本失败，使用内置版本号：', error)
      }
    })()
    return versionPromise
  }

  void resolveAppVersion()

  /** 通过 GitHub Releases API 获取最新版本。 */
  async function checkUpdate() {
    // Web builds are deployed independently and must not compare themselves with the Windows installer release.
    if (!isDesktopRuntime()) return
    if (updatePromise) return updatePromise
    isUpdating.value = true
    updateInfo.value = null
    updateError.value = ''

    updatePromise = (async () => {
      try {
        await resolveAppVersion()
        const res = await fetch(GITHUB_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!res.ok) {
          if (res.status === 403) throw new Error('GitHub API rate limit reached; try again later')
          if (res.status === 404) throw new Error('No Release has been published yet')
          throw new Error('Update check failed (HTTP ' + res.status + ')')
        }

        const data = await res.json()
        const remoteVersion = String(data.tag_name ?? '').replace(/^v/i, '')
        if (!remoteVersion) throw new Error('Latest Release has no version tag')

        if (compareVersions(remoteVersion, version.value) > 0) {
          const installer = Array.isArray(data.assets)
            ? data.assets.find((asset: ReleaseAsset) => {
              const name = String(asset.name ?? '').toLowerCase()
              return name.endsWith('-setup.exe')
            })
            : undefined
          updateInfo.value = {
            version: remoteVersion,
            downloadUrl: data.html_url ?? RELEASES_URL,
            releaseNotes: data.body ?? '',
            installerUrl: installer?.browser_download_url ? String(installer.browser_download_url) : null,
            installerName: installer?.name ? String(installer.name) : null,
          }
          addRuntimeLog('info', 'Found new version v' + remoteVersion + (installer ? ', installer: ' + String(installer.name) : ''))
        } else {
          updateError.value = 'already-latest'
        }
      } catch (error) {
        updateError.value = error instanceof Error ? error.message : 'Network error'
        addRuntimeLog('error', 'Update check failed: ' + updateError.value)
      } finally {
        isUpdating.value = false
        updatePromise = null
      }
    })()

    return updatePromise
  }

  async function downloadAndInstall() {
    const info = updateInfo.value
    if (!info?.installerUrl || !info.installerName) {
      throw new Error('This Release has no automatically installable Windows package')
    }
    if (isDownloading.value) return

    if (!isDesktopRuntime()) throw new Error('Automatic updates are supported only in the Windows desktop app')

    isDownloading.value = true
    updateError.value = ''
    addRuntimeLog('info', 'Starting update download: ' + info.installerName)

    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')

    const unlisteners: Array<() => void> = []
    downloadProgress.value = ''
    // 终端日志只按 10% 步进记录，界面上的进度文本则实时刷新
    let lastLoggedStep = -1

    try {
      unlisteners.push(await listen<{ downloaded: number; total: number | null; percent: number | null; fileName: string }>(
        'update-download-progress',
        (event) => {
          const { downloaded, total, percent } = event.payload
          const size = (downloaded / 1024 / 1024).toFixed(1) + ' MB'
          const totalText = total ? ' / ' + (total / 1024 / 1024).toFixed(1) + ' MB' : ''
          const progress = percent === null ? size + totalText : percent + '% (' + size + totalText + ')'
          downloadProgress.value = progress
          const step = percent === null ? Math.floor(downloaded / (10 * 1024 * 1024)) : Math.floor(percent / 10)
          if (step !== lastLoggedStep) {
            lastLoggedStep = step
            addRuntimeLog('info', '下载进度：' + progress)
          }
        },
      ))
      unlisteners.push(await listen<string>('update-install-starting', (event) => {
        downloadProgress.value = '正在启动安装程序…'
        addRuntimeLog('info', '安装包已保存到：' + event.payload + '，正在启动安装程序')
      }))
      await invoke('download_and_install_update', { url: info.installerUrl, fileName: info.installerName })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateError.value = message
      addRuntimeLog('error', 'Update download failed: ' + message)
      throw error
    } finally {
      unlisteners.forEach((unlisten) => unlisten())
      isDownloading.value = false
      downloadProgress.value = ''
    }
  }
  function clearUpdate() {
    updateInfo.value = null
    updateError.value = ''
  }

  return {
    version,
    isUpdating,
    isDownloading,
    downloadProgress,
    updateInfo,
    updateError,
    checkUpdate,
    downloadAndInstall,
    clearUpdate,
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

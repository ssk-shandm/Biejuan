export const APP_NAME = '别卷'
export const APP_VERSION_FALLBACK = '0.2.4'
export const GITHUB_OWNER = 'ssk-shandm'
export const GITHUB_REPO = 'Biejuan'
export const REPOSITORY_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
export const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`
export const LICENSE_NAME = 'MIT License'
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`
export const COPYRIGHT_LINE = 'Copyright © 2026 ssk-shandm'

/**
 * 更新包下载加速前缀，按顺序尝试，最后始终回退 GitHub 官方地址。
 *
 * 中国大陆直连 GitHub Releases 经常超时，普通用户也不会为此配置代理，
 * 所以默认先走公共镜像。这些镜像都是第三方公益服务，单个可能临时不可用，
 * 因此配置多个按顺序重试；留空数组即完全直连官方地址。
 *
 * 注意：新增镜像域名时，必须同步更新 src-tauri/src/lib.rs 的
 * validate_update_url 白名单，否则下载请求会被 Rust 端拒绝。
 */
export const UPDATE_DOWNLOAD_ACCELERATORS = [
  'https://ghfast.top',
  'https://gh-proxy.com',
] as const
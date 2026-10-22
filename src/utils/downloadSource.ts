/**
 * 更新包下载地址的构建规则。
 *
 * GitHub Releases 的安装包地址在国内经常连不上，因此先尝试加速镜像，
 * 失败再回退到官方地址。这里只做纯字符串处理，便于单独测试。
 *
 * 加速形式：在原始地址前拼接前缀，例如
 *   https://ghfast.top/https://github.com/owner/repo/releases/download/v1/x-setup.exe
 */

/** 允许被加速的 GitHub 资源域名，需与 Rust 端 validate_update_url 保持一致 */
export const GITHUB_ASSET_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
] as const

/** 从 https 地址中取出主机名（小写）；非法地址返回空串 */
export function hostOf(url: string): string {
  const match = /^https:\/\/([^/?#]+)/i.exec(url.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

/** 是否是可以被镜像加速的 GitHub 资源地址 */
export function isGitHubAssetUrl(url: string): boolean {
  const host = hostOf(url)
  return host !== '' && (GITHUB_ASSET_HOSTS as readonly string[]).includes(host)
}

/**
 * 把 GitHub 资源地址包装成加速地址。
 * 非 GitHub 地址或前缀非法时原样返回，避免拼出错误链接。
 */
export function buildAcceleratedUrl(url: string, prefix: string): string {
  const normalizedPrefix = prefix.trim().replace(/\/+$/, '')
  if (!normalizedPrefix || !isGitHubAssetUrl(url)) return url
  return `${normalizedPrefix}/${url.trim()}`
}

/**
 * 生成按优先级排列的下载地址列表：先所有加速镜像，最后官方地址兜底。
 * 官方地址始终保留在末尾，保证镜像全部失败时仍有一次机会。
 */
export function buildDownloadCandidates(url: string, accelerators: readonly string[]): string[] {
  const trimmed = url.trim()
  if (!trimmed) return []
  const candidates: string[] = []
  for (const prefix of accelerators) {
    const accelerated = buildAcceleratedUrl(trimmed, prefix)
    if (accelerated !== trimmed && !candidates.includes(accelerated)) candidates.push(accelerated)
  }
  // 官方地址兜底，同时避免重复
  if (!candidates.includes(trimmed)) candidates.push(trimmed)
  return candidates
}

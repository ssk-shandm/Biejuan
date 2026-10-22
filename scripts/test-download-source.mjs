import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

function loadTs(path) {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  runInNewContext(compiled, { module, exports: module.exports, require })
  return module.exports
}

const {
  buildAcceleratedUrl,
  buildDownloadCandidates,
  hostOf,
  isGitHubAssetUrl,
  GITHUB_ASSET_HOSTS,
} = loadTs('src/utils/downloadSource.ts')

// vm 沙箱产生的数组与宿主 realm 原型不同，用 JSON 比较规避跨 realm 差异
const same = (actual, expected, message) =>
  assert.equal(JSON.stringify(Array.from(actual)), JSON.stringify(expected), message)

const INSTALLER = 'https://github.com/ssk-shandm/Biejuan/releases/download/v0.2.4/biejuan_0.2.4_x64-setup.exe'

test('识别 GitHub 资源主机', () => {
  for (const host of GITHUB_ASSET_HOSTS) {
    assert.equal(hostOf(`https://${host}/a/b-setup.exe`), host)
    assert.equal(isGitHubAssetUrl(`https://${host}/a/b-setup.exe`), true, host)
  }
  assert.equal(isGitHubAssetUrl('https://evil.example.com/a-setup.exe'), false)
  assert.equal(isGitHubAssetUrl('http://github.com/a/b-setup.exe'), false, '必须 https')
  assert.equal(hostOf('not-a-url'), '')
})

test('加速地址在原始地址前拼接前缀', () => {
  assert.equal(
    buildAcceleratedUrl(INSTALLER, 'https://ghfast.top'),
    `https://ghfast.top/${INSTALLER}`,
  )
  // 前缀末尾斜杠需要归一化，避免出现双斜杠
  assert.equal(
    buildAcceleratedUrl(INSTALLER, 'https://ghfast.top/'),
    `https://ghfast.top/${INSTALLER}`,
  )
})

test('非 GitHub 地址或空前缀不加速，避免拼出坏链接', () => {
  const other = 'https://evil.example.com/biejuan-setup.exe'
  assert.equal(buildAcceleratedUrl(other, 'https://ghfast.top'), other)
  assert.equal(buildAcceleratedUrl(INSTALLER, ''), INSTALLER)
  assert.equal(buildAcceleratedUrl(INSTALLER, '   '), INSTALLER)
})

test('候选地址先加速后官方，官方始终兜底', () => {
  const candidates = buildDownloadCandidates(INSTALLER, ['https://ghfast.top'])
  same(candidates, [`https://ghfast.top/${INSTALLER}`, INSTALLER])
  assert.equal(Array.from(candidates).at(-1), INSTALLER, '最后一个必须是官方地址')
})

test('多个加速前缀按顺序排列且去重', () => {
  const candidates = buildDownloadCandidates(INSTALLER, [
    'https://ghfast.top',
    'https://gh-proxy.com',
    'https://ghfast.top',
  ])
  same(candidates, [
    `https://ghfast.top/${INSTALLER}`,
    `https://gh-proxy.com/${INSTALLER}`,
    INSTALLER,
  ])
})

test('没有加速前缀时只有官方地址', () => {
  same(buildDownloadCandidates(INSTALLER, []), [INSTALLER])
})

test('空地址返回空候选，避免发起无效请求', () => {
  same(buildDownloadCandidates('', ['https://ghfast.top']), [])
  same(buildDownloadCandidates('   ', ['https://ghfast.top']), [])
})

test('应用默认配置启用国内加速镜像', () => {
  const appInfo = read('src/config/appInfo.ts')
  assert.match(appInfo, /UPDATE_DOWNLOAD_ACCELERATORS/, '应导出加速前缀配置')
  assert.match(appInfo, /https:\/\/ghfast\.top/, '默认应使用 ghfast.top 加速')
  assert.match(appInfo, /https:\/\/gh-proxy\.com/, '应有备用镜像 gh-proxy.com')
})

test('前端配置的每个加速域名都必须在 Rust 白名单内', () => {
  const appInfo = read('src/config/appInfo.ts')
  const rust = read('src-tauri/src/lib.rs')

  // 取出 UPDATE_DOWNLOAD_ACCELERATORS 数组里的所有地址
  const block = /UPDATE_DOWNLOAD_ACCELERATORS\s*=\s*\[([\s\S]*?)\]/.exec(appInfo)
  assert.ok(block, '未找到 UPDATE_DOWNLOAD_ACCELERATORS 数组')
  const prefixes = [...block[1].matchAll(/'(https:\/\/[^']+)'/g)].map(m => m[1])
  assert.ok(prefixes.length > 0, '加速前缀列表不能为空')

  // 取出 Rust 的 accelerator_hosts 名单
  const hostsBlock = /let accelerator_hosts = \[([^\]]*)\]/.exec(rust)
  assert.ok(hostsBlock, '未找到 Rust 的 accelerator_hosts 名单')
  const allowedHosts = [...hostsBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1])

  for (const prefix of prefixes) {
    const host = hostOf(prefix)
    assert.ok(
      allowedHosts.includes(host),
      `加速域名 ${host} 未加入 Rust validate_update_url 白名单，下载会被拒绝`,
    )
  }
})

test('下载逻辑会逐个尝试候选源并在失败时回退', () => {
  const version = read('src/composables/useVersion.ts')
  assert.match(version, /buildDownloadCandidates/, '应使用候选源构建函数')
  assert.match(version, /UPDATE_DOWNLOAD_ACCELERATORS/, '应读取加速配置')
  assert.match(version, /for \(let index = 0; index < candidates\.length/, '应遍历候选源')
  assert.match(version, /加速源不可用/, '失败切换时应写入终端日志')
})

test('Rust 端放行加速镜像但仍校验内嵌 GitHub 地址', () => {
  const rust = read('src-tauri/src/lib.rs')
  assert.match(rust, /accelerator_hosts/, '应包含加速镜像主机名单')
  assert.match(rust, /ghfast\.top/, '应放行 ghfast.top')
  assert.match(rust, /must embed a full https GitHub URL/, '镜像地址必须内嵌完整 GitHub 地址')
  assert.match(rust, /must point at a supported GitHub asset/, '内嵌地址必须是受支持的 GitHub 主机')
})

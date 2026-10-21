# 别卷：Windows 与 Android 打包指南

仓库根目录保留 [README](../README.md)；本文中的命令均在仓库根目录执行。发行前同步更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src/config/appInfo.ts` 版本号。

版本状态（2026-10-21）：本次补丁版本字段统一为 v0.2.3；发布状态、资产和验证边界见 [v0.2.3 发行说明](RELEASE_NOTES_v0.2.3.md)。真实 Windows 安装、覆盖升级、卸载和重装验收仍待执行，不以自动化结果替代人工验收。

## 环境

- Node.js、npm、Rust 和 Windows 桌面开发依赖（Visual Studio C++ Build Tools、WebView2）。
- 构建 Android 另需 Android SDK/NDK、JDK、Rust Android 目标；首次运行 `npx tauri android init`。
- 私人题库、私人图片和错题数据不包含在正式构建中。前端配置、字体等静态资源内嵌在程序中，安装包不再额外释放 `public` 文件夹。正式版只读写用户资源目录 `%LOCALAPPDATA%/com.exam.assistant/content/`；开发版仍使用项目 `public` 下的题库和图片。

## 检查和 Windows 桌面版

```bash
npm ci
npm run config:check
npm run build
npm run tauri:build -- --bundles nsis
```

安装程序输出为 `src-tauri/target/release/bundle/nsis/别卷_<版本>_x64-setup.exe`；构建目录中的主程序为 `src-tauri/target/release/别卷.exe`。当前不开发或发布真正便携版，独立 EXE 仅作测试，不能把它当作自动更新安装包。

当前独立 EXE 仅用于免安装测试，与安装版使用相同的用户数据目录，不实现 EXE 同目录的便携数据存储。仅生成测试 EXE 可运行 `npm run tauri:build -- --no-bundle`。

## Android APK（arm64）

```bash
npm run icons:android
npx tauri android build --apk --target aarch64 --ci
```

打包前同步 `src-tauri/icons/android/` 图标到生成的 Android 工程（该工程在 `src-tauri/gen/` 下，不纳入 Git）。Android 生产构建输出位于 `src-tauri/gen/android/app/build/outputs/apk/universal/release/`，**未签名 APK 不可直接作为正式版发布**。请用私有发布密钥与 Android SDK 的 `apksigner` 签名、执行 `apksigner verify` 后再上传。不要用 Android 调试密钥签正式包，不要将密钥或口令提交到仓库。

首次发布若创建新发布密钥，请将密钥和密码离线备份并长期保管；后续同一包名的更新需要沿用同一密钥。若更换密钥，用户可能无法覆盖安装旧版。此命令仅构建 arm64（`arm64-v8a`），不兼容仅支持 32 位的设备。

## 发布与检查更新

1. 运行类型检查、测试、Web 构建和 Windows 安装包构建；若发布 Android APK，再完成 Android 构建和有效签名校验，确保声明的资产版本一致。
2. 提交源码并推送；确认 Windows 覆盖升级、卸载保留数据和重装行为后，再创建对应版本标签（本次为 `v0.2.3`）及 GitHub Release，上传发行说明声明的 Windows NSIS 安装包及签名 APK（若发布 Android），不上传测试用独立 EXE。
3. 沿用 `别卷 v<版本>` 标题。从 v0.2.2 开始，后续每次 GitHub Release 正文和对应发行说明统一按 [发布说明模板](RELEASE_TEMPLATE.md) 编写，依次使用 `## 更新摘要`、`## 详细更新`、`## 安装与注意事项` 三个二级标题，不再沿用旧版长篇开发报告格式；可在这些章节下细分三级标题。摘要面向用户说明新增、修复和体验改善，没有新增时不虚构；验证结果放在详细更新，平台要求、备份、限制及校验值放在安装与注意事项。历史发行说明保持原样。
4. Windows 下载资产命名为 `biejuan-<版本>-x64-setup.exe`，记录字节数及 SHA-256；只上传本次构建，不覆盖历史版本资产。尚未完成的人工验收必须在发行说明中明确列出，不标记为已通过。
5. Windows 客户端通过 GitHub Releases 的 latest API 检查新版并查找 `*-setup.exe` 安装包；Android 不会自动安装 Windows 更新。

自动更新仅适用于 NSIS 安装版，不会将 Release 中的便携版 `.exe` 当成安装包运行。安装包保存到用户下载目录（不可用时回退到临时目录），完成下载校验后通过 Windows Shell 启动并请求管理员授权。更新使用 `/UPDATE /P /R`，并通过最后一个 `/D=<当前安装目录>` 参数锁定原安装位置；应用在安装器成功启动后退出，安装成功后由安装器重启。

如果更新后从旧快捷方式启动仍显示旧版本，先检查快捷方式目标是否指向旧便携版或另一份安装。请用 `*-setup.exe` 安装一次，再从安装器生成的快捷方式启动；不要继续启动旧的便携版文件。取消管理员授权或下载失败时不会退出当前应用。

每次发布仍需回归：从旧版安装位置启动 → 自动更新 → 同意管理员授权 → 等待安装器重启 → 确认版本 → 关闭后从同一快捷方式再次启动，确认版本和安装路径均未回退。Release 中声明的资产必须齐全，并验证中文安装包名、取消授权和测试用独立 EXE 的更新限制提示。v0.1 的验收完成记录不代替 v0.2 的升级迁移回归。

首次打开移动端可通过底部导航在「首页」「错题本」等入口切换。请勿将源码中的临时题库、API Key、私有签名材料或未签名产物上传。

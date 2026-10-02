# 别卷：Windows 与 Android 打包指南

仓库根目录保留 [README](../README.md)；本文中的命令均在仓库根目录执行。发行前同步更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src/config/appInfo.ts` 版本号。

## 环境

- Node.js、npm、Rust 和 Windows 桌面开发依赖（Visual Studio C++ Build Tools、WebView2）。
- 构建 Android 另需 Android SDK/NDK、JDK、Rust Android 目标；首次运行 `npx tauri android init`。
- 本地题库和图片不包含在正式构建中；在应用内自行导入。

## 检查和 Windows 桌面版

```bash
npm ci
npm run config:check
npm run build
npm run tauri:build
```

安装程序在 `src-tauri/target/release/bundle/nsis/别卷_<版本>_x64-setup.exe`；便携式程序在 `src-tauri/target/release/别卷.exe`。发布时可将后者另存为带版本号的文件。

## Android APK（arm64）

```bash
npm run icons:android
npx tauri android build --apk --target aarch64 --ci
```

打包前同步 `src-tauri/icons/android/` 图标到生成的 Android 工程（该工程在 `src-tauri/gen/` 下，不纳入 Git）。Android 生产构建输出位于 `src-tauri/gen/android/app/build/outputs/apk/universal/release/`，**未签名 APK 不可直接作为正式版发布**。请用私有发布密钥与 Android SDK 的 `apksigner` 签名、执行 `apksigner verify` 后再上传。不要用 Android 调试密钥签正式包，不要将密钥或口令提交到仓库。

首次发布若创建新发布密钥，请将密钥和密码离线备份并长期保管；后续同一包名的更新需要沿用同一密钥。若更换密钥，用户可能无法覆盖安装旧版。此命令仅构建 arm64（`arm64-v8a`），不兼容仅支持 32 位的设备。

## 发布与检查更新

1. 运行类型检查、Web 构建和两端构建，确认 APK 有效签名、安装包版本一致。
2. 提交源码并推送；创建对应 `v<版本>` 标签及 GitHub Release，上传 Windows NSIS、便携版和签名 APK。
3. Windows 客户端通过 GitHub Releases 的 latest API 检查新版并查找 `*-setup.exe` 安装包；Android 不会自动安装 Windows 更新。

自动更新仅适用于 NSIS 安装版，不会将 Release 中的便携版 `.exe` 当成安装包运行。安装包保存到用户下载目录（不可用时回退到临时目录），完成下载校验后通过 Windows Shell 启动并请求管理员授权。更新使用 `/UPDATE /P /R`，并通过最后一个 `/D=<当前安装目录>` 参数锁定原安装位置；应用在安装器成功启动后退出，安装成功后由安装器重启。

如果更新后从旧快捷方式启动仍显示旧版本，先检查快捷方式目标是否指向旧便携版或另一份安装。请用 `*-setup.exe` 安装一次，再从安装器生成的快捷方式启动；不要继续启动旧的便携版文件。取消管理员授权或下载失败时不会退出当前应用。

发布验收：从旧版安装位置启动 → 自动更新 → 同意管理员授权 → 等待安装器重启 → 确认版本 → 关闭后从同一快捷方式再次启动，确认版本和安装路径均未回退。另验证 Release 同时存在便携版与安装包、中文安装包名、取消授权和便携版启动时的提示。

首次打开移动端可通过底部导航在「首页」「错题本」等入口切换。请勿将源码中的临时题库、API Key、私有签名材料或未签名产物上传。

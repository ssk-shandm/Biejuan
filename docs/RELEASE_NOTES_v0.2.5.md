## 更新摘要
- 修复 Windows 桌面版无法把文件拖入「文档转换」的问题：0.2.4 重新启用了原生拖放接管，导致网页层的拖入事件收不到。
- 拖拽开关改为显式写入窗口配置，并由前端与 Rust 两层回归测试固定，避免以后升级依赖时再次静默失效。

## 详细更新
本次为 v0.2.5 补丁版本，日期：2026-10-23。构建与发布状态见本版本 GitHub Release。

### 拖拽导入回归
- 现象：网页版可以直接把文件拖到「文档转换」，打包成 Windows 安装版后拖入没有反应；v0.2.3 曾修复该问题，v0.2.4 又复现。
- 根因：Windows 上 Tauri 通过 wry 接管 WebView2 的拖放。wry 在启用内部拖放处理器时会调用 `ICoreWebView2Controller4::SetAllowExternalDrop(false)`，HTML5 的 `dragover` / `drop` 事件就永远不会到达页面，文档转换区域自然收不到文件。
- v0.2.3 的修复实际依赖窗口配置中的 `dragDropEnabled: false`，但该项从未写入 `src-tauri/tauri.conf.json`。Tauri 的 `WindowConfig` 对该字段使用 `#[serde(default = "default_true")]`，缺省即 `true`（即启用原生接管）。因此该设置一直处于「默认开启」状态，拖拽能否生效取决于依赖版本与构建路径，v0.2.4 重新构建后即回到失效状态。
- 本次在 `src-tauri/tauri.conf.json` 的主窗口中显式写入 `"dragDropEnabled": false`，把拖放交还网页层。该开关编译进窗口，必须重新构建安装包才能生效，前端代码无法在运行时修改。

### 回归测试
- 前端 `scripts/test-release-baseline.mjs` 新增两项：主窗口必须为 `dragDropEnabled: false`；文档转换区域必须保留 `@drop.prevent` 处理并继续从 `dataTransfer.files` 读取文件，同时保留全局 `drop` 拦截以避免拖到空白处时 WebView 打开文件离开应用。
- Rust `src-tauri/src/lib.rs` 新增 `window_config_disables_native_drag_drop_handler`：用 Tauri 自己的 `tauri::utils::config::Config` 反序列化 `tauri.conf.json`，断言 main 窗口的 `drag_drop_enabled` 为 `false`。这样验证的是 Tauri 实际读取到的值，而不是配置文件里的字面文本。

### 验证
- 配置检查、lint、类型检查、146 项前端与数据测试、20 项 Rust 测试通过。
- Windows x64 NSIS 安装包构建通过，主程序版本号为 0.2.5。
- 项目维护者已确认拖拽导入在 Windows 安装版中正常工作。

## 安装与注意事项
- 发布 Windows x64 NSIS 安装程序，需要 Windows 及 WebView2；不发布便携版 EXE 或 Android APK。安装包未签名，Windows 可能提示未知发布者。
- 拖拽开关编译进窗口配置，必须使用本版本安装包才能生效；0.2.4 及更早版本仍会拦截拖拽。
- 安装前关闭旧版应用，建议先在「题库资源」导出全量备份；沿用应用标识和用户数据目录。卸载时不要选择删除应用数据。
- 本次不改动题库格式、学习数据格式和用户目录，覆盖升级沿用既有数据。
- 安装包不包含本地私人题库、图片、错题数据或开发 API 密钥。

安装包：`biejuan-0.2.5-x64-setup.exe`，6,818,033 字节，约 6.5 MiB。

SHA-256：`1345b89a992822c88aeb12aabb6bf2141914a4336a504d4116125250f088f109`。

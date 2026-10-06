# 别卷

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=white)

别卷是一款面向刷题与错题复习的应用，基于 Vue 3、TypeScript 和 Tauri 2 构建。支持 Windows 桌面端、Android（arm64）和静态 Web 应用。

## 功能

- 提供考试、背题、做题、专项练习和错题模式，支持多错题本、导入导出与备份恢复。
- 支持单选、多选、判断、填空、简答、程序分析、编程和复合题。
- 支持 Markdown、代码高亮、题目图片、Mermaid 和 PlantUML 图表。
- 支持文档转题库：提取 DOCX、PDF、XLSX/XLSM、TXT、Markdown、JSON 和 CSV，并通过可配置的模型转换为题库 JSON。
- 提供深色模式；桌面端将错题数据保存到本地文件，Web 端使用浏览器 localStorage；Android 提供专用移动布局与底部导航。

## 技术栈

| 用途 | 技术 |
| --- | --- |
| 前端 | Vue 3、TypeScript、Pinia、Vite |
| 桌面与 Android 应用 | Tauri 2 |
| 内容展示 | marked、highlight.js、DOMPurify、Mermaid、PlantUML |
| Web 部署 | Docker、Nginx |

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`，以及 npm。
- 桌面端开发和打包需要 Rust 与 Tauri 所需的系统依赖；Windows 打包还需要 Visual Studio C++ Build Tools，运行需要 WebView2。详见 [桌面与 Android 打包指南](docs/TAURI_GUIDE.md)。
- 使用 AI 文档转换需自行配置兼容 OpenAI 接口的模型服务；普通刷题不需要模型服务。

## 快速开始

```bash
npm install
npm run dev
```

在终端显示的地址打开应用。`npm run dev` 会自动生成 `public/subjects/banks.json`。如需启动桌面开发版，执行：

```bash
npm run tauri:dev
```

> 生产构建不会打包仓库中的私人题库和题目图片。发布后可以在应用内导入题库，也可以在桌面端将 JSON 放入实际的题库资源目录。

## 题库

题库 JSON 的根节点是题目数组，例如：

```json
[
  {
    "id": "q-001",
    "number": 1,
    "type": "single",
    "content": "HTTP 的默认端口是什么？",
    "format": "text",
    "options": { "A": "21", "B": "80" },
    "answer": "B",
    "explanation": "HTTP 默认使用 80 端口。"
  }
]
```

新题库建议使用 `single`、`multiple`、`true-false`、`fill`、`short-answer`、`program-analysis`、`code`、`compound` 等稳定题型标识。

桌面端支持直接读取目录中的题库，无须手动编辑 `banks.json`：

1. 在“设置 → 题库资源 → 题库文件”打开可写的题库目录（开发版为仓库的 `public/subjects/`，安装版为当前用户的应用数据目录 `content/subjects/`）。桌面版同时读取安装目录中的内置题库和用户数据目录中的题库。
2. 将 UTF-8 编码的题库 JSON 放入该目录，文件名即列表中的题库名称；`banks.json` 是保留清单，不作为题库加载。
3. 在主页或设置页点击“刷新题库”，也可以重启应用。合法题库自动加入列表；空题库、JSON 语法错误或不符合兼容题库格式的文件会被跳过，刷新完成后弹出文件名和原因。修改或删除文件后再次刷新也会同步更新列表和内容。用户目录中的手动 JSON 和 AI 转换题库可在设置页勾选删除（桌面开发版的仓库题库也可删除）；安装版资源目录中的题库保持只读。删除会移除 JSON 及其关联错题本、错题记录和练习进度，不删除可能共享的图片资源。

`npm run dev` 的本机网页端支持动态扫描目录，刷新即可载入新题库。静态部署网页端仍使用构建清单，新增题库后需运行 `npm run prebuild` 重新生成清单；Android 继续通过应用内导入题库。

详细格式参见 [题库规范](public/config/question-schema.md)和[完整示例](public/config/examples/question-bank.example.json)。题目图片可以随题库放在 `public/images/` 下。

## AI 文档转换与配置

在“设置 → AI 模型配置”中配置模型，在“文档转换”中导入文档。转换过程会提取内容、调用模型并校验题库结构；扫描版 PDF 可使用 OCR，但首次使用可能需要联网下载语言数据。

安装版桌面端在 AI 转换完成后，会自动将 JSON 写入当前用户应用数据目录的 `content/subjects/`，图片写入对应的 `content/images/` 子目录，不再写入需要管理员权限的安装目录。Windows 下默认位于 `%LOCALAPPDATA%/com.exam.assistant/content/`。桌面开发版和本机 `npm run dev` 网页端仍写入仓库的 `public/subjects/` 和 `public/images/`。保存后会刷新并选中新题库，无须下载。转换页面显示实际保存路径；同名题库自动添加序号，不覆盖原文件。已有应用内转换或导入的题库会在刷新时自动迁移到该目录，只有写入成功才移除旧缓存，失败时保留原题库并提示原因。

静态部署网页和 Android 无法直接写入项目的 `public` 目录，仍自动保存到应用内存储，并明确显示保存位置。“备份 JSON / 题库包”仅为可选备份功能。

配置的存储位置因运行方式而异：

| 运行方式 | 配置位置 |
| --- | --- |
| 桌面端 | 系统应用配置目录中的 `llm-config.txt`（文件内容为 JSON） |
| `npm run dev` | 项目根目录的 `config/llm-config.json` |
| Web 生产版 | 当前浏览器的 localStorage |

桌面端 API Key 随“保存连接”写入本地 `llm-config.txt` 的 `provider.apiKey`，重启后自动读取；“清除密钥”也会删除已保存的密钥。Windows 下配置默认位于 `%APPDATA%/com.exam.assistant/llm-config.txt`。**密钥为明文，请勿分享配置文件或提交到仓库。** 网页端仍仅在当前会话的 sessionStorage 中保存密钥。配置字段、示例和校验方式参见 [配置说明](public/config/README.md)；可运行 `npm run config:check` 检查配置。

PlantUML 默认依赖远程服务，可在设置中更换服务地址。涉及敏感题目时，建议使用可信的自建服务；Mermaid 在本地渲染。

## 构建与部署

### Web

```bash
npm run build
npm run preview
```

构建结果位于 `dist/`。也可以使用 Docker 部署：

```bash
docker build -t biejuan .
docker run -d --name biejuan -p 8080:80 biejuan
```

随后访问 `http://localhost:8080`。Web 端的错题数据保存在当前浏览器中，不会自动跨设备同步。

### Windows 桌面端

```bash
npm run tauri:build
```

安装包位于 `src-tauri/target/release/bundle/nsis/`，可执行文件位于 `src-tauri/target/release/别卷.exe`。当前打包目标为 Windows NSIS 安装程序；具体步骤参见 [打包指南](docs/TAURI_GUIDE.md)。

### Android（arm64）

先安装 Android SDK/NDK、JDK 及 Rust Android 目标；首次构建需运行 `npx tauri android init`。

```bash
npm run icons:android
npx tauri android build --apk --target aarch64 --ci
```

Android 的应用图标与桌面端一致，构建前会同步图标资源。正式发布的 APK 需要使用**专用发布密钥签名**，请勿上传调试版或未签名 APK；构建、签名与密钥备份详见 [打包指南](docs/TAURI_GUIDE.md)。Android 端与桌面端数据彼此独立，不会自动跨设备同步；下载安装请查看仓库的 Releases 页面。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Web 开发服务器 |
| `npm run tauri:dev` | 启动桌面开发版 |
| `npm run type-check` | 检查 Vue 与 TypeScript 类型 |
| `npm run lint` | 运行 ESLint 并自动修复 |
| `npm test` | 运行题库、错题持久化、AI 配置和版本一致性回归 |
| `npm run verify` | 配置检查、非改写式 lint、类型检查和自动化测试 |
| `npm run verify:release` | 代码回归、Web 构建、Rust 测试和发布资源检查 |
| `npm run config:check` | 检查配置与示例文件 |
| `npm run build` | 类型检查并构建 Web 生产版 |
| `npm run tauri:build` | 构建桌面程序和安装包 |
| `npm run icons:android` | 同步 Android 图标到生成的工程 |

## 项目结构

```text
src/              前端页面、组件、状态和业务逻辑
src-tauri/        Tauri 桌面端、Android 代码与打包配置
public/config/    题库格式、运行时配置和示例
public/subjects/  开发环境使用的本地题库
public/images/    开发环境使用的题目图片
config/           开发环境的本地模型配置
scripts/          题库清单生成与构建辅助脚本
docker/           Nginx 配置
docs/             架构、设计、AI 转换及双端打包文档
```

更多实现细节参见 [架构说明](docs/ARCHITECTURE.md)和[设计文档](docs/DESIGN.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 支持项目

如果这个项目对你有帮助，欢迎在 GitHub 仓库点一个 **Star**。你的支持会帮助项目持续改进！

## 版本收尾与后续计划

当前发布版本为 [v0.1.6](docs/RELEASE_NOTES_v0.1.6.md)（2026-10-06），作为 v0.1 的数据保护与发布安全收尾补丁。进入 v0.2 前请查看 [v0.1 收尾清单](docs/V0.1_CLOSEOUT.md)；后续功能与验收标准见 [产品路线与 TODO](docs/ROADMAP_0.2_TO_1.0.md)。错题本备份不等同于包含题库、图片与练习进度的全量备份。

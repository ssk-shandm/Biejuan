# 刷题助手架构说明与重构诊断

> 当前实现说明与重构背景：2026-10-05
>
> 本文以当前代码为准；早期诊断只用于解释迁移原因。

## 1. 架构原则

项目采用本地优先的 Vue 3 + TypeScript + Vite + Tauri 2 架构，核心原则如下：

- 外部题库 JSON 只在 `questionSchema.ts` 入口兼容、校验和规范化，业务组件只处理稳定结构。
- 富文本、代码、Mermaid 和 PlantUML 统一经过 `MarkdownContent.vue` 安全渲染。
- Web、Tauri 桌面端和 Android 的平台差异收敛到 composable、服务层和 Rust 命令。
- 内置资源与用户资源分离；安装目录只读，用户数据写入应用数据目录。
- API Key、个人题库、错题数据和构建临时目录不进入发布资源或版本控制。

## 2. 当前架构

```text
内置资源：$RESOURCE/public/subjects/*.json（只读）
用户资源：%LOCALAPPDATA%/com.exam.assistant/content/subjects/*.json（可写）
        │
        ▼
questionSchema.ts ── 校验、兼容、补默认值、规范化
        │
        ▼
useQuiz.ts ───────── 答题状态、筛选、判分、session
        │
        ├── QuestionDisplay / CompoundQuestion / ResultDisplay
        │          └── MarkdownContent.vue
        │                 ├── marked + highlight.js
        │                 ├── DOMPurify
        │                 ├── Mermaid（按需加载）
        │                 └── PlantUML（可配置远程 SVG 服务）
        │
        ├── questionBankConverter.ts
        │          └── analyze → convert → answer-match → repair
        │
        └── quizStore.ts ── 错题本与学习记录
                   ├── Web：localStorage 单文档
                   └── Tauri：应用数据目录 quiz-data.json
```

### 关键边界

- `src/utils/questionSchema.ts`：外部 JSON 的唯一规范化入口。
- `src/components/MarkdownContent.vue`：富文本和图表的唯一渲染入口。
- `src/stores/quizStore.ts`：错题本持久化的唯一入口。
- `src/composables/useQuiz.ts`：答题 session 和判分的唯一拥有者。
- `src/services/publicBankStorage.ts`：题库清单、读取和删除权限的前端边界。
- `src-tauri/src/lib.rs`：桌面端用户目录、内置目录和文件命令的安全边界。
- `scripts/generate-banks.mjs`：开发题库清单的生成入口。

## 3. 题库 JSON

新题库统一使用稳定英文题型标识：

```text
single
multiple
true-false
fill
short-answer
program-analysis
code
compound
```

推荐单题结构：

```json
{
  "id": "q-001",
  "number": 1,
  "type": "single",
  "content": "题干，可使用 Markdown",
  "format": "markdown",
  "options": { "A": "选项 A", "B": "选项 B" },
  "answer": "A",
  "explanation": "解析"
}
```

加载器进入业务层前会完成：

- `content` 与旧字段 `question` 的兼容；
- 英文稳定标识与旧中文题型映射；
- 缺省字段补全；
- 判断题答案和多选数组归一化；
- 子题结构归一化；
- 非法结构、未知题型和重复题号校验。

字段规范和完整示例：

- `public/config/question-schema.md`
- `public/config/examples/question-bank.example.json`

## 4. LLM 题库转换

`public/config/llm/framework.json` 定义供应商无关的转换流水线，Prompt 位于 `public/config/llm/prompts/`，机器校验规则位于 `public/config/schemas/`。

`src/services/questionBankConverter.ts` 和 `src/services/llmClient.ts` 已接入真实的 OpenAI 兼容接口，当前流程为：

```text
本地提取文件 → analyze → convert → 本地合并去重
             → answer-match → Schema 校验 → repair → 保存
```

模型负责理解文档结构；本地程序负责分段、并发、按行合并、答案关联、图片路径处理和 Schema 校验。Windows/Tauri 桌面端用户配置写入：

```text
%APPDATA%/com.exam.assistant/llm-config.txt
```

Web 生产版只在当前会话使用 `sessionStorage`。API Key 不得进入 `public/`、题库 JSON、日志或版本控制。

## 5. Markdown 与图表

### 安全链路

1. 提取 Mermaid/PlantUML fenced code block 为占位符；
2. 普通 Markdown 由 `marked` 解析；
3. HTML 由 DOMPurify 清洗；
4. Mermaid 或 PlantUML 生成的 SVG 再次清洗；
5. 仅 `MarkdownContent.vue` 输出经过清洗的 `v-html`。

Mermaid 在题目实际包含图表时按需加载。PlantUML 默认可能把源码发送到远程服务，敏感题目应配置可信服务或禁用该功能。

## 6. 数据与持久化

### 答题 session

练习进度、乱序偏好和当前题库等临时 UI 状态由 `useQuiz.ts` 按题库写入 `localStorage`。这部分不是错题本主数据。

### 错题本

`quizStore.ts` 将错题本、错题记录、活跃笔记本和猜题记录序列化为一个文档：

| 平台 | 存储位置 |
| --- | --- |
| Web | `localStorage` 单文档 |
| Tauri | 应用数据目录中的 `quiz-data.json` |

旧 localStorage key 只用于一次性迁移，不再使用 Vite `/api/wrong-notebooks/sync`、`public/wrong-notebooks/*.json` 或多文件 Tauri 错题本目录。

## 7. 资源目录与题库生成

### 内置资源

开发环境扫描 `public/subjects/` 和 `public/images/`。`scripts/generate-banks.mjs` 生成 `public/subjects/banks.json`。正式构建前由 `scripts/prepare-public-build.mjs` 清理私人题库、图片和错题数据，只保留脱敏资源、配置和空目录占位。

### 用户资源

正式安装版将用户资源写入：

```text
%LOCALAPPDATA%/com.exam.assistant/content/subjects/
%LOCALAPPDATA%/com.exam.assistant/content/images/
```

Rust 后端同时扫描内置目录和用户目录，并返回 `deletable` 标志：内置题库只读，用户手动放置、应用导入和 AI 生成题库可删除。应用不会向 `Program Files` 写入用户数据。

### 常用命令

```bash
npm run prebuild
npm run type-check
npm run config:check
npx eslint src --no-cache
npm run build-only
cargo check --manifest-path src-tauri/Cargo.toml --release
```

## 8. 目录维护策略

应纳入版本控制：

- `src/`、`src-tauri/`、`scripts/` 中的正式代码；
- `public/config/` 的运行时配置、样例和 Schema 文档；
- 版本明确包含的脱敏内置题库与 `banks.json`；
- Docker/Tauri 构建配置和 `docs/`。

不应作为正式架构依赖或提交到 Git：

- `.tmp-*`、`tmp/`、`tmp_docx/`、`.tmp-build/` 等临时目录；
- 个人测试脚本、一次性转换产物、个人题库和图片；
- `dist/`、`node_modules/`、Rust 构建缓存；
- 运行时用户错题数据、LLM 配置和签名材料。

## 9. 维护检查

```bash
npm run type-check
npm run config:check
npx eslint src --no-cache
npm run prebuild
npm run build-only
cargo check --manifest-path src-tauri/Cargo.toml --release
```

新增题库时检查：

- 根节点为非空数组，题号唯一；
- 使用稳定英文 `type`，内容和解析的 Markdown 格式明确；
- 图片使用部署无关路径，不写入开发机绝对路径；
- 不包含 API Key、个人隐私或不应发送到 PlantUML 服务的敏感信息；
- 运行 `npm run prebuild` 更新开发清单。

## 10. 后续演进

后续优先级以 [ROADMAP_0.2_TO_1.0.md](ROADMAP_0.2_TO_1.0.md) 为准，重点是数据迁移、备份恢复、导入预览、稳定题目 ID、性能基线和发布验收，不以继续堆叠页面数量作为版本完成标准。

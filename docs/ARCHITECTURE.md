# 刷题助手架构说明与重构诊断

> 最近诊断与重构：2026-09-20

## 1. 本轮诊断结论

重构前的主要问题不是 Vue/Tauri 技术栈本身，而是同一职责存在多套实现：

1. **题库格式分裂**：中文题型、英文别名、`question/content`、多个格式字段并存，业务组件重复兼容。
2. **Markdown 渲染分散且不安全**：多个组件直接使用 `v-html`，缺少统一清洗入口，也无法一致扩展图表。
3. **错题本持久化链路过长**：Tauri 文件、Vite 开发中间件、`public/wrong-notebooks` 与多个 localStorage key 并存。
4. **Vite 配置承担后端职责**：开发服务器内嵌错题同步 API，增加维护和 Docker/Tauri 行为差异。
5. **构建输入不一致**：DOCX 转换输出位置与题库清单扫描目录不一致，Docker 构建也没有先生成清单。
6. **依赖和文件噪声**：存在已不参与运行路径的直接依赖、临时目录和历史兼容代码。
7. **文档失真**：旧文档仍描述已移除的 Vite 同步 API、旧题型标识和多层存储策略。

本轮采用的原则是：**外部输入只在边界兼容一次，内部只处理规范化结构；浏览器和桌面端各保留一个明确持久化落点；所有富文本只走一个安全组件。**

## 2. 当前架构

```text
public/subjects/*.json
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
        │                 ├── Mermaid（浏览器本地、按需加载）
        │                 └── PlantUML（可配置远程 SVG 服务）
        │
        └── quizStore.ts ── 错题本
                   ├── Web：单个 localStorage 文档
                   └── Tauri：appData/quiz-data.json
```

### 关键边界

- `src/utils/questionSchema.ts`：外部 JSON 的唯一规范化入口。
- `src/components/MarkdownContent.vue`：富文本和图表的唯一渲染入口。
- `src/stores/quizStore.ts`：错题本持久化的唯一入口。
- `src/composables/useQuiz.ts`：答题 session 和判分的唯一拥有者。
- `scripts/generate-banks.mjs`：题库清单的唯一生成入口。

## 3. 题库 JSON

新题库统一使用稳定英文标识：

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

加载器会在进入业务层前完成：

- `content` 与旧字段 `question` 的兼容；
- 英文稳定标识与旧中文题型的映射；
- 缺省字段补全；
- 判断题答案归一化；
- 多选数组答案归一化；
- 子题结构归一化；
- 非法结构、未知题型和重复题号校验。

格式与完整示例：

- `public/config/question-schema.md`
- `public/config/examples/question-bank.example.json`

## 4. LLM 题库转换配置

`public/config/llm/framework.json` 定义供应商无关的转换流水线，预装 Prompt 位于 `public/config/llm/prompts/`，机器校验规则位于 `public/config/schemas/`。用户 API、模型和隐私开关使用独立用户配置，真实密钥不得进入 `public/` 或版本控制。

当前阶段只提供配置、Prompt、Schema 和 `scripts/lib/llm-config.mjs` 加载器；网络请求和设置页面将在后续实现。模型输出必须先通过题库 Schema 与现有 `questionSchema.ts` 规范化，再允许写入题库目录。

## 5. Markdown 与图表

### 安全链路

1. 图表 fenced code block 先被提取为占位符；
2. 普通 Markdown 由 `marked` 解析；
3. HTML 由 DOMPurify 清洗；
4. Mermaid 生成的 SVG 再次由 DOMPurify 清洗；
5. 组件中仅 `MarkdownContent.vue` 保留经过清洗的 `v-html`。

### Mermaid

使用 `mermaid` fenced code block。Mermaid 只在题目实际包含 Mermaid 时动态导入，避免主入口同步加载整个图表库。

### PlantUML

使用 `plantuml` 或 `puml` fenced code block。运行时配置位于：

```text
public/config/diagram-renderer.json
```

默认配置会把源码发送到 PlantUML 官方服务器生成 SVG。敏感题目应配置可信自建服务，或将 `plantUml.enabled` 设为 `false`。

## 6. 数据与持久化

### 答题 session

练习进度、乱序偏好和当前题库等临时状态仍由 `useQuiz.ts` 按题库写入 localStorage。这些数据属于 UI session，不是错题本主数据。

### 错题本

`quizStore.ts` 将错题本、错题记录、活跃笔记本和猜题记录序列化为一个文档：

- Web：localStorage；
- Tauri：系统应用数据目录中的 `quiz-data.json`。

保留旧 localStorage key 的一次性迁移，但不再使用：

- Vite `/api/wrong-notebooks/sync` 中间件；
- `public/wrong-notebooks/*.json`；
- 多文件 Tauri 错题本目录。

## 7. 构建与题库生成

题库文件位于 `public/subjects/`。`scripts/generate-banks.mjs` 扫描该目录并生成 `public/subjects/banks.json`。

```bash
npm run prebuild
npm run build
```

- `npm run dev` 会通过 `predev` 自动生成清单；
- `npm run build` 会通过 npm 生命周期自动运行 `prebuild`；
- Dockerfile 显式执行 `npm run prebuild && npm run build-only`；
- `scripts/convert-docx.mjs` 现在也输出到 `public/subjects/`。

## 8. 目录维护策略

应纳入版本控制：

- `src/`、`src-tauri/`、`scripts/` 中的正式脚本；
- `public/subjects/` 题库与 `banks.json`；
- `public/config/` 的运行时配置、样例和 schema 文档；
- Docker/Tauri 构建配置。

不应作为正式架构依赖：

- `tmp/`、`tmp_docx/`、临时构建目录；
- 个人测试脚本和一次性转换产物；
- `dist/`、`node_modules/`；
- 运行时用户错题数据。

是否删除现有未跟踪脚本应由维护者确认；重构不能把可能仍有用的本地工具当作垃圾直接删除。

## 9. 维护检查

```bash
npx vue-tsc --noEmit -p tsconfig.app.json
npx eslint . --no-cache
npm audit
npm run prebuild
npm run build-only
```

新增题库时检查：

- 根节点为数组；
- `number` 唯一；
- 新文件优先使用稳定英文 `type`；
- Markdown 内容显式写 `"format": "markdown"`；
- PlantUML 内容不包含不能发送到所配置服务器的敏感数据；
- 执行 `npm run prebuild` 更新题库清单。

## 10. 后续可选优化

- 若 Mermaid 产物体积仍不可接受，可限制支持的图类型或把图表渲染拆成独立页面/Worker；当前已经按需加载，不影响无图表页面的主入口同步体积。
- 可为 `questionSchema.ts` 增加单元测试，覆盖旧题库迁移、错误输入和复合题。
- 可把个人转换脚本迁移到 `scripts/local/` 并统一加入 `.gitignore`，在确认用途后再清理根目录。
- PlantUML 如需完全离线，应部署本地 PlantUML Server，而不是在前端引入 Java 运行时。

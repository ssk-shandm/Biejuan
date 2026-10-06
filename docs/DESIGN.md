# 刷题助手项目设计文档

> 文档版本：1.0  
> 生成日期：2026-09-19  
> 适用项目：Vue 3 + TypeScript + Vite + Tauri 2 刷题助手

## 1. 文档目的

本文档描述刷题助手的产品目标、系统边界、模块职责、核心数据结构、主要业务流程、Web/桌面双端策略及质量要求。它用于指导功能开发、代码评审、测试验收和后续重构。

具体实现诊断与目录维护原则另见 `ARCHITECTURE.md`；题库字段规范另见 `../public/config/question-schema.md`。

## 2. 产品定位

刷题助手是一个以本地题库为主、同时支持 Web 与 Tauri 桌面运行的学习应用。系统围绕“选择题库—选择模式—作答—判分—回顾—沉淀错题”的闭环设计。

### 2.1 核心目标

1. 支持多题型题库及统一的 JSON 题库格式。
2. 支持考试、做题、背题、专项练习和错题管理。
3. 在 Web 与桌面端保持一致的答题体验。
4. 允许 Markdown、代码高亮、Mermaid 和 PlantUML 内容安全渲染。
5. 将答题会话和错题数据分层持久化，避免业务组件直接操作存储。
6. 为题库和题目图片提供明确、可发现的资源位置。

### 2.2 非目标

当前版本不承担以下职责：

- 多用户账号、云端同步和权限系统；
- 在线协作编辑题库；
- 服务端自动判定开放式简答题；
- 在运行时修改已打包的内置题库清单；
- 代替完整的题库内容管理后台。

## 3. 技术与运行平台

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| UI | Vue 3、单文件组件 | 页面、组件、交互与响应式状态 |
| 语言 | TypeScript | 类型约束和领域模型 |
| 状态 | Composition API、Pinia | 答题会话与错题本状态 |
| 构建 | Vite | Web 开发、静态资源和生产构建 |
| 桌面壳 | Tauri 2、Rust | 桌面窗口、系统目录和原生能力 |
| 富文本 | marked、highlight.js、DOMPurify | Markdown、代码高亮和 HTML 清洗 |
| 图表 | Mermaid、PlantUML | 本地/远程图表渲染 |

### 3.1 Web 版

Web 版以静态站点方式运行。题库和图片由部署站点的 `subjects/`、`images/` 路径提供。浏览器不能直接打开服务器文件系统，因此设置页会打开当前部署随包提供的题库清单或图库说明页面，不依赖外部网络。

### 3.2 桌面版

桌面版使用 Tauri 2：

- 开发环境的内置资源位于 `public/subjects/` 和 `public/images/`；
- 正式构建由 `scripts/prepare-public-build.mjs` 清理私人题库、图片和错题数据，只把脱敏资源放入安装包；
- 安装版用户资源位于 `%LOCALAPPDATA%/com.exam.assistant/content/subjects/` 和 `%LOCALAPPDATA%/com.exam.assistant/content/images/`；
- 设置页按钮在 Tauri 开发版打开项目 `public` 子目录，在安装版打开用户 `content` 子目录；
- 安装目录中的内置资源只读。用户手动放置、应用导入和 AI 转换生成的资源必须写入用户目录。

## 4. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│                    Vue 页面与组件                         │
│ StartScreen / Settings / Quiz / Review / Wrong Manager  │
└───────────────────────┬──────────────────────────────────┘
                        │ props / emits / composables
┌───────────────────────▼──────────────────────────────────┐
│                    应用业务层                             │
│ useQuiz：题库、会话、判分、模式切换                       │
│ quizStore：错题本、猜对标记、持久化                       │
│ useVersion/useDarkMode/useToast：通用应用能力             │
└──────────────┬───────────────────────┬───────────────────┘
               │                       │
┌──────────────▼─────────────┐  ┌──────▼───────────────────┐
│ 数据与渲染边界             │  │ 平台适配层               │
│ questionSchema             │  │ openExternal             │
│ MarkdownContent            │  │ openContentLocation      │
│ diagramConfig              │  │ Tauri commands/plugins   │
└──────────────┬─────────────┘  └──────┬───────────────────┘
               │                       │
┌──────────────▼───────────────────────▼───────────────────┐
│ public 静态资源 / localStorage / Tauri appData/resource │
└──────────────────────────────────────────────────────────┘
```

### 4.1 设计原则

- **边界规范化**：外部题库只在 `questionSchema.ts` 中兼容和校验一次。
- **单一职责**：业务组件不直接实现 Markdown 清洗、文件系统或持久化逻辑。
- **平台隔离**：Web 与 Tauri 的差异收敛到工具函数和 Rust 命令。
- **渐进增强**：Web 无法使用原生文件管理器时提供可用的仓库目录回退。
- **安全默认**：外部 HTML 统一清洗，外链仅允许 HTTP(S)，原生命令只接受白名单位置。

## 5. 页面与导航设计

### 5.1 页面状态

`AppMode` 表示应用当前页面或答题模式：

```text
start
├── practice
├── endorse
├── exam ──提交──> review
├── specialize
├── wrong
├── wrong-manage
└── settings ──> about
```

### 5.2 首页

首页负责：

- 选择当前题库；
- 进入考试、背题、做题、专项练习、错题和设置；
- 展示题库加载或格式错误。

题库导入按钮已从首页移除。题库资源位置改由设置页统一提供，减少首页非核心操作。

### 5.3 设置页

设置页包含：

1. 应用版本与更新检查；
2. 题库位置和题库图库入口；
3. PlantUML Server 地址；
4. 关于页面入口。

资源按钮的平台行为：

| 操作 | Web | Tauri 开发版 | Tauri 安装版 |
| --- | --- | --- | --- |
| 打开题库位置 | 打开当前部署的 `subjects/banks.json` | 打开项目 `public/subjects` | 打开安装资源 `public/subjects` |
| 打开题库图库 | 打开当前部署的 `images/README.md` | 打开项目 `public/images` | 打开安装资源 `public/images` |

按钮执行期间禁用重复点击，并在卡片内显示成功或错误反馈。

## 6. 题库资源设计

### 6.1 目录约定

```text
public/
├── subjects/
│   ├── banks.json
│   └── *.json
├── images/
│   └── ...题目图片
└── config/
    ├── diagram-renderer.json
    ├── question-schema.md
    ├── examples/              # 题库、DOCX、版本和 LLM 用户配置示例
    ├── schemas/               # 题库与 LLM 用户配置 JSON Schema
    └── llm/
        ├── framework.json
        └── prompts/           # 预装转换/修复 Prompt
```

### 6.2 题库清单

开发环境中，`scripts/generate-banks.mjs` 扫描 `public/subjects/` 下的 UTF-8 JSON，排除 `banks.json` 后生成题库清单。开发和构建流程通过 `predev`、`prebuild` 自动执行该脚本；正式构建前由 `scripts/prepare-public-build.mjs` 清理私人题库、图片和错题数据。

新增题库的标准流程：

1. 将题库 JSON 放入 `public/subjects/`；
2. 将题目图片放入 `public/images/`；
3. 执行 `npm run prebuild` 更新 `banks.json`；
4. 执行类型检查和生产构建；
5. Web 版重新部署，桌面版重新构建安装包。

### 6.3 题库数据模型

规范化后的主要结构：

```ts
interface Question {
  id: string
  number: number
  type: QuestionType
  question: string
  answer: string
  options: Record<string, string>
  images: string[]
  explanation?: string
  format?: string
  subQuestions?: SubQuestion[]
}
```

推荐使用稳定英文题型：

```text
single, multiple, true-false, fill,
short-answer, program-analysis, code, compound
```

加载边界负责兼容旧中文题型、旧字段名和历史答案格式；进入组件后只使用规范化对象。

### 6.4 图片引用

题库中的图片应使用部署无关的站点路径，例如：

```json
{
  "images": ["/images/network/topology-01.png"]
}
```

禁止把开发机绝对路径写入题库。文件名应保持稳定，避免仅使用无语义序号。

## 7. 答题业务设计

### 7.1 会话状态

`useQuiz.ts` 持有：

- 当前题库和题目集合；
- 当前模式、当前题目索引；
- 用户答案与判分结果；
- 乱序、专项筛选和考试提交状态；
- 会话恢复和题库切换逻辑。

`answerSheet` 以题目编号为键，保存：

```ts
{
  userAnswer: UserAnswer
  isCorrect: boolean | null
  subAnswers?: Map<number, SubAnswer>
}
```

`null` 表示主观题不执行自动正确/错误判定。

### 7.2 判分规则

- 单选、判断、填空按规范化答案比较；
- 多选按标准化选项集合比较；
- 复合题逐子题记录结果并汇总；
- 简答题显示“参考回答”，不显示强制的红色“回答错误”；
- 考试模式在提交前不暴露正确答案和解析。

### 7.3 回顾模式

考试提交后进入回顾模式：

- 答题卡保留原试卷题号；
- “只看错题”同时筛选题目区域和答题卡；
- 答题卡序号跳转到对应原题；
- 答题卡收起时采用固定宽度裁切，不压缩序号按钮；
- 桌面布局中做题区保持 `max-width: 800px`，答题卡展开/收起主要改变水平位置；
- 简答题使用中性参考答案样式。

## 8. 错题本设计

`quizStore.ts` 是错题本数据的唯一入口，负责：

- 错题本创建、重命名、删除和切换；
- 添加、删除和批量导入错题；
- 猜对标记；
- Web/Tauri 持久化差异；
- 旧数据迁移。

持久化策略：

| 平台 | 存储位置 |
| --- | --- |
| Web | localStorage 中的单文档 |
| Tauri | 应用数据目录下的 `quiz-data.json`；题库和图片另存于 `content/subjects`、`content/images` |

答题会话属于临时 UI 状态，错题本属于用户主数据，两者不应混用同一个存储入口。

## 9. 富文本与图表设计

### 9.1 Markdown 安全链路

1. 识别并提取 Mermaid/PlantUML fenced code block；
2. 使用 `marked` 解析普通 Markdown；
3. 使用 DOMPurify 清洗 HTML；
4. 图表渲染后再次清洗 SVG；
5. 仅由 `MarkdownContent.vue` 输出经过清洗的 `v-html`。

### 9.2 Mermaid

Mermaid 在浏览器本地按需加载。普通题库不应同步承担 Mermaid 完整体积。

### 9.3 PlantUML

PlantUML 源码可能发送到设置中的远程 Server。包含敏感信息的题目应使用可信自建服务，或在运行时配置中禁用 PlantUML。

## 10. 平台适配设计

### 10.1 资源目录与导入

题库新增流程按运行环境区分：

- 开发环境：将 UTF-8 JSON 放入 `public/subjects/`，图片放入 `public/images/`，然后运行 `npm run prebuild` 刷新清单；
- 安装版：将题库和图片放入设置页打开的用户 `content/subjects/`、`content/images/`；
- 应用内导入和 AI 转换：由应用自动保存到当前环境的可写资源目录。

内置题库来自安装资源目录，列表中的 `deletable` 标志决定是否允许删除；不要通过修改安装目录来管理用户题库。

### 10.2 外部链接

`openExternal.ts` 只允许 HTTP(S) 链接：

- Web 使用 `window.open`；
- Tauri 使用 shell plugin。

### 10.3 内容目录

`openContentLocation.ts` 负责运行时分流，Rust 命令 `open_content_location` 负责桌面端目录白名单和系统文件管理器调用。

Rust 命令只接受：

```text
subjects
images
```

不接受任意用户路径，从而避免该命令演变为通用的本地路径打开接口。

### 10.4 打包资源

`src-tauri/tauri.conf.json` 将：

```text
../public/subjects/ -> $RESOURCE/public/subjects
../public/images/   -> $RESOURCE/public/images
```

打包副本用于“查看内置资源”。它不是运行时在线编辑系统；正式修改仍应回到项目源目录并重新构建。

## 11. 性能设计

- 长题目列表只渲染当前题附近的题目组件，其余使用轻量占位；
- `AnswerCard` 预计算按钮状态，避免模板渲染期间反复查询 store；
- 回顾题目使用 `content-visibility: auto` 降低长页面布局成本；
- Mermaid 仅在实际需要时动态导入；
- 题库切换时缓存必要的规范化结果和会话状态。

## 12. 错误处理与反馈

错误分为四层：

1. **输入错误**：题库 JSON 解析、schema 校验失败；
2. **业务错误**：题库为空、目标题目不存在、答案状态异常；
3. **平台错误**：文件管理器、Tauri 命令、浏览器弹窗失败；
4. **外部服务错误**：版本检查、PlantUML Server 请求失败。

处理原则：

- 可恢复错误使用 Toast 或卡片内状态提示；
- 页面级加载错误保留返回首页或重新选择题库的路径；
- 日志记录技术细节，用户提示使用可理解文本；
- 异步按钮执行时避免重复提交。

## 13. 安全设计

- Markdown 和图表 SVG 必须经过 DOMPurify；
- 外部链接协议限制为 HTTP(S)；
- 桌面目录命令使用固定白名单，不拼接任意外部路径；
- Tauri capability 按最小权限维护；
- 题库 JSON 被视为不可信输入，进入业务层前必须规范化；
- 不在题库、配置或源码中保存令牌、密码等敏感信息。

## 14. 构建与发布

### 14.1 Web

```bash
npm install
npm run type-check
npm run build
```

生产文件输出到 `dist/`，可由静态服务器或 Docker 提供。

### 14.2 Tauri

```bash
npm run tauri:dev
npm run tauri:build -- --bundles nsis
```

Tauri 构建前会执行前端构建，并将题库和图库作为桌面资源复制。

### 14.3 发布前检查

```bash
npm run type-check
npx eslint . --no-cache
npm run prebuild
npm run build-only
cargo check --manifest-path src-tauri/Cargo.toml
```

同时应检查：

- Web 和桌面设置页两个资源按钮；
- 题库清单与实际 JSON 文件一致；
- 题目图片不存在 404；
- 考试提交、错题筛选和答题卡跳转；
- localStorage 和 Tauri appData 的旧数据迁移。

## 15. 验收标准

### 15.1 设置页资源入口

- 设置页存在“打开题库位置”和“打开题库图库”两个按钮；
- Web 点击后打开当前部署携带的离线资源，不访问 GitHub 等外部网站；
- Tauri 开发版点击后打开项目 `public` 下对应目录；
- Tauri 安装版点击后打开安装位置对应的 `public` 资源目录；
- 不支持的位置参数会被 Rust 命令拒绝；
- 执行成功和失败均有明确反馈。

### 15.2 首页

- 首页不再显示“导入题库”按钮；
- 题库选择和所有答题模式仍可正常进入；
- 移动端布局没有因按钮删除留下多余分隔区域。

### 15.3 构建

- Vue TypeScript 检查通过；
- ESLint 检查通过；
- Vite 生产构建通过；
- Rust `cargo check` 通过；
- Tauri 配置可以解析并包含题库、图库资源映射。

## 16. 后续演进

1. 若需要用户直接向安装版添加题库，应设计独立的用户题库目录，并让 Rust 扫描目录后返回清单；不要直接写安装目录。
2. 若 Web 版需要本地题库编辑，可评估 File System Access API，并提供不支持浏览器的降级策略。
3. 为 `questionSchema.ts` 增加自动化测试，覆盖旧格式迁移、重复题号和复合题。
4. 为考试回顾、错题本迁移和平台适配函数增加端到端测试。
5. 将大体积图表渲染继续拆分为独立异步 chunk，控制首次加载体积。


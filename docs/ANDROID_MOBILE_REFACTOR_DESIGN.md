# 《别卷》Android 移动端重构设计文档

**版本：v1.0**
**日期：2026 年 9 月 27 日**
**适用项目：`ssk-shandm/exam`**
**目标平台：Windows 桌面端 + Android APK**
**核心方案：Tauri 2 + Vue 3 移动端独立布局**

> **实现状态（2026 年 9 月 27 日）**：阶段 1–6 的主要移动端代码已完成，阶段 7 已建立统一文件读取服务与应用私有目录适配；Windows 桌面端已完成构建验证。阶段 8 的 Android Gradle/APK 构建与真机验证仍受本机 Android 依赖缓存和设备环境影响，尚未宣称完成。

当前验证记录：`npm run type-check`、`npm run build`、`npm run config:check`、定向 ESLint、`cargo fmt -- --check`、`cargo check` 和 `npm run tauri:build` 均通过。Android `assembleDebug` 已进入 Gradle 构建，但因本机 Java TLS 证书链无法从 Maven Central/GitHub 下载 `kotlin-compiler-embeddable:2.0.21` 而失败；这属于构建环境依赖问题，尚未进行真机测试。

> **2026-09-28 补充验证**：此前 Android 依赖问题已解决；Android arm64 调试 APK 构建通过，Windows v0.1.2 NSIS 安装包构建通过。原文为阶段性记录，后续发布与签名流程以 [打包指南](TAURI_GUIDE.md) 为准；不将本次构建等同于全部机型的真机验收。

---

## 一、项目背景

当前项目已经具备以下技术基础：

```text
Vue 3
TypeScript
Vite
Pinia
Tauri 2
Rust
marked
highlight.js
DOMPurify
Mermaid
Tesseract.js
JSZip
Mammoth
PDF.js
```

当前主要功能包括：

- 题库选择；
- 考试模式；
- 练习模式；
- 背题模式；
- 专项练习；
- 错题本管理；
- 题库导入、导出和备份；
- DOCX、PDF、XLSX、TXT、Markdown、JSON、CSV 文档转换；
- AI 生成题库；
- 自定义题库名称和题目名称；
- Markdown、代码高亮、Mermaid、PlantUML；
- AI 模型配置；
- 配置文件重新读取；
- Windows 桌面端 EXE。

当前 `App.vue` 承担了较多职责，包括页面状态切换、题库加载、做题流程、考试流程、错题本管理、组件组装和全局事件处理。

之前尝试使用响应式 CSS 兼容手机端后发现，虽然页面可以显示，但成型后需要大量调整：

- 按钮位置需要重新安排；
- 桌面工具栏不适合手机；
- 侧边栏不适合竖屏；
- 题目页面操作密度过高；
- 设置页面内容过长；
- 文档转换页面在移动端布局不合理；
- 修改移动端时容易影响 Windows 桌面端。

因此，本次不再采用“桌面页面缩小适配手机”的方案。

---

## 二、核心设计结论

### 2.1 总体方案

采用：

```text
同一套业务逻辑
+
同一套数据模型
+
同一套状态管理
+
桌面端独立 UI
+
Android 独立 UI
```

整体结构：

```text
                    ┌─────────────────────┐
                    │  共享业务逻辑层       │
                    │                     │
                    │ 题库处理             │
                    │ AI 转换             │
                    │ 配置管理             │
                    │ 做题状态             │
                    │ 错题本              │
                    │ 文档解析             │
                    │ 文件服务             │
                    └─────────┬───────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
      ┌─────────▼─────────┐       ┌─────────▼─────────┐
      │ Windows 桌面 UI     │       │ Android 移动 UI   │
      │ DesktopShell        │       │ MobileShell       │
      │ 桌面侧边栏           │       │ 移动底部导航       │
      │ 多栏布局             │       │ 单栏布局           │
      │ 桌面工具栏           │       │ 移动操作栏         │
      │ 桌面弹窗             │       │ 移动抽屉/底部弹层   │
      └─────────┬─────────┘       └─────────┬─────────┘
                │                           │
                └─────────────┬─────────────┘
                              │
                      ┌───────▼────────┐
                      │ Tauri 2         │
                      │ Windows / Android│
                      │ Rust            │
                      └─────────────────┘
```

### 2.2 必须遵守的原则

1. **不破坏现有 Windows 端**：Android 重构期间，不为了手机端强行修改桌面布局。
2. **共享业务逻辑，不强行共享页面结构**：共享类型、Store、Composable、工具函数、文档解析、AI 转换、配置读写和做题状态；不强制共享按钮位置、侧边栏、工具栏、弹窗和页面结构。
3. **移动端按移动端交互重新设计**：移动端不是桌面端的缩小版，需要优先考虑竖屏、单手操作、底部操作栏、系统返回键、软键盘和安全区域。
4. **分阶段迁移**：不一次性重写整个项目，每完成一个阶段都执行类型检查和构建验证。
5. **业务逻辑只保留一份**：桌面和 Android 可以有两套 UI，但不能复制两套 AI 转换、题库、做题或错题本业务逻辑。

---

## 三、目标架构

### 3.1 推荐目录结构

建议逐步调整为：

```text
src/
├── App.vue
├── main.ts
├── types.ts
│
├── layouts/
│   ├── AppShell.vue
│   ├── DesktopShell.vue
│   └── MobileShell.vue
│
├── views/
│   ├── shared/
│   │   ├── LoadingView.vue
│   │   ├── ErrorView.vue
│   │   └── NotFoundView.vue
│   │
│   ├── desktop/
│   │   ├── DesktopHomeView.vue
│   │   ├── DesktopQuizView.vue
│   │   ├── DesktopSettingsView.vue
│   │   ├── DesktopWrongNotebookView.vue
│   │   └── DesktopConverterView.vue
│   │
│   └── mobile/
│       ├── MobileHomeView.vue
│       ├── MobileQuizView.vue
│       ├── MobileSettingsView.vue
│       ├── MobileWrongNotebookView.vue
│       └── MobileConverterView.vue
│
├── components/
│   ├── shared/
│   │   ├── QuestionDisplay.vue
│   │   ├── CompoundQuestion.vue
│   │   ├── MarkdownContent.vue
│   │   ├── ResultDisplay.vue
│   │   ├── ToastContainer.vue
│   │   ├── BankSelector.vue
│   │   └── LoadingState.vue
│   │
│   ├── desktop/
│   │   ├── DesktopSidebar.vue
│   │   ├── DesktopToolbar.vue
│   │   ├── DesktopAnswerCard.vue
│   │   ├── DesktopSettingsPanel.vue
│   │   └── DesktopDialog.vue
│   │
│   └── mobile/
│       ├── MobileTopBar.vue
│       ├── MobileBottomNav.vue
│       ├── MobileQuizBar.vue
│       ├── MobileAnswerSheet.vue
│       ├── MobileActionSheet.vue
│       ├── MobileSettingsSection.vue
│       ├── MobileFilePicker.vue
│       └── MobileDialog.vue
│
├── stores/
│   ├── quizStore.ts
│   ├── appStore.ts
│   └── settingsStore.ts
│
├── composables/
│   ├── useQuiz.ts
│   ├── useLlmSettings.ts
│   ├── usePlatform.ts
│   ├── useLayoutMode.ts
│   ├── useAppNavigation.ts
│   ├── useDocumentConverter.ts
│   ├── useFileAccess.ts
│   ├── useAndroidBackButton.ts
│   ├── useSafeArea.ts
│   └── useToast.ts
│
├── services/
│   ├── questionBankService.ts
│   ├── documentConverterService.ts
│   ├── llmService.ts
│   ├── configService.ts
│   ├── fileService.ts
│   ├── wrongNotebookService.ts
│   └── storageService.ts
│
├── utils/
│   ├── questionSchema.ts
│   ├── markdown.ts
│   ├── documentAssets.ts
│   ├── platform.ts
│   └── errors.ts
│
└── styles/
    ├── tokens.css
    ├── global.css
    ├── desktop.css
    └── mobile.css
```

不要求一次性完成上述目录改造，应当分阶段迁移。

### 3.2 AppShell

最终目标：

```vue
<template>
  <DesktopShell v-if="layoutMode === 'desktop'" />
  <MobileShell v-else />
</template>
```

迁移初期不要立刻重写整个 `App.vue`。建议先从 `App.vue` 中提取：

```text
LoadingView
ErrorView
AppScreenHost
QuizSessionView
```

第一步：

```text
App.vue
└── QuizSessionView.vue
```

第二步：

```text
App.vue
└── AppShell.vue
    ├── DesktopShell.vue
    └── MobileShell.vue
```

---

## 四、布局模式设计

### 4.1 平台与布局同时判断

不建议只依赖：

```ts
window.innerWidth < 768
```

应同时考虑：

- 运行平台；
- 屏幕尺寸；
- 当前方向。

推荐类型：

```ts
type LayoutMode = 'desktop' | 'mobile'

type RuntimePlatform =
  | 'web'
  | 'windows'
  | 'android'
  | 'macos'
  | 'linux'
```

Android 默认强制使用移动布局。Windows 小窗口是否切换移动布局，可以后续根据实际体验决定。

### 4.2 不要把所有平台判断写在组件里

不建议每个组件都出现：

```ts
if (isAndroid) {
  // 一套逻辑
} else {
  // 另一套逻辑
}
```

平台差异应集中到：

```text
usePlatform
useLayoutMode
fileService
configService
platform adapter
DesktopShell
MobileShell
```

---

## 五、页面设计方案

### 5.1 首页

#### 桌面端

继续保留：

```text
题库选择
题型筛选
开始考试
开始练习
背题
专项练习
错题本
设置
关于
```

#### 移动端

建议采用：

```text
顶部：应用名称、当前题库、设置入口
中间：当前题库卡片、开始练习、开始考试、背题、专项练习
底部：首页、错题本、文档转换、设置
```

高级功能放入“更多”或“设置”，不要在首页一次展示过多操作。

### 5.2 做题页面

桌面端继续使用：

```text
左侧：AnswerCard 答题卡
中间：题目内容
顶部：QuizToolbar
```

移动端改为：

```text
顶部：返回、题号/总题数、当前模式
中间：题目内容、选项、解析、下一题
底部固定：上一题、答题卡、提交/下一题、更多
```

答题卡不再固定显示在左侧，点击“答题卡”后打开 `MobileAnswerSheet`，使用底部抽屉或全屏弹层。

必须支持：

- 单选题；
- 多选题；
- 判断题；
- 填空题；
- 简答题；
- 代码题；
- 复合题；
- Markdown；
- 图片；
- Mermaid；
- 考试、练习、背题和错题模式。

### 5.3 错题本页面

移动端建议采用卡片列表：

```text
顶部：返回、当前题库、管理
列表：错题本名称、错题数量、最后更新时间
操作：进入练习、重命名、导出、删除、更多
```

不要在每一行同时放置过多按钮，批量操作放在右上角更多菜单。

### 5.4 文档转换页面

桌面端可以使用多栏布局：

```text
文件列表 | 转换设置 | 输出预览
```

移动端采用分步向导：

```text
第 1 步：选择文档
第 2 步：设置模型
第 3 步：设置题库名称
第 4 步：设置题目名称
第 5 步：开始转换
第 6 步：查看结果
```

移动端页面结构：

```text
顶部：返回、文档转换、步骤指示器
中间：当前步骤内容
底部固定：上一步、下一步/开始转换
```

名称优先级必须保持：

```text
题库名称：用户输入 > AI 返回 > 文件名推导 > 默认名称
题目名称：用户输入 > AI 返回 > 自动生成
```

以下内容必须同步使用最终名称：

```text
JSON 文件名
题库包名称
图片目录名称
题库显示名称
```

该逻辑必须放在共享业务层，不能分别写在桌面端和移动端组件中。

### 5.5 AI 模型配置

移动端使用分组卡片和折叠区域：

```text
模型服务商
API Base URL
API Key
模型名称
请求参数
隐私设置
配置文件
```

API Key 默认隐藏，不能写入公开资源目录，也不能写入日志。导出配置时应支持脱敏。

### 5.6 配置文件

#### Windows

继续支持：

```text
打开配置文件
重新读取配置文件
删除密钥
```

#### Android

建议提供：

```text
导出配置文件
导入配置文件
使用其他应用打开
重新读取配置文件
删除密钥
```

Android 流程：

```text
打开配置文件
↓
导出到用户可访问的位置
↓
调用系统分享或外部文本编辑器
↓
用户返回应用
↓
点击重新读取配置文件
```

第一阶段不优先开发复杂的应用内 JSON 编辑器，先实现导入、导出和重新读取。

---

## 六、共享层设计

### 6.1 Store 只管理数据状态

`quizStore.ts` 可以管理：

- 当前题库；
- 错题本；
- 错题记录；
- 备份；
- 恢复；
- 激活错题本。

但不应管理：

- 按钮是否显示；
- 按钮位于顶部还是底部；
- 桌面还是移动布局；
- 弹窗显示在哪里。

### 6.2 Composable 负责业务流程

`useQuiz.ts`：

- 题目加载；
- 答题状态；
- 判分；
- 题目切换；
- 考试提交；
- 练习流程。

`useDocumentConverter.ts`：

- 文件读取；
- 文档解析；
- AI 请求；
- JSON 校验；
- 题库名称优先级；
- 输出文件生成；
- 转换进度。

`useLlmSettings.ts`：

- 模型配置读取；
- 模型配置保存；
- API Key 管理；
- 配置校验；
- 配置重新加载。

`useFileAccess.ts`：

- 文件选择；
- 文件读取；
- 文件保存；
- 文件导入；
- 文件导出；
- Android URI 处理；
- Windows 路径处理。

### 6.3 页面只负责 UI

页面组件不应到处直接调用：

```ts
invoke(...)
localStorage.setItem(...)
readTextFile(...)
fetch(...)
```

页面应调用统一的业务接口：

```ts
const converter = useDocumentConverter()
const fileAccess = useFileAccess()
const settings = useLlmSettings()
```

---

## 七、Android 文件和权限设计

### 7.1 应用配置

应用内部配置使用应用私有目录，例如：

```text
AppConfig
AppData
AppLocalData
```

包括：

- AI 配置；
- 用户偏好；
- 错题本；
- 练习进度；
- 应用缓存；
- 转换中间数据。

不要在 Android 中使用 Windows 风格的绝对路径。

建议抽象为：

```ts
interface AppStorage {
  read(name: string): Promise<string>
  write(name: string, content: string): Promise<void>
  exists(name: string): Promise<boolean>
  remove(name: string): Promise<void>
}
```

### 7.2 用户导入文件

Android 文件可能来自下载、文档、微信、QQ、文件管理器、云盘或其他应用。应用不应假设所有文件都能转换为普通绝对路径。

统一模型：

```ts
interface ImportedFile {
  name: string
  mimeType?: string
  size?: number
  path?: string
  uri?: string
  read(): Promise<ArrayBuffer>
}
```

桌面端可以使用 `path`，Android 端可以使用 `uri`。

### 7.3 图片资源

题目图片分为：

```text
应用内置图片
用户导入图片
转换过程中产生的图片
题库关联图片
```

统一通过以下服务解析：

```ts
resolveQuestionImage(imageRef: string): Promise<string>
```

页面组件不应自行拼接文件路径。

---

## 八、样式系统设计

新增 `src/styles/tokens.css`，统一定义颜色、间距、圆角和触控尺寸：

```css
:root {
  --color-bg-page: #f5f7fa;
  --color-bg-container: #ffffff;
  --color-text-primary: #1f2937;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
  --color-primary: #2563eb;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  --touch-target-min: 44px;
  --mobile-bottom-nav-height: 64px;
}
```

### 8.1 安全区域

```css
.mobile-bottom-nav {
  padding-bottom: env(safe-area-inset-bottom);
}

.mobile-top-bar {
  padding-top: env(safe-area-inset-top);
}

.mobile-page-content {
  padding-bottom: calc(
    var(--mobile-bottom-nav-height)
    + env(safe-area-inset-bottom)
    + 16px
  );
}
```

### 8.2 触控尺寸

移动端按钮、列表项目和选项的可点击区域至少保持 `44px × 44px`：

```css
.mobile-button {
  min-height: 44px;
  padding: 10px 16px;
}
```

### 8.3 避免绝对定位

除固定底部导航和固定底部操作栏外，尽量使用：

```text
flex
grid
gap
padding
margin
sticky
```

避免通过大量 `top`、`left`、负边距和 `transform` 强行修复布局。

---

## 九、导航与返回键

当前项目使用 `appMode` 控制页面状态，例如：

```text
start
settings
about
wrong-manage
practice
exam
endorse
wrong
specialize
review
```

第一阶段不建议为了移动端立刻引入 Vue Router。建议先抽象：

```ts
type AppScreen =
  | 'home'
  | 'quiz'
  | 'review'
  | 'wrong-notebook'
  | 'converter'
  | 'settings'
  | 'about'
```

并建立 `useAppNavigation()`，负责：

```ts
goHome()
openSettings()
openConverter()
openWrongNotebook()
startQuiz(mode)
goBack()
```

Android 返回键优先级：

```text
如果弹窗打开：关闭弹窗
否则如果答题卡打开：关闭答题卡
否则如果底部抽屉打开：关闭抽屉
否则如果处于题目页面：返回首页或弹出确认
否则如果处于二级页面：返回上一级
否则：执行默认退出行为
```

建议新增：

```text
src/composables/useAndroidBackButton.ts
```

避免用户在做题过程中误触返回键直接退出应用。

---

## 十、重构阶段规划

### 阶段 0：建立基线

目标：

- 保证当前 Windows 版可正常运行；
- 记录当前功能；
- 确认当前分支可回滚；
- 不改变业务行为。

验证：

```bash
npm run config:check
npm run type-check
npm run build
npm run tauri:build
```

### 阶段 1：平台与布局基础设施

新增：

```text
usePlatform.ts
useLayoutMode.ts
useAppNavigation.ts
AppShell.vue
DesktopShell.vue
MobileShell.vue
tokens.css
mobile.css
```

目标：

- 判断 Windows、Android、Web；
- 区分桌面布局和移动布局；
- 不改变现有桌面显示；
- Android 可以显示基础移动首页。

### 阶段 2：拆分 App.vue

从 `App.vue` 中抽取：

```text
LoadingView
ErrorView
QuizSessionView
AppScreenHost
```

目标：

- 降低 `App.vue` 复杂度；
- 保留现有事件行为；
- 不改变题库数据格式；
- 不重写题目逻辑。

### 阶段 3：移动端首页

实现：

```text
MobileHomeView
MobileTopBar
MobileBottomNav
```

优先支持：

- 当前题库；
- 开始练习；
- 开始考试；
- 背题；
- 专项练习；
- 错题本；
- 设置。

### 阶段 4：移动端做题页面

实现：

```text
MobileQuizView
MobileQuizBar
MobileAnswerSheet
MobileQuestionActions
```

目标：

- 题目单栏显示；
- 底部固定操作栏；
- 答题卡改为抽屉或全屏弹层；
- 支持上一题、下一题、提交；
- 保留全部题型和做题模式。

### 阶段 5：移动端错题本

实现：

```text
MobileWrongNotebookView
MobileNotebookCard
MobileNotebookActions
```

目标：

- 查看错题本；
- 进入错题练习；
- 重命名；
- 删除；
- 导入；
- 导出；
- 备份；
- 恢复。

### 阶段 6：移动端文档转换

实现：

```text
MobileConverterView
MobileConverterStepFile
MobileConverterStepSettings
MobileConverterStepNaming
MobileConverterStepProgress
MobileConverterResult
```

目标：

- 文件导入；
- 文档解析；
- 模型配置；
- 题库名称；
- 题目名称；
- AI 转换；
- 输出结果；
- JSON 导出；
- 题库包导出。

### 阶段 7：Android 文件能力

实现：

```text
useFileAccess()
fileService.ts
configService.ts
```

处理：

- Android 文件选择；
- content URI；
- 应用私有目录；
- 配置文件导入；
- 配置文件导出；
- 外部编辑器；
- 图片资源；
- JSON 文件。

### 阶段 8：APK 构建和真机测试

```bash
npm run tauri android init
npm run tauri android dev
npm run tauri android build -- --apk
```

之后处理：

- 应用图标；
- 包名；
- 签名；
- 版本号；
- AAB；
- 发布说明；
- 更新机制。

---

## 十一、测试矩阵

### 11.1 Windows 测试

```text
启动应用
选择题库
进入练习
进入考试
进入背题
进入专项练习
提交答案
查看解析
添加错题
管理错题本
导入题库
导出题库
AI 文档转换
打开配置文件
重新读取配置
删除密钥
```

### 11.2 Android 测试

```text
竖屏启动
横屏启动
返回键
系统键盘
文件选择器
导入 JSON
导入 DOCX
导入 PDF
导入图片
导出 JSON
导出题库
外部文本编辑器
网络断开
AI 请求超时
应用切后台
恢复应用
旋转屏幕
低内存重新打开
```

### 11.3 设备尺寸

```text
360 × 800
390 × 844
412 × 915
平板横屏
平板竖屏
Windows 1200 × 800
Windows 800 × 600
```

---

## 十二、验收标准

### 12.1 架构验收

- [x] Windows 和 Android 使用同一仓库；
- [x] 题库数据模型保持一致；
- [x] 业务逻辑不重复实现；
- [x] 桌面端和移动端页面结构可以不同；
- [x] `App.vue` 不再承担所有页面细节；
- [x] 文件访问通过统一服务；
- [x] AI 转换逻辑只保留一份；
- [ ] 题库名称优先级只保留一份；
- [ ] 题目名称优先级只保留一份。

### 12.2 UI 验收

- [x] Windows 端原有布局不被破坏；
- [x] Android 端不依赖桌面侧边栏；
- [x] Android 端有底部导航；
- [x] Android 端按钮适合触控；
- [x] Android 端做题页面单栏显示；
- [x] Android 端答题卡使用抽屉或弹层；
- [x] Android 端转换页面使用分步流程；
- [x] Android 端设置页面使用分组卡片；
- [x] Android 端适配安全区域；
- [ ] 页面不会被软键盘遮挡。

### 12.3 功能验收

- [ ] 题库可以加载；
- [ ] 所有题型可以显示；
- [ ] 所有答题模式正常工作；
- [ ] 错题本正常工作；
- [ ] AI 转换正常工作；
- [ ] 自定义题库名称优先；
- [ ] 自定义题目名称优先；
- [ ] 配置文件可以重新读取；
- [ ] API Key 不会写入公开资源；
- [ ] Markdown、图片、代码高亮、Mermaid 正常显示。

---

## 十三、重构时禁止事项

### 13.1 不要重写整个项目

不要因为增加 Android 端就直接删除现有：

```text
App.vue
quizStore.ts
useQuiz.ts
questionSchema.ts
useLlmSettings.ts
```

应当逐步抽取、逐步迁移。

### 13.2 不要复制两套业务逻辑

禁止出现：

```text
desktopDocumentConverter.ts
mobileDocumentConverter.ts
```

如果只是页面交互不同，业务逻辑必须共享。

### 13.3 不要在每个组件中判断平台

平台差异集中到服务层、布局层和平台适配层。

### 13.4 不要用 CSS 强行修复所有问题

如果一个页面需要大量负边距、`transform`、绝对定位和断点覆盖，说明页面结构应该拆分。

### 13.5 不要一开始同时改所有页面

推荐顺序：

```text
基础设施
→ 首页
→ 做题页
→ 错题本
→ 文档转换
→ 设置
→ 文件系统
→ 发布
```

---

## 十四、第一批建议处理的文件

```text
src/App.vue
src/types.ts
src/composables/useQuiz.ts
src/composables/useLlmSettings.ts
src/stores/quizStore.ts
src/components/StartScreen.vue
src/components/QuizToolbar.vue
src/components/AnswerCard.vue
src/components/SettingsPage.vue
src/components/AiDocumentConverter.vue
src/components/WrongNotebookManager.vue
src-tauri/tauri.conf.json
```

第一阶段不要立即修改所有业务组件，优先创建：

```text
src/composables/usePlatform.ts
src/composables/useLayoutMode.ts
src/composables/useAppNavigation.ts
src/layouts/AppShell.vue
src/layouts/DesktopShell.vue
src/layouts/MobileShell.vue
src/styles/tokens.css
src/styles/mobile.css
```

---

## 十五、给新长文本对话的开场提示词

以下内容可以直接复制到新的长文本对话中：

```text
我需要在现有项目上重构 Android 移动端。

项目工作区：
E:\CodeProgram\exam

项目技术栈：
- Vue 3
- TypeScript
- Vite
- Pinia
- Tauri 2
- Rust
- Windows 桌面端已经可以运行
- 当前版本约为 0.1.1

目标：
使用 Tauri 2 + Vue 移动端独立布局，增加 Android APK 版本。

核心设计原则：
1. 不要把桌面 UI 简单缩小成移动 UI。
2. Windows 桌面端和 Android 移动端使用两套布局。
3. 业务逻辑、Store、数据模型、AI 转换逻辑、题库逻辑、错题本逻辑必须共享。
4. 桌面端和移动端可以拥有不同的按钮位置、导航方式、弹窗方式和页面结构。
5. 不要因为 Android 重构破坏现有 Windows 端。
6. 不要一次性重写整个项目。
7. 采用分阶段迁移，每完成一个阶段都执行类型检查和构建验证。
8. 不要复制两套 AI 文档转换逻辑。
9. 文件读写必须通过统一服务，不能在页面组件中到处直接调用文件 API。
10. Android 端需要考虑 content URI、文件选择器、系统返回键、软键盘、安全区域和应用私有目录。

名称优先级必须保持：
题库名称：用户输入 > AI 返回 > 文件名推导 > 默认名称
题目名称：用户输入 > AI 返回 > 自动生成

建议架构：
src/layouts/
- AppShell.vue
- DesktopShell.vue
- MobileShell.vue

src/views/desktop/
src/views/mobile/
src/components/shared/
src/components/desktop/
src/components/mobile/
src/services/
src/composables/

第一阶段请不要直接重写所有页面。

请先完成：
1. 检查当前项目结构；
2. 分析 App.vue 中哪些逻辑应该抽出；
3. 建立 usePlatform.ts；
4. 建立 useLayoutMode.ts；
5. 建立 AppShell、DesktopShell、MobileShell 的最小结构；
6. 确保 Windows 端现有功能不被破坏；
7. 让 Android 后续可以切换到 MobileShell；
8. 运行 npm run type-check、npm run build；
9. 最后汇报修改了哪些文件、为什么修改、验证是否通过。

如果发现需要大范围重构，请先给出计划，不要直接删除现有代码。
```

---

## 十六、最终技术决策

```text
前端：Vue 3 + TypeScript + Vite
状态：Pinia
桌面与移动容器：Tauri 2
桌面 UI：DesktopShell
Android UI：MobileShell
共享逻辑：Composables + Services + Stores
Android 原生扩展：仅在确实需要时使用 Kotlin
数据格式：继续使用现有题库 JSON Schema
桌面版：保持现有功能和布局
Android 版：重新设计移动端页面结构
```

最终目标不是让一套桌面页面勉强适配 Android，而是：

> **让 Windows 和 Android 共享同一个应用核心，同时拥有适合各自设备的交互界面。**

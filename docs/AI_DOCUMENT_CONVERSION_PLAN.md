# AI 文档转换配置与后续计划

> 文档性质：记录当前 AI 文档转题库实现、配置边界和后续质量工作。
>
> 更新时间：2026-10-05

## 1. 当前实现结论

AI 文档转换已经接入真实的 OpenAI 兼容 Chat Completions 接口，核心代码位于：

- `src/components/AiDocumentConverter.vue`：文件选择、文本提取、确认提示、过程展示和结果导出；
- `src/services/questionBankConverter.ts`：与 UI 无关的转换流水线；
- `src/services/llmClient.ts`：请求、流式响应、超时、重试和取消；
- `public/config/llm/framework.json`：流水线参数、分段策略和 Prompt 配置；
- `public/config/schemas/question-bank.schema.json`：转换结果的机器校验规则。

当前流水线为：

```text
本地提取文件
  → analyze：识别题目区、答案区、无关区并命名题库
  → convert：按行号切分题目区并发转换
  → 本地合并：按行号去重并关联图片
  → answer-match：匹配独立答案区
  → repair：修复 Schema 校验失败的题目
  → 重排题号、校验并保存
```

模型负责理解文档结构；本地程序负责分段、合并、去重、答案关联、图片路径处理和 Schema 校验。**Schema 校验通过不代表题目内容一定正确，用户仍应抽查结果。**

## 2. 配置和 API Key 存储

### Windows / Tauri 桌面版

在“设置 → AI 模型配置”点击“保存连接”后，配置写入 Tauri 应用配置目录：

```text
%APPDATA%/com.exam.assistant/llm-config.txt
```

文件中包含 `provider.apiKey`。程序重启时会自动读取，因此不需要每次重新输入。该文件属于用户本机敏感配置：

- 不进入 `public/`、题库 JSON、日志或版本控制；
- 不复制到发布包；
- 用户可在设置页清除 API Key；
- 如需迁移配置，应由用户自行处理，默认不随题库备份导出。

### Web 生产版

浏览器无法安全地由应用直接写入任意本地配置文件，因此 Web 版只在当前会话使用 `sessionStorage` 保存 API Key。刷新或关闭会话后需要重新输入。普通配置可以由 Web 版保存，但不能把密钥写入构建产物。

### Android

Android 的 API Key 持久化行为必须以当前构建和真机验收结果为准，本文不把“跨重启记住密钥”作为 Android 正式承诺。后续应评估 Android Keystore 或 Tauri 安全存储；在此之前，不要把 API Key 放入普通 `localStorage`、导出文件或日志。

## 3. 文档转换输入和输出

文档先在本地提取文字，当前支持 DOCX、PPTX、PDF（含 OCR）、XLSX/XLSM、TXT、Markdown、JSON 和 CSV。发送到第三方模型前，界面必须显示确认提示，用户明确同意后才允许远程处理。

桌面端转换结果保存到用户数据目录，而不是 `Program Files`：

```text
%LOCALAPPDATA%/com.exam.assistant/content/subjects/
%LOCALAPPDATA%/com.exam.assistant/content/images/
```

开发版因便于调试，会将应用内生成的题库写入项目 `public/subjects/`，图片写入 `public/images/`；正式安装版写入上面的用户目录。保存失败时应允许用户下载 JSON 备份，而不是把结果标记为完全失败。

## 4. 请求能力和错误处理

`llmClient.ts` 当前支持：

- OpenAI 兼容 `messages`、`temperature`、`max_tokens`、`stream` 请求；
- 流式 SSE 读取和非流式响应；
- 空闲超时；
- 429、5xx 等可重试错误的退避重试；
- JSON 模式和 thinking 参数不受支持时的自动降级；
- 输出截断检测；
- 用户取消转换；
- 日志中隐藏 API Key，仅记录接口、阶段、耗时和可诊断错误。

不同服务商的请求体、鉴权头、Schema 和 SSE 格式可能不同。当前正式支持边界是 OpenAI Chat Completions 兼容接口；其他协议需要单独的适配器和测试夹具。

## 5. 当前限制与风险

- 服务商必须允许来自浏览器/WebView 的请求；`Failed to fetch` 需要区分 CORS、网络、证书、接口地址和服务端拒绝。
- 大文档会被分段并发处理，超大 PDF/OCR 可能消耗较多内存和模型额度。
- 模型可能漏题、重复题、误判题型或生成格式正确但内容错误的题目。
- 文档可能含有个人信息或内部资料，发送前必须确认隐私风险。
- 内置题库只读；用户手动放置、应用导入和 AI 生成的题库必须进入用户可写目录。

## 6. 后续 TODO

### 质量和可恢复性

- [ ] 转换前展示字符数、图片数、分段数、模型、接口和预计请求次数。
- [ ] 分开展示预期题数、识别题数、答案完整题数和异常题数。
- [ ] 支持失败分段单独重试和从中断位置恢复。
- [ ] 提供结果预览、题目抽查、异常题定位和局部删除。
- [ ] 保存失败时稳定导出 JSON 和图片资源，并提供重试入口。
- [ ] 增加 DOCX/PDF/XLSX/TXT、SSE、非流式、空响应、截断、429、5xx 和 Schema 修复测试夹具。

### 平台和安全

- [ ] 为 Android 分类显示无网络、证书、CORS、401/403、429 和 5xx 错误。
- [ ] 评估 Android Keystore/Tauri 安全存储，并完成真机重启、清除和迁移验收。
- [ ] 增加服务商协议适配器（Responses API、Gemini、Claude 等），每种协议独立验收。
- [ ] 增加可选自定义请求头，但禁止将密钥写入普通日志、题库或发布资源。
- [ ] 增加后台任务恢复策略和大文档内存保护。

## 7. 验收标准

- Windows 桌面版保存 API Key 后重启应用，配置仍可读取；清除密钥后文件中的 `provider.apiKey` 为空。
- 任意日志、导出题库、构建产物和 Git 差异中都不出现真实 API Key。
- 转换前有第三方发送确认；取消、超时、429、5xx、空响应和非法 JSON 均有可理解的提示。
- 至少用 DOCX、PDF、XLSX、TXT 各完成一次转换，结果通过 Schema 校验并出现在题库列表。
- 用户题库和图片保存到可写用户目录；安装目录内置资源保持只读。
- 转换生成的结果即使本机保存失败，也能导出 JSON 备份，不丢失已生成内容。

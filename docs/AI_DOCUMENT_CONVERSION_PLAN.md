# AI 文档转换配置与后续计划

更新时间：2026-09-28

## 当前实现结论

AI 文档转换已经不是空入口，当前流程已经接入真实的 OpenAI 兼容接口：

1. 在“设置 → AI 模型配置”中保存 `baseUrl`、模型名、请求参数。
2. API Key 只保存在当前 WebView 会话的 `sessionStorage`，不会写进构建产物或题库 JSON。
3. 文档先在本地提取文字：DOCX、PDF（含 OCR）、XLSX、TXT、Markdown、JSON、CSV。
4. 点击“开始转换为题库 JSON”后，程序读取 `public/config/llm/framework.json`、转换 Prompt 和题库 Schema。
5. 普通文本通过 `/chat/completions` 发给配置的模型；已符合约定格式的题目 Markdown 会优先本地解析，避免不必要的远程请求。
6. 模型返回结果会经过 JSON 清理、字段归一化和 Schema 校验；校验失败时会使用 repair Prompt 重试。
7. 通过校验后保存到 IndexedDB，本地题库会自动出现在主页的题库选择列表中，并跳转到终端页显示过程日志。

Android 端已经声明 `android.permission.INTERNET`，并使用 Tauri 的应用配置目录保存非密钥配置。API Key 仍然只在当前会话内使用，重启应用后需要重新填写，这是有意的安全策略。

## Android 配置步骤

1. 打开“设置 → AI 模型配置”。
2. 填写 OpenAI 兼容服务的基础地址，例如 `https://api.openai.com/v1`。不要重复填写 `/chat/completions`；程序会自动补全。
3. 填写模型名和 API Key，点击保存或测试连接。
4. 打开“文档转换”，选择文件并确认允许将提取后的文本发送到第三方模型服务。
5. 转换完成后返回首页，在题库选择器中选择新题库。

如果服务商只支持自定义鉴权头、非 OpenAI 的请求体、或必须通过服务端代理，目前尚未直接支持，需要增加协议适配器。

## 当前限制与风险

- API Key 从浏览器或 Android WebView 直接请求第三方服务，服务商必须允许 CORS；遇到 `Failed to fetch` 时应先检查 CORS、网络、证书和接口地址。
- 不同服务商的 JSON Schema、`response_format` 和流式 SSE 格式存在差异。目前使用通用的 `messages`、`temperature`、`max_tokens`、`stream` 参数，并兼容常见 Chat Completions 响应。
- 大文档会按照框架配置分段，并在本地合并和去重；超大 PDF/OCR 仍可能消耗较多 Android 内存。
- 当前 API Key 不持久化。后续如支持安全存储，应使用 Android Keystore/Tauri 安全存储，而不是 localStorage。
- 文档文本可能包含个人信息或内部资料。远程处理前必须取得用户确认，应用不应默认上传原文。

## 推荐架构

```text
本地文件
  ↓
格式提取 / OCR
  ↓
文本清洗、图片清单、分段
  ↓
OpenAI 兼容请求适配器
  ↓
流式输出 + 超时 + 可重试
  ↓
JSON 清理与题库 Schema 校验
  ↓
Repair Prompt（最多 2 次）
  ↓
分段合并、题号重排、图片路径归一化
  ↓
IndexedDB 保存题库
```

建议将模型调用继续抽离为独立的 `llmClient` 服务，使 UI 只负责状态展示；服务层负责协议、重试、超时、日志脱敏和取消请求。

## 后续开发任务

- [ ] 增加服务商协议选项：OpenAI Chat Completions、Responses API、Gemini/Claude 适配器。
- [ ] 增加可选自定义请求头，但默认禁止把 API Key 写入普通配置文件。
- [ ] 为 Android 增加网络错误分类：无网络、证书错误、CORS、401/403、429、5xx。
- [ ] 增加取消转换按钮和后台任务恢复策略。
- [ ] 对分段请求增加 token 预算估算、进度百分比和剩余分段数。
- [ ] 增加本地脱敏预览：发送前显示文本长度、图片数和预计请求次数。
- [ ] 为常见服务商补充端到端测试夹具，覆盖非流式、SSE、空响应和 Schema 修复。
- [ ] Android 正式版接入 Keystore/Tauri 安全存储后，再考虑“记住 API Key”。

## 验收标准

- 模型配置保存后，重启应用仍能读取地址、模型和请求参数；API Key 按安全策略重新输入。
- 测试连接成功时能看到明确的 HTTP 状态和服务商错误信息，日志中不出现 API Key。
- 使用 DOCX/PDF/XLSX/TXT 至少各转换一次；转换结果能通过 Schema 校验并保存到主页题库列表。
- 模型返回 Markdown 代码围栏、空响应、超时、429 或非法 JSON 时，终端页能显示可理解的错误，并允许重试。
- Android 弱网下不会卡死界面，返回键不会丢失已生成但尚未保存的结果。
- 删除转换题库前，明确提示会同步删除对应错题本、错题记录和练习进度。

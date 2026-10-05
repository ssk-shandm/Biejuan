# 配置目录

项目把“随应用发布的公共配置”和“可写的运行时配置”分开保存，避免把 Prompt、Schema、用户参数和密钥混在一起。

```text
config/
  llm-config.json                     # Vite 开发版实际读写的 AI 运行配置
public/config/
  diagram-renderer.json               # 图表运行时默认配置
  question-schema.md                  # 面向维护者的题库格式说明
  examples/                           # 可复制示例，不由应用直接写入
  schemas/                            # 题库与 LLM 配置 JSON Schema
  llm/
    framework.json                    # 内置转换/修复流水线
    prompts/                          # 随应用预装的 Prompt
```

## LLM 运行配置

`config/llm-config.json` 管理模型连接、请求和 OCR 参数，主要字段包括：

- `provider.baseUrl`、`provider.model`；
- `request.temperature`；
- `request.maxOutputTokens`；
- `request.timeoutMs`；
- `ocr.enabled`、`ocr.language`、`ocr.scale`、`ocr.minTextCharacters`。

保存后项目会立即重新读取并应用。不同运行环境的存储后端如下：

1. **Tauri 桌面端**：由 Rust 命令读写系统 `app_config_dir/llm-config.txt`。首次读取时自动创建，可直接用记事本等文本编辑器读写，内容仍使用 JSON 格式；如果检测到旧版 `llm-config.json`，会先复制为 `llm-config.txt`，避免丢失已有配置。外部编辑保存后，在设置页点击“重新读取”即可应用。
2. **Vite 开发版**：通过开发中间件的 `GET/PUT /api/llm-config` 读写仓库根目录 `config/llm-config.json`。
3. **Web 生产版**：降级保存到浏览器 `localStorage`，因为静态站点不能直接改写服务器文件。

**桌面端密钥持久化**：点击“保存连接”会把 API Key 写入本地 `app_config_dir/llm-config.txt` 的 `provider.apiKey` 字段，重启后自动读取。该字段可选，旧版配置仍可使用；点击“清除密钥”会同时清除文件中的密钥。密钥以明文保存，请勿分享配置文件，也不要将真实密钥填写到公开示例或提交到仓库。网页端仍使用 `sessionStorage`，关闭标签页后失效。

## 内置文档转换流程

`llm/framework.json` 定义与供应商无关的处理流程：

1. 本地提取 DOCX（还原 Word 自动编号、表格、图片锚点）、PPTX（按幻灯片顺序）、PDF（按行还原，文本层不足时 OCR）、XLSX/XLSM、TXT、Markdown、JSON 或 CSV；
2. 文本按行编号。`analyze` 步骤只发送每行截断后的轮廓（`input.analysis`），由模型划分题目区、答案区和无关区，并命名题库；
3. `convert` 步骤只发送题目区，按 `input.chunking` 分段并发（`input.concurrency`）转换。模型为每道题标注起止行号，本地据此合并去重、关联图片；
4. 文档有独立答案区时，`answer-match` 步骤只发送答案区原文和题目摘要（题号、题干开头），把答案回填到题目和综合题小问；
5. 每道题用 `schemas/question-bank.schema.json` 校验，不通过的交给 `question-bank-repair.prompt.json` 修复，次数由 `maxAttempts` 决定；
6. 输出被 `maxOutputTokens` 截断时自动把分段一分为二重试。

Prompt 的 `request.thinking: false` 会请求关闭模型推理（DeepSeek 的 `thinking` 参数），抽取任务更快，也避免推理 token 挤占输出上限；服务商不支持时自动去掉该参数。文档结构的判断全部交给模型，本地不再有针对特定排版的正则解析。

扫描 PDF 首次 OCR 通常需要下载语言数据。默认语言是 `chi_sim+eng`，当前没有预装离线 traineddata。Excel 当前只读取普通单元格文本，不处理复杂合并单元格和公式计算。

## 配置检查

```bash
npm run config:check
```

检查内容包括 JSON 语法、框架引用路径、Prompt 变量、示例题库结构，以及示例中是否意外填写真实 API Key。

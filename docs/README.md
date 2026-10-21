# 项目文档

> 文档索引更新时间：2026-10-21
>
> 已发布版本：`v0.2.3`（2026-10-21）
>
> 本次补丁版本：`v0.2.3`（2026-10-21），已发布 GitHub Release，资产及验证结果见对应发行说明；真实 Windows 安装、覆盖升级和卸载仍待验收。

## 从这里开始

| 你想了解什么 | 文档 |
| --- | --- |
| v0.2.3 拖拽、终端与缺答案改了什么 | [v0.2.3 发行说明](RELEASE_NOTES_v0.2.3.md) |
| v0.2.2 本地网关兼容改了什么 | [v0.2.2 发行说明](RELEASE_NOTES_v0.2.2.md) |
| v0.2.1 补丁改了什么 | [v0.2.1 发行说明](RELEASE_NOTES_v0.2.1.md) |
| v0.2 改了什么 | [v0.2.0 发行说明](RELEASE_NOTES_v0.2.0.md) |
| 升级会不会丢错题本 | [数据保护与备份说明](DATA_SAFETY_V02.md) |
| 如何构建 Windows / Android | [打包与更新指南](TAURI_GUIDE.md) |
| 下一步做什么 | [0.2 → 1.0 产品路线](ROADMAP_0.2_TO_1.0.md) |
| 题库 JSON 怎么写 | [题库规范](../public/config/question-schema.md) |
| AI 配置和文档转换 | [AI 文档转换计划](AI_DOCUMENT_CONVERSION_PLAN.md) |

## 当前版本

- [v0.2.3 拖拽导入、终端布局与缺答案提示](RELEASE_NOTES_v0.2.3.md)：当前补丁版本、验证结果及安装包校验值。
- [v0.2.2 本地网关模型列表兼容](RELEASE_NOTES_v0.2.2.md)：2026-10-21 已发布。
- [v0.2.1 新手指引、手动转换和日志导出](RELEASE_NOTES_v0.2.1.md)：2026-10-20 已发布。
- [v0.2.0 用户变化、验证结果和构建资产](RELEASE_NOTES_v0.2.0.md)：2026-10-15 已发布。
- [v0.2 数据保护、升级保留和备份恢复](DATA_SAFETY_V02.md)：包括自动升级保护与 Windows 人工验收清单。
- [桌面端滚动 / 传统双呈现](DESKTOP_QUIZ_PRESENTATION.md)：当前实现和发布边界。
- [Markdown、公式与学习工具](MARKDOWN_STUDY_TOOLS.md)：富文本展示、复制反馈和学习工具。
- [简化页面显示](SIMPLIFY_PAGE_DISPLAY.md)：页面精简的交互约定。

## 产品与架构

- [架构说明与重构诊断](ARCHITECTURE.md)
- [项目设计](DESIGN.md)
- [AI 文档转换配置与后续计划](AI_DOCUMENT_CONVERSION_PLAN.md)
- [0.2 → 1.0 产品路线与 TODO](ROADMAP_0.2_TO_1.0.md)

## 平台与发布

- [Windows / Android 打包与更新指南](TAURI_GUIDE.md)
- [发布说明模板：更新摘要、详细更新、安装与注意事项](RELEASE_TEMPLATE.md)
- [Android 移动端重构设计与阶段记录](ANDROID_MOBILE_REFACTOR_DESIGN.md)（历史设计与实施记录）
- [v0.1 收尾记录与 v0.2 交接](V0.1_CLOSEOUT.md)（历史归档）

## 历史发行说明

- [v0.1.6](RELEASE_NOTES_v0.1.6.md)
- [v0.1.5](RELEASE_NOTES_v0.1.5.md)
- [v0.1.3](RELEASE_NOTES_v0.1.3.md)
- [v0.1.2](RELEASE_NOTES_v0.1.2.md)

## 文档维护约定

- 代码和当前构建行为优先；历史发行说明只记录对应版本，不回写后续修复。
- 当前任务和验收状态以路线文档、当前发行说明和数据保护说明为准。
- 新功能先写入当前版本文档；确认发布后再补充 Release 标签、资产哈希和人工验收结果。
- 数据目录、配置格式、题库格式、发布流程或安全策略变化时，同步更新相关文档和本索引。
- 个人题库、图片、错题本、API Key、临时脚本、构建目录和签名材料不放入 `docs/` 或 Git。

仓库快速开始请查看 [根目录 README](../README.md)。

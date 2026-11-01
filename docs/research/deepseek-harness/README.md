# DeepSeek Harness（dsh）研究档案

> 访问日期：2026-11-01 · 用途：为小说工坊插件的 Agent Harness 优化与可选后端提供事实依据
> 结论分级见 `sources.json`（High / Medium / Low）；本文不复制上游原文，只做归纳。

## 1. 它是什么

| 项 | 结论 | 置信度 |
|---|---|---|
| 仓库 | `deepseek-ai/deepseek-harness`，TypeScript，MIT | High |
| 定位 | DeepSeek 官方开源的 **agent runtime / harness**（代理运行时），不是评测框架、不是微调框架 | High |
| npm 包 | `@deepseek-ai/dsh`，可直接 `npx @deepseek-ai/dsh web` | High |
| 产品页 | https://deepseek.com/harness | High |
| 运行形态 | 本地 Web UI（默认 `127.0.0.1:3080`）、桌面端、headless 一次性运行、SDK/ACP 服务 | High（profile 列表 High；SDK 传输细节 Medium/待验证） |
| 成熟度 | developer preview，官方明示可能有破坏性变更、尚未做安全审计 | High |
| 与模型发布的关系 | “harness”不是 V3.1/V3.2 发布说明里的术语，是独立产品名 | High |

## 2. 它不是什么

- **不是评测基准**：仓库 `benchmarks/` 是运行时基准（会话打开、折叠、终端 IO 等），不是模型能力评测。组织内另有 `DeepSpec` 做投机解码的训练/评测，与此无关。
- **不是我们要引入的默认依赖**：dsh 是完整 agent 运行时（Cordis 插件内核、工具、子代理、桌面/服务端），与“Obsidian 单文件插件 + 本地/云端模型”的运行环境差异很大。

## 3. 采用边界（本项目的决定）

| 类别 | 内容 | 决定 |
|---|---|---|
| 设计借鉴 | 事件日志即事实源、step 级工具集快照、工具管线与 fail-closed 审批、压缩公式、spill 定位符、子代理深度限制、前缀缓存友好布局 | ✅ 采纳（Batch C） |
| 可选后端 | 用户显式开启后，插件通过 dsh 的 SDK/headless profile 运行 Agent；默认关闭、仅桌面端、全 vault 只读、写入逐次批准 | ✅ 采纳（Batch D，前置 spike） |
| 运行时内核 | Cordis 插件内核、profile/bundle/patch 组合、PTC/`run_code` 任意代码执行、MCP 市场、终端/LSP/SSH | ❌ 不移植 |
| 数据上传 | dsh 的 `dsh_session_log` 默认会把会话日志片段上传到 DeepSeek 端点 | ❌ 明确禁用/不启用；本项目后端不上传会话内容 |
| 品牌 | DeepSeek 名称与标识受品牌规范约束 | ❌ 不在插件命名/宣传中使用 |

MIT 允许借鉴与再分发，但本项目**独立重写**，不复制源码与长段文档；如未来复用代码片段，需保留版权与许可声明，并更新本目录与 `THIRD_PARTY_NOTICES`。

## 4. 文档地图

- `architecture-notes.md`：8 个可借鉴机制的归纳与到本仓库的映射。
- `gap-matrix.md`：15 条已证实缺口 → dsh 机制 → 决定 → 证据（文件:行）。
- `integration-dsh.md`：可选后端设计、spike 检查表、安全边界、失败回退。
- `sources.json`：来源 URL、访问日期、置信度、备注。

## 5. 维护约定

- 上游是 developer preview：每季度或每次接入前复核 `sources.json` 的链接与结论。
- 新增结论必须写进 `sources.json` 并标注置信度；无法确认的写“未验证”，不猜测。
- 文档只写归纳，不贴上游原文段落；引用命令/路径必须逐字准确。

# M5 平台化评估（不默认实施）

> 评估基线：v4.30.0 + v4.31.0（M4 第二批）· 2026-11-05
> 结论先行：**M5 全部四项（公共插件 API / MCP / 模板市场 / 云协作）本轮均不实施**，仅冻结边界与重评条件。理由见 §3；触发重评的量化条件见 §4。

## 1. 评估范围与当前事实

| 方向 | 现状 | 缺口 |
|---|---|---|
| 公共插件 API（registerTool/step/exporter） | `engine/agent/harness/host-tools.ts` 已有内部工具注册表；`ENGINE_NAMES` + `EngineRegistry` 已是事实上的内部 DI；导出器是 `engine/export/*` 内部实现 | 没有 SemVer 承诺、没有外部插件的身份/权限模型、没有 breaking-change 治理流程 |
| MCP（Model Context Protocol） | Agent Harness 已是“会话+工具循环”，dsh 后端走 JSON-RPC | 缺少标准 MCP server 进程模型、capability 协商、与 Obsidian 生命周期的安全绑定 |
| 模板市场 | `元文件/`+vault 覆盖 + PromptManager 已支持导入/导出片段 | 无分发渠道、无签名/审核、无版本兼容矩阵（提示词强依赖 `${writingRules}` 等注入契约） |
| 云同步/协作 | 全数据本地（vault + 插件目录）；`withWriteLock` 是单进程锁 | 无冲突解决（CRDT/OT）、无账号体系、结算/指纹等 JSON 状态多端合并风险高 |

## 2. 逐项评估

### 2.1 公共插件 API

- 收益：第三方可注册工具/步骤/导出器；生态扩展。
- 代价：`CommandIds`/step keys/注入契约（`${writingRules}`、`${lensDeclaration}`）会变成对外承诺；每次内部重构都要走 deprecation 周期。
- 风险：Agent 工具具有文件系统写权限（v4.27.1 起覆盖需确认），开放注册等于把安全边界交给第三方。
- 判断：**暂缓**。内部先把 `EngineRegistry` 的 token/Dispose 契约治理好（ADR-001/002），外部化等出现真实第三方需求再立项。

### 2.2 MCP

- 收益：让 Claude Desktop 等宿主直接驱动本插件的工具（读设定/写正文/结算）。
- 代价：需要独立进程 + stdio/HTTP server，而 Obsidian 插件运行在渲染进程内；dsh 经验（`docs/research/deepseek-harness/`）表明外部进程+密钥传递+Windows ComSpec 兼容成本不小。
- 风险：MCP 工具权限粒度粗，容易绕过 v4.27.1 的“覆盖需确认”策略。
- 判断：**暂缓**。可先做只读实验分支（仅 list/read 工具），不进主线。

### 2.3 模板市场

- 收益：分发规则/提示词/指纹包。
- 代价：提示词与注入变量强耦合（v4.26.0 起 `${craftConstraints}` 已删除、六块质控结构变更过两次）；市场包需要“兼容性元数据 + 失效检测”，否则会重演“版本号相同内容不同”事故。
- 判断：**暂缓**。短期用「导入/导出片段 + AssetRegistry 显示来源版本」覆盖 80% 需求；等 ADR-011 AssetRegistry 稳定后再评估。

### 2.4 云同步/协作

- 收益：多设备/多人协作。
- 代价：账号体系、计费、隐私合规全部超出插件形态；`data.json` 含加密密文（口令派生），多端同步密文与口令策略冲突。
- 判断：**不做**。官方建议是用户自选 Obsidian Sync/iCloud 等同步盘；v4.27.0 已对同步盘写锁做超时兜底。

## 3. 总体结论

M1–M4 已交付的主线价值（可信门禁、统一入口、短篇/剧本闭环、资产/账本/备份）覆盖了当前用户的核心路径；平台化四项都存在“收益不确定 × 治理成本确定”的结构，且安全模型（Agent 写权限、密钥）尚未经过大规模真实用户检验。**维持路线图设定：M5 仅评估，不实施。**

## 4. 重评条件（满足任一再立项）

1. **外部需求信号**：出现 ≥3 个独立的第三方集成诉求（issue/讨论），且无法用「导入导出片段 + 命令深链」满足。
2. **契约稳定指标**：`resolveStepPrompt` 注入变量、step keys、`VersionedDoc` 契约连续两个大版本无 breaking change。
3. **安全基线**：Agent 写入确认/审计日志（按项目归因的用量账本 v4.31.0 是第一步）运行 ≥1 个版本且无可绕过反馈。
4. **M4 收尾完成**：`co-writing-view.ts` 降至 ≤3,000 行、模式文档注入与账本归因覆盖率 ≥90%（`(未归因)` 占比 ≤10%）。
5. **有专人维护**：平台化新增的 SemVer/deprecation 流程有明确 owner。

## 5. 本轮已完成的前置铺垫（供未来复用）

- 内部 DI 与生命周期：`EngineRegistry`（dispose/scope/lazy）。
- 工具注册与审批：Harness `sideEffect` 三级 + 审批超时 fail-closed（ADR-009）。
- 资产契约：`VersionedDoc`/`hashContent`/`selectActive`（`shared/versioned-registry.ts`）+ AssetRegistry 只读聚合（v4.30.0）。
- 归因与账本：`UsageScope`（source/project/stepKey，v4.31.0）——未来任何外部 API 的审计地基。

# 双自动化运维（Trae / ZCode）

> 适用版本：v4.52.0+ · 更新：2026-11-06
> 目标：两套 30 分钟循环各自动作、互不踩脚，且只有一个状态真相源。

## 1. 角色与文件集

| 体系 | 职责 | 可写范围 | 禁区 |
|---|---|---|---|
| Trae | 功能实现、测试、文档、导出规范、UI 切片 | `ui/**`、`shared/**`、`services/**`、`tests/**`、`docs/**`、`scripts/**`、`core/**`（经确认）、`main.ts`（经派工确认）、`.trae/automation/**`（仅本轮状态台账） | `engine/**`、`ui/views/writing-fingerprint-view.ts`、`ui/views/fingerprint-v2-detail.ts`；不 commit/push/tag/Release |
| ZCode | engine 侧实现、统一 preflight、分批提交、版本节点、远端发布授权后执行 | `engine/**`、全仓库提交 | 不单方面改 Trae 的循环条件；不 push/tag/Release（需用户授权） |

跨目录引用一律 `@/` 别名；新文件内联样式基线 0；导出函数 JSDoc 带 `@example`；改 `docs/progress/program-status.json` 必须 `npm run program:render`。

## 2. 循环配置

- Trae：定时任务 `af06e242`，每 30 分钟，Asia/Shanghai。任务内容含「状态盘点 → 动态候选池 → 自适应评分 → 决策阶梯 → 小步验证 → 反馈闭环 → 双向派工」。
- ZCode：由用户侧创建的同频自动化；每轮轮询信箱 → 核对 Trae diff → `npm run preflight:release` → 分批提交/版本节点 → 回执并派下一批。
- 并发护栏：工作树有非本批次改动时跳过本轮；`constraints.backlog.newPathBudget` 为 0 时不新增待提交文件（当前值以状态台账为准，本手册不抄数字）。

## 3. 状态与交接

| 资产 | 唯一位置 | 说明 |
|---|---|---|
| 循环状态 | 插件仓 `.trae/automation/trae-loop-state.json` | 含 round、params、typeWeights、constraints、lastRound；保留最近 12 轮 |
| 旧副本 | Vault 根同路径 | **禁止存在**；仅允许 `stale: true` + `supersededBy` tombstone |
| 交接快照 | Vault 根 `PROJECT-RULES.md` 的 `<!-- HANDOFF:START -->` | ≤10 行，含 `当前阶段`/`最近交付`/`正在进行`/`下一步（ZCode）`/`下一步（Trae）`/`待确认` |
| 信箱 | Vault 根 `.trae/mailbox/` | `novel-mailbox` 消息通道；不是状态真相源 |

`npm run check:automation` 校验：状态 schema、round 单调且顶层 round / `lastRound.round` / `rounds` 末条一致、`updatedAt` 带时区、类型权重（含 `v5-product`）、红线字段、旧副本 tombstone（`stale: true` 且 `supersededBy` 指向插件仓同路径）、HANDOFF 字段与行数（`当前阶段`/`最近交付`/`正在进行`/`下一步（ZCode）`/`下一步（Trae）`/`待确认`，≤10 行）、版本四文件一致；信箱可解析仅告警、不阻断。该命令已挂在 `npm run preflight`。

## 4. 互调流程

1. 任一方要改循环条件/评分参数/红线，先往对方信箱发消息（subject：`自动化变更`）。
2. 对方回信确认后生效；未确认前按旧规则执行。
3. 变更落地后同步 handoff 快照与本手册。
4. 用户拍板事项（push/tag/Release、产品语义、数据迁移）不走互调，必须信箱留言并告知用户。

## 5. 故障处理

- **信箱 MCP 不可用**：用脚本兜底：设置 `MAILBOX_ME=trae`、`MAILBOX_ROOT=<vault>/.trae/mailbox`，通过 `scripts/mailbox-server.mjs` 的 stdio JSON-RPC 收发；注意默认 root 会落到 `.obsidian/.trae/mailbox`，必须显式覆盖。
- **状态文件双份**：以插件仓为准；Vault 根副本改为 tombstone 或删除。
- **积压过多**：`constraints.backlog` 的 `newPathBudget` 归零，只改既有未提交文件；请求 ZCode 分批提交。
- **门禁红灯**：先修红灯再加入新批次；不得用 `--update-baseline` 掩盖新增违规（棘轮只降不升）。
- **自动化误判**：在状态文件记录 `premiseVerificationRequired` 的复核结论，下一轮按实测而非估算选点。

## 6. 每轮收尾检查表

- [ ] 状态文件已追加本轮记录（动作/候选/评分/结果/是否回退）
- [ ] 相关单测通过，全量门禁至少跑一次
- [ ] 信箱回执已发（模块/行数/测试/门禁/参数变化）
- [ ] handoff 快照已更新
- [ ] 未越红线，未新增未授权文件

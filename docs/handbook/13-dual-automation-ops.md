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

## 7. 优化方向自动判断（`npm run automation:advise`）

把提示词里的「候选池 → EV 评分 → 决策阶梯」固化为可执行模块，避免每轮靠模型自由发挥。

### 7.1 命令与产物

| 命令 | 用途 |
|---|---|
| `npm run automation:advise` | 人类可读摘要：层级、推荐 1–2 条、依据与数据证据 |
| `npm run automation:advise -- --json` | 结构化 JSON，供 ZCode/CI 消费 |
| `npm run automation:advise -- --write` | 落盘插件仓 `.trae/automation/optimization-advice.json`（gitignore） |
| `npm run automation:advise -- --check` | 自检：能生成建议、已落盘建议 schema/round 新鲜 |

产物字段：`schemaVersion`、`generatedAt`（带时区）、`round`、`head`、`ahead`、`worktree`、`tier`、`tierLabel`、`recommended`、`alternatives`、`warnings`、`inputs`。每个推荐项含 `score`、`factors`、`reason`、`evidence`，人工只需核对证据是否与代码事实一致。

### 7.2 数据源

| 维度 | 来源 | 用途 |
|---|---|---|
| 运行状态 | `git status/HEAD/ahead`、canonical 台账 `round/rounds/params` | 在途收口、同型连续性、失败/回退 |
| 门禁压力 | `constraints.gateMargins`（`preflight`/`any`） | 红灯优先、any 长尾收口 |
| 体积 | `.bundle-baseline.json` + `params.startupEvalBaselineBytes` | 显著膨胀（>20KB 或 ≥1%）才生成 perf 候选 |
| 测试规模 | `docs/progress/program-status.json` | 连续三轮无新增用例时提示补测 |
| 文档漂移 | `PROJECT-RULES.md` HANDOFF + `package.json` 版本 | 版本不一致 / 快照超过 24h |
| 派工 | `.trae/mailbox/messages.jsonl` 最近 40 条 | 只认「第 N 轮 > 当前轮次」的新派工；无轮次按 6 小时时效 |

### 7.3 决策阶梯与评分

- 层级：`dispatch`（新派工）> `backlog`（在途收口）> `gate`（preflight 红灯）> `score`（评分选择）> `idle`。
- 在途收口口径：只统计「未在台账登记的脏路径」（与 `lastRound.changedFiles` + `backlog.untracked` + `backlog.inFlightPaths` 求差集）；已登记待收单只产生告警，不锁定层级——Trae 不 commit，否则每轮恒为 `backlog`。
- 评分：`EV = 影响 × 风险降低 × 可验证性 / 成本 × 类型权重`，再乘多样性（同型连续 -20%/轮，下限 0.4）、失败/回退惩罚、收益递减（0.9^n，下限 0.7）、探索加成（`explorationRoll < explorationRate` 时 +15%）。
- 连续同型达到 `forcedTypeSwitchAfter` 时标记 `forcedSwitch` 并减半；无派工时直接排除，保证强制换型。
- 全部判断确定：探索只读台账 `explorationRoll`，不使用随机数；同一输入必得同一输出。

### 7.4 扩展方式

新增优化方向只需两步：①在 `shared/optimization-advisor.ts` 的 `detectAdvisorCandidates` 注册一个探测器（返回带 `reason`/`evidence` 的候选）；②在 canonical 台账 `params.typeWeights` 增加该类型权重，并同步 `check-automation` 的类型白名单与 `AdvisorType`。评分、排序、强制换型自动生效。

### 7.5 门禁与验证

- `npm run check:automation` 在建议台账存在时校验：`schemaVersion=1`、`generatedAt` 带时区、`tier` 合法、`recommended` 1–2 条且含 `id/type/reason/evidence`、`round` 落后不超过 1 轮；缺失时只提示、不阻断。
- 单元测试 `tests/unit/shared/optimization-advisor.test.ts` 锁定：派工优先、在途优先于红灯、同型惩罚、回退惩罚、强制换型、探索加成、陈旧派工过滤、推荐数量上限。
- 每轮执行顺序：先 `automation:advise`（建议）→ 核对 evidence → 按层级执行 → 收尾时 `--write` 刷新建议台账。

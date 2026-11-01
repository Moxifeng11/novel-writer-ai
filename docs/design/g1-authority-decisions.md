# G1 权威源决策（关系双通道 / 结算语义与回滚）

> 版本：v1 · 定稿：2026-11-01
> 适用：`docs/PROGRAM.md` 任务组 G1 的 G1-12、G1-13
> 状态：**已决策 + 已实现**（2026-11-01；G1-12a/b、G1-13a/b/c 全部落地，验收证据见各节表格与 PROGRAM 台账）

---

## 一、G1-12：关系数据的权威源

### 1.1 现状（取证）

| 通道 | 写入方 | 内容形态 | 幂等性 |
|---|---|---|---|
| V1 实体卡「与其他角色的互信息」 | `engine/settlement-engine.ts:1323 updateRelation` → `appendToMutualSection`（:1363） | 自由文本行 `- [[B]] \| 类型 \| 描述 \| 章` | 无内容级去重（仅整文件加锁），重复结算会追加重行 |
| V2 `01-世界架构/关系状态.md` | `engine/relationship-engine.ts`（`applyRelationshipChanges` :199 / `saveRelationshipStates` :291），由 `settlement-engine.ts:1245 settleStep_updateV2Relations` 调用 | 5 个数值维度（信任/吸引/恐惧/怨恨/依赖）+ status + history（`章名: 原因`） | history 以「章:原因」为键，重跑同章同原因跳过 |

读取方（机器消费）**全部只读 V2**：

- 章节状态快照：`engine/chapter-state-snapshot-service.ts:138 loadRelationshipStates → mapRelationships`
- 关系驱动 prompt：`engine/prompt-builder.ts:672 getRelationshipDriverPromptParts`（读快照里的 V2 数值）
- 协同写作：`engine/co-writer-engine.ts:677`
- 上下文装配：`engine/context-manager.ts:2128`

V1 互信息**没有任何生产读取方**：只有实体生成器的提示词要求 AI 产出该分节（`ai-character-generator.ts:191`、`ai-entity-generator.ts:169`），以及结算自己的写入。

### 1.2 选项

| 选项 | 做法 | 代价 |
|---|---|---|
| A. 停写 V1 | 结算不再 append 互信息 | 用户打开人物卡看不到"关系变化时间线"，可读性下降 |
| B. V1 降级为派生日志 + 精确去重 | 保留 append，但按「整行内容」去重；明确不参与任何机器读取 | 人读友好，重复结算不产生重行；需一条硬约束防止未来从 V1 解析 |
| C. 每次结算整段重建 V1 分节 | 从 V2 生成该角色关系摘要，覆盖分节 | 会抹掉 AI/人工写入的更丰富描述，风险最高 |

### 1.3 决策

**采用 B。**

1. **唯一权威源：`关系状态.md`（V2）**。关系数值、状态描述、变更历史只以它为准；快照/prompt/协同/上下文继续只读它，不得新增 V1 解析。
2. **V1 互信息定位为「人读日志」**：结算继续 append，但按**整行内容**去重（重复结算不再堆重复行）；不做数值解析、不作为快照或 prompt 数据源。
3. **硬约束（进代码评审清单）**：`grep "与其他角色的互信息"` 在 `python`/`解析`/`snapshot`/`prompt` 语境下出现即视为违规——新增读取一律走 `loadRelationshipStates`。
4. **迁移**：不清理存量互信息（可能含人工内容）；不做格式迁移；新写入只保证"不重复"。

### 1.4 实现任务与验收

| 任务 | 改动 | 验收 |
|---|---|---|
| G1-12a | `appendToMutualSection`：写入前检查整行是否已存在 → 跳过 | 单测：同章同描述重复结算只留 1 行；不同章仍追加 |
| G1-12b | 约束落地：`PROGRAM.md` 契约 + 评审清单；可选 CI 脚本扫描"从互信息解析关系" | `grep` 检查 0 处机器读取 |

---

## 二、G1-13：`settle` / `settleLight` 语义与回滚范围

### 2.1 现状（取证）

- 弹窗 `ui/chapter-settlement-modal.ts:132 executeSettlement`：有分析报告 → `settle`；没有 → `settleLight`（静默降级）。
- `settle`（`engine/settlement-engine.ts:230` 起）写：实体字段、伏笔库、时间线、关系（V1+V2）、成长、情绪、正文 frontmatter、行为日志、承诺账本、角色弧线、叙事总览。
- `settleLight`（同文件 `:230` 之后的独立方法）只做「出场确认」：`entity_status` / `entity_last_seen_at`，**不写**关系/伏笔/时间线/成长/情绪/账本。
- 两种形态产物没有区分标记：结算表与快照长得一样，用户与后续步骤无法判断本次是"完整结算"还是"仅出场"。
- 回滚：`settleStep_aggregateAndMaybeRollback` + `restoreSnapshots` 只恢复 **frontmatter 字段** 与 **本次新建文件**；追加类写入（关系 V1/V2、成长、连续性账本、互信息、行为日志、时间线行、伏笔行）**不在回滚范围**。

### 2.2 决策

**决策 1：两种结算语义显式化，不允许静默降级**

- `settle` = 完整结算，唯一可写关系/伏笔/时间线/成长/情绪/账本。
- `settleLight` = **出场确认**，不是"缩水版完整结算"：只写 `entity_status` / `entity_last_seen_at`。
- 弹窗在缺分析报告时必须先告知：`「未找到分析报告：将执行轻结算（仅记录出场，不更新关系/伏笔/时间线）」`，用户确认后执行；执行结果与结算表 frontmatter 都写 `settlement_mode: light|full`。
- `settle` 收到空指令集（报告解析出 0 条）时**不得**伪装成功：返回 `mode: 'empty'` 并提示"报告无可应用指令"，由调用方决定是否改为轻结算。

**决策 2：回滚以「结算日志（journal）」为准，覆盖追加类写入**

- 每次 `settle` 生成一个 run 级 journal，条目三类：
  1. `frontmatter-field`：恢复字段原值（现有 `snapshots` 升级为统一 journal）；
  2. `whole-file-before`：整份文件前值（关系状态.md、伏笔库、时间线看板、结算表）——仅在本次确实改写时记录；
  3. `append-marker`：追加的确切内容（成长行、连续性账本片段、互信息行、行为日志行、时间线行、伏笔行）——回滚按 marker 精确移除该行/片段，而不是整文件回退（避免抹掉期间其他入口的合法写入）。
- `hasPartialFailure` 时按 journal **逆序**回滚；任一回滚失败 → `NOTICE_CRITICAL` + 在结算表标 `settlement_partial: true`，并提示用户用版本历史恢复。
- 本版 journal 为**内存态**（随 run 生命周期）；磁盘持久化（崩溃后可恢复）列为 P2，不阻塞本决策落地。

### 2.3 实现任务与验收

| 任务 | 改动 | 验收 |
|---|---|---|
| G1-13a | 弹窗轻结算确认 + `settlement_mode` 写入结算表/快照；`settle` 空指令集返回 `empty` | E2E/单测：无报告 → 出现确认文案；产物 frontmatter 有 `settlement_mode: light` |
| G1-13b | 统一 `SettlementJournal`（frontmatter/整文件/追加标记），失败逆序回滚 | 单测：注入 partial failure → 关系数值/成长行/时间线行全部回到结算前；期间他处合法写入不被误删 |
| G1-13c | 失败可见性：回滚失败 critical + `settlement_partial` 标记 | 单测：模拟恢复失败 → 有 critical 通知与标记 |

---

## 三、对其它任务组的影响

- **G2（语料链）**：知识库→指纹转换不得读取实体卡互信息作为关系依据（本决策 §1.3 约束适用于新代码）。
- **G6（性能）**：V1 去重让重复结算的写放大下降；journal 只在失败时回滚，不增加正常路径 IO。
- **G7（质量基建）**：`SettlementJournal` 的三类条目需要各自的最小单测（对应 PROGRAM G7-6「结算引擎 0 直测」）。

---

## 四、决策记录

| 日期 | 决策 | 理由 | 影响 |
|---|---|---|---|
| 2026-11-01 | V2 关系状态.md 为唯一权威源；V1 互信息降级为人读日志 + 整行去重 | 机器消费方（快照/prompt/协同/上下文）已全部只读 V2；V1 无读取方，且自由文本无法可靠解析 | 关系数值口径唯一；V1 不再无限增长 |
| 2026-11-01 | `settleLight` 显式标记为「出场确认」，禁止静默降级；`settlement_mode` 落盘 | 两种产物此前不可区分，用户与后续步骤会误判数据完整度 | 产物可追溯；UI 需一次确认交互 |
| 2026-11-01 | 回滚以 run 级 journal 覆盖追加类写入；失败标 `settlement_partial` | 现有回滚只撤 frontmatter，关系/伏笔/时间线/成长会留下半套数据 | 结算可安全重跑；需要 3 类条目的单测 |

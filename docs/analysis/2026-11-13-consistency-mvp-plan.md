# 跨章一致性审核 · 现状盘点与五步实施计划

> 日期：2026-11-13 · 前置调研：`docs/analysis/2026-11-13-consistency-bottleneck-research.md`
> 目标：先摸清插件已有资产，再定五步计划。**结论是「复用为主」，实际要新建的比预想少一半。**

---

## 一、现状盘点

### 1.1 事实原料（已存在，可直接复用）

| 层 | 载体 | 关键字段 | 谁生成 | 复用价值 |
|---|---|---|---|---|
| **章节事实** | `ChapterDigest`<br>`engine/memory/chapter-digest.ts`（361 行）| `chapterKey` `chapterNum` `title`<br>`involved[]` `events[]` `unresolved[]`<br>**`facts[]`** **`timeSpan`** `promises[]` `endingHook` | LLM 摘要（settlement 调用）| ⭐⭐⭐ **直接是断言原料** |
| **结构化台账** | `engine/ledger/*`（1476 行 / 6 文件）| `EventRecord`: `time` `chapterNum` `chapterKey` `era` `location` `entityRefs` `foreshadowRefs` `impact` `type` `importance` `status` `sourcePath` **`lineNo`** `raw`<br>`ForeshadowRecord`: `status`(unrevealed/revealed/**abandoned**/unknown)<br>`PromiseRecord` `RelationRecord` `LinkRecord` | `ledger-parse`（解析**手工表格**：时间线看板 / 伏笔库）| ⭐⭐⭐ 模型 + IO + 索引 + 原子写全有 |
| **实体档案** | `CharacterFrontmatter`<br>`shared/types.ts`（659 行）| **`年龄`** `身份` `性别` `首次出场` **`当前位置`** `性格标签` `金手指/特殊能力` `功法/技能树` **`修为等级`** `所属势力` **`外貌特征`** `当前状态` `当前情绪` `当前目标` | 用户手填 + AI 生成 + `EntityStateManager` 按章更新 | ⭐⭐⭐ **天然的结构化事实**，最适合做值比对 |
| **状态变更** | `EntityStateManager`<br>`engine/entity-state-manager.ts`（478 行）| `EntityChangeType` = character / location / prop / relationship / foreshadow / plotNode | settlement | ⭐⭐ 变更流水可用于时间线推理 |
| **设定库** | `元文件/05-同人设定库`、项目 `05-同人设定库` | Markdown | 用户 / AI | ⭐⭐ 世界规则来源 |
| **正典来源** | `shared/canon-source.ts` | tier 分级 / 引用覆盖率 | — | ⭐ 与一致性无关（同人溯源用） |

### 1.2 已有检查能力

| 模块 | 行数 | 覆盖 | 实现方式 | 局限 |
|---|---|---|---|---|
| `engine/quality/quality-score-engine.ts` | **1848** | 36 项：`readability` `rhythm` `emotion` `texture` `char` `coherence` | 文本统计 + 规则 | **全是单章表面质量** |
| `engine/character-consistency-checker.ts` | 447 | `personality` `behavior` `ability` `appearance` | 标签匹配 | 单章、单实体，无跨章比对 |
| `engine/logic-consistency-checker.ts` | 124 | `time_conflict` `injury_action_conflict` `knowledge_boundary` `location_jump` `identity_conflict` | **关键词启发式**（同段昼夜词同现 → 报时间跳变） | 抓不到语义矛盾 |
| `engine/coherence-checker.ts` | 107 | `duplicate_sentence` `repeated_phrase` `overused_word` | 文本统计 | 局部重复 |
| `engine/ledger/*` `LedgerIssue` | — | 8 种**格式**问题：`unknown-row` `duplicate-row` `unresolved-entity` `ambiguous-entity` `out-of-order` `invalid-chapter` `duplicate-event` `missing-column` | 表格校验 | **不含语义矛盾** |
| `engine/review-agent.ts` | — | 章节审查 | — | 维度有限 |
| UI：`quality-dashboard-modal.ts`(453) `quality-highlight.ts`(98) `quality-popup.ts`(142) `quality-report.ts`(115) `quality-fix.ts`(129) | 937 | 质量看板 + 高亮 + 弹窗 + 报告 | — | **呈现层可整体复用** |

### 1.3 缺口（本次要做的事）

| 缺口 | 现状 |
|---|---|
| **① 无跨章语义矛盾检测** | `facts[]` 之间互不比对；正文 vs `年龄/外貌特征/修为等级` 不比对；`EventRecord.time` 之间不检查时长/同时性 |
| **② 断言层缺失** | 事实以「自由文本」散落在 digest / frontmatter / 表格三类载体，没有可比较的统一结构 |
| **③ 无证据定位** | `ChapterDigest` **不记录字符偏移**（已确认），现有 issue 都不带原文引文位置 |
| **④ 无风险定位** | 没有按「中段 / 高熵」挑段，若全量送 LLM 会烧 token |
| **⑤ 无一致性指标** | 有质量分（0-100），但没有「每万词错误数（CED）」这种可对比指标 |

---

## 二、复用地图（关键：少建一半）

```
已有                                 新建（薄）
─────────────────────────────────────────────────────────────
ChapterDigest.facts[] ─┐
CharacterFrontmatter ──┼──► [S1] 断言层 ──► [S2] 配对 ──► [S4] UI
EventRecord.time ──────┘        (新)           (新)         (复用 quality-*)
   ▲ 复用类型/存储/原子写                     ▲ 复用 callAI
   │                                          │
ledger-io / ledger-model ◄────────────────────┘
```

**预计新建代码量**（含测试）：

| 步骤 | 生产代码 | 测试 | 说明 |
|---|---|---|---|
| S1 断言层 | ~350 行 | ~200 行 | 纯函数多，好测 |
| S2 配对器 | ~450 行 | ~300 行 | 规则层 + LLM 层 |
| S3 风险定位 | ~150 行 | ~100 行 | 算法为主 |
| S4 审核视图 | ~350 行 | ~80 行 | 复用现有高亮/弹窗 |
| S5 CED 指标 | ~120 行 | ~80 行 | 纯计算 |
| **合计** | **~1420 行** | **~760 行** | 相比「从零建」约省 60% |

---

## 三、五步计划

### S1 · 断言层（Assertion Layer）

**目标**：把三类异构事实归一化成**可比较的断言**，不新增 AI 调用。

**新建**
- `engine/consistency/assertion-model.ts`
  ```ts
  /** 断言种类：映射 ConStory-Bench 19 子类 */
  type AssertionKind =
    // Factual & Detail（P0）
    | 'nomenclature'      // 命名混淆：同一实体不同称呼
    | 'quantitative'      // 数量不符：年龄/距离/金额/人数
    | 'appearance'        // 外貌不符
    // Timeline & Plot（P0）
    | 'absolute-time' | 'duration' | 'simultaneity'
    | 'causeless-effect' | 'causal-violation' | 'abandoned-plot';
  interface FactAssertion {
    id: string;
    kind: AssertionKind;
    subject: string;        // 人/地/物/事件
    predicate: string;      // 年龄 / 距离 / 位置 / 能力 / 时间点
    value: string;          // 归一化后的值（数值型带 unit）
    unit?: string;
    chapterKey: string;
    chapterNum: number | null;
    quote: string;          // 原文引文
    offset?: number;        // S2 定位后回填
    source: 'digest-fact' | 'digest-time' | 'frontmatter' | 'ledger-event';
  }
  ```
- `engine/consistency/assertion-extract.ts`（纯函数）
  - 从 `ChapterDigest.facts[]` 抽 `量化/命名/外貌` 断言（正则 + 中文字数词表）
  - 从 `ChapterDigest.timeSpan` + `EventRecord.time` 抽 `绝对时间/时长` 断言
  - 从 `CharacterFrontmatter` 抽 `年龄/修为等级/当前位置/外貌特征` 断言（`source: 'frontmatter'`）
  - **抽不出的不硬抽**（宁可少，不要脏）
- `engine/consistency/assertion-store.ts`
  - 落盘 `<project>/.consistency/assertions.json`，**复用 `ledger-io` 的原子写与锁**

**复用**：`ChapterDigest`、`CharacterFrontmatter`、`EventRecord`、`withWriteLock`、`writeJsonAtomic`

**不做**：不改 `chapter-digest` 的 LLM prompt（避免动既有行为/成本）

**验收**
- 构造样本 20 章：量化断言召回 ≥80%（相对人工标注）
- 纯函数单测 ≥15 条；无网络依赖
- **零新增 AI 调用**（可用 mock 断言 `callAI` 未被调用）

---

### S2 · 矛盾配对器（Contradiction Pairing）

**目标**：检测矛盾并输出**证据链**（这是与现有启发式检查的本质区别）。

**新建**
- `engine/consistency/pairing-rules.ts`（**零 token**，全量跑）
  - 同 `subject + predicate` 且 `value` 不等 → `suspected`
  - 数值型带 unit 比较（年龄差、距离差、金额差）
  - 时间区间不相容（`duration`/`simultaneity`）
  - `ForeshadowRecord.status === 'abandoned'` 且从未回收 → `abandoned-plot`
  - 名称别名表冲突 → `nomenclature`
- `engine/consistency/pairing-llm.ts`（**只对 `suspected` + 高熵段调用**）
  - 严格 JSON 输出：`{reasoning, evidenceA:{quote,chapterKey}, evidenceB:{quote,chapterKey}, conclusion:kink}`
  - 无 `reasoning` 或无双侧引文 → **丢弃**（不产出无证据 issue）
- `engine/consistency/evidence-locate.ts`
  - 用 `quote` 在章节正文里做 substring 定位得到 `offset`（**不改 digest 就能拿到精确位置**）
- `engine/consistency/contradiction-report.ts`
  - 证据链 JSON + 人类可读摘要

**复用**：`AIApiClient.callAI`（已有密钥回退修复）、`ChapterDigest`、正文读取、`ForeshadowRecord`

**不做**：不做自动改写正文（红线）；不判「写得不好」

**验收**
- 构造样本：9 子类 × ≥3 条 = ≥30 条矛盾，召回 ≥80%，误报 ≤10%
- 每条 issue 必含 `type + reasoning + 双侧 quote + 双侧 offset`（缺一不算命中）
- 回归锁：把「规则层值比较」改回恒 false → 测试必须变红
- LLM 层调用次数有上限断言（省 token 可验证）

---

### S3 · 风险定位（Risk Targeting）

**目标**：只审高风险段，把 LLM 成本压到 40% 以内仍保召回。

**新建** `engine/consistency/risk-targeting.ts`
- **中段加权**：位置 ∈ [0.3, 0.7] 的分段加分（论文实证）
- **熵近似**：用本地统计（字符分布熵 / 罕见词密度 / 句长方差）近似 token 熵，**不调 API**
- **类型共现预取**：命中 `quantitative` 时顺带扫 `nomenclature`（论文实证共现）
- 输出：`{segments: [{chapterKey, start, end, score, reason}]}`

**复用**：纯本地计算，无新依赖

**验收**
- 构造集上只审 ≤40% 段落，召回 ≥85%（对照 S2 全量的结果）
- 单元测试覆盖权重函数与阈值边界

---

### S4 · 审核视图（UI）

**目标**：让用户看到证据链并一键跳到正文对应位置。

**新建/改造**
- 改造 `ui/quality-dashboard-modal.ts` 增「一致性」Tab（不新建独立 Modal，减少入口分散）
- 新增 `ui/consistency-issue-list.ts`：类型徽章 / 双引文 / 章节 / 「跳到正文」
- 复用 `quality-highlight.ts`（已有高亮）、`quality-popup.ts`

**复用**：`ui/quality-*.ts`（937 行）

**验收**
- 点击 issue → 打开对应章节并定位到 offset（用 `editor.setCursor`）
- 空态引导（无 issue 时说明检查范围与依据）
- 不破坏现有质量看板任何功能（现有测试全绿）

---

### S5 · CED 指标

**目标**：可证明改进幅度。

**新建** `engine/consistency/consistency-metrics.ts`
- `CED = 错误数 / (词数 / 10000)`（论文口径，越低越好）
- 按类型分组 CED；进 `quality-history-store` 做趋势

**复用**：`services/quality-history-store.ts`

**验收**
- CED 计算有单测（含除零、空集）
- 看板显示当前 CED 与趋势

---

## 四、执行顺序与批次

| 批次 | 步骤 | 可独立交付 | 依赖 |
|---|---|---|---|
| **第 1 批** | S1 + S2 | 是（命令行可跑，无 UI） | — |
| **第 2 批** | S3 | 是（优化成本） | S2 |
| **第 3 批** | S4 + S5 | 是（用户可见） | S1/S2 |

**先做 S1+S2 的理由**：这两步决定成败（能不能真抓到矛盾、证据是否可信）；S3 是成本优化，S4/S5 是呈现。若 S1/S2 在构造样本上达不到召回/误报指标，后面三步没有意义。

---

## 五、明确不做

| 不做 | 原因 |
|---|---|
| 改 `chapter-digest` 的 LLM prompt | 会动既有行为与成本；用 substring 定位替代 |
| 自动改写正文 | 破坏可回退性（红线） |
| 全量 19 子类一次做齐 | 先 9 子类（Factual 3 + Timeline 6），论文实证占大头 |
| 训练/微调 | Obsidian 前端无训练能力 |
| 再堆关键词反例表 | 现有 `logic-consistency-checker` 已证明收益递减 |
| 把 UI 做成新独立入口 | 入口分散是现有痛点；并入质量看板 |

---

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| 断言抽取质量差 → 后续全错 | S1 先只做「高置信度」模式（显式数字 + 显式称谓），宁少不脏；用构造样本量召回 |
| LLM 判矛盾误报高 | 只判 `suspected`；无双侧引文即丢弃；误报率作为验收硬指标（≤10%） |
| token 成本失控 | S3 定位 + 规则层全量免费；LLM 调用次数在测试里断言上限 |
| 中文数量词/时间词复杂 | 建有限词表（万/亿/丈/里/岁/载/时辰/更），覆盖常见网文写法，超纲不抽 |
| 与现有 `logic-consistency-checker` 重复 | 保留旧检查器（单章启发式仍有价值）；新模块专注**跨章语义**，职责不重叠 |

---

## 七、执行进度（2026-11-13）

### ✅ 第 1 批（S1 + S2）已完成并生产验证

| 步骤 | 状态 | 提交 | 新增 |
|---|---|---|---|
| S1 断言层 | ✅ 完成 | `db29b52` | `shared/narrative-number.ts`、`engine/consistency/assertion-model.ts`、`assertion-extract.ts`、`assertion-store.ts` |
| S2 配对器 | ✅ 完成 | `49f9136` | `pairing-rules.ts`、`evidence-locate.ts`、`pairing-llm.ts`、`audit-pipeline.ts` |
| S2 接线+命令 | ✅ 完成 | `81164cb` | `consistency-service.ts`、`consistency-audit-wiring.ts`、命令「一致性审核」 |

**测试**：一致性相关 103 条（narrative-number 23 / extract 20 / store 14 / rules 22 / llm 16 / locate 10 / pipeline 11 / service 10）+ 4 条架构锁（断言层不得 import AI）。

**生产实测**（真实 vault，构造矛盾项目）：

```
断言库：6 条断言（摘要 4 + 人物档案 2）
报告：1 处矛盾 · 数量不符
  第1章「张三」20 岁，到第40章反而变成 18 岁——年龄不可能倒退
  evidenceA: 张三今年二十岁 @第1章 #11
  evidenceB: 张三今年十八岁 @第40章 #12
llmCalls = 0（规则层已判定，未产生模型费用）
```

### 实施中修正的三处设计（原计划与现实的偏差）

| 原计划 | 现实 | 调整 |
|---|---|---|
| 断言层要「新建事实抽取」 | `ChapterDigest.facts[]` / `CharacterFrontmatter` / `ledger.EventRecord` **已有原料** | 改为规则化归一，**零 AI 调用**（架构锁保证） |
| 主语正则排除数词更安全 | 中文人名**常含数词**（张三/李四），排除后最常见名字全废 | 改为「有连接词则信任；无连接词且含数词则丢弃」（宁少不脏） |
| 抽取阶段记录字符偏移 | `ChapterDigest` 不存偏移，改 prompt 会动既有行为 | 改为**判出矛盾后用引文反查**（`evidence-locate`，逐级缩短前缀） |

### 新增踩坑记录

**UI 命令必须在 `core/command-registry.ts` 的显式列表里注册执行体**，
否则 `exec(id)` 找不到执行体**静默失效**（命令显示 Executed 但什么也没发生）。
该文件注释已警告此坑，本次原样踩中——建议后续加门禁：每个 `exec()` 用到的
CommandIds 都必须有 `r.register` 或 executor 分支。

### 下一步（第 2 / 3 批）

- S3 风险定位（中段 + 熵近似 + 类型共现）
- S4 审核视图（并入质量看板 Tab，点击跳正文位置）
- S5 CED 指标
- 补齐 2 个子类：无因之果 / 因果违规
- **建议先做的门禁**：命令执行体缺失检测（见上）

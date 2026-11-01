# 架构决策记录（ADR）索引

> ADR 只记录「已做出的、会影响后续实现的决策」，不记录任务进度。
> 新决策使用 [0000-template.md](0000-template.md)，编号递增；被取代时保留原文并标 `Superseded by`。

---

## 索引

| 编号 | 标题 | 状态 | 日期 | 落点 |
|---|---|---|---|---|
| ADR-001 | EngineRegistry 统一引擎生命周期 | Accepted | 2026-10 | `docs/ARCHITECTURE.md` §7、`engine/engine-registry.ts` |
| ADR-002 | Repository 模式与 ports 抽象 | Accepted | 2026-10 | `docs/ARCHITECTURE.md` §7、`engine/repository/`、`shared/file-system-port.ts` |
| ADR-003 | 分层依赖收口（ui → engine/services → shared/core） | Accepted（门禁已清零；文档阶段表可能滞后） | 2026-10 | `scripts/check-dependencies.mjs`、`.arch-baseline.json` |
| ADR-004 | 关系数据以 V2《关系状态.md》为唯一权威源 | Accepted | 2026-11-01 | [design/g1-authority-decisions.md](../design/g1-authority-decisions.md) |
| ADR-005 | 不引入 jsdom 做 DOM 测试 | Accepted | 2026-11-01 | [design/g7-4-dom-testing-decision.md](../design/g7-4-dom-testing-decision.md) |
| ADR-006 | dsh 作为可选后端：默认只读、写入整会话放开 | Accepted | 2026-11-02 | [research/deepseek-harness/integration-dsh.md](../research/deepseek-harness/integration-dsh.md) |
| ADR-007 | 规则/提示词版本化与内容身份（frontmatter + 规范化哈希） | Accepted | 2026-11-02 | `shared/versioned-registry.ts`、`services/rules-registry.ts` |

## 状态定义

- **Proposed**：已提出，未实施。
- **Accepted**：已决策并落地（或在同一 PR 落地）。
- **Superseded by ADR-XXX**：被新决策取代，保留原文。
- **Rejected**：评估后不采用，记录原因避免重复讨论。

## 新增 ADR 的流程

1. 复制 `0000-template.md`，编号取当前最大值 +1。
2. 写清背景、选项、决策、后果（含代价）。
3. 在本表登记一行。
4. 若决策涉及代码约束，尽量同时落成门禁或测试。

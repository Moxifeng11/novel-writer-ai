# diagnose_flow 实现与文档一致性核对（DSH-20261111-01）

> 核对人：ZCode ｜ 时间：2026-11-11 ｜ 基线：`7cfd449`（v4.83.0，ahead 0）
> 范围：只读核对，未修改任何源码；产出仅本文件。
> 取证方式：精读 `engine/agent/harness/diagnose-tools.ts`、`shared/link-status-compute.ts`、`ui/views/link-status.ts` 与三处 UI/宿主接线；对照 `docs/API.md` 第十一章、`docs/ARCHITECTURE.md` 三·4；实跑 3 个相关测试文件（42 例全绿）。

## 核对点总览

| # | 核对点 | 结论 |
|---|---|---|
| ① | 三种 flow（knowledge/style/constraint）+ all 与文档一致 | **一致** |
| ② | 链路环节名称与顺序逐字一致 | **一致** |
| ③ | 「界面与 agent 断点同源」是否真成立 | **一致（真成立）** |
| ④ | 三条判定语义（首个 broken / unknown 不拉低 / 降级→warn） | **部分一致**：代码三条都实现；文档对「全部 unknown 且有降级」的优先级描述不精确 |

---

## ① 三种 flow + all

**文档**：`docs/API.md:1676-1684` 列出 `flow` 取值 `knowledge / style / constraint / all`，`all` 为「要诊断的链路」聚合。

**代码**：
- `engine/agent/harness/diagnose-tools.ts:72`：`enum: ['knowledge', 'style', 'constraint', 'all']`
- `diagnose-tools.ts:80-82`：非法值返回 `flow 必须是 ... 之一`
- `diagnose-tools.ts:85-100`：`all` 分支并行调用三条 `computeByKind`，按有断点数量汇总提示，并把 `statuses` 放进 `data`

**结论：一致。** `all` 的行为（并行三条 + 断点汇总）文档未逐字展开，但属于「聚合诊断」的合理实现，不构成偏差。

## ② 链路环节名称

**文档**：`docs/API.md:1686-1690` 表：

| 链路 | 文档环节 |
|---|---|
| knowledge | 拆解 → 向量化 → 嵌入模型 → 检索 → 归因 |
| style | 指纹库 → 启用 → 强度 → 注入 |
| constraint | 考据 → 设定 → 审核 → 绑定 → 注入 |

**代码（数组顺序即 UI/agent 展示顺序）**：
- 知识流：`shared/link-status-compute.ts:119-122`（拆解）、`:126-140`（向量化）、`:143-149`（嵌入模型）、`:152-163`（检索）、`:166-169`（归因）
- 风格流：`:205-211`（指纹库）、`:214-217`（启用）、`:220-229`（强度）、`:232-240`（注入）
- 约束流：`:265-267`（考据）、`:269-271`（设定）、`:273-283`（审核）、`:285-291`（绑定）、`:293-299`（注入）

**结论：一致**（名称逐字相同，顺序相同）。

## ③ 「界面与 agent 断点同源」

**文档**：`docs/API.md:1692-1693`「判定口径与界面同源：都走 `shared/link-status-compute.ts`」；`docs/ARCHITECTURE.md:217-226` 依赖规则第 4 条「纯逻辑下沉 shared/」，并点名 `shared/link-status-compute.ts` 与 `ui/views/link-status.ts` re-export、`diagnose-tools.ts` 直接 import。

**代码取证**：
- UI 侧：`ui/views/link-status.ts:17-27` 只做 `export { summarizeLink, computeKnowledgeFlowStatus, computeStyleFlowStatus, computeConstraintFlowStatus, formatLinkStatusForAgent } from '@/shared/link-status-compute'`，文件内**没有**第二份判定实现；`:91` 的 `stages.find(broken)` 只用于渲染断点高亮，不参与判定。
- UI 消费方全部经由此 re-export：
  - `ui/views/knowledge-base-view.ts:28`、`:1047`
  - `ui/views/writing-fingerprint-view.ts:30`、`:384`
  - `ui/add-fanfic-setting-modal.ts:29`、`:491`
- Agent 侧：`engine/agent/harness/diagnose-tools.ts:12-21` 直接 import 同一模块；`diagnose-tools.ts:47-52` 调 `computeKnowledgeFlowStatus/computeStyleFlowStatus/computeConstraintFlowStatus`。
- 依赖方向合规：`shared/` 不反向依赖 `ui/`（re-export 在 ui 侧），符合 `ARCHITECTURE.md:217-226` 的「纯逻辑下沉」。
- 测试锚点：`tests/unit/ui/link-status.test.ts:36-60` 锁判定语义；`tests/unit/engine/agent-diagnose-flow.test.ts`（13 例）锁 agent 工具输出；`tests/unit/engine/agent-diagnose-wiring.test.ts`（5 例）锁宿主注入接线（`harness-engine.ts:89`、`:164-166`）。

**结论：一致（真成立）。** 用户界面与 agent 诊断调用的是同一份函数，不存在「界面报断、agent 说正常」的双实现风险。

## ④ 三条判定语义

### 4.1 断点取第一个 broken —— 一致

- `shared/link-status-compute.ts:66`：`const firstBroken = stages.find(stage => stage.status === 'broken')`
- `:81`：`breakpoint: firstBroken ? firstBroken.name : null`
- 整体优先级 `:70-71`：有 broken → `'broken'`（broken 优先于 warn/unknown）
- 测试：`tests/unit/ui/link-status.test.ts:36-49`（双 broken 取第一个；broken 优先于 warn）

### 4.2 unknown 不拉低整体 —— 一致

- `:68`：`const decidable = stages.filter(stage => stage.status !== 'unknown')`
- `:70-77`：只有 `decidable.length === 0`（全部 unknown）且无 warn/降级时才 `'unknown'`；存在可判定环节时报 ok/warn/broken
- 测试：`link-status.test.ts:57-60`（全 unknown → unknown）、`:103-116`（归因 unknown 不拉低整体 ok；空知识库 unknown 不误报断）

### 4.3 运行时降级降为 warn —— 实现一致，但文档表述有一处不精确

- 代码：`:69` `hasDegradation`；`:72-73` `hasWarn || hasDegradation` → `'warn'`（broken 仍优先）
- 测试：`link-status.test.ts:205-230`（`degradations` 参与 overall 并保留在结果里）
- **发现（文档口径遗漏）**：`docs/API.md:1723-1724` 写「全部 `unknown` 才报 unknown」，但按 `:70-77` 的分支顺序，**全部环节 unknown 且存在运行时降级时，overall 实际是 `warn` 而不是 `unknown`**（降级判断先于「全部 unknown」判断）。这符合 4.3「降级必须暴露」的设计意图，但文档没有写明「降级优先于全 unknown」。
  - 影响：低。只有在「三条链路都无静态可判定数据 + 存在降级」的极端场景才会出现，且报 `warn` 比报 `unknown` 更安全（更显眼）。
  - 建议：在 `API.md` §11.3 该条后补一句「若存在运行时降级，即使全部环节 unknown 也报 warn」；不需要改代码。

## 附：其他一致性抽查（未发现问题）

- 工具只读契约：`diagnose-tools.ts:77` `sideEffect: 'none'`，与 `API.md:1670-1674` 注释一致。
- 采集器注入：`API.md:1700-1705` 说「由宿主注入（`AgentHarnessEngineOptions.flowDiagnosis`），engine 不直接持有知识库/指纹库」——`harness-engine.ts:89` 定义可选注入，`:164-166` 仅当注入时注册工具；实现类在 UI 层 `ui/services/flow-diagnosis-collectors.ts:37`，由 `ui/agent-workbench-view.ts:1173` 注入，engine 未持有实例。一致。
- 采集失败可见：`diagnose-tools.ts:107-113` 返回 `ok:false` 并提示服务未初始化，不伪装成功；与「降级必须可见」的长期目标一致。

## 总评

**文档可信**：三种 flow、环节名称顺序、同源关系、三条判定语义均在代码中成立，且有测试锚点；唯一需要修正的是 `API.md` §11.3 对「全 unknown + 有降级」优先级的表述缺失（文档补充即可，代码无需改动）。

**验证命令与结果**：`npx vitest run tests/unit/engine/agent-diagnose-flow.test.ts tests/unit/engine/agent-diagnose-wiring.test.ts tests/unit/ui/link-status.test.ts` → **3 文件 / 42 例全部通过**。

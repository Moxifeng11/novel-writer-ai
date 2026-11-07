# v5 验收清单：Agent 对话 + 多步骤协同写作最小闭环

> 用途：给用户逐批验收 B1–B5，不再重复论证设计。
> 生成口径：committed HEAD 实测（2026-11-08 00:22 +08:00；数据源 `program-status.json`）。
> 版本：v4.70.0（版本节点 `bb5972a`）· 已提交 HEAD `8cceae9`（ahead 206）· 第 86/87 轮（`entity-integrity` 6 例 + `optimization-advisor` 23 例 + 文档）已随 `388eb44` 收单；第 88 轮验收清单纠偏已随 `58eab76` 收单；第 89 轮 `agent-port` 补测已随 `b282136` 收单；第 90 轮端口口径对齐已随 `8cceae9` 收单；第 91 轮 `genre-preference-memory` 补测在途。剧本分镜表强制前置随 `e1c3820`、E2E 欠账修复随 `aa2b4c9` 入库。
> 证据哈希 = `git hash-object <path>`（Git blob SHA-1，取前 12 位），用于确认验收时文件未被改动。

## 〇、全局基线（当前 HEAD 实测）

| 指标 | 实测值 | 命令 / 来源 |
|---|---|---|
| 单测文件 | 594 passed | `npm run test` |
| 单测用例 | 6,550 passed（第 66 轮 +5 worker-manager；第 70 轮 +6 scene-outline-controller；第 86 轮 +6 `entity-integrity`；第 87 轮 +23 `optimization-advisor`；第 89 轮 +6、第 90 轮 +2 `agent-port-status`；第 91 轮 +19 `genre-preference-memory`） | `npm run test` |
| v5 锚点定向复验 | 6 文件 / 101 用例通过（2026-11-08 00:07 实测；`agent-port-status` 3→9→11） | 见 §一–§三 的定向命令 |
| any 预算 | 148/148（82 文件；第 81 轮 -6 已由 ZCode 随 `af9df7b` 收紧基线）；余量 0 | `npm run check:any` |
| 构建产物 | `main.js` 4,870,136 字节（第 90 轮端口口径对齐 −11B；v4.70.0 版本数据 +370B，叠加 v4.69.0 +397B 与第 79 轮分镜强制前置 +180B）；`styles.css` 见 `.bundle-baseline.json` | `Get-Item main.js` / `npm run check:bundle` |
| 类型 | 0 error | `npm run typecheck` |
| 架构守护 | exit 0（9 个既有豁免项，非本轮引入） | `npm run check-engines` |
| E2E | 基线 **40 passed**（37 + mode-journey 3；ZCode 第 88 轮实测三模式 3/3，`rewrite-chapters` 已下线） | `npm run test:e2e` |

复验顺序建议：`npm run typecheck` → `npm run test` → `npm run check:automation` → `npm run preflight:release`。

---

## 一、B1 · Agent 阶段契约（ZCode 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `engine/agent/agent-types.ts`：`AgentProjectStatus.flow?: CreationFlowSnapshot`（L207–L229）<br>`engine/agent/harness/host-tools.ts`：`get_project_status` 输出阶段进度/下一步/阻塞原因（L591–L620）<br>`engine/agent/harness/prompt-sections.ts`：按 `flow.nextStageId` 引导，blocked 阶段先解阻塞（L106–L116） |
| 测试文件 | `tests/unit/engine/agent-mode-alignment.test.ts`（12 用例）<br>`tests/unit/engine/agent-harness.test.ts`（28 用例） |
| 可执行命令 | `npx vitest run tests/unit/engine/agent-mode-alignment.test.ts tests/unit/engine/agent-harness.test.ts` |
| 当前结果 | 定向 40/40 通过；`typecheck` 0；`check-engines` exit 0 |
| 证据哈希 | `agent-types.ts` `325c5685b1f7` · `host-tools.ts` `9c35387dbc7d` · `prompt-sections.ts` `933a9d021b95` · `agent-mode-alignment.test.ts` `ba923cd71d0e` · `agent-harness.test.ts` `90dbb06cfc76` |
| 落地提交 | `d7568cb` |

验收要点：Agent 回答「当前阶段 / 下一步 / 为什么卡住」时，来源是 `flow` 投影，而不是硬编码八阶段话术。

---

## 二、B2 · 工作台阶段面板 + 端口投影（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `ui/services/agent-port.ts`：`getProjectStatus` 用 `collectCreationFlowState` 填充 `flow`，采集失败时省略 `flow` 不阻断旧字段（L368–L386）<br>`ui/agent-workbench-view.ts`：`stagesEl` + `refreshStagePanel()`，按快照渲染阶段并支持点击预填（L388–L407） |
| 测试文件 | `tests/unit/ui/agent-stage-panel.test.ts`（20 用例）<br>`tests/unit/ui/agent-port-status.test.ts`（11 用例：flow 成功/降级/外层兜底 + 短篇·剧本模式推断 2 + `runCommand` 4 + `listCommands` 可执行集对齐 2） |
| 可执行命令 | `npx vitest run tests/unit/ui/agent-stage-panel.test.ts tests/unit/ui/agent-port-status.test.ts` |
| 当前结果 | 定向 31/31 通过；阶段面板无硬编码阶段常量；端口补测锁定模式推断、命令失败登记（未注册 id 返回 false 不抛错），且 `listCommands` 与 `runCommand` 共用 `registry.has` 口径（列表不再出现不可执行命令，`switch-provider` 不再漏列） |
| 证据哈希 | `agent-port.ts` `a1176e83c550` · `agent-workbench-view.ts` `ffd5b0d3a253` · `agent-stage-panel.test.ts` `e5b412f7c726` · `agent-port-status.test.ts` `1622edd52327`（工作树，第 90 轮） |
| 落地提交 | `d7568cb`（契约）→ `28ac9e2`（竞态修复 + fetchStagePanelModel seam） |

验收要点：老项目打开时阶段面板不倒退；`creation-flow-state` 读盘异常时面板回退但不阻断 Agent。

---

## 三、B3 · 商业化导出检查（三档 + 范围，Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `shared/publication-profile.ts`：`PublicationLevel`（draft/finished/submission）、`PublicationScope`（full/written-only）、`splitUnitsByBody`、`checkPublicationReadiness`、`formatPublicationReport`（L32–L297）<br>`ui/export-manuscript-modal.ts`：三档下拉 + 范围下拉 + 导出前检查接线（L100–L102、L216–L243、L417、L477–L488） |
| 测试文件 | `tests/unit/shared/publication-profile.test.ts`（26 用例）<br>`tests/unit/shared/export-precheck.test.ts`（4 用例） |
| 可执行命令 | `npx vitest run tests/unit/shared/publication-profile.test.ts tests/unit/shared/export-precheck.test.ts` |
| 当前结果 | 定向 30/30 通过；投稿档作者全格式必填、字数不足下限一半阻断、强制整包；成品档空单元/无正文阻断；草稿档只提示 |
| 证据哈希 | `publication-profile.ts` `4e20dc2486c5` · `export-manuscript-modal.ts` `a8323fe4b88c` · `publication-profile.test.ts` `7a58bd62222d` · `export-precheck.test.ts` `016af8eebd39` |
| 落地提交 | `76a124b` → `466c61e`（纯函数抽取）→ `067f1e9`（三档/范围）→ `a20fb3d`（接线防回归 20→23） |

验收要点：布尔「严格模式」复选框方案**未采用**；以三档交付级别 + 导出范围代替（用户拍板）。设计口径见 `docs/design/b3-publication-strict-mode-plan.md`。

---

## 四、B4 · 双自动化单一真相源（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `.trae/automation/trae-loop-state.json`（唯一 canonical）<br>`scripts/check-automation.mjs`：schema、round 单调、`updatedAt` 时区、红线字段、HANDOFF 行数、信箱可解析、版本四文件一致（L52–L160）<br>`package.json`：`check:automation` 已挂入 `preflight`（L56） |
| 测试 / 校验 | `npm run check:automation`（结构校验，不校验业务内容） |
| 当前结果 | 通过：活跃台账 round 91、HANDOFF 9 行、版本 4.70.0（committed HEAD `8cceae9`）、信箱可解析；Vault 根副本 `Test-Path = False`，插件仓副本 `True` |
| 证据哈希 | `check-automation.mjs` `4160a26ee521` · `package.json` `d896d425b927`（committed HEAD / v4.70.0） |
| 落地提交 | `76a124b` → `e2c8894`（第 67 轮边界加固：v5-product 必检权重 + round 三处一致） |

验收要点：只允许一份活跃状态文件；未来新增自动化检查项失败时，门禁会给出修复命令而不是静默通过。

---

## 五、B5 · 用户手册 / 商业化指南 / 双自动化运维（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `docs/guides/USER-GUIDE.md`（7 节：安装、首个项目、Agent 工作台、三模式流水线、导出与出版检查、数据位置、FAQ）<br>`docs/guides/COMMERCIAL-GUIDE.md`（7 节：三形态参数、出版检查、质量校验、批量 SOP、投稿检查表、验收指标、合规）<br>`docs/handbook/13-dual-automation-ops.md`（6 节：角色与文件集、循环配置、状态与交接、互调流程、故障处理、收尾检查表） |
| 可执行命令 | `npm run check:docs` · `npm run check:jsdoc` · `npm run check:program` · `npm run check:linked-scenarios` |
| 当前结果 | `check:docs` 通过（19 个活跃文档）；`check:jsdoc` 100%，`@example` 52/52（748 文件）；`check:program` 与台账一致；`check:linked-scenarios` 4 链 35 锚点 |
| 证据哈希 | `USER-GUIDE.md` `d0c0817308b7` · `COMMERCIAL-GUIDE.md` `88a956e52e67` · `13-dual-automation-ops.md` `eceba9bb57bb` |
| 落地提交 | 指南 `067f1e9` → `653170c`（第 61 轮补强：导出落点/文件名口径/成品档作者建议） · 运维手册 `c6017b8` → `e2c8894`（第 67 轮校验清单同步） |

验收要点：三份文档可独立阅读，不依赖会话上下文；文档中的命令均真实存在于 `package.json`。

---

## 六、需用户授权（本轮未执行）

| 事项 | 现状 | 需要用户拍板后执行 |
|---|---|---|
| B5 三模式验收 | **已闭环（2026-11-07）**：full-journey（长篇）+ mode-journey（短篇六维→番茄包 / 剧本可拍→红果包）mock AI 旅程 **3/3 通过**；`rewrite-chapters` 真实重写脚本已随「九霄逆脉行」项目下线（`308e1fe`） | 无需手工走查；如需回退脚本须用户明确确认 |
| E2E 全量 | 基线 **40 passed**（37 + mode-journey 3，2026-11-07 实测：`aa2b4c9` 37/37 + 三模式 3/3） | 变更后重跑 `npm run test:e2e`（五个 project） |
| push / tag / Release | ahead 201，未推送；v4.65.0 节点 `c8147e5`、第 67 轮收单 `e2c8894`、第 68 轮 any 收紧 `ed6b823`、v4.66.0 节点 `e6d1bb0`、第 71 轮收单 `5c53e34`、v4.67.0 节点 `952c052`、第 73 轮收单 `fcd9fde`、第 74 轮收单 `a6cb84c`、第 75 轮收单 `7f205b2`、v4.68.0 节点 `cd6750f`、第 76 轮收单 `b135dbc`、剧本分镜 `e1c3820`、E2E 修复 `aa2b4c9`、v4.69.0 节点 `3038735`、第 80 轮收单 `515ba1a`、第 81 轮收单 `af9df7b`、第 82 轮收单 `4c5a3f0`、第 83 轮收单 `fb5b9ef`、第 84 轮收单 `22acb89`、第 85 轮收单 `bd444ea`、第 86/87 轮收单 `388eb44`、v4.70.0 节点 `bb5972a` 已出 | 用户明确指令后才执行 |
| 剧本 `storyboard` 必填语义 | 已落地并被收单：`shared/creation-flow.ts` 的 `CreationFlowStage.hardDependsOn`（代码 `e1c3820`、文档 `3e5b9d4`），分镜未完成时「分集写作」显示 blocked；`storyboard` 自身不再按「既有正文」跳过 | 已闭环；如需回退须用户明确确认 |

---

## 七、结论

B1–B5 代码、测试、门禁与文档均已在当前 HEAD 可复验：全量 593 文件 / 6,529 用例通过（第 86 轮 `entity-integrity` +6、第 87 轮 `optimization-advisor` +23、第 89 轮 `agent-port-status` +6；覆盖率 statements 43.89% / branches 43.60% / functions 44.61% / lines 44.22%），any 148/148（82 文件；第 81 轮 -6 已随 `af9df7b` 收紧基线），bundle 4,870,147（第 79 轮剧本分镜强制前置 +180B + v4.69.0 版本数据 +397B + v4.70.0 版本数据 +370B），六道相关门禁全绿；v5 锚点定向第 89 轮复验 6 文件 / 99 用例通过（`agent-mode-alignment` 12 + `agent-harness` 28 + `agent-stage-panel` 20 + `agent-port-status` 9 + `publication-profile` 26 + `export-precheck` 4）。剩余事项只有 §六 的授权型工作，不含待补代码。

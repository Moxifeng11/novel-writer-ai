# v5 验收清单：Agent 对话 + 多步骤协同写作最小闭环

> 用途：给用户逐批验收 B1–B5，不再重复论证设计。
> 生成口径：committed HEAD 实测（2026-11-07 15:20 +08:00）。
> 版本：v4.67.0 · HEAD `c5eabb0`（ahead 183）· 第 71 轮已由 `5c53e34` 收单并收紧 any 基线；第 72 轮 3 个文档路径已由 `c5eabb0` 收单；第 73 轮 `main.ts` any -4 与相关台账待收单。
> 证据哈希 = `git hash-object <path>`（Git blob SHA-1，取前 12 位），用于确认验收时文件未被改动。

## 〇、全局基线（当前 HEAD 实测）

| 指标 | 实测值 | 命令 / 来源 |
|---|---|---|
| 单测文件 | 591 passed | `npm run test` |
| 单测用例 | 6,491 passed（第 66 轮 +5 worker-manager；第 67/68 轮零新增；第 70 轮 +6 scene-outline-controller） | `npm run test` |
| v5 锚点定向复验 | 6 文件 / 90 用例通过（2026-11-07 实测） | 见 §一–§三 的定向命令 |
| any 预算 | committed HEAD 174/174（91 文件，第 71 轮 -5 后由 ZCode 收紧）；工作树 170/174（90 文件，第 73 轮 `main.ts` -4，待 ZCode 收单并下调基线） | `npm run check:any` |
| 构建产物 | `main.js` 4,868,872 字节（v4.67.0 版本数据 +279B）；`styles.css` 见 `.bundle-baseline.json` | `Get-Item main.js` / `npm run check:bundle` |
| 类型 | 0 error | `npm run typecheck` |
| 架构守护 | exit 0（9 个既有豁免项，非本轮引入） | `npm run check-engines` |
| E2E | 基线 37 passed，本轮未重跑（需授权，见 §六） | `npm run test:e2e` |

复验顺序建议：`npm run typecheck` → `npm run test` → `npm run check:automation` → `npm run preflight:release`。

---

## 一、B1 · Agent 阶段契约（ZCode 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `engine/agent/agent-types.ts`：`AgentProjectStatus.flow?: CreationFlowSnapshot`（L207–L229）<br>`engine/agent/harness/host-tools.ts`：`get_project_status` 输出阶段进度/下一步/阻塞原因（L591–L620）<br>`engine/agent/harness/prompt-sections.ts`：按 `flow.nextStageId` 引导，blocked 阶段先解阻塞（L106–L116） |
| 测试文件 | `tests/unit/engine/agent-mode-alignment.test.ts`（12 用例）<br>`tests/unit/engine/agent-harness.test.ts`（28 用例） |
| 可执行命令 | `npx vitest run tests/unit/engine/agent-mode-alignment.test.ts tests/unit/engine/agent-harness.test.ts` |
| 当前结果 | 定向 40/40 通过；`typecheck` 0；`check-engines` exit 0 |
| 证据哈希 | `agent-types.ts` `325c5685b1f7` · `host-tools.ts` `9c35387dbc7d` · `prompt-sections.ts` `933a9d021b95` · `agent-mode-alignment.test.ts` `db04b7baa791` · `agent-harness.test.ts` `90dbb06cfc76` |
| 落地提交 | `d7568cb` |

验收要点：Agent 回答「当前阶段 / 下一步 / 为什么卡住」时，来源是 `flow` 投影，而不是硬编码八阶段话术。

---

## 二、B2 · 工作台阶段面板 + 端口投影（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `ui/services/agent-port.ts`：`getProjectStatus` 用 `collectCreationFlowState` 填充 `flow`，采集失败时省略 `flow` 不阻断旧字段（L368–L386）<br>`ui/agent-workbench-view.ts`：`stagesEl` + `refreshStagePanel()`，按快照渲染阶段并支持点击预填（L388–L407） |
| 测试文件 | `tests/unit/ui/agent-stage-panel.test.ts`（20 用例）<br>`tests/unit/ui/agent-port-status.test.ts`（3 用例） |
| 可执行命令 | `npx vitest run tests/unit/ui/agent-stage-panel.test.ts tests/unit/ui/agent-port-status.test.ts` |
| 当前结果 | 定向 23/23 通过；阶段面板无硬编码阶段常量；端口降级契约有独立用例 |
| 证据哈希 | `agent-port.ts` `93e14445ce92` · `agent-workbench-view.ts` `ffd5b0d3a253` · `agent-stage-panel.test.ts` `13640ae5079d` · `agent-port-status.test.ts` `4271ace0d72c` |
| 落地提交 | `d7568cb`（契约）→ `28ac9e2`（竞态修复 + fetchStagePanelModel seam） |

验收要点：老项目打开时阶段面板不倒退；`creation-flow-state` 读盘异常时面板回退但不阻断 Agent。

---

## 三、B3 · 商业化导出检查（三档 + 范围，Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `shared/publication-profile.ts`：`PublicationLevel`（draft/finished/submission）、`PublicationScope`（full/written-only）、`splitUnitsByBody`、`checkPublicationReadiness`、`formatPublicationReport`（L32–L297）<br>`ui/export-manuscript-modal.ts`：三档下拉 + 范围下拉 + 导出前检查接线（L100–L102、L216–L243、L417、L477–L488） |
| 测试文件 | `tests/unit/shared/publication-profile.test.ts`（23 用例）<br>`tests/unit/shared/export-precheck.test.ts`（4 用例） |
| 可执行命令 | `npx vitest run tests/unit/shared/publication-profile.test.ts tests/unit/shared/export-precheck.test.ts` |
| 当前结果 | 定向 27/27 通过；投稿档作者全格式必填、字数不足下限一半阻断、强制整包；成品档空单元/无正文阻断；草稿档只提示 |
| 证据哈希 | `publication-profile.ts` `4e20dc2486c5` · `export-manuscript-modal.ts` `a8323fe4b88c` · `publication-profile.test.ts` `0127a9b9e3fb` · `export-precheck.test.ts` `016af8eebd39` |
| 落地提交 | `76a124b` → `466c61e`（纯函数抽取）→ `067f1e9`（三档/范围）→ `a20fb3d`（接线防回归 20→23） |

验收要点：布尔「严格模式」复选框方案**未采用**；以三档交付级别 + 导出范围代替（用户拍板）。设计口径见 `docs/design/b3-publication-strict-mode-plan.md`。

---

## 四、B4 · 双自动化单一真相源（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `.trae/automation/trae-loop-state.json`（唯一 canonical）<br>`scripts/check-automation.mjs`：schema、round 单调、`updatedAt` 时区、红线字段、HANDOFF 行数、信箱可解析、版本四文件一致（L52–L160）<br>`package.json`：`check:automation` 已挂入 `preflight`（L56） |
| 测试 / 校验 | `npm run check:automation`（结构校验，不校验业务内容） |
| 当前结果 | 通过：活跃台账 round 72、HANDOFF 9 行、版本 4.67.0（committed HEAD）、信箱可解析；Vault 根副本 `Test-Path = False`，插件仓副本 `True` |
| 证据哈希 | `check-automation.mjs` `afef76c2b7ae` · `package.json` `229dfaf6a59c`（committed HEAD / v4.67.0） |
| 落地提交 | `76a124b` → `e2c8894`（第 67 轮边界加固：v5-product 必检权重 + round 三处一致） |

验收要点：只允许一份活跃状态文件；未来新增自动化检查项失败时，门禁会给出修复命令而不是静默通过。

---

## 五、B5 · 用户手册 / 商业化指南 / 双自动化运维（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `docs/guides/USER-GUIDE.md`（7 节：安装、首个项目、Agent 工作台、三模式流水线、导出与出版检查、数据位置、FAQ）<br>`docs/guides/COMMERCIAL-GUIDE.md`（7 节：三形态参数、出版检查、质量校验、批量 SOP、投稿检查表、验收指标、合规）<br>`docs/handbook/13-dual-automation-ops.md`（6 节：角色与文件集、循环配置、状态与交接、互调流程、故障处理、收尾检查表） |
| 可执行命令 | `npm run check:docs` · `npm run check:jsdoc` · `npm run check:program` · `npm run check:linked-scenarios` |
| 当前结果 | `check:docs` 通过（19 个活跃文档）；`check:jsdoc` 100%，`@example` 52/52（747 文件）；`check:program` 与台账一致；`check:linked-scenarios` 4 链 35 锚点 |
| 证据哈希 | `USER-GUIDE.md` `86871ba84d8e` · `COMMERCIAL-GUIDE.md` `0363c5673ad1` · `13-dual-automation-ops.md` `e8d68f3fb85c` |
| 落地提交 | 指南 `067f1e9` → `653170c`（第 61 轮补强：导出落点/文件名口径/成品档作者建议） · 运维手册 `c6017b8` → `e2c8894`（第 67 轮校验清单同步） |

验收要点：三份文档可独立阅读，不依赖会话上下文；文档中的命令均真实存在于 `package.json`。

---

## 六、需用户授权（本轮未执行）

| 事项 | 现状 | 需要用户拍板后执行 |
|---|---|---|
| B5 手工验收（真实三模式流程） | 未执行；`E2E_REWRITE=1` 会改写 E2E 基线 | 明确授权后跑 `E2E_REWRITE=1 npm run test:e2e`，再人工走「创建→大纲→人设→写 1 章→质检→导出」 |
| E2E 全量 | 基线 37 passed，本轮未重跑 | 授权后 `npm run test:e2e` |
| push / tag / Release | ahead 182，未推送；v4.65.0 节点 `c8147e5`、第 67 轮收单 `e2c8894`、第 68 轮 any 收紧 `ed6b823`、v4.66.0 节点 `e6d1bb0`、第 71 轮收单 `5c53e34`、v4.67.0 节点 `952c052` 已出 | 用户明确指令后才执行 |
| 剧本 `storyboard` 必填语义 | 当前为可选字段；三形态中剧本是否强制 storyboard 无产品口径 | 产品语义确认后，由 ZCode 改 engine 契约，Trae 同步 UI/测试 |

---

## 七、结论

B1–B5 代码、测试、门禁与文档均已在当前 HEAD 可复验：全量 591 文件 / 6,491 用例通过（第 70 轮为场景细纲补测 +6，不属 v5 批次），any committed HEAD 174/174（91 文件，第 71 轮 -5 后收紧）、工作树 170/174（90 文件，第 73 轮 `main.ts` -4 待收单），bundle 4,868,872，六道相关门禁全绿；v5 锚点 6 文件 / 90 用例定向复验通过（第 72 轮）。剩余事项只有 §六 的四项授权型工作，不含待补代码。

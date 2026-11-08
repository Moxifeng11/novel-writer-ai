# v5 验收清单：Agent 对话 + 多步骤协同写作最小闭环

> 用途：给用户逐批验收 B1–B5，不再重复论证设计。
> 生成口径：committed HEAD `6b937ca` + 第 117 轮核对（2026-11-08 13:06 +08:00；数据源 `program-status.json` + 门禁实跑）。
> 版本：v4.74.0（版本节点 `4c6798f`，已发布）· 已提交 HEAD `6b937ca`（ahead 235；第 110 轮 `4a445c5` / 第 111 轮 `7d1021c` / 第 112 轮文档 `0e7e863` / 第 113 轮 `60000d9`+`09dbe30` / 第 115 轮文档 `6b937ca` 均已收单）；第 105 轮 docs-correction 已随 `9ae6833` 收单（纠偏本清单过期证据并复验 6 文件 / 101 用例）；第 106 轮 any 收口 3 处已随 `32a38e8` 收单（`knowledge-detail-modal` −2 + `knowledge-rebuild-action` −1，基线 136→133、bundle 零变化）；第 107 轮「转为指纹」死读取修复已随 `2c0511b` 收单（1 行行为修复，main.js −5B）；第 102 轮 command-registry id 一致性测试（+3 例）已随 v4.73.0 收单； 第 86/87 轮（`entity-integrity` 6 例 + `optimization-advisor` 23 例 + 文档）已随 `388eb44` 收单；第 88 轮验收清单纠偏已随 `58eab76` 收单；第 89 轮 `agent-port` 补测已随 `b282136` 收单；第 90 轮端口口径对齐已随 `8cceae9` 收单；第 91 轮 `genre-preference-memory` 补测已随 `98945ff` 收单；第 92 轮派工新鲜度边界文档已随 `90b542d` 收单；第 93 轮两项修复（浅拷贝隔离 + 派工判据 A）已随 `0960a99` 收单；v4.71.0 版本节点 `d599410`（版本同步/CHANGELOG/release notes/台账，bundle 4,870,663）；第 95 轮 ZCode engine any 第一批 `frontmatter-serializer` any 4→0 已随 `5472be7` 收单（基线 148→144）。剧本分镜表强制前置随 `e1c3820`、E2E 欠账修复随 `aa2b4c9` 入库；第 109 轮 advisor 证据分桶已随 `2ca1bca`、第 110 轮 `generate-*-modal` catch 收口已随 `4a445c5` 收单；第 111 轮 6 处 any 收窄（4 catch + 2 deps 返回类型）已随 `7d1021c` 收单；第 113 轮阶段面板补 2 用例（全部阶段完成终态 + flow 采集降级占位，零运行时）；同轮兑现 HANDOFF 派工，可动 any 14→0（any 122/63→108/49，main.js −149B）；`ui/batch-deconstruct-modal.ts` 的 2 处 any 因 ZCode 冻结提醒（方向②/③拍板前双方不动）主动撤出；第 113 轮已由 ZCode 收单（`60000d9` 20 路径 + `09dbe30` 漏报路径 `shared/prompt-manager-types.ts`），工作树干净。第 117 轮按 ZCode 批准实现 gate:any 冻结路径扣除（`shared/optimization-advisor.ts` + `scripts/optimization-advisor.mjs`，新增 frozen 桶：可动 2 − 冻结 2 = 0 时不再产出候选），并修正派工去重（已处理快照之前的无轮次提醒不再重复首推）；为 store logger 中间件补 3 例转发契约（advisor 不进 main.js，bundle 零影响）。
> 证据哈希 = `git hash-object <path>`（Git blob SHA-1，取前 12 位），用于确认验收时文件未被改动。

## 〇、全局基线（当前 HEAD 实测）

| 指标 | 实测值 | 命令 / 来源 |
|---|---|---|
| 单测文件 | 594 passed | `npm run test` |
| 单测用例 | 6,570 passed（…第 109 轮 +3 advisor 可动面分桶计分；第 113 轮 +2 阶段面板终态/降级；第 117 轮 +5：advisor 冻结桶 2 例 + store logger 转发契约 3 例） | `npm run test` |
| v5 锚点定向复验 | 6 文件 / 103 用例通过（2026-11-08 第 115 轮复验，HEAD `09dbe30`；`agent-port-status` 3→9→11、`agent-stage-panel` 20→22） | 见 §一–§三 的定向命令 |
| any 预算 | 实测 108/108（49 文件；第 113 轮可动 14→0——14 个可动文件共 14 处 any 全部窄化/删除，仅剩红线 100（engine + `ui/views/writing-fingerprint-view.ts`）、设计性 6（`shared/types.ts`）与冻结中的 `ui/batch-deconstruct-modal.ts` 2 处（方向②/③拍板前双方不动）；第 111 轮 128/69→122/63 随 `7d1021c`；第 110 轮 133/74→128/69 随 `4a445c5`；第 106 轮 136→133 随 `32a38e8`、第 104 轮 140→136 随 `349017a`；第 95 轮 ZCode `frontmatter-serializer` any 4→0 随 `5472be7`） | `npm run check:any` |
| 构建产物 | `main.js` 实测 4,871,801 字节（= `.bundle-baseline.json` 基线 4,871,801，余 0B；第 113 轮删除 `fmData`/`_updateCount` 死赋值 −149B 后同步收紧基线；v4.74.0 版本数据 +235B 已入基线；第 110/111 轮 any 收口为零字节；第 107 轮行为修复 −5B；第 93 轮嵌套字段拷贝 + 派工判据 A +195B）；`styles.css` 见 `.bundle-baseline.json` | `Get-Item main.js` / `npm run check:bundle` |
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
| 证据哈希 | `agent-types.ts` `325c5685b1f7` · `host-tools.ts` `265b99721ec6` · `prompt-sections.ts` `933a9d021b95` · `agent-mode-alignment.test.ts` `ba923cd71d0e` · `agent-harness.test.ts` `90dbb06cfc76` |
| 落地提交 | `d7568cb` |

验收要点：Agent 回答「当前阶段 / 下一步 / 为什么卡住」时，来源是 `flow` 投影，而不是硬编码八阶段话术。

> 第 105 轮核对：`host-tools.ts` 哈希由 `9c35387dbc7d` → `265b99721ec6`，差异仅 `3f6d895` 扩展危险命令正则（`+prune|populate`），`get_project_status` 的 `flow` 输出未变，B1 定向 40/40 仍通过。

---

## 二、B2 · 工作台阶段面板 + 端口投影（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `ui/services/agent-port.ts`：`getProjectStatus` 用 `collectCreationFlowState` 填充 `flow`，采集失败时省略 `flow` 不阻断旧字段（L368–L386）<br>`ui/agent-workbench-view.ts`：`stagesEl` + `refreshStagePanel()`，按快照渲染阶段并支持点击预填（L388–L421） |
| 测试文件 | `tests/unit/ui/agent-stage-panel.test.ts`（22 用例：三模式投影 + 全部阶段完成终态 + 无 flow 降级占位）<br>`tests/unit/ui/agent-port-status.test.ts`（11 用例：flow 成功/降级/外层兜底 + 短篇·剧本模式推断 2 + `runCommand` 4 + `listCommands` 可执行集对齐 2） |
| 可执行命令 | `npx vitest run tests/unit/ui/agent-stage-panel.test.ts tests/unit/ui/agent-port-status.test.ts` |
| 当前结果 | 定向 33/33 通过；阶段面板无硬编码阶段常量；端口补测锁定模式推断、命令失败登记（未注册 id 返回 false 不抛错），且 `listCommands` 与 `runCommand` 共用 `registry.has` 口径（列表不再出现不可执行命令，`switch-provider` 不再漏列） |
| 证据哈希 | `agent-port.ts` `a1176e83c550` · `agent-workbench-view.ts` `ffd5b0d3a253` · `agent-stage-panel.test.ts` `1da65d55ea85` · `agent-port-status.test.ts` `1622edd52327`（committed HEAD `09dbe30` 实测；`agent-stage-panel.test.ts` 随第 113 轮 +2 用例更新） |
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
| 关键文件 | `.trae/automation/trae-loop-state.json`（唯一 canonical）<br>`scripts/check-automation.mjs`：schema、round 单调、`updatedAt` 时区、红线字段、HANDOFF 行数、信箱可解析、版本四文件一致、建议台账合法（L53–L195）<br>`package.json`：`check:automation` 已挂入 `preflight`（L56） |
| 测试 / 校验 | `npm run check:automation`（结构校验，不校验业务内容） |
| 当前结果 | 通过（第 117 轮实测）：活跃台账 round 117、HANDOFF 9 行、版本 4.74.0（committed HEAD `6b937ca`，ahead 235）、信箱可解析、建议台账 tier=score/round 117（gate:any 冻结扣除已生效不再产出候选；已处理的旧派工提醒不再重复首推）；Vault 根副本 `Test-Path = False`，插件仓副本 `True` |
| 证据哈希 | `check-automation.mjs` `4160a26ee521` · `package.json` `15a1103640a0`（committed HEAD `09dbe30` / v4.74.0；第 115 轮复核） |
| 落地提交 | `76a124b` → `e2c8894`（第 67 轮边界加固：v5-product 必检权重 + round 三处一致） |

验收要点：只允许一份活跃状态文件；未来新增自动化检查项失败时，门禁会给出修复命令而不是静默通过。

---

## 五、B5 · 用户手册 / 商业化指南 / 双自动化运维（Trae 落地）

| 锚点 | 内容 |
|---|---|
| 关键文件 | `docs/guides/USER-GUIDE.md`（7 节：安装、首个项目、Agent 工作台、三模式流水线、导出与出版检查、数据位置、FAQ）<br>`docs/guides/COMMERCIAL-GUIDE.md`（7 节：三形态参数、出版检查、质量校验、批量 SOP、投稿检查表、验收指标、合规）<br>`docs/handbook/13-dual-automation-ops.md`（6 节：角色与文件集、循环配置、状态与交接、互调流程、故障处理、收尾检查表） |
| 可执行命令 | `npm run check:docs` · `npm run check:jsdoc` · `npm run check:program` · `npm run check:linked-scenarios` |
| 当前结果 | `check:docs` 通过（19 个活跃文档）；`check:jsdoc` 100%，`@example` 52/52（748 文件）；`check:program` 与台账一致；`check:linked-scenarios` 4 链 35 锚点 |
| 证据哈希 | `USER-GUIDE.md` `d0c0817308b7` · `COMMERCIAL-GUIDE.md` `88a956e52e67` · `13-dual-automation-ops.md` `dc3f225d9563`（committed HEAD `09dbe30` 实测；随第 109 轮 `2ca1bca` 手册补充分桶说明漂移） |
| 落地提交 | 指南 `067f1e9` → `653170c`（第 61 轮补强：导出落点/文件名口径/成品档作者建议） · 运维手册 `c6017b8` → `e2c8894`（第 67 轮校验清单同步） |

验收要点：三份文档可独立阅读，不依赖会话上下文；文档中的命令均真实存在于 `package.json`。

---

## 六、需用户授权（本轮未执行）

| 事项 | 现状 | 需要用户拍板后执行 |
|---|---|---|
| B5 三模式验收 | **已闭环（2026-11-07）**：full-journey（长篇）+ mode-journey（短篇六维→番茄包 / 剧本可拍→红果包）mock AI 旅程 **3/3 通过**；`rewrite-chapters` 真实重写脚本已随「九霄逆脉行」项目下线（`308e1fe`） | 无需手工走查；如需回退脚本须用户明确确认 |
| E2E 全量 | 基线 **40 passed**（37 + mode-journey 3，2026-11-07 实测：`aa2b4c9` 37/37 + 三模式 3/3） | 变更后重跑 `npm run test:e2e`（五个 project） |
| push / tag / Release | ahead 235，未推送；v4.74.0 节点 `4c6798f` 已发布、第 67 轮收单 `e2c8894`、第 68 轮 any 收紧 `ed6b823`、v4.66.0 节点 `e6d1bb0`、第 71 轮收单 `5c53e34`、v4.67.0 节点 `952c052`、第 73 轮收单 `fcd9fde`、第 74 轮收单 `a6cb84c`、第 75 轮收单 `7f205b2`、v4.68.0 节点 `cd6750f`、第 76 轮收单 `b135dbc`、剧本分镜 `e1c3820`、E2E 修复 `aa2b4c9`、v4.69.0 节点 `3038735`、第 80 轮收单 `515ba1a`、第 81 轮收单 `af9df7b`、第 82 轮收单 `4c5a3f0`、第 83 轮收单 `fb5b9ef`、第 84 轮收单 `22acb89`、第 85 轮收单 `bd444ea`、第 86/87 轮收单 `388eb44`、v4.70.0 节点 `bb5972a`、第 91 轮收单 `98945ff`、第 92 轮收单 `90b542d`、v4.71.0 节点 `d599410`、第 95 轮 `5472be7`、第 96 轮 `d12b11a`、第 97 轮 `44c38b3`、第 98 轮 `9afba2b`、第 100 轮 `8c7cc88`、第 103 轮收单 `62780ac`、第 104 轮收单 `349017a`、第 105 轮文档纠偏 `9ae6833`、第 106 轮 any 收口 `32a38e8`、第 107 轮行为修复 `2c0511b`、第 109 轮 advisor 分桶 `2ca1bca`、第 110 轮 `generate-*-modal` 收口 `4a445c5`、第 111 轮 any 收口 `7d1021c`、第 113 轮阶段面板测试补强 + 可动 any 14→0 `60000d9`（20 路径）+ 漏报路径 `09dbe30` 已出 | 用户明确指令后才执行 |
| 剧本 `storyboard` 必填语义 | 已落地并被收单：`shared/creation-flow.ts` 的 `CreationFlowStage.hardDependsOn`（代码 `e1c3820`、文档 `3e5b9d4`），分镜未完成时「分集写作」显示 blocked；`storyboard` 自身不再按「既有正文」跳过 | 已闭环；如需回退须用户明确确认 |

---

## 七、结论

B1–B5 代码、测试、门禁与文档均已在当前 HEAD 可复验：全量 594 文件 / 6,570 用例通过（第 86 轮 `entity-integrity` +6、第 87 轮 `optimization-advisor` +23、第 89 轮 `agent-port-status` +6、第 91 轮 `genre-preference-memory` +19、第 93 轮 +2、第 96 轮 +2、第 98 轮 +2、第 102 轮 +3、第 109 轮 +3、第 113 轮阶段面板 +2、第 117 轮 advisor 冻结桶 +2 与 store logger +3；覆盖率历史值未在本轮复跑），any 108/108（49 文件；第 113 轮可动 14→0，仅剩红线 100 + 设计性 6 + 冻结中的 `ui/batch-deconstruct-modal.ts` 2 处；第 117 轮 advisor 已把冻结路径从可动面扣除，候选不再复现），bundle 实测 4,871,801（= 基线 4,871,801，余 0B；第 113 轮删除死赋值 −149B 后收紧），六道相关门禁全绿；v5 锚点定向第 115 轮复验 6 文件 / 103 用例通过（`agent-mode-alignment` 12 + `agent-harness` 28 + `agent-stage-panel` 22 + `agent-port-status` 11 + `publication-profile` 26 + `export-precheck` 4）。剩余事项只有 §六 的授权型工作，不含待补代码。

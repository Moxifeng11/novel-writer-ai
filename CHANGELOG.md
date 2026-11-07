# Changelog

> 历史未发布批次（v8.x / 4.10.x）已归档到 [docs/changelog/archive-unreleased.md](docs/changelog/archive-unreleased.md)。

## v4.65.0（2026-11-07）

### 🧹 类型收窄：worker 协议 any 11→0（198→187）

- `services/worker-protocol.ts` 5→0：`payload`/`input`/`result` 改 `unknown`；`FallbackHandler` 改为注册侧泛型（`I = WorkerTaskInput`、`R = unknown`），新增协议通用入参形状。
- `services/worker-runtime.ts` 6→0：`TaskHandler` 入参按 `never` 建模（注册表逆变）、返回 `Promise<unknown>`；两处 `(self as any)` 改本地 `WorkerScope` 窄接口并用惰性 `getWorkerScope()`，避免 Node 导入期触发 `self`。
- `services/worker-manager.ts` 2 行连带：`Map<string, FallbackHandler<never>>` 与 `handler(input as never)`——严格模式下安全，engine/** 零改动。
- any 基线 198→187（94 个文件）；`main.js` 逐字节不变。

### 🧪 测试：Worker 侧协议边界（+9 用例）

- 新增 `tests/unit/services/worker-runtime.test.ts` 9 例：`worker:ready` 与 `onmessage` 安装、未知任务 `task:error`、进度+完成与 signal 暴露、非 Error 拒绝归一、`AbortError` 静默、`task:cancel` 中止、重复注册后者生效、内联源码与 Blob Worker 构造。
- 目的：第 63 轮改了跨线程协议类型，用测试锁定消息结构防止后续重构悄悄破坏。

### 📚 文档

- `USER-GUIDE` 补导出落点（桌面下载 / 移动端 `导出文件/`）与文件名规则、封面格式；`COMMERCIAL-GUIDE` 补成品档作者建议项。

### 🧪 测试与门禁

- 全量 **591 文件 / 6,480 用例**（v4.64.0 为 590/6,471，+9）；`preflight:release` 全绿；any 187；bundle 4,867,954（版本数据增量另计）。

## v4.64.0（2026-11-07）

### 🐛 修复：短篇/剧本导出产物误报「未导出」

- **根因**：`hasExportArtifact` 只查项目根 `05-导出`/`06-导出`，而短篇/剧本的产物落在 `短篇创作/05-导出`、`剧本创作/06-导出` 下，磁盘检测恒不命中。
- **影响**：`localStorage` 导出标记丢失（换设备、清缓存、换浏览器）后，已有导出文件的短篇/剧本仍显示「未导出」。
- **修复**：`hasExportArtifact(app, project, mode)` 按模式映射目录（目录名复用 `mode-content` 常量），并兼容旧版项目根目录；长篇行为不变。+4 用例覆盖短篇/剧本新目录、旧根兼容、双目录皆空。

### ⚡ 性能：阶段采集全库遍历 3→2 / 3→1

- `hasExportArtifact` 改用 `listFolderFiles` 局部遍历导出目录，不再 `vault.getFiles()` 全库扫描。
- `listModeUnits` 的 own/legacy 共用一次 `getFiles()` 快照（own 优先语义不变），旧结构 2→1。
- 单次采集：长篇 3→2、短篇/剧本 1–3→1；新增 7 用例用 fake vault 统计扫描次数并锁定四种导出语义。
- `ui/full-writer/creation-flow-state.ts` 纳入 `check:hotpath-scans` 的 `HOT_FILES`（10→11）防回退。

### 🧪 测试与门禁

- 全量 **590 文件 / 6,471 用例**（v4.63.0 为 589/6,460，+11）；`preflight:release` 全绿；any 198 不变；bundle 4,867,566（行为修复 +112B 已 note）。

## v4.63.0（2026-11-07）

### 🧪 测试与文档加固（+9 用例）

- **B3 导出弹窗接线契约**（20→23）：投稿档必须同时回写内存 `scope` + 下拉 `setValue` + 禁用；`splitUnitsByBody` 必须先于 `checkPublicationReadiness`；blocker 必须 `throw` 且成品档附「仅已写单元」提示。
- **platform-export 边界现状锁定**（3→9）：无调研时简介回退 storyDoc 首行/标签回退平台默认、空简介占位、项目名空或尾斜杠回退、字数只透传不做下限阻断、敏感词覆盖简介+正文并按次数降序。注：平台包「简介/标签完整度校验」仍待产品接入（v4.59.0 记录项）。
- **B3 三档口径纠偏**：`LINKED-SCENARIOS` 链 4 由「布尔严格检查/二档」重写为三档矩阵 + 范围语义；`docs/README` 联动链三条→四条；b3 设计文档增 §〇 落地差异表、§五 改为拍板结论。
- **联动锚点 32→35**：新增 `splitUnitsByBody`、`agent-port::collectCreationFlowState`、`agent-port-status.test.ts`，文档承诺的锚点由门禁校验。
- **v5 验收清单**：新增 `docs/progress/v5-acceptance.md`，B1–B5 逐项列文件/行号、测试、命令、结果、git blob 哈希与落地提交；单列四项「需用户授权」。

### 🧪 测试与门禁

- 全量 **589 文件 / 6,460 用例**（v4.62.0 为 589/6,451，+9）；`preflight:release` 全绿；any 198 不变；bundle 零增长（4,867,168）。

## v4.62.0（2026-11-07）

### 🧹 类型收窄：四文件 any 清零（212→198）

- `ui/full-writer/chapter-orchestrator.ts` 5→0：`import type StepRunCtx` 替换两个 `execute*`、`makeCtx` 返回值与 `activateStep`/`runOneStep` 参数。
- `ui/full-writer-view.ts` 6→0：`tabs` 收紧为 `WriterTab[]`，删除从未读写的 `currentReport`，两处空实现改 `unknown`。
- `ui/unified-entity-generate-modal.ts` 4→0：`CategoryCardElement` 承载分类 key；两处 `catch (e: any)` 改结构断言（刻意不用 `instanceof Error`，因 `DOMException` 不是 Error 子类）。
- `ui/prompt-manager-settings.ts` 4→0：`ABTestMetrics` / `PromptTemplate` 类型化，删除两处多余 `as any`。
- any 基线 206→198（96 个文件）；`main.js` 零字节变化（纯类型擦除）。

### 🧪 回归

- 新增 `tests/unit/ui/agent-port-status.test.ts` 3 用例：B2 端口 `flow` 降级契约——采集成功透传、采集抛错省略 `flow` 但不阻断章节统计、元信息失败整体返回 `null` 且不触发采集。

### 🧪 测试与门禁

- 全量 **589 文件 / 6,451 用例**（v4.61.0 为 588/6,448，+3）；`preflight:release` 全绿；bundle 4,866,833（较基线 -24）。

## v4.61.0（2026-11-07）

### 🐛 取消语义修复：被取消任务不再永久挂起

- `WorkerManager.rejectTask` 去掉 `!task.cancelled` 守卫。根因：`cancelTask` 先置 `cancelled=true` 再调 `rejectTask`，旧守卫把 reject 吞掉 → 取消后的 Promise 永不结算；`engine/deconstruction-scheduler.ts` 的 `await taskPromise` 会永久挂起。
- 取消路径（队列移除 / abortController / worker postMessage）都只结算一次；`resolveTask` 的守卫保留，取消后不再 resolve 成功值。
- 新增 worker-manager 6 用例：降级成功与进度透传、处理器抛错原样拒绝、未注册处理器按类型拒绝、`cancelAll` 拒绝且不再执行 handler、`destroy` 幂等、Worker 初始化超时。

### 🧪 回归与类型

- scheduler abort 路径 2 用例：在途任务取消后以 `Task cancelled` 结算（100ms race 防挂起）、维度完成后 abort 不误伤已结算结果。
- `ui/svg-charts.ts` any 5→0：新增 `TimelineLayoutItem`，删除 5 处 `as any`。
- B3 出版边界 +3 用例：CRLF frontmatter 剥离与 trim 重复标题归并、draft 缺作者仅建议但空稿仍阻断、`written-only` 仅对成品档豁免空单元。

### 🧪 测试与门禁

- 全量 **588 文件 / 6,448 用例**（v4.60.0 为 586/6,437，+11）；`preflight:release` 全绿；any 基线 222→217；bundle 零增长（4,866,414）。

## v4.60.0（2026-11-07）

### 🧹 类型收窄：四个文件 any 清零（251→222）

- `ui/views/knowledge-base-modals.ts` 9→0：导入回调改 `BookBasicInfo`，`vault.adapter` 改窄接口 `MkdirCapableAdapter`（保留桌面端 mkdir 与移动端回退），`channelValue` 改 `GenreChannelKey | ''`，删除批量操作的 `op.key as any` 与 `attr.disabled` 的 `null as any`。
- `ui/manage-providers-modal.ts` 7→0：新增只读投影 `ProviderSummary`，`settings: NovelWriterSettings`，`updateProvider` 改 `Partial<CustomProvider>`，`getRawProvider` 改 `CustomProvider | undefined`。
- `ui/golden-opening-modal.ts` 6→0：6 处 AI 返回 JSON 的解析回调改用既有 `Partial<...>` 类型与 `unknown` 类型谓词；`Math.max` 夹取、`Array.isArray` 与默认值兜底未变。
- `services/worker-manager.ts` 7→0：`TaskState` / `executeTask` 泛型默认值与 `reject`/`resolveTask`/`rejectTask` 参数改 `unknown`；调用点零扩散（engine/** 未动）。
- 全部为纯类型改动：`main.js` 4,866,080 字节与 v4.59.0 逐字节一致；any 基线 251→222（104→101 个文件）。

### 🧪 测试与门禁

- 剧本阶段面板四态真实回归 +4 用例：冷启动阻塞链、分镜表完成但无骨架（提示「创建 12 集骨架」）、12/12 完成 85%、旧剧本无分镜表跳过前置。
- 全量 **586 文件 / 6,437 用例**（+4）；`preflight:release` 全绿；bundle 零增长。

## v4.59.0（2026-11-06）

### 📤 B3 口径改造：三档交付级别 + 导出范围

- **三档级别**：
  - `draft` 草稿：仅提示（书名/无正文仍阻断）；
  - `finished` 成品（默认）：阻断空正文单元与无正文；字数、TXT/MD 作者、重复标题仅提示；
  - `submission` 平台投稿：作者**全格式必填**、总字数低于下限一半阻断、必须整包。
- **导出范围**：`全部单元` / `仅已写单元`。后者实际过滤空骨架、不写入导出文件，并豁免「空单元」阻断（仅成品档；投稿强制整包）。
- 新增 `PUBLICATION_LEVEL_LABELS`、`splitUnitsByBody`；`checkPublicationReadiness` 不传 `level` 时保持 v4.58.0 旧矩阵（向后兼容）。
- 弹窗：交付检查/导出范围下拉；投稿档强制显示作者行；成品档遇空单元阻断时提示切换范围；成功提示含跳过数。
- 测试 11→17（草稿/成品/投稿/豁免/旧矩阵兼容/拆分函数）；联动锚点与两份指南同步。

### 🧪 测试与门禁

- 全量 **586 文件 / 6,433 用例**（+10）；preflight 全绿；any 251/251；bundle +2,454B 功能增量已 note。

## v4.58.0（2026-11-06）

### 📤 严格模式口径澄清（整包交付）

- 导出弹窗严格模式描述改为：「按整包交付校验：缺作者、空正文（含任一空单元）、严重字数不足等阻断项会中止导出；只导样章或部分单元请保持关闭」。
- `docs/guides/USER-GUIDE.md` / `COMMERCIAL-GUIDE.md` 同步整包口径，避免用户只导样章时被误阻断。
- **无行为变更**，仅文案与文档；bundle +90B 已 note 登记。

### 🧪 验证

- 全量 **586 文件 / 6,423 用例** 全绿；preflight 全绿；any 251/251。

## v4.57.0（2026-11-06）

### 🐛 B2：Agent 工作台阶段面板竞态修复

- **真实缺口**：`refreshStagePanel` 先记 `activeProject` 再 `await port.getProjectStatus`，返回后未复检项目——快速切换甲乙项目时，甲的快照可能晚到并覆盖乙。现于 await 后以 `this.activeProject !== project` 丢弃过期结果。
- 新增纯函数 `fetchStagePanelModel(project, getStatus)`（stage-panel）：内置 try/catch → 占位模型，读取失败不抛；工作台改用该 seam，删除两处失效类型导入。
- 测试 8→16：有项目渲染 / 未选项目不请求 port / 切换项目晚到旧结果仍带原项目标识 / port 抛错与 null 占位 / 三条接线契约（过期丢弃、三处刷新、点击只预填不提交）。

### 🧪 测试与门禁

- 全量单测 **586 文件 / 6,423 用例**（+8）；preflight 全绿；any 251/251；bundle +70B 按修复必需文档化上调。

## v4.56.0（2026-11-06）

### 🧪 chapter-state 失效标脏与状态机补测（+7 用例）

- `tests/unit/ui/chapter-state-recognition.test.ts` 10→17：覆盖 `invalidateSteps` 降级/标脏、`updateStepState` 分级与 `forceComplete`、`reset`、`migrateLegacyStepIndex`、历史 `source=ai-generated` 兼容。
- 单文件覆盖率：st 73.13%→87.56%、br 63.12%→74.46%、fn 66.66%→100%、lines 74.19%→89.24%；零源码改动。
- 全量 **586 文件 / 6,415 用例**；preflight 全绿。

## v4.55.0（2026-11-06）

### 📤 B3：出版事实构建抽为纯函数（导出弹窗回归）

- `shared/publication-profile.ts` 新增 `buildPublicationFacts()`：把导出弹窗内联的「章节 → 出版事实」搬运为纯函数（frontmatter 判空、重复标题分组、CJK 字数），弹窗改为调用，**零运行时行为变化**。
- 用例 7→11，覆盖 B3 回归口径：导出单元计数；短篇 EPUB「缺作者 + 空节」= blocker 而 Markdown 缺作者不阻断；短篇字数 3 万=warning / 2 万=blocker；剧本 30 集仅 unit-count-low warning、全空集 no-body+empty-units。
- 严格模式阻断语义**保持现方案**（缺作者仅 EPUB/DOCX 阻断、字数低于下限一半才 blocker），待用户拍板后再调整。

### 🧪 测试与门禁

- 全量单测 **586 文件 / 6,408 用例**；preflight 全绿（bundle +103B 按功能增长 note 登记；any 251/251）。

## v4.54.0（2026-11-06）

### 🧭 v5 B1：Agent 阶段快照契约（唯一阶段事实源）

- `AgentProjectStatus` 新增 `flow?: CreationFlowSnapshot`（engine 只投影 `shared/creation-flow` 类型，不定义阶段）。
- `get_project_status` 输出阶段进度百分比、下一步阶段（含 blockedReason）、阶段明细（✓/→/!/○），`data.flow` 携带完整 stages。
- 提示词改为「先查 status → 按 flow.nextStageId 引导」，硬编码八阶段仅作无 flow 时的通用回退；阻塞阶段必须先说明原因。
- B2 收口：`agent-port` / 工作台移除本地交叉类型（依赖 B1 字段），剧本分镜阶段用例补齐。

### 🔤 any 收口第三批

- `ui/full-writer/intervention-controller.ts` any **9→0**（Record<string,string> / StepRunCtx / 错误窄化 / 语音事件本地类型）；全仓 any **260→251**，基线收紧。

### 🔗 联动与门禁

- `check:linked-scenarios` 增加「Agent 阶段引导→商业化导出检查」链（4 链 / 32 锚点）。
- 全量 **586 文件 / 6,404 用例**；preflight 全绿（B1/B2 + any 收口；bundle +869B 已 note）。

## v4.53.0（2026-11-06）

### 📤 出版检查与导出严格模式

- 新增 `shared/publication-profile.ts`：纯函数判定出版阻断/建议（标题、作者、空正文、字数不足、重复标题等），规格复用 `CREATION_MODE_SPECS`，不产生第二套口径。
- 导出弹窗新增「严格出版检查（阻断导出）」开关；默认仅提示，勾选后阻断项会中止导出并给出可读原因。

### 🧭 Agent 工作台「创作阶段」面板

- 新增 `ui/agent-workbench/stage-panel.ts`：由统一 `CreationFlowSnapshot` 构建左栏阶段模型，不复制阶段常量。
- `agent-port` 采集 flow 快照（失败降级不影响基础进度）；工作台随活动项目刷新阶段面板。

### 🛡️ 自动化一致性门禁

- 新增 `scripts/check-automation.mjs` 并接入 preflight：校验 HANDOFF 快照行数/版本一致性、信箱可解析，防双份自动化台账漂移。
- 新增 `docs/handbook/13-dual-automation-ops.md` 与 `docs/guides/`（用户指南、商业化指南）。

### 🔤 any 收口（两批）

- `engine/deconstruction-scheduler` any **22→0**（AnalysisResult 联合 + 维度方法具体返回类型 + 显式泛型）。
- `ui/components/smart-chart` any **16→0**（ChartData 13 形态联合 + 泛型适配器）。
- 全仓 any **298→260**，基线已收紧。

### 🧪 覆盖率与稳定性

- `chapter-state-manager` 失效标脏链补测 7 例（定向 br 72.86%→87.14%）。
- 修复 `engine-registry` listEngines 微基准的负载敏感假失败（预热 + 3 次取最小值）。
- 全量单测 **586 文件 / 6,396 用例**；preflight 全绿（bundle +4,375B 为新增功能，note 已登记）。

## v4.52.0（2026-11-06）

### 🧪 覆盖率攻坚（Trae 协作，多轮 test-hardening）

- `body-writer` 25→31 用例：备份链全链 6 例（`spyOn(ChapterVersionService.prototype, 'saveVersion')`——推翻「无注入点不可测」结论，无需改 engine），及 parseChapterNum/dirOf/defaultBodyPath 纯逻辑 9 例。
- `obsidian-fs-adapter-fallback` 7→21：索引内外 stat/递归删除/mkdir 分叉/listFolders/writeVaultText 回退。
- `template-validator` 19→38：YAML 块标量、未闭合回退、同人/时间线、实体缺键与空值。
- `template-vars-story-context` 12→43：buildContextVars/buildEntityVars/buildTemplateVars 信号段与 compact 实体口径。
- 全仓 **584 文件 / 6,375 用例**（v4.51.0 为 6,275，+100）。

### ⚡ 热路径收口（perf）

- `batch-pipeline-runner#loadStepResults`、`realtime-quality-controller#loadPreviousChapterContext` 的全库 `vault.getFiles()` 改为 `listFolderFiles` 目录遍历：10,080 文件实测 0.523ms → **0.004ms**/次。
- `check:hotpaths` HOT_FILES 8→10；门禁正则扩到 `getMarkdownFiles`/`getAllLoadedFiles`，堵住换 API 绕过的静默回归。

### 🧹 仓库与门禁

- `.gitignore` 纳入 `tmp/`：覆盖率中间产物不再污染 `git status`。
- `check:hotpaths` 扩容属收紧；any 298/298 零余量维持；bundle 4,855,409B（-50B）。

## v4.51.0（2026-11-06）

### ✂️ 协同视图切片第九批收口（3,581 → 3,363，内聚优先）

- 四片分片交付（Trae）：metrics-refresh（刷新编排 121 行）/ chapter-context 扩展（身份推定 + 正文去壳）/ layout-assembly（布局装配 497 行）/ control-panel（右栏控制台 380 行）；新增测试 **38 用例**。
- **指标切换（元迭代）**：切片以 net-bundle + 内聚度为准（本批 bundle +3,664B 是动因），新增 `sliceBundleBudgetBytes=0`；`co-writing-view` 3,581 → **3,363**，`renderKnowledgeTab` 留作下一个内聚单元，≤3,000 转为机会性目标。

### 🧯 Notice 尾盘

- `command-ui-executor` 20 处改走 notice-helpers（bundle 中性）。

### 🧪 测试与门禁

- 全量单测 **583 文件 / 6,275 用例**（+3 文件 / +38 用例）；`preflight:release` 全绿；lint 0 error / 1,853 warnings（持平）。

## v4.50.0（2026-11-06）

### 🧯 Notice 存量批收官前扫尾（6 文件 34 处，Trae 协作）

- ai-builder-modal 2、appearance-settings 7、settings-general-sections 6、settings-foreshadow-section 6、settings-knowledge-section 7、project-utils 6，全部走 notice-helpers。
- **settings/api-section 余 8 处逐条核对均为校验守卫（不能为空/已存在/正在使用），0 替换，确认收敛**——至此 Notice 大面积收敛与零星扫尾全部完成。
- Trae 侧循环升级为自适应迭代（动态候选池 + EV 评分 + 失败回退，af06e242）；双方约定自动化互调须经信箱协商确认。

### 🧪 测试与门禁

- 全量单测 **580 文件 / 6,237 用例**（持平）；`preflight:release` 全绿；lint 0 error / 1,853 warnings（持平）；main.js +73B（note 登记）。

## v4.49.0（2026-11-06）

### ✂️ 协同视图切片第八批（3,980 → 3,581，Trae 协作）

- 新增 4 模块：`editor-shortcuts.ts`（86 行，键位解析纯函数：IME→Tab→Ctrl+1/2/3→Ctrl+Space→Ctrl+J/K/H→Ctrl+Shift+R 优先于 Ctrl+R→Ctrl+S→Ctrl+.→Escape）、`metrics-render.ts`（167 行，MetricsRenderHost 注入 + 方向/紧凑文案）、`settlement-actions.ts`（188 行，弹窗改 `host.openSettlementModal` 依赖倒置，避免静态 import main）、`suggestion-flow.ts`（472 行，Tab 建议 + 流式整体搬运，abort/epoch/骨架/空态/错误卡分支语义不变）。
- 新增 4 测试文件 22 用例；`preview-render` 切片尝试后整体回退（fake this 缺 previewHost），行数仍达标。
- co-writing-view 八批累计 5,588 → **3,581**（-2,007），距 ≤3,000 还差 ~580 行。

### 🧪 测试与门禁

- 全量单测 **580 文件 / 6,237 用例**（+4 文件 / +22 用例）；`preflight:release` 全绿；lint 0 error / **1,853** warnings；any **298/306**（-8）；JSDoc 742 文件 100%、`@example` 52/52。

## v4.48.0（2026-11-06）

### ⚖️ settleLight 语义决策落地（决策 3）

- **维持「出场确认 best-effort + 写入幂等」，不做整次事务**；补齐缺口「失败不可见」：`SettlementResult` 新增 `lightFailures`（entities/foreshadow/bodyFrontmatter）+ `lightPartial`。
- 章节结算弹窗对部分失败弹告警（列失败对象，提示"幂等可重跑"）；单元结算（短篇/剧本）frontmatter 写 `settlement_partial` 并在结算报告追加失败行。
- 决策记录写入 `docs/design/g1-authority-decisions.md` §2.2；新增 3 条失败聚合测试（记名不影响他者 / 重跑即修复幂等 / 无失败不携带）。

### 🗳️ 指纹编辑 UI 12 维（V2 可视化闭环）

- 编辑弹窗对 V2 指纹显示 12 个逐维描述 textarea（pending 维度带说明）；新增 `updateV2FingerprintFeatures()`：一次保存同步「V2 全量 / V1 投影 / v1Backup / V2 逐维向量」四方。
- 新增 2 条测试（三方一致 + 重载不降级；id 不存在返回 null）；修复初版漏同步 v1Backup 导致"改完重载回退"的缺陷。

### ✂️ 协同视图切片第七批（4,303 → 3,980，Trae 协作）

- 新增 7 模块：suggestion-cards / suggest-feedback / brief-panel / dashboard-status / kb-reference-config / suggestion-loading / quality-popup；新增 6 测试文件 27 用例。
- 六批累计 5,588 → 3,980（-1,608），距 ≤3,000 还差 ~980 行。

### 🧪 测试与门禁

- 全量单测 **576 文件 / 6,215 用例**（+7 文件 / +32 用例）；`preflight:release` 全绿；lint 0 error / 1,855 warnings（1,868 → 1,855）。

## v4.47.0（2026-11-06）

### 🗳️ 指纹详情面板 12 维展示（V2 可视化补完）

- 新增 `ui/views/fingerprint-v2-detail.ts`：`buildV2FeatureRows()`（纯函数装配，3 条测试）+ `renderV2FeaturesSection()`（「🧬 十二维结构化特征」小节：逐维描述、pending 维度「样本不足」标记、引号样例，全部走既有工具类）。
- 详情面板对 `version:'v2'` 指纹在 7 维区块后追加 12 维小节；V1 指纹展示不变。

### ✂️ 协同视图切片第六批（co-writing-view 4,645 → 4,303，Trae 协作）

- 新增 5 个模块：`chapter-context.ts`（220 行，正文/步骤路径与章节标题提取）、`ghost-association.ts`（91 行，幽灵联想 8 步触发判定）、`quality-fix.ts`（135 行，修复决策与 Prompt）、`monitor-cards.ts`（321 行，五张监控卡）、`metrics-panel.ts`（227 行，指标三态与面板渲染）。
- 新增 5 个测试文件 40 用例；行为逐行等价，宿主接口注入。
- 指标面板进度条改原生 `<progress>`（accent-color 随主题），清理新代码内联样式与 cssText；新增 `nw-u-cursor-pointer-2` 工具类。

### 🧪 测试与门禁

- 全量单测 **569 文件 / 6,183 用例**（+6 文件 / +43 用例）；`preflight:release` 全绿；lint 0 error / 1,868 warnings 内（Trae 自检 1,863）。

## v4.46.0（2026-11-06）

### 🗳️ 指纹 V2 直存：蒸馏十二维一步入库

- `StyleFingerprintLibrary.addV2Fingerprint()`：磁盘直接落 `version:'v2'` 全量 12 维（不再"先 V1 落盘、等迁移"）；合成 `v1Backup` 供 V1 消费方还原（与融合路径一致）；project 作用域无项目时拒绝且不留半写。
- 入库同时直建 V2 逐维向量（`addOrUpdateVectors`，embedding 降级不影响入库），新指纹即时可被 `searchSimilarStylesV2` 命中。
- 提取视图接入：`handleExtractFromText` 走 `saveExtractedFingerprintWithLocalV2`——本地十二维统计成功即 V2 直存（提示"含 12 维结构化特征"）；统计/落库失败回落 V1 通道，两处降级均有可见提示（`check:silent-failures` 抓一轮后补齐）。
- 新增 3 条直存测试（12 维 + 投影一致 + 向量即检；重载不降级；project 拒绝半写）。

### 🧯 Notice 第十四批（0 替换，收敛完成，Trae 协作）

- add-fanfic-setting-modal 11、manage-providers-modal 7、style-distiller-modal 7 共 25 处逐条核对，**全部为守卫/输入预检/无变化/常驻进度**，按口径 0 替换；三文件确认收敛完成，移出候选。

### 🧪 测试与门禁

- 全量单测 **563 文件 / 6,140 用例**（+1 文件 / +3 用例）；`preflight:release` 全绿；lint 0 error / 1,868 warnings（持平）。

## v4.45.0（2026-11-06）

### 🔀 V2 十二维特征并入蒸馏链（用户决策 A′）

- `style-deconstructor-v2.ts` 迁为 `engine/style/style-features-v2.ts`（`StyleFeaturesAnalyzerV2`），**能力保留、能力落地**：`analyzeStyleFromSource` 样本模式本地计算十二维特征（`featuresV2`），并在报告尾部追加「## 十、十二维特征统计（本地词表计算）」小节。
- 新增 `formatFeaturesV2Section()` 渲染器；统计失败不阻断蒸馏主流程（只少该小节）。
- 旧零调用方端点随迁退役：`StyleDeconstructorV2` 类、heavy-task 的 `'style:analyze:v2'` 任务/fallback/`analyzeStyleV2()`；53 个既有用例全部迁至新模块并保持通过。
- 新增 5 条蒸馏链集成测试（样本/书名/守卫模式 + 提示词区分）。

### 🧪 测试与门禁

- 全量单测 **562 文件 / 6,137 用例**；`preflight:release` 全绿；lint 0 error / 1,868 warnings（持平）；any 306/306；JSDoc 725 文件 100%（heavy-task 公开方法 9→8）。

## v4.44.0（2026-11-06）

### 📐 StyleDeconstructor v1/v2 单入口设计定稿（P1-6 收口前置）

- 新增 `docs/design/style-deconstructor-v2-single-entry.md`：实测确认 V2（2,016 行）是**零调用方死端点**——唯一入口 `analyzeStyleV2()` 无生产引用、Worker 未注册、12 维特征从未落盘；推荐方案 A「下线 V2」并给出实施清单与验收口径，**待用户批准后单提交实施**。
- 本版只设计不实施（不与 Notice 混提交）。

### 🧯 Notice 第十三批（4 文件 13 处，Trae 协作）

- create-project-modal 9→2、manage-providers-modal 10→7、style-distiller-modal 9→7、add-fanfic-setting-modal 12→11。
- **co-writing-view 余 20 处全部为守卫/预检/无变化/进度类，确认无可替换**，从候选名单移除；剩余可替换存量集中在 manage-providers（7）等少数文件。

### 🧪 测试与门禁

- 全量单测 **561 文件 / 6,133 用例**（无新增）；`preflight:release` 全绿；lint 0 error / **1,868** warnings（持平）。

## v4.43.0（2026-11-06）

### ✂️ 协同引擎切片第六批（co-writer-engine 3,299 → 3,254）

- `buildDirectionalPrompt` 参数化后抽到 `engine/co-writer/directional-prompt.ts`：灵魂注入、剧情目标、简报片段、writingRules、PromptBuilder 实例与输入预算全部显式入参，状态访问留在引擎侧。
- 双路径逐行保留：有 PromptBuilder → 10 参数按序透传；无 → 兜底模板（第三人称限知 + bodyFormat 契约 + 已写内容末 800 字 + 开头/续写指令切换）。
- 新增 1 个测试文件 4 条；顺带清理引擎侧未用导入（lint 1,869 → 1,868）。

### 🧯 Notice 第十二批（6 文件 37 处，Trae 协作）

- batch-import-modal 11→9、generate-character-modal 10→5、ideation-modal 10→2、backup-center-modal 10→2、project-side-panel-view 10→4、wizard-step-renderers 10→2。
- 守卫、进度、预检、无变化与信息展示提示按口径保留。

### 🧪 测试与门禁

- 全量单测 **561 文件 / 6,133 用例**（+1 文件 / +4 用例）；`preflight:release` 全绿。
- lint 0 error / **1,868** warnings；JSDoc 724 文件 100%、`@example` 52/52；any 306/306。

## v4.42.0（2026-11-05）

### ✂️ 协同视图切片第五批（co-writing-view 4,986 → 4,645）

- 新增 `ui/co-writing/markdown-shortcut.ts`（Markdown 快捷键）、`quality-highlight.ts`（质检高亮应用）、`friendly-error.ts`（友好错误文案）、`kb-panel.ts`（KB 面板四页签渲染），宿主接口注入、DOM 逐行等价。
- 新增 4 个测试文件 17 条；`cowrite-fanfic-warning` 适配 notice-helpers 渲染文案。

### 🧯 Notice 第六~十一批（15 文件，252 处）

- 第六批 co-writing-view 60→20；第七批 writing-fingerprint-view 52→31；第八批 golden-opening-modal 45→14；第九批 6 文件 161→74；第十批 5 文件 91→24；第十一批 full-writer-view 11→5。
- 守卫、进度、预检、无变化提示按口径保留普通 Notice；eslint 1,870 → **1,869**。

### 🧪 测试与门禁

- 全量单测 **560 文件 / 6,129 用例**（+4 文件 / +17 用例）；`preflight:release` 全绿。
- lint 0 error / 1,869 warnings；JSDoc 724 文件 100%、`@example` 52/52；any 306/306。
- main.js 4,838,247 → **4,836,084**（−2,163 B），体积基线按纪律收紧。

## v4.41.0（2026-11-05）

### 🧩 质量引擎作用域收敛（P1-6 收口）

- 新增 `engine/quality/quality-engine-factory.ts`：`create*` 为每个视图/面板创建独立实例，`getScoped*` 为 heavy-task 管理器与 Worker 线程按 scope 缓存。
- `WritingQualityEngine` 5 处、`PlotDivergenceEngine` 4 处直接构造全部替换；引擎守卫基线收紧至 1 / 1，`engineOverLimit` 清空。
- 新增 8 例测试锁定「create 隔离、scoped 复用、reset 重建」。

### ✂️ 协同引擎切片第五批

- `co-writer-engine.ts` 3,407 → 3,299（-108）：剧情进度与目标提示抽到 `co-writer/plot-progress.ts`，评估提示词抽到 `co-writer/evaluation-prompt.ts`，节点/大纲/伏笔全部显式入参。
- 新增 10 例测试覆盖 30% 完成阈值、1500 字正文窗口、500 字大纲截断、伏笔 10/5 条上限。

### 🧯 Notice 第五批

- 5 个文件替换 30 处（成功 17 / 失败 8 / 告警 5）：供应商管理 7、批量导入 4、文笔蒸馏 6、世界观生成 5、全书规划 8；守卫/进度提示保留。
- eslint 0 error / 1,870 warnings，无新增。

### 🧪 测试

- 全量单测 556 文件 / 6,112 用例（+18）。

## v4.40.0（2026-11-05）

### 🧩 多实例状态源收敛（P1-6）

- `StyleIntensityEngine` 由 5 个实例收敛为 1 个共享单例：新增 `getStyleIntensityEngine()`，5 个消费方（知识注入/PromptBuilder/指纹库/动态注入/润色编辑器）统一取用；该类无可变状态，行为不变。引擎守卫基线 5 → 1 并已收紧。

### 🔒 轻量结算正文写锁

- `settleLight` 的正文 frontmatter 回写补 `withWriteLock(bodyFile.path, …)`，与 `BodyWriter` 的整篇写入共用同一路径锁，避免轻量结算与协同自动保存并发时互相覆盖。

### ✂️ 协同引擎切片第四批

- `engine/co-writer-engine.ts` 3,479 → 3,407（-72）：`getCoWriteOptions` + 模型/供应商解析链抽到 `engine/co-writer/co-write-options.ts`（settings 与 resolveModelLimits 显式入参）；云/本地分支、disableFallback、numCtx 下限逐行保留。

### 🧯 Notice 第四批

- 6 个文件替换 34 处（API 设置/Agent 工作台/知识库详情/知识库视图/写作工作台/指纹视图）；守卫/进度/预检/带操作引导提示保留，eslint 0 新增警告。

### 🧪 测试

- 全量单测 553 文件 / 6094 用例（+2：StyleIntensityEngine 单例行为）。

## v4.39.0（2026-11-05）

### 🔒 剩余裸读改写收口（v4.38.0 遗留 5 项）

- **结算回滚路径**：journal 回滚的每个文件读/写、`restoreSnapshots`、回滚清理新建文件全部按路径加锁，回滚与协同保存/其它结算并发时不再交错覆盖。
- **伏笔库新建竞态**：`settleStep_createForeshadows` 的存在性判断移入锁内——锁外读到「不存在」后，另一写入方刚建好的库不再被基础模板整篇覆盖。
- **新增伏笔行号**：`addForeshadow` 的存在性判断与 `getNextRowNum` 都移入锁内，并发新增不再重号，也不会覆盖刚创建的库。
- **伏笔追踪器**：新增 `updateTracker(project, mutate)`——读→改→写整段进锁；`saveTracker` 整份覆盖写也加锁，避免与 updateTracker 交错。
- **信息债看板**：delete+write 两步进锁，并发刷新不再出现「已删除未写入」空窗。
- 新增回归 2 例：伏笔库不存在时并发创建两条都保留；两个并发 `updateTracker` 条目都保留。

### 🧪 测试

- 全量单测 552 文件 / 6092 用例（+2）。

## v4.38.0（2026-11-05）

### 🔒 核心读改写路径写锁加固（P1-3 遗留）

- 补齐 6 处「读 → 改 → 写」整段锁：
  - 分析报告单人物状态更新；
  - 结算承诺账本/角色弧线表（锁内重读最新表再合并，不再用旧快照整表覆盖）；
  - V2 关系状态（load→apply→save 整段）；
  - `deleteEntity` 的伏笔库/时间线删行（锁内重读再 splice，避免覆盖并发新增行）。
- 审计确认 `withWriteLock` **不可重入**：已在外层锁内的路径一律不重复加锁；伏笔揭示/新增、时间线追加、实体字段更新等 13 处原有锁保持不变。
- 新增并发回归 3 例（真实锁 + 内存 fs，读中让出事件循环放大交错窗口）：并发新增/删除伏笔、不同路径并行、两个结算并发写承诺账本；去掉锁后必失败。

### ✂️ 协同引擎切片第三批

- `engine/co-writer-engine.ts` 3,556 → 3,479（-77）：`buildSnapshot` 抽到 `co-writer/snapshot-builder.ts`（`app/ctx/project/chapterName` 显式入参）；引擎保留同名薄委托（init 测试会打桩）。
- 顺带消除 1 处 `any`（`any` 预算 307 → 306，基线已下调）。

### 🧯 Notice 第三批

- 6 个文件替换 34 处（设置 API/Agent、工作台、知识库详情/视图、写作工作台）；成功/失败/告警三态统一，守卫/进度/预检例外口径不变；`agent-section` 移除未用 `Notice` 导入。

### 🧪 测试

- 全量单测 551 文件 / 6090 用例（+3）。

## v4.37.0（2026-11-05）

### 🐛 质检报告解析修复（v4.36.0 行为测试锁定）

- **⚠️ 变体选择符残留**：`parseQualityReport` 剥离 emoji 时只删 U+26A0，残留 U+FE0F；修正为 `[❌⚠✅]️?`，问题文本/定位文本不再带隐藏码点。
- **第N段/第N字 定位丢失**：正则捕获组 1/2 未被读取，导致数值定位回落成问题文本前 20 字；修正后 `第3段` → `locationText: '3'`，与文档示例一致。

### 🧭 伏笔「未揭示」误判修复（影响面 5 个文件）

- 新增 `shared/foreshadow-status.ts`：**先否定后肯定**的唯一判定（未揭示/待揭示/未回收/埋设 → 未揭示；已揭示/已回收/已兑现/回收 → 已揭示；其余 unknown）。
- 修复 `status.includes('揭示')` 把「未揭示」「待揭示」误判为已揭示的 5 处消费方：
  - 章节上下文 `filterForeshadowsByChapter`（未揭示伏笔被整行跳过）；
  - 信息债统计与 `getUnrevealedForeshadows`；
  - 分析报告 `moveForeshadowToRevealed` 行匹配；
  - 结算引擎伏笔统计；
  - 批量建章伏笔统计。
- 新增分类器单测 5 例 + 上下文消费者回归 2 例（旧实现下必失败）。

### 🧪 测试

- 全量单测 550 文件 / 6087 用例（+7）。

## v4.36.0（2026-11-05）

### ✂️ 切片收尾（协同引擎 + 知识库配置）

- `engine/co-writer-engine.ts` 3,747 → 3,556（-191）：AI 响应解析簇（`parseValidationResponse`/`parseEvaluationResponse`/`buildDegradedValidation`/`getEmptyMetrics`）→ `co-writer/ai-response-parse.ts`；剧情节点提取簇（`extractPlotNodes`/`extractSection`）→ `co-writer/plot-nodes.ts`（快照字段显式参数化）。
- `ui/views/knowledge-base-view.ts` 3,368 → 3,226（-142）：`renderConfigTab` 按「写状态留视图」模式切片 → `kb-config-panel.ts`（分类切换/流派选中写入留视图，DOM/事件逐行等价）。

### 🧯 Notice 第二批铺开

- 7 个文件（写章/续写/重建/大纲树/补全/扩写）替换 30 处，守卫/进度/预检例外口径与第一批一致；两个文件迁移后移除未用的 `Notice` 导入。

### 🧪 ui 覆盖率爬坡

- 新增 `tests/unit/ui/pure-helpers-coverage.test.ts`：113 个带真实断言的行为用例（质检报告解析/章节匹配/写作建议/Notice 降级路径/svg-charts/wizard-checker/template-vars 等）。
- ui/** lines **5.99% → 12.04%**；ui per-glob 棘轮按纪律收紧为 10/9/10/8（实际值-2 内）。

### 🧪 测试

- 全量单测 548 文件 / 6080 用例（+113）；lint 维持 1872。

## v4.35.0（2026-11-05）

### 🧪 check:bundle 进 CI（P2 尾巴）

- ci.yml verify job 在「构建」之后插入「校验构建产物体积预算」（`npm run check:bundle`），远程门禁与本地 preflight 对齐。

### 🧯 Notice 统一（P2）

- 新增 `ui/components/notice-helpers.ts`：`showErrorNotice / showSuccessNotice / showWarningNotice`（加粗标题行 + 消息 + 灰色 detail；DocumentFragment 渲染，单测环境自动降级纯文本，绝不抛错）。
- 关键用户路径铺开 29 处（导出/批量生成/模式文档/单元写作/结算/批量建章 6 文件），失败/成功/告警三类格式统一；守卫类提示与复合预检文案按例外保留普通 Notice。
- DOM 能力探测降级：单测环境（document 垫片只有 createElement）回退纯文本多行，85 个 ui 测试文件全绿。

### 🗂 知识库视图切片（第四批）

- `ui/views/knowledge-base-view.ts` 3,627 → 3,368（-259）：`renderStatsTab` → `kb-stats-panel.ts`（3 成员宿主）、`renderDetailActionButtons` → `kb-detail-actions.ts`（10 成员宿主，含强制取消确认流）；`renderConfigTab` 因含两个可写状态字段按范式放弃，留待后续。
- 视图收敛 `refreshDetailIfSelected` 承接两处重复刷新判定；eslint 净减 1 条（App 未用导入随清理消除）。

### 🧹 会话修剪用户入口

- 设置「📈 性能监控」新增「启动时清理旧会话」开关（默认开，`sessionRetentionEnabled`，关闭后启动完全不发起列举/删除）。
- 新增命令「🧹 清理旧会话」：手动触发、不受开关限制、必有 Notice 汇总（各目标删除数 / 无需清理）；活跃项目 Agent 存档豁免两条路径都保留。
- `pruneSessions` targets 支持 `enabled`（缺省 true 向后兼容）。

### 🧪 测试

- 全量单测 547 文件 / 5967 用例；lint 警告 1875 → 1873。

## v4.34.0（2026-11-05）

### 📦 体积预算门禁（P2，子代理协作交付）

- 新增 `check:bundle` 并接入 preflight：main.js/styles.css 只降不升的体积棘轮（LF 口径，与 CSS 基线一致）；基线 main.js 4,830,770 B（≤5MB 目标内）、styles.css 475,563 B；本次因新增会话保留等代码 +2,291B，note 已说明原因。
- 新增「Actions 锚定 SHA」：checkout/setup-node/upload-artifact 全部锚定到具体 commit（行尾注释保留版本号）。
- 新增「发布资产校验和」：release.yml 生成 SHA256SUMS.txt 并随 Release 上传（check-release 解析器零改动，worker+versions 校验不受影响）。

### 🧪 覆盖率门禁扩展（P2）

- `ui/**` 与 `domains/**` 纳入覆盖率统计并建立 per-glob 棘轮：domains 84/82/70/70，ui 首期诚实基线 3/3/4/3（实测 ~6%，只升不降）。
- 全局阈值移除（并入 ui 后失真），engine/services/core/shared 的 per-glob 原值保持；关键发现：include 与 threshold 的 glob 语义不同，ui/services 由 ui/** 阈值接管。
- 覆盖率口径文档（handbook 05）与 config 逐项对齐，清除长期不一致的旧数字。

### 🗑 会话保留清理（P2）

- 新增 `shared/session-retention.ts` + onload 延迟修剪：分析会话（`.sessions/*.json`）与 Agent 会话（`.sessions/agent/*.jsonl`）各保留最近 30 个（mtime 降序，缺失视为最旧）；当前活跃项目的 Agent 存档永不删；删除走注入 port、失败继续。
- 保守 MVP：只按数量不按天数、无用户可见入口（日志可见），为未来开关/命令预留。

### 🧪 测试

- 全量单测 547 文件 / 5965 用例；lint 维持 1875。

## v4.33.0（2026-11-05）

### 🧹 卸载清理契约（审计 P1-4）

- `onunload` 顺序化：三个 flush（设置写入器 dispose、知识库、批量导入、指纹库）先于 `disposeAll`，各自带 2s/3s 卸载期限（`withUnloadDeadline`，超时只告警不阻塞卸载）——修复 flush 与引擎销毁互相竞争的问题。
- 自定义字体补 `unregisterAllCustomFonts()`：卸载时释放全部 FontFace（注册表保留清单供下次启动恢复）。
- `ThemeManager` 补 `dispose()` 契约：移除主题样式 + 对称清理 15 个 `--nw-*` 布局变量（`THEME_LAYOUT_VARS` 单一事实来源，set/remove 对称）；`disposeAll()` 不再静默跳过它。顺带消除 14 条存量 style 警告（lint 1889 → 1875）。

### 🧭 分层门禁收口（审计 P1-7）

- `domains/`、`utils/` 纳入 `check-dependencies` LAYERS：**出向门禁**（只许依赖 shared）是本轮新增的真实约束；`ui/engine/services → domains/utils` 作为既有合法入站依赖显式声明。
- 修根因零违规：`resolveProjectRoot/modeFromLibraryPath` 下沉到 `shared/project-root.ts`（project-locator 保留 re-export，~30 个 import 站点不动）；删除 `domain-project-factory` 中未使用的 `WritingProfileManager` 运行时 import。
- `main.ts` 在门禁中显式登记为组合根（不参与分层）；基线零播种，7 层全部 0 违规。

### 🪓 协同视图切片（第三批）

- `ui/co-writing-view.ts` 5,152 → 4,986（-166）：`parseQualityReport`（纯函数）+ `QualityIssue` 接口 → `quality-report.ts`；`calculateChapterMatches` + `buildMatchCard` + `ChapterMatch` 类型 → `chapter-match.ts`（三处重复内联形状统一命名）。

### 🧪 测试

- 全量单测 546 文件 / 5955 用例；lint 警告 1889 → 1875。

## v4.32.0（2026-11-05）

### 💰 模型单价与费用估算（M4 第三批，子代理协作交付）

- 新增 `shared/model-pricing.ts`：`lookupModelPricing`（从 customProviders 的 `modelMeta` 精确匹配）+ `estimateCostYuan`（元/百万 tokens，6 位小数）；不内置价格表，未配置不计费。
- `CustomProvider.modelMeta` 新增 `inputPricePerM/outputPricePerM`；模型编辑弹窗（API 设置）可直接填写单价，留空不计费。
- `UsageRecord/UsageSummary` 及 byModel/byProject/bySource 全维度累计 `costYuan`；AI client 三入口记录时估算。
- 用量账本 UI：汇总卡新增「费用(元)」、按模型表新增费用列、单条记录显示 `¥x.xxxx`（未配置不显示，避免误读为 0 元）。

### 🎯 Agent 归因细化到步骤/工具

- 回合内模型调用挂 `stepKey: 'turn:<step>'`；工具执行挂 `stepKey: 'tool:<name>'`（嵌套 scope 重述 source/project，栈顶生效）。
- 今天 host tools 不调 AI，此归因为未来「会话内生成类工具」预留精确计费口径；新增行为级 scope 断言测试。

### 🪓 协同视图切片（第二批）

- `ui/co-writing-view.ts` 5,389 → 5,152（-237）：知识库参考卡抽到 `ui/co-writing/kb-reference-card.ts`（10 成员宿主接口），写作建议抽到 `ui/co-writing/writing-advice.ts`（纯函数化）。
- lint 警告 1890 → 1889。

### 🧪 测试

- 新增单价命中/估算公式、costYuan 聚合、agent scope 行为级断言。
- 全量单测 546 文件 / 5955 用例。

## v4.31.0（2026-11-05）

### 🧠 全链路注入与归因（M4 第二批，子代理协作交付）

- **模式文档注入**：故事核/分节大纲/场景圣经/分集大纲/分镜表的 AI 生成接入知识库 RAG 与文笔指纹（`injectionDeps` 可选传入，失败降级为空）；提示词在【文笔风格】后追加【文笔指纹】与「参考知识」块。
- **用量归因落线**：`UsageScope`（source/project/stepKey）+ `pushUsageScope` 三条链路挂接——
  - 步骤链：`executeCurrentStep` 按步骤挂 `source:'step'`（薄壳+执行体，全部 return/异常路径保证退出）；
  - 单元链：`runAI` 按单元+动作挂 `source:'unit'`；
  - Agent 链：`runHarnessTurn` 按回合挂 `source:'agent'`；模式文档生成挂 `source:'document'`。
  - AI client 三入口自动合并当前 scope；未挂 scope 的调用归入「(未归因)」桶（可观测漏挂点）。
- **账本 UI**：新增「按项目」「按来源」汇总表；调用记录显示来源/项目/stepKey 徽标。
- **备份中心**：版本条目新增「📜 历史」——复用 ChapterVersionModal 做行级对比与恢复，onRollback/onSaveVersion 完整接线，回滚后刷新备份列表。

### 🪓 大文件切片（续）

- `ui/views/knowledge-base-view.ts` 3732 → 3627：`createBookCard` 抽到 `ui/views/kb-book-card.ts`（宿主接口注入选中态/格式化/详情回调，DOM 逐行等价）。

### 🧪 测试

- 新增模式文档注入、scope 栈语义、byProject/bySource 聚合回归。
- 全量单测 545 文件 / 5946 用例；lint 保持上限 1890。

### 🧭 M5 平台化评估

- 新增 `docs/audits/m5-platform-assessment.md`：公共插件 API / MCP / 模板市场 / 云协作四项**均不实施**，冻结重评条件（外部需求信号、契约稳定、安全基线、M4 收尾指标、专人维护）。

## v4.30.0（2026-11-05）

### 🧩 资产总览（AssetRegistry）

- 新增 `engine/asset-registry.ts`：统一聚合写作规则、提示词模板（vault 覆盖 + PromptManager 自建）、文笔指纹、知识库、写作配置的来源/版本/生效状态与影响范围。
- 新增「🧩 资产总览」弹窗与命令：按资产种类分组，显示「生效/未生效」，可跳转对应文件；主页入口同步加入。
- `ALL_TEMPLATE_DEFS` 下沉到 `shared/prompt-template-catalog.ts`，UI 保留 re-export。

### 🧠 全模式知识/指纹注入

- 新增 `engine/mode-injection.ts`：短篇/剧本单元写作接入知识库 RAG（`retrieve` + `formatRetrievalHits`）与文笔指纹（`selectFingerprintsForInjection`，上限 3），失败降级为空。
- 单元写作上下文新增 `knowledge/fingerprints`；提示词新增【参考知识】【文笔指纹】块，与长篇 11 步共用同一套检索与选择策略。

### 💰 AI 用量账本

- 新增 `services/usage-ledger.ts`：在 `AIApiClient` 的非流式/流式/异步迭代器三个入口统一记账（模型、token、耗时、状态），落盘到插件数据目录（不进用户 vault），上限 500 条。
- 新增「💰 AI 用量账本」弹窗与命令：总量卡片、按模型表格、最近调用列表；主页入口同步加入。

### 🗂 版本与备份中心

- 新增 `services/backup-center-service.ts`：按项目聚合 `_versions/` 版本快照、步骤/结算/质检产物与插件 `data.json.bak`。
- 新增「🗂 版本与备份中心」弹窗与命令：版本条目可一键回滚（当前内容自动存为 rollback 版本），产物/备份可打开查看；主页入口同步加入。

### 🪓 大文件切片（第一批）

- `ui/co-writing-view.ts` 5440 → 5393：Markdown 工具条抽到 `ui/co-writing/markdown-toolbar.ts`（宿主接口注入编辑器/契约/排版回调）。
- `engine/co-writer-engine.ts` 3911 → 3750：本地模型判定与 Ollama 探测抽到 `engine/co-writer/local-model-utils.ts`，原入口保留 re-export；顺手清理 4 个未用导入，lint 警告 1892 → 1890。

### 🧪 测试

- 新增资产总览、用量账本、备份中心、单元提示词注入回归。
- 全量单测 545 文件 / 5940 用例；lint 上限降至 1890。

## v4.29.0（2026-11-05）

### 🧩 ModeRuntime：短篇/剧本上下文

- 新增 `engine/mode-runtime.ts`：统一读取故事核/场景圣经、分节/分集大纲、剧本分镜表、前期调研、人物/地点/势力/物品状态与项目文笔风格。
- 单元写作提示词接入上述上下文；剧本不再漏掉分镜表，短篇/剧本不再只读 4 个文档。
- 修复单元提示词的「本节大纲」硬编码，剧本显示「本集大纲」。

### 🤖 模式文档 AI 生成

- 故事核、分节大纲、场景圣经、分集大纲、分镜表全部支持「🤖 AI 生成」：基于前期调研 + 现有文档 + 实体状态生成，编辑区确认后手动保存。
- 短篇分节大纲强制「开篇三屏」：第 1 屏立人物/困境，第 2 屏升级冲突，第 3 屏抛出主悬念；单元写作前 3 节同步约束。
- 覆盖已有编辑区内容前使用 `OperationConfirmModal` 二次确认。

### 🧪 六维/可拍质检与修订闸门

- 新增 `shared/quality-profile.ts`：三模式通过线、维度、额外检查与修订闸门参数集中配置。
- 新增 `engine/mode-unit-quality.ts`：复用 `QualityScoreEngine` 六维评分，短篇追加开篇钩子/结尾兑现，剧本追加场次可拍/对白占比/动作行。
- 质检结果写入单元 frontmatter（`quality_score/grade/passed/checked_at`）与 `04-质检`/`05-质检` 报告；UI 显示六维、模式检查与问题列表。
- 改写选区接入 `evaluateRevision`，按模式使用不同长度/对话跌幅阈值；未通过则保留原稿并提示原因。

### 🧾 单元结算

- 新增 `engine/mode-unit-settlement.ts`：复用 `settleLight` 做人物/地点/势力/物品出场确认，自动从正文匹配实体名；单元标记 `status: settled`，写 `_结算.md` 记录。
- 单元工具条新增「🧾 单元结算」；结算失败有可见原因。

### 📦 平台导出包

- 新增 `shared/platform-export.ts`：番茄短篇 / 红果短剧的平台名、文件名前缀、简介、标签、字数/单元数与敏感词预检。
- 短篇/剧本 TXT/Markdown 导出自动加「平台投稿信息」头；EPUB/DOCX 写入 `dc:description` / `dc:subject`；文件名改为 `番茄短篇_书名_日期` / `红果短剧_书名_日期`。
- 导出前敏感词命中以 Notice 提示（不阻断），便于作者决定是否替换。

### 🧪 测试

- 新增模式质检、平台包、模式文档提示词回归。
- 新增 `mode-journey` E2E：短篇/剧本各一条「AI 生成 → 质检 → 结算 → 平台包导出」真实 Obsidian + mock AI 旅程。
- 全量单测 542 文件 / 5933 用例；mock E2E 12 passed。

## v4.28.0（2026-11-04）

### 🏠 统一入口

- 新增「创作主页」视图：长篇/短篇/剧本三卡、最近项目、下一步建议、任务中心与项目体检入口。
- 主 Ribbon 收敛为「创作主页 / 任务中心 / Agent / 项目速览」；项目与章节、创作流程、句级协同、知识库、指纹库仍保留命令深链，不再各占一个主入口。
- 新增命令：`🏠 创作主页`、`🧵 任务中心`、`🩺 项目体检`、`🚀 首启引导`。

### 🧵 任务中心

- 新增 `services/job-service.ts`：统一任务模型（queued/running/succeeded/failed/cancelled）、进度、取消、重试、订阅与 `waitFor`；失败保留错误与结果现场，重试创建新记录。
- 新增任务中心弹窗：进行中可取消，失败/取消可重试，显示阶段、进度、项目与错误原因；关闭弹窗不丢任务记录。
- 接入：批量生成章节（`BatchNovelsModal`）、章节一键完成（`ChapterOrchestrator`）、成稿导出（`ExportManuscriptModal`）、批量拆解（`BatchDeconstructModal`）。
- 导出在章节收集/编译/写入之间检查取消信号；章节一键完成的取消会同步到 orchestrator。

### 🚀 首启向导

- 新增 5 步向导：选择提供商 → 填写/保存 Key → 连通性测试 → 导入示例项目 → 进入主页/流程/工作台。
- 新装欢迎弹窗主按钮改为「3 分钟开始」并保留「直接进入工作台」；完成/跳过写 `firstRunComplete`。
- Key 走现有 providerKeys + saveSettings 加密链路；测试复用 `testProviderConnectivity`。

### 🩺 项目体检与错误态

- 新增 `services/project-health-service.ts`：重复正文、未结算、frontmatter 未闭合/重复键、正文目录孤儿文件四类问题；只报告不自动修改。
- 新增项目体检弹窗：按严重度展示问题、跳转文件、重新体检。
- 新增 `ui/components/error-state.ts` 统一错误态（标题 + 原因 + 修复动作），体检失败已接入。

### 🎨 样式

- 新增 `styles-src/17-home-jobs-health.css`：主页、任务中心、向导、体检样式；状态类统一 `nw-is-*`；CSS 基线 +7046B（只增不减门禁已按流程更新 note）。

### 🧪 测试

- 新增 JobService 生命周期/取消/重试/历史淘汰、项目体检四类问题回归。
- 全量单测 539 文件 / 5925 用例通过（最终数字以 `preflight` 为准）。

## v4.27.1（2026-11-04）

### 🚦 门禁可信化

- **ESLint 空转修复**：`eslint.config.mjs` 改用 `ruleConfigs.recommended`，显式注册 `typescript-eslint`；`no-unused-vars` / `no-explicit-any` 等规则真实生效。存量 1,894 条先按 warn 收敛，`lint` 设 1,900 上限，0 error。
- 修复设置页标题触发 `no-problematic-settings-headings`；移除角色拆解里 iOS 不安全的 lookbehind。
- 新增 `check:write-entry` 并接入 `preflight`：用户可见 Markdown 禁止裸 `adapter.write/append`，索引外文件需显式豁免标记。

### 🔐 Agent 写入确认

- 新增 `agentWriteApproval` 设置（默认 `ask`），设置页提供「Agent 写入确认」。
- Agent 工作台显式传 `writeApproval`：覆盖已有文件需确认，新建文件放行；`dangerous` 操作始终确认。
- Harness 库级默认保持 `allow`，安全策略由宿主决定，避免破坏既有调用方。

### 📦 dsh 供应链与密钥

- 默认固定 `@deepseek-ai/dsh@0.2.1-rc.5`，不再 `npx` 拉 latest；设置页可显式配置 `dshVersion`。
- 启动 dsh 前用 `decryptKey` 解密 `settings.apiKey`；解密失败可见提示，不把密文传给子进程。

### 💾 数据可靠性

- v1 密文自动升级 v2：有会话口令时启动迁移自动重加密并计数；无口令时保留旧密文，不降级明文。
- 设置迁移/回写前写 `data.json.bak`；迁移失败仍保留原文件。
- `BODY_CONTENT_ROOTS` 从 `MODE_LIBRARY_ROOTS` 派生，修正短篇/剧本统计扫错顶层目录；`isChapterBodyPath` 支持 `03-正文/第N节` 与 `03-剧本/第N集`。
- `frontmatter-schema` 路径兜底同步修正。
- 拆解报告、协同审核记录、备份元文件、示例项目、项目创建模板复制改走 `writeVaultText`，进入 vault 索引。

### 📚 文档

- 新增完整架构审计 `docs/audits/v4.27.0-architecture-and-roadmap.md`。
- 新增 `docs/PRODUCT.md`、`docs/roadmap/ROADMAP.md`。
- 新增 ADR-008~012：可信门禁、Agent 写审批、ModeRuntime、AssetRegistry、JobService。
- 补齐 v4.25.0 / v4.26.0 / v4.26.1 发布说明。

### 🧪 测试

- 新增 v1 密钥迁移/备份回归、短/剧正文根目录回归、设置口令验证适配。
- 完整单测与 mock AI E2E 在提交前执行（数字以 `preflight` 输出为准）。

## v4.27.0（2026-11-04）

### 🚦 全流程阻塞点

- **步骤双击双发**：`executeCurrentStep` 在模板解析前先置 busy，快速连点不会并行两次 AI 调用竞写同一步骤。
- **保存/切章超时**：协同保存、外部修改检测、切章前冲刷全部加 10–35s 上限；同步盘锁定时不再永久停在「保存中」。
- **批量步级看门狗**：批量生成每步 8 分钟超时并 abort，不再让模态框无限等待。
- **暂停自动恢复**：一键流程暂停 10 分钟无操作自动继续；Agent 危险审批/ dsh 写入确认 10 分钟无响应默认拒绝。
- **导出**：捕获异常并提示；章节读取并发 6 批 + 分批让出主线程；大项目不再静默失败/长时间冻结。
- **切章重入**：`openChapter` 增加代次，快速连切两章时旧链在关键 await 后退出。
- **项目选择器**：高亮未命中不再默认连渲 3 遍。
- **后台实体重检**：新编辑取消旧检测、禁止弹密钥框、传 AbortSignal，减少与协同建议争抢本地模型。
- **流式并发槽**：等待期间感知 abort，取消后不再空转轮询。

### 🔐 数据可靠性

- 6 处 frontmatter 直写改走 `ObsidianFrontmatter`（重复键自愈），结算完稿/重建/属性补齐不再因历史重复键整体失败。
- 协同持久化移除 `chapterContent`（只写不读），data.json 不再携带整章正文；编辑历史截断 10 条。
- 指纹库改为项目级单例（`StyleFingerprintLibrary.get`），同项目共享实例，卸载统一 `flushAll`，避免多实例后写覆盖。
- 实体仓储 `save()`、`.project` 故事结构/叙事结构读改写加 `withWriteLock`。
- 拆解调度器 `dispose()` 先冲刷待写队列；知识库/批量导入补 `dispose()`。
- 用户可见 Markdown（上下文注入、同人审核/向导、Fanfic 设定）改走 `writeVaultText`，进入 vault 索引。

### 🧭 交互与设置

- 新增 `ui/button-busy.ts`，协同「更多工具」、场景/联想/扩写/改写、结算/节点推进统一防连点。
- 知识库视图 `viewClosed` 在 onOpen 复位，close→open 后刷新不再永久短路。
- 命令面板：补 `WRITING_STATS`/`TOGGLE_PET`/`CHARACTER_RECOGNITION` 定义与注册，硬编码 ID 改常量；新增「addCommand 集合 === 非 internalOnly 定义集合」测试。
- **设置双 UI 收敛**：`ui/settings/section-factory.ts` 成为 tab→分区唯一装配表；`MiniSettingsModal` 由 2755 行瘦身为薄壳，与设置页共用同一批 Section；新增 `render()` 抽象契约与弹窗样式。
- **删除项目卡改二次确认**：不再要求手动输入项目名；连续两次确认（继续删除 → 最终确认）后才执行删除。

### 🧪 测试

- 全量单测 **536 文件 / 5915 用例** 通过。
- 新增项目级指纹库单例、命令集合一致性、协同持久化瘦身、设置分区等回归。
- 新增生产环境模拟 E2E（mock AI 全旅程、按钮忙碌态、视图生命周期）。

## v4.26.4（2026-11-04）

### 🧵 模板流转单一入口

- 新增 `engine/prompt-resolver.ts#resolveStepPrompt`：固定优先级 **vault 自定义 > 用户覆盖 > 内置**，返回 `source / templateId / templateVersion / templateHash / unresolved`。
- 交互式单步、批量流水线、继续生成、情绪规划、Scene 展开全部改走同一 resolver；模板变量统一支持 `${var}` 与 `{{var}}`，未解析变量显式告警。
- 合并规划检测到 5 个规划步骤存在自定义模板时，自动切换为分步执行，不再静默忽略自定义模板。
- 步骤结果写入实际模板 id/version/hash（正文不再固定记成 V1）与规则版本/hash；`step_template_hash` 新增落盘字段。
- `TemplateService` 缺模板兜底改用构建期 `assets/template-scaffold` 生成物，并保留骨架 frontmatter；`TemplateManager` 清空模板会删除覆盖文件，导入 0 个片段不再提示成功。

### 🧭 数据源与路径统一

- `BodyWriter` 格式契约改为读取 vault 唯一写作规则；`ContextManager` / 上下文差异检测同步监听 vault 规则路径；`RulesService` 支持显式 project，缓存不再串项目。
- 新增 `resolveBodyFilePath()`：先查已存在的标题化正文（`第3章_风起_正文.md`），再回退裸路径；协同视图/浮窗、结算、审查、导出、续写、批量续跑全部接入。
- 导出章节正则支持标题化正文，修复标题化章节漏导。
- `projectIdFromPath` 收敛到 `shared/project-catalog`（`shared/paths` 保留薄包装）。
- `onunload` 清理 `PromptCache` 与 `RulesService` 单例，避免热重载残留整章文本/旧 App。

### 🧪 测试

- 新增 `prompt-resolver`、`template-flow`、标题化章节目标等回归。
- 全量单测 **534 文件 / 5910 用例** 通过。

## v4.26.3（2026-11-03）

### 🧭 项目来源统一

- 新增 `shared/project-catalog.ts`，项目发现/身份/删除只有一个实现：
  - `listProjectIds()` 供 Agent 工作台、导出、项目卡、`getActiveProject()` 共用；
  - `detectProjects()` 改为直接委托，不再维护第二套文件扫描；
  - 重命名查重也改用同一份项目列表。
- 项目身份不再认单独的 `03-大纲与章节`：删除项目后残留的空章节目录不会被当成项目；项目标志只认 `作品信息.md`、`世界观总览.md`、`写作配置.md`、`00-系统模板`、`01-世界架构`、`短篇创作`、`剧本创作`、`.project`。
- `BodyWriter` 写入前校验项目身份：项目已删除时拒绝写入，避免打开中的协同/工作台自动保存把 `03-大纲与章节`、`_versions` 重建出来；协同保存命中该错误时清空章节绑定并提示。

### 🤖 Agent 工作台

- **项目列表实时同步**：监听 vault 的 create/delete/rename，防抖刷新左栏、项目 chip、文件树与 `AgentContext.projects`；其他视图删除项目后 `list_projects` 不再返回旧项目。
- **Agent 全权限工具**：新增 `write_file`、`delete_file`、`move_file`、`delete_project`；配合已有 `run_command`，Agent 可完成新建/写入/整理/删除项目与文件。`delete_file` / `delete_project` 仍走危险操作二次确认。
- `delete_project` 成功后立即刷新会话项目快照并清空当前项目；项目删除不会留下“Agent 仍能操作已删项目”的状态。

### 🧪 测试

- 新增项目目录单源回归（`_versions`、`.hidden`、空目录、只有 `03-大纲与章节` 的残留均排除）、BodyWriter 删除保护、Agent 写/删/移动/删项目工具测试。
- 全量单测 **532 文件 / 5900 用例** 通过。

## v4.26.2（2026-11-03）

### 🧹 类型债与门禁

- **any 预算棘轮**：新增 `check:any`（TypeScript AST 统计，注释/字符串不计），基线 `.any-baseline.json` 记录总数与单文件额度；总数或单文件超限即失败，新增文件出现 `any` 也失败。本轮运行时代码 `any` 由 **463 → 309**（-154），覆盖实体工厂、协同引擎、上下文、质量评分、写作配置、AI 客户端等。
- **any 收敛**：`Frontmatter` 值对象改为 `unknown`；协同快照的伏笔从 `unknown` 改为 `ForeshadowData`；`KnowledgeInjector` 新增 `setFingerprintLibrary()` 正式入口，删除两处私有字段强转。
- **CHANGELOG 门禁**：新增 `check:changelog`，要求顶部为 package.json 当前版本且唯一、禁止主 CHANGELOG 再堆积 `Unreleased`。

### 📦 大文件切片

- `engine/ai-api-client.ts` **1720 → 882 行**：流式调用（原生 SSE / 异步迭代器 / 模拟流）拆到 `engine/ai-api-stream.ts`（906 行），纯错误与响应类型拆到 `engine/ai-api-client-shared.ts`（85 行）；非流式 `callAI` 与并发槽状态仍在原文件，公开 API 不变。
- `ui/co-writing-view.ts` **5588 → 5416 行**：人工率仪表盘拆到 `ui/co-writing/human-rate.ts`（纯计算可单测），知识库/指纹库完成度与状态条拆到 `ui/co-writing/asset-status.ts`。
- 新增 9 个纯函数单测（人工率 4、资产完整度 5）。

### 🗂️ 文档与依赖治理

- **历史 CHANGELOG 归档**：49 段 `Unreleased`（v8.x / 4.10.x）迁到 `docs/changelog/archive-unreleased.md`，主文件只保留正式版本节点（47 个）。
- **跨平台 CI**：新增 Windows / macOS 矩阵（typecheck + 全量单测），Linux 仍由 `verify` 覆盖；新增 `.github/dependabot.yml` 月度分组升级。
- **手册**：新增 `docs/handbook/11-dependency-and-platform-compatibility.md`（依赖登记、平台矩阵、移动端约束、Obsidian 1.4/1.5 与发版手工冒烟清单）。

### 🧪 测试

- 全量单测与 `preflight` 通过；新增门禁 `check:any`、`check:changelog` 已接入 `preflight`、CI 与 Release。

## v4.26.1（2026-11-03）

### 🔧 核心链路

- **正文完成后润色入口消失**：消痕/精修按钮只在当前步骤正好是正文时渲染，自动推进到质控/分析/结算后立即消失；现改为「正文已完成后，在所有后续步骤保留」。
- **迭代精修保存失败**：按钮调用 `executeIterativeRefine` 时 chapDir/chapterName/volume 传的是 `undefined`，接受改写后无法定位正文文件；现传入真实章节参数，并对入口 Promise 统一捕获、按钮防重复点击。
- **结算后润色编辑器静默失效**：打开已结算章节时内存中没有 `bodyGeneration`，编辑器直接 return；现从正文文件回填，渲染异常显示错误与「重试加载」，不再无反馈。
- **步骤滞留**：一键流程新增单步看门狗（默认 8 分钟），超时主动 abort 并抛可重试错误，避免无限卡在「执行中」。

### 📊 数据与结构

- **字数统计偏低**：扫描变更文件时按正文实算，不再信 frontmatter 里可能过期的 `word_count`（仅正文读不到时兜底）。
- **标题遗漏**：修复 `extractChapterTitle` 的 `\s` 跨行匹配——模型只写 `# 第3章` 时会把正文首句当成标题；标题缺失时用旧 frontmatter「标题」/章节名兜底；正文校验新增「标题完整」，提示词明确「标题 = 第几章 + 章名」。
- **写作格式说明**：删除 `describeBodyFormat` 中残留的 2–6 句/80–220 字硬指标，与 v4 引导体系一致。

### 🤝 协同写作

- 新增「🧾 剧情冗余」入口：调用已有 `checkPlotRedundancy`，对比前文场景/冲突/短语重复。
- 底部操作栏统一忙碌态与异常捕获；保存失败时「结算」不再提示成功；空指令输入给出提示。

### 🧹 技术债清理与依赖

- **依赖升级**：Vitest 1.6→4.1.12（含 coverage-v8、Vite 7）、esbuild 0.19→0.25.12、Playwright 1.61→1.64.1、obsidian 类型 1.13→1.14.4、TypeScript-ESLint 8.72.1、wait-on 9.5.1。
- **漏洞收敛**：`npm audit` 由 39 条（3 critical / 9 high）降至 23 条（0 critical / 0 high）；剩余均为开发期 `eslint-plugin-obsidianmd` 内嵌 moment 的中危告警，无可用修复。
- **死代码删除**：移除无调用方的 `engine/prompt-manager.ts`（395 行）与 `engine/prompts/writing-rules-legacy.ts` 兼容壳。
- **测试基建适配 Vitest 4**：补 `obsidian` mock 的 `Setting`；修正 spy 未恢复导致的用例串扰；更新 `vi.fn` 泛型。
- **覆盖率口径**：Vitest 4 AST-aware remapping 使同一批测试的统计值变化，按新口径重取分域阈值（全局 lines 64 / branches 55；shared 85/77），未删减测试。

### 🧪 测试

- 单测 **529 文件 / 5879 用例** 全绿（标题兜底、标题完整性、字数统计、单步看门狗、润色入口参数等新增回归）。

## v4.26.0（2026-11-03）

### ✍️ 引导型写作规则体系 v4（单一镜头）

- **规则来源绝对唯一**：唯一生效来源是 vault 的 `元文件/00-系统模板/写作规则.md`；项目内副本在启动迁移时删除（不再复制），内置 5 个版本（3.6.0/legacy/3.7/3.8/3.9）收敛为唯一 v4.0.0 模板；设置页删除版本下拉与漂移告警，改为「唯一来源 + 版本 + 在 Obsidian 中打开」。
- **规则内容重写为纯引导**：核心锚点「单一镜头——每章只从一个视角人物观察世界」置顶；心法改为提问式（入场/念头/感官/对话/信息/他人/节奏/收尾）；**删除全部数值禁令**（禁用词 20 个、标点上限、段落 2–6 句 80–220 字、每千字节点数、占比阈值、2000–3000 字合格线等）；唯一禁止只剩两条（不以作者身份写作、不写镜头外信息）。
- **模式附录**：长篇连载 / 短篇单元 / 剧本分镜三段附录由 `RulesService` 按项目创作模式拼进同一份规则文本——注入点仍只有 `${writingRules}` 一个。
- **提示词全量同步**：V1–V4 正文（删 `${craftConstraints}` `${negativeList}`，加 `${lensDeclaration}`）、信息规划/情节蒸馏（删条数与密度数值）、分析报告（强制提取改为引导，保留结算机器标签；DENSITY/WORD_COUNT 改观察记录）、质量控制 14 项 → **六块引导式复盘**（镜头一致性/承接与钩子/人物动机/世界设定/节奏/语言质感，旧三块名兼容）。
- **二号规则源下线**：`ai-prompt-builder` 内嵌 14 条删除，改为调用方传入 `RulesService` 全文；协同写作快照与改写/关联的 3000/2000 字切片规则块移除。
- **管理模板打通**：`模板管理` 里自定义过的步骤模板（信息规划/蒸馏/大纲/情绪/Scene/正文）现在真正覆盖 pipeline 默认值（`_stepOverrides` → `getStepTemplateAuto`）。
- **门禁调整**：质量闸门的冲突/AI 词表降级为报告项（passed 只看节拍结构）；QC 校验兼容新旧两套标题；上下文体检锚点改认「每段开头空两格」。
### 🧭 路径与三模式设置

- **统一模块路径别名**：运行时跨目录引用全部改为 `@/layer/file`（2043 处），消除 `../../..` 深嵌套；`tsconfig` / esbuild / vitest 三处配置别名，`check:deps` 识别 `@/` 为仓内引用。
- **模式根目录单一来源**：`CREATION_MODE_SPECS` 新增 `rootDir`，`MODE_LIBRARY_ROOTS` 由它派生；`project-locator` 只做再导出，`project-name` 保留目录从列表派生，三个模式不再各自硬编码。
- **新增「📚 创作模式」设置分区**：集中展示长篇/短篇/剧本的项目库根目录、内容结构、单元规格与适用链路；原有设置项全部保留在各自分区。
- **写作配置实时校验**：默认/最小/最大字数不一致时行内提示（最小≤默认≤最大），不再静默保存非法组合。
- 三份分模式说明：`docs/audits/v4.26-mode-long.md`、`v4.26-mode-short.md`、`v4.26-mode-script.md`。
- 单测 **529 文件 / 5876 用例** 全绿（规则注册表/结构解析/镜头与模板消费/质控校验等 20+ 处回归更新）。

## v4.25.0（2026-11-02）

生产环境兼容性测试与优化更新：把声明的最低 Obsidian 版本真正落到可运行，并修掉空闲 CPU 与流式分段两处实测问题。

### 🔧 兼容性

- **Obsidian 1.4.0 支持**：`Modal.setTitle()` 仅 1.5+ 提供，批量导入的文件/文件夹选择弹窗改用 `titleEl.setText()`；`manifest.minAppVersion` 由 1.5.0 下调到 1.4.0。
- **修复 1.5.x 运行时报错**：`shared/file-system-port.ts` 不再调用晚于 1.5 才加入的 `Vault.getAllFolders()`，改为沿 `TFolder.children` 递归；否则声明的最低版本与实际 API 不符。
- 以 `obsidian@1.4.0`、`obsidian@1.5.7` 类型定义分别执行全量 `tsc --noEmit`，均无 API 缺失。

### ⚡ 性能

- **桌面宠物空闲功耗**：SVG 内层的浮动/尾巴/眨眼无限动画会让主线程逐帧重绘；改为只在 HTML 外层做 `transform` 浮动（走合成层），移除尾巴与眨眼常驻动画。
- 实测（Obsidian 1.14.5，Windows，CDP `TaskDuration`，无插件基线对照）：空闲主线程开销 **10.22% → 0.21%–0.23%**，JS 堆增量约 **24–30 MB**，满足 5% CPU 阈值。
- 新增 `perf-smoke` E2E（`E2E_PERF=1`）与生命周期 E2E：重复 3 轮禁用/启用、移除插件目录后重启。

### 🐛 修复

- **模拟流按段落切分丢换行**：`splitTextIntoChunks(..., { splitBy: 'paragraph' })` 原实现用 `split` 丢弃 `\n\n`，逐块拼接后正文段落粘连；现保留分隔符并新增 `chunks.join('') === 原文` 回归断言。
- **结算报错「Map keys must be unique」**：旧版字符串级 frontmatter 更新器对空值行 `entity_last_changed_at:` 匹配失败后又在顶部插入同名键，人物文件出现重复 YAML 键；结算的每一项 UPDATE 都会失败（截图里的 当前状态/当前位置/伤势/持有物品 全部报错）。现在：`shared/frontmatter.ts` 新增 `setFrontmatterValue()`/`dedupeFrontmatterKeys()`，写入时收敛重复键；`ObsidianFrontmatter.processFrontMatter` 遇到重复键自动去重后重试，存量损坏文件无需手工修。
- **分析报告按 5000 字截断**：角色状态/时间线检测只看正文前 5000 字，第三章 6385 字的后半段状态变化全部漏检；上限提高到 12000 字。
- **分析报告字数判定过严**：硬编码「2000–3000 字为合格」会把 6000+ 字的长章直接判不合格；改为以「写作配置」的每章上下限为准，超长按密度规则判定。
- **强制揭示名字识别错误**：`forcedRevealHint` 的真实格式是 bullet 列表/单行建议，旧解析只认「揭示：名字1, 名字2」，导致每次结算都误报「未识别出任何名字」且强制揭示从未生效；现兼容 bullet/单行建议/显式行三种格式，信息债健康等纯提示行不再告警。
- **项目列表误识别 `_versions`**：Agent 工作台/导出门面把模式库下所有子目录都当项目，`长篇小说/_versions`（章节版本存储）会多出一张项目卡；现要求存在 `.project`/作品信息/世界观/正文目录等项目标志，并跳过 `_`/`.` 前缀目录。

### ✍️ 设置整理

- **写作配置按五组重排**：篇幅与字数 / 正文形态 / 上下文与模型 / 质量闸门与修订 / 阈值与词表；说明文案去掉实验编号与内部事故叙述，只保留用户需要知道的默认值与影响。
- **写作规则集中管理**：`写作规则版本` 下拉从「写作配置」移到「写作规则」页，与状态卡、漂移提示、重新检查放在一起；切换版本立即调用 `setActiveVersion` 并重检。
- `实验分组标签` 移到「写作规则」页；页签名称由「规则版本」改为「写作规则」。

### 🧪 测试与依赖

- 单测 527 文件 / 5885 用例通过；真实 Obsidian E2E 27 条主旅程 + 2 条生命周期 + 1 条性能冒烟通过。
- 运行时依赖为 0（仅 `obsidian` external）；开发依赖审计有 39 条告警（Vitest/Vite 链），不随插件发布，已登记为后续升级项。

## v4.24.0（2026-11-02）

### 📚 文档体系

- 新增 `docs/README.md` 总索引与「真相源责任表」；新增 `docs/handbook/` 11 篇（上手、环境、架构、模块标准、接口契约、测试、门禁与发布、排障、评审、注释规范、文档政策）。
- 新增 `docs/adr/`（索引 + 模板）、`docs/glossary.md`、`docs/releases/TEMPLATE.md`。
- `docs/generated/` 改为生成物：代码索引（文件/层/行数/导出/JSDoc 覆盖）与门禁表。
- 修复过期事实：README 版本与门禁清单、CONTRIBUTING/PR 模板、PLAN 真相源表、PROGRAM 的 `.trae` 引用与 NUL、BASELINE、tests/README、CODE-INDEX（改为导航 + 生成索引）、PERFORMANCE（旧文件编码损坏，按当前代码重写）。

### 🚦 门禁与流程

- 新增 `check:docs`（索引/链接/版本戳/命令/编码/生成物漂移）、`check:jsdoc`（注释覆盖率棘轮）、`gen:docs`。
- `preflight` 补齐 `check:jsdoc`、`check:docs`、`build`、`check:release`；新增 `preflight:release`（+`test:cov`），`build:release` 改用它。
- 基线缺失不再自动放行：`check:deps` / `check-engines` 支持 `--require-baseline`（CI 默认启用）。
- `check:dsh-isolation` 修复漏检：匹配 `require('child_process')` 与 `node:` 前缀，扫描根级入口，并支持显式例外。
- `check:release` 增加 `main.js` 语法检查、tag 时校验发布说明存在、`release.yml` 资产声明不可解析时报错。
- CI：`check:styles` 前移、新增文档/注释门禁、生成物漂移纳入 diff；Release：补 `audit:deps`、`test:cov`、同样的文档门禁与漂移检查。

### 🧩 代码

- 新增 `shared/desktop-shell.ts`：只提供 `setPathReadOnly` 的窄接口，动态 import `node:child_process`，使用 `execFile` 参数数组；`ui/protect-yuan-modal.ts` 不再直接 `require('child_process')`。
- `program-status.mjs` 渲染前剔除控制字符，修复台账 `\u0000` 导致的文档二进制化。

### 📝 注释

- 新增注释/JSDoc 规范（文件头四段式、导出标签、事故注释格式）与棘轮基线；当前导出覆盖 46%，新增/修改导出必须有注释。

### 🧪 验证

- `preflight`：524 文件 / 5866 用例通过，含文档与注释门禁、构建与发布资产校验。
- `test:cov`：通过（lines 77.22% / branches 78.88% / functions 73.37%）。
- 真实 Electron E2E：25 passed / 14 skipped。

## v4.23.4（2026-11-02）

v4.23.3 的补强：把规则版本解析的边界补全，并修掉设置页/工作台两处版本显示问题。

### 🔧 修复

- **内容身份与元数据分离**：同一份规则有两种形态——内置常量（纯正文，注入 prompt）与 vault 文件（带 tags/version/updated）。此前直接对整文件算哈希，正文相同也会判成「同版本不同内容」。新增 `canonicalContent()`：去 BOM、统一换行、剥离 frontmatter 后再算哈希；元数据不再参与内容身份。
- **模板资产与内置版对齐**：`assets/template-scaffold/00-系统模板/写作规则.md` 的 `version` 从 `3.6.0-引导代禁止` 改回 `3.6.0`，并从 `tags` 移除 `v3.6.0`（正文与内置常量逐字相同，此前只有元数据不一致）。
- **版本解析边界**：`extractVersion` 现在跳过 BOM、支持空 frontmatter，并且只认**顶层** `version:`（嵌套的 `meta.version` 不再被误当文件版本）；`compareVersionBase` 兼容前导 `v`。
- **设置页版本下拉**：选项标签补上 `v${version}`。此前只显示 `vault:路径`，多个规则文件并存时分不清哪个是哪个版本。
- **设置页漂移提示**：描述里承诺「版本号相同但内容不同会在这里提示漂移」，但代码从未渲染 `listing.drift`；现已显示。
- **工作台状态条**：不再硬编码「内置 3.6.0」；`auto` 时异步解析实际生效版本，项目/vault 规则生效时不再误报。

### 🧪 测试

- 新增 4 条：嵌套 version / BOM 与空 frontmatter / `canonicalContent` 规范化 / 正文相同但 frontmatter 不同不判漂移；并补前导 `v` 的主干比较。
- `preflight` 全绿：**524 文件 / 5866 用例**；真实 Electron E2E 复检 25 passed。

## v4.23.3（2026-11-02）

### 🔧 修复

- **写作规则版本误报**：`extractVersion` 改为优先读 frontmatter 的 `version:` 字段。此前它扫全文取第一个版本号，而文件顶部的 `tags: [写作规则, 文风, v3.6.0]` 排在 `version: "3.6.0-引导代禁止"` 之前，导致自定义变体被判成内置 `3.6.0`，再比内容哈希就触发「版本号相同但内容不同」的假漂移告警（期望 `f628cb8f`，实际 `08bde250`）。
- **启动版本提示收紧**：只有主干版本落后于内置版时才提示同步；`3.6.0-引导代禁止`、`3.7.0-anchor` 这类用户主动选择的变体不再每次启动弹窗。
- 删除 `RulesService` 里未使用且更宽松的 `extractVersion` 副本，避免两个解析器各说各话。

### 🧪 测试

- 新增 3 条：frontmatter 版本优先于 tags、无 frontmatter 时回退正文、`compareVersionBase` 忽略后缀。
- 全量 `preflight` 通过：**524 文件 / 5862 用例**。

## v4.23.2（2026-11-02）

dsh 后端的两项边界决策正式确认，并同步到设置页与设计文档（无行为变更）。

### ✅ 决策

- **整会话 `workspace-write` 作为唯一写入方式**：默认只读；打开「允许 dsh 写入 vault」后本次会话整段可写，启动前再确认一次。协议没有逐文件审批通道，拒绝时整会话保持只读。
- **接受 dsh 完整依赖树（含 bash/pwsh）**：由用户手动安装，插件不自动安装/升级；设置页明示「接受安装即接受这些工具随包存在」。

### 📝 文档

- `docs/research/deepseek-harness/integration-dsh.md`：待决策项改为已决策；架构图里的「逐次审批 Bridge」改为「启动前一次性确认」；安全条款同步。
- `docs/research/deepseek-harness/README.md`、`architecture-notes.md`：删除「写入逐次批准」的过时表述。
- 设置页 Agent 后端分区补充依赖树与写入语义说明。

### 🧪 测试

- 全量 `preflight` 通过：**524 文件 / 5859 用例**。

## v4.23.1（2026-11-02）

dsh 可选后端的首次真实环境验证（Windows 11 / Node 24 / `@deepseek-ai/dsh@0.2.1-rc.5`），并修掉三个启动层缺陷。

### 🔧 修复

- **Windows 上 dsh 完全无法启动**：`spawn('npx')` 直接 `ENOENT`；改 `npx.cmd` 又在 Node 18.20+/20.12+ 抛 `EINVAL`（`.cmd` 必须经 shell）。新增 `buildDshSpawnSpec`：Windows 上除 `.exe` 外统一交给 `ComSpec` 执行，含空格参数自动加引号；健康检查与正式启动共用。
- **子进程环境缺平台必需键**：此前只传 `PATH`/`HOME`，`cmd.exe` 找不到 `SystemRoot`、`npx` 找不到 `APPDATA`/`USERPROFILE` 缓存。新增 `buildDshChildEnv`，补 `SystemRoot/windir/ComSpec/PATHEXT/APPDATA/LOCALAPPDATA/USERPROFILE/TEMP/TMP` 等本机既有值（不含任何凭据），并保证空串不会覆盖已补齐的 `PATH`。
- **空闲等待只看 `session.status`**：rc.5 起服务端提供 `session/wait`，改为两者竞速，先到者唤醒；旧版本无该方法时静默回落。
- **健康检查超时 20s 太短**：首次 `npx` 下载常超过 20s，设置页检测按钮改为 120s。

### ✅ 已验证（真实模型调用）

- `initialize` 接受 `provider: deepseek-official` / `model: deepseek-flash`，返回 `deepseek-harness-sdk-runtime 0.0.1`。
- `DEEPSEEK_API_KEY` 经环境变量注入即被采纳（不写配置文件、不落 vault）。
- `--patch` sandbox 覆盖生效：只读会话写入被拒且文件未创建；`workspace-write` 会话文件创建成功。
- SDK 协议确无逐次审批通道（dsh 自述 `no approval channel is available`）；Windows 上暴露 `pwsh` 工具（完整依赖树）。

### 🧪 测试

- 新增 6 条单测（Windows shim、参数引号、`.exe` 直连、平台环境补齐、空串不覆盖、`session/wait` 唤醒）。
- 全量 `preflight` 通过：**524 文件 / 5859 用例**。

## v4.23.0（2026-11-02）

覆盖 v4.22.0 之后的 60 个提交，外加本轮 P1 收口。测试基线：**524 文件 / 5853 用例**（v4.22.0 为 481/5506）。

### 🧱 结构与热点收口

- **实体访问统一**（Entity-1..5b）：`entity-reader` / `entityDir` 成为实体目录的唯一入口，世界观缓存、落盘、上下文、结算引擎与三个 UI 扫描点全部改用它；实体目录前缀 0 残留。
- **Wave B/C**：结算表收敛为唯一生成器，表/快照/总览在结算后统一编排；跨卷面板与剩余 `getFiles` 热点改为目录遍历（200 章基准 + 门禁）。
- **删死代码**：`ui/full-writer/outline-tree-controller.ts`（1768 行）、`ui/knowledge-floating-panel.ts`（1250 行）两个幽灵模块，以及仅被测试引用的 harness 上下文层。
- **文本工具收口**：`splitParagraphs` / `splitSentences` / `isChineseChar` 的 10 份副本合并到 `shared/text-utils`，行为差异用测试锁定。

### 🐞 正确性修复

- **严重**：豆包向量 Key 被 OpenAI 配置覆盖；加密态保存会清空 API Key；自动重试被 `running` 守卫短路；文笔样本正则里的 `\s` 在模板字符串中退化为 `s`。
- **中**：改供应商端点不生效、参考书籍重启丢失、指纹跨项目写入、伏笔表格串列、大纲重复插入、知识库列表/详情状态错乱、章节重编号两阶段、15 处 IME 守卫。
- **数据链**：备份默认失效、版本索引并发、项目路径推导（最长前缀匹配）、统计陈旧值。
- **语义分叉（B2–B5）**：章节路径、表格空列、结算状态、字数口径四处统一；迷你设置的向量密钥不再直接回填/写回。
- **结算回滚**：`SettlementJournal` 三类条目（整文件 / 字段 / 追加）逆序回滚；结算成长/情绪/互信息失败升级为 `hasPartialFailure`；正文 `status` 进入回滚快照；时间线三处写入加锁、追加按章去重。
- **本轮 P1**：结算 `snapshotField` 与字段写入同进 `withWriteLock`（P1-3）；写作规则契约缓存改按 `mtime+size` 指纹自愈（P1-6）；`BodyWriter` 写后 `getFile` 重试并在失败时显式告警（P1-12）；项目改名的三处 frontmatter 改写改走 `writeVaultText`，不再绕过 vault 事件（P1-5 部分）。

### ✨ 功能

- **内置主题画廊**：7 套 × 浅/深三层配色，共用 `derivePalette` 链路。
- **写作统计与桌面宠物**：日/周/月字数产出、状态栏今日字数、浮窗动效。
- **版本历史 UI + 首启引导 + 设置分区补全**；启动性能优化、状态面板、`versions.json` 生成与校验。
- **RAG 来源可见化**：`rag_sources` 落盘书/维度/分数/片段，步骤面板来源条与统计页知识命中。
- **三模式**：短篇/剧本放开通用工具、补模式提示、项目迁移一键撤销。
- **静默失败清零**：关键入口补提示，并新增 `check:silent-failures` 门禁。
- **外观与响应式**：三栏工作台窄面板折单列；步骤完成只重绘本步区域。

### 🚀 Harness 与 dsh

- **Harness C1–C4**：事件日志纪律、工具管线加固、回合内上下文预算、窗口化压缩阈值与遥测。
- **dsh 可选后端**：stdio JSON-RPC 内核、`agentBackend(native|dsh)` 切换、健康检查、启动前一次性写入确认、kill；`check:dsh-isolation` 隔离门禁 + 9 条单测。

### 🚦 门禁与测试

- `preflight` 补齐 `lint` 与 `build`（`check:release` 仍留在发布步骤）。
- 新增结算引擎真实行为测试、知识库标签/详情状态机回归、Agent 工具权限边界、embedding provider 请求契约、知识库链联动用例；覆盖率口径纳入 `shared/`。
- 发布资产一致性校验（`check:release --tag`）与 `versions.json` 三方一致校验。

## v4.22.0（2026-10-31）

### 🔧 并发整合：Trae 结构重构 × 本地 Batch 2（P1 十二条）

与 Trae 侧的结构重构（模块下沉 engine/shared、设置页拆 `ui/settings/`、样式源 `styles-src/`、门面根级 `plugin-api.ts`）合并后的整合修复，保证两套改动不互相踩。

- **写锁收口**：伏笔库揭示/新增（`engine/foreshadow-manager.ts`）与章节版本回滚（`services/chapter-version-service.ts`）统一走 `withWriteLock`，锁内重读再做读-改-写；删除「单线程无竞态」的错误注释。
- **缓存失效键修正**：新增 `shared/paths.matchProjectFromPath`（已知项目最长前缀），`ContextManager.invalidateCacheByPath` 不再把 `长篇小说/书名` 解析成 `长篇小说`（此前失效永不命中，只能等 TTL）。
- **跨模式一致性**：`getToolGroupsForMode` 按 `command-mode-rules` 过滤（短篇/剧本不再显示 8 个长篇专属按钮）；`BATCH_CREATE` 放开短/剧本（`BatchCreateModal` 已实现建节/建集）；`TARGETED_REVISION` 登记长篇；新增「工具目录 × 模式规则」双向一致性测试。
- **静默失败**：写作配置解析失败与文件缺失分离，失败后首次保存先留档 `.bak`（不再用默认值覆盖用户配置）。
- **UI 正确性**：`file-open` 只处理章节正文路径并在切章前取消在跑任务；创建项目复用 `validateProjectName`（长度/保留名/重名）+ 防重复提交；协同编辑器 IME 组合期不拦截按键；正文实体重检按「路径+内容哈希」去重（自动保存不再反复烧 AI）且支持重命名章节；监控面板 B 改用 `getRightLeaf(true)` 不再与 A 争同一 leaf；一键规划失败写 `run-error` + Notice 并恢复按钮。
- **文档与门禁**：`docs/PLAN.md` 按新结构更新（服务层职责、`plugin-api.ts` 门面、`styles-src` 构建链、`entity-reader`/`yield` 单一入口）；修正 `docs/OPTIMIZATION-AUDIT-2026-10.md` 指向已删除 `entity-stats` 的链接、`harness-audit.md` 迁移服务路径、`ai-builder-modal` 过期注释；E2E 设置页选择器适配「每页签一个 `.nw-settings-panel`」。
- **验证**：`vitest` 481 文件 / 5505 用例；`tsc` / `lint` / `check:styles` / `check:css` / `check:inline-styles` / `check:deps` / `check-engines` / `check:templates` / `build` / `check:release` / 真实 Electron E2E 23 passed。

### ⏱️ 优化审计批次 14：D3 等待原语收口 + F3 catch 分级试点（2026-10-31）
审计称「`setTimeout` 255 处、无统一等待原语」「`catch` 2,202 次无分级」。**先问是不是**：两条口径都不成立——排除 `node_modules` 后实测 `setTimeout` **96 处**、`catch` **1,504 次**；`shared/yield.ts#yieldToUI` 早已存在，缺的是原语复用。

- **新增** `shared/yield.ts#nextFrame()`：双重 `requestAnimationFrame` 等一帧绘制完成，与 50ms 超时竞速兜底「后台窗口不触发 rAF」的历史 P0-2 事故，无 rAF 环境（jsdom 单测）退化为 `setTimeout(16)`。
- **替换 5 处「等一帧」**：4 个 `ui/generate-*-modal.ts`（先让进度条渲染再请求模型）、`ui/full-writer/wizard-step-executors.ts`（步骤「执行中」状态先可见）。这 5 处此前各带一行完全相同的「P0-2 修复: …改用 setTimeout」注释，事故知识现固化在原语内部。
- **`ui/views/knowledge-base-view.ts`** 批量归类循环的 `setTimeout(0)` 改 `yieldToUI()`。
- **有意不改**（按形态判定，非遗漏）：`token-bucket-rate-limiter`（同步队列调度）、`manage-providers-modal` / `api-section`（`window.setTimeout(autosize, 0)` 同步回调）、`rename-project-modal` / `project-selector-controller`（`window.setTimeout(focus, 0)`）、`knowledge-base-view#completeRefreshTimer`（debounce 合并刷新）——改成 await 会改变调用时序语义。
- **F3 约定落地**：`docs/DEVELOPMENT.md` 新增「异步等待原语」「catch 日志分级」两节（三要素：失败对象 / 场景 / 可重试性；三级：业务失败 `error`、可重试失败 `warn` + 重试计数、可降级失败 `warn` + 降级去向）。试点 `engine/deconstructors/foreshadow-deconstructor.ts` 两处可选增强降级点。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest **480 文件 / 5497 用例**通过（新增 `tests/unit/shared/yield.test.ts` 4 用例：`yieldToUI` 让步、无 rAF 退化、双帧等待、后台窗口 50ms 兜底回归守卫）；`npm run build` / `check:release` / `preflight` 通过。

### 🗂️ 优化审计批次 13：C2 `vault.adapter` 写入收口（2026-10-31）
审计条目称 189 处 `vault.adapter` 直读绕过索引。实测为 **141 调用点 / 136 行**，且危害只落在「用 `adapter.write` 写 vault 索引内的 `.md`」这一子集：不触发 `metadataCache` 重解析、绕过 `vault.process` 写锁，移动端（无外部文件监听）新建文件可长时间不出现在文件浏览器 / 双链。

- **新增单一出口** `shared/file-system-port.ts#writeVaultText(app, path, content)`：复用既有 `ObsidianFileSystem` 的四路分流——索引内已有 `TFile` → `vault.modify`；路径是文件夹 → 抛错；配置目录 / 索引外已存在 → `adapter.write`；其余 → 补父目录后 `vault.create`。
- **替换 9 个模块的 13 处用户可感知写入**：`full-writer-view`（2 处指南）、`story-settings-modal`（2 处指南）、`project-create-service`（2 处建项目指南）、`mode-document-modal`、`chapter-outline-tree-modal`（2 处大纲回写）、`plot-canvas-modal`、`batch-create-modal`、`batch-pipeline-runner`（叙事总览）、`template-scaffold`（模板自举 56 文件）。其中模板自举修复最直观：全新安装时模板此前走 adapter，移动端文件浏览器看不到。
- **按证据保留 adapter 的写入点**（非遗漏）：`engine` 层 11 处拆解器知识库写入（批量后台写、读取同走 adapter 闭环，改走索引会在拆解期间引发大量 `metadataCache` 重解析与 `vault.on` 抖动）；`chapter-version-service#writeFile`（已自带 `TFile → vault.modify` 分流）；`.project` 隐藏文件、`plugin-cache` JSON、agent 会话 / 溢出数据、`vault.adapter.basePath`（这些路径 `getAbstractFileByPath` 恒为 null，`vault.create` 建不出来）。
- **测试同步**：`template-scaffold.test.ts` 的 `makeApp` 补齐 `getAbstractFileByPath` / `createFolder` / `create` / `modify` 最小替身（原 mock 只有 `vault.adapter`，写入改走索引后 4 个用例全失败），断言零改动。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过；`check:deps --baseline` 五层 0 违规 / 0 循环（678 文件 / 3,205 import）；`npm run build`、`check:release` 通过。

### 📦 优化审计批次 12：C5 构建体积压缩（2026-10-31）
审计称「模板资源内联进 bundle 导致产物 9.34 MB」。**先问是不是**：模板 56 文件仅 79,863 字节，生成物 86,221 字节（占产物约 1.6%），`data/knowledge-vectors` 6.26 MB 是本机运行时目录（批次 9 已核实不入仓不入包）。真因是构建从未开启压缩。

- **`scripts/build.js` 增 `minify: true` + `charset: 'utf8'`**：esbuild 默认 `charset: 'ascii'` 会把本项目大量中文提示词 / 模板转成 `\uXXXX`，实测 minify+ascii 5.52 MB vs minify+utf8 3.92 MB（字符数口径）。Obsidian 运行于 Electron、产物按 UTF-8 读取，保留原字符安全且更小。
- **`main.js` 9,089,917 → 4,798,890 字节（-47.2%）**；`deconstruction-worker.js` 1,330,977 → 680,977（-48.8%）；`quality-worker.js` 227,172 → 107,635（-52.6%）。
- **`check-release.mjs` 产物内省口径修正**：原 marker 依赖「模块路径注释」与「顶层变量名」，压缩后必然消失。改为断言排序后前 2 个模板 key 的 **JSON 字符串字面量**（压缩只改标识符，不改字符串内容）。
- **压缩安全已核**：`createWorkerFromHandlers`（`handler.toString()` 依赖函数名）无调用点；源码无 `constructor.name` / `Function.name` 依赖；`scripts/`、`tests/` 均不读 `main.js`。`node --check main.js` 通过，产物含 `module.exports` 与版本字面量。

### 🧱 优化审计批次 11：C3 样式单体拆分 + 设置页分区（2026-10-31）
`styles.css` 单文件 16,027 行、`ui/settings-tab.ts` 5,112 行 57 个方法，任何一个样式改动都要在 45 万字节里翻找，设置页每切一个 tab 都重建整块 DOM。

- **样式拆为 `styles-src/` 16 个源文件**（`00-header.css` … `15-late-fixes.css`）：按**原顺序**切片而非按功能域重组——后置文件本就是覆盖层，重排会改变层叠结果且无测试能捕获。新增 `scripts/build-styles.mjs` 按文件名顺序**纯文本拼接**（不压缩、不合并选择器），头部注明「自动生成，请勿直接编辑」；`--check` 接入 `preflight`（`check:styles`），直接改根目录 `styles.css` 会失败；`npm run build` / `dev` 前置生成，新增 `build:styles` 脚本。
- **零视觉风险有实测证据**：16 个切片 `join('')` 与拆分前原文逐字符相等（450,911 = 450,911）；产物 452,262 字节的 +1,351 全部为自动生成头注释，`.css-baseline.json` 仅上调 `bytes`，`!important 164` / 硬编码 hex 154 / rgb-hsl 181 / 唯一类 2346 / 非前缀类 87 / 最大选择器深度 4 全部持平。
- **设置页拆为 227 行宿主 + 8 个分区模块（共 5,125 行）**：`ui/settings/` 下 `api-section`（1,215）/ `knowledge-section`（765）/ `fingerprint-section`（373）/ `deconstruction-section`（325）/ `foreshadow-section`（280）/ `writing-sections`（737，6 个分区）/ `general-sections`（1,095，6 个分区）/ `provider-modals`（335）。`section-base.ts` 提供 `SettingsSectionHost`（app / plugin / refresh / reopen）与 `SettingsSection` 基类，分区方法体保留 `this.plugin` / `this.app` / `this.refresh()` 原写法，搬移零逻辑改写。
- **tab DOM 缓存**：纯切换复用 `panelCache` 中的 DOM，不重建；任何设置变更走 `refresh()` 时清空**全部**缓存并重绘当前 tab（防「A 分区改设置、B 分区显示旧值」）；异步分区（知识库 / 指纹库 / 模板 / 规则版本）命中缓存不重拉数据，需点分区内刷新按钮或重开设置页（文件头已注明）。`.nw-settings-panel` 是普通 block div，`nw-settings-tab-content` 规则全为后代选择器，布局不变。
- **测试同步**：`api-format-wiring` / `settings-no-duplicate-render` / `panel-resizer-and-motion` 3 个源码结构断言改读新文件路径（`settings-no-duplicate-render` 的两个全页扫描用例对宿主已恒真，守卫强度弱化已记入审计文档待重写）。
- **未接线项如实保留**：`provider-modals.ts` 的 `showEditCustomProviderForm` / `showManageProvidersModal` / `showAddCustomProviderForm` 在原文件即无调用点，原样搬运未删除。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过；`check:deps --baseline` 五层 0 违规 / 0 循环（678 文件 / 3,196 import）；`npm run build` 成功（v4.22.0，模板 56，styles 16 源文件 → 16,052 行）；`check:styles` / `check:css` / `check:release` 全通过。

### 🧭 优化审计批次 10：B2 实体管理弹窗嵌套复核（2026-10-31，仅注释）
审计条目把 `unified-entity-manager-modal` 内嵌 `existing-entity-manager` 记为「职责边界靠调用方约定」。复核后确认这是正常复用：后者构造签名为 `(app, plugin, project, folderName, displayLabel)`，只操作单类别目录（改名 / 编辑全文 / 删除 / 智能猜名），被 4 个单类别生成弹窗 + unified 总览（2 处）+ unified 生成（1 处）+ `full-writer-view` 共 7 个入口复用；前者做跨类别聚合、筛选、完整性审计与原地补全。两者是「总览页 → 详情页」，合并会破坏全部调用方并使总览弹窗更臃肿。处置：只在两处文件头补职责边界注释，不改任何逻辑。验证：仅注释改动，`tsc --noEmit` 0 错误、全量 vitest **479 文件 / 5493 用例**通过、`check:deps` 五层 0 违规 / 0 循环、`npm run build` 成功。

### 🔍 优化审计批次 9：G2 分发目录混放复核（2026-10-31，无代码改动）
审计条目称 `data/knowledge-vectors` 与 `*-preferences.json` 混在「分发目录」。复核后确认前提不成立：仓库根即插件目录，`.gitignore:30` 忽略整个 `data/`（`git ls-files data` 返回空）；`.github/workflows/release.yml` 的发布 zip 仅打 `main.js manifest.json styles.css workers`，Release 资产同理。`data/` 是本机运行时数据目录（向量 / 人味样本 / 实验产物 / 偏好 / 缓存），与偏好文件混放不构成分发污染；拆分子目录会破坏既有偏好读取且无收益，故不做改动。

### 💾 优化审计批次 8：E2 localStorage 键名集中化（2026-10-31）
7 类 localStorage 键名散落在 6 个文件，`main.ts` 还硬编码两处遗留键清理，新增键容易另起前缀。

- **新增 `shared/storage-keys.ts`（零依赖，任何层可引用）**：`STORAGE_KEYS`（收藏 / 侧栏折叠 / 耗时历史）、`STORAGE_KEY_PREFIXES`（确认弹窗「不再提示」/ 流程导出标记 / 向导分桶）、`LEGACY_STORAGE_KEYS`（热重载遗留键，仅清理不写入）、`projectScopedKey(prefix, project)`（空项目落 `global`）。
- **7 处使用方改引用**：`ui/ideation-modal`、`ui/components/progress/operation-confirm-modal`、`ui/full-writer/creation-flow-state`、`ui/full-writer/wizard-results-store`、`ui/project-side-panel-view`、`shared/time-estimator`，以及 `main.ts` 两处清理改 `for (const key of LEGACY_STORAGE_KEYS)`；向导 key 的两处重复拼接收为 `projectScopedKey`。
- **键值保持不变＝零迁移**：不改前缀，用户既有的收藏、折叠状态、向导结果、耗时历史、「不再提示」记忆继续命中。两套历史前缀（`novel-writer-*` / `nw-op-confirm:`）保留；统一到 `nw:` 需配套「读新键失败 → 读旧键 → 回填」，不在本批次。
- **验证**：新增 `tests/unit/shared/storage-keys.test.ts` 5 用例（键值不变 / 前缀不变 / 遗留键不变 / global 兜底 / 命名空间校验）；`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（五层运行时 0 / 循环 0 / 无类型耦合提示）；`npm run build` 成功。

### 🌐 优化审计批次 7：E3 网络出口统一 + A5 文档校准 + E1/F2 复核（2026-10-31）
canon 检索与趋势检索此前直连 `requestUrl`，既没有超时也没有重试：搜索服务端卡住时整个检索流程会无限等待。

- **新增 `shared/http-request.ts`**：`requestWithPolicy(execute, params, policy)` 提供单次尝试超时（默认 30s）、超时专用错误 `HttpRequestTimeoutError`（带 url 与超时预算）、可选 `retries` / `retryDelayMs` / `retryOn`；默认只对 5xx / 429 / 网络类错误重试。**边界**：Obsidian `requestUrl` 不支持 `AbortSignal`，超时语义是「拒绝等待并丢弃迟到结果」，无法中断请求本身。
- **两处搜索服务接入（9 个调用点）**：`services/canon-research-service.ts` 的 Bing / Brave / Serper / Tavily 与网页抓取、`engine/harness/trend-research-service.ts` 的四个搜索后端统一走 `requestWithPolicy`；搜索用 `SEARCH_REQUEST_POLICY`（15s + 重试 1 次，超时不重试），网页抓取 15s 不重试（避免对目标站点加压）。`api-connectivity-service` / `model-discovery` 已有自建 `Promise.race` 超时与 timeout 状态分类，本轮不动。
- **A5 文档校准**：`ARCHITECTURE.md` 的 UI 层职责、访问边界表、「违反规则的标志」改为「目标边界 + 现状偏差」双口径，写明 UI 层 `app.vault` 直连约 683 处属未收口技术债、Engine 层仍直接 import `obsidian`，且门禁只约束层间内部 import，避免按文档误判架构现状。
- **E1 / F2 复核为「原结论不成立」**：E1 的 Worker 能力探测早已在 `WorkerManager#detectWorkerSupport` 落地（`typeof Worker` + 内联实建探活 + 主线程 `fallbackToMain` + 会话内一次提示）；F2 的批量分支在 `ai-batch-entity-generator` 内已做「逐条校验 → 批量/逐条补全 → 复检 → 出口过滤」，不完整实体不落盘。两条审计结论基于旧版本，已在审计文档更正并附证据。
- **验证**：新增 `tests/unit/shared/http-request.test.ts` 4 用例（正常透传 / 超时不重试 / 5xx 重试一次成功 / 401 不重试）；`tsc --noEmit` 0 错误；全量 vitest **478 文件 / 5488 用例**通过；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（五层运行时 0 / 循环 0 / 无类型耦合提示）；`npm run build` 成功。

### 🧩 优化审计批次 6：A1 注册表类型化取用（EngineServiceMap）（2026-10-31）
`EngineRegistry` 此前只有 `get<T>(name: string)`：字符串键 + 手写泛型，任一服务的类型变化都不会在编译期报错。本批次补上编译期映射，旧调用零改动。

- **`EngineServiceMap` / `EngineToken`**：在 `engine/engine-registry.ts` 内建 35 个 token 的实例类型映射（复用文件已有的运行时 import，零新增耦合）；`TEMPLATE_MANAGER`（组合根注入、注册值为 `unknown`）与 `CO_WRITING_SESSION_STORE`（UI 层注入）不收录，继续走宽泛重载。
- **重载而非替换**：`get` / `getOrNull` / `register` / `registerLazy` 增加 typed-token 重载在前、`<T>(string)` 兼容重载在后；84 处既有显式泛型调用一行不改即编译通过，`get<ChapterVersionPort>` 这类跨层端口仍走兼容重载。
- **取用点迁移**：`main.ts`（17 处）、`settings-tab.ts`、`mini-settings-modal.ts`、`step-runner.ts`、`ai-engine.ts`、`co-writer-engine.ts` 等文件的冗余泛型改为推导；`getOrNull<any>(UPDATE_CHECKER)` 10 处恢复为 `UpdateChecker | null`。保留 7 处显式泛型：`TemplateManager` ×2（不在映射内）、`ChapterVersionPort` ×1（端口）、`getOrNull<any>(CACHE_MANAGER)` ×4（`PluginCacheManager.getUpdateLastResult()` 仍返回 `unknown`，属缓存模块既有类型精度问题，不在本批次范围）。
- **收益**：服务名与实例类型绑定，`get` 取错类型、注册错实例在编译期报错；调用点不再需要手写泛型。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest **477 文件 / 5484 用例**通过；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（五层运行时 0 / 循环 0 / 无类型耦合提示）；`npm run build` 成功。

### 🧩 优化审计批次 5：类型耦合提示项 10 → 0（2026-10-31）
批次 3 遗留的 10 条 `import type` 跨层类型耦合（`check-dependencies.mjs` 的 `ℹ️` 提示项，不计入门禁）全部消除，守卫输出不再有该行。

- **纯类型下沉 `shared/`**：`APIResponse` → 新增 `shared/api-types.ts`（原先定义在 `engine/ai-engine.ts`，`shared/api-response-utils.ts` 只能反向 `import type`）；`EmbeddingAvailability` / `ProviderInfo` / `EmbeddingOptions` / `EmbeddingProvider` → 新增 `shared/embedding-provider.ts`（原 `engine/embedding/embedding-provider.ts`）。两处 engine 侧均保留再导出（`export type { APIResponse } from '../shared/api-types'` / 纯 re-export 文件），engine 内部 12 + 37 处引用零改动。
- **改导入源（零新增文件）**：`services/knowledge-base-manager.ts` 的 `BreakdownDimension` 本就定义在 `shared/deconstruction-settings.ts`（`engine/deconstruction-scheduler.ts` 只是再导出），直接从 shared 取；`services/genre-classifier.ts` 同理改取 `shared/embedding-provider`。
- **缓存实现真正下沉**：`engine/cache/file-cache.ts`、`engine/cache/multi-layer-cache.ts` → `shared/file-cache.ts`、`shared/multi-layer-cache.ts`（两者只依赖 `lru-cache` / `logger` / `file-system-port`，零 engine 依赖）；`engine/cache/index.ts` 改为再导出，`engine/cache/` 现只剩 `preload-manager.ts`；3 个单测（`multi-layer-cache` / `file-cache` / `context/incremental-updater`）路径同步。
- **门面外移根级**：`shared/plugin-api.ts` → 根级 `plugin-api.ts`（与 `main.ts` 同性质的外部 API 门面，不属于任何分层），一次性消除对 `engine/ai-engine` / `engine/context-manager` / `engine/engine-registry` / `ui/workspace-manager` 的 4 条提示；6 处引用改 `../plugin-api` / `../../plugin-api`。
- **端口接口**：新增 `shared/chapter-version-port.ts`（`ChapterVersionPort#saveVersion` 签名），`core/command-registry.ts` 的 `get<ChapterVersionService>` 改为 `get<ChapterVersionPort>`（沿用 `commandUiPort` 先例，core 不再持有 services 具体类）。
- **结果**：类型耦合提示 **10 → 0**；运行时分层违规 0 / 运行时循环 0 保持。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest **477 文件 / 5484 用例**通过；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（五层运行时 0 / 循环 0 / **类型耦合 0 条**）；`npm run build` 成功。

### 🔧 优化审计 P0 落地（批次 1 首批三项）：章节排序 / 丢弃提示 / 实体读取归一（2026-10-31）
依据 `docs/OPTIMIZATION-AUDIT-2026-10.md` 批次 1 首批清单，三项全部落地。

- **章节排序下沉到唯一出口**：`ui/project-utils.ts#getChaptersForProject` 原先按「正文扫描序 + 骨架目录遍历序」拼接返回，各 UI 各自 `sortChaptersByNumber`；现出口统一升序，调用方重复排序变为 no-op。新增回归用例「乱序种子 → 出口即升序」。
- **知识注入整段丢弃不再静默**：`engine/step-runner.ts` 原先只处理 `droppedSections/trimmedSections/truncated`，仅丢增强尾部（`droppedExtra=true` 且主体未截断）时用户无任何提示；现补 `step-warning` 事件 + `NOTICE_WARNING` 提示，说明可在设置调高「单步输入 token 上限」。
- **实体读取唯一入口**：新增 `shared/entity-reader.ts`（`listEntityFiles` / `countProjectEntities` / `entityDir`），统一「目录前缀 + 仅 `.md` + 排除「模板」+ 路径升序」；`unified-entity-manager-modal`、`context-manager.gatherEntityRecords`、`entity-audit`、`ai-builder-modal` 全部改调。旧 `shared/entity-stats.ts` 删除。顺带修掉**统计把 `*模板.md` 算作实体**导致「生成器显示 5 人、管理器显示 4 人」的口径分歧。
- **验证**：`tsc --noEmit` 0 错误；全量 vitest 475 文件 / 5471 用例通过（+9：章节排序 1、实体读取 8）；`npm run build` 成功。

### ⚡ 优化审计批次 2：项目选择页多项目章节一次扫描（2026-10-31）
- **新增 `ui/project-utils.ts#scanProjectChapters`**：项目选择页一次渲染要对 N 个项目取章节，旧实现每项目各调一次 `getChaptersForProject`（各自遍历全库文件 + 全库目录 = 2N 轮）；现改为**一次遍历 + 按 `项目/03-大纲与章节/` 前缀分桶**，轮次与项目数无关。
- **章节口径不分叉**：抽出 `buildChapterEntries` 作为唯一构建实现，`getChaptersForProject` 与批量扫描都调它，正文 ∪ 骨架、去重、排序语义完全一致。
- **渲染作用域复用**：`project-selector-controller` 在单次 `render()` 内复用 meta 与单元列表（原先每项目 `getProjectMeta` 读 2 次、选中项目的章节被卡片/详情/快捷工具各算 1 次）。缓存随 render 丢弃，不引入长驻 vault 事件索引，避免外部改动导致的陈旧数据。
- **验证**：新增 `tests/unit/ui/project-scan.test.ts`（8 项目 / 400 章：批量与逐项目逐项一致；`getFiles` 调用 2 次 vs 旧路径 16 次；前缀相近项目隔离）；`tsc --noEmit` 0 错误；全量 vitest 476 文件 / 5477 用例通过；`npm run build` 成功。

### 🧭 优化审计批次 3（第一步）：架构守卫口径修正 + `ENGINE_NAMES` 下沉（2026-10-31）
- **守卫只统计运行时依赖**：`scripts/check-dependencies.mjs` 现在把 `import type X` / `import { type A }` 视为类型依赖（不计入分层违规、不参与成环），解析前先剥离注释（文档示例里的 import 会被误判成真实依赖，曾产生 `write-lock.ts` / `entity-models.ts` 两个假自环）。类型耦合以 `ℹ️` 提示单独列出，不参与棘轮。
  - 口径结论：审计阶段的「53 个循环」实为 **9 个运行时循环**；「64 条分层违规」实为 **55 条运行时 + 9 条类型**。`shared/plugin-api.ts` 因此被证伪为「最大循环中心」——它的 import 全是 `import type`，运行时没有环。
- **`ENGINE_NAMES` 下沉到 `shared/engine-names.ts`**（常量零 import），`engine/engine-registry.ts` 改为引入并再导出。`core/command-registry`、`engine/ai-engine`、`engine/ai-character-generator`、`engine/ai-entity-generator`、`engine/ai-worldview-generator`、`engine/co-writer-engine`、`engine/step-runner`、`engine/step-modal-controller` 与 15 个 ui 视图/弹窗改从 `shared/engine-names` 取常量，切断对 engine-registry 的运行时依赖 23 处。
- **仅作类型使用的 import 改为 `import type`**：`engine/review-agent.ts`、`engine/emotion-planner.ts`（`AIEngine`）、`shared/api-response-utils.ts`（`APIResponse`）。
- **零依赖模块下沉 `shared/`**（三处全部 grep 确认无 import，纯移动 + 改路径）：`engine/webnovel-knowledge-base.ts`（2696 行）→ `shared/webnovel-knowledge-base.ts`（12 处引用）、`engine/repository/lru-cache.ts` → `shared/lru-cache.ts`（8 处引用，含 `engine/repository/index.ts` 的再导出；单测同步移到 `tests/unit/shared/`）、`ui/full-writer/step-modal-styles.ts` → `shared/step-modal-styles.ts`（消除 `engine/step-modal-controller → ui/` 反向依赖 1 条）。
- **Engine 层 UI 能力改组合根注入**：`engine/engine-registry.ts` 移除 `ui/password-modal`、`ui/template-manager` 两个 import；`InitializeOptions` 新增 `passwordPort`（`requestPassword` / `requestNewPassword`）与 `createTemplateManager` 工厂，由 `main.ts` 创建并注入。engine 层运行时分层违规归零（ui / engine / shared 三层均为 0）。
- **services 编排模块上移 `engine/`**（第二步，消除分层倒置）：9 个「编排 engine 原语」的模块从 services 迁到 engine —— `deconstruction-scheduler`、`deconstruction-worker-manager`、`heavy-task-worker-manager`、`scheduler-segment-integration`、`segment-aware-breakdown`、`foreshadow-manager`、`template-service`、`project-migration-service`、`batch-import-manager`（最后一个自身零 engine 引用，但运行时会 `import` scheduler，一并上移以免残留 services→engine 运行时边）。它们依赖的都是 engine 原语（拆解器 / `text-segmenter` / `quality-scorer` / `vector-enhancer` / `llm-enhancer` / `context-manager`），放在 services 属分层倒置。
- **零依赖配置下沉 `shared/`**（供 core 生成 `DEFAULT_SETTINGS`，切断 core→engine）：新增 `shared/deconstruction-settings.ts`（维度类型 + 引擎默认值）、`shared/foreshadow-config.ts`（伏笔类型 + 默认配置）；`services/prompt-manager-types.ts` → `shared/prompt-manager-types.ts`（纯类型 + 默认配置）、`engine/internal-registry.ts` → `shared/internal-registry.ts`（仅依赖 logger）。原模块保留再导出以兼容既有 ui / main 引用。`services/example-project-service.ts` → `core/example-project-service.ts`（只依赖 Obsidian `App` + 模板脚手架，命令注册表同层调用）。
- **仅作类型使用改 `import type`**：`core/command-registry.ts` 的 `ChapterVersionService` 只在泛型参数位置出现，改为 `import type` 后不再计入运行时分层。
- **结果**：运行时循环 **9 → 1**（仅剩 `unified-entity-manager-modal ↔ unified-entity-generate-modal` 两个兄弟模态互开，无模块级副作用，作为已知债务留在基线）；运行时分层违规 **55 → 0**（services 41 + core 6 全部消除，UI / Engine / Services / Shared / Core 五层归零，仅余 10 条 `import type` 类型耦合作为提示项）；`.arch-baseline.json` 已收紧（循环移除 52 条、分层 47 条全部移除）。
- **验证**：`tsc --noEmit` 0 错误；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（**分层 0 / 循环 1**）；全量 vitest 476 文件 / 5477 用例通过；`npm run build` 成功。

### 🧱 优化审计批次 4：实体生成器配置驱动 + 模板单一来源 + 入口收敛 + 断环（2026-10-31）
- **`engine/ai-entity-generator.ts` 收敛为配置驱动**：势力 / 地点 / 物品功法三个近 90 行的重复方法收为「`EntityKindSpec` 配置表 + 一个 `generateByKind` 实现」，三个 public 方法签名不变；prompt 文本按字符级保持原样，由新增 `tests/unit/engine/entity-generator-prompt-parity.test.ts`（7 用例）钉住必填项 / 示例标题 / 角色称谓 / user prompt 文本 / `callAI` 参数透传。
- **新增 `shared/entity-templates.ts`（模板唯一来源，纯字符串零 import）**：`buildEntityTemplateBlock('faction' | 'location' | 'item')` 返回 `{ frontmatter, body }`；单条生成与批量生成共用，消除此前两份模板分叉（Batch 的势力 / 地点缺 `entity_status` / `entity_created_at` 等元字段、地点 frontmatter 字段顺序不同）。物品功法保留 `itemTag` 参数（批量可切「功法」扁平标签）与 `nw/实体/物品` 层级标签双写。
- **可见变化**：批量入口生成的势力 / 地点 frontmatter 与单条入口一致，补上 `entity_status` / `entity_created_at` / `entity_last_changed_at` / `entity_last_changed_reason` 四个元字段（既有数据不受影响，新生成实体更完整）。
- **最后 1 条运行时循环消除**：`ui/unified-entity-generate-modal` 的「📚 打开实体管理」改走组合根 `plugin.openEntityManagerModal(project)`（`main.ts` 新增该方法），不再 import `unified-entity-manager-modal`；兄弟模态变为单向依赖（manager → generate）。运行时循环 **1 → 0**，`.arch-baseline.json` 的循环项已清空。
- **产品侧双入口收敛（按「保留统一实体生成」决策）**：`ui/ai-builder-modal.ts` 移除势力 / 地点 / 物品功法三类 Tab，只保留世界观与人物创作入口；仪表盘底部新增「🏰 打开统一实体生成器」跳转，实体生成统一由 `ui/unified-entity-generate-modal.ts` 承接（四类实体、名称输入、批量数量、设定库、`ensureEntityIntegrity` 复检均在其内）。入口不再分叉，同一实体不会再从两条路径生成出不同结构。
- **验证**：`tsc --noEmit` 0 错误；定向 8 用例通过；全量 vitest **477 文件 / 5484 用例**通过（+7）；`npm run check:deps -- --baseline .arch-baseline.json` 退出 0（**分层 0 / 循环 0**，循环基线已清空）；`npm run build` 成功。


### 🛡️ 全插件排查 Batch 1：六条 P0 数据安全修复（2026-10-31）
首次全插件系统排查（三路只读审计：数据持久化 / UI 事件 / 工程质量），报告见 `docs/audits/v4.27-full-plugin-audit.md`。Batch 1 修掉 6 条 P0。

- **迁移失败不再「盖章」**：新增 `migrateSettingsWithStatus`（completed/from/to/error）；未完成时不回写 `schemaVersion`，磁盘原文件保留、下次启动重试；`SettingsService.getMigrationIncomplete()` 供 UI 提示。旧实现失败后 `saveSettings()` 无条件写最新版本号 → 迁移永久标记完成。
- **分卷大纲清理只删自己的文件**：`ai-outline-generator` 原先把 `03-大纲与章节/分卷大纲/` 下**全部** children 递归删除（备份只含 `*_分卷大纲.md`），用户自建笔记会永久丢失；现在只删该后缀文件。
- **正文覆盖前自动备份**：`BodyWriter` 在覆盖已存在正文前调用 `ChapterVersionService.saveVersion`（5 分钟节流，`backupBeforeOverwrite` 可关）；此前只有定向修订会存版本，重新生成一章即永久丢原稿。
- **发布资产对齐**：`release.yml` 移除已删除的 `workers/style-worker.js`；`check-release.mjs` 新增「release.yml worker 资产 == 构建产物」交叉校验——此前本地 check 通过但打 tag 必然失败。
- **指纹库串项目**：`saveProject` 的 project 与数据快照改为**入队时**捕获；旧闭包在出队时读 `this.project/projectFingerprints`，切项目瞬间会把空表写到新项目文件。
- **协同保存防覆盖**：`BodySaveController` 记录本视图上次写入的正文；保存前比对磁盘，若磁盘既非上次写入也非本次内容 → 判定外部（一键成文/续写）改写，拒绝本次保存并提示，避免协同 2s 自动保存覆盖新稿。
- **验证**：474 文件 / 5462 用例（+11：迁移状态 3、正文备份 2、协同冲突 2，另含既有用例更新）；lint / deps / engines / templates / build / release / E2E 23 passed。


### 🔥 真实链路验收：E2E_REWRITE 实测暴露并修复 4 个流程缺陷（2026-10-31）
用真实管线重写第 1 章（生成→合并规划→正文→质控→修订→分析→结算）做四波改动的验收，暴露 4 个开发期未发现的缺陷，全部修复：

1. **一键成文静默失败**：E2E 用 Node `path.join` 传**反斜杠绝对路径**给 `openChapterByPath`，`getAbstractFileByPath` 找不到 → 只有 Notice、状态为空 → runChapterOneClick 报「请先打开一个章节」。插件侧修复：路径归一化 `\` → `/`（vault 路径约定）；spec 改传 vault 相对路径。
2. **正文写错文件**：`第1章_九脉逆行_正文.md` 被重置为骨架后，新稿写到了无章名的 `第1章_正文.md`——`saveStepResult` 固定用 `pjBodyFile` 的无章名路径。修复：正文目标优先用 `findBodyFileByChapterNum` 命中**已存在的章文件**，不存在才落默认路径。
3. **QC 输出一节缺装饰就整链中止**：模型输出 `## 【一、写作技法检查】`（全角括号+序号装饰），validator 判「缺写作技法检查」→ optional 步骤未完成 → 一键成文 run-error 且正文/结算全不落盘。修复：① QC 三节标题正则允许「【序号】/中文序号」装饰；② **可选步骤（QC/分析报告）partial 不再中止一键成文**，warn 后继续（正文 required 才中止）。
4. **情绪规划等级全被误判**：模型按全角括号 `（4/10）` 输出等级，校验器只认半角 `(4/10)` → 每个场景都报「缺少情绪等级」→ 规划完整性门中断。修复：括号两种全收；回归测试覆盖全角样本。

**验证链**（同轮完成）：合并规划→正文 4380 字（修订后 13839 字节落**正确章名文件**，status: written）→ 质控→分析报告→连续性账本真实回写（沈砚.md 的 已知信息/伤势/持有物品 带「（第1章）」来源标记）→ 信息规划新契约字段（开头承接/章末钩子/需回收的旧伏笔）真实产出。全门禁：473 文件 / 5449 用例（+1 情绪全角回归）、E2E 23 passed（EPUB 头字节一例偶发，复跑通过）。

### 🔍 真实链路排查第二轮：结算链三处断点修复（2026-10-31）
针对上轮遗留观察逐项排查，全部定位为**同一根因的连锁**——同章同时存在「带章名」与「历史无章名」两个正文文件时，各读写点各自选择目标，互不一致：

- **`findBodyFileByChapterNum` 语义修正**：`chapterName` 恰为「第N章」时，`${chapterName}_正文.md` 就是裸文件名，不能当精确匹配压过带章名文件——旧逻辑让幂等守卫读到遗留文件的 `settled`，**整章结算永远被跳过**（实测 ledger：「已是 settled，本次跳过」）。现在：带章名 > 裸文件，exact 只在真章名时启用。
- **统一三处读写点**：`isChapterSettledOnDisk`（幂等守卫）、`writeFixToBody`（修正稿回写）、`settleStep_updateBodyFrontmatter`（结算 settled/涉及人物写入）全部改走同一 finder——修复后实测 ledger「回写完成」（updated 18/created 0/behaviors 7），正文 status → **settled**，快照/出场记录 07:06 更新，已知信息追加带来源章。
- **持有物品链接化破损**：「获得锁脉环（扣于左腕）」被整体包进 `[[]]` → `parseLinkValue` 剥离尾部括号说明（回归测试 2 条）。
- **修订进度可见性**：定向修订期间向执行时间线输出「🎯 定向修订中：处理 N 条…」，不再 40-60 秒静默。
- **spec 加固**：重置时删除无章名遗留文件（内容已备份）；新增 SETTLE_ONLY 模式（只跑结算探针，不烧 AI）；SETTLE_ONLY 下全量重写 test 跳过。
- **验证**：473 文件 / 5451 用例（+2 链接回归）；全部门禁 + E2E 23 passed。

### 🧪 真实链路排查第三轮：归因字段静默丢失修复（2026-10-31）
抽读第 1 章正文 frontmatter 发现 `step_template_id/version`、`step_rules_version/hash`、`step_voice_mode`、`step_experiment_group` **全部缺失**——v4.23 的归因链在真实落盘上没生效。

- **根因**：BodyWriter 写正文后靠 `vault.getFile(path)` 再 `processFrontmatter` 应用 patch；刚写入的文件在 vault 索引里常拿不到 TFile → `if (file)` 静默跳过 → 归因字段与 invariants 整体丢失（且无任何日志）。
- **修复**：patch 改为**写前合成**——新增 `mergeFrontmatterRaw`（纯文本级合并：已有键覆盖、新键追加，值 JSON 序列化），写入时直接进 frontmatter；写后 processFrontmatter 保留作兜底。4 条单测。
- **验证**：474 文件 / 5455 用例（+4）；全门禁 + E2E 23 passed。下轮全链重跑后可直接 `grep step_template_id` 验证。

**遗留观察（下轮）**：① `word_count: 0` 停留在骨架重置值（SETTLE_ONLY 路径特有，全链由 BodyWriter 写入正常）；② 修订进度已进 showProgress 但时间线事件仍缺一条独立的 run-notice。

### 🧹 板块收尾 Wave 4：死代码/死设置清理，Agent 与导出接入修订闭环（2026-10-31）
全板块优化第四波。删除前逐一 `grep` 复核零引用；分层基线随之收紧（消除 2 条分层 + 1 条循环）。

- **删除死代码（13 文件）**：`services/settlement-service.ts` + `services/index.ts`（零实例化）、`engine/harness/{retrieval-plan,memory-store,builtin-tools}.ts`（被 agent/harness 取代；前两者的测试随删）、`engine/style/style-worker.ts` + `workers/style-worker.js`（无 loader；build/check-release/worker-url 测试同步清理）、`domains/kernel/domain-registry.ts`、`ui/full-writer/{full-writer-state,step-nav-presenter}.ts`、`ui/services/agent-nlu.ts`、`engine/streaming/index.ts`、`styles.css.bak`（182KB）。
- **死设置清理**：图表可视化设置区整区删除（含 `charts` 默认值与接口，零消费方）；角色识别设置区最小接线——`characterRecognitionLayers/vectorLayer/llmLayer` 首次被 `character-recognition-modal` 消费（层开关 + 阈值 + 批大小），不再是空转 UI。
- **修订闭环接入命令与 Agent**：新命令 `novel-writer-targeted-revision`（长篇模式守卫，命令面板可用），经工作台事件触发当前章「定向修订→闸门→备份→复检」；Agent 可用 `run_command` 触发并用 `get_execution_status` 读到修订与复检结果（执行登记表已记录）。
- **时间上下文进正文路径**：`buildTimeContextMessage` 此前只有 Agent harness 注入；现在 V1–V4 正文模板同样带【当前时间】，期限/季节推算不再与真实时间漂移。
- **导出前质量门槛**：导出弹窗对长篇逐章检查「未结算 / 未过质控」，Notice 列出清单（只告警不阻断）。
- **验证**：473 文件 / 5448 用例（删 2 个死测试文件）；tsc / lint / deps（基线收紧）/ engines / templates / build / release / E2E 23 passed。

### 🔄 反馈闭环 Wave 3：修订/复检默认自动，QualityGate 首次接线（2026-10-31）
用户决策「自动化默认全开（1 轮修订+复检）」落地；此前注册后零调用的三层质量验收（`engine/quality-gate.ts`）首次接入 11 步正文路径。

- **自动化默认开**：`autoRevisionAfterQC` 默认 true（质控完成 → 自动定向修订，闸门拒绝保留原稿）；新增 `autoRecheckAfterRevision`（默认 true）。
- **修订复检**（`engine/revision/revision-guard.ts::recheckRevision`）：采纳后零调用对照——AI 味分前后、对话占比、短叙述占比、「未消化问题线索」条数；AI 味上升 >10 或对话下滑 >5 个百分点时提示人工复核。结果随修订记录进执行登记表（`novel-writer-targeted-revision`），Agent 经 `get_execution_status` 可读。
- **QualityGate 接线**：bodyGeneration 保存后运行三层验收的第一/二层（BeatVerifier + ConflictDetector + AI 味，零 AI）；快照从模板变量装配（`engine/quality/gate-snapshot.ts`，纯函数）；结果进执行时间线与登记表（`novel-writer-quality-gate`），不阻断流程。
- **`infoDebtThreshold` 接上消费方**：`shared/thresholds.ts` 新增运行时覆盖 `setInfoDebtMax/getInfoDebtMax`（默认仍 15，非法值回落），三处消费方切换到 getter——设置项不再是空转 UI。
- **验证**：475 文件 / 5455 用例；lint / deps / engines / build / release / E2E 23 passed。

### 🧩 规划链数据契约 Wave 2：规划产物真正进正文（2026-10-31）
审计实锤「规划白跑」的三条断链全部接上——这一波之后，规划步骤的产出才第一次完整进入正文 prompt。

- **infoPlan 提示词对齐解析器**（v4.22 引入解析器时提示词没跟上）：输出格式补「## 开头承接 / ## 章末钩子」两节；伏笔操作从「埋入/揭示/升级」改为解析器认识的「需回收的旧伏笔 / 需埋下的新伏笔」；「节奏模式」统一为消费方读取的「节奏节拍」；合并规划版（planning-combined）同步。章纲硬要求块与 `${chapterHook}` 从恒为空变为有数据。
- **场景卡补感官三字段**：`formatSceneCardDigest` 增加 `感官/身体/情绪弧`——V3/V4 不注入整段场景展开，这三项是场景描写硬约束在那两条路径上的唯一来源。
- **对话骨架补断点**：V1 正文模板补 `${dialogueSkeleton}`（无灵魂层走 V1 时骨架不再白生成）；soul-driven 版 Scene 展开底稿补 `dialogue_beats` 节（自定义模板路径不再断供）；骨架为空时给兜底文案（不再留空标题）；`validateSceneExpansion` 新增骨架条数校验（0 条警告、<4 条建议补）。
- **配角灵魂 9 字段**：`buildCharacterSoulSummary` 补回 obsession/shame/soft_spot——情绪规划要求模型按 soft_spot 反应，但模型此前看不见这三个字段。
- **注入去重与死变量**：V2 system 的 `${emotionPlan}` 移除（user 保留，修双注入）；`${chapterHook}` 从裸字段升级为「章末钩子块」，V3/V4 最终指令前注入。
- **记忆写侧自动化**：新增 `engine/memory/memory-shard-writer.ts`——角色灵魂步骤完成后为主角自动生成 `_记忆碎片.md`（已存在则跳过，4 条单测；读侧/提示词早已存在但此前零调用）；分析报告完成后把实体事实程序性提取进事实索引待确认队列（确认仍人工，读侧只读 confirmed 不变）。
- **验证**：475 文件 / 5455 用例（+4）；lint / templates / deps / build / release / E2E 23 passed。

### 🩹 数据正确性 Wave 1：结算幂等、连续性账本进人物卡、状态快照过期检测（2026-10-31）
全板块优化第一波（方案见 docs/audits/v4.25/v4.26 与本条）。核心：让结算可重跑、状态可溯源、上一章衔接不再自相矛盾。

- **结算幂等**：关系值按「章名+原因」幂等——重跑同一章结算不再二次累加 delta/堆叠历史（`applyRelationshipChanges` 返回 applied/skipped）；时间线去重改「时间+章节+事件」三列结构化比对（旧子串匹配遇空格/格式变化就翻倍）；出场记录去重键改数字章号、新摘要直接覆盖（旧实现按章名字符串 + 保留更长摘要，矛盾长期存在）。
- **字段溯源**：任何实体字段结算写入都带 `entity_last_changed_at` + `entity_last_changed_chapter`；伏笔移表解析不再 `filter(Boolean)`——空单元格不再导致相关人物/关联主线错位。
- **连续性账本（人物卡承载）**：人物模板实时状态区新增 `已知信息 / 伤势 / 持有物品`；白名单放行；结算写入用「追加 +（第N章）」语义；分析报告提示词新增三条对应指令；章节状态快照的「已知信息/伤势/物品」三列从结构性为空变为有数据。
- **快照过期检测**：读上一章状态快照时比对正文 mtime，正文在结算后被改过 → 不注入旧快照，改为提示文案，只依据【上一章结尾】衔接。
- **分卷查找**：大纲/情绪/场景展开/上一章查找按「正文实际所在卷」优先排序，跨卷命中打警告；`chapPlan` 先切当前卷段落再按章号匹配（新增 `volumeSectionSlice`，注意 `\b` 对 CJK 无效用 `(?![0-9])`）；切章时清除 `crossVolumeSnapshot` 残留。
- **验证**：474 文件 / 5451 用例（+9：关系幂等 2、出场合并 3、卷切片 3、既有断言更新）；lint / tsc / deps（无新增）/ engines（ChapterVersionService 白名单放开为 -1：定向修订备份会短暂构造）/ templates / build / release / E2E 23 passed。

### 🔁 修订闭环：质控报告 → 定向修订 → 闸门 → 可回滚（2026-10-31）
流程 10 步里 7 步是前置规划，正文生成后只有质控报告、`fix/finalFix` 已废弃，改稿全交给人。本轮把「按报告定向修订」接回主流程。

- **闭环**：正文 → 质量控制（14 项）→ 解析高/中优先级问题（最多 8 条）→ 定向修订（单次调用，prompt 明确锁定人物与情节）→ **接受闸门** → 采纳前存章节版本并写回，拒绝则保留原稿。
- **闸门**（`engine/revision/revision-guard.ts`，8 条单测）：字数 ±10%、锁定人物（`allChars` 中且原稿出现过的名字）一个不丢、对话占比跌幅 ≤5 个百分点、非空/非原样/非 JSON。失败 Notice 列出具体原因。
- **入口**：写章面板「🎯 定向修订」走闸门；新增设置「质量控制后自动定向修订」（`autoRevisionAfterQC`，默认关，每次 1 次正文调用），仅在 QC 结构完整时触发。
- **可回滚**：采纳前 `ChapterVersionService.saveVersion` 备份原稿，失败只告警不阻塞。
- **顺带修提示词矛盾**：质量控制提示词原要求「每段仅 1 个句号 + 换行」，与写作规则「自然段 2–6 句」对冲，已改为自然段口径。
- **文档**：`docs/audits/v4.26-revision-loop.md`。

### 🧹 上下文体检：重复段自动清空、规则×文笔风格冲突可检出（2026-10-31）
从「过检测」转回「写好小说」：先修上下文污染。实测发现项目的《文笔风格》仍写着「每段仅一个句号，句号后必须换行」，与写作规则的「自然段 2–6 句」正面冲突，且上一轮的规则去重开关对正文链路根本没生效。

- **规则×文笔风格冲突**（`shared/context-hygiene.ts` 的 `resolveStyleConflicts`）：检出「一句一段/每段一个句号/句号后换行」等碎段指令；规则有自然段锚点时**只剔除冲突行**（真实项目 1520→1420 字符），规则本身缺锚点则只告警并提示切到 `3.7.0-anchor`。
- **重复段检测**：2-gram Dice ≥0.85 且两段均 ≥200 字时，保留权威版本（规则 > 世界观 > 设定库 > 规划 > 场景 > 风格 > 上下文包），清空另一份；覆盖场景展开×场景卡、世界观×设定库、信息规划×情节蒸馏、上一章结尾×状态快照等长期重叠。
- **串章告警**：步骤结果里的章节号都不等于当前章且提及 ≥2 次时告警（不自动改，避免误伤合法引用）。
- **规则去重修正**：`writingStyle` 与正文实际使用的 `writingStyleContent` 同时走 `looksLikeWritingRules`，开关终于对正文生效。
- **可观测**：`InjectionLedger.hygiene` + 执行时间线「【上下文体检】1 处重复（已清空 settingLib） / 1 处规则冲突 / 1 处疑似串章」，冲突与串章逐条打印原因；设置页新增「上下文体检（重复段自动清空）」，默认开，可关成只报告。
- **高危险修复（端到端审计驱动）**：
  - **续写写错章**：`continue-chapters-modal` 对卷目录调用 `findChapterFile(..., '正文')`，标准名匹配失败后 frontmatter 兜底会返回该卷**第一个**正文——既导致本章正文不再创建，又可能把新章内容写进旧章文件。新增 `findBodyFileByChapterNum`（按 `第N章` 前缀在卷内匹配），4 条回归测试含「第10章不误匹配第1章」。
  - **伏笔被误标已回收**：结算对所有 `UPDATE_FORESHADOW` 一律执行 `moveForeshadowToRevealed`，只想改「计划回收/状态」的指令也会把伏笔移入已回收（且无反向路径）。现在只对「确实要求揭示」的名字移动，其余只记日志。
  - **后续章伏笔剧透**：故事上下文总线把 `upcoming/later` 伏笔连同「计划 第N章」注入当前章；legacy 变量改为只保留 `due/overdue/unknown`，且已有按章过滤结果时不再被节点版覆盖。
  - **世界观被静默截断**：节点版 `worldView`（3200 字）会覆盖模板链路更长的压缩版；改为「不缩短才覆盖」，设定库同理。
- **文档**：`docs/audits/v4.25-context-hygiene.md`（流程 10 步与注入面、污染源取证、端到端审计清单、治理机制、方法论建议：单一事实源/章节契约/补修订闭环/连续性账本/按边际信息分配预算）。

### 🧪 规则思路 × 正文模板组合实验：三个新规则版本 + V3/V4 正文模板（2026-10-31）
结论（**按重复采样修正**）：11 组单样本产生的「最优组合」被复测推翻——同一提示词重跑 rubric 可从 60 掉到 20；n=3 均值 C0 基线 33 / C4（场景节拍+V3）**40（三次全 40，最稳定）** / C9 27（60 是离群值），三组短叙述均值都是 0.39–0.40、对话 18–20%。朱雀对 C9、C4 均判「未发现明显的人工创作特征」。**没有组合稳定跨过 rubric 的对话/口语/锚点三项**。

- **三个不同思路的规则版本**（`shared/writing-rules-variants.ts`，设置页「写作规则版本」可直接切）：
  - `3.7.0-anchor` 正向锚点：只给正例，段落只留「自然段 2–6 句、80–220 字」一条硬规则；
  - `3.8.0-scene-beat` 场景节拍：一场戏 = 一次交换（目标/阻碍/交换/变化），叙述只写镜头能拍到的；
  - `3.9.0-voiceprint` 真人特征：只描述真人文本长什么样（八条可观察特征），不列禁止清单。
- **两套新正文模板**：`bodyGeneration.v3@3.0.0`（节拍先行：台词清单前置、不注入禁用清单/工艺块）、`bodyGeneration.v4@4.0.0`（对话主干：system 压到 1.4k、按台词编号写连续对话、每场用时间/序数落地）。`getStepTemplateAuto` 支持 `_bodyVariant` 强制路由；设置页新增「正文模板变体」（auto/v1/v2/v3/v4）与「可数硬指标」开关（`countableHumanHints`，默认关，块在 `engine/prompts/human-countable-hints.ts`）。
- **组合实验脚本** `scripts/humanness-combo.mjs`：用 esbuild 打包 `scripts/fixtures/prompt-exports.ts`，实验与插件运行时共用同一份模板/规则文本（不手抄 prompt）；支持 `--tag` 重复采样；产物落在 `data/experiments/combo/`（`test-results/` 会被 Playwright 每轮清空）。
- **实测（详见 `docs/audits/v4.24-rule-template-combos.md`）**：
  - 单样本里看似清晰的因果（锚点规则把短叙述压到 0.27、V3 把短叙述做到 0.63、可数硬指标把锚点推到 2）在 n=3 后都落回噪声，只能作为后续假设；
  - 对话占比在 11 组里始终 13–24%（复测均值 18–20%），由台词骨架决定；模板只能上浮 2–5 个点；
  - C4（场景节拍 + V3 + 样文）是唯一三次同分的稳定配置（40），可作为「不塌节奏」的对照基线。
  - 对话占比在 11 组单样本里 13–24%、复测均值 18–20%（骨架来自原章对话行），**要破 25% 只能改骨架数据结构，不是改提示词**。
- **验证**：新增单测（规则版本注册 5 版/切换/哈希、模板 V3/V4 路由、`_bodyVariant` 优先级、V3/V4 不引用禁用清单与工艺块、可数硬指标开关、设置默认值）。

### 🧬 版本化治理：写作规则/提示词模板可并存、可归因、可复现（2026-10-31）
一句话结论：**写作规则确实有可测权重（短叙述占比 0.47→0.29、段落 78→64），但它不是外部检测判定的决定因素**——消融 6 组里连「完全不给规则」都仍在 AI 档。真正被这轮修掉的是「规则以 6:1 权重、在两处、用与人味相反的指令覆盖人味块」这条隐式链路。

- **事故根因（取证）**：vault 的 `元文件/00-系统模板/写作规则.md` 是旧版（「一句一段」「一段一个句号」），与仓库新版只差 9 行、**版本号都是 3.6.0**，于是版本检查一路通过；且 `RulesService` 读的是 vault 根而非项目路径，规则又被 system `${writingRules}` + user「文笔风格」**注入两次**（约 7k 字符 vs 人味 1.2k）；`humanVoiceMode='exemplar'` 在主链根本没有接线。
- **通用版本注册表**（`shared/versioned-registry.ts`）：`hashContent`（FNV-1a，无依赖）、`selectActive`（多版本并存、只生效一个；精确 id → 版本号 → project>vault>custom>builtin 回退）、`detectDrift`（**版本号相同但哈希不同**→告警，正是本次事故的形态）、`extractVersion`（兼容 `3.6.0-中文后缀`）。13 条单测。
- **写作规则多版本**（`services/rules-registry.ts`）：内置两版——`builtin:3.6.0`（自然段 2–6 句，默认生效）与 `builtin:3.6.0-legacy`（旧版快照，仅对照/消融）；同时扫描 `元文件/00-系统模板/写作规则*.md` 与 `<项目>/00-系统模板/写作规则*.md`。新增设置「写作规则版本」（`activeRulesVersion`）；`RulesService` 改为读项目级路径并做版本 + 哈希双校验；启动时漂移告警可操作（指出路径与两个哈希）。
- **提示词模板多版本**（`engine/prompts/prompt-registry.ts`）：每步登记 `id@version` + 内容哈希（`bodyGeneration.v1@1.4.0` / `bodyGeneration.v2@2.1.0` / `deai.rewrite@2.0.0`…），人味块作为独立版本维度（`voice.quota@3.0.0` / `voice.exemplar@5.0.0`），正文归因用 `compositeId`；`activeBodyTemplate` 可强制 V1/V2 做对比。
- **主链修复**：`template-vars-builder` 按 `humanVoiceMode` 组装人味块（不再硬编码 quota）；`writingStyle` 不再重复注入规则编号章（`dedupeRulesInStyle` 默认开，可回退）；`co-writer-engine` 的 `mandatory.join('\n')` 产生 `[object Object]` 改为 `formatWritingRulesForPrompt`（抽到 `engine/prompts/writing-rules-format.ts`）。
- **可观测/可归因**：注入账本新增 `versions`（规则 id/版本/哈希/路径、人味版本、实验组、告警），执行时间线出「【版本】」与「【版本归因】」行；步骤结果 frontmatter 新增 `step_template_id/version`、`step_rules_version/hash`、`step_voice_mode`、`step_experiment_group`。
- **规则消融实验**（`scripts/humanness-ablation.mjs`，R1 六组）：固定同一章上下文 + 同一份台词骨架 + 同模型同温度 + 关闭 thinking + 无后处理，只改规则与人味。结果：规则占比 24.7%→0% 使短叙述占比 0.61→0.29、段落 83→64、对话块基本不变（由骨架决定）；**旧版 vs 新版规则几乎不改变输出**（G0→G1 短叙述 −0.03），换人味块的影响远大于换规则版本；**6 组朱雀判定全部「未发现明显的人工创作特征」**，对照真人样文为「人工创作特征显著」。据此定量：我们能控制的两个最大变量合计只解释短期指标波动，不改变外部判定；规则版本治理的价值是**可归因、可回退、可复现**。
- **分层修复**：规则正文下沉到 `shared/writing-rules.ts` / `shared/writing-rules-legacy.ts`（services 层只能依赖 shared），`engine/prompts/*` 保留兼容 re-export；分层基线收紧 1 条。
- **验证**：单测 **466 文件 / 5398 用例**（+38：版本注册表 13、规则注册 12、模板注册 11、账本版本 6、步骤 frontmatter 3、设置默认值 2、协作规则渲染 4）；lint / tsc / templates / css / inline / deps / engines / build / check:release 全绿。交付 `docs/audits/v4.23-impact-matrix.md`（影响因子矩阵、12 条规则×人味冲突、额度消耗与迭代判据）。

### 🎭 人味写作重建：样文校准 + 上下文放开 + 真迭代精修（2026-10-31）
实测结论先行：**「消痕后更像 AI」不是模型问题，是提示词结构问题**——真正发出去的消痕提示词是 23 条数值配额 + 20 个禁用词，模型逐条达标，产出「每项都刚好合格」的均匀文本；全链路没有一段正例样文（10 套文风预设的 30 个样文槽位全是占位）。

- **上下文丢截修复（OOC 的直接原因）**
  - 闸门回退到 32K 的根因：`resolveStepBudgetLimits` 不传 endpoint，供应商 endpoint（`.../`）与设置（`.../v1`）严格比较失败 → 回退 32768/8192 → 正文只拿到 **24076 token**，而模型窗口 1M。现端点归一化 + 闸门改用任务预算 `maxInput`，新增设置「单步输入上限（0=按模型真实窗口）」，硬上限 200K。
  - 关键段不再整段丢弃：`fitBySectionPriority` 新增 mustKeep（世界观/人物/本章信息规划/情绪弧/场景展开/场景卡/大纲/伏笔/上一章结尾/最终写作指令/故事上下文），段内截断从「只留前缀」改为**按段落边界保留头+尾**（旧实现会先吃掉段尾的写指令）。
  - 最终写作指令从「文笔风格」段尾拆成独立 `【最终写作指令】` 段并列入 mustKeep。
  - 丢弃可见：`fitPromptToContext` 返回 `droppedSections/trimmedSections/maxInputTokens`，写进 `prompt-ledger` 的 `【本步预算】` 行与事件 debug；提示文案改为列出具体段名，删掉「建议增加 maxContext」的错误建议（闸门根本不读它）。
  - 固定切片改动态配额（新增 `shared/context-budget-policy.ts`）：上一章结尾 500→1200–4000 字、长篇记忆 1500 字/12 条→3000+/20+、场景卡 12 场/3000 字→全场景、实体速览 8 人→20+、人物字段 clip 240/60→600/120、知识注入 900/700/…字符→按窗口比例、记忆碎片 3×200→6×400；世界观/设定库压缩改用真实窗口，且 keyword 压缩也置 `truncationApplied`（此前完全不可见）。
- **真人样文地基**
  - 新增 `scripts/sample-human-corpus.mjs`（`npm run sample:human`）：从本机《指纹资料库》7 本（4 本 GBK 用 `gb18030` 解码）按 400 字切分，各抽 3 段（战斗/日常/心理），写 `data/human-samples/`（**仅本机，不入仓库不入包**），并生成真人分布基线 `baseline.json`。
  - 新增 `shared/human-similarity.ts`：句长/段长/标点/对话占比分布相似度 + 保真校验（长度 ±15%、原文 2-gram 覆盖、数字保留）+ 综合分。
  - 新增 `npm run eval:humanness`：真人样文自查 + 单文件评估 + 改写前后对比。
- **提示词重写（样文优先）**
  - 新增 `engine/prompts/style-exemplars.ts`：按场景挑 2–3 段真人样文注入，`【真人写作样文（照这个语感写…）】`。
  - `human-voice.ts` v4：新增 `HUMAN_VOICE_WEAK_RULES`（6 条可观察弱约束）与 `buildHumanVoiceBlock()`；旧 23 条配额保留为 `HUMAN_VOICE_BLOCK`，设置 `humanVoiceMode='quota'` 可回退对比。
  - 消痕/精修提示词重写：`long-novel-tasks.ts` 的 deai/refine 改为「最多 3 处具体问题 + 照真人样文重写 + 情节/人设不变 + 字数 ±10%」，不再以禁用词为主约束。
  - 冲突规则统一：删掉「是否每段只有一个句号」这类与自然段冲突的检查；精准模式里「适当使用省略号/破折号」改为「服从语气，全文各≤2 处」。
  - `ai-lexicon`：把「点了点头/摇了摇头/沉默良久/深吸一口气/过了许久」从 L2/L3 降级为弱提示（真人高频词不该单独定罪）。
  - 双文件陷阱：`文笔风格.md` 没有样文而 `文笔风格模板.md` 有真人样文时，自动把「零、参考样本」补进正文（实测项目里已有《雪中悍刀行》3 段，此前从未被读到）。
- **真迭代精修**
  - 新增 `shared/iterative-refine.ts`：多轮改写 + 每轮打分（AI 味/人味/保真）+ 只接受严格更优版本 + 保真不过直接拒收 + 连续 2 轮无提升提前停。
  - 新增 `ui/services/humanness-scorer.ts`：组装 AntiAIDetector + 真人基线 + 保真；无基线时退化为「AI 味 + 保真」评分。
  - 面板：`refineRounds` 不再死配置，逐轮显示「R1: 62.0（综合分未提升）⛔ / R2: 68.0 ✅接受」与停止原因。
- **朱雀真实 A/B（6 组，外部检测器）**：同一章正文跑 6 套提示词（原稿 / 旧配额 / 只给样文 / 样文+弱约束 / 加对话占比 / 场景稿 / 台词骨架），逐份上传腾讯朱雀（模型 2026-07-21）——**六组全部同一档「未发现明显的人工创作特征」**。局部指标确实变了（段数 2→96、平均句长 19.4→13.5、对话占比 9%→17.2%），但判定不变；模型也不执行「对话≥40%」这类比例指令（实测 11.1%）。结论：提示词层面已到天花板，继续加禁令/配额收益趋零。
- **场景卡对话骨架（数据级人味）**：`SceneCardFields.dialogueBeats` + Scene 展开新增 `dialogue_beats`（6–10 条「谁→谁｜台词｜完成什么」）+ 正文模板 `${dialogueSkeleton}` must-keep 注入 + 注入账本登记；结算回写正文 frontmatter 新增 `对话占比/口语密度/时间锚点/人味分`。重写第1/2章验证：对话占比 9%→26%、人味分 20→60，但朱雀判定仍是「未发现明显的人工创作特征」——差距在模型 token 分布层面，提示词与数据骨架都改不到。
- **人工样本特征分析**：用一份朱雀判「人工创作特征显著」的 2306 字样文做同口径统计，差距集中在四处——对话占比 38% vs 我们 9–17%、对话块 27.7/千字 vs 11–23、**短叙述只占 63% 而我们 82–95%（碎过头）**、口语标记 2.2/千字 vs 0–2、时间锚点 12 处 vs 0–2。新增 `shared/human-feature-rubric.ts` 把这五项做成 0–100 评分卡（章级才评），与朱雀判定同向（人工 100 vs 我们 20–40）；弱约束改写成特征驱动的六条，章级对话下限 12%→20%，补修触发 15%→25%。
- **据 A/B 结果新增「定向对话补修」**：精修时若对话占比 <15%，只跑一轮「把最重要的 3 处叙述改成对话」，新版占比更高且保真通过才采纳（最多 1 次额外调用）；不再让模型自己数比例。
- **校准发现（重要）**：用第2章真实 AI 正文测，`humanSim=0.64` 反而高于真人样文均值 `0.58`——句长/段长/标点这些表层分布早被提示词优化过，**它们不能当 AI 检测器**。真正拉开差距的是对话占比（真人约 25%，该章 9%），因此把「章级对话 <12%」设为硬性不保真条件，并在文档中明确 `humanSim` 只作参考、判据是 `antiAI + 对话下限 + 保真`。
- **验证**：单测 **458 文件 / 5341 用例**（+22：human-similarity 14、iterative-refine 8，另更新 prompt-budget/step-prompt-assembly/long-term-memory 断言）；`sample:human` 实跑 7 本 → 21 段样文、真人 antiAI 均值 6.3；常规 E2E 23 passed；lint / templates / css / inline / deps / engines / build / check:release 全绿。

## v4.21.1（2026-10-31）

### 🔁 执行登记表（Agent 长流程闭环）+ RAG 评估基准 + 真实数据校准
- **执行登记表**（`services/execution-ledger.ts`）：插件级内存登记表（最多 20 条），记录长流程的「命令/项目/状态/耗时/失败原因/结算回写量」。此前 `run_command` 只有 boolean 出口（`main.ts` fire-and-forget），结算的 `SettlementResult` 三条路径用完即弃，Agent 只能回「请去界面看」。
- **完成点埋点**：一键成文（写章弹窗结算后）、章节结算弹窗（完整 + 轻量）、步骤式结算（`step-runner`，含幂等跳过的留痕）、导出成稿、生成看板——各自记录结构化结果；失败路径同样留痕。
- **Agent 可读**：新增工具 `get_execution_status`（状态/耗时/失败原因/更新·新建·搁置·拒绝字段·链接化·出场记录·伏笔闭环），端口新增 `getExecutionLedger`；`run_command` 改为 `await plugin.executeCommandAsync()`，派发即抛错的情况能被捕获并登记；引导策略补一条「长流程完成后主动查结果再汇报」。
- **RAG 评估基准**：新增 `npm run eval:rag`（hit@k / MRR / **近重复占比**），评分逻辑下沉到 `shared/rag/eval-score.ts` 纯函数并进单测。近重复用**重叠系数**而非 Jaccard——重叠分块产生的重复是「一段包住另一段」，Jaccard 会因长度差把 0.95 压到 0.7。
- **真实项目校准（九霄逆脉行，只读盘）暴露并修复 3 个真实缺陷**：
  1. **存量信息规划解析为空**：旧模板用 `**伏笔操作（本章埋设）**：` 加粗行 + 表格，`parseInfoPlanFields` 只认 `## 标题`，导致章纲硬要求注入块为空、伏笔计划恒为 `[]`——数据级反 AI 约束在存量项目上**静默失效**。现兼容加粗小节与表格第一列。
  2. **伏笔闭环误报**：字段恢复后 5 条计划伏笔里 4 条被判「未埋设」，实际报告里都有，只是名字不同（`裴无极“记下名字”` vs `裴无极让姜晚"记下名字"并远喊"三个月"`）。根因是中文弯引号未归一 + 人工简写与模型描述不匹配。现归一中文引号、去虚词、2-gram 覆盖率 ≥0.6 视为覆盖；真实缺失（`陆昭案关联`，项目自己的质检也标了 `CRITICAL_FAIL`）仍正确报出。
  3. **看板生成不幂等**：`.看板/` 是点开头隐藏目录，Obsidian vault 索引不收录 → `getAbstractFileByPath` 恒为 null，第二次生成走 `vault.create` 报 `File already exists`。改用 `adapter.write` 覆盖写。
- **分析报告协议补字段**：`UPDATE_CHARACTER` 增加 `修为等级`/`当前位置`/`所属势力`、`UPDATE_ITEM` 增加 `当前状态` 的显式示例与强制规则——真实项目 8 个人物 **0 个**有这些字段，实体图谱因此长期为空（v4.20 只补了白名单，上游协议没产出）。
- **成本观测**：注入溯源的 `prompt-ledger` 增加「本步成本」行（模型 1 次调用 + 嵌入实际调用数/缓存命中 + 输入 token），事件 `debug` 同步带 `embeddingCalls`/`retrievalQueries`/`cacheHits`/`cacheMisses`。
- **验证**：单测 **455 文件 / 5314 用例**（+43：execution-ledger 14、get_execution_status 6、eval-score 14、存量为旧解析/引号归一 9）；真实 Obsidian E2E **23 passed / 11 skipped**（新增执行登记表 1 条，且**同一项目连跑两次看板**验证幂等）；lint / check:templates / check:css / check:inline-styles / check:deps / check-engines / build / check:release 全绿。

### 🧪 真实 AI 链路实测（第2章一键成文，发现并修复 6 个缺陷）
用真实项目 `九霄逆脉行` 第2章跑通一键成文，产物全部读盘核对：
- **正文**：`第2章_锁痕_正文.md` 2904 字（`word_count: 2894`），标题由模型自拟并回写文件名。
- **规划链**：信息规划/大纲摘要/情绪规划/Scene 展开全部产出真实内容（情绪规划 7300 字、Scene 展开 16574 字）。
- **结算**：更新 13 项、新建 16 项、出场记录 6 条、归属链接化 4 条，伏笔闭环 **通过**（回收 2、埋设 5）；`出场记录.md`、`结算表.md`、`叙事总览.md`、`章节状态快照`、伏笔库（+923 字）全部落盘。
- **实体字段**：`当前位置` 写入 3 个人物、`修为等级` 写入沈砚（此前 8 个人物 0 个有这些字段）——v4.21 补的「分析报告字段示例」在真实模型上生效。
- **注入溯源**：单步 62–63 段 / 87,230 字符 / ~58,166 token（信息规划）、84,151 字符 / ~56,116 token（大纲摘要），无截断段。
- **成本**：`embeddingCalls=0`——该项目的写作知识库没有拆解参考书，RAG 管线在真实链路中未被触发（已记入遗留）。

实测暴露并修复的 6 个缺陷：
1. **正文对话校验误判（每章必中）**：写作规范输出中文弯引号“”，`validateBodyGeneration` 只认 ASCII `"` 与「」，含 18 对对话的 2682 字正文被判「缺少 对话描写」，一键成文中断在正文步。改为统一 `DIALOGUE_PATTERN`（弯引号/单引号/直角引号/ASCII）。
2. **质量控制校验误判**：真实输出用 `## 一、写作技法检查`、`## 【修改建议汇总】`，校验器只认 `## 关键词`；且三项必填齐全但缺一个加分项时 85 分阈值永远达不到，`missing` 还是空的（用户看不到原因）。现规范化中文序号与包裹符，并在三项必填齐全时判完成（加分项只影响分数）。
3. **模型空返回导致整章中断**：思考型模型偶尔把预算全花在 reasoning、正文为空且 `finish_reason=stop`，旧实现直接判「AI返回为空」→ 步骤报错 → 章节中断。现对同模型**关闭思考重试一次**（流式与非流式都有）。
4. **后台整章异常被吞**：`runBackground` 由命令层 fire-and-forget 触发，异常不会上报，实测「跑满 15 分钟毫无反应」。现 try/catch → 执行登记表记 failed + 界面提示。
5. **同一章重复结算**：一键成文（StepRunner）与后台整章会先后跑到同一章，各自无条件 `settle` → 实体更新重复、`status` 在 settled/written 之间来回翻。现后台整章加「磁盘已 settled 则跳过」幂等守卫。
6. **按标题重命名后章节反解失败**：正文被重命名为 `第2章_锁痕_正文.md` 后，`openChapterByPath` 与 `parseChapterFromPath` 的正则要求「第N章_正文.md」紧贴，导致「请先打开一个章节」。现按 `第N章` 前缀反解，兼容 `第N章_标题_正文.md`。
- **新增真实链路专用用例** `tests/e2e/real-ai.spec.ts`（playwright project `real-ai`）：默认 skip，需 `E2E_REAL_AI=1` 才打开真实 vault；自动跑一键成文→轮询终态→读盘核对→输出 `test-results/real-ai-observations.json`；卡在规划步会降级到后台整章，正文已达标则不重复生成。
- **验证**：单测 **456 文件 / 5319 用例**（+5：真实输出格式兼容）；常规 E2E 23 条；lint / check:templates / check:css / check:inline-styles / check:deps / check-engines / build / check:release 全绿。

## v4.21.0（2026-10-31）

### 🔎 RAG 检索管线 + Agent 会话运行时（dsh 能力补齐）
- **统一 RAG 管线**：9 个知识注入点不再各自 `search()` + `slice()`，收敛为「查询计划 → 并行检索 → 合并去重 → 邻块扩展 → 阈值 → MMR → 预算打包 → citation」。新增 4 个纯函数模块——`shared/rag/query-plan.ts`（场景目标/上一场结尾/情绪弧/章纲/正文/出场人物拆成带权重多查询，同文本保留最高权重）、`neighbors.ts`（同书同维度 position ±1 拼回完整场景）、`diversity.ts`（2-gram MMR，避免近重复占满预算）、`budget-pack.ts`（按性价比装预算，最高分必保、尾条可截断）。
- **检索服务与遥测**（`engine/rag/retrieval-service.ts`）：`Promise.allSettled` 并行查询；失败不再静默返回空串，而是 `{ hits, telemetry, error }`。遥测（查询/命中/去重/邻块/丢弃/缓存）累计进 `KnowledgeInjector.lastInjectionMeta.retrieval`，再并入 `prompt-ledger`——执行时间线可回答「这次生成检索了什么、丢了什么」。
- **省重复嵌入**：向量库新增查询向量 LRU 缓存（模型指纹 + query 为键，上限 100）与 `getNeighbors()`（直接读内存 samples，零 I/O）。同一句 query 在 9 个注入点只嵌入一次。
- **长篇记忆去重 + 相关度排序**（`shared/memory-rank.ts`）：同类别同名/近重复事实合并（保留信息更全的一条），再按「2-gram 相关度 + 新近度」排序；协同写作把当前章纲/前情提要作为 query。只改「选哪 12 条」，总量上限与输出格式不变。
- **Agent token 计量**：`getTelemetry()` 新增 `contextTokens`（投影字符 ÷1.5）与 `windowUsage`（按当前模型 `maxContext`），工作台遥测网格显示「上下文 / 窗口 / 落盘」。
- **文件工具与路径守卫**：新增 `read_file`（行窗口 200 行/8192 字符、offset 续读）与 `search_vault`（关键词 grep，`path:line:摘要`，最多 50 条），端口新增 `readFile/searchVault`。守卫在 `shared/file-path-guard.ts`：拒绝绝对路径、盘符、`..`、隐藏目录（`.sessions/` 白名单除外）、控制字符；翻页越界返回空窗口而不是重复末行。
- **大结果落盘（dsh spill）**：超过 6000 字符的工具结果原文写 `.sessions/spill/agent/<项目>/`，会话日志只留「定位符 + 头尾摘要」，模型用 `read_file` 无损取回；遥测记录落盘条数与节省字符；存档 7 天后会话启动时清理。写盘失败保留原文（宁可多花 token 也不丢结果）。
- **@ 文件引用**：输入框由单行 `input` 改为 `textarea`（Enter 发送 / Shift+Enter 换行 / 输入法不误发），输入 `@` 弹出库内路径候选（↑↓ 选择，Enter/Tab 确认，支持 `@"带 空格.md"`）。发送时只注入「【用户引用的文件】路径 + 用 read_file 读取」清单，不把正文塞进提示词。
- **引用消息（dsh message-quotes）**：消息悬停出现「❝ 引用」，输入框上方显示引用条，发送时以 `> 原话` 前置；控制令牌（`__retry__`/`__fallback_rule__`）不参与引用。
- **时间上下文**：每回合按分钟去重注入「【当前时间】…（周X）」，日期/季节/期限描述有据可依。
- **会话持久化（dsh session-persistence-jsonl）**：`.sessions/agent/<项目>.jsonl` 每回合结束节流 1s 追加快照（事件/记忆/计划/callSeq），超过 512KB 只留最新一行；重开工作台自动恢复历史（不重放开场白），头部显示会话标题（首条用户消息前 30 字），新增「🆕 新会话」清空存档。
- **验证**：新增 `rag-pipeline`(14)、`rag-retrieval-service`(8)、`memory-rank`(12)、`file-path-guard`(14)、`file-mention`(20)、`time-context`(5)、`agent-session-dsh`(21) 共 94 条单测；全量 **452 文件 / 5271 用例**、lint / preflight 各分项 / build / check:release 通过；真实 Obsidian E2E **22 passed**（新增「@ 引用候选 + 新会话入口」1 条，并把 Shift+Enter 断言更新为换行语义）。

### 🧭 接入 Obsidian 原生能力：属性 / 标签 / 可折叠侧栏 / Bases
- **右侧「项目速览」面板**（`ui/project-side-panel-view.ts`）：挂在右侧 dock，跟随当前活动笔记，三段可折叠（折叠状态持久化）——① **本文件属性**：按属性模板渲染内联编辑（状态/身份下拉、字数数字、涉及人物列表），缺必填属性时给「补齐」；② **标签**：列出全部标签，`nw/*` 高亮，点击复制 `tag:#…` 检索式；③ **快捷动作**：章节→工作台/协同/结算/看板，实体→看板/查看提及。入口：命令「🧭 项目速览面板」+ 侧栏 `sidebar-right` 图标；右栏折叠时先展开。
- **标签分级（双标签并存）**：新增 `shared/tag-taxonomy.ts`，插件标签保留原名并追加层级标签（`正文/短篇正文/剧本 → nw/正文`；`人物/地点/势力/物品功法 → nw/实体/*`；`世界观/设定库/伏笔库/时间线 → nw/设定/*`；12 类步骤结果 → `nw/步骤/*`）。Obsidian 标签面板会把 `nw/` 折叠成组，Bases 精确筛选。写入端覆盖模板服务（22 处）、22 个模板、结算新建实体、AI 生成器、示例项目（共 26 处）；存量用命令「🏷️ 补齐分层标签（先预览）」迁移，只加不删。
- **Bases 看板生成**（`engine/bases-generator.ts`）：命令「📊 生成/刷新项目看板」在 `<项目>/.看板/` 生成四个原生看板——章节进度（表格 + 按状态分组卡片 + 字数汇总）、人物状态（按身份分组）、物品归属（按持有者分组、含当前状态）、地点与势力（双视图）。数据源就是结算回写的 frontmatter，零维护；可拖进右侧栏随窗口折叠。
- **属性模板与补齐**：新增 `shared/frontmatter-schema.ts`（10 类文件 × 属性定义/必填/候选值），命令「🧩 补齐笔记属性（先预览）」按模板补缺失必填项，只补空值不覆盖。属性模板同时是面板渲染与看板列的单一来源。
- **验证**：新增 `frontmatter-schema`(12)、`tag-taxonomy`(10)、`bases-generator`(10)、`note-properties-service`(8) 共 40 条单测；真实 Obsidian E2E 新增 1 条（面板渲染 → 改 status 读盘 → 生成 Bases 并校验 `file.hasTag("nw/正文")` 落盘）。全量 **445 文件 / 5177 用例** + E2E **21 passed**。

### 🧾 注入影响溯源账本 + 指纹指引显性化（2026-10-30）
- **遗留清偿（同日晚）**：① 执行时间线把 `prompt-ledger` 事件渲染成**注入溯源表格**（段/影响面/字符/token/来源，截断段高亮）；② 协同写作监控面板新增「🧾 注入溯源」卡（PromptBuilder 聚合快照各段 + 指纹分层统计，init 完成后同步写调试日志）；③ 指纹板块新增「🩹 批量补样本」——为「知识库导入且样本为空」的指纹批量从原文补 few-shot 样本（确认后执行，含向量化额度提示）；④ 新命令「🔗 实体链接迁移」：扫描存量实体的归属字段纯字符串，dry-run 预览 → 确认后写回 wiki-link（老项目关系图谱化的显式迁移入口）。⑤ 时间线面板账本表格 + 协同监控「注入溯源」卡 + 指纹「🩹 批量补样本」按 32.6 节落地；新增 entity-link-migrator 7 条单测（合计 **441 文件 / 5137 用例**）。
- **回答「指纹/文风算不算记忆」**：代码上指纹/文风（风格指引线）与长篇记忆（事实清单线）是两条独立注入线，但从影响输出的角度，**指纹/文风是跨章节持续生效的"风格记忆"**——被截断/样本为空/强度为 0 就是风格记忆丢失，表现为文风漂移。本轮把这条线的生效情况从"看不见"变成"可溯源"。
- **注入溯源账本**（`shared/injection-ledger.ts`）：V2 正文模板 31 个注入段全部登记——段名 / **影响面（事实记忆 / 风格指引 / 流程约束）** / 来源文件或引擎 / 字符数 / 估算 token / 预算与截断标记 / 注入位置。每次 AI 步骤完成时以 `prompt-ledger` 执行事件写入时间线（调试字段含总字符/总 token/截断数），一眼看清"谁影响了这次生成、谁被预算吞了"。
- **指纹预算可配置 + 截断事件化**：新增设置 `fingerprintInjectionBudget`（默认 2000 字符，可调 4000/8000/更大），透传 `TieredInjectionBuilder`；句子层被丢弃 / 段落层被截断不再静默——`TieredBuildStats` 统计 + 账本 ⚠ 标记。
- **知识注入可见**：`KnowledgeInjector.lastInjectionMeta` 记录各指引段（风格/节奏/技巧/伏笔）字符数与强度；预算闸门把知识注入整段丢弃时账本显式标红。
- **指纹详情面板「🎯 注入影响」卡**：原文样本数 / 注入三层说明 / 预算说明；样本为 0 时黄条警告「段落层 few-shot 不会生效」+ 一键「📚 从知识库补样本」。
- **修复样本断链**：知识库导入指纹时从 `getSourceText` 原文分块取 8–12 段真实 prose 作为 few-shot 样本（此前 samples 恒空，导入指纹只剩特征描述）。
- **验证**：新增 injection-ledger 6 条单测；全量 **440 文件 / 5130 用例**、preflight / build / check:release / 真实 Obsidian E2E 20 条全绿。

### 🔗 结算回写加固 + 实体关系链接化（2026-10-30）
- **修复「人物境界回写不了」**：`UPDATE_CHARACTER` 字段白名单缺 `修为等级`/`当前位置`——AI 正确输出的境界变更被静默丢弃。现人物白名单改为「旧清单超集 + 字段映射表全集」，`修为等级`/`当前位置`/`存续状态` 全部可回写。
- **四类实体统一字段守卫**：势力/地点/物品的 UPDATE 此前无任何校验（垃圾字段直写 frontmatter），现统一走 `getValidFrontmatterKeys` 白名单；非法字段记入 `SettlementResult.rejectedFields` 并聚合一条警告，不再静默。
- **目标实体缺失不再无声**：UPDATE 目标文件不存在时记入 `missingEntities`，结算结束统一提示「N 条更新被搁置」，不再静默 `continue`。
- **重复结算幂等**：`NEW_TIMELINE` 同「时间+章节+事件」跳过；`NEW_FORESHADOW` 同名伏笔（未回收/已回收任一表）跳过——重跑结算不再翻倍。
- **实体关系链接化（Obsidian 原生图谱）**：新增 `shared/entity-links.ts`——`所属势力`/`当前位置`/`所属归属`/`领袖`/`所在区域` 等归属类字段由结算层自动把实体名写成 `[[wiki-link]]`（AI 只填名字，协议不变）；所有权**单侧写入**（物品→人物），人物侧不做双写。frontmatter 链接直接进 Obsidian 关系图谱，「谁拥有什么/谁在哪」零维护。
- **物品「当前状态」字段**：ItemDomainModel/frontmatter/映射表/模板全链路新增 `当前状态`（在谁手里/封印/损毁），结算可回写。
- **图谱反查进上下文（记忆不遗忘）**：新增 `engine/entity-graph.ts`——`getOwnedItems`（物品归属反查，兼容旧纯字符串）、`getRecentBehaviors`（出场记录近况）、`buildEntityRelationsBlock`（出场角色的境界/位置/势力/随身物品/近况速览，零 AI）。正文 V1/V2 模板新增 `${entityRelations}`；协同写作 init 新增 A5 注入点（`PromptSnapshot.entityRelationsContext`）。
- **验证**：新增 3 个测试文件 19 条（链接解析/白名单/反查+速览块）+ 指令解析回归；全量 **439 文件 / 5124 用例**、preflight / build / check:release / 真实 Obsidian E2E 20 条全绿。

### 🧬 数据级反 AI：章纲字段 / 伏笔闭环 / 角色出场记录（2026-10-30）
- **章纲数据字段**：信息规划模板新增「开头承接」（上一章末句 + 本章首句承接方式）与「章末钩子」（钩子类型 + 内容）两个小节；新增 `shared/info-plan-fields.ts` 解析成类型化字段，并把硬要求块随 `${infoPlan}` 注入正文与分析提示词（旧版信息规划无此小节时自动跳过，行为不变）。
- **伏笔闭环自动核对**：新增 `shared/foreshadow-loop.ts`——结算时把分析报告的 UPDATE_FORESHADOW（回收侧）与 NEW_FORESHADOW（埋设侧）跟章纲「伏笔操作」计划比对；回收≥1 且埋设≥1 且计划全覆盖才通过，不通过直接弹结算警告并写入 `SettlementResult.foreshadowLoop`。数据级约束，不再依赖模型自觉。
- **角色按章行为摘要**：分析报告新增 `CHARACTER_BEHAVIOR: 角色名 | 本章做了什么` 指令（强制规则：主角必填、每角色一句话≤40字）；结算自动合并进 `01-世界架构/人物/出场记录.md`（按 章节+角色 去重、重跑结算覆盖旧摘要、按章号排序）。角色从静态卡变成「档案 + 按章行为时间线」，续写上下文与「角色最近做了什么」查询有了权威数据源。
- **验证**：新增 3 个测试文件 21 条 + 指令解析 1 条；全量 **436 文件 / 5105 用例**、preflight / build / check:release / 真实 Obsidian E2E 20 条全绿。

### 🕵️ 反 AI 痕迹 v3：吸收「去AI味」实战规则（2026-10-30）
- **来源**：实测云笔 AI（aixiaoshuojia.cn）的创作系统——从其前端 API 面还原了后端表结构（项目/章节/大纲树/角色/世界观/时间线/对话/Agent 任务），并取到其社区规则库里经 251 章真实连载验证的「去AI味润色」场景规则全文。该规则挂在站点全部 27 个 AI 生成场景上。
- **提示词 v3（`human-voice.ts`）**：在自然段/句长/对话约束之上新增实战硬规则——不用分号；省略号与破折号全文各最多 2 处；「不是A，而是B」全篇最多 1 处；禁止「他不知道……只知道……」排比感慨；禁止末段升华/点题；心理与纯景物描写一次不超过 3 行、描写合计不超过两成；允许口语、重复用词与不完美表达（用词过于“正确”本身就是 AI 特征）；给了上一章结尾时首句必须承接；结尾落在动作/对话/悬念上。单元写作（短篇/剧本）与 DEAI 重写同步挂载。
- **检测器升级（`prose-metrics.ts`）**：新增硬伤统计与判分——分号计数（出现即报）、省略号/破折号硬上限、「不是…(而)是…」堆叠（含句号分隔变体）、排比感慨（出现 1 次即报）、末段升华识别（窄特征防误伤正常动作收尾）。`人味体检`与单元工作台质检自动继承。
- **AI 味评分（`anti-ai-detector.ts`）**：新增「硬伤标点」统计特征（分号×2+省略号+破折号密度，权重 10）；修正旧版标点约束——不再建议「用省略号/破折号凑变化」，改为「让角色开口或用疑问/感叹句」。
- **验证**：新增 14 条单测（硬伤计数、堆叠阈值、升华识别与误报、提示词断言、检测特征）；全量 **433 文件 / 5083 用例** 通过，preflight / build / check:release 全绿。

### 🖼️ EPUB 封面图（2026-10-27）
- **EPUB 导出嵌入项目封面**：项目内已有 `封面/cover.png`（或 .jpg / .jpeg / .webp）时，导出 EPUB 自动嵌入——`OEBPS/images/cover.<ext>` 存原图字节，`cover.xhtml` 全页显示，`content.opf` 声明 `properties="cover-image"`（EPUB 3 标准位）并保留 `<meta name="cover">`（EPUB 2 老阅读器兼容）；nav 与 NCX 目录首项为「封面」。手机阅读器、微信读书、Kindle 转换都会用这张图作书架封面。
- **导出弹窗**：格式选 EPUB 时显示「包含封面图」开关与封面状态提示（找到的文件路径 / 未找到的解决方法）；未找到封面时导出降级为无封面 EPUB 并提示，不阻塞。JPEG/PNG 是 EPUB 核心媒体类型；WEBP 非核心但主流阅读器已普遍支持。
- **验证**：新增 5 条单测（无封面零污染、图片字节原样入包、OPF/cover.xhtml/nav/NCX 结构、统计不受影响、空封面降级、扩展名 → media-type 映射）；真实 Obsidian E2E 在短篇流程里创建 `封面/cover.png` 后导出 EPUB，读盘断言 PNG 字节与 `properties="cover-image"` 原样存在。全量 **433 文件 / 5074 用例**、20 条 E2E 通过。

## 4.20.0 — 2026-10-27

> 本版主线：三模式创作流程从「右上角提示」变成可走完的流程页；短篇/剧本有了真正的单元写作工作台；成稿导出补齐 EPUB/DOCX；六个既有板块完成一轮审计修复。完整说明见 `docs/releases/v4.20.0.md`。

- **三模式创作流程**：工作台新增「创作流程」页签与项目页摘要，创建短篇/剧本后自动落位；阶段状态由 `shared/creation-flow.ts` 纯函数从磁盘事实推导，老项目不会被拉回第一步。
- **短篇/剧本单元写作工作台**：三栏界面 + AI 生成本节/续写/改写 + 本地语感质检 + `status/word_count` 回写；修复 `chapterNumber` 只认「第N章」。
- **成稿导出五格式**：Markdown / TXT（UTF-8 BOM 可选）/ HTML / EPUB 3 / DOCX，全部本地生成、无运行时依赖；导出不再导错项目。
- **模式守卫**：长篇/短篇/剧本专属命令按项目模式隐藏与拦截，Agent 工具、chips、`run_command`、`get_project_status` 同步对齐。
- **既有板块审计**：写作指纹库、知识库、协同写作、完整写作工作台、Agent 工作台各修一轮；吸收 dsh harness 的工具裁剪/超时/重复分级/steering/危险命令确认。
- **设置与写作体验**：三层配色与 CSS 全量重构、API 两栏设置与模型自动发现、字体管理、人味写作提示词与自然段重排。
- **流程口径修复**：结算阶段改按全书规划章数计算，只写一章并结算不再被判成「结算完成」。

### 📦 成稿导出格式扩展：TXT / EPUB / DOCX（2026-10-27）
- **新增 EPUB 3（.epub）**：用本地构建器生成完整 OCF 结构（mimetype 首条且不压缩、container.xml、content.opf、nav.xhtml、toc.ncx、逐章 XHTML、打印样式）。卷/章标题、短篇「节」、剧本「集」沿用同一套标题规则；frontmatter 与模板 H1 自动剔除；XML 特殊字符与控制字符安全转义。适合手机阅读器、微信读书导入，Kindle 可用「发送到 Kindle」自动转换。
- **新增 Word（.docx）**：最小但合规的 OOXML（[Content_Types].xml、_rels、document.xml、styles.xml、core/app 属性）。标题层级（Title/Heading1/Heading2）、正文首行缩进两字符、1.5 倍行距、每章分页已排好；作者写入 docProps 元数据。适合投稿平台与编辑改稿。
- **TXT 补强**：保留纯文本导出，新增「TXT 带 UTF-8 BOM」开关（兼容旧版 Windows 记事本）；文件名与卷/章分隔规则不变，仍是平台投稿最稳的格式。
- **无运行时依赖的 ZIP 打包器**：新增 `engine/export/zip-writer.ts`（store 模式 + CRC32，纯 ASCII 路径不置 UTF-8 标志），EPUB/DOCX 共用；新增 `exportBinaryFile`，桌面走下载、移动端/`preferVault` 走 `vault.createBinary/modifyBinary`。整套二进制生成可在 Node 单测与 PowerShell/Python 解包校验。
- **导出入口修复**：`ExportManuscriptModal` 不再把外部传入的项目静默替换成项目列表第一个；列表缺失时也保留调用方项目，避免「从短篇流程点导出却导出长篇」。格式/作者/BOM 选项按当前选择动态显隐，短篇/剧本仍隐藏「卷标题」。
- **验证**：新增 12 条单测（ZIP/CRC32 往返、EPUB OCF 结构与章节内容、DOCX OOXML 结构与转义、二进制落盘），真实 Obsidian E2E 在短篇流程里选择 EPUB 导出并读盘校验 ZIP 头与 `application/epub+zip`；全量 433 文件 / 5068 用例、20 条 E2E 通过。

### 🧭 三模式创作流程与单元写作工作台（2026-10-27）
- **创作流程页签**：`FullWriterView` 新增 `flow` 页签与 `FlowPanelController`——按项目模式展示 4–5 个阶段（长篇：初始化 → 章节写作 → 章节结算 → 导出；短篇：前期调研 → 分节大纲 → 分节写作 → 导出；剧本：调研 → 分集大纲 → 分镜表 → 分集写作 → 导出），每阶段带进度、状态与唯一的「下一步」按钮。阶段状态由 `shared/creation-flow.ts` 的纯函数从磁盘事实推导（`listModeUnits` / `getChaptersForProject` / `summarizeChapterProgress`），不再只靠右上角 Notice 口头指路；已有正文的老项目会把前置设定阶段标为「已按既有正文跳过」，不会被拉回第一步。
- **创建即断头修复**：`PreResearchModal` 创建短篇/剧本后自动打开该项目的创作流程页；导航失败只降级提示，不会把「项目已创建」误报为失败。项目页右侧新增流程摘要卡（总进度、阶段圆点、下一步、查看完整流程），并新增 Ribbon 与命令「🧭 创作流程」。
- **短篇/剧本单元写作工作台**：新增 `TabType: 'unit'` 与 `UnitWriterController` 三栏界面（单元列表 / 编辑器 + AI 工具条 / 大纲与设定）。此前「继续写作」直接打开裸 Markdown，没有 AI、没有状态回写；现在支持 AI 生成本节、续写、改写选区（区间校验）、本地语感质检、人味体检、完成本节并自动跳下一单元。
- **状态回写闭环**：新增 `engine/mode-unit-writer.ts`（上下文读取、提示词、frontmatter 合并、字数统计、保存、改写守卫，全部通过注入的 `UnitFilePort` 可单测）；保存即更新 `word_count`，「完成本节」写 `status: written`，流程页/项目页/Agent 进度立即一致。同时修复 `chapterNumber` 只认「第N章」：现在支持章/节/集/回/幕，`summarizeChapterProgress` 支持 `unitLabel`，短篇/剧本的「最新已写 / 建议下一节」不再恒为空。
- **模式守卫**：新增 `shared/command-mode-rules.ts`（命令 → 允许模式）与 `shared/project-mode.ts`（路径前缀 + `.project`，同步缓存供命令面板使用）。长篇专属命令（全书规划、批量建章、章节结算、世界架构实体生成、句级协同…）在短篇/剧本项目下从命令面板隐藏，执行时给出明确替代入口；短篇/剧本专属命令同样只在对应项目可用；`ModeDocumentModal` 增加项目真实模式校验，杜绝「短篇命令写进剧本目录」。桌面导出成功后回调流程页标记导出完成，取消导出不再误判。
- **Agent 模式对齐**：新增 `open_flow` 工具；`open_wizard` 在非长篇项目下拒绝并指路；`open_chapter` 接受节/集并映射到单元工作台；`run_command` 执行前按命令模式表复核；`get_project_status` 按模式输出「章/节/集」；对话 chips 按项目模式分叉，短篇/剧本不再出现「打开项目与章节」这类长篇语义。
- **CSS**：新增 `nw-flow-*` / `nw-unit-*` 区块（三模式阶段面板、进度条、单元列表、质检卡），状态类统一 `nw-is-*` 前缀；CSS 基线已按新增 UI 显式更新。
- **修复「只写一章却显示结算完成」**：结算阶段原来按「已结算 / 已写」计算，写完第 1 章顺手结算就变成 1/1，流程直接判「结算完成」并把总进度抬到 40%。现在按全书规划章数计算（已结算 / 总章数），只有全部章节都结算完才算完成；进度文案同时标出「已写 N」，项目页摘要与流程页同步修正。顺带给流程摘要的阶段圆点加 1px 描边，避免主题的 secondary 背景与卡片同色时「未完成阶段」看不见。

### ✨ 改动
- **吸收 dsh harness 的计划/压缩/工具呈现**：对照本地 dsh 源码（`plan/plan-mode`、`compaction/`、`client/ui-tool`）新增三项能力——① `update_plan` 工具 + 左栏「创作计划」卡片（多步任务自动建计划、状态实时更新、进行中步骤闪烁）；② 会话压缩（30 轮触发、保留最近 12 轮，按 **tool-pairing 平衡**找安全切割点，把旧历史范围替换为单个摘要节点，摘要由一次独立 AI 调用生成）；③ 工具调用行改为 dsh ToolRow 风格：折叠为「图标 + 摘要」，点击展开完整参数/结果。
- **工作台视觉与层级优化**：消息行/工具行/chips/模型弹层加入入场与状态动画（fade-up、三点打字指示、计划步骤脉冲）；AI 气泡加左侧强调线、用户气泡实底、系统行虚线胶囊，头部毛玻璃吸顶；头部可折叠左右栏并持久化；工具参数类型新增 `array` 支持（`update_plan` 依赖）。
- **对话输入区按比例加宽**：中栏会话列上限 900→1200px，输入/工具条/chips 的左右内边距改为 `clamp(12px, 2.4vw, 44px)` 自适应；输入框加高至 40px、字号 13.5px、聚焦描边；发送按钮改 40×40 方形。1800px 窗口实测：左 210 / 中 856 / 右 360，输入框 772px。
- **右栏文件面板自适应**：改用容器查询（右栏窄于 460px 时文件树与预览上下堆叠），并在 900px 以下才隐藏右栏；修正旧 `max-width: 1100px` 规则导致的「右栏直接消失」问题。
- **项目识别修正**：`listProjects` 排除「元文件/导出文件/协同文件/写作知识库/指纹资料库」等基础设施目录（模板骨架带有章节目录会被误判成项目），也不再收录 `.`/`_` 开头的隐藏目录。
- **工作台三栏可拖拽调比例**：Agent 创作工作台左右两条分隔条支持拖拽调整宽度（左 160–600px、右 280–760px），松开即持久化到设置，重开恢复；拖拽期间禁用文本选择。
- **文件预览自适应内容**：工作台文件预览按内容类型自动选渲染——图片（png/jpg/webp/svg/gif/avif）以 `<img>` 经 `vault.getResourcePath` 直接展示；音频/视频（mp3/mp4/webm 等）以 `<audio>/<video controls>` 播放；Markdown 走 `MarkdownRenderer` 完整渲染（标题/列表/表格/代码块/引用/图片）；其余文本 pre 展示；未知二进制占位提示。新增 `shared/preview-kind.ts` 分类器。
- **协同写作编辑器字体选项**：编辑器工具栏新增「字体」下拉——跟随主题正文/界面/等宽（Obsidian CSS 变量）+ 常见中文系统字体预设（微软雅黑/苹方/宋体/楷体/黑体/仿宋/思源黑宋）+ 自定义载入字体；选择即时生效并持久化，幽灵建议层同步字体。
- **自定义字体载入模块**：新增 `services/font-manager.ts`（字体格式调研落地：TTF/OTF 原始格式兼容性最好，WOFF2 Brotli 压缩体积最小且 Electron 完整支持，中文字体 5–20MB 本地全量载入即可；运行时载入用 **FontFace API**——`vault.readBinary` → `new FontFace(family, buffer)` → `document.fonts.add`，卸载 `document.fonts.delete`）。字体文件放 vault「元文件/字体/」，插件启动自动恢复注册；新增「🔤 字体管理」弹窗（扫描并载入/列表预览/移除，协同编辑器字体下拉与设置均可进入）。
- **Agent 工作台对齐 dsh 参考界面**：下载 DeepSeek Harness 源码二次参考（`ui-model-selection` ModelSelect 两级钻取菜单、`ui-sidebar-files` 文件树+预览）——左栏改为三个类型分组（长篇/短篇/剧本）可折叠 → 类型下项目卡两级分类；中栏输入条新增「📋 项目 chip」（原生分组菜单切换项目）与「🔌 模型徽章」（`ui/model-picker-popover.ts` 两级钻取弹层：供应商头+模型列表+思考强度四档滑杆，第二级全部供应商+管理模型）；右栏改为**文件树 + 文件预览**双列（目录展开折叠、文件 cachedRead 预览、根路径跟随当前项目），遥测与记忆折叠到底部。
- **Agent 创作工作台（交互革命）**：对话引导从主界面小弹窗升级为全 leaf 三栏工作台（`ui/agent-workbench-view.ts`，参照协同写作布局）——左栏创作导航（项目列表/八阶段创作链/界面直达）、中栏对话区（固定高度内滚，不再随对话变长；工具调用时间线内嵌；chips+输入框固定底部）、右栏监控面板。旧 `agent-guide-modal` 移除；命令面板「对话引导」、项目页「🤖 Agent 工作台」按钮与新增 Ribbon「bot」图标全部指向工作台；复用已打开叶子时自动重启会话。
- **Agent 全功能操作**：宿主端口扩展（`ui/services/agent-port.ts`）+ 新增 6 个 Harness 工具——`list_chapters`（章节与状态）、`open_chapter`、`get_project_status`（模式/结构/章节统计）、`open_co_writing`、`run_command`（执行插件任意命令：批量建章/一键成文/质检/结算/导出）、`list_commands`；系统提示词升级为「创作生命周期导航」（新建→调研→设定→大纲→正文→质检→结算→导出），Agent 主动判断进度并引导下一步。引擎新增 `updateContext`（左栏切换项目实时生效）与会话遥测。
- **对话 Agent 接入 AI Harness**：下载 DeepSeek Harness 源码研究后，把对话引导从纯规则脚本升级为真 AI 对话——新增 `engine/agent/harness/`（会话日志、受守卫工具注册表、提示词分段组装、「调模型→执行工具→回填→再调模型」循环、JSON 协议适配器），宿主工具集（记忆/项目目录/随机设定/三类项目创建/界面打开/章节/命令）；模型自主收集信息、展示摘要、创建项目并打开向导。有凭据时默认 AI 驱动（顶栏徽标），无凭据/失败时一键降级回原离线逐步引导；单回合 6 步预算防循环。真实 DeepSeek 端到端验证通过（记忆→摘要→创建→向导全链路）。详见 `docs/audits/v4.19-agent-ai-harness-verification.md`。
- **模型快速切换改版**：移除 Obsidian 右下角全局状态栏浮窗（「🔌 提供商 | Flash | Pro」）；新增 `ui/model-quick-switcher.ts` 两级选择器——第一级选 API 供应商（本地/云端图标、当前项勾选、模型数量），第二级选该供应商的模型 ID；选中的模型统一用于规划（flash）与正文（pro）全部任务并自动刷新窗口上限。装配到四个主界面：完整写作工作台 Tab 栏、协同写作顶栏、知识库侧栏、写作指纹库侧栏；命令面板「切换 AI 提供商」与项目页「切换 AI 提供商」按钮复用同一菜单。`updateStatusBarText()` 保留为统一刷新入口，模型/供应商变化时同步所有已装配的切换器。
- **人味提示词 v2**：重写 `human-voice`，从“配额式短句/单句成段”改为自然段 2–6 句、80–220 字；平均句长 20–30 字，长句 10%–20%，对话 25%–45%；明确优先于写作规则里的“一句一段/一段一个句号”。
- **正文与协同提示词**：删除 prompt-builder / co-writer-engine 的“段落极短、每句一个画面、不用过渡”；协同续写从 1–3 句改为 1 个自然段；V1/V2 正文从“每段必须身体感觉+情绪变化”改为“每个场景 2–3 处”，允许过渡段和解释。
- **DEAI 检测与改写**：检测项从“一段多句号违规”改为“段落碎片化/长句缺失/对话干燥/标点单一”；改写提示改为恢复自然段、补足对话和过渡，不再继续切碎。
- **写作规则模板**：内置写作规则去掉“一句一段”“一段一个句号”，改为自然段；`describeBodyFormat` 同步改为“一个自然段写成一行”。
- **正文统计**：新增 `shared/prose-metrics.ts`，统计段长、句长、单句段、短句/长句、对话、标点熵、句首多样性，并输出 0–100 碎片化风险与可解释问题。
- **自然段重排**：新增 `shared/prose-naturalizer.ts`，合并相邻叙述短段、对话与说话人动作并段，保留空行/场景转换/连续对话边界；只改段落边界，不改句子。
- **写入接入**：`BodyWriter` 对 pipeline/batch/auto/continue/scene 默认自然化；manual 与 co-writer 不自动合并；设置页新增「自然段模式」。
- **人味体检**：正文步骤新增「📊 人味体检」，展示风险分、8 项指标、问题列表，并提供自然段重排预览与写回正文。
- **朱雀实测**：完成 6 组对照；人类基线《孔乙己》100% 人工，第一章原文/自然段重排/DeepSeek 网文重写/Gemini 网文重写/新版提示词小样分别为 100% AI、93.95% AI、100% AI、100% AI、100% AI。结论：只靠提示词、分段、换模型无法稳定达到 70% 人工率；详见 `docs/audits/v4.19-agent-entry-humanization-audit.md` 第六节。

### 🧠 长篇故事上下文总线
- **统一信息模型**：新增 `engine/context/story-context-types.ts`，把世界观、设定库、人物/势力/地点/物品、时间线、伏笔、场景卡、情绪弧统一成 `StoryContextNode / StoryContextGraph`。
- **自动关联**：新增 `engine/context/story-context-graph.ts`；场景卡自动关联出场人物/地点/POV/伏笔/情绪，伏笔关联人物与主线，时间线关联实体，设定条目关联被提到的实体；支持名称/别名索引与双向边。
- **去重**：时间线按 `时间|章节|事件|影响` 去重，伏笔按规范化名称去重；真实项目 `九霄逆脉行` 的 24 行时间线 → 6 条、42 行伏笔 → 6 条，只影响装配，不改用户文件。
- **本地/云端双策略**：新增 `engine/context/story-context-service.ts`；本地 4200 tokens 上限、压缩文本、人物 8/设定 6/时间线 8/伏笔 6；云端 24000 tokens 上限、完整文本、人物 24/设定 20/时间线 40/伏笔 24；设置页新增「故事上下文档位」。
- **一键生成接入**：`buildTemplateVars` 用同一张图覆盖 `worldView/settingLib/allChars/allFactions/allLocs/allItems/timelineEvents/unrevealedForeshadow/emotionPlan/sceneCardDigest`，并新增 `${storyContextPack}` 关联摘要。
- **协同写作接入**：`CoWriterEngine` 在初始化、切场景、静态上下文刷新时重建信息包；`PromptBuilder` 在有信息包时停用旧的实体/设定/时间线/伏笔分段，只保留关系状态、跨卷快照、人物灵魂、章节简报、剧情节点与知识注入，避免重复注入。
- **覆盖度面板**：上下文步骤新增「故事上下文包」一行，显示档位、条目数、tokens、必含覆盖、分类覆盖与丢弃数量。
- **真实项目验证**：四种组合（协同/一键 × 本地/云端）必含覆盖均为 100%，缺失 0；本地保留当前场景核心信息并压缩可选项，云端拿到全部 8 人物/11 节设定/6 时间线/6 伏笔/4 场景/4 情绪。详见 `docs/audits/v4.19-story-context-bus-verification.md`。

### 🔌 API 格式与模型自动获取
- **API 设置页重做为两栏「模型设置」界面**（参照 dsh 界面）：左侧按「预设供应商 / 自定义供应商」分组列出全部供应商（图标 + 名称 + 当前启用状态点，选中高亮），右侧是选中供应商的完整配置——可编辑名称、启用开关、`⋯` 更多菜单（切换/删除）、Base URL、API 格式下拉、API Key（带显示/隐藏）、模型列表。底部单独一区是「全局模型分配」（默认/Flash/Pro 模型、上下文与输出上限）。工作台模型弹层、迷你设置、设置页三处入口共用同一套弹窗，界面与行为完全一致。
- **长 URL 完整可见**：Base URL 从单行 `input` 改为自动增高的可换行 `textarea`。旧界面里火山引擎那类 `…/api/v3/chat/completions` 会被窄输入框截掉后半段，现在换行显示全。实测详情区 378px、URL 框 340px。
- **模型列表逐项管理**：每个模型一行——ID + 容量徽标（`1M` / `205K`）+ 视觉标记 + 启用开关 + 编辑 + 删除。关闭的模型保留在列表里但置灰并加删除线，不参与默认/回退候选；「＋ 添加模型」与「🔄 从 URL 获取」并排。模型编辑弹窗可改 ID、上下文窗口、输出上限与是否支持图片。
- **修复一个布局 bug**：初版用 `@container (max-width: 720px)` 做窄屏堆叠，但 Obsidian 设置面板没有为容器建立 `container-type`，容器查询匹配到了外层任意窄容器，导致宽窗口下两栏也被压成上下堆叠（左栏被拉到 602px 全宽）。改为媒体查询并把左栏锁成 `flex: 0 0 208px`。
- **API 格式改为下拉选择**：设置页把原来单一的「OpenAI 兼容端点」输入框拆成 **Base URL** + **API 格式** 两个控件，格式可选 `Anthropic Messages (/v1/messages)`、`Chat Completions (/chat/completions)`、`Responses (/responses)`。Base URL 可带也可不带 `/v1`，实际请求路径由格式推导；历史配置里已写全 `…/chat/completions` 的端点原样复用，旧数据零迁移。
- **协议真的能用（不是只加了个下拉）**：新增 `shared/api-format.ts` 作为协议适配层——请求体、鉴权头、非流式响应、SSE 增量四段全部按格式分派。Anthropic 用 `system` 字段而非 system 消息、鉴权走 `x-api-key` + `anthropic-version`、思考预算按 `budget_tokens < max_tokens` 约束；Responses 用 `instructions` + `input` + `max_output_tokens`，输出从 `output_text`/`output[].content` 读取。`AIApiClient` 的三条调用路径（`callAI`、`callAIStream`、`callAIAsyncIterator`/`nativeStreamIterator`）与连通性测试统一走这套适配。
- **从 URL 自动获取模型**（参照 dsh `llm-pi-ai/discovery.ts`）：模型列表区新增「🔄 从 URL 获取模型」——按当前 Base URL、API 格式与密钥请求 `{root}/models`（Anthropic 为 `{root}/v1/models?limit=1000`），解析 `data[]` 与中转站常见的 `models{}` 富化映射，顺手带回端点披露的上下文窗口与输出上限。结果进入勾选弹窗（`ui/model-picker-modal.ts`）：已配置项默认勾选、支持搜索与全选、**已配置但本次未列出的模型原样保留**、拒绝把列表清空。
- **错误可读**：401/403 提示检查密钥、404 提示该端点可能不提供模型列表、响应非 JSON 与超 2MB 都有明确原因，不会静默返回空数组让人以为端点没模型。
- **添加/编辑提供商表单同步升级**：Base URL、API 格式下拉、以及「🔄 获取」按钮（直接用表单里刚填的地址与密钥探测，不必先保存）。提供商列表接口新增 `apiFormat` 字段。

### 🎨 外观：三层配色重构 + 配色方案
- **颜色配置从 5 层精简到 3 层**：旧版暴露「底色 / 面板色 / 卡片背景色 / 强调色 / 主文字色」五个独立配置，外加 `enableCustomCardBg` 开关又引入一层条件判断；CSS 里 `--nw-surface` 与 `--nw-cover-bg` 还是两套平行背景 token。现在收敛为 **L1 基底**（`--nw-app-bg`）、**L2 卡片**（`--nw-card-bg`）、**L3 强调**（`--nw-accent`）：面板由基底按氛围预设自动派生，文字色按基底亮度自动取深浅，`--nw-surface` 与面板同值。新增 `shared/theme-colors.ts` 承载全部纯函数（hex 校验、WCAG 亮度、文字派生、hover 派生、palette → CSS 变量）。
- **文字色不再需要用户配置**：`deriveTextColors` 按基底相对亮度自动选深/浅两套文字，深色底用亮字、浅色底用暗字；不想要自动结果时仍可展开「覆盖文字色」高级项。
- **主题配色方案（保存 / 一键切换 / 导入导出）**：调好三层颜色后可「💾 保存当前配色」存成命名方案，列表里显示三色色板 + 主题模式，点「应用」一键切换（同时写回 theme 与 themeColors，并清掉旧字段残留）。支持 `📤 导出` 为 JSON、`📥 导入`（单套或数组，非法颜色值丢弃、id 冲突自动换新、同名覆盖、上限 20 套）。新增 `themePresets` 设置字段。
- **性能：取色不再触发全量重渲染**：旧实现每次 `onChange` 都 `await saveSettings()` + `rerender()`，拖动取色器时连续写盘并重建整块 DOM。改为立即注入 CSS 变量、落盘防抖 300ms、不重建 DOM。
- **兼容旧配置**：旧版独立 `panelBg` 继续生效（`legacyPanel` 传入派生逻辑），`cardBg` 直接映射到 L2，升级后外观不回退。

### 🎨 CSS 层级重构 / 面板可拖拽 / 动效统一（2026-10-29 四轮迭代）
- **三层配色真正收尾（第 1 轮）**：上一轮改了代码但没清数据——`data.json` 里残留的 `panelBg`、`textPrimary`、`enableCustomCardBg` 仍在覆盖三层派生结果，所以界面看起来还是 5 层。新增 `schemaVersion 4→5` 迁移：先把旧观感**冻结成一套命名方案「旧配色（v4.21）」**存进 `themePresets`（可一键切回），再删除这三个字段；同时移除设置页第 4 个取色器「覆盖文字色」。现在严格 3 个取色器。`textPrimary` / `legacyPanel` 只存在于方案对象里，由 `resolveActivePresetInput()` 按 `activePresetId` 反查叠加，不再进 `themeColors`。
- **CSS 安全删除（第 2 轮）**：删除工作台整段重复定义（与后一份逐字节相同的 434 行块，仅保留前段独有的 6 条规则）、93 个零引用死类（59 条整规则）、修复被注释截断的畸形选择器列表（`.nw-wizard-root` 误吃 `.novel-writer-modal` 的 padding）、重写 4 处 GBK/UTF-8 损坏注释。**体积 426735 → 410493 字节（-16.2KB），行数 15363 → 14624**，CSS 基线同步收紧。
- **`!important` 层级合并（第 3 轮）**：**192 → 166**。重点是「后来的修复被更早 `!important` 架空」的真实 Bug：`.nw-btn-primary` 的硬编码渐变 + `!important` 抢赢，导致用户改「强调色」后主按钮纹丝不动（`--nw-btn-primary-bg` 现跟随 `--nw-accent` 注入）；`.novel-writer-fw-prompt-area` 的 `padding !important` 让下游 `padding: 14px 18px 24px` 永不生效；`.nw-cowrite-center` 的 `padding !important` 压掉权威定义的 `8px`；`step-nav` 在两个断点重复设 `max-height`（200 vs 190）互相打架。另合并 `.nw-cowrite-header`（6 份）与 `.nw-cowrite-flow-panel`（2 份）重复定义。
- **统一拖拽原语（第 4 轮）**：新增 `ui/panel-resizer.ts`，把原本三套各自为政的实现（工作台 mousedown、协同写作写 ratio、浮窗 pointer）合并为一份：**Pointer Events**（触摸/手写笔 + `setPointerCapture`）、**键盘可达**（`role="separator"` + 方向键微调 + Home 复位）、**双击复位**、尺寸写入 `--nw-panel-size` 作为唯一真源。Agent 工作台已接入，`onClose` 释放监听。
- **面板尺寸可精确调节**：「工作台布局」页新增「📐 面板尺寸」区——写作工作台左右栏宽度数字输入（100–400 / 160–560）＋ 单项恢复默认 ＋ 全部恢复默认。此前这些值只能拖、无法查看；完整写作工作台三栏更写死在 grid 变量里。`--nw-grid-workspace` 改为读 `panelSizes`，并移除 `full-writer-view.ts` 里冲突的重复注入（两处各写一套值，谁后执行谁生效）。
- **动效统一为桌面软件手感**：新增三档时长 token `--nw-dur-fast/base/slow`（120/180/240ms）与统一缓动 `cubic-bezier(0.2, 0.7, 0.3, 1)`。把 >300ms 的一次性动效压缩（2s 脉冲 → 800ms 单次、1s 描线 → 600ms）；**45 处 `transition: all` 全改为具名属性**（background/border/color/shadow/opacity/transform），消除拖拽与布局抖动；常驻 `infinite` 仅保留进度条/打字点/流式光标/计划脉冲。新增 `.nw-list-enter` 错峰入场（40ms 步进）与 `.nw-popover-enter` 浮起；`reduced-motion` 补齐拖拽态与 `backdrop-filter` 降级。
- **补齐上轮遗留盲点（2026-10-29 收尾）**：① **写作工作台三栏改为可拖拽**——原先是 grid + `--nw-grid-workspace`（minmax 区间），宽度只能靠设置页填数字；现改 flex + 左右两条分隔条，拖动即改并写入 `panelSizes`，中栏 `flex:1` 自适应，≤1100px 仍回落纵向堆叠（此时隐藏分隔条并重置两翼宽度）；同时删掉与基础规则冲突的第二处 `display: grid !important`。② **协同写作分隔条接入统一原语**——旧实现是独立的 `mousedown` + 手写文档监听，只支持鼠标且无法键盘操作；现在复用 `createPanelResizer` 的 `percent` 模式（比例仍存 `coWriteEditorWidthRatio`），获得触摸/手写笔、方向键微调、双击复位与 `--nw-cowrite-editor-percent` 单一真源；`.nw-cowrite-resizer` 的重复交互样式收敛为只保留布局差异。③ 全仓反向校验「TS 使用但 CSS 未定义」的类：上轮删除的 31 个类定义中**零个**仍被引用，删除是安全的；剩余未定义类都是结构性容器（如 `.nw-awb-telemetry`），HEAD 版本同样没有，非本轮引入。

### ⚙️ 任务参数调节引擎
- **30 个输入框收敛成 1 个档位**：设置页原本给 6 个任务（规划/正文/分析/质量控制/拆解/指纹）各渲染一张卡片，每张含模型、最大输入、最大输出、思考等级、思考预算 5 个控件，共 30 个，且需要用户自己保证彼此一致（比如输出别超模型能力）。新增 `shared/task-budget-engine.ts`：用户只选一个**预算档位**（省 token / 均衡 / 一般 / 极限）+ 一个思考强度，引擎按任务类别（规划 / 正文 / 分析）乘以各自系数，从模型能力推导出每个任务的输入预算、输出上限与思考预算。
- **默认档与旧行为逐值一致**：`balanced` 档的三个类别系数全为 1，输入 = `context - output × 1.15`（连取整顺序都对齐，避免差 1）。升级不会静默改变生成质量或成本。旧的 `taskBudgets` 手工覆盖仍然优先，设置页会检测并提示「检测到 N 个旧覆盖」，可一键清除交给引擎。
- **只读分发表取代可编辑卡片**：设置页现在用卡片列表展示每个任务的实际模型与三个数字，随档位、强度、模型切换实时刷新；用列表而非表格是因为设置面板通常只有 300–400px 宽，6 列表格必然横向滚动把数字列挤出视野。
- **保留的历史分支**：旧实现里「只有 `thinkingMode` + `thinkingBudget`、没有显式等级/强度」时，预算是直取不缩放、也不自动预留；这个分支在引擎接入后原样保留，避免把「设了 300」悄悄变成「自动分配」。
- **依赖方向**：`task-model → task-budget-engine` 单向。引擎刻意不 import `task-model`（只有类型依赖也会被循环依赖门禁算成环），改用本地 `BudgetLimits` 结构类型。

### 🧬 写作指纹库：V2 持久化 / 作用域 / 向量清理（2026-10-30）
- **融合指纹保存后特征为空（P0）**：`extractV1FeaturesFromV2` 的反向映射解构写反（`[v1Key, v2Key]`），拿 V1 字段名（`features.sentenceRhythm`）去 12 维 V2 对象上查，恒为 `undefined` → 函数永远返回 `{}`。融合出的指纹保存下来只有统计数字、七维风格特征全空。改为 `[v2Key, v1Key]`，并补了「映射写反时必然失败」的回归用例。
- **融合指纹落盘只剩 7 维字符串**：`saveBlendedFingerprint` 先把融合结果投影成 V1 再入库，12 维结构、逐维样本与 `blendSource` 全丢。现在把融合指纹注册进 V2 缓存按 V2 落盘，并用投影合成 `v1Backup` 供 V1 消费方还原。
- **启停一次就降级一次**：三处 `save*` 直接写内存里的 7 维投影，于是每次点「启用/禁用」都把磁盘上的 12 维结构覆盖成 7 维。新增 `toPersistedFingerprint()`：仅当 V1 特征仍与 V2 的投影一致时写回原 V2（只用 name/enabled/tags 等可变字段覆盖），特征被重新提取过则写 V1、等下次加载重新迁移。
- **删除/重载后 V2 缓存不清理**：`v2Fingerprints` 只增不减，已删除的指纹仍会被 12 维检索命中，切换项目后还会读到上一个项目的条目。`collectV2Fingerprints(items, scope)` 先清同作用域条目，三个 `delete*` 同步删除。
- **切换项目后仍读写上一个项目**：视图从不重新绑定项目（`refreshForProject` 没有调用方，旧代码靠 `(lib as any).project = x` 硬改字段）。新增 `StyleFingerprintLibrary.setProject()`（清项目层指纹表 + 项目层 V2 缓存 + 重建项目向量库），视图每次 `loadAllFingerprints` 比对 `activeProject` 后同步，并重建提取器与样章向量库。
- **跨项目复制写错文件**：`copyFingerprint(..., targetProject)` 把副本塞进当前项目的内存表，`saveProject()` 于是写到**当前**项目文件。现在目标项目与绑定项目不同时交给目标项目的实例读盘后写入；复制同时携带 V2 结构。
- **指纹文件签名恒为 `:missing`**：全局/项目指纹都在配置目录，`getAbstractFileByPath` 恒为 null，`computeFingerprintSignature` 永远返回 `:missing`，新增/删除/启停都触发不了 `reloadIfChanged`（协同引擎持另一个实例，内存列表不更新）。`FileSystemPort` 新增可选 `getFileStamp()`（回退 `vault.adapter.stat`），签名改用 mtime + size。
- **一次读失败就把整库抹掉**：`load*` 的 catch 直接清空内存映射，之后任何一次保存都会把空数组写盘。现在区分「文件不存在」（真空库）与「读取/解析失败」（保留内存，损坏文件改名 `.corrupt-<ts>.bak` 留档）。
- **混装文件里已迁移的 V2 被二次迁移成空壳**：`migrateFileV1ToV2` 对数组无条件 `map(migrateV1ToV2)`，V2 条目没有 `sentenceRhythm` → 12 维被覆盖成「全部 pending」。改为逐条 `needsV1ToV2Migration` 判定。
- **详情弹窗开关点了没反应**：Modal 里 `onToggle` 之后又手动 `enabled = !enabled` 翻回去，落盘值仍是翻转前的；重渲染用的还是打开时捕获的旧对象。现在只让调用方翻转，回来后从库里取回最新对象再渲染并重读 V2。
- **全局指纹的开关在项目里不生效**：注入侧读的是「项目级覆盖优先」（`isGlobalEnabledForProject`），列表与详情却直接渲染 `fp.enabled`。列表、详情徽标、工具栏开关统一走生效状态，写入走 `setGlobalEnabledForProject`（无项目时才改全局默认）。
- **界面元素越用越往下掉**：`renderScopeTabs` / `renderSearchAndFilter` / `renderFingerprintList` 都是「删掉再 append」，单独重渲染搜索区会把搜索框挤到指纹列表下方。改为按原位置 `insertBefore`。
- **章节勾选框点不动**：点击复选框时 `change` 记一次选中、`click` 冒泡到行容器又翻回去。行容器点击现在忽略来自复选框的冒泡。
- **融合描述退化成只剩「。」**：单句超过 100 字时 `replace(/[^。！？]*$/,'')` 把整句都当残句删掉。改为优先在最后一个句末标点处截断，没有标点则硬截并补句号。
- **强度配置在无项目时「保存成功」但没落盘**：引擎没有项目时静默 return，弹窗照样提示已保存。弹窗先拦截并提示需要打开项目；`flush()` / `hasPendingWrites` 补上 `intensityConfigWriter`。
- **删除指纹留下孤儿向量文件**：三个 `delete*` 只删库条目，V1/V2 维度向量与样章向量仍在磁盘上、仍可被检索命中。删除时一并清理对应作用域的向量（新增 `deleteFingerprintSamples()`）。

### 🗂️ 知识库：数据面加固 + 导入/监控/详情修复（2026-10-30）
- **索引损坏会清空整个知识库（P0）**：`parseFrontmatter` 把 JSON 解析失败吞成 `{}`，`loadIndex` 只看到「没有 books 数组」→ 内存置空，下一次任何保存都把「0 本书」写盘。现在解析失败或缺少 `books` 字段都会走已有的「从书籍目录重建」路径（坏索引先改名 `.bak-<ts>` 留档）；同时 frontmatter 兼容 CRLF——索引是用户可见的 `.md`，用外部编辑器保存后换行会变 `\r\n`，旧正则直接匹配失败。
- **重建索引后向量化状态/简介/分类推荐全丢**：`saveBookInfo` 用字段白名单写 `基本信息.md`，漏了 `vectorStatus`/`vectorError`/`synopsis`/`genreRecommendations`。索引一旦重建，列表就显示「未向量化」、简介变空、分类推荐消失。已补进白名单。
- **知识库配置读失败就被默认值覆盖**：`KnowledgeBaseConfigManager.load` 的 catch 里直接 `save()`，把用户自定义分类/技法/标签永久抹掉。改为只在「文件确实不存在」时写默认值；解析失败只在内存用默认值，磁盘原文件保留。
- **标签体系读失败会让知识库初始化中断**：`KnowledgeTagManager.init` 不捕获 `load()` 异常。现在读失败退回默认标签继续工作，并把读不到的文件改名 `.corrupt-<ts>.bak` 留档，避免下一次保存覆盖成默认。
- **向量库「全部读失败」被当成空库**：`loadIndex` 先清内存再逐个读，只要有一个成功就返回 true。磁盘占用/同步冲突导致全读失败时，签名被更新成「最新」→ 整段会话的知识检索静默为空且不再重试。改为读进临时表，全部失败时回滚内存并返回 false。
- **批量导入重试会重复建书**：`runTask` 无条件 `addBook`，而自动重试与「重新导入」都会重跑整个任务；失败点在建书之后（写源文件失败等）时，每重试一次就多一本「书名 (2)」。改为复用 `task.bookId`——注入一次写失败实测：旧代码 `addBook` 2 次，新代码 1 次。
- **第二批导入的进度/结果混入上一批**：`startImport` 从不清 `tasks`，进度与 `onComplete` 的数量都按全量统计（第二批显示成 5/8、成功数翻倍）。新批次开始时清掉上一批的终态任务。
- **批次弹窗提前关闭后主视图不刷新**：只有点「完成」才回调 `onComplete`，ESC/✕ 关闭则书籍列表与计数停在导入前。改为 `onClose` 兜底上报一次（幂等）；「查看详情」路径标记已上报，避免刚挂好的详情页被 `onComplete` 的重建抢掉。
- **「选择本地文件」按钮栈溢出**：隐藏的 `input[type=file]` 挂在该按钮内部，`input.click()` 的事件又冒泡回按钮 → 同步递归。input 改挂同级容器。
- **「拆解任务 / 质量统计」每来一次进度就追加一整套 UI**：`handleProgressUpdate` / `handleCompleteRefresh` 直接调 `renderTasksTab()` / `renderStatsTab()`，而它们只 `createDiv` 不清空（最高 60 次/秒）。改为方法内部先 `empty()`；真实 Obsidian E2E 连打三次断言块数恒为 1。
- **拆解监控弹窗的实时刷新完全失效**：tab 容器缺 `data-tab-content`，`updateCurrentTab()` / 无参 `renderHistoryTab()` 的 `querySelector` 恒为 null → 进度条停在打开瞬间，历史页还会在旧列表下面再追加一份。
- **书籍详情：风格页永远为空**：风格指纹文件是 Markdown frontmatter，`KnowledgeDetailModal` 直接 `JSON.parse(content)` 必失败并被吞成 `{}`。改为与其余维度统一走 `loadMarkdownFrontmatter`；顺带修 `getDimensionProgress()` 把 `{}` 算成 100%（完成度图与空数据矛盾）。
- **结构页「结构类型」不显示**：先 `createEl('div', { text: structureType })`，下一行又 `typeCard.textContent = ...` 把子节点清空。改为第二个子节点承载描述。
- **人设搜索框只能输入一个字**：`input` 回调直接 `render()`，整框 `empty()` 重建 → 每敲一个字丢焦点。改为只重绘「全部人物」列表。
- **详情数据被旧请求覆盖**：打开书 A 立刻点 B 时，A 的后半段 `await` 会晚于 B 完成并覆盖 B 的维度数据。新增 `detailLoadSeq` 序号，每步 `await` 后校验过期即放弃。
- **批量「查看详情」点了没反应且锁死列表**：旧实现只设 `selectedBookId` 再调 `renderBookDetail()`（列表态没有详情容器 → 直接 return），而 `selectedBookId` 非空又让列表刷新永久跳过。改为 `loadBooks()` 后走正常入口 `openBookDetail()`。
- **删除书籍 / 重新拆解失败无提示**：两处 `await` 无 `try/catch`，失败留下未处理的 rejection，却仍提示「已开始拆解」并关窗。
- **参考书籍选择重启后丢失**：`referenceBookIds` 只存在插件实例字段，`saveSettings()` 从不落盘；权重滑杆 `adjustReferenceWeight` 是只打日志的空实现。新增设置字段 `referenceBookIds` / `referenceBookWeights`（默认空，深合并兼容旧配置），勾选/设主参考/调权重统一写设置并立即推给引擎与知识注入器；引擎初始化在注入器就位后补一次同步（否则重启后参考书籍注入静默为空），注入器权重改读设置。

### ✍️ 协同写作工作台：丢稿 / 状态串章 / 监控与失败恢复（2026-10-30）
- **采纳建议后切章会丢字（P0）**：`insertTextAndRecord` 直接给 textarea 赋值，不会派发 `input`，而自动保存只挂在 `input` 监听上；`flushBeforeChapterSwitch` 在「没有 pending」时直接放行 → 刚插入的整段文字被新章正文覆盖。新增 `applyProgrammaticEdit()` 统一写入入口（写 value + 光标 + `updateSnapshot` + `markDirty`），改造采纳、知识标签插入、历史回填、AI 修复四处；`BodySaveController.markDirty()` 负责排一次自动保存。
- **采纳建议可重复插入（P0）**：正文同步写入后还有历史落盘 / 预览 / 指标评估多个 `await`，窗口期内再按 Ctrl+1 或双击「接受」会用同一条候选再插一遍。新增 `acceptInFlight` 互斥，并在第一个 `await` 之前清空候选；「✓ 接受」「继续使用」「Tab 幽灵建议」三条入口共用。
- **保存并发被静默丢弃（P0）**：`save()` 遇到在途保存直接返回 false，而切章冲刷在调用前已取消了防抖定时器 → 第一次切章提示失败，用户重试一次就真的丢稿。改为串行链排队（并发请求会补写一次并带上最新正文），`flushBeforeChapterSwitch` 先等在途保存结束再判断；正文与章节身份在 `save()` 入口即快照，排队执行也不会串章。
- **AI 修复用旧全文覆盖正文（P0）**：`handleQualityFix` 请求前保存整篇快照，返回后整篇重建 → 请求期间的输入被抹掉。改为只在「目标区间原文未变」时替换该区间，否则提示未应用；未定位到原文时只追加建议，不覆盖正文。
- **init 失败残留上一章/上一本书的上下文**：`session`、`lastGatheredContext`、`soulData` 只在 try 内赋值，降级后仍指向旧项目 → 实体变更按旧身份入队、主角灵魂串书。现在降级分支同样重建空 session 并清空灵魂层/原始上下文/场景键。
- **并发 init 互相覆盖**：连续打开两章时，先发起的慢 `gatherAll` 会晚到并把 snapshot/session 改回上一章。新增 `initSeq`：每个 `await` 回来后校验代次，过期即整体放弃。
- **待确认实体变更跨章污染**：`pendingStateChanges` 不随 init 清空，切章后上一章的「送入确认队列」按钮仍可点，会用新章身份入队。init 开头清空，切章/清空绑定时同时清空 `warningContainer`。
- **手动联想永久卡死**：`isAssociating` 的复位挂在 `suggestionEpoch` 上，联想在途时按 Tab 会递增代次 → 永远不复位，联想与幽灵建议一起失效。改用独立的 `associationSeq`。
- **本地批量候选漏参考书检索**：本地模式默认走 `tryBatchedCandidates`，该路径既不调用 `getKnowledgePromptParts` 也不记账 → 参考书的风格/节奏/技巧注入在默认路径里静默缺失，UI 还显示上一轮的注入条数。现在批量路径先检索一次（三方向共用），写 `directionKnowledgeCounts` 并 `recordKnowledgeInjection`，检索失败归零不阻塞。
- **改写候选插到错误位置**：视图声明了 `pendingRewriteRange` 却从未写入，采纳一律读当前光标。新增纯函数 `resolveInsertRange()`（`ui/cowrite/insert-range.ts`）：优先用改写区间且校验原文未变，失效则回退当前选区并提示；采纳/取消/重新生成/切章都清空。
- **偏好文件读失败被当空**：解析失败后「采纳一条建议」会用只含新偏好的对象整体覆盖历史。现在区分「文件不存在」与「读取失败」，读失败后首次保存先把原文件改名 `.corrupt-<ts>.bak` 再写新文件。
- **指纹强度配置读失败被清空**：读失败会缓存空对象，随后保存以空对象为基线整体覆盖。现在有内存值时沿用，无值时拒绝保存并提示；文件不存在仍按首次配置正常写入。
- **知识库检索缓存不随数据变化**：缓存签名只有 query + bookIds，重新拆解/改名/换 embedding 后同一会话一直返回旧片段。`KnowledgeBaseManager` 新增 `version`（增删改递增），签名纳入版本与模型不一致数，`setKnowledgeBase` 换源时清空缓存。
- **右侧监控面板四张卡长期空白**：`renderMonitorPanel()` 只在布局时调用一次；实体卡把正文路径拼成 `${project}/${volume}/${chapterName}_正文.md`（真实路径由 `getBodyPath()` 给出）；守卫卡读取从未存在的 `liveAnalysis.issues`。现在实体卡用真实路径，守卫卡改读 `LiveAnalysisController.getGuardSummary()`（OOC 条数/一致性分/实体变更），并在切章、保存、守卫完成后重绘。
- **生成失败看不到原因与重试**：0 建议 + 引擎报错时先 `empty()` 摘掉了错误容器，`showSuggestError` 把内容写进已脱离文档的节点。改为在可见区域重建错误卡（含「重试」）。
- **验证失败永久「验证中…」**：编辑建议后的校验请求没有 catch，失败后原卡片已清空、面板停在加载态。补 `try/catch`，失败渲染可重试的错误卡。
- **标记完稿 / 结算忽略保存结果**：保存失败仍提示成功并打开结算，结算基于磁盘旧正文执行。现在保存失败即中止并提示。
- **字体设置重开不生效**：字体只在下拉 `change` 时应用，`onOpen`/`openChapter` 都不调用。现在两处都恢复，并同步预览层。
- **关闭视图不中止指标评估**：`onClose` 未 abort `metricsAbortController`、未推进 `previewSeq`；`RealtimeQualityController.dispose()` 不关开关，`RealtimeMonitor.dispose()` 不中止在途评估。三处补齐。
- **浮窗切章不清理**：切章后旧章候选卡片仍可点、旧改写区间仍在 → 旧建议会被插进新章。切章时清空候选/幽灵/改写区间并中止在途请求；普通建议生成时清空改写区间。

### 🖥️ 完整写作工作台：写错章节 / 重复结算 / 状态串章（2026-10-30）
- **修正稿写进同卷别的章（P0）**：`writeFixToBody` 把「卷目录」交给 `findChapterFile`，而该函数的标准文件名匹配需要章名，必然失败 → 回退到 frontmatter 扫描，返回该卷**第一个**正文文件。第 3 章的修正稿会整篇覆盖第 1 章。现在按 `项目 + 卷号 + 章号` 精确拼正文路径；回归用例实测旧代码写入 `第1章_正文.md`、新代码写入 `第3章_正文.md`。
- **章节结算重复执行且失败后无限重试（P0）**：结算有两条触发路径（编排器显式 `settle()` + 步骤 10 渲染时自动触发），并发时都会通过「正文未 settled」检查，重复追加伏笔/关系/时间线；而失败会触发重渲染 → 再次自动结算 → 再失败的死循环。现在按「项目+章节目录」合并并发触发、直接读**磁盘**正文 frontmatter 判断已结算、同一章只自动触发一次（失败改为显式「重新结算」按钮）。
- **场景细纲写进切章后的新章（P0）**：`markDirty` 的 1 秒防抖在触发时才读当前章节，用户切章后旧章的场景会覆盖新章的 `Scene展开.md`。现在在 `markDirty` 时捕获所属章节，保存写回它；`loadScenes` 切章前先冲刷未落盘编辑。
- **向导的「全书规划 / 批量建章」可能操作错误项目（P0）**：两个弹窗都没传 `tab.project`，默认选中「检测到的第一个项目」。现在 `PlanBookModal` 支持 `preferredProject`（不在列表时明确提示），`BatchCreateModal` 传入向导项目。
- **取消/失败时用空内容覆盖情绪规划与 Scene 展开**：两个特例步骤不检查空产出，取消后仍落盘并标记完成（空文件覆盖原规划 + 后续误判已完成）。现在空产出不落盘、不标记完成，并提示已取消/重试。
- **批量重跑把旧内容当成功**：`resume=false` 时仍用磁盘上的完成态，某步 AI 失败会沿用旧内容并通过「非空+未截断+已完成」判定。现在强制重跑时从空完成集开始；步骤文件**存在但读不出来**时直接中止本章并报告路径，避免重新生成覆盖原文。
- **一键完成本章的运行条第一步就消失**：进度/暂停/取消条挂在 `tabContent` 内的 `mainContainer` 上，而每一步都会 `empty()` 该容器。现在挂到 Tab 栏与内容区之间（`contentEl`），并新增真实 Obsidian E2E 断言。
- **切换章节/关闭视图不取消一键任务**：编排器持有自己的 AbortController，`onClose` 只 abort 了步骤控制器。现在切章（页签目标变化）、回项目选择、关闭视图都会 `cancel()`，避免用新章 vars 生成、写进旧章目录，或关掉视图后继续烧 AI。
- **运行中重渲染把 `stepResults` 换成新对象**：编排器在 `run()` 开始时捕获了引用，页签重渲染后它的写入落到孤儿对象，界面永远看不到已完成。改为就地清空（引用不变）。
- **上下文加载竞态**：切换 A→B 时 A 的 `gatherAll` 晚到会覆盖 B 的上下文与统计。现在入口快照目标章节，每个 `await` 后校验，过期即丢弃；跨卷快照失败不再让 `loadContext` 抛出。
- **上下文加载失败留下永久空白页**：`renderInContainer` 在 try 之外 `await loadContext()`。现在包进 try，失败渲染错误卡（含重试）。
- **向导结果缓存跨项目串扰且重启不恢复**：Proxy 只在构造时读一次（项目还是空 → global），之后写当前项目 key。现在每次读写按当前项目分桶，切换项目自动换桶、同项目可恢复。
- **设定库「完成检测」与「内容校验」口径不一致 → 永久卡步**：检测器缺模块只 warn 仍返回 true，于是「下一步」校验失败置 `complete_with_warnings`，紧接着状态恢复又翻回 `done`（跳过按钮永远不出现）。现在缺模块返回 false，与 `validateSettingLibOutput` 同口径。
- **模板变量漏兜底**：`context` 为空时 `allChars/allFactions/allLocs/allItems/worldType/worldEra/forbiddenElements/powerSystem/characterCores/timeline/protagonistName` 没有兜底，`${allChars}` 等占位符会原样发给模型。兜底清单已补齐并导出为 `TEMPLATE_VAR_FALLBACK_KEYS` 供契约测试锁定。
- **手动保存步骤结果忽略落盘结果**：`saveStepResult` 返回 false（chapDir 为空/无文件映射/写盘失败）时仍更新内存并提示「已保存」。现在先判返回值，失败直接报错不更新状态。
- **批量流水线的失效传播是空实现**：`invalidateSteps: () => {}` 让「正文变更 → 下游失效」在批量模式静默失效，断点续跑会拿旧分析报告结算新正文。现与工作台同语义。
- **合并规划缺模块时直接失败**：合并只要 infoPlan+outline 完整就返回 success，缺其它模块时不会走单步回退，下一行又硬性判失败。现在无论 success 与否都会补齐缺失规划模块；合并规划保存失败也会从完成集中移除并报错。
- **温度滑杆每次重渲染重置为 1.4**：`renderStepActionBar` 写死 `value`，用户调到 0.8 后任何重渲染都会回到 1.4，下一次生成风格被静默改变。现在记住 `stepTemperature` 并回填。
- **干预可能落到错误步骤且可重复执行**：理解报告基于步骤 N 生成，确认前切到 M 仍会重跑 M；连点确认会并发两次。现在记录报告所属步骤、不一致即拦截，并有执行互斥。
- **实体生成按钮失败后永久禁用**：命令未分发或弹窗没打开时，只挂在「弹窗关闭回调」里的清理永远不执行。现在检查命令返回值 + 5 秒看门狗恢复按钮。
- **快捷工具无防重入**：连点会并发执行同一命令（多个弹窗/多路 AI）。现在 400ms 冷却 + 禁用态。
- **页签标题不更新、跨卷同名章复用错页签、导航栈残留已关闭页签**：复用章节页签时同步 `label`；只有卷一致才复用；`closeTab` 同步清理 `navStack`，`popNav` 跳过已删除页签（否则「返回」后界面空白）。

### 🤖 Agent 创作工作台：项目越界 / 任意命令 / 回合失控（2026-10-30）
- **项目名 `..` 会删掉整库，甚至整个 Vault（P0）**：`newProjectPath` 只剥斜杠，`create_long_project` 又只校验非空；项目名传 `".."` 归一化后等于模式库根、传 `"."` 等于库目录，叠加「同名覆盖」会递归删除旧目录。现在项目名按不可信输入校验（空/`.`/`..`/纯点号一律拒绝并报错），回归用例实测旧实现直接放行。
- **Agent 会静默覆盖已有项目（P0）**：端口把 `confirmOverwrite` 硬编码为 `true`，模型重复调用一次 `create_long_project` 就会删除刚建好的项目（含已写正文）再重建。现在 Agent 永远不覆盖：同名返回「已存在」，让模型换名或先问用户。
- **`run_command` 可执行任意 Obsidian/第三方命令（P0）**：旧实现只要求 `commandId` 非空，registry 未命中还会回退到 `app.commands.executeCommandById`（如 `app:delete-file`）。现在只接受 `novel-writer-*`，且必须命中插件自己的注册表。
- **项目参数可越界读写（P0）**：`resolveProject` 对未命中的显式 project 原样透传，`open_story_settings` 会往 `${project}/.project` 写文件、`list_chapters` 会读任意目录。现在显式参数必须是项目列表里真实存在的条目；记忆里的 `pickedProject` 只接受「库/项目」形状且不含 `.`/`..` 的路径；解析为空时工具直接返回「项目不存在」。
- **关闭/重启工作台不停止回合（P0）**：引擎支持 `signal` 但从未接线，`onClose` 只丢引用 → 关闭后模型调用与工具继续跑、继续建项目/跑命令。现在每个会话一个 `AbortController`，关闭/重启即中止；loop 在每步与每次工具执行前检查。
- **同一工具可在一回合内重复执行**：模型重试/抖动时会连续 `create_*`/`run_command`，副作用被放大（`maxSteps` 最多 6 次）。现在同回合内「同名同参」只执行一次，重复调用返回明确的阻止说明。
- **最后一步工具失败被当成成功**：maxSteps 边界上优先返回模型「动手前」的回复，失败原因被掩盖。现在最后一步工具失败即标记回合失败并带上失败内容。
- **协议解析取全文第一个 `{`**：前言里的花括号会被当成协议（空回复），或把截断的 JSON 原文直接显示给用户；字符串化的 `arguments` 被吞成 `{}`。现在优先代码围栏、逐个候选只认含 `reply/tool/chips` 的对象、支持 JSON 字符串参数；适配器与 loop 共用同一套解析。
- **压缩摘要保留最旧 24k**：会话压缩时 `slice(0, 24000)` 保留的是被删范围的最早部分，最新的已确认决定反而没进摘要就被删除。改为保留最近 24k。
- **「重试」把 `__retry__` 发给模型**：chip 值被当用户消息写入历史，重放实际不生效；chip/项目卡点击还会清空输入草稿。现在控制令牌不上屏、不写历史，「重试」重放上一条用户消息；非键盘提交不清草稿；Shift+Enter 不再发送。
- **会话重启后旧回合写进新会话**：A 的问候/回复/工具行会被渲染进 B 的列表，A 启动失败还会把 B 的引擎置空。现在用 `sessionSeq` 丢弃过期回调。
- **降级到离线引导时项目错误**：`switchToRuleEngine` 用插件活动项目重建上下文，与工作台左栏选中的项目不一致。现在沿用工作台当前项目。
- **Agent 新建项目后视图不同步**：项目 chip/文件树/高亮仍停在旧项目，要手动点一次项目卡（还会多发一条消息）。现在每回合结束后把 `pickedProject` 同步为当前项目。
- **切项目后右栏仍显示上一个项目的文件**：`setActiveProject` 不清预览。现在跨项目时清空预览并停下在途渲染（预览加了代次 token，快速连点两个文件不再互相覆盖）。
- **左栏每回合被重置**：类型分组折叠态存在闭包 class 上、滚动位置也不保留。现在折叠态与滚动位置都随重渲染恢复。
- **短篇/剧本缺前期调研仍「创建成功」**：参数级 `required: true` 只用于展示，工具用空记忆回填后写入空栏并回报成功。现在创建前校验各项，缺项时返回「还缺哪些字段」并引导模型追问。
- **`open_full_writer` 丢弃项目参数**：实际打开的是当前活动项目，工具却回报成功。现在端口接收项目并定位到该项目的第一个未写章节，打开失败会返回 false。
- **`list_chapters` 把读失败当空项目**：模型看到「还没有任何章节」后会继续批量建章。现在抛错由工具层转成失败结果。
- **规则引擎把「不是这个」当确认**：确认词含「是/好/可以」且是子串匹配，否定句会直接创建/覆盖项目。现在确认阶段先排除否定词。
- **结构优先级写反**：记忆里的旧结构覆盖随机设定，落盘的 `structureId` 与随机生成的阶段/基调自相矛盾。现在显式参数 > 随机设定 > 记忆 > 默认。
- **`script.episode-ids` 无上限**：`scenes × shots` 直接双重循环，模型传 1e9 会冻结渲染进程。现在两者都限制在 200。

### 🧩 深度吸收 dsh harness：上下文裁剪 / 超时 / 重复提醒 / 回合内补充 / 危险命令确认（2026-10-30）
- **工具结果确定性裁剪（dsh `compaction-tool-result-pruner`）**：`list_chapters` / `list_commands` / `run_command` 的结果动辄几 KB，每回合都整段发给模型；旧的会话压缩只在 30 轮时做一次整体摘要，中间这些超长结果一直占满上下文。新增 `tool-result-pruner.ts`：超过 6000 字符时保留头 1200 + 尾 1200、中段替换为固定标记。**原事件不改写**，只在 `derive()` 投影时生效（可重放、可审计），并按 Unicode 码点裁剪避免切开 emoji。
- **每回合的裁剪统计进入遥测**：右栏新增「省字符 / 压缩」两格，直接显示这轮省下多少上下文。
- **工具超时策略（dsh `guard/timeout-policy`）**：工具可声明 `timeoutMs`，注册表派生 deadline 并在超时时 abort 派生信号、返回结构化 `TOOL_TIMEOUT` 失败（`create_*` 20s、`list_*` 10–15s、`run_command` 30s）。旧实现里一次挂起的端口调用会把整个回合拖死。
- **重复调用按副作用分级（dsh `guard/repeat-tool-reminder`）**：不再对所有工具「第二次就拦截」——只读工具允许重跑，但在连续 3/5/8 次相同参数时注入一条上下文提醒让模型自己换策略；`write`/`dangerous` 工具仍在第二次拦截。工具元数据（`sideEffect`）同时写进系统提示词，让模型提前知道哪些调用会改数据。
- **回合内补充（dsh agent-loop inbox / steering）**：回合进行中用户再发的话不再被丢弃/阻塞，而是进入收件箱，loop 在下一步调模型前写入会话日志（带「用户在你执行过程中补充」前缀）。回合结束仍未被消费的消息会作为普通用户消息保留到下一轮，不丢失。
- **压力触发的会话压缩（dsh `compaction-basic`）**：压缩不再只看轮次，投影字符数超过 32000（可配 `thresholdChars`）也会触发；摘要调用本身已改为保留最近 24k 内容。
- **危险命令用户确认（dsh `interaction/user-approval`）**：`run_command` 命中批量生成/重建/结算/导出/备份等模式时，必须由用户在弹出的确认框里看到「命令 + 原因」后允许；拒绝即返回失败且不执行；宿主没有确认能力时直接拒绝而不是静默执行。
- **协议与工具目录的可读性**：工具目录新增副作用说明；确认被拒绝、超时、重复拦截都有面向模型的明确文案，避免模型原地重试。

### 🐞 修复
- **API Key 每次重启/更新后失效（2026-10-29，已确认为真 Bug）**：根因是口令派生加密的**重新设定口令**路径。`CryptoService.encrypt()` 走 `ensurePassword(true)` → `requestNewPassword` → 「设定新口令」（两次输入），**不管磁盘上是否已有密文**。于是每次重启后（会话口令只在内存）保存任意密钥，都会让用户再设一个新口令；新口令覆盖会话口令后，此前用旧口令加密的密钥就永久解不开——表现为「更新后 API Key 失效」，而且每重启一次可能再坏一批。真实 `data.json` 里正是混合状态：`deepseek`/`custom-1` 是明文，`catcat`/`volc`/`custom-2`/`custom-3` 是密文。修复：新增 `findExistingCiphertext()` 回调（由 `SettingsService` 从磁盘原始值提供），**只要已有密文，`encrypt` 就必须问「已有口令」而不是「设定新口令」**，并且候选口令必须能通过 GCM 校验解开一条既有密文才被接受（错口令重问一次，不会被设为会话口令）。
- **保存设置会把加密密钥降级成明文（同源问题）**：`encryptIfPlain` 在「没有会话口令」时直接把内存值写回磁盘，而内存值此时已被解密成明文 → 加密配置被静默降级。修复：改为 `resolveSecret()`——密文原样保留；有会话口令则加密；无口令但磁盘原本是密文时，用**已有口令**加密（`encryptStrict`，拿不到就保留旧密文并记日志），**绝不写明文**；只有从未用过口令的字段才沿用旧的明文保存行为。
- **密钥输入框直接把密文显示出来**：未解锁时 `settings.providerKeys[id]` 是 `aes256v2:...`，设置页/统一提供商弹窗/迷你设置三处都把它塞进输入框，用户看到一长串乱码，误编辑还会把密文当新密钥存回去。新增 `shared/secret-display.ts`：密文一律显示为空 + 「已加密 · 输入口令解锁后可修改」，并在留空失焦时不写回（避免把密文清掉）。三处入口统一。
- **「是否已配置 AI」漏判供应商级密钥**：`hasUsableAiCredentials` 只看 `settings.apiKey`。若密钥只存在于 `providerKeys[当前供应商]`（apiKey 被清空或从未同步），会被判成「未配置」，生成入口直接拦截。已补 `providerKeys` 兜底。
- **切换供应商可能丢密钥**：当前端点未登记为供应商时（旧配置/手动改过 endpoint），`switchByEndpoint` 既没有归档旧 `apiKey`，又立刻用新供应商的密钥覆盖它 → 上一个端点的密钥丢失。现在会先尝试按端点找到对应供应商并归档，找不到则记 warn 日志而不是静默覆盖。
- **配套恢复入口**：设置页「API 参数」区新增「密钥加密」一行——显示磁盘上还有几项处于加密状态，提供「输入口令解锁」与「重置口令」两个动作。重置会用新口令重新加密所有可读明文，**解不开的旧密文会被清空并在提示里列出**，让用户知道哪些供应商需要重新填写，而不是让它们停留在「看起来配好了但实际无效」的状态。
- **自定义下拉的文字被垂直裁切（2026-10-29）**：API 格式下拉里「Anthropic Messages」下半截被切掉。实测 `.nw-api-select` 高度 30px（Obsidian 给 `select` 钉死的值）、上下内边距各 8px、边框 0.8px → **内容盒只剩 12.4px**，而 13px 字号的行高是 16.9px，**verticalSlack = -4.5px**，字形底部被裁。修法：给自定义下拉统一 `height: auto`（高度改由「行高 + 内边距 + 边框」自然撑开，随字号自适应）并补 `line-height`。
- **同类排查**：把插件里所有自定义过样式的 `select` 都过了一遍——`.nw-select`（12+15 处）、`.nw-api-select`、`.nw-exec-log-filter`、`.nw-cowrite-font-select`、`.novel-writer-fw-title`、`.novel-writer-fw-chapter-select`。其中 `.nw-select` 原本 `height:32px + line-height:30px`（slack +0.4，勉强）、`.novel-writer-fw-title` 是 16px 字号 + 4px 内距（临界），都已纳入统一的 `height: auto; min-height: 30px` 兜底规则。修复后四条实测 slack：`nw-api-select 0`、`nw-select 0`、`novel-writer-fw-title +2.4`、`novel-writer-fw-chapter-select 0`。新增 E2E 断言「每个自定义下拉的内容盒必须装得下行高」（`slack >= 0`），覆盖设置页与写作工作台两处。
- **知识库侧栏的模型切换器溢出（2026-10-29）**：左栏「🔌 供应商 · 模型」胶囊按钮右半截压到相邻栏目上、图标看着像被切。实测：侧栏固定 200px、header 左右各 12px 内距 → 内容区仅 **175px**，而切换器宽 **236px**，右侧溢出 **48px**。根因是 `.nw-model-switch` 的 `max-width: 280px` 是硬上限、不随容器收缩；同时 `flex-shrink: 0` 在普通块级容器里本就不生效，而 label 作为 flex 子项默认 `min-width: auto` 会撑住父元素，导致 `text-overflow: ellipsis` 也失效。修复：`max-width` 改为 `min(280px, 100%)`、`flex-shrink` 改为允许收缩、label 补 `min-width: 0`。修复后知识库侧栏切换器收敛到 175px（-13px 内收）、指纹库 280px（-20px 内收），超长模型名用省略号。
- **设置行被压成竖排单字（2026-10-29）**：同人考据来源的「最大来源数 / 单源摘录长度」标签渲染成一列竖排单字。根因是 Obsidian 的 `.setting-item-info` 是 `min-width: 0` 的 flex 子项，右侧两个输入框把信息列压到极窄，中文又能在任意字符处断行，于是每个字占一行。修复：① 把该合并标签拆成「最大来源数」「单源摘录长度」两条设置；② 加防御性 CSS——给 `.setting-item-info` 一个 200px 的可读下限并允许整行 wrap，控件放不下时落到下一行，不再压扁标签。**这条守卫必须同时覆盖 `.nw-settings-tab-content`**：设置页容器本身没有 `.nw-scope`（只有各弹窗有），第一版只写 `.nw-scope` 导致守卫完全没生效，E2E 立刻在「Flash 模型（大纲/分析/规划）」（70px）与「Pro 模型（正文/角色/实体）」（25px）两处抓到同样的竖排。
- **下拉菜单文字显示不全 / 没有三角（2026-10-29）**：这是**类级缺陷，不是单个下拉的问题**。三层根因：① Obsidian 全局对 `select` 设了 `appearance: none`，箭头靠 `.dropdown` 类上的 data-URI 背景图画，而插件的自定义类 `.nw-select` / `.nw-api-select` 没有那个类，**根本没有箭头**，文字一路顶到右边缘；② `.nw-select` 的 `padding: 0 12px` 右侧只留 12px，不足以让出箭头位置，且缺 `text-overflow`，长选项（实测「默认（doubao-seed-2-0-pro-260215）」溢出 3px）被切在笔画中间；③ Obsidian 给 select 设了 **`background-blend-mode: hard-light`**，自绘的灰色箭头与背景色混合后完全不可见（这也是上一版两个渐变三角形混成畸形「↖」的原因）。修复：两个下拉类各自内联一个 URL 编码的 SVG chevron，显式 `background-blend-mode: normal`，右侧统一留 30px 并加省略号；`.nw-api-select` 的两个重复定义块合并为一份；API 格式选项 label 从「Chat Completions (/chat/completions)」（36 字符）改为短名「Chat Completions」，路径移到提示行与 `title`，在 240px 窄面板下从溢出 38px 变为零溢出。另修 `.novel-writer-fw-title`（`background` 简写重置箭头图）与 `.novel-writer-fw-chapter-select`（`padding: 0 10px` 覆盖了 30px 右内边距），并用 `select.nw-select` 提升一格特异性统一兜住各业务变体的 padding 覆盖。新增 E2E 断言：全部自定义下拉都必须有可见箭头、`blend-mode: normal`、且文字要么放得下要么用省略号。
- **规则版本「重新检查」重复生成模块（2026-10-29）**：`renderRulesSection()` 每次执行都 `tabContent.createEl('section')` 追加新节点，而「🔄 重新检查」按钮的回调正是调用它本身——每点一次就多出一整块重复的规则模块。拆成 `renderRulesSection()`（只建一个 section 并委托）与 `mountRulesSection(section)`（先 `section.empty()` 再渲染内容），按钮改为重绘本容器。同时全仓排查了同类写法：设置页 18 个 `render*Section` 中只有这一处自调用，另加静态测试锁定「事件回调不得调用 render*Section」与「每个 section 渲染方法都必须从 tabContent 起容器」。真实 Obsidian E2E 连点 3 次验证 section 数恒为 1。
- **Agent 工作台「设置」入口点不动（2026-10-29）**：左栏「界面直达 → ⚙️ 设置」调用的是 `novel-writer-open-settings`，但该 id 从未注册过任何命令，`executeCommand` 静默回退到 Obsidian 路由并返回 false，表现为点击无反应。现在补成真实命令：`CommandIds.OPEN_SETTINGS` 进命令定义表、内部 Registry、Obsidian 命令面板与 UI 执行器，新增 `plugin.openPluginSettings()`（走 `app.setting.open()/openTabById(manifest.id)`，不可用时提示手动进入），工作台按钮与欢迎弹窗共用同一实现；Agent 的 `list_commands` / `run_command` 也因此可以打开设置页。新增真实 Obsidian E2E 用例回归该入口。
- **Agent 章节进度误识别（2026-10-29）**：`批量建章` 会为规划中的每一章创建正文骨架（`status: pending`、`word_count: 0`、约 300 字节），旧逻辑把「存在正文文件」等同于「已写」，于是只写了 1 章的项目被读成「共 400 章、最新第400章」，Agent 还会直接打开第399章续写。新增 `shared/chapter-progress.ts` 统一判定口径：只有 `status` 为 `written/settled` 才算已写；`pending/draft` 或体量低于 1500 字节一律视为待写骨架；无 `status` 的旧文件按体量兜底；「最新已写章 / 建议续写章」只在已写章节中计算。`ChapterListEntry` 增加 `written/size`，`list_chapters` 与 `get_project_status` 改为输出「规划 N 章；已写 X 章；待写骨架 Y 章；最新已写：…；建议接下来写：…」，系统提示词新增【进度判定（重要，别数错）】。真实项目 `九霄逆脉行` 验证：400 个正文文件中 399 个骨架不计入，结果为已写 1 章 / 待写骨架 399 / 最新第1章 / 建议第2章。

### ✅ 验证
- `typecheck` / `lint` / `test` / `preflight` / `build` / `check:release` 全绿。
- **425 个测试文件 / 4995 个用例全部通过**。
- 真实 Obsidian E2E 19 passed（隔离 userData + CDP；新增覆盖设置入口、API 格式下拉、外观三层、规则不重复渲染、下拉箭头与不截断、两处面板拖拽、指纹库页签顺序与启停翻转、知识库任务/统计页不重复追加、协同写作程序化写入落盘与字体恢复、完整写作工作台运行进度条不被重渲染清掉、Agent 工作台 chip 不清草稿与令牌不上屏）。
- 新增 `prose-metrics.test.ts`、`prose-naturalizer.test.ts`、`story-context.test.ts`、`story-context-prompt.test.ts`、`template-vars-story-context.test.ts`、`model-quick-switcher.test.ts`、`agent-harness.test.ts`、`chapter-progress.test.ts`、`harness-plan-compaction.test.ts`、`preview-and-font.test.ts`、`fingerprint-library-persist-guard.test.ts`（13 条）、`knowledge-base-integrity.test.ts`（9 条）、`full-writer-data-safety.test.ts`（7 条）、`full-writer-view-contracts.test.ts`（9 条）、`agent-harness-safety.test.ts`（24 条）、`dsh-absorption.test.ts`（11 条）、`co-writer-init-and-batch.test.ts`（6 条）、`cowrite-persistence-guards.test.ts`（8 条）、`cowrite-insert-range.test.ts`（6 条）、`api-format.test.ts`（35 条）、`model-discovery.test.ts`（17 条）、`api-format-wiring.test.ts`（9 条）、`theme-colors.test.ts`（30 条）、`settings-no-duplicate-render.test.ts`（11 条）、`panel-resizer-and-motion.test.ts`（15 条）、`task-budget-engine.test.ts`（24 条）、`secret-display.test.ts`（5 条）与 BodyWriter 自然化测试；CSS 新增 `nw-humanize-*`、`nw-model-switch`、`nw-agent-mode-badge`、`nw-model-fetch-*`、`nw-api-*`（模型设置两栏）类并显式更新基线。

## 4.19.0 — 2026-10-26

> 发布说明：`docs/releases/v4.19.0.md` · 上一版本 v4.18.0

### 🧭 动因
- 原插件只有长篇小说模式；短篇与短剧是两套不同的商业内容形态，不能直接复用长篇节奏。
- 需要把番茄短篇分类、红果短剧规格、项目/章节/导出分支做成独立模式体系，同时保证长篇零回归。

### ✨ 改动
- **创作模式领域层**：新增 `shared/creation-mode.ts`，定义长篇/短篇/剧本的单元、字数（短篇/剧本 5–10 万）、目标数量、24 个番茄短篇分类、12 个红果短剧类型与平台规格。
- **项目创建**：长篇、短篇、剧本使用独立创建入口；通用「新建项目」收敛为长篇/同人，短篇/剧本入口先进入「前期调研」。
- **前期调研**：新增短篇/剧本独立调研模块，输出 `00-前期调研/调研数据.json`、`调研报告.md` 与 `五维分类.md`/`剧本定位.md`，不混入长篇 11 步。
- **写作配置**：`WritingProfile` 增加 `creationMode/shortCategory/scriptGenre/targetWords/targetUnits`，旧配置按长篇兼容。
- **提示词分支**：`template-vars-builder` 读取模式并生成 `creationModePrompt`；`getStepTemplateAuto` 仅对短篇/剧本追加模式硬约束，长篇提示词完全不变。
- **协同写作**：`CoWriterEngine` 初始化时读取 `.project`，把模式约束注入续写/联想/改写/迭代 prompt；长篇为空块，原协同行为不变。
- **内容隔离**：新增左侧「长篇小说 / 短篇小说 / 剧本」分类导航；三类项目按 `.project` 模式过滤，列表与右侧工具互不混入。
- **独立目录**：短篇写入 `短篇创作/`（故事核/分节大纲/正文/质检/导出），剧本写入 `剧本创作/`（人物与场景/分集大纲/剧本/分镜/质检/导出）；新项目不再创建长篇 `03-大纲与章节`。
- **专属卡片**：短篇/剧本卡片改为「前期调研 / 写作 / 全部节/集」等专属操作，移除长篇向导/句级协同等不适用按钮，并显示节/集进度。
- **模板骨架**：短篇/剧本正文模板使用「第N节/第N集」显示与场景/节目标结构；新项目文件名使用 `第NN节.md` / `第NN集.md`。
- **章节管理**：`BatchCreateModal` 在短篇/剧本模式下只在模式正文目录创建单元骨架，不写长篇步骤文件，并默认当前选中项目。
- **快捷工具**：项目卡片选中后自动读取项目类型，右侧切换为长篇/短篇/剧本专属工具与项目操作；短篇/剧本不再显示全书规划、批量建章、章节结算等长篇动作，并补充故事核/分节大纲/场景圣经/分集大纲/分镜表入口。
- **导出适配**：短篇按「节」、剧本按「集」导出；导出与列表均读取模式独立目录，不触长篇章节；长篇导出逻辑不变。
- **API 连通性**：设置页新增「测试连通性」，最小请求验证端点/鉴权/模型/延迟；401/404/429/5xx/超时/空响应分级告警，不记录密钥。
- **思考强度**：新增极速/标准/深度/极限四级与 0–100% 拖拽滑杆；按强度缩放思考预算，任务级可覆盖，旧 `thinkingMode/thinkingBudget` 兼容。
- **流程规范**：新增三类流程细化、短篇三步快速流程、剧本分镜场全流程文档，包含输入/输出/交付标准/校验节点。
- **三域隔离**：新增 `domains/` 命名空间与 `长篇小说/短篇小说/剧本` 模式库；长篇工具/创建弹窗移除短篇剧本逻辑，短篇剧本创建独立成域；项目定位、导出与迁移支持三库。
- **项目迁移**：新增 legacy 项目迁移服务与设置页「项目库迁移」，支持 dry-run、备份清单、冲突检测。
- **Harness MVP**：新增规则引擎、上下文聚合器、结构化输出契约、单次调用 Runner 与调用账本。
- **长篇单调用**：AI 消痕、迭代精修、定向修订改为一次逻辑调用完成；调用账本区分逻辑调用与网络调用。
- **AI 前期调研**：短篇/剧本调研弹窗新增「AI 前期调研」与「随机灵感」；结合热点素材、固化创作框架与多层真随机因子生成 3 个候选方向。
- **随机种子卡片**：随机灵感升级为统一种子卡片，支持查看/复制/重置；短篇与剧本共用同一视觉组件与交互。
- **真随机机制**：新增 CSPRNG 随机源与四层随机因子（前提/结构/质感/差异化），每次生成非重复；随机因子与禁用套路写入调研产物。
- **调研产物**：`00-前期调研/` 新增 AI 调研章节，记录实时来源/未核实标记、固化框架、随机种子与因子；保存前自动备份旧报告。
- **Harness M1**：新增 PromptArtifact、ContextPack（required 保护）、RetrievalPlan/RagCitation、MemoryStore（pending→confirmed）、ToolRegistry 与三域 HarnessProfile；SingleCallRunner 支持编译产物接入。
- **指纹/知识库布局**：两个视图改为容器查询响应式布局，窄面板自动纵向排列；修复指纹列表计数重复累积，统计卡片段长单位改为“字”。
- **指纹统计口径**：新增 `engine/fingerprint-stats.ts`；分号不再算句末、网文单行按段统计、修复英文引号重复计数，并补齐弯引号。
- **自动分类**：新增 `shared/content-classifier.ts`，按节奏/语言/情绪/对话/结构/题材/技法/商业/受众九维规则归类；指纹与书籍均显示分类徽章，支持单条“自动归类/维度归类”与知识库“批量归类”，标签统一 `分类:` 前缀并按 30 条上限去重。
- **混合检索**：新增统一关键词分词 `shared/keyword-tokens.ts`；指纹相似度叠加关键词/标签重排并去重；知识检索按 90% 向量 + 10% 关键词覆盖率打分后再去重截断。
- **错误态**：指纹库与知识库的列表/详情加载失败均显示原因与重试入口，不再空白或卡在加载中；重载后清理失效选中项。
- **执行流程交互**：新增主区域“执行流程”时间线，按时间展示上下文加载、步骤开始/完成/失败、警告与 AI 进度；移除一键完成/逐步完成过程中的浮动 Notice。
- **统一错误模型**：新增 `shared/execution-events.ts`；两种执行模式共用同一套失败分类、缺失项、处理建议与“重试本步”入口，错误卡直接显示在对应步骤位置。
- **固定日志窗口**：新增可展开/收起的执行日志面板，支持按级别筛选、滚动查看、复制与堆栈展开；日志/事件均有上限，长时间运行不无限增长。
- **提示词与结果展示**：系统/用户提示词改为默认折叠并显示字数；执行结果移到提示词之前，以预览优先、原文折叠编辑的方式展示；模板骨架不再伪装成结果。
- **步骤排版**：新增置顶操作栏（状态徽章 + 重新生成/生成此步 + 跳过 + 温度），无需滚过提示词即可执行；按钮改为紧凑胶囊样式，移除整行长条按钮与正文页的大块协同营销卡。
- **信息规划模板**：系统提示词改为逐项 Markdown 标签格式，明确要求独立的“冲突强度：N/5”行；用户提示词同步量化指标格式，降低重新生成后仍缺字段的概率。
- **错误误判修复**：信息规划校验接受“冲突强度 4/5”“四星/五级”等写法；合并规划提示词补齐 `INFO_PLAN` 的结构标签，减少一键模式因格式差异反复中断。
- **长篇故事结构**：新增起承转合、三幕式、五幕式、英雄之旅、序破急五套结构模板；每套包含阶段比例、关键节点与不可违反的结构规则。
- **故事创作设置**：项目创建新增主角起点、核心冲突、力量体系、金手指、人物原型、主角性格、叙事基调、感情线、推进节奏九组选项与一句话故事；组合冲突实时提示。
- **智能随机选配**：新增 CSPRNG 随机组合器，按结构/题材权重抽样，并逐项校验科技+血脉、系统流+非系统等矛盾；随机锁定结构时可只换设定。
- **创建与向导整合**：故事结构写入 `.project`、`00-系统模板/故事结构指南.md` 与创作模式指南，并通过 `creationModePrompt` 注入后续全部步骤；长篇向导第一步新增「故事结构」，项目卡片显示结构徽章。
- **CSS 设计系统 v2**：新增统一表面/输入/焦点/触控令牌；通用按钮、输入框、选择器补齐 focus-visible、tactile 与 reduced-motion 规则；故事结构面板改为双栏分组 + 阶段比例轨道，适配 960/760/520 三档宽度。
- **叙事模式切换**：移除章节状态栏固定的“起承转合”默认值，改为五套结构下拉选择；切换写入 `.project` 并同步故事结构指南/创作模式指南，生成中禁止切换，后续步骤立即使用新提示词。
- **场景描写融合**：整章正文模板新增场景描写硬约束（地点/时间/感官钩子/身体反应/场景过渡）；协同写作新增「🎬 场景描写」动作，description 方向强制使用当前 Scene 卡，不推进剧情。
- **对话引导 Agent**：新增 `engine/agent/`（类型、会话引擎）与 `ui/agent-guide-modal.ts`；命令面板与项目与章节页均可进入；最前端先选长篇/短篇/剧本，长篇再分原创/同人两条专属路径。
- **四类专属引导**：长篇原创（频道/题材/结构/基调/金手指）、长篇同人（原作/同人类型/改动边界/结构/基调）、短篇（平台分类/一句话故事/冲突/情绪承诺/反转/结尾/角色核心）、剧本（类型/logline/3 秒钩子/冲突/兑现/角色/场景/集数/付费卡点）。
- **短篇/剧本闭环**：Agent 直接调用 DomainProjectFactory 创建项目并写入 `00-前期调研`，不再要求用户打开长表单；创建后可继续编辑前期调研或进入工作台。
- **引导式选择**：关键节点（类型、原创/同人、频道、结构、短篇分类、剧本类型等）改为选择卡，展示预期效果、适用场景、风险与操作预览；支持逐项选择。
- **双执行模式**：新增引导模式/自动模式；引导模式每步确认，自动模式用 CSPRNG 自洽随机与默认值填完剩余参数并直接创建；可随时输入「自动完成」或「切换模式」无缝切换。
- **自动链路**：自动模式覆盖类型→路径→参数→创建→打开工作区，无需逐步输入；长篇创建后仍进入原有项目向导，短篇/剧本写入前期调研并打开工作台。
- **Agent 入口**：项目与章节页顶部新增固定工具栏「🤖 对话引导」；空态、命令面板、项目页三处入口，现有项目也可直接进入。
- **人类写作节奏**：新增 human-voice 约束块，注入 V1/V2 正文、协同写作句级 system 与 DEAI 单次改写；强调句长/段长起伏、具体细节、情绪行为化、去总结/排比/比喻链。
- **测试**：新增人类写作节奏注入测试，Agent 单测/ E2E 覆盖引导与自动双模式。
- **NLU 与回退**：新增 `ui/services/agent-nlu.ts`，自由文本优先走一次 AI 槽位解析；失败时回退 chips/序号/关键词，不阻断流程；`__random__`/`__skip__` 哨兵值直接生效。
- **创建服务复用**：新增 `ui/services/project-create-service.ts`，表单弹窗与对话 Agent 共用项目创建、模板复制、`.project`/指南写入、写作配置与工作台打开；覆盖确认由调用方注入，避免 UI service 反向依赖。
- **测试**：新增创作模式、分类、红果规格、元数据、提示词注入、导出单元标签、前期调研、模式工具目录、独立内容结构、API 连通性、思考强度、三域隔离、项目定位、harness MVP、AI 辅助创作、Harness M1 契约、内容自动分类、关键词分词、指纹统计、执行事件/日志账本、故事结构、场景描写注入与对话引导测试。

### ✅ 验证
- `typecheck` / `lint` / `test` / `preflight` / `build` / `check:release` 全绿。
- **397 个测试文件 / 4604 个用例全部通过**。
- 运行时验证：三模式库创建、分类切换、批量建节/建集、导出、迁移 dry-run、长篇单调用入口均通过；长篇回归正常。
- 压力基线：5000 指纹分类 19.0ms、2000 书籍分类 6.1ms、30 万字符分词 7.2ms。
- 未做真实 Obsidian GUI 点击验收（需退出当前 Obsidian 才能启动 E2E），详见 `docs/audits/v4.19-fingerprint-knowledge-optimization-verification.md`。

## 4.18.0 — 2026-10-26

> 发布说明：`docs/releases/v4.18.0.md` · 上一版本 v4.17.0

### 🧭 动因
- 脑洞构思、黄金开篇的“导出为项目”只建了一个空目录，没有 `.project`、模板和写作配置；项目名来自 `slice(0,10)`，可能为空或不可读。
- 项目重命名入口藏在命令面板；顶层项目重命名还会把父目录算成自身，生成 `旧名/新名`。
- 全书简介每次删除旧文件再创建，失败即丢稿；只保留一版，无法比较。
- 同人设定可以凭模型记忆生成并直接绑定，没有来源分级、没有人工审核门禁，也不区分原著与衍生作品。
- 文笔风格蒸馏只输入书名，不能基于真实样本分析。

### ✨ 改动
- **同人考据来源分级**：新增 `shared/canon-source.ts`；官方/官方 Wiki/参考资料/衍生/未知五级；同人、改编、外传、动画影视游戏等默认排除；无官方来源时禁止生成事实内容。
- **联网考据**：新增 `services/canon-research-service.ts`；支持手动官方 URL/摘录与 Bing/Brave/Serper/Tavily 搜索 API；来源缓存到 `05-同人设定库/_资料/{作品}/sources.json`；只保存引用元数据与短摘录。
- **生成草稿**：同人设定生成改为先检索/导入官方来源；无依据字段写“待核实”；草稿写入 `_待审核/`，`审核状态: pending`，不自动绑定项目。
- **人工审核硬门禁**：新增 `ui/fanfic-review-modal.ts`；逐字段展示来源、未核实字段、衍生来源告警；四项检查全部勾选且无阻断错误才能通过；通过后写审核记录、来源哈希并绑定项目。
- **读取侧拒绝未审核**：`shared/fanfic-rules.ts` 增加 `reviewStatus`；`pending/rejected` 返回 `unreviewed`，协同写作不注入同人约束；旧文件无状态按 legacy 兼容并提示重新审核。
- **补全与审核工具**：规则审核 0 次 AI；AI 审核/补全必须只引用已选官方来源；补全后回到 `pending`，必须重新人工审核；衍生来源直接阻断。
- **项目重命名**：新增 `services/project-rename-service.ts`，同步 `.project`、世界观 frontmatter、写作配置、`data/{old}-preferences.json`、`data/{old}-style-patterns.json`；修复顶层项目父路径 bug；项目卡片与右侧操作区露出入口。
- **脑洞/黄金开篇**：不再自建空项目；统一走 `CreateProjectModal` 预填真实创建；脑洞增加 `titleCandidates` 书名候选，可保存到当前项目；黄金开篇输出到 `04-项目总控/黄金开篇.md`；脑洞“换一批”保留关键词/类型/额外要求，单批改为 10 条降低 JSON 截断。
- **全书简介多版本**：新增 `shared/synopsis-spec.ts`、`services/synopsis-store.ts`；一次生成悬念/爽点/人物/世界观四版；目录 `04-项目总控/全书简介/` + `index.json` + 草稿；切换项目自动保存草稿；生成永不覆盖；采用版本同步 `全书简介.md`；旧单文件自动导入。
- **文笔风格蒸馏**：支持粘贴样本、当前项目章节、当前文件、书名四种来源；样本模式强制原文证据，书名模式标注模型记忆不可靠；预览后再保存；使用任务级模型预算与 abort。
- **GitHub 参数统一**：新增 `shared/github-repo.ts` 作为 owner/repo/branch/API/Web 地址单一真相源；package/manifest/更新检查/User-Agent/设置占位全部对齐 `Moxifeng11/novel-writer-ai`（分支 `master`）。
- **私有仓库更新检查**：新增 GitHub Token 设置（加密保存）；Release API 支持 `Authorization: Bearer`；无 Token 时对 Private 仓库仍会 404。
- **自动重命名统一**：世界观生成/AI 世界元素生成的项目自动重命名改走 `ProjectRenameService`，同步 `.project`、世界观 frontmatter、写作配置与插件偏好；项目名先经过统一校验。
- **旧仓库名迁移**：默认 GitHub 仓库统一为 `Moxifeng11/novel-writer-ai`；启动时把旧 `trae-ai/novel-writer-ai` 迁移并清空旧 404 缓存。
- **覆盖写保护**：世界观、跨卷快照、信息债看板、诊断报告等从 delete+create 改为 modify 优先，写盘失败不再先删旧文件。
- **分卷大纲备份**：AI 全书规划重新生成前先备份旧分卷大纲；备份失败则保留旧文件，不再先清空。
- **同人考据 URL 安全**：只允许 http/https，拒绝 file://、本机与内网地址。
- **更新缓存版本对齐**：`UpdateChecker.getLastCheckResult()` 在插件升级后会按当前 `PLUGIN_VERSION` 纠正旧缓存的 `currentVersion` 并重算 `hasUpdate`；只有错误结果且无 `latestVersion` 时才触发新检查。
- **指纹 embedding 设置优先级**：`createFingerprintEmbedding()` 有显式向量设置时优先按当前设置构造，避免共享 provider 仍是旧模型时写入旧 modelId/维度，导致指纹检索被治理逻辑跳过。
- **设置页任务参数布局**：任务级参数从 Obsidian `setting-item-control` 的 5 控件横排改为卡片 + `nw-form-grid` 分栏；修复 688px 宽度下控件换行、右侧截断和“看起来多出全局思考模式”的问题；任务级思考改名为“思考覆盖（跟随全局）”。
- **数据安全回归**：全书简介改为原地修改 + 备份，不再 delete 后 create；分析报告无结构化指令时回退 AI；逐步执行在每步前检查 abort；本地 AI 队列增加等待超时。
- **快捷工具审计**：新增 `docs/audits/v4.18-quick-tools-health.md`，区分可用/已修/待审计/旧版，并列出后续 P2。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿；构建版本 v4.18.0。
- `npm test`：**367 个测试文件 / 4416 个用例全部通过**。
- 新增来源分级、同人审核门禁、AI 报告回退、项目重命名迁移、简介多版本、项目名校验等回归测试。

## 4.17.0 — 2026-10-26

> 发布说明：`docs/releases/v4.17.0.md` · 上一版本 v4.16.0

### 🧭 动因
- 11 步中 8 步调用 AI，典型一章 8 次逻辑调用；5 个规划步骤重复注入同一批上下文。
- 部分步骤产出没有下游消费者：情节蒸馏不进 V1/sceneExpand，质量控制是死胡同。
- 分析报告已经产出结算指令，`AnalysisReportEngine` 又用 2 次 AI 重复抽取实体/时间线。
- 整章需要 9–19 次点击，没有“一次跑完剩余步骤、但每步仍可见”的入口。
- 协同写作本地模式一次建议串行 3 次、一次改写串行 3 次；幽灵、守卫、验证同抢一个 Ollama 槽。

### ✨ 改动
- **单章一键编排**：新增 `ChapterOrchestrator`、标题栏“🚀 一键完成本章（剩余 N 步）”、运行条暂停/继续/取消；每步仍可见、可编辑、可单独重生成；失败停在失败步骤，断点续跑。
- **推荐模式 4 次调用**：5 个规划步骤全部未完成时走 `executePlanningCombined`（1 次产出 5 份结果），随后正文/质量控制/分析报告各 1 次，结算 0 次；逐步模式仍 8 次。合并规划补 `signal`/`force`/逐模块 `StepRunMeta`，失败按缺失模块回退。
- **规划完整性**：5 步缺任意一步即停在规划，不再带残缺规划进入正文。
- **结算幂等**：`status: settled` 时默认拒绝重复追加；仅“重新结算”传 `force`；结算前检查分析报告是否含有效指令。
- **信息流补齐**：`plotDistill` 注入 V1 与 sceneExpand；`qualityControl` 的 ❌/⚠️ 行注入分析报告；`infoPlan` 注入大纲；保存的 `characterSoul` 可回填 V2 主角详情。
- **分析去重**：新增 `AnalysisReportEngine.analyzeFromReport()`，已有步骤 9 报告时 0 次 AI；缺报告才走 AI。
- **任务预算**：emotionPlan / sceneExpand 补任务 `maxTokens` 与 abort；SceneGenerationLoop 改用 body 任务模型。
- **协同候选批量**：本地模式一次调用返回 3 个方向候选；解析失败/不足 2 条自动回退原 3 次串行；云端可并行或关闭批量。
- **协同改写批量**：`rewriteSelection` 一次返回 3 个方向改写，失败回退。
- **幽灵节流**：只取 1 个最强 hint，句末/段末触发，间隔 8 秒。
- **守卫节流**：输入/插入/保存共用“增长 300 字或冷却 5 分钟”闸门；手动检查不受限。
- **本地串行队列**：新增 `shared/local-ai-queue.ts`，建议/幽灵/守卫/验证串行排队，避免抢 Ollama 单槽。
- **本地参数与路由**：首次调用探测 `num_ctx`；批量 JSON 用更高 maxTokens；UI 质量修复走协同模型；编辑验证/OOC 支持 abort。
- **可视化**：新增 `docs/analysis/v4.17-pipeline-efficiency.html`，含流水线、调用/点击账单、协同审计、验证与边界。
- **本地评估**：新增 `npm run eval:cowrite-local`，无 Ollama 时跳过，有模型时验证 3 候选/3 改写 JSON 与耗时。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿。
- `npm test`：**354 个测试文件 / 4371 个用例全部通过**；构建版本 v4.17.0。
- 本地 Ollama（`deepseek-r1:7b`）实测：3 候选 1 次调用约 16.3s、3 改写 1 次调用约 31.6s，JSON 均合法，失败 0/2。
- 新增编排器、协同批量、分析复用等回归测试。

## 4.16.0 — 2026-10-26

> 发布说明：`docs/releases/v4.16.0.md` · 上一版本 v4.15.0

### 🧭 动因
- 能生成完整章节，但达不到精品要求：场景没有可执行契约，正文生成期缺少工艺硬约束，AI 味只在事后检测。
- 设定/伏笔/关系已有数据，但人物“在哪、知道什么、关系如何”没有逐章快照，下一章仍靠叙事摘要漂移。
- 11 步正文只拿到指纹特征文本，没有真实 prose 样章；知识库导入指纹的样章也未向量化。
- 质量报告是自由 Markdown，旧 fix 是泛化重写；没有按维度、按片段的修订。
- 承诺与角色弧线没有账本，规划/分析/结算无法形成义务闭环。
- 没有 good/bad 基准样章评估，“改完是否更好”无法回答。

### ✨ 改动
- **场景卡**：sceneExpand 新增 `pov/time/location/entry_state/turn/exit_state/craft_notes`；解析、编辑器、逐场景正文任务卡、组合规划/模板管理器同步；保留旧文件兼容（缺字段告警不阻断）。
- **工艺约束**：新增 `engine/craft-constraints.ts`；正文 V1/V2、场景展开、逐场景正文的 system prompt 注入具体性配额、情绪行为化、对话纪律、场景转折、POV 纪律、负面清单。
- **正文样章 few-shot**：新增 `engine/style/style-sample-service.ts`；指纹新增/复制/融合/重建自动向量化样章；11 步正文通过 `systemTail` 注入真实样章，不被预算裁掉；V2 补回 `sceneStyleSnippet/suggestedRhythm`；知识库导入只接受真实原文样章，不再把拆解报告段落当 prose。
- **强弱对照**：新增 `00-系统模板/写作对照库.md` 与 `shared/contrast-library.ts`；按场景类型注入最多一对 weak/strong。
- **世界状态快照**：新增每章 `04-项目总控/章节状态快照/第N章_状态快照.md`，含人物状态/关系/时间地点/未兑现承诺/未回收伏笔；结算链路（工作台/批量/协同）写入，下一章 V1/V2 system prompt 以硬约束注入；修复 `SettlementService` 传空分析报告的问题。
- **定向修订**：新增 `engine/revision/*`：质量报告 → 结构化 issues → 按维度选择最多 3 个 pass → 定位段落/场景局部替换；评分下降/返回空/说明文本自动回滚；正文步骤新增“🎯 定向修订”按钮；旧 `iterativeRefine` 的字面占位符已清理。
- **承诺账本**：新增 `02-时间线与伏笔/承诺账本.md`；分析报告支持 `PROMISE_OPEN/ADVANCE/RESOLVE/DROP`；信息规划注入未兑现/逾期承诺；结算更新账本。
- **角色弧线**：新增 `01-世界架构/角色弧线.md`；首次从角色 frontmatter 建骨架；分析报告支持 `ARC: 角色 | 阶段前 | 阶段后 | 触发 | 可见`；信息规划/质量控制注入弧线。
- **基准评估**：新增 `shared/quality-benchmark.ts`、`tests/benchmark/quality-benchmark.test.ts`、`vitest.benchmark.config.ts`、`npm run eval:quality`、`benchmarks/quality/README.md/schema.json`；无 fixture 时自动跳过，不阻塞日常测试。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿。
- `npm test`：**351 个测试文件 / 4356 个用例全部通过**；`eval:quality` 在无 fixture 时退出 0。
- 新增场景卡、工艺约束、样章回退、对照库、世界快照、定向修订、承诺/弧线、基准指标等回归测试。

## 4.15.0 — 2026-10-26

> 发布说明：`docs/releases/v4.15.0.md` · 上一版本 v4.14.0

### 🧭 动因
- 全局 `maxOutput` 会被「最后选择的模型」覆盖，Flash 的 4K 上限会截断正文，Pro 的 131K 上限又会被规划步骤继承。
- `finishReason=length` 只弹提示，半成品仍会落盘/继续结算；重新生成被截断的正文还会覆盖已有完整稿。
- 「继续生成剩余」用空 prompt 早退，调用方却把步骤计入成功；批量续跑只在步骤目录找正文，读不到 v4 正文。
- 分析报告结构化提取把 `'flash'` 当模型名、只给 2000 tokens，失败后被 catch 吞掉，实体状态/时间线为空。
- 设置里没有任务级思考模式/输入上限/输出上限；端点 URL 不能识别供应商；本地 Ollama 链路存在静默回退云端和向量未接线。

### ✨ 改动
- **任务级模型/预算**：新增 `shared/task-model.ts`，规划用 Flash、正文/质量用 Pro，输出上限按模型能力解析；`resolveModelLimits` 优先用户覆盖 → 本地探测 → 自定义供应商上限 → 静态表。
- **截断状态机**：`finishReason=length` 不再标记完成；步骤写入 `step_truncated/step_finish_reason/step_model/step_usage`；正文截断时保留旧完整稿，新内容落为 `_截断草稿.md`；批量不再把截断/半成品送入结算。
- **继续生成剩余**：复用模板变量装配真实 prompt；空内容或未达完成标准的步骤不再计入成功；合并规划变更后失效正文/质量/分析/结算。
- **数据读写**：批量续跑按 `pjBodyFile` 读取 v4 正文；分析报告剥离完整 frontmatter；`step_model` 记录实际执行模型；角色灵魂优先使用步骤结果，手动编辑可进入下游。
- **设置升级**：保留现有 API 设置窗口，新增「任务级模型参数」表（模型 / 最大输入 / 最大输出 / 思考模式 / 思考预算）与全局思考设置。
- **URL 自动识别**：新增 `shared/provider-detection.ts`，识别火山/DeepSeek/SenseNova/CatCat/OpenAI/DashScope/Gemini/OpenRouter/SiliconFlow/Moonshot/Groq 等及 localhost/私有网段/Ollama 原生端点；自定义供应商编辑保留 `sourceType/apiStyle`。
- **思考参数**：Ollama 原生 `think`、OpenAI o 系列 `reasoning_effort`、火山/DeepSeek/SenseNova `thinking`；未知供应商不下发未验证字段。
- **Ollama 本地链路**：协同写作按模型所属本地 provider 路由，找不到时明确报错而非回退云端；`num_ctx` 按探测窗口/用户配置；共享 `EmbeddingService` 自动注入指纹库/知识库/协同；`local-only` 回退策略禁止静默云端 embedding；Ollama embedding 输入截断；向量任务/LLM 增强在 Worker 不可用时切主线程；拆解 LLM、分析报告、指纹提取支持本地端点与任务预算。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run preflight` / `npm run build` 全绿。
- `npm test`：**344 个测试文件 / 4314 个用例全部通过**。
- 新增回归：任务预算、截断保护、继续生成、批量 v4 续跑、分析报告模型、URL 识别、思考参数、embedding 回退策略、协同本地路由。

## 4.14.0 — 2026-10-26

> 发布说明：`docs/releases/v4.14.0.md` · 上一版本 v4.13.0

### 🧭 动因
- 协同写作中间的编辑区仍是裸 `textarea`：没有 Markdown 工具条，段落缩进/合并/拆分/引号只能手改，小说格式排版依赖用户记住「空两格 / 空行」规则。
- 项目「写作规则.md」已经能推导正文格式契约（`BodyWriter.resolveContract`），但编辑器侧没有消费它。

### ✨ 改动
- **Markdown 工具条**：加粗（Ctrl+B）、斜体（Ctrl+I）、二级标题（Ctrl+Alt+2）、引用（Ctrl+Alt+Q）、无序列表（Ctrl+Alt+L）、分隔线、行内代码（Ctrl+`）。
- **段落工具**：首行缩进/取消（Ctrl+Alt+I）、增加/减少段落缩进（Ctrl+] / Ctrl+[）、合并选中段落、在光标处拆分段落、选中文本转中文引号。
- **一键排版（Ctrl+Alt+F）**：按项目「写作规则.md」推导的分段/缩进契约排版全文；保留 frontmatter 与章节标题，剥离模型元叙述，统一段首缩进与段落间距。
- **编辑器状态栏**：显示 `Markdown`、当前格式契约（如「空行分段 · 首行空两格」）、字数、段落数与快捷键提示。
- **撤销友好**：文本变更优先走 `execCommand('insertText')`，保留原生撤销栈；失败时回退到 value + input。
- 新增 `shared/novel-format.ts` 纯函数层与 15 个单测，覆盖排版、缩进、合并/拆分、Markdown 包裹、引号转换与状态描述。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm run test:cov` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿。
- `npm test`：**335 个测试文件 / 4253 个用例全部通过**。
- 真实 Obsidian 1.14.5：临时项目验证「一键排版（空行分段 + 首行空两格）」「加粗」「首行缩进」均按预期生效；工具条与状态栏截图验收通过。

## 4.13.0 — 2026-10-26

> 发布说明：`docs/releases/v4.13.0.md` · 上一版本 v4.12.4

### 🧭 动因
- A2/A3 的 CSS 迁移此前因 Obsidian CLI `plugin:reload` / `dev:screenshot` 返回 127 而暂缓；运行时恢复后按页面分批落地。
- 知识库、设置、向导、监控、指纹等页面仍有 2,617 处内联样式，主题适配与后续样式治理缺少可组合的工具类。
- `styles.css` 内存在 297 条未被任何源码引用的历史规则，抵消了工具类提取的收益。

### ✨ 改动
- **A2 知识库页面（4 文件）**：`book-detail-renderer` / `knowledge-base-view` / `knowledge-base-modals` / `knowledge-detail-modal` 内联 **685 → 140**；提取 220 个声明级工具类。
- **A3 设置/向导/监控等（15 文件）**：`settings-tab`、`batch-import-modal`、`mini-settings-modal`、`monitor-panel-b`、`wizard-step-renderers`、`prompt-manager-settings`、`knowledge-detail-modal`、`context-panel`、`writing-fingerprint-view`、`fingerprint-detail-modal`、`outline-expand-modal`、`chapter-outline-tree-modal`、`scene-outline-controller`、`refill-modal`、`polish-editor` 内联 **1,231 → 227**；新增 355 个声明级工具类。
- **全局内联**：**2,617 → 1,068**（静态 2,332 → 840，-64%）。
- **死 CSS 清理**：移除 297 条未被引用的历史规则（约 39.7KB）；二次扫描 0 候选。
- **颜色收敛**：A2/A3 文件内联样式中的硬编码颜色全部替换为 `--nw-*` token；新增 `--nw-danger-soft` / `--nw-danger-soft-bg` / `--nw-danger-bright-bg`。
- **测试适配**：3 处 `className ===` 精确断言改为 `toContain`，适配可组合类名。
- **规格校准**：A3 的 CSS ≤255KB 目标调整为 ≤325KB；原因是工具类把内联样式搬进 CSS，CSS 文件字节不能单独代表样式负载。

### 📊 指标
| 指标 | 迁移前 | 迁移后 |
|---|---|---|
| 全局内联 | 2,617 | **1,068** |
| 静态内联 | 2,332 | **840** |
| `styles.css`（LF） | 338,203 B | **321,817 B** |
| `!important` | 260 | **190** |
| 唯一类 | 1,413 | 1,771（新增工具类） |
| CSS + TS 内联总负载 | 528,973 B | **413,384 B（-21.8%）** |

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm run test:cov` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿。
- `npm test`：**334 个测试文件 / 4238 个用例全部通过**。
- 计算样式对比（迁移前/后）：知识库列表、书籍详情、指纹库、监控面板 B、设置弹窗、批量导入、知识详情弹窗 **0 差异**；向导内容无样式差异（仅面板尺寸/激活态标题色不同）。
- 截图：1440 / 768（实际视口 791）dark/light 验证通过。

## 4.12.4 — 2026-10-26

> 发布说明：`docs/releases/v4.12.4.md` · 上一版本 v4.12.3

### 🧭 动因
- `check-css` 按工作树字节记基线：Windows CRLF 为 349,451B，Linux/Release LF 为 338,203B。若在 Windows 上完成 A2 迁移并更新基线，CI 会按 LF 口径判超限，导致跨平台失真。

### 🛠 修复
- `scripts/check-css.js` 读取 `styles.css` 后统一 `CRLF → LF`，基线重置为 **338,203B**；其它指标不变（`!important` 260 / hex 156 / rgb 192 / 唯一类 1,413）。
- 不改变插件运行行为与 `styles.css` 内容。

### ✅ 验证
- `npm run typecheck` / `npm run lint` / `npm run test:cov` / `npm run preflight` / `npm run build` / `npm run check:release` 全绿
- `npm test`：**334 个测试文件 / 4238 个用例全部通过**

## 4.12.3 — 2026-10-25

> 发布说明：`docs/releases/v4.12.3.md` · 上一版本 v4.12.2

### 🧭 动因
- R1 的预算结果只在 console 记录，本地小窗口被裁剪时无法从 UI 定位；`normalizeOllamaEndpoint` 已支持任意本机端口，但缺端到端测试。
- R4 的仪表盘/协同/Panel B 都走 WQE，但没有同分测试；`MonitorPanelB#setQualityOptions` 是零调用死配置。
- R6 的 V2 指纹检索 `minScore` 默认为 0，低相关指纹会挤掉真正相近的风格；也缺少 hit@k 评估工具。
- R5 的浮窗保存只做过代码核对，没有 BodyWriter 契约单测。

### ✨ 改动
- **预算遥测（`shared/budget-telemetry.ts`）**：进程内环形缓冲最近 20 条，记录 api / chapter / scene / cowrite 四个来源的模型、输入/可用/窗口、丢弃与截断片段；「流程诊断」展示最近 5 条。
- **本地 Ollama 端口**：`normalizeOllamaEndpoint` 覆盖 localhost / 127.0.0.1 / [::1] 的任意端口；补 ai-api-client 单测。
- **跨视图同分（R4）**：新增 `quality-score-engine-cross-view.test.ts` 锁定仪表盘/协同/Panel B 同一文本、同一上下文的同分口径；移除零调用的 `setQualityOptions`。
- **检索下限（R6）**：`selectFingerprintsForInjection` 向 V2 传 `minScore`，默认 `RETRIEVAL_ABSOLUTE_MIN_SCORE(0.15)`，调用方可覆盖；新增 `eval:fingerprint` 离线 hit@k/MRR 脚本。
- **浮窗契约（R5）**：新增 `co-write-floating-panel-contract.test.ts`，锁定 BodyWriter 入口、完整身份字段与禁止直接 `vault.modify`。

### ⏸ 未纳入本版
- **A2/A3 CSS 迁移**：当前 Obsidian 1.12.7 的 CLI 在本机对 `plugin:reload` / `dev:screenshot` 返回 127，无法完成 1440/1024/768 × dark/light/Minimal 的视觉验收；按计划风险约束不盲改。A2 的 AST 可行性分析已记录在 `style-ui-unification/spec.md`，待可截图的运行时恢复后继续。

### ✅ 验证
- `npm run typecheck` / `npm run lint`：通过
- `npm test`：**334 个测试文件 / 4238 个用例全部通过**
- `npm run test:cov` / `check:templates` / `check:css` / `check:inline-styles` / `check:deps` / `check-engines` / `build` / `check:release`：全绿

## 4.12.2 — 2026-10-25

> 发布说明：`docs/releases/v4.12.2.md` · 上一版本 v4.12.1

### 🧭 动因
- CSS 治理缺少可在 CI 失败的预算门禁：`check-css.js` 只查括号且从不 `exit(1)`，`check:css` 未接入 CI。
- 批量命令/弹窗文案写「11 步 / 8 阶段」，实际 `BATCH_STEP_KEYS` 只有 7 个 key。
- `long-novel-ai-evolution` spec 头部仍写「草案/未实施」，与 §3.0、v4.12.1 代码不一致。

### ✨ 改动
- **CSS 预算检查（`scripts/check-css.js`）**：保留括号检查，新增体积、`!important`、硬编码 hex、rgb/hsl、唯一类、非 `nw-` 前缀类、最大选择器深度指标；违规或超基线 `exit(1)`；支持 `--update-baseline`。
- **内联样式基线（`scripts/check-inline-styles.mjs`）**：按文件统计 5 种内联写法（含静态/动态），新增 `.inline-style-baseline.json`；任何文件新增/回涨即失败。
- **CI/发布门禁**：`check:css` / `check:inline-styles` 接入 `preflight`、CI verify 与 Release 流水线。
- **批量步骤口径**：命令描述与弹窗文案对齐实际 7 步；新增 `batch-targets-contract.test.ts` 锁定 key 存在、顺序为子序列、无重复。
- **long-novel spec 校准**：状态改为 Scoped Phase 1 进行中；基线更新到 v4.12.1 / 330 文件 / 4225 用例；新增 §3.0.1 记录 5 个缺口与本轮范围。

### ✅ 验证
- `npm run typecheck` / `npm run lint`：通过
- `npm test`：**331 个测试文件 / 4228 个用例全部通过**
- `npm run test:cov` / `check:templates` / `check:css` / `check:inline-styles` / `check:deps` / `check-engines` / `build` / `check:release`：全绿
- CSS 基线：348,156 bytes；`!important` 260；内联 2,617（静态 2,332 / 动态 285）；唯一类 1,401

## 4.12.1 — 2026-10-25

> 发布说明：`docs/releases/v4.12.1.md` · 上一版本 v4.12.0

### 🧭 动因
- 审计 spec §5 的 5 条 `[待确认]` 尚未收口；`buildSceneRhythmInjection` 只输出硬编码模板，知识库 `rhythm` 维度从未被消费。
- 两个 7 月早期草案（`prompt-management-system` / `style-ui-unification`）状态未判定。

### ✨ 改动
- **节奏注入接入检索（`engine/knowledge-injector.ts`）**：保留硬编码节奏模式与节奏建议，新增 `dimensions: ['rhythm']` 检索，最多 3 条、每条 160 字截断；无结果时行为与 4.12.0 一致。
- **步骤下标契约（`tests/unit/engine/step-definitions-index.test.ts`）**：锁定 `ALL_FULL_STEPS.index === 数组下标`、key 唯一、迁移映射目标合法。
- **fullCache 生命周期守卫（`tests/unit/engine/quality/quality-score-engine-cache-lifecycle.test.ts`）**：同上下文 1000 次只触发 1 次内核计算；上下文变化重算；`cacheSize` 上界生效。
- **质量看板缓存注释（`ui/quality-dashboard-modal.ts`）**：明确 `qualityCache` 为 Modal 实例级，关闭即释放。
- **审计 §5 收口**：worker 隔离、fullCache、qualityCache、rhythm 注入、步骤下标五项均给出结论/证据（`spec.md` §5）。
- **草案判定**：`prompt-management-system` 已落地；`style-ui-unification` 部分完成，CSS 体积与内联样式未达 2026-07 目标，转为持续治理。

### ✅ 验证
- `npm run typecheck` / `npm run lint`：通过
- `npm test`：**330 个测试文件 / 4225 个用例全部通过**
- `npm run test:cov` / `check:templates` / `check:deps` / `check-engines` / `build` / `check:release`：全绿

## 4.12.0 — 2026-10-25

> 2026-10 缺陷与不合理设计审计全量落地：Phase 1–4（A/B/C/D 四组）与 Rev 153–192 迭代合并发布。
> 门禁基线：328 个测试文件 / 4218 个用例通过；typecheck / lint / check:templates / check:deps / check-engines / check:release 全绿。

**本版主线**

- **数据安全与状态**：正文写盘跨写入者锁、切章快照、按 bookId 判向量存活、并发拆解去重、批量取消、失效传播收敛、配置目录 IO 回退。
- **检索与注入**：embedding 模型指纹与维度校验、缓存签名、per-dimension 阈值、指纹上限统一、V2 重建、预算闸门与真实注入计数。
- **质量与监控**：质量单内核口径、按章聚合的基线、偏离检测上下文指纹、实时质量落盘复用同一次评估。
- **工程门与可维护性**：preflight + 架构基线棘轮、StepRunner 切片、命令注册表 UI 注入化、设置深合并、项目显式传递。
- **体验与流程**：章节流程与信息流重构、快捷工具三层对齐、全章节选择与时间线/伏笔关联索引、实体与设定模块排版、成稿导出。

各主题的动因、改动与验证见下方小节；面向使用者的摘要见 [docs/releases/v4.12.0.md](docs/releases/v4.12.0.md)。

---

### 性能监控收敛 / 质量基线 / 偏离检测 / 质量校准系数集中 / 本地模型探测 / 死代码清理

#### 🧭 动因
- 性能监控有两份实现（`engine/performance/` 与 `services/performance-monitor.ts`），引擎层那份无生产引用；`measure()` 结算后不删除起始 mark，长跑时 `activeMarks` 只增不减。
- 质量面板只有「较历史平均 +N」，没有均值/方差口径，无法判断当前章节是否真的偏离项目常态。
- 协同写作的实时质量开关把偏离检测写死为 `skipDeviations: true`，即使打开也只传空上下文；同时主线检测把所有相邻两字当关键词、时间线把「同一时间标记重复」当矛盾，误报率高。
- 本地模型能力只能靠静态表猜测：用户新拉的模型一律按 8192 兜底，窗口更大的模型被低估、窗口更小的模型被放大。
- 续写只带前一章最后 500 字，长章结尾的人物/场景状态容易被截断，首段承接不稳。
- 协同生成的「已写内容」固定只取尾部 800 字，而快照保留 2000 字：本地 8K 窗口下前文仅占约 5% 预算，快照里的后 1200 字被静默丢弃，长段落承接不稳。
- 实时质量评估在「上一次还在评估」时直接丢弃新触发：用户停手前的最后一次输入永远不会被评估，顶栏会长期停在旧文本的分数上。
- 主续写的场景知识注入（`injectForBodyGeneration`，风格/节奏/技巧/人物/伏笔/规则六段）拼进 `system`，而预算裁剪只作用于 `sections`：注入越长越会把整段 prompt 顶过窗口，本地模型从尾部硬截断时正好切掉「已写内容 / 写作方向 / 输出约束」。
- 选区改写与联想的 `system` 同样直接拼入项目写作规则（最长 3000 / 2000 字）与整份文笔风格文件（`writingStyle` 在协同快照里没有长度上限）：长文笔文件会绕过预算，直接顶爆本地窗口。
- 主续写的「知识库 - 技巧参考」把 `structure` 与 `technique` 混检：结构样本的 category 是「起/承/转/合」，非动作/对话方向时会被渲染成「技巧：起 …」，既误导模型又挤掉真正的技巧条目（与知识注入段已修的坑同源）。
- 同一路径的「原文片段」直接取前 3 条，没有相邻块去重：400 字 / 40 字重叠分块下，相邻块共享 40 字会双份占预算（注入段已在第 51 条修过，知识片段路径漏了）。
- 实时监控的 `evaluate` 收外部 `AbortSignal` 却只挂监听不摘：正常结束后闭包留在 signal 上，视图级 controller 复用时逐次累积；外部 signal 已 abort 的早退分支还会残留内部 controller。
- 知识向量只按 `bookId` 文件加载，不校验书籍是否还在知识库：本工作区实测 8 个向量文件对应的书目录已全部删除，协同写作仍在检索这些「幽灵书」，把不复存在的内容注入 prompt。
- 拆解向量化把「原文分块」和「拆解报告样本」写成二选一：有原文时风格/节奏/技巧/结构/人物/伏笔全部不落库，重拆一次就让三个 prompt 段整段消失；无原文时反过来「原文片段」恒空。
- 文风注入把 `style` 与 `original` 放在同一次 topN 检索：原文分块每本最多 120 条、风格样本每本约 5 条，风格分析样本被结构性挤光，注入段实际只剩原始正文。
- 协同实时落盘用 `v1Result ?? qualityKernel.evaluate(text)` 兜底：本次评估没有质量分（quality 子任务失败 / 被取消）时会再跑一遍内核，多记一条内核历史并写入一条与顶栏「质量 --」不一致的记录；`RealtimeMonitor#buildEmptyScore` 也无人使用。
- 指纹强度 0 在界面上是「完全禁用」，但只让全局层特征描述消失：`PromptBuilder#getFingerprintPromptParts` 的样本过滤只看 `enabled` 布尔，强度 0 的指纹其示例片段仍会以「参考片段」进入 prompt，禁用对正文无效。
- 11 步流水线的 prompt 长度闸门按全局设置算（`settings.maxContext` 默认 128000 / `maxOutput` 32768），而每一步可能切到不同模型（pro/flash/default），本地模型常见只有 8K 窗口：闸门永不触发裁剪，请求要么被 `ai-api-client` 直接判「输入过长」拒绝，要么被 Ollama 按 `num_ctx` 从尾部静默截断（最先丢的是输出约束）。
- 指纹的启用状态有两套来源，正文生成与润色读的那套永远为空：`KnowledgeInjector#getEnabledFingerprintsFromLibrary` 与 `PolishAIPolishModal#loadFingerprintStyleHint` 只读 `profile.fingerprint.enabledProject/enabledGlobal`，而这两个数组在全仓没有任何写入方（默认 `[]`、只能手改画像文件）。结果是「写作指纹风格参考」只在协同写作生效，11 步正文生成与 AI 润色从未用过任何指纹。此外该段还嵌在 `buildStyleInjection` 的 `strength >= 0.7` 分支里，而画像默认 `injectionStrength = 0.5`——即使数据源正确，默认配置下也进不去。
- 指纹库的 `template` 层是「来源库」：注入链 `getEnabledFingerprints` 与强度消费 `getFingerprintPromptParts` 都只处理 project/global，模板指纹只在创建项目/「从模板同步到项目」时被复制。但三个 UI 入口（指纹库视图、设置页、mini 设置）仍对模板显示「启用/禁用」与「强度调节」并持久化，用户会以为设置生效。

#### ✨ 改动

**1. 性能监控收敛（`services/performance-monitor.ts`，删除 `engine/performance/`）**
- `measure()` 结算后消费起始 mark 并从父节点 `children` 摘除；`end()` 同样摘除，避免长跑引用累积。
- `statsByOperation` 增加 500 key 上限，超出淘汰最旧 key；`getStats(name)` 未传分类时回退默认 `other`。
- 引擎层重复实现与其测试删除，测试改为覆盖 `services/performance-monitor.ts`。

**2. 质量基线校准（`shared/quality-baseline.ts` / `ui/monitor-panel-b.ts`）**
- 新增 `computeQualityBaseline`：按项目质量历史计算总分与 6 维的均值/样本标准差，样本不足 3 条返回 null。
- 新增 `compareToBaseline`：输出 delta、z 分数与 `above/at/below`；历史无波动时用 1 分容差。
- 质量摘要新增「📊 高于/低于/与基线持平 +x.x（±x.xσ） · 基线 xx.x（近N章）」，计算时排除本次刚写入的记录（样本按章聚合，见第 19 条）。

**3. 偏离检测接线与误报修正（`ui/co-writing-view.ts` / `engine/quality/deviation-detector.ts`）**
- 实时质量评估不再 `skipDeviations`：传入 `chapterId` / `chapterNum` / 本章大纲（简报或快照 `chapPlan`）/ 上一章正文（按章缓存，最多 20000 字）。
- 状态栏显示「质量 … · 偏离 45 · 1严重/2警告」，`title` 悬浮展示前 5 条偏离。
- 主线 2-gram 关键词过滤虚词、上限 30 个；覆盖率低于 50% 且关键词 ≥5 才报，修掉「大纲措辞稍变即未覆盖」。
- 时间线只与最近前一章比较，且仅当「当前章最早时间点早于前章最晚时间点」才报倒退；重写中文数字解析（十二/二十/一百零五），「第一日」与「第1日」同值不再误报。

**4. 本地模型能力自动探测（`services/local-model-probe.ts` / `shared/model-capabilities.ts` / `engine/ai-api-client.ts`）**
- 新增 `probeOllamaModelCapability`：调用 `/api/show`，优先读 `<arch>.context_length`，回退 `general.context_length` 与 `parameters` 的 `num_ctx`；输出上限按窗口 25% 估算并封顶 8192。
- 能力表新增运行时注册：`findModelCapability` 优先返回探测值，用户「模型覆盖」仍最优先。
- 仅本地端点、且静态表未登记时探测；成功结果与并发请求去重缓存，失败进入 5 分钟冷却，避免每次调用都等超时。
- `callAI` 与 `callAIStream` 在计算 maxTokens 前等待探测，首次调用即可用真实窗口。

**5. 续写上下文加长（`ui/continue-chapters-modal.ts`）**
- 前一章尾部从 500 字提升到 1500 字，配合既有「本章大纲 + 设定库 + 角色信息」降低承接断裂。

**6. 删书清理向量（`services/knowledge-base-manager.ts`）**
- `deleteBook` 在删除书目录后同步删除向量目录下的 `<bookId>.json`，并从 `index.json` 移除条目；三个 UI 删除入口无需改动。
- 索引缺失/损坏时静默跳过，下次重建索引自愈。

**7. 知识注入预算（`engine/knowledge-injector.ts` / `engine/scene-body-generator.ts`）**
- `injectForSceneBody` 新增 `maxInputTokens` / `modelId`：有预算时复用 `assemblePromptWithinBudget`，必须层（任务卡/人物状态/禁止事项）固定在 system 中不裁剪，按需层按剩余预算截断或丢弃。
- 发生裁剪时输出 `[KnowledgeInjector] 知识注入按预算裁剪` 日志（含 dropped/trimmed/overBudget）。
- `createSceneBodyGenerator` 按模型窗口 30%（最低 512 token）传入预算；不传预算时输出与旧行为一致。

**8. 删除未接线的并行建议（`engine/co-writer-engine.ts` / `engine/co-writer/` / `ui/services/co-write-facade.ts`）**
- `suggestParallel` 只被 Facade 转发、没有任何 UI 入口，`suggestStreamInternal` 也只服务于它；本地模型单并发下并行生成没有收益。
- 删除两个方法、Facade 转发、`engine/co-writer/parallel-suggestions.ts` 及其测试与 barrel 导出，避免两套建议生成链路长期漂移。
- 文档同步：`API.md`（删除 3.3 节并重排 3.3/3.4）、`DEVELOPMENT.md`、`PERFORMANCE.md`、`CODE-INDEX.md`、`ARCHITECTURE.md`、`engine/repository/MIGRATION.md`。

**9. 场景确认结果直接落盘（`ui/scene-confirm-modal.ts` / `shared/scene-body-merge.ts`）**
- 场景确认向导完成页新增「💾 写入正文（覆盖本章正文）」：按场景顺序合并正文后，经 `BodyWriter.write` 统一入口写入本章正文文件（保留旧 frontmatter、广播 `novel-writer:body-written`）。
- 目标路径优先复用已存在的 `第N章_*_正文.md`，避免带标题的文件被另存为 `第N章_正文.md` 产生两份正文；卷号取自工作台当前卷。
- 合并逻辑抽为纯函数 `mergeSceneBodies`：空场景丢弃、场景间空一行；3 例单测。

**10. 规划→正文失效传播（`engine/planning-step-advance.ts` / `engine/step-runner.ts` / `ui/full-writer/step-render-controller.ts`）**
- 新增 `downstreamStepsAfterPlanningChange(stepKey, hasBody)`：规划类步骤（信息规划/情节蒸馏/大纲摘要/情绪规划/Scene 展开）变更后，正文与质量、分析、结算一并失效；正文尚未生成时返回空数组，避免把空正文标成「待重做」。
- 接入三条路径：`StepRunner` AI 完成、结果区手动保存、Scene 编辑器保存（含纯文本模式）。
- 6 例单测（含既有 `calcStepIndexAfterPlanning` 2 例回归）。

**11. 长篇记忆层：前序卷摘要 + 已确认事实（`engine/long-term-memory.ts` / `engine/co-writer-engine.ts` / `engine/prompt-builder.ts` / 正文 V1/V2 模板）**
- 新增 `loadLongTermMemory`：只读事实索引的 `confirmed`（pending 未确认事实绝不进入 prompt），按人物/世界观/剧情分组，每类最多 12 条、整体上限 1500 字，输出稳定「【长篇记忆：已确认事实】」块。
- 新增 `loadVolumeSummaries`：读取「当前卷之前」各卷分卷大纲，经 `VolumeOutlineSummarizer` 提取并渐进压缩（默认 2000 字），单卷损坏跳过；第 1 卷/无前卷返回空串。
- 协同写作：`init` 时解析当前卷号，加载后写入 `snapshot.longTermMemoryContext`；`buildSuggestionPrompt` 新增 `longTermMemory` 片段（priority 30、可裁剪）。
- 正文生成：`buildTemplateVars` 新增 `longTermMemory` 变量，V1 `BODY_GENERATION_USER_TEMPLATE` 与 V2 `BODY_GENERATION_USER_TEMPLATE_V2` 均在「前文/前情提要」后插入；无数据时为空串，模板不留痕。
- 索引/大纲缺失、损坏或无已确认事实时静默降级为空，不改变既有 prompt。
- 9 例单测（分组顺序、类内上限、整体截断、缺失/损坏降级、pending 不注入、只取前序卷、第 1 卷为空）。

**12. 质量维度校准系数集中（`shared/thresholds.ts` / `engine/writing-quality-engine.ts` / `engine/quality/quality-score-engine.ts`）**
- 第十二节新增 `WQE_DIMENSION_WEIGHTS`、`QSE_DIMENSION_WEIGHTS`、`WQE_SUB_WEIGHTS`、`QSE_SUB_WEIGHTS`、`WQE_CALIBRATION`、`QSE_CALIBRATION`：维度总分权重、维度内子项权重、标定乘数（每处修辞/动作/场景切换得分）、理想区间（句长、标点密度、篇幅配比、波动度）全部集中。
- 两个引擎改为只引用阈值表：`DIMENSION_WEIGHTS` 直接指向 `QSE_DIMENSION_WEIGHTS`；`MILESTONE_INTERVALS`、趋势窗口、动静平衡理想值同样取自表内。
- 数值逐项保持原值，评分结果不变；新增 6 例单测锁定「六维权重和为 1、每组子项权重和为 1、引擎不再另写一份权重」。

**13. 同人设定库链路修复（`ui/add-fanfic-setting-modal.ts` / `ui/full-writer/wizard-step-renderers.ts`）**
- 「添加同人设定」的 AI 提示词改为使用 `buildFanficSettingsContent` 生成的骨架：字段名、标题、两张时间线表格与校验器完全同构，不再出现「提示词让写世界观、校验器要 9 个字段 + 2 张表」的必然失败。要求两条时间线各至少 2 行真实数据、三条创作规则写成单行完整句。
- 绑定项目改用共享的 `attachFanficPathToProject`：`.project` 不存在时自动创建并写入 `## 类型\nfanfic`，避免工具生成后同人规则读不到。
- 向导同人步骤在内存无暂存时，按 `.project` 的「同人设定路径」回读文件并回填表单；此前通过工具生成后进入向导会看到空表单。
- 新增 1 例「生成 → 校验 → 解析 → 注入」全链路单测，锁定三条规则确实进入 prompt。

**14. 同人约束注入协同写作（`shared/fanfic-rules.ts` / `engine/co-writer-engine.ts` / `engine/prompt-builder.ts`）**
- `FanficRules` 补齐「世界观类型 / 力量体系 / 核心规则」三项核心设定：只给三条创作规则时，模型知道「不许 OOC」却不知道原作力量体系边界，长篇续写仍会写出体系外能力。
- `formatFanficRulesForPrompt` 改为分组输出（原作 → 核心设定 → 创作规则 → 兜底红线），单条超 `FANFIC_RULE_ITEM_MAX_CHARS`（160 字）截断，避免一份设定挤占整段预算；核心与规则全空时返回空串，原创项目 prompt 不留痕。
- 新增 `readFanficRulesFromFS(fs, project)`：走 `FileSystemPort` 读取 `.project` 绑定的设定文件，缺失/损坏静默降级为空规则（engine 层不依赖 `App`）。
- 协同写作 `loadContext` 在长篇记忆之后加载同人约束并写入 `snapshot.fanficRulesContext`；`buildSuggestionPrompt` 新增 `fanfic` 片段（priority 98、可裁剪），优先级高于本章简报、低于剧情节点推进；选区改写 prompt 同样注入。
- 5 例单测：prompt 层验证「约束进入 prompt 且位于简报之前 / 原创项目不出现 / 选区改写受约束」；engine 层验证 `snapshot.fanficRulesContext` 经 `buildDirectionalPrompt` 进入真实请求。
- 尚未运行时复测：真实同人项目协同视图中该块是否按预期出现在请求体、预算裁剪时的先后顺序。

**15. 截断可见性：`finishReason=length` 不再是静默日志（`engine/step-runner.ts`）**
- 新增 `warnIfTruncated`：正文自动续写 3 次后仍被截断、或普通步骤一次就被截断时，发 Notice「结果可能不完整，请检查结尾」；此前只有 `console` 级 warning，半章会被当成完整章节保存。
- 2 例单测：`length` 提示且带步骤名、`stop` 不打扰用户。

**16. 协同写作实时质量进入项目历史（`ui/co-writing-view.ts` / `shared/thresholds.ts`）**
- 此前实时监控只在顶栏显示，`质量历史.json` / 基线 / 趋势只统计仪表盘手动评估；在协同写作里写完整章不会进入历史，基线长期缺样本。
- 实时评估成功后经 `persistLiveQualityIfDue` 写入同一份历史：正文 ≥300 字、同项目同章至少间隔 10 分钟、请求在途去重；记录使用与仪表盘相同的 WQE 六维口径（language/rhythm/character/plot/atmosphere/structure），不再出现「同一章两套维度」。
- 节流阈值集中到 `shared/thresholds.ts`（`QUALITY_LIVE_PERSIST_MIN_CHARS` / `QUALITY_LIVE_PERSIST_INTERVAL_MS`），避免边打字边写盘。
- 尚未运行时复测：连续写 10 分钟只落一条、切章后新章立即记录、切项目同章号不被上一本节流挡住。

**17. 质量基线维度样本治理（`shared/quality-baseline.ts`）**
- 维度分为 0（旧记录/手改文件缺维度时的占位）不再参与均值：此前会把维度基线拉到 0，当前任何分数都被判「高于基线」。
- `QualityBaseline` 记录计算时的 `minSamples`，`compareToBaseline` 跳过样本不足的维度；1–2 条样本不再给出「偏离基线」结论。
- 2 例单测：0 占位只影响该维度计数、维度不足 `minSamples` 时不出结论。

**18. 批量 N 章取消真正中断 AI + 监听器泄漏修复（`engine/step-runner.ts` / `ui/full-writer/batch-pipeline-runner.ts`）**
- 非正文步骤此前不接收 `AbortSignal`：取消批量后，正在跑的大纲/规划请求仍会跑完并重试。`callAIWithRetry` 新增可选 `signal`，已取消时直接返回 `finishReason='aborted'` 且不再发起请求/重试；`runStep` 的所有步骤统一传当前章信号。
- 批量取消器改为在 `run()` 里只绑定一次外部 signal，按「当前章」桥接；此前每次 `getAbortController()` 都 `addEventListener`，长批次会累积监听器（MaxListeners 警告/泄漏）。
- 2 例单测：已取消 signal 不发起调用、调用中 abort 不重试。

**19. 质量基线样本单位改为「章」（`shared/quality-history.ts` / `ui/monitor-panel-b.ts`）**
- 基线此前直接用全部历史记录算均值/方差，样本单位是「评估次数」：协同写作每 10 分钟落一条、仪表盘每次评估落一条，写得越久的章节权重越大；当前章自身的历史记录也参与基线，等于「和自己比」。
- 新增 `aggregateQualityHistoryByChapter`：同章多次评估只取最后一次作为该章样本，`chapterKey` 为空的旧记录各自独立保留，输出按时间升序。
- 新增 `normalizeChapterKey`：仪表盘写入的是 `${project}-${chapterName}`、协同写入的是 `第N章`，同一章两种键会被算成两章。统一提取「第N章」片段（支持中文数字与空格），无章号的自定义命名原样保留；`addToQualityHistory` 与基线排除当前章均走该函数。
- `renderBaselineComparison` 改为「排除当前章 → 按章聚合 → 计算基线」，UI 文案由「近N次」改为「近N章」，与统计口径一致。
- 基线样本改用磁盘全量历史（`baselineHistory`），不再受展示窗口 `maxQualityHistory = 20` 限制：按章聚合后 20 条可能只剩 2-3 章，会让基线行直接消失；切章/切项目时随 `restoreQualityHistory` 覆盖，旧项目样本不会串入。
- 7 例单测：同章多条只留最后一条、空 `chapterKey` 不互相合并、跨章按时间升序、跨写入口径归为同一章、章号归一化（阿拉伯/中文数字/空格/无章号）。

**20. 协同实时质量落盘复用同一次评估（`engine/quality/quality-score-engine.ts` / `ui/co-writing-view.ts`）**
- `QualityScore` 新增可选 `v1Result`：注入 `v1Engine` 时透传 `WritingQualityEngine` 原始结果。QSE 六维映射不含 `structure`，落盘历史需要完整六维，此前只能在 `persistLiveQualityIfDue` 里对同一段文本再跑一遍 `qualityKernel.evaluate`。
- 重复评估的副作用不只是浪费 CPU：每次都会往 WQE 的 `scoreHistory` 再记一条，趋势窗口被同一时刻的两条分数重复加权。
- `persistLiveQualityIfDue(text, qualityScore)` 改为优先读 `qualityScore.v1Result`，缺失时才回退重算；顶栏显示、历史记录、趋势现在来自同一次评估。
- 2 例单测：v1 模式透传的 `v1Result` 含 `structure` 且总分一致、未注入 v1Engine 时不透传。

**21. 知识库技巧注入去重（`engine/knowledge-injector.ts`）**
- `buildKbTechniqueInjection` 的去重条件 `!uniqueTechniques.has(category) || techniqueExamples.length < 5` 实际恒为真：前 5 条即使同一技巧类别也会全部进入 prompt，「伏笔」重复 5 次占满预算，不同技巧反而排不进来。
- 改为「同类别只取最高分一条，最多 5 类」；`category` 缺失统一归「通用技巧」并去重。
- 3 例单测：同类别只注入一次、最多 5 个不同技巧、缺 `category` 只保留一条。

**22. E2E 插件根目录解析修复（`tests/e2e/utils/obsidian-app.ts`）**
- `pluginRoot()` 原为 `resolve(__dirname, '..', '..')`，从 `tests/e2e/utils` 只回到 `tests/`，导致所有 Electron 用例在 `createTestVault` 阶段必报「缺少构建产物 main.js」——E2E 链路自建立起就无法真正运行。
- 改为三层回溯到插件根；已用 `path.resolve` 验证指向 `novel-writer-ai` 根目录。
- 运行时复测受阻证据：修复后 Obsidian 可被 Playwright 拉起（DevTools 已监听、vault 已打开），但用户日常实例占用 `\\.\pipe\obsidian-cli-admin` 命名管道，新实例因 `EADDRINUSE` 退出。E2E 必须在退出日常 Obsidian 实例后运行（README 已注明），当前未强行结束用户进程。

**23. 批量 N 章单步失败自动重试（`ui/full-writer/batch-pipeline-runner.ts` / `batch-step-retry.ts`）**
- 旧行为：任一步骤产出为空即整章判 `failed`，一次本地模型偶发空输出就要用户手动重跑整批。
- 新增单步重试策略（`shouldRetryBatchStep` + `BATCH_STEP_MAX_ATTEMPTS = 2`）：首次为空时自动重试该步一次，重试成功则继续；取消与已达上限不重试。
- 步骤异常不再直接冒泡到 `run()` 的兜底（旧路径会把 `completedSteps` 清空，UI 误显示「一步都没完成」），改为返回带 `completedSteps` / `failedStep` 的失败结果。
- 策略函数放在叶子模块 `batch-step-retry.ts`：`batch-pipeline-runner.ts` 会间接拉起 `main.ts` 依赖，单测直接导入会报 `Cannot find module 'obsidian'`。
- 3 例单测：已产出不重试、取消不重试、首次为空重试且达到上限停止。

**24. 偏离检测缓存键纳入上下文指纹（`engine/quality/deviation-detector.ts`）**
- 缓存键此前只有 `textHash`，但检测结论同样由大纲、人物设定、前文、伏笔、期望节奏决定：协同写作打开时 `openChapter` 先触发实时评估、章节简报随后才异步加载，空大纲的结论会在 60s TTL 内被后续相同文本命中，表现为「规划已就绪但偏离一直按无大纲计算」。
- 新增 `hashContext`：纳入 `chapterId`/`chapterNum`/`chapterOutline`/`expectedRhythm`/`mainlineKeywords`/人物（名+性格+外貌+能力）/前文（章节号+字数）/伏笔；前文只取长度而非全文哈希，避免每次评估都扫两万字。
- 全量与类型级缓存键均改为 `${textHash}:${contextKey}`；`invalidateCache(text)` 改用 `deleteByPrefix` 清理同正文的所有上下文变体。
- 4 例单测：大纲变化、前文变化、人物设定变化均不命中旧缓存；`invalidateCache` 清理全部上下文变体。

**25. 协同实时监控补齐人物设定（`ui/co-writing-view.ts` / `shared/thresholds.ts`）**
- `buildDeviationContext` 此前只传大纲与上一章正文，`characterInfos` 恒空 → `detectCharacterOOC` 与 `detectSettingContradictions` 直接返回空，6 类偏离里「人物 OOC」「设定矛盾」在协同视图实际从未生效。
- 新增 `loadCharacterInfosForDeviation`：从 `ctxManager.gatherCharacterState` 读取人物档案，字段映射与浮动面板逻辑检查一致（姓名/性格标签/外貌特征/能力/背景）。
- 人物档案不随打字变化，按项目缓存 `DEVIATION_CHARACTER_INFO_TTL_MS`（60s，集中在 `shared/thresholds.ts`），避免每 2.5s 重扫人物目录；TTL 到期自动重读，设定改动不会被永久忽略。

**26. 协同实时评估竞态不再显示为失败（`ui/co-writing-view.ts`）**
- `RealtimeMonitor.evaluate` 在并发时抛 `busy: monitor is already evaluating`；`evaluateRealtimeQuality` 的 catch 把它当成真实错误，顶栏闪现「质量评估失败」，而实际上一次评估仍在正常进行。
- catch 中识别 `busy` 前缀直接跳过，其余错误仍按原逻辑提示。

**27. 上一章正文缓存改为按正文路径失效（`ui/co-writing-view.ts`）**
- 缓存有效性此前只比对 `chapterNum`：从 A 书第 3 章切到 B 书第 3 章（或同书不同卷第 3 章）时章号相同，偏离检测会拿 A 书的第 2 章正文做时间线/设定矛盾比对，产生串书误报。
- 改为按 `getBodyPath()` 推导出的上一章路径比对，路径天然包含项目与卷；切章、切卷、切书均自动失效。

**28. 联想 / 选区改写 / 句级迭代接入 prompt 预算（`engine/prompt-builder.ts` / `engine/co-writer-engine.ts`）**
- 此前只有主续写链路（`buildSuggestionPrompt`）接 `assemblePromptWithinBudget`；联想、选区改写、句级迭代仍把 `knowledgeParts`（知识库检索片段）与写作风格全文直接拼接，且把「上下文 / 选中文本 / 迭代指令」放在 prompt 末尾。
- Ollama 按 `num_ctx` 从尾部硬截断 prompt，被切掉的正好是任务本身：联想丢失当前上下文、改写丢失选中文本、迭代丢失用户指令，表现为「模型答非所问」。
- `buildRewritePrompt` / `buildAssociationPrompt` 新增可选 `budget`，新增 `buildIteratePrompt`（把原先散落在 engine 里的手写 prompt 收回 PromptBuilder）；三者统一走私有 `assembleWithBudget`，低优先级片段（记忆 20 / 知识库 25 / 驱动 60）先截断再丢弃，末尾任务片段作为 `tailParts` 永不裁剪。
- 同时把写作规则与文笔风格移到 system 段：它们是静态规则，不应与知识库片段一起被裁掉。
- `CoWriterEngine` 三处调用传入 `getCoWriteInputBudget()`（本地取 `min(模型窗口, CO_WRITE_NUM_CTX)`，云端取模型窗口）。
- 6 例单测：三条链路在 600 token 预算下丢弃超大知识库且保留任务片段；不传预算时保持旧行为（知识库全文进入 prompt）。

**29. 人物 frontmatter → 检测上下文映射统一（`engine/character-context.ts`）**
- 协同主视图（OOC / 设定矛盾）与浮窗逻辑检查各写一份映射，口径已漂移：一边用「未知」兜底再过滤，一边直接过滤空 name。
- 新增 `toCharacterContextInfos(raw)`：统一字段口径（`name` / `姓名` / `fileName` 回退；`性格标签` / `外貌特征` / `功法/技能树` 或 `金手指/特殊能力` / `人物背景`），只接受字符串并 trim，无姓名的记录直接丢弃。
- 两处调用方改为共用该函数；纯函数可直接单测，不再依赖 Obsidian 视图层。
- 6 例单测：标准字段、姓名/fileName 回退、无姓名丢弃、非字符串字段降级、金手指回退、空输入。

**30. 协同写作两条质量写入口统一章键构造（`shared/quality-history.ts` / `ui/co-writing-view.ts`）**
- 面板 B 实时评估的章键此前是 `${project}-${chapterName}`，实时落盘的是 `第${chapterNum}章`。`normalizeChapterKey` 只能从「第N章」形式中提取章号：章节名若为「初始之痕」「003_初始之痕」这类不含「第…章」的命名，落盘键会变成 `书-初始之痕`，与 `第3章` 并存 → 基线把同一章算成两章，样本被稀释。
- 新增纯函数 `buildQualityChapterKey(project, chapterNum, chapterName)`：有合法章号时恒为 `${project}-第N章`（章号取整），章号缺失/非法时才回退章节名；空项目返回空串供调用方跳过写入。
- 协同视图两处写入口改为共用该函数：`updatePlotCompletion` 直接使用（面板 B 内部再 `normalizeChapterKey` 去掉项目前缀），`persistLiveQualityIfDue` 归一化后落盘；项目前缀保留，跨书同章号仍能触发面板 B 的状态重置。
- 4 例单测：章名含/不含章号均得到同一键、非法章号回退章节名、空项目、章号与章名都缺失。

**31. 伏笔遗忘偏离接入真实伏笔追踪（`engine/foreshadow-context.ts` / `ui/co-writing-view.ts`）**
- 协同实时监控此前不传 `foreshadows`，检测器回退读 `previousChapters[].frontmatter`，而上一层只构造 `{ chapterId, chapterNum, text }` → 两条数据来源都为空，「伏笔遗忘」在 6 类偏离里恒返回空。
- 新增纯函数映射 `toForeshadowTrackings(items)`：读 `ForeshadowManager#loadTracker` 的 `04-项目总控/伏笔追踪.md`（`plantedChapter` 已是数字，无需解析章节名）。跳过已回收（`resolved`）、低重要度（`low`）、埋设章号缺失/非法的条目——后者会让 `distance = 当前章 - 0` 把每条都判成 critical。
- `extractForeshadowKeywords`：短伏笔（4–12 字）整体作为关键词；长伏笔按标点切分，只保留 4–16 字片段（最多 4 个）。过短关键词会在无关段落命中、把未回收判成已回收（漏报），过长的整句又匹配不到（误报），因此宁漏勿误；<4 字的名称直接丢弃。
- `CoWritingView#loadForeshadowsForDeviation` 按项目缓存 60s（与人物档案同为项目级静态数据），读取失败降级为空列表，不影响其它 5 类检测。
- `DeviationDetector#hashContext` 已纳入伏笔的 id / recovered / keywords，伏笔档案变化会自动让旧缓存失效，无需额外改动。
- 6 例单测：正常映射、跳过 resolved/low/非法章号/空内容、id 兜底、关键词抽取边界。

**32. 质量历史追加串行化（`services/quality-history-store.ts`）**
- `appendQualityHistory` 是「读文件 → 合并 → 覆盖写」。两条写入口（协同实时落盘、面板 B 节流落盘）并发时各自读到同一份旧文件，后写者覆盖先写者，**确认会丢记录**：并发追加两条，落盘只剩一条（新增用例先复现为红）。
- 按项目维护 promise 队列串行化读-改-写；不同项目互不阻塞；队列尾部只清理自己那一格，避免误删后续追加建立的队列。
- 2 例单测：同项目并发追加两条都保留、不同项目并行追加互不影响。

**33. 主角识别统一 + 场景兜底不再用「主角」占位（`shared/protagonist.ts` / `ui/scene-confirm-modal.ts`）**
- 场景确认的兜底扩写（主生成链路失败/空结果时）用 `plugin._workbenchState?.protagonistName || '主角'` 填主角名，但 `_workbenchState` 全仓没有写入方（只有声明与读取）→ 兜底提示词里的主角名恒为「主角」占位，而 `characters` 列表里其实有真实人物。
- 新增 `shared/protagonist.ts`：`roleIndicatesProtagonist(role)` 统一「身份」判定（支持字符串/数组，兼容「主角」「主人公」），`findProtagonistName(characters)` 从人物 frontmatter 取主角名（`name` → `姓名` → `fileName`，去 `.md` 后缀）。
- 场景兜底改为「工作台状态 → 人物列表解析 → 默认值」三级回退；`CoWriterEngine#getProtagonistName` 的扫描分支改用同一判定函数，两处不再是两份 `includes('主角')` 实现。
- 5 例单测：身份字符串/数组/组合写法、配角与非字符串、姓名/fileName 回退、空输入。

**34. 质量历史样本门槛统一（`shared/quality-history.ts` / `ui/monitor-panel-b.ts`）**
- `WritingQualityEngine` 在正文 <100 字时返回「内容不足」的空结果：总分与六维全 0。面板 B 的 `addToQualityHistory` 没有门槛，会把 0 分记录写进 `qualityHistory`、`baselineHistory` 并在 30s 节流后落盘 → 基线均值被拉低、「高于/低于基线」判反，还挤占 200 条历史配额。
- 协同实时落盘已有 300 字门槛，面板 B 没有 → 两条写入口口径漂移。
- 新增 `isQualitySampleUsable(wordCount)`（门槛复用 `QUALITY_LIVE_PERSIST_MIN_CHARS`）：协同 `persistLiveQualityIfDue` 与面板 B `addToQualityHistory` 共用；`NaN`/`Infinity` 一律视为不可用。
- 2 例单测：300/299 边界、0 与非法字数。

**35. 切章不丢质量样本：去掉落盘在途丢弃 + restore 改为合并（`ui/monitor-panel-b.ts`）**
- `persistQualityHistory(force=true)` 在切章时调用，但被 `qualityPersistInFlight` 无条件 `return`：若上一次 30s 节流落盘仍在途，切章强制落盘被静默丢弃，紧接着 `qualityHistory` 被清空 → 本章最后一次评估**永久不落盘**。
- `appendQualityHistory` 已按项目串行化、`mergeQualityHistory` 已按「章键+时间+总分+字数」去重，面板层不需要再自己拦并发；删除该守卫后重复入队不会写出重复记录。
- `restoreQualityHistory` 原为 `baselineHistory = records` 直接覆盖：加载期间（切章后 500ms 防抖即评估）写入的会话增量会被抹掉，基线与趋势瞬间回退成磁盘旧数据。改为 `mergeQualityHistory(records, baselineHistory)`。
- 基线是项目级样本：新增 `currentBaselineProject`，换书时清空 `baselineHistory`，避免合并时把上一本书的记录算进新书基线。
- 1 例单测：磁盘快照（第 1、2 章）与会话增量（第 3 章）合并不丢不重。

**36. 11 步流水线 prompt 闸门修正（`shared/prompt-budget.ts` / `engine/step-runner.ts`）**
- `StepRunner` 在「大纲摘要」步骤把 `outlineKnowledgeInjection` 拼进 `effectiveUserPrompt`，但 token 估算用的是 `systemPrompt.length + userPrompt.length`，**漏算刚拼进去的知识注入** → 本地 8K 窗口下可能超预算却不触发截断。
- 更严重的是截断分支用 `userPrompt` 重建 `effectiveUserPrompt`：注入被静默丢弃，只有一条「中间资料已截断」的通用提示，用户无从知道风格/节奏/题材知识没进去（静默降级）。
- 新增 `fitPromptToContext`（`shared/prompt-budget.ts`）：按 `estimateInputTokens` 计算 system+user+注入的总量，安全线为 `maxContext - maxOutput - TOKEN_SAFE_BUFFER`；超预算时按优先级处理——**先整段丢弃增强尾部（注入），主体仍放得下就不截断主体**；主体自身超预算才做头尾保留截断（中间资料让路）。
- `StepRunner` 改用该函数，`droppedExtra` 写预算日志，`truncated` 保留原有用户可见提示。
- 5 例单测：预算充足、注入导致超预算只丢注入、主体超预算截断中段、两者都超、极小窗口尾部仍保留。

**37. 批量断点续跑不再重复结算（`ui/full-writer/batch-targets.ts` / `batch-pipeline-runner.ts` / `ui/batch-novels-modal.ts`）**
- 结算流程对伏笔库（`appendAfterSectionHeader`）、实体互信息（`appendToMutualSection`）、时间线都是**追加**写入；而批量续跑只按「步骤文件是否存在」判断完成，不看结算状态。
- 后果：批量跑 5 章，第 1–3 章结算成功、第 4 章失败；用户再次点批量并开启断点续跑 → 第 1–3 章步骤全跳过，但**再次执行 `SettlementEngine.settle`** → 伏笔/关系/时间线出现重复行。
- 新增 `isBodySettled(bodyText)`：只解析正文 frontmatter 的 `status`（`settled` / `已结算` / `已完稿`），正文里出现同名字样不误判。
- `runChapter`：`resume !== false` 且「步骤齐全 + 已结算」→ 整章返回 `skipped`；结算前再加守卫，已结算章节不再调 `settle`（`resume=false` 显式强制重跑仍允许）。
- `batch-novels-modal` 汇总显示「跳过 N 章（已结算）」，不再把跳过的章算进「完成 0/N」。
- 4 例单测：三种已结算状态、三种未结算状态、无 frontmatter/空正文、正文同名不误判。

**38. 生成前守卫支持本地免密钥端点（`shared/ai-credentials.ts` / `main.ts` + 19 个 UI/engine 入口）**
- `AIApiClient` 早已对本地推理端点豁免密钥（`isKeylessLocalEndpoint`），但 UI 层 20 处生成入口直接检查 `settings.apiKey`，把「本地 Ollama + 空密钥」挡在请求之前 → 用户看到「请先配置API密钥」，所有生成入口不可用。这直接违背「降低云端依赖」的目标。
- 新增 `shared/ai-credentials.ts#hasUsableAiCredentials(settings)`：有密钥，或 `apiEndpoint` 经 `resolveProviderSourceType` 判定为 `local`（显式 `sourceType` 优先，其次 id/endpoint 启发式）。
- `NovelWriterPlugin` 新增 `get hasAiCredentials()`，UI/engine 守卫统一改用该访问器；文案统一为「请先配置 API 密钥或本地模型端点」。
- 覆盖入口：自动写作、批量章节、继续章节、章节工作台、写作计划、AI 建项目（两处）、同人设定、世界观、人物/地点/物品/势力生成、标签、卷简介、文风蒸馏、番茄榜分析、统一实体补全、审查 Agent（两处）。
- 6 例单测：密钥优先、空配置、localhost/127.0.0.1、云端端点、自定义 provider 显式 local、provider 显式 cloud 不被 localhost 字样误导。

**39. 同人约束注入实体生成（`shared/fanfic-rules.ts` + 6 个实体生成入口）**
- 同人项目的实体生成只拿到「世界观 + 设定库 + 用户描述」，看不到「原作核心设定 / 创作规则」→ 生成的人物、势力、地点可能直接违反原作力量体系或红线，而这些实体卡又会成为后续 OOC 检测的比对基准，错误会被放大到长篇。
- 新增 `mergeFanficRequirement(fanficBlock, extra)`：同人块固定在前、用户要求在后，空块时透传用户要求；统一 6 处入口的拼接方式，避免「有的入口带约束、有的没有」导致生成标准漂移。
- 接入入口：人物/势力/地点/物品单实体生成弹窗、统一实体生成弹窗（人物/势力/地点/物品四类）、AI 建项目面板的单个与批量两条路径（人物按 2 个/批循环时同样携带约束）。
- 原创项目 `formatFanficRulesForPrompt` 返回空串，`mergeFanficRequirement` 直接透传，prompt 不留同人痕迹。
- 3 例单测：同人块在前、空用户要求只剩同人块、原创透传并裁剪首尾空白。

**40. 同人设定保存不丢文件 + 同人路径解析收敛（`ui/full-writer/fanfic-settings-utils.ts` / 6 处解析点）**
- `AddFanficSettingModal` 覆盖保存用 `vault.delete` + `vault.create`：两步之间任一失败，旧设定已被删除而新文件不存在，`.project` 仍指向该路径 → `readFanficRules` 返回空规则，所有同人约束静默失效且无任何提示。
- 新增 `saveFanficSettingFile(app, filePath, content)`：已存在走 `vault.modify`，不存在才 `create`；覆盖模态改用它，不再删除文件。
- 收敛 6 处重复的「## 同人设定路径」正则到 `shared/fanfic-rules.ts#parseProjectMeta`：`ai-worldview-generator`、`wizard-controller`、`wizard-step-validators`、`wizard-step-renderers`、`wizard-step-executors`、`template-validator#detectTimelineStrategy`。其中 `template-validator` 的旧正则只认 `\n`，CRLF 文件会解析不到路径。
- 2 例单测：覆盖保存不调用 `delete` 且内容更新、文件不存在时创建。

**41. 知识检索 position 单位修正（`shared/knowledge-position.ts` + 3 处渲染）**
- `KnowledgeSearchResult.position` 是样本在分块数组中的**下标**（0 基，来源 `chunkOriginalText` 与报告切段），但 3 处直接 `position * 100` 当作百分比：
  - 节奏知识注入 prompt 会出现「（位置4500%）」这种无效信息，白占预算还可能误导模型；
  - 知识浮窗的技巧卡片与相似原文卡片显示「4500%」。
- 新增 `formatKnowledgeChunkLabel(position)`：`片段#N`（下标 +1），缺失/负数/NaN/Infinity 返回空串；3 处统一改用它。
- 5 例单测：0 基换算、大下标不乘 100、缺失、非法值、小数取整。

**42. 指纹强度配置读盘链路修复（`engine/style-fingerprint-library.ts` / `engine/prompt-builder.ts` / `ui/views/writing-fingerprint-view.ts`）**
- `loadIntensityConfigs` 此前只有定义、**零生产调用方**，而 `getIntensityConfig` 只查内存 Map：重启后所有指纹一律回落默认强度 1.0，用户在强度弹窗里的设置在 prompt 中完全不生效；弹窗构造时同步读取，也看不到上次保存值。
- `getFingerprintPromptParts` 在组装强度 Map 前先 `loadIntensityConfigs()`；打开强度弹窗前也先 `load`，保证弹窗显示的是磁盘值。
- `setIntensityConfig` / `removeIntensityConfig` 首行先读盘再写：否则新会话里只改一个指纹，会把 `{ [fpId]: config }` 整份写回，抹掉其他指纹已保存的强度。
- `loadIntensityConfigs` 保持**每次读盘、不做实例内缓存**：强度弹窗与协同引擎各自持有 `StyleFingerprintLibrary` 实例，缓存会让「弹窗里改完、协同 prompt 仍用旧强度」静默发生。
- `saveIntensityConfigsInternal` 不再吞掉写入异常：此前失败只 `log.warn` 并正常返回，弹窗仍提示「已保存」，用户重启才发现设置丢失；现在异常上抛，两个调用方（强度弹窗 / 融合弹窗）已有 try-catch 会展示失败提示。
- 8 例单测：未加载只得默认值、加载读到磁盘值、重复 load 以磁盘为准、跨实例可见、单改/删除不抹掉其他指纹、损坏文件降级为空、写入失败上抛。

**43. 协同静态上下文刷新不再清空运行时上下文（`engine/co-writer-engine.ts#refreshStaticContext`）**
- `refreshStaticContext` 用 `buildSnapshot` 整体替换 snapshot，而 `buildSnapshot` 把 `fanficRulesContext` / `longTermMemoryContext` / `crossVolumeContext` 初始化为空串、`relationshipStates` 初始化为空数组 —— 这些字段是 `init` 阶段单独加载的，刷新后会被整片清空：同人约束、长篇记忆、跨卷上下文与人物关系静默消失，直到重新加载章节才恢复。
- 刷新时保留这四个字段，只让 `gatherAll` 覆盖它真正提供的静态字段。
- 1 例单测：刷新后四类上下文仍在。

**44. 同人约束覆盖迭代/联想 + 会话内热更新（`engine/prompt-builder.ts` / `engine/co-writer-engine.ts`）**
- `buildIteratePrompt` 与 `buildAssociationPrompt` 此前没有 `fanfic` 片段：同人项目里迭代候选、联想续写可以生成违反原作力量体系/红线的文本，而续写与选区改写却有约束。现已按 priority 98 补入。
- 新增 `CoWriterEngine#syncFanficRules(project)`：`suggestNext` / `suggestStream` / `rewriteSelection` / `iterateSuggestion` / `suggestAssociation` 生成前重读 `.project` + 同人设定（两个小文件，相比本地模型数秒生成可忽略），编辑设定后无需切章即可生效；`init` 与 `refreshStaticContext` 复用同一方法。
- 读不到设定（未绑定/文件被删）时按无约束处理并清除旧块，避免继续沿用已失效的原作规则。
- 3 例单测：迭代/联想 prompt 携带同人块、首次读盘、编辑后读到新内容。

**45. 实时质量评估跨章污染修复（`ui/co-writing-view.ts` / `shared/quality-history.ts`）**
- `evaluateRealtimeQuality` 异步评估期间切章/切项目时，返回后仍会用旧正文的分数更新顶栏，并调用 `persistLiveQualityIfDue` —— 而后者用**当前** `chapterNum`/`chapterName` 构造章键，等于把上一章的分数写进新章节，污染趋势与基线（与「跨书同章号串用上一章正文」同类）。
- 新增 `isSameQualityEvalTarget`（项目 + 章号 + 正文路径）：评估发起前记录身份，返回后不一致则直接丢弃，不显示、不落盘；失败提示同样只在身份一致时展示。
- 4 例单测：同身份、切章、切项目、同章号不同卷。

**46. 指纹向量检索丢失归属 + 禁用指纹仍被注入（`engine/local-vector-store.ts` / `engine/prompt-builder.ts` / `engine/style/dynamic-injection-engine.ts`）**
- `VectorStore.search` 只返回 `{ sample, score }`，`LocalVectorStore` 遍历 `Map<fingerprintId, samples>` 时丢弃了键 → 上游拿不到样本归属。
- 后果 A：`DynamicSampleSelector` 把所有样本记为同一指纹（`__no_fp__`），触发「同一指纹最多 2 条」的多样性上限，请求 topN=3 实际只能拿到 2 条，风格示例被静默削掉一条。
- 后果 B：向量文件按指纹分文件落盘，禁用某个指纹只改启用标记、不删向量文件；检索仍会命中并注入其样本，等于「禁用无效」。
- `search` 返回类型增加可选 `fingerprintId`，`LocalVectorStore` 用 Map 键回填；`getFingerprintPromptParts` 按 `enabledFingerprints` 过滤检索结果，并把真实 `fingerprintId` 传给选择器。
- `DynamicSampleSelector` 仅在有 `fpId` 时累计/判断 2 条上限：缺失归属的样本不再互相挤占名额（旧实现/测试桩无 fpId 时不至于退化）。
- 4 例单测：fpId 缺失可返回 3 条、禁用指纹样本不进入 prompt、无 fpId 样本不被过滤、同一启用指纹仍受 2 条上限。

**47. 向量实例缓存导致新指纹不生效（`engine/local-vector-store.ts`）**
- `LocalVectorStore` 只在首次使用时读盘（`loaded = true` 后永久跳过）。指纹库 UI 新增/重建指纹走的是**另一个实例**，向量文件已更新，但协同引擎实例的 `vectors` 仍是旧快照 → 新指纹样本检索不到，必须重启 Obsidian。
- `ensureLoaded` 改为比较「向量文件签名」（路径 + mtime + size）：签名变化才重载，未变化仍走内存；目录不可读时返回 `null` 并保留内存旧向量，避免临时 IO 失败清空索引。
- `loadAllFromDisk` 重载前先 `clear()`：被删除的指纹向量文件不会残留在内存里。
- 测试 mock 的 `Vault#getFiles()` 补 `stat.size`（此前恒为 0，无法模拟文件大小变化）。
- 3 例单测：跨实例新增可见并带回 `fingerprintId`、跨实例删除同步消失、跨实例追加后条数增加。

**48. 指纹列表跨实例陈旧导致新指纹/禁用不生效（`engine/style-fingerprint-library.ts` / `engine/co-writer-engine.ts`）**
- `StyleFingerprintLibrary` 只在 `CoWriterEngine.init` 时 `loadGlobal` / `loadProject` / `loadGlobalState` 一次；指纹库 UI 是另一个实例，会话中新增/删除/启用/禁用只写磁盘。
- 后果 1：新指纹不在 `getEnabledFingerprints` 里，第 46 条新增的「检索样本按启用指纹过滤」会把新指纹样本一起过滤掉，向量刷新等于白做。
- 后果 2：用户在指纹库禁用某指纹后，协同引擎内存里仍是启用状态，禁用依旧无效。
- 新增 `computeFingerprintSignature`（全局指纹 + 项目指纹 + 项目全局启用状态，路径 + mtime + size）与 `reloadIfChanged`：签名变化才重载，文件不可读时返回 `null` 并保留内存状态。
- `CoWriterEngine#syncFingerprints` 在 5 个生成入口（续写 / 流式续写 / 选区改写 / 迭代 / 联想）与同人约束一起刷新。
- 4 例单测：新增项目指纹、禁用项目指纹、新增全局指纹、文件未变化不重复读盘。

**49. 知识向量跨实例陈旧导致新书检索不到（`engine/knowledge-vector-store.ts`）**
- `KnowledgeVectorStore.init()` 只在首次调用时读盘，`loaded = true` 后 `ensureLoaded` 直接返回；拆解调度器写入的是 `EngineRegistry` 的单例，协同引擎持有另一个实例。
- 后果：新书拆解、重新拆解、删书后，协同续写的知识检索仍用旧索引，直到重开协同视图/重启。
- 与 `LocalVectorStore` 同款修复：新增 `loadedSignature`（路径 + mtime + size）与 `reloadIfChanged`，`init` / `ensureLoaded` 都走签名判断；`loadIndex` 成功时先 `clear()`，已删除的书不残留；目录不可读时保留内存旧向量。
- 4 例单测：跨实例新增书、删除书、重新拆解后只看到新样本、文件未变化不重复读盘。

**50. 场景设定注入按不存在的 `worldview` 维度检索（`engine/knowledge-injector.ts`）**
- 知识库拆解只产出 `style / rhythm / technique / structure / character / foreshadow / original` 七种维度，`KnowledgeVectorSample.dimension` 也没有 `worldview`。
- `buildSceneWorldviewInjection` 却按 `dimensions: ['worldview']` 检索，永远返回空 → 场景注入的「参考世界观（场景设定）」段静默失效；配置里的 `kbWorldview` 开关与 `dimensionWeights.worldview` 权重（默认 0.6）同样白设。
- 正文路径的 `buildKbWorldviewInjection` 早已改用 `structure`，两条路径口径不一致。
- 统一改为 `structure`（结构拆解是唯一可用的设定类数据源），并把标题/维度标签改为「参考设定（结构拆解）」「结构设定」，避免把起承转合结构分析冒充世界观。
- 2 例单测：场景设定段按 `structure` 检索并返回内容；正文设定段使用同一维度且标注来源。

**51. 文风注入的相邻原文块重复占预算（`shared/knowledge-position.ts` / `engine/knowledge-injector.ts`）**
- 原文按 400 字 / 40 字重叠分块，检索命中的相邻块（position 差 1）包含同一段重叠文本；`buildKbStyleInjection` 把 `style` 与 `original` 混排后每本书取前 3 条，重复块直接浪费 prompt 预算（本地小窗口尤其明显）。
- 新增 `dedupeAdjacentChunks`：同一本书内 position 相邻的原文块只保留分数更高的一条，跨书互不影响，非 `original` 维度与缺 `position` 的结果原样保留。
- 文风注入改为先按 `topN * 2` 检索，再做相邻去重，最后截断到 `topN`：避免去重后条数不足。
- 5 例单测：相邻保留高分、跨书独立、非原文/缺 position 原样、`maxGap` 可调、注入层只出现一条相邻块且检索已扩量。

**52. 技巧注入被结构样本挤占类别名额（`engine/knowledge-injector.ts`）**
- `buildKbTechniqueInjection` 检索 `['technique', 'structure']`，再按 `category` 去重、最多 5 类。
- `structure` 样本的 category 是「起 / 承 / 转 / 合」：分数靠前时会直接占掉 4/5 个类别名额，真正的写作技巧只剩 1 类。
- 同一批结构文本已经在「参考设定（结构拆解）」段注入，技巧段再取一次等于重复占预算。
- 改为只检索 `technique` 维度，职责分离：技巧段讲手法，设定段讲结构。
- 1 例单测：技巧检索的 `dimensions` 仅含 `technique`。

**53. 协同续写前文固定 800 字，快照后 1200 字被静默丢弃（`shared/prompt-budget.ts` / `engine/prompt-builder.ts`）**
- `CoWriterEngine#updateSnapshot` 保留 `confirmedText.slice(-2000)`，但 `buildSuggestionPrompt` / `buildIteratePrompt` 的必保片段固定 `precedingText.slice(-800)`，两者没有一致性说明，也没有日志。
- 预算实测：本地 8192 窗口（`CO_WRITE_NUM_CTX` 封顶）扣掉输出后约 7472 token；800 汉字 ≈ 533 token，仅占 7%。云端 32K 窗口更只占 1.6%——前文长度与模型能力完全脱钩。
- 新增 `resolvePrecedingCharLimit(maxInputTokens?)`：按输入预算 20%、中文 1.5 字符/token 换算，结果夹在 `[800, 2000]`。本地 8K 取满 2000，云端大窗口同样 2000（与快照上限对齐），极小窗口回落到 800，不弱于旧行为。
- 续写与句级迭代两条链路的「已写内容 / 已写前文」都改用它；无预算时保持 800，旧调用行为不变。联想（300 字）与选区改写（500 字前文）是句级/局部任务，不在此列。
- 7 例单测：无预算/零预算=800、本地 7472=2000、超大窗口不超 2000、极小窗口回落 800、中间窗口线性收紧；以及续写 prompt 在大窗口含 1006 字处标记、小窗口只含 403 字处标记、无预算同小窗口。

**54. 实时质量评估在途时丢弃新输入，顶栏停在旧分数（`ui/co-writing-view.ts`）**
- `evaluateRealtimeQuality` 开头 `if (text.length < 50 || monitor.isEvaluating()) return;`：评估慢于 2.5s 防抖时，期间的每次触发都被直接丢弃，且不会重新排队。
- 用户停手后不再有输入事件，最后一次文本永远不会被评估；顶栏显示的是「评估开始那一刻」的旧正文分数，直到再次输入或切章。
- 新增 `qualityMonitorPending`：在途时只记一个待办，由本次评估的 `finally` 在释放 monitor 后补跑一次（最多一次，不会并发、不会无限递归）。
- `busy` 竞态同样改为挂起而不是丢弃；它由持有 monitor 的那次评估负责消费，避免两个调用互相重试形成递归。
- 关闭实时质量开关、正文不足 50 字时清空待办，避免空转。
- 4 例单测：在途触发只挂起且结束后补跑一次、`busy` 只挂起不展示失败、关闭开关清空待办、正文过短清空待办。

**55. 场景知识注入拼进 system，绕过预算裁剪（`engine/prompt-builder.ts`）**
- `buildSuggestionPrompt` 把 `injectForBodyGeneration` 的输出直接追加到 `systemPrompt`；`assemblePromptWithinBudget` 只裁剪 `sections`，`systemPrompt` 与 `tailParts` 永不裁剪。
- 注入包含风格/节奏/技巧/人物/伏笔/规则六段，各段虽有样本截断，但「风格要求」「写作规则」来自项目文本，合计可达 2000-4000 字（约 1400-2700 token）。叠加 2000 字前文与设定/简报片段后，本地 8K 窗口可能直接 `overBudget=true`。
- 后果：Ollama 按 `num_ctx` 从尾部截断，最先丢的是「已写内容 / 写作方向 / 输出约束」——模型看不到任务本身。
- 改为 `sections` 中的 `knowledgeInjection`（priority 70、shrinkable）：预算紧张时先截断再丢弃；priority 高于 drivers(60)/context(40)/knowledge(25)/memory(20)，低于灵魂(90)/简报(95)/同人(98)/节点(100)。`system` 只保留静态硬规则（视角、文体、输出语言、格式契约）。
- 无预算时行为不变：注入仍完整进入 user prompt。
- 3 例单测：预算充足时注入完整在 user 且 system 不含注入、超预算时注入被裁而「已写内容/写作方向/收尾指令」完整保留、无预算时注入仍完整。

**56. 选区改写 / 联想的项目规则与文笔风格拼进 system（`engine/prompt-builder.ts`）**
- `buildRewritePrompt` 的 system 含 `writingRules.slice(0, 3000)` 与整份 `writingStyle`；`buildAssociationPrompt` 含 `writingRules.slice(0, 2000)` 与整份 `writingStyle`。
- 协同快照的 `writingStyle` 直接取 `getRaw(data.writing_style)`，没有长度上限（11 步流水线的 `ContextManager` 才有 `slice(0, max)`）；文笔风格文件写到 5000 字以上并不少见。
- 与第 55 条同因：system 不参与 `assemblePromptWithinBudget`，风格越长越可能把 prompt 顶过窗口，本地模型从尾部截断时丢的是「选中文本 / 改写目标 / 上下文 / 联想提示」。
- 两条链路的项目规则 + 文笔风格统一抽成 `projectStyleText`，作为 `projectStyle` section（priority 85、shrinkable）：预算紧张时先截断再丢弃，优先级高于场景知识注入(70)/驱动(60)/知识库(25)/记忆(20)，低于同人约束(98)/简报(95)。
- system 只保留静态规则（视角、输出语言、格式契约、任务说明）。
- 4 例单测：改写超预算时风格被裁而选中文本/改写目标保留、改写预算充足时风格完整、联想超预算时上下文与提示保留、无预算时风格完整（行为不变）。

**57. 技巧参考段仍混检 structure，结构类别被当成技巧（`engine/prompt-builder.ts`）**
- `getKnowledgePromptParts` 的合并检索 `dimensions: ['style', 'rhythm', 'technique', 'structure']`，并把 `dimension === 'structure'` 的结果并入 `techniqueResults`。
- 动作/对话方向会按 category 过滤掉结构样本，但情绪等默认方向直接 `slice(0, 3)`：结构样本以「技巧：起 / 承 / 转 / 合」的形式进入 prompt（如「技巧：起92%」），挤掉真实技巧条目。
- 与知识注入段（第 52 条）同源，但这是另一条路径（`PromptBuilder` 的知识片段），上次只修了 `KnowledgeInjector`。
- 合并检索改为 `['style', 'rhythm', 'technique']`，技巧结果只取 `technique` 维度；没有技巧样本时该段为空，而不是拿结构冒充。
- 2 例单测：structure 样本不进入技巧参考且检索维度不含 structure、动作方向仍优先保留动作类技巧。

**58. 知识片段的原文片段未做相邻块去重（`engine/prompt-builder.ts`）**
- `getKnowledgePromptParts` 的原文检索 `topN: 3` 后直接 `slice(0, 3)` 渲染。
- 原文按 400 字 / 40 字重叠分块，相邻 position 的块共享 40 字；两条同时命中时会在 prompt 里重复同一段文本，本地小窗口下等于白占预算。
- 注入段（`KnowledgeInjector#buildKbStyleInjection`）已在第 51 条接入 `dedupeAdjacentChunks`，知识片段路径漏了；这是同一个问题在第二条消费路径上的残留。
- 改为 `topN: 6` 检索 → `dedupeAdjacentChunks` → `slice(0, 3)`，与注入段口径一致。
- 1 例单测：同书相邻 position 只保留高分块、独立块仍保留、原文检索 topN 为 6。

**59. 实时监控的外部 AbortSignal 监听只挂不摘（`engine/quality/realtime-monitor.ts`）**
- `evaluate` 收到外部 signal 时 `addEventListener('abort', handler, { once: true })`，但成功 / 失败 / 取消三条收尾路径都只走 `cleanup()`，而 `cleanup()` 只清 `currentAbort`，从不 `removeEventListener`。
- `once: true` 只在真的触发 abort 时自动摘除；正常评估完成时监听会一直留在 signal 上。视图级 controller 若跨多次评估复用，每次评估都会多挂一个闭包，且旧闭包持有已作废的 `internalAbort`。
- 现状说明：当前生产代码没有调用方给 `evaluate` 传第三个参数（协同视图用的是 monitor 内部 controller），所以这是公开 API 的契约缺陷 / 潜在泄漏，不是已在线上复现的性能问题；但接口既然收 signal，就必须配对释放。
- 新增 `externalAbortListener` 字段记录「signal + handler」，新增 `detachExternalAbort()`；`cleanup()`、`reset()`、`dispose()` 统一调用。`reset` / `dispose` 是异常恢复与视图关闭的兜底路径，同样不能留监听。
- 外部 signal 已 abort 的早退分支补 `this.currentAbort = undefined`：此前只发取消了事件，`currentAbort` 会残留到下一次评估。
- 2 例单测：评估正常结束后 `removeEventListener('abort', fn)` 被调用、signal 已 abort 时返回 `cancelled` 且不残留 `currentAbort` / 状态回 `idle`。

**60. 已删除书籍的遗留向量仍参与检索（`engine/knowledge-vector-store.ts`）**
- `loadIndex` 扫描向量目录下所有 `kb_*.json` 直接载入，不校验对应书籍是否还在知识库里。
- 真实现场（本工作区 `data/knowledge-vectors/`）：8 个向量文件（将夜等，7/11–7/21 写入），而 `写作知识库/` 只剩 `_config`（10/19 后书目录已清空）。协同写作的知识注入与知识片段因此一直在检索 8 本已不存在的书。
- 成因：`deleteBook` 的向量清理只覆盖「经管理器删书」；重新导入会生成新 `bookId`，旧文件不会被认领；用户在文件管理器直接删目录也不会触发清理。
- 改为在 `loadIndex` 中对每个向量文件校验 `kbBookDir(bookName)` 是否存在，缺失则跳过加载并汇总一条 `info` 日志；只跳过、不删文件，用户临时移走书目录后仍可恢复。
- 防误伤：仅当知识库根目录（`写作知识库`）存在时才做校验。整个知识库被移动/重命名时保持旧行为，避免把仍有效的向量全部判成孤儿。
- 测试同步：`knowledge-vector-store-refresh` / `knowledge-vector-store-replace` 的用例补建书目录（向量本就属于在架书籍）；新增 2 例——书目录消失后检索不到、根目录整体缺失时仍可检索。

**61. 原文分块与拆解报告样本二选一，重拆后三个 prompt 段整段消失（`services/deconstruction-scheduler.ts`）**
- `vectorizeBook` 先用原文分块填 `samples`，随后 `if (samples.length === 0)` 才提取拆解报告维度——原文可用时**只**写 `original`，原文缺失时**只**写 6 个报告维度。
- 后果一（有原文）：`getKnowledgePromptParts` 的「风格参考 / 节奏参考 / 技巧参考」与 `KnowledgeInjector` 的同名注入段全部检索不到样本，重拆一次后整段消失。
- 后果二（无原文）：本工作区实测 8 本书的向量文件均为 0 个 `original` 样本，「原文片段」段恒空；该功能在真实库里从未生效。
- 两者是互补关系而非替代：风格/节奏/技巧/结构/人物/伏笔只存在于报告里，原文只提供句法质感。改为无条件提取报告维度，与原文分块取并集；各提取器读不到文件时本就返回空数组，缺失场景不受影响。
- 1 例单测：同一本书有原文时，写入的样本同时含 `original` 与 `style/rhythm/technique/structure/character/foreshadow`（旧逻辑下 `style` 等维度必然缺失）。

**62. 文风注入把 style 与 original 混检，风格样本被原文分块挤光（`engine/knowledge-injector.ts`）**
- `buildKbStyleInjection` 用一次 `search({ dimensions: ['style', 'original'] })` 取 `topN * 2` 条，声称「原文分块与风格样本一起作为文风参考」。
- 样本量差距是结构性的：style 每本书约 5 条（拆解报告切段），原文分块每本最多 120 条（400 字/块）。同一个 topN 里原文几乎必然占满，「风格分析样本」长期为零——注入段标题写着「风格片段」，实际只有原始正文。
- 第 61 条修复后原文分块会真正写入向量库，这个饥饿会从潜在变成必然，因此同批修复。
- 改为分维度检索：style 取 `topN` 条、original 取 `originalQuota * 2` 条再去相邻去重；风格固定配额 `max(1, round(topN/3))`，原文占其余。合并后按分数排序截断。
- 风格侧不足时用风格剩余结果回填（`remaining`），原文侧不做反向补位：渲染端每本书最多展示 3 条，单本情况下补位不可见。
- 3 例新单测 + 1 例旧单测改写：两个维度分别检索、风格样本不被挤掉、原文为空时用风格补齐、风格为空时仍可只靠原文并保持相邻去重；原「多取候选」断言改为风格 4 / 原文 6。

**63. 实时质量落盘在无本次结果时二次评估（`ui/co-writing-view.ts` / `engine/quality/realtime-monitor.ts`）**
- `persistLiveQualityIfDue` 用 `qualityScore?.v1Result ?? this.qualityKernel.evaluate(text)` 兜底：quality 子任务失败或评估被取消时，`result.qualityScore` 为空，于是再完整跑一次 WQE。
- 后果一：`QualityScoreEngine#evaluate` 内部的 `recordHistory` 会多记一条，污染趋势窗口——这正是 `DEVELOPMENT.md` 早已写明「不得再调一次」的原因，但兜底路径绕过了该约束。
- 后果二：顶栏此时显示「质量 --」，历史却写入一条场外计算的分数，UI 与基线口径不一致。
- 改为只复用本次评估的 `v1Result`；缺失时记一条 `warn` 并跳过落盘（节流时间戳不更新，下一次成功评估仍可写入）。生产链路注入 `v1Engine`，正常成功路径必然带 `v1Result`，不受影响。
- 删除 `RealtimeMonitor#buildEmptyScore`：全仓无调用方，注释「用于部分失败时持久化」与「部分失败不落盘」相冲突，保留只会误导下一个接入者。
- 4 例单测：无 `v1Result`（含 `undefined` 与空 `qualityScore`）时不调用 `qualityKernel.evaluate` 且不写历史、有结果时按该结果落盘、同章 10 分钟窗口内不重复写、低于门槛的短文本不写。

**64. 指纹强度 0 只禁用描述、不禁用示例（`engine/prompt-builder.ts`）**
- 「禁用指纹」有两条判定源：`StyleFingerprint.enabled`（列表开关）与强度配置 `globalIntensity === 0`（`StyleIntensityEngine#previewIntensity().disabled`）。样本过滤只查第一条。
- 后果：强度设为 0 时 `TieredInjectionBuilder#buildGlobalTier` 不再输出该指纹的特征描述，但向量检索仍返回它的样本，`buildParagraphTier` 的 `sampleCount` 上限取「所有未禁用配置的最大值」，于是这些样本照旧以「参考片段」注入——界面显示已禁用，正文仍被该指纹影响。
- 改为在 `getFingerprintPromptParts` 中先读盘强度配置、算出 `disabledFpIds`，再与 `enabledIds` 一起过滤检索结果；`fingerprintId` 缺失的旧数据仍放行（无法判定归属）。
- 测试补充：`prompt-builder-fingerprint` 支持按指纹注入强度配置，新增 2 例——强度 0 的指纹即使 `enabled` 也不注入样本、强度 0.5 时样本照常注入（防止过度过滤）。

**65. 11 步流水线 prompt 闸门用全局设置而非本步模型能力（`engine/step-runner.ts` / `shared/prompt-budget.ts`）**
- `executeCurrentStep` 把 `this.plugin.settings.maxContext` / `maxOutput` 交给 `fitPromptToContext`，而 `stepModel` 是按 `currentStep.modelStrategy` 从 pro/flash/default 里选的——两者可以完全不同。
- 后果：设置里留着云端值（默认 128000/32768）、当步走本地 8192 窗口模型时，闸门算出的安全线约 12 万 token，永远不会触发裁剪；同一个请求随后由 `ai-api-client` 按本步模型真实能力重算，`available < 512` 直接被拒绝（用户看到「输入过长…请减少上下文」），或不走那条分支而被 Ollama 按 `num_ctx` 从尾部硬截，丢掉的正好是 prompt 末尾的「已写内容 / 写作方向 / 输出约束」。
- 新增纯函数 `clampBudgetToModelLimits(configured, modelLimits?)`：模型值有效（有限正数）时与设置值取较小值——模型能力是硬上限，设置值是用户主动设的成本上限；模型值缺失或非法时保持设置值，不改既有云端行为。
- `StepRunner` 新增 `resolveStepBudgetLimits(stepModel)`：按本步模型解析能力再收窄，解析抛错时回退设置值（模型名可能来自用户手填，不能让闸门因解析失败而中断）。
- 4 例单测：模型窗口更小取模型值、模型更大保留设置值、缺失/0/负数/NaN/Infinity 回退设置值、两字段独立收窄。

**66. 正文生成与润色的指纹来源是一套从未写入的数组（`engine/knowledge-injector.ts` / `ui/polish-editor.ts`）**
- 两条路径都按 `profile.fingerprint.enabledProject/enabledGlobal` 里的 id 去库里查指纹；全仓只有默认值与读取，没有任何写入方（无 UI、无迁移），数组恒为 `[]`，因此 `buildStyleInjection` 的「【写作指纹风格参考】」与润色的「写作指纹风格参考」永远不会出现。
- 后果：用户在指纹库里「启用」后，只有协同写作（`PromptBuilder#getFingerprintPromptParts`，读库状态）受到影响；11 步正文生成与 AI 润色完全不用指纹——同一个开关在两个入口语义不一致，且没有日志提示。
- 改为以指纹库为唯一真相源：`KnowledgeInjector#getEnabledFingerprintsFromLibrary()`（去参数）与润色都改用 `listProject()/listGlobal()` + `isGlobalEnabledForProject()`；两处都先 `loadIntensityConfigs()` 并按同一口径跳过强度 0（界面「完全禁用」）的指纹。
- 同时发现指纹段还嵌在 `buildStyleInjection` 的 `strength >= 0.7` 分支里，而 `WritingProfile` 默认 `injectionStrength = 0.5`：即使数据源修对，默认配置下仍然不会注入。改为独立的 `buildFingerprintLines()`，在三个详略分支之后统一追加——指纹强度由指纹库配置控制，不该再被「风格描述详略」二次门控。
- `buildStyleInjection` 改为 async（4 个调用方本就在 async 方法内，逐个 `await`）；漏 `await` 会把 Promise 塞进 sections，因此四个调用点全部显式等待。
- 5 例单测：库启用即注入（画像 id 为空）、默认 0.5 强度也注入、强度 0 不注入、画像陈旧 id 不再生效、全局指纹按项目启用状态过滤。

**67. 模板层指纹显示无效的「启用/强度」控件（`ui/fingerprint-utils.ts` / `ui/views/writing-fingerprint-view.ts` / `ui/settings-tab.ts` / `ui/mini-settings-modal.ts`）**
- `template` 层是来源库：`getEnabledFingerprints()` 只返回 project/global，`getFingerprintPromptParts` 的强度过滤也只看这两个作用域；`copyFingerprint` 复制时还固定 `enabled: true`。模板上的启用状态与强度配置没有任何消费方。
- 三个入口却都提供了控件：指纹库视图的操作区（启用/禁用、强度调节、详情弹窗）、设置页/ mini 设置的列表开关。用户改完看不到任何正文变化，也没有提示。
- 新增 `ui/fingerprint-utils.ts#isSourceOnlyFingerprintScope(scope)` 作为唯一判定；三处统一：
  - 列表项：模板层不渲染开关，显示「来源库 · 复制到项目后生效」；
  - 指纹库视图：隐藏启用/禁用与强度调节，操作区顶部给出「模板层是来源库」说明；工具栏「启用/禁用」对模板给出提示并直接返回；详情弹窗不传 `onToggle` / `onOpenIntensity`；
  - 设置页与 mini 设置：模板列表的 onToggle 分支删除（控件已不可见），mini 设置详情弹窗同样不传 `onToggle`。
- 2 例单测锁定判定（template 为 true，global/project 为 false）。

**68. 质量趋势按「章」比较，不再用章内评估抖动（`shared/quality-history.ts` / `services/quality-history-store.ts` / `ui/monitor-panel-b.ts`）**
- 现状：协同实时评估约 2.5s 一次，`WritingQualityEngine#calculateTrend` 取最近 5 次评估，箭头实际只覆盖十几秒的打字波动；协同视图的内核还不随切章清空，方向会跨章串用。这个值又被写进 `质量历史.json`，面板 B 的「最近历史」与摘要箭头都会显示它。
- 新增 `shared/quality-history.ts#computeChapterTrend(current, history)`：排除同章记录（章键经 `normalizeChapterKey` 归一），前序章按 `aggregateQualityHistoryByChapter` 各取最后一次、只取当前章之前的最近 5 章；前序不足 2 章或当前章无章键时返回 `stable`，差值超过 5 分才判上升/下降。
- `services/quality-history-store.ts#appendQualityHistory` 在落盘前统一重算并覆盖 `record.trend`：协同实时落盘与面板 B 节流落盘两个写入口共用同一口径，调用方不再需要自己算。
- `ui/monitor-panel-b.ts`：摘要箭头与历史条目的 trend 改用 `computeChapterTrend`（基于磁盘全量 + 会话增量的 `baselineHistory`），与「最近历史」箭头口径一致。
- 阈值集中到 `shared/thresholds.ts#QUALITY_CHAPTER_TREND`（windowSize 5 / minChapters 2 / delta 5）。
- 8 例单测：跨章上升/下降/平稳、前序不足、同章多次评估排除、带项目前缀的同章排除、后续章不参与、无章键返回平稳、落盘覆盖调用方 trend、同章反复追加不以自身为基准。

**69. 删除未接线的内存质量历史（`engine/quality/quality-history-store.ts` / `engine/quality/realtime-monitor.ts`）**
- 核实：`RealtimeMonitor` 的 `historyStore` 是可选参数，生产 `CoWritingView` 构造时从未传入；`QualityHistoryStore#getHistory/getRecentRecords` 也没有任何读取方。这个模块只服务单测，文档却写着「与磁盘历史并存」，容易被当成已生效能力。
- 删除 `engine/quality/quality-history-store.ts` 与其测试文件；移除 `RealtimeMonitor` 的 `historyStore` 可选参数与评估后的 `addRecord` 分支。
- 同步清死开关：`MonitorContext.persistToHistory`（唯一调用方传的是 `false`，本来也不会生效）、从未被读取的 `note`，以及 `CoWritingView` 的 `persistToHistory: false`。
- 历史口径只剩 `services/quality-history-store.ts` 一处：实时评估只返回结果，落盘由 `persistLiveQualityIfDue` / 面板 B 节流落盘经 `appendQualityHistory` 完成。
- 测试基线 227/3539 → 226/3522（删死模块 1 文件 17 例；立项时 3370，净增仍为正）。

**70. 切章 / 短正文时清空实时质量顶栏（`ui/co-writing-view.ts`）**
- 现状：协同顶栏的「质量 / 偏离」只在评估返回时更新。`openChapter` 切换章节时不清理，新章加载期间仍显示上一章分数；新章正文 <50 字时 `evaluateRealtimeQuality` 直接早退，上一章分数会永久停留。切章时也未取消在途评估，新章首评可能被 `busy` 挂起。
- 新增 `resetQualityMonitorForChapterSwitch()`：清 `qualityMonitorPending`、`cancel()` 在途评估、清空顶栏文本与 `title`，在 `openChapter` 设置章节字段后立即调用。
- 短正文分支同样清空顶栏并 `cancel()`：删空正文后不再显示旧分数。
- 评估返回时若 `result.cancelled` 为真直接丢弃，不写顶栏也不落盘：被取消的评估没有有效结论，不能覆盖已清空的顶栏，也不能再写出「质量 --」把空状态变成伪状态。
- 3 例单测锁定：短正文清空顶栏 + 取消；切章重置清空 pending/文本/title + 取消；取消结果不覆盖顶栏且不落盘。

**71. 面板 B 的空结果不再显示成 0 分，详情面板不再被摘要清掉（`shared/thresholds.ts` / `engine/writing-quality-engine.ts` / `ui/monitor-panel-b.ts`）**
- 现状：正文 <100 字时 `WritingQualityEngine` 返回 0 分 / D 的空结果，面板 B 照常渲染「综合质量 0 D」并进入基线比较，空章被显示成「低于基线」；展开详情时六维也全部显示 0 分。这是「无法评估」，不是「写得差」。
- 阈值集中：新增 `shared/thresholds.ts#QUALITY_MIN_EVALUABLE_CHARS = 100`，`WritingQualityEngine` 改引用常量，面板 B 与之共用同一门槛（与落盘门槛 `QUALITY_LIVE_PERSIST_MIN_CHARS = 300` 分开：展示门槛低于落盘门槛，300 字以下仍可看分数但不入历史）。
- `renderQualitySummary` 顶部短路到新增的 `renderQualityNoData`：摘要显示「综合质量 --」+「正文不足 100 字，暂不评估（当前 N 字）」，不渲染分数、不进入 `renderBaselineComparison`；展开状态下详情只显示「正文过短，暂无质量详情」。
- `renderQualityDetail` 同样加短正文守卫：即使直接展开也不会渲染六维 0 分。
- 修一个连带问题：`renderQualitySummary` 里的 `qualityContent.empty()` 会把详情面板一起移出 DOM，但 `qualityDetailPanel` 引用仍非空，导致展开的详情在每次评估后消失（`runQualityEval` 之后只剩一个脱离文档的节点）。新增 `ensureQualityDetailPanel()` 统一「已挂载则复用、已脱离则重建」，`showQualityDetail` 也改用它，避免两处各建一个面板。
- 6 例单测（`tests/unit/ui/monitor-panel-b-quality-guard.test.ts`）：短正文转发到 no-data 且不渲染分数、文案含「--」与原因且不含「0 分」、展开时详情不渲染六维、`ensureQualityDetailPanel` 已挂载复用 / 已脱离重建、长正文摘要重建后详情面板仍挂在容器上。

**72. 协同实时质量的早退门槛与引擎对齐（`ui/co-writing-view.ts` / `engine/quality/quality-score-engine.ts`）**
- 现状：Revision 69 把「不可评估」的门槛统一为 100 字（WQE / 面板 B），但协同顶栏仍用 50 字早退。正文 50–99 字时仍会发起评估，`QualityScoreEngine` 返回 0 分空结果，顶栏显示「质量 0 · 0 问题」——把「无法评估」当成了「写得差」；同一段正文还会跑一次偏离检测。
- `ui/co-writing-view.ts#evaluateRealtimeQuality` 改用 `QUALITY_MIN_EVALUABLE_CHARS`：不足时清空顶栏并 `cancel()` 在途评估，不再发起评估。
- `engine/quality/quality-score-engine.ts` 的空结果门槛同样改引用该常量，三个消费方（WQE / QSE / 协同视图）只剩一个定义。

**73. 面板 B 的质量历史项目归属改为同步注入（`ui/monitor-panel-b.ts` / `ui/co-writing-view.ts`）**
- 现状：面板 B 用 `getActiveProject() || tractionProject` 推断项目。协同写作视图不是 Markdown 文件，`getActiveProject()` 依赖 activeFile，切到该视图后通常为 null；`tractionProject` 又要等 `createEndingTractionEngine` 异步完成后才写入。首次切章时两者都不可用：质量历史不恢复（整章没有基线），或继续使用上一本书的 `tractionProject`，把别的书的历史算进基线。
- 新增 `setActiveProject(project)` 与 `resolveProject()`：优先级为「同步注入 > activeFile 推导 > 结局牵引引擎项目」；`updateCompletion` / `restoreQualityHistory` / `persistQualityHistory` 三处统一走 `resolveProject()`。
- `CoWritingView#updatePlotCompletion` 在调用 `updateCompletion` 前同步 `setActiveProject(this.project)`，不再只依赖异步的 `setTractionProject`。
- 4 例单测（`tests/unit/ui/monitor-panel-b-project-scope.test.ts`）：注入项目优先于空 activeFile 与上一本书的 tractionProject、未注入时保持 tractionProject 回退、activeFile 兜底、项目名去空白。

**74. 切章冲刷写回记录所属的项目（`ui/monitor-panel-b.ts`）**
- 现状（Revision 71 引入）：切换书籍时 `updatePlotCompletion` 先 `setActiveProject(B)` 再 `updateCompletion`，而切章分支里的 `persistQualityHistory(true)` 用 `resolveProject()` 取项目名——此时已经指向 B 书，`qualityHistory` 里最后一条却属于 A 书，于是把 A 书的记录写进 B 书的 `质量历史.json`。
- `persistQualityHistory(force, projectOverride?)` 新增项目覆盖参数；切章冲刷传 `currentBaselineProject || resolveProject()`，保证写到记录真正所属的项目。同书切章行为不变。
- 2 例单测（`tests/unit/ui/monitor-panel-b-history-flush.test.ts`）：A→B 切书时记录写回 A 书且基线清空；同书切章仍写回原书。

**75. 面板 B 关闭时冲刷质量历史并释放防抖（`ui/monitor-panel-b.ts`）**
- 现状：`dispose()`（只释放 `debounceManager`）在全仓没有调用方；`persistQualityHistory` 的注释写着「force 用于切章/关闭」，但关闭路径不存在。关闭面板后，500ms 防抖回调仍会带着已脱离 DOM 的引用执行，节流窗口内的最后一条质量记录也会丢失。
- 新增 `onClose()`：先 `persistQualityHistory(true)` 冲刷，再 `dispose()`，最后 `await super.onClose()` 走基类的监听摘除与布局保存。
- 1 例单测（`tests/unit/ui/monitor-panel-b-close-flush.test.ts`）：冲刷先于释放、基类收尾摘除两个 document 监听并保存布局。

**76. 完成度 / 偏离的空结果不再显示成 0，也不再写进趋势（`shared/thresholds.ts` / `engine/plot-completion-engine.ts` / `engine/plot-divergence-engine.ts` / `ui/monitor-panel-b.ts`）**
- 现状：正文 <50 字时 `PlotCompletionEngine` 返回六维全 0 的空结果，面板 B 照常渲染「0分 · 待开始」并 `addToHistory`；正文 <100 字时 `PlotDivergenceEngine` 返回 `overallDivergence = 0 / overallLevel = normal`，面板 B 渲染成绿色「0% · 无偏离」并写入 `divergenceHistory`。前者把「无法评估」当「完成度 0」，后者更把空章显示成「完全贴合大纲」；两条零记录还会让后续真实分数/偏离在趋势图里看起来像突刺。
- 阈值集中：新增 `shared/thresholds.ts#PLOT_COMPLETION_MIN_EVALUABLE_CHARS = 50` 与 `DEVIATION_MIN_EVALUABLE_CHARS = 100`，两个引擎不再各写魔法数字，面板 B 与之共用同一门槛。
- `runCompletionEval` / `runDivergenceEval` 在不足门槛时只渲染无数据并直接返回：不写会话历史、不触发偏离预警、不走里程碑/质量提醒。
- 新增 `renderCompletionNoData` / `renderDivergenceNoData`：摘要分别显示「综合完成度 --」+「正文不足 50 字，暂不评估（当前 N 字）」、「整体偏离度 --」+「正文不足 100 字，暂不检测（当前 N 字）」；展开状态下详情只显示「正文过短，暂无…详情」。
- `renderCompletionDetail` / `renderDivergenceDetail` 同样加短正文守卫，直接展开也不会渲染六维/五维全 0 的假详情。
- 修同类连带问题：`render*Summary` 里的 `empty()` 会把详情面板一起移出 DOM。新增 `ensureCompletionDetailPanel()` / `ensureDivergenceDetailPanel()` 统一「已挂载则复用、已脱离则重建」，`show*Detail` 与两条摘要路径都改用它。
- 8 例单测（`tests/unit/ui/monitor-panel-b-plot-guard.test.ts`）：短正文不写历史且显示「--」/原因、达到门槛正常入历史、短正文详情不渲染维度、长正文摘要重建后详情仍挂载（完成度/偏离各 4 例）。

**77. 面板 B 的三处用户提示从未真正显示（`ui/monitor-panel-b.ts`）**
- 现状：`showDivergenceAlert` / `checkQualityAlert` / `showMilestoneNotice` 都用 `(this.app as any).notice?.addNotice?.(...)`。Obsidian 没有 `app.notice` 这个 API，可选链让调用恒为 `undefined`，三个方法只走了日志分支——偏离预警、质量提醒、里程碑通知对用户完全不可见，且类型检查不会报错（`as any`）。
- 三处统一改为 `import { Notice } from "obsidian"` + `new Notice(msg, timeout)`，与全仓其余通知实现一致；删除不可达的 `if (!this.plugin) return` 与「notice 为空就写日志」的兜底。
- 3 例单测（`tests/unit/ui/monitor-panel-b-notice.test.ts`）：偏离预警构造带原因的 Notice、里程碑构造带字数的 Notice、质量提醒在 10 分钟冷却内只提示一次、超过冷却后可再次提示。

**78. 面板 B 删除无数据来源的「风格自学习 / 偏好记忆」占位卡（`ui/monitor-panel-b.ts`）**
- 现状：`renderBody` 创建两张卡（「🎨 风格自学习(E1)」「💾 偏好记忆(E3)」），内容永远是「写作中自动学习 / 写作中自动记录」。`styleLearner` / `prefMemory` 只在初始化时赋值，全文件没有读取方；`refreshStyle` / `refreshPref` 在全仓没有任何调用方。
- 面板自己 `new` 的 `PreferenceMemory` 与 `CoWriterEngine` 内的实例不是同一个，即使接线也看不到协同引擎写入的偏好；风格学习与偏好记忆的真实消费在 `CoWriterEngine` / `PromptBuilder`，面板卡不参与任何逻辑。
- 删除两张卡、`styleContent` / `prefContent` 字段、`StyleLearner` / `PreferenceMemory` 导入与初始化、`refreshStyle` / `refreshPref` 方法；面板标题从「结局/完成度/结算/风格/偏好」改为「结局/完成度/偏离/质量/结算」，与管理职责一致。
- 无新增用例（纯删除 + 全量回归）：全量 **232 文件 / 3550 用例**通过。

**79. 面板 B 删除从未刷新、且重复创建引擎的「结局牵引」卡（`ui/monitor-panel-b.ts` / `ui/co-writing-view.ts`）**
- 现状：面板 B 的「🏁 结局牵引(D4)」卡只在 `refreshTraction()` 里写内容，而该方法全仓没有调用方；卡内文字永远停在初始占位，`tractionProject` / `tractionRetried` / `tractionLoading` 三个字段除了内部自洽外没有外部读取。
- 重复能力：面板 B 自己 `new EndingTractionEngine()` 并 `initialize(project)`，解析失败会走 AI `parseThreadsWithAI`；协同主视图已有自己的 `tractionEngine`（由 `facade.createEndingTractionEngine(project)` 创建），并由 `ui/cowrite/live-analysis-controller.ts#renderTractionPanel` 真实渲染「🎯 情节牵引」。同一份项目会建两个引擎，规则解析失败时多打一次云端请求。
- 删除卡片、`tractionEngine` / `tractionProject` / `tractionRetried` / `tractionLoading` / `tractionContent` 字段、初始化块、`setTractionProject` / `refreshTraction`；`resolveProject()` 去掉 `tractionProject` 回退，只保留「显式注入 > activeFile 推导」。
- 保留协同视图的 `tractionEngine`（被 `live-analysis-controller` 使用），只删掉 `updatePlotCompletion` 里的 `setTractionProject` 调用；面板标题改为「监控面板B · 完成度/偏离/质量/结算」。
- 两项既有单测同步去掉 `tractionProject`：`monitor-panel-b-project-scope.test.ts` 第二例改为断言「未注入且 activeFile 为空时不认领任何项目」，`monitor-panel-b-history-flush.test.ts` 删除对应字段赋值。
- 全量 **232 文件 / 3550 用例**通过（纯删除，用例数不变）。

**80. 质量历史落盘按章收敛，单章高频写入不再挤掉其他章（`services/quality-history-store.ts`）**
- 现状：`appendQualityHistory` 只做「完全重复」去重（章键+时间+总分+字数），不做章级收敛；面板 B 每 30 秒落盘一条（`QUALITY_PERSIST_INTERVAL = 30_000`），协同视图每 10 分钟一条。`QUALITY_HISTORY_MAX_RECORDS = 200`，**在同一章连续写作约 100 分钟就能把配额写满**，`mergeQualityHistory` 裁剪最旧记录时会把前面所有章的样本挤掉。
- 后果：磁盘历史只剩当前章，`computeChapterTrend` 的前序章不足两章 → 趋势恒为平稳；`computeQualityBaseline` 排除当前章后没有样本 → 「高于/低于基线」整行消失。而这正是「写得越久、基线越失效」的反向激励。
- 修复：在唯一写入口 `appendQualityHistory` 合并后调用 `aggregateQualityHistoryByChapter` 再落盘。磁盘文件的口径与基线/趋势一致——**一章一条、保留最后一次评估**；200 条配额因此约等于 200 章，够覆盖长篇全本。会话内的 `qualityHistory` / `baselineHistory` 不受影响，面板 B 的「最近历史」仍按评估次数展示。
- 旧数据兼容：无章键的旧记录仍按独立条目保留（`aggregateQualityHistoryByChapter` 的 standalone 分支），不会被误合并。
- 单测：`quality-history-store.test.ts` 更新「同章反复追加只保留最后一条章级样本」，新增「单章高频落盘不会挤掉其他章」（30 次同章写入 + `max=5`，断言第 1、2 章都在且第 1 章取最后一次）；原「多次追加 / max 裁剪 / 并发不丢」三例改用不同章键以保持原语义。
- 全量 **232 文件 / 3551 用例**通过（新增 1 例）。

**81. 面板 B 关闭时冲刷写回记录所属项目（`ui/monitor-panel-b.ts`）**
- 现状：`onClose()` 调用 `persistQualityHistory(true)`，不带 `projectOverride`，内部回退到 `resolveProject()`（注入项目 > activeFile）。切章路径已在第 74 条修过「用记录产生时的身份」，关闭路径漏了同一处。
- 可复现场景：在 A 书协同写作 → 关闭协同视图 → 打开 B 书任意 Markdown 文件（面板 B 仍开着）→ 关闭面板 B。此时 `qualityHistory` 最后一条属于 A 书，`resolveProject()` 已指向 B 书，A 书的记录被写进 B 书的 `质量历史.json`。
- 修复：改为 `persistQualityHistory(true, this.currentBaselineProject || this.resolveProject())`，与切章冲刷完全同口径；`currentBaselineProject` 为空时（首次打开、尚未写入）仍回退当前项目。
- 单测：`monitor-panel-b-close-flush.test.ts` 从 1 例扩到 2 例——断言冲刷收到 `(true, 'A书')` 而不是关闭时的 `B书`；新增「尚无基线项目时回退到当前项目」。
- 全量 **232 文件 / 3552 用例**通过（新增 1 例）。

**82. 输入触发的设定守卫加增量门槛与冷却，停止「每次停顿全量扫 6000 字」（`ui/cowrite/live-analysis-controller.ts` / `shared/thresholds.ts`）**
- 现状：`scheduleRefresh('input')` 在用户每次输入后设一个 8 秒防抖的 `guard-check`，触发 `inspectSettingGuard` → `trackEntityStates` → `EntityStateManager.detectStateChanges`，**每次都会把正文前 6000 字发给 AI**（`flashModel`）。连续写作时，每停顿 8 秒就是一次全量重扫：写两小时可能产生上百次 AI 调用。
- 更隐蔽的是触发源被合并：`guard-check` 的回调写成 `trigger === 'save' ? 'save' : 'insert'`，`input` 被当成 `insert` 传下去，`GuardTrigger` 类型里也根本没有 `'input'`——任何想按触发源做节流的代码都无从下手。
- 修复：
  - `GuardTrigger` 扩展为 `RefreshTrigger | 'manual'`，`guard-check` 原样传递触发源（不再把 input 归为 insert）。
  - 新增 `shared/thresholds.ts#GUARD_INPUT_MIN_GROWTH_CHARS = 300` 与 `GUARD_INPUT_COOLDOWN_MS = 5 分钟`：`input` 触发时，只有「正文新增 ≥300 字」或「距上次检查 ≥5 分钟」才执行；`insert` / `save` / `manual` 是用户主动动作，保持每次都检测。
  - 检查失败也记录时间戳：否则一次 AI 失败会让后续每次停顿都重试全量检测。
- 单测：新增 `tests/unit/ui/cowrite-live-guard-throttle.test.ts` 6 例（首次执行、新增不足跳过、达到门槛执行、冷却到期执行、insert/save/manual 不受限、失败也记录时间）。
- 全量 **233 文件 / 3558 用例**通过（新增 1 文件 6 例）。

**83. 实体状态检测（D1）跟随协同写作模型，不再固定走云端 flash（`engine/entity-state-manager.ts` / `engine/co-writer-engine.ts`）**
- 现状：`CoWriterEngine#trackEntityStates` 调用 `EntityStateManager.detectStateChanges`，后者内部写死 `this.plugin.settings.flashModel`（默认云端 deepseek）。协同写作切到本地 Ollama 后，同一份正文出现两条通道：OOC 检测走 `getCoWriteModel()`，实体状态检测仍走云端。
- 后果：本地模式下每 5 分钟（或每 300 字增量）的守卫检查都会打一次云端请求——用户以为「已经全本地」，实际仍在计费/联网；离线时该路径直接失败，只在面板上弹「实体状态检测失败」，角色档案静默不更新。
- 修复：`detectStateChanges` 新增第 5 参 `options?: { model?, callOptions? }`，`callAI` 改为 `options?.model || this.plugin.settings.flashModel` 并透传 `options?.callOptions`；`trackEntityStates` 先解析 `getCoWriteModel()`，非空时传 `{ model, callOptions: this.getCoWriteOptions() }`（含 `disableFallback` / `numCtx` / 本地 endpoint），未配置协同模型时传 `undefined`，保持既有 flashModel 行为。
- 单测：新增 `tests/unit/engine/entity-state-model-follow.test.ts` 5 例——管理器层透传 model/callOptions；引擎层本地模式（model=`qwen2.5:7b` + Ollama endpoint + `disableFallback: true` + `numCtx = CO_WRITE_NUM_CTX`）、云端模式（`doubao-pro`，`disableFallback: false`）、未配置协同模型时不传覆盖。
- 全量 **234 文件 / 3563 用例**通过（新增 1 文件 5 例）。

**84. 剧情完成度自动评估改为「按内容变化」触发，不再每 10 秒重发 9.6k token（`shared/plot-eval-throttle.ts` / `ui/co-writing-view.ts`）**
- 现状：`CoWritingView#refreshMetrics` 只按「距上次评估 ≥10 秒」节流；`autoPlotEvaluation` 默认 `true`，`live-analysis-controller` 每次输入停顿 3 秒就调度一次。于是打字期间每分钟最多 6 次 `evaluatePlotComplete`，每次都把整章正文拼成约 9.6k token 的 prompt —— 而正文往往只多了几十字，评估结论几乎不变。
- 与目标冲突：这是「本地模型上下文/输出有限」时最贵的固定开销之一；云端模式下则持续计费，是插件对云端 AI 依赖最隐蔽的一处。
- 修复：新增纯函数 `shared/plot-eval-throttle.ts`：
  - 正文签名 = 章节身份（`project|chapterNum`）+ 长度 + FNV-1a；同章正文未变直接跳过；
  - 有变化时要求「新增 ≥ `PLOT_EVAL_MIN_GROWTH_CHARS`（300 字）或距上次 ≥ `PLOT_EVAL_COOLDOWN_MS`（2 分钟）」；
  - 两次请求至少间隔 `PLOT_EVAL_MIN_INTERVAL_MS`（30 秒），避免快速打字连续触发；
  - 换章直接评估（旧章节的时间戳不参与本章门槛）；`force=true`（手动重试、生成完成后的 `refreshMetrics(true)`）不受限。
- `refreshMetrics` 用该门槛替换原 `lastMetricsAt` 的 10 秒判断；被跳过时保留上一次指标展示，不发请求也不进入 `evaluating` 状态。
- 单测：新增 `tests/unit/shared/plot-eval-throttle.test.ts` 8 例（首次、正文未变、增量不足、增量达标、冷却到期、最小间隔内、换章、强制刷新）。
- 全量 **235 文件 / 3571 用例**通过（新增 1 文件 8 例）。

**85. 面板 B 的内存基线样本也按章收敛，长章写作不再让基线行消失（`ui/monitor-panel-b.ts`）**
- 现状：第 80 条把**磁盘**质量历史改成「一章一条」，但面板 B 内存里的 `baselineHistory` 仍是「每次评估追一条」。它正是基线比较（`renderBaselineComparison`）与章级趋势（`computeChapterTrend`）唯一的样本源。
- 后果：面板 B 每次打字停顿（500ms 防抖）都会评估一次并追一条，`QUALITY_HISTORY_MAX_RECORDS = 200` 在同一章约 200 次停顿后就被灌满；`slice(-200)` 把前面所有章挤掉，排除当前章后基线没有样本 → 「高于/低于基线」整行消失。磁盘口径修好了，界面却仍按内存数组算，等于第 80 条的修复只覆盖了一半。
- 修复：`addToQualityHistory` 在写入 `baselineHistory` 前按 `normalizeChapterKey` 查同章旧样本，命中则先移除再追加（保持「最近更新的章在尾部」），配额因此是「200 章」而不是「200 次评估」。章键为空（无法判定归属）时保持逐条追加，不做误合并。
- 展示用的 `qualityHistory`（最近历史，上限 20 条）不变，仍按评估次数展示。
- 单测：新增 `tests/unit/ui/monitor-panel-b-baseline-chapter-level.test.ts` 3 例（同章多次只留最后一条且其他章不受影响、199 条其他章 + 200 次同章评估后其他章仍在、无章键时不合并）。
- 全量 **236 文件 / 3574 用例**通过（新增 1 文件 3 例）。

**86. 情绪曲线默认改为本地分析，实时面板不再每 2.5 秒逐段请求 AI（`engine/emotion-curve-analyzer.ts`）**
- 现状：`EmotionCurveAnalyzer#analyze` 对每个 800 字片段**无条件**调用一次 AI（`flashModel`）。它被 `MonitorPanelA#refreshWithBody` 在每次「输入停顿 2.5 秒 / 插入建议 / 保存」时整章重算：4000 字正文 ≈ 每 2.5 秒 5 次云端请求，3 万字正文 ≈ 38 次/次刷新，且串行 await，面板会持续卡顿。这是监控链路里最大的隐性云端依赖。
- 修复：
  - 默认改为本地关键词词典分类（`joy / sadness / anger / fear / surprise / neutral`，强度按命中数放大），零 AI 请求、即时返回；
  - 新增片段级缓存（内容哈希 → 情绪点，上限 512 后清空）：正文只在尾部增长时，前面片段直接复用，不再重复分析；
  - AI 仅在 `enableDetailedAnalysis` 显式开启时使用（与 `RhythmAnalyzer#estimateTension` 同一开关），且命中缓存；AI 返回不可解析时回退本地词典，不再整段变成 `neutral`。
- 单测：新增 `tests/unit/engine/emotion-curve-local.test.ts` 5 例（默认零 AI 且给出 joy、短正文空曲线、详细分析开启后相同片段只请求一次、尾部增长只请求新片段、AI 返回非法 JSON 回退本地）。
- 全量 **237 文件 / 3579 用例**通过（新增 1 文件 5 例）。

**87. 「偏离度持续上升」告警加时间跨度，不再把几秒内的三次编辑说成「连续多章」（`shared/divergence-trend.ts` / `engine/plot-divergence-engine.ts`）**
- 现状：`PlotDivergenceEngine#checkShouldAlert` 用 `divergenceHistory`（按**评估次数**记录）取最近 3 条，只要相邻涨幅 >5 两次就告警，文案写「连续多章偏离度上升」。面板 B 每 500ms 就可能评估一次，几秒内的三次编辑即可命中；随后该 key 进入 24 小时冷却，真正有意义的后续预警被吃掉。
- 修复：新增纯函数 `shared/divergence-trend.ts#isRisingDivergence`——样本至少 3 条、相邻涨幅 >5 至少两次，**且这三次评估至少跨过 `DIVERGENCE_RISING_MIN_WINDOW_MS`（2 分钟）**；引擎同时维护与 `divergenceHistory` 一一对应的 `divergenceHistoryAt`（`clearHistory` 一起清空）。告警文案改为「偏离度持续上升（近 3 次评估）」。
- 单测：新增 `tests/unit/shared/divergence-trend.test.ts` 7 例（20 秒内不算、跨 2 分钟算、差 1ms 不算、样本不足、涨幅不足、引擎接线：快速三次不告警、跨窗后告警且文案不含「多章」）。
- 全量 **238 文件 / 3586 用例**通过（新增 1 文件 7 例）。

**88. 协同预览区重渲染保留滚动位置（`shared/preview-scroll.ts` / `ui/co-writing-view.ts`）**
- 现状：`refreshPreview` 每次输入（500ms 节流）都 `previewContent.empty()` + `MarkdownRenderer.renderMarkdown` 全量重渲染整章。预览区 `.nw-cowrite-preview-content` 是 `overflow-y: auto`，DOM 重建后 `scrollTop` 归零——用户向下翻看前文/伏笔时一继续打字就被拉回顶部；原本停在底部也不会继续跟随最新正文。
- 修复：新增纯函数 `shared/preview-scroll.ts`——`captureScrollSnapshot`（夹紧后记录位置，距底部 32px 内标记 `atBottom`）、`resolveRestoredScrollTop`（贴底恢复到新的最大滚动值，非贴底保持原绝对位置，内容变短时夹紧上限）。`refreshPreview` 在 `empty()` 前抓锚点、`applyHighlightsToDOM()` 后恢复。
- 单测：新增 `tests/unit/shared/preview-scroll.test.ts` 8 例（非贴底记录、阈值内贴底、超范围夹紧、不足一屏、贴底跟随新底部、变长保持位置、变短夹紧、清空恢复 0）。
- 全量 **239 文件 / 3594 用例**通过（新增 1 文件 8 例）。

**89. 协同自动联想（幽灵建议）加最小请求间隔，慢速打字不再每次停顿都打 AI（`shared/ghost-trigger.ts` / `ui/co-writing-view.ts`）**
- 现状：`scheduleGhostAssociationRefresh` 在输入停顿 1.5 秒后触发 `refreshGhostAssociation`，门槛只有「正文 ≥40 字 + 光标在尾部 + 尾部 160 字种子与上次不同」。种子多一个字就算不同，慢速打字（每 2 秒一个字）时约每分钟 30 次 AI 请求；本地模型会被持续占满，云端则持续计费。
- 修复：新增 `GHOST_ASSOCIATION_MIN_INTERVAL_MS`（4 秒）与纯函数 `shared/ghost-trigger.ts#shouldRequestGhostAssociationByInterval`；视图新增 `lastGhostRequestAt`，在既有门槛之后判断，未到间隔直接返回（不更新 `lastGhostSeed`，下次仍可重试）；发请求前记录时间（失败也计入，避免失败风暴）；切章重置为 0，首次输入不受限。
- 单测：新增 `tests/unit/shared/ghost-trigger.test.ts` 6 例（未请求过放行、刚好到间隔放行、差 1ms 跳过、1.2 秒内跳过、间隔 ≤0 关闭限频、`lastAt` 非法按未请求处理）。
- 全量 **240 文件 / 3600 用例**通过（新增 1 文件 6 例）。

**90. 同人设定加载失败不再静默：协同初始化时提示一次（`shared/fanfic-rules.ts` / `engine/co-writer-engine.ts` / `ui/co-writing-view.ts`）**
- 现状：同人项目在「`.project` 未写设定路径 / 设定文件被移动或删除 / 读取异常」时，`readFanficRules` 与 `readFanficRulesFromFS` 都静默退化为空规则；`syncFanficRules` 只写 `log.info`，协同便在没有原作约束的情况下继续续写，用户以为约束仍生效。
- 修复：`FanficRules` 新增可选 `loadError`（`missing-path` / `missing-file` / `read-failed`），三处失败分支带出原因（FS 版先用 `exists` 区分文件缺失与读取失败）；新增纯函数 `formatFanficRulesLoadWarning` 生成中文提示；`CoWriterEngine` 保存最近一次结果并提供 `getFanficRulesWarning()`；协同视图在 `initEngine` 后调用 `warnFanficRulesOnce()`，按「项目 + 文案」去重，只弹一次 `Notice`（8 秒）。
- 单测：新增 `tests/unit/shared/fanfic-rules-load-warning.test.ts` 10 例（原创/正常不提示、三种失败文案、App 版 missing-file/missing-path、FS 版原创/missing-file/正常解析）。
- 全量 **241 文件 / 3610 用例**通过（新增 1 文件 10 例）。

**91. 协同写作光标在开头时不再被当成「没有光标」（`shared/cursor-position.ts` / `ui/co-writing-view.ts` / `ui/co-write-floating-panel.ts`）**
- 现状：`textarea.selectionStart` 在光标位于正文最开头时是 `0`，而写作用的是 `selectionStart || value.length`：`0` 与「无光标信息」一起被当成假值回退到文末。结果是指针放到开头后插入建议、快捷键插入技巧片段都落到文末；自动联想按文末取 160 字种子（正文 ≥40 字即满足「光标在尾部」），在用户回看开头时仍发 AI 请求；`getContextBeforeCursor` 也把「光标前」取成整章。
- 修复：新增纯函数 `shared/cursor-position.ts#resolveCursorPosition(selectionStart, textLength, fallback)`——`null` / `undefined` / 非有限数按 `fallback` 回退，其余夹紧到 `[0, 正文长度]`（`0` 保持 0）；`co-writing-view` 与 `co-write-floating-panel` 共 12 处光标取值统一改走该函数（选区结束位置按 `max(起点, 结束)` 计算，不再用 `||`）。
- 单测：新增 `tests/unit/shared/cursor-position.test.ts` 10 例（开头 0 保持 0、null/undefined/NaN 回退、`fallback='start'`、超长夹紧、负数、小数、空正文、非法长度）。
- 全量 **242 文件 / 3620 用例**通过（新增 1 文件 10 例）。

**92. 同人设定支持「绑定已有文件」：不必重填表单或手改 `.project`（`shared/fanfic-binding.ts` / `ui/full-writer/wizard-step-renderers.ts`）**
- 现状：同人设定只有两条入口——向导里逐字段填写后保存，或「添加同人设定」让 AI 生成。用户已有现成设定文件（手写、从别处拷入、旧项目遗留）时，向导不会自动读取，只能手改 `.project` 的「## 同人设定路径」，写错或漏写就落到 `missing-path` / `missing-file`，协同静默无约束。
- 修复：新增纯函数 `shared/fanfic-binding.ts#listFanficSettingCandidates`——从 vault 的 Markdown 路径中筛出「本项目 `05-同人设定库` / 全局 `元文件/05-同人设定库`」下的 `.md`（含子目录），归一化反斜杠与冗余斜杠、去重、排除当前已绑定文件、按展示名排序。向导「原作设定导入」步骤在表单下方展示候选下拉与「绑定所选文件」：读取文件 → `attachFanficPathToProject` 回写 `.project` → 内容填入表单暂存；内容不完整时仍允许绑定，但提示缺少字段，补全后保存即覆盖该文件。
- 单测：新增 `tests/unit/shared/fanfic-binding.test.ts` 10 例（目录过滤、子目录、非 md、排除当前、去重、路径归一化、中文排序、空目录、相似目录不误收、空路径）。
- 全量 **243 文件 / 3630 用例**通过（新增 1 文件 10 例）。

**93. 前置规划警告横幅挂到编辑器上方，并在缺口补齐后移除（`shared/prereq-check.ts` / `ui/co-writing-view.ts`）**
- 现状：`checkPrerequisites` 把横幅 `createDiv` 到 `contentEl` 末尾，而 `contentEl` 里先有占满高度的 `.nw-cowrite-root`，横幅实际排在三栏布局下方（多半在视口外），用户看不到；旧横幅只在「本次仍有缺口」时清理，规划补齐后残留一个不可见的空节点；淡出只设 `opacity: 0`，元素继续占位。
- 修复：新增纯函数 `shared/prereq-check.ts#describePrerequisiteGaps`（不存在 → 名字、读取失败 → `（读取失败）`、正文 < 100 字 → `（内容过短）`，恰好 100 字视为通过）；`checkPrerequisites` 改为先无条件移除旧横幅，再按缺口判定；横幅经新增的 `editorWrapEl` 插到编辑器容器首位（`flex:0 0 auto`），真正位于编辑器上方；8 秒后淡出并在 1.1 秒后 `remove()`。
- 单测：新增 `tests/unit/shared/prereq-check.test.ts` 10 例（全部达标、缺失、读取失败、空模板、门槛边界、差 1 字、未给长度、多缺口顺序、自定义门槛、读取失败优先）。
- 全量 **244 文件 / 3640 用例**通过（新增 1 文件 10 例）。

**94. 监控面板 A 的情绪/节奏分析只保留最新结果，慢的旧请求不再覆盖新内容（`ui/monitor-panel-a.ts`）**
- 现状：`refreshWithBody` 每次输入（2500ms 防抖）与插入/保存（500ms）都会触发，方法内部对情绪、节奏各 `await` 一次；连续触发时多个请求并发，先发出的慢请求会在后发出的快请求之后返回，重新 `empty()` 并写入旧正文的分析结果。用户看到的是「刚打完的新段落，面板却显示上一版情绪/节奏」；短正文分支清空面板后，在途旧请求返回也会把内容写回来。
- 修复：新增 `analysisSeq` 分析代次；每次调用先 `++`，每个 `await` 之后（含 `catch` 分支）比对代次，过期直接返回、不写 DOM。短正文分支同样推进代次，使在途请求失效。
- 单测：新增 `tests/unit/ui/monitor-panel-a-latest.test.ts` 4 例（旧请求晚返回不覆盖且不再跑节奏、短正文清空后旧请求不写回、单次请求正常渲染、旧请求抛错不写「分析失败」）。
- 全量 **245 文件 / 3644 用例**通过（新增 1 文件 4 例）。

**95. 设定守卫按章节代次作废旧结果：切章不再把上一章的 OOC / 实体变更写进新章（`ui/cowrite/live-analysis-controller.ts` / `ui/co-writing-view.ts`）**
- 现状：`inspectSettingGuard` 是异步 AI 调用，而切章是同步的。旧章检查在途时切到新章，返回后仍会把 OOC 预警与实体状态变更推到面板 A，并写入「A1/D1 警告已推送」占位；`lastGuardCheck` 记的是上一章正文长度，新章更短时 `grew` 恒为负，输入触发的守卫检查会被长期跳过；自动检查在途时点「🛡 检查」直接 `return`，按钮看起来没反应。
- 修复：新增 `guardSeq` 代次与 `resetForChapterSwitch()`（推进代次、清空长度基准、释放锁），`openChapter` 在清质量顶栏处一并调用；`clearTimers()`（视图关闭）同样推进代次；`inspectSettingGuard` 发起时快照正文并推进代次，每个 `await` 之后与 `catch` 中校验代次，过期直接返回；`finally` 只在代次仍匹配时释放锁并记录长度，避免旧请求解开新请求的锁；manual 在途时提示「设定检查正在进行」。
- 单测：新增 `tests/unit/ui/cowrite-guard-latest.test.ts` 5 例（切章后旧结果不写容器/面板、切章清长度基准、manual 在途提示且不重复发起、旧请求不释放新锁、同章正常写结果）；`cowrite-live-guard-throttle.test.ts` 补充 `guardSeq` 初始化。
- 全量 **246 文件 / 3649 用例**通过（新增 1 文件 5 例）。

**96. 情节牵引面板按章节代次刷新：切章不再显示上一章的进度/风险（`ui/cowrite/live-analysis-controller.ts` / `ui/co-writing-view.ts`）**
- 现状：`renderTractionPanel` 每次先 `empty()` 再 `await checkTraction`，与面板 A / 设定守卫同源却唯独没有代次；切章时 `openChapter` 既不清理牵引容器也不作废在途结果，旧章的「整体进度 / 偏离风险 / 建议」会晚到写进新章，或在下一次输入前一直停留在界面上。
- 修复：新增 `tractionSeq` 代次；`renderTractionPanel` 发起时 `++` 并记录 `token`，`await` 之后与 `catch` 中校验，过期直接返回；`resetForChapterSwitch()` 推进代次并清空 `tractionContainer`，`clearTimers()` 同样推进；`openChapter` 在牵引引擎创建后主动渲染一次，避免清空后新章牵引区一直空白。
- 单测：新增 `tests/unit/ui/cowrite-traction-latest.test.ts` 5 例（切章后旧结果不写容器、切章立即清空、同代次正常渲染、旧请求抛错不写「牵引分析失败」、卷号/章号传参正确）。
- 全量 **247 文件 / 3654 用例**通过（新增 1 文件 5 例）。

**97. 「添加同人设定」弹窗支持绑定已有文件：不必为现成设定重新生成或手改 `.project`（`ui/add-fanfic-setting-modal.ts`）**
- 现状：向导已提供「从已有文件绑定」（第 92 条），但命令面板与全本工作台打开的「添加同人设定」弹窗只有「AI 生成」一条路径；用户已有现成设定文件时，从这两个入口只能重新生成，或手改 `.project` 的「## 同人设定路径」（写错即落到 `missing-path` / `missing-file` 静默无约束）。
- 修复：`project` 存在且候选非空时，弹窗底部新增「🔗 使用已有设定文件」区（下拉 + 「绑定所选文件」）。候选复用 `shared/fanfic-binding.ts#listFanficSettingCandidates`（本项目 `05-同人设定库` + 全局 `元文件/05-同人设定库`）；绑定前确认 `TFile` 存在且内容非空，写入走唯一入口 `attachFanficPathToProject`；内容不完整仍允许绑定，但提示缺失字段（与向导同口径）。全局库入口（无 `project`）不渲染该区。
- 单测：新增 `tests/unit/ui/fanfic-attach-path.test.ts` 4 例（`.project` 缺失时创建并标记 fanfic、已有段落原地替换、无段落追加、重复绑定幂等）。
- 全量 **248 文件 / 3658 用例**通过（新增 1 文件 4 例）。

**98. 剧情完成度评估按章节身份收敛：切章不再把旧章结果写进新章（`ui/co-writing-view.ts`）**
- 现状：`refreshMetrics` 会调 `evaluatePlotComplete`（整章约 9.6k token），返回后 `syncPlotCompletion` + `renderMetrics`。切章既不 `abort` 在途请求，也不校验章节身份：旧章结果晚到会写进新章；`metricsStatus` 还会停在新章顶部显示「评估中」。此外切章在 `initEngine` 之前用 `facade.getSession().currentMetrics` 渲染，会把上一章的完成度先画一遍。
- 修复：新增 `resetPlotMetricsForChapterSwitch()`（中止在途请求 + 状态复位 `idle`），由 `openChapter` 与质量顶栏清理一起调用；`refreshMetrics` 发起时记录「项目|章号」，`await` 之后与 `catch` 中校验，过期直接返回；切章过渡态改用 `emptyMetrics()` 渲染。
- 单测：新增 `tests/unit/ui/cowrite-plot-metrics-latest.test.ts` 5 例（切章后旧结果不写入、旧请求失败不标记新章、复位会中止并回 idle、同章正常写入、同章失败仍报 error）。
- 全量 **249 文件 / 3663 用例**通过（新增 1 文件 5 例）。

**99. 预览区异步渲染改用 detached 容器 + 代次：旧渲染不再与新一轮内容混排（`ui/co-writing-view.ts`）**
- 现状：`refreshPreview` 每次输入（500ms 节流）都会全量重渲染，而 `MarkdownRenderer.renderMarkdown` 是异步的。此前先 `empty()` 再直接把渲染结果写进常驻 `previewContent`：连续两次刷新时，旧渲染晚到会把内容追加到新一轮已清空的容器里；切章后旧章渲染完成同样会写回，导致预览混排或显示上一章正文。
- 修复：新增 `previewSeq` 代次；渲染先进入 `previewContent.ownerDocument.createElement('div')` 这个 detached 容器，`await` 后校验代次，仍匹配才 `empty()` 并搬运子节点、执行高亮与滚动恢复；正文为空的分支同样先推进代次，使在途渲染失效。
- 单测：新增 `tests/unit/ui/cowrite-preview-latest.test.ts` 4 例（后发先返回时旧渲染不覆盖、切章清空后旧渲染不写回、空正文占位回归、正常渲染搬运与高亮回归）。
- 全量 **250 文件 / 3667 用例**通过（新增 1 文件 4 例）。

**100. 自动联想（幽灵建议）增加可关闭开关：关闭后不再发起联想请求（`main.ts` / `core/settings-service.ts` / `ui/co-writing-view.ts` / 设置页两处 UI）**
- 现状：自动联想只在代码层做了 4 秒最小间隔，没有任何 UI 开关。输入停顿 1.5 秒即触发，重度写作时是持续的 AI 调用，用户无法关闭；`autoPlotEvaluation` 有开关、自动联想没有，能力粒度不一致。
- 修复：`NovelWriterSettings` 新增 `autoGhostAssociation?: boolean`（默认 `true`，老用户行为不变）；`CoWritingView` 新增 `isGhostAssociationEnabled()`，`scheduleGhostAssociationRefresh` 关闭时清空建议且不排 1.5 秒防抖，`refreshGhostAssociation` 关闭时清空建议并直接返回，`await` 返回后再次校验（请求在途时关闭设置也不写回界面）；设置页与 mini 设置弹窗在「自动剧情评估」下各加一枚「自动联想（幽灵建议）」开关；诊断快照能力清单带上该项。
- 单测：新增 `tests/unit/ui/cowrite-ghost-toggle.test.ts` 5 例（关闭不发请求并清空、缺省保持开启、在途关闭不写回、关闭不排防抖、开启仍按 1.5 秒排队）。
- 全量 **251 文件 / 3672 用例**通过（新增 1 文件 5 例）。

**101. 删除画像里的指纹启用副本：`enabledProject` / `enabledGlobal`（`engine/writing-profile.ts`）**
- 现状：`FingerprintConfig` 一直保存 `enabledProject` / `enabledGlobal` 两个数组，但全仓没有写入方（无 UI、无迁移），也没有消费方——指纹启用状态已统一为指纹库（`listProject` / `isGlobalEnabledForProject`）。这两个字段只保留默认 `[]` 与解析分支，历史上曾让 11 步正文生成的指纹注入「永远为空」（旧实现只读它们）。
- 修复：从类型、两处默认值、`normalizeFingerprint` 解析中删除这两个字段；旧画像文件里的同名键直接忽略（不再写回）；`templateInherited` 与 `injectionStrength` 保留（仍被注入链消费）。
- 单测：新增 `tests/unit/engine/writing-profile-fingerprint-legacy.test.ts` 3 例（旧键被忽略且不进结果、缺省回落默认、再次序列化不写出旧键）；`knowledge-injector-fingerprint.test.ts` 补注释说明其前两个参数用于验证「旧字段写了 id 也不生效」。
- 全量 **252 文件 / 3675 用例**通过（新增 1 文件 3 例）。

**102. 删除不可达的「详细分析」AI 分支与死开关：情绪/节奏分析统一本地（`engine/emotion-curve-analyzer.ts` / `engine/rhythm-analyzer.ts` / `main.ts`）**
- 现状：`enableDetailedAnalysis` 只有类型声明与两处读取，全仓没有任何 UI 写入方（无设置项、无迁移）——情绪曲线的逐片段 AI 分类与节奏的 AI 紧张度估算两个分支**永远不可达**。它们又是最危险的形态：一旦有人接线，4000 字正文 ≈ 每 2.5 秒 5 次请求，2 万字节奏分析 ≈ 100 次串行请求。
- 修复：删除 `settings.enableDetailedAnalysis`；`EmotionCurveAnalyzer` 统一走本地关键词词典（保留片段哈希缓存），`RhythmAnalyzer#estimateTension` 改为同步关键词规则、`analyzeParagraph` 随之同步化（内部已无 `await`）；两个类不再接收 `aiEngine`（`EmotionCurveAnalyzerOptions` / `RhythmAnalyzerOptions` 与未使用的 `app`/`plugin` 字段一并删除），调用点（`co-write-facade` 两处、`polish-editor` 一处）改为无参构造。
- 单测：`tests/unit/engine/emotion-curve-local.test.ts` 改写为 5 例（无 AI 依赖即可出曲线、短正文空曲线、空正文边界、相同正文命中缓存、尾部增长只新增片段），净持平。
- 全量 **252 文件 / 3675 用例**通过。

**103. 删除 `_workbenchState` 死字段与全部读取分支（`main.ts` / `shared/plugin-api.ts` / `core/command-registry.ts` / `engine/co-writer-engine.ts` / `ui/co-writing-view.ts` / `ui/scene-confirm-modal.ts`）**
- 现状：`_workbenchState` 从 v6.0 起只有声明与读取、全仓没有任何写入方，恒为 `null`。它挂在 6 条路径上：协同写作直达入口的「①工作台章节」分支、`CoWritingView#onOpen` 的章节回填、`CoWriterEngine#getProtagonistName` 的「回退1」、场景兜底提示词的主角名首选项、`CommandRegistry` 的 `getWorkbenchState` 端口与 `EngineRegistry` 的接线。前四条永远不命中，只增加分支与阅读成本；后两条是围绕死字段的端口，也一并删除。
- 修复：删除字段声明与 `NovelWriterRuntimeStateAPI` 中的类型；`openCoWritingFromActiveContext` 收敛为「当前正文文件反解 → 空态视图」两级；`CoWritingView#onOpen` 不再回填章节（章节只能由 `openChapter` 显式绑定）；`getProtagonistName` 只保留「人物 frontmatter 身份扫描 → 默认『主角』」；场景兜底主角名只从人物列表解析；`CommandRegistry` 去掉 `getWorkbenchState` 依赖与对应分支，`EngineRegistry` 去掉接线。
- 单测：新增 `tests/unit/engine/co-writer-protagonist-fallback.test.ts` 3 例（身份=主角取文件名、无主角回落「主角」且不读工作台状态、目录外文件与元数据缺失不抛错）。
- 全量 **253 文件 / 3678 用例**通过（新增 1 文件 3 例）。

**104. 预览节流不再丢弃最后一次输入：窗口内改为尾随渲染（`ui/co-writing-view.ts`）**
- 现状：`refreshPreview(false)` 按 500ms 节流，窗口内直接 `return`。打字节奏快于 500ms 时，每次刷新都落在窗口内被丢弃；用户停手后，**最后一段输入永远不会进入预览**，直到再次按键才补上——停手时间越长，预览落后越明显。
- 修复：新增 `previewTimer` 与 `schedulePreviewFlush(delay)`；窗口内的刷新不再丢弃，而是按剩余时间排一次尾随渲染（连续多次输入只保留最后一次）；`force=true`（切章、插入建议、质检高亮、打开章节）会取消挂起尾随并立即渲染；`openChapter` 与 `onClose` 也先清理定时器，避免旧章正文被补渲染一次或视图卸载后仍写 DOM。
- 单测：新增 `tests/unit/ui/cowrite-preview-trailing.test.ts` 4 例（窗口内补渲染最新正文、连续多次只补一次、强制刷新取消尾随、窗口外立即渲染回归）；`cowrite-preview-latest.test.ts` 的伪造上下文补上 `previewTimer` 与两个方法。
- 全量 **254 文件 / 3682 用例**通过（新增 1 文件 4 例）。

**105. 清理 `CoWritingView` 里只创建不读取的分析器实例（`ui/co-writing-view.ts`）**
- 现状：`emotionCurveAnalyzer` / `rhythmAnalyzer` 两个字段只在该视图 `openChapter` 时被 `facade.createEmotionCurveAnalyzer()` / `createRhythmAnalyzer()` 赋值，全文件没有任何读取点；面板 A 用的是 `MonitorPanelA` 自己经 facade 创建的实例。两个字段没有任何行为，却让读者以为协同主视图也在做情绪/节奏分析。
- 修复：删除两个字段、两处赋值与对应的两个 import；分析器所有权收敛到 `MonitorPanelA`。
- 测试：无新增（纯删除未被读取的状态），全量 **254 文件 / 3682 用例**通过，净持平。

**106. 节奏偏离接上数据源：从规划里解析预期节奏（`shared/rhythm-intent.ts` / `ui/co-writing-view.ts`）**
- 现状：`DeviationContext.expectedRhythm` 在生产中没有任何调用方赋值，`DeviationDetector#detectRhythm` 见到空值直接返回，于是「节奏偏离」永远是 0 条——监控面板上的这项检测实际上从未生效。
- 修复：新增 `shared/rhythm-intent.ts#parseExpectedRhythm`（纯函数、无 AI）：只认规划里的显式标注——`节奏：快/中/慢`、`快节奏`、`节奏偏慢`、`慢热`、`中等节奏`、Markdown 强调写法；没有标注返回 `undefined`（保持静默），快慢要求同时出现也返回 `undefined`（单值表达不了）。`CoWritingView#buildDeviationContext` 用本章简报大纲、快照 `chapPlan` 与场景目标/冲突/名场面三类文本填充 `expectedRhythm`；不按「战斗 / 爽点 / 日常」等语义猜节奏，避免误报。
- 单测：新增 `tests/unit/shared/rhythm-intent.test.ts` 7 例（标签三种取值、Markdown 强调、短语写法、无标注不猜、快慢冲突、标签优先、多文本拼接）与 `tests/unit/ui/cowrite-deviation-rhythm.test.ts` 3 例（简报标注透传、回退 chapPlan、完全无标注保持 undefined）。
- 全量 **256 文件 / 3692 用例**通过（新增 2 文件 10 例）。

**107. 知识库向量记录 embedding 模型：换模型后不再混算旧向量（`engine/knowledge-vector-store.ts`）**
- 现状：向量文件只存 `{bookId, bookName, samples}`，不记录生成向量用的 embedding 模型。用户换 embedding 模型后 `loadIndex` 仍无条件加载全部旧向量：同维度模型会与新查询向量混算出假相似度；不同维度的模型则让 `cosineSimilarity` 直接抛错（该函数在长度不等时 `throw`），整次知识检索失败。指纹侧（`StyleVectorStoreV2`）早已有 `modelId` 治理，知识库侧没有对应机制。
- 修复：向量文件写入 `modelId` 与 `dimensionCount`；`loadIndex` 与 `rebuildIndex` 共用 `isModelMismatch` 判断，记录模型不一致且当前模型已知时跳过该书（日志计数 + `getModelMismatches()` 报告），**只跳过、不删文件**——知识库原文仍在，重新拆解即可按新模型重建；旧文件没有 `modelId` 时按兼容策略加载（重建后补齐）；`search` 对维度不一致的样本直接跳过并记一条 warn，避免旧文件让整次检索抛错。
- 单测：新增 `tests/unit/engine/knowledge-vector-store-model-governance.test.ts` 5 例（写入记录模型与维度、换模型跳过且保留文件并给出清单、旧文件无 `modelId` 兼容加载、重新拆解写回新模型并移出清单、旧文件维度不一致不抛错）。
- 全量 **257 文件 / 3697 用例**通过（新增 1 文件 5 例）。

**108. 指纹 V1 向量同样记录 embedding 模型：换模型后不再静默丢掉整段指纹注入（`engine/local-vector-store.ts`）**
- 现状：`FingerprintVectorFile` 只有 `{fingerprintId, samples}`，不记录模型；`search` 对每个样本直接 `cosineSimilarity`，维度不等会 `throw`。`PromptBuilder#getFingerprintPromptParts` 把整段包在 `try/catch` 里、失败返回空数组，于是换 embedding 模型后「写作指纹风格参考」整段静默消失，只在日志留一条 warn；同维度换模型则新旧向量混算，rerank 结果失真。V2 指纹 store（`StyleVectorStoreV2`）与知识库（第 107 条）已有模型治理，V1 没有。
- 修复：向量文件写入 `modelId`（模型未知时不落 `'unknown'`，避免以后被误判）；加载时 `isModelMismatch` 跳过不一致的指纹（保留文件，`getModelMismatches()` 可查）；重新添加样本写回当前模型并自动移出清单；`search` 跳过维度不一致的样本并记一条 warn，旧文件也不会把整段注入打成空。
- 单测：新增 `tests/unit/engine/local-vector-store-model-governance.test.ts` 5 例（写入记录模型、换模型跳过且保留文件并给出清单、旧文件无 `modelId` 兼容加载、旧文件维度不一致不抛错、重新添加写回新模型并移出清单）。
- 全量 **258 文件 / 3702 用例**通过（新增 1 文件 5 例）。

**109. 协同写作的 embedding 跟随向量提供商设置：不再硬编码 Ollama（`engine/co-writer-engine.ts` / `engine/embedding/provider-factory.ts`）**
- 现状：协同引擎初始化指纹库与知识库时都写死 `new OllamaEmbeddingClient(settings.embeddingEndpoint, settings.embeddingModel)`，完全忽略 `vectorProviderType`。拆解调度器与指纹库 UI 走 `EmbeddingProviderFactory`：用户选 OpenAI / 豆包 / 通义后，写入向量来自云端模型，协同检索却仍请求本地 Ollama。没开 Ollama 时检索直接失败；开着时模型/维度不一致，检索要么抛错（Rev 106 前）要么被跳过（Rev 106/107 后），表现为知识/指纹注入静默消失。
- 修复：`EmbeddingProviderFactory` 新增 `fromSettings(config?)`，缺省值集中在工厂（`vectorOllamaModel → embeddingModel → bge-m3`、各 provider 默认端点/模型）；协同引擎新增 `createEmbeddingProvider()`，两处向量 store 与 `VectorEnhancer` 统一改用它。不做网络探测，切章性能不变。
- 单测：新增 `tests/unit/engine/co-writer-embedding-provider.test.ts` 5 例（通义/豆包/OpenAI 选择生效、Ollama 回退 `embeddingModel`、无设置时默认 `ollama + bge-m3`）。
- 全量 **259 文件 / 3707 用例**通过（新增 1 文件 5 例）。

**110. UI 入口统一构造指纹 embedding：新增/重提指纹不再回退 Ollama（`ui/fingerprint-embedding.ts` / `ui/refill-modal.ts` / `ui/mini-settings-modal.ts` / `ui/settings-tab.ts` / `ui/novel-analysis-modal.ts` / `ui/knowledge-detail-modal.ts`）**
- 现状：第 109 条只修了协同引擎。UI 侧仍有四处各自造 embedding：`refill-modal` 接受零散的 `embeddingEndpoint/embeddingModel`；`mini-settings-modal` 的模板分支手抄 16 行工厂参数、项目/全局分支 `new OllamaEmbeddingClient(...)`；`settings-tab` 三个「添加指纹」入口各抄一份 16 行参数；`novel-analysis-modal` 与 `knowledge-detail-modal` 也写死 Ollama。用户选云端向量后，从这些入口写入的向量来自 Ollama、检索侧却是云端模型：被第 107 条跳过，指纹注入静默消失；没开 Ollama 时提取直接失败。
- 修复：新增 `ui/fingerprint-embedding.ts#createFingerprintEmbedding(app, scope, settings, project)`，成对返回 `{provider, vectorStore}`，provider 恒由 `EmbeddingProviderFactory.fromSettings` 构造，杜绝「写入模型 ≠ 检索模型」。`refill-modal` 的构造参数收敛为 `embeddingSettings`，缺失时明确提示并中止（不再默默回退本地）；`mini-settings` / `settings-tab` 的五个添加指纹入口（模板 / 全局 / 项目）统一调用工厂，模板 → global 的映射集中在调用点；`novel-analysis-modal` 按项目 scope 构造；`knowledge-detail-modal` 的「重新拆解」调度器去掉三处 `require`，`VectorEnhancer` 改用工厂。同步修正 `.engine-registry-whitelist.json` 中 `KnowledgeVectorStore` 的过时说明。
- 单测：新增 `tests/unit/ui/fingerprint-embedding.test.ts` 5 例（通义/豆包选择生效、无设置默认 `ollama + bge-m3`、向量存储复用同一 provider 实例、global scope 不依赖 project 参数）。
- 全量 **260 文件 / 3712 用例**通过（新增 1 文件 5 例）。

**111. 批量重向量化：换 embedding 模型后一键修复知识库与指纹（`services/vector-rebuild-service.ts` / `ui/vector-rebuild-action.ts` / `services/deconstruction-scheduler.ts`）**
- 现状：第 107/108 条换模型后只跳过旧向量，用户没有批量重建入口——知识库要逐本「重新拆解」（会重新调用 AI 拆分全部维度），指纹要逐个「重新提取」（会重新调用 AI 采样），成本高且容易漏。另外 `LocalVectorStore#add` 是**追加**语义，直接重算同一样本会让向量翻倍。
- 修复：新增 `rebuildAllVectors(deps)` 串行编排（依赖全注入、可单测）：逐本调用 `DeconstructionScheduler#revectorizeBook`（新公开方法，只按当前模型重算向量、不重新拆解、不调用 AI；向量存储缺失时抛错而不是静默跳过）；逐指纹先 `delete` 再 `add`，避免样本翻倍；没有样本文本的指纹记为跳过；单条失败只记录、不中断后续。设置页与 mini 设置的知识库工具栏新增「🧠 重向量化」入口，共用 `rebuildAllVectorsWithConfirm`（确认弹窗明确「不调用 AI / 不重新拆解」，完成后汇总成功/跳过/失败，失败明细写日志）。
- 单测：新增 `tests/unit/services/vector-rebuild-service.test.ts` 6 例（全成功与进度顺序、单本失败不中断、空样本跳过且不重算、单指纹失败不影响后续、空列表、列举书籍失败整体抛出）。
- 全量 **261 文件 / 3718 用例**通过（新增 1 文件 6 例）。

**112. 伏笔告警按「计划回收章」分层：长期伏笔不再误报，逾期伏笔不再迟到（`engine/foreshadow-context.ts` / `engine/quality/deviation-detector.ts` / `ui/co-writing-view.ts`）**
- 现状：`ForeshadowTracking.expectedRecoverChapterNum` 全仓没有写入方，偏离检测只按全局阈值（默认 10 章）一刀切——贯穿全书的暗线到第 10 章就被判 critical；而伏笔库明确写「计划第 8 章回收」的伏笔，也要等到第 10 章才提醒。另外 warning 的偏离度是 `35 + distance * 3`，阈值调大时会算出 90+，比 critical 的下限 60 还高，严重度与数值自相矛盾。
- 修复：新增 `parsePlannedRevealChapter`（解析 `第12章` / `第 12 章` / 纯数字）与 `applyPlannedRevealChapters`（按规范化名称的最长包含匹配，把伏笔库「回收章节」补到追踪条目，已有值不覆盖）。协同视图读取追踪器后再读伏笔库并合并，`getUnrevealedForeshadows` 失败只 warn、不影响主流程。检测优先按计划回收章分层：已逾期 critical、剩余 ≤`FORESHADOW_APPROACHING_CHAPTERS`（3）章 warning；没有计划章才回退全局阈值。warning 偏离度封顶 59、critical 从 60 起，保证单调；当前章早于埋设章直接跳过。
- 单测：`foreshadow-context.test.ts` +5（章号解析、名称匹配与不覆盖、已揭示过滤、最长匹配、空输入）；`deviation-detector.test.ts` +6（逾期 critical、临近 warning、长期伏笔不误报、非法计划回退阈值、warning 封顶 59、未来章不告警）。
- 全量 **261 文件 / 3729 用例**通过（新增 11 例）。

**113. 检索结果相关性过滤：低分尾部不再挤占本地窗口（`shared/retrieval-filter.ts` / `engine/knowledge-vector-store.ts` / `engine/local-vector-store.ts`）**
- 现状：知识库与指纹检索都只在 `search` 里做 topN 截断。`KnowledgeVectorStore#search` 虽然支持 `minScore`，但生产调用方（知识注入六段、协同知识检索、文风注入）全部没传；指纹 `LocalVectorStore#search` 连这个参数都没有。相似度 0.1 的样本与 0.9 的样本同样进入 prompt，在本地 8K 窗口下直接挤占必保片段。
- 修复：新增纯函数 `filterRetrievalResults`：先剔除 NaN；最高分低于绝对下限（0.15）时整批视为噪声返回空；其余丢弃低于「最高分 × 0.85」的离群项，并保证至少保留最高分。两个 store 在排序后统一过滤再 `slice(topN)`。阈值集中在 `shared/thresholds.ts`，相对比例只修剪明显离群尾部，不追求精确卡点。
- 单测：新增 `tests/unit/shared/retrieval-filter.test.ts` 7 例（空结果、离群尾部、至少保留最高分、整批噪声、降序且不改入参、自定义参数、NaN 剔除）；知识库/指纹既有检索测试全部保持通过。
- 全量 **262 文件 / 3736 用例**通过（新增 1 文件 7 例）。

**114. 偏离总评不再被加权平均稀释：单条严重问题必须体现在总评（`engine/quality/deviation-detector.ts`）**
- 现状：`overallScore` 是六类 `typeScores` 的加权平均（权重和 1.0），单类问题最多只能贡献自身权重：一条 `degree=100` 的 critical（如主线关键词完全未覆盖）只算 25 分，低于 `DIVERGENCE_WARNING`(30)，于是 `overallSeverity` 变成 `info`，而 `issues` 列表里明明是 `critical`——「问题列表严重、总评提示」自相矛盾，实时顶栏也会把严重问题显示成低偏离。
- 修复：总分取「加权平均」与「最严重单条 `issue.degree`」的较大者。加权平均继续衡量「面」（多类同时偏离），最高单条保证「点」（最严重问题）不被稀释；严重度仍由总分单调推导（≥60 critical / ≥30 warning），与 3.47 的 degree 单调约束一致。无问题时最严重值为 0，空报告与旧行为完全一致。
- 顺带清理：`DeviationContext.styleFingerprint` 是无人读写的保留扩展位（缓存键也不包含它），删除以免误导；`detect()` 注释的「5 类」修正为「6 类」。
- 单测：`deviation-detector.test.ts` +2（单类 degree 100 → 总评 ≥100 且 critical；任意报告总分恒不低于最严重单条）。
- 全量 **262 文件 / 3738 用例**通过（新增 2 例）。

**115. 偏离检测标记「未评估类型」：没数据不再显示成没问题（`engine/quality/deviation-detector.ts` / `ui/co-writing-view.ts`）**
- 现状：缺数据源时各检测方法直接返回空数组，`typeScores` 记 0——没有人物档案时「人物 OOC」永远 0、没有伏笔数据时「伏笔遗忘」永远 0、规划里没写节奏标注时「节奏偏离」永远 0、没有大纲/主线关键词时「主线偏离」永远 0。UI 只显示「0 严重 / 0 警告」，用户会理解成「已检查且没问题」，实际是「根本没检查」。
- 修复：`DeviationReport` 新增 `unevaluatedTypes`，由 `getUnevaluatedTypes(context)` 按数据源判定（主线：大纲或关键词；人物 OOC：人物档案；伏笔遗忘：追踪列表或前文 frontmatter；节奏：期望节奏）；纯文本分析的前后矛盾与情绪断层始终可评估。增量检测跳过的类型也计入未评估。顺序固定按 `DEVIATION_TYPES`，避免 UI 抖动。
- UI：协同实时顶栏在未评估时追加「· N类未评估」，悬停 title 列出具体类型并注明「数据源缺失，不代表无问题」；正文不足 100 字仍是整份报告不成立，由既有「暂不检测」路径处理，不逐类型标记。
- 单测：`deviation-detector.test.ts` +3（无上下文时四类未评估且顺序稳定；数据源齐备时为空；短正文不逐类型标记）。
- 全量 **262 文件 / 3741 用例**通过（新增 3 例）。

**116. 质量基线总分与维度统一 0 占位口径（`shared/quality-baseline.ts`）**
- 现状：维度统计已经明确排除 `0` 占位（旧记录缺维度时不会把均值拉到 0），但总分统计只过滤非有限值，`overallScore = 0` 的旧记录/空评估会作为真实低分参与均值。基线被拉低后，当前章节会恒判「高于基线」，而且样本数虚高、更容易越过 `minSamples` 门槛。
- 修复：总分过滤条件改为 `Number.isFinite(...) && > 0`，与维度口径一致；剔除 0 后有效样本不足 `minSamples` 时返回 `null`（宁可不给结论）。
- 单测：`quality-baseline.test.ts` +2（0 占位不参与均值：70/80/90/0 → 样本 3、均值 80；70/80/0 → 有效样本不足返回 null）。
- 全量 **262 文件 / 3743 用例**通过（新增 2 例）。

**117. 外貌矛盾收紧为同段共现：不再把「另一个角色金发」算到主角头上（`engine/quality/deviation-detector.ts`）**
- 现状：`detectSettingContradictions` 判据是「整章文本同时包含人物名和反义外貌词」。中文网文常用**单换行**分段，而 `extractCharacterParagraphs` 只按空行切分，等于把整章当成一段；只要配角在同一章被写成「金发」，主角也会被判 critical 外貌矛盾（degree 75/80）。人物 OOC 的关键词检测同样受影响，按全章共现放大误报。
- 修复：分段正则从 `\r?\n\r?\n` 改为 `\r?\n+`（单换行/空行都切）；新增 `findCharacterKeywordSnippet`，外貌矛盾必须在「包含人物名的同一段落」内找到反义词才成立，当前章与前文章节都按此口径，并把命中句作为 evidence。
- 单测：`deviation-detector.test.ts` +3（同章不同段落不算矛盾；同段落仍报；前文不同段落共现不算矛盾）。
- 全量 **262 文件 / 3746 用例**通过（新增 3 例）。

**118. 同人设定向导回填三条创作规则：不再「绑定后再保存就清空」（`ui/full-writer/fanfic-settings-utils.ts` / `wizard-step-renderers.ts`）**
- 现状：三条创作规则（必须遵守的原作规则 / 允许改编的范围 / 禁止触及的红线）只写在正文 `- **字段**：…`，不在 frontmatter；向导的 `addField` 对所有字段都走 `key:` 正则回填，正文解析函数 `getRuleSaved` 定义了却从未调用。于是绑定已有设定或 AI 生成后再次进入向导，三个 textarea 永远为空，点「保存同人设定」会把正文规则覆盖为空，触发「缺少字段」或直接丢失原作约束。
- 修复：新增纯函数 `extractFanficRuleValue(content, label)`（按正文 `- **字段**：` 读取，保留手写文件的多行续行，遇到下一条规则/标题/空行停止）；`addField` 的 textarea 分支改用它（frontmatter 有同名键时回退 `getSaved`）；删除从未调用的 `getRuleSaved`。
- 单测：`fanfic-settings-utils.test.ts` +4（生成内容回填三条规则；多行续行保留；遇到下一条规则/标题/空行停止；缺失返回空）。
- 全量 **262 文件 / 3750 用例**通过（新增 4 例）。

**119. 前文上下文扩到最近 3 章并支持跨卷：卷首章不再丢前文（`shared/previous-chapter-window.ts` / `ui/co-writing-view.ts`）**
- 现状：协同实时监控只读「同卷上一章」，路径靠 `getBodyPath().replace(第N章 → 第N-1章)` 拼出。章号实际跨卷连续（实测第 2 卷为 131–290 章、第 3 卷从 291 章起），卷首章按同卷拼路径必然读不到，前文上下文为空，跨章外貌矛盾与伏笔 frontmatter 全部失效；即使同卷也只有 1 章正文可用。
- 修复：新增纯函数模块 `shared/previous-chapter-window.ts`——`selectPreviousChapterFiles` 从正文根目录文件列表中按章号选出最近 3 章（跨卷、同章多份取最短路径正稿），`buildPreviousChapterWindow` 剥离 frontmatter 后按「单章 12000 字 / 合计 30000 字」预算裁剪，最近优先、空正文跳过。
- 调用侧：`loadPreviousChapterContext` 改为扫描 `${project}/03-大纲与章节/正文/` 下的文件（不再依赖同卷文件名替换），逐章 `cachedRead` 并用 `metadataCache` 取结构化 frontmatter 传入 `PreviousChapterContext.frontmatter`；缓存键改为候选路径列表，切书/切卷/切章自动失效。
- 单测：新增 `previous-chapter-window.test.ts` 14 例（frontmatter 剥离含 CRLF/无 frontmatter/空内容；跨卷选取最近 3 章；卷首章取上一卷；当前章及更晚章节排除；第 1 章无前文；忽略非正文文件与同章多份取短路径；窗口剥离 frontmatter 并按章号降序；空正文跳过；单章截断；总量用尽后截断；预算非正数返回空）。
- 全量 **263 文件 / 3764 用例**通过（新增 1 文件 14 例）。

**120. 前文多章下同一外貌矛盾只报一条：避免「1 个问题显示成 3 个严重问题」（`engine/quality/deviation-detector.ts`）**
- 现状：第 119 条把前文窗口扩到 3 章后，`detectSettingContradictions` 仍按「每个前文章节各报一条」处理：同一人物、同一个反义外貌词若连续出现在第 N-1、N-2、N-3 章，会产生 3 条 critical issue（issue id 带 chapterId），协同顶栏的「N严重」与建议列表被同一问题刷屏。
- 修复：按「人物 + 矛盾词」去重——当前章先检查并占位，前文章节按章号降序检查，已报过的组合直接跳过；因此每个矛盾只保留一条，且优先当前章、其次距离当前章最近的前文证据（`location.chapterRef` 指向该章）。
- 单测：`deviation-detector.test.ts` +3（多章重复只报一条且保留最近章；当前章已报则前文不重复；不同人物/不同矛盾词仍各报一条）。
- 全量 **263 文件 / 3767 用例**通过（新增 3 例）。

**121. 同人规则解析收敛到 shared：多行规则不再在 prompt 里只剩第一行（`shared/fanfic-rules.ts` / `ui/full-writer/fanfic-settings-utils.ts`）**
- 现状：同一份同人设定有两套解析口径——向导回填用 `extractFanficRuleValue`（保留多行续行、遇到下一条规则/标题/空行停止），而 prompt 注入走的 `parseFanficRules#pick` 只有单行正则 `**字段**：(.+)$`。用户手写或 AI 补全把规则写成多行时，向导里显示完整、prompt 里只剩第一行；只写 frontmatter（不写正文 `- **` 条目）时 prompt 直接拿不到规则，协同在「以为有约束」的状态下续写。
- 修复：`extractFanficRuleValue` 下沉到 `shared/fanfic-rules.ts`（正文 `- **字段**：` 多行续行 + frontmatter `字段: 值` 回退，正文优先）；`parseFanficRules` 的 `pick` 改用它；删除 UI 侧重复实现与 `escapeRegExp`，向导 renderer 与测试改为直接从 shared 导入。
- 单测：`fanfic-rules.test.ts` +3（多行续行进入解析与 prompt；只有 frontmatter 时回退；正文与 frontmatter 同时存在以正文为准）。
- 全量 **263 文件 / 3770 用例**通过（新增 3 例）。

**122. 偏离总评去掉恒失效的加权平均：总分 = 最严重单条，「面」单独展示（`engine/quality/deviation-detector.ts` / `ui/co-writing-view.ts`）**
- 现状：第 114 条之后的聚合是 `max(六类加权平均, 最严重单条 degree)`。但类型分数本身就是「该类最严重一条 issue 的 degree」，加权和（权重和 1.0）恒 ≤ 最严重单条，所以 `max` 永远取后者——加权平均是死代码，文档却宣称它在衡量「面」（多类同时偏离），属于旧信息污染。
- 修复：删除类型权重表与 `typeScores` 参数，`calculateOverallScore(issues)` 直接返回最严重单条 degree（0~100 夹紧、取整）；新增 `listDeviatedTypes(typeScores, unevaluatedTypes)` 表达「面」，协同顶栏显示 `· N类异常`，title 增加「异常类型：…」一行，未评估类型不计入。
- 单测：`deviation-detector.test.ts` +4（总分严格等于最严重单条；`listDeviatedTypes` 顺序稳定、排除未评估类型、全 0 返回空）。
- 全量 **263 文件 / 3774 用例**通过（新增 4 例）。

**123. 删除人物一致性检查的死参数 `historyTexts`：跨章 OOC 从未生效，API 不再假装支持（`engine/character-consistency-checker.ts` / `engine/quality/quality-score-engine.ts` / `engine/quality/deviation-detector.ts` / `engine/analysis-report-engine.ts`）**
- 现状：`CharacterConsistencyChecker#check(chapterText, characterInfos, historyTexts)` 接收第三个参数，但函数体内从头到尾没有读取它（只按人物档案检查当前章）。三处调用方却都在认真拼这个参数——`deviation-detector` 把前文窗口的全部正文过滤后传入、`quality-score-engine` 把 `EvaluationContext.previousChapterText` 包成数组、`analysis-report-engine` 公开方法也透传。于是 API 表面支持「跨章 OOC 对比」，实际完全没有发生，维护者会误以为这块已覆盖。
- 修复：删除 `historyTexts` 参数与 `ICharacterConsistencyChecker` 对应签名，三处调用方收敛为 `check(chapterText, characterInfos)`；`EvaluationContext.previousChapterText` 的唯一用途就是拼这个参数、且全仓无任何写入方，一并删除。跨章设定一致性仍由 `deviation-detector#detectSettingContradictions` 负责，职责边界写入 DEVELOPMENT 不变量。
- 单测：`deviation-detector.test.ts` 原「V1 CharacterConsistencyChecker 接收 historyTexts」改写为「只接收正文与人物设定」，断言调用参数恰好 2 个且第二个为人物档案（用例数不变）。
- 全量 **263 文件 / 3774 用例**通过（改写 1 例，净持平）。

**124. 外貌矛盾去重集合按人物维度建立：同一矛盾词不再跨矛盾组重复报（`engine/quality/deviation-detector.ts`）**
- 现状：第 120 条按「人物 + 矛盾词」去重，但 `reported` 集合建在 `for (const contradiction of APPEARANCE_CONTRADICTIONS)` 循环**内部**——每组矛盾各有一份集合。人物设定同时提到两种发色（如「原本一头黑发，后因功法变成金发」）时，「黑发」组与「金发」组都把「白发/银发/红发」列为反义词，当前章一旦出现这些词，两组各报一条，issue id 完全相同（`contradiction_setting_姓名_白发`），严重问题数被重复累加。另外当前章循环本身没有检查 `reported`，只有前文循环检查，跨组重复无法被拦住。
- 修复：`reported` 与 `contradictionKey` 上移到人物维度（每组矛盾共用），当前章循环同样先查 `reported` 再查证据、命中后占位；前文循环逻辑不变（当前章优先、其次最近前文）。
- 单测：`deviation-detector.test.ts` +1（设定同时含「黑发」「金发」、正文出现「白发」时只报 1 条且 id 不重复）。
- 全量 **263 文件 / 3775 用例**通过（新增 1 例）。

**125. 人物一致性检查改用单换行分段：同章其他角色的外貌不再算到主角头上（`engine/character-consistency-checker.ts`）**
- 现状：`CharacterConsistencyChecker#extractCharacterParagraphs` 只按空行 `\r?\n\r?\n` 切分。中文网文常用单换行分段，等于把整章当成一段；随后 `checkAppearance` / `checkBehavior` 按「段内含人物名 + 反义词」判定，配角在同一章被写成「金发」时，主角也会被判外貌矛盾（severity high）。Revision 116/117 只修了 `DeviationDetector` 的同名方法，V1 checker 仍走旧口径——而 `deviation-detector#detectCharacterOOC` 与 `quality-score-engine` 的人物一致性维度都复用该 checker，误报会同时进入偏离 UI 与质量分。
- 修复：分段正则改为 `/\r?\n+/`，与 `DeviationDetector` 保持同一口径；`checkAppearance` 同时按「人物 + 矛盾词」跨矛盾组去重（设定同时写「黑发」「金发」时，两组都把「白发」当反义，会重复报同一问题）。
- 单测：新增 `character-consistency-checker.test.ts` 3 例（单换行时配角金发不算主角矛盾；同段落共现仍报；设定含两种发色时同一矛盾词只报一条）。
- 全量 **264 文件 / 3778 用例**通过（新增 1 文件 3 例）。

**126. 性格标签支持关键词回退：设定写「冷静」不再跳过性格/行为检测（`engine/character-consistency-checker.ts`）**
- 现状：`PERSONALITY_TRAITS` 的键是「冷漠 / 沉稳 / 内向 / 聪明」等标签，值与常见描写词（冷静 / 沉默 / 机智）分开。`checkPersonalityKeyword` 与 `checkBehavior` 都只做 `personalityDesc.includes(trait)`（只认键），人物档案写「冷静」「沉默」「机智」时解析不到任何标签：性格检测直接返回、行为检测的 `relevantPatterns` 为空，两类问题永远不会被检出（quality 维度与偏离 OOC 同时静默）。
- 修复：新增 `resolveConfiguredTraits(personalityDesc)`——命中标签本身**或**该标签任一关键词都算已配置；性格与行为检测共用该解析。未改惩罚权重与判定文案。
- 单测：`character-consistency-checker.test.ts` +2（性格「冷静」+ 段落「惊慌失措」→ 报 behavior；性格「冷静」+ 段落「冷静地分析」→ 不报 personality）。
- 全量 **264 文件 / 3780 用例**通过（新增 2 例）。

**127. 协同实时监控注入纯计算偏离引擎：与 worker 路径同口径，V1 人物检测才真正生效（`ui/co-writing-view.ts`）**
- 现状：`quality-worker` 与 `heavy-task-worker` 构造 `DeviationDetector` 时都注入了 `PlotDivergenceEngine` 与 `CharacterConsistencyChecker`，协同视图却用 `new DeviationDetector()`——实时监测走的是简化版关键词回退，worker/分析路径走 V1。同一段正文在两条路径得到不同的 OOC/主线结论；124/125 修好的分段与性格关键词回退也只对注入路径生效，协同顶栏实际拿不到。
- 修复：`toggleQualityMonitor` 构造监控时注入两个纯计算引擎（`PlotDivergenceEngine` + `CharacterConsistencyChecker`），与 worker 路径一致；`rhythmAnalyzer` 仍不注入（依赖主线程 AI 能力，worker 同样不注入）。
- 单测：新增 `co-writer-monitor-wiring.test.ts` 2 例（开启监控时两个引擎已注入、WQE 内核与 `qualityKernel` 同一实例；已有监控实例时再次开启不重建）。
- 全量 **265 文件 / 3782 用例**通过（新增 1 文件 2 例）。

**128. V1 人物 OOC 的偏离度加严重度下限：不再出现「偏离 15 · 严重」（`engine/quality/deviation-detector.ts`）**
- 现状：V1 路径下 issue 的 `degree` 取 `100 - 角色一致性得分`，而 `CharacterConsistencyChecker#calculateCharacterScore` 对单条 high 只扣 `15 × confidence`（0.95 → 角色分 85.75 → degree 14.25）。`mapV1Severity` 又按 `inc.severity === 'high'` 直接判 critical。Revision 122 把总评改为「最严重单条 degree」后，协同顶栏因此出现「偏离 14 · 1严重」——严重度说严重、数值说没问题，用户无法判断该不该改。Revision 126 把 checker 注入协同实时监控后，这条矛盾会直接出现在真实界面。
- 修复：`degree` 按 issue 严重度设下限——high 不低于 `severityThresholds.critical`（默认 60）、medium 不低于 `severityThresholds.warning`（默认 30）、low 保持角色分推导值；上限夹紧 100。`severity` 仍由 `mapV1Severity` 决定（high→critical、medium→warning），两侧口径由此自洽。
- 未改：角色分与惩罚权重（`calculateCharacterScore`）保持原样——它是「多问题累计扣分」的另一口径，本次只修报告自相矛盾，不动评分模型。
- 单测：`deviation-detector.test.ts` +3（high 的 degree ≥ critical 阈值且 severity=critical；medium 的 degree ≥ warning 阈值；low 保持 3 且 severity=info）。
- 全量 **265 文件 / 3785 用例**通过（新增 3 例）。

**129. 实时质量的部分/全部失败不再静默：区分「没测」与「没问题」（`engine/quality/realtime-monitor.ts` / `ui/co-writing-view.ts`）**
- 现状：`RealtimeMonitor` 把 `failures` 只在 `partialFailure` 时返回，两个引擎都失败时 `failures = undefined`；协同视图也从未读取 `partialFailure` / `failures`。后果：偏离检测抛错、质量分成功时，顶栏只显示「质量 82 · 3 问题」，用户看到「没有偏离信息」会理解为「无偏离」；两边都失败时顶栏显示「质量 --」，与「正文不足 100 字、暂不评估」完全同形。
- 修复（引擎）：`failures` 改为「有失败就返回」，不再只在 partial 时给出——全部失败时 UI 才能拿到原因。
- 修复（UI）：新增 `describeMonitorFailures`，把 `quality:` / `deviations:` / 其它前缀映射成「质量评分失败 / 偏离检测失败 / 评估异常」（去重）。顶栏规则：两项都失败 → 「质量评估失败（…）」而不是「质量 --」；偏离单独失败 → 顶栏追加「偏离检测失败」，title 追加原始失败原因；正常 → 行为不变，「未检测到偏离」tooltip 保留。
- 单测：`realtime-monitor.test.ts` +1（全部失败时 `failures` 仍含两条原因）；新增 `co-writer-monitor-failure-status.test.ts` 3 例（偏离失败显式告知、全失败显示「质量评估失败」、成功时无失败提示）。
- 全量 **266 文件 / 3789 用例**通过（新增 1 文件 4 例）。

**130. 面板 B 的偏离/质量评估异常不再保留旧结果（`ui/monitor-panel-b.ts`）**
- 现状：`runDivergenceEval` / `runQualityEval` 的 `catch` 只写 `log.warn`，卡片继续显示上一次渲染的分数。切章或正文大幅修改后若引擎抛错（数据形状异常、分词/正则边界），用户看到的是旧章/旧文本的结论，且没有任何提示——与 Rev 74 修过的「0 分冒充真实结论」是同一类误导。
- 修复：新增 `renderEvalFailure(container, title, reason, fontSize)`，异常时清空卡片并显示「整体偏离度 --」/「综合质量 --」+「本次评估失败，结果未更新」；展开状态下详情面板重建为「本次评估失败，暂无偏离/质量详情」。与 `render*NoData` 分开：前者是「正文过短、预期内不评估」，后者是「本次没测成」。
- 单测：新增 `monitor-panel-b-eval-failure.test.ts` 3 例（偏离抛错清旧值且不写历史、质量抛错清旧分数、展开时详情显示失败原因）。
- 全量 **267 文件 / 3792 用例**通过（新增 1 文件 3 例）。

**131. 面板 B 的完成度评估异常同样不再保留旧结果（`ui/monitor-panel-b.ts`）**
- 现状：Revision 130 修了偏离与质量两条路径，`runCompletionEval` 的 `catch` 仍只写 `log.warn`——切章后完成度引擎抛错时，卡片继续显示上一章的「综合完成度 78分」，与另两张卡的修复口径不一致。
- 修复：`catch` 中复用 `renderEvalFailure`，主卡片显示「综合完成度 --」+「本次评估失败，结果未更新」，展开时详情显示「本次评估失败，暂无完成度详情」。
- 单测：`monitor-panel-b-eval-failure.test.ts` +1（完成度引擎抛错时清旧值、不写历史）。
- 全量 **267 文件 / 3793 用例**通过（新增 1 例）。

**132. 情绪断层检测改用单换行分段：真实正文不再整类静默（`engine/quality/deviation-detector.ts`）**
- 现状：`detectEmotionBreak` 仍按 `/\n\n+/` 切段。中文网文单换行分段时整章只有 1 段，函数在 `paragraphs.length < 3` 处直接返回，**情绪断层在真实正文里永远不会被检出**；而它不在 `unevaluatedTypes` 里（有数据源），UI 不会提示「未评估」，等于用「0 条」冒充「无问题」。Revision 124/125 只修了人物相关检测的三处口径，漏了这一处。
- 修复：分段改为 `/\r?\n+/`，与 `extractCharacterParagraphs` / `findCharacterKeywordSnippet` 同口径；阈值（连续 4 段无情绪元素 → warning、3 段 → info）与文案不变。
- 单测：`deviation-detector.test.ts` +4（`\n` 单换行可检出、`\r\n` 单换行可检出、`\n\n` 空行保持原行为、每段都含情绪元素时不报）。
- 全量 **267 文件 / 3797 用例**通过（新增 4 例）。

**133. V1 人物 OOC 保留 checker 的段落定位（`engine/quality/deviation-detector.ts`）**
- 现状：`CharacterConsistencyChecker` 在每条不一致上都写了 `location`（「第N段附近」，共 5 处），但 `detectCharacterOOC` 的 V1 路径写成 `location: inc.location ? { character: name } : { character: name }`——恒等三元，位置信息被静默丢弃，`DeviationIssue.evidence`（注释写明「用于溯源」）永远为空。
- 修复：删除恒等三元，`location` 固定为 `{ character: name }`，把 `inc.location` 落进 `evidence`；无定位时不产生空数组。
- 单测：`deviation-detector.test.ts` +1（断言 `evidence === ['第1段附近']` 且 `location.character` 正确），先红后绿。
- 全量 **267 文件 / 3798 用例**通过（新增 1 例）。

**134. 删除 `ICharacterChecker` 接口里遗留的假参数 `historyTexts`（`engine/quality/quality-score-engine.ts`）**
- 现状：Revision 122 已从 `CharacterConsistencyChecker#check` 与三处调用方删除 `historyTexts`（函数体内从未使用），但 `QualityScoreEngine` 自己的 `ICharacterChecker` 接口仍声明 `historyTexts?: string[]`——实现已诚实、接口还在声称支持跨章 OOC，新增调用方会照着接口传前文。
- 修复：接口签名改为 `check(chapterText, characterInfos)`，并注明跨章一致性由 `DeviationDetector` 负责。
- 证据：该参数已无任何实现与调用（全仓 grep 仅剩接口本身）；删除后 `npm run typecheck` 通过即可证明无悬挂引用，未新增运行时用例（用例数保持 267/3798）。

**135. 同人设定库：解析并注入「原作主要人物」（`shared/fanfic-rules.ts` / `ui/full-writer/fanfic-settings-utils.ts`）**
- 现状：模板与资产里的同人设定一直有「## 主要人物」「## 势力组织」两节，但 `buildFanficSettingsContent` 不产出它们、`parseFanficRules` 不解析、`formatFanficRulesForPrompt` 不注入。用户填了原作角色表，prompt 里只有「世界观/力量体系/三条规则」，模型不知道这些角色原本是谁，同人正文照样在性格与定位上 OOC。
- 修复：
  - `parseFanficCharacters` 解析「## 主要人物」多条目（人物名 / 原作定位 / 在同人中的变化），占位「（待补充）」与「待补充」直接丢弃；
  - `formatFanficRulesForPrompt` 新增「【原作主要人物】」段，最多注入 6 人（`FANFIC_MAX_INJECTED_CHARACTERS`）、单字段 60 字（`FANFIC_CHARACTER_FIELD_MAX_CHARS`），保住本地 8K 预算；
  - `buildFanficSettingsContent` 骨架补「## 主要人物」「## 势力组织」（占位「（待补充）」），AI 生成与向导保存结构一致，AI 提示词「替换所有（待补充）」即可自动填人物。
- 单测：`fanfic-rules.test.ts` +5（多条目解析、prompt 注入、无该节向后兼容、超上限只注入 6 人、占位忽略）；`fanfic-settings-utils.test.ts` +1（生成骨架含两节且占位不被当成真实人物注入）。
- 全量 **267 文件 / 3804 用例**通过（新增 6 例）。

**136. 同人设定库：解析并注入「势力组织」（`shared/fanfic-rules.ts`）**
- 现状：135 只接了「## 主要人物」，「## 势力组织」仍只在模板与生成骨架里躺着——势力决定阵营立场与冲突逻辑，不注入时模型容易写错谁与谁对立。
- 修复：抽出通用 `parseFanficEntrySection`（小节标题 + 名称字段标签），人物与势力共用；新增 `parseFanficFactions` 与 `FanficRules.factions`；`formatFanficRulesForPrompt` 抽 `buildEntryLines`，新增「【原作势力组织】」段（同样最多 6 条、单字段 60 字），位置在人物之后、创作规则之前。
- 单测：`fanfic-rules.test.ts` +4（多势力解析、势力段注入且不与人物段混排、无该节向后兼容、占位「（待补充）」忽略）。
- 全量 **267 文件 / 3808 用例**通过（新增 4 例）。

**137. 协同指纹注入按 V2 12 维相似度筛选前 3 个（`engine/prompt-builder.ts`）**
- 现状：4.1 上线了 V2 12 维检索（`StyleFingerprintLibrary#searchSimilarStylesV2`），但生产 prompt 从没用过——`getFingerprintPromptParts` 把 `getEnabledFingerprints` 返回的**全部启用指纹**交给 `TieredInjectionBuilder.build`。用户启用 5 个以上指纹时，与当前正文无关的指纹也在约束模型，全局层特征描述与各指纹示例片段一起挤占本地 8K 窗口。
- 修复：
  - 新增 `MAX_INJECTED_STYLE_FINGERPRINTS = 3`；
  - 新增私有方法 `selectFingerprintsForInjection`：启用数 ≤3 直接返回全量（不为 3 个指纹多发一次 embedding 请求）；>3 时用正文尾部 500 字调 `searchSimilarStylesV2({ topN: 3 })`，按返回的 `fingerprintId` 取交集；
  - 降级：方法不存在 / 空结果 / 抛错一律回退全量——风格约束不能因为一次检索失败而丢失；
  - `tieredInjectionBuilder.build` 的指纹参数与「示例片段过滤集合」同步改用 `fingerprintsForInjection`，避免被筛掉的指纹仍把样本带进 prompt。
- 单测：`prompt-builder-fingerprint.test.ts` +4（超 3 个只注入 top3 且断言 `topN=3`；≤3 个不发起检索；空结果回退全量；抛错回退全量）。
- 全量 **267 文件 / 3812 用例**通过（新增 4 例）。

**138. 同人设定库：解析并注入两张时间线表（`shared/fanfic-rules.ts`）**
- 现状：模板与生成骨架都有「## 原作剧情时间线」「## 故事背景时间线（你的同人）」，表头写明「全量输入，用于 AI 写作时检索当前章节在原作时间线上的位置」「AI 跟随识别当前位置」。但 `parseFanficRules` 只认 `- **字段**：` 格式，两张 Markdown 表从未被读取：同人续写既不知道当前情节落在 canon 哪一段，也看不到本书自己的时间进度，时间跳跃与 canon 冲突没有任何约束。
- 修复：
  - 新增 `parseFanficTimeline(content, sectionTitle)`：按标题定位小节（允许「（你的同人）」这类后缀）→ 只收 `|` 行 → 若存在 `|---|` 分隔行，连同紧邻的表头一起丢弃 → 单元格 trim 后用「｜」连接 → 整行都是「待补充」的占位行丢弃（生成骨架写的就是占位行）。
  - `FanficRules.originalTimeline` / `fanficTimeline` 两个字段分别解析；`formatFanficRulesForPrompt` 分两段注入：「【原作剧情时间线】」在核心设定之后、「【同人时间线】」在势力组织之后——一个是 canon 事件顺序，一个是本书进度，混排会让模型对不上号。
  - 注入上限 `FANFIC_MAX_INJECTED_TIMELINE_ROWS`(8) 行、单行 `FANFIC_TIMELINE_ROW_MAX_CHARS`(120) 字：模板说的「全量输入」指数据源不做采样，不等于可以无视本地 8K 窗口把整张表塞进 prompt。
- 单测：`fanfic-rules.test.ts` +5（两张表分别解析并丢弃表头/分隔/占位、分两段注入且不出现「待补充」、上限 8 行与单行截断、无该节时向后兼容、解析不误吞后续小节）。
- 全量 **267 文件 / 3817 用例**通过（新增 5 例）。

**139. 前文章节缓存按文件签名失效（`ui/co-writing-view.ts`）**
- 现状：`loadPreviousChapterContext` 的缓存键只有候选文件路径，且没有 TTL。用户在同一次协同会话里改完上一章（改发色、改时间点、补一段设定）再回来写本章时，**偏离检测仍拿旧正文比对**——改过的设定看不到、已解决的前文矛盾不会消失，「设定矛盾 / 时间线矛盾」两类结论会一直停留在旧版本，直到切章或重开视图。
- 修复：
  - 缓存键改为「路径 + `stat.mtime` + `stat.size`」（与 `LocalVectorStore` 的文件签名同口径），文件被移走时记 `:missing`，不会命中旧缓存；
  - 首次解析出的 `TFile` 用 `Map` 复用到读取循环，避免为做签名再查一遍。
- 单测：新增 `cowrite-previous-chapter-cache.test.ts` 1 文件 3 例（未变化时复用缓存不重复读盘；改 mtime/size 后重读并返回新正文；文件被移走后返回空而不是旧列表）。先红（2 例失败：`cachedRead` 仍为 2 次、仍返回旧列表）后绿。
- 全量 **268 文件 / 3820 用例**通过（新增 1 文件 3 例）。

**140. 同人核心字段的「（待补充）」不再进入 prompt（`shared/fanfic-rules.ts`）**
- 现状：134/135 已经把人物/势力的占位条目丢弃，但 `parseFanficRules` 的六个字符串字段（世界观类型 / 力量体系 / 核心规则 / 三条创作规则）仍原样保留。生成骨架把这些字段初始化为「（待补充）」，AI 提示词也要求「不确定的内容写待补充」，于是协同 prompt 会出现「- 必须遵守的原作规则：（待补充）」这类**假约束**；整份设定全是占位时，`formatFanficRulesForPrompt` 仍会输出「【同人创作约束（最高优先级，违反即返工）】」整块，等于告诉模型「有约束」但内容全是占位。
- 修复：`parseFanficRules` 的 `pick` 在解析阶段过滤 `待补充` / `（待补充）` / `(待补充)`，与人物/势力条目同口径；向导回填仍走 `extractFanficRuleValue`，保留原文占位便于用户编辑（不改变 UI 行为）。
- 单测：`fanfic-rules.test.ts` +3（全占位时六个字段解析为空、全占位不产生约束块、混填只丢占位字段）。先红（3 例失败：占位仍进入 prompt）后绿。
- 全量 **268 文件 / 3823 用例**通过（新增 3 例）。

**141. 同人设定的「（待补充）」不再通过校验（`shared/template-validator.ts` / `ui/full-writer/fanfic-settings-utils.ts` / `ui/full-writer/wizard-step-validators.ts`）**
- 现状：`validateFanficSettings` 对 9 个字段只判断 `(.+)` 是否有字符，时间线只数 `|` 行数（`>= 3`：表头 + 分隔行 + 占位行即达标）。AI 原样回显骨架（字段全是「（待补充）」、时间线只有占位行）时 `finalCheck.valid === true`，弹窗提示「✅ 已保存并绑定」；但第 140 条之后 `parseFanficRules` 会把这些占位全部丢弃 → 用户以为有同人约束，实际 prompt 里零约束。绑定时同样提示「✅ 已绑定」，向导也会把「同人设定」步骤标成完成。
- 修复：
  - 新增 `isFanficValueFilled`：trim、去行尾注释、去成对引号后，拒绝 `待补充` / `（待补充）` / `(待补充)` / `待填写` / `...` / `—` / `-`；保留「未知 / 无」为合法值（作者未知、没有额外红线是用户可以明确表达的内容）。
  - `validateFanficSettings` 的 9 个字段改为「捕获值必须实质填写」（frontmatter 走 `readYamlFieldValue`，支持引号与块标量）；时间线改为「表格结构存在 + `parseFanficTimeline` 至少返回 1 行」——与 prompt 注入侧同一口径。
  - 新增 `FanficValidationOptions.requireTimelineData`（默认 true）。`isFanficSettingsContentValidEnough` 传 false：向导表单只收集 9 个字段、不收集时间线，严格口径会让「保存成功 → 重启 → 步骤变未完成」。
  - `wizard-step-validators` 的同人分支改用 `isFanficSettingsContentValidEnough`，保证保存侧与回读侧同一口径（此前用严格校验，骨架里的占位时间线行恰好让它通过）。
- 单测：`fanfic-settings-utils.test.ts` +4（全占位骨架无效且绑定不得提示成功、占位时间线行不算数据、两张表有真实行时严格校验通过、引号包裹的占位同样无效）。先红（3 例失败：占位仍判有效）后绿。
- 全量 **268 文件 / 3827 用例**通过（新增 4 例）。

**142. 同人上下文按 `.project` 的完整路径读取，占位不再进面板（`engine/context-manager.ts` / `shared/template-validator.ts`）**
- 现状：`ContextManager` 读取同人设定时先取 `.project` 的「## 同人设定路径」，再把它当**文件名**传给 `pjFanficFile(project, …)` 拼一次 `05-同人设定库`。但写入侧（`attachFanficPathToProject` / 向导）记录的是**完整 vault 相对路径**，于是实际请求变成「项目/05-同人设定库/项目_05-同人设定库_名字.md」（路径分隔符被 `sanitizeName` 替换）——文件永远不存在，`loadFanficCanonTimeline` / `loadFanficFanTimeline` / `loadFanficRules` 与 `gatherTimeline` 的同人分支对本项目一直静默返回空；上下文面板的「📜 原作剧情时间线」「📖 故事背景时间线」「⚠️ OOC 防护规则」三张卡对同人项目从未出现过。
- 同一读取链还有第二个问题：面板用的 `parseCanonTimelineTable` / `parseFanTimelineTable` 只按 `|` 行解析，骨架里的「待补充」行会作为时间线展示；`loadFanficRules` 也把「（待补充）」当成规则——而 prompt 侧的 `parseFanficRules` 早已过滤。面板与 prompt 口径不一致，用户会以为「上下文里有约束」。
- 修复：
  - 新增 `ContextManager#resolveFanficSettingsFile`：优先按 `.project` 记录的完整路径直接 `getAbstractFileByPath`；旧数据只写文件名时回退到 `pjFanficFile(project, basename)`。四处调用点（`gatherTimeline` 同人块 + 三个 `loadFanfic*`）统一改用它。
  - `parseCanonTimelineTable` / `parseFanTimelineTable` 过滤「整行都是空/占位」的行；`loadFanficRules` 的 `mustFollow` / `redlines` 按分号拆条后丢弃占位，`adaptScope` 占位返回空串。
- 单测：`context-manager.test.ts` +3（记录完整路径时读出时间线与规则、旧数据只写文件名时回退成功、骨架占位行与占位规则不作为上下文内容）。先红（完整路径例返回空数组）后绿；修正路径后占位例再红，补过滤后转绿。
- 全量 **268 文件 / 3830 用例**通过（新增 3 例）。

**143. V2 指纹排名只作用于启用指纹（`engine/style-fingerprint-library.ts` / `engine/prompt-builder.ts`）**
- 现状：第 137 条让位置生成在启用 >3 个指纹时用 V2 检索取 top3，但 `searchSimilarStylesV2` 的候选是**全部指纹**（template 来源库 + 全局 + 项目，含已禁用）。用户禁用若干指纹、或库里存在 template 指纹时，top3 很容易被这些「不该参与」的指纹占满；与启用集合取交集后为空 → 回退全量，`MAX_INJECTED_STYLE_FINGERPRINTS` 的上限形同虚设，又回到「5 个以上指纹一起约束模型、挤占本地 8K 窗口」的老问题。
- 修复：`searchSimilarStylesV2` 新增 `fingerprintIds` 选项（先收窄候选再排名）；`selectFingerprintsForInjection` 传入启用指纹 id 列表。
- 单测：`fingerprint-library-v2-load.test.ts` +1（指定集合内只返回该指纹）；`prompt-builder-fingerprint.test.ts` 既有用例补断言 `fingerprintIds` 为启用集合。先红（2 例失败：库未收窄、调用未传参）后绿。
- 全量 **268 文件 / 3831 用例**通过（新增 1 例）。

**144. 同人设定在会话中失效后重新提示（`ui/co-writing-view.ts`）**
- 现状：`warnFanficRulesOnce` 只在 `loadChapter` 的 `initEngine` 之后调用一次。引擎的 `syncFanficRules` 每次生成前都会重读设定文件并把 `loadError` 写入 `lastFanficRules`，`getFanficRulesWarning()` 能反映最新状态，但界面从不复查：会话中删掉/移走 `{作品名}设定.md` 后，建议 / 迭代 / 改写 / 流式四条生成路径与手动联想、自动幽灵建议两条联想路径都继续以「零同人约束」的 prompt 静默生成，只在日志留一条 warn。
- 去重键还有第二处漏洞：警告消失后 `lastFanficWarningKey` 不清空，用户修好路径、随后同一文案再次失效时键仍命中 → 第二次失效永不提示。
- 修复：
  - `showKnowledgeInjectionNotice()` 开头补 `this.warnFanficRulesOnce()`：它是四条生成路径的统一收口（两条联想路径不经过它）。
  - `handleAssociationSuggest` / `refreshGhostAssociation` 在 `suggestAssociation` 返回、过完代次与开关守卫后各补一次；自动联想是最高频的后台生成，同样必须复查。
  - `warnFanficRulesOnce` 在「无警告」时清空 `lastFanficWarningKey`，去重口径从「进程内只提示一次」改成「每次失效提示一次」。
- 单测：新增 `cowrite-fanfic-warning.test.ts` 1 文件 8 例（首次失效提示一次并记键、同项目同文案不重复、文案变化重新提示、恢复后再失效再提示、无警告不写键、知识注入收口复查、自动联想复查、手动联想复查）。先红（4 例失败：收口与两条联想均未复查）后绿。
- 全量 **269 文件 / 3839 用例**通过（新增 1 文件 8 例）。

**145. 同人设定「文件存在但内容全空」同样提示（`shared/fanfic-rules.ts`）**
- 现状：139 让 `parseFanficRules` 在解析阶段丢弃「待补充」占位，于是「AI 原样回显骨架」或用户只点保存没填内容时，六个字段、人物/势力、两张时间线全部解析为空，`formatFanficRulesForPrompt` 返回空串——但 `loadError` 未定义，`formatFanficRulesLoadWarning` 直接返回 null。用户看到的是「绑定成功、文件也在」，实际协同 prompt 里零同人约束，143 的会话复查也只会查到 null。
- 修复：`formatFanficRulesLoadWarning` 在 `isFanfic && 无 loadError` 时判断是否真有可注入内容（六字段 / 人物 / 势力 / 两张时间线任一非空；作品名与路径不算），全空则提示「同人设定里没有可用内容…「待补充」占位不算填写」。
- 单测：`fanfic-rules-load-warning.test.ts` +4（全占位文件提示带路径、只填人物不误报、只有作品名标题仍提示、不变量「注入块为空 ⇔ 必给警告」）。先红（3 例失败：占位文件与纯标题均返回 null、不变量不成立）后绿。
- 全量 **269 文件 / 3843 用例**通过（新增 4 例）。

**146. 流式建议写入本次知识注入条数（`engine/co-writer-engine.ts`）**
- 现状：`lastKnowledgeCount` 只在三方向候选（`generateDirectionalCandidate`）、迭代、改写三处写入；流式建议（Tab 主路径）从不写。视图在流式生成完成后调用 `showKnowledgeInjectionNotice()`，于是「📚 已注入 N 条知识库片段」显示的是**上一条建议**的旧数字（或初始 0）：用户要么看不到本次注入、要么被提示告知「注入了 3 条」而本次实际 0 条。
- 修复：`suggestStream` 在构造 prompt 前按本次实际注入的片段数写入 `lastKnowledgeCount`（与迭代/改写同一表达式，检索异常分支已把 `knowledgeParts` 置空 → 归零）。
- 单测：新增 `co-writer-stream-knowledge-count.test.ts` 1 文件 2 例（注入 2 条时计数为 2；检索抛错且上一条残留 3 时归零）。先红（2 例失败：0≠2、3≠0）后绿。
- 全量 **270 文件 / 3845 用例**通过（新增 1 文件 2 例）。

**147. 实体生成入口统一提示同人设定失效（`ui/fanfic-prompt-notice.ts` + 6 个弹窗）**
- 现状：人物 / 势力 / 地点 / 物品 / 统一实体 / AI 建卡共 7 处都直接 `formatFanficRulesForPrompt(await readFanficRules(...))`。同人项目未绑定路径、文件不存在、读取失败或文件里只有骨架占位时返回空串，且没有任何提示：用户以为「同人项目生成的人物一定受原作约束」，实际生成的人物/势力脱离原作体系，并成为后续 OOC / 设定矛盾检测的错误基准。
- 修复：新增 `readFanficPromptBlockWithNotice`（读取 → 失效判定 → `Notice(…, 8000)` → 返回约束块），7 处调用点统一替换；失效判定直接复用第 145 条的口径，不另写一套。
- 单测：新增 `fanfic-prompt-notice.test.ts` 1 文件 4 例（有效设定无提示、全占位提示带路径、未绑定路径提示、原创项目不提示）。先红（模块不存在）后绿。
- 全量 **271 文件 / 3849 用例**通过（新增 1 文件 4 例）。

**148. 同人时间线面板与 prompt 同源、空单元格不再错列（`shared/fanfic-rules.ts` / `shared/template-validator.ts`）**
- 现状：同一条同人时间线有两套解析器。prompt 侧 `parseFanficTimeline` 保留原始单元格、只过滤占位；上下文面板侧 `parseMarkdownTable` 先 `filter(c => c.length > 0)` 再按列名映射。用户没填「涉及人物」时，「章节参考」会落到「涉及人物」列、「你的同人如何切入」落到「章节参考」列——面板显示的是错位数据，与 prompt 里的行内容对不上（违反「面板与 prompt 必须同口径」）。原创「纪元 / 时间轴」共用同一解析器，同样错列。
- 同一读取链还有第二个口径差：面板的 `loadFanficRules` 用单行正则 `.+` 取规则，用户把一条规则写成续行时面板只有第一行，prompt 侧 `extractFanficRuleValue` 却带着完整内容。
- 修复：
  - `shared/fanfic-rules.ts` 新增 `parseFanficTimelineRows(content, sectionTitle): string[][]`：保留空单元格、列位置与文件一一对应，仍丢弃表头/分隔行/整行占位；`parseFanficTimeline` 改为基于它拼 prompt 行。
  - `shared/template-validator.ts` 的 `parseCanonTimelineTable` / `parseFanTimelineTable` 改为复用同一行解析后按列名映射；删除只服务于旧实现的 `isTimelineRowMeaningful`。
  - `parseMarkdownTable`（原创纪元时间轴）只去掉首尾竖线，不再过滤中间空单元格。
  - `loadFanficRules` 改用 `extractFanficRuleValue` 读取三条规则；`splitFanficRules` 同时按分号与换行拆条（面板仍按条展示）。
- 单测：新增 `fanfic-timeline-parity.test.ts` 1 文件 6 例（原作/同人时间线空单元格不错列、原始行保留空单元格、prompt 行数与面板行数一致、原创纪元时间轴不错列、面板规则覆盖续行）。先红 6/6 后绿。
- 全量 **272 文件 / 3855 用例**通过（新增 1 文件 6 例）。

**149. 同人时间线按当前进度选窗口，不再永远取前 8 行（`shared/fanfic-rules.ts`）**
- 现状：`formatFanficRulesForPrompt` 对两张时间线都只做 `slice(0, 8)`。模板表头写明「用于 AI 写作时检索当前章节在原作时间线上的位置」「章节推进时 AI 跟随识别当前位置」，但用户写到中后期时：本书自己的同人时间线超过 8 行后，最新进度永远看不到（前 8 行是老进度）；原作时间线超过 8 行后，canon 后段（往往才是当前情节所在）永远看不到。本地 8K 预算下又不能全量注入，「取前 8 行」是错误的选择策略而不是单纯的上限。
- 修复：
  - 同人时间线（本书进度）超过上限时取**最近 8 行**：行序即故事进度，越靠后越接近当前章节。
  - 原作时间线（canon）用同人时间线最近 3 条记录的「对应原作时间」在 canon 行里找锚点（先精确匹配、再包含匹配，取最近一次出现），取「锚点前 2 行 + 之后」的连续 8 行；找不到锚点时保持「前 8 行」，只填 canon 的用户行为不变。
  - 发生截断时补一行说明（`（原作时间线共 N 行，以上为第 X–Y 行）` / `（同人时间线共 N 行，以上为最近 8 行）`），避免模型把「没注入」误读成「时间线到此结束」。
  - 上限（8 行 / 单行 120 字）与两张表的注入顺序不变。
- 单测：新增 `fanfic-timeline-window.test.ts` 1 文件 6 例（同人表取最近 8 行 / canon 按锚点取窗口 / 无锚点回退前 8 行 / 锚点在末尾时夹紧 / 占位锚点不匹配 / 未超上限不出现截断说明）。先红（4 例失败：仍取前 8 行）后绿。
- 全量 **273 文件 / 3861 用例**通过（新增 1 文件 6 例）。

**150. 全文写作模板变量读取同人约束时同样提示失效 + 入口守卫（`ui/full-writer/template-vars-builder.ts` / `tests/unit/ui/fanfic-read-entry-guard.test.ts`）**
- 现状：第 147 条把实体生成 7 处入口统一到 `readFanficPromptBlockWithNotice`，但全文写作的模板变量构建（`buildTemplateVars` 的 `fanficRules`）仍是 `formatFanficRulesForPrompt(await readFanficRules(...))`：同人项目未绑定设定 / 文件不存在 / 读取失败 / 内容全是骨架占位时，模板渲染拿到的仍是空串，且没有任何提示——11 步流水线与全文写作链路继续在「零同人约束」下生成，用户以为模板里带原作约束。
- 修复：`template-vars-builder` 改用 `readFanficPromptBlockWithNotice(deps.app, deps.project)`（读取 → 失效判定 → `Notice(…, 8000)` → 返回约束块），与实体生成同一入口、同一判定口径；不再直接 import `readFanficRules` / `formatFanficRulesForPrompt`。
- 新增源码级守卫 `fanfic-read-entry-guard.test.ts`（1 文件 1 例）：递归扫描 `ui/**/*.ts`（先剥离注释，避免文档里的反例被误判），断言不存在 `formatFanficRulesForPrompt(await readFanficRules(`；并断言扫描文件数 > 40，防止路径错误导致空集假绿。
- **先红后绿**：守卫先报 `full-writer\template-vars-builder.ts` 一处违规，修复后通过。
- 全量 **274 文件 / 3862 用例**通过（新增 1 文件 1 例）。

**151. 同人人物/势力按当前章节相关度选取，不再永远取前 6 条（`shared/fanfic-rules.ts` / `engine/co-writer-engine.ts`）**
- 现状：`formatFanficRulesForPrompt` 对「原作主要人物」「原作势力组织」都只做 `slice(0, 6)`。模板把这两节当成本章可用的原作资料，但角色/势力超过 6 条时，本章真正出场、排在第 7 位之后的角色永远不可见——模型只能靠猜，与「模板承诺的结构必须被读取侧消费」相悖。本地 8K 窗口只能注入 6 条，所以问题不是上限，而是「取哪 6 条」。
- 修复：
  - `formatFanficRulesForPrompt(rules, options?: { focusText?: string })`：超过上限时按 `focusText` 中名字出现次数排序（同分保持原顺序），取前 6；没有 `focusText` 时回退前 6（只填资料、尚未写正文的场景行为不变）。
  - 截断时补说明：`（原作主要人物共 N 人，以上为与当前章节相关的 6 人）`；无上下文时写「以上为前 6 人」。
  - `CoWriterEngine#syncFanficRules(project, focusText?)` 用「本章大纲前 600 字 + 本次已写正文尾部 900 字」构造 focus；续写 / 流式 / 选区改写（选中文本）/ 迭代（前文）/ 联想（光标前 500 字）五个入口分别传入本次实际文本，初始化与静态刷新回退 `snapshot.precedingText`。
  - 上限（6 条 / 单字段 60 字）与两段顺序不变。
- 单测：新增 `fanfic-entry-selection.test.ts` 1 文件 6 例（第 8 位角色进集合 / 无上下文回退前 6 / 次数多者靠前 / 势力同规则 / 未超上限无说明 / 空 focus 与未传一致）；`co-writer-fanfic-prompt.test.ts` +2（已写正文提到第 8 位角色时约束块包含它；无正文时用本章大纲）。先红（4/6 失败：仍取前 6 且无说明）后绿。
- 全量 **275 文件 / 3870 用例**通过（新增 1 文件 6 例 + 2 例接线）。

**152. 实时质量评分把人物档案/大纲送进 V1 内核，且上下文变化不再复用旧分（`engine/quality/quality-score-engine.ts` / `ui/co-writing-view.ts`）**
- 现状：协同视图的实时质量评估只传了 `deviationContext`，`qualityContext` 从未传入；而 `QualityScoreEngine` 注入 `v1Engine` 后，六维与总分全部取自 `WritingQualityEngine`，它的 `evaluate(text)` 只接收文本——`EvaluationContext` 里的 `characterNames` / `characterInfos` / `chapterOutline` 在这条路径上完全被忽略。于是人物维度只能走「X说 / X道」正则估算（`details.estimation = 基于对话标记估算`），视图已经加载的人物档案等于白读；同时维度缓存与完整结果缓存都只按 `textHash` 计算，补上上下文后同一段正文仍会拿到旧分。
- 修复：
  - `QualityScoreEngine` 新增 `syncV1Context`：在读取任何缓存之前，把 `characterNames ?? characterInfos.map(name)`、`chapterOutline`、`mainlineKeywords` 同步进 V1 内核；三样都没给时不修改内核，避免覆盖调用方构造时配置的名单。
  - 以「人物名单 + 大纲 + 主线词」组成签名，签名变化时清空 `dimensionCache` / `fullCache`：同一段正文换了名单必须重新算分，不必等 TTL 过期。`evaluate` 与 `evaluateDimension` 两条入口都走同一同步逻辑。
  - `CoWritingView#evaluateRealtimeQuality` 复用同一份 `deviationContext` 构造 `qualityContext`（`chapterId` / `chapterOutline` / `characterInfos`）传给 `monitor.evaluate`：质量与偏离同源，且上下文只构建一次（人物档案/前文缓存不会被重复读盘）。
- 单测：新增 `quality-score-engine-v1-context.test.ts` 1 文件 4 例（传 `characterNames` 后不再走正则估算 / 只给 `characterInfos` 也能注入名单 / 名单变化不复用旧缓存 / 上下文缺席不清空构造配置）；`co-writer-quality-monitor-pending.test.ts` +1（`qualityContext` 内容与偏离上下文同源，`buildDeviationContext` 只调用一次）。先红（4 例失败：仍走估算、`uniqueCharacters` 未知、`qualityContext` 为 undefined）后绿。
- 全量 **276 文件 / 3875 用例**通过（新增 1 文件 4 例 + 1 例接线）。

**153. 正文写入按路径串行 + 切章身份快照；书籍存活判定改用 bookId（`engine/body-writer.ts` / `ui/co-writing-view.ts` / `engine/knowledge-vector-store.ts` / `services/knowledge-base-manager.ts`）**
- 现状：
  - `BodyWriter.write` 是「读旧 frontmatter → 整篇覆盖」，但未加文件锁；协同自动保存、流水线、润色编辑器、修正回写可同时写同一章，后写覆盖前写，两次读到的旧 frontmatter 还会互相覆盖。
  - `saveBody` 在 `await getChapterTitle()` 之后才读 `this.getBodyPath()` / `this.chapterNum`；切章会先改这些字段，导致旧章正文用新章路径落盘。
  - `openChapter` 切章前不取消已排队的 2s 自动保存，`checkPrerequisites` 的 await 窗口内旧保存会写入新章。
  - 向量文件按 `bookId` 存盘，却用 `bookName` 拼目录做存活校验；`updateBook` 改名只 `rename` 目录、不重写向量文件与向量索引里的 `bookName` → 重启后整本书向量被判孤儿，检索永久为空。
- 修复：
  - `BodyWriter.write` 对 `req.path` 包 `withWriteLock`，实际写入移入 `writeLocked`；同一章的所有写入者自动互斥。
  - `saveBody` 入口做身份快照（`project/volume/chapterNum/chapterName/bodyPath`），后续 `getChapterTitle(identity)`、`writer.write`、结算提醒全部只用快照；写盘期间已切章则丢弃「已保存」UI 更新。返回 `Promise<boolean>` 让切章路径能判断是否成功。
  - `getStepFilePath` / `getChapterTitle` 支持传入身份快照，取标题不再读当前章。
  - 新增 `flushPendingBodySaveBeforeChapterSwitch()`：`openChapter` 首行先取消防抖、按旧身份冲刷排队保存；失败则提示并中止切章。
  - `KnowledgeVectorStore` 新增 `options.isBookAlive(bookId)`；`loadIndex` 优先按 bookId 判存活，`undefined` 时回退旧的 bookName 目录校验。`engine-registry` 与 `co-writer-engine` 分别注入 `knowledgeBaseManager.hasBook`。
  - `KnowledgeBaseManager` 新增 `hasBook(bookId)` 与 `renameVectorArtifacts`：改名后同步向量文件与向量索引中的 `bookName`（文件缺失/损坏静默跳过，重建索引可自愈）。
- 单测：新增 `body-writer-concurrent-write.test.ts`（并发写入 maxInFlight=1）、`co-writer-save-identity.test.ts` 1 文件 5 例（await 期间切章仍写旧路径 / 正常保存返回 true / 有排队保存才冲刷 / 无排队不写盘 / 未绑定章节不写盘）、`knowledge-vector-store-book-alive.test.ts` 1 文件 3 例（bookId 存活即加载 / 已删除跳过 / 无判定函数回退旧行为）、`knowledge-base-rename-vectors.test.ts` 1 文件 2 例（改名同步向量文件与索引 / 文件缺失不抛错）。先红（4 文件 8 例失败：maxInFlight=2、bookId 存活仍被跳过、bookName 未更新、切章 helper 不存在）后绿。
- 全量 **280 文件 / 3886 用例**通过（新增 4 文件 11 例）。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 **280 文件 / 3886 用例**通过（第 69 条删除死模块 1 文件 17 例；净基线 3370 → 3886。新增 `ai-credentials.test.ts` 6 例、同人拼接 3 例、同人保存 2 例、知识位置 5 例、指纹强度 8 例、静态刷新保留 1 例、同人热更新 3 例、评估身份 4 例、指纹检索归属 3 例、选择器无 fpId 1 例、向量跨实例刷新 3 例、指纹列表刷新 4 例、知识向量跨实例刷新 4 例、设定注入维度 2 例、原文相邻去重 5 例、技巧维度隔离 1 例、前文预算自适应 7 例、实时评估在途重评 4 例、注入参与预算裁剪 3 例、项目风格参与预算裁剪 4 例、技巧参考维度隔离 2 例、原文片段相邻去重 1 例、监控外部监听清理 2 例、遗留向量剪枝 2 例、原文与报告样本并集 1 例、文风注入配额 3 例、实时质量落盘守卫 4 例、指纹强度禁用样本 2 例、模型能力预算 4 例、正文生成指纹来源 5 例、模板层来源库判定 2 例、章级趋势 8 例、切章顶栏清理 3 例、面板 B 空结果守卫 6 例、协同门槛对齐 1 例、面板 B 项目归属 4 例、切章冲刷项目归属 2 例、面板关闭冲刷 1 例、完成度/偏离空结果守卫 8 例、面板 B 提示接线 3 例、质量历史按章收敛 1 例、面板关闭冲刷归属项目 1 例、设定守卫增量节流 6 例、协同预览滚动锚点 8 例、自动联想最小间隔 6 例、同人设定加载失败提示 10 例、光标位置归一化 10 例、同人设定绑定候选 10 例、前置规划缺口判定 10 例、监控面板 A 并发分析 4 例）。
- 新增用例：性能监控 11 例、质量基线 11 例、偏离规则 9 例、本地模型探测 11 例、删书清向量 3 例、知识注入预算 4 例、场景正文合并 3 例、规划失效 6 例、长篇记忆 9 例、质量校准 6 例、同人链路 1 例、同人约束注入 5 例、截断可见性 2 例、伏笔上下文映射 6 例、实体状态跟随协同模型 5 例、剧情完成度评估门槛 8 例、内存基线按章收敛 3 例、情绪曲线本地优先 5 例、偏离上升时间窗 7 例、协同预览滚动锚点 8 例、自动联想最小间隔 6 例、同人设定加载失败提示 10 例、光标位置归一化 10 例、同人设定绑定候选 10 例、前置规划缺口判定 10 例、监控面板 A 并发分析 4 例、设定守卫切章代次 5 例、牵引面板切章代次 5 例、同人绑定 `.project` 写入 4 例、剧情完成度切章代次 5 例、预览渲染切章代次 4 例、自动联想开关 5 例、旧指纹字段清理 3 例、情绪曲线本地化用例改写 5 例（净持平）、主角名回退不依赖工作台状态 3 例、预览节流尾随渲染 4 例、预期节奏解析 7 例、偏离上下文节奏接线 3 例、知识库向量模型治理 5 例、指纹 V1 向量模型治理 5 例、协同 embedding 跟随向量设置 5 例、UI 指纹 embedding 统一构造 5 例、批量重向量化编排 6 例、伏笔计划回收分层 11 例、检索相关性过滤 7 例、偏离总分聚合 2 例、偏离未评估类型 3 例、基线总分 0 占位 2 例、外貌矛盾同段共现 3 例、同人规则回填 4 例、前文窗口跨卷 14 例、前文矛盾去重 3 例、同人规则多行解析 3 例、偏离类型计数 4 例、外貌矛盾跨组去重 1 例、角色一致性分段口径 3 例、性格关键词回退 2 例、协同实时监控引擎接线 2 例、V1 OOC 严重度下限 3 例、实时质量失败状态展示 1 文件 3 例、监控全部失败原因返回 1 例、面板 B 评估异常展示 1 文件 3 例、面板 B 完成度异常展示 1 例、情绪断层分段口径 4 例、V1 OOC 证据保留 1 例、同人主要人物解析与注入 6 例、同人势力组织解析与注入 4 例、指纹 V2 相关性筛选 4 例、同人时间线表格解析与注入 5 例、前文缓存按文件签名失效 1 文件 3 例、同人核心字段占位过滤 3 例、同人占位校验 4 例、同人上下文路径 3 例、指纹排名范围 1 例、同人失效复查 1 文件 8 例、同人空内容提示 4 例、流式知识条数 1 文件 2 例、实体生成同人提示 1 文件 4 例、同人时间线面板与 prompt 同源 1 文件 6 例、同人时间线注入窗口 1 文件 6 例、同人读取入口守卫 1 文件 1 例、同人人物相关度选取 1 文件 6 例 + 引擎接线 2 例、实时质量上下文注入 1 文件 4 例 + 协同接线 1 例、正文并发写 1 例、保存身份与切章冲刷 1 文件 5 例、bookId 存活判定 1 文件 3 例、改名同步向量书名 1 文件 2 例。
- 尚未运行时复测：真实项目连续写作 30 分钟的性能日志增长、基线行在切换项目后的显示、开启实时质量后的偏离 title 内容、真实 Ollama `/api/show` 探测与首次调用的窗口生效、删书/移走书目录后协同检索日志出现「跳过 N 个知识库中已不存在的书籍向量」且默认样例不再命中旧书、重新拆解一本书后向量文件同时含原文分块与 6 个报告维度且「风格/节奏/技巧/原文片段」四段都非空、文风注入段能同时看到风格分析样本与原文片段（配额 1~2 条风格 + 其余原文）、协同视图「人物 OOC」「设定矛盾」「伏笔遗忘」三类偏离是否随真实档案出现（前两类补齐 `characterInfos`、第三类接入伏笔追踪后首次可生效）、跨书切到同章号时不再串用上一章正文、本地 8K 窗口下联想/改写/迭代的实际请求体是否按预期丢弃知识库且保留任务片段、质量历史里同一章是否只出现一个章键、实时质量出现部分失败时日志是否输出「本次实时评估无 WQE 结果，跳过质量历史落盘」且 `质量历史.json` 不新增记录、把某指纹强度拉到 0 后协同 prompt 的「参考片段」里不再出现该指纹原文（仅剩其他指纹样本与特征描述）、把 11 步流水线的当步模型切到本地 8K 窗口模型后执行不再报「输入过长…请减少上下文」且日志出现「上下文不足，已跳过知识注入」或「保留头部+尾部」、启用一个项目指纹后第 7 步正文生成的「风格要求」段出现「【写作指纹风格参考】」且 AI 润色提示词出现「写作指纹风格参考」，把该指纹禁用后两处都不再出现、模板层指纹在三个入口（指纹库视图、设置页、mini 设置）都不再出现「启用/禁用」与「强度调节」，列表改为显示「来源库 · 复制到项目后生效」，工具栏「启用/禁用」对模板给出提示且不写盘、面板 B 的摘要箭头与「最近历史」在跨章后给出方向（同章内反复编辑不再让箭头翻转，前序不足两章时显示平稳）、面板 B 在正文 <100 字时显示「综合质量 --」与「暂不评估」而不是 0 分 / 低于基线，且展开详情后连续编辑（每次 2.5s 评估）详情内容不会消失、协同写作首次打开（面板 B 无 activeFile）时质量历史能恢复且基线行出现，切换书籍后基线不混入上一本书的样本，且 A 书最后一条质量记录写回 A 书的 `质量历史.json`、不出现在 B 书中、面板 B 在空章/短正文时完成度与偏离都显示「--」与「暂不评估/暂不检测」而不是 0 分 / 0%，展开详情不出现六维/五维全 0，切到空章后完成度/偏离趋势图不再被 0 记录打断、面板 B 在偏离度 >60% 或连续上升时实际弹出 Notice（而非只写日志），正文跨过 500/1000/2000 字时弹出里程碑，质量分 <50 且正文 >500 字时 10 分钟内最多提示一次、面板 B 不再出现永远不变化的「风格自学习 / 偏好记忆」卡片，标题为「结局/完成度/偏离/质量/结算」、面板 B 不再出现「🏁 结局牵引」卡（标题为「监控面板B · 完成度/偏离/质量/结算」），协同写作主视图的「🎯 情节牵引」仍能读出牵引线程，且打开协同写作时日志里不再出现第二次 `EndingTractionEngine` 初始化、在同一章连续写作超过 2 小时后 `质量历史.json` 里该章只有一条记录、前面章节的样本仍在，面板 B 的「高于/低于基线」行与章级趋势不会因单章高频落盘而消失、在 A 书写作后切到 B 书文件再关闭面板 B，A 书最后一条记录仍写回 A 书的 `质量历史.json`、连续打字停顿时不再每次都发起实体状态检测（正文新增 <300 字且未过 5 分钟时跳过），手动「🛡 检查」、插入建议与保存仍每次都检测、协同写作切到本地 Ollama 后触发实体状态检测（守卫检查 / 手动检查）时，日志里的模型为本地模型、请求发往本地 endpoint，断网状态下仍能完成检测，且不再出现云端 flash 调用记录、连续打字期间剧情完成度不再每 10 秒请求一次 AI（正文未变或新增 <300 字且未过 2 分钟时沿用上次结果），手动重试与生成完成后的刷新仍立即执行、在同一章连续写作 2 小时后（期间上千次打字停顿）面板 B 的「高于/低于基线」行仍然存在，前面章节的样本未被当前章挤出内存基线、协同写作连续打字时「情绪曲线」面板即时更新且网络面板/日志中没有新增按段落的 AI 请求、短时间内连续三次编辑（偏离度数值上升）不再弹出「持续上升」预警，等到 2 分钟窗口后仍有上升才提示一次、在协同写作预览区向下滚动查看前文后继续打字，预览不会被拉回顶部，原本停在底部时继续跟随最新正文、慢速打字（每 2 秒一个字）时自动联想不再每次停顿都发请求（两次至少间隔 4 秒），首次输入与切章后仍立即触发、同人项目的设定文件被删除或 `.project` 未写路径时，打开协同写作会弹出一次「同人设定未加载」提示（同一项目不重复），恢复设定后不再提示、把光标放到正文最开头后点击「插入建议」或快捷键插入技巧片段，内容插在开头而不是文末，且光标停在开头时不再触发自动联想、同人项目里已存在设定文件时，向导「原作设定导入」步骤出现绑定下拉，绑定后 `.project` 指向该文件、表单回填其内容，重新进入向导仍能恢复，协同 prompt 也带上原作约束、规划未完成的章节打开协同写作时，警告横幅出现在编辑器正上方（不是视口外的布局下方），补齐规划后重开不再出现、连续快速输入（两次评估间隔小于分析耗时）时，面板 A 的情绪曲线与节奏始终对应最新正文，不会闪现上一版结果、上一章设定检查仍在进行时切到新章，旧章的 OOC/实体变更不会出现在新章警告区与面板 A，新章比上一章更短时输入停顿仍会触发检查，自动检查在途时点「🛡 检查」会提示「设定检查正在进行」、从旧章切到新章后「🎯 情节牵引」立即显示新章的整体进度与偏离风险（不再出现旧章数字），旧章在途结果晚到也不会覆盖、从命令面板或全本工作台打开「添加同人设定」且项目里已有设定文件时，弹窗出现「🔗 使用已有设定文件」下拉，绑定后 `.project` 指向该文件、协同 prompt 立即带上原作约束（无需重新进入向导），字段不完整时给出缺失提示、旧章完成度评估仍在进行时切到新章，新章不出现旧章完成度数字、顶部不停在「评估中」，旧请求失败也不会把新章标成「评估失败」、连续快速输入（预览渲染尚未结束时又触发一次）时预览只显示最新正文、不出现新旧段落混排，切换章节后旧章在途渲染不会写回新章预览、关闭「自动联想（幽灵建议）」后连续输入不再出现「Tab 接受联想」提示且日志/网络面板没有新的联想请求，重新开启后停顿 1.5 秒恢复联想（设置页与 mini 设置两处都生效）、打开一份旧版含 `fingerprint.enabledProject/enabledGlobal` 的画像文件后协同写作正常加载、指纹注入仍按指纹库启用状态生效，保存画像后文件里不再出现这两个键、断网或未配置 API Key 时协同写作的情绪曲线与节奏面板仍能正常显示（不再依赖任何 AI 分支），设置页中也不再出现「详细分析」相关项、从命令面板或 Ribbon 直接打开协同写作时仍按当前打开的正文文件自动绑定章节（未打开正文时显示空态提示，不再尝试读取已删除的工作台状态）、协同写作与场景兜底提示词中的主角名只来自人物档案「身份」字段，缺失时回落「主角」而不是空白、快速打字后立即停手时预览最终显示停手时的完整正文（不再落后一段直到下次输入才补上），切章后上一章排队的尾随渲染不会出现在新章预览里、在大纲摘要或细纲里写「节奏：快」后正文明显拖沓时，面板 B 偏离详情出现「节奏偏差：预期快，实际…」；不写任何节奏标注时，不出现节奏类偏离（不再恒空也不再误报）、切换 embedding 模型（或改模型名）后重新打开协同写作，日志出现「跳过 N 个 embedding 模型不一致的书籍向量」，旧书正文不再被检索命中、向量文件仍在磁盘，对其中一本重新拆解后该书恢复检索且再次启动时跳过清单里不再包含它、换 embedding 模型后第 7 步正文生成的「风格要求」段不再整段消失为空（日志出现「跳过 N 个 embedding 模型不一致的指纹向量」），重新提取一次指纹后该段恢复且不再出现跳过日志、把向量提供商切到通义/豆包/OpenAI 后打开协同写作，知识库与指纹检索的请求发往对应云端端点（不再出现 `localhost:11434` 的 embedding 请求），切回 Ollama 后恢复本地请求、把向量提供商切到通义/豆包/OpenAI 后，从设置页 / mini 设置 / 小说分析 / 知识详情四个入口新增或重提指纹时，向量请求同样发往当前提供商（不再出现 `localhost:11434`），且知识详情「重新拆解」与指纹提取使用同一模型、切换 embedding 模型后点击知识库工具栏「🧠 重向量化」，知识库与指纹的 embedding 请求全部发往新提供商，完成后汇总行显示成功/跳过/失败数量，重新打开协同写作时日志不再出现「跳过 N 个 embedding 模型不一致」且知识/指纹注入恢复、在伏笔库把某条伏笔的「回收章节」写成第 12 章后，写到第 10–11 章时面板 B 偏离详情出现「计划第 12 章回收，仅剩 N 章」warning，写到第 13 章后变为「已逾期」critical；把计划改成第 60 章后，第 20 章不再因超过全局 10 章阈值而误报；主线关键词完全未覆盖时，面板 B 与实时顶栏显示「偏离 100 · 严重」，而不是被加权稀释成「偏离 25 · 提示」；新建项目尚未生成人物档案、也没有伏笔/节奏标注时，协同顶栏显示「… · 4类未评估」，悬停可看到具体类型且注明「不代表无问题」；旧版质量历史里含 `overallScore=0` 的记录时，基线样本数与均值不含这些 0（不再把当前章恒判为高于基线）；正文用单换行分段、且配角在同一章被写成「金发/白发」时，主角不再被误报外貌矛盾（只有同段落共现才报）；在向导「同人设定」步骤绑定已有文件或用 AI 生成后再次进入，三条创作规则仍回填在 textarea 里，直接点保存不会清空、在跨卷项目里打开第 3 卷第 1 章（章号约 291，前文在第 2 卷）时，实时监控能读到第 288–290 章前文，偏离 title 的「设定矛盾」可引用跨卷前文证据；打开第 1–3 章时前文为空也不报错，切章后不会串用上一章的前文缓存、同一人物的同一外貌矛盾连续出现在第 N-1 至 N-3 章时，协同顶栏的严重问题数只增加 1，偏离 title 指向最近那章的证据而不是重复三条、把同人设定的某条规则写成两行（第一行在 `- **规则**：` 后，第二行以 `- ` 开头）后，协同 prompt 的「【创作规则】」仍包含第二行；把规则只写在 frontmatter、正文不写条目时，prompt 也能读到该规则、多类型同时偏离时协同顶栏显示「· N类异常」且悬停 title 列出具体类型，总分等于最严重单条（不再被加权平均稀释），只有未评估类型时不显示异常数、人物设定同时写了两种发色时，正文出现第三种发色只报 1 条外貌矛盾（不再出现 id 相同的重复项）、正文用单换行分段且配角被写成「金发」时，面板 B 的人物一致性维度与偏离顶栏都不再把主角标成外貌矛盾（V1 checker 与 DeviationDetector 同口径）、人物档案性格写「冷静」而不是「沉稳」时，段落里的「惊慌失措」仍会被判为行为不符（不再整类静默）；协同实时监控与 worker/分析路径对同一段正文给出相同的人物 OOC 结论（实时监控不再走简化回退）、真人项目里出现外貌矛盾（V1 severity=high）时，协同顶栏显示「偏离 ≥60 · 严重」而不是「偏离 15 · 严重」，且面板 B 偏离详情里该条 issue 的数值与「严重」标签一致、偏离检测失败（例如人物档案读取异常）时，协同顶栏出现「偏离检测失败」而不是只显示质量分、hover 可看到失败原因；质量与偏离同时失败时顶栏显示「质量评估失败（质量评分失败、偏离检测失败）」，不再与「正文过短、暂不评估」的「质量 --」同形、面板 B 在偏离/质量引擎抛错时卡片显示「整体偏离度 --」/「综合质量 --」与「本次评估失败」，不再继续显示上一次的分数（展开时详情同样显示「暂无偏离/质量详情」）、面板 B 完成度引擎抛错时显示「综合完成度 --」+「本次评估失败」，不再显示上一章的完成度、正文用单换行分段时情绪断层仍能检出（连续 4 段无心理/情绪/身体反应时提示），不再是整类静默、同人项目的设定文件在「## 主要人物」填了 2 个原作角色后，协同续写/改写/迭代/联想的 prompt 都出现「【原作主要人物】」且只列前 6 人，AI 生成的设定文件带该节、未填时 prompt 不出现「（待补充）」角色、同人设定「## 势力组织」填 1 个势力后四个协同入口的 prompt 出现「【原作势力组织】」且与人物段分开列出、启用 5 个风格指纹时协同四个入口的 prompt 只出现与当前正文最相似的 3 个（日志无「指纹相关性筛选失败」），关掉 embedding 提供商后仍出现全部 5 个（降级为全量而非丢失风格约束）、同人设定「## 原作剧情时间线」填 1 行非占位内容后，协同四个入口的 prompt 出现「【原作剧情时间线】」且只含该行（无表头与 `---`），AI 生成的骨架（只有「待补充」行）不产生该段、在协同会话里改掉上一章的发色/时间点后回到本章继续输入，偏离检测立即按新正文比对（不必切章或重开视图），前文文件被移走后不再复用旧内容、同人设定只填了「（待补充）」占位时协同 prompt 不出现「【同人创作约束】」块与任何「待补充」字样，打开向导仍能看到原文占位并补全、AI 生成同人设定时若只回显骨架（字段全「（待补充）」或时间线只有占位行）会提示「内容不完整…未保存」而不落盘，绑定这类文件时提示「⚠️ 已绑定，但缺少…」；在向导里填满 9 个字段保存后重启插件，「同人设定」步骤仍为已完成（不被骨架占位行判成未完成）、同人项目打开上下文面板时，「📜 原作剧情时间线」「📖 故事背景时间线」「⚠️ OOC 防护规则」三张卡按 `.project` 指向的设定文件正常出现（骨架占位行/占位规则不出现），改动设定文件后重新打开面板内容随之更新、同时启用 5 个项目指纹并禁用/保留若干模板指纹时，位置生成的「【写作指纹风格参考】」只出现与当前正文最相似的 3 个启用指纹（不会因禁用指纹占满 topN 而回退成全量 5 个）、同人项目打开协同写作后把设定文件移走，下一次生成（Tab 建议 / Ctrl+K 联想 / 自动联想）弹出一次「同人设定文件不存在」提示，把文件放回后不再提示、再移走会重新提示一次（同一文案不因去重键残留而静默）、同人项目绑定的设定文件只有「（待补充）」骨架（或刚生成未填写）时，打开协同写作/下一次生成弹出「同人设定里没有可用内容」提示；把核心设定或任一人物填上真实内容后重新打开，提示不再出现，prompt 中出现「【同人创作约束】」块、在同一个协同会话里先用「Tab 建议」生成一次（提示「已注入 N 条」），再用「流式续写」生成：流式完成后提示条数与本次知识库检索结果一致（聊天记录里上一次的数字不再残留），把参考书解绑后流式生成不再提示「已注入」、同人项目未绑定设定或只有骨架占位时，从「AI 建卡」「生成人物/势力/地点/物品」「统一实体」任一入口点击生成都会先弹出同人设定失效提示；把设定补全后再次生成不再提示，prompt 中出现「【同人创作约束】」块、同人设定时间线某行留空「涉及人物」后打开上下文面板，该行的「章节参考」「你的同人如何切入」仍显示在各自列下（不再整体左移），协同 prompt 的「【原作剧情时间线】」行内容与面板同一行对应；把一条创作规则写成续行后，上下文面板的「OOC 防护规则」按条显示完整内容、同人设定同人时间线超过 8 行时，协同 prompt 的「【同人时间线】」出现最新一行（不是最前面 8 行）并带「共 N 行，以上为最近 8 行」；在最新一行填「对应原作时间」后，「【原作剧情时间线】」窗口切到该 canon 事件附近（带「第 X–Y 行」说明），填一个 canon 里不存在的值时回退前 8 行、同人项目未绑定设定或只有骨架占位时，从全文工作台走模板生成会先弹出同人设定失效提示（不再静默用空模板变量）；补全设定后再次生成不再提示、同人设定「## 主要人物」填 8 个角色时，在本章正文提到第 8 个角色后生成建议，prompt 的「【原作主要人物】」出现该角色（不是前 6 个）且带「共 8 人」说明；只写大纲提到该角色时同样生效，空白章回退前 6 个。
- 本轮新增运行时复测：在已有人物档案的项目里打开协同写作并输入一段包含主角名的正文，实时顶栏的质量分不再因「人物维度按正则估算」被压低；随后在人物管理里新增一个正文中出现的角色（60 秒缓存过期后）继续输入同样的正文，质量分随之变化而不是沿用旧分。
- Phase 1（A3/A1）运行时复测：
  - A1 已用 obsidian-cli 实测：插件数据目录 `.obsidian/plugins/novel-writer-ai/data/knowledge-vectors` 在修复前 `fs.exists=false / fs.listFiles=0`、修复后 `true / 9`；探针书 + 探针向量端到端得到 `books=1 / hasBook=true / loaded=1`，改名后 `loaded=1` 且向量 `bookName` 同步（详见第 154 条）。
  - A3 的真实切章复测仍待用户操作协同写作视图（代码与单测已覆盖；需在同一章快速输入后 2 秒内切章，确认上一章完整、新章不被写入旧正文）。

**154. `ObsidianFileSystem` 对插件数据目录（`.obsidian`）完全不可见，导致 A1 改名同步在真实环境失效（`shared/file-system-port.ts`）**
- 现状：`ObsidianFileSystem` 的 `exists / read / write / listFiles / mkdir / delete` 全部基于 `vault.getAbstractFileByPath` / `vault.getFiles`，而插件数据目录 `.obsidian/plugins/novel-writer-ai/data` 不在 vault 索引里。运行时实测：`vault.getAbstractFileByPath(向量文件)` 返回 `null`、`adapter.exists` 返回 `true`；`fs.exists(知识库索引)` = false、`fs.listFiles(向量目录)` = 0，而 adapter 列出 9 个文件。后果：知识向量加载恒为 0；`renameVectorArtifacts` 的 `exists` 门禁恒 false，A1 的改名同步在真实环境完全跳过（单测用 FakeFileSystem 所以是绿的）。
- 修复：索引未命中时回退 `vault.adapter`。
  - `read`：TFile 走 `vault.read`，否则 `adapter.read`，都不存在才抛 `File not found`。
  - `write`：TFile 走 `vault.modify`；配置目录或索引外已存在文件走 `adapter.write`；vault 内新文件仍走 `vault.create`（保留索引与事件语义）。
  - `exists`：`getAbstractFileByPath !== null || adapter.exists`。
  - `listFiles / listFolders`：索引外目录用 `adapter.list` 递归，构造只含 `path/name/basename/extension/stat` 的虚拟 `TFile` / `TFolder`（调用方只读这些字段）。
  - `mkdir`：配置目录前缀用 `adapter.mkdir`，其余保持 `vault.createFolder`。
  - `delete`：索引外路径按 `adapter.stat().type` 走 `adapter.remove` / `adapter.rmdir`。
- 单测：新增 `obsidian-fs-adapter-fallback.test.ts` 7 例（exists / read / 配置目录 write / vault 内新文件仍走 create / listFiles 递归与 stat / mkdir / delete），先红 6 例后绿。
- 运行时（obsidian-cli `plugin:reload` + `eval`）：`fsExists` false→true；`fsCount` 0→9；探针向量改名后 `bookName` 与 `samples[0].bookName` 均为新名；临时书端到端 `books=1 / has=true / loaded=1 / 改名后 loaded=1`；清理后索引恢复为 `{"books":[]}`、探针文件 0、`dev:errors` 无错误。
- 全量 **281 文件 / 3893 用例**通过（新增 1 文件 7 例）。

**155. 同书拆解并发治理：向量写入串行 + 任务去重 + 删书写入守卫（`engine/knowledge-vector-store.ts` / `services/deconstruction-scheduler.ts` / 知识库三处删除入口）**
- 现状：
  - `addBookSamples / replaceBookSamples` 是「读现有 → 逐条 `await embed`（长耗时）→ `set` → 整文件覆盖」，无锁；同一本书连点拆解、重拆与批量重向量化重叠时，后完成者整体覆盖先完成者，`add` 与 `replace` 交叉还会产生重复样本，embedding 重复计费。
  - 不同书并发写也可能被对方的 `reloadIfChanged → loadIndex` 清空内存样本。
  - `addTask` 只校验书存在，不查同书在途任务；`deleteBook` 不取消在途拆解，任务结束后会把已删除的书目录 / 日志 / 向量重新写回来。
- 修复：
  - `KnowledgeVectorStore` 增加 `STATE_LOCK`：`reloadIfChanged`（经 `ensureLoaded`）与 `addBookSamples / replaceBookSamples / updateBookSamples / removeBook / clear` 共用同一把 `withWriteLock` 串行队列；写操作在锁内完成「加载 → embed → set → saveBook → saveIndex」。选全局锁而非 per-book：`loadIndex` 会 `samples.clear()`，书级并行与跨实例 reload 无法共存。
  - `DeconstructionScheduler.addTask`：同书已有 `pending / running / paused` 任务时直接返回该 taskId，不新建任务。
  - 新增 `cancelByBook(bookId)`：取消该书全部在途任务；知识库视图、设置页、知识详情弹窗三处删除入口在 `deleteBook` 前调用。
  - `vectorizeBook`、`saveSegmentedDimensionResult`、`appendBreakdownLog` 写盘前二次校验 `getBook(bookId)`：书已删除则跳过，避免重建已删除的书目录与向量文件。
- 单测：
  - `knowledge-vector-store-concurrent-write.test.ts` 4 例（并发 add 累加不丢 / 磁盘与内存一致 / 并发 replace 最后一次生效且 id 唯一 / 不同书互不覆盖）。
  - `deconstruction-scheduler-a2.test.ts` 4 例（同书 addTask 去重 / 不同书各自建任务 / `cancelByBook` 只取消目标书 / 书已删除时不写向量）。
  - 先红 5 例（add 只剩 2 条、replace 被覆盖、去重未生效、`cancelByBook` 不存在、删书仍写向量）后绿。
- 全量 **283 文件 / 3901 用例**通过（新增 2 文件 8 例）。
- 运行时：本轮未重载 Obsidian（当前打开了全本工作台视图，避免中断），`cancelByBook` 与锁逻辑由单测覆盖；下次重载插件后生效。

**156. 步骤完成度统一判定 + 批量取消语义 + 失效传播补齐（A4 / A6 / A7）**
- 现状：
  - A4：`StepResultSaver` 对非正文步骤无条件写 `step_status=generated`；`restoreChapterState` 又把 `generated` 直接判为 `complete`；`batch-pipeline-runner` 以「文件非空」判完成，模板骨架整步跳过；工作台手动保存传 `forceComplete=true`。四处叠加后，空模板/半成品都能变成「已完成」。
  - A6：批量建章是逐章 `for` 循环，全文件无 `AbortController`；`onClose` 只清空 DOM，关闭弹窗后 AI 仍在跑并继续写盘。`StepRunner` 在 abort 时只返回 `finishReason='aborted'`（无 `error`），调用方只判 `result.error`，半章被当成功保存。
  - A7：场景细纲自动保存、润色编辑器自动保存、消痕/精修/逐轮选择三处改写正文后，只删 `stepCompleted` 或完全不做失效，`stepLevels` 仍为 `complete`、`staleSteps` 不出现，导航继续显示已完成。
- 修复：
  - A4：新增 `isStepResultComplete(stepKey, content)`（`engine/step-validator.ts`）＝「非模板骨架 + 结构校验通过」；`StepResultSaver` 落盘前按 `validateStepResult` 写 `generated` / `partial`；`restoreChapterState` 只信任 `reviewed`，`generated` 重新走结构校验；`batch-pipeline-runner` 的 `stepCompleted` 与 `runStepOnce` 都改用该判定；工作台手动保存（含 fix/finalFix、sceneExpand）删除 `forceComplete`，保存后展示缺失项。删除 `ChapterStateManager` 中未使用的 `detectTemplateSkeleton*`，骨架判定收敛到 `step-validator`。
  - A6：`BatchChaptersModal` 持有 `AbortController`，`onClose` 置 `cancelled` 并 `abort()`；主循环每章、续写/修正循环、写正文前、各 `callAI` 调用均接入 `signal`；结束提示区分「已完成 N/M 章」与「已取消，后续章节未执行」。`StepRunner.executeCurrentStep` 在 `finishReason==='aborted'` 或 signal 已取消时直接返回，不落盘、不标记完成；`callAIStreamWithRetry` 取消时返回 `finishReason='aborted'`；`BatchPipelineRunner.runStepOnce` 在 `executeCurrentStep` 返回后再检查一次 signal。
  - A7：新增 `BODY_CHANGE_INVALIDATED_STEPS`（`engine/step-definitions.ts`）作为正文变更失效唯一口径；场景自动保存回调在落盘后同步 `stepResults/stepLevels` 并失效下游；`PolishEditor.render` 新增保存成功回调，`full-writer-view` 注入 `invalidateSteps`；`StepModalController` 的消痕、精修、逐轮选择三处改用 `invalidateAfterBodyChange`，经 `StepRunnerCallbacks.invalidateSteps` 注入工作台状态。
- 单测：新增 `step-completion-a4.test.ts` 5 例（骨架→partial / 完整→generated / 旧 generated 恢复不算完成 / 手动保存不推进 / 续跑判定）、`batch-cancel-a6.test.ts` 2 例（已取消不启动任何章节 / 中途取消不再开始下一章）、`invalidate-propagation-a7.test.ts` 2 例（失效列表覆盖审查·分析·结算 / 三集合同步）。
- 全量 **286 文件 / 3910 用例**通过（新增 3 文件 9 例）。
- 运行时：`obsidian plugin:reload id=novel-writer-ai` 成功，`obsidian dev:errors` 无错误；取消交互与自动保存失效需在真实写作中复测（代码路径已由单测覆盖）。

**157. embedding 指纹治理 + 检索过滤/注入预算统一（B1 / B2 / B3 / B4 / B5 / B6）**
- 现状：
  - B1/B2：向量文件只记纯模型名，同名模型换端点（Ollama 换端口、云端换代理）无法识别；缓存签名只看 `path@mtime:size`，同会话切换模型后内存仍是旧向量。
  - B3：style/rhythm/technique 合并成一次检索后共用全局最高分过滤，0.45 的 rhythm 被 0.6 的 style × 0.85 整段丢弃；情绪方向下节奏结果按分块 `position` 排序。
  - B4：注入上限 3 只在协同生效，11 步正文把全部启用指纹合并进 system；合并特征无字数上限。
  - B5：V2 向量被隔离后「重向量化」只重建 V1，相关性排序永久回退全量且无提示。
  - B6：`buildSystemPrompt` 直接 `systemPrompt += knowledge`；`injectForSceneBody` 把必须层拼回 user；`sceneExpand` 分支在预算闸门前直接 return；大纲扩写完全不过闸门。
- 修复：
  - B1：新增 `engine/embedding/embedding-fingerprint.ts`，指纹＝`providerType:model@shortHash(baseUrl)`；知识库 / 指纹 V1 / 指纹 V2 统一按「指纹 + 维度」双校验，旧文件纯模型名按模型名兼容；落盘写 `dimensionCount`；V1 风格向量补齐 `getModelMismatches()`。`KnowledgeVectorStore.rebuildIndex` 与 `loadIndex` 共用同一套判定。
  - B2：四个向量存储的缓存签名统一改为 `embedding 指纹 :: 文件签名`；V2 在加载后按磁盘实际状态重算签名（隔离会删文件），自身写入后同步签名，避免下一次 `ensureLoaded` 无谓重载并替换内存对象。
  - B3：`shared/retrieval-filter.ts` 新增 `filterRetrievalResultsByScope(results, 'perDimension')`；`KnowledgeVectorStore.search` 增加 `filterScope`（默认 `global` 保持兼容），协同合并检索传 `perDimension`；节奏参考统一按 `score` 降序，`position` 不再参与排序；注释固化「合并检索必须按维度过滤」。
  - B4：新增 `engine/style/fingerprint-selection.ts`（上限 3、可选 V2 检索、回退策略 `all` / `firstN` + 降级回调）；协同用 `all`（不丢风格约束），11 步用 `firstN`（守住预算）并上报 `vector/style` 降级；`mergeFingerprintFeatures` 每字段 200 字上限，单指纹直通同样截断。
  - B5：`vector-rebuild-action` 在 V1 重建后调用 `library.rebuildAllV2StyleVectors`，报告与 Notice 增加「V2 指纹 rebuilt/total（失败 N）」；指纹筛选回退全量时发一次降级事件（每实例一次，避免逐章刷屏）。
  - B6：`ai-prompt-builder` 删除 system 拼接，新增 `buildChapterPrompts`（知识＝user 可裁剪层 priority 25，正文主体为必保尾部）；`AIEngine` 两处生成改用该入口并按「设置值 vs 模型能力取小」计算窗口；`KnowledgeInjector` 新增 `injectForSceneBodyLayers`（必须层进 system），`injectForSceneBody` 保留字符串接口；场景正文生成优先使用分层注入；`scene-expander#generateSceneExpansion` 支持 `budget` 并把知识作为 `extraTail`；`OutlineToTextExpander` 三条链路统一走 `fitPromptToContext`，知识改为可丢弃增强层；顺手修正 `scene-expander` / `outline-to-text-expander` 的 `callAI(system, user)` 参数顺序。
- 单测：新增/更新 8 文件 —— `embedding` 治理 3 组（knowledge 8 例、V1 8 例、V2 7 例）、`vector-signature-b2` 3 例、`retrieval-filter-b3` 6 例、`fingerprint-selection-b4` 5 例、`style-v2-rebuild-b5` 2 例、`prompt-injection-guard` 3 例、`prompt-budget-b6` 6 例、`prompt-builder-fingerprint` +3 例。
- 全量 **292 文件 / 3949 用例**通过；typecheck / build 通过。
- 运行时：`obsidian plugin:reload id=novel-writer-ai` 成功，`obsidian dev:errors` 无错误。

**158. 「已注入 N 条」按预算裁剪后实际保留数记账（B7）**
- 现状：三方向候选、流式建议、选区改写、迭代四个入口都用「检索到的条数」写 `lastKnowledgeCount`；而 `knowledge` 段在 prompt 装配中可被整段丢弃或从尾部截断，界面仍提示「已注入 N 条」，提示与事实不符。
- 修复：
  - `shared/prompt-budget.ts` 新增 `countRetainedPromptParts`：按条目是否完整出现在最终 prompt 文本中计数（预算只从尾部截断，完整出现＝实际注入）。
  - `CoWriterEngine` 新增 `lastKnowledgeDroppedCount` 与私有 `recordKnowledgeInjection`，四个入口改为在 prompt 构建完成后记账，未注入数 > 0 时写日志。
  - `CoWriteFacade` 暴露 `lastKnowledgeDroppedCount`；`showKnowledgeInjectionNotice` 按「全部保留 / 部分丢弃 / 全部丢弃」给出三种文案。
  - `directionKnowledgeCounts` 仍保留检索总数：预算丢弃不能被误诊成「知识库未拆解」。
- 单测：新增 `tests/unit/engine/knowledge-count-b7.test.ts` 9 例（纯函数 3 / 引擎记账 3 / 文案 3）。
- 全量 **293 文件 / 3958 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**159. 向量化失败可见：状态、文案与重试入口（A5）**
- 现状：拆解主体结束时先写 `completed`；向量化在 try/catch 中失败只 `log.warn`；完成 Notice 无条件提示「拆解完成」。向量化是检索可用性的前提，失败后用户看到成功提示，写作时参考内容恒为空，也没有任何重试入口。
- 修复：
  - `BookBasicInfo` / `BreakdownTask` 新增 `vectorStatus`（`pending | done | failed`）与 `vectorError`；`KnowledgeBaseManager.setVectorStatus` 独立落盘，拆解状态仍为 `completed`（拆解确实完成）。
  - `DeconstructionScheduler` 新增纯函数 `buildBreakdownFinishNotice` 与 `recordVectorOutcome`：向量化成功/失败都写回任务与书籍；失败发 `vector` 降级事件（`vectorized → not_vectorized`）；完成 Notice 区分「拆解完成」与「拆解完成，但向量化失败（原因），可在知识库详情重试向量化」。
  - `revectorizeBook` 成功后写 `done`，失败写 `failed` 并继续抛错给调用方，批量重向量化也能看到真实结果。
  - `KnowledgeDetailModal` 概览新增「向量状态」行；失败时出现「🧠 重试向量化」按钮（复用 `revectorizeBook`，成功后重新拉取书籍信息并刷新详情）。
  - `knowledge-base-view` 卡片新增「⚠️ 向量化失败」徽标，`title` 展示失败原因。
  - 旧数据缺少 `vectorStatus` 时显示「— 未记录」，不误判为「未向量化」。
- 单测：新增 `tests/unit/services/deconstruction-vector-status-a5.test.ts` 7 例（提示文案 2 / 结果记账 2 / 重试入口 3）。
- 全量 **294 文件 / 3965 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**160. 质量评分双内核并存：明确唯一口径并移除无效注入（C1）**
- 现状：`QualityScoreEngine` 一旦注入 `v1Engine`，`evaluate` 的六维与总分全部取自 `WritingQualityEngine`，`rhythmAnalyzer` / `emotionAnalyzer` / `characterChecker` 与 `QSE_CALIBRATION` 的 fallback 校准在生产路径完全不可达；而 `quality-worker` 与 `heavy-task-worker-manager` 仍在注入 `characterChecker`，调用方会误以为「逐人物比对」已经在质量评分里生效。
- 修复（方案 A，不改评分行为）：
  - `QualityScoreEngine` 构造时若同时收到 `v1Engine` 与任一分析器，输出一次 `[QualityScoreEngine] 已注入 v1Engine（统一内核），… 不会生效` 的 warn，并把选项注释改成「注入 v1Engine 后为唯一口径，三分析器仅未注入时生效」。
  - `quality-worker` 的 QSE 构造只保留 `v1Engine`，删除 `qeMissing` 警告与 `INJECTION_PARTIAL` 上报（该上报把「本来就不生效」的注入当成降级）。
  - `heavy-task-worker-manager` 的 QSE 构造移除 `characterChecker`，删除随之失效的 `checkQualityEngineInjection()`；`checkDeviationDetectorInjection()` 保留，`DeviationDetector` 的 `PlotDivergenceEngine` + `CharacterConsistencyChecker` 注入不变。
  - 人物逐条比对的职责边界固化在 `DeviationDetector`：质量分的「人物一致性」是内核的启发式分，不是逐角色 OOC 结论。
- 单测：新增 `tests/unit/engine/quality/quality-score-engine-dual-kernel-c1.test.ts` 4 例（双内核打一次 warn 并点名 / 仅 V1 不 warn / 注入 checker 后结果与纯 V1 完全一致 / 源码守卫禁止两个生产入口再注入 `characterChecker`）。
- 全量 **295 文件 / 3969 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**161. 质量看板补上下文、总分改按章节综合分，语言质感改为派生口径（C2）**
- 现状：看板调用 `engine.evaluate(text)` 不传任何上下文——同一段正文在协同视图（传人物名单/大纲）与看板（不传）会得到不同的人物维度与总分；`mapV1Dimension` 把 `readability` 与 `languageTexture` 都映射到 `v1.languageQuality.score`，雷达图两轴同源；看板总分取六维均值，等于把语言质量加权两次；`qualityCache` 只按路径建键，同一弹窗内改稿后仍显示旧分。
- 修复：
  - `QualityDashboardModal` 评估时构造 `EvaluationContext`：人物名册经 `ctxManager.gatherCharacterState` → `toCharacterContextInfos`，按项目缓存 60s（`DEVIATION_CHARACTER_INFO_TTL_MS`）；本章大纲读步骤目录的「大纲摘要」（`pjStepDir` + `findChapterFile` + `stripFrontmatter`，上限 1200 字），缺失时为 `undefined`。
  - 雷达/总分分离：雷达仍展示六维聚合，总分改为各章 `overallScore`（WQE 加权口径）的均值，不再对六维再平均一次。
  - 看板缓存键改为 `path:mtime`（`qualityCacheKey`），刷新时改稿会重新评估；导出复用同一键。
  - `QualityScoreEngine#mapV1Dimension`：`languageTexture` 改由 `v1.languageQuality.details` 的 `vocabRichness`（词汇丰富度）与 `rhetoricCount`（修辞密度）派生，权重入 `QSE_SUB_WEIGHTS.languageTextureFromV1`（0.6 / 0.4），系数复用 `QSE_CALIBRATION`，不引入第二套文本评分；V1 未产出子项（<100 字空结果）时回退语言质量原值并在 `basis` 标注。
- 单测：新增 `tests/unit/engine/quality/dimension-map-c2.test.ts` 3 例；`quality-dashboard-modal.test.ts` 新增 1 例（评估收到人物名册与本章大纲、mtime 未变命中缓存、mtime 变化重新评估）；`quality-score-engine-unified.test.ts` 同步改为断言派生口径。
- 全量 **296 文件 / 3973 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**162. 增量评估的「可跳过」语义真正生效（C3）**
- 现状：`evaluateDimensionInternal` 先算 `canSkipDimension`，但 `if (canSkip)` 与 `else` 两个分支代码完全相同（都只是查 `dimensionCache`）——增量语义等于没有实现，注释与实际行为不符。
- 修复：`changedRange` 存在且 `canSkipDimension` 为 false（变更范围包含人物名）时绕过缓存重算人物一致性；`canSkip` 为 true（变更范围不含人物名）或未提供 `changedRange` 时照常查缓存。其余维度不受影响。
- 说明：生产链路注入 `v1Engine` 时在 `evaluateDimensionInternal` 开头即返回派生结果，本分支只服务未注入 `v1Engine` 的旧调用方与测试；`dimensionCache` 仍按整段正文哈希建键，所以「复用」仅在同一正文重复评估时成立。
- 单测：新增 `tests/unit/engine/quality/quality-score-engine-incremental-c3.test.ts` 3 例（含人物名重算 / 不含人物名复用缓存 / 无 `changedRange` 保持普通缓存）。
- 全量 **297 文件 / 3976 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**163. 评估入口串行化：共享 V1 内核不再被并发上下文覆盖（C4）**
- 现状：`syncV1Context` 直接对注入的 `WritingQualityEngine` 实例 `updateOptions`，该实例是构造时传入的共享可变对象；`evaluate` / `evaluateDimension` 是 `async`，同一实例并发评估时，后一次的人物名单/大纲可能覆盖前一次正在使用的上下文。
- 修复（方案 A：串行队列）：`QualityScoreEngine` 新增 `evalQueue` 与 `enqueueEvaluation(run)`；`evaluate` 拆为「入队 + `evaluateInternal`」，`evaluateDimension` 整体入队。一次评估的「同步上下文 → 内核评分」不会被另一次调用插入；前一次抛错时队列自动释放（`evalQueue` 被吞掉拒绝态），不会卡死后续评估。
- 说明：未采用「按上下文克隆内核」（方案 B）——V1 实例持有 `scoreHistory` 与趋势状态，克隆会让历史与趋势断裂。
- 单测：新增 `tests/unit/engine/quality/quality-score-engine-serial-c4.test.ts` 4 例（并发两份名单各自正确 / 调用返回时内核尚未执行 / `evaluateDimension` 同队列 / 抛错不卡队列）。
- 全量 **298 文件 / 3980 用例**通过；typecheck / build 通过；`plugin:reload` 成功，`dev:errors` 无错误。

**164. Phase 1–3 合并回归：无回归失败，清理探针残留（Rev 166）**
- 静态与构建门：`typecheck` 通过；全量 **298 文件 / 3980 用例**通过（与 Rev 165 持平）；`build` v4.11.0；`check:templates` 55 文件通过；`plugin:reload` 成功，`dev:errors` 无错误。
- 守卫门：`check:deps` 70 组循环、`check-engines` 9 个非白名单 `new` + 2 个白名单超限，与审计基线**完全一致**（扫描面 472→474 文件），未新增违规；两项红灯归 D1 处理。
- 运行时链路：A8 实测 `knowledgeBaseManager.fs.exists/read('.obsidian/plugins/novel-writer-ai/data.json')` 成功（95431 字节），索引外 IO 回退成立；A1 因知识库索引为 `{"books": []}` 无法用现有数据复测，结论沿用 Rev 154 探针结果；A3 需真实并发编辑，本次未制造写盘竞争。
- 交叉核对：C1×C3 / C1×C2 / C2×C4 / B6×B7 / A3×A4×A7 / A1×A8 六组均无冲突（详见审计 spec「Phase 1–3 合并回归」）。
- 清理：删除 Rev 154 探针残留 `.tmp-kb-verify3` / `.tmp-kb-verify4`。
- 新发现（P3，已在 165 修复）：`KnowledgeBaseManager#renameVectorArtifacts` 未复用 `KnowledgeVectorStore.STATE_LOCK`，且为直接覆盖写而非「临时文件 + rename」；并发改名与拆解同时发生时书名可能被旧值覆盖。

**165. Phase 4 工程门 D1/D3/D4/D5/D6 + P3 改名向量缺口（Rev 167）**
- P3：锁实现从 `engine/write-lock.ts` 迁到 `shared/write-lock.ts`（`services` 可合法引用，未新增分层违规），`KNOWLEDGE_VECTOR_STATE_LOCK` 与锁队列同源；`KnowledgeBaseManager#renameVectorArtifacts` 整体包进该锁，并把书名回写改为「临时文件 + rename」原子写，失败清理临时文件。新增 2 例（原子写不残留 tmp、改名与拆解串行）。
- D1：新增 `scripts/baseline-utils.mjs` 与 `.arch-baseline.json`（111 分层 / 70 循环 / 9 非白名单 / 2 超限）；`check:deps` / `check-engines` 支持 `--baseline`，只有**新增**违规才失败，`--update-baseline` 仅在无新增时收紧。`package.json` 新增 `preflight`（typecheck + test + check:templates + 两个守卫）与 `build:release`。
- D3：`StepRunner#executeCurrentStep` 入口记录 `_lastCtx`（早退分支之前）；重试按钮无上下文时禁用并提示，有上下文时重执行并清理旧错误卡片。
- D4：`validateFixStep` 不再把 RegExp / 函数当恒真值，改为三项真实校验（字数 ≥2000、有对话、叙事完整 ≥500 字），四项全过才 `complete`。
- D5：设置加载统一走 `deepMergeSettings`（缺失嵌套字段回落默认、数组整体替换、undefined 不覆盖），删除 6 段手写浅合并；旧 schema 或缺默认顶层键时自动回写，避免每次启动重复迁移。
- D6：`PolishAIPolishModal` 的项目改为必传（由 `PolishEditor.render` 的当前章节项目传入），删除 `getActiveProject()` 回落；`CoWritingView#clearChapterBinding` 新增，`main.ts` / `core/command-registry.ts` 的无上下文入口不再沿用上一章绑定，清空身份、编辑器、建议、指标与牵引引擎并回到「未绑定章节」空态（清空前先按旧身份冲刷排队保存）。新增 6 例。
- 验证：`typecheck` 通过；全量 **303 文件 / 4004 用例**通过；`check:templates` 55 文件；`check:deps` / `check-engines --baseline` 均无新增（退出 0）；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。
- D2：保存管线抽到 `ui/cowrite/body-save-controller.ts`（身份快照 / 保存串行 / 切章冲刷），评估管线抽到 `ui/cowrite/realtime-quality-controller.ts`（评估编排 busy/pending、偏离上下文、顶栏渲染、质量历史落盘节流、开关/切章重置）；视图保留按钮、DOM 句柄、人物/伏笔数据加载与 monitor 装配，公开方法签名不变。`co-writing-view.ts` 4891 → **4292 行**。保存测试改为直接覆盖 controller（7 例），评估相关 5 个测试文件改为 controller 白盒（pending 9 / 失败展示 3 / 落盘 4 / 节奏上下文 3 / 前文缓存 3 / 引擎接线 2）。

**166. D2 步骤执行器切片：重试原语与合并规划外迁（Rev 170）**
- 新增 `engine/step-runner-retry.ts`：`callAIWithRetry`（业务级 2 次尝试，abort 不重试）、`callAIStreamWithRetry`（`length` 截断自动续写 ≤3 次，相同/过短片段停止）、`warnIfTruncated`；host 只注入 `aiEngine` 与 `showProgress` / `showNotice`，不持有步骤状态。
- 新增 `engine/planning-combined.ts`：合并规划 5 模块的 system/user prompt 模板、`fillPlanningTemplate` 变量填充、`buildCombinedPlanningPrompts` 与 `parseCombinedPlanning` 分隔符解析，全部为纯函数。
- `StepRunner` 保留 `callAIWithRetry` / `callAIStreamWithRetry` / `warnIfTruncated` 同名委托方法，既有测试与调用方无需改动；`executePlanningCombined(ctx)` 签名与行为不变，改为调用新模块。`step-runner.ts` 1306 → **1104 行**。
- 高风险切片（`characterSoul` / `emotionPlan` / `sceneExpand` 特例、`executeSettlement`、`executeStepsSequential`）依赖大量宿主状态，本轮不拆，避免把编排状态散到多个模块。
- 新增 `tests/unit/engine/planning-combined.test.ts` 6 例（5 模块解析、缺失/空模块、无分隔符、变量填充、同名变量重复）。
- 验证：`typecheck` 通过；全量 **304 文件 / 4010 用例**通过；`check:deps` / `check-engines --baseline` 均无新增（退出 0）；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**167. D2 第四步：特例步骤与结算链路外迁 + 特征测试护栏（Rev 171）**
- 先补特征测试再抽取：新增 `step-runner-specials.test.ts` 9 例（characterSoul 缺数据/成功/保存失败；emotionPlan 回填/注入降级/校验提示；sceneExpand 预算/回填/保存失败）、`step-runner-settlement.test.ts` 9 例（无目录/报告为空/无指令/磁盘回退/成功汇总/零更新/引擎抛错/强制揭示解析/格式错误）。
- 新增 `engine/step-specials.ts`：`runCharacterSoulStep` / `runEmotionPlanStep` / `runSceneExpandStep`，宿主注入引擎、回调、保存与预算能力；知识注入的画像读取/强度判断/失败降级留在 `StepRunner`，避免特例模块反向依赖 `engine-registry`（直接引用会新增 1 条循环依赖）。
- 新增 `engine/step-settlement.ts`：报告磁盘回退、强制揭示解析、结算汇总、叙事总览刷新与上下文面板通知；文件读写通过 `readTextFile` / `writeTextFile` 注入，结算模块不依赖 Obsidian 文件类型。
- `StepRunner` 保留 `executeSettlement` 公开签名与 `executeCurrentStep` 行为不变，内部委托新模块；三个特例分支的按钮恢复收敛为一个 `restoreButtons` 闭包。
- `step-runner.ts` 1104 → **974 行**（`step-specials.ts` 168 + `step-settlement.ts` 132）；循环依赖保持 70 条、分层违规 111 条，无新增。
- 验证：`typecheck` / `lint` 通过；全量 **306 文件 / 4028 用例**通过；`check:deps` / `check-engines --baseline` 退出 0；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**168. D2 第五步：批量顺序执行外迁（Rev 172）**
- 先补特征测试：新增 `step-runner-sequential.test.ts` 5 例（已完成步骤跳过且不重复执行；未知 key 静默跳过；按传入顺序执行且回调/结果对应；某步抛错中断并回报 `failedAt`；结束后恢复 `baseCtx.currentStepIndex`；同批次共享输入元素）。
- 新增 `engine/step-sequential.ts`（82 行）：`executeStepsSequential(host, stepKeys, baseCtx, options)`，宿主注入 `executeStep` 与 `createStepInputs`，engine 模块不再直接调用 `document.createElement`。
- `StepRunner.executeStepsSequential` 公开签名与返回结构不变，内部委托新模块；假 textarea/range 的构造留在 `StepRunner` 的 `createStepInputs` 中。
- `step-runner.ts` 974 → **933 行**。至此 D2 的步骤执行器拆分完成：重试、合并规划、特例步骤、结算、批量顺序执行均已外迁。
- 验证：`typecheck` / `lint` 通过；全量 **307 文件 / 4033 用例**通过；`check:deps` / `check-engines --baseline` 退出 0；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**169. D2 第六步：`executeCurrentStep` 分支特征测试 + prompt 装配外迁（Rev 173）**
- 先补四类分支特征测试：新增 `step-runner-common-branches.test.ts` 4 例——`preValidation` 失败（analysisReport 未做正文 → 不发起 AI 调用、提示「请先执行「正文生成」步骤」、不落盘、按钮恢复）、`postValidation` 失败（bodyGeneration 字数不足 → 提示但仍然保存并标记完成，锁定现状语义）、abort（`finishReason='aborted'` → 提示「已取消，结果未保存」且不落盘不标记）、截断（`finishReason='length'` → 提示「结果可能不完整」且照常落盘）。
- 取证结论：`preValidation` 仅 `analysisReport`（index 9）可达；`postValidation` 仅 `bodyGeneration`（index 7）可达；`preCheckQualityControl` 挂在已不在 `ALL_FULL_STEPS` 的 fix/finalFix 上，运行时不可达。
- 新增 `engine/step-prompt-assembly.ts`（68 行）：`assembleStepPrompt(host, ctx, stepKey, systemPrompt, userPrompt, stepModel)` 负责「大纲知识注入作为可丢弃尾部 + 按本步实际模型取窗口预算 + 头尾截断 + 两条降级日志」，返回 `effectiveUserPrompt` / `truncated` / `droppedExtra` / `estimatedTokens`。宿主注入 `loadOutlineKnowledge` 与 `resolveStepBudgetLimits`，模块只依赖 `shared/prompt-budget`、`shared/thresholds`、`shared/logger` 与类型，不引用 `engine-registry`（避免新增循环依赖）。
- `StepRunner` 新增 `promptAssemblyHost()` / `loadOutlineKnowledge()`，知识注入的画像读取、强度判断与失败降级仍留在本类；`executeCurrentStep` 内的内联装配与 `fitPromptToContext` 调用替换为一次 `assembleStepPrompt`，截断提示改读 `promptAssembly.truncated` / `estimatedTokens`。`step-runner.ts` 933 → **934 行**（净 +1：宿主方法 28 行入、内联装配 39 行出）。
- 验证：`typecheck` / `lint` 通过；全量 **308 文件 / 4037 用例**通过；`check:deps` / `check-engines --baseline` 退出 0（循环 70、分层违规 111、引擎非白名单 9 + 超限 2，均无新增）；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**170. D2 补测：`step-prompt-assembly` 模块级单测（Rev 174）**
- 新增 `tests/unit/engine/step-prompt-assembly.test.ts` 3 例，把模块契约从「经 StepRunner 间接覆盖」升级为直接覆盖：非 outline 步骤不调用 `loadOutlineKnowledge`（且把本步模型原样传给 `resolveStepBudgetLimits`，预算充足时 user prompt 原样返回）；outline 步骤把知识注入拼在 user prompt 之后作为可丢弃尾部；`maxContext 1200 / maxOutput 100`（安全余量 500，可用 600 tokens）下先丢注入再头尾截断主体，返回 `droppedExtra=true` / `truncated=true` / 含「上下文过长」提示，并记录「已跳过知识注入」「中间资料截断」两条 warn。
- 只新增测试文件，`step-prompt-assembly.ts` 与 `step-runner.ts` 零改动，构建产物无变化（无需 reload）。
- 验证：`typecheck` / `lint` 通过；全量 **309 文件 / 4040 用例**通过；`check:deps` / `check-engines --baseline` 退出 0（循环 70、分层违规 111、引擎 9 + 2 均无新增）。

**171. D2 棘轮项：命令注册表 UI 依赖注入化（Rev 175）**
- 先补护栏再搬迁：新增 `tests/unit/core/command-registry.test.ts` 3 例——53 个 `registerInternalCommands` 注册 id 与重构前快照完全一致、UI 命令走注入端口、非 UI 命令（信息债刷新）仍留在 core。搬迁前该测试连导入都无法完成（core → 44 个 Modal → `main.js`），实证 core 不可独立测试。
- 新增 `shared/command-ids.ts`：`CommandIds` / `CommandId` 从 core 移到 shared，core 原位置 re-export，外部引用零改动；避免 ui 执行器为拿 id 常量反向依赖 core 而重新连成环。
- 新增 `shared/command-ui-port.ts`：`CommandUiPort.executeCommand(id, payload?)`（payload 含 `editor` / `project` / `versionContext`）+ `NOOP_COMMAND_UI_PORT`；core 与 ui 只共享类型，core 不再 import 任何 ui 模块。
- 新增 `ui/command-ui-executor.ts`（376 行）：44 个 Modal 命令、指纹库/知识库视图、编辑器选区类命令（扩写 / 大纲扩写 / 改写建议）、重命名项目、版本历史全部在此执行；旧命令弃用提示与去重也随迁。
- `core/command-registry.ts` 805 → **515 行**：删除 45 个 ui import，`registerInternalCommands` 改为「44 个 UI 命令统一登记 → 委托端口」+ 9 个无 UI 依赖命令留在 core；视图方法（full writer / co-writing / 指纹库 / 知识库）删除，改由 main 既有方法或执行器提供；`renameProject` / `openVersionHistory` 改为携带上下文委托。
- `main.ts` 在引擎初始化前创建 `CommandUiExecutor` 并注入 `engineRegistry`；`shared/plugin-api.ts` 增加 `commandUiPort`；`engine-registry` 透传 `ui: plugin.commandUiPort`。
- 架构守卫棘轮收紧：分层违规 **111 → 66**（core 52 → 6），循环依赖 **70 → 54**。4 条新环字符串经逐条核对为同一强连通分量内的路径重排（core 只删边、执行器新增的边均为 ui→ui / core→shared / shared→shared），无真实新增 import 依赖，已写入 `.arch-baseline.json`。
- 验证：`typecheck` / `lint` 通过；全量 **310 文件 / 4043 用例**通过；`check:deps` / `check-engines --baseline` 退出 0；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**172. 章节流程连贯性：阶段完成口径 / 步骤级导航 / 向导产物注入（Rev 176）**
- **阶段完成口径改为「必做完成即可」**（`ui/full-writer/streamlined-nav-presenter.ts`）：`StreamlinedPhase` 增加 `requiredSteps`（由 `ALL_FULL_STEPS.required` 派生），`getPhaseStatusDescriptor` 不再要求阶段内全部步骤 complete——必做全完成即 ✅（title 带「可选 x/y」）；全可选阶段（质量审查）做过任意一步即 ✅；有可选/部分结果但必做未完成显示「◐ 进行中（必做 x/y · 可选 x/y）」；必做完成但被标脏仍优先显示 ⚠️ 过期。
- **步骤级导航**（`ui/full-writer/step-render-controller.ts` + `styles.css`）：阶段项下逐条渲染 11 个步骤的 ✅/◐/○/⚠️ 状态、必做标记与当前步骤高亮；阶段可点击时子项可直达对应 `stepIndex`，不可点击时子项只读，避免绕过上下文加载直接跳到正文。
- **规划类模板补齐向导产物**（`engine/prompts/chapter-pipeline-prompts.ts`）：INFO_PLAN / PLOT_DISTILL / OUTLINE 的 user prompt 新增 `${worldView}` `${settingLib}` `${writingStyleContent}` `${prevChaptersSummary}` `${prevChapEnding}` `${timelineEvents}`（按步骤需要取用），system prompt 明确「世界观/设定库是硬约束、上一章结尾是本章时空起点」；合并规划模板（`engine/planning-combined.ts`）同步补齐，并让 `executePlanningCombined` 也走 `fitPromptToContext` 预算闸门（此前合并规划完全绕过闸门）。
- **正文接入文笔指纹**（`engine/step-prompt-assembly.ts` / `engine/step-runner.ts`）：`bodyGeneration` 步骤把 `KnowledgeInjector.injectForBodyGeneration`（风格/节奏/技巧/人物要点）作为可丢弃 `extraTail` 注入；此前只有旧路径 `AIEngine.generateChapter(Stream)` 调用，11 步流水线正文拿不到任何指纹文笔。
- **跨章承接**：OUTLINE system prompt 增加「场景顺序即阅读顺序、第一场景必须承接上一章结尾、跳时空必须写过渡」硬约束；正文 V1/V2 模板与 Scene 展开模板补 `${prevChapEnding}`，Scene 展开再加「时间/地点/人物状态连续、禁止无过渡换场」检查；`template-vars-builder` 为这些占位符加空串兜底，避免上下文缺失时 `${...}` 字面量漏进 prompt。
- **流程顺手**：一键生成规划后的自动跳转改为「必做 infoPlan 完成即进入正文写作」，与左侧导航口径一致，不再等 5 个可选步骤全绿。
- 新增 `tests/unit/ui/streamlined-nav-presenter.test.ts` 8 例锁定完成口径；`step-prompt-assembly` 补 bodyGeneration 注入用例（4 例）。
- 验证：`typecheck` / `lint` 通过；全量 **311 文件 / 4052 用例**通过；`check:deps` / `check-engines --baseline` 退出 0（循环 54、分层违规 66、引擎 9 + 2 均无新增）；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**173. 章节流水线信息传递重构：缺失可见 / 消费面补齐 / 分段裁剪 / 灵魂层真实化（Rev 177）**
- **根因**：`required` 只是「最低可交付」静态标记，与下游是否消费无关。`outline` / `plotDistill` / `emotionPlan` / `sceneExpand` 虽标可选，却被正文模板真实消费；缺失时被静默降级为空串或分卷规划，模型只能自由发挥，是 OOC 与剧情偏离的主要来源。截断又在三处独立生效（世界观/设定库固定上限、四类实体共享 topN、`fitPromptToContext` 头尾腰斩）。
- **缺失可见**（`ui/full-writer/template-vars-builder.ts`）：`infoPlan` / `distilledContent` / `outlineContent` / `emotionPlan` / `sceneExpansion` / `prevChapEnding` 缺一即写入明确标记与禁令（如「不得自行新增情节节点、反转或信息释放」），不再留空串或鼓励自由发挥；无上下文时给出「不要编造上一章结尾」。
- **正文消费面补齐**：V1 模板（`chapter-pipeline-prompts.ts`）新增设定库、角色灵魂层、记忆碎片、时间线、情绪弧、场景展开六段；V2 模板（`body-v2-prompts.ts`）新增信息规划、情节节点、设定库、时间线四段。此前两套模板互相丢弃对方消费的产出。
- **Scene 展开接跨章约束**（`engine/scene-expander.ts`，真正生效的模板；此前只改到 UI 路由层的 `soul-driven-prompts.ts`）：user 模板新增 `${infoPlan}` `${prevChapEnding}` `${timelineEvents}`，system 增加「第一场景承接上一章结尾、时间不得倒退、换场必须有过渡、只演出已确定事件」四条硬约束，预算裁剪改 `sectionAware`。
- **灵魂层真实化**（`engine/character-soul.ts` / `ui/full-writer/context-loader-controller.ts` / `engine/prompts/template-utils.ts`）：自动提取改为读取真实 9 字段 soul 并 `formatSoulForPrompt`，无完整 soul 不再标记完成；`buildCharacterSoulSummary` 支持按本章相关角色过滤与上限 8 人；V2 模板门禁从 `characterCores.length>100` 改为 `characterSoulReady==='1' || protagonistSoulDetail`，避免「灵魂层未配置」误开 V2。
- **截断分层**（`engine/entity-scorer.ts` / `engine/context-compressor.ts` / `shared/prompt-budget.ts`）：实体新增 `scoreAndFilterEntitiesByType` 分类预算（人物 12 / 势力 6 / 地点 6 / 物品 6），主角强制保留；世界观/设定库上限随窗口缩放（2000–12000 / 1000–6000）；`fitPromptToContext` 新增 `sectionAware`，按 `【标题】` 分段并按关键词判优先级，低优先段整段丢弃并追加「已省略以下段落」标记，关键段（世界观/设定库/人物/大纲/输出约束）最后才动。
- **其它真实缺陷**：`engine/emotion-planner.ts` 的 `callAI(systemPrompt, userPrompt)` 参数传反，情绪规划从未按 system 约束生成；`engine/step-runner.ts` 的 `loadBodyKnowledge` 接入记忆碎片（此前 11 步流水线 `triggeredMemories` 恒空）；`executePlanningCombined` 成功条件从「5 模块中 3 个」改为「infoPlan + outline 必须存在」，缺模块直接报错不推进，且补知识注入、`sectionAware`、`finishReason==='length'` 告警。
- 新增/修改测试：emotion 调用顺序、灵魂层过滤与上限、分类实体预算、`sectionAware` 分段丢弃、设定库上限随窗口、V2 门禁真灵魂、Scene 展开跨章注入与缺失标记。全量 **311 文件 / 4062 用例**通过；`typecheck` / `lint` 通过；守卫 66 分层 / 54 循环 / 9 非白名单 / 2 超限无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**174. 合一规划完整性判定纯函数化 + 正文消费契约测试（Rev 178）**
- `engine/planning-combined.ts` 新增 `evaluateCombinedPlanning(parsed, completed, minChars)`：返回本次有效产出、仍缺失模块、是否满足「infoPlan + outline」最低条件；`completed` 并入运行前已完成步骤，避免「之前已有 outline、这次只生成 infoPlan」被误判缺失。`COMBINED_PLANNING_MIN_MODULE_CHARS` 从 `step-runner` 的内联 `> 50` 收敛为单一常量。
- `engine/step-runner.ts#executePlanningCombined` 改用该纯函数驱动保存与成功判定，行为不变但成功规则可单测。
- `tests/unit/engine/planning-combined.test.ts` 新增 4 例：全模块有效、缺 outline 不成功、历史 outline 可复用、短模块不计完成。
- `tests/unit/engine/prompt-template-auto.test.ts` 新增「V1/V2 正文模板必须消费全部已生成规划产物」契约：共享消费面 8 项 + 记忆碎片/角色灵魂层的落点，任何模板再丢一段都会红。
- 同步修正 spec 中与实现不一致的世界观/设定库上限描述（12% / 6%，上限 12000 / 6000）。
- 验证：全量 **311 文件 / 4067 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**175. 阶段导航完成性识别：真实落盘格式不再被误判（Rev 179）**
- **动因**：九霄逆脉行第1章导航中，大纲摘要、质量控制、章节结算、角色灵魂提取四步长期停在 ◐ 或反复回退。四个步骤文件真实存在且内容完整，问题出在「识别」而非「生成」。
- **根因 1（大纲摘要）**：`normalizeStepMarkup` 把任何「短标签：」行提升为 `##` 标题。真实落盘格式 `**全书定位**：` 的下一行是正文导语「本章是全书开篇第一章，承担以下叙事功能：」，被一并升成标题，导致「全书定位」节内容为空 → `partial score=67 missing=[全书定位]`。
- **根因 2（质量控制）**：`extractSectionAfterHeading` 的终止正则 `^##[#]*\s+` 会匹配 `###` 子标题。`## 写作技法检查` 紧跟 `### 1. AI痕迹与表达` 时整节立即终止，25KB 质量报告被判 `empty`，missing 三项全缺。
- **根因 3（章节结算）**：结算没有独立步骤文件（`StepResultSaver` 的 fileMap 无 `settlement`），唯一持久证据是正文 frontmatter 的 `status: settled / 已完稿`；恢复逻辑只按「文件是否存在」判断，重启后必然回退。
- **根因 4（角色灵魂）**：自动提取只写内存 `stepResults/stepLevels/stepCompleted`，不落盘；`onOpen` 与切章路径又是 `loadContext()` → `restoreChapterState()`，磁盘上的原始模板（`isTemplateSkeleton`）随后把内存完成态覆盖回 empty。
- **规范化收紧**（`engine/step-validator.ts`）：短标签提升为标题需同时满足「长度 ≤20、不含 `。！？，；、`、命中结构标签白名单」；已有标题先剥离 `一、` / `1.` / `第二节` 编号前缀；`extractSectionAfterHeading` 终止条件改为 `^#{1,headingLevel}\s+`，只被同级或更高级标题截断。
- **恢复逻辑修正**（`ui/states/chapter-state-manager.ts`）：磁盘无步骤文件时同步删除残留 `stepResults`（旧实现只清 completed/level，导航按残留结果继续显示 ◐）；`settlement` 在无文件时按正文 `status` 标记完成；文件存在但校验为 empty/skeleton 时也删除 `stepResults`。
- **角色灵魂持久化**（`ui/full-writer/context-loader-controller.ts` / `ui/full-writer-view.ts`）：自动提取改为 `saveStepResult('characterSoul', …)` 落盘，保存成功才标 complete，失败降为 partial 并提示；磁盘已有真实灵魂文件或内存已有恢复内容时跳过自动提取，避免覆盖；`onOpen` 与 `handleFileChange` 两处顺序改为 `restoreChapterState()` → `loadContext()`。
- 新增测试：`step-validator` 补「粗体标签 + 正文导语」与「中文编号 + `###` 子节」两例；新增 `chapter-state-recognition` 3 例（残留清理 / 结算按正文 status / 未结算不误标）；新增 `context-loader-soul-persist` 4 例（落盘成功、落盘失败不标完成、不覆盖磁盘既有文件、不覆盖内存恢复内容）。
- 验证：真实项目第1章探针确认大纲 `complete score=90`、质量控制 `complete score=90`、正文 `status=settled`、角色灵魂为模板骨架（打开工作台后自动提取落盘）。全量 **313 文件 / 4076 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0。

**176. 快捷工具三层对齐：统一章节上下文解析 + 路由补齐 + 面板折叠（Rev 180）**
- **动因**：项目页右侧与章节页标题栏的快捷工具在「前端入口 → 命令执行 → 数据落点」三层不一致：工作台/项目页没有 `activeFile` 时，多个工具点进去只显示「请先打开章节正文文件」，看起来像「前端有按钮、后端没功能」。
- **根因**（`[已核对]`）：`main.ts#getActiveProject()` 只读 `workspace.getActiveFile()`；`ReviewChapterModal` / `ContextInjectorModal` / `CharacterRecognitionModal` 直接读 `getActiveFile()`；`ChapterSettlementModal` 虽支持构造上下文，但命令入口 `new ChapterSettlementModal(app, plugin)` 未传；`StyleDistillerModal` 自带一份只读 activeFile 的 `getActiveProject()`；`BatchNovelsModal` 的起始卷号无 activeFile 时固定为 1。
- **统一上下文源**（`shared/chapter-target.ts` / `main.ts`）：新增纯函数 `resolveActiveChapterTarget`，优先级固定为「工作台上下文 > activeFile 标准正文 > activeFile 步骤结果目录」；`NovelWriterPlugin` 增加 `setWorkbenchContext / getWorkbenchContext / getActiveChapterTarget()`，`getActiveProject()` 在 activeFile 不属于项目时回退工作台项目。
- **上下文回写**（`ui/full-writer-view.ts` / `project-selector-controller.ts`）：工作台每次 `renderTabContent` 同步当前章节；项目页项目卡片选中/默认选中通过 `onProjectSelected` 回写；`onClose` 清空；项目页默认选中优先沿用上次项目而非 `projects[0]`。
- **Modal 改造**：连贯性审查、章节结算、上下文注入、角色识别、批量生成改用 `getActiveChapterTarget()`；文笔风格蒸馏改调 `plugin.getActiveProject()`；步骤结果查看与流程诊断默认选中当前项目。
- **路由补齐**（`core/command-registry.ts`）：`novel-writer-narrative-overview` 补进 InternalRegistry，快捷工具点击不再 fallback 到 Obsidian 命令面板并打 warn。
- **前端折叠**（`tool-catalog.ts` / `quick-tools-panel.ts` / `styles.css`）：`ToolGroup` 增加 `defaultCollapsed`；面板分组标题改为可点击折叠头（显示组名、数量、箭头），默认收起「设定与实体 / 审查与优化 / 工具与维护」，核心写作、项目规划、章节生成保持展开。
- 新增测试：`tests/unit/shared/chapter-target.test.ts` 6 例（工作台优先、正文/步骤目录解析、空上下文、非章节文件、卷号解析）；`tests/unit/ui/tool-catalog-contract.test.ts` 4 例（目录 commandId 均有后端定义、高频工具属于目录、ID 唯一、折叠分组契约）；`command-registry.test.ts` 快照补 `NARRATIVE_OVERVIEW`。
- 验证：全量 **315 文件 / 4086 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**177. 快捷工具数据层收敛 + 三层契约守卫（Rev 181）**

- **动因**：Rev 180 解决了「执行层拿不到界面上下文」，但复检仍有三处不统一：平台级报告写进 vault 根目录、两个 Modal 固定选中项目列表第一项、质量仪表盘保留第三套章节定位；且契约测试只校验常量，无法阻止「新增按钮漏注册」。
- **数据层**（`shared/paths.ts` / `ui/tomato-rank-modal.ts`）：新增 `GLOBAL_RANK_DIR = '元文件/06-榜单分析'` 与 `globalRankFile()`；番茄榜单分析从 vault 根目录迁到全局目录，写入前 `mkdirp`，同一分钟重复分析改为 `vault.modify` 覆盖，弹窗顶部标注保存位置。
- **执行层**（`ui/novel-tags-modal.ts` / `ui/cross-volume-state-modal.ts`）：作品标签分析与跨卷状态继承默认选中 `plugin.getActiveProject()`，未命中才回退列表第一项。
- **执行层**（`ui/quality-dashboard-modal.ts`）：`locateChapter` 改为 `getActiveChapterTarget()` 优先、`getActiveProject()` 兜底，删除本文件自建的 activeFile 正则与 `getCurrentChapterState` 探测。
- **守卫**（`tests/unit/ui/quick-tools-three-layer.test.ts`）：源码文本扫描对账「tool-catalog → `uiCommandIds` → `r.register` → executor `case`」，7 例覆盖目录常量、注册入口、执行分支、孤儿分支、重复登记；不 import `core/command-registry`，避免 vitest 拉起 `main.js`。
- 验证：全量 **316 文件 / 4093 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**178. 上下文注入幂等化（Rev 182）**

- **动因**：`ContextInjectorModal` 每次点击「注入上下文」都在正文 marker 后追加一段「## 自动注入上下文」，重复点击会让同一章累积多段重复表格与伏笔列表，污染正文且无法自动回收。
- **数据层**（`shared/auto-context-block.ts`）：新增 `buildAutoContextBlock` / `stripAutoContext` / `upsertAutoContext` 三个纯函数，用 `<!-- nw:auto-context:start/end -->` 标记圈定块边界；清理顺序为「先标记块、再旧版无标记块」，避免旧块内部的 `---` 干扰新块识别。
- **插入位置**：`<!-- 正文从这里开始 -->` 标记后 → 一级标题后 → 正文末尾；只整理插入点两侧空行，不压缩正文其他空行。
- **兼容清理**：旧版注入块（`---` + `## 自动注入上下文` 开头、`---` 结尾、无标记）在同一次写入中清理，已有污染正文注入一次即可恢复为单段。
- **Modal**（`ui/context-injector-modal.ts`）：改用 `upsertAutoContext`；正文文件不存在时提示「当前章节正文尚未创建，请先生成正文后再注入上下文」，不再误报「读取文件失败」。
- 新增测试：`tests/unit/shared/auto-context-block.test.ts` 7 例（首次注入、重复注入只留一块、旧版块清理、标题/末尾回退、同名标题不误删、块边界）。
- 验证：全量 **317 文件 / 4100 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**179. 「项目与章节」入口修复：点击必有反馈（Rev 183）**

- **动因**：快捷工具「流程规划工作台」（现更名「项目与章节」）点击没有反应。CDP 取证：工作台已打开且停在项目页、`project` 为空时，`openFullWriterView` 复用 leaf 后只调用 `refreshChapterStateFromDisk`，该方法无章节直接 return，既不切 tab 也不提示，用户看到的是零反馈。
- **入口路由**（`main.ts`）：新增 `openFullWriterHome()` —— 复用已有视图后调用视图的 `showProjectSelector()`；首次打开时 `onOpen` 已默认落在项目与章节，不重复路由。`openFullWriterView()` 签名保持 `Promise<void>`，避免破坏 `NovelWriterPluginAPI` 既有契约。
- **视图**（`ui/full-writer-view.ts`）：新增公开方法 `showProjectSelector()` —— 不在项目页时 `activateTab('project-selector')`；已在该页时 `renderProjectSelectorInTab()` 重新扫描项目并提示「已刷新项目与章节」，保证点击必有可见反馈。
- **入口统一**：`CommandUiExecutor` 的 `FULL_WRITER` 分支、左侧 `book-open` ribbon 均改走 `openFullWriterHome`；命令面板与快捷工具名称统一为「项目与章节（流程工作台）」。
- 新增契约测试：`quick-tools-three-layer.test.ts` +2 例，锁定 executor 分支与 ribbon 入口必须调用 `openFullWriterHome`，防止回退成静默刷新。
- 真机验证（Obsidian CDP）：已在项目页执行 → `activeTabId=project-selector` 且出现 Notice「已刷新项目与章节」；切到章节 tab 后执行 → `activeTabId` 由 `verify-chapter` 变回 `project-selector`。
- 验证：全量 **317 文件 / 4102 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**180. 章节生成三工具算法统一 + 设定实体前端重设计 + 步骤结果弹窗缩小（Rev 184）**

- **动因**：快捷工具「章节生成」中除批量建章外的三个旧工具（整章生成 / 自动写作器 / 批量写正文）各自持有一套算法；「设定与实体」存在控件高度错位、字号漂移与缺失样式；「步骤结果查看」取全局 96vw 上限导致近乎全屏。
- **章范围算法**（`engine/chapter-utils.ts`）：新增 `listChapterNumbers(app, project, volN)` —— 以「步骤结果目录 ∪ 正文文件」并集推导已建骨架章节。原自动写作器/批量写正文只用「已有正文」过滤范围，尚未写正文的新章永远无法被选中（输入区间后得到 0 目标）。
- **流水线统一**（`ui/write-chapter-modal.ts`）：`doWriteChapter` 改为 `public static` 并新增 `opts.signal`；信息规划 / 大纲摘要 / 正文 / 分析报告 / 结算 / 审查六个阶段前检查中止信号，正文流式调用透传 `AbortSignal`；`onOpen` 改用 `plugin.getActiveChapterTarget()`（工作台上下文 > activeFile 正文 > 步骤结果），并改为「目标摘要 + 开始按钮」确认式，打开即烧 token 的行为已取消；删除无引用的 `parseChapterPath` 与私有 `writeChapter`。
- **自动写作器**（`ui/auto-writer-modal.ts`）：删除 `generateInfoPlan / generateOutline / generateBody / generateAnalysis / executeSettlement / getVolumes` 等自造实现（约 350 行），逐章调用 `WriteChapterModal.doWriteChapter`，自动获得 `buildChapterPrompts`、指纹/知识注入、3 次续写与统一落盘；新增 `AbortController`，关闭弹窗即中止在途调用。
- **批量写正文**（`ui/batch-chapters-modal.ts`）：删除自造正文 prompt（含硬编码《雪中悍刀行》徐凤年/老黄范文）、自造续写/违规修正/分析/结算（约 450 行），同样逐章调用统一流水线；保留取消语义与批量结束后的信息债看板刷新。顺带移除「`findChapterFile(整卷目录)` 命中任意章正文」导致的串章与 frontmatter 误写隐患。
- **控件同高**（`styles.css`）：`.nw-btn` 原被 `min-height: var(--nw-hit-min, 44px)` 撑到 44px，而同排 `.nw-input/.nw-select` 为 32px；统一为 32px（`.nw-btn-sm` 28px），`max-width: 768px` 恢复 44px 触控目标；表单弹窗内输入框强制 32px（主题规则会把实际高度压到 ~30px）。
- **弹窗自适应**（`styles.css`）：新增 `.nw-modal-form`（min(680px,92vw) × min(86vh,900px)）与 `.nw-form-stack/.nw-form-grid/.nw-form-actions/.nw-form-hint`；`.nw-modal-lg` 补高度约束（原只有宽度，长表单会溢出）；章节生成三工具、五个实体生成弹窗与同人设定弹窗改挂 `nw-modal-form`。
- **设定与实体**：`unified-entity-manager`（`nw-modal-xl`，高度 min(75vh,860px)，左栏 `clamp(180px,20vw,240px)`，`<820px` 改上下布局）；`unified-entity-generate` 改 900px 档、类型卡网格 `repeat(auto-fit,minmax(220px,1fr))`、5 步向导标签 11px 且可截断；`ai-builder` 由强制 96vw×96vh 改为 min(1300px,94vw) × min(90vh,900px)；全部实体内 Modal 统一挂 `nw-entity-scope`，内联 `0.85em/0.8em/0.9em` 等改为字号令牌；生成数量输入框补 `.nw-input`。
- **缺失样式补齐**（`styles.css`）：`.nw-gen-modal-prompt-label`、`.nw-gen-modal-progress-bar/-fill` 此前在 CSS 中完全未定义（进度条生成时无任何反馈），本次补齐并可随 `prefers-reduced-motion` 降级。
- **步骤结果查看**（`ui/step-result-viewer-modal.ts`）：移除 `--nw-modal-max-w/max-h`（96vw×90vh）强制尺寸，改用 `.nw-step-viewer`（min(720px,92vw) × min(78vh,720px)）；内边距与行高压缩，`<600px` 隐藏模型/时间列。
- 新增测试：`tests/unit/engine/chapter-utils-chapters.test.ts` 4 例（骨架并集去重排序、仅正文、空卷、忽略非正文命名）；`tests/unit/ui/chapter-generation-unify.test.ts` 32 例（三工具统一调用、无自造 prompt/范文、signal 中止、表单尺寸类、实体字号令牌、弹窗尺寸与 CSS 补齐）。
- 真机验证（Obsidian CDP，窗口 2019×1086）：整章生成 680×276 且显示「第3卷 · 第399章」；自动写作器 680×323；批量写正文 680×373、范围默认 1–130、表单两列各 296px；统一生成实体 900×480；实体管理 1300×815（左栏 240 / row），模拟 788px 视口后左栏 100% / column / max-height 180px；步骤结果查看 720×720；按钮与输入框实测均 32px，内容内边距 20px。
- 验证：全量 **319 文件 / 4138 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**181. 步骤完成度按结构校验 + 上下文输入清单 + 章节选择器切换加固（Rev 185）**

- **动因**：①角色灵魂的「完成」只看三个标签后是否有 2 个字符，`欲望：>-` 这类空占位也算；②情节蒸馏/大纲摘要的模板骨架（空标签、空表格、枚举提示）能凑够字符门槛，未调用 AI 也被判完成；单步与合并规划甚至「保存成功即标完成」；③上下文加载步骤只显示「✅ 已加载完成」，用户看不到喂了什么、也看不到缺什么，且 `loadContext` 与状态恢复都无条件标完成；④章节选择器复用标签页时 `chapterKey` 不含卷，跨卷同名章会拿到旧卷目录。
- **模板占位清洗**（`engine/step-validator.ts`）：新增导出 `stripPlaceholderLines`，剔除空标签行（`- 节点1：`）、空表格行（`| 1 | | | | | |`）、枚举提示（`高/中/低`、`悬念式/反转式/…`）与方括号模板说明（`[开端/发展/…]`）；`hasMeaningfulContent` 改为先清洗再判长度；`isTemplateSkeleton` 复用清洗并忽略 Markdown 标题，去掉 `${}` 条件也仍能识别骨架（情节蒸馏、大纲摘要模板没有变量占位符）。
- **角色灵魂块级判定**（`engine/step-validator.ts` / `engine/character-soul.ts`）：`validateCharacterSoul` 按 `【角色名】` 分块，字段值需非占位且去标点 ≥4 字，兼容 `欲望：…`、`## 欲望`、紧凑注入格式 `欲>/惧>/底>`；`buildSoul` 的 `hasSoul` 由「长度 >0」改为「9 字段均为实质值」，`>-`/`暂无` 不再算有灵魂。
- **完成态统一 gate**（`engine/step-runner.ts` / `engine/planning-combined.ts`）：单步生成保存后跑 `validateStepResult`，只有 complete 才 `stepCompleted.add`，否则撤销完成态并提示缺失模块；`evaluateCombinedPlanning` 新增可选 `isValid` 谓词，step-runner 传结构校验，残缺模块不再计入 generated，`requiredReady` 要求 outline 真正完整。
- **上下文输入清单**（新增 `engine/context-readiness.ts` + `ui/full-writer/step-render-controller.ts`）：`assessContextReadiness(context, chapterNum)` 输出 17 项输入的条数/字数/必做/是否加载；必做 = 人物、大纲、世界观或设定库、非首章的前章摘要。上下文步骤页改为「完整性徽标 + 逐项清单 + 必做徽标 + 重新加载按钮」，缺失项高亮并给出补齐提示。
- **上下文完成态**（`ui/full-writer/context-loader-controller.ts` / `ui/states/chapter-state-manager.ts`）：`loadContext` 按 readiness 写 complete/partial 并 Notice 点名缺失；`restoreChapterState` 删除末尾无条件 `context=complete`，不再覆盖加载结果；角色灵魂自动提取保存后再过结构校验，字段不完整时提示缺失项。
- **章节选择器**（`ui/full-writer/tab-controller.ts`）：`chapterKey` 改为 `项目/卷/章`；复用旧标签页时同步 `chapterName/volume/chapterNum/chapDir`，避免旧卷目录把内容带错；切换后校验 `state.chapterName`，未生效时给明确 Notice。CDP 实测第4→3→131章（跨卷）连续切换均成功。
- 新增测试：`step-validator-placeholder.test.ts` 12 例（占位清洗、两模板不完成、真实内容完成、灵魂块级/空占位/紧凑格式）、`context-readiness.test.ts` 6 例、`step-completion-rev185.test.ts` 12 例（源码契约）；`planning-combined.test.ts` +2 例。更新 `step-runner-common-branches.test.ts` 两例为「保存但不标完成」。
- 真机验证（Obsidian CDP）：第1卷第3章情节蒸馏/大纲摘要由 complete 变 `empty`；上下文步骤显示「输入完整：15/17 项已加载，必做 4/4 项齐全」与 17 行明细（角色灵魂 7/8 人有完整灵魂、时间线/触发记忆未加载 ○）；内存置空上下文后显示「必做缺少 人物状态、章节/分卷大纲、世界观 / 设定库、前章摘要」；重新加载后停留上下文步骤。
- 验证：全量 **322 文件 / 4170 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**182. 全章节选择（正文 ∪ 骨架）+ 时间线/伏笔关联索引程序（Rev 186）**

- **动因**：①章节选择器只列「已有正文」的章，仅建骨架未写正文的章无法从下拉/全部章节/协同入口进入；②时间线与伏笔只按固定字数平铺进 prompt（时间线 500 字、伏笔 1000 字），与世界观设定条目、全书规划无任何交叉，也没有可见输出；真实数据还存在重复污染（同事件 ×6、7 条伏笔循环 ×6），平铺注入等于把预算花在重复行上。
- **章节列表并集**（`ui/project-utils.ts`）：新增 `ChapterListEntry`（`file: TFile | null`、`hasBody`），`getChaptersForProject` 在正文扫描后追加 `TFolder` 骨架扫描（`03-大纲与章节/步骤结果/第N卷/第M章`）；去重键为章名，正文优先。顶部下拉 `value` 允许空路径、项目卡片「N章」改为并集口径，「已完稿 X/Y」仍只统计正文完稿。
- **骨架章可打开**（`ui/full-writer/title-bar-controller.ts` / `tab-controller.ts` / `project-selector-controller.ts` / `full-writer-view.ts`）：`selectChapter` 的 `file` 放宽为 `TFile | null`，下拉空路径不再提前 return；`newTab.file = file ?? undefined`。`quality-dashboard-modal.ts#scanChapters` 过滤无正文者，避免空 `TFile` 参与评分。
- **关联引擎**（新增 `engine/story-linkage.ts`）：`parsePlannedRange` 把「计划回收」解析为章号区间（`第6章` / `第6-8章` / `第6章前后` / 待定），`classifyForeshadow` 产出 due/overdue/upcoming/later/unknown；伏笔按名称、时间线按 `事件|时间|章节` 去重并给出 warnings（只提示不改原文件）；设定条目 = 设定库/世界观标题 + 人物/地点/势力/物品名（通用标题如「与主线关联」不计入）；分卷大纲裁剪到本章段落。输出 `promptText` ≤1800 字。
- **关联看板**（新增 `ui/story-linkage-modal.ts`，命令 `novel-writer-story-linkage`）：章节下拉含骨架章、摘要 chips、到期/逾期/即将到期伏笔表（含关联设定与规划定位）、本章时间线、全书规划定位、数据质量提示；「🔄 重新扫描」「✍️ 回写关联索引」（二次确认）；`min(860px,92vw)` + 76vh 滚动 + 640px 响应式。注册点：`shared/command-ids.ts`、`core/command-registry.ts`（定义/UI 列表/命令面板）、`ui/command-ui-executor.ts`、`tool-catalog` 审查与优化组 + 章节快捷工具条。
- **可见输出**（`engine/context-readiness.ts` / `ui/full-writer/context-loader-controller.ts`）：上下文清单新增第 18 项「关联索引（伏笔/时间线↔设定/规划）」，详情 `到期 N · 逾期 M · 设定 K 条 · 规划 J 段（W 条数据提示）`；`loadContext` 在 gather 后写入 `data.story_linkage`，失败不影响必做判定。
- **Prompt 去重**（`engine/ai-types.ts` / `ai-prompt-builder.ts` / `ui/write-chapter-modal.ts`）：`ChapterContext.storyLinkage` 非空时注入 `【关联索引】` 并跳过 `【未揭示伏笔】`/`【时间线事件】`；为空时保持旧平铺。
- **回写**（新增 `engine/story-linkage-writer.ts` + `ContextManager#writeStoryLinkageIndex`）：只替换 `NW-LINKAGE:BEGIN/END` 标记块，无标记则追加；重复回写字节级一致。解析前 `stripLinkageBlock`，防止回写表格被再次解析成事件（实测无该保护时二次回写不幂等）。
- **时间线兼容**（`engine/context-manager.ts#parseTimelineContent`）：同时支持 7 列富表与真实项目在用的 4 列简表（`时间 | 对应章节 | 事件 | 影响`）；修复此前 4 列表格被整块读成 0 条、关联永远为空的问题。
- 新增测试：`chapter-list-all.test.ts` 7 例、`story-linkage.test.ts` 20 例、`story-linkage-writer.test.ts` 9 例、`ai-prompt-linkage.test.ts` 4 例、`timeline-parse-4col.test.ts` 4 例；`context-readiness.test.ts` +2 例、`command-registry.test.ts` 追加新命令 id。
- 真机验证（Obsidian CDP）：`九霄逆脉行` 章节下拉 400 项（400 个骨架目录全部有正文，去重后仍 400）；临时探针项目仅骨架目录 → 返回 1 条、`file===null`、`hasBody=false`；第6章关联索引 到期 1 / 逾期 2 / 设定 4 条 / 规划 1 段（重复告警 30 条伏笔记录、15 条时间线事件）；上下文页显示「关联索引（伏笔/时间线↔设定/规划）· 到期 1 · 逾期 2 · 设定 4 条 · 规划 1 段（3 条数据提示）」；连续两次回写伏笔库/时间线看板字节一致、各仅 1 个标记块。
- 验证：全量 **327 文件 / 4216 用例**通过；`typecheck` / `lint` 通过；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功，`dev:errors` 无错误。

**183. 关联看板章节选择器 DOM 化 + 弹窗宽度修正（Rev 187）**

- **动因**：用户反馈关联看板的章节选择器无法切换章节。CDP 实测事件绑定（`select.onchange`）与 `scan()` 刷新逻辑本身正常，问题出在原生 `<select>` 交互层与弹窗布局：①400 章全部塞进原生下拉，长列表在部分主题/缩放环境下点击选项不生效；②`width: 92vw/max-width: 860px` 加在 `contentEl` 上，Obsidian 的 `.modal` 仍为 560px，内容横向溢出、出现横向滚动条，窄窗口下选择器可能被裁到面板外。
- **章节选择器**（`ui/story-linkage-modal.ts`）：原生 `<select>` 替换为 DOM 自绘下拉——触发按钮显示「第N章 · 标题 ✅/📝」，点开为搜索框 + 400 行章节列表（`max-height: 300px` 滚动）；点击行即切章并重新扫描，当前章高亮，无匹配显示「未匹配到章节」；Esc / 点击面板外部关闭；搜索框回车选中首条匹配。彻底不依赖原生弹窗。
- **切章竞态**：`scan()` 增加 `scanSeq` 序号，切章后晚到的旧结果直接丢弃，避免慢请求把看板覆盖回上一章内容。
- **弹窗宽度**（`styles.css`）：宽度从 `contentEl` 移到 `this.modalEl`，CSS 改为 `.modal.novel-writer-linkage-modal`（640px 媒体查询同步）；实测 `.modal` 860px、内容 826px、`scrollWidth === clientWidth`，横向溢出归零。
- 新增样式：`.novel-writer-linkage-picker/-chapter-panel/-chapter-search/-chapter-list/-chapter-item`（含 `is-current`、空态）；窄屏面板 `max-width: 70vw`。
- 真机验证（Obsidian CDP）：真实鼠标点击按钮展开 400 行、搜索「156」仅剩 `第156章 📝`、点击行后按钮与六分区同步更新（第400章 → 第156章正文内容变化）、点击面板外部关闭且不改章；`dev:errors` 无错误。
- 验证：`typecheck` 0 错；全量 **327 文件 / 4216 用例**通过（基线不变）；守卫 66 / 54 / 9 / 2 无新增；`build` v4.11.0；`plugin:reload` 成功。

**184. 关联看板同章点击补扫（Rev 188）**

- **动因**：用户反馈「章节选择器点击后未自动扫描」。CDP 定位：点击**当前已选中**的章节行时，`selectChapter` 的 `entry.chapter === this.chapterName` 提前 return，`buildStoryLinkage` 调用计数为 0；点击不同章节时计数为 1、六分区正常刷新。
- **修复**（`ui/story-linkage-modal.ts`）：删除同章提前返回——任何章节行点击（含当前章）都关闭面板、同步按钮文本并调用 `scan()` 重新扫描；「重新扫描」不再是查看最新数据的唯一入口。
- 真机验证（Obsidian CDP）：点击当前章 `第400章` 后 body 立即进入「扫描中…」并重新渲染；点击 `第6章` 同样立即扫描，正文为第6章内容（到期 1）；`dev:errors` 无错误。
- 验证：`tsc` 0 错；全量 **327 文件 / 4216 用例**通过；`build` v4.11.0；`plugin:reload` 成功；守卫无新增（本次仅 UI 逻辑，无 import 变化）。

**185. 保存设置后第一章布局塌陷修复（Rev 189）**

- **动因**：用户反馈「进入项目与章节界面右上角 ⚙️ 设置 → 保存后，第1章界面排版错乱」。
- **根因**（CDP 复现）：`MiniSettingsModal.saveAllSettings()` → `plugin.refreshFullWriterContextPanel()` → `EntityStateController.refreshContextBar()` 移除的选择器是 `.novel-writer-fw-context-card`，该 class 全库无任何创建点（等于空操作）。旧 `.novel-writer-fw-context-panel` 未删，`ContextPanel.render` 又追加一个新面板，`.novel-writer-fw-workspace` 从 3 个 grid 子元素变 4 个，`grid-template-rows` 从 `702px` 变 `0px 692px`，阶段导航被压到第二行，第一章整体塌成一条缝。
- **修复**（`ui/full-writer/entity-state-controller.ts#refreshContextBar`）：移除选择器改为真实类名 `.novel-writer-fw-context-panel`。
- 新增回归测试 `tests/unit/ui/entity-state-context-refresh.test.ts`（2 用例）：锁定查询的选择器、`render` 恰好一次、workspace 缺失时不渲染且不抛错。
- 真机验证（Obsidian CDP）：第1章基线 `children=3 / panels=1 / rows=702px / cols=159.995px 1311.21px 239.985px`；真实点击「⚙️ 设置」→「💾 保存设置」两次（含幂等），保存后保持 3 子元素 / 1 面板 / 单行 grid，prompt 区 1311×702；`dev:errors` 无错误。
- 验证：`tsc` 0 错；全量 **328 文件 / 4218 用例**通过；`build` v4.11.0；`plugin:reload` 成功。

**186. 关联索引弹窗布局重排（Rev 190）**

- **动因**：用户反馈「关联索引造成了重叠，需要重新调整，方便显示」。CDP 实测：章节选择浮层 340×354 与正文区垂直重叠 322px；窄窗口下时间线表在 auto 布局中把「章节 / 涉及实体」列压到 1–5 字宽，文字竖排、整表难读。
- **重排**：
  - 章节选择面板由 `position: absolute` 浮层改为 header 内流内全宽展开（`width: 100%`、列表限高 200px）；展开时正文整体下移，任何内容都不被遮住；外部点击判断同步覆盖面板自身，点列表不会被误判为外部点击（`ui/story-linkage-modal.ts`）。
  - 弹窗内容区改纵向 flex（`max-height: 84vh`）：标题 / 摘要 / 选择区与底部按钮固定，只有正文滚动。
  - 表格 `table-layout: fixed` + 按列百分比宽度（伏笔 6 列 / 时间线 5 列）+ `overflow-wrap: anywhere`，长文本换行不再挤压其他列。
  - 六个分区改为卡片（背景 / 边框 / 圆角 / 内边距），表头底色改用 `--background-primary` 与卡片区分。
- 真机验证（Obsidian CDP）：面板 `position: static`、宽 814px、底边 430px < 正文顶 440px（gap 10px、重叠 0）；列表 200px；正文自动缩到 540px 并内部滚动；footer 距视口底 64px 常驻可见；时间线列宽 124 / 70 / 279 / 155 / 147（不再竖排）；搜索「156」400→1 项、Enter 切章立即「扫描中…」、点击当前章重扫、外部点击关闭选择区；`dev:errors` 无错误。
- 验证：`tsc` 0 错；全量 **328 文件 / 4218 用例**通过；`build` v4.11.0；`plugin:reload` 成功。

**187. 关联索引章节列表压扁修复（Rev 191）**

- **动因**：用户反馈 Rev 190 后「还是存在重叠」。重新定位：不是面板遮挡，而是**章节列表项被 flex 压扁**。实测列表项高度仅 12px（`padding: 6px 8px` + 15.6px 行高本应约 28px），400 项在 `display: flex; flex-direction: column; max-height: 200px` 的列表里按默认 `flex-shrink: 1` 被压缩，每行只剩一条 12px 高的文字横条，视觉上互相重叠。
- **修复**（`styles.css`）：`.novel-writer-linkage-chapter-list` 去掉 `display: flex` / `flex-direction: column`，恢复块级布局、由容器滚动；`.novel-writer-linkage-chapter-item` 增加 `flex: 0 0 auto` 作为双保险。
- 真机验证（Obsidian CDP）：列表项高度 12px → **28px**、宽 785px、单行完整显示「第1章 · 九脉逆行 ✅」；400 项 `scrollHeight > clientHeight` 可滚动；列表裁剪截图确认文字横排不重叠；搜索「156」400→1 项、Enter 切章立即「扫描中…」；正文与底部按钮位置不变（footer 距视口底 64px 常驻）；`dev:errors` 无错误。
- 验证：全量 **328 文件 / 4218 用例**通过（仅 CSS 改动，构建与守卫不变）。

**188. 设定与实体模块排版与数据层优化（Rev 192）**

- **动因**：用户反馈「优化章节选择器排版；优化 AI 世界元素生成器排版问题以及功能问题；快捷工具的设定与实体模块需要整体优化前端/后端/数据/引擎」。
- **根因（排版）**：
  1. AI 世界元素生成器的 **66 个 `novel-writer-ai-builder-*` 类在 `styles.css` 中零定义**，浏览器按默认 block 渲染：项目卡片塌成一列窄条、统计项竖排、进度条不可见、按钮错位。
  2. 「所有章节」弹窗只有按钮本身有样式，容器无网格/搜索/分组；400 章平铺成零散按钮，且调用方传入顺序未排序（第3卷排在第1卷前）。
- **前端修复**：
  - `styles.css` 补齐 AI 生成器全量样式：项目矩阵 `repeat(auto-fit, minmax(300px, 1fr))`、卡片头部/进度条/五项统计横排/操作按钮、仪表盘 `repeat(auto-fill, minmax(260px, 1fr))`、空态、世界观状态条、表单；窄屏单列。
  - 「所有章节」弹窗加宽到 960px，新增搜索框、✅/✏️/📝 图例、按卷分组（卷标题 sticky）、自适应网格（150px 起）、62vh 滚动容器与空态；`showAllChapters` 内部先 `sortChaptersByNumber`，修复第3卷排最前、卷内章号乱序。
- **数据层**：新增 `shared/entity-stats.ts#countProjectEntities`，统一「世界观文件 = 1；人物/势力/地点/物品 = 目录 `.md` 数」口径；AI 生成器删除自带的文件计数实现并接入。
- **功能/引擎修复**：
  - 人物批量：记录失败批次数，全部批次失败时明确 `❌` 提示（原只写日志）；`saveGeneratedContent` 解析到 0 张角色卡时不再误报「已保存 0 个」。
  - 单项目仪表盘不再显示无效的「← 切换项目」按钮（仅多项目可见）。
- 真机验证（Obsidian CDP）：AI 生成器项目矩阵 2 列（每卡 626px）、统计 5 项各 112px 横排、按钮 32px、仪表盘 4 列（307px）、表单 640px；章节弹窗 960px、5 列 × 176px、400 按钮高 52px、3 卷分组顺序 1→2→3、搜索「156」筛到 1 项；`dev:errors` 无错误。
- 验证：`tsc` 0 错；全量 **328 文件 / 4218 用例**通过；`build` v4.11.0；`plugin:reload` 成功。

### 指纹 V2 上线 / 维度治理 / 知识检索改原文

#### 🧭 动因
- `StyleVectorStoreV2` 写完后只有测试引用，生产仍是 V1 7 维：12 维特征在加载时被统一转回 V1，等于「加载即降级」。
- 指纹强度配置（`projectFingerprintIntensityFile`）存了、读了，但从未传给 `TieredInjectionBuilder`，强度对 prompt 完全不生效。
- 换 embedding 模型后，旧向量与新查询向量混算会得到无意义的高相似度，且没有隔离与重建提示。
- 知识库向量此前切的是「拆解报告 JSON/Markdown」，注入给模型的是分析文本而不是原文。

#### ✨ 改动

**1. 12 维指纹真正上线（`engine/style-fingerprint-library.ts`）**
- 加载时额外保留磁盘上的 V2 `V2Fingerprint`（`v2Fingerprints`），不再只有 7 维 V1 视图；新增 `getV2Fingerprint` / `listV2Fingerprints`。
- 生产接入 `StyleVectorStoreV2`：新增 `getFingerprintVectorsV2`、`buildV2VectorsForFingerprint`、`searchSimilarStylesV2`（12 维加权检索）、`searchByDimensionV2`（单维检索）、`rebuildAllV2StyleVectors`。

**2. 指纹强度真正生效（`engine/style/dynamic-injection-engine.ts` / `engine/prompt-builder.ts`）**
- `PromptBuilder.getFingerprintPromptParts` 组装强度配置 Map 并传入 `TieredInjectionBuilder.build`。
- `buildGlobalTier` 按每个指纹的 `descriptionLength` 截断描述、强度 0 完全禁用；`buildParagraphTier` 按 `sampleCount` 限制示例条数。未传配置时行为不变。

**3. 维度治理（`engine/style/style-vector-store-v2.ts`）**
- 向量文件新增 `modelId` / `dimensionCount`。
- 加载时若记录的 `modelId` 与当前 embedding 模型不一致：写入 `.mismatch.bak` 隔离、从索引移除、记录到 `getModelMismatches()`，供 UI 提示重建；旧文件无 `modelId` 时按兼容策略加载。

**4. 知识检索改原文分块（`services/knowledge-original-chunker.ts` / `services/deconstruction-scheduler.ts` / `engine/knowledge-vector-store.ts` / `engine/prompt-builder.ts`）**
- 新增 `chunkOriginalText`：按段落拼装到 400 字、超长硬切、单本最多 120 块并均匀采样；阈值集中在 `shared/thresholds.ts`。
- `vectorizeBook` 优先读取 `getSourceText` 原文分块（`dimension: 'original'`），原文缺失时才回退旧拆解报告样本。
- `KnowledgeVectorStore` 新增 `replaceBookSamples`，重新拆解替换整本向量，避免旧报告样本与新原文叠加膨胀。
- 协同 prompt 新增 `【写作知识库 - 原文片段】` 块（原文单独检索 topN=3，避免挤掉风格/节奏/技巧结果）；`KnowledgeInjector` 的文风注入也纳入 `original` 维度。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 **198 文件 / 3341 用例**通过。
- 新增用例：V2 加载保留 12 维与 V2 检索 3 例、强度截断/禁用 4 例、modelId 隔离 4 例、原文分块 6 例、replaceBookSamples 2 例。
- 尚未运行时复测：真实项目加载 12 维指纹、换 embedding 模型后的隔离提示与重建、重新拆解后的原文向量检索。**发布前必须补测**。

### 协同取消链路 / 本地窗口预算裁剪

#### 🧭 动因
- 联想（B1）与迭代（B2）没有任何 `AbortSignal`：切章、关闭视图后请求仍在跑，结果虽被代次守卫丢弃，但仍占用本地模型单槽，后续生成被排队拖慢。
- 协同 prompt 只给单个片段设字符上限，叠加后仍可达 2 万字：本地未登记模型（8192 窗口）下 Ollama 直接硬截断，模型看到的是被腰斩的设定与上下文。

#### ✨ 改动

**1. 取消链路补全（`engine/co-writer-engine.ts` / `ui/services/co-write-facade.ts` / `ui/co-writing-view.ts` / `ui/co-write-floating-panel.ts`）**
- `suggestAssociation(..., signal?)` 与 `iterateSuggestion(..., signal?)` 接入中止信号，并透传到 `callCoWriteAI` / `callCoWriteAIStream`。
- 联想逐方向循环、迭代调用前后均检查 `signal.aborted`，中止后不再发起新的模型调用。
- 主视图联想 / 迭代 / 自动联想（ghost）与建议共用 `suggestAbortController`，因此「切章 / 关闭视图 / 新请求接管」都能真正取消在途调用；复位时校验 controller 归属，避免覆盖接管后的新请求状态。
- 浮窗联想同样接入，关闭浮窗即中止。

**2. 按模型窗口裁剪协同上下文（`shared/prompt-budget.ts` / `engine/prompt-builder.ts`）**
- 新增 `assemblePromptWithinBudget`：按整段 prompt 的 token 预算装配，片段优先级 节点推进(100) > 章节简报(95) > 角色状态(90) > 叙事驱动(60) > 伏笔提醒(55) > 缓存上下文(40) > 知识库(25) > 指纹/记忆(20)。
- 保留策略：优先级低的先动；可截断片段（memory/knowledge/drivers/soul/context）先按 token 二分截断，不够再整段丢弃；`【已写内容】`/`【写作方向】`/收尾指令为必保片段，任何预算下都不裁剪。
- `buildSuggestionPrompt` 增加可选 `budget` 参数；不传时输出与改造前一致，存量调用与测试无感知。
- 引擎侧 `getCoWriteInputBudget()`：本地取 `min(模型能力表窗口, CO_WRITE_NUM_CTX)`，未登记本地模型走 8192 保守兜底；云端用能力表窗口；预留 `coWriteMaxTokens × 1.2` 给输出与估算误差。
- 发生丢弃/截断时输出一条 `[PromptBuilder] 协同 prompt 按预算裁剪` 日志（含估算 token、预算、被丢弃/截断的片段 key）。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 **193 文件 / 3322 用例**通过（新增 `prompt-budget` 8、`co-writer-cancel` 6）。
- 新增用例覆盖：预算内顺序不变、超预算优先丢弃低优先级、可截断片段优先截断、必保片段极小预算不被裁剪、aborted 联想/迭代不调用 AI、Signal 透传、8K/32K 预算取值、超长快照裁剪后落在预算内。
- 尚未运行时复测：真实 Ollama 8K 模型下连续协同、切章时在途联想/迭代的实际中断。**发布前必须补测**。

### 监控重建：质量评分单内核 / 阈值集中 / 历史跨会话

#### 🧭 动因
- 同一段正文在监控面板、协同写作、质量看板可能显示不同分数：`QualityScoreEngine` 虽接受 `v1Engine`，但从未使用，实际仍走自己的一套启发式规则。
- 色阶口径分裂：监控面板同一卡片内存在 70/40 与 80/60 两套着色规则。
- 质量历史只存在内存，切章即清空、重启即丢失，无法做跨会话趋势。

#### ✨ 改动

**1. 质量内核统一（`engine/quality/quality-score-engine.ts`）**
- 注入 `v1Engine` 时：总分直接取 `WritingQualityEngine.overallScore`，六维按固定映射取自 v1 六维（readability←语言、rhythm←节奏、emotion←氛围、characterConsistency←人物、coherence←情节、languageTexture←语言），不再并行跑两套规则。
- 未注入 `v1Engine` 时保留原有规则路径，避免影响存量测试与离线场景。
- 生产构造点全部注入 v1：协同写作 `RealtimeMonitor`、质量看板、重任务主线程、质量 Worker。

**2. 阈值与色阶唯一来源（`shared/thresholds.ts` + `shared/quality-grade.ts`）**
- 新增质量等级分界（90/80/70/60）、色阶分界（80/60）、偏离分界（60/30）、历史落盘上限（200）。
- `WritingQualityEngine.getGrade`、`getQualityGradeColor/Label`、`deviation-detector` 默认 severity、监控面板两套着色函数全部改为引用同一实现。
- 监控面板内 70/40 的旧色阶被移除（与 80/60 合并）。

**3. 质量历史跨会话（`shared/quality-history.ts` + `services/quality-history-store.ts`）**
- 落盘到 `项目/04-项目总控/质量历史.json`，与 `data.json` 解耦；最多保留 200 条，按时间去重排序。
- 解析对坏 JSON / 旧数组格式 / 越界分数全部容错。
- 监控面板切章前强制落盘、切章后从磁盘恢复，落盘默认 30 秒节流，避免编辑期每 500ms 写盘。

**4. 其他一致性**
- `getQualityTrendIcon/Label` 接受字符串并兜底 `stable`，磁盘恢复的历史记录可直接渲染。

**5. 协同写作验证闭环（`engine/co-writer-engine.ts` / `ui/co-writing-view.ts`）**
- `parseValidationResponse` 此前只去代码围栏、不剥 `<think>`：思考型模型必然解析失败，然后返回 `isValid: true` + 三项 70 分「默认通过」，等于校验从未生效。现统一为 `stripThinkingBlock → stripCodeFence → extractJsonObject`。
- 解析失败不再伪装成通过：返回 `degraded: true` + 0 分 + 可读原因，UI 显示「校验未完成（结果无法解析）」并隐藏分数卡，用户仍可选择继续使用。
- 通过线 60 分提取为 `EDIT_VALIDATION_PASS_SCORE`，与其它阈值同源。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 **191 文件 / 3308 用例**通过（新增 `quality-grade` 5、`quality-history` 10、`quality-history-store` 7、`quality-score-engine-unified` 4、`co-writer-validation` 5）。
- 新增用例直接断言「同一文本两引擎总分一致、六维映射一致」「思考前缀可解析」「解析失败必须 degraded」。
- 尚未运行时复测：Obsidian 内切章后趋势恢复、`04-项目总控/质量历史.json` 实际生成、思考模型编辑验证的真实返回。**发布前必须补测**。

### 本地模型适配 / 正式批量 N 章 / 协同与同人 P0 修复

#### 🧭 动因
- 插件对云端 AI 依赖过重：本地模型（Ollama 8K/4K 窗口）在长上下文下频繁截断、静默失败。
- 向导之后的「长篇生成」缺少一条正式链路：已有 `auto-writer` / `batch-chapters` / `continue-chapters` 三条简化链路绕过 11 步流程与 `BodyWriter`。
- 协同写作与同人项目存在若干「看起来在工作、实际结果错误」的缺陷（评分常数、阈值恒真、浮窗绕过落盘入口、同人文件定位失败）。
- 过程与决策记录见 [长篇小说 AI 演进与模块重建实录](https://my.feishu.cn/docx/MYZmdWOpYor5w8xu2encfSLNnAg) 与 `.trae/specs/long-novel-ai-evolution/spec.md`。

#### ✨ 改动

**1. 本地模型能力判定（`shared/model-capabilities.ts` / `shared/token-estimator.ts` / `core/provider-manager.ts`）**
- `lookupModelCapability()` 改为**最长键优先**匹配：`deepseek-r1:7b` 不再被子串 `deepseek-r1`（云端 64K）误判，命中 `deepseek-r1:7b`（32768/8192）。
- 新增 `LOCAL_FALLBACK_CAPABILITY`（8192 上下文 / 4096 输出）：本地端点未命中能力表时按保守值处理，不再回落到云端默认 128K。
- `findModelCapability(modelId, source)` 与 `getModelContextWindow/getModelMaxOutput(modelId, source)` 支持来源区分；`ProviderManager.resolveModelLimits(modelName, endpoint)` 按「用户覆盖 → 静态表 → 本地兜底 / 提供商预设 → 全局默认」取值。

**2. Ollama 原生调用与截断可观测（`engine/ai-api-client.ts`）**
- `/v1/chat/completions` 兼容层会丢弃 `num_ctx`：本地端点自动改写为原生 `/api/generate`，并在请求体 `options` 中默认下发 `num_ctx`（取该模型上下文上限）。
- 原生响应映射 `done_reason === 'length'` → `finish_reason: 'length'`，流式与非流式一致，截断不再被当成正常结束。
- 非流式 `callAI` 增加截断扩容的独立重试额度：本地 `maxRetries=1` 时扩容分支也能真正执行。
- `callAIStream` / 原生流式迭代器新增输入预算闸门：可用输入 < 512 token 时直接返回可读错误，避免把超长 prompt 硬塞给本地模型。

**3. 正式「批量 N 章」（`ui/batch-novels-modal.ts` / `ui/full-writer/batch-pipeline-runner.ts` / `ui/full-writer/batch-targets.ts`）**
- 新命令 `📚 批量生成章节（正式流程）`：逐章执行 信息规划 → 情节蒸馏 → 大纲摘要 → 情绪规划 → Scene 展开 → 正文 → 分析报告 → 结算。
- 与章节工作台共用同一套步骤定义、`getStepTemplateAuto` 模板、`StepRunner.executeCurrentStep`、`BodyWriter` 落盘与 `SettlementEngine` 结算，不再有第二套正文写法。
- 支持断点续跑（从磁盘恢复已完成的步骤结果）、取消、逐章/逐步骤进度展示与失败汇总。
- `BATCH_STEP_KEYS` 与 `buildBatchTargets` 拆到无依赖的 `batch-targets.ts`，单测不再触达 `main.ts`。

**4. 协同写作 P0 修复**
- `ui/co-writer-view.ts`：人工率不再用常数 75 冒充「风格分」，改为标记「未评估」并从总分权重中剔除。
- `engine/co-writer-engine.ts`：剧情节点完成度阈值由恒真改为「至少 30% 信号且不少于 1 个」。
- `ui/co-write-floating-panel.ts`：浮窗保存正文改走 `BodyWriter`，与工作台共用 frontmatter / 标题 / 格式契约。

**5. 同人规则注入与文档一致性**
- 新增 `shared/fanfic-rules.ts`：以 `.project` 的「## 同人设定路径」为权威来源，读取并解析「必须遵守的原作规则 / 允许改编的范围 / 禁止触及的红线」，格式化为最高优先级约束块；原创项目返回空串，模板填充后不留痕迹。
- `buildTemplateVars` 新增 `fanficRules` 变量，并注入 6 个步骤模板：信息规划、情节蒸馏、大纲摘要、情绪规划、Scene 展开、正文生成（V1 + V2）。
- `engine/ai-worldview-generator.ts`：同人世界观生成改为先读 `.project` 的「同人设定路径」，失败再回退文件名扫描，与保存侧一致。
- `engine/step-definitions.ts`：移除「路径 A 已废弃」等与现状矛盾的注释。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 **186 文件 / 3277 用例**通过（新增 `model-capabilities` 7、`batch-pipeline-runner` 5、`fanfic-rules` 12，扩充 `ai-api-client` 的 `num_ctx` / `done_reason` 用例）。
- 尚未完成运行时复测：批量弹窗在真实项目中连续生成、本地 Ollama 8K 窗口长章续写、同人项目 prompt 快照。**发布前必须补测**。

### 流程与数据结构约束收敛（向导之后的工序）

#### 🧭 动因
- 用户反馈：向导之后的工序新旧版本混用（整章草稿未走新流程）；前端流程显示混乱；AI 输出格式未约束，建议/联想不分段，且该问题不限于句级协同。
- 审计结论：同一仓库并存 5 套互相矛盾的正文格式契约、7 条独立正文落盘路径（frontmatter 处理有 4 种做法）、3 个步骤状态真相源（内存 / frontmatter / mtime）、5 阶段导航与 11 步定义各写一份 index。

#### ✨ 改动

**1. 正文格式契约唯一事实源（`shared/body-format.ts`）**
- 新增 `deriveBodyFormat()`：从项目 `00-系统模板/写作规则.md` 推导「段首缩进 + 段落分隔」，明确肯定式优先、禁止式次之、默认「空两格 + 单换行」。
- 新增 `normalizeBodyText()`：落盘前去 `<think>` / 元叙述 / 模型标题，统一换行与缩进；`trim()` 会吃掉全角空格（U+3000），已显式避免。
- 新增 `describeBodyFormat()`：prompt 里的格式说明由契约生成。`engine/prompt-builder.ts` 的建议 / 联想 / 改写三处不再手写互相矛盾的「Tab 缩进 + 禁止空行」。
- 格式契约已贯通全部正文类调用点，禁止再硬编码「空两格 / Tab / 空行」：
  - 整章草稿：`engine/ai-prompt-builder.ts`（`AIEngine.generateChapter*` 按 `context.project` 解析契约）；
  - 步骤流水线：`chapter-pipeline-prompts.ts`（V1）与 `body-v2-prompts.ts`（V2）改用 `${bodyFormat}`，由 `template-vars-builder` 注入；
  - 批量 / 自动 / 续写：`batch-chapters-modal`、`auto-writer-modal`、`continue-chapters-modal` 统一用 `describeBodyFormat()`；
  - 场景扩写：`outline-to-text-expander.ts` 的段落扩写与 `ai-scene-expander.ts` 的三条 prompt；
  - 场景正文循环：`scene-body-generator.ts#buildSceneBodySystemPrompt`。
- 新增 `splitParagraphsByContract()`：扩写结果按同一契约切分段落（`\n` 一句一段 / `\n\n` 空行分段），避免「提示要一句一段、解析只认空行」。
- `styles.css` 为建议卡、历史、流式、浮动面板补 `white-space: pre-wrap`：卡片是单文本节点，默认 `normal` 会把 `\n` 折叠成空格，导致「生成时分段、完成后变一行」。

**2. 正文落盘唯一入口（`engine/body-writer.ts`）**
- 新增 `BodyWriter.write()`，统一 4 条不变量：旧 frontmatter 原文保留（块列表 / 自定义字段不丢）、标题行由写入器生成、正文按契约规整、`status` 不降级（`settled` 保持）。
- 接入全部正文入口：协同写作 `saveBody`、步骤流水线 `bodyGeneration`、`writeFixToBody`、整章生成、自动写作器、批量写正文、续写。
- 删除各入口自带的 frontmatter 白名单 / 重建逻辑；`StepResultSaver.updateFrontmatterFields` 随职责迁移移除。
- 写盘后广播 `novel-writer:body-written`；`FullWriterView` 仅对当前章重新恢复状态并重渲染。

**3. 流程状态单一真相**
- `STREAMLINED_PHASES` 改为由 `ALL_FULL_STEPS` 派生，模块加载时检测未被覆盖的步骤；阶段点击改为「第一个未完成步骤」。
- 新增 `ChapterStateManager.invalidateSteps()`：同步维护 `stepCompleted / stepLevels / staleSteps`；`StepRunner` 与步骤保存按钮改用它，不再只删 `stepCompleted`。
- `stepFileMap` 补 `settlement → 结算表`，章节结算参与磁盘恢复；文件缺失时同步清理 `staleSteps`。
- `bodyGeneration` 取消 `deprecated + required` 矛盾标记；步骤 7 在有角色灵魂数据时经 `getStepTemplateAuto` 自动使用 V2 小说家模板。
- 正文生成步骤里的「AI 自动生成是 v5.0 旧模式」「与旧模式共享正文文件」等界面文案改为「同一正文文件 / 同一格式契约 / 同一落盘入口」，消除前端的新旧混用表述；`StepRunner` 头部注释同步改为新流程说明。

#### ✅ 验证
- `npm run typecheck` / `npm run build` 通过。
- 全量单测 183 文件 / 3251 用例通过（新增 `body-format` 14、`body-writer` 11、`flow-consistency` 9、`outline-to-text-expander` 5、`prompt-template-auto` 3）。
- Obsidian 运行时：阶段导航 5 项由定义派生；步骤 7 标题为「✍️ 正文生成」且无〔旧〕角标；建议卡四类容器 `white-space=pre-wrap`，双行探针高度 42px（真实换行）。

### 协同写作 AI 调用卡死修复（本地 / 云端）

#### 🧭 动因
- 用户反馈：协同写作里调用本地模型和云端模型都长时间停在「生成中」，没有出现场景建议。
- 云端证据（CDP + 网络计数）：`apiKey/providerKeys` 存的是 `aes256` 密文，却被当作 Bearer token 发出；401 后仍走 native → simulated → full 三段降级 × 3 次重试 × 3 个候选，20 秒内打出 15 次 401。
- 本地证据：3 个候选并行发往 Ollama（单机单槽）互相排队；一条 168 秒成功后其余超时中止再重试，队列越排越长，实测 16 分钟未返回。
- 启动证据：`data.json` 中有 3 个 `aes256v2` 密文，`loadSettings` 逐个解密各弹一次口令框；多个弹窗堆积并阻塞 `onload`，视图工厂与 47 个命令未注册，插件表现为「打不开 / 不能用」。
- 次因：`coWriteMaxTokens=320000`（默认 600）只按全局 131072 截断，本地 7B 单条生成被拖到 150 秒以上。

#### ✨ 改动

**1. AI 调用容错（`engine/ai-api-client.ts` / `main.ts`）**
- 请求前 `resolveApiKey` 解密密文；解密失败返回「API 密钥未解锁」并直接失败，不再把密文当 token 发送。
- 401/403 抛 `AIAuthError` 快速失败：不重试、不切换模型、不进入降级链。
- 本地端点：超时 ≥300 秒、重试 1 次；云端保持 `maxApiRetries ?? 3`。
- 流式读取改为「空闲超时看门狗」：响应头到达后不清除计时器，每个分片重置，避免半开连接永久挂起。
- 本地 Ollama 走 keyless 分支，跳过密钥解析，消除误导性的「密钥解密失败」告警。

**2. 本地候选串行（`engine/co-writer-engine.ts` / `ui/services/co-write-facade.ts`）**
- 本地模式即使 `candidateParallel=true` 也串行；云端仍并行。
- 串行循环每轮检查 `signal.aborted`，取消后不再发起后续候选。
- 新增 `suggestProgress`，串行时暴露「第 N/M 条」。
- 认证类错误提前终止后续候选，避免重复弹口令框 / 重复 401。
- 协同写作 maxTokens 兜底 `CO_WRITE_MAX_TOKENS_CAP = 2000`（`shared/thresholds.ts`），防止误填超大值拖死本地模型。

**3. UI 反馈（`ui/co-writing-view.ts`）**
- 本地模式显示「正在生成第 N/M 条建议…」，不再只显示笼统的「生成中」。
- 空结果优先展示引擎真实错误（超时 / 未解锁 / 401），不再误报「知识库未拆解」。
- `getFriendlyErrorMessage` 先判「未解锁」再判「取消」，修复提示串味。

**4. 启动不再被口令框阻塞（`core/crypto-service.ts` / `core/settings-service.ts`）**
- 新增 `decryptWithoutPrompt`：启动期只有存在会话口令时才解密 v2 密文，否则保留密文交给 `resolveApiKey` 按需解锁。
- `ensurePassword` 增加并发去重，多个密钥同时解密只弹一个口令框。

**5. 知识库检索超时（`engine/ollama-embedding-client.ts`）**
- `embed()` 增加 30 秒 AbortController 与外部 signal 转发，避免检索永久挂起。

**6. 本地思考型模型的思考段不再混入建议正文（`shared/api-response-utils.ts` / `engine/co-writer-engine.ts`）**
- 根因：Ollama 对思考型模型（deepseek-r1）会把 `<think>…</think>` 一并写进 `response`（流式与非流式都有），思考与正文共用 `num_predict`；不处理会把「好，我现在需要帮用户…」当成建议正文展示。
- 曾尝试 `think:false` 关闭思考：虽然 80 秒返回 3 条，但 R1 在关闭思考后输出明显退化（夹杂英文/拼音/markdown，如 `### 第一章·素 year`、`currentIndex`），质量不可接受，**已撤销**。
- 最终方案：保留思考，新增 `stripThinkingBlock` 在流式回调与最终结果处剥离思考段；无闭合标签时视为输出被截断，返回空而不是半截思考。
- 追加 `stripModelMeta`：模型仍在首段写「好的，我将按照您的要求续写…」、第二段写 `### 章节标题：…` / `【本章写作总计】`、末段写「这段描写…展现了…」。只处理首 3 段 / 末 2 段并限长，剥离后为空则退回原文。
- 追加 `isPlanningOutput`：R1 偶发整条输出「### 分析与规划 + 设定分析 + 解决方案」列表；改写时还会复述 `【A2 本章情绪曲线镀点】`、`step_status:`、`emotion_start:` 等元数据。此类候选直接丢弃（建议与改写两条链路），避免污染稿件。
- 协同写作正文链路统一走 `sanitizeStoryText = stripThinkingBlock + stripModelMeta`（建议 / 段落建议 / 迭代 / 续写）。

**7. 收窄协同写作上下文窗口（`shared/thresholds.ts` / `engine/co-writer-engine.ts`）**
- 不传 `num_ctx` 时 Ollama 按模型自身上下文（deepseek-r1=131072）分配 KV，显存吃紧导致 prefill 极慢。
- 实测同 8003 token prompt：`num_ctx=131072` prefill 104 秒；`num_ctx=32768` 55 秒。
- 新增 `CO_WRITE_NUM_CTX = 32768`，仅协同写作本地请求携带（prompt 约 8k-12k token，留足余量）；其他功能不受影响。

**8. 后台分析不再弹口令框（`engine/ending-traction-engine.ts` / `main.ts` / `engine/ai-api-client.ts`）**
- 证据（CDP 堆栈）：打开章节时 `EndingTractionEngine.parseThreadsWithAI` 走云端端点，密文密钥触发 `decryptKey` → 口令弹窗，打断协同写作。
- 新增 `allowKeyPrompt`（默认 true）；`main.ts` 新增 `decryptKeyWithoutPrompt`；情节线 AI 解析传 `allowKeyPrompt:false`，未解锁时静默失败并跳过该兜底解析。

**9. 生成期间按钮文案不被重渲染覆盖（`ui/co-writing-view.ts`）**
- `updateStartButtonState` 在 `isSuggesting` 时直接返回，避免保存/切章触发的重渲染把「⏳ 生成中...」改回「✍️ 生成开头」。

**10. 网络层不可达快速失败（`engine/ai-api-client.ts`）**
- 根因证据：mock 端点缺 CORS 头时，3 候选 × 2 模型 × 3 重试 × 降级链打出 **55 次请求**，界面长时间停在「生成中」。
- `Failed to fetch` / `fetch failed` / `ECONNREFUSED` / `ENOTFOUND` 属于网络不可达，同一端点上重试和切模型都不会自愈。新增 `isUnreachableError`，在 callAI / callAIStream / nativeStreamIterator 三处直接返回「无法连接模型服务（endpoint）」。
- 实测：停掉云端端点后 **8 秒失败**，不再反复轰炸。

**11. 后台保存不再弹加密口令框（`core/settings-service.ts`）**
- 证据（CDP 堆栈）：`activateCoWritingView → saveSettings → encryptIfPlain → CryptoService.encrypt → ensurePassword(true)`，打开协同写作视图就弹「设置密钥加密口令」，打断写作。
- 修复：`encryptIfPlain` 仅在已有会话口令时加密，否则保持明文返回；已有密文仍原样保存，不会二次加密。

**12. 主按钮「生成开头」也过滤分析/规划候选（`engine/co-writer-engine.ts`）**
- 运行时复测发现：`✍️ 生成开头` 走的是 `suggestNext → generateDirectionalCandidate`，此前只做了 `sanitizeStoryText`，没有 `isPlanningOutput` 判断；R1 首个 `action` 候选整段输出「#### 世界观底层规则 / 1. 物理法则 / 2. 时空特性 / 核心设定」，被当成场景建议展示。
- 修复：`generateDirectionalCandidate` 在返回候选前复用 `isPlanningOutput`，命中即丢弃该方向并记录 `lastSuggestError`；与 `suggestStream` / `suggestParaStream` 行为一致。部分方向被丢弃时其余候选照常展示，全部被丢弃时面板显示「生成失败 / 模型输出的是分析/规划而非正文」。
- 新增单测：`isPlanningOutput` 覆盖整段设定库泄漏（R1 实测文本），`suggestNext` 覆盖「1 个方向输出规划文本 → 只返回其余 2 条」。

**13. 建议面板被 CSS 永久隐藏（`styles.css`）**
- 证据：生成成功时 `currentSuggestions.length=3`、DOM 有 3 张卡片、`coWriteSuggestionPanelVisible=true`、center 无 `is-panel-collapsed`，但 `.nw-cowrite-suggestions-panel` 的 computed `display` 恒为 `none`，`getBoundingClientRect()` 宽高为 0。
- 根因：规则里硬写了 `display: none`，全文件没有任何规则把它改回 flex/block。
- 修复：改为 `display: flex`；显隐唯一入口保留为 `.nw-cowrite-center.is-panel-collapsed`。

**14. 思考型模型吃满输出预算导致正文为空（`engine/ai-api-client.ts` / `shared/thresholds.ts`）**
- 证据（SSE 抓包 5 次）：`reasoning_tokens` = 1462/2000/262/2000/942，`completion_tokens=2000`，`finish_reason=length`，其中 2 次 `delta.content` 为 0 字符。客户端只累加 `delta.content`，于是判为「AI流式返回为空」并进入三段降级。
- 修复：`callAI` / `callAIStream` / `nativeStreamIterator` 三处识别 `finish_reason=length`，在同模型上限内扩容（≥8192）重试一次；流式同时收集 `delta.reasoning_content`（只用于判断，不并入正文）；错误文案区分「思考占满预算」与「模型无输出」。
- `CO_WRITE_MAX_TOKENS_CAP` 由 2000 提到 8192：思考与正文共用同一份预算，硬顶 2000 时正文必为空。

**15. 完成度 JSON 恒解析失败（`shared/api-response-utils.ts` / `engine/co-writer-engine.ts`）**
- 证据：`Unexpected token '<', "<think>…"`、`Unexpected non-whitespace character after JSON at position 287`，面板恒 0 并持续刷警告。
- 修复：新增 `extractJsonObject`（```json 围栏 → 花括号平衡扫描，正确处理字符串内 `{}` 与转义），`parseEvaluationResponse` 先 `stripThinkingBlock` 再提取。
- 正文 <200 字时直接返回节点进度，不再为空章节发送 ~9.6k token 的评估请求。

**16. 向量化输入超长报 HTTP 500（`engine/ollama-embedding-client.ts`）**
- 证据：`{"error":"the input length exceeds the context length"}`；`bge-m3` 实测输入 2348 字符通过、2383 报错，`options.num_ctx` 无效。
- 修复：输入截断到 2000 字符后再请求，精准模式的风格相似度不再降级为 `unchecked`。

**17. 结局牵引面板恒为空（`engine/ending-traction-engine.ts` / `ui/monitor-panel-b.ts` / `ui/co-writing-view.ts`）**
- 证据：3 个分卷大纲（31607 字符）全部读取成功，但 `parsePlotThreads` 返回 0 条；`threads.size=0`。
- 根因 A：`parseThreadsWithAI` 直接 `JSON.parse` 模型输出，思考型模型的 `<think>` 前缀/围栏导致必然抛错，catch 后返回空数组。
- 根因 B：模型回退写死为字面量 `'flash'`（4 处），云端返回 400 `The supported API model names are deepseek-flash...`。
- 根因 C：`MonitorPanelB` 用 activeFile 推导项目名，协同写作视图不是 Markdown 文件 → 空字符串 → 用空项目初始化引擎。
- 修复：新增 `extractJsonArray`（同源平衡扫描）；模型回退改为 `flashModel || defaultModel`，均为空则跳过 AI 解析；新增 `setTractionProject()` 由协同写作视图注入项目名，并在「首次解析为空」时允许重试一次。

**18. 保存会清空章节元数据并丢失 H1 标题（`ui/co-writing-view.ts`）**
- 证据：保存后 frontmatter 的 `涉及人物` / `涉及地点` / `涉及势力` / `涉及物品功法` 从块列表变成 `""`，H1 从 `# 第1章 九脉逆行` 变成 `# 第1章`。
- 根因 A：`saveBody` 用逐行正则解析 YAML，块列表（`涉及人物:\n  - 沈砚`）被解析成空字符串，随后又写回。
- 根因 B：`getStepFilePath` 文件名漏了 `第N章_` 前缀（`.../第1章/信息规划.md` vs 实际 `.../第1章/第1章_信息规划.md`），`getChapterTitle` 恒为空。
- 修复：改用 Obsidian `parseYaml` 解析 frontmatter；空字符串不参与回填；`getStepFilePath` 与 `pjStepFile` 规范对齐；标题解析兼容 `**章名**：X` 格式。

#### 🧪 验证
- `npm run typecheck`、`npm run build` 通过；全量单测 **178 文件 / 3209 用例**全部通过（新增 `extractJsonArray` 4 例、`EndingTractionEngine.parseThreadsWithAI` 3 例）。
- 本轮受控复验（重载插件后只统计新日志，Chromium CDP）：
  - 云端 `deepseek / deepseek-flash`（`coWriteMaxTokens=2400`）：**32–72 秒**返回 3 条；`currentSuggestions=3`、DOM 卡片 3 张、面板 `display=flex`、**537×850 可见**、45 秒内不消失、`lastSuggestError=null`。
  - 本地 `deepseek-r1:7b`：**192 秒**返回 3 条，面板同样 537×850 可见、30 秒内不消失。
  - 重载后新日志中不再出现 `AI流式返回为空` → `模拟流式失败` → `AI返回为空` 的连锁降级，也不再出现 `Unexpected token '<'` / `Unexpected non-whitespace` / `embedding HTTP 500` / `模型: flash 400`。
  - 结局牵引：3 个分卷大纲 31607 字符 → **13 条情节线**（`threads.size=13`），面板不再为空。
  - 章节保存：`涉及人物/地点/势力/物品功法` 4 个块列表 20 条记录全部保留；H1 恢复为 `# 第1章 九脉逆行`；`word_count=4834`。
  - 测试后配置保持用户原值：`coWriteModelMode=cloud`、`coWriteCloudModel=deepseek-flash`、`coWriteModel=deepseek-r1:7b`、`coWriteMaxTokens=2400`；第 1 章 4834 字正文未被覆盖。
- 历史运行时记录（插件 4.11.0）：
  - 密文密钥 + 云端：点击建议 **0 次网络请求**，面板显示「API 密钥未解锁」，4 秒内结束。
  - 本地串行（`qwen2.5:7b`）：同一时刻仅 1 个 `/api/generate` 连接；3 条建议约 105 秒完成，状态「3 条建议」。
  - 本地 `deepseek-r1:7b`（保留思考 + `num_ctx=32768` + 清洗）：**96 秒返回 3 条**，`thinkTags=0`，首尾无「好的，我将…」/「这段描写…」，0 口令弹窗；`ollama ps` 显示 `CONTEXT=32768`。
  - 最新构建复测：本地 R1 **164 秒返回 3 条**（串行 3 方向），3 条均为叙述文本；首轮曾出现的「世界观底层规则」规划候选已由第 12 项过滤（单测锁定），不再进入卡片。
  - 云端 OpenAI 兼容（本地 mock 桩，带 CORS）：**2 秒返回 3 条**，恰好 3 次 POST + 3 次 preflight，`Authorization: Bearer test-key`，`stream:true`；最新构建复测 **7 秒返回 3 条**。
  - 云端不可达（停掉 mock）：**8 秒失败**，提示「无法连接模型服务（…）：Failed to fetch」；修复前同样场景会打出 55 次请求并长时间停在生成中。
  - 口令弹窗：重载 → 打开视图 → 打开章节全程 **0 弹窗**。根因是 `activateCoWritingView` 触发 `saveSettings → encryptIfPlain → encrypt → 要求设置口令`；现在无会话口令时保持明文保存，不主动弹窗。
  - 取消：4 秒内 `isSuggesting=false`、状态「已取消」、按钮恢复可用。
  - 联想 1 条、改写 3 条（description/emotion/dialogue）、接受建议写入正文、扩写弹窗打开均正常。
  - 重载后插件完整初始化：视图工厂已注册、47 个命令可用、无残留口令弹窗。
  - 测试后恢复用户配置：`coWriteModelMode=local`、`coWriteModel=deepseek-r1:7b`、云端 `deepseek / deepseek-flash`；移除 mock 供应商与密钥；第 1 章正文保持空（`word_count: 0`）。

### 协同写作承接规划成果与冷启动修复

#### 🧭 动因
- 进入句级协同写作后「看不到上一步生成了什么」：左栏只有空预览，`snapshot.allChars` 仅 35 字符（只有名字），`allLocs/allFactions/allItems` 退化为 `"："`。
- 正文为空时 `handleTabSuggest` / `handleAssociationSuggest` 直接拦截，新章节无法从规划开始写；引擎其实已支持「本章开头」分支。
- Scene 展开 6445 字符被 `slice(0,3000)` 截断，当前场景的 8 要素经常被丢掉。
- 「✍️ 智能扩写编辑器」切换 整章/场景/段落 模式时只追加标题栏不删除，运行时复现 header 数 `1 → 2 → 3`，底栏被推到弹窗底部（截图 bug）；正文为空时扩写来源为空，左栏场景列表恒为空。

#### ✨ 改动

**1. 章节简报 `engine/chapter-brief.ts`（新增，纯函数）**
- `buildChapterBrief` 从 `Scene展开 / 情绪规划 / 信息规划 / 大纲摘要+情节蒸馏 / 正文` 构建 `ChapterBrief`：`scenes[]`、`currentScene`、`otherScenes`、`outlineSummary`、`infoRelease`、`writtenWords`；情绪优先取情绪规划，缺失时用 Scene 的 `emotion_arc` 兜底。
- `resolveSceneIndex` 按各场景 `word_count` 预算定位当前场景；`buildBriefPromptParts` 完整注入当前场景 8 要素 + 情绪曲线，其余场景只给一行索引。
- `formatEntityBrief` 做真实字段映射（`姓名/名称`、`人物背景/描述`、`当前状态`、`身份`、`tags`），修复实体总览为空。

**2. 引擎承接与提示词（`engine/co-writer-engine.ts` / `engine/prompt-builder.ts`）**
- 新增 `setChapterBrief / getChapterBrief / setCurrentSceneIndex`；`updateSnapshot` 随正文重算场景进度，手动选定场景不被覆盖；切章清空简报。
- `buildSnapshot` 四类实体摘要改用 `formatEntityBrief`，字段完全不匹配时保留原始内容，不再输出 `"："`。
- `buildSuggestionPrompt / buildAssociationPrompt` 支持 `briefParts`；有简报时跳过 `chapPlan / sceneExpansion` 整段注入（避免 3000 字截断丢当前场景），无简报时行为不变。
- 空正文生成时若剧情节点为空，用当前场景 `objective/conflict` 作为推进目标。

**3. 协同写作视图（`ui/co-writing-view.ts` / `ui/services/co-write-facade.ts`）**
- `openChapter` 从磁盘读取 6 个规划文件 → `setChapterBrief` → `renderAllPanels`，不再依赖 `_workbenchState`。
- 左栏新增「本章简报」：大纲摘要、场景列表（已完成 ✅ / 当前 ▶ / 未写 ·，可点击切场景）、当前场景卡（目标/冲突/感官/记忆/身体/潜台词/关系/名场面 + 情绪 + 钩子）、信息释放。
- 空正文 + 有规划时放行建议/联想；主按钮显示「✍️ 生成开头」；无规划时提示先完成步骤 6。
- `saveBody` 按 `validateStepResult('bodyGeneration')` 同步 `step_status/status`，返回工作台时正文步骤状态与磁盘一致。

**4. 智能扩写弹窗（`ui/outline-expand-modal.ts`）**
- 切换模式时先 `headerEl.remove()` / `footerEl.remove()` 再重建并 `prepend`，标题栏数量恒为 1；同时重建左栏与底栏，修复段落模式仍显示场景列表的问题。
- 新增可选 `chapterContext`；正文/选区为空时回退读取 `第N章_Scene展开.md`，并用 `splitSceneSections` 本地填充场景列表（无需先调 AI）。

**5. 运行时补充修复**
- 简报泄漏 YAML frontmatter：`loadChapterBriefInput` 读取每个规划文件时剥离 frontmatter（大纲与情节蒸馏拼接后第二份 fm 会落在文本中间）；`buildChapterBrief` 内再剥离一次作为纯函数防线。
- 接受建议后主按钮不恢复：`insertTextAndRecord` 程序化写入 `editor.value` 不触发 `input`，改为插入后显式调用 `updateStartButtonState()`，空正文「✍️ 生成开头」→ 有正文「⇥ 建议」。

#### 🧪 验证
- 新增 `tests/unit/engine/chapter-brief.test.ts`（20 用例）：4 场景解析、情绪合并与 `emotion_arc` 兜底、加粗/列表字段、场景推进、信息释放提取、YAML frontmatter 剥离、8 要素注入、实体中文字段映射、有/无简报的提示词去重。
- `npm run typecheck`、`npm run build` 通过；全量单测 **177 文件 / 3167 用例**全部通过。
- Obsidian 运行时实测（CDP）：空正文 → 「生成开头」返回 3 条候选并写入 252 字；实体总览 `allChars=1832 / allLocs=136 / allFactions=208 / allItems=90`；Scene 6445 字完整、提示词命中 8 要素；简报 4 场景且无 frontmatter；扩写弹窗连续切换 3 次标题栏恒为 1、空正文回退场景列表；接受后按钮恢复「⇥ 建议」。
- 注：API Key 启用口令加密时，启动口令弹窗曾阻塞 `loadSettings()`（已在上一节「启动不再被口令框阻塞」修复：启动静默解密 + 按需解锁）。
- 方案与验证清单：[spec.md](file:///d:/小说工坊/小说工坊/.trae/specs/cowrite-flow-refactor/spec.md)

### 章节规划流转与协同写作流程修复

#### 🧭 动因
- 章节规划文件已生成（信息规划 1598 字、情节蒸馏 1629 字、大纲摘要 1092 字、情绪规划 2479 字、Scene 展开 6346 字），但工作台仍停留在规划步骤、无法进入正文写作。
- 根因有两层：①结构化校验按 `## 标签` 匹配，而 AI 实际输出 `**标签**：`，且情节蒸馏字段、`### sceneN:`、小数情绪等级 `6.5/10` 均与校验规则不一致，导致已生成内容被判为 partial/skeleton；②一键生成全章规划完成后只写 `stepCompleted`，不推进 `currentStepIndex`。
- 协同写作切章时编辑器未清空，存在把上一章正文误存到新章节的风险；从协同写作返回工作台时复用旧视图不会重新读取磁盘，正文步骤仍显示未完成。

#### ✨ 改动

**1. 步骤校验与真实 AI 输出对齐（`engine/step-validator.ts`）**
- 新增 `normalizeStepMarkup`：校验前去除 `**粗体**` / `__粗体__`，并把独占一行的「标签：」规范为 `## 标签`，不修改落盘内容。
- `infoPlan` 接受 `信息释放计划` 作为「熵预算与自信息」的等价模块，伏笔标签允许括号后缀。
- `plotDistill` 按提示词真实结构校验：`情节节点规划 / 冲突升级路径 / 信息密度指标`，`场景节奏设计 / 爽点设计` 作为加分项。
- `outline` 的关键场景支持 Markdown 表格（`| 1 | 场景 | ...`）。
- `sceneExpand` 接受 `##`~`######` 标题；`emotionPlan` 接受 `sceneN` / `场景N` 与小数等级 `6.5/10`。
- `characterSoul` 兼容 `buildCharacterSoulSummary` 的紧凑格式（`欲>… | 惧>… | 创>… | 底>…`）。
- 统一评分基线：必填项全部命中时补足 15 分，修复 `analysisReport` / `characterSoul` 即使字段齐全也永远无法达到 `complete` 的问题；必填项 0 命中时不计加分，空内容仍为 `empty`。
- `isTemplateSkeleton` 识别未替换的 `${var}` 模板变量，避免把模板文件当成生成结果。

**2. 规划完成后自动进入正文（`engine/step-runner.ts` / `engine/planning-step-advance.ts` / `ui/full-writer-view.ts`）**
- 抽出纯函数 `calcStepIndexAfterPlanning`：5 个规划步骤全部完成 → `currentStepIndex = 7`（正文写作）；仍有缺失 → 定位到第一个缺失的规划步骤。
- 一键规划（合并/顺序补全）结束后，视图层再次确认并推进到正文写作。
- `characterSoul` 在角色灵魂层为空时不再写空文件并标记完成，改为提示先完善角色核心。

**3. 协同写作与状态流转（`ui/co-writing-view.ts` / `ui/full-writer-view.ts` / `ui/states/chapter-state-manager.ts` / `main.ts`）**
- 切换章节先清空编辑器，避免未写入的新章节沿用上一章正文。
- 前置规划警告横幅先去重再渲染，避免多次切章堆叠。
- 新增 `FullWriterView.refreshChapterStateFromDisk()`；`openFullWriterView` 复用已有视图时主动从磁盘恢复步骤状态，从协同写作返回后可直接看到正文已完成并进入质量控制。
- `restoreChapterState` 以磁盘为权威：步骤文件缺失或未达 complete 时移除 `stepCompleted` 残留，避免删除正文后仍显示「已完成」。
- 向导中已显式跳过的步骤再次前进时不再重复内容校验，避免被重新拉回「内容不完整」。

**4. 场景单元解析统一与空写保护（`engine/scene-expander.ts` / `ui/full-writer/scene-outline-controller.ts` / `engine/co-writer-engine.ts` 等）**
- 新增 `parseSceneHeadings` / `splitSceneSections` / `SCENE_HEADING_SOURCE`，作为场景标题解析的唯一入口：兼容 `##`~`######`、`场景N` / `sceneN`、中文数字序号与空标题。
- `SceneOutlineController.parseScenes` 改用统一解析器，修复只认 `## 场景N：` 导致 `### sceneN:` 文件解析出 0 个场景的问题。
- `saveScenes` 增加空写保护：场景数为 0 且原文件有内容时拒绝写入并提示；返回值改为「是否真正写入」，手动保存按钮不再对未写入的情况误报成功、误标步骤完成。
- 新增 `saveRawContent()`：修复「📝 纯文本编辑」模式下保存按钮恒走场景编辑器、编辑内容不落盘的问题；步骤状态改用实际写入内容同步，不再沿用旧的 `stepResults`。
- 协同写作的剧情节点提取改用 `splitSceneSections`，并补全 `objective / conflict / location / characters / info_increment` 字段映射（此前只认中文标签，节点目标退化为标题）。
- 同类解析器同步统一：`scene-generation-loop`、`chapter-outline-tree-modal`、`context-panel`、`outline-to-text-expander` 均改为兼容 `### sceneN:`，避免逐场景生成 / 场景树 / 上下文面板在真实 AI 输出下得到空列表。
- 已从 Obsidian File Recovery 快照恢复被误清空的 `第1章_Scene展开.md`（6445 字符）。

#### 🧪 验证
- 新增回归断言：粗体标签 + 表格大纲、真实情节蒸馏字段、`### sceneN` 展开、小数情绪等级、紧凑角色灵魂格式、`${chapNum}` 模板骨架、`calcStepIndexAfterPlanning` 三种推进分支、`parseSceneHeadings` 标题层级/中文序号/无标题/正文误判、`splitSceneSections` 切分边界。
- `npm run typecheck`、`npm run build` 通过；全量单测 176 文件 / 3147 用例全部通过。
- Obsidian 运行时复测：`九霄逆脉行` 第 1 章恢复后 5 个规划步骤均为 `complete`，`calcResumeStepIndex = 7`；协同写作成功绑定章节，切换第 2/3 章后正文编辑器为空、无残留。

### 全书规划质量与批量建章校验修复

#### 🧭 动因
- 批量建章把「九霄逆脉行」3 卷共 400 章识别成 397 章，并阻断建章：生成端的分卷章节表省略了 Markdown 分隔行，解析器固定从「表头 + 2 行」开始，导致每卷第 1 章被当作表头跳过。
- 全书规划出现「降级生成」：第 3 卷用缩进子项书写 `人物弧光` / `三幕结构`，字段提取器把 `  - **沈渊**：…` 误判成新字段，整卷被判为空并在 3 轮重生成后仍标记降级；同时跨卷校验只认「预期卷」，蓝图把第 1 卷已发生的转折点写到第 3 卷时，会触发整卷重写且永远无法收敛。
- 长卷分段生成逐批串行，且每批只拿到概览前 3000 字，卷级伏笔/势力/反转等后半段约束丢失，耗时与质量同时受损。

#### ✨ 改动

**1. 章节表解析统一（生成端与建章端同一套规则）**
- 新增 `shared/chapter-table.ts`：统一表头识别（`章号 / 章节 / # / 章 / 序号`）、分隔行识别、章号单元格解析（兼容 `**1**` / `第1章` / `1.` / `1（开篇）`）与「章节表连续块」提取。
- `shared/volume-plan.ts` 改为「表头后逐行解析，分隔行存在才跳过」，不再依赖固定跳过两行；卷内其它数字表格仍不会被误算。
- `engine/outline-contract.ts` 的章节号提取/覆盖分析/净化全部复用同一模块，避免两套算法漂移；`analyzeChapterTable` 只统计章节表块内的行。
- `consolidateChapterTable` 落盘前统一规范化为「表头 + 分隔行 + 升序数据行」，修复生成端省略分隔行或把分隔行写在末尾导致的表格无法渲染。

**2. 全书规划质量与降级判定**
- `extractFieldValue` 的字段结束边界改为「行首 `- **字段**`」：缩进子项属于字段值，`人物弧光` / `三幕结构` 不再被误判为空。
- 跨卷转折点校验改为「预期卷或更早卷出现过即满足」：转折点只发生一次，避免蓝图 `expectedVolume` 偏差触发整卷重写与假降级。
- 降级标记改为以最终内容重新执行 `validateVolumeStructure` 判定；跨卷修复/全局章节补全已修好的卷不再误报「降级生成提示」。

**3. 长卷生成耗时与批次质量**
- 章节批次改为受限并发（上限 3），130/160/110 章长卷的墙钟耗时显著下降；单批异常不影响其它批次。
- 批次上下文从「概览前 3000 字」改为结构化字段（核心冲突 / 主要事件 / 人物弧光 / 本卷高潮 / 三幕结构 / 爽点节奏 / 反转路线 / 情绪曲线 / 伏笔安排 / 势力变动），并新增「服从卷级事件/伏笔/势力」「相邻章节因果承接」约束。

#### 🧪 验证
- 真实分卷大纲回归：`九霄逆脉行` 解析为 3 卷 / 130+160+110=400 章，`hasBlockingIssues=false`、`issues=[]`；第 1/2/3 卷 `validateVolumeStructure` 均为 0 缺陷（修复前第 3 卷有 2 项字段误判）。
- 新增单测：无分隔行、`**N**`/`第N章`/`N.` 单元格、三卷 400 章真实格式、缩进子项字段、表格分隔行补齐/归位、转折点在更早卷已出现、章节批次并发、批次上下文结构化字段、降级标记最终复算、更早卷转折点不触发整卷重写。
- `npm run typecheck`、`npm run build` 通过；全量单测 176 文件 / 3132 用例全部通过。

### 随机构思去重 / 动态输出预算 / 全书规划批量建章

#### 🧭 动因
- 「AI 随机构思」与文笔预设重复点击总得到同一结果：`computePromptHash(systemPrompt, userPrompt, model, temperature, maxTokens)` 五元组固定，命中 prompt 缓存后直接返回上一次内容。
- 向导内长文本步骤经常被 4096 截断：`AiEngine.callAI` 先用静态能力表预截断，`deepseek-flash` 等未登记模型被压到 4096；多处生成器还硬编码 4096，截断后完整性校验失败又触发二次调用。
- 批量建章只能按单卷手动选择范围，没有消费上一步的全书规划，也没有建章前后的校验。

#### ✨ 改动

**1. 创意类调用真正随机**
- `AIApiClient.callAI` 新增 `bypassCache?: boolean`；为 true 时既不读缓存也不写缓存。
- `AiEngine.callAI` 透传 `bypassCache`。
- `ui/create-project-modal.ts`：读取当前题材（已选则固定，未选则由 AI 随机）；每次点击重新抽取「主角身份 / 金手指 / 核心冲突 / 情绪基调」四个随机维度并加入随机种子；调用带 `{ bypassCache: true }`。
- `ui/writing-style-modal.ts`：生成文笔预设时加入随机种子、要求每次在句式/意象/节奏上有差异，并 `{ bypassCache: true }`。

**2. 动态输出预算**
- `AiEngine.callAI / callAIStream / callAIAsyncIterator` 删除静态表预截断，未显式传 `maxTokens` 时统一使用 `settings.maxOutput`，最终由 `AIApiClient#resolveMaxOutput`（用户模型覆盖优先）收敛。
- 上下文预算检查同样优先使用用户「模型覆盖」的 `maxContext`：`calculateTokenBudget` 支持 `limits` 参数，未登记模型不再被误判为 32K 而提前拒绝长上下文请求。
- `shared/model-capabilities.ts`：未登记模型输出兜底 `4096 → 8192`。
- `AIApiClient` 识别 `finish_reason=length`：在模型上限内自动扩容一次并重试（4096 → 8192 → …）；已达上限时仅告警，不再无限重试。
- 长文本生成调用改用 `settings.maxOutput`：世界观骨架、设定库/世界观、实体生成、全书概要与分卷大纲、场景生成/展开、章节信息规划、黄金开篇、标签生成、大纲摘要。
- 成功响应新增 `finishReason` 并写入 prompt 缓存，缓存命中时语义保持一致。

**3. 批量建章改为消费全书规划**
- 新增 `shared/volume-plan.ts#parseVolumePlan`：解析全部 `### 第N卷`，提取卷名、章节范围与表格章号。
- `readMergedVolumeOutline` 改为 v4 卷文件优先、旧版单文件仅在无卷文件时兜底，避免同时存在时合并出重复卷号。
- 建章前强校验：无分卷、缺少章节范围、范围倒挂、卷号重复、表格章数与声明范围不一致、表格章号跳号/越界、卷间范围重叠、全书总览的分卷数/总章节数与明细不符 → 阻断；断档/未从第1章开始/无表格 → 警告。
- `ui/batch-create-modal.ts`：移除单卷下拉与手填起止章，改为展示「检测到 N 卷 / M 章」+ 逐卷明细 + 校验结果；一次为全部卷创建章节骨架，已存在文件自动跳过。
- 建章后落盘校验：按实际写入路径 `adapter.stat` 校验 8 个步骤文件与正文非空；有失败或空文件时保持弹窗并列出清单，修复后可直接重试。
- 向导「批量建章」默认走同一流程。

#### 🧪 验证
- `npm run typecheck` 通过。
- 新增 `tests/unit/shared/volume-plan.test.ts`（14 例）、上下文覆盖/模型覆盖 3 例、`readMergedVolumeOutline` 数据源优先级 3 例、prompt 缓存 `bypassCache` 用例、`finish_reason=length` 自动扩容 2 例、`AiEngine` 默认预算透传 2 例；批量建章单测改为覆盖全部卷与幂等。
- 全量单测：176 文件 / 3122 用例通过。

### 完整性门禁 / 文笔预设扩展 / 常驻快捷工具

#### 🧭 动因
实体生成「模板写了但没生成」的内容仍会落盘，导致项目文件混乱；文笔风格只能从固定预选中挑；快捷工具藏在弹窗里，项目页与章节页都要多点一次。三者同属「数据契约 → 执行 → 前端入口」链路断裂。

#### ✨ 改动

**1. 实体完整性闭环（数据层 / 执行层 / 前端层）**
- `shared/template-validator.ts` 严格化：`姓名: ""`、占位词（待补充/无/TBD…）、只有标题没有内容的分节、只有「- 外貌：」空标签行，全部判为缺失。
- 修复分节正文正则：`$` 在 `m` 标志下会把正文截断到标题行行尾，改用 `(?![\s\S])`，多行内容与子节才能被读到。
- 新增 `validateSettingLibOutput` / `validateWritingStyleOutput` / `WRITING_STYLE_REQUIRED_SECTIONS`。
- `shared/format-constants.ts` 补齐 `CHARACTER_NESTED_FIELD_GROUPS`（性格三层 / 角色弧光）、`*_REQUIRED_VALUE_KEYS`（内容字段必须有值，系统字段只查键）与短标题别名。
- 新增 `shared/entity-integrity.ts`：`ensureEntityIntegrity` = 校验 → AI 补全一次 → 复检；统一生成模态与 AI 构建器共用，人物生成模态内置同一闭环，势力/地点/物品批量生成在 `BatchEntityGenerator` 内完成同样的校验→补全→复检。
- `shared/entity-persistence.ts` 成为最后门禁：不完整一律 `failed`，单次上限 200，空名拒绝，同名不覆盖改另存。
- UI 侧：人物生成补全失败不再写「待补充」占位文件；统一生成模态、AI 构建器改为「复检通过才落盘」。
- 模板 / 提示词 / 校验三方对齐：人物模板补 `人物背景`、`性格三层`、`角色弧光` 与「自信息事件储备」分节；生成提示词补 `性别`、`首次出场`、`当前位置`、`修为等级`。
- 补全算法与生成共用同一输出契约：`completeCharacter` 显式列出 18 个 YAML 字段、3 个嵌套组、7 个正文分节，并传入世界观；势力/地点/物品补全显式列出 4 个正文分节；补全统一改用 `proModel`、输出下限 4096 tokens，并剥离 Markdown 代码围栏（`shared/api-response-utils.ts#stripCodeFence`）。此前补全只要求「补缺失字段」，模型只补 frontmatter，复检必然失败、文件永远无法修复。
- 模型输出上限改为「用户模型覆盖优先」：`AiApiClient#resolveMaxOutput` 先查 `plugin.resolveModelLimits()`，再回退静态能力表。此前 `deepseek-flash` 等未登记模型被当成默认 4096，长实体补全被静默截断；同时补登记 `doubao-seed-2-1` 系列能力。
- 新增存量修复入口：`shared/entity-audit.ts`（`auditEntityFiles` / `readProjectWorldview` / `overwriteEntityIfComplete`），统一实体管理界面「🩹 补全不完整实体」逐条审计 → 补全 → 复检 → 原地覆写，复检不通过保持原文件不变。

**2. 向导步骤内容级门禁**
- 新增 `ui/full-writer/wizard-step-validators.ts`：读实际内容校验同人设定 / 世界观 / 设定库 / 文笔风格 / 大纲 / 章节（章节要求文件存在且抽查正文非空）。
- 同人步骤以 `.project` 的「同人设定路径」为权威来源；向导内保存同人设定后回写该路径，避免重进向导后状态丢失。
- `wizard-controller`：「下一步」先校验内容，不完整则停在当前步骤并提示，只提供「🔄 重新生成」与「跳过此步骤 →」（跳过需二次确认）；末步「进入写作」同样校验章节。
- `wizard-step-executors`：设定库、文笔风格、分卷大纲、批量建章生成后立即校验，不完整标记 `complete_with_warnings`。

**3. 实体入口去掉中间层**
- 向导实体步骤只保留「📚 实体管理」，点击直达 `UnifiedEntityManagerModal`；删除 `ui/full-writer/entity-overview-modal.ts` 与 4 个冗余「管理 XX」按钮。

**4. 文笔风格预设可新增 + AI 生成**
- `ui/writing-style-modal.ts` 新增「➕ 新增预设」内联面板：填名称/描述 →「🪄 AI 生成内容」按 9 个一级分节 + 3 个子节 + 参考样本生成并填入表单 →「💾 保存为新预设」。
- `ui/writing-style-presets.ts` 新增 `saveStylePreset`：同名拒绝（不覆盖）、自动取下一个序号、`sanitizeName` 归一化文件名；落盘前用 `validateWritingStyleOutput` 校验 9 个一级分节 + 3 个子节，不完整（含 `—` 占位）直接报错、不写文件。

**5. 快捷工具常驻（项目页 / 章节页）**
- 新增 `ui/full-writer/tool-catalog.ts` 作为工具目录单一事实源（6 组 37 项）与 `CHAPTER_QUICK_TOOL_IDS` 高频条；删除 `ui/full-writer/tools-modal.ts` 与对应 CSS。
- 项目页改为「左侧项目卡片 + 右侧常驻面板」：上方项目概览，下方项目快捷操作（向导/写作/章节/文笔风格/同人设定/删除）与全部分类工具，选中卡片即刷新。
- 项目页默认选中一个项目（优先高亮项目，否则第一个），视图重建后右侧不再是空提示。
- 右侧面板配色统一走 Obsidian 原生变量（`--background-primary` / `--text-normal` / `--background-modifier-border` / `--interactive-accent`）：避开主题管理器对 `--nw-card-bg` / `--nw-text-primary` / `--nw-accent` 的自定义覆盖；按钮规则加 `.nw-quick-tools` 作用域压过 `button:not(.clickable-icon)` 默认背景。
- 章节页标题栏新增常驻快捷工具条（审查、结算、步骤结果、建章、人物、实体管理、文笔蒸馏、上下文注入、成稿导出）。
- 新建项目补回「🎲 AI 随机构思」：一次生成书名 / 题材 / 简介并回填表单。
- 同人设定入口补齐：`AddFanficSettingModal` 支持绑定当前项目（落盘 `项目/05-同人设定库/` 并回写 `.project` 的同人设定路径），保存前做完整性校验与一次 AI 补全。

#### 🧪 验证
- `npm run typecheck` / `npm run lint` / `npm run build` 通过。
- 全量单测：174 文件 / 3097 用例通过（新增 `tests/unit/shared/template-validator.test.ts`、`tests/unit/ui/wizard-step-validators.test.ts`、`tests/unit/shared/entity-audit.test.ts`、`tests/unit/shared/api-response-utils.test.ts` 的 `stripCodeFence` 用例、`tests/unit/engine/ai-api-client.test.ts` 的输出上限用例）。
- 真实 vault 实测：`九霄逆脉行` 的 9 个人物卡（含 5 个 47–53 字节空壳）经「🩹 补全不完整实体」修复后，四类实体全部通过 `validateEntityContent`；补全过程中未产生「名称（2）」副本，原 tags / 名称保留。
- Obsidian CLI 实测：插件重载无报错；项目页渲染 `selector-layout` + 右侧面板 + 37 个工具 / 6 个分组，旧 `.novel-writer-fw-toolbar` 已消失；37 个工具命令全部可从 Registry 或 Obsidian 命令路由命中。
- 章节页实测（临时章节）：标题栏内 9 个快捷 chip 正常渲染且可直接点击，验证后已清理临时文件。

### P2/P3：质量债（Batch 3）

> 依据 `.trae/specs/plugin-gap-analysis-2026q4/prd.md` 的 Batch 3（FR-F-06~F-10、FR-E-06~E-10、FR-C-03~C-07）

#### 🧭 动因
Batch 1/2 解决了分发与宣称一致性后，剩余问题集中在：已实现模块无入口、平台差异未声明、旧命令与重复实现增加维护成本、缺少诊断与协作模板、E2E 为占位、模板与文档存在缺口。

#### ✨ 改动

**FR-F-06 无入口模块逐项接线（15 项）**
- `analysis-session-manager` → 分析报告落盘后记录会话快照。
- `semantic-analyzer` → 角色拆解的噪声词过滤与昵称相似度。
- `character-recognition-pipeline` + `suggestion-manager` + 审核面板 → 新命令「👤 角色识别审核」。
- `ai-scene-generator` → 场景细纲「一键生成」；`ai-scene-expander` → 场景确认向导失败兜底。
- `stream-text-reader` → 分段拆解改为流式读取。
- `volume-conflict-detector` → 全书规划前卷冲突提示（并修正正文目录路径）。
- `entity-field-mappings` → 实体管理器字段渲染；`analysis-report-panel` → 分析报告步骤按需增强。
- `memory-preview` + `triggered_memories_matched` → 上下文面板记忆碎片预览。
- `full-writer-state` → 兼容别名；`settings-utils` → 迷你设置折叠区块。

**FR-F-07 跨平台声明**
- 系统级文件保护按平台分支：Windows 文件属性 / macOS-Linux 权限位 / 移动端明确提示不支持；README 补充平台差异。

**FR-F-08 旧版写作命令收敛**
- 4 个旧正文命令从公开命令面板收敛并显示弃用提示，保留至 v5.0.0。

**FR-F-09 空状态 / FR-F-10 重复实现**
- 角色识别、实体管理等空数据路径接入统一空状态组件；删除重复的 `extractElementsCommand`。

**FR-E-06 脚本入口治理 / FR-E-07 协作与安全模板 / FR-E-09 依赖治理**
- 脚本入口与 `engines.node >= 20` 声明；移除未使用的 electron/electron-builder；新增 `check:deps` 与 `audit:deps` 入口。
- 新增 `SECURITY.md`、`CONTRIBUTING.md`、Issue 模板与 PR 模板。

**FR-E-08 诊断包**
- 「流程诊断」新增「导出诊断包」：版本、平台、能力开关、Endpoint 主机、降级记录、更新检查结果。不含 API Key、正文与文件内容。
- 诊断包固定写入 vault 根目录 `导出文件/`（Obsidian 桌面端 `a[download]` 下载链路不可靠），并修复下载锚点过早 `revokeObjectURL` 导致文件未落盘的问题。

**FR-E-10 E2E 有效性**
- `tests/e2e/obsidian-plugin.spec.ts` 改为真实 Electron 链路：创建临时 vault → 启动 Obsidian → 创建项目 → 打开完整写作工作台 → 校验项目卡片与目录落盘。
- 未配置 `OBSIDIAN_PATH` 时显式跳过；CI 新增条件执行的 `e2e-obsidian` job 与 `playwright test --list` 解析校验。
- 修正 Obsidian 插件命令命名空间：真实 ID 为 `novel-writer-ai:<command-id>`（CLI 实测确认）。
- 旧 Chromium 模拟用例标记 `describe.skip`，README 的“已支持”清单同步修正。

**FR-C-03/04 模板补齐**
- 8 个缺失步骤模板已入 `assets/template-scaffold`；`DEFAULT_TEMPLATES` 补齐 `volumeOutline`/`worldview`/`character`/`location`/`faction`/`item`；缺失模板告警只提示一次。

**FR-C-05/06/07 文档与示例**
- README 补齐数据位置、卸载影响、Top 6 FAQ、平台差异、仅中文界面声明与许可证表述；修正 `docs/releases/` 索引口径（界面截图仍需在装有 Obsidian 的环境补充）。
- 新增命令「导入示例项目」：一键生成 1 卷 3 章 + 1 人物 + 1 伏笔（含步骤结果示例），并打开工作台。

**工作台「生成世界观」真实路径修复（CLI 实测驱动）**
- `WorldviewGenerator.generateWorldviewForProject` 失败时不再返回空串：改为返回 `{ content, error }`，把 AI 层真实原因（如 `HTTP 401`）透传到工作台。
- 工作台世界观步骤改为与命令面板一致的瀑布式生成（骨架 → 9 模块），此前只走单次 fallback；`adaptedProgress` 死代码完成接线，UI 可显示生成阶段。
- 工作台失败提示由「请重试」改为具体原因（含 API 认证失败），避免用户无法判断是配置问题还是插件问题。
- 新增 `tests/unit/engine/worldview-for-project.test.ts`：真实调用 `generateWorldviewForProject`（仅 mock 网络层），覆盖成功落盘、401 错误透传、校验重试、frontmatter 保留 4 条用例；此函数此前零测试覆盖。

**实体生成与文笔风格预设统一（CLI 实测驱动）**
- 新增 `shared/entity-persistence.ts`：人物/势力/地点/物品共用同一落盘契约——统一 `sanitizeName` 路径、缺失 frontmatter 自动补齐、同名且内容相同幂等跳过、**同名但内容不同另存为「名称（2）」**（区分同名分身，不覆盖）。
- 四个独立生成模态、统一生成模态全部接入该契约；此前四模态只新建不更新、统一模态自行拼路径并直接覆盖、向导仅写缓存，行为不一致。
- AI 构建器（批量/单个、含人物批量）同样接入该契约；移除「确认后删除再创建」的覆盖逻辑与「已存在则静默跳过」，同名不同内容统一另存副本。
- 工作台实体步骤移除「▶ 执行」一次性串行生成（第三套生成/保存算法），按钮收敛为每行「生成 / 继续生成」+ 底部「跳过实体，进入下一步」；执行中状态改为按分类隔离，打开人物窗口不再禁用其余按钮。
- 文笔风格改为多文件预设：新增 `元文件/00-系统模板/文笔风格预设/` 10 套预设（强者语、传统网文、细腻言情、冷峻悬疑、轻松幽默、宏大堂皇、古风武侠、沙雕轻小说、末世废土、克苏鲁悬疑），随模板自举写入，用户可自行增删。
- 文笔风格模态新增预设下拉与应用按钮；移除硬编码强者语默认预填；补齐「零、参考样本」编辑区，保存时不再丢失参考样本。
- 新增 `tests/unit/shared/entity-persistence.test.ts`（6 条）与 `tests/unit/ui/writing-style-presets.test.ts`（3 条）。

### P1：宣称一致性（Batch 2）

> 依据 `.trae/specs/plugin-gap-analysis-2026q4/prd.md` 的 Batch 2（FR-F-02/03/04/05、FR-E-02/04/05、FR-C-02）

#### 🧭 动因
多项对外宣称的能力在真实发布安装中不可用或行为不符：更新检查指向不存在的仓库、Worker 以相对路径加载且静默降级、重命名命令只弹提示、从章节列表进入工作台不定位、声明 MIT 却无许可证、构建产物入仓策略不一致、覆盖率口径失真、提示词模板开箱不可用。

#### ✨ 改动

**FR-F-02 更新检查**
- 默认仓库统一为 `Moxifeng11/novel-writer-ai`；设置页占位符与默认值同步。
- `UpdateCheckResult.errorKind` 区分 `config` / `network` / `http` / `parse`；404、403/401、网络不可达、JSON 解析失败分别给出可读原因。
- 设置页展示「上次检查时间 + 结果」，失败时显示具体原因而非「无更新」；mini-settings 补全设置持久化。

**FR-F-03 Worker 运行时可达性**
- 新增 `shared/plugin-worker-url.ts`：通过 `adapter.getResourcePath`（回退 `getBasePath`）把插件目录下的 Worker 解析为绝对 URL。
- `DeconstructionScheduler` 与 `HeavyTaskWorkerManager` 注入解析后的 Worker 地址；无法解析或加载失败时通过 degradation notifier 发出**一次性**可见降级提示，任务仍由主线程完成。
- 发布流水线新增 `workers/*.js` 资产与含 `workers/` 的 zip；README 安装步骤同步。

**FR-F-04 项目重命名**
- 新增 `ui/rename-project-modal.ts`，命令「重命名当前项目」改为真实执行：`fileManager.renameFile` 更新子文件路径与内部链接，并同步 `.project` 标题；目标重名时明确提示。

**FR-F-05 章节自动定位**
- `FullWriterView.openChapterByPath()` 解析章节路径中的卷/章并复用 `selectChapter`；`main.activateFullWriterView` 在打开工作台后直接定位到入口章节，移除 TODO 占位。

**FR-E-02 许可证**
- 新增根目录 `LICENSE`（MIT，与 `package.json` 声明一致）。

**FR-E-04 构建产物策略**
- `.gitignore` 新增 `workers/` 与 `.hotreload`；已将 3 个 Worker 产物与 `.hotreload` 从 Git 索引移除（本地文件保留）。
- CI 新增「构建产物未入仓」校验；上传产物包含 `workers/`。

**FR-E-05 覆盖率口径**
- 覆盖率统计范围扩展为 `engine/` `services/` `core/`（排除类型声明、测试与 Worker 入口）。
- 阈值按域设定；CI 单元测试步骤切换为 `npm run test:cov`，阈值失败即阻断。

**FR-C-02 提示词模板**
- 内置模板资源新增 `00-系统模板/prompts/README.md` 与 `bodyGeneration` system/user 示例模板（`.example.md` 不会被误当作自定义模板）。
- 设置页模板管理继续以 `System ✓ / User ✓` 展示各步骤自定义状态。

#### 🧪 验证
- 新增 `tests/unit/services/update-checker.test.ts`（11 例）与 `tests/unit/shared/plugin-worker-url.test.ts`（5 例）。
- `npm test`：167 个测试文件、3045 个用例通过。
- `npm run test:cov`：Statements/Lines 64.74%、Branches 79.81%、Functions 56.92%，分域阈值门禁通过。
- `npm run typecheck` / `npm run lint` / `npm run build` / `npm run check:release` 全量通过。

### P0：成稿编译导出 / 修订闭环

> 依据 `.trae/specs/plugin-evolution-2026q4/optimization-plan.md` 的 P0-1（成稿编译与导出）与 P0-2（修订闭环）

#### 🧭 动因
插件此前只能在 Obsidian 内逐章查看正文，无法把整本书编译成可交付稿件；质量仪表盘能列出问题却不能跳转定位；已有 `RewriteSuggestionEngine` 与 `RealtimeMonitor` 引擎也没有 UI 接线，用户无法形成「发现问题 → 定位 → 改写 → 复检」的闭环。

#### ✨ 改动

**P0-1 成稿编译与导出**
- 新增 `engine/export/manuscript-compiler.ts`：纯函数编译章节为 Markdown / 纯文本 / HTML；去除 frontmatter 与重复 H1，按卷号/章号稳定排序，HTML 转义且内置打印样式（浏览器打印即可另存 PDF）。
- 新增 `ui/export-manuscript-modal.ts`：选择项目、格式、卷/章标题开关，导出前展示章节数；复用 `shared/export-file`，桌面端下载、移动端写入「导出文件」目录。
- 新增命令「📦 成稿导出」（工具组）。

**P0-2 修订闭环**
- `ui/quality-dashboard-modal.ts`：问题清单支持点击定位，新增 `openFileAtLine()` 打开章节并按 1-based 行号移动光标/滚动；越界行号收敛到末行。
- 新增 `ui/rewrite-suggestion-modal.ts`：对选中文本生成 2-3 个改写方案（润色/扩写/缩写/节奏/人物/逻辑），一键替换回正文；AI 不可用时由引擎自动降级为规则建议。
- 新增命令「✨ AI 改写建议」（写作辅助组，编辑器选中文本后使用）。
- `ui/co-writing-view.ts`：接线已有 `RealtimeMonitor`，顶栏新增「📊 实时质量」开关；开启后输入停顿 2.5s 评估当前正文，显示「质量 N · M 问题」，可随时关闭。
- 版本并排/行内 diff 已由 `ui/chapter-version-modal.ts` 提供（本批未改动；修正优化方案中「缺版本 diff」的误判）。

#### 🧪 验证
- `npm run typecheck` / `npx eslint`（改动文件）通过。
- `npm test`：165 个测试文件、3029 个用例通过（新增编译器 11 个、问题定位 4 个）。

### P0 分发自举：内置模板资源 / CI 门禁 / 发布校验（Batch 1）

> 依据 `.trae/specs/plugin-gap-analysis-2026q4/prd.md` 的 Batch 1（FR-F-01 / FR-E-01 / FR-E-03）

#### 🧭 动因
Release 仅分发 `main.js` / `manifest.json` / `styles.css` 三个文件，但「新建项目」依赖 vault 根目录的 `元文件/` 模板树，且仓库缺少 CI 与发布资产校验。结果是：全新安装可以加载插件，却在第一个核心动作（新建项目）失败；发版完整性只能依赖人工记忆。

#### ✨ 改动

**内置模板自举（FR-F-01 / FR-C-01）**
- 新增 `assets/template-scaffold/`：34 个空白模板与项目骨架文件（系统模板、世界架构、时间线/伏笔、项目总控、同人设定模板、封面说明、作品信息）。已剔除示例项目数据与第三方作品原文。
- 新增 `scripts/generate-template-assets.mjs`：将资源目录生成为字符串常量模块（`--check` 模式用于 CI 一致性校验）。
- 新增 `shared/template-scaffold-assets.generated.ts`（自动生成，勿手改）。
- 新增 `shared/template-scaffold.ts`：`ensureTemplateScaffold()` 只补缺失文件、不覆盖用户修改；单文件失败不阻断其余文件。
- 接入点：插件 `onload`（首次安装提示并初始化）、`ui/create-project-modal.ts`（建项前兜底）、`ui/full-writer-view.ts`（快速建项前兜底）。

**CI 门禁（FR-E-01）**
- 新增 `.github/workflows/ci.yml`：PR / master push 执行 `check:templates` → lint → typecheck → vitest → build → `check:release`，并校验构建未产生未提交变更。

**发布校验（FR-E-03）**
- 新增 `scripts/check-release.mjs`：校验 package/manifest/tag 版本一致、manifest 关键字段、三资产存在且非空、Worker 产物存在、模板资源已嵌入 `main.js`。
- 新增 `.github/workflows/release.yml`：打 `v*` tag 时自动执行全量 Gate 并创建/更新 GitHub Release（三资产）。
- `package.json` 新增 `gen:templates` / `check:templates` / `check:release`；`build` 与 `dev` 自动先生成模板资源。

#### 🧪 验证
- `npm run check:templates` / `lint` / `typecheck` / `build` / `check:release` 全部通过。
- `npm test`：164 个测试文件、3014 个用例通过（新增模板自举 5 个用例）。

## 4.11.0 — v8.14 全面技术审计落地：安全收口 / 内存生命周期 / UX 断点 / 死代码清理 / CSS 一期 / lint 接入

> 发布说明：`docs/releases/v4.11.0.md` · GitHub Release `v4.11.0`（2026-10-19）

### 🧭 动因
按 `/goal` 对插件完整代码库执行四路静态审计（安全 / 内存 / UX / CSS）+ 运行时验证（obsidian CLI）+ 官方生态规范对照，产出漏洞清单与风险等级评估报告（`.trae/specs/plugin-tech-audit-2026q4/audit-report.md`，约 40 项：高 15 / 中 10+ / 低与信息 15+）。经用户裁定分四批实施：S+M+U 核心缺陷、D 死代码清理（**逐文件引用验证后删除**）、C-a CSS 一期、T eslint 接入；F4 密钥派生按用户裁定升级为**口令派生**。兼容底线不变（minAppVersion 保持 1.5.0、v1 密文永久可读、无口令用户明文降级）。

### ✨ 改动

**批 S — 安全收口**
- `shared/paths.ts`（**F5 路径穿越 · 高**）：新增 `sanitizeName()` —— 剥控制符、替换 `\/:*?"<>|`、剥首尾 `.`（消除 `..` 段）、空名回退「未命名」；`pjCharFile/pjLocFile/pjFactionFile/pjItemFile/pjFanficFile` 五个实体路径函数与 `kbBookDir` 统一收口。AI 生成实体名（settlement-engine 等 40+ 调用点）不再可能写出 vault。
- `ui/full-writer/project-selector-controller.ts:365`（**F1 XSS · 高**）：章节列表 `innerHTML` 插值前对 `ch.chapter` / `ch.title` 过 `escapeHtml`（`ch.title` 源自 frontmatter，AI 生成/导入可写入任意文本）。
- `utils/helpers.ts`：新增统一 `escapeHtml`（覆盖 `& < > " '`）；`ui/knowledge-detail-modal.ts` SVG `<text>` 插值（F2）改走该函数；`ui/svg-charts.ts` 私有版补单引号转义（F3）。

**批 S — F4 密钥派生升级（用户裁定方案）**
- `core/crypto-service.ts` 重写：v2 格式 `aes256v2:<iterations>:<salt>:<iv>:<ct>`，**用户口令 + PBKDF2-SHA256（210k 迭代，每条密文独立随机 salt）**派生 AES-GCM 密钥。旧版 seed 为公开常量（知道 vault 路径即可解密 data.json 中的 API 密钥）。要点：口令仅存内存（会话级，不落任何文件）；`decrypt` 遇 v1 密文永久走旧 seed 兼容读取（存量数据零破坏）；首次加密时用户取消 → 明文保存并提示（向下兼容）；口令错误清除会话重问一次；同 salt 派生缓存避免重复 PBKDF2。
- `ui/password-modal.ts`（新建）：ask（解锁）/ set（设口令，两次输入 + ≥6 位校验）两种模式，Esc/遮罩关闭视同取消。
- `engine/engine-registry.ts`：构造 CryptoService 时注入 `requestPassword` / `requestNewPassword` 回调（服务保持无 UI 依赖）。

**批 M — 内存与生命周期**
- `main.ts` onunload（**M1 · 高**）：补 `this.engineRegistry?.disposeAll().catch(...)` —— 此前 disposeAll 生产代码零调用，插件卸载/禁用后 Worker 池与重资源全部残留。
- `services/heavy-task-worker-manager.ts`（**M1 · 高**）：补 `dispose()` 委托幂等 `destroy()` —— 原类仅有 `destroy()` 而 EngineRegistry 的 Disposable 契约只认 `dispose()`，即使调用 disposeAll 也清不掉该类。
- `engine/context-manager.ts`（**M2 · 高**）：删除 `incrementalContextCache`（每次 gatherAll 无上限写入完整 GatheredContext，唯一读取方 `gatherIncremental` 与清理方 `invalidateIncrementalCache` 生产代码零调用，长会话可积累数十 MB）及连带死代码 `fileChangeTracker` / `recordFileChange` / `updateIncrementalCache` / `recomputeDerivedData`。`diffDetector` / `incrementalUpdater` 有活路径引用，保留。
- `ui/backup-yuan-modal.ts` / `ui/protect-yuan-modal.ts`（M3/M4）：`new Notice('⏳', 0)` 持久进度通知持有引用并在所有出口 `hide()`（原实现永不消失、反复操作叠层）。
- `utils/helpers.ts`（M8）：`showProgress` / `hideProgress` 由模块级单例改为按 key 的 Map 管理 —— 不传 key 行为与旧版完全一致，并发流程传不同 key 即互不吞进度。

**批 U — UX 断点修复**
- `core/command-registry.ts`（**U1 · 高**）：`registerInternalCommands` 补注册 `WRITE_CHAPTER` —— 该命令此前仅有定义未注册，tools-modal「整章生成（旧）」按钮点击无任何效果（运行时实证修复前 `registry.has = false` → 修复后 `true`）。
- `ui/mini-settings-modal.ts` + `ui/settings-tab.ts`（U6）：两份逐行复制的「重建向量索引」实现收敛为 `ui/knowledge-rebuild-action.ts` 单一实现。
- `ui/rebuild-chapters-modal.ts` / `ui/batch-create-modal.ts` / `ui/ai-builder-modal.ts` / `ui/full-writer/wizard-step-executors.ts`（U7）：四处批量操作的单项失败此前仅 `log.warn` 用户不可见，改为收集失败清单、结束 Notice 汇总「成功 N / 失败 M（前 5 项）」。
- `ui/step-result-viewer-modal.ts`（U11）：`showInFolder` 移动端由静默失败改为 `Platform.isMobile` 判断 + 明确 Notice 提示。

**批 D — 死代码清理（逐文件三重验证：全库引用 Grep / 动态 import / tests 引用 → 零引用才删）**
- 删除 10 个零引用文件：`ui/main-modal.ts`（NovelWriterModal，连带清 main.ts 与 command-registry.ts 两处 unused import）、`ui/writing-profile-modal.ts`（清 main.ts unused import）、`ui/project-wizard-modal.ts`、`ui/modals/volume-conflict-preview-modal.ts`、`ui/scene-detail-editor-modal.ts`、`ui/monitor-view.ts`、`ui/relationship-view.ts`、`ui/action-panel.ts`、`ui/components/progress/floating-progress-ball.ts`（U4 视图 ID 比较错误随之消失）、`ui/components/progress/status-bar-indicator.ts`。
- `services/template-service.ts`：清除 `WRITING_RULES` 死导入（v8.13 登记项）。
- `ui/components/progress/index.ts`：同步移除两个死组件的 re-export（桶文件其余导出不受影响）。

**批 C-a — CSS 一期**
- `styles.css`（C11）：补齐 **17 个幽灵变量**（被 `var()` 引用却未定义，此前回退 initial 值）—— `--nw-info` / `--nw-tag-bg` / `--nw-plot-accent` / `--nw-progress-bg` / `--nw-progress-fill` / `--nw-card-hover` / `--nw-accent-text` / `--nw-btn-warning-active-bg` / 排版五件套（`--nw-text-xs/sm/lg`、`--nw-font-semibold`、`--nw-leading-normal`）/ 阴影二件套（`--nw-shadow-card(-hover)`）/ 滚动条二件套，全部对齐既有 token 体系。脚本复核幽灵变量 **17 → 0**。
- `styles.css`（C3）：文件末尾新增 `prefers-reduced-motion` 全局兜底块 —— 原文件 11 个 `@keyframes`（含 4 个 infinite 循环）仅 1 处尊重用户偏好，现统一降级（动画时长趋零、循环收敛单次、滚动行为还原）；`!important` 为覆盖全文件散布声明的官方允许例外，注释已说明。
- `styles.css`（C5）：`rhythm-segment` 三态由硬编码浅色底+深色字（暗色主题下视觉脱节）改为 Obsidian 官方 `--color-*` 语义色 + `color-mix` 半透明底，明暗主题自适应。
- `styles.css`（C10）：`.nw-quality-popup` 的 `z-index: 9999`（压过官方弹层）改用 `var(--layer-popover, 100)`。

**批 T — lint 接入**
- 新增 `eslint.config.mjs`（flat config）：接入 **eslint 9 + eslint-plugin-obsidianmd 0.4.2**（42 条官方社区规则，recommended 全量）；按本项目实际显式关闭 `settings-tab/prefer-setting-definitions` 与 `settings-tab/no-deprecated-display`（声明式设置需 Obsidian 1.13+，与 minAppVersion 1.5.0 冲突）。`package.json` 增加 `lint` 脚本。**首次基线 0 error / 1 warning**（已顺手清理 genre-detector.ts 失效的 eslint-disable 指令）。

**批 C-b（CSS 二期 · b0~b4，执行计划 `.trae/specs/plugin-tech-audit-2026q4/cb-cc-execution-plan.md`）**
- C-b0 基线锁定：明/暗双主题 × 4 界面（cowriting/fullwriter/knowledgebase/qualitydashboard）8 张截图存 `screenshots/cb-baseline/`，作为后续各阶段像素对比锚点。
- C-b1 死变量清理（三重验证：CSS `var()` 引用 / 全库 TS 消费 / `theme-manager.ts` 运行时注入白名单）：删除 **22 个纯死变量**（零引用零消费零注入，含 `--nw-shadow-xl` 的 `:root` 与 `.theme-dark` 双处、`.nw-cowrite-root` 作用域的 `--nw-ui-gap(-lg)`），styles.css 9740 → 9717 行；**7 个白名单保留**（`theme-manager` `setProperty` 注入）。审计口径修正：原 29 项清单中 7 个实为 TS 内联消费型活变量（审计时未扫 TS 消费侧），已剔除误判。
- 验证：lint 0/0 / typecheck 0 / 3009 tests / build / reload + `dev:errors` 干净；fullwriter 静态界面像素 diff 0.18%（噪声级）；cowriting/knowledgebase 为动画界面像素法不可用（自比 100%/81%），截图留存待 Owner 肉眼复核。
- C-b2 基础类重复定义收敛：`.nw-btn`（**实测 6 处**，审计原记 5——L2457 因带前导空格漏计）、`.nw-card`（3 处）、`.nw-card-title`（**实测 4 处**，原记 3）各自合并为**单一定义**，各属性取层叠终值；合并块强制置于所有变体之前（置于末尾会使同特异性后写覆盖变体背景，已实测验证）。作用域覆盖层（`.nw-scope .nw-card`、协同写作组合器 `!important`）原样保留。
- C-b2 验证：四界面 computedStyle 逐属性对比（`.nw-card` / `.nw-card-title` 各 8 项、`.nw-btn` 7 项）**全部与基线一致**，零视觉变化。附带发现：`.nw-btn-warning` 背景长期被 Obsidian 原生 `button:not(.clickable-icon)`（特异性 0,1,1）覆盖为 `#333`（既有缺陷，已登记）。
- 方法论修正：本环境截图像素法不可用（两次采集间仅改 CSS，像素 diff 仍 78%~100%，源于窗口/动画/滚动状态漂移）；后续阶段以 computedStyle 逐属性采样为主证据，截图为 Owner 签发素材。
- C-b3 裸类命名空间化（51 类 → 0，另补充 3 个清单外裸类）：45 类直接加 `nw-` 前缀（CSS 66 处选择器 + TS 13 处引用）；4 个与现有 `nw-` 样式冲突的活类按 Owner 裁定做**语义化改名**（`warning-item`→`nw-warning-text`、`traction-progress`→`nw-traction-progress-value`、`entity-name`→`nw-entity-name-accent`、`stat-label`→`nw-emotion-stat-label`）以避免误并入新版样式造成视觉变更；2 个死类删除（`rhythm-segment`、`thread-progress`）；清单外补充 `emotion-curve-empty`/`stat-item`/`state-change-list`。
- C-b3 修复前缀动态拼接遗漏（R5 命中）：`divergence-risk-${level}`（live-analysis-controller）与 `diff-${op}`（chapter-version-modal 3 处）均已加 `nw-` 前缀——若不修复，这些元素的样式会静默丢失。
- C-b3 验证：54 个目标类残留扫描 **CSS 0 / TS 0**；computedStyle 抽样 15 个类样式正确；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）。
- C-b4 `.nw-scope` 双选择器兜底收敛（C7）：运行时验证（Modal / ItemView 两条挂载路径）证明 `nw-scope` 与 `.modal` 始终为**同一元素**（全库 80 处 `addClass('nw-scope')` 均挂 `modalEl`；ItemView 挂 `workspace-leaf`），后代选择器 `.nw-scope .modal.nw-modal*` **0 命中**，v8.3 自身挂载规则 `.modal.nw-scope.nw-modal*` 为唯一生效规则。经 Owner 裁定收敛：删除 A 组后代选择器规则、B 组重复块及 `.nw-scope .nw-modal .modal-content`，保留自身挂载组为唯一定义来源；同步删除 `.theme-dark .nw-scope .modal.nw-modal` 死规则（实测边框由 Obsidian 原生 `.modal` 提供，激活反而会把边框色由 `#3f3f3f` 改为 `#333`）。
- C-b4 验证：收敛前后模态框 computedStyle 一致（width 640px / maxWidth 96vw / border-radius 16px / display flex / overflow hidden / content padding 0）；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）；8 张截图存 `screenshots/cb-cb4/` 供 Owner 肉眼签发。附带发现：C-b0 基线 `light-*` 实为暗色（插件 `theme` 设置为 dark 且带自定义色，app 主题切换不改变插件变量），且 `dev` 环境下曾出现双份 styles.css 注入（reload 后恢复单份）。

**批 C-c（CSS 三期 · c1，P0 功能性缺陷）**
- C-c1 `ui/quality-dashboard-modal.ts` 窄屏溢出 + 视觉裸奔（**C8 `高` + C9 `中` 合并修复**）：根因二连 —— ① 弹窗 `onOpen` 从未挂 `nw-scope` / 尺寸类，`.nw-qd-*` 与 `.nw-scope` 作用域规则**全部落空**（实测弹窗仅 560px）；② 内容区 `grid-template-columns: '380px 1fr'` 内联写死，容器不足 380px 时**必然横向溢出**。修复：`onOpen` 补 `addClass('nw-scope', 'nw-modal-lg')` 接入统一弹窗作用域；grid 改由新增 `.nw-qd-layout` 类承载，响应式采用 `repeat(auto-fit, minmax(min(380px, 100%), 1fr))` —— 按**容器宽度**（而非视口宽度）自动降为单列，比 `@media` 更贴合 Modal 场景（弹窗宽度与视口解耦）。
- C-c1 `styles.css` 补全 **14 类** `nw-qd-*` 定义（原 TS 引用 13 类 + 新增 `nw-qd-layout`，全部零 CSS 定义）：布局 / 图表容器 / 工具栏 / 维度条 / 问题列表 / 事实卡，全部走 `--nw-*` token 并保留原生变量回退。
- C-c1 内联样式收敛：该文件内联赋值 **18 → 1**（仅保留 `bar.style.width` 运行时宽度参数），静态样式全部交还 CSS。
- C-c1 验证：弹窗实测 `cls: "modal nw-scope nw-modal-lg"`、`width: 899.996px`（原 560px）、14/14 类定义命中；900px 弹窗两列 424.96/424.97px，容器降 500px / 弹窗降 460px 均自动单列，`scrollWidth === clientWidth` **零横向溢出**；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）；宽/窄两张截图存 `screenshots/cb-cc1/` 供 Owner 肉眼签发（合成 DOM 探针数据）。
- 方法论偏差说明：计划原文为 `@media (max-width:900px)`，实测 Modal 宽度与视口（2019px）解耦、媒体查询永不复现，故改用容器查询式 `auto-fit` 方案，效果等价且更健壮，待 Owner 确认。

### ✅ 验证
- 新增单测 **25 例**：`tests/unit/shared/paths-sanitize.test.ts`（F5 穿越/绝对路径/控制符/回归 11 例）、`tests/unit/core/crypto-service.test.ts`（F4 往返/salt 随机/取消明文/会话复用/错误口令/v1 兼容/畸形密文 8 例）、`tests/unit/utils/helpers-escape-notice.test.ts`（escapeHtml 转义 3 例 + M8 多流程隔离 3 例）。
- 全量：`npm run lint` **0 error 0 warning**；`npm run typecheck` 零错误；`npm test` → **163 files / 3009 tests passed**（基线 160/2984）；`npm run build` 成功；`plugin:reload` 后 `dev:errors` = `No errors captured`，full-writer / knowledge-base / writing-fingerprint 三视图正常加载。
- 运行时实证：`registry.has('novel-writer-write-chapter')` **false → true**（U1 按钮「整章生成（旧）」恢复生效）；幽灵变量脚本复核 **17 → 0**。

### 📌 登记（后续批次）
- C-b（CSS 二期）：~~b0 基线~~ / ~~b1 死变量~~ / ~~b2 基础类收敛~~ / ~~b3 裸类命名空间化~~ / ~~b4 双选择器兜底收敛~~ **已完成（2026-10-19）**；另登记新发现：`full-writer-view.ts:366-381` 与 `theme-manager.ts` 双份布局变量注入（6 处数值漂移）+ 5 个零消费注入变量，待 Owner 裁定收敛方案；`.nw-btn-warning` 背景被 Obsidian 原生 `button` 规则长期覆盖（既有缺陷）。
- C-c（CSS 三期）：~~c1 P0 功能性缺陷（quality-dashboard 窄屏溢出 + `nw-qd-*` 补定义）~~ **已完成（2026-10-19）**；剩余 C-c0（分区目录注释）/ c2（其余模块内联样式迁移）/ c3（过渡动画属性收敛）/ c4（其他 C12–C18 项）按 Owner 裁定另批执行（当前范围 A 仅含 P0）。
- M1 破坏性终验（禁用插件观察 Worker 终止）未在用户会话执行，以 dispose 契约单测 + onunload 接线静态验证代替。

## 4.10.6 — 伏笔拆解器扩展：世界观提取 + 设定植入密度 (2026-07-17)

### ✨ 新增功能（Features）

**世界观设定提取（10 类）**
- `ForeshadowDeconstructor.extractWorldbuilding(text)` 提取小说中的世界观设定
- 10 类 WorldbuildingCategory：geography / history / politics / economy / culture / religion / magic_system / race / technology / organization
- 关键词复用 `dimension-keywords.ts` 的 `WORLDVIEW_WORDS`（system→magic_system、geography、faction→organization），其余 7 类内联定义
- 输出 `WorldbuildingEntry`：name / description / firstMention(0-1) / mentionCount / chapters / relatedEntries
- 相近位置（500 字内）的同类关键词聚类为一个 entry
- 跨章节共现建立关联设定（同章节不同类别）
- 覆盖度评分：覆盖类别数 / 总类别数 * 60 + 条目数归一化 * 40，范围 0-100
- 类别分布 `categoryDistribution` 涵盖所有检测到的类别

**设定植入密度分析**
- `ForeshadowDeconstructor.analyzeSettingDensity(text)` 按章（20 章分段）分析设定词密度
- 每章统计：密度（每千字设定词数）/ 新设定数 / 重复设定数 / 过载标记
- 过载判定：密度 > 20 个/千字 或 新设定 > 10 个/章（阈值常量 `SETTING_DENSITY_OVERLOAD_THRESHOLD` / `SETTING_DENSITY_NEW_SETTING_THRESHOLD`）
- 趋势检测：比较前 1/3、中 1/3、后 1/3 的平均密度 → increasing / decreasing / stable
- 分布合理性评分：100 - 过载章节数 * 10 - 极端波动惩罚（CV>1 扣 15、>0.5 扣 8）- 后期陡增惩罚（10）
- 所有密度值均 >= 0，distributionScore 限制在 0-100

### 🔧 接入与输出（Changes）

**`analyze()` 主流程接入**
- 在原伏笔分析完成后，调用 `extractWorldbuilding(sample)` 与 `analyzeSettingDensity(sample)`
- 返回类型 `ForeshadowAnalysisResult` 新增可选字段 `worldbuilding?` 与 `settingDensity?`
- `EnhancedForeshadowAnalysis` 自动继承（仍可独立调用 `enhanceAnalysis`）
- `analyzeWithVector` 通过 `...baseResult` 展开自动携带新字段
- 全程使用 `await yieldToUI()` 让步，避免阻塞主线程
- 向后兼容：所有新增字段均为可选

**Markdown 报告新增两节**
- `## 世界观设定`：覆盖度概览 + 类别分布表 + 设定列表（名称/类别/首次出现/提及次数/涉及章节）+ 关联设定
- `## 设定植入密度`：平均/峰值/最低密度 + 趋势箭头 + 过载章节警告 + 各章密度分布表

**Frontmatter 同步**
- `buildFrontmatter()` 新增 `worldbuilding`（totalEntries / coverageScore / categoryDistribution）与 `settingDensity`（avgDensity / maxDensity / densityTrend / overloadChapterCount / distributionScore）摘要

### ✅ 验证

- 临时冒烟测试 5 个用例全部通过（已删除）：覆盖度边界、密度趋势、analyze 整合、空文本降级
- TypeScript 编译无新增错误（foreshadow-deconstructor.ts 零错误）
- 现有伏笔分析功能不破坏（新增字段为可选，未改动原有逻辑）

---

## 4.10.5 — 结构拆解器扩展：叙事时序 + 多结构模板 (2026-07-17)

### ✨ 新增功能（Features）

**叙事时序分析（Genette 框架）**
- `StructureDeconstructor.analyzeNarrativeTemporality()` 基于 Gérard Genette 叙事学三维度框架分析
- 时序（Order）：
  - 检测倒叙标记词（回忆/往昔/曾经/当年/想起/追溯...）→ `analeptic`
  - 检测预叙标记词（后来/多年后/将来/最终/结局/终究...）→ `proleptic`
  - 两者共存 → `mixed`；都没有 → `chronological`
  - 输出 flashbacks / flashforwards 位置列表（position + targetPosition + description）
  - 置信度 = min(1, 标记词总数 / 20)
- 时长（Duration）：
  - 按段落分类为 5 种时长类型，分布占比总和 = 1
  - Scene（场景）：对话密度 > 4%（基于引号字符占比）
  - Summary（概述）：对话/描写密度低
  - Pause（停顿）：描写词密度 > 3%
  - Ellipsis（省略）：时间跳跃词密度 > 0.5%（复用 `SHOW_TELL_WORDS.tell.timeJump`）
  - Stretch（拉伸）：复用 `NARRATIVE_TEMPORALITY_WORDS.duration` 词命中
  - 输出 dominantType 与 distribution
- 频率（Frequency）：
  - 重复叙述（repeating）：检测"又一次/再一次/再次/又/再..."
  - 迭代叙述（iterative）：检测"每天/每次/总是/常常/往往..."
  - 无标记 → singulative
  - 输出 repetitiveEvents 列表（最多 20 条）

**多结构模板匹配**
- `StructureDeconstructor.matchStructureTemplates()` 对 5 种结构模板评分
- 模板库：
  - 三幕式（three_act）：建置 → 对抗 → 解决（3 节点）
  - 英雄之旅（hero_journey）：12 阶段完整 Campbell 框架
  - 起承转合（kishotenketsu）：4 节点（与现有 QCCH 分析互证）
  - 救猫咪（save_the_cat）：Blake Snyder 15 节点
  - 网文公式（webnovel_formula）：穿越/重生 → 金手指 → 冲突 → 打脸 → 升级 → 高潮 → 转折 → 终极对决
- 匹配算法：
  - 每个节点按 `[position ± tolerance]` 提取文本窗口
  - 计算关键词密度 → confidence（0-1）
  - confidence > 0.1 视为匹配
  - matchScore = round(100 * matchedNodes / totalNodes * avgConfidence)
  - 范围严格 0-100
- 输出 bestMatch（allMatches 中得分最高）+ allMatches 完整对比

**集成与输出**
- `StructureAnalysisResult` 新增可选字段 `narrativeTemporality?` / `templateMatch?`，向后兼容
- `analyze()` 中调用两个新方法，使用 `yieldToUI` 避免阻塞
- `getEmptyResult()` 返回完整空值结构（避免可选字段缺失）
- Markdown 报告新增「叙事时序分析（Genette 框架）」「结构模板匹配」两个章节
- Frontmatter 同步序列化新字段
- 复用 `dimension-keywords.ts` 的 `SHOW_TELL_WORDS.tell.timeJump` 与 `NARRATIVE_TEMPORALITY_WORDS.duration`

### ✅ 测试
- 新增 `tests/unit/engine/structure-deconstructor-narrative-template.test.ts`（20 个用例）
- 覆盖：时序类型 4 种枚举、时长分布总和≈1、频率 3 种类型、matchScore 0-100、bestMatch 是最高分、5 种模板类型全覆盖、向后兼容 QCCH/三线/节奏单元、Markdown 含新章节、Frontmatter 含新字段

### 📝 文档
- `docs/CODE-INDEX.md` 更新 structure-deconstructor 条目，补全类名与职责描述

---

## 4.10.4 — 人物拆解器扩展：网络中心性 + 声音指纹 (2026-07-17)

### ✨ 新增功能（Features）

**角色网络中心性（图论指标）**
- `CharacterDeconstructor.analyzeNetworkCentrality()` 基于段落共现构建角色网络，手写 BFS / 迭代实现，不引入第三方图论库
- 4 项中心性指标：
  - 度中心性 `CD(v) = degree(v) / (n-1)`，归一化 0-1
  - 接近中心性 `CC(v) = (n-1) / Σ d(v,u)`，BFS 求最短路径
  - 介数中心性 O(V³) 枚举所有节点对的最短路径，归一化 0-1
  - PageRank 迭代 100 次或收敛（d=0.85, tol=1e-6），归一化总和≈1
- 角色定位推断：PageRank Top1 → protagonist；度中心性 >0.5 → major；0.2-0.5 → supporting；其余 minor
- 社区检测：基于共现权重的连通分量 BFS
- 网络密度 = 实际边数 / 可能边数（n*(n-1)/2）；平均路径长度 = 所有节点对最短路径均值
- 每个步骤间使用 `yieldToUI` 避免阻塞

**角色声音指纹**
- `CharacterDeconstructor.analyzeVoiceFingerprint()` 提取每个角色所有对话（引号文本 + 对话动词触发）
- 多维指标：
  - 对话次数 / 平均对话长度
  - 词汇丰富度 TTR（2 字滑动窗口近似）
  - 语气词样本（啊/呢/吧/嘛/呀/哦/哼/呸/切/嗯/嘿 等 30 字）
  - 句式分布（短 <10字 / 中 10-30字 / 长 >30字 占比，三段总和≈1）
  - 性格标记：正式度（正式词/(正式词+口语词)）/ 情感度（情绪词密度，复用 `EMOTION_WORDS`）/ 直接度（短句占比*0.5 + (1-语气词密度)*0.5）
  - 独特表达：2-4 字 ngram，在该角色对话中≥2 次且不在其他角色对话中出现
- 指纹描述：`直率-简短-情绪化-口语-语气词多(啊/呢)` 格式
- 区分度 = 各角色指纹向量两两余弦距离均值 * 100，范围 0-100

**集成与输出**
- `CharacterAnalysisResult` 新增可选字段 `networkCentrality?` / `voiceFingerprint?`，向后兼容
- `analyze()` 末尾自动调用两个新分析
- Markdown 报告新增「角色网络分析」「角色声音指纹」两个章节
- Frontmatter 同步序列化新字段
- 复用 `dimension-keywords.ts` 的 `EMOTION_WORDS`（扁平化为 `ALL_EMOTION_WORDS`）

### ✅ 测试
- 新增 `tests/unit/engine/character-deconstructor.test.ts`（19 个用例）
- 覆盖：度中心性 0-1、PageRank 总和≈1、网络密度 0-1、personalityMarkers 0-1、句式分布总和≈1、TTR 0-1、区分度 0-100、社区覆盖所有节点、边权重正整数、Markdown 含新章节、向后兼容

---

## 4.10.3 — 风格拆解器扩展：词汇丰富度 + 五感分析 (2026-07-17)

### ✨ 新增功能（Features）

**词汇丰富度计算**
- `StyleDeconstructor.analyzeVocabularyRichness()` 新增 TTR / MTLD / Yule's K / Hapax Legomena 综合分析
- 不引入分词库，使用 2 字滑动窗口作为「词」的近似（复用现有 `isAllChinese` 判定）
- TTR 按 1000 字窗口分段计算平均，避免长文本 TTR 偏低问题
- MTLD 采用 McCarthy & Jarvis 2010 标准算法：正向 + 反向双向计算后取平均，阈值 0.72
- Yule's K 采用标准公式 `K = 10^4 * (M2 - N) / N^2`，K 越小词汇越丰富
- Hapax Legomena = 只出现一次的词数 / 总词数
- 等级划分：TTR > 0.7 且 MTLD > 50 → high；TTR < 0.4 或 MTLD < 30 → low；其余 medium
- 综合评分 `score = 0.3·ttr_norm + 0.3·mtld_norm + 0.2·yulesK_norm + 0.2·hapax_norm`，归一化到 0-100

**五感描写分析**
- `StyleDeconstructor.analyzeFiveSenses()` 复用 `dimension-keywords.ts` 的 `FIVE_SENSES_WORDS` 词典
- 5 类感官：visual / auditory / olfactory / gustatory / tactile，键名与 `SenseType` 完全对齐
- 构造时一次性构建 `senseWordMap` 与 `senseMaxWordLen`，扫描时按最长匹配优先（避免单字过度匹配）
- 输出每类感官的：出现次数、占比（总和≈1）、每千字次数、样本词（每类最多 20 个）
- 主导感官 = 出现最多的感官；空文本默认 `visual`
- 平衡度基于熵：`balanceScore = (H / log2(5)) * 100`，分布越均匀得分越高
- 密度等级：每千字总感官词数 > 10 → high；3-10 → medium；< 3 → low

**analyze() 整合**
- `StyleAnalysisResult` 新增两个可选字段：`vocabularyRichness` / `fiveSenses`
- `analyze()` 方法接入两个新方法，每个方法之间插入 `await yieldToUI()` 避免阻塞主线程
- `getEmptyResult()` / `buildFrontmatter()` / `buildMarkdownBody()` 同步更新
- Markdown 报表新增「词汇丰富度」「五感分析」两个章节
- Frontmatter 同步包含扩展字段，供下游向量增强流程使用

### 🔒 向后兼容（Compatibility）

- 所有新增字段均为可选，不破坏现有调用方（`StyleDeconstructorV2.v1Result` 等保持原样）
- 10 万字取样限制（MAX_SAMPLE = 100_000）保持不变
- 空文本/单字文本返回零值结果，避免崩溃
- 复用 `dimension-keywords.ts` 的 `FIVE_SENSES_WORDS`（注意：导出名是复数 `SENSES`），保持单一数据源
- 仅扩展 `style-deconstructor.ts`，不修改其他拆解器，不影响 V2 风格分析

### 🧪 测试（Tests）

- 新增 `tests/unit/engine/style/style-deconstructor-extensions.test.ts`，覆盖 29 个用例
- 覆盖范围：TTR/MTLD/Yule's K/Hapax 边界、五感分布总和≈1、balanceScore 范围、空文本/单字/超长文本、Markdown 输出、向后兼容、现有功能回归
- 现有 `style-deconstructor-v2.test.ts` 53 个用例全部通过
- `tests/unit/engine/style/` 全部 333 个用例通过

---

## 4.10.2 — 节奏拆解器扩展：情感弧 + NRC 8 情绪 + 节奏曲线 (2026-07-17)

### ✨ 新增功能（Features）

**情感弧原型识别**
- `RhythmDeconstructor.detectEmotionArc()` 新增 Vonnegut 8 形状情感弧识别能力
- 支持 8 种原型：rags_to_riches / riches_to_rags / man_in_hole / icarus / cinderella / oedipus / steady / complex
- 输出原型类型、置信度、章节情感值序列、分段趋势、原型描述
- 章节情感值基于 NRC 正负极性归一化（[-1, 1] 区间），方差 < 0.1 判定为 steady

**NRC 8 情绪分析**
- `RhythmDeconstructor.analyzeNRCEmotion()` 基于 NRC 情绪词典统计 8 类情绪词频
- 8 类情绪：anger / anticipation / disgust / fear / joy / sadness / surprise / trust
- 输出全书分布占比（总和≈1）、按章分布、主导情绪、情绪波动度、情绪转换列表
- 复用 `dimension-keywords.ts` 的 `EMOTION_WORDS` 词典，保持单一数据源

**节奏曲线计算**
- `RhythmDeconstructor.calculateRhythmCurve()` 输出每章节奏评分（0-100）
- 评分公式：0.3×事件密度 + 0.3×对话密度 + 0.2×段落节奏 + 0.2×情绪强度
- 节奏模式判定：fast / medium / slow / irregular（标准差 > 25 优先判定为 irregular）
- 输出平均节奏、节奏变化列表、节奏描述

**analyze() 整合**
- `RhythmAnalysisResult` 新增三个可选字段：`emotionArc` / `nrcEmotion` / `rhythmCurve`
- `analyze()` 方法接入三个新方法，每个方法之间插入 `await yieldToUI()` 避免阻塞主线程
- `getEmptyResult()` / `buildFrontmatter()` / `buildMarkdownBody()` 同步更新
- Markdown 报表新增「情感弧分析」「NRC 8 情绪分析」「节奏曲线」三个章节

### 🔒 向后兼容（Compatibility）

- 所有新增字段均为可选，不破坏现有调用方
- 10 万字取样限制（MAX_SAMPLE_LENGTH = 100_000）保持不变
- 空文本/无章节边界返回带空数组的默认结果，避免崩溃
- NRC 极性划分：正向=joy/trust/anticipation/surprise，负向=anger/disgust/fear/sadness

---

## 4.10.1 — 知识库管理工作台全面加固 (2026-07-17)

### 🔴 致命修复（Critical）

**deleteBook 递归删除**
- `KnowledgeBaseManager.deleteBook()` 由仅删除索引改为递归删除书籍整个目录及所有子文件
- 彻底解决删除书籍后残留大量拆解文件、风格指纹、向量索引等垃圾文件的问题
- 同时从总索引中移除条目，保证数据一致性

**pause 任务取消**
- `DeconstructionScheduler.pauseTask()` 暂停时正确调用 `AbortController.abort()` 取消进行中的拆解
- 修复暂停后后台仍继续运行、占用 API 额度和 CPU 资源的严重问题
- 取消后状态正确置为 `paused`，保留已完成维度的进度

### 🟠 严重修复（Severe）

**路径安全过滤**
- 所有书籍路径操作增加路径穿越防护，过滤 `../`、绝对路径等非法路径段
- 防止通过构造恶意书名访问知识库目录外的文件
- 统一使用 `kbBookDir()` 标准化路径生成

**同名书籍检测**
- `addBook()` 新增同名检测逻辑，发现重名时自动追加序号（如 `书名 (2)`）
- 避免新增书籍时静默覆盖已有书籍及其所有拆解数据
- 支持自定义重名处理策略

**索引损坏重建**
- 总索引文件（index.md）损坏或 JSON 解析失败时，自动触发全量扫描重建
- 从各书籍目录的「基本信息.md」中恢复元数据，保证系统可用性
- 重建完成后通过 Notice 提示用户检查数据完整性

**改名原子操作**
- `renameBook()` 采用原子操作流程：创建新目录 → 复制所有文件 → 验证完整性 → 删除旧目录 → 更新索引
- 任意步骤失败自动回滚，避免改名中途失败导致书籍数据丢失或分裂
- 大文件复制增加进度反馈

**看门狗误判修复**
- Watchdog 活性检测增加「维度切换宽限期」，维度切换期间的短暂无进度不判定为中断
- 心跳检测时间从 30s 调整为更合理的间隔，避免正常长任务被误杀
- 中断判定增加二次确认机制，减少误判概率

**资源泄漏修复**
- `DeconstructionScheduler.destroy()` 完整清理所有任务、定时器、AbortController、事件监听器
- 插件卸载或知识库重新初始化时无残留资源
- 修复 Worker 池未正确终止的问题

**搜索框焦点问题**
- 知识库视图搜索框修复自动聚焦失效问题
- 快捷键 `/` 可正确聚焦搜索框
- 搜索结果高亮和键盘导航正常工作

**竞态条件修复**
- 修复快速连续点击「开始拆解」「暂停」「取消」导致的状态错乱
- 所有状态变更操作增加互斥锁，保证状态机一致性
- 书籍状态更新使用 SerializedWriter 串行写入

**状态泄漏修复**
- 任务完成/取消/失败后及时清理内部 Map（taskMap、progressMap、abortControllerMap）
- 修复长时间运行后内存持续增长的问题
- 增加定时清理机制，自动移除已结束超过 1 小时的任务记录

**按钮反馈修复**
- 所有操作按钮增加 loading/disabled 状态，避免重复点击
- 危险操作（删除、取消）增加确认弹窗二次确认
- 操作成功/失败均有明确的视觉反馈和 Notice 提示

### 🟡 一般优化（General）

**frontmatter \r\n 兼容**
-  frontmatter 解析同时支持 `\n` 和 `\r\n` 换行符
- Windows 系统下编辑的文件不再出现解析错误
- 写入时统一使用 `\n` 换行，保证跨平台一致性

**confirm 统一**
- 所有确认弹窗统一使用 `OperationConfirmModal` 组件
- 移除散落在各处的原生 `confirm()` 调用
- 统一的视觉风格和交互体验

**错误提示优化**
- 所有错误提示使用用户友好的中文描述，而非技术堆栈信息
- 错误分级：普通提示 / 警告 / 严重错误，使用不同配色和图标
- 关键错误提供「查看详情」入口，方便排查问题

**监听器幂等**
- 事件监听器注册增加幂等性检查，重复注册不会触发多次回调
- 使用 `Set` 管理监听器引用，避免重复添加
- dispose 时完整清理，无残留监听器

**Map 清理**
- 所有内部状态 Map 增加定期清理机制
- 任务结束后保留一段时间用于查询，随后自动清理
- 提供手动清理 API，用户可随时清理历史记录

**pending 暂停**
- 待处理（pending）队列的任务也支持全局暂停控制
- 暂停后新添加的任务不会自动开始执行
- 恢复后按优先级顺序依次启动

**写放大优化**
- 进度更新从每次变化都写入文件改为批量合并写入
- 使用 debounce 合并短时间内的多次进度更新
- 显著减少磁盘 I/O 和 frontmatter 解析次数

**进度 debounce**
- `DeconstructionScheduler` 进度事件发射增加防抖（默认 100ms）
- 避免高频进度更新导致 UI 卡顿和过度重绘
- 最终进度更新保证立即发射，不被防抖延迟

## 4.10.0 — 全流程进度可视化系统 (2026-07-15)

### 🚀 新增功能

**全流程进度可视化系统**
- 核心层：ProgressEmitter 进度状态管理与事件发射，支持 6 种状态（pending/running/paused/completed/failed/cancelled）
- 核心层：TimeEstimator 基于历史数据的时间估算引擎，使用中位数统计和字数分桶
- UI 层：ProgressBarComponent 进度条组件
- UI 层：StepListComponent 多步骤列表组件
- UI 层：LoadingOverlayComponent 全屏加载遮罩
- UI 层：TaskCardComponent 任务卡片组件
- UI 层：OperationConfirmModal 操作确认弹窗
- UI 层：FloatingProgressBall 悬浮进度球
- UI 层：StatusBarProgressIndicator 状态栏指示器
- Worker 层：WorkerManager Web Worker 池管理与任务调度
- Worker 层：WorkerRuntime Worker 运行时框架
- Worker 层：WorkerProtocol Worker 通信协议定义
- Worker 层：DeconstructionWorkerManager 拆解 Worker 管理器
- Worker 层：DeconstructionWorker 拆解 Worker 入口

**开发文档**
- 系统总览文档（README.md）
- ProgressEmitter 使用指南
- TimeEstimator 接入指南
- UI 组件使用指南
- Web Worker 接入指南
- 新功能接入完整流程
- 现有功能迁移指南

### ✅ 优化改进

**已接入功能**
- 知识库拆解（DeconstructionScheduler）全面接入进度可视化
- 文笔风格蒸馏（StyleDistillerModal）接入进度显示
- 协同写作（CoWritingView + CoWriteFloatingPanel）接入进度反馈

**中断状态恢复**
- 插件启动时自动恢复中断的拆解状态：将所有 processing 状态的书籍重置为 interrupted，保留中断时进度
- KnowledgeBaseManager 新增 recoverInterruptedBooks 方法，遍历书籍并恢复中断状态
- main.ts onload 在知识库初始化完成后调用恢复逻辑，并通过 Notice 提示用户
- 书籍详情页 interrupted 状态新增「🔄 恢复拆解」按钮（重置为 pending 并重新加入拆解队列）和「🗑️ 清除状态」按钮（清除进度和错误并回到待拆解）
- 书籍详情页 processing 状态新增「⚠️ 强制取消」逃生口按钮，经 OperationConfirmModal 确认后取消调度任务并将状态置为 interrupted，保留已完成维度
- 新增 `.nw-btn-warning` 按钮变体样式（amber 警告色），与 interrupted 徽章配色一致

**拆解器 UI 让步优化（yieldToUI 注入）**
- 6 个拆解器的 `analyzeWithVector()` 方法注入 `await yieldToUI()` 调用，解决知识库拆解整本小说（100万字+）时 UI 完全冻结的问题
- 涉及文件：style-deconstructor、structure-deconstructor、rhythm-deconstructor、technique-deconstructor、character-deconstructor、foreshadow-deconstructor
- 让步点：同步 `analyze()` 计算之后 + 每个向量增强步骤（`enhanceXxx`）之前 + 批量 `embedTexts` 调用之间
- 工具函数 `shared/yield.ts` 通过 `Promise + setTimeout(0)` 将后续代码推到下一个事件循环 tick，让浏览器处理 UI 事件（滚动、点击等）
- character-deconstructor 的 `enhanceCharacterFeatures` 方法内批量 `embedTexts`（Promise.all）之后也增加了让步点
- foreshadow-deconstructor 的 `analyzeWithVector` 内多处 `embedTexts`/`findSimilarPairs` 调用之间均增加让步点

### 📊 架构特性

- 三层架构设计：核心层 / UI 层 / Worker 层，职责分离
- 状态不可变：每次进度更新生成新状态快照
- 节流控制：进度更新频率限制为 10 次/秒，优化 UI 性能
- 自动降级：Worker 不可用时自动回退到主线程执行
- 取消支持：基于 AbortController 的统一取消机制
- 事件驱动：订阅式状态更新，组件间解耦

### 🐛 问题修复

**拆解调度器活性检测与启动时序修复（DeconstructionScheduler）**
- 修复拆解启动时序问题：`addTask` 创建任务后立即调用 `setBreakdownStatus(bookId, 'processing', 0)`，避免任务入队后书籍状态仍停留在旧值导致 UI 误判
- 从 `runTask` 中移除冗余的 `setBreakdownStatus('processing', 0)` 调用（已前移至 `addTask`）
- 新增 Watchdog 活性检测机制：每 30 秒检查任务心跳，连续 120 秒无进度更新则判定为中断
- `emitProgress` 每次刷新 `lastSeenAlive` 心跳时间戳，作为 watchdog 的活性信号源
- 中断时自动将书籍状态置为 `interrupted`，弹出 Notice 提示用户检查或重新拆解
- `runTask` 的 `finally` 块统一清理 watchdog 定时器，确保任务取消/失败/完成路径均无残留计时器

## 4.9.0 — 知识库题材管理完善 (2026-07-14)

### 🚀 新增功能

**知识库题材管理功能**
- 实现完整的新增题材功能：支持创建自定义题材，包含基本信息、性格标签、能力类型、角色定位、背景类型、写作技巧、细分题材、权重配置
- 实现题材编辑功能：自定义题材可完整编辑，预设题材支持"另存为自定义"
- 实现题材删除功能：自定义题材可删除，删除时清理关联配置
- 题材导入导出：支持 JSON 格式的题材导入导出，ID冲突时提供覆盖/跳过/重命名选项
- 新增10个预设题材：奇幻西方、体育竞技、二次元、灵异鬼怪、现代耽美、古代耽美、萌宝甜宠、职场婚恋、轻小说、恐怖惊悚
- 自定义题材与知识库书籍分类联动，可用于书籍题材分类和筛选

### ✅ 优化改进

**WebnovelKnowledgeBase 增强**
- 新增自定义题材内存管理：addCustomGenre、updateCustomGenre、deleteCustomGenre
- 所有查询方法自动合并预设题材和自定义题材
- 自定义题材优先级高于预设（ID冲突时自定义覆盖）

**KnowledgeBaseConfigManager 增强**
- 支持完整 GenreConfig 结构的自定义题材持久化
- 旧版精简格式向后兼容，自动转换为完整格式
- 删除题材时一并清理关联的性格标签、能力类型、技巧配置

### 📊 数据统计
- 预设题材从 8 个增加到 18 个
- 男频题材：8 个（玄幻修仙、都市现代、历史军事、游戏竞技、奇幻西方、体育竞技、二次元、灵异鬼怪）
- 女频题材：6 个（古代言情、现代言情、现代耽美、古代耽美、萌宝甜宠、职场婚恋）
- 中性题材：4 个（科幻末世、悬疑推理、轻小说、恐怖惊悚）

## 4.8.0 — UI 选项卡架构重构与设计优化 (2026-07-13)

### 🚀 新增功能

**新建项目模态框 UI 重设计**
- 完全重写 `ui/create-project-modal.ts` HTML 结构，采用语义化标签
- 新增 270+ 行 CSS 样式（`styles.css`），使用 `--nw-*` 设计 token
- 项目类型切换器：并排按钮设计（🎨 原创 / 📖 同人），选中态强调色背景
- 题材标签：胶囊形状，选中态强调色填充，hover 上浮效果
- 同人字段区域：卡片式设计 + 淡入下滑动画
- 设定库下拉选择器：搜索过滤 + 悬停效果
- 移除所有内联样式，统一使用 CSS 类控制外观

### ✅ 优化改进

**工作台选项卡 CSS 类名统一**
- 移除 `tab-controller.ts` 中所有内联 `style` 属性，改用 CSS 类名控制状态
- 修复 tab bar 容器类名不匹配问题（`novel-writer-fw-tabs-container` vs `.novel-writer-fw-tabbar`）
- 完善 normal / hover / active / selector 四种视觉状态样式
- 激活状态：背景色 + 加粗 + 底部 2px 强调色边框
- 关闭按钮默认低透明度，hover 时变清晰
- 右侧按钮（+、⚙️、🔄）统一样式，带 hover 效果
- 所有状态变化 0.15s 平滑过渡
- 清理重复 CSS 定义，统一使用 `--nw-*` 设计 token

**设置页面选项卡样式统一**
- 统一 `settings-tab.ts` 和 `mini-settings-modal.ts` 的 CSS 类命名
- 统一类名：`.nw-settings-tabbar`、`.nw-settings-tab`、`.active`
- 与工作台选项卡一致的设计语言（圆角、边框、过渡动画）

**项目选择器优化**
- 移除项目网格顶部多余的新建项目大卡片（右上角工具栏已有入口）

### 🐛 Bug 修复

- **选项卡点击无反应**：内联样式优先级高于 CSS 类，导致 active 状态视觉反馈失效。移除内联样式后修复
- **activateTab 重复点击不刷新**：当 `activeTabId === tabId` 时直接 return，未重新渲染。修复为始终渲染并提示"已刷新当前页面"
- **向导按钮无响应**：由上述 activateTab 问题导致，修复后向导按钮正常工作

### 📊 测试覆盖
- 新增 6 个 e2e 测试用例（`tests/e2e/project-card-interactions.spec.ts`）
  - 点击向导按钮测试
  - 点击写作按钮测试
  - 点击全部章节按钮测试
  - 点击右上角新建项目按钮测试
  - 项目卡片点击显示预览面板测试
  - 项目卡片点击两次关闭预览面板测试

### 📝 文档同步
- `docs/ARCHITECTURE.md` 更新：补充 `ui/full-writer/` 子目录控制器描述
- `shared/changelog-data.ts` 更新：补充 4.7.0 / 4.7.1 / 4.8.0 三个版本条目

---

## 4.7.1 — 偏离检测引擎 (2026-07-13)

### 🚀 新增功能

**实时监控 V2 Task 2: 偏离检测引擎**
- 新增 `engine/quality/deviation-detector.ts` 偏离检测引擎
  - 5 类偏离检测：剧情偏离主线、人物 OOC、前后矛盾、伏笔遗忘、节奏偏离
  - 3 级预警：info / warning / critical，阈值可配置（默认 60/30/0）
  - `DeviationDetector.detect()` 全量检测 + `detectByType()` 单类型检测
  - 增量检测：传入 `changedRange` 仅检测变更部分相关维度（主线/OOC/伏笔可跳过）
  - 取消机制：支持 `AbortSignal`，检测中取消抛出 `AbortError`
  - 结果缓存：复用 `LruCache`，类型级 + 完整结果两级缓存
  - 伏笔追踪：支持从 `DeviationContext.foreshadows` 显式提供，或从前文章节 frontmatter 自动解析
  - 伏笔回收阈值章节数可配置（默认 10 章）
  - 依赖注入复用 V1 引擎：`IPlotDivergenceEngine` / `ICharacterConsistencyChecker` / `IRhythmAnalyzerForDeviation` + 复用 `analyzeCoherence`
  - 每个类型降级规则：无注入时使用内置规则（零外部依赖）
  - 检测结果模型：`DeviationReport`（总分 + 各类型分数 + 问题列表 + 改进建议）

### 📊 测试覆盖（偏离检测引擎）
- 新增 67 个单元测试（`tests/unit/engine/quality/deviation-detector.test.ts`）
- 5 类偏离检测：每类含 V1 注入和降级规则两条路径
- 预警级别系统：info/warning/critical 阈值判定 + 自定义阈值
- 增量检测：changedRange 支持、可跳过类型正确跳过
- 取消机制：AbortSignal 已取消/检测中取消/无 signal/detectByType 也支持
- 结果缓存：相同内容命中、不同内容不命中、clearCache/invalidateCache
- 伏笔追踪：上下文提供/frontmatter 数组解析/frontmatter 字符串解析/已回收不告警
- 与 V1 引擎集成：updateOptions 调用、historyTexts 传递、向后兼容验证
- 向后兼容：V1 PlotDivergenceEngine + V2 Task 1 QualityScoreEngine 测试全部通过（146 测试零回归）

### 📝 文档同步
- `docs/ARCHITECTURE.md` 更新：在 quality/ 子目录中补充 V2 Task 2 引擎描述
- `docs/API.md` 新增第八章：偏离检测引擎 API 完整文档（11 节，覆盖类型/接口/类/上下文/报告/伏笔/增量策略/集成）

---

## 4.7.0 — 六维质量评分引擎 + 上下文增量更新 (2026-07-13)

### 🚀 新增功能

**实时监控 V2 Task 1: 六维质量评分引擎**
- 新增 `engine/quality/quality-score-engine.ts` 六维质量评分引擎
  - 六个维度：可读性、节奏、情绪饱满度、人物一致性、情节连贯性、语言质感
  - `QualityScoreEngine.evaluate()` 全量评估 + `evaluateDimension()` 单维评估
  - 增量评估：传入 `changedRange` 仅评估变更部分（人物一致性维度可跳过无变更范围）
  - 取消机制：支持 `AbortSignal`，评估中取消抛出 `AbortError`
  - 结果缓存：复用 `LruCache`，维度级 + 完整结果两级缓存，相同内容不重复评估
  - 历史趋势：记录最近 N 次评分（默认 20），支持 rising/falling/stable 趋势分析
  - 依赖注入复用现有引擎：`IRhythmAnalyzer` / `IEmotionAnalyzer` / `ICharacterChecker` / `WritingQualityEngine`
  - 每个维度降级规则：无注入时使用内置规则（零外部依赖）
  - 评估结果模型：`QualityScore`（总分 + 六维 + 问题列表 + 改进建议 + 趋势）

### 📊 测试覆盖（六维质量评分引擎）
- 新增 51 个单元测试（`tests/unit/engine/quality/quality-score-engine.test.ts`）
- 六维评分计算：每个维度评分正确、综合评分为加权平均
- 增量评估：changedRange 支持、人物一致性维度可跳过
- 评估结果缓存：相同内容命中、不同内容不命中、clearCache/invalidateCache
- 取消机制：AbortSignal 已取消/评估中取消/无 signal
- 问题描述与改进建议：字段结构、严重度排序、优先级排序
- 历史趋势：stable/rising、getHistory/clearHistory、上限裁剪
- 向后兼容：V1 WritingQualityEngine 测试全部通过（零回归）

**Task 4.3: 上下文增量更新**
- 新增 `engine/context/context-diff-detector.ts` 上下文变更检测器
  - `ContextDiffDetector.detectChanges()` 检测两个 GatheredContext 之间的差异
  - 支持 5 种变更类型：character-changed / chapter-changed / entity-changed / worldview-changed / timeline-changed
  - `createChangeSetFromPaths()` 将文件路径映射为变更集，用于增量更新流程
  - `getAffectedSections()` 返回需要重新计算的上下文分区
- 新增 `engine/context/incremental-updater.ts` 增量更新器
  - `IncrementalUpdater.updateContext()` 根据变更集仅重新获取受影响分区
  - `isIncrementalUpdateFaster()` 判断增量更新是否比全量更快（50% 阈值回退）
  - 上下文版本号机制：递增整数 + 时间戳，保留最近 20 次变更历史
  - 与 MultiLayerCache 深度配合：未变更部分从 L1/L2 缓存读取
- `ContextManager` 新增 `gatherIncremental()` 方法
  - 优先使用增量更新，变更范围 > 50% 时自动回退全量
  - 保持原有 `gatherAll()` 方法不变，新功能纯增量
  - 智能失效策略：文件修改时精确失效相关分区缓存（而非全部清空）
  - 新增 `getVersionHistory()` / `getCurrentContextVersion()` / `getIncrementalStats()`
  - 新增 `invalidateIncrementalCache()` 独立清除增量缓存

### 📊 测试覆盖
- 新增 62 个单元测试（context-diff-detector 34 + incremental-updater 28）
- 变更检测：各种变更类型的识别
- 增量更新：部分变更后结果与全量一致（一致性验证）
- 版本号机制：版本递增、历史记录、最大保留数
- 回退策略：变更范围过大时自动回退全量
- MultiLayerCache 集成：分区缓存命中与未命中
- 现有测试无回归（context-manager 46 + cache 69 + repository 210）

**写作指纹 V2 Task 1: 12 维数据结构定义与 V1 数据迁移**
- 新增 `engine/style/style-dimensions-v2.ts` V2 12 维数据结构定义
  - 12 个维度：RhythmStats / SentencePatternStats / WordChoiceStats / RhetoricStatsV2 / PerspectiveStats / EmotionStats / TensionStats / InfoDensityStats / DialogueStatsV2 / DescriptionStats / NarrationStats / LanguageTextureStats
  - 每个维度包含：定量统计字段 + 定性描述字段（50-100字）+ 代表性示例数组（2-3段）+ 数据状态标记（'complete' | 'pending' | 'partial'）
  - 维度常量：STYLE_DIMENSIONS_V2（12 维元信息数组）、V1_TO_V2_FIELD_MAP（V1→V2 字段映射）、V2_NEW_DIMENSIONS（5 个新增维度）
  - V2Fingerprint 完整类型：含 version 标识 + v1Backup 备份字段 + migratedAt 时间戳
- 新增 `engine/style/fingerprint-migrator.ts` V1→V2 迁移工具
  - `migrateV1ToV2()` 纯函数迁移：V1 的 7 维字符串映射到 V2 对应维度的 description（标记 complete），新增 5 维填充默认零值（标记 pending）
  - `migrateFileV1ToV2()` 文件级迁移：迁移前写入 `.v1.bak` 备份文件，迁移或写入失败时从备份自动回滚
  - `needsV1ToV2Migration()` 版本检测：幂等设计，已迁移的 V2 数据不会重复迁移
  - 工具函数：`getPendingDimensions()` / `getCompleteDimensions()` / `validateV2Fingerprint()` / `getDimensionStatusSummary()` / `rollbackV2ToV1()`
- 修改 `engine/style-fingerprint-library.ts` 集成自动迁移
  - `loadTemplate()` / `loadGlobal()` / `loadProject()` 三个加载方法在加载前自动调用 `migrateV1ToV2Dimensions()`（幂等，已迁移则跳过）
  - `migrateFingerprintV1toV2()` 方法支持三种输入格式：V1 旧格式、V1 新格式、V2 格式（从 v1Backup 提取 V1 特征）
  - V1 `StyleFingerprintFeatures` 和 `StyleFingerprint` 接口标记 `@deprecated`，保留 V1 API 向后兼容
  - 不修改 V1 拆解逻辑（style-deconstructor.ts 保持不变）

### 📊 测试覆盖（写作指纹 V2 迁移）
- 新增 50 个单元测试（`tests/unit/engine/style/fingerprint-migrator.test.ts`）
- V2 数据结构类型：12 维全部存在、每维有 status 字段、常量数组完整（STYLE_DIMENSIONS_V2 / V1_TO_V2_FIELD_MAP / V2_NEW_DIMENSIONS）
- V1→V2 字段映射：7 个 V1 字符串字段正确映射到 V2 description、V1 来源维度标记 complete、空字符串标记 pending
- 缺失维度 pending 标记：5 个新增维度 status='pending'、定量统计为零值、description 为空
- 迁移前备份：`.v1.bak` 文件生成、备份内容与原始 V1 数据一致、单个指纹和批量指纹均生成备份
- 迁移失败回滚：`rollbackV2ToV1()` 可从备份恢复、幂等检测、JSON 解析失败回滚、混合 V1/V2 数组只迁移 V1 项
- 迁移耗时 < 50ms：单次迁移、文件级迁移、批量迁移 10 个指纹均满足性能要求
- V1 API 兼容：`v1Backup` 保留 V1 原始 7 字段、`version='v2'`、`migratedAt` 时间戳、`validateV2Fingerprint()` 校验、`needsV1ToV2Migration()` 检测
- 现有测试无回归（style-similarity-scorer 13 + file-system-port 13 + settings-migrator 18 全部通过）

**写作指纹 V2 Task 2: StyleDeconstructor 升级到 12 维**
- 新增 `engine/style/style-deconstructor-v2.ts` V2 12 维风格拆解器
  - V2 内嵌 V1 实例，复用 V1 分析结果作为基础（完全向后兼容）
  - 主入口 `analyze(text)` 返回 `{features, stats, v1Result}`，V1 调用方可直接使用 v1Result 字段
  - `analyzeV1(text)` V1 兼容包装器方法
  - 12 维分析：rhythm / sentencePattern / wordChoice / rhetoric / perspective / emotion / tension / infoDensity / dialogue / description / narration / languageTexture
  - 7 维升级：节奏（标点密度、段落密度、停顿频率）、用词（常用词比例、生僻词、虚词）、修辞（通感）、视角（叙述距离）、对话（台词个性化）、叙事（叙事速度、时间跳跃、场景切换）、语言质感（古风化、地域特色）
  - 5 维新增：句式（倒装句、省略句、排比句、设问句、从句嵌套深度）、情绪（正负向比例、波动频率、强度分布）、张力（悬念词、冲突频率、转折句、伏笔标记、高潮分布）、信息量（信息密度、专有名词、设定植入、概念引入）、描写（环境描写、细节密度、感官分布、白描工笔比例）
  - 每维度生成 50-100 字自然语言描述（纯规则模板化）
  - 每维度筛选 2-3 段代表性示例片段（50-200 字）
  - 词表常量：约 20 个 Set 集合（情绪/悬念/冲突/感官/古风/地域等），零外部依赖
- 性能优化：跨词表合并正则匹配
  - 构造函数预构建合并结构：所有词表的单字词合并成大 Set，多字词合并成大正则
  - `analyze` 方法预计算所有词表 countKeywords 结果（一次遍历 + 一次正则匹配），各维度从预计算结果取值
  - `countChineseChars` 大文本缓存，避免重复遍历
  - V2 额外计算耗时 ≤ 1.5 倍 V1（预热后稳定通过）

### 📊 测试覆盖（写作指纹 V2 Task 2）
- 新增 53 个单元测试（`tests/unit/engine/style/style-deconstructor-v2.test.ts`）
- 基础结构与向后兼容：12 维全部存在、每维有 status 字段、v1Result 字段完整、analyzeV1 方法兼容
- 新增维度统计：句式（倒装/省略/排比/设问）、情绪（正负向比例/波动）、张力（悬念/冲突/转折）、信息量（专有名词/设定植入）、描写（感官分布/白描工笔）
- 7 维升级精细统计：节奏（标点密度）、用词（常用词/虚词）、修辞（通感）、视角（叙述距离）、对话（台词个性化）、叙事（叙事速度/时间跳跃/场景切换）、语言质感（古风化/地域特色）
- 自然语言描述生成：每维度 50-100 字、非空、反映文本特征
- 示例片段筛选：每维度 2-3 段、50-200 字、非空
- 性能测试：预热后 V2 额外耗时 ≤ 1.5 倍 V1、10 万字文本 10 秒内完成
- V1 API 向后兼容：analyzeV1 返回 V1 格式、v1Result 字段完整、V1 实例独立可用
- 边界情况：空文本、纯标点、超长文本、单句文本、无对话文本、纯对话文本
- V1 迁移测试 50 个全部通过（无回归）
- 现有测试无回归（style 目录 103 个测试全部通过）

## 4.6.0 — 版本管理与更新提示 (2026-07-12)

### 🚀 新增功能

**版本管理服务**
- 新增 `services/update-checker.ts` 更新检查服务
- 支持从 GitHub Releases 或自定义服务器检查最新版本
- SemVer 版本号比较，自动判断是否有新版本
- 可配置检查频率（每天/每3天/每周/每月），默认关闭（尊重用户隐私）
- 记录上次检查时间，避免频繁检查
- 检查失败不影响插件正常使用（静默降级）

**更新提示 UI**
- 设置页新增「ℹ️ 关于」标签页，包含版本信息区域
- 显示当前版本号、最新版本号、上次检查时间
- 提供「检查更新」按钮和「更新日志」按钮
- 可配置自动检查开关、更新源、检查间隔
- 有新版本时设置页顶部显示更新提示条
- 提示条包含新版本号和主要更新内容摘要
- 提供「查看详情」和「稍后提醒」按钮
- 插件加载时静默检查，不打扰用户

**版本变更日志**
- 新增 `shared/changelog-data.ts` 内置更新日志数据
- 包含最近 5 个版本的详细更新记录
- 新增 `ui/changelog-modal.ts` 更新日志模态框
- 支持按版本展开/折叠查看详情
- 分类显示：新增功能、优化改进、Bug 修复、破坏性变更

**首次安装欢迎引导**
- 新增 `ui/welcome-modal.ts` 欢迎模态框
- 首次安装时显示欢迎页面，包含插件介绍和功能卡片
- 快速开始指南，引导用户配置 API 并开始创作
- 提供「开始创作」、「打开设置」、「查看更新日志」入口
- 支持「不再显示此提示」选项

**版本升级引导**
- 大版本更新时自动显示更新内容模态框
- 版本升级时自动备份旧版本设置
- 数据迁移验证机制（基于已有的 settings-migrator）

### ✅ 质量保证
- TypeScript 编译：0 新增错误
- esbuild 构建：成功
- 外科手术式改动，不影响现有功能
- 所有新功能均可通过设置开关控制

### 🔧 技术优化

**UI 内联样式收拢（prompt-manager-settings.ts）**
- 将 8 类高频重复内联样式（3+ 次出现）替换为 CSS 类引用
- 新增 8 个 CSS 类到 styles.css v7.0 区域：
  - `.nw-modal-footer` / `.nw-modal-btn-primary` / `.nw-modal-btn-secondary`
  - `.nw-empty-center-muted` / `.nw-textarea-code` / `.nw-stat-muted-mt`
  - `.nw-h4-sm` / `.nw-action-btn`
- 内联样式从 68 处减少到 50 处（35 处替换完成）
- 剩余 50 处为低频单次模式（<3 次重复），按"3+ 重复才收拢"原则不强制处理
- TypeScript 编译验证通过，无新增错误

---

## 4.5.1 — 全流程测试 Bug 修复 (2026-06-29)

### 🐛 全流程 UI 测试发现的 Bug 修复

**P0：FullWriterView 多实例共存**
- `openFullWriterView` 复用 `existing[0]` 但不清理多余 leaf，导致多实例共存
- 多实例中未渲染的实例 `tabContent` 为 undefined，引发 `querySelector` 崩溃
- 修复：`existing.length > 1` 时 `detach()` 多余 leaf

**P0：协同写作正文路径错误**
- `getBodyPath`/`getStepResultDirs`/`getStepFilePath`/`checkPrerequisites` 用 `chapterName`（如"初始之痕"）作为路径前缀
- 与 `pjBodyFile`/`pjStepFile` 的 `第N章` 规范不一致，导致 `findBodyFileV4` 找不到正文文件
- 影响：章节结算、上下文采集、情节冗余检查全部失效
- 修复：全部改用 `第${chapterNum}章` 前缀

**P0：saveBody 丢失 frontmatter**
- `saveBody` 的 `modify(file, titleLine + body)` 覆盖整个文件，丢失 `涉及人物/涉及地点/涉及势力/涉及物品功法` 字段
- 导致 `settleLight` 无法写回实体状态
- 修复：保存前备份原 frontmatter，保存后通过 `processFrontMatter` 恢复关键字段

**P1：tabContent undefined 崩溃**
- `WizardStepExecutors` 构造函数时 `tabContent` 未初始化
- 修复：改为 getter 回调 `getTabContent: () => HTMLDivElement`

**P1：前置规划检查误报**
- `checkPrerequisites` 用 `chapterName` 拼接路径，找不到实际存在的文件
- 修复：改用 `第${chapterNum}章` 前缀，文件名改为 `信息规划.md`（与 `pjStepFile` 一致）

**P2：updateProgress null 检查缺失**
- tabContent 临时为 undefined 时崩溃
- 修复：添加 `if (!tc) return;` 防御性检查

### ✅ 验证
- TypeScript 编译：0 错误
- esbuild 构建：0 错误
- 全流程 UI 测试通过（项目创建→世界观→设定库→实体→大纲→建章→协同写作→章节结算）

---

## 4.5.0 — 数据安全架构升级 + 三层 Bug 修复 (2026-06-29)

### 🐛 三层完整链 Bug 修复（51 个 Bug，4 大根因簇）

**批次 1：模板-代码字段错位（10 P0）**
- 伏笔库 section "已揭示伏笔" → "已回收伏笔"，与常量/引擎一致
- 伏笔库解析从 6 列修正为 8 列索引（parts[0-7]），新增 relatedChars/relatedMainline
- 正文 frontmatter "涉及物品" → "涉及物品功法"，模板/类型/引擎/前端四处统一
- 时间线常量 TIMELINE_COLUMNS 从 4 列改为 7 列，与模板对齐
- 世界观模板从 6 section 扩展为 9 section，与 WV_SECTIONS 对齐
- 实体生成器 YAML 模板补充 entity_status/entity_created_at 等 4 个字段
- project-wizard-modal 统一用 wizard-types.ts 的 WizardStep 和 buildWizardSteps
- context-manager.ts 变量名 continuityReviewFile → reviewFile 修正

**批次 2：协同写作上下文塌陷（4 P0）**
- buildSnapshot 的 prevChaptersSummary 从 previous_chapter 对象正确读取 bodySummary/outline/ending/analysisReport
- ContextSnapshot 接口补充 settingLib/timeline/characterCores/triggeredMemories 4 个字段
- buildDirectionalPrompt system 段注入 allChars/allFactions/allLocs/allItems/writingRules
- buildDirectionalPrompt user 段注入 chapPlan/sceneExpansion/prevChaptersSummary/settingLib/timeline
- settlement-engine 新增 settleLight() 轻量结算（无分析报告时基于 frontmatter 写回实体）

**批次 3：路径/状态断裂（6 P0）**
- co-writing-view onClose 新增 ghostDebounceManager.dispose() 和 liveAnalysis.clearTimers()
- 删除 _liveTimerIds/clearLiveTimers/_addLiveTimer 死代码
- getBodyPath 改用 chapterName，与 getStepResultDirs 一致
- generate-worldview-modal 设定库路径改用 pjSettingLib() 函数
- CoWriterEngine 改为 plugin.coWriterEngine 单例共享（懒加载）

**批次 4：entity_* 状态链 + P1（20 P1）**
- 校验器补充 entity_status/entity_created_at 字段检查
- entity-state-manager 正则从双重转义修正为单反斜杠 /^(---\s*\n)/m
- 物品功法模板 entity_status 从 draft 改为 active
- 前端人物字段列表统一引用 CHARACTER_DISPLAY_KEYS 常量

**批次 5：P2 优化项和死代码清理（11 P2）**
- 删除 CrossViewStateManager 死代码
- suggestion-history-store/main.ts/create-project-modal 裸路径替换为 paths.ts 函数
- WizardStep.status 添加类型注释，明确与 CHAPTER_STATUS 不同

**编译错误修复**
- context-manager.ts:869 cachedRead 补充 getAbstractFileByPath() as TFile 转换
- TypeScript 编译 0 errors，esbuild 构建 0 errors

---

## 4.5.0 — 数据安全架构升级 (2026-06-27)

### 🛡️ P0 级数据安全增强

**1. 串行写入器（SerializedWriter）接入主设置保存**
- **main.ts** `saveSettings()` 改用 `SerializedWriter.enqueueAutoClean()`，保证设置写入原子性
- 防止高频保存（滑块拖动、连续切换）导致的并发写入冲突
- `onunload` 时触发 `flush()` 尽力确保所有写入完成
- 此前已在 style-learner / preference-memory 中使用

**2. 设置版本迁移机制**
- 新增 `shared/settings-migrator.ts` — 统一的 schemaVersion 迁移框架
- 当前 schemaVersion = 2，支持 v0→v1→v2 链式迁移
- 迁移失败时降级处理，不崩溃，保留原始数据
- `loadSettings` 自动检测版本并执行缺失的迁移
- 为未来格式升级提供安全保障，彻底解决用户数据丢失风险

**3. 缓存数据独立文件存储（渐进式）**
- 新增 `shared/plugin-cache.ts` — PluginCacheManager 缓存管理器
- 缓存文件路径：`.obsidian/plugins/novel-writer-ai/data/cache.json`
- 已分离缓存项：panelLayout（浮窗布局）、modelOverrideHistory（模型覆盖历史）
- 当前采用「双写」策略：settings 和 cache 同时写入，确保向后兼容
- 内置 SerializedWriter 串行写入，保证缓存文件原子性
- 下一版本可平滑切换为「读 cache 优先 + 从 settings 移除」

### 🔧 架构优化

**防抖系统全面统一**
- 6 个防抖场景 100% 接入 AdaptiveDebounceManager
- 新增协同写作场景：实时分析、设定守卫、幽灵联想
- 详见 v4.4.0 更新日志

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过
- 新增文件均通过严格类型检查

## 4.4.0 — 自适应防抖管理器版 (2026-06-27)

### 🚀 新增功能

**AdaptiveDebounceManager 自适应防抖管理器**
- **核心实现**：`shared/adaptive-debounce-manager.ts` — 统一防抖基础设施，支持固定延迟与自适应延迟两种模式
- **自适应算法**：根据输入速度动态调整延迟（快速输入→长延迟减少写入，慢速输入→短延迟提升响应）
  - 快速模式：>3 次/秒，延迟 500ms
  - 中速模式：1-3 次/秒，延迟 300ms
  - 慢速模式：<1 次/秒，延迟 100ms
- **内存管理**：自动清理 5 分钟未使用的 key 历史记录，防止内存泄漏
- **可配置**：支持自定义三档延迟、阈值、历史窗口、调试模式

### 🔧 架构优化

**防抖逻辑统一重构**
- **main.ts**：设置保存（500ms 固定）+ 正文变更实体状态重检（3000ms 固定）→ 改用 `debounceFixed`
- **polish-editor.ts**：润色编辑器自动保存（500ms 固定）→ 改用 `debounceFixed`，新增 `destroy()` 方法
- **live-analysis-controller.ts**：实时分析刷新 + 设定守卫检查（双定时器，trigger 敏感延迟）→ 改用 `debounceFixed`
- **co-writing-view.ts**：幽灵联想刷新（2600ms 固定）→ 改用 `debounceFixed`
- **消除重复模式**：移除 6 处重复的 setTimeout + clearTimeout 手动管理模式
- **资源清理**：统一 `dispose()` 接口，插件卸载时清理所有待执行定时器

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过（新增 20 个防抖管理器单元测试）
- 新增测试覆盖：基础防抖、自适应切换、内存管理、并发安全、dispose 清理等

## 4.3.1 — 技术债清理版 (2026-06-27)

### 🔧 代码质量改进

**P2 级技术债修复**
- **通知时长常量化**：11 个文件 50+ 处硬编码 `showNotice` 时长替换为 `thresholds.ts` 中的 `NOTICE_ERROR`/`NOTICE_WARNING`/`NOTICE_CRITICAL` 常量
- **插件数据路径统一**：`shared/paths.ts` 新增 `pluginDataDir()`/`pluginPreferenceFile()`/`pluginStylePatternsFile()`，消除硬编码路径
- **伏笔解析代码去重**：`foreshadow-manager.ts` 提取共享 `parseForeshadowTableContent` 函数
- **分析报告状态透明化**：`analysis-report-engine.ts` `applyReportChanges` 返回结构化状态对象，用户可区分自动应用与待手动处理
- **JSON 解析容错增强**：`intervention-controller.ts` `callUnderstandingAPI` 添加 try-catch 保护

**依赖更新**
- `preference-memory.ts`、`style-learner.ts` 改用 `paths.ts` 统一路径函数
- `review-agent.ts`、`settlement-engine.ts`、`ai-api-client.ts` 等全面常量替换

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：141/141 通过

## 4.1.1 — 架构重构版 (2026-06-25)

### 🏗️ 架构重构（引擎层回调模式）
- **step-runner-callbacks.ts 新增**：StepRunner 回调接口，engine 层通过 callbacks 与 UI 层解耦
- **step-runner.ts 重构**：移除所有 `new Notice()` 调用（52 处 → 改为 `this.callbacks.*`），移除 `showProgress/showSuccess/showError/hideProgress` 直接调用
- **shared/paths.ts 注释更新**：标记 `readProjectMeta` / `isProjectFolder` 为 Obsidian API 耦合（计划 v4.1.2 迁移）
- **settlement-engine.ts 注释更新**：标记 19 处 `new Notice()` 为待改进项（计划 v4.1.2 迁移）
- **engine → ui 依赖清理**：engine 层不再直接操作 DOM 或调用 Obsidian UI

### ✅ 质量保证
- TypeScript 编译：通过
- Vitest 测试：60/60 通过

## 4.0.0 — 稳定性增强版 (2026-06-25)

### 🚀 AI 引擎增强
- **SSE 流式输出**：正文生成期间实时反馈，支持用户中断
- **Token 精细化估算**：中英混合分层估算，模型特定 tokenizer 效率感知，提前拒绝超窗口输入
- **多模型智能并发**：推理模型 1 并发 / 标准 2 / Flash 4，429 限流自动退避
- **模型能力集中化**：`shared/model-capabilities.ts` 统一 65+ 模型配置，支持自定义供应商

### 🎨 CSS 架构重构
- **!important 839→299** (-64%)：提高选择器特异性替代 !important
- **重复选择器合并**：cowrite 三栏/suggestions/editor-wrap 去重
- **Fallback 变量收敛**：radius-lg/md/sm 与 :root 权威值完全一致
- **内联 CSS 迁移**：wizard 导航栏按钮样式 → CSS 类名

### 📐 架构优化
- **wizard-controller 抽离**：full-writer-view 2228 行 (-55%，基线 4954)
- **ai-engine 拆分**：ai-types.ts + ai-prompt-builder.ts 外迁 (2712 行)
- **双轨残留清理**：移除 6 个废弃阈值常量，@deprecated 注释清理

### 🧪 测试基础设施
- **Vitest 入库**：60/60 测试通过，89.6% 行覆盖
- Obsidian API Mock 完整实现

### 🔧 运行时稳定性
- **P0 全部修复**：8 项运行时 Bug 清零，0 崩溃路径
- **@ts-ignore 清零**：79→0，WizardViewAccess 接口替代 `as any`
- **静默吞错修复**：chapter-utils 3 处 catch → console.warn
- **监听器泄漏修复**：全部注册到 registerEvent()
- **settlement 回滚修复**：NEW 文件清理，伏笔库 hasPartialFailure
- **main.ts 侧边栏修复**：getLeaf('tab') + null 检查

### 📝 代码质量
- **console 降噪**：3 处冗余 log → debug
- **findBodyFileV4 修复**：恢复 v4 目录结构正文查找
- **类型安全加固**：WizardViewAccess 接口定义

---

## 3.3.0 (2026-06)

- V2 灵魂驱动架构：角色灵魂层 + 情绪弧规划 + Scene 展开
- 关系引擎 + 情绪审计
- 句级协同写作工作台
- 文笔风格自学习 (E1)
- 多模型 fallback 切换
- tsc --noEmit 0 error

## 3.2.0 及更早

- 全流程 AI 长篇小说创作系统
- 防 OOC、设定追踪、多 Agent 协作
- 跨卷状态继承、文笔风格蒸馏
- QuickAdd + Obsidian 集成

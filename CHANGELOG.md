# Changelog

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

---

## Unreleased — v8.13 P3 写作规范双向合并与规则解析修复

### 🧭 动因
对「P3 写作规范」（`engine/prompts/writing-rules.ts` 的代码副本）与官方规范（`元文件/00-系统模板/写作规则.md`）逐章对齐调研后，确认 7 个问题点，其中 2 项有运行时铁证。差异报告显示两版为**双向往差异**（规范独有 18 项 / 副本独有 13 项），单向对齐任一方都会丢内容，故按用户裁定执行「双向合并 + 结构统一」。

### ✨ 改动
- `元文件/00-系统模板/写作规则.md`（**规范** · v3.5.1 → v3.6.0）：双向合并为单一内容 —— 补入副本独有 13 项（新增 `## 十五、不讲精确数字，不讲门牌号` 整章；并在「一/二/四/六/七/九/十/十二/十三/十四/唯一禁止事项」各章内补入对应条目与示例），原「十五、写作自检」顺延为 `## 十六、写作自检`，文末新增 `## 你的风格（由文笔风格文件定义）`。**`## ` 章节 / `### ` 子节 / `- [ ]` 自检清单 / `---` 分隔与分割线等格式要素全部保持原结构不变**（解析器契约）。
- `engine/prompts/writing-rules.ts`（**代码副本**）：`WRITING_RULES` 由原 `【…】` 12 块改写为与规范**逐字一致**的同结构镜像（含 `# 标题`、`> 核心理念/叙事总纲`、16 个编号章、`### 标点/段落/对话/字数`、9 条 `- [ ]`、分割线与唯一禁止事项）。仅省略 YAML frontmatter（属文件元数据，非注入内容）。
- `engine/context-manager.ts`（**规则解析缺陷修复**）：`parseWritingRules` 中 `section.split(/^###\s/)` 缺 `m` 标志 —— `^` 只匹配整串开头，而段首是「格式参考（最低要求）」而非 `### `，导致 **`rules.mandatory` 恒为空**、「格式参考（最低要求）」的 4 个规则块（含「每章≥2000字」）从未进入提示词，`co-writer-engine` 的 `writingRules` 变量因此恒为 `''`。补 `m` 标志修复。
- `engine/prompts/index.ts`：子文件职责注释由「全局写作 15 心法」更正为「16 心法 + 格式参考；与元文件规范同结构」。

### ✅ 验证
- 新增 `tests/unit/engine/context-manager-writing-rules.test.ts`（**6 例**）锁定解析契约：规范结构三路均非空、编号章并入 style、**`【…】` 结构 → 三路全空**（对齐必要性证据）、空内容安全、以及 `WRITING_RULES` 自身满足契约（mandatory 4 块 / checklist 9 条 / 16 个编号章 / 不含 `【`）。
- **逐章交叉校验（`identical` 比对）**：`.md` 去 frontmatter 后与 `.ts` 模板体 **逐字一致** —— 字符数 3827 = 3827，结构计数完全相同（编号章 16、`## ` 19、`### ` 4、`- [ ]` 9），行数 208 = 208。
- 运行时前后对比（`obsidian eval` + `dev:console`）：
  - 解析结果：`mandatoryCount` **0 → 4**（titles `标点/段落/对话/字数`，points 4/3/2/5）、`checklist` 9、`styleLen` **2482 → 2915**。
  - 版本告警：修复前每次加载均输出 `[WARN] 写作规则版本不匹配: 当前 v3.5.1, 期望 v3.6.0` 并弹 Notice；修复后 warn 面板**无该条**（`expected` 常量 3.6.0 与内容 3.6.0 一致，无需改代码）。
- 全量：`npm run typecheck` 零错误；`npm test` → **160 files / 2984 tests passed**；`npm run build` 成功；`dev:errors` = `No errors captured`。
- 既有断言同步：`tests/unit/services/template-service.test.ts` 的 `getWritingRules` 用例原断言固定了旧副本措辞「活在主角身体里」，改为断言规范结构锚点（`一、角色活着` / `十六、写作自检`）。

### 📌 登记（不改）
- `services/template-service.ts:30` 导入 `WRITING_RULES` 但全文件未使用（死导入）；按「不修没坏的东西 / 死代码只提出不删」原则只登记。

---

## Unreleased — v8.12 全流程 / 压力 / 异常场景验证、取消语义与跨端加固

### 🧭 动因
目标第 4 项「全流程功能测试、压力测试与异常场景验证」的实测过程中，发现并修复 6 处引擎缺陷（均对合法流程无副作用）。随后经用户明确授权，对本轮登记的行为变更项执行**第二批加固**（跨端导出统一、长会话历史限长、伏笔去重算法、遗留目录清理），兼容底线不变（旧项目数据可读 / 旧版报告读取兼容 / 不改变既有设置键名）。

### ✨ 改动（均以确定性回归用例或运行时探针锁定）
- `engine/ai-api-client.ts`（取消语义 ① · 联调解绑时机）：`callAI` / `callAIStream` / `nativeStreamIterator` 三处的「外部 abort 联动内部 abort」监听原先在**拿到响应头后即 `removeEventListener`**，导致响应体读取阶段无法取消（实测中止后仍等待约 20s）。改为监听挂载上提到 `try` 之前、`finally` 内解绑，使取消覆盖整个请求生命周期。修复后实测：**中止 → 1ms** 返回。
- `engine/ai-api-client.ts`（取消语义 ② · catch 判定优先级）：`callAI` 的 catch 中 `shouldFallback`（`AbortError` 在 `isDisconnectionError` 中同属「断联」特征）先于 `externalSignal?.aborted` 判定，与代码自述「外部 abort 不触发回退」相反 —— 用户取消会被误判为断联并**切换到其他模型继续生成**。改为取消判定优先。运行时实测：取消后 `fetch` 仅调用 1 次（内存注入备用模型观察，未切换）。
- `engine/ai-api-client.ts`（取消语义 ③ · 流式降级空跑）：`callAIAsyncIterator` 在原生阶段因取消而「返回」`aborted` 时，被误判为阶段失败并继续空跑 `simulated`/`full` 两阶段、打印误导性「流式降级」警告。改为在 native / simulated 分支 `yield*` 返回后检测 `externalSignal?.aborted` 短路（已完成的内容原样返回，不丢）。运行时复核：取消时**无「流式降级」警告**。
- `services/knowledge-base-manager.ts`（索引重建加固）：`rebuildIndexFromBooks` 原先仅校验 `id` 即接纳条目 —— 历史/损坏的基本信息可能**缺少 `name`**，被接纳后任何 `kbBookDir(book.name)` 都会因 `undefined.replace` 抛 `TypeError`。改为同时要求有效书名；缺失则跳过并 `warn`。对合法书籍无影响（合法文件始终含 `name`）。
- `shared/settings-migrator.ts`（v3→v4 类型加固）：损坏的 `data.json` 若把 `customProviders` / `hiddenPresets` 写成非数组（如字符串），原 `|| []` 只挡 falsy，真值非数组会在 `.map` / `.includes` 处抛 `TypeError` → 迁移中断、`schemaVersion` 停在 3，且 `customProviders` 退化为字符串污染后续 `.find` / `.filter`。改为 `Array.isArray(...) ? ... : []`。
- `engine/ai-api-client.ts`（本地模型源密钥守卫）：`callAI` / `callAIStream` 硬性要求 `apiKey`，而内置「本地 Ollama」预设无密钥、`providerKeys` 也无 `ollama` 条目（切到本地供应商时 `providerManager` 会把 `apiKey` 置空）——导致**本地模型配置下所有非流式 AI 调用（含 `step-runner` 流水线）直接返回「API密钥未配置」，功能不可用**；且与不校验密钥的流式迭代器路径行为不一致。改为仅当端点经 `resolveProviderSourceType` 判定为 `local` **且**密钥为空时豁免守卫（新增私有方法 `isKeylessLocalEndpoint`）。云端端点与「显式传入非空密钥」的行为完全不变。

### ✨ 改动（第二批 · 用户授权的行为变更加固）
> 以下 4 项在 v8.11 / v8.12 首次登记时因「会改变既有行为」被挂起；本轮经用户明确授权实施，兼容底线（旧项目数据可读 / 旧版报告读取兼容 / 不改变既有设置键名）不变。
- `shared/export-file.ts`（**新增** · 跨端导出统一）：此前 7 处导出（`ui/mini-settings-modal.ts` / `ui/settings-tab.ts` 性能日志、`ui/prompt-manager-settings.ts` 提示词配置、`ui/quality-dashboard-modal.ts` 质量数据集、`ui/template-manager.ts` 单模板与全模板、`ui/views/knowledge-base-view.ts` 自定义题材）各自复制同一段「`URL.createObjectURL` + `<a download>`」blob 代码，**移动端无下载器会全部静默失效**。新增统一入口 `exportTextFile(app, filename, content, options?)`：桌面端行为与改造前逐字一致（blob + 锚点下载）；移动端（`app.isMobile`）改为写入 vault 根目录「导出文件/」（文件名按 `[\\/:*?"<>|]` 净化、已存在同名则覆盖），并在 Notice 中给出实际路径；返回 `{ ok, mode: 'download' | 'vault', path?, error? }`。7 处调用点全部改为该入口。
- `engine/co-writer-engine.ts`（长会话历史限长）：`recordInteraction` 同时向 `interactionHistory` 与 `session.interactions` 追加，此前**只增不减**。新增模块级 `MAX_INTERACTION_HISTORY = 200`，超出时 `splice` 裁掉最旧记录（滚动窗口），两处数组同步限长。
- `services/foreshadow-manager.ts`（伏笔去重算法）：`textSimilarity` 由**单字符集合 Jaccard** 改为**字符 bigram Dice**（`2|A∩B| / (|A|+|B|)`，天然长度归一化），降低「共用『的/了/他』等高频字即高相似」的误判；调用点 `> 0.7` 阈值保持不变。
- 遗留数据清理：删除 `写作知识库/undefined/`（旧版本 `kbBookDir` 加入字符净化之前、以 undefined 书名创建的孤立目录）。

### ✨ 改动（第三批 · 用户授权补做 S1 与 modelOverrides 守卫）
> 两项均为 v8.11 / v8.12 登记后经用户追加授权的加固；对合法数据与正常流程零影响。
- `ui/full-writer/outline-tree-controller.ts`（**S1** · 文档级监听解绑）：`render()` 内的 `document.addEventListener('click', ...)` 原为**匿名监听**（无法移除），且 `render()` 每次调用都会新增一份 —— 重复渲染会**叠加监听**并持续泄漏（对比 keydown 虽为具名局部函数，但未保留引用同样无法解绑）。改为把两个句柄保存为实例字段（`_onDocumentClick` / `_onDocumentKeyDown`），新增幂等的 `dispose()`（解绑两者并关闭右键菜单），并在 `render()` 开头先 `dispose()` 再绑定 —— 重复 render 不再叠加。该控制器当前休眠（`full-writer-view.ts:1188` 的调用被注释），故无存量行为变化；若日后恢复树状预览，在视图 `onClose()` 调用 `dispose()` 即可。
- `shared/settings-migrator.ts`（**modelOverrides 类型守卫**）：`provider-manager.setModelOverride` 执行 `overrides[endpoint] = {}`，若 `modelOverrides` 被损坏为**字符串**，对原始值赋属性在严格模式下抛 `TypeError`（运行时实证：`THROW TypeError`）→ 覆盖值无法保存。此外 `v2→v3` 的 `{ ...oldOverrides }` 对**数组**会产出索引键对象（`{0:'a'}`）污染两层索引结构。改为：`v2→v3` 排除数组；`v3→v4` 显式把 `modelOverrides` 规范为普通对象（非对象 / 数组 → `{}`，与 `settings-service` 默认值等价，即「无覆盖」）。其余消费点均为可选链访问，合法对象行为完全不变。

### ✅ 验证
- 回归（三批合并后的最终态）：`npm run typecheck` 零错误；`npm test` → **159 files / 2978 tests passed**；`npm run build` 成功（v4.10.7，含 3 个 Worker bundle）。
- 新增确定性用例（4 例）：`tests/unit/engine/ai-api-client.test.ts`（流式取消时 `callAI` **不被调用**；本地端点空密钥不被拦截且 `fetch=1`；云端端点空密钥仍拦截且 `fetch=0`）+ `tests/unit/shared/settings-migrator.test.ts`（损坏类型下迁移仍完成、`customProviders` 必为数组）。其中「流式取消短路」已用「临时移除修复」方式证明在旧代码下失败（`callAI` 被调用 1 次）；「损坏类型」与「本地端点」两项的失败模式分别由运行时探针实证（旧代码报 `customProviders.map is not a function` / `schemaVersion` 停在 3；旧代码本地端点返回 `API密钥未配置`）。
- 运行时（`obsidian eval`，真实插件配置）：
  - 原生流式：首片到达后 `abort()` → **1ms** 结束，`fetch` 调用数 = 1，返回 `error:'aborted'`，无「流式降级」警告；定时 1.2s 取消 → 总耗时 1201ms。
  - 知识库索引重建（临时可见目录 + 校验后清理）：**修复前** → 无 `name` 的书籍被登记，`getSourceText` 抛 `Cannot read properties of undefined (reading 'replace')`；**修复后** → 仅有效书籍被登记（`warn`「跳过缺少有效书名或 id 的基本信息」），`getSourceText` 优雅降级为「书籍不存在」。
  - 损坏配置恢复：`null` / 字符串 / 数字 / 数组 / `schemaVersion:'x'` / `deconstructionEngine:'nope'` / 非数组 `customProviders` / 非数组 `modelOverrides` / `ruleLayer:'x'` 共 9 类载荷经 `SettingsService.loadSettings()` **均不抛异常**且回落默认值；修复后非数组 `customProviders` → 正常落地为 5 个内置预设的数组。
  - 本地模型源密钥守卫（真实配置为「本地 Ollama + 空 `apiKey`」）：修复前该配置下 `callAI` 直接返回 `API密钥未配置`（`fetch` 0 次）；修复后对 `http://localhost:11434/api/generate` → `fetch` 1 次、返回内容 `OK`，对 `https://api.example.com/...` 仍拦截（`fetch` 0 次、`error:'API密钥未配置'`）——证明豁免只作用于本地端点、云端行为不变。
- 异常 / 压力（沿用本轮实测）：8 个拆解器对空串 / 纯空白 / 极短文本均 `ok`；200k 字拆解 22–163ms；500k 字 347–426ms；100k 字报告渲染 14ms；`setVectorEnhancer(undefined)` 后 `analyzeWithVector` 仍 `ok` 并自动复原。
- 只读覆盖核对：`degradation-notifier`（sink 广播 / 注销 / 隔离、severity 分级、单例）与 `style-similarity-scorer`（依赖缺失降级）单测齐备，降级事件机制与 A3 接线有据。
- 兼容性边界（`obsidian dev:mobile` 移动端仿真）：`isMobile` / `mobileLayout` 均为 true 下，四视图（full-writer / co-writing / knowledge-base / writing-fingerprint）均成功打开并渲染（各 1 leaf、容器有子节点），自定义设置面板 **16 个 tab** 正常渲染，`dev:errors` = `No errors captured`；验证后已关闭仿真、恢复桌面模式（`isMobile:false`）。
- 长会话内存曲线（协同写作，第二批加固后复测）：向引擎 `recordInteraction` 注入 5000 条（`suggestions: []` 以跳过落盘学习，无用户数据副作用）→ `interactionHistory` **稳定封顶于 200**（`capped:true`）、循环耗时 **4ms**、`usedJSHeapSize` 全程持平（193315KB）；验证后已 `plugin:reload` 还原（复检 `historyLength:0`）。
- 第二批新增确定性用例（9 例）：`tests/unit/shared/export-file.test.ts`（3 例：桌面端走 blob 下载且不写 vault、下载锚点 `href`/`download`/`click` 正确；移动端写入「导出文件/a_b_c.json」且非法字符被净化为 `_`；同名已存在时改走 `modify`）+ `tests/unit/services/foreshadow-similarity.test.ts`（6 例：含「仅个别字之差的近重复相似度仍 > 0.7」「同字异序相似度 < 0.4」「空串 / 单字符不抛异常」）。测试环境为 `node`（无 jsdom），桌面端用例按仓库既有约定手工注入最小 `document` 垫片。
- 移动端导出链路实测（`obsidian dev:mobile`，真实 `app.isMobile === true`）：对真实 vault 执行移动分支的 API 序列 —— `adapter.exists('导出文件')=false` → `adapter.mkdir` → `vault.create('导出文件/nw-export-probe.json')` → `getAbstractFileByPath` 命中 `TFile` → `vault.read` 取回内容 → `vault.delete` 清理，**全链路成功**；随后关闭仿真、清理探针目录（复检 `isMobile:false`、`导出文件` 无残留）、`dev:errors` = `No errors captured`。
- 批量建章编排回归新增（2 例，`tests/unit/ui/batch-create-modal.test.ts`）：`BatchCreateModal.batchCreate` 此前**无任何测试覆盖**（入口仅存在于 Modal）。用例以真实路径助手（`pjBodyDir` / `pjStepDir` / `pjBodyFile`）+ 真实章节工具（`mkdirp` / `findChapterFile` / `findBodyFileV4` / `normalizeChapterFiles`）驱动，断言：3 章 × 8 类步骤文件 + 3 个正文文件全部落在正确路径、卷/章目录均已创建；第二轮执行**幂等**（文件数不变、模板不再被调用）。其间为共享 mock 补 `Notice.hide()` / `setMessage()`（原 mock 缺失，属测试基础设施补齐，不影响任何既有用例）。
- 批量建章模板链实测（`obsidian eval` + 临时项目 `nw-tmp-batch-verify`，校验后整体删除、无残留）：以真实 `TemplateService` 对 8 类步骤键 + `body` 用 `batchCreate` 相同变量（`{project, volume:'第1卷', chapterName:'第1章', chapterNumber:1}`）渲染并写入真实 vault，结果为 **9 个文件全部落在预期路径**、模板长度 124–539 字符（均为非空）、输出中**无残留 `第X章` 占位符**、正文 frontmatter 的 `卷: ""` 已正确替换为 `卷: "第1卷"`。过程中 4 个模板（情绪规划 / Scene展开 / 角色灵魂 / 质量控制）在 `元文件/00-系统模板/` 下**不存在**，自动回落到 `DEFAULT_TEMPLATES`（`warn` 日志可见）——证明批量建章在任何模板缺失情形下也**不会产生空文件**；静态复核亦确认 `DEFAULT_TEMPLATES` / `TEMPLATE_PATH_MAP` 均含 batchCreate 使用的全部 8 个键。
- 第三批新增确定性用例（7 例）：`tests/unit/shared/settings-migrator.test.ts`（+4：`v3→v4` 字符串 / 数组 `modelOverrides` 均规范为 `{}` 且迁移完成、合法对象原样保留；`v2→v3` 数组不产出索引键对象）—— 追加后该文件 **23 例全通过**；`tests/unit/ui/outline-tree-controller-dispose.test.ts`（3 例：`dispose()` 解绑 click/keydown 并置空句柄、幂等、无句柄不抛异常）。
- 第三批运行时前后对比（`obsidian eval`，经真实 `SettingsService` 构造实例载入载荷）：
  - **修复前**（旧构建）：`modelOverrides:'nope'` 迁移后 `typeof === 'string'`、`['a','b']` 迁移后 `Array.isArray === true` —— 字段类型未收口。
  - **修复后**（新构建）：字符串 → `typeof === 'object'`、数组 → `Array.isArray === false`，两者 `schemaVersion` 均为 4 且无异常；合法两层对象 **原样保留**（`api.example.com / gpt-4 / maxContext: 100` 命中）。
  - 崩溃机理独立实证：严格模式下 `const o='nope'; o['k']={}` → **`THROW TypeError`**，确认 `provider-manager.setModelOverride` 的 `overrides[endpoint] = {}` 在字符串字段下必然抛错。
  - S1 落盘核对（控制器休眠、无运行时可编程入口，故核验产物）：`main.js` 已含 `_onDocumentClick` / `_onDocumentKeyDown` 字段与 `document.removeEventListener("click"/"keydown", ...)` 解绑语句，确认非空改。

### 📌 登记（本批未实施，待用户决策）
- ✅ **已实施（第二批）** · **遗留数据 `写作知识库/undefined/`**：原登记项 —— 来自旧版本（`kbBookDir` 加入字符净化之前）以 undefined 书名创建的孤立目录，含 `基本信息.md`（id `kb_mrgfvtkj_dft4ogtb`，无 `name`）、索引为 0 本书。本轮经用户授权已删除（详见上「改动（第二批）」）。
- ✅ **已实施（第二批）** · **协同写作 `interactionHistory` 无上限**：原登记项 —— `co-writer-engine.recordInteraction` 向 `interactionHistory` 与 `session.interactions` 追加且无上限（对比：UI `suggestionHistory` 已限 20）。本轮经用户授权已加 `MAX_INTERACTION_HISTORY = 200` 滚动上限（详见上「改动（第二批）」）；`ui/co-writing-view.ts:3754` 消费该历史的渲染行为随之变为「仅展示最近 200 条」，此为已确认接受的行为变更。
- **本轮未覆盖（已进一步收窄）**：批量建章仅剩 **Modal 表单交互层**（下拉选项目 / 输入起止章 / 点击按钮）未做自动化（入口仅存在于 Modal、依赖真实 UI 点击）；其**编排逻辑**已由新增 2 例回归覆盖，**真实模板链 + 真实 vault 落盘**已由运行时实测覆盖（含模板缺失回落），**组件级**压测为 40 章 × 9 模板 = 360 次渲染 / 100ms → **2.51ms/章**。真实移动端**硬件**（非仿真）上的 blob Worker 可用性仍属既有 S3 登记项；`URL.createObjectURL` 导出下载的移动端失效问题已由本批统一入口的 vault 回退解决（**仿真环境**已验证），真机复测仍待用户侧确认。
- ✅ **已实施（第三批）** · **`S1` 休眠事件监听清理**：原登记项 —— `ui/full-writer/outline-tree-controller.ts` 的 `document` 级监听无解绑入口（且重复 `render()` 会叠加）。本轮经用户授权已补幂等 `dispose()` 并在 `render()` 起始解绑（详见上「改动（第三批）」）。
- ✅ **已实施（第三批）** · **`modelOverrides` 类型守卫**：原登记项 —— 非对象/数组形态的 `modelOverrides` 未收口。此前评估「不崩溃」被运行时实证推翻：字符串字段下 `provider-manager.setModelOverride` 的 `overrides[endpoint] = {}` 会抛 `TypeError`（属真实缺陷）。本轮经用户授权已在 `v2→v3` / `v3→v4` 双重收口（详见上「改动（第三批）」）。
- **未实施（待决策）**：`P3` 写作规范逐章对齐（需人工定稿，见 v8.11 登记）；`engine/analysis-report-engine.ts` + `ui/components/analysis-report-panel.ts` 未接线模块（兼容底线未含「允许删除」）—— 均无代码缺陷，待用户明确授权后再动。

---

## Unreleased — v8.11 引擎加固与规则可配置化（A/S 批次 + R2 / R1）

### 🧭 动因
延续 v8.10 的「仅无副作用改动」原则，完成 P/R/A/S 四组候选中剩余批次：A（核心算法可解释性 / 降级提示）、S（引擎加固）、R2（AI 味词表可扩充，含 Worker 侧改造）、R1（业务阈值设置项化）。所有改动在默认配置下行为与 v4.10.7 完全一致。

### ✨ 改动
- `engine/anti-ai-detector.ts`（A1）：`AIDetectionFeature` 新增可选 `score`（分项原始得分，仅用于向用户解释「分数从哪来」，不参与总分计算）；`detect()` 为模板短语 / 句式模板 / 高频词 / 统计特征各分项填充该字段。
- `ui/components/ai-detection-report.ts`（A1）：雷达图后新增「评分构成（相对贡献）」段落，按分项得分降序展示「分值 · 占比」；复用既有 CSS 类，未新增任何样式。
- `engine/co-writer-engine.ts`（A3）：精准模式向量增强初始化失败由「仅写日志」改为上报统一降级事件（`warning` → 用户可见提示），精准模式降级不再是黑箱。
- `services/foreshadow-manager.ts`（A3）：伏笔向量增强 / 向量去重不可用时的静默回退补 `info` 级降级事件（不弹 Notice，避免逐章噪音）。
- `engine/character-recognition-pipeline.ts`（A3）：向量语义过滤 / 合并层不可用跳过时补 `info` 级降级事件。
- `engine/anti-ai-detector.ts`（R2）：`AI_HIGH_FREQ_WORDS` 由 `static readonly` 改为「内置基线 + 用户扩充」的只读 getter，新增 `setExtraHighFreqWords()` / `getExtraHighFreqWords()`（去空白、去重、剔除与内置重复项）；L1 词频层同步纳入扩充词。
- `engine/deconstructors/readability-deconstructor.ts`（R2）：连接词密度词表由构造期缓存改为**每次检测实时合成**，否则运行中改动词表不生效。
- `services/deconstruction-worker-manager.ts` + `engine/deconstructors/deconstruction-worker.ts`（R2）：Worker 是独立 bundle、主线程设置无法自动抵达，改为**随任务载荷下发**扩充词并在 Worker 内同步词表（载荷仅在扩充词非空时附加该字段，默认与改造前完全一致）。
- `shared/thresholds.ts`（R1）：新增 `BUSINESS_THRESHOLD_DEFAULTS` / `setBusinessThresholdOverrides()` / `getBusinessThreshold()`；阈值定义权仍在本文件，运行时仅做覆盖，未覆盖即等于内置常量。
- `engine/step-definitions.ts`、`engine/step-runner.ts`（R1）：`WORD_MIN_RATIO`（步骤最低字数比例）、`PROMPT_SPLIT_RATIO`（超长提示词保头比例）两处**确实被调用**的阈值改走 `getBusinessThreshold()`。
- `main.ts` / `core/settings-service.ts` / `ui/settings-tab.ts`（R1 + R2）：新增设置键 `antiAiExtraWords` / `wordMinRatio` / `promptSplitRatio`（**未改动任何旧键名**），并在「✍️ 写作配置」页提供词表文本框与两个比例输入框；插件加载时统一应用覆盖。

### ✅ 验证
- 全量：`npm run typecheck` 零错误；`npm test` → **155 files / 2954 tests passed**（新增 `tests/unit/shared/thresholds-overrides.test.ts` 5 例；`tests/unit/engine/anti-ai-detector.test.ts` 追加 A1 3 例 + R2 5 例）；`npm run build` 成功（v4.10.7，含 3 个 Worker bundle）。
- 定向断言：A1「各分项得分之和 ≥ 总分（总分另有 100 上限）」；R2「扩充词即时进入避用词与 L1 命中」「扩充词实际抬高 AI 味评分」「空白/重复/内置项被剔除」「传空即恢复内置词表」；R1「未覆盖 = 内置常量」「合法覆盖生效」「非法值（≤0 / >1 / NaN）回落内置常量」。
- 运行时：`obsidian plugin:reload` → `dev:errors` = `No errors captured`；`obsidian eval` 实测新键已随默认值生效（`antiAiExtraWords:[]` / `wordMinRatio:0.7` / `promptSplitRatio:0.67`）。
- Worker 产物核对：`workers/deconstruction-worker.js` 已包含 `setExtraHighFreqWords` / `appliedAiWordsKey` / `ensureDeconstructors(input.antiAiWords)`，确认 Worker 链路不是空改。

### 📌 已复核为「无需改动」（只读结论，本轮不改）
- **A4 数据不足结构化**：`readability-deconstructor` 已产出结构化 `dataStatus: 'insufficient'`，`incremental-result-aggregator` 以 `dataStatus === 'insufficient'` 判定、以 `'estimated'` 标记兜底，**不依赖中文字符串判定**（与审计 spec 中「不得依赖中文字符串判断数据不足」的已删除需求一致）。无缺口。
- **S1 事件监听泄漏**：全库唯一「无清理」的 `document` 级监听位于 `ui/full-writer/outline-tree-controller.ts`（L92 匿名 click、L122 keydown），但 `ui/full-writer-view.ts:1188` 的 `render(previewSection)` 调用**已被注释**，该控制器当前无任何活跃调用（休眠代码）。按「不修没坏的东西 / 死代码只提出不删」原则只登记；若日后恢复该树状预览，须同时补 `removeEventListener`。**（更新：已在 v8.12 第三批补幂等 `dispose()` 并在 `render()` 起始解绑，同时消除了重复 render 的监听叠加；恢复预览时在 `onClose()` 调用 `dispose()` 即可。）**
- **S3 兼容性声明**：`manifest.json`（`minAppVersion: 1.5.0` / `isDesktopOnly: false`）在源码层未发现 desktop-only API 引用（无 `getBasePath()` / `child_process` / `process.platform` / `electron`）。但两处跨端风险未被声明覆盖：`URL.createObjectURL + <a download>` 导出下载在移动端无效（散落 7 处），以及 blob Worker 在部分移动端环境的可用性。修改 `manifest` 或导出方式均属行为变更，本轮只登记。**（更新：导出下载一项已在 v8.12 第二批以统一入口 `exportTextFile` 的 vault 回退修复；blob Worker 可用性一项仍登记。）**
- **P3 写作规范**：`engine/prompts/writing-rules.ts`（标注 v3.6.0）与同步源 `元文件/00-系统模板/写作规则.md`（v3.5.1，15 章）非逐字一致——代码内为面向注入的精简改写版。属既有提示词压缩设计（受 token 预算约束），非缺陷；严格对齐需人工定稿。**（更新：已在 v8.13 按「双向合并 + 结构统一」实施——两文件合并为 v3.6.0 单一内容并逐字一致，结构统一为 `## `/`### `/`- [ ]`；同时修复了 `parseWritingRules` 中 `mandatory` 恒为空的既有缺陷，版本告警随之消失。）**
- **A2 伏笔去重安全**：`foreshadow-manager.textSimilarity` 为**单字符集合 Jaccard**，对中文短句偏松（共用「的 / 了 / 他」等高频字即明显抬高相似度），配合 0.7 阈值存在误合并风险（向量路径 0.8 较稳健）。调整阈值或改用 bigram + 长度归一化均会改变判定结果，超出「仅无副作用」约束，只登记。**（更新：已在 v8.12 第二批改用字符 bigram Dice（长度归一化）实施，阈值仍为 0.7。）**
- **S4 长任务 Worker 迁移**：纯计算型拆解器已全部具备 Worker 入口（`deconstruction-worker` / `style-worker` / `quality-worker`）并在不可用时自动回退主线程；其余长任务的耗时主体是 **AI 网络往返**，迁移 Worker 无收益且会失去主线程可用的 Obsidian API。结论：无迁移价值，保持现状。
- **未接线模块（沿用既有登记）**：`engine/analysis-report-engine.ts` 与 `ui/components/analysis-report-panel.ts` 未被任何视图接线；本轮兼容底线未包含「允许删除未接线模块」，只登记不删除。

---

## Unreleased — v8.10 内容与规则体系梳理（提示词外置 / 阈值参数化 / 诊断补齐）

### 🧭 动因
全库巡检产出候选清单后，本轮按「仅无副作用改动」原则实施第一批：所有改动在默认配置下行为与 v4.10.7 完全一致。

### ✨ 改动
- `engine/prompts/soul-driven-prompts.ts`（新增）：将 `characterSoul` / `emotionPlan` / `sceneExpand` 三段提示词从 `template-utils.ts` 的函数体内联对象外置为独立模块，与 barrel 声明的「子文件职责」一致；提示词正文与变量占位符 `\${...}` 保持不变。
- `engine/prompts/template-utils.ts`：只保留路由与变量替换职责，三个步骤改为引用外置常量；`selfCheck` / `fix` / `finalFix` / `continuityCheck` 四条旧版路由补 `@deprecated` 说明（旧项目只读兼容不变）。
- `engine/prompts/index.ts`：增加 `soul-driven-prompts.ts` 导出与职责说明。
- `engine/prompts/chapter-pipeline-prompts.ts`：`SELF_CHECK_PROMPTS` / `FIX_PROMPTS` / `CONTINUITY_CHECK_PROMPTS` 补 `@deprecated` 标注（步骤已合并入 `qualityControl`）。
- `engine/anti-ai-detector.ts`：新增 `AI_SCORE_WEIGHTS` 权重表，把评分魔数（3/35/3/20/5/15/8/6/6/4/100）集中为带注释常量；数值与 v4.10 基线完全一致。
- `engine/quality-gate.ts`：`REPEAT_PREFIX_LEN` / 结尾钩子窗口 200 改为可由 `QualityGateOptions` 覆盖，默认值保持原值。
- `engine/co-writer-engine.ts`：`fetchOllamaModels` 的 catch 由静默 `return null` 改为补诊断日志，返回契约不变。

### ✅ 验证
- `npm run typecheck` 零错误；`npm test`：**154 files / 2941 tests passed**；`npm run build` 成功（v4.10.7）；`GetDiagnostics` 无诊断；`obsidian plugin:reload` 后 `dev:errors` → `No errors captured`。
- 提示词外置后经模块级校验：三个步骤的 system/user 提示词与 `${chapNum}` 等变量占位符均保持原值（`getStepTemplate('characterSoul'|'emotionPlan'|'sceneExpand')` 返回非空且内容标记齐全）。
- `anti-ai-detector`（16 例）与 `quality-gate`（8 例）单测全通过，确认权重集中化与阈值参数化未改变判定结果。

### 📌 已复核为「无需改动」
- `ui/knowledge-floating-panel.ts` 的 `loadBooksIfNeeded().catch(() => {})` 经核查属**假阳性**：其内部已 `log.warn` 失败原因并置安全兜底，非静默吞错。

---

## Unreleased — v8.9 报告产出治理（去重、停止空占位、文档合并）

### 🧭 动因
批量创建章节时会为每章预生成 12 个步骤文件，其中 `selfCheck` / `fix` / `finalFix` / `continuityReview` 四类旧版报告已合并入 `qualityControl`，当前流水线不会写入，形成每章 4 个空报告；同时根目录存在内容重叠的交互说明文档与遗留测试夹具。

### ✨ 改动
- `ui/batch-create-modal.ts`：批量创建仅生成当前流水线使用的 8 类步骤文件（信息规划 / 情节蒸馏 / 大纲摘要 / 情绪规划 / Scene 展开 / 角色灵魂 / 质量控制 / 分析报告）+ 正文模板；不再预生成 4 类旧版空报告。
- `StepResultSaver` / `ChapterStateManager` 的旧 key 读取与状态恢复映射保留，旧项目可正常打开，不会新增产出。
- 文档合并：《协同写作与工作台交互模式优化说明（第二轮）》并入 `交互界面优化调整说明.md` §9，原文件删除。
- 新增 `报告索引.md`：说明运行时报告与项目文档的分层、路径、触发时机、保留策略与阅读顺序。
- 删除遗留测试夹具 `_nwRG02测试`；更新 `.trae/DOCUMENTATION-INDEX.md`。

### ✅ 验证
- `npm run typecheck` 通过；`npm test`：154 files / 2941 tests passed；`npm run build` 成功（v4.10.7）；`GetDiagnostics` 无诊断。
- 批量创建文件清单与 `ALL_FULL_STEPS` 对齐：活跃报告 8 类 + 正文 + 结算表；旧版 4 类不再预生成。
- 审查报告仍由 `ReviewAgent.reviewChapter` / `reviewVolume` 按需创建；性能报告保持不落盘。

---

## Unreleased — v8.8 NBI-05 / NBI-06 修复（异步归属与改写中止 + 空态入口去重）

### 🧭 动因
NBI 登记项仅到 NBI-04，本轮巡检产出候选清单并按 `A+B+D / C+E` 归并：协同写作仍存在「生成中切章旧结果回填」「幽灵联想覆盖生成面板」「接受后收尾覆盖新生成」三类异步归属缺陷；选区改写缺少中止通道；知识库空态与工具栏重复渲染导入入口。

### ✨ 改动
- `ui/co-writing-view.ts`：新增 `suggestionEpoch` 与 `beginSuggestionEpoch()` / `isCurrentSuggestionEpoch()`；`openChapter()` 先中止在途建议/改写并递增代次；建议、改写、迭代、联想的所有分片回调、完成/异常分支与 `finally` 均校验代次。
- `ui/co-writing-view.ts`：`refreshGhostAssociation` 写回前校验代次、生成态与候选数量，`finally` 无条件释放 `isAssociating`；Tab 与幽灵建议点击增加 `!isSuggesting` 守卫。
- `ui/co-writing-view.ts`：`insertTextAndRecord` 记录接受时代次，收尾抽离为 `finalizeAcceptedInsert(epoch)`，代次变化时保留新生成面板。
- `ui/co-writing-view.ts`：`handleRewriteSelection` 与建议共用中止控制器，取消后写入「已取消」；`finally` 仅在控制器归属本次改写时复位。
- `engine/co-writer-engine.ts`：`rewriteSelection` 增加可选 `AbortSignal`，入口、方向循环、模型调用后与异常分支均检查中止，中止后不返回半成品候选。
- `ui/services/co-write-facade.ts`：`rewriteSelection` 透传 `signal`。
- `ui/views/knowledge-base-view.ts`：`renderBooksEmptyState` 移除重复导入按钮，文案改为指向工具栏入口。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：154 files / 2941 tests passed（新增 `co-writer-async-epoch.test.ts` 5 例，`co-writer-stream-chunk.test.ts` 追加 2 例）。
- 真实 AI 链路：建议生成中切章 → 旧章结果 0 回填；幽灵联想进行中触发主生成 → 幽灵不写回、不污染面板；改写 4.3s 时取消 → 状态「已取消」、候选 0、正文不变；接受后立即新生成 → 进度面板未被收尾覆盖；知识库空态仅剩说明文案，导入入口唯一。
- 测试夹具 `_nwNBI0506测试` 已删除，`coWriteModelMode` 已还原 `local`。详见 `NBI-05-NBI-06修复报告.md`。

---

## Unreleased — v8.7 RG-02 修复（旧候选接受防护 + 请求归属清理）

### 🧭 动因
v8.6 全量回归登记 RG-02：中止生成后 `currentSuggestions` 保留上一轮候选，面板显示「已取消」，但 `Ctrl+1~3` 仍可能插入旧候选。排查确认同源问题还包括：生成中可接受残留候选、改写失败后旧候选仍保留、生成中重触发时旧请求清理会误清新请求的流式骨架与进度。

### ✨ 改动
- `ui/co-writing-view.ts`：新增 `clearStaleSuggestions()`，在建议 / 改写 / 联想开始前清空 `currentSuggestions` 并清除幽灵建议，保证中止或失败后不存在可被快捷键接受的旧候选。
- `ui/co-writing-view.ts`：`acceptByIndex` 增加 `isSuggesting` 就绪态守卫，生成中按索引接受直接返回。
- `ui/co-writing-view.ts`：`handleRewriteSelection` 失败分支补 `clearStreamingPreview()`，避免半成品骨架与候选残留。
- `ui/co-writing-view.ts`：新增 `isSuggestRequestOwner(signal)`，中止分支与 `catch` 中止分支的骨架清理 / 进度取消仅由当前请求执行，修复生成中重触发时旧请求误伤新请求。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：153 files / 2934 tests passed（新增 `co-writer-suggestion-guard.test.ts` 5 例）。
- 真实 AI 链路：中止后候选 3 → 0、骨架 0、`Ctrl+1` 正文不变；生成中注入残留候选接受被拦截（对照就绪态 +6 字）；改写失败后候选 0 且接受无副作用；生成中重触发后新请求保持「生成中...」且骨架正常出现。
- 测试夹具 `_nwRG02测试` 已删除，`coWriteModelMode` 已还原 `local`。详见 `RG-02修复执行报告.md`。

---

## Unreleased — v8.6 NBI-03 / NBI-04 落地（建议/改写流式渲染 + 临时指令状态标识）

### 🧭 动因
NBI-03：引擎已具备 SSE 分片能力，但 `generateDirectionalCandidate` 只保留最终文本，视图层未接分片回调，「⇥ 建议」与「✂ 改写」需等待完整结果（实测 13s / 28s）才一次性出卡。
NBI-04：临时指令回车后仅弹 `Notice`，输入框修改后 `cursorHint` 仍为旧值，界面无法区分「已应用 / 未应用 / 已过期」。

### ✨ 改动
- `engine/co-writer-engine.ts`：新增 `callCoWriteText` 统一入口——传入 `onChunk` 走 `callAIAsyncIterator` 流式链路并逐片回调累计文本，不传则保持原 `callCoWriteAI` 非流式路径；最终响应为权威文本，避免原生流降级重启时累计重复。
- `engine/co-writer-engine.ts`：`suggestNext`、`rewriteSelection`、`generateDirectionalCandidate` 增加可选 `onChunk(index, cumulativeText)`（签名向后兼容，浮动面板等既有调用不受影响）；分片期间 abort 时丢弃半成品。
- `ui/services/co-write-facade.ts`：`suggestNext` / `rewriteSelection` 透传 `onChunk`。
- `ui/co-writing-view.ts`：进度面板内新增流式预览区，按候选索引隔离 DOM 更新；预览卡不渲染「接受 / 编辑 / 迭代 / 拒绝」，`done` 后由 `renderSuggestionCards` 整体替换；中止、异常时清理未完成骨架。
- `ui/co-writing-view.ts`：控制台头部新增 `.nw-hint-state`「指令已应用」，`applyHint()` 记录 `appliedHint`，输入框 `input` 不一致时即时隐藏；视图卸载清空。切章不隐藏（`cursorHint` 跨章仍生效，避免界面少报状态）。
- `styles.css`：新增 `.nw-cowrite-streaming-card` / `.nw-cowrite-streaming-text` / `.nw-cowrite-stream-cursor` 与 `.nw-hint-state` 样式，遵循 `prefers-reduced-motion`。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：152 files / 2929 tests passed（新增 `co-writer-stream-chunk.test.ts` 5 例、`co-writer-hint-state.test.ts` 5 例）。
- 真实 AI 链路：「⇥ 建议」首片 1.6s / 完成 13.2s（提前 87.6%，2684 次分片）；「✂ 改写」首片 11.0s / 完成 27.9s（提前 60.7%，413 次分片）；生成期 3 张骨架卡且 0 个操作按钮，完成后 3 条候选、无残留节点。
- 中止：第 60 次分片 abort 后骨架 3 → 0，按钮恢复「⇥ 建议」，正文不变。
- NBI-04：应用显示 / 修改隐藏 / 再次回车恢复 / 清空隐藏 / 切章保持（指令仍生效）/ 重开视图清空；416px 下控制台头部与输入框宽度无变化。
- 全量回归：正常流程、边界输入、中止与重触发、生成中改写互斥、错误注入、串行候选、联想、非流式路径全部通过；修正切章标识与 `cursorHint` 不一致（RG-01）。详见 `NBI-03-NBI-04全量回归测试记录.md`。
- 测试夹具 `_nw测试项目` / `_nw回归测试` 已删除，`detectProjects()` 恢复 `[]`。

---

## Unreleased — v8.5 NBI-01 / NBI-02 落地（指纹库默认作用域 + 知识库命名统一）

### 🧭 动因
NBI-01：指纹库固定默认「项目层」，无活动项目时与「真的没有指纹」无法区分。
NBI-02：知识库入口在 4 处显示为「知识库」，而实际视图标题为「知识库管理」，右栏 Tab 又与视图同名，用户无法凭文案区分入口层级。

### ✨ 改动
- `ui/views/writing-fingerprint-view.ts`：`initLibrary()` 按活动项目初始化作用域（有项目「项目层」/ 无项目「全局层」）；`getActiveProject()` 异常时记录 `warn` 并按无项目回落，视图不中断。
- `ui/views/writing-fingerprint-view.ts`：`renderFingerprintList()` 空态检查其它层数据，给出「当前层暂无指纹，可切换到🌐 全局层 / 📋 模板层查看」引导；新增 `getScopeFingerprints()` 复用作用域取数。
- `ui/co-writing-view.ts`、`ui/full-writer/title-bar-controller.ts`、`ui/views/writing-fingerprint-view.ts`、`ui/views/knowledge-base-view.ts`：知识库入口与侧栏标题统一为「📚 知识库管理」；协同写作右栏 Tab 保持「📚 知识库」并补 `title="内嵌知识库面板：检索与引用"`。
- `styles.css`：`@container nw-cowrite (max-width:560px)` 档按钮内边距 8px → 4px、header gap 6px → 4px，抵消「知识库管理」标签加宽，416px 顶栏保持 2 行（84px）。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`GetDiagnostics` 零错误，`dev:errors` 清空后无新增错误。
- NBI-01：无项目默认全局层、项目章节默认项目层、手动切换后搜索/筛选不回跳、项目解析异常回落全局层。
- NBI-02：1335px 顶栏 52px 单行、416px 顶栏 84px 两行、6 按钮无溢出；3 处入口均复用同一知识库 leaf，右栏 Tab 不新建 leaf。
- 测试夹具 `_nw测试项目` 已删除，`detectProjects()` 恢复 `[]`。

---

## Unreleased — v8.4 协同写作顶栏收敛 + 静默失败修复（四界面测试收口）

### 🧭 动因
四视图导航与协同写作右栏逐项实测后发现：顶栏「⋯ 更多」与右栏「⚙ 更多工具」功能重复（导入 / 批量导入重复）、「⋯ 更多」的全局 `document` click 监听未随视图卸载；右栏「保存 / 标记完稿 / 检查」在未绑定章节或正文为空时静默返回，用户误判按钮失效。

### ✨ 改动
- `ui/co-writing-view.ts`：顶栏收敛为「导航 · 资源 · 模式」三区（← 工作台 / 📚 知识库 / 🔍 指纹库 / 👥 实体 / 📈 剧情 / 🎯 精准模式），移除「⋯ 更多」下拉及其未清理的全局监听；「📊 监控」「🔬 分析」并入右栏「⚙ 更多工具」（工具面板 7 → 9 项）。
- `ui/co-writing-view.ts`：`saveBody` / `markAsWritten` 在正文为空、未绑定卷章时给出 Notice 提示，不再静默返回。
- `ui/co-writing-view.ts`：`handleTabSuggest` / `handleAssociationSuggest` 增加前置校验（未绑定卷章 / 正文为空），未绑定场景由「空等约 44s 后显示无建议」改为 1.2s 内提示。
- `ui/views/writing-fingerprint-view.ts`：`handleDeleteFingerprint` / `handleToggleEnabled` 未选中指纹时补 Notice，不再静默。
- `ui/cowrite/live-analysis-controller.ts`：`inspectSettingGuard` 在正文为空时对手动检查给出 Notice。
- `styles.css`：新增 `@container nw-cowrite (max-width: 560px)` 窄容器档位（隐藏标题文字、压缩内边距），416px 侧栏下顶栏由 3 行降至 2 行；移除已废弃的 `.nw-cowrite-more-menu/-item` 样式。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`tsc` 诊断零错误。
- 四视图导航按钮 20 项、协同写作右栏 35 项（含真实 AI 链路）、知识库 14 项、指纹库 11 项、工作台空态 5 项实测通过；详见 `四界面端到端测试报告.md`。

---

## Unreleased — 四界面流转逻辑优化（3 项）

### 🧭 动因
补齐四个核心界面间的直达入口、统一打开反馈、解耦协同写作「返回工作台」语义。

### ✨ 改动
- `ui/full-writer/title-bar-controller.ts` + `ui/full-writer-view.ts`：工作台顶栏新增「🔍 指纹库」入口（补全工作台 → 指纹库直达）。
- `ui/co-writing-view.ts`：协同写作顶栏新增「← 工作台」显式返回按钮 + 「🔍 指纹库」直达按钮（解耦原先耦合在「质量检查」的返回语义）。
- `ui/views/knowledge-base-view.ts`：知识库侧栏新增「← 工作台 / ✍️ 协同写作 / 🔍 指纹库」导航行。
- `ui/views/writing-fingerprint-view.ts`：指纹库侧栏新增「← 工作台 / ✍️ 协同 / 📚 知识库」导航行。
- `main.ts` + `core/command-registry.ts`：`openKnowledgeBaseView()` / `openFingerprintLibrary()` 打开后新增 `Notice` 反馈，统一四界面打开反馈机制。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 交互界面体验优化与重构（按钮热区 + 列表动效）

### 🧭 动因
针对四个核心界面做可用性优化：按钮点击热区不达标（历史 `height: 28/32/40px` 均 < 44px）、列表组件无增删/滑动/选中过渡、`transition: all` 默认 ease 生硬。

### ✨ 改动
- `styles.css` `:root`：新增控件尺寸令牌 `--nw-control-h-sm/md/lg` 与点击热区令牌 `--nw-hit-min: 44px`。
- `styles.css` 追加 v8.0 段：`.nw-btn`/`.nw-btn-sm`/`.nw-btn-mini` 命中区 `min-width/min-height ≥44px`；`.nw-btn-lg` 48px；`.nw-btn-icon` 强制 44×44；`.nw-plot-toolbar-btn` 紧凑但可命中。
- `styles.css` 追加 v8.1 段：`@keyframes nw-item-enter`/`nw-item-leave` 插入/删除动效；`.nw-list-item`/`.nw-suggestion-card`/`.nw-entity-type-card`/`.nw-plot-chapter` 统一改用 `--nw-ease-out` 自然缓出 + hover 上浮 + 选中态平滑过渡。
- 输出 `CSS架构分析报告.md` 与 `交互界面优化调整说明.md`。

### ✅ 验证
- CSS 花括号配平（open=close=1761），无语法错误。
- 纯 CSS 改动，无 TS 变更，构建不受影响。

---

## Unreleased — 可视化情节画布（P1-1）

### 🧭 动因
对标 Sudowrite Canvas，把分卷大纲的「卷 → 章 → 场景」结构从树形列表升级为「卡片 + 连线」的可视化画布，支持拖拽重排大纲。

### ✨ 改动
- 新建 `ui/plot-canvas-modal.ts`：`PlotCanvasModal` 可视化情节画布（卷分组着色 + 章节卡片 + 连线箭头 + 关键场景标记 + 拖拽重排回写）。
- 新建 `ui/plot-canvas-parser.ts`：提取解析逻辑为纯函数 `parseVolumeOutline`/`countChapters`，数据与视图分离、可单元测试。
- 视图配置：密度切换（紧凑/标准/宽松）+ 导出大纲 Markdown（复制剪贴板）。
- `ui/full-writer/wizard-step-renderers.ts`：「全书规划」步骤新增「🗺️ 情节画布」入口。
- `styles.css` 追加 v7.4 段：`.nw-plot-*` 样式 + 工具栏 + 密度切换。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：46 用例全绿（新增 plot-canvas-parser 8 个）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 长篇一致性守护：结算前冲突提示（P0-2）

### 🧭 动因
`ConflictDetector` / `ChapterSnapshotBuilder` / `SceneGenerationLoop` 已具备冲突检测能力（场景生成时已检测），但「章节结算」流程未触发检测。本轮在结算前接入冲突检测，作者结算时若正文存在伏笔 / 人设 / 时间线冲突，会收到提示。

### ✨ 改动
- `ui/co-writing-view.ts`：`handleComplete` 结算前新增 `runSettlementConflictCheck()`，复用 `ChapterSnapshotBuilder` + `ConflictDetector` 检测冲突并 Notice 提示；检测失败不阻塞结算（try-catch 降级）。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：38 用例全绿（conflict-detector 14 + anti-ai-detector 16 + quality-gate 8）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 反 AI 检测引擎升级（P0-1）

### 🧭 动因
原 `AntiAIDetector` 仅 15 个连接词黑名单 + `includes` 布尔检测，无法覆盖 skill 中强调的 AI 模板短语（眼中闪过一丝/嘴角勾起等），无量化评分、无段落定位。本轮升级为「三层词库 + 多维特征加权评分 + 段落级定位」的完整检测引擎。

### ✨ 改动
- 新建 `engine/ai-lexicon.ts`：三层词库（L1 连接词 40+ / L2 模板短语 60+ / L3 句式正则 12），数据与逻辑分离。
- 升级 `engine/anti-ai-detector.ts`：新增 `detectWithPositions`（段落级定位）、`detect`（评分 + 特征 + 建议）、`score`（0-100），保留原 `detectAIWords`/`buildAntiAIConstraints` 向后兼容。
- 接入 `engine/quality-gate.ts`：rule 层新增 `aiDetection` 完整检测结果字段，保留 `aiWords`。
- 新建 `ui/components/ai-detection-report.ts`：AI 味检测报告渲染组件（评分 + 雷达图 + 命中短语 + 建议），纯展示零副作用。
- 接入 `ui/co-writing-view.ts`：`renderFloatingQuality` 开头实时渲染 AI 味检测报告。
- `styles.css` 追加 v7.3 段：`.nw-ai-report-*` 样式。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：24 用例全绿（anti-ai-detector 16 + quality-gate 8）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 协同写作反馈与工作台排版缺陷修复（交互模式优化第二轮）

### 🧭 动因
针对「四个核心界面交互模式」优化诉求，本轮聚焦两大核心场景的系统性修复：(1) 协同写作（人机协同）的反馈痛点——字数口径不一致、目标字数硬编码、常驻 Notice 不消失；(2) 完整写作工作台的 CSS 排版缺陷——8 类 class 缺失 + 6 处响应式/溢出。需求中「多人光标同步 / 实时编辑冲突提示 / 权限状态」经核实**不适用**：插件协同写作为「作者 + AI」的人机协同，非多人实时协作，全库无 WebSocket/CRDT/协作成员相关实现。

### ✨ 改动

**CSS class 缺失补全（`styles.css`，文件末尾 v7.1 段）**
补齐 8 类 TS 使用但样式表缺失定义的 class，全部复用现有 `--nw-*` 设计 token：
- `novel-writer-fw-cowrite-entry*`（推荐卡片族 10 个类，正文生成步骤使用）
- `novel-writer-fw-warning`（警告提示）
- `novel-writer-fw-hero-*`（空状态 hero 卡片 5 个类）
- `novel-writer-fw-planning-header` / `-new-project-btn` / `-preview-title` / `-preview-volume-list` / `-preview-volume-item`

**CSS 响应式 / 溢出修复（`styles.css`）**
- `.novel-writer-fw-planning-status-list`：`repeat(5,1fr)` → `repeat(auto-fit,minmax(72px,1fr))`，窄屏自动降列。
- `.nw-wizard-form-grid`：固定 `1fr 1fr` → `repeat(auto-fit,minmax(180px,1fr))` + 子项 `min-width:0`。
- `.nw-wizard-content-area` / `.novel-writer-fw-temp-slider`：补 `min-width:0` 防 flex 子项溢出。
- `.novel-writer-fw-card-action-btn`：补 `overflow:hidden; text-overflow:ellipsis`，长文案省略号截断。
- `.novel-writer-fw-planning-quickstart`：`color-mix()` 补静态 fallback（兼容旧 Chromium <111）。

**协同写作反馈修复（`ui/co-writing-view.ts`）**
- 字数口径统一：状态栏 `refreshStatusBar` 与状态监控卡 `renderStatusCard` 的 `.length` → `.trim().length`，与剧情完成度面板 `renderMetrics` 对齐。
- 目标字数硬编码统一：`wordGoalDisplay` 硬编码 `3000` → `this.facade.settings.defaultWordCount || 3000`。
- 常驻 Notice 不消失：质量修复「🔍 正在修复」Notice（timeout=0）改为保存引用，`finally` 中 `hide()`，修复完成/失败后不再常驻。

**工作台 CSS 二次排查修复（`styles.css`，v7.2 段 + 原位）**
- 补齐 `.novel-writer-fw-step-stale`（已过期需重跑状态色）与 `.nw-entity-tree-active`（实体树选中高亮）两个缺失 class。
- 项目选择器预览面板 `.novel-writer-fw-preview-panel` 固定 `width:340px` → `clamp(260px,30vw,340px)`，并统一两处重复定义的 border 方向（右面板 `border-left`）。
- `.novel-writer-fw-card-actions` 固定 `1fr 1fr 1fr` → `repeat(auto-fit,minmax(64px,1fr))`，避免按钮文字截断。
- `.nw-wizard-sidebar` 的 `min-width` 由 `var(--nw-wizard-sidebar-w)` 放宽为 `160px`，避免 900~1100px 区间挤压内容区。
- `.novel-writer-fw-review-tabs` / `.novel-writer-fw-btn-row` / `.nw-wizard-nav-btn-group` 补 `flex-wrap:wrap`，窄屏横向溢出改为换行。
- 裸 `color-mix()` 补静态 fallback（旧 Chromium <111）：`.novel-writer-fw-titlebar`/`.nw-cowrite-header`、`.novel-writer-fw-status-bar`、`.nw-tools-card`。
- `.nw-tools-card` 删除与固定 `height` 冲突的 `aspect-ratio:1/1`。

**知识库 / 指纹库交互缺陷修复**
- 知识库「拆解任务 → 查看书籍」跳转失效（`ui/views/knowledge-base-view.ts`）：点击后右栏未渲染出 `.nw-kb-books-panel`，`openBookDetail` 空返回致状态死局——补 `renderRightPanel()` 调用。
- 指纹库「从知识库导入」按钮 tooltip 误标「（待实现）」而功能已完整实现（`ui/views/writing-fingerprint-view.ts`）：改为实际功能说明。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 知识库书详情渲染器外迁（单文件拆分第二步）

### 🧭 动因
`knowledge-base-view.ts` 在 Modal 外迁后仍有 5676 行，其中「书详情渲染」方法组（10 个 Tab 渲染 + 12 个辅助方法，约 2300 行）深度耦合视图状态。本轮把该组外迁到独立的 `BookDetailRenderer`，通过 deps 依赖注入访问宿主，进一步降低单文件体积。

### ✨ 改动
- 新建 `ui/views/book-detail-renderer.ts`（约 2417 行）：`BookDetailRenderer` 类 + `BookDetailRendererDeps` 接口（注入 8 个数据 getter、kb/kbManager/app、getCurrentBook/formatWordCount/getChannelLabel/formatDateTime/formatDuration/getStatusLabel 等工具，以及 onClassifyBook/onEditBook/onApplyGenreRecommendation/onAddCustomTag/onDeleteCustomTag 等回调）。
- 宿主 `knowledge-base-view.ts`：5676 → 3377 行；`renderBookDetail()` 的 switch 委托给 `bookDetailRenderer`；「自动分类」「应用分类建议」按钮逻辑封装为视图侧 `autoClassifyBook`/`applyGenreRecommendation`。
- `renderChart`/`getGenreName` 因被「统计 Tab」复用而保留宿主（新类内另有副本）；8 个数据 interface 加 `export` 供 renderer import。
- 清理外迁后变为 unused 的 import。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

### 📝 顺带发现（未处理）
`getTimelineIcon` 迁入前即为未被调用的死代码，本次按「外科手术式」原样保留，留待后续清理。

---

## Unreleased — 知识库题材列表默认展开（降低「折叠树」导航摩擦）

### 🧭 动因
体检报告 §4.3 指出知识库「5 层嵌套过深」中有一层是「题材折叠」accordion（`createGenreGroup` 用 `expandedGenres` 追踪展开态，默认全部折叠）。用户偏好「Tab/平铺 优于 折叠树」，故将题材分组改为**默认展开**——子题材直接可见、一次点击直达，减少一层交互摩擦。

### ✨ 改动（`ui/views/knowledge-base-view.ts`）
- `expandedGenres`（默认折叠）重命名为 `collapsedGenres`（默认展开），`isExpanded = !collapsedGenres.has(genre.id)`。
- 折叠箭头 `▶/▼` 仍保留，用户可手动折叠不关心的题材分组。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 原生 confirm() 全量替换为统一确认弹窗

### 🧭 动因
原生 `confirm()` 在 Obsidian Electron 下交互体验差、风格不统一。插件统一以 `OperationConfirmModal.confirm()` 异步确认弹窗替代。本轮收敛除「指纹库视图」「知识库 GenreEditModal」外（已在各自条目记录）的全部剩余原生确认框，覆盖 14 个文件共 34 处。

### ✨ 改动（按文件）
- `ui/mini-settings-modal.ts`：删除模板/全局/项目指纹、重建向量索引、清空性能日志 5 处。
- `ui/settings-tab.ts`：删除自定义提供商、删除指纹、重建索引、恢复拆解默认、删除书籍、删除/重置伏笔类型、清空性能日志、启用 LLM 层（×2）10 处。
- `ui/manage-providers-modal.ts`：恢复默认供应商、删除供应商 2 处。
- `ui/create-project-modal.ts`：项目覆盖（赋值形）1 处。
- `ui/knowledge-detail-modal.ts`：删除书籍 1 处。
- `ui/generate-worldview-modal.ts`：AI 建议重命名项目（赋值形）1 处。
- `ui/fingerprint-detail-modal.ts`：重新提取、删除指纹 2 处。
- `ui/writing-profile-modal.ts`：关闭（×2）、重置默认 3 处。
- `ui/full-writer/scene-outline-controller.ts`：删除场景 1 处。
- `ui/existing-entity-manager.ts`：未应用变更关闭 1 处。
- `ui/template-manager.ts`：删除模板（×3）3 处。
- `ui/prompt-manager-settings.ts`：重置提示词、删除测试 2 处。
- `ui/refill-modal.ts`：重新拆解 1 处。
- `ui/plan-book-modal.ts`：生成世界观（赋值形）1 处。

统一规则：`title` 用简短动作名、`description` 保留原问句、不可逆/丢失类加 `warning`、`confirmText`/`cancelText` 统一「确认X / 取消」；同步把包裹回调改为 `async`。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- 全仓原生 `confirm(` 已清零（仅剩 `OperationConfirmModal.confirm` 静态方法与 `fact-index-manager.ts` 的同名方法，非原生调用）。

---

## Unreleased — 知识库视图 Modal 类外迁

### 🧭 动因
`ui/views/knowledge-base-view.ts` 为超大单文件，内嵌 4 个 Modal 类（ImportBookModal / EditBookModal / GenreEditModal / BatchOperationsModal），机械外迁至独立文件以降低单文件体积、提升可维护性。

### ✨ 改动
- 新建 `ui/views/knowledge-base-modals.ts`，承载上述 4 个 Modal（原样拷贝，仅加 `export`）。
- `ui/views/knowledge-base-view.ts` 改为 `import { ... } from './knowledge-base-modals'`，并清理仅 Modal 使用的导入（`Setting`/`TFile`/`SubGenreConfig`/`TechniqueDef`/`kbBookDir`）。
- 顺手将 `GenreEditModal` 删除题材的原生 `confirm()` 替换为 `OperationConfirmModal.confirm()`，消除该文件的最后一个原生确认框。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 工作台设置入口去重

### 🧭 动因
体检报告 §4.2④ 指出设置按钮同时出现在 titleBar（`title-bar-controller.ts:124`「⚙️ 设置」）与 tabBar（`tab-controller.ts:213`「⚙️」），两者都打开 `MiniSettingsModal`，属重复入口。

### ✨ 改动（`ui/full-writer/tab-controller.ts`）
- 移除 tabBar 右侧的图标-only「⚙️」设置按钮（及其 `MiniSettingsModal` 导入），保留 titleBar 带可见文字「⚙️ 设置」的入口（更易发现，符合图标按钮加文字的可发现性偏好）。tabBar 右侧保留「🔄 热重载」。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 指纹库原生 confirm 替换为统一确认弹窗

### 🧭 动因
体检报告 §4.3 指出指纹库「删除/迁移」仍用原生 `confirm()`，与插件风格不统一（知识库视图已统一走 `OperationConfirmModal`，指纹库是漏网项）。

### ✨ 改动（`ui/views/writing-fingerprint-view.ts`）
- 删除指纹、V1→V2 批量升级两处 `confirm()` 改为 `OperationConfirmModal.confirm()`，沿用知识库视图既定模式（`title` / `description` / `warning` / `steps` / `confirmText`）。两处宿主方法本就 `async`，`await` 无需改签名。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 工作台导航收敛：清理「双导航」死导入 + 向导状态机等价分支合并

### 🧭 动因
体检报告 §4.2① 称 `step-nav-presenter`（11步）与 `streamlined-nav-presenter`（5阶段）两套导航并存。排查确认：工作台实际渲染只走 `streamlined-nav-presenter`（`step-render-controller.ts` 的 `renderStepNav` 仅用 `getStreamlinedPhases()`），`step-nav-presenter` 的 4 个函数（`resolveStepKey` / `getStepColorClass` / `getStepStatusDescriptor` / `isStepClickable`）在渲染控制器中为死导入——「双导航并存」属旧信息，残留为死代码。

### ✨ 改动
1. **`ui/full-writer/step-render-controller.ts`**：删除对 `step-nav-presenter` 的 4 个未使用导入，导航渲染单一来源收敛到 `streamlined-nav-presenter`。
2. **`ui/full-writer/wizard-controller.ts`**：`renderNavBar` 中 `isDone && isMandatory` 与 `isDone` 两个分支行为完全等价（都渲染「下一步 →」主按钮），合并为单一 `isDone` 分支，减少状态机分支数。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — Tab 栏溢出兜底（协同写作右栏 + 知识库子 Tab）

### 🧭 动因
体检报告 §4.2② 指出 Tab 栏多标签截断无兜底。排查确认：工作台主 Tab 栏（`novel-writer-fw-tabbar`）已含 `overflow-x: auto`（报告该点属旧信息）；真正仍缺兜底的是协同写作右栏 `.nw-cowrite-tab-headers` 与知识库子 Tab `.nw-kb-subtab-headers`——`display:flex` 但无 `overflow-x`、子项 `white-space:nowrap` 且无 `flex-shrink:0`，标签增多即被截断/挤压。

### ✨ 改动（`styles.css`）
- `.nw-cowrite-tab-headers` / `.nw-kb-subtab-headers`：补 `overflow-x: auto; overflow-y: hidden; flex-wrap: nowrap;`。
- `.nw-cowrite-tab-header` / `.nw-kb-subtab-header`：补 `flex-shrink: 0;`，保证标签不被压缩、可横向滚动。

---

## Unreleased — 协同写作浮窗交互补齐：修复临时指令死代码 + 建议卡片补「拒绝/接受」操作

### 🧭 动因
体检报告指出「协同写作双实现功能分裂」：Tab 版 `co-writing-view.ts` 具备完整采纳/拒绝/编辑/迭代，浮窗版 `co-write-floating-panel.ts` 只有「点击即采纳」，既无拒绝出口，也未启用 `styles.css` 中已预留的 `.nw-suggestion-header` / `.nw-suggestion-tag` / `.nw-suggestion-actions` 卡片结构。

### ✨ 改动（`ui/co-write-floating-panel.ts`）
1. **修复「临时指令」死代码**：`applyHint()` 原先按 Enter 仅 `Notice` 展示、从未真正生效。现在把指令存入 `private cursorHint`，并随 `suggestNext` / `rewriteSelection` 实际传入引擎（`lastSuggestParams.cursorHint` 同步改用 `this.cursorHint`）。
2. **建议卡片补交互**：`renderSuggestions()` 重建卡片结构——头部（序号 + 方向标签 + 非默认风格标签）、正文、操作行（`✓ 接受` 主按钮 + `✕ 拒绝` 次按钮）；卡片整体点击仍为采纳（向后兼容）。
3. **新增 `rejectSuggestion(id)`**：拒绝单条后过滤重渲染，全部拒绝后展示「已拒绝本轮建议。按 Tab 重新生成。」空态，与主界面 `rejectSuggestion` 行为对齐。

### ✅ 验证
- `npm run typecheck`：零错误（含新增 `getDirectionLabel` / `getStyleLabel` 导入）。

---

## Unreleased — P0 收敛：废弃正文命令隐藏 + 孤儿令牌文件清理

### 🧹 背景
插件体检报告（《小说工坊插件优化分析报告》）识别出三类结构性债，本轮落地其中最安全的 P0 收敛项。

### ✨ 改动
1. **收敛 4 个废弃正文命令（O1）**：`AI写正文〔旧〕` / `后台AI写正文〔旧〕` / `批量写正文〔旧〕` / `自动写作器〔旧〕` 四个旧版正文生成命令（正文已统一走 CoWriterEngine），在 `core/command-registry.ts` 中：
   - `COMMAND_DEFINITIONS` 标记 `internalOnly: true`，使其从 `getPublicCommands()` 消失；
   - 从 `registerObsidianCommands` 删除对应 `addCommand`，使其不再出现在 Obsidian 命令面板（Ctrl+P）。
   - 保留 `registerInternalCommands` 中的 `r.register` 回调，向后兼容（内部 registry 仍可 execute）。
2. **删除孤儿设计令牌文件（CSS）**：`design-tokens.css`（398 行）从未被任何代码加载——`*.ts` 中零引用、`styles.css` 无 `@import`、manifest 无 styles 多文件配置；`styles.css` 顶部注释已自认「design-tokens.css 未加载时仍可用」（靠 fallback）。删除零运行时风险。

### 🎯 设计取舍
- 采用「隐藏 + 保留回调」而非「彻底删除」，最小侵入、向后兼容；真正的删除留待确认无内部依赖后的 P2 清理。
- `styles.css.bak`（5538 行备份）与 V1/V2 双套收敛、协同写作双实现统一，因风险较高，留待下一轮单独评估。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run test`：2906 通过（149 文件）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成算法系统化整改：补齐三层契约校验（蓝图 / 单卷 / 全局）

### 🧭 整改动因（真实 AI 端到端实测暴露的两个问题）
- **Q-1 章号总数被放大**：100 万 / 3 卷 / 2500 字的规划本应是 400 章，实测最终大纲却含 **402** 条章节行（末章 `| 402 |`），而全书总览写的是「总章节数：400」——文档自相矛盾。根因有二：① 蓝图不可用时的回退分配用 `ceil(totalChapters / volumes)`，3 卷 400 章会得到 134+134+134=402；② 校验只检测「缺章」（`covered.size < expectedCount`），**从不检测「多章/越界章号」**。
- **Q-2 蓝图稀薄导致跨卷约束链失效**：实测蓝图输出仅 **237 字符**（基本只有章号范围），Phase N+1 跨卷验证 0 警告 0 严重问题、Phase N+2 定向修复从未触发——「转折点 / 伏笔回收 / 势力演变」的闭环校验形同虚设。

### 🏗️ 架构：新增契约层 `engine/outline-contract.ts`（纯函数、无副作用、可单测）
把原先散落各处的临时判断收敛为显式契约，让「校验」成为算法的一等公民：

| 契约 | 函数 | 拦截的问题 |
|------|------|-----------|
| 设置契约 | `normalizeOutlineSettings` | 非法字数/分卷/每章字数、除零、每卷 0 章；`totalChapters ≥ volumes` |
| 章号范围契约 | `validateChapterRanges` / `buildProportionalChapterRanges` / `normalizeChapterRanges` | 长度 ≠ 分卷数、首尾不接、起点非 1、**总和 ≠ 总章数** → 自动按比例重分配 |
| 蓝图契约 | `validateBlueprintCompleteness` | 蓝图只有章号范围；转折点/伏笔为空；卷号越界；**回收卷早于埋设卷**；转折点章节范围越出本卷；有角色/势力却无对应时间线 |
| 单卷契约 | `validateVolumeStructure`（复用 `validateOutlineOutput` + 值非空/非占位符 + **精确覆盖**） | 字段为空或占位符（`（无）`/`待补充`…）；**越界章号、重复章号、空描述行**（原算法完全检不出）；覆盖不足；章节范围与规划不一致 |
| 章节表工具 | `analyzeChapterTable` / `findMissingChapterRanges` / `chunkRanges` / `consolidateChapterTable` | 越界/重复/空行的**确定性净化**；缺失章号压缩为连续区间；增量合并（不覆盖已有行） |
| 全局契约 | `validateGlobalChapterContinuity` | 跨卷重叠、全书缺章、超总章数。**关键：统计全部章节号（不过滤范围）**，否则越界行会绕过检测（这正是原算法的盲点） |

### ✨ 算法重构（engine/ai-outline-generator.ts）
1. **Phase 1 蓝图质量控制循环（新增）**：与逐卷生成同构的「生成 → 契约校验 → 定向补全」，≤3 轮。章号范围先归一化（无论 AI 输出什么都得到合法范围），再校验字段完整性；耗尽才降级，并输出「蓝图质量提示」注释。
2. **Phase 2-N 逐卷质量控制强化**：
   - 生成结果先做**确定性净化**（剔除越界/重复/空描述行），使校验只聚焦「真正需要 AI 补全」的缺口；
   - 校验由「只查缺章」升级为**精确覆盖**（不多、不少、不越界、不重复）；
   - 新增**增量章节补全**：若上一轮只是缺章节而字段合规，只请求缺失章号区间（压缩成连续区间并按 25 章/批），不再整卷重写——直接消除原「第 1 卷 3 轮整卷重写耗时 333 s」的浪费。
3. **Phase N+2 跨卷修复定向化**：问题→卷映射由「仅 `volumeIndex`」扩展为「`volumeIndex` ∪ `relatedVolumes`」；新增**收敛判定**（关键问题数不下降即停止，避免无进展空转）。
4. **Phase N+3 全局章号连续性终检（新增）**：组装文档前的最后一道门。发现缺口则按缺失区间定向补全（≤2 轮），仍未闭合才以「全局章号待完善问题」注释显式暴露，绝不静默。
5. **数据模型对齐**：卷级提示词新增「**伏笔安排**」「**势力变动**」两个必填字段——`VolumeOutlineSummarizer` 一直依赖这两个小节构建跨卷摘要，此前提示词从不要求它们，导致 `pendingForeshadows`/`factionChanges` 恒为空、跨卷伏笔与势力链条实际断裂。共享常量 `OUTLINE_REQUIRED_KEYS`（12 字段）保持不动，避免影响其它以 12 字段为准的校验入口。
6. **清理死代码**：删除自 Phase 1 骨架调用移除后已无调用方的 `generateGlobalSkeleton`（`OutlineGenerator` 与 `AIEngine` 两处）；修正 `generateGlobalBlueprint` 错误信息的 `OUTLINE_BLUEPRINT_FAILED:` 前缀重复拼接。

### 🎯 设计取舍
- 机械性缺陷（越界/重复/空行）用**确定性代码**修复，不消耗 AI 调用；只有需要创作判断的缺口（缺字段、缺章节）才触发 AI 补全。
- 「保底不封顶」：所有循环都有上限且必然收敛；上限耗尽即降级，并以 HTML 注释把未闭合项显式暴露给用户。

### ✅ 验证（手动调试，未使用电脑控制自动化工具）
- `npm run typecheck`：零错误。
- `npm run test`：**2905 通过（149 文件）**；新增 `tests/unit/engine/outline-contract.test.ts`（21 用例，覆盖归一化/章号范围/蓝图完整性/单卷精确校验/章节表工具/全局终检的边界）与扩充 `tests/unit/engine/ai-outline-generator.test.ts`（6 用例，含 Q-1「蓝图章号总数不符自动重分配后恰好 5 章无越界」与 Q-2「稀薄蓝图重试后无蓝图质量提示」的回归）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成改为「质量优先 + 分段组织 + 多轮定向补全」（否决单次执行方案）

### 🔄 方案反转
- **否决上一轮「单次执行」方案**：上一轮以「执行完整性 = 不重试、不分段、失败即 throw」为目标，实为拿质量换性能；本轮按用户要求改为**内容质量第一**。
- 新算法形态：**内循环多轮重试 + 分段组织 + 定向补全 + 失败降级 + 全程不中断**；依旧不使用 `AbortSignal`，不新增结果级缓存。

### ✨ 重构（engine/ai-outline-generator.ts）
1. **永不 throw 中断**：`generateOutline` 全链路不再向上抛出。Phase -1 清理、Phase 1 蓝图、Phase 2-N 逐卷、Phase N+1 验证、Phase N+2 修复全部内部捕获；蓝图失败降级为「无蓝图模式」（各卷回退平均分配章节）；单卷彻底失败写入占位标记后继续；仅当所有卷均无有效内容时才返回 `error` 供 UI 提示。
2. **单卷内循环重试（≤3 轮）+ 定向补全**：新增 `generateVolumeWithQualityControl` / `callVolumeOutline` / `buildVolumeRepairHint`。每轮以「上一轮缺陷清单」构造补全指令，**提示词随轮次变化**——这是关键：`AIApiClient.callAI` 有 prompt 五元组哈希缓存，重试若用相同提示词会直接命中缓存返回完全相同结果，形成无效重试（也是此前「瞬时完成」现象的根因）。
3. **分段组织（> 60 章自动分段）**：新增 `generateVolumeOutlineSegmented` / `callChapterBatch` / `normalizeChapterRows`。超长卷拆为「卷级概览 + 章节分配表分批（每批 25 章）」，各批失败不中断，交由质量校验在下一轮触发补全。
4. **结构质量校验**：新增 `validateVolumeStructure`，复用 `validateOutlineOutput`（12 个必填字段 / 章节范围格式 / 章节分配表）并追加「章节范围一致性 + 章节号覆盖度」检查。
5. **跨卷关键问题定向修复（≤2 轮）**：恢复 Phase N+2，但改为非抛出式：`repairCrossVolumeIssues` / `callCrossVolumeRepair` 按卷归并 critical 问题 → 请求该卷重写 → **结构不退化才接受**（避免「越修越差」）→ 复验。
6. **降级可见**：降级卷号与遗留问题以 HTML 注释追加（`降级生成提示` / `跨卷验证警告` / `跨卷验证待完善问题（修复后仍存在）`），不阻断输出、不重复调用 AI。

### 🎯 设计取舍
- 质量 > 性能：接受多次 AI 调用（分段 + 重试 + 修复）换取内容完整连贯、逻辑闭环。
- 保底不封顶：重试轮数上限保证流程必然收敛（无死胡同）；上限耗尽时降级返回而非中断。

### ✅ 验证（手动调试，未使用电脑控制自动化工具）
- `npm run typecheck`：零错误。
- `npm run test`：**2882 通过（148 文件）**；新增 `tests/unit/engine/ai-outline-generator.test.ts` 4 用例（首轮缺陷→次轮定向补全通过 / AI 持续失败降级不抛 / 超长卷分段合并完整章节表 / 跨卷 critical 修复被采纳）。
- `npm run build`：esbuild 构建通过（v4.10.7）；产物核验：旧 `OUTLINE_VOLUME_FAILED` 抛出点已消除，`OUTLINE_BLUEPRINT_FAILED` 保留（改为被捕获降级）。
- obsidian-cli 手动验证：`obsidian plugin:reload id=novel-writer-ai` → `Reloaded: novel-writer-ai`；`obsidian dev:errors` → `No errors captured`。

### ⚠️ 本条目取代的旧方案
- 下方「大纲生成执行完整性保障（放弃取消、单次执行、避免 AI 重复调用）」条目的**结论已作废**：其「不重试 / 不分段 / 失败即 throw」不再适用。`MAX_CHAPTERS_PER_VOLUME`（100 章）仍在用，现同时作为「启用分段生成」的告警触发点。

---

## Unreleased — 大纲生成执行完整性保障（放弃取消、单次执行、避免 AI 重复调用）【已被上方条目否决】

### 🔄 方案调整
- **放弃「中途取消」方案**：回退上一轮为大纲生成引入的 `AbortSignal` 透传与「🛑 取消生成」按钮，避免执行链路被中断。
- **移除重试/修复/续写**：`OutlineGenerator.generateOutline` 删除「省略检测重试（每卷最多 3 次）」「跨卷强制修复（最多 3 轮）」「大纲校验失败续写（最多 5 次）」三处 AI 重复调用逻辑，改为蓝图 1 次 + 每卷 1 次的单次执行；跨卷验证仅生成警告、不再触发修复。同步删除 `repairVolume` / `buildRepairInstructions` / `generateOutlineWithRetry` / `buildOutlineSystemPrompt` / `buildOutlineUserPrompt` 五个不再使用的方法。

### 🎯 设计取舍
- 原子性与执行完整性优先：单次执行一次性完成全部规划步骤，不中断、不重试、不分段；接受额外性能/质量损耗作为可接受 trade-off，避免 AI 接口重复调用。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成模块优化（分卷章节超限告警 + 实体摘要裁剪）

### ⚡ 优化
- **单卷章节数超限告警**：`OutlineGenerator` 新增 `MAX_CHAPTERS_PER_VOLUME`（100 章）安全阈值，当某卷章节数超过阈值时输出告警日志，提示用户增加分卷数或提高每章字数，避免单次逐章输出触发省略/截断导致的生成变慢与重试。
- **实体摘要长度裁剪**：`PlanBookModal.readContextFile` 对单个实体 frontmatter 摘要做 400 字上限截断，防止超长字段拖垮大纲 prompt；仅裁剪摘要长度、不裁剪实体数量，确保不遗漏实体、不引入实体污染。

### ℹ️ 缓存/幂等说明
- 大纲生成已由 `AIApiClient.callAI` 的 prompt 缓存（`computePromptHash` + `PromptCache` LRU）覆盖幂等：相同 prompt（含相同实体上下文）命中缓存不再重复调用 AI；实体变化则 userPrompt 变化自动失效。故不新增「结果级缓存」，避免缓存过期实体上下文重新引入实体污染。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成实体注入回退全量污染清理

### 🐛 修复
- **批量建章角色上下文回退全量污染**：`batch-chapters-modal.ts` 在智能筛选（`scoreAndFilterEntities` Top-8）后残留一处「匹配不足 3 个时回退全量注入前 20 个角色」的兜底逻辑，会把无关角色全量注入章节生成上下文。该逻辑在 `scoreAndFilterEntities` 修复「正向分不足时按 topN 截断」后已成为死代码（实体数 > 8 时 `filtered.length` 恒 ≥ 3 或 = topN），但语义上仍属实体污染隐患。已移除该回退分支，统一信任 `scoreAndFilterEntities` 的 topN 截断，确保不同任务/多轮生成的角色上下文按相关性隔离、不再回退全量。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过（entity-scorer 新增 4 个「实体数据隔离」用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 全书规划（分卷大纲）向导「生成中」卡死修复

### 🐛 修复
- **向导步骤误置 executing 状态**：`executeWizardStep` 原先仅排除 `writing_style`，导致 `outline`/`chapters` 两个「打开弹窗」步骤被错误置为 `executing`，nav bar 持续显示「⏳ 生成中...请等待 AI 返回...」。这两步的实际 AI 生成由弹窗内部按钮触发（需用户在弹窗内二次确认），并非自动执行，故步骤看起来永久「生成中」、分卷大纲文件不更新。现统一为 `isModalStep` 判定，排除 `writing_style`/`outline`/`chapters` 三种弹窗步骤，使其不再进入 executing 状态。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。
- `npm run test`：2874 测试全部通过。

---

## Unreleased — 信息规划提示词章节号兜底修复

### 🐛 修复
- **提示词章节号显示「第0章」**：`buildTemplateVars` 的 `chapNum` 原直接取 `chapterNum`，当章节名尚未含数字（或初始化时序）时被解析为 0，导致信息规划提示词出现「第0章」与章节选择器「第1章」不一致；现增加从 `chapterName` 重新解析章号的兜底，`chapterNum` 为 0 时回退到章节名中的数字。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲/章节生成实体注入防污染

### 🐛 修复
- **实体评分回退全量污染**：`scoreAndFilterEntities` 在「正向分实体不足 3 个」时原先回退返回全部实体（`scored.slice(0, entities.length)`），把无关人物/势力/地点/物品全量注入大纲与章节生成上下文；改为按 `topN` 上限截断（`Math.max(1, topN)`），仅保留得分靠前的有限实体，消除无关实体污染。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2874 测试全部通过（entity-scorer 12 个用例含新增回退截断断言）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 正文涉及实体字段精确化（跨模块数据流转）

### 🐛 修复
- **章节 frontmatter 涉及实体全量污染**：`StepResultSaver.updateFrontmatterFields` 原先用 `.filter(() => true)` 简化判断，把项目全部人物/地点/势力/物品写入每一章正文 frontmatter；改为按正文 `bodyText` 实际出现过滤（与 `writeFixToBody` 的过滤逻辑对齐），仅写入本章真正涉及的实体，提升指纹/知识库读取正文元数据时的准确性。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2874 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — UI 主色统一为番茄/起点暖橙（交互界面优化）

### 🎨 优化
- **主色统一**：`theme-manager.ts` 的暗色/亮色主题强调色由偏灰的陶土色 `#b87d6e` 调整为番茄/起点风陶土橙红 `#C2410C`（hover `#9A3412`），贴合主流网文写作工具的暖色视觉。
- **消除紫/暖冲突**：主按钮 `--nw-btn-primary-bg` 由紫色 `#7c3aed` 统一为品牌橙红，消除「暖色强调 + 紫色主按钮」的视觉割裂；同步收敛强调色渐变、聚焦环、选中描边、文字强调色与次要按钮 hover 色，去除散落的硬编码紫。
- **编辑风衬线标题**：新增 `--nw-font-display`（Georgia/Songti SC/Noto Serif SC）衬线标题字令牌，协同写作标题采用衬线字体，营造「杂志编辑风」文学气质（对齐 design-contract）。
- **兼容性保留**：用户自定义 `themeColors.accent` 仍优先于默认值，主题兼容不受影响。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 指纹迁移补齐定量字段（内容拆解补全）

### ✨ 新增
- **迁移定量补齐**：`migrateV1ToV2` 在 V1 指纹带 `sourceText` 时，复用 `v2-quantitative-extractor` 的纯统计能力补齐「节奏/视角」两维的定量字段（平均句长/标点密度/人称分布等），消除迁移后定量字段全 0 的空缺；定性 `description` 仍保留 V1 分析结果不被覆盖。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- 定向测试：`fingerprint-migrator`（52）+ `v2-quantitative-extractor`（8）全部通过。

---

## Unreleased — 指纹库向量层统一 EmbeddingProvider（跨模块数据流转）

### 🔧 重构
- **指纹库向量层接入统一工厂**：`WritingFingerprintView.initLibrary()` 由硬编码 `new OllamaEmbeddingClient(...)` 改为 `EmbeddingProviderFactory.create(this.plugin.settings)`，使指纹提取与向量检索真正遵循用户配置的 `vectorProviderType`（Ollama / OpenAI 兼容 / 豆包 / 通义千问）。
- **类型拓宽**：`StyleFingerprintLibrary` 与 `KnowledgeToFingerprintConverter` 的 embedding 依赖由具体 `OllamaEmbeddingClient` 改为抽象 `EmbeddingProvider`，消除指纹库对本地 Ollama 的隐式耦合，任意向量源均可注入。

### ✅ 验证
- `npm run typecheck`：零类型错误。

---

## Unreleased — 内容拆解功能补全

### ✨ 新增
- **V2 定量拆解算法**：新增 `engine/style/v2-quantitative-extractor.ts`，实现节奏（句长分布/平均句长/短句占比/标点密度/段落密度/停顿频率）与视角（人称分布）两个维度的纯统计定量拆解，填补 V1→V2 迁移「定量字段全填 0」的算法空缺。
- **FingerprintExtractor V2 接口**：`FingerprintExtractor` 新增 `extractV2Quantitative()` 方法，暴露节奏/视角定量拆解能力，供 V2 提取流程接入。

### 🐛 修复
- **知识库拆解维度不一致**：`getMissingDimensions` 与拆解入口硬编码 6 维，改为统一使用 8 维（含商业价值/可读性），与 `getDimensionStatus` 及实际调度行为一致。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2872 测试全部通过（含新增 v2-quantitative-extractor 8 个用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 指纹库功能接线补全

### 🔧 补全
- **从知识库导入指纹**：`WritingFingerprintView.handleImportFromKnowledge` 由占位 Notice 改为完整实现——弹窗选择知识库书籍，复用 `KnowledgeToFingerprintConverter` + `addFromKnowledge` 转为项目写作指纹。
- **详情弹窗重新提取**：`onReextract` 由占位 Notice 改为调用 `refillFingerprint` 完整重新提取流程（缺失原始文本时给出明确引导）。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2864 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 模型源抽象与配置统一（架构底座）

### ✨ 新增功能
- **模型源类型抽象**：`CustomProvider` 新增 `sourceType: 'cloud' | 'local'` 字段，统一区分云端 API 与本地推理服务（Ollama / LM Studio / vLLM 等 OpenAI 兼容端点）。
- **模型源解析**：新增 `shared/model-source.ts`，提供 `ModelSourceType` 类型与 `resolveProviderSourceType()` 解析函数，旧数据按 id/endpoint 启发式兜底，向后兼容。
- **ProviderManager 扩展**：新增 `getProvidersBySourceType()` / `isLocalProvider()` / `getCurrentSourceType()`，为「模型源选择下拉列表」提供数据层支撑。

### 🔧 优化
- **消除双份默认设置**：`DEFAULT_SETTINGS` 改为引用 `getDefaultSettings()`（单一数据源），并补全后者缺失的 `foreshadowConfig`、`refineRounds`、`candidateParallel`、`promptCacheEnabled`、`vectorDoubao*`、`vectorQwen*`、`vectorMode` 字段。
- **消除切换逻辑双写**：设置页 API 提供商下拉统一走 `ProviderManager.switchByEndpoint()`，删除手写重赋值。
- **自定义提供商自动识别源类型**：新增本地端点（localhost/127.0.0.1）自动标记为 local。
- **AIApiClient 请求体构造去重**：提取 `buildRequestBody()` 公共方法，消除 `callAI` / `callAIStream` / `nativeStreamIterator` 三份重复的请求体构造逻辑。
- **本地模型判定统一**：co-writer 的 `isLocalProviderEndpoint` / `hasLocalProvider` 复用 `resolveProviderSourceType`，支持 `sourceType` 显式标记（如局域网 IP 的本地服务）。
- **模型源下拉分组标识**：设置页 API 提供商下拉按云端（☁️）/本地（💻）加前缀；协同写作「云端供应商」下拉改用 `sourceType` 排除本地 provider。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2864 测试全部通过（含新增 model-source 6 个用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 质量仪表盘联动修复

### 🐛 修复
- **质量仪表盘联动失效**：修复 `ui/quality-dashboard-modal.ts` 中筛选、钻取、导出的联动逻辑。
  - 章节定位：工作台视图活动时 `getActiveFile()` 返回 null，fallback 到工作台 `getCurrentChapterState()` 获取当前章节状态。
  - 时间范围筛选：当前章/最近3章/最近5章/全部章节，切换后雷达图、维度横条、问题列表同步更新。
  - 维度钻取：点击维度横条，问题列表过滤到对应维度。
  - 导出：导出当前「时间范围 + 维度」筛选后的数据集（JSON）。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2855 测试全部通过（含新增 `tests/unit/ui/quality-dashboard-modal.test.ts` 覆盖 3 个联动场景）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — UI 与数据可视化优化

### ✨ 新增功能
- **ChartContainer 统一图表容器**：`svg-charts.ts` 新增 `createChartContainer()` 工厂函数，封装公共 padding/网格/坐标轴/图例/tooltip 逻辑，返回 `{ svgStart, svgEnd, plotArea, legendArea, tooltipHtml }` 结构。
- **图表交互能力**：新增 `attachChartInteractions(container)` 函数，为所有图表提供 hover 高亮、HTML tooltip（位置跟随鼠标）、图例点击筛选功能。7 种图表数据元素全部添加 `data-*` 属性和 CSS 类。
- **响应式图表**：所有图表 SVG 根元素添加 `viewBox` + `preserveAspectRatio="xMidYMid meet"`，`width` 改为 `100%`，外层包裹 `.nw-chart-container`，图表自适应容器宽度。
- **图表动画过渡**：柱状图/环形图 CSS transition（height/opacity/transform 0.3s），折线图 stroke-dasharray 路径绘制动画，散点图/雷达图数据点 opacity 过渡。
- **新增图表类型**：`heatmap()`（行列标签+颜色梯度+单元格 hover）、`treeChart()`（dendrogram 布局+层级折叠）、`areaChart()`（渐变填充折线图）。
- **wordCloud 螺旋布局**：新增 `spiralLayout()` 函数，基于阿基米德螺线算法 + bounding box 碰撞检测，替代原 flex-wrap 排列。
- **空状态组件**：新增 `ui/components/empty-state.ts`，提供 6 种内联 SVG 图标（book/chart/data/search/folder/default），已在知识库、协同写作、指纹库 5 处视图应用。

### 🔧 优化
- **EmotionCurveView 重构**：从独立 polyline+circle 实现改为复用 `lineChart()`，消除代码冗余，获得贝塞尔曲线平滑、响应式 viewBox、交互 tooltip 等增强。
- **卡片视觉提升**：`.nw-card` 类添加 `box-shadow` + `transition`，`:hover` 状态添加 `translateY(-2px)` 上浮效果。
- **Modal 统一性**：新增 `.nw-modal-header`/`.nw-modal-body`/`.nw-modal-footer` 标准样式，统一标题栏、按钮区对齐、关闭交互。

### 🐛 修复
- **styles.css 残留 max-width**：修复 2 处 `.nw-scope .modal.nw-modal-xl` 的 `max-width: 2000px` → `1300px`，`clamp(900px, 92vw, 2000px)` → `clamp(900px, 85vw, 1300px)`。
- **重复文件清理**：删除 `css/design-tokens.css`（与根目录完全相同的重复文件），更新 `docs/CODE-INDEX.md` 引用。
- **Modal inline important 移除**：`mini-settings-modal.ts` 和 `tools-modal.ts` 移除 `style.setProperty('width', ..., 'important')`，改用 CSS 类管理；补充缺失的 `.nw-modal-md` 类定义。
- **硬编码假数据修复**：`knowledge-detail-modal.ts` 的 `getDimensionProgress` 硬编码 85 → 100（数据存在即满进度）。

### ✅ 验证
- `npm run build`：esbuild 构建通过（v4.10.6）。
- `npx vitest run`：2537/2541 测试通过（4 个失败为预存浮点精度问题，与本次改动无关）。
- `npx tsc --noEmit`：svg-charts.ts、emotion-curve-view.ts、empty-state.ts 零类型错误。

---

## Unreleased — 全局分析维度优化与字数统计统一

### ✨ 新增功能
- **字数统计多口径支持**：`text-segmenter.ts` 新增 `countWords` 函数，支持 `total`（含标点总字数）、`chinese_only`（纯汉字数）、`platform`（平台风格字数，汉字+数字+半角字母按0.5计算）三种统计模式。
- **商业分析报告字数展示**：报告开头新增"基本信息"板块，同时展示三种口径字数，格式化为万字单位。
- **字数聚合**：增量聚合器支持多段字数累加，确保全本字数统计准确。

### 🔧 优化
- **节奏均衡度算法升级**：从单一章节长度变异系数，扩展为长度均衡(50%) + 段落数均衡(30%) + 场景过渡一致性(20%) 的多维度评估。
- **情绪波动算法升级**：引入情绪强度分级（强/弱正负情绪加权），新增趋势反转检测，从纯波动幅度扩展为波动幅度(70%) + 趋势反转(30%)。
- **世界观完整度算法升级**：从类别覆盖率+密度的二维评估，扩展为类别覆盖(35%) + 词汇密度(25%) + 专有名词密度(20%) + 词汇多样性(20%) 四维评估。
- **角色丰富度算法升级**：新增对话引导词检测、姓氏模式匹配、对话量评估，从数量+密度扩展为数量(35%) + 密度(25%) + 姓氏多样性(20%) + 对话活跃度(20%)。
- **情节密度算法升级**：事件词分级加权（强事件×2），新增对话密度和动作密度维度，从事件+过渡扩展为事件(40%) + 过渡(25%) + 对话(20%) + 动作(15%)。

### ✅ 验证
- `npx vitest run tests/unit/engine/commercial-deconstructor.test.ts tests/unit/engine/incremental-result-aggregator.test.ts`：60/60 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.6）。

---

## Unreleased — 分段合并层置信度重构

### 🔧 修复
- **单段结果契约**：技术手法、商业与可读性在单段时同样进入必要标准化流程；商业、技术手法、可读性结果分别提供机器可读的段数、等权策略与数据状态。
- **可读性数据状态**：句式相似度与情感均匀度仅在所有分段明确标记 `insufficient` 时进行规则估算，聚合逻辑不再解析展示文案。
- **伏笔实体去重**：伏笔键只规范化大小写和空白，不再删除“的、了、着、过、之、其”等有效名称字符，避免不同实体被误合并。
- **商业合并口径**：`CommercialAnalysisResult` 尚未提供可靠的段体量元数据，商业总分与波形指标继续采用明确标记的等权聚合，不再声明字符或段落加权已实现。

### ✅ 验证
- `npm test -- tests/unit/engine/incremental-result-aggregator.test.ts`：聚合器回归测试通过，覆盖单段标准化、结构化数据不足、伏笔名称碰撞和商业等权口径。
- `npm run typecheck`、`npm run build` 与 `npm test`：2026-07-19 全量通过；118 个测试文件、2468 个用例全部通过。
- `obsidian plugin:reload id=novel-writer-ai`：清空开发者错误缓冲后完成重载，并执行知识库入口与视图刷新检查，未捕获新增运行时错误。

## Unreleased — 知识库详情运行时容错

### 🔧 修复
- **详情字段安全格式化**：知识库节奏页对爽点位置、钩子率/强度和张力指标使用统一数值格式化；缺失或无效数值显示“数据缺失”，不再中断详情渲染。
- **伏笔旧数据兼容**：伏笔统计缺失 `resolved` 或 `unresolved` 时按零值展示，并使用相同的安全值生成进度图。
- **工作区目录导航**：知识库详情、主设置、迷你设置的目录打开入口统一使用公共 `Workspace.getLeaf('tab').setViewState()`，移除不存在的 `revealLeafInNewTab` 调用。

### ✅ 验证
- `npm test -- tests/unit/ui/knowledge-detail-format.test.ts`：4/4 通过，覆盖缺失数值和目录导航行为。
- `npm run typecheck`、`npm run build` 与 `npm test`：2026-07-19 全量通过；118 个测试文件、2468 个用例全部通过。
- 重载后已执行知识库管理界面入口与视图刷新检查，开发者错误缓冲未出现本次 `toFixed`、`toString` 或 `revealLeafInNewTab` 异常。

### 🔧 变更
- **统一置信度框架**：`IncrementalResultAggregator` 新增 `combineConfidence`（离散度惩罚 + 佐证增益，保证"一致不降级"）、`pooledStd`（含段间方差的池化标准差）、`weightedMedianFromBuckets`（分布桶重建中位数）、`recomputeRate`（速率按总量重算）等原语，`buildSegmentWeights` 综合字符占比 × 数据完整度。
- **逐维度消除粗暴合并**：style 视角改置信度加权投票（去除取末段）、rhythm 方差改池化口径、technique 按 count 加权消除顺序依赖、structure 描述改覆盖度选择、character 合并后全局重算 importance/role（单段路径同样生效）、foreshadow 按归一化 name+type 去重。
- **commercial 聚合**：`avgOverallScore` 采用等权聚合；结果类型尚未提供可靠段体量元数据，因此不声明字符或段落加权已实现。移除 `ensureBaseline` 逐项地板价，兜底仅在各段均≈0（真实全 0）时触发。
- **readability 聚合**：`overallScore` 与 aiTrace 维度改加权，代表 description 改选"最接近加权均值"段；sentenceSimilarity / emotionUniformity 零值回退修正为"仅各段均数据不足时估算"，保留优质文本的合法低分（承接审计 BUG-3）。
- **一致性修复**：`combineResults` 对 character 维度单段不再短路，确保单段也进入全局后处理；合并入口新增统一打点 `[aggregate] 维度 X 合并 N 段结果`。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2460/2460 全部通过（含视角一致/冲突置信度、池化方差、修辞速率重算、单段角色重判等不变量用例）。
- `npm run build`：esbuild 构建通过（v4.10.6）。

---

## Unreleased — 拆解算法质量修复 V2

### 🔧 变更
- **abilities 提取结构性过滤**：移除 `ABILITY_NOISE_CHARS`，改用 `ABILITY_NOUN_PREFIXES` 名词白名单 + `TIME_ADVERB_CHARS` 时间/副词字集；"晚上才能""面又偶尔才能"等副词碎片不再被误提取为能力。
- **角色判定全局化**：`IncrementalResultAggregator.recomputeRolesFromGlobalStats` 按全本累计 appearanceCount(0.45)/dialogueCount(0.2)/perspectiveCount(0.2)/keyEventCount(0.15) 归一化重判 role，低频配角不再被分段升格为 protagonist。
- **伏笔噪声过滤**：`ForeshadowDeconstructor.filterNoiseForeshadows` 过滤单字伏笔、纯虚词伏笔及 `COMMON_NOISE_WORDS` 黑名单（无法/效果/隐秘/级封印 等）。
- **字数统计口径**：`text-segmenter.ts` 新增导出 `countTotalChars`，结构拆解 `totalWordCount` 改为直接统计源文本而非 AI 估算。
- **商业价值兜底**：`validateGoldenThreeChapters` 恢复"无行首章节标记即空结果"契约，全零兜底统一交由 `analyze()`（非空文本 overallScore 兜底 26）与聚合层 `combineCommercialResults` 处理。
- **可读性零值回退**：`combineReadabilityResults` 对 sentenceSimilarity / emotionUniformity 零值维度提供规则层估算。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2443 通过，1 例 token-bucket 计时用例在满载下偶发失败（单独运行 20/20 通过），与本次改动无关。
- `npm run build`：esbuild 构建通过。
- 新增单元测试：abilities 结构性过滤、伏笔后处理过滤、role 全局化判定、`countTotalChars`。

---

## Unreleased — 拆解调度器增量缓存

### ✨ 新增功能
- `DeconstructionScheduler` 新增基于内容哈希的增量缓存机制，避免对相同源文本重复拆解。
- 新增 `computeContentHash(text)` 方法：优先使用 Web Crypto API SHA-256 哈希，不可用时自动降级到 `simpleHash()`（djb2 变体 32 位哈希）。
- 缓存 key 为 `bookId:dimension`，存储 `{hash, result}` 结构，纯内存，实例生命周期。

### 🔧 变更
- `runTask` 方法在维度处理前计算 `task.sourceText` 内容哈希。
- `processDimension` 闭包在维度执行前检查缓存命中，命中时跳过拆解、直接复用结果并发送 "缓存命中" 进度。
- 维度执行成功后自动将结果写入 `dimensionCache`。
- `destroy()` 中新增 `dimensionCache.clear()` 确保资源释放。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2432 通过，2 失败均为已有问题（浮点精度、sourceText 截断），非本次改动引入。

---

## 全文分块拆解主流程 (cont.)

### 🔧 变更
- `DeconstructionScheduler.addTask` 不再按 `textSampleLimit` 截断源文本，任务保留完整 `sourceText`。
- 主拆解入口在维度执行前判断是否需要全文分块，超阈值时复用 `SchedulerSegmentIntegration` 编排分块拆解。
- 分块策略复用 `TextSegmenter`：章节标题优先，章节不可用或单章过长时按段落/字数兜底。
- 分块结果通过 `IncrementalResultAggregator` 聚合，不再默认只取最后一块；保留 LLM 增强可选接入参数，当前调度器未注入 LLM 实例时安全跳过。
- 向量增强失败时，全文分块流程降级到纯统计分块并记录降级原因。

### ✅ 验证
- `npx vitest run tests/unit/services/deconstruction-scheduler.test.ts tests/unit/services/scheduler-segment-integration.test.ts tests/unit/services/segment-aware-breakdown.test.ts tests/unit/engine/incremental-result-aggregator.test.ts`：35 个测试通过。
- `npm run typecheck`：失败；项目存在多处既有类型错误，本次已修复直接相关的 `segment-aware-breakdown.ts` 可选进度回调类型问题。

---

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

---

## Unreleased

### 🐛 问题修复

**拆解器同步阻塞修复（6 维度全覆盖）**
- `rhythm-deconstructor.ts`、`technique-deconstructor.ts`、`structure-deconstructor.ts`、`character-deconstructor.ts`、`foreshadow-deconstructor.ts` 的 `analyze()` 方法由同步改为 `async`，并在重计算之间插入 `await yieldToUI()` 让出主线程，避免 200 万字长文本分析时 Obsidian 卡死
- 所有 5 个拆解器在 `analyze()` 入口添加 10 万字取样限制（`text.slice(0, 100_000)`），将 O(n²) 全文 `indexOf(para, charOffset)` 降为取样范围内的 O(n)，显著降低长文本分析耗时
- `analyzeWithVector()` 与 `saveToMarkdown()` 中的 `this.analyze(text)` / `this.analyze('')` 调用同步补充 `await`，修复 async 传染后返回 Promise 导致后续逻辑失效的问题
- `style-deconstructor.ts` 的 `analyzeWithVector()` 中遗漏的 `await this.analyze(text)` 一并补齐（Task 1 遗留）
- `deconstruction-worker.ts` 中 5 个拆解器的 `analyze(input.text)` 调用补充 `await`，确保 worker handler 正确等待 async 结果
- 约束：不修改返回值结构，不修改无性能问题的方法，保持现有代码风格

**Ollama Embedding 超时与取消支持**
- `OllamaEmbeddingProvider.embed()` 新增 30 秒超时机制：通过 `AbortController` + `setTimeout` 控制，Ollama 服务响应过慢时不再让 fetch 无限等待，避免 Obsidian 卡死
- `embed()` 与 `embedBatch()` 新增可选 `options?: { signal?: AbortSignal }` 参数，支持外部取消嵌入请求；超时或取消时抛出明确的中文错误信息
- `EmbeddingProvider` 接口及 `OpenAIEmbeddingProvider`（含 Doubao/Qwen 子类）的 `embed`/`embedBatch` 签名同步加入可选 `options` 参数，向后兼容（不传时行为与修改前一致）
- 注意：本次仅 `OllamaEmbeddingProvider` 接入超时逻辑，OpenAI 系 Provider 仅做签名兼容；调用方传 signal 留待后续任务

**Ollama Embedding 批量并发优化**
- `OllamaEmbeddingProvider.embedBatch()` 由串行逐个调用改为并发限流（最大并发数 5）：使用纯 Promise worker pool 模式，启动 `min(5, texts.length)` 个 worker 共享 `nextIndex` 游标消费任务
- 结果顺序保持：通过 `results[currentIndex] = ...` 按原索引写回，返回顺序与输入一致
- 取消传播：每个 worker 循环及 `executeOne` 入口均检查 `options.signal.aborted`，取消时抛出中文错误
- 不引入第三方库（如 p-limit、bluebird），不修改 `embed()` 方法本身，签名与返回类型不变
- 背景：6 维度拆解约 300+ 次串行 HTTP 请求，并发限流后显著降低总耗时

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

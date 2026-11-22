# 生成与消费链路审计：同人设定 / 知识库 / 指纹三层

- 审计时间：2026-11-11
- 触发：用户要求「查看生成和消费链路，包括同人设定卡和知识库，以及指纹，特别是指纹的三个层次设定」
- 基线：v4.83.0（`76dffa5`）

---

## 一、指纹的三个层次

| 层 | 定位 | 存储 | 是否参与注入 | UI 处理 |
|---|---|---|---|---|
| `template` 模板层 | **来源库**（只读素材） | `template-fingerprints.json` | ❌ **不参与** | 隐藏启用/强度控件，显示「来源库 · 复制到项目后生效」 |
| `global` 全局层 | 跨项目通用 | `global-fingerprints.json` + 项目级覆盖表 | ✅ | 可启用；启用状态**按项目覆盖** |
| `project` 项目层 | 本项目专用 | `pjControlDir(project)/.../fingerprints.json` | ✅ | 可启用 |

### 消费合并规则（`getEnabledFingerprints`）

```
projectEnabled = projectFingerprints.filter(fp => fp.enabled)
globalEnabled  = globalFingerprints.filter(fp => isGlobalEnabledForProject(fp.id, targetProject))
返回 [...projectEnabled, ...globalEnabled]
```

- **template 不在合并范围**是**明确设计**，不是遗漏：
  `ui/fingerprint-utils.ts#isSourceOnlyFingerprintScope` 的注释写明「模板层是来源库而非注入层」，
  且三处 UI 入口（指纹库视图 / 设置页 / 列表渲染）都隐藏了启用控件。
  设置页 `if (fp.scope === 'template') return;` 是防御性代码（开关根本不会渲染）。

---

## 二、发现并修复的真缺陷

### F1（已修）｜指纹消费链路首次运行静默为空

**症状**：11 步执行、模式注入、资产注册、润色、prompt-builder 这 5 条路径，
首次运行时启用的指纹**恒为空数组**——风格约束静默消失，无任何报错。

**根因（三件事叠加）**：
1. `StyleFingerprintLibrary` 构造函数**不加载任何数据**（只设置 embedding client）
2. `getEnabledFingerprints()` 直接读内存表 `this.projectFingerprints` / `this.globalFingerprints`
3. 6 个消费方里**只有 `co-writer-engine`** 在每轮前调 `reloadIfChanged`，
   其余 5 处（`step-runner` / `mode-injection` / `asset-registry` / `polish-editor` / `prompt-builder`）都不调

对照：`KnowledgeVectorStore.search` 有 `ensureLoaded()` 自愈，指纹库没有——属于**设计不一致**。

**修复**：`getEnabledFingerprints` 读取前先 `reloadIfChanged`（内部按文件签名比对，未变化时快速返回），
加载失败时退回内存数据并 warn，不阻断读取。所有消费方不必再各自记得先 reload。

**测试**：新增 5 条（新建实例直接读能拿到项目/全局指纹、另一实例禁用后自动同步、
重复读取幂等、坏文件不阻断）。旧实现在第 1 条即失败。

### F2（已修）｜同人设定的审核闸门被向导路径绕过

**症状**：11 步向导的「原作设定导入」步骤（`executeFanficStep`）此前**只校验字段完整性**，
就把内容**直接写入正式目录并绑定** `.project`：

```ts
const filePath = getFanficSettingsPath(tab.project, content, tab.project);
await writeVaultText(this.app, filePath, content);        // 直接写 05-同人设定库/
await attachFanficPathToProject(this.app, tab.project, filePath);  // 直接绑定
```

而 `buildWizardSteps('fanfic')` 的步骤链是
`原作设定导入 → 故事结构 → 实体生成 → 世界观设定 → 设定库 → 文笔风格 → 全书规划 → 批量建章 → 完成`
——**没有任何审核步骤**。

于是存在两条互斥的保存路径：

| 路径 | 流程 | 是否过审核 |
|---|---|---|
| 弹窗（`add-fanfic-setting-modal`） | 生成 → `_待审核/` → 人工审核 → 正式目录 | ✅ |
| **向导（`executeFanficStep`）** | 内容 → **直接正式目录 + 绑定** | ❌ |

**后果**：AI 生成但未核实的设定（可能含凭空推断的原作规则）会被后续步骤
当作原作约束消费，审核机制形同虚设。

**修复**（复用既有 `isFanficApproved`，避免再造一套判定）：
- `approved` → 正式目录（正常放行）
- `legacy`（旧文件无审核记录）→ 正式目录，但提示「建议重新审核」（不阻塞历史项目）
- `pending` / `rejected` → 写入 `_待审核/`，**不绑定项目**，步骤置回 `pending` 并明确提示

**为什么 legacy 要放行**：项目里存在大量早期无审核记录的设定文件，
强制拦截会让老项目无法继续走向导；`formatFanficReviewWarning` 也采用「提示而非阻断」口径。

**顺带确认（不是缺陷）**：
- `listFanficSettingCandidates` 明确排除 `_` 开头目录（`_待审核` / `_资料` / `_审核`），
  所以**待审核草稿在 UI 上无法被绑定**——闸门在绑定入口是安全的，漏的只是向导保存入口
- `fanfic-review-modal` 审核通过后才写正式目录 ✅

**测试**：新增 8 条（`isFanficApproved` 四种状态口径、`parseFanficReviewStatus` 解析、
源码契约锁定「闸门必须在写正式目录之前」且「拦截分支不得调用绑定」）。


---

## 三、核查后确认「不是缺陷」的设计（避免误判）

| 项 | 核查结论 |
|---|---|
| template 层不参与注入 | ✅ 明确设计，三处 UI 一致隐藏控件并给提示 |
| global 层默认启用 + 项目覆盖 | ✅ 设计完整：`isGlobalEnabledForProject` 优先读项目覆盖表，缺省回落到指纹自身 `enabled` |
| 复制/提升是否 id 冲突 | ✅ `copyFingerprint` 用 `generateId()` 生成新 id，跨层不会串味 |
| 知识库检索新鲜度 | ✅ `search` 内部 `ensureLoaded()` → `reloadIfChanged()` |
| 同人设定读取新鲜度 | ✅ `co-writer-engine` 每次生成前 `readFanficRulesFromFS` 重读；UI 侧 `readFanficRules` 也是每次读文件 |
| 知识库→指纹转换 | ✅ 风格拆解缺失**抛错**不静默；samples 只用真实原文（注释明确拒绝拆解报告段落，避免模型模仿「分析报告腔」）；强制 `scope: 'project'` |

---

## 四、记录但未改动的设计问题（需产品决策）

### D1｜全局指纹的「强度配置」按项目存储

`loadIntensityConfigs(targetProject)` 只读
`pjControlDir(project)/.../intensity.json`（**项目级**文件）。

后果：给一个**全局指纹**配好强度后，切到另一个项目会回退默认值（`globalIntensity = 1.0`）。

**为什么不直接改**：
- 需要新增全局强度文件或"全局默认 + 项目覆盖"的两级结构
- 涉及数据迁移（现有项目级配置如何映射）
- 属于产品决策：全局指纹的强度**应该**是全局统一，还是允许按项目微调？两者都合理

**建议**：如果决定改，采用「全局默认 + 项目覆盖」两层（与 global 指纹的启用状态同构），
复用 `globalFingerprintStates` 的模式。

---

## 五、三条链路的新鲜度对照（本次审计的核心结论）

| 链路 | 数据读取方式 | 新鲜度机制 | 结论 |
|---|---|---|---|
| 知识库 | 向量库内存表 | `ensureLoaded()` 自愈 | ✅ 自愈 |
| 同人设定 | 每次读 Markdown 文件 | 每次生成前重读 | ✅ 天然新鲜 |
| **指纹** | 内存三张表 | **原：依赖调用方手动 reload** | ❌ **已修为自愈** |

**规律**：三条链路里，只有指纹把「刷新」的责任推给了调用方，而调用方有 5 处没履行。
凡是「读共享内存 + 由调用方负责刷新」的设计，都应当改为**读取前自愈**——
这是本次审计最有迁移价值的一条结论。

---

## 六、可复现命令

```powershell
cd .obsidian/plugins/novel-writer-ai
# 三层结构
Select-String -Path engine/style-fingerprint-library.ts -Pattern 'getEnabledFingerprints|isGlobalEnabledForProject'
# 消费方是否 reload
Select-String -Path engine/*.ts,ui/**/*.ts -Pattern 'reloadIfChanged|getEnabledFingerprints'
# template 是 source-only 的设计依据
Select-String -Path ui/fingerprint-utils.ts -Pattern 'isSourceOnlyFingerprintScope'
```

---

## 七、正文第 7 步「四项校验」落点复审（2026-11-22）

规格来源：`docs/design/v4.21-workflow-ai/01-three-mode-workflow-spec.md` 第 7 步正文生成，
要求交付前校验「字数 / 格式 / 视角 / 钩子」。逐项核对实际代码落点：

| 校验项 | 实际落点 | 是否阻断 | 备注 |
|---|---|---|---|
| 字数 | `engine/step-definitions.ts:140-151` `postCheckWordCount`，挂在 `:190` 第 7 步 `postValidation` | ✅ 阻断（低于 `floor(defaultWordCount × wordMinRatio)` 判 `passed:false`） | 唯一真正进了第 7 步门禁的项 |
| 格式 | 无门禁；写盘前由 `engine/body-writer.ts` → `shared/body-format.ts#normalizeBodyText` 直接规整（`deriveBodyFormat` 解析「写作规则.md」）；偏离统计由 `analyzeBodyFormat`（同文件）产出，并带最多 8 条行号定位（`samples`） | ❌ 不阻断 | 已补可读信号：偏离行占比 ≥ 0.15 时质量面板给 warning，并列出「第 N 行（缺缩进/空行/标题/元叙述）」 |
| 视角 | `engine/consistency/extended-rules.ts:222-244`（`FIRST_PERSON` 于 `:53`、`THIRD_PERSON` 于 `:54`，阈值 first≥3 && third≥3 且 min/max≥0.25）；调用链 `pairExtended` ← `engine/consistency/pairing-rules.ts:294` ← `engine/consistency/audit-pipeline.ts` | ❌ 不阻断 | 只在「一致性审核」入口跑，不随正文生成自动出结果；已先剔除成对对话引号（“”「」『』）内容，「他说」这类叙述标签仍按第三人称计 |
| 钩子 | `engine/quality-gate.ts:154-168` `checkEndingHook`（`ENDING_HOOK_WINDOW = 200`，认 `type==='hook'` 的 beat，无 beat 即通过；命中口径复用 `BeatVerifier` 的整串/子短语匹配）；由 `engine/step-runner.ts:1639-1684` 在正文保存后触发 | ❌ 不阻断（仅事件+诊断；`autoRevisionAfterQC` 打开时才定向修订） | `buildGateBeatsFromVars(ctx.vars)` 已追加 `buildHookBeatFromVars` 的钩子节拍（`required:false`，不改变 BeatVerifier 阻断语义） |

### 为什么第 7 步补不了这三项

`engine/step-definitions.ts:256-296` 的 `StepRunCtx` 只有 `defaultWordCount`，
**没有 beats、没有写作规则**——`postValidation` 拿不到钩子清单和格式契约，
硬写启发式只会制造误报。

### 结论

现状是「**一项硬门禁 + 三项事后软信号**」，与规格第 7 步「四项校验」的字面要求不完全一致。
真正的缺口不是缺少校验代码，而是：
1. 格式偏离被静默规整，没有任何可读反馈；
2. 视角与钩子的结果分散在「一致性审核」和「正文保存后门禁」两个入口，
   用户拿不到一份合并的「本章四项校验」结论。

**建议**（不增加误报、不改链路）：第 7 步完成后，把三项软结果聚合进质量面板一份视图；
格式项改为「规整前后差异 > 阈值时给 warning」，而不是直接静默。是否落地待产品决策。

**用户裁定（2026-11-22，逐字）**：「按推荐做」——即采用上面的软聚合方案。

### 落地（2026-11-22，已实现）

| 环节 | 落点 |
|---|---|
| 聚合模型 | `shared/chapter-four-checks-model.ts`（`buildFourCheckReport` / `renderFourCheckReport` / `fourCheckAttentionItems`；格式阈值 `FORMAT_DEVIATION_WARN_RATIO = 0.15`） |
| 格式偏离 | `shared/body-format.ts#analyzeBodyFormat`：只统一换行后逐行统计缩进缺失、空行分段、残留标题、元叙述，`ratio = min(1, deviated/totalLines)`；同时收集最多 8 条 `samples`（行号 + 类型 + 前 24 字），每行只记优先级最高的一条（标题 > 元叙述 > 缺缩进） |
| 视角混用 | `engine/consistency/extended-rules.ts#detectPerspectiveMix`（从既有 perspective 规则抽取，判据 first≥3 && third≥3 且 min/max≥0.25，未改口径） |
| 钩子依据 | `engine/quality/gate-snapshot.ts#buildHookBeatFromVars`：从 `parseInfoPlanFields(vars.infoPlan).hookContent` 造 `type:'hook', required:false` 节拍；`checkEndingHook` 改为按 `type` 取节拍并用 `BeatVerifier` 匹配 |
| 接线 | `engine/step-runner.ts#runFourChecks`：正文保存 + QualityGate 之后调用，发诊断事件（`{ detail: renderFourCheckReport(report) }`）并写盘，全程 try/catch 不影响正文 |
| 持久化 | `services/four-check-store.ts` → `<项目>/04-项目总控/质量面板/四项校验.json`（`{ version:1, chapters:{ 章名: FourCheckReport } }`，按章覆盖、`MAX_CHAPTERS=500` 按 `checkedAt` 淘汰，损坏降级为空） |
| 展示 | `ui/quality-loop-modal.ts` 新增「本章四项校验」区块 + 「按磁盘正文重算」按钮（标题/说明/占位文案放 shared，避开 `ui/**` 中文棘轮） |

**验收口径**：字数仍由第 7 步 `postCheckWordCount` 硬门禁阻断；其余三项只进报告与诊断，
`report.warnCount > 0` 时诊断级别为 warning，**不触发修订、不改 passed**。
测试：`tests/unit/shared/chapter-four-checks-model.test.ts`（18）、
`tests/unit/services/four-check-store.test.ts`（6）、
`tests/unit/shared/body-format-deviation.test.ts`（6）、
`tests/unit/engine/consistency/perspective-mix.test.ts`（4），并扩展
`gate-snapshot.test.ts`（9）、`quality-gate.test.ts`（11）——钩子用例覆盖「`required:false` 仍检测」
「自然语言钩子子短语命中」「无钩子节拍→通过」。

### 按需重算：覆盖不经过步骤 7 的正文路径（2026-11-23）

步骤 7 的自动记录只覆盖 `StepRunner` 写正文这一条路径，其余路径此前没有四项校验结论：
`ui/cowrite/body-save-controller.ts:177`（协同写作自动保存）、`main.ts:1982`
（`generateChapterBySceneLoop` 场景循环）、`main.ts:2051`（`autoReviseChapter` 定向修订写回）、
`ui/continue-chapters-modal.ts:412`（续写）。

处理方式：**不在协同每次自动保存时自动记录**（2 秒一条、编辑中途的半章正文会把报告刷成噪音，
且保存时拿不到 `settings.defaultWordCount`），改为「按磁盘事实按需重算」——质量面板一键对任意章节重算。

| 环节 | 落点 |
|---|---|
| 重算服务 | `engine/quality/four-check-refresh.ts`：`refresh({ project, chapterName, bodyPath, body?, targetWords?, now? })`；正文优先取传入的 `body`，否则按 `bodyPath` 读盘；空正文抛「正文为空，无法校验：…」，项目不存在抛「项目不存在或不是作品目录：…」 |
| 判定口径 | 全部复用既有实现：`shared/body-format.ts#analyzeBodyFormat`、`engine/consistency/extended-rules.ts#detectPerspectiveMix`、`engine/quality-gate.ts#detectHookCoverage`、`shared/chapter-four-checks-model.ts#buildFourCheckReport`；不新增规则 |
| 钩子依据 | 由正文路径 `/03-大纲与章节/正文/第N卷/第M章[^/]*_正文.md` 推导本章步骤文件 `pjStepFile(project, N, M, '信息规划')`，读 `parseInfoPlanFields` 的「章末钩子」；无步骤文件或未声明 → `{ required:0, present:null }`（skip） |
| 钩子判定抽取 | `engine/quality-gate.ts#detectHookCoverage(body, hookDescription, windowLen = ENDING_HOOK_WINDOW)`：空描述返回 true，取结尾窗口后用 `BeatVerifier` 子短语口径；`checkEndingHook` 与重算服务共用，避免两套判据 |
| 插件入口 | `main.ts#refreshFourChecks(project, chapterName)`：`assertProjectExists` + 既有 `findChapterBodyPath`（找不到抛「找不到「X」的正文文件」）+ `new FourCheckService(this.app).refresh({ …, targetWords: this.settings.defaultWordCount })` |
| 面板入口 | `ui/quality-loop-modal.ts`「按磁盘正文重算」按钮（`busy='fourcheck'`，成功写回 `this.fourChecks[chapter]` 并刷新区块）；按钮与提示文案放 `shared/chapter-four-checks-model.ts` |
| 归档 | 仍写 `<项目>/04-项目总控/质量面板/四项校验.json`，与步骤 7 自动记录同一份文件、按章覆盖；写失败只 `log.warn`，不影响本次结论 |

测试：`tests/unit/engine/quality/four-check-refresh.test.ts`（7）——钩子落末段 pass / 声明但缺失 warn /
无信息规划 skip / 字数低于硬门禁 fail / 格式偏离 warn / 人称混用 warn / 空正文与不存在项目抛错。

### 复现命令

```powershell
Select-String -Path engine/step-definitions.ts -Pattern 'postCheckWordCount|wordMinRatio|postValidation'
Select-String -Path engine/quality-gate.ts -Pattern 'checkEndingHook|ENDING_HOOK_WINDOW'
Select-String -Path engine/consistency/extended-rules.ts -Pattern 'FIRST_PERSON|THIRD_PERSON|视角混乱'
Select-String -Path engine/step-runner.ts -Pattern 'new QualityGate|buildGateBeatsFromVars|autoRevisionAfterQC'
Select-String -Path engine/body-writer.ts,shared/body-format.ts -Pattern 'normalizeBodyText|deriveBodyFormat'
```

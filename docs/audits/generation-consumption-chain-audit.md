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
| 格式 | 无门禁；写盘前由 `engine/body-writer.ts` → `shared/body-format.ts#normalizeBodyText` 直接规整（`deriveBodyFormat` 解析「写作规则.md」） | ❌ 不阻断，也不产出信号 | 规整是「静默修正」，用户看不到原文偏离了什么 |
| 视角 | `engine/consistency/extended-rules.ts:222-244`（`FIRST_PERSON` 于 `:53`、`THIRD_PERSON` 于 `:54`，阈值 first≥3 && third≥3 且 min/max≥0.25）；调用链 `pairExtended` ← `engine/consistency/pairing-rules.ts:294` ← `engine/consistency/audit-pipeline.ts` | ❌ 不阻断 | 只在「一致性审核」入口跑，不随正文生成自动出结果；不剔除对话引号，「他说」会计入第三人称 |
| 钩子 | `engine/quality-gate.ts:155-160` `checkEndingHook`（`ENDING_HOOK_WINDOW = 200`，只认 `type==='hook' && required` 的 beat，无 beat 即通过）；由 `engine/step-runner.ts:1639-1684` 在正文保存后触发 | ❌ 不阻断（仅事件+诊断；`autoRevisionAfterQC` 打开时才定向修订） | `buildGateBeatsFromVars(ctx.vars)` 提供 beat 依据 |

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

### 复现命令

```powershell
Select-String -Path engine/step-definitions.ts -Pattern 'postCheckWordCount|wordMinRatio|postValidation'
Select-String -Path engine/quality-gate.ts -Pattern 'checkEndingHook|ENDING_HOOK_WINDOW'
Select-String -Path engine/consistency/extended-rules.ts -Pattern 'FIRST_PERSON|THIRD_PERSON|视角混乱'
Select-String -Path engine/step-runner.ts -Pattern 'new QualityGate|buildGateBeatsFromVars|autoRevisionAfterQC'
Select-String -Path engine/body-writer.ts,shared/body-format.ts -Pattern 'normalizeBodyText|deriveBodyFormat'
```

# 写作指纹 V2 规范模型决策（ADR）

- 状态：**已定稿**（2026-11-21）
- 决策者：用户（2026-11-21 指示「先把 V2 规范模型这个产品决策做实」）+ 技术落地 DSH
- 相关实现：`engine/style-fingerprint-library.ts`、`engine/style/fingerprint-migrator.ts`、`engine/style/style-dimensions-v2.ts`、`engine/style/style-features-v2.ts`、`engine/style/dynamic-injection-engine.ts`
- 相关文档：`docs/modules/writing-fingerprint.md`、`docs/planning/2026-11-21-quality-optimization-roadmap.md`

## 1. 背景：两套模型并存的真实状态

代码里长期同时存在 V1 与 V2 两套写作指纹表示：

| | V1 | V2 |
| --- | --- | --- |
| 形状 | 7 个字符串（`sentenceRhythm` / `wordPreference` / `narrativeStyle` / `rhetoric` / `dialogueStyle` / `paragraphStructure` / `overallTone`） | 12 维结构化对象（每维 = 量化字段 + `description` + `samples` + `status`） |
| 定义 | `engine/style-fingerprint-library.ts:109` | `engine/style/style-dimensions-v2.ts:350` |
| 来源 | AI 抽取（`engine/fingerprint-extractor.ts`）或蒸馏 | `StyleFeaturesAnalyzerV2.analyze()`（`engine/style/style-features-v2.ts:459`，纯本地统计） |
| 谁在消费 | 提示词注入（`engine/style/dynamic-injection-engine.ts:557` 写死 7 个 featureKey）、大部分 UI | V2 向量检索/挑选、融合（`fingerprint-blender-v2`）、V2 详情页 |

关键事实（读码确认，不是推测）：

1. **V2 不是「未来格式」，它已经能独立成立**：`StyleFeaturesAnalyzerV2.analyze()` 全程本地统计（词表 + 正则 + 分句），不调用 AI；12 维都能从原文算出来。
2. **提示词只读 V1 的 7 段字符串**：`dynamic-injection-engine.ts:557` 的 `featureKeys` 固定为 V1 七维，`descriptionLength` 截断后 join。V2 的 5 个新增维度（句式模式 / 情感 / 张力 / 信息密度 / 描写）**目前完全没进提示词**。
3. **磁盘现状是双写**：`addV2Fingerprint`（`:772`）已经能直存 V2；但 AI 抽取入口仍走 `addTemplate/addGlobal/addProject`（V1），`toPersistedFingerprint`（`:1656`）在「无 V2 缓存」或「V1 投影变了」时**回写 V1**。于是新建指纹是 V1，下次加载才迁移，迁移时 5 个新增维度一律 `pending`（`fingerprint-migrator.ts:294`），永远算不出来。
4. **内存视图是 V1**：`migrateFingerprintV1toV2`（`:1726`）刻意把磁盘的 V2 还原成 V1 条目，注释写明「保证内存中始终是 V1 StyleFingerprint，向后兼容现有代码」。
5. V1 的 `@deprecated` 只是标注问题：V1 并不会被删除，它是提示词投影层。

结论：**V1/V2 不是新旧两个世代，而是「一份数据的两种视图」被实现成了两条各自可写的链路。**

## 2. 决策

**V2 是写作指纹的规范模型（single source of truth）；V1 七维降级为「提示词投影」（prompt projection），只读、可重新生成、不允许人工编辑。**

具体规则：

### R1 写路径：只允许产生 V2

- 新增指纹统一走一条路径：`FingerprintExtractor.extractWithAnalysis(text)` → 本地 `StyleFeaturesAnalyzerV2` 得到 12 维定量 → `addTemplate/addGlobal/addProject(fp, analysis)`。磁盘只写 `version: 'v2'`（P2 已落地，见 §10）。
- AI 抽取（`FingerprintExtractor`）继续保留，负责 7 维 prose 文案与 samples；本地分析器负责 12 维定量与 5 个新维的文案。二者**一次抽取内合并**：7 维 description 用 AI 文案，其余用本地统计文案（等价于「先本地、再 AI 润色」，但只花一次 AI 调用）。
- V1 的 `addTemplate/addGlobal/addProject(fp)` 保留为**迁移/导入兼容接口**：不带 analysis 时内部 `migrateV1ToV2` 后再落盘（§4），加载期由 `backfillV2Dimensions` 补齐。
- 编辑只允许编辑 V2（`updateV2FingerprintFeatures`），V1 文案由投影自动重算。

### R2 落盘：磁盘上不存在 V1 条目

- `toPersistedFingerprint` 必须返回 V2：有 V2 缓存则同步 7 维 description；无缓存则 `migrateV1ToV2` 现场生成。**禁止回写 V1**（避免「保存一次降级一次」）。
- 加载仍是 V1 视图（`migrateFingerprintV1toV2`），但它是投影读取，不产生新的写路径。
- 旧文件迁移保持幂等 + `.v1.bak` 备份，失败回滚（现有 `migrateFileV1ToV2` 行为不变）。

### R3 提示词：投影优先，V2 增量可选

- 现有 7 段注入（`buildGlobalTier`）继续读 V1 投影，投影只来自 `extractV1FeaturesFromV2`（`:2619`），不读磁盘上的 V1 字段。
- V2 独有的 5 维（`sentencePattern / emotion / tension / infoDensity / description`）在 7 段之后追加一段「V2 深化特征（量化）：」，每维一行（标签 + 定量摘要 + 本地描述）。这是用户 2026-11-21 决定（「P2 和 P3 按效果最好的做，暂不考虑成本」）的落地：**默认开启**，只受现有强度配置约束（`globalIntensity: 0` 时整段随之消失，描述长度仍按 `descriptionLength` 截断）。
- 只注入 V2 新增 5 维，不与 7 维投影重复；`status !== 'complete'` 的维度跳过（避免把「暂无数据」写进提示词）。

### R4 UI：V2 为主视图，V1 为「提示词视图」

- 详情页默认展示 V2 12 维（已有 `ui/views/fingerprint-v2-detail.ts`）。
- V1 七维作为只读「提示词视图」展示，并标注「由 V2 投影生成，不可直接编辑」。
- 新建向导在无原文（只有 AI 摘要）时，明确告知「V2 的 5 个维度不可用，需补样本或重新蒸馏」。

### R5 迁移：原文在就能补齐

- 有 `sourceText` 的旧指纹，迁移时用本地分析器补齐 12 维（`status: 'complete'`）。
- 无 `sourceText` 的保持 7 complete + 5 pending，并在 UI 标「缺原文，可重填」。
- `samples` 只能作为降级代理（`sampleProxy` 标记），不得冒充全量分析结果。

## 3. 为什么不选另外两条路

- **A. 继续双写、把 V2 当附加视图**（现状）：每次保存都可能降级；V2 的 5 维永远是 pending；两个入口产生两种质量的数据，检索/融合/编辑行为不一致。已证实会反复回归（`toPersistedFingerprint` 的 `same` 检查就是为打补丁存在的）。
- **B. 反过来让 V1 当规范、V2 当缓存**：V2 的量化字段与逐维样本无处存放，12 维检索（`searchSimilarStylesV2`）与融合都必须依赖 V1 无法表达的维度；且 V1 的 7 段文本不可重算。等于放弃现有 V2 能力。

## 4. 本 ADR 已落地的第一步（P1）

`engine/style-fingerprint-library.ts`：

- `toPersistedFingerprint` 改为**始终返回 V2**：
  - 有缓存 → `syncV1DescriptionsIntoV2`（只同步 7 维 description + 刷新 `v1Backup`，保留 5 维统计与样本）；
  - 无缓存 → `createV2FromV1`（`migrateV1ToV2` 现场生成并登记缓存）。
- 新增测试：
  - `tests/unit/engine/style/fingerprint-v2-canonical-write.test.ts`（3 例）：V1 入口新增即落盘 V2、7 complete + 5 pending、重复保存不降级、文件内不允许 V1/V2 混写；
  - `tests/unit/engine/style/fingerprint-library-persist-guard.test.ts` 的「V1 重新提取」用例改为「同步进 V2、仍以 12 维落盘」。

这一步不改提示词、不改 UI、不增加 AI 成本，只把「磁盘真相」统一到 V2。

## 5. 验收标准

P1（已满足）：

1. `addGlobal/addProject/addTemplate` 之后，磁盘上该条目 `version === 'v2'` 且 12 维齐全；
2. 任意保存动作（enable/disable/改名/tags）不会减少维度数、不会丢 `v1Backup` 与 `samples`；
3. 重新提取 V1 七维后，磁盘仍是 V2，且对应 7 维 description 更新、其余 5 维不变；
4. 旧 V1 文件加载 → `.v1.bak` 备份 → 迁移为 V2，幂等。

P2（写路径统一，已满足）：

5. 六个新建入口（`ui/settings/fingerprint-section.ts` ×3、`ui/views/writing-fingerprint-view.ts` ×2、`ui/novel-analysis-modal.ts`）都经 `extractWithAnalysis` 拿到 analysis，再 `add*(fp, analysis)`；不再有「只写 7 维就落盘」的新数据；
6. 新建指纹在详情页立刻能看到 V2 12 维（`fingerprint-analysis-merge.test.ts` 断言 12 维全 complete）；
7. 加载期自动回填：`migrateV1ToV2Dimensions` 每作用域末尾跑一次 `backfillV2Dimensions`，有 `sourceText` 用原文、只有样章用样章拼接，补完写 `.v2backfill.bak`（只在待补条目上执行，幂等）。

P3（提示词增量，已落地）：

8. V2 5 维在全局层 7 段之后追加「V2 深化特征（量化）：」，默认开启、受强度配置约束；`dynamic-injection-engine.test.ts` 契约用例覆盖「有/无 map」与「强度 0 全关」。

## 6. 分阶段工作项

| 阶段 | 工作 | 前置 | 风险 |
| --- | --- | --- | --- |
| P1 ✅ | `toPersistedFingerprint` 只写 V2 + 测试（`fingerprint-v2-canonical-write.test.ts`） | 无 | 低（不改提示词/UI） |
| P2 ✅ | 统一新建入口：`extractWithAnalysis` → `add*(fp, analysis)`，一次抽取合并 AI 文案与本地 12 维 | P1 | 中：抽取弹窗多花一次本地分析（实测 <100ms，无感知） |
| P2 ✅ | 加载期回填：`backfillV2Dimensions` 每作用域一次，原文优先、样章兜底、`.v2backfill.bak` 备份 | P1 | 中：首次加载多一次读+分析（只在有待补条目时） |
| P3 ✅ | V2 5 维进入全局层注入（默认开启，受强度配置约束） | P2 ✅ | 中：改变注入内容会改变生成风格，需按模块文档复核 |
| P4 ✅ | 内存模型直接持 V2（去掉「加载即降级」），V1 只在拼提示词时投影 | P2 ✅ | 高：改动面覆盖所有 `list*/get*` 消费方 |

## 7. 回滚

- P1 是纯写盘形态变更：回滚只需恢复 `toPersistedFingerprint` 旧实现；已写出的 V2 文件可被旧代码读取（`migrateFingerprintV1toV2` 兼容），无数据丢失。
- P2/P3 每阶段独立开关；P3 的注入开关默认关闭即可退回当前行为。
- P4 只改内存表达，不改磁盘格式：回滚即恢复 `load*` 里「`migrateFingerprintV1toV2` → 直接塞表」的旧写法；磁盘上的 V2 条目旧代码本来就能读。

## 8. 明确不做

- 不删除 V1 类型与 `v1Backup`（提示词投影与历史审计都需要）。
- 不改动提示词注入顺序（7 段仍在前，V2 5 维固定追加在末尾）与强度语义；融合/预算算法不动。
- 不要求用户重新蒸馏已有指纹（有原文才自动补，没有则保留 pending）。

## 9. 遗留问题（已由用户裁定）

用户 2026-11-21：「p2 和 p3 那就按最好的效果搞，暂时不考虑成本」。据此三条全部取「效果最好」：

1. **加载期回填：接受**首次加载多花时间。实现上限为「每作用域每进程一次」，且只对存在待补维度的条目读文件、跑分析；无待补条目时零开销。
2. **V2 5 维注入：进提示词，默认开启**（不是隐藏开关）。理由：既然按效果最好做，增量信息应当直接生效；仍保留强度配置这条总闸（`globalIntensity: 0` 时 V2 段随之消失），便于出问题时一键退回。
3. **抽取顺序：一次抽取内合并**，不额外增加 AI 调用——AI 仍只写 7 维 prose，5 个新维的文案由本地分析器产出；7 维 description 以 AI 文案为准。等价于「先本地 12 维、再让 AI 润色」，但成本不增。

## 10. 落地记录（P2 + P3，2026-11-22）

| 项 | 位置 |
| --- | --- |
| 抽取 + 分析一次返回 | `engine/fingerprint-extractor.ts`：`extractWithAnalysis(text, options): Promise<FingerprintExtractionResult>`；`extract()` 退化为只取 `fingerprint`；`analyzeV2()` 失败时 `// silent-ok` 回退为「先写投影、之后回填」 |
| 合并 12 维 | `engine/style-fingerprint-library.ts`：`mergeAnalysisIntoFeatures`（7 维用 AI 文案、5 新维用本地）、`registerAnalysis`、`applyAnalysisToV2` |
| 新建入口 | `addTemplate/addGlobal/addProject(fp, analysis?)` 首行 `registerAnalysis` |
| 加载期回填 | `backfillV2Dimensions(scope)`，由 `migrateV1ToV2Dimensions` 每作用域末尾调用；`backfilledScopes` 保证每进程一次 |
| 重抽补齐 | `refillFingerprint` 里 `StyleFeaturesAnalyzerV2.analyze(sourceText)` → `registerAnalysis` |
| 提示词增量 | `engine/style/dynamic-injection-engine.ts`：`summarizeV2Dimension` + `v2Pct`；`build(..., v2Features?)` 第 7 参 |
| 读取接口 | `getV2FeaturesMap(ids)`；`engine/prompt-builder.ts:339` 用 `typeof ... === 'function'` 守卫后传入（兼容旧测试桩） |
| 测试 | `tests/unit/engine/style/fingerprint-analysis-merge.test.ts`（6 例：P2a 落盘 12 维 / P2b 回填 + 备份 / P3 注入段与强度联动）；`fingerprint-v2-canonical-write.test.ts`（3 例 P1） |
| 实机 | 开发 vault 写指纹库首次加载：`fp_demo_partial` / `fp_demo_legacy` 由 5 维 pending → 全 complete，生成 `global-fingerprints.json.v2backfill.bak`（18,687 字节） |
## 11. 落地记录（P4 内存直接持 V2，2026-11-22）

目标：去掉「加载即降级」——加载不再把磁盘 V2 压成 V1 表当唯一真相，V1 只是 V2 的投影。

| 项 | 实现 |
| --- | --- |
| 投影入口 | `engine/style-fingerprint-library.ts`：`projectV2ToV1(v2)`（7 维文案来自 `extractV1FeaturesFromV2`）+ `refreshScopeProjection(scope)`（三张 V1 表**唯一**写入口） |
| 合并入口 | `ensureV2FromEntry(fp, scope)`：有同作用域缓存走 `syncV1DescriptionsIntoV2`，否则 `migrateV1ToV2`；元数据（name/source/enabled/tags/stats/samples/extractedAt/sourceText）以调用方为准 |
| 加载 | `loadTemplate/loadGlobal/loadProject`：`collectV2Fingerprints` → 非 v2 条目现场迁移进 `v2Fingerprints` → `refreshScopeProjection`；不再直接 `new Map(migrated…)` |
| 写 | `add*/update*`：`ensureV2FromEntry` + `refreshScopeProjection`（enable/disable 复用 update*）；保存仍走 `toPersistedFingerprint`，从投影同步 7 维文案后写 V2 |
| 复制/同步 | `copyFingerprint` 先把 `v2Copy` 登记进缓存再走 `add*`（否则 save 会现场迁移出 5 维 pending）；`syncFromTemplate` 更新分支改 `ensureV2FromEntry` + refresh |
| 验收 | `tests/unit/engine/style/fingerprint-v2-inmemory.test.ts` 5 例：加载后投影与 V2 一致 / update 改名+改文案不丢新维 / 启停不动维度 / copy 到项目层仍完整 / syncFromTemplate 只换 7 维文案 |

结果：内存中 V2 是唯一真相，三张 V1 表由 V2 派生；不再存在「V1 表被改写、V2 没跟上」或「重载把 12 维丢弃」的分叉。磁盘格式与提示词注入顺序均未变。

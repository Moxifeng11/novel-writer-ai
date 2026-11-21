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

- 新增指纹一律经 `StyleFeaturesAnalyzerV2.analyze(text)` → `addV2Fingerprint(...)`，磁盘直接写 `version: 'v2'`。
- AI 抽取（`FingerprintExtractor`）继续保留（它提供 prose 描述与 samples），但**它的产物必须立即提升为 V2**：用抽取时收集的样本/原文跑一次本地分析器，补齐 12 维，再入库。抽取器不再直接 `addTemplate/addGlobal/addProject`。
- V1 的 `addTemplate/addGlobal/addProject` 保留为**迁移/导入兼容接口**，但内部必须先 `migrateV1ToV2` 再落盘（本 ADR 已落地，见 §4）。
- 编辑只允许编辑 V2（`updateV2FingerprintFeatures`），V1 文案由投影自动重算。

### R2 落盘：磁盘上不存在 V1 条目

- `toPersistedFingerprint` 必须返回 V2：有 V2 缓存则同步 7 维 description；无缓存则 `migrateV1ToV2` 现场生成。**禁止回写 V1**（避免「保存一次降级一次」）。
- 加载仍是 V1 视图（`migrateFingerprintV1toV2`），但它是投影读取，不产生新的写路径。
- 旧文件迁移保持幂等 + `.v1.bak` 备份，失败回滚（现有 `migrateFileV1ToV2` 行为不变）。

### R3 提示词：投影优先，V2 增量可选

- 现有 7 段注入（`buildGlobalTier`）继续读 V1 投影，投影只来自 `extractV1FeaturesFromV2`（`:2619`），不读磁盘上的 V1 字段。
- V2 独有的 5 维（`sentencePattern / emotion / tension / infoDensity / description`）**暂不进提示词**，作为独立开关的后续能力（见 §6 P3）。理由：改变注入内容会直接改变生成风格，需要单独验收，不属于「模型规范化」本身。

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

P2（写路径统一，待做）：

5. `ui/settings/fingerprint-section.ts`、`ui/fingerprint-library-modal.ts`、`ui/refill-modal.ts`、`ui/novel-analysis-modal.ts` 不再直接调用 `addTemplate/addGlobal/addProject(fp)`，而是「抽取 → 本地 12 维分析 → addV2Fingerprint」；
6. 新建指纹在详情页能立刻看到 V2 12 维（不再出现「5 维 pending 且无原文」的新数据）；
7. 提示词注入内容与改造前逐字一致（回归用快照断言 `buildGlobalTier` 输出）。

P3（提示词增量，可选）：

8. V2 5 维可按强度注入提示词，开关默认关闭；开启后 A/B 验收生成风格差异。

## 6. 分阶段工作项

| 阶段 | 工作 | 前置 | 风险 |
| --- | --- | --- | --- |
| P1 ✅ | `toPersistedFingerprint` 只写 V2 + 测试 | 无 | 低（不改提示词/UI） |
| P2 | 统一新建入口：抽取后跑 `StyleFeaturesAnalyzerV2`，无原文时用 `samples` 拼接并标 `sampleProxy` | P1 | 中：抽取弹窗需多等一次本地分析（可显示进度） |
| P2 | 加载期回填：`migrateV1ToV2Dimensions` 对带 `sourceText` 的条目跑分析器补 12 维 | P1 | 中：首次加载耗时（需限流/后台） |
| P3 | V2 5 维注入开关（`style-intensity-engine` 扩展） | P2 | 高：直接影响生成风格，需产品确认与 A/B |
| 后续 | 内存模型直接持 V2（去掉「加载即降级」），V1 只在拼提示词时投影 | P2 | 高：改动面覆盖所有 `list*/get*` 消费方 |

## 7. 回滚

- P1 是纯写盘形态变更：回滚只需恢复 `toPersistedFingerprint` 旧实现；已写出的 V2 文件可被旧代码读取（`migrateFingerprintV1toV2` 兼容），无数据丢失。
- P2/P3 每阶段独立开关；P3 的注入开关默认关闭即可退回当前行为。

## 8. 明确不做

- 不删除 V1 类型与 `v1Backup`（提示词投影与历史审计都需要）。
- 不在本决策内改动提示词注入顺序、强度语义、融合算法。
- 不要求用户重新蒸馏已有指纹（有原文才自动补，没有则保留 pending）。

## 9. 遗留问题（需要用户确认）

1. P2 的加载期回填是否接受「首次加载多花几百毫秒」？还是只在打开详情页时按需补？
2. P3 的 V2 5 维注入是否要进入路线图（会改变生成风格，需要单独验收批次）？
3. AI 抽取若不再产出 V1 文案（改为先本地 12 维再让 AI 润色 description），抽取提示词与成本都会变——是否接受？

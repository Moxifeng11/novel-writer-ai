# 注入侧原子化审计（2026-11-15）

> 问题：多数上下文以「整份 md / 整张表」注入 → 每次调用塞满 → 截断 → 重试 → 浪费 token。
> 本文只列**事实与可拆分对象**，并给出场景级注入的接入点；与
> `docs/design/2026-11-15-optimization-plan-v2.md`（B 索引 → A 卡片化）配套，
> 本文件对应其后的 **C 阶段：注入原子化 + 场景级检索**。

## 一、现状：每次调用注入多少整文件

### 1.1 单章 11 步（`engine/step-definitions.ts:148-165`）

关键事实：**每一步都重跑 `buildTemplateVars()`**（`engine/step-runner.ts:2014/2049`），
即 11 步各自把同一批全集重读、重压缩、重新拼进 prompt。

| 步 | 名称 | 注入体量 | 备注 |
|---|---|---|---|
| 0 | 上下文加载 | **极大** | `context-manager.ts:695-719` 读 17 项（前章摘要/剧情记忆/大纲/情绪规划/Scene/人物/势力/地点/物品/设定库/文笔/伏笔/时间线/规则/世界观/事实库/跨卷快照） |
| 1 | 信息规划 | 大 | 13 段：+世界观全文、设定库全文、文笔全文 |
| 2 | 情节蒸馏 | 大 | 与步 1 高度重复 |
| 3 | 角色灵魂 | 小 | 不调 AI，复制人物卡灵魂层 |
| 4 | 大纲摘要 | 大 | +全量设定/世界观/人物/时间线 + 知识注入 |
| 5 | 情绪规划 | 中 | +allChars 全量 |
| 6 | Scene 展开 | 中 | +世界观/设定库/全部人物 |
| 7 | 正文生成 | **极大** | ≈25 段：全量人物/势力/地点/物品 + 设定库 + 全部场景卡 + 情节蒸馏/信息规划/大纲 + 指纹样章 + storyContextPack + 关联查询 |
| 8 | 质量控制 | 大 | 同一批再注入 + 整章正文 |
| 9 | 分析报告 | 大 | 同一批再注入 + 整章正文 |
| 10 | 章节结算 | 大 | 整份分析报告 + 整章正文 + 全量实体扫描 |

### 1.2 单次调用最大注入（代码上限，非实测）

约 **10 份整文件 + N 张实体卡**：
写作规则、世界观、设定库、文笔风格、承诺账本、角色弧线、伏笔库、时间线看板、
上章正文 + 4 份上章步骤结果 + 3 章剧情记忆，再加 `storyContextPack`(4200/24000 token)、关联查询、关联索引(1800)。

### 1.3 向导/创作流程

| 环节 | 整文件注入 |
|---|---|
| 设定库生成 | 世界观(8000) + 旧设定库(2000) |
| 大纲生成 | 世界观 + 伏笔库 + 时间线看板 + N 张实体卡(400 字/张) |
| 实体生成 | **设定库全文不切** + 世界观 + 同人设定 |

### 1.4 协同写作

- 初始化 `gatherAll` 读 ≈18 份；每个建议/改写请求注入 10+ 切片段（每段 2–3k 字）+ pack
- **句子级高频调用 → 同一批切片逐句重复发送**
- 已有缓解：切场景才重建 pack（`co-writer-engine.ts:2350-2398`）、分段优先级表（`prompt-builder.ts:920-1003`）

## 二、已有预算/压缩机制（不要重造）

| 机制 | 位置 | 粒度 |
|---|---|---|
| 上下文压缩 | `engine/context-compressor.ts:276-341` | 段落级 + 硬截断（世界观 0.12×ctx、设定库 0.06×ctx） |
| Prompt 预算 | `shared/prompt-budget.ts` | token 级分段裁剪 |
| 步骤预算 | `engine/step-prompt-assembly.ts:151-289` | 按模型窗口，超限抛 `ContextOverflowError` |
| 配额策略 | `shared/context-budget-policy.ts:67-82` | 11 类配额随预算缩放 |
| StoryContext bundle | `engine/context/story-context-graph.ts:53-73,1336` | **scene 节点 + links 加权 + requiredIds + token 预算 + 去重 + telemetry** |
| 关联检索 | `engine/context/association-resolver.ts:158-284` | 场景文本 + 在场实体 + 预算 + 与已注入段去重 |
| 场景卡简报 | `engine/chapter-brief.ts:258-299` | 当前场景全字段 + 其余一行 |
| 场景正文生成范式 | `engine/scene-body-generator.ts:89-195` | 任务卡 8 要素 + 上一场结尾 800 字 + 分层注入 |
| RAG | `engine/rag/retrieval-service.ts:72` | chunk 级 topN4 |

**结论**：预算闸门是 token 级，但**大多数注入点仍是字符级 slice 或完全无上限**
（文笔风格、实体生成时的设定库、人物卡集合、分卷大纲合并）。

## 三、可原子化对象清单（按改造性价比排序）

| # | 对象 | 现状 | 原子化粒度 | 依据 |
|---|---|---|---|---|
| 1 | 设定库.md | 整篇注入（部分 cap） | **条款级**（`##` 节） | graph 已切成 `setting:N` 节点 |
| 2 | 世界观总览.md | 整篇（cap 12k/2000） | **小节级** | `ai-character-generator.ts:37-88` 已有「AI 选节→正则提取」范式 |
| 3 | 伏笔库.md | 整表读（`write-chapter-modal:298/518`） | **行级** | ledger 已解析，有 `dueForeshadows` |
| 4 | 时间线看板.md | 整表读 | **行级**（已 `TIMELINE_SLICE=30`，但多处仍整表） | ledger 已解析 |
| 5 | 上一章 4 份步骤结果 | 整文件 | **片段级**（只用到 1 句建议/1 句断裂/❌行/温度） | `readStepFileContent` 全文读 |
| 6 | 承诺账本 / 角色弧线 / 对照库 / 同人设定 | 整读后 parse 取少数行 | **行/节级** | `template-vars-builder.ts:813-822` |
| 7 | 分卷大纲 | 每次合并读全卷再切章 | **章级缓存** | `helpers.readMergedVolumeOutline` |
| 8 | 人物卡集合 | frontmatter 14 字段 + 名额制（已较好）；但 `gatherCharacterCores` 仍整文件读 | **字段级** | `context-manager.ts:1138` |
| 9 | 剧情记忆 / 事实库 | 3 章 digest / factNodes | **场景级裁剪** | 已有结构 |
| 10 | 向导「大纲生成」读全目录实体 | 每实体 400 字摘要、N 实体 | **按卷/阶段需要的实体** | `plan-book-modal.ts:450` |

## 四、场景级注入设计（C 阶段核心）

### 4.1 检索锚：场景（Scene）

已有事实：**Scene 展开**（`第N章_Scene展开.md`）是唯一场景存储，按 `## 场景N：` 切块；
`chapter-brief.ts` 已能解析成 `BriefScene`（22 字段：目标/冲突/感官/记忆/身体/潜台词/关系/名场面/对话功能/钩子/情绪起止/预估字数）。

**检索锚 = 当前场景卡 + 在场实体 ID + 本章章段**，而不是整章/整库。

### 4.2 注入包（SceneContextPack）

| 槽位 | 来源 | 精度 |
|---|---|---|
| 当前场景全字段 | Scene 展开当前块 | 场景 ID |
| 上一场结尾（800–2000 字） | 正文前文 | 位置 |
| 在场人物（2–4 人）完整卡 | 场景卡 `在场` ID 列表 | **ID 精确** |
| 相关伏笔（`planted/progressing` 且涉及在场 ID） | 伏笔条目 | ID+状态 |
| 时间线窗口（≤本章，涉及在场 ID） | 事件条目 | ID+时间 |
| 命中设定条款 | 场景关键词 → 设定条目 tag/ID | tag/ID |
| 世界观小节 | 场景关键词 → 世界观条目 | tag |
| 本章章段（分卷大纲对应段） | 章级缓存 | 章 |

其余场景卡只留一行摘要（协同写作已有同款做法）。

### 4.3 接入点（按性价比）

1. **`ui/full-writer/template-vars-builder.ts:662-681`**：`buildStoryContext()` 未传 `scene`；
   从 `stepResults.sceneExpand` 取当前场景卡传入（接口已支持，`story-context-service.ts:124-153`）
2. **`template-vars-builder.ts:1044-1058`**：`formatSceneCardDigest(cards)` 注入全部场景卡
   → 改「当前场景全字段 + 其余一行」（协同已有 `chapter-brief.ts:289-296`）
3. **`template-vars-builder.ts:374-420`**：`worldView/settingLib/allChars/unrevealedForeshadow/timelineEvents`
   五个取值点改为消费 bundle（`applyStoryContextToVars` 已存在，但 `NO_SHRINK` 白名单刻意保留整篇，`:173`）
4. **`engine/step-runner.ts:335-362`**：`loadAssociationContext` 的 query 拼了整段 sceneExpand+outline
   → 按当前场景过滤后再检索；并把它从「可丢尾部」提升为主注入源
5. **`engine/step-prompt-assembly.ts:182-201`**：body/quality/analysis 统一尾部入口，加 `sceneContext` 作为第三条 tail
6. **`engine/prompt-builder.ts:920-1003`**（协同）：新增 `sceneContext` 段（priority≈90），替换/前置 `storyContextPack`
7. **`engine/co-writer-engine.ts:2350-2398`**：已有「切场景才重建包」触发点，把 `precedingText` 纳入检索范围
8. **`engine/scene-body-generator.ts:89-133` / `scene-generation-loop.ts:182-254`**：
   现成的场景级注入范式，11 步正文可直接复用 `injectForSceneBodyLayers`
9. **`ui/plan-book-modal.ts:450`**：全目录读取改按卷/阶段需要的实体
10. **`ui/co-writing-view.ts:741-755`**：切章时整读 5 个规划文件 → 按场景截取

### 4.4 与协同写作的联动

- 协同已有 `BriefScene` + 场景卡 + `storyContextPack` 按场景重建 → **把它提升为公共能力**
- 11 步正文生成改为「按场景逐场生成 + 合并」（`scene-body-generator` 已实现合并写正文）
- 协同写作注入改为消费同一份 `SceneContextPack`，消除两套注入逻辑
- 收益：句子级调用不再重复发送全量切片；每场只取本场要素

## 五、实施顺序（C 阶段）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| C1 | `SceneContextPack` 数据结构 + 从 Scene 展开/索引构建（纯函数 + 单测） | 给定场景卡，产出精确要素包 |
| C2 | 正文步接入：`template-vars-builder` 传 scene、场景卡摘要改「当前全 + 其余一行」 | 注入体量下降、正文质量不降 |
| C3 | 质控/分析步接入（去掉整章正文以外的全量重复注入） | token 用量对比 |
| C4 | 协同写作改用同一 pack | 句子级请求注入显著变小 |
| C5 | 向导/大纲/实体生成按需取条目（设定库条款、世界观小节） | 向导调用 token 下降 |
| C6 | 上章 4 份步骤结果、承诺账本、角色弧线、对照库改片段/行级 | 逐项验证 |

> 前置依赖：C1 的精确检索需要 B 阶段的**统一索引（ID/别名/标签）**，
> 因此实施顺序仍为 **B → A（与 C1 并行准备）→ C**。

## 六、未验证项

- 仓库内无真实项目数据，体量为代码 cap 与空模板基线，非实测 token
- 11 步实际调用次数取决于「合并规划」开关与跳过状态
- 协同 `refreshStoryContextPack` 触发频率未实测
- 短篇/剧本模式（`mode-unit-*`）步骤链未展开

# Changelog

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

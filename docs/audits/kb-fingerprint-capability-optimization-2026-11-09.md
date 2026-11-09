# 知识库 / 写作指纹库能力边界与链路优化（2026-11-09）

## 1. 背景

用户反馈两类问题：

1. 知识库/指纹库“有内容”与“实际生效”之间缺少可见说明：拆解完成不等于检索可用，指纹存在也不等于精准模式评分生效。
2. 两个模块的数据链路长、参考资料多，存在重复计算与 UI 拥挤；弹窗在小屏/长内容下缺少统一边界约束。

本轮以“可解释的能力边界 + 低风险链路优化 + 弹窗边界收口”为目标，不改变现有数据结构与用户配置。

## 2. 信息传递链路

### 2.1 知识库

```
书籍原文 / 拆解任务
  → KnowledgeBaseManager（书籍目录、basic-info、拆解状态）
  → DeconstructionScheduler（拆解各维度结果）
  → KnowledgeVectorStore（按书保存向量样本，维度 style/rhythm/technique/...）
  → KnowledgeVectorStore.search()（query embedding + 全样本余弦 + 关键词重排）
  → ContextManager / PromptBuilder / knowledge-injector
  → 协同/工作台 prompt
```

关键事实：

- `breakdownStatus === 'completed'` 只代表拆解完成；`vectorStatus === 'done'` 才代表该书向量可检索。
- 普通模式与精准模式都会做知识注入；精准模式的**风格评分**额外依赖知识库 `style` 维度向量。
- 没有 style 向量时，`StyleSimilarityScorer` 无参考结果会直接放行（`passed: true, score: 1.0`），不会报错。

### 2.2 写作指纹库

```
章节/文本样本
  → FingerprintExtractor / StyleFeaturesAnalyzerV2（V1 7 维 / V2 12 维）
  → StyleFingerprintLibrary（template/global/project 三层 + 启用状态）
  → LocalVectorStore / StyleVectorStoreV2（样本/逐维向量）
  → PromptBuilder.getFingerprintPromptParts（普通/精准都注入）
  → StyleSimilarityScorer（精准模式生成后评分/重试，参考来自知识库向量库）
  → 指纹视图 / 融合 / 强度 / 详情 UI
```

关键事实：

- 指纹是否注入取决于“是否启用”，不是“是否存在”。
- 样本为 0 时，只有特征描述可注入，few-shot/向量参考不足。
- 精准模式的相似度评分参考是**知识库 style 向量**，不是指纹库自身向量；这一边界已写进 UI 说明条。

## 3. 本轮改动

### 3.1 能力边界 UI

新增：

- `ui/views/capability-banner.ts`：统一阶段徽标、指标、说明条。
- `ui/views/knowledge-capability.ts`：空库 / 积累中 / 降级 / 已生效四阶段。
- `ui/views/fingerprint-capability.ts`：指纹数、启用数、样本数、V2 数、向量/embedding 就绪度。

接入：

- 知识库「参考书籍」页顶部：书籍数、已拆解、向量就绪、待处理/失败，并说明“拆解完成 ≠ 语义检索可用”。
- 写作指纹库左侧栏顶部：指纹/启用/样本/V2 指标，并说明“指纹注入与精准评分参考来源不同”。

### 3.2 知识库布局

- `styles-src/26-cleanup-utilities.css`：≤900px 时知识库书籍页改为纵向，题材栏收为顶部 170px 横条，避免 220px 题材栏把书籍列表压窄。

### 3.3 检索性能

- `engine/local-vector-store.ts::cosineSimilarity`：向量范数按数组对象用 `WeakMap` 缓存，检索循环只计算点积。
  - 知识库与指纹库的相似度检索共用该函数，重复查询同一批参考向量时不再重复平方和。
  - 向量数组在生命周期内不被原地修改，缓存安全；重建/重载会产生新数组，自动失效。

### 3.4 弹窗边界

- `styles-src/22-modal-layout.css`：`.modal-content { min-height: 0 }`，修复 flex 子项默认 `min-height:auto` 导致内容区不收缩、底部按钮被推出视口。
- `styles-src/08-workbench-v7-v8.css`：
  - `nw-modal-lg/xl` 宽度改为 `min(..., 96vw)`，避免小屏仍使用 900px 下限。
  - 补 `max-height: min(90vh, 90dvh)`、`display:flex; flex-direction:column; overflow:hidden`，长内容在内容区滚动而不是撑出屏幕。
- E2E 新增：统一实体管理弹窗在 1280×720 / 900×600 / 700×500 / 390×844 下必须完整落在视口内。

## 4. 验证

- `npx vitest run tests/unit/ui/knowledge-capability.test.ts tests/unit/ui/fingerprint-capability.test.ts`：10 例通过。
- 真实 Obsidian E2E：
  - 知识库/指纹库能力边界说明条可见；
  - 统一实体管理弹窗极端视口边界断言通过；
  - `review-fixes` 3 条、Electron 全量 28 条通过（新增能力边界用例）。
- `preflight` 与发布相关门禁在提交前统一执行。

## 5. 仍建议的后续项

1. **指纹文件加载缓存**：`loadGlobal/loadProject/loadTemplate` 每次整文件读取 + 迁移，可按 `getFileStamp` 增加 mtime/size 缓存；需同步处理保存后的签名失效。
2. **检索候选剪枝**：当前对全部样本计算语义分 + 关键词分；可先按语义分粗筛，再对 Top-K 计算关键词重排，降低大库延迟。
3. **精准评分参考源**：若希望精准模式直接对齐指纹库，而不是知识库 style 向量，需要扩展 `StyleSimilarityScorer` 的参考源选择；这会改变现有评分口径，建议单独评审。
4. **弹窗全量清单**：本轮收口了共享尺寸类与内容区；若要把每个 Modal 的极端场景都锁死，建议按“弹窗族”逐步补 E2E。

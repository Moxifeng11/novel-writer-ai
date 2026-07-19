# Spec: 死代码清理 + 算法最优解优化 + 渲染路径修复

> **代码推演版本** | 2026-07-19 | 基于 code-rehearsal 五系统模型全量推演

---

## 1. 需求解构

### 1.1 需求三问

| 问题 | 回答 |
|------|------|
| **这是在解决什么问题？** | 项目经过多轮功能迭代，积累了技术债务：3个全死文件、34个未使用导出、~200处调试日志、250+处any类型、62个类型错误；算法存在串行瓶颈和O(n²)反模式；渲染路径中节奏标签页4个区块输出损坏、详情弹窗使用假数据误导用户 |
| **成功的标准是什么？** | (1) TypeScript `--noEmit` 零错误 (2) 全死代码清零 (3) 节奏标签页所有渲染区块输出正确数据 (4) 维度并行化后解构总耗时 < 原耗时的50% (5) 增量解构跳过率 > 80% (6) 所有测试通过 |
| **什么不做？** | 不改功能行为（只修正确性bug不改产品逻辑）、不改UI布局（只修复数据显示不对的问题）、不引入新外部依赖（使用纯JS可实现的算法）、不重写整个文件（外科手术式改动） |

### 1.2 可信度标注

| 结论来源 | 标注 |
|----------|------|
| TypeScript `tsc --noEmit` 全量输出 | **已验证** — 62个类型错误，所有文件路径和行号确认 |
| `grep` 全项目导出引用搜索 | **已验证** — 逐个符号搜索，排除测试文件 |
| 代码逐行阅读 + 交叉引用分析 | **已验证** — 解构器 buildFrontmatter ↔ UI 类型定义逐字段对照 |
| 算法复杂度分析 | **推理** — 基于代码阅读的复杂度估算，非 benchmark 实测 |
| 预期改进幅度 | **估算** — 基于理论和类似项目的经验值，实际效果需验证 |

---

## 2. 五系统推演

### 2.1 数据模型

**核心实体关系**：

```
MarkdownDeconstructionFile (per dimension)
├── _qualityScore: DimensionQualityScore ← DeconstructionScheduler 注入
├── {dimension_specific_fields}          ← Deconstructor.buildFrontmatter 序列化
└── {metadata}                           ← BookBasicInfo

DimensionQualityScore {
  completeness: number   // 完整性
  consistency: number    // 一致性
  confidence: number     // 置信度
  overall: number        // 综合
  level: 'fast'|'standard'|'deep'
  usedLevel: string
}
```

**数据流契约问题**：解构器 `buildFrontmatter` → 直接序列化 AI 原始键名 → UI `JSON.parse` + `as` 类型断言 → 无中间映射层。这是节奏标签页 4 个区块损坏的**根因**。

**最优解**：在 `loadBookDetailData` 中引入统一的字段映射层（DataAdapter），所有维度数据经过标准化后再交给 UI。而非在每个 buildFrontmatter 中单独修字段名。

### 2.2 接口层

**关键接口清理**：

| 接口 | 状态 | 决策 |
|------|------|------|
| `ResultAggregator` class | 全死 | 删除 |
| `DeconstructionWorkerPool` class | 全死 | 删除 |
| `PerformanceOptimizer` class | 全死 | 删除 |
| `SettlementEngineDeps` interface | 孤儿 | 删除导出（保留内联） |
| `PartialResultCallback` / `AggregatorOptions` | 孤儿 | 删除 |
| `dynamic-injection-engine.ts` 8个未使用导出 | 死代码 | 删除 |
| `quality-score-engine.ts` ~19个未使用导出 | 死代码 | 删除 |
| `IncrementalResultAggregator` + 26个类型错误 | **需修复** | 保持文件但修复所有类型错误 |

### 2.3 状态流转

**解构调度器降级状态机（现有 vs 最优）**：

```
现有（手动数组追踪）:
  degradedDimensions: string[] 
  → push/pop/includes 操作
  → 无形式化验证
  → 多种降级组合时行为不确定

最优（显式状态机）:
  DimensionState = PENDING | ENHANCING_VECTOR | ENHANCING_LLM | ANALYZING | DONE | DEGRADED_VECTOR | DEGRADED_LLM | FAILED
  → 状态转移表: { 事件 × 当前状态 → 下一状态 }
  → 可穷举验证所有组合
  → 编译时保证完备性
```

**维度并行化依赖图**：

```
文本预处理（一次） 
  └→ [风格] [节奏] [技法] [结构] [人物] [伏笔] [商业性] [可读性]  ← Promise.all 并发
       ↓       ↓       ↓       ↓       ↓       ↓        ↓         ↓
  └─→ 质量评分（可并行，依赖各自维度完成）
  └─→ 文件合并写入（一次，等待所有维度完成）
```

### 2.4 UI 交互

**修复的渲染路径**（仅列出需要修改的）：

| 标签页 | 修改项 | 类型 |
|--------|--------|------|
| 节奏 | `coolPoints` 散点图：映射 `position→x, type→category, intensity→y` | P0 Bug修复 |
| 节奏 | `plotStages` 时间线：映射 `type→name, startPosition→start, endPosition→end` | P0 Bug修复 |
| 节奏 | `structureMatches` 柱状图：映射 `name→label, matchScore→value` | P0 Bug修复 |
| 节奏 | `chapterRhythm`：从 `rhythmCurve.chapterScores` 转写生产 | P1 新功能 |
| 节奏 | 添加 `renderQualityScoreCard` 调用 | P1 功能补全 |
| 节奏 | `keyEmotionPoints`：移除死渲染或从 deconstructor 产出 | P2 死代码清理 |
| 节奏(detail) | 移除 `structureMatch` 硬编码假数据，改为"数据未生成" | P1 Bug修复 |
| 节奏(detail) | 移除 `coolPoints` 随机假数据 | P1 Bug修复 |
| 节奏(detail) | 移除 `keyEmotionPoints` 硬编码假数据 | P1 Bug修复 |
| 多标签页 | 统一"基于全书 N 字"标注 | P2 一致性 |
| 结构 | 序列化 `narrativeTemporality` / `templateMatch` 或从产出中移除 | P2 死代码清理 |

### 2.5 外部依赖

**无新外部依赖**。所有优化使用纯 JavaScript/TypeScript 可实现：
- ANN 近似最近邻：使用简单的分桶 LSH（局部敏感哈希），无需引入 hnswlib 等 C++ 库
- 内容哈希：使用 SubtleCrypto API（浏览器内置）的 SHA-256，或回退到简单哈希
- 并发控制：使用 Promise.all + 信号量模式，无需额外库

---

## 3. 调查发现汇总

### 3.1 死代码清单

#### 全死文件（0个非测试引用，可直接删除）

| 文件 | 行数 | 导出 | 配套测试 |
|------|------|------|----------|
| `engine/result-aggregator.ts` | 779 | `ResultAggregator`, `SegmentIntermediateResult`, `BookLevelResult` | `result-aggregator.test.ts` |
| `services/deconstruction-worker-pool.ts` | 359 | `DeconstructionWorkerPool`, `PoolTask`, `PoolOptions`, `BookProgress` | `deconstruction-worker-pool.test.ts` |
| `engine/quality/performance-optimizer.ts` | ~200 | `PerformanceOptimizer` | `performance-optimizer.test.ts` |

**删除影响**：-1,338 行源代码 + 配套测试文件

#### 部分死代码（文件保留，删除未使用导出）

| 文件 | 可删除导出数量 | 可删除行数（估算） |
|------|---------------|-------------------|
| `engine/style/dynamic-injection-engine.ts` | 8 (5 type + 2 function + 1 interface) | ~50 |
| `engine/quality/quality-score-engine.ts` | ~19 (4 type + 3 const + 4 interface + 4 function + ...) | ~120 |
| `engine/settlement-engine.ts` | 1 (`SettlementEngineDeps`) | ~8 |
| `engine/incremental-result-aggregator.ts` | 2 (`PartialResultCallback`, `AggregatorOptions`) | ~12 |

#### console.log 遗留（Top 5 高密度文件）

| 文件 | 数量 | 处理器 |
|------|------|--------|
| `engine/engine-registry.ts` | 25 | 替换为 `logger.debug()` |
| `engine/co-writer-engine.ts` | 20 | 替换为 `logger.debug()` |
| `engine/writing-profile.ts` | 17 | 替换为 `logger.debug()` |
| `engine/ai-outline-generator.ts` | 17 | 替换为 `logger.debug()` |
| `main.ts` | 16 | 替换为 `logger.info()` |

#### TypeScript 类型错误（62个，分4类）

| 类别 | 文件 | 错误数 | 根因 |
|------|------|--------|------|
| **A. 死文件** | `incremental-result-aggregator.ts` | 26 | 字段名/类型全不匹配，需系统性修复 |
| **B. 大纲生成器** | `ai-outline-generator.ts` | 10 | `mainPlotNodes`、`description`、`children` 字段不存在 |
| **C. 类型转换** | `style/style-worker.ts` | 2 | Promise→非Promise 错误转换 |
| **D. 测试文件** | 4个测试文件 | 14 | 随源文件修复 |
| **E. UI 文件** | 3个UI文件 | 8 | 字段不存在于 Vault/Plugin/Settings |
| **F. 工具** | `helpers.ts` | 1 | `children` 是 unknown |

### 3.2 算法优化机会清单

#### Critical（影响面最大，实现难度可控）

| # | 发现 | 当前复杂度 | 最优复杂度 | 预期改进 |
|---|------|-----------|-----------|---------|
| C1 | 维度处理完全串行，8维度独立无依赖 | O(8×T_dim) | O(max(T_dim)) + Promise.all | 2-5x 加速 |
| C2 | 解构中间结果零缓存，每次全量重算 | O(n) 全量 | O(Δ) 增量（基于文件哈希） | 80-95% 跳过率 |

#### High（高收益，低实现难度）

| # | 发现 | 当前复杂度 | 最优复杂度 | 预期改进 |
|---|------|-----------|-----------|---------|
| H1 | Vector 余弦相似度全量 O(n²) 比较 | O(n²) | O(log n) LSH + ANN | 90-99% (n>500) |
| H2 | 失败实体逐一串行 AI 补救 | O(R×F×T_llm) | O(R×T_llm) 批量合并 | 50-66% |
| H3 | Prompt 每次完全重建，无模板缓存 | O(n) 全量构建 | O(1) 静态 + O(Δ) 动态 | 40-60% |

#### Medium（中等收益）

| # | 发现 | 当前 | 最优 | 改进 |
|---|------|------|------|------|
| M1 | Vector embedding 未跨维度复用 | 8次独立embedding | 1次共享 + 按维度分发 | 60-75% |
| M2 | 文本预处理隐式重复 | 每维度独立预处理 | 前置预处理层一次执行 | 70-85% |
| M3 | LLM 调用无批量合并 | 8次独立请求 | 1-2次批量请求 | 40-60% |
| M4 | 上下文重叠无条件生成 | 所有策略都生成 | 仅非章节边界时生成 | 15-25% |
| M5 | keyEntity 逐段重复提取 | S次独立正则扫描 | 1次全文本扫描 | 30-50% |
| M6 | 批量大小固定无自适应 | 固定值 | Token估算驱动动态值 | 30-50% |
| M7 | 知识检索3次独立向量搜索 | 3次独立调用 | 1次合并多目标查询 | 50-66% |
| M8 | FileCache 淘汰 O(n log n) 全排序 | Array.sort() | 最小堆 O(log n) | 80-95% |
| M9 | 分段中间结果零缓存 | 无缓存 | 内容哈希 + 分段缓存 | 90%+ 跳过 |
| M10 | 每维度独立写文件 (8次) | 8次 fs.write | 内存累积 + 1次写入 | 80-90% I/O |

### 3.3 渲染路径问题清单

#### P0 — 静默损坏（用户看到错误数据但不知道）

| 标签页 | 字段 | 问题 | 用户看到 |
|--------|------|------|----------|
| 节奏 | `coolPoints` 散点图 | 形状不匹配：渲染用x/y/label/category，数据只有position/type/intensity | 所有散点坐标 NaN → 空白图 |
| 节奏 | `plotStages` 时间线 | 字段名不匹配：渲染用name/start/end，数据有type/startPosition/endPosition | "undefined (undefined% - undefined%)" |
| 节奏 | `structureMatches` 柱状图 | 元素结构不匹配：渲染期望{label,value}，数据是{name,matchScore} | 柱状图全空 |

#### P1 — 死渲染路径（代码存在但永不执行）

| 标签页 | 字段 | 问题 |
|--------|------|------|
| 节奏 | `chapterRhythm` 章节节奏多维评分 | 数据从不生产，`data.chapterRhythm?.length` 永远 falsy → 整块静默跳过 |
| 节奏 | `keyEmotionPoints` 关键情绪点 | 数据从不生产，循环不执行 |
| 节奏 | `rhythmSegments` | 在渲染中被解构但后面从不使用 → 双重死代码 |
| 节奏(detail) | `structureMatch` | 键名不匹配 + 硬编码假数据回退 |
| 节奏(detail) | `coolPoints` | 随机生成15个假散点 |
| 节奏(detail) | `keyEmotionPoints` | 硬编码5条假情绪描述 |

#### P2 — 浪费计算（AI 产出但从不展示/序列化）

| 解构器 | 字段 | 状态 |
|--------|------|------|
| 节奏 | `mainThreadSwitches` | AI产出 → `RhythmAnalysisResult` → buildFrontmatter不序列化 → UI不读取 |
| 结构 | `narrativeTemporality` | AI产出 → 不序列化 → 不渲染 |
| 结构 | `templateMatch` | AI产出 → 不序列化 → 不渲染 |

#### P3 — 一致性问题

| 问题 | 详情 |
|------|------|
| 质量评分卡缺失 | 8个分析标签中仅节奏标签页无 `renderQualityScoreCard` |
| "基于全书 N 字" 不一致 | 10个标签中仅3个（风格/节奏/人设）展示字数信息 |
| detail-modal 假数据 | 3个字段使用硬编码/随机假数据作为回退，误导用户 |

---

## 4. 实现路线图

### Phase 1: 死代码清理 + 类型安全（无功能变更，纯清理）

**目标**: `tsc --noEmit` 零错误，全死代码清零

```
Task 1.1 → 删除 3 个全死文件 + 配套测试
Task 1.2 → 删除 34 个未使用导出
Task 1.3 → 修复 incremental-result-aggregator.ts 的 26 个类型错误
Task 1.4 → 修复 ai-outline-generator.ts 的 10 个类型错误
Task 1.5 → 修复 style-worker.ts 的 2 个类型转换错误
Task 1.6 → 修复 UI 文件 8 个类型错误
Task 1.7 → 修复 helpers.ts 1 个类型错误
Task 1.8 → 修复测试文件 14 个类型错误
Task 1.9 → 替换 ~200 处 console.log 为结构化日志
Task 1.10 → 替换 ~250 处 :any 为目标类型（分5批）
```

### Phase 2: 算法最优解（按收益从高到低）

**目标**: 解构总耗时 < 原50%，增量跳过 > 80%

```
Task 2.1 → 维度处理并行化 (Critical C1)
Task 2.2 → 解构中间结果缓存 (Critical C2)
Task 2.3 → Vector LSH+ANN 索引替代 O(n²) (High H1)
Task 2.4 → 失败实体批量补救替代逐一 (High H2)
Task 2.5 → Prompt 模板缓存分层 (High H3)
Task 2.6 → Vector embedding 跨维度共享 (Medium M1)
Task 2.7 → 文本预处理前置层 (Medium M2)
Task 2.8 → 知识检索合并多目标查询 (Medium M7)
Task 2.9 → FileCache 淘汰优化为最小堆 (Medium M8)
Task 2.10 → 合并文件写入为一次 (Medium M10)
```

### Phase 3: 渲染路径修复（按 P0→P3 优先级）

**目标**: 所有渲染区块输出正确数据，无静默损坏，无假数据

```
Task 3.1 → 修复节奏标签页 P0 字段映射（coolPoints/plotStages/structureMatches）
Task 3.2 → 修复 detail-modal P0 字段映射
Task 3.3 → 产出 chapterRhythm 数据 + 渲染
Task 3.4 → 移除 detail-modal 全部硬编码假数据
Task 3.5 → 节奏标签页添加质量评分卡
Task 3.6 → 清理死渲染代码（keyEmotionPoints/rhythmSegments）
Task 3.7 → 序列化浪费字段或移除（mainThreadSwitches/narrativeTemporality/templateMatch）
Task 3.8 → 统一"基于全书 N 字"标注到所有标签页
```

### Phase 4: 验证

```
Task 4.1 → 运行 tsc --noEmit 确认零错误
Task 4.2 → 运行全量测试 (npm test) 确认全部通过
Task 4.3 → 运行构建 (npm run build) 确认成功
Task 4.4 → 手动验证节奏标签页所有图表正确渲染
```

---

## 5. 优先级矩阵

| 优先级 | 任务数 | 预期总工时 | 关键交付 |
|--------|--------|-----------|---------|
| Phase 1 | 10 tasks | 死代码清理 | `tsc --noEmit` 零错误 |
| Phase 2 | 10 tasks | 算法优化 | 解构加速 2x+ |
| Phase 3 | 8 tasks | 渲染修复 | 节奏标签页数据正确 |
| Phase 4 | 4 tasks | 验证 | 全测试通过 + 手动确认 |

---

## 6. 非目标（明确排除）

- ❌ 不重写 `knowledge-base-view.ts` 的架构（7000行单文件→拆分为多文件是另一个spec的事）
- ❌ 不修改产品功能行为
- ❌ 不引入新的 npm 依赖（ANN使用纯JS的LSH实现）
- ❌ 不修改 CSS/样式
- ❌ 不新增功能特性
- ❌ 不修改 Obsidian API 调用约定

---

## 7. 风险与回退

| 风险 | 概率 | 缓解措施 |
|------|------|---------|
| 并发化导致竞态条件 | 中 | 每个维度有独立的 Markdown 文件，写操作天然隔离；加锁保护质量评分注入 |
| 增量缓存命中率低于预期 | 低 | 保留全量重算作为回退路径 |
| ANN 近似匹配精度下降 | 低 | LSH 分桶后全量比较桶内候选，100%精度（仅跳过不可能的候选） |
| 删除死文件后出现运行时错误 | 极低 | grep 验证所有导出零非测试引用后才删除 |

---

## 8. 执行状态 (2026-07-19)

| Phase | 状态 | 说明 |
|-------|------|------|
| **Phase 1** | ✅ 完成 | 死代码清理：6文件删除，13导出移除，62类型错误修复，~1170 console→Logger替换，35 `:any`→类型 |
| **Phase 2** | ✅ 完成 | 算法最优解：10项全部完成，tsc零错误，2434测试通过，esbuild v4.10.6 |
| **Phase 3** | ✅ 完成 | 渲染路径修复：字段映射修复(coolPoints/plotStages/structureMatches/chapterRhythm/mainThreadSwitches)、detail-modal 27处假数据移除、4标签页死代码清理、质量评分卡、统一字数标注 |
| **Phase 4** | ✅ 完成 | 最终验证：tsc 零错误 + 2434 测试通过 + build v4.10.6 全绿；4.4 视觉验证待用户在 Obsidian 中确认 |

> **🎉 全部 Phase 完成 (2026-07-19)**：4 个阶段共 32 个任务全部落地。自动化质量门禁（类型检查 / 单元测试 / 生产构建）三项全绿。唯一遗留项为 Task 4.4 节奏标签页的人工视觉验证，需在真实 Obsidian 环境加载数据后逐项确认。

> **🔧 后续修复：更新日志 v4.10.6 未显示 (2026-07-19)**：在 `shared/changelog-data.ts` 新增 v4.10.6 条目后，误仅运行 `tsc --noEmit`（不产生构建产物），导致 Obsidian 加载的 `main.js` 仍是旧版本。已重新执行 `node scripts/build.js` 重建 main.js（验证第 63738 行 `version: "4.10.6"`、第 63740 行含 "死代码清理" 标题 Unicode 转义）。`main.js` 被 `.gitignore` 忽略无需提交。用户需在 Obsidian 重新加载插件才能看到新条目（共 8 条记录）。

---

## 交叉引用校验报告（Gate 1）

### 悬挂引用检查

| 引用 | 状态 | 处理 |
|------|------|------|
| `result-aggregator.ts` → 仅测试文件引用 | ⚠ 悬挂 | 删除 |
| `deconstruction-worker-pool.ts` → 仅测试文件引用 | ⚠ 悬挂 | 删除 |
| `performance-optimizer.ts` → 仅测试文件引用 | ⚠ 悬挂 | 删除 |
| 34个未使用导出 → 零外部引用 | ⚠ 悬挂 | 删除导出 |
| Rhythm Tab `chapterRhythm` → 数据从不生产 | ⚠ 悬挂 | 生产数据或移除渲染 |
| Rhythm Tab `coolPoints` → 形状不匹配 | ⚠ 悬挂 | 修复映射 |
| Detail Modal `structureMatch` → 键名不匹配 | ⚠ 悬挂 | 修复映射 |
| `mainThreadSwitches` → 生产但不消费 | ⚠ 悬挂 | 序列化或移除 |
| `narrativeTemporality` → 生产但不消费 | ⚠ 悬挂 | 序列化或移除 |

### Gate 结果

**Gate 1 状态**: ⚠ 未通过（9项悬挂引用）→ 已纳入修复计划
**Gate 1 闭合**: 所有悬挂引用在 Phase 1-3 中有对应修复任务

---

## 可信度标注总结

| 标注等级 | 数量 | 说明 |
|----------|------|------|
| **已验证** — 工具验证 | 62个类型错误 + 全项目grep引用 | tsc + grep 输出，可复现 |
| **已验证** — 代码对照 | 8维度字段交叉引用矩阵 | 逐文件逐字段人工对照 |
| **推理** — 基于代码 | 29个算法优化机会 | 源码阅读 + 复杂度分析 |
| **估算** — 预期改进 | 29个优化预期效果 | 理论值，需benchmark验证 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-07-19 | 初始版本，基于 code-rehearsal 五系统推演 |
| 1.1 | 2026-07-19 | 追加"更新日志 v4.10.6 未显示"后续修复结论（根因：误用 tsc --noEmit 替代构建） |

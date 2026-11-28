# 知识库拆解模块 · 全链路参考（2026-11-28，千万字改造时核实）

> 目的：固化知识库管理模块的完整运行逻辑，作为「全本拆解千万字小说」改造
> （commit 范围 ea3bfbbe..本文件）的设计依据与后续维护参考。

## 一、模块地图

| 文件 | 职责 |
|---|---|
| `services/knowledge-base-manager.ts` (1716) | 书籍 CRUD / 原文存取 / 题材分类 / 拆解状态落盘；不做拆解 |
| `engine/deconstruction-scheduler.ts` (3400+) | 任务队列 + 维度调度 + 分段决策 + 向量化 + 进度/看门狗 |
| `engine/deconstruction-worker-manager.ts` (694) | worker/主线程双模式封装；`:vector` 任务有主线程 fallback |
| `engine/deconstructors/*` | 8 个维度的统计拆解器（style/rhythm/technique/structure/character/foreshadow/commercial/readability） |
| `engine/deconstructors/deconstruction-worker.ts` | Worker 侧入口；**worker 内 vectorEnhancer 恒为 null** → 向量增强在 worker 中自动退化为纯统计 |
| `engine/segment-aware-breakdown.ts` | 分段包装器：>30 万字自动分段，每段 5 万字，逐段 yieldToUI |
| `engine/scheduler-segment-integration.ts` | 调度器 ↔ 分段包装器集成；LLM 增强抽样上界（sampleTextForLLM） |
| `engine/stream-text-reader.ts` | 分段读取器（fromString 只持引用，不复制全文） |
| `engine/incremental-result-aggregator.ts` | 分段结果合并（完成时一次性 combine） |
| `engine/llm-enhancer.ts` + `engine/llm-prompts.ts` | LLM 增强（云端强制，本地拒绝）；prompt 对 text 有 2 万字防线 |
| `engine/vector-enhancer.ts` + `engine/knowledge-vector-store.ts` | 向量化 + 向量库（限速 5 ops/s，TokenBucket） |
| `services/knowledge-original-chunker.ts` | 原文分块：400 字/块，**maxChunks=120 均匀采样**（首尾覆盖） |

## 二、单任务数据流

```
addTask(bookId, sourceText)                    ← 全文进内存（10M ≈ 20MB）
  ├─ 同一本书只允许一个在途任务
  ├─ warnIfHeavyTask：分段口径成本预估（段数×维度），成本≥3 提示 / ≥阈值 警告
  └─ queue → scheduleNext（maxConcurrency=2）
runTask（每个任务）:
  activeCount++ → watchdog(120s) → AbortController
  ① preprocessText：清洗（3×regex）+ 字数/段落计数 —— 实测 10M 字仅 ~5ms
  ② resolveInputPolicy（输入决策矩阵，见 §三）
  ③ computeContentHash（只 hash 前 100k，缓存键用）
  ④ 逐维度 processDimension（dimensionConcurrency=3，runWithConcurrencyLimit）：
      缓存命中(bookId:dimension + hash) → 直接用
      分段维度（wordCount > 10 万）→ breakdownDimensionWithSegments：
        SegmentAwareBreakdown.run：
          for await seg (5 万字/段):
            workerManager.analyzeXxx(seg.text) → Worker postMessage
            （worker 内纯统计；worker 不可用时主线程 fallback 带 VectorEnhancer）
            每段 yieldToUI → UI 不卡
          combineResults（200 段 → IncrementalResultAggregator 一次合并）
          enhanceWithLLMIfNeeded(sampleTextForLLM(全文))   ← 抽样 ≤1.6 万字
        saveSegmentedDimensionResult（终态守卫：取消后不写盘）
      非分段维度 → checkAbort → worker/主线程
  ⑤ vectorizeBook：
      chunkOriginalText(全原文) → ≤120 块（400 字/块，均匀采样保首尾）
      → 120 次 embed（限速 5/s ≈ 24s）
      extractXxxSamples：读拆解报告 md（200 字/段）→ 采样 embed
  ⑥ recordVectorOutcome → setBreakdownStatus(completed)
  finally: 释放原文（sourceText 清空）→ activeCount-- → scheduleNext
```

## 三、输入决策矩阵（resolveInputPolicy）

| 条件 | 行为 | mode |
|---|---|---|
| sampleMode 开 | 截到 textSampleLimit | `sample` |
| 分段启用 且 cleaned > segmentedBreakdownThreshold(10 万) | **全本不截**，交分段链路 | `segmented-full` |
| 分段关闭 且 cleaned > KB_BREAKDOWN_HARD_LIMIT(15 万) | 截断护栏（老路径无分段，超限会卡） | `truncated` |
| 其余 | 直通 | `direct` |

与 `shouldUseSegmentedDimension` 同口径（测试锁定一致性）。

## 四、线程与卡顿语义（为什么千万字不会卡）

- **统计拆解全部在 Worker**：每段 5 万字 postMessage（~100KB，结构克隆廉价），
  段间 `yieldToUI`。worker 模式下「向量增强」实际是纯统计（worker 内无
  VectorEnhancer）——真正向量化的只有 §二⑤ 的固定 120 块。
- **主线程重活实测**（node -e，10M 字符）：preprocess 4ms / split 10ms /
  splitParagraphs 8ms / hash 1ms——都不是卡顿源。
- 2026-11-25 的卡死根因是「向量增强任务退回主线程 × 8 维 × 全文不截」三因素
  叠加；现在：全文→分段（不截）+ 统计→worker + 增强只在结尾 120 块。
- 看门狗：所有进度回调（18 处 emitProgress + 心跳定时器）都喂 lastSeenAlive；
  分段长跑每段都有进度 tick，120s 不会误判。

## 五、已知取舍 / 后续可调

- **向量检索稀疏度**：10M 字 → 120 块均匀采样 ≈ 1 块/8.3 万字。维度报告是
  全量的，但 RAG 召回粒度粗。若需要更细召回，调高
  `services/knowledge-original-chunker.ts` 的 maxChunks（120 → 500 ≈ 100s embed）。
- **worker 内无向量增强**：分段路径的「向量增强」实际不生效（设计如此），
  若要恢复需在 worker 内建独立 HTTP embedding（Ollama 本地直连可行）。
- **LLM 增强**：云端强制（本地拒绝，含未登记 provider 的名字兜底判定）；
  输入抽样 ≤1.6 万字 + llm-prompts 2 万字插值防线（双保险）。
- **内存峰值**：单本 10M 字 ≈ sourceText 20MB + cleaned 20MB，终态释放
  （11b3dbab）；maxConcurrency=2 时两本并发峰值 ~80MB，可接受。

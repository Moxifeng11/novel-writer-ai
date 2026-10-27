# 路线图与验收

## 一、实施阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | Kernel 契约：PromptArtifact / ContextPack / RetrievalPlan / MemoryRecord / ToolRegistry / DomainProfile | 本版实施 |
| M2 | 规则集与工具注册表接入现有三域流程；静态隔离门禁 | 后续 |
| M3 | 长篇记忆适配器：FactIndex / ChapterSnapshot / Relationship / Foreshadow | 后续 |
| M4 | 短篇反转/钩子账本；分节大纲与节级质检接入 | 后续 |
| M5 | 剧本集/场/镜账本、时长计算器、连续性检查、纯文本导出 | 后续 |
| M6 | RAG 混合检索与引用体系；知识库/旧正文/设定库统一检索 | 后续 |
| M7 | 调用账本与成本遥测 UI | 后续 |
| M8 | 离线评测集与回归基准 | 后续 |

## 二、M1 验收

1. `PromptArtifact` 能生成稳定 hash；模板版本变化导致 hash 变化。
2. `ContextPack` 保证 required 片段不被裁剪；超预算记录 dropped。
3. `RetrievalPlan` 能表达四类查询；`RagCitation` 能标记 verified。
4. `MemoryRecord` 默认 pending；确认/拒绝状态可流转。
5. `ToolRegistry` 能按 mode 过滤、拒绝重复注册、未知工具返回结构化错误。
6. `DomainProfile` 三域互不 import；Kernel 不反向依赖领域。
7. SingleCallRunner 现有调用路径不回归。

## 三、总体验收

- 三类项目可完成创建、编辑、导出。
- 规则违规可见；must 阻断、should 警告。
- 记忆 pending 不进入 RAG；confirmed 可检索。
- 外部来源与模型推断有明确可信度标记。
- 长篇单次调用入口、短篇 AI 调研、剧本分镜链路均不回归。
- `typecheck` / `lint` / `test` / `preflight` / `build` / `check:release` 全绿。
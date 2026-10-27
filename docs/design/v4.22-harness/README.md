# v4.22 Harness 工程设计包

- 日期：2026-10-27
- 版本：4.19.0 工作树
- 状态：设计文档 + M1 核心实施

## 文档索引

1. [提示词与上下文工程](01-prompt-and-context.md)
2. [RAG 与引用](02-rag-and-citations.md)
3. [记忆层](03-memory-layers.md)
4. [规则层](04-rule-engine.md)
5. [工具层](05-tool-registry.md)
6. [长篇领域](06-domain-long.md)
7. [短篇领域](07-domain-short.md)
8. [剧本领域](08-domain-script.md)
9. [路线图与验收](09-roadmap-and-acceptance.md)

## 一、设计目标

把三类创作从“提示词 + 单次生成”升级为可持续演进的 Harness：

```text
Domain Profile（长篇 / 短篇 / 剧本）
        ↓
Prompt Compiler → ContextPack → RetrievalPlan
        ↓
Single Call Runner → MemoryStore → RuleEngine
        ↓
ToolRegistry → CallLedger → Quality Gates
```

## 二、六条原则

1. 共享 Kernel，三域策略化。
2. 提示词是编译产物，不是手写字符串。
3. 上下文是 typed 证据包，不是堆料。
4. RAG 服务事实，引用必须可信。
5. 记忆有生命周期，AI 记忆默认 pending。
6. 单次调用优先，显式编排兜底。

## 三、M1 实施边界

- 新增 Harness 类型与本地存储/调度层。
- 不重写长篇 11 步、短篇三步流程、剧本分镜链。
- 不替换现有 AIEngine / 命令 / 工具。
- RAG 先做计划与引用层，复用现有 KnowledgeVectorStore。
- 不自动把 AI 记忆写入 confirmed。
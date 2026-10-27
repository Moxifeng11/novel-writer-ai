# RAG 与引用

## 一、目标

RAG 为当前任务提供可引用证据，不是给 prompt 增加相似文本。

## 二、RetrievalPlan

```ts
interface RetrievalPlan {
    projectId: string;
    mode: CreationMode;
    taskId: string;
    queries: RetrievalQuery[];
    maxFragments: number;
    minScore: number;
}

interface RetrievalQuery {
    type: 'structured' | 'semantic' | 'keyword' | 'external';
    query: string;
    scope: string;
    topK: number;
    filters?: Record<string, string | number | boolean>;
}
```

## 三、RagCitation

```ts
interface RagCitation {
    sourceId: string;
    title: string;
    uri?: string;
    snippet: string;
    score: number;
    kind: 'vault' | 'knowledge' | 'external';
    verified: boolean;
    retrievedAt: number;
}
```

可信度：

| 来源 | verified | 说明 |
|---|---|---|
| 项目 vault 已确认文件 | true | 可引用 |
| 知识库已索引内容 | true | 可引用，带 bookId |
| 外部实时检索 | true | 带 URL 与抓取时间 |
| 模型推断 | false | 必须标记“未经实时核实” |
| 同人衍生来源 | false | 默认排除 |

## 四、管线

```text
Query Planner
  → Hybrid Retrieval（结构化 / 语义 / 关键词 / 外部）
  → Rerank（相关度 / freshness / scope / priority）
  → Fragmentize
  → ContextPack
```

## 五、规则

- 无证据时输出“未找到可靠证据”，禁止伪造引用。
- 规划、分析、设定类任务必须可引用；正文生成不强制引用。
- 外部来源必须带 URL 与抓取时间；模型推断必须带“未经实时核实”。
- RAG 结果不得直接写入 confirmed 记忆，必须先 pending。
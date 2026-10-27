# 提示词与上下文工程

## 一、PromptArtifact

```ts
interface PromptArtifact {
    taskId: string;
    mode: 'long' | 'short' | 'script';
    templateId: string;
    templateVersion: string;
    variables: Record<string, string | number | string[]>;
    contextPackId: string;
    ruleSetId: string;
    outputContractId: string;
    systemPrompt: string;
    userPrompt: string;
    tokenBudget: { maxInput: number; maxOutput: number; thinkingBudget?: number };
    hash: string;
    createdAt: number;
}
```

### 编译顺序

```text
A. Role & Objective
B. Hard Constraints（must 规则）
C. Domain Framework
D. Context Evidence
E. Task Instruction
F. Output Contract
G. Style & Randomization
H. Anti Patterns
```

规则：

- 业务代码不直接拼长 prompt，统一通过 `compilePromptArtifact()`。
- `hash` 覆盖所有影响输出的字段，用于缓存、审计与复现。
- 模板版本变化必须体现在 `templateVersion`。

## 二、ContextFragment

```ts
interface ContextFragment {
    id: string;
    kind: ContextKind;
    title: string;
    content: string;
    priority: number;
    freshness: number;
    scope: ContextScope;
    source: 'vault' | 'rag' | 'tool' | 'memory' | 'user' | 'model';
    verified: boolean;
    maxChars?: number;
    required?: boolean;
}
```

### ContextKind

```text
worldview | character | relationship | timeline | foreshadow
previous-summary | chapter-state | section-outline | episode-outline
scene-bible | shot-ledger | style | rule | research | random-factor
user-preference
```

## 三、ContextPack

```ts
interface ContextPack {
    id: string;
    projectId: string;
    mode: CreationMode;
    taskId: string;
    fragments: ContextFragment[];
    sections: Array<{ title: string; content: string }>;
    promptText: string;
    totalChars: number;
    builtAt: number;
    hash: string;
    dropped: Array<{ id: string; reason: string }>;
}
```

### 预算算法

1. 先放 `required === true` 的片段。
2. 剩余预算按 priority 降序放入。
3. 单片段超过 `maxChars` 时截断并记录。
4. 预算不足时从最低 priority 开始丢弃，写入 `dropped`。
5. `required` 片段永不丢弃；若 required 总量超预算，直接抛错，让调用方缩小任务。

## 四、三域上下文重点

| 模式 | 必备 | 常见裁剪 |
|---|---|---|
| 长篇 | 当前章目标、前章摘要、事实索引、人物关系、伏笔、时间线、文风 | 非本章实体、远卷细节 |
| 短篇 | 故事核、五维标签、反转表、当前节大纲、前节摘要、人物状态、目标字数 | 旧节全文、非主线支线 |
| 剧本 | 类型/卖点、人物小传、场景圣经、当前集大纲、前集钩子、时长预算 | 非当前集分镜、重复小传 |
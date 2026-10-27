# 记忆层

## 一、五层记忆

| 层 | 名称 | 生命周期 | 典型内容 |
|---|---|---|---|
| L0 | Working | 当前任务 | prompt fragments、临时变量、上一轮输出 |
| L1 | Chapter/Section/Episode | 当前单元 | 当前目标、已发生事件、当前钩子 |
| L2 | Project Semantic | 项目长期 | 确认事实、实体状态、关系、时间线、伏笔 |
| L3 | Procedural | 项目/用户长期 | 文风、叙事偏好、反 AI 规则、成功模板 |
| L4 | User Preference | 用户全局 | 模型、思考强度、题材偏好、禁用元素 |

## 二、MemoryRecord

```ts
interface MemoryRecord {
    id: string;
    mode: 'long' | 'short' | 'script';
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    content: string;
    status: 'pending' | 'confirmed' | 'rejected';
    source: 'ai' | 'tool' | 'user' | 'rule';
    confidence: number;
    createdAt: number;
    updatedAt: number;
    citations?: RagCitation[];
}
```

## 三、状态机

```text
AI / Tool 产出
   ↓
Rule / Validator 预检
   ↓
pending
   ├── 用户确认 → confirmed
   ├── 用户拒绝 → rejected
   └── 规则高置信确认 → confirmed
```

硬规则：

- AI 记忆默认 pending，不得直接 confirmed。
- rejected 记忆不再进入 RAG。
- confirmed 记忆变更必须保留旧版本。
- 记忆不得覆盖用户正文。

## 四、存储

```text
{项目}/Harness/memory/
  pending/{id}.json
  confirmed/{id}.json
  rejected/{id}.json
  index.json
```

每条记录带 `schemaVersion`。索引只存 id/title/scope/status/updatedAt，避免整库读取。

## 五、领域重点

| 模式 | 必须记住 | 允许遗忘 |
|---|---|---|
| 长篇 | 事实、人物、关系、伏笔、时间线、章节快照 | 被否定草稿 |
| 短篇 | 故事核、反转、钩子、人物状态、情绪兑现 | 早期废稿 |
| 剧本 | 集/场/镜、道具、服装、时间、连续性、付费卡点 | 重复对白草稿 |
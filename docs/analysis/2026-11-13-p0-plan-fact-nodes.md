# P0 方案：拆解事实接入 StoryContextGraph（2026-11-13）

> 前置：架构校准（`2026-11-13-architecture-recalibration.md`）。
> 本文基于对三份真实代码的阅读，给出**不新增存储层、不改 RAG 管线**的接入方案。

## 一、读代码得到的事实

### 1. `engine/context/story-context-types.ts`

```ts
type StoryContextKind =
  | 'worldview' | 'setting' | 'character' | 'faction' | 'location'
  | 'item' | 'timeline' | 'foreshadow' | 'scene' | 'emotion';   // ← 没有通用 fact

interface StoryContextNode {
  id; kind; title; text; compactText;
  priority; required; tokens; compactTokens;
  links: StoryContextLink[];        // { targetId, reason, weight }
  sourcePath?;
  metadata: Record<string, unknown>;  // ← 有效区间可以放这里
}

interface StoryContextGraph {
  nodes: Map<string, StoryContextNode>;
  byKind: Record<StoryContextKind, StoryContextNode[]>;
  nameIndex: Map<string, string[]>;   // 实体名 → 节点 id
  warnings: string[];
}
```

**结论 1：不需要新增 kind。** 拆解出的 9 类事实可以映射到既有 kind，
`validFrom/validTo/quote/confidence` 放 `metadata.fact`。
图已有 `nameIndex`（按实体名索引）与 `links`（自动关联），正是检索与关联的基础设施。

### 2. `engine/rag/retrieval-service.ts`

```ts
export async function retrieve(...)          // 检索管线入口
export function formatRetrievalHits(...)     // 统一 citation
export function mergeQueryResults(...)
interface RetrieveOptions / RetrievalTelemetry / RetrievalResult
```

**结论 2：RAG 只检索"向量库里的文本块"**（`KnowledgeSearchResult`），
它不检索图节点。所以**拆解事实进图 ≠ 进 RAG**——两者是互补：
图供"结构化上下文装配 + 一致性比对"，向量库供"原文片段检索"。

### 3. `services/knowledge-base-manager.ts`

```
kbVectorsDir() → knowledge-vectors/<bookId>.json
BookBasicInfo { vectorStatus: pending|done|failed, vectorError }
samples（原文块）+ 向量
```

**结论 3：向量库按"书"存原文块与向量**，与图（按"章"组装）是两个粒度。
两者的关联靠 `sourcePath`（图节点）与 `bookId/position`（向量块）。

## 二、三者的分工（已确认，与你之前问的第 2 条一致）

| 组件 | 粒度 | 内容 | 谁消费 |
|---|---|---|---|
| **StoryContextGraph** | 章 | 结构化节点（人物/物品/地点/时间线/伏笔/设定） | 写作上下文装配、**一致性审核** |
| **知识库向量库** | 书 | 原文块 + 向量 | RAG 检索（写作注入、引用） |
| **拆解产物（C 臂）** | 章 | 带有效区间的事实 | **产出图节点**（新增来源），并可作为向量库的元数据 |

权威序（写进红线）：**正文 > 图（人工可修正）> 摘要（LLM 派生）**。

## 三、P0 实施（五步，最小改动）

### 步骤 1：事实 → 图节点映射（新文件）

`engine/context/knowledge-fact-nodes.ts`

```ts
export function toContextNodes(
  entries: readonly DecomposeEntry[],
  chapterNum: number,
  chapterName: string,
): StoryContextNode[]
```

- **kind 映射表**（9 → 6）：
  | 拆解 type | 图 kind |
  |---|---|
  | age / ability / knowledge / memory / relationship | `character` |
  | location | `location` |
  | possession | `item` |
  | timeline | `timeline` |
  | world-rule | `setting` |
- `text` / `compactText`：`「主体·谓词=值」（第N章）`，供预算装配
- `metadata.fact`：原样保存 `{type, subject, predicate, value, numeric, unit, validFrom, validTo, confidence, quote, chapter}`
- `tokens` / `compactTokens`：按字符数估算（与图现有估算口径一致）
- `priority`：`confidence × 类型权重`（timeline/world-rule 更高）
- `required`：本章 `involved` 角色的核心事实为 true
- `sourcePath`：指向正文路径（便于溯源）

### 步骤 2：图构建支持注入事实节点

修改 `buildStoryContextGraph()`（或等价入口），新增可选参数 `facts?: KnowledgeFact[]`：

- 事实节点与既有节点**合并进同一个 `nodes` Map / `byKind`**
- **复用既有 `nameIndex`**：`subject` 进 `nameIndex`，`links` 指向同名实体节点（reason 用既有枚举值）
- 事实节点 id 规范：`fact:<chapterNum>:<subject>:<predicate>`（稳定、可去重）

> 不新建图，不新建存储；`facts` 缺省时行为完全不变（零回归）。

### 步骤 3：一致性审核读同一张图

`engine/consistency/consistency-audit-wiring.ts`：

- 新增 `loadGraphFacts(app, project, chapterNum)`：从图节点取 `metadata.fact`
- 转回断言：复用**已有** `entriesToAssertions()`（无需新代码）
- 与现有 digest/frontmatter 断言合并；来源标记 `source: 'graph-fact'`

> 这样"写作注入"和"一致性审核"看到的是**同一份事实**，
> 不会再出现"注入说 A、审核按摘要说 B"的分裂。

### 步骤 4：`knowledge-base.ts` 降级

现状：自有 `facts[]` + 检索，构成第二事实源。
改为：

- 删除 `appendFacts` / `queryFacts` 的存储职责
- **保留 `stateAt(graph, subject, chapter)`**：这是图目前**没有**的能力
  （按有效区间取某章时点的实体状态），输入改为图/节点数组
- 改名为 `engine/context/fact-view.ts`（视图函数，不是存储）

> 理由：`stateAt` 是"时间线不崩"的核心查询，图本身没有时间切片能力，值得保留。

### 步骤 5：测试与验收

| 测试 | 断言 |
|---|---|
| 映射 | 9 类 type 各自映射到正确的 kind；metadata.fact 完整 |
| 合并 | 注入事实节点后 `byKind`/`nameIndex` 都包含；不传 facts 时图与原来等价 |
| 审核 | 图里有人物年龄事实 → 审核产出对应断言（source=graph-fact） |
| 视图 | `stateAt` 在未来章不提前、区间结束不返回（既有 22 条测试迁移） |

**P0 验收**：一个项目跑结算 → 图含事实节点 → 审核断言数 > 0 且能定位到正文。

## 四、明确不做（放 P1/P2）

| 不做 | 原因 |
|---|---|
| 事实单独落盘一套新格式 | P0 只做内存接通；落盘随图的既有序列化走 |
| 改 RAG 管线 | 事实进图不影响向量检索；原文块检索能力已足够 |
| 判断层接入 | 属 P1；P0 先把"事实源统一"做对 |
| 结算流程加拆解调用 | 属 P1；先用手动/脚本验证链路 |

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 图节点数暴增（30 章 456 条 → 200 章 3000+ 条） | 事实节点 `priority` 低、`required=false`，预算装配时自然被裁；`byKind` 按章过滤 |
| 事实与既有节点语义重复 | id 前缀 `fact:` 区分；合并时去重（同 subject+predicate+chapter） |
| 图构建变慢 | 事实节点构造是纯内存 O(n)；n≈15/章，可忽略 |
| 审核出现两套断言来源冲突 | 红线：正文 > 图 > 摘要；冲突在报告中标注，不静默取一个 |

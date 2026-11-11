# RAG 检索与同人联网考据：缺陷调研与下一批计划

- 调研时间：2026-11-11
- 触发：用户反馈「RAG 检索程序仍有缺陷」「同人源需要联网搜索程序做同人设定补充」
- 基线：v4.83.0（`d14144b`）

---

## 一、RAG 检索：找到 2 个实锤缺陷

检索管线本身结构合理（`engine/rag/retrieval-service.ts`，267 行）：

```
查询计划（多来源） → 并行检索 → 合并去重 → 邻块扩展 → MMR → 阈值 → 预算打包
```

问题出在**邻块扩展**这一步。

### RAG-1｜跨维度邻块取错（功能缺陷）

`retrieval-service.ts:194`：

```ts
const neighbors = await store.getNeighbors(options.bookIds || [], working[0].dimension, positions, 1);
```

- `positions` 是**所有命中**的位置（可能来自 character / style / rhythm 多个维度）
- 但传入的 `dimension` 是 `working[0].dimension`（**第一个命中的维度**）

而 `knowledge-vector-store.ts:272` 内部按维度过滤：

```ts
if (sample.dimension !== dimension) continue;
```

**后果**：多维度命中时，非首维度的邻块永远取不到；更糟的是 position 相同但维度不同时，会把**别的维度**的同位置样本当作邻块塞进来（张冠李戴）。

**影响场景**：协同写作 / 步骤执行时同时检索「人物 + 风格 + 节奏」，邻块扩展基本只在第一个维度生效。

### RAG-2｜`bookIds` 缺省时邻块扩展静默失效（静默缺陷）

`mode-injection.ts:84`：

```ts
const result = await retrieve(deps.vectorStore, {
    queryText: cleanQuery.slice(0, 1200),
    topN: 4,
    maxChars: 900,
});
```

**没有传 `bookIds`**。而 `retrieval-service.ts:194` 传 `options.bookIds || []` → `getNeighbors` 内部：

```ts
for (const bookId of bookIds) { ... }   // 空数组 → 一次都不循环
```

→ 返回空数组 → 邻块扩展**完全不发生**，且**没有任何警告或遥测标记**。

**影响场景**：`collectModeInjection` 这条路径（模式注入）拿不到被 400/40 分块切开的完整场景。

### 建议修复方向

| 编号 | 修复 |
|---|---|
| RAG-1 | `getNeighbors` 改为按维度分组查询（或 `retrieval-service` 按 `hit.dimension` 分组后分别调用再合并） |
| RAG-2 | `bookIds` 缺省时退化为「全部已加载书籍」；若仍无书可查，在 `telemetry` 里显式标记 `neighborSkipped: true`，不再静默 |

两项都是局部改动，可加回归测试（用 fake store 断言 `getNeighbors` 的调用参数）。

---

## 二、同人联网考据：链路存在，但**产出被分级规则全部过滤**

### 现状链路

```
ui/add-fanfic-setting-modal.ts「🌐 联网检索官方资料」
  → CanonResearchService.research()
      → 搜索（bing/brave/serper/tavily）
      → 抓取页面摘录
      → createCanonSource() 分级
  → formatCanonSourcesForPrompt() → 进 system prompt（已围栏）
  → shared/fanfic-audit.ts 用于同人生成/审核
```

链路是通的。**问题在两级：入口要 Key，出口被过滤。**

### FAN-1｜搜索 provider 全部需要第三方 API Key

```ts
export type CanonSearchProvider = 'manual' | 'bing' | 'brave' | 'serper' | 'tavily';
```

- `manual`：纯手动粘贴 URL / 摘录，等于**没有联网搜索**
- 其余四个：都需要用户自备 API Key

默认配置就是 `provider: 'manual'`。**普通用户开箱即用状态下没有任何联网检索能力**——这正是用户反馈的「同人源需要联网搜索程序」。

### FAN-2｜分级规则把 wiki/百科全部丢弃（更严重）

`shared/canon-source.ts`：

```ts
const DERIVATIVE_RE = /(同人|fan\s*fiction|fanfic|ao3|lofter|衍生|改编|...|fandom)/i;
const OFFICIAL_HOST_RE = /(^|\.)(qidian\.com|fanqienovel\.com|zongheng\.com|jjwxc\.net|17k\.com|ciweimao\.com|sfacg\.com|chineseall\.com)$/i;
const REFERENCE_HOST_RE = /(^|\.)(wikipedia\.org|baike\.baidu\.com|zhihu\.com)$/i;
const OFFICIAL_WIKI_RE = /(官方\s*wiki|official\s*wiki|官方资料站)/i;
```

而 `selectAuthoritativeSources` **只保留** `official` + `official-wiki`：

| 常见同人资料源 | 命中规则 | 分级 | 是否进 prompt |
|---|---|---|---|
| 萌娘百科 `moegirl.org.cn` | 无 | `unknown` | ❌ 丢弃 |
| Fandom 各 wiki | `DERIVATIVE_RE`（含 `fandom`） | `derivative` | ❌ 丢弃 |
| Bangumi | 无 | `unknown` | ❌ 丢弃 |
| 百度百科 | `REFERENCE_HOST_RE` | `reference` | ❌ 丢弃 |
| 维基百科 | `REFERENCE_HOST_RE` | `reference` | ❌ 丢弃 |
| 起点/番茄等平台书页 | `OFFICIAL_HOST_RE` | `official` | ✅ |
| 标题含「官方wiki」的页面 | `OFFICIAL_WIKI_RE` | `official-wiki` | ✅ |

**结论**：同人创作最依赖的设定资料源（wiki / 百科）**全部被过滤**。搜索结果再多，`formatCanonSourcesForPrompt` 也会返回：

```
（没有可用的官方原著来源；所有字段必须写"待核实（未找到可靠原作来源）"）
```

模型于是只能输出「待核实」，**这就是「同人设定补充不了」的直接原因**。

> 注：这个收紧来自安全审计 S3-3（防止任意域名标题写「官方」就冒充权威），方向正确但**过度**——把「不可信标题」和「社区 wiki」一刀切了。

### FAN-3｜缺少「二手资料」这一档

现有分级只有 `official / official-wiki / reference / derivative / unknown` 五个值，但**权威集只有前两个**。缺一个「可信二手资料」档：允许进 prompt，但必须标注「非官方、可能过时」并要求模型区分。

这既保住 S3-3 的安全意图（不让非官方冒充官方），又恢复实用性。

### 建议修复方向

| 编号 | 修复 |
|---|---|
| FAN-1 | 增加**免 Key** 检索路径：接社区 wiki 的公开 API（如萌娘百科 / MediaWiki API、Bangumi API），默认可用；第三方搜索 Key 保留为增强项 |
| FAN-2 | 新增 `trusted-wiki` 档：对已知社区资料站域名白名单授予；`selectAuthoritativeSources` 改为「官方优先，无官方时回落到可信二手」并在 prompt 里显式标注等级 |
| FAN-3 | 同人设定结构化抽取：把摘录整理成「人物/世界观/时间线/关键设定」四类条目，而不是整段网页文本堆进 prompt |

---

## 三、优先级建议

用户明确点了两件事，我按「影响面 × 修复确定性」排序：

| 优先级 | 项 | 理由 | 预估 |
|---|---|---|---|
| **P0** | FAN-2 + FAN-3（分级放宽 + 结构化） | 这是「同人设定补充不了」的**直接原因**；改动集中在 `canon-source.ts`，可单测 | 1 轮 |
| **P0** | RAG-1 + RAG-2 | 两个都是静默功能缺陷，改动局部，可加 fake-store 回归测试 | 1 轮 |
| **P1** | FAN-1（免 Key 检索路径） | 价值高但涉及外部 API 与网络策略，需要先确认可用端点与合规性 | 1–2 轮 |
| **P2** | 同人设定与 RAG 打通 | 让考据来源也能进 RAG 向量库，创作时被检索到 | 后续 |

### 需要你先确认的三点

1. **FAN-2 放宽尺度**：我倾向「官方优先，无官方时回落到可信二手并显式标注等级」。这意味着模型可能在 prompt 里看到百度百科/萌娘百科的内容（带围栏 + 等级标注）。**是否接受？** 还是要求「宁可没有也不给二手资料」？
2. **FAN-1 免 Key 源**：优先接哪类？萌娘百科（二次元/网文 IP 覆盖最好）、Bangumi（番剧/轻小说）、还是通用 MediaWiki？另外这类站点的公开 API 是否有频率限制/合规风险，需要我实际探测确认。
3. **是否先做 P0 两项**（RAG-1/2 + FAN-2/3），把 FAN-1 留到确认外部 API 之后？

---

## 四、调研方法与可复现命令

```powershell
cd .obsidian/plugins/novel-writer-ai
# RAG-1：邻块扩展的维度参数
Select-String -Path engine/rag/retrieval-service.ts -Pattern 'getNeighbors'
Select-String -Path engine/knowledge-vector-store.ts -Pattern 'sample.dimension !== dimension'
# RAG-2：未传 bookIds 的调用方
Select-String -Path engine/mode-injection.ts -Pattern 'retrieve\('
# FAN-1/2：provider 与分级
Select-String -Path services/canon-research-service.ts -Pattern 'CanonSearchProvider'
Select-String -Path shared/canon-source.ts -Pattern 'OFFICIAL_WIKI_RE|REFERENCE_HOST_RE|selectAuthoritativeSources'
```

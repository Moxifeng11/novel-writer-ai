# knowledge-base-view.ts 结构勘察与抽取计划（v4.83.0）

- 勘察时间：2026-11-11
- 对象：`ui/views/knowledge-base-view.ts` —— **2,938 行 / 覆盖率 0.34%**，UI 层最大单体
- 目的：在不引入显示回归的前提下，把「判定与文案规则」从 DOM 代码里分离出来使其可测

---

## 一、文件构成

| 区段 | 行数（约） | 性质 | 覆盖率相关 |
|---|---:|---|---|
| `import` + 常量 | 47 | 引用 | — |
| **类型定义**（StyleData / RhythmData / TechniqueData / StructureData / CharacterKnowledgeData / ForeshadowData / CommercialData / ReadabilityData 等） | ~350 | **纯类型，编译期擦除** | 不产生运行时代码 |
| `KnowledgeBaseView extends ItemView` | 2,555（方法区） | 运行时 | 是 0.34% 的来源 |

> 注：文件里大段 `export interface` 是 `book-detail-renderer.ts` 等模块的类型来源。
> 它们不占运行时代码，**不是**覆盖率低的原因，迁移它们对覆盖率无帮助（但可作为独立整理任务）。

### 已抽出的子模块（该文件的"抽薄"历史）

```
book-detail-renderer.ts     详细页渲染（2,197 行）
kb-book-card.ts             书籍卡片
kb-stats-panel.ts           统计页签
kb-detail-actions.ts        详情操作按钮
kb-config-panel.ts          题材配置页签
knowledge-base-modals.ts    增删改弹窗
knowledge-detail-state.ts   详情状态机
capability-banner.ts        能力横幅
knowledge-capability.ts     能力计算
```

说明：该文件一直被逐步拆解，本次是延续既有方向，不是另起一套结构。

---

## 二、86 个方法的分级

### 体积分布（方法区 Top 10）

| 行数 | 方法 | 可抽性 |
|---:|---|---|
| **383** | `renderTasksTab` | 中（最大单体） |
| 109 | `renderBooksToolbar` | 中 |
| 109 | `openBookDetail` | **低**（vault/引擎异步） |
| 104 | `loadBookDetailData` | **低**（vault IO） |
| 85 | `createGenreGroup` | 中 |
| 75 | `renderBooksTab` | 中 |
| **64** | `getFilteredBooks` | **高**（纯数组变换） |
| 59 | `onOpen` / `handleBatchImport` | 低 |
| 58 | `renderLeftSidebar` | 中 |

### 集群 1｜纯格式化与查表（~150 行）—— **零风险，最高性价比**

| 方法 | 规则 |
|---|---|
| `getTaskStatusLabel` | 6 种任务状态 → 中文（pending/running/paused/completed/failed/cancelled） |
| `getStatusLabel` | 5 种拆解状态 → 中文（pending/processing/completed/failed/interrupted） |
| `getChannelLabel` | 3 频道 → 中文（male/female/neutral） |
| `formatWordCount` | `<10000` 显示「n 字」，否则「x.x 万字」，空值「未知」 |
| `formatDate` / `formatDateTime` | `yyyy-MM-dd` / `yyyy-MM-dd HH:mm` |
| `formatDuration` | `x小时y分` / `x分y秒` / `x秒`，`<=0` 归「0秒」 |

**风险**：无。纯输入→输出，无 DOM、无 this 状态（除 `this.filter` 等无关）。
**价值**：这些文案在书籍卡、详情页、任务面板到处显示，改一处符号就会静默走样。

### 集群 2｜书籍筛选与排序（`getFilteredBooks` 64 行 + 4 个计数方法）

```
频道过滤 → 题材过滤（uncategorized / 指定题材含次要题材）→ 子题材过滤（仅当指定了 primaryGenre）
→ 状态过滤 → 关键词（名称/作者/题材标签/自定义标签，均 toLowerCase）
→ 排序（createdAt / updatedAt / wordCount / quality，asc|desc）
```

**风险**：中低。有一处**嵌套条件容易改错**：子题材筛选只在「主题材不是 all/uncategorized」时才生效。
**价值**：高。筛选是用户直接操作的核心行为。

### 集群 3｜任务监控页（`renderTasksTab` 383 行）

内部结构（可抽的纯逻辑密集）：

```
筛选下拉（5 选项） → 空态 → 5 状态统计卡 → 工具栏（全选/反选/选中数/批量取消/批量删除/全部取消）
→ 任务列表（复选框 / 状态徽标配色 / 进度 / 单项按钮）
```

可抽纯函数：
- `TASK_FILTER_OPTIONS`（5 项清单）
- `filterTasksByStatus(tasks, filter)`
- `computeTaskStats(tasks)`（5 状态计数）
- `resolveTaskStatusTone(status)`（6 状态配色档位）
- `selectSelectedCancellable(tasks, selectedIds)`（running|pending）
- `selectSelectedDeletable(tasks, selectedIds)`（completed|failed|cancelled）
- `selectActiveTasks(tasks)`（running|pending）

**风险**：中。需保持 DOM 结构与按钮启用条件，但与已完成的 `kb-stats-panel` 模式完全一致（已有成功先例）。

### 集群 4｜数据加载（`openBookDetail` 109 + `loadBookDetailData` 104）—— **不建议本批触碰**

依赖 `vault` IO、`DeconstructionScheduler` 异步、`frontmatter` 解析。
无 mock 基础设施时抽取只会把复杂度搬个位置，且回归风险高。

### 集群 5｜业务副作用（`handleStartDeconstruction` 52、`handleDeleteBook` 41 等）—— **不建议**

跨模块副作用（引擎/管理器/通知），不属于"可测性"问题。

---

## 三、抽样风险点（抽取时必须逐字保持）

| # | 位置 | 风险 |
|---|---|---|
| 1 | `getFilteredBooks` 子题材嵌套 | 只在指定主题材时才筛子题材；改成分支外会让「全部」视图按子题材误筛 |
| 2 | `formatWordCount` | `!count` 同时覆盖 `0` 和 `undefined` → 都显示「未知」；不能改成 `=== undefined` |
| 3 | `formatDuration` | 小时分支丢掉秒、分钟分支丢掉小时；`<=0` 归零 |
| 4 | 任务批量按钮 | 取消/删除的**可操作集合不同**（running|pending vs completed|failed|cancelled），混用会导致误操作 |
| 5 | 状态徽标配色 | 书籍 5 档（待拆解/拆解中/已完成/失败/中断）与任务 6 档（多一个「已暂停」）**不是同一套**，不能复用同一个映射 |

---

## 四、分批计划

| 批次 | 内容 | 目标文件 | 预计用例 | 风险 |
|---|---|---|---:|---|
| **5** | 集群 1 纯格式化 | 新建 `ui/views/kb-format.ts` | ~25 | 无 |
| **6** | 集群 2 筛选排序 | 新建 `ui/views/kb-book-filter.ts` | ~22 | 低 |
| **7** | 集群 3 任务面板逻辑 | 新建 `ui/views/kb-task-panel.ts` | ~25 | 中 |
| — | 集群 4/5 | 不抽，留待 mock 基础设施 | — | 高 |

### 次序理由

1. 先做零风险的格式化 → 立即建立"抽取不改行为"的信心，且这些文案被最多地方消费
2. 再做纯数组变换的筛选 → 规则密集但无副作用
3. 最后做 383 行的任务面板 → 需要拆分 DOM 与状态，放在前两批验证方法论之后再动

### 每批的统一验收

```bash
npx tsc --noEmit                 # 0
npx vitest run <新增测试>         # 全绿
npm run preflight                # EXIT=0（含 build / bundle / release）
# 体积变化按纪律处理：下降则收紧基线；上升需 --note 说明换来的覆盖
```

---

## 五、预期总收益

- 可测规则：7 个格式化 + 筛选排序 + 任务面板判定 ≈ **450~500 行**运行时代码从 0.34% 文件中搬出
- 新增用例：**约 70 条**
- `knowledge-base-view.ts` 预计从 2,938 行降至 **约 2,450 行**
- 这些规则此前完全靠人工点开知识库确认，抽取后可在 CI 中回归

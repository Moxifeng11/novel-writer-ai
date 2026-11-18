# 旧弹窗退役清单（2026-11-19）

> 状态：活跃 · 2026-11-19
>
> 里程碑编号 `RETIRE-A1`..`RETIRE-D1` 可 grep；每个编号的关闭条件写在第四节。
>
> 任务：i18n 跨层数据⑩（`ZC-20261120-10`）· 执行：ZCode
> 起因：我在 ⑥ 的审计里建议「11 个旧弹窗等新版工作台取代后一并处理，不为将删代码付迁移成本」。
> DSH 同意延后，但要求**落成清单**——避免「临时」变成「永久」。
>
> 本清单的作用：让每一个被延后的弹窗都有**可搜索的里程碑编号**和**明确的处置条件**。
> grep `RETIRE-` 就能找到所有欠账，不会被遗忘。

## 一、先说结论：我 ⑥ 的判断需要修正

我在 ⑥ 里说这些是「旧版独立弹窗，入口大多已被新工作台取代，用户日常路径不经过」。
**核对代码后，这个说法不成立。**

实测每个类的实例化点（`grep "new <Class>("`，排除测试与自身文件）：

| 弹窗 | 实例化点 | 是活跃入口吗 |
| --- | --- | --- |
| `GoldenOpeningModal` | `ui/command-ui-executor.ts:506` | ✅ 命令面板 |
| `WriteChapterModal` | `ui/command-ui-executor.ts:395` | ✅ 命令面板 |
| `PlanBookModal` | `command-ui-executor.ts:340`、`sidebar-component.ts:24`、`full-writer/wizard-step-executors.ts:313` | ✅ **三处**，含新版向导 |
| `AiBuilderModal` | `ui/command-ui-executor.ts:384` | ✅ 命令面板 |
| `WritingStyleModal` | `full-writer/wizard-step-executors.ts:290`、`project-selector-controller.ts:820/896` | ✅ **新版工作台在用** |
| `NovelTagsModal` | `ui/command-ui-executor.ts:381` | ✅ 命令面板 |
| `PreResearchModal` | `command-ui-executor.ts:264/267`、`services/agent-port.ts:325` | ✅ 命令面板 + agent |
| `KnowledgeDetailModal` | `ui/settings/knowledge-section.ts:274/429` | ✅ 设置页 |
| `AddFanficSettingModal` | `ui/command-ui-executor.ts:388` | ✅ 命令面板 |
| `MonitorPanelB` | `ui/workspace-manager.ts:40` | ✅ 工作区视图 |
| `book-detail-renderer.ts` | （非弹窗，是详情渲染器） | ✅ 知识库详情 |

**所以「等新版工作台取代」这句话是错的**——多数弹窗没有替代者，`PlanBookModal` 和
`WritingStyleModal` 甚至**就是新版向导在调用的**。

真实情况是：**它们是当前活跃功能，不是遗留代码。**
延后的真正理由是「迁移成本 vs 收益」，不是「反正要删」。

## 二、处置分类（按真实情况重排）

### A 类：新版流程在用，**不能退役**（3 个）

| 文件 | 行数 | 理由 | 里程碑 |
| --- | --- | --- | --- |
| `ui/plan-book-modal.ts` | ~450 | 新版向导 `outline` 步骤直接 `new PlanBookModal(...)`；侧栏也调 | `RETIRE-A1` 无退役计划——它是现行实现 |
| `ui/writing-style-modal.ts` | ~500 | 新版工作台项目卡与向导都调 | `RETIRE-A2` 同上 |
| `ui/monitor-panel-b.ts` | ? | 工作区视图（`workspace-manager` 注册），不是弹窗 | `RETIRE-A3` 同上 |

**结论**：这 3 个**应当迁移**，只是不属于「等下线」。建议下一批 i18n 直接做。

### B 类：命令面板入口，有替代路径但未清理（6 个）

| 文件 | 中文字符 | 替代者 | 里程碑 |
| --- | --- | --- | --- |
| `ui/golden-opening-modal.ts` | 2,923 | 新版「脑洞构思工坊」`ideation`（工作台工具目录有） | `RETIRE-B1` |
| `ui/write-chapter-modal.ts` | 1,075 | 协同写作视图（`novel-writer-co-writing`） | `RETIRE-B2` |
| `ui/ai-builder-modal.ts` | 1,299 | 工作台「AI 生成设定/实体」相关工具 | `RETIRE-B3` |
| `ui/novel-tags-modal.ts` | 1,199 | 部分被工作台标签工具取代 | `RETIRE-B4` |
| `ui/pre-research-modal.ts` | 1,043 | 工作台「前期调研」向导步骤 | `RETIRE-B5` |
| `ui/add-fanfic-setting-modal.ts` | 1,487 | 同人设定入口（知识库侧） | `RETIRE-B6` |

**处置条件**：命令面板里这些命令仍在（`COMMAND_DEFINITIONS`）。要退役必须：
① 从命令面板摘除；② 确认无 agent/脚本引用；③ 在 `docs/CHANGELOG` 记破坏性变更。
在此之前**它们对用户可见**，只是不被主流程推荐。

**里程碑**：`RETIRE-B*` 的关闭条件是「命令摘除 PR 合入」，不是日期。

### C 类：设置页内嵌，随知识库重构处理（1 个）

| 文件 | 中文字符 | 说明 | 里程碑 |
| --- | --- | --- | --- |
| `ui/knowledge-detail-modal.ts` | 1,035 | 设置页「知识库」分区打开书籍详情 | `RETIRE-C1` |

它与 `book-detail-renderer.ts`（1,206 字）是一套。等知识库视觉重构（Slice A–Y）走完
再统一处理，避免与视觉基线冲突。

### D 类：DOM 渲染器，不是弹窗（1 个）

| 文件 | 中文字符 | 说明 | 里程碑 |
| --- | --- | --- | --- |
| `ui/views/book-detail-renderer.ts` | 1,206 | 同 C，属详情区渲染 | `RETIRE-D1` |

## 三、为什么现在不迁（真实理由）

1. **A 类 3 个不该等**——它们是现行实现，等待没有意义。我这轮判断错了，建议直接排进下一批。
2. **B 类 6 个**：命令面板仍暴露，用户能点开。迁与不迁的成本一样（都是 100~230 条字面量），
   但**退役会删代码**——在确认无人使用前，迁了再删是双重浪费。**处置条件明确后一次做完**。
3. **C/D 类**：与知识库视觉重构耦合，现在动会和视觉基线打架。

## 四、里程碑索引（grep 用）

| 编号 | 文件 | 类型 | 关闭条件 |
| --- | --- | --- | --- |
| `RETIRE-A1` | `ui/plan-book-modal.ts` | 现行实现 | **不退役**；应排进下一批 i18n |
| `RETIRE-A2` | `ui/writing-style-modal.ts` | 现行实现 | **不退役**；应排进下一批 i18n |
| `RETIRE-A3` | `ui/monitor-panel-b.ts` | 工作区视图 | **不退役**；应排进下一批 i18n |
| `RETIRE-B1` | `ui/golden-opening-modal.ts` | 命令入口 | 命令摘除 PR 合入 |
| `RETIRE-B2` | `ui/write-chapter-modal.ts` | 命令入口 | 同上 |
| `RETIRE-B3` | `ui/ai-builder-modal.ts` | 命令入口 | 同上 |
| `RETIRE-B4` | `ui/novel-tags-modal.ts` | 命令入口 | 同上 |
| `RETIRE-B5` | `ui/pre-research-modal.ts` | 命令入口 | 同上 |
| `RETIRE-B6` | `ui/add-fanfic-setting-modal.ts` | 命令入口 | 同上 |
| `RETIRE-C1` | `ui/knowledge-detail-modal.ts` | 设置页内嵌 | 知识库视觉重构完成后 |
| `RETIRE-D1` | `ui/views/book-detail-renderer.ts` | 详情渲染器 | 同上 |

## 五、给下一批派单的建议

**优先做 A 类**（3 个，约 4,900 中文字符）：它们是新版流程在用的代码，
迁完立刻对用户可见；而且不存在「迁了要删」的风险。

**B 类需要先有产品决策**：这 6 个命令到底留不留？
- 若留 → 直接迁（不退役），把它们从「旧弹窗」名单里移除；
- 若不留 → 先摘命令、观察一个版本、再删文件——**不要先迁再删**。

这个决策我做不了，需要 DSH 或用户定。

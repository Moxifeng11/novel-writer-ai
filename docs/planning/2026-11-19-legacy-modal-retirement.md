# 旧弹窗退役清单（2026-11-19）

> 状态：活跃 · 2026-11-19（v2，按实测可达性重写）
>
> 里程碑编号 `RETIRE-A1`..`RETIRE-D2` 可 grep；每个编号的关闭条件写在第五节。
>
> 任务：i18n 跨层数据⑩ → 本批 ZC-20261120-20（ZCode 复核后重写）
> v1（`dc5774d7`）的 B 类判断有误：我把「有 `new XxxModal()` 调用点」当成了「用户可达」，
> 没有去查命令注册表的过滤链。v2 按 `core/command-registry.ts` 的实测结果重写。

## 一、判断依据（这一节是本清单的地基）

一个弹窗「用户能不能用到」看三层，缺一层结论就错：

1. **命令是否注册**：`COMMAND_DEFINITIONS` 里有没有这条 id
2. **命令是否公开**：`getPublicCommands()` = `COMMAND_DEFINITIONS.filter(cmd => !cmd.internalOnly)`
   （`core/command-registry.ts:288`）
3. **命令是否在面板**：公开才会进命令面板；`internalOnly` 只在内部路径可调，执行时还会 `warnLegacyCommand`

v1 只做了第 1 层（看到 `new XxxModal(app, plugin).open()` 就认为可达），
所以把 4 个 `internalOnly` 的旧写入命令误判成了「面板可达」。

## 二、A 类：现行实现，**已排进本批 i18n**（3 个）

| 文件 | 实例化点 | 结论 | 里程碑 |
| --- | --- | --- | --- |
| `ui/plan-book-modal.ts` | `wizard-step-executors.ts:313`（新版向导 outline 步骤）、`command-ui-executor.ts:340`、`sidebar-component.ts:24` | 产物是 `分卷大纲.md`，管线里没有第二个生成器 | `RETIRE-A1` **已迁移**（`bea5dd63`） |
| `ui/writing-style-modal.ts` | `project-selector-controller.ts:820/896`（工作台项目卡）、`wizard-step-executors.ts:290` | 写 `文笔风格.md` + `PRESET_SECTION_MAP` 八段落，管线契约 | `RETIRE-A2` **已迁移**（`be319378`） |
| `ui/monitor-panel-b.ts` | `workspace-manager.ts:40`（`registerView(VIEW_TYPE_MONITOR_B)`） | 常驻视图，Slice K 已做视觉语义化 | `RETIRE-A3` **已迁移**（`65103acd`） |

**A 类不退役**：它们是当前活跃功能。v1 说「等新版工作台取代」是错的。

## 三、B 类：命令面板可达，**已排进本批 i18n**（5 个弹窗 / 4 条命令）

按 `getPublicCommands()` 实测，以下命令**无 `internalOnly`**，在面板上：

| 文件 | 命令 id | 命令名 | 守卫 | 迁移状态 |
| --- | --- | --- | --- | --- |
| `ui/golden-opening-modal.ts` | `GOLDEN_OPENING` | 🌟 黄金开篇工坊 | 无 | `RETIRE-B1` **已迁移**（`5ba4ad66`） |
| `ui/novel-tags-modal.ts` | `TAGS_ANALYSIS` | 作品标签分析 | `LONG_ONLY` | `RETIRE-B3` **已迁移**（`676990e4`） |
| `ui/ai-builder-modal.ts` | `AI_BUILDER` | AI世界元素生成 | `LONG_ONLY` | `RETIRE-B4` **已迁移**（`efab8126`） |
| `ui/add-fanfic-setting-modal.ts` | `ADD_FANFIC` | 添加同人设定 | `LONG_ONLY` | `RETIRE-B5` **已迁移**（`073ebfe1`） |
| `ui/pre-research-modal.ts` | `CREATE_SHORT` / `CREATE_SCRIPT` / `SHORT_RESEARCH` / `SCRIPT_RESEARCH`（四入口） | 新建短篇/剧本项目、短篇/剧本前期调研 | 无 | `RETIRE-B6` **已迁移**（`3290aa0c`） |

**B 类不退役，保留并迁移。理由是不对称成本，不是「省事」**：
- 误留一个中文界面 = 界面瑕疵，用户能忍；误删一个用户天天点的命令 = 功能消失，用户当天就来骂，
  且 Obsidian 插件没有热修路径。
- **我们没有使用数据**（无遥测、无崩溃上报）。「替代者存在」只证明功能重叠，不证明无人使用。

### B 类删除的前置条件（若将来要删）

四条**全部满足**才可删，缺一不可：
1. 从 `COMMAND_DEFINITIONS` 摘除该命令（或标 `internalOnly`）
2. 至少观察一个版本周期，确认无人反馈功能消失
3. `CHANGELOG` 写明破坏性变更
4. **用户明确同意**（不是 DSH 或 ZCode 能决定的）

## 四、C 类：`internalOnly` 隐藏命令，**已删除**（3 个弹窗 / 4 条命令）

`core/command-registry.ts:112-118`（原定义）+ `getPublicCommands()` 过滤 + `command-ui-executor.ts` 的
`warnLegacyCommand` 共同证明：这些命令**不在面板**，用户点不到。2026-11-19 用户明确同意（第 4 条前置条件）后已整链删除。

| 文件 | 命令 id | 判定依据 | 里程碑 |
| --- | --- | --- | --- |
| `ui/write-chapter-modal.ts` | `WRITE_CHAPTER` / `WRITE_CHAPTER_AUTO` | `internalOnly: true`；注释写明「正文统一走 CoWriterEngine」 | `RETIRE-B2` ✅ **已删除**（2026-11-19） |
| `ui/batch-chapters-modal.ts` | `BATCH_CHAPTERS` | `internalOnly: true`；公开的正式流程是 `BATCH_NOVELS` | `RETIRE-B7` ✅ **已删除**（2026-11-19） |
| `ui/auto-writer-modal.ts` | `AUTO_WRITER` | `internalOnly: true`；`warnLegacyCommand('自动写作器〔旧〕')` | `RETIRE-B8` ✅ **已删除**（2026-11-19） |

**`RETIRE-B7` / `RETIRE-B8` 是 v2 新增**：v1 与 DSH 的第二轮派单都只处理了 `write-chapter` 一个。
按同一条判据（`internalOnly` → 不可达 → 删除候选），这三个文件性质完全相同，
不能只处理一个 —— 这是**判据一致性**问题，不是新增需求。

### C 类的确凿证据（v1 没有）

`BATCH_CHAPTERS〔旧〕` 被 `internalOnly` 隐藏，而 **`BATCH_NOVELS（📚 批量生成章节（正式流程）`**
（`command-registry.ts:115`，无 `internalOnly`）是公开的。
「旧命令被新流程取代」这件事，这是本仓能找到的最硬证据 —— 比任何间接推断都可靠。

同理 `WRITE_CHAPTER〔旧〕` 隐藏，正文生成统一走 CoWriterEngine（代码注释原文）。

### C 类删除的前置条件

同 B 类四条，但第 1 条更容易（命令已经不可达，无需摘除）。

**2026-11-19 已满足**：用户明确同意（m16614）→ 整链删除：
`shared/command-ids.ts` 4 个 id、`core/command-registry.ts` 4 条定义 + `uiCommandIds` 4 项、
`shared/command-mode-rules.ts` 4 条 `LONG_ONLY` + 1 条可读名、`ui/command-ui-executor.ts` 3 个 import /
4 个 `case` / `warnLegacyCommand` 与 `legacyCommandWarned` 字段、`main.ts` 3 个死 import，三个模态文件 `git rm`。

## 五、D 类：与知识库视觉重构耦合（2 个文件）

| 文件 | 中文字面量 | 说明 | 里程碑 |
| --- | --- | --- | --- |
| `ui/knowledge-detail-modal.ts` | 1,035 | 设置页「知识库」分区打开书籍详情 | `RETIRE-D1` 等视觉重构 Slice A–Y 走完 |
| `ui/views/book-detail-renderer.ts` | 1,206 | 同一套详情渲染 | `RETIRE-D2` 同上 |

现在动会和视觉基线打架，等知识库视觉重构收口后一起做。

**用户裁定（2026-11-19）**：「等视觉重构时一起做」——D1/D2 不单独排 i18n 切片，随知识库视觉重构（视觉切片 A–Y）一起语义化与双语化。

## 六、里程碑索引（grep 用）

| 编号 | 文件 | 类别 | 状态 |
| --- | --- | --- | --- |
| `RETIRE-A1` | `ui/plan-book-modal.ts` | A 现行实现 | ✅ 已迁移 `bea5dd63` |
| `RETIRE-A2` | `ui/writing-style-modal.ts` | A 现行实现 | ✅ 已迁移 `be319378` |
| `RETIRE-A3` | `ui/monitor-panel-b.ts` | A 常驻视图 | ✅ 已迁移 `65103acd` |
| `RETIRE-B1` | `ui/golden-opening-modal.ts` | B 面板可达 | ✅ 已迁移 `5ba4ad66` |
| `RETIRE-B2` | `ui/write-chapter-modal.ts` | C 隐藏命令 | ✅ 已删除（2026-11-19） |
| `RETIRE-B3` | `ui/novel-tags-modal.ts` | B 面板可达 | ✅ 已迁移 `676990e4` |
| `RETIRE-B4` | `ui/ai-builder-modal.ts` | B 面板可达 | ✅ 已迁移 `efab8126` |
| `RETIRE-B5` | `ui/add-fanfic-setting-modal.ts` | B 面板可达 | ✅ 已迁移 `073ebfe1` |
| `RETIRE-B6` | `ui/pre-research-modal.ts` | B 面板可达（四入口） | ✅ 已迁移 `3290aa0c` |
| `RETIRE-B7` | `ui/batch-chapters-modal.ts` | C 隐藏命令 | ✅ 已删除（2026-11-19） |
| `RETIRE-B8` | `ui/auto-writer-modal.ts` | C 隐藏命令 | ✅ 已删除（2026-11-19） |
| `RETIRE-D1` | `ui/knowledge-detail-modal.ts` | D 视觉耦合 | ⏳ 等 Slice A–Y（用户 2026-11-19：随视觉重构一起做） |
| `RETIRE-D2` | `ui/views/book-detail-renderer.ts` | D 视觉耦合 | ⏳ 同上 |

## 七、这批迁移的数字（实测）

| 文件 | 迁移键数 | 提交 |
| --- | --- | --- |
| plan-book-modal | 61 | `bea5dd63` |
| writing-style-modal | 54 | `be319378` |
| monitor-panel-b | 126 | `65103acd` |
| golden-opening-modal | 111 | `5ba4ad66` |
| novel-tags-modal | 11 | `676990e4` |
| ai-builder-modal | 62 | `efab8126` |
| add-fanfic-setting-modal | 44 | `073ebfe1` |
| pre-research-modal | 99 | `3290aa0c` |
| **合计** | **568** | 8 个提交 |

ui 中文棘轮：**8,564 → 7,943 条**（−621，含三元表达式与短串的连带收益）。
资源：zh/en 各 **3,411 → 3,972 条**（+561）。

## 八、C 类删除记录（2026-11-19）

用户明确同意（m16614）后按「整链删除」执行，不留半套：

| 层 | 改动 |
| --- | --- |
| 命令 id | `shared/command-ids.ts` 删 `WRITE_CHAPTER` / `WRITE_CHAPTER_AUTO` / `BATCH_CHAPTERS` / `AUTO_WRITER` |
| 定义表 | `core/command-registry.ts` 删 4 条 `internalOnly` 定义（含「以下 4 个旧版正文生成命令」注释）与 `uiCommandIds` 4 项 |
| 模式规则 | `shared/command-mode-rules.ts` 删 4 条 `LONG_ONLY` 与 `COMMAND_MODE_LABELS` 的「批量写正文」 |
| 执行器 | `ui/command-ui-executor.ts` 删 3 个 import、4 个 `case`、`warnLegacyCommand()` 与 `legacyCommandWarned` 字段（删完即孤儿） |
| 入口 | `main.ts` 删 3 个死 import |
| 文件 | `git rm` 三个模态（851 / 340 / 236 行） |
| 快捷工具目录 | `domains/long/tool-catalog.ts` 删「📦 旧版工具」整组（3 个按钮指向已删命令，点了无执行体）；`tool-catalog-contract.test.ts` 的「每个 commandId 都有后端定义」因此才恢复通过；`workbench-home-wiring.test.ts` 的 C1 断言改为「整组已删除」 |
| i18n 资源 | 删 `toolCatalog.long.group.legacyTools` 与 `toolCatalog.long.tool.{writeChapter,autoWriter,batchChapters}(Desc)?` 共 7 键 × 2 语言 |
| 契约测试 | `command-registry.test.ts` 期望集合 65→61；`command-ui-executor-guards.test.ts` 去掉去重用例；`chapter-generation-unify.test.ts`、`write-chapter-settlement-status.test.ts` 整文件删除；`perf-contracts` / `settlement-artifacts` / `settlement-coordinator` / `settlement-partial-failure` / `data-consistency-r3d` 里读取这三个源码的断言改为只断言存活入口 |

**实机复核**（2026-11-19）：开发 vault 打开工作台右栏快捷工具，分组为「✍️ Core writing / 📋 Project planning / 📝 Chapter generation / 🌍 Settings & entities / 🔍 Review & optimization / 🔧 Tools & maintenance」六组，
「📦 旧版工具」整组消失、页面无「（旧）」字样，截图 `D:\nw-dev-vault\_visual-qt\quick-tools.png`（未入库），脚本 `D:\nw-tmp\snap-qt.mjs`。

**复核口径**：删的是「命令是否注册」这一层，不是「代码好不好」；`BATCH_NOVELS`（📚 批量生成章节（正式流程））
与协同写作工作台分别承接批量与单章正文，功能面无缺口。

**教训（第二批）**：preflight 首跑只剩 `tool-catalog-contract` 一处失败——「命令不在 Ctrl+P 面板 = 用户点不到」这个判据
漏了**快捷工具目录**这一层：目录里的按钮是独立于命令注册的用户可见入口。删命令时必须同时扫
`commandId` 的消费方（tool-catalog、快捷键、向导步骤、自动化脚本），否则删完就是死按钮。

**教训**：源码文本契约测试（`read('ui/xxx.ts')`）会在删除文件时集体爆红，删文件前先 `grep` 一遍
`read('<file>')` 与裸文件名，比删完再修便宜。

## 九、常驻视图退役：协同写作悬浮面板（2026-11-20，用户裁定）

里程碑 `RETIRE-V1`。

| 文件 | 注册点 | 判断 | 结局 |
| --- | --- | --- | --- |
| `ui/co-write-floating-panel.ts`（1058 行，`VIEW_TYPE_FLOAT_COWRITE = "nw-float-cowrite"`） | `ui/workspace-manager.ts:9/17/42`（`registerView`） | 只注册、无 `setViewState`、无命令、无目录入口；`workspace-manager.ts:65` 注释写明主写作区统一用协同写作视图避免双入口 | **2026-11-20 删除**（视图类 + 注册 + 样式 + 契约测试 + i18n 待迁登记） |

为什么按「视图」而不是「弹窗」判断：它不走命令面板，唯一的可达路径是 Obsidian 恢复旧工作区布局里的 leaf。`getLeavesOfType(VIEW_TYPE_FLOAT_COWRITE)` 全仓零处，等于连自动化入口都没有。

退役面（本批已清）：

1. `ui/co-write-floating-panel.ts` 与 `tests/unit/ui/co-write-floating-panel-contract.test.ts` 删除。
2. `ui/workspace-manager.ts`：import、`FLOAT_VIEW_TYPES` 成员、`registerView` 片段移除（`FLOAT_VIEW_TYPES` 仍用于 `closeAll`）。
3. `styles-src/05-floating-panels-and-settings.css` 的 `.nw-float-cowrite-root` 四条规则删除；`styles-src/04-workspace-layers.css` 里只为它加的 `.nw-cowrite-control-state--dirty` 修饰类删除（基类 `.nw-cowrite-control-state` 由主视图 metrics/control panel 使用，保留）。
4. `scripts/audit-cjk.mjs` 的 MANUAL 待迁登记移除；`tests/unit/ui/modal-guard-wiring.test.ts` 里针对该文件的接线断言随文件删除（plan-book / add-fanfic 两条保留）。
5. 文档：`docs/modules/co-writing.md`（代码入口与 E-13）、`docs/audits/2026-11-20-interaction-and-module-flow.md` §5.4、本轮 next-focus 记录。

**用户裁定原文（m24178）**：「判断旧入口退役。同时，直接在dsh修改，暂时不派给zcode」。

**对已交付 P0 #2 的处理**：ZC-26 在该文件上做的自动保存与 `SaveState` 接入随文件一并删除；`SaveState` / `saveStateLabel` / `isDirtySaveState` 仍被主视图（`ui/co-writing-view.ts:3358-3363`、`ui/co-writing/dashboard-status.ts:98`）使用，不删。


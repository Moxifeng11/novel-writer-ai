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

## 四、C 类：`internalOnly` 隐藏命令，**不迁，删除候选**（3 个弹窗 / 4 条命令）

`core/command-registry.ts:113-116` + `:288` 过滤 + `command-ui-executor.ts:346/356/394/398` 的
`warnLegacyCommand` 共同证明：这些命令**不在面板**，用户点不到。

| 文件 | 命令 id | 判定依据 | 里程碑 |
| --- | --- | --- | --- |
| `ui/write-chapter-modal.ts` | `WRITE_CHAPTER` / `WRITE_CHAPTER_AUTO` | `internalOnly: true`；注释写明「正文统一走 CoWriterEngine」 | `RETIRE-B2` **隐藏命令·删除候选，不迁** |
| `ui/batch-chapters-modal.ts` | `BATCH_CHAPTERS` | `internalOnly: true`；公开的正式流程是 `BATCH_NOVELS` | `RETIRE-B7` **隐藏命令·删除候选，不迁** |
| `ui/auto-writer-modal.ts` | `AUTO_WRITER` | `internalOnly: true`；`warnLegacyCommand('自动写作器〔旧〕')` | `RETIRE-B8` **隐藏命令·删除候选，不迁** |

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

## 五、D 类：与知识库视觉重构耦合（2 个文件）

| 文件 | 中文字面量 | 说明 | 里程碑 |
| --- | --- | --- | --- |
| `ui/knowledge-detail-modal.ts` | 1,035 | 设置页「知识库」分区打开书籍详情 | `RETIRE-D1` 等视觉重构 Slice A–Y 走完 |
| `ui/views/book-detail-renderer.ts` | 1,206 | 同一套详情渲染 | `RETIRE-D2` 同上 |

现在动会和视觉基线打架，等知识库视觉重构收口后一起做。

## 六、里程碑索引（grep 用）

| 编号 | 文件 | 类别 | 状态 |
| --- | --- | --- | --- |
| `RETIRE-A1` | `ui/plan-book-modal.ts` | A 现行实现 | ✅ 已迁移 `bea5dd63` |
| `RETIRE-A2` | `ui/writing-style-modal.ts` | A 现行实现 | ✅ 已迁移 `be319378` |
| `RETIRE-A3` | `ui/monitor-panel-b.ts` | A 常驻视图 | ✅ 已迁移 `65103acd` |
| `RETIRE-B1` | `ui/golden-opening-modal.ts` | B 面板可达 | ✅ 已迁移 `5ba4ad66` |
| `RETIRE-B2` | `ui/write-chapter-modal.ts` | C 隐藏命令 | ⏳ 删除候选，不迁 |
| `RETIRE-B3` | `ui/novel-tags-modal.ts` | B 面板可达 | ✅ 已迁移 `676990e4` |
| `RETIRE-B4` | `ui/ai-builder-modal.ts` | B 面板可达 | ✅ 已迁移 `efab8126` |
| `RETIRE-B5` | `ui/add-fanfic-setting-modal.ts` | B 面板可达 | ✅ 已迁移 `073ebfe1` |
| `RETIRE-B6` | `ui/pre-research-modal.ts` | B 面板可达（四入口） | ✅ 已迁移 `3290aa0c` |
| `RETIRE-B7` | `ui/batch-chapters-modal.ts` | C 隐藏命令 | ⏳ 删除候选，不迁（v2 新增） |
| `RETIRE-B8` | `ui/auto-writer-modal.ts` | C 隐藏命令 | ⏳ 删除候选，不迁（v2 新增） |
| `RETIRE-D1` | `ui/knowledge-detail-modal.ts` | D 视觉耦合 | ⏳ 等 Slice A–Y |
| `RETIRE-D2` | `ui/views/book-detail-renderer.ts` | D 视觉耦合 | ⏳ 等 Slice A–Y |

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

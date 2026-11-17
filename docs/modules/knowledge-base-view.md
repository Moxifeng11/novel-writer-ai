# 知识库主视图（拆解任务页 · 底部监控条）

> 状态：stable　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- 用户视角：知识库管理界面的主视图——左侧书架列表（分类/排序/搜索），右侧页签（概览 / 题材配置 / 拆解任务），底部常驻监控条（拆解进度、向量模型连接状态、设置入口）。
- 代码入口：\`ui/views/knowledge-base-view.ts\`（3267 行，\`ItemView\` 子类）、\`ui/views/kb-task-panel.ts\`（统计卡 \`computeTaskStats\` + 徽标档位 \`resolveTaskStatusTone\`）。
- 打开方式：命令面板 / \`plugin.openKnowledgeBaseView()\`；视图类型 \`novel-writer-knowledge-base\`。
- 相关数据：\`plugin.deconstructionScheduler\`（任务表 + 事件发射器）、\`plugin.knowledgeBaseManager\`（\`getGenresByCategory\` 等）、settings 的 \`vectorProvider*\` / \`vectorOllamaModel\` / \`vectorConnectionStatus\`。
- 样式：\`styles-src/27-knowledge-base.css\`（Slice P 新增段落从 \`:2489\` 起，约 396 行）。

## 2. 现状（事实，不写愿望）

- 渲染流程：\`renderLeftSidebar()\` 画书架 → \`renderRightPanel()\` 按 \`activeMainTab\`（\`overview | config | tasks\`）分发 → \`renderMonitorBar()\` 画底部条。任务页 \`renderTasksTab()\` 从 \`deconstructionScheduler.getAllTasks()\` 取任务，逐个 \`renderTaskCard()\`；进度数值来自 \`getTaskEmitter(id).getState()\`，运行中任务的实时进度来自视图持有的 \`latestProgress\`（\`onProgress\` 订阅写入）。
- 数据存在哪：任务表在 scheduler 内存中（\`tasks\` 字段），不含 UI 状态；UI 侧状态只有 \`activeMainTab\`、\`taskFilter\`、\`selectedTaskIds\`、\`latestProgress\`。重载视图后任务列表从 scheduler 重建，选中态属临时态会清空。
- 书架头有两份实现：\`ui/views/knowledge-base-view.ts:1311-1318\`（\`renderBooksListContent\`）与 \`:1343-1361\` 的增量刷新路径，都写 \`nw-kb-book-list-header\` / \`nw-kb-book-list-count\`，内容一致但代码重复。
- 历史包袱：Slice P 之前，任务页与监控条靠 \`nw-u-*\` 工具类串 + 内联 \`style\` 拼装，配色直接写死在 TS 里（统计卡 \`color\` 串、状态徽标 \`TASK_STATUS_TONE_STYLES\`），主题变量接管不了。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| P-01 | P1 | \`ui/views/knowledge-base-view.ts\` 175 处 \`nw-u-*\`（集中在 50 行），9 处真内联 \`style\`；另 2 处 \`style: '风格'\` 属数据字段不是样式 | 全部换 \`nw-kb-tasks-*\` / \`nw-kb-monitor-*\` 语义类，内联归零 | done |
| P-02 | P1 | 统计卡配色由 \`computeTaskStats\` 返回内联 \`color\` 串（\`var(--interactive-accent)\`、\`#3b82f6\` 等），主题无法覆盖 | 改为 \`tone\` 档位枚举，配色留在 CSS 修饰类 | done |
| P-03 | P2 | 两处进度条用内联 \`style\` 拼宽度百分比 | 改 CSS 变量 \`--nw-kb-pct\`，规则写 \`width: var(--nw-kb-pct, 0%)\` | done |
| P-04 | P2 | 任务卡选中态、状态徽标、连接圆点、设置按钮全靠内联串 | 改修饰类（\`--selected\` / \`--success\` \`--info\` \`--danger\` \`--warning\` \`--muted\` / \`--connected\` \`--disconnected\` \`--idle\` / \`disabled\`） | done |
| P-05 | P3 | 书架头两份重复实现 | 合并为单一渲染函数 | open |

## 4. 关键决策

- 2026-11-17 Slice P：命名空间沿用 \`nw-kb-*\`（同一视图同一份 CSS 27 号文件），任务页 \`nw-kb-tasks-\`、监控条 \`nw-kb-monitor-\`、徽标 \`nw-kb-task-status--<tone>\`；没有另建 \`35-*.css\`，避免同一视图样式散落两处。
- 2026-11-17 Slice P：**颜色不复用 \`--nw-*\` 语义 token**。首轮把统计卡/徽标接上 \`var(--nw-warning)\` 等后，\`tasks-list\` 截图差 0.41%（maxDelta 99）：本主题下那组 token 已被调成弱化色（\`--nw-warning\` 实际 rgb(212,167,106) 而非原内联 #f59e0b、\`--nw-success\` rgb(122,171,142) 而非 #2ecc71、\`--nw-danger\` rgb(212,120,120) 而非 #e74c3c）。改为 \`rgb()\` 字面值逐条复刻后 6 场景全 0。
- 2026-11-17 Slice P：\`TaskStatItem.color: string\` → \`tone: TaskStatTone = 'accent' | 'info' | 'warning' | 'success' | 'danger' | 'muted'\`（类型在 \`ui/views/kb-task-panel.ts\` 导出），单测断言随之从颜色串改为档位数组。
- 2026-11-17 Slice P：进度条宽度走 CSS 变量 \`--nw-kb-pct\`（\`el.style.setProperty('--nw-kb-pct', '42%')\`），与仓内先例 \`ui/batch-import-modal.ts:784\` 的 \`--nw-bi-pct\` 同法；既不写内联宽高，也不做 \`setCssStyles\`。
- 2026-11-17 Slice P：长工具类串直接复用既有语义类，不再新造：\`nw-kb-select\`（下拉，声明与原 6 个工具类等价）、\`nw-kb-book-list-header\` / \`nw-kb-book-list-count\`（书架头）、\`nw-text-sm-muted\`（12px 弱化）、\`nw-btn\` / \`nw-btn-secondary\` / \`nw-btn-danger\` / \`nw-btn-sm\`（按钮）。
- 2026-11-17 Slice P：同批删除 14 个零引用工具类定义（定义 230→216、引用 1334→1159）；\`.nw-kb-tasks-tab\` 这类既有外壳类名保留，因为 \`tests/e2e/obsidian-plugin.spec.ts:1499\` 依赖它。
- 2026-11-17 Slice P：\`transition\` 逐个属性写（\`border-color\` / \`box-shadow\` / \`background-color\`），因为 \`tests/unit/ui/panel-resizer-and-motion.test.ts:108\` 硬断言 \`styles.css\` 不含「一次性补间全部属性」的写法（连注释里都不能出现该字面串）。

## 5. 验收记录

before/after 各 6 场景，viewport 1400×1000，截图元素 \`.nw-kb-tasks-tab\`（756 宽）与 \`.nw-kb-monitor-bar\`（756×48）；产物 \`D:\nw-dev-vault\_visual-p\{before,after}\`（未入库）+ \`diff-report.json\`。

| 场景 | PNG 差异 | 覆盖内容 |
| --- | --- | --- |
| tasks-empty | 0 px | 空态 |
| tasks-list | 0 px | 5 张任务卡（运行/等待/完成/失败/取消）+ 统计卡 + 工具栏 + 选中态 |
| tasks-filter | 0 px | 筛选=失败 |
| monitor-running | 0 px | 运行中 + 排队 2 |
| monitor-paused | 0 px | 已暂停 |
| monitor-idle | 0 px | 无任务 |

- 探针（35 个 computed style 键）：6 场景 style 差全 0；\`rect\` 按「tag+文本+字号+字重」重新配对后 6 场景 0 位移（原始按索引的 rect 差是伪差——统计卡 6 个数值 div 与 5 个状态徽标在改前无 class、不被 \`[class]\` 选择器采集，改后有了类才进样本，共 +12 个元素）。
- 等价性来自「声明级复刻」：例如 \`.nw-kb-tasks-stat\` = \`padding:12px 8px;background:var(--background-secondary);border-radius:6px;text-align:center\`，对应旧串 \`nw-u-p-12px-8px nw-u-bg-background-secondary nw-u-brd-6px nw-u-ta-cent\`。
- 门禁：\`check:utility\` 216 定义 / 0 零引用 / 1159 次；\`check:css\` bytes 737042、uniqueClasses 4058、rgbHsl 211；\`check:bundle\` main.js 5643714、styles.css 737042；\`check:inline-styles\` 通过；\`npm run test\` 959 文件 / 10114 通过。

## 6. 测试清单

- 纯逻辑：\`tests/unit/ui/kb-task-panel.test.ts\`（33 条；\`computeTaskStats\` 的六档 \`tone\` 断言在本切片由颜色串改档位）
- UI/DOM：任务页渲染由 e2e 覆盖——\`tests/e2e/obsidian-plugin.spec.ts:1499\` 用 \`.nw-kb-tasks-tab\` 判存在
- 回归：样式门禁 \`tests/unit/ui/panel-resizer-and-motion.test.ts\`（禁全局补间字面串）
- 截图回归：\`D:\nw-tmp\snap-p.mjs\`（\`--tag=before|after\`）+ \`D:\nw-tmp\diff-p.mjs\`（PNG 逐像素 + probes）
- 实机：reload 后检查 默认（无任务）/ 有任务 / 筛选 / 运行中（进度+排队） / 已暂停 / 空闲；无数据迁移

## 7. 剩余 backlog（P2/P3）

- [ ] P-05 合并书架头两份实现（\`renderBooksListContent\` 与增量刷新路径）
- [ ] 任务页可拆到 \`ui/views/kb-tasks-page.ts\`（视图 3267 行，\`renderTasksTab\` 约 290 行）
- [ ] 监控条 \`nw-kb-monitor-*\` 与面板 B 的 \`nw-monb-*\` 命名口径统一（一个叫 monitor bar、一个叫 monitor panel b，容易混）
- [ ] 时间/耗时格式化抽到 \`shared/\`（当前视图内联 \`formatDuration\` 逻辑）

## 8. 交接备注

- 下一轮建议：\`ui/polish-editor.ts\`（104 处）或 \`ui/views/kb-stats-panel.ts\`（81 处，与本文档同属知识库族，可顺手统一 \`nw-u-*\`）。
- 坑 1（工具链）：before/after 两轮之间**不要用 \`git stash\`**——\`npm run build\` 会重写 tracked 的 \`styles.css\`，\`git stash pop\` 直接冲突（\`error: Your local changes to the following files would be overwritten by merge: styles.css\`）。补救顺序：\`git checkout -- styles.css\` 再 pop；更稳是用 \`git worktree\` 取 HEAD 构建。
- 坑 2（配色）：改前内联色一律用 \`rgb()\` 字面值复刻，别顺手换成 \`--nw-*\` 语义 token——那组 token 在本主题已被调淡，换上会掉 0.4% 像素。
- 坑 3（探针）：\`[class]\` 选择器采集不到改前无 class 的元素，after 侧会多出样本，按索引配对的 \`struct/rect\` 差会暴涨；判真位移要按内容键重配。
- 坑 4（进度来源）：任务进度有两处入口（\`emitter.getState()\` 与 \`latestProgress\`），设 \`--nw-kb-pct\` 时两处都要覆盖，漏一处会出现 0% 的假进度条。

# 质量统计面板（kb-stats-panel）

> 状态：stable（视觉重构 Slice X 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：知识库右侧「质量统计」页签 —— 顶部 4 张概览卡（书籍总数 / 已拆解 / 拆解中 / 平均质量分），其下三段：「各维度质量分布」（平均质量雷达图 + 12 维平均分横条）、「题材分布」（Top 10 柱状图，无数据时显示「暂无题材数据」）、「拆解状态分布」（状态环图 + 状态清单）。
- **代码入口**
  - `ui/views/kb-stats-panel.ts`（130 行，LF 行尾）。唯一导出 `export function buildKbStatsPanel(rightContentEl: HTMLElement, host: KbStatsPanelHost): void`（`:48`）。
  - `KbStatsPanelHost`（`:30`）：`allBooks: BookBasicInfo[]`、`renderChart(container, svgHtml)`、`getGenreName(genreId?)`。
  - 挂载点：`ui/views/knowledge-base-view.ts:24` 引入，`:2813` 在 `renderStatsTab()`（`:2809` 注释）里调用，图表挂载与题材命名由视图注入。
  - 纯逻辑层：`ui/views/kb-panels-logic.ts`（概览卡 `buildStatsOverviewCards` `:250`、题材柱状 `buildGenreBarData` `:303`、状态环图 `buildStatusDonutData` `:335`、状态清单 `buildStatusLegendData` `:349`、状态配色 `KB_STATUS_STYLES` `:88`）。
- **数据来源**：`host.allBooks`（`BookBasicInfo[]`，构建期只读快照）；质量分取已完成拆解书的 `qualityScores`；题材名走 `host.getGenreName`（题材不存在时回退 id，知识库未就绪时返回「未分类」）。不落盘、无自有状态。
- **样式**：`styles-src/27-knowledge-base.css` 末尾「质量统计面板：Slice X」段（192 行，文件现 3324 行 / 71965 字节）。**不新建样式文件**——与 Slice S 同理，同一模块不拆两套前缀。

## 2. 现状（事实，不写愿望）

- **根**：`rightContentEl.empty()` 后 `createDiv({ cls: 'nw-ks-panel' })`（`:51`，padding 16 / overflow-y auto / height 100%）。原根类是 `nw-kb-stats-tab nw-u-p-16px nw-u-ovy-auto nw-u-h-100`，其中 `nw-kb-stats-tab` 在 CSS 里**零定义**（死类）。
- **概览**（`:57-67`）：`nw-ks-overview`（grid / `repeat(4, 1fr)` / gap 12 / mb 24）→ 4 × `nw-ks-overview-card`（p20 / bg secondary / radius 8 / 居中），卡内 `-overview-icon`(28px) / `-overview-value--{tone}`(24px / 700) / `nw-text-sm-muted`（label，沿用既有外壳类）。
- **四张卡的档位**（`kb-panels-logic.ts:250` 起）：`accent`（书籍总数，`var(--interactive-accent)`）/ `success`（已拆解，`#2ecc71`）/ `info`（拆解中，`#3b82f6`）/ `warning`（平均质量分，`#f59e0b`）。
- **各维度质量分布**（`:69-93`，仅当有已完成拆解书时渲染）：`nw-ks-section` + `-section-title`(h3) → `-chart-row`（flex / gap 24 / wrap / 居中）→ `-chart-card--radar`(min-width 280 / 居中，挂 `radarChart`) + `-chart-card`(flex 1 / min-width 200)，后者逐维 `-avg-item` > `-avg-top`(`-avg-label` + `-avg-score`) + `-bar` > `-bar-fill`。
- **题材分布**（`:95-105`）：有数据时 `nw-ks-bar-chart`（flex / 居中）挂 `barChart`(500×300)，否则 `nw-ks-empty`（居中 / p40 / muted）显示「暂无题材数据」。
- **拆解状态分布**（`:107-129`）：`-chart-row` → `-chart-card--centered`（有状态数据时挂 `donutChart` 220px）+ `-chart-card` 状态清单；每行 `-legend-row`（flex / space-between / padding 10px 0 / border-bottom）> `-legend-left`（flex / center / gap 8 / `-legend-dot--{status}` 10×10 圆点 + `-legend-label`）+ `-legend-value`。
- **状态五态**：`pending`(`#f59e0b`) / `processing`(`#3b82f6`) / `completed`(`#2ecc71`) / `failed`(`#e74c3c`) / `interrupted`(`#f97316`)，环图配色仍由 `KB_STATUS_STYLES` 提供，图例圆点改走修饰类。
- **进度条**：`fill.style.setProperty('--nw-ks-pct', …)`（`:91`，值为 `avg + '%'`），CSS `.nw-ks-bar-fill{ width: var(--nw-ks-pct, 0%) }`；JS 不再写 `style.width`。
- **历史包袱（Slice X 处理前）**：81 处 `nw-u-*` 工具类 + 4 处内联样式（四条 `fill.style.width`、概览卡 4 个裸色 `color`、图例圆点 `background: item.color`、图例行 `&:last-child` 非法声明）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| KS-01 | P0 | 81 处 `nw-u-*` 拼出整页排版，语义不可读；根类 `nw-kb-stats-tab` 是 CSS 零定义死类 | `nw-ks-*` 语义类追加到 `27-knowledge-base.css`，根类改 `nw-ks-panel` | done（Slice X） |
| KS-02 | P1 | 概览卡颜色是 JS 里的裸色值（`var(--interactive-accent)` / `#2ecc71` / `#3b82f6` / `#f59e0b`） | `KbStatsOverviewCard.color` → `tone: KbStatsTone`，改 `--{tone}` 修饰类 | done（Slice X） |
| KS-03 | P1 | 图例圆点用 `background: ${item.color}` 内联 | `buildStatusLegendData` 增 `status: KbStatusKey`，圆点改 `--{status}` 修饰类 | done（Slice X） |
| KS-04 | P1 | 四条平均分进度条用 `fill.style.width = avg + '%'` | 改 CSS 变量 `--nw-ks-pct`（与 `--nw-bi-pct` / `--nw-cp-pct` / `--nw-rf-pct` 同套路） | done（Slice X） |
| KS-05 | P2 | 图例行内联里的 `&:last-child{border-bottom:none}` 在 style 属性中非法，被浏览器丢弃 —— 每行其实都有下边框 | 新 CSS 不加 `:last-child` 规则，按**实际渲染**复刻 | done（Slice X） |

## 4. 关键决策

- **2026-11-17 前缀取 `nw-ks-*`**：全仓零碰撞（`nw-kb-*` 已被知识库外壳占满），短且能自解释为 kb-stats。
- **2026-11-17 不新建样式文件**：与 Slice S 同理，20 号以后的样式文件已到 40 号，同一知识库模块再开 `41-kb-stats.css` 会让「知识库」横跨三个命名空间；直接追加到 `27-knowledge-base.css` 的 Slice X 段。
- **2026-11-17 配色从「色值」改「档位」**：概览卡原来把 `color` 直接写进 JS 常量，图例又把 `color` 写进内联 `background`；改成 `tone` / `status` 枚举后，颜色只存在于 CSS，主题变量（`--interactive-accent`）能跟着主题切换。**注意 `KB_STATUS_STYLES` 的 `color` 字段保留**——环图 SVG 由逻辑层直接消费，不经过 CSS。
- **2026-11-17 进度条走 CSS 变量**：保留 `bar-fill` 元素与 `setProperty` 写法，CSS 默认 `0%`；比 `style.width` 的好处是宽度可被主题/紧凑模式覆盖，且 JS 侧零内联。
- **2026-11-17 按实际渲染复刻 `:last-child`**：旧内联把 `&:last-child` 塞进 style 属性，浏览器整条丢弃 → 原来每行都有下边框。新 CSS **刻意不补** `:last-child`（补了会让最后一行少 1px 边框，产生像素差异）。这是「不要顺手修旧 bug」的典型：等价优先。
- **2026-11-17 标签 label 继续用 `nw-text-sm-muted`**：`styles.css` 里已有等价定义（12px muted），属于仍在用的外壳类，不纳入本轮改名范围。

## 5. 验收记录

| 日期 | 项 | 结果 |
| --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` | EXIT 0 |
| 2026-11-17 | `npm run build` | `[styles] 拼接 46 个源文件 → styles.css（31493 行）`；esbuild v4.96.1 成功 |
| 2026-11-17 | 单测 | `npx vitest run tests/unit/ui/kb-stats-panel.test.ts tests/unit/ui/kb-panels-logic.test.ts` → 2 files / 29 通过 |
| 2026-11-17 | 像素（5 场景 before/after） | PNG **5/5 = 0 px**；probes struct 0 / style 0 / rect 0（仅 cls 改名） |
| 2026-11-17 | 门禁 | `check:inline-styles` 530→**526**；`check:utility` 75/270→**55/189**（零引用 0）；`check:css` bytes **784775** / uniqueClasses **4263** / hex **192** / rgbHsl 223；`check:bundle` main.js **5625961** / styles.css **784775** |
| 2026-11-17 | `npm run preflight` | EXIT=0（见 §8 与交接快照） |

## 6. 测试清单

- `tests/unit/ui/kb-stats-panel.test.ts`：DOM 结构断言（根类 `nw-ks-panel`、概览格 `nw-ks-overview`、图例数值 `nw-ks-legend-value`、空态文案、图表挂载调用次数）。
- `tests/unit/ui/kb-panels-logic.test.ts`：纯逻辑（概览四卡数值与档位、维度平均、题材柱状排序、状态计数与环图数据；`:233` 仍断言 `KB_STATUS_STYLES` 的 5 个 hex）。
- `tests/e2e/obsidian-plugin.spec.ts:1505`：E2E 里点进统计页签时用 `.nw-ks-panel` 定位（Slice X 同步改名）。
- 实机检查点：概览四卡配色随主题（accent 卡必须跟着主题变色）、雷达图 + 12 条横条对齐、题材空态、状态清单五色圆点、最后一行保留下边框。

## 7. 剩余 backlog（P2/P3）

- [ ] `nw-ks-overview` 写死 `repeat(4, 1fr)`，窄右栏（<640px）会挤压；可改 `repeat(auto-fit, minmax(140px, 1fr))`（会改变布局，需单独验收）。
- [ ] 概览卡 icon 用 emoji 文本（28px），不同平台字形宽度不一，可改 SVG。
- [ ] 状态清单无交互（不能点「失败」筛选书单）；`nw-ks-legend-row` 未加 `cursor`，与「看起来可点」的预期不符。
- [ ] 图表尺寸（雷达 280 / 柱状 500×300 / 环图 220）散落在视图层，可提到 `kb-panels-logic` 的常量表。
- [ ] `buildKbStatsPanel` 每次重建整页（含三张 SVG），书籍多时无谓重绘；可只重绘变化段落。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户只剩 `ui/settings/deconstruction-section.ts`（47 处），即 Slice Y。之后按「碰哪改哪」。
- **已知坑（本轮新踩）**
  1. **基线 note 的 argv 形态**：`scripts/check-css.js:80` 与 `scripts/check-bundle.mjs:54` 都是 `process.argv.indexOf('--note')` + 下一个 argv；PowerShell 里必须写 `--note "文本"`，写成 `--note="文本"` 会被当成单 token 而静默写默认文案（第一次就踩了）。`check-inline-styles.mjs` 根本不支持 note。
  2. **算零引用要排除定义文件**：自己写脚本扫「零引用工具类」时，若把 `styles-src/10-entity-and-utilities.css` 也算进搜索文本，定义会自己命中自己，得到 `defs 162 / zero 0` 的假结果；且必须排除 `tests/`（那里有「断言某类不存在」的用例）。`scripts/check-utility-classes.mjs` 的 D 项口径就是这样。
  3. **DeferredView 兜底**：E2E / 截图脚本里 `app.workspace.getLeavesOfType('novel-writer-knowledge-base')[0].view` 可能是空壳，要循环 `await leaf.loadIfDeferred()` 直到 `leaf.view.bookDetailRenderer` 存在。
  4. **宿主高度要靠内容撑开**：截图宿主若不设 height，`.nw-ks-panel{height:100%}` 会解析成 auto（这正是我们要的「内容多高就多高」），否则只能截到首屏。
- **仓外临时脚本（勿提交）**：`D:\nw-tmp\snap-x.mjs`（before/after 采集，`--tag=`）、`D:\nw-tmp\diff-x.mjs`（PNG + 探针对比，ROOT=`D:/nw-dev-vault/_visual-x`）。before 侧要从 `6c5cc8c1` 的 worktree 构建并在源码末尾补 `// TEMP-SNAP-HOOK`（`window.__nwKbStats`），截完必须删钩子重建。
- **dev vault**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 是**真实目录**（不是 junction），每轮截图前手工 `Copy-Item main.js,styles.css` 过去。

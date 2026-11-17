# 监控面板 B（完成度 / 偏离 / 质量）

> 状态：stable（视觉重构 Slice K 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：写作时的实时质量看板——三块卡片分别回答「这章写到哪了（完成度）」「有没有跑偏（偏离）」
  「文字质量如何（评分/等级/建议）」，另有结算卡。卡片可展开详情看维度明细、图表与历史。
- **代码入口**
  - 面板本体：`ui/monitor-panel-b.ts`（`MonitorPanelB extends DraggablePanel`，panelId `monitor-b`，
    标题「监控面板B · 完成度/偏离/质量/结算」，层 `layers`；视图类型 `VIEW_TYPE_MONITOR_B = "nw-float-monitor-b"`）
  - 装配：`ui/workspace-manager.ts`（`(leaf) => new MonitorPanelB(leaf, this.plugin)`）；
    `ui/co-writing-view.ts` 通过 `workspaceManager.getMonitorPanelB()` 注入项目名
  - 浮窗基类：`ui/draggable-panel.ts`（给根节点加 `nw-float-panel`、`nw-float-<panelId>`，正文容器 `nw-float-container`）
  - 引擎：`engine/plot-completion-engine.ts`、`engine/plot-divergence-engine.ts`、`engine/writing-quality-engine.ts`
    （`engine/quality/quality-engine-factory.ts` 负责构造）
  - 历史持久化：`services/quality-history-store.ts`（`loadQualityHistory` / `appendQualityHistory` / `writeQualityHistory`，
    路径 `qualityHistoryPath(project)`）、`shared/quality-history.ts`（`mergeQualityHistory`、
    `aggregateQualityHistoryByChapter`、`computeChapterTrend`、`normalizeChapterKey`、`isQualitySampleUsable`）
  - 样式：`styles-src/31-monitor-panel-b.css`（Slice K 新增，命名空间 `nw-monb-*`）
- **相关数据**：每本书一份质量历史 JSON；内存里 `baselineHistory`（按章收敛，上限
  `QUALITY_HISTORY_MAX_RECORDS` = 200 章）与 `qualityHistory`（展示用，仅 `maxQualityHistory` = 20 条）。

## 2. 现状（事实，不写愿望）

- `renderBody(container)` 渲染三张卡片；每张卡片两种状态：概览（总体进度条 + 维度条 + 摘要）
  与详情（`renderCompletionDetail` / `renderDivergenceDetail` / `renderQualityDetail`，
  含维度明细、建议列表、历史图表）。空态统一走 `renderNoData`（正文过短，`*_MIN_EVALUABLE_CHARS` 门限）。
- **触发**：写作区输入经 `AdaptiveDebounceManager`（`debounceFixed('completion-eval', ...)`）防抖后评估；
  每次评估追加一条历史，节流窗口内最后一条由 `persistQualityHistory(force)` 冲刷磁盘。
- **项目名解析**：一律走 `resolveProject()`（优先级「外部注入 > activeFile」）；协同视图没有 activeFile，
  直接读项目名会取空或串到别的书。
- **样式作用域**：`DraggablePanel` 按 panelId 注入 `.nw-float-monitor-b`，所以
  `styles-src/31-monitor-panel-b.css` 全部选择器加 `.nw-float-monitor-b ` 前缀拿到 (0,2,0)，
  不需要额外命名空间容器（对比 `.nw-scope` 用于弹窗）。
- 历史包袱：本文件原有 232 处 `nw-u-*` 工具类 + 18 处内联样式字符串；
  颜色/宽度当时是行内写死的（`background:${color}`、`width:${pct}%`）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| MB-01 | P1 | 232 处 `nw-u-*` 工具类拼样式，语义不可读、难维护 | 语义类 `nw-monb-*` | done（Slice K） |
| MB-02 | P1 | 18 处内联 `style` 字符串（进度条颜色/宽度、评分色、优先级徽标） | 颜色/宽度走 CSS 变量 `--nw-monb-tone` / `--nw-monb-pct` | done（Slice K） |
| MB-03 | P1 | `nw-svg-block` 图类与工具类混用 | `nw-monb-chart` | done（Slice K） |
| MB-04 | P2 | 结算卡的裸 `nw-float-card` 与三张卡混用 | 保留外壳类（无声明差异，避免重复定义） | done（Slice K，有意留白） |

## 4. 关键决策

- **2026-11-17（Slice K）**：新开 `nw-monb-*` 命名空间、新增 `styles-src/31-monitor-panel-b.css`，
  选择器统一加 `.nw-float-monitor-b ` 前缀。理由：面板根节点由基类注入该 panelId 类，
  是真实存在的 (0,2,0) 作用域；单类 (0,1,0) 会被 Obsidian 的 `.modal button`/`input[type=text]` 压掉（Slice H 已实证）。
- **带共享色类的站点不声明 color**：`getScoreColorClass()`（`engine/plot-completion-engine.ts`）返回
  `nw-float-ok`/`nw-float-warn-text`/`nw-float-danger`，这些是 (0,1,0)；若语义类也写 `color`，
  (0,2,0) 会把它压掉。故 `-overall-value`、`-dim-value--md`、`-section-score` 不声明颜色，
  只有行内给色的站点才用 `--tone` 变体。
- **动态值用 `setProperty` 而非 `style` 字符串**：`check-inline-styles` 只拦 `style:`/`style="`/
  `setAttribute('style')`，而 CSS 变量能同时满足「零内联」与「按分值着色」。
- **`.nw-monb-card` 有意不定义**：卡片外观完全来自 `.nw-float-card`，新类只作语义钩子；
  同理 `-nodata-hint`、`-dim-value--sm` 源码未用，留空避免冗余声明。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | Slice K 语义化 + 像素校正（12 个场景） | **全部 0 差异**：diffPx=0、高度完全一致、30 个计算属性 × 786 节点零差异 | `D:\nw-dev-vault\_visual-k\{before,after,diff}`（未入库）；`D:\nw-tmp\diff-k.mjs` |
| 2026-11-17 | 门禁 | typecheck / lint / inline-styles / utility / css / bundle / preflight 全绿 | `npx vitest run tests/unit/ui/monitor-panel-b` 8 文件 32 用例通过；preflight EXIT=0 |

场景清单（`diff/summary.json`）：body-empty、completion-summary/-nodata/-detail、divergence-summary/-nodata/-detail、
quality-summary/-nodata/-detail、eval-failure、eval-failure-detail。

## 6. 测试清单

- UI/DOM：`tests/unit/ui/monitor-panel-b-baseline-chapter-level.test.ts`（基线按章收敛）、
  `-close-flush.test.ts`（关闭前冲刷）、`-history-flush.test.ts`（节流窗口内最后一条不丢）、
  `-eval-failure.test.ts`（评估抛错时的降级）、`-notice.test.ts`（提示文案）、
  `-plot-guard.test.ts`（详情面板并发/重入守卫）、`-project-scope.test.ts`（切项目隔离）、
  `-quality-guard.test.ts`（质量评估守卫）
- 动画完整性：`tests/unit/ui/css-animation-integrity.test.ts`
- 回归：`tests/unit/ui/pure-helpers-coverage.test.ts`
- 实机：reload 后检查——三张卡的空态/概览/详情、结算卡、切书后基线是否清空、关闭面板是否落盘。

## 7. 剩余 backlog（P2/P3）

- [ ] 质量历史图表用 `document.createElementNS` 手绘，坐标/刻度常量散在方法里，可抽成纯函数。
- [ ] 详情面板三份 `render*Detail` 结构高度相似，可考虑共用一个「章节 + 建议 + 历史」模板。

## 8. 交接备注

- 三条硬约束（详见 `docs/DEVELOPMENT.md`）：基线样本必须按章收敛（`normalizeChapterKey`）、
  项目名必须由 `setActiveProject` → `resolveProject()` 注入、`onClose` 必须「先冲刷 → 再 `dispose()` → 后 `super.onClose()`」。
- 实机截图在开发 vault（`D:\nw-dev-vault`）进行；面板要用主区 tab 打开
  （`getLeaf('tab').setViewState({ type: 'nw-float-monitor-b' })`），临时 user-data-dir 下
  vault 的 `workspace.json` 可能恢复第二个面板，选择器要取 `[0]`。

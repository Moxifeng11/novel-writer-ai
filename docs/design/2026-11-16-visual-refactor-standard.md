# 视觉重构规范与回归门禁（2026-11-16）

> 适用：按模块推进的视觉重构（utility class 链 → 语义组件类）。
> 核心约束：**命名必须可读可检索，且不允许质量倒退**。

## 1. 命名规范

### 1.1 前缀

所有类必须带项目前缀，二者择一：

| 前缀 | 用途 |
| --- | --- |
| `nw-` | 本项目自有组件（推荐，短） |
| `novel-writer-` | 历史遗留/对外稳定钩子，**新代码不再新增** |

禁止：
- 裸状态类（`is-active` / `is-empty` 等）作为新类名 —— CSS 门禁按前缀统计；
  需要状态时用 `nw-<block>-<state>` 或 `nw-is-<state>`。
- 名字里编码色值/尺寸（`nw-u-c-f59e0b`、`nw-u-p-6px-14px`）——
  换主题/改尺寸时名字立刻说谎。

### 1.2 结构：block / element / modifier

```
nw-<module>-<block>[-<element>][--<modifier>]
nw-kb-book-card
nw-kb-book-card-title
nw-kb-book-card--featured
nw-kb-book-card-cover--missing
```

规则：
1. **module**：模块短名，固定枚举（见 1.3）。
2. **block**：一个能独立命名、可复用的 UI 单元（卡片/工具栏/侧栏）；
   不是「一个 div」。同一屏里多个 div 若没有独立语义，归到父 block 的 element。
3. **element**：block 内部的组成部分，只用一层（不写 `a-b-c-d`）。
4. **modifier**：状态或变体，用 `--` 双横线；与业务状态对应。
5. 一个元素只挂**一个 block 类** + 需要的 element/modifier 类；
   不再用 5~10 个工具类拼布局（工具类仅允许 ≤3 个，且只用于纯排版微调）。

### 1.3 模块短名枚举

| 短名 | 模块 |
| --- | --- |
| `kb-` | 知识库 / 设定 / 人物卡 |
| `fp-` | 文笔指纹库 |
| `wb-` | 写作工作台首页 |
| `cw-` | 协同写作 / 编辑器 |
| `plan-` | 规划 / 大纲 |
| `set-` | 设置框架与各分区 |
| `q-` | 质量闭环 / 审稿 |
| `stats-` | 统计 / 进度 |
| `exp-` | 导出 / 发布 |
| `precheck-` | 发布前文面体检（错别字 / 标点弹窗） |
| `fw-` | 全屏写作视图（体检条等视图内组件） |

新增模块先在这里登记再开工。

### 1.4 CSS 文件组织

- 每个模块一个文件：`styles-src/<NN>-<module>.css`（NN 递增，模块内自上而下按 block 排列）。
- 文件头注释写：模块名、负责的视图/弹窗、本文件不负责什么（避免又变成杂物间）。
- 不允许在 `ui/''` 里写 `style：''`（已有 `check:inline-styles` 门禁）。
- 删除类之前先全局搜索（含 tests、模板、文档）。

## 2. 「不许质量倒退」的可执行定义

重构前后必须同时满足：

| # | 判据 | 工具 |
| --- | --- | --- |
| R1 | DOM 结构不变（节点路径与标签一致） | 视觉基线快照（见 §3） |
| R2 | 元素矩形不变（同宽高下 ±1px） | 视觉基线快照 |
| R3 | 计算样式不变（字体/颜色/间距/边框/圆角/溢出） | 视觉基线快照 |
| R4 | 文本内容与可点击性不变 | 快照里的文本长度 + 交互冒烟 |
| R5 | 既有单测全绿 | `npm run test` |
| R6 | 全部门禁 EXIT=0 | `npm run preflight` |
| R7 | 工具类使用量不增加 | `check:utility`（基线只降不升） |

任何一项变化都必须**显式说明原因**并更新基线，不能默默放过。

## 3. 视觉基线工作流

### 3.1 采集

1. 在 Obsidian 里打开目标视图（固定窗口尺寸，记录在快照 `viewport` 字段）。
2. 执行采集脚本（内容见 `scripts/visual-baseline-capture.js`）：

   ```powershell
   # obsidian eval 有长度上限，用「短桩读文件再 eval」的方式
   obsidian eval code="(async function(){var p='.obsidian/plugins/novel-writer-ai/scripts/visual-baseline-capture.js';var c=await app.vault.adapter.read(p);return await (0,eval)(c.replace(/;\s*$/,''));})()"
   ```

   脚本会把当前视图的 DOM 快照写到 vault 根 `.visual-baseline/<module>.json`，并只回显路径。
3. 把快照移入仓库：`docs/quality/visual-baseline/<module>.json`（提交入库，作为验收依据）。

### 3.2 比对

```powershell
node scripts/check-visual-diff.mjs docs/quality/visual-baseline/kb-before.json .visual-baseline/kb-after.json
```

输出：新增/消失节点、矩形漂移、计算样式差异；任一 R1~R3 违规时退出码 1。
确认无意的变化后，用 `--update` 覆盖基线并写明原因。

### 3.3 快照里存什么

每个节点一条：`path`（从视图根开始的标签+序号路径）、`tag`、
`rect`（x/y/w/h，四舍五入到 1px）、`textLen`、
`styles`（display/flex/grid/gap/padding/margin/font/color/background/border/radius/opacity/overflow/whiteSpace 等约 20 项）。

不存类名 —— 类名正是要被重构的东西；用路径定位元素，因此**重构期间不得改变 DOM 结构**
（改结构属于行为重构，需单独一轮并更新基线）。

## 3.5 反复踩到的坑（必须记住）

### 坑 1：Obsidian 默认控件样式的特异性高于单类选择器

Obsidian 自带 `button:not(.clickable-icon)` 特异性是 **(0,1,1)**，
`input[type=text]` 同理。我们自己写的 `.nw-xxx-btn` 只有 (0,1,0)，
**去掉内联样式后会立刻被压住**，按钮/输入框退回默认外观。

在知识库重构中连续踩了三次（导航按钮、搜索框、详情页签）。规则：

- 组件按钮/输入框 → 用 `button.nw-xxx-btn` / `input.nw-xxx-input` 写规则；
- 或者用祖先限定提高特异性：`.nw-kb-sidebar-header .nw-kb-nav-btn`。

### 坑 2：视觉基线只能证明「拍到的页面」没变

如果目标区块没渲染出来（数据缺失、未切到对应页签），diff 会是 0 差异——
**这是假绿**。Slice C 就踩过：详情页没打开，0 差异毫无意义。

采集脚本必须打印目标元素计数，且 `> 0` 才算有效采集。

## 4. 单模块重构步骤

1. 采集基线（before）→ 入库。
2. 只改一个 block（或一组强相关 block）：类名 → 语义类，样式移到模块 CSS 文件。
3. 构建、`preflight`、单测。
4. 重新采集（after）→ `check-visual-diff` 必须无 R1~R3 违规。
5. 更新模块文档与 INDEX，提交（提交信息里贴 diff 结论）。
6. 下一个 block 重复；一个模块内全部 block 完成后，删掉该模块遗留的工具类引用。

## 5. 当前进度

| 模块 | 状态 | 快照 |
| --- | --- | --- |
| 新手向导（`nw-wizard-*`） | 完成：Slice J（`ui/full-writer/wizard-step-renderers.ts` 9 个渲染方法；265 处 `nw-u-*` + 62 个工具类 token + 11 处内联 `style` 全部清零），新增 `styles-src/30-wizard-steps.css`，选择器统一 `.nw-wizard-content-area ` 前缀 | `D:\nw-dev-vault\_visual-j\{before,after,diff}`（13 个场景，未入库） |
| 监控面板 B（`nw-monb-*`） | 完成：Slice K（`ui/monitor-panel-b.ts`；232 处 `nw-u-*` + 18 处内联 `style` 清零），新增 `styles-src/31-monitor-panel-b.css`，选择器统一 `.nw-float-monitor-b ` 前缀（基类按 panelId 注入） | `D:\nw-dev-vault\_visual-k\{before,after,diff}`（12 个场景，diffPx 全 0，未入库） |
| 写作指纹库（`nw-fp-*`） | 完成：Slice L（`ui/views/writing-fingerprint-view.ts` 228 处、`ui/fingerprint-detail-modal.ts` 157 处、`ui/views/fingerprint-v2-detail.ts` 20 处工具类 + 15 行内联 `style` 全部清零），新增 `styles-src/32-fingerprint.css`，选择器统一 `.nw-scope ` 前缀；外壳类 `nw-fingerprint-*` 保留以兼容 E2E 与 container query | `D:\nw-dev-vault\_visual-l\{before,after}`（8 个场景，未入库） |
| 大纲智能扩写（`nw-oe-*`） | 完成：Slice M（`ui/outline-expand-modal.ts` 220 处 `nw-u-*` + 1 处内联 `style` 清零；场景项的 `nw-expand-scene-*` / `nw-expand-adopt-*` 从 `styles-src/25-planning-outline-controls.css` 迁入并改名），规则全部集中在 `styles-src/25-outline-expand.css`；弹窗虽挂 `.nw-scope`，但按「声明级等价」保留单类选择器 | `D:\nw-dev-vault\_visual-m\{before,after}`（6 个场景，struct/style/rect 探针全 0，未入库） |
| 提示词管理设置（`nw-pm-*`） | 完成：Slice N（`ui/prompt-manager-settings.ts` 192 处 `nw-u-*` + 15 处内联 `style` 清零；A/B 状态标签由 `getStatusStyle()` 内联串改为 `getStatusClass()` 返回修饰类），新增 `styles-src/33-prompt-manager.css`（307 行 / 9411 字节） | `D:\nw-dev-vault\_visual-n\{before,after}`（11 个场景，10 个 PNG 0 差、1 个仅底边 1px，struct/style/rect 探针全 0，未入库） |
| 章节大纲树弹窗（`nw-ot-*`） | 完成：Slice O（`ui/chapter-outline-tree-modal.ts` 177 处 `nw-u-*` + 2 处内联 `style` 清零；`attr: { cls: ... }` 四处改成 `cls:`，让原本从未生效的四个类真正落盘），新增 `styles-src/34-outline-tree.css`（401 行 / 8342 字节），规则全部 `.nw-scope ` 前缀、9 条按钮规则 `button.nw-ot-*` | `D:\nw-dev-vault\_visual-o\{before,after}`（8 个场景，高度 8/8 一致、computed style 差全 0，未入库） |
| 知识库主视图（`nw-kb-tasks-*` / `nw-kb-monitor-*`） | 完成：Slice P（`ui/views/knowledge-base-view.ts` 175 处 `nw-u-*` + 9 处内联 `style` 清零；统计卡配色由 `TaskStatItem.color` 内联串改为 `tone` 档位枚举 + 修饰类，进度条宽度改 CSS 变量 `--nw-kb-pct`；规则并入 `styles-src/27-knowledge-base.css` 从 `:2489` 起的 Slice P 段，未新建文件） | `D:\nw-dev-vault\_visual-p\{before,after}`（6 个场景，PNG 差全 0，未入库） |
| 上下文监控面板（`nw-cp-*`） | 完成：Slice Q（`ui/rendering/context-panel.ts` 173 处 `nw-u-*` + 3 处内联 `style` 全部清零；token 配色改 `--warn`/`--danger` 修饰类、截断详情改 `--open`、进度条改 CSS 变量 `--nw-cp-pct`），新增 `styles-src/35-context-panel.css`（383 行 / 10818 字节），规则全部 `.novel-writer-fw-context-panel ` 前缀；外壳类 `novel-writer-fw-warning` 保留，`.nw-cp-alert` 只覆盖被删工具类真正生效的五项 | `D:\nw-dev-vault\_visual-q\{before,after}`（6 个场景，5 个 PNG 0 差、`02` 仅有意的告警条底色差 3.151%，struct/style/rect 探针全 0，未入库） |
| 知识库 / 设定（`kb-`） | 完成：Slice A–I（书架 / 工具栏卡片 / 详情公共构件+概览 / 外壳页签条 / 各页签内容区 / 题材配置页 / 四个管理弹窗 / 批量导入弹窗 / 读书拆解详情弹窗）；H 用独立 `nw-bi-*`、I 用 `nw-kd-*` 命名空间，后续新页签沿用同一模式 | `docs/quality/visual-baseline/kb-books.json`、`kb-detail.json`；F 截图 `D:\nw-dev-vault\_visual-fg\`、G 截图 `_visual-g\`、H 截图 `_visual-h\`、I 截图 `_visual-i\`（未入库） |
| 设置页通用分区（`nw-st-*`） | 完成：Slice R（`ui/settings/general-sections.ts` 五个分区 160 处 `nw-u-*` + 11 处内联 `style` 全部清零；基类收多数派声明，三处差异用修饰类恢复：`--bg-primary`（更新日志按钮底色）、`--ghost` 补 `font-weight: 400`、`--end` 补 `flex-wrap: nowrap`），新增 `styles-src/36-settings-general.css`（380 行 / 9596 字节），按钮/文本框用元素限定选择器 | `D:\nw-dev-vault\_visual-r\{before,after}`（8 个场景 PNG 全 0 差，struct/style/rect 探针全 0，未入库） |
| 场景细纲面板（`nw-so-*`） | 完成：Slice T（`ui/full-writer/scene-outline-controller.ts` 123 处 `nw-u-*` + 5 处内联 `style` 清零；场景卡/状态圆点/页签按钮的三元表达式改成 `--active`/`--dragging`/`nw-so-dot--*` 修饰类，`getStatusColor()` 改为 `getStatusClass()`），新增 `styles-src/37-scene-outline.css`（275 行 / 6034 字节），规则除早退空态外全部 `.nw-scene-outline-container ` 前缀；非选中卡旧内联里的 `hover:` 是非法声明（整条被丢弃），按**实际渲染**复刻为「无底色、无 hover」 | `D:\nw-dev-vault\_visual-t\{before,after}`（6 个场景，PNG 全 0 差，struct/style/rect 探针全 0，未入库） |
| 知识库设置分区（`nw-st-kb-*`） | 完成：Slice U（`ui/settings/knowledge-section.ts` 108 处 `nw-u-*` + 11 处内联 `style` 全部清零；徽标由 `{label,color,bg}` 表改为 `{label,tone}` + `nw-st-kb-badge--*`，连接状态删 `statusColors` 表改 `className` 修饰类；卡片保留外壳 `.nw-kb-book-card`，语义类只补 `position/overflow`），新增 `styles-src/38-settings-knowledge.css`（311 行 / 7130 字节 / 47 个类），按钮/输入框/下拉全部元素限定，不套 `.nw-scope`（与 Slice R 同法） | `D:\nw-dev-vault\_visual-u\{before,after}`（7 个场景 PNG 全 0 差，struct/style/rect 探针全 0，未入库） |
| 书籍详情渲染（`nw-kb-detail-*` 续） | 完成：Slice S（`ui/views/book-detail-renderer.ts` 剩余 126 处 `nw-u-*` + 3 处内联 `style` 清零；题材分类卡/质量评分卡/标签页三块沿用 Slice C/D/E 的 `nw-kb-detail-*` 命名空间，规则追加到 `styles-src/27-knowledge-base.css` 从 `:2887` 起的 Slice S 段 246 行 / 5445 字节；进度条宽度改 CSS 变量 `--nw-kb-detail-pct`，标签输入框改 `input[type='text'].nw-kb-detail-tag-input`） | `D:\nw-dev-vault\_visual-s\{before,after}`（4 个场景，3 个 PNG 0 差、`01-genre` 仅三处死类按意图补真 0.274%，struct/style/rect 探针其余全 0，未入库） |
| 文笔润色编辑器 / AI 润色弹窗（`nw-pe-*`） | 完成：Slice V（`ui/polish-editor.ts` 104 处 `nw-u-*` + 3 处内联 `style` 全部清零；图例四项的字面 8 位 hex（`#e74c3c22`/`#e74c3c44`）原样搬进 CSS 而不是改 `color-mix`（取整会差 1~2 色阶）、编辑区 10 条内联合并成 `.novel-writer-polish-editor.nw-pe-editor` 一条、条件配色改 `--warning`/`--error`/`--success`/`--issue` 修饰类、按钮一律 `button.nw-pe-btn`），新增 `styles-src/39-polish-editor.css`（286 行 / 5842 字节 / 47 个类）；编辑区不带 `.nw-scope`，弹窗侧说明文字用 `.nw-scope .nw-pe-hint*` | `D:\nw-dev-vault\_visual-v\{before,after}`（8 个场景 PNG 全 0 差，struct/style/rect 探针全 0；0.01px 几何复核 8 场景 0 差，未入库） |
| 补全拆解 / 重新提取指纹弹窗（`nw-rf-*`） | 完成：Slice W（`ui/refill-modal.ts` 97 处 `nw-u-*` + 14 处内联 `style` 全部清零；徽标与维度状态的颜色表改成 `nw-rf-badge--{green\|yellow\|red}` / `nw-rf-dim-status--{status}` 修饰类、进度条宽度改 CSS 变量 `--nw-rf-pct`、维度卡的 `transition:all 0.2s` 按 lint 禁令拆成 `background-color` + `border-color` 两条（计算值因此从 `0.2s` 变两属性串，是唯一有意偏差）、**指纹变体的取消按钮恒 `background-primary`，不能与知识库变体的 `isRunning` 条件共用修饰类**），新增 `styles-src/40-refill-modal.css`（277 行 / 6330 字节 / 39 个选择器）；全部规则挂在 `.nw-scope` 下，按钮写 `.nw-scope button.nw-rf-btn` | `D:\nw-dev-vault\_visual-w\{before,after}`（6 个场景 PNG 全 0 差，struct/rect 探针全 0；style 仅 6 张维度卡的 `transition`） |
| 质量统计面板（`nw-ks-*`） | 完成：Slice X（`ui/views/kb-stats-panel.ts` 81 处 `nw-u-*` + 4 处内联 `style` 全部清零，根死类 `nw-kb-stats-tab` 换成 `nw-ks-panel`；概览卡 `color` 改 `tone: KbStatsTone`、图例圆点改 `status: KbStatusKey` + `--{status}` 修饰类、四条平均分条改 CSS 变量 `--nw-ks-pct`；旧内联里的 `&:last-child{border-bottom:none}` 是非法声明、按实际渲染**不补**该规则），规则追加到 `styles-src/27-knowledge-base.css` 末尾 192 行（文件 3324 行）；不新建样式文件。功能缺口 ⑤（2026-11-18）在同一段补状态行交互：`.nw-ks-legend-row--action` / `--idle` 修饰类 + `:hover` / `:focus-visible` + `onStatusClick`，静态场景与 before **0 像素差** | `D:\nw-dev-vault\_visual-x\{before,after}`（5 个场景 PNG 全 0 差，struct/style/rect 探针全 0，未入库） |
| 拆解引擎设置分区（`nw-st-dc-*`） | 完成：Slice Y（`ui/settings/deconstruction-section.ts` 47 处 `nw-u-*` + 1 处内联 `style` 全部清零；五张卡原本逐字重复同一串 5 个工具类，合并成 `.nw-st-dc-card`，说明文字拆 `nw-st-dc-note--warning`，恢复默认按钮改 `button.nw-st-dc-reset-btn` 元素限定），新增 `styles-src/41-settings-deconstruction.css`（1640 字节 / 62 行 / 7 个选择器），**不套 `.nw-scope`**（设置页整体不在 scope 容器内，同 Slice R/U） | `D:\nw-dev-vault\_visual-y\`（3 场景 before/after 全 0 像素差） |
| 全屏写作体检条（`nw-fw-*`） | 完成：功能缺口 2（`ui/full-writer/checkup-bar-controller.ts` 288 行新控制器 + `ui/full-writer-view.ts` 5 处装配；复用 `EndingTractionEngine.checkTraction`，20s 节流 + 步骤完成走 `force`；空态/失败态只清数值，进度条归零改 `nw-fw-checkup-fill--empty` 修饰类，详情面板改 `--open`），新增 `styles-src/42-full-writer-checkup.css`（4240 字节 / 193 行 / 29 个选择器），模块短名 `fw-` 首次登记 | 实机 `D:\nw-tmp\verify-checkup.mjs`（体检条渲染 / 详情展开 2 条情节线 / 刷新不回空态，连跑两次 ok），单测 8 条（均未入库） |

| 发布前文面体检弹窗（`nw-precheck-*`） | 完成：功能缺口 3（`shared/manuscript-precheck.ts` 纯规则引擎 7 条规则 / 三档严重度 + `ui/manuscript-precheck-modal.ts` 198 行 + `styles-src/43-manuscript-precheck.css` 2472 字节 / 117 行 / 16 个选择器；弹窗挂 body，裸类名无 `.nw-scope`，同既有 Modal），模块短名 `precheck-` 首次登记 | 实机 `D:\nw-tmp\probe-gap3.mjs`（6 处问题 / 点行跳正文光标 line5 ch1 / 只看必改项 6→2→6 / 导出 Notice 三行）+ `probe-exp-precheck.mjs`，单测 15 条（均未入库） |

### 5.1 工具类退场进度（`nw-u-*`）

定义全部集中在 `styles-src/10-entity-and-utilities.css`，门禁 `npm run check:utility`。
检查项：A 重名后缀、B `cls:` 字面量死引用、B2 源码全文死引用（覆盖 `addClass()` 与模板串）、
D 零引用死定义，外加 C 定义数与使用量只许下降。
**纪律：新代码不得新增 `nw-u-*`；已在用的类随所属模块切片换成语义类。**

2026-11-17 清理后实测（脚本口径：扫 `ui/engine/services/shared/core/domains/utils` + `main.ts`）：

| 指标 | 数值 |
| --- | --- |
| 定义 | 46 个（清理前 430；Slice H 删 13 个、Slice I 删 30 个、Slice J 删 11 个、Slice K 删 20 个、Slice L 删 13 个、Slice M 删 19 个、Slice N 删 12 个、Slice O 删 25 个、Slice P 删 14 个、Slice Q 删 31 个、Slice R 删 23 个、Slice S 删 18 个、Slice T 删 16 个、Slice U 删 25 个、Slice V 删 19 个、Slice W 删 9 个零引用类、Slice X 删 20 个零引用类、Slice Y 删 9 个零引用类） |
| 零引用定义 | 0（清理前 57，已删） |
| 引用但未定义的类 | 0（清理前 5：真实缺陷 1 处 `nw-u-w-full-2` 已删，另 4 处是 `tests/` 断言与历史文档示例） |
| TS 引用 | 46 个类 / 142 次（`check:utility` 口径，`cls:` 字面量；Slice Y 后，定义数=引用数，零引用 0） |
| `styles.css` 体积 | 795890 字节（功能缺口 5 在 `styles-src/27-knowledge-base.css` 追加状态行交互态 `.nw-ks-legend-row--action` / `--idle` 与 hover/focus-visible，+558 字节 / +2 类；功能缺口 4 在 `styles-src/33-prompt-manager.css` 追加使用统计工具条/分页器、导入预览弹窗 `nw-pm-import-*` 与列表焦点态，+2074 字节 / +15 类；功能缺口 3 新增 `styles-src/43-manuscript-precheck.css` 2472 字节、净 +2517；功能缺口 2 新增 `styles-src/42-full-writer-checkup.css` 4240 字节、净 +4285；Slice Y 新增 `styles-src/41-settings-deconstruction.css` 1640 字节、净 +1681，同时删掉 9 个零引用工具类；Slice G 后 641829；Slice H 新增 `nw-bi-*` 段约 1060 行；Slice I 新增 `nw-kd-*` 段 17545 字节；Slice J 新增 `30-wizard-steps.css` 约 290 行；Slice K 新增 `31-monitor-panel-b.css` +9128 字节；Slice L 新增 `styles-src/32-fingerprint.css` 16887 字节，净 +17223 字节，同时删掉 13 个零引用工具类；Slice M 新增 `nw-oe-*` 段约 220 行，净 +5377 字节，同时删掉 19 个零引用工具类；Slice N 新增 `styles-src/33-prompt-manager.css` 307 行 / 9411 字节，净 +8635 字节，同时删掉 12 个零引用工具类；Slice O 新增 `styles-src/34-outline-tree.css` 401 行 / 8342 字节，同时迁移 `25-planning-outline-controls.css` 的旧 `nw-outline-*` 段并删掉 25 个零引用工具类，净 +4646 字节；Slice P 在 `27-knowledge-base.css` 追加约 396 行语义类段、删掉 14 个零引用工具类，净 +7782 字节；Slice Q 新增 `styles-src/35-context-panel.css` 383 行 / 10818 字节，同时删掉 31 个零引用工具类，净 +9307 字节；Slice R 新增 `styles-src/36-settings-general.css` 380 行 / 9596 字节，同时删掉 23 个零引用工具类，净 +8519 字节；Slice S 在 `27-knowledge-base.css` 追加 246 行 / 5445 字节语义类段并把只此一处使用的 `.nw-rec-row` 折进来（删 6 行），同时删掉 18 个零引用工具类，净 +4268 字节；Slice T 新增 `styles-src/37-scene-outline.css` 275 行 / 6034 字节，同时删掉 16 个零引用工具类，净 +5492 字节；Slice U 新增 `styles-src/38-settings-knowledge.css` 311 行 / 7130 字节，同时删掉 25 个零引用工具类，净 +6206 字节；Slice V 新增 `styles-src/39-polish-editor.css` 286 行 / 5842 字节，同时删掉 19 个零引用工具类，净 +5141 字节；Slice W 新增 `styles-src/40-refill-modal.css` 277 行 / 6330 字节（rgbHsl +4 来自徽标/选中卡由内联迁入的 4 个 `rgba(var(--*-rgb), .15)`），同时删掉 9 个零引用工具类，净 +5957 字节；Slice X 在 `27-knowledge-base.css` 追加 192 行 `nw-ks-*` 段（hardcodedHex +8 来自概览 4 档与图例 5 态由内联迁入 CSS），同时删掉 20 个零引用工具类，净 +2843 字节） |

清理记录：删除 57 个零引用声明级工具类；去掉 `ui/views/writing-fingerprint-view.ts` 里 `addClass('nw-u-w-full-2')`（类从未定义，等于空操作，删除后渲染不变）；Slice L 随指纹库语义化再删 13 个零引用类（定义 299 → 286）；Slice M 随扩写弹窗语义化再删 19 个零引用类（定义 286 → 267）；Slice N 随提示词管理设置语义化再删 12 个零引用类（定义 267 → 255）；Slice O 随章节大纲树语义化再删 25 个零引用类（定义 255 → 230）；Slice P 随知识库主视图语义化再删 14 个零引用类（定义 230 → 216）；Slice Q 随上下文面板语义化再删 31 个零引用类（定义 216 → 185）；Slice R 随设置页通用分区语义化再删 23 个零引用类（定义 185 → 162）；Slice S 随书籍详情语义化再删 18 个零引用类（定义 162 → 144）；Slice T 随场景细纲语义化再删 16 个零引用类（定义 144 → 128）；Slice U 随知识库设置分区语义化再删 25 个零引用类（定义 128 → 103）；Slice V 随文笔润色语义化再删 19 个零引用类（定义 103 → 84）；Slice W 随补全拆解/指纹弹窗语义化再删 9 个零引用类（定义 84 → 75）；Slice X 随质量统计面板语义化再删 20 个零引用类（定义 75 → 55）；Slice Y 随拆解引擎设置语义化再删 9 个零引用类（定义 55 → 46）。

**取词陷阱**：历史生成器对超长类名做了截断，留下 `nw-u-blt-3px-solid-interactive-`、`nw-u-bt-1px-dashed-nw-divider-`、
`nw-u-animation-nw-progress-anim-1-5s-` 等**以 `-` 结尾却真实生效**的类名。B2/D 的正则必须把尾部连字符一起吞掉
（`/nw-u-[a-zA-Z0-9_-]+/`），否则会把它们误报成「引用了未定义的类」。

**特异性陷阱（Slice H 实测）**：弹窗内语义类会被 Obsidian 基础样式静默盖掉——`.modal button`、`input[type=text]`
都是 (0,1,1)，而单个 `.nw-xxx` 只有 (0,1,0)，于是 `color`/`border-color` 不生效，只有没被覆盖的
`border-bottom-color` 之类起作用，截图看起来像「设计改了但没生效」。约定：弹窗/面板构件要么挂在 `.nw-scope`
命名空间下（(0,0,2,0)，见 `styles-src/00-header.css:13`），要么用双类，二者择一；Slice H 的
`styles-src/28-batch-import.css` 采用前者（173 条规则全部加前缀）。
Slice J 的向导区没有 `.nw-scope` 祖先，改用真实存在的 `.nw-wizard-content-area ` 前缀拿到 (0,2,0)；
Slice K 的面板 B 同理，用 `DraggablePanel` 按 panelId 注入的 `.nw-float-monitor-b ` 前缀（`styles-src/31-monitor-panel-b.css`）；
Slice L 的指纹库走 `.nw-scope`（视图根节点与三个 `modalEl` 已挂），但**选书弹窗故意不挂**——
`.modal.nw-scope{margin:auto}`（`styles-src/22-modal-layout.css:14`）会让它横移 2px；
同一次实测还发现：`nw-u-*` 对 `<button>` 的 `background`/`color` 同样失效（渲染成白底黑字），
所以语义化时按**设计意图**恢复强调色，而不是复刻这个级联事故。
Slice M 的扩写弹窗虽然也挂了 `.nw-scope`，但验收口径是「与旧渲染逐项等价」，因此 `nw-oe-*` 规则保持单类；
6 个场景的 computed style 探针证明没有被基础样式压掉，若后续新增构件出现覆盖再补前缀。
Slice N 的设置页整体不在 `.nw-scope` 容器里（`ui/settings/writing-sections.ts:545` 直接往 section 里渲染），而目标元素是 `<button>`：
单类选择器敌不过 Obsidian 的按钮默认样式（`background`/`color` 被压成 `--interactive-normal`/`--text-normal`），
因此 9 条按钮规则改用 `button.nw-pm-*`（(0,1,1)，插件样式加载在后即胜出，与 `button.nw-kb-nav-btn`、`button.nw-btn-icon` 同法），11 个场景探针随之归零。
Slice O 的大纲树弹窗同时踩到两个坑：`.modal button` 压掉六个按钮（搜索 🔍、✕、📄全文、关闭、生成画布事件、保存全是白底黑字），
以及 `attr: { cls: 'nw-outline-chap-label' }` **只写出同名属性、不落 class**，导致四个类的 CSS 从来没生效过。
修法是按钮规则写 `button.nw-ot-*` + `.nw-scope` 前缀（(0,2,1)），`attr.cls` 全部改 `cls:`；但标签类只还原 `cursor`/`border-radius`/`:hover`，
旧规则里的 `flex:1; padding:2px 4px; border:1px solid transparent` 按截图校正后**有意放弃**——原样启用会把 ⭐/💬/🪝 与 ▲▼ 推到行尾、
整窗 914→998px。
Slice P 的知识库主视图不在 `.nw-scope` 里也能直接写单类，因为它渲染在视图根节点内、目标元素多为自建 `div`；唯一的配色陷阱是**别把改前内联色换成 `--nw-*` 语义 token**——那组 token 在本主题已被调淡（`--nw-warning` rgb(212,167,106) ≠ 原 #f59e0b、`--nw-success` rgb(122,171,142) ≠ #2ecc71、`--nw-danger` rgb(212,120,120) ≠ #e74c3c），套上去 `tasks-list` 立刻差 0.41%（maxDelta 99）；按 `rgb()` 字面值逐条复刻后 6 场景归零。
Slice Q 的上下文面板根节点自带 `.novel-writer-fw-context-panel`（(0,2,0)），单类 `nw-cp-*` 已被前缀盖住，不需要额外命名空间；本切片的教训在另一头——**被删的工具类不等于「什么都没写」**：`nw-u-bg-modifier-error-soft` 的声明 `background:var(--background-modifier-error-rgb, 255, 100, 100, 0.1)` 在 computed-value 阶段非法，CSS 规定此时回落到 initial（IACVT，即 `transparent`），于是它一直把外壳 `.novel-writer-fw-warning` 的 `--nw-warning-bg` 浅橙底压成透明；删掉后告警条恢复底色（`02-failed-token60` 差 3.151%，maxDelta 22，无文字重排），属有意修正，其余 5 场景 0 差。

Slice R 的设置页五个分区同样不在 `.nw-scope` 里，但目标元素大量是 `<button>` / `<textarea>`：规则一律写 `button.nw-st-*` / `textarea.nw-st-*`（(0,1,1)），并对 `.modal button` 再补一条同样特异性的规则。本轮真正的教训是**基类粒度**：把 11 处内联样式归并成 3 个基类后，像素验收抓出三处「基类多数派 ≠ 该元素原值」——更新日志按钮原为 `--background-primary`（基类给了 secondary）、横幅 ghost 按钮原无 `font-weight`（基类给了 600）、报告弹窗按钮行原为 `nowrap`（基类给了 wrap）。结论：合并内联样式时先做「声明集」分组，组内不一致的值必须留修饰类，不能取众数硬吞。
Slice S 的书籍详情三块也踩到同一类**输入框特异性**问题：标签输入框写单类 `.nw-kb-detail-tag-input` 会被 `input[type=text]`（(0,1,1)）压成默认外观，必须写 `input[type='text'].nw-kb-detail-tag-input`；另一条经验是**别复用带动效的既有类**——`.nw-kb-detail-meter-fill` 自带 `transition: width 0.3s`，复用给分类建议/评分条会让静态宽度变成补间，故新建无过渡的 `nw-kb-detail-bar-fill`。同时把只此一处使用的 `.nw-rec-row` / `:hover` 从 `styles-src/26-cleanup-utilities.css` 折进 `-rec-row` 并删除旧规则。
Slice T 的场景细纲踩到两个「照字面复刻就会出错」的坑：①旧场景卡内联写着 `background: var(--background-secondary) hover: var(--background-modifier-hover);`，`hover:` 不是合法属性名，整条声明在解析阶段被丢弃，所以非选中卡从来没有底色也没有 hover——按字面补上 secondary 会让每张卡变灰；②冲突页那行来自 `nw-u-d-flex nw-u-gap-12px nw-u-m-10px-0`（无 `ai-center`），与基础行 `nw-so-field-row` 的 `align-items:center` 不同，修饰类必须显式写 `align-items: normal` 还原 stretch，否则探针会报 `normal → center`（像素相同但语义不等价）。
Slice U 的知识库设置分区沿用 Slice R 的「设置页不在 `.nw-scope`」结论（`button.nw-st-kb-*` / `input[type='text'].nw-st-kb-search-input` / `select.nw-st-kb-status-select`），本轮真正抓出的是**基类不要吞字重**：把 `font-weight:500` 放进 `button.nw-st-kb-btn--primary` 后，空态「📥 批量导入书籍」按钮（旧内联里没写 fw500）从 400 变 500，7 场景对比里 `02-empty` 精确报出 1 处 style 差；修法是 `--primary` 只管配色、字重单列 `--fw500` 修饰类只挂工具条那颗。另一条是**别重复外壳类的几何**：书籍卡的 `padding` 在内联工具类与 `.nw-kb-book-card` 重叠时本就输给后者（10 号文件先加载、27 号在后），语义类只保留真正生效且外壳类没有的 `position/overflow`。
Slice V 的文笔润色横跨「编辑区 + 两个面板 + 一个 Modal」，本轮三条经验：①**字面 hex 优先于 `color-mix`**——图例四项原内联是 `${color}22`/`${color}44`（把 alpha 当 hex 后缀拼），改 `color-mix(in srgb, #e74c3c 13%, transparent)` 会因 `0x22/255=13.3%` 取整差 1~2 色阶，直接写 8 位 hex 才能像素归零（代价是 `check:css` hex 计数 +12，已进基线 note）；②**Obsidian `Modal.open()` 会覆写同名字段**——`PolishAIPolishModal` 的私有 `selection: string` 在 `open()` 后被写成 DOM Selection，`renderInputForm` 直接抛 `this.selection.trim is not a function`（HEAD 同样存在，记 PE-06 backlog），截图脚手架只能用访问器绕过，不能为截图改产品代码；③**像素验收要重采一次再判定**——首次 after 采集在 4 个场景出现 1~226px 的 1px 边缘差异，重采后 8/8 归零，且「同一构建两次采集」互差同样是 226px，说明这是新开 Obsidian 首轮启动状态影响边缘合成像素，不是重构建引入的。
Slice W 的补全拆解/指纹弹窗已整体在 `.nw-scope` 下（`RefillModal.onOpen()` 给 `modalEl` 加了类），规则直接写 `.nw-scope button.nw-rf-btn` 即可（(0,2,1)）。本轮三条经验：①**`transition:all` 是硬禁令**——旧维度卡内联是 `transition:all 0.2s`，`tests/unit/ui/panel-resizer-and-motion.test.ts` 会扫 `styles.css` 字面量，必须拆成 `background-color` + `border-color` 两条显式属性，代价是 6 张卡片的 `transition` 计算值变化（像素无差，已在验收表标注为有意偏差）；②**同一组件的不同变体不能共用条件样式**——指纹变体的取消按钮旧代码恒为 `background: var(--background-primary)`，只有知识库变体才按 `isRunning` 切 `background-secondary`，第一版按 `isRunning` 统一判断，`05-fingerprint-yellow-running` 立刻报 1 处 style 差（`rgb(255,255,255) → rgb(246,246,246)`，PNG 3969 px）；③**首轮像素噪声再次出现**——第一次 after 采集在 3 个场景各出现 523/523/541 px、`maxDelta` 6~7，probes 全 0，重采后 6/6 归零，与 Slice V 完全同一现象。
Slice X 的质量统计面板是本轮最短的一次语义化（155 行 / 81 处），三条经验：①**"按实际渲染"是对非法内联的唯一正确解读**——旧图例行内联里带 `&:last-child{border-bottom:none}`，嵌套语法在 style 属性里整条非法、浏览器直接丢弃，所以每行原本都有 1px 下边框；新 CSS 若"顺手修好"补上 `:last-child`，最后一行会少一条边框（像素差异），正确做法是**不补**并在注释里写明；②**颜色从 JS 表迁到 CSS 修饰类，但 SVG 用的配色要留在逻辑层**——概览卡由 `color` 改 `tone`、图例圆点由 `item.color` 改 `status` 后，`KB_STATUS_STYLES` 的 `color` 字段仍必须保留，因为环图 SVG 由逻辑层直接消费、不经过 CSS；③**同模块不新开样式文件**——已到 40 号，再开 `41-kb-stats.css` 会把"知识库"拆成第三套命名空间，直接追加到 `27-knowledge-base.css` 末尾（与 Slice S 同法）。
Slice Y 的拆解引擎分区只有 336 行、47 处引用，却带出两条可复用的教训：①**五处逐字重复的同一串工具类要合并成一个类**——五张卡原本各写一遍 `nw-u-p-12px-16px nw-u-b-1px-solid-background-m …`，合并成 `.nw-st-dc-card` 后声明只需维护一份，像素验收 3/3 零差异；②**设置分区的"数据没生效"是假象**——`ALL_BREAKDOWN_DIMENSIONS.forEach` 让八个维度恒渲染八行，改 `enabledDimensions` 只影响 toggle 勾选，DOM 元素数（166）与高度（1869）完全不变，截图脚本要靠 dump `input[type=checkbox]` 的 checked 才能确认数据注入成功。另外分区可以绕过整页渲染：`settingsTab.sections.get('deconstruction') || settingsTab.getSection('deconstruction')`（TS private 运行时可达）拿到实例后直接 `render(host)`，宿主需带 `vertical-tab-content nw-settings-root nw-settings-tab-content` 三件套，`15-late-fixes.css` 的 `.nw-settings-tab-content .setting-item` 保护才会命中。

剩余存量大户（下一批切片候选，按引用次数；`ui/batch-import-modal.ts` 365 处在 Slice H 清零、`ui/knowledge-detail-modal.ts` 294 处在 Slice I 清零、`ui/full-writer/wizard-step-renderers.ts` 265 处在 Slice J 清零、`ui/monitor-panel-b.ts` 232 处在 Slice K 清零；Slice L 清零 `ui/views/writing-fingerprint-view.ts` 228 处 + `ui/fingerprint-detail-modal.ts` 157 处 + `ui/views/fingerprint-v2-detail.ts` 20 处；Slice M 清零 `ui/outline-expand-modal.ts` 220 处；Slice N 清零 `ui/prompt-manager-settings.ts` 192 处；Slice O 清零 `ui/chapter-outline-tree-modal.ts` 177 处；Slice P 清零 `ui/views/knowledge-base-view.ts` 175 处；Slice Q 清零 `ui/rendering/context-panel.ts` 173 处；Slice R 清零 `ui/settings/general-sections.ts` 160 处；Slice S 清零 `ui/views/book-detail-renderer.ts` 126 处；Slice T 清零 `ui/full-writer/scene-outline-controller.ts` 123 处；Slice U 清零 `ui/settings/knowledge-section.ts` 108 处；Slice V 清零 `ui/polish-editor.ts` 104 处；Slice W 清零 `ui/refill-modal.ts` 97 处；Slice X 清零 `ui/views/kb-stats-panel.ts` 81 处，均不在表内；Slice Y 清零 `ui/settings/deconstruction-section.ts` 47 处，**至此 `nw-u-*` 存量清空**，剩余 46 个定义散在长尾文件、单文件均不超过数处，按「碰哪改哪」处理，`check:utility` 的 C 项（定义数/使用量只许下降）即为新增禁令的门禁）：

（已无存量大户：Slice Y 之后 `nw-u-*` 只剩长尾零星引用，新代码一律禁止新增，门禁见 `check:utility` 的 C 项。）
# 知识库 / 设定（视觉重构）

> 模块页（Module Page）。状态：**doing（视觉重构 Slice A–E 完成 2026-11-17；F 配置页 / G 弹窗待做）**
> 规范：[视觉重构规范](../design/2026-11-16-visual-refactor-standard.md)
> 基线：[`docs/quality/visual-baseline/kb-books.json`](../quality/visual-baseline/kb-books.json)

## 1. 代码入口

| 文件 | 职责 | 工具类命中（改造前） |
| --- | --- | --- |
| `ui/views/knowledge-base-view.ts` | 书架外壳：左栏导航、题材面板、书籍列表、详情容器 | 311 |
| `ui/views/book-detail-renderer.ts` | 书籍详情各分区（概览/角色/文风/情感/伏笔/商业…） | **914** |
| `ui/views/book-*-logic.ts` | 详情各分区的数据整形（纯逻辑） | 0 |
| `ui/knowledge-detail-modal.ts` | 拆解详情弹窗 | 294 |
| `ui/knowledge-base-modals.ts` | 配置/导入等弹窗 | 231 |
| `ui/views/writing-fingerprint-view.ts` | 写作指纹库视图（同命令组，独立模块 `fp-`） | 229 |
| `styles-src/27-knowledge-base.css` | 本模块样式主文件（新建） | — |

## 2. 命名约定（本模块）

`nw-kb-<block>[-<element>][--<modifier>]`，区块清单：

| block | 说明 |
| --- | --- |
| `nw-kb-main-layout` / `-left-sidebar` / `-right-panel` / `-right-content` / `-monitor-bar` | 外壳骨架 |
| `nw-kb-sidebar-header` / `-sidebar-title` / `-nav-row` / `-nav-btn` / `nw-kb-sidebar-nav` / `nw-kb-nav-item` / `-nav-icon` | 左栏 |
| `nw-kb-books-tab` / `nw-kb-genre-panel` / `-genre-title` / `nw-kb-channel-tabs` / `nw-kb-channel-tab` / `nw-kb-genre-list` / `nw-kb-books-panel` | 书架页 |
| `nw-kb-genre-item` / `-genre-group-header` / `-genre-item-main` / `-genre-item-icon` / `-genre-item-label` / `-genre-toggle` / `-genre-count` | 题材导航 |
| `nw-kb-book-card`* / `nw-kb-toolbar`* / `nw-kb-class-strip`* / `nw-kb-error`* / `nw-kb-picker-`* | 后续 slice（已存在散落规则，见 §4） |

* 这些 block 已存在历史类名，但样式仍散落在 `11-fingerprint-and-workbench.css` 与 `26-cleanup-utilities.css`，
待对应 slice 迁移进 27 号文件。

## 3. Slice A：书架外壳（2026-11-16 完成）

**改动**

- `renderLayout` / `renderLeftSidebar` / `renderBooksTab` / `createGenreNavItem` / `createGenreGroup`
  的布局类从「语义类 + 6~9 个工具类」改为**单一语义类 + 修饰类**。
- 3 处内联 `style`（导航项、通道页签、题材项）改为修饰类
  （`nw-kb-nav-item--active`、`nw-kb-channel-tab--active`、`nw-kb-genre-item--active`）。
- 样式集中到新建的 `styles-src/27-knowledge-base.css`；
  原散落在 11 号（外壳/响应式）与 26 号（书架窄屏）的 KB 规则同步迁出，避免同一选择器两处定义。
- 移除死类 `nw-text-muted-11`（从未在任何样式表定义，属静默失效；移除后外观不变）。

**工具类变化**：本文件命中 311 → 239（−72），其余 block 待后续 slice。

**防倒退验证（规范 §2 R1~R4）**

| 判据 | 结果 |
| --- | --- |
| R1 DOM 结构 | 1177 节点，结构差异 **0** |
| R2 几何 | 矩形差异 **0**（容差 1px） |
| R3 计算样式 | 差异 **0**（首轮暴露 7 处，见下） |
| R4 文本 | 差异 **0** |
| R5 现有单测 | 见提交记录 |
| R6 门禁 | preflight EXIT=0 |
| R7 工具类不增长 | 本模块下降 −72 |

**首轮被基线抓到的两处真实倒退（已修，说明这套门禁有效）**

1. 我给 `.nw-kb-left-sidebar` 加了 `overflow:hidden`（原实现没有）→ 左栏内容溢出行为变化。
2. 导航按钮类选择器 `.nw-kb-nav-btn` 特异性 (0,1,0) 低于 Obsidian 自带的
   `button:not(.clickable-icon)` (0,1,1)，样式没生效、按钮退回默认外观。
   → 改为 `button.nw-kb-nav-btn`。

## 3.5 Slice B：工具栏与书籍卡片（2026-11-16 完成）

**改动**

- 工具栏：`nw-kb-toolbar` / `-toolbar-row` / `-toolbar-action` / `-toolbar-filters` /
  `-filter-group` / `-filter-label` / `nw-kb-select` 全部落地；
  搜索框去掉内联样式。
- 列表：`nw-kb-book-list-container` / `-list-header` / `-list-count` / `nw-kb-book-grid` 落地。
- 卡片（`kb-book-card.ts`）：根：nw-kb-book-card + --selected（替换 is-selected 裸状态类）；头部/标题/状态徽标/警告/元信息/进度/标签/页脚全部语义化；状态色调从内联 STATUS_TONE_STYLES 改为修饰类 --success/--info/--danger/--warning/--muted；进度条宽度改走 CSS 变量 --nw-progress。
- 该文件工具类 39 → **0**，内联 style 4 → **0**。

**发现并修掉的「死类 / 未定义类」（本次最大价值）**

| 类名 | 状态 | 实际后果 |
| --- | --- | --- |
| `nw-kb-book-card` | 从未定义 | 卡片基础样式全靠内联样式 |
| `nw-kb-book-grid` | 从未定义 | 网格布局其实由工具类 `nw-u-d-grid` 撑着；语义类名是空的 |
| `nw-kb-toolbar` | 从未定义 | 同上（工具类撑着） |
| `nw-kb-select` | 从未定义 | 下拉样式由 6 个工具类拼出 |
| `nw-hover-border` | 从未定义 | 卡片 hover 依赖其它文件里的 `.nw-kb-book-card:hover` 侥幸生效 |
| `nw-text-muted-11` / `nw-flex-shrink-0` | 从未定义 | 日期/进度标签/按钮防压缩全部静默失效 |

**防倒退验证**

| 判据 | 结果 |
| --- | --- |
| R1 结构 | **0 差异**（1218 节点，无增删） |
| R2/R3 | 20 处几何 + 24 处样式差异，**全部为有意改动**（见下） |

有意改动（已在基线 `acceptedDiffs` 中记录）：

1. 列表容器改 `flex` 列：原先只靠工具类，滚动与高度分配不稳。
2. 卡片日期/进度标签接上设计意图（11px 弱化色），卡片高度 −5px。
3. 状态徽标改用项目设计 token（`--nw-success/--nw-info/--nw-danger/--nw-warning`），
   与全站一致（原为局部硬编码色）。

**过程中被门禁抓到的真回归（已修）**

- 搜索框：`.nw-kb-search-input` 特异性 (0,1,0) 低于 Obsidian 的 `input[type=text]` (0,1,1)，
  去掉内联样式后外观退回默认输入框 → 改为 `input.nw-kb-search-input` 并复现原取值。
- 质量分颜色一度被改成 `--nw-warning`（#f59e0b），与原 `--text-warning` 不一致 → 已回退。

## 3.6 Slice C：书籍详情公共构件与概览页（2026-11-16 完成）

**改动**

- 公共构件（**所有页签共用**）：
  `createDetailSection` → `nw-kb-detail-section` / `-section-title`；
  `addInfoItem` → `nw-kb-detail-info-item/_label/_value`；
  `renderDetailEmpty` 走 `createEmptyState`（不变）。
- 概览页：信息网格 `nw-kb-detail-info-grid`、简介 `nw-kb-detail-synopsis`、
  维度网格 `nw-kb-detail-dim-grid`、维度卡片 `nw-kb-detail-dim` + `--done/--active/--pending` 修饰类；
  拆解进度块 `nw-kb-detail-progress*`，进度宽度走 CSS 变量。

**防倒退验证（这次是真正的 before/after）**

第一次采集时详情页没渲染（fixture 假书走不到详情），diff 显示 0 差异但**没有覆盖到详情**。
改用「打开项目内真实文件 → 让管理器识别项目 → addBook 真书 → 点卡片」后，详情页渲染出
3 个分区 / 6 个信息项 / 6 个维度卡，再重做 before/after：

| 判据 | 结果 |
| --- | --- |
| R1 结构 | **0 差异** |
| R2 几何 | 63 处，全部是**信息项 label 字号变化导致的高度收缩**（−5px/项、−10px/分区） |
| R3 样式 | 24 处，全部是同一原因（fs 15→11、lh 19.5→14.3、color normal→muted） |
| 其他 | 维度卡配色、网格列数、简介限高 **均无变化** |

有意改动：label 原来挂死类 `nw-text-muted-11`（从未定义，实际继承 15px 正文色），
按设计意图改为 11px 弱化色。基线 `docs/quality/visual-baseline/kb-detail.json` 已记录原因。

**经验教训（已写进规范使用方式）**

视觉基线只能证明「拍到的页面」没变。如果目标区块没渲染出来，0 差异是假绿。
后续每个 slice 采集前必须先确认「目标元素数量 > 0」（本次用 `sections/infoItems/dims` 三项自检）。

## 3.7 Slice D：详情外壳与页签条（2026-11-16 完成）

**改动**

- 详情容器/返回按钮/标题行/操作区/页签条/页签/页签内容区全部语义化：
  `nw-kb-detail-container`、`-back`、`-title-row`、`-title`、`-actions`、
  `-tabs-wrapper`、`-tabs`、`-tab` + `--active`、`-tab-content`。
- 页签选中态从内联样式改为 `--active` 修饰类（同时消掉裸状态类 `is-active`）。
- 该文件工具类 239 → 175。

**防倒退验证（真正的 before/after）**

| 判据 | 结果 |
| --- | --- |
| R1 结构 | 0 差异 |
| R2 几何 | 0 差异 |
| R3 样式 | 首轮 12 处（页签底色/选中色被 Obsidian 默认按钮样式压住）→ 修复后 **0 差异** |
| R4 文本 | 0 差异 |

首轮那 12 处正是「坑 1」：`button:not(.clickable-icon)` 的 (0,1,1) 压过
`.nw-kb-detail-tab` 的 (0,1,0)，页签退化成默认灰底按钮。改为 `button.nw-kb-detail-tab` 后归零。


## 3.8 Slice E：详情各页签内容区（2026-11-17 完成）

**改动**

- 八个页签（文风 / 节奏 / 结构 / 角色 / 伏笔 / 商业 / 易读性 / 技巧）的内容区全部语义化：
  布局用 `nw-kb-detail-chart` / `-chart-row` / `-split` / `-stack` / `-grid`（含 min/fill/cols 修饰类）、
  卡片 `nw-kb-detail-card`（--inset/--roomy/--lg/--xl/--flat/--outlined）、
  统计 `-stat`（--lg/--compact/--mini）+ `-stat-value` / `-stat-label`、
  徽标 `-chip`（--outline/--tiny/--plain/--accent/--solid/--danger/--tone）、
  进度 `-meter`（--grow/--lg）+ `-meter-fill`（--warm）、
  表格 `-table-wrap` / `-table` / `-th` / `-td` / `-thead` / `-tr--alt`、
  折叠条目 `-char-head` / `-char-body` / `-relation-head` / `-technique-head` / `-fore-item-head`。
- 间距不再拼 `nw-u-margin*`，改用模块内 `nw-kb-detail-mt-*/mb-*/ml-*`（只用到的档位）。
- 动态配色从内联 `style` 改为 CSS 变量：`--nw-detail-tone` / `--nw-detail-tone-bg`（段类型色、三线色、
  伏笔重要度、建议严重度、AI 风险等级）与 `--nw-progress`（弧光进度、节奏合规率）。
- 每页签顶部共用的「维度质量评分卡」一并归位：`nw-kb-detail-quality-card/-head/-score/-level/-metrics`、
  `nw-kb-detail-metric` / `-metric-value` / `-metric-label`。
- 该文件：`nw-u-` 工具类引用 **866 → 126（−740）**；内联样式 **28 → 3**（剩 3 处在概览页与标签页，不属本 slice）。
- 27 号样式新增 Slice E 段（网格/卡片/统计/徽标/进度/表格/列表/评分卡等构件）；CSS 预算基线随提交更新：
  唯一类 +168（`.nw-kb-detail-*`）、体积 +21.5KB、1 个 hex 与 1 个 rgba 从 TS 内联搬进 CSS。

**已知有意差异（5 处，全部是原本挂「死类」的节点）**

| 节点 | 原状 | 现在 |
| --- | --- | --- |
| 角色「级别」、伏笔重要度说明、技巧元信息行等 4 处挂 `nw-text-muted-11` | 该类从未定义 → 实际继承父级字号/正文色 | 11px 弱化色（与 Slice C 同一口径） |
| 关系卡折叠箭头挂 `nw-flex-shrink-0` | 该类从未定义 → 会被压缩 | `flex-shrink: 0` |

**防倒退验证（本轮用「声明级等价审计」替代像素快照）**

148 组「旧工具类串 → 新语义类」逐组比对**计算属性并集**（脚本读 `styles-src/` 解析，跳过伪类规则）：

| 判据 | 结果 |
| --- | --- |
| R1 DOM 结构 | 未改结构：映射脚本只替换 `cls:` 字符串值，节点/标签/文本不变 |
| R3 计算样式 | 143/148 完全一致；余 5 组即上表的有意差异 |
| R5 单测 | `book-detail-renderer-tabs` + `tabs2` 共 19 条全过 |
| R6 门禁 | `npm run preflight` EXIT=0 |
| R7 工具类 | 全仓引用 4763 → 3800（基线已收紧） |

**为什么这轮没有 before/after 像素快照**

当时开发 vault `D:\nw-dev-vault` 的插件目录还是**目录联接（junction）**指回源仓，
`<vault>/.obsidian/plugins/novel-writer-ai/data.json` 就是源仓的 `data.json`——
造样本书会写进真实数据文件；而且该 vault 内没有已拆解的书可供八个页签渲染。

2026-11-17 已完成第 1 步（E-补-A）：插件目录改为**真实目录 + 产物同步**，
`data.json` / `data/` / `.sessions/` 由开发 vault 独占，见 [dev-vault.md](../dev-vault.md)。

仍缺第 2 步（E-补-B）：在开发 vault 内准备一本已拆解的样本书，覆盖八个页签都有数据的场景。
在补上之前，跨页签的样式等价以「声明级审计 + 单测 + 门禁」为准，并在提交信息里写明。

## 4. 后续 slice 清单

| # | Slice | 文件 | 目标 |
| --- | --- | --- | --- |
| ~~B~~ | ~~书籍工具栏与卡片~~ | ~~已完成 2026-11-16~~ | ~~工具类 39 → 0~~ |
| ~~C~~ | ~~详情公共构件 + 概览页~~ | ~~已完成 2026-11-16~~ | ~~详情主战场第一刀~~ |
| ~~D~~ | ~~详情外壳与页签条~~ | ~~已完成 2026-11-16~~ | ~~工具类 239 → 175~~ |
| ~~E~~ | ~~详情各页签内容区（文风/节奏/技巧/结构/角色/伏笔/商业/易读性）~~ | ~~已完成 2026-11-17~~ | ~~工具类 866 → 126~~ |
| E-补 | 开发 vault 运行期数据解耦（✅ 2026-11-17）+ 已拆解样本书（待做） | `scripts/dev-vault.mjs` | 解耦已完成，样本书见 §3.8 |
| F | 题材/配置页 | `knowledge-base-view.ts` 后段 | `nw-kb-config-*` |
| G | 弹窗（需人工视觉验收） | `knowledge-detail-modal.ts` / `knowledge-base-modals.ts` | `nw-kb-modal-*` |

每个 slice 都必须走规范 §4 的六步（含 before/after 快照比对）。

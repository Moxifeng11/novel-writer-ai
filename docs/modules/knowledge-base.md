# 知识库 / 设定（视觉重构）

> 模块页（Module Page）。状态：**doing（视觉重构 Slice A 完成 2026-11-16）**
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

## 4. 后续 slice 清单

| # | Slice | 文件 | 目标 |
| --- | --- | --- | --- |
| B | 书籍工具栏与卡片 | `knowledge-base-view.ts`（`renderBooksToolbar` / `createBookCard`） | `nw-kb-toolbar` / `nw-kb-book-card` 归位 |
| C | 详情外壳与概览区 | `book-detail-renderer.ts` 前 1/3 | `nw-kb-detail-*` |
| D | 详情：角色/文风/情感区 | 同上 | 同上 |
| E | 详情：伏笔/商业/易读性区 | 同上 | 同上 |
| F | 题材/配置页 | `knowledge-base-view.ts` 后段 | `nw-kb-config-*` |
| G | 弹窗（需人工视觉验收） | `knowledge-detail-modal.ts` / `knowledge-base-modals.ts` | `nw-kb-modal-*` |

每个 slice 都必须走规范 §4 的六步（含 before/after 快照比对）。

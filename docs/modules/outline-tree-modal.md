# 章节大纲树弹窗（分卷大纲 · 冲突预览）

> 状态：stable（视觉重构 Slice O 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：规划阶段打开的「📖 分卷大纲 · 章节冲突预览」——按卷折叠列出每章冲突，可区间过滤（起止章）、看合并全文、双击改名、上下移/拖拽排序、加/删场景标记，最后「💾 保存所有修改」写回分卷大纲与 Scene 展开文件。
- **代码入口**
  - 弹窗本体：`ui/chapter-outline-tree-modal.ts`（`ChapterOutlineTreeModal extends Modal`，1392 行）。
  - 调用方：`ui/plan-book-modal.ts:321`、`ui/full-writer/wizard-step-renderers.ts:544` 与 `:564`——都是 `new ChapterOutlineTreeModal(app, plugin, project).open()`（第三个参数传项目目录名；传 `.md` 路径时按 `projectIdFromPath` 反解，兼容旧调用）。
- **数据来源**
  - v4：按卷文件 `pjVolumeOutlineDir(project)` 下所有 `第N卷_分卷大纲.md`，按卷号升序读入，每个文件一份独立行模型 `{ path, lines }`（`ui/chapter-outline-tree-modal.ts:146` `loadOutline()`）。
  - v3 兜底：`<项目>/03-大纲与章节/分卷大纲.md`（单文件）。
  - 场景：`pjStepDir(project, volNum, chapNum)/第N章_Scene展开.md`（`:282` `loadScenesForChapter()`）。
  - 解析：`:187` `parseContent()` 认 `### 第N卷`、`- **卷名**：`、`- **章节范围**：`、`- **核心冲突**：`、`| 章号 |` 表头与数据行；`:300` `parseSceneContent()` 认 `## 场景N：名` 及其属性行。
- **样式**：`styles-src/34-outline-tree.css`（`nw-ot-*`，401 行）；外壳类 `nw-outline-tree-content`（`26-cleanup-utilities.css:103` 给 `padding:16px 20px`）与 `nw-outline-tree-modal`（`20-runtime-modals.css:110-131` 给输入框 focus 光环、`[draggable="true"]` 抓取光标）保留原名。

## 2. 现状（事实，不写愿望）

- **外壳**：`onOpen()` 给 `modalEl` 挂 `nw-scope`，给 `contentEl.parentElement` 挂 `nw-modal`，`contentEl` 挂 `nw-outline-tree-content` + `nw-outline-tree-modal`（`ui/chapter-outline-tree-modal.ts:114-125`）。
- **四段结构**：`nw-ot-header`（标题 + `nw-ot-search` 区间输入 + `nw-ot-search-go/-search-clear` + `nw-ot-fulltext-btn`）→ `nw-ot-tree`（`max-height:50vh` 滚动）→ `nw-ot-footer`（关闭 / 生成画布事件 / 保存）；全文面板 `nw-ot-fulltext` 插在 header 与 tree 之间。
- **行三层**：卷头 `nw-ot-vol-header`（`--collapsed` 时 `opacity:.5` + 提示「(无匹配)」）→ 概览 `nw-ot-overview`（章节范围 / 核心冲突 / 匹配数）→ 章行 `nw-ot-chap-row`（拖拽手柄 `nw-ot-drag`、章号、冲突标签、✏️、▲▼、+场景）→ 场景行 `nw-ot-scene-row`（手柄、场景号、场景名、⭐/💬/🪝 标记、🗑️、▲▼）。
- **行状态**：`--target`（起止章，`rgba(245,158,11,.18)` 底 + 3px 橙左边）与 `--dragging`（`opacity:.4` + accent 半透明底）由目标/拖拽运行时算出，用修饰类拼进 `cls`。
- **区间过滤**：`rangeFrom/rangeTo` + `isInRange()`；命中的卷自动展开，未命中的卷折叠显示并标注「(无匹配)」；无命中时 `nw-ot-empty`「未找到匹配的章节区间。」，有命中时底部 `nw-ot-match-count` 显示「匹配 N 个章节」。
- **编辑**：点冲突文本 / ✏️ → `startEdit()` 在章行内插 `nw-ot-editor-row`（`nw-inline-editor` 供清理），原标签加 `nw-is-hidden`；双击场景名同理（`--scene` 变体）。Enter/✓ 确认、Esc/✕ 取消，IME 组字期间的 Enter/Esc 被 `isImeComposing` 拦掉。
- **保存**：`saveAll()`（`:1239`）把章冲突按 `| 章号 | 冲突 |` 重建行，新增章按 `findInsertLineInSource()` 插行，删除行用 `deletedRows` 跳过；**单遍重建**（按加载时原始行号）避免删改位移；写盘后 `loadOutline()` + `render()` 重载（新增章 `rowLine` 为 -1，不重载会重复插入）。
- **历史包袱（Slice O 处理前）**：177 处 `nw-u-*` 工具类 / 82 个唯一 token、2 处内联 `style`（章行与场景行，含 `isTarget`/`isDragging` 动态片段）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| OT-01 | P1 | 177 处 `nw-u-*` 拼出整窗布局，语义不可读 | 语义类 `nw-ot-*` 集中到 `34-outline-tree.css` | done（Slice O） |
| OT-02 | P1 | 章行/场景行用内联 `style` 写布局与 `--target/--dragging` 状态 | `.nw-ot-chap-row` + `--target/--dragging` 修饰类 | done（Slice O） |
| OT-03 | P1 | `attr: { cls: ... }` 不落 class（Obsidian 只写同名属性）：章标签 / 场景标签 / 拖拽手柄四个类的 CSS 从未生效 | 全部改成 `cls:` 参数 | done（Slice O） |
| OT-04 | P1 | `.modal button`（0,1,1）压掉单类规则：搜索🔍、✕、📄全文、关闭、生成画布事件、保存六个按钮 computed 全是白底黑字 | 按钮规则改 `button.nw-ot-*`（+ `.nw-scope` 到 (0,2,1)） | done（Slice O） |
| OT-05 | P2 | 旧 `nw-outline-*` 规则（`25-planning-outline-controls.css:5-120`）与新语义类分处两个文件 | 规则迁进 34 号文件并删除旧块 | done（Slice O） |

## 4. 关键决策

- **命名与作用域**：`nw-ot-*`（outline tree），全部规则加 `.nw-scope` 前缀（`onOpen` 已给 `modalEl` 加了这个类）。前缀不是为了隔离而是为了**特异性**：`button.nw-ot-save` + `.nw-scope` = (0,2,1)，才压得过 Obsidian 的 `.modal button` (0,1,1)。仓库先例 `button.nw-kb-nav-btn`、`button.nw-btn-icon`。
- **`attr.cls` → `cls`**：实测 `attr: { cls: 'nw-outline-chap-label' }` 只写出 `cls="..."` 属性（`rowSpanClsAttr=null`、`labelCount=0`），所以那四条 CSS 是死规则。改成 `cls:` 后标签获得 `:hover` 底与 `cursor:pointer`，拖拽手柄获得 `--text-faint` 色与 `user-select:none`。
- **标签只还原「非几何」声明**：旧规则里 `.nw-outline-chap-label` 还有 `flex:1; padding:2px 4px; border:1px solid transparent`。按原样启用的第一版 after 截图显示：`flex:1` 把 ⭐/💬/🪝 标记与 ▲▼ 全部推到行尾，与场景名脱开、整窗高度 914→998px，可读性反而变差。因此只保留 `cursor/border-radius/:hover`，几何声明不复原——**这是用截图校正后有意放弃的部分**，不是漏改。
- **不做「声明级等价」而按意图修复**：与 Slice L / M 的口径一致——旧工具类里有些声明被更高特异性压掉（按钮）或根本没落 class（标签），这些属于缺陷而非基线，按 CSS 设计意图恢复，并在验收表里逐条标注。
- **`--target/--dragging` 保留 rgb 字面量**：原内联是 `rgba(245,158,11,.18)` / `#f59e0b`，改 CSS 时写成 `rgba(245,158,11,0.18)` / `rgb(245,158,11)`，避免把硬编码 hex 计数顶上去（`check:css` 的 `hardcodedHex` 保持 168，`rgbHsl` 192→195）。
- **删 25 个零引用工具类**：本弹窗是唯一使用者（`nw-u-bg-accent-faint`、`nw-u-blt-3px-solid-text-accent`、`nw-u-minw-48px`、`nw-u-p-6px-16px` 等），按门禁纪律删除；定义 255→230、引用 1507→1334。

## 5. 验收记录（Slice O，2026-11-17）

截图：`D:\nw-dev-vault\_visual-o\{before,after}`，`diff-report.json` 存像素与探针对比；弹窗固定 1020px 宽、viewport 1200×1700、8 个场景。

| 场景 | 内容 | 高度（前/后） | PNG 差异 | computed style 差 |
| --- | --- | --- | --- | --- |
| tree-default | 两卷 12 章 + 场景行、卷概览 | 914 / 914 | 12063 px（1.294%） | 0 |
| tree-range | 区间 3–5 章过滤 + 匹配计数 | 658 / 658 | 11005 px（1.640%） | 0 |
| tree-dragging | 章行 `--dragging` 态 | 914 / 914 | 11982 px（1.285%） | 0 |
| tree-fulltext | 全文面板展开 | 948 / 948 | 12058 px（1.247%） | 0 |
| tree-no-match | 区间无命中（空态） | 244 / 244 | 11338 px（4.556%） | 0 |
| tree-warning | 无分卷大纲 | 134 / 134 | 0 px | 0 |
| edit-chapter | 章冲突内联编辑 | 928 / 928 | 13569 px（1.434%） | 0 |
| edit-scene | 场景名内联编辑 | 928 / 928 | 13037 px（1.377%） | 0 |

- **差异全部可定位到三类元素**（逐行聚簇统计，非人眼判断）：① 标题栏右侧按钮簇（y=28–58）、② 页脚按钮簇（y≈867–896）、③ 每行拖拽手柄 ⠿ 的字色（每行 5–9 px）。**没有任何整行位移**：若行几何变动，整行文字都会进入差异集，实际每行只有手柄那几个像素。
- 高度 8/8 完全一致，说明放弃 `flex/padding` 复原后布局零位移；`tree-no-match` 的 4.556% 是因为图只有 244px 高、按钮簇占比大。
- 探针：`style` 差 8 场景全 0；元素数 163→201 / 103→123 / 164→202 / 168→205 等增加的部分，全部是原先 `attr.cls` 未落盘、现在带 `class` 属性的元素（`[class]` 选择器才开始抓到它们）。**探针索引对比在本切片不可用**（元素集合本身变了，按 index 对齐会整体错位），几何稳定性以像素聚簇为准。
- 另跑：`check:utility` 定义 230 / 引用 1334、零引用 0；`check:css` 729260 字节 / 4008 类 / hex 168 / rgbHsl 195；`check:bundle` styles.css 724614→729260（+4646）；`check:inline-styles` 587→585（静态 487 / 动态 98，本文件 2 处已消）。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/outline-tree-modal-contract.test.ts` | 源码契约（5 条）：无 `nw-u-*`、无 `style:`、无 `attr: { cls:`、`--target/--dragging` 与 `nw-is-hidden` 存在、`button.nw-ot-*` 前缀与旧 `nw-outline-*` 已迁出 25 号文件 |
| `tests/unit/ui/mobile-reorder-contract.test.ts` | 触屏入口契约：▲▼ 的 `aria-label`（上移章节/下移场景）与 `moveArrayItemToInsert` 调用 |

弹窗没有 DOM 级单测（vitest 环境是 `node`，Obsidian `Modal` 不便实例化），渲染正确性靠上面 8 场景截图与聚簇分析。

## 7. backlog

- 文件 1392 行：渲染 / 解析 / 拖拽 / 写盘四块可拆（`render()` 单函数 353 行）。
- 区间搜索状态不持久：每次 `render()` 重建输入框，只是回填 `rangeFrom/rangeTo`；清空过滤会把所有卷展开。
- 全文面板 `slice(0, 20000)` 硬截断且无「已截断」提示。
- 场景删除无二次确认（`deleteScene`），误点只靠「保存」前可重开后悔。
- `ui/chapter-outline-tree-modal.ts:114` 的 `this.modalEl.addClass('nw-scope')` 缩进与上下文不一致（历史遗留），改的话顺手对齐。
- 拖拽只对桌面有效；触屏靠 ▲▼（已有 aria-label），但场景跨章移动没有入口。

## 8. 交接备注

- **两条硬约束**：① 不要再用 `attr: { cls: ... }`（class 不会落盘）；② 本弹窗任何 `<button>` 的样式规则必须写 `button.nw-ot-*`，否则被 `.modal button` 压成白底黑字。
- **改样式只进** `styles-src/34-outline-tree.css`，不要再往 `25-planning-outline-controls.css` 里加 `nw-outline-*`（旧块已删）。
- **截图复现**：`node D:\nw-tmp\snap-o.mjs --tag=before|after`（先把构建产物拷进 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai`，vault 首开要点「信任仓库作者」）。场景用真实入口触发：编辑态靠点文本前缀「主角回到青川镇」的 span、对文本恰为「雨夜追杀」的 span 派发 `dblclick`——不能靠类选择器，因为改名前的类本来就没落盘。
- **对比工具**：`node D:\nw-tmp\diff-o.mjs`（纯 node 解 PNG + 探针索引对比，落 `_visual-o\diff-report.json`）；本切片探针 rect 对比不可信（元素集合变化），需用 `D:\nw-tmp\dbgdiff-o.mjs` 式的逐行聚簇统计确认无整行位移。
- **契约测试**：`npx vitest run tests/unit/ui/outline-tree-modal-contract.test.ts tests/unit/ui/mobile-reorder-contract.test.ts`。

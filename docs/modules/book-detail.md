# 书籍详情渲染（book-detail-renderer）

> 状态：stable（视觉重构 Slice S 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：知识库书架点开某本书后，右栏详情区的全部内容——概览（书名/作者/字数/题材分类）、角色、文风、情感、节奏、伏笔、商业、质量评分、标签等页签。本切片收口的是其中三块此前未语义化的区块：**题材分类卡（分类信息 + Top3 分类建议 + 次要题材标签）**、**质量评分卡（总评分 + 十维评分条 + 雷达图）**、**标签页（题材/手法/自定义标签 + 新增输入框）**。
- **代码入口**
  - 渲染器：`ui/views/book-detail-renderer.ts`（2206 行），`export class BookDetailRenderer`，通过 `BookDetailRendererDeps` 注入 kb/kbManager/app、8 个数据 getter、`getCurrentBook` 与若干格式化/回调。
  - 本切片三块：`renderGenreInfo(container, book)`（`:833`，由 `renderBookDetail` 在 `:725` 调用）、`renderQualityChart(container, book)`（`:954`，`:729` 调用）、`renderBookTagsTab(container, book)`（`:2082`，公开方法，由视图片签分发调用）。
  - 共用信息项：`addInfoItem(container, label, value)`（`:827`，注释在 `:821`）。
  - 雷达图：`ui/svg-charts.ts`（`SmartChart`，本切片未改）。
  - 数据聚合：`ui/views/book-detail-metrics.ts`（`buildQualityScoreItems` / `resolveScoreTone` 等）。
- **数据来源**：`BookBasicInfo`（`qualityScores`、`themeTags` / `techniqueTags` / `customTags`、`genreChannel`、`primaryGenre`、`primarySubGenre`、`secondaryGenres`、`genreRecommendations`）；题材名解析走 `kb.getGenre(id)` / `getSubGenre(genreId, subGenreId)`。
- **样式**：`styles-src/27-knowledge-base.css` 末尾「Slice S」段（`:2887` 起，246 行 / 5445 字节），类前缀 `nw-kb-detail-*`，与 Slice C/D/E 共用同一命名空间（**没有**新建 37 号样式文件）。复用既有 `.nw-kb-detail-card` / `.nw-kb-detail-card--xl` / `.nw-kb-detail-text`。

## 2. 现状（事实，不写愿望）

- **题材分类卡**：`nw-kb-detail-card nw-kb-detail-card--xl` → 头部 `nw-kb-detail-card-header`（标题 `nw-kb-detail-card-title` + 动作区 `nw-kb-detail-card-actions`，两个 `nw-btn nw-btn-secondary nw-btn-xs`）→ 三行 `nw-kb-detail-field`（`-field-label` / `-field-value` / `-confidence` 百分比）→ 分类建议 `nw-kb-detail-rec-section`（`-rec-title` + 每条 `-rec-row`：`-rec-main`（`-rec-rank` / `-rec-name`）+ `-rec-bar` 内 `-bar-fill`）→ 次要题材 `nw-kb-detail-subgenres`（`-subgenre-list` + `-subgenre-tag`）。
- **质量评分卡**：`nw-kb-detail-quality`（左 `-quality-radar` 放 `svg`，右 `-quality-scores`）→ 总评分块 `-quality-overall`（`-overall-value` / `-overall-label`）→ 十行 `-score`（`-score-top` 内 `-score-name` / `nw-text-sm-muted` / `-score-na`，下接 `-score-bar` 内 `-bar-fill`）。
- **标签页**：`-tag-group`（+ `--spaced`）分别渲染题材/手法/自定义三组 → 自定义标签额外带 `-tag--custom` 包裹与 `-tag-del` 删除按钮 → 新增区 `-tag-add`（`input[type='text'].nw-kb-detail-tag-input` + `nw-btn` 添加按钮）；三个分组都没有标签时给 `.nw-kb-detail-text` 空态文案。
- **进度条口径**：分类建议条与评分条共用 `nw-kb-detail-bar-fill`，宽度由 JS `fill.style.setProperty('--nw-kb-detail-pct', pct + '%')` 写入，CSS 侧 `width: var(--nw-kb-detail-pct, 0%)`。
- **历史包袱（Slice S 处理前）**：126 处 `nw-u-*` 工具类拼样式、3 处 `attr: { style: '...' }` 内联样式（标签输入框、两处 fill 宽度）；两个一直没定义的死类 `nw-flex-shrink-0`、`nw-text-muted-11` 仍在引用。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SS-01 | P0 | 126 处 `nw-u-*` 拼出三个区块的全部排版，语义不可读 | 语义类 `nw-kb-detail-*` 集中在 `27-knowledge-base.css` 的 Slice S 段 | done（Slice S） |
| SS-02 | P1 | 3 处内联样式：标签输入框整串 `style`、两条进度条 `fill.style.width` | 输入框改语义类；宽度改 CSS 变量 `--nw-kb-detail-pct` | done（Slice S） |
| SS-03 | P1 | 标签输入框样式被 Obsidian `input[type=text]`（(0,1,1)）压掉，写单类不生效 | 选择器改 `input[type='text'].nw-kb-detail-tag-input` | done（Slice S） |
| SS-04 | P2 | `.nw-rec-row` / `:hover` 只在分类建议里用一次，散落在 `26-cleanup-utilities.css` | 折进 `nw-kb-detail-rec-row`，删除旧规则（-6 行） | done（Slice S） |
| SS-05 | P2 | 死类 `nw-flex-shrink-0`（应 `flex-shrink:0`）、`nw-text-muted-11`（应 11px 弱化色）从未定义 | 按设计意图在其语义类里补真 | done（Slice S，含 `addInfoItem` 先例注释 `:821-826`） |

## 4. 关键决策

- **2026-11-17 不新建样式文件**：本题材/评分/标签三块本来就属于知识库模块，前缀沿用 Slice C/D/E 的 `nw-kb-detail-*`，规则追加到 `styles-src/27-knowledge-base.css` 末尾。理由：同一模块两套前缀会让「哪些类属于书籍详情」失去单点；代价是该文件涨到 3132 行。
- **2026-11-17 卡片直接复用 `.nw-kb-detail-card / --xl`**：旧工具类串 `nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px` 与 `--xl` 的声明逐条相同（padding16 / secondary / radius8），因此没有新增 `-genre-card` 之类的重复类。
- **2026-11-17 进度条新类而不是复用 `.nw-kb-detail-meter-fill`**：后者带 `transition: width 0.3s`，旧内联宽度是瞬时赋值；复用它会给这两个条引入补间，等于新增动效。故新建 `nw-kb-detail-bar-fill`（无 transition），宽度统一走变量。
- **2026-11-17 标签输入框必须元素限定**：Obsidian 的 `input[type=text]` 是 (0,1,1)，单类 `.nw-kb-detail-tag-input` (0,1,0) 会被压成默认外观；写成 `input[type='text'].nw-kb-detail-tag-input` (0,2,1) 才稳定（与 Slice N 的 `button.nw-st-*` 同法）。
- **2026-11-17 两处死类按意图补真**：`nw-flex-shrink-0` → `-field-label{flex-shrink:0}`；`nw-text-muted-11` → `-confidence{font-size:11px;color:var(--text-muted)}`。沿用同文件 `addInfoItem` 的先例（`:824-826` 注释：原 label 挂的 `nw-text-muted-11` 从未定义，按设计意图补上 11px 弱化色）。这是本切片唯一的视觉差异，且是「原设计就该这样」。
- **2026-11-17 结果型样式收敛**：`-quality-radar` 的 `min-width:320px`、`-rec-bar` 的 `width:80px`、`-rec-rank` 的 `width:16px` 等固定尺寸全部保留原值（不做响应式改造），保证像素等价。
- **2026-11-17 hover 用显式属性**：`-rec-row` 的过渡写 `transition: background 0.15s`（禁止 `transition: all`，`tests/unit/ui/panel-resizer-and-motion.test.ts:108` 有硬断言）。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` / `npm run build` | 0 错；`[styles] 拼接 42 个源文件 → styles.css（30240 行）` | 构建日志 |
| 2026-11-17 | 单测 `book-detail-renderer-tabs` + `tabs2` + `book-detail-logic` + `book-detail-metrics` | 4 files / 69 tests 通过 | vitest |
| 2026-11-17 | before/after 像素（4 场景，真机 dev vault，720px 宽） | `02-quality` / `03-tags` / `04-tags-empty` PNG **0 px**、struct/style/rect 探针全 0；`01-genre` **610 px（0.274%）**，仅三处置信度百分比由 13px 正常色变 11px 弱化色（SS-05 有意补真），高度 4/4 一致 | `D:\nw-dev-vault\_visual-s\{before,after}` + `D:\nw-tmp\diff-s.mjs` 报告 |
| 2026-11-17 | 三联裁剪目视 | after 只三个百分比变小变灰，其余含次要题材标签逐像素一致 | `D:\nw-tmp\crop-s-genre.png` |
| 2026-11-17 | 四道门禁 | `check:inline-styles` 563（-3）、`check:utility` 144 类 / 702 次（删 18 个零引用）、`check:css` 759136 B / 4142 类、`check:bundle` 全部通过 | 基线 JSON 已带 note |
| 2026-11-17 | `npm run preflight` | EXIT=0，959 文件 / 10118 通过 + 3 skipped | `D:\nw-tmp\preflight-s.log` |

## 6. 测试清单

- 纯逻辑：`tests/unit/ui/book-detail-metrics.test.ts`（评分档位/维度映射）、`tests/unit/ui/book-detail-logic.test.ts`（标签与页签判定）。
- UI/DOM：`tests/unit/ui/book-detail-renderer-tabs.test.ts`、`tests/unit/ui/book-detail-renderer-tabs2.test.ts`（假 DOM 渲染 8 个页签)。
- 回归：`tests/unit/ui/kb-*panel*.test.ts`（共享 `nw-kb-detail-*` 类，改 CSS 时先跑这一组）。
- 实机检查点：有题材 / 无题材（`getGenre` 返回 null 时不崩）、`qualityScores.commercial = null` 的 N/A 行、三类标签全空、单条建议、超长子题材名换行。

## 7. 剩余 backlog（P2/P3）

- [ ] `book-detail-renderer.ts` 覆盖率仅 0.42%（2206 行 / 2 个函数被 import），可把 `renderGenreInfo` / `renderQualityChart` / `renderBookTagsTab` 的数据准备再抽一层纯函数（沿用 `book-detail-metrics` 模式）。
- [ ] 分类建议与评分条共用的 `-bar-fill` 可由一处 helper 统一设置 `--nw-kb-detail-pct`，目前是两处各写一行。
- [ ] 标签页空态文案与知识库其它空态（`.nw-empty-info-card`）尚未统一。
- [ ] 雷达图 `svg` 的尺寸仍写死在 `svg-charts.ts`，窄栏（<360px）下会被 `-quality-radar` 的 `min-width:320px` 撑出横向滚动。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户剩 `ui/full-writer/scene-outline-controller.ts`（123）、`ui/settings/knowledge-section.ts`（108）、`ui/polish-editor.ts`（104）、`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。用户已同意「再做前三个 + lint 冻结」路线。
- **已知坑（本轮新踩）**
  1. **DeferredView**：知识库视图可能以延迟视图恢复（`view.constructor.name === 't'`，只有 base 方法），截图脚本必须先 `await leaf.loadIfDeferred()`，仍不是真视图再 `setViewState({type:'novel-writer-knowledge-base', active:true})`；否则报 `kb view / renderer not ready`，且是间歇性的。
  2. **题材 id 要用真数据**：假 id 会让 `kb.getGenre` 返回 null，分类建议与次要题材渲染成空串，截图看起来「少了一块」。正确取法是 `view.kb.getGenresByCategory('male')` + `kb.getSubGenres(g1.id)`。
  3. **dev vault 是真实目录**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 必须手工 `Copy-Item main.js,styles.css`；`scripts/dev-vault.mjs sync` 指向的是 `C:\Users\admin\nw-dev-vault`。
  4. **CRLF**：本仓 TS/CSS 多为 CRLF，整段字符串替换前后要 normalize 再还原，否则断言失败或静默不匹配。
- **脚本**（仓外临时，勿提交）：`D:\nw-tmp\snap-s.mjs`（4 场景，`--tag=before|after`）、`D:\nw-tmp\diff-s.mjs`、`D:\nw-tmp\crop-s.mjs`。

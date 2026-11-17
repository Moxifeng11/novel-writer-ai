# 大纲智能扩写编辑器（弹窗）

> 状态：stable（视觉重构 Slice M 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：选中正文段落或整章大纲 → 命令「✨ 智能大纲扩写」打开编辑器——左栏列出场景 / 段落（可逐项展开、可逐项采用/跳过），右栏是「编辑 / 对比」双视图，底部「🔄 重新生成 / 取消 / ✅ 应用」。
- **代码入口**
  - 命令：`core/command-registry.ts:123`（`CommandIds.OUTLINE_EXPAND`，名「✨ 智能大纲扩写」，`group: WritingAssistant`）；`:610-613` 的 `editorCallback` → `void this.ui.executeCommand(CommandIds.OUTLINE_EXPAND, { editor })`。
  - 命令落点：`ui/command-ui-executor.ts:676-690` `outlineExpand(editor?)`——`sourceText = 选区 || 全文`，`mode = 选区 ? 'paragraph' : 'chapter'`，`targetWords: 3000`。
  - 协同工作台入口：`ui/co-writing-view.ts:2217-2235` `handleOutlineExpand()`，同样按选区决定模式，`targetWords` 用 `Math.max(500, len * 2)`，并传 `chapterContext { project, volumeNum, chapterNum }`。
  - 弹窗本体：`ui/outline-expand-modal.ts`（`OutlineExpandModal extends Modal`，942 行）。
- **依赖**
  - 扩写引擎：`engine/outline-to-text-expander.ts:147` `OutlineToTextExpander`（`expandChapterToScenes` / `expandSceneToParagraphs` / `expandParagraph`），策略 `conservative|standard|aggressive`。
  - 场景解析：`engine/scene-expander.ts:353` `splitSceneSections(content)`。
  - 对比与字数：`shared/diff-utils` 的 `lineDiff` / `countWords`。
  - 正文格式契约：`engine/body-writer.ts` `BodyWriter.resolveContract(project)`（分隔符等），缺省回落 `DEFAULT_BODY_FORMAT`。
- **数据来源**
  - 正常路径：编辑器选区或全文（内存）。
  - 回退路径：正文为空且带 `chapterContext` 时读本章 Scene 展开——`pjStepFile(project, volNum, chapNum, 'Scene展开')`（`shared/paths.ts:336`，即 `<项目>/…/第N章_Scene展开.md`），去掉 frontmatter 与一级标题后 `splitSceneSections` 直接填左栏。
- **样式**：`styles-src/25-outline-expand.css`（`nw-oe-*`；Slice M 前只有 67 行，布局全在 TS 里）。

## 2. 现状（事实，不写愿望）

- **外壳**：`onOpen()` 给 `modalEl` 挂 `nw-scope` + `nw-modal-xl` + `nw-oe-modal`（`25-outline-expand.css:9` 定 `height:80vh; max-height:90vh`），`contentEl` 挂 `nw-oe-content`（列向 flex、`padding:0`）。
- **三层结构**：`nw-oe-header`（标题 + 模式切换 `nw-oe-switch` + 策略下拉 + 目标字数 + 关闭）→ `nw-oe-main`（左 `nw-oe-left` 320px / 右 `nw-oe-right`）→ `nw-oe-footer`。
- **三种扩写模式**：`chapter`（整章→场景列表）、`scene`（场景→段落）、`paragraph`（段落多选）；切模式会 `renderHeader` + `renderLeftPanel` + `renderFooter` 同步重建——`renderHeader` 里先 `this.headerEl?.remove()`，否则会叠出多层标题栏。
- **逐场景采纳**：`sceneExpansions: Map<number, {text, adopted}>`，采用/跳过改 `adopted` 后 `rebuildAdoptedText()` 拼出待应用正文；未扩写的场景保留 `## 场景N：…` 原文，避免整篇丢内容。
- **段落多选**：`selectedParagraphIndices: Set<number>`，`expandSelectedParagraphs()` 只扩选中的段落。
- **应用语义**：`applyResult()` 只 `showSuccessNotice('已应用扩写结果')` 并关闭弹窗，正文写回由调用方通过 `getExpandedText()` 取走（当前两个入口都没有真正写回）。
- **历史包袱**：Slice M 前本文件共 220 处 `nw-u-*` 工具类，另有 1 处内联 `style`（段落列表项，且把 `hover:` 当成声明写进了 style 字符串，浏览器直接忽略）；场景项的 `nw-expand-scene-*` / `nw-expand-adopt-*` 规则散落在 `styles-src/25-planning-outline-controls.css:185-219`，与本弹窗的样式分处两个文件。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| OE-01 | P1 | 220 处 `nw-u-*` 拼出整窗布局，语义不可读、样式分散在 TS | 语义类 `nw-oe-*` 集中在 `25-outline-expand.css` | done（Slice M） |
| OE-02 | P1 | 段落项用内联 `style` 写布局与选中态，`hover:` 伪声明无效 | `nw-oe-para-item` + `:hover` + `--selected` | done（Slice M） |
| OE-03 | P2 | 场景项的 `nw-expand-*` 定义在规划样式文件里，与弹窗样式分家 | 迁进 `25-outline-expand.css` 并改名 `nw-oe-scene-*` | done（Slice M） |
| OE-04 | P2 | 进度条用 `nw-u-d-none` 切换显示 | `nw-is-hidden` 修饰类 | done（Slice M） |

## 4. 关键决策

- **命名**：`nw-oe-*`（outline expand），状态用 `--active/--adopted/--skipped/--selected/--on` 修饰类，显隐用 `nw-is-hidden`；壳类 `nw-oe-modal/content/tab/select/word-input/diff-line` 沿用原有定义。
- **不加 `.nw-scope` 前缀**：弹窗 `modalEl` 虽然挂了 `nw-scope`，但 Slice M 的验收口径是「声明级等价」（像素 0 差），而新规则都是单类 (0,1,0)——若加前缀变成 (0,2,0) 反而会改变已有级联结果。按钮本来就走共享 `nw-btn`，其余构件在 Obsidian 基础样式里没有同名覆盖，6 个场景的 computed style 探针逐项相等。将来若出现被 `.modal button` 类规则压掉的情况，按 Slice H 约定补前缀。
- **等价审计靠探针而非人眼**：每个场景记录 32 个 computed style 键 + `getBoundingClientRect` + tag/cls，before/after 逐元素对齐比较；PNG 逐像素只作为兜底。
- **段落项 hover 按设计意图修正**：老代码把 `hover:background:…` 写进 `style` 值，浏览器当无效声明丢弃，段落项其实从未有 hover 反馈；语义化时改成真正的 `:hover` 伪类——变化只在鼠标悬停时出现，静态截图像素差为 0。
- **删掉 19 个零引用工具类**：这些类在本弹窗语义化后全仓零引用（`nw-u-p-16px-20px`、`nw-u-w-320px`、`nw-u-rg-8px` 等），按门禁纪律删除。注意 `.nw-u-b-1px-dashed-background-`（类名以 `-` 结尾）会被 `\b` 正则误判为零引用，实际仍被 `ui/settings/knowledge-section.ts:203` 使用，已保留。

## 5. 验收记录（Slice M，2026-11-17）

截图：`D:\nw-dev-vault\_visual-m\{before,after}`，`diff-report.json` 存像素与探针对比；1300×800、6 个场景。

| 场景 | 内容 | PNG 差异 | 探针（struct / style / rect） |
| --- | --- | --- | --- |
| modal-chapter-empty | 整章模式空态（开始扩写按钮） | 6 px（maxDelta 6，bbox x=0 竖线） | 0 / 0 / 0 |
| modal-scene-list | 3 个场景 + 采用中 / 已跳过 | 7 px（maxDelta 9，bbox x=0 竖线） | 0 / 0 / 0 |
| modal-paragraph-list | 2 段、未选中 | 0 px | 0 / 0 / 0 |
| modal-diff | 编辑/对比切换后的 diff 双栏 | 5 px（maxDelta 4，bbox x=0 竖线） | 0 / 0 / 0 |
| modal-edit | 默认编辑视图 | 3 px（maxDelta 4，bbox x=0 竖线） | 0 / 0 / 0 |
| modal-progress | 进度条显示态 | 0 px | 0 / 0 / 0 |

- 像素差全部落在 `x=0` 的 1px 竖列（弹窗左边缘描边抗锯齿），无成片差异；`cls` 差异 42–63 条均为预期改名。
- 另跑：`check:utility` 定义 267 / 引用 1699、零引用 0；`check:inline-styles` 602（静态 497 / 动态 105，本弹窗那 1 处已消）；`check:css` 715979 字节 / 3931 类；`check:bundle` styles.css 710602→715979。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/outline-expand-modal-contract.test.ts` | 源码契约：无 `nw-u-*`、无 `style:`、场景/段落修饰类存在、进度条用 `nw-is-hidden`、`nw-expand-*` 已迁出规划样式 |

该弹窗没有 DOM 级单测（vitest 环境是 `node`，Obsidian `Modal` 不便实例化），渲染正确性主要靠上面 6 场景截图与探针。

## 7. backlog

- 三个动作（拆分 / 扩写 / 应用）与渲染都堆在 942 行文件里，可按 `render*` 与 `expand*` 拆成两个模块。
- `applyResult()` 从不落盘，只发通知；两个入口也没取 `getExpandedText()` 写回正文——需明确「谁负责写」。
- `wordTolerance = 0.2` 写死，无 UI；`targetWords` 只在标题栏改，切换模式时不自适应。
- 切到 `paragraph` 模式不清空 `selectedSceneIndex`，`scene` 模式下未选中场景时点「重新生成」无反馈。
- 场景摘要截断 60 字、段落正文截断 80 字，均为硬编码。

## 8. 交接备注

- **改这个弹窗前先跑契约测试**：`npx vitest run tests/unit/ui/outline-expand-modal-contract.test.ts`；新增样式只进 `25-outline-expand.css`，不要回写 `nw-u-*`。
- **截图复现**：`node D:\nw-tmp\snap-m.mjs --tag=before|after`（需先把构建产物拷进 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai`，并在 vault 里信任仓库作者）。弹窗会开进残留的 about:blank 副窗，`executeCommand` 前必须先 `page.evaluate(() => { window.activeWindow = window; window.activeDocument = document; })`，否则 `.modal` 定位超时。
- **对比工具**：`node D:\nw-tmp\diff-m.mjs`（纯 node 解 PNG + 探针对比，输出 `_visual-m\diff-report.json`）。
- **待决策**：`applyResult()` 要不要真正写回当前章节正文？目前只是关闭弹窗，用户点「✅ 应用」后内容不会进文档——这是产品语义问题，不只是代码问题。

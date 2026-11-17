# 大纲智能扩写编辑器（弹窗）

> 状态：stable（视觉重构 Slice M 2026-11-17；缺口 1 写回正文 2026-11-18）　｜　最后更新：2026-11-18　｜　Owner：dsh

## 1. 定位

- **用户视角**：选中正文段落或整章大纲 → 命令「✨ 智能大纲扩写」打开编辑器——左栏列出场景 / 段落（可逐项展开、可逐项采用/跳过），右栏是「编辑 / 对比」双视图，底部「🔄 重新生成 / 取消 / ✅ 写入正文」（有写回目标时直接改写当前编辑器；没有回调时降级为「📋 复制到剪贴板」）。
- **代码入口**
  - 命令：`core/command-registry.ts:123`（`CommandIds.OUTLINE_EXPAND`，名「✨ 智能大纲扩写」，`group: WritingAssistant`）；`:610-613` 的 `editorCallback` → `void this.ui.executeCommand(CommandIds.OUTLINE_EXPAND, { editor })`。
  - 命令落点：`ui/command-ui-executor.ts:676-710` `outlineExpand(editor?)`——`sourceText = 选区 || 全文`，`mode = 选区 ? 'paragraph' : 'chapter'`，`targetWords: 3000`；`:691-707` 传 `onApply` 完成写回（选区未变 → `replaceSelection`；选区已变 → 光标处 `replaceRange`；无选区 → 第 0 行到末行 `replaceRange` 整篇替换并把光标归位）。
  - 协同工作台入口：`ui/co-writing-view.ts:2217-2261` `handleOutlineExpand()`，同样按选区决定模式，`targetWords` 用 `Math.max(500, len * 2)`，并传 `chapterContext { project, volumeNum, chapterNum }`；`onApply`（`:2237-2258`）一律走 `applyProgrammaticEdit(...)` 写回 `rightEditor`。
  - 弹窗本体：`ui/outline-expand-modal.ts`（`OutlineExpandModal extends Modal`，990 行）。
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
- **应用语义**（缺口 1 起改）：`applyResult()` 是 `async`，取 `expandedText.trim()` 后走构造参数 `onApply(text)`——有回调就 `await onApply`，成功发「已写入正文（Ctrl+Z 可撤销）」并关窗，抛错则 `showErrorNotice('写回正文失败', { detail })` 并**保持弹窗打开**（结果不丢）；无回调时降级 `navigator.clipboard.writeText`，成功发「已复制扩写结果到剪贴板」并关窗，剪贴板不可用则只警告不关窗。`getExpandedText()` 仍保留（对外 API，当前无调用者）。
- **写回落在哪**：命令面板入口写当前 `Editor`（`replaceSelection` / `replaceRange`）；协同工作台写 `rightEditor` 并刷新快照、高亮、光标与 dirty 标记（自动保存挂在 `input` 上，直接改 `.value` 会丢字）。
- **历史包袱**：Slice M 前本文件共 220 处 `nw-u-*` 工具类，另有 1 处内联 `style`（段落列表项，且把 `hover:` 当成声明写进了 style 字符串，浏览器直接忽略）；场景项的 `nw-expand-scene-*` / `nw-expand-adopt-*` 规则散落在 `styles-src/25-planning-outline-controls.css:185-219`，与本弹窗的样式分处两个文件。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| OE-01 | P1 | 220 处 `nw-u-*` 拼出整窗布局，语义不可读、样式分散在 TS | 语义类 `nw-oe-*` 集中在 `25-outline-expand.css` | done（Slice M） |
| OE-02 | P1 | 段落项用内联 `style` 写布局与选中态，`hover:` 伪声明无效 | `nw-oe-para-item` + `:hover` + `--selected` | done（Slice M） |
| OE-03 | P2 | 场景项的 `nw-expand-*` 定义在规划样式文件里，与弹窗样式分家 | 迁进 `25-outline-expand.css` 并改名 `nw-oe-scene-*` | done（Slice M） |
| OE-04 | P2 | 进度条用 `nw-u-d-none` 切换显示 | `nw-is-hidden` 修饰类 | done（Slice M） |
| OE-05 | P1 | 点「✅ 应用」只弹提示、从不写回正文，两个入口也都没取 `getExpandedText()` | 应用即写回当前编辑器/协同编辑区，失败不关窗 | done（缺口 1，2026-11-18） |

## 4. 关键决策

- **命名**：`nw-oe-*`（outline expand），状态用 `--active/--adopted/--skipped/--selected/--on` 修饰类，显隐用 `nw-is-hidden`；壳类 `nw-oe-modal/content/tab/select/word-input/diff-line` 沿用原有定义。
- **不加 `.nw-scope` 前缀**：弹窗 `modalEl` 虽然挂了 `nw-scope`，但 Slice M 的验收口径是「声明级等价」（像素 0 差），而新规则都是单类 (0,1,0)——若加前缀变成 (0,2,0) 反而会改变已有级联结果。按钮本来就走共享 `nw-btn`，其余构件在 Obsidian 基础样式里没有同名覆盖，6 个场景的 computed style 探针逐项相等。将来若出现被 `.modal button` 类规则压掉的情况，按 Slice H 约定补前缀。
- **写回走回调而不是让弹窗碰编辑器**：弹窗只负责产出文本，`onApply` 由入口提供。原因有两个编辑宿主（`Editor` 与协同视图的 `textarea`，后者必须走 `applyProgrammaticEdit` 才有快照/dirty），弹窗同时依赖两者会把 UI 绑死在具体视图上。
- **选区变了就退化为光标插入**：弹窗开着时用户可能切走光标，把结果硬塞回旧区间会覆盖用户没看的内容；先比对 `getSelection() === selectedText` / `value.slice(start,end) !== selectedText`，不一致就插在光标处。先例是 `ui/expand-text-modal.ts:207-216`。
- **失败必须保持弹窗**：扩写结果是 AI 长文本，写盘失败（编辑器已关闭、选区越界）时关窗等于丢结果；因此 `applyResult` 对 `onApply` 抛错只报错不关窗，`copyToClipboard` 失败同理。
- **整章模式整篇替换**：无选区时语义是「整章扩写」，结果是完整正文，因此 `replaceRange` 覆盖 0..末行再 `setCursor({line:0,ch:0})`，而不是追加到文末。
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

### 5.1 缺口 1：写回正文（2026-11-18）

实机验收 `D:\nw-tmp\verify-writeback.mjs`（Playwright `connectOverCDP` + 临时 user-data-dir + `D:/nw-dev-vault`，结果落 `D:/nw-tmp/verify-writeback.json`），五个实机用例全部 PASS：

| 用例 | 路径 | 输入 → 期望 | 实测 |
| --- | --- | --- | --- |
| A | 命令面板 · 有选区 | 全选「原始段落内容保持不变」→ 扩写「扩写后的段落」 | 正文 = `扩写后的段落`，弹窗关闭 |
| B | 命令面板 · 无选区 | 「整章原文内容」→「整章扩写结果」 | 正文 = `整章扩写结果` |
| C | 协同工作台 · 整段选中 | `原始句子内容` 选区 0..6 →「扩写后的句子」 | `扩写后的句子`，光标 6 |
| D | 协同工作台 · 部分选中 | `甲乙丙丁` 选区 0..2 →「扩写后的句子」 | `扩写后的句子丙丁`（尾部上下文保留） |
| E | 协同工作台 · 无选区 | `整章原文内容` →「整章扩写结果」 | 整篇被替换 |

门禁：`npx tsc --noEmit` 0 错；`npm run build` 通过；`npm run preflight` EXIT=0（960 文件 / 10124 通过 + 3 skipped）；
样式类门禁全部不变（`check:inline-styles` 525 / `check:utility` 46 定义·142 引用 / `check:css` 786456 字节），`check:bundle` 仅 main.js 因新增写回分支上调 1355B（已 `--update-baseline --note`）。

驱动要点：命令面板场景调 `plugin.commandUiPort.outlineExpand(view.editor)`（`main.ts:1020` 的实例名就是 `commandUiPort`）；协同场景先 `await plugin.activateCoWritingView()` 再 `leaves[0].view.handleOutlineExpand()`；弹窗右侧是 `.nw-oe-right textarea`，写 `value` 后必须 `dispatchEvent(new Event('input'))`（`oninput` 才会写回 `expandedText`），按钮在 `.nw-oe-footer` 里按文案「写入正文」找。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/outline-expand-modal-contract.test.ts` | 源码契约：无 `nw-u-*`、无 `style:`、场景/段落修饰类存在、进度条用 `nw-is-hidden`、`nw-expand-*` 已迁出规划样式 |
| `tests/unit/ui/outline-expand-apply-writeback.test.ts` | 应用语义 6 条：有回调→收到 trim 文本并关窗；同步/异步抛错→不关窗；无回调→写剪贴板并关窗；剪贴板不可用→不关窗；空结果→不回调不关窗 |

该弹窗没有 DOM 级单测（vitest 环境是 `node`，Obsidian `Modal` 不便实例化），渲染正确性主要靠上面 6 场景截图与探针。

## 7. backlog

- 三个动作（拆分 / 扩写 / 应用）与渲染都堆在 942 行文件里，可按 `render*` 与 `expand*` 拆成两个模块。
- 写回目前是「整篇替换 / 替换选区」两种粗粒度：想在指定章节落盘（而不是当前编辑器）还没有入口。
- 「复制到剪贴板」降级路径没有 toast 之外的反馈，也没有历史记录。
- `wordTolerance = 0.2` 写死，无 UI；`targetWords` 只在标题栏改，切换模式时不自适应。
- 切到 `paragraph` 模式不清空 `selectedSceneIndex`，`scene` 模式下未选中场景时点「重新生成」无反馈。
- 场景摘要截断 60 字、段落正文截断 80 字，均为硬编码。

## 8. 交接备注

- **改这个弹窗前先跑契约测试**：`npx vitest run tests/unit/ui/outline-expand-modal-contract.test.ts`；新增样式只进 `25-outline-expand.css`，不要回写 `nw-u-*`。
- **截图复现**：`node D:\nw-tmp\snap-m.mjs --tag=before|after`（需先把构建产物拷进 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai`，并在 vault 里信任仓库作者）。弹窗会开进残留的 about:blank 副窗，`executeCommand` 前必须先 `page.evaluate(() => { window.activeWindow = window; window.activeDocument = document; })`，否则 `.modal` 定位超时。
- **对比工具**：`node D:\nw-tmp\diff-m.mjs`（纯 node 解 PNG + 探针对比，输出 `_visual-m\diff-report.json`）。
- **写回已实现**（缺口 1，2026-11-18）：`onApply` 回调由入口提供，别再让弹窗自己碰编辑器。改这块先跑 `npx vitest run tests/unit/ui/outline-expand-apply-writeback.test.ts`，再跑一次实机脚本 `node D:\nw-tmp\verify-writeback.mjs`（前置：把 `main.js`/`styles.css`/`manifest.json` 拷进 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai`）。

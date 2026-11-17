# 文笔润色编辑器与 AI 润色弹窗（polish-editor）

> 状态：stable（视觉重构 Slice V 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**
  - 全屏写作视图「✏️ 文笔润色编辑器」区域：一段带实体高亮的正文可编辑区（人物/地点/势力/物品四种颜色标记），标题行三颗按钮（✨ AI润色 / 📊 节奏分析 / 🎨 风格指南）与「💾 已保存」状态，下挂可叠加的节奏分析面板与作者风格指南面板。
  - 「✨ AI润色」弹窗：选择润色范围（全文/选中）、风格、是否带写作指纹，加载态 → 结果态 → 一键应用到正文。
- **代码入口**
  - `ui/polish-editor.ts`（830 行，LF 行尾）。两个导出：`export class PolishEditor`（`:134`）与 `export class PolishAIPolishModal extends Modal`（`:493`）。
  - `PolishEditor`：`async render(area, stepResults, project, chapDir, chapterName, volume, onSaved?)`（`:161`，`stepResults['bodyGeneration']` 为空或项目为空时直接 return）→ 分割线 `:179` / 标题行 `:182` / 图例 `:200` / 编辑区 `:250`；`renderRhythmPanel(area, result, editorDiv)`（`:379`）、`renderStylePanel(area, guide)`（`:436`）。
  - `PolishAIPolishModal`：`onOpen()`（`:527`）→ `renderInputForm()`（`:540`）/ `runPolish()`（`:646`）→ `renderLoading()`（`:632`）→ `renderResult()`（`:766`）→ `applyResult()`（`:814`）。
  - 挂载点：`ui/full-writer-view.ts:633` `this.polishEditor = new PolishEditor(this.stepRunner, this.plugin)`；`:2310` `await this.polishEditor.render(...)`。弹窗由 `:312` `new PolishAIPolishModal(...)` 打开。
- **数据来源**：正文取自 `stepResults['bodyGeneration']`；实体名走 `stepRunner.getEntityNames(project)`（`:215`）；节奏分析是 `RhythmAnalysis`（段落级 `segments[]` + `slowSegments` / `fastSegments` / `suggestions`）；风格指南是纯文本（按 `【】` 标题与 `偏好风格：/避免风格：/-` 行前缀解析）；写入走 `stepRunner.writeFixToBody`。
- **样式**：新建 `styles-src/39-polish-editor.css`（5842 字节 / 286 行 / 47 个类，样式源 44 → 45）。编辑区侧不带 `.nw-scope`（全屏写作视图本身在 scope 内）；弹窗侧（`modalEl.addClass('nw-scope')`，`:530`）的说明文字用 `.nw-scope .nw-pe-hint` 系列。外壳类 `novel-writer-polish-editor` 保留（`styles-src/20-runtime-modals.css:1181` 有它的 `:focus` 与实体 tag hover 规则）。

## 2. 现状（事实，不写愿望）

- **标题行**：`nw-pe-divider`（hr，margin 16 0 12 0，边框色 `--background-modifier-border`）→ `nw-pe-header`（flex / center / space-between）→ `nw-pe-title-group`（flex / center / gap8 / flex-wrap）内 `nw-pe-title`（h4）+ 三颗 `button.nw-btn.nw-pe-btn`（12px / padding 2 10）；右侧 `nw-pe-status`（11px / muted）。
- **图例**：`nw-pe-legend`（flex / wrap / gap10 / mb8 / 11px）内四个 `nw-pe-legend-item nw-pe-legend-item--char|--loc|--faction|--item`，配色是**字面 8 位 hex**（`#e74c3c22` 底 + `#e74c3c44` 边框 + `#e74c3c` 文字等四组），与 `buildEntityMarkedFragment` 注入正文的实体色保持一致。
- **编辑区**：`novel-writer-polish-editor nw-pe-editor`（原 10 条内联样式全量复刻：min-height 300 / max-height 500 / overflow-y auto / padding 12 / 边框 / radius 6 / 13px / line-height 1.8 / pre-wrap / background-primary / `--font-text`）。
- **节奏面板**：`nw-rhythm-panel nw-pe-panel`（margin 8 0 / padding 12 / 边框 / radius 6 / bg secondary）→ `nw-pe-panel-header`（flex / space-between）+ `nw-pe-panel-title` + `button.nw-pe-close-btn`（✕，11px / padding 1 6）；总览 `nw-pe-overview` 里两颗指标 span 用 `nw-pe-text--warning` / `nw-pe-text--success`；建议块 `nw-pe-block` + `nw-pe-subtitle` + `nw-pe-suggestion`；段落详情 `nw-pe-detail`（max-height 200 / overflow-y auto）内每行 `nw-pe-seg-row`（`--issue` 时加橙底 `rgba(245,158,11,.1)`）+ `nw-pe-seg-icon` / `-seg-type` / `-seg-metric`（`--warning` 密度<30 / `--error` 密度>85 / `--success` 紧张>80）/ `-seg-issue`。
- **风格面板**：`nw-style-panel nw-pe-panel`，空态 `nw-pe-empty-text`；有内容时 `nw-pe-style-content`（12px / line-height 1.6）内按行分类：`-style-heading`（【】标题）/ `-style-pref`（✅ 偏好风格）/ `-style-avoid`（❌ 避免风格）/ `-style-item`（- 条目）/ `-style-line`（普通行）。
- **弹窗**：`onOpen` 清空 `modalEl` 后按三态渲染。表单态：`nw-pe-hint`（12px muted，修饰 `--tight` / `--section` / `--below` 三种间距）、`nw-pe-checkbox`、`nw-pe-toggle-label`；加载态 `nw-pe-muted` + `nw-pe-hint`；结果态 `nw-pe-hint--below` + 结果文本 + 重试/应用按钮。
- **历史包袱（Slice V 处理前）**：104 处 `nw-u-*` 工具类、3 处内联 `style` 字符串（编辑区 10 条声明整串、图例四项 `${color}22`/`${color}44` 模板、结果态/加载态各 1 处），以及 `slowSegments.length > 0 ? '...nw-u-c-text-warning' : ''` 这类条件工具类串。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| PE-01 | P0 | 104 处 `nw-u-*` 拼出标题行/图例/面板/弹窗全部排版，语义不可读 | `nw-pe-*` 语义类集中到新建 `styles-src/39-polish-editor.css` | done（Slice V） |
| PE-02 | P1 | 图例四项用 `attr.style` 拼 `background:${color}22;border:1px solid ${color}44;color:${color}` | 四个 `nw-pe-legend-item--<tone>` 修饰类，值原样搬进 CSS | done（Slice V） |
| PE-03 | P1 | 编辑区 10 条样式写在一个 300+ 字符的内联串里 | `.novel-writer-polish-editor.nw-pe-editor` 一条规则（特异性 0,2,0 压过外壳类） | done（Slice V） |
| PE-04 | P1 | 节奏面板条件配色/间距用三元拼 `nw-u-*` 串 | 改 `cls` 修饰类（`--warning` / `--error` / `--success` / `--issue`） | done（Slice V） |
| PE-05 | P2 | `nw-rhythm-panel` / `nw-style-panel` 只是 JS 移除钩子，CSS 零定义 | 原样保留，不改成语义类（无声明可复刻） | done（Slice V） |
| PE-06 | P1 | **`PolishAIPolishModal` 的私有字段 `selection` 与 Obsidian `Modal.open()` 写回的选区字段同名**，`open()` 后 `this.selection` 变成 DOM Selection → `renderInputForm` 抛 `TypeError: this.selection.trim is not a function`。HEAD 上同样存在 | 改字段名（如 `selectionText`）或改用局部变量 | backlog（超出语义化范围，需单独修） |

## 4. 关键决策

- **2026-11-17 新建 39 号样式文件**：文笔润色横跨「编辑区 + 两个浮层面板 + 一个 Modal」，共 47 个类；塞进 `20-runtime-modals.css`（该文件已 1200+ 行）会让职责继续发散。新建后 `nw-pe-*` 自成一段，弹窗与编辑区共用一个命名空间。
- **2026-11-17 图例保留字面 8 位 hex，不用 `color-mix`**：原内联是 `${color}22` / `${color}44`（append alpha 到 hex），等价语义可用 `color-mix(in srgb, #e74c3c 13%, transparent)` 表达，但 `0x22/255 = 13.3%` 取整后会差 1~2 个色阶，在像素验收里就是可测量的差异。选择把 8 位 hex（`#e74c3c22` 等 12 个字面色）直接写进 CSS，代价是 `check:css` 的 hex 计数 +12（已写进基线 note）。
- **2026-11-17 编辑区用「外壳类 + 追加类」而不是新外壳类**：`novel-writer-polish-editor` 在 20 号文件里有 `:focus` 与实体 tag hover 规则，改名要同步改那份 CSS 且可能影响 Slice 前的行为；改成 `novel-writer-polish-editor nw-pe-editor`，新规则选择器写成 `.novel-writer-polish-editor.nw-pe-editor`（0,2,0）以稳定压过外壳类的默认值。
- **2026-11-17 条件配色一律改修饰类**：`result.slowSegments.length > 0 ? 'nw-u-c-text-warning' : ''` 这类串在 CSS 里没有对应规则时等于空操作；改成语义修饰类后，「拖沓段 > 0 才变橙」的意图第一次写进样式表。
- **2026-11-17 按钮统一 `button.nw-pe-btn`**：Obsidian 对 `button` 有 `(0,1,1)` 的基线规则，裸类 `.nw-pe-btn`（0,1,0）压不住；同时 `.nw-btn` 外壳类仍在（提供 padding/border 基线），`nw-pe-btn` 只补 12px 字号与 2/10 内边距。
- **2026-11-17 不修 PE-06（selection 冲突）**：这是真实功能缺陷（弹窗在真实点击下会崩），但修它属于行为改动、且会改变本次「像素等价」的验收前提（真修好后弹窗内容会变化）；本轮只把它写进 backlog 与交接备注。
- **2026-11-17 不做响应式/暗色适配**：`max-height:500px`、`min-width:60px` 等固定值原样保留，目标是 8 场景像素零差异（结果达成）。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` / `npm run build` | 0 错；`[styles] 拼接 45 个源文件 → styles.css（31072 行）`，esbuild v4.96.1 | 构建日志 |
| 2026-11-17 | 单测 `polish-editor-project-d6` + `full-writer-view-contracts` | 2 文件 / 20 用例通过 | vitest |
| 2026-11-17 | before/after 像素（8 场景，真机 dev vault，720 宽宿主 / 560 宽弹窗） | **8/8 PNG 0 px**；probes struct 0 / style 0 / rect 0（cls 差为改名的预期差异） | `D:\nw-dev-vault\_visual-v\{before,after}` + `D:\nw-tmp\diff-v.mjs` |
| 2026-11-17 | 几何复核（0.01px 精度，8 场景全元素） | rect / scroll / box / 14 项计算样式差异 0 | `D:\nw-tmp\diag-v.mjs` → `_visual-v\diag-{before,after}` |
| 2026-11-17 | 四道门禁 | `check:inline-styles` 542（-5）、`check:utility` 84 类 / 367 次（删 19 个零引用）、`check:css` 775975 B / 4218 类、`check:bundle` 全部通过 | 四份基线 JSON 已带 note |
| 2026-11-17 | `npm run lint` | 0 error（1102 warning，均存量） | eslint |
| 2026-11-17 | `npm run preflight` | **EXIT=0**：959 文件 / 10118 通过 + 3 跳过；check:bundle main.js 5630471 / styles.css 775975；check:release v4.96.1 | `D:\nw-tmp\preflight-v2.log` |

## 6. 测试清单

- 项目路径透传：`tests/unit/ui/polish-editor-project-d6.test.ts`（`:8` / `:35` / `:38` / `:53`，断言 D6 项目的 `project` 参数与 `chapDir` 传参）。
- 视图契约：`tests/unit/ui/full-writer-view-contracts.test.ts`（面板挂载与行为，不断言本文件的类名）。
- 无 DOM 渲染单测：本文件的排版只能靠 before/after 像素脚手架验证（见 §8）；新增类名断言前应先补一个 `render()` 的 DOM 冒烟测试。
- 实机检查点：空 `bodyGeneration` 早退、图例四色与正文高亮一致、节奏面板 `--issue` 行底色、风格指南 `【】` 标题分档、弹窗三态（表单/加载/结果）切换、结果应用回正文。

## 7. 剩余 backlog（P2/P3）

- [ ] **PE-06**：`PolishAIPolishModal.selection` 与 `Modal.open()` 的选区字段同名，真实点击会崩（`this.selection.trim is not a function`）；改字段名即可，但需补一条「打开弹窗 → 表单渲染」的冒烟测试。
- [ ] 830 行仍混着「编辑区渲染 / 节奏面板 / 风格面板 / 弹窗」四件事，可按 Slice M 思路拆成 2~3 个文件（编辑区 + 面板 + 弹窗）。
- [ ] `nw-rhythm-panel` / `nw-style-panel` 是无 CSS 定义的 JS 钩子，可改成 `data-*` 属性或直接删除（需先确认没有别处 querySelector）。
- [ ] 图例四组颜色与 `buildEntityMarkedFragment` 的 `colorConfig` 是两处独立常量，可合并成一个来源（目前靠 `tone` 名对齐，容易漂）。
- [ ] 弹窗说明文字用 `.nw-scope .nw-pe-hint*` 前缀，编辑区不用；两套作用域规则并存，未来可统一到面板根节点。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户剩 `ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。用户（m09227）已要求「按顺序直接做完全部」，本轮 Slice V 是第一站。
- **已知坑（本轮新踩）**
  1. **Obsidian `Modal.open()` 会覆写同名字段**：`this.selection` 在 `open()` 后被写成 DOM Selection，弹窗真正渲染会崩（PE-06）。截图脚手架用 `Object.defineProperty(m,'selection',{get/set 只接受 string})` 绕过；**不要**为了让截图能跑就去改产品代码。
  2. **before 侧也要打钩子**：worktree checkout 出来的 HEAD 没有 `window.__nwPolish`，脚本会报 `hook missing`；先在 worktree 的 `ui/polish-editor.ts` 末尾补同一段 `// TEMP-SNAP-HOOK` 再 build，截完从主仓删除并重建。
  3. **像素验收要重采一次**：本轮第一次 after 采集在 `02/03/05/06` 出现 1~226 px 的 1px 边缘差异；重采后 8/8 为 0，且「同一构建两次采集」互差同样是 226 px —— 说明是新开 Obsidian 首轮启动状态影响了边缘合成像素，不是重构建引入的。**判定标准：重采后若归零即为噪声，若稳定复现才是真差异。**
  4. **小工具的参数别忘 Number**：`crop-v2.mjs` 一开始直接用 `process.argv` 字符串做下标运算（`'300' + 0`），生成的对比图全黑；坐标必须先 `+arg`。
  5. **dev vault 是真实目录**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 必须手工 `Copy-Item main.js,styles.css`（`scripts/dev-vault.mjs sync` 指向的是 `C:\Users\admin\nw-dev-vault`）。
  6. **本文件是 LF 行尾**（与 Slice S/T 的 CRLF 文件不同）：整段字符串替换前先确认行尾，避免 normalize 后误把 CRLF 写回。
- **脚本**（仓外临时，勿提交）：`D:\nw-tmp\snap-v.mjs`（8 场景，`--tag=before|after`）、`D:\nw-tmp\diff-v.mjs`（PNG + 35 键探针）、`D:\nw-tmp\diag-v.mjs`（0.01px 几何复核）、`D:\nw-tmp\crop-v2.mjs`（三联裁剪，参数：文件 x0 y0 x1 y1 缩放 输出）。

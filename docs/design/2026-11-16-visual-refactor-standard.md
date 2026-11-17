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
| 知识库 / 设定（`kb-`） | 完成：Slice A–I（书架 / 工具栏卡片 / 详情公共构件+概览 / 外壳页签条 / 各页签内容区 / 题材配置页 / 四个管理弹窗 / 批量导入弹窗 / 读书拆解详情弹窗）；H 用独立 `nw-bi-*`、I 用 `nw-kd-*` 命名空间，后续新页签沿用同一模式 | `docs/quality/visual-baseline/kb-books.json`、`kb-detail.json`；F 截图 `D:\nw-dev-vault\_visual-fg\`、G 截图 `_visual-g\`、H 截图 `_visual-h\`、I 截图 `_visual-i\`（未入库） |

### 5.1 工具类退场进度（`nw-u-*`）

定义全部集中在 `styles-src/10-entity-and-utilities.css`，门禁 `npm run check:utility`。
检查项：A 重名后缀、B `cls:` 字面量死引用、B2 源码全文死引用（覆盖 `addClass()` 与模板串）、
D 零引用死定义，外加 C 定义数与使用量只许下降。
**纪律：新代码不得新增 `nw-u-*`；已在用的类随所属模块切片换成语义类。**

2026-11-17 清理后实测（脚本口径：扫 `ui/engine/services/shared/core/domains/utils` + `main.ts`）：

| 指标 | 数值 |
| --- | --- |
| 定义 | 230 个（清理前 430；Slice H 删 13 个、Slice I 删 30 个、Slice J 删 11 个、Slice K 删 20 个、Slice L 删 13 个、Slice M 删 19 个、Slice N 删 12 个、Slice O 删 25 个零引用类） |
| 零引用定义 | 0（清理前 57，已删） |
| 引用但未定义的类 | 0（清理前 5：真实缺陷 1 处 `nw-u-w-full-2` 已删，另 4 处是 `tests/` 断言与历史文档示例） |
| TS 引用 | 230 个类 / 1334 次（`check:utility` 口径，`cls:` 字面量；Slice O 后） |
| `styles.css` 体积 | 724614 字节（Slice G 后 641829；Slice H 新增 `nw-bi-*` 段约 1060 行；Slice I 新增 `nw-kd-*` 段 17545 字节；Slice J 新增 `30-wizard-steps.css` 约 290 行；Slice K 新增 `31-monitor-panel-b.css` +9128 字节；Slice L 新增 `styles-src/32-fingerprint.css` 16887 字节，净 +17223 字节，同时删掉 13 个零引用工具类；Slice M 新增 `nw-oe-*` 段约 220 行，净 +5377 字节，同时删掉 19 个零引用工具类；Slice N 新增 `styles-src/33-prompt-manager.css` 307 行 / 9411 字节，净 +8635 字节，同时删掉 12 个零引用工具类；Slice O 新增 `styles-src/34-outline-tree.css` 401 行 / 8342 字节，同时迁移 `25-planning-outline-controls.css` 的旧 `nw-outline-*` 段并删掉 25 个零引用工具类，净 +4646 字节） |

清理记录：删除 57 个零引用声明级工具类；去掉 `ui/views/writing-fingerprint-view.ts` 里 `addClass('nw-u-w-full-2')`（类从未定义，等于空操作，删除后渲染不变）；Slice L 随指纹库语义化再删 13 个零引用类（定义 299 → 286）；Slice M 随扩写弹窗语义化再删 19 个零引用类（定义 286 → 267）；Slice N 随提示词管理设置语义化再删 12 个零引用类（定义 267 → 255）；Slice O 随章节大纲树语义化再删 25 个零引用类（定义 255 → 230）。

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

剩余存量大户（下一批切片候选，按引用次数；`ui/batch-import-modal.ts` 365 处在 Slice H 清零、`ui/knowledge-detail-modal.ts` 294 处在 Slice I 清零、`ui/full-writer/wizard-step-renderers.ts` 265 处在 Slice J 清零、`ui/monitor-panel-b.ts` 232 处在 Slice K 清零；Slice L 清零 `ui/views/writing-fingerprint-view.ts` 228 处 + `ui/fingerprint-detail-modal.ts` 157 处 + `ui/views/fingerprint-v2-detail.ts` 20 处；Slice M 清零 `ui/outline-expand-modal.ts` 220 处；Slice N 清零 `ui/prompt-manager-settings.ts` 192 处；Slice O 清零 `ui/chapter-outline-tree-modal.ts` 177 处，均不在表内）：

| 文件 | 引用 | 文件 | 引用 |
| --- | --- | --- | --- |
| `ui/views/knowledge-base-view.ts` | 175 | `ui/rendering/context-panel.ts` | 173 |
| `ui/settings/general-sections.ts` | 160 | `ui/views/book-detail-renderer.ts` | 126 |
| `ui/full-writer/scene-outline-controller.ts` | 123 | `ui/settings/knowledge-section.ts` | 108 |
| `ui/polish-editor.ts` | 104 | `ui/refill-modal.ts` | 97 |
| `ui/views/kb-stats-panel.ts` | 81 | `ui/settings/deconstruction-section.ts` | 47 |

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
| 知识库 / 设定（`kb-`） | 进行中：Slice A–F 完成（书架 / 工具栏卡片 / 详情公共构件+概览 / 外壳页签条 / 各页签内容区 / 题材配置页）；剩 G 弹窗 | `docs/quality/visual-baseline/kb-books.json`、`kb-detail.json`；F/G 截图存开发 vault `D:\nw-dev-vault\_visual-fg\`（未入库） |

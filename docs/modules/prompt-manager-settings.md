# 提示词管理设置（设置页 · 4 个子页签 + 5 个弹窗）

> 状态：stable（视觉重构 Slice N 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：设置 → 写作 → 「提示词模板」区块。四个子页签——📝 提示词模板（左分类 + 模板列表 + 右侧详情：版本历史 / 系统提示词 / 用户提示词 / 可用变量）、🧪 A/B 测试（开关 + 测试卡 + 展开详情 + 优胜条 + 操作按钮）、📊 使用统计（调用记录列表）、📦 导入/导出（导出 JSON / 导入 JSON）。另有 5 个弹窗：新建模板、编辑模板、新建版本、创建 A/B 测试、结束测试。
- **代码入口**
  - 挂载点：`ui/settings/writing-sections.ts:545` —— `TemplateSection.render()` 里 `const manager = new PromptManagerSettings(this.app, this.plugin, section); manager.render();`。
  - 本体：`ui/prompt-manager-settings.ts`（`PromptManagerSettings`，1083 行；4 个 `render*Tab` + 8 个 `render*` 子渲染 + 5 个 `show*Modal`）。
  - 子页签外壳：`nw-settings-subtab-bar` / `nw-settings-subtab(.is-active)` / `nw-settings-subtab-content`，定义在 `styles-src/06-cowrite-missing-and-dark.css:756-792`，**本切片未改动**。
- **数据**
  - 服务：`services/prompt-manager.ts`（`PromptManager`，含 `normalizePromptManagerConfig` 宽松归一化：顶层类型不对回退默认，数组逐项过滤）。
  - 类型：`shared/prompt-manager-types.ts`（`PromptTemplate` / `PromptTemplateVersion` / `ABTest` / `ABTestStatus` / `PromptUsageRecord` / `PromptManagerConfig`）。
  - 默认模板：`services/prompt-templates-default.ts` 的 `DEFAULT_PROMPT_TEMPLATES`。
  - 持久化：插件 `data.json` 的 `settings.promptManagerConfig`（`main.ts:665` 声明，`:1088-1093` 构造时 `getConfig` 读、变更写回）。
  - 纯逻辑：`ui/prompt-manager-logic.ts` 的 `buildVariantStatRows`（只在有样本时产出评分/质量/修改率行）。
- **样式**：`styles-src/33-prompt-manager.css`（Slice N 新建，307 行 / 9411 字节，全部 `nw-pm-*` 单类选择器）。

## 2. 现状（事实，不写愿望）

- **四个页签由 `render()` 全量重建**：切分类、选模板、切状态都是改字段后 `this.render()`，没有增量更新。
- **模板页三栏**：`nw-pm-layout`（flex + gap 16）→ `nw-pm-sidebar`（260px，`flex-shrink:0`，内含搜索框 + `nw-pm-category-list` + `nw-pm-template-list`（`max-height:400px; overflow-y:auto`）+ `nw-pm-add-btn`）/ `nw-pm-main`（`flex:1; min-width:0`，详情或空态）。
- **分类按钮**：5 类按钮（全部 / 章节生成 / scene / dialogue / 其他），选中态用 `nw-pm-category-btn--active`；「全部」多一个 `--all` 修饰类（`margin-bottom:4px`，其余项 2px）——两档间距是旧实现就有的细节。
- **模板项**：`nw-pm-template-item`（padding 8px 10px / radius 4 / pointer / mb 2），选中 `--selected` 换 `--background-modifier-hover`；自定义模板挂 `nw-pm-badge--custom`（inline-block）。
- **版本徽标**：`nw-pm-version-badge`（span，可点切换版本），当前版本 `--active` 用强调底色 + `--text-on-accent`，其余次底色 + `--text-muted`。
- **A/B 状态**：Slice N 前由 `getStatusStyle(status)` 返回内联样式串，现在改为 `getStatusClass(status)` 返回 `nw-pm-status--draft|--running|--paused|--completed`，用法 `cls: \`nw-pm-status \${this.getStatusClass(test.status)}\``（未匹配时回落 `--draft`）。
- **两个 A/B 徽标**：模板页自定义徽标、变量「必填」徽标、使用记录「A/B A」徽标共用 `nw-pm-badge` + 修饰类；`--ab` **显式 `display:inline`**（见 §4）。
- **弹窗**：5 个 `Modal` 子类都在同一文件里，footer 按钮沿用共享类 `nw-modal-footer` / `nw-modal-btn-primary` / `nw-modal-btn-secondary`；两处长 textarea 的十几个工具类改成一个 `nw-pm-textarea`。
- **历史包袱**：Slice N 前本文件 192 处 `nw-u-*`（56 行）、15 处内联 `style`；模板项、分类按钮、A/B 卡的选中态全都靠内联样式三元表达式拼字符串。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| PM-01 | P1 | 192 处 `nw-u-*` 拼布局，语义不可读 | 语义类 `nw-pm-*` 集中在 `33-prompt-manager.css` | done（Slice N） |
| PM-02 | P1 | 15 处内联 `style`（模板项/分类按钮/A/B 卡/状态标签/文件输入/textarea） | 全部改类 + 修饰类，`getStatusStyle()` → `getStatusClass()` | done（Slice N） |
| PM-03 | P2 | 模板项与「全部」分类按钮的间距差藏在三元表达式里 | `--all` 修饰类显式表达 | done（Slice N） |
| PM-04 | P2 | `nw-u-*` 退场后 12 个工具类全仓零引用 | 删除定义并收紧基线（267 → 255） | done（Slice N） |

## 4. 关键决策

- **命名**：`nw-pm-*`（prompt manager），状态一律用 `--custom/--required/--ab/--active/--selected/--danger/--primary/--primary-lg/--all/--push-end` 修饰类。
- **不加 `.nw-scope` 前缀**：设置页整体不在 `.nw-scope` 容器里（`writing-sections.ts` 直接往 section 里渲染），加前缀会导致规则命中不到；全部用单类 + 一个需要压过 Obsidian 默认按钮样式的场景用 `button.` 前缀。
- **`button.` 前缀是必需的，不是风格选择**：Obsidian 自带按钮规则（`--interactive-normal` 底色 / `--text-normal` 前景）会盖掉单类选择器。第一轮 after 截图里分类按钮、`nw-pm-btn--danger`、`nw-pm-btn--primary-lg` 全部退回白底黑字（PNG 差 1.1%–1.9%），把 9 条按钮规则改成 `button.nw-pm-*` 后 style 探针归零。仓库内既有先例：`button.nw-kb-nav-btn`（`27-knowledge-base.css:80`）、`button.nw-btn-icon`（`08-workbench-v7-v8.css:390`）。
- **`--ab` 徽标保留 `display:inline`**：旧代码里「自定义」「必填」徽标都带 `nw-u-d-inline-block`，唯独使用记录的 `A/B A` 徽标没有——若统一成 inline-block，行高从 15.6px 变 17px，整页高度 +3px。这里按「逐项等价」保留 inline，并在 CSS 里写明原因。
- **等价审计靠探针而非人眼**：11 个场景各记录 32 个 computed style 键 + `getBoundingClientRect`（取整）+ tag/cls，before/after 逐元素对齐；PNG 逐像素只作兜底。
- **删掉 12 个零引用工具类**：`nw-u-bg-background-modifier-er`、`nw-u-bg-interactive-accent`、`nw-u-c-text-on-accent`、`nw-u-d-inline-block`、`nw-u-gap-16px`、`nw-u-m-0-0-4px-0`、`nw-u-m-16px-0-8px-0`、`nw-u-marginleft-8px`、`nw-u-maxh-400px`、`nw-u-p-8px`、`nw-u-resize-vertical`、`nw-u-w-260px`——它们此前只被本文件使用。

## 5. 验收记录（Slice N，2026-11-17）

截图：`D:\nw-dev-vault\_visual-n\{before,after}`，`diff-report.json` 存像素与探针对比；harness 900px 宽、viewport 1200×1700、11 个场景（6 页签态 + 5 弹窗）。假数据：5 个模板（t1 自定义带 2 版本 / 2 变量）、1 个 running A/B 测试（winner a）、4 条使用记录。

| 场景 | 内容 | PNG 差异 | 探针（struct / style / rect） |
| --- | --- | --- | --- |
| templates-empty | 分类 + 列表，未选模板（空态提示） | 0 px | 0 / 0 / 0 |
| templates-detail | 选中 t1：版本徽标 / 系统与用户提示词 / 变量网格 | 874 px（0.138%，maxDelta 8，仅最底 1px 扫描线） | 0 / 0 / 0 |
| abtests-empty | 开关 + 空态 + 创建按钮 | 0 px | 0 / 0 / 0 |
| abtests-expanded | 展开测试卡：指标网格 / 优胜条 / 操作按钮组 | 0 px | 0 / 0 / 0 |
| usage-list | 4 条使用记录（含 A/B 徽标） | 0 px | 0 / 0 / 0 |
| import-export | 导出卡 + 导入卡 + 主按钮 | 0 px | 0 / 0 / 0 |
| modal-create-template | 新建模板弹窗 | 0 px | 0 / 0 / 0 |
| modal-edit-template | 编辑模板弹窗（含「另存为新版本」开关） | 0 px | 0 / 0 / 0 |
| modal-add-version | 新建版本弹窗（两个 textarea） | 0 px | 0 / 0 / 0 |
| modal-create-test | 创建 A/B 测试弹窗 | 0 px | 0 / 0 / 0 |
| modal-finish-test | 结束测试弹窗（优胜条 + 备注） | 0 px | 0 / 0 / 0 |

- `templates-detail` 的 874 px 全部落在 `y=704` 这一行（容器底边抗锯齿，239→233，Δ≤8/255）：内容总高存在 <0.5px 的取整差，探针 `rect` 取整后全等，实际布局无位移。
- `cls` 差异每场景 0–50 条，全部为预期改名（`nw-u-*` / 内联 style → `nw-pm-*`）；五个弹窗的探针 cls 差为 0（弹窗内改动集中在 footer 共享类与 textarea，探针未追踪到）。
- 另跑：`check:utility` 定义 255 / 引用 255 类 1507 次 / 零引用 0（基线已收紧）；`check:css` 724614 字节 / 28663 行 / 唯一类 3994；`check:bundle` styles.css 715979 → 724614（+8635）；`check:inline-styles` 587（静态 488 / 动态 99，本文件 15 处已消）；`npm run build:styles` 拼接 39 个源文件。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/prompt-manager-settings-dom.test.ts` | 用 `FakeEl` / `stubCreateDiv` 渲染四个页签，断言文案与 `nw-settings-subtab-bar` / `nw-settings-subtab-content`（6 用例，Slice N 后仍全过） |
| `tests/unit/ui/prompt-manager-logic.test.ts` | `buildVariantStatRows` 的样本阈值与行内容 |
| `tests/unit/services/prompt-manager.test.ts` | `PromptManager` 的模板归一化、版本切换、A/B 与使用记录 |

没有 DOM 级「样式回归」单测：`vitest` 环境是 `node`，Obsidian 的 `Modal` 与 CSS 计算都不便实例化，渲染等价性靠上面 11 场景截图 + 探针。

## 7. backlog

- 文件 1083 行：4 个页签 + 5 个弹窗可拆成 `prompt-manager-settings.ts`（页签）与 `prompt-manager-modals.ts`（弹窗）。
- `render()` 全量重建，切分类/选模板都重画整页；模板多时可以把列表拆成独立渲染。
- 分类按钮与模板项的选中态由 `this.render()` 驱动，键盘导航（方向键 / Enter）没有实现。
- 使用统计没有分页与清空入口，记录只增不减。
- 导入是「覆盖现有自定义配置」，没有 dry-run 预览与冲突提示。

## 8. 交接备注

- **改这个文件前先跑**：`npx vitest run tests/unit/ui/prompt-manager-settings-dom.test.ts`；新增样式只进 `styles-src/33-prompt-manager.css`，不要回写 `nw-u-*`。
- **按钮规则必须带 `button.` 前缀**，否则会被 Obsidian 默认按钮样式压掉（背景/前景色退回 `--interactive-normal` / `--text-normal`）；这是 Slice N 像素校正时踩过的坑。
- **截图复现**：`node D:\nw-tmp\snap-n.mjs --tag=before|after`——需要先把构建产物拷进 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai`，在 vault 里点「信任仓库作者」；脚本用 `#nw-pm-harness` 注入 900px 宽宿主，并用 `Object.create(plugin)` 造一个只换 `promptManager` 的假 plugin，否则会读到真实空数据。
- **对比工具**：`node D:\nw-tmp\diff-n.mjs`（纯 node 解 PNG + 探针对比，输出 `_visual-n\diff-report.json`）。
- **待决策**：`PromptManagerSettings` 目前直接读 `plugin.promptManager` 与 `plugin.settings.promptManagerConfig`，没有注入面；若以后要在设置页做「实时预览」，需要先补一个 `onConfigChange` 回调。

# 提示词管理设置（设置页 · 4 个子页签 + 5 个弹窗）

> 状态：stable（视觉重构 Slice N 完成 2026-11-17；功能缺口 ④ 交付级修补 2026-11-18；i18n 第二期第七片 2026-11-18）　｜　最后更新：2026-11-18　｜　Owner：dsh

## 1. 定位

- **用户视角**：设置 → 写作 → 「提示词模板」区块。四个子页签——📝 提示词模板（左分类 + 模板列表 + 右侧详情：版本历史 / 系统提示词 / 用户提示词 / 可用变量）、🧪 A/B 测试（开关 + 测试卡 + 展开详情 + 优胜条 + 操作按钮）、📊 使用统计（工具条「共 N 条记录 / 清空记录」+ 记录列表 + 分页器）、📦 导入/导出（导出 JSON / 导入 JSON → 预览差异 → 合并或覆盖）。另有 6 个弹窗：新建模板、编辑模板、新建版本、创建 A/B 测试、结束测试、导入预览。
- **代码入口**
  - 挂载点：`ui/settings/writing-sections.ts:545` —— `TemplateSection.render()` 里 `const manager = new PromptManagerSettings(this.app, this.plugin, section); manager.render();`。
  - 本体：`ui/prompt-manager-settings.ts`（`PromptManagerSettings`，1368 行；外壳 `render()` + `renderActiveTab()` + 4 个 `render*Tab` + 子渲染方法 + 5 个 `show*Modal`）。
  - 导入预览弹窗：`ui/prompt-import-preview-modal.ts`（`PromptImportPreviewModal`，135 行，只做「展示差异 + 二选一模式」）。
  - 导入纯逻辑：`shared/prompt-manager-import.ts`（208 行，`PromptImportMode` / `buildPromptImportDiff` / `mergePromptConfigs` / `isSameTemplate`）。
  - 子页签外壳：`nw-settings-subtab-bar` / `nw-settings-subtab(.is-active)` / `nw-settings-subtab-content`，定义在 `styles-src/06-cowrite-missing-and-dark.css:756-792`，**本切片未改动**。
- **数据**
  - 服务：`services/prompt-manager.ts`（`PromptManager`，含 `normalizePromptManagerConfig` 宽松归一化：顶层类型不对回退默认，数组逐项过滤）。
  - 类型：`shared/prompt-manager-types.ts`（`PromptTemplate` / `PromptTemplateVersion` / `ABTest` / `ABTestStatus` / `PromptUsageRecord` / `PromptManagerConfig`）。
  - 默认模板：`services/prompt-templates-default.ts` 的 `DEFAULT_PROMPT_TEMPLATES`。
  - 持久化：插件 `data.json` 的 `settings.promptManagerConfig`（`main.ts:665` 声明，`:1088-1093` 构造时 `getConfig` 读、变更写回）。
  - 纯逻辑：`ui/prompt-manager-logic.ts` 的 `buildVariantStatRows`（只在有样本时产出评分/质量/修改率行）。
- **样式**：`styles-src/33-prompt-manager.css`（Slice N 新建，375 行 / 10524 字节，全部 `nw-pm-*` 单类选择器；按钮规则带 `button.` 前缀，焦点态用 `:focus-visible`）。

## 2. 现状（事实，不写愿望）

- **外壳与内容分开重建**：`render()` 只建页签栏 + `this.contentEl`，内容由 `renderActiveTab()` 重建；切子页签只切 `is-active` 再重绘内容区，不再整块 `empty()` 页签栏。
- **模板页三处局部更新**：搜索框 `onChange` 只调 `renderTemplateListItems()`（输入框不再失焦）；点分类只改按钮修饰类 + `aria-pressed` 并重绘列表；点模板只重绘列表 + `renderTemplateDetailNow()`。
- **键盘导航**：`bindListKeyboardNav(entries)` 给分类按钮与模板项加 `tabindex="0"` + `role="button"` + `aria-pressed`，ArrowUp/ArrowDown 取模循环、Home/End 跳首尾、Enter/Space 触发 `activate()` 回调（不依赖 `el.click()`，假 DOM 无 click/focus）。
- **使用统计**：`getUsageHistoryPage(offset, limit, templateId?)` 返回 `{ records, total }`，每页 20 条、最新在前；工具条显示「共 N 条记录」+「🗑 清空记录」（`OperationConfirmModal` 二次确认后 `clearUsageHistory()`）；超过一页时显示 `← 上一页 / 第 x / y 页 / 下一页 →`，首末页 `disabled`。
- **导入**：选文件 → 清空 input.value（允许重选同一文件）→ `parseImportPayload()` 校验 → `buildPromptImportDiff()` 算差异 → `PromptImportPreviewModal` 预览 → 用户点「合并导入」或「覆盖导入」才写盘；解析/校验失败只弹 Notice，不打开弹窗。
- **模板页三栏**：`nw-pm-layout`（flex + gap 16）→ `nw-pm-sidebar`（260px，`flex-shrink:0`，内含搜索框 + `nw-pm-category-list` + `nw-pm-template-list`（`max-height:400px; overflow-y:auto`）+ `nw-pm-add-btn`）/ `nw-pm-main`（`flex:1; min-width:0`，详情或空态）。
- **分类按钮**：由 `getCategories()` 动态生成（「📚 全部 (N)」+ 每个有模板的分类，标签走 `promptCategoryLabel()`（内部查 `prompt.category.*` 资源键），未登记分类回落原始 key），选中态用 `nw-pm-category-btn--active`；「全部」多一个 `--all` 修饰类（`margin-bottom:4px`，其余项 2px）——两档间距是旧实现就有的细节。
- **模板项**：`nw-pm-template-item`（padding 8px 10px / radius 4 / pointer / mb 2），选中 `--selected` 换 `--background-modifier-hover`；自定义模板挂 `nw-pm-badge--custom`（inline-block）。
- **版本徽标**：`nw-pm-version-badge`（span，可点切换版本），当前版本 `--active` 用强调底色 + `--text-on-accent`，其余次底色 + `--text-muted`。
- **A/B 状态**：Slice N 前由 `getStatusStyle(status)` 返回内联样式串，现在改为 `getStatusClass(status)` 返回 `nw-pm-status--draft|--running|--paused|--completed`，用法 `cls: \`nw-pm-status \${this.getStatusClass(test.status)}\``（未匹配时回落 `--draft`）。
- **两个 A/B 徽标**：模板页自定义徽标、变量「必填」徽标、使用记录「A/B A」徽标共用 `nw-pm-badge` + 修饰类；`--ab` **显式 `display:inline`**（见 §4）。
- **弹窗**：5 个 `Modal` 子类都在同一文件里，footer 按钮沿用共享类 `nw-modal-footer` / `nw-modal-btn-primary` / `nw-modal-btn-secondary`；两处长 textarea 的十几个工具类改成一个 `nw-pm-textarea`。
- **文案国际化（i18n 第二期第七片）**：四个子页签、侧栏、详情、A/B、使用统计、导入导出与五个弹窗的约 120 处
  用户可见文案全部走 `t('settings.promptManager.*')`（**134 键**，zh/en 各资源 997 条）；状态徽标走模块级
  `STATUS_LABEL_KEYS` 映射 + `getStatusLabel()`，分类标签走 `promptCategoryLabel()`（`prompt.category.*` 10 键）；
  弹窗取消按钮复用 `common.cancel`。文件内剩余 50 行 CJK **全是注释**。模板名/描述是 vault 数据，不迁。
  详见 [i18n.md](i18n.md)。
- **历史包袱**：Slice N 前本文件 192 处 `nw-u-*`（56 行）、15 处内联 `style`；模板项、分类按钮、A/B 卡的选中态全都靠内联样式三元表达式拼字符串。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| PM-01 | P1 | 192 处 `nw-u-*` 拼布局，语义不可读 | 语义类 `nw-pm-*` 集中在 `33-prompt-manager.css` | done（Slice N） |
| PM-02 | P1 | 15 处内联 `style`（模板项/分类按钮/A/B 卡/状态标签/文件输入/textarea） | 全部改类 + 修饰类，`getStatusStyle()` → `getStatusClass()` | done（Slice N） |
| PM-03 | P2 | 模板项与「全部」分类按钮的间距差藏在三元表达式里 | `--all` 修饰类显式表达 | done（Slice N） |
| PM-04 | P2 | `nw-u-*` 退场后 12 个工具类全仓零引用 | 删除定义并收紧基线（267 → 255） | done（Slice N） |
| PM-05 | P1 | 导入直接整份覆盖，无 dry-run、无冲突提示 | 先预览「新增/覆盖/移除」差异，再选合并或覆盖 | done（缺口 ④） |
| PM-06 | P1 | 使用统计只增不减：无分页、无清空 | 每页 20 条 + 页码器 + 「清空记录」二次确认 | done（缺口 ④） |
| PM-07 | P2 | 分类/模板选中态靠整页重建，列表不可键盘操作 | 局部重绘 + `tabindex`/方向键/Enter | done（缺口 ④） |
| PM-08 | P2 | `render()` 全量重建，搜索每敲一键就失焦 | 外壳只建一次，内容区按需重绘 | done（缺口 ④） |

## 4. 关键决策

- **命名**：`nw-pm-*`（prompt manager），状态一律用 `--custom/--required/--ab/--active/--selected/--danger/--primary/--primary-lg/--all/--push-end` 修饰类。
- **不加 `.nw-scope` 前缀**：设置页整体不在 `.nw-scope` 容器里（`writing-sections.ts` 直接往 section 里渲染），加前缀会导致规则命中不到；全部用单类 + 一个需要压过 Obsidian 默认按钮样式的场景用 `button.` 前缀。
- **`button.` 前缀是必需的，不是风格选择**：Obsidian 自带按钮规则（`--interactive-normal` 底色 / `--text-normal` 前景）会盖掉单类选择器。第一轮 after 截图里分类按钮、`nw-pm-btn--danger`、`nw-pm-btn--primary-lg` 全部退回白底黑字（PNG 差 1.1%–1.9%），把 9 条按钮规则改成 `button.nw-pm-*` 后 style 探针归零。仓库内既有先例：`button.nw-kb-nav-btn`（`27-knowledge-base.css:80`）、`button.nw-btn-icon`（`08-workbench-v7-v8.css:390`）。
- **`--ab` 徽标保留 `display:inline`**：旧代码里「自定义」「必填」徽标都带 `nw-u-d-inline-block`，唯独使用记录的 `A/B A` 徽标没有——若统一成 inline-block，行高从 15.6px 变 17px，整页高度 +3px。这里按「逐项等价」保留 inline，并在 CSS 里写明原因。
- **等价审计靠探针而非人眼**：11 个场景各记录 32 个 computed style 键 + `getBoundingClientRect`（取整）+ tag/cls，before/after 逐元素对齐；PNG 逐像素只作兜底。
- **删掉 12 个零引用工具类**：`nw-u-bg-background-modifier-er`、`nw-u-bg-interactive-accent`、`nw-u-c-text-on-accent`、`nw-u-d-inline-block`、`nw-u-gap-16px`、`nw-u-m-0-0-4px-0`、`nw-u-m-16px-0-8px-0`、`nw-u-marginleft-8px`、`nw-u-maxh-400px`、`nw-u-p-8px`、`nw-u-resize-vertical`、`nw-u-w-260px`——它们此前只被本文件使用。
- **导入默认「合并」而不是「覆盖」**：覆盖是整份替换（未提到的自定义模板与使用记录会消失），破坏性最大；合并只改同 id/同名项，是安全的默认值。覆盖仍保留在同一个弹窗里，按钮文案写明「覆盖导入」。
- **同名视为同一模板**：`isSameTemplate` 判 `id 相同 || (name 非空且相同)`。用户手工改过 id 但沿用名字的配置很常见；只按 id 判会生成重复模板，只按名判会漏掉改名场景。
- **版本取并集、active 取导入值**：合并时不丢本地新增的版本（`mergeTemplate` 以 version 字符串并集），`isActive` 按导入的 active 重算；使用记录按 id 去重后截断 1000（与 `addUsageRecord` 上限一致）。
- **`abTestingEnabled` 保留当前值**：导入一份「A/B 关闭」的历史配置不该把用户正在跑的开关关掉；开关属于运行态，不属于配置内容。
- **差异计算放 `shared/prompt-manager-import.ts`，弹窗只负责展示**：设置页 1368 行已经很大，diff/merge 是纯数据变换，抽到 shared 才能单测（见 §6），弹窗 135 行也因此可测。
- **分页在服务层做**：`getUsageHistoryPage` 返回 `{ records, total }`，UI 不拉全量再切片——总量口径只有一处，越界页也能拿到正确 total 来夹页码。
- **键盘激活走 `activate()` 回调而不是 `el.click()`**：假 DOM 没有 click，测试里也不该构造 MouseEvent；同时让「选中」语义与「触发 DOM 点击」解耦。
- **摘要口径不随分页变**：工具条「共 N 条记录」永远是总量，切页只改列表内容（与文面体检弹窗「摘要反映扫描结果，不随过滤变」同一口径）。

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

### 5.1 缺口 ④ 验收（2026-11-18）

截图：`D:\nw-dev-vault\_visual-n4\{before,after}`（探针 `D:\nw-tmp\probe-n4.mjs --tag=before|after`），`report.json` 存每场景尺寸、pager 快照、键盘焦点、弹窗标题。假数据：2 条自定义模板（custom-1 两条版本）+ 1 个 running A/B 测试 + 45 条使用记录（每 5 条带评分）。

| 场景 | 内容 | 前后对比 |
| --- | --- | --- |
| templates-list | 分类 + 模板列表 | 688×847，PNG 与 before **字节完全相同** |
| templates-detail | 选中 custom-1 详情 | 688×1010，字节完全相同（版本徽标/系统与用户提示词/变量网格不动） |
| abtests | 开关 + 测试卡 | 700×205，字节完全相同 |
| usage-page1 | 工具条 + 20 条记录 + 页码器 | 688×544 → 688×622；「共 45 条记录」「🗑 清空记录」「← 上一页 / 第 1 / 3 页 / 下一页 →」 |
| usage-page2 | 翻到第 2 页 | 688×622；页码变「第 2 / 3 页」，两按钮均可用 |
| import-export | 导入卡文案 | 700×322 → 875×404（描述变长导致内容区 max-content 变宽，存量布局特性） |
| modal-import-preview | 导入预览弹窗 | 800×444；标题「📥 导入预览」+ 汇总「新增 1 · 覆盖 1 · 移除 0」+ 两组清单 + 三按钮（合并为主按钮） |
| modal-clear-usage | 清空确认弹窗 | 800×398；正文「确定要清空全部 45 条使用记录吗？」+ 警示条「清空后无法恢复，模板与 A/B 配置不受影响」 |

- 键盘：`items 13 / focusedIndex 1 / tabindex "0"` —— 聚焦首个列表项后 ArrowDown 焦点移到第二项（取模循环）。
- 导入链路实机走的是真实 `<input type=file>` + `page.setInputFiles`，弹窗挂在**主窗口**（设置页在独立弹窗 page，Modal 用主窗口 `activeDocument`）。
- 三个模板/A/B 场景字节相同说明「局部重绘 + 键盘属性」没有引入任何视觉位移；使用统计的 78px 增量全部来自新增工具条与分页器。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/prompt-manager-settings-dom.test.ts` | 用 `FakeEl` / `stubCreateDiv` 渲染四个页签，断言文案与 `nw-settings-subtab-bar` / `nw-settings-subtab-content`；缺口 ④ 补工具条「共 N 条记录」、分页器文案与 disabled、切页后列表内容 |
| `tests/unit/ui/prompt-manager-logic.test.ts` | `buildVariantStatRows` 的样本阈值与行内容 |
| `tests/unit/services/prompt-manager.test.ts` | `getUsageHistoryPage` 的分页/越界/按模板过滤、`clearUsageHistory`、`importConfig` 的合并与覆盖模式（缺口 ④ 新增，含「合并保留本地新增模板与版本」） |
| `tests/unit/shared/prompt-manager-import.test.ts` | `isSameTemplate`（id / 同名 / 改名）、`buildPromptImportDiff` 的新增-覆盖-移除计数、`mergePromptConfigs` 的版本并集、使用记录去重截断、`abTestingEnabled` 保留 |
| `tests/unit/ui/prompt-import-preview-modal.test.ts` | 预览弹窗汇总文案、分组清单、模式按钮回传 `mode` 与取消 |

没有 DOM 级「样式回归」单测：`vitest` 环境是 `node`，Obsidian 的 `Modal` 与 CSS 计算都不便实例化，渲染等价性靠上面的截图 + 探针（Slice N 11 场景、缺口 ④ 8 场景）。

## 7. backlog

- 文件 1368 行：4 个页签 + 5 个弹窗可拆成 `prompt-manager-settings.ts`（页签）与 `prompt-manager-modals.ts`（弹窗）；导入预览已按此思路单独成文件。
- 清空使用记录不可撤销（只有二次确认，没有「最近一次清空的撤销」）；若用户误清需从 `data.json` 备份恢复。
- 使用统计只有分页与模板维度过滤的**服务能力**，UI 还没有「按模板筛选」「导出统计 CSV/JSON」入口。
- 模板页列表仍是「全量重绘列表项」，60 个以上模板时尚可，上百个需要考虑虚拟滚动。
- 键盘导航只覆盖分类与模板两个列表；A/B 测试卡与使用记录列表还不能用方向键遍历。

## 8. 交接备注

- **改这个文件前先跑**：`npx vitest run tests/unit/ui/prompt-manager-settings-dom.test.ts`；新增样式只进 `styles-src/33-prompt-manager.css`，不要回写 `nw-u-*`。
- **按钮规则必须带 `button.` 前缀**，否则会被 Obsidian 默认按钮样式压掉（背景/前景色退回 `--interactive-normal` / `--text-normal`）；这是 Slice N 像素校正时踩过的坑。
- **截图复现（2026-11-18 起的路线）**：`node D:\nw-tmp\probe-n4.mjs --tag=before|after`。它直接启动 dev vault、点「信任仓库作者」、播种自定义模板与 45 条使用记录，再走真实设置页截图。旧的 `snap-n.mjs` 已不可用——它依赖 `window.__pmCtor`，而 `scripts/build.js:45` 是 `minify: true`，bundle 里没有可挂的类名。
- **先 sync 正确的 vault**：`node scripts/dev-vault.mjs sync --vault=D:/nw-dev-vault`。机器上有两份 dev vault（`D:\nw-dev-vault` 与 `C:\Users\admin\nw-dev-vault`），探针写死 `D:` 那份，而 `dev-vault.mjs status` 默认管 `C:` 那份——不同步就会截到旧 UI（本次踩过）。
- **设置页在独立 CDP page**：Obsidian 1.14.5 的设置窗口是单独 page（`ctx.pages().find(p => p !== page)`），`window.app` 在那边不存在；插件实例只能从主 page 取，`app.setting.openTabById('novel-writer-ai')` 之后要再 `settingsTab.openTab('template')`，且该 tab 属 advanced 组，需先置 `settings.showAdvanced`。
- **Modal 挂主窗口**：设置弹窗里触发的导入预览、清空确认都挂主窗口的 `activeDocument`（不是设置页那个窗口），截图前必须按标题找宿主 page；每次 `page.evaluate` 内都要重设 `window.activeWindow = window; window.activeDocument = document;` 再执行命令，否则 `.modal` 数为 0。
- **导入样例的 `category` 必须合法**：`services/prompt-manager.ts:20-23` 的 `PROMPT_CATEGORIES` 不含 `scene`，样例里写 `scene` 会被整份拒绝（`customTemplates 存在结构不合法的条目`）；侧栏对未登记分类回落显示原始 key，所以种子数据用 `scene` 不影响截图可比性。
- **对比工具**：缺口 ④ 的对比直接读 `_visual-n4\<tag>\report.json`（探针自产：每场景尺寸、pager 快照、键盘焦点、弹窗标题）；PNG 逐像素对比用 `D:\nw-tmp\diff-n.mjs`（纯 node 解 PNG，输出 `_visual-n\diff-report.json`）。
- **待决策**：`PromptManagerSettings` 目前直接读 `plugin.promptManager` 与 `plugin.settings.promptManagerConfig`，没有注入面；若以后要在设置页做「实时预览」，需要先补一个 `onConfigChange` 回调。

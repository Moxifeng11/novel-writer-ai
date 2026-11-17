# 功能缺口清单（2026-11-18）

> 状态：**①②③④已交付（2026-11-18）**，其余待作者挑选 · 编制：DSH · 背景：视觉重构 Slice A–Y 收尾、`nw-u-*` 存量清零后，工作重心转功能实现。
> 口径：只列**已核实**的缺口（附代码证据），按「用户价值 / 工作量」排序；不含纯重构与 P2 技术债。
> 每项交付定义：功能实现 + 单测 + 实机或像素验收 + 模块文档 + 门禁 + 提交推送。

## 速览

| # | 缺口 | 类型 | 规模 | 证据强度 |
|---|---|---|---|---|
| 1 | 大纲智能扩写「应用」不写回正文 | 缺陷修复 | 0.5–1 轮 | ✅ done（2026-11-18） |
| 2 | 全屏写作视图缺写作时实时体检 | 新能力接入 | 1–2 轮 | ✅ done（2026-11-18） |
| 3 | 发布前错别字 / 标点体检 | 新功能 | 1 轮 | ✅ done（2026-11-18） |
| 4 | 提示词管理器交付级修补 | 体验补洞 | 1 轮 | ✅ done（2026-11-18） |
| 5 | 质量统计状态清单不可交互 | 体验补洞 | 0.5 轮 | 强（模块文档 §7） |
| 6 | 章节朗读（TTS）写作用「听校」 | 新功能 | 0.5–1 轮 | 强（全仓 0 引用） |
| 7 | 英文界面（i18n） | 新能力 | 3–5 轮 | 强（无 i18n 框架） |

---

## 1. 大纲智能扩写「应用」不写回正文（缺陷，✅ 已修 2026-11-18）

**现象**：`OutlineExpandModal` 点「应用」只弹「已应用扩写结果」并关窗，正文/场景文件没有任何变化。

**证据**
- `ui/outline-expand-modal.ts:913-920`：`private applyResult()` 内只有 `showSuccessNotice('已应用扩写结果')` + `this.close()`。
- `ui/outline-expand-modal.ts:926-928` 提供 `getExpandedText()`，但全仓 grep 除定义处**无任何调用者**。
- 两个入口都没接写回：`ui/command-ui-executor.ts:685`、`ui/co-writing-view.ts:2224`。

**做法**：先定写回语义（目标章节文件 / 当前场景正文 / 仅复制到剪贴板），做「diff 预览 → 确认写回」，写入走写锁 + FileTx（失败回滚），补单测与实机验证。

**价值**：当前是「看起来成功、实际丢结果」的欺骗性交互，比没有该功能更伤。

**已交付（2026-11-18）**
- `ui/outline-expand-modal.ts` 构造函数新增 `onApply?: (text) => void | Promise<void>`；`applyResult()` 改 async：有回调就 `await onApply(expandedText.trim())`（成功关窗并提示「Ctrl+Z 可撤销」，失败报错且**不关窗**），无回调降级 `navigator.clipboard.writeText`。
- `ui/command-ui-executor.ts:676-710`：有选区且未变 → `replaceSelection`；选区已变 → 光标处 `replaceRange`；无选区（整章）→ 覆盖第 0 行到末行再归位光标。
- `ui/co-writing-view.ts:2217-2261`：一律走 `applyProgrammaticEdit(...)`，快照/高亮/dirty 一并刷新（直接改 `.value` 会被自动保存丢掉）。
- 单测 `tests/unit/ui/outline-expand-apply-writeback.test.ts`（6 条）+ 实机 `D:\nw-tmp\verify-writeback.mjs`（A–E 5 用例全 PASS）。详见 `docs/modules/outline-expand-editor.md` §5.1。

## 2. 全屏写作视图缺写作时实时体检（新能力接入，✅ 已交付 2026-11-18）

**现象**：实时分析（剧情偏离、完成度、质量）只在「协同写作」视图有；`ui/full-writer/` 下对 `live-analysis` **零引用**。

**证据**
- `ui/cowrite/live-analysis-controller.ts` + `ui/co-writing-view.ts` 是唯一宿主。
- 引擎与阈值已就绪：`engine/plot-divergence-engine.ts`、`engine/plot-completion-engine.ts`、`shared/thresholds.ts` 的 `PLOT_EVAL_*` / `DIVERGENCE_*`。
- `ui/monitor-panel-b.ts` 已有 104 处偏离相关代码可复用。

**做法**：在 full-writer 右栏或底部加「写作体检条」（偏离等级、完成度、质量分、最近一次评估时间），按现有节流（最短间隔/冷却）触发，点开跳监控面板 B 详情。

**价值**：写正文时就地看到「写偏了没有」，而不是写完再切面板。

**已交付（2026-11-18）**
- 新增 `ui/full-writer/checkup-bar-controller.ts`（288 行，`FullWriterCheckupController`）：全屏写作视图底部体检条，展示完成度 / 偏离徽标 / 一句话建议 / 「最近 HH:MM」，右侧「刷新」「详情」；详情就地展开情节线清单（名称 · 类型 · 状态 · 进度%）。
- **实现与本节原设想不同**：没有跳监控面板 B，也没有复用 `LiveAnalysisController`（与 `CoWritingView` 强耦合，见 `ui/cowrite/live-analysis-controller.ts`），而是只复用 `engine/ending-traction-engine.ts` 的 `checkTraction(volume, chapterNum)` —— 纯分卷大纲解析，无 AI 调用。
- 装配 5 处（`ui/full-writer-view.ts:14/138/871/1936/1391`）；节流 20s，步骤完成（`bodyGeneration`/`fix`/`finalFix`）与手动刷新走 `force`。
- 样式 `styles-src/42-full-writer-checkup.css`（4240 字节 / 29 个选择器），模块短名 `fw-` 首次登记到视觉标准 §1.3。
- 单测 `tests/unit/ui/full-writer-checkup-bar.test.ts`（8 条）+ 实机 `D:\nw-tmp\verify-checkup.mjs`（5 步全绿）。详见 `docs/modules/full-writer-checkup.md`。

## 3. 发布前错别字 / 标点体检（新功能）

**现象**：导出弹窗有「交付检查」（空单元、字数、作者），但**没有错别字/标点/敏感词体检**；全仓无错别字检查实现。

**证据**
- `ui/export-manuscript-modal.ts:213` 的「交付检查」只做结构/字数/作者校验。
- grep `错别字|typo|拼写` 在 `ui/` 仅 1 处误命中，无实现。

**做法**：纯本地规则体检（常见错别字对、重复词、中英标点混用、连续标点、书名号/引号配对），产出「问题列表 + 定位 + 一键跳转」；接入导出前置检查（可关闭）。不依赖 AI，成本低、可测。

**价值**：投稿前刚需；与既有导出链路天然衔接。

**已交付（2026-11-18）**
- 引擎 `shared/manuscript-precheck.ts`：7 条规则（错别字 51 对 / 重复词 / 中英标点混用 / 连续标点 / 引号配对 / 省略号 / 破折号），三档严重度；`splitFrontmatter` 自带偏移、不扫元数据；单章上限 200 条。
- 弹窗 `ui/manuscript-precheck-modal.ts`（198 行）+ `styles-src/43-manuscript-precheck.css`（2472 字节 / 16 选择器）：按章分组、徽标、摘录、行号列号、「只看必改项」、点行跳正文并关窗。
- 命令 `novel-writer-text-precheck`（LONG_ONLY，5 处接线）；导出弹窗加「文面体检」开关（默认开）+「查看问题」，摘要拼进导出前置检查 Notice，不阻断导出。
- 验收：15 条单测；实机扫示例章 6 处、跳转光标 第6行列2、过滤 6→2→6、导出 Notice 三行齐全；门禁全绿（styles.css 793,258 B / inline 525 / utility 46 类 142 次）。
- 详见 `docs/modules/manuscript-precheck.md`。

## 4. 提示词管理器交付级修补（体验补洞，✅ 已交付 2026-11-18）

**证据**：`docs/modules/prompt-manager-settings.md` §7 四条：
- 导入是「覆盖现有自定义配置」，无 dry-run 预览与冲突提示；
- 使用统计只增不减，无分页/清空；
- 分类按钮与模板项选中态靠整页重绘，无键盘导航（方向键/Enter）；
- `render()` 全量重建。

**做法**：导入改为「预览差异 → 合并/覆盖二选一」；统计加分页与清空；列表加键盘导航；局部重绘。
**已交付（2026-11-18）**
- 导入 dry-run：`shared/prompt-manager-import.ts`（208 行纯逻辑：`isSameTemplate` / `buildPromptImportDiff` / `mergePromptConfigs`）+ `ui/prompt-import-preview-modal.ts`（135 行预览弹窗）+ `PromptManager#importConfig(jsonStr, mode)`（`'replace' | 'merge'`，默认合并）。选文件后先校验再预览「新增 / 覆盖 / 移除 / 使用记录条数」，用户点「合并导入」或「覆盖导入」才写盘。
- 使用统计：`PromptManager#getUsageHistoryPage(offset, limit, templateId?)` 返回 `{ records, total }`、`clearUsageHistory()`；UI 每页 20 条、工具条「共 N 条记录 / 🗑 清空记录」、页码器「← 上一页 / 第 x / y 页 / 下一页 →」（首末页 disabled），清空走 `OperationConfirmModal` 二次确认。
- 局部重绘 + 键盘导航：`render()` 只建外壳（页签栏 + `contentEl`），`renderActiveTab()` 重绘内容；搜索框不再每键失焦；分类按钮与模板项加 `tabindex="0"` / `role="button"` / `aria-pressed`，`bindListKeyboardNav` 支持方向键取模循环、Home/End、Enter/Space（`activate()` 回调，不依赖 `el.click()`）。
- 验收：四个单测文件（设置页 DOM / 服务分页与导入 / 导入纯逻辑 / 预览弹窗）全过；实机 before/after 8 场景截图——`templates-list`/`templates-detail`/`abtests` **PNG 字节完全相同**（局部重绘零视觉变化），`usage-page1/2` 显示工具条与 3 页页码器，导入预览弹窗与清空确认弹窗按设计出图；键盘实测 `tabindex=0` + ArrowDown 焦点移位。
- 门禁：styles.css 793258 → 795332（+2074）、main.js 5643485 → 5651818（+8333），两份基线已按实上调并写明原因；详见 `docs/modules/prompt-manager-settings.md` §5.1。

## 5. 质量统计状态清单不可交互（体验补洞）

**证据**：`docs/modules/kb-stats.md` §7；`ui/views/kb-stats-panel.ts` 的 `nw-ks-legend-row` 无 cursor、无 onclick。

**做法**：点「失败 / 拆解中 / 已完成」跳到书架并按状态筛选（知识库视图已有筛选能力）；行加 hover 与 cursor。

## 6. 章节朗读（TTS）写作「听校」（新功能）

**证据**：全仓 `speechSynthesis` 0 引用。

**做法**：用 Web Speech API 朗读当前章节/选区，可设语速、音色；朗读时高亮当前句；不支持的平台降级为提示。

**风险**：Obsidian 桌面（Electron）与移动端语音可用性差异，需要实机确认。

## 7. 英文界面（i18n）（新能力）

**证据**：全仓无 i18n 框架，界面文案硬编码中文（500+ 文件）。

**做法**：分三期——①抽 `t()` + zh-CN 资源与门禁（禁止新增裸中文文案）②迁移高频界面（命令面板、设置、写作主流程）③补 en-US。

**价值**：取决于是否有海外用户；工程量大，建议最后做。

---

## 建议顺序

1 → 2 → 3 → 4 → 5 →（6 可选）→ 7。

进度：①②③④ 已交付（2026-11-18）。

理由：1 是修「假成功」缺陷；2 是把已交付引擎变成写作时可见的价值；3 是投稿刚需且不依赖 AI；4/5 是低成本体验补洞；6/7 视需要。

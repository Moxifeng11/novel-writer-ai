# 功能缺口清单（2026-11-18）

> 状态：**①②③④⑤已交付（2026-11-18）**，其余待作者挑选 · 编制：DSH · 背景：视觉重构 Slice A–Y 收尾、`nw-u-*` 存量清零后，工作重心转功能实现。
> 口径：只列**已核实**的缺口（附代码证据），按「用户价值 / 工作量」排序；不含纯重构与 P2 技术债。
> 每项交付定义：功能实现 + 单测 + 实机或像素验收 + 模块文档 + 门禁 + 提交推送。

## 速览

| # | 缺口 | 类型 | 规模 | 证据强度 |
|---|---|---|---|---|
| 1 | 大纲智能扩写「应用」不写回正文 | 缺陷修复 | 0.5–1 轮 | ✅ done（2026-11-18） |
| 2 | 全屏写作视图缺写作时实时体检 | 新能力接入 | 1–2 轮 | ✅ done（2026-11-18） |
| 3 | 发布前错别字 / 标点体检 | 新功能 | 1 轮 | ✅ done（2026-11-18） |
| 4 | 提示词管理器交付级修补 | 体验补洞 | 1 轮 | ✅ done（2026-11-18） |
| 5 | 质量统计状态清单不可交互 | 体验补洞 | 0.5 轮 | ✅ done（2026-11-18） |
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

## 5. 质量统计状态清单不可交互（体验补洞，✅ 已修 2026-11-18）

**证据**：`docs/modules/kb-stats.md` §7；`ui/views/kb-stats-panel.ts` 的 `nw-ks-legend-row` 无 cursor、无 onclick。

**做法**：点「失败 / 拆解中 / 已完成」跳到书架并按状态筛选（知识库视图已有筛选能力）；行加 hover 与 cursor。

**已交付（2026-11-18）**
- 状态行可点：`KbStatsPanelHost` 新增可选 `onStatusClick?(status: KbStatusKey)`；`item.value > 0` 且注入了回调时该行追加 `nw-ks-legend-row--action` + `role="button"` + `tabindex="0"` + `title`，否则 `--idle`（数值转 muted）。click 与 Enter/空格走同一个 `activate()`。
- 跳转：视图新增 `openBookShelfWithStatus(status)` —— 切 `books` 页签、清掉频道/主题材/子题材/关键词残留筛选、设 `filter.status`，再重绘侧栏与右栏（不清会造成「图例说 1 本、书架说 0 本」）。
- 样式：`styles-src/27-knowledge-base.css` 新增 4 条规则（hover 底色 / `cursor:pointer` / `:focus-visible` 描边 / idle 数值弱化），`padding`+`margin` 正负抵消保证行高不变。
- 验收：实机 before/after（6 本种子书）——before 无 role/tabindex/title、hover `cursor:auto`、点击无效；after 五行全 `--action`、hover `cursor:pointer`、点「失败」后 `activeMainTab=books` / `filter.status=failed` / 「共 1 本书籍」/ 列表仅「雾港」，首行 focus 后按 Enter 亦生效。像素：静态页 370×431 **0 px**，hover 态 16857 px（仅被悬停那一行的底色）。单测 11 条（新增 4 条）。
- 门禁：styles.css 795332 → 795890（+558 / +2 类）、main.js 5651818 → 5652503（+685），两份基线已按实上调并写明原因；详见 `docs/modules/kb-stats.md` §5。

## 6. 章节朗读（TTS）写作「听校」（新功能）

**证据**：全仓 `speechSynthesis` 0 引用。

**做法**：用 Web Speech API 朗读当前章节/选区，可设语速、音色；朗读时高亮当前句；不支持的平台降级为提示。

**风险**：Obsidian 桌面（Electron）与移动端语音可用性差异，需要实机确认。

**已交付（2026-11-18）**
- 命令：`novel-writer-tts-read-chapter` / `-read-selection` / `-stop`（命令面板「🎧 听校：…」三条，
  `shared/command-ids.ts:89-93` → `core/command-registry.ts:576-578` → `ui/command-ui-executor.ts:688-706`）。
- 朗读核心：`ui/tts/tts-player.ts`（浮层 `.nw-tts-bar`：标题+进度 / ⏮⏸⏭⏹✕ / 语速 0.75×–2× / 音色下拉；
  逐句 `speak` 串行续读、`session` 号丢弃迟到回调、原生选区高亮 + `scrollIntoView`）、
  `ui/tts/tts-speech.ts`（Web Speech 薄封装，全部 try/catch，`voiceschanged` 回填音色）、
  `shared/tts-text.ts`（frontmatter 跳过 / 念稿清洗 / 120 字断句 / `clampRate`）。
- 设置：`ttsRate`（默认 1）/ `ttsVoice`（默认 ''）持久化，下拉改动即保存；语言/样式走既有 i18n 与
  `styles-src/44-tts-player.css`（`.nw-tts-*`，18 条文案双语）。
- 降级：无 `speechSynthesis` 不建条并提示；空内容提示；编辑器已关闭则停。
- 验收：Obsidian 1.15.1 / Windows 实机——百万字级章节 1417 句、高亮落在 frontmatter 后首行、
  ⏭ 跳到 2/1417、语速 1.5× 重启保留、6 个 Microsoft 音色 + 系统默认；选段 80 字 → 4 句且标题「选段」；
  暂停走 `speechSynthesis.paused`（Chromium 暂停时 `speaking` 仍为 true）；
  条与状态栏间隙 29px。证据 `D:\nw-dev-vault\_visual-tts\`。
- 单测 42 例（tts-text 19 / tts-speech 10 / tts-player 13）+ 命令注册 7 例；详见 `docs/modules/tts.md`。
- 后续：代码块整段跳过、`lang` 跟随音色（现固定 zh-CN）、停止后恢复原选区、`estimateSpeechMs` 接进度显示。

## 7. 英文界面（i18n）（新能力）

**证据**：全仓无 i18n 框架，界面文案硬编码中文（500+ 文件）。

**做法**：分三期——①抽 `t()` + zh-CN 资源与门禁（禁止新增裸中文文案）②迁移高频界面（命令面板、设置、写作主流程）③补 en-US。

**价值**：取决于是否有海外用户；工程量大，建议最后做。

**已交付（2026-11-18，第一期）**
- 运行时：`i18n/index.ts` —— `t(key, params?)` / `translate(locale, key, params?)` / `setLocale` / `applyLocaleSetting` /
  `onLocaleChange` / `resolveLocale`（auto 读 `localStorage.language`）/ `interpolate` /
  `flattenMessages` / `placeholdersOf`。缺失键返回键名并只警告一次，不炸界面。
- 资源：`i18n/messages/zh-CN.ts`（源语言）+ `en-US.ts`，各 **2360 条**（… / fingerprint 299 / fullwriter 270 / search.topic 42 / prompt.category 10 / deconstruction.dimension 8 / secret 10 / tts 18）。
- 设置：`NovelWriterSettings.language?: 'auto' | 'zh-CN' | 'en-US'`（默认 auto），设置页「🎨 外观设置 → 界面语言」；
  启动在 `engine/engine-registry.ts` Phase 5 的 `loadSettings()` 之后 `applyLocaleSetting()`。
- 迁移面：设置页导航（6 分组 + 20 页签，`section-factory.ts` 的 `label` 改 getter）+ 设置页外壳 6 条
  （`settings-tab.ts` 的标题/搜索占位/空态/高级开关/未知页签）。
- 门禁：`scripts/check-i18n.mjs`（`npm run check:i18n`，已进 preflight）——中英键集合与占位符双向一致、
  `t()` 字面量键必须存在、`ui/**` 中文数量**按文件棘轮**（基线 `.i18n-baseline.json`：235 文件 / 9359 条）。
- 验收：单测 38 例 + 设置页回归 30 例；实机 before/after（zh-CN vs en-US）导航全换语言、布局像素级一致
  （`D:\nw-dev-vault\_visual-i18n\{before,after}\settings-appearance.png`）。
- 第二期第一片（2026-11-18）：命令面板 94 条 `addCommand({ name })` 改 `t('commands.*')`，并在注册前应用语言；实机 zh/en 面板截图见 `D:\nw-dev-vault\_visual-i18n\{zh,en}-palette-export.png`。
- 第二期第二片（2026-11-18）：外观设置页 `ui/appearance-settings.ts` 47 处文案迁 `settings.appearance.*`（71 键），三个弹窗与 11 条 notice 一并双语；实机 zh/en 截图见 `D:\nw-dev-vault\_visual-i18n\appearance-{zh,en}.png`。主题名/描述故意保留中文（会被写进已存配色方案名）。
- 第二期第三片（2026-11-18）：模型设置页 `ui/settings/api-section.ts` 约 214 处文案迁 `settings.api.*`（213 键），并新增顶层 `secret.*`（10 键）把 `shared/secret-display.ts` 的占位/悬停/落盘状态文案一并英文化（`SECRET_LOCKED_PLACEHOLDER` 常量改为函数 `secretLockedPlaceholder()`）；实机 zh/en 截图见 `D:\nw-dev-vault\_visual-i18n\api-{zh,en}.png`。仍写死中文的只有跨模块共用常量（思考等级 `THINKING_LEVELS`、预算档位 `BUDGET_TIERS`）与主题名。
- 第二期第四片（2026-11-18）：通用设置六分区 `ui/settings/general-sections.ts`（221 个含中文行 / 2349 字）迁 `settings.general.*` 178 键，`cancel`×3 与性能报告 `close` 复用 `common.*`；zh/en 资源各 621 条；棘轮收紧到 267 文件 / 11390 条；实机五页中英截图见 `D:\nw-dev-vault\_visual-i18n5\`（en 下 CJK 仅剩真实 vault 路径与用户已保存的中文关键词）。同片顺手修好规则状态条「绿底绿字」不可读（改为中性底 + 左侧语义色描边）。
- 第二期第五片（2026-11-18）：写作设置五分区 `ui/settings/writing-sections.ts`（175 个含中文行 / 2239 字）迁 `settings.writing.*` 147 键，覆盖 CoWrite / Writing / Template / ProjectLibrary / Layout；面板尺寸行数据由 `label/desc` 改 `labelKey/descKey`（渲染时求值）；zh/en 资源各 768 条；棘轮收紧到 266 文件 / 11234 条；实机五页中英截图见 `D:\nw-dev-vault\_visual-i18n5\{cowrite,writing,template,projects,layout}-{zh-CN,en-US}.png`（en 下仅 template 页 CJK 276，属提示词库数据与 `ui/prompt-manager-settings.ts` 未迁文案）。
- 第二期第六片（2026-11-18）：写作知识库分区 `ui/settings/knowledge-section.ts`（1075 字）迁 `settings.knowledge.*` 87 键，覆盖工具栏四按钮、搜索/三重筛选、两种空态、卡片字数额、删除确认与向量增强整块；同时把设置页与设置弹窗两份异步刷新条统一到 `settings.shell.asyncStale/asyncRefresh`（弹窗的「未知页签」也改键）；zh/en 资源各 853 条；棘轮收紧到 265 文件 / 11126 条；实机截图见 `D:\nw-dev-vault\_visual-i18n6\knowledge-{zh-CN,en-US}.png`（en 下 CJK 11 全为书籍数据：书名/作者/样本书名）。
- 第二期第七片（2026-11-18）：提示词管理器设置页 `ui/prompt-manager-settings.ts`（192 字 / 50 行注释）迁 `settings.promptManager.*` 134 键，覆盖四个子页签、模板侧栏（搜索/「📚 全部 (N)」/分类/空态/自定义徽标）、详情面板（版本历史/系统与用户提示词/变量/三个确认弹窗）、A/B 管理（创建/启停/结束/删除/优胜推荐）、使用记录（条数/分页/清空）、导入导出（错误与合并/替换通知）与三个 Modal；服务层开先例——`services/prompt-manager.ts` 删 `PROMPT_CATEGORY_LABELS` 常量，改 `promptCategoryLabel()` + 顶层 `prompt.category.*` 10 键（未登记分类回落原值）；zh/en 资源各 997 条；棘轮收紧到 264 文件 / 10971 条；实机截图见 `D:\nw-dev-vault\_visual-i18n7\`（模板页/A-B 页/三个弹窗，en 下模板名与描述仍是 vault 数据）。
- 第二期第八片（2026-11-18）：设置搜索 `ui/settings/settings-search.ts` 21 个主题词的 `name` 改 `nameKey`（42 键，
  含 keywords）、结果行统一 `entryLabel()` 渲染，同义词取 zh/en 并集（英文界面搜「敏感词」、中文界面搜 `banned` 都命中
  rules）；`ui/mini-settings-modal.ts` 外壳 5 处（标题/搜索占位/空态/高级开关）迁 `settings.shell.*`；
  zh/en 资源各 1041 条；棘轮收紧到 262 文件 / 10844 条；实机截图见 `D:\nw-dev-vault\_visual-i18n8\`
  （设置页搜索三查询中英各三张；迷你弹窗在 CDP 下点不出 Modal，改由单测覆盖外壳文案）。
- 第二期第九片（2026-11-18）：拆解引擎分区 `ui/settings/deconstruction-section.ts`（758 字）迁
  `settings.deconstruction.*` 54 键，八条维度描述改 `DIMENSION_DESC_KEYS`；维度名走
  `shared/deconstruction-settings.ts` 新增的 `dimensionLabel()` + `deconstruction.dimension.*`（8 键），
  原 `DIMENSION_LABELS` 保留给引擎日志；zh/en 资源各 1103 条；棘轮收紧到 261 文件 / 10785 条；
  实机截图 `D:\nw-dev-vault\_visual-i18n9\deconstruction-{zh,en}.png`（en 下 CJK 0）。
- 第二期第十片（2026-11-18）：写作指纹库分区 `ui/settings/fingerprint-section.ts`（569 字）迁
  `settings.fingerprint.*` 35 键；截图校正发现列表行渲染器在 `ui/fingerprint-utils.ts`，
  空态/模板徽标/详情与删除按钮 title/字数一并迁 7 键，`formatWordCount()` 改为按语言折算
  （zh `12.3万字` / en `123.4k words`）；zh/en 资源各 1145 条；棘轮收紧到 261 文件 / 10732 条；
  实机截图 `D:\nw-dev-vault\_visual-i18n10\fingerprint-{zh,en}.png`（en 下仅剩指纹数据中文）。
- 第二期第十一片（2026-11-18，ZCode · 任务板 ZC-20261118-01）：首启与自检分区
  `ui/settings/setup-section.ts`（477 字）迁 `settings.setup.*` 34 键；清单项 label/detail/fix
  来自 `services/setup-readiness-service.ts`，9 个自检项一并迁 `settings.setup.items.*` 43 键
  （`check()` 时构造即求值，语言切换后重新自检生效；`log.*` 保留中文，`MODE_ROOTS`/
  `TEMPLATE_ROOT`/`USAGE_GUIDE_PATH` 是数据或 vault 路径不迁）；zh/en 资源各 1222 条；
  棘轮收紧到 260 文件 / 10697 条；实机截图 `D:\nw-dev-vault\_visual-i18n11\setup-{zh,en}.png`
  （en 下 CJK 17 全是数据：元文件 / 三模式目录 / 项目名）。
- 第二期第十二片（2026-11-19，ZCode · 任务板 ZC-20261118-02）：伏笔管理分区
  `ui/settings/foreshadow-section.ts`（447 字）迁 `settings.foreshadow.*` 48 键（类型列表
  启停/编辑/删除确认、编辑与新增弹窗五字段、导入/导出/重置）；类型的 name/description/keywords
  是用户数据不迁，关键词占位例 en 用英文例（i18n-parity 硬拦 en CJK）；zh/en 资源各 1270 条；
  棘轮收紧到 259 文件 / 10646 条；实机截图 `D:\nw-dev-vault\_visual-i18n12\foreshadow-{zh,en}.png`
  （en 下 CJK 110 全是类型数据）。
- 第二期第13片（2026-11-19，ZCode · 任务板 ZC-20261118-03）：创作模式与路径分区
  `ui/settings/mode-section.ts`（402 字）迁 `settings.mode.*` 24 键；共享常量 `CREATION_MODE_SPECS`
  展示字段不改（引擎/提示词共用），分区内 `MODE_SPEC_KEYS` 按语言求值；`MODE_LIBRARY_ROOTS`/
  `MODE_CONTENT_LAYOUT`/写作规则路径是 vault 数据不译；zh/en 资源各 1294 条；棘轮收紧到
  259 文件 / 10631 条；实机截图 `D:
w-dev-vault_visual-i18n13modes-{zh,en}.png`
  （en 下 CJK 62 全是路径与目录数据）。
- 第二期第14片（2026-11-19，ZCode · 任务板 ZC-20261118-04）：MCP 服务分区
  `ui/settings/mcp-section.ts`（301 字）迁 `settings.mcp.*` 13 键（引导语/空态/服务器行停用后缀/
  管理中心/移动端说明与两条环境 Notice）；服务器 name 与 `describeMcpServer()` 输出（无汉字）
  是数据不迁；zh/en 资源各 1307 条；棘轮收紧到 258 文件 / 10617 条；实机截图
  `D:\nw-dev-vault\_visual-i18n14\mcp-{zh,en}.png`（en 下 CJK 0）。
- 第二期第15片（2026-11-19，ZCode · 任务板 ZC-20261118-05）：Agent 对话分区 `ui/settings/agent-section.ts`
  （125 字）迁 `settings.agent.*` 6 键——设置分区正文至此全部迁完；实机
  `D:\nw-dev-vault\_visual-i18n15\agent-chat-{zh,en}.png`（en 下 CJK 0）。
- 资源与棘轮随 15 片更新：zh/en 各 1313 条；棘轮 257 文件 / 10611 条。
- 第二期第16片（2026-11-19，ZCode · 任务板 ZC-20261118-06）：写作指纹库视图链——
  `writing-fingerprint-view.ts`（约 150 处，含三弹窗与全部 Notice）+ `fingerprint-detail-modal.ts`
  （约 116 处含 38 个定量指标标签）+ `fingerprint-utils.ts` 12 维标签并出函数 +
  `fingerprint-v2-detail.ts` + `fingerprint-scope-logic.ts` + 能力横幅链（capability/link-status 外壳）
  迁顶层 `fingerprint.*` 299 键；指纹 name/source/tags 与 `shared/link-status-compute` 阶段名是数据
  （后者记 backlog）；zh/en 资源各 1644 条；棘轮收紧到 250 文件 / 10218 条；实机截图
  `D:\nw-dev-vault\_visual-i18n16\fingerprint-view-{zh,en}.png`（主窗口直开，en 剩余 CJK 为数据）。
- 第二期第17片第一批（2026-11-19，ZCode · 任务板 ZC-20261118-07）：完整写作工作台主体
  `ui/full-writer-view.ts`（2771 行 / 约 115 处）迁 `fullwriter.*` 106 键；管线步骤名
  （`ALL_FULL_STEPS`，引擎/提示词共用）与落盘默认名是数据不迁；实机截图
  `D:\nw-dev-vault\_visual-i18n17\fullwriter-view-{zh,en}.png`（en 下视图壳全英文，
  剩余 CJK 为项目选择器子面板——第二批）。后续拆批：ZC-20261119-08（full-writer 子控制器）
  与 ZC-20261119-09（co-writing-view，625 行 CJK），均已指派 zcode。
- 第二期第18片（2026-11-19，ZCode · 任务板 ZC-20261119-08）：项目选择器
  `ui/full-writer/project-selector-controller.ts`（约 110 处）迁 `fullwriter.selector.*` 90 键，
  并带迁 `quick-tools-panel/next-step/flow-panel/streamlined-nav-presenter/title-bar/tab-controller`
  5+2 个小模块（74 键）；模式名复用 `settings.mode.spec.*`；`domains/*/tool-catalog.ts` 工具名与
  `shared/creation-flow.ts` 阶段名是数据（backlog）；zh/en 资源各 1948 条；棘轮收紧到
  249 文件 / 9846 条；实机 `D:\nw-dev-vault\_visual-i18n18\fullwriter-view-{zh,en}.png`。
- 第二期第19片（2026-11-19，ZCode · 任务板 ZC-20261119-09）：协同写作主视图
  `ui/co-writing-view.ts`（3967 行 / 102 处）迁 `cowrite.*` 82 键（绑定切章守卫/前置横幅/
  建议与联想状态机/排版/模型与精准模式/程序化编辑来源标签）；vault 路径与落盘章名是数据；
  zh/en 资源各 2030 条；棘轮收紧到 249 文件 / 9751 条；实机
  `D:\nw-dev-vault\_visual-i18n19\cowrite-view-{zh,en}.png`。
- 第二期第20片（2026-11-19，ZCode · 任务板 ZC-20261119-10）：协同写作子模块
  `ui/co-writing/` 全目录 20 个模块（控制台/五张监控卡/简报/建议卡/生成流水线/布局/错误文案/
  指标面板/编辑辅助条/Markdown 工具条/查找替换等）迁 `cowrite.*` ≈ 340 键；
  frontmatter 键、AI 提示词、字体名与工具目录是数据；zh/en 资源各 2360 条；棘轮收紧到
  235 文件 / 9359 条（14 个文件清零）；实机
  `D:\nw-dev-vault\_visual-i18n19\cowrite-view-{zh,en}.png`（en CJK 294→78）。
- 后续：第二期余下（协同写作弹窗与存储 `ui/cowrite/` 9 模块约 282 行 CJK；
  写作主流程深水区：template-vars 340 / scene-outline 231 / wizard 群 / step-render 106 / unit-writer 98；
  外观页的统计/桌宠块），
  第三期补齐 en 并逐面量布局；详见 `docs/modules/i18n.md`。

---

## 建议顺序

1 → 2 → 3 → 4 → 5 →（6 可选）→ 7。

进度：①②③④⑤⑥ 已交付、⑦ 第一期 + 第二期第一~十片（命令面板 / 外观设置页 / 模型设置页 / 通用设置六分区 / 写作设置五分区 / 写作知识库分区 / 提示词管理器设置页 / 设置搜索与迷你设置弹窗外壳 / 拆解引擎分区 / 写作指纹库分区）已交付（2026-11-18）；下一个候选是 ⑦ 第二期余下（`ui/settings/setup-section.ts` 477 起，及其余设置分区/写作主流程 Notice）。

理由：1 是修「假成功」缺陷；2 是把已交付引擎变成写作时可见的价值；3 是投稿刚需且不依赖 AI；4/5 是低成本体验补洞；6/7 视需要。

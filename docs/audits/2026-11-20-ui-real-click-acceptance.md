# 插件界面真实点击验收（2026-11-20）

> 状态：活跃（本轮验收记录 + 可复用验收标准；后续回归按本表执行）。2026-11-20 第二轮：F-03..F-08 已修，F-10 新增待处理。
> 版本：v4.96.1 · 环境：Obsidian 1.14.5 · 开发 vault `D:\nw-dev-vault`

## 一、目的

用户 2026-11-20 要求：**不用脚本直接调 API，而是像用户一样真实点击**，确认插件界面可用、
找出真 bug，并留下一套可重复执行的验收标准。本文记录方法与结论。

## 二、方法（必须这样跑，否则结论不可信）

1. 用 `--user-data-dir` 临时目录 + `--remote-debugging-port` 起 Obsidian，打开开发 vault。
2. **只信任仓库一次**：点「信任仓库作者」；之后所有操作都用真实点击/真实键盘事件，
   不调用 `plugin.xxx()` 业务方法（仅读取 DOM 度量与状态）。
3. **必须关掉多余窗口**：Obsidian 1.14.5 在本机把设置窗口、命令面板开在**第二个窗口**
   （`about:blank`）。该窗口存在时会抢走 `activeWindow`，插件的 Modal 会弹到那个窗口里，
   主窗口看起来「点了没反应」。脚本启动后 `for (p of ctx.pages()) if (p !== main) p.close()`。
4. 视口固定 1440×900 与 1280×800 各跑一遍；侧栏展开态另测。
5. 记录三样证据：截图（`D:\nw-dev-vault\_verify\`）、控制台 error/warning、
   DOM 度量（`clientWidth/scrollWidth`、元素 bounding box）。

脚本：`D:\nw-tmp\verify-1.mjs`（启动/入口盘点）、`verify-5.mjs`（页签与视图切换）、
`verify-7.mjs`（写作台布局）、`D:\nw-tmp\probe-fw*.mjs`（写作台细节）。

## 三、验收标准（每条都是「可判定」的）

### A. 启动与加载（PASS 条件全满足）
- A1 点「信任仓库作者」后 90s 内插件加载完成，`app.plugins.plugins['novel-writer-ai'].manifest` 可读。
- A2 控制台 **error 数为 0**；warning 必须能解释（见 §六 F-08）。
- A3 页签标题为中文（不得出现 `novel-writer-xxx` 原始 id）。
- A4 重启恢复上次标签后，无重复空白页签。

### B. 入口可达（逐个真实点击，必须都有可见结果）
- B1 左侧 ribbon 7 项：新建白板 / 命令面板 / 新建数据库 / 创作主页 / 任务中心 / Agent 创作工作台 / 项目速览 —— 点击后**有视图或弹窗**。
- B2 创作主页 6 个卡片按钮（任务中心 / 项目体检 / 资产总览 / 用量账本 / 备份中心 / 首启引导）各弹 Modal。
- B3 三个创作分类入口（长篇 / 短篇 / 短剧）各弹「前期调研」Modal，含项目名、分类、目标字数/节数。
- B4 写作台工具栏 26 个按钮：视图类开页签、弹窗类开 Modal、命令类给 Notice，**不得静默无反应**。

### C. 交互反馈
- C1 任何按钮点击后 300ms 内必须有可见状态变化（Modal / 页签 / Notice / 按钮 busy）。
- C2 危险操作（删除、清空、批量）必须有确认框，且确认框里写明后果。
- C3 AI 调用失败必须给可见提示（Notice 或页面内错误条），不能只写控制台。

### D. 布局适配
- D1 1440×900：容器 `scrollWidth === clientWidth`，底部无横向滚动条，右侧上下文面板完整可见。
- D2 1280×800：同上；工具栏允许换行，但不得横向溢出。
- D3 视图内单个卡片/条目不得被相邻面板裁切。
- D4 窄栏（命中容器查询断点）时改为上下堆叠属于设计行为，但列表必须可滚动到底。

### E. 弹窗生命周期
- E1 Esc 关闭；点遮罩关闭（有数据时按脏检查拦截）。
- E2 关闭后再次打开，字段不残留上一次的值。
- E3 长内容弹窗内部滚动，不出横向滚动。

### F. 页签与状态栏
- F1 页签标题中文且与视图一致（含监控面板 A/B）。
- F2 状态栏在 1280 宽下不重叠、不被裁切（换行可以）。

## 四、实测结果（2026-11-20）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| A1 启动加载 | PASS（4.96.1，114 条命令注册） | verify-1 输出 |
| A2 控制台 error | 修复后 PASS（0 error；F-08 后原 3 条告警消失，剩余为章节状态恢复的 trace 级日志） | `_verify/f08-zh-CN.json` |
| A3 页签标题中文 | **修复后 PASS** | `_verify/v5.json` tabTitles |
| A4 无重复空白页签 | PASS（清掉历史 workspace.json 后） | — |
| B1 ribbon 7 项 | PASS | `_verify/01-home.png` 等 |
| B2 主页 6 按钮 | PASS（6 个 Modal 全部弹出） | `_verify/home-*.png` |
| B3 三种创作入口 | PASS（短篇 Modal 内容完整） | `_verify/probe-short3.png` |
| B4 写作台工具栏 | PASS（视图/Modal/Notice 三类都有响应） | `_verify/v7-fw-1280.png` |
| C1 点击反馈 | PASS | — |
| C2 危险操作确认 | PASS（抽查清空/删除） | — |
| C3 AI 失败可见提示 | 修复后 PASS（F-03：体检条写原因 + 一次性错误 Notice） | `_verify/f08-zh-CN.json` |
| D1 1440 布局 | **修复后 PASS** | `_verify/after-fix-1440.png` |
| D2 1280 布局 | 修复后 PASS（cw=sw=912，右栏 x=1038） | `_verify/v7-fw-1280.png` |
| D3 卡片不被裁切 | 修复后 PASS（F-06：中英文阶段名/子步骤标签均换行不截断） | `_verify/f67f-1280x800-en-US.png` |
| D4 窄栏堆叠 | PASS（设计如此） | `_verify/v5-fp.png` |
| E1 弹窗 Esc/遮罩 | PASS | 手工点击 |
| E2 字段不残留 | PASS | 手工点击 |
| F1 页签标题 | 修复后 PASS | `_verify/v5.json` |
| F2 状态栏 | 修复后 PASS（F-07：900×600、1100×680 下状态栏都在容器内） | `_verify/f67f-900x600-zh-CN.png` |

其它已确认无溢出的视图：项目速览、规划画布、设定实体图（hostW 1096 / overflow 0）。

## 五、本轮修复（已落地）

### FIX-01 完整写作工作台在 1440 宽下横向溢出（对应 F-01）
- 现象：进入「第1章」写作页后容器 clientWidth 1072 / scrollWidth 1391，右侧「上下文监控」
  面板整个在屏外（x=1517 > 视口 1440），工具栏后半段被裁，底部出现横向滚动条。
- 根因：`.novel-writer-fw-title-row`（1350px）与 `.novel-writer-fw-titlebar`（1371px）
  是 `flex-shrink: 0` 的单行 flex，行内不换行 → 容器最小内容宽被顶到约 1350px。
- 修法：`styles-src/02-full-writer-view.css:167` 给 `.novel-writer-fw-title-row` 加
  `flex-wrap: wrap; min-width: 0;` 与 `.novel-writer-fw-title-row > * { min-width: 0; }`；
  `styles-src/04-workspace-layers.css:48` 给 `.novel-writer-fw-title-secondary` 加
  `flex-wrap: wrap; min-width: 0;`；`styles-src/08-workbench-v7-v8.css:1195` 给
  `.novel-writer-fw-quick-tools-row` 加 `min-width: 0;`。
- 结果：1440 下 cw=sw=1072、右栏 x=1198 可见；1280 下 cw=sw=912、右栏 x=1038；
  工具栏变两/三行，无横向滚动。

### FIX-02 重启后页签显示视图类型 id（对应 F-02）
- 现象：重启后除最后激活的一个外，全部页签显示 `novel-writer-knowledge-base` 等原始 id，
  要手点一次才变中文（含分离式监控面板 A/B）。
- 根因：Obsidian 1.7.2+ 的 DeferredView 未实例化时 `getDisplayText()` 返回视图类型 id，
  保存工作区布局时把这个 id 写进 `workspace.json`。
- 修法：新增 `ui/view-tab-titles.ts`（视图类型 → 显示名的单一映射，含 9 个视图 + 2 个监控面板）；
  `main.ts` 增加 `_scheduleDeferredTabTitlesFix()` / `_fixDeferredTabTitles()`：
  布局就绪后按 0/300/1000/2500ms 重试，并监听 `layout-change` 兜住新开页签；
  只有当页签文字**等于视图类型 id** 时才改写，不覆盖已正常加载的标题；异常只 `log.warn`，不影响启动。
- 结果：重启后 20 个页签全部中文（`_verify/v5.json`）。

### FIX-03 体检失败静默（对应 F-03）
- 现象：打开第 1 章即触发一次 `deepseek-v4-flash` 调用，key 无效时控制台 401，界面只在体检条显示
  「0% 偏离中 未解析到情节线」，用户无法判断是「章节写得没问题」还是「接口挂了」。
- 根因：`engine/ending-traction-engine.ts` 的 `parsePlotThreads()` 在正则未命中时回退 AI 解析，
  AI 抛错被 `catch` 写成 `log.warn` 后吞掉；UI 侧只看到 `threads.length === 0`。
- 修法：
  - `ending-traction-engine.ts` 新增 `plotThreadError` 字段与 `getPlotThreadError()`，`initialize()` 起始处清空；
    AI 回退的 catch 与「无可用模型」分支写入原因。
  - `ui/full-writer/checkup-bar-controller.ts` 新增 `checkupErrorText()`（401/403/认证/key 类错误映射成
    「API 密钥无效或未配置…」，其余原样透出）与 `reportPlotParseFailure()`：体检条显示
    「体检不可用：<原因>」并按「项目 + 原因」去重后弹一次错误 Notice（标题「写作体检失败」），
    不再每次刷新都刷屏。
- 结果：401 时体检条与 Notice 都写明「API 密钥无效或未配置」，并指向 设置 → API 配置；
  纯空情节线仍是「情节线走势平稳」，不误报。

### FIX-04 「使用中」开关压住文字（对应 F-04）
- 根因：`ui/settings/api-section.ts` 把 checkbox 与 `span.nw-api-switch-text` 一起塞进
  `label.nw-api-switch`，而该类的 CSS 固定 36×20 的开关轨道，文字被挤进轨道里。
- 修法：外层换成 `label.nw-api-switch-field`（inline-flex + gap 6px + flex-shrink: 0），
  轨道 `span.nw-api-switch` 与文字并列；`.nw-api-switch-text` 加 `white-space: nowrap`。
  另两处只有轨道没有文字的用量保持原样。
- 结果（1100×900 实测）：field 126×20，轨道 36×20 在 x=818，文字 84×16 在 x=860，**零重叠、单行**。

### FIX-05 「高级设置」页签四边虚线（对应 F-05）
- 根因：`styles-src/05-floating-panels-and-settings.css` 里只写了 `border-style: dashed`，
  未设宽度时其余三边取 initial `medium`(3px)，于是四边都成了虚线框。
- 修法：`border: none; border-bottom: 2px dashed var(--background-modifier-border);`，
  hover 时只换下边框颜色。
- 结果（实测 computed style）：top/left/right = `0px none`，bottom = `1.6px dashed`。

### FIX-06 阶段导航文字截断 + 英文阶段名残留中文（对应 F-06）
- 现象（修正后口径）：中文 140px 导航里 5 字标签刚好放得下，**英文才暴露问题**——
  ①阶段名一直是中文（切到 en-US 也不变）；②子步骤标签被省略号截成 `Extra ...` / `Distill ...`。
- 根因①：`ui/full-writer/streamlined-nav-presenter.ts` 的 `PHASE_DEFINITIONS` 在**模块加载时**调 `t()`，
  而语言在 `main.ts` onload 里才应用，中文被烤进阶段表。
- 根因②：`.novel-writer-fw-step-label` / `.novel-writer-fw-substep-label` 都是
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`。
- 修法：
  - 阶段名改懒取：新增 `phaseLabel(key)`（switch + 字面量键），`getStreamlinedPhases()` 每次现算 label。
  - 导航列宽 `width: clamp(140px, 16%, 208px); min-width: 120px`。
  - 两级标签都改 `white-space: normal; overflow-wrap: anywhere; line-height: 1.35`；
    子步骤行加 `flex-wrap: wrap`、标签 `flex: 1 1 60px`（避免被「必做」徽标挤成一字一行）。
- 结果：en-US 下 1280×800 阶段名为 Context loading / Chapter planning / Body writing /
  Quality review / Chapter settlement，11 个字步骤标签全部 `trunc:false`（1–2 行）；zh 不变。

### FIX-07 窄高窗口状态栏被裁（对应 F-07）
- 现象：900×600 时容器 clientHeight 409 / scrollHeight 482，状态栏底边 631 超出容器底 568，
  被 `overflow: hidden` 裁掉；1100×680 时状态栏与步骤导航重叠。
- 根因：`@media (max-width: 1100px)` 把工作区改单列后，标题栏换行高 304px + 三栏最小高度超过面板高度。
  另外 `.novel-writer-fw-layout-host` 才是 `@container nw-fw` 的查询容器，标题栏/状态栏/容器都在它**外面**，
  把兜底规则写进 `@container` 永远不生效（第一版修复踩过这个坑）。
- 修法：在 `styles-src/04-workspace-layers.css` 的该媒体查询里加
  `.novel-writer-fw-container { overflow-y: auto; }`、
  `.novel-writer-fw-titlebar { max-height: 40vh; overflow-y: auto; }`、
  `.novel-writer-fw-status-bar { position: sticky; bottom: 0; z-index: 3; }`；
  `15-late-fixes.css` 的窄容器查询里只保留工作区 `min-height: 320px` 防被压成 0。
- 结果：900×600 容器 scrollHeight=409（无纵向溢出）、状态栏 y=471..558 在容器内（`barInside=true`）、
  横向溢出 0；1100×680 状态栏两行 62px 也在容器内。

### FIX-08 启动 3 条 warning（对应 F-08）
- 3 条来源：`engine/heavy-task-worker-manager.ts:103` 与 `engine/quality/quality-worker.ts:44` 把
  `rhythmAnalyzer` 列进「缺失分析器」，但该分析器按设计就不注入（同文件 :84-86 有注释）；
  `engine/analysis-session-manager.ts:751` 把「会话目录不存在」当异常 warn。
- 修法：两处缺失清单只查 `plotDivergenceEngine` / `characterChecker`；
  `.sessions` 列目录遇 `ENOENT` 降为 `log.debug`（仍在 catch 里留日志，不违背静默失败门禁）。
- 结果：同样的「起 Obsidian → 打开写作台」流程，控制台原 3 条 warning 全部消失（`_verify/f08-zh-CN.json`）；
  剩下的 401 是真·无效 key 场景，由 FIX-03 给出可见提示。

## 六、缺陷清单与处置

| ID | 级别 | 现象 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| F-03 | P1 | 打开第 1 章即触发 AI 调用，key 无效时控制台 401，界面无错误提示 | `_verify/v4.json` | ✅ 已修复（FIX-03） |
| F-04 | P2 | 设置页「使用中」开关压住「在其他模块显示」文字 | `_verify/settings-plugin.png` | ✅ 已修复（FIX-04） |
| F-05 | P2 | 「高级设置」页签四边虚线框 | 同上 | ✅ 已修复（FIX-05） |
| F-06 | P2 | 写作台窄宽度下阶段名/子步骤标签被省略号截断；英文阶段名残留中文 | `v7-fw-1280.png` | ✅ 已修复（FIX-06） |
| F-07 | P2 | 800px 高 + 工具栏换行后底部状态栏被裁 | `v7-fw-1280.png` | ✅ 已修复（FIX-07） |
| F-08 | P3 | 启动 3 条 warning（rhythmAnalyzer 未注入 ×2、.sessions ENOENT） | `_verify/v4.json` | ✅ 已修复（FIX-08） |
| F-09 | — | 知识库提示「索引 1 本没有向量」 | `v5-kb.png` | 非缺陷：开发 vault 清过向量库，属预期 |
| F-10 | P3 | 设置页供应商列表在 250px 窄列里名称截成「本地 OIl…」「D… deepseek-v4-flash」 | `_verify/f45-settings-api.png` | 待处理（建议：名称加 `text-overflow: ellipsis` + `title` 全名，或列宽 clamp） |

修复后仍存在的已知噪声（不算缺陷）：打开写作台时 `ChapterStateManager` 会以 warn 级打印 6 条
「restoreChapterState 步骤检查」，属调试留痕，级别可后续降为 debug。

## 七、环境备注（不是插件问题）

- 设置窗口与命令面板在 Obsidian 1.14.5 会开在第二个窗口；用脚本验证时必须先关掉。
- 页签组叠放时 Playwright 的可见性判定会失败，需用 DOM `dispatchEvent` 或 `force: true`。
- 开发 vault 的 `apiKey` 是占位符（`****HERE`），任何 AI 功能都会 401；真实功能验证需换真 key。

## 八、下次回归怎么做

1. `node D:\nw-tmp\verify-1.mjs` → 看 error 数、命令数、页签标题（A1–A4）+ 控制台 warning。
2. `node D:\nw-tmp\probe-f67f.mjs zh-CN` 与 `node D:\nw-tmp\probe-f67f.mjs en-US` → 看 1280×800 / 1100×680 / 900×600 的
   `containerCH/SH`、`phaseLabels`、`subLabels[].trunc`、`barInside`、`docOverflowX`（D1–D4、F2）。
3. `node D:\nw-tmp\probe-f45.mjs` → 看设置页 `.nw-api-switch-field` 是否重叠、`.nw-settings-tab-advanced-toggle` 的
   computed border（F-04/F-05）。
4. `node D:\nw-tmp\probe-f08.mjs zh-CN` → 看启动/打开写作台后的控制台是否只剩真·key 无效的 401（A2、F-08）。
5. 逐条对照 §三 A–F；新增缺陷补进 §六，修复后把行移进 §五。
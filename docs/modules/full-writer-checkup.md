# 全屏写作体检条（full-writer / checkup-bar-controller）

> 状态：stable（功能缺口 2 交付 2026-11-18）　｜　最后更新：2026-11-18　｜　Owner：dsh

## 1. 定位

- **用户视角**：全屏写作视图底部、状态栏之上的一条「写作体检」——左侧 🩺 图标 + 标题 + 完成度百分比 + 进度轨道 + 偏离徽标（偏离 低/中/高），中间一句话建议（如「主线进度滞后：林昭的身世之谜」），右侧「刷新」「详情」两个按钮与「最近 HH:MM」。点「详情」就地展开情节线清单（名称 / 类型 / 状态 / 进度%）与建议；再点收起。
- **代码入口**
  - `ui/full-writer/checkup-bar-controller.ts`（288 行，**LF** 行尾）。
  - `export class FullWriterCheckupController`（`:57`），构造 `constructor(deps: FullWriterCheckupDeps)`（`:40` 定义依赖接口）。
  - `render(container: HTMLElement): void`（`:86`；先 `dispose()` 再建 DOM，末尾 `void this.refresh(true)`）。
  - `async refresh(force = false): Promise<void>`（`:118`）：节流判断在 `:127`（`MIN_INTERVAL_MS = 20_000`，`:9`）。
  - `dispose(): void`（`:156`）、`ensureEngine(project)`（`:175`，按项目缓存实例）、`createDefaultEngine(project)`（`:185`）、`applyState`（`:195`）、`applyIdle`（`:213`）、`paintTip`（`:227`）、`setControlsEnabled`（`:236`）、`toggleDetails`（`:244`）、`renderDetails`（`:250`）。
- **装配点**（`ui/full-writer-view.ts`，CRLF，5 处）：import（`:14`）、字段 `private checkupController!`（`:138`）、构造（`:871`）、渲染（`:1936`，在「// 状态栏」+ `this.renderStatusBar(mainContainer)` 之前，try/catch 包住并 `// silent-ok`）、步骤完成后强制刷新（`:1391`，在 `onStepComplete` 里，条件 `stepKey === 'bodyGeneration' | 'fix' | 'finalFix'`）。
- **数据来源**：`engine/ending-traction-engine.ts` 的 `await checkTraction(volume, chapterNum)`（只做分卷大纲的正则解析 + 进度/偏离/建议计算，**不调 AI**）；返回 `EndingTractionState = { threads, overallProgress, divergenceRisk, recommendations }`（`:45-50`）。引擎构造**不直接 `new`**：`EndingTractionEngine` 在引擎守卫（`npm run check-engines`）里是 `allowedInstances = 1` 的 p1-deferred 类，本控制器统一走 `new CoWriteFacade({ plugin }).createEndingTractionEngine(project)`（`ui/services/co-write-facade.ts:651`，与 `monitor-panel-a/b` 同一唯一构造点）。无自有落盘状态。
- **样式**：新建 `styles-src/42-full-writer-checkup.css`（4240 字节 / 193 行 / 29 个选择器），样式源 47 → **48**；模块短名 `fw-` 在视觉标准 §1.3 **首次登记**。编辑区不在 `.nw-scope` 内，按钮一律 `button.nw-fw-checkup-btn` 元素限定（Obsidian `button` 基线 + `.nw-btn` 在前）。

## 2. 现状（事实，不写愿望）

- **DOM 层级**：`div.novel-writer-fw-checkup`（根，`border-top` + `flex-shrink:0`）→ `div.nw-fw-checkup-row`（`span.nw-fw-checkup-icon` 🩺 + `span.nw-fw-checkup-title`「写作体检」+ `span.nw-fw-checkup-progress`「42%」+ `div.nw-fw-checkup-track` > `div.nw-fw-checkup-fill` + `span.nw-fw-checkup-risk` + `span.nw-fw-checkup-tip` + `div.nw-fw-checkup-actions`（`span.nw-fw-checkup-time` + `button.nw-fw-checkup-btn`「刷新」+ `button.nw-fw-checkup-btn--detail`「详情」））→ `div.nw-fw-checkup-details`（默认收起，展开时加 `--open`）。
- **进度条**：宽度只走 CSS 变量 `--nw-fw-checkup-pct`（`fill.style.setProperty('--nw-fw-checkup-pct', `${pct}%`)`），CSS 是 `width: var(--nw-fw-checkup-pct, 0%)` + `transition: width 0.2s ease`。
- **三态**：正常态（`applyState`：百分比 / 偏离徽标 `--low|--medium|--high` / 建议 / 时间）；空态（`applyIdle`：`!project || !chapterNum` 时进度显示「—」、进度条加 `nw-fw-checkup-fill--empty` 归零、徽标「偏离 —」、建议「打开章节后自动体检」、时间清空、两个按钮 `disabled`）；失败态（`paintTip('体检失败：' + message, true)` + `log.warn('体检失败:', e)`，按钮恢复可点，**不抛到界面**）。
- **触达时机**：视图渲染后首次（`render` 末尾 `refresh(true)`）；正文生成 / fix / finalFix 完成后（`onStepComplete`）；用户点「刷新」（也走 `force`）。其余调用一律受 20s 节流限制。
- **详情面板** `renderDetails`：标题「情节线（N）」，每条 `div.nw-fw-checkup-thread` 内含 `span.nw-fw-checkup-thread-name`（名称）、`span.nw-fw-checkup-thread-meta`（「主线 · 活跃」）、`span.nw-fw-checkup-thread-pct`（「0%」）；建议为 `div.nw-fw-checkup-detail-item`。无情节线时显示「未解析到情节线：请检查分卷大纲…」（引擎原文）。
- **文案映射**：`THREAD_TYPE_LABEL`（main 主线 / subplot 副线 / romance 感情线 / mystery 悬疑线）、`THREAD_STATUS_LABEL`（active 活跃 / dormant 蛰伏 / resolved 已收束 / abandoned 已废弃）、`RISK_LABEL`（低/中/高）；无建议时兜底「情节线走势平稳，保持当前节奏。」。
- **并发保护**：`seq` 递增 token，回写前比对，切项目/切章后陈旧结果不会覆盖新结果；`busy` 期间重复点击刷新直接忽略。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| CW-01 | P0 | 全屏写作视图里**完全没有**写作时体检：`ui/full-writer/` 对 `live-analysis` 零引用，实时分析只在协同写作视图有 | 底部加体检条，复用已交付的 `EndingTractionEngine.checkTraction` | done（缺口 2） |
| CW-02 | P1 | `ui/cowrite/live-analysis-controller.ts` 与 `CoWritingView` 强耦合（读 `view.rightEditor.value`、`view.engine.inspectSettingGuard`、`view.refreshMetrics`/`refreshMonitorPanel`、`view.tractionEngine`、`tractionContainer`/`warningContainer`、`view.volume`/`chapterNum`），无法直接复用 | 只为全屏视图写独立控制器，只复用引擎层 | done（缺口 2） |
| CW-03 | P1 | `checkTraction` 每次都读分卷大纲并正则解析，写法上（每次步骤完成）会反复触发 | 20s 节流 + 步骤完成/手动刷新走 `force` | done（缺口 2） |
| CW-04 | P2 | 空态 / 失败态若不清理，会把上一次的百分比与徽标留在条上，看起来像「刚体检过」 | `applyIdle` 清数值并归零进度条；失败只覆盖建议文案并恢复按钮 | done（缺口 2） |

## 4. 关键决策

1. **用底部条，不做「跳监控面板 B」**：写作时不应切视图；监控面板 B 是右栏整块面板，且需要先打开。条上只放「完成度 / 偏离 / 一句话建议 / 最近时间」，细节放就地展开的 `--open` 面板。
2. **只复用 `EndingTractionEngine`，不搬 `LiveAnalysisController`**：前者是纯解析 + 计算（无 AI、无视图字段），后者绑死 8 个 `CoWritingView` 内部字段（见 CW-02）。
3. **`createEngine` 作为可注入依赖**：单测注入假引擎（`createEngine: async () => ({ checkTraction })`），不读盘、不初始化真实引擎。
4. **节流 20s + `force` 双通道**：引擎读分卷大纲有 I/O 成本，普通调用受 20s 限制；「正文刚变过」「用户主动点刷新」必须立刻出结果，走 `force`。
5. **时间只到分钟（`HH:MM`）**：条窄且只在当前会话有意义，不塞日期；`formatClock` 手工补零，不依赖 locale。
6. **空态归零用修饰类，不用字面量内联样式**：`style.setProperty('--nw-fw-checkup-pct', '0%')` 的字面量写法会被 `obsidianmd/no-static-styles-assignment` 判 error（`npm run lint` 直接挂）；改成 `nw-fw-checkup-fill--empty`（`width: 0`，写在 `fill` 之后靠源码顺序压过变量）。动态百分比仍走 CSS 变量。
7. **`seq` token 防陈旧回写**：切项目/切章时旧请求可能后返回，回写前比对 token，不匹配就丢弃。
8. **引擎构造不直接 `new`**：直接 `new EndingTractionEngine(...)` 会触发引擎守卫「应单例却被直接 new」，所以走 `CoWriteFacade.createEndingTractionEngine(project)`（全仓唯一构造点，`monitor-panel-a/b` 同款）。控制器只依赖 `checkTraction` 的行为，构造路径不影响单测（测试注入 `createEngine`）。
9. **渲染失败不阻断写作**：`render` 在视图里被 try/catch 包住（`// silent-ok`），体检条挂了也只是少一条提示。

## 5. 验收记录

| 项 | 结果 |
| --- | --- |
| 类型检查 | `npx tsc --noEmit` EXIT 0 |
| Lint | `npm run lint` 0 error / 1102 warning（存量） |
| 构建 | `npm run build` → `[styles] 拼接 48 个源文件 → styles.css（31740 行）`，main.js 5,632,554 B / styles.css 790,741 B（check:css 口径 31741 行） |
| 单测 | `tests/unit/ui/full-writer-checkup-bar.test.ts` 八条全绿（见 §6） |
| 回归 | `npx vitest run full-writer-checkup-bar full-writer-view-contracts context-panel-dom` → 3 files / 48 tests 通过 |
| 实机 | `D:\nw-tmp\verify-checkup.mjs`（Playwright + 临时 user-data-dir + 临时分卷大纲，连跑两次 `ok:true`）：条渲染 `progress 0%` / `risk 偏离 中` / `tip 主线进度滞后：林昭的身世之谜` / `rect [366,870,1309,43]`；点「详情」→ `--open` + 2 条情节线（`林昭的身世之谜主线 · 活跃0%`、`与老道士的信任副线 · 活跃0%`）；点「刷新」→ 文案不变、按钮未回空态 |
| 门禁 | `check:inline-styles` 通过（525，不变）；`check:utility` 通过（定义 46 / 引用 46 类 142 次，零引用 0）；`check:css` 与 `check:bundle` 已 `--update-baseline --note` 收紧（见 §8） |
| preflight | EXIT=0，961 文件 / 10132 通过 + 3 skipped |

## 6. 测试清单

- `tests/unit/ui/full-writer-checkup-bar.test.ts`（八条）：无章节空态 + 按钮禁用 + 不调引擎；正常态渲染（42% / 偏离 高 / 建议 / 情节线 / 类型与状态中文 / `--nw-fw-checkup-pct` 为 `42%` / `--high` 修饰类 / 时间格式）；无建议兜底文案；引擎抛错（`体检失败：…` + `--error` + 按钮恢复）；详情展开与收起（`--open` 增删）；20s 节流（首次 1 次、`refresh(false)` 仍 1 次、`refresh(true)` 2 次）；引擎按项目缓存（`createEngine` 只调 1 次）；`dispose()` 后不再调用。
- **必须用静态 `import`**：门禁 `npm run check:view-tests` 只认行首 `import`/`export` 语句，`await import('…')` 这种动态导入不算「有测试」，会报「超过 200 行且没有任何测试 import」。
- 配套工具：`tests/unit/ui/support/fake-dom.ts`（`FakeEl` / `stubCreateDiv` / `stubDocument`）+ `vi.mock('@/main')`。`FakeEl` 没有 `onclick` 类型，点按钮要 `(btn as unknown as { onclick?: (e: unknown) => void }).onclick?.({})`。
- 回归关注：`full-writer-view-contracts`（构造与生命周期契约）、`context-panel-dom`（同属右栏/底部渲染链路）。

## 7. 剩余 backlog（P2/P3）

- 只接了 `EndingTractionEngine`（情节线进度 / 偏离 / 建议）；协同视图里的**质量分、完成度、设定守卫**三类信息尚未接入。
- 节流 20s 写死，未做成设置项（`settings` 里没有对应开关）。
- 建议只显示第一条（`recommendations[0]`），多条要展开详情才能看全。
- 「详情」只在本条内展开，未与监控面板 B 联动（原本设想的「点开跳面板 B」没做，理由是写作时不该切视图）。
- 未在窄屏 / 移动端验证换行与按钮挤压（`flex-wrap` 只在 `-row` 上有 `gap`，窄屏可能压扁 `tip`）。
- 未覆盖「分卷大纲文件被删」这一路径的实机用例（只有单测里的引擎抛错）。

## 8. 交接备注

- **类名前缀已登记**：`fw-` = 全屏写作视图（视觉标准 §1.3 本轮新增），后续 `ui/full-writer/*` 的语义类统一用它，不要再造 `nw-checkup-*` 之类的无归属前缀。
- **两条硬约束**：①空态/失败态只能清数值或改文案，**不许**用字面量 `style.setProperty`（`no-static-styles-assignment` 是 error 级），要归零就加修饰类；②渲染要能静默失败（try/catch + `// silent-ok`），体检条不能把写作视图带崩。
- **门禁与基线**：`check:css` 现基线 bytes **790741** / uniqueClasses **4288**（note 记「+27 个 nw-fw-checkup-* 类」）；`check:bundle` 现基线 main.js **5632554** / styles.css **790741**（note 记「缺口 2：+6103B / +4285B」）。两个脚本都只认 `--note` 参数形式，positional 会被写成默认文案。
- **实机验证脚本**：`D:\nw-tmp\verify-checkup.mjs`——临时写 `D:/nw-dev-vault/示例项目/03-大纲与章节/分卷大纲/第9卷_体检验证.md`（含 `主线：…` 与 `副线（师徒）：…`）并在 `finally` 删除；dev vault 的 `.obsidian/plugins/novel-writer-ai` 是**真实目录**，每轮验证前必须 `Copy-Item main.js,styles.css` 过去（`scripts/dev-vault.mjs sync` 指向 `C:\Users\admin\nw-dev-vault`，不是 D 盘这个）。
- **门禁三个坑**：①`check:view-tests` 只认行首静态 `import`；②`check-engines` 禁止再 `new EndingTractionEngine`（allowedInstances=1，走 `CoWriteFacade`）；③`no-static-styles-assignment` 禁止字面量 `style.setProperty`。
- **驱动细节**：`plugin.openFullWriterView()` 后可能拿到 DeferredView，要 `await leaf.loadIfDeferred()` 再判断 `leaf.view.contextPanel`；`selectChapter(project, chapterName)` 是 private，运行时可直接调。

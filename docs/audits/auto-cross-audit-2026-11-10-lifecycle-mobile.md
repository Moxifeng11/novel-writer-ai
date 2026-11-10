# 自动交叉审计 — Obsidian 生命周期 / API 兼容 / popout / 移动端（①）

> 日期：2026-11-10 · 基线：`703f155` · 维度：① 生命周期/API 兼容/popout/移动端
> 方法：两个独立子代理并行取证——① 逐项核对 main.ts 注册/清理与各视图 onOpen/onClose、任务取消链；② 对照 obsidian 1.4.4 类型、popout 文档归属与移动端能力。交叉核对后合并。本轮修复 1 个 P1。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| L-1 | P1 | `ui/co-writing-view.ts:475-478`、`ui/cowrite/live-analysis-controller.ts:58-64/87` | onClose 先 `clearTimers()` 再 `await saveBody(false)`；保存成功的 `onSaved` 又调 `scheduleRefresh('save')`。`AdaptiveDebounceManager.dispose()` 只取消现有定时器，不阻止后续 schedule | 关闭协同写作视图且正文非空（几乎每次正常关闭） | 关闭后 0.5–1.2s 仍执行 refresh/牵引/守卫检查（守卫会把正文前 6000 字发 AI）；旧章结果可能写进新视图，跨章污染 | **本轮已修**：controller 增加 `closed` 闸门与 `markClosed/markOpened`，onClose 改调 `markClosed`；新增 3 条回归测试 |
| L-2 | P2 | `main.ts:2077-2127`、`ui/co-writing-view.ts:471-497`、`ui/cowrite/body-save-controller.ts:8` | onunload 先 flush 后 detach 叶子，`detachLeavesOfType` 不 await 视图 onClose；`saveBody` 超时上限 30s；启动期 300ms/1s/3s `setTimeout` 与 `onLayoutReady` 未登记清理 | 禁用/热重载时协同视图有未保存正文，或加载后 1–3s 内禁用 | 旧视图保存可能在 `disposeAll()` 之后、甚至重新 enable 之后完成，用旧快照覆盖新实例；欢迎框/更新检查可能在卸载后执行 | 未修 → fix queue（卸载屏障 + timer 登记 + `_unloaded` 守卫） |
| L-3 | P2 | `engine/batch-import-manager.ts:837-841`、`:416-498` | `dispose()` 只 `flush()`；`runTask` 三个 await 均不检查 signal；只有 `cancelTask()` 会 abort | 批量导入 processing 时禁用/热重载 | 卸载后继续建书/写源文/排拆解任务；目标调度器已销毁，形成半成品书籍与重复数据 | 未修 → fix queue（dispose 先 abort 全部 + 状态置 cancelled + 每个 await 后检查） |
| L-4 | P2 | `ui/agent-workbench-view.ts:311-323`、`:274`、`:1138` | `restart()` 直接重跑 onOpen：旧 resizer 未 destroy、旧 `AgentSessionStore` 的节流 pending 未 flush 就被替换 | 工作台已打开时再点 Ribbon / openAgentWorkbench | 拖拽中重启可能残留 `nw-panel-resizing`；旧项目最后一条会话快照可能写进新项目或丢失 | 未修 → fix queue（restart 前 flush+destroy+清 timer） |
| L-5 | P3 | `engine/engine-registry.ts:277/770-806`、`:1130-1520` | `disposeAll` 未清理 `factIndexManagers`；注册无 `dependencies` 元数据，所谓逆序实为注册逆序；后台 embedding 探测无取消/generation 守卫 | 使用过事实索引/风格学习后禁用插件 | registry 仍持有项目级 FactIndexManager（含 App/索引）；旧探测可能在重新 enable 后覆盖共享 provider | 未修 → fix queue |
| L-6 | P2 | `ui/full-writer-view.ts:917/994-1009/1017-1072`、`ui/views/knowledge-base-view.ts:535/579-583` | onOpen 多个 await 之后才 `registerEvent`/订阅调度器；onClose 可能先执行 | 加载慢时用户立刻关闭视图或热重载 | 已 unload 的 Component 继续注册 workspace 事件；KB 在 onClose 后重新订阅 scheduler，闭包永久持有视图 | 未修 → fix queue（openToken/closed 标志 + 注册前移） |
| M-1 | P2 | `core/theme-manager.ts:79/129/161/184`、`services/font-manager.ts:133/174/199`、`ui/full-writer-view.ts:931-934`、`ui/panel-resizer.ts:161/191/233` | 主题变量、布局变量、自定义字体、拖拽 body 类全部只操作主 `document` | Obsidian 1.6+ 多窗口，把工作台/协同/知识库拖到 popout 或在 popout 打开 Modal | popout 丢失自定义配色、面板宽度、自定义字体；拖拽时 body 类加在主窗口；临时 textarea/input 可能挂错文档 | 未修 → fix queue（按 `ownerDocument` 逐文档注入 + 临时节点挂宿主文档） |
| M-2 | P2 | `core/settings-service.ts:405/478-483`、`engine/co-writer/co-write-options.ts:244-261`、`engine/co-writer-engine.ts:2928-2952` | 本地模式默认开启；`resolveCoWriteModel` 返回 undefined 时 `resolveCoWriteLocalProvider` 仍按 `id==='ollama'` 命中，路由到 `localhost:11434`，且 `callCoWriteForUi` 未走 `hasCoWriteModel()` 守卫 | 全新安装（尤其移动端）未配置本地模型，点“AI 修复” | 移动端必然连接失败且 `disableFallback=true` 不回退云端；知识库向量默认 ollama+local-only 同样不可用 | 未修 → **待拍板**：是否在未显式选本地模型时阻断（会改变「装了 Ollama 即可用」的现状），或仅移动端默认改云端 |
| M-3 | P2 | `ui/chapter-outline-tree-modal.ts:616/667-752`、`ui/plot-canvas-modal.ts:201/225-245` | 章节/场景/情节重排仅 HTML5 drag，无触摸替代 | iOS/Android 触摸操作 | 排序功能在手机上完全不可达 | 未修 → fix queue（⬆/⬇ 按钮或 Pointer Events + 共用排序纯函数） |
| M-4 | P2 | `ui/knowledge-detail-modal.ts:279`、`:1680` | 使用私有 API `app.plugins.getPlugin('novel-writer-ai')`；第二处无 `?.`，仅靠外层 catch | 打开书籍详情/重新拆解；App 结构变化 | 社区审核风险；失败时切换参考书/重拆静默失效 | 未修 → fix queue（构造函数注入 plugin，两个调用点已有 `this.plugin`） |
| M-5 | P2 | `scripts/check-obsidian-api.mjs:54/57/72` | `deprecated-api` 只匹配字面调用，漏检 `this.setTitle()`、解构别名、`Platform as unknown as` 强转；`global-document-listener` 漏 `window.addEventListener`/`document.body.addEventListener`；整文件 allowlist 过宽 | 后续 PR 使用 1.4.4 之后的 API | CI 绿但 1.4.4 运行时报 `is not a function` | 未修 → fix queue（子代理夹具实测 4 种绕过均未报错） |
| M-6 | P3 | `ui/draggable-panel.ts:148-152`、`styles-src/05-floating-panels-and-settings.css:25-35`、`styles-src/26-cleanup-utilities.css:352-358` | 浮窗 header 无 `touch-action: none`、未监听 `pointercancel`；知识库卡片操作仅 `:hover` 显示 | 手机上拖动监控面板 / 查看书籍卡 | 拖动被浏览器滚动接管、`nw-float-dragging` 残留；操作按钮不可见 | 未修 → fix queue（两行 CSS + pointercancel） |

## 二、已排除项（交叉确认）

- **API 下限**：`Vault.getAllFolders` / `getFileByPath` / `getFolderByPath` / `ensureSideLeaf` / `Modal.setTitle` 生产代码 0 调用；`revealLeaf` 已收口到 `revealLeafCompat`；`setCssProps` 仅 theme-manager 且有 `typeof` 守卫。**实际越界 0 处**。
- **注册清理**：命令/视图/Ribbon/设置页/`registerEvent`/`registerInterval` 均由宿主自动回收；手工清理项（宠物、统计、调度器、缓存、prompt cache、RulesService、浮窗、7 个主视图叶子、字体、sink、`window.novelAI`）基本成对。
- **社区审核红线**：`innerHTML/outerHTML/insertAdjacentHTML` 实际赋值为 0（唯一命中是 `safe-html.ts` 注释）；无 `eval/new Function`；无动态 `<style>`；MarkdownRenderer 的 component 参数均为 ItemView/自管 Component，未把 plugin 当 Component。
- **任务取消链**：拆解调度器、Worker 池、JobService、实体重检、图谱校验、协同建议/指标、Agent 回合在 disable/关闭时均可 abort；批量导入与实时分析除外（见 L-1/L-3）。
- **移动端守卫正确项**：状态栏、桌面宠物、dsh、只读保护、`showInFolder` 均有 `Platform.isMobile` 分支；`child_process` 仅动态 import 且有桌面守卫；Worker 有主线程降级。
- **合理主窗口限定**：写作宠物（刻意 body 级浮窗）、`export-file.ts` 下载锚点、设置页读主 `document.body` 不算 popout 缺陷。

## 三、本轮修复与验证

- L-1：`LiveAnalysisController` 增加 `closed` 状态与 `markClosed/markOpened`；`scheduleRefresh` 首行拒绝；`CoWritingView.onClose` 改调 `markClosed()`、`onOpen` 调 `markOpened()`。
- 新增 `tests/unit/ui/cowrite-live-analysis-close-guard.test.ts` 3 条：关闭后 save 不再排程、重开恢复排程、视图接线契约（不得再用 `clearTimers`）。
- `npx vitest run`（新增+相关）：9 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- **M-2**：本地模式未选择本地模型时，是否直接阻断？
  - 方案 A（建议）：仅**移动端**把默认协同模式改为云端，并在本地模式下未选模型时给明确错误；
  - 方案 B：所有平台都要求显式选本地模型（会改变「装了 Ollama 就能直接用」的现状）；
  - 方案 C：维持现状，仅修文案（移动端提示无法运行本机 Ollama）。
  本轮不擅自改变默认值/产品行为。

## 五、fix queue（维度①结果）

1. L-2 卸载屏障 + 启动 timer 登记（P2，影响热重载数据安全）
2. L-3 批量导入可取消（P2）
3. L-6 onOpen/onClose 竞态 token（P2）
4. M-1 popout 逐文档主题/字体（P2）
5. M-5 门禁补强（P2，防回归）
6. L-4 Agent restart、M-3 移动端排序、M-4 去私有 API、L-5 disposeAll、M-6 触屏 CSS

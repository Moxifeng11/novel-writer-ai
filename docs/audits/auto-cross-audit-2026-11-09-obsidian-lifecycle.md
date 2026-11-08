# 自动交叉审计 · 维度① Obsidian 生命周期 / API 兼容 / popout / 移动端

- 日期：2026-11-09
- 触发：HANDOFF `nextAudit=obsidian-lifecycle`（无 Trae 消息，分支 B2）
- 审计方式：**两个独立只读视角交叉取证**——A 视角做全仓静态扫描（grep 计数 + 关键片段，173 次工具调用）；B 视角精读 `main.ts` / 7 个视图 / `shared/dom-window.ts` 并回答 12 个定点问题（60 次工具调用）。ZCode 对两人的全部 P1 与关键 P2 逐条复核（命令与行号见下表「复核」列），冲突处给出反证。
- 结论：**P1 2 项（本轮已修）**；P2 8 项、P3 若干进入 fix queue；13 类「疑似问题」经复核**排除**（见 §三）。

## 一、已修（本轮，P1，均带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 复核 |
|---|---|---|---|---|---|
| A-1 | `ui/full-writer/tab-controller.ts:277` + `ui/full-writer-view.ts:1117` | 模型快速切换器句柄只在 `renderTabBar()` 下一次重绘时销毁；`FullWriterView.onClose` 不销毁它 | 打开完整写作工作台后关闭 | 句柄留在 `ui/model-quick-switcher.ts` 模块级 `refreshers` 集合，之后每次模型/供应商变更都会刷新已脱离 DOM 的按钮；随开关次数线性增长 | 复核成立：`dispose` 缺失、onClose 无 tabController 清理；同项目其余三个视图都 dispose 了同一句柄 |
| A-2 | `main.ts:2043`（onunload） | 只 `workspaceManager.closeAll()` 关闭 4 类浮窗，7 个主视图 leaf 依赖宿主回收 | 禁用插件/热重载时主视图开着 | 留下空白页签并写回工作区布局；`onClose` 不执行（`--nw-*` 变量、ContextPanel、工作台标记可能残留） | 复核成立：全仓 `detachLeavesOfType` 0 处；官方样例插件在 onunload 做同样清理 |

修法：
- `TabController.dispose()`（销毁并清空 `modelSwitcher`）+ `FullWriterView.onClose` 调用；`tests/unit/ui/full-writer-tab-controller-dispose.test.ts`（3 例：销毁/空句柄/重复 dispose）。
- 新增 `shared/plugin-leaves.ts` 的 `detachPluginLeaves()`（逐类型、单类型失败不阻断）；`onunload` 对 7 个主视图调用；`tests/unit/shared/plugin-leaves.test.ts`（3 例）。

## 二、Fix queue（未修，按严重度）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| B-1 | P2 | `engine/deconstruction-scheduler.ts:2808` | `destroy()` 清了 interval/abort/map，但未 `progressDebounceManager.dispose()`；`AdaptiveDebounceManager` 本身提供 dispose | 加 1 行；卸载前 2s 内有拆解进度事件时会回调已释放的 KB 管理器 |
| B-2 | P2 | `main.ts:1006/1534` + `main.ts:969/1948/1958/1966` | 两处 `onLayoutReady` 未登记、4 个一次性 `setTimeout` 未保存句柄；`_entityRecheckAbort` 未 abort | 加 `_unloaded` 守卫 + 保存 timer 句柄清理 + abort/clear 重检表（约 20 行） |
| B-3 | P2 | `ui/co-writing-view.ts:235/3128`、`ui/cowrite/suggestion-edit-modal.ts:31` | 质量浮窗与建议编辑抽屉挂在 `document.body`；视图 onClose 不关闭它们 | onClose 调 `hideQualityPopup(this.qualityReportPopup)` 并关闭抽屉 |
| B-4 | P2 | `ui/co-writing-view.ts:890` | `registerDomEvent(document, 'click', ...)` 绑主窗口文档；popout 内点击收不到「点外部收起」 | 改 `onNodeDoc(this.containerEl, ...)`；**同时是 `check:obsidian-api` 的漏检模式**（规则只匹配 `document.addEventListener(`） |
| B-5 | P2 | `ui/co-writing/quality-popup.ts:56`、`ui/cowrite/suggestion-edit-modal.ts:31` | 挂载用全局 `document.body`、定位用全局 `window.innerWidth/Height` | 改 `resolveNodeDoc(anchor)?.body` + 所属窗口尺寸 |
| B-6 | P2 | `ui/full-writer/scene-outline-controller.ts:1124` | `document.querySelector('.nw-scene-outline-container')` 全局查找 | 用视图容器内查询；popout 下当前所有刷新路径都找不到容器（静默不刷新） |
| B-7 | P2 | `ui/views/knowledge-base-view.ts`、`ui/views/writing-fingerprint-view.ts` | 无 AbortController / 关闭代次；长任务（导入/分类/向量/指纹加载）关闭后继续跑并回调渲染 | 加 `viewClosed` 守卫已部分存在，补 abort 或代次检查 |
| B-8 | P2 | `main.ts:1315`、`main.ts:1611` | 移动端 `activateCoWritingView` 无条件打开两个 330px 浮窗；宠物命令移动端仍提示「已开启」 | 移动端跳过浮窗并提示；宠物命令移动端直接说明不支持 |

P3（摘要，详见修复清单）：
- `ui/full-writer/wizard-step-renderers.ts:777/826` 5s 看门狗、`scene-outline-controller.ts:943` 1s 保存防抖在关闭后仍执行（后者写盘）。
- `full-writer-view.ts:145/1983` `workspaceResizers` 未 destroy；`panel-resizer.ts:161/191/233` 用主文档 `body` 加拖拽类。
- `core/theme-manager.ts:71`、`services/font-manager.ts:133/199` 只作用于主文档（popout 主题变量/字体降级）。
- `ui/monitor-panel-b.ts` SVG `document.createElementNS`（adopt 通常可用）。
- `shared/export-file.ts:72/117` 用未声明且强转的 `App.isMobile`（1.4/1.14 typings 均无；运行时通常存在）→ 建议 `Platform.isMobile`；**同时绕过 `check:obsidian-api` 的 `app\.isMobile` 正则**。
- `shared/desktop-shell.ts:37/55`、`engine/agent/dsh/dsh-process.ts:70/94` 默认参数直接读 `process.*`，函数本身无平台守卫（当前调用方都有）。
- `ui/components/progress/operation-confirm-modal.ts:67/81/308` localStorage 无 try/catch。
- 内部 API：`app.commands.listCommands/executeCommandById`、`app.plugins.getPlugin/disablePlugin/enablePlugin`（1.4 可用，官方审查有风险）。

## 三、已排除（复核后确认无问题，避免重复审计）

| 项 | 证据 |
|---|---|
| `document.addEventListener` 泄漏 | 全仓 0 处；历史 9 处已迁 `onNodeDoc`，7 个绑定与解绑成对（`create-project-modal:351→481`、`story-linkage-modal:233→238`、`draggable-panel:143→158`、`writing-pet:253→179`、`categorization-review-panel:332→70`、`model-picker-popover:163→63`） |
| `setInterval` 未清理 | 5 处均有对应 clear（scheduler heartbeat/watchdog、KB monitor、suggestion-flow、main `registerInterval`） |
| `workspace.on` 漏包 | 6 处全部在 `registerEvent` 内 |
| 1.5+ API 越界 | `getAllFolders`/`getFileByPath`/`getFolderByPath`/`setCssProps`/`Modal.setTitle` 源码均 0 处；`getLeaf`/`getRightLeaf`/`createLeafBySplit`/`requestUrl`/`MarkdownRenderer.render`/`Platform` 在 1.4.11 声明存在 |
| 移动端桌面 API | `process`/`child_process`/`getBasePath` 调用点均有 `Platform.isMobile` 或能力探测守卫；`isDesktopOnly:false` 与实现一致 |
| 视图 onClose 主体 | FullWriter/CoWriting/Agent/KB/指纹/Monitor B 均已取消在途任务、清 timer、dispose 子控制器（个别 `super.onClose()` 未调用，P3 卫生项） |

## 四、门禁盲区（本轮新增发现）

`check:obsidian-api` 的两条规则只匹配字面写法，以下绕过方式不会被拦：

1. `registerDomEvent(document, 'click', ...)`（B-4）——`global-document-listener` 只匹配 `document.addEventListener(`；
2. `(app as unknown as { isMobile?: boolean }).isMobile`（`shared/export-file.ts`）——`deprecated-api` 的 `app\.isMobile` 匹配不到强转后写法。

建议（下一轮代码批次）：规则 1 增加 `registerDomEvent\(\s*(document|window)\s*,`；规则 2 增加 `\{[^}]*isMobile` 的强转形态，或直接禁止 `App.isMobile` 字样并白名单注释；补 2 条违规样例测试。

## 五、结论与下一步

- 本轮修复 2 项 P1（A-1/A-2），均带测试；P2 8 项入 fix queue。
- 下一审计维度：**② 数据一致性（写锁/回滚/账本/迁移）**（`nextAudit=data-consistency`）。
- 下一代码批次优先取：B-1（1 行）→ B-3/B-4/B-5（协同 popout 三连）→ 门禁盲区两条正则。

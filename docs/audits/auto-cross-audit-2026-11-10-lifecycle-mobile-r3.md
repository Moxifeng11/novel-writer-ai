# 自动交叉审计 — 生命周期 / API 兼容 / popout / 移动端（①，三轮复审）

> 日期：2026-11-10 · 基线：`1e5c8c1` · 维度：① 生命周期/API/popout/移动端（三轮）
> 方法：两个独立子代理复审（生命周期 + 移动端/popout），对照前两轮报告排除已修项。本轮修复 1 个 P1（M-2 自动切云端被旧闸门短路）+ 1 个 P3（已 abort 仍发 requestUrl）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| M3-1 | P1 | `engine/co-writer-engine.ts:381-389`、`:302/366/1005/1553/1672/2936`、`engine/context/story-context-service.ts:60`、`ui/co-writing/suggestion-flow.ts:179` | M-2 自动切云端只改了 options 构建；`hasCoWriteModel` 与 6 处 raw `coWriteModelMode` 判断仍按本地模式检查，直接返回空/降级 | 用户看到“已自动切换到云端模型”，但建议/续写/改写/守卫全部无反应；本地槽位信号量/Ollama 探测/local 上下文预算也被错误套用 | **本轮已修**：新增 `canCoWrite`；`hasCoWriteModel` 委托；6 处分支与故事上下文档位/ETA 判断改用 `resolveEffectiveCoWriteMode`；旧测试预期同步 |
| L3-1 | P2 | `ui/full-writer-view.ts:917-1092`、`ui/views/knowledge-base-view.ts:535-649` | L2-2 仍在：onOpen 在多个 await 后才 registerEvent/订阅；无 openSeq；KB 的 `viewClosed` onOpen 不复位 | 已 unload 的 Component 继续持有事件；KB 关闭后重新订阅，实例复用后刷新永久失效 | **已修（第54轮）**：新增 `shared/view-open-guard`；full-writer onOpen 起手 begin、每处 await 后及注册监听前核对、onClose invalidate；KB onOpen 首行复位 `viewClosed` 并 begin、await 后核对、onClose invalidate；守卫行为 3 条 + 接线契约 2 条测试 |
| L3-2 | P2 | `ui/agent-workbench-view.ts:314-327`、`ui/services/agent-session-store.ts:129-170` | L2-3 仍在：restart 不 flush 旧 store、不 destroy 旧 resizer | 旧项目最后一条快照可能写进新项目；拖拽中重启残留 body 类 | 未修 → fix queue（先 flush/destroy，冻结 scope） |
| L3-3 | P2 | `main.ts:765-788`、`shared/plugin-data-migration.ts:34-97` | 迁移仍在 onload 无超时 await（首启数秒无入口）；无 `_isUnloaded` 检查 | 慢盘/移动端首启卡住；禁用后仍继续 initialize | 未修 → fix queue（withUnloadDeadline 1.5–2s） |
| L3-4 | P3 | `main.ts:1036-1079`、`shared/template-scaffold.ts:74-84` | 启动维护未进 UnloadBarrier；`runEnsureTemplateScaffold` 写循环无 abort 检查；模块级 in-flight 跨实例无法去重 | 禁用后仍写剩余模板；新旧实例并发 create 时后来者计 failed 并误报“初始化不完整” | 未修 → fix queue（signal + owner token） |
| L3-5 | P3 | `engine/engine-registry.ts:278/731-809/1312-1340` | L2-5：`factIndexManagers` 不随项目释放；embedding 探测无 generation | 多项目会话持有项目级索引；探测可能覆盖新实例 provider | 未修 → fix queue |
| L3-6 | P3 | `shared/http-transport.ts:121-131` | L2-6：signal 已 abort 仍先发 requestUrl | 移动端白耗一次计费调用 | **本轮已修**：requestViaUrl 先判 aborted；新增 1 条测试 |
| M3-2 | P2 | `core/theme-manager.ts:79-184`、`services/font-manager.ts:133-199`、`ui/panel-resizer.ts:161-233` | M2-1：popout 主题/字体/拖拽 body 类仍只写主 document | popout 回落默认配色/字体；拖拽光标类落错窗口 | **已修（第55轮）**：新增 `shared/document-scopes` 登记表；main.ts 监听 window-open/close 登记并补齐主题/布局/字体；ThemeManager 写全部已登记文档；font-manager 注册/卸载覆盖全部文档并支持补进新窗口；panel-resizer body 类按宿主 `resolveNodeDoc(el)` 解析 |
| M3-3 | P2 | `ui/chapter-outline-tree-modal.ts:613-752`、`ui/plot-canvas-modal.ts:201-245` | M2-2 + 新发现：移动端排序仍只有 HTML5 drag；场景向下拖有 off-by-one | 触屏不可排序；桌面场景下移顺序错误 | **已修（第56轮）**：新增 `shared/array-move`（最终位置 / 移除前插入坐标两种语义）；场景 drop 与同卷章节 drop 统一走 helper（修 off-by-one）；章节树与情节画布各加 ▲▼ 点按按钮（触屏入口） |
| M3-4 | P2 | `ui/knowledge-detail-modal.ts:279/1680`、`ui/monitor-panel-b.ts:189` | M2-3：`app.plugins` 私有 API 仍在；monitor 绕过命令 registry | 审核风险；结构变化时重拆/参考书静默失效 | **已修（第53轮）**：Modal 构造注入 `plugin`（`getPlugin()` 不再回退 `app.plugins`，缺失时 Notice）；两处调用点传 `plugin: this.plugin`；结算按钮改 `this.plugin.executeCommand('novel-writer-chapter-settlement')` |
| M3-5 | P2 | `scripts/check-obsidian-api.mjs:54/57/71-73` | M2-4：门禁仍漏 `this.setTitle`、解构 isMobile、`app.plugins`、body/window 监听；整文件 allowlist 过宽 | 1.4.4 运行时才炸；私有 API 零门禁 | **已修（第53轮）**：新增 `private-api` 规则（`app.plugins`/`getPlugin('novel-writer-ai')`，不误伤内部 `this.getPlugin()`）；deprecated-api 补 `this.setTitle(`/非可选 `isMobile` 解构；body/window 监听纳入；夹具增 4 类绕过断言 |
| M3-6 | P2 | `ui/draggable-panel.ts:124-153/284-312`、`styles-src/05/26` | M2-5：浮窗无 touch-action/pointercancel，390px 屏越界；知识卡操作 hover-only | 手机拖动被滚动接管/浮窗大半在屏外/按钮不可见 | **已修（第57轮）**：header 加 `touch-action:none`、监听 `pointercancel`；默认/恢复/保存三处按视口夹取宽高与坐标；知识卡操作在 `@media (hover:none)` 与 `:focus-within` 下常显 |

## 二、已排除项（交叉确认）

- L-1/L-3/L2-1 barrier、`cacheFilePath()`、D2-7 未回退。
- 启动维护延后后首次建项目安全：`project-create-service`/`full-writer-view`/fanfic 均先 `await ensureTemplateScaffold`，模块级 in-flight 让建项目等待同一任务。
- `_startupMaintenanceScheduled` 是实例字段，热重载不残留；启动 timer 已 `register(clearTimeout)` 且有 `_isUnloaded` 双检查。
- 流程面板 2s 缓存切项目/切章会清空（`detachListeners`），不会显示旧项目数据；agent-port 只在 long 传 longChapters。
- `dependencies` 元数据已在 `sortByDependencyReverse` 消费（上轮“零使用”判断过期，已更正）。
- 抽查路径单源/worker 质量平价/`check:obsidian-api` 基线 0 违规均未回退。

## 三、本轮修复与验证

- `co-write-options.ts`：新增 `canCoWrite(settings)`（生效模式 + 云端模型/本地模型）。
- `co-writer-engine.ts`：`hasCoWriteModel` 委托 `canCoWrite`；6 处 raw mode 判断改 `resolveEffectiveCoWriteMode`；本地槽位/探测/预算按生效模式。
- `story-context-service.ts`：co-write 档位按生效模式（本地未选模型自动切云端后给 cloud 预算）。
- `suggestion-flow.ts`：本地 ETA 文案按生效模式。
- `http-transport.ts`：`requestViaUrl` 在 signal 已 abort 时直接拒绝，不发请求。
- 测试：`canCoWrite` 表驱动 1 条、引擎闸门旧用例改为“自动切云端会调用 AI”、故事档位用例更新、http-transport 新增 1 条；相关 16+18 条通过；`npx tsc --noEmit` = 0。
- 第53轮（M3-4/M3-5）：`knowledge-detail-modal.ts` 构造注入 `plugin`、去掉两处 `app.plugins`；`knowledge-section.ts` 两处调用点补注入；`monitor-panel-b.ts` 改走 `executeCommand`；`check-obsidian-api.mjs` 新增 `private-api` 规则并补 `this.setTitle`/`isMobile` 解构/body/window 监听；`obsidian-api-policy.test.ts` 增干净夹具与 4 类绕过断言（10 条通过）。门禁全仓 0 违规；`preflight:release` 全绿（660 文件 / 6991 通过 / 3 跳过，语句 45.8%）；bundle 基线 +52B 已注记。 
- 第54轮（L3-1）：新增 `shared/view-open-guard.ts`（begin/isCurrent/invalidate）；full-writer 与 KB 视图接入，KB 复位 `viewClosed`；新增守卫行为测试 3 条 + 接线契约测试 2 条；全量 662 文件 / 6996 通过 / 3 跳过，语句 45.8%；bundle 基线 +546B 已注记。
- 第55轮（M3-2）：新增 `shared/document-scopes.ts`；main.ts window-open/close 登记 + 补齐主题/布局/字体；ThemeManager 与 font-manager 改为写全部已登记文档；panel-resizer body 类按宿主 Document；新增跨窗口主题 2 条、字体 2 条、接线契约 3 条、拖拽契约 1 条；全量 664 文件 / 7004 通过 / 3 跳过，语句 45.82%；bundle 基线 +760B 已注记。
- 第56轮（M3-3）：新增 `shared/array-move.ts`（最终位置 / 移除前插入坐标）；章节树场景 drop 与同卷章节 drop 统一走 helper（修「向下放到上半区差一位」）；章节树与情节画布各加 ▲▼ 点按按钮；新增 helper 7 条 + 视图行为/接线 5 条；全量 666 文件 / 7016 通过 / 3 跳过，语句 45.84%；bundle 基线 +2116B 已注记。
- 第57轮（M3-6）：`draggable-panel` 加 `pointercancel` 监听与 `clampPanelToViewport`，默认/恢复/保存三处按视口夹取；`styles-src/05` header 加 `touch-action:none`；`styles-src/26` 知识卡操作 `@media (hover:none)`/`:focus-within` 常显；新增布局夹取 2 条 + 触屏契约 2 条；全量 667 文件 / 7020 通过 / 3 跳过，语句 45.85%；bundle 基线 main.js +887B / styles.css +365B 已注记。维度① 三轮 fix queue 清零。

## 四、待用户拍板

- 无（M-2 已按拍板执行；本轮只是让拍板真正生效）。

## 五、fix queue

1. L3-2 Agent restart 收尾、L3-3 迁移 deadline（P2）
2. L3-4 scaffold abort/owner token、L3-5 registry 清理（P3）

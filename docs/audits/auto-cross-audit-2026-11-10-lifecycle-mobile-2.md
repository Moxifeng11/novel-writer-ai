# 自动交叉审计 — 生命周期 / API 兼容 / popout / 移动端（①，二轮）

> 日期：2026-11-10 · 基线：`4784445` · 维度：① 生命周期/API/popout/移动端（二轮）
> 方法：两个独立子代理复审（对照首轮报告排除 L-1/L-3/S-3/S-4/S-8 已修项）。本轮修复 2 个 P2 路径/生命周期缺口并补 3 组回归测试。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| L2-1 | P2 | `main.ts:2098-2149`、`ui/workspace-manager.ts:104-111`、`shared/plugin-leaves.ts:22-33`、`ui/co-writing-view.ts:450/497`、`ui/cowrite/body-save-controller.ts:8` | 卸载仍不等待视图 `onClose` 异步落盘（`detach` 只触发不 await）；co-work 保存链最坏 10s+15s+30s；启动期 4 个 `setTimeout` 与 2 个 `onLayoutReady` 未登记 | 旧快照可能在 `disposeAll` 后甚至重新 enable 后覆盖新正文；卸载后仍弹 Welcome/跑更新检查 | 未修 → fix queue（UnloadBarrier + `_unloaded` + `register` 清理） |
| L2-2 | P2 | `ui/full-writer-view.ts:917/994-1069`、`ui/views/knowledge-base-view.ts:535-646` | `onOpen` 在多个 `await` 之后才 `registerEvent`/订阅 scheduler；无 openToken；KB 的 `viewClosed` 在 onOpen 未复位 | 已 unload 的 Component 继续注册 workspace 事件；KB 关闭后重新订阅，闭包永久持有视图 | 未修 → fix queue（openSeq + KB viewClosed 复位） |
| L2-3 | P2 | `ui/agent-workbench-view.ts:311-323`、`ui/services/agent-session-store.ts:129-170` | `restart()` 直接重跑 onOpen；旧 sessionStore pending 未 flush 就被替换；旧 resizer 未 destroy | 最后一条会话快照可能写进新项目或丢失；拖拽中重启残留 `nw-panel-resizing` | 未修 → fix queue（restart 先 flush/destroy，约 6 行） |
| L2-4 | P2 | `main.ts:766-783`、`shared/plugin-data-migration.ts:34-56`、`shared/plugin-cache.ts:73` | 迁移在 onload 关键路径同步等待（6MB/多文件移动端数秒，无 deadline）；**`CACHE_FILE` 在模块导入期冻结**，自定义 configDir/BRAT 改名时 cache 读写兜底路径 | 升级首启变慢；cache 写错位置，布局/实体缓存/欢迎框状态反复丢失 | **部分已修**：cache 路径改为惰性 `cacheFilePath()`；迁移加 deadline 仍留 fix queue |
| L2-5 | P3 | `engine/engine-registry.ts:278/771-809`、`:1313-1341` | `disposeAll` 未清 `factIndexManagers`；`dependencies` 元数据零使用；后台 embedding 探测无 generation | registry 仍持有项目级事实索引；探测可能在卸载后覆盖共享 provider | 未修 → fix queue |
| L2-6 | P3 | `shared/http-transport.ts:121-131` | `requestUrl(params)` 在 `abortable` 之前求值：signal 已 abort 仍会发出请求 | 移动端白耗一次计费请求（无持久写入） | 未修 → fix queue（先判 aborted 再发） |
| M2-1 | P2 | `core/theme-manager.ts:78-188`、`services/font-manager.ts:126-203`、`ui/panel-resizer.ts:161/191` | popout 主题变量与自定义字体只写主 `document`（走查修正：拖拽本身在 popout 可用，仅主题/字体失效） | popout 回落默认配色/字体；主窗改主题 popout 不更新 | 未修 → fix queue（按 Document 注入 + window-open 重注入） |
| M2-2 | P2 | `ui/chapter-outline-tree-modal.ts:613-752`、`ui/plot-canvas-modal.ts:201-263` | 章节/场景/情节排序只有 HTML5 drag；抓手只监听 mouse 事件 | iOS/Android 完全无法排序，键盘用户也无替代 | 未修 → fix queue（moveWithinArray + ⬆/⬇ 按钮） |
| M2-3 | P2 | `ui/knowledge-detail-modal.ts:277-284/1677-1694`、`ui/monitor-panel-b.ts:188-190` | `app.plugins.getPlugin` 私有 API 仍在（第二处无 `?.`）；monitor 面板直接 `executeCommandById` 绕过 registry | 审核风险；结构变化时参考书/重拆静默失效 | 未修 → fix queue（构造注入 plugin + 走插件命令） |
| M2-4 | P2 | `scripts/check-obsidian-api.mjs:50-74` | 门禁仍漏 6 种写法：`this.setTitle`、解构别名、`isMobile` 无问号强转、`document.body.addEventListener`、`window.addEventListener`；整文件 allowlist 过宽 | 未来用 1.5+ API 仍 CI 绿，1.4.4 运行时才炸 | 未修 → fix queue（补 pattern + 4 条夹具） |
| M2-5 | P3 | `ui/draggable-panel.ts:124-153`、`styles-src/*` | 浮窗 header 无 `touch-action:none`、无 pointercancel；初始坐标按桌面预设，390px 屏右缘越界；知识库卡片操作 hover-only | 手机拖动被滚动接管、类残留；操作按钮不可见 | 未修 → fix queue |
| M2-6 | P3 | `engine/engine-registry.ts:1190`、`shared/plugin-worker-url.ts:37` | 仍有代码直接拼 `manifest.dir`/`configDir+PLUGIN_ID`（自定义 configDir/BRAT 改名会读错） | `data.json.bak` 永不生成（SEC-11 静默失效）；worker URL 404 降级主线程 | **本轮已修**：改走 `pluginSettingsFile()` / `pluginRootDirPath()`；analysis-session 经核对生产调用已用 root（子代理误报，已排除） |

## 二、已排除项（交叉确认）

- L-1 协同视图 `closed` 闸门仍在（`markClosed` 先于 saveBody），测试在位。
- L-3 批量导入 `dispose` abort/取消仍在；仅 `main.ts` 的 flush 早于 disposeAll 使 abort 延后（并入 L2-1）。
- S-3/S-4/S-8 修复未回退；`resolvePluginRootDir` 对 `.obsidian/...` 与 `plugins/...` 两种形态均正确。
- **修正首轮判断**：工作台/Agent 面板拖拽在 popout 仍可用（监听绑元素、变量写目标元素）；真正失效的是主题调色板与自定义字体。
- `http-transport` 的 `requestUrl` 走 `throw:false`、abort/timeout 可拒绝等待、SSE 缓冲 reader 可用；残余仅是原生请求不可中断。
- `analysis-session-manager` 生产构造点已用 `pluginRootDirPath()`，子代理“写错目录”结论不成立（仅构造函数保留 manifest.dir 端口供测试）。

## 三、本轮修复与验证

- `shared/plugin-cache.ts`：`CACHE_FILE` 常量改为 `cacheFilePath()` 惰性求值，load/save 均使用；新增 2 条测试（导入后再注入根目录仍写对路径、从注入目录读回）。
- `shared/plugin-worker-url.ts`：worker 相对路径改走 `pluginRootDirPath()`，不再 `configDir + PLUGIN_ID` 硬拼；测试补 BRAT 改名用例并显式注入根目录。
- `engine/engine-registry.ts`：`backupSettings` 源文件改用 `pluginSettingsFile()`；新增 `pluginSettingsFile`/`pluginSessionsDir` 单源函数与路径断言。
- `npx vitest run`（3 文件）：25 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- M-2 仍待拍板（本地模式未选本地模型是否阻断）；本轮未改默认值。

## 五、fix queue

1. L2-1 UnloadBarrier + 启动 timer/Modal 登记（P2，数据安全）
2. L2-2 openSeq/KB viewClosed 复位（P2）
3. M2-3 去 `app.plugins`、M2-4 门禁补 pattern（P2，审核风险）
4. L2-3 Agent restart 收尾、M2-2 移动端排序按钮、M2-1 popout 主题/字体（P2）
5. L2-4 迁移 deadline、L2-5 factIndexManagers/generation、L2-6 abort 预检、M2-5 触屏 CSS（P3）

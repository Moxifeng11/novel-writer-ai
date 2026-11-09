# 自动交叉审计 · 维度① Obsidian 生命周期 / API 兼容 / popout / 移动端

- 日期：2026-11-09
- 触发：无 Trae 消息（分支 B2）；上一轮为 W-1b 代码批次，本轮复核维度①（上一轮代码批次 + 审计队列未复核项）
- 审计方式：**两个独立只读视角交叉取证**——A 视角 API 兼容/移动端静态审计（175 次工具调用）；B 视角生命周期/popout/资源回收精读（209 次工具调用）。ZCode 对 P1 逐条复核；本轮无 ≤50 行且可测试的 P1 修复，只出报告。
- 结论：**P1 1 项**、P2 9 项、P3 5 项；已排除 12 类「疑似问题」。**无 P0。**
- **交叉核对**：A 认为 popout 基础设施（`shared/dom-window.ts`、锚点窗口、`ownerDoc` 绑定）已到位；B 也确认 10 个 view type 的注册/摘除并集完整——两方一致；B 列的 popout 主题/字体/场景大纲问题属于「基础设施正确但消费方仍用主 document」，不冲突。A 的 P1 是网络出口，B 的 P1 为 0，属不同维度，不构成反证。

## 一、Findings

| ID | severity | 位置 | 问题 | 触发条件 | 影响 | 建议 |
|---|---|---|---|---|---|---|
| O-1 | **P1** | `scripts/check-obsidian-api.mjs:59-68`；`engine/ai-api-client.ts:637`；`engine/embedding/openai-provider.ts:20-24`、`ollama-provider.ts:63` | `direct-fetch` allowlist 整文件放行非流式请求；全仓 94 处 `.callAI()` 走 `fetch` + `response.text()`，无 `requestUrl` 兜底/Platform 分支 | 移动端 + 供应商不返回 CORS 头（自建网关常见） | 移动端生成/嵌入在 CORS 层被拒，门禁因 allowlist 永远看不到 | 非流式在移动端走 `shared/http-request` 的 requestUrl 包装；allowlist 只保留真正 SSE；本地探测加 localhost-only/桌面守卫 |
| O-2 | P2 | `main.ts:746-939/1529-1539`；`engine/engine-registry.ts:319-334/1299-1332` | onload/onunload 无代次门闩；onunload 不 await，旧 onload await 后仍 registerView/registerEvent；旧 unload 延迟清理可能 detach 新实例 leaf/移除新变量 | onload 未完成时禁用或快速 disable→enable | 永久定时器/view type 残留；新实例工作台被旧清理摘除 | 加 `_unloaded`/generation，每个 await 后短路注册；registry `sealed`；清理前置或按代次过滤 |
| O-3 | P2 | `ui/settings-tab.ts:156-176`、`ui/full-writer/tab-controller.ts:308-317`、`main.ts:608/968-973` | `_pendingReloadState` 是旧插件实例内存字段，disable/enable 后新实例读到 null | 点“热重载”后手动关闭再启用 | UI 承诺“工作台状态自动恢复”实际不恢复 | 改 sessionStorage（TTL/一次性）或 data.json 临时字段；onload 读取后清除 |
| O-4 | P2 | `core/theme-manager.ts:78-90/128-157/182-188`、`services/font-manager.ts:131-203`、`ui/full-writer-view.ts:931/1138` | 主题变量只写主 `document.documentElement`；字体只注册主 `document.fonts`；无 `window-open`/`onWindowMigrated` 重放 | 视图拖入 popout | 自定义主题色、面板宽度、自定义字体在 popout 静默丢失 | 按窗口注入变量/字体；ThemeManager 维护 document 集合；视图 `onWindowMigrated` 重新 apply |
| O-5 | P2 | `ui/full-writer/scene-outline-controller.ts:1122-1126` | `refreshAll()` 用 `document.querySelector('.nw-scene-outline-container')` 查主文档 | 工作台在 popout 中保存/增删/生成场景 | 列表/编辑器不重绘；主窗口有第二个工作台时可能刷错实例 | 保存 render host 引用或 `containerEl.doc` 查询；deps 注入 hostEl |
| O-6 | P2 | `main.ts:1007-1017/1535-1537/968-973/1948-1970/1787-1802` | 未登记的一次性调度：onLayoutReady 修剪会话/统计扫描、300ms 开工作台、1s/3s 欢迎、实体重检 AbortController | 禁用时布局未 ready 或正文刚保存触发 3s 重检 | 禁用后仍删会话、写统计、弹 Modal；实体重检继续调 AI 并写项目文件 | onunload abort `_entityRecheckAbort` 全表、清 hash、保存/清 setTimeout；延迟回调首行判 `_unloaded` |
| O-7 | P2 | `ui/chapter-outline-tree-modal.ts:616-752`、`ui/plot-canvas-modal.ts:201-242`；`ui/co-writing-view.ts:1015`、`ui/co-writing/quality-highlight.ts:62`、`ui/svg-charts.ts:317/351` | 章节/场景/剧情卡仅 HTML5 DnD；质量详情/图表数值仅 hover | 移动端触屏 | 拖拽排序静默无效；问题/建议/数值不可达 | 补上移/下移按钮或 Pointer Events；质量条目改 click/tap；SVG 数据点加 click/focus |
| O-8 | P2 | `ui/polish-editor.ts:263-280` | paste 先 `preventDefault()`，再用主窗口 `window.getSelection()` 找插入点/读取选区 | popout 内润色编辑器粘贴或 AI 润色 | 粘贴文本被丢弃或插到主窗口；AI 润色拿到空/错误选区 | 用 `editorDiv.ownerDocument.getSelection()`；优先 beforeinput/execCommand |
| O-9 | P2 | `core/settings-service.ts:405/473-481`；`engine/co-writer/co-write-options.ts:225-250`；`ui/settings/writing-sections.ts:91-118` | 默认协同 `local`、向量 Ollama + `local-only`，无 Platform 分支 | 移动端首次安装 | 请求发往手机 localhost，且禁云端回退，协同/RAG 首次即失败 | 移动端默认 cloud/allow-cloud；本地模式禁用/标注；Ollama 支持 LAN 地址 |
| O-10 | P2 | `scripts/check-obsidian-api.mjs:50-57/92-105`；`package.json:87`；CI | 1.4 兼容只靠正则；无 `obsidian@1.4.0` 类型编译；deprecated API 漏 `Modal.setTitle`/`getFileByPath`/`trashFile` 等；`setCssStyles`/`attr.style` 未纳入样式规则 | 新代码使用 1.5+/1.6+ API | CI 全绿但 1.4 运行时炸；历史 B-2 无回归保护 | 增加 1.4 类型编译 job；扩充规则；明确 attr.style 由内联预算承接 |
| O-11 | P3 | `ui/views/knowledge-base-view.ts:1515`、`ui/full-writer/project-selector-controller.ts:138` | popout 元素用主窗口 `HTMLElement` 做 `instanceof` | popout 中知识库重试/项目创建滚动 | 详情不渲染/滚动高亮静默跳过 | 判 `tagName/nodeType` 或 `ownerDocument.defaultView.HTMLElement` |
| O-12 | P3 | `ui/golden-opening-modal.ts:286-289`、`ui/settings/foreshadow-section.ts:117-119` | 剪贴板未 await/catch 却提示“已复制”；部分入口无兜底 | 移动端无 clipboard 或窗口未聚焦 | 误导成功；未处理 rejection | 抽 `copyText()`：await + catch + textarea/execCommand 兜底；成功提示后置 |
| O-13 | P3 | `styles-src/00-header.css:96-250`、`02-full-writer-view.css:296` | 82 处 `color-mix()` 无 `@supports` 降级 | 旧移动 WebView（<Chromium 111/iOS 16.2） | 自定义色变量 computed-value 失效，按钮/hover 回退透明 | `@supports` 外层提供 rgba/预计算变量 |
| O-14 | P3 | `ui/draggable-panel.ts:127`、`ui/story-linkage-modal.ts:89/124/130`、`ui/components/categorization-review-panel.ts:323` | `onWindowMigrated`/`el.win` 无守卫，但 minAppVersion=1.4.0 | Obsidian <1.6 打开监控/浮窗/关联弹窗 | `onOpen` 首行 TypeError，面板打不开 | `typeof` 守卫；`el.doc?.defaultView ?? window`；或提高 minAppVersion |
| O-15 | P3 | `main.ts:1612-1616`、`core/command-registry.ts:531` | 移动端宠物命令仍提示“已开启” | 移动端执行宠物命令 | 文案与实际能力不符 | 移动端禁用/说明仅桌面 |

## 二、已排除（复核后确认无问题）

| 项 | 证据 |
|---|---|
| 1.4 API 越界 | `Vault.getAllFolders`、`getFileByPath`、`FileManager.trashFile`、`MarkdownRenderer.renderMarkdown`、`Modal.setTitle`（9 处 `.setTitle` 均为 MenuItem）、`app.isMobile` 强转均 0 处；`setCssProps` 仅 theme-manager 且有 typeof 守卫 |
| view 注册/摘除 | 7 个主视图 + 3 个浮窗 view type 全覆盖；`detachPluginLeaves` 并集无遗漏 |
| 定时器/Worker | 5 处 setInterval 均有清理；worker-manager/heavy-task dispose 幂等 |
| observer | 生产代码无 MutationObserver/ResizeObserver/IntersectionObserver |
| 视图 onClose | full-writer/co-writing/agent/KB/fingerprint/monitor/draggable 主体清理齐全 |
| popout 基础设施 | `shared/dom-window.ts`、锚点窗口 popover、`event.view`、`ownerDocument` 绑定已就位 |
| Modal 窗口语义 | `Modal.open()` 在 active window；`Menu.showAtPosition(pos, doc)` 支持指定 doc |
| 卸载顺序 | flush→disposeAll，`withUnloadDeadline` 有 catch，单引擎失败不阻断 |
| 缓存/单例 | prompt cache、RulesService、字体反注册、window.novelAI、降级 sink、fingerprint flush 均有清理 |
| 主题变量兜底 | styles.css `:root` 有全部 `--nw-*` 默认值，popout 是降级不是崩坏 |
| 移动端桌面能力 | dsh/protect-yuan/step-viewer/状态栏/宠物/设置 Agent 均有守卫；工作台/协同/KB 有容器/媒体单列 |
| 重复 onload | Obsidian 每次 enable 新建实例；真实风险是 O-2 的异步重入 |

## 三、待用户拍板

- 无。O-1 的网络出口改造涉及「移动端 requestUrl 不支持 AbortSignal、取消=丢弃迟到结果」的语义，若要求严格取消体验，需要另行确认取舍；本轮仅记录，不改网络行为。

## 四、后续批次建议

1. **O-1**：先改 embedding 两类 provider（OpenAI 兼容/ Ollama）的移动端 requestUrl 分支，再评估 `ai-api-client` 主路径（改动最大，单独批次）。
2. **O-2/O-6**：生命周期代次门闩 + unload abort/清定时器，可合为「卸载可靠性」批次，需 E2E 锁。
3. **O-4/O-5/O-8**：popout 消费方收口，优先场景大纲与润色编辑器（可单测/真实窗口手测）。
4. **O-10**：1.4 类型编译 job + deprecated 规则扩充，属门禁批次。
5. **O-7**：移动端拖拽/hover 可达性，先补上移/下移按钮，不重写 DnD。

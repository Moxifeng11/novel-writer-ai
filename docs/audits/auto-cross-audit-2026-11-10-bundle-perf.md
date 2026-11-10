# 自动交叉审计 — 依赖 / 包体 / 性能 / 首屏（⑤）

> 日期：2026-11-10 · 基线：`95f1fa9` · 维度：⑤ 依赖/包体/性能/首屏
> 方法：两个独立子代理并行取证——① 用 esbuild metafile 复现构建、统计依赖与包体构成；② 精读 onload/工作台首屏/常驻监听。交叉核对后合并；本轮修复 2 个 P1。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| PF-1 | P1 | `engine/engine-registry.ts:1394` → `knowledge-vector-store.ts:200/291/302` | onload 串行 `await knowledgeVectorStore.init()`，递归列目录 + 逐文件 `read` + `JSON.parse` 全部向量文件；实测本仓 8 文件 / 6.3 MB | 任何使用知识库的用户启动/重载插件 | 命令/Ribbon/视图注册被推迟；移动端/慢盘更明显。查询路径本就有 `ensureLoaded()` 懒加载，init 只是预热 | **本轮已修**：改到 `workspace.onLayoutReady` 后台预热，失败不影响首次查询；`perf-contracts` 增加源码契约（不得再出现 `await knowledgeVectorStore.init()`） |
| PF-2 | P1 | `ui/full-writer-view.ts:1004-1015` + `context-loader-controller.ts:51` + `tab-controller.ts:107-116` | 首次打开工作台时 `activeTabId` 已是 `project-selector`，`loadContext()` 又 `activateTab('project-selector')` 全量渲染一次，随后 `renderProjectSelectorInTab()` 再渲染一次；且因 `wasActive` 为真误弹「已刷新当前页面」 | 从 Ribbon/命令打开工作台（无章节） | 项目选择页整页渲染两次；长篇库每次含 N 次项目元数据扫描 + ≥4 次全库遍历，首屏延迟约翻倍 | **本轮已修**：空项目且已在选择页时不再 `activateTab`；新增 `tests/unit/ui/context-loader-empty-project.test.ts` 2 条行为断言 |
| PF-3 | P2 | `scripts/check-bundle.mjs:30`、`.bundle-baseline.json`、`scripts/check-release.mjs:139-146` | workers 完全在体积门禁外：两个 worker 合计 791,198 B（99.4% 是 main 已有模块的重复编译）；check:release 只校验存在且 ≥1,000 B，不校验语法或上限 | 引擎代码增长/误引入大依赖 | worker 腐化无门禁可拦；发布 zip 中 791 KB JS 无上限 | 未修 → fix queue（把 workers 纳入基线 + `node --check`） |
| PF-4 | P2 | `.github/workflows/release.yml:77-80`、`.github/workflows/ci.yml:3-6/84` | `check:bundle` 只在 CI（master/PR）跑；tag 推送不触发 ci.yml，release.yml 只 build + check:release | 打 tag 发版 | 发布路径可绕开体积棘轮 | 未修 → fix queue（release.yml 增加 check:bundle/check:secrets/check:obsidian-api） |
| PF-5 | P2 | `ui/full-writer/project-selector-controller.ts:264-270`、`ui/project-utils.ts:331-350`、`utils/helpers.ts:323-351` | 项目选择页按项目数重复全库 `getFiles()`：每个项目 `getProjectMeta` 一次，再叠加章节扫描 2 次、流程摘要 2 次 | 项目数 N，打开选择页 | N 个项目约 4N+ 次全库遍历（20 项目约 24 次/渲染）；修复 PF-2 后减半但仍偏高 | 未修 → fix queue（渲染入口取一次快照透传） |
| PF-6 | P2 | `main.ts:814/826`、`shared/template-scaffold.ts:73-99`、`services/rules-service.ts:250` | 每次启动都在 UI 注册前执行 56 次 `adapter.exists`（模板自举）与一次全库 `getFiles()`（规则副本清理） | 每次插件启动 | 启动入口可用时间被推迟；网络盘/移动端更明显 | 未修 → fix queue（完成标记 + 布局就绪后执行） |
| PF-7 | P3 | `main.ts:1542-1546`、`services/writing-stats-service.ts:174-193` | 写作统计监听无防抖，每次正文 modify 都 `vault.read` 整章 | 自动保存（约 2s 一次） | 持续写作时重复读盘；无全库扫描 | 未修 → fix queue |
| PF-8 | P3 | `ui/settings-tab.ts:208-225` | `refresh()` 清空所有 tab 的 DOM 缓存并重建当前 tab | 任意设置变更 | 模板分区会重新读模板；P3 | 未修 → fix queue |

## 二、已排除项（交叉确认）

- **依赖面干净**：`package.json` 无 `dependencies`；`npm ls --omit=dev` 为空；metafile 751 个输入全部是项目源码，0 个 `node_modules`；devDependencies 未被打入。
- **无静态 Node 内置模块**：产物唯一静态 `require("obsidian")`；3 处 `import('node:child_process')` 均为运行时动态加载且有桌面端守卫，移动端可用。
- **主包无重复模块**：751 个输入路径唯一、内容 SHA-256 精确重复组为 0；`writing-rules`/`true-random` 是 5 B re-export 门面；同名 `frontmatter`/`word-count`/`chapter-status` 是两套不同实现（逻辑重复风险，非包体重复）。
- **无测试/文档/dev 代码误打包**：Top 25 仅占 28.69%，最大模块 `shared/webnovel-knowledge-base.ts` 4.36%（数据表，非异常代码）。
- **新模块无启动成本**：`shared/http-transport.ts` / `shared/reload-state.ts` 顶层只有 import 与纯函数；onload 唯一调用是 `consumePendingReloadState()`（一次 sessionStorage 读写）。
- **常驻监听无全库扫描**：vault modify 监听有 800ms/3s 防抖；context 缓存失效只做路径判定；世界书/宠物无高频全库重算。
- **设置页首开无阻塞 await**：只同步渲染当前 API 分区，不重新读设置/知识库/模板。

## 三、包体构成（metafile 实测）

- `main.js` 4,939,456 B；按层：engine 40.49% / ui 38.95% / shared 15.31% / services 3.15% / core 1.20%。
- Top 5：`shared/webnovel-knowledge-base.ts` 4.36%、`engine/deconstructors/foreshadow-deconstructor.ts` 1.84%、`shared/template-scaffold-assets.generated.ts` 1.54%、`character-deconstructor.ts` 1.39%、`ui/co-writing-view.ts` 1.27%。
- workers：`deconstruction-worker.js` 682,507 B / `quality-worker.js` 108,691 B；跨产物重复 786,223 B（99.4%），属 Blob Worker 结构性重复，应测量封顶而非强行去重。
- 生成资产 190,831 B（3.86%）：模板资产 76 KB、changelog 62 KB、赞赏码 base64 52 KB（源 JPEG 39 KB，base64 膨胀约 33%）。

## 四、本轮修复与验证

- PF-1：`engine/engine-registry.ts` 改为 `onLayoutReady` 后台预热；`tests/__mocks__/obsidian.ts` 补 `onLayoutReady` 同步执行；`tests/unit/ui/perf-contracts.test.ts` 增加「不得 await 向量库 init」契约。
- PF-2：`ui/full-writer/context-loader-controller.ts` 空项目分支仅在不在选择页时 `activateTab`；新增 2 条行为测试（不重复激活 / 仍能切回）。
- `npx vitest run`（新增+相关）：14 passed；`npx tsc --noEmit` = 0。

## 五、遗留与建议下一步

- fix queue 顺序：PF-3（worker 预算 + `node --check`）→ PF-5（选择页单次快照）→ PF-4（release.yml 门禁）→ PF-6（启动维护完成标记）。
- 未发现需要用户拍板的产品语义变更；本轮不涉及发版。

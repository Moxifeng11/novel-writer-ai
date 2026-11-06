# 性能与缓存

> 版本：v4.23.4 · 2026-11-02
> 说明：旧版本文档因编码损坏不可恢复，本版按当前代码重写；只写可验证的事实与定位方法，不再维护易漂移的基准数字。

---

## 1. 缓存分层

| 层 | 实现 | 用途 | 失效方式 |
|---|---|---|---|
| L1 内存 | `shared/lru-cache.ts` | 热点对象/解析结果，容量+TTL | 容量淘汰、TTL、显式 `invalidate` |
| L2 文件缓存 | `shared/file-cache.ts` | 跨会话可复用的派生数据 | 文件 mtime/哈希变化 |
| 多层组合 | `shared/multi-layer-cache.ts` | L1→L2→源文件回填 | 任一层失效即回源 |
| 插件缓存 | `shared/plugin-cache.ts` | 索引、统计等插件级数据 | 版本/项目变更 |
| 契约缓存 | `engine/body-writer.ts#resolveContract` | 写作规则→正文格式契约 | 规则文件 `mtime+size` 指纹 |

约定：

- 缓存键必须包含**项目/路径/版本**等隔离维度，避免跨项目污染。
- 读改写路径不要用缓存代替锁；缓存只解决读放大。
- 缓存写入失败必须降级为「不缓存」，不能阻断主流程。

## 2. 已知热路径

以下文件禁止退回全库扫描（`vault.getFiles()` / `vault.getMarkdownFiles()` / `vault.getAllLoadedFiles()` 三者都是 O(全库)，门禁 `scripts/check-hotpath-scans.mjs` 逐文件检查 `HOT_FILES`）：

- 正文落盘、结算、统计、上下文装配、实体读取、知识库索引等 8 个模块，以及 UI 侧每章/每次质量刷新各跑一次的 `ui/full-writer/batch-pipeline-runner.ts`（断点续跑读步骤结果）与 `ui/cowrite/realtime-quality-controller.ts`（前文窗口扫描）——共 10 个模块（以脚本清单为准）。

门禁覆盖面（第 26 轮实测，防止「换个 API 绕过」）：

- 三个 API 都按行文本检查，命中任一即失败；每文件只报首个命中行号。
- 非测试代码中 `getMarkdownFiles()` / `getAllLoadedFiles()` 共 7 处，**全部是冷路径**：`ui/add-fanfic-setting-modal.ts:337`、`ui/batch-import-modal.ts:1622`、`ui/agent-workbench-view.ts:651`、`ui/plan-book-modal.ts:262`、`ui/full-writer/wizard-step-renderers.ts:288`、`ui/project-utils.ts:282`、`ui/project-utils.ts:312`。
- `ui/project-utils.ts#getChaptersForProject` 一次调用 = `getFiles()` + `getAllLoadedFiles()` 两次全库遍历，但调用方全是视图渲染/弹窗/导航（`full-writer/title-bar-controller.ts:94`、`full-writer-view.ts:1510/1526/1634`、`full-writer/project-selector-controller.ts:196`、`services/agent-port.ts:297/327/347`、`full-writer/creation-flow-state.ts:217`、`quality-dashboard-modal.ts:159`、`story-linkage-modal.ts:65`），不在每章写/每次刷新的热路径内，故未纳入 `HOT_FILES`。若将来接入每章流程，必须先改为目录遍历再纳入清单。

排查方法：

```bash
npm run check:hotpaths
rg "getFiles\(|getMarkdownFiles\(|getAllLoadedFiles\(" engine services shared core domains ui
npm run bench:hotpath        # 200 章基准（见 scripts/bench/get-files-hotpath.mjs）
```

- 新增热路径模块时，把它加入 `HOT_FILES` 并补基准。
- 目录遍历优先使用 `entity-reader` / `getFolderByPath` 等既有入口，不要自建全库扫描。

## 3. 性能监控

- 服务：`services/performance-monitor.ts`（耗时、调用次数、慢操作）。
- 入口：设置页「性能监控」分区与监控面板。
- 原则：监控本身不能成为瓶颈；采样/节流后再上报。

## 4. 常见优化点

| 场景 | 做法 |
|---|---|
| 大章节注入 | 预算裁剪（`shared/prompt-budget.ts`），先裁旧工具结果再丢旧轮次 |
| 重复解析 | 内容哈希/契约指纹缓存，变更才重算 |
| 频繁 UI 重渲染 | 只重绘变化区域；节流按章/按项目 |
| 文件写入 | 同路径串行（`withWriteLock`），批量操作合并写 |
| Worker | 重任务走 Worker；不可用时降级主线程并提示 |

## 5. 测量与回归

1. 先建立基线：固定项目/章节/模型，记录耗时与调用次数。
2. 用 `npm run bench:hotpath` 或监控面板取数。
3. 改动后复测同一路径；没有数字对比不称为优化。
4. 把关键阈值写成门禁或测试，避免回退（参考 `check:hotpaths`、性能相关单测）。

### 5.1 启动加载基线（2026-11-06，第 24 轮实测）

方法：用临时脚本（`tmp/measure-startup.cjs`，未入库）把 `obsidian` 模块与最小 DOM/GUI 桩替换后，在 Node 中 `require('main.js')`，只计时**模块求值**（不含 Node 进程启动）。同一条命令连跑多次取中位数。

| 对象 | 字节 | 冷加载耗时 |
|---|---|---|
| `main.js`（v4.51.0，minify + utf8） | 4,855,409 | 105.9 / 108.0 / 109.7 / 108.0 / 107.9 ms（中位 **108.0**） |
| 同字节副本（排除路径缓存影响） | 4,855,409 | 104.1 / 104.8 / 105.8 ms |
| 同字节「纯字符串」对照 | 4,855,409 | 21.7 / 18.9 / 19.2 ms |

结论：

- 启动求值约 **108ms**；读取+解析下限约 **19ms**，其余约 **89ms** 来自真实代码的 AST 规模与顶层求值。
- 同字节副本与原件一致 → 没有证据表明「某个 eager import 单独拖慢启动」；差异由代码体积/结构整体决定。
- Obsidian 只加载单个 `main.js`，`import()` 懒加载不会减少已打包进同一文件的解析成本，因此「重模块 eager import 扫描」不作为可执行优化项；`check:bundle` 的包体积继续作为启动成本的代理指标。
- 不要把「每 MB 毫秒数」当线性公式：纯字节对照已证明字节数本身不决定耗时。

回归建议：`main.js` 体积变化超过 2%（约 ±97KB）时复测一次本节基线，并记录差值来源。

## 6. 相关

- 门禁表：[generated/gates.md](generated/gates.md)
- 架构与数据流：[handbook/02-architecture.md](handbook/02-architecture.md)
- 排障：[handbook/07-runbook.md](handbook/07-runbook.md)

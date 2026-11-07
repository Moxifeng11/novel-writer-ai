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

- 正文落盘、结算、统计、上下文装配、实体读取、知识库索引等 8 个模块，以及 UI 侧每章/每次质量刷新各跑一次的 `ui/full-writer/batch-pipeline-runner.ts`（断点续跑读步骤结果）、`ui/cowrite/realtime-quality-controller.ts`（前文窗口扫描）与 `ui/full-writer/creation-flow-state.ts`（工作台阶段面板每次刷新整包采集，第 60 轮接入）——共 11 个模块（以脚本清单为准）。

门禁覆盖面（第 26 轮实测，防止「换个 API 绕过」）：

- 三个 API 都按行文本检查，命中任一即失败；每文件只报首个命中行号。
- 非测试代码中 `getMarkdownFiles()` / `getAllLoadedFiles()` 共 7 处，**全部是冷路径**：`ui/add-fanfic-setting-modal.ts:337`、`ui/batch-import-modal.ts:1622`、`ui/agent-workbench-view.ts:651`、`ui/plan-book-modal.ts:262`、`ui/full-writer/wizard-step-renderers.ts:288`、`ui/project-utils.ts:282`、`ui/project-utils.ts:312`。
- `ui/project-utils.ts#getChaptersForProject` 一次调用 = `getFiles()` + `getAllLoadedFiles()` 两次全库遍历，调用方多为视图渲染/弹窗/导航（`full-writer/title-bar-controller.ts:94`、`full-writer-view.ts:1510/1526/1634`、`full-writer/project-selector-controller.ts:196`、`services/agent-port.ts:297/327/347`、`ui/full-writer/creation-flow-state.ts:220`、`quality-dashboard-modal.ts:159`、`story-linkage-modal.ts:65`）。第 60 轮已把 `ui/full-writer/creation-flow-state.ts`（阶段面板刷新）纳入 `HOT_FILES`，但门禁只查文件内直接调用、不追间接 helper，经该 helper 产生的扫描仍不报警；要彻底收敛需把 helper 改为目录遍历，受其它冷路径调用方影响，单独立项。

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

### 5.2 v5 自动化与出版检查（2026-11-06）

- `npm run check:automation` 只读取 JSON/文本（状态台账、HANDOFF、版本文件、信箱末行），无目录遍历；纳入 `preflight` 后为常量级开销。
- 工作台阶段面板每次刷新都调用 `collectCreationFlowState`（**无缓存复用**），单次采集的全库遍历数按模式/分支：**长篇 2 次**（`getChaptersForProject` 的 `getFiles()` + `getAllLoadedFiles()`；`hasExportArtifact` 已改目录局部遍历，不再整库扫描）；**短篇/剧本 1 次**（`listModeUnits` 的 own + legacy 共用一次 `getFiles()`；`hasExportArtifact` 同上）；**旧结构 1 次**（同一快照内 own 为空即复用 legacy 过滤）。叠加 `agent-port.getProjectStatus` 先自行统计章节/单元、再整包调用采集，一次阶段刷新实际为**长篇 4 次**、**短篇/剧本 2 次**。触发点：左栏首次渲染 2 次（`refreshProjectList` 尾部 + 显式调用，且并发重叠）、每回合结束 1 次、切换项目 2 次。该文件已在第 60 轮纳入 `check:hotpath-scans` 的 `HOT_FILES`，但门禁只防文件内直接调用回退，经 `getChaptersForProject` 的间接扫描仍需单独立项。**2026-11-07 纠偏**：此前「复用既有采集结果、不新增全库扫描」的结论与代码不符。
- 取证与量化见 [audits/v4.63-collect-creation-flow-perf.md](audits/v4.63-collect-creation-flow-perf.md)：10,080 文件合成基准下，单次全库遍历+过滤约 0.2–0.5 ms，随 vault 文件总数线性增长；真机无埋点数据，不写毫秒断言。
- 已实施（第 59 轮，ZCode 第 58 轮派工 A1+A2）：① `hasExportArtifact` 改为 `shared/vault-tree.listFolderFiles` 只列 `${project}/05-导出`、`${project}/06-导出` 与 `EXPORT_FALLBACK_DIR`（递归、任意扩展名、空目录算未导出），保持同步调用面与四种判定语义不变；② `listModeUnits` 的 own + legacy 合并为一次 `getFiles()` 快照。实测单次采集：长篇 3→2、短篇/剧本 3→1；阶段刷新长篇 5→4、短篇/剧本 3→2；`main.js` 4,867,445（较基线 −15B）。回归由 `tests/unit/ui/creation-flow-state-scan.test.ts` 锁定（3 条扫描次数 + 4 条导出语义 + 第 60 轮 4 条模式目录映射）。**导出目录缺口（第 60 轮已修复）**：短篇/剧本产物实际落在 `短篇创作/05-导出`、`剧本创作/06-导出`；`hasExportArtifact` 现按模式映射到模式子目录，并兼容旧版项目根 `05-导出`/`06-导出`，修复了「换设备/清缓存丢失 localStorage 标记后误报未导出」的用户可感知问题。
- 待优化（第二阶段，未实施）：`agent-port.getProjectStatus` 复用已统计的章节/单元，避免整包采集重复 `getChaptersForProject`/`listModeUnits`；预期阶段刷新长篇 4→2、短篇/剧本 2→1（需改签名并补测试）。
- 出版检查为纯内存计算（章节内容在导出时已加载），严格模式只增加一次遍历，不改变导出 I/O 次数。
- 回归口径：`check:automation` 必须通过；`bench:hotpath` 不新增违规模块；导出与阶段面板改动按链 4 手工验收。

## 6. 相关

- 门禁表：[generated/gates.md](generated/gates.md)
- 架构与数据流：[handbook/02-architecture.md](handbook/02-architecture.md)
- 排障：[handbook/07-runbook.md](handbook/07-runbook.md)

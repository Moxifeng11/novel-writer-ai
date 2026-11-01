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

以下文件禁止退回 `getFiles()` 全库扫描（`scripts/check-hotpath-scans.mjs` 的 `HOT_FILES`）：

- 正文落盘、结算、统计、上下文装配、实体读取、知识库索引等 8 个模块（以脚本清单为准）。

排查方法：

```bash
npm run check:hotpaths
rg "getFiles\(" engine services shared core domains
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

## 6. 相关

- 门禁表：[generated/gates.md](generated/gates.md)
- 架构与数据流：[handbook/02-architecture.md](handbook/02-architecture.md)
- 排障：[handbook/07-runbook.md](handbook/07-runbook.md)

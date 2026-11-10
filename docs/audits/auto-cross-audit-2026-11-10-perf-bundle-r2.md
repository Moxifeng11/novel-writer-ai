# 自动交叉审计 — 依赖 / 包体 / 性能 / 首屏（⑤，二轮复审）

> 日期：2026-11-10 · 基线：`2cc481c` · 维度：⑤ 依赖/包体/性能/首屏（二轮）
> 方法：两个独立子代理复审（esbuild metafile 内存复现 + 启动/首屏代码精读）。本轮修复 1 个 P1（启动维护阻塞 UI 注册）+ 1 个 P2 门禁（support-qr 接线）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| P2-1 | P1 | `main.ts:839-853`、`shared/template-scaffold.ts:82-91`、`services/rules-service.ts:224-259` | 每次启动都在命令/Ribbon/视图注册前 `await ensureTemplateScaffold`（56 次 exists）与 `_checkRulesVersion`（全库 getFiles + 串行 delete） | 入口可用被推迟；移动端/网络盘数百毫秒；纯重复劳动 | **本轮已修**：移到 `onLayoutReady + 1500ms` 后台执行，加 `_isUnloaded` 守卫；模板自举加并发 in-flight 去重；新增 3 条顺序契约 + 1 条并发测试 |
| P2-2 | P2 | `engine/engine-registry.ts:1392-1403`、`main.ts:829-835` | 知识库 tag/base/batchImport 三个 init 串行；`recoverInterruptedBooks` 也在注册前 | 约 10 次串行 IPC；tag init 的 exists 抛错会冒泡导致整次启动不注册命令/视图 | 未修 → fix queue（Promise.all + 移出注册前 + try 包裹） |
| P2-3 | P2 | `ui/full-writer/project-selector-controller.ts:268/281-285`、`shared/mode-content.ts:370` | 初始渲染长篇固定 3 次全库遍历；短篇/剧本每个卡片各 1 次（`unitsCache` 只预填长篇） | 高频入口卡顿，短篇/剧本库更明显 | **已修（第50轮）**：`scanProjectChapters`/`listModeUnits` 接受 files 快照；按当前分类扫描长篇并预填短篇/剧本 unitsCache；新增 2 条测试 + 契约 |
| P2-4 | P2 | `ui/full-writer/flow-panel-controller.ts:50/147-164`、`ui/services/agent-port.ts:355-378` | `longChapters` 复用未覆盖流程面板/agent-port；流程面板 400ms 全量重扫 | 自动保存期间每 ~2.4s 两次全库遍历 | **已修（第51轮）**：agent-port 传已算章节；流程面板加 2s 章节缓存并传 longChapters，销毁时清空 |
| P2-5 | P2 | `engine/engine-registry.ts:1398-1402`、`main.ts:1580-1582/1049-1061` | 布局就绪后向量预热/统计 scan/会话修剪同 tick；预热回调无卸载守卫 | 首屏抖动；热重载新旧实例各读一遍 6.3MB | 未修 → fix queue（错峰 + barrier.isClosed + 模块级 latch） |
| P2-6 | P3 | `ui/writing-pet.ts:158/213`、`main.ts:1571-1573`、`ui/settings-tab.ts:109-111` | 宠物折叠仍重建 card；统计 modify 无防抖整章读；设置 refresh 清空全部 tab 缓存 | 自动保存期间周期性读盘/无谓 DOM | 未修 → fix queue |
| B2-1 | P2 | `scripts/check-bundle.mjs:30-43/92-101` | 仍只比总字节；`--update-baseline` 上调仅 warn 仍写入；无单模块/生成资产/worker 重复率/5MB 硬上限 | 任何 PR 可改基线绕过；当前距 5,000,000B 仅 53KB | 未修 → fix queue（metafile 组成预算 + 硬上限 + 大增量需显式 allow） |
| B2-2 | P2 | `.github/workflows/ci.yml:119/162-188`、`tests/e2e/perf-smoke.spec.ts:24/65` | 默认 CI 只 `playwright --list`；perf smoke 需 E2E_PERF=1 且 CI 从不设置 | 空闲 CPU/堆/首屏延迟无自动信号 | 未修 → fix queue（nightly perf job + 基线对比） |
| B2-3 | P2 | `ui/co-writing/chapter-match.ts:54-84` | 每本书×标签×技法×关键词重复 `new RegExp`，且标签未转义 | 100 本书≈2000 次编译；含 `(` 标签可抛错导致匹配卡整块失败 | 未修 → fix queue（正则缓存 + escape + countOccurrences） |
| B2-4 | P3 | `shared/support-qr.generated.ts`、`scripts/gen-support-qr.mjs`、`package.json:63` | `check:support-qr` 存在但未进 preflight/CI/release，生成物不在漂移清单 | 源图/生成物可漂移 | **本轮已修**：三处接线 + 漂移清单加入生成物；新增 2 条测试 |
| B2-5 | P3 | `ui/svg-charts.ts:951/1419-1437` | 词云碰撞 `placed.some`、时间轴逐层 `some` O(n²) | 大数据量打开图表页签卡顿 | 未修 → fix queue（网格分桶 / maxEndX 标量） |
| B2-6 | P2 | `engine/knowledge-vector-store.ts:343/722`、`engine/engine-registry.ts:1398-1403` | 预热仍逐文件同步 JSON.parse（单文件 0.74–0.80MB）且回调无卸载令牌 | 布局就绪后解析抖动；热重载重复读 | 未修 → fix queue（idle 分片 + 卸载令牌） |

## 二、已排除项（交叉确认）

- 依赖面仍干净：无 `dependencies`；metafile 757 输入、0 个 `node_modules`/`node:`；external 仅 `obsidian`；3 处 `child_process` 均为动态且有桌面守卫。
- PF-3/PF-4 未回退：workers 在体积棘轮内、`node --check` 在位、release.yml tag 路径跑体积/密钥/API 门禁。
- `check:docs` 覆盖 generated（`gen-docs --check` + release 漂移检查）。
- 新增模块均无启动成本：PromptManager 校验是纯函数、migration 稳态 1 次 exists、untrusted-content 纯函数、UnloadBarrier 仅字段级 Set。
- B-3 双 worker + 主线程质量同源已按拍板落地，不再重复报。
- 生成资产 190,831B（3.86%）；模板/changelog gzip 可省约 67KB，但需 DecompressionStream 兼容评估，暂不实施。

## 三、本轮修复与验证

- `main.ts`：模板自举/规则清理移入 `_runStartupMaintenance`，由 `_scheduleStartupMaintenance` 在布局就绪 + 1.5s 后执行；onload 主链只登记调度。
- `shared/template-scaffold.ts`：`ensureTemplateScaffold` 增加模块级 in-flight 去重，启动维护与建项目并发时只跑一次。
- `package.json` / `ci.yml` / `release.yml`：`check:support-qr` 接入 preflight/CI/release，漂移清单加入 `shared/support-qr.generated.ts`。
- 新增 `startup-maintenance-order` 3 条契约 + 模板并发 1 条 + support-qr 接线 2 条测试。
- `npx vitest run`（3 文件）：passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- 无（B-3 已拍板；资产压缩是否接受有损 QR/changelog 裁剪仍保留在 fix queue，需要单独确认）。

## 五、fix queue

1. B2-1 包体组成预算 + 5MB 硬上限（P2）
2. ~~P2-3 选择页初始渲染快照~~（第50轮）、~~P2-4 流程面板/agent-port longChapters~~（第51轮）
3. P2-2 知识库 init 并行化、P2-5 布局任务错峰 + 卸载令牌、B2-6 向量分片（P2）
4. B2-2 nightly perf、B2-3 正则缓存/转义（P2）
5. P2-6 常驻成本、B2-5 svg O(n²)（P3）

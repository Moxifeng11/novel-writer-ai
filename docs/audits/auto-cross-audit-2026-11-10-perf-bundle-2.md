# 自动交叉审计 — 依赖 / 包体 / 性能 / 首屏（⑤，二轮）

> 日期：2026-11-10 · 基线：`6c0f038` · 维度：⑤ 依赖/包体/性能/首屏（二轮）
> 方法：两个独立子代理复审——① 启动/首屏/常驻开销（对照首轮报告排除已修项）；② esbuild metafile 复现构建 + 依赖/门禁/渲染热点。本轮修复 1 个 P1（路径单源修复的升级迁移）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| P-1 | P1 | `main.ts:759-763`、`shared/plugin-data-migration.ts`（新增） | 路径单源修复（S-3）没有迁移旧数据：v4.78–4.81 期间 usage-ledger/writing-stats/knowledge-vectors 写在 `.obsidian/.obsidian/plugins/...`，升级后新路径为空 | 统计/用量历史丢失；向量检索突然为空且不会自动重建；首次扫描重读全部正文 | **本轮已修**：新增一次性迁移（整目录 rename 优先，失败逐文件复制、不覆盖目标、不删旧目录），4 条测试 |
| P-2 | P2 | `main.ts:816/828`、`shared/template-scaffold.ts:78-100`、`services/rules-service.ts:225-259` | 每次启动都 `await ensureTemplateScaffold`（56 次 exists）与 `_checkRulesVersion`（全库 getFiles + 串行删副本），都在命令/Ribbon/视图注册前 | 移动端/网络盘推迟入口可用；纯重复劳动 | 未修 → fix queue（完成标记 + layoutReady 延迟） |
| P-3 | P2 | `ui/full-writer/project-selector-controller.ts:507/527/531/567`、`creation-flow-state.ts:229` | 卡片点击 `renderRightPanel()` 不传快照：一次点击长篇约 7 次全库遍历（meta 1 + 详情 2 + 流程 2 + 快捷工具 2） | 大库/移动端切换卡片掉帧；首屏右栏串行等待 | 未修 → fix queue（复用 `unitsCache/metaOf/files`，`collectCreationFlowState` 接受 `longChapters`） |
| P-4 | P2 | `engine/engine-registry.ts:1399-1403`、`main.ts:1550-1552/1022-1031` | PF-1 的 layoutReady 预热与统计扫描、会话修剪同 tick 启动；回调未登记卸载令牌，热重载时新旧实例各读一遍 6.3MB 向量 | 首屏绘制竞争；卸载后仍执行；重复解析 | 未修 → fix queue（延后 2-3s + 卸载令牌 + 模块级 latch） |
| P-5 | P3 | `ui/full-writer/flow-panel-controller.ts:104-130`、`main.ts:1541-1545`、`ui/writing-pet.ts:135-168` | 流程面板 400ms 防抖重跑全量；统计 modify 无防抖整章读；宠物折叠时仍重建 card | 自动保存期间周期性读盘/无谓 DOM 重建 | 未修 → fix queue |
| P-6 | P3 | `ui/settings-tab.ts:208-225`、`ui/settings/knowledge-section.ts:46-73` | `refresh()` 清空全部 tab 缓存；快速切 tab 时异步分区继续写已脱离 DOM 的 panel | 改一个设置后重跑知识库/规则/模板读取 | 未修 → fix queue |
| B-1 | P2 | `scripts/check-bundle.mjs:30-37/92-101`、`.bundle-baseline.json` | 只比总字节；`--update-baseline` 上调仅 warn 仍写入；无单模块/生成资产/worker 重复率上限；note 136 行约 120 行是上调记录 | 大模块/死代码/worker 重复率上升可同一 PR 改基线通过 | 未修 → fix queue（新增 composition 门禁 + main 硬上限） |
| B-2 | P2 | `tests/e2e/perf-smoke.spec.ts:64-65`、`.github/workflows/ci.yml:162-188` | 性能 smoke 需 `E2E_PERF=1`，CI 从不设置；阈值（CPU 5%/堆 256MB）过宽 | 空闲 CPU/堆增长/首屏延迟无自动回归 | 未修 → fix queue（nightly perf job + 基线对比） |
| B-3 | P2 | `.github/workflows/release.yml:128-130`、`shared/plugin-worker-url.ts:33-50` | 社区三文件安装不含 workers，worker 模式实际只服务 zip/BRAT；两个 manager 仍预建全部拆解器 | 主渠道拆解/质检在 UI 线程执行；zip 多背 99.4% 重复的 791KB | 未修 → 记录取舍（文档化主线程模式或合并 worker） |
| B-4 | P3 | `shared/changelog-data.ts:22`、`shared/support-qr.generated.ts:10` | 生成资产 190.8KB（3.86%）：changelog 93 版本全内联、赞赏码 base64 52KB；`check:support-qr` 不在 preflight、release 漂移检查不含它 | 主包静态负担；源图/生成物漂移无门禁 | 未修 → fix queue（只留近 15 版 + WebP + 门禁接线） |
| B-5 | P3 | `engine/knowledge-vector-store.ts:339-344` | 预热仍逐文件同步 `JSON.parse`（单文件 0.74–0.80MB，桌面约 2.4–2.8ms，移动端 ×3–5） | 布局就绪后一次可感知解析抖动，随书量线性增长 | 未修 → fix queue（Worker/idle 分片） |
| B-6 | P3 | `ui/svg-charts.ts:938-957/1413-1435`、`ui/co-writing/chapter-match.ts:54-84` | 词云碰撞 `placed.some`、时间轴逐事件扫层级、协同匹配每本书重复编译正则 | 大数据量下 O(n²)/乘法级扫描，打开页签卡顿 | 未修 → fix queue（网格分桶 + 正则缓存） |

## 二、已排除项（交叉确认）

- **依赖面仍干净**：无 `dependencies`；metafile 753 个输入 0 个 `node_modules`；external 仅 `obsidian`；Node 内置仅 3 处动态 `import('node:child_process')` 且有桌面守卫。
- **新模块很小**：http-transport 1.7KB + project-name 1.4KB + reload-state 0.7KB，合计 0.078%，无启动成本。
- **PF-3/PF-4 未回退**：check-bundle 含两个 worker，check-release 跑 `node --check`，release.yml 在 tag 路径补了体积/密钥/API 门禁。
- **PF-1/PF-2/PF-5 未回退**：向量预热仍在 onLayoutReady；首开不再双重渲染；选择页初始渲染已用单次快照。
- **writing-stats persistVersion 无写放大**：仍只有一个 1.5s 定时器，version 只防「写盘期间清 dirty」。
- **大模块求值成本低**：webnovel-knowledge-base +4.4ms、changelog +0.85ms、模板资产 +0.66ms；首屏瓶颈不是静态对象求值。

## 三、本轮修复与验证

- 新增 `shared/plugin-data-migration.ts`：旧插件根 `data/` → 当前根；整目录 rename 优先，失败逐文件复制；目标已存在不覆盖；旧目录保留；异常不阻断启动。
- `main.ts` 在 `setPluginRootDir` 后计算旧公式路径并调用迁移，记录迁移数量。
- 新增 4 条测试：路径相同/旧目录缺失零动作、rename 优先、rename 不可用时合并且不覆盖、重复调用幂等。
- `npx vitest run`（迁移 4 条）：passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- B-3：worker 分发取舍——社区三文件安装下 worker 永远不可用。是接受「主渠道=主线程模式」并补性能 smoke，还是把两个 worker 合并/探索新的分发方式？本轮不改变分发形态。

## 五、fix queue

1. P-2 启动维护完成标记 + layoutReady 延迟（P2）
2. P-3 选择页卡片点击复用快照（P2，候选补丁约 12 行）
3. P-4 预热/扫描统一延后 + 卸载令牌（P2）
4. B-1 composition 门禁（P2）
5. B-2 perf job、P-5/P-6 常驻成本、B-4 生成资产、B-5/B-6 渲染热点

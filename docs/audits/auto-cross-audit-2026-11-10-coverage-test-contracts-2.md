# 自动交叉审计 — 覆盖率盲区与测试契约 ④（二轮）

> 日期：2026-11-10 · 基线：`8a8b3c9` · 维度：④ 覆盖率盲区与测试契约（二轮）
> 方法：两个独立视角并行取证（① coverage 产物逐文件盲区二轮 + 上轮修复核查；② 断言有效性/E2E 弱断言/集成链路缺口），交叉核对后合并。
> 本轮修复：**CV-3 单元结算补测（0/22 → 全覆盖）+ 新增结算→台账→摘要→关联索引集成链 + E2E 弱断言收口**。台账第 24 轮。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| CV-3 | P2 | `engine/mode-unit-settlement.ts`（0/22 statements、0/16 branches、0/21 lines） | 短篇/剧本单元结算完全零测试——这是「把单元标成 settled 并写结算报告」的唯一写盘路径，假 settled 无处可查 | 每次短篇/剧本单元结算 | 状态/报告回归无法被发现 | **本轮已修**：`tests/unit/engine/mode-unit-settlement.test.ts` 6 条（实体过滤/参数与聚合/frontmatter/短篇与剧本报告路径/单元文件缺失/partial 两种分支） |
| CV-5 | P2 | `tests/integration/` 全目录 grep `settlement|ledger|台账|摘要|关联索引` 零命中 | 「结算 → 台账 → 摘要 → 关联索引」无行为断言；各段单测互不相连，`writeChapterDigestFromProject` 全仓零引用 | 台账格式漂移/缓存未失效/摘要参数接错 | 串联层回归完全静默 | **本轮已修**：`tests/integration/settlement-ledger-chain.test.ts` 2 条（写入器→台账读回→摘要字段→索引渲染一致；文件变更后签名失效） |
| TC-3 | P2 | `tests/e2e/full-journey.spec.ts:119/123/136` | 三处 `if` 包裹：时间线看板为空/无表头/无人物卡时整段断言静默跳过（读失败也被吞成 `''`） | 结算产物缺失或路径漂移 | E2E 假绿 | **本轮已修**：改为无条件断言（看板必须存在、表头必须 ≥0、至少 1 行数据且含「外门考核」、人物卡必须存在）；结算表追加 `settlement_mode: full` + 时间线统计行断言 |
| CV-1 复核 | — | ledger-link | 上轮补测已生效：statements 98.76%、branches 83.01%、lines 100%（10 用例） | — | — | 已闭环（剩余 1 语句/9 分支不影响） |
| CV-9 | P3 | `engine/ledger/ledger-io.ts:98` | 承诺库解析失败时静默 `promises=[]` 且写入缓存（上轮 F-3⑤ 同源） | 承诺库损坏 | 承诺字段持续空 | 未修 → fix queue（log.warn + issues 通道） |
| CV-10 | P3 | `engine/ledger/ledger-index.ts` 辅助选择器 | `eventsForEntity`/`eventsForForeshadow`/`relationsFor`/`isEmptyLedger` 零覆盖 | — | 关联查询回归无护栏 | 未修 → fix queue（随关联查询批次补） |
| CV-11 | P3 | `services/prompt-manager.ts`（0.82%/0%） | 模板 CRUD/版本切换/AB 测试/导入导出/用量全部零覆盖 | — | 提示词配置回归无护栏 | 未修 → fix queue（纯内存依赖，node 直跑易） |
| CV-12 | P3 | `engine/chapter-state-snapshot-service.ts`（14.47%） | 章节状态快照写盘零直接测试 | — | 快照回归无护栏 | 未修 → fix queue |
| TC-4 | P3 | `tests/unit/architecture/system-consistency-gates.test.ts` | 7 条全为源码字符串断言（函数名出现在注释/死代码也能过），无法证明结算真正走写入器 | — | 防回退强度弱于行为断言 | 未修 → fix queue（改为行为断言或补充集成链覆盖，本轮集成链已部分替代） |
| TC-5 | P3 | `tests/e2e/README.md` | 未说明 globalSetup 新鲜度门禁（过旧产物直接失败） | — | 新贡献者困惑 | 未修 → fix queue（补一节说明） |

## 二、已排除项（交叉确认）

- `globalSetup` 不会被 `playwright test --list` 触发（runner 仅在非 list 分支加 globalSetup 任务），CI verify 的 `--list` 不受影响；`e2e-obsidian` job 先 build 再 test:e2e，门禁不会误报。
- 上轮各修复测试均在跑：settlement-engine-behavior（D-6）、settlement-table-writer（F-7，100%）、ledger-io-promises（F-3）、ledger-open-promises（F-3b）覆盖率非零且主题吻合。
- `mode-unit-settlement` 需要 mock 的只有 App/vault 索引与 settleLight：无需网络/模型/Obsidian 运行时，vitest node 环境直跑。
- 结算表形状已基本覆盖（settlement-artifacts 单测断言 tags/卷/章/settlement_mode/8 条统计行/partial）；本轮只补 E2E 侧 `settlement_mode: full` 与时间线统计行。
- 时间线列宽单元级断言：ledger-core 已覆盖 4/7 列保持与幂等；本轮 E2E 追加「至少 1 行数据 + 含事件名」。

## 三、本轮实跑结果

- `tests/unit/engine/mode-unit-settlement.test.ts`：6 passed（0/22 → 全覆盖路径）。
- `tests/integration/settlement-ledger-chain.test.ts`：2 passed（首次为串联链建立行为断言）。
- `npx playwright test --list`：56 tests / 11 files 可解析（新增无条件断言不影响 list）。
- `tsc --noEmit` = 0。

## 四、待用户拍板项

- 无（本轮为补测/断言加固，不涉及产品语义或发版）。
- 沿用：O-1 移动端 requestUrl 兜底、O-3 热重载承诺修法、SEC-11 .bak 明文副本文案。

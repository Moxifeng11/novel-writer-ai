# 自动交叉审计 — 覆盖率盲区与测试契约（④）

> 日期：2026-11-10 · 基线：`97db7eb` · 维度：④ 覆盖率盲区与测试契约
> 方法：两个独立子代理并行取证——① 解析 coverage HTML（794 文件行）定位写盘盲区；② 全仓弱断言/字符串契约/E2E 跳过与最近修复的反向验证。本轮修复 1 个 P1 覆盖缺口 + 1 个 P2 真实缺陷 + 2 个测试契约缺口。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| C-1 | P1 | `engine/chapter-state-snapshot-service.ts:139-180` | 写盘路径零验证：S 14.47% / B 9.09%，`fs.write` 0 命中，6 个 helper 全零；4 个生产入口（结算/批量/一键成文/步骤）共用 | 快照内容/目录创建/异常吞噬全无回归；下一章 prompt 可能读到空/错状态且 catch 静默 | **本轮已修**：新增 2 条行为测试（真实落盘 + 人物/承诺内容；非法章号零副作用） |
| C-2 | P1 | `services/chapter-version-service.ts:428-498` | `partialRollback` 整函数零覆盖；L491 写正文未走 `withWriteLock`；行映射错误无测试 | 部分回滚可能写错行；与自动保存/流水线并发互相覆盖 | 未修 → **下一代码批次首项**（补行为测试 + 锁内写） |
| C-3 | P2 | `services/prompt-manager.ts` | 整类零执行（S 0.82%/F 0%）；`importConfig` 直接 `{...DEFAULT, ...JSON.parse}` 无校验后异步落盘 | 模板/版本/AB 配置可能被任意形状污染并写盘 | 未修 → fix queue |
| C-4 | P2 | `shared/plugin-cache.ts` | 整类零实例化（S 2.38%）；`save()` 直接 `adapter.write`，无 tmp/rename | `cache.json` 半写/损坏会丢 settingsBackup 与实体元数据 | 未修 → fix queue |
| C-5 | P2 | `services/writing-stats-service.ts:305-326` | `persistNow` 先 `dirty=false` 再写；失败 catch 不恢复 dirty、不重试 | 一次写失败（磁盘满/同步冲突）本次统计永久丢失，dispose 也不重试 | **本轮已修**：写成功后才按版本清 dirty；失败恢复 dirty；新增失败→重试行为测试 |
| C-6 | P3 | `engine/ledger/ledger-index.ts:102-173` | `eventsForEntity/eventsForForeshadow/relationsFor/isEmptyLedger` 零覆盖且全仓无调用方（死代码） | 上下文装配若改用它们无护栏；死代码增加维护成本 | 未修 → fix queue（删除或接入并补契约） |
| T-1 | P1 | `tests/unit/engine/commercial-deconstructor.test.ts:155-157/186-188/403-405` | 样本 `写作知识库/紫川/紫川.txt` 不在仓库，找不到就 `console.warn + return` | 三条 golden-three-chapters 回归在 CI 恒为 0 断言通过（伪装 pass） | 未修 → fix queue（缺样本显式 skip 或硬失败） |
| T-2 | P1 | `tests/unit/engine/deconstructor-full-coverage.test.ts:96-107` 等 | “全文覆盖”用例只断言字段存在；`secondHalfUnique` 取了从不参与断言 | 把 analyze 改成只吃前 N 字仍全绿——正是该用例要防的回归 | 未修 → fix queue（前后半对照实验） |
| T-3 | P2 | `tests/unit/architecture/system-consistency-gates.test.ts`、`official-review-rules.test.ts`、`domain-isolation.test.ts` | 源码子串契约对注释/死 import 免疫；扫描目录缺失时返回空数组仍通过；无文件数下限 | 门禁可被重命名目录/注释调用绕过（TC-4 残留） | 未修 → fix queue（剥注释 + 文件数下限 + 负向夹具） |
| T-4 | P2 | `tests/unit/engine/settlement-engine-behavior.test.ts` D-3 用例 | 只有 RELATION/PROMISE，无 ARC；弧线步骤在空表上 no-op | 去掉 `hasPartialFailure` 守卫后弧线脏写仍测不出 | **本轮已修**：新增 ARC 负向用例（回滚后不生成角色弧线表） |
| T-5 | P2 | `tests/e2e/obsidian-plugin.spec.ts:2205/2225` | `if (hasProject)` 包住整段自定义下拉测量，项目缺失时静默跳过 | 完整写作工作台下拉裁切回归消失 | 未修 → fix queue |
| T-6 | P3 | `tests/unit/shared/plugin-worker-url.test.ts:35-43` | 两个 `it` 无任何断言 | Worker URL 回退/失败契约完全未验证 | **本轮已修**：补 `getBasePath` 精确 URL 与无法解析返回 null |

## 二、已排除项（交叉确认）

- 覆盖率汇总可解析：全仓 Statements 45.53% / Branches 45.11% / Functions 46.43% / Lines 45.89%；有语句但行覆盖为 0 的文件 78 个（69 个在 `ui/`），属“整层 UI 入口未测”，非单一引擎函数问题。
- 结算/回滚/并发/幂等主链已大量使用内存 FS 做真实行为断言（write-lock、settlement-journal、settlement-ledger-chain、mode-unit-settlement 等），基线明显高于一般项目。
- 最近六项修复（S-1/S-3/S-8/D-2/D-3/L-3）均已有能反向复现修复前失败的回归测试；S-3 的 `.bak` 路径测试从字面量改为单源后更不易漂移。
- E2E README 已说明 `OBSIDIAN_PATH` 缺失会 skip、需先 build、失败留 trace/video；`full-journey` 已在上轮改为无条件断言。
- `official-review-rules.test.ts`、`worker-syntax-gate`、`secrets-policy`、`obsidian-api-policy` 采用“故意违规夹具 + 断言退出码”的模式，是架构门禁的正面样板。

## 三、本轮修复与验证

- C-1：`tests/unit/engine/chapter-state-snapshot-service.test.ts` 2 条（落盘内容/目录创建、非法章号不调用 write）。
- C-5：`persistNow` 改为“写成功后按 persistVersion 清 dirty；失败恢复 dirty”；测试模拟写失败后第二次 dispose 仍能落盘。
- T-4：D-3 增加 ARC 负向用例，证明回滚后弧线表不生成。
- T-6：plugin-worker-url 两条空用例补精确断言。
- `npx vitest run`（4 文件）：35 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- 无（本轮为覆盖/契约补强，不改变产品语义）。

## 五、fix queue

1. C-2 `partialRollback` 零覆盖 + 无锁写（P1，下一代码批次）
2. T-1 外部样本缺失伪装 pass（P1）
3. T-2 全文覆盖用例弱断言（P1）
4. C-3 PromptManager 整类零覆盖 + importConfig 校验
5. C-4 PluginCacheManager 原子写
6. T-3 架构字符串门禁收口、T-5 E2E 条件跳过
7. C-6 ledger 死代码清理

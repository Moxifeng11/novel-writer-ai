# 自动交叉审计 · 维度② 数据一致性（复核 + 增量）

- 日期：2026-11-09
- 触发：无 Trae 消息（分支 B2）；上一轮为 O-5 代码批次，本轮复核维度②（前次报告 `auto-cross-audit-2026-11-09-data-consistency.md` 的 fix queue）
- 审计方式：**两个独立只读视角交叉取证**——A 视角结算引擎写锁/回滚/journal 复核（70 次工具调用）；B 视角迁移/账本/会话/统计/知识库索引复核（73 次工具调用）。ZCode 对 P1 逐条复核并修复 C-5。
- 结论：**P1 2 项（本轮修 1 项）**、P2 12 项、P3 4 项；已排除 8 类。**无 P0。**
- **交叉核对**：前次报告 C-4 已由 `fea973b` 修复（两方复核一致：四处 create 均锁内判存在并条件登记）；C-5 两方均确认未修，本轮修复；C-6 两方均确认调用方零消费 `result.rollback`。

## 一、已修（本轮，P1，带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 修法 |
|---|---|---|---|---|---|
| D-1（原 C-5） | `engine/settlement-engine.ts:547-570/287-310` | `settle` / `settleLight` 无 run 级串行化；journal 保存「运行前值」，任一 run 回滚会写回旧快照 | 同项目两次结算（弹窗+批量+StepRunner 任意组合）或 settle 与 settleLight 并发，任一方部分失败 | 回滚覆盖另一方已提交的伏笔/时间线/关系/账本/弧线；字段回退；`createdFiles` 可能删对方文件 | 新增项目级 `withWriteLock('settlement:'+project)` 包住 `settleUnlocked` / `settleLightUnlocked`；与文件锁 key 不同，不触发不可重入。新增并发单测：第一个 run 卡在写步骤时，第二个 run 不得进入写步骤 |

测试：`tests/unit/engine/settlement-engine-behavior.test.ts` +1（`同项目并发 settle 串行化`），9/9 通过。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| D-2（原 C-6） | **P1** | `settlement-engine.ts:1452/1486-1492`；`settlement-artifacts.ts:61-63`；`ui/chapter-settlement-modal.ts:187-230/336-363`；`engine/step-settlement.ts:169-193`；`ui/write-chapter-modal.ts:639-659`；`batch-pipeline-runner.ts:457-489`；`step-runner.ts:1684-1715` | 回滚后所有入口仍按成功处理：结算表 `completed`、正文标 `settled/written`、`stepCompleted` 置位、批量续跑跳过，`result.rollback` 全仓零消费 | 产物入参增加 `rollback/settlementPartial`；存在 rollback 时返回 warning 且不写结算表/快照/总览；四个调用方走错误提示、不标完成；`SettlementSummary` 补 rollback 字段（约 25 行 + 契约测试） |
| D-3（F3） | P2 | `settlement-engine.ts:598-601/1500-1526/198-254`；`settlement-journal.ts:160-163` | 回滚后仍继续写 V2 关系/承诺账本/弧线表，且 journal 已清空，无法再回滚 | `finalizeRollback` 后若 `hasPartialFailure` 直接返回；或把 599-601 移到汇总前（3 行） |
| D-4（原 C-7） | P2 | `settlement-engine.ts:1197-1215`；`settlement-journal.ts:178-186` | 时间线 append marker 在 `rowExists` 判重前登记；重复事件 + 失败回滚会删掉上一次合法行 | `recordAppend`/`createdFiles.push` 移到判重之后、写盘之前（3 行） |
| D-5（原 C-8） | P2 | `settlement-engine.ts:658/660/1443-1448`；`settlement-journal.ts:24/56` | 字段快照 `String()` 化，数组/数字回滚后变字符串，链接字段丢数组语义 | journal `before: unknown`；`recordField/restoreField` 原样保存/赋值，undefined 删除键（约 10 行） |
| D-6（原 C-9） | P2 | `settlement-engine.ts:1280-1295` | 情绪 frontmatter 写入不进 journal，回滚后保留失败运行值 | 写前 `snapshotField` 当前情绪/时间/原因（4 行） |
| D-7（F7） | P2 | `settlement-engine.ts:653-666/1424-1455/1511` | `snapshotField` 失败只告警，不置 `snapshotIncomplete`；该标志又只在 journal 非空时采纳；`restoreSnapshots` 死代码 | catch 置 `snapshotIncomplete`；把 1455 提升到 journal 分支外；删除/接通 restoreSnapshots（6 行） |
| D-8（F8） | P3 | `settlement-engine.ts:590/1830-1831` | 信息债看板整板覆盖无锁、无 journal，且在回滚前刷新 | 写盘包 `withWriteLock`；回滚后重刷或仅失败时跳过（3 行） |
| D-9（原 C-10） | P2 | `analysis-session-manager.ts:370-413/628-658`；`step-runner.ts:1500-1521` | `_index.json` 整份读改写无锁；先单文件后索引；解析失败清空索引；每次分析新建 manager 实例 | 模块级串行写 + tmp/rename；坏索引留档并从会话文件重建；manager 复用（30-40 行） |
| D-10（原 C-11） | P2 | `ui/services/agent-session-store.ts:129-209` | flush 时取当前项目（节流窗口切项目串档）；clear 不等在途写；>512KB 整文件重写 | save 时冻结 path/snapshot；generation + clear await writing（15 行） |
| D-11（原 C-12） | P2 | `services/usage-ledger.ts:284-321/362-374`；`main.ts:2058-2064` | `loaded=true` 在读盘前；flush 无串行；卸载未 flush | loaded 移到读成功后；flush promise 链；onunload 加 flush（10-15 行） |
| D-12（原 C-13） | P2 | `writing-stats-service.ts:129-193`；`shared/writing-stats.ts:347-388`；`main.ts:1526-1533` | scan 与事件并发旧值覆盖；改名无 rename 处理，prune 后按整本重计 | recordFileWords 比较 mtime；注册 rename 迁移快照（10-15 行） |
| D-13（原 C-14） | P2 | `services/knowledge-base-manager.ts:392-425/493-500/519-540/646-698/902-948` | addBook 落盘辅助吞错；索引与书籍两条队列；delete 先删目录；rename 先改目录 | 辅助抛错 + 内存回滚；目录删除入 bookWriter；loadIndex 校验目录（30-40 行） |
| D-14（原 C-15） | P2 | `services/project-rename-service.ts:107-119`；stats/agent-session/usage | 项目改名只迁偏好/指纹两个文件，统计桶/会话/用量仍旧名 | 增加统计键与文件路径、Agent 会话文件迁移（约 30 行） |
| D-15（原 C-16） | P2 | `settlement-journal.ts:134-165`；`batch-pipeline-runner.ts:457-489`；`step-settlement.ts:167-200` | 回滚失败条目仍被清空，无法重试；批量只判 mode=empty | 仅 `failed===0` 清空；batch/step 消费 rollback 标记失败（10-20 行） |
| D-16（F8 迁移） | P3 | `engine-registry.ts:1187-1198`；`settings-migrator.ts:124-145` | `data.json.bak` 单槽；备份失败仍迁移；v3→v4 原地改嵌套对象 | 备份版本化/成功后覆盖；迁移前 structuredClone；备份失败中止（10 行） |

## 三、已修复/已排除

| 项 | 证据 |
|---|---|
| C-1/C-2/C-3 | 前次已修；本轮复核三态快照、删除 journal、created* 清零均在（`settlement-engine.ts:624-651/1653-1730/1467-1482`） |
| C-4 | 已由 `fea973b` 修复：四处 create 存在性+写入同锁、只对真正新建登记（`:941-1136`）；残留 P3「缓存判存在」 |
| 锁实现/结算单文件写入 | `shared/write-lock.ts` finally 释放；各写点锁内重读+幂等；无回滚的并发单独运行安全 |
| settleLight best-effort | 失败经 `lightFailures/lightPartial` 可见（modal 270-278、unit 47-99），为既定语义 |
| BodyWriter 与结算正文 frontmatter | 同路径锁；BodyWriter 锁内重读旧 frontmatter，正常保存无丢更新 |
| settings 失败不盖章 | 迁移未完成不 backup/save；保存写 `migrationIncomplete.toVersion`，下次重试 |
| v4.80.0..HEAD 新增代码 | 6 个提交仅 docs/tests/styles/worker/template/quality-gate，无持久化写入变更 |
| 知识库索引损坏自愈 | 已有「备份坏文件 + 从书籍目录重建」测试，C-14 只余吞错/跨队列顺序 |
| 分析/Agent/账本/统计无锁 | 全文件 grep 确认无 `withWriteLock`/`SerializedWriter` 误判 |

## 四、待用户拍板

- 无。D-2 的修法会改变「结算失败但报告成功」的 UI 文案与批量续跑行为，属缺陷修复，不需要产品取舍。

## 五、下一步

1. **D-2（C-6）** 优先：回滚可见性 + 调用方不标完成，需 4 处入口契约测试。
2. D-3/D-4/D-5/D-6/D-7 可合并为「结算回滚快照收口」小批次（合计约 25 行）。
3. D-9..D-15 按模块分批：会话 → 账本 → 统计 → 知识库 → 项目改名。
4. 下一审计维度：**③ 安全**（前次已审，可做增量复核）或 **④ 覆盖率**；按 HANDOFF 轮换。

# 自动交叉审计 — 数据一致性 ②（D-3 复核 + ledger 新路径）

> 日期：2026-11-10 · 基线：`fa737b2` · 维度：② 数据一致性（写锁/回滚/账本/迁移）
> 方法：两个独立视角并行取证（① 定向复核 2026-11-09 followup 的 D-3/D-4/D-6 现状；② 盲审新 `engine/ledger` 写入路径 + journal 语义），交叉核对后合并。
> 本轮修复：**D-3（P1）已修**，提交见 `docs/progress/auto-iterations.md` 第 12 轮。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 / 修法 |
|---|---|---|---|---|---|---|
| D-3 | **P1** | `engine/settlement-engine.ts` settleUnlocked（回滚后 3 步） | `finalizeRollback` 之后无条件执行 `updateV2Relations / updatePromiseLedger / updateCharacterArcs`；journal 回滚结束即清空（settlement-journal.ts:160-163），这三步新登记的快照永远不会被回滚 | 结算部分失败触发回滚 | 已回滚的章节又被部分改写关系/承诺/弧线，且不可回滚——「回滚成功」掩盖脏写 | **本轮已修**：`ctx.hasPartialFailure` 时跳过三步（幂等，重跑结算补齐）；回归测试见 settlement-engine-behavior「回滚后不写 V2/承诺」 |
| D-4 | P2→**已修复** | `settleStep_createTimelines` | 旧：`journal.recordAppend(newRow)` 先于判重，失败回滚删合法行 | — | — | **44612b8 副作用修复**：现为「锁内读 → appendEventToContent 判重 → changed 才 recordWholeFile → 写」（1225-1246）；本轮两视角一致确认 |
| D-6 | P2 | `settleStep_updateEmotions`（1296-1312） | `当前情绪/entity_status/entity_last_changed_*` 经 processFrontmatter 写入，**无 snapshotField/journal** | 情绪写入成功、其它步骤失败触发回滚 | 情绪字段残留（失败运行的值不恢复） | 未修 → fix queue；修法：写前对 4 字段 `snapshotField`（对齐 body frontmatter 1370-1380） |
| F-1 | P2 | settlement-engine.ts:906/1206/1241 + settlement-journal.ts:141 | 伏笔库/时间线 whole-file-before 回滚是「盲恢复」：`settlement:${project}` 项目锁不覆盖第三方写入方（用户手改、analysis apply 无项目锁） | 结算 run 期间第三方追加了合法行，且 run 以部分失败结束 | 回滚抹掉第三方合法行 | 未修 → fix queue；修法：create 两步增记 per-row append-marker（LedgerWriteResult 加 `row`），whole-file 保留给 move/delete |
| F-2 | **P1** | analysis-report-engine.ts:1279-1347/1349-1400/1240-1266 | 分析报告「应用变更」三段无 journal、无 `settlement:${project}` 项目锁 | 批量结算运行中用户点「应用变更」；或 apply 自身中断 | lost update（结算回滚清掉 apply 刚写的行）；apply 无回滚能力 | 未修 → **fix queue 下一候选**；修法（<50 行）：applyReportChanges 包项目锁 + 两个 apply 写前 `recordWholeFile`、catch 回滚 |
| F-3 | P2 | settlement-engine.ts:1228 vs analysis-report-engine.ts:1371 | 时间线幂等键含 time：结算把 `nt.desc`（描述）当 time，分析报告用 `event.time` | 同一事件先步骤结算、又经分析报告 apply | ledger-write 判重失效，时间线重复行 | 未修 → fix queue；修法：dedupe 降级为 (era, chapterKey, name) 二元组或统一 time 语义（~3 行） |
| F-4 | P3 | ledger-write.ts:214-223 | appendEventToContent 递归分支死代码（`rebuilt` 与原内容相同） | 不可触发 | 误导维护者 | 未修 → 顺手清理批次 |
| F-5 | P3 | ledger-write.ts:327-389 | moveForeshadowToRevealed 不查「已回收表」同名行 | 数据已漂移（两表同名） | 已回收表重复行 | 未修 → fix queue（~6 行查重） |
| F-6 | P3 | analysis-report-engine.ts:1364 | 硬编码 `project + '/02-时间线与伏笔'`，未走 `pjTimelineDir` | 路径常量调整 | 目录漂移 | 未修 → 顺手清理批次（1 行） |
| F-7 | P3 | settlement-table-writer.ts:61-67 | chapNum 解析失败钳到 1，legacy 分支可产出「第5章/第1章_结算表.md」错位 | chapName 无「第N章」且 chapDir 为 legacy | 结算表落错文件名 | 未修 → fix queue（从 chapDir 回填，~4 行） |

## 二、已排除项（两视角交叉确认无问题）

- journal「登记→写盘」间距内不存在「放弃写但已登记」路径（updateForeshadows/createForeshadows/createTimelines/updateGrowth 均先判重后登记）；`finalizeRollback` 中 journal 回滚（1467）先于 createdFiles 删除（1475-1481），「同 run 先 update 后 create」的整 run 还原验算正确。
- createdFiles 登记条件仍为「锁内确认不存在才登记」；`recordWholeFileBefore` 读失败只置 snapshotIncomplete，绝不登记 createdFiles（v4.79.0 修复在位）。
- 所有 ledger 写入均在文件锁内；`writeSettlementTableFile` 三个调用方同文件锁、路径一致。
- `removeMarkerOnce` 整行精确匹配优先，不会误删同前缀合法行；deleteEntity 人物删除可由 journal 重建。
- 承诺账本/弧线表锁内重读合并（P1-3 遗留修复在位）。

## 三、待用户拍板项

无（本轮全部为一致性修复，不涉及产品语义/发版）。

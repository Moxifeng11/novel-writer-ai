# 自动交叉审计 — 数据一致性二轮（D-3/F-3 复核 + fix queue 残余）

> 日期：2026-11-10 · 基线：`9aa6a4e` · 维度：② 数据一致性二轮
> 方法：两个独立视角并行取证（① D-3/F-3 修复效果逐项闭环复核；② fix queue 残余项精读与新问题扫描），交叉核对后合并。
> 本轮修复：**F-7/D-6/openPromises 三项已修**；回归 7 条已实跑。台账第 20 轮。

## 一、D-3/F-3 修复效果复核

| 项 | 判定 | 残余 |
|---|---|---|
| D-3 守卫条件 | 闭环 | 覆盖「journal 已回滚」与「journal 为空的部分失败」两类；轻结算路径 N/A（不写 V2/承诺/弧线） |
| D-3 result 可观测性 | **有残余** | 「hasPartialFailure 且 journal 为空」时 result 无任何标记，调用方看不到承诺/弧线被跳过；修法 ≈12 行（`skippedPostSteps` 字段 + NOTICE）→ fix queue |
| D-3 自引用误判 | 闭环 | 守卫一次性判断先于三个调用；V2 写失败置位发生在守卫之后 |
| D-3 对 settleLight | N/A | 轻结算不写 V2/承诺/弧线 |
| F-3 签名/解析/失效/摘要 | ①②③④闭环 | cachedRead 经 vault.modify 路径核实安全；仅外部工具改文件时可能短暂陈旧（平台固有限制） |
| F-3 ⑤ parse 失败静默 | **有残余** | parsePromiseLedger 抛错被吞成空 promises 且以当前签名写缓存——持续静默空；修法 ≈8 行（log.warn + 进 ledger.issues 或跳过 cache.set）→ fix queue |
| 新问题 a（缓存重建竞态） | 存在但自限 | 读快照竞态，非持久脏读；可选代数计数器加固 ≈12 行 → fix queue |
| **新问题 b（openPromises 剔除逾期）** | **已修（本轮）** | 旧实现按 `expected >= chapter` 过滤把逾期承诺剔除——F-3 激活后 digest/resolver 真实受影响；改为仅按状态过滤 + 逾期/预期章升序排序 |

## 二、本轮修复（三项，均 ≤50 行）

| # | 级别 | 位置 | 问题 | 修法 | 回归 |
|---|---|---|---|---|---|
| F-7 | **P1** | settlement-table-writer.ts:59-67 | 章号解析失败（序章/楔子/番外 → 0）钳到 1：legacy 分支产出「第7章/第1章_结算表.md」错位；非 legacy 路径**直接覆盖第1章的结算表**（数据丢失） | 标准 chapDir 的目录章号优先；无 chapDir 时维持钳 1（无更可信来源，记 follow-up） | `settlement-table-writer.test.ts` +2 条 |
| D-6 | **P1** | settlement-engine.ts:1308-1324 | 情绪四字段（当前情绪/entity_status/entity_last_changed_at/reason）经 processFrontmatter 写入但**不进 journal**——部分失败回滚后人物卡停在半失败态 | 与正文步骤同模式：`withWriteLock` 内 4 次 `snapshotField` 后再写（快照读与写同锁） | `settlement-engine-behavior.test.ts` 新用例：情绪写入失败 → 回滚后人物卡无「惊疑」残留 |
| F-3b | P2 | ledger-index.ts:143-151 | `openPromises` 按 `expected >= chapter` 过滤剔除逾期承诺——F-3 使数据真正流动后，digest/resolver 在最该提醒的时刻丢掉最逾期的条目 | 仅按状态过滤；open/advanced 保留，按预期章升序排序（无预期置后） | `ledger-open-promises.test.ts` 3 条新文件 |

## 三、fix queue 更新（本轮后剩余，按优先级）

| 序 | 项 | P 级 | 说明 |
|---|---|---|---|
| 1 | item6-a：`entity_last_changed_at` 语义分裂（ISO vs 章名） | P2 | 域校验批量告警根因；3 个写点各 1-2 行，需先确认无按章名解析的读方 |
| 2 | 新问题 a：ledger-io 缓存重建竞态 | P2（自限） | 代数计数器加固 ≈12 行 |
| 3 | F-3 ⑤：parse 失败静默空 promises | P2 | ≈8 行（log.warn + issues 通道） |
| 4 | D-3 ②：skippedPostSteps 可观测性 | P2 | ≈12 行 |
| 5 | F-5：moveForeshadow 已回收同名去重 | P2 | 4 行，ledger-core 加 2 用例 |
| 6 | F-1：LedgerWriteResult.row per-row append-marker | P2 | ≈15-20 行，回滚精度改进 |
| 7 | item5：entity-state-manager 回退 getFiles 改 listEntityFiles | P3 | 2 处各 1 行 |
| 8 | item6-b：analysis-report createdFile 锁外判定 | P2 | 写失败路径误删并发者新建文件；锁内返回 created 标志 |
| 9 | P3 杂项：restoreSnapshots 死代码、recordBehaviors 不置 partial 口径注释 | P3 | 顺手批次 |

## 四、已排除项（交叉确认）

- D-3 守卫自引用误判：无影响（守卫一次性判断先于调用）。
- D-3 对 settleLight：N/A（轻结算不写三步，失败走 lightFailures 聚合）。
- F-3 cachedRead 陈旧：vault.modify 路径同步更新内存缓存与 stat，同插件写后签名同步变新；仅外部工具改文件短暂陈旧，自愈。
- settleLight forceReveal 改伏笔库后未 invalidate：mtime+size 签名下次 load 自然重建，无陈旧风险。
- openPromises 中文备选词死分支：无害（parsePromiseLedger 已归一化 status）。

## 五、本轮实跑结果

- 定向 22 passed（settlement-engine-behavior 12 含新 D-6 用例、settlement-table-writer 7 含新 F-7 用例、ledger-open-promises 3）。
- `tsc --noEmit` = 0。

## 六、待用户拍板项

- O-1 移动端 requestUrl 兜底（需真机手测）与 O-3 热重载承诺修法（sessionStorage TTL vs data.json），沿用上轮待拍板项，本轮未动。

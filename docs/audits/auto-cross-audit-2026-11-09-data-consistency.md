# 自动交叉审计 · 维度② 数据一致性（写锁 / 回滚 / 账本 / 迁移）

- 日期：2026-11-09
- 触发：HANDOFF `nextAudit=data-consistency`（无 Trae 消息，分支 B2）
- 审计方式：**两个独立只读视角交叉取证**——A 视角全仓静态扫描（锁调用点 55 处、写入口分组，139 次工具调用）；B 视角精读结算引擎 / 会话存储 / 知识库 / 账本 / 迁移（92 次工具调用）。ZCode 对全部 P1 逐条复核并修复其中 2 项。
- 结论：**P1 5 项（本轮修 2 项）**、P2 11 项、P3 若干；已排除 10 类「疑似问题」。

## 一、已修（本轮，P1，均带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 复核 |
|---|---|---|---|---|---|
| C-1 | `engine/settlement-engine.ts:611`（`recordWholeFileBefore`） | `exists=true` 但 `read` 抛错时落入 catch，随后仍 `createdFiles.push(path)` → 回滚按「新建文件」删除 | 结算期间读盘瞬时报错（IO 抖动/占用），且本次结算另有步骤失败 | **永久删除用户已有文件**，无备份 | 复核成立（旧代码 619-623）；修法：三态判定（不存在→created；存在→记录；读失败→`snapshotIncomplete` 且绝不入 created），调用方已读内容时传 `knownBefore` 避免二次读 |
| C-2 | `engine/settlement-engine.ts:1346/1591`（`settleStep_deleteEntities` / `deleteEntity`） | `DELETE_ENTITY` 的删除完全没有 journal 快照 | 报告含 `DELETE_*` 且本次结算后续/前序有失败 → 回滚 | 回滚报告「已恢复」，但被删文件永久消失 | 复核成立；修法：删除前锁内读内容并 `journal.recordWholeFile`（人物/地点/势力/物品），伏笔库/时间线看板在锁内 splice 前同样记录 |
| C-3 | `engine/settlement-engine.ts:1408` | 回滚只清零 `updated*`，不清 `created*` | 部分失败回滚 | 结算表/成功提示仍报「新建 N 项」，把已删除的新建算成成功 | 复核成立；修法：回滚分支一并清零 `created` 与 6 个 `created*`（P2，同函数顺手修） |

测试：`tests/unit/engine/settlement-engine-behavior.test.ts` +3
- `DELETE_ENTITY` + 部分失败 → 人物文件被恢复；
- `exists=true`/读失败 → 不进 `createdFiles`、`snapshotIncomplete=true`；
- 回滚后 `created/createdChars === 0`（旧实现必失败）。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| C-4 | P1 | `engine/settlement-engine.ts:896-1090`（四个 `settleStep_create*`） | 存在性检查在锁外、写盘无锁、无条件 `createdFiles.push`；并发结算会双写同一路径，任一方回滚删除另一方合法新建 | 参照已修好的 `createForeshadows`：锁内重查存在性再写，只有真正新建才登记（约 25-30 行） |
| C-5 | P1 | `engine/settlement-engine.ts:534-602` | `settle()` 无 run 级串行化，journal 是「本次运行前值」；并发 run 的回滚会覆盖对方已提交写入 | `Map<project, Promise>` 或 `withWriteLock('settlement:'+project)` 包住入口（约 15-20 行） |
| C-6 | P1 | `engine/settlement-engine.ts:1398` + `ui/chapter-settlement-modal.ts:211-234` / `engine/step-settlement.ts:180-194` | 调用方不读 `result.rollback`：整次回滚后仍写「结算状态: completed」、把正文标 `settled`、提示成功，批量流水线据此跳过该章 | `settlement-coordinator` 在 `result.rollback` 存在时返回 warnings/不写产物；modal/step 改错误提示（约 20 行 + 契约测试） |
| C-7 | P2 | `engine/settlement-engine.ts:1144` | 时间线 append marker 在幂等判重**之前**登记；重复结算 + 部分失败时回滚会删掉上一次合法写入的旧行 | 把 `recordAppend` 移到 `rowExists` 判定通过之后（3 行） |
| C-8 | P2 | `engine/settlement-engine.ts:631` + `settlement-journal.ts:1390` | 字段快照 `String()` 化：数组/数字回滚后变字符串（`涉及人物` 变 `"甲,乙"`） | 快照保存原始值、`restoreField` 接 `unknown`（约 10 行） |
| C-9 | P2 | `engine/settlement-engine.ts:1233` | 情绪更新写 frontmatter 不进 journal | 写前 `snapshotField` / `recordField` |
| C-10 | P2 | `engine/analysis-session-manager.ts:76/370/628/656` | `_index.json` 整份读改写无锁；`saveSession` 先写单文件后写索引；解析失败把索引重置为空 | 模块级 SerializedWriter + 索引 tmp/rename；解析失败不覆盖（约 20 行） |
| C-11 | P2 | `ui/services/agent-session-store.ts:134-157/197-209` | `pathOf()` 在 flush 时取当前项目（1s 节流内切项目 → 串项目）；`clear()` 不等在途写（旧会话复活）；>512KB 整文件重写 | 快照时固定路径；`clear` 等待/取消在途写（约 15 行） |
| C-12 | P2 | `services/usage-ledger.ts:285-287/308-321` | `loaded=true` 置于读盘前：一次读失败后续用少量新记录覆盖历史账本；flush 无串行、不 await，卸载未纳入 flush 列表 | `loaded` 移到 try 后；flush 串行化；登记卸载 flush（约 10 行） |
| C-13 | P2 | `services/writing-stats-service.ts:129-167/174-193` | scan 与 vault 事件并发时用旧 count 覆盖新快照 → 下一轮重复计入；`pruneMissingFiles` 对改名/漏项先删后按首次整本计入 | 记录前比较 mtime 新于快照则跳过；改名走 rename 复用（约 10 行） |
| C-14 | P2 | `services/knowledge-base-manager.ts:492-499/658-695` | `addBook` 三个落盘辅助全吞错；索引可能领先于数据；`deleteBook` 先删目录后写索引；改名后索引/基本信息失败 → 重启后按名读取全失效 | 辅助函数改为抛错并回滚内存态；索引与数据同队列（约 20-30 行） |
| C-15 | P2 | `services/project-rename-service.ts:107-119` + stats/agent-session/usage | 项目改名只迁 2 个插件数据文件；统计桶、Agent 会话 slug、用量归因仍指向旧名 | 迁移扩展为「按项目键的状态清单」，或改名后写一次迁移标记（需设计） |
| C-16 | P2 | `settlement-journal.ts:160-163` | 回滚失败后 journal 立即清空，无法二次重试；批量入口只写日志 | 保留失败条目并返回；批量入口汇总到任务失败摘要 |

P3（摘要）：settings 迁移「未完成不盖章」成立，但失败前已原地改动的嵌套字段会随下次保存落盘；`data.json.bak` 单槽；`plugin-cache` 直写无 tmp/rename；`chapter-version` 回滚历史/标签无锁、`partialRollback` 写正文无锁；`step-result-saver` 补写 `rag_sources` 不在正文锁内；新 key 加密失败时静默保留旧密文；`execution-ledger.attachSettlement` 找不到 id 时挂到 `records[0]`。

## 三、已排除（复核后确认无问题）

| 项 | 证据 |
|---|---|
| 写锁异常释放 | `shared/write-lock.ts:48-53` `finally` 释放；队列空时清 Map（56-63）。**不可重入**是既定语义（`changelog-data.ts:776`），调用方均未嵌套 |
| 知识向量状态并发 | 7 个写点与 `knowledge-base-manager:573` 共用 `KNOWLEDGE_VECTOR_STATE_LOCK` |
| 质量历史追加 | `quality-history-store.ts:52-100` 按项目 promise 串行队列 |
| 插件缓存 | 落盘全走 `SerializedWriter`，单实例（engine-registry:1134） |
| 正文主写入 | 生成/协同/修正全部收敛到 `body-writer.ts:257` 路径锁 |
| 结算核心幂等 | 成长行前缀判重、时间线三列比对、伏笔名字判重、出场记录按章合并、关系按「章+原因」跳过、承诺按名去重（各有测试） |
| `settleLight` | 6 个写入点逐个 `withWriteLock`；`entity_status` 仅空值补、伏笔揭示二次不插行 |
| settings 迁移盖章时机 | 迁移数据与 `schemaVersion` 同一次 `saveData`；失败不回写、下次重试（`settings-service.ts:219-232/327-347`） |
| 密钥 v1→v2 | 口令不可用/写回失败始终保留旧密文，不降级明文（`settings-service.ts:281-311`） |
| 项目重命名失败可见 | 4 个同步步骤的失败进入 `warnings` 并由调用方展示，不是静默 |

## 四、结论与下一步

- 本轮修 2 项 P1（C-1/C-2）+ 1 项 P2（C-3），均带回归；**结算回滚不会再删除用户已有文件**。
- Fix queue 按风险排序：C-4（并发新建误删）→ C-5（run 串行化）→ C-6（回滚可见性）→ C-7/C-8（3-10 行快修）→ C-10/C-12/C-13。
- 下一审计维度：**③ 安全（密钥/注入/权限/外部输入）**（`nextAudit=security`）。

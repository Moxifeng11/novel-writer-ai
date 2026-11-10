# 自动交叉审计 — 数据一致性（②，三轮复审）

> 日期：2026-11-11 · 基线：`69cfcf8` · 维度：② 数据一致性（写锁 / 回滚 / 账本 / 迁移）
> 方法：两个独立子代理取证（静态 grep 全仓写路径 + 关键文件精读回滚/账本语义），交叉核对后合并；冲突项以 HEAD 代码为准。本轮修复 2 个 P1（无锁整文件 RMW）并补 6 条回归测试。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| D3-1 | P1 | `ui/chapter-settlement-modal.ts:368-383` | 结算表写完后用 `processFrontmatter` 无锁回写正文 `status=settled`（整文件 RMW）；引擎侧同一字段本就在 `withWriteLock` 内写（`settlement-engine.ts:490/1410`） | 与协同自动保存并发时覆盖最后一段正文 | **本轮已修**：回写包进 `withWriteLock(target.bodyPath)`；契约测试钉住唯一写点 |
| D3-2 | P1 | `engine/entity-state-manager.ts:258-283` | `updateInvolvedEntities` 先读正文 → await 提取人物 → 用旧快照整文件写回，无锁 | 提取期间的自动保存被旧正文覆盖（丢字） | **本轮已修**：提取移到锁外；锁内重读正文再合并写；3 条行为测试 + 契约 |
| D3-3 | P1 | `ui/rebuild-chapters-modal.ts:137-167` | 重建章节对伏笔库/时间线看板做无锁 read→filter→modify | 重建期间结算新追加的伏笔/事件被旧快照覆盖，无 journal 不可撤销 | **已修（第59轮）**：抽出 `removeChapterRows`，锁内重读→过滤→写回；3 条行为测试 + 契约 |
| D3-4 | P2 | `ui/context-injector-modal.ts:71/193` | 注入上下文先读正文，随后多次 IO，最后整文件覆盖写，无锁 | 多秒窗口内自动保存被覆盖 | **已修（第65轮）**：锁内重读正文再 upsert/写入；1 条契约测试 |
| D3-5 | P2 | `services/chapter-version-service.ts:557-596/537-542/239-262` | 版本标签/备注/回滚历史 RMW 无锁；`versions.json` 解析失败返回空索引，下次保存把旧元数据永久覆盖（无 `.corrupt` 归档） | 版本条目被静默清空/孤儿 blob | **已修（第60轮）**：标签/备注/回滚历史改 `withWriteLock(indexPath/historyPath)`；索引与历史损坏先归档 `.corrupt-<ts>.bak`；5 条测试 |
| D3-6 | P2 | `services/chapter-version-service.ts:193-209/370-405`、`services/project-rename-service.ts:54-59` | 项目改名/移动后 `versions.json` 里的 `project`/`sourcePath` 不迁移：历史被过滤丢弃；正文改名后回滚写回旧路径生成重复文件 | 版本历史丢失；回滚“成功”但改的是旧文件 | **已修（第60轮，项目改名侧）**：rename 后遍历 `_versions/**/versions.json` 重写 project/sourcePath/versionPath；正文单文件改名（vault rename 事件）仍待办 |
| D3-7 | P2 | `engine/settlement-engine.ts:630-638/1549-1592`、`settlement-coordinator.ts:79-89` | 回滚终态之后的关系/承诺/人物弧更新失败只设内部 `hasPartialFailure`，`SettlementResult` 无该字段，结算表仍写「已完成」 | 账本半写却显示已结算，且 journal 已清无法恢复 | **已修（第61轮）**：`SettlementResult.partialFailure` + `markPostStepFailure`；coordinator 跳过产物并警告；步骤/批量/弹窗 5 个调用方按失败处理；4 条测试 |
| D3-8 | P2 | `engine/settlement/settlement-journal.ts:72-77`、`settlement-engine.ts:1471-1505` | journal 仅在内存：进程被杀（移动端后台回收/断电）无法回滚；删除实体后崩溃即永久丢失 | 最坏情况实体文件永久删除 | 未修 → fix queue（`settlement.inprogress.json` WAL） |
| D3-9 | P2 | `engine/ledger/ledger-io.ts:30-41/89-110`、`settlement-engine.ts:1213-1258` | 台账签名仍 mtime+size；读失败把空账本写进缓存；`no-table` 被当「已存在」成功；揭示/删除路径不 invalidate | 新事件静默丢失；整会话拿到空/旧账本 | **已修（第61→62轮）**：签名加内容指纹（FNV-1a）、读失败不写缓存、`no-table` 走 partialFailure（伏笔库/时间线结构）、揭示后显式 invalidate；4 条测试 |
| D3-10 | P2 | `engine/ledger/ledger-link.ts:43-72/156`、`context-manager.ts:2482-2495` | `buildLedgerLinks` 就地改缓存台账 refs/issues；已删实体保持 `resolved=true` | 关联索引问题数每次翻倍；已删实体仍连边 | **已修（第63轮）**：改为纯函数（不写 refs/不 push issues），调用方用渲染副本；4 条测试 |
| D3-11 | P2 | `services/writing-stats-service.ts:113-125/317-333`、`main.ts:866-873` | 台账损坏静默清零并覆盖（非原子写）；项目改名不迁移，旧快照被 prune 后整书重复计数 | 历史日产出永久丢失；统计虚高 | **已修（第63轮）**：损坏先归档 `.corrupt-<ts>.bak`；persist 改 tmp+rename；新增 `migrateProjectPath` 并在项目级目录 rename 时调用；6 条测试 |
| D3-12 | P2 | `shared/plugin-data-migration.ts:34-56/78-94` | 复制模式成功后旧目录保留且无完成标记，每次 onload 重跑 | 新目录删掉的文件被旧目录复活（D2-13 仍在） | **已修（第64轮）**：成功后写 `.legacy-migrated.json` 标记（rename/复制两条路径都写），标记存在即短路；3 条测试 |
| D3-13 | P2 | `ui/co-writing-view.ts:474-502`、`shared/unload-barrier.ts:51-64` | onClose 先 await 保存历史再 track 正文保存；drain 见空即返回；无实例代次 | 旧实例保存落到新实例启动后，覆盖正文（D2-7 仍在） | **已修（第64轮，屏障顺序）**：onClose 同步 `track(performClose())`，早于任何 await；实例代次仍留 D3-13 残余 |
| D3-14 | P2 | `ui/services/agent-port.ts:584-591`、`services/project-rename-service.ts:72-105` | Agent append 与改名同步（`.project`/世界观/写作画像）均无锁 read→write | 并发结算/结构切换被旧快照覆盖 | **已修（第65轮）**：append 与三个改名同步写点全部 `withWriteLock(path)` 内重读；2 条契约测试 |
| D3-15 | P3 | `engine/settlement-engine.ts:1302-1306/1680-1681`、`settlement-journal.ts:119-126/179-197` | append-marker 在目标写之后登记；去重键不含字段，`removeMarkerOnce` 只删首处 | 写一半失败无法回滚；同值两字段只记一条 | **已修（第66轮）**：成长/互信息改为写前登记；`recordAppend` 与 `removeMarkerOnce` 支持 field（只删对应字段）；2 条测试 |
| D3-16 | P3 | `engine/cross-volume-integration.ts:494-516`、`ui/cross-volume-state-modal.ts:199-203` | 快照先删后写、无 tmp/rename、无锁 | 失败窗口丢旧快照；并发 last-wins | **已修（第66轮）**：去掉先删后写（write 覆盖语义），两处写点共用 `withWriteLock`；2 条契约测试 |
| D3-17 | P3 | `ui/batch-chapters-modal.ts:238-320`、`settlement-engine.ts:1866-1867`、`foreshadow-manager.ts:196-201` | 信息债看板三个写点只有一处持锁 | 看板回退/删窗 | **已修（第67轮）**：新增 `shared/info-debt-board` 唯一写入器（路径锁内覆盖写，不再 delete+write），三处统一接入；2 条测试 |
| D3-18 | P3 | `services/rules-service.ts:220-243` | 启动时版本不一致直接覆盖用户改过的 `写作规则.md`，无备份 | 用户规则改动丢失（注释称有意，仍属数据丢失面） | **已修（第67轮）**：覆写前先写 `写作规则.md.bak` 并持路径锁；2 条测试 |

## 二、r2 遗留项复核（HEAD 69cfcf8）

- **D2-2 摘要/索引：已修**（`chapter-digest.ts:220-247` 锁内 RMW、同章去重、仅干净结算后生成）。残留：重复摘要文件不删盘，但不再进提示词。
- D2-3 → D3-3（已修）、D2-4 → D3-17、D2-7 → D3-13、D2-8 → D3-9、D2-9 → D3-10、D2-10 → D3-5/D3-12、D2-12 → D3-11、D2-13 → D3-12：**仍在**。
- 已修项无回归：C-2 partialRollback 锁、C-4 实体创建锁内查重、C-5 项目级结算锁、D-3 删除 journal、D-6 关系队列、F-3 承诺台账签名、v4.79 删除日志、D2-1 目录拒绝。

## 三、已排除项（交叉确认）

- `engine/body-writer.ts` 正文写、`settlement-engine.ts` settle/settleLight、`analysis-report-engine.ts` 实体/台账 RMW、`chapter-digest.ts` 摘要与索引、`chapter-version-service.ts` saveVersion/rollback/deleteVersion、`settlement-table-writer.ts` 结算表覆盖写、`foreshadow-manager.ts` / `note-properties-service.ts` / `relationship-change-queue.ts` / `knowledge-vector-store.ts` 全部在锁内。
- `engine/ledger/*` 是纯内容变换，无文件写；当前调用方均持锁。
- `project-migration-service.ts` 用目录 rename，不留旧源；`rules-service` 删除项目副本不会复活。
- journal 的 `whole-file-before`/`frontmatter-field` 对同一文件多次写保留首个快照、逆序回滚，正常异常路径可恢复（仅崩溃路径不可，见 D3-8）。

## 四、待用户拍板

- 无（本轮均为内部一致性修复）。

## 五、fix queue

1. D3-6 残余：正文单文件改名迁移 sourcePath（P2，vault rename 事件）
2. D3-13 残余：协同实例代次（旧实例保存丢弃）

P1/P2 主体与全部 P3 已修；维度② r3 收尾，转维度③ 安全复审。

## 六、后续修复记录

- 第59轮（D3-3）：`ui/rebuild-chapters-modal.ts` 抽出 `removeChapterRows`，伏笔库/时间线看板改为 `withWriteLock(path)` 内重读→过滤→写回；新增 3 条行为测试（只删目标章节行 / 无匹配不写 / 文件缺失安全返回）+ 1 条接线契约。

- 第60轮（D3-5/D3-6）：`chapter-version-service` 标签/备注/回滚历史加索引锁，索引与历史损坏归档 `.corrupt-<ts>.bak`；`project-rename-service` 新增 `migrateVersionIndexes` 重写 `_versions/**/versions.json` 的项目与路径字段；新增 5 条测试。

- 第61轮（D3-7）：`SettlementResult` 新增 `partialFailure`，关系/承诺/角色弧线三处 catch 走 `markPostStepFailure`；coordinator 在 `partialFailure` 时跳过结算表/快照/总览并警告；步骤结算/StepRunner/批量/两个弹窗按失败处理。4 条测试。

- 第62轮（D3-9）：`ledger-io` 签名加内容指纹、读失败（ok=false）不写缓存；`settlement-engine` 追加伏笔/时间线遇 `no-table` 记 partialFailure（伏笔库结构/时间线看板结构），揭示路径补 `invalidateStoryLedger`。4 条测试。

- 第63轮（D3-10/D3-11）：`buildLedgerLinks` 纯函数化（不写缓存 refs/issues），`context-manager` 用渲染副本；`writing-stats-service` 损坏归档、tmp+rename 原子写、新增 `migrateProjectPath`，main.ts 项目级 rename 时调用。新增 4+6 条测试，更新 2 条旧断言。

- 第64轮（D3-12/D3-13）：`plugin-data-migration` 成功后写 `.legacy-migrated.json` 完成标记（rename/复制均写，存在即短路）；`co-writing-view.onClose` 改为同步登记整个 `performClose()` 进卸载屏障（早于 saveHistory 等 await），内部不再单独 track 保存。新增 5 条测试并更新 1 条旧接线断言。

- 第65轮（D3-4/D3-14）：`context-injector` 锁内重读再注入；`agent-port` append 与 `project-rename` 三处同步写点全部加路径锁并在锁内重读。新增 3 条契约测试。

- 第66轮（D3-15/D3-16）：append-marker 支持 field（去重/回滚都按字段），成长与互信息改为写前登记；跨卷快照去掉先删后写并加路径锁。新增 4 条测试。

- 第67轮（D3-17/D3-18）：新增 `shared/info-debt-board` 唯一写入器，结算/批量/伏笔管理器三处统一为路径锁内覆盖写（去掉 delete+write）；写作规则覆写前先写 `.bak` 并持锁。新增 4 条测试。维度② r3 fix queue 清零。

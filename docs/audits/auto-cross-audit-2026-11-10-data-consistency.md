# 自动交叉审计 — 数据一致性（写锁 / 回滚 / 账本 / 迁移）（②）

> 日期：2026-11-10 · 基线：`60ac962` · 维度：② 数据一致性
> 方法：两个独立子代理并行取证——① 写锁/回滚/结算日志/版本链；② 台账/摘要/缓存/迁移/统计。交叉核对后合并。本轮修复 1 个 P1 + 1 个 P2（结算回滚保真度）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| D-1 | P1 | `ui/write-chapter-modal.ts:662-721` | 一键成文在 `settle` 成功后再次无锁整篇改写正文，并把 `status: settled` 改回 `written` | 每次一键成文成功结算后 | 章状态确定性降级；BodyWriter「settled 不降级」不变量失效；无锁全文写与自动保存/协同写入竞争；rename 后版本 sourcePath 失效 | 未修 → **下一代码批次首项**（删除二次改写，或把报告 NEW_* 名单传给 settle） |
| D-2 | P1 | `engine/settlement-engine.ts:706-712`、`settlement-journal.ts:24/93`、`settle-context.ts:49` | journal 字段快照用 `String(fm[field] ?? '')`，数组型 frontmatter 回滚后变成字符串 | 结算在正文 frontmatter 之后失败触发回滚（如删除实体/看板读取失败） | `涉及人物/地点/势力/物品功法`、`持有物品` 等 list 变 text；Bases/查询/后续解析语义改变 | **本轮已修**：journal/快照保留原类型（`unknown`），restore 原样写回；新增行为测试 |
| D-3 | P2 | `engine/settlement-engine.ts:1432-1435`、`:784-804` | body frontmatter 写失败只 log+Notice，不置 `hasPartialFailure`；`entity_last_changed_at/chapter` 每次写但不快照 | body fm 写入失败（重复键/YAML/权限）；或任意后续步骤失败回滚 | 半失败结算被报成功且不回滚；回滚后「最后变更章/时间」指向已被回滚的章 | **本轮已修**：catch 置 partial；写前快照两个溯源字段；新增 2 条行为测试 |
| D-4 | P2 | `engine/step-runner.ts:844-847`、`services/chapter-version-service.ts:491/557-587/234-257` | 定向修订前备份把 `chapDir`（目录）当 sourcePath；`partialRollback` 无锁写正文；标签/备注改索引无锁 RMW；索引损坏静默返回空、不自愈；rename 后 sourcePath 过期 | 定向修订备份/并发标签编辑/索引损坏/正文改名后回滚 | 版本记录不可回滚或写错路径；并发编辑丢版本条目；历史静默消失 | 未修 → fix queue |
| D-5 | P2 | `ui/rebuild-chapters-modal.ts:137-166`、`engine/settlement-engine.ts:1857-1858`、`knowledge-base-manager.ts:569-582`、`ui/chapter-settlement-modal.ts:376` | 多张共享表存在「一处加锁、一处无锁 RMW」的第二写域：重建章节、信息债看板、向量索引、正文 status | 重建/批量建章与结算、协同保存、删书并发 | 重建按旧快照删掉并发结算新行；看板回退；向量索引丢条目/复活已删书；status 竞争 | 未修 → fix queue（收敛到单写入网关） |
| D-6 | P3 | `engine/body-writer.ts:493/334-379` | 中文 frontmatter 键不匹配 key 正则，已有同名键时追加重复键；两阶段写中 processFrontmatter 失败仍返回成功 | 流水线重写已有 `涉及*` 字段的章节；写入后 360ms 内拿不到 TFile | YAML 重复键（Obsidian 去重兜底前可能落盘）；状态/统计元数据缺失 | 未修 → fix queue |
| D-7 | P1 | `engine/memory/chapter-digest.ts:204-282`、`engine/settlement-engine.ts:640-646`、`main.ts:1802-1817` | 章节长期记忆只在结算时派生一次；正文修订/台账变化不重建；同章改名后可留两份摘要同时进入 prompt；摘要索引 RMW 无锁 | 结算后修订正文；章节改名后重结算 | 后续章节注入过期结尾钩子/人物/事件；同章重复摘要；核心长期记忆持续污染 | 未修 → fix queue（来源指纹 + 按章去重 + 索引加锁） |
| D-8 | P2 | `engine/ledger/ledger-io.ts:30-41/93-109`、`ledger-write.ts:218-245` | 台账缓存签名只有 mtime+size（同尺寸编辑碰撞）；承诺解析失败仍缓存空数组；非空文件无表格时 append 返回 `no-table`，结算记成「已存在」 | 同尺寸状态修改；解析瞬间文件在写；用户把时间线表格改成列表 | 事件/承诺整会话保持旧值或空值；新时间线事件静默丢失 | 未修 → fix queue（内容哈希 + 失败不缓存 + no-table 可见化） |
| D-9 | P2 | `engine/ledger/ledger-link.ts:43-72/156`、`context-manager.ts:2482-2496` | `buildLedgerLinks` 就地改写缓存台账的 `entityRefs/issues`；渲染非幂等，已删除实体仍连边 | 连续点击「回写关联索引」；先建索引后删/改人物 | 关联索引“待处理问题”每次翻倍；问题数不可信；已删实体仍被连边 | 未修 → fix queue（纯函数化 + 克隆后写 links） |
| D-10 | P2 | `core/settings-service.ts:281-306`、`engine/engine-registry.ts:1188-1203` | 备份失败被吞、迁移仍继续覆盖；`resolveSecret` 在口令会话下加密返回 null 且无旧密文时回退明文 | `.bak` 写失败但 data.json 可写；加密实现返回 null | 无回滚副本；API Key 可能明文落盘并被同步 | 未修 → fix queue（备份失败 fail-closed；加密失败绝不写明文） |
| D-11 | P3 | `engine/context-manager.ts:961-985/1054-1073`、`shared/plugin-cache.ts:198-222` | 人物卡 frontmatter 缓存只按 mtime 命中，metadataCache 未刷新时把旧值写进新 mtime 并持久化 | 外部编辑器/同步写文件后立即 gather | 旧状态/情绪/位置长期命中，AI 拿到错误人物状态 | 未修 → fix queue |
| D-12 | P2 | `services/writing-stats-service.ts:116-121/314-325`、`shared/writing-stats.ts:347-388` | 统计台账解析失败直接清空并覆盖原文件；rename/move 不迁移快照，重建后重复计词 | 崩溃/同步冲突留下截断 JSON；重命名正文 | 历史日产出永久丢失；全局/项目统计虚高或错归属 | 未修 → fix queue（原子写 + `.bak` + rename 迁移） |

## 二、已排除项（交叉确认）

- **写锁本体正确**：per-key Promise 队列、`finally` 必释放、异常不阻塞后续；`tests/unit/engine/write-lock.test.ts` 已覆盖。未发现同 key 嵌套。
- **结算主链事务语义基本正确**：`hasPartialFailure` 时按 journal 逆序回滚、createdFiles 最后删除、计数清零；V2 关系/承诺/弧线仅在无 partial 时写（D-3 修复保持）。
- **标准表格幂等**：4/7 列时间线、8/6/4 列伏笔按表头映射；重复 append 返回 `changed:false`；`settlement-ledger-chain` 已锁「写入→解析→摘要→索引」。
- **设置迁移链**：schemaVersion 0→5 链式递增；迁移失败不写回版本；`.bak` 在 save 之前；缺失嵌套字段 deepMerge 幂等；v4→v5 预设冻结防重复。
- **知识向量签名**：包含 embedding 指纹与逐文件 mtime+size；换模型会重载；查询缓存 key 含指纹。
- **缓存分区**：插件实体缓存按 project+path 分区，无跨项目串键；上下文缓存 key 含 project+chapter，文件 modify 会失效。

## 三、本轮修复与验证

- D-2：`SettlementJournal` 字段快照与 `SettleContext.snapshots` 改为保留原类型；`snapshotField` 不再 `String()`；`restoreField` 按原值写回。
- D-3：body frontmatter 写失败置 `hasPartialFailure`；`applyEntityFieldUpdate` 写前快照 `entity_last_changed_at/chapter`。
- 新增 3 条回归测试（`settlement-engine-behavior`）：数组字段回滚保持 list、body 写失败触发回滚、溯源字段回滚恢复。
- `npx vitest run`（相关 2 文件）：23 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- 无（本轮均为数据正确性修复，不涉及产品语义）。

## 五、fix queue 顺序

1. **D-1** 一键成文二次改写/状态降级（P1，下一代码批次首项）
2. **D-7** 章节摘要 stale/重复（P1）
3. D-4 版本链（sourcePath/锁/自愈）、D-8 台账缓存、D-9 关联索引纯函数化
4. D-5 第二写域收敛、D-10 设置 fail-closed、D-12 统计原子写
5. D-6 BodyWriter 中文键、D-11 人物卡缓存

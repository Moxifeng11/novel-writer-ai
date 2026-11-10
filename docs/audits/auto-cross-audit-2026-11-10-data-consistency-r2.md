# 自动交叉审计 — 数据一致性（写锁 / 回滚 / 账本 / 迁移）（②，二轮复审）

> 日期：2026-11-10 · 基线：`7fab916` · 维度：② 数据一致性（二轮复审）
> 方法：两个独立子代理复审——① 写锁/回滚/结算/版本链；② 账本/摘要/缓存/迁移。交叉核对后合并。本轮修复 1 个 P1（定向修订备份 sourcePath 传目录）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| D2-1 | P1 | `engine/step-runner.ts:841-851`、`services/chapter-version-service.ts:118-125` | 定向修订前唯一备份把 `chapDir`（目录）当 sourcePath；服务层只校验前缀不拒绝目录；备份中心/回滚对目录 read/write 必败 | 这条「唯一备份」实际不可回滚，历史/对比入口全断 | **本轮已修**：step-runner 解析真实正文路径（提取 `resolveDiskBodyPath`），saveVersion 拒绝 TFolder；新增 3+1 条测试 |
| D2-2 | P1 | `engine/memory/chapter-digest.ts:198-339`、`engine/settlement-engine.ts:641-646` | 摘要只在结算时派生一次；无来源指纹/去重/清理；同章改名留两份；index RMW 无锁 | 后续章节注入旧结尾钩子/旧人物/已回收线索；同章重复摘要 | 未修 → **下一代码批次首项**（按章去重 + index 加锁，再做指纹重建） |
| D2-3 | P2 | `ui/rebuild-chapters-modal.ts:137-167` | 重建章节对伏笔库/时间线做无锁整文件 RMW，与结算/分析 apply 形成第二写域 | 并发结算新追加行被旧快照覆盖，无 journal 不可撤销 | 未修 → fix queue |
| D2-4 | P2 | `ui/chapter-settlement-modal.ts:368-383`、`engine/settlement-engine.ts:1866-1867`、`ui/batch-chapters-modal.ts:310-320` | 正文 status 与信息债看板仍有无锁写点（对照 BodyWriter/结算/伏笔管理器均有锁） | 可能覆盖协同自动保存的新正文或使看板回退 | 未修 → fix queue |
| D2-5 | P3 | `engine/body-writer.ts:493/339-364` | 中文键不匹配 key 正则导致重复键；两阶段写 processFrontmatter 失败仍返回成功 | YAML 重复键；元数据缺失但调用方按成功处理 | 未修 → fix queue |
| D2-6 | P2 | `engine/knowledge-vector-store.ts:477-530` | `STATE_LOCK` 内逐条 `await embed()`（单次超时 60s） | 向量锁被网络占用，检索/改名/其它书写入全部阻塞 | 未修 → fix queue（锁外预计算） |
| D2-7 | P2 | `ui/co-writing-view.ts:473-501`、`shared/unload-barrier.ts` | L2-1 屏障逃逸：onClose 先 `await timeEstimator.saveHistory()`，之后才 track(savePromise)；detach 后 drain 第一次检查为空直接返回；即使登记，30s 保存也超过 2.5s 上限 | 旧实例保存仍可能在新实例启动后覆盖正文；仍需 generation token | 未修 → fix queue（先登记整个 onClose + 实例代次） |
| D2-8 | P2 | `engine/ledger/ledger-io.ts:30-41/93-109`、`ledger-write.ts:215-244`、`settlement-engine.ts:1220-1258` | 台账签名仍只有 mtime+size；解析失败仍缓存空数组；`no-table` 被结算记成「已存在」 | 事件/承诺整会话旧值或空值；新时间线事件静默丢失 | 未修 → fix queue（内容 hash + 失败不缓存 + no-table 置 partial） |
| D2-9 | P2 | `engine/ledger/ledger-link.ts:43-72/156`、`context-manager.ts:2482-2495` | `buildLedgerLinks` 就地改缓存台账 refs/issues；已删实体仍按旧 resolved 连边 | 关联索引问题数每次翻倍；已删实体仍出现 | 未修 → fix queue（克隆后纯函数化，约 20 行） |
| D2-10 | P2 | `engine/engine-registry.ts:1189-1206`、`core/settings-service.ts:227-232/280-298` | 备份失败仍继续迁移覆盖；加密失败无旧值时写空串，UI 仍显示用户刚输入的值 | 无回滚副本；Key 静默消失且无提示 | 未修 → fix queue（备份 fail-closed + 保存中止提示） |
| D2-11 | P3 | `engine/context-manager.ts:966-986/1055-1073`、`shared/plugin-cache.ts:202-226` | 人物卡缓存按 mtime 命中，metadataCache 未刷新时把旧 frontmatter 写进新 mtime | AI 长期拿到旧状态/情绪/位置 | 未修 → fix queue |
| D2-12 | P2 | `services/writing-stats-service.ts:113-125/317-333`、`main.ts:1570-1579` | 台账损坏自动清空并覆盖（非原子写）；无 rename 处理，改名后重复计词 | 历史日产出永久丢失；统计虚高/错归属 | 未修 → fix queue（`.corrupt` 留档 + tmp/rename + rename 迁移） |
| D2-13 | P2 | `shared/plugin-data-migration.ts:34-56/82-97`、`main.ts:765-788` | 复制模式成功后旧目录仍保留：目标侧删掉的文件下次启动会被旧目录复制回来；单文件异常整批回滚被吞 | 已删书籍向量/旧统计复活；每次启动重复遍历旧树 | 未修 → fix queue（完成标记 + 成功后旧目录改名 + tmp 写） |

## 二、已排除项（交叉确认）

- **向量索引第二写域已闭环**：7 个写点 + 改名同步全部共用 `KNOWLEDGE_VECTOR_STATE_LOCK`，未发现锁外写 `index.json`。
- D-1/D-2/D-3 修复未回退；`partialRollback` 已在锁内写正文（C-2）。
- 迁移在 `engineRegistry.initialize` 与 `_initWritingStats` 之前完成，**onload 无竞态**；所有消费方都走 `pluginRootDir` 单源，运行期不会双读旧目录（风险只有「删除复活」）。
- `UnloadBarrier.drain` 有界（Promise.race），`SerializedWriter.flush` 有 5s 上限，不会无限拖死卸载。
- `plugin-cache` 惰性路径本轮未发现新竞态；`PreferenceMemory/StyleLearner` 的 dataPath 仍在构造时求值，但构造都发生在 onload 之后。
- S-1 修复未回退：加密失败且无旧值时不再写明文（全明文模式仍按设计保存明文）。

## 三、本轮修复与验证

- `engine/step-runner.ts`：提取 `resolveDiskBodyPath`（v4 步骤目录 → 真实正文文件，优先带章名），`isChapterSettledOnDisk` 复用；定向修订备份改传该路径，找不到时回落到 `chapDir/第N章_正文.md`。
- `services/chapter-version-service.ts`：`saveVersion` 拒绝 `TFolder` sourcePath（错误：源路径必须是正文文件）。
- 新增 3 条 `step-runner-backup-path` 测试（标准路径回落/无关文件不误指/非 v4 缺章号返回 undefined）+ 1 条 service 目录拒绝测试。
- `npx vitest run`（2 文件）：29 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- 无（本轮为数据可恢复性修复，不改变产品语义）。

## 五、fix queue

1. D2-2 摘要去重 + index 加锁 + 来源指纹（P1）
2. D2-3/D2-4 第二写域收敛（P2）
3. D2-8 台账内容 hash/no-table、D2-9 关联索引纯函数化（P2）
4. D2-7 屏障逃逸 + generation token、D2-10 设置 fail-closed、D2-12 统计留档、D2-13 迁移收尾（P2）
5. D2-5 BodyWriter 中文键、D2-6 锁内网络、D2-11 人物卡缓存（P3/P2）

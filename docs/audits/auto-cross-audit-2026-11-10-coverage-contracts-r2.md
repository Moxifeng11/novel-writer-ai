# 自动交叉审计 — 覆盖率盲区与测试契约（④，二轮复审）

> 日期：2026-11-10 · 基线：`f45c351` · 维度：④ 覆盖率/测试契约（二轮）
> 方法：两个独立子代理复审（解析 coverage HTML + 反向验证最近测试）。本轮修复 1 个 P1 测试真实性（T-2）+ 1 个 P2 安全逃逸（围栏可闭合）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| C2-1 | P1 | `engine/note-properties-service.ts:198-275` | L11.95% / B20%；`applyTagMigration`、`applyPropertyCompletion`、`writeProjectBases`、`processFrontmatter` 零覆盖，只有纯计划函数有测试 | 三个用户可见命令直接改用户笔记，逐文件失败被 catch 吞、写锁/空值保护无回归 | **已修（第47轮）**：4 条行为测试（只补缺失键/计数真实/失败不计数/Bases 幂等），并修正 `filled`/`added` 虚报 |
| C2-2 | P1 | `tests/unit/engine/deconstructor-full-coverage.test.ts:86-138` | T-2 仍未修：唯一有效断言位于文本 50%，截断到 10 万字仍绿；foreshadow 的 `secondHalfUnique` 解构未用；structure/technique/rhythm 只验字段存在 | 拆解器改为只分析前缀/返回空数组时，“全文覆盖”回归全绿 | **本轮已修**：新增尾部独有实体用例（正检 + 截断负向对照），断言全文末尾实体必须检出 |
| C2-3 | P2 | `engine/agent/harness/host-tools.ts:663/701` | S2-8 围栏可被内容自带的 `【资料结束】` 提前闭合；`search_vault` 围栏未测 | 提示注入可逃出资料围栏 | **本轮已修**：`wrapUntrustedContent` 一次性 nonce + 转义内容标记；两处统一使用，3 条负向测试 |
| C2-4 | P2 | `services/prompt-manager.ts:640-647` | C-3 仍整类零覆盖；`importConfig` 无形状/版本校验，浅合并后异步落盘且提前返回 true | 坏配置可被持久化，模板/AB 实验加载抛错 | 未修 → fix queue |
| C2-5 | P2 | `engine/project-migration-service.ts:68-153` | `plan/migrate/migrateWithNotice/rollbackWithNotice` 零覆盖，仅 rollback 有测试 | 破坏性目录移动的跳过/冲突/备份清单/rename 失败无护栏 | 未修 → fix queue |
| C2-6 | P2 | `shared/plugin-cache.ts:121-126` | C-4 未闭环：`save()` 直接 adapter.write 无 tmp/rename；实体缓存/更新状态零覆盖 | 半写/损坏 cache 下次 load 重置为空，settingsBackup/实体元数据丢失 | 未修 → fix queue |
| C2-7 | P2 | `ui/agent-workbench-view.ts:1172-1181` | 文件 0% 覆盖，`shouldAutoApproveNewFile` 的第三个参数（activeProject）无接线测试 | 删掉参数即恢复跨项目写入能力，现有测试全绿 | 未修 → fix queue（抽纯函数审批决策 + 行为测试） |
| C2-8 | P2 | `tests/unit/architecture/system-consistency-gates.test.ts:20-24`、`domain-isolation.test.ts:11-24`、`official-review-rules.test.ts:20-33` | T-3 仍未修：死 import 同时满足三个 `toContain`；扫描目录缺失返回 [] 无文件数下限 | 门禁可被注释/死 import/空目录绕过 | 未修 → fix queue（剥注释 + 文件数下限 + 负向夹具） |
| C2-9 | P2 | `tests/e2e/obsidian-plugin.spec.ts:2197-2257` | T-5 仍未修：`if (hasProject)` 包住 full-writer 下拉测量，项目缺失时只测 settings | 完整工作台下拉裁切回归静默消失 | 未修 → fix queue |
| C2-10 | P3 | `chapter-digest.test.ts:102-105`、`worker-quality-parity.test.ts:27-44`、`unload-barrier-wiring.test.ts:15-32` | 最近新增的 3 条“契约”仍是源码字符串断言，回退实现不会红 | “测试看似覆盖、回退不会红” | 未修 → fix queue（改行为断言：并发索引、worker 执行路径、onunload 调用顺序） |

## 二、已排除项（交叉确认）

- C-1/C-2/C-5/T-1/T-4/T-6 上轮修复未回退；`coverage/` 报告与 `ab1fb26` 同分钟，新模块已纳入。
- 最近 7 组新增测试中：co-write 模式、canon SSRF、plugin-cache 路径、UnloadBarrier、digest 去重、S2-8 围栏均可反向复现（helper 级）；worker 同源与卸载接线仅源码契约（C2-10）。
- 覆盖率总量：796 文件；Statements 45.73% / Branches 45.32% / Functions 46.68% / Lines 46.09%。有语句且行覆盖 <30% 的文件 216 个（零覆盖 78 个，69 个在 ui/）；含写调用且 <30% 的文件 43 个。
- `engine/context-manager.ts` L17.35% 是绝对盲区最大文件，但不直接写盘，单列后续审计项。

## 三、本轮修复与验证

- T-2：`deconstructor-full-coverage` 新增「尾部独有角色检出 + 截断负向对照」用例；16 万字符文本末尾实体必须被检出，截掉尾部后不得凭空检出。
- S2-8 围栏：新增 `shared/untrusted-content.ts`（nonce 开闭标记 + 转义内容自带的 `【资料结束】`/`【外部资料`）；`host-tools` 的 read_file/search_vault 统一使用。
- 新增 3 条围栏负向测试 + 1 条全文覆盖测试。
- `npx vitest run`（3 文件）：passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- 无（本轮为测试真实性与注入防护加固）。

## 五、fix queue

1. ~~C2-1 note-properties 写路径行为测试（P1）~~（第47轮已修）
2. C2-4 PromptManager 校验、C2-5 project-migration 失败分支、C2-6 PluginCache 原子写（P2）
3. C2-7 write_file 接线抽纯函数 + 测试、C2-8 架构门禁收口、C2-9 E2E 条件跳过（P2）
4. C2-10 三条源码契约改行为断言（P3）

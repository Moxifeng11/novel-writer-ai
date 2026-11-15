# 下一步优化建议与遗留问题台账（2026-11-16）

> 版本：v4.96.0 · 对应 HEAD `14306a20` · 数据来源：`docs/progress/program-status.json`、`.coverage-baseline.json`、`.bundle-baseline.json`、`docs/audit/2026-11-15-adversarial-review.md`、`docs/design/2026-11-15-architecture-remediation-plan.md`（数字以真相源为准，本文只引用结论）。

## 一、现状快照

| 维度 | 现状 | 证据 |
|---|---|---|
| 代码规模 | 978 个源码文件 / 约 301K 行；最大单文件 `main.ts` 146KB | `docs/generated/code-index.md` |
| 测试 | 924 个测试文件 / 约 9700 用例全绿 | `npm run test` |
| 门禁 | 30 道门 `preflight EXIT=0` | 本轮实跑 |
| 产物 | `main.js` 5.75MB（基线棘轮）、`styles.css` 570KB、worker 793KB（内联副本另入 main.js） | `.bundle-baseline.json` |
| 覆盖率 | 总行 50.5%；`ui/` 行 21.4%、`ui/views/` 28.3% | `.coverage-baseline.json` |
| 业务专项 | 7 组（G1–G7，共 61 项）全部 done | `program-status.json` |
| 架构整改 | 12 项（C2–C5、B1–B4、A1–A4）全部交付并带测试 | `design/2026-11-15-architecture-remediation-plan.md` §十三 |
| 对抗性审查 | 25 项：22 ✅ + 1 ◑（启动顺序）+ 2 ⏳（体积、全局挂载）；其中「全局挂载」实际已在 `52350d41` 删除，审计表未回填 | 同上 |

## 二、历史架构遗留：结论

**已解决（有提交 + 测试锁定）**

1. 多入口写覆盖 / 无锁写：伏笔库、时间线、结算产物统一走写锁与 FileTx，迁移失败整批回滚（`2887b232`、`5d7dd4ad`）。
2. 状态口径不一致：章节 canonical 状态 + 三入口一致性测试（`a696859c`）。
3. 索引不可重建：事实库/摘要/档案/台账均可由 `断言.json` 幂等重建（`5d7dd4ad`）。
4. 关系多通道：`关系状态.md` 为权威，设定图边派生（`67642ad2`）。
5. 生成后无校验、修订无闭环、前馈无结构：B1/B2/B3/B4 四件套（`70ac2b33`、`daef4b5c`、`7a1804d3`、`7dc00858`）。
6. 上下文过量注入、场景循环、按需检索、覆盖可视化、协同/正文分裂：A1–A4（`36b56813`、`e637ec7b`、`3ac4eacf`），实测注入 token −66.5%。
7. 全局命名空间污染：`window.novelAI` 已移除并新增 `global-namespace` 门禁（`52350d41`）。

**部分解决**

- 「命令/视图在串行 I/O 之后才注册」（审计 #8，P2）：现在只有状态栏「⏳ 初始化中」占位，注册顺序未动；原因是视图工厂依赖引擎字段，提前注册有打开即崩风险。

**未解决**

- 主包体积（审计 #9，P2）：5.19MB → **5.75MB**（内联 worker + 本轮新功能），未做视图动态 import / 图片外移。

**新暴露的一类「遗留」：能力已交付但用户摸不到（入口缺失）**

与 MCP tab 空白同源的一类问题——功能在代码里在跑，界面上没有入口：

| 能力 | 现状 | 影响 |
|---|---|---|
| `runQualityPanel` | 只有插件方法 + `plugin-api`，无 UI | 质量面板数据（通过率/类型分布/平均轮次）用户看不到 |
| `runPostGenerationCheck` | 只有插件方法，无 UI | 生成后校验报告只能从代码/日志拿 |
| `autoReviseChapter` | 只有插件方法，无 UI | 定向修订闭环缺人工触发入口（B2 遗留 item 3） |
| `recoverInterruptedSettlement` | 只有插件方法，无按钮 | 自检建议「点『恢复中断结算』」，但**该按钮不存在**——引导指向假入口 |
| 示例 MCP / 管理器 | 本轮已补齐 | 已解决 |

另：设置项 112 个、命令面板 93 条命令，首启可发现性负担偏重。

## 三、下一步聚焦（按 ROI 排序）

### P0 · 让已交付的质量闭环真正可用（1–2 轮）

1. **质量面板落地**：新增「📊 质量闭环」页/弹窗，接 `runQualityPanel`（历史 + 通过率 + 类型分布）+ `runPostGenerationCheck`（最近一次报告）+ `autoReviseChapter`（按钮触发，带确认）。验收：真实项目生成 1 章后，面板出现记录、按钮能触发修订并落盘。
2. **修「引导指向不存在入口」**：自检 → 恢复中断结算加真实按钮（dryRun 预览 → 确认恢复）；或至少把提示文案改成现有可达路径。验收：点击后能列出待恢复章节并执行。
3. **跑通 A1/A4 开关收益**（架构整改遗留 item 2）：默认关的 `sceneLoopBodyGeneration` / `coWriteStructuredConstraints` 连跑 3 章，对比人工评分与注入量，给出「开/关」结论写入 `docs/progress/`。

### P1 · 可发现性与测试密度（下一轮）

4. **设置/命令收敛**：112 项设置按「必配 / 进阶 / 实验」分组 + 搜索框；93 条命令按使用频率重排，低频收进子菜单。验收：首启 3 分钟路径无「找不到」。
5. **UI 覆盖率 21% → 30%**：优先 `ui/co-writing-view.ts`（133KB）、`ui/full-writer-view.ts`（130KB）、`ui/views/knowledge-base-view.ts`（136KB）——把判定/格式化纯逻辑抽到 `shared/` 后补测（沿用 `kb-format.ts` 先例）。
6. **MCP 二期**：会话内可见「调用了哪个 mcp 工具 / 结果摘要」；服务级默认动作分类的权限提示；连接失败自动重试一次。

### P2 · 技术债（排期机动）

7. **主包减肥**：视图按需 `import()`（参考本轮 MCP 管理面板的做法）+ workers-inline 懒加载/外置策略；目标先回到 5.2MB 以下（bundle 棘轮只允许降）。
8. **启动顺序（审计 #8）**：先注册空壳视图 + `ready` 后填充，解耦视图工厂对引擎字段的依赖。
9. **TODO 清理**：源码 80 处 TODO/FIXME/HACK，优先 `entity-factory.ts`（8）、`safe-html.ts`（4）。
10. **文档回填**：审计报告 #17 标记已修、本文件与 `program-status.json` 的基线数字同步。

## 四、发版建议

本轮已积累 4 个提交（桌宠帧语义 ×2、MCP 补全），均为用户可见功能，`preflight EXIT=0`。建议在 P0-1/P0-2 完成后发 **v4.97.0**（含桌面端 MCP 接入 + 桌宠状态驱动）；`tag` / Release 需用户明确确认。

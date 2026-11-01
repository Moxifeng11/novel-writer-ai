# 术语表

> 只解释本项目里的含义，不追求通用定义。括号内是代码落点，便于从词跳到实现。

| 术语 | 含义 | 代码/文档落点 |
|---|---|---|
| 三域 | 长篇小说 / 短篇小说 / 剧本三种创作域，目录与流程隔离 | `domains/kernel/`、`docs/design/v4.20-three-mode/` |
| 项目 | 一个可独立创作的作品目录（`长篇小说/书名`） | `shared/paths.ts` 的 `pj*` |
| 卷 / 章 | 项目内的分卷与章节；正文文件名 `第N章_正文.md` | `shared/paths.ts`、`engine/chapter-utils.ts` |
| 结算 | 把章节报告落成实体卡、伏笔、时间线、正文状态等 | `engine/settlement-engine.ts` |
| 轻结算 | 只更新部分产物（如仅正文状态/统计）的模式 | `SETTLE_ONLY` 相关路径 |
| 连续性账本 | 人物卡的「已知信息 / 伤势 / 持有物品」，追加并带来源章 | `settlement-engine.ts`、章节 frontmatter |
| 结算 journal | 结算写入前记录的原值/追加项，失败时逆序回滚 | `SettlementJournal` |
| 上下文体检 | 注入前检测重复段、规则冲突、串章 | `engine/context-manager.ts`、`shared/` |
| 注入账本 | 记录每次生成注入了哪些规则/模板/上下文片段与版本 | `shared/injection-ledger.ts` |
| 写作指纹 | 用户样文的风格向量/特征，用于风格相似度 | `ui/views/writing-fingerprint-view.ts` |
| 人味 / 人味分 | 可观察的人类写作特征评分（对话占比、口语密度、时间锚点等） | `shared/human-feature-*` |
| RAG / 知识库 | 从设定/参考书检索片段注入上下文 | `engine/knowledge-*`、`engine/embedding/` |
| Harness | 本项目内置的 Agent 运行时（工具循环、会话、遥测） | `engine/agent/harness/` |
| dsh | DeepSeek Harness，可选外部 Agent 后端 | `engine/agent/dsh/`、`docs/research/deepseek-harness/` |
| EngineRegistry | 引擎注册/懒加载/作用域/释放的中心 | `engine/engine-registry.ts` |
| 单一入口 | 同一事实只允许一个写入/生成入口（正文、结算表、路径等） | `docs/PLAN.md`、各模块文件头 |
| 执行登记表 | Agent 触发的长流程执行记录 | `services/execution-ledger.ts` |
| 质控 / 定向修订 | 质量报告 → 只改报告问题的修订 → 闸门 → 复检 | `engine/quality/`、`engine/revision/` |
| 场景卡 | 章节内场景的结构化卡片（目标/阻碍/交换/感官等） | `shared/scene-card.ts` |
| 灵魂层 | 角色内在驱动/口吻/记忆等生成用设定 | `engine/prompts/`、实体卡 |
| 信息债 | 设定/伏笔未闭合的信息缺口，到阈值时提示 | `shared/thresholds.ts`、`setInfoDebtMax` |
| 步骤（step） | 创作流水线中的一个阶段（规划/正文/质控…） | `engine/step-runner.ts` |
| 模式规则 | 每种创作模式允许的工具/命令集合 | `command-mode-rules`、`domains/kernel/tool-catalog-*` |
| ADR | 架构决策记录 | `docs/adr/`、`docs/ARCHITECTURE.md` §7 |
| 门禁 | 可执行的约束脚本（失败即阻断） | `scripts/check-*.mjs` |
| 棘轮 | 基线只允许指标下降/覆盖率上升 | `.arch-baseline.json`、`.css-baseline.json`、`.jsdoc-baseline.json` |

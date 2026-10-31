# Harness 工程架构审计与补全报告

- 日期：2026-10-27
- 版本：4.19.0（本地工作树）
- 范围：工具集、规则引擎、记忆系统、上下文传递、单次任务处理

## 一、结论摘要

当前插件已经具备工程级底座：AI 客户端有重试/降级/预算保护，EngineRegistry 有完整生命周期，提示词预算与遥测可测。但作为完整 harness 工程，还缺五类核心组件：

1. **工具集**：无 function calling / JSON schema / 结构化输出契约；无统一任务 Runner；无调用账本。
2. **规则引擎**：规则是 markdown 字符串，四条注入路径不一致；无规则 ID、作用域、严重级、机器可校验结果。
3. **记忆系统**：四套上下文/记忆表示无统一接口；co-writer snapshot 不持久化；项目级实例绕过 EngineRegistry 作用域。
4. **上下文传递**：模板变量每步重建；pipeline 与 co-writer 不共享上下文；预算裁剪可能丢关键约束。
5. **一次性任务**：部分功能一次按钮触发多次 AI 调用（消痕 2 次、迭代精修最多 6 次、定向修订最多 3 次）。

本次补全核心 MVP：规则引擎、上下文聚合器、结构化输出契约、单次调用 Runner、调用账本，并把长篇消痕/精修/定向修订切到单次调用。

## 二、工具集维度

### 2.1 现状

- `EngineRegistry` 支持 Singleton / ProjectScoped / Transient、懒加载、失败重试、反向拓扑 dispose、依赖校验。
- `AIEngine` 是统一门面；`AIApiClient` 具备传输级重试、模型回退、截断扩容、续写修复、Prompt 缓存、限流退避、abort 桥接。
- 两个既有聚合先例：合并规划（1 次调用产出 5 个步骤文件）和协同候选批量化（1 次调用产出 3 个候选）。

### 2.2 缺失

| 缺失项 | 影响 | 本轮补全 |
|---|---|---|
| function calling / JSON schema | 结构化输出靠 prompt + 正则，解析失败静默降级 | `structured-output.ts` 契约 + 校验 |
| 统一任务 Runner | 每个入口自己拼 prompt、调用、校验、重试 | `single-call-runner.ts` |
| 调用账本 | “预计 N 次 AI”与实际网络调用数不一致 | `call-ledger.ts` |
| 输出校验→用户可决策 | postValidation 只警告，不返回结构化违规 | RuleEngine validate |
| 全局调用调度器 | 并发按模型名启发式，无跨任务配额 | 路线图（未实现） |

## 三、规则引擎维度

### 3.1 现状

- 规则来源：项目 `写作规则.md` → 模板 → 硬编码常量。
- 注入路径 4 条：模板变量、知识注入、co-writer PromptBuilder、deai 模板。
- 已有零 AI 校验器：step-validator、BeatVerifier、ConflictDetector、AntiAIDetector、emotion auditor、连贯性/逻辑/剧情冗余检查。

### 3.2 缺失

- 无规则对象：没有规则 ID、作用域、严重级、来源、可执行 validator。
- deai 路径曾用占位符代替真实写作规则。
- 无统一 `【创作约束】` 注入块，容易出现重复注入或漏注入。

### 3.3 本轮补全

`engine/harness/rule-engine.ts`：

- `Rule { id, mode, scope, severity, source, promptText, validate? }`。
- `compile()` 把写作规则、模式约束、反 AI 约束、领域规则合成统一注入块，并去重。
- `validate()` 输出结构化违规（`{ruleId, severity, message}`），不再只产生字符串警告。
- 内置长篇 body 最小字数与“禁止元文本”规则。

## 四、记忆系统维度

### 4.1 现状

- `ContextManager.gatherAll` 聚合 12 个项目级任务 + 4 个章节级任务，双层缓存与增量更新。
- 事实索引（pending→confirm）、长期记忆、跨卷快照、关系状态、伏笔、承诺账本、时间线、章节快照均已有持久化。
- co-writer 有 ContextSnapshot、角色灵魂、指纹、知识库向量、记忆碎片。

### 4.2 缺失

- 四套表示无统一接口：GatheredContext / ContextSnapshot / FactIndex / ChapterSnapshot。
- co-writer snapshot 每次重建；session store 由 UI 懒注册。
- StyleLearner / FactIndex / repository 实例绕过 registry 项目作用域。

### 4.3 本轮补全

`engine/harness/context-aggregator.ts`：

- `ContextFragment { key, title, content, priority, maxChars }`。
- 同一任务内去重、排序、裁剪，输出 `AggregatedContext`。
- 60 秒任务级缓存；`invalidate(projectId)` 支持文件变更后失效。
- 不强行合并 pipeline 与 co-writer 的可变状态，只提供统一读取/组装层。

路线图：把 FactIndexManager / StyleLearner / repository 迁回 EngineRegistry ProjectScoped；co-writer snapshot 持久化。

## 五、上下文传递维度

### 5.1 现状

- 长篇步骤通过 `buildTemplateVars()` + `fillTemplate` + `fitPromptToContext`。
- co-writer 通过 PromptBuilder 优先级 sections。
- `shared/prompt-budget.ts` 是成熟预算机器。

### 5.2 缺失

- `buildTemplateVars` 每步、每章重复执行。
- 预算裁剪先丢 `extraTail`，风格/知识层可能消失。
- 无统一“上下文包”抽象。

### 5.3 本轮补全

`ContextAggregator` 成为上下文包抽象；后续 step-runner 与 co-writer 的碎片注入应统一走该层（路线图）。

## 六、一次性任务维度

### 6.1 现状调用数

| 功能 | 旧调用数 |
|---|---|
| 章节规划 | 5（或合并 1 + 回退多次） |
| 一键成章 | 约 4 |
| 批量写章 | 每章约 7 |
| AI 消痕 | 2 |
| 迭代精修 | 最多 6 |
| 定向修订 | 最多 3 |
| 协同候选 | 1（批量）或 3（并行） |

### 6.2 本轮改造

| 功能 | 新调用数 | 实现 |
|---|---|---|
| AI 消痕 | 1 | `long-novel-tasks.deai()`，输出 `{issues, rewritten, selfCheck}` |
| 迭代精修 | 1 | `long-novel-tasks.refine()`，输出 `{issues, polished, selfCheck}` |
| 定向修订 | 1 | `long-novel-tasks.targetedRevision()`，输出 `{dimensions, body}` |
| 章节规划 | 1（合并规划已是既有能力） | 路线图：移除隐藏分步回退，改为显式功能 |
| 批量写章 | 约每章 4（路线图） | 使用合并规划；批量本身是多章编排 |

### 6.3 Single Call Runner 契约

```text
一次逻辑调用
  ├─ ContextAggregator 提供上下文包
  ├─ RuleEngine 注入统一约束
  ├─ AIEngine.callAI 执行一次主调用
  ├─ structured-output 解析并校验
  ├─ RuleEngine.validate 输出结构化违规
  └─ CallLedger 记录 logicalCalls=1 与 networkCalls
```

- 本地校验失败不自动二次调用；返回结构化错误由用户重跑。
- 传输层重试/续写仍由 AI 客户端承担，但账本会区分。

## 七、三域隔离补全

- 新增 `domains/kernel/project-locator.ts`：`长篇小说/短篇小说/剧本` 三库。
- 长篇创建弹窗移除短篇/剧本字段与分支；新长篇项目写入 `长篇小说/`。
- 短篇/剧本创建由 `domains/kernel/domain-project-factory.ts` 承担，写入各自模式库。
- 工具目录拆分：`domains/long/tool-catalog.ts`、`domains/short/tool-catalog.ts`、`domains/script/tool-catalog.ts`。
- 长篇工具目录不再包含短篇/剧本入口。
- `detectProjects`、`getActiveProject`、导出项目列表、批量项目解析支持模式库路径。
- 迁移服务：`engine/project-migration-service.ts`，设置页新增「项目库迁移」。
- 静态隔离测试：`tests/unit/architecture/domain-isolation.test.ts`。

## 八、剩余路线图

1. 把 `buildTemplateVars` 接入 ContextAggregator 缓存。
2. 合并规划失败改为显式“分步规划”功能，不再自动多次调用。
3. 批量写章默认使用合并规划，减少每章调用数。
4. co-writer snapshot 持久化，session store 注册进 EngineRegistry。
5. StyleLearner / FactIndexManager / repository 迁回 ProjectScoped。
6. 预算裁剪规则与 harness 规则严重级联动，must 规则不裁剪。
7. 全局调用调度器：跨任务并发与 token 配额。

## 九、验收

- 三类项目分别落在三个模式库，目录互不交叉。
- 长篇工具无短篇/剧本入口；静态测试通过。
- 消痕/精修/定向修订均一次逻辑调用完成，账本可验证。
- `typecheck` / `lint` / `test` / `preflight` / `build` / `check:release` 全绿。

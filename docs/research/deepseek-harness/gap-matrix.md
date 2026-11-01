# 差距矩阵：本地 Harness vs dsh

> 证据行号以 2026-11-01 工作树为准。决定：采纳 / 延后 / 拒绝。

| # | 本地缺口 | 证据 | dsh 对应机制 | 决定 | 批次 |
|---|---|---|---|---|---|
| 1 | 适配器失败直接结束回合，无重试/修复 | `engine/agent/harness/agent-loop.ts:297-309`；`agent-adapter.ts:48-55` | 请求由日志派生并冻结，重试不重复装配；工具失败是结果不是回合失败 | 采纳 | C3 |
| 2 | 无 provider 用量/token 记账；`modelCalls` 每回合只 +1 | `harness-types.ts:92-101`；`harness-engine.ts:381`；压缩调用未计数 `:256` | 每步/每工具指标与用量 | 采纳 | C4 |
| 3 | 回合内无输入预算；投影固定 24 轮 | `session-log.ts:85`；`harness-engine.ts:271,396-402` | 窗口比例压缩 + headroom + 溢出恢复 | 采纳 | C3 |
| 4 | 单次只允许一个工具，无并发 | `prompt-sections.ts:126`；`agent-loop.ts:114-119,363-364` | 并发安全分类 + 有界并发池，按模型顺序记录 | 延后（协议需从单 tool 改为 tools 数组，风险另立） | — |
| 5 | 结构化 `data` 声明了但被丢弃 | `harness-types.ts:45-51`；`agent-loop.ts:383-396` | 规范输出 schema + 结果/展示分离 | 采纳 | C1 |
| 6 | 审批只覆盖 `run_command`；写工具直接执行 | `host-tools.ts:782-799,818-822,192,278,354`；`agent-loop.ts:347-353` | 每工具审批，缺省拒绝（fail-closed） | 采纳 | C2 |
| 7 | 重复守卫只比对上一次调用，A-B-A-B 可绕过 | `agent-loop.ts:340-353` | 回合级调用记录与守卫 | 采纳 | C2 |
| 8 | signal 传不到工具体；无超时的工具无法中断 | `tool-registry.ts:101-110`；`host-tools.ts` 未读 `ctx.signal`；`agent-types.ts:234` | 取消贯穿执行链 | 采纳 | C4 |
| 9 | 事件无时间戳；工具无耗时 | `harness-types.ts:17-25`；`harness-engine.ts:392` | 每步/每工具时序指标 | 采纳 | C1/C4 |
| 10 | Agent 固定模型/温度/2500 tokens/`bypassCache` | `ui/agent-workbench-view.ts:891-897`；`agent-loop.ts:76-78` | 模型选择与缓存策略可配置 | 采纳 | C2 |
| 11 | 两套运行时：11 步直连 AIEngine，单调用 Runner 只用于修订 | `step-runner.ts:1041-1065,647-664` | 统一 step 管线 | 延后（Wave B 的结算/管线收敛） | — |
| 12 | 会话每次落整份快照，512KB 后截断 | `ui/services/agent-session-store.ts:19-21,76-82` | 事件增量 + 版本化日志 | 采纳（先做追加式事件 + 兼容读） | C1 |
| 13 | 压缩摘要伪装成 `user_message` 前缀，靠字符串过滤 | `session-log.ts:197-205`；`harness-engine.ts:355-360` | 独立摘要事件类型 | 采纳 | C1 |
| 14 | 无 Agent 轨迹/评测集；只有散文质量基准 | `tests/benchmark/**`；`tests/unit/engine/agent-*` | 无官方评测框架；仓库仅有运行时基准 | 部分采纳：C 批次补固定轨迹回归用例，不做评分框架 | C |
| 15 | 参数校验非 schema 级：无 string 类型、未知键、数组元素校验 | `tool-registry.ts:147-169` | JSON Schema 工具定义与允许集 | 采纳 | C2 |

## 验收口径

- #1/#3：超窗口场景必须在调用前裁剪并给出可见原因；失败可重试一次，重试不重复装配。
- #2/#9：遥测能回答「本回合调了几次模型、每个工具耗时、压缩几次、是否命中缓存（若 provider 返回）」。
- #5/#13/#12：任意时刻模型可见内容都能从事件日志重建；旧快照可读。
- #6/#7：`dangerous` 工具无审批一律拒绝；A-B-A-B 写调用在第二次即拦截。
- #8：取消后长工具在超时/检查点退出，不吞掉用户操作。
- #15：类型错误/未知键在注册表层拒绝，并回填给模型。

## 与 Wave A 的关系

Wave A（Batch B）是**正确性前置**：章节路径、表格解析、结算状态、字数口径、凭据展示。Harness 改造依赖这些共享契约（例如工具结果里的章节状态、字数统计），因此先做 B 再做 C。

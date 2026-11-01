# dsh 可选后端：设计与边界

> 状态：设计稿（Batch D 开工前先做 D0 spike 验证协议；未验证项不得写成事实）

## 1. 目标

给 Agent 工作台增加一个**显式开启**的后端：用 DeepSeek Harness 作为外部 agent runtime，同时保持：

- 默认后端仍是 native（零外部依赖，移动端可用）；
- dsh 路径仅桌面端、opt-in、默认全 vault **只读**；
- 任何写入 vault 的操作必须逐次批准；
- 不自动安装 dsh，不上传会话日志，不把密钥写入 vault。

## 2. 已知事实（来自 `sources.json`）

- 启动：`npx @deepseek-ai/dsh web`；profile 选择支持 `dsh --profile <name>` 或 `dsh <name>`；profile 列表 `web / headless / sdk / sdk-minimal / acp`。
- `headless`：一次性运行、无服务器；`sdk`：SDK JSON-RPC server；`acp`：automation-only ACP server。
- Harness home 由 `DSH_HOME` 指定；会话日志 `session.jsonl[.zstd]`（v0）与 `session.vN.jsonl[.zstd]`（v1+）。
- 配置层：profile bundles → `cordis.patch.yml` → home patch → `--patch` 覆盖。
- developer preview，可能有破坏性变更。

## 3. 未验证项（D0 spike 必须回答）

| 问题 | 影响 | 验证方式 |
|---|---|---|
| SDK profile 的传输方式（stdio/HTTP/WebSocket）、端口与握手 | 决定传输层实现 | 启动 `dsh --profile sdk`，观察 stdout/端口；查 SDK 包文档与类型 |
| 创建会话 / 发送消息 / 流式事件 / 取消 的请求与事件形状 | 决定 `dsh-backend` 映射 | 用最小脚本连一次，记录请求-响应样本 |
| 模型/密钥配置：配置文件键、环境变量、是否支持仅 env | 决定密钥注入方式 | 用临时 `DSH_HOME` 跑一次真实调用；确认不落 vault |
| `sdk-minimal` 是否更适合嵌入 | 体积/权限面 | 对比两个 profile 的启动时间与暴露的 API |
| 是否会默认上传会话日志（`dsh_session_log`） | 隐私红线 | 查配置默认值；抓本地请求目标；如默认开启，强制关闭并记录 |
| Electron renderer 内 spawn 的限制 | 可行性 | 在插件内最小 PoC（Node child_process 已可用） |

**若 SDK 与 headless 都不可用**：只交付“检测到 dsh 但当前版本不支持”的明确提示与文档，不实现假接入。

## 4. 架构

```
AgentWorkbench (UI)
  └─ HarnessBackend 选择（设置项 agentBackend: native | dsh）
       ├─ native: 现有 AgentHarnessEngine（默认）
       └─ dsh: DshBackend
             ├─ DshTransport   ← child_process.spawn + JSON-RPC/行事件
             ├─ DshEventMapper ← dsh 事件 → HarnessTurnOutcome / 遥测
             └─ DshApprovalBridge ← dsh 写操作请求 → 插件确认 Modal（逐次）
```

- **进程**：按会话启动一个 dsh 进程；空闲超时退出；崩溃后不自动重启（避免死循环），UI 给重试。
- **Home**：`<pluginDir>/data/dsh/`（不进 vault、不同步）；`DSH_HOME` 指向它。
- **Workspace**：用户选择开启时确认；默认 **vault 根只读**（可读全部笔记，便于跨书引用）。
- **写入**：dsh 的写意图/审批请求映射到插件 Modal；拒绝即返回拒绝结果，不降级为直接写。
- **密钥**：运行时从 settings 解密后经 env 注入子进程；不写 `cordis.patch.yml`，不落日志。
- **会话日志**：只存在 `DSH_HOME`；插件不读取/不上传；关闭任何日志上传扩展。

## 5. 设置与 UI

新增设置（默认值）：

- `agentBackend: 'native' | 'dsh'` = `native`
- `dshProfile: 'sdk' | 'sdk-minimal' | 'headless'` = `sdk`（spike 后定）
- `dshCommand: string` = `npx @deepseek-ai/dsh`（可改为本地路径）
- `dshHome`（只读展示）= `<pluginDir>/data/dsh`
- 健康检查按钮：显示版本、profile、home、workspace、只读状态、最近错误

工作台：标题栏显示「后端：native/dsh」；dsh 未安装/版本不符/移动端时禁用入口并说明原因。

## 6. 安全与隐私

- 默认只读；写入逐次批准；拒绝后不重试。
- 不自动安装、不自动升级 dsh；不执行用户未确认的命令。
- 不开启会话日志上传；文档与 UI 明示 dsh 默认行为及本项目的关闭方式。
- 子进程环境变量最小化：只注入模型/密钥/home 所需项（具体清单 spike 确定）。
- 失败关闭：协议不识别、事件缺失、审批不可用 → 终止该回合并提示，不猜测。

## 7. 测试与门禁

- 单测：fake transport（会话、流式事件、取消、进程退出、超时）；事件映射契约；审批拒绝路径。
- 门禁 `scripts/check-dsh-isolation.mjs`：`child_process` 只允许出现在 `engine/agent/dsh/**`，且必须动态 `import()`（禁止顶层引入，保证移动端与默认路径零影响）。
- E2E：`DSH_E2E=1` 时跑「只读问答 + 写操作被拒」；未配置时 skip，不假通过。
- 手工：无二进制、版本不符、断网、拒绝审批、关闭开关回落 native 五条路径。

## 8. 回滚

- 设置切回 `native` 即完全绕过 dsh；dsh 模块不参与打包主路径（动态导入）。
- 若上游协议变更导致不可用：保留健康检查与错误提示，关闭入口，不影响 native。

---

## 9. D0 Spike 结果（2026-11-01，npm registry 实查）

| 项 | 结论 | 依据 |
|---|---|---|
| npm 包 | `@deepseek-ai/dsh@0.2.1-rc.5`，bin `dsh`；依赖树包含 `dsh-base`、`dsh-sdk-app`、`dsh-tool-bash/pwsh/fs`、`node-addon-require-builtin` 等 | `npm view` |
| SDK profile | `@deepseek-ai/dsh-sdk-app`：**newline-delimited JSON-RPC 2.0 over stdio**；stdout 仅协议帧 | 包 README |
| 协议方法 | `initialize {cwd, provider, model, maxTokens?}`、`session/prompt {sessionId, contentBlocks}` → `{messageId}`、`shutdown` | `dsh-sdk-protocol` types |
| 通知 | `session.event`（完整 SessionEvent 信封：`assistant/message`、`tool/call`、`tool/result`…）、`session.status`（`running/idle`）、`subagent.*` | 同上 |
| 关键缺失 | **没有 cancel、没有 per-session close、没有审批通道**；取消只能杀进程 | 协议 README 明示 |
| Sandbox | `dsh-sandbox-policy` 配置 `mode: read-only / workspace-write / danger-full-access` + `workspaceRoot`；通过 `--patch` 覆盖 | `dsh-sandbox` README |
| 会话存储 | `DSH_HOME` 下的 `session.jsonl[.zstd]`；工作目录由 `initialize.cwd` 决定 | `dsh-base` / 架构文档 |

### 对设计的修正

1. **「写入逐次批准」在 SDK 协议下不可实现**：没有审批请求/响应通道。可行方案只有：
   - 默认 `read-only`（写入被 sandbox 拒绝，fail-closed）；
   - 用户在**启动前**显式选择 `workspace-write`（等于整会话放开，不是逐次）；
   - 若坚持逐次批准，只能等上游提供 approval 通道，或不用 dsh 后端。
2. **取消 = 杀进程**：无 cancel 方法；插件侧把「停止」映射为 kill，并在下一次消息时用同一 `sessionId` 恢复（依赖 DSH_HOME 持久化）。
3. **模型/密钥**：`initialize` 只带 provider/model；密钥来源上游文档未明确，当前按 `DEEPSEEK_API_KEY` 环境变量注入（best-effort，需真实环境验证）。
4. 由于 1，本次只交付**内核 + 隔离门禁 + 健康检查基础**；在工作台正式启用 dsh 前后端之前，必须先确定「整会话放开写入」是否可接受。

### 已交付（Batch D 内核）

- `engine/agent/dsh/dsh-protocol.ts`：stdio JSON-RPC 客户端（超时/错误/坏行/关闭）
- `engine/agent/dsh/dsh-session.ts`：initialize/prompt/事件映射/idle 等待/close=kill
- `engine/agent/dsh/dsh-launch.ts`：启动参数、DSH_HOME、最小 env、sandbox patch
- `engine/agent/dsh/dsh-process.ts`：动态 import `node:child_process`，桌面端限定
- `scripts/check-dsh-isolation.mjs`：child_process 仅限该目录且必须动态加载；native harness 不得反向依赖
- 单测 9 条（协议/会话/启动参数），不联网

### 待决策（启用前必须回答）

- 是否接受「dsh 后端整会话 workspace-write」作为唯一的写入方式？若不接受，dsh 后端只能只读问答。
- 是否接受 dsh 的完整依赖树（含 bash/pwsh 工具）随用户手动安装？
- 真实环境验证：`DEEPSEEK_API_KEY` 是否被 dsh 的 provider 采纳、`--patch` 覆盖是否生效。

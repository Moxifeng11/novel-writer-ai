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

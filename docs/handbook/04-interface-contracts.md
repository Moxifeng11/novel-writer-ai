# 04 · 接口与数据契约

> 目的：把「谁能改、改了会破坏谁」说清楚。公开面只增不改；内部面可重构但必须走评审。
> 签名参考见 [../API.md](../API.md)；本文件定规则，不逐个列签名。

---

## 1. 稳定性分级

| 级别 | 范围 | 兼容承诺 | 改动要求 |
|---|---|---|---|
| **公开契约** | `plugin-api.ts` 导出的类型/字段、命令 ID、事件名、frontmatter 字段、设置键、对外文件路径 | 只增不改；废弃需保留至少一个 minor 并给迁移说明 | 更新本文 + `@deprecated` + CHANGELOG |
| **内部契约** | engine 子域之间的方法、services 对 engine 的调用、UI 对 engine 的调用 | 可重构 | 同 PR 改调用方 + 测试 |
| **实现细节** | 私有方法、内部类型、临时缓存结构 | 不承诺 | 无 |

## 2. 公开面清单

### 2.1 类型门面

- 文件：`plugin-api.ts`。
- 只放跨层需要的接口（Provider、Settings 视图、Engine 能力），不放实现。
- 新增字段必须可选（`?`）或提供默认值；删除字段视为破坏性变更。
- 迁移示例：给旧字段标 `@deprecated`，注释里写替代字段与移除版本。

### 2.2 引擎 token

- 常量在 `shared/engine-names.ts`；消费方通过 `plugin.engineRegistry.get(...)` 或类型化 token 获取。
- 不允许在 UI/服务里写裸字符串 token。
- token 重命名 = 内部重构；必须同 PR 改全部引用，并跑 `check-engines`。

### 2.3 命令

- 前缀固定 `novel-writer-`；ID 使用 kebab-case。
- 三处登记：命令定义、内部注册、命令面板。
- 命令回调必须：
  - 失败有可见反馈；
  - 长任务可取消/有超时；
  - 不在 `running` 时静默吞掉重试（见 `chapter-orchestrator` 相关回归）。
- 新增/改名必须同步：`docs/regression/LINKED-SCENARIOS.md` 的锚点、Agent 工具目录、模式规则。

### 2.4 事件

- 插件内广播统一 `novel-writer:*` 命名（例如 `novel-writer:body-written`）。
- 事件负载只放可序列化的最小信息（路径、统计、状态），不放 TFile/App。
- 新增事件在本文登记「触发点 / 负载 / 消费方」。

### 2.5 设置键

- 声明：`main.ts#NovelWriterSettings`；默认值：`core/settings-service.ts`；迁移：`shared/settings-migrator.ts`。
- 键名 camelCase；同一功能用统一前缀（`dsh*`、`pet*`、`agent*`）。
- 密钥字段必须加密存储、输入框不回填密文（`shared/secret-display.ts`）。
- 删除键必须走迁移，不允许静默丢弃用户配置。

### 2.6 frontmatter 字段

| 字段 | 写入方 | 语义 |
|---|---|---|
| `status` | 结算 / BodyWriter | `pending` / `draft` / `written` / `settled`；结算只升不降 |
| `step_status` | 步骤落盘 | 当前步骤完成态；截断时删除 |
| `word_count` | BodyWriter / 结算 | 正文字数（不含标题行） |
| `卷` / `章` / `标题` | BodyWriter | 章节定位信息 |
| `step_template_id/version`、`step_rules_version/hash` | 步骤编排 | 生成归因 |
| `entity_last_changed_at/chapter` | 结算 | 实体字段溯源 |
| `涉及人物/地点/势力/物品功法` | 结算 | 章节涉及实体 |
| `已知信息/伤势/持有物品` | 结算 | 连续性账本（追加语义） |

- 新字段先在本表登记，再实现写入与读取；不要用同一字段承载两种语义。
- 读取方必须容忍字段缺失（旧数据）。

### 2.7 路径与存储

- 路径一律通过 `shared/paths.ts` 的 `pj*` 函数生成，不手拼字符串。
- 项目列表/项目身份/项目删除一律走 `shared/project-catalog.ts`：`listProjectIds`（列表）、`projectIdFromPath`（路径推断）、`isProjectDirectory`（身份判据）、`projectIdentityExists`（写入前防复活）、`removeProjectDirectory`（删除）；历史 `listProjects` / `detectProjects` 已改为委托，禁止新增第二套扫描。
- 插件数据目录与 vault 内容分离；会话/缓存不得写入用户正文目录。
- 配置目录/点开头隐藏目录不在 vault 索引内时，使用 `writeVaultText` 的分流或显式 `adapter` 并注明理由。

### 2.8 Agent 工具权限面

- 内置 Harness 的宿主工具在 `engine/agent/harness/host-tools.ts`，权限声明在 `sideEffect`：
  - `none`：只读；
  - `write`：写文件/移动文件（默认放行，重复调用会被拦截）；
  - `dangerous`：删除项目/删除文件/批量命令（必须用户确认，未提供确认端口一律拒绝）。
- 写类工具（`sideEffect: 'write'`）：`create_long_project`、`create_short_project`、`create_script_project`、`write_file`、`move_file`；危险类（`sideEffect: 'dangerous'`，必须用户确认）：`delete_file`、`delete_project`、`run_command`。写正文仍优先走写作命令，避免绕过 `BodyWriter` 的 frontmatter/格式契约。
- 工具执行后必须同步 `AgentContext.projects`；项目删除走 `delete_project` 时由工具本身刷新，其他视图删除由 Agent 工作台的 vault 事件刷新。
- 新增/删除工具必须同步本节与 `tests/unit/engine/harness/host-tools-guard.test.ts`。

### 2.9 外部接口

- AI 端点、模型能力、协议（OpenAI/Anthropic/DeepSeek）在 `engine/ai-api-client.ts` 与 `shared/model-*` 收口。
- 新增供应商/协议必须补请求契约测试（参考 `tests/unit/engine/embedding-provider-contract.test.ts`）。
- dsh 协议事实以 `docs/research/deepseek-harness/` 为准；代码改动需过 `check:dsh-isolation`。

---

## 3. 错误与异步约定

| 场景 | 约定 |
|---|---|
| 用户可感知的失败 | 必须 `Notice`/`showError`/`setAiStatus` + 日志；不允许空 catch |
| 可重试失败 | `warn` + 重试计数；不得被 `running` 守卫短路 |
| 可降级失败 | `warn` + 明确降级去向（默认值/跳过/本地模型） |
| Promise | 不使用裸 `void promise`；至少 `.catch` 或 `// silent-ok:` 说明 |
| 取消 | 长任务提供 `AbortSignal` 或显式 `cancel()`；取消后恢复 UI 状态 |
| 超时 | 有上限并给出可读错误；不要无限等待 |

---

## 4. 兼容与废弃

1. 破坏性变更必须升 minor（或按 semver 约定），并在 `docs/releases/` 写明迁移步骤。
2. 旧字段/旧命令至少保留一个 minor；用 `@deprecated` 标注替代方案。
3. 迁移代码必须幂等，重复执行不重复改写。
4. 删除公开面前先搜索全仓引用与文档锚点（`check:linked-scenarios` 会拦一部分）。

---

## 5. 契约变更检查表

- [ ] 是否影响公开面？若是，本文已更新。
- [ ] 是否影响命令/事件/frontmatter？若是，`docs/regression/LINKED-SCENARIOS.md` 已更新。
- [ ] 是否影响设置？三处（接口/默认值/迁移）已改。
- [ ] 是否影响 Agent 工具/模式规则？已同步。
- [ ] 是否有回归测试覆盖旧数据/旧配置？
- [ ] `@deprecated` 是否给出替代与移除版本？

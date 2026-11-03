# 02 · 架构与边界

> 本文只给「唯一可执行口径」与「目标口径」的差异；深度内容见 [../ARCHITECTURE.md](../ARCHITECTURE.md)。
> 可执行口径以 `scripts/check-dependencies.mjs` 为准，文档不得另行定义第四种分层。

---

## 1. 分层（check:deps 实际执行）

| 层 | 目录 | 允许依赖 | 说明 |
|---|---|---|---|
| UI | `ui/` | `engine/`、`services/`、`shared/`、`core/` | 视图、Modal、设置面板 |
| Engine | `engine/` | `services/`、`shared/`、`core/`、`engine/repository/` | 业务引擎；`repository` 是 engine 子目录，不是独立层 |
| Services | `services/` | `shared/`、`core/` | 跨引擎协调（Worker、版本、规则、统计） |
| Shared | `shared/` | 仅 `shared/` | 跨层原语（路径、锁、端口、纯函数） |
| Core | `core/` | 仅 `shared/` | 插件级单例服务（设置、命令注册、缓存等） |

- `import type` 不计入分层与成环（编译后擦除）。
- 运行时循环依赖单独检查（`.arch-baseline.json` 的 `dependencyCycles`）。
- 门禁是**棘轮**：新增违规失败，存量只允许减少。

### 目标口径（比门禁更严，尚未全部可执行）

```text
UI → Facade(ui/services) → Engine → Repository(engine/repository) → Infrastructure(shared + services)
```

- UI 不应直接访问 Engine 内部实现或 Repository；
- Engine 不应直接 import `obsidian`（应通过 `shared/file-system-port` 等端口）；
- 现状：UI 直连 `app.vault`、部分 Engine 直接 import `obsidian` 仍存在，**不计入门禁**。新人按目标口径写新代码，不要照抄历史例外。

### 门禁未覆盖的区域

| 区域 | 现状 | 约束来源 |
|---|---|---|
| `domains/` | 三域（长篇/短篇/剧本）+ kernel | `tests/unit/architecture/domain-isolation.test.ts` 等源码扫描测试 |
| 根级 `main.ts` / `plugin-api.ts` | 组合根与类型门面 | 人工评审 + 类型检查 |
| `workers/` | 2 个构建产物 | 无分层门禁 |
| `utils/helpers.ts` | 历史工具 | 人工评审 |

---

## 2. 启动与入口

```text
Obsidian onload
  └─ main.ts#onload
      ├─ SettingsService.loadSettings()         # 设置迁移与解密
      ├─ EngineRegistry.initialize()            # 分阶段注册/初始化引擎
      ├─ 命令注册（命令定义 + 内部注册 + 命令面板）
      ├─ 视图注册（FullWriter / CoWrite / KnowledgeBase / AgentWorkbench …）
      ├─ 设置页注册
      └─ 后台任务（写作统计、宠物、更新检查、模板自举）
```

关键入口：

| 文件 | 职责 |
|---|---|
| `main.ts` | 插件生命周期、命令/视图/设置注册、`engineRegistry` 暴露 |
| `plugin-api.ts` | Engine 与 UI 之间唯一显式类型契约（类型层，不是运行时门面） |
| `engine/engine-registry.ts` | 引擎注册、懒加载、作用域（singleton/project/transient）、Dispose |
| `shared/engine-names.ts` | 引擎 token 常量（避免字符串散落） |
| `domains/kernel/` | 三域元数据、项目定位、工具目录过滤 |

---

## 3. 数据流与写入不变量

```text
UI 事件/命令
  └─ Engine 方法
      ├─ 读：FileSystemPort / FrontmatterPort / VaultMetaPort
      └─ 写：withWriteLock(path) → processFrontmatter / vault.modify / BodyWriter
                    └─ SettlementJournal / 版本备份（失败可回滚）
```

必须遵守的不变量：

1. **正文只有一个写入入口**：`engine/body-writer.ts`。新入口必须复用它，不要直接 `vault.modify` 正文。
2. **同一路径的读-改-写必须同锁**：`shared/write-lock.ts#withWriteLock`；快照读与写入不能分处锁内外。
3. **结算可回滚**：写入前记录 journal（整文件/字段/追加），失败置 `hasPartialFailure` 并按逆序恢复。
4. **幂等**：重复结算/重复生成不得重复追加（按章名/内容去重）。
5. **设置唯一源**：`main.ts#NovelWriterSettings` + `core/settings-service.ts` 默认值 + `shared/settings-migrator.ts` 迁移；不要在模块里私存配置。
6. **进度唯一源**：`docs/progress/program-status.json`，报告由 `program:render` 生成。
7. **项目发现唯一源**：`shared/project-catalog.ts#listProjectIds`。UI/Engine 不得再自己遍历 `vault.getRoot().children` 判断项目；项目身份只认 `作品信息.md`、`世界观总览.md`、`00-系统模板`、`01-世界架构`、`.project` 等标志，**不认**单独的 `03-大纲与章节`（删除残留会被它复活）。

---

## 4. 模块地图（按职责）

| 目录 | 代表文件 | 职责 |
|---|---|---|
| `engine/repository/` | `chapter-repository` 等 | 数据访问封装 |
| `engine/agent/` | `agent-harness-engine`、`dsh/*` | Agent 运行时与外部后端 |
| `engine/prompts/` | `body-v{2,3,4}-prompts`、`prompt-registry` | 提示词与版本归因 |
| `engine/settlement/` + `settlement-engine.ts` | 结算、回滚、账本 | 结算主链 |
| `engine/context/` / `context-manager.ts` | 上下文装配、体检、预算 | 注入链 |
| `engine/quality/` | 质控与闸门 | 质量闭环 |
| `engine/style/`、`engine/embedding/` | 风格/向量 | RAG 与风格 |
| `services/` | `rules-service`、`chapter-version-service`、`worker-manager` | 跨引擎协调 |
| `shared/` | `project-catalog`、`paths`、`file-system-port`、`write-lock`、`versioned-registry` | 跨层原语；项目发现/删除唯一入口 |
| `core/` | `settings-service`、`command-registry`、`plugin-cache` | 插件级基础设施 |
| `ui/` | `full-writer-view`、`co-writing-view`、`agent-workbench-view` | 视图与交互 |

---

## 5. 新增代码的决策顺序

1. 这段逻辑是否只服务一个引擎？→ 放该引擎内部。
2. 是否被两个以上引擎/层使用？→ 放 `shared/`（必须是平台无关）。
3. 是否需要跨引擎协调/持有 Worker/缓存？→ 放 `services/`。
4. 是否是插件级单例/生命周期？→ 放 `core/`，通过 EngineRegistry 或现有单例访问。
5. 是否只是 UI 编排？→ 放 `ui/`，不要反向依赖。

具体检查表见 [03-module-development.md](03-module-development.md)。

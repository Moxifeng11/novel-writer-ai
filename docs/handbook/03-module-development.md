# 03 · 模块开发标准

> 目标：新增模块时不再靠口口相传。按本清单逐项打勾即可。
> 深度步骤（Repository/Store/流式/缓存）见 [../DEVELOPMENT.md](../DEVELOPMENT.md)。

---

## 0. 开工前

- [ ] 确认工作树干净（`git status`），没有其他工具同时写仓库。
- [ ] 确认改动属于哪个层（见 [02-architecture.md](02-architecture.md)）。
- [ ] 搜索是否已有同类实现（`docs/generated/code-index.md`、`rg "关键词"`）。
- [ ] 明确「唯一写入入口」与「是否需要回滚/幂等」。

## 1. 放置与依赖

| 模块类型 | 位置 | 允许依赖 |
|---|---|---|
| 平台无关纯函数 | `shared/` | 仅 `shared/` |
| 插件级单例/基础设施 | `core/` | `shared/` |
| 跨引擎协调/Worker/缓存 | `services/` | `shared/`、`core/` |
| 业务引擎 | `engine/<子域>/` | `services/`、`shared/`、`core/` |
| 视图/Modal/设置面板 | `ui/` | `engine/`、`services/`、`shared/`、`core/` |

- 禁止 `shared → engine`、`services → engine`、`core → services/engine`。
- 跨层只传接口/纯数据，不传 Obsidian 的 `App`（除非该层本身就是 UI/适配器）。

## 2. 注册与生命周期

- [ ] 新引擎/服务类名以 `Engine`/`Manager`/`Service`/`Store` 结尾时，**必须**通过 `EngineRegistry` 注册，或在 `.engine-registry-whitelist.json` 登记例外（`check-engines` 会拦）。
- [ ] token 从 `shared/engine-names.ts` 引入，不写裸字符串。
- [ ] 明确作用域：
  - `singleton`：全插件一个实例；
  - `project`：按项目隔离，切项目时 dispose；
  - `transient`：每次取新实例，调用方负责释放。
- [ ] 需要清理的资源（定时器、Worker、子进程、监听器）实现 `dispose()`。

## 3. 设置项

新增设置必须同时改三处：

1. `main.ts` 的 `NovelWriterSettings` 接口（字段 + 注释 + 默认语义）。
2. `core/settings-service.ts` 的默认值。
3. `shared/settings-migrator.ts` 的迁移（如涉及旧字段/默认值变化）。

- [ ] 设置键名使用既有命名风格（camelCase；分组前缀如 `dsh*`、`pet*`）。
- [ ] 涉及密钥的字段必须走加密/脱敏（`core/crypto-service.ts`、`shared/secret-display.ts`）。
- [ ] 在设置页加入控件，并在 `ui/settings/` 对应 section 注册。

## 4. 命令与入口

新增命令需要三处登记（缺一不可）：

- [ ] 命令定义（`core/command-definitions` 或对应注册表）；
- [ ] 内部注册（`core/command-registry`）；
- [ ] 命令面板可见性/回调（`main.ts` 或 `core/command-ui-executor`）。

- 命令 ID 统一 `novel-writer-*` 前缀。
- 命令回调必须处理失败并给出可见反馈（`check:silent-failures`）。
- 若命令进入 Agent 工具目录，同步 `domains/kernel/tool-catalog-*` 与 `command-mode-rules`。

## 5. 写入路径

- [ ] 正文写入只能走 `engine/body-writer.ts`。
- [ ] 同路径读-改-写包在 `shared/write-lock.ts#withWriteLock` 内（快照与写入同锁）。
- [ ] 结算类写入先记 `SettlementJournal`（整文件/字段/追加），失败置 `hasPartialFailure`。
- [ ] 重复执行必须幂等（按章名/内容哈希/结构化键去重）。
- [ ] 覆盖用户内容前备份（参考 `BodyWriter.backupBeforeOverwrite`、`ChapterVersionService`）。
- [ ] 不要用 `vault.adapter.write` 写索引内 `.md`；用 `shared/file-system-port.ts#writeVaultText`。

## 6. 错误与异步

- [ ] 用户操作型 `catch` 必须有可见反馈（`Notice`/`showError`/`setAiStatus`），或显式 `// silent-ok:` 说明。
- [ ] 可重试错误不要被 `running` 守卫短路；不可重试错误只跑一次。
- [ ] 长任务要有取消/超时路径，并在 UI 恢复按钮状态。
- [ ] 不要吞掉 Promise（`void` 只能用于明确的 fire-and-forget，并自带 catch）。

## 7. 测试

- [ ] 纯逻辑：`tests/unit/<layer>/<module>.test.ts`，用中文行为句命名。
- [ ] 跨模块：`tests/integration/`。
- [ ] 写入/回滚/并发：必须有回归用例（参考 `settlement-engine-behavior.test.ts`、`body-writer-concurrent-write.test.ts`）。
- [ ] 架构约束：必要时加源码扫描测试（参考 `tests/unit/architecture/domain-isolation.test.ts`）。
- [ ] 覆盖率不得低于 `vitest.config.ts` 的阈值；新代码优先增量覆盖。

## 8. 注释与文档

- [ ] 文件头四段式（职责/背景或事故背景/不变量/使用方式），见 [09-comment-standard.md](09-comment-standard.md)。
- [ ] 所有导出声明有 JSDoc；公开方法有 `@param`/`@returns`/`@throws`。
- [ ] 跨模块入口/纯函数库有 `@example`（白名单与门禁见 [09-comment-standard.md](09-comment-standard.md#7-门禁如何判定)）。
- [ ] 新增模块登记到 `docs/generated/code-index.md`（自动生成）。
- [ ] 若改变公开契约（命令/事件/frontmatter/设置键），更新 [04-interface-contracts.md](04-interface-contracts.md)。

## 9. 收尾门禁

```bash
npm run typecheck
npm run test -- <相关测试文件>
npm run check:deps -- --baseline .arch-baseline.json
npm run check:jsdoc
npm run check:docs
npm run preflight
```

- [ ] 生成物（`main.js`/`workers/`）未被加入 git。
- [ ] `CHANGELOG.md` 顶部版本节点已更新（按发布纪律，见 [06-gates-and-release.md](06-gates-and-release.md)）。

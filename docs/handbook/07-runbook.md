# 07 · 故障排查手册（Runbook）

> 原则：先保数据，再恢复功能，最后找根因。任何「覆盖写」前先备份。
> 所有命令都在插件仓执行；日志优先看 Obsidian 开发者控制台（`Ctrl+Shift+I`）。

---

## 1. 启动与加载

| 症状 | 诊断 | 处理 | 预防 |
|---|---|---|---|
| 插件列表里没有「小说工坊 AI」 | `manifest.json` 是否存在、`id` 是否为 `novel-writer-ai`、`main.js` 是否存在 | `npm run build`；检查 `.obsidian/plugins/novel-writer-ai/` 三件套 | CI 的 `check:release` |
| 启用后无反应/命令缺失 | 控制台是否有异常；命令是否注册 | 重载应用；确认 `main.ts#onload` 未提前抛错；`npm run test` | E2E「插件加载与命令注册」 |
| 版本显示旧值 | Obsidian 缓存 | 重载应用；删 `.hotreload`；确认 `manifest.json` | `version:sync` |
| 设置页空白/报错 | 设置迁移失败 | 备份 `data.json`；看迁移日志；必要时回到上一个 schema | `settings-migrator` 单测 |

## 2. 写作规则版本告警

| 症状 | 诊断 | 处理 |
|---|---|---|
| 「版本号相同但内容不同」 | 规则文件 frontmatter 的 `version` 与内置是否同版本；`hash` 是否一致 | v4.23.4 起按「剥离 frontmatter 后的正文」算哈希；若仍告警，说明正文确实不同 → 切换版本或补新版本号文件 |
| 「版本号不一致」 | 文件版本落后/自定义变体 | 主干落后才提示同步；自定义后缀（`3.6.0-xxx`）不告警 |
| 同步后内容被覆盖 | 「同步到最新版」会覆盖文件 | 先从 `docs/`/内置常量找回；后续版本会加备份（见遗留项） |

- 相关代码：`shared/versioned-registry.ts`、`services/rules-registry.ts`、`main.ts#_checkRulesVersion`。
- 回归：`tests/unit/shared/versioned-registry.test.ts`、`tests/unit/services/rules-registry.test.ts`。

## 3. 数据与写入

| 症状 | 诊断 | 处理 |
|---|---|---|
| 章节内容丢失/被覆盖 | 是否有备份：`重写备份/`、章节版本、`BodyWriter` 覆盖前备份 | 从备份恢复；检查是否绕过了 `BodyWriter` |
| 结算后字段半更新 | `SettlementJournal` 是否记录了失败；`hasPartialFailure` | 重新结算（幂等）；检查 `entity_last_changed_*` 与 `status` |
| 重复结算产生重复行 | 去重键是否按章名/结构化列 | 修去重逻辑 + 回归用例；手工清理重复行前备份 |
| 项目改名后引用失效 | 路径函数是否走 `shared/paths`；是否用 `writeVaultText` | 重跑迁移；检查 frontmatter 缓存 |
| 写作规则/模板被覆盖 | 是否直接 `vault.modify` | 用 `BodyWriter`/`writeVaultText`；恢复备份 |

数据位置：

- 章节版本：`services/chapter-version-service.ts` 配置的版本目录。
- 覆盖备份：`BodyWriter.backupBeforeOverwrite` 的 `重写备份/`。
- 结算 journal：运行时内存，失败时按条目回滚；不持久化。

## 4. AI / API

| 症状 | 诊断 | 处理 |
|---|---|---|
| 401 / `AUTH` | Key 是否过期、供应商是否选错 | 设置页重新填 Key；确认端点与模型匹配 |
| 429 / `RATE_LIMIT` | 并发/额度 | 降低并发或切换备用模型（`enableAutoModelFallback`） |
| 超时/流中断 | `streamIdleTimeout`、网络 | 重试；检查代理；看控制台请求日志 |
| 模型不存在 | `modelOverrides`/供应商模型列表 | 用「从 URL 拉模型」刷新；选存在的模型 |
| 返回空内容 | 触发空返回重试 | 看执行时间线；检查提示词预算是否把正文裁空 |

密钥安全：不要打印 Key；脱敏逻辑见 `shared/secret-redaction.ts`；E2E 临时 vault 不复制 `data.json`。

## 5. dsh 后端

| 症状 | 诊断 | 处理 |
|---|---|---|
| 健康检查失败 | `npx @deepseek-ai/dsh --version`；Node 20+；Windows 需 ComSpec | 设 `dshCommand`/安装 dsh；看设置页提示 |
| 启动失败（Windows） | `spawn` shim/环境变量 | v4.23.1 起已走 ComSpec 并补平台 env；确认版本 |
| 写入被拒 | sandbox `read-only` | 只读是默认；需整会话 `workspace-write` 并在启动前确认 |
| 进程崩溃/无响应 | 协议无 cancel | 关闭/重启工作台即 kill；会话由 `DSH_HOME` 持久化 |
| 隔离门禁失败 | 非 dsh 目录出现 `child_process` | 改走 `shared/desktop-shell.ts` 的窄接口（见该文件注释） |

## 6. 构建与发布

| 症状 | 处理 |
|---|---|
| `check:templates` 失败 | `npm run gen:templates` 后重新提交 |
| `check:styles` 失败 | 改 `styles-src/` 后 `npm run build:styles`，不要手改根 `styles.css` |
| `check:css` 超预算 | 按页分批降指标；`--update-baseline` 必须写 `note` |
| `check:deps` 新违规 | 修 import 方向或下沉类型；不要改基线放行 |
| `check:release` 失败 | 版本四方不一致/资产缺失/worker 缺失；按输出逐项修 |
| Release 工作流失败 | 看 job 日志；未创建 Release 可修 tag 重推；已创建则发补丁 |

## 7. E2E

| 症状 | 处理 |
|---|---|
| 全 skip（退出 0） | 设置 `OBSIDIAN_PATH`；不要当通过 |
| 启动超时 | 关闭正在运行的 Obsidian；确认 `--user-data-dir` 隔离 |
| 真实链路超时 | 检查 API 额度/网络；先缩到 1 章；确认用的是副本 vault |
| 用例解析失败 | `npx playwright test --list` 先定位语法/导入错误 |

## 8. 事故记录要求

修复线上/数据类问题后，必须在代码里留下：

```ts
/**
 * 事故背景（YYYY-MM-DD）：<触发条件与后果>
 * 不变量：<修复后必须成立的规则>
 * 回归：tests/unit/...（用例路径）
 */
```

并在 `docs/audits/` 或 `docs/releases/` 留一条可追溯记录。

# 上架 Obsidian 社区插件目录

> 目标版本 4.97.1 · 记录时间 2026-11-20 · 维护：DSH

## 一、当前状态：条目已存在，但版本仍在审核（不算上架成功）

插件条目：<https://community.obsidian.md/plugins/novel-writer-ai>（2026-11-20 复核：`62 downloads`、有 4.93–4.96 的版本历史、作者本人认领）。

但**条目存在 ≠ 已上架市场**。判定标准是两条，缺一条都不算成功：

1. 账号页里该版本状态变成「通过 / 已发布」；
2. Obsidian 客户端「设置 → 第三方插件 → 浏览」里能搜到并装到该版本。

2026-11-20 复核第 2 条：客户端读的市场清单 `community-plugins.json`（拉取 3,294,579 字节、**10616 条**）里**没有 `novel-writer-ai`** → 市场侧尚未放出；账号页显示的 4.97.1 处于待审状态。

站点页面（服务端渲染）在审核期就会显示「当前版本 4.97.1」与新 README 文案，容易误判成已发布——**那一页只能证明提交进了系统，不能证明市场已放出**（本条是 2026-11-20 的误判记录，别再复用「页面显示新版本 = 已上架」这个推论）。

审核由 Obsidian 侧执行，代码仓无法推进；能做的是把可能被打回的点先自查掉（见 §四）。

## 一之二、提交流程（官方文档口径）

Obsidian 已**不再**接受 `obsidianmd/obsidian-releases` 的 `community-plugins.json` PR。当前流程（[官方文档](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)）：

1. 打开 [community.obsidian.md](https://community.obsidian.md)，用 **Obsidian 账号**登录（不是 GitHub 账号）。
2. 在个人资料里**关联 GitHub 账号**，目录用它验证仓库归属。
3. 全新仓库才需要「Add a plugin」，填仓库 `Moxifeng11/novel-writer-ai`，目录读默认分支 HEAD 的 `manifest.json`。
4. 提交后走自动审核；目录列出需要改的点，按提示更新仓库并**发一个版本号更高的 Release**。
5. 通过后即可在 Obsidian 内安装（下载的是匹配 `version` 的那个 GitHub Release 的 `main.js` / `manifest.json` / `styles.css`）。

**日常发版不需要再碰目录**：只要 tag 与 `manifest.version` 一致、Release 资产齐全（本仓 `release.yml` 已保证），目录会自动跟进。

### 两个已知细节

- 目录只显示**最新的过审版本**：4.97.0 发布后一小时页面仍停在 4.96.1，随后直接跳到 4.97.1，中间版本不单独出现在页面与 RSS 里，属正常现象。
- 目录条目的**短描述**（显示在 Obsidian 插件浏览器里）仍是上架时那句 157 字符英文 `End-to-end AI writing workspace for Chinese web novels, short stories and scripts: planning, drafting, co-writing, quality checks and knowledge-base deconstruction.`，与 manifest 里 219 字符的新描述不同；想统一需在账号页编辑条目，属可选项。

## 二、提交前清单（按官方要求逐条对照）

| 要求 | 状态 | 证据 |
|---|---|---|
| 根目录有 `README.md`（说明用途与用法） | ✅ | README 含英文 marketplace 摘要、功能、安装、配置、FAQ、数据与安全 |
| 根目录有 `LICENSE` | ✅ | `LICENSE`（MIT） |
| 根目录有 `manifest.json`，且与 HEAD 一致 | ✅ | 4.97.1，`id` = `novel-writer-ai` |
| `id` 全局唯一、不含 `obsidian` | ✅ | id `novel-writer-ai` 不含 `obsidian`；客户端市场清单（10616 条）里尚无同 id |
| `name` 不含 "Obsidian" / "Plugin" 字样 | ✅ | `Novel Writer AI` |
| `description` ≤250 字符、句号结尾、无 emoji、动作句开头 | ✅ | 219 字符，`Write, plan, and polish … and export.` |
| 不以 `fundingUrl` 链接非资助服务 | ✅ | manifest 无 `fundingUrl` |
| 用了 Node/Electron API 必须 `isDesktopOnly: true` | ✅ 已改 | 三处调用：`shared/desktop-shell.ts`（`node:child_process`）、`shared/mcp-file-browse.ts`（`node:fs`）、`engine/agent/harness/mcp-stdio-transport.ts`（`node:child_process`） |
| 命令 ID 不包含插件 ID | ✅ | 命令为 `novel-writer-*`，插件 ID 为 `novel-writer-ai` |
| 无示例/模板残留代码 | ✅ | 无 sample plugin 代码 |
| 不做自更新/自安装 | ✅ | 只检查 GitHub Release 并给链接，不下载安装 |
| 网络使用在 README 中披露 | ✅ | README「Network use (disclosed per Developer policies)」段 |
| vault 外文件访问在 README 中披露 | ✅ | 新增「外部文件访问（仅桌面端）」段 + 英文 `Local file access` 段 |
| 无客户端遥测 | ✅ | 无上报代码；`check:secrets` 防密钥入仓 |
| Release 资产齐全、tag 与版本一致 | ✅ | `4.97.1` Release 含 `main.js` / `manifest.json` / `styles.css` / `versions.json` / zip / SHA256SUMS |

## 三、提交时可以直接用的文案

- **仓库**：`Moxifeng11/novel-writer-ai`
- **Description**（目录里可另填，建议与 manifest 一致）：
  `Write, plan, and polish Chinese web novels, short stories, and scripts in one AI workspace: outlines, world-building, drafting, co-writing, quality checks, continuity tracking, knowledge-base deconstruction, and export.`
- **分类建议**：`Writing`（其次 `Productivity`）
- **隐私/网络说明**：直接引用 README 的 `Network use` 与 `Local file access` 两段。

## 四、自动审核常见的打回点（本地先自查过）

| 打回点 | 本仓现状 |
|---|---|
| 未用 `requestUrl` 而用 `fetch` 访问第三方 | 统一走 `AiApiClient`（`requestUrl`）；仅更新检查与少数搜索端点，仍需人工确认 |
| `innerHTML` 注入 | 视觉重构后 UI 用 `createEl`/`setText`；`check:any`/`check:inline-styles` 已门禁 |
| 未使用 `this.registerEvent` / 未清理监听 | 已有 `check:hotpaths`、视图生命周期测试覆盖 |
| 硬编码中文字符串进 UI（非 i18n） | i18n 棘轮 205 文件 / 5359 条；剩余为分批迁移中的弹窗 |
| 未在 `onunload` 释放资源 | 有 `check:hotpaths` 与 e2e 生命周期用例 |
| 给命令设默认快捷键 | 零命中：`addCommand` 的定义表里没有任何 `hotkeys` 字段（`core/command-registry.ts` 与 `ui/` 全仓 grep `hotkeys` = 0） |
| 动态代码执行（`eval` / `new Function`） | 零命中：`engine/`、`ui/`、`shared/`、`core/` 全仓 grep = 0 |
| 未清洗的 `innerHTML` | 只有 `ui/rendering/safe-html.ts` 一处集中清洗（`no-unsanitized` 规则要求的单一关闭点），其余命中全是注释 |
| 桌面端用原生 `fetch` 而非 `requestUrl` | **唯一风险点**：`shared/http-transport.ts:136 fetchOnDesktop` → `:188`/`:224`，桌面端用 `fetch` 以保留取消语义与 SSE 流式（移动端仍走 `requestUrl`）。若审核要求改回 `requestUrl`，代价是放弃流式取消；README 已披露网络行为 |

## 五、后续

1. 审核通过后：账号页状态变为通过、客户端插件浏览器可搜到并可安装该版本 → 才算上架成功；此时再确认 4.97.1 是市场里的当前版本。
2. 若收到打回意见：按提示改代码 → **发更高版本 Release**（目录只认 `manifest.version` 对应的 tag），不要在下架/待审状态反复重发同号版本。
3. 日常发版：tag 与 `manifest.version` 一致、Release 资产齐全（本仓 `release.yml` 已保证），提交后同样进入审核队列。
4. 可选宣传：[Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 发帖、Discord `#updates` 通告（需要 `developer` 角色）。
5. 可选优化：把条目短描述改成与 manifest 一致；恢复移动端（改掉三处 Node 调用后把 `isDesktopOnly` 改回 `false`）需发新版本。

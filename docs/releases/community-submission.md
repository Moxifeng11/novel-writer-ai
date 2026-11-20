# 上架 Obsidian 社区插件目录

> 目标版本 4.97.1 · 记录时间 2026-11-20 · 维护：DSH

## 一、当前状态：已上架，无需再提交

目录条目：<https://community.obsidian.md/plugins/novel-writer-ai>（2026-11-20 复核：**62 次下载**，账号页 `Your entries` 里显示作者本人认领）。

最新版本是**自动收录**的。2026-11-20 实测：`4.97.1` 的 Release 在 03:43Z 发布，约 15 分钟后目录页「当前版本」已变成 `4.97.1`，并带上了该版 README 的平台说明「桌面端（界面中英双语）」，全程没有人工点提交。

> 换言之，本仓从 v4.93 起就在社区目录里；`Add a plugin` 只用于**全新仓库**，对已认领的仓库再点会报「已存在 / 已被认领」。

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
| `id` 全局唯一、不含 `obsidian` | ✅ | 全量目录 10616 条中无 `novel-writer-ai`；id 不含 `obsidian` |
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

## 五、后续

1. 每次发版：tag 与 `manifest.version` 一致、Release 资产齐全（`main.js` / `manifest.json` / `styles.css`），目录与客户端自动跟进，不需要人工提交。
2. 若目录给出审核打回意见：按提示改代码 → **发更高版本 Release**（目录只认 `manifest.version` 对应的 tag）。
3. 可选宣传：[Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 发帖、Discord `#updates` 通告（需要 `developer` 角色）。
4. 可选优化：把目录条目短描述改成与 manifest 一致；恢复移动端（改掉三处 Node 调用后把 `isDesktopOnly` 改回 `false`）需要发新版本才生效。

## 六、遗留事项

- **移动端**：因 `isDesktopOnly: true` 暂时不可安装。恢复路径：把 `shared/desktop-shell.ts`、`shared/mcp-file-browse.ts`、`engine/agent/harness/mcp-stdio-transport.ts` 三处改为纯 vault API 或平台无关实现，之后把 `isDesktopOnly` 改回 `false` 并发版。
- **`minAppVersion`**：当前 1.4.4；若审核认为用到了更新的 API，需要按提示上调。

# 上架 Obsidian 社区插件目录

> 目标版本 4.97.3 · 记录时间 2026-11-20 · 维护：DSH

## 一、当前状态：每版审核都是 Failed（2026-11-20 定位并修复）

插件条目：<https://community.obsidian.md/plugins/novel-writer-ai>（2026-11-20 复核：`62 downloads`、有 4.93–4.96 的版本历史、作者本人认领）。

**账号页的 Reviews 区显示 4.83.1 / 4.85.0 / 4.95.0 / 4.96.0 / 4.97.1 全部 `Failed`**，红条写着「The latest release of this entry failed one or more automated checks」。也就是说：从 4.83 起每一版都没通过自动扫描，插件因此一直没进客户端市场清单（`community-plugins.json` 10,616 条里没有 `novel-writer-ai`）。这不是「正在排队等审核」，是「一直被打回」。

判定上架成功的两条标准，缺一条都不算：

1. 账号页里该版本状态变成「通过 / 已发布」；
2. Obsidian 客户端「设置 → 第三方插件 → 浏览」里能搜到并装到该版本。

站点页面（服务端渲染）在审核期就会显示「当前版本 4.97.x」与新 README 文案，容易误判成已发布——**那一页只能证明提交进了系统，不能证明市场已放出**（2026-11-20 的误判记录，别再复用「页面显示新版本 = 已上架」这个推论）。

**4.97.2 已定位并修复唯一阻断项**：审核扫描器把 `eslint-comments/require-description` 保持为 error，而本仓有两条 `eslint-disable-next-line` 没写 `-- 说明`（`engine/agent/harness/mcp-stdio-transport.ts:31`、`services/chapter-version-service.ts:57`）。复现方法与判据见 §四之二。

**4.97.3 补掉第二个自检项：构建可复现**（2026-11-20）。审核的 Build verification 会重新构建并与发布资产比对，而本仓此前每次构建出的 `main.js` 哈希都不同——`scripts/generate-worker-inline.mjs` 用 `node:zlib` 压缩两个 worker，gzip 头写着构建时刻的 mtime，且 deflate 输出随 Node 内置 zlib 版本变化（本机 Node 24 与 CI Node 20 产出的字节就不一致）。改法：换成纯 JS 的 `fflate`（devDependency）并固定 `mtime: 0`。实测连跑三次、换 `TMP`/`TEMP` 目录，`shared/workers-inline.generated.ts` 与 `main.js` 哈希均一致（`11472CB4…381A`、6,241,484 字节）。细节见 §四之三。

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
| 根目录有 `manifest.json`，且与 HEAD 一致 | ✅ | 4.97.3，`id` = `novel-writer-ai` |
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
| Release 资产齐全、tag 与版本一致 | ✅ | `4.97.3` Release 含 `main.js` / `manifest.json` / `styles.css` / `versions.json` / zip / SHA256SUMS |

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
| `eslint` 指令缺说明（`eslint-comments/require-description`） | 2026-11-20 命中 2 处（`engine/agent/harness/mcp-stdio-transport.ts:31`、`services/chapter-version-service.ts:57`），已补 `-- 说明`；`check:obsidian-review` 兜住 |
| 未清洗的 `innerHTML` | 只有 `ui/rendering/safe-html.ts` 一处集中清洗（`no-unsanitized` 规则要求的单一关闭点），其余命中全是注释 |
| 桌面端用原生 `fetch` 而非 `requestUrl` | **唯一风险点**：`shared/http-transport.ts:136 fetchOnDesktop` → `:188`/`:224`，桌面端用 `fetch` 以保留取消语义与 SSE 流式（移动端仍走 `requestUrl`）。若审核要求改回 `requestUrl`，代价是放弃流式取消；README 已披露网络行为 |

## 四之二、本地复现审核扫描（4.97.2 起）

审核扫描器就是 `eslint-plugin-obsidianmd`，但**规则严重度与本地 lint 完全不同**：它把绝大多数规则降级为 `warn`，只有下面这些保持 `error`（error 才阻断发布）：

- 安全类：`no-eval`、`no-unsanitized/method`、`no-unsanitized/property`、`obsidianmd/regex-lookbehind`、`obsidianmd/no-forbidden-elements`、`no-new-func`、`no-implied-eval`（TS 侧为 `@typescript-eslint/no-implied-eval`）；
- 最新提交层额外收紧：`obsidianmd/settings-tab/no-manual-html-headings`、`settings-tab/no-problematic-settings-headings`、`sample-names`、`no-sample-code`、`platform`、`no-plugin-as-component`、`detach-leaves`、`no-static-styles-assignment`、`no-view-references-in-plugin`、`no-unsupported-api`；
- 备注类：`eslint-comments/no-unlimited-disable`、`require-description`、`disable-enable-pair`、`no-restricted-disable`。

扫描器还会**关闭** `no-undef`、`@typescript-eslint/no-unsafe-*`、`restrict-template-expressions`、`no-base-to-string`、`import/no-unresolved`、`validate-manifest`、`validate-license`、`commands/no-command-in-command-id`、`commands/no-plugin-id-in-command-id`，并忽略 `i18n/`、`docs/`、`scripts/`、`tests/`、`*.mjs` 等目录与文件（所以 i18n 里的中文字面量不会被审核）。

本仓已把这套判据固化成 `eslint.obsidian-review.mjs` + `npm run check:obsidian-review`（已进 `preflight`）：

```powershell
npm run check:obsidian-review        # 只打印 error 级（= 会被打回）的项；EXIT=0 才算这版能过扫描
```

实测：全量 1,037 个文件约 52 秒；2026-11-20 修复后 **EXIT=0**。另一份全量 recommended 配置跑出的 1,721 条 error 里，绝大多数（`prefer-create-el` 682、`no-unused-vars` 569、`no-deprecated` 255…）在扫描器里只是 warn，不阻断——**别再用「本地 lint 全绿」代替这项检查**。

也可在账号页用 `Review branch` 对分支做预览扫描（不发版）；正式复审要点 `Check for new releases`（只扫最新 Release）。

## 四之三、构建可复现（4.97.3 起）

审核的 Build verification 段会重新构建仓库并与发布资产比对，所以「同一份源码 → 同一个 main.js」是硬要求。本仓踩过的坑与现在的约束：

- **坑**：`scripts/generate-worker-inline.mjs` 把两个 worker 打包产物 gzip+base64 内联进 `shared/workers-inline.generated.ts`。旧实现用 `node:zlib`：
  1. gzip 头里的 MTIME 是构建时刻 → 同一台机器连跑两次哈希都不同；
  2. deflate 输出随内置 zlib 版本变化 → 本机 Node 24 与 CI Node 20 的字节不同（字节数相同、首个差异偏移 1,835,905，全落在 base64 里）。
- **现在**：压缩改用纯 JS 的 `fflate`（devDependency，只参与构建，不进包）并固定 `mtime: 0`；`INLINE_WORKER_COMPRESSION` 仍是 `gzip+base64`，运行时仍用 `DecompressionStream('gzip')` 解压，行为不变。
- **验证口径**：`node scripts/generate-worker-inline.mjs` 连跑两次 + 换 `TMP`/`TEMP` 再跑一次，`shared/workers-inline.generated.ts` 哈希必须相同；`npm run build` 连跑两次，`main.js` 哈希必须相同（4.97.3 实测 `11472CB43488581D10E76A665A9517DA7B6DCAFCD90EAA60323688D893EC381A`）。
- **其他生成物**本来就确定：`generate-template-assets.mjs` 统一 CRLF→LF 并按 key 排序、`build-styles.mjs` 按固定顺序拼接、`build.js` 用锁定版本的 esbuild。
- 若将来引入新的「构建期生成二进制资源」，同样要固定 mtime/压缩参数，否则会悄悄破坏这一条。

## 五、后续

1. 4.97.3 发布后在账号页点 `Check for new releases` 触发复审；通过后账号页状态变为通过、客户端插件浏览器可搜到并可安装该版本 → 才算上架成功。
2. 若收到打回意见：按提示改代码 → **发更高版本 Release**（目录只认 `manifest.version` 对应的 tag），不要在下架/待审状态反复重发同号版本。
3. 日常发版：tag 与 `manifest.version` 一致、Release 资产齐全（本仓 `release.yml` 已保证），提交后同样进入审核队列。
4. 可选宣传：[Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 发帖、Discord `#updates` 通告（需要 `developer` 角色）。
5. 可选优化：把条目短描述改成与 manifest 一致；恢复移动端（改掉三处 Node 调用后把 `isDesktopOnly` 改回 `false`）需发新版本。

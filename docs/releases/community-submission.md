# 上架 Obsidian 社区插件目录

> 最新已上架 4.97.5（2026-11-25 三项全绿，可安装）· 维护：ZCode（2026-11-25 起接手）

## 〇、4.97.5 发版（2026-11-24）

- 覆盖内容：正文四项校验软聚合 / 按磁盘正文重算 / 格式偏离行号 + 视角剔除对话 / 章末钩子子短语判定；非破坏性，`minAppVersion` 维持 **1.8.7**。
- 本地门禁：`preflight:release` 全绿（1024 个测试文件、10621 通过 + 3 跳过；覆盖率棘轮通过，`ui/views` 基线按 33 文件重锚）。生产冒烟：非 AI 路径 4 步通过；完整 AI 冒烟受开发 vault 的 API Key 401 阻塞（环境问题，与本版代码无关）。
- tag `4.97.5` == `manifest.version`，Release workflow **success**（run 45422725034）；资产：`main.js` 6,262,628（SHA256 `0E57B801…93A0`）、`styles.css` 804,584、`manifest.json` 467、`versions.json` 1,998、zip 2,502,512、`SHA256SUMS.txt` 595。
- `npm run check:release:remote` 通过：四资产体积与本地一致，`main.js` / `styles.css` 的 artifact attestation 校验通过。

### 〇之二、目录复核结论（2026-11-25 收口，ZCode）

**最终状态：三项全绿，4.97.5 已可通过 Obsidian 客户端安装。**

```text
[check:published] novel-writer-ai（manifest 4.97.5）
  目录上次检查：4 hours ago（Nov 24, 2026） · 下载 92
  ✓ 插件页 Current version = 4.97.5 —— 实际 4.97.5
  ✓ 客户端市场清单包含 novel-writer-ai —— 已收录
  ✓ RSS 出现 4.97.5 —— 最新 4.97.5
[check:published] 已上架：4.97.5 可通过 Obsidian 客户端安装
```

**收口三步（前两步曾卡两天）**：

| 时点 | 插件页版本 | RSS | 说明 |
| --- | --- | --- | --- |
| Nov 21 复核 | 4.97.4 | 4.97.4 | 目录站自 Nov 21 后未再扫描 |
| 触发复审 | 4.97.4 | **4.97.5** | 点 `Check for new releases` → 返回「A scan has been queued」 |
| **Nov 25 最终** | **4.97.5** | **4.97.5** | 扫描跑完，三项全绿 |

**根因**：目录站扫描是队列化的异步任务。点按钮后 RSS 立刻更新（几分钟），
插件页版本要等完整扫描跑完（本次约数十分钟到数小时）。此前误判为"审核未通过"，
实际只是没触发扫描。

**后续发版必须记住**：`tag` + GitHub Release 发布后**必须**手动点一次
`Check for new releases`，否则目录站不会自己发现新版本（4.97.4 的"约 1–1.5 小时自动覆盖"
是靠周期扫描撞上的，不可依赖）。

<details>
<summary>收口前的排查记录（保留作历史）</summary>

```text
[check:published] novel-writer-ai（manifest 4.97.5）
  目录上次检查：3 days ago（Nov 21, 2026） · 下载 86
  · 插件页 Current version = 4.97.5 —— 实际 4.97.4      ← 未更新
  ✓ 客户端市场清单包含 novel-writer-ai —— 已收录
  · RSS 出现 4.97.5 —— 最新 4.97.4                      ← 未更新
```

已排除代码/Release 问题（`check:release:remote` 通过、资产与 attestation 均验）。
</details>

> 注：手动触发后目录侧更新通常需数小时（4.97.4 先例约 1–1.5 小时）。本项**不要轮询**；
> 判据只认 `check:published` + RSS + 市场清单，不用临时脚本撞目录站。

## 〇之一、上一版：4.97.4 上架记录（2026-11-21 复核通过）

`npm run check:published -- --expect 4.97.4` 三项判据全部通过：

```text
[check:published] novel-writer-ai（manifest 4.97.4）
  目录上次检查：2 hours ago（Nov 21, 2026） · 下载 78
  ✓ 插件页 Current version = 4.97.4 —— 实际 4.97.4
  ✓ 客户端市场清单包含 novel-writer-ai —— 已收录
  ✓ RSS 出现 4.97.4 —— 最新 4.97.4
[check:published] 已上架：4.97.4 可通过 Obsidian 客户端安装
```

这一版是破坏性升级（最低 Obsidian **1.8.7**、用户可见删除改走回收站），`versions.json` 已按版本记录客户端下限，老客户端会按规则停在 4.97.3。

## 〇之二、更早：4.97.3 上架记录（2026-11-21 复核通过）

`npm run check:published` 三项判据全部通过：

```text
[check:published] novel-writer-ai（manifest 4.97.3）
  ✓ 插件页 Current version = 4.97.3 —— 实际 4.97.3
  ✓ 客户端市场清单包含 novel-writer-ai —— 已收录
  ✓ RSS 出现 4.97.3 —— 最新 4.97.3
[check:published] 已上架：4.97.3 可通过 Obsidian 客户端安装
```

市场清单里的条目（`community-plugins.json`）：

```json
{ "id": "novel-writer-ai", "name": "Novel Writer AI", "author": "南柯一梦", "repo": "moxifeng11/novel-writer-ai" }
```

注意其 `description` 尾部被目录追加了一句 `- This plugin has not been manually reviewed by Obsidian staff.` —— 这是**自动审核通过、未人工复核**的标注，属正常状态（自动扫描的阻断项已清零即可上架），不是被打回。

关键时间线：4.97.2 修掉唯一阻断项（两条 eslint 指令缺描述）→ 4.97.3 修掉构建不可复现（fflate + mtime:0）→ 目录周期扫描覆盖 4.97.3 后放行。此前「页面停在 4.97.1」是目录尚未扫描（`Last updated` 早于发版），并非被拒。

## 〇之三、4.97.4 发版 → 审核 → 上架（2026-11-21）

- tag `4.97.4` 已推、Release workflow **success**；资产 `main.js` 6,241,845（SHA256 `070ADD60…03B8`，与干净检出构建逐字节一致）、`styles.css` 805,893、`manifest.json` 467、zip 2,496,980、`SHA256SUMS.txt` 595。
- 破坏性声明（Release notes 与 `docs/releases/4.97.4.md` 都已写）：最低 Obsidian **1.8.7**、用户可见删除改走回收站。
- 发版后 21:45 首查仍是 4.97.3（目录周期检查未覆盖新版）；22:40 账号页 Reviews 里已出现 `4.97.4 … Pending`，22:52 点 `Check for new releases` 返回「A scan has already been run for this release and results are available on your dashboard.」；22:55 复查三项全绿。
- 经验：**目录周期检查（`Last updated`）滞后于审核结果**，`Pending` 条目出现后不要急着反复点触发；判据只看 `check:published` 三项。

### 〇之三之一、在没有浏览器会话的机器上怎么点这一下

审核触发必须登录 Obsidian 账号。本机登录态在 **DSH 桌面应用的内嵌浏览器面板**里（Electron，`D:\deepseek harness\DeepSeek Harness.exe`），不是系统 Edge、也不是另起的 Chromium——那两者的 profile 里没有会话。

该面板可被 **Windows UI Automation** 定位并点击（无需 CDP）：

1. 顶层窗口名 `插件优化。 — DeepSeek Harness`（class `Chrome_WidgetWin_1`）；
2. 其下有两个 `Document`，第二个是网页内容（名字随页面标题变，账号页时是 `Novel Writer AI - Obsidian Plugin`），含 `Log out` 即可确认已登录；
3. 里面 `Check for new releases` 是 `ControlType.Hyperlink`，`InvokePattern` 可用，`Invoke()` 等价于点击。

**读面板前必须先刷新（硬规则，2026-11-21 踩过）**：内嵌面板的服务端渲染页面**不会自己更新**，UIA 读到的是上次加载时的 DOM——直接用旧快照判断状态会误判。工具栏在同一窗口里有 `后退`(1217,103)、`前进`(1257,103)、`刷新`(1297,103) 三个 `Button`（都支持 `InvokePattern`），地址栏是 `Edit`「输入 HTTP(S) 地址」（`ValuePattern` 可 `SetValue` + `{ENTER}` 跳转），右侧 `在系统浏览器中打开` 会用默认浏览器另开（那里没有登录态，只能看公开页）。

实测差异：同一 URL 未刷新时 Reviews 第一行是 `4.97.4 … Pending`，点一次 `刷新` 后变成 `4.97.4 … Completed`——`Pending` 快照若被当成结论，就会得出「还在审」的错误判断。

结论口径：**面板只当点击面，事实一律用 HTTP 判据**（`npm run check:published`、RSS、`community-plugins.json`）；必须读面板时先 `刷新` 再枚举，并且把「刷新后仍不变」当作可复现证据而不是首次读数。

脚本口径：`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes` → `AutomationElement.RootElement.FindFirst(Children, NameProperty)` → 在第二个 Document 子树里 `FindFirst(Descendants, NameProperty='Check for new releases')` → `TryGetCurrentPattern(InvokePattern)` → `Invoke()`。注意 PowerShell 脚本里 `param()` 必须位于第一行，否则报 `"(" 后应为表达式`。

## 一、历史：每版审核都是 Failed（2026-11-20 定位并修复）

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
| `eslint` 指令缺说明（`eslint-comments/require-description`） | 2026-11-20 命中 2 处（`engine/agent/harness/mcp-stdio-transport.ts:31`、`services/chapter-version-service.ts:57`），已补 `-- 说明`；`check:obsidian-review` 兜住。**公开记分卡已交叉验证**：4.97.1 的 `Risks` 档唯一一类就是这两条（见 §四之一二） |
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

**打 tag 之后、点复审之前**，用远程核验代替人工比对（覆盖 Releases 段 + 记分卡的 attestation 判据）：

```powershell
npm run check:release:remote
# 断言：tagName == manifest.version、非 draft/prerelease、
#      main.js / manifest.json / styles.css / versions.json 四资产齐全且体积与本地构建逐一致、
#      main.js 与 styles.css 的 GitHub artifact attestation 可通过 gh attestation verify
```
（本地无 `gh`、或 `gh` 版本不支持 attestation 时只降级为提示，不会误报失败。）

复审之后，用一条命令判断「是否真的上架成功」，不要靠页面观感：

```powershell
npm run check:published              # 报告三项状态
node scripts/check-published.mjs --expect 4.97.3   # 未上架则 exit 1，可用于轮询
```

三项判据必须同时满足：插件页 `Current version` == manifest.version、客户端市场清单 `community-plugins.json` 收录该 id、RSS feed 出现该版本。**只满足其一不算上架**（历史上「页面显示新版本」曾被误当成上架成功）。

#### 审核四段 ↔ 本地命令对照

官方 Review 分四段，每一段都能在本地或远端复现，不用等审核结果猜：

| 审核段 | 官方检查什么 | 本地对应命令 |
| --- | --- | --- |
| Manifest | `id` 唯一且不含 `obsidian`、`name`/`description` 只用 Basic Latin、描述 ≤250 字符且以句号结尾、`isDesktopOnly` 布尔、README/LICENSE 存在、manifest 内 URL 为 https | `node scripts/check-release.mjs` |
| Releases | tag 与 `manifest.version` 完全一致、非 draft/prerelease、`main.js`/`manifest.json`/`styles.css` 齐全、Release 资产 `manifest.json` 与仓库 HEAD 内容一致、artifact attestation | `node scripts/check-release.mjs --remote` |
| Source code | `eslint-plugin-obsidianmd` 全仓扫描，**只有 error 级阻断**（warn/info 只进公开记分卡） | `npm run check:obsidian-review` |
| Build verification | 用 `build` 脚本从源码重建并与发布资产比对 | 干净检出后 `npm ci && npm run build`（4.97.3 起逐字节一致） |
| 上架结果 | 目录侧是否真的放出该版本 | `npm run check:published` |

记住两条判据口径：公开记分卡的 `Risks` 档 == 扫描器 error 级（阻断），`medium`/`info` 只影响质量画像；对照 `dataview`（`Risks` 386 条仍在市场里）即可确认。

## 四之一二、公开记分卡（Scorecard）——不用登录也能看审核扫描结果

社区目录的插件页有 `#scorecard` 锚点（右侧 `Health / Review / Risks` 三条进度条点进去），它把每次扫描的结果公开列出，**不需要登录账号**：

- `Health`：Hygiene（README/LICENSE/CONTRIBUTING/描述齐全）、Maintenance（最近提交、近一年提交数、最近发版）、Responsiveness（有无 issue）、Adoption（安装数）。
- `Review`：`N issues found by automated scans of the latest release.` + 分档明细（`Passed` / `Disclosures` / `Risks`，每条可展开看文件链接，链接形如 `https://github.com/<owner>/<repo>/blob/<commit>/<file>#L<line>`）。
- 判定标签：0–数十条 → `Satisfactory`（绿），数百条以上 → `Risks`（红）。

**2026-11-20 实测（4.97.1，commit 2a18bca）**：`Risks`，`3457 issues`。分档里 **`Risks` 档只有 1 类（2 处）**，就是 `Unexpected undescribed directive comment.` → `engine/agent/harness/mcp-stdio-transport.ts#L31`、`services/chapter-version-service.ts#L57`，与本地 `check:obsidian-review` 判定的唯二阻断项完全一致；其余全是 `medium`（4 类，含 2 处 `Unexpected browser feature`）与 `info`（数千条，绝大多数是 `no-unused-vars` 之类的未使用变量）。也就是说 **公开记分卡反过来验证了 4.97.2 的诊断**。

**对照证据（重要，别被红条吓住）**：`dataview` 的记分卡是 `Risks` + `386 issues`，它照样在客户端市场里；`templater-obsidian` 是 `Satisfactory` + `8 issues`。所以：

- `Review: Risks` 是**公开质量画像，不构成上架阻断**；
- 真正决定能不能上架的是账号页 `Reviews` 四段（Manifest / Releases / Source code / Build verification）里的 **error**，也就是 `check:obsidian-review` 覆盖的那批规则。

**监控方式**（都不需要登录）：

```powershell
Invoke-WebRequest https://community.obsidian.md/plugins/novel-writer-ai -OutFile page.html -UseBasicParsing
# 当前版本：搜 'Current version' 后紧跟的版本号
# 审核扫描：搜 'issues found by automated scans' 与倒数第一段 '"children":"Risks"|"Satisfactory"'
```

## 四之三、构建可复现（4.97.3 起）

审核的 Build verification 段会重新构建仓库并与发布资产比对，所以「同一份源码 → 同一个 main.js」是硬要求。本仓踩过的坑与现在的约束：

- **坑**：`scripts/generate-worker-inline.mjs` 把两个 worker 打包产物 gzip+base64 内联进 `shared/workers-inline.generated.ts`。旧实现用 `node:zlib`：
  1. gzip 头里的 MTIME 是构建时刻 → 同一台机器连跑两次哈希都不同；
  2. deflate 输出随内置 zlib 版本变化 → 本机 Node 24 与 CI Node 20 的字节不同（字节数相同、首个差异偏移 1,835,905，全落在 base64 里）。
- **现在**：压缩改用纯 JS 的 `fflate`（devDependency，只参与构建，不进包）并固定 `mtime: 0`；`INLINE_WORKER_COMPRESSION` 仍是 `gzip+base64`，运行时仍用 `DecompressionStream('gzip')` 解压，行为不变。
- **验证口径**：`node scripts/generate-worker-inline.mjs` 连跑两次 + 换 `TMP`/`TEMP` 再跑一次，`shared/workers-inline.generated.ts` 哈希必须相同；`npm run build` 连跑两次，`main.js` 哈希必须相同（4.97.3 实测 `11472CB43488581D10E76A665A9517DA7B6DCAFCD90EAA60323688D893EC381A`）。
- **其他生成物**本来就确定：`generate-template-assets.mjs` 统一 CRLF→LF 并按 key 排序、`build-styles.mjs` 按固定顺序拼接、`build.js` 用锁定版本的 esbuild。
- **跨环境实证**（4.97.3）：CI（Node 20）产出的 Release `main.js` 与本机（Node 24）构建**哈希一致**（`11472CB4…381A`）；4.97.2 时代两者不同（`B4B4FF16…` vs `CB43DB80…`）。
- **发版前可自查的等价命令**（模拟审核方）：`gh repo clone Moxifeng11/novel-writer-ai /tmp/clean -- --depth 1 --branch <tag>` → `npm ci && npm run build` → `sha256sum main.js` 与 Release 资产比对；同一目录再跑 `npm run check:obsidian-review`。
- 若将来引入新的「构建期生成二进制资源」，同样要固定 mtime/压缩参数，否则会悄悄破坏这一条。

## 五、后续

1. 4.97.3 发布后在账号页点 `Check for new releases` 触发复审；通过后账号页状态变为通过、客户端插件浏览器可搜到并可安装该版本 → 才算上架成功。
2. 若收到打回意见：按提示改代码 → **发更高版本 Release**（目录只认 `manifest.version` 对应的 tag），不要在下架/待审状态反复重发同号版本。
3. 日常发版：tag 与 `manifest.version` 一致、Release 资产齐全（本仓 `release.yml` 已保证），提交后同样进入审核队列。
4. 可选宣传：[Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 发帖、Discord `#updates` 通告（需要 `developer` 角色）。
5. 可选优化：把条目短描述改成与 manifest 一致；恢复移动端（改掉三处 Node 调用后把 `isDesktopOnly` 改回 `false`）需发新版本。

# 发布前文面体检（manuscript-precheck）

> 状态：stable（功能缺口 3 交付 2026-11-18）　｜　最后更新：2026-11-18　｜　Owner：dsh

## 1. 定位

- **用户视角**：发稿前的「文字面」体检。命令面板「🔎 文面体检（错别字/标点）」打开弹窗，按章列出错别字、重复词、中英标点混用、连续标点、引号不成对、英文省略号、破折号写法；每行给出「第N行 · 列M · 跳到正文」，点一下跳到该处。导出弹窗里也有「文面体检」开关（默认开）+「查看问题」按钮，导出前置检查会顺带拼一行摘要。
- **代码入口**
  - `shared/manuscript-precheck.ts`（纯规则引擎，无 Obsidian 依赖）：`checkManuscriptText(text): PrecheckIssue[]`、`checkManuscript(chapters): PrecheckReport`、`formatPrecheckSummary(report, maxChapters = 3): string | null`、`splitFrontmatter(content): { body, offset }`、常量 `PRECHECK_RULES` / `PRECHECK_RULES_ORDER` / `MAX_ISSUES_PER_CHAPTER`。
  - `ui/manuscript-precheck-modal.ts`（198 行，LF）：`export class ManuscriptPrecheckModal extends Modal`，构造 `(app: App, project: string)`；`export function chapterEntryLabel(entry: ChapterListEntry): string`。
  - `styles-src/43-manuscript-precheck.css`（2472 字节 / 117 行 / 16 个选择器）：全部 `nw-precheck-*` 语义类，无 `.nw-scope`（弹窗挂在 body，与既有弹窗同款）。
  - 命令接线：`shared/command-ids.ts` 的 `TEXT_PRECHECK = 'novel-writer-text-precheck'`；`core/command-registry.ts` 三处（定义表 / `uiCommandIds` / `addCommand`，模式规则 `LONG_ONLY`）；`ui/command-ui-executor.ts` 的 `case TEXT_PRECHECK`。
  - 导出接线：`ui/export-manuscript-modal.ts` 的「文面体检」Setting（toggle + 查看问题）、`textPrecheck` 字段、`exportManuscript()` 里拼接摘要。
- **数据来源**：`ui/project-utils.ts` 的 `getChaptersForProject(app, project)` → `sortChaptersByNumber` → `vault.cachedRead` 读正文；**不落盘、不改正文**。

## 2. 现状（事实，不写愿望）

### 2.1 规则（`shared/manuscript-precheck.ts`）

| 规则 id | 严重度 | 命中条件 | 文案示例 |
| --- | --- | --- | --- |
| `typo` | error（必改） | 错别字对表（51 对：既使→即使、必竟→毕竟、按装→安装、做为→作为、一但→一旦、题纲→提纲、帐号→账号、松驰→松弛、渲泄→宣泄、针贬→针砭、寒喧→寒暄、幅射→辐射、九宵→九霄、既往不究→既往不咎、谈笑风声→谈笑风生、鬼鬼崇崇→鬼鬼祟祟、不径而走→不胫而走、心无旁鹜→心无旁骛、插科打浑→插科打诨、沤心沥血→呕心沥血、杀戳→杀戮、相形见拙→相形见绌、一如继往→一如既往、再接再励→再接再厉、走头无路→走投无路、美仑美奂→美轮美奂、金榜提名→金榜题名、默守成规→墨守成规、不能自己→不能自已、饮鸠止渴→饮鸩止渴、鞭辟入理→鞭辟入里、汉流浃背→汗流浃背 等） | 「必竟」应为「毕竟」 |
| `repeat` | warning（待确认） | `/([\u4e00-\u9fff]{2,4})\1/g` 且不在白名单（一个/一天/一次/一遍/一年/一群/一点/一半/一边/一层/一阵/一会/一片/一条/一句/一步/一口/一身/一分/一声/许多/很久/很多/慢慢/渐渐） | 重复词「我们我们」，疑似多敲了一遍 |
| `punct-mix` | warning | 英文 `, . ? ! ; : ( )` 且**前后邻接汉字**（跳过 `...` 与小数） | 中文里用了英文标点「,」，建议改为「，」 |
| `punct-repeat` | warning（`！？` 降 info） | `/([，。、；：！？])\1+/g` | 连续出现 2 个「，」，一般保留一个 |
| `quote-pair` | error | 引号栈：`“”`、`《》`、`「」` 不配对 | 「“」缺少对应的「”」／出现了没有配对的「」」 |
| `ellipsis` | info（风格） | `\.{3,}` → 建议「……」；单个 `…` 也提示统一 | 英文省略号「...」建议改为「……」 |
| `dash` | info | `-{2,}` → 建议「——」；单个 `—` 也提示统一 | 连续短横「--」建议改为「——」 |

- **行号列号**：`splitFrontmatter` 自己算（不用 `utils/helpers.ts` 的 `stripFrontmatter`——那个会 `trim()`，偏移不可用），正文内按 `\n` 累计；列号按 UTF-16 code unit 计（与 `editor.setCursor` 的 `ch` 一致，无 surrogate 问题的中文场景等价）。
- **上限**：单章 `MAX_ISSUES_PER_CHAPTER = 200`，避免极端文本撑爆弹窗；弹窗渲染上限 `MAX_RENDERED_ISSUES = 300`（超出显示「仅显示前 300 条」）。

### 2.2 弹窗（`ui/manuscript-precheck-modal.ts`）

- **DOM**：`div.nw-precheck-summary`（摘要条）→ `Setting`「只看必改项」→ `div.nw-precheck-list`（`max-height: 52vh` 滚动）→ 每章 `div.nw-precheck-group`（`div.nw-precheck-group-title` sticky 章名 + 条数）→ 每条 `div.nw-precheck-issue`（`span.nw-precheck-badge--error|--warning|--info` + `div.nw-precheck-main`（`div.nw-precheck-message` + `div.nw-precheck-snippet`）+ `span.nw-precheck-meta`）；footer「重新扫描」「关闭」。
- **三态**：扫描中（列表清空）；有结果；无结果 `div.nw-precheck-empty`「✅ 未发现问题。」；扫描失败 `showErrorNotice('扫描失败', { detail })`。
- **只看必改项**：只保留 `severity === 'error'`；摘要条仍显示全量统计（那是「扫描结果」，不是「当前视图」）。
- **跳转**：`jumpTo(issue)` → `getLeaf('tab')` → `openFile` → `editor.setCursor({ line: issue.line - 1, ch: Math.max(0, issue.column - 1) })` → `scrollIntoView({ from, to }, true)` → `this.close()`。与 `ui/consistency-audit-modal.ts` 的 `jumpToEvidence` 同款。

### 2.3 导出接线（`ui/export-manuscript-modal.ts`）

- `private textPrecheck = true`；Setting「文面体检 … 导出前扫描错别字、标点与重复词」+ 按钮「查看问题」（`new ManuscriptPrecheckModal(this.app, this.project).open()`，不关导出弹窗，体检关掉后回到导出）。
- `exportManuscript()` 在 `if (precheck) new Notice(precheck, 8000);` **之前**：按 `exportChapters` 映射成 `{ name, path, text }` 跑 `checkManuscript`，`formatPrecheckSummary(textReport, 3)` 有值就拼进 `precheck` 并追加「（在「🔎 文面体检」里可逐条跳转）」。开关关掉则完全跳过（不读正文、不扫）。
- 与既有「交付检查」（结构/字数/作者）**并列**，不改其阻断语义：文面体检只提示，不阻断导出。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| MC-01 | P0 | 导出前只有结构/字数/作者检查，没有任何字面体检；全仓无错别字实现 | 纯本地规则引擎 + 问题列表 + 一键跳转 | done（缺口 3） |
| MC-02 | P0 | 中英标点检测容易误报（代码、数字、英文引用） | 只在英文标点**前后邻接汉字**时报，跳过 `...` 与小数 | done |
| MC-03 | P1 | 重复词若按单字判，会把「人人」「一一」「渐渐」全报出来 | 只判 2–4 汉字整体重复 + 白名单 | done |
| MC-04 | P1 | frontmatter 的 `---` 会被破折号规则报、元数据中文会被标点规则报 | `splitFrontmatter` 只扫正文并保留偏移 | done |
| MC-05 | P2 | 弹窗若依赖 plugin 实例，单测要造一大坨依赖 | 构造只收 `(app, project)` | done |

## 4. 关键决策

1. **纯本地、不调 AI**：投稿前刚需、必须可离线、可重复；规则引擎在 `shared/` 里，导出弹窗与独立命令共用一份实现。
2. **严重度分三档而不是「全报」**：错别字与引号不配对是硬伤（error）；重复词/标点是概率问题（warning）；省略号/破折号是风格统一（info）——只让「必改」项在导出前置检查里说话，避免把作者教育成无视提示。
3. **中英标点只认「夹在汉字之间」**：`他说,我知道` 报，`3.14`、`a, b`、`...` 不报。代价是「句末英文句号紧跟引号」这类边界漏报，可接受。
4. **重复词限 2–4 个汉字整体重复**：`我们我们` 报；`人人`、`一一` 这类叠词靠白名单兜底。不追求召回，追求「报出来就对」。
5. **引号用栈配对并区分方向**：多出关引号报「出现了没有配对的「X」」，未闭合报「「X」缺少对应的「Y」」——两类问题修法不同，文案必须分开。
6. **弹窗不依赖 plugin**：`(app, project)` 足够；单测用假 `App` 即可，也方便从导出弹窗里直接 `new`。
7. **导出侧默认开、可关、只在有值时拼接**：没问题的书不该多一行噪音；开关关掉连正文都不读。
8. **「只看必改项」只过滤列表、不改摘要**：摘要条是「扫描结果」，切换过滤条件不应让统计跳变（否则用户会以为重新扫了）。

## 5. 验收记录

| 项 | 结果 |
| --- | --- |
| 类型检查 | `npx tsc --noEmit` EXIT 0 |
| 构建 | `npm run build` → `[styles] 拼接 49 个源文件 → styles.css（31858 行）`；main.js 5,643,485 B / styles.css 793,258 B |
| 单测 | `tests/unit/shared/manuscript-precheck.test.ts` 15 条全绿；`command-registry` + `command-mode-rules` 回归 26 条通过 |
| 实机 | `D:\nw-tmp\probe-gap3.mjs`（Playwright + 临时 user-data-dir + dev vault，临时写 `示例项目/03-大纲与章节/正文/第1卷/第4章_正文.md` 并在 finally 删除）：命令返回 true → 弹窗标题「🔎 文面体检」、摘要「发现 6 处（错别字 2、重复词 1、中英标点 1、连续标点 1、省略号 1），涉及 1 章：第4章（6）」，6 行徽标 `必改 ×2 / 待确认 ×4`，行元信息「第6行 · 列2 · 跳到正文」；点首行 → 弹窗关闭、活动文件变第4章、光标 `{ line: 5, ch: 1 }`；「只看必改项」6 → 2 → 关掉回到 6；导出弹窗含「文面体检」与「查看问题」，点按钮叠开体检弹窗（同样 6 行） |
| 导出前置检查 | 同一次实机点「导出」→ Notice 同时含结构检查（未结算 4 章 / 未过质控 4 章）、出版检查、`🔎 文面体检：发现 6 处…（在「🔎 文面体检」里可逐条跳转）`；随后「✅ 完成已导出 4 章 / 297 字」 |
| 门禁 | `check:inline-styles` 525（静态 453 / 动态 72，不变）；`check:utility` 46 / 142（不变）；`check:css` bytes 793,258 / uniqueClasses 4,303 / hex 192 / rgb-hsl 223 / important 24 / 深度 4；`check:bundle` main.js 5,643,485 / styles.css 793,258 / workers 684,381 + 108,804；`check:view-tests` 通过（84 个未达标 = 基线，无新增） |
| preflight | 见交接时的本轮记录（EXIT=0） |

**实机坑（重要）**：CDP 下 Obsidian 的 `activeDocument` 为空，`Modal.open()` 挂不上 DOM，表现为「命令返回 true 但 `.modal-container` 恒为 0」。必须在**每一次** `page.evaluate` 里、**执行命令之前**重设 `window.activeWindow = window; window.activeDocument = document;`——只在会话开头设一次会失效（`openFile` 等操作会把它重置）。验证方法：同一段脚本里 `executeCommandById` 后立刻数 `.modal-container`，若为 0 先查这一步。

## 6. 测试清单

- `tests/unit/shared/manuscript-precheck.test.ts`（15 条）：`splitFrontmatter` 去元数据且偏移正确（2）；错别字命中/不命中与行列号（3）；重复词命中、白名单不报、英文重复不报（3）；中英标点邻接判定、小数与英文逗号不误报、连续标点、引号未闭合 error、省略号/破折号提示（5）；`checkManuscript` 的 `total` / `byRule` / `bySeverity` / 章名分组与 `formatPrecheckSummary` 文案（2）。
- `tests/unit/core/command-registry.test.ts`：「`TEXT_PRECHECK` 已登记」与既有「调色板可见命令都能在 InternalRegistry 执行」断言。
- `tests/unit/shared/command-mode-rules.test.ts`：`LONG_ONLY` 规则覆盖。
- 回归关注：`tests/unit/ui/export-manuscript-*`（导出流程）与 `command-ui-executor` 相关用例。

## 7. 剩余 backlog（P2/P3）

- 规则不可配置：错别字表、白名单、严重度都写死在 `shared/manuscript-precheck.ts`，没有设置项。
- 无「项目术语表 / 忽略词」：自定义人名、自造词可能被重复词规则误报。
- 未跳过 Markdown 结构性区域（代码块、链接 URL、frontmatter 已跳过但正文里的 `[]()` 仍会扫）。
- 不做「一键替换」：只定位不修，避免自动改稿风险。
- 无批量导出报告（JSON/CSV）。
- 未接 i18n；`formatPrecheckSummary` 文案与徽标全中文。
- 198 行贴着 `check:view-tests` 的 200 行阈值，再加功能要先补 view-tests 静态 import 或拆文件。

## 8. 交接备注

- **新增命令要接 5 处**（本轮已全接）：`shared/command-ids.ts`、`core/command-registry.ts` 三处（定义表 `:163` / `uiCommandIds` `:380` / `addCommand` `:569`）、`shared/command-mode-rules.ts`、`ui/command-ui-executor.ts` 的 case、`tests/unit/core/command-registry.test.ts` 的 `EXPECTED_REGISTERED_IDS`。漏 `uiCommandIds` 会「面板可点但 registry 无执行体」。
- **模式**：`LONG_ONLY`（长篇专用）——`command-mode-rules.ts:47`；短篇/剧本项目会被 `isBlockedByMode` 拦并弹 8s Notice。
- **基线数字**：`check:css` bytes **793,258** / uniqueClasses **4,303**（note 已记本轮 +2472 / +15 类）；`check:bundle` main.js **5,643,485** / styles.css **793,258**（note 记 +10931 / +2517）。两个脚本只认 `--note` 参数形式。
- **构建行尾归一化**：`scripts/build-styles.mjs` 现会把源文件 `\r\n` 归一为 `\n` 再拼接。原因：Windows `core.autocrlf=true` 检出会让 13 份样式源带 CRLF，拼出的 styles.css 虚增 9064 字节并触发 `check:css` / `check:bundle` 假失败（本轮踩过一次，已修）。
- **dev vault 同步**：`node scripts/dev-vault.mjs sync` 默认写 `%USERPROFILE%\nw-dev-vault`，**不是** `D:\nw-dev-vault`，必须 `--vault=D:/nw-dev-vault`。
- **实机脚本**：`D:\nw-tmp\probe-gap3.mjs`（功能主探针，含写入临时章 + 删除）、`D:\nw-tmp\probe-exp-precheck.mjs`（只看必改项 + 导出 Notice）、`D:\nw-tmp\probe-mount.mjs`（Modal 挂载排查，最小复现）。

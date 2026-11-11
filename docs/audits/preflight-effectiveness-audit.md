# Preflight 28 步「空转」有效性审计

- 任务：DSH-20261111-02
- 审计人：trae（只读审计）
- 日期：2026-11-11
- 审计对象：插件仓 `npm run preflight`（package.json:13，共 28 步串行）
- 代码基线：HEAD `7cfd449`（v4.83.0）
- 写范围：仅本文件；未修改任何源码、门禁脚本或基线文件
- 方法：逐脚本静态阅读（定位到行）+ 只读复跑关键门禁（不触发 `--update-baseline`、不跑会写盘的 `check:jsdoc`）

## 一、结论摘要

1. 28 步中**没有一步是完全空的**——每步至少有真实扫描或真实比对；但有 **9 步存在「扫描目标整体缺失/清单自维护/只比格式」导致的静默放行路径**，另有 3 步的「棘轮」只登记不收紧。
2. **最严重的纸面感来自三处**：`check:program`（只证明 MD 与 JSON 自洽）、`test` 步骤携带的覆盖率阈值（主 preflight 根本不开 `--coverage`）、`check:automation`（只验时间格式，不验时效）。
3. 已实测复现一条**硬证据**：`check:obsidian-api` 在空扫描根 + 无基线时输出「8 条规则全部 0（基线 0）」并 exit 0（见 §四.1）。同类「`existsSync` 缺失即 `continue/return`」写法在 `check:any`、`check:view-tests`、`check:jsdoc`、`check:write-entry` 中重复出现（见 §四.2）。

## 二、28 步总表

| # | 步骤 | 扫描范围 | 是否可能空转 | 风险 | 依据（文件:行号） | 建议 |
|---|---|---|---|---|---|---|
| 1 | `typecheck` | 全仓 `**/*.ts`（含 tests/types） | 否（仅覆盖 .ts） | 低 | `tsconfig.json:22` | tsconfig 已全仓 include，保持 |
| 2 | `lint` | 除 scripts/tests/docs/tmp 外全部 .ts | 是：1890 条 warn 内全放行；any/unused 为 warn | 中 | `package.json:39`、`eslint.config.mjs:33-47,81-87` | 把 `--max-warnings` 按季度棘轮下调；any 已由 check:any 兜底 |
| 3 | `test` | `tests/**/*.test.ts`（727 文件） | 部分是：**不开 `--coverage`，vitest 阈值完全不生效** | **高** | `package.json:13,19,20,14`、`vitest.config.ts:53-100` | preflight 改为 `test:cov`，或把覆盖率单列一步 |
| 4 | `check:templates` | `templates/` 资源 → 生成常量 | 否（目录缺失 throw） | 低 | `generate-template-assets.mjs:37,70-76` | 保持 |
| 5 | `check:styles` | `styles-src/*` 源拼接 → `styles.css` | 否（产物缺失 exit 1） | 低 | `build-styles.mjs:22,69-73` | 保持 |
| 6 | `check:css` | `styles.css` 全文件正则指标 | 是：**基线缺某个数值键即不比较该键** | 中 | `check-css.js:113,128-130` | 基线改为 schema 必填（缺键即 fail） |
| 7 | `check:inline-styles` | `ui/**/*.ts` 的 `style:`/`style="` 字面量 | 否（基线缺失 fail，新文件按 0） | 低 | `check-inline-styles.mjs:103,116-118` | 保持；注意基线条目手工维护 |
| 8 | `check:obsidian-api` | `main.ts`+7 个目录（8 项） | **是：无扫描文件且无基线时全绿** | 中 | `check-obsidian-api.mjs:35,159-160,215-219` | 扫描文件数 == 0 时直接 fail |
| 9 | `check:secrets` | `git ls-files` 全量（实测 2032 文件） | 否（非 git 仓直接报错） | 低 | `check-secrets.mjs:30,71,128-129` | 11 条正则之外补充语义型密钥（可选） |
| 10 | `check:deps` | 分层目录全量 .ts 静态 import | 否（`--require-baseline` 缺基线硬失败） | 低 | `check-dependencies.mjs:45,100,439-462`、`baseline-utils.mjs:116-126` | 只覆盖静态 import；动态 `import()` 不在范围，建议注明 |
| 11 | `check:engines` | 全仓 .ts 的 `new *Engine/*Service` 单例 | 否（白名单缺失 fail） | 低 | `scan-engine-instances.mjs:42,180,282,649` | 只认 `new`，工厂/闭包不受检，建议注明 |
| 12 | `check:program` | `docs/progress/program-status.json` ↔ 同名 .md | **是：只比同步，不校验任何数字真伪** | **高** | `program-status.mjs:174-180` | 增加「数字 ↔ 实测」抽样（见 §五） |
| 13 | `check:relationship-authority` | 全仓 .ts 文本含「与其他…的互信息」 | 是：拼串/正则可绕过；白名单与规则同文件 | 中 | `check-relationship-authority.mjs:22,37-54` | 白名单迁到独立 JSON，避免改脚本即放行 |
| 14 | `check:silent-failures` | **仅 `ui/`**，catch 前后 4/6 行窗口 | 是：engine/services 不在范围；窗口外豁免 | 中 | `check-silent-failures.mjs:20-21,34,39-46` | 扩大到 services/engine 的 UI 回调出口 |
| 15 | `check:hotpaths` | `HOT_FILES` 硬编码 10 个模块 | 是：新热路径不加入清单即盲区 | 中 | `check-hotpath-scans.mjs:23,47,54-62` | 清单改为「按调用频率自动发现候选」 |
| 16 | `check:write-entry` | 6 个目录的 `adapter.write/append` | 是：**豁免正则作用于整行**，同行出现 .json 即豁免 .md 写入 | 中 | `check-write-entry.mjs:24,29,45-47,66` | 只对目标路径表达式做豁免判断 |
| 17 | `check:linked-scenarios` | 4 条链 / 35 个锚点（清单写在脚本里） | 是：删锚点即绿；只验字符串存在 | 中 | `check-linked-scenarios.mjs:17,72-95` | 锚点清单外置 + 至少一条行为级断言 |
| 18 | `check:automation` | `.trae/automation/trae-loop-state.json` | **是：只验格式不验时效；独立插件仓缺台账仅 warn** | **高** | `check-automation.mjs:16,55-57,64-96` | 增加「updatedAt 距今 > N 天即 fail」 |
| 19 | `check:dsh-isolation` | 7 目录 + 根入口的 `child_process` | 否 | 低 | `check-dsh-isolation.mjs:48-84` | 保持 |
| 20 | `check:jsdoc` | 各层目录 .ts（仅统计有 exports/methods 的文件） | 是：**整个层目录改名 → files 空 → problems 空 → 绿**；`--check` 仍写报告 | 中 | `check-jsdoc.mjs:79,379,417-421,423-427` | 层目录缺失或文件数骤降时 fail |
| 21 | `check:any` | 6 个源码目录的 `any` 计数 | 是：目录整体缺失时 `total=0 ≤ 基线` 即绿 | 中 | `check-any-budget.mjs:26,43-45,68,105-114` | 校验「6 目录均存在且文件数 > 0」 |
| 22 | `check:view-tests` | `ui/**/*.ts` 中 >200 行且无测试 import | 是：基线只登记、不自动收紧；`ui/` 缺失即绿 | 中 | `check-view-tests.mjs:31,59,134,149-159,192` | 基线未达标数按月棘轮（只降不升） |
| 23 | `check:changelog` | `CHANGELOG.md` 版本节点 | 否 | 低 | `check-changelog.mjs:21,29-70` | 保持 |
| 24 | `check:docs` | docs 索引/手册/ADR/活跃文档编码 | 否 | 低 | `check-docs.mjs:41,71-79,115,153` | 保持（audits 为历史快照，不做编码追溯） |
| 25 | `check:support-qr` | 二维码生成物 ↔ 源 | 否 | 低 | `gen-support-qr.mjs:25,30-32,55-58` | 保持 |
| 26 | `build` | esbuild `main.ts → main.js` | 否 | 低 | `build.js:33,85-87` | 保持 |
| 27 | `check:bundle` | `main.js` / `styles.css` 字节数 | 否（基线键缺失按 0 → 必超） | 低 | `check-bundle.mjs:31,115,132-137` | 保持 |
| 28 | `check:release` | 三资产 + manifest/versions 元数据 | 否 | 低 | `check-release.mjs:31-39,45-63,86-99` | 保持 |

## 三、深查：8 个重点步骤

### 1) 步骤 12 `check:program` —— 只证明「文档等于 JSON」

- 代码：[program-status.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/program-status.mjs#L174-L180)。`--check` 的唯一动作是 `render(data)` 与 `PROGRAM-STATUS.md` 逐字节比对，不一致就 `exit 1`。
- 空转路径：JSON 里任何数字（版本、单测文件数、用例数、任务状态）都**不与被测仓库对照**。手改 JSON 后跑 `npm run program:render`，门禁必绿。
- 实测漂移（本次未改动，仅记录）：
  - `docs/progress/program-status.json` 的 `baseline.version = 4.82.0`，而 `package.json` 已是 `4.83.0`；
  - `baseline.tests = 686 文件 / 7123 用例`，仓库 `tests/**/*.test.ts` 实测 **727** 个文件；
  - 同一文件内 `localCommitsAheadNote` 又写「613 文件 / 6,730 用例」，与 baseline 自相矛盾。
  - 上述三项均不影响本步结果——门禁照样通过。
- 建议：给 `check:program` 增加三项只读交叉核验：`pkg.version === baseline.version`、`tests 文件数 == 实测 glob 数`、`updatedAt` 距今 ≤ 3 天。

### 2) 步骤 3 `test` —— 覆盖率阈值写了但主 preflight 从不执行

- `preflight` 调 `npm run test`（[package.json](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/package.json#L13-L20)），而 `test` 是 `vitest run`，`test:cov` 才带 `--coverage`；`preflight:release` 才串 `test:cov`。
- `vitest.config.ts:53-100` 的 7 组 per-glob 阈值（含 `ui/**` 仅 10%）**只在开启覆盖率时生效**，所以在日常 preflight 里是纯装饰。
- 风险：任何人删测试、让覆盖率腰斩，`npm run preflight` 仍全绿，只有手动 `build:release` 才会红。
- 建议：把覆盖率为单独一步 `check:coverage`（或直接把 preflight 的 test 换成 test:cov），并记录耗时取舍。

### 3) 步骤 18 `check:automation` —— 只验格式，不验时效

- 代码：[check-automation.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-automation.mjs#L16-L96)。
- 空转路径 A：`isVaultWorkspace`（L16）为 false 时，台账缺失只 `warn`（L55-57）——在独立插件仓/CI 里本步几乎不设防。
- 空转路径 B：只校验 `updatedAt` 是否匹配带时区的正则（L64-66），**不比较当前时间**。实测输出为 `round 123，2026-11-09T02:21:29`，而审计当天是 2026-11-11，自动轮询已停 2 天，门禁仍通过。
- 建议：加 `now - updatedAt > 48h → fail`；并把「台账存在」在插件仓内也升为 fail。

### 4) 步骤 8 `check:obsidian-api` —— 扫 0 个文件也通过（已实测复现）

- 代码：[check-obsidian-api.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-obsidian-api.mjs#L159-L219)。`walk` 遇到不存在的目录直接 `return`（L159-160）；`compare` 在无基线条目时只要求 `count === 0`（L215-219）。
- 实测：`node scripts/check-obsidian-api.mjs --root <空目录> --baseline <不存在的文件>` → 8 条规则全部 `0（基线 0）`，输出「✅ 门禁通过（无新增违规）」，`EXIT=0`。
- 现实影响：当前 8 条规则实测均为 0，所以删除基线文件或目录改名不会被发现。
- 建议：`files.length === 0` 直接 fail；基线缺失时即使全 0 也 fail（基线即「已审计」凭证）。

### 5) 步骤 21 `check:any` / 步骤 22 `check:view-tests` —— 基线是登记簿，不是棘轮

- `check:any`：[check-any-budget.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-any-budget.mjs#L43-L114) 只对「基线里有的文件」比较增量（L110-114），目录整体缺失时 `total=0` 必然 ≤ 基线（L105-106）。
- `check:view-tests`：基线缺失会把全部未达标文件判为新增而 fail（L134,149-159），这部分是好的；但**已登记的条目不会被重新审视**。实测 `当前未达标 93 个 / 基线 94 个`，同时提示「有 1 个文件已补测试，可收紧（只降不升）」——收紧是**可选的**，不收紧也绿。
- 另有口径问题：`>200 行` 才检查（L31），且「有测试」只要求存在 import（L86-92），不要求断言。
- 建议：①基线未达标数按月强制棘轮（例如每月至少 -5%）；②`ui/` 目录缺失或文件数为 0 时 fail；③在基线 JSON 里记录生成时间，超 90 天未收紧即 fail。

### 6) 步骤 16 `check:write-entry` —— 豁免正则作用于整行

- 代码：[check-write-entry.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-write-entry.mjs#L29-L70)：`EXEMPT_PATH = /\.(json|jsonl|yaml|yml|project|bak|canvas|base|css|txt)\b/`，命中判断是 `EXEMPT_PATH.test(line)`（L66），作用对象是**整行源码**而不是被写入的路径表达式。
- 空转路径：`await adapter.write(mdPath, data); // 之后写 .json` 这类同一行含 `.json` 的真实 .md 写入会被豁免。实测当前 31 处豁免，无法区分其中是否有误豁免。
- 建议：从 `adapter.write(` / `append(` 的参数列表里抽出第一个实参再判断扩展名；同时补 `adapter.writeBinary` / `vault.process`。

### 7) 步骤 17 `check:linked-scenarios` —— 规则与清单同处一文件

- 代码：[check-linked-scenarios.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-linked-scenarios.mjs#L17-L107)。4 条链 / 35 个锚点全部硬编码在脚本顶部；校验方式是 `content.includes(anchor.text)`（L94）。
- 空转路径：删掉锚点即「修好」；只证明某段字符串还在，不证明联动链路能跑通。
- 建议：锚点清单外置为 `docs/regression/anchors.json` 并在 PR 模板里要求说明删减；4 条链各配 1 条最小行为测试。

### 8) 步骤 20 `check:jsdoc` —— 层目录消失即静默通过，且 `--check` 有写盘副作用

- 代码：[check-jsdoc.mjs](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/check-jsdoc.mjs#L79-L427)：`walk` 缺目录 `return []`（L79）；统计只保留 `exports > 0 || methods > 0` 的文件（L379）；基线缺失 exit 2（L423-427，良好）。
- 空转路径：若某层目录被改名/移走，`files` 变空 → L430 的循环不执行 → `problems` 为空 → 通过。同理，把文件里所有 `export` 去掉也能「合规」。
- 副作用：`--check` 模式下仍会写 `docs/generated/jsdoc-coverage.md`（L417-421），使 preflight 不是纯只读。
- 建议：记录上次扫描文件数，跌幅 > 5% 即 fail；把报告写入改为仅在 `--report` 时执行。

## 四、横向机制问题

### 1. 「目录缺失 = 没有违规」是系统性的

同一写法在 5 个脚本里重复：`if (!fs.existsSync(dir)) return;` / `continue;`
- `check-obsidian-api.mjs:159-160`
- `check-any-budget.mjs:45`
- `check-view-tests.mjs:59`
- `check-jsdoc.mjs:79`
- `check-write-entry.mjs:47`

已用空根实测：`check:obsidian-api` 扫 0 文件、无基线，仍 exit 0。建议抽一个公共断言：**「扫描文件数为 0 → fail」**，并逐个接入。

### 2. 基线（baseline）统一是「只登记、不自动收紧」

- 6 个基线文件：`.arch-baseline.json`、`.any-baseline.json`、`.jsdoc-baseline.json`、`.view-tests-baseline.json`、`.obsidian-api-baseline.json`、`.css-baseline.json`、`.inline-style-baseline.json`、`.bundle-baseline.json`。
- `--require-baseline` 只防「基线文件被删」（[baseline-utils.mjs:116-126](file:///d:/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/%E5%B0%8F%E8%AF%B4%E5%B7%A5%E5%9D%8A/.obsidian/plugins/novel-writer-ai/scripts/baseline-utils.mjs#L116-L126)，这块做得对）；但**没有任何机制强制收紧**，收紧全部是 `--update-baseline` 的人工动作。
- 后果：`check:view-tests` 的 94 条基线可以永久躺平；`check:any` 的 74 条同理。

### 3. 「清单写死在门禁脚本里」

`HOT_FILES`（10 个）、`ANCHORS`（4 链 35 锚点）、`SCAN_DIRS`（各脚本）、白名单（`shared/paths.ts` 等）都在脚本内部。改脚本即可让门禁变绿，且这种改动不会触发任何其他门禁。

### 4. 覆盖面真实、但只覆盖「能被正则看见的」

`check:secrets`（11 条正则）、`check:silent-failures`（catch 窗口）、`check:relationship-authority`（纯文本匹配）都是启发式。它们的价值是「防回归」而非「证明无问题」。文档里应避免把它们表述为「已保证」。

## 五、最可能是纸面门禁 TOP3

| 排名 | 步骤 | 为什么算「纸面」 | 关键证据 |
|---|---|---|---|
| 1 | 步骤 12 `check:program` | 门禁名带 program「进度」，实际只做 Markdown 与 JSON 的字符串同步；所有质量数字都来自手改的 JSON，且**当前已经漂移**（4.82.0 vs 4.83.0、686 vs 727）仍绿 | `program-status.mjs:174-180`；本次实测台账与仓库不一致但 `--check` 通过路径不受影响 |
| 2 | 步骤 3 `test`（覆盖率棘轮部分） | 7 组 per-glob 阈值写得很像门禁，但主 `preflight` 从不加 `--coverage`；只有人手动 `build:release` 才生效 | `package.json:13,19,20`；`vitest.config.ts:53-100` |
| 3 | 步骤 18 `check:automation` | 自动轮询的「存活」只靠 `updatedAt` 格式判断；实测已停摆 2 天仍报绿，独立插件仓内缺失台账仅 warn | `check-automation.mjs:16,55-57,64-96`；实测输出 `round 123，2026-11-09T02:21:29` |

**候补第 4**：步骤 22 `check:view-tests` —— 94 条基线 / 93 条仍未达标，基线与实际几乎不收敛，且「有测试」只要求 import。

## 六、只读实测记录（本次审计执行）

| 命令 | 关键输出行 |
|---|---|
| `node scripts/check-hotpath-scans.mjs` | `✅ 热路径 0 次全库扫描（…，10 个模块）` |
| `node scripts/check-write-entry.mjs` | `✅ 裸 adapter 写入均限定在索引外文件（31 处豁免…）` |
| `node scripts/check-silent-failures.mjs` | `✅ 用户操作型 catch 均有可见提示` |
| `node scripts/check-relationship-authority.mjs` | `✅ 互信息分节仅出现在白名单写入方/模板中` |
| `node scripts/check-linked-scenarios.mjs` | `✅ 联动场景清单锚点全部有效（4 条链 / 35 个锚点）` |
| `node scripts/check-dsh-isolation.mjs` | `✅ dsh 隔离检查通过（…）` |
| `node scripts/check-any-budget.mjs` | `✅ any 预算通过：74/74（42 个文件）` |
| `node scripts/check-view-tests.mjs` | `✅ 当前未达标 93 个（阈值 200 行），基线 94 个`；`💡 有 1 个文件已补测试，可运行 --update-baseline 收紧基线` |
| `node scripts/check-obsidian-api.mjs --root <空目录> --baseline <不存在>` | 8 条规则全部 `0（基线 0）`，`✅ … 通过（无新增违规）`，`EXIT=0` |

未执行（会写盘或耗时）：`check:jsdoc`（会写 `docs/generated/jsdoc-coverage.md`）、`check:docs`（内部调 `gen-docs`）、`npm run test`（727 文件全量）、`build`。

## 七、建议的修复优先级（需 DSH / 用户确认后执行）

| 优先级 | 动作 | 影响面 |
|---|---|---|
| P0 | `check:program` 增加版本/测试文件数/时效三项交叉核验 | 1 个脚本，无源码改动 |
| P0 | preflight 的 `test` 改 `test:cov`（或单列 `check:coverage`） | 仅 package.json |
| P1 | 统一「扫描文件数为 0 → fail」 | 5 个脚本各 3-5 行 |
| P1 | `check:automation` 增加时效阈值 | 1 个脚本 |
| P2 | 基线与清单外置 + 月度收紧提醒 | 6 个基线、3 份清单 |
| P2 | `check:write-entry` 改为解析写入目标实参 | 1 个脚本 |

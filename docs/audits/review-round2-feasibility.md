# 第二轮审查：技术实现可行性

- 审查对象：`docs/audits/dispatch-spec-20261112.md`（任务 A → ZCode；任务 B → Trae）
- 审查人：reviewer-feasibility（DSH 子会话）
- 基线：HEAD `7cfd449` / v4.83.0；`main.js` 实测 4,911,886 B（与规格第 5 行一致）
- 方法：实读配置与门禁脚本 + 只读探测（无 `--update-baseline`、未跑全量 preflight）；**除本文件外未修改仓库任何文件**。探测用临时目录在系统 TEMP，已清理。
- 审查纪律：每条结论都有文件行号或命令输出；数字全部真数（如 28 步）。

---

## 结论

**有条件可行。**

- **任务 A：有条件可行。** 四项交付（脚本 / 基线 / npm script / 单测）本身都落在现有技术栈内，没有不可实现的部分。但规格有 2 个**阻断级**缺陷：①「读覆盖率汇总」没有数据源——`test:cov` 根本不产出 `coverage-summary.json`，且 `coverage/` 被 gitignore；②A4-4 的「TS 测试 import `.mjs`」与 `allowJs:false` 冲突，而 A5 写范围又没允许配套声明文件。另有「无覆盖率产物时怎么办」未定义。不修规格，ZCode 的结果大概率是「交付物齐了、验收过不了」或被迫越界改 `vitest.config.ts`。
- **任务 B：有条件可行，但当前是重复派发。** 该交付物**已经存在**（`docs/audits/preflight-effectiveness-audit.md`，172 行，任务号 `DSH-20261111-02`），Trae 于 22:35:30 已发 `done` 回执。按现规格再派：B4-5「`git status` 只有该 md」在**当前工作树上必失败**（已有 3 个 modified + 2 个 untracked，且审查报告本身还会新增未跟踪文件）；B4-1 要求的「用命令核对步数」无现成命令、现有报告也缺该证据；B2 表格缺「命令」列。
- **一句话**：两个任务的技术前提都可以满足，但**不能按现在这版规格直接派发**——A 需补 3 处规格（数据源 / 缺产物语义 / import 方式），B 需改为「补交既有产出 + 补证据」或取消，并先收口工作树。

---

## 假设核实表

| # | 技术假设 | 核实结果 | 证据 | 影响 |
|---|---|---|---|---|
| 1 | `npm run test:cov` 产出 `coverage/coverage-summary.json` | **不成立** | `package.json:20` = `..."vitest.mjs" run --coverage`；`vitest.config.ts:12-15` reporter 只有 `['text','text-summary','html']`（第 14 行），无 `json-summary`；`coverage/` 实查 **879 个文件、0 个 `.json`**；历史审计已记过同一事实：`docs/audits/auto-cross-audit-2026-11-10-coverage-test-contracts.md:28`「coverage/coverage-summary.json 不存在（Istanbul HTML 产物才是本次数据源）」 | A2-1「读覆盖率汇总」无现成数据源；A4-1 在干净检出不成立 |
| 2 | 覆盖率可按目录聚合、字段结构可用 | **成立（但必须自产）** | 实测 CLI 覆盖 reporter 开关生效：`node node_modules/vitest/vitest.mjs run tests/unit/scripts/mailbox-lib.test.ts --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=<TEMP>` → 生成 `coverage-summary.json`，822 个键；结构 = `{ total: {...}, "<绝对路径>.ts": { lines/statements/functions/branches: {total,covered,skipped,pct} } }`（键是**绝对路径**，聚合前需转相对路径）| A2-1 可实现，但脚本得自己触发覆盖或解析 HTML |
| 3 | 无覆盖率产物时的行为已在规格中定义 | **不成立（规格遗漏）** | `coverage/` 在 `.gitignore:11`；A2-3 把 script 固定为 `"check:coverage": "node scripts/check-coverage.mjs"`（`dispatch-spec:28`），链里没有 `test:cov`；规格全文无「产物缺失/过期」场景 | A4-1「`npm run check:coverage` 退出码 0」在干净检出必失败；也容易用陈旧 HTML 冒充最新数据 |
| 4 | 「与现有 check-bundle.mjs 风格一致」可照抄 `--update-baseline --note` | **不成立** | `check-bundle.mjs:52-55` 解析 `--update-baseline/--note`；`:83-90` **缺 note 时自动生成默认 note**；`:111` 更新后 `exit 0`。即 check-bundle **不要求** note，与 A4-2「不带 `--note` 退出码 1」相反。真正「放宽必须写 note」的先例是 `check-view-tests.mjs:153-160` | A4-2 必须新写逻辑、不能照抄；A6 的「风格一致」措辞误导 ZCode |
| 5 | `.ts` 测试可静态 import `scripts/*.mjs` | **有条件成立** | `tsconfig.json:8` `"allowJs": false`；`:22` include 仅 `**/*.ts`。实测同配置下静态 import `.mjs`：`error TS7016: Could not find a declaration file ... implicitly has an 'any' type`，`EXIT=2`。仓库做法是配声明文件：`scripts/lib/mailbox-lib.d.mts:1-5`（注释：「实现是 .mjs，但要被 node 直接执行，测试用 TS 写，所以单独声明类型」），`tests/unit/scripts/mailbox-lib.test.ts:26-27` 静态 import 它 | A4-4 若静态 import 就必须新增 `.d.mts`，而 A5 允许清单（`dispatch-spec:46`）**没有它** |
| 6 | `scripts/` 下 `.mjs` 有被 vitest 测试的先例 | **成立** | `tests/unit/scripts/` 已存在（2 个测试）；`check-jsdoc-examples.test.ts:15-24` 用 `spawnSync(process.execPath, [SCRIPT, ...])` 测脚本；`worker-syntax-gate.test.ts:20-22` 用 `await import(pathToFileURL(...).href)` 动态 import `.mjs`（该写法 TS 不报 TS7016） | A4-4 有两条合规实现路径（动态 import / spawn），但 spec 未指定 |
| 7 | 新增一个 `scripts` 条目会触发别的门禁（scripts 列表 / 步数） | **不成立（不会触发）** | `check-docs.mjs:100-111` 只做单向校验「文档引用的 `npm run X` 必须存在」，**不校验** package.json 脚本是否都有文档；`check-automation.mjs:132-145` 只比对四文件版本号；`program-status.mjs:20` 只读 `pkg.version`；`tests/unit/architecture/support-qr-wiring.test.ts:16` 只断言 preflight 含 `check:support-qr` | 加 `check:coverage` 条目安全，不会连带红灯 |
| 8 | 加 script 会改变 preflight 步数 | **不成立（不会）** | `package.json:13` 的 preflight 是一整条字面量字符串，与 `scripts` 表条目无关；无任何脚本/测试校验 preflight 长度（全仓 grep `preflight.split|scripts.preflight` 零命中） | 「28 步不变量」可保持，A4-5 的第一半自动成立 |
| 9 | preflight 是 28 步 | **成立** | 实测解析：`node -e "const s=require('./package.json').scripts.preflight.split(' && '); console.log(s.length)"` → `28`（逐条清单见附录 A） | B 的前提正确 |
| 10 | 28 步引用的脚本都真实存在（无静默跳过） | **成立** | 逐条解析 28 步 → 底层命令 28/28 `exists=true`（附录 A）。注意：28 步**不都是 `check-*.mjs`**——含 `tsc`、`eslint`、`vitest`、`generate-template-assets.mjs`、`build-styles.mjs`、`check-css.js`、`program-status.mjs`、`scan-engine-instances.mjs`、`gen-support-qr.mjs`、`build`（4 个脚本链）等 | B4-1「28 步全表」可行；B 报告不能写成「28 个 check-*.mjs」 |
| 11 | B4-1「用命令核对步数」有现成命令可用 | **不成立** | `scripts/` 与 `tests/` 全仓无 preflight 步数统计脚本（grep `preflight` 相关只出现在文档）；现成可用的只是一行 `node -e`（见附录 A 命令） | Trae 需自建临时命令并把输出写进报告；建议 lead 在规格里直接给定该命令，避免各写各的口径 |
| 12 | `docs/audits/` 存在、可写 | **成立** | `git ls-files docs/audits/*` = 74 个已跟踪文件；Trae 22:35:03 刚在其中写入新文件；本报告也写在该目录 | B 的写范围无权限问题 |
| 13 | 任务 B 是全新任务 | **不成立（重复派发）** | `docs/audits/preflight-effectiveness-audit.md` 已存在（172 行，untracked）：`:3` 任务 `DSH-20261111-02`、`:4` 审计人 trae、`:17-48` 正好 28 行全表、`:50-108` 8 步深查、`:137-145` TOP3 排序；信箱有 Trae 22:35:30 的 `[RECEIPT] DSH-20261111-02`（`m-1794407730043`，状态 done）；新规格 TASK-ID 为 `DSH-20261112-02` | 直接重派 = 重复劳动 + 回执歧义；且现有文件缺 B4-1 的命令证据、缺 B2 的「命令」列，并非原样满足新验收 |
| 14 | B4-5「`git status` 只有该 md 文件」可满足 | **不成立（派发即刻为假）** | 实测 `git status --porcelain`：` M scripts/lib/mailbox-lib.d.mts`、` M scripts/lib/mailbox-lib.mjs`、` M tests/unit/scripts/mailbox-lib.test.ts`、`?? docs/audits/dispatch-spec-20261112.md`、`?? docs/audits/preflight-effectiveness-audit.md`；且 mailbox 三文件 mtime 22:36:01–22:37:04，**晚于本会话启动（22:35:43），仍在被其它会话修改**。此外三份对抗审查报告本身还会在 `docs/audits/` 产生新 untracked 文件 | B4-5 必须改写为「本任务写范围仅该 md」或由 lead 先收口工作树 |
| 15 | A4-6「`git diff --stat` 不含 ui/engine/shared/services」 | **成立（按当前树）** | 实测 `git diff --stat` 只有 `scripts/lib/mailbox-lib.*` 与 `tests/unit/scripts/mailbox-lib.test.ts`，不涉四目录；新增未跟踪文件默认不出现在 `git diff --stat` | 该验收判据偏弱（几乎必然通过），但不阻断 |
| 16 | A4-5「`npm run preflight` 仍 28 步且 EXIT=0」可完成 | **成立（有前提）** | 28 步含全量 `test`（727 个 `tests/**/*.test.ts`）、`lint`、`typecheck`、`build`；无门禁校验步数，链未动即 28。前提是执行窗口内工作树稳定——当前有并发写入 | 可行，但耗时且受并发干扰；建议 ZCode 在回执里记录执行时 `git status` 快照 |
| 17 | D2 的「`ui/` 覆盖率 8.68%」口径明确 | **存疑** | 现成 Istanbul HTML：`coverage/index.html:892-903` 的 **`ui/views`** 行 = statements 8.68%（403/4638）、lines 7.69%；`:712-723` 的 **`ui`** 行 = statements 9.66%、lines 9.71%。`docs/LONG-TERM-GOAL.md:302` 写的是「`ui/views` 域整体 8.68%」，同文件 `:341` 又写「`ui/` 覆盖率 8.68%」；新规格 A1 沿用「`ui/` 覆盖率 8.68%」 | A2-2 基线 key（`ui` 还是 `ui/views`）、A4-3 里「`ui` 的 `lines` 改 99」到底对应哪个数字，需 ZCode 明确写进基线文件与 `--help` |
| 18 | 规格基线数字可信 | **成立** | `main.js` 实测 4,911,886 B = `dispatch-spec:5`；`HEAD 7cfd449` 与 git log 一致；`ahead 0` 与 `git status -sb` 一致 | 规格基线部分无需修 |

---

## 阻断项

### F1 [阻断 · 任务 A] 覆盖率数据源不存在：`test:cov` 不产 `coverage-summary.json`，且 `coverage/` 不入仓

- **假设**：A2-1「读覆盖率汇总 → 按目录聚合」有一个现成的机器可读汇总可读；A4-1 只要求 `npm run check:coverage` exit 0。
- **实际**：
  - `test:cov`（`package.json:20`）只启用 `text / text-summary / html` 三个 reporter（`vitest.config.ts:14`），**不产任何 JSON**；
  - `coverage/` 被 `.gitignore:11` 忽略，干净检出没有产物；实测现有 `coverage/` 879 个文件里 **0 个 `.json`**；
  - A2-3 又把 npm script 固定为 `node scripts/check-coverage.mjs`（`dispatch-spec:28`，链里没有 `test:cov`）；
  - A5 写范围（`dispatch-spec:46-47`）**不允许**改 `vitest.config.ts`（加一行 `'json-summary'` 是最省事的正解，但越界）；
  - 规格全文没有定义「覆盖率产物缺失 / 过期」时脚本怎么办。
- **证据**：`package.json:20`；`vitest.config.ts:12-15`；`.gitignore:11`；`coverage/` 实查输出（879 文件 / 0 JSON）；`docs/audits/auto-cross-audit-2026-11-10-coverage-test-contracts.md:28`；探测命令（临时目录）确证 `--coverage.reporter=json-summary` 可让 vitest 产出该文件。
- **对任务的影响**：ZCode 面对三种选择，每种都与现规格有冲突：
  1. **解析 `coverage/index.html`**：能读（目录行如 `:712`/`:892`），但 HTML 的根行是**本层目录**聚合，递归按目录求和要自己走嵌套页；数据还只代表「上次跑过的覆盖率」，干净检出/CI 必失败；天然可被陈旧产物糊弄。
  2. **脚本内部 spawn 覆盖率运行**：`spawnSync(node, [vitest.mjs,'run','--coverage','--coverage.reporter=json-summary','--coverage.reportsDirectory=<tmp>'])` 实测可行，但 A4-1/A4-2/A4-3 每次验收都等于跑一遍全量覆盖率，耗时不可控（见 Q3）。
  3. **改 `vitest.config.ts` 加 `json-summary`**：最干净，但违反 A5。
- **建议改法**（任选，需 lead 拍板后写进规格）：
  - **改 A2-3**：`"check:coverage": "npm run test:cov && node scripts/check-coverage.mjs"`，并允许 `vitest.config.ts:14` 增加 `'json-summary'`（写明这是 A5 的例外，仅此一行）；
  - 或 **在 A2-1 明确**：「脚本自身以子进程跑 `vitest run --coverage --coverage.reporter=json-summary`，读临时目录」，并接受耗时；
  - 无论哪种，**补一条场景**：「产物的 `generatedAt`/mtime 早于最新源码或缺失 → exit 1，并提示先运行 `npm run test:cov`」；
  - A4-1 前面补「先 `npm run test:cov`」前置步骤，否则「exit 0」不可复现。

### F2 [阻断 · 任务 A] A4-4 的 TS 单测静态 import `scripts/check-coverage.mjs` 无法通过 typecheck，而 A5 不允许新增声明文件

- **假设**：`tests/unit/scripts/check-coverage.test.ts` 可以直接 `import {...} from '../../../scripts/check-coverage.mjs'`。
- **实际**：`tsconfig.json:8` `"allowJs": false`；实测同配置静态 import `.mjs` 报 `TS7016`、`EXIT=2`（临时工程探测，2026-11-11）。仓库里的正解是配 `scripts/lib/mailbox-lib.d.mts`（`mailbox-lib.d.mts:1-5` 明说是为了 TS 测试）；但 A5 允许清单（`dispatch-spec:46`）只有 4 项，**不含 `scripts/check-coverage.d.mts`**。
- **证据**：`tsconfig.json:8,22`；`scripts/lib/mailbox-lib.d.mts:1-5`；`tests/unit/scripts/mailbox-lib.test.ts:26-27`；tsc 探测输出 `error TS7016 ... EXIT=2`。
- **对任务的影响**：A4-4（`npx vitest run ...` 全绿）在 `npm run preflight` 的 `typecheck` 步骤会红（vitest 能跑，但 `tsc --noEmit` 会挂）。ZCode 只有两条合规出路：动态 `import(pathToFileURL(...).href)`（先例 `tests/unit/architecture/worker-syntax-gate.test.ts:21`）或 `spawnSync` 调 CLI（先例 `tests/unit/scripts/check-jsdoc-examples.test.ts:15-24`）；若选静态 import 就必须写 `.d.mts` 从而越界。
- **建议改法**：A5 允许清单补 `scripts/check-coverage.d.mts`（推荐，与 `mailbox-lib.d.mts` 先例一致）；或在 A2-4/A4-4 明确要求「测试用动态 import 或 spawn，不得新增声明文件」。

### F3 [阻断 · 任务 B] 任务 B 是重复派发：交付物已存在、对应任务已完成

- **假设**：任务 B 是新工作。
- **实际**：`docs/audits/preflight-effectiveness-audit.md` 已存在（untracked，172 行，2026-11-11 22:35:03 写入）：`:3` 任务号 `DSH-20261111-02`、`:4` 审计人 trae、`:17-48` 恰好 28 行全表、`:50-108` 8 步深查、`:137-145` TOP3 排序——B2/B4-2/B4-3/B4-4 基本已满足。信箱有 Trae 22:35:30 的 `[RECEIPT] DSH-20261111-02`（状态 done，证据段与文件内容一致）。
- **证据**：上述文件行号；`mcp novel-mailbox` 消息 `m-1794406614187`（派发）与 `m-1794407730043`（回执）。
- **对任务的影响**：Trae 要么把已有文件原样提交（那 B4-1 的「命令核对步数」仍缺），要么重做一遍（浪费且可能与旧文件冲突）；回执里也说不清「这次做了什么」。另外现有报告**缺 B2 要求的「命令」列**（`:19` 表头是 步骤/扫描范围/是否空转/风险/依据/建议，没有单独的 `命令` 列），严格按 B2 不达标。
- **建议改法**：把 B 改成「**补交** `DSH-20261111-02` 产出」：①在报告里补一列/一段「命令」与 28 步命令清单；②补附录 A 的步数核对命令输出；③`git add` 该 md 并提交推送。或取消 B、由 lead 自行提交该文件。

### F4 [阻断 · 任务 B] B4-5「`git status` 只有该 md」在派发即刻就不成立（且并发仍在写）

- **假设**：执行时工作树干净，B 只产生一个新增 md。
- **实际**（2026-11-11 22:46 实测）：
  ```
   M scripts/lib/mailbox-lib.d.mts
   M scripts/lib/mailbox-lib.mjs
   M tests/unit/scripts/mailbox-lib.test.ts
  ?? docs/audits/dispatch-spec-20261112.md
  ?? docs/audits/preflight-effectiveness-audit.md
  ```
  且 mailbox 三文件 mtime = 22:36:01 / 22:36:10 / 22:37:04，**晚于本会话启动（22:35:43）**——有其它会话正在并发写；`preflight-effectiveness-audit.md` 本身也是 untracked。三份对抗审查报告（本文件即其一）还会继续在 `docs/audits/` 增加 untracked 文件。
- **证据**：上述 `git status --porcelain` 与 mtime 输出。
- **对任务的影响**：B4-5 是机器判据，Trae 无论怎么做都无法让「`git status` 只有该 md」成立（除非它去提交/回滚别人的在途改动——而这被 B5「禁止修改其他任何文件」直接禁止，且会误伤并发工作）。
- **建议改法**：B4-5 改为「本任务写范围仅 `docs/audits/preflight-effectiveness-audit.md`；`git status --porcelain -- docs/audits/preflight-effectiveness-audit.md` 只显示该文件（新增/修改）」，或由 lead 先把 3 个 mailbox 文件 + dispatch-spec 收口（提交/暂存），再派 B。

---

## 存疑项（需 ZCode/Trae 自行确认）

1. **D2 口径**（对应核实表 #17）：8.68% 是 `ui/views` 的 **statements**（`coverage/index.html:892-903`），不是 `ui/` 整体的 lines（`:712-723` 为 9.66% statements / 9.71% lines）。A2-2 的基线 key、A4-3 里「`ui` 的 `lines` 改 99」到底指哪个粒度，ZCode 必须在脚本 `--help` 与基线文件里写清；建议同时记录 `ui`（递归）与 `ui/views` 两个 key，避免继续沿用含糊的「ui/ 覆盖率」。
2. **A4-2 与 A6 的措辞冲突**：A6 说「与现有 `check-bundle.mjs` 风格一致」，但 check-bundle 恰恰是「缺 note 自动生成默认 note 并 exit 0」（`check-bundle.mjs:83-90,111`）。A4-2 要求相反。ZCode 应按 A4-2 的严格语义实现（参考 `check-view-tests.mjs:153-160` 的拒绝路径），并在脚本头注释说明「与 check-bundle 的差异」，不要照抄。
3. **全量覆盖率耗时**：若采用「脚本自跑覆盖率」，`npm run check:coverage` 每次就是一次全量 `vitest run --coverage`（727 个测试文件）；单文件探测约 1 分钟量级，全量会显著更久。A4-1/2/3 各跑一次的总耗时 ZCode 需实测并在回执给数字；如果不可接受，请回到 F1 的另一种改法。
4. **A4-2/A4-3 的「假阳性」风险**：若脚本在「无覆盖率产物」时也 `exit 1`，A4-2 会「因为没数据所以退出 1」而通过（验收假阳性）。建议规格补一句：A4-2 的 stderr 必须同时含 `note`/`--note` 字样；A4-3 必须含 `基线 99 vs 实际` 字样（现有 A4-3 已有该要求，保持）。
5. **并发写窗口**：mailbox 三文件在 22:36–22:37 仍被其它会话修改；A4-5（全量 preflight）、A4-6（`git diff --stat`）、B4-5（`git status`）的判据都会被并发改动直接干扰。建议 lead 为 A/B 的验收设冻结窗口，或要求执行方在回执里贴「执行时刻的 `git status --porcelain` 快照 + HEAD」。
6. **步数与手册不一致**：`docs/handbook/06-gates-and-release.md:13` 仍写「24 步」（实际 28，见附录 A）。B 报告引用 28 步时最好指出该文档漂移；但 B5 禁止改其他文件，所以**不能顺手修手册**，需要 lead 另派或授权。
7. **B4-1 命令建议统一**：lead 可在规格里直接给命令，避免 Trae 自创口径：
   ```bash
   node -e "console.log(require('./package.json').scripts.preflight.split(' && ').length)"
   ```
   实测输出 `28`（完整清单见附录 A）。

---

## 结论：现在派发能不能按规格完成

**不能按现在这版规格直接派发；修订后可以。**

- **ZCode / 任务 A**：技术上是「能做到」，但不是「按规格能验收」。
  - 能做：`scripts/check-coverage.mjs`（聚合 + 棘轮 + `--note` 强制 + 退出码）、`.coverage-baseline.json`、`package.json` 一条 script、≥8 用例的测试——都在现有脚本范式内，参考 `check-bundle.mjs` / `check-view-tests.mjs` / `check-jsdoc-examples.test.ts` 即可。
  - 做不到/做不齐（按现规格）：A4-1「`npm run check:coverage` exit 0」在干净检出没有数据源（F1）；A4-4 静态 import 会被 `tsc --noEmit` 判 TS7016，且 A5 不给声明文件位置（F2）。
  - 结论：**修正 F1/F2 后即可派发**（约 2 处规格改动 + 1 个例外授权），ZCode 可在半天内完成并自证。
- **Trae / 任务 B**：技术上「早就做完了」，现在派发属于重复劳动，而且有一项验收（B4-5）在当前工作树**必然失败**（F4），一项证据（B4-1 的步数命令）在既有产出里缺失（F3）。
  - 能做的：补「命令」列 + 步数命令输出 + 提交推送，半小时级。
  - 不能做的：在不动别人在途文件的前提下满足 B4-5。
  - 结论：**先由 lead 收口工作树，再把 B 改为「补交既有产出 + 补证据」；否则不要派发。**

---

## 附录 A：preflight 28 步实测清单（2026-11-11 22:44 核对）

核对命令（可复现步数；逐步解析用同构 `node -e`，见下）：

```bash
node -e "console.log(require('./package.json').scripts.preflight.split(' && ').length)"   # -> 28
```

| # | 步骤 | 底层命令/脚本 | 文件存在 |
|---|---|---|---|
| 1 | typecheck | `tsc --noEmit` | ✅（`node_modules/typescript`） |
| 2 | lint | `eslint . --max-warnings 1890` | ✅ |
| 3 | test | `node ... node_modules/vitest/vitest.mjs run` | ✅（`node_modules/vitest/vitest.mjs`） |
| 4 | check:templates | `scripts/generate-template-assets.mjs --check` | ✅ |
| 5 | check:styles | `scripts/build-styles.mjs --check` | ✅ |
| 6 | check:css | `scripts/check-css.js` | ✅ |
| 7 | check:inline-styles | `scripts/check-inline-styles.mjs` | ✅ |
| 8 | check:obsidian-api | `scripts/check-obsidian-api.mjs` | ✅ |
| 9 | check:secrets | `scripts/check-secrets.mjs` | ✅ |
| 10 | check:deps | `scripts/check-dependencies.mjs --baseline .arch-baseline.json --require-baseline` | ✅ |
| 11 | check-engines | `scripts/scan-engine-instances.mjs --check --baseline .arch-baseline.json --require-baseline` | ✅ |
| 12 | check:program | `scripts/program-status.mjs --check` | ✅ |
| 13 | check:relationship-authority | `scripts/check-relationship-authority.mjs` | ✅ |
| 14 | check:silent-failures | `scripts/check-silent-failures.mjs` | ✅ |
| 15 | check:hotpaths | `scripts/check-hotpath-scans.mjs` | ✅ |
| 16 | check:write-entry | `scripts/check-write-entry.mjs` | ✅ |
| 17 | check:linked-scenarios | `scripts/check-linked-scenarios.mjs` | ✅ |
| 18 | check:automation | `scripts/check-automation.mjs` | ✅ |
| 19 | check:dsh-isolation | `scripts/check-dsh-isolation.mjs` | ✅ |
| 20 | check:jsdoc | `scripts/check-jsdoc.mjs` | ✅ |
| 21 | check:any | `scripts/check-any-budget.mjs` | ✅ |
| 22 | check:view-tests | `scripts/check-view-tests.mjs` | ✅ |
| 23 | check:changelog | `scripts/check-changelog.mjs` | ✅ |
| 24 | check:docs | `scripts/check-docs.mjs` | ✅ |
| 25 | check:support-qr | `scripts/gen-support-qr.mjs --check` | ✅ |
| 26 | build | `scripts/sync-version.js && scripts/generate-template-assets.mjs && scripts/build-styles.mjs && scripts/build.js` | ✅（4 个） |
| 27 | check:bundle | `scripts/check-bundle.mjs` | ✅ |
| 28 | check:release | `scripts/check-release.mjs` | ✅ |

## 附录 B：本次只读探测记录

| 探测 | 命令/对象 | 关键结果 |
|---|---|---|
| 覆盖率产物 | `coverage/` 目录枚举 | 879 个文件、**0 个 `.json`**；`coverage-summary.json`、`coverage-final.json` 均不存在 |
| reporter 可否产 JSON | `vitest run <1 file> --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=<TEMP>` | 生成 `coverage-summary.json`（822 键），阈值虽报错但文件已写；键为**绝对路径** |
| TS 静态 import `.mjs` | 临时工程，`allowJs:false`、`strict:true` | `error TS7016 ... EXIT=2` |
| preflight 步数/脚本存在性 | `node -e` 解析 package.json | `steps=28`，28/28 底层脚本 `exists=true` |
| 工作树状态 | `git status --porcelain` | 3 modified + 2 untracked（含并发写入，mtime 22:36–22:37） |
| 步数文档 | `docs/handbook/06-gates-and-release.md:13` | 写「24 步」，与实测 28 不一致（文档漂移，非门禁失败） |

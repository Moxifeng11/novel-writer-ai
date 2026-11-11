# 第三轮审查：风险与漏洞

- 审查对象：`docs/audits/dispatch-spec-20261112.md`（2026-11-11 22:35 草案；任务 A→ZCode、任务 B→Trae）
- 审查基线：v4.83.0 / HEAD `7cfd449`；工作树含 dsh 在途改动（见 R6，取数时点 22:37 与 23:06 两次核对）
- 注意：审查前后 dsh 正在改动门禁脚本（`check-view-tests` 重构），HEAD 与工作树会继续变化；派发前请以派发时点的 `git rev-parse HEAD` + `git status --porcelain` 重新核对一次，本报告的 R6/B4-5 结论不受影响但数字需刷新。
- 取证时间：2026-11-11 22:35–23:10（Asia/Shanghai）
- 方法：只读核对仓库现状、门禁脚本真实行为、信箱与自动化台账；与前两轮分工不重叠——第一轮（逻辑）L1/L2/L5、第二轮（可行性）F1–F4 已论证的「任务 B 重复派发」「无 coverage-summary.json」「TS import .mjs 需 .d.mts」等，本轮不重复论证，只补攻击面与可直接抄进规格的加固措辞。
- 本轮未执行 `npm run test:cov` / `npm run preflight`（避免在共享工作树上与在途改动/其他 agent 互踩，且耗时长）；相关结论基于配置、生成脚本与既有审计记录，均给出可在 10 秒内复核的证据。

## 结论

**有高风险需先补约束。不建议按现规格派发。**

- **任务 A：不可按现规格派发。** R1/R2/R3/R4/R5 任意一条都会让交付物「看起来完成、实际不是门禁」，或让 ZCode 要么越界、要么验收必失败：
  - R1 是规格自相矛盾（新增 npm script 必然改动 `docs/generated/gates.md`，A5 未授权，A4-5 又要求 preflight 绿）；
  - R2 是「基线数字从哪来」完全没定义，而仓库现存的唯一覆盖率产物是 20 分钟前、比最新源码还旧的 HTML；
  - R3 是交付后没有任何自动执行路径，门禁交付即「纸面门禁」；
  - R4 是棘轮方向与更新规则可被「下调基线」吞回退；
  - R5 是验收方/证据形态未定，ZCode 自证可以蒙混。
- **任务 B：建议 `[VOID]` 撤回，不要按现规格重派。** 该交付物 `docs/audits/preflight-effectiveness-audit.md`（172 行，任务号 `DSH-20261111-02`）已于 2026-11-11 22:35 由 Trae 交付并在信箱回执 `done`（消息 `m-1794407730043`）；新规格 B4 的机器判定（28 行表、带 `文件:行号`、≥3 步、TOP3 不并列）旧文件**几乎原样满足**——重派的结果必然是「拿旧文件冒充新交付」，这正是本项目要消灭的自欺。若确要继续深挖，应改名 `preflight-effectiveness-audit-r2.md` 并强制新增实证证据（见 R8/R9 与约束 17）。

本轮新增、前两轮未覆盖的三条硬发现（可直接复核）：

1. **R1（阻断）**：`scripts/gen-docs.mjs:172-201,221` 从 `package.json` 的 scripts **生成** `docs/generated/gates.md`；`scripts/check-docs.mjs:151-160` 用 `gen-docs --check` 校验漂移；`package.json:13` 的 preflight 第 24 步是 `check:docs`。所以「只加一个 scripts 键」**必改** `docs/generated/gates.md`：不改 → `check:docs` 红 → A4-5 失败；改 → 超出 A5 允许清单。
2. **R2（阻断）**：`coverage/` 目录现有 879 个文件、**0 个 `.json`**（本轮实测；`vitest.config.ts:14` 只有 `text/text-summary/html` 三个 reporter，`.gitignore:11` 忽略 `coverage/`）；唯一「现成数据」是 `coverage/` 的 HTML，mtime **21:16:26**，而源码在 21:45/21:53/22:00 还有三次 `ui/` 提交（`2153d8e`/`954ad14`/`4c5ad9f`）——用陈旧 HTML 生成的基线，锁的是错误的代码状态。
3. **R7（中）**：本机 `node -v` = **v24.16.0**，`.nvmrc` = **20**，CI（`.github/workflows/ci.yml:28`）与 release（`release.yml:29`）都是 **20**；v8 覆盖率 remap 随 Node/vitest 版本变化，基线若在 24 下生成、流水线在 20 下校验，会周期性假红/假绿——IT 层最典型的「棘轮噪声→随手 update-baseline」诱因。

## 风险清单

### R1 [等级: 高 · 派发前必堵] 新增 npm script 必然改动 `docs/generated/gates.md`，但 A5 写范围没授权——A2-3 与 A4-5 在现规格下互斥

- **攻击面/失败模式**：`gen-docs.mjs` 的 `renderGates()` 遍历 `pkg.scripts` 的全部键（`:183-185`），把 `check:coverage` 加进 scripts 后生成物必然多一行；preflight 第 24 步 `check:docs` 内部执行 `node scripts/gen-docs.mjs --check`（`check-docs.mjs:151-160`），漂移即 exit 1。CI 的 docs 步骤（`ci.yml:64-71`）和「生成物漂移」步骤（`ci.yml:91`）同样会红。
- **可利用路径**：
  1. ZCode 按 A2-3 只改 `package.json` → A4-5 `npm run preflight` 在 check:docs 处失败 → 回执只能写 `blocked`（实际是规格漏洞，不是能力问题）；
  2. ZCode 为了过 A4-5 运行 `npm run gen:docs` 重新生成 `docs/generated/gates.md` 并提交 → 直接违反 A5「允许清单」；而 A4-6 只禁 `ui/engine/shared/services`，**抓不到**这次越界（`git diff --stat` 甚至因已提交而为空）；
  3. ZCode 干脆跳过 A4-5 只做本地验收 → 门禁在 CI 上红，但验收者若不看 CI 仍会当 done。
- **规格现状**：没有约束。A5（`dispatch-spec:46-47`）允许清单只有 4 项，A4-5（`:41`）却要求 preflight 绿，两者不可同时满足。
- **建议加固**（可直接写进规格）：
  - A5 允许清单增加一条：`docs/generated/gates.md`（**只允许**通过 `npm run gen:docs` 重新生成，禁止手改；生成时间接改 `scripts/gen-docs.mjs` 的 `SCRIPT_DESCRIPTIONS` 仍属越界）。
  - A4-5 拆成 4 个可判定项：
    ① `node -e "console.log(require('./package.json').scripts.preflight.split('&&').length)"` 输出 `28`（命令输出原文贴进回执）；
    ② `node scripts/gen-docs.mjs --check` exit 0；
    ③ `git show --name-status <ZCode 提交>` 里 `docs/generated/gates.md` 仅内容更新，且 `git show -U0 <提交> -- docs/generated/gates.md` 只允许新增 `check:coverage` 一行、preflight 展开块（`gates.md:68-98`）逐字节不变；
    ④ `npm run preflight` 末尾 EXIT=0。

### R2 [等级: 高 · 派发前必堵] 覆盖率基线可被「陈旧 / 部分 / 手写」三种数据源污染——指标游戏的主入口

- **攻击面/失败模式**：
  - 仓库**没有**机器可读覆盖率产物（`coverage/` 0 个 JSON），`test:cov`（`package.json:20`）也只产 HTML；`check:coverage` 若「读覆盖率汇总」，实现者必须自己决定数据源；而唯一能马上读到的 `coverage/index.html` 是 **21:16 的旧运行**（源码 21:45–22:00 仍在改）。
  - 历史先例：`docs/audits/auto-cross-audit-2026-11-10-coverage-test-contracts.md:28` 明确记录过「coverage-summary.json 不存在（Istanbul HTML 产物才是本次数据源）」——即上一批人就是用 HTML 取数的。
- **可利用路径**（每条都能让 A4 全绿、门禁失真）：
  1. **解析陈旧 HTML**：基线 = 21:16 那版代码的数字，与 HEAD 不一致；若旧值偏高 → 门禁此后永久红（诱因是手改基线）；若偏低 → 门禁永远不触发；
  2. **只跑子集生成 JSON**：`vitest run tests/unit/scripts/check-coverage.test.ts --coverage --coverage.reporter=json-summary`（第二轮已实测该开关可用）→ summary 只含被 import 的文件，ui/ 或缺或接近 0，基线锁在「几乎全绿」的低值；
  3. **手写基线**：数字全凭作文，A4-1/A4-2/A4-4/A4-5 全部照过；A4-3 只要求 `ui` 键存在且被比较，不校验数值真实性；
  4. **百分比简单平均**：不按 covered/total 加权，而是对文件 pct 取算术平均 → 大量小文件 100% 把 ui 抬到贴近 100%；
  5. **聚合范围裁剪**：只聚合「有文件的目录」或排除 `ui/full-writer` 等难目录 → 数字好看且未来回退不可见。
- **规格现状**：A2-1「读覆盖率汇总」未定义文件、未定义缺失行为；A2-2 未定义 schema/聚合算法/数据来源命令；A4 没有任何「基线必须与独立复算一致」的判定。
- **建议加固**：
  - 派发前由 dsh 单独提交一行 `vitest.config.ts:14`：`reporter: ['text', 'text-summary', 'html', 'json-summary']`（本任务前置条件，不算 ZCode 越界）；之后 `npm run test:cov` 即产 `coverage/coverage-summary.json`。
  - A2-1 改为：`check:coverage` 只读 `coverage/coverage-summary.json`；**文件不存在 / JSON 解析失败 / 文件 mtime 早于 `engine|ui|services|shared|core|domains` 下最新 `.ts` 文件 mtime** → `exit 2` 并打印 `npm run test:cov`；禁止解析 HTML、禁止硬编码、禁止手写基线（仿 `scripts/check-e2e-fresh.mjs` 的新鲜度思路）。
  - A2-2 schema 钉死：`{ schemaVersion, generatedAt, note, sourceCommand, commit, worktreeDirty, node, vitest, summarySha256, directories: { "<dir>/": { lines|statements|functions|branches: { covered, total, pct } }, ... }, targets: { "ui/views/": 30 } }`；聚合必须 count-weighted（`sum(covered)/sum(total)`），键为**仓库相对路径**（`coverage-summary.json` 的键是绝对路径，直接入库会泄漏本机路径且 CI 必然对不上）；目录键固定为 `ui/`、`ui/views/`、`engine/`、`services/`、`core/`、`shared/`、`domains/`。
  - 生成基线必须用固定命令并记录 provenance：`npm run test:cov && node scripts/check-coverage.mjs --update-baseline --note "<原因>"`，且要求 `git status --porcelain` 为空时才能生成（避免把别人在途改动算进基线，见 R6）。
  - 验收（dsh 执行）增加「独立复算」：用一行 Node 从同一份 `coverage-summary.json` 独立算 `ui/views` 与 `ui/` 的 lines，与脚本输出比对，误差 > 0.01pp 即拒收；并用文档既有数字做合理性边界：`ui/views` lines ≈ 8.68%±2pp、`ui/**` lines ≈ 12.04%±2pp、总量 lines ≈ 46.77%±3pp（依据 `docs/LONG-TERM-GOAL.md:246,302-313`、`vitest.config.ts:90-93`），超出即视为陈旧/伪造基线。

### R3 [等级: 高 · 派发前必堵] 新门禁不进 preflight（合理，但也没进 CI / preflight:release）→ 交付即「纸面门禁」，正好复刻本任务 B 审计出的头号病

- **攻击面/失败模式**：A2-3 明确「不加入 preflight 链」，规格全文没有任何「谁会运行 check:coverage」的约定。CI 覆盖率门禁只有 `npm run test:cov`（`ci.yml:76-77`），阈值是 `ui/**` lines 10 这种粗口径（`vitest.config.ts:94-99`）；release 路径同样只跑 `test:cov`（`release.yml:74-75`）。新脚本交付后，**没有任何自动路径会运行它**——下一次覆盖率回落依然「没人知道」，与 A1 陈述的痛点完全相同。
- **可利用路径**：
  1. ZCode 交脚本 + 基线 + 单测 → A4 全绿 → 回执 done；之后三个月无人运行；
  2. dsh 在 `docs/LONG-TERM-GOAL.md` §2.2 记一笔「新增覆盖率门禁」，D2「已被门禁保护」进入话术——而实际上这是一条死代码，属于「以为生效了但没生效」的元版本；
  3. 若把 check:coverage 硬塞进 preflight（29 步），又会破坏「28 步不变量」并让每次 preflight 多跑一遍全量测试。
- **规格现状**：无约束；`preflight:release`（`package.json:14`）是现成的、不属于 28 步链的挂载点，规格没提。
- **建议加固**：
  - A2-3 增加：`"preflight:release": "npm run preflight && npm run test:cov && npm run check:coverage"`（只改 scripts 段，不碰 28 步 preflight；A4-5 仍成立）。
  - 明确归属：**CI 接线由 dsh 在 ZCode push 之后单独提交**（`ci.yml` 的 test:cov 步骤后加 `npm run check:coverage`；`release.yml` 同理），写进共同约束，禁止 ZCode 改 `.github/`。
  - 验收证据增加：`npm run preflight:release` EXIT=0 + GitHub CI run 链接（success）。
  - 若本轮不接 CI：`docs/LONG-TERM-GOAL.md` 里禁止写「D2 已由门禁保护」，只能写「有本地脚本，未接入流水线」——否则按「未收口」处理。

### R4 [等级: 高 · 派发前必堵] 棘轮可被「下调基线」吞回退；A4 只测「缺 note」不测「放水」；首基线锁低值与 D2 30% 目标不闭环

- **攻击面/失败模式**：A6（`dispatch-spec:51-53`）只规定「上调基线必须 `--update-baseline --note`」，A4-2 只验「不带 note → exit 1」。覆盖率棘轮真正危险的方向是**下调**（放宽）：覆盖率掉了，跑一次 `node scripts/check-coverage.mjs --update-baseline --note "环境波动"` 就把基线降到当前值，门禁以后再也抓不到这段回退。规格里没有任何「拒绝下调」「谁批准下调」的条款；而 A1 的「只降不升的棘轮基线」措辞本身方向混乱（覆盖率应是只升不降，见第二轮/第一轮同点）。
- **可利用路径**：
  1. 覆盖率从 12% 掉到 9% → check 红 → `--update-baseline --note "临时放宽"` → 基线永久 9% → 回执「已修复」；
  2. 首次基线生成在同一轮内选「最低的那次运行」（例如某次测试抖动）→ 锁在低值，此后任何回退都能容纳；
  3. 基线锁的是 ui/** ≈12%，而 D2 目标是 `ui/views` ≥30%（`docs/LONG-TERM-GOAL.md:246`）——新门禁只防「不许掉」，不度量「离目标多远」，但台账很容易被读成「D2 已机制化」。
- **规格现状**：只有 A6 一句「上调必须 note」，且方向词与覆盖率语义相反；A4 未覆盖下调/篡改/空 note（带空格）等场景。
- **建议加固**：
  - 脚本语义：任一指标低于旧基线 → exit 1；`--update-baseline` 只允许「收紧」（任何指标不得低于旧值），下降低必须显式 `--allow-regression`；`CI=true` 时 `--allow-regression` 直接拒绝；每次更新写 `history: [{at, commit, before, after, note, allowRegression}]`，note 去空白后 <8 字拒绝（仿 `scripts/check-bundle.mjs:82-111` 的 note 追加模式）。
  - A4 增补用例：①`--update-baseline --note "x"` 导致任一指标下降 → exit 1；②`--note ""` 与 `--note "   "` → exit 1；③首基线必须含全部目录键，且**逐键篡改**（把任一目录键 lines 改成「实际+2pp」）都必须 exit 1（证明不是只比总行/只比 ui）。
  - 基线加 `targets: { "ui/views/": 30 }`，stdout 固定打印 `ui/views/ lines 8.68% (baseline 8.68%, target 30.00%, gap 21.32pp)`；dsh 更新 LONG-TERM-GOAL §2.2 时必须同时写「锁定基线/距目标差距/仍靠阶段任务推进」。

### R5 [等级: 高 · 派发前必堵] 验收方与证据形态未定义：ZCode 自证可蒙混；A4-3 手工改基线有污染提交路径；A4-6 在「提交后」是真空判定

- **攻击面/失败模式**：
  - A4 标题写「全部可机器判定」但没写**由谁判定**；协作协议默认 dsh 验收，规格没落字。ZCode 回执「测试通过」即可，且 A4-4 只数用例数。
  - A4-3 要求「手工把基线 ui.lines 改成 99」——执行者若忘了恢复并提交，坏基线入库；若由 dsh 执行，又没有说明脚本是否支持只读 `--baseline` 覆盖，只能改真文件。
  - A4-6「`git diff --stat` 不含 ui/engine/shared/services」在任务要求「提交、推送」之后恒为空 → 真空通过；且它没有覆盖 `core/`、`domains/`、`utils/`、`vitest.config.ts`、`package-lock.json`。
  - A4-4「≥8 用例」可以写成 8 个空断言（`expect(typeof x).toBe('object')`），A4-4 照样过；`scripts/**` 与 `tests/**` 都被 eslint 忽略（`eslint.config.mjs:37-38`），新脚本/测试没有任何静态门禁兜底。
- **可利用路径**：
  1. ZCode 写 8 个永远为真的用例、脚本只读一次陈旧 HTML → A4 全绿；
  2. 手工改基线 99 验完不恢复，`git add -A` 一起提交 → dsh 若不看提交内容无法发现；
  3. 回执只贴「`npx vitest run ... 8 passed`」→ 没有 commit、没有命令、没有 CI 链接。
- **规格现状**：共同约束只要求回执「五项」，未要求 commit/命令块/CI；未指定验收方；A4-3 无恢复/复验步骤。
- **建议加固**：
  - 明确写死：「A4 六条由 dsh 执行并复跑；ZCode 只提供可复现命令与输出，ZCode 自证不计证据」。
  - A4-3 改为：脚本须支持只读 `--baseline <path>`（只读、不得写该路径）；dsh 在 `tmp/`（`.gitignore:12` 已忽略）复制基线并改成「实际值+2pp」，逐目录键各验一次 exit 1；验收结束 `git status --porcelain` 必须与验收前完全一致。
  - A4-4 增补变异验证：dsh 在 `tmp/` 复制脚本，把比较符改反（`>`↔`<`），跑单测必须失败——证明 8 条测试不是空断言；并给出必测矩阵（约束 11）。
  - A4-6 改为提交级：`git show --name-status <ZCode 提交>` 只含 A5 白名单文件（R1 扩展后 5 项），且对 **6 个覆盖目录**（core/domains/engine/services/shared/ui）零删除、零重命名；禁止用 `git diff`（提交后为空）。
  - 回执证据格式固定：`git rev-parse HEAD`（=origin/master 末条）+ `git show --name-status` + 命令块（命令/退出码/关键 stdout）+ `npm run preflight` 末尾 EXIT 行 + GitHub CI run 链接 + `git status --porcelain` 空。

### R6 [等级: 中 · 派发时写进规格] 共享工作树 + 单 git 仓的并发写冲突：`git add -A` 会扫入 dsh 在途改动，目录级 add、并发 build/test:cov、push 竞态、文档顺序都会制造假失败/假完成

- **攻击面/失败模式**：三方共享**同一个工作目录**（不是 worktree），同一个 `.git/index`。本次审查期间（22:37→23:06）dsh 的在途改动从 3 个变成 7 个：3 个 `mailbox-lib.*` 改动之外，又新增/改动了 `scripts/check-view-tests.mjs`、`scripts/lib/view-tests-lib.mjs`、`scripts/lib/view-tests-lib.d.mts`、`tests/unit/scripts/view-tests-lib.test.ts`（说明 dsh 正在重构另一道门禁，且**没有提交**）——它们与 A 的写入目录重叠（`scripts/`、`scripts/lib/`、`tests/unit/scripts/`）。这不是假设：只要在这段时间派发，ZCode 的任何 `git add -A` 都会把 dsh 的门禁重构一起卷走。
- **可利用路径**：
  1. ZCode 图省事 `git add -A`/`git commit -am` → dsh 的在途改动被扫进 ZCode 的提交，A5 越界且 A4-6（只查 4 个禁目录）抓不到；
  2. ZCode 对 `tests/unit/scripts`/`scripts/` **目录级 add** → 同上；
  3. 两方（或 ZCode 与 trae/dsh）同时 `npm run build` / `npm run test:cov` → `main.js`、`workers/`、`coverage/` 交叉写坏 → check:bundle/check:release/基线出现假红假绿；
  4. ZCode 与 dsh 同时 commit/push → `.git/index.lock` 报错、push 非 fast-forward，若 `git pull --rebase` 后不重跑验收，基线对应的 commit 就变了；
  5. dsh 在 ZCode 执行窗口内更新 `docs/handbook/06-gates-and-release.md` 提到 `npm run check:coverage`（check:docs 会校验该文档引用的命令是否存在，`check-docs.mjs:100-111`）→ ZCode 的 A4-5 出现莫名其妙的 check:docs 失败；
  6. dsh 更新 `PROJECT-RULES.md` HANDOFF 或 `.trae/automation/*` 与 ZCode 的 `check:automation`（读 HANDOFF 与台账，`check-automation.mjs:116-130,167-195`）交叉 → preflight 瞬时红。
- **规格现状**：共同约束只有「写范围互斥」，没有 git 操作纪律、没有串行窗口、没有「谁来接线文档/CI」的归属。
- **建议加固**（写进共同约束）：
  - 派发前置：dsh 先把当前在途改动提交或收尾，**派发时 `git status --porcelain` 必须为空**（否则 A4-5 与 B4-5 都会被污染）。
  - ZCode 只允许精确路径 `git add scripts/check-coverage.mjs .coverage-baseline.json package.json tests/unit/scripts/check-coverage.test.ts docs/generated/gates.md`；禁止 `-A`/`-a`/目录级 add，禁止 `checkout --`/`restore`/`stash`/`reset --hard`/`clean`；
  - 提交前把 `git status --porcelain` 与 `git diff --cached --name-status` 贴进回执；push 前 `git pull --rebase origin master`；rebase 后重跑 `npm run check:coverage` 与 `node scripts/gen-docs.mjs --check`；遇到冲突回 `blocked`，不得自行解决越界文件。
  - 执行窗口内 dsh 不 commit/rebase/跑 build/test:cov；需要改 CI/handbook/LONG-TERM-GOAL/COLLABORATION 的文档，一律放在 ZCode push **之后**由 dsh 单独提交。

### R7 [等级: 中 · 派发时写进规格] Node 版本/覆盖率口径漂移让基线不可复现（本机 v24.16.0 vs `.nvmrc` 20 / CI 20）

- **攻击面/失败模式**：基线是浮点数敏感产物；v8 provider 的 AST remap 在 Node 大版本或 `@vitest/coverage-v8` 升级后可能变化（`vitest.config.ts:42-44` 就有过「Vitest 1.6→4.1 口径变化，lines 76.7→65.6」的真实记录）。本机默认 `node` 是 24，流水线是 20：基线在 24 下生成，CI 的 `test:cov`/未来的 `check:coverage` 在 20 下跑 → 微小差异即可红/绿。
- **可利用路径**：
  1. 开发机生成基线 → CI 首次接入 check:coverage 即「无改动也红」→ 有人 `--update-baseline` 抹平 → 棘轮被噪声驯化；
  2. 反向：某指标在 24 下略高，基线因此偏低 → CI 在 20 下也绿，回退被吞；
  3. 无 `node -v` 记录，事后无法判断是口径漂移还是真回退。
- **规格现状**：未提运行环境；A2-2 未要求记录 node/vitest 版本。
- **建议加固**：
  - baseline `node`/`vitest` 字段必填；生成与验收统一 Node 20（`nvm use 20` 或用 CI artifact），回执贴 `node -v`；
  - 验收前实测一次「同一 commit、Node 20 与 24 的 ui/views lines 是否一致」；不一致则钉 20 并在 baseline 里写 `pinnedNode: 20`，未来升级 Node 必须单独提交 `--update-baseline --note "覆盖率口径升级：node 20→22，全目录 pct 变化+0.XXpp"`，不得混在其他改动里。

### R8 [等级: 中 · 建议撤回] 任务 B 重复派发可被「零工作交付」：旧文件几乎原样满足新 B4

- **攻击面/失败模式**：已有 `docs/audits/preflight-effectiveness-audit.md`（172 行，`DSH-20261111-02`）具备：28 步全表（`:17-48`）、8 步深查（`:50-108`）、每行带 `文件:行号`、TOP3 明确排序（`:137-145`）、只读实测记录（`:147-161`）。新 B4 的判定是：文件存在 + 28 步 + 至少 3 步带行号 + 排名不并列 + git status 只有该 md——**旧文件不改一字就能过**（除 B4-5 受工作树脏影响，见 R6）。
- **可利用路径**：
  1. Trae 收到新任务，发现交付物已在 → 直接回执 `done`，证据引用旧文件 → dsh 验收通过 → 本轮没有任何新信息；
  2. Trae 为满足「用命令核对步数」在旧文件尾部补一行命令输出 → 交付物「更新」但结论全部继承旧审计，连行号都可能是几小时前的代码状态；
  3. 按 B5 同名覆写旧审计 → 破坏 `docs/audits/` 按日期冻结的惯例（`docs/README.md:100`），旧证据不可追溯。
- **规格现状**：完全没有识别「该任务已完成」；B4 的机器判定全部可被旧产物满足。
- **建议加固**：
  - 派发前发 `[VOID] DSH-20261112-02`（`scripts/lib/mailbox-lib.mjs:68-80` 支持作废配对），避免 30 分钟轮询重复领取；
  - 若确需继续：改名 `docs/audits/preflight-effectiveness-audit-r2.md`（不得修改旧文件），并强制本轮**新增**证据：每条「可能空转」必须是 `文件:行号 + 该行原文摘录（≤60 字）`；≥3 条「只读探针」= 命令 + exit code + 关键 stdout（dsh 复跑）；TOP3 用固定评分表（漏检概率/后果/修复成本，权重写死，禁并列，同分按文件名字典序）；所有「否/低」必须引用证明其真实扫描的那一行（如 `readdir`/`glob` 行），不能只写「无」。

### R9 [等级: 中 · 派发时写进规格] 任务 B 只读边界缺失：审计过程可能写入被跟踪文件、越界读取敏感数据、把密钥形态字符串带进仓库

- **攻击面/失败模式**：B 的要求是「遍历 `scripts/` 并给行号」，但没写允许/禁止的命令与路径。`scripts/` 里存在会写盘的脚本：`check:jsdoc` 即使在 `--check` 也写 `docs/generated/jsdoc-coverage.md`（`check-jsdoc.mjs:418-419`）；`npm run preflight` 会 `build`（写 `main.js`/`workers/`）并跑全量测试；`gen:docs` 非 `--check` 会写生成物。另：`data.json`（72KB，含用户数据，且可能含真实 API Key）、`.sessions/`、`.trae/mailbox/`（含用户消息）就在仓内或相邻目录，一次 `Select-String -Recurse` 就可能读到。
- **可利用路径**：
  1. Trae 为验证某个门禁直接跑 `npm run preflight` → `main.js`/`docs/generated` 被重写，B5「只改该 md」被破坏（且可能与 ZCode 的 build 互踩，见 R6）；
  2. 审计为了「核对信箱自动化」去读 `.trae/mailbox/messages.jsonl` → 用户消息进入审计报告/日志；
  3. 报告引用 `check-secrets.mjs` 的测试夹具或用例原文（形如 `sk-` + 长串），被 `check:secrets` 扫到（它扫全部被跟踪文件，`check-secrets.mjs:30-43,127-166`）→ 下一次 preflight 因为「文档里有密钥形态」直接红。
- **规格现状**：B5 只说「禁止修改其他文件」，没有命令/读取路径清单。
- **建议加固**：
  - 只读命令白名单：`node scripts/check-*.mjs` 的 `--check/--list/--root <tmp>` 只读模式、`git show/log/diff`、只读检索；禁止 `npm run preflight`、`npm run build`、`npm run test*`、`npm run gen:docs`（非 `--check`）、任何 `--update-baseline`、`node scripts/check-jsdoc.mjs`、`scripts/mailbox-server.mjs`、`scripts/handoff.mjs`；
  - 禁止读取：`.trae/`、`data.json`、`data/`、`.sessions/`、`../../../`（vault 内容）；允许读取：`scripts/`、`package.json`、`vitest.config.ts`、`.github/workflows/`、`docs/generated/gates.md`；
  - 交付物禁止出现完整密钥形态字符串（用 `sk-***`/截断占位）；
  - 审计开始与结束各贴一次 `git status --porcelain`，两者必须一致（dsh 以此作为 B5 的判定依据，而非全局「只有该 md」，因为工作树可能有 dsh 的在途改动，见 R6）。

### R10 [等级: 中 · 派发时写进规格] 基线 schema 与聚合口径没钉死：pct 还是 counts、`ui` 还是 `ui/views`、绝对路径入库——A4-1/A4-3 的断言悬空

- **攻击面/失败模式**：
  - A2-2 只说「各目录 lines/branches/functions/statements 百分比」；A4-3 写「把 `ui` 的 `lines` 改成 99」——若实现存 `{covered,total}`，A4-3 按字面无法执行（改 99 被忽略 → exit 0 → 验收失败）；若只存 pct，则无法验证聚合是否 count-weighted。
  - A2-1 只要求 stdout 含「`ui/` 行」；D2 的口径是 `ui/views` 8.68%（`docs/LONG-TERM-GOAL.md:246,302-313`），而按顶层目录聚合的整 `ui` 是 ~12.04%（`vitest.config.ts:90-93`）——两个数对不上，脚本输出 `ui/` 12% 也能过 A4-1，但 D2 的 8.68% 没有被度量。
  - `coverage-summary.json` 的键是**绝对路径**（第二轮实测 822 个键）；若原样写进 `.coverage-baseline.json`，会泄漏本机路径（`D:\小说工坊\...`），且 CI 路径不同 → 门禁必然失效。
- **可利用路径**：见上；此外「四维只 gate 一行」——A6 说「覆盖率低于基线」，未说四维任一，实现者可以只比较 lines，branches/functions/statements 退化为展示。
- **规格现状**：schema、聚合算法、目录键、四维语义、路径归一化全部缺失（第一轮 L5 已指出 ui/ui-views 混写，本轮补 schema 与路径可执行细节）。
- **建议加固**：
  - 规格里直接给出 schema（见 R2 建议）与聚合公式；`ui` 与 `ui/views` 两个键都必须有，A4-1 断言改为固定行格式（如 `ui/views/ lines 8.68% (baseline 8.68%, target 30.00%)`，且 `ui/ lines ..%` 同时存在）；
  - A4-3 改写为「把 `directories["ui/views/"].lines.covered` 改为 `total-1`（或 pct 改为 99，两者随 schema 二选一并在规格写死）→ exit 1」；
  - 四维任一低于基线即 exit 1（或显式声明只 gate lines，其余三维修为提示——二选一，不许留空）；
  - 入库前把绝对路径归一化为仓库相对路径，验收用 `git show HEAD:.coverage-baseline.json | Select-String '^[A-Z]:\\|/home/'` 必须为空。

### R11 [等级: 低-中 · 运行中观察] 时间/产能/无人验收：无 ACK、ZCode 还有未完成任务、自动轮询存活性只有间接证据

- **攻击面/失败模式**：
  - ZCode 手上还有 `DSH-20261111-01`（`diagnose_flow` 一致性核对，约定产出 `docs/audits/diagnose-flow-doc-consistency.md`）**尚未交付**（docs/audits 下无此文件）；新任务 A 与其共享同一个 30 分钟轮询，优先级未写，可能被排在后面或做串。
  - 轮询存活性只有间接证据：ZCode 最近一次发消息 2026-11-11 02:23（20 小时前），但 `reads.jsonl` 显示它 22:26:38 已读本轮派发 → 说明它活着；`trae-loop-state.json` 的 `updatedAt` 却停在 2026-11-09T02:21:29（这正是任务 B 审计里「只验格式不验时效」的实证）——「每 30 分钟自动轮询」这个前提本身不可验证。
  - 规格没有 ACK/中间检查点；若 ZCode 本轮没被触发，dsh 会在 11-12 18:00 才发现在等一个从未开始的任务。且 dsh 是对话式会话，回执到达时 dsh 可能不在线 → 「交付了但无人验收」也是一种假完成。
- **可利用路径**：任务挂着 → 到期写 `partial`/沉默；或到期前 1 小时仓促提交，跳过 preflight 用「测试通过」当证据。
- **规格现状**：只有 A3/B3 的期限，没有确认机制、没有验收带宽安排。
- **建议加固**：
  - 派发消息里要求 **1 小时内回 `[ACK] TASK-ID`**（无 ACK 则 dsh 在 11-12 00:00 前 `[VOID]` 改派或自做）；11-12 10:00 要求 `[PROGRESS]`（做到哪一步/已跑过哪些命令）；15:00 仍无 commit 则 dsh 接管或降级为 partial 并按「未完成」记录；
  - 明确优先级：ZCode 先做 A，再做 `DSH-20261111-01`；两件不可交叉提交（各自路径级 commit）；
  - dsh 在 11-12 白天安排一次验收窗口（否则回执只能等到下一次用户唤醒，deadline 形同虚设）。

### R12 [等级: 低 · 派发时写进规格] 任务 A 的供应链与参数注入面：新依赖未禁、`--baseline/--coverage` 若可写路径有覆盖风险

- **攻击面/失败模式**：A5 说 `package.json`（仅 scripts 段），但没显式禁止新增 devDependencies；ZCode 完全可能 `npm install` 一个解析库（glob/istanbul 相关）来「简化」脚本：改了 `package-lock.json`、CI `npm ci` 依赖锁一致性、`audit:deps` 只审生产依赖（`package.json:38`，`--omit=dev`）审不到 devDeps。脚本若接受 `--baseline <path>` 并在 `--update-baseline` 时**写**该路径，一个参数错误即可覆盖 `package.json`（`--baseline package.json`）。
- **可利用路径**：新依赖引入 → lockfile 变更 → 供应链面扩大；或脚本写路径未校验 → 误写其他文件。
- **规格现状**：A5 未写「禁止新依赖/仅 Node 内置」；脚本 CLI 面未定义。
- **建议加固**：
  - 明确「只允许 Node 内置模块（`node:fs/path/process/url/child_process`），禁止新增任何 `dependencies`/`devDependencies`；`git diff package-lock.json` 必须为空；禁止运行 `npm install`（离线环境也不得改 lock）」；
  - `--baseline`/`--coverage-json` 仅用于**只读**覆盖，resolve 后必须位于仓库内（拒绝 `..`/绝对路径越界）；`--update-baseline` 只写固定的 `.coverage-baseline.json`，不接受输出路径参数；
  - 读入 JSON 前做大小上限（如 64MB）+ `JSON.parse` 失败 exit 2；禁止 `eval`/`exec` 拼接参数，若自跑覆盖率则 `spawnSync(process.execPath, [固定参数...])`。

### R13 [等级: 低 · 运行中观察] 文档与台账漂移无人守门（8→9 个基线、handbook 仍写 24 步、COLLABORATION §五 不更新、audits 冻结惯例）

- **攻击面/失败模式**：`docs/LONG-TERM-GOAL.md:60` 写「8 个只降不升的棘轮基线」，新增 `.coverage-baseline.json` 后变 9 个（无门禁校验）；`docs/BASELINE.md:23` 只列 4 个基线；`docs/handbook/06-gates-and-release.md:13` 仍写「preflight 24 步」（实际 28，也没有任何门禁校验步数）；`docs/COLLABORATION-AUTOMATION.md:124-131` 的「当前派发中的任务」表仍停在 `DSH-20261111-01/02`。这些都不会让 preflight 红，但会让下一个接手者按错的数字做决策——与长期目标 §8.2「数字必须可复现」直接冲突。
- **规格现状**：无收口要求；`check:docs` 不管这些（它只校验版本戳/索引/链接/编码，`check-docs.mjs:25-149`）。
- **建议加固**：把「文档收口」列为 dsh 的验收后动作（不属于 ZCode/Trae 写范围）：更新 LONG-TERM-GOAL §2.2（8→9、D2 的 ui/views 口径与目标 gap）、handbook 06（28 步 + 新门禁一行 + 与 CI 的关系）、COLLABORATION §五（VOID/新任务）、BASELINE.md（基线清单）；并在每轮收口时按 §8.3 跑 `record-iteration`。

## 指标游戏专项分析

### 任务 A：覆盖率基线可能被做成假动作的 9 条路径

| # | 攻击动作（谁/怎么做） | 得到的假象 | 现规格能否挡住 | 防法（写进规格） |
|---|---|---|---|---|
| A-1 | 解析 21:16 的旧 `coverage/index.html` 当数据源 | 基线数字「有来源」，但对应旧代码 | 不能（A2-1 未定义数据源） | 固定只读 `coverage-summary.json`；新鲜度检查（summary mtime 必须新于覆盖目录最新 `.ts`）；缺失/过期 exit 2 |
| A-2 | 只跑单个测试文件生成 `--coverage.reporter=json-summary` | summary 缺文件 → 基线锁在极低值 | 不能 | 要求文件键数 ≥800（实测 822）且 `sum(dirs)==total` 守恒；dsh 独立复算 |
| A-3 | 手写 `.coverage-baseline.json` | A4 全绿，数字纯造假 | 不能（A4-3 不验数值真实性） | 基线必须由固定命令生成并带 commit/sha256/node provenance；合理性边界（8.68%/12.04%/46.77% ±容差） |
| A-4 | 百分比算术平均代替 covered/total 加权 | 大量小 100% 文件把 ui 抬到 ~100% | 不能 | schema 存 covered/total，聚合写成 `sum(covered)/sum(total)`；单测加 fixture：1000 行 0% + 1 行 100% → ~0.1% |
| A-5 | 只 gate 总行/只 gate `ui`，其他目录只展示 | 「按目录聚合」名不副实 | 部分（A4-1 只要 ui 行） | 逐目录键循环篡改都必须 exit 1；A4-1 要求固定行格式全目录出现 |
| A-6 | 覆盖率掉了就跑 `--update-baseline --note "波动"` 下调 | 回退被吞，回执「已修复」 | 不能（A6 只约束上调） | 拒绝任何下调；`--allow-regression` 在 CI 拒绝、note <8 字拒绝、写 history |
| A-7 | 首次基线锁在低值，然后宣称「D2 已门禁化」 | 进度话术替代真实进度 | 不能 | baseline 写 `target: ui/views 30%`，stdout 打 gap；LONG-TERM-GOAL 收口措辞受限 |
| A-8 | 8 个空断言测试过 A4-4 | 单测数量达标、质量为零 | 不能（只数 ≥8） | 必测矩阵 10 条 + dsh 做 1 次比较符变异验证；`scripts/**`/`tests/**` 不被 lint 覆盖，测试是唯一守卫 |
| A-9 | 删除难覆盖代码（尤其 A5 没禁的 `core/`、`domains/`）抬数字/缩分母 | 基线虚高或分母变小 | 不能（A4-6 只禁 4 目录，`domains/`/`core/` 漏网） | A4-6 扩到 6 个覆盖目录 + 零删除/零重命名 + 提交级 `git show --name-status` |

### 任务 B：空转审计可能被做成走过场的 6 条路径

| # | 攻击动作 | 得到的假象 | 现规格能否识别 | 防法 |
|---|---|---|---|---|
| B-1 | 直接引用已存在的 172 行旧审计（甚至不改一字） | 28 步/行号/TOP3 齐全，回执 done | 不能 | `[VOID]` 撤回；确需继续则改名 `-r2` 且必须新增探针/摘录证据 |
| B-2 | 28 步风险全填「低」，只把 3 步标「是」 | B4-1/2/3/4 全过，结论没有价值 | 不能 | 风险分布约束（若存在高/中必须如实标）；每条「否/低」引用证明其真实扫描的代码行；≥3 条只读探针 |
| B-3 | 编造 `file:line` | B4-2 无法判定真伪 | 不能 | 每行必须附「该行原文摘录 ≤60 字」；dsh 用脚本逐行 grep 校验行号与摘录一致 |
| B-4 | TOP3 随便排/为不并列强行凑序 | B4-4 只看是否并列 | 不能 | 固定 rubric 评分表（漏检概率×后果×修复成本，权重写死），TOP3 各附「什么样的违规能漏过去」的具体例子 |
| B-5 | 审计中运行会写盘的门禁（preflight/build/check:jsdoc） | 「只读审计」名不副实，基线被污染 | 不能（B5 只管结果文件） | 只读命令白名单 + 审计前后 `git status --porcelain` 一致 |
| B-6 | 为了「核实自动化」读 `.trae/mailbox`、`data.json` 或引用密钥形态夹具 | 用户消息/密钥形态进入仓库文档 | 不能 | 禁止读取路径清单；`check:secrets` 会扫 tracked docs，交付物禁止完整密钥形态字符串 |

### 已核查、本轮判定**不是**风险的点（避免加固过度）

1. `coverage/` 已在 `.gitignore:11`；实测目录内 0 个 JSON、只有 HTML 资产 → 不会把巨大产物提交进仓库；`.coverage-baseline.json` 用 `git check-ignore` 验证**未被忽略**（符合「基线必须入库」）。
2. 新增 `.coverage-baseline.json` 不会被 `check:secrets` 误报（纯数字/相对路径；`check-secrets.mjs:30-43` 的 11 条正则不匹配），也不会被 `check:bundle`/`check:docs`/`check:changelog` 读取或枚举。
3. 新脚本/新测试不会破坏其它门禁扫描范围：`eslint` 忽略 `scripts/**`/`tests/**`（`eslint.config.mjs:37-38`）；`check:jsdoc`（DIRS 见 `check-jsdoc.mjs:40`）、`check:any`（`check-any-budget.mjs:26`）、`check:view-tests`（ui only）、`check:deps`（7 个源码层）、`check:obsidian-api` 均不扫 `scripts/`/`tests/`。
4. `check:changelog`/`check:release`/`check:automation` 只有在 ZCode 误改 `version`/`manifest.json`/`package-lock.json` 时才会红——加 scripts 键本身不会触发；因此「禁止碰版本四文件」是充分防护（`check-automation.mjs:132-145`、`check-release.mjs:44-65`、`check-changelog.mjs:21-52`）。
5. 任务 B 的 deliverable 在 `docs/audits/`，`check:docs` 的版本戳/索引/链接/编码范围都不含 `audits/`（`check-docs.mjs:25-42,100-149`）→ 不会因新增审计文档失败。
6. 向 `docs/` 文档登记 `npm run check:coverage` 本身是安全的（`check-docs.mjs:100-111` 只校验命令存在），但**必须等脚本 push 之后再写**，否则顺序错误会让别人的 preflight 红（见 R6 路径 5）。

## 必须补进规格的约束（清单）

> 标注 **[堵]** = 派发前必须写进规格/前置提交，否则任务不可派；**[规]** = 派发时写进规格；**[验]** = 验收时 dsh 必须执行的判定；**[观]** = 运行中观察项。

1. **[堵] A5 写范围增加** `docs/generated/gates.md`（仅允许 `npm run gen:docs` 重新生成，禁手改；禁改 `scripts/gen-docs.mjs` 的 `SCRIPT_DESCRIPTIONS`）。A4-5 拆成「步数命令输出 28 + `gen-docs --check` exit 0 + 提交级 gates.md 只新增一行 + preflight EXIT=0」四项（R1）。
2. **[堵] 派发前置由 dsh 完成**：在 `vitest.config.ts:14` 的 reporter 增加 `'json-summary'` 并单独提交；前置验证 `npm run test:cov` 确实生成 `coverage/coverage-summary.json`（若 dsh 不愿改配置，则 A2-3 改为 `"check:coverage": "npm run test:cov -- --coverage.reporter=json-summary && node scripts/check-coverage.mjs"`，二选一写死，禁止解析 HTML）。
3. **[规] A2-1 数据源与失败语义**：只读 `coverage/coverage-summary.json`；不存在/解析失败/`mtime` 早于覆盖目录最新 `.ts` → exit 2 并打印 `npm run test:cov`；禁止硬编码、禁止手写基线。
4. **[规] A2-2 schema 与聚合**：给出完整 JSON schema（`schemaVersion/generatedAt/note/sourceCommand/commit/worktreeDirty/node/vitest/summarySha256/directories/targets`），目录键固定 `ui/`、`ui/views/`、`engine/`、`services/`、`core/`、`shared/`、`domains/`，每指标 `{covered,total,pct}`，聚合 count-weighted，绝对路径归一化为仓库相对路径；四维语义二选一写死（推荐四维任一低于基线即 exit 1）。
5. **[规] 生成基线的固定命令 + provenance**：`npm run test:cov && node scripts/check-coverage.mjs --update-baseline --note "<≥8 字中文原因>"`，仅在 `git status --porcelain` 为空时允许生成；`.coverage-baseline.json` 中禁止出现 `D:\`/`/home/` 等绝对路径（验收 grep 为空）。
6. **[规] A6 重写棘轮语义**：覆盖率只升不降；任何指标低于旧基线即 exit 1；`--update-baseline` 只允许收紧，任何下降必须 `--allow-regression`（`CI=true` 拒绝），并写 `history[]`；`--note` 去空白后 <8 字拒绝（R4）。
7. **[验] A4 增补可判定项**：①缺失/过期 summary → exit 2；②`--note ""`/`--note "  "` → exit 1；③逐目录键把基线改成「实际+2pp」→ exit 1（至少 ui/ui/views/engine 三键各一次，证明逐目录真比较）；④首次基线必须含全部目录键。
8. **[验] 验收方与证据格式**：A4 六条由 dsh 执行复跑，ZCode 自证无效；回执必须含 `git rev-parse HEAD`（=origin/master 末条）、`git show --name-status`、命令块（命令/退出码/关键 stdout）、`npm run preflight` 末行 EXIT、GitHub CI run 链接、`git status --porcelain` 为空。
9. **[验] A4-3/A4-4 执行方式**：A4-3 用 `tmp/` 只读副本 + `--baseline` 覆盖参数（脚本须支持只读，不得写该路径），验后工作树与验前一致；A4-4 由 dsh 做一次比较符变异（temp 副本）证明测试非空断言，并按约束 11 的矩阵抽查用例。
10. **[规] A4-6 改为提交级见证**：`git show --name-status <提交>` 只含 A5 白名单（含 gates.md）；对 `core/domains/engine/services/shared/ui` 零删除/零重命名；禁止再用 `git diff --stat`（提交后恒空）。
11. **[规] A4-4 必测矩阵（替代「≥8 用例」）**：①count-weighted 聚合（1000 行 0% + 1 行 100% ≈0.1%）；②缺失 summary exit 2；③畸形 JSON exit 2；④缺基线 check 模式 fail-closed（仿 `baseline-utils.mjs:116-126` 的 `--require-baseline`）；⑤低于基线 exit 1 且打印差距；⑥持平 exit 0；⑦高于基线 exit 0 并提示收紧；⑧`--update-baseline` 缺 note exit 1；⑨下调拒绝；⑩`--baseline` 只读不写。
12. **[规] 依赖/命令纪律**：仅 Node 内置模块；禁止新增依赖；`git diff package-lock.json` 为空；禁止 `npm install`；禁止 eval/exec 拼接；`--baseline/--coverage-json` 只读且 resolve 在仓库内；`--update-baseline` 只写固定路径；输入 JSON 有大小上限与 schema 校验（R12）。
13. **[规] 并发/git 纪律**：派发时工作树必须干净（dsh 先提交在途改动）；ZCode 只用精确路径 `git add`（5 个文件），禁止 `-A`/`-a`/目录级 add/checkout/restore/stash/reset/clean；push 前 `git pull --rebase origin master` 并重跑 `npm run check:coverage` 与 `gen-docs --check`；执行窗口内 dsh 不 commit/rebase/跑 build/test:cov；CI/文档接线全部由 dsh 在 ZCode push 后单独提交（R6）。
14. **[规] 运行环境固定**：生成与验收统一 Node 20（`.nvmrc` 已为 20；本机默认 24），回执贴 `node -v`；baseline 记录 node/vitest 版本；未来升级 Node 必须单独 `--update-baseline --note` 说明口径变化（R7）。
15. **[堵] 任务 B 处理**：先发 `[VOID] DSH-20261112-02`；若确需继续，改名 `docs/audits/preflight-effectiveness-audit-r2.md`（不修改旧文件），按约束 16 强制新增实证证据；否则把 Trae 的时间用于「任务 A 的只读交叉复核」（不同 agent 独立复算，正好补上 R5 的自证问题）。
16. **[规] 任务 B 若派的经济性约束**：每条判定必须 `文件:行号 + 该行原文摘录`；≥3 条只读探针（命令/exit/关键 stdout，dsh 复跑）；每条「否/低」必须引用证明真实扫描的那行；TOP3 固定评分表（禁并列、同分按文件名字典序）；只读命令白名单 + 禁止读取 `.trae/`、`data.json`、`.sessions/`、`../../../`；前后 `git status --porcelain` 一致；交付物禁止完整密钥形态字符串（R8/R9）。
17. **[观] 时间/产能**：派发消息要求 1 小时内 `[ACK] TASK-ID`（否则 dsh VOID/改派或自做）；11-12 10:00 `[PROGRESS]`；15:00 无 commit 则 dsh 接管或降级；明确 ZCode 先做 A 再做 `DSH-20261111-01`；dsh 在 11-12 白天安排验收窗口（R11）。
18. **[观] 文档收口（dsh 负责，非 ZCode/Trae 范围）**：LONG-TERM-GOAL §2.2（8→9 基线、D2 的 ui/views 口径与 target/gap、以及「是否已接入 CI」的真话）、handbook 06（28 步 + 新门禁行）、COLLABORATION §五、BASELINE.md；打通 `preflight:release`，并明确 CI 接线的 owner 与截止时间（R3/R13）。

## 结论

- **按现规格派发：不建议（有高风险需先补约束）。** 任务 A 在 R1/R2/R3/R4/R5 未解决前，ZCode 的最好结果只能是「交付物看起来齐全、门禁实际没生效」，最坏结果是必然越界或验收必失败；任务 B 是已完成任务的重复派发，重派只会产生回执摇晃与重复劳动。
- **任务 A 的最小可派发版本**（按顺序）：
  1. dsh 先把工作树在途改动提交（`git status --porcelain` 为空）；
  2. dsh 前置提交 `vitest.config.ts` 的 `json-summary` reporter（或规格二选一允许脚本自跑覆盖率）；
  3. 按约束 1–14 修订 A2/A4/A5/A6，把数据源、schema、聚合、provenance、下调拒绝、验收方、提交级见证、gates.md 写范围、CI 接线 owner 全部写死；
  4. 派发后按约束 17 盯 ACK/进度；验收时 dsh 亲自跑 A4 全六条 + 独立复算 + 变异验证，再收口文档与 CI。
- **任务 B：撤回。** 若仍要「把纸面门禁查干净」，把预算改投到**修复**（例如任务 B 审计自己点名的 `check:program` 数字交叉核验、`check:automation` 时效检查、`扫描文件数==0 → fail`），并另立新任务号、限定写范围与验收——不要用同一个任务号重做同一份文档。
- 风险可控性排序：R1/R2 是**规格内部矛盾**（必须先修，不能靠 ZCode 能力兜底）；R3/R4/R5 是**指标游戏与自证闭环**（必须靠约束和 dsh 亲自验收堵住）；R6/R7/R9/R10 是**环境与证据工程**（写进规格即可大幅降低）；R8/R11/R12/R13 是**流程与收口**（运行中观察 + dsh 承担）。

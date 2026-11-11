# 第一轮审查：任务逻辑完整性

- 审查对象：`docs/audits/dispatch-spec-20261112.md`（2026-11-11 22:35 草案，未派发）
- 审查视角：齐全性 / 可判定性 / 自洽性 / 遗漏 / 时间节点 / 与协作协议 v1 一致性
- 审查时间：2026-11-11 22:47（Asia/Shanghai）
- 本轮不判定技术可行性（留给第二轮），但会核对规格中**关于仓库现状的事实陈述**

## 结论

**不通过**（按现状不可派发）。

- **任务 B（DSH-20261112-02）必须撤回**：它与已在信箱回执 `done` 的 `DSH-20261111-02` 是同一件事，交付物 `docs/audits/preflight-effectiveness-audit.md` 已经存在于工作树（172 行、未提交）。重新派发会造成重复劳动、覆盖旧交付物，且验收（B4）可以被旧文件"蒙混"通过——这正好是本项目要消灭的那类自欺。见 L1。
- **任务 A（DSH-20261112-01）在修订后可派发**：方向正确、四要素齐全、28 步基线事实全部核对无误，但验收层有 1 个阻断级缺陷（L2，验收证据与提交状态自相矛盾/不可判定）和 6 个重要缺口（L3–L7、L9）。其中 L2 是派发前置条件，不先清理工作树，任何 git 类验收都不可判定。
- 全文未出现"合理/适当/尽量"等无法判定的形容词；机器可判定的硬指标（退出码、文件存在、行号、用例数、排序）占多数，这部分写得不错。问题集中在**输入/口径/证据链**，而不是验收句式。

### 已核查且未发现问题的点

- 四要素形式齐全：A、B 都有执行目标（A1/B1）、交付标准（A2/B2）、时间节点（A3/B3）、验收要求（A4/B4），另各带写范围边界（A5/B5）。
- 规格抬头基线事实全部核对为真：`HEAD 7cfd449` ✓、`master...origin/master`（ahead 0）✓、`package.json` v4.83.0 ✓、`main.js` 4,911,886 B ✓、preflight 链**28 个 `npm run` 项** ✓（按 `package.json:13` 逐项数过）。
- A2-3"不加入 preflight"与 A4-5"仍为 28 步"是同一约束的两面，不矛盾 ✓。
- A5 允许改 `package.json`（scripts 段）与 A4-6"diff 不含 ui/engine/shared/services"不构成"要求改 X 又禁止 diff 含 X"的矛盾 ✓（但边界覆盖不足，见 L7）。
- A4-2（无 note 拒绝）与 A6（note 必填）内部一致 ✓（与仓库现有 check-bundle 行为不一致，见 L6）。
- 两任务写范围 A/B 互斥：A=scripts/+tests/+package.json，B=docs/audits/ ✓；与 dsh 当前工作（ui/ 抽取、LONG-TERM-GOAL）不重叠 ✓（但验收证据受共享工作树污染，见 L2）。
- 以下要求均可机器判定：A4-1 退出码、A4-2 退出码、A4-3 退出码、A4-4 "≥8 用例"、B4-2 `文件:行号`、B4-4 第 1/2/3 排序不得并列。

## 发现清单

### L1 [严重度: 阻断] 任务 B 是已完成任务 `DSH-20261111-02` 的重复派发，交付物已存在且已回执 done

- 位置：任务 B 全段（规格 57–98 行），尤其 B2 交付物 `docs/audits/preflight-effectiveness-audit.md`（第 74 行）与 B4 验收（第 86–92 行）
- 问题：新任务 B 与旧任务 `DSH-20261111-02` 目标、交付物路径、验收内容基本相同；而旧任务**已经在信箱回执 done**，交付物已经在工作树里。规格似乎是在回执到达的同分钟起草，没核对信箱。若按现状派发：
  1. Trae 的 `mailbox-watch --tasks` 里旧任务已配对回执而消失，新任务 `DSH-20261112-02` 会作为"新待办"出现 → **重复劳动**；
  2. 写范围指向同一路径 → 覆盖/改写旧交付物，旧回执的证据链（commit/未 push 状态）被污染；
  3. B4-1/B4-2/B4-3 旧文件已全部满足，B4-5 初查 `git status` 时也只看到该 md（若先提交其他脏文件），**验收可以不做任何新工作而通过**——恰好是本项目头号教训"以为完成了，实际没做"；
  4. 协议 §5（`docs/COLLABORATION-AUTOMATION.md:129`）仍把 `DSH-20261111-02` 记为"已派发"，与新回执脱节。
- 依据：信箱 `.trae/mailbox/messages.jsonl` 中 trae 消息 `m-1794407730043-77aed722`：`subject=[RECEIPT] DSH-20261111-02`、`ts=2026-11-11T14:35:30.044Z`（=22:35:30 Asia/Shanghai）、`状态：done`，证据段写明"产出 docs/audits/preflight-effectiveness-audit.md（28 步总表 / 8 步深查 / TOP3 排序）"；该文件当前存在（19,134 B、172 行、mtime 2026-11-11 22:35:03、`git ls-files` 无记录=未跟踪）；规格起草时间同为 22:35。旧派发消息 `m-1794406614187-e2ded1e8` 的验收与本次 B4 几乎逐字相同。
- 建议改法：**本轮撤回任务 B**。先按协议验收并提交旧交付物：`git add docs/audits/preflight-effectiveness-audit.md && git commit -m "docs(audit): preflight 空转审计（DSH-20261111-02）" && git push`（或 DSH 复核后正式收单），更新协议 §5 表。若仍需要后续动作，改建为**增量任务**（例如 `DSH-20261112-03`「preflight 空转修复 P0/P1 落地」：check:program 三项交叉核验 + 扫描文件数为 0 → fail），交付路径不得复用 `preflight-effectiveness-audit.md`，验收必须要求"旧审计未覆盖的新证据"。
- 附带派发纪律：规格定稿前必须跑一次 `node scripts/mailbox-watch.mjs --me trae --tasks` / `--me zcode --tasks`，确认无同义在途/已回执任务（协议 §3.1、§3.3），并把这一步写进规格的"派发前置检查"。

### L2 [严重度: 阻断] 验收证据没有绑定提交基线：B4-5 与 B3 自相矛盾，A4-6 在共享脏工作树里不可判定

- 位置：A3（第 33 行）与 B3（第 84 行）的"提交、推送"；A4-6（第 42 行）；B4-5（第 92 行）；共同约束 #2（第 104 行，声明 dsh 正在改 `ui/`、`docs/LONG-TERM-GOAL.md`）
- 问题：
  1. **B4-5 逻辑上不可满足**：B3 要求"完成、提交、推送"。一旦提交，工作树干净，`git status` 不可能"只有该 md 文件"；若在提交前验证，当前工作树已有 5 条记录（3 个 `M` + 2 个 `??`），B4-5 在派发时点即为假。
  2. **A4-6 空转**：`git diff --stat` 未绑定 commit 范围。提交后（工作树=索引）输出恒为空，验收恒真、零证据力；若在提交前验证，共同约束 #2 自己声明 dsh 正在改 `ui/`，共享工作树里 dsh 的未提交 `ui/` 改动会让 A4-6 判负——**同一份规格里"dsh 正在改 ui/"与"A4-6 要求 diff 不含 ui/"直接冲突**。
  3. **并发污染**：A、B 同一截止、同一仓库工作树并发执行时，A 新增的 `scripts/check-coverage.mjs` 等会让 B 的 B4-5 失败；B 的 md 也会出现在 A 的 `git status`。规格没有 worktree/branch/串行隔离约定。
  4. A4-5 的 `npm run preflight` 也在共享脏工作树上跑，preflight 是否绿受他人未提交改动影响（当前 3 个 modified 脚本），损害协议"任务可独立完成"铁律。
- 依据：本审查时点 `git status --porcelain` 实际输出：
  `M scripts/lib/mailbox-lib.d.mts` / `M scripts/lib/mailbox-lib.mjs` / `M tests/unit/scripts/mailbox-lib.test.ts` / `?? docs/audits/dispatch-spec-20261112.md` / `?? docs/audits/preflight-effectiveness-audit.md`。规格第 5 行只写了"HEAD 7cfd449 / ahead 0"，未声明工作树不干净。
- 建议改法（可直接替换措辞）：
  - 派发前置（新增"共同约束 #0"）："DSH 派发前必须满足：`git status --porcelain` 为空、`git push` 完成、`npm run preflight` 在发布基线绿。基线记为 `HEAD <hash> · clean`。"
  - A4-6 替换为："`git diff --name-only 7cfd449..HEAD` 的输出必须**只有** A5 允许的 4 个路径；且 `git diff 7cfd449..HEAD -- ui/ engine/ shared/ services/` 为空、`git diff 7cfd449..HEAD -- .bundle-baseline.json 'scripts/check-*.mjs'` 为空。"
  - B4-5 替换为："`git diff --name-only 7cfd449..HEAD` 的输出只有 `docs/audits/preflight-effectiveness-audit.md` 一个路径。"
  - 并发隔离（新增）："A/B 必须在各自 worktree/branch 上执行，且提交串行（后提交者 rebase）；禁止把对方未提交文件计入自己的验收证据。"
  - A4-5 改为："在干净检出（或独立 worktree）上跑 `npm run preflight`，粘贴 `EXIT=0` 与 28 步清单。"

### L3 [严重度: 重要] 任务 A 的覆盖率数据来源和运行前提未定义，A4-1 在干净检出上不可复现

- 位置：A2-1（第 26 行，"读覆盖率汇总"）、A2-2（第 27 行）、A4-1（第 37 行）
- 问题：规格说脚本"读覆盖率汇总"，但没说汇总由谁生成、从哪个文件读、干净检出（无 `coverage/`）时怎么办；A4-1 又只要求 `npm run check:coverage` 退出码 0，没有前置条件。A2-1"A2 交付物"、"读"、A4-1"直接跑 exit 0"三者对不上。
- 依据：`vitest.config.ts:14` 的 coverage reporter 是 `['text','text-summary','html']`，**没有 `json` / `json-summary`**；`coverage/` 被 `.gitignore:11` 忽略；实测 `coverage/` 目录只有 HTML 资产（index.html、sorter.js 等），没有任何 `*.json`；`test:cov`（`package.json:20`）只在 CI（`.github/workflows/ci.yml:76-77`）里被调用。因此"现成的机器可读覆盖率汇总"目前**不存在**。
- 建议改法：A2 增加一行"数据来源与前置条件"（二选一，写死）：
  - ①"`check:coverage` 只读 `coverage/coverage-summary.json`；前置条件：先跑 `npm run test:cov`，且 `vitest.config.ts:14` 的 reporter 增加 `json-summary`（A5 允许清单相应增加 `vitest.config.ts`）。缺数据时 `exit 2` 并打印修复命令，不得 `exit 0`。"
  - ②"`check:coverage` 自己生成数据：内部执行 `npx vitest run --coverage --coverage.reporter=json-summary` 后比较（验收注明全量测试耗时；缺数据分支不存在）。"
  - 并在 A4-1 写明："前置 `npm run test:cov` 已执行或脚本自行生成数据"。

### L4 [严重度: 重要] 目标↔交付不闭环：新门禁既不进 preflight、也不进 CI，交付后没有任何自动执行路径

- 位置：A1（第 16–20 行，目标"建立回归保护"）、A2-3（第 28 行，"不加入 preflight 链"）、A5（第 46–47 行，允许清单不含 `.github/`、禁止 preflight 链）
- 问题：A1 的痛点是"覆盖率掉了没人知道"，交付物却是一个**只能人手敲**的脚本。`preflight` 不调用它（A2-3），CI 不调用它，`preflight:release` 也不调用它。交付后"掉了还是没人知道"——这恰是任务 B 要审计的"纸面门禁"模式，任务 A 自己又造了一个。
- 依据：`package.json:13`（preflight 28 步）与 `package.json:14`（`preflight:release = preflight && test:cov`）均无 `check:coverage`；`.github/workflows/ci.yml:76-77` 只跑 `npm run test:cov`；A5 允许清单只有 4 个路径，改 CI 属于越界。
- 建议改法（二选一）：
  - ①增加交付项 A2-5："接入自动执行——在 `.github/workflows/ci.yml` 的 `npm run test:cov` 之后增加一步 `npm run check:coverage`；A5 允许清单增加 `.github/workflows/ci.yml`；preflight 28 步链保持不变。"验收增加："`git diff 7cfd449..HEAD -- .github/workflows/ci.yml` 只新增该一步。"
  - ②若坚持本批不接 CI，把 A1 改为："本任务交付可手动执行的覆盖率棘轮与基线；自动执行接入另立任务，本任务不承诺回归保护"，并删掉"无回归保护/掉了没人知道"的因果承诺。

### L5 [严重度: 重要] 聚合口径与基线 schema 未定义，A4-1/A4-3 的断言悬空，且与 D2 现有口径不一致

- 位置：A2-2（第 27 行，"按目录聚合…各目录百分比"）、A4-1（第 37 行，stdout 含 `ui/` 行）、A4-3（第 39 行，脚本编辑 `.coverage-baseline.json` 的 `ui.lines`）
- 问题：
  1. "按目录聚合"的粒度未定义：顶层目录？两层？`ui/views` 域？A4-3 假定基线里恰好有 `ui` 键和 `lines` 字段，A4-1 假定 stdout 有 `ui/` 行——三处命名/路径互不一致，实现者只能猜。
  2. D2 口径本身在长期目标里是混写的：`docs/LONG-TERM-GOAL.md:246` 写"`ui/` 覆盖率 8.68% → ≥30%（`ui/views` 域）"，§2.3 与 §8.1 各写一半；而 `vitest.config.ts:90-99` 注释给出的 `ui/**` 递归实测是 lines 12.04。**8.68%（ui/views）与 12.04%（ui/**）不是一个数**：脚本按顶层目录聚合会得到 ~12%，与 D2 基准 8.68% 对不上；只输出 ui/views 则 A4-3 的 `ui` 键对不上。
  3. 四维指标是否都参与棘轮未写清（A6 只说"覆盖率低于基线 → exit 1"）。
  4. 与 `vitest.config.ts:53-100` 既有 per-glob 阈值（`ui/**` lines 10 等，CI 里生效）构成**第二套口径**，规格未说明两套的关系（孰为准、是否同步）。
- 建议改法：A2-2 写死基线 schema 示例（键名/嵌套/单位/精度），并要求至少输出 `ui/` 与 `ui/views` 两个口径，例如：
  ```json
  {
    "generatedAt": "2026-11-12T…",
    "note": "首次生成",
    "directories": {
      "ui/":        { "lines": 12.04, "branches": …, "functions": …, "statements": … },
      "ui/views/":  { "lines": 8.68,  "branches": …, "functions": …, "statements": … },
      …
    }
  }
  ```
  A4-1 断言改为具体行格式（如 `ui/views/ lines 8.68% (baseline 8.68%)` 且 `exit 0`）；A4-3 的编辑路径改为"schema 中的 `directories["ui/views/"].lines`"；A6 增加"四维任一低于基线即 exit 1"或明确只 gate `lines`；并加一句"与 vitest.config.ts 既有 per-glob 阈值的关系：两套同时绿，本基线不得替代既有阈值"。

### L6 [严重度: 重要] 棘轮方向与基线更新规则自相矛盾/有洞：可"下调基线吞回退"，且与 check-bundle 现行为不符

- 位置：A1（第 17 行，"只降不升的棘轮基线"）、A6（第 49–53 行）、A4-2（第 38 行）
- 问题：
  1. **方向写反**："只降不升"是体积/bundle 语义（数值越小越好）。覆盖率是"数值只允许上升"，A6 的判定（低于基线 exit 1）才是对的，但 A1 用反方向措辞，实现者容易搞反。
  2. **漏洞**：A6 只规定"上调基线必须带 note"，**没有规定 `--update-baseline` 不允许把基线数值调低**。覆盖率回退时用一条更低的新基线 + 一个 note 就能"合法消化回归"——正是任务 B 要审计的"遮羞布"机制。A4-2 只测"缺 note 被拒"，不测"下调被拒"。
  3. **与现有实现不符**：`scripts/check-bundle.mjs:83-90,109-111` 在当前实现里，`--update-baseline` **不带 `--note` 时会自动生成 note 并 `exit 0`**，只在体积上调时 warn；只在无基线时才 exit 1（`:115-120`）。所以规格第 49 行"与现有 check-bundle.mjs 风格一致"不成立——照抄现实现必挂 A4-2。
  4. A4-2 未要求"拒绝时不得写盘"；也未验收"带 note 的成功路径"（A2-2 首次基线生成只能走这条路径，验收却只测失败路径 → 一个永远 exit 1 的实现也能过 A4-2）。
- 建议改法（直接替换 A6）：
  > - 覆盖率基线是**下限棘轮**：实际值 < 基线 → `exit 1`；≥ 基线 → `exit 0`。
  > - `--update-baseline` 只允许把任一口径的基线**调高**（收紧）；新值低于旧值 → `exit 1`，提示"覆盖率回退不允许靠改基线消化，需 DSH 人工裁决"，且**不得写入文件**。
  > - 任何 `--update-baseline` 必须带非空 `--note`（含首次生成）；缺 note → `exit 1`，**不得写入文件**。
  > - **注意**：本语义比 check-bundle 更严。现实现无 `--note` 时自动生成 note 并 `exit 0`，不要照抄。
  A4 增加一条："`node scripts/check-coverage.mjs --update-baseline --note "首次生成"` → `exit 0`，`.coverage-baseline.json` 的 `generatedAt`/数值更新、note 落盘；随后默认模式 `exit 0`。"

### L7 [严重度: 重要] 验收未覆盖 A5 的禁止边界，A4-5 不能证明"preflight 链没被改"

- 位置：A5（第 46–47 行）、A4-5（第 41 行）、A4-6（第 42 行）
- 问题：A5 明确禁止改 `.bundle-baseline.json`、其他 `scripts/check-*.mjs`、preflight 链，但 A4-6 只排除 `ui/engine/shared/services` 四个目录，**改 `.bundle-baseline.json` 或别的 `scripts/check-*.mjs` 不会被任何一条验收发现**。A4-5 的"仍为 28 步"只数数量，无法证明某一步没被替换（例如把 `check:any` 换成别的脚本仍然是 28 步），因此括号里的"（证明没动门禁链）"是过度承诺。
- 依据：A5 第 47 行禁止项 vs A4-6 第 42 行排除项；`package.json:13` 的 preflight 步骤可被等量替换而不改变步数。
- 建议改法：
  - 新增/替换 A4-6："`git diff --name-only 7cfd449..HEAD` 只包含 A5 允许的 4 个路径；`git diff 7cfd449..HEAD -- .bundle-baseline.json 'scripts/check-*.mjs' ui/ engine/ shared/ services/` 为空。"
  - 新增一条："`git diff 7cfd449..HEAD -- package.json` 只新增 `"check:coverage": "node scripts/check-coverage.mjs"` 一行，`"preflight"` 那一行逐字节不变。"
  - A4-5 保留"preflight EXIT=0"，但去掉"证明没动门禁链"的括号，改由上面的 diff 断言证明。

### L8 [严重度: 重要] 回执/验收闭环与协作协议 v1 不一致：回执缺项、无验收方、无驳回/超时规则、§5 表未更新

- 位置：共同约束 #3（第 105 行）、#4（第 106 行）；对照 `docs/COLLABORATION-AUTOMATION.md` §2.1（:26–48）、§2.2（:50–69）、§4（:114–121）、§5（:124–131）
- 问题：
  1. **回执格式**：协议 §2.2 要求回执 6 行（`任务 / 状态 / 做了什么 / 证据 / 未完成 / 阻塞`）且 subject 固定 `[RECEIPT] DSH-YYYYMMDD-NN`，"缺一项视为无效回执"。规格只列 5 项（缺"任务"行），也未规定回执 subject → 严格按协议会被判无效回执。
  2. **验收方/返工**：协议 §一 规定 DSH 验收回执、合并成果，规格没写"谁验收、验收不通过如何退回、返工期限"。
  3. **超时**：共同约束 #4 只覆盖"做不完回 partial/blocked"，未覆盖"过了 18:00 怎么处置"（逾期是否自动失效、能否申请延期）。
  4. **派发信格式**：协议 §2.1 要求 subject 以 `[TASK-DSH-YYYYMMDD-NN]` 开头、body 含 目标/范围/验收/期限；规格是一份文档，未附可直接复制的派发信模板。协议 §3.1 记录过真实故障（任务 ID 只写在正文 → 任务静默消失），这一项不是形式主义。
  5. **协议 §5 表**：协议要求"表格随派发更新"（:131），规格未包含该动作；且现表仍把 `DSH-20261111-02` 记为"已派发"，与信箱回执 done 脱节。
- 建议改法：
  - 共同约束 #3 替换为："回执严格按 `docs/COLLABORATION-AUTOMATION.md` §2.2 六项书写（含 `任务:` 行），subject 为 `[RECEIPT] DSH-20261112-01`；缺一项视为无效回执。"
  - 共同约束新增："验收方为 DSH。验收不通过退回一次并给出修订期限；逾期未完成必须回 `partial`/`blocked` 并说明原因与剩余项，不得静默延期。"
  - 规格末尾附派发信模板（subject + 五行 body），由 DSH 原样发到信箱。
  - 新增动作："派发后 DSH 更新协议 §5 表，并把两项任务记入 `docs/progress/auto-iterations.md`。"

### L9 [严重度: 重要] A4-3 要求手工改交付基线却没有恢复/复验步骤，可能把坏基线提交推送

- 位置：A2-2（第 27 行，`.coverage-baseline.json` 是交付物）、A4-3（第 39 行，手工把 `ui.lines` 改成 99）、A3（第 33 行，要求提交推送）
- 问题：A4-3 的破坏性验收直接作用在**交付物本体**上，规格没有"恢复基线并复验"的步骤，也没要求脚本支持 `--baseline <路径>` 参数在副本上做验收。代理人执行完 A4-3 后按 A3 提交推送，交付物里的基线就是 99，下一次门禁必然红——交付物被自己的验收流程弄坏。
- 建议改法：A2 增加 `--baseline <path>`（默认 `.coverage-baseline.json`）；A4-3 改为在临时副本上操作："`Copy-Item .coverage-baseline.json tmp-baseline.json` → 改成 99 → `node scripts/check-coverage.mjs --baseline tmp-baseline.json` 断言 `exit 1` → 删除临时文件"；或追加 A4-7："恢复基线后复跑 A4-1 `exit 0`，`git status` 不含被手改的基线。"

### L10 [严重度: 次要] A1 的痛点陈述与仓库现状不符：CI 已有覆盖率阈值，缺的是按目录棘轮与 ui/views 口径

- 位置：A1（第 19–20 行，"既不可复核也无回归保护——覆盖率掉了没人知道"）
- 问题：现状并非完全没有回归保护。CI 跑 `npm run test:cov`，`vitest.config.ts:53-100` 的 per-glob 阈值（`ui/**` lines 10 等）在 CI 和 `preflight:release` 里生效，覆盖率跌破阈值 CI 会红。真正缺的是：① `ui/views` 域 8.68% 这一细分口径没有单独棘轮；② 本地 `npm run preflight` 不跑覆盖率（`package.json:19` 的 `test` 不带 `--coverage`）；③ 没有按目录的可复核基线。
- 依据：`.github/workflows/ci.yml:76-77`；`package.json:14,19,20`；`vitest.config.ts:53-100`。
- 建议改法：A1 痛点改为上述精确版本并引行号，避免实现者误判缺口（例如以为要重造 CI 覆盖率门禁，与 A2-3/A5 冲突）。

### L11 [严重度: 次要] B4-1/B4-3 的可判定性措辞未收敛到"可机械判定的最小要素"

- 位置：B4-1（第 88 行）、B4-3（第 90 行）
- 问题：B4-1"须用命令核对 package.json 的 preflight 链步数并写进报告"没有给出命令，也没定义"28 步无遗漏"的判据（步名是否必须与 `package.json:13` 的 `npm run <x>` 逐项同序？）。B4-3"具体空转路径（触发条件 + 行号）"中"具体"未定义最小要素；旧交付物里是靠"空根 + 不存在基线实测 exit 0"这类可复现证据才够格的，但规格没有要求可复现命令与观察输出。
- 建议改法：B4-1 指定命令与格式："报告须粘贴 `node -e "const p=require('./package.json').scripts.preflight;console.log(p.split(' && ').length)"` 的输出 `28`，且 28 行"步骤"列与 `package.json:13` 的 `npm run <x>` 逐项同序。"B4-3 要求每条含三要素："可复制触发命令（或目录/文件改动）+ 观察到的错误通过输出 + 期望行为"，缺一即判不合格。

### L12 [严重度: 次要] 在途任务、并发隔离、超时与收口台账均未写

- 位置：共同约束（第 101–107 行）与整份规格
- 问题：
  1. **在途任务**：ZCode 尚未回执 `DSH-20261111-01`，其交付物 `docs/audits/diagnose-flow-doc-consistency.md` 不存在；规格没说明 ZCode 先做旧的还是新的、优先级如何。信箱 `--tasks` 会同时列出两条，可能先做旧任务而拖到 18:00。
  2. **并发隔离**：A、B 同一截止、同一工作树，没有 worktree/串行/提交窗口约定（与 L2 同源，单独列为了提醒这是可执行性问题而不只是证据问题）。
  3. **收口台账**：任务完成后由谁更新 `docs/LONG-TERM-GOAL.md` §2.2（"8 个只降不升的棘轮基线"将变 9 个）、`docs/progress/program-status.json`（`check:program` 管其同步）、`docs/progress/auto-iterations.md`、协议 §5 表——规格未写。
- 建议改法：共同约束新增："派发前 DSH 用 `mailbox-watch --tasks` 核对 ZCode 的 `DSH-20261111-01` 状态（先收单或声明作废），并明确本批优先级；A/B 分开 worktree/串行提交；验收通过后 DSH 更新长期目标 §2.2、program-status、auto-iterations、协议 §5。"

## 逐条核对表

| 检查项 | 任务A | 任务B | 说明 |
|---|---|---|---|
| 执行目标 | ✅ | ❌ | A 方向清晰、可判定；B 与已回执 done 的 `DSH-20261111-02` 完全重复（L1） |
| 交付标准 | ⚠️ | ❌ | A 四项交付物路径明确，但覆盖率输入来源未定义（L3）、基线 schema/口径未定义（L5）；B 三项内容明确，但交付路径就是旧交付物本身（L1） |
| 时间节点 | ✅ | ⚠️ | 均为 2026-11-12 18:00；A 约 1 轮工作量、19.5 小时现实；B 已完成使截止无意义；两任务均缺"逾期/延期"规则（L8/L12） |
| 验收要求 | ⚠️ | ❌ | A 6 条中 A4-1/A4-3/A4-5/A4-6 依赖未定义的数据来源/口径/schema/证据范围（L3/L5/L7）；B 的 B4-5 与 B3 冲突且在派发时点已不成立（L2） |
| 可判定性 | ⚠️ | ⚠️ | A：A4-1"含百分比数字"格式未定、A4-3 依赖未定义 schema，其余可判定；B：B4-1"须用命令核对"未给命令、B4-3"具体"未收敛，其余（文件存在/行号/排序）可判定 |
| 自洽性 | ❌ | ❌ | A：A1"只降不升"与覆盖率只升方向相反（L6）；目标↔交付不闭环（L4）；A4-3 污染交付物（L9）。B：B3 提交推送 vs B4-5 git status（L2）；B 与 A 并发污染（L2/L12） |
| 与协议一致 | ⚠️ | ⚠️ | 写范围 A/B 互斥 ✅、与 dsh 工作不重叠 ✅；但回执缺"任务"行/subject、无验收方/驳回/超时（L8）、协议 §5 表未更新（L1/L8）、共享工作树违反"任务可独立完成"（L2） |
| 遗漏项 | ❌ | ❌ | A：数据来源、基线 schema、CI 接入、恢复步骤、失败/超时、收口台账；B：与旧任务关系、提交状态与证据口径、可复现证据要求 |

## 若必须删改，最小改动清单

按优先级（先做 1，否则其余 git 类验收都不可判定）：

1. **派发前置（DSH 侧，不写进任务）**：提交/清理当前工作树（3 个 `M` + 2 个 `??`），推送，确认 `git status --porcelain` 为空；用 `mailbox-watch --me trae --tasks` 确认 `DSH-20261111-02` 已回执并收单（提交+推送旧交付物），同步更新协议 §5 表。
2. **从本批删除任务 B**。若仍需后续动作，另立增量任务（不得复用 `docs/audits/preflight-effectiveness-audit.md` 为交付路径，验收须要求旧审计未覆盖的新证据）。
3. **A1**：把痛点陈述改为 L10 的精确版本；补"是否接入 CI"的选择（L4 二选一）。
4. **A2**：增加"覆盖率数据来源与前置条件"（L3 二选一）；给出基线 JSON schema 示例并声明至少输出 `ui/` 与 `ui/views/` 两个口径（L5）；增加 `--baseline <path>` 参数（L9）。
5. **A4 改写**：
   - A4-1 增加前置条件与精确的 stdout 行格式（L3/L5）；
   - A4-2 增加"拒绝时不得写盘"，并新增"带合法 note 的更新成功路径"验收（L6）；
   - A4-3 改为在临时基线上验证（L9）；
   - A4-6 改为 `git diff --name-only 7cfd449..HEAD` 白名单断言 + `package.json` 单独断言（L2/L7）；
   - 新增 A4-7："在干净检出/独立 worktree 上跑 preflight，粘贴 EXIT=0 与 28 步清单"（L2）。
6. **A5**：若采纳 L4 的①或 L3 的①，把 `.github/workflows/ci.yml` 或 `vitest.config.ts` 加入允许清单；否则不扩大。
7. **A6 整段替换**为 L6 的"下限棘轮 + 禁止下调 + note 必填 + 不得写盘 + 与 check-bundle 差异说明"。
8. **共同约束**：#3 改为引用协议 §2.2 六项 + `[RECEIPT]` subject；新增验收方/驳回/超时规则（L8）；新增派发信模板（L8）；新增在途任务优先级与并发隔离（L12）；新增收口台账动作（L12）。
9. **B（若坚持保留）**：按 L1/L2/L11 全部重写，并确认旧任务已收单、旧交付物已入库；否则不建议保留。
10. **时间节点**：A 维持 2026-11-12 18:00 可以，但补"派发不得晚于 2026-11-12 09:00（否则顺延当日 22:00）"与逾期处置（L8/L12）。

> 第二轮（技术可行性）建议复核、本轮按分工未判定：`check:coverage` 的 JSON 汇总方案是否必须改 `vitest.config.ts`；TS 测试 import `.mjs` 是否需要新增 `.d.mts`（仓库已有 `scripts/lib/mailbox-lib.d.mts` 先例）；新脚本是否受 `check:jsdoc` / `check:docs` 约束；`npm run preflight` 全链路耗时与 A4-5/A4-7 的可重复性。

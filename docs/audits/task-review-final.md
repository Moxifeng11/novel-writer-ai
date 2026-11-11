# 三轮对抗审查汇总结论（2026-11-12 派发批次）

**审查对象**：`docs/audits/dispatch-spec-20261112.md`（任务 A 覆盖率门禁 → ZCode；任务 B preflight 空转审计 → Trae）
**审查方式**：三个独立子智能体，互不通信，各自只写自己的报告
**日期**：2026-11-11 22:35 – 23:10（Asia/Shanghai）
**结论**：**按原规格均不可派发**。任务 B 应撤回；任务 A 需按 18 条约束重写。

| 轮次 | 视角 | 报告 | 结论 |
|---|---|---|---|
| 1 | 任务逻辑完整性 | [review-round1-logic.md](review-round1-logic.md) | 不通过（2 阻断 / 7 重要 / 3 次要） |
| 2 | 技术实现可行性 | [review-round2-feasibility.md](review-round2-feasibility.md) | 有条件可行（4 阻断，均有实证） |
| 3 | 风险与漏洞 | [review-round3-risk.md](review-round3-risk.md) | 有高风险需先补约束（5 阻断 + 2 环境风险） |

---

## 一、任务 B（Trae preflight 审计）—— 撤回

**三轮一致认定重复派发**：

- 规格起草于 22:35，而 Trae 已于 **22:35:30 回执 `done`**（信箱 `m-1794407730043`）
- 交付物 `docs/audits/preflight-effectiveness-audit.md` 已存在（132–172 行，含 28 步总表 + 8 步深查 + TOP3 排序）
- 重派的后果（第三轮原话）：「旧文件几乎原样满足新 B4 全部机器判定 → 重派必然变成**拿旧文件冒充新交付**」
- 附加：B4-5 要求 `git status` 只有该 md，而工作树有并发写入（dsh 在途改动 3→7 个），**该验收在派发时点即为假**

**处置**：`[VOID] DSH-20261112-02`，改为**验收既有交付物**（见第四节）。

---

## 二、任务 A（ZCode 覆盖率门禁）—— 五个阻断项

### R1 规格自相矛盾（第三轮新发现）

`gen-docs.mjs:172-201,221` 从 `package.json` scripts 生成 `docs/generated/gates.md`，
而 preflight 第 24 步 `check:docs` 会跑 `gen-docs --check`（`check-docs.mjs:151-160`）。

- 加 `check:coverage` 键 → `gates.md` 必然变化
- 不改 `gates.md` → A4-5（preflight 全绿）必红
- 改 `gates.md` → 超出 A5 允许清单

**A2-3 与 A4-5 互斥。**

### F1 / R2 数据源根本不存在

- `vitest.config.ts:14` reporter 只有 `text/text-summary/html`，**无 JSON**
- `coverage/` 被 `.gitignore:11` 忽略，实查 879 个文件 **0 个 `.json`**
- 唯一现成数据是 21:16 的旧 HTML，而源码 21:45–22:00 仍在改动

第二轮实测可行路径：CLI 加 `--coverage.reporter=json-summary` 能产出（822 键、绝对路径键、含 total + 四项 pct）。

### F2 测试会挂 typecheck

`tsconfig.json:8` `allowJs:false` → 静态 import `.mjs` 报 `TS7016`、EXIT=2。
仓库已有先例：`scripts/lib/mailbox-lib.d.mts`（本次会话新增），但 A5 允许清单没有 `.d.mts` 位置。

### R3 交付即纸面门禁

不进 preflight（合理），但也不进 CI / preflight:release
（`ci.yml:76-77`、`release.yml:74-75` 只跑 `test:cov`）→ **交付后无人运行**。
这正是任务 B 自己审计出的头号病，会原样复刻。

### R4 棘轮方向被写反 + 可被下调吞掉

- A6 写「覆盖率低于基线 → exit 1」方向正确，但 A1 写「只降不升」是**反的**（覆盖率应只升）
- 真正危险方向是**下调基线**，A4 完全没有测

### R5 验收方与证据形态未定

- 未写由谁验收
- A4-3（手工改基线为 99）有污染提交路径，且无恢复步骤
- A4-6（`git diff --stat` 不含某目录）在提交后**恒空**，是真空判定
- A4-4 的 8 个用例可以是空断言（`scripts/`、`tests/` 都在 eslint 忽略范围）

### 另：聚合口径歧义（第一/二轮都提）

D2 的 8.68% 实为 **`ui/views` 的 statements**（`coverage/index.html:892-903`）；
`ui` 整体是 statements 9.66% / lines 9.71%。A2-2/A4-3 的 key 必须明确到「哪个目录 × 哪个指标」。

### 另：环境风险

- 本机 Node **v24.16.0** vs `.nvmrc`/CI 的 **20** → 基线可能跨环境假红假绿
- 共享工作树：`git add -A` 会卷走他人在途改动

---

## 三、我（dsh）在审查期间独立发现的门禁缺陷（已修复）

审查过程中核实「94 → 93」这个下降是否真实，发现是**假的**：

`scripts/check-view-tests.mjs` 用全文正则 `/(?:from\s+|import\s*)['"]([^'"]+)['"]/g` 扫测试文件，
于是 `tests/unit/ui/kb-fanfic-entry.test.ts:32` 这行**断言字符串**被当成真 import：

```ts
expect(view).toContain("import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal'");
```

后果：`ui/add-fanfic-setting-modal.ts`（720 行、实际零测试）被判为「有测试」，
从零覆盖基线消失，门禁显示 94 → 93 的假进步。

**修复**：抽出 `scripts/lib/view-tests-lib.mjs`，只认**行首** import/export 语句。
实测 727 个测试文件：说明符 2372 → 2352，减少的 20 个**全是注释/字符串里的假阳性**。
计数恢复为诚实的 **94**，`check:view-tests` 通过。
回归测试 `tests/unit/scripts/view-tests-lib.test.ts`（12 条）。

---

## 四、定稿处置

| 项 | 处置 |
|---|---|
| 任务 B（Trae） | **`[VOID]` 撤回**；改为验收既有交付物 |
| 任务 A（ZCode） | **按下方 18 条约束重写为 v2 后派发** |
| 既有 `preflight-effectiveness-audit.md` | 提交入库（Trae 已交付，内容真实） |
| `check:view-tests` 假阳性 | 已修复并入库 |

### 任务 A v2 必须补齐的约束（合并三轮意见，可直接抄进规格）

**数据源与口径**
1. 数据源唯一：`npm run test:cov` 产出的 `coverage/coverage-summary.json`；产出方式必须写进规格（允许改 `vitest.config.ts:14` 加 `'json-summary'`）
2. 基线必须记录 **provenance**：`gitHead`（跑覆盖率时的 HEAD）+ `generatedAt` + `nodeVersion`；HEAD 与当前不符时拒绝比较（防陈旧数据）
3. 聚合必须 **count-weighted**（按行数加权），不得对百分比做简单平均
4. key 明确到「目录 × 指标」：`ui/**` 与 `ui/views/**` 都要有，指标用 `lines`（并注明 statements 另存）

**棘轮语义**
5. 方向写对：覆盖率**下降** → exit 1；上升或持平 → exit 0
6. 禁止**下调**基线：`--update-baseline` 时若新值低于旧值，必须 `--allow-decrease --note` 双确认
7. 无 `--note` 拒绝写基线（与 A4-2 一致）

**交付路径**
8. A5 允许清单补：`vitest.config.ts`（仅 reporter 一行）、`docs/generated/gates.md`（由 `gen-docs` 重新生成）、`scripts/lib/coverage-lib.mjs` + `.d.mts`
9. 必须接进 `preflight:release`（不是主 preflight），避免 28 步不变量被破坏，同时保证有人运行
10. 验收方 = dsh；ZCode 回执必须附**可复现命令**（dsh 能独立跑一遍得到相同结果）

**测试与证据**
11. 8 个用例不得是空断言：必须覆盖「下降→1」「上升→0」「下调基线被拒」「provenance 不符被拒」「count-weighted 正确」
12. 禁止 `git add -A`；必须逐个 `git add <具体文件>`
13. 提交后回执附 commit hash + 覆盖率数字截图式摘录（实际输出片段）

**并发与环境**
14. 跑 `npm run preflight` 前确认无其他 agent 在写；若无法确认，只跑 `check:coverage` 与 `npx vitest run <本任务测试>`
15. 记录 Node 版本；若与 `.nvmrc` 不一致，在回执里说明（防跨环境假红）

**流程**
16. 回执必须用 `[RECEIPT] DSH-20261112-01` subject 且含五项
17. 若 2026-11-12 18:00 前无法完成，提前回 `partial` 说明进度，不得静默逾期
18. 不得触碰 `ui/`、`engine/`、`shared/`、`services/`、`.bundle-baseline.json`、其他 `check-*.mjs`

---

## 五、三轮审查的共同判断（值得记住的方法论）

1. **规格里最危险的不是「没写」，而是「写了但方向反了」**——A6 的「只降不升」用在覆盖率上就是反的。
2. **验收标准本身可能空转**：`git diff` 在提交后恒空、`git status` 在有并发时必假。
3. **「不进 preflight」看似保守，实际等于没人跑**——门禁的价值在于被执行，不在被编写。
4. **派生文档（`gates.md`）是最容易被忽略的连带修改点**。
5. **指标一定要先确认分母与口径**（`ui` vs `ui/views`，statements vs lines），否则甲乙双方各算各的。

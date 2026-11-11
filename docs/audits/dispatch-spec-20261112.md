# 待派发任务规格（2026-11-12 批次）· 待三轮对抗审查

**状态**：草案，未派发。经三轮对抗审查后再定稿派发。
**起草**：dsh，2026-11-11 22:35（Asia/Shanghai）
**基线**：v4.83.0 / HEAD 7cfd449 / ahead 0 / main.js 4,911,886 B / preflight 28 步

---

## 任务 A｜派给 ZCode

**TASK-ID**：`DSH-20261112-01`
**标题**：新增覆盖率门禁脚本（把 D2 指标变成可执行数字）

### A1 执行目标

把长期目标 D2 的「`ui/` 覆盖率」从**口头数字**变成**可机器判定的门禁**：
新增独立覆盖率检查脚本，按目录聚合覆盖率，建立只降不升的棘轮基线。

当前痛点：D2 的 8.68% 是人工跑一次 `npm run test:cov` 看输出得来的，
既不可复核也无回归保护——覆盖率掉了没人知道。

### A2 交付标准（4 项，缺一不可）

| # | 交付物 | 说明 |
|---|---|---|
| 1 | `scripts/check-coverage.mjs` | 读覆盖率汇总 → 按目录聚合 → 与基线比较 → 退出码语义 |
| 2 | `.coverage-baseline.json` | 首次生成的基线（含各目录 lines/branches/functions/statements 百分比） |
| 3 | `package.json` 新增 `"check:coverage": "node scripts/check-coverage.mjs"` | **不加入 preflight 链**（保持 28 步不变量） |
| 4 | `tests/unit/scripts/check-coverage.test.ts` | 覆盖聚合/棘轮比较/参数校验，**≥8 用例** |

### A3 时间节点

**2026-11-12 18:00（Asia/Shanghai）前**完成、提交、推送。

### A4 验收要求（6 条，全部可机器判定）

1. `npm run check:coverage` 退出码 **0**，stdout 含 `ui/` 行与百分比数字
2. `node scripts/check-coverage.mjs --update-baseline`（**不带** `--note`）退出码 **1**，且提示必须写 note
3. 手工把 `.coverage-baseline.json` 中 `ui` 的 `lines` 改成 `99` → 脚本退出码 **1**，并打印「基线 99 vs 实际 X」的差距
4. `npx vitest run tests/unit/scripts/check-coverage.test.ts` 全绿，用例数 **≥8**
5. `npm run preflight` 仍为 **28 步**且 `EXIT=0`（证明没动门禁链）
6. `git diff --stat` **不含** `ui/`、`engine/`、`shared/`、`services/` 下任何文件

### A5 边界（写范围）

- **允许**：`scripts/check-coverage.mjs`、`.coverage-baseline.json`、`package.json`（仅 `scripts` 段）、`tests/unit/scripts/check-coverage.test.ts`
- **禁止**：`ui/`、`engine/`、`shared/`、`services/`、`.bundle-baseline.json`、其他 `scripts/check-*.mjs`、preflight 链

### A6 棘轮语义（与现有 `check-bundle.mjs` 风格一致）

- 覆盖率 **低于**基线 → `exit 1`
- 持平或更高 → `exit 0`
- 上调基线必须 `--update-baseline --note "原因"`，note 为空则拒绝

---

## 任务 B｜派给 Trae

**TASK-ID**：`DSH-20261112-02`
**标题**：28 步 preflight 空转审计

### B1 执行目标

查明 28 步 preflight 中哪些步骤存在「空转」——即**看起来在检查、实际没检查**：

- 目标文件/目录不存在时静默通过
- 扫描范围过窄（只扫了一部分，其余漏掉）
- 基线机制从「棘轮」退化为「遮羞布」（违规登记后永不复查）

理由：preflight 恒绿是项目主指标之一，但恒绿有两种可能——真没问题，或检查没在检查。

### B2 交付标准

`docs/audits/preflight-effectiveness-audit.md`，必须含：

| # | 内容 | 要求 |
|---|---|---|
| 1 | 28 步全表 | 列：步骤 \| 命令 \| 真实扫描范围 \| 是否可能空转 \| 风险(高/中/低) \| 依据(file:line) |
| 2 | 具体空转路径 | **≥3 步**给出触发条件 + 代码行号 |
| 3 | 排序结论 | 「最可能是纸面门禁」第 1/2/3 名，各附理由 |

### B3 时间节点

**2026-11-12 18:00（Asia/Shanghai）前**完成、提交、推送。

### B4 验收要求（5 条，全部可机器判定）

1. 文件存在，且 **28 步无遗漏**（须用命令核对 `package.json` 的 preflight 链步数并写进报告）
2. 每条「可能空转」的判定都附 `文件:行号`
3. **≥3 步**给出具体空转路径（触发条件 + 行号），不是「建议加强检查」
4. 结论有明确的第 1/第 2/第 3 排序，不得并列
5. `git status` 只有该 md 文件（不修改任何源码/脚本）

### B5 边界（写范围）

- **允许**：`docs/audits/preflight-effectiveness-audit.md`
- **禁止**：其他任何文件（含 `scripts/`、`package.json`）

---

## 共同约束

1. 两任务写范围互斥：A 写 `scripts/`+`tests/`+`package.json`，B 只写 `docs/audits/`。
2. 与 dsh 当前工作（`ui/` 抽取、`docs/LONG-TERM-GOAL.md`）互斥。
3. 回执必须含五项：状态 / 做了什么 / 证据 / 未完成 / 阻塞。
4. 失败要暴露：做不完回 `partial` 或 `blocked`，不得静默跳过。
5. 两任务均**不涉及** `tag` / `Release`。

---

## 待审问题（三轮审查要回答的）

1. 目标/交付/时间/验收是否齐全、互不矛盾、可判定？
2. 技术上能否做到？依赖是否存在？命令是否真实？
3. 有哪些风险与漏洞（指标游戏、写冲突、误伤、供应链、回执造假）？

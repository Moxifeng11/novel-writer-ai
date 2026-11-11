# 自动化协作协议（DSH ⇄ ZCode ⇄ Trae）

**版本**：v2（2026-11-12）——**任务板取代轮询**
**用途**：让三个 harness 在不冲突的前提下协作——DSH 派任务，ZCode/Trae **在会话开始时领一次**，不轮询。

> **v2 变更摘要**
>
> v1 用「30 分钟信箱轮询 + 回执 + 心跳」，实践后有三个硬伤：
> ①延迟 30 分钟不实时；②没有原子领取，两个 agent 可能领到同一任务；
> ③没有写范围互斥，两个 agent 可能同时改同一批文件。
>
> v2 改用**文件系统任务板**（`scripts/board.mjs`），用文件系统原语做协调：
> 原子领取（`wx` 独占创建）、写范围租约、租约超时、秒级响应。
> **不再轮询**——取消定时任务，改为会话开始时领一次（0 开销）。

---

## 一、角色

| 角色 | 职责 |
|---|---|
| **DSH** | 主对话方；派发任务、验收、合并成果。**唯一派发方** |
| **ZCode** | 会话开始时 `board.mjs next --me zcode` 领任务；做完 `board.mjs done` |
| **Trae** | 同 ZCode |

**不轮询**：三方都不再设置定时任务。任务板是拉取式的——谁来谁领，没任务就立刻返回。

---

## 二、任务板（主渠道）

### 2.1 位置与结构

```
<vault>/.trae/board/
  tasks.jsonl          任务（append-only，便于审计与恢复）
  results.jsonl        结果与证据（append-only）
  claims/<taskId>.json 领取（原子创建 + 20 分钟租约）
  locks/<scope>.json   写范围锁（原子创建 + 租约）
```

### 2.2 DSH 派任务

```bash
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs add \
  --id DSH-20261112-01 \
  --title "新增覆盖率门禁" \
  --scope "scripts/check-coverage.mjs,scripts/lib/coverage-lib.mjs,package.json,vitest.config.ts,tests/unit/scripts/check-coverage.test.ts" \
  --accept "check:coverage exit 0；基线改 99 则 exit 1；preflight 仍 28 步" \
  --assignee zcode \
  --note "细节见 docs/audits/xxx.md" \
  --by dsh
```

**`--assignee`（定向指派）**：指定后只有该 agent 能领；省略则任何 agent 可领。
用途：某个 agent 暂时不可用（如 Trae 积分耗尽）时，把任务明确交给另一个人，避免任务空等。

**派发铁律（不变）**：

1. **写范围必须互斥**——两个任务的 `--scope` 不得重叠（任务板会强制检查）
2. **验收必须可判定**——不接受「检查一下是否合理」
3. **任务可独立完成**——不需要别人的未提交工作

### 2.3 ZCode / Trae 领任务（会话开始时，一次）

```bash
# 领任务（原子：两个 agent 同时跑也不会领到同一个）
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs next --me zcode
```

- 有任务 → 输出任务 JSON（含 id / title / scope / accept / note），**此时已持有写范围锁**
- 无任务 → 输出「（当前没有可领取的任务）」并退出 0
- 若写范围被他人持有 → 输出冲突提示，不会领到

**领到任务后**：按 `accept` 逐条实现，只改 `scope` 里的文件。

### 2.4 完成 / 失败 / 放弃

```bash
# 完成（自动释放写范围锁，证据写进 results.jsonl）
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs done <taskId> --me zcode \
  --evidence "commit abc1234; check:coverage exit 0; 21 tests passed"

# 失败（释放锁，写原因）
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs fail <taskId> --me zcode \
  --reason "缺上游依赖 xxx"

# 临时放弃（保留任务，释放锁，让别人可领）
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs release <taskId> --me zcode
```

### 2.5 看板

```bash
node .obsidian/plugins/novel-writer-ai/scripts/board.mjs status
```

输出示例：

```
任务总数 3
  T1 | ✅ done |
  T2 | 🔒 trae（剩 20 分钟） | 改 B
  T3 | 🟢 待领取 | 改 C
活跃写范围锁 2：
  scripts/a.mjs ← trae
```

---

## 三、为什么这样更快、更安全

| 维度 | v1 信箱轮询 | v2 任务板 |
|---|---|---|
| 领取延迟 | 最长 30 分钟 | **实测 248ms**（原子创建，任务一出现即可领） |
| 重复领取 | 可能（无原子性） | **不可能**（`writeFileSync(..., {flag:'wx'})` 独占创建） |
| 并发写同一文件 | 可能 | **不可能**（写范围锁，冲突即领不到） |
| agent 崩溃 | 任务永久卡住 | **20 分钟租约自动释放**，可被他人抢占 |
| token 成本 | 每次轮询一次 LLM 回合 | **0**（会话开始时一次 shell 调用） |
| 证据留存 | 信箱消息（会被刷走） | `results.jsonl`（append-only，可审计） |

---

## 四、信箱的定位（降级为人类可读同步）

任务派发**不再走信箱**。信箱只用于：

1. **进度同步**：阶段性结论、需要对方知道但不构成任务的信息
2. **讨论**：技术方案分歧、需要人看的说明
3. **异常上报**：任务板本身坏了（比如文件权限问题）

**信箱不再需要心跳回执**——任务板的 `status` 就是状态，`claims/` 目录的存在就是「谁在做什么」。

---

## 五、冲突与一致性

- **代码与 git 是唯一真相源**。证据优先用 commit hash 或命令输出，不用口头描述。
- **写范围重叠时**：任务板会直接让你领不到，不需要人工让行。
- **推送**：三方均可自行 `git push`；`tag` / `Release` 仍需用户明确确认。
- **失败要暴露**：做不完就 `fail` 或 `release`，不要静默跳过——这与项目核心命题一致：
  **每一条「以为完成了」的协作，都必须真的完成，并且能被证明完成**。

---

## 六、历史（v1 → v2 迁移记录）

| 日期 | 变更 |
|---|---|
| 2026-11-11 | v1 建立：30 分钟信箱轮询 + `[TASK-]` / `[RECEIPT]` / `[VOID]` 约定 |
| 2026-11-11 | 修复 `mailbox-watch.mjs` 两个静默失效（根目录少上溯一层 → 永远无未读；任务 ID 只认 subject） |
| 2026-11-12 | **v2：任务板取代轮询**。用户明确「有任务板就不要轮询，浪费 token」，并已关闭 ZCode/Trae 的定时轮询 |

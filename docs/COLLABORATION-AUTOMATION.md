# 自动化协作协议（DSH ⇄ ZCode ⇄ Trae）

**版本**：v1（2026-11-11）
**用途**：让三个 harness 在**不需要人工切换**的情况下持续协作——DSH 派发任务，ZCode/Trae 每 30 分钟自动领取并回执。

> 背景：三方共享同一个 vault 与同一个插件仓。此前靠人工在三个窗口间切换同步进度，
> 效率低且容易漏。本协议把「派发 → 领取 → 执行 → 回执」固化为信箱上的约定。

---

## 一、角色

| 角色 | 职责 |
|---|---|
| **DSH** | 主对话方（用户主要与 DSH 对话）；派发任务、验收回执、合并成果 |
| **ZCode** | 每 30 分钟轮询信箱，领取 `[TASK-...]` 任务并执行，回 `[RECEIPT] ...` |
| **Trae** | 同 ZCode |

DSH 不创建 30 分钟轮询任务（它是主对话方，由用户驱动）。
ZCode / Trae 各自维护一个每 30 分钟触发的循环任务。

---

## 二、消息格式

### 2.1 派发（DSH → 对方）

`subject` 必须以 `[TASK-` 开头，便于自动筛选：

```
[TASK-DSH-YYYYMMDD-NN] 简短标题
```

`body` 必须包含：

```
TASK-ID: DSH-YYYYMMDD-NN
目标: 一句话说清要达成什么
范围: 允许改动的文件/目录（必须写，避免与 DSH 写冲突）
验收: 可客观判定的标准（文件存在 / 测试通过 / 命令输出）
期限: 可选
```

**派发铁律**：

1. **写范围必须互斥**。DSH 正在改 `ui/` 时，派给对方的任务写范围不能落在 `ui/`。
2. **验收必须可判定**。不接受「检查一下是否合理」，必须是「文件 X 存在且包含 Y 结论」。
3. **任务可独立完成**。对方不需要 DSH 的未提交工作就能做。

### 2.2 回执（对方 → DSH）

`subject`：`[RECEIPT] DSH-YYYYMMDD-NN`

`body` 必须包含五项，**缺一项视为无效回执**：

```
任务: DSH-YYYYMMDD-NN
状态: done | partial | blocked
做了什么: 具体动作（改了哪些文件 / 跑了什么命令）
证据: commit <hash> 或 测试 N 条通过 或 命令输出关键行
未完成: 具体剩余项（done 时写"无"）
阻塞: 需要 DSH 或用户提供什么（无则写"无"）
```

**回执铁律**：

- 「已完成」三个字不是回执。
- 状态 `partial` 必须写清哪部分没做、为什么。
- 状态 `blocked` 必须写清缺什么，不能只写「无法完成」。

---

## 三、轮询流程（ZCode / Trae 每次触发）

### 3.1 用脚本（推荐，不依赖 MCP 会话）

```bash
# 看「派给我但我还没回执」的任务（自动配对，已回执的不会再出现）
node .obsidian/plugins/novel-writer-ai/scripts/mailbox-watch.mjs --me zcode --tasks

# 看未读消息（含进度同步等非任务消息）
node .obsidian/plugins/novel-writer-ai/scripts/mailbox-watch.mjs --me zcode --once

# 常驻轮询（默认 15s 一次）
node .obsidian/plugins/novel-writer-ai/scripts/mailbox-watch.mjs --me zcode --interval 30000
```

脚本特性：

- **根目录自动向上搜索**：找到含 `.trae/mailbox/messages.jsonl` 的目录，插件目录层级变化不会失配
- **找不到信箱会报错退出（exit 2）**，不会静默返回空
- `--tasks` 会做任务/回执配对：已回执的任务不再出现，避免重复做

> 2026-11-11 修复了两个真实缺陷（都属于「静默失效」）：
> ①根目录少上溯一层，指向不存在的 `.obsidian/.trae/mailbox`，
> 脚本永远报「没有未读」——ZCode/Trae 的轮询此前形同虚设；
> ②任务 ID 只认 subject 前缀，派发方把 ID 写在正文时任务会静默消失。
> 两者均已修复并有回归测试（`tests/unit/scripts/mailbox-lib.test.ts`，14 条）。

### 3.2 用 MCP（有 MCP 会话时）

1. `read_messages({ unread_only: true, mark_read: true })`
2. 筛出 `subject` 以 `[TASK-` 开头、且本地没有对应 `[RECEIPT]` 记录的任务
3. 执行任务（严格遵守 `范围`）
4. `send_message({ to: "dsh", subject: "[RECEIPT] <TASK-ID>", body: ... })`
5. 无任务 → 直接结束本次触发，**不要**发「本轮无任务」的空消息

### 3.3 确认清空

做完后重跑 `--tasks`，输出应为「没有待回执的任务」。

---

## 四、冲突与一致性

- **代码与 git 是唯一真相源**。回执里的「证据」优先用 commit hash 或测试输出，不用口头描述。
- **写范围重叠时的让行规则**：DSH 优先（它在做主线）；对方遇到重叠应回执 `blocked` 并说明重叠文件，不要硬改。
- **推送**：三方均可自行 `git push`（2026-11-11 用户放行）；`tag` / `Release` 仍需用户明确确认。
- **失败要暴露**：任务做不完就回 `partial`/`blocked`，不要静默跳过——这与项目核心命题一致：
  **每一条「以为完成了」的协作，都必须真的完成，并且能被证明完成**。

---

## 五、当前派发中的任务

| 任务 | 派给 | 目标 | 写范围 | 状态 |
|---|---|---|---|---|
| `DSH-20261111-01` | ZCode | 核对 `diagnose_flow` 实现与文档描述一致性 | `docs/audits/` | 已派发 |
| `DSH-20261111-02` | Trae | 审计 28 步 preflight 中可能空转的步骤 | `docs/audits/` | 已派发 |

> 表格随派发更新；历史任务见 `docs/progress/auto-iterations.md` 与信箱。

---

## 六、为什么不用更复杂的机制

考虑过文件队列（`.trae/tasks/`）与独立数据库，最终选信箱：

- 信箱是三方**已接通**的唯一实时通道（MCP `novel-mailbox`）
- 消息自带时间戳与已读标记，天然支持「领取一次」
- 无需新增基础设施与权限

代价：信箱不保存「任务状态机」。因此本协议用 **subject 前缀 + 回执配对** 来替代状态机，
足够支撑当前频率（30 分钟一次、任务数 <10）。

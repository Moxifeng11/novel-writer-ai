# 项目协作指令（插件仓 · ZCode / Trae / DSH）

> 本文件供 ZCode / Trae / DSH 在插件仓会话自动加载；只做入口，规范正文在 Vault 根 `PROJECT-RULES.md`。

1. **会话开始只读** `../../../PROJECT-RULES.md` 的 `<!-- HANDOFF:START -->` 块。这是 ZCode / Trae / DSH 三方的唯一交接快照。
2. **会话开始时领任务（任务板，不轮询）**：`node scripts/board.mjs next --me zcode|trae|dsh`
   - 有任务 → 按任务里的 `scope`（写范围）与 `accept`（验收）执行；**此时已自动持有写范围锁**
   - 无任务 → 立即返回，不要等待、不要轮询
   - 完成 `board.mjs done <id> --me <me> --evidence "commit abc; 测试 N 条通过"`；做不完 `fail` 或 `release`
   - 看板 `board.mjs status`；规范见 `docs/COLLABORATION-AUTOMATION.md`（v2，任务板取代 30 分钟轮询）
3. **若 `novel-mailbox` MCP 可用**：调用 `read_messages({ unread_only: true, mark_read: true })` 读取同伴留言（身份见 §2.5：ZCode=zcode、Trae=trae、DSH=dsh）。**信箱只用于进度同步与讨论，不再派发任务**。
4. 需要细节时按快照「详情」跳转 §三 / §七或本仓 `docs/`。**不要**为了解其他方进度去遍历 `.trae/documents/`、`.trae/specs/`、`.zcode/plans/` 或对方生成的报告。
5. **结束会话前**：
   - 更新快照：`node scripts/handoff.mjs --from zcode|trae|dsh --stage "..." --delivered "..." --doing "..." --next-zcode "..." --next-trae "..." --next-dsh "..." --ask "..."`
   - 给其他两方发摘要（`to` 按需选 `trae` / `zcode` / `dsh`，三方都要知道时用 `all`）：`send_message({ to: "trae", subject: "交接摘要", body: "改了什么 / 下一步 / 需要你做什么" })`
6. 代码与 git 是唯一真相源；质量数字以 `docs/progress/program-status.json` 为准。
7. **可自行 `git push`**（2026-11-11 用户放行）；**`tag` / `Release` 仍需用户明确确认**；`E2E_REWRITE=1` 仍需用户明确确认（**当前无脚本消费该变量**——`rewrite-chapters` spec 已随「九霄逆脉行」下线，保留本条仅作破坏性 E2E 的通用红线）。
8. 完整协作规范见 Vault 根 `PROJECT-RULES.md`；结构路线见 `docs/PLAN.md`。

## 附：本仓作为独立 DSH 工作区（2026-11-17 起）

用户已确认：**直接在插件仓根开 DSH 工作区**，不要在 vault 根开工作区做插件开发。

- **工作区目录**：`D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai`（cwd = 本仓根）
- **本仓是独立 git 仓**（remote `novel-writer-ai`），vault 的 `.gitignore` 忽略整个 `.obsidian/`，
  两边互不跟踪：在本仓 `git` / `npm` 命令都不需要 `cd`。
- **日常开发不需要 vault**：`typecheck` / `lint` / `test` / `build` / `preflight` 全在本仓内完成。
- **界面级验证用独立开发 vault**：`D:\nw-dev-vault`（其 `.obsidian/plugins/novel-writer-ai`
  是 junction 指回本仓，构建产物即时生效）。见 `docs/dev-vault.md`。
  - 检查：`node scripts/dev-vault.mjs status`
  - 验证加载：`node scripts/dev-vault.mjs verify`
- **不要再往写作 vault 塞测试数据**（示例项目、测试书、缓存、视觉基线中间产物一律放开发 vault）。
- **`obsidian eval` 的路径口径不受工作区 cwd 影响**：它运行在 vault 内，
  读脚本仍用 vault 相对路径，如 `.obsidian/plugins/novel-writer-ai/scripts/xxx.js`。
- 提交前跑 `npm run preflight`（含 30+ 项门禁），视觉改动另跑 `node scripts/check-visual-diff.mjs`。


# ZCode 项目指令（插件仓）

> 本文件用于 ZCode 在插件仓会话自动加载；只做入口，规范正文在 Vault 根 `PROJECT-RULES.md`。

1. **会话开始只读** `../../../PROJECT-RULES.md` 的 `<!-- HANDOFF:START -->` 块（≤10 行）。这是 ZCode 与 Trae 的唯一交接快照。
2. **若 `novel-mailbox` MCP 可用**：调用 `read_messages({ unread_only: true, mark_read: true })` 读取 Trae 留言。
3. 需要细节时按快照「详情」跳转 §三 / §七或本仓 `docs/`。**不要**为了解 Trae 进度去遍历 `.trae/documents/`、`.trae/specs/`、`.zcode/plans/` 或对方生成的报告。
4. **结束会话前**：
   - 更新快照：`node scripts/handoff.mjs --from zcode --stage "..." --delivered "..." --doing "..." --next-zcode "..." --next-trae "..." --ask "..."`
   - 给 Trae 发摘要：`send_message({ to: "trae", subject: "交接摘要", body: "改了什么 / 下一步 / 需要你做什么" })`
5. 代码与 git 是唯一真相源；质量数字以 `docs/progress/program-status.json` 为准。
6. 不自行 push / tag / Release；`E2E_REWRITE=1` 需用户明确确认（**当前无脚本消费该变量**——`rewrite-chapters` spec 已随「九霄逆脉行」下线，保留本条仅作破坏性 E2E 的通用红线）。
7. 完整协作规范见 Vault 根 `PROJECT-RULES.md`；结构路线见 `docs/PLAN.md`。

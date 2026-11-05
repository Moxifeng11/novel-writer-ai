# ZCode 项目指令（插件仓）

> 本文件用于 ZCode 在插件仓会话自动加载；只做入口，规范正文在 Vault 根 `PROJECT-RULES.md`。

1. **会话开始只读** `../../../PROJECT-RULES.md` 的 `<!-- HANDOFF:START -->` 块（≤10 行）。这是 ZCode 与 Trae 的唯一交接快照。
2. 需要细节时按快照「详情」跳转 §三 / §七或本仓 `docs/`。**不要**为了解 Trae 进度去遍历 `.trae/documents/`、`.trae/specs/`、`.zcode/plans/` 或对方生成的报告。
3. **结束会话前更新快照**：
   ```bash
   node scripts/handoff.mjs --from zcode \
     --stage "..." --delivered "..." --doing "..." \
     --next-zcode "..." --next-trae "..." --ask "..."
   ```
   脚本自动写版本/提交/ahead 并追加 Vault `.trae/HANDOFF-LOG.md`；不传字段保留原值。
4. 代码与 git 是唯一真相源；质量数字以 `docs/progress/program-status.json` 为准。
5. 不自行 push / tag / Release；`E2E_REWRITE=1` 需用户明确确认。
6. 完整协作规范见 Vault 根 `PROJECT-RULES.md`；结构路线见 `docs/PLAN.md`。

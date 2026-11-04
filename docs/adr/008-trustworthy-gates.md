# ADR-008 · 门禁必须“真的能拦住”，而不是全绿装饰

- 状态：Accepted
- 日期：2026-11-04
- 决策人：项目维护者
- 关联：[审计报告](../audits/v4.27.0-architecture-and-roadmap.md)、`eslint.config.mjs`、`scripts/check-write-entry.mjs`

## 背景

v4.27.0 审计发现 ESLint 门禁空转：`eslint.config.mjs` 展开 `pluginObsidianmd.configs.recommended.rules`，而该导出实际是 flat config 数组，`.rules` 为 `undefined`。最终只剩两条 `off`，`no-unused-vars`、`no-explicit-any` 等规则从未生效。团队一直看到“lint 通过”，但那是假绿。

同类风险还有：门禁只覆盖部分目录（`domains/`、`utils/`、`main.ts` 不在分层检查内）、基线缺失自动放行、覆盖率文档阈值与配置不一致。

## 选项

| 选项 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A | 一次性把全部规则设为 error | 最强约束 | 存量 1,894 条违规，无法在一个补丁内清完，团队会绕过门禁 |
| B | 规则分级 + 基线棘轮 + 故意违规自测 | 先让关键规则真实生效，存量只降不升 | 需要维护基线，短期仍有 1,894 条 warn |
| C | 保持现状，只修文档 | 成本最低 | 假绿继续，安全/质量问题不可见 |

## 决策

选择 **B**：

1. ESLint 改用 `ruleConfigs.recommended` + 显式注册 `typescript-eslint`；`no-unused-vars`、`no-explicit-any` 等关键规则生效。
2. 存量违规按规则分级：能立即修的修，历史债先 `warn` 并设总数上限（当前 1,900），**不允许整体关闭规则**。
3. 新门禁 `check:write-entry` 采用“网关 + 显式豁免标记”，新增用户可见 md 裸写入直接失败。
4. 门禁必须能被故意违规触发：新增/修改门禁时补一条负向测试或手工验证记录。

**不做**：不使用 `eslint-disable` 批量压警告；不把基线缺失当通过；不为过门禁下调覆盖率阈值。

## 后果

- 正面：关键规则真实生效；新增违规会立即暴露；写入门禁可解释、可豁免。
- 负面/代价：warn 数量短期内很高（1,894），需要持续收敛；基线文件需要维护。
- 迁移与兼容：存量代码不需要一次性改完；新代码必须遵守。
- 如何验证：`npm run lint` 0 error；`npm run check:write-entry` 通过；在临时文件写入 `adapter.write('x.md')` 必须失败。

## 替代与后续

- 未来当 warn 降到可控范围（如 <300），把高频规则升级为 error。
- 若某规则误报率高，先记录原因再降级，不允许静默删除。

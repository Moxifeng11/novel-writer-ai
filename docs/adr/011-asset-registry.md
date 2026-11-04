# ADR-011 · AssetRegistry：模板/提示词/规则/风格/指纹统一为“资产”

- 状态：Accepted（M4 实施）
- 日期：2026-11-04
- 决策人：项目维护者
- 关联：[ROADMAP.md](../roadmap/ROADMAP.md)、`engine/prompt-resolver.ts`、`engine/template-service.ts`、`services/rules-service.ts`

## 背景

同一类“影响生成结果的东西”目前有多套命名与来源：

- 模板：`TemplateService.getStepPrompt` 与 `resolveStepPrompt` 两条合并管线；
- 写作规则：vault 唯一来源已收口，但正文仍有多处派生；
- 文笔风格/指纹：v1/v2 风格库、项目级/全局指纹库并存；
- 知识库/实体：注入逻辑分散在各引擎。

用户问“为什么这一章生成成这样”时，很难回答“用了哪个模板、哪版规则、哪些资产、顺序是什么”。

## 选项

| 选项 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A | 保持现状，只补文档 | 无迁移成本 | 多源问题继续放大 |
| B | 建 `AssetRegistry`，统一描述来源/作用域/优先级/影响范围 | 可解释、可配置、可迁移 | 需要定义资产模型并迁移现有入口 |
| C | 只统一模板，其它不动 | 局部改善 | 规则/风格/指纹仍多源 |

## 决策

选择 **B**，分两步落地：

1. **先收口解析入口**：`resolveStepPrompt` 作为步骤提示词唯一解析；规则正文单源派生；风格/指纹只保留 v2 入口。
2. **再建资产视图**：`AssetRegistry` 提供 `list()` / `resolve()` / `explain()`，每项资产带 `kind`（template/prompt/rules/style/fingerprint/knowledge）、`scope`（global/project/template）、`source`（vault/builtin/override）、`version/hash`、`priority`。
3. UI 只消费 registry 的“来源 + 生效顺序 + 影响范围”，不自己拼路径。

**不做**：不把资产存进数据库；资产仍是 vault 文件或内置常量，registry 只做索引与解析。

## 后果

- 正面：生成结果可追溯；设置页可展示“当前生效资产”；迁移/覆盖规则集中。
- 负面/代价：需要统一现有路径与缓存失效；registry 本身要保持轻量，不能每次生成全量扫描。
- 迁移与兼容：旧模板/规则文件继续可读；registry 解析失败时回退现有 `resolveStepPrompt`。
- 如何验证：资产解析单测（优先级/来源/hash）；设置页展示与真实注入一致；长篇/短篇各一条生成快照。

## 替代与后续

- 若未来做模板市场，registry 可作为安装/版本/依赖的元数据层，但不改变“文件在 vault”的事实。

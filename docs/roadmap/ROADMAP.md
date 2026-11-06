# 路线图（ROADMAP）

> 版本：v4.56.0 · 2026-11-04
> 详细问题清单与证据见 [审计报告](../audits/v4.27.0-architecture-and-roadmap.md)；产品定位见 [PRODUCT.md](../PRODUCT.md)。

## 路线选择

采用 **A→B 渐进**：先把门禁、数据安全、单一事实源打牢（A），再统一入口、补齐短篇/剧本闭环，最后做资产/上下文/成本/性能的体验跃迁（B）。不推倒重来，不做一次性大重构。

交付节奏：**里程碑交付**。每个里程碑一个版本节点、一份 release notes、一次完整回归、一个本地稳定提交；push/tag/Release 另行授权。

## 里程碑总览

| 里程碑 | 时间 | 版本 | 主题 | 退出条件 |
|---|---|---|---|---|
| M1 | 第 1 周 | v4.27.1 | 可信门禁 + 安全止血 | `preflight:release` 全绿；Agent 覆盖需确认；dsh 固定版本/Key 解密；v1 密钥残留 0；写入门禁生效 |
| M2 | 第 2–3 周 | v4.28.0 ✅ 已交付 | 统一入口 + 任务中心 + 首启 | 新用户 3 分钟出第一章；任务可取消/重试；重复入口从主导航移除 |
| M3 | 第 3–5 周 | v4.29.0 ✅ 已交付 | 短篇/剧本最小闭环 | 短/剧创建→导出无手填断点；质检/结算落盘；E2E 各 1 条；长篇无回归 |
| M4 | 第 6–10 周 | v4.30.0–v4.32.0 ✅ 已交付 | 体验跃迁 | 资产来源/生效顺序可见；全模式上下文注入；成本账本可对账；大文件下降 |
| M5 | 第 11–12 周+ | 待定 | 平台化评估（不默认实施） | 仅在 M1–M4 指标达成后评估公共 API/MCP/市场/云协作 |

## M1 · v4.27.1（进行中/本次交付）

**目标**：让“全绿”重新可信，并把最高危的安全/数据问题止血。

- [x] ESLint flat config 修复；关键规则生效；存量 warn 上限 1,900；lint 0 error。
- [x] Agent 覆盖已存在文件默认 `ask`；设置项“Agent 写入确认”（默认 ask）。
- [x] dsh 固定 `@deepseek-ai/dsh@0.2.1-rc.5`（可配置）；启动前校验；Key 解密后注入。
- [x] v1 密文自动升级 v2 + 计数；设置迁移/回写前 `data.json.bak`。
- [x] `BODY_CONTENT_ROOTS` 从 `MODE_LIBRARY_ROOTS` 派生；短/剧布局回归。
- [x] `check:write-entry` 门禁；报告/模板/示例/创建流程改为 `writeVaultText`。
- [x] 审计报告、PRODUCT、ROADMAP、ADR-008~012、缺失 release notes。
- [ ] 全量 `preflight:release` + mock E2E 回归（提交前执行）。

**风险**：ESLint 真实启用会暴露存量问题——按规则分级，不整体关闭；dsh 固定版本牺牲自动升级——提供显式版本设置。

## M2 · v4.28.0（第 2–3 周，已交付）

**目标**：让用户“知道从哪开始、知道任务在跑什么”。

- 创作主页：长篇/短篇/剧本三卡 + 最近项目 + 下一步建议；现有四视图作为子页/深链。
- 命令分组：创作 / 资料 / 诊断 / 设置；隐藏重复入口但保留深链。
- `JobService`：基于 `execution-ledger` + `AbortSignal` 统一注册批量/结算/拆解/导出；任务中心支持进度、取消、重试、失败汇总。
- 首启向导：提供商选择 → Key → 连通性测试 → 示例项目 → 第一章。
- 统一错误/空态组件（原因 + 修复按钮 + 设置跳转）；项目体检 MVP。

**验收**：新用户 3 分钟内完成配置并写出示例第一章；任务中心可取消/重试；重复入口从主导航移除且命令仍可深链。

## M3 · v4.29.0（第 3–5 周，已交付）

**目标**：短篇/剧本从“半成品”变成可交付闭环。

- `ModeRuntime`：统一 `ProjectContextService`（项目/章节/实体/故事核/场景圣经/RAG/指纹）。
- 短篇：AI 故事核 → 分节大纲 → 开篇三屏 → 单元写作 → 六维质检 → 单元结算。
- 剧本：分集大纲 → 场景圣经 → 分镜表 → 分集写作 → 可拍质检 → 单元结算。
- `QualityProfile` 按模式配置维度/阈值；`RevisionGuard` 按模式适配。
- 平台导出包：番茄短篇/红果短剧的命名、字数口径、简介/标签、敏感词预检。
- E2E：短篇/剧本 mock AI 最小旅程各 1 条；UI 文案与实际指标一致。

**验收**：短/剧创建→导出无手填断点；质检/结算落盘；E2E 通过；长篇主旅程无回归。

## M4 · v4.30.0–v4.32.0（第 6–10 周，已交付）

**目标**：资产、上下文、成本、版本四件事从“能跑”变成“可解释、可对账”。

- 资产模型收敛：模板/提示词/规则/文笔风格/指纹统一“资产”层级与生效顺序；`resolveStepPrompt` 唯一解析；`AssetRegistry` 提供列表/来源/影响范围。
- 全模式接入知识库/指纹/实体；RAG 混合检索（BM25 + 向量）与 rerank，引用置信度。
- 成本/调用账本 UI：每章/每步/每模型 token、费用、重试；所有 AI 调用接入任务路由。
- 版本/备份中心：正文、步骤结果、设置、结算表统一历史与 diff/恢复。
- 大文件第一批切片：`co-writing-view.ts`、`co-writer-engine.ts`、`knowledge-base-view.ts`。

**验收**：资产来源与生效顺序可视化；短/剧全模式上下文注入；成本账本可对账；大文件行数下降且行为快照测试通过。

## M5 · 平台化评估（已评估：四项均不实施，见 audits/m5-platform-assessment.md）

仅在 M1–M4 指标达成后评估：公共插件 API（registerTool/step/exporter）、MCP、模板市场、云同步/协作。实时协作/账号/计费暂缓。

## 指标与门禁

每个里程碑固定执行：

```bash
npm run typecheck
npm run lint
npm test
npm run test:cov
npm run preflight:release
OBSIDIAN_PATH=... npx playwright test --project=obsidian-electron --project=full-journey --project=button-states --project=view-lifecycle --project=lifecycle
OBSIDIAN_PATH=... E2E_PERF=1 npx playwright test --project=perf-smoke
```

目标：lint 关键规则真实生效；覆盖率不下降；0 覆盖文件 83 → ≤40；白名单外裸 adapter 写入 0；卸载 flush 有完成/超时记录；`main.js` ≤5 MB；空闲 CPU <5%。

## 变更管理

- 每个里程碑先写 ADR/验收清单，再按“门禁 → 数据 → UI → 模式 → 资产”顺序。
- 新能力用 feature flag/strangler；旧项目/旧配置必须可读。
- 每批改动补回归；禁止下调阈值掩盖失败。
- 版本号、CHANGELOG、release notes、`versions.json` 同步更新；本地提交后再谈 push/tag。

# 模块清单（Module Registry）

> 状态：活跃 · 2026-11-17
> 维护规则：新模块先在这里登记再开工；状态 `todo` → `doing` → `review` → `stable`。
> 制度与流程见 [MODULE-OPTIMIZATION-PLAYBOOK.md](MODULE-OPTIMIZATION-PLAYBOOK.md)。

| 模块 | 代码入口 | 数据/配置 | 状态 | 本轮/下轮目标 | 模块页 |
| --- | --- | --- | --- | --- | --- |
| API 配置 / 模型渠道 | `ui/settings/api-section.ts`、`core/provider-manager.ts`、`shared/provider-ui-model.ts`、`services/model-discovery.ts`、`shared/model-pricing.ts` | `customProviders`、`providerKeys`、`providerAssignments`、`providerThinking`、`providerTaskBudgets`、`enabledProviderIds`、`modelMeta`（识别缓存） | stable（验收通过 2026-11-16） | 端点能力自动识别/价格按渠道/模型弹窗/联网检索；下一轮按反馈打磨 | [api-config.md](api-config.md) |
| 桌宠 | `ui/writing-pet.ts`、`shared/pet-image-store.ts` | `petImage`、`pet-image.png/json` | stable | 无（已验收） | [pet.md](pet.md) |
| 写作工作台首页 | `ui/full-writer/project-selector-controller.ts`、`ui/full-writer/recent-projects.ts`、`ui/full-writer/next-step.ts`、`ui/home-view.ts` | `projectLastOpened` | stable（验收通过 2026-11-16） | 最近排序 / 下一步推演 / 主操作卡 / 旧版工具与卡片动作收纳 | [workbench-home.md](workbench-home.md) |
| 新手向导 | `ui/full-writer/wizard-controller.ts`、`ui/full-writer/wizard-step-renderers.ts`、`ui/full-writer/wizard-checker.ts`、`styles-src/30-wizard-steps.css` | 项目目录 `01-设定/`、`02-大纲/`、`03-章节/`；进度状态在内存 | stable（视觉重构 Slice J 完成 2026-11-17） | 9 个渲染方法已语义化（nw-wizard-*）；后续：步骤条左侧统一入 30 号文件、实体卡配色对齐令牌 | [full-writer-wizard.md](full-writer-wizard.md) |
| 监控面板 B（完成度 / 偏离 / 质量） | `ui/monitor-panel-b.ts`、`ui/draggable-panel.ts`、`styles-src/31-monitor-panel-b.css` | 每本书一份质量历史 JSON（`services/quality-history-store.ts`）；内存 `baselineHistory`（200 章上限）/ `qualityHistory`（20 条） | stable（视觉重构 Slice K 完成 2026-11-17） | 232 处 `nw-u-*` + 18 处内联样式已清零（`nw-monb-*`）；后续：图表坐标常量抽纯函数、详情三段模板合并 | [monitor-panel-b.md](monitor-panel-b.md) |
| 写作指纹库 | `ui/views/writing-fingerprint-view.ts`、`ui/fingerprint-detail-modal.ts`、`ui/views/fingerprint-v2-detail.ts`、`styles-src/32-fingerprint.css` | `data/global-fingerprints.json`；`<项目>/04-项目总控/写作指纹库/project-fingerprints.json` | stable（视觉重构 Slice L 完成 2026-11-17） | 405 处 `nw-u-*` + 15 行内联 `style` 已清零（`nw-fp-*`）；后续：三个 Modal 拆独立文件、两套前缀统一 | [writing-fingerprint.md](writing-fingerprint.md) |
| 大纲智能扩写编辑器 | `ui/outline-expand-modal.ts`、`styles-src/25-outline-expand.css`、`engine/outline-to-text-expander.ts` | 编辑器选区/全文（内存）；正文为空时回退读 `<项目>/…/第N章_Scene展开.md` | stable（视觉重构 Slice M 完成 2026-11-17） | 220 处 `nw-u-*` + 1 处内联样式已清零（`nw-oe-*`）；后续：拆分渲染/扩写/应用三段、`applyResult` 是否落盘待定 | [outline-expand-editor.md](outline-expand-editor.md) |
| 提示词管理设置（4 页签 + 5 弹窗） | `ui/prompt-manager-settings.ts`、`styles-src/33-prompt-manager.css`、`services/prompt-manager.ts` | 插件 `data.json` 的 `settings.promptManagerConfig`（自定义模板 / A/B 测试 / 使用记录） | stable（视觉重构 Slice N 完成 2026-11-17） | 192 处 `nw-u-*` + 15 处内联样式已清零（`nw-pm-*`）；后续：5 个弹窗拆文件、列表增量渲染 | [prompt-manager-settings.md](prompt-manager-settings.md) |
| 章节大纲树弹窗（分卷大纲 · 冲突预览） | `ui/chapter-outline-tree-modal.ts`、`styles-src/34-outline-tree.css` | 按卷 `第N卷_分卷大纲.md`、`第N章_Scene展开.md`（v3 兜底 `分卷大纲.md`） | stable（视觉重构 Slice O 完成 2026-11-17） | 177 处 `nw-u-*` + 2 处内联样式已清零（`nw-ot-*`）；后续：1392 行拆文件、区间过滤状态持久化、全文面板截断提示 | [outline-tree-modal.md](outline-tree-modal.md) |
| 知识库主视图（拆解任务页 · 底部监控条） | `ui/views/knowledge-base-view.ts`、`ui/views/kb-task-panel.ts`、`styles-src/27-knowledge-base.css` | `plugin.deconstructionScheduler` 任务表（内存）、`vectorProvider*` / `vectorConnectionStatus` 设置；任务进度 JSON 不落盘 | stable（视觉重构 Slice P 完成 2026-11-17） | 175 处 `nw-u-*` + 9 处内联样式已清零（`nw-kb-tasks-*` / `nw-kb-monitor-*`，6 场景 0 像素差）；后续：P-05 合并书架头两份实现、任务页拆文件、监控条与面板 B 命名统一 | [knowledge-base-view.md](knowledge-base-view.md) |
| 上下文监控面板（全屏写作右栏 · Token 预算） | `ui/rendering/context-panel.ts`、`styles-src/35-context-panel.css` | `GatheredContext`（`engine/context/context-types.ts`）与 `plugin._smartEntityContext`；不落盘 | stable（视觉重构 Slice Q 完成 2026-11-17） | 173 处 `nw-u-*` + 3 处内联样式已清零（`nw-cp-*`，5/6 场景 0 像素差，唯一差异为告警条背景按意图恢复）；后续：956 行拆文件、缺失实体 DOM 结构、折叠状态持久化 | [context-panel.md](context-panel.md) |
| 规划 / 大纲 | `ui/views/planning-canvas-view.ts`、`ui/planning/*`、`ui/chapter-outline-tree-modal.ts`、`ui/plan-book-modal.ts`、`ui/full-writer/scene-outline-controller.ts`、`engine/outline-*`、`domains/planning/model.ts` | 分卷大纲 md、`04-项目总控/规划/画布.json`、章节 Scene 字段 | review（P0+P1+顺延完成 2026-11-16） | 画布撤销/搜索/缩放/键盘/事件↔章节双向链接/场景跨章复制/树↔画布桥接/扩写逐段采用/参数记忆/内联样式收敛 | [planning.md](planning.md) |
| 设定 / 人物卡（含知识库） | `ui/views/knowledge-base-view.ts`、`ui/views/book-detail-renderer.ts`、`ui/knowledge-*modal*.ts`、`styles-src/27-knowledge-base.css` | 知识库 json、书籍拆解数据 | doing（视觉重构 Slice A+B+C+D 完成 2026-11-16） | 书架外壳/工具栏/卡片/外壳/页签/概览已语义化；后续：详情各页签内容区、弹窗 | [knowledge-base.md](knowledge-base.md) |
| 正文编辑器 / 协同写作 | `ui/co-writing-view.ts`、`ui/co-writing/*`、`engine/co-writer*` | 章节、协同配置、`coWrite*` 设置 | stable（2026-11-16 全量自检通过） | 查找替换/章节流转/字数目标/撤销重做/建议 diff/字号行距/专注/高亮/光标/简报入口；11 项真实缺陷已修 | [co-writing.md](co-writing.md) |
| 质量闭环 / 审稿 | `ui/quality-loop-modal.ts`、`engine/quality-*` | 质量报告、修订记录 | todo | 闭环入口、报告可读性、一键修复 | — |
| 统计 / 进度 | `ui/writing-stats*`、`engine/writing-stats*` | 字数、进度、目标 | todo | 图表可读性、目标设置 | — |
| MCP / Agent | `ui/mcp-*`、`engine/agent/harness/mcp-*` | `mcpServers` | review（二期完成） | 运行时统计展示、失败重试可视化 | — |
| 市场 / 插件 | `community-marketplace`、`ui/marketplace-*` | 插件索引、安装状态 | todo | 首装引导、下载即用闭环 | — |
| 设置框架 / 导航 | `ui/settings-tab.ts`、`ui/settings/section-*`、`ui/mini-settings-modal.ts`、`ui/settings/settings-search.ts` | `settingsUiShowAdvanced`、分区注册表 | stable（验收通过 2026-11-16） | 搜索（A3）/两宿主统一装配/导航记忆/指令直达/工作台菜单 | [settings-navigation.md](settings-navigation.md) |
| 导出 / 发布 | `ui/export-*`、`engine/export*` | 导出模板、发布配置 | todo | 导出流程、格式完整性 | — |

## 推进顺序建议

1. **API 配置**收尾（本轮）
2. **设置框架 / 导航**（所有模块的门面，先统一交互规范）
3. **写作工作台首页**（使用频率最高）
4. **正文编辑器 / 协同写作**
5. 规划 / 设定 / 质量闭环 / 统计
6. MCP / 市场 / 导出

顺序可按用户当轮关注点调整，但一次只推进一个模块。

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
| 书籍详情渲染（题材分类 · 质量评分 · 标签页） | `ui/views/book-detail-renderer.ts`、`ui/views/book-detail-metrics.ts`、`styles-src/27-knowledge-base.css` | `BookBasicInfo`（`qualityScores` / `themeTags` / `techniqueTags` / `customTags` / `genreRecommendations`）；题材名走 `kb.getGenre` / `getSubGenre` | stable（视觉重构 Slice S 完成 2026-11-17） | 126 处 `nw-u-*` + 3 处内联样式已清零（`nw-kb-detail-*` 续用 Slice C/D/E 命名空间，4 场景 3 个 0 像素差）；后续：2206 行覆盖率 0.42%、三块渲染抽纯函数、雷达图窄栏适配 | [book-detail.md](book-detail.md) |
| 场景细纲面板（场景卡列表 · 三页签编辑器） | `ui/full-writer/scene-outline-controller.ts`、`styles-src/37-scene-outline.css`、`styles-src/25-planning-outline-controls.css` | 章节 md 的 Scene 字段（`ExtendedSceneData`）；自动保存防抖 1s，脏数据带 `pendingSaveTarget` 防切章写错文件 | stable（视觉重构 Slice T 完成 2026-11-17） | 123 处 `nw-u-*` + 5 处内联样式已清零（`nw-so-*`，6 场景 0 像素差）；后续：1209 行拆文件、非选中卡 hover 待定、拖拽排序抽纯函数 | [scene-outline.md](scene-outline.md) |
| 知识库设置分区（列表 · 筛选 · 向量表单） | `ui/settings/knowledge-section.ts`、`styles-src/38-settings-knowledge.css`、`ui/settings/section-factory.ts` | `BookBasicInfo`（`services/knowledge-base-manager.ts:78`）；`vectorProvider*` / `vectorConnectionStatus` / `vector*ApiKey` 设置；书籍列表来自 `engineRegistry` 的 `KNOWLEDGE_BASE_MANAGER` | stable（视觉重构 Slice U 完成 2026-11-17） | 108 处 `nw-u-*` + 11 处内联样式已清零（`nw-st-kb-*`，7 场景 0 像素差）；后续：788 行拆文件、标签筛选行接交互、搜索恢复焦点改局部 querySelector | [settings-knowledge.md](settings-knowledge.md) |
| 文笔润色编辑器 / AI 润色弹窗 | `ui/polish-editor.ts`、`styles-src/39-polish-editor.css` | `stepResults['bodyGeneration']`（正文）、`stepRunner.getEntityNames(project)`（实体名）、`RhythmAnalysis`（节奏）；不落盘 | stable（视觉重构 Slice V 完成 2026-11-17） | 104 处 `nw-u-*` + 3 处内联样式已清零（`nw-pe-*`，8 场景 0 像素差）；后续：修 `Modal.open()` 覆写 `selection` 的崩溃（PE-06）、830 行拆文件、图例颜色与 colorConfig 合并 | [polish-editor.md](polish-editor.md) |
| 补全拆解 / 重新提取指纹弹窗 | `ui/refill-modal.ts`、`styles-src/40-refill-modal.css` | `knowledgeBaseManager.getDimensionStatus(bookId)`（8 维状态）、`StyleFingerprint`（features / samples / sourceText，现算完整度）；不落盘 | stable（视觉重构 Slice W 完成 2026-11-17） | 97 处 `nw-u-*` + 14 处内联样式已清零（`nw-rf-*`，6 场景 0 像素差；维度卡 `transition:all` 改双属性是有意偏差）；后续：650 行拆三个文件、补 DOM 冒烟测试、进度条字段改局部变量 | [refill-modal.md](refill-modal.md) |
| 质量统计面板 | `ui/views/kb-stats-panel.ts`、`ui/views/kb-panels-logic.ts`、`styles-src/27-knowledge-base.css` | 知识库 `allBooks` 只读快照（`qualityScores` / `primaryGenre` / 拆解状态）；图表经 `host.renderChart` 挂载，题材名走 `host.getGenreName`；不落盘 | stable（视觉重构 Slice X 完成 2026-11-17） | 81 处 `nw-u-*` + 4 处内联样式已清零（`nw-ks-*`，5 场景 0 像素差）；后续：窄栏改 `auto-fit`、状态清单加「点击筛选」、三张图尺寸提到逻辑层 | [kb-stats.md](kb-stats.md) |
| 规划 / 大纲 | `ui/views/planning-canvas-view.ts`、`ui/planning/*`、`ui/chapter-outline-tree-modal.ts`、`ui/plan-book-modal.ts`、`ui/full-writer/scene-outline-controller.ts`、`engine/outline-*`、`domains/planning/model.ts` | 分卷大纲 md、`04-项目总控/规划/画布.json`、章节 Scene 字段 | review（P0+P1+顺延完成 2026-11-16） | 画布撤销/搜索/缩放/键盘/事件↔章节双向链接/场景跨章复制/树↔画布桥接/扩写逐段采用/参数记忆/内联样式收敛 | [planning.md](planning.md) |
| 设定 / 人物卡（含知识库） | `ui/views/knowledge-base-view.ts`、`ui/views/book-detail-renderer.ts`、`ui/knowledge-*modal*.ts`、`styles-src/27-knowledge-base.css` | 知识库 json、书籍拆解数据 | doing（视觉重构 Slice A+B+C+D 完成 2026-11-16） | 书架外壳/工具栏/卡片/外壳/页签/概览已语义化；后续：详情各页签内容区、弹窗 | [knowledge-base.md](knowledge-base.md) |
| 正文编辑器 / 协同写作 | `ui/co-writing-view.ts`、`ui/co-writing/*`、`engine/co-writer*` | 章节、协同配置、`coWrite*` 设置 | stable（2026-11-16 全量自检通过） | 查找替换/章节流转/字数目标/撤销重做/建议 diff/字号行距/专注/高亮/光标/简报入口；11 项真实缺陷已修 | [co-writing.md](co-writing.md) |
| 质量闭环 / 审稿 | `ui/quality-loop-modal.ts`、`engine/quality-*` | 质量报告、修订记录 | todo | 闭环入口、报告可读性、一键修复 | — |
| 统计 / 进度 | `ui/writing-stats*`、`engine/writing-stats*` | 字数、进度、目标 | todo | 图表可读性、目标设置 | — |
| MCP / Agent | `ui/mcp-*`、`engine/agent/harness/mcp-*` | `mcpServers` | review（二期完成） | 运行时统计展示、失败重试可视化 | — |
| 市场 / 插件 | `community-marketplace`、`ui/marketplace-*` | 插件索引、安装状态 | todo | 首装引导、下载即用闭环 | — |
| 设置页通用分区（性能 / 规则 / 关于 / 角色识别 / 建议） | `ui/settings/general-sections.ts`、`styles-src/36-settings-general.css`、`services/performance-monitor.ts` | `plugin.settings`（监控/建议开关、识别阈值）；性能日志在内存（上限 1000 条）；更新信息来自 `UPDATE_CHECKER` | stable（视觉重构 Slice R 完成 2026-11-17） | 160 处 `nw-u-*` + 11 处内联样式已清零（`nw-st-*`，8 场景 0 像素差）；后续：1257 行按分区拆文件、窄窗表格滚动 | [settings-general.md](settings-general.md) |
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

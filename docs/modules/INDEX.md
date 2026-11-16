# 模块清单（Module Registry）

> 维护规则：新模块先在这里登记再开工；状态 `todo` → `doing` → `review` → `stable`。
> 制度与流程见 [MODULE-OPTIMIZATION-PLAYBOOK.md](MODULE-OPTIMIZATION-PLAYBOOK.md)。

| 模块 | 代码入口 | 数据/配置 | 状态 | 本轮/下轮目标 | 模块页 |
| --- | --- | --- | --- | --- | --- |
| API 配置 / 模型渠道 | `ui/settings/api-section.ts`、`core/provider-manager.ts`、`shared/provider-ui-model.ts`、`services/model-discovery.ts`、`shared/model-pricing.ts` | `customProviders`、`providerKeys`、`providerAssignments`、`providerThinking`、`providerTaskBudgets`、`enabledProviderIds`、`modelMeta`（识别缓存） | stable（验收通过 2026-11-16） | 端点能力自动识别/价格按渠道/模型弹窗/联网检索；下一轮按反馈打磨 | [api-config.md](api-config.md) |
| 桌宠 | `ui/writing-pet.ts`、`shared/pet-image-store.ts` | `petImage`、`pet-image.png/json` | stable | 无（已验收） | [pet.md](pet.md) |
| 写作工作台首页 | `ui/full-writer/project-selector-controller.ts`、`ui/full-writer/recent-projects.ts`、`ui/full-writer/next-step.ts`、`ui/home-view.ts` | `projectLastOpened` | stable（验收通过 2026-11-16） | 最近排序 / 下一步推演 / 主操作卡 / 旧版工具与卡片动作收纳 | [workbench-home.md](workbench-home.md) |
| 规划 / 大纲 | `ui/views/planning-canvas-view.ts`、`ui/planning/*`、`ui/chapter-outline-tree-modal.ts`、`ui/plan-book-modal.ts`、`ui/full-writer/scene-outline-controller.ts`、`engine/outline-*`、`domains/planning/model.ts` | 分卷大纲 md、`04-项目总控/规划/画布.json`、章节 Scene 字段 | review（P0+P1+顺延完成 2026-11-16） | 画布撤销/搜索/缩放/键盘/事件↔章节双向链接/场景跨章复制/树↔画布桥接/扩写逐段采用/参数记忆/内联样式收敛 | [planning.md](planning.md) |
| 设定 / 人物卡（含知识库） | `ui/views/knowledge-base-view.ts`、`ui/views/book-detail-renderer.ts`、`ui/knowledge-*modal*.ts`、`styles-src/27-knowledge-base.css` | 知识库 json、书籍拆解数据 | doing（视觉重构 Slice A+B+C 完成 2026-11-16） | 书架外壳/工具栏/卡片/详情公共构件与概览页已语义化；后续：详情其余分区、弹窗 | [knowledge-base.md](knowledge-base.md) |
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

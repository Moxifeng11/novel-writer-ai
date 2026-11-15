# API 配置 / 模型渠道

> 状态：review（第一轮完成，待用户验收交互细节）　｜　最后更新：2026-11-16　｜　Owner：dsh

## 1. 定位

- 用户视角：配置写作用到的 AI 渠道（供应商）、Key、模型，以及每个任务用哪个模型/多少预算。
- 代码入口：`ui/settings/api-section.ts`、`core/provider-manager.ts`、`shared/provider-ui-model.ts`、`engine/ai-api-client.ts`、`engine/engine-registry.ts`
- 数据字段：`customProviders`（渠道）、`providerKeys`（各渠道 Key）、`apiEndpoint/defaultModel/flashModel/proModel`（当前渠道）、`providerAssignments`（各渠道模型分配）、`providerThinking`（各渠道思考强度）、`providerTaskBudgets`（各渠道任务级参数）、`enabledProviderIds`（其他模块是否显示）、`modelOverrides`、`taskBudgets`

## 2. 现状

- 预设渠道 = 4 个：本地 Ollama、DeepSeek 官网、日日新/SenseNova、OpenCode Zen；历史预设（火山/CatCat）升级时转成自定义渠道，新预设自动补齐。
- 详情页行内编辑：名称、Base URL、协议、Key、模型列表（行内新增/编辑/启用/删除）；「测试连通性」「从 URL 获取」。
- 「设为当前」切换写作渠道；「在其他模块显示」只控制快切/模型弹层/工作台/协同里的渠道列表。
- 切换渠道时：保存旧渠道的 模型分配 + 任务级参数，恢复目标渠道的；Key 按渠道保存。
- 思考强度：按渠道自动识别下发形态（reasoning_effort / thinking.type / budget_tokens / 不下发），仅对支持的渠道显示设置。
- 请求头：内置适配（OpenRouter Referer/Title、Anthropic 版本）+ 用户自定义覆盖。
- 图片输入：模型「视觉」标记 + 渠道能力区汇总 + 行内勾选。
- 密钥解锁卡片在页面顶部。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-01 | P1 | 预设供应商过多（6 个里只有 2 个真用） | 收敛为 4 个：Ollama/DeepSeek/SenseNova/OpenCode | done |
| M-02 | P0 | 「启用」开关实际是「切换当前渠道」，语义误导 | 拆成「在其他模块显示」+「设为当前」 | done |
| M-03 | P0 | 切换渠道后全局模型分配被重置 | 每渠道各自记忆，切换恢复 | done |
| M-04 | P1 | 密钥解锁藏在页面底部折叠区 | 顶部卡片，锁定高亮 | done |
| M-05 | P1 | 添加供应商/编辑模型都要弹窗 | 行内表单/行内展开 | done |
| M-06 | P1 | 思考强度只按端点硬编码、所有渠道都显示 | 按渠道自动识别，仅支持渠道可设 | done |
| M-07 | P1 | 图片输入能力不可见 | 模型标记 + 渠道汇总 + 行内开关 | done |
| M-08 | P1 | 无法加自定义请求头 | 渠道级 headers + 内置适配 | done |
| M-09 | P2 | 任务级参数切换渠道后互相污染 | 按渠道记忆 | done |
| M-10 | P2 | 侧栏看不出该渠道用什么模型/是否隐藏 | 行内显示模型摘要 + 「已隐藏」标记 | done |
| M-11 | P2 | 协同写作的云端渠道下拉列出已隐藏渠道 | 按启用列表过滤 | done |
| M-12 | P2 | 供应商详情页信息密度/分组还能更好 | 下一轮打磨 | open |
| M-13 | P3 | 「更多操作」菜单的删除/切换入口不够显眼 | 视用户反馈决定 | open |

## 4. 关键决策

- 2026-11-16：预设收敛为 4 个，但**不删除**历史预设配置，升级时转自定义渠道（数据安全优先）。
- 2026-11-16：`enabledProviderIds` 未设置 = 全部显示，避免老用户升级后渠道突然消失。
- 2026-11-16：渠道切换保存/恢复 模型分配 + 任务级参数，而不是重置成 `models[0..1]`。
- 2026-11-16：思考强度按「协议/端点/模型」识别，不要求用户手选协议；未知渠道不下发参数，避免 400。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-16 | 单测：`provider-ui-model` 19 条 + `provider-manager-channels` 6 条 | 全过 | vitest |
| 2026-11-16 | DOM：`api-section-dom.test.ts` 7 条（含密钥卡片/启用语义/行内新建断言） | 全过 | vitest |
| 2026-11-16 | 实机：启动耗时 40ms 内；渠道列表 6 项（4 预设 + 迁移火山/CatCat） | 正常 | obsidian eval |
| 2026-11-16 | 实机：关闭「在其他模块显示」→ 可用渠道 6→5，当前渠道不变 | 正常 | obsidian eval |
| 2026-11-16 | 实机：Ollama 存分配 → 切过去生效 → 切回 DeepSeek 恢复 | 正常 | obsidian eval |
| 2026-11-16 | 实机：思考识别 DeepSeek=thinking、Ollama=不支持；设置页 DOM 校验通过 | 正常 | obsidian eval |
| 2026-11-16 | 门禁：`npm run preflight` EXIT=0（933 测试文件） | 通过 | preflight |

## 6. 测试清单

- 纯逻辑：`tests/unit/shared/provider-ui-model.test.ts`、`tests/unit/core/provider-manager-channels.test.ts`
- UI/DOM：`tests/unit/ui/api-section-dom.test.ts`
- 回归：`provider-manager-key-preserve/limits/remove`、`settings-*`、`ai-thinking-params`
- 实机检查：默认态、渠道切换、关闭显示、解锁卡片、行内新建/编辑、重载后状态

## 7. 剩余 backlog

- [ ] 供应商详情页分组与密度（P2）
- [ ] OpenRouter 等渠道的模型列表自动识别能力（视觉/上下文）更准确（P2）
- [ ] 更多操作菜单的删除/切换入口（P3）
- [ ] 任务级参数在非当前渠道时的编辑态（当前只读提示，可考虑直接编辑写入该渠道）（P2）

## 8. 交接备注

- 下一轮建议从 M-12/M-14 开始；交互细节按用户实际使用反馈优先。
- 改动该模块时注意：`engine/engine-registry.ts` 在设置加载前会调 `migrateLegacyPresets()`，必须允许「设置未就绪」时静默跳过（曾导致插件加载失败）。

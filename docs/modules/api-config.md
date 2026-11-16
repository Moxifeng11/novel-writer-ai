# API 配置 / 模型渠道

> 状态：review（第二轮完成，待用户验收）　｜　最后更新：2026-11-16　｜　Owner：dsh

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

### 第二轮（2026-11-16 用户验收反馈）

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-14 | P0 | 本地 Ollama 测试连通性必 404：端点被拼成 `/api/generate/v1/chat/completions`；无 Key 时还会被当成云端要求密钥 | 原生端点（`/api/generate`、`/api/chat`）原样保留；本地渠道免 Key；点测试即可出结果 | done |
| M-15 | P0 | Ollama「从 URL 获取」404：请求 `/api/generate/models` | 原生端点走 `/api/tags`，解析 `models[].name` | done |
| M-16 | P0 | 模型编辑里填的上下文窗口/输出上限完全不生效（`resolveModelLimits` 不读 `modelMeta`），只影响列表徽章 | 识别值进入预算解析：`modelOverrides` > `modelMeta` > 运行时探测 > 内置表 > 渠道默认 | done |
| M-17 | P0 | 「测试连通性」不带渠道内置/自定义请求头，与真实调用不一致（OpenCode Go 因此 400 MissingSessionID） | 测试与真实调用共用同一套请求头来源 | done |
| M-18 | P0 | OpenCode Go 渠道内置适配写死「无需额外请求头」 | 自动补 `x-opencode-session`（稳定会话 id）+ 客户端 UA | done |
| M-19 | P1 | 全局模型分配里的最大上下文/最大输出是手填覆盖，不随渠道/模型自动识别 | 自动识别该渠道该模型能力并显示来源；手填仅作覆盖 | done |
| M-20 | P1 | 单价按模型名跨渠道精确匹配，无法按渠道识别，费用算不出 | 价格按「渠道 + 模型」识别；「从 URL 获取」自动带出端点披露价格；同名模型跨渠道不串价 | done |
| M-21 | P1 | 行内模型编辑太窄（窄面板下模型 ID 竖排单字） | 改弹窗表单（用户明确要求弹窗） | done |
| M-22 | P1 | 思考强度只看 `models[0]`；OpenCode 显示「支持」但运行时根本不下发（判定与下发链路不一致） | 按「渠道 + 每个模型」判定，判定结果直接驱动下发 | done |
| M-23 | P1 | 任务级模型参数在非当前渠道展示的仍是当前渠道数据（`taskBudgets` vs `providerTaskBudgets` 不一致） | 非当前渠道读/写自己那份，切换不串 | done |
| M-24 | P1 | 同人考据来源（联网搜索）存在 bug | 实机复现并修复；补齐 provider 类型与免 Key 通道 | done |
| M-25 | P2 | 新建供应商后没有能力识别引导 | 创建后可直接「从 URL 获取」并带出上下文/输出/视觉 | done |
| M-26 | P2 | 图片输入能力要手动勾选 | 端点披露时自动标记 vision | done |

### 第三轮（2026-11-16 用户补充反馈）

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-27 | P0 | 「从 URL 获取」拉到模型后弹窗一个都不勾选（已配置模型与候选完全不重合时），点「应用选择」等于没导入；OpenCode go 拉回 86 个模型但 models 仍为 0 | 不重合视为首次导入，全选 | done |
| M-28 | P0 | 模型列表 URL 一律被剥到站点根：SenseNova 请求 `/models`（应 `/v1/models`）、OpenCode 请求 `/zen/models`（应 `/zen/v1/models`），「从 URL 获取」对这两类渠道必 404 | 保留渠道路径前缀 + 候选回退（404 才换下一个） | done |
| M-29 | P1 | 单源摘录长度硬砍 4000，长词条/设定集被截断，信息缺失 | 抓取入库上限放开到 20000；prompt 注入改为独立预算并显式标注「还有 N 字未展示」 | done |
| M-30 | P1 | 联网检索只能选内置通道，MCP 里已有的搜索工具用不上 | 新增「MCP 检索工具」通道：选服务 + 工具 + 查询参数名，通用解析 JSON/文本返回 | done |
| M-31 | P2 | 日日新/OpenCode 渠道识别从未验证，只有 Ollama/DeepSeek 覆盖 | 实机逐渠道验证：OpenCode 86 模型（含上下文/输出/视觉/价格）落库；SenseNova 地址修正为 `/v1/models`（无 Key 时正确报 401 而非 404） | done |

### 第四轮（2026-11-16 用户补充反馈）

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-32 | P0 | 输入口令解锁后界面仍显示「已加密锁定」，用户被迫连输两次口令 | 一次解锁，锁定计数归零 | done |
| M-33 | P0 | 「从 URL 获取」全部取消后，下方模型列表仍显示全部模型（旧实现强制「至少保留一个」） | 取消哪些就移除哪些；全部取消则列表为空并提示 | done |
| M-34 | P1 | 测试连通性只有一个渠道级按钮，用户不知道测的是哪个模型 | 每个模型行独立「🔌 测试」，行内显示该模型结果 | done |
| M-35 | P1 | URL 与 API 格式的输入方式（Base URL + 协议推导路径）用户认为不合理 | 方案 C：协议下方显示「实际请求 URL」，可直接覆盖；覆盖后所见即所发，测试/生成/模型列表全部同源 | done |
| M-36 | P2 | 测试结果挤在模型行内，长错误把行撑变形 | 模型列表下方独立「连通性测试结果」区，按模型分条显示、可清空 | done |

### 第五轮（2026-11-16 用户反馈：OpenCode / 日日新连接测试异常）

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-37 | P0 | 密钥未解锁时，连通性测试把 `aes256v2:` 密文当 Bearer 发出去，服务端返回 401「Invalid credential / Forbidden」，把「没解锁」伪装成「密钥错误」（OpenCode / SenseNova 实测都栽在这） | 锁定态不外发，直接提示先解锁 | done |
| M-38 | P1 | 402（余额不足）被归为「请求失败 HTTP 402」，看不出是钱的问题 | 单独归类「余额/额度不足」，并给充值/换端点建议 | done |
| M-39 | P1 | 鉴权/404 失败只给错误原文，用户不知道下一步做什么 | 结果区第二行给可执行建议（Go 端点、核对实际请求 URL 等） | done |
| M-40 | P1 | SenseNova 预设的 API 格式被存成 `openai-responses`，实际请求会打到 `/v1/responses`（SenseNova 是 OpenAI Chat 兼容） | 修正为 `openai-chat` | done |
| M-41 | P0 | 换端点后「从 URL 获取」仍叠加旧模型（Zen 42 个 → Go 端点导入后仍 42，且 claude-opus 在 Go 端点 400） | 记录 `modelsEndpoint`，端点变化时用新列表替换 | done |
| M-42 | P0 | 手动覆盖上限「填了不生效」：历史覆盖键是完整地址（`…/v1/chat/completions`），渠道 endpoint 是站点根（`…com`），UI 按 endpoint 读写 → 显示为空、写入新建第二条 key，运行时仍命中旧值 | 端点归一化循环剥离 + 覆盖读写统一命中已有 key + UI 与运行时同源读取 | done |

### 第六轮（2026-11-17 用户反馈：解锁后仍被要求再输口令）

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-43 | P0 | 口令框输入一次、右上角已提示「已解锁，密钥可正常读取」，随后又弹一次同样的口令框；重输同一口令永远解不开（磁盘上存在旧口令/损坏密文时必然复现） | 已解锁状态下单条密文解不开不再清会话口令、不再弹框；界面与请求错误都改为「与当前口令不匹配，请重新填写该密钥」 | done |

机制：旧 `decryptV2` 对每次解密尝试都先 `clearSessionPassword()` 再重问，于是在 `loadSettings` 静默解密或后台 AI 请求 `resolveApiKey` 解到一条旧口令密文时，刚设好的会话口令被整条清掉并触发第二次弹框。现改为「已持有会话口令 → 只试一次、失败只记入不匹配集合」；`SettingsService` 用 `mismatchedSecretLabels()` 把不匹配字段报到状态行。

## 3.5 第二轮 Brief（2026-11-16）

- **一句话目标**：渠道能力（端点/请求头/上下文/输出/价格/思考/视觉）全部「自动识别 + 可按渠道覆盖」，测试与真实调用同源，任务级参数按渠道独立。
- **范围**：`shared/api-format.ts`、`shared/provider-ui-model.ts`、`shared/model-pricing.ts`、`shared/model-capabilities.ts`、`services/api-connectivity-service.ts`、`services/model-discovery.ts`、`core/provider-manager.ts`、`ui/settings/api-section.ts`、`engine/ai-api-client*.ts`、`services/canon-research-service.ts`。
- **不改**：正文/规划/设定等下游任务逻辑；预设供应商清单（仍 4 个）。
- **数据**：不新增必填字段；`modelMeta` 扩展为「识别结果缓存」（contextWindow/maxTokens/vision/inputPricePerM/outputPricePerM），全部可选并有默认兜底；旧 `data.json` 无这些字段时按内置表工作。
- **验收标准**：
  1. Ollama（无 Key、原生端点）测试连通性返回 OK，获取模型列表返回 qwen2.5:7b 等；
  2. 改模型上下文 393216 → 该模型在全局分配区与任务预算预览里都变成 393216；
  3. 同名模型在两个渠道填不同单价，切渠道后费用用各自单价；
  4. OpenCode Go 渠道测试连通性 200（自动带 `x-opencode-session`）；
  5. 非当前渠道的任务级参数改动只写该渠道，切过去才生效；
  6. 同人考据 Wikipedia/Bangumi 免 Key 通道实机可检索。
- **需要用户确认**：无（按本轮反馈直接做）。

## 4. 关键决策

- 2026-11-16：预设收敛为 4 个，但**不删除**历史预设配置，升级时转自定义渠道（数据安全优先）。
- 2026-11-16：`enabledProviderIds` 未设置 = 全部显示，避免老用户升级后渠道突然消失。
- 2026-11-16：渠道切换保存/恢复 模型分配 + 任务级参数，而不是重置成 `models[0..1]`。
- 2026-11-16：思考强度按「协议/端点/模型」识别，不要求用户手选协议；未知渠道不下发参数，避免 400。
- 2026-11-16（第二轮）：能力「自动识别优先，手填只作覆盖」。端点披露的上下文/输出/视觉/价格/思考全部落 `modelMeta`，识别值与覆盖值分开显示来源；清空覆盖输入 = 回到自动。
- 2026-11-16（第二轮）：模型编辑从行内改弹窗（用户明确要求）。行内表单在 300–400px 窄面板下会把模型 ID 挤成竖排单字，覆盖了 Playbook「行内优先」——本轮以用户实际反馈为准，已记录此处。
- 2026-11-16（第二轮）：价格按「渠道 + 模型」作用域查找，未指定渠道时保持旧的全渠道行为（向后兼容）；端点披露的美元价带 `priceCurrency: 'USD'`，记账按 `DEFAULT_USD_TO_CNY` 折算，不把 $ 当 ¥。
- 2026-11-16（第二轮）：Ollama 原生端点（`/api/generate`、`/api/chat`）视为完整地址，不再拼接；模型列表走 `/api/tags`。
- 2026-11-16（第二轮）：联网检索的「有没有 Key」不再是总开关，wikipedia/bangumi 免 Key 通道直接可用。
- 2026-11-16（第二轮 B）：端点不披露价格时用**渠道参考价**兜底。DeepSeek 官方 `/models` 不返回价格，但《模型 & 价格》文档给了完整表：deepseek-flash 输入（缓存未命中）高峰 2 元 / 输出高峰 8 元；deepseek-v4-pro 9 / 27 元（均按百万 tokens）。内置为「端点域名 → 模型 → 单价」的 `CHANNEL_PRICING`，用户配置与端点披露永远优先，记账按高峰价（宁可高估不漏计）。
- 2026-11-16（第二轮 B）：新增「DeepSeek 联网搜索」检索通道（`POST https://api.deepseek.com/v1/tools/search`）。理由：维基百科/Bangumi 在部分网络下超时（实测本机 PowerShell 直连 20s 超时），而 DeepSeek 搜索与模型请求同一出口、可达；且复用用户已配置的 DeepSeek Key，不用另填。按官方计费 5 元/1000 次。

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
| 2026-11-16 | 单测：`api-format`（原生端点/列表 URL）、`model-discovery`（OpenCode 元数据/Ollama tags/OpenRouter 价格）、`model-pricing`（渠道作用域/美元折算）、`provider-ui-model`（会话头/思考判定/上限来源） | 全过 | vitest |
| 2026-11-16 | DOM：`api-section-dom` 9 条（模型行单价 `$0.15/$0.6`、上限区「来源：」、行内编辑器不再渲染） | 全过 | vitest |
| 2026-11-16 | 引擎：`trend-research-service` 5 条（免 Key 通道可检索、需要 Key 的通道无 Key 不白跑） | 全过 | vitest |
| 2026-11-16 | 回归：`npm run test` 935 文件 / 9825 通过 / 3 skipped | 通过 | vitest |
| 2026-11-16 | 直连实测：OpenCode Go 缺 `x-opencode-session` → 400 MissingSessionID；带头 → 200；`reasoning_effort`/`thinking` 均 200 | 确认 | curl |
| 2026-11-16 | 门禁：`npm run gen:docs && npm run preflight` | 见提交 | preflight |
| 2026-11-16 | 单测：DeepSeek 联网搜索通道（复用渠道 Key / 缺 Key 指引）、渠道参考价（官方文档价 / 用户优先 / 不误用）、DeepSeek `/models` 元数据（context_window/max_output_tokens/input_modalities/effort） | 全过 | vitest |

## 6. 测试清单

- 纯逻辑：`tests/unit/shared/provider-ui-model.test.ts`、`tests/unit/core/provider-manager-channels.test.ts`
- UI/DOM：`tests/unit/ui/api-section-dom.test.ts`
- 回归：`provider-manager-key-preserve/limits/remove`、`settings-*`、`ai-thinking-params`
- 实机检查：默认态、渠道切换、关闭显示、解锁卡片、行内新建/编辑、重载后状态
- 第二轮 B 新增：`canon-research-free-providers.test.ts` DeepSeek 通道 3 条、`model-pricing.test.ts` 渠道参考价 5 条、`model-discovery.test.ts` DeepSeek 元数据 1 条
- 第二轮新增：`tests/unit/engine/trend-research-service.test.ts`、`api-format.test.ts` 原生端点组、`model-discovery.test.ts` 能力识别组、`model-pricing.test.ts` 渠道作用域组、`provider-manager-limits.test.ts` modelMeta 组

## 7. 剩余 backlog

- [ ] 供应商详情页分组与密度（P2）
- [ ] OpenCode 思考档位补 max（端点声明 low/high/max，当前只映射 low/high）（P2）
- [ ] 更多操作菜单的删除/切换入口（P3）
- [x] 任务级参数按渠道读写（第二轮完成）
- [x] 端点不披露价格时用渠道参考价兜底（DeepSeek 官方文档价已内置，第二轮 B）
- [ ] OpenCode 等渠道的缓存命中价/时段价（当前按未命中高峰价保守估算）（P2）
- [x] 新增 DeepSeek 联网搜索通道（复用 DeepSeek Key，解决免 Key 通道被网络限制）——第二轮 B
- [ ] 联网检索结果的权威性/时效性排序展示（DeepSeek 返回 authority/date，目前只排序未展示）（P2）

## 8. 交接备注

- 下一轮建议从 M-12/M-14 开始；交互细节按用户实际使用反馈优先。
- 改动该模块时注意：`engine/engine-registry.ts` 在设置加载前会调 `migrateLegacyPresets()`，必须允许「设置未就绪」时静默跳过（曾导致插件加载失败）。


## 9. 第三轮决策（2026-11-16）

- **模型列表不再猜单一路径**：改为候选序列（保留用户填写的路径前缀，404 才回退）。实测依据：SenseNova `/v1/models` 401（正确）vs `/models` 404（错误）；OpenCode Go `/inference/go/openai/v1/models` 200 vs `/openai/models` 404；OpenCode Zen `/zen/v1/models` 200。
- **摘录长度与注入预算分离**：`excerptChars`（抓取入库，200–20000）只决定存多少；prompt 注入由 `formatCanonSourcesForPrompt` 的总预算（默认 24000）控制，裁剪时写入「仍有 N 字未展示，不要据此断言原著未提及」。理由：把两者绑在 4000 会让长词条丢信息，而无限注入会挤爆上下文。
- **联网检索不绑定单一服务**：除 DeepSeek/维基/Bangumi 外新增 MCP 通道（任意 MCP 搜索工具，选服务 + 工具 + 参数名）。理由：用户可能已有 brave/tavily/exa 等 MCP 服务，插件不该重复造。
- **连接方式**：MCP 通道每次短连接（连接→调用→关闭），不常驻，避免与 Agent 工作台的 MCP 连接互相干扰。

## 10. 第四轮决策与待确认（2026-11-16）

- **解锁语义**：`rawSecrets` 从「磁盘原始值」改为「当前会话可用值」——解密成功后同步回写，`lockedSecretCount()` 才会归零，界面一次解锁即消失。
- **模型列表与勾选强一致**：允许清空模型列表；清空当前渠道时保留全局 defaultModel/flashModel/proModel 并提示，避免写成 undefined 后请求回落到兜底模型。
- **连通性测试下放**：渠道级按钮删除，改为模型行内按钮（显示该模型 id 与结果），失败能定位到具体模型。
- **M-35 方案 C（已确认）**：保留 Base URL + 协议，同时在协议下方显示「实际请求 URL」并可覆盖；覆盖后运行时不再推导（`requestUrlOverride`），测试、生成、模型列表三处同源；改 Base URL 自动清空覆盖，避免打旧地址。
- **测试结果位置（M-36）**：从模型行内移到模型列表下方的独立结果区，长错误不再挤压行布局。


## 11. 第五轮诊断记录（2026-11-16）

**实测数据（直连，不经过插件）**

| 组合 | 结果 |
| --- | --- |
| `POST https://opencode.ai/zen/v1/chat/completions` + QQ(pc) Key | **402 Insufficient balance**（Key 有效，Zen 按量付费余额不足） |
| `POST https://opencode.ai/inference/go/openai/v1/chat/completions` + QQ(pc) Key | **200**（Go 订阅通道正常） |
| `POST https://opencode.ai/zen/v1/chat/completions` + OPENCODE_GO Key | **401 Invalid credential** |
| `POST https://token.sensenova.cn/v1/chat/completions`（无 Key） | 401 Authorization Not Found（地址存在） |

**结论**

1. 插件在未解锁时把密文当 Key 发送 → 401，是「两个渠道都失败」的共同原因（已修 M-37）。
2. OpenCode go 渠道当前指向 Zen 端点；该账号是 Go 订阅，Zen 会 402。正确端点应为 `https://opencode.ai/inference/go/openai/v1`（需在渠道里改，插件不擅自改，因为有第二个 OpenCode 账号）。
3. SenseNova 协议被存成 Responses，已修正为 Chat Completions（M-40）。

## 12. 第六轮实测结果（2026-11-16，解锁后）

用户口令解锁（`lockedSecretCount` 由 7 → 0，6 把 Key 明文），逐渠道实测：

| 渠道 | 修复前 | 根因 | 修复后 |
| --- | --- | --- | --- |
| OpenCode go | 403 Model access is disabled（Zen 端点） | 渠道 Base URL 指向 Zen，但账号是 Go 订阅；Zen 未开该模型权限 | 端点改为 `https://opencode.ai/inference/go/openai/v1`，重新导入 32 个模型 → **✅ deepseek-v4.1-flash 连通正常 1639ms** |
| 日日新/SenseNova | 429 inference exceeds tpm/rpm limit | 鉴权与地址都正确，只是账号 TPM/RPM 限流 | 稍后重试 → **✅ deepseek-v4-flash 连通正常 1120ms** |
| 日日新（自定义 custom-2） | — | — | **✅ 连通正常 1347ms** |

**换端点叠旧模型（M-41）**：从 Zen 换到 Go 端点后，旧 42 个 Zen 模型（claude-opus/gpt-5 等）在 Go 端点全部 400，
但「从 URL 获取」按「保留未列出的已配置模型」规则把它们留了下来。现改为：记录模型列表来源端点
（`modelsEndpoint`），端点变化时用新列表**替换**而不是叠加。

## 13. 全文验收记录（2026-11-16，用户要求「验证模块功能是否正常」）

解锁（口令）后逐项实机验证：

| 验收项 | 结果 |
| --- | --- |
| 渠道列表 / 当前渠道 / 切换后分配恢复 | ✅ 切到 OpenCode（deepseek-v4.1-flash / v4-pro）再切回 DeepSeek，分配完整恢复 |
| 连通性测试（可见 5 渠道） | ✅ DeepSeek 1401ms、Ollama 9143ms（warn）、SenseNova 1052ms、OpenCode go 1783ms、日日新 1136ms |
| 从 URL 获取 | ✅ Ollama 3 个、OpenCode Go 32 个、SenseNova 8 个 |
| 模型勾选 / 全部取消 / 换端点替换 | ✅ 取消即移除、全部取消清空；换端点 42→32 替换 |
| 模型编辑弹窗 | ✅ 7 个字段（ID/上下文/输出/输入价/输出价/币种/视觉） |
| 上限自动识别 + 来源 | ✅ OpenCode：1,000,000 / 384,000（来源：端点识别） |
| 上限手动覆盖 + 清空恢复 | ✅ 上下文 777777 生效、清空回 1,048,576；输出 88888 生效、清空回 393,216（验证后已恢复用户原值 131072） |
| 实际请求 URL | ✅ 显示 `https://opencode.ai/inference/go/openai/v1/chat/completions`；覆盖/恢复自动可用 |
| 价格 / 视觉 / 上下文徽章 | ✅ `1M`、`视觉`、`$0.15/$0.6`（美元带币种） |
| 思考强度识别 | ✅ 「OpenCode 渠道：下发 reasoning_effort（low/high/max）（按 deepseek-v4.1-flash 判定）」 |
| 密钥解锁（一次） | ✅ 输入一次口令后 lockedSecretCount 7→0 |
| 锁定态不外发 | ✅ 未解锁点测试 → 提示先解锁，无请求发出 |
| 联网检索（DeepSeek 通道） | ✅ 测试检索「斗破苍穹」返回 6 条来源 |
| 已隐藏渠道语义 | ✅ custom-1/2/3 isHidden=true，侧栏不显示（「其他模块显示」开关只影响其他模块） |

**本轮验收发现并修复的异常**：M-42（覆盖不生效）——已修并回归。

**遗留（P2，不阻塞）**：
- [x] 同一端点两条 `modelOverrides` key 的一次性合并迁移（2026-11-16 已做，幂等，读取语义不变）
- [x] `enabledProviderIds` 幽灵 id 清理（2026-11-16 启动时自动清理，实测 volc/catcat 已移除）
- [x] 隐藏渠道恢复显示入口（2026-11-16 侧栏新增「已隐藏（N）」分组 + 恢复按钮）

## 14. 遗留问题清理（2026-11-16）

| 遗留 | 处理 | 结果 |
| --- | --- | --- |
| 同一端点两条 modelOverrides key | 新增 shared/provider-settings-maintenance：按归一化端点分组合并，保留精确端点 key，先出现值优先（与运行时读取一致），空条目丢弃 | 实测 7 条 key → 6 条，deepseek 合并为 `https://api.deepseek.com`，deepseek-flash 的 maxOutput 131072 未丢 |
| enabledProviderIds 幽灵 id | pruneUnknownProviderIds 启动时过滤（undefined 保持不变） | 实测 `[deepseek,ollama,volc,catcat,sensenova,opencode]` → `[deepseek,ollama,sensenova,opencode]` |
| 隐藏渠道无恢复入口 | 侧栏新增「已隐藏（N）」分组 + 每行「恢复显示」按钮（setHidden(false)） | 实测 3 个隐藏渠道（open code/日日新/君站）出现在分组中，点恢复后渠道回到侧边栏，验证后已还原 |

两个清理都幂等，并且合并不会改变任何模型的生效上限（按运行时读取顺序先出现优先）。
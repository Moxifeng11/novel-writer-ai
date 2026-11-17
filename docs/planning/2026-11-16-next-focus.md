# 下一步优化建议与遗留问题台账（2026-11-16）

> 状态：活跃 · 2026-11-17
> 版本：v4.96.0 · 对应 HEAD `14306a20` · 数据来源：`docs/progress/program-status.json`、`.coverage-baseline.json`、`.bundle-baseline.json`、`docs/audits/2026-11-15-adversarial-review.md`、`docs/design/2026-11-15-architecture-remediation-plan.md`（数字以真相源为准，本文只引用结论）。

## 一、现状快照

| 维度 | 现状 | 证据 |
|---|---|---|
| 代码规模 | 见生成物（不抄数字） | `docs/generated/code-index.md` |
| 测试 | 见台账与最近一次 `preflight` | `docs/progress/program-status.json` |
| 门禁 | `preflight EXIT=0`（步骤清单以 package.json 为准） | `docs/generated/gates.md` |
| 产物 | 体积棘轮当前值 | `.bundle-baseline.json` |
| 覆盖率 | 棘轮当前值 | `.coverage-baseline.json` |
| 业务专项 | 7 组（G1–G7，共 61 项）全部 done | `program-status.json` |
| 架构整改 | 12 项（C2–C5、B1–B4、A1–A4）全部交付并带测试 | `design/2026-11-15-architecture-remediation-plan.md` §十三 |
| 对抗性审查 | 25 项：22 ✅ + 1 ◑（启动顺序）+ 2 ⏳（体积、全局挂载）；「全局挂载」实际已在 `52350d41` 删除，审计表未回填 | 同上 |

## 二、历史架构遗留：结论

**已解决（有提交 + 测试锁定）**

1. 多入口写覆盖 / 无锁写：伏笔库、时间线、结算产物统一走写锁与 FileTx，迁移失败整批回滚（`2887b232`、`5d7dd4ad`）。
2. 状态口径不一致：章节 canonical 状态 + 三入口一致性测试（`a696859c`）。
3. 索引不可重建：事实库/摘要/档案/台账均可由 `断言.json` 幂等重建（`5d7dd4ad`）。
4. 关系多通道：`关系状态.md` 为权威，设定图边派生（`67642ad2`）。
5. 生成后无校验、修订无闭环、前馈无结构：B1/B2/B3/B4 四件套（`70ac2b33`、`daef4b5c`、`7a1804d3`、`7dc00858`）。
6. 上下文过量注入、场景循环、按需检索、覆盖可视化、协同/正文分裂：A1–A4（`36b56813`、`e637ec7b`、`3ac4eacf`），实测注入 token −66.5%。
7. 全局命名空间污染：`window.novelAI` 已移除并新增 `global-namespace` 门禁（`52350d41`）。

**部分解决**

- 「命令/视图在串行 I/O 之后才注册」（审计 #8，P2）：现在只有状态栏「⏳ 初始化中」占位，注册顺序未动；原因是视图工厂依赖引擎字段，提前注册有打开即崩风险。

**未解决**

- 主包体积（审计 #9，P2）：5.19MB → **5.75MB**（内联 worker + 本轮新功能），未做视图动态 import / 图片外移。

**新暴露的一类「遗留」：能力已交付但用户摸不到（入口缺失）**

与 MCP tab 空白同源的一类问题——功能在代码里在跑，界面上没有入口：

| 能力 | 现状 | 影响 |
|---|---|---|
| `runQualityPanel` | 只有插件方法 + `plugin-api`，无 UI | 质量面板数据（通过率/类型分布/平均轮次）用户看不到 |
| `runPostGenerationCheck` | 只有插件方法，无 UI | 生成后校验报告只能从代码/日志拿 |
| `autoReviseChapter` | 只有插件方法，无 UI | 定向修订闭环缺人工触发入口（B2 遗留 item 3） |
| `recoverInterruptedSettlement` | 只有插件方法，无按钮 | 自检建议「点『恢复中断结算』」，但**该按钮不存在**——引导指向假入口 |
| 示例 MCP / 管理器 | 本轮已补齐 | 已解决 |

另：设置项 112 个、命令面板 93 条命令，首启可发现性负担偏重。

## 三、下一步聚焦（按 ROI 排序）

### P0 · 让已交付的质量闭环真正可用（1–2 轮）

> 2026-11-16 执行记录：P0-1、P0-2 已完成（见文末「执行记录」），P0-3 仍待跑。

1. ~~**质量面板落地**~~ ✅：新增「📊 质量闭环」页/弹窗，接 `runQualityPanel`（历史 + 通过率 + 类型分布）+ `runPostGenerationCheck`（最近一次报告）+ `autoReviseChapter`（按钮触发，带确认）。验收：真实项目生成 1 章后，面板出现记录、按钮能触发修订并落盘。
2. ~~**修「引导指向不存在入口」**~~ ✅：自检 → 恢复中断结算加真实按钮（dryRun 预览 → 确认恢复）；或至少把提示文案改成现有可达路径。验收：点击后能列出待恢复章节并执行。
3. **跑通 A1/A4 开关收益**（架构整改遗留 item 2）：默认关的 `sceneLoopBodyGeneration` / `coWriteStructuredConstraints` 连跑 3 章，对比人工评分与注入量，给出「开/关」结论写入 `docs/progress/`。

### P1 · 真实用户价值（2026-11-16 修订：删除无实际收益项）

> 修订依据（作者质疑后实测）：
> - **UI 覆盖率不是目标**：ui/ 42,131 行、覆盖 21.4%，提到 30% 要补 +3,617 行 ≈ 3–5 轮、用户可感知变化为 0；且 `check:coverage` 是「只许降」的棘轮，不是必须涨的指标。改为规则：*改哪个视图就抽出判断/格式化纯函数补测；新增文件必须有测试*（`check:view-tests` 已强制）。
> - **设置收敛大半已完成**：111 个设置键、死键 0；设置页已是 6 域 → 18 tab 两级结构 + 默认隐藏高级 tab（`settingsUiShowAdvanced`）+ 折叠分组。只缺搜索框，属于「有人抱怨再做」，不立项。
> - 真正值得做的是「入口完整性」：35 个用户级能力方法里有 7 个 ui/core 无引用，其中 4 个仅 `plugin-api` 可调（`generateChapterBySceneLoop` / `syncRelationGraph` / `rebuildAssertions` / `runBaselineProbe`）。

**P1-1 数据安全（先做）**：写作插件第一价值是「别丢稿」。对正文写入 / 结算回滚 / 事务回滚做失败注入与崩溃恢复回归（现有 42 条 E2E 之外补关键路径单测/集成测试），验收：任一中途失败后原稿与实体状态完整、可恢复。

**P1-2 启动与体积（2026-11-16 实测后撤销「启动优化」立项）**：实测结论——插件本身启动不慢，没有可优化收益：

| 指标 | 实测 |
|---|---|
| `enablePlugin` 总耗时（模块已缓存） | 105–156ms（3 次） |
| 插件自身 onload 内部工作 | 24–57ms |
| 命令注册完成（相对 onload 起点） | 26–57ms |
| 冷启动「命令空白」1.9s 的来源 | **测量假象**：隐藏窗口 `setTimeout` 被节流；同代码可见窗口下无此延迟 |
| 6MB JS 解析耗时 | 约 8ms（渲染进程实测，非瓶颈） |

因此「注册顺序解耦」收益 <30ms，不做；已保留 `plugin.getStartupTimings()` 遥测作为以后真实回归时的诊断入口。体积（main.js 6.05MB）主要影响**下载/安装**而非启动，若要减包只有内联 worker 压缩（gzip+base64 可省约 446KB，需异步解压与新测试），优先级降到 P2 且需作者拍板。

**P1-3 入口收尾**：4 个仅脚本可调的高级能力 → 加命令或在使用约定里标注「脚本专用」，避免出现第二个「MCP tab 空白」。

**P1-4 MCP 二期**（用户明确方向）：会话内可见「调用了哪个工具 / 结果摘要」；失败自动重试一次；服务级权限提示。

### P2 · 技术债（排期机动）

7. **主包减肥**：视图按需 `import()`（参考本轮 MCP 管理面板的做法）+ workers-inline 懒加载/外置策略；目标先回到 5.2MB 以下（bundle 棘轮只允许降）。
8. **启动顺序（审计 #8）**：先注册空壳视图 + `ready` 后填充，解耦视图工厂对引擎字段的依赖。
9. **TODO 清理**：源码 80 处 TODO/FIXME/HACK，优先 `entity-factory.ts`（8）、`safe-html.ts`（4）。
10. **文档回填**：审计报告 #17 标记已修、本文件与 `program-status.json` 的基线数字同步。

## 四、发版建议

本轮已积累 4 个提交（桌宠帧语义 ×2、MCP 补全），均为用户可见功能，`preflight EXIT=0`。建议在 P0-1/P0-2 完成后发 **v4.97.0**（含桌面端 MCP 接入 + 桌宠状态驱动）；`tag` / Release 需用户明确确认。

---

## 五、执行记录（2026-11-16）

| 项 | 交付 | 验证 |
|---|---|---|
| P0-1 质量闭环面板 | `ui/quality-loop-modal.ts` + `shared/quality-loop-model.ts`；新命令「🔁 质量闭环（校验/修订/历史）」；设置 → 写作与协同 → 「质量闭环」按钮；接 `runQualityPanel` / `runPostGenerationCheck` / `autoReviseChapter`（修订前二次确认、轮次上限 1–3、需 AI 凭据提示） | 实机：面板读到历史「累计 1 次 / 通过率 100%」；点「运行校验」出报告「✅ 通过（无问题）」并落盘第 2 条记录；21 条单测通过 |
| P0-2 恢复中断结算 | `ui/settlement-recovery-modal.ts` + `shared/settlement-recovery-model.ts`；新命令「🧯 恢复中断结算」；设置 → 首启与自检 → 「恢复中断结算」按钮；dryRun 预览 → 逐章/全部确认恢复 | 实机：构造 1 条 `whole-file-before` 残留日志 → 预览「1 个章节 / 1 条」→ 恢复后文件内容回退为旧值、日志被清理、面板变「没有发现残留」；7 条单测通过 |
| P0-3 A1/A4 开关收益实测 | 待跑（需连跑 3 章 + 人工评分对比） | — |

自检文案「点『恢复中断结算』」现在指向真实入口，断链已修复。


### 2026-11-16 追加

| 项 | 结论 |
|---|---|
| P1-1 数据安全 | ✅ 已交付（`ca5057c5`）：FileTx 启动恢复 4 条 + 结算崩溃恢复 4 条，共 8 条测试 |
| P1-2 启动优化 | ⏸ 实测无可优化收益（见上表），撤销立项；仅保留 `getStartupTimings()` 遥测 |
| 体积 | 待作者决定是否做「内联 worker gzip 压缩」（省 ~446KB，只影响下载安装，不影响启动） |

### 2026-11-16 第二轮（作者指定顺序：P1-3 → MCP 二期 → 体积）

| 项 | 结果 | 提交 |
|---|---|---|
| P1-3 入口收尾 | ✅ 新增「🧰 高级维护」面板：关系图同步（预览/同步）、断言索引重建（预览/重建）、写作基线探测、场景循环生成（预览/执行落盘），四个此前仅脚本可调的能力全部有界面入口 | `d0e84fab` |
| P1-4 MCP 二期 | ✅ 调用统计（calls/failures/lastError/最近时间）+ 管理中心展示与清除；只读工具失败自动重试一次（写类不重试）；连接失败重试一次并记录 attempts | `d0e84fab` |
| 体积（原 P1-2 剩余项） | ✅ 内联 worker 改 **gzip+base64**：源文件 855KB→339KB，`main.js` **6,048,234 → 5,609,117（-439KB，6.05MB→5.35MB，-7.3%）**；运行时 DecompressionStream 解压并缓存 Blob URL，不支持时退回主线程（前端降级通知） | 本次提交 |
| 启动 | 实测无优化收益（见上表），保持现状 + 保留遥测 | `8362068e` |
| 真实项目 A1/A4 对比 | 作者明确「先不做，后续优化计划时再测」 | — |

内联 worker 验证：单测 6 条（gzip 魔数/解压后可执行/压缩率≥35%/warm 缓存复用/dispose）；实机把 `workers/` 临时改名后重载 → 自检显示「3 文件安装用内联 Worker」且启动耗时 46ms 内，恢复目录后回到磁盘 worker。

### 2026-11-16 第三轮：市场新装「打开即用」

| 要求 | 实现 | 验证 |
|---|---|---|
| 下载后不手动建文件夹/数据库 | 首次安装时先 `ensureTemplateScaffold` 自举「元文件」模板目录（56 文件），再打开引导；引导第 4 步的「导入示例项目」会自动建 01/02/03 全部目录与文件 | 实机 `createExampleProjectNow()` → 创建 `示例项目`（01-世界架构/02-时间线与伏笔/03-大纲与章节 + 9 个文件）；模板目录已在启动时自动补齐 |
| 打开直接进入引导页面 | 首次安装不再弹 WelcomeModal，改为直接打开「3 分钟引导」（选提供商 → 填 Key → 连通性 → 示例项目 → 开始写作）；引导完成写 `firstRunComplete` | 实机模拟首装（清空 lastRunVersion + welcomed）→ 引导自动弹出在第 1 步「选择提供商」，`cache.welcomed` 置位 |
| 不重复打扰 | 自动弹过一次后 `cache.welcomed=true`，后续启动不再自动弹；命令面板「🚀 首启引导」可随时重开 | 实机二次启动/直接调用打开方法 → 引导数量不增加 |
| 判定可测 | `shared/first-run-guide.ts` 纯函数（已完成/已弹过/首装/升级兜底/已有作品 5 条规则） | 5 条单测 |

说明：该改动用设置里的 `templateScaffoldOnStartup`（默认开）控制模板自举；关闭后模板改为首次新建项目时按需落盘，引导仍可正常打开。

### 2026-11-16 第四轮：桌宠图片重载丢失修复

问题：用户反馈「每次重载插件都要重新设置桌宠图片」。

定位过程：先复现——小图 / 512px 大图、vault 源与 file 源在**当前构建**下都能写入 data.json 并在 reload 后恢复（实测渲染正常），说明写入链路本身没坏；但图片 base64 存在 settings 里，任何把 `petImage` 当陌生字段的路径（重置设置、旧版迁移、data.json 手工修复、其它会话清理）都会让图片「凭空消失」。

修复（改为文件持久化 + 启动自愈）：

- 本机图片（`source:'file'`）图本体写到插件目录 `pet-image.png` + `pet-image.json`（cols/rows），`data.json` 只留 `{source,cols,rows}` 元数据（不再每次保存重写几百 KB base64）
- 启动 `hydratePetImage()`：settings 有旧 dataUrl → 迁移成文件；只有元数据 → 从插件目录回读；**settings 完全丢失 → 只要插件目录还有图就恢复元数据并渲染**
- 元数据在但图片文件丢了 → 自动清元数据回内置形象，避免设置页显示「已有图片」
- 设置页统一走 `plugin.applyPetImageConfig()`（单一入口），清除走 `clearPetImage()`（同时清内存 / 元数据 / 磁盘文件）
- 新增 `shared/pet-image-store.ts`（6 组单测）、`resolvePetImageConfig` 运行时合成测试（5 条）、模型规范化放宽「仅元数据」配置

实机验证：

1. 应用 640×320 本机图 → `data.json` 无 dataUrl、插件目录出现 png+json、桌宠渲染 data URL
2. 连续两次 reload → 元数据 + 图片都在，runtime 352KB，桌宠正常渲染
3. 手动清空 settings.petImage 后 reload → 从插件目录自愈（元数据恢复 + 渲染）
4. clearPetImage → settings / data.json 均为 null、png/json 已删除


### 2026-11-16 第五轮：API 配置模块重构（预设收敛 / 启用语义 / 按渠道分配 / 行内交互）

用户反馈的问题与处理：

1. **预设供应商收敛为 4 个**：本地 Ollama、DeepSeek 官网、日日新/SenseNova、OpenCode Zen（端点 `https://opencode.ai/zen/v1/chat/completions`，OpenAI 兼容）。
   - 历史预设（火山豆包、CatCat Gemini）在升级时自动转成普通自定义供应商，不会被删；「恢复默认供应商」也不再塞回来。
   - 新增预设会自动补进老用户的列表（不用手动恢复）。
2. **启用 ≠ 切换**：详情页开关改为「在其他模块显示」（`enabledProviderIds`），只影响快切/模型弹层/工作台等处的渠道列表；「设为当前」才是切换当前写作渠道。快切与模型选择弹层已按启用列表过滤。
3. **全局模型分配随渠道切换**：新增 `providerAssignments`，每个渠道各记一套 默认/Flash/Pro 模型；切换时先保存旧渠道、再恢复目标渠道（旧实现重置成 models[0..1]）。分配区域改为可折叠。
4. **密钥解锁上移**：加密状态卡片放到 API 配置页顶部，锁定时高亮提示「有 N 项密钥未解锁」。
5. **添加供应商弹窗删除**：改为侧栏行内「＋ 新建供应商」表单（名称/Base URL/协议/Key 直接创建）；模型编辑也改成行内展开（ID/上下文/输出/单价/图片输入），不再弹窗。
6. **思考强度按渠道自动识别**：`resolveThinkingCapability()` 按协议/端点/模型判定下发形态（reasoning_effort / thinking.type / budget_tokens / 不下发），只对支持的渠道显示强度设置；每渠道单独保存（`providerThinking`），请求侧优先渠道设置并过滤本地/未知渠道。
7. **图片输入可见**：模型列表保留「视觉」标记；渠道能力区汇总列出支持图片的模型；模型行内编辑可直接勾选「支持图片输入」。
8. **请求头适配**：渠道级 `headers` 配置（每行 `Key: Value`），请求时与认证头合并，适配 OpenRouter/自建网关等需要 `HTTP-Referer`/`X-Title` 的场景。

新增 `shared/provider-ui-model.ts`（16 条单测）+ `tests/unit/shared/provider-ui-model.test.ts`；`ProviderManager` 增加启用/分配/思考/迁移方法；`AIApiClient` 合并自定义请求头并按渠道覆盖思考参数。

实机验证：启动耗时正常（engineReady 19ms）；供应商列表 6 项（4 预设 + 迁移的火山/CatCat）；关闭「在其他模块显示」后可用渠道 6→5；给 Ollama 存分配后切过去生效、切回 DeepSeek 恢复原分配；DeepSeek 思考识别为 thinking、Ollama 不支持；设置页 DOM 校验：顶部密钥卡片、行内新建表单、渠道能力区（思考强度/图片输入/自定义请求头）、折叠的全局模型分配均正常渲染。


### 2026-11-16 第六轮：API 配置补漏 + 模块化优化开发制度

1. 补完上一轮列出的「没做透」项：
   - 任务级模型参数按渠道记忆（`providerTaskBudgets`）：切换渠道保存旧渠道、恢复目标渠道；设置页对非当前渠道显示说明。
   - 内置请求头适配：OpenRouter 自动补 `HTTP-Referer`/`X-Title`、Anthropic 协议补 `anthropic-version`；用户自定义 headers 覆盖内置值。
   - 供应商侧栏卡片：每行显示该渠道默认模型摘要、「已隐藏」标记、当前/可用状态点。
   - 「其他模块」覆盖补齐：协同写作的云端供应商下拉改为只列启用渠道（排除本地）。
2. 新增模块化优化开发制度（用户要求）：
   - `docs/modules/MODULE-OPTIMIZATION-PLAYBOOK.md`：角色分工、单模块七步法（盘点→问题清单→Brief→实现→验证矩阵→记录→提交交接）、问题分级与红线、DoD 清单、zcode 式 UI 规范、数据迁移规范、提交模板、迭代节奏、命令速查。
   - `docs/modules/INDEX.md`：模块清单（API 配置/桌宠/工作台/规划/设定/正文/质量闭环/统计/MCP/市场/设置框架/导出）+ 推进顺序。
   - `docs/modules/_TEMPLATE.md`：模块页模板。
   - `docs/modules/api-config.md`、`docs/modules/pet.md`：两个已完成模块的现状页与验收记录（作为制度样例）。
3. 测试：新增 `provider-manager-channels.test.ts` 6 条（每渠道分配/任务级参数记忆/启用语义/思考能力）；`provider-ui-model.test.ts` 增加内置请求头 3 条（共 19 条）；`api-section-dom.test.ts` 7 条含新 UI 断言。

实机验证：侧栏每行显示模型摘要（DeepSeek→deepseek-flash、Ollama→qwen2.5:7b 等）；选中非当前渠道后出现「任务级参数按渠道各自记忆」说明；渠道能力区展开后思考强度/自定义请求头正常渲染。

### 2026-11-16 第七轮：API 配置第二轮（自动识别 / 连通性 / 价格 / 弹窗 / 联网检索）

用户验收反馈（截图：本地 Ollama「测试连通性」404 page not found、「从 URL 获取」404、窄面板下行内模型编辑把模型 ID 挤成竖排单字）拆成 M-14～M-26，按 P0 先修。

**根因（都是实测确认，不是猜）**

1. Ollama 端点被错误拼接：`normalizeChatEndpoint('http://localhost:11434/api/generate')` → `.../api/generate/v1/chat/completions`；`resolveModelsUrl` → `.../api/generate/models`。Ollama 原生端点既不吃这个路径也没有 `/models`，于是测试与获取列表双双 404。
2. 模型编辑里填的上下文/输出从未进入预算：`ModelCapability` 只读 `modelOverrides`/`detected`/静态表/渠道默认，`modelMeta.contextWindow` 只用来渲染列表徽章。用户填 1000000 仍按内置表 32768 算。
3. 连通性测试与真实调用不同源：测试只带 Content-Type + 鉴权头，不带渠道内置/自定义头，OpenCode Go 缺 `x-opencode-session` 直接 400；而值机时该头也只在非流式链路合并，流式链路完全没带渠道头。
4. 单价跨渠道串价：`lookupModelPricing` 遍历所有 provider 的 `modelMeta[model]`，同名模型在官方与转售渠道价格不同时会取到错的；端点披露的美元价也没有币种概念。
5. 思考强度「UI 说支持、运行时不发」：`resolveThinkingCapability` 把 OpenCode 判成 `thinking.type`，而 `buildThinkingPayload` 只对火山/DeepSeek/SenseNova 下发，OpenCode 实际什么都没发。实测该网关 `reasoning_effort` 与 `thinking` 都返回 200，但能力声明里 `effort: low/high/max`，按 reasoning_effort 下发更准。
6. 联网检索（同人考据/AI 前期调研）免 Key 通道永远搜不到：`TrendResearchService.search()` 用「有没有 apiKey」当总开关，选了 wikipedia/bangumi 也直接 return []，且没有任何提示；`TrendSearchProvider` 类型也没补这两个值（设置页能选，类型层不认）。
7. 任务级参数在非当前渠道展示的是当前渠道的数据（`taskBudgets` vs `providerTaskBudgets`），清除按钮也会清错渠道。
8. 上限覆盖写错渠道：`setCurrentModelOverride` 固定写「当前渠道 + settings.defaultModel」，在别的渠道设置页改上限会静默写到当前渠道。

**改动**

- `shared/api-format.ts`：新增 `isNativeOllamaEndpoint`；请求 URL 原样保留原生端点；模型列表原生端点走 `/api/tags`。
- `services/model-discovery.ts`：解析 Ollama `{models:[{name}]}`；解析端点披露的 `limit.context/output`、`modalities.input`（视觉）、`capabilities.reasoning`（思考档位）、`cost.text.*`（OpenCode，美元/百万）与 `pricing.prompt/completion`（OpenRouter，美元/token）；`discoverModels` 支持传入渠道请求头。
- `services/api-connectivity-service.ts`：原生端点原样使用；`/api/generate` 发原生 prompt 请求体并按 `response` 字段判定；测试请求合并渠道请求头；配置新增 `headers`。
- `shared/provider-ui-model.ts`：新增 `getOpenCodeSessionId`/`setOpenCodeSessionId`/`resolveProviderHeaders`；OpenCode 自动补 `x-opencode-session`；思考判定 OpenCode → `reasoning_effort`；新增 `describeLimitSource`/`describeLimitSourceLabel`。
- `core/provider-manager.ts`：`resolveModelLimits` 把 `modelMeta` 纳入优先级（override > modelMeta > detected > 内置表 > 渠道默认 > 兜底），上下文/输出各自独立取值；新增 `clearModelOverride`。
- `shared/model-pricing.ts`：`lookupModelPricing` 支持 `endpoint`/`providerId` 作用域；新增币种与 `DEFAULT_USD_TO_CNY`，`estimateCostYuan` 对美元价按汇率折算。
- `engine/ai-api-client.ts`：记账按渠道查价（`pricingForModel`）；`buildThinkingPayload` 改为复用 `resolveThinkingCapability`，与设置页同源。
- `ui/settings/api-section.ts`：新增模型编辑弹窗入口；模型行显示单价；上限区显示「自动识别值 + 来源」且清空即恢复自动（不再固化成覆盖）；任务级参数按渠道读写；全局思考强度只对当前渠道开放；同人考据加「测试检索」按钮与可读失败提示。
- `ui/model-editor-modal.ts`（新）：模型编辑弹窗（ID/上下文/输出/单价/币种/视觉）。
- `engine/harness/trend-research-service.ts`：免 Key 通道不再被 Key 守卫拦；补 wikipedia/bangumi 检索分支；新增 `trendProviderNeedsApiKey`。
- `engine/harness/ai-assisted-premise-service.ts` 相关类型：`TrendSearchProvider` 补 wikipedia/bangumi。
- `main.ts`：`CanonResearchSettings.provider` 补 wikipedia/bangumi；新增 `setProviderModelOverride`/`clearProviderModelOverride`；`modelMeta` 增加 `priceCurrency`/`reasoning`。

**验证**

| 层级 | 内容 | 结果 |
|---|---|---|
| 纯逻辑 | api-format（原生端点/列表 URL）、model-discovery（OpenCode 元数据、Ollama tags、OpenRouter 价格）、model-pricing（按渠道作用域、美元折算）、provider-ui-model（会话头、思考判定、上限来源） | 新增/更新 20+ 条，全过 |
| 组件/DOM | api-section-dom：模型行显示 `$0.15/$0.6`、上限区「来源：」、不再渲染行内编辑器 | 9 条全过 |
| 引擎 | 新增 `trend-research-service.test.ts` 5 条（免 Key 通道可检索、需要 Key 的通道无 Key 不白跑） | 通过 |
| 回归 | `npm run test` | 935 文件 / 9825 通过 / 3 skipped |
| 门禁 | `npm run gen:docs && npm run preflight` | 见提交记录 |

**没做/留待**

- Wikipedia/Bangumi 在本机网络下直接超时（`Invoke-WebRequest` 20s 超时），因此实机只能验证「失败原因可读」，无法验证真实检索结果；代码路径由 fake request 单测锁定。
- 端点价格自动识别只在端点确实披露价格时生效（OpenCode Go / OpenRouter 有）；DeepSeek 官方 `/models` 不披露价格，仍需手填或内置参考价。
- OpenCode 的 `reasoning_effort` 只映射 low/high 两档（其声明为 low/high/max，中间档位未映射）。
### 2026-11-16 第八轮：联网检索去限定 + 渠道识别补齐 + 摘录长度松绑

用户三点反馈：联网可用 MCP 解决不要限定自己；摘录长度 4000 限死会丢信息；日日新/OpenCode 识别问题也要解决（前一轮只覆盖了 Ollama/DeepSeek）。

**实测确认的根因**

1. 模型列表 URL 一律被剥到站点根：SenseNova 正确地址 `/v1/models` 返回 401、错误推导 `/models` 返回 404；OpenCode Go 正确 `/inference/go/openai/v1/models` 200、错误推导 404。
2. 「从 URL 获取」弹窗默认勾选规则有 bug：已配置模型与候选完全不重合时一个都不勾（OpenCode go 拉回 86 个却检查到 checked=0），点应用等于没导入。
3. 摘录长度在抓取阶段就被硬砍 4000（`Math.min(4000, excerptChars)`），长词条/设定集信息缺失；而 prompt 注入另有独立预算，两者不该共用一个死上限。
4. 联网检索通道写死了 wikipedia/bangumi/deepseek 等内置实现，没利用用户已配置的 MCP 搜索工具。

**改动**

- `shared/api-format.ts`：新增 `resolveApiBaseUrl`/`hasVersionSegment`/`resolveModelsUrlCandidates`；请求与列表 URL 保留渠道路径前缀。
- `services/model-discovery.ts`：候选地址逐个尝试（仅 404 回退，401/429/5xx 直接报原因）；补 DeepSeek `/models` 的 `input_modalities`/`effort` 解析。
- `ui/model-picker-modal.ts`：抽出 `isPickedByDefault`，不重合时全选。
- `services/canon-research-service.ts`：抓取上限 20000；新增 `mcp` 通道与 `parseMcpSearchText`（JSON results/data/items/web.results 与纯文本 URL 双解析）；MCP 不需要额外 Key。
- `main.ts`：注入 `mcpCallTool`（短连接目标服务→调工具→关闭）。
- `shared/canon-source.ts`：注入预算默认 24000，裁剪时显式标注剩余字数与「不要据此断言原著未提及」。
- UI：检索方式新增「MCP 检索工具」，选服务/工具/查询参数名；摘录长度 200–20000 并说明只管存多少。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 纯逻辑 | URL 候选回退、MCP 解析与调用契约、默认勾选、注入截断标注、渠道参考价 | 新增 20+ 条，全过 |
| 回归 | `npm run test` | 937 文件 / 9853 通过 / 3 skipped |
| 实机 | OpenCode go「从 URL 获取」→ 86 个模型全勾 → 应用后 models=86、modelMeta=86（上下文/输出/视觉/价格），`resolveModelLimits` 返回 200000/32000 | 通过 |
| 实机 | SenseNova 请求 `/v1/models` 返回 401（地址正确，仅缺 Key），不再是 404 | 通过 |
| 实机 | 检索方式切到「MCP 检索工具」→ 出现「MCP 检索配置」区，未配置服务时给出指引 | 通过 |
| 门禁 | `npm run gen:docs && npm run preflight` | 见提交 |

**说明/边界**

- MCP 通道需要用户先在「MCP 服务」页配置一个带搜索工具的服务；本机当前没有，因此只能验证 UI 与调用契约（单测覆盖），真实检索待用户配好服务后验证。
- SenseNova/DeepSeek 的 Key 当前处于加密锁定状态，无法验证真实模型列表内容；地址纠正后报 401 而非 404，说明路径已对。
- 「AI 前期调研」暂不支持 MCP 通道（那条链路走 TrendResearchService，没有 MCP 注入点），已显式退回 manual，不静默失败。
### 2026-11-16 第九轮：口令单次解锁 + 模型勾选/测试按钮

用户反馈两条：解锁要连输两次；「从 URL 获取」全部取消后下面仍显示全部模型、测试连通性不知道测的是哪个模型、按钮位置不合理。

**根因**

1. 解锁两次：`loadSettings()` 解密后只写回 `settings.*`，没有回写 `rawSecrets`；`lockedSecretCount()` 统计的是 rawSecrets 里 aes256v2 条数（解密前的磁盘值），所以解锁成功后界面仍显示「有 5 项未解锁」，用户只能再输一次。
2. 勾选不同步：`buildPickerResult` 在结果为空时返回空信号，弹窗据此弹「至少保留一个模型」并阻止应用；用户「全部取消」后列表自然不变。
3. 测试按钮：原来在密钥下方只有一个渠道级按钮，模型选择逻辑是「当前渠道用 defaultModel、非当前渠道用第一个启用模型」，用户无法知道测的是哪个模型。

**改动**

- `core/settings-service.ts`：新增 `decryptTracked`，解密成功即同步 `rawSecrets`，锁定计数一次解锁归零。
- `ui/model-picker-modal.ts`：允许空列表（取消全部=清空），`buildPickerResult` 不再返回 null。
- `ui/settings/api-section.ts`：`syncAvailableModels` 空列表保护（不清空全局模型、提示补回）；每个模型行新增「🔌 测试该模型」按钮与行内结果；删除密钥下方的渠道级测试按钮。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 解锁后 lockedSecretCount 归零 / 无口令保持密文；全部取消返回空列表、部分取消只剩勾选 | 全过 |
| 实机 | 本地 Ollama 模型行出现 2 个 🔌 按钮，密钥区旧按钮为 0；点第一行 → 「⚠️ qwen2.5:7b：连通正常，但响应较慢（10350ms）」 | 通过 |
| 实机 | 「全选」→「全部取消」→ 应用：models=[]、页面模型行 0（列表同步清空）；随后已把用户原始模型 `qwen2.5:7b`、`deepseek-r1:7b` 恢复 | 通过 |
| 门禁 | `npm run gen:docs && npm run preflight` | 见提交 |

**待确认**

- 「URL 和 API 格式现在的方式错误」具体指哪种：A 只填完整请求 URL、协议自动识别；B URL 所见即所发、协议只决定请求体；C 保留推导但显示可编辑的最终请求 URL。确认后再改，不猜。
### 2026-11-16 第十轮：方案 C（实际请求 URL 可见可改）+ 测试结果独立区

用户确认走方案 C，并要求测试连通性的提示不挤在模型设置行中。

**改动**

- `shared/api-format.ts`：新增 `resolveEffectiveRequestUrl(endpoint, format, override)`（覆盖优先，否则推导）。
- `CustomProvider.requestUrlOverride`：用户显式填写的实际请求 URL；为空 = 自动推导。
- `engine/ai-api-client.ts`：`resolveRequestEndpoint` 优先返回覆盖值（不再推导/Ollama 改写），非流式与流式共用。
- `core/provider-manager.ts`：改 Base URL 时自动清空覆盖，避免打旧地址。
- `services/api-connectivity-service.ts`：新增 `requestUrl`，测试与实际生成打同一地址。
- `ui/settings/api-section.ts`：协议下方新增「实际请求 URL」字段（显示自动推导值 / 覆盖中提示 / 恢复自动按钮）；「从 URL 获取」也按覆盖地址推导；测试结果改为模型列表下方独立结果区（按模型分条、可清空）。
- 样式：新增 `.nw-api-test-results` 等（只用 Obsidian CSS 变量）。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 覆盖优先/空白视为未覆盖；连通性 requestUrl 优先；改址清空覆盖；接线断言 | 全过 |
| 实机 | 渠道详情出现「实际请求 URL」，提示「自动推导：http://localhost:11434/api/generate」 | 通过 |
| 实机 | 覆盖为 `http://localhost:11434/api/chat` → 提示「覆盖中：…（清空输入即恢复自动）」；点模型测试 ✅ 53ms（走覆盖地址，未覆盖时 /api/generate 需 9.6s） | 通过 |
| 实机 | 测试结果显示在模型列表下方独立区（`inModelRow: 0`），模型行内无结果文本 | 通过 |
| 实机 | 验证后已把 Ollama 的覆盖清空，恢复自动推导 | 通过 |
| 门禁 | `npm run gen:docs && npm run preflight` | 见提交 |
### 2026-11-16 第十一轮：OpenCode / 日日新连接测试排查

用户反馈两个渠道连接测试都有问题。实机 + 直连双向排查。

**实机现象**：两个渠道点模型测试都报 401（OpenCode：Invalid credential；SenseNova：Forbidden）。

**真实原因（两层）**

1. 插件 P0 bug：密钥处于加密锁定状态（locked=7）时，连通性测试没有判密文，直接把 `aes256v2:...` 当 Bearer 发给服务端。服务端当然返回 401，于是「没解锁」被显示成「密钥错误」。这也意味着密文被外发到第三方。
2. 渠道配置问题：OpenCode go 渠道的 Base URL 是 Zen 端点（`opencode.ai/zen/v1`），但该账号是 Go 订阅——直连实测 Zen + 该 Key 返回 **402 Insufficient balance**，Go 端点（`inference/go/openai/v1`）+ 同 Key 返回 **200**。SenseNova 的 API 格式被存成 `openai-responses`，应为 `openai-chat`。

**改动**

- `services/api-connectivity-service.ts`：新增密文判定（锁定态不发请求，提示先解锁）；402 归类 `quota_exceeded`；新增 `suggestFix` 给可执行建议。
- `ui/settings/api-section.ts`：测试结果区第二行展示建议。
- 数据修正：SenseNova 预设 `apiFormat` → `openai-chat`。
- 样式：新增建议行样式。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 密文不外发（请求未发出 + 提示解锁）、402 归类与建议、suggestFix 三种场景 | 全过 |
| 实机 | 未解锁点测试：OpenCode go / 日日新/SenseNova 均提示「密钥处于加密锁定状态：请先…解锁」，且日志无请求发出 | 通过 |
| 直连 | Zen+QQ Key → 402 余额不足；Go+QQ Key → 200；Zen+GO Key → 401 | 见模块页 §11 |
| 门禁 | `npm run gen:docs && npm run preflight` | 见提交 |

**留给用户确认**

- OpenCode go 渠道端点是否改为 `https://opencode.ai/inference/go/openai/v1`（插件不擅自改，避免改到第二个账号）。
- SenseNova 解锁后若仍 401/400，需要核对 Key 与模型名（当前模型名是 `deepseek-v4-flash`，SenseNova 自带模型名为 `sensenova-6.7-flash-lite`）。
### 2026-11-16 第十二轮：解锁后实测两个渠道

用户提供口令 970613 解锁（locked 7 → 0，6 把 Key 明文），重新测试两个渠道。

**实测结果**

1. OpenCode go（当时仍是 Zen 端点）：403 Model access is disabled —— Go 订阅的账号在 Zen 没开模型权限。
2. 日日新/SenseNova：429 inference exceeds tpm/rpm limit —— 鉴权与地址都正确，只是限流。
3. 日日新（自定义 custom-2）：✅ 连通正常 1347ms。

**改动**

- 把 OpenCode go 渠道端点改为 `https://opencode.ai/inference/go/openai/v1`（原 Zen 端点已证实不可用），从 URL 获取 32 个 Go 模型。
- 修 M-41：新增 `CustomProvider.modelsEndpoint` 记录模型列表来源端点；端点变化时「从 URL 获取」用新列表替换旧模型，不再叠加。
  （旧行为导致 Zen 的 42 个模型换到 Go 端点后仍整套保留，claude-opus 等在 Go 端点必 400）
- `ModelPickerModal` 支持 `replaceMissing`：换端点时默认全选新候选。

**最终验证**

| 渠道 | 结果 |
| --- | --- |
| OpenCode go（Go 端点） | ✅ deepseek-v4.1-flash 连通正常 1639ms |
| 日日新/SenseNova | ✅ deepseek-v4-flash 连通正常 1120ms |
| 日日新（自定义） | ✅ 连通正常 1347ms |

**遗留**：OpenCode Zen 余额不足（402）尚未处理，用户若要用 Zen 通道需充值；当前用 Go 订阅通道即可。
### 2026-11-16 第十三轮：API 模块遗留清理

验收遗留三项，全部处理并实机验证。

1. **同一端点两条 modelOverrides key**：新增 `shared/provider-settings-maintenance.ts` 的 `mergeDuplicateOverrideKeys`，按归一化端点分组，保留「与渠道 endpoint 完全一致」的 key（否则条目最多、否则最先出现），合并时先出现值优先（与运行时读取顺序一致），空条目丢弃。幂等。
2. **enabledProviderIds 幽灵 id**：新增 `pruneUnknownProviderIds`，启动时过滤已删除渠道；undefined（全部显示）保持不变。幂等。
3. **隐藏渠道无恢复入口**：侧栏新增「已隐藏（N）」分组，每行「恢复显示」按钮调用 `setHidden(id,false)`。

顺带把 `normalizeEndpointKey` 从 core 下沉到 `shared/endpoint-key.ts`，让 shared 层也能复用（core 仍 re-export，保持兼容），避免两套归一化逻辑漂移。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 合并（分组合并/冲突先出现优先/无重复不标记变化/幂等/空条目）、清理（过滤/undefined/幂等）、归一化（循环剥离/不误合并子路径）、DOM（已隐藏分组与恢复按钮） | 新增 14 条全过 |
| 实机 | 启动后 modelOverrides 7→6 条，deepseek 合并为 `https://api.deepseek.com` 且 maxOutput=131072 未丢 | 通过 |
| 实机 | enabledProviderIds 由含 volc/catcat → 仅 4 个真实渠道 | 通过 |
| 实机 | 侧栏出现「已隐藏（3）」与 3 个恢复按钮；点恢复后渠道回到侧栏；验证后还原 | 通过 |
| 门禁 | `npm run gen:docs && npm run preflight` | EXIT=0（937 文件 / 9878+ 用例） |
### 2026-11-16 第十四轮：设置框架/导航实现（A3/B1/C2/D1）

用户确认 Brief：A3 两种搜索都做、B1 高级区重划、C2 顺带改工作台导航、D1 会话内记忆。

**实现**

- 新增 `ui/settings/settings-search.ts`：静态索引（6 分组 + 20 tab + 20+ 主题词）+ 动态索引（已渲染分区真实项名，400ms 采集）；`searchSettings` 打分（项名 100/80 > tab 60 > 分组 40 > 关键词 30）；`filterSettingsItems` 过滤当前分区；`highlightSettingItem` 跳转高亮。
- 设置页重写：改用 `createSettingsSection` 并缓存实例（保留分区状态）；顶部搜索（全局结果 + 当前分区过滤）；`groupTabMemory` 分组记忆；`openTab(tabId, itemName)` 供命令/工作台调用；删除死代码 `resetSettings`；热重载移到「关于」。
- 装配统一：统计词表 → FingerprintSection、关键词兜底 → RulesSection（原来宿主注入导致弹窗缺失）。
- 异步分区：`SettingsSection.asyncLoad` 标记 4 个分区，宿主顶部统一「数据可能过期｜🔄 刷新」条。
- 弹窗：tab 栏改「分组标题 + 组内 tab」两行布局 + 搜索框。
- 命令：20 条「设置：打开 <分组> › <页签>」。
- 工作台：标题栏「⚙️ 设置」改为常用分区菜单 + 打开完整设置页。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 搜索 13 条 + 接线 11 条 + 弹窗 5 条 + 分组回归 7 条（适配 B1 新划分） | 全过 |
| 实机 | 搜「AI 味」→ 1 条结果，点击跳到「📜 写作规则」且内容正确 | 通过 |
| 实机 | 当前分区过滤：api 分区 17 项被隐藏 | 通过 |
| 实机 | 分组记忆：规则组停在「角色识别」→ 切连接组 → 切回仍在「角色识别」 | 通过 |
| 实机 | 异步条：知识库 tab 顶部「数据为加载时快照，可能已过期🔄 刷新」 | 通过 |
| 实机 | 内聚后指纹库含「统计词表」、写作规则含「关键词兜底」 | 通过 |
| 实机 | 20 条命令；执行「打开 MCP 服务」→ 设置页停在「🔌 MCP 服务」 | 通过 |
| 实机 | 工作台设置菜单（需正文写作页渲染标题栏）未能自动化验证，由接线测试覆盖代码路径 | 部分 |
| 门禁 | `preflight` | 见提交 |
### 2026-11-16 第十五轮：写作工作台首页实现（A3/B1/C1/D2/E1）

用户确认：A3 只做工作台首页、B1 持久化最近排序、C1 折叠旧版工具、D2 深度接入 flow-state、E1 ⋯ 菜单。

**实现**

- 新增 `ui/full-writer/recent-projects.ts`：recordProjectOpened（上限 30）/ sortProjectsByRecent / pruneMissingProjects / formatRecentLabel。
- 新增 `ui/full-writer/next-step.ts`：buildNextStepPlan 从流程快照推演「下一步」，blocked 沿依赖回溯防环。
- `project-selector-controller.ts`：项目网格按最近排序并在卡片显示相对时间；右栏顶部新增主操作卡（下一步 + 百分比 + 双按钮），dispatchNextStep 按 CreationFlowAction 分发；流程快照每渲染只采集一次；卡片常驻动作收敛为 3 + ⋯ 菜单。
- `domains/long/tool-catalog.ts`：三个旧版生成工具拆成「📦 旧版工具」默认折叠。
- 设置新增 `projectLastOpened`；新增样式 22-workbench-home.css。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | recent-projects 17 + next-step 10 + 接线 10 | 全过 |
| 实机 | 旧版工具折叠（collapsed=true）、章节生成组只剩批量建章 | 通过 |
| 实机 | 卡片动作 [向导, 写作, 句级协同, ⋯] | 通过 |
| 实机 | 示例项目右栏：「继续写第 1 章」25% + 「继续写作/查看完整流程」 | 通过 |
| 实机 | 选中项目后排序列落盘 data.json，卡片显示「刚刚」 | 通过 |
| 实机 | 删除项目后重开：卡片 0、hero 恢复、幽灵记录清空 | 通过 |
| 门禁 | `preflight` | 见提交 |

**说明**：验证用「示例项目」已删除（删除前备份），vault 恢复 0 项目。创作主页（home-view）的 H-02/H-04/H-05 按 A3 范围本轮未做，已记入模块页 5.2。
### 2026-11-16 第十六/十七轮：正文编辑器·协同写作（盘点 + P0 实现）

**盘点结论**：AI 协作那一半很深（建议生成/采纳/校验/迭代/质量/知识库），
编辑器与写作流转这一半明显偏薄——更像「AI 建议消费面板」而不是能连续写完一本的编辑器。
完整能力矩阵见 `docs/modules/co-writing.md`。

**用户确认**：A1（只做 P0）/ B1（内联查找条）/ C1（状态栏章节导航）/ D1（大纲 > 项目 > 全局）。

**实现**

- 新增 `ui/co-writing/find-replace.ts`：纯函数 + 内联查找条（Ctrl+F / Ctrl+H / Enter / Esc / Aa / \\b / 替换 / 全部替换）。
- 新增 `ui/co-writing/chapter-nav.ts`：相邻章节解析（跨卷/乱序/章号推断）+ 状态栏「‹ 选择器 ›」。
- 新增 `ui/co-writing/word-goal.ts`：解析分卷大纲「每章字数」（区间取上限）+ D1 优先级回退 + 来源标签。
- 视图接线：Ctrl+F 仅在编辑器聚焦时拦截；切章前保存、失败中止；切章后刷新列表与目标；指标与状态栏统一目标值。

**验证**

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 单测 | 新增 44 条（查找 21 / 章节 11 / 目标 12） | 全过 |
| 实机 | Ctrl+F 打开、1/2 计数、Enter 跳 2/2、Esc 关闭 | 通过 |
| 实机 | 全部替换「林昭」→「少年」 | 通过 |
| 实机 | 状态栏「‹ 第1章 / 第2章 / 第3章 ›」，首章禁用；点 › 切到第2章 | 通过 |
| 实机 | 字数目标「3000（大纲）」、概览「112/3000字」 | 通过 |
| 门禁 | `preflight` EXIT=0（948 文件 / 10002 用例） | 通过 |

**P1 待办（已登记模块页 6.2）**：撤销/重做按钮、建议 diff、字号行距、专注模式、保存入口前置；
P2：简报就地补规划、光标位置、语法高亮、按钮说明、旧浮窗合并。
### 2026-11-16 第十八轮：协同写作 P1/P2 补齐（重点：排版）

用户要求 P1、P2 全部补齐，并特别关注前端排版。

**新增 5 个模块**：edit-history（多章撤销栈）、text-diff（行级 LCS）、
editor-display（字号行距/光标）、markdown-highlight（着色镜像层）、editor-aux（辅助条）。

**问题覆盖**：E-04 撤销重做、E-05 建议 diff、E-06 字号行距、E-07 专注模式、
E-08 保存入口、E-09 简报就地补规划、E-10 光标位置、E-11 语法高亮、E-12 按钮说明；
E-13 旧浮窗暂不合并（仍被 workspace-manager 使用）并登记。

**排版问题（本轮核心）**

1. L-01 镜像层 padding 为 0：`style.setProperty('paddingTop', …)` 只接受 kebab-case，
   驼峰被静默忽略 → 改为直接给 style 对象赋值。
2. L-02 专注模式中栏塌缩到 118px：中栏编辑区宽度来自 `--nw-cowrite-editor-percent`，
   只隐藏左右栏仍按百分比分配 → 专注态把主区域改回块级、中栏显式 100%。

**对齐实测**（scrollHeight 与宽度）

| 状态 | 编辑宽 | 镜像宽 | 编辑高 | 镜像高 | 对齐 |
| --- | --- | --- | --- | --- | --- |
| 常规 16px | 375 | 375 | 616 | 616 | ✅ |
| 专注 16px | 862 | 862 | 708 | 708 | ✅ |
| 专注 22px | 862 | 862 | 708 | 708 | ✅ |

**顺带**：高亮首版 innerHTML 被 no-unsanitized 门禁拦下 → 改 DOM 渲染；
ChapterHistoryStore 被引擎守卫误判 → 白名单登记。

**验证**：新增测试 78 条；实机 9 项全过；`preflight` EXIT=0。
### 2026-11-16 第十九轮：协同写作自检收尾 + 规划模块首轮

**协同写作（4af9bcb1）**：用户要求「一次完整判断」。实机驱动修掉 11 项真实缺陷——
镜像层行高/滚动条/首屏重影/导航每键重建/专注不持久/程序化改写不同步/清空残留/
窄屏编辑区过窄/辅助条四行/差异仅候选卡/高亮缓存失效。preflight EXIT=0。

**规划模块（f951e5a6）**：先审计（docs/modules/planning.md，16 项问题），再实现：

P0 全修：
1. 撤销对事件节点完全无效（只有便签走 mutate 压栈）→ 统一 pushUndo + mutate，
   拖动整段只记一步；修复前撤销还可能静默丢掉新增节点。
2. 删除无确认 → 两步确认 + 可撤销。
3. 便签 window.prompt → 内联 textarea。
4. 空态断头 → 项目选择器。

核心 P1：搜索、缩放/平移、事件↔章节双向链接（画布「打开该章」+ 协同「记为事件」）、
选中不再整页重建、键盘可达（方向键/Enter/Delete/Ctrl+Z）。

P2：规划样式从 16-统计桌宠 迁到 24-planning-canvas.css。

顺带：openPlanningCanvas 复用视图不重新读盘（协同写入事件后看不到）已修。

**下一轮候选**：大纲树/场景细纲历史内联样式收敛、场景细纲跨章复制、
大纲树↔画布桥接、扩写逐段接受、全书规划参数记忆。
### 2026-11-16 第二十轮：规划模块顺延项（a7f57413）

补完审计里的 P1/P2 剩余项：

- P-09 场景跨章复制：场景面板「📤」+ 选章弹窗，序号接着目标章排。
- P-10 大纲树↔画布桥接：大纲树「🗺 生成画布事件」，按章去重、分卷分列。
- P-15 扩写逐段采用：逐场景「采用/跳过」，按采用状态重建待应用正文。
- P-16 全书规划参数记忆：planBookLastParams 回填。
- P-13 内联样式收敛：大纲树 14 处 + 场景细纲 7 处 → 类名（新增 25 号样式文件）。

新增纯模块：scene-outline-format（编解码，控制器复用避免双实现漂移）、
outline-bridge（大纲→节点）。

验证：preflight EXIT=0（960 文件 / 10091 用例）；新增测试 20 条。
限制：Modal 在 CLI 环境不渲染，本轮功能以纯函数单测 + 编译/lint + 路径核对为准，
未实机点击（已记入 planning.md §6.5）。

下一轮候选：nw-u- 工具类专项收敛（4860 处）、大纲树缺大纲时的生成入口、
质量闭环 / 统计模块。
### 2026-11-16 第二十一轮：nw-u- 工具类专项（fa0ec259）

用户要求先清这批历史债。

根因：旧的内联样式清理脚本用「可读名 + 重名加 -2」生成工具类，导致
(1) 整套定义复制两遍（142 条纯重复）；
(2) 真撞名时后缀硬区分，名字与含义脱节（op-0-2 是 0.2、margintop-4px-2 是负值）；
(3) 残留「引用但未定义」的死类。

处理：按声明合并重复（含三级后缀传递闭包）、修正 8 个名实不符类、
修 4 处死类、删 5 条死规则、21 个硬编码色类改语义名 + 主题变量，
新增 scripts/check-utility-classes.mjs（禁止重名复制/未定义引用/超基线）并接入 preflight。

结果：定义 571→430，重复 142→0，未定义引用 8→0，硬编码色类 21→0，
CSS −5.4KB，唯一类 −141；preflight EXIT=0。

未做（文档 §5 记录）：4763 处工具类全量改语义组件类（视觉风险大）、
16 组重复 class 链合并（收益低于风险）。

下一轮候选：质量闭环 / 审稿模块（INDEX 下一个 todo）。
### 2026-11-16 第二十二轮：视觉重构启动（c24fd27b）

用户要求「按模块做视觉重构，命名要规范，不能质量倒退」。

**先建规则与门禁**：
- 规范 docs/design/2026-11-16-visual-refactor-standard.md：类名
  nw-<module>-<block>[-<element>][--<modifier>]，模块短名枚举，CSS 一模块一文件；
  防倒退判据 R1 结构 / R2 几何 / R3 计算样式 / R4 文本 / R5 单测 / R6 门禁 / R7 工具类不增。
- 工具：scripts/visual-baseline-capture.js（Obsidian 内拍「路径→矩形+计算样式」快照，
  样式字典化压到 210KB/1177 节点）+ scripts/check-visual-diff.mjs（违规退出码 1）。

**Slice A 知识库书架外壳**：语义类替换工具类链 + 3 处内联样式改修饰类 +
样式归位到 27-knowledge-base.css + 清死类 nw-text-muted-11；工具类 −72。

**防倒退实测**：before/after 快照比对 R1~R4 全 0 差异；
首轮抓到 2 处真实倒退（误加 overflow:hidden、按钮选择器特异性不足）并修复——证明门禁有效。

后续 slice 清单见 docs/modules/knowledge-base.md §4（工具栏/卡片、详情三区、配置页、弹窗）。
### 2026-11-16 第二十三轮：视觉重构 Slice B（c56821f5）

知识库书架工具栏 + 列表 + 书籍卡片语义化：
- 工具栏/列表/卡片全部换成 nw-kb-* 语义类；卡片状态色改修饰类、进度改 CSS 变量。
- kb-book-card.ts 工具类 39 → 0、内联样式 4 → 0。
- 清掉 6 个从未定义的类（nw-kb-book-card / nw-kb-book-grid / nw-kb-toolbar /
  nw-kb-select / nw-hover-border / nw-text-muted-11 / nw-flex-shrink-0）。

防倒退：R1 结构 0 差异；R2/R3 共 44 处均为有意改动（列表 flex、
日期/进度标签接上设计意图、状态色改项目 token），已写入基线 acceptedDiffs。
门禁又抓到 1 处真回归（搜索框特异性不足退回默认外观）并修复。

工具链增强：check-visual-diff 支持 --accept/--note 留痕；
FakeEl.style 支持 setProperty（组件可用 CSS 变量而非 setAttribute('style')）。

下一轮：Slice C 书籍详情概览区（book-detail-renderer.ts，914 处工具类是主战场）。
### 2026-11-16 第二十四轮：视觉重构 Slice C（77b6acde）

详情公共构件 + 概览页语义化：createDetailSection / addInfoItem / 信息网格 /
简介 / 维度网格 / 维度卡片（三态修饰类）/ 拆解进度块。

**本轮抓到的「假绿」**：第一次采集时详情页没渲染（fixture 假书走不到详情），
diff 显示 0 差异但目标区块根本不在快照里。改为真实书籍数据后重做 before/after，
才发现 63 处几何 + 24 处样式差异——全部源于信息项 label 的死类（nw-text-muted-11）
补上 11px 弱化色。已记录进模块页与规范使用提示：采集前必须确认目标元素数量 > 0。

R1 结构差异 0；有意改动已用 --accept 记入基线 kb-detail.json。
preflight EXIT=0（956 测试文件 / 10092 用例）。

下一轮：Slice D 详情其余分区（角色/文风/情感/伏笔，工具类约 800 处）。
### 2026-11-16 第二十五轮：视觉重构 Slice D（e85cd36e）

详情外壳与页签条语义化：容器/返回/标题行/操作区/页签条/页签（--active）/内容区。
该文件工具类 239 → 175，页签内联模板整段消除。

防倒退：R1 结构 0、R2 几何 0、R4 文本 0；R3 首轮 12 处（页签被 Obsidian 默认按钮样式压住）
修复后归零。这是「控件特异性」坑第三次出现，已写进规范 §3.5 坑 1；
同时补充坑 2（目标区块未渲染时 0 差异是假绿）。

动效门禁抓到我把旧内联 transition: all 原样搬进 CSS，已改显式属性。

preflight EXIT=0（956 测试文件 / 10092 用例）。

下一轮：Slice E 详情各页签内容区（文风/节奏/技巧/结构/角色/伏笔/商业/易读性），
剩余工具类主战场；建议按页签逐个做，每次采集对应页签的 before/after。
### 2026-11-17 第二十六轮：开发环境隔离（f6bf8742）

用户问「能否只在插件仓开发测试、避免污染写作 vault」。核查结论：
- 类型检查/单测/构建/preflight 都不需要 vault，日常 95% 工作只在插件仓内（本来就是这样做的）；
- 界面级验证必须有 vault（Obsidian 只从 <vault>/.obsidian/plugins/<id> 加载），
  但不能把插件仓当 vault（会形成 .obsidian/.obsidian 嵌套）；
- 方案：独立开发 vault + junction 指回插件仓。已建好 D:\nw-dev-vault 并实测通过
  （verify: loaded=true, version=4.96.0, commands=110）。

新增 scripts/dev-vault.mjs（init/status/verify）+ docs/dev-vault.md。
清理了 .obsidian/.obsidian 残留（先备份到 .rollback-backup）。

后续验证一律在开发 vault 内做，写作 vault 不再放测试项目/测试书/缓存。

### 2026-11-17 第二十七轮：视觉重构 Slice E（详情各页签内容区）

八个页签（文风/节奏/结构/角色/伏笔/商业/易读性/技巧）内容区语义化，
book-detail-renderer.ts 工具类 866 → 126、内联样式 28 → 3；
动态配色改 CSS 变量 --nw-detail-tone / --nw-detail-tone-bg / --nw-progress。
27 号样式新增 nw-kb-detail-* 构件（唯一类 +168，styles.css +21.5KB）。

**本轮换了验收方式**：148 组「旧工具类串 → 新语义类」做声明级等价审计
（解析 styles-src 取声明并集），143 组完全一致，5 组是原本挂死类
（nw-text-muted-11 ×4、nw-flex-shrink-0 ×1）按设计意图补真，已逐条登记在模块页。

**为什么没拍像素快照**：开发 vault 的插件目录是 junction，data.json 与源仓共用，
在 vault 里造样本书会写进真实数据；且该 vault 没有已拆解的书可渲染八个页签。
已登记补做项：开发 vault 运行期数据解耦 + 已拆解样本书。

### 2026-11-17 第二十八轮：开发 vault 运行期数据解耦（E-补-A）＋插件目录清理

用户要求先把 E-补 的数据解耦做掉，并清理插件目录里过时/多余的文件。

**根因**：开发 vault 的插件目录是 junction（指回本仓），因而
`<vault>/.obsidian/plugins/novel-writer-ai/data.json` 就是本仓的 `data.json`——
两个 vault 共用同一份设置与 `data/`，造样本书会写进真实设置，测试残留也留在写作侧。

**做法**：插件目录改为**真实目录 + 产物单向同步**（`scripts/dev-vault.mjs` 重写）：
- `init` 识别并安全迁移旧 junction（校验联接目标就是本仓，只删联接本身）；
  从 `data.example.json` 生成开发 vault 专属 `data.json`，写归属标记 `.nw-dev-vault.json`。
- 新增 `sync`：按大小 + mtime 同步 manifest.json / main.js / styles.css / versions.json / workers/。
- 新增 `reset-data --yes`：清空开发 vault 的 data.json / data/ / .sessions / pet-image.*。
- `status` 显示目录形态、产物新鲜度、运行数据归属，并与写作 vault 的 data.json 比对是否已分离。
- `verify` 前置校验「真实目录 + 专属 data.json」，输出新增 `expectedVault` / `dataOwned`。

**清理**（本仓）：
- 删除零字节、无人引用的 `_build.bat`；
- `一键编译.bat` 改为调用 `npm run build`（原脚本硬编码绝对路径且绕过样式/模板/worker 构建）；
- 删除临时目录 `tmp/`（15.95MB）、`.tmp-rollup/`、`coverage/`（47.56MB）、`playwright-report/`、`test-results/`；
- 删除 8 份指向已不存在项目的 `data/*-preferences.json`（_nw测试项目 / _nw回归测试 / _nwRG02测试 /
  苍青 / 苍穹之痕 / 九霄逆脉行 / 修仙世界录 / 严谨测试项目），保留 `示例项目-preferences.json`；
- 写作 vault 的 `data.json` / `data/` / `.sessions/` 未动（那是真实运行数据）。

**验证**：`init` 迁移成功（仓内文件未受影响）；`sync` 首次 6 个文件；
`verify` → `{ ok: true, expectedVault: "nw-dev-vault", dataOwned: true, vaultName: "nw-dev-vault",
loaded: true, version: "4.96.0", commands: 110 }`。

剩余：E-补-B（开发 vault 内的已拆解样本书），补齐后才能对视觉切片拍 before/after。
### 2026-11-17 第二十九轮：解锁后重复弹口令框修复（4.96.1）

用户反馈：设置页输入口令一次、已提示「已解锁，密钥可正常读取」，随后又弹同一个口令框，
再输也解不开。要求先修这个 bug 再继续开发。

**根因**：`core/crypto-service.ts` 的 `decryptV2` 旧实现里，**每一次解密失败**都会
`clearSessionPassword()` 再重问一次口令——它假定「失败 = 口令输错」。但磁盘上只要有一条
密文用了旧口令或已损坏（历史混合状态：部分条目明文、部分是旧口令密文），
在已解锁状态下解到那一条就会把刚设好的会话口令整场清掉并再弹口令框；
而重输同一个口令永远解不开那一条密文，于是表现为「输过、提示成功、又要输」。
触发点有两处：`core/settings-service.ts` 的 `loadSettings` 静默解密全部密钥，以及后台 AI 请求的
`engine/ai-api-client.ts` `resolveApiKey`。

**改动**（四处）：
1. `core/crypto-service.ts`：只试一次。入口取 `hadSessionPassword`，有几口令时 attempts=1；
   失败时记入 `_undecryptableSecrets` 并原样返回密文，**不清口令、不再弹框**；
   无会话口令（口令是本次刚问的）才保留「清掉重问一次」。
   新增 `getUndecryptableSecretCount()`；`setSessionPassword`/`clearSessionPassword` 都会清空该集合。
2. `core/settings-service.ts`：`decryptSecretField(label, stored)` 在「有会话口令却解不开」时记录标签，
   新增 `mismatchedSecretCount()` / `mismatchedSecretLabels()`；未解锁时的锁定态仍走 `lockedSecretCount`，两者不混。
3. `ui/settings/api-section.ts` + `shared/secret-display.ts`：状态行带 `mismatched` 提示「重输同一口令也无法解开，
   需要重新填写密钥」；解锁成功的 Notice 在有不匹配项时改为 warning，如实点名数量。
4. `engine/ai-api-client.ts` + `ui/co-writing/friendly-error.ts`：报错分流——
   已解锁但该条解不开时提示「口令不匹配，请重新填写该供应商密钥」，不再误导用户去输口令。

**测试**：新增 8 条（crypto-service 3、settings-service 2、secret-display 2、ai-api-client 1、friendly-error 1），
实跑 5 个文件 89 条通过；`preflight` EXIT=0（956 文件 / 10101 用例）。

**实机验证**（临时 vault + 独立 `--user-data-dir`，用 PBKDF2+AES-GCM 自造密文：
`apiKey` 用 pwA、`providerKeys.volc` 用 pwA、`providerKeys.deepseek` 用旧口令 pwB 模拟历史遗留）：

```json
{ "version": "4.96.1", "mismatched": 1, "labels": ["供应商 deepseek"],
  "apiKeyDecrypted": true, "deepseekStillCipher": true,
  "stillUnlocked": true, "passwordPrompts": 0 }
```

即：解不开的那一条被如实报出、会话口令保持、口令框一次都没有再弹。

**经验**：新 vault 首次以独立 `--user-data-dir` 打开时，Obsidian 会弹「是否信任仓库作者」，
插件在点「信任仓库作者并启用插件」之前根本不加载——自动化脚本要先点掉这个弹窗再断言
（此前误判成「卡在弹窗」）。


### 2026-11-17 第三十轮：E-补-B 已拆解样本书 + 像素快照 + 索引写入修复

**背景**：第二十七轮 Slice E 的跨页签等价只有「声明级审计」，缺 R4 像素快照；原因是开发 vault 里没有已拆解的书。
本轮用真实原文补齐。

**样本书**：`D:\nw-dev-vault\写作知识库\将夜\`，正文取自 `指纹资料库\将夜.txt`（GB18030，11.9MB），
走插件自身导入 + `deconstructionScheduler.rerunBook()`，`sampleMode=true` / `textSampleLimit=120000` /
`vectorEnabled=false`，约 1.5 分钟拆解完成；`wordCount=3,743,515`、`breakdownStatus=completed`，八份分析文件齐全。
拆解不依赖 AI 密钥——`engine/deconstructors/*` 的 LLM 增强是可选的，无密钥自动降级纯统计。

**顺带修掉的索引 bug**：`services/knowledge-base-manager.ts` 的 `saveIndex` 无条件 tmp+rename，
`adapter.rename` 在目标存在时抛 `Destination file already exists!` → 索引永远 65B 的 `books: []`，
新导入书重启即消失（实测开发 vault 索引停在 1:36）。改为「已存在就覆写、不存在才 tmp+rename」；
`tests/unit/services/knowledge-base-index-atomic.test.ts` 1 → 3 条，实机重建索引 643B 且含「将夜」、无 `.tmp` 残留。

**像素快照**（before = `73b2c01a`，after = 当前构建；同一本书、1440×2600、DSF=1）：

| 页签 | 差异 | 归因 |
| --- | --- | --- |
| 概览/文风/节奏/结构/伏笔/商业/可读性/标签 | **0 px** | 完全一致 |
| 技巧 | 2.611% | 序号徽标整体上移 4px（同色 `152,115,247`、同宽 x=16–45）；原 `nw-flex-center` 从未定义、徽标按行内基线对齐，语义化后 `.nw-kb-detail-rank` 自带 flex 垂直居中 |
| 人设 | 0.273% | 整页 −27px（0.05%），差异集中在尾段弧光条与卡片右边缘，逐卡累积的间距微差 |

after 构建八个页签 `nw-u-` 引用均为 0（before：技巧 141 / 结构 2300 / 人设 23183 / 文风 54 / 节奏 82）。
详细结论见 `docs/modules/knowledge-base.md` §3.8.1。

**经验**：截图必须用真实 DOM 分片滚动拼接——把容器克隆到全屏浮层再截图，canvas 图表像素会全丢、
祖先 `overflow:hidden` 还会出黑底，两版都「看起来一样」但比对无效。

下一轮候选：Slice F 题材/配置页；Slice G 弹窗（需人工视觉验收）。

### 2026-11-17 第三十一轮：Slice F 题材配置页语义化

**范围**：`ui/views/kb-config-panel.ts`（199 行）——知识库「题材配置」页签的全部结构。

**改动**：类名统一换 `nw-kb-config-*`（tab / 分类栏三项 / main / toolbar / content / empty / grid /
题材卡及内部 15 个子件 / 细分题材标签）；分类项与题材卡的内联 `style` 全部删掉，padding、左侧选中条、
选中阴影、悬停过渡改由 27 号样式承接（`:hover` 与 `--selected` 修饰类）。
该文件 `nw-u-` 引用 86 → 0，内联样式 2 → 0；27 号样式新增约 226 行。

**等价审计**：28 组旧类串↔新语义类逐组比对声明并集，27 组一致；唯一真差异是
`nw-text-muted-11`（从未定义）被 `-subgenre-more` 补真为 11px 弱化色——与 Slice C/E 同一处理方式。

**像素快照**（1440×2600，DSF=1；产物在 `D:\nw-dev-vault\_visual-fg`）：

| 目标 | 差异 | 归因 |
| --- | --- | --- |
| 题材配置页 | 6.23% | `+N` 溢出计数 15px/正文色 → 11px 弱化色，行高 23.5 → 18.3px、卡片 253.1 → 247.9px，后续行上移 5.2px；注入旧字号后卡片高度精确复原 253.1px，确认只此一处 |
| 题材编辑 / 编辑书籍弹窗 | 0 px | 完全一致（本轮未改这两个文件） |
| 导入 / 批量操作弹窗 | 0.016% / 0.006% | y=0 标题字形抗锯齿 |

**门禁**：`check:css` 超基线（唯一类 +19、+3689B、rgbHsl +1，选中阴影从内联搬进 CSS），
已 `--update-baseline --note` 写明原因；`check:inline-styles`、`check:utility` 通过；
`kb-config-panel-render.test.ts` 三处断言改为语义类（并新增「分类项不再有内联样式」断言），2 文件 27 条通过。

**教训**：题材卡与分类项的选中态若继续用内联 style，`:hover` 无法接管——必须先把「状态」变成修饰类，
再让 CSS 负责视觉，否则改一半会留下两套真相。

下一轮：Slice G 四个弹窗（`ui/views/knowledge-base-modals.ts`，1243 行）；之后收尾工具类清理与全局 INDEX。



### 2026-11-17 第三十二轮：Slice G 知识库管理弹窗语义化

**范围**：`ui/views/knowledge-base-modals.ts`（1378 → 1263 行）——导入 / 编辑书籍 / 题材编辑 / 批量操作四个弹窗。

**改动**：类名统一换 `nw-kb-modal-*`（区块 / 字段 / 输入 / 标签 / 列表 / 权重条 / 底部按钮组，以及导入与批量各自的
`-choice`、`-file-item`、`-op` 等专项类）；工具类引用 249 处（84 个不重复类名）→ 0，内联 `style` 14 → 1
（只剩隐藏 file input 的 `display:none`）。权重条宽度改走 `--nw-kb-pct` 变量，批量选中态改修饰类；
27 号样式新增约 472 行。EditBookModal 的 h3 补 `nw-modal-title`，与另外三个弹窗统一。

**像素快照**（1440×2600，DSF=1；产物在 `D:\nw-dev-vault\_visual-g`）：

| 目标 | 差异 | 归因 |
| --- | --- | --- |
| 题材编辑（查看 / 新建） | 2.012% / 1.264% | 只读子题材描述由 12px 正文色补真为 11px 弱化色、名称 margin-bottom 2px → 0；新建态标签输入框与名称框统一为 fs13 / 4×8 / 圆角 5 |
| 导入（选择 / 表单） | 0 px | 完全一致 |
| 导入（文件列表） | 8.203%（220 → 218） | 旧代码把 `&:last-child{border-bottom:none;}` 写进内联 style（SCSS 语法被浏览器丢弃），末行仍有下边框；改 `:not(:last-child)` 后 −2px |
| 批量操作 | 6.728%（276 → 270） | 两处死类 `nw-text-muted-11` 补真为 11px 弱化色，单行 52.4 → 47.2px |
| 编辑书籍信息 | 13.58%（696 → 662） | 标题由裸 h3（19.77px / margin 16px 0）统一为 `nw-modal-title`（18px / margin 0），content −34.3px |

**门禁**：`check:css` 超基线（唯一类 +79、+8405B、rgbHsl +1），`.css-baseline.json` /
`.bundle-baseline.json`（styles.css 633424 → 641829）已 `--update-baseline --note`；`check:inline-styles` /
`check:utility` 通过。

**教训（截图配置一致性）**：开发 vault 的 `data.json` 里 `theme` 曾残留 `dark`，而 Obsidian 用亮色主题，
主题管理器把 `--nw-text-primary` 写成暗色方案的 `#f0ece4`，于是所有用 `nw-modal-title` 的弹窗标题在亮色底上
几乎不可见——差点被误判成「语义化把标题改坏了」。视觉采集前应确认 `theme: auto`（默认值）或与 Obsidian 主题一致。

下一轮：Slice A–G 已全部完成，收尾工具类清点（全仓 `nw-u-` 存量）与全局 INDEX 更新。

### 2026-11-17 第三十三轮：工具类存量清理（零引用定义 + 死引用）

**范围**：`styles-src/10-entity-and-utilities.css`（589 → 532 行，纯删除，无空行残留）与 `ui/views/writing-fingerprint-view.ts`。

**盘点**：全仓 `nw-u-*` 定义 430 个（全在该文件），TS 引用 378 个类；脚本核对「定义集合 ∩ 引用集合」后：
57 个定义零引用；5 处引用无定义（1 个真实缺陷 `nw-u-w-full-2`，其余 4 处是 `tests/` 断言与历史文档示例）。

**改动**：删 57 个零引用定义（按名字精确匹配整条规则，脚本报告 removed=57 / missing=0 / 重名=0）；
删 `ui/views/writing-fingerprint-view.ts:1795` 的 `area.inputEl.addClass('nw-u-w-full-2')`——该类从未定义，
是空操作，删除后指纹编辑弹窗的渲染不变（12 维描述文本域本就吃 Obsidian 默认宽度）。

**结果**：定义 430 → 373，零引用 0，未定义引用 0，TS 引用 373 类 / 3602 次 / 65 文件；
`styles.css` 641824 → 639017 字节（−2807）；唯一类 3478 → 3421。

**门禁升级**：`check:utility` 新增 B2（源码全文死引用，覆盖 `addClass()`）与 D（零引用死定义）两项，README 头注释同步。
取词正则须连尾部长连字符一起取——历史生成器截断的长名（`nw-u-blt-3px-solid-interactive-` 等）真实生效，否则误报。

**门禁**：`check:css`、`check:utility`（定义 373、使用 3483）、`check:bundle` 三处基线已 `--update-baseline`
收紧（`.css-baseline.json` 的 note 记明「删 57 个零引用工具类 + 修 `nw-u-w-full-2` 死引用」）；
`check:inline-styles`（总计 685，静态 533 / 动态 152）、`typecheck` 通过。

**教训（盘点口径）**：`check-utility` 的 B 项只扫 `cls:` 字面量，`addClass('nw-u-…')` 里的死类拦不住——
以后清点要按「TS 全文出现的 `nw-u-*` 集合」与「CSS 定义集合」做双向差集，两边任一方向非空都算债。

**文档**：`docs/design/2026-11-16-visual-refactor-standard.md` 新增 §5.1「工具类退场进度」（指标表 + 剩余存量大户
20 行 + 清理记录），`docs/CURRENT.md` §6 的 `nw-u-*` 条目改为指向 §5.1。

下一轮：按 §5.1 的存量大户推进语义化，建议先做 `ui/batch-import-modal.ts`（365 处）或
`ui/knowledge-detail-modal.ts`（294 处）——两者都是弹窗，可复用 Slice G 的 `nw-kb-modal-*` 模式。

### 2026-11-17 第三十三轮：Slice H 批量导入弹窗语义化

**范围**：`ui/batch-import-modal.ts`（1882 → 1726 行），独立 `nw-bi-*` 命名空间（作者要求不复用 Slice G 的
`nw-kb-modal-*` 骨架，只保留共享 h3 `nw-modal-title`）。

**改动**：工具类 365 处 → 0（连同 8 个死类与 `nw-text-*`/`nw-flex-*`/`nw-drop-area`/`nw-is-dragover` 一起清掉）；
新增 `styles-src/28-batch-import.css`（1051 行）；动态值走 `--nw-bi-pct`，补齐 `@keyframes nw-bi-pulse`
（原内联 `animation:pulse` 指向从未定义的动画）；新增 `getStatusTone()` / `addStatCard()` 两个私有方法收敛重复拼装。

**核心发现（特异性）**：首轮比对出现页签文字变黑、搜索框边框异常、picker 1px 焦点环。实测定位为
`.modal button` / `input[type=text]`（(0,1,1)）盖过 `.nw-bi-*`（(0,1,0)）。修法：28 号样式 173 条规则全部加
`.nw-scope ` 前缀（(0,0,2,0)，按仓库 `00-header.css:13` 约定）。副作用两处：`-meta-input` 作用域后压过原生
input → 只留 `width:100%`；picker 差异来自焦点态 outline/box-shadow → 截图前 blur 输入框。

**像素快照**（1440×2600，DSF=1；产物在 `D:\nw-dev-vault\_visual-h`）：

| 目标 | 差异 | 归因 |
| --- | --- | --- |
| 文件/文件夹选择器、历史记录 | 0.000% | 作用域后与旧内联样式像素级等价 |
| 导入表单 | 0.541% | 书名/作者输入框 1px 行高差 |
| 文件选择 | 0.28% | 卡片行高 1px 级差异 |
| 扫描结果 | 7.254% | 结果卡/统计卡按设计补真 |
| 空态（第一步 / 最近项目） | 11.321% / 14.261% | 空态容器与卡片间距补真 |
| 生成选项 | 32.132% | 卡片/标签/开关/主按钮由内联样式转语义类并补真 |

**门禁**：`typecheck` 0 错、`check:inline-styles` 通过；`check:utility` 暴露 13 条零引用定义（本 slice 删引用后
才归零），已从 `10-entity-and-utilities.css` 删除，定义 373 → 360、使用 3483 → 3118；`check:bundle`
styles.css 639017 → 659626；`check:css` 的 hex/rgbHsl 各 +8 经改用 `--nw-info|success|warning|danger` 与
`color-mix` 回到基线，唯一类 +154 全为 `nw-bi-*`。三份基线均已 `--update-baseline --note`。

**文档**：`docs/modules/knowledge-base.md` §3.11；`docs/design/2026-11-16-visual-refactor-standard.md` §5 进度改
A–H、§5.1 指标与存量大户表重算、新增「特异性陷阱」段。

下一轮：按 §5.1 存量大户继续，优先 `ui/knowledge-detail-modal.ts`（294 处）与
`ui/full-writer/wizard-step-renderers.ts`（265 处）——前者是详情弹窗，可复用 Slice G 的 `nw-kb-modal-*`。

### 2026-11-17 第三十四轮：Slice I 读书拆解详情弹窗语义化

**范围**：`ui/knowledge-detail-modal.ts`（1707 行、7 页签），独立 `nw-kd-*` 命名空间。

**改动**：120 组 `cls` 组合（234 处 `cls:`）→ 122 个 `nw-kd-*` 语义类；`nw-u-*` 与共享原子类残留 0；
新增 `styles-src/29-knowledge-detail-modal.css`（约 200 条规则，全部加 `.nw-scope ` 前缀——弹窗 `onOpen`
本就挂了 `nw-scope`，特异性 (0,2,0)）；17 处内联 `style:` 清零，进度条宽度改 `--nw-kd-pct` 变量，
颜色全走令牌（三线粉色用 `var(--color-pink)`，仓库无 pink 令牌），置信度底色用 `color-mix(... currentColor 13% ...)`。
三线行旧代码的 `&:last-child` 在内联里本就不生效，新样式故意不加归零以保像素。

**像素快照**（1440×1000，DSF=1；产物在 `D:\nw-dev-vault\_visual-i`）：7 个页签 **diffPx 全为 0（0.000%）**，
计算样式 44 个属性 × 7 页签（85/66/30/58/255/27/47 节点）**全部 0 差异**——A–I 九个 slice 里唯一一次纯等价重构
（该文件无死类、无补真需求）。

**门禁**：`typecheck` 0 错、`check:inline-styles` 通过；`check:utility` 暴露 30 条零引用定义（本 slice 删引用后
才归零），已从 `10-entity-and-utilities.css` 删除，定义 360 → 330、使用 3118 → 2824；`check:bundle`
styles.css 659626 → 675920（+16294，main.js −6126）；`check:css` 唯一类 3575 → 3692（+117 全为 `nw-kd-*`），
hex/rgbHsl 保持基线。三份基线均 `--update-baseline --note`。

**采集链路（踩坑）**：Obsidian 1.14.5 的设置面板是**独立 BrowserWindow**（CDP 里那个 `about:blank` page），
插件导航项文字是 `Novel Writer AI`；详情弹窗只能在设置窗口里点 `.nw-kb-book-card` 打开，主窗口同名卡片属于
知识库管理视图。该弹窗模块是懒加载的，源码钩子挂在自己文件里永不执行；`getAllBooks()` 也是 async。
截图需 clip 到 `textContent` 含「概览」的那个 `.modal`。

**文档**：`docs/modules/knowledge-base.md` §3.12；`docs/design/2026-11-16-visual-refactor-standard.md` §5 改 A–I、
§5.1 指标与存量大户表重算（移除本文件 294 处）。

下一轮：`ui/full-writer/wizard-step-renderers.ts`（265 处）与 `ui/monitor-panel-b.ts`（232 处）是新的前两名；
两者都在长流程面板里，需先确认可截图入口再动刀。



### 2026-11-17 第三十五轮：Slice J 新手向导 9 步语义化（nw-wizard-*）

**范围**：`ui/full-writer/wizard-step-renderers.ts`（946 行 / 9 个渲染方法），沿用既有 `nw-wizard-*` 命名空间。

**改动**：42 组含 `nw-u-*` 的 `cls` 组合 + 62 个工具类 token → 约 60 个 `nw-wizard-*` 语义类；`nw-u-*` 与
11 处内联 `style` 字符串清零；新增 `styles-src/30-wizard-steps.css`（约 290 行）。
选择器统一加 `.nw-wizard-content-area ` 前缀——向导区没有 `.nw-scope` 祖先，真实祖先链只有
`.nw-wizard-container` > `.nw-wizard-content-area` > stepContent（`wizard-controller.ts:186/225/246`），
且 TS 里的 `nw-wizard-root` 是死选择器。前缀拿到 (0,2,0) 才能压过 Obsidian 的 `.modal button` / `input[type=text]` (0,1,1)。

**发现的真实缺陷（before 侧）**：`nw-u-*` 对 `<button>` 的 `background`/`color` 被 Obsidian 基础样式压掉，
所有按钮都渲染成**白底黑字**（设计意图是强调紫 / 警告橙），非 button 元素的 bg/color 工具类则正常。
Slice J 按设计意图恢复颜色，因此这类场景的像素差异是**修正**而非回归；非颜色属性逐属性复刻 before 实测值。

**像素快照**（900px 宽、DSF=1；产物在 `D:\nw-dev-vault\_visual-j`，13 个场景）：
story-empty / story-rich / setting-lib / writing-style / outline / chapters / complete 七个场景 **0px**；
fanfic 0.61%（仅保存按钮底色 white→#f6f6f6，次要按钮设计色）；setting-lib-exec 1.39%、entities 2.54%、
entities-done 2.87%、worldview 1.88%、worldview-exec 1.45%——全部只差按钮 color/bg/border，计算样式逐节点 diff 无其他属性差异。

**级联修正（首轮 after 抓到）**：表单分组写成 `display:flex` 会把内部 `input`（inline-block）块化，
丢掉基线留白，同人表单 394.9px → 382px；实体信息 `flex:1 1 auto` 会把内容宽度 352px 撑到 780px；
`nw-disabled-look` 的 `cursor:not-allowed` 被新按钮规则盖成 `pointer`。三处均已修。

**门禁**：`typecheck` 0 错、`lint` 0 错；`check:inline-styles` 通过；`check:utility` 删 11 个零引用工具类，
定义 330 → 319、使用 2824 → 2559；`check:bundle` styles.css 675920 → 684251（+8331）；`check:css` 唯一类 3692 → 3735。
`tests/unit/ui/css-animation-integrity.test.ts` 的断言从 `nw-u-animation-nw-progress-anim` 改为语义类
`nw-wizard-progress-bar`（并断言样式表里该规则带 `nw-progress-anim`）。三份基线均 `--update-baseline --note`。

**文档**：新增 `docs/modules/full-writer-wizard.md` 并登记 INDEX；`docs/design/2026-11-16-visual-refactor-standard.md`
§5 加向导行、§5.1 指标与存量大户表重算（移除本文件 265 处）。

### 2026-11-17 第三十六轮：Slice K 监控面板 B 语义化（nw-monb-*）

**范围**：`ui/monitor-panel-b.ts`（1910 行 / 116 处 `cls` 字面量），新开 `nw-monb-*` 命名空间。

**改动**：62 组含 `nw-u-*` 的 `cls` 组合（65 个唯一串）→ 约 60 个 `nw-monb-*` 语义类；`nw-u-*` 清零；
18 处内联 `style` 字符串改 `el.style.setProperty('--nw-monb-tone'|'--nw-monb-pct', ...)`，
样式表里 `background:var(--nw-monb-tone)`、`width:var(--nw-monb-pct)`；新增 `styles-src/31-monitor-panel-b.css`（约 300 行）。
选择器统一加 `.nw-float-monitor-b ` 前缀——`DraggablePanel` 按 panelId 注入该类（`ui/draggable-panel.ts`），
是真实存在的 (0,2,0) 作用域，不需要第二个容器命名空间。

**关键手法**：`getScoreColorClass()` 返回的 `nw-float-ok`/`nw-float-warn-text`/`nw-float-danger` 只有 (0,1,0)，
所以「带共享色类」的站点（`-overall-value`、`-dim-value--md`、`-section-score`）**不声明 color**，
否则 (0,2,0) 会把它压掉；只有行内给色的站点才加 `--tone` 变体。`nw-svg-block` 3 处 → `nw-monb-chart`。

**像素快照**（330px 宽、DSF=1；产物在 `D:\nw-dev-vault\_visual-k`，12 个场景）：
**全部 0 差异**——diffPx=0、高度完全一致、30 个计算属性 × 786 节点零差异
（body-empty 28/571、completion-summary 72/768、completion-nodata 29/571、completion-detail 113/1204、
divergence-summary 68/763、divergence-nodata 29/571、divergence-detail 109/1192、quality-summary 89/846、
quality-nodata 29/574、quality-detail 180/1768、eval-failure 29/571、eval-failure-detail 32/629）。
采集用 `D:\nw-tmp\snap-k.mjs`（主区 tab 打开面板、`[0]` 选根、清固定布局内联、两段式钉高），diff 用 `D:\nw-tmp\diff-k.mjs`。

**门禁**：`typecheck` 0 错、`lint` 0 错；`check:inline-styles` 通过；`check:utility` 删 20 个零引用工具类
（定义 319 → 299、使用 2559 → 2327）；`check:bundle` styles.css 684251 → 693379（+9128）；
`check:css` 唯一类 3735 → 3788。三份基线均 `--update-baseline --note`。
`tests/unit/ui/monitor-panel-b-{eval-failure,plot-guard,quality-guard}` 的 FakeEl 补 `style` 替身、
断言旧类名 `nw-*-detail` → `nw-monb-detail`（8 文件 32 用例通过）。

**文档**：新增 `docs/modules/monitor-panel-b.md` 并登记 INDEX；`docs/design/2026-11-16-visual-refactor-standard.md`
§5 加面板 B 行、§5.1 指标与存量大户表重算（移除本文件 232 处）。

下一轮（Slice L）：`ui/views/writing-fingerprint-view.ts`（228 处）——指纹库视图，先确认根节点可用的作用域祖先
（视图容器类）再决定 `.nw-fp-*` 前缀；同批可带 `ui/fingerprint-detail-modal.ts`（157 处）一起做，二者共享命名空间。

### 2026-11-17 第三十七轮：Slice L 写作指纹库语义化（nw-fp-*）

**范围**：`ui/views/writing-fingerprint-view.ts`（2037 行 / 228 处工具类）、`ui/fingerprint-detail-modal.ts`（600 行 / 157 处）、
`ui/views/fingerprint-v2-detail.ts`（125 行 / 20 处），合计 405 处 —— 外加 15 行内联 `style`（14 个站点）与 `buildScopeTabStyle`。

**改动**：新增 `styles-src/32-fingerprint.css`（约 760 行，`.nw-scope ` 前缀）；新语义类分两段——外壳沿用既有
`nw-fingerprint-*` 块类（E2E 选择器与 container query 依赖它们，只补声明不改名），内部构件改 `nw-fp-*`
（`-nav-row/-nav-btn`、`-item-*`、`-detail-*`、`-stat-card/-stat-value`、`-sample-card`、`-actions-grid`、
`-modal-btn(--primary)`、`-btn(--plain|--danger|--primary)`、`-dim-*(--status)`、`-metric-*`、`-samples-empty` 等约 90 个）。
`buildScopeTabStyle()` → `buildScopeTabClass()`：页签激活态改 `nw-fingerprint-scope-tab--active` 修饰类。

**三处必须记住的坑**
1. `styles-src/11-fingerprint-and-workbench.css:132/137/142` 的三块布局声明（main-layout 的 `display:flex`、
   left-sidebar 的 300px/240px/400px + 右边框、right-panel 的 `flex:1;padding:16px;overflow-y:auto`）
   **只能写进 11 号文件**：同文件 `:269` 有 `@container (max-width:860px/560px)` 覆盖，若写进 `.nw-scope` 规则，
   (0,2,0) 会压过 container query 造成窄屏回归。首轮截图正是漏了这三块，导致整页高度 2530 → 2331。
2. `KnowledgeBookPickerModal` **不要** `modalEl.addClass('nw-scope')`：`.modal.nw-scope{margin:auto}`
   （`styles-src/22-modal-layout.css:14`）会让弹窗横移 2px；它沿用既有 `nw-kb-picker-*`，本切片不纳入。
3. 视图与详情弹窗原本共用 `nw-fp-samples-empty` 一个类，两处规则合并后视图空态凭空多出 20px padding →
   详情弹窗那份改名 `nw-fp-detail-samples-empty`。

**像素快照**（1440×2600、DSF=1；产物 `D:\nw-dev-vault\_visual-l\{before,after}`、`diff-report.json`，8 个场景）：
probes 逐位对齐（struct 差 0），三视图 rect 差 0；仅剩三类**有意义**的差异：
搜索框 618px（0.031%，旧工具类被 `input[type=text]` 压住从未生效，语义类让 6px 10px / 12px / 4px 真正生效）、
编辑指纹弹窗按钮 3819px（0.53%，旧工具类被 `.modal button` 压成白底黑字，恢复灰底/强调色）、
详情弹窗 9px（0.001%，文字 AA）；`modal-extract`/`modal-picker` 为 0。

**门禁**：`typecheck`/`lint` 0 错；`check:inline-styles` 通过；`check:utility` 删 13 个零引用类
（定义 299 → 286、使用 2327 → 1917）；`check:bundle` styles.css 693379 → 710602（+17223，主要为新增 32 号文件 16887 字节）；
`check:css` 唯一类 3901 → 3902、bytes 710602。三份基线均 `--update-baseline` 并写 note。
测试：`tests/unit/ui/fingerprint-scope-logic.test.ts` 断言 style 串 → 断言类名；
`tests/unit/ui/view-banners-dom.test.ts` 同步 `nw-fp-inject-warn` 结构。

**文档**：新增 `docs/modules/writing-fingerprint.md` 并登记 INDEX；`docs/design/2026-11-16-visual-refactor-standard.md`
§5 加指纹库行、§5.1 指标与存量大户表重算（移除 228 + 157 + 20 处）；`docs/CURRENT.md` 口径同步。

下一轮（Slice M 候选）：`ui/outline-expand-modal.ts`（220 处）——大纲扩写弹窗，可沿用弹窗的 `.nw-scope` 模式；
其次 `ui/prompt-manager-settings.ts`（192 处，设置页需确认祖先作用域）与 `ui/chapter-outline-tree-modal.ts`（177 处）。

### 2026-11-17 第三十八轮：Slice M 大纲智能扩写编辑器语义化（nw-oe-*）

**范围**：`ui/outline-expand-modal.ts`（942 行 / 220 处 `nw-u-*` + 1 处内联 `style`）；
`styles-src/25-outline-expand.css`（Slice M 前仅 67 行，只覆盖 modal/tab/select/word-input/diff-line）；
`styles-src/25-planning-outline-controls.css:185-219`（场景项 `nw-expand-scene-*` / `nw-expand-adopt-*`，35 行）。

**改动**：`25-outline-expand.css` 扩到 395 行，按「外壳 / 右栏编辑器 / 左栏场景项 / 左栏段落项」四段组织 `nw-oe-*`
（`-header/-header-left/-title/-switch/-header-right/-label/-word-wrap/-close/-main/-left/-right/-left-header/-right-header/
-left-title/-left-action/-list/-list-inner/-settings/-settings-title/-enhance-*/-footer/-footer-actions/-empty/-start`；
`-status/-editor-wrap/-editor/-progress/-diff/-diff-col(--orig)/-diff-head/-diff-body`；
`-scene-item(--active|--adopted|--skipped)/-scene-head/-scene-index/-scene-name/-scene-summary/-scene-actions/-scene-expand/-adopt(--on)`；
`-para-item(--selected)/-para-check/-para-body/-para-index/-para-text`）。状态一律用 `--` 修饰类，显隐改 `nw-is-hidden`
（替换 `nw-u-d-none`）；段落项的内联样式（含写死在 style 串里的无效 `hover:`）改成基础类 + `:hover` + `--selected`。
删掉 19 个因此零引用的工具类（定义 286 → 267）。

**三处必须记住的坑**
1. **以 `-` 结尾的类名会被 `\b` 正则误判为零引用**：`.nw-u-b-1px-dashed-background-` 被自动脚本删掉后
   门禁立刻报「引用了未定义的工具类」，实际使用者是 `ui/settings/knowledge-section.ts:203`。
   删除工具类前必须核对 B2 报错，不能只信零引用列表。
2. **弹窗挂在 about:blank 副窗**：截图时 `OutlineExpandModal` 的 `modalEl.ownerDocument` 不是主文档
   （CDP 里有两个 page），`executeCommand` 前必须先
   `page.evaluate(() => { window.activeWindow = window; window.activeDocument = document; })`，否则 `.modal` 定位超时。
3. **after 截图用的是带临时 hook 的构建**：`(window as unknown as { __oeModal?: unknown }).__oeModal = this` 只为注入场景数据，
   提交前已删除；最终 `main.js` 与截图构建只差这一行，渲染不受影响。

**像素快照**（1300×800、6 个场景；产物 `D:\nw-dev-vault\_visual-m\{before,after}` 与 `diff-report.json`）：
PNG 差异 chapter-empty 6px / scene-list 7px / diff 5px / edit 3px（maxDelta ≤9，bbox 全在弹窗左边缘 `x=0` 竖列的抗锯齿），
paragraph-list 与 progress 为 0；探针 struct/style/rect 六场景全 0，`cls` 差 42–63 条均为预期改名。

**门禁**：`typecheck`/`lint` 0 错；`check:inline-styles` 603 → 602（本弹窗那 1 处已消）；
`check:utility` 定义 267 / 使用 1699 / 零引用 0；`check:css` bytes 715979 / 唯一类 3931；
`check:bundle` styles.css 710602 → 715979（+5377）。三份基线均 `--update-baseline` 并写 note。
新增 `tests/unit/ui/outline-expand-modal-contract.test.ts`（5 条源码契约，含「无 `nw-u-*`」「无 `style:`」「`nw-expand-*` 已迁出」）。

**文档**：新增 `docs/modules/outline-expand-editor.md`（8 节模板，含 6 场景验收表与 backlog）并登记 INDEX；
视觉标准 §5 加扩写弹窗行、§5.1 指标与存量大户表重算（移除 220 处）、特异性段补「本弹窗按声明等价保留单类」；
`docs/CURRENT.md` §4 改切片 A–M、§6 口径改 267 / 1699。

下一轮候选：`ui/prompt-manager-settings.ts`（192 处，设置页需先确认祖先作用域与 `.nw-scope` 可用性）、
`ui/chapter-outline-tree-modal.ts`（177 处）、`ui/views/knowledge-base-view.ts`（175 处）。


### 2026-11-17 第三十九轮：Slice N 提示词管理设置语义化（nw-pm-*）

**范围**：`ui/prompt-manager-settings.ts`（1083 行 / 192 处 `nw-u-*` + 15 处内联 `style`；设置页 → 写作 → 提示词模板，
4 个子页签 + 5 个弹窗）；新建 `styles-src/33-prompt-manager.css`（307 行 / 9411 字节）。
子页签外壳 `nw-settings-subtab-bar` / `-subtab(.is-active)` / `-subtab-content`（`styles-src/06-cowrite-missing-and-dark.css:756-792`）
与本页共享类（`nw-modal-footer` / `nw-modal-btn-primary` / `nw-modal-btn-secondary` / `nw-h4-sm` / `nw-stat-muted-mt` /
`nw-action-btn` / `nw-empty-center-muted`）**保持不动**。

**改动**：`nw-pm-*` 按 12 段组织——布局（`layout/sidebar/main`）、分类（`category-list/-btn(--all|--active)`）、
模板列表（`template-list/-item(--selected)/-name/-desc/add-btn`）、徽标（`badge(--custom|--required|--ab)`）、
详情（`detail-header/-title/-meta/-actions/-desc`、`section`、`error`）、按钮（`btn(--danger|--primary|--primary-lg|--push-end)`）、
版本（`version-list/-badge(--active)/-add`）、提示词与变量（`prompt-box/subheading-gap/var-grid/-item/-code/-desc`）、
A/B（`ab-header/-title/-enable/-enable-label/check/test-list/create-btn/test-card(--selected)/-head/-name`、
`status(--draft|--running|--paused|--completed)`、`test-detail/-desc`、`stats-grid`、`winner(--lg)`、`test-actions`、`variant/-title`）、
使用统计（`tab-title/usage-list/-item/-id/-version/-time`）、导入导出（`io-box(--last)/io-desc/file-input`）、弹窗（`textarea/finish-desc`）。
`getStatusStyle()` 改为 `getStatusClass()` 返回修饰类；模板项/分类按钮/A/B 卡/文件输入/textarea 的内联 `style` 全部改类。
删掉 12 个因此零引用的工具类（定义 267 → 255）。

**三处必须记住的坑**
1. **`<button>` 上的单类规则会被 Obsidian 默认样式压掉**：第一轮 after 里分类按钮、`nw-pm-btn--danger`、
   `nw-pm-btn--primary-lg` 全部退回白底黑字（PNG 差 1.1%–1.9%），改成 `button.nw-pm-*`（(0,1,1)）后探针归零。
   设置页没有 `.nw-scope` 祖先，不能靠命名空间前缀提权，这是与 Slice H/L 不同的地方。
2. **`--ab` 徽标要保留 `display:inline`**：「自定义」「必填」旧代码带 `nw-u-d-inline-block`，只有使用记录的
   `A/B A` 没带；统一成 inline-block 会让行高 15.6 → 17px、整页 +3px。按逐项等价保留 inline 并写注释。
3. **TEMP-SNAP-HOOK 不能直接写 `window`**：`vitest` 环境是 `node`，`(window as ...).__pmCtor = ...` 会让单测在
   import 阶段报 `ReferenceError: window is not defined`；调试钩子必须包 `if (typeof window !== 'undefined')`，提交前整段删除。

**像素快照**（900px 宽 harness、viewport 1200×1700、11 个场景；产物 `D:\nw-dev-vault\_visual-n\{before,after}` 与 `diff-report.json`）：
PNG 差异 10 个场景 0px；`templates-detail` 874px（0.138%，maxDelta 8，仅 `y=704` 最底扫描线的容器底边抗锯齿）。
探针 struct/style/rect 11 个场景全 0，`cls` 差 0–50 条均为预期改名。

**门禁**：`typecheck`/目标单测（6 条）通过；`check:inline-styles` 602 → 587（本文件 15 处清零）；
`check:utility` 定义 255 / 引用 255 类 1507 次 / 零引用 0（基线收紧）；`check:css` bytes 724614 / 28663 行 / 唯一类 3994；
`check:bundle` styles.css 715979 → 724614（+8635）。三份基线均 `--update-baseline` 并写 note。

**文档**：新增 `docs/modules/prompt-manager-settings.md`（8 节模板，含 11 场景验收表与 backlog）并登记 INDEX；
视觉标准 §5 加提示词管理设置行、§5.1 指标与存量大户表重算（移除 192 处）、特异性段补 `button.` 前缀决策；
`docs/CURRENT.md` §4 改切片 A–N、§6 口径改 255 / 1507。

下一轮候选：`ui/chapter-outline-tree-modal.ts`（177 处）、`ui/views/knowledge-base-view.ts`（175 处）、
`ui/rendering/context-panel.ts`（173 处）。

### 2026-11-17 第四十轮：Slice O 章节大纲树弹窗语义化（nw-ot-*）

**范围**：`ui/chapter-outline-tree-modal.ts`（1392 行，177 处 `nw-u-*` / 82 个唯一 token、2 处内联 `style`）。

**改动**
- 177 处工具类 → `nw-ot-*`（header/title/actions/search/-search-go/-search-clear/-fulltext-btn/-fulltext/-tree；
  vol-header(+--collapsed)/arrow/vol-hint/vol-num/vol-name/vol-count；overview 五件；chap-row(+--target/--dragging)/drag/chap-num/chap-label/
  row-icon/row-move(+--sm)/add-scene；scene-row/scene-num/scene-label/flag(+--dialogue/--cliffhanger)/scene-del；empty/match-count；
  footer/footer-btn/save；editor-row/edit-input(+--scene)/edit-ok(+--sm)/edit-cancel(+--sm)；warning）。
- 2 处内联 `style` → `cls` + 修饰类：`nw-ot-chap-row--target`（`rgba(245,158,11,0.18)` 底 + 3px 橙左边）、`--dragging`（opacity .4 + accent 半透明底）。
- 新增 `styles-src/34-outline-tree.css`（401 行 / 8342 字节），规则全部 `.nw-scope ` 前缀，9 条按钮规则 `button.nw-ot-*`；
  补 `.nw-scope .nw-is-hidden{display:none}`；删 `styles-src/25-planning-outline-controls.css:5-120` 整块旧 `nw-outline-*`（184 → 67 行）。
- 删 25 个零引用工具类（定义 255 → 230，引用 1507 → 1334）。

**三处坑**
1. `attr: { cls: 'nw-outline-chap-label' }` **不落 class**（Obsidian 只写同名属性）——章标签/场景标签/拖拽手柄四个类的 CSS 从来没生效。改 `cls:` 后
   标签才开始有 `:hover` 与 `cursor:pointer`。
2. 死规则不能原样启用：旧 `.nw-outline-chap-label` 带 `flex:1; padding:2px 4px; border:1px solid transparent`，原样启用会把
   ⭐/💬/🪝 与 ▲▼ 推到行尾、整窗 914→998px。定案只还原非几何声明（cursor/border-radius/:hover、手柄 color/user-select）。
3. 本切片的探针 rect 对比**不可用**：before 那批元素没有 class 属性，探针选择器 `[class], input, button, h3, p, br` 抓不到它们，
   元素数 163→201 / 103→123，按 index 对齐整体错位。几何稳定性改用逐行聚簇统计（`D:\nw-tmp\dbgdiff-o.mjs`）证明。

**验收**：`D:\nw-dev-vault\_visual-o\{before,after}` 8 场景（tree-default / tree-range / tree-dragging / tree-fulltext / tree-no-match /
tree-warning / edit-chapter / edit-scene，弹窗 1020px 宽、viewport 1200×1700）。高度 8/8 完全一致；computed style 差全 0；
PNG 差异只剩三簇——标题栏按钮簇（y=28–58）、页脚按钮簇（y≈867–896）、每行 ⠿ 字色 5–9px，无整行位移。
除 tree-warning 0 px 外，其余 1.247%–4.556%（tree-no-match 因图仅 244px 高、按钮簇占比大）。

**门禁**：`tsc --noEmit` 0 错；`build` 通过（40 个样式源，styles.css 28921 行）；`check:utility` 定义 230 / 引用 1334 / 零引用 0；
`check:css` bytes 729260 / 28922 行 / 唯一类 4008 / hex 168 / rgbHsl 195 / important 24；`check:bundle` styles.css 724614 → 729260（+4646）；
`check:inline-styles` 587 → 585（静态 487 / 动态 98）；新契约测试 `tests/unit/ui/outline-tree-modal-contract.test.ts` 5 用例 +
`mobile-reorder-contract.test.ts` 5 用例全过。

**文档**：新增 `docs/modules/outline-tree-modal.md`（8 节，OT-01..OT-05 全 done）；`docs/modules/INDEX.md` 插「章节大纲树弹窗」行；
视觉标准 §5 加 `nw-ot-*` 行、§5.1 指标与存量大户表重算（移除 177 处）、特异性段补「`attr.cls` 不落 class + 死规则不原样启用」；
`docs/CURRENT.md` §4 改切片 A–O、§6 口径改 230 / 1334。

**下一轮候选**（按 §5.1 存量大户）：`ui/views/knowledge-base-view.ts`（175）、`ui/rendering/context-panel.ts`（173）、
`ui/settings/general-sections.ts`（160）。

### 2026-11-17 第四十一轮：Slice P 知识库主视图语义化（nw-kb-tasks-* / nw-kb-monitor-*）

**范围**：`ui/views/knowledge-base-view.ts`（3267 行）——拆解任务页（统计卡 / 筛选栏 / 任务卡 / 批量工具栏）、底部监控条（图标 / 书名 / 进度 / 排队提示 / 模型名 / 连接圆点 / 设置按钮）、以及零散小件（分类分隔线、书架头、详情加载态、隐藏 file input、导入冲突弹窗）。

**改动**：`nw-u-*` 175 → 0；真内联 `style` 9 → 0（另 2 处 `style: '风格'` 是数据字段）；删 `TASK_STATUS_TONE_STYLES`。
- 统计卡配色从 `TaskStatItem.color` 内联串改为 `tone` 档位枚举（`TaskStatTone` = accent/info/warning/success/danger/muted，类型在 `ui/views/kb-task-panel.ts` 导出），配色落 CSS 修饰类 `.nw-kb-tasks-stat-value--<tone>`；进度条宽度改 `--nw-kb-pct` 变量（先例 `ui/batch-import-modal.ts:784` 的 `--nw-bi-pct`）。
- 新增约 60 个类写进 `styles-src/27-knowledge-base.css` 从 `:2489` 起的段落（约 396 行），`nw-kb-tasks-*` / `nw-kb-task-status(--<tone>)` / `nw-kb-monitor-*`；复用既有 `nw-kb-select`、`nw-kb-book-list-header/-count`、`nw-text-sm-muted`、`nw-btn*`。
- 删 14 个零引用工具类（定义 230 → 216，引用 1334 → 1159）。

**三处坑**
1. **别把改前内联色换成 `--nw-*` 语义 token**：本主题那组 token 已被调淡（`--nw-warning` rgb(212,167,106) ≠ #f59e0b、`--nw-success` rgb(122,171,142) ≠ #2ecc71、`--nw-danger` rgb(212,120,120) ≠ #e74c3c），首轮套上去 `tasks-list` 立刻差 0.41%（maxDelta 99）；按 `rgb()` 字面值逐条复刻后归零。
2. CSS 注释里写出「禁止 transition: all」也会触发 `tests/unit/ui/panel-resizer-and-motion.test.ts:108` 的 `not.toContain('transition: all')`，注释得换措辞。
3. 探针按 index 配对会报假位移：改前统计卡 6 个数值 div 与 5 个状态徽标没有 class、`[class]` 选择器采不到，after 侧多 12 个元素；要按「tag+文本+字号+字重」重配后再比 rect。

**验收**：`D:\nw-dev-vault\_visual-p\{before,after}` 6 场景（tasks-empty / tasks-list / tasks-filter / monitor-running / monitor-paused / monitor-idle），viewport 1400×1000，截 `.nw-kb-tasks-tab`（756 宽）与 `.nw-kb-monitor-bar`（756×48）。**PNG 6/6 全 0 像素差**；探针 35 键 computed style 差全 0、重配后 rect 位移 0。

**门禁**：`tsc --noEmit` 0 错；`build` 通过；`check:utility` 定义 216 / 零引用 0 / 引用 1159；`check:css` bytes 737042 / 唯一类 4058 / rgbHsl 211；`check:bundle` styles.css 729260 → 737042（净 +7782，main.js −2661）；`check:inline-styles` 通过；`npm run test` 959 文件 / 10117 用例（10114 通过 + 3 skipped）。

**文档**：新增 `docs/modules/knowledge-base-view.md`（8 节，P-01..P-04 done、P-05 open）；`docs/modules/INDEX.md` 插「知识库主视图」行；视觉标准 §5 加行、§5.1 指标重算（216 / 1159 / 737042）、清理记录补 Slice P、特异性段补配色陷阱、存量大户表移除 175；`docs/CURRENT.md` §4 改切片 A–P、§6 口径改 216 / 1159。

**下一轮候选**（按 §5.1 存量大户）：`ui/rendering/context-panel.ts`（173）、`ui/settings/general-sections.ts`（160）、`ui/views/book-detail-renderer.ts`（126，与 Slice C/D/E 同族可收尾）。
### 2026-11-17 第四十二轮：Slice Q 上下文监控面板语义化（nw-cp-*）

**范围**：`ui/rendering/context-panel.ts`（961 行）——全屏写作右栏的上下文监控面板：失败模块条、Token 预算提示、压缩截断条（可展开）、智能实体上下文（统计 / 人物 / 关系 / 缺失实体）、场景细纲、同人 OOC 规则、写作规则（必守 / 检查清单 / 文笔风格）、文笔风格编辑链接、渲染异常兜底，以及 `renderCollapsibleCard()` 折叠卡片。

**改动**：`nw-u-*` 173 → 0；真内联 `style` 3 → 0。
- token 预算提示的 `const color = pct > 70 ? '#ff4444' : pct > 50 ? '#ffaa00' : 'var(--text-faint)'` + `style.cssText` → `nw-cp-token-hint` + `--warn`/`--danger` 修饰类（两个 hex 因此从 TS 迁入 CSS，硬编码 hex 计数 168 → 170）。
- 截断详情 `detailsPanel.style.display = 'block'` → `nw-cp-trunc-details--open` 修饰类（CSS `display:none` + `--open{display:block}`）。
- 进度条 `fill.style.width = pct + '%'` → `fill.style.setProperty('--nw-cp-pct', …)`，CSS `width: var(--nw-cp-pct, 0%)`（先例 `ui/batch-import-modal.ts:784` 的 `--nw-bi-pct`），并顺手给 fill 补上 `nw-cp-token-fill` 类（原只有外壳类，变量吃不到）。
- 折叠卡片 `nw-u-d-none` → `nw-cp-is-collapsed`，body 加 `nw-cp-card-body`；CSS 用复合选择器 `.nw-cp-card-body.nw-cp-is-collapsed`（0,3,0）压住 `.nw-context-bar__collapsible-body` 的 padding/line-height。
- 新建 `styles-src/35-context-panel.css`（383 行 / 10818 字节，样式源 40 → 41），规则全部 `.novel-writer-fw-context-panel ` 前缀（0,2,0）；外壳类 `novel-writer-fw-warning`/`novel-writer-fw-muted`/`nw-context-bar__collapsible-*` 保留，`.nw-cp-alert` 只覆盖被删工具类真正生效的五项。
- 删两个死类 `novel-writer-fw-truncation-warning`、`nw-context-fanfic-rules`（全仓零定义）；`nw-ctx-warn-box`（`styles-src/26-cleanup-utilities.css:399`）的声明原样复刻成 `nw-cp-warn-box`。
- 删 31 个零引用工具类（定义 216 → 185，引用 1159 → 988），连锁 4 轮才收敛：`check-utility-classes.mjs` 的零引用列表每次只打印 10 个。

**三处坑**
1. **`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 是真实目录、不是 junction**：`npm run build` 只写仓内产物，`scripts/dev-vault.mjs sync` 的目标又是 `C:\Users\admin\nw-dev-vault`。第一轮 6 张「after」截图其实全是 HEAD 旧代码（DOM 里还是 `nw-u-p-8px-12px` 那批），必须把 `main.js`/`styles.css` 直接拷进 D: 那个目录。
2. **被删的工具类不等于「什么都没写」**：`nw-u-bg-modifier-error-soft` 的声明 `background:var(--background-modifier-error-rgb, 255, 100, 100, 0.1)` 在 computed-value 阶段非法，CSS 规定此时回落 initial（IACVT → `transparent`），于是它一直把外壳 `--nw-warning-bg`（浅色 0.12 / 深色 0.15）压成透明；删掉后告警条恢复浅橙底。
3. before 产物不能用 stash 取（build 会重写 tracked 的 `styles.css`，pop 必冲突），改 `git worktree add D:\nw-tmp\before-q 45b76bfe` + `mklink /J node_modules` 在 worktree 里 build。

**验收**：`D:\nw-dev-vault\_visual-q\{before,after}` 6 场景（01-empty / 02-failed-token60 / 03-truncation-open / 04-entities / 05-rules-style / 06-progress80），面板放进自建 384px 容器截图（`#nw-q-host`）。高度 6/6 一致；struct/style/rect 三类探针差全 0；PNG 5/6 为 0，`02-failed-token60` 差 3.151%（10468 px，全在告警条矩形内，maxDelta 22，无文字重排）——即 IACVT 那条有意修正，闭合图 `D:\nw-tmp\crop-q-alert.png`。

**门禁**：`tsc --noEmit` 0 错；`build` 通过（41 个样式源，styles.css 29659 行）；`check:utility` 定义 185 / 引用 988 / 零引用 0；`check:css` bytes 746349 / 唯一类 4091 / hex 170 / rgbHsl 211 / important 24；`check:bundle` styles.css 737042 → 746349（净 +9307）；`check:inline-styles` 577（静态 486 / 动态 91）；`npx vitest run tests/unit/ui/context-panel-dom.test.ts tests/unit/ui/entity-state-context-refresh.test.ts` 2 文件 / 24 用例通过（新增 4 条语义类契约）。

**文档**：新增 `docs/modules/context-panel.md`（8 节，CP-01..CP-05 全 done）；`docs/modules/INDEX.md` 插「上下文监控面板」行；视觉标准 §5 加 `nw-cp-*` 行、§5.1 指标重算（185 / 988 / 746349）、清理记录补 Slice Q、特异性段补 IACVT 陷阱、存量大户表移除 173；`docs/CURRENT.md` §4 改切片 A–Q、§6 口径改 185 / 988。

**下一轮候选**（按 §5.1 存量大户）：`ui/settings/general-sections.ts`（160）、`ui/views/book-detail-renderer.ts`（126）、`ui/full-writer/scene-outline-controller.ts`（123）。
### 2026-11-17 第四十三轮：Slice R 设置页通用分区语义化（nw-st-*）

**范围**：`ui/settings/general-sections.ts`（1280 → 1257 行）五个分区——`PerformanceSection:35`、`RulesSection:399`、`AboutSection:580`、`RecognitionSection:884`、`SuggestionsSection:1174`；注册见 `ui/settings/section-factory.ts:66/67/73/77/80`。

**改动**：`nw-u-*` 160 → 0；内联 `style` 11 → 0（11 处全是 `attr: { style: '...' }`，改成 `cls:` 语义类）。
- 新建 `styles-src/36-settings-general.css`（380 行 / 9596 字节，样式源 41 → 42），57 个 `nw-st-*` 类：说明文字 `nw-st-lead(--spaced)` / `nw-st-card-spaced` / `nw-st-fs12` / `nw-st-mono` / `nw-st-strong` / `nw-st-muted-nowrap` / `nw-st-meta`；标题间距 `nw-st-heading--flush` / `--spaced` / `--gap` / `--section-first` / `--section`；卡片 `nw-st-card(--center)` / `nw-st-about-card` / `nw-st-about-p` / `nw-st-about-line`；性能页 `nw-st-stat-grid` / `-stat-card` / `-stat-label` / `-stat-value` / `-table` / `-scroll-box(--tall/--mono)` / `-scroll-item` / `-row` / `-duration` / `-log-item`；按钮行 `nw-st-btn-row(--mb24/--end)` 与 `button.nw-st-btn(--primary/--fw500/--danger/--lg/--bg-primary)`、`button.nw-st-banner-btn(--ghost)`；更新横幅 `nw-st-update-banner(-left/-title/-note/-actions)`；提示条 `nw-st-notice(--warning/--success)`；关于页 `nw-st-label` / `-version` / `-info-grid` / `-info-item` / `-info-label` / `-info-value`；只读框 `textarea.nw-st-report-textarea` / `-code-textarea`。
- 按钮与文本框一律元素限定（`button.nw-st-*` / `textarea.nw-st-*`），并对 `.modal button` 补同特异性规则——`.modal button` 是 (0,1,1)，纯类名会被压掉。
- 删 23 个零引用工具类（定义 185 → 162，引用 988 → 828）。

**三处坑**
1. **基类粒度**：11 处内联归并成 3 个基类后，像素验收抓出三处「基类多数派 ≠ 该元素原值」——更新日志按钮底色（`--background-primary` vs 基类 secondary）、横幅 ghost 按钮 `font-weight`（400 vs 基类 600）、报告弹窗按钮行 `flex-wrap`（nowrap vs 基类 wrap）。合并内联样式前先做「声明集」分组，组内不一致的值必须留修饰类，不能取众数硬吞。
2. **性能页截图不可比**：耗时/内存每次运行都不同（`130.10ms` vs `130.00ms`、`71.46 MB` vs `60.92 MB`），首轮 `01-perf-data` 差 1322 px 全是数据噪声；改用确定性种子（`perf.importLog(JSON.stringify(entries))` + `Object.defineProperty(performance,'memory',…)` + 固定 `peakMemory`/`memorySamples`）后归零。设置分区还有 `settingsTab.panelCache`，每场景前必须 `clear()`，否则 perf-on / perf-off 截到同一份 DOM。
3. **设置弹窗不在主 document**：`app.setting.open()` 后 `.modal-container` 数为 0；`window.activeWindow/activeDocument` 直接赋值读回是 false，必须 `Object.defineProperty(window,'activeDocument',{configurable:true,get:()=>document})`（activeWindow 同法），Modal 才挂到 `document.body`。改走自建 `<div class="vertical-tab-content nw-settings-root">` 宿主 + `plugin.settingsTab.display()`，才既能走真实渲染路径又能截图。

**验收**：`D:\nw-dev-vault\_visual-r\{before,after}` 8 场景——`01-perf-data` h1810、`02-perf-off` h831、`03-rules` h1238、`04-about` h1547、`05-recognition` h1461、`06-suggestions` h638、`07-banner` 664×67、`08-report-modal` 640×549（宽统一 760）。**PNG 8/8 全 0 像素差**；struct / style / rect 三类探针全 0；cls 差为改名预期。before 产物取自 worktree `D:\nw-tmp\before-r`（`git worktree add <path> HEAD` + `node_modules` junction + build：main.js 5,642,098 / styles.css 775,957），after 为仓内 build（main.js **5,638,584** / styles.css **764,224**，删掉 `services/performance-monitor.ts` 的 `// TEMP-SNAP-HOOK` 后）。

**门禁**：`tsc --noEmit` 0 错；`lint` 0 error / 1103 warning；`build` 42 个样式源 / styles.css 30017 行；`check:inline-styles` 566（静态 475 / 动态 91）；`check:utility` 定义 162 / 引用 828 / 零引用 0；`check:css` bytes 754868 / 唯一类 4125 / hex 170 / rgbHsl 213 / !important 24；`check:bundle` main.js 5638584 / styles.css 754868（746349 → 754868，净 +8519）；`check:silent-failures` 基线 191 → 188（三处装饰性 catch 补 `silent-ok`）；`npx vitest run settings-sections-dom settings-no-duplicate-render settings-framework-wiring metrics-format` 4 文件 / 53 用例通过。

**文档**：新增 `docs/modules/settings-general.md`（8 节，SG-01..SG-05 全 done）；`docs/modules/INDEX.md` 插「设置页通用分区」行；视觉标准 §5 加 `nw-st-*` 行、§5.1 重算（162 / 828 / 754868）、清理记录补 Slice R 删 23、特异性段补「基类粒度」、存量大户表移除 160；`docs/CURRENT.md` §4 改切片 A–R、§6 口径改 162 / 828。

**下一轮候选**（按 §5.1 存量大户）：`ui/views/book-detail-renderer.ts`（126）、`ui/full-writer/scene-outline-controller.ts`（123）、`ui/settings/knowledge-section.ts`（108）。
### 2026-11-17 第四十四轮：Slice S 书籍详情渲染语义化（nw-kb-detail-* 续）

**范围**：`ui/views/book-detail-renderer.ts`（2215 → 2206 行）剩余三块——`renderGenreInfo:833`（题材分类卡 + 分类建议 Top3 + 次要题材标签）、`renderQualityChart:954`（12 维评分雷达 + 分数条）、`renderBookTagsTab:2082`（题材/技法/自定义标签增删 + 空态）；文件里 Slice C/D/E 已建 `nw-kb-detail-*` 命名空间，本轮沿用而不新开前缀。

**改动**：`nw-u-*` 126 → 0；内联 `style` 3 → 0。
- 卡片复用既有 `.nw-kb-detail-card`（p10 / secondary / r6）与 `.nw-kb-detail-card--xl`（p16 / secondary / r8），正好等于旧工具类 `nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px`；新增 `-card-header/-card-title/-card-actions/-field/-field-label/-field-value/-confidence`、`-rec-section/-rec-title/-rec-row(-main/-rank/-name/-bar)`、`-subgenres/-subgenre-list/-subgenre-tag`、`-quality(-radar/-scores/-overall/-overall-value/-overall-label/-score/-score-top/-score-name/-score-na/-score-bar)`、`-tag-group(--spaced)/-tag/-tag--custom/-tag-del/-tag-add/-tag-input`，共 35 个新类（含修饰类）。
- 两处进度条 fill 合并成 `nw-kb-detail-bar-fill`（`width: var(--nw-kb-detail-pct, 0%)`，JS 改 `style.setProperty('--nw-kb-detail-pct', …)`）；**刻意不复用** `.nw-kb-detail-meter-fill`，因为它自带 `transition: width 0.3s`，旧内联没有，复用会引入补间。
- 标签输入框改 `cls: 'nw-kb-detail-tag-input'`，CSS 选择器必须写 `input[type='text'].nw-kb-detail-tag-input`（`input[type=text]` 是 (0,1,1)，纯类名压不住）。
- 规则追加到 `styles-src/27-knowledge-base.css`（不新建 37 号文件，避免同模块两套前缀），「Slice S」段从 `:2887` 起 246 行 / 5445 字节；把只此一处使用的 `.nw-rec-row` / `:hover` 从 `styles-src/26-cleanup-utilities.css` 折进 `-rec-row` 并删旧规则（−6 行）。
- 删 18 个零引用工具类（定义 162 → 144，引用 828 → 702）：`nw-u-ai-flex-start, nw-u-brd-12px, nw-u-brd-3px, nw-u-c-interactive-accent, nw-u-fs-36px, nw-u-fwt-400, nw-u-fwt-700, nw-u-h-6px, nw-u-lh-1, nw-u-marginleft-4px, nw-u-minw-320px, nw-u-p-4px-12px, nw-u-p-6px-8px, nw-u-paddingtop-12px, nw-u-transition-background-0-15s, nw-u-w-16px, nw-u-w-60px, nw-u-w-80px`。

**三处坑**
1. **死类按意图补真就是像素差异**：被删的 `nw-flex-shrink-0`（全仓零定义）与 `nw-text-muted-11`（零定义）在旧 DOM 里等于没写，本轮按本文件 `:821-826` 的既有先例（`addInfoItem` 注释）补成真声明——4 个字段 label 的 `flex-shrink:0`、3 个置信度百分比 span 的 11px / muted。于是 `01-genre` 出现 610 px（0.274%）差异：百分比字号 13 → 11px、行高 16.9 → 14.3、颜色 rgb(34,34,34) → rgb(92,92,92)、rect 31×17 → 26×14，其余三场景 0 差。判为有意修正，闭合图 `D:\nw-tmp\crop-s-genre.png`。
2. **知识库视图会以 DeferredView 恢复**：`getLeavesOfType('novel-writer-knowledge-base')[0].view` 有时拿到的是只有 base 方法的空壳（`view.constructor.name === 't'`），`view.bookDetailRenderer` 为 undefined；循环里必须先 `await leaf.loadIfDeferred()`，仍不是真视图再 `await leaf.setViewState({type:'novel-writer-knowledge-base', active:true})` 强制加载。该失败是间歇性的，同一脚本重跑就过。
3. **题材 id 必须从真实知识库取**：手写 `'xianxia' / 'xuanhuan' / 'dushi'` 在 `kb.getGenre()` 里返回 undefined，次要题材标签与分类建议会渲染成空、验收等于没测；改成 `kb.getGenresByCategory('male')` + `kb.getSubGenres(g1.id)[0]` 才测到真名（`shared/webnovel-knowledge-base.ts:2666/2695/2705/2717`）。

**验收**：`D:\nw-dev-vault\_visual-s\{before,after}` 4 场景（`01-genre` 720×308 / `02-quality` 720×405 / `03-tags` 720×279 / `04-tags-empty` 720×259，宿主 `#nw-s-host` 720px 宽）。高度 4/4 一致；`02/03/04` PNG 0 px、探针 struct/style/rect 全 0；`01-genre` 610 px（0.274%，bbox [109,64,162,122]，maxDelta 212，上述有意补真）、struct 0 / style 25 / rect 3。before 取自 worktree `D:\nw-tmp\before-s`（de9baf17 + node_modules junction + build：main.js 5,638,584 / styles.css 784,833），after 为仓内 build（**5,637,137 / 759136**）。

**门禁**：`tsc --noEmit` 0 错；`build` 42 个样式源 / styles.css 30240 行；`check:inline-styles` 563（静态 472 / 动态 91）；`check:utility` 定义 144 / 引用 702 / 零引用 0；`check:css` bytes 759136 / 唯一类 4142 / hex 170 / rgbHsl 213 / !important 24；`check:bundle` main.js 5637137 / styles.css 759136（754868 → 759136，净 +4268）；`npx vitest run book-detail-renderer-tabs book-detail-renderer-tabs2 book-detail-logic book-detail-metrics` 4 文件 / 69 用例通过。`npm run preflight` EXIT=0（959 文件 / 10118 通过 + 3 skipped）。

**文档**：新增 `docs/modules/book-detail.md`（8 节，SS-01..SS-05 全 done）；`docs/modules/INDEX.md` 插「书籍详情渲染」行；视觉标准 §5 加 `nw-kb-detail-*` 续行、§5.1 重算（144 / 702 / 759136）、清理记录补 Slice S 删 18、特异性段补「输入框特异性 + 别复用带动效的类」、存量大户表移除 126；`docs/CURRENT.md` §4 改切片 A–S、§6 口径改 144 / 702。

**下一轮候选**（按 §5.1 存量大户）：`ui/full-writer/scene-outline-controller.ts`（123）、`ui/settings/knowledge-section.ts`（108）、`ui/polish-editor.ts`（104）。


### 2026-11-17 第四十五轮：Slice T 场景细纲面板语义化（nw-so-*）

**范围**：`ui/full-writer/scene-outline-controller.ts`（1209 行，CRLF）——123 处 `nw-u-*` + 5 处内联 `style` + 1 处 `getStatusColor()` 内联串。挂载点 `ui/full-writer/step-render-controller.ts:603-605`。

**改动**
- 新建 `styles-src/37-scene-outline.css`（275 行 / 6034 字节，样式源 42 → 43），前缀 `nw-so-*`（42 个类，TS 与 CSS 两个集合完全相等，零死类/零缺类）。作用域统一 `.nw-scene-outline-container`；唯一例外是早退空态 `nw-so-empty`（挂在根之外，单列一条）。
- 5 处内联三元改语义类：场景卡 → `nw-so-item` + `--active` / `--dragging`；状态圆点 → `nw-so-dot--completed` / `--in-progress`（`getStatusColor` → `getStatusClass`）；卡名/情绪弧线 → `nw-so-item-name` / `nw-so-item-arc`（选中态由 `.nw-so-item--active .nw-so-item-name` 提供）；页签按钮 → `nw-so-tab` + `--active`。
- 头部 `nw-so-header` 与编辑器工具栏 `nw-so-toolbar` 旧声明逐条相同，合并成一个选择器组。
- 删掉 16 个只有本文件在用的零引用工具类：`nw-u-brt-1px-solid-background-m, nw-u-fd-column, nw-u-fs-0-78em, nw-u-fs-0-82em, nw-u-fs-0-85em, nw-u-fs-0-8em, nw-u-fs-0-95em, nw-u-fs-0-9em, nw-u-fsh-0, nw-u-minh-0, nw-u-minw-0, nw-u-p-20px-10px, nw-u-p-40px-20px, nw-u-p-8px-10px, nw-u-p-8px-12px, nw-u-w-180px`（定义 144 → 128、使用 702 → 579）。

**两处「照字面复刻会出错」的坑**
1. **非法内联声明**：旧场景卡非选中分支写 `background: var(--background-secondary) hover: var(--background-modifier-hover);`，`hover:` 不是合法属性名 → 整条声明在解析阶段被丢弃，所以非选中卡从来没有底色、也没有 hover。按实际渲染复刻（不设 background、不加 `:hover`），否则每张卡都会变灰。
2. **行对齐差异**：基础字段行来自 `nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-m-10px-0`，冲突页那行是 `nw-u-d-flex nw-u-gap-12px nw-u-m-10px-0`（无 `ai-center`）。基类给了 `align-items:center` 后，`--gap12` 修饰类必须显式写 `align-items: normal` 还原 stretch——首轮 diff 的 probes 报 `align-items normal → center`（像素 0 差但语义不等价），补上后归零。

**验收**：`D:\nw-dev-vault\_visual-t\{before,after}` 6 场景（宿主 `#nw-t-host` 720×640）：`01-no-project`（30 元素）、`02-empty-scenes`（17）、`03-list-basic`（116）、`04-conflict`（78）、`05-foreshadow-dirty`（75）、`06-basic-key`（120）。**PNG 6/6 全 0 px**；probes struct/style/rect 全 0（唯一差异是 cls 改名，预期内）。before 取自 worktree `D:\nw-tmp\before-t`（43b17789 + node_modules junction + build：main.js 5,637,189 / 788,324 字节）。

**门禁**：`tsc --noEmit` 0 错；`build` 43 个样式源 / styles.css 30500 行；`check:inline-styles` 558（-5）；`check:utility` 定义 128 / 引用 579 / 零引用 0；`check:css` bytes 764628 / 唯一类 4168 / hex 172 / rgbHsl 215 / !important 24（hex 与 rgbHsl 各 +2，因为 #22c55e 与 #f59e0b 从内联迁进 CSS）；`check:bundle` main.js 5635056 / styles.css 764628（759136 → 764628，净 +5492）；`npm run lint` 0 error（1102 warning 存量）。

**文档**：新增 `docs/modules/scene-outline.md`（8 节，SO-01..SO-04 全 done）；`docs/modules/INDEX.md` 插「场景细纲面板」行（在「规划 / 大纲」之前）；视觉标准 §5 加 `nw-so-*` 行、§5.1 重算（128 / 579 / 764628）、清理记录补 Slice T 删 16、特异性段补「非法声明 + align-items 差异」、存量大户表移除 123 并重排为 3 行 5 项；`docs/CURRENT.md` §4 改切片 A–T、§6 口径改 128 / 579。

**方案 B 收尾**：R/S/T 三连到此结束。剩余 52 个文件里的长尾（26 个文件各 ≤4 处）按「碰哪改哪」处理，`check:utility` 的 C 项（定义数/使用量只许下降）就是新增 `nw-u-*` 的门禁，不再单独加 lint 规则。

**下一轮候选**（按 §5.1 存量大户）：`ui/settings/knowledge-section.ts`（108）、`ui/polish-editor.ts`（104）、`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。若继续走视觉重构，建议先做 `knowledge-section`（设置页，与 Slice R 同宿主、脚手架可复用）。

### 2026-11-17 第四十六轮：Slice U 知识库设置分区语义化（nw-st-kb-*）

**范围**：`ui/settings/knowledge-section.ts`（788 行，CRLF，`class KnowledgeSection extends SettingsSection` `:31`，注册于 `ui/settings/section-factory.ts:70`）——108 处 `nw-u-*` + 11 处 `attr: { style }` 内联样式 + `statusColors` 表与两处动态内联色。

**改动**
- 新建 `styles-src/38-settings-knowledge.css`（311 行 / 7130 字节 / 47 个 `nw-st-kb-*` 类，样式源 43 → 44），**不套 `.nw-scope`**（与 Slice R 同：设置页整体不在 scope 容器内），按钮/输入框/下拉全部元素限定（`button.` / `input[type='text'].` / `select.`）。
- 分区结构：加载态 `nw-st-kb-loading`；工具条 `nw-st-kb-toolbar` + 按钮行 `nw-st-kb-actions`（首个按钮 `--primary --fw500`，其余纯 `-btn`）；筛选条 `nw-st-kb-filters` + `-search-row` / `-search-input` / `-status-select` + `-tag-row` / `-tag-filter` / `-tag-label`；空态 `-empty` / `-empty-icon` / `-empty-text`；计数 `-count`；网格 `-grid`；卡片 `-card` / `-card-actions` / `-mini-btn`(+--danger) / `-card-title-row` / `-card-name` / `-card-author` / `-badge`(+四态) / `-tags` / `-tag`(+--more) / `-meta`；向量区 `-vector` / `-vector-title` / `-dot`(+四态) / `-status-text`(+四态)。
- `getStatusBadge()` 的 `{label,color,bg}` 表改成 `{label,tone}` + 修饰类；连接状态删 `statusColors` 表，`updateStatusDisplay()`（`:723`）与首渲（`:779-785`）都只改 `className`。
- 书籍卡**保留外壳** `.nw-kb-book-card`（`styles-src/27-knowledge-base.css:376`）：旧的 `nw-u-p-14px` 因源序（10 号文件在前）本就输给它的 `padding:12px`，所以 `nw-st-kb-card` 只写 `position:relative; overflow:hidden`；`-card-actions` 只写定位，opacity 0 与 hover 过渡留给 `.nw-kb-book-card .nw-kb-card-actions`。
- 删 25 个只有本文件在用的零引用工具类：`nw-u-b-1px-dashed-background-, nw-u-brd-10px, nw-u-fs-48px, nw-u-gtc-repeat-auto-fill-minma-4, nw-u-lh-1-4, nw-u-m-10px-0, nw-u-marginright-8px, nw-u-margintop-2px, nw-u-maxh-500px, nw-u-op-0, nw-u-op-0-5, nw-u-p-14px, nw-u-p-2px-8px, nw-u-p-4px, nw-u-p-60px-20px, nw-u-p-6px-10px, nw-u-paddingright-60px, nw-u-paddingtop-8px, nw-u-pos-absolute, nw-u-pos-relative, nw-u-r-8px, nw-u-t-8px, nw-u-transition-all-0-2s-ease, nw-u-transition-opacity-0-2s-ease, nw-u-z-10`（定义 128 → 103、使用 579 → 471）。

**一处像素验收抓出的回归（已修）**
- 首轮把 `font-weight:500` 写进 `button.nw-st-kb-btn--primary`，`02-empty` 场景报 1 处 style 差（空态「📥 批量导入书籍」按钮 400 → 500）——旧内联里只有工具条那颗导入按钮带 fw500。
- 修法：`--primary` 只管配色，新增 `button.nw-st-kb-btn--fw500`，工具条按钮 cls 改 `nw-st-kb-btn nw-st-kb-btn--primary nw-st-kb-btn--fw500`；改后 7 场景全 0。
- 另一次 `06-vector-doubao` 出现 1 px（maxDelta 3，bbox [47,1193,47,1217]），重截即 0 → 判定为一次性抗锯齿抖动。

**验收**：`D:\nw-dev-vault\_visual-u\{before,after}` 7 场景（宿主 `#nw-u-host`，`vertical-tab-content nw-settings-root` 820px，走 `plugin.settingsTab.containerEl = host; display()`）：`01-loaded`(h1858，5 卡 4 徽标) / `02-empty`(1593) / `03-loading`(1202) / `04-filtered-empty`(1555) / `05-vector-openai`(1600，2 卡 connected) / `06-vector-doubao`(1600，1 卡 disconnected) / `07-vector-qwen`(1600，1 卡 checking)。**PNG 7/7 = 0 px**；probes struct/style/rect 全 0。before 取自 worktree `D:\nw-tmp\before-u`（2fcc6332 + node_modules junction + build）。

**门禁**：`tsc --noEmit` 0 错；`build` 44 个样式源 / styles.css 30786 行（check:css 口径 30787）；`check:inline-styles` 547（静态 466 / 动态 81）；`check:utility` 定义 103 / 引用 471 / 零引用 0；`check:css` bytes 770834 / 唯一类 4190 / hex 172 / rgbHsl 218 / !important 24；`check:bundle` main.js 5632022（-3034B）/ styles.css 770834（764628 → 770834，净 +6206）；`npm run preflight` EXIT=0（959 文件 / 10118 通过 + 3 skipped）。

**文档**：新增 `docs/modules/settings-knowledge.md`（8 节，SK-01..SK-05 done / SK-06 backlog）；`docs/modules/INDEX.md` 插「知识库设置分区」行（在「规划 / 大纲」前）；视觉标准 §5 加 `nw-st-kb-*` 行、§5.1 重算（103 / 471 / 770834）、清理记录补 Slice U 删 25、特异性段补「基类别吞字重 + 别重复外壳类几何」、存量大户表移除 108 并重排为 2 行 4 项；`docs/CURRENT.md` §4 改切片 A–U、§6 口径改 103 / 471。

**下一轮候选**（按 §5.1 存量大户）：`ui/polish-editor.ts`（104）、`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。

### 2026-11-17 第四十七轮：Slice V 文笔润色编辑器与 AI 润色弹窗语义化（nw-pe-*）

**范围**：`ui/polish-editor.ts`（830 行，LF）——104 处 `nw-u-*` + 3 处内联 `style`（编辑区 10 条声明整串、图例 `${color}22`/`${color}44`、结果态/加载态各 1 处）+ 条件工具类三元串。用户 m09227 要求「按顺序直接做完全部」，本轮（V）→ W `refill-modal`(97) → X `kb-stats-panel`(81) → Y `deconstruction-section`(47)。

**改动**
- 新建 `styles-src/39-polish-editor.css`（286 行 / 5842 字节 / 47 个类，样式源 44 → 45），前缀 `nw-pe-*`；编辑区不带 `.nw-scope`（全屏写作视图已在 scope 内），弹窗侧说明文字用 `.nw-scope .nw-pe-hint*`。
- 结构类：`nw-pe-divider` / `-header` / `-title-group` / `-title` / `button.nw-pe-btn` / `-status` / `-legend` + `-legend-item--char|--loc|--faction|--item` / `.novel-writer-polish-editor.nw-pe-editor`；面板 `-panel` / `-panel-header` / `-panel-title` / `button.nw-pe-close-btn` / `-overview` / `-text--warning|--success` / `-block` / `-subtitle` / `-suggestion` / `-detail` / `-seg-row`(+--issue) / `-seg-icon` / `-seg-type` / `-seg-metric`(+--warning|--error|--success) / `-seg-issue` / `-empty-text` / `-style-content` / `-style-heading` / `-style-pref` / `-style-avoid` / `-style-item` / `-style-line`；弹窗侧 `-hint`(+--tight|--section|--below) / `-muted` / `-checkbox` / `-toggle-label`。
- 图例四项保留**字面 8 位 hex**（`#e74c3c22` / `#e74c3c44` 等 12 个字面色）：改 `color-mix` 会因 `0x22/255=13.3%` 取整差 1~2 色阶，像素归零只能照搬。
- `legendItems` 由 `[label, color, type]` 改 `[label, tone]`；条件配色（拖沓段/密度/紧张度/问题行）全部改修饰类；删 7 处 `attr: {}`；`nw-rhythm-panel` / `nw-style-panel` 只是 JS 移除钩子、CSS 零定义，原样保留。
- 删 19 个零引用工具类（`nw-u-bordercolor-background-modifier-bo, nw-u-c-text-error, nw-u-c-text-success, nw-u-lh-1-6, nw-u-m-0, nw-u-m-16px-0-12px-0, nw-u-m-1px-0-1px-8px, nw-u-m-2px-0, nw-u-m-4px-0-8px-0, nw-u-m-6px-0-0-0, nw-u-m-6px-0-2px-0, nw-u-m-8px-0, nw-u-m-8px-0-4px-0, nw-u-marginbottom-4px, nw-u-maxh-200px, nw-u-minw-16px, nw-u-minw-60px, nw-u-p-1px-6px, nw-u-p-2px-10px`，定义 103 → 84、使用 471 → 367）。

**发现的产品缺陷（未修，记 PE-06 backlog）**
- `PolishAIPolishModal` 的私有字段 `selection: string` 与 Obsidian `Modal.open()` 写回的选区字段**同名**：`open()` 之后 `this.selection` 变成 DOM Selection，`renderInputForm` 抛 `TypeError: this.selection.trim is not a function`。HEAD 上同样存在，截图脚手架用 `Object.defineProperty(m,'selection',{get/set 只接受 string})` 绕过，未改产品代码。

**验收**：`D:\nw-dev-vault\_visual-v\{before,after}` 8 场景（宿主 `#nw-v-host` 720px；弹窗截 `.modal` 560px）：`01-editor`(720×398) / `02-rhythm`(720×670) / `03-style`(720×705) / `04-style-empty`(720×495) / `05-modal-form`(560×490) / `06-modal-form-sel`(560×469) / `07-modal-loading`(560×165) / `08-modal-result`(560×572)。**PNG 8/8 = 0 px**；probes struct/style/rect 全 0；另用 `diag-v.mjs` 做 0.01px 几何复核（rect/scroll/box + 14 项计算样式）8 场景 0 差。before 取自 worktree `D:\nw-tmp\before-v`（432fb696 + node_modules junction + 补同一钩子 + build）。

**像素验收的判定经验（重要）**
- 首次 after 采集在 `02`(1px) / `03`(88px) / `05`(226px) / `06`(137px) 出现 1px 边缘差异，全部落在元素边界行/列；重采后 8/8 归零，且「同一构建两次采集」互差同样是 226px → 判定为新开 Obsidian 首轮启动状态影响边缘合成像素，**不是**重构建引入的。结论：像素验收要重采一次，稳定复现才算真差异。

**门禁**：`tsc --noEmit` 0 错；`build` 45 个样式源 / styles.css 31072 行（check:css 口径 31054）；`check:inline-styles` 542（静态 465 / 动态 77，-5）；`check:utility` 定义 84 / 引用 367 / 零引用 0；`check:css` bytes 775975 / 唯一类 4218 / hex 184（+12 图例字面色）/ rgbHsl 219（+1 问题行底色）/ !important 24；`check:bundle` main.js 5630471（-1551）/ styles.css 775975（770834 → 775975，净 +5141）；`preflight` EXIT=0（959 文件 / 10118 通过 + 3 skipped）。

**文档**：新增 `docs/modules/polish-editor.md`（8 节，PE-01..PE-05 done / PE-06 backlog）；`docs/modules/INDEX.md` 插「文笔润色编辑器 / AI 润色弹窗」行（在「规划 / 大纲」前）；视觉标准 §5 加 `nw-pe-*` 行、§5.1 重算（84 / 367 / 775975）、清理记录补 Slice V 删 19、特异性段补三条（字面 hex vs color-mix、Modal.open 覆写字段、像素验收重采）；存量大户表移除 104 并重排为 2 行；`docs/CURRENT.md` §4 改切片 A–V、§6 口径改 84 / 367。

**下一轮候选**：`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。

### 2026-11-17 第四十八轮：Slice W 补全拆解 / 重新提取指纹弹窗语义化（nw-rf-*）

**范围**：`ui/refill-modal.ts`（650 行，LF）——97 处 `nw-u-*` + 14 处内联 `style`（维度卡 `transition:all 0.2s`、取消/开始按钮背景与透明度、进度条 `width`、徽标 `rgba(var(--…-rgb),0.15)`、维度状态 `color`）+ `getCompletenessBadge()` / 维度状态的颜色表。用户 m09227「按顺序直接做完全部」的第二站。

**改动**
- 新建 `styles-src/40-refill-modal.css`（277 行 / 6330 字节 / 39 个选择器，样式源 45 → 46），前缀 `nw-rf-*`；整体挂在 `.nw-scope` 下（`onOpen()` 给 `modalEl` 加类），按钮写 `.nw-scope button.nw-rf-btn`。
- 结构类：`nw-rf-title` / `-completeness-row` / `-field-label` / `-badge`(+ `--green|--yellow|--red`) / `-section`(+ `--alt`) / `-section-title` / `-option-row` / `-mode-row` / `-flex1` / `-option-label` / `-option-desc` / `input.nw-rf-check`(+ `--sm`) / `input.nw-rf-radio` / `-dim-section` / `-dim-grid` / `-dim-card`(+ `--selected`) / `-dim-label` / `-dim-status`(+ `--completed|--failed|--missing`) / `-time-line` / `-time-sub` / `-progress`(+ `-message`/`-dim`/`-track`/`-fill`/`-pct`) / `-btn-row` / `button.nw-rf-btn`(+ `--dim`) / `button.nw-rf-btn-primary`(+ `--disabled`)。
- 徽标：`getCompletenessBadge()` 删掉 `colors` 颜色表，改 `cls: \`nw-rf-badge nw-rf-badge--${completeness.level}\``；维度状态删 `statusColor` 表，改 `nw-rf-dim-status--${status}`。
- 进度条：`this.progressBar.style.width` → `style.setProperty('--nw-rf-pct', …)`，CSS `.nw-rf-progress-fill{width: var(--nw-rf-pct, 0%)}`（与 `ui/batch-import-modal.ts` 的 `--nw-bi-pct`、Slice Q 的 `--nw-cp-pct` 同套路）。
- `transition:all 0.2s` 是 lint 硬禁令（`tests/unit/ui/panel-resizer-and-motion.test.ts`），拆成 `background-color 0.2s ease, border-color 0.2s ease`；**代价是 6 张维度卡的 `transition` 计算值从 `0.2s` 变成两属性串**，像素零差异，属有意偏差。
- 单选/复选拆成 `input.nw-rf-check` 与 `input.nw-rf-radio`（后者原本没有 `cursor:pointer`）。
- 删 9 个零引用工具类：`nw-u-bb-1px-solid-background-m, nw-u-bg-background-secondary-a, nw-u-fs-16px, nw-u-gtc-1fr-1fr, nw-u-marginbottom-20px, nw-u-margintop-4px, nw-u-p-12px, nw-u-p-6px-0, nw-u-p-8px-0`。

**一处像素验收抓出的回归（已修）**
- 首版把两个变体的取消按钮都写成 `this.isRunning ? 'nw-rf-btn nw-rf-btn--dim' : 'nw-rf-btn'`，但**指纹变体**的取消按钮旧代码恒为 `background: var(--background-primary)`（只有知识库变体按 `isRunning` 切 `background-secondary`）→ `05-fingerprint-yellow-running` 报 1 处 style 差（`rgb(255,255,255) → rgb(246,246,246)`，PNG 3969 px）。
- 修法：指纹那处恒 `cls: 'nw-rf-btn'`，知识库保留条件修饰类；改后 6/6 归零。**教训：同一组件的不同变体按各自原始声明分别复刻，不要为了「少一个类」合并语义。**

**验收**：`D:\nw-dev-vault\_visual-w\{before,after}` 6 场景（截 `.modal`，均 480 宽）：`01-knowledge-missing`(480×551) / `02-knowledge-all-done`(480×551) / `03-knowledge-running`(480×645) / `04-fingerprint-green`(480×370) / `05-fingerprint-yellow-running`(480×441) / `06-fingerprint-red`(480×370)。PNG **6/6 = 0 px**，probes struct 0 / rect 0、cls 改名差异外只剩 6 张维度卡的 `transition`。首次采集有 523/523/541 px 的 `maxDelta` 6~7 噪声，重采归零（与 Slice V 同一现象）。

**门禁**：`tsc --noEmit` 0 错；`build` 46 个样式源 / styles.css 31322 行；`check:inline-styles` 530（静态 455 / 动态 75，-12）；`check:utility` 定义 75 / 引用 270 / 零引用 0；`check:css` bytes 781932 / uniqueClasses 4249 / hex 184 / rgbHsl 223 / 深度 4；`check:bundle` main.js 5627977 / styles.css 781932；`preflight` EXIT=0（959 文件 / 10118 通过 + 3 skipped）。

**文档**：新增 `docs/modules/refill-modal.md`（8 节，RF-01..RF-05 done）；`docs/modules/INDEX.md` 插「补全拆解 / 重新提取指纹弹窗」行（在「规划 / 大纲」前）；视觉标准 §5 加 `nw-rf-*` 行、§5.1 重算（75 / 270 / 781932）、清理记录补 Slice W 删 9、特异性段补三条（`transition:all` 禁令、变体不能共用条件样式、首轮像素噪声复现）；存量大户表移除 97 并重排为 1 行；`docs/CURRENT.md` §4 改切片 A–W、§6 口径改 75 / 270。

**下一轮候选**：`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。

### 2026-11-17 第四十九轮：Slice X 质量统计面板语义化（nw-ks-*）

**范围**：`ui/views/kb-stats-panel.ts`（155 行 / LF，81 处 `nw-u-*` + 4 处内联 `style`）+ 纯逻辑层 `ui/views/kb-panels-logic.ts`（新增两个枚举型别）。

**改动**
- 根死类 `nw-kb-stats-tab`（CSS 零定义）→ `nw-ks-panel`；全部类换 `nw-ks-*`，规则**追加**到 `styles-src/27-knowledge-base.css` 末尾 192 行（文件 3324 行 / 71965 字节），不新建 41 号样式文件。
- 概览卡：`KbStatsOverviewCard.color: string` → `tone: KbStatsTone`（`'accent' | 'success' | 'info' | 'warning'`），四档配色回 CSS（accent 用 `var(--interactive-accent)`，其余 #2ecc71 / #3b82f6 / #f59e0b）。
- 图例：新增 `KbStatusKey` / `KbStatusLegendItem`，`buildStatusLegendData` 返回 `{label, value, color, status}`；圆点改 `nw-ks-legend-dot--{status}`。**`KB_STATUS_STYLES` 的 `color` 保留**（环图 SVG 由逻辑层直接消费）。
- 进度条：`fill.style.width` → `style.setProperty('--nw-ks-pct', …)`，CSS `width: var(--nw-ks-pct, 0%)`（与 `--nw-bi-pct` / `--nw-cp-pct` / `--nw-rf-pct` 同套路）。
- **刻意不补**旧内联里非法的 `&:last-child{border-bottom:none}`——它在 style 属性里被整条丢弃，图例每行原本都有下边框。

**测试**：`tests/unit/ui/kb-stats-panel.test.ts` 三处选择器改 `nw-ks-panel` / `nw-ks-overview` / `nw-ks-legend-value`；`tests/e2e/obsidian-plugin.spec.ts:1505` `.nw-kb-stats-tab` → `.nw-ks-panel`。`npx vitest run kb-stats-panel kb-panels-logic` → 2 files / 29 通过。

**像素验收**：`D:\nw-dev-vault\_visual-x\{before,after}`，宿主 720 宽（不设高，让 `.nw-ks-panel{height:100%}` 解析成 auto 撑开）：`01-empty` 720×720(51) / `02-full` 720×1421(182) / `03-no-completed` 720×1009(100) / `04-genre-unknown` 720×1421(158) / `05-many-genres` 720×1421(181)。PNG **5/5 = 0 px**；probes struct/style/rect 全 0（仅 cls 改名）。before 来自 `6c5cc8c1` 的 worktree（末尾补 `// TEMP-SNAP-HOOK` → `window.__nwKbStats`）。

**门禁**：`tsc --noEmit` 0 错；`build` 46 个样式源 / styles.css 31493 行；`check:inline-styles` 530→**526**；`check:utility` 75/270→**55/189**（删 20 个零引用类，零引用 0）；`check:css` bytes **784775** / uniqueClasses **4263** / hex **192** / rgbHsl 223 / 深度 4；`check:bundle` main.js **5625961** / styles.css **784775**；`preflight` 见交接快照。

**文档**：新增 `docs/modules/kb-stats.md`（8 节，KS-01..KS-05 done）；`docs/modules/INDEX.md` 插「质量统计面板」行（在「规划 / 大纲」前）；视觉标准 §5 加 `nw-ks-*` 行、§5.1 改 55 / 189 / 784775、清理记录补 Slice X 删 20、存量大户只剩 `ui/settings/deconstruction-section.ts` 47；`docs/CURRENT.md` §4 改切片 A–X、§6 口径 55 / 189。

**下一轮候选**：`ui/settings/deconstruction-section.ts`（47 处，Slice Y）——做完 `nw-u-*` 存量清零，此后长尾按「碰哪改哪」，`check:utility` 的 C 项即为新增禁令门禁。


### 2026-11-17 第五十轮：Slice Y 拆解引擎设置分区语义化（nw-st-dc-*）

**背景**：用户（m09227）「那就按顺序直接做完全部」→ Slice V（polish-editor）→ W（refill-modal）→ X（kb-stats-panel）→ **Y（本切片，最后一站）**。Slice Y 之后 `nw-u-*` 存量清空（46 定义 / 142 次引用均为仍在使用中的类）。

**范围**：`ui/settings/deconstruction-section.ts`（336 行，CRLF）—— 设置页「高级 → 🧬 拆解引擎」：增强级别 / 拆解维度 / 向量增强 / LLM 增强 / 性能 五张卡 + 底部「恢复默认」。

**改动**
- 47 处 `nw-u-*` + 1 处 `attr: { style }` 内联清零；新建 `styles-src/41-settings-deconstruction.css`（1640 字节 / 62 行 / 7 个选择器，样式源 46 → 47），**不套 `.nw-scope`**（设置页整体不在 scope 容器内，同 Slice R/U）。
- 五张卡合并成 `.nw-st-dc-card`（原逐字重复 `nw-u-p-12px-16px nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-marginbottom-16px nw-u-bg-background-secondary`）；卡标题 `-card-title`；说明 `-note` / `-note--warning`；维度网格 `-dim-grid`（`repeat(auto-fill, minmax(180px, 1fr))`）；底部 `-reset-row` + `button.nw-st-dc-reset-btn`（元素限定，旧实现是 inline style）。
- 删 9 个零引用工具类（`styles-src/10-entity-and-utilities.css` 251 → 242 行）：`nw-u-b-1px-solid-background-m`、`nw-u-c-text-warning`、`nw-u-d-grid`、`nw-u-gap-6px`、`nw-u-gtc-repeat-auto-fill-minma-5`、`nw-u-jc-flex-end`、`nw-u-m-0-0-12px-0`、`nw-u-margintop-12px`、`nw-u-p-12px-16px`。

**坑**
1. 八个维度**恒渲染八行**（`ALL_BREAKDOWN_DIMENSIONS.forEach`），改 `enabledDimensions` 只改 toggle 勾选，DOM 元素数与高度完全不变（166 / 1869）——别把「尺寸没变」当数据没注入，要 dump `input[type=checkbox]` 的 checked。
2. 设置分区可绕过整页：`settingsTab.sections.get('deconstruction') || settingsTab.getSection('deconstruction')`（TS private 运行时可达）拿实例后直接 `render(host)`；宿主须带 `vertical-tab-content nw-settings-root nw-settings-tab-content` 三件套，`15-late-fixes.css` 的 `.nw-settings-tab-content .setting-item` 保护才命中。
3. `DIMENSION_DESC` 里的 `style: '分析文笔风格与语言特色'` 是数据字段，grep `style:` 会假阳性。

**验收**：`npx tsc --noEmit` EXIT 0；`npm run build` → 「[styles] 拼接 47 个源文件 → styles.css（31547 行）」；`npx vitest run tests/unit/ui/settings-framework-wiring.test.ts tests/unit/ui/settings-no-duplicate-render.test.ts tests/unit/ui/settings-search.test.ts` → 3 files / 39 通过；像素 `_visual-y` 3 场景 **PNG 3/3 = 0 px**、probes（166 元素）struct/style/rect 全 0（仅 15 个类串改名）。

**门禁**：`check:inline-styles` 526→**525**；`check:utility` 55/189→**46/142**（零引用 0）；`check:css` bytes **786456** / 31548 行 / uniqueClasses **4261** / hex 192 / rgbHsl 223；`check:bundle` main.js **5625149** / styles.css **786456**；`npm run preflight` EXIT=0。

**文档**：新增 `docs/modules/settings-deconstruction.md`（8 节，SY-01..SY-05 全 done）；`docs/modules/INDEX.md` 插「拆解引擎设置分区」行（在「规划 / 大纲」前）；视觉标准 §5 加 `nw-st-dc-*` 行、§5.1 改 46 / 142 / 786456、清理记录补 Slice Y 删 9、新增 Slice Y 特异性段、存量大户表改为「已无存量大户」；`docs/CURRENT.md` §4「切片 A–Y」、§6 口径 46 / 142。

**下一轮**：`nw-u-*` 存量清零，长尾转「碰哪改哪」；剩余工作重心转向内联样式 525 处（`ui/svg-charts.ts` 64、`ui/knowledge-monitor-modal.ts` 40、`ui/fingerprint-blend-modal.ts` 36 …）与硬编码色值 192 处。

### 2026-11-18 第五十一轮：功能缺口 ①「大纲扩写应用写回正文」（缺陷修复）

**背景**：视觉重构 A–Y 收尾后用户（m10190）要求「转向功能实现」；我方盘点出 7 项已核实缺口
（`docs/planning/2026-11-18-feature-gaps.md`），用户选定「按顺序 1→2 连做」。本轮是第 1 项，
也是唯一一处「看起来成功、实际丢结果」的欺骗性交互：`applyResult()` 只弹提示就关窗，
两个入口谁也没取 `getExpandedText()` 写回。

**改动**
- `ui/outline-expand-modal.ts`（990 行，LF）：构造函数新增 `onApply?: (text: string) => void | Promise<void>`；
  底部按钮文案 `this.onApply ? '✅ 写入正文' : '📋 复制到剪贴板'`；`applyResult()` 改 async——
  有回调 `await onApply(expandedText.trim())`，成功发「已写入正文（Ctrl+Z 可撤销）」并关窗，
  抛错发 `showErrorNotice('写回正文失败', { detail })` 且**保持弹窗打开**（AI 长文不能丢）；
  无回调降级 `navigator.clipboard.writeText`，失败同样不关窗。
- `ui/command-ui-executor.ts:676-710`：有选区且 `getSelection() === selectedText` → `replaceSelection`；
  选区已被改动 → 光标处 `replaceRange`；无选区（整章）→ `replaceRange` 覆盖 0..末行并 `setCursor({line:0,ch:0})`。
  顺带把「请先打开 Markdown 编辑器并选中需要扩写的段落」改成「（选中段落可改写该段，不选则按整章扩写）」。
- `ui/co-writing-view.ts:2217-2261`：`onApply` 一律走 `applyProgrammaticEdit(...)`（唯一程序化改写入口，
  刷新快照/高亮/光标/dirty）；直接改 `.value` 不会被 `input` 驱动的自动保存捕获，切章会丢字。
- 选区失效退化策略沿用先例 `ui/expand-text-modal.ts:207-216`。

**测试**：新增 `tests/unit/ui/outline-expand-apply-writeback.test.ts`（6 条，全通过）——有回调→收到 trim 文本并关窗；
同步/异步抛错→不关窗；无回调→写剪贴板并关窗；剪贴板不可用→不关窗；空结果→不回调不关门。
私有字段在单测里必须 `(modal as unknown as { expandedText: string }).expandedText = …`，否则 tsc TS2352。

**实机验收**：`D:\nw-tmp\verify-writeback.mjs`（Playwright `connectOverCDP` + 临时 user-data-dir +
`D:/nw-dev-vault`），5 用例全 PASS：命令面板有选区→替换选区；命令面板无选区→整篇替换；
协同工作台整段选中/部分选中→替换区间且保留尾部上下文；协同无选区→整篇替换。
**坑**：弹窗右侧文本域是 `.nw-oe-right textarea`，只改 `value` 不派发 `input` 事件不会写回 `expandedText`；
命令面板要调 `plugin.commandUiPort.outlineExpand(editor)`（实例名是 `commandUiPort`，`main.ts:1020`）。

**门禁**：`tsc --noEmit` 0 错；`npm run build` 47 源 / styles.css 31547 行 / main.js 5,626,504B；
`check:inline-styles` 525（静态 453 / 动态 72，不变）、`check:utility` 46/142（不变）、`check:css` 786456（不变）、
`check:bundle` main.js 5625149→**5626504**（+1355，新增写回分支与回调）已 `--update-baseline --note`，styles.css 不变；`npm run preflight` EXIT=0。

**文档**：`docs/modules/outline-expand-editor.md` 增 §5.1（5 用例表 + 驱动要点）、OE-05、4 条关键决策、
测试清单新增一行、backlog 删掉「从不落盘」条目并改为两条新待办；`docs/modules/INDEX.md` 该行状态与备注更新；
`docs/planning/2026-11-18-feature-gaps.md` ①标 done 并记录交付；`docs/CURRENT.md` §4 增缺口清单行。

**下一轮**：缺口 ②「全屏写作视图接实时体检」（`ui/full-writer/` 目前对 `live-analysis` 零引用）。

### 2026-11-18 第五十二轮：功能缺口 ②——全屏写作体检条（`nw-fw-*`）

**背景**：缺口清单 ②（用户 m10275 选「按顺序 1→2 连做」的第二项）。改前 `ui/full-writer/` 对 `live-analysis` **零引用**，
实时分析只在协同写作视图；且 `ui/cowrite/live-analysis-controller.ts` 与 `CoWritingView` 强耦合（读 `rightEditor.value`、
`engine.inspectSettingGuard`、`refreshMetrics`/`refreshMonitorPanel`、`tractionEngine`、`tractionContainer`/`warningContainer`、
`volume`/`chapterNum` 共 8 处内部字段），不能直接复用。

**交付**：新增 `ui/full-writer/checkup-bar-controller.ts`（288 行，`FullWriterCheckupController`）——
- `render(container)` 建条 + 首次 `refresh(true)`；`refresh(force)` 走 `EndingTractionEngine.checkTraction(volume, chapterNum)`
  （纯分卷大纲正则解析，**不调 AI**），20s 节流（`MIN_INTERVAL_MS`），步骤完成/手动刷新走 `force`。
- 条内容：🩺 写作体检 / 完成度百分比 / 进度轨道（CSS 变量 `--nw-fw-checkup-pct`）/ 偏离徽标（`--low|--medium|--high`）/
  一句话建议 / 「最近 HH:MM」/ 刷新 + 详情；详情就地展开情节线清单（`--open`）。
- 空态（无项目或无章节）显示「打开章节后自动体检」并禁用按钮；失败只覆盖建议文案（`体检失败：…`）并恢复按钮；
  `seq` token 防切章后陈旧回写；`busy` 期间忽略重复点击。
- 装配 `ui/full-writer-view.ts` 5 处：import `:14`、字段 `:138`、构造 `:871`、渲染 `:1936`（try/catch + `// silent-ok`）、
  `onStepComplete` 强制刷新 `:1391`。
- 样式 `styles-src/42-full-writer-checkup.css`（4240 字节 / 193 行 / 29 个选择器）；模块短名 `fw-` 在视觉标准 §1.3 首次登记。

**坑**：`applyIdle` 里写 `style.setProperty('--nw-fw-checkup-pct', '0%')` 会被 `obsidianmd/no-static-styles-assignment` 判 **error**
（字面量内联样式），`npm run lint` 直接挂；改成修饰类 `nw-fw-checkup-fill--empty`（`width: 0`，靠源码顺序压过变量），
动态百分比仍写 CSS 变量。

**验收**：`tsc --noEmit` 0 错；`npm run lint` 0 error / 1102 warning；`npm run build` 48 源 / styles.css 31740 行 /
main.js 5,632,554B；单测 `tests/unit/ui/full-writer-checkup-bar.test.ts` 八条全绿；
实机 `D:\nw-tmp\verify-checkup.mjs`（临时分卷大纲 + Playwright，连跑两次 `ok:true`）：`progress 0%` / `risk 偏离 中` /
`tip 主线进度滞后：林昭的身世之谜` / `rect [366,870,1309,43]`，详情展开 2 条情节线（主线·活跃 / 副线·活跃），刷新不回空态；
`check:inline-styles` 525、`check:utility` 46/142 均不变；`check:css` 790741 / uniqueClasses 4288、
`check:bundle` main.js 5632554 / styles.css 790741 已 `--update-baseline --note`；`npm run preflight` EXIT=0。

**文档**：新增 `docs/modules/full-writer-checkup.md`（8 节，CW-01..CW-04 全 done）；`docs/modules/INDEX.md` 插行；
视觉标准 §1.3 登记 `fw-`、§5 加行、§5.1 styles.css 改 790741；`docs/CURRENT.md` §4 缺口清单状态；
`docs/planning/2026-11-18-feature-gaps.md` ②标 done 并记录实际做法。

**下一轮**：缺口 ③「发布前错别字 / 标点体检」（纯本地规则 + 接入导出前置检查）。

### 2026-11-18 第五十三轮：功能缺口 ③——发布前文面体检（`nw-precheck-*`）

**背景**：缺口清单 ③（「1→2→3 连做」的第三项）。改前导出弹窗只有「交付检查」（空单元 / 字数 / 作者 / 质控），**没有任何字面体检**，全仓也无错别字检查实现。

**交付**：三块 + 两处接线。
- 引擎 `shared/manuscript-precheck.ts`（纯函数、无 Obsidian 依赖）：`checkManuscriptText` / `checkManuscript«` / `formatPrecheckSummary(report, maxChapters = 3)` / `splitFrontmatter(content): { body, offset }`；7 条规则（错别字 51 对、重复词 2–4 汉字 + 白名单、中英标点混用、连续标点、引号栈配对、省略号、破折号），三档严重度 error / warning / info，单章上限 200 条。
- 弹窗 `ui/manuscript-precheck-modal.ts`（198 行，`ManuscriptPrecheckModal(app, project)`）：摘要条 + 「只看必改项」+ 按章分组列表（徽标 / 文案 / 摘录 / 「第N行 · 列M · 跳到正文」）+ 底部「重新扫描 / 关闭」；点行 `setCursor({ line: line - 1, ch: column - 1 })` → `scrollIntoView` → 关窗。
- 样式 `styles-src/43-manuscript-precheck.css`（2472 字节 / 117 行 / 16 个选择器），全 `nw-precheck-*`，无 `.nw-scope`。
- 命令 `novel-writer-text-precheck`（LONG_ONLY）：`shared/command-ids.ts`、`core/command-registry.ts` 三处、`shared/command-mode-rules.ts`、`ui/command-ui-executor.ts`、`tests/unit/core/command-registry.test.ts` 五处接线。
- 导出接线 `ui/export-manuscript-modal.ts`：「文面体检」开关（默认开）+「查看问题」（叠开体检弹窗，不关导出弹窗）；`exportManuscript()` 在结构检查 Notice 之前把 `formatPrecheckSummary` 拼进 `precheck`，**不阻断导出**。

**坑（两条，都值得记）**
1. **CDP 下 Modal 挂不上**：`executeCommandById` 返回 true，但 `.modal-container` 恒为 0。根因是渲染进程 `app.workspace.activeWindow.document` 为 undefined。必须在**每一次** `page.evaluate` 内、**执行命令之前**重设 `window.activeWindow = window; window.activeDocument = document;`；只在会话开头设一次会被 `openFile` 等操作重置。
2. **styles.css 被 CRLF 虚增**：Windows `core.autocrlf=true` 让 13 份 `styles-src` 检出为 CRLF，`build-styles.mjs` 纯文本拼接把 9,064 个 `\r\n` 带进产物（802,322 vs 790,741），`check:css` / `check:bundle` 假失败。已在 `buildText()` 里 `.replace(/\r\n/g, '\n')` 归一（源文件本身 git 索引是 LF，无 diff），并实测「临时改回 CRLF 的源文件」重构建仍是 793,258。

**验收**：`tsc --noEmit` 0 错；单测 `tests/unit/shared/manuscript-precheck.test.ts` 15 条全绿；实机 `D:\nw-tmp\probe-gap3.mjs` 写临时第4章（「必竟 / 既使 / 我们我们 / 英文逗号 / ，， / ...」6 处）→ 摘要「发现 6 处（错别字 2、重复词 1、中英标点 1、连续标点 1、省略号 1）」、徽标 必改×2 + 待确认×4、点首行后光标 `{ line: 5, ch: 1 }` 且活动文件切到该章、「只看必改项」6 → 2 → 6（摘要不随过滤变）；导出弹窗点「查看问题」叠出体检弹窗、点「导出」的 Notice 同时含结构检查 + 出版检查 + 文面体检三行，随后「✅ 完成已导出 4 章 / 297 字」；`check:inline-styles` 525（453/72）、`check:utility` 46/142 不变；`check:css` 793,258 / uniqueClasses 4,303、`check:bundle` main.js 5,643,485 / styles.css 793,258 已 `--update-baseline --note`；`npm run preflight` EXIT=0。

**文档**：新增 `docs/modules/manuscript-precheck.md`（8 节，MC-01..MC-05 全 done）；`docs/modules/INDEX.md` 插行；视觉标准 §1.3 登记 `precheck-`、§5 加行、§5.1 styles.css 改 793,258；`docs/CURRENT.md` §4 状态；`docs/planning/2026-11-18-feature-gaps.md` ③标 done 并记录实际做法。
### 2026-11-18 第五十四轮：功能缺口 ④——提示词管理器交付级修补（`nw-pm-*` 增补）

**背景**：缺口清单 ④（`docs/modules/prompt-manager-settings.md` §7 四条 backlog）：导入无 dry-run、使用统计无分页/清空、列表选中靠整页重绘且无键盘导航、`render()` 全量重建。

**交付**：
- 导入 dry-run：新增 `shared/prompt-manager-import.ts`（208 行纯逻辑：`isSameTemplate` / `buildPromptImportDiff` / `mergePromptConfigs`）与 `ui/prompt-import-preview-modal.ts`（135 行，`PromptImportPreviewModal`，三按钮「取消 / 覆盖导入 / 合并导入」，合并为主按钮）；`services/prompt-manager.ts` 新增 `parseImportPayload` 与 `importConfig(jsonStr, mode: 'replace' | 'merge' = 'merge')`。合并语义：按 id 优先、同名视为同一模板、版本取并集、`abTestingEnabled` 保留当前值、使用记录按 id 去重后截断 1000。
- 使用统计：`getUsageHistoryPage(offset, limit, templateId?)` → `{ records, total }`（最新在前）、`clearUsageHistory()`；UI 每页 20 条 + 工具条「共 N 条记录 / 🗑 清空记录」+ 页码器「← 上一页 / 第 x / y 页 / 下一页 →」（首末页 disabled），清空走 `OperationConfirmModal`。
- 局部重绘 + 键盘导航：`render()` 只建页签栏与 `contentEl`，`renderActiveTab()` 重绘内容；搜索框 `onChange` 只重绘列表（**修掉每敲一键失焦**）；分类按钮与模板项加 `tabindex="0"` / `role="button"` / `aria-pressed`，`bindListKeyboardNav` 支持 ArrowUp/Down 取模、Home/End、Enter/Space（`activate()` 回调，不用 `el.click()`）。
- 样式：`styles-src/33-prompt-manager.css` 307 行 → 375 行（工具条、分页器、`nw-pm-import-*` 预览弹窗、`:focus-visible` 描边）。

**坑（四条）**
1. **机器上有两份 dev vault**：`D:\nw-dev-vault` 与 `C:\Users\admin\nw-dev-vault`。探针写死 D: 那份，`dev-vault.mjs status` 默认管 C: 那份 → 不同步就会截到旧 UI；必须 `node scripts/dev-vault.mjs sync --vault=D:/nw-dev-vault`。
2. **设置页在独立 CDP page**：Obsidian 1.14.5 的设置窗口是单独 page，`window.app` 不存在（插件实例只能从主 page 取）；tab id 是 `template`，属 advanced 组，需先 `settings.showAdvanced = true` 再 `openTabById('novel-writer-ai')` + `settingsTab.openTab('template')`。
3. **Modal 挂主窗口**：设置弹窗里触发的导入预览 / 清空确认都挂主窗口 `activeDocument`，截图要按标题找宿主 page；每次 `page.evaluate` 内都要重设 `window.activeWindow/activeDocument`。
4. **导入样例的 `category` 必须合法**：`services/prompt-manager.ts` 的 `PROMPT_CATEGORIES` 不含 `scene`，样例写 `scene` 会被整份拒绝（`customTemplates 存在结构不合法的条目`）。

**验收**：`tsc --noEmit` 0 错；单测 `prompt-manager-settings-dom` / `services/prompt-manager` / `shared/prompt-manager-import` / `ui/prompt-import-preview-modal` 四文件全绿；实机 `D:\nw-tmp\probe-n4.mjs --tag=before|after` 八场景——`templates-list` / `templates-detail` / `abtests` **PNG 字节完全相同**，`usage-page1` 688×544→688×622（工具条 + 3 页页码器）、`usage-page2` 页码「第 2 / 3 页」、导入预览弹窗 800×444、清空确认 800×398，键盘 `tabindex=0` + ArrowDown 焦点移位；`check:inline-styles` 525（453/72）、`check:utility` 46/142 不变；`check:css` 795,332 / uniqueClasses 4,318（+15 类）、`check:bundle` main.js 5,651,818（+8,333）/ styles.css 795,332（+2,074），两份基线已 `--update-baseline` 并写明原因。

**文档**：`docs/modules/prompt-manager-settings.md`（状态行、§1 入口、§2 现状、§3 新增 PM-05..PM-08、§4 八条决策、§5.1 验收、§6 测试清单、§7 backlog、§8 交接备注）；`docs/modules/INDEX.md` 行更新；`docs/design/2026-11-16-visual-refactor-standard.md` §5.1 styles.css 改 795,332；`docs/planning/2026-11-18-feature-gaps.md` ④ 标 done；`docs/CURRENT.md` §4 改「①②③④已交付」。

**下一轮**：缺口 ⑤「质量统计状态清单不可交互」（`ui/views/kb-stats-panel.ts` 的 `nw-ks-legend-row` 无 cursor/onclick，点击跳书架并按状态筛选），或按作者挑选 ⑥ TTS / ⑦ i18n。



### 2026-11-18 第五十五轮：功能缺口 ⑤——质量统计状态清单可交互（`nw-ks-*` 增补）

**背景**：缺口清单 ⑤（`docs/modules/kb-stats.md` §7 backlog 第 3 条）：`ui/views/kb-stats-panel.ts` 的状态图例行 `nw-ks-legend-row` 看起来该能点，实际没有 cursor、没有 hover、没有 onclick —— 用户看完「失败 1」想找那本书只能回书架手工筛。

**交付**：
- `KbStatsPanelHost` 新增可选 `onStatusClick?(status: KbStatusKey)`。`actionable = Boolean(host.onStatusClick) && item.value > 0`：成立的行追加 `nw-ks-legend-row--action` + `role="button"` + `tabindex="0"` + `title="在书架中查看「<label>」的 N 本书"`；不成立（0 本）追加 `--idle`，数值转 muted。click 与 keydown（Enter / 空格）走同一个 `activate()` 闭包。
- `ui/views/knowledge-base-view.ts` 新增 `private openBookShelfWithStatus(status)`：切 `activeMainTab='books'`，**先清**频道 / 主题材 / 子题材 / 关键词（否则书架条数会小于图例数字），再设 `filter.status`，然后 `renderLeftSidebar()` + `renderRightPanel()`。
- `styles-src/27-knowledge-base.css` 追加 22 行：`--action`（`padding:10px 8px;margin:0 -8px;border-radius:6px;cursor:pointer;transition:background-color 0.15s ease`）、`:hover` 底色、`:focus-visible` 描边、`--idle .nw-ks-legend-value` 弱化。padding/margin 正负抵消，行高与间距不变。
- 单测新增 4 条（点击回调、Enter/空格触发而普通键不触发、0 本行无 role 且点击无反应、未注入回调时全只读），文件 11 条全绿。

**坑（三条）**
1. **before 构建只能重建**：`main.js` 不在 git 里（`git ls-files main.js styles.css` 只回 styles.css）。拿 before 产物的做法是 `git stash push -- <四个改动文件>` → `npm run build` → 拷 main.js/styles.css 到 `D:\nw-tmp\gap5-before\` → 跑探针 → `git stash pop` → 再 build。忘了 pop 就会以为「改动没生效」。
2. **探针要兼容两侧类名**：只有 after 有 `--action` / `--idle`。第一版探针写死 `locator('.nw-ks-legend-row--action')`，在 before 侧 30s 超时；改成先算 `interactive` 再决定选择器，并且「点完没跳书架时不截书架列表」。
3. **书架条目类名是 `nw-kb-book-card-title`**（`ui/views/kb-book-card.ts:68`），不是 `nw-kb-book-name`；计数条是 `.nw-kb-book-list-count`，文案「共 N 本书籍」。

**验收**（`D:\nw-tmp\probe-gap5.mjs --tag=before|after`，dev vault 注入 6 本种子书：1 待拆解 / 1 拆解中 / 2 已完成 / 1 失败 / 1 中断）
- before：五行 cls 全 `nw-ks-legend-row`，`role/tabindex/title` 全 null，hover `{cursor:'auto', background:'rgba(0, 0, 0, 0)', radius:'0px'}`，点「失败」后 `activeMainTab` 仍 `stats`、`filter.status` 仍 `all`。
- after：五行全 `--action` + `role=button` + `tabindex=0` + title，hover `{cursor:'pointer', background:'oklch(0 0 none / 0.067)', radius:'6px'}`；点「失败」→ `activeMainTab=books`、`filter.status=failed`、下拉 `failed`、「共 1 本书籍」、列表只有「雾港」；首行 `focus()` 后按 Enter → `books` / `pending`。
- 像素：`stats-status.png` 370×431 **0 px**；`stats-status-hover.png` 16857 px（10.571%，bbox y=337-382 即被悬停的那一行）。
- 门禁：`check:css` 795890 B / 31948 行 / uniqueClasses 4320（+2）/ hex 192 / rgbHsl 223 / !important 24 / 深度 4；`check:bundle` main.js 5652503（+685）/ styles.css 795890（+558）/ workers 684381 + 108804；`check:inline-styles` 与 `check:utility`（46 类 / 142 次 / 零引用 0）不变；两份基线已 `--update-baseline` 并写明原因（`check-css.js` 的 `--note` 仍会整体覆盖，脚本外补回旧两行）。
- 全量：\`npm run preflight\` **EXIT=0**（964 个测试文件 / 10171 通过 + 3 跳过；JSDoc 979 文件、测试标准 982 文件、活跃文档 20 个）。

**文档**：`docs/modules/kb-stats.md`（状态行、§1 用户视角与宿主接口、§2 交互小节、§3 KS-06、§4 四条决策、§5 七条验收、§7 删掉该 backlog、§8 三条新坑）；`docs/modules/INDEX.md` 行更新；`docs/design/2026-11-16-visual-refactor-standard.md` §5 行与 §5.1 styles.css 体积；`docs/planning/2026-11-18-feature-gaps.md` ⑤ 标 done；`docs/CURRENT.md` §4 改「①②③④⑤ 已交付」。

**下一轮**：缺口 ⑥「章节朗读（TTS）听校」或 ⑦「i18n」——按作者挑选；若继续做体验补洞，`docs/modules/` 里还有若干 §7 backlog 可复用同一套路（实机 before/after + 像素 diff + 门禁）。

### 2026-11-18 第五十六轮：功能缺口 ⑦——界面文案国际化 i18n（第一期：`t()` + 双语言资源 + 门禁）

**背景**：缺口清单 ⑦ 的证据是「全仓无 i18n 框架，界面文案硬编码中文（500+ 文件）」。实测（node 统计 TS，排除 node_modules/dist）2009 个文件里 2004 个含 CJK，`git ls-files` 2639 个文件，仓里没有任何 `i18n/` 或 `locale/` 目录。用户 m12281「先做7」把它提到 ⑥（TTS）之前。

**交付（4 个新文件 + 6 处改造）**
- `i18n/index.ts`（247 行）：`Locale = 'zh-CN' | 'en-US'`、`SUPPORTED_LOCALES`、`DEFAULT_LOCALE='zh-CN'`、`LOCALE_OPTIONS`、模块态 `activeLocale` / `listeners` / `warnedKeys`；`t(key, params?)`、`translate(locale, key, params?)`（目标语言 → zh-CN → 键名）、`interpolate`（`/\{(\w+)\}/g`，未提供的占位符原样保留）、`resolveLocale` / `detectHostLocale`（只读 `window.localStorage.getItem('language')`，`zh*`→zh-CN / `en*`→en-US / 否则默认）、`setLocale` / `applyLocaleSetting` / `onLocaleChange`、`flattenMessages` / `placeholdersOf` / `getCatalog` / `hasMessage`。缺失键**返回键名 + 每个键只 `console.warn` 一次**，不抛错。
- `i18n/messages/zh-CN.ts` / `i18n/messages/en-US.ts`：`MessageTree = { [key: string]: string | MessageTree }`，两份各 **42 条**（`common` 5 / `settings.group` 6 / `settings.tab` 20 / `settings.shell` 6 / `settings.appearance.language` 5），键与占位符逐条对齐。
- `ui/settings/locale-setting.ts`：`renderLocaleSetting(container, plugin, onChanged)` —— `new Setting().setName(t(...)).setDesc(t(...)).addDropdown()`，`onChange` 里写 `plugin.settings.language` → `applyLocaleSetting()` → `await plugin.saveSettings()` → `onChanged()`；另有 `coalesceLocaleSetting(value)` 收敛非法值。挂在 `ui/settings/writing-sections.ts` 的 `AppearanceSection.render()` 最前面（`onChanged = () => this.reopen()`）。
- `main.ts`：`NovelWriterSettings` 新增 `language?: 'auto' | 'zh-CN' | 'en-US'`；`core/settings-service.ts` 的 `getDefaultSettings()` 加 `language: 'auto'`。
- `engine/engine-registry.ts`：Phase 5 的 `await settingsService.loadSettings()` 之后紧跟 `applyLocaleSetting(plugin.settings.language)` —— 那是设置加载的唯一收敛点（启动路径不走 `plugin.loadSettings()`）。
- `ui/settings/section-factory.ts`：新增 `group(id, labelKey, tabs)` / `tab(id, labelKey, group, create)` 两个构造器，`label` 写成 **getter**（`get label() { return t(labelKey); }`）。理由：`SETTINGS_TAB_DEFINITIONS` 被 `settings-tab.ts` / `mini-settings-modal.ts` / `settings-menu.ts` / `settings-search.ts` / `main.ts` / 单测 6 处消费且类型都是 `label: string`，算成字符串会在切换语言后永久定格。20 个 tab + 6 个 group 全部换成键。
- `ui/settings-tab.ts`：外壳 6 条迁到 `settings.shell.*` —— 标题（`📖 设置` → `📖 Settings`）、搜索占位、搜索空态、`⚙ 高级设置`/`⚙ 收起高级`、`` `未知设置页签：${tabId}` ``（改 `t('settings.shell.unknownTab', { tabId })`）。

**门禁 `scripts/check-i18n.mjs`（新增，已进 preflight）**
- 资源一致性：用 `ts.transpileModule(..., { module: CommonJS })` 把两份 `.ts` 降级后 `new Function('exports','module',code)` 求值（不依赖 node 的 .ts 实验开关），拍平比对键缺失/多余/空文案/占位符不一致。
- 键可解析：扫 `ui`/`engine`/`services`/`shared`/`core`/`domains`/`utils`/`i18n` 共 **1007 个文件**，正则抓 `t('literal')` 与 `translate('en-US','literal')`；不在 zh 资源里的键 → fail。当前 0 个无法解析，2 处动态键（`ui/settings/locale-setting.ts` 的 `t(option.labelKey)`、`ui/settings/section-factory.ts` 的 getter）只 warn。
- UI 中文棘轮：只扫 `ui/**`，用 TS **AST** 数「含 CJK 的 StringLiteral / NoSubstitutionTemplateLiteral / TemplateExpression 的 head+span」，首跑 **269 文件 / 11898 条**；基线 `.i18n-baseline.json` 按路径记 `{files:{path:count}, total, updatedAt, note}`。规则「per-file 只许降不许升」+ 新文件默认允许 0 条；`--update-baseline` 在有失败项时拒绝（除非 `--force`），`--note=` 写说明。迁移后棘轮已收紧到 **269 文件 / 11892 条**。
- `package.json`：`"check:i18n": "node scripts/check-i18n.mjs"`，preflight 里插在 `check:test-standard` 与 `check:changelog` 之间。

**测试（3 个新文件 38 例）**
- `tests/unit/i18n/i18n-core.test.ts`（24）：语言枚举、`normalizeLocaleSetting`、`detectHostLocale`（`globalThis.window = { localStorage: { getItem } }` 桩，含 `getItem` 抛错 → zh-CN）、`setLocale` 订阅/去重/单订阅者抛错不影响他人、`translate` 回退链、缺失键只警告一次、`hasMessage` 不对中间节点命中、`interpolate` 只认自有属性、`flattenMessages` / `placeholdersOf`（排序、重复保留）/ `getCatalog`。
- `tests/unit/i18n/i18n-parity.test.ts`（7）：中英键集合双向相等、每条非空、占位符逐键一致、英文资源不含中文（放行 `settings.appearance.language.zhCN` = `简体中文`，语言自称故意不译）、每个 `SUPPORTED_LOCALES` 键数一致。
- `tests/unit/i18n/settings-locale.test.ts`（7）：**局部 `vi.mock('obsidian')`** 自定义 `Setting` 捕获 dropdown（`tests/__mocks__/obsidian.ts:581` 的全局 `Setting` 走 `addText`，**不保存 onChange 回调**，所以交互只能局部 mock）；验证三选项文案随语言变、切 en 后标题英文、非法值显示 auto、`onChange` 写设置并立即生效、`saveSettings` 先于 `onChanged`（`mock.invocationCallOrder`）、`coalesceLocaleSetting` 容错、每个 `labelKey` 两语言都有非空无占位符文案。
- 回归：`settings-tab-groups` / `settings-sections-dom` / `settings-search` 共 30 例；`npx tsc --noEmit` EXIT=0。

**实机 before/after（zh-CN vs en-US，820×1476）**
- 脚本 `D:\nw-tmp\snap-i18n.mjs --tag=before|after`：直接改写 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai\data.json` 的 `language`（before=`auto`、after=`en-US`）后启动 Obsidian 1.15.1。
- **坑一（承接 Slice R）**：`app.setting.open()` 在 CDP 下拿不到 modal（`.modal-container` 数 0）。必须手工挂载：`div.vertical-tab-content.nw-settings-root`（`position:absolute;left:24px;top:24px;width:820px`）→ `plugin.settingsTab.containerEl = host` → `display()` → `openTab('appearance')` → `refresh()`；还要 `Object.defineProperty(window,'activeDocument',{configurable:true,get:()=>document})`（同理 activeWindow）。
- **坑二**：viewport 要设到 1200×2900 并 clip 到 host 的 box，否则 2757px 高的面板只截到一半。
- 结果：before `📖 设置` / `搜索设置：如「AI 味」…` / 6 个中文分组 pill / `🎨 外观设置 · 🧩 工作台布局` / `界面语言` / `⚙ 收起高级`；after `📖 Settings` / `Search settings, e.g. "AI flavor"…` / `🔌 Connect & Models … 🗂 Projects & Operations` / `🎨 Appearance · 🧩 Workspace Layout` / `Interface language` / `⚙ Hide advanced`，下拉 `Follow Obsidian / 简体中文 / English`。**布局像素级一致**（截图同 820×1476；host box 高 2757→2773，仅英文描述多一行）。产物 `D:\nw-dev-vault\_visual-i18n\{before,after}\settings-appearance.png` + `probe.json`（未入库）。
- 仍中文：设置分区正文（`ui/appearance-settings.ts` 等）、命令面板、写作主流程 —— 属第二期迁移面。

**门禁**：`npm run preflight` **EXIT=0**（967 个测试文件 / 10209 通过 + 3 跳过；JSDoc 980 文件、活跃文档 20 个）；`check:i18n` 通过（zh 42 / en 42、0 个无法解析的键、棘轮 269 文件 / 11892 条）；`check:bundle` main.js 5652503 → **5656950**（+4447，基线已 `--update-baseline` 并写明原因）、styles.css 795890 不变。

**文档**：新增 `docs/modules/i18n.md`（8 节模板，含 I18N-01..07 问题清单、7 条决策、验收表、backlog）；`docs/modules/INDEX.md` 新增行（doing）；`docs/CURRENT.md` §2 加 `i18n/` 目录行、§4 缺口状态、§6 加「ui/ 裸中文不要新增」；`docs/planning/2026-11-18-feature-gaps.md` ⑦ 补「已交付（第一期）」小节并改进度行。

**下一轮**：缺口 ⑦ 第二期（迁命令面板 / 设置分区正文 / 写作主流程 + `Notice`）或缺口 ⑥（TTS 听校）。第二期的两个已知绊脚石：命令名进 `tests/unit/core/command-registry.test.ts` 的期望集合；e2e `tests/e2e/utils/settings-nav.ts:48` 靠 `textContent.includes('高级设置')` 找高级开关，得先改成按类名 `.nw-settings-tab-advanced-toggle`。
### 2026-11-18 第五十七轮：功能缺口 ⑥——章节朗读（TTS）听校

**背景**：缺口清单 ⑥ 的证据是「全仓 `speechSynthesis` 0 引用」；做法写的是「Web Speech 朗读当前章节/选区，可设语速、音色；朗读时高亮当前句；不支持平台降级提示」。用户 m12693「下一步6」在 i18n 第一期交付后把它提上来。实机探针（`D:\nw-tmp\probe-tts.mjs`）先确认：Obsidian 1.15.1 / Windows 上 `hasSynth=true`、`hasUtterance=function`，但 `getVoices()` 首次返回 **空数组**，而 `speak()` 的 `onstart`+`onend` 都触发 —— **不能以「音色为空」判不支持**。

**交付（4 个新模块 + 3 处命令接线 + 设置/i18n/样式）**
- `shared/tts-text.ts`（261 行，纯函数）：`frontmatterEndOffset`（只认文件开头的 `---\n…\n---\n`，含 CRLF）、`cleanForSpeech`（图片丢弃；行内代码去反引号、双链取别名、链接取文字；去 HTML/标题/引用/列表/分隔线/强调/零宽字符，压空白）、`splitSentences(text,{from,to,maxChars=120})`（句末 `。！？…；!?;` + 非数字后的 `.`，换行软边界，收尾符 `”’」』）)】》` 并入前句；超长句先按 `，、,` 切再硬切；空片段丢弃、短残句并入上句）、`offsetToPosition`、`clampRate`（非法→1、夹 0.5–2）、`estimateSpeechMs`（220ms/字 ÷ rate）、`TTS_RATE_OPTIONS=[0.75,1,1.25,1.5,2]`。
- `ui/tts/tts-speech.ts`（163 行）：`createTtsSpeechEngine(synth?)` → `{isSupported, voices, speak, pause, resume, cancel, onVoicesChanged}`，所有 Web Speech 调用 try/catch，`onerror` 取 `event.error`；音色按 `voiceUri` 找不到回系统默认。
- `ui/tts/tts-player.ts`（427 行）：`TtsPlayer` + 单例 `getTtsPlayer(app, plugin)`（`plugin.register` 清理）+ `resetTtsPlayerForTests()`；浮层 `.nw-tts-bar.nw-scope` = 头部（`🎧 听校 · <标题>` + 进度 `1/1417`）+ 控制排（⏮⏸⏭⏹✕）+ 下拉排（语速/音色）；`playChapter` / `playSelection` / `togglePause` / `nextSentence` / `prevSentence` / `stop` / `destroy`；每次起停自增 `session`，迟到 `onEnd` 直接丢弃；高亮用编辑器原生选区 `editor.setSelection` + `scrollIntoView`（`toEditorPosition` 优先 `offsetToPos`，否则从选区起点逐字符数换行）；单句出错提示后跳下一句；编辑器随文件关闭 → `stop()`。
- `styles-src/44-tts-player.css`（127 行）：右下角浮动条（`bottom:24px;right:24px`），`.nw-tts-*` 语义类，颜色全用 Obsidian 变量，`transition` 只写 `border-color`/`background-color`。
- 命令三件：`shared/command-ids.ts:89-93` 新增 `TTS_READ_CHAPTER = 'novel-writer-tts-read-chapter'` / `TTS_READ_SELECTION` / `TTS_STOP`；`core/command-registry.ts` 三处（COMMANDS `:164-166` 的「🎧 听校：…」、`uiCommandIds` `:384-386`、`addCommand` `:576-578`，组 `Tools`、`callback: exec(...)`，不设模式守卫）；`ui/command-ui-executor.ts:688-706` 三个 case + `ttsReadChapter`/`ttsReadSelection`（`resolveEditor` 在 `:681`，缺编辑器时 `showWarningNotice(t('tts.noEditor'))`）。
- i18n：`tts` 子树 **18 条**（title/play/pause/prev/next/stop/close/rate/voice/voiceDefault/progress/unsupported/noEditor/noText/finished/untitled/selection/error），两份资源 42 → **60 条**。
- 设置：`NovelWriterSettings.ttsRate?: number`（默认 `1`）、`ttsVoice?: string`（默认 `''`），下拉变化即 `saveSettings()`。

**实机验收（Obsidian 1.15.1 / Windows，截图在 `D:\nw-dev-vault\_visual-tts\`）**
- 章节模式（1,003,133 字 / 40,546 行、frontmatter 占 39,092 行）：条出现、`1/1417` 句、`speechSynthesis.speaking === true`；高亮 14 字 `# 将夜 - 人设提取报告\n` 落在 **第 39,094 行**（frontmatter 后第一行，证明 frontmatter 跳过生效）；⏭ → `2/1417`；语速改 1.5× 写回设置且重启保留；音色下拉列出 6 个 Microsoft 音色 +「系统默认」（首调为空，`voiceschanged` 后补齐）；停止后条消失、`speaking=false`。
- 选段模式（2,340 字文件选中 80 字）：标题 `🎧 听校 · 选段`、`1/4`、高亮 = 选段第一句。
- 暂停：按钮 `.nw-tts-btn-play` 文本 `⏸→▶`、`speechSynthesis.paused === true`；**Chromium 暂停时 `speaking` 仍为 true**，判暂停只能用 `paused`。
- 几何：条 `y=737.6 h=106.4 → bottom=844`，状态栏 `y=873.2 h=26.8`，间隙 29px 无遮挡。

**坑（都已写进 `docs/modules/tts.md` §8）**
- `scripts/dev-vault.mjs` 认的 vault 是 `C:\Users\admin\nw-dev-vault`，视觉验收用的是 `D:\nw-dev-vault`；`sync` 只写 C 盘，D 盘要手工 `Copy-Item main.js,styles.css,manifest.json,versions.json <D 盘插件目录> -Force`。症状是「命令已进 bundle 但 `app.commands` 里没有」。
- CDP 里命令 id 必须带插件前缀：`app.commands.executeCommandById('novel-writer-ai:novel-writer-tts-read-chapter')`，漏前缀静默失败。
- CDP 里 `window.require('obsidian')` 取不到；用 `app.workspace.getLeavesOfType('markdown')` 找匹配叶子拿 `view.editor`。
- 测试替身 `tests/unit/ui/support/fake-dom.ts` 的 `FakeEl` 原来没有 `value` 与 `remove()/parent`；播放条 `stop()` 调 `root.remove()`、语速断言读 `select.value`，两处补齐后 tsc 从 EXIT=2 回到 0。

**测试（42 例 + 命令注册 7 例）**
- `tests/unit/shared/tts-text.test.ts`（19）、`tests/unit/ui/tts-speech.test.ts`（10）、`tests/unit/ui/tts-player.test.ts`（13）；`tests/unit/core/command-registry.test.ts` 的 `EXPECTED_REGISTERED_IDS` 由 98 条增至 **101** 条。

**门禁**：`npm run preflight` EXIT=0（970 个测试文件 / 10251 通过 + 3 跳过；JSDoc 与活跃文档 20 个检查通过）；`check:i18n` 通过（zh 60 / en 60、0 个无法解析键、3 处动态键 warn、棘轮 269 文件 / 11892 条**不变**）；`check:bundle` main.js 5656950 → **5669728**（+12778）、styles.css 795890 → **798852**（+2962）、workers 不变，均已 `--update-baseline --note` 写明「新增 TTS 模块与 44 号样式」；`check:css` bytes +2962、uniqueClasses 4320 → **4331**（+11 个 `.nw-tts-*`）。

**文档**：新增 `docs/modules/tts.md`（8 节模板，TTS-01..06 全 done、7 条关键决策、验收表、测试清单、6 条 backlog）；`docs/modules/INDEX.md` 新增「章节朗读（TTS · 听校）」行（stable）；`docs/CURRENT.md` §2 `ui/` 行补 `ui/tts/`、§4 缺口状态改「①②③④⑤⑥已交付、⑦ i18n 第一期已交付」；`docs/planning/2026-11-18-feature-gaps.md` ⑥ 补「已交付（2026-11-18）」小节。

**下一轮**：缺口 ⑦ i18n 第二期（命令面板/设置分区正文/写作主流程）或 ⑥ 的 backlog（代码块整段跳过、`lang` 跟随音色、停止后恢复原选区、`estimateSpeechMs` 接进度显示）。


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

---

## 第五十八轮：i18n 第二期第一片 —— 命令面板名称（2026-11-18）

目标：命令面板里 94 条插件命令的名称跟着语言设置走（缺口 ⑦ 第二期第一片）。

**改动**
- `i18n/messages/zh-CN.ts` / `en-US.ts` 新增 `commands:` 子树 94 键（键名 = 命令 id 的 camelCase，英文名手写并保留 emoji 前缀）；资源 60 → 154 条。
- `core/command-registry.ts`：`registerObsidianCommands()` 里 94 处 `name: '中文'` → `name: t('commands.Xxx')`；`COMMAND_DEFINITIONS`（只被单测/内部查找消费，用户不可见）保持中文。
- `main.ts`：`registerObsidianCommands(...)` 前一行加 `applyLocaleSetting(this.settings.language)` —— 命令名在 `addCommand` 时就写死，晚切语言只会「设置页英文、面板中文」。
- 语言设置 desc（中英各一条）补「命令面板里的命令名在 Obsidian 注册时固定，切换语言后需重启 Obsidian 才会更新」。
- `tests/unit/core/command-registry.test.ts` 新增「命令面板文案走 i18n」3 例（zh 无键名回退/无空名/名称唯一；en 无 CJK；重注册首条 `New project`）。

**实机（开发 vault，1280×900）**
- zh：搜「导出」→ `导出为 PDF` + `Novel Writer AI📦 成稿导出`。
- en（data.json `language: 'en-US'` + 全新启动）：搜 `export` → `Novel Writer AI📦 Export manuscript`；命令表前四条 `New project` / `🤖 Guided setup (new / continue project)` / `New short-story project (research first)` / `New screenplay project (research first)`。
- 面板底部「导航 / 使用 / 退出」仍是中文 —— 那是 Obsidian 自己的 UI 语言，不归插件管。
- 截图 `D:\nw-dev-vault\_visual-i18n\{zh,en}-palette-export.png`（未入库）；脚本 `D:\nw-tmp\snap-i18n2.mjs <lang> <query> <tag>`。

**坑（两条，已写进 `docs/modules/i18n.md` §8）**
- 面板仍中文但 `settings.language` 已是 en-US：先查开发 vault 产物是否同步。`D:\nw-dev-vault` 的插件目录是真实目录，`npm run build` 后要 `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`；脚本不带 `--vault` 时默认写 `C:\Users\admin\nw-dev-vault`（空壳副仓）。
- CDP 下先 `window.activeWindow=window; window.activeDocument=document`，否则 `.prompt` / `.modal` 数都是 0；core 插件 `command-palette` 默认 disabled，要先 `app.internalPlugins.plugins['command-palette'].enable()`，否则连 `command-palette:open` 命令都不存在。

**门禁**
- `npx tsc --noEmit` 0 错；`npx vitest run tests/unit/core/command-registry.test.ts tests/unit/i18n` = 4 文件 / 48 例通过。
- `check:i18n` 通过：zh 154 / en 154、0 无法解析键、动态键 3 处、棘轮 269 文件 / 11892 条不变（`core/**` 不计入棘轮）。
- `npm run lint` 0 error / 1100 warning（存量）；`npm run preflight` 全绿。

**下一轮候选**：i18n 第二期余下（设置分区正文 `ui/settings/*-sections.ts`、写作主流程按钮与 Notice）；或清理 `COMMAND_DEFINITIONS` 的 description 与 `CommandGroupInfo` 死数据。

---

## 第五十九轮：i18n 第二期第二片 —— 外观设置页（2026-11-18）

目标：设置页「🎨 外观设置」正文（主题模式 / 界面氛围 / 三个颜色层 / 内置主题 / 配色方案）跟着语言设置走（缺口 ⑦ 第二期第二片）。

**改动**
- `i18n/messages/zh-CN.ts` / `en-US.ts`：`settings.appearance` 从 5 条语言项扩到 **71 条**（title/intro、预览卡 5 条、themeMode 5、atmosphere 5、三个颜色层各 4、gallery 5、galleryCompact 4、themeApplied、presets 26）；资源 154 → **220 条/语言**。
- `ui/appearance-settings.ts`（574 行）：47 处用户可见文案全部 `t('settings.appearance.*')`；新增模块级 `modeLabel(mode)`（`themeMode.dark/light`）给 notice 用；两个弹窗的「取消」复用 `common.cancel`；notice 用 `{name}`/`{count}`/`{theme}`/`{mode}` 插值。
- 决策：`shared/theme-gallery.ts` 的 7 套主题名/描述**故意不迁**——主题名会被 `galleryThemeToPreset` 写进已保存的配色方案名，按语言渲染会让老方案随切语言改名；真要英文化应改成「存 id、渲染时查表」。
- 测试：新增 `tests/unit/ui/appearance-settings-i18n.test.ts` 2 例（假 DOM 最小宿主；en 下 8 个标题全英文且不含中文标题，zh 下保持中文）。

**实机（开发 vault，1180×2600 视口，设置窗口）**
- en：labels = `Interface language / Theme mode / Surface atmosphere / Base color / Card color / Accent color`；headings = `🎨 Appearance / 🎨 Built-in themes / 💾 Color presets`；预设按钮 `Light / Dark`；英文长描述自然换行、无溢出。
- zh：对应中文。主题名（宣纸墨/青瓷/…）与「📊 写作统计与桌面宠物 / 🎨 桌宠形象」两块仍中文（按本片范围，后者在别的渲染函数里）。
- 截图 `D:\nw-dev-vault\_visual-i18n\appearance-{zh,en}.png` 与 `appearance-en-tall.png`（未入库）；脚本 `D:\nw-tmp\snap-i18n3.mjs <lang> <tag>`。

**坑（已写进 `docs/modules/i18n.md` §8）**
- Obsidian 1.14.5 的设置是**独立窗口**：CDP 下 `app.setting.open()` 只新开一个 page（`about:blank`、title「设置 - …」），且必须先 `app.setting.openTab(setting.pluginTabs.find(t => t.id === 'novel-writer-ai'))` 才渲染 `.nw-settings-root`；之后 DOM 查询与截图都在那个 page 上做。只 open 不 openTab 时 `.nw-settings-root` 数量为 0。
- `Setting.addButton` 的按钮文案挂在 `stubDocument` 上、不在容器子树里，`FakeEl.allText()` 取不到「恢复默认配色」，该断言删掉并留注释。
- `tests/unit/ui/settings-no-duplicate-render.test.ts` 有 3 例按**源码里的中文字面量**断言外观页（`'基底色'`、`'保存当前配色'`、`createSpan({ text: '基底' })`），文案改 `t()` 后首跑全红；已改成断言 `t('settings.appearance.*')` 键名。教训：i18n 迁移前先 grep 测试里的中文快照，别等门禁报。
- `check-i18n` 会提示「已下降（可 --update-baseline 收紧）」：不收紧的话基线仍记旧数字，别人加回中文不会被拦。本片 269 文件 / 11892 条 → **268 / 11812**。

**门禁**：`npm run preflight` **EXIT=0**（971 个测试文件 / 10256 通过 + 3 跳过；活跃文档 20 个）；
- `check:i18n` 通过：zh 220 / en 220、0 个无法解析的键、动态键 3 处、棘轮收紧到 **268 文件 / 11812 条**。
- `check:bundle` main.js 5678228 → **5685104**（+6876，双语资源进包；基线已 `--update-baseline` 写明原因）、styles.css 798852 不变。
- `check:view-tests` 收紧到 83 个文件（新测试静态 import 了 `ui/appearance-settings.ts`）。
- 日志 `D:\nw-tmp\preflight-i18n3c.log`；首跑红在 3 条存量源码断言（见下），修完复跑全绿。

**下一轮候选**：i18n 第二期余下（`ui/settings/*-sections.ts`、外观页的统计/桌宠块、写作主流程按钮与 Notice）；或把 `shared/theme-gallery.ts` 的主题名改「存 id + 查表」为英文化铺路。

## 第六十轮：i18n 第二期第三片 —— 模型设置页与密钥展示（2026-11-18）

用户「继续」缺口⑦ 第二期，按中文字数取设置分区里最大的一块 **`ui/settings/api-section.ts`**（1674 行 / 4295 个中文字），
并把同一屏的 `shared/secret-display.ts`（密钥加密状态卡）一起迁。

**改动**
- `ui/settings/api-section.ts`：约 214 处文案全部走 `t('settings.api.*')`（供应商侧栏 / 新建表单 / 密钥加密卡片 / 渠道能力 / 模型列表 / 全局分配 / 任务级预算 / 同人考据），5 个 `Record` 任务标签表也改成 `t()` 取值；`'取消'` 复用 `common.cancel`。文件里剩的 CJK 只有注释与一条样本检索词 `'斗破苍穹'`。
- `i18n/messages/{zh-CN,en-US}.ts`：`settings.api` 213 键 + 顶层 `secret` 10 键；资源 **220 → 443 条/语言**。
- `shared/secret-display.ts`：占位/悬停/落盘状态文案改 `t('secret.*')`；`SECRET_LOCKED_PLACEHOLDER` 常量改为函数 `secretLockedPlaceholder()`（模块加载时求值会定格启动语言）；legacy/mismatch 提示片段自带前导空格。
- 决策：`shared/theme-gallery.ts` 主题名与 `THINKING_LEVELS`/`BUDGET_TIERS` 的 label/描述**仍不迁**——前者写进持久化方案名，后者是跨模块共用常量；迁了会让英文界面出现半中半英，两条都记 backlog。

**坑**
- TS2322：`t('settings.api.capacityTitle', { tokens: contextWindow ?? '', ... })` —— `contextWindow` 是 `number | undefined`（`ui/settings/api-section.ts:697`）。
- `api-format-wiring.test.ts` 三处是**源码字符串断言**（读文件文本），迁 `t()` 后中文字面量消失，必须改断言 i18n 键。
- `api-section-dom.test.ts` 的预设分组只在 providers 有 `isDefault` 时渲染，双语用例要给第一条打 `{ ...PROVIDERS[0], isDefault: true }`。
- 第一次英文截图密钥加密警示仍是中文：那张卡来自 `shared/secret-display.ts`，不在 api-section 里。
- 截图前必须 `npm run build` + `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`；首次跑脚本插件未加载会报「Cannot read properties of undefined (reading 'language')」，重跑即可。

**验收**
- `npx tsc --noEmit` EXIT=0；`api-section-dom` / `api-format-wiring` / `secret-display` 3 文件 37 例全绿。
- `check:i18n`：zh 443 / en 443、0 无法解析键、动态键 3 处、棘轮 **268 文件 / 11577 条**（`--update-baseline` 收紧）。
- 实机 zh/en：`D:\nw-dev-vault\_visual-i18n\api-{zh,en}.png`（930×2570）；en 下标题/标签/按钮/长段风险文案全英文，仅共用常量（思考等级、预算档位）与供应商名保持中文；「In use」胶囊与「其它模块」在 930px 下的挤压中英一致，属既有布局。
- 全量 `npm run preflight`：见提交信息与 `docs/modules/i18n.md` §5。

**下一轮候选**：`ui/settings/general-sections.ts`（2349 字）、`ui/settings/writing-sections.ts`（2239）、`ui/settings/knowledge-section.ts`（1075），或写作主流程按钮/`Notice`。

## 第六十一轮：i18n 第二期第四片 —— 通用设置六分区（2026-11-18）

用户 m14049 指定顺序：`general-sections.ts`（2349 中文字）→ `writing-sections.ts`（2239）→
`knowledge-section.ts`（1075）。本轮完成第一块。

**改动**
- `ui/settings/general-sections.ts`（1258 行，221 个含中文行）：六分区（性能监控 / 写作规则版本 /
  识别与伏笔 / 关于 / 识别设置 / 建议采纳）全部迁 `settings.general.*` **178 键**；
  `cancelText: '取消'`×3 复用 `common.cancel`，性能报告弹窗 `'关闭'` 复用 `common.close`。
  文件内已无中文 UI 字面量（只剩注释与两处 `catch { // silent-ok: … }`）。
- 资源：`settings.general` 178 键（zh/en 621 条/语言），中英占位符逐键一致。
- `tests/unit/ui/settings-sections-dom.test.ts` 新增「通用设置分区双语」1 例；另改
  `settings-no-duplicate-render.test.ts`（2 条）、`settings-framework-wiring.test.ts`（1 条）、
  `security-r3-4-paths-secrets.test.ts`（1 条）从中文快照改为断言 i18n 键。
- 顺手修 **规则状态条对比度**：`styles-src/36-settings-general.css` 的
  `nw-st-notice--success` 原为「绿底 + 绿字」，实机只剩 emoji 可见（中英同病，属既有视觉问题），
  改成 `--background-secondary` 中性底 + 左侧 3px 语义色描边 + `--text-normal` 正文，warning 同步。

**坑**
- `i18n-parity.test.ts` 硬性禁止 en 资源出现 CJK：关键词例句与 vault 中文路径写进 en 值会挂。
  例句按语言各自本地化（en 用等义短词，避免输入框横向滚动条）；规则路径在 en 文案里改成描述性说法。
- 开发 vault 有两个：真实的是 `D:\nw-dev-vault`，`dev-vault.mjs` 不带 `--vault` 时操作
  `C:\Users\admin\nw-dev-vault`（空壳）。截图前手工拷 `main.js/styles.css/manifest.json/versions.json` + `workers/`。
- 设置是独立窗口：主窗口 `settingsTab.openTab(id)`，再在设置窗口 page 截图；
  高级页签默认折叠，需 `settingsUiShowAdvanced:true`。
- 刚 build 完第一次启动偶发 `plugin.settings` 未就绪（读 `language` 报 undefined），原样重跑一次即可。

**验收**
- `npx tsc --noEmit` EXIT=0；`settings-sections-dom`（11 例）、`i18n-parity`（7 例）、
  `security-r3-4-paths-secrets`（12 例）全绿。
- `check:i18n`：zh 621 / en 621、0 无法解析键、动态键 3 处、棘轮收紧到 **267 文件 / 11390 条**
  （`--update-baseline`，general-sections 条目已移除）。
- 实机五页（suggestions / rules / recognition / performance / about）× zh/en：
  `D:\nw-dev-vault\_visual-i18n5\<tab>-{zh-CN,en-US}.png`（930×2970，未入库）；
  en 下 CJK：suggestions/recognition/performance/about = **0**，rules = 11（真实 vault 路径 + 用户已保存的中文关键词，属数据）。
  规则状态条修好后中文可见完整句「✅ 单一来源已就绪。没有可选版本、没有漂移——改文件即全局生效。」。
- 全量 `npm run preflight`：见本提交与 `docs/modules/i18n.md` §5。

**下一轮候选**：`ui/settings/writing-sections.ts`（2239 字）、`knowledge-section.ts`（1075）、
`settings-search.ts`（1011），或写作主流程按钮/`Notice`。


## 第六十二轮：i18n 第二期第五片 —— 写作设置五分区（2026-11-18）

用户 m14049 指定顺序的第二块：`ui/settings/writing-sections.ts`（851 行 / 175 个含中文行 / 2239 中文字）。

**改动**
- 五个 Section（CoWrite / Writing / Template / ProjectLibrary / Layout）全部迁 `settings.writing.*` **147 键**：
  `cowrite*`（29）、`writing*/group*/warn*/…`（66）、模板页 `promptStrategyTitle`/`promptManagerMissing`、
  项目库迁移 `projectLib*/plan*/migrate*/undo*`、布局与面板尺寸 `layout*/autoRestore*/clearSaved*/panelSize*/row*/sizeRowDesc/restoreAll*`。
  `'刷新'`/`'取消'` 复用 `common.refresh`/`common.cancel`；资源 zh/en 各 **768 条**。
- 布局页面板尺寸行数据由 `{ key, label, desc, min, max, fallback }` 改
  `{ key, labelKey, descKey, min, max, fallback }`，渲染时 `t(row.labelKey)` +
  `t('settings.writing.sizeRowDesc', { desc: t(row.descKey), min, max, fallback })`
  （zh 模板 `{desc}（{min}–{max}px，默认 {fallback}px）`）——文案在数据里就绕过了静态键校验。
- 测试：`settings-no-duplicate-render.test.ts` 三处源码断言改键（五组标题循环改
  `group(t('settings.writing.groupXxxTitle'), …)`；字数上下限提示改 `warnMinGtDefault`/`warnDefaultGtMax`
  并额外读 zh 资源确认原文）。

**做法（值得复用）**：仓外脚本 `D:\nw-tmp\migrate-writing-{1,2,3}.cjs` 持 `[[old,new],…]` 对逐条
`split/join`，命中不到就 `console.error('MISSING: '+old)` 并非零退出；按 Section 类分三段跑。
三个坑：① 文件是 CRLF（850 个 `\r\n`），**多行 old 串必须写 `\r\n`**；
② 替换值必须是字符串字面量，写成 JS 代码会被 node 执行（`ReferenceError`）；
③ **长串先替换**（`'本地模型'` 会拆坏 `'选择协同写作使用的 Ollama 本地模型'`）。
多行占位符 `antiAiPlaceholder` 要写真实换行，生成脚本若用 JSON 转义会落成字面 `\n`，需 `\\n`→`\n` 修回。

**验收**
- `npx tsc --noEmit` EXIT=0；设置页 + i18n 目录 6 文件 **75 例全绿**；`npm run lint` 0 error / 1075 warning。
- `check:i18n`：zh 768 / en 768、0 无法解析键、动态键 4 处、棘轮收紧到 **266 文件 / 11234 条**
  （`--update-baseline`，writing-sections 条目已移除）。
- 实机五页 × zh/en：`D:\nw-dev-vault\_visual-i18n5\{cowrite,writing,template,projects,layout}-{zh-CN,en-US}.png`
  （930×2970，未入库）。en 下 cowrite / writing / projects / layout 的 CJK = **0**
  （写作页五组标题 `Length / Body style / Context and model / Quality gates and revision / Thresholds and word lists`
  与全部 Setting 行均英文，无溢出）；template 页 CJK 276 属预期——提示词库条目是 vault 数据，
  搜索框占位「搜索提示词」来自本片范围外的 `ui/prompt-manager-settings.ts`（192 字）。
- 全量 `npm run preflight`：见本提交与 `docs/modules/i18n.md` §5。

**下一轮候选**：`ui/settings/knowledge-section.ts`（1075 字）→ `ui/prompt-manager-settings.ts`（192）→
`settings-search.ts`（1011），或写作主流程按钮/`Notice`。

## 第六十三轮：i18n 第二期第六片 —— 写作知识库分区（2026-11-18）

用户 m14049 指定顺序的第三块：`ui/settings/knowledge-section.ts`（1075 中文字）。

**改动**
- 知识库分区全部迁 `settings.knowledge.*` **87 键**：标题与引导语、路径行、工具栏四按钮
  （批量导入/监控面板/重建索引/重向量化）及其 `title` 提示、搜索占位、状态/题材/技巧三个筛选、
  两种空态、`共 {count} 本书籍`、`{n}万字`/`{n}字`、重拆/删除、删除确认三行与 `已删除「{name}」`、
  向量增强整块（开关、阈值含 `{value}`、四家提供商端点/模型/密钥、回退策略三项、
  连接检测四态 + 成功/失败通知）。`'取消'` 复用 `common.cancel`。
- **顺带修掉两个宿主的复制文案**：异步分区刷新条「数据为加载时快照，可能已过期 / 🔄 刷新」
  在 `ui/settings-tab.ts:334-337` 与 `ui/mini-settings-modal.ts:177-180` 各写死一份，
  改走 `settings.shell.asyncStale`/`asyncRefresh`；弹窗里裸中文 `未知设置页签：${tabId}`
  （设置页早已迁 `unknownTab`）一并改键。
- 测试：`tests/unit/ui/settings-sections-dom.test.ts` 新增 `KnowledgeSection` 两例（en 全英文/无键名回退、
  zh 保持原文案），靠桩宿主 `engineRegistry.get` 恒 null 走空态分支；该文件 13 例全绿，
  `npx vitest run tests/unit/ui` 212 文件 / 1956 例全绿。
- 门禁联动：`check:view-tests` 基线收紧到 82 个文件（knowledge-section 已有静态 import）。

**验收**
- `npx tsc --noEmit` EXIT=0；`npm run lint` 0 error / 1068 warning。
- `check:i18n`：zh 853 / en 853、0 无法解析键、动态键 4 处、棘轮 **265 文件 / 11126 条**。
- 实机 `D:\nw-dev-vault\_visual-i18n6\knowledge-{zh-CN,en-US}.png`（930×2970，未入库）：
  en 下 headings = `📖 Settings / 📚 Writing knowledge base / 🧠 Vector enhancement`，
  labels/按钮全英文、刷新条 `Loaded from a snapshot — may be out of date / 🔄 Refresh`；
  **CJK 11 全是书籍数据**（书名/作者/样本书名）。zh 页文案不变。
- 全量 `npm run preflight` **EXIT=0**（971 文件 / 10261 通过 + 3 跳过；活跃文档 20 个）；`check:bundle` main.js 5747257 → **5755919**（+8662）、styles.css 799217 不变；`check:inline-styles` 525 站点。首跑 EXIT=1 卡在 `check:view-tests`（knowledge-section 已有静态 import 但基线未收紧），`--update-baseline` 后复跑全绿。

**下一轮候选**：`ui/prompt-manager-settings.ts`（192 字，模板页里的提示词库）→ `settings-search.ts`（1011）→
`deconstruction-section.ts`（758）/ `fingerprint-section.ts`（569）等其余分区 → 写作主流程 Notice。

## 第六十四轮：i18n 第二期第七片 —— 提示词管理器设置页（2026-11-18）

**目标**：把 `ui/prompt-manager-settings.ts`（1367 行 / 192 中文字）全部用户可见文案迁到
`settings.promptManager.*`，并把提示词分类标签从 services 层中文常量改为可翻译函数。

**改动**
- 四个子页签（`📝 提示词模板 / 🧪 A/B 测试 / 📊 使用统计 / 📦 导入/导出`）、侧栏（搜索 name+placeholder、
  `📚 全部 ({count})`、分类按钮、`没有匹配的提示词模板`、`自定义` 徽标、`➕ 新建自定义提示词`）、
  详情面板（选择提示/模板不存在、编辑/自定义/重置与三个确认弹窗、版本历史与 `已切换到 v{version}`、
  新建版本、系统/用户提示词、变量与 `必填` 徽标）全部改 `t()`。
- A/B 测试管理：标题、开关与两条通知、空态、`模板: {id} · 流量 {a}/{b}`、四种状态徽标、
  A/B 版本标签、开始/暂停/恢复/结束/删除与各自确认弹窗与通知、创建测试弹窗九个字段与五条校验、
  结束测试弹窗（含 `🏆 推荐优胜: {variant} 版本`）；使用统计（`共 {count} 条记录`/`第 {page} / {total} 页`/
  清空确认）；导入导出（导出/导入说明、`导入失败：{error}`、合并/替换/导出完成通知）。
- 状态徽标改 `STATUS_LABEL_KEYS` 映射 + `getStatusLabel()`（未登记状态回落原值）。
- **服务层开先例**：`services/prompt-manager.ts` 从「`PROMPT_CATEGORY_LABELS` 中文常量」改为
  `PROMPT_CATEGORY_IDS` + `promptCategoryLabel(category)`（查 `prompt.category.*`，`hasMessage()`
  判定，未登记分类回落原始 key），这是第一个 `import { t } from '@/i18n'` 的 services 文件。
- 资源：zh/en 各 **997 条**（新增 `settings.promptManager` 134 + `prompt.category` 10；删掉未使用的
  两个 title 键）；`settings.shell` 6→8 的说明回填进 §2 清单。

**三处坑**
1. **局部变量遮蔽 `t`**：`templates.filter(t => …)`、`const t = getTemplateById(v)` 会让 `t('x')`
   报 TS2349 / TS2721（不是「未使用 import」），统一改名 `tpl` 才干净。
2. **D 盘开发 vault 产物是拷贝**：`node scripts/dev-vault.mjs sync` 不带 `--vault` 会同步到 C 盘空壳，
   第一次 en 截图因此「外壳英文、正文中文」；正确写法 `--vault=D:\nw-dev-vault`，
   确诊手段是 `Select-String main.js -Pattern 'settings.promptManager'`。
3. **分页器要 total > pageSize 才渲染**：单测里 1 条记录时断言 `第 / 页` 会失败。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx vitest run tests/unit/ui tests/unit/services` **292 文件 / 2596 例**全绿；
  `tests/unit/ui/prompt-manager-settings-dom.test.ts` 13 例（含新增双语 3 例）。
- `check:i18n`：zh 997 / en 997、0 无法解析键、动态键 6 处、棘轮 **264 文件 / 10971 条**。
- 实机 `D:\nw-dev-vault\_visual-i18n7\`：模板页与 A/B 页各中英两张（930×3170），三个弹窗 en 一张
  （1180×1400）；en 下 A/B 页 CJK 0，模板页 CJK 206 全为 vault 模板名/描述。
- 全量 `npm run preflight` **EXIT=0**（971 文件 / 10264 通过 + 3 跳过；活跃文档 20 个）；`check:bundle` main.js 5755919 → **5769722**（+13803）、styles.css 799217 不变。首跑 EXIT=1 卡在 `check:docs`（文档改动后未重生成），`npm run gen:docs` 后复跑全绿。

**下一轮候选**：`ui/settings/settings-search.ts`（1011 字）→ `deconstruction-section.ts`（758）→
`fingerprint-section.ts`（569）→ 写作主流程 Notice。

## 第六十五轮：i18n 第二期第八片 —— 设置搜索与迷你设置弹窗外壳（2026-11-18）

**目标**：把设置搜索的 21 个主题词（42 条名称/同义词资源）与迷你设置弹窗外壳迁到 i18n，
让英文界面里搜出来的主题词、弹窗标题与占位都是英文。

**改动**
- `ui/settings/settings-search.ts`：主题词条目的 `name: string` 改 `nameKey: string`，
  新增 `entryLabel(entry)`（主题词 `t(nameKey)`，其余回落 `itemName`）；搜索匹配与结果渲染都走它。
  新增 `topicKeywords(id)`：把 zh-CN 与 en-US 两份 `settings.search.topic.<id>.keywords`
  按逗号拆开合并（`KEYWORD_LOCALES`），所以中英界面都能用两种语言的关键词搜到。
- `ui/mini-settings-modal.ts`：标题、搜索占位、空态、高级开关两态改 `settings.shell.*`；
  结果行改用 `entryLabel(hit.entry)` 渲染，并用同一个 label 调 `highlightSettingItem`。
- 资源：zh/en 各 **1041 条**（新增 `settings.search.topic` 42 + `settings.shell.compactTitle` /
  `compactSearchPlaceholder` 2）。

**三处坑**
1. **搜索结果不能存「算好的文案」**：索引常驻，构造时 `t()` 会定格语言（且门禁看不到键），
   必须存 `nameKey` 并在渲染时求值。
2. **测试 fixture 没有 writing 页签**：`settings-search.test.ts` 里的 GROUPS/TABS 只有
   api/mcp/rules/fingerprint/knowledge，跨语言断言要用 rules 主题词，否则永远搜不到。
3. **工作台 ⚙️ 设置 菜单在 CDP 里点不出 Modal**：菜单能弹出（7 项），但 `menu-item.click()` 后
   `.modal-container` 仍为 0；迷你弹窗外壳改由单测覆盖，别再耗时间调 CDP。

**验收**
- `npx tsc --noEmit` EXIT=0；`tests/unit/ui/settings-search.test.ts` 16 例、
  `mini-settings-modal.test.ts` 8 例（各含新增双语 3 例）。
- `check:i18n`：zh 1041 / en 1041、0 无法解析键、动态键 7 处、棘轮 **262 文件 / 10844 条**。
- 实机 `D:\nw-dev-vault\_visual-i18n8\search-q{1,2,3}-{zh-CN,en-US}.png`：en 界面搜 `mcp` 出
  `🔌 Connect & Models › 🔌 MCP Servers  MCP servers` 与 `Web research (canon)`（后者来自
  `'mcp search'` 关键词），中文界面搜 `banned` 命中「AI 味与禁用词」，探针 CJK 0。

**下一轮候选**：`ui/settings/deconstruction-section.ts`（758）→ `fingerprint-section.ts`（569）→
`setup-section.ts`（477）→ `foreshadow-section.ts`（447）→ 写作主流程 Notice。



## 第六十六轮：i18n 第二期第九片 —— 拆解引擎分区（2026-11-18）

用户 m15674「开始下一步」：按顺序迁 `ui/settings/deconstruction-section.ts`（335 行 / 58 个含中文行 / 758 中文字）。

**改动**
- 五张卡（增强级别 / 八个拆解维度 / 向量增强 / LLM 增强·实验性 / 性能）与「↩️ 恢复默认」确认框
  共 24 处文案迁 `t('settings.deconstruction.*')` **54 键**；三个 slider 的实时 desc 用 `t(key, { count })` 插值；
  `cancelText` 复用 `common.cancel`。
- 文件内局部 `DIMENSION_DESC` 表改 `DIMENSION_DESC_KEYS` + 渲染时求值。
- `shared/deconstruction-settings.ts` 新增 `DIMENSION_LABEL_KEYS` 与 `dimensionLabel(dim)`
  （`deconstruction.dimension.*` 8 键，缺失回落原中文）；原 `DIMENSION_LABELS` 一字未改留给引擎日志。
- 资源：zh/en 各 **1103 条**（+62）。

**三处坑**
1. **`DIMENSION_LABELS` 不能直接换 `t()`**：它被 `engine/deconstruction-scheduler.ts` 用在任务日志与进度串
   （`:197/:1113/:1177/:1294`），换掉会让日志随界面语言漂移 → 保留常量 + `dimensionLabel()` 给 UI。
2. **分区文件别从 `'@/main'` 取常量**：`@` 指向仓根，vitest 里先命中构建产物 `main.js`，
   报 `Error: Cannot find module 'obsidian'` + `Require stack: …novel-writer-ai\main.js`；
   改 `from '@/shared/deconstruction-settings'`（`main.ts:739` 只是再导出）。
3. **新导出要补 JSDoc**：`check:jsdoc` 报「未注释导出从 0 增到 1」，且缺的是早已存在但没注释的
   `export type BreakdownDimension`（棘轮按文件计数，新增导出会把旧债暴露）；补注释后 100% / @example 53/53。

**验收**
- `npx tsc --noEmit` EXIT=0；`tests/unit/ui/settings-sections-dom.test.ts` 新增 3 例（文件 16 例全绿）。
- `check:i18n`：zh 1103 / en 1103、0 无法解析键、动态键 **9 处**、棘轮收紧到 **261 文件 / 10785 条**。
- `check:bundle`：main.js 5773439 → **5781144**（+7705，62 条双语键进包）、styles.css 799217 不变。
- 实机 `D:\nw-dev-vault\_visual-i18n9\deconstruction-{zh-CN,en-US}.png`（930×2970）：
  en 下 heads = `📖 Settings / 🧬 Deconstruction engine / 🎯 Quality level / 🧩 Dimensions /
  🧠 Vector enhancement / 🤖 LLM enhancement · experimental / ⚙️ Performance`，
  维度名 `Style analysis … Readability analysis`，按钮 `🔄 Refresh / ↩️ Restore defaults`，**CJK 0**；两语言无溢出。

**下一轮候选**：`ui/settings/fingerprint-section.ts`（569）→ `setup-section.ts`（477）→
`foreshadow-section.ts`（447）→ `mode-section.ts`（402）→ `mcp-section.ts`（301）→ 写作主流程 `Notice`。

## 第六十七轮：i18n 第二期第十片 —— 写作指纹库分区与列表行 chrome（2026-11-18）

用户 m15674 之后「继续」：按顺序迁 `ui/settings/fingerprint-section.ts`（440 行 / 569 中文字）。

**改动**
- 分区 35 处文案迁 `settings.fingerprint.*`：标题与引导语、加载态、三级分组标题（`groupTitle` /
  `groupTitleWithProject` 带 `{count}` 与 `{project}` 插值）、三个添加按钮、`🔄 从模板同步`及 title、
  同步成功（`{added}`/`{updated}`）/失败通知、无活动项目提示、删除确认四段、`已删除「{name}」`、
  统计词表块（三个情绪词的 `{name, hint}` 表改 `{key, nameKey, hintKey}`）。
- 截图校正抓到分区外的漏网：列表行渲染器在 `ui/fingerprint-utils.ts`（`renderFingerprintList()`），
  空态/模板徽标与 title/详情与删除按钮 title/字数格式化一并迁 7 键（`emptyList / templateBadge /
  templateBadgeTitle / detailBtn / deleteBtnTitle / wordCountWan / wordCount`）。
- `formatWordCount()` 改「同一键 + 按语言换基数」：`getLocale() === 'en-US' ? count / 1000 : count / 10000`，
  zh `{n}万字`/`{n}字`、en `{n}k words`/`{n} words`。
- 资源：zh/en 各 **1145 条**（+42）。

**三处坑**
1. **分区迁完不等于迁完**：zh 页看起来全对了，en 页列表行仍是「详情 / 暂无指纹 / 12.5万字」——
   真身是 `ui/fingerprint-utils.ts`。迁设置分区要顺着 `render*()` 再追一层，别只清零分区文件的棘轮条目。
2. **计量单位不能拆成一对语言专用键**：`wordCountWan` 拆成 `…Cjk`/`…En` 会让两边占位符一致但语义错位，
   `check-i18n` 的键一致性检查也失去意义；键写单位模板、基数在代码里按语言折算。
3. **en 资源的占位示例句也算文案**：`aiHighFreqPlaceholder` 等四个键原来是 `'Comma separated, e.g. 不禁, 仿佛'`，
   `i18n-parity.test.ts` 直接拦下（首跑 preflight 唯一的失败）；改成 `admittedly, seemingly` 等英文例。
4. **截图脚本等待插件的条件太松**：`snap-i18n10.mjs` 原来等 `plugins['novel-writer-ai']` 存在就读
   `settings.language`，但插件对象先于 `onload` 完成出现，偶发 `Cannot read properties of undefined
   (reading 'language')`；改为等 `p.settings && p.settingsTab`。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/ui/fingerprint-section-i18n.test.ts` 4 例（`vi.hoisted` 桩库 +
  `vi.mock('@/engine/style-fingerprint-library')`）；`npx vitest run tests/unit/ui` **213 文件 / 1974 例**全绿。
- `check:i18n`：zh 1145 / en 1145、0 无法解析键、动态键 **10 处**、棘轮收紧到 **261 文件 / 10732 条**。
- `check:bundle`：main.js 5781144 → **5785855**（+4711；其中 +12 是把 en-US 四个情绪词占位例句
  `Comma separated, e.g. 不禁, 仿佛` 改成英文——
  `i18n-parity.test.ts` 硬性禁止 en 资源出现 CJK，首跑 preflight 就栽在这四个键上）。
- 全量 `npm run preflight` **EXIT=0**（972 文件 / 10277 通过 + 3 跳过；活跃文档 20 个）。
- 实机 `D:\nw-dev-vault\_visual-i18n10\fingerprint-{zh-CN,en-US}.png`（930×2970）：en 下
  heads = `📖 Settings / 📊 Statistic word lists (extra) / 🔍 Writing fingerprints`，按钮
  `🔄 Refresh / ➕ Add template fingerprint / ➕ Add global fingerprint / ➕ Add project fingerprint /
  🔄 Sync from templates / Details`，空态 `No fingerprints yet`，字数 `126.4k words`，剩余 CJK 73 全是数据。

**下一轮候选**：`ui/settings/setup-section.ts`（477）→ `foreshadow-section.ts`（447）→
`mode-section.ts`（402）→ `mcp-section.ts`（301）→ 指纹 12 维标签（`ui/fingerprint-utils.ts` 剩 10 处，
随写作指纹库视图切片一起迁）→ 写作主流程 `Notice`。


## 第六十八轮：i18n 第二期第十一片 —— 首启与自检分区 + 自检服务（2026-11-18，ZCode · ZC-20261118-01）

**改动**
- `ui/settings/setup-section.ts`（135 行 / 477 中文字）：分区骨架 34 处文案迁
  `t('settings.setup.*')`——标题与引导语、加载态、摘要两态 + 计数插值
  （`（ok {ok} / warn {warn} / missing {missing}）`）、清单行 `{icon, label}`、修复行、失败行、
  六个 Setting、七个按钮、五条 Notice。
- `services/setup-readiness-service.ts`（88 行含中文）：9 个自检项的 label/detail/fix
  迁 `settings.setup.items.*` 43 键。**util 教训的 services 版**：数据源在 services/ 也要一并迁，
  否则 en 页 9 个自检项满屏中文。服务每次 `check()` 都由 `main.ts` 新建实例，
  方法体内 `t()` 即「当时语言」；`log.info`/`log.warn` 保留中文（日志非界面）。
- 资源 zh/en 各 1222 条（+77：`settings.setup` 34 + `settings.setup.items` 43）；
  vault 路径（`元文件`、`写作知识库/…`）不进 en 资源字面量——运行时拼接的走插值参数，
  固定出现在 desc 里的 zh 直写、en 换说法，两边零占位符。
- 新增 `tests/unit/ui/setup-section-i18n.test.ts` 4 例：分区直连真实 `SetupReadinessService`
  （桩 deps + mock Vault），走通 service t() → 分区渲染整条链；en 渲染做 CJK 白名单断言
  （只允许 元文件/三模式目录/项目名 字符）。

**三处坑**
1. **mock Vault 的 `_seedFile` 隐式创建父目录**：给 `长篇小说/测试书/作品信息.md` 播种后
   `getAbstractFileByPath('长篇小说')` 已命中，模式目录自检从「缺三个」变「缺两个」；
   要测目录缺失就把项目种在模式目录外（如 `测试书/作品信息.md`）。
2. **mock Setting 的按钮是游离 `buttonEl`**：`FakeEl` 收集不到 `setButtonText` 的文案，
   分区测试别断言按钮文字（键解析由 `check:i18n` 兜底）。
3. **sync 后先 grep 再截图**：首次 `dev-vault.mjs sync --vault=D:\nw-dev-vault` 报了
   「更新 6 个文件」但 D 盘 main.js 里没有新键（en 截图正文全中文即此症）；重跑 sync 后正常。
   截图前 `grep -c '<新键片段>' main.js` 一眼定真伪。

**验收**
- 新增 4 例 + 既有 4 个 service 测试（zh 断言子串全部保留，零修改）全绿；
  `npx tsc --noEmit` EXIT=0（preflight 内含）。
- `check:i18n`：zh/en 各 1222、0 无法解析键、动态键 10 处、棘轮收紧到 **260 文件 / 10697 条**。
- `check:bundle`：main.js 5785855 → **5796603**（+10748，77 条双语键进包）；styles.css 799217 不变。
- 全量 `npm run preflight` EXIT=0（973 文件 / 10281 通过 + 3 跳过；首跑败在 check:docs 漂移——
  `check:jsdoc` 重写生成物在 `check:docs` 之前 + 本片改了 INDEX，gen:docs 后复跑全绿）。
- 实机 `D:\nw-dev-vault\_visual-i18n11\setup-{zh-CN,en-US}.png`（930×2970）：en 下 heads =
  `📖 Settings / 🚀 First run & readiness`，Setting 行 `Re-run readiness check / Generate "meta file"
  templates on startup / One-click fixes / Recover interrupted settlement / First-run guide /
  Folder / tag / property conventions`，按钮 `Check now / Fill in templates / Create sample project /
  Generate usage guide / Check & recover / Open guide / View conventions`，摘要
  `✅ Ready to write (ok 7 / warn 2 / missing 0)`；剩余 CJK 17 全是数据（元文件 /
  长篇小说, 短篇小说, 剧本 / 示例项目）；zh 页与改前逐字一致，两语言均无溢出。

**下一轮候选**：`foreshadow-section.ts`（447）→ `mode-section.ts`（402）→ `mcp-section.ts`（301，
工具名是数据不迁）→ `agent-section.ts`（125，完成后设置分区全迁完）→ 指纹 12 维标签
（随写作指纹库视图切片）→ 写作主流程。

## 第六十九轮：i18n 第二期第十二片 —— 伏笔管理分区（2026-11-19，ZCode · ZC-20261118-02）

**改动**
- `ui/settings/foreshadow-section.ts`（292 行 / 447 中文字）48 处文案迁 `t('settings.foreshadow.*')`：
  最大未揭示伏笔、类型列表（关键词计数 `{count}` 插值、启停 title 两态、编辑/删除、删除确认五段）、
  导入/导出/重置三按钮与两个确认框（取消复用 `common.cancel`）、导入弹窗、编辑与新增弹窗五字段
  （标题带 `{name}` 插值）。类型 name/description/keywords 是用户数据（随配置导出导入）不迁。
- 资源 zh/en 各 1270（+48）；关键词占位例 en 用英文例（`sword, blade, spear, jade pendant`，
  i18n-parity 硬拦 en CJK，同第十片情绪词占位教训）。
- 新增 `tests/unit/ui/foreshadow-section-i18n.test.ts` 3 例（分区同步渲染，静态 import）；
  en CJK 白名单用 `DEFAULT_FORESHADOW_TYPES` 拼数据字符集，自动适配默认配置变化。

**坑**
- 启停按钮 title 走 `attr.title`，FakeEl 的 textContent 收集不到——attr 类文案单测别断言，靠 check:i18n。

**验收**
- 新增 3 例全绿；`check:i18n` zh/en 各 1270、棘轮收紧到 **259 文件 / 10646 条**（foreshadow-section 移出）；
  `check:bundle` main.js → **5801322**（+4719）；`check:view-tests` 收紧到 **79 个文件**；
  preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n12\foreshadow-{zh-CN,en-US}.png`：en 下页签 `Foreshadowing`、
  8 张类型卡（Edit/Delete/`N keywords`）、导入导出重置全英文，剩余 CJK 110 全是类型数据；
  zh 页与改前一致。

**下一轮候选**：`mode-section.ts`（402）→ `mcp-section.ts`（301，工具名是数据不迁）→
`agent-section.ts`（125，完成后设置分区全迁完）→ 指纹视图三件套 → 写作主流程。

## 第七十轮：i18n 第二期第13片 —— 创作模式与路径分区（2026-11-19，ZCode · ZC-20261118-03）

**改动**
- `ui/settings/mode-section.ts`（79 行 / 402 中文字）24 处文案迁 `t('settings.mode.*')`：标题/引导语/
  三张模式卡（label + description）/项目库根目录 desc（`{root}` 插值）/内容结构/单元规格 desc 与
  value/补充提示三态/页脚（`{path}` 插值 `WRITING_RULES_PATH_TEMPLATE`）。
- **共享常量展示字段不改**：`CREATION_MODE_SPECS` 的 label/description/unitLabel/unitPlural 被
  引擎、提示词与十余个视图共用，分区内 `MODE_SPEC_KEYS` 按语言求值（同第九片
  `DIMENSION_LABEL_KEYS` 路数）；其他视图迁移时可直接复用 `settings.mode.spec.*` 键组。
- `MODE_LIBRARY_ROOTS`、`MODE_CONTENT_LAYOUT` 与写作规则路径是真实 vault 路径（数据）不译，
  经插值参数或原样展示进 en 页。
- 资源 zh/en 各 1294（+24）；`settings-no-duplicate-render.test.ts` 的源码断言按第五片先例改键。

**坑**
- 禁用输入框的 value 走 `setValue()`，不进 FakeEl 的 textContent——单测别断言输入框值。

**验收**
- 新增 `tests/unit/ui/mode-section-i18n.test.ts` 3 例全绿；`check:i18n` zh/en 各 1294、动态键 11 处、
  棘轮收紧到 **259 文件 / 10631 条**；`check:bundle` main.js → **5804624**（+3302）；
  preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n13\modes-{zh-CN,en-US}.png`：en 下三张模式卡
  （`Long-form novel` / `Short story` / `Short drama script`）与全部 Setting 行全英文，
  剩余 CJK 62 全是 vault 路径与目录名；zh 页与改前一致。

**下一轮候选**：`mcp-section.ts`（301，工具名是数据不迁）→ `agent-section.ts`（125，
完成后设置分区全迁完）→ 指纹视图三件套 → 写作主流程。

## 第七十一轮：i18n 第二期第14片 —— MCP 服务分区（2026-11-19，ZCode · ZC-20261118-04）

**改动**
- `ui/settings/mcp-section.ts`（68 行 / 301 中文字）13 处文案迁 `t('settings.mcp.*')`：标题/引导语/
  空态提示/服务器行「· 已停用」后缀/「管理」按钮/管理中心 name+desc+「打开管理中心」按钮/
  移动端说明 name+desc+「检查当前环境」按钮与两条环境 Notice。
- 服务器行 name 是用户数据、`describeMcpServer()` 输出只含全角括号与数据字段（无汉字），均不迁。
- 资源 zh/en 各 1307（+13）；新增 `tests/unit/ui/mcp-section-i18n.test.ts` 3 例（空列表分支，
  en 骨架 CJK=0 断言）。

**验收**
- 新增 3 例全绿；`check:i18n` zh/en 各 1307、棘轮收紧到 **258 文件 / 10617 条**（mcp-section 移出）；
  `check:bundle` main.js → **5806219**（+1595）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n14\mcp-{zh-CN,en-US}.png`：en 下标题/引导语/管理中心/
  移动端说明全英文，**CJK 0**（开发 vault 未配 MCP 服务，无数据行）；zh 页与改前一致。

**下一轮候选**：`agent-section.ts`（125，完成后设置分区全迁完）→ 指纹视图三件套 → 写作主流程。

## 第七十二轮：i18n 第二期第15片 —— Agent 对话分区（2026-11-19，ZCode · ZC-20261118-05）

**改动**
- `ui/settings/agent-section.ts`（45 行 / 125 中文字）6 处文案迁 `t('settings.agent.*')`：标题/引导语/
  写入确认 name+desc/两个 option 可见文案（option 值 ask/allow 是存盘 id 不动）。
- **设置分区正文至此全部迁完**（`ui/settings/*-section*.ts` 只剩 section-factory/section-base
  骨架与外观页统计/桌宠块）。
- 资源 zh/en 各 1313（+6）；新增 `tests/unit/ui/agent-section-i18n.test.ts` 3 例（en 骨架 CJK=0）。

**验收**
- 新增 3 例全绿；`check:i18n` zh/en 各 1313、棘轮收紧到 **257 文件 / 10611 条**（agent-section 移出）；
  `check:bundle` main.js → **5806984**（+765）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n15\agent-chat-{zh-CN,en-US}.png`：en 下 heads=`🤖 Agent chat`、
  Setting 行 `Agent write confirmation` 全英文，**CJK 0**；zh 页与改前一致。
- 附：本片提交同时补齐第14片在 `docs/modules/i14n.md` 的 §1 入口/§2 资源规模/片次链/已迁移面/
  未迁移面/验收记录六处（第14片提交时 heredoc 锚点失配只落了部分文档段，已在本次补全）。

**下一轮候选**：写作指纹库视图三件套（ZC-06：`writing-fingerprint-view.ts` 236 处 +
`fingerprint-detail-modal.ts` 117 处 + `fingerprint-v2-detail.ts` 16 处 + `fingerprint-utils.ts`
12 维标签 10 处）→ 写作主流程（ZC-07）。

## 第七十三轮：i18n 第二期第16片 —— 写作指纹库视图链 + 12 维标签（2026-11-19，ZCode · ZC-20261118-06）

**改动**
- `ui/views/writing-fingerprint-view.ts`（2018 行 / 约 150 处）147 对替换走仓外脚本
  `migrate-fp-view.cjs`（唯一命中即替换、重复串 all 标记全量替换，147/147 命中）：
  工具栏 10 按钮+tooltip、三层页签、列表与详情面板、注入影响卡、自动分类、编辑/章节提取/知识库导入
  三弹窗、全部 Notice。走 `fingerprint.view.*`（142 键）。
- `ui/fingerprint-detail-modal.ts`（575 行 / 约 116 处）迁 `fingerprint.detail.*`（45 键）+
  `fingerprint.metric.*`（38 指标标签 + 3 单位）。
- 12 维标签：引擎常量 `STYLE_DIMENSIONS_V2` 的 name 被引擎消费不改，`fingerprint-utils.ts` 并出
  `dimensionNameV2()/dimensionDescV2()/dimensionStatusLabel()`（`fingerprint.dim.*` 24 + `status.*` 3），
  v1 七维改 `labelKey`（7 键）；`fingerprint-v2-detail.ts` 标签表复用同一组键。
- `fingerprint-scope-logic.ts`：层名走 `scopeLabel()`（`SCOPE_LABELS` 常量保留给测试）+ 空态引导。
- 能力横幅链：`fingerprint-capability.ts`（15 键）+ `capability-banner.ts`（4 阶段标签）+
  `link-status.ts` 外壳（13 键）。**已知缺口**：`shared/link-status-compute.ts` 的阶段名/明细
  被 agent 诊断与知识库视图共用，本片不迁（backlog）。
- 保留中文 = 数据：指纹 name/source/tags（用户数据）、默认名 `章节指纹_`/来源 `章节提取`
  （落盘数据不随语言漂移）、正文目录路径。
- 资源 zh/en 各 1644（+331，顶层 `fingerprint` 子树 299 键）。

**验收**
- 新增 `tests/unit/ui/fingerprint-view-i18n.test.ts` 4 例；`fingerprint-v2-detail.test.ts` 改
  `t(labelKey)` 对比；scope-logic/capability/view-banners/detail-logic 等 5 个既有测试文件
  **零修改全绿**（zh 资源逐字保留）。
- `check:i18n` zh/en 各 1644、动态键 15 处、棘轮收紧到 **250 文件 / 10218 条**；
  `check:bundle` main.js → **5841540**（+34556）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n16\fingerprint-view-{zh-CN,en-US}.png`（主窗口命令直开）：
  en 下导航/页签/工具栏/能力横幅/链路条外壳/搜索/操作区全英文，剩余 CJK = 指纹数据 +
  共享层缺口（链路阶段名/模型快切器/桌宠，backlog）；zh 页与改前一致。

**下一轮候选**：写作主流程（ZC-07：`co-writing-view.ts` 8504 字 + `full-writer-view.ts` 4981 字，
可再拆 2~3 次提交）→ 外观页统计/桌宠块 → section-factory/section-base 骨架。

## 第七十四轮：i18n 第二期第17片第一批 —— 完整写作工作台主体（2026-11-19，ZCode · ZC-20261118-07）

**改动**
- `ui/full-writer-view.ts`（2771 行 / 约 115 处文案）110 对替换走仓外脚本 `migrate-fw-view.cjs`
  （110/110 命中）+ 手工补 3 处：一键条（一键/逐步/暂停/继续/取消）、执行事件与进度插值、
  步骤操作区（生成/重生成/跳过/温度/提示词编辑器）、规划快捷卡、复审页签、上下文面板、
  三处 Notice、拖拽 aria。走顶层 `fullwriter.*` 106 键。
- **保留数据**：管线步骤名（`ALL_FULL_STEPS.label`，引擎/提示词/诊断共用）、vault 路径与模板源、
  落盘默认名 `新项目-{ts}`、行为匹配串（`上下文加载完成`）。
- 资源 zh/en 各 1750（+106）；新增 `tests/unit/i18n/fullwriter-i18n.test.ts` 3 例（资源级双语 +
  en 子树零 CJK；视图 DOM 级测试随子控制器批补）。
- **拆批**：`ui/full-writer/` 子控制器（project-selector-controller 等 20 个模块）为第二批
  （任务板 ZC-20261119-08）；`ui/co-writing-view.ts`（3967 行 / 625 行 CJK）为第三批
  （ZC-20261119-09）；均已定向指派 zcode。

**验收**
- 新增 3 例全绿；`check:i18n` zh/en 各 1750、棘轮收紧到 **250 文件 / 10081 条**；
  `check:bundle` main.js → **5853602**（+12062）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n17\fullwriter-view-{zh-CN,en-US}.png`（主窗口命令直开）：
  en 下视图壳/一键条/能力区全英文；剩余 CJK = 项目选择器子面板（第二批）+ 共享层
  （管线步骤名/模型快切器）+ Obsidian 自身文案。

**下一轮候选**：ZC-20261119-08 full-writer 子控制器（优先 project-selector-controller，214 行 CJK）→
ZC-20261119-09 co-writing-view → 外观页统计/桌宠块 → section-factory/section-base 骨架。

## 第七十五轮：i18n 第二期第18片 —— 项目选择器与工作台外壳（2026-11-19，ZCode · ZC-20261119-08）

**改动**
- `ui/full-writer/project-selector-controller.ts`（1143 行 / 约 110 处）95 对替换走仓外脚本
  `migrate-psel.cjs`：创作分类三层导航（复用 `settings.mode.spec.*`）、工具栏与 hero 卡、
  项目卡（封面/徽标/进度/下一章/四按钮/更多菜单）、快捷工具空态、创作流程摘要、
  长篇与短篇/剧本两组快捷工具表、预览统计、章节选择弹窗、删除项目两级确认。
  走 `fullwriter.selector.*` 90 键。
- 带迁 6 个小模块（74 键）：`quick-tools-panel.ts`（qtPanel.*）、`next-step.ts`（ns.* 21）、
  `flow-panel-controller.ts`（fp.* 15，相关工作区按钮复用 selector 键）、
  `streamlined-nav-presenter.ts`（nav.* 12，本地阶段表）、`title-bar-controller.ts`（tb.* 18）、
  `tab-controller.ts`（tab.* 7）。
- **保留数据**：`domains/*/tool-catalog.ts` 工具名（94 个，「快捷工具」标题即来自此——
  同 MCP「工具名是数据」边界，记 backlog）；`shared/creation-flow.ts` 阶段名与 progressText；
  `meta.unitLabel`（落盘元数据）；章号解析正则；「无项目」行为匹配串。
- 资源 zh/en 各 1948（+198）。

**坑**
- **占位符一致性按出现次数计**：zh `{unit}` 出现 2 次、en 出现 3 次也报不一致
  （`ns.skeletonDesc` 踩过）——不只查占位符集合。
- 迁移脚本 import 锚点失败也要检查是否已写入（第一版脚本 write 在 exit 之前，
  二次运行会误报 MISSING——本片改为先查后写并手工补 import）。

**验收**
- `check:i18n` zh/en 各 1948、棘轮收紧到 **249 文件 / 9846 条**（7 个文件移出或下降）；
  `check:bundle` main.js → **5872472**（+18870）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n18\fullwriter-view-{zh-CN,en-US}.png`：en 下创作分类/
  导航/工具栏/项目卡/预览/创作流程/Next 卡/标题栏全英文；剩余 CJK = 项目数据 +
  工具目录与流程阶段名（domains/shared 数据，backlog）+ Obsidian 自身。

**下一轮候选**：写作主流程深水区（template-vars-builder 340 行 CJK → scene-outline 231 →
wizard 群 300+ → step-render 106 → unit-writer 98）→ co-writing-view（ZC-20261119-09，625 行）→
外观页统计/桌宠块 → section-factory/section-base 骨架。

## 第七十六轮：i18n 第二期第19片 —— 协同写作主视图（2026-11-19，ZCode · ZC-20261119-09）

**改动**
- `ui/co-writing-view.ts`（3967 行 / 102 处文案）78 对替换走仓外脚本 `migrate-cowrite.cjs`（78/78 命中）：
  绑定与切章守卫、前置规划横幅、编辑器占位、建议区标题与状态机（等待/生成/联想/验证/取消）、
  小说排版与替换、模型与精准模式切换、剧情节点提示、程序化编辑来源标签（改写采纳/建议采纳/
  知识库标签插入/AI 质量修复/历史回填）。走顶层 `cowrite.*` 82 键。
- 保留数据：vault 路径与正则（`第N章_正文.md`）、落盘章名 `第{N}章`、行为匹配串。
- **拆批**：`ui/co-writing/`（39 模块约 1200 行 CJK）与 `ui/cowrite/`（9 模块约 282 行）为第四批
  （任务板 ZC-20261119-10，已指派 zcode）。

**验收**
- `check:i18n` zh/en 各 2030、棘轮收紧到 **249 文件 / 9751 条**；`check:bundle` main.js → **5880896**（+8424）；
  preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n19\cowrite-view-{zh-CN,en-US}.png`：en 下编辑器占位/绑定状态/
  建议区标题/通知全英文；剩余 CJK = 子模块（第四批）+ 工具目录数据 + Obsidian 自身。

**下一轮候选**：ZC-20261119-10 协同写作子模块（layout-assembly 140 → control-panel 116 →
suggestion-cards 100 → suggestion-flow 98 → monitor-cards 81 …）→ 写作主流程深水区 →
外观页统计/桌宠块。

## 第七十七轮：i18n 第二期第20片 —— 协同写作子模块全目录（2026-11-19，ZCode · ZC-20261119-10）

**改动**
- `ui/co-writing/` 全目录 20 个模块迁完（≈262 对走 6 个仓外脚本）：control-panel（控制台/
  工具按钮/模型状态/静态监控卡，52 对）、monitor-cards（注入溯源/伏笔/实体/守卫/统计，24 对）、
  brief-panel（简报/Scene 字段表/空态行动组，28 对）、suggestion-cards（候选卡/验证分卡，26 对）、
  suggestion-flow（生成流水线进度，24 对）、layout-assembly（头部/简报/预览/字体，24 对）、
  加 writing-advice / friendly-error / metrics-panel / editor-aux / markdown-toolbar / suggest-feedback /
  find-replace / editor-display / dashboard-status / word-goal / text-diff / ghost-association /
  chapter-match / asset-status / quality-popup / settlement-actions / chapter-nav / kb-reference-config /
  human-rate / kb-reference-card / suggestion-loading（合计 ≈ 83 对）。走 `cowrite.panel/monitor/
  brief/cards/flow/layout/advice/err/metrics/aux/md/feedback/find/disp/dash/goal/diff/ghost/match/
  asset/qp/settle/nav/kbref/hr/kbcard/loading.*` ≈ 340 键。
- `renderEmptySuggestions` 的默认参数是 `\u` 转义中文——grep 中文抓不到，改按正则匹配迁移。
- 保留数据：frontmatter 键（当前状态/涉及人物）、AI 提示词（quality-fix）、字体名目录、
  `shared/novel-format` 契约描述、行为匹配串（已保存/已加载、无项目）、场景正则。

**验收**
- `check:i18n` zh/en 各 2360、棘轮收紧到 **235 文件 / 9359 条**（14 个文件清零）；
  `check:bundle` main.js → **5911373**（+30477）；preflight EXIT=0。
- 实机 `D:\nw-dev-vault\_visual-i18n19\cowrite-view-{zh-CN,en-US}.png`：en 下简报/预览/字体/工具条/
  控制台/五张监控卡/建议卡全英文（CJK 294→78），剩余 CJK = 字体名 + 工具目录 +
  `shared/novel-format` 契约描述 + 项目数据。

**下一轮候选**：`ui/cowrite/` 9 模块（约 282 行 CJK：body-save 86 / live-analysis 64 …）→
写作主流程深水区（template-vars 340 → scene-outline 231 → wizard 群）→ 外观页统计/桌宠块。

## 第七十八轮：i18n 第二期第21片 —— 协同写作弹窗与存储（2026-11-19，ZCode · ZC-20261119-11）

**改动**
- `ui/cowrite/` 7 模块迁完（`migrate-cowrite-mods.cjs` 71 对 + 手工补 4 处）：
  memory-manager-modal（记忆管理器 25 处，含 E1/E3 分区与偏好类别表）、body-save-controller
  （保存守卫与状态机外 Notice，15 处）、suggestion-edit-modal（编辑验证抽屉，11 处）、
  live-analysis-controller（设定检查与 OOC/实体警告，10 处）、iterate-instruction-modal（6）、
  history-modal（6）、suggestion-history-store（文件名数据）。走 `cowrite.edit/mem/live/save/
  iterate/hist.*` 74 键。
- **保留数据/行为串**：`updateControlState("已保存"/"已加载")` 状态机串被
  layout-assembly/dashboard-status 行为比较耦合；`协同历史.json` 文件名；落盘章名 `第{N}章`；
  withTimeout 的 label 参数。
- 新增 `tests/unit/ui/cowrite-modals-i18n.test.ts` 3 例（mock Modal + FakeEl 补 focus 方法）。

**验收**
- 新增 3 例 + friendly-error/suggestion-cards 既有测试（专用键修正后）10/10 全绿；
  `check:i18n` zh/en 各 2432、棘轮收紧到 **231 文件 / 9239 条**（4 个文件清零）；
  `check:bundle` main.js → **5919027**（+7427）；preflight EXIT=0。
- 弹窗为交互态，实机以主视图截图同口径覆盖；弹窗文案由单测 + check:i18n 兜底。

**下一轮候选**：写作主流程深水区（template-vars-builder 340 行 CJK → scene-outline 231 →
wizard 群 300+ → step-render 106 → unit-writer 98）→ 外观页统计/桌宠块 → 跨层数据专项。

## 第七十九轮：i18n 第二期第22片 —— template-vars-builder 甄别式迁移（2026-11-19，ZCode · ZC-20261119-12）

**甄别结论**
- `ui/full-writer/template-vars-builder.ts`（1227 行 / 340 行 CJK）：**337 行为 AI 提示词内容与
  vault frontmatter 字段键**——`【本章镜头】视角人物…` 等 AI 指令、`c.姓名/`c.身份` 等实体
  字段读取与摘要拼接。按「AI 输入不随界面语言漂移」原则**保留并记录**（迁移它们会把
  中文小说提示词变成英文，直接影响生成质量）。
- 仅 3 处 UI 出口：降级报告 from/to/reason（经 degradation-notifier 流入链路横幅），
  迁 `fullwriter.vars.*` 3 键。

**验收**
- `check:i18n` zh/en 各 2435、棘轮 231 文件 / 9236 条（-3，文件保留在基线）；
  `check:bundle` main.js → **5919330**（+303）；preflight EXIT=0（10303 通过+3）。

**下一轮候选**：scene-outline-controller（231 行，需先甄别提示词占比）→ wizard 群 →
step-render-controller 106 → unit-writer-controller 98 → 外观页统计/桌宠块。

## 第八十轮：i18n 第二期第23片 —— 场景细纲面板（2026-11-19，ZCode · ZC-20261119-13）

**改动**
- `ui/full-writer/scene-outline-controller.ts`（1208 行 / 约 200 处 UI 文案——甄别结论与
template-vars 相反，主体为表单标签/按钮/页签/Notice）93 对替换走仓外脚本
`migrate-scene-outline.cjs`：三层页签（基本信息/冲突爽点/伏笔信息）、22 个字段标签
（含中英双写 `(pov)` 等键名后缀）、冲突/爽点类型下拉、场景统计与页脚、场景操作七按钮、
删除确认、复制弹窗、生成/复制/拆分/合并全部 Notice。走 `fullwriter.scene.*` 96 键。
- 保留数据：vault 路径（`05-步骤结果/Scene展开`）、解析键（`视角/场景时间…` 英中双取）、
落盘场景名（`新场景{N}`/`(副本)`/`(下)`）、`/\u2B50|名场面/` 与 status 行为匹配。

**验收**
- `check:i18n` zh/en 各 2531、棘轮收紧到 **231 文件 / 9172 条**（-64）；
`check:bundle` main.js → **5927291**（+7961）；preflight EXIT=0。
- 场景细纲面板在工作台写作页签内（需绑定章节后渲染），文案由 check:i18n + 代码核对兜底。

**下一轮候选**：wizard 群（wizard-controller 62 / step-renderers 213 / step-executors 61，需甄别）→
step-render-controller 106 → unit-writer-controller 98 → 外观页统计/桌宠块。

## 第八十一轮：i18n 第二期第24片 —— 向导群（2026-11-19，ZCode · ZC-20261119-14）

**改动**
- wizard 群三模块迁完（`cowrite.wiz.*` ≈ 152 键）：
  `wizard-step-renderers.ts`（107 对 + 1 处缩进差异手工补：故事结构卡/同人表单 9 字段/
  设定库/文笔风格/全书规划/批量建章/完成统计/实体生成四卡/世界观全步骤）、
  `wizard-controller.ts`（20 对：向导页签/步骤导航/上一步下一步/执行/跳过/重新生成）、
  `wizard-step-executors.ts`（21 对 + 1 处多行 Notice 按行替换：各步执行结果 Notice 与校验警告）。
- 保留数据：`addField` 第二参数（frontmatter 字段键，`作品名称` 等）、
  `getStoryOptionLabel`（shared/story-structure 选项标签）、wizard 步骤定义 label（数据）、
  vault 路径与正则、`window.confirm` 行为串。

**验收**
- `check:i18n` zh/en 各 2683、棘轮收紧到 **231 文件 / 8987 条**（-185，三模块大幅下降，
  剩余为 frontmatter 字段键数据）；`check:bundle` main.js → **5943160**（+15869）；
  preflight EXIT=0（10303 通过+3）。

**下一轮候选**：step-render-controller 106 → unit-writer-controller 98 → flow-tab / intervention
-controller 68 / batch-pipeline-runner 79 / chapter-orchestrator 71（均需甄别）→
外观页统计/桌宠块。

## 第八十二轮：i18n 第二期第25片 —— 步骤渲染与单元写作控制器（2026-11-19，ZCode · ZC-20261119-15）

**改动**
- `migrate-sr-uw.cjs` 123 对全命中（step-render-controller 51 + unit-writer-controller 72）：
  `fullwriter.sr/uw.*` 129 键。步骤渲染（阶段导航/必做标记/上下文输入清单/重新加载/故事上下文
  包 telemetry 摘要/结算状态/结果区编辑保存/结构化分析/场景细纲切换）、单元写作器（列表导航/
  AI 按钮组/参考面板/质检/单元结算/AI 状态/保存状态机）。
- **遮蔽坑再现**：`const t = result.bundle.telemetry` 回调参数遮蔽 i18n `t`——盲目重命名误伤
  i18n 调用与 `.setText`（变 `.setTextm`），三轮修正还原。
- 既有 `step-completion-rev185` 源码断言改键 + 读 zh 资源。

**验收**
- `check:i18n` zh/en 各 2764、棘轮收紧到 **231 文件 / 8830 条**；`check:bundle` main.js →
  **5955865**（+12705）；preflight EXIT=0（10303 通过+3）。

**下一轮候选**：flow-tab → intervention-controller 68 → batch-pipeline-runner 79 →
chapter-orchestrator 71 → execution-panels 62 → 外观页统计/桌宠块。

## 第八十三轮：i18n 第二期第26片 —— 流程页签与干预/执行面板（2026-11-19，ZCode · ZC-20261119-16）

**甄别结论**
- `flow-tab.ts` 无 UI 文案（仅 1 行注释），自动清零。
- `intervention-controller.ts`：UI 22 处迁移；**保留数据**——步骤名映射表（infoPlan/plotDistill/…）、
  AI 理解提示词（含 JSON schema 与规则说明，属 AI 输入）。
- `execution-panels.ts`：UI 38 处迁移（时间线/注入溯源表/失败卡/执行日志四段）；
  debug 字段类型含 boolean，插值需 `String()` 收窄。

**改动**
- `migrate-iv-ep.cjs` 60 对全命中；`fullwriter.iv/ep.*` 60 键。

**验收**
- `check:i18n` zh/en 各 2824、棘轮 **230 文件 / 8760 条**（flow-tab 清零）；
  `check:bundle` main.js → **5961108**（+5243）；preflight EXIT=0（10303 通过+3）。

**下一轮候选**：batch-pipeline-runner 79 → chapter-orchestrator 71 → execution-run-store /
entity-state-controller → 外观页统计/桌宠块 → 跨层数据专项。

## 第八十四轮：i18n 第二期第27片 —— 批处理与章节编排（2026-11-19，ZCode · ZC-20261119-17）

**甄别结论**
- 两模块 41 处 CJK 全是界面/错误提示文案（无 AI 提示词），直接迁移。

**改动**
- `migrate-bp-co.cjs` 39 对全命中（batch-pipeline-runner 19 + chapter-orchestrator 20）：
  `fullwriter.bp/co.*` 43 键。批次步骤超时/空内容/截断/骨架判定/回滚叙事（恢复+失败数+不完整）/
  结算失败四段；编排进度报告（加载上下文/合并规划/补生成/生成正文/质控/分析/结算）、
  失败自动重试、暂停与 10 分钟自动续跑。
- 跨文件复用键修正：`cowrite.genInterrupted` 改为 `fullwriter.co.genInterrupted`（独立键更稳）。

**验收**
- `check:i18n` zh/en 各 2867、棘轮 **229 文件 / 8703 条**；`check:bundle` main.js →
  **5966053**（+4945）；preflight EXIT=0（10303 通过+3）。
- **写作工作台主流程全链路 i18n 迁完**（场景→向导→步骤→单元→干预→执行→批处理→编排）。

**下一轮候选**：`ui/full-writer/` 长尾小模块（execution-run-store / batch-step-retry /
entity-state-controller / context-loader / checkup-bar 等）→ 外观页统计与桌宠块 →
跨层数据专项。

## 第八十五轮：i18n 第二期第28片 —— 写作体检条与上下文加载（2026-11-19，ZCode · ZC-20261119-18）

**甄别结论**
- `fanfic-settings-utils.ts` 67 行 CJK 是**落盘文档模板**（frontmatter 键 `作品名称:` + Markdown
  章节结构，解析与生成两侧共用）——数据保留。
- 同法复核 `ui/full-writer/` 剩余：template-vars 223（提示词）、scene-outline 44（解析键/
  落盘名）、wizard-step-renderers 36（frontmatter 字段）、wizard-types 25（类型字段名）等，
  均为数据。
- 真正 UI 文案仅 checkup-bar 28 + context-loader 16。

**改动**
- `migrate-fw-tail.cjs` 44 对全命中；`fullwriter.ck/cl.*` 41 键（体检条风险/情节线类型/
  状态标签/详情展开、上下文加载进度/失败/压缩降级/角色灵魂提取/状态快照）。
- 两处既有测试修正：checkup 详情按钮原复用带 ▲ 的 `cowrite.layout.collapse` → 独立
  `ck.collapseBtn`；rev185 源码断言改键（带参数 `t(...,` 形式）。

**验收**
- `check:i18n` zh/en 各 2908、棘轮 **229 文件 / 8651 条**；`check:bundle` main.js →
  **5969714**；preflight EXIT=0（10303 通过+3）。
- `ui/full-writer/` 的 UI 文案至此全部迁完，剩余均为数据（提示词/落盘模板/解析键/字段键）。

**下一轮候选**：外观页「写作统计与桌面宠物 / 桌宠形象」两块 → 跨层数据专项
（工具目录 94 工具名 / shared 阶段名 / 契约描述 / 状态机串，需架构决策）。

## 第八十六轮：i18n 第二期第29片 —— 写作统计与桌宠块（2026-11-19，ZCode · ZC-20261119-19）

**改动**
- 三模块 70 对全命中，`fullwriter.pet.*` 50 键：
  `ui/writing-stats-settings.ts`（11 对：统计口径说明/每日目标/状态栏开关/统计明细/打开按钮）、
  `ui/pet-image-settings.ts`（37 对：桌宠形象说明（雪碧图约定）/图片路径/选择本地与仓库图片/
  网格自动识别与行列数/预览/全部错误 Notice）、
  `ui/writing-pet.ts`（22 对：五层人物状态表/浮窗气泡/吸附边/来源菜单/周月弹层/完整统计与用量）。
- 三个文件全部清零（`ui/` 棘轮 229 → 226 文件）。
- 主题名/配色方案名按 §4 决策保留（会被写进已存方案名，随语言漂移会改名）。

**验收**
- `check:i18n` zh/en 各 2958、棘轮 **226 文件 / 8569 条**；`check:bundle` main.js →
  **5977880**（+8166）；preflight EXIT=0（10303 通过+3）。
- 实机 `D:\nw-dev-vault\_visual-i18n29\appearance-en-US.png`：统计与桌宠两块全英文，
  剩 CJK 113 全是主题名/配色方案名（§4 已决策保留）。

**下一轮候选**：跨层数据专项（工具目录 94 工具名 / `shared/creation-flow` 与
`shared/link-status-compute` 阶段名 / `shared/novel-format` 契约描述 / `updateControlState` 状态机串）——
需引擎或 agent 侧协同、或按调用方注入语言，属架构决策，建议与 DSH/用户对齐。

## 第八十七轮：i18n 跨层数据① —— 工具目录展示映射（2026-11-19，ZCode · ZC-20261120-01）

**为什么是甄别式**
- 工具目录的 `label/desc` 既做 UI 展示，也被 `getHiddenToolLabels()` 拿去做「本模式暂不支持」
  提示；工具 id 与 commandId 是行为契约，一字不能动。做法：类型加可选 `labelKey/descKey`，
  原 `label/desc` 保留为 zh 兜底，渲染走 getter（`hasMessage()` 判空后回落，与第九片
  `dimensionLabel()` 同法）。

**改动**
- `domains/{long,short,script}/tool-catalog.ts`：82 项（15 分组 + 67 按钮）全部补键。
- **键名带 mode**：`toolCatalog.<mode>.group.<slug>` / `.tool.<slug>`——同一 commandId 在三个
  模式下措辞不同（批量建章 / 批量建节 / 批量建集；生成人物 / 创建短篇核心人物 / 创建剧本角色小传），
  共用一键会让短篇误显长篇文案。
- `domains/kernel/tool-catalog-aggregator.ts`：并出 `toolGroupLabel()/toolLabel()/toolDesc()`，
  `getHiddenToolLabels()` 与 `getModeToolTitle()` 改按语言求值；`filterToolGroupsByMode()` 零改动。
- `ui/full-writer/quick-tools-panel.ts`：三处渲染点改 getter。
- 新增 `tests/unit/domains/tool-catalog-i18n.test.ts` 4 例：zh 逐字一致 / en 全英文无键名回退 /
  同 commandId 三模式各自措辞 / 过滤口径与语言无关。

**验收**
- 新增 4 例 + 既有 mode-tool-catalog 10 例 + 架构隔离 7 例 = **21 例全绿**。
- `check:i18n` zh/en 各 **3110**（+152），`ui/` 棘轮 226 文件 / 8569 条不变（跨层数据不参与棘轮）。
- `check:bundle` main.js → **5999596**（+21716）；preflight EXIT=0（10307 通过 + 3 跳过）。
- 实机 full-writer en 页工具面板：`⚡ Quick tools` / `Core writing` / `Co-writing workbench` /
  `Projects & chapters`，整页 CJK 191 → 109（余为项目数据、`按章推进大纲` 等 shared 文案）。

**下一轮**：跨层数据②（`shared/creation-flow` 阶段名，硬验收要求单测证明 zh/en 下流程推进一致）。

## 第八十八轮：i18n 跨层数据② —— 创作流程阶段名（2026-11-19，ZCode · ZC-20261120-02）

**硬验收口径（DSH 派单明确要求）**
- 语言只影响展示文案，**不影响流程推进**：新增 `tests/unit/shared/creation-flow-i18n.test.ts`，
  对 3 模式 × 4 组事实（全空 / 部分 / 全满 / 有正文未结算）逐项断言
  `id / state / ratio / primaryAction / blockedBy / overallRatio / nextStageId` 在 zh 与 en 下完全相等。

**改动**
- `CreationFlowStage` 加可选 `labelKey/descKey`（原 label/description 保留 zh 兜底），13 个阶段全部补键；
  并出 `stageLabel()/stageDesc()`（`hasMessage()` 判空回落）。
- 动态文案全部迁 `t()`：`progressText`（含 `{written}/{total}/{unit}` 插值）、`ctaLabel`、
  `blockedReason`、`doneCtaLabel()`（已完成阶段的「查看 X」）、`formatCreationFlowSummary()`。
- 覆盖 `creationFlow.<mode>.stage.<id>` + `progress/cta/blocked/summary/doneCta` 共 134 键。

**三处真修复（都是新测试逼出来的）**
1. `resolveCreationFlow()` 用 `...stage` 展开，会把**中文 label/description 原样带出**——en 下阶段名
   仍是中文。改为产出时用 getter 覆盖（id/action/weight/dependsOn 不动）。
2. **展示单位**原用 `modeUnitLabel()`（章/节/集），en 下进度串里出现「1 章 written」。改用
   `settings.mode.spec.<mode>.unitLabel`（chapter/section/episode）；`modeUnitLabel()` 保留给文件名与路径。
3. 剧本模式的 `export` 阶段漏配 labelKey（其描述是「合并全剧并导出」，与短篇「合并全节正文并导出」不同，
   必须独立键）。

**验收**
- 新增 4 例全绿；shared + 相关 ui 测试 232 文件 / 2472 例全绿；preflight EXIT=0（10311 通过 + 3 跳过）。
- `check:i18n` zh/en 各 **3244**（+134），ui/ 棘轮 226/8569 不变；`check:bundle` main.js → **6008772**。
- 实机 full-writer en 页：流程摘要与阶段名全英文，整页 CJK 109 → 84（余为项目数据与 shared 长尾）。

**下一轮**：跨层数据③（`shared/link-status-compute.ts`，注意 agent 诊断输出可能被下游比较）。

## 第八十九轮：i18n 跨层数据③ —— 设定联动状态（2026-11-19，ZCode · ZC-20261120-03）

**DSH 的警示是对的**
- 改到一半发现 `formatLinkStatusForAgent()` 的输出**随界面语言漂移**——它是 agent/LLM 的输入，
  下游 `repair-tools` / `diagnose-tools` 可能匹配措辞。若按常规「detail 直接 t()」做法，
  en 界面会让 agent 收到英文诊断，行为不可预期。
- 最终方案：**稳定值契约**——`stage.name` / `status.breakpoint` / `status.title` 与
  `stage.detail` 全部保留中文原值；另存 `nameKey/detailKey/detailParams/titleKey`，
  由 `stageName()/stageDetail()/linkTitle()` 只在**渲染时**求值。

**改动**
- `shared/link-status-compute.ts`：13 个环节名 + 43 条 detail + 3 条链路名共 59 键；
  `summarizeLink()` 加 `titleKey` 参数；三个 getter 用 `hasMessage()` 判空回落。
- `ui/views/link-status.ts`：5 处渲染点改 getter；`breakpoint` 用 `stageName()` 求值展示。
- **镜像库同步**：`scripts/lib/verify-flows-lib.mjs` 按逐字段 parity 对齐（这是门禁资产，
  `verify-flows-parity.test.ts` 会对照真源与镜像，任何漂移当场变红）。
- 新增 `tests/unit/shared/link-status-i18n.test.ts` 5 例：稳定值 zh/en 逐字相等 / detail en 全英文 /
  链路名与环节名双语 / **agent 输出与语言完全无关** / 未知环节名回落。

**验收**
- 新增 5 例 + parity 6 例 + 既有 view-banners 6 例全绿；shared+ui **451 文件 / 4449 例**全绿。
- `check:i18n` zh/en 各 **3303**（+59）；`check:bundle` main.js → **6018866**（+10094）。
- preflight EXIT=0（10316 通过 + 3 跳过）。

**踩到的门禁（值得记）**：新增导出函数/参数时 `check:jsdoc` 会要求 `@param` 齐——
`summarizeLink` 加了 `titleKey` 但 JSDoc 没补，被拦下。

**下一轮**：跨层数据④（`shared/novel-format.ts`，以甄别 + 结论为主）。

## 第九十轮：i18n 跨层数据④ —— novel-format 契约描述（2026-11-19，ZCode · ZC-20261120-04）

**甄别结论（DSH 要求本条以结论为主）**
- `BodyFormatContract` 的 `separator`（空行/单换行）与 `indent`（全角空格/Tab/无）是**结构数据**：
  `BodyWriter` 落盘与解析器逐字比对它们，**绝不能翻译**——一旦本地化，已有的书将无法被正确解析。
- 真正需要双语的只有 `describeContractShort()` 拼给人看的**展示串**。

**改动**
- 并出 `describeContractParts()`：返回 separator/indent 的 key、中文兜底、以及按当前语言求值的结果；
  `describeContractShort()` 在其上拼 `{sep} · {indent}`。资源 5 键（separator 2 + indent 3）。
- 新增 `tests/unit/shared/novel-format-i18n.test.ts` 4 例，其中**专门一条**断言：
  翻译前后 `separatorKey/separatorFallback/indentKey/indentFallback` 不变、原契约对象未被触碰。

**验收**
- 新增 4 例全绿；shared+ui **452 文件 / 4453 例**全绿。
- `check:i18n` zh/en 各 **3308**（+5）；`check:bundle` main.js → **6019597**（+731）；
  preflight EXIT=0（10320 通过 + 3 跳过）。

**下一轮**：跨层数据⑤（协同写作保存状态串，`ui/co-writing-view.ts` 的 `toggleClass` 比较是重点）。

## 第九十一轮：i18n 跨层数据⑤ —— 协同写作保存状态枚举化（2026-11-19，ZCode · ZC-20261120-05）

**这是本轮唯一一处真 bug（不是单纯减棘轮）**
- 此前保存状态是**中文文案字符串**在层间流转：`updateControlState('已保存')`。
  判脏 `isDirtyState()` 与辅助条 `toggleClass(..., state !== '已保存' && state !== '已加载')`
  都拿中文比较。en 界面下 `body-save-controller` 传的是**译文**（Saved / Editing / Save failed），
  比较恒为 true → **脏标记永远亮着、切章未保存守卫失灵**。
- 实机复现（修前，en）：初始辅助条 `Loaded` + `auxDirty=false`，输入后 `编辑中` + `auxDirty=true`
  ——状态文案竟然还是中文，说明枚举根本没传到展示层。

**改动**
- 新增 `ui/co-writing/save-state.ts`：`SaveState` 枚举（saved/loaded/editing/saving/saveFailed/
  externallyModified）、`SAVE_STATE_KEYS`、`saveStateLabel()`、`isDirtySaveState()`、`parseSaveState()`。
  **判脏只比枚举**，这是本文件存在的理由。
- `co-writing-view.ts`：`updateControlState(state: SaveState)` 内改为 `saveStateLabel()` 求展示
  + `isDirtySaveState()` 切类；调用点 `'已加载'`/`'编辑中'` → `'loaded'`/`'editing'`。
- `ui/cowrite/body-save-controller.ts`：host 接口与 4 个调用点改枚举。
- `ui/co-writing/dashboard-status.ts`：`isDirtyState()` 先 `parseSaveState()` 再判，
  兼容历史入参（`parseSaveState()` 从 `getCatalog('zh-CN')` 反查中文，不写死中文，棘轮干净）。

**踩到两个坑（都值得记）**
1. **迁移脚本的 "MISSING" 不代表没改**：脚本先 `writeFileSync` 再 `exit(1)`，
   部分命中也会留下半套改动。本轮只改到了调用点和 import，**实现体没改**——
   于是 en 下调用点传 `'editing'`、实现体仍把它当文案直接 `setText`，界面显示英文枚举名。
   实机截图才发现（tsc 和单测都不会报）。
2. **`dev-vault.mjs sync --vault=D:\nw-dev-vault` 在 Git Bash 下会被 MSYS 吃掉盘符**，
   产物落进仓内 `nw-dev-vault/`（假的"同步成功"），实机跑的还是旧 bundle，
   于是第一次 en 截图仍然显示「编辑中」。必须写正斜杠 `D:/nw-dev-vault`，
   并 `md5sum` 对比仓内与 vault 内 main.js 才算同步成功。

**验收**
- 新增 `tests/unit/ui/save-state-i18n.test.ts` 5 例（判脏与语言无关 / en 下传 zh 文案仍正确 /
  en 文案 / 展示无键名回退 / parse 三形态）；`co-writer-save-identity.test.ts` 的 host 断言改枚举。
- shared+ui **453 文件 / 4458 例**全绿；`check:i18n` zh/en 各 **3310**、棘轮 **226 文件 / 8564 条**
  （co-writing-view 82→77）；`check:bundle` main.js → **6020367**（+770，已 note）。
- 实机 en：初始 `Loaded` + `dirty=false`，输入后 `Editing` + `dirty=true`（截图 _visual-i18n30）。

**下一轮**：跨层数据⑥（全仓剩余 CJK 盘点 —— `scripts/audit-cjk.mjs` + 审计文档，回答「还剩什么、为什么留」）。

## 第九十二轮：i18n 跨层数据⑥ —— 全仓剩余 CJK 分类盘点（2026-11-19，ZCode · ZC-20261120-06）

**产出**：`scripts/audit-cjk.mjs`（体检脚本）+ `docs/audits/2026-11-19-cjk-remaining.md`（报告）。

**脚本设计（几个非显然的决定）**
- **体检不是门禁**：退出码恒 0。门禁是 `check-i18n.mjs`（只盯 `ui/**`，只问「有没有变多」）；
  本脚本回答的是「还剩什么、为什么留」，两者职责不能混。
- **12 类判定，优先级有讲究**：`MANUAL` 人工结论排在最前——机器看不出「这个值会被写进项目
  配置再读回」；`ui/**` 排在语料判定之前——界面文件里的长文本仍是界面文案，不能因为条目多
  就判成数据。
- **形态识别而不只是路径识别**：日志看调用名（`log.info`/`console.warn`），提示词看内容骨架
  （「按以下格式/必须/禁止」+ 长文），路径看含 `/` 或形如 `01-世界架构.md`，枚举看「极短无标点」。
  只靠文件名会把 `ai-outline-generator.ts`（内嵌提示词）误判成普通引擎文件。

**收口数字**
- 1000 个文件 / **53,785 条字面量 / 305,385 字**（注释与标识符另 436,641 字）。
- **67%（205,014 字）是数据，明确保留**：corpus 104,851 + ai-prompt 58,264 +
  on-disk-template 21,476 + enum-value 9,209 + parse-key 4,251 + long-text 3,088 +
  log-message 2,359 + disk-path 1,516。
- **20%（62,283 字）该迁**：ui-copy 53,670（棘轮内）+ ui-copy-in-engine 8,613。
- **12%（38,088 字）待审**：cross-layer，报告里逐条给了结论，绝大多数是落盘契约/提示词/枚举值。

**三条保留判据（写进报告，作为以后判断依据）**
1. **落盘即契约**：值被写进 `.md`/`.json` 并在下次读回或解析。翻译 → 老数据读不出。
2. **喂模型即行为**：文本会进 LLM 的 prompt 或 tool schema。翻译 → 输出分布改变，
   对中文小说生成是不可测的回归。
3. **匹配即锚点**：正则或字符串比较依赖中文原文。翻译 → 匹配恒失败。

只有「用户可见 **且** 不落盘、不喂模型、不参与匹配」的才该迁。

**发现的真问题（不是 i18n，是架构）**
- `engine/review-agent.ts`、`engine/fingerprint-extractor.ts` 等 65 个文件（8,613 字）在领域层
  直接拼中文给用户看——展示知识泄漏到引擎。下一轮应改成「返回 `{ code, params }` 由界面求值」，
  顺带修掉分层问题，不只省 i18n。

**已知分类器误判（下一轮补）**：`engine/agent/harness/*-tools.ts` 的 `description` 会被序列化
进 LLM 的 tool schema，属 `ai-prompt`，当前被判成 `ui-copy-in-engine`。

**验收**：preflight EXIT=0；脚本三种输出模式（摘要/JSON/Markdown）实测可用；
报告数字与脚本输出逐项核对一致（205,014 + 62,283 + 38,088 = 305,385）。

**下一轮**：优先做「漏到下层的界面文案」（第 4 节 65 文件），按「返回 key 或结构化结果」改造。
暂不动 11 个旧弹窗（它们会被新版工作台取代）。

## 第九十三轮：i18n 跨层数据⑨ —— 机检收紧（三条判据可执行化，2026-11-19，ZCode · ZC-20261120-09）

**起因**：DSH 复核我上一轮的判断时指出，⑥ 的「三条判据」是人工声明，容易被「这是数据」滥用。
他的原话：「你现在的 audit-cjk.mjs 已经把『靠人工声明』变成『半机检』了，比我预期的好」——
但仍然要给一个**改了就进 diff、review 时看得见**的机制。

**做了什么**

1. **sink 检测**（判据的可执行版本）：AST 判字面量是否**直接**作为下游实参。
   disk（writeVaultText/write/create 等 11 条）、model（buildPrompt/callAI 等 8 条）、
   regex（1,253 条）、compare（`===`/`!==`/`case`，205 条）。新增 `sink-contract` 类别。

2. **只做直接实参，不做流分析** —— 这个决定值得记：
   先写了探针扫 190 处中文变量声明，**同作用域流向 sink 的只有 2 处**，
   188 处是经对象字段、返回值、模板串层层传递的。写一个看起来严谨但漏判 99% 的
   流分析比老老实实只抓能确定的更糟。

3. **closed set 白名单** `scripts/cjk-keep-allowlist.json`：`keep` 18 条（声明保留 + reason）、
   `triage` 43 条（登记待迁）。未声明一律算待迁。

4. **`--check` 门禁**（已挂 `check:cjk-keep` 进 preflight），三重拦截，实测全部生效：
   - 未声明文件数超基线 → exit 1
   - 灰区（cross-layer）字数增长 → exit 1（注入 12 字被拦）
   - **已登记待迁的文件字数增长 → exit 1**（注入 7 字被拦）

5. **tools 目录 description → ai-prompt**：agent 工具描述会序列化进 tool schema。

**自己踩到的两个坑（都是"门禁假绿"）**

坑一：第一版门禁**拦不住任何东西**。移除 review-agent 的声明后 `unclaimed` 仍是 0——
因为分类阶段已经把类别从 `ui-copy-in-engine` 改写成别的了，`--check` 再按类别筛就筛不到。
修法：加 `wasEngineCopy` 标记，记住「分类前的原始判定」。**门禁必须自己验证过会失败，
否则它和没有一样。**

坑二：「已登记待迁」变成了免死金牌。第一版只限制「未声明文件数」，
于是往已登记的文件里加中文照样通过（实测注入 7 字后 exit 0）。
补 `triageChars` 上限后拦住。**豁免「还没迁完」不等于豁免「继续往上堆」。**

**数字变化（实测）**

| 类别 | ⑥ 后 | ⑨ 后 |
| --- | --- | --- |
| ai-prompt | 58,264 | 63,166 |
| ui-copy-in-engine | 8,613 | 3,745 |
| cross-layer | 38,088 | 36,567 |
| sink-contract | — | 3,256 |

灰区基线 225 文件 / 35,082 字，已登记待迁基线 5,230 字，两者都只允许下降。

**验收**：preflight EXIT=0（含新门禁）；三重拦截各自注入验证过会 exit 1。

**下一轮**：ZC-20261120-07（链路状态单一真源，按 DSH 的裁定砍掉中文双份字段）。

## 第九十四轮：i18n 跨层数据⑦ —— 链路状态单一真源（2026-11-19，ZCode · ZC-20261120-07）

**DSH 推翻了我 ③ 的一半做法，且他是对的**

③ 我当时保留 `name`/`breakpoint`/`title`/`detail` 的中文双份，理由是「下游可能对措辞做匹配」。
DSH 复核时去查了代码：`formatLinkStatusForAgent()` 的两个消费点
（`diagnose-tools.ts:92/104`、`repair-tools.ts:181`）都是把文本**整段塞进 LLM**，
**没有任何正则匹配这些措辞**，动作选择走 `REPAIR_ACTIONS` 枚举 id。
所以「保留中文供匹配」这个理由不成立——我当时是**凭猜测做的保守决定**。

教训：稳定值契约这种设计，必须**去代码里核实消费方**，不能凭「可能有人这么用」。
我写了一大段注释论证「为什么保留」，但那论证的事实前提是错的。

**改法**

- 删除 39 个 `name` + 39 个 `detail`，`title`/`breakpoint` 也改 key。
- `formatLinkStatusForAgent()` 内部用 `translate(AGENT_LOCALE, ...)` 而非 `t()`：
  `t()` 跟 `activeLocale` 走，`translate(固定 locale)` 不跟。单测断言 en 下输出与 zh 逐字相等。
- 新增 `toAgentStatusView()`：`data.status` 面向 agent，直接塞 `LinkStatus` 会变成
  `{ titleKey: 'linkStatus.title.knowledge' }`——对模型无意义。该函数求值成
  `{ title, breakpoint, stages[{name,detail}] }`，字段名与改造前一致，agent 侧零感知。

**两个坑**

1. **parity 盲区**：`scripts/lib/verify-flows-lib.d.mts` 是独立类型声明文件。
   parity 测试比的是**运行时输出**，类型声明漂移**不会让测试红**——
   我是靠 tsc 报「Argument not assignable」才发现的。已在文件头加注释说明这个盲区。
2. **空值防御缺失**：删掉双份字段后，`linkTitle(status)` 在 `titleKey` 为空时
   直接把 `undefined` 传进 `t()`，崩在 i18n 内部的 `key.split('.')`。
   测试夹具与降级渲染路径会传不完整对象，已加空值防御返回空串。

**验收**
- shared+ui+engine+integration **845 文件 / 9116 例**全绿。
- 灰区 35,082 → **34,546 字**（−536，就是删掉的双份），基线已收紧。
- preflight EXIT=0（985 文件 / 10326 通过 + 3 跳过）。

**下一轮**：ZC-20261120-08（novel-format 展示带实际字符，按 DSH 的「显示语义标签 + 可见实际符号」）。

## 第九十五轮：i18n 跨层数据⑧ —— 契约描述带上可见实际字符（2026-11-19，ZCode · ZC-20261120-08）

**DSH 补的一手，补得对**

④ 我拒绝翻译 `separator`/`indent`（落盘契约），但 DSH 指出我漏了用户的处境：
en 用户看到「Blank-line paragraphing」时，**没法确认自己文件里到底是什么**。
他的解法比我的更对——不是翻译值（那会破坏契约），而是**把实际字符也显示出来**。

**做法**

`describeContractVisible()`：把实际字符转成可见符号
- `\n\n` → `↵↵`、`\n` → `↵`
- `\u3000\u3000` → `▪▪`、`\t` → `⇥`、空 → `∅`

`describeContractParts()` 从三件套扩成**四件套**：key / fallback / 语义标签 / visible。
新增 `describeContractWithVisible()` 拼成「空行分段（↵↵） · 首行空两格（▪▪）」。

UI 接线：状态栏空间有限，仍显示短形式；完整版进 `title` tooltip。

**实机验收（这一步最能说明设计是对的）**

- zh：`格式：单换行分段（↵） · 首行空两格（▪▪）（括号内为文件中的实际字符）`
- en：`Format: Single-newline paragraphing（↵） · Two-character first-line indent（▪▪） (characters in parentheses are the actual file content)`

**括号里的 `↵` 和 `▪▪` 两种语言完全相同**——用户不需要懂界面语言，只要看得见符号，
就能对上自己文件里的样子。这正是「不翻译数据 + 让数据可见」的效果，
比「翻译一个值然后告诉用户它对应什么」直接得多。

顺带：en 页 CJK 从 88 降到 68。

**踩到 TS 坑**

`BodyFormatContract.indent` 是字面量联合类型（`'\u3000\u3000' | '\t' | ''`）。
我写了穷举 + 兜底分支，但穷举完之后剩余分支被收窄成 `never`，
兜底里的 `.replace()` 直接报「Property 'replace' does not exist on type 'never'」。
解法：`const ind: string = contract.indent` 用宽类型变量跳出收窄。

**验收**
- 新增 3 例（三件套齐备且 visible 与语言无关 / 带可见字符的完整串 / 原契约对象未被触碰），7 例全绿。
- shared+ui+engine+integration **845 文件 / 9119 例**全绿。
- `check:i18n` zh/en 各 **3311**（+1 formatTitle）。
- `check:bundle` main.js → **6018781**（**−1586**）——7 删双份的收益大于本轮新增，基线已收紧。
- preflight EXIT=0（985 文件 / 10329 通过 + 3 跳过）。

**下一轮**：ZC-20261120-10（11 个旧弹窗退役清单，纯文档）。

## 第九十六轮：i18n engine 分层① —— UI 消息契约（2026-11-19，ZCode · ZC-20261120-11）

**问题**

引擎层 65 个文件 / 8,613 字中文直接拼给用户看。三重后果：
① 界面换语言改不了（不经 `t()`）；② 展示知识泄漏到领域层；③ 改文案要动引擎。

**契约**

`UiMessage = { code, params?, fallback }` + `resolveUiMessage()`。

两个非显然的决定：
- **`fallback` 必填**：引擎里的提示常在错误处理路径上，缺键时返回兜底而不是抛错——
  抛错会把「一次提示」升级成「一次崩溃」。这不是防御性编程，是语义要求。
- **对外签名用 `UiMessage | string` 联合类型**：老调用方传字符串照常工作，
  改造可以一个文件一个文件推进，不必一次性全改。

**三个代表点**

- `review-agent`（3 条 `showNotice`/`showProgress`）
- `fingerprint-extractor`（12 条进度 message）：`ExtractionProgress.message` 放宽为 `UiMessageLike`。
  改完 tsc **当场报出** `ui/fingerprint-library-modal.ts:296` 的消费方漏点——
  这正是分层的价值：类型系统帮你找出所有需要求值的地方，不用靠 grep。
- `step-modal-controller`（2 条校验提示）

**回退了一处（值得记）**

我先试了 `character-consistency-checker` 的 `summary`，结果 tsc 报出
`analysis-report-engine` 与 `heavy-task-worker-manager` 的 **worker 边界**结构依赖——
worker 之间不能传对象。回退，留给 12 按域处理时专门设计（可能需要「worker 内保持 string，
主线程侧转 UiMessage」的边界转换）。

**验收**
- 新增 8 例（zh/en 求值 / 未知 code 回落不抛错 / 参数透传 / string 兼容 /
  两形态判别 / 进度消息双语 / 导出唯一防重复实现）。
- shared+ui+engine+integration **846 文件 / 9127 例**全绿。
- `check:i18n` zh/en 各 **3328**（+17）。
- `check:bundle` main.js → **6021295**（+2514）——契约基础设施的一次性成本，
  后续 12 批量迁移不再增加。
- preflight EXIT=0（986 文件 / 10337 通过 + 3 跳过）。

**踩到的门禁**：我替换 `export class StepModalController` 时把它的 JSDoc 注释挤成了孤儿，
`check:jsdoc` 报「已注释导出从 2 降到 1，未注释导出从 0 增到 1」。修法是把注释移回类前。

**下一轮**：ZC-20261120-12（按域批量迁移 ui-copy-in-engine）。

## 第九十七轮：i18n engine 分层② —— 按域批量迁移（2026-11-19，ZCode · ZC-20261120-12）

**结果**：`ui-copy-in-engine` **5,230 → 1,908 字**，达到 DSH 定的 ≤2,000 目标。

**按域提交（两批）**
- 批 1 `dc8d7c28`：`review-agent`（15 条）+ `font-manager` 字体预设 labelKey（11 条）+ `attachment-service`（2 条）
- 批 2：`api-connectivity-service`（13）+ `step-definitions`（6 校验 + 11 步骤名）+
  `quality-scorer`（8 组规则 name/desc）+ `post-generation-check`（9）+ `publication-profile`（3）

**必须补的两条审计判定（否则数字虚高）**

迁移过程中发现：**「加了 key 但保留中文兜底」这种形态，审计脚本认不出来**，数字不降。
这是真正的漏洞——如果脚本只认「中文消失」，那平台鼓励的做法（保留兜底 + 加 key）
反而不被承认，会逼着人删兜底。补了两条：
- `hasKeyCompanion` 认两种形态：对象里的 `field` + `fieldKey` 伴生、`uiMessage(code, '中文兜底')` 调用式；
- 命中过半即判 `structured` —— 中文已退化为兜底值，不再直接上屏。

**两处按判据改判（不迁，反而更诚实）**
- `shared/optimization-advisor.ts`：`reason` 是决策理由，输出给 CLI 与 agent —— 属 `ai-prompt`；
- `services/constraint-block-service.ts`：`assemble()` 组装的是**喂给 LLM 的本章约束块**
  （人物卡/伏笔/节奏要求），是 prompt 内容不是界面文案 —— 属 `ai-prompt`。

后一条尤其值得记：它被分类成 `ui-copy-in-engine` 是因为「短句 + 像给人看的」，
但读代码就知道这些串是拼进 prompt 的。**审计脚本判形态，人判语义**——这也是为什么
`MANUAL` 白名单要存在。

**剩余 1,908 字 / 32 文件**（长尾，单文件均 <200 字）：`model-discovery`(184)、
`state-advice`(158)+`wiring`(144)、`step-runner-retry`(122)、`project-migration-service`(116)、
`fact-maintenance`(109)、`rule-engine`(105)、`ledger-link`(104)…

**踩到的门禁**：三处导出（`BODY_CHANGE_INVALIDATED_STEPS` / `ApiConnectivityLevel` / `NameResolver`）
因为是「常量表插在了它们前面」，被 `check:jsdoc` 判成「新导出缺注释」——补 JSDoc 解决。
这个坑值得警惕：**插入代码块的位置会影响门禁的「新增」判定**。

**验收**：preflight EXIT=0（986 文件 / 10337 通过 + 3 跳过）；`check:i18n` zh/en 各 **3411**；
`check:bundle` main.js → **6036579**（+15,284，54 条资源 + 5 个域常量表，已 note）。
## 第九十八轮：i18n 第二期第30片 —— 知识库视图链（2026-11-19，DSH）

**范围**：`ui/views/knowledge-base-view.ts`（3,269 行 / 306 行非注释中文 / 2,030 字，
`node scripts/audit-cjk.mjs` 判 `ui-copy`）。选它的理由：知识库是剩下最大的未迁视图，
且一文件塞满书架 / 详情 / 任务监控 / 向量对账 / 题材编辑五个面，切一刀比按面切五刀便宜。

**改动**：迁 `knowledgebase.*` **244 键 / 17 组**（common 7 + tab 4 + dim 10 + view 21 + list 34 +
reconcile 15 + revectorize 4 + detail 23 + batchClassify 7 + genre 26 + tasks 55 + books 10 +
deconstruct 14 + deleteBook 4 + tags 3 + monitor 5 + provider 2）。三个模块级常量必须改函数
（模块加载时还没有语言上下文）：`MAIN_TABS` → `mainTabs()`、`BOOK_DETAIL_TABS` → `bookDetailTabs()`、
`DIMENSION_LABELS` → `bookDimensionLabels()`——注意 :2995 已有局部变量
`const dimensionLabels = dimensions.map(...)`，函数若同名会遮蔽 `t`，所以取 `bookDimensionLabels`。
对外 API `getDimensionLabels()` 保留、内部改成每次调用求值（`:626`）。保留中文 = 38 处 `log.*`
（如 `log.error('[KnowledgeBaseView] 加载书籍列表失败:', e)`）、注释、题材名 / 书名 / 标签数据。

**三个坑（都写进 i18n.md §9）**
1. **扁平点号键静默失效**：资源写成 `'tab.books': "Books"` 时，`lookup()`（`i18n/index.ts:144`）
   按 `.` 下钻，`knowledgebase.tab` 不存在 → 整页显示键名；而 `flattenMessages` 拼出的串与扁平键
   完全相同，`check:i18n` 的「键可解析」全绿。修法是资源一律写嵌套对象，并补
   `tests/unit/i18n/i18n-core.test.ts` 两条结构守卫（点号键路径必须为空 +
   `translate(locale,key) === flattenMessages(...)[key]`）。
2. **bundle 不同步**：`D:\nw-dev-vault` 是独立真实目录，改完必须
   `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`，否则截图跑的是几天前的旧产物
   （症状：命令面板已英文、页面仍中文）。`status` 只认默认 vault，别拿它判断 D 盘那份。
3. **英文比中文长**：4 个频道页签（`Male-oriented`）在窄栏断词、工具栏 5 个按钮把搜索框压到只剩
   `Search tit`。修法：容器 `flex-wrap: wrap`、页签 `white-space: nowrap`、搜索框
   `flex: 1 1 150px; min-width: 150px`，并把 en 页签压成 `Male` / `Female`。

**验收**：`check:i18n` zh/en 各 **4226**、无法解析键 0、动态键 25 处、棘轮 **223 文件 / 7345 条**；
`npx vitest run tests/unit/ui/kb-*` 5 文件 **73 例** + `i18n-core` **26 例**；`npx tsc --noEmit` EXIT=0；
实机 zh/en 各 1096×1330（`D:\nw-dev-vault\_visual-i18n20\kb-{zh-CN,en-US}.png`），zh 与改前逐像素相同
（sha `1bd64fa9…`）；`check:bundle` main.js **6,074,207**（+23,714）、styles.css **799,303**（+86）。

**未做（记 backlog）**：`ui/views/kb-format.ts`（23 条 / 500 字：`BREAKDOWN_STATUS_LABELS` 5 档、
`TASK_STATUS_LABELS` 6 档、`CHANNEL_LABELS`、`UNKNOWN_WORD_COUNT_LABEL`、`formatWordCount`
`{n} 字`/`{n} 万字`、`formatDuration` `2小时5分`）——单位与复数要按语言重设计，只迁状态表会留下
「已完成 + 374.4 万字」半英半中，整文件留独立切片。

**下一轮候选**：`ui/views/kb-format.ts`（500 字，收尾知识库面）、`ui/generate-character-modal.ts`
（873 字）、`ui/views/kb-panels-logic.ts`（1,143 字）。

## 第九十九轮：i18n 第二期第31片 —— 知识库卡片格式层（2026-11-19，DSH）

**范围**：`ui/views/kb-format.ts`（167 行 / 23 条 500 字，`audit-cjk` 判 `ui-copy`）。
选它是第30片刻意留下的尾巴：不迁它，en 界面就是「Completed 徽标 + 374.4 万字」半英半中。

**改动**：迁 `knowledgebase.format.*` **20 键**（breakdown 5 + task 6 + channel 3 + unknownWordCount 1 +
word/wordWan 2 + durationHm/durationMs/durationS 3）。`BREAKDOWN_STATUS_LABELS` /
`TASK_STATUS_LABELS` / `CHANNEL_LABELS` 三张中文表改成资源键表（`*_KEYS`），三个 `formatXxxLabel()`
由 `t(key)` 求值、未知值仍原样返回；**删掉导出常量 `UNKNOWN_WORD_COUNT_LABEL`**
（`formatWordCount()` 内直接取键）。单位走「同一键按语言换计量单位」（第十片指纹库路数）：
zh `{n} 字` / `{n} 万字`（数字后**有空格**）、en `{n} words` / `{n}k words`；时长 zh 无空格
（`2小时5分` / `3分20秒` / `45秒`）、en `2h 5m` / `3m 20s` / `45s`。`INVALID_DATE_LABEL`（`—`）
与 `WORD_COUNT_WAN_THRESHOLD`（10000）不含文案，保持常量。唯一消费方
`ui/views/knowledge-base-view.ts:36-42` 的 7 个导入签名零改动，视图代码一行未改。

**坑（已写进 i18n.md §9）**
1. **PowerShell 没有 `tail`**：`npm run build 2>&1 | tail -4` 整条失败，但紧跟的
   `dev-vault.mjs sync` 照样「更新 4 个文件」（复制旧产物）——症状是截图与改动前逐像素相同、
   `grep 新键 main.js` 为 0。「build 没跑」和「改动没生效」长得一样，改完先 `grep` 一次新文案再截图。
2. **删导出的连锁反应**：`check:jsdoc` 按「已注释导出数」棘轮，删掉一个导出会报
   `已注释导出从 10 降到 9`；覆盖率没降（100%）时用 `npm run check:jsdoc -- --update-baseline` 收紧。
3. **en 剩余 CJK 要归因**：本片后 en 剩下的中文全是数据/跨层（题材名、书名、标签、provider、
   诊断串）或`knowledge-capability.ts` 的横幅计数标签——后者已记 §7 backlog，不要当本片回归。

**验收**：`check:i18n` zh/en 各 **4246**、无法解析键 0、动态键 26 处、棘轮 **222 文件 / 7322 条**；
`npx vitest run kb-format + i18n-parity + i18n-core` 3 文件 **53 例**；`npx tsc --noEmit` EXIT=0；
实机 zh/en 各 1096×1330（`D:\nw-dev-vault\_visual-i18n20\kb-{zh-CN,en-US}.png`）——
zh 与改前逐像素相同（sha `1bd64fa9…`），en 卡片变 `Completed` 徽标 + `猫腻 · 374.4k words`；
`check:bundle` main.js **6,075,680**（+1,473）、styles.css **799,303**（未变）；preflight **EXIT=0**（984 文件 / **10,301 通过 + 3 跳过**）。

**下一轮候选**：知识库能力横幅计数标签 + 卡片 chrome 合成一片
（`knowledge-capability.ts` 297 字 / `kb-panels-logic.ts` 216 字 / `kb-detail-actions.ts` 112 字 /
`kb-card-logic.ts` 51 字 / `kb-stats-panel.ts` 52 字 / `kb-task-panel.ts` 37 字）；之后
`ui/generate-character-modal.ts`（873 字）。

## 第一百轮：i18n 第二期第32片 —— 知识库能力横幅 + 卡片/面板 chrome（2026-11-19，DSH）

**范围**：一次收掉知识库面的最后 8 个视图文件（合计约 765 字，`audit-cjk` 判 `ui-copy`）：
`ui/views/knowledge-capability.ts`（横幅 metrics 四标签 + 六种阶段说明）、`kb-card-logic.ts`、
`kb-panels-logic.ts`、`kb-stats-panel.ts`、`kb-task-panel.ts`、`kb-detail-actions.ts`、
`kb-config-panel.ts`、`kb-book-card.ts`。选整片是因为它们共享同一个 en 破绽：能力横幅显示
「1 书籍 / 1 已拆解 / 0 向量就绪 / 1 待处理/失败」，卡片显示「未知作者」，统计面板与任务面板同理。

**改动**：迁 `knowledgebase.*` 下 `capability` 17 + `panels` 24 + `stats` 10 + `card` 13 + `config` 9 +
`detailAction` 7，`tasks` 组补 `filterAll`/`stats×6`/`selected` 8，共 **+88 键**（4246 → 4334）。
五个导出常量一律改 getter——`KB_CONFIG_CATEGORIES`→`getKbConfigCategories()`、
`KB_GENRE_STAT_LABELS`→`getKbGenreStatLabels()`、`KB_QUALITY_DIMENSIONS`→`getKbQualityDimensions()`、
`KB_STATUS_STYLES`→`getKbStatusStyles()`、`TASK_FILTER_OPTIONS`→`getTaskFilterOptions()`；
维度短标签复用 `knowledgebase.dim.*`、拆解状态复用 `format.breakdown.*`、频道复用 `format.channel.*`。
**渲染器 `capability-banner.ts` 零改动**（阶段徽标早已走 `fingerprint.cap.stage*`，其余由调用方传入）。

**坑（已写进 i18n.md §9）**
1. **导出常量 = 锁语言**：`export const` 数组里写 `t()` 会在 import 期定格语言，必须换 getter；
   改完 grep 单测里的直接 import，会一起报 TS2724。
2. **en 值要断言真实字符串**：`knowledgebase.dim.character` 的 en 是 `Characters`（复数），
   按直觉写 `Character` 会失败——先 `translate('en-US', key)` 打印再落断言。
3. **计数标签不做复数**：en 横幅是 `1 Books` / `1 book(s) in total`，属 ICU plural backlog，不是 bug。

**验收**：`check:i18n` zh/en 各 **4334**、无法解析键 0、动态键 26 处、棘轮 **215 文件 / 7208 条**；
单测 9 文件 **151 例**（kb-card-logic 24 / kb-panels-logic 22 / kb-task-panel 33 / kb-stats-panel 11 /
kb-book-card 17 / kb-config-panel-render 16 / knowledge-capability 5 / knowledge-capability-embedding 11 /
kb-modals-logic 12）；`npx tsc --noEmit` EXIT=0、lint 0 error（1037 warning 均存量）、
8 个文件非注释 CJK 归零；实机 zh 逐像素零差异（sha `1bd64fa9…`）、en 横幅与卡片全英文；
`check:bundle` main.js **6,086,405**（+10,725）、styles.css **799,303**（未变）；preflight **EXIT=0**（984 文件 / **10,301 通过 + 3 跳过**）。

**下一轮候选**：`ui/views/knowledge-base-modals.ts`（1,378 行 / 563 字 / 145 条，四个弹窗，第34片）、
`ui/generate-character-modal.ts`（873 字，第33片）；知识库 D 类两文件按用户裁定随视觉重构。

## 第一百零一轮：i18n 第二期第33片 —— 人物生成弹窗（2026-11-19，DSH）

**范围**：`ui/generate-character-modal.ts`（627 行，`audit-cjk` 判 ui-copy，119 条 / 873 字）。
选它是因为它是快捷工具「👤 生成人物」的唯一入口，英文界面下面板全英文、弹窗却整块中文。

**改动**：迁 `characterGen.*` **52 键**（表单与下拉 13 / 进度与失败提示 9 / 结果管理 20 /
完整性提示 6 / 入口与实体标签 4）。同一条文案重复多次的先收敛：

- `🚀 批量生成人物` 3 处（初始按钮 + 生成中 setText + 重试后 setText）→ `characterGen.generate`；
- `✏️ 改名` 5 处（1 处 `text:` + 4 处 `setText()`）、`📝 编辑` 3 处 → 单键；
- 新增模块级 `joinFields(fields)`：zh 用 `、`、en 用 `, `，供三处完整性警告/降级 reason 拼字段列表。

**保留中文（数据 / 模型输入）**：`EARLY_STAGE_HINT` 前期内容提示、补全重试提示词
（「不要用待补充」）、`collectExistingEntities` 的四个目录标签（只用于拼 AI 摘要）、
frontmatter 正则键（姓名/名称/身份/类型/所属势力/所在地点）、`content.includes('身份：主角')`、
`/身份[：:]\s*/`、摘要格式串、全部 `log.*`。迁移后该文件非注释 CJK 只剩这 40 行。

**验收**：`check:i18n` zh/en 各 **4386**、无法解析键 0、动态键 26 处、棘轮 **215 文件 / 7139 条**；
新增 `tests/unit/i18n/character-gen-resources.test.ts` 5 例（zh 逐字含 emoji、en 插值/多行/完整性提示），
与 `i18n-parity` 合跑 **2 文件 12 例**；`npx tsc --noEmit` EXIT=0、lint 0 error（15 warning 均存量）；
实机 zh/en 弹窗包围盒均 **647×528**（英文文案较长但标签自身换行，容器高度未变，无需改 CSS），
产物 `D:\nw-dev-vault\_visual-i18n33\{zh-CN,en-US}.png`，脚本 `D:\nw-tmp\snap-cg.mjs`；
`check:bundle` main.js **6,091,830**（+5,425）、styles.css **799,303**（未变）。

**坑**
1. `text:` 与 `setText()` 是两种形态，替换脚本按 `text:` 计数会把 4 处 `setText('✏️ 改名')` 漏掉——
   先 grep 全量再按形态替换。
2. 模块级常量（这里是 `entityLabel` 的默认值）不能写 `t()`，改由调用点
   `this._renderManagementPanel(t('characterGen.entityLabel'))` 传参。
3. 中英弹窗高度一致，别预设「英文一定更长要加 CSS」——先截图再决定。

**下一轮候选**：`ui/views/knowledge-base-modals.ts`（1,378 行 / 563 字 / 145 条，四个弹窗，第34片）；
知识库 D 类两文件（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`）按用户裁定随视觉重构；
散落弹窗 golden-opening 1,982 / novel-tags 1,099 / add-fanfic-setting 973 / ai-builder 864。


## 第一百零二轮：i18n 第二期第34片 —— 知识库四个管理弹窗（2026-11-19，DSH）

**范围**：`ui/views/knowledge-base-modals.ts`（1,378 行，`audit-cjk` 判 ui-copy，145 条 / 563 字）——
`ImportBookModal` / `EditBookModal` / `GenreEditModal` / `BatchOperationsModal` 四个弹窗，
是知识库视图「导入 / 批量 / 编辑 / 题材」四个按钮的唯一入口；第30~34片把知识库整条链收尾的这一片。

**改动**：1,378 → 1,275 行，**124 处 `t()`**，迁 `knowledgebase.modal.*` **99 键**
（import 22 / edit 17 / genre 33 + 嵌套 tag 4 / cat 7 / batch 16）。四条实现约定：

- **复用既有键**：`common.{cancel,back,irreversible,confirmDelete}`、`format.channel.*`、
  `dim.{character,foreshadow,technique,style,rhythm,structure}`（权重配置六项正好覆盖）、`card.unknownAuthor`；
- **两处 map 合并**：技巧分类的下拉选项（7 项）与只读展示（7 项）原本各写一份中文，
  合并到 `modal.genre.cat.*` 一组，两个调用点各自 `t()`；
- **可选数量后缀随语言**：`细分题材 ({count}) - 可选` 整句进资源，不在代码里拼 `- 可选`；
- **保留中文 = 日志**：`log.warn/error` 五行（自动分类失败 / 导入失败 / 记录分类偏好失败 /
  书籍保存失败 / 加载书籍列表失败 / 批量操作失败）。

**验收**：`check:i18n` zh/en 各 **4485**（+99）、无法解析键 0、动态键 26 处、
棘轮 **215 文件 / 7000 条**（7139 → 7000）；`kb-modals-semantic-classes` 4 例改断言
（四个主弹窗标题不含 CJK、裸 `h3` 只剩文件选择器 `t('knowledgebase.modal.import.selectTitle')`）+
`kb-modals-logic` 12 例零修改，合跑 16 例绿；`npx tsc --noEmit` EXIT=0、lint 0 error（1037 warning 均存量）；
实机 7 场景 zh/en（import-select 640×318 / import-form 640×246 / import-file 480×218 /
genre-view 640×1104 / genre-create 640×1104 / batch 640×270 / edit-book 640×724）零横向溢出，
en 下 UI 文案 CJK=0，剩余 CJK 全是 vault 数据（书名「将夜」/作者「猫腻」/内置题材名与描述/自定义标签）；
产物 `D:\nw-dev-vault\_visual-i18n34\{scene}-{zh-CN,en-US}.png`，脚本 `D:\nw-tmp\snap-i18n34.mjs`；
`check:bundle` main.js **6,101,070**（+9,240，文案外置）、styles.css **799,303**（未变）；
preflight **EXIT=0**（985 文件 / **10,306 通过 + 3 跳过**），日志 `D:/nw-tmp/preflight-i18n34.log`。

**坑**
1. **截图前查 `theme`**：开发 vault 插件 `data.json` 残留 `"theme": "dark"` 时
   `core/theme-manager.ts:236` 把 `--nw-text-primary` 写成 `#f0ece4`，亮色界面下弹窗标题成奶油色，
   看着像「文案迁移导致标题发灰」的回归——探针读 `getComputedStyle(h3).color` 才定位到。
   截图脚本前置 `theme !== 'auto'` 就改回 `auto` 再启动。
2. **四个 Modal 共用一个文件**：类名/键名前缀要按弹窗分组（`modal.import.*` / `modal.genre.*`），
   否则 `title` / `save` / `cancel` 这类通用词会互相覆盖。
3. 判定「迁移完成」看非注释 CJK 行数（本片剩 5 行日志），不要看字面量条数——日志行本身也会计入。

**下一轮候选**：散落弹窗 golden-opening（1,982 字）/ novel-tags（1,099）/ add-fanfic-setting（973）/
ai-builder（864）；知识库 D 类两文件（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`）
按用户裁定（m16938）随视觉重构；第三期补齐 en 并逐面量布局（I18N-06）。


## 第一百零三轮：i18n 第二期第35片 —— 新建长篇小说项目弹窗 + 创建服务 + 项目名校验（2026-11-19，DSH）

**范围**：`ui/create-project-modal.ts`（490 行 / 55 条含中文）、`ui/services/project-create-service.ts`
（473 行 / 42 条）、`shared/project-name.ts`（119 行）。用户 m18689「开始下一步」后按顺序取的第一片；
新建入口是「长篇小说」模式唯一的建项入口，服务层与 shared 校验都被它直接显示。

**改动**：迁 **64 键** —— `createProject.*` 45（标题/名称/AI 随机构思 + 五种失败提示/题材与标签/
创作类型/项目类型原创与同人/设定库导入六态/简介/取消与创建/覆盖确认）、`createProject.service.*` 12
（创建中 Notice、五个 `reason`、模板与结构初始化失败、复制失败清单、`listSep`、创建完成 Notice）、
`projectName.*` 7（空/太短/太长/非法字符/保留目录/Windows 保留名/重名）。四条约定：

- **服务层也迁**：五个 `reason` 是弹窗直接显示的错误文案，留在 service 里会把语言定格在调用时刻；
  分批完成的 `warnings` 与复制失败清单同理（`listSep` 让 `.join()` 分隔符随语言）。
- **shared 允许 `t()`**：`project-name.ts` 被四个弹窗共用（新建/改名/AI 构建/世界观生成），
  七条提示写进函数体内（不是模块级常量），每次校验时求值。
- **保留中文**：AI systemPrompt/userPrompt、五组素材数组、题材标签值（玄幻…末世）、`.project` 解析正则
  `/作品名称:\s*(.+)/`、模板名过滤 `模板`、模板路径与 frontmatter 段名。
- **`fanfic-gate-audit` 改断言**：原本硬断言 service 源码含「所选同人设定尚未通过人工审核」，
  改成断言键名 `createProject.service.denyNotApproved`（仍锁「service 里出现这条文案的键」）。

**验收**：`check:i18n` zh/en 各 **4549**（+64）、无法解析键 0、动态键 26 处、
棘轮 **215 文件 / 6932 条**（7000 → 6932；两文件仍在基线，保留 AI 提示词与日志）；
新增 `tests/unit/ui/create-project-i18n.test.ts` 4 例（源码静态扫描：`text|placeholder|title:` 后无 CJK、
service 的 `reason:`/`warnings.push('`/`new Notice(` 后无 CJK、代码用到的每个 `t()` 键中英都能解析、
七条 `projectName.*` 齐全且插值保留书名）；`npx tsc --noEmit` EXIT=0、lint 0 error（1037 warning 均存量）；
实机 zh/en 三场景（`D:\nw-dev-vault\_visual-i18n35\{create-original,create-fanfic,create-picker}-{zh-CN,en-US}.png`，
640×1288，脚本 `D:\nw-tmp\snap-i18n35.mjs`）——en 标题 `New long-form novel project`、`Project name` /
`Genre` / `Creation type` / `Project type` / `Source work` / `AI brainstorm` / `Original` / `Fan fiction` /
`Cancel` / `Create project`，剩余 CJK 全是题材标签与 `shared/story-structure.ts` 的结构数据；
`check:bundle` main.js **6,107,776**（+6,706，文案外置）、styles.css **799,303**（未变）；
preflight **EXIT=0**（986 文件 / **10,310 通过 + 3 跳过**），日志 `D:/nw-tmp/preflight-i18n35.log`。

**坑**
1. **「只有新弹窗是中文」= 产物没同步**：en 下命令名、知识库视图全英文，唯独新建项目弹窗整块中文，
   一度怀疑 `setLocale()` 时序（`main.ts:1112` / `engine-registry.ts:1285` / `locale-setting.ts:37` 三处调用点全查过）。
   实为开发 vault 插件目录是**真实目录**，里面 `main.js` 还是第34片那次构建的旧包；`node scripts/dev-vault.mjs
   sync --vault=D:\nw-dev-vault`（更新 4 个文件）后即正确。判据：`grep -c 'createProject.randomBtn' main.js` 为 0。
2. **`shared/` 迁移不减棘轮**：`check-i18n` 只扫 `ui/**`，`project-name.ts` 迁完文件数与条数都不变，
   别误以为门禁没生效。
3. **en 资源里别写 vault 目录名**：`createProject.service.denyNoTemplates` 初稿写成
   `No template files found under the 元文件 folder`，被 `i18n-parity` 拦下（英文资源不许有 CJK，只放行语言自称项）；
   改成 `in the template folder`。目录名是数据，不该进 en 文案。
4. **onOpen 重的弹窗别硬搭 DOM**：`onOpen` 里有 AI 按钮、设定库下拉与 `StorySettingsEditor`，
   源码静态断言比渲染桩更稳也更敏感。
5. **既有视觉问题（非本片回归）**：弹窗内 `.nw-story-settings` 横向溢出（sw 663 > cw 545，底部出现横向滚动条），
   `.nw-story-structure-grid` 在 `styles-src/12-agent-and-structure.css:368` 是 `repeat(5, minmax(0, 1fr))`，
   卡片约 95px 宽，舞台百分比文字溢出卡片；旧包同样数值，记 backlog。

**下一轮候选**：`ui/story-settings-form.ts`（227 行 / 26 行 CJK）+ `shared/story-structure.ts` 的故事结构文案
（本片 en 截图里唯一还在中文的 UI 区域，且可顺手修上面的卡片溢出）；之后散落弹窗 golden-opening（1,982）/
novel-tags（1,099）/ add-fanfic-setting（973）/ ai-builder（864）；知识库 D 类两文件按用户裁定（m16938）随视觉重构。


## 第一百零四轮：i18n 第二期第36片 —— 故事结构表单与弹窗（2026-11-19，DSH）

**范围**：`ui/story-settings-form.ts`（250 行 / 26 行 CJK）、`ui/story-settings-modal.ts`（115 行）、
`shared/story-structure.ts`（704 行，5 套结构 / 19 阶段 / 9 组 58 个选项 / 10 条校验提示）；
顺带修第35片截图中暴露的既有视觉缺陷（结构卡片横向溢出）。

**改动**
1. 资源 `story.*` **207 键**（section 2 / structure 5×name+desc / 阶段 19×(name,purpose,beats) /
   group 9×(label,hint) / option 58×(label,desc) / warn 10 / form 15 / modal 6），zh/en 各 **4756** 条。
2. **数据与显示分离**：`structure.name`、`option.label`、`FIELD_LABELS`、`getStoryOptionLabel()` 继续以中文
   参与 `.project` 持久化（`- 结构: 起承转合`）与提示词拼装，界面只调新增的 11 个显示函数
   （`storyStructureLabel` / `storyStructureDescription` / `storyStageLabel` / `storyStagePurpose` /
   `storyStageBeats` / `storyStructureStageSummary` / `storyOptionGroupLabel` / `storyOptionGroupHint` /
   `storySectionLabel` / `storyOptionLabel` / `storyOptionDescription`）；`getStructureStageSummary` 不动
   （`story-structure.test.ts:31` 断言含「第一幕」）。
3. 10 条组合校验提示改 `t('story.warn.*')`；`validateStorySettings` 的中文 id 比较（'科技'/'血脉'/'系统' 等）保留。
4. CSS：删 `styles-src/12-agent-and-structure.css:368` 的 `repeat(5, minmax(0, 1fr))` 覆盖块（回到 :63
   `repeat(auto-fit, minmax(150px, 1fr))`）；`.nw-story-structure-card { height: auto; }`；
   `-name, -stages { min-width: 0; white-space: normal; overflow-wrap: anywhere; }`。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/ui/story-settings-i18n.test.ts` 8 例；相关 6 文件 42 例通过。
- `check:i18n` zh/en 各 4756、0 无法解析键、动态键 27、棘轮 **215 文件 / 6912 条**。
- `check:bundle` main.js **6,127,653**（+19,877）、styles.css **799,735**（+432），两基线均 --update-baseline 并写 note。
- 实机（1440×1500，`D:\nw-tmp\snap-i18n36.mjs <lang>`）：zh 面板 546×1197、en 546×1659，网格 3×167px，
  卡片 125/97px，`.nw-story-settings` 无横向溢出；en 面板内 CJK=0；截图
  `D:\nw-dev-vault\_visual-i18n36\{story-panel,story-grid}-{zh-CN,en-US}.png`。

**坑**
1. **数据键别跟着 `t()` 走**：数据层与显示层必须分开，否则英文环境建的项目切回中文解析不出结构。
2. **Obsidian 全局 button 规则**：卡片是 `<button>`，全局 `height` + `white-space: nowrap`，只删列模板不够。
3. **独立 StorySettingsModal 打不开**：探针里 plugin 没有 `port`/`agentPort`，`storyModalOpen: "no-port"`，
   该弹窗只有源码级断言，无截图，门禁里不要写它的尺寸。
4. 截图脚本要 `delete data.json.theme`（暗色残留会让标题发灰，第32/34片同坑）。

**文档**：`docs/modules/i18n.md`（§2 规模 4756 / 组清单 `story` 207 / 第36片 bullet / 未迁移面 6912 / §5 表行 /
§6 测试 / §7 backlog / §9 三条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json` / `.css-baseline.json` / `.i18n-baseline.json`。

**下一轮候选**：`ui/full-writer/wizard-step-renderers.ts`（36 非注释行）、`status-bar-controller.ts`（12）、
`shared/creation-mode.ts`（138）、`ui/full-writer/template-vars-builder.ts`（228 多为提示词）；
散落弹窗 golden-opening（1,982）/ novel-tags（1,099）/ add-fanfic-setting（973）/ ai-builder（864）。

## 第一百零五轮：i18n 第二期第37片 —— 向导步骤正文与写作台状态栏（2026-11-19，DSH）

**范围**：`ui/full-writer/status-bar-controller.ts`（全量，原 0 处 `t()`）、
`ui/full-writer/wizard-step-renderers.ts`（残留 12 处：设定库/文笔风格/世界观三步的标题、提示段、项目名行与七条统计标签）。

**改动**
1. 资源 28 键：`cowrite.wiz.*` 12 + `fullwriter.statusBar.*` 16，zh/en 各 **4784** 条。
2. 步骤名按 `currentStep.labelKey && hasMessage(currentStep.labelKey) ? t(...) : currentStep.label` 回退
   （与 `ui/full-writer/step-render-controller.ts:137` 同款），未运行时 `'—'`；持此 `check:i18n` 动态键 27 → 28。
3. 叙事结构下拉改 ``${structure.icon} ${storyStructureLabel(structure.id)}``（第36片产物），
   原先直接渲染中文 `structure.name`，en 下必漏中文。
4. 状态栏最后一处内联 style（上下文占用百分比色）删除，改修饰类
   `.novel-writer-fw-status-item--muted|--warn|--hot`（`styles-src/02-full-writer-view.css`），
   阈值 >70% / >50% / 其余，默认 `--muted` 对齐旧内联的 `var(--text-muted)`。
5. 保持中文：注释、日志、`addField(t(...), '作品名称')` 的数据键、vault 路径 `'元文件/05-同人设定库'`、正则。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/ui/full-writer-status-i18n.test.ts` 5 例，连跑 wizard/css 动画 2 文件共 25 例绿。
- `check:i18n` zh/en 各 4784、0 无法解析键、动态键 28、棘轮 **214 文件 / 6882 条**（已 --update-baseline）。
- `check:bundle` main.js **6,130,394**（+2,741）、styles.css **800,020**（+285）；`.css-baseline.json` bytes 800020、uniqueClasses 4334（+3 为新增修饰类），note 用 node 直写。
- `npm run preflight` **EXIT=0**（988 文件 / **10,323 通过 + 3 跳过**）；内联样式基线 519 → 515（去掉 status-bar 1、knowledge-base-view 2、knowledge-base-modals 2→1）。
- 实机（1440 宽，`D:\nw-tmp\snap-i18n37.mjs <lang>`）：en 状态栏 "🟢 Context loaded / Step: 📋 Plan information / Progress: 1/8 / Body tokens: ~1,400 / Context: ~84t (0%) / 💬 Dialogue · Natural rhythm / 🧬 Narrative structure" + 五个结构选项全英文；概览表 CJK=4（仅项目名）；zh 与旧版逐字一致。截图 `D:\nw-dev-vault\_visual-i18n37\{status-bar,overview,settinglib,style,worldview}-{zh-CN,en-US}.png`。

**坑**
1. **dev vault 插件目录是真实目录**（不是 junction）：`npm run build` 只更新仓库，必须
   `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault` 再截图，否则 Obsidian 跑旧包——
   症状是 en 下新文案回落中文、旧文案仍是英文，极易误判成迁移没生效。
2. 判断是否加载到新包：`view.wizardStepRenderers.renderWizardCompleteStep.toString()` 里能直接看到是否还有
   `项目名称: ${e.project}` 硬编码。
3. 渲染向导各步必须传**真实 tab**（`(view.tabs||[]).find(x=>x.project==='示例项目')`），伪造 `{project}` 会
   `TypeError: Cannot read properties of undefined`；完成步骤只有全流程结束才出现，靠直接调 `renderWizardCompleteStep` 拿统计表。
4. 等插件就绪要判 `plugin && plugin.settings`，只等 plugin 会在同步后拿到 undefined settings。
5. 世界观模板的九个模块名（世界层级体系 / 力量体系 …）是数据层内容，英文界面里仍显示中文，已记入 i18n backlog。

**文档**：`docs/modules/i18n.md`（§2 已迁移面 bullet + 棘轮 6912 → 6882 + 资源组 +28）、`docs/modules/INDEX.md`、
`docs/CURRENT.md`、`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json` /
`.css-baseline.json` / `.i18n-baseline.json`。

**下一轮候选**：`shared/creation-mode.ts`（138）、`ui/full-writer/template-vars-builder.ts`（228 多为提示词）；
散落弹窗 golden-opening（1,982）/ novel-tags（1,099）/ add-fanfic-setting（973）/ ai-builder（864）；
知识库 D 类两文件仍等视觉重构。


## 第一百零六轮：i18n 第二期第38片 —— 项目入口三件套（2026-11-19，DSH）

**范围**：`ui/home-view.ts`（235 行，38 条 / 227 字）、`ui/mode-document-modal.ts`（200 行，32 条 / 281 字）、
`ui/pre-research-modal.ts` 残留（半迁状态，27 处）；顺带在 `shared/creation-mode.ts` 加三个界面显示函数。

**改动**
1. 资源 **99 键**：`home.*` 36 + `modeDoc.*` 27 + `creationMode.*` 9 + `preResearch.hint.*` 8 / `.msg.*` 19，
   zh/en 各 **4882** 条。
2. `ui/mode-document-modal.ts` 的模块常量 `TITLES`/`DESCRIPTIONS` 改 `modeTitle(mode, kind)` /
   `modeDescription(...)` / `modeFallbackTitle()` 函数（`switch` 分支里写 `t('字面量键')`）；
   报错句从 `getCreationModeLabel` 换成 `creationModeDisplayName`。
3. `shared/creation-mode.ts` 新增 `creationModeDisplayName` / `creationModeDisplayDescription` /
   `creationUnitDisplayLabel`；**`getCreationModeLabel` 与 `getCreationUnitLabel` 一行不改**——前者喂
   `ui/full-writer/template-vars-builder.ts` 的 `vars["creationModeLabel"]` 提示词与 agent 文本，
   后者参与落盘口径。
4. 保持中文：注释、`log.*`、`localeCompare(..., 'zh-Hans-CN')` 的排序 locale 参数、vault 路径与数据键。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx vitest run tests/unit/i18n/project-entry-resources.test.ts`（新增 7 例）全绿。
- `check:i18n` zh/en 各 **4882**、0 无法解析键、动态键 29、棘轮 **212 文件 / 6773 条**（已 --update-baseline）。
- `check:bundle` main.js **6,140,578**（+10,184，99 键×2 语言进包）、styles.css **800,020**（±0）。
- `npm run preflight` **EXIT=0**（989 文件 / **10,330 通过 + 3 跳过**；活跃文档 20 个；日志 `D:\nw-tmp\preflight-i18n38.log`）。
- 实机（1440 宽，`D:\nw-tmp\snap-i18n38.mjs <lang>`）：主页 1096×992、前期调研 640×634、模式文档 640×650；
  en 下主页 CJK=12（`示例项目`/`短篇示例` 项目名 + 别的模块状态栏「今日 0 字」）、前期调研 CJK=142
  （番茄主分类 24 个选项与 `00-前期调研/` 目录名，数据层）、模式文档 CJK=20（保存路径里的项目路径）。
  截图 `D:\nw-dev-vault\_visual-i18n38\{home,pre-research,mode-doc}-{zh-CN,en-US}.png`。

**坑**
1. **模式文档弹窗截图要传带库前缀的项目路径**：`SHORT_STORY_CORE`/`SHORT_OUTLINE` 走 SHORT_ONLY
   守卫，而 `resolveProjectMode()` 靠路径前缀 `短篇小说/` 判模式，兜底 `'long'`；传裸项目名会被
   `command-ui-executor.ts:217 isBlockedByMode()` 静默拦掉（只弹 Notice）。正解
   `plugin.setWorkbenchContext({ project: '短篇小说/短篇示例' })`。
2. **行尾**：资源两份与 `home-view.ts`/`pre-research-modal.ts` 是 CRLF，`mode-document-modal.ts` /
   `creation-mode.ts` 是 LF；多行锚点按 `\n` 拼会报 `missing: import {`。
3. **`shared/workers-inline.generated.ts` 的 git 差异是构建环境漂移**：同一环境连跑两次
   `node scripts/generate-worker-inline.mjs` SHA256 一致（`A706FD34…`），保留重生成产物即可。
4. en 主页两处措辞在截图后微调（`· unit: “section”`、`, and {count} task(s) running`），改完要
   `npm run build` + `dev-vault.mjs sync --vault=D:\nw-dev-vault` 再重拍。

**文档**：`docs/modules/i18n.md`（§2 已迁移面 bullet + 资源 +99 + 棘轮 6882 → 6773 / 212 文件、§5 表行、
§6 测试、§7 backlog、§9 三条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json` / `.i18n-baseline.json`。

**下一轮候选**：散落弹窗 golden-opening（1,982）/ novel-tags（1,099）/ add-fanfic-setting（973）/
ai-builder（864）/ `ui/agent-workbench-view.ts`（126 条 / 730 字）；种子已由 `D:\nw-tmp\audit-cjk.mjs`
`--json` 给出（`ui/home-view.ts` 已迁完，下一档从 `ui/batch-create-modal.ts` 104 条 / 583 字起）。

## 第一百零七轮：i18n 第二期第39片 —— 黄金开篇工坊补漏（2026-11-19，DSH）

**触发**：用户 m20285「继续」，按「散落弹窗」候选顺序做 golden-opening。读码后发现主体 111 键已被
ZCode 迁完（5ba4ad66 + 948248e2，`goldenOpening.{common,chapters,hooks,rhythm,chars,world,scoring}`），
本片降级为补漏片——只剩题材标签、钩子类型、评分/段落标签与保存段 40 处。

**改动**：`ui/golden-opening-modal.ts`（1,452 行，CRLF）加两个模块级 helper：
`genreLabel(genre)`（14 个 case → `goldenOpening.labels.genre.*`，default 原样返回）与
`hookTypeLabel(index)`（6 个 case + `hookTypeFallback`，替掉原来的 `hookTypes` 数组）；
迁移点包括 tag 文案、章节标题（`chapterTitle` 插值）、`strengthScore` / `paraLabel` /
`charRole` / `charRelation` / `severityLine` / 两级优先级、解析兜底六处、三条 Notice
（`hookCheckDone` / `scoringDone`）与保存段四条（`exportIntro` / `exportSaveCurrent` /
`savedTo` / `pathOccupied`）。

**保留中文（数据与显示分离）**：`GENRE_OPTIONS` 与 switch 的 case 值（提示词
`题材标签：${genres.join('、') || '不限'}` 与 frontmatter `genre:` 逐字依赖）、七段
systemPrompt/userPrompt、`buildGoldenContent()` 生成的 `# 黄金三章大纲` 正文与
`tags: [黄金开篇, 大纲]`、文件名 `黄金开篇.md`、15 条 `log.*`。

**资源**：`goldenOpening.labels.*` 26 键 + `.genre.*` 14 键（`xuanhuan`/…/`competitive`/`fanfic`），
插在 `goldenOpening.scoring` 之后、`novelTags` 之前；两份资源都是 CRLF，锚点必须用 `\r\n` 拼。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx vitest run tests/unit/i18n/golden-opening-labels.test.ts tests/unit/ui/golden-opening-modal-dom.test.ts`（新增 6 例 + 原有 5 例）全绿。
- `check:i18n` zh/en 各 **4922**、0 无法解析键、动态键 29、棘轮 **212 文件 / 6755 条**（已 --update-baseline）。
- `check:bundle` main.js **6,144,654**（+4,076，40 键×2 语言进包）、styles.css **800,020**（±0）。
- `npm run build` + `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`（更新 4 文件）。
- 实机（`D:\nw-tmp\snap-i18n39.mjs <lang>`）：zh chapters 640×605 / cjk 95、hooks cjk 93、scoring cjk 67
  （全是题材数据与提示文字）；en **三场景 cjk 全 0**，题材标签全英文，仅因英文更长由两行变三行使
  chapters 弹窗 758 → 793（预期）。截图 `D:\nw-dev-vault\_visual-i18n39\{golden-chapters,golden-hooks,golden-scoring}-{zh-CN,en-US}.png`。
- `npm run preflight` **EXIT=0**（990 文件 / **10,336 通过 + 3 跳过**；日志 `D:\nw-tmp\preflight-i18n39.log`）。

**坑**
1. **页签不能按文案点**：en 下是 "🪝 Opening hooks" 而不是 "Hooks"，按文案匹配会停在第一页；
   改按索引 `document.querySelectorAll('.nw-go-tabs button')[1]` / `[5]`。
2. **键名与代码要一次对齐**：代码写 `genre.sports`、资源写 `competitive` 时 `check:i18n` 直接报
   「t() 引用了资源里不存在的键」，改代码对齐成本最低。
3. **动工前先 grep 已迁范围**：`grep "t('goldenOpening"` 一眼看出主体已迁，避免整片重做。

**文档**：`docs/modules/i18n.md`（§2 已迁移面 bullet + 资源 +40 + 棘轮 6773 → 6755 / 212 文件、§5 表行、
§6 测试、§7 backlog、§9 三条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json` / `.i18n-baseline.json`。

**下一轮候选**：散落弹窗 novel-tags（1,099）/ add-fanfic-setting（973）/ ai-builder（864）/
`ui/agent-workbench-view.ts`（126 条 / 730 字）；`D:\nw-tmp\audit-cjk.mjs --json` 给出的下一档仍是
`ui/batch-create-modal.ts` 104 条 / 583 字。

## 第一百零八轮：i18n 第二期第40片 —— 同人设定弹窗残留 + 两处样式修复（2026-11-19，DSH）

**触发**：用户 m20511「继续」。按「散落弹窗」候选顺序，golden-opening 已完成（第39片），
novel-tags 读码后跳过（UI 已全迁，余 1,099 字全是两段 AI 提示词、生成文档正文与解析正则键），
本片做实机确认过的 `ui/add-fanfic-setting-modal.ts`（772 行，CRLF，973 中文字）。

**改动**：迁 36 处 / **37 键** `addFanfic.flow.*`——Notice（needWorkName / needUrl / sourceExists /
needProjectForResearch / needProject / needCredentials / kbNotReady / needCanonSources）、
确认框（overwriteConfirm）、按钮态（searching / retrievingMaterials / materialsReady / verifyingSources /
crossChecking / generatingDraft / generatingFromCanon / selected）、导入统计（sourceSummary）、
待审核标题（pendingTitle）、模板两条（templateDraftCreated / templateEnsured / approvedTo）、
绑定三条（needSettingFile / emptySettingFile / boundToProject / boundMissing）与报告五行
（reportMaterials / reportSources / reportContradicted / reportUnverified / reportSourceFailed /
reportSavedPending / auditBlocked）。
文件原本已有 65 处 `t()` 用机械命名 `addFanfic.common.k1-k13` + `addFanfic.ui.k1-k31`（44 条）——
**不重命名旧键**（65 处调用零改动），新键只加语义子组；`ui.k12`（🌐 联网检索官方资料）与
`ui.k27`（选择设定文件）直接复用。

**保留中文（数据与显示分离）**：题材默认值 `value: '玄幻'`、落盘文件名 `'新同人设定'`、
vault 路径 `元文件/05-同人设定库`、检索关键词、四处占位数据（（待补充）/未知/
（待核实：知识库素材未覆盖）/（待核实：未找到可靠原作来源））、审核 meta 键名（审核状态/来源数量/
来源哈希/生成时间）、两段 AI 提示词、`log.*` 与注释。

**顺带修三处既有缺陷（截图校正发现）**
1. **表单控件被压扁裁切**：contentEl 同时是 `.modal-content`（flex 列 + `max-height`）与 `.nw-form-stack`，
   子项默认 `flex-shrink:1` → 三个 `.nw-card` 被压到 221/93/18px，内容再被 `.nw-card{overflow:hidden}`
   裁掉，「原作资料来源」卡里只剩标题与说明段。修法：`styles-src/09-rev184-192.css` 加
   `.nw-form-stack > * { flex: 0 0 auto; }`（影响同用该类的 10 个弹窗，语义都是「内容超高时不再被裁」）。
2. **degraded 胶囊红底红字**：`.nw-is-degraded .nw-capability-stage` 的 `color: var(--text-error)`
   在暗色主题下等于隐形，改 `var(--text-normal)`（同时影响知识库与写作指纹库能力横幅）。
3. **重复「约束流状态」横幅**：`refreshLinkStatus()` 开头 `empty()`、await 后 append，onOpen 与
   `renderSourceList()` 同时触发时在 `await readFanficRules(...)` 处交错 → 两条相同横幅。
   修法：清空挪到 await 之后、紧贴 `renderLinkStatus(...)`。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx vitest run tests/unit/i18n/add-fanfic-flow.test.ts` 4 例通过（新增文件）。
- `check:i18n` zh/en 各 **4959**、0 无法解析键、动态键 29、棘轮 **212 文件 / 6701 条**（已 --update-baseline）。
- `check:bundle` main.js **6,149,434**、styles.css **800,471**（+451，两处 CSS 修复）。
  `check:css` bytes 800471 / uniqueClasses 4334 / important 24 / hardcodedHex 192 / rgbHsl 223。
- 实机（`D:\nw-tmp\snap-i18n40.mjs <lang>`）：zh/en 各 1 场景（强约束弹窗 680×900，零横向溢出），
  en 下 UI 文案 CJK=0（余 45 字是 `DeviationDetector 条件分析器未注入: rhythmAnalyzer` 运行时串）；
  修复后来源卡表单完整可见、右侧出现滚动条。截图 `D:\nw-dev-vault\_visual-i18n40\modal-{zh-CN,en-US}.png`。
- `npm run preflight` **EXIT=0**（991 文件 / **10,340 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n40.log`）。

**坑**
1. **弹窗截图入口避开 `checkCallback`**：`app.commands.executeCommandById('novel-writer-add-fanfic')` 返回 false，
   要用 `plugin.commandUiPort.executeCommand(id, {})`（`shared/command-ui-port.ts:36`）；但
   `ui/command-ui-executor.ts` 的 ADD_FANFIC 分支只读 `getActiveProject()`、忽略 payload.project，
   CDP 下需临时 `p.getActiveProject = () => '示例项目'`。
2. **探针脚本必须 .mjs**：从 snap 脚本复制 boilerplate 时写成 `.cjs` 会报
   「Cannot use import statement outside a module」。
3. **连续跑两个语言会撞 vault 锁**：zh 那次曾整批输出 `{"missing":true}`，单独重跑即好。
4. **`check-bundle` 的脚本名是 `scripts/check-bundle.mjs`**；`check:css` 才是 `scripts/check-css.js`。

**文档**：`docs/modules/i18n.md`（§2 资源 4959 + 资源链 +37 + 已迁移面 bullet + 棘轮 6755 → 6701、§5 表行、
§6 测试、§7 backlog、§9 三条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json` / `.css-baseline.json` /
`.i18n-baseline.json`。

**下一轮候选**：散落弹窗 novel-tags（1,099，UI 已迁完则跳过）/ ai-builder（864）/ polish-editor（823）/
ideation（793）/ batch-import（750）/ `ui/agent-workbench-view.ts`（126 条 / 730 字）；
知识库 D 类两文件（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`）等视觉重构（用户 m16938）。

## 第一百零九轮：i18n 第二期第41片 —— AI 世界元素生成器（2026-11-19，DSH）

**触发**：用户 m20900「那就按顺序进行」（第40片之后的候选顺序：ai-builder → polish-editor → ideation → batch-import）。

**范围**：`ui/ai-builder-modal.ts`（1,133 行，CRLF）。文件原已有 65 处 `t()` 用机械命名 `aiBuilder.common.k1-k10` + `aiBuilder.ui.k1-k52`（62 条），
本片补剩下的 30 处界面文案，新键走语义子组 `aiBuilder.flow.*`（38 键），旧键不重命名。

**改动**
1. 迁 30 处：仪表盘标题与「已有 N 个」、生成页标题与副标题、单条/批量表单的 label 与 placeholder、
   「❌ 请输入 X 名称」与「❌ 请先配置 API 密钥…」、生成进度（`⏳ 正在生成角色 (1-10/20)...`）、批次失败汇总、
   完整性校验与保存结果（`「X」未通过完整性校验，未保存。缺少：…` / `人物已保存：2 个 → 项目`）、
   世界观保存后的自动改名三种分支（成功改名 / 已自动命名 / 名称不可用保留原名）、覆盖确认 `window.confirm`。
2. **顺带修真实 bug**：`const ENTITY_TYPES: EntityTypeConfig[]` 是模块级常量，`label/description` 里调用 `t()`，
   只在模块加载时求值一次 → 切换语言后卡片标题/描述仍是旧语言。改成 `const entityTypes = (): EntityTypeConfig[] => [`，
   三处调用点（`wvCfg` / `charCfg` / `for (const cfg of entityTypes())`）同步。
3. 保留中文：两段角色修补提示词（`repairSystem` / `repairPrompt`）、模板文件名 `世界观总览模板.md` / `人物模板.md`、
   项目名正则与三个姓名提取正则、AI 需求片段（题材倾向 / 故事逻辑方针 / 批量生成要求）、
   校验器契约串（正文分节 / YAML frontmatter 未闭合）、全部 `log.*` 与注释。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/i18n/ai-builder-flow.test.ts` 4 例（38 键双语可解析 / en 零 CJK / zh 逐字插值 9 条 / en 插值 11 条），
  与既有 `tests/unit/ui/ai-builder-modal-dom.test.ts` 3 例合跑 7 例绿。
- `check:i18n` zh/en 各 **4997** 条、无法解析键 0、动态键 29、棘轮 **212 文件 / 6643 条**（已 --update-baseline）。
- 实机 `D:\nw-tmp\snap-i18n41.mjs <lang>`：zh/en 各 5 场景（dashboard / project / worldview / char-single / char-batch，1300×900），
  零横向溢出；en 下三张生成页 CJK=0，dashboard 12 字与 project 16 字全是 vault 项目名（短篇小说/短篇示例 / 示例项目）。
  截图 `D:\nw-dev-vault\_visual-i18n41\{scene}-{zh-CN,en-US}.png`。
- `npm run preflight` **EXIT=0**（992 文件 / **10,344 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n41.log`）；`check:bundle` main.js **6,154,730**（+5,296）、styles.css **800,471**（±0）；`gen:docs` 1,004 文件 / `check:docs` 20 活跃文档通过。

**坑**
1. **资源块插错父级会静默错位**：插入脚本把 `flow: {` 塞在 `ui` 收尾的 `},` 之前，键的真实路径变成 `aiBuilder.ui.flow.nameLabel`，
   `check:i18n` 只在尾部列出「t() 引用了资源里不存在的键」，不提示父级。锚点要取「`ui` 的收尾 `},` 之后」。
2. **多视图弹窗截图要按路由回退**：AI 生成器每次切视图都 `contentEl.empty()` 重渲染，进入世界观生成页后实体卡消失，
   人物单条/批量必须先点 `.novel-writer-ai-builder-back-btn`（← 返回仪表盘）再点第二张卡。
3. **表格锚点别只取分隔行**：一个文档里有多张表，用「表头 + 分隔行」两行一起做锚点才唯一。

**文档**：`docs/modules/i18n.md`（§2 资源 4959 → 4997 + 资源链 +38 + 已迁移面 bullet + 棘轮 6701 → 6643、§5 表行、
§6 测试 bullet、§7 backlog、§9 三条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：polish-editor（823）/ ideation（793）/ batch-import（750）/ `ui/agent-workbench-view.ts`（730 字）；
知识库 D 类两文件（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`）等视觉重构（用户 m16938）。

## 第一百一十轮：i18n 第二期第42片 —— 文笔润色编辑器与 AI 润色弹窗（2026-11-19，DSH）

**触发**：用户 m21171「继续」（第41片之后的候选顺序：polish-editor → ideation → batch-import）。

**范围**：`ui/polish-editor.ts`（829 行，**纯 LF，文件里没有 CRLF**）。文件原本没有 `import { t }`，
105 行含中文；本片迁 54 组 / **70 键** `polishEditor.*`。

**改动**
1. 迁 54 组：编辑器标题与三个按钮（✨ AI润色 / 📊 节奏分析 / 🎨 风格指南）、四个实体图例、
   自动保存四态（💾 已保存 / 保存中… / 内容过短 / 💾 已保存 {time} / 保存失败）、八条 Notice、
   节奏面板（整体节奏 / 段落数 / 拖沓段 / 紧张段 / 建议 / 段落详情 / 密度与张力）、风格指南面板
   （标题 / 空态 / 偏好风格 / 避免风格）、弹窗五段（润色范围 / 润色风格 / 写作指纹开关 / 进度 / 结果对比）、
   结果三按钮（应用 / 重试 / 取消）。
2. 新增 6 个 switch helper：`polishScopeLabel` / `polishStyleLabel` / `entityTypeLabel` /
   `entityLegendLabel` / `paceLabel`（medium 与 balanced 共用 `pace.medium`）/ `segmentTypeLabel`，
   键写成 switch 分支字面量（避免 check:i18n 记动态键）；`paceLabels` 与段落 `typeLabels` 两个
   模块级 Record 删除。
3. **顺带修真 bug**：弹窗原本用 `this.selection` 存选中文本，与 Obsidian `Modal` 基类 `open()` 写入的
   同名对象属性冲突 → `renderInputForm` 里 `this.selection.trim()` 抛
   `TypeError: this.selection.trim is not a function`，弹窗只渲染出「润色范围」一段（实测 560×176，
   按钮只有「全文润色 / 选中段落润色」两个）。改名为 `selectedText`（8 处），弹窗恢复 560×490（zh）/ 560×521（en）。
4. 保留中文：`PolishScope`/`PolishStyle` 联合类型的值、`POLISH_STYLE_HINTS`、systemPrompt/userPrompt、
   指纹附录分项名、`偏好风格：`/`避免风格：` 解析前缀、全部 `log.*` 与注释。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/i18n/polish-editor-flow.test.ts` 5 例（70 键双语可解析 / en 零 CJK /
  zh 逐字插值 10 条 / 18 条标签与源码逐字一致 / en 插值无花括号残留），
  `tests/unit/ui/polish-editor-project-d6.test.ts` 补 2 例（选中文本落在 `selectedText`、基类写 `selection` 后不受影响），
  两文件合跑 **9 例绿**。
- `check:i18n` zh/en 各 **5067** 条、无法解析键 0、动态键 29、棘轮 **212 文件 / 6578 条**（6643 → 6578，已 --update-baseline）。
- 实机 `D:\nw-tmp\snap-i18n42.mjs <lang>`：zh/en 各 4 场景（editor 1072×398 / modal-input 560×490 / rhythm 1072×692 /
  style 1072×781），零横向溢出；en 弹窗 CJK=0，编辑器与节奏面板剩余 CJK 全是样章正文与
  `engine/rhythm-analyzer.ts:200-203` 的建议句（引擎层不在 `ui/**` 棘轮内）。截图 `D:\nw-dev-vault\_visual-i18n42\`。
- `npm run preflight` **EXIT=0**（993 文件 / **10,351 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n42.log`）；
  `check:bundle` main.js **6,161,517**（+6,787）、styles.css **800,471**（±0）；`gen:docs` 1,004 文件 / `check:docs` 20 活跃文档通过。

**坑**
1. **不要用 `selection` 当弹窗字段名**：Obsidian `Modal` 基类在 `open()` 写同名对象属性，覆盖构造函数赋值；
   症状是「弹窗只渲染前半截」，定位法是给字段打一条 `typeof this.xxx`（构造时 string、open 后 object）。
2. **润色弹窗没有命令入口**：只由 `ui/full-writer-view.ts:2314 renderPolishEditor` 渲染，截图必须挂视图
   （取 leaf 的 view → 设项目/卷/章与 `stepResults['bodyGeneration']` → 造容器挂 `view.contentEl` →
   `await view.renderPolishEditor(容器)` → 点 `.nw-pe-btn`）。
3. **rebuild 后必须 `dev-vault sync`**：只 build 不同步的话开发 vault 仍跑旧 main.js，排查 bug 时日志不出来会误导。

**文档**：`docs/modules/i18n.md`（§2 资源 4997 → 5067 + 资源链 +70 + 已迁移面 bullet + 棘轮 6643 → 6578、§5 表行、
§6 测试 bullet、§7 backlog、§9 两条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：ideation（793）/ batch-import（750）/ `ui/agent-workbench-view.ts`（730 字）；
知识库 D 类两文件（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`）等视觉重构（用户 m16938）。

## 第一百一十一轮：i18n 第二期第43片 —— 脑洞构思工坊（2026-11-19，DSH）

**触发**：用户 m21482「继续」（第42片之后的候选顺序：ideation → batch-import → agent-workbench-view）。

**范围**：`ui/ideation-modal.ts`（814 行，CRLF，121 行含中文 / 117 行非注释）。文件原本没有 `import { t }`，
本片迁 59 组 / **75 键** `ideation.*`。

**改动**
1. 新增 `import { t } from '@/i18n'` 与模块级 `genreLabel(genre)`（14 个 switch 分支 → `ideation.genre.*`，
   `default: return genre`）。**题材存储值仍是中文**：提示词「类型标签：…」、`CreateProjectModal` 的 genre、
   收藏的 `selectedGenres` 全部逐字依赖，只在前端渲染处翻译（4 处：输入页标签、卡片、历史标签、详情匹配行）。
2. 迁移 59 组：标题 / 两个 tab（收藏夹带 `{count}`）/ 三步导航 / 题材输入（关键词与额外要求占位符、
   14 个题材标签、「🚀 生成10个创意」）/ 创意列表（计数、换一批、返回、冲突/卖点/综合评分）/
   详情（核心概念、建议项目名、一句话梗概、四维评分、题材匹配、推荐方向、差异化、竞争分析、保存为项目资料）/
   收藏夹空态与条目操作 / 八条 Notice / 保存脑洞弹窗 / 解析兜底「未命名创意」。
3. **顺带修两个真 bug**（都是截图才发现的）：
   - 雷达图 180×180、标签半径 `radius + 15`，左右维度名画出 svg 视口被裁（zh「爽点密度」、en
     "Satisfaction density" 都只剩半截）→ 改 220×200 画布、`centerX=110`/`centerY=100`、`radius=62`、
     标签半径 14、字号 10；图内改用短名 `ideation.dim.radar.*`（Market / Innovation / Writability / Hooks，
     中文与原全名一致），全名保留在下方评分列表；另加 `getComputedTextLength()` 越界兜底。
   - 详情「推荐方向」原本 `idea.genreMatch.map(g => g.genre).join('、')`，en 下露中文且分隔符错 →
     `.map(g => genreLabel(g.genre)).join(t('ideation.detail.recommendSeparator'))`（新键 zh「、」/ en「, 」）。
4. 保留中文：`GENRE_OPTIONS` 与 switch 的 case 值、两段提示词（systemPrompt/userPrompt）、
   `buildIdeaContent()` 生成的文档正文、文件名 `脑洞构思.md` 与路径 `04-项目总控`、4 条 `log.*`、
   `|| '玄幻'` 兜底数据、`throw new Error(\`路径已被文件占用：…\`)`。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/i18n/ideation-flow.test.ts` 6 例（75 键双语可解析 / en 零 CJK /
  zh 插值逐字 13 条 / 标签类 26 条与源码逐字一致 / 题材显示名与 `GENRE_OPTIONS` 逐字一致 /
  en 插值无花括号残留），全绿。
- `check:i18n` zh/en 各 **5142** 条、无法解析键 0、动态键 29、棘轮 **212 文件 / 6525 条**（6578 → 6525，已 --update-baseline）。
- 实机 `D:\nw-tmp\snap-i18n43.mjs <lang>`：zh/en 各 7 场景（input / favorites-empty / ideas / detail / export /
  detail-saved / favorites），零横向溢出；en 下 UI 全英文（仍余 CJK 的只有注入的中文假创意与项目名「示例项目」）。
  截图 `D:\nw-dev-vault\_visual-i18n43\`。
- `npm run preflight` **EXIT=0**（994 文件 / **10,357 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n43.log`）；`check:bundle` main.js **6,168,002**（+6,485）、styles.css **800,471**（±0）；`gen:docs` 1,004 文件 / `check:docs` 20 活跃文档通过。

**坑**
1. **截图定位要避开第一个 `.modal`**：`measure()` 内部 `locator(selector).first()`，传 `'.modal'` 时保存脑洞弹窗
   会被底层工坊挡住，截出来的高度与 detail 一模一样；该场景改为不传 selector（走 last）。
2. **SVG 内文字溢出只能靠截图发现**：DOM 探针（rect / style）全绿，标签却被 svg viewport 裁掉；
   以后凡是 `<svg>` 里画文字都要在 viewport 内留边距，并给长文案准备短名。
3. 生成页要先把 `p.aiEngine.callAI` 换成返回固定 JSON 的桩，否则真打 AI；顺带 `p._workbenchContext={project:'示例项目'}`
   才能让 `project` 有值（否则 `t('ideation.export.intro')` 的 `{project}` 是空串）。

**文档**：`docs/modules/i18n.md`（§2 资源 5067 → 5142 + 资源链 +75 + 已迁移面 bullet + 棘轮 6578 → 6525、
§5 表行、§6 测试 bullet、§7 backlog [x] + 余下重写、§9 两条经验）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：`ui/agent-workbench-view.ts`（730）/ `ui/novel-tags-modal.ts`（1,099，只剩 AI 提示词与解析正则）；
知识库 D 类两文件等视觉重构（用户 m16938）。

## 第一百一十二轮：i18n 第二期第44片 —— 批量导入五步向导（2026-11-19，DSH）

**触发**：用户 m21482「继续」（第43片之后的候选顺序：ideation → batch-import → agent-workbench-view）。

**范围**：`ui/batch-import-modal.ts`（1,765 行，CRLF）。文件原本没有 `import { t }`，本片迁 118 组 / **136 键** `batchImport.*`。

**改动**
1. 新增 `import { t }`（与 `getLocale` 一起）；三个 switch helper 取代中文常量表 —— `stepLabel(step)`（五步导航）、`themeCategoryLabel(category)`、`techniqueCategoryLabel(category)`（后两者入参是 `tagManager.getTagsByType()` 的数据键，`THEME_CATEGORIES` / `TECHNIQUE_CATEGORIES` 数组仍存中文值）；拆解维度改复用 `shared/deconstruction-settings.ts` 的 `dimensionLabel()`（与原字面量逐字一致）。**题材、标签、预设名等数据保持中文**（落盘与提示词逐字依赖）。
2. 迁移面：文件选择（三种来源、拖拽区、已选文件表、全选/取消全选/清空）、智能预览（书名/作者/字数/章节数/置信度、批量勾选）、批量设置（预设区、六维开关、并发与优先级、其它选项、题材/技巧/自定义标签三段）、导入进度（总进度 1/3 (66%)、四格统计、任务列表含 pause/resume/retry/delete、导入日志）、结果与历史（成功/失败明细、重跑、清空历史）、两个库内选择器（480 宽）、`notice` 组 14 键。
3. **顺带改字数分档**（截图才发现）：en 原本一律按 1000 折算，出现 `3460.0k words` —— 改为 `trim()` 只在 ≥100 时去尾 `.0`，≥1e6 走 `million`（zh「百万字」/ en「M words」），≥1e3 走 `wan`（zh「万字」/ en「k words」），其余落 `chars`；zh 仍 10,000 以上才折万。新增资源 `batchImport.wordCount.million`。
4. 保留中文：注释、11 条 `log.*`、AI 提示词、`buildPreview()` 里的解析正则、vault 路径。

**验收**
- `npx tsc --noEmit` EXIT=0；新增 `tests/unit/i18n/batch-import-flow.test.ts` 6 例（136 键双语可解析 / en 零 CJK / zh 插值与源码逐字 11 条 / 步骤与状态标签逐字 / 字数分档 zh 万·字、en k·M 四档 / 自定义标签输入回车添加），全绿。
- `check:i18n` zh/en 各 **5278** 条、无法解析键 0、动态键 29、棘轮 **212 文件 / 6383 条**（6525 → 6383，已 --update-baseline）。
- 实机 `D:\nw-tmp\snap-i18n44.mjs <lang>`：zh/en 各 9 场景（step1-empty / step1-selected / step2-preview / step3-settings / step3-presets / step4-progress / step5-result / step5-history + 两个 480 宽 picker），**零横向溢出**；en 下 UI 全英文，残余 CJK 仅为注入的假书名「斗破苍穹 / 将夜 / 未命名稿件」、预设名「玄幻长篇默认」、注入错误串与 vault 路径。截图 `D:\nw-dev-vault\_visual-i18n44\`。
- `npm run preflight` **EXIT=0**（995 文件 / **10,363 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n44.log`）；`check:bundle` main.js **6,179,754**（+11,752）、styles.css **800,471**（±0）；`gen:docs` 1,004 文件 / `check:docs` 20 活跃文档通过。

**坑**
1. **第五步标签 640 宽下换行到第二行**：zh 与 en 表现一致，属既有布局，按「先保视觉」不动（要改也是视觉切片的事）。
2. **截图要 monkeypatch `batchManager`**：`window.__nwBi`（`ui/batch-import-modal.ts:169` 的既有截图钩子，注释写「提交前删除」但一直留着）拿到实例后，直接给 `m.batchManager` 的 `getPreviews / getProgress / getAllTasks / getHistory / getPresets` 打桩注入三本假书（completed / failed / processing），否则弹窗停在空态。
3. **改文案后必须重跑 build + `dev-vault.mjs sync --vault=D:\nw-dev-vault` 再截图**，dev vault 是 junction 指回本仓，只 sync 产物（4 个文件）。

**文档**：`docs/modules/i18n.md`（§2 资源 5142 → 5278 + 资源链 +136 + 已迁移面 bullet + 未迁移面 6525 → 6383、§5 表行、§6 测试 bullet、§7 backlog [x] + 余下重写）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：`ui/agent-workbench-view.ts`（730）/ `ui/novel-tags-modal.ts`（1,099，只剩 AI 提示词与解析正则）；知识库 D 类两文件等视觉重构（用户 m16938）。


## 第一百一十三轮：i18n 第二期第45片 —— Agent 创作工作台（2026-11-19，DSH）

**触发**：用户 m22212「继续」（第44片之后的候选顺序：agent-workbench-view → novel-tags）。

**范围**：`ui/agent-workbench-view.ts`（1,837 行）+ `ui/agent-workbench/stage-panel.ts`（134 行，本片一并纳入，它的 5 处中文是阶段面板 UI），
合迁 **106 键** `agentWorkbench.*`（23 个子组：title / mode 3 / header 4 / nav 8 / resize 2 / panel 4 / quick 4 / stage 9 /
project 7 / model 1 / composer 6 / file 9 / preview 2 / notice 11 / guard 1 / approval 1 / notes 3 / intent 3 / chip 3 /
plan 1 / telemetry 16 / memory 3 / toollog 4）。

**改动**
1. 两文件新增 `import { t } from '@/i18n'`；`ui/agent-workbench-view.ts` 83 处、`stage-panel.ts` 7 处全部换键。
2. 模块级常量分两类：`TYPE_SECTIONS` 带 label → 改 `function typeSections()`，label 走 `creationModeDisplayName(mode)`；
   `MODE_LIBRARY_GROUP_LOOKUP`（prefix→中文名）整块删除，`openProjectChipMenu` 改成
   `const rootIndex = MODE_LIBRARY_ROOTS.indexOf(prefix); const mode = rootIndex >= 0 ? sections[rootIndex].mode : this.projectTypeCache.get(project);`
   分桶；`MODE_LIBRARY_ROOTS = ['长篇小说','短篇小说','剧本']` 是 vault 目录名，**保留中文**。
3. 阶段面板：`buildStagePrompt` → `t('agentWorkbench.stage.prompt', { stage, cta, blocked })`，
   blocked 段走 `stage.promptBlocked`；`emptyFailed` / `emptyNoProject` / `tooltip` / `tooltipReason` / `progressBlocked` / `completed` 各自成键。
   阶段名本身来自 `shared/creation-flow.ts` 的 `stageLabel()`（已 i18n），本片不动。
4. **发给 Agent 的话术一并本地化**：`我要操作项目「{project}」`（`project.askAgent`）、`继续「{stage}」：{cta}`（`stage.prompt`）——
   先例是 creationFlow 的 cta 同样喂 prefill；语言只影响显示与预填文本，落盘不受影响。
5. 保留中文：`MODE_LIBRARY_ROOTS`、`getAbstractFileByPath('元文件')`、三条 `log.*`。两文件非注释中文 111 → 5 行且全为上述保留项。
6. **顺带修英文标签撑破左栏**：`.nw-awb-quick-btn`（`styles-src/13-agent-workspace.css:61`）加
   `min-width:0; white-space:normal; overflow-wrap:anywhere; line-height:1.35`，长标签在 2 列 grid 内换行；
   修复前 en 下「📊 Quality dashboard / 📦 Export manuscript」把格子撑到 108px 压到中栏（探针 overflow 2 → 5），修复后回到 2。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx eslint` 两文件 0 error（10 条 warning 全是存量）；`npx vitest run tests/unit/ui/agent-stage-panel.test.ts` 22 通过（该测试断言中文串，默认 zh 下 t() 仍返回中文，故零修改）。
- 新增 `tests/unit/i18n/agent-workbench-labels.test.ts`（7 例）：106 键双语可解析、en 零 CJK、zh 逐字三组、en 下阶段名全英文、en 占位与完成态、en 插值无花括号残留。
- `check:i18n` zh/en 各 **5384** 条、无法解析键 0、动态键 29、棘轮 **211 文件 / 6259 条**（6383 → 6259，已 `--update-baseline`）。
- 实机 `D:\nw-tmp\snap-i18n45.mjs --lang=zh-CN|en-US`：改 dev vault 插件 `data.json` 的 `language` 后启动 Obsidian（结束恢复原文），
  CDP 信任仓库 → `p.openAgentWorkbench()` → 点第一张项目卡 → 展开遥测折叠区 → 截 1500×1100。
  zh 视图 1156×992、文案全中文；en 关键标签全英文（Projects / Writing plan / Writing stages / Jump to / Files /
  Session telemetry and memory / Turns…Spilled / New session / Workbench / Co-writing / Knowledge base / Fingerprints），
  横向溢出探针 zh/en 均为 2（两个 resizer 元素，属基线）。en 残余 CJK 116 = vault 数据（项目名「示例项目」「短片示例」、
  文件名「01-世界架构」）与引擎层 `engine/agent/harness/harness-engine.ts:632` 的「⚠️ AI 助手暂时不可用」+ `:634` 的「🔄 切换到离线引导」chip（已记 backlog）。
- `npm run preflight` **EXIT=0**（996 文件 / **10,370 通过 + 3 跳过**，日志 `D:\nw-tmp\preflight-i18n45.log`）；
  `check:bundle` main.js **6,190,342**（6,179,754 → +10,588）、styles.css **800,684**（+213）；`check:css` 同步上调字节基线；
  `gen:docs` 1,004 文件 / `check:docs` 20 活跃文档通过。

**坑**
1. **工作台截图要清掉「信任仓库作者」弹窗**：它在 `openAgentWorkbench()` 之后才弹出，压住视图且让标题看起来发灰（容易误判成颜色回归）。
   循环点「信任仓库作者」/ `.modal-close-button` 再按 `Escape`，之后 `.nw-awb` 的 rect 应稳定为 `x=344 y=108 1156×992`。
2. **模块级常量混排要逐个判**：同一个文件里 `TYPE_SECTIONS`（展示，必须改函数）与 `MODE_LIBRARY_ROOTS`（vault 目录，必须保留）；
   判据是「这个字符串会不会被测试断言/被落盘」。
3. **替换脚本先断言命中数**：本片一次性 83 处替换，脚本对每处 `count` 断言，曾把 `agentWorkbench` 写成 `agentWorkBench`（3 处）
   与 `creationMode.long.name`（真键 `creationMode.label.long`），靠 `check:i18n` 的「引用不存在的键」立刻发现。

**文档**：`docs/modules/i18n.md`（§2 资源 5278 → 5384 + 资源链 +106 + 第45片已迁移面 bullet + 未迁移面 6383 → 6259、§5 表行、
§6 测试 bullet、§7 backlog [x] 与余下重写、§9 两条新坑）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json` / `.css-baseline.json`。

**下一轮候选**：`ui/novel-tags-modal.ts`（1,099，只剩 AI 提示词与解析正则，可选）；引擎层文案
（`engine/agent/harness/harness-engine.ts:632/634`，en 界面下露中文的不可用提示与离线引导 chip）；知识库 D 类两文件等视觉重构（用户 m16938）。

## 第一百一十四轮：i18n 第二期第46片 —— 引擎层用户可见运行时文案（2026-11-19，DSH）

**触发**：用户 m22598「继续」。第45片 backlog 明确挂着「en 下工作台兜底气泡与润色节奏建议仍是中文」，本轮清掉。

**范围**：三个文件、37 键。这一片是**第一次把 `t()` 用到 `ui/**` 之外**，所以先证伪了两个前提：
- `i18n/index.ts` 只 import 两个 messages 文件，不依赖 Obsidian → 引擎层 import 安全；
- 这三个文件都不在任何 worker 入口里（worker 各自 build 自己的入口）→ 不会把 i18n 拖进 worker 包。
- `engine/agent/harness/harness-engine.ts`（21 行 CJK）：:330 空输入提示、:561 审批框标题、:632 降级气泡
  （`outcome.failReason || t('engineMsg.agent.failFallback')`）、:634/:645 两个 chip、:644 中断提示、:657 工具行
  （`🛠`/`⚠️` 图标留代码里，成功/失败拆两个键）、:387 压缩摘要；
- `engine/agent/harness/agent-loop.ts`（21 行）：两处 `failReason = '用户取消'`、:443 超预算、:470 模型失败、
  :495 工具占位、:582 工具未执行，以及 `summarizeToolArgs` 六类摘要（`记录 N 项信息` / `写入 path` / `删除 path` /
  `删除项目 X` / `未指定项目（将拒绝执行）` / `打开界面` / 键名列表 + `等`）；
- `engine/rhythm-analyzer.ts`（18 行）：4 条 issue + 4 条 suggestion + `typeToLabel` 的四个值
  （键名 action/dialogue/description/introspection 是枚举值，只迁值）。

**改动要点**
- 新增顶层组 `engineMsg.agent` **25 键** + `engineMsg.rhythm` **12 键**（复用既有 `engineMsg` 父级，不新建 `engine`）。
- **拼接串迁移的坑**：旧代码是 `keys.slice(0,3).join('、') + (keys.length>3 ? ' 等' : '')`，导语里带了前导空格。
  资源改成 `moreItems = '{items} 等'` / en `'{items} and more'`，调用时传 `items: ''` 复刻那个空格；
  分隔符单独成键 `listSep`（zh `、` / en `", "`）。
- **保留中文**（进模型上下文或落盘契约，见 §8 保留判据）：会话开场与压缩提示词、`【用户】`/`【助手】`/`【当前时间】`、
  `session-snapshot.ts` 默认标题「新会话」、`（用户在你执行过程中补充）`、`重复调用已被阻止`、`【系统提醒】`、
  `用户未批准执行「…」`、全部 `log.*` 与注释；`scripts/cjk-keep-allowlist.json` 里 harness-engine 的 ai-prompt 声明不动。

**验收**
- `npx tsc --noEmit` EXIT=0；`node scripts/check-i18n.mjs` zh/en 各 **5421**、无法解析键 0、动态键 29、
  棘轮 **211 文件 / 6259 条**（引擎层不在 UI 口径，数字不变）。
- 新增 `tests/unit/i18n/engine-runtime-labels.test.ts` **11 例**（37 键双语可解析 / en 零 CJK / 占位符集合一致 /
  zh 逐字五组 / en 行为三条含 `failReason === 'Cancelled by user'` / 默认 zh 零回归）。
  存量 `agent-harness`(29) + `harness-context-fit`(13) + `deviation-detector`(101) + `quality-score-engine`(52)
  合跑 **195 例零修改**通过（两处中文断言在 zh 下仍成立）。
- `npm run build` + `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`；实机 `D:\nw-tmp\snap-i18n46.mjs --lang=...`：
  zh/en 各 2 场景（工作台 1156×992、chat 区 556×733），en 气泡
  `⚠️ The AI assistant is unavailable (Model call failed).` + 第二行引导语，zh 与迁移前逐字一致；两张 chat 图同尺寸、无溢出。
- `check:bundle` main.js 6,190,342 → **6,194,270**（+3,928）、styles.css **800,684**（±0）。

**坑**
1. **单测里的 `AgentContext` 用 `activeProject: null`**：`activeProject: undefined` 会撞 `TS2322`
   （类型是 `string | null`），preflight 的 typecheck 阶段才暴露。
2. **`new AgentHarnessEngine({ ctx, adapter })` 会崩**在 `createHostTools({ port: options.portDeps.port })`，
   构造测试必须补 `portDeps: { port: {} as GuideAgentPort, ctx }`。
3. **en 零 CJK 断言的插值样本要全 ASCII**：`deleteProject` 的 `project: '长篇/旧稿'` 会让断言失败，
   改 `'long/old-draft'`。
4. **同一句中文在同一文件出现多次时先断言命中数**：`'用户取消'` 在 agent-loop 出现 2 次，
   替换脚本按 `split().length-1` 校验后再替换，否则要么漏改要么中断。

**文档**：`docs/modules/i18n.md`（§2 资源 5384 → 5421 + 资源链 +37 + 第46片已迁移面整段、§5 表行、§6 测试 bullet、
§7 backlog [x] 与「新 backlog：喂模型的提示词不迁」、§9 三条新坑）、`docs/modules/INDEX.md`、`docs/CURRENT.md`、
`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.bundle-baseline.json`。

**下一轮候选**：`ui/novel-tags-modal.ts`（1,099 字，只剩 AI 提示词与解析正则，可选）；知识库 D 类两文件
（`ui/knowledge-detail-modal.ts` / `ui/views/book-detail-renderer.ts`，用户 m16938 裁定随视觉重构）；第三期补齐 en 并逐面量布局。

## 第一百一十五轮：i18n 第二期第47片 —— 知识库 D 类两文件（2026-11-20，DSH）

**触发**：用户 m16938 早前裁定「知识库 D 类两文件随视觉重构一起做」，视觉重构 Slice A–P 已完成，本轮把它补上；
同时清掉第 33/34 片遗留的 `knowledgebase.*` 之外的详情面文案。

**范围（7 个文件、547 键）**：
- `ui/knowledge-detail-modal.ts`：详情弹窗外壳与 10 个页签的内容（`knowledgeDetail` 组 182 键）；
- `ui/views/book-detail-renderer.ts`：详情渲染器（`bookDetail` 组 365 键），本次把全部 `createEl({ text })` 走 `t()`；
- 逻辑助手 `ui/views/book-detail-metrics.ts` / `book-detail-logic.ts` / `book-emotion-logic.ts` /
  `book-foreshadow-logic.ts` / `book-style-logic.ts`：常量表改函数（`emotionArcTypeMap()` / `foreshadowTypeLabels()` /
  `senseNameMap()` 等），避免模块加载时把语言固化。

**改动要点**
- 三个模块级常量（`STYLE_DIMENSIONS`、维度键表、页签表）改函数或「中文数据键 + `styleDimensionLabel()` 显示层翻译」：
  落盘/比对用的键必须保持中文（老数据兼容），只翻显示名。
- 枚举键（情绪键 anger/joy…、伏笔类型 item/setting…、句式 declarative…）同样是数据键，key 留英文、只迁值。
- 保留中文：`起承转合` 颜色映射的键、6 条 `log.*`、`STYLE_DIMENSIONS` 里的数据键。
- 字数文案不再各写一份，统一复用 `ui/views/kb-format.ts` 的 `formatWordCount`（`12.3 万字` / `374k chars`），
  删掉 zh/en 的 `knowledgeDetail.word.*` 两条，`formatWordCount()` 方法体只剩一行转发。
- 资源一律嵌套对象（`knowledgeDetail.*` / `bookDetail.*`），不用扁平点号键。

**验收**
- `npx tsc --noEmit` EXIT=0；`node scripts/check-i18n.mjs` zh/en 各 **5976** 条、无法解析键 0、棘轮 **206 文件 / 5644 条**。
- 新增 `tests/unit/i18n/book-detail-labels.test.ts` **5 例** 与 `knowledge-detail-labels.test.ts` **4 例**
  （键集合一致 / en 子树零 CJK / 占位符逐键一致 / 中英文案抽检）；
  存量三个逻辑助手测试（`book-emotion-logic` / `book-foreshadow-logic` / `book-style-logic`）改为断言函数返回值。
- 实机 zh/en 各 10 个页签（`D:\nw-dev-vault\_visual-i18n47\<tab>-<lang>.png`，896×1130）：
  en 全英文、无溢出；残余 CJK 全是 vault 数据（书名「将夜」、作者、题材树、简介、标签）。
- `npm run preflight` **EXIT=0**：**999 文件 / 10,390 通过 + 3 跳过**。
- `check:bundle`：main.js 6,190,342 → **6,240,146**（+45,843 → 补 @returns 后再 +33）、styles.css **800,684**（±0）。

**坑**
1. **en 资源块整块抄成了中文**：`i18n-parity.test.ts` 报 en 174 条 CJK 才发现。`check:i18n` 只查键不查值语言，
   每片迁完必须跑 `npx vitest run tests/unit/i18n`；资源块要一次性全量生成，别分批补。
2. **常量表改函数后 JSDoc 掉了 `@returns`**：`check:jsdoc` 报「不完整 JSDoc 从 0 增到 3/2/4」，
   9 个函数补 `@returns` 后通过；补注释会让 main.js +33 字节，需同步 `--update-baseline --note`。
3. **`zh-CN.ts` 该区域是混合 EOL**：按整块 eol 拼接会 miss，改用 `split('\n')`（保留行尾 `\r`）后按行区间 splice。
4. 测试里 `setLocale('auto')` 编译不过（签名是 `setLocale(locale: Locale)`），一律 `setLocale('zh-CN')`。
5. 详情页签横向滚动是既有设计（`styles-src/27-knowledge-base.css:738-750`），zh/en 都滚，不是溢出 bug。

**文档**：`docs/modules/i18n.md`（§2 资源 5976、资源链、已迁移面整段、§5 表行、§6 测试、§7 backlog、§9 三条新坑）、
`docs/modules/INDEX.md`、`docs/CURRENT.md`、`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：`ui/ideation-modal.ts`（793 字）、`ui/batch-import*`（750 字）、`ui/views/agent-workbench-view.ts`（730 字）；
第三期补齐 en 并逐面量布局；知识库详情大标题字号（渲染器 `createDetailSection` 后的标题偏大）列入视觉 backlog。

## 第一百一十六轮：i18n 第二期第48片 —— 章节大纲树弹窗（2026-11-20，DSH）

**范围**：`ui/chapter-outline-tree-modal.ts`（1,392 行，CRLF，此前 **0 处 `t()`**，`audit-cjk` 记 112 条 / 约 70 处界面文案）。
选题理由：`ui/ideation-modal.ts`（第43片）、`ui/batch-import-modal.ts`（第44片）、`ui/agent-workbench-view.ts`（第45片）
已在本期迁完，剩余的 `ui/` 大户里它是唯一「整屏都是弹窗文案、且没有 i18n 前缀」的文件。

**改动**
- 新建顶层资源组 `outlineTree`（**45 键**）：`title` / `empty` / `range` 7 / `fulltext` 3 / `volume` 5 / `chapter` 6 /
  `scene` 5 / `emptyNoMatch` / `matchCount` / `footer` 4 / `notice` 19；嵌套对象，不用扁平点号键。
- `render()` 全量迁移：标题、章号区间搜索（三段装饰片段 + 两个 placeholder + 两个 title）、全文/收起切换、
  卷行（卷号/卷名/章数/无匹配提示/整体匹配计数）、章节行与场景行的拖拽 title 与上下移 aria、底部四键。
- 19 条 Notice 全迁：未绑定项目 / 无可用章节 / 画布事件已全存在 / 已生成 N 个（含跳过）/ 生成失败 /
  冲突已修改 / 场景名已修改 / 已添加场景N / 已删除场景N / 场景与章节顺序已调整 / 场景跨章拒绝 /
  场景重排 / 章节重排（带卷名与位置）/ 已保存统计 / 保存失败。
- 保留中文（数据/格式契约）：`第N卷_分卷大纲.md` 与 `第N章_Scene展开.md` 路径、五条解析正则、`| 章号` 表头、
  默认场景名 `新场景`、`buildSceneContent()` 的 `## 场景N：` 与 `key_scene:`、`collectOutlineChapters()` 的 `volumeLabel`、全部 `log.*`。

**验收**
- `npx tsc --noEmit` EXIT=0；`npx eslint ui/chapter-outline-tree-modal.ts i18n/messages/*.ts` 0 error（4 条存量 unused warning）。
- `node scripts/check-i18n.mjs`：zh/en 各 **6028** 条、无法解析键 0、动态键 **29 处**（未新增）、棘轮 **206 文件 / 5569 条**（5644 → 5569）。
- 新增 `tests/unit/i18n/outline-tree-labels.test.ts` **5 例**（键集合 ≥45 且一致 / en 零 CJK / 占位符逐键一致 /
  zh 逐字 6 条 / 中英插值），与 `tests/unit/ui/outline-tree-modal-contract.test.ts` 合跑 **10 例**通过。
- 实机 zh/en 各 3 场景（`D:\nw-dev-vault\_visual-i18n48-{before,after}\outline-{default,range,fulltext}-<lang>.png`）：
  zh before/after **像素 0 差异**（640×364 / 640×356 / 640×728），en 无横向溢出；残余 CJK 全是 vault 数据
  （书名《雾中山门》、章节标题、章节范围文本）。
- 截图入口：`plugin.openProjectWizard('示例项目')` → `tab.currentStepIdx = 5` →
  `await view.wizardController.renderTabContent(tab, true)` → 点「📋 大纲树状预览」。
- `npm run preflight` **EXIT=0**：**1,000 文件 / 10,395 通过 + 3 跳过**（日志 `D:\nw-tmp\preflight-i18n48b.log`）。
- `check:bundle`：main.js 6,240,146 → **6,245,434**（含 en 片段修正的 +4）、styles.css **800,684**（±0）；`gen:docs` 1,004 文件。

**坑**
1. **`t(cond ? 'a' : 'b', …)` 会被记成「非字面量键」**：静态扫描只看第一个实参，三元会把文件拉进动态键告警名单；
   改成 `const msg = skipped > 0 ? t('…Skipped', {…}) : t('…Created', {…});` 后动态键数维持 29。
2. **大纲预览按钮只在「全书规划」步已完成/文件已存在时渲染**：向导首屏点 `下一步 →` 不前进（该步未解锁），
   必须直接设 `currentStepIdx = 5` 再调 `wizardController.renderTabContent(tab, true)`。
3. **before 图从 stash 取最省事**：只 stash 三个文件 → `npm run build` + `dev-vault sync` → 采 before → `stash pop` →
   再 build 采 after；脚本带 `--tag=before|after` 落不同目录，diff 只读 PNG。
4. **`translate(locale, key, params)` 第一参数是 locale**，不是 `translate(key, params)`；误用会 `TypeError: key.split is not a function`。
5. 打开向导可能在 workspace 就绪前抛 `getFullPath` 的 `startsWith` 错误，`openProjectWizard` 要包一层重试。
6. **资源值不许是空串**：en 的 `range.toSuffix` 先写成 `''`，`i18n-parity` 的「每条文案 trim 后非空」直接失败；
   改切为 `Ch. [` / `] – [` / `]`（三段都非空，渲染仍是 `Ch. [3] – [20]`）。
7. **源码字符串断言会随迁移失效**：`tests/unit/ui/mobile-reorder-contract.test.ts:95` 断言过 `'aria-label': '上移章节'`，
   迁成 `t('outlineTree.chapter.upAria')` 后要同步改成断言键名。

**文档**：`docs/modules/i18n.md`（§2 资源 6028 + 资源链 + 已迁移面整段、§5 表行、§6 测试、未迁移面条目、§9 三条新坑）、
`docs/modules/INDEX.md`、`docs/CURRENT.md`、`docs/planning/2026-11-18-feature-gaps.md`、本轮记录；基线 `.i18n-baseline.json` / `.bundle-baseline.json`。

**下一轮候选**：`ui/full-writer/template-vars-builder.ts`（239 字，多为提示词，需甄别式迁移）、`ui/rendering/context-panel.ts`（162 字）、
`ui/co-write-floating-panel.ts`（113 字）、`ui/batch-create-modal.ts`（104 字）；第三期补齐 en 并逐面量布局。

## 第一百一十七轮：ZCode P0 三条复核与修复（2026-11-20，DSH）

**背景**：用户要求「查看 ZCode 回复内容，进行完整判断」。ZCode 依据 `docs/audits/2026-11-20-interaction-and-module-flow.md` 落地了三条 P0：
ZC-25 `e0a772a3`（withButtonBusy）、ZC-26 `0e15c2a5`（悬浮面板自动保存）、ZC-27 `8f300d44`（ModalDirtyGuard）。

**复核结论**：一条通过、两条打回。

- **ZC-25 通过**：6 处生成按钮（plan-book 1 + ai-builder 5）真接上了 `withButtonBusy`，`button.disabled` 闸门与 `finally` 复原有保证。
- **ZC-26 打回**：`scheduleAutoSave()` 定义了但**没有任何调用点**（input 监听只更新状态/字数），P0 丢内容问题仍在；`updateSaveState(state: string)` 仍 `setText(state)`，调用方已改传 `'editing'/'saved'/'saveFailed'` → 用户看到英文枚举键；`isDirtySaveState`/`SaveState` 导入未使用（lint 3 warning），声明的脏态样式类不存在。
- **ZC-27 打回**：组件可用（覆写实例 `close()`、复用 `OperationConfirmModal.confirm`），但接线漏 4 处 —— plan-book 生成成功关闭前无 `markClean`（成功后被问丢弃，确认框浮在紧随其后打开的大纲树之上）；add-fanfic 的「绑定已有设定 / AI 生成后 / 进入审核」三处 close 均无 `markClean`，模板草稿那处还被重复插了三行；测试第 3 例未 await 确认 Promise（手动 `markClean` 再 close），主路径未断言；确认框无重入闸门、Promise 无 catch。

**修复**：
1. `ui/co-write-floating-panel.ts` input 监听补 `this.scheduleAutoSave()`；`updateSaveState(state: SaveState)` 改 `setText(saveStateLabel(state))` + `toggleClass('nw-cowrite-control-state--dirty', isDirtySaveState(state))`。
2. `styles-src/04-workspace-layers.css:615` 新增 `.nw-cowrite-control-state.nw-cowrite-control-state--dirty { color: var(--text-warning); }`。
3. `ui/plan-book-modal.ts` 写盘成功后 `this.close()` 前补 `markClean()`。
4. `ui/add-fanfic-setting-modal.ts` 三处 close 补 `markClean()`，删掉重复插桩并修正缩进。
5. `ui/components/modal-dirty-guard.ts` 加 `confirming` 闸门（Esc 连按不叠加第二个确认框）与 `catch`（silent-ok：确认框异常时保持弹窗打开）。
6. 测试：`tests/unit/ui/modal-dirty-guard.test.ts` 改可控 Promise 断言「确认前不关、确认后才关」（7 例）；新增 `tests/unit/ui/modal-guard-wiring.test.ts`（6 例源码级不变量：自动保存必须被调用、状态必须走 `saveStateLabel`、每个 close 前恰好一个 `markClean`）。

**新发现（已裁定）**：`VIEW_TYPE_FLOAT_COWRITE` 只注册、全仓无 `setViewState` 与命令入口；`ui/workspace-manager.ts:65` 注释称「主写作区统一使用句级协同写作视图，避免双入口分裂」→ 悬浮面板在现网不可达，A-3 的「两个入口」前提不成立。用户 m24178 裁定退役，见第一百一十八轮。

**门禁**：`tsc` 0 错、eslint 0 error；`vitest` 1002 文件 / 10,408 通过 + 3 跳过；`preflight` 首跑卡在 CSS 预算（+167B / +1 唯一类），更新 `check:css` + `check:bundle` 基线与 `gen:docs` 后 **EXIT=0**；`check:css` 800,851 bytes / 4,335 唯一类；`check:bundle` main.js 6,247,851（+264）/ styles.css 800,851（+167）；`check:i18n` 6034 条、棘轮 206 文件 / 5,564 条（已收紧）。

**文档**：`docs/audits/2026-11-20-interaction-and-module-flow.md` 新增「五、DSH 复核」（5.1–5.5：逐条判断、修复清单、悬浮面板不可达、四条方法教训）；本轮记录即此节。

**下一轮**：用户 m24178 裁定悬浮面板退役并由 DSH 直接改（见第一百一十八轮）；C 清单 P1×9 / P2×7 也由 DSH 自己做、暂不派 ZCode；i18n 第 49 片候选（`ui/rendering/context-panel.ts` 162 字 / `ui/batch-create-modal.ts` 104 字）。


## 第一百一十八轮：退役协同写作悬浮面板（RETIRE-V1，2026-11-20，DSH）

**用户裁定（m24178）**：「判断旧入口退役。同时，直接在dsh修改，暂时不派给zcode」。

**为什么退役**：`VIEW_TYPE_FLOAT_COWRITE`（`ui/co-write-floating-panel.ts:46`，`nw-float-cowrite`）只在 `ui/workspace-manager.ts:9/17/42` 注册，全仓没有 `setViewState`、没有命令、没有快捷工具目录条目；`getLeavesOfType(VIEW_TYPE_FLOAT_COWRITE)` 零处。唯一可能实例化它的路径是 Obsidian 恢复旧工作区布局。`workspace-manager.ts:65` 的注释也写明主写作区统一用协同写作视图、避免双入口分裂。

**删除面**：

1. `ui/co-write-floating-panel.ts`（1058 行）与 `tests/unit/ui/co-write-floating-panel-contract.test.ts`。
2. `ui/workspace-manager.ts`：import 行、`FLOAT_VIEW_TYPES` 成员、`registerView(VIEW_TYPE_FLOAT_COWRITE, …)` 片段；在统一入口注释下补一行退役说明。`FLOAT_VIEW_TYPES` 本身保留（`closeAll` 仍遍历）。
3. `styles-src/05-floating-panels-and-settings.css`：`.nw-float-cowrite-root` 四条规则（含注释块）删除；`styles-src/04-workspace-layers.css` 里上一轮只为它加的 `.nw-cowrite-control-state--dirty` 删除（基类 `.nw-cowrite-control-state` 由 `ui/co-writing/metrics-panel.ts` 与 `ui/co-writing/control-panel.ts` 使用，保留）。
4. `scripts/audit-cjk.mjs` 的 MANUAL 待迁登记（113 字）移除；`tests/unit/ui/modal-guard-wiring.test.ts` 删除悬浮面板 describe（plan-book / add-fanfic 两条不变量保留，文件从 6 例降为 3 例）。
5. 文档：`docs/modules/co-writing.md`（代码入口行与 E-13 标注退役）、`docs/planning/2026-11-19-legacy-modal-retirement.md` 新增 §九（`RETIRE-V1`）、`docs/audits/2026-11-20-interaction-and-module-flow.md` §5.4 追加用户裁定与执行清单。

**未动的部分**：`ui/co-writing/save-state.ts` 的 `SaveState` / `saveStateLabel` / `isDirtySaveState` 仍被主视图与 dashboard 使用，保留；`ui/co-write/logic-check-format.ts`（从旧浮窗抽出）保留，仅更新派生来源说明不需要。

**门禁**：`tsc` 0 错；受影响 23 个测试文件 132 例通过；`build` 后 styles.css 32,085 行；基线收紧 —— jsdoc 982 文件（移除已删文件）、view-tests 75 个文件、i18n 205 文件 / 5,456 条、utility 46/137、css 800,112 bytes / 4,333 唯一类、bundle main.js 6,224,663（−23,188）/ styles.css 800,112（−739）。

**下一轮**：C 清单 P1（用户要求由 DSH 直接做，暂不派 ZCode），按审计 §三 顺序：Ctrl+S 三处行为统一、确认框统一、步骤键常量化等 9 条。

## 第一百一十九轮：C 清单 P1 前四项（#7 #8 #9 #10，2026-11-20，DSH）

**用户裁定（m24178）**：P1×9 / P2×7 由 DSH 直接做、暂不派 ZCode。本轮按审计 §三 C 清单顺序先做四项：自动保存节拍、命令 id、项目元写入、步骤键单一真源。

**#7 自动保存节拍统一（A-4）**
- 新增 `shared/interaction-timing.ts`：`export const AUTOSAVE_DELAY_MS = 1000;`，注释写明三套历史的来历（协同 2000 / 单元 800 / 场景细纲 1000）与取 1000 的理由（协同 2s 切章前迟钝、800 偏频繁、1000 行为变化面最小）。
- 三个消费方引用常量、删掉各自数字：`ui/co-writing-view.ts`（debounceFixed('auto-save')）、`ui/full-writer/unit-writer-controller.ts`（删本地常量改 import）、`ui/full-writer/scene-outline-controller.ts`（markDirty 里的 setTimeout）。
- 顺带更正三处过时注释：`ui/full-writer/scene-outline-controller.ts` 头注释与 `ui/cowrite/body-save-controller.ts:64` 不再写死「2s / 1 秒」。
- 新增 `tests/unit/shared/interaction-timing.test.ts`（3 例）：常量值、三个消费方必须 import 且不允许本地再定义、常量只在一处定义。

**#8 步骤键单一真源（B1）**
- 新增 `shared/step-keys.ts`：`STEP_KEYS`（infoPlan / plotDistill / characterSoul / outline / emotionPlan / sceneExpand / bodyGeneration / qualityControl / analysisReport / settlement）+ `StepKey` 类型；`engine/step-definitions.ts` re-export 保持旧路径可用。
- 替换面：**22 个文件约 143 处**字面量（审计预估 7 文件，实际更广），消费方一律 `STEP_KEYS.XXX`。
- 注释更正：`engine/co-writer-engine.ts` 的「共享 stepResults['bodyGeneration'] 存储」改为实情——协同引擎只落盘正文，内存槽由 `ui/states/chapter-state-manager.ts:283` 加载章节时从磁盘回填；`engine/step-definitions.ts` 架构说明同步。
- `'settlement'` 故意不并入字符串键收编（同时是 creation-flow 阶段 id / job 分类），留给 P2 #16。

**#9 命令 id 常量化（B2）**
- `domains/long/tool-catalog.ts`：35 个按钮 commandId + 10 条快捷工具 id 全改 `CommandIds.*`；另 4 处裸写（`ui/chapter-settlement-modal.ts`、`ui/full-writer/project-selector-controller.ts`、`ui/monitor-panel-b.ts`、`engine/step-runner.ts`）替换。
- `'novel-writer-chapter-settlement-light'` 不是注册命令、只是账本动作标签，保留字面量并加注释。

**#10 .project 写入收敛（B5）**
- `ui/full-writer-view.ts` 两处改走 `writeProjectMeta()`（唯一封装，`shared/paths.ts:78-90`），失败统一抛 `fullwriter.sr.saveFailedWith`；结构切换那处写锁键从模板串改 `pjProjectMeta()`。

**三个坑（都当场踩到并修好）**
1. **循环 import 的 TDZ**：`engine/step-definitions.ts` import `validateStepResult`（来自 step-validator），step-validator 反过来 import `STEP_KEYS` → 模块初始化时 `STEP_KEYS` 是 undefined，53 个测试文件全挂（`Cannot read properties of undefined (reading 'QUALITY_CONTROL')`）。正确做法是把常量放 `shared/step-keys.ts`，让反向引用不经过 engine。
2. **对象字面量键**：机械替换把 `'bodyGeneration': x` 换成 `STEP_KEYS.BODY_GENERATION: x`（语法错），要写 `[STEP_KEYS.BODY_GENERATION]: x`；共 6 处。
3. **分层规则**：第一版把常量放 engine 后，`shared/prompt-template-catalog.ts` 与 `shared/task-model.ts` 出现 `shared/ → engine/` 违规（`tests/unit/architecture/ui-internal-boundaries.test.ts` 直接红），于是常量迁 `shared/step-keys.ts`。

**门禁**：`tsc` 0 错、eslint 0 error；`vitest` 1002 文件 / 10,405 通过 + 3 跳过（首跑被分层测试拦下，修完重跑全绿）；`check:i18n` 6034 条 / 无法解析键 0 / 棘轮 205 文件 5,456 条不变；`check:bundle` main.js 6,224,760（较 6,224,663 +97，常量对象与 re-export 的净开销）、styles.css 800,112 不变；`preflight` EXIT=0。

**下一轮**：P1 余下五条 —— #5 Ctrl+S 三处行为统一、#6 `window.confirm` 11 处换 `OperationConfirmModal`、#11 模式文档路径二合一、#12 `ENGINE_MSG_CODES` 编译期校验、#13 保存状态/按钮文案/Notice 时长三个小统一。

## 第一百二十轮：C 清单 P1 余下五条（#5 #6 #11 #12 #13，2026-11-20，DSH）

审计 `docs/audits/2026-11-20-interaction-and-module-flow.md` §三 P1 全九条到此全部落地（#5/#6/#7/#8/#9/#10/#11/#12 完成，#13 部分完成、A-17 留给 P2）。

**#5 Ctrl+S 行为统一（A-2）**
- `shared/interaction-timing.ts` 新增 `SAVE_FEEDBACK_MS = 1500`（原协同 3000 / 单元 1500 两套）；i18n `common.bodySaved`（zh「✅ 正文已保存」/ en「✅ Body text saved」）。
- `ui/cowrite/body-save-controller.ts` 成功分支改用该键与常量；`ui/full-writer/unit-writer-controller.ts` 的 keydown 从 **正文编辑器** 改绑 **单元容器**（`main`），守卫 `ctrl/meta`、排除 `alt`、`event.key === 's'`、`preventDefault`；`ui/co-writing-view.ts` 追加视图级 `keydown` → `handleViewSaveShortcut`（跳过 `defaultPrevented` / IME / `event.target === rightEditor`），`saveFromShortcut()` = `pushHistorySnapshot(true)` + `saveBody(true)`，编辑器快捷键 `case 'save'` 复用它。
- 新增 `tests/unit/ui/editor-save-shortcut.test.ts`（4 例源码级不变量）。

**#6 `window.confirm` 11 处全量下线（A-6/A-19/A-7）**
- 全部改走 `OperationConfirmModal.confirm(app, { title, description, warning?, cancelText? })`；两处中文文案（重建章节、删除版本、结算恢复）新增 `common.confirmTexts.*` 9 键。新增 `tests/unit/ui/no-window-confirm.test.ts`（源码棘轮 + 三个中文站点校验）。
- 坑：`ui/full-writer/wizard-controller.ts` 没有 `this.app`，只有 `this.view.app`（`WizardViewAccess`）；`git grep` 无命中退出码 1，`execFileSync` 会抛错，测试里必须放行 `status === 1`。

**#11 模式文档路径（B9，口径修正）**
- 「两个函数合并」不成立：`preResearchModeDocPath` 指 `00-前期调研/` 下的调研定位稿，`modeDocPath` 指 `短篇创作/` `剧本创作/` 下的结构文档，合会改掉既有 vault 路径。真正的问题是**路径知识与「哪些文档决定阶段完成」各写一份**。
- 改法：`shared/mode-content.ts` 新增 `MODE_DOC_SPECS`（short 2 份 / script 3 份，含 dir+file）、`modeDocKinds(mode)`（长篇返回空）、`ModeDocKind`；`modeDocPath` 改查表（未知组合回落 outline，输出逐字不变）。`ui/full-writer/creation-flow-state.ts:110` 的手写 kinds 三元组删除、改 `for (const kind of modeDocKinds(mode))`。`shared/pre-research.ts` 新增 `PRE_RESEARCH_MODE_DOC_FILES` 表，并注明定位稿**不参与阶段完成判定**（判定只看 `调研数据.json` 字段 + 结构文档）。
- 新增 `tests/unit/shared/mode-doc-specs.test.ts`（5 例）：路径与表逐条一致 / kinds 覆盖 / 未知回落 / 两套产物不撞路径 / 源码不再手写三元组。

**#12 `ENGINE_MSG_CODES` 编译期校验（B7）**
- 新增 `scripts/gen-engine-msg-codes.mjs`：`ts.transpileModule` + `new Function` 加载 `i18n/messages/zh-CN.ts`（同 `scripts/check-i18n.mjs` 的 `loadCatalog`），拍平取 `engineMsg.` 前缀 → 生成 `shared/engine-msg-codes.ts`（126 键 + `EngineMsgCode` 联合类型）；`--check` 做漂移校验。
- `package.json` 增 `gen:engine-msg` / `check:engine-msg`，preflight 链插在 `check:i18n` 之后；`shared/ui-message.ts` 的 `UiMessage.code` 与 `uiMessage()` 首参改类型。
- 生产端 126 处 code 全部原本合法（改造零改动）；测试 3 处故意越界处加 `as unknown as EngineMsgCode`。新增 `tests/unit/i18n/engine-msg-codes.test.ts`（4 例）。
- 坑：生成器的头注释若写在模板字符串里、内含反引号，会把外层模板串截断（`SyntaxError: Unexpected identifier 'engineMsg'`）→ 改数组 `.join('\n')`。

**#13 三个小统一（A-11/A-12 完成，A-17 待）**
- `NOTICE_MS = { short: 2000, normal: 4000, long: 8000, sticky: 0 }`；`ui/components/notice-helpers.ts` 的 `showStructuredNotice` 增加 `defaultTimeout` 形参，错误 8000 / 成功与告警 4000，调用方显式 `timeout` 仍优先；`tests/unit/ui/pure-helpers-coverage.test.ts:570` 断言从「undefined」改为 `[8000, 4000, 4000]`。
- 保存按钮统一「💾 保存」：`ui/model-editor-modal.ts:122`、`ui/mcp-server-form-modal.ts:192`。
- A-17（撤销栈共享化）判定为 P2 性质，未在本批做。

**门禁**：`npx tsc --noEmit` 0 错；`npm run lint` 0 error（1029 warning 存量）；`check:i18n` zh/en 各 6045 条 / 无法解析键 0 / 动态键 29 / 棘轮收紧到 205 文件 5445 条；`check:engine-msg` 126 键一致；`npm run preflight` **EXIT=0**（1006 文件 / 10,421 通过 + 3 跳过，日志 `D:\nw-tmp\preflight-p1b.log`）；`check:bundle` 基线上调 main.js 6,224,760 → 6,228,126（+3,366，note 已说明），styles.css 800,112、workers 684,381/108,804 不变。提交 **0b38db00**。

**下一轮**：P2 #14-#20（空态统一 / `showProgress` 统一 / 字符串键收编 / 知识库 baseDir 双口径 / 设置页自动保存徽标 / Esc 语义 / `AIEngine` 收编），以及 #13 遗留的 A-17 撤销栈共享化。

---

## 第一百二十一轮：C 清单 P2 #14 —— 空态统一到 createEmptyState（2026-11-20，DSH）

**范围**：审计 A-8（空态三套渲染 + 图表内联第四套）与 A-18（图表空态内联 style）。

**组件扩展（ui/components/empty-state.ts）**
- `EmptyStateOptions` 增 `variant?: 'default' | 'compact'`；compact 不渲染图标，类名 `nw-empty-state nw-empty-state--compact`。
- 新增 `createCompactEmptyState(text: string, description?: string): HTMLElement` —— 一行灰字空态（监控面板/设置页那种）。
- 新增 `chartEmptyStateHtml(text: string): string` —— 返回 `<div class="nw-chart-container nw-chart-empty">${escapeHtml(text)}</div>`，**无内联 style**（消费方是 innerHTML 字符串，故给 HTML 而非元素）。

**替换面（26 处 + 6 个弹窗）**
- `ui/svg-charts.ts` 14 处：11 处「暂无数据」→ `chartEmptyStateHtml(t('emptyState.chartEmpty'))`、雷达图维度不足 / 数据总和为 0 / 暂无事件各 1。该文件原本**零 import**，新增 `t` 与组件 import；保留 :710 的百分比 span（数值标签不是空态）。
- `ui/prompt-manager-settings.ts` 3 处 `nw-empty-center-muted`（pickTemplate / abEmpty / usageEmpty）→ `createCompactEmptyState`。
- `ui/monitor-panel-a.ts` 4 个默认提示 + `showEmpty(msg)` → compact；`ui/monitor-panel-b.ts` 3 处 → compact。
- 六个弹窗/视图改 `appendChild(createEmptyState(...))`：`ui/asset-registry-modal.ts`、`ui/backup-center-modal.ts` ×2、`ui/job-center-modal.ts`、`ui/home-view.ts`（复用既有 `home.emptyTitle/emptyDesc`）、`ui/project-health-modal.ts` ×3、`ui/usage-ledger-modal.ts`。

**样式**
- `styles-src/07-charts-and-review.css` 新增 `.nw-empty-state--compact, .nw-scope .nw-empty-state--compact`（padding 8px 0 / 无边框无底 / 12px / text-muted / 居中）+ title 与 description 子规则；新增 `.nw-chart-empty`。
- **坑**：只写裸 `.nw-empty-state--compact`（0,1,0）会被弹窗内的 `.nw-scope .nw-empty-state`（0,2,0）压过，compact 仍是 48px 上下留白 —— 必须写双选择器。
- `styles-src/05-floating-panels-and-settings.css` 删 `.nw-float-empty`（含分组内成员）；`styles-src/06-cowrite-missing-and-dark.css` 删 `.nw-empty-center-muted`；两者已零引用。
- 保留 06 号文件 :826 的 `.nw-empty-state`（40px 16px / 虚线边框 / background-secondary）不动：六个弹窗原先手写空态就是这套外观，默认变体视觉等价；唯一有意变化是 emoji 图标统一成 64px 内联 SVG。

**资源**：新增顶层组 `emptyState`（zh/en 各 16 条，插在 `common` 后 `commands` 前）：noProject.{title,assetDesc,backupDesc,healthTitle,healthDesc}、backupEmpty.{title,desc}、jobsEmpty.{title,desc}、healthOk.{title,desc}、standardOk.{title,desc}、usageEmpty.{title,desc}、chartEmpty、radarMin、sumZero、noEvents。资源 zh/en 各 **6064** 条。

**验证**
- `npx tsc --noEmit` 0 错；`npm run build` EXIT=0（styles.css 32,114 行）。
- 实机（`D:\nw-tmp\snap-p214.mjs zh-CN|en-US`，产物 `D:\nw-dev-vault\_visual-p214\`）：job-center 空态 606×252（图标 + 标题 + 描述，零横向溢出）、project-health 594×270、监控两面板 compact 行各 **33px**；探针 computedStyle = padding 8px 0 / border 0 / transparent / 12px。
  - **两条坑**：①弹窗只能调插件方法（`openJobCenter / openBackupCenter / openUsageLedger / openAssetRegistry / openProjectHealth`），`app.commands.executeCommandById(...)` 返回 false；②右侧栏面板的元素截图在 CDP 下错位发黑，改记计算样式探针（面板根类名是 `nw-float-monitor-grid`，不是 view type）。
- 门禁：`npm run preflight` **EXIT=0**（1006 文件 / 10,423 通过 + 3 跳过，日志 `D:\nw-tmp\preflight-p214.log`）；check:css 体积 800,112 → **801,044**（+932，新增规则）、唯一类 4333；check:inline-styles 收紧到 474；check:i18n 棘轮 205 文件 / **5415** 条（−30）；check:engine-msg 126 键一致；check:jsdoc 100% / @example 56/56。
- **三处门禁连环坑**：①新增的公共导出必须带 `@example`，否则 check:jsdoc 直接失败；②`@example` 里写的 `t('…')` 会被 check:i18n 当真实键校验（我写了不存在的 `monitor.a.waitingChapter` 被拦）；③改了源码注释后必须重跑 `gen:docs`，否则 check:docs 报 `docs/generated/* 漂移`。
- 基线：.css-baseline.json、.inline-style-baseline.json、.i18n-baseline.json、.bundle-baseline.json（main.js 6,228,171 / styles.css 801,044）均带 note。

**遗留**
- `ui/monitor-panel-a.ts` 仍是硬编码中文（不在 i18n 第二期清单内，en 下 4 条 compact 文案仍中文）→ backlog，随该文件 i18n 切片处理。
- 六个弹窗标题（如 `ui/job-center-modal.ts:49`「🧵 任务中心」）同样未迁移，属各自 i18n 切片。

**下一轮**：P2 #15（`showProgress` 统一：裸 `new Notice(...,0)` 30 处 + `ui/outline-expand-modal.ts:912` 私有同名方法改名）→ #16 字符串键收编 → #17 kb baseDir → #18 设置页自动保存徽标 → #19 Esc 语义 → #20 AIEngine 收编；另有 #13 遗留的 A-17 撤销栈共享化。

## 第一百二十二轮：C 清单 P2 #15 —— 持久进度统一（progressHandle，2026-11-20，DSH）

**背景（审计 A-9 + A-10）**：`utils/helpers.ts:49` 的 `showProgress`（Notice 槽位 + setMessage 原地更新，47 处调用）与裸 `new Notice(msg, 0)`（**30 处**）并存；`ui/outline-expand-modal.ts` 还有一个同名私有 `showProgress`（弹窗内 DOM 进度），三套语义搅在一起。**审计把路径写成 `ui/utils/helpers.ts:49`，实际在仓根 `utils/`**（同 ZC-28 的教训：别人的结论也要复核）。

**改动**
- `utils/helpers.ts` 新增 `export interface ProgressHandle { setMessage(message: string): void; hide(): void; }` 与 `export function progressHandle(key: string, message: string): ProgressHandle` —— 内部复用既有 `showProgress(message, key)` / `hideProgress(key)` 的 key 槽位，返回句柄；调用方原有的 `.setMessage(...)` / `.hide()` 语义完全不变（最小 diff）。
- **30 处** `new Notice(msg, 0)` 全替换为 `progressHandle('<key>', msg)`，key 逐流程分配：setting-lib-generate / backup-yuan / protect-yuan / tomato-rank / worldview-generate / cover-save / continue-create / continue-generate / kb-batch-classify / project-create / golden-opening-{hook-check,hooks,rhythm,chars,world,scenes,scoring} / ideation-generate / plan-book-worldview / plan-book-outline / batch-create / cowrite-quality-fix / ai-builder-worldview / ai-builder-generate / fanfic-materials / fanfic-generate / novel-tags-analyze / volume-intro-generate / rebuild-chapters（:193 与 :228 共用同一 key，原「先 hide 再新建」改由 `setMessage` 原地更新）。
- `ui/ai-builder-modal.ts`：`generateSingle` / `generateBatch` 形参类型 `Notice` → `ProgressHandle`。
- `ui/outline-expand-modal.ts`：私有 DOM 进度方法改名 `setProgressText` / `hideProgressBar`（4+4 个调用同步改），消除与共享 helper 的同名异物。
- 测试：`tests/unit/utils/helpers-escape-notice.test.ts` 新增 4 例（创建即登记 / setMessage 复用同 key 槽位 / hide 幂等只关一次 / 不同 key 隔离），该文件共 10 例通过。

**坑（重要）**
- 批量插 import 时按文件深度算相对路径，生成了 `'../utils/helpers'` / `'../../utils/helpers'` → `tests/unit/shared/path-alias.test.ts`「运行时代码不再使用 ../ 跨目录引用」直接失败。**运行时代码一律用 `'@/utils/helpers'`**（tsconfig / esbuild / vitest 三处都配了 @ 别名）。

**门禁**
- `npx tsc --noEmit` 0 错；`npm run lint` 0 error（1029 warning 存量）；`npm run build` EXIT=0。
- `npm run preflight` **EXIT=0**：1006 文件 / **10,427 通过 + 3 跳过**（日志 `D:\nw-tmp\preflight-p215b.log`）；check:jsdoc 100% / @example 56/56；check:engine-msg 126 键一致。
- `.bundle-baseline.json`：main.js **6,228,536**（+365）、styles.css 801,044，note「P2 #15 持久进度通知收编」；dev-vault sync 更新 4 文件。

**下一轮**：P2 #16 字符串键收编 → #17 kb baseDir 双口径 → #18 设置页自动保存徽标 → #19 Esc 语义 + 长任务 onClose → #20 AIEngine 收编；另有 #13 遗留的 A-17 撤销栈共享化。

## 第一百二十三轮：C 清单 P2 #16 —— 字符串键收编（2026-11-20，DSH）

**背景（审计 B3 + 补充）**：`_分卷大纲.md` 后缀在 10 个运行时模块里各写一遍；`sections['卷名']` 裸字符串与 `FIELD_VOLUME_NAME`（零消费死常量）并存；`ui/novel-tags-modal.ts` 与 `ui/volume-intro-modal.ts` 各有一份几乎逐行相同的分卷大纲解析器（卷头 / KV / 章节表三段正则 + 摘要拼装）。

**改动**
- `shared/paths.ts`：新增 `VOLUME_OUTLINE_SUFFIX`、`isVolumeOutlineFileName(name)`、`volumeNumberFromOutlineName(name)`；`pjVolumeOutlineFile()` 改由常量拼装（路径输出逐字不变）。
- 后缀判断替换（**10 处**）：`engine/ai-outline-generator.ts`（两处 endsWith）、`engine/long-term-memory.ts`（原 `/^第(\d+)卷_分卷大纲\.md$/` 正则 → 谓词 + 卷号函数）、`ui/chapter-outline-tree-modal.ts`、`ui/continue-chapters-modal.ts`、`ui/full-writer/wizard-controller.ts`、`ui/full-writer/wizard-step-validators.ts`、`ui/plot-canvas-modal.ts`、`ui/rebuild-chapters-modal.ts`、`ui/volume-intro-modal.ts`、`utils/helpers.ts`（残留文件清理 + 合并读取 + 卷号排序）。
- `shared/format-constants.ts`：新增 `RE_OUTLINE_KEY_LINE`（任意 KV 行）与 `RE_OUTLINE_SUMMARY_FIELD(field)`（全书总览字段）。
  - **顺手修掉一个既存 bug**：模板与 plan-book 写出的都是 `- **总字数目标**：120万`（字段名带加粗），旧正则只认 `总字数目标：`，两个弹窗因此长期取到空值、AI 提示词里永远显示「未设定」。新正则吃掉可选 `**`。
- 新增 `shared/volume-summary.ts`：
  - `parseVolumeSummary(content)` → `{ bookSummary, volumes }`（类型 `VolumeBookSummary` / `VolumeEntry`）；
  - `formatVolumePromptSummary(volumes, options)`（`conflictLabel` / `maxChars` / `bookSummary` 兜底 / `unnamedVolumeLabel`），保住两侧原有口径：novel-tags 用「冲突示例」且不截断，volume-intro 用「关键冲突示例」且 `slice(0, 6000)` 并带总览兜底。
- 两个弹窗删掉各自的私有解析器/摘要器与 `BookSummary`/`VolumeData` 接口；`sections['卷名']` 改 `sections[FIELD_VOLUME_NAME]`（死常量复活）。
- 新增 `tests/unit/shared/volume-summary.test.ts`（14 例）：总览三字段、切卷与 KV、只有带「章节范围」的卷才收章节行、无卷空数组、默认/自定义冲突前缀、`maxChars` 截断、未命名占位、总览兜底、文件名谓词与卷号、以及「两个弹窗不再自写正则」「运行时代码不再就地 endsWith」的源码级不变量。

**门禁**
- `npx tsc --noEmit` 0 错；`npm run lint` 0 error（1030 warning 存量）；`npm run build` EXIT=0。
- `check:jsdoc` 100% / @example 56/56（986 文件）；`check:cjk-keep` 通过；`check:i18n` 通过，UI 中文棘轮 **205 文件 / 5,366 条**（原 5,415，删重复解析器里的中文键名后下降 49，已 `--update-baseline` 收紧）；`check:engine-msg` 126 键一致。
- `.bundle-baseline.json`：main.js **6,227,024**（−1,512，去重收益）、styles.css 801,044；dev-vault sync 更新 4 文件。
- 运行时抽查：`node D:\nw-tmp\snap-p216.mjs zh-CN` 启动开发 vault 无报错（`novel-writer-volume-intro` 命令在无激活项目时返回 false，属 `LONG_ONLY` 守卫，未强行绕过）。

**下一轮**：P2 #17 知识库 baseDir 双口径 → #18 设置页自动保存徽标 → #19 Esc 语义 + 长任务 onClose → #20 AIEngine 收编；另有 #13 遗留的 A-17 撤销栈共享化。

## 第一百二十四轮：C 清单 P2 #17 + #18 —— 知识库 baseDir 口径与设置页自动保存徽标（2026-11-20，DSH）

**#17 知识库 baseDir 双口径（B6）**
- `services/knowledge-base-manager.ts`：`sweepOrphanVectorArtifacts` 的两处 `fsPort.listFolders(kbKnowledgeBaseDir())`（:602 / :634 分支）改 `kbKnowledgeBaseDir(this.baseDir)` —— 自定义 baseDir 时，孤儿向量扫描原来扫的是默认目录。
- `ui/settings/knowledge-section.ts`：显示的库路径与「打开文件夹」改用 `this.knowledgeBaseManager?.getBaseDir() ?? kbKnowledgeBaseDir()`（原硬编码 `写作知识库/`）。
- `tests/unit/services/knowledge-base-orphan-vectors.test.ts`：FakeFileSystem 增 `folderListArgs` 记录入参 + 2 例（自定义 baseDir 传入自定义目录；自定义 baseDir 无书时照常清理），6 例通过。

**#18 设置页自动保存徽标 + 高危字段恢复（A-15）**
- 新增 `ui/settings/autosave-hint.ts`：`renderAutoSaveHint(container)`，幂等（遍历 `container.children` 去重；**`:scope >` 选择器在 test fake-dom 下不生效**，会叠两条），渲染 `.nw-settings-autosave-badge` + `.nw-settings-autosave-hint`。
- 新增 `ui/settings/autosave-snapshot.ts`：`AutoSaveSnapshot`（只保留首次值）+ `createRestoreButton()`（`nw-api-restore-btn`，无快照时 `disabled` + `is-disabled`）。
- 接线：`ui/settings-tab.ts` / `ui/mini-settings-modal.ts` 分区渲染前插徽标；`ui/settings/api-section.ts` 对 Base URL（`endpoint:<id>`）与 API Key（`apiKey:<id>`）建恢复按钮，`change` 时 `capture()` 改动前值，恢复后 `rerender()`（密钥恢复按 `saveSettingsWithOutcome().droppedSecrets` 选提示）。
- i18n 5 键；样式 4 条规则；`tests/unit/ui/settings-autosave.test.ts` 7 例。
- 坑：恢复按钮放在 Base URL 的 textarea 字段里会被拉成整行（实测 414px），补 `width: fit-content; align-self: flex-start` 后 87px（en 119px）。
- 截图入口：Obsidian 的设置弹窗在**独立窗口**打开，CDP 里主窗口 `.modal` 数为 0，必须找到第二个 target（`about:blank`）再截图；脚本 `D:\nw-tmp\snap-p218.mjs <zh-CN|en-US> <tabId>`，tab 用 `api` / `setup`（`general` 不是合法 tab id）。

**门禁**：tsc 0；check:i18n zh/en 各 6069、棘轮 205 / 5365；check:css 基线 801891 字节 / 4338 类（+847 / +5）；check:inline-styles 474 不变；check:utility 46 类 / 137 次；check:bundle main.js 6,229,396 / styles.css 801,891；preflight EXIT=0。

**下一步**：P2 #19（Esc 语义文档化 + 长任务弹窗 onClose 运行态确认）→ #20（AIEngine 绕过 registry 的三处临时实例收编）→ #13 遗留 A-17（撤销栈共享化）。

## 第一百二十五轮：C 清单 P2 #19 —— Esc 语义文档化 + 长任务弹窗运行态确认（2026-11-20，DSH）

**#19 长任务运行态守卫（A-14）**
- 新增 `ui/components/modal-running-guard.ts`：`ModalRunningGuard`（构造传 `isRunning` 探针，`attach(modal, app)` 覆写实例 `close()`，`confirming` 闸门防 Esc 连按叠加确认框，`catch` 保持弹窗打开）。与 `modal-dirty-guard` 同拦截时机——Esc / 点遮罩 / 代码 `this.close()` 都经过覆写的 `close()`，放 `onClose` 里已经关完了。
- **语义边界**：确认 = 「关闭弹窗，任务继续在后台跑（进度条仍在）」，不做「关闭即取消」——重建章节 / 继续创建 / 批量建章 / 备份元文件四个任务都没有 AbortSignal 基建，假装取消会造成更危险的误解。
- 接入四个弹窗，任务开始置 `running = true`、结束/finally 复位、`onClose` 兜底重置：
  - `ui/rebuild-chapters-modal.ts`（`rebuild()` 起循环前 / `mainNotice.hide()` 前）
  - `ui/continue-chapters-modal.ts`（创建章节与生成续写两条路径，finally + catch 复位，共 3 处）
  - `ui/batch-create-modal.ts`（短篇/剧本建单元 / 按全书规划建章两条路径）
  - `ui/backup-yuan-modal.ts`（`backup()` 的 finally）
- i18n 4 键 `modalRunningGuard.title|description|background|stay`，资源 zh/en 各 **6073**。
- Esc 分层口径写成独立文档 `docs/design/2026-11-20-modal-close-and-esc-semantics.md`：L1 编辑面（收辅助、自动保存）/ L2 搜索（清词、关查找条）/ L3 表单弹窗（DirtyGuard 询问）/ L4 长任务（RunningGuard 问任务命运），外加两条硬规则（关弹窗 ≠ 停任务；非脏非运行不拦）与 backlog（AbortSignal 真取消、L1 撤销栈、剩余 DirtyGuard 接线）。

**测试**
- `tests/unit/ui/modal-running-guard.test.ts` 7 例：非运行放行 / 确认前不关 / 选「关闭，任务继续」才关且运行态仍 true / 选留不关 / 连按不叠加 / 任务结束后不再询问 / attach 幂等 + 解除还原。
- `tests/unit/ui/modal-running-guard-wiring.test.ts` 15 例（源码级不变量）：四个弹窗都导入并挂载、都有 true/false、`onClose` 都兜底；backup 在 finally 里复位、rebuild 在 `mainNotice.hide()` 前复位、continue 至少 3 处复位。

**坑**
- 四个 modal 都是 **CRLF**，`String.replace` 的锚点若只写 `\n` 会静默 MISS：首轮 patch 只插进去 `running = true`，字段 / attach / onClose 全缺，tsc 报 6 处 `TS2339: Property 'running' does not exist`。修法是把整文件 `\r\n` → `\n` 归一后 patch，再整体还原 `\r\n`（整文件同构才安全）。
- `ui/batch-create-modal.ts` 的 `batchCreateAll` 里仍有 `new Notice(..., 0)`（#15 收编时漏掉的裸持久通知），本轮未动，记入 #20 后的小清理。

**下一轮**：P2 #20（`main.ts:1881/1977/2059` 三处临时 `AIEngine` 收编到 registry 单例）→ #13 遗留 A-17（撤销栈共享化）。

## 第一百二十六轮：C 清单 P2 #20 —— AIEngine 临时实例收编（2026-11-20，DSH）

**#20（§2.1 表 #1）**
- `main.ts` 三处临时引擎统一走 registry 单例：`generateChapterBySceneLoop`（原 :1881）、`autoReviseChapter`（:1977）、`runBaselineProbe`（:2059）的 `const engine = new AIEngine(this);` → `const engine = this.aiEngine;`（`:2875` 的 getter = `engineRegistry.get(ENGINE_NAMES.AI_ENGINE)`）。
- 全仓 `new AIEngine(` 只剩 `engine/engine-registry.ts:1440` 的 `registerLazy` 与 `tests/unit/engine/ai-engine.test.ts`（单测直接构造被测对象，保留）。
- 新增 `tests/unit/architecture/single-ai-engine-instance.test.ts` 4 例：main.ts 无 `new AIEngine`、三个方法体里都是 `this.aiEngine`、唯一构造点在懒注册、`ui/full-writer-view.ts` / `ui/co-writing-view.ts` / `engine/co-writer-engine.ts` 不直接构造（源码级棘轮防回潮）。
- 测试坑：方法体切片长度 400 太短（`autoReviseChapter` 里 `const engine` 在 index/checker 之后约 600 字符处），改 900。

**门禁**：tsc 0；check:bundle main.js 下降；preflight EXIT=0。

**下一轮**：#13 遗留 A-17 撤销栈共享化（协同写作视图有撤销栈，单元写作台没有），P2 全清单至此收口。

## 第一百二十七轮：C 清单 #13 遗留 A-17 —— 单元写作台撤销栈共享化（2026-11-20，DSH）

**A-17**
- 撤销栈从 `ui/co-writing/edit-history.ts` 移到 **`shared/edit-history.ts`**（纯数据结构，无 DOM / obsidian 依赖），协同视图与单元写作台共用同一套「项目|单元」多栈语义；旧文件删除，`ui/co-writing-view.ts` 与 `tests/unit/ui/co-writing-edit-history.test.ts` 的 import 改路径。
- `ui/full-writer/unit-writer-controller.ts`：新增 `ChapterHistoryStore` 实例、`undoBtn`/`redoBtn`/`historyBarEl` 三字段；栈键 `unitHistoryKey() = 项目|单元号`；`seedHistory()` 渲染时用当前正文播种（切回单元保留原栈）；`pushHistorySnapshot(force)` 800ms 节流；`undoEdit()` / `redoEdit()` / `applyHistoryText()`（写回后按 dirty 走自动保存）/ `refreshHistoryButtons()`（按 `canUndoRedo` 启停）。
- 提交点四处：输入监听（节流）、`blur`（强制）、`setBody()`（AI 结果 / 一键排版）、AI 生成分支两处裸赋值（成功与失败回滚）。
- 快捷键：`main` 容器 keydown 内 `event.target === this.editorEl` 时接管 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，其它焦点不拦（标题框仍走原生撤销）。
- UI：撤销/重做按钮放头部第三行（右对齐）。**不能挂 `headerMetaEl` 里** —— `updateHeaderMeta()` 用 `setText` 会清空子节点，且 224px 窄列下首版把「第1节 · 20 字 · 待写」折两行、「已保存」竖排成 3 行。
- i18n 4 键 `fullwriter.uw.undoBtn|undoTip|redoBtn|redoTip`（提示复用 `cowrite.undoEarliest` / `cowrite.redoEmpty`）→ 资源 zh/en 各 **6077**；样式 `styles-src/15-late-fixes.css` 新增 `.nw-unit-history` / `.nw-unit-history-btn`，`.nw-unit-save-state` 加 `white-space: nowrap; flex: none`。
- 实机（`D:\nw-tmp\snap-a17.mjs <lang>`，dev vault「短篇小说/短篇示例」）：初始两按钮 disabled；输入 + blur 后撤销可用；撤销逐字恢复原文、重做恢复新文本；切第 2 节两按钮 disabled（独立栈）；切回第 1 节撤销仍可用（栈持久）；zh/en 头部 224×96 零溢出。
- 测试 `tests/unit/ui/unit-writer-undo.test.ts` 7 例（模块位置 / 栈键隔离 / 三个提交点 / 快捷键 target 守卫 / 按钮态与键 / 两种提示 / 双语资源）。
- 已知遗留：en 下 `第1节 · 20 chars`、`Complete this 节` 仍混中文（`modeUnitLabel` 返回中文单位名插入英文模板），属 i18n 未迁移面。

**下一轮**：C 清单 P0×4 / P1×9 / P2×7 全部收口，等用户指定方向（视觉 / 功能 / i18n 余下 ideation 793 → batch-import 750 → agent-workbench-view 730）。

## 第一百二十八轮：真实点击验收 —— 写作台横向溢出 + 页签标题补写（2026-11-20，DSH）

**背景**：用户要求「不用脚本触发，真实点击验证插件界面可用性，排查 Obsidian 开发者面板错误，给验收标准」。

- 环境坑：Obsidian 1.14.5 把设置窗口与命令面板开在**第二个 window**，抢走 activeWindow 后插件 Modal 也弹到那个窗口 —— 主窗口截图里表现为「点了没反应」。脚本必须先关闭多余 page（`for (p of ctx.pages()) if (p !== main) await p.close()`）。据此复核：主页「进入短篇小说」**不是 bug**（干净单窗口下正常弹出「📥 短篇前期调研」Modal）。
- **FIX-01 写作台横向溢出（P0）**：1440×900 下 .novel-writer-fw-container clientWidth 1072 / scrollWidth 1391，右栏「上下文监控」x=1517 完全在屏外。罪魁 .novel-writer-fw-title-row w=1350 + .novel-writer-fw-titlebar 1371（flex-shrink: 0、行内不换行 → 容器最小内容宽被顶到 1350）。
  - 修法：styles-src/02-full-writer-view.css:167 的 .novel-writer-fw-title-row 加 flex-wrap: wrap; min-width: 0; + 新增 .novel-writer-fw-title-row > * { min-width: 0; }；styles-src/04-workspace-layers.css:48 的 .novel-writer-fw-title-secondary 加 flex-wrap: wrap; min-width: 0;；styles-src/08-workbench-v7-v8.css:1195 的 .novel-writer-fw-quick-tools-row 加 min-width: 0;。
  - 复验：1440 cw=sw=1072、ctx x=1198 可见、titleRow 90px；1280 cw=sw=912、ctx x=1038；docOverflow 0。
- **FIX-02 页签标题（P1）**：重启后 Obsidian 的 DeferredView 让未实例化视图的页签显示视图类型 id（20 个页签里 19 个是 novel-writer-*），点一下才变中文。
  - 新文件 ui/view-tab-titles.ts：pluginViewTabTitle(viewType) / pluginViewTypes()，11 个视图类型 → t(...) 标题。
  - main.ts 新增 _scheduleDeferredTabTitlesFix()（onLayoutReady + 0/300/1000/2500ms 重试 + workspace.on('layout-change')）与 _fixDeferredTabTitles()（iterateAllLeaves，仅当 tabHeaderInnerTitleEl 文本等于视图 id 时改写）。**只调一次没用**：那时页签 DOM 还没渲染。
- **i18n**：页签标题模块带来 5 条中文字面量，棘轮会涨 —— 选择把 4 个视图标题真正迁进资源（shellView.planning|memoryGraph|sidePanel、cowrite.view.title、monitorA.viewTitle），而不是上调基线。资源 zh/en 各 **6082**；棘轮 **205 文件 / 5360 条**。
- 测试：tests/unit/ui/view-tab-titles.test.ts 4 例（注意相对路径是 ../../../ui/...）。
- 文档：新增 docs/audits/2026-11-20-ui-real-click-acceptance.md（验收标准 A–F、实测表、FIX-01/02、缺陷清单 F-03..F-09、回归命令）。
- 门禁：tsc 0、lint 0 error（1030 warning）、check:i18n / check:jsdoc / check:inline-styles / check:utility 通过；基线 .bundle-baseline.json main.js **6235714** / styles.css **802934**、.css-baseline.json bytes 802934。
- 未修（已登记）：F-03 打开第 1 章即触发一次 AI 调用，key 无效时只有控制台 401 与体检条「0%」，界面无提示；F-04 设置页「使用中」开关压字；F-05 高级设置页签虚线焦点框；F-06 约 900px 宽阶段导航截断；F-07 800px 高状态栏第二行被裁；F-08 启动 3 条 warning。

**下一轮**：F-03（错误可见性，P1）优先，其后 F-04/F-05 属设置页观感。

## 第一百二十九轮：真实点击验收 F-03..F-08 修复（2026-11-20，DSH）

**背景**：m26750「那就按顺序修复」——按 `docs/audits/2026-11-20-ui-real-click-acceptance.md` §六 的 F-03 → F-08 顺序逐条修。

- **F-03 体检静默 401**：`engine/ending-traction-engine.ts` 新增 `plotThreadError` + `getPlotThreadError()`，AI 回退 catch 与「无模型」分支记录原因；`ui/full-writer/checkup-bar-controller.ts` 新增 `checkupErrorText()`（401/403/认证/key → 「API 密钥无效或未配置…」）与 `reportPlotParseFailure()`：体检条「体检不可用：<原因>」+ 按「项目+原因」去重的一次性错误 Notice。单测 12 条通过（新增 4 例）。
- **F-04 开关压字**：`ui/settings/api-section.ts` 外层 `label.nw-api-switch` → `label.nw-api-switch-field`（inline-flex/gap 6px/flex-shrink 0），轨道与文字并列；`.nw-api-switch-text` 加 nowrap。实测 field 126×20、轨道 36×20、文字 84×16，零重叠。
- **F-05 四边虚线**：`styles-src/05-floating-panels-and-settings.css` 的 `.nw-settings-tab-advanced-toggle` 由只写 `border-style: dashed` 改 `border: none; border-bottom: 2px dashed …`；实测 top/left/right = 0px none。
- **F-06 导航截断 + 英文阶段名**：`ui/full-writer/streamlined-nav-presenter.ts` 去掉模块级 `t()` 常量，改 `phaseLabel(key)` 懒取（switch + 字面量键），`getStreamlinedPhases()` 每次现算 label；导航宽 `clamp(140px, 16%, 208px)`；`.novel-writer-fw-step-label` / `.novel-writer-fw-substep-label` 改换行（子步骤行 `flex-wrap: wrap`、标签 `flex: 1 1 60px`）。en 1280 下五阶段全英文、11 个子步骤 `trunc:false`。新增 2 条语言切换回归测试（共 10 条通过）。
- **F-07 状态栏被裁**：`styles-src/04-workspace-layers.css` 的 `@media (max-width: 1100px)` 内加容器 `overflow-y: auto`、标题栏 `max-height: 40vh; overflow-y: auto`、状态栏 `position: sticky; bottom: 0`；`15-late-fixes.css` 窄容器查询里只留 workspace `min-height: 320px`。**坑**：`.novel-writer-fw-layout-host` 才是 `@container nw-fw` 的查询容器，标题栏/状态栏/容器都在它外面，写进 `@container` 不生效。900×600 与 1100×680 复验 `barInside=true`、无横向溢出。
- **F-08 启动 3 条 warning**：`engine/heavy-task-worker-manager.ts` 与 `engine/quality/quality-worker.ts` 的缺失清单去掉按设计不注入的 `rhythmAnalyzer`；`engine/analysis-session-manager.ts` 对 `ENOENT` 降为 `log.debug`。复验控制台原 3 条 warning 全消失，只剩真·无效 key 的 401（由 FIX-03 给提示）。
- **新发现 F-10（P3）**：设置页供应商列表在 250px 窄列里名称截成「本地 OIl…」「D… deepseek-v4-flash」——已在第一百三十轮修复（侧栏改两行 + title）。
- 门禁：check:i18n 205 文件 / 5359 条（基线已收紧）、check:css 805679 / 4340 类（基线已上调并写 note）、check:bundle main.js 6237361 + styles.css 805679、check:inline-styles / check:view-tests / check:silent-failures 通过；全量 preflight 见下方。
- 复验脚本（仓外，勿提交）：`D:\nw-tmp\probe-f67f.mjs`（en/zh 三档尺寸布局）、`D:\nw-tmp\probe-f08.mjs`（启动控制台）、`D:\nw-tmp\probe-f45.mjs`（设置页开关与页签边框）。

## 第一百三十轮：真实点击验收收尾（F-10 + F-11 调试留痕）

用户 m27210「将下一步候选都修掉」，把验收文档里最后两条待处理清掉。

### F-10 设置页供应商列表名称截断（208px 侧栏）
- 根因：`.nw-api-sidebar-row` 单行 flex，名称（`flex:1; min-width:0`）与 `.nw-api-sidebar-model`（`max-width:120px; margin-left:auto`）抢同一行，两侧一起省略号。
- 修法：`styles-src/14-model-and-font-settings.css` 行加 `flex-wrap: wrap; row-gap: 2px`；模型摘要改 `flex: 1 1 100%; order: 5; margin-left: 20px; margin-right: auto; max-width: calc(100% - 20px)`（独占第二行、与名称左对齐）；`ui/settings/api-section.ts` 两处名称 span 加 `title` 全名。
- 复验 `D:/nw-tmp/probe-f10.mjs`：5 家供应商 `nameW=131 / nameTrunc=false / modelBelowName=true`、行高 47px；超长模型名（gemini-3.1-pro-preview-search）仍省略但带 title。截图 `_verify/f10-sidebar.png`（208×631）。
- 回归测试：`tests/unit/ui/api-section-dom.test.ts` 新增「F-10：侧栏名称整行显示并带 title，模型摘要换到第二行」（名称 attr 与 styles.css 两条规则断言），12 例通过。

### F-11 调试留痕降级（7 处）
- `ui/states/chapter-state-manager.ts`：开始恢复（info）、步骤检查（warn）、bodyGeneration 参数（warn）、正文 status=已完稿跳过标脏（info）、restoreChapterState 完成（warn）→ `log.debug`；异常分支（chapDir 为空/非文件夹、读文件失败、状态读取失败、analysisReport 读失败、标脏失败、P2-5 索引迁移）保持 warn。
- `ui/full-writer/tab-controller.ts` 的 chapDir 重建与 renderTabContent 参数、`ui/full-writer/full-writer-utils.ts` 的 calcResumeStepIndex 结果同样降 debug。
- 复验 `D:/nw-tmp/probe-f08.mjs zh-CN`：控制台只剩真·无效 key 的 401 两条（FIX-03 已有界面提示），零 warning。

### 门禁与交付
- tsc 0 错；`npx vitest run tests/unit/ui/api-section-dom.test.ts` 12 通过；build + `dev-vault sync`（4 文件）。
- 文档：`docs/audits/2026-11-20-ui-real-click-acceptance.md` 新增 FIX-10 / FIX-11 两节、§六 表 F-10 改已修复并新增 F-11 行、§八 回归步骤加 `probe-f10.mjs`。

## 第一百三十一轮：复核 C 清单落地 + 中文面板排版实测（2026-11-20）

用户（m27378）：「下一步需要继续，但需要复核。同时需要验证排版问题，使用中文面板」。

**复核发现（按「调用点 → 渲染路径 → 用户可见」逐条核，不看 disabled 计数）**
- 审计 C 清单在文档上标了全修，实体只落了一部分。
- A-1 防重复：只有 `ui/generate-worldview-modal.ts:110` 真无守卫；其余生成弹窗都有各自闸门（generate-character 系列同步置 disabled 后 await、pre-research 的 `if (researchBtn.disabled) return`、unified-entity 的 `_generating`、expand-text 首行换掉按钮等）。
- A-5 关闭确认：`ModalDirtyGuard` 只接了 3 个 Modal；实测 `ui/` 下 `extends Modal` 且含 textarea 的 27 个。

**本轮改动**
- `ui/generate-worldview-modal.ts`：生成按钮包 `withButtonBusy(generateButton, t('planBook.generating'), ...)`，校验留在忙碌态外。
- 补 5 个弹窗的关闭确认：`ui/golden-opening-modal.ts`、`ui/style-distiller-modal.ts`、`ui/template-manager.ts`（TemplateEditModal）、`ui/views/knowledge-base-modals.ts`（EditBookModal / GenreEditModal）；统一 input/change 即脏、成功路径 `markClean`。
- `tests/unit/ui/modal-guard-wiring.test.ts`：12 例源码级接线不变量（新增 4 组：golden-opening / kb-modals / template-manager / style-distiller 必须含 guard + attach + markClean；世界观必须用 withButtonBusy 且无裸调用）。

**中文面板排版实测**（`D:\nw-tmp\probe-layout131.mjs`，真机点击）
- 写作台 短篇/长篇 × 1440×900 / 1280×800 / 900×680 六档：`clipped` 全空、`docOverflowX` 0、状态栏 `barInside` true（900×680 换行成 62px 仍完整）。
- 知识库 `.nw-kb-view` 1396×830、黄金开篇 640×616、世界观 680×739、文笔蒸馏 640×370：零裁切、零横向溢出。
- 关闭保护实机可用：文笔蒸馏输入后按 Esc → 「留在此页继续编辑 / 丢弃并关闭」，选前者输入仍在。

**脚本坑（已写进脚本注释）**：命令 id 必须带插件前缀；WORLDVIEW/STYLE_DISTILLER 注册为 LONG_ONLY，短篇项目下只弹 Notice；进写作台必须先点项目卡再点「继续写作」。

**门禁**：tsc 0；`modal-guard-wiring`（12）+ `kb-modals-logic` + `golden-opening-modal-dom` + `modal-dirty-guard` 共 27 例通过；build 成功；preflight EXIT=0（1013 测试文件 / 10503 通过 + 3 跳过）；bundle main.js 6239011（+1602）、styles.css 805893 未变；gen:docs 1012 个源文件、check:docs 20 个活跃文档。

**下一轮候选**：剩余 20 个含编辑区弹窗按同模式分批接关闭确认（ai-builder / create-project / existing-entity-manager / cowrite 两个 / fanfic-review / fingerprint-library / generate-* 五个 / ideation / manage-providers / mode-document / novel-analysis / outline-expand / pre-research / unified-entity-generate / volume-intro）。

## 第一百三十二轮：版本功能清查与 4.97.0 发版（2026-11-20）

用户 m27825：「进行最后一轮版本功能清查，并且打tag发版」。

**清查（先复核再下结论）**
- INDEX 与模块页抬头对齐真值：「设定 / 人物卡」doing → stable（Slice A–G + P）；质量闭环 / 统计 / 导出 三个 todo → stable（功能已交付，未单独做模块打磨）；「市场 / 插件」→ 未实施（M5 决策）。`docs/modules/knowledge-base.md` 抬头「G 弹窗待做」与正文 §3.10 矛盾，一并改为 stable。
- 命令真值：`addCommand` 90 条唯一 + `r.register` 22 条唯一，`command-ids.ts` 97 个 id，`internalOnly` 3 条；抽查 QUALITY_LOOP / QUALITY_DASHBOARD / EXPORT_MANUSCRIPT / WRITING_STATS 三处接线齐备。
- i18n 6087 条 ×2 语言，棘轮 205 文件 / 5359 条；内联样式 474（静态 410 / 动态 64）；工具类 46 个 / 137 次引用。

**发版路径与踩坑**
- 版本 4.96.1 → 4.97.0（minor：双语 + 文面体检 + TTS + 视觉 Slice A–Y + 交互修复）。tag **必须不带 v 前缀**（`scripts/check-release.mjs:72-74`），且 `docs/releases/<tag>.md` 必须存在。
- `shared/changelog-data.ts` 内置更新日志有两条硬闸：首条必须是当前 package 版本、条目 ≤12 且总字节 ≤12000 —— 新增 4.97.0 后必须删最旧的 4.86.0。
- `check:cjk-keep` 灰区按字数设上限：内置更新日志新增中文会把灰区推高（34546 → 34574）。正确做法不是抬基线，而是在 `scripts/cjk-keep-allowlist.json` 的 keep 段声明 `shared/changelog-data.ts`（属发布记录数据），灰区随即回落到 33160。
- `check:docs` 会校验 7 个活跃文档的版本戳（README / docs/README / ARCHITECTURE / DEVELOPMENT / API / PLAN / CODE-INDEX），bump 后必须同步；README 里「界面仅中文」也随双语改为「界面中英双语」。
- `package-lock.json` 版本戳不同步会被 `check:automation` 拦下。
- `program-status.json` 改 baseline 后必须 `npm run program:render`，否则 `--check` 报「台账不同步」。

**门禁**
- `npm run preflight` **EXIT=0**：1013 测试文件 / **10503 通过 + 3 跳过**（日志 `D:\nw-tmp\preflight-4.97.0e.log`）。
- `check:release --tag 4.97.0` 通过；`check:bundle` main.js 6239510（+499，内置更新日志新增条目并裁剪最旧条目，note 已写）、styles.css 805893；`check:changelog` 顶部 4.97.0 唯一。

**交付物**
- `docs/releases/4.97.0.md`（发版说明 + 功能清查表 + 验证 + 未完成项）；CHANGELOG 4.97.0 条目；`shared/changelog-data.ts` 4.97.0 条目。
- `docs/CURRENT.md` 版本 4.97.0 / 2026-11-20，§4 标注「①–⑦全部交付」、§6 增旧写入链与悬浮面板退役。
- `docs/progress/program-status.json` baseline 4.97.0 / 1013 文件 / 10503 用例。

## 补记（同轮）：CI / Release 工作流断链修复

打 tag 后发现 `gh run list` 里 CI 连续红：verify job 报 `npm error Missing script: "check:dsh-isolation"`。
根因是 6c8d79b7（2026-11-15）删掉 `scripts/check-dsh-isolation.mjs` 与对应 npm 脚本时，`.github/workflows/ci.yml`（105-106 行）、`.github/workflows/release.yml`（57 行）没同步删——从那天起每次 push 的 CI 都必红，tag 触发的 Release 也在同一 job 失败（run 44663955232 1m18s 失败）。

处理：删两处残留步骤；README 去掉「Desktop-only optional backend（dsh）」整段；`docs/handbook/04-interface-contracts.md` §2.9 与 `docs/handbook/07-runbook.md` §5 改写为「Agent 只跑内置 Harness」并给出新的排障表；CHANGELOG 4.97.0 与 `docs/releases/4.97.0.md` 验证表各加一行。

教训：**删脚本/删功能时要扫工作流**。`check:docs`、preflight 都不会校验 workflow 引用的 npm 脚本是否存在，所以本地全绿不代表 CI 能跑；改 package.json scripts 后应 grep `.github/workflows/`。

## 第一百三十三轮：社区插件目录上架准备（4.97.1）

发版 4.97.0 后用户要求同步到 Obsidian 社区。查官方文档发现提交渠道已变：不再走 `obsidian-releases` 的 `community-plugins.json` PR，而是 [community.obsidian.md](https://community.obsidian.md) 用 Obsidian 账号登录 + 关联 GitHub 后提交（全量目录当时 10616 个插件，`novel-writer-ai` 不在其中，属首次上架）。

对照（Submission requirements for plugins）后改了两处硬要求：

- **`isDesktopOnly` 改 `true`**：插件有三处 Node/Electron 调用——`shared/desktop-shell.ts`（动态 import `node:child_process`，保护元文件）、`shared/mcp-file-browse.ts`（`require('node:fs')`，MCP 程序选择器）、`engine/agent/harness/mcp-stdio-transport.ts`（`require('node:child_process')`）。虽然移动端都有降级，但目录规则是「用到就必须声明」，因此本版起移动端不可安装；恢复路径写进 `docs/releases/community-submission.md` 遗留事项。
- **描述改写**：原 204 字符名词短语 → 219 字符动作句「Write, plan, and polish … and export.」（≤250、句末句号、无 emoji）。

顺带修掉的过期说法：README「界面仅简体中文」（4.97.0 已双语）、README 平台说明三处、`shared/desktop-shell.ts` 注释里已删除的 `check-dsh-isolation` 门禁。新增 README「外部文件访问（仅桌面端）」与英文 `Local file access` 披露段（开发者政策要求 vault 外文件访问必须披露）。

新增文档 `docs/releases/community-submission.md`：现状流程五步、16 条上架清单及证据、可直接用的描述文案与分类建议、常见打回点自查表。

门禁：`npm run build` / `check:release --tag 4.97.1` / `check:changelog`（顶部 4.97.1 唯一、128 个节点）/ `npm run preflight` **EXIT=0**（1013 文件 / 10503 通过 + 3 跳过）。坑：`cmd /c "npm ... & echo EXIT=%ERRORLEVEL%"` 的 %ERRORLEVEL% 会提前展开，得出假 EXIT=0——pwsh 里应写 `npm run preflight *> log; "EXIT=$LASTEXITCODE"`。

## 补记（同轮）：上架状态复核 —— 已在目录里，4.97.1 自动收录

用户登录 community.obsidian.md 后让 DSH 代为提交。查证发现**无需提交**：

- 目录条目 <https://community.obsidian.md/plugins/novel-writer-ai> 早已存在（2026-11-20 复核 **62 次下载**），账号页 `Your entries` 显示 `Novel Writer AI (you)` 即作者本人已认领；目录 `community-plugins.json`（gh api 拉全量 3,294,579 字节）仍无该 id，说明新目录已不依赖那个文件。
- 首次抓取时页面的「当前版本」还是 `4.96.1`（README 也是旧文案），约 15 分钟后复抓已变成 `4.97.1` 且平台行变成「桌面端（界面中英双语）」——新版本由目录自动索引，不需要人工点「Add a plugin」；4.97.0 从未单独出现在页面/RSS，目录只展示最新的过审版本。
- 对已认领仓库再点 Add a plugin 会报「已存在」，所以没有执行提交。

文档同步：`docs/releases/community-submission.md` 由「待提交」改为「已上架 + 自动跟随发版」，保留清单作为未来打回时的对照，并记下两个细节（只显示最新过审版本；目录短描述仍是上架时那句 157 字符，与 manifest 219 字符不同，可在账号页编辑，属可选）。

门禁：`gen:docs` 1012 源文件、`check:docs` 通过（版本 4.97.1、20 个活跃文档）、`check-release --tag 4.97.1` 通过。
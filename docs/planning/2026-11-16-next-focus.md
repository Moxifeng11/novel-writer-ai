# 下一步优化建议与遗留问题台账（2026-11-16）

> 版本：v4.96.0 · 对应 HEAD `14306a20` · 数据来源：`docs/progress/program-status.json`、`.coverage-baseline.json`、`.bundle-baseline.json`、`docs/audit/2026-11-15-adversarial-review.md`、`docs/design/2026-11-15-architecture-remediation-plan.md`（数字以真相源为准，本文只引用结论）。

## 一、现状快照

| 维度 | 现状 | 证据 |
|---|---|---|
| 代码规模 | 978 个源码文件 / 约 301K 行；最大单文件 `main.ts` 146KB | `docs/generated/code-index.md` |
| 测试 | 924 个测试文件 / 约 9700 用例全绿 | `npm run test` |
| 门禁 | 30 道门 `preflight EXIT=0` | 本轮实跑 |
| 产物 | `main.js` 5.75MB（基线棘轮）、`styles.css` 570KB、worker 793KB（内联副本另入 main.js） | `.bundle-baseline.json` |
| 覆盖率 | 总行 50.5%；`ui/` 行 21.4%、`ui/views/` 28.3% | `.coverage-baseline.json` |
| 业务专项 | 7 组（G1–G7，共 61 项）全部 done | `program-status.json` |
| 架构整改 | 12 项（C2–C5、B1–B4、A1–A4）全部交付并带测试 | `design/2026-11-15-architecture-remediation-plan.md` §十三 |
| 对抗性审查 | 25 项：22 ✅ + 1 ◑（启动顺序）+ 2 ⏳（体积、全局挂载）；其中「全局挂载」实际已在 `52350d41` 删除，审计表未回填 | 同上 |

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

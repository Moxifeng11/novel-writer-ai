# 插件全面排查报告（2026-11-28）

> 触发：用户要求「将现有插件功能完善好，通过 CLI 命令直接做实际调用测试。检查当前代码设计缺陷。并进行全面排查工作」。
>
> 方法：真实 Obsidian 实例 + `obsidian eval` 实测（不只看代码），配合定向源码复核。
> 所有结论都经过「读源码确认」这一步——扫描 agent 的行号会漂移，不能直接采信。

---

## 一、结论摘要

本轮共修复 **17 处真实缺陷**，新增 **3 个可重复执行的实测脚本**（共 20 项零成本断言）。
`prod-smoke` 6/6、`check:func` 8/8、`check:decon` 6/6、全量单测 10794 通过、`preflight` EXIT=0。

最重要的发现是一类**共同根因**，而不是零散 bug：

> **修复被写在没人调用的路径上。**

仓库里存在多条并行实现：有的在活跃链路上，有的已经死了但没人删。多次「修好了」的提交，
改的恰好是死的那一条——活路径保留原缺陷，而单测又只覆盖死路径，于是全绿。

拆解链路另有一类更隐蔽的形态：**计数型状态机在异常路径上不守恒**。三处缺陷各自都能
让 `activeCount` 失真，其中两处的后果是整个队列永久死锁（无自愈路径）。

---

## 二、运行期缺陷（CLI 实测发现，mock 测不出）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 加载期连报 **63 次** `HierarchyRequestError: Only one element on document allowed` | `ownerDocument.createDiv()` 会把元素**挂到 document.body**；popout/视图重建期间 body 被替换即抛 | 改用全局 `createDiv()` 创建游离元素 |
| 2 | AI 冒烟长期「假失败」（spawnSync ETIMEDOUT） | `obsidian eval` **不 await Promise**，传 async IIFE 永远拿不到结果 | `obsidianEvalAsync()`：eval 内只启动并写 `window[key]`，本地轮询读取 |
| 3 | 非流式 `Failed to fetch` | 渲染进程 CORS 拦原生 `fetch`，同一 `requestUrl` 却通 | 连接级失败回退 `requestUrl`（不重发 4xx/5xx，避免重复计费） |
| 4 | 410/403 不回退 | `isDisconnectionError` 只认 5xx | 补 410（ModelDeprecated）与区域类 403；回退链加 `MAX_FALLBACK_MODELS=4` 上限（原可连试 32 个） |
| 5 | 流式 `ReadableStream 不可用` | `requestUrl` 返回缓冲响应，无 `getReader()` | 桌面端改为与移动端一致：缓冲整段 SSE → 合成 one-shot reader；仅丢逐字动效（`buffered: true` 暴露降级） |

> 第 5 条我改过两遍。第一版只是把报错文案写清楚并建议「改用非流式」——那是错的，
> 等于把一个能工作的路径关掉。移动端分支早就证明「缓冲 SSE → 一次性喂解析循环」功能等价。

---

## 三、prompt 装配缺陷（功能级实测发现）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 6 | 每次生成都把 `---\nversion: "4.0.0"\ntags: [...]\n---` 塞进 system prompt | `readVaultRulesDoc` 原样返回文件内容，`composeWritingRules` 只 `trimEnd()` | 新增 `stripFrontmatter()`；实测 1385→1343 字，frontmatter 全清 |
| 7 | 协议行指令**每章无条件注入**约 350 字，无开关 | `vars["protocolLines"]` 裸赋值 | 新增 `structuredChangeLines`（默认关）+ 设置 UI + zh/en i18n |
| 8 | 关掉注入后仍会**误摘正文**（更危险） | `StepResultSaver` 无条件 `splitProtocolLines` | 按同一开关决定是否解析；关闭时正文原样 |
| 9 | `fillTemplate` **静默改写用户内容** | `replace(re, value)` 的字符串替换值会被解释：`$&`/`` $` ``/`$'`/`$$` | 改函数式替换，值原样插入 |

第 9 条很典型：用户大纲里写「成本 $& 计算」这类内容时，插入的文本会被悄悄替换成整个匹配串。

---

## 四、「写了但没接上」（共同根因的直接受害者）

| # | 缺陷 | 证据 |
|---|---|---|
| 10 | **半截正文被当完整章节落盘** | DSH-20261113-20 的修复只落在死路径 `AIEngine.generateChapterStream`；活的 `step-runner-retry.ts` 仍是 `.finishReason \|\| 'stop'` |
| 11 | 桌宠「吸附左/右/底」三个开关**全是摆设** | `pet-geometry.ts`（139 行含吸附 + visualViewport）只有一句副作用空 import；实际定位内联重写用 `window.innerWidth`，无吸附；`petSnapEdges` 只写不读 |
| 12 | **重建章节会吃掉用户手写短稿** | `rebuild-guard.ts` 同样空 import；内联判定用 `length < 100` —— 正是 guard 文件头明确要废弃的启发式，且只认 2 个占位符（guard 认 8 个） |
| 13 | 消痕弹窗的提示词编辑框**改什么都不生效** | `deaiCheckTemplate.user.replace(...)` 是丢弃返回值的死表达式；模板从未传给弹窗；实际请求走 `tasks.deai()` 自己拼的提示词 |

第 13 条最伤用户信任：提示语写着「可在下方编辑提示词后点击执行，非黑盒」。

---

## 五、拆解链路（用户最初报「直接卡死」）

### 5.1 三道既有防护（都在且接线正确）

1. `KB_BREAKDOWN_HARD_LIMIT` 输入截断（93 万字 → 10 万字）
2. `warnIfHeavyTask` 重负载预检 + 用户可见通知（成本 ≥15 明确警告）
3. `resolveLlmCallOptions` 拒绝本地 LLM 模型（改为云端）

本轮补了一个**漏判**：模型没登记在 `customProviders` 里时直接放行（当云端）。用户手填
`deepseek-r1:7b` 却忘建 provider，请求会打到默认云端端点并稳定失败（模型不存在）——
比明确拒绝更难排查。新增 `looksLikeLocalModelName()`（保守识别，宁可漏判不误伤云端）。

### 5.2 并发计数三处不守恒（本轮最严重的一组）

| 缺陷 | 触发 | 后果 |
|---|---|---|
| `activeCount++` 之后、真正的 `try {` 之前还有 4 个 `await`；任一 reject 就跳过 `finally` | `appendBreakdownLog` 首读 / `preprocessText` 抛错 | 计数永久 +1，watchdog/abortControllers 残留。**默认 maxConcurrency=2，累计两次即整队列永久死锁，无自愈路径** |
| `cancelTask('paused')` 自己 `activeCount--`，而 paused 的 worker 还挂在 `waitForResume`，abort 后它走自己的 `finally` 再减一次 | 先 pause 再 cancel（`cancelByBook` 的 `getActiveTasks()` 包含 paused） | 计数**变负** → 一次启动超过上限的任务 → 重复计费 + 主线程卡死 |
| watchdog 只看 `lastSeenAlive`，只有 `emitProgress` 写它；`vectorizeBook` 全程零 `emitProgress` | 中长书向量化 > `WATCHDOG_TIMEOUT`(120s) | 把**已跑到 100%** 的任务改成 failed 并 abort，向量库还记一次失败 |

修法与回归测试见 `tests/unit/engine/deconstruction-concurrency-invariant.test.ts`。

### 5.3 取消后仍整本向量化计费

`vectorizeBook` / `embedText(s)` 全链路不接受 signal。取消拆解后，样本收集与逐条 embed
仍跑完整本书。已在写向量前加任务状态检查（`cancelled`/`failed` 直接跳过并抛错，
由调用方如实记失败）。

`check:decon` 6/6 验证：引擎设置可读、LLM 模型非本地、向量模型允许本地、队列无卡死残留。

---

## 五之二、复核后**判定不成立**的审计项

排查过程中收到两条指控，读源码后确认不成立，记录以免后续重复劳动：

- **「取消 + 重试 = 重复计费」**：`ai-api-client.ts` 与 `ai-api-stream.ts` 的 catch
  首行都有 `if (externalSignal?.aborted) return { content:'', error:'aborted' }`，
  取消后不会进入重试分支。
- **「`abortable` 第二次取消失效」**：每次 `requestViaUrl` 都新建 `abortable` 实例并
  重新注册 `{once:true}` 监听，不存在「监听器已被移除」问题。真正的限制是
  `requestUrl` 本身不可中断——这是 Obsidian API 的硬约束，已在注释里说明。

---

## 六、五项收敛（2026-11-28 第二轮：已全部修复 → commit 1c95ddb6）

> 处理原则：先逐项重新取证（不采信扫描 agent 的行号与结论），再动手。
> 取证修正了两处审计结论：`reviewChapter`/`extractElements` 其实活着
> （review-agent.ts:161、command-registry.ts:647 调用），保留；
> `provider-detection.ts` 比预想更死——全仓零 import，直接删除。
>
> 另发现一项被死测试掩盖的事实：Rev 186「关联索引替代平铺伏笔/时间线」
> 只落在死路径 `ai-prompt-builder`，活路径模板（body-v2/v4）没有
> `${storyLinkage}` 占位符——数据流到 buildStoryContext 即断。
> 属新功能接线而非缺陷修复，待单独决策是否补。
>
> 验证：10760 测试全绿，preflight EXIT=0。运行时三探针待 Obsidian 恢复后补跑
>（桌面应用自更新 1.15.1 后未重启成功，与改动无关）。

### 6.1 死代码 ✅ 已清理

### 6.1 死代码规模

`AIEngine` 有 12 个 public 方法生产端零调用，连带 `engine/ai-prompt-builder.ts`（226 行）
整份无消费者：

```
generateChapter / generateChapterStream / generateChapterPlan / generateAnalysisReport
analyzeStyle / deaiRewrite / iterativeRefine / generateVolumeOutline
generateWorldviewModule / resetSessionTokens / sessionTokens / getMaxConcurrent
```

**为什么没删**：删公开方法可能影响外部脚本/测试，且用户未授权大规模删除。建议单独一轮处理。

### 6.2 三条正文生成路径并存 ✅ 已收敛（路径C随①删除；路径B补齐写作规则）

| 路径 | 状态 | 是否含 `writingRules` | 人味块 |
|---|---|---|---|
| 11 步流水线（`step-runner`） | **活跃** | ✅ | ✅ 按 `humanVoiceMode` |
| 逐场循环（`scene-body-generator`，开关控制） | 半可达 | ❌ **不含** | `buildCraftSystemBlock()` |
| `AIEngine.generateChapter*` | **死** | ✅ | ❌ |

路径 B 不含写作规则是实质差异——开启「逐场循环」后用户的规则不生效。需确认这是有意设计还是缺陷。

### 6.3 三套「是否本地端点」判定 ✅ 已收敛到 shared/model-source.ts

`shared/model-source.ts`（认私网段）、`services/api-connectivity-service.ts`（不认私网段）、
`shared/provider-detection.ts`（第三套表）。后果：`192.168.1.8:11434` 在一处判 local、
另一处判 cloud，同一端点结论相反。建议收敛到 `model-source.ts` 单一真相源。

### 6.4 V2 正文模板两份且字段已漂移 ✅ 已单一来源化（canonical 下沉 shared/prompts/）

`services/prompt-templates-default.ts`（PromptManager 默认值）与
`engine/prompts/body-v2-prompts.ts`（实际生效）字段集不同。用户在 PromptManager 里
「改」`body-generation-v2`，改的是另一份文本。

### 6.5 `expectedRhythm` 从未被填充 ✅ 已接线（co-writing-view → monitor-panel-b → PlotDivergenceEngine）

`shared/rhythm-intent.ts` 文件头自述「此前没有任何生产调用方提供该字段，导致节奏偏离
长期恒空」——而该字段的生产注入点至今仍为空。模块声称要修的问题本身未被接入。

---

## 七、新增的实测工具

| 命令 | 覆盖 | 成本 |
|---|---|---|
| `npm run check:prod` | 真实 AI 调用：非流式 + 流式 + 加载期零错误 | 几十 token |
| `npm run check:func` | prompt 装配 8 项：规则 frontmatter、模板、预算口径、门禁/确认设置、朱雀配置、拆解模型、调度器 | **零 token** |
| `npm run check:decon` | 拆解链路三道防护 6 项 | **零 token** |

设计原则：**只断言运行时真的能观察到的事实**。探针写不进去的项目宁可标 `skip`，
也不写假断言——假绿比没测更糟。

---

## 八、遗留待办

- 朱雀真实调用验证（额度恢复后；`runZhuquePostCheck` 目前只有 mock 覆盖）
- 第六节 6.1–6.5 的收敛/清理（需用户决策范围）

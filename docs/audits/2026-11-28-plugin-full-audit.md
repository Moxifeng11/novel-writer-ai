# 插件全面排查报告（2026-11-28）

> 触发：用户要求「将现有插件功能完善好，通过 CLI 命令直接做实际调用测试。检查当前代码设计缺陷。并进行全面排查工作」。
>
> 方法：真实 Obsidian 实例 + `obsidian eval` 实测（不只看代码），配合定向源码复核。
> 所有结论都经过「读源码确认」这一步——扫描 agent 的行号会漂移，不能直接采信。

---

## 一、结论摘要

本轮共修复 **13 处真实缺陷**，新增 **3 个可重复执行的实测脚本**（共 20 项零成本断言）。
`prod-smoke` 6/6、`check:func` 8/8、`check:decon` 6/6、全量单测 10787 通过、`preflight` EXIT=0。

最重要的发现是一类**共同根因**，而不是零散 bug：

> **修复被写在没人调用的路径上。**

仓库里存在多条并行实现：有的在活跃链路上，有的已经死了但没人删。多次「修好了」的提交，
改的恰好是死的那一条——活路径保留原缺陷，而单测又只覆盖死路径，于是全绿。

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

现状：三道防护都在且接线正确——

1. `KB_BREAKDOWN_HARD_LIMIT` 输入截断（93 万字 → 10 万字）
2. `warnIfHeavyTask` 重负载预检 + 用户可见通知（成本 ≥15 明确警告）
3. `resolveLlmCallOptions` 拒绝本地 LLM 模型（改为云端）

本轮补了一个**漏判**：模型没登记在 `customProviders` 里时直接放行（当云端）。用户手填
`deepseek-r1:7b` 却忘建 provider，请求会打到默认云端端点并稳定失败（模型不存在）——
比明确拒绝更难排查。新增 `looksLikeLocalModelName()`（保守识别，宁可漏判不误伤云端）。

`check:decon` 6/6 验证：引擎设置可读、LLM 模型非本地、向量模型允许本地、队列无卡死残留。

---

## 六、已确认但**未修**的（需用户决策）

### 6.1 死代码规模

`AIEngine` 有 12 个 public 方法生产端零调用，连带 `engine/ai-prompt-builder.ts`（226 行）
整份无消费者：

```
generateChapter / generateChapterStream / generateChapterPlan / generateAnalysisReport
analyzeStyle / deaiRewrite / iterativeRefine / generateVolumeOutline
generateWorldviewModule / resetSessionTokens / sessionTokens / getMaxConcurrent
```

**为什么没删**：删公开方法可能影响外部脚本/测试，且用户未授权大规模删除。建议单独一轮处理。

### 6.2 三条正文生成路径并存

| 路径 | 状态 | 是否含 `writingRules` | 人味块 |
|---|---|---|---|
| 11 步流水线（`step-runner`） | **活跃** | ✅ | ✅ 按 `humanVoiceMode` |
| 逐场循环（`scene-body-generator`，开关控制） | 半可达 | ❌ **不含** | `buildCraftSystemBlock()` |
| `AIEngine.generateChapter*` | **死** | ✅ | ❌ |

路径 B 不含写作规则是实质差异——开启「逐场循环」后用户的规则不生效。需确认这是有意设计还是缺陷。

### 6.3 三套「是否本地端点」判定

`shared/model-source.ts`（认私网段）、`services/api-connectivity-service.ts`（不认私网段）、
`shared/provider-detection.ts`（第三套表）。后果：`192.168.1.8:11434` 在一处判 local、
另一处判 cloud，同一端点结论相反。建议收敛到 `model-source.ts` 单一真相源。

### 6.4 V2 正文模板两份且字段已漂移

`services/prompt-templates-default.ts`（PromptManager 默认值）与
`engine/prompts/body-v2-prompts.ts`（实际生效）字段集不同。用户在 PromptManager 里
「改」`body-generation-v2`，改的是另一份文本。

### 6.5 `expectedRhythm` 从未被填充

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

# 知识库拆解卡顿 + 本地模型缺陷：根因与修复方案（2026-11-25）

> 状态：**已定位根因，待实现** · 2026-11-25 · ZCode
> 用户报告：「当前的知识库拆解会直接导致 obsidian 直接卡住，向量模型使用的是本地 ollama，
> llm 增强功能，需要直接使用云端模型。不能使用本地模型。这样会导致错误。」

## 一、根因链条（完全确认）

### 缺陷 1：增强一开，全部退回主线程

`engine/deconstruction-worker-manager.ts:294`：

```ts
isWorkerAvailable(): boolean {
    // LLM 增强会强制主线程；向量任务在 executeTask 内部按 taskType 单独绕过 Worker。
    return !this.llmEnhancer && this.useWorkerMode && this.workerManager?.isWorkerAvailable() === true;
}
```

`engine/deconstruction-worker-manager.ts:569-574`：

```ts
// Worker 是独立 bundle：vectorEnhancer / LLMEnhancer 无法随主线程实例进入。
// - 向量任务（*:vector）需要主线程的 VectorEnhancer
// - 启用 LLM 增强时所有任务都需要主线程
const needsEnhancement = Boolean(this.llmEnhancer)
    || (taskType.endsWith(':vector') && Boolean(this.vectorEnhancer));
```

**结果**：

| 配置 | 走 Worker | 走主线程 |
| --- | --- | --- |
| 向量关 + LLM 关 | 全部 8 维 | 无 |
| **向量开 + LLM 关**（默认） | 非 vector 任务 | **所有 `*:vector` 任务** |
| 向量开 + **LLM 开** | **无** | **全部 16 个任务** |

**默认配置是 `vectorEnabled: true`**（`shared/deconstruction-settings.ts:54`），
所以**开箱即处于「一半任务在主线程」的状态**。

### 缺陷 2：LLM 增强默认用本地模型

`shared/deconstruction-settings.ts:57`：

```ts
llmEnabled: false,
llmModel: 'deepseek-r1:7b',   // ← 本地 Ollama 模型
```

`engine/deconstruction-scheduler.ts:1589`：

```ts
private resolveLlmCallOptions(model: string): LLMCallOptions | undefined {
    const providers = settings.customProviders || [];
    const local = providers.find(p =>
        Array.isArray(p.models)
        && p.models.includes(model)
        && resolveProviderSourceType({ id: p.id, endpoint: p.endpoint, sourceType: p.sourceType }) === 'local',
    );
    if (!local) return undefined;
    return {
        endpoint: local.endpoint,           // → http://localhost:11434/...
        apiKey: settings.providerKeys?.[local.id] || 'ollama',
        disableFallback: true,              // → 本地失败不降级到云端
    };
}
```

**这段代码的语义是**：如果模型名出现在本地 provider 里，就**强制**用本地端点，
并且 `disableFallback: true` —— 本地失败也**不降级到云端**。

**用户说的「这样会导致错误」**：本地 7B 模型做结构化 JSON 输出（拆解增强要求严格 JSON）
成功率低，且会长时间占用主线程（ollama 单请求串行）。

### 缺陷 3：放大因素

`shared/deconstruction-settings.ts`：

```ts
textSampleLimit: 100000,      // 单维处理 10 万字
maxConcurrency: 2,
dimensionConcurrency: 3,      // 8 维 × 3 = 24 个并行任务
vectorBatchSize: 32,          // 每批 32 块 embed
```

配合「全部走主线程」，形成：**24 个任务 × 10 万字文本 × 正则扫描 + HTTP 等待，全在主线程**。

## 二、为什么之前没被修掉

| 环节 | 现状 |
| --- | --- |
| 降级通知 | `notifyWorkerUnavailable` 只在上面的 `initWorkerManager` 里调；`needsEnhancement` 绕过 Worker 时**只 log.info 一次**（`enhancementBypassLogged`），不提示用户 |
| 默认值 | `vectorEnabled: true` + 8 维全开，用户感知不到「已经降级」 |
| `llmModel` 默认 | `'deepseek-r1:7b'` 硬编码在默认配置里，即便用户从没配过 Ollama 也会指向它 |

## 三、修复方案（三件事，按依赖排序）

### 修复 1：LLM 增强只用云端模型（核心）

**要求**：LLM 增强不能用本地模型。理由（用户原话）：「这样会导致错误」。

**设计**：

1. **`llm-enhancer.ts` 增加来源校验**：`resolveLlmCallOptions` 反向逻辑 ——
   只允许云端 provider，本地模型直接拒绝并返回明确错误
2. **`deconstruction-settings.ts` 默认值改为空**（强制用户显式选云端模型）：
   ```ts
   llmModel: '',   // 空 = 未选择；不预设本地模型
   ```
3. **设置面板加校验**：选了本地模型时禁用保存 + 提示「LLM 增强需云端模型」
4. **运行时兜底**：若模型解析为 local，`enhanceWithLLM` 直接返回
   `{ success: false, error: 'LLM 增强不支持本地模型' }`，不发起请求

**关键点：区分 `vectorModel` 和 `llmModel`**
- `vectorModel: 'bge-m3'`（本地）—— **这是正确的**，向量必须本地（走 ollama 的 embed 接口，异步 HTTP，不阻塞）
- `llmModel` —— **必须云端**

### 修复 2：`*:vector` 任务放进 Worker（解决卡顿主因）

**当前问题**：向量任务因「需要主线程的 VectorEnhancer」被排除在 Worker 外。

**但这是可以解决的**：`VectorEnhancer` 本质是 HTTP 客户端（`fetch` 到 ollama/openai embed 接口），
**Worker 里也能 fetch**。需要做的：

1. Worker 侧实例化 `VectorEnhancer`（`deconstruction-worker.ts` 已 import 它）
2. 主线程把「向量配置」（endpoint/model/apiKey）随任务载荷下发
3. Worker 内用它做 embed，结果回传

**收益**：向量任务（默认开启、占大头）全部回 Worker，主线程释放。

**如果短期做不到**（改 Worker bundle 有风险），退而求其次：
**把 `vectorEnabled` 默认改为 `false`**，并在设置里说明「开启后会降级到主线程，可能卡顿」。

### 修复 3：卡顿时给用户可见提示

**当前**：`needsEnhancement` 绕过 Worker 时只 `log.info`，用户不知道。

**改法**：
- 复用 `notifyWorkerUnavailable` 机制（`shared/degradation-notifier.ts`）
- 明确文案：「向量/LLM 增强已启用，拆解将在主线程执行，大文件可能卡顿」
- 在拆解开始前提示，而不是静默降级

## 四、实现顺序

```
修复 1（LLM 只用云端）       ← 独立，最安全，先做
    ↓
修复 3（用户可见提示）       ← 独立，让问题可见
    ↓
修复 2（向量进 Worker）      ← 改动大，需验证 Worker bundle
```

## 五、验收标准

| 修复 | 验收 |
| --- | --- |
| 1 | 选本地模型 → 保存被拒 / 增强返回明确错误，**不发起请求** |
| 1 | 选云端模型（opencode/deepseek）→ 增强正常工作 |
| 2 | 向量开 + LLM 关 → 拆解在主线程外执行（`isWorkerAvailable()` 返回 true） |
| 3 | 任何降级路径都有 `Notice` 提示，不只 log |
| 全部 | `preflight` EXIT=0 |

## 六、必须先确认的（避免又出幻觉）

| 待确认 | 为什么重要 |
| --- | --- |
| Worker bundle 能否 fetch 到 ollama？ | 决定修复 2 是否可行 |
| `vectorProviderType` 默认值 | 确认向量确实走本地 ollama |
| 用户当前 data.json 里 `llmModel` 是什么 | 确定是默认值还是用户手动设的 |
| `provider-detection` 怎么判 local/cloud | 决定「云端白名单」怎么写 |

**本文承诺**：以上四项 grep 到证据后才动手改代码。

# M7 结论：跨请求「只补差异」在当前架构下不适用（2026-11-15）

## 一、审计结论

协同写作的每次建议请求最终调用：

```
callCoWriteText(prompt) → callCoWriteAI(prompt)   // engine/co-writer-engine.ts
```

其中 `prompt = { system, user }`，**每次都是全新的 system + user**，不携带历史消息
（`co-writer-engine.ts` 的 `callCoWriteAI` / `callCoWriteAIStream` 均只接收单个 prompt）。

模型是无状态的：如果第二次请求「只补差异、不重发已在上下文的切片」，
模型实际上**看不到**那些切片 → 会丢上下文、风格漂移、OOC 风险上升。

**因此「跨请求只补差异」在无对话历史的单次调用架构下不成立**，
`plugin.cowriteDelta` 的用途应收窄为「未来多轮/chat 式协同」预留。

## 二、真实可行的「只补差异」

真正重复注入发生在**同一个 prompt 内部**：故事上下文包（storyContext）已包含
人物/势力/地点/物品/设定/时间线/伏笔，旧的缓存上下文块又注入一遍。

该去重**已经存在**（`engine/prompt-builder.ts:175` `getCachedContextParts`）：

```ts
// 故事上下文总线已提供实体/设定/时间线时，旧的核心信息块不再重复注入
const skipCoreInfo = opts?.skipCoreInfo === true;
...
!skipCoreInfo && allChars ? '【人物总览】' : '',
!skipCoreInfo && allChars ? allChars.slice(0, 3000) : '',
```

`buildSuggestionPrompt` 传入 `skipCoreInfo: hasStoryContext`；
`foreshadow` 段在 `hasStoryContext` 时也不注入；`drivers` 降级为「仅关系」。

## 三、M7 的交付定义（已调整）

| 原定义 | 实际交付 |
|---|---|
| 同场景重复请求不重发切片 | ❌ 架构不支持（无对话历史），已记录理由 |
| — | ✅ prompt 内去重（既有实现，`skipCoreInfo` / `hasStoryContext` 分支） |
| — | ✅ `cowriteDelta` + `CowriteSnapshotService` 保留，供未来多轮场景使用 |
| — | ✅ `context-metrics-model` 可量化注入量变化 |

## 四、如果将来要做「真正的跨请求省 token」

前提：协同写作改成**多轮对话**（把上次注入作为 assistant/user 历史保留），
或引入模型侧 prompt caching（Olama/云端均支持 prefix cache）。

到时接线步骤见 `2026-11-15-m7-wiring-guide.md`：
- 装配前 `setSession(项目+章号)`
- `plugin.cowriteDelta(sessionKey, sceneKey, keys)` → `inject=false` 时跳过重发
- 只渲染 `delta.added`

## 五、结论

M7 不再是「未完成接线」，而是**在当前架构下已达成等价目标（prompt 内去重）**；
跨请求优化需要先改造协同写作的会话模型，属于新需求而非本次遗漏。

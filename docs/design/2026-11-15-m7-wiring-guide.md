# M7 协同引擎接线指南（下一会话执行）

> 前置：差异模型 `shared/cowrite-delta-model.ts`、快照服务 `services/cowrite-snapshot-service.ts`、
> 插件入口 `plugin.cowriteDelta(sessionKey, sceneKey, keys)` 均已完成并实机验证。
> 本文件只写「最后一步怎么接」，避免下次重新摸索。

## 一、目标

协同写作每次请求装配上下文时：
- 同一场景重复请求 → **不再重发已注入切片**
- 场景内新增条目 → 只注入新增部分
- 切换场景/章节 → 重新装配

## 二、已知现状（审计结论）

| 事实 | 位置 |
|---|---|
| 每请求重跑 RAG 与指纹检索 | `engine/co-writer-engine.ts:1081`、`:919` |
| 切场景才重建信息包 | `engine/co-writer-engine.ts:2350-2398` |
| 分段优先级与预算表 | `engine/prompt-builder.ts:920-1003` |
| 缓存上下文段（有 brief/pack 时跳过整段注入） | `prompt-builder.ts:917-995` |
| 每段 token 上限 | `snapshot-builder.ts:68-125`、`prompt-builder.ts:175-250` |

## 三、接线步骤（建议顺序）

### 1. 确定 key 命名（统一）

```
entity:CHR-0001       关系 REL-0001
foreshadow:FSH-0001   时间线 EVT-0001
setting:SET-0001      worldview:WLD-0001
assertion:AST-0001    scene:SCENE-1
chapter:CHP-0001      rag:bookId#chunkIndex
```

### 2. 在装配点计算 key 集合

在 `co-writer-engine.ts` 组装 `storyContextPack` / cached context parts 的位置，
把本次**将要注入**的条目换算成 key 数组（与 1 的命名一致）。

### 3. 调用插件入口

```ts
const { delta, inject } = this.plugin.cowriteDelta(
  `${project}/${chapterKey}`,   // sessionKey：切章即清空快照
  sceneKey,                     // 当前场景键
  keys,
);
if (!inject) {
  // 同场景无变化：跳过「已注入切片」的拼装，仅保留 brief/指令等易变段
}
```

### 4. 只渲染差异

```ts
import { renderDeltaSection } from '@/shared/cowrite-delta-model';
const deltaText = renderDeltaSection(delta, key => renderItemByKey(key));
```

`renderDeltaSection` 已实现：
- 场景切换提示
- 新增条目列表
- 「已在上下文中，不重复发送 N 条」
- 已移除条目

### 5. 注意

- **不要**在 `inject=false` 时跳过「用户当前选中文本 / 指令 / 语气设置」等易变段
- 快照是内存态，插件重载即失效（可接受）
- 句子级高频调用是收益最大处；章节级调用收益小，可先只接句子级

## 四、验收

1. 单测：`cowriteDelta` 三态（首次/重复/新增）已覆盖（`tests/unit/services/cowrite-snapshot-service.test.ts`）
2. 实机：同场景连续两次建议请求，第二次注入字符数应显著下降（用 `injection-ledger` 或日志比对）
3. `preflight EXIT=0`

## 五、风险

- `co-writer-engine.ts` 与 `prompt-builder.ts` 体量大、句子级高频路径，改动必须小步提交
- 若难以定位装配点，可先在 `prompt-builder.ts` 的 `getCachedContextParts` 返回前做 delta 过滤，
  保留原函数签名，避免扩散改动

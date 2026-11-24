# 云笔 → 本仓 优化模板集

> 用途：把云笔调研结论落成**可直接照抄的代码模板**
> 依据：`docs/audits/2026-11-25-yunbi-full-survey.md`（三轮调研）
> 使用方式：每个模板都标注了「本仓现状 / 模板 / 验收」，复制改路径即可

---

## 模板索引

| # | 模板 | 价值 | 成本 | 本仓状态 |
| --- | --- | --- | --- | --- |
| T1 | **按任务分工的温度档位** | 高 | 低 | ❌ 缺（0.7/1.4/1.25 三个值并存） |
| T2 | 上下文模块化 + token 计量 | 中 | 高 | ❌ 缺 |
| T3 | 协议行输出 CR/CI/NE/BT | 中 | 高 | ❌ 缺 |
| T4 | `⟨✍⟩` 摘要内嵌批注 | 中 | 中 | ❌ 缺 |
| T5 | 生成结果四态 UI | 高 | 中 | ✅ 引擎已就绪（`requireConfirm`），缺 UI |
| T6 | 快捷预设（3 个） | 中 | 低 | ❌ 缺 |
| T7 | 注意力 Sandwich 结构 | 低-中 | 低 | 部分（有 SELF_CHECK） |
| T8 | Skill SOP 三段式门禁 | 中 | 高 | ❌ 缺（步骤链自动跑） |

**已落地（不在此重复）**：L0-L3 仲裁（`engine/prompts/priority-system.ts`）、
后章约束（`nextChapterHook`）、抽屉宽度六档（`--nw-drawer-*`）、
生成待确认引擎（`BodyWriteRequest.requireConfirm`）。

---

## T1 · 按任务分工的温度档位 ⭐ 最推荐先做

### 云笔做法

| 温度 | 用途 | max_tokens |
| ---: | --- | ---: |
| 0.3 | 质量自检 / 结构化 JSON 输出 | 4096 |
| 0.6 | 指令优化 / 轻改写 | 1024 |
| 0.8 | 内容生成 / 创意写作 | 8192 |
| — | 蒸馏 / 摘要 | 4096 |

### 本仓现状（已核实，比"单一 0.7"更混乱）

| 位置 | 温度 | 性质 |
| --- | ---: | --- |
| `engine/ai-engine.ts` ×3、`ai-api-stream.ts` ×2、`ai-api-client.ts` ×1 | **0.7** | API 层函数默认值 |
| `engine/step-runner.ts:1214` | **1.4**（UI slider 默认） | 流水线实际用的值 |
| `settings.coWriteTemperature` | **1.25**（用户配置） | 协同写作 |
| `ui` 其他 | 0.75 / 0.4 / 0.2 | 零散调用点 |

**三个值并存**：API 层兜底 0.7、步骤链 1.4、协同 1.25。

而且 **1.4 已经超出常见建议上限**（多数模型建议 ≤1.0，部分允许到 1.5-2.0）。
质量自检（要稳定 JSON）和正文生成（要创意）都跑在这个值上。

### 模板

`shared/ai-task-profile.ts`（新建）：

```ts
/**
 * ai-task-profile.ts — 按任务性质配置 AI 采样参数
 *
 * 为什么要分档（依据云笔实测配置）：
 * - 结构化输出（JSON）高温度会字段漂移、格式错乱 → 需要 0.3
 * - 创意写作低温度会保守重复、句子均匀 → 需要 0.8
 * - 本仓此前统一 0.7，两端都不最优
 *
 * 温度取值来源：云笔生产环境实测（0.3 自检 / 0.6 改写 / 0.8 生成）。
 */

/** 任务类型 */
export type AiTaskKind =
    /** 正文生成：创意优先 */
    | 'body-generation'
    /** 蒸馏/摘要：忠实原文优先 */
    | 'distillation'
    /** 质量自检：结构化 JSON 优先 */
    | 'quality-check'
    /** 分析报告：结构化 + 适度归纳 */
    | 'analysis'
    /** 指令改写/润色：保持原意 */
    | 'rewrite'
    /** 结构化抽取（实体/伏笔等）：严格 JSON */
    | 'extraction';

/** 采样配置 */
export interface AiSamplingProfile {
    temperature: number;
    maxTokens: number;
    /** 说明，用于设置页/账本展示 */
    note: string;
}

export const AI_TASK_PROFILES: Record<AiTaskKind, AiSamplingProfile> = {
    'body-generation': { temperature: 0.8, maxTokens: 8192, note: '创意优先：高温度避免句子均匀' },
    'distillation': { temperature: 0.3, maxTokens: 4096, note: '忠实原文：低温度减少编造' },
    'quality-check': { temperature: 0.3, maxTokens: 4096, note: '结构化 JSON：低温度防格式漂移' },
    'analysis': { temperature: 0.4, maxTokens: 4096, note: '结构化+归纳' },
    'rewrite': { temperature: 0.6, maxTokens: 1024, note: '保持原意基础上改清晰' },
    'extraction': { temperature: 0.2, maxTokens: 4096, note: '严格抽取：最低温度' },
};

/**
 * 取某任务的采样配置，允许调用方覆写。
 *
 * @param kind - 任务类型
 * @param overrides - 覆写项（如用户在设置里自定义了温度）
 * @returns 采样配置
 * @example
 * const { temperature, maxTokens } = resolveSampling('body-generation');
 */
export function resolveSampling(
    kind: AiTaskKind,
    overrides: Partial<AiSamplingProfile> = {},
): AiSamplingProfile {
    const base = AI_TASK_PROFILES[kind];
    return {
        temperature: overrides.temperature ?? base.temperature,
        maxTokens: overrides.maxTokens ?? base.maxTokens,
        note: overrides.note ?? base.note,
    };
}
```

### 接入方式

改调用点：把 `temperature: 0.7` 换成 `temperature: resolveSampling('body-generation').temperature`。

**不要一次全改**。建议顺序：
1. 先改 `quality-check` 相关（0.7 → 0.3），这是最明显该改的
2. 再改 `extraction`（0.7 → 0.2）
3. 最后改 `body-generation`（0.7 → 0.8，这个有风险，要实测）

### 验收

- 单测：6 种任务各自的档位正确
- 单测：`overrides` 能覆写
- 实测：质量自检的 JSON 解析成功率上升（改前 vs 改后各跑 10 次）

---

## T2 · 上下文模块化 + token 计量

### 云笔做法

32 个模块，每个标注 `预估tokens`，按场景组合：
- 普通模式：30 个 / 23250 tokens
- 专注模式：7 个 / 3750 tokens（强制保衔接三件套）

### 本仓现状

变量平铺注入（`template-vars-builder.ts` 一次性填 40+ 变量），
无模块概念、无按需裁剪、无 token 计量。

### 模板

**第一阶段只做「清单 + 计量」，不做开关**（成本低、无风险）：

`shared/context-module-registry.ts`（新建）：

```ts
/**
 * context-module-registry.ts — 上下文模块登记表（只计量，不控制注入）
 *
 * 第一阶段目的：让「一次生成到底喂了多少 token」可见。
 * 第二阶段才考虑做开关（先有数据，再决定裁什么）。
 *
 * 云笔的对应设计：32 个模块每个标预估 tokens，模式切换时按清单裁剪。
 */

/** 模块登记项 */
export interface ContextModuleMeta {
    /** 变量名（对应 vars 的 key） */
    id: string;
    /** 中文名（UI/日志展示） */
    name: string;
    /** 分类 */
    category: 'core' | 'rule' | 'entity' | 'aux';
    /** 是否必需（不可裁剪） */
    required: boolean;
    /** 预估 tokens（内容长度 / 2.5，中文近似） */
    estimatedTokens: number;
}

/**
 * 从实际变量值估算 token 数（中文约 2.5 字/token）。
 *
 * @param text - 变量内容
 * @returns 预估 token 数
 * @example
 * estimateTokens('世界观设定……') // 40
 */
export function estimateTokens(text: string): number {
    return Math.ceil((text || '').length / 2.5);
}

/**
 * 汇总本次注入的模块与总 token。
 *
 * @param vars - 模板变量表
 * @returns 各模块计量 + 总计
 * @example
 * const report = auditContextBudget(vars);
 * log.info(`上下文 ${report.total} tokens（${report.modules.length} 个模块）`);
 */
export function auditContextBudget(vars: Record<string, string>): {
    modules: Array<{ id: string; tokens: number }>;
    total: number;
} {
    const modules = Object.entries(vars)
        .filter(([, v]) => typeof v === 'string' && v.length > 0)
        .map(([id, v]) => ({ id, tokens: estimateTokens(v) }))
        .sort((a, b) => b.tokens - a.tokens);
    return { modules, total: modules.reduce((n, m) => n + m.tokens, 0) };
}
```

### 接入方式

在 `template-vars-builder.ts` 末尾加一行：

```ts
const budget = auditContextBudget(vars);
log.info(`[ContextBudget] ${deps.chapterName}: ${budget.total} tokens，前 5 大模块：`
    + budget.modules.slice(0, 5).map(m => `${m.id}(${m.tokens})`).join(', '));
```

### 验收

- 日志能看到每次生成的 token 总量与 Top5 模块
- 跑 3 章后，能列出「哪些模块占了大头」（这是下一步裁剪的依据）

---

## T3 · 协议行输出 CR/CI/NE/BT

### 云笔做法

正文末尾让模型追加结构化行：

```
CR|角色A|角色B|关系变化|本章事件
CI|物品名|获得/消耗/失去/损坏|数量
NE|新实体名|类型（违规时会标出）
BT|角色|旧境界|新境界|突破契机
```

后端解析后更新关系表/物品表/境界轨迹。

### 本仓现状

靠 distill 二次 LLM 调用从正文里抽——多一次调用、且模型不知道「自己刚改了什么」。

### 模板

`engine/prompts/protocol-lines.ts`（新建）：

```ts
/**
 * protocol-lines.ts — 正文末尾的结构化协议行
 *
 * 为什么要协议行（依据云笔设计）：
 * 本仓现在靠 distill 再抽一次关系/物品变化——多一次 LLM 调用，
 * 且模型在抽取时已经「忘了」自己写了什么细节。
 * 让模型写完正文就顺手输出这几行，准确率更高、省一次调用。
 *
 * 注意：只在正文生成末尾追加，蒸馏仍然要跑（补全摘要/伏笔等文本型信息）。
 */

export const PROTOCOL_LINES_INSTRUCTION = `---

## 正文写完后，追加结构化变更行（不写 = 本章无此类变更）

格式（每行一个，字段用半角竖线 | 分隔；字段值内不能含竖线）：

CR|关系方A|关系方B|本章关系变化（如"师徒反目"/"信任加深"）|触发事件（≤20字）
CI|物品名|变动类型（获得/消耗/失去/损坏/赠与/转移）|数量
BT|角色名|原境界|新境界|突破契机（≤20字）
NE|名称|类型（角色/物品/地点/势力/功法）|为何必须出现

规则：
1. 只写**本章正文中确实发生**的变更，不要写计划或预期
2. 没有变更就不写该行（宁可少写，不要编造）
3. NE 行只在本章引入新实体时写——同时说明"为什么非新实体不可"
4. 这几行是给程序解析的，不要写解释、不要加标题`;

/** 一条协议行 */
export interface ProtocolLine {
    kind: 'CR' | 'CI' | 'BT' | 'NE';
    fields: string[];
}

/**
 * 从模型输出中解析协议行，并返回「正文」与「协议行」两段。
 *
 * @param raw - 模型完整输出
 * @returns 分离后的正文与协议行
 * @example
 * const { body, lines } = splitProtocolLines(modelOutput);
 * // body 写入正文，lines 交给结算层更新数据
 */
export function splitProtocolLines(raw: string): { body: string; lines: ProtocolLine[] } {
    const lines: ProtocolLine[] = [];
    const kept: string[] = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        const m = /^(CR|CI|BT|NE)\|(.+)$/.exec(t);
        if (m) {
            lines.push({ kind: m[1] as ProtocolLine['kind'], fields: m[2].split('|').map(s => s.trim()) });
        } else {
            kept.push(line);
        }
    }
    return { body: kept.join('\n').trimEnd(), lines };
}
```

### 接入方式

1. 正文提示词末尾追加 `PROTOCOL_LINES_INSTRUCTION`
2. `body-writer` 写盘前调 `splitProtocolLines(raw)`，只把 `body` 写进正文
3. `lines` 传给结算层（`settlement`）更新关系/物品/境界

### 验收

- 单测：能正确分离 4 种协议行
- 单测：字段值含中文/空格时不误判
- 实测：3 章后对比「协议行里的关系变化」与「distill 抽出的关系变化」，看一致性

---

## T4 · `⟨✍⟩` 摘要内嵌批注

### 云笔做法

摘要里可以嵌导演批注：

```
**【角色】林玄**没有告诉任何人梦中的内容。
⟨✍ 此处不展开战斗细节，只用两句写结果——重点是战后他发现的那个不该出现的东西 ⟩
```

- 每章 3-5 处
- 故事层（摘要）和技法层（批注）分离
- 批注是给「写正文的 AI」看的微操指令

### 本仓现状

`infoPlan` / `outline` 只有故事内容，没有「怎么写」的位置。

### 模板

`shared/annotation-marker.ts`（新建）：

```ts
/**
 * annotation-marker.ts — 摘要内嵌写作批注
 *
 * 设计（依据云笔 ⟨✍⟩ 机制）：
 * 摘要告诉正文「发生什么」，批注告诉正文「怎么处理这一段」。
 * 两者混在一起写会让摘要变臃肿；分开又会让正文失去指令。
 * 用标记分隔，解析时剥离。
 */

/** 批注正则：⟨✍ ... ⟩ */
const ANNOTATION_RE = /⟨✍\s*([\s\S]*?)\s*⟩/g;

/**
 * 从摘要文本中提取批注，并返回剥离批注后的纯摘要。
 *
 * @param summary - 含批注的摘要
 * @returns 纯摘要 + 批注列表
 * @example
 * const { text, notes } = extractAnnotations('他推门。⟨✍ 门后应有声音 ⟩');
 * // text = '他推门。', notes = ['门后应有声音']
 */
export function extractAnnotations(summary: string): { text: string; notes: string[] } {
    const notes: string[] = [];
    const text = summary.replace(ANNOTATION_RE, (_, note: string) => {
        const t = note.trim();
        if (t) notes.push(t);
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { text, notes };
}

/**
 * 把批注渲染成给正文模型的「写作要点」块。
 *
 * @param notes - 批注列表
 * @returns 提示词片段（无批注时返回空串）
 * @example
 * renderAnnotationBlock(['门后应有声音']) // '【本章写作批注】\n1. 门后应有声音\n'
 */
export function renderAnnotationBlock(notes: string[]): string {
    if (notes.length === 0) return '';
    return ['【本章写作批注（来自大纲，按位置执行）】',
        ...notes.map((n, i) => `${i + 1}. ${n}`)].join('\n') + '\n';
}
```

### 验收

- 单测：能提取多条批注、剥离干净
- 单测：无批注时返回空串，不产生多余空行
- 实测：大纲里手写 3 条批注，看正文是否按批注执行

---

## T5 · 生成结果四态 UI

> **引擎已就绪**：`BodyWriteRequest.requireConfirm` + `pendingPath` +
> `adoptPending`/`discardPending`（commit `d8210792`）

### 还缺的：UI 入口

需要接的生成入口（按价值排序）：

| 入口 | 文件 | 说明 |
| --- | --- | --- |
| 续写弹窗 | `ui/continue-chapters-modal.ts:413` | 用户主动触发，最适合 |
| 流水线保存 | `engine/step-result-saver.ts:321/466` | 自动化，默认关 |
| Agent 工作台 | `ui/services/agent-port.ts:583` | 交互式 |

### 模板（以续写弹窗为例）

```ts
// 1) 生成时开启待确认
const result = await writer.write({
    ...req,
    requireConfirm: true,   // ← 新增这一行
});

// 2) 有 pendingPath 时展示确认 UI
if (result.pendingPath) {
    const preview = await fs.read(result.pendingPath);
    const choice = await new GenerateConfirmModal(this.app, {
        title: `第${chapterNum}章 生成完成`,
        preview,
        stats: { words: result.wordCount },
    }).openAndWait();

    // 3a) 采用
    if (choice === 'adopt') {
        await writer.adoptPending(result.pendingPath, { writingMode: req.writingMode });
        new Notice('已采用');
    }
    // 3b) 弃用
    else {
        await writer.discardPending(result.pendingPath);
        new Notice('已弃用，正文未改动');
    }
}
```

`ui/components/generate-confirm-modal.ts`（新建）：

```ts
/**
 * generate-confirm-modal.ts — 生成结果确认弹窗
 *
 * 三个动作：采用 / 弃用 / 打开待确认文件手动编辑后再决定。
 */
export class GenerateConfirmModal extends Modal {
    // ... 展示 preview 前 800 字 + 字数 + 三个按钮
    // 返回 'adopt' | 'discard' | 'edit'
}
```

### 验收

- 单测：采用后正文更新、待确认文件清理
- 单测：弃用后正文不变
- 实测：续写一章，确认三个按钮都работает

---

## T6 · 快捷预设（3 个）

### 云笔做法

| 预设 | 模块组合 | 用途 |
| --- | --- | --- |
| 极简续写 | core_identity + content_filter + perspective | 最大化专注 |
| 角色聚焦 | + characters + story_core | 对话密集章 |
| 世界观聚焦 | + worldview + power_system + scene_geo + characters | 设定密集章 |

### 本仓现状

无预设概念，用户只能用完整上下文。

### 模板

在 T2 的模块登记表基础上，加预设：

```ts
/** 预设：只列「额外开关」的模块 id */
export const CONTEXT_PRESETS = {
    minimal: { name: '极简续写', modules: ['worldView'], note: '只带世界观，最大化专注' },
    characterFocus: { name: '角色聚焦', modules: ['worldView', 'allChars', 'storyContextPack'], note: '对话密集章' },
    worldFocus: { name: '世界观聚焦', modules: ['worldView', 'settingLib', 'powerSystem', 'sceneCardDigest', 'allChars'], note: '设定密集章' },
} as const;
```

### 验收

- 单测：三个预设的模块清单正确
- 实测：同一素材用 minimal vs full 各跑一次，对比 token 数与质量

---

## T7 · 注意力 Sandwich

### 云笔做法

同一份核对清单在 prompt **顶部和底部各放一次**（利用 LLM 首尾注意力偏置）。

### 本仓现状

有 `SELF_CHECK_PROMPTS` 但只在一处。

### 模板

已有 L0-L3 仲裁在顶部（`priority-system.ts`），
把「动笔前提醒」放最末即可形成 Sandwich：

```ts
// 在正文 user 模板最末追加
export const PRE_WRITE_REMINDER = `
---
【动笔前最后核对（只看这三条）】
1. 本章第一句是否从中断处接着写，而不是重新开场？
2. 本章有没有提前写出下一章的内容？
3. 结尾是否落在具体动作/对话/悬念上，而不是抽象感慨？
`;
```

### 验收

- 单测：提示词末尾含该块
- 实测：对比加/不加的「章首承接合规率」

---

## T8 · Skill SOP 三段式门禁

### 云笔做法

```
B1 草案：输出设计（不写库）
B2 确认：agent_ask_user 真暂停
B3 写库+验证：用户确认后落库，回查存在才推进
```

配套纪律：
- 一轮只处理一步
- 禁止「落库待补」
- 修改必须输出实质不同新版本

### 本仓现状

步骤链是自动跑的，没有「真暂停」机制。

### 成本说明

这是**最大改动**：需要 step-runner 支持中断-恢复、需要 UI 的确认交互、
需要状态持久化。不建议短期做。

**可先做的子集**：只给「建项目」流程加确认（那是低频、高价值、错了代价大的场景）。

---

## 落地优先级建议

```
第一批（低风险，先做）
  T1 温度分档      ← 改一个函数 + 若干调用点，收益明确
  T2 模块计量      ← 只加日志，零风险
  T7 动笔前提醒    ← 加一段提示词

第二批（中风险，需实测）
  T4 ⟨✍⟩批注       ← 要先改大纲格式
  T6 快捷预设      ← 依赖 T2
  T5 待确认 UI     ← 引擎已就绪，缺 UI

第三批（高成本，需评估）
  T3 协议行        ← 要改结算链路
  T8 SOP 门禁      ← 要改 step-runner 架构
```

## 验收总则

每个模板落地后必须：
1. 有单测（覆盖正常路径 + 边界）
2. `preflight EXIT=0`
3. 有条件的话做 A/B 实测（不能只靠「逻辑正确」就宣称有效）

**上一轮的教训**：L0-L3 仲裁和后章约束目前只有单测和门禁验证，
没有文本质量实测——这类改动应该标注「待验证」而不是「已完成」。

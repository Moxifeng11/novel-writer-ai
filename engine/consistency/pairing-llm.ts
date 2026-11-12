/**
 * pairing-llm.ts — 两级判定中的第二级：LLM 复核「疑似」配对
 *
 * 只有规则层判不了、又值得看的配对（命名混淆嫌疑、废弃情节）才会走到这里，
 * 因此**调用次数受严格上限约束**——这是本项目「省 token」的硬要求。
 *
 * 证据链不依赖模型输出：`evidenceA/evidenceB` 的引文直接取自两条断言（真实原文），
 * 模型只负责回答「这两条是不是矛盾、为什么」。这样即使模型输出跑偏，
 * 也不会产出**伪造引文**——这是论文 §2.3 Stage 3 的底线。
 */

import {
    ASSERTION_KIND_META,
    makeContradictionId,
    type ConsistencyContradiction,
    type AssertionKind,
} from './assertion-model';
import type { SuspectedPair } from './pairing-rules';

/** 一次模型调用的请求 */
export interface LlmJudgeRequest {
    systemPrompt: string;
    userPrompt: string;
}

/** 模型调用结果（与项目内 AIResponse 形状兼容的最小子集） */
export interface LlmJudgeResponse {
    content: string;
    error?: string;
}

/** 可注入的模型调用器（便于单测与替换实现） */
export type LlmCaller = (request: LlmJudgeRequest) => Promise<LlmJudgeResponse>;

/** 复核选项 */
export interface JudgeOptions {
    /** 模型调用器 */
    caller: LlmCaller;
    /** 最多复核多少对（成本上限，默认 20） */
    maxPairs?: number;
    /** 低于该置信度不产出（默认 0.6） */
    minConfidence?: number;
}

/** 复核结果 */
export interface JudgeResult {
    /** 复核确认的矛盾 */
    contradictions: ConsistencyContradiction[];
    /** 实际发起的模型调用次数（用于成本断言） */
    calls: number;
    /** 被丢弃的配对数（含解析失败/低置信度） */
    dropped: number;
}

/** 默认最大复核对数 */
export const DEFAULT_MAX_PAIRS = 20;
/** 默认最低置信度 */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

/** 复核提示词：要求严格 JSON，禁止解释性文字 */
const SYSTEM_PROMPT = [
    '你是长篇小说的一致性校对员。给你两条来自同一部作品的陈述，判断它们是否互相矛盾。',
    '只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块，格式：',
    '{"contradictory": true 或 false, "reasoning": "不超过 60 字的中文理由", "confidence": 0 到 1 的小数}',
    '判定标准：只有两条陈述在同一事实上不能同时成立时才算矛盾；',
    '人物合理成长、位置移动、时间推进、信息随剧情揭示都不算矛盾。',
].join('\n');

/**
 * 复核疑似配对。
 *
 * @param pairs - 规则层给出的疑似配对
 * @param options - 复核选项
 * @returns 复核结果
 */
export async function judgeSuspectedPairs(
    pairs: readonly SuspectedPair[],
    options: JudgeOptions,
): Promise<JudgeResult> {
    const maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const targets = pairs.slice(0, Math.max(0, maxPairs));

    const contradictions: ConsistencyContradiction[] = [];
    let calls = 0;
    let dropped = 0;

    for (const pair of targets) {
        const parsed = await callJudge(pair, options.caller);
        calls++;
        if (!parsed) {
            dropped++;
            continue;
        }
        if (!parsed.contradictory || parsed.confidence < minConfidence) {
            dropped++;
            continue;
        }
        contradictions.push({
            id: makeContradictionId(
                pair.kind,
                pair.a.subject,
                pair.a.predicate,
                pair.a.chapterKey,
                pair.b.chapterKey,
            ),
            kind: pair.kind,
            category: ASSERTION_KIND_META[pair.kind].category,
            subject: pair.a.subject,
            predicate: pair.a.predicate,
            reasoning: parsed.reasoning,
            // 引文一律取真实断言，不用模型输出 → 不可能伪造证据
            evidenceA: { quote: pair.a.quote, chapterKey: pair.a.chapterKey, offset: pair.a.offset },
            evidenceB: { quote: pair.b.quote, chapterKey: pair.b.chapterKey, offset: pair.b.offset },
            decidedBy: 'llm',
            confidence: parsed.confidence,
        });
    }

    return { contradictions, calls, dropped };
}

/**
 * 构造复核用的用户提示。
 *
 * @param pair - 疑似配对
 * @returns 提示词
 */
export function buildJudgePrompt(pair: SuspectedPair): string {
    return [
        `【规则层提示】${pair.reason}`,
        `【陈述 A｜${pair.a.chapterKey}】${pair.a.quote}`,
        `【陈述 B｜${pair.b.chapterKey}】${pair.b.quote}`,
    ].join('\n');
}

/**
 * 调用模型并解析（任何异常都收敛为 null，不让上层崩）。
 *
 * @param pair - 疑似配对
 * @param caller - 模型调用器
 * @returns 解析结果；失败返回 null
 */
async function callJudge(
    pair: SuspectedPair,
    caller: LlmCaller,
): Promise<{ contradictory: boolean; reasoning: string; confidence: number } | null> {
    try {
        const response = await caller({
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: buildJudgePrompt(pair),
        });
        if (!response || response.error) return null;
        return parseJudgeResponse(response.content);
    } catch {
        return null;
    }
}

/**
 * 解析模型返回的 JSON（容错：剥离代码块、截取首个 JSON 对象）。
 *
 * @param raw - 模型原始输出
 * @returns 解析结果；不合法返回 null
 */
export function parseJudgeResponse(raw: string): {
    contradictory: boolean;
    reasoning: string;
    confidence: number;
} | null {
    const text = (raw || '').trim();
    if (!text) return null;

    // 剥离 ```json ``` 包裹
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.contradictory !== 'boolean') return null;
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : '';
    if (!reasoning) return null; // 没有理由 = 没有证据，丢弃
    const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : Number(obj.confidence);
    if (!Number.isFinite(confidenceRaw)) return null;
    const confidence = Math.min(1, Math.max(0, confidenceRaw));

    return { contradictory: obj.contradictory, reasoning, confidence };
}

/**
 * 把断言种类转换成给用户看的中文标签。
 *
 * @param kind - 断言种类
 * @returns 中文标签
 */
export function kindLabel(kind: AssertionKind): string {
    return ASSERTION_KIND_META[kind].label;
}

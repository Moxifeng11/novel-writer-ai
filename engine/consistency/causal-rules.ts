/**
 * causal-rules.ts — 因果类一致性检测（补齐 2 个子类）
 *
 * 覆盖 ConStory-Bench 中 Timeline & Plot Logic 剩下的两个子类：
 *  - **causal-violation（因果逻辑违规）**：同一结果被归因于两个不同原因
 *  - **causeless-effect（无因之果）**：原因在结果之后才出现（顺序倒置）
 *
 * 设计取舍：因果判断最容易误报，因此只做**两条高精度规则**，且都要求
 * 明确的因果连接词与可对照的章节顺序；判不出的宁可不报（延续「宁少不脏」）。
 *
 * 抽取形态：从章节摘要的事实文本里匹配
 *   「因为/由于 X，(所以/因此/于是/导致/使得) Y」→ 断言 {subject: Y, predicate: '原因', value: X}
 * 即「Y 的原因是 X」。
 */

import {
    ASSERTION_KIND_META,
    makeContradictionId,
    type AssertionKind,
    type ConsistencyContradiction,
    type FactAssertion,
} from './assertion-model';

/** 因果连接词（原因在前） */
const CAUSE_PATTERNS: RegExp[] = [
    /因为([^，。；,;]{1,20})[，,]?\s*(?:所以|因此|于是|导致|使得|致使)?([^，。；,;]{1,20})/,
    /由于([^，。；,;]{1,20})[，,]?\s*(?:所以|因此|于是|导致|使得|致使)?([^，。；,;]{1,20})/,
];

/** 「所以/因此」式承接（结果在前、原因省略）——本模块不用，避免过度推断 */
export const CAUSAL_EXTRACTION_LIMIT = 2;

/**
 * 从一段事实文本抽取因果断言（「Y 的原因是 X」）。
 *
 * @param fact - 事实文本
 * @param chapterKey - 章节 key
 * @param chapterNum - 章节序号
 * @param quote - 原文引文（默认用 fact 本身）
 * @param now - 抽取时间戳
 * @returns 因果断言（可能为空）
 */
export function extractCausalAssertions(
    fact: string,
    chapterKey: string,
    chapterNum: number | null,
    quote?: string,
    now = 0,
): FactAssertion[] {
    const text = (fact || '').trim();
    if (!text) return [];
    const out: FactAssertion[] = [];
    for (const pattern of CAUSE_PATTERNS) {
        const match = text.match(pattern);
        if (!match) continue;
        const cause = match[1].trim();
        const effect = match[2].trim();
        if (!cause || !effect || cause === effect) continue;
        out.push({
            id: `causal-violation|${effect}|原因|${chapterKey}`,
            kind: 'causal-violation',
            subject: effect,
            predicate: '原因',
            value: cause,
            chapterKey,
            chapterNum,
            quote: (quote || text).trim(),
            source: 'digest-fact',
            extractedAt: now,
        });
    }
    return out;
}

/**
 * 因果类配对：产出 causal-violation 与 causeless-effect。
 *
 * 规则：
 *  R8 同一结果两个不同原因（跨章）→ causal-violation
 *  R9 原因本身作为事件记录在**更晚**的章节 → causeless-effect
 *
 * @param assertions - 全部断言
 * @returns 矛盾列表
 */
export function pairCausal(assertions: readonly FactAssertion[]): ConsistencyContradiction[] {
    const causal = assertions.filter(a => a.kind === 'causal-violation' && a.predicate === '原因');
    const out: ConsistencyContradiction[] = [];
    const emit = (c: ConsistencyContradiction) => {
        if (out.some(x => x.id === c.id)) return;
        out.push(c);
    };

    // R8 同一结果不同原因
    const byEffect = new Map<string, FactAssertion[]>();
    for (const item of causal) {
        const list = byEffect.get(item.subject);
        if (list) list.push(item);
        else byEffect.set(item.subject, [item]);
    }
    for (const [effect, items] of byEffect) {
        for (let i = 0; i < items.length - 1; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i];
                const b = items[j];
                if (a.chapterKey === b.chapterKey) continue;
                if (a.value === b.value) continue;
                emit(build(effect, a, b, 'causal-violation',
                    `「${effect}」在第 ${a.chapterNum ?? '?'} 章归因为「${a.value}」，`
                    + `到第 ${b.chapterNum ?? '?'} 章又归因为「${b.value}」——同一结果两个互斥原因。`,
                    0.8));
            }
        }
    }

    // R9 原因晚于结果出现
    for (const item of causal) {
        if (item.chapterNum === null) continue;
        const causeEvent = assertions.find(other => other !== item
            && other.subject === item.value
            && other.chapterNum !== null
            && (other.chapterNum as number) > (item.chapterNum as number));
        if (!causeEvent) continue;
        emit(build(item.subject, item, causeEvent, 'causeless-effect',
            `「${item.subject}」在第 ${item.chapterNum} 章已经发生并归因于「${item.value}」，`
            + `但「${item.value}」直到第 ${causeEvent.chapterNum} 章才出现——因果顺序倒置。`,
            0.72));
    }

    return out;
}

/**
 * 构造矛盾对象（内部使用，保证证据链完整）。
 *
 * @param subject - 主语
 * @param a - 证据 A
 * @param b - 证据 B
 * @param kind - 类型
 * @param reasoning - 理由
 * @param confidence - 置信度
 * @returns 矛盾
 */
function build(
    subject: string,
    a: FactAssertion,
    b: FactAssertion,
    kind: AssertionKind,
    reasoning: string,
    confidence: number,
): ConsistencyContradiction {
    return {
        id: makeContradictionId(kind, subject, '原因', a.chapterKey, b.chapterKey),
        kind,
        category: ASSERTION_KIND_META[kind].category,
        subject,
        predicate: '原因',
        reasoning,
        evidenceA: { quote: a.quote, chapterKey: a.chapterKey, offset: a.offset },
        evidenceB: { quote: b.quote, chapterKey: b.chapterKey, offset: b.offset },
        decidedBy: 'rule',
        confidence,
    };
}

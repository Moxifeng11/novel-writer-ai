/**
 * extended-rules.ts — 补齐剩余 10 个子类
 *
 * 覆盖 ConStory-Bench 分类学中此前未实现的三个大类：
 *  - **Characterization**：记忆矛盾 · 知识矛盾 · 能力波动 · 遗忘能力
 *  - **World-building**：核心规则违规 · 社会规范违规 · 地理矛盾
 *  - **Narrative & Style**：视角混乱 · 语气不一致 · 文风漂移
 *
 * 精度策略（延续「宁少不脏」）：
 *  - 能写成**确定性规则**的（记忆自相矛盾、核心规则被违反、同章人称混用）→ 直接产出矛盾；
 *  - 需要世界知识/等级序才能判断的（知识矛盾、能力波动、遗忘能力、社会规范、
 *    地理矛盾、语气、文风）→ 一律进 **suspected** 交 LLM/人工复核，
 *    **绝不**用「值不等即矛盾」这种粗暴规则（那会把合法成长全判成 bug）。
 */

import { parseDuration } from '@/shared/narrative-number';
import {
    ASSERTION_KIND_META,
    makeContradictionId,
    type AssertionKind,
    type ConsistencyContradiction,
    type FactAssertion,
} from './assertion-model';

/** 扩展规则产出的疑似配对（结构同 pairing-rules.SuspectedPair） */
export interface ExtendedSuspected {
    kind: AssertionKind;
    reason: string;
    a: FactAssertion;
    b: FactAssertion;
}

/** 扩展规则结果 */
export interface ExtendedResult {
    contradictions: ConsistencyContradiction[];
    suspected: ExtendedSuspected[];
}

/** 记忆类：记得某事 */
const MEMORY_REMEMBER = /([\u4e00-\u9fa5]{1,6})(?:记得|想起|忆起)([\u4e00-\u9fa5]{1,16})/;
/** 记忆类：忘了某事 */
const MEMORY_FORGET = /([\u4e00-\u9fa5]{1,6})(?:忘了|不记得|已忘却|记不得)([\u4e00-\u9fa5]{1,16})/;
/** 核心规则：设定中的否定式禁则 */
const RULE_FORBID = /(?:不能|无法|不可|禁止|绝不能)([\u4e00-\u9fa5]{2,12})/;
/**
 * 事实里的「事件 + 时长」：「青云试炼持续三日」「试炼历时两个月」。
 *
 * 生产验证发现：这类信息埋在 facts 自由文本里，既不在 timeSpan 也不在台账事件中，
 * 导致时长矛盾 100% 漏报。这里补抽取，产出 absolute-time 断言供 R5 规则使用。
 */
const FACT_DURATION = /([\u4e00-\u9fa5]{2,10}?)(?:持续|历时|耗时|为期)([\u4e00-\u9fa5\d两三四五六七八九十百千万]{1,6})/;
/** 视角标记 */
const FIRST_PERSON = /(?:^|[。！？\n])\s*我[\u4e00-\u9fa5]/g;
const THIRD_PERSON = /(?:^|[。！？\n])\s*(?:他|她)[\u4e00-\u9fa5]/g;

/**
 * 从章节摘要事实中抽取扩展类断言。
 *
 * @param facts - 摘要事实列表
 * @param chapterKey - 章节 key
 * @param chapterNum - 章节序号
 * @param now - 时间戳
 * @returns 断言列表
 */
export function extractExtendedAssertions(
    facts: readonly string[],
    chapterKey: string,
    chapterNum: number | null,
    now = 0,
): FactAssertion[] {
    const out: FactAssertion[] = [];
    for (const fact of facts) {
        const text = (fact || '').trim();
        if (!text) continue;

        const remember = text.match(MEMORY_REMEMBER);
        if (remember) {
            out.push(make('memory', remember[1], '记得', remember[2], text, chapterKey, chapterNum, now));
        }
        const forget = text.match(MEMORY_FORGET);
        if (forget) {
            out.push(make('memory', forget[1], '忘了', forget[2], text, chapterKey, chapterNum, now));
        }
        const forbid = text.match(RULE_FORBID);
        if (forbid) {
            out.push(make('core-rule', '世界规则', '禁止', forbid[1], text, chapterKey, chapterNum, now));
        }
        // 事件时长：产出 absolute-time 断言，交给 R5「时长不相容」规则配对
        const dur = text.match(FACT_DURATION);
        if (dur) {
            const parsed = parseDuration(dur[2]);
            const assertion = make('absolute-time', dur[1], '时间', dur[2], text, chapterKey, chapterNum, now);
            if (parsed) {
                assertion.numericValue = parsed.minutes;
                assertion.unit = '分钟';
            }
            out.push(assertion);
        }
    }
    return out;
}

/**
 * 构造断言（内部工具）。
 *
 * @param kind - 类型
 * @param subject - 主语
 * @param predicate - 谓语
 * @param value - 值
 * @param quote - 引文
 * @param chapterKey - 章节 key
 * @param chapterNum - 章节序号
 * @param now - 时间戳
 * @returns 断言
 */
function make(
    kind: AssertionKind,
    subject: string,
    predicate: string,
    value: string,
    quote: string,
    chapterKey: string,
    chapterNum: number | null,
    now: number,
): FactAssertion {
    return {
        id: `${kind}|${subject}|${predicate}|${chapterKey}`,
        kind,
        subject,
        predicate,
        value,
        chapterKey,
        chapterNum,
        quote,
        source: 'digest-fact',
        extractedAt: now,
    };
}

/**
 * 扩展类配对。
 *
 * 确定性规则（直接产出矛盾）：
 *  - **memory**：同一角色对同一事物既有「记得」又有「忘了」（跨章）
 *  - **core-rule**：设定中「禁止 X」，后文出现「X」被正常执行（同 subject 值包含）
 *
 * 其余一律进 suspected。
 *
 * @param assertions - 全部断言
 * @param assertions - 全部断言
 * @param bodies - 章节正文（用于视角检测）
 * @param factTexts - 原始事实文本（用于「违规句未成断言」的场景）
 * @returns 扩展结果
 */
export function pairExtended(
    assertions: readonly FactAssertion[],
    bodies: ReadonlyArray<{ chapterKey: string; body: string }> = [],
    factTexts: ReadonlyArray<{ chapterKey: string; chapterNum: number | null; text: string; quote: string }> = [],
): ExtendedResult {
    const contradictions: ConsistencyContradiction[] = [];
    const suspected: ExtendedSuspected[] = [];
    const emit = (c: ConsistencyContradiction) => {
        if (contradictions.some(x => x.id === c.id)) return;
        contradictions.push(c);
    };

    // ── memory：记得 vs 忘了（同一角色 + 同一对象）──────────
    const remembered = assertions.filter(a => a.kind === 'memory' && a.predicate === '记得');
    const forgotten = assertions.filter(a => a.kind === 'memory' && a.predicate === '忘了');
    for (const remember of remembered) {
        for (const forget of forgotten) {
            if (remember.subject !== forget.subject) continue;
            if (remember.chapterKey === forget.chapterKey) continue;
            const shared = commonValue(remember.value, forget.value);
            if (!shared) continue;
            emit(build('memory', remember.subject, `${remember.subject} 记得「${shared}」`,
                `第 ${forget.chapterNum ?? '?'} 章又说忘了「${shared}」——记忆自相矛盾。`,
                remember, forget, 0.82));
        }
    }

    // ── core-rule：禁止 X，但 X 被做了 ───────────────────────
    const rules = assertions.filter(a => a.kind === 'core-rule' && a.predicate === '禁止');
    for (const rule of rules) {
        // 先扫原始 facts 文本（生产验证发现：违规句往往不构成断言，只看断言会漏报）
        const factHit = factTexts.find(fact => fact.chapterKey !== rule.chapterKey
            && fact.chapterNum !== null && rule.chapterNum !== null
            && (fact.chapterNum as number) > (rule.chapterNum as number)
            && fact.text.includes(rule.value)
            && !fact.text.includes(`不能${rule.value}`)
            && !fact.text.includes(`无法${rule.value}`));
        if (factHit) {
            const factAssertion: FactAssertion = {
                id: `core-rule|fact|${factHit.chapterKey}`,
                kind: 'core-rule',
                subject: '世界规则',
                predicate: '违反',
                value: rule.value,
                chapterKey: factHit.chapterKey,
                chapterNum: factHit.chapterNum,
                quote: factHit.quote,
                source: 'digest-fact',
                extractedAt: 0,
            };
            emit(build('core-rule', '世界规则', `设定禁止「${rule.value}」`,
                `第 ${rule.chapterNum} 章确立「不能${rule.value}」，第 ${factHit.chapterNum} 章却出现了该行为。`,
                rule, factAssertion, 0.78));
            continue;
        }
        const violated = assertions.find(other => other.chapterKey !== rule.chapterKey
            && other.chapterNum !== null && rule.chapterNum !== null
            && (other.chapterNum as number) > (rule.chapterNum as number)
            && other.quote.includes(rule.value)
            && !other.quote.includes(`不能${rule.value}`)
            && !other.quote.includes(`无法${rule.value}`));
        if (!violated) continue;
        emit(build('core-rule', '世界规则', `设定禁止「${rule.value}」`,
            `第 ${rule.chapterNum} 章确立「不能${rule.value}」，第 ${violated.chapterNum} 章却出现了该行为。`,
            rule, violated, 0.75));
    }

    // ── perspective：同章人称混用 ────────────────────────────
    for (const chapter of bodies) {
        const first = (chapter.body.match(FIRST_PERSON) ?? []).length;
        const third = (chapter.body.match(THIRD_PERSON) ?? []).length;
        // 只有两种人称都达到一定密度才算混用（零星一次可能是有意为之）
        if (first < 3 || third < 3) continue;
        const ratio = Math.min(first, third) / Math.max(first, third);
        if (ratio < 0.25) continue;
        const a = make('perspective', chapter.chapterKey, '第一人称', String(first), `第一人称 ${first} 处`, chapter.chapterKey, null, 0);
        const b = make('perspective', chapter.chapterKey, '第三人称', String(third), `第三人称 ${third} 处`, chapter.chapterKey, null, 0);
        emit({
            id: makeContradictionId('perspective', chapter.chapterKey, '人称', chapter.chapterKey, chapter.chapterKey),
            kind: 'perspective',
            category: ASSERTION_KIND_META.perspective.category,
            subject: chapter.chapterKey,
            predicate: '人称',
            reasoning: `同一章内第一人称 ${first} 处、第三人称 ${third} 处，比例接近，视角混用。`,
            evidenceA: { quote: a.quote, chapterKey: chapter.chapterKey },
            evidenceB: { quote: b.quote, chapterKey: chapter.chapterKey },
            decidedBy: 'rule',
            confidence: 0.6,
        });
    }

    // ── 其余子类：进疑似（需要世界知识/等级序，规则层无法判定）──
    for (const a of assertions) {
        if (a.kind === 'skill-fluctuation' || a.kind === 'forgotten-ability'
            || a.kind === 'knowledge' || a.kind === 'social-norm'
            || a.kind === 'geographical' || a.kind === 'tone' || a.kind === 'style-shift') {
            suspected.push({
                kind: a.kind,
                reason: `${ASSERTION_KIND_META[a.kind].label}：需要结合前文与世界设定判断，建议模型复核`,
                a,
                b: a,
            });
        }
    }

    return { contradictions, suspected };
}

/**
 * 取两段文本的公共子串（≥2 字），用于判断是否指同一事物。
 *
 * @param a - 文本 A
 * @param b - 文本 B
 * @returns 公共片段；无则返回空串
 */
export function commonValue(a: string, b: string): string {
    const x = (a || '').trim();
    const y = (b || '').trim();
    if (x.length < 2 || y.length < 2) return '';
    for (let len = Math.min(x.length, y.length); len >= 2; len--) {
        for (let i = 0; i + len <= x.length; i++) {
            const piece = x.slice(i, i + len);
            if (y.includes(piece)) return piece;
        }
    }
    return '';
}

/**
 * 构造矛盾（内部工具）。
 *
 * @param kind - 类型
 * @param subject - 主语
 * @param subjectLabel - 理由前缀
 * @param reasoningTail - 理由后半
 * @param a - 证据 A
 * @param b - 证据 B
 * @param confidence - 置信度
 * @returns 矛盾
 */
function build(
    kind: AssertionKind,
    subject: string,
    subjectLabel: string,
    reasoningTail: string,
    a: FactAssertion,
    b: FactAssertion,
    confidence: number,
): ConsistencyContradiction {
    return {
        id: makeContradictionId(kind, subject, '记忆', a.chapterKey, b.chapterKey),
        kind,
        category: ASSERTION_KIND_META[kind].category,
        subject,
        predicate: kind === 'memory' ? '记忆' : '规则',
        reasoning: `${subjectLabel}，${reasoningTail}`,
        evidenceA: { quote: a.quote, chapterKey: a.chapterKey, offset: a.offset },
        evidenceB: { quote: b.quote, chapterKey: b.chapterKey, offset: b.offset },
        decidedBy: 'rule',
        confidence,
    };
}

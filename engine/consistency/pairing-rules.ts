/**
 * pairing-rules.ts — 规则层矛盾检测（**零 token**，全量跑）
 *
 * 两级判定中的第一级：能用确定性规则判出来的，绝不花模型调用。
 * 只有判不了又值得看的（命名混淆嫌疑、废弃情节）才交给 LLM 层（pairing-llm.ts）。
 *
 * 精度优先原则：**宁可漏报，不可误报**。每条产出都必须带双侧引文；
 * 置信度低于 0.6 的一律降级为「疑似」交给 LLM 复核，而不是直接报给用户。
 *
 * 本层实现的判据（对应 ConStory-Bench 9 个子类）：
 *  | 规则 | 子类 | 判据 |
 *  |---|---|---|
 *  | R1 | quantitative | 年龄倒退（后章数值 < 前章） |
 *  | R2 | quantitative | 同章同主语同谓语出现互不相容的数值 |
 *  | R3 | nomenclature | 同一人物的化名前后不同 |
 *  | R5 | duration / absolute-time | 同一事件的时长不相容 |
 *  | R7 | simultaneity | 同一章内同一主体出现在两个不同地点 |
 *  | R4(疑似) | nomenclature | 非权威名称与权威名称仅差一个字（可能错用/错字） |
 *  | R6(疑似) | abandoned-plot | 伏笔被标记废弃但从未回收 |
 */

import { durationsAreCompatible, numbersAreCompatible } from '@/shared/narrative-number';
import { isRetrospectiveQuote, matchesPredicate, matchesPredicateLoose } from './predicate-match';
import { pairCausal } from './causal-rules';
import { pairExtended } from './extended-rules';
import {
    ASSERTION_KIND_META,
    hasCompleteEvidence,
    makeContradictionId,
    type AssertionKind,
    type ConsistencyContradiction,
    type FactAssertion,
} from './assertion-model';

/** 配对输入 */
export interface PairingInput {
    /** 断言集合（跨章累积） */
    assertions: readonly FactAssertion[];
    /** 章节正文（扩展规则用于视角检测等） */
    chapters?: ReadonlyArray<{ chapterKey: string; body: string }>;
    /** 原始事实文本（扩展规则用于「违规句未成断言」的场景） */
    factTexts?: ReadonlyArray<{ chapterKey: string; chapterNum: number | null; text: string; quote: string }>;
    /** 已标记废弃的伏笔（来自台账 ForeshadowRecord） */
    abandonedPlots?: ReadonlyArray<{
        name: string;
        /** 伏笔条目原文（作证据 A） */
        quote: string;
        chapterKey: string;
    }>;
}

/** 疑似配对（规则层判不了，交给 LLM 复核） */
export interface SuspectedPair {
    kind: AssertionKind;
    reason: string;
    a: FactAssertion;
    b: FactAssertion;
}

/** 配对输出 */
export interface PairingOutput {
    /** 规则层确定的矛盾（已带完整证据链） */
    contradictions: ConsistencyContradiction[];
    /** 需要 LLM 复核的疑似配对 */
    suspected: SuspectedPair[];
}

/** 年龄断言的谓语名 */
/** 时长单位白名单（只有这些单位才参与「时长不相容」比较） */
const DURATION_UNITS = new Set(['分钟', '小时', '日', '天', '月', '年', '刻']);

const AGE_PREDICATE = '年龄';

/** 视为「当前年龄」的谓词前缀（顺序无关；限定词在前的不算，如「被提亲起始年龄」） */
const AGE_PREDICATE_PREFIXES = ['年龄', '年纪', '岁数'];
/** 化名断言的谓语名 */
const ALIAS_PREDICATE = '又名';
/** 章节时长断言的谓语名（每章一条，自身不参与跨章比较） */
const CHAPTER_SPAN_PREDICATE = '章节时长';

/**
 * 规则层配对。
 *
 * @param input - 配对输入
 * @returns 矛盾与疑似配对
 */
export function pairContradictions(input: PairingInput): PairingOutput {
    const assertions = input.assertions.slice();
    const contradictions: ConsistencyContradiction[] = [];
    const suspected: SuspectedPair[] = [];

    const emit = (c: ConsistencyContradiction) => {
        if (!hasCompleteEvidence(c)) return; // 没有证据链的一律不产出
        if (contradictions.some(x => x.id === c.id)) return;
        contradictions.push(c);
    };

    // ── R1 年龄倒退 ───────────────────────────────────────
    // 谓词匹配规则（2026-11-13 长篇评测两轮修正）：
    //  - 用**前缀**匹配：LLM 常给出「年龄约」「年纪」等变体（严格 === 会整类漏报）；
    //  - 但必须锚定在开头：被提亲起始年龄=八岁 这类**回溯叙述**不能被当成当前年龄，
    //    否则会报「11 岁 → 8 岁」的假矛盾（《将夜》第6章实例，已核对原文确认是噪声）。
    const ages = assertions.filter(a => a.kind === 'quantitative'
        && matchesPredicate(a.predicate, 'age')
        && typeof a.numericValue === 'number'
        // 0 岁这类值几乎必然是抽取噪声（「十五六岁」被解析成 0）
        && a.numericValue > 0
        // 回溯排除：新数据用拆解侧给的 isCurrentState 标记（权威）；
        // 旧数据没有该字段时回退到引文启发式（兼容既有事实库）
        && isCurrentStateAssertion(a)
        && a.chapterNum !== null);
    for (const pair of groupBy(ages, a => a.subject).values()) {
        const ordered = pair.slice().sort((a, b) => (a.chapterNum ?? 0) - (b.chapterNum ?? 0));
        for (let i = 0; i < ordered.length - 1; i++) {
            for (let j = i + 1; j < ordered.length; j++) {
                const earlier = ordered[i];
                const later = ordered[j];
                if ((later.chapterNum ?? 0) <= (earlier.chapterNum ?? 0)) continue;
                const before = earlier.numericValue as number;
                const after = later.numericValue as number;
                if (after >= before) continue;
                emit(buildContradiction({
                    kind: 'quantitative',
                    subject: earlier.subject,
                    predicate: AGE_PREDICATE,
                    reasoning: `第${earlier.chapterNum}章「${earlier.subject}」${before} 岁，`
                        + `到第${later.chapterNum}章反而变成 ${after} 岁——年龄不可能倒退。`,
                    a: earlier,
                    b: later,
                    confidence: 0.92,
                }));
            }
        }
    }

    // ── R2 同章同谓语互不相容的数值 ───────────────────────
    const numeric = assertions.filter(a => a.kind === 'quantitative'
        && typeof a.numericValue === 'number'
        && a.chapterNum !== null);
    for (const group of groupBy(numeric, a => `${a.subject}|${a.predicate}|${a.chapterKey}`).values()) {
        for (let i = 0; i < group.length - 1; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];
                const va = a.numericValue as number;
                const vb = b.numericValue as number;
                if (numbersAreCompatible(va, vb)) continue;
                emit(buildContradiction({
                    kind: 'quantitative',
                    subject: a.subject,
                    predicate: a.predicate,
                    reasoning: `同一章（${a.chapterKey}）内「${a.subject}」的「${a.predicate}」`
                        + `同时出现 ${a.value} 与 ${b.value}，两者不相容。`,
                    a,
                    b,
                    confidence: 0.85,
                }));
            }
        }
    }

    // ── R3 化名冲突 ──────────────────────────────────────
    const aliases = assertions.filter(a => a.kind === 'nomenclature' && matchesPredicateLoose(a.predicate, 'alias'));
    for (const group of groupBy(aliases, a => a.subject).values()) {
        for (let i = 0; i < group.length - 1; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];
                if (a.value === b.value) continue;
                if (a.chapterKey === b.chapterKey) continue;
                emit(buildContradiction({
                    kind: 'nomenclature',
                    subject: a.subject,
                    predicate: ALIAS_PREDICATE,
                    reasoning: `「${a.subject}」在 ${a.chapterKey} 被称作「${a.value}」，`
                        + `在 ${b.chapterKey} 又被称作「${b.value}」——同一人物的化名前后不一致。`,
                    a,
                    b,
                    confidence: 0.8,
                }));
            }
        }
    }

    // ── R5 同一事件时长不相容 ─────────────────────────────
    // 时长类断言必须有**正的数值 + 明确的时长单位**：
    // 拆解侧对「时间点」类事实常给 numeric=0、unit 为空（如「今天清晨冒雨冲入渭城」），
    // 若只判 typeof === 'number'，会把无关时间点两两比较，产生大量假矛盾
    // （2026-11-13 新 prompt 对照评测：427 条误报全部来自此处）。
    const eventTimes = assertions.filter(a => a.kind === 'absolute-time'
        && matchesPredicate(a.predicate, 'time')
        && typeof a.numericValue === 'number'
        && a.numericValue > 0
        // 有单位时必须是时长单位；无单位时接受（旧数据用分钟数，无单位）
        && (a.unit === undefined || DURATION_UNITS.has(a.unit)));
    for (const group of groupBy(eventTimes, a => a.subject).values()) {
        for (let i = 0; i < group.length - 1; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];
                if (a.chapterKey === b.chapterKey) continue;
                const va = a.numericValue as number;
                const vb = b.numericValue as number;
                if (durationsAreCompatible(va, vb)) continue;
                emit(buildContradiction({
                    kind: 'duration',
                    subject: a.subject,
                    predicate: '时间',
                    reasoning: `事件「${a.subject}」在 ${a.chapterKey} 记为「${a.value}」，`
                        + `在 ${b.chapterKey} 记为「${b.value}」——两处时长不相容。`,
                    a,
                    b,
                    confidence: 0.78,
                }));
            }
        }
    }

    // ── R7 同章内两个地点 ────────────────────────────────
    const locations = assertions.filter(a => a.kind === 'simultaneity'
        && (!matchesPredicate(a.predicate, 'location')))
        .concat(assertions.filter(a => a.kind === 'simultaneity' && matchesPredicate(a.predicate, 'location')));
    for (const group of groupBy(locations, a => `${a.subject}|${a.chapterKey}`).values()) {
        for (let i = 0; i < group.length - 1; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];
                if (a.value === b.value) continue;
                emit(buildContradiction({
                    kind: 'simultaneity',
                    subject: a.subject,
                    predicate: '地点',
                    reasoning: `「${a.subject}」在 ${a.chapterKey} 内同时出现在「${a.value}」与「${b.value}」，`
                        + '两处地点互斥（未说明移动过程）。',
                    a,
                    b,
                    confidence: 0.7,
                }));
            }
        }
    }

    // ── R4 疑似：名称与权威名称仅差一字 ───────────────────
    const authoritative = assertions.filter(a => a.source === 'fact-index');
    const nonAuthoritative = assertions.filter(a => a.source !== 'fact-index' && a.kind === 'nomenclature');
    for (const candidate of nonAuthoritative) {
        for (const auth of authoritative) {
            if (candidate.subject === auth.subject) continue;
            if (!isNearIdentical(candidate.subject, auth.subject)) continue;
            suspected.push({
                kind: 'nomenclature',
                reason: `「${candidate.subject}」与已确认名称「${auth.subject}」仅差一字，可能是同一角色的错用或错字。`,
                a: candidate,
                b: auth,
            });
        }
    }

    // ── R6 疑似：废弃伏笔从未回收 ─────────────────────────
    for (const plot of input.abandonedPlots ?? []) {
        const mention = assertions.find(a => a.subject === plot.name);
        if (!mention) continue;
        suspected.push({
            kind: 'abandoned-plot',
            reason: `伏笔「${plot.name}」已被标记为废弃，但后续正文仍有相关提及。`,
            a: {
                id: `abandoned|${plot.name}`,
                kind: 'abandoned-plot',
                subject: plot.name,
                predicate: '状态',
                value: '已废弃',
                chapterKey: plot.chapterKey,
                chapterNum: null,
                quote: plot.quote,
                source: 'ledger-event',
                extractedAt: Date.now(),
            },
            b: mention,
        });
    }

    // ── R8/R9 因果类（causal-violation / causeless-effect）──
    for (const causal of pairCausal(assertions)) {
        if (hasCompleteEvidence(causal)) emit(causal);
    }

    // ── 扩展 10 子类（记忆/知识/能力/世界观/叙事）──
    const extended = pairExtended(assertions, input.chapters ?? [], input.factTexts ?? []);
    for (const c of extended.contradictions) {
        if (hasCompleteEvidence(c)) emit(c);
    }
    suspected.push(...extended.suspected);

    return { contradictions, suspected };
}

/** 构造矛盾的参数 */
interface BuildContradictionParams {
    kind: AssertionKind;
    subject: string;
    predicate: string;
    reasoning: string;
    a: FactAssertion;
    b: FactAssertion;
    confidence: number;
}

/**
 * 由两条断言构造带完整证据链的矛盾。
 *
 * @param p - 构造参数
 * @returns 矛盾对象
 */
function buildContradiction(p: BuildContradictionParams): ConsistencyContradiction {
    return {
        id: makeContradictionId(p.kind, p.subject, p.predicate, p.a.chapterKey, p.b.chapterKey),
        kind: p.kind,
        category: ASSERTION_KIND_META[p.kind].category,
        subject: p.subject,
        predicate: p.predicate,
        reasoning: p.reasoning,
        evidenceA: { quote: p.a.quote, chapterKey: p.a.chapterKey, offset: p.a.offset },
        evidenceB: { quote: p.b.quote, chapterKey: p.b.chapterKey, offset: p.b.offset },
        decidedBy: 'rule',
        confidence: p.confidence,
    };
}

/**
 * 按 key 分组（保持插入顺序，便于结果稳定）。
 *
 * @param items - 列表
 * @param keyOf - 取 key
 * @returns 分组映射
 */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        const list = map.get(key);
        if (list) list.push(item);
        else map.set(key, [item]);
    }
    return map;
}

/**
 * 两个名称是否「仅差一字」（且长度相近），用于识别错字/错用。
 *
 * 长度为 2 的中文名只允许 1 处差异；更长的名字允许 1 处差异。
 * 完全相同的名字不算（那不是混淆）。
 *
 * @param a - 名称 A
 * @param b - 名称 B
 * @returns 是否近似
 */
export function isNearIdentical(a: string, b: string): boolean {
    if (!a || !b || a === b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length < 2 || b.length < 2) return false;
    const distance = editDistance(a, b);
    return distance === 1;
}

/**
 * Levenshtein 距离（只用于短名称，O(n*m) 可接受）。
 *
 * @param a - 字符串 A
 * @param b - 字符串 B
 * @returns 编辑距离
 */
export function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[n];
}

/** 供上层判断：某条断言的谓语是否被本层规则覆盖（用于统计覆盖率） */
export const RULE_COVERED_PREDICATES: readonly string[] = [
    AGE_PREDICATE,
    ALIAS_PREDICATE,
    CHAPTER_SPAN_PREDICATE,
    '时间',
    '地点',
    '当前位置',
];


/**
 * 判断断言是否描述「当前状态」。
 *
 * 优先级：拆解侧标记（权威）> 引文启发式（旧数据兼容）。
 *
 * @param assertion - 断言
 * @returns 是否当前状态
 */
function isCurrentStateAssertion(assertion: { isCurrentState?: boolean; quote: string }): boolean {
    if (assertion.isCurrentState === true) return true;
    if (assertion.isCurrentState === false) return false;
    return !isRetrospectiveQuote(assertion.quote);
}

/**
 * assertion-extract.ts — 从既有事实载体抽取「可比断言」（纯函数）
 *
 * 关键约束（设计决定，见 MVP 计划 S1）：
 *  1. **零新增 AI 调用**——只对已有的结构化/半结构化数据做规则化抽取；
 *  2. **宁少不脏**——抽不出明确主语或值的，直接跳过；绝不猜主语；
 *  3. 不做 IO、不依赖 App，便于单测与在别处复用。
 *
 * 四类来源与其可信度（高 → 低）：
 *  - `frontmatter`：人物档案结构化字段（年龄/外貌/修为/位置），人工或 AI 维护
 *  - `ledger-event`：结构化台账 EventRecord（含行号，可作证据）
 *  - `fact-index`：事实索引里**已人工确认**的实体名（命名基准）
 *  - `digest-fact` / `digest-time`：章节摘要的 LLM 抽取结果（自由文本，最弱）
 */

import { parseDuration, parseQuantity } from '@/shared/narrative-number';
import { extractCausalAssertions } from './causal-rules';
import { extractExtendedAssertions } from './extended-rules';
import {
    makeAssertionId,
    type AssertionKind,
    type AssertionSource,
    type FactAssertion,
} from './assertion-model';

/** 抽取输入：全部为纯数据，不依赖 Obsidian */
export interface AssertionExtractInput {
    /** 章节 key（项目内唯一） */
    chapterKey: string;
    /** 章节序号；未知传 null */
    chapterNum: number | null;
    /** 章节摘要（可缺） */
    digest?: {
        facts?: string[];
        timeSpan?: string;
        involved?: string[];
        events?: string[];
    };
    /** 人物档案（可缺）：name 必填，frontmatter 为原始键值 */
    character?: {
        name: string;
        frontmatter: Record<string, unknown>;
    };
    /** 结构化台账事件（可缺） */
    events?: Array<{
        name: string;
        time?: string;
        location?: string;
        chapterKey?: string;
        chapterNum?: number | null;
        lineNo?: number;
        raw?: string;
    }>;
    /** 已人工确认的实体事实（可缺）：用于建立权威命名集合 */
    confirmedFacts?: Array<{ name: string; category: string }>;
    /** 抽取时间戳（默认 Date.now()，测试可注入） */
    now?: number;
}

/**
 * 人物档案里「结构化、可直接比较」的字段 → 谓语名。
 *
 * 只收本批 9 个子类能承接的字段：
 *  - 年龄 → quantitative（配对阶段只对「年龄倒退」报警）
 *  - 当前位置 → simultaneity（同章不同地点才报警）
 *  - 外貌特征 → appearance
 * 「所属势力」「功法/技能树」「修为等级」暂不抽：它们**合法地会变**
 * （转投门派、修为进阶），缺少等级序就无法区分「合理变化」与「矛盾」，
 * 抽进来只会制造误报。
 */
const FRONTMATTER_PREDICATES: Array<{ key: string; predicate: string; kind: AssertionKind }> = [
    { key: '年龄', predicate: '年龄', kind: 'quantitative' },
    { key: '当前位置', predicate: '当前位置', kind: 'simultaneity' },
    { key: '外貌特征', predicate: '外貌特征', kind: 'appearance' },
];

/**
 * 「X 今年 N 岁」/「X N 岁」：明确把人名放在数字前。
 *
 * 中文人名**经常含数字字**（张三、李四、王五……），所以不能把数词从主语字符集排除
 * ——那会把最常见的人名全废掉（实测踩过）。改用两条判据消歧：
 *  1. **有连接词**（今年/年方/刚满…）：主语可信，允许含数字字 →「张三今年十八岁」✅
 *  2. **无连接词**：主语不得含任何数字字 →「林轩十八岁」✅；「李四十八岁」有歧义
 *     （是人名「李四十八」还是「李四」十八岁？）→ **丢弃**（宁少不脏）
 *
 * 同时用「句读边界」锚定主语起点，避免把前一句尾巴拼进主语。
 */
const SUBJECT_CHARS = '[^，。；、！？\\s]';
const NUM_CHARS = '[零〇一二两三四五六七八九十百\\d]';
/** 主语与数字之间可能出现的连接词 */
const AGE_CONNECTORS = ['今年', '年方', '刚满', '正好', '已经', '现年', '时年'];
const AGE_CONNECTOR_PATTERN = AGE_CONNECTORS.join('|');
const NUMERAL_ONLY = new RegExp(`^${NUM_CHARS}+$`);
const CONTAINS_NUMERAL = new RegExp(NUM_CHARS);
const AGE_WITH_SUBJECT = new RegExp(
    // 捕获组：1=主语 2=连接词（无则空） 3=数字
    `(?:^|[，。；、！？\\s])(${SUBJECT_CHARS}{2,10}?)(?:(${AGE_CONNECTOR_PATTERN}))?\\s*(${NUM_CHARS}{1,5})\\s*(?:岁|周岁)`,
);

/** 「X 来自/住在/位于 Y」：地点断言 */
const LOCATION_WITH_SUBJECT = /([\u4e00-\u9fa5A-Za-z·]{1,8})(?:位于|住在|身处|抵达|来到|前往)([\u4e00-\u9fa5A-Za-z·]{2,12})/;

/** 化名/道号/绰号：「X，本名 Y」「Y 化名 Z」 */
const ALIAS_PATTERNS: RegExp[] = [
    /([\u4e00-\u9fa5A-Za-z·]{1,8})(?:的)?(?:本名|原名|真名)(?:是|叫|为)?([\u4e00-\u9fa5A-Za-z·]{1,8})/,
    /([\u4e00-\u9fa5A-Za-z·]{1,8})(?:的)?(?:化名|道号|绰号|外号)(?:是|叫|为)([\u4e00-\u9fa5A-Za-z·]{1,8})/,
];

/** 外貌关键词：只在出现这些词时才尝试抽外貌断言 */
const APPEARANCE_HINTS = ['外貌', '长相', '容貌', '身形', '身高', '疤痕', '胎记', '断臂', '白发', '独眼'];

/**
 * 从输入抽取全部断言。
 *
 * @param input - 抽取输入
 * @returns 断言列表（已去重、已过滤无效项）
 */
export function extractAssertions(input: AssertionExtractInput): FactAssertion[] {
    const now = input.now ?? Date.now();
    const out: FactAssertion[] = [];

    const push = (
        kind: AssertionKind,
        subject: string,
        predicate: string,
        value: string,
        quote: string,
        source: AssertionSource,
        extra?: { numericValue?: number; unit?: string; chapterKey?: string; chapterNum?: number | null },
    ) => {
        const assertion: FactAssertion = {
            id: makeAssertionId(kind, subject, predicate, extra?.chapterKey ?? input.chapterKey),
            kind,
            subject: subject.trim(),
            predicate,
            value: value.trim(),
            numericValue: extra?.numericValue,
            unit: extra?.unit,
            chapterKey: extra?.chapterKey ?? input.chapterKey,
            chapterNum: extra?.chapterNum ?? input.chapterNum,
            quote: quote.trim(),
            source,
            extractedAt: now,
        };
        if (!assertion.subject || !assertion.value || !assertion.quote) return;
        if (out.some(a => a.id === assertion.id)) return;
        out.push(assertion);
    };

    // ── 1. 人物档案（可信度最高）──────────────────────────────
    if (input.character) {
        const name = input.character.name.trim();
        const fm = input.character.frontmatter;
        for (const spec of FRONTMATTER_PREDICATES) {
            const raw = fm[spec.key];
            const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
            if (!value) continue;
            let numericValue: number | undefined;
            let unit: string | undefined;
            if (spec.predicate === '年龄') {
                const q = parseQuantity(value);
                if (q && q.unit === '岁') {
                    numericValue = q.value;
                    unit = '岁';
                } else {
                    const n = Number(value);
                    if (Number.isFinite(n)) {
                        numericValue = n;
                        unit = '岁';
                    }
                }
            }
            push(spec.kind, name, spec.predicate, value, `人物档案：${spec.key}=${value}`, 'frontmatter', {
                numericValue,
                unit,
            });
        }
    }

    // ── 2. 章节摘要 facts[]（自由文本，需明确主语）──────────────
    for (const fact of input.digest?.facts ?? []) {
        const text = (fact || '').trim();
        if (!text) continue;

        // 2.1 年龄/数量：要求「人名 + (连接词) + 数字 + 岁」
        const age = text.match(AGE_WITH_SUBJECT);
        if (age) {
            // 惰性匹配仍可能把连接词吞进主语（「他今年十八岁」→ 主语「他今年」），再剥一次
            const subject = age[1].replace(new RegExp(`(?:${AGE_CONNECTOR_PATTERN})$`), '');
            const hasConnector = Boolean(age[2]);
            const numberText = age[3];
            // 无连接词时，主语含数字字会产生歧义（「李四十八岁」→ 人名「李四十八」？）→ 丢弃
            const ambiguous = !hasConnector && CONTAINS_NUMERAL.test(subject);
            const q = parseQuantity(`${numberText}岁`);
            if (q && subject.length >= 2 && !NUMERAL_ONLY.test(subject) && !ambiguous) {
                push('quantitative', subject, '年龄', String(q.value), text, 'digest-fact', {
                    numericValue: q.value,
                    unit: '岁',
                });
            }
        }

        // 2.2 地点
        const loc = text.match(LOCATION_WITH_SUBJECT);
        if (loc) {
            push('simultaneity', loc[1], '当前位置', loc[2], text, 'digest-fact');
        }

        // 2.3 命名/化名
        for (const pattern of ALIAS_PATTERNS) {
            const alias = text.match(pattern);
            if (alias) {
                push('nomenclature', alias[1], '又名', alias[2], text, 'digest-fact');
                break;
            }
        }

        // 2.4 外貌
        if (APPEARANCE_HINTS.some(hint => text.includes(hint))) {
            const subject = input.digest?.involved?.[0];
            if (subject) push('appearance', subject, '外貌特征', text, text, 'digest-fact');
        }
    }

    // ── 3. 章节摘要 timeSpan（时长断言）────────────────────────
    const timeSpan = (input.digest?.timeSpan ?? '').trim();
    if (timeSpan) {
        const duration = parseDuration(timeSpan);
        push(
            'duration',
            input.chapterKey,
            '章节时长',
            timeSpan,
            `章节时间跨度：${timeSpan}`,
            'digest-time',
            duration ? { numericValue: duration.minutes, unit: '分钟' } : undefined,
        );
    }

    // ── 4. 结构化台账事件（含行号，可作证据）──────────────────
    for (const event of input.events ?? []) {
        const name = (event.name || '').trim();
        if (!name) continue;
        const quote = (event.raw || `${name}${event.time ? ` @${event.time}` : ''}`).trim();
        const chapterKey = event.chapterKey || input.chapterKey;
        const chapterNum = event.chapterNum ?? input.chapterNum;

        if (event.time) {
            const duration = parseDuration(event.time);
            push('absolute-time', name, '时间', event.time, quote, 'ledger-event', {
                numericValue: duration?.minutes,
                unit: duration ? '分钟' : undefined,
                chapterKey,
                chapterNum,
            });
        }
        if (event.location) {
            // 地点本身不是矛盾；只有「同一时刻处于两处」才矛盾 → 归到 simultaneity
            push('simultaneity', name, '地点', event.location, quote, 'ledger-event', {
                chapterKey,
                chapterNum,
            });
        }
    }

    // ── 4.5 因果对（causal-violation / causeless-effect 的原料）──
    for (const fact of input.digest?.facts ?? []) {
        out.push(...extractCausalAssertions(fact, input.chapterKey, input.chapterNum, undefined, now));
    }

    // ── 4.6 扩展 10 子类原料（记忆/核心规则）──
    out.push(...extractExtendedAssertions(input.digest?.facts ?? [], input.chapterKey, input.chapterNum, now));

    // ── 5. 已确认事实索引（建立权威命名基准）──────────────────
    for (const fact of input.confirmedFacts ?? []) {
        const name = (fact.name || '').trim();
        if (!name) continue;
        push('nomenclature', name, '权威名称', name, `事实索引已确认：${name}`, 'fact-index', {
            chapterKey: '',
            chapterNum: null,
        });
    }

    return out;
}

/**
 * 合并多章断言，按 id 去重（后出现者不覆盖先出现者，保留最早证据）。
 *
 * 用于增量累积：每次只抽新章，再与既有断言合并。
 *
 * @param existing - 既有断言
 * @param incoming - 新增断言
 * @returns 合并结果
 */
export function mergeAssertions(
    existing: readonly FactAssertion[],
    incoming: readonly FactAssertion[],
): FactAssertion[] {
    const byId = new Map<string, FactAssertion>();
    for (const a of existing) byId.set(a.id, a);
    for (const a of incoming) {
        if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return [...byId.values()];
}

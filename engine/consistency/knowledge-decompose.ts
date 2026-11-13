/**
 * knowledge-decompose.ts — 把正文拆成「知识库条目」（C 臂实验）
 *
 * 为什么需要它：真实原著验证（2026-11-13）证明，纯正则只能抽到表层句式信息，
 * 而原著里真正的一致性问题是「他知道了他不该知道的事」「这条设定在第 300 章被破坏」，
 * 必须先把正文理解成**结构化事实**才谈得上比对。
 *
 * 设计原则（关键）：
 *  - **LLM 只负责拆解，不负责判定**。判定留给规则层——可解释、可回归、零成本重复跑。
 *  - 每条必须带 `quote`（原文证据）；无 quote 的条目直接丢弃，不允许凭空断言。
 *  - 引入 `validFrom / validTo`：合法变化（进阶/迁移/物品损耗）会有各自的有效区间，
 *    从结构上避免「值不等即矛盾」这类误报。
 *  - JSON 严格校验：模型输出不可靠，非法条目一律拒绝而不是猜。
 */

import type { AssertionKind, FactAssertion } from './assertion-model';

/** 拆解条目类型（决定用哪条配对规则） */
export const DECOMPOSE_TYPES = [
    'age',
    'location',
    'possession',
    'ability',
    'relationship',
    'timeline',
    'world-rule',
    'knowledge',
    'memory',
] as const;

/** 拆解条目类型 */
export type DecomposeType = typeof DECOMPOSE_TYPES[number];

/** 一条知识库条目 */
export interface DecomposeEntry {
    /** 类型 */
    type: DecomposeType;
    /** 主体（角色/物件/地点） */
    subject: string;
    /** 谓词 */
    predicate: string;
    /** 值（原样文本） */
    value: string;
    /** 数值（能解析时） */
    numeric?: number;
    /** 单位 */
    unit?: string;
    /** 生效章节 */
    validFrom: number;
    /** 失效章节（null = 仍有效） */
    validTo: number | null;
    /** 置信度 0–1 */
    confidence: number;
    /** 原文引文（必须有） */
    quote: string;
}

/** 拆解结果 */
export interface DecomposeResult {
    entries: DecomposeEntry[];
    /** 被拒绝的条目数（便于观察模型质量） */
    rejected: number;
}

/** 类型 → 断言类型映射 */
const TYPE_TO_KIND: Record<DecomposeType, AssertionKind> = {
    age: 'quantitative',
    location: 'geographical',
    possession: 'appearance',
    ability: 'skill-fluctuation',
    relationship: 'social-norm',
    timeline: 'absolute-time',
    'world-rule': 'core-rule',
    knowledge: 'knowledge',
    memory: 'memory',
};

/**
 * 构造拆解 prompt。
 *
 * @param chapterNum - 章节序号
 * @param body - 章节正文
 * @returns 完整 prompt
 */
export function buildDecomposePrompt(chapterNum: number, body: string): string {
    return [
        `你是小说设定抽取器。请从下面第 ${chapterNum} 章正文中抽取**可验证的事实条目**。`,
        '',
        '要求：',
        '1. 只抽正文中**明确写出**的事实，不要推测、不要补全。',
        '2. 每条必须给出原文引文 quote（必须是正文里的原句片段）。',
        '3. type 只能是以下之一：' + DECOMPOSE_TYPES.join(' / '),
        '4. 表示「从此章起生效」用 validFrom=' + chapterNum + '；若正文明确说某状态在此章结束，填 validTo。',
        '5. confidence 0–1，正文明确写出为 0.9 以上，需要推断的不超过 0.6。',
        '',
        '只输出 JSON，格式：',
        '{"entries":[{"type":"age","subject":"宁缺","predicate":"年龄","value":"十七","numeric":17,"unit":"岁","validFrom":' + chapterNum + ',"validTo":null,"confidence":0.95,"quote":"宁缺今年十七"}]}',
        '',
        '正文：',
        body,
    ].join('\n');
}

/**
 * 严格解析拆解结果。
 *
 * 拒绝规则（宁少不脏）：
 *  - 非 JSON / 缺 entries 数组 → 整体失败
 *  - 条目缺 subject/value/quote → 拒绝该条
 *  - type 不在白名单 → 拒绝该条
 *  - confidence 非 0–1 → 钳制到 [0,1] 而不是丢弃（模型常给 1.5 之类）
 *  - quote 不在正文中 → 拒绝该条（防止模型编造引文）
 *
 * @param raw - 模型原始输出
 * @param body - 章节正文（用于校验 quote 真实性）
 * @returns 解析结果；整体失败返回 null
 */
export function parseDecomposeResponse(raw: string, body: string): DecomposeResult | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    // 容忍 ```json 包裹与前后废话
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const rawEntries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(rawEntries)) return null;

    const normalizedBody = (body ?? '').replace(/\s+/g, '');
    const entries: DecomposeEntry[] = [];
    let rejected = 0;
    for (const item of rawEntries) {
        const entry = normalizeEntry(item, normalizedBody);
        if (entry) entries.push(entry);
        else rejected += 1;
    }
    return { entries, rejected };
}

/**
 * 规范化单条条目；不合法返回 null。
 *
 * @param item - 原始条目
 * @param normalizedBody - 去空白后的正文
 * @returns 合法条目或 null
 */
function normalizeEntry(item: unknown, normalizedBody: string): DecomposeEntry | null {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const type = String(raw.type ?? '').trim() as DecomposeType;
    if (!DECOMPOSE_TYPES.includes(type)) return null;
    const subject = String(raw.subject ?? '').trim();
    const value = String(raw.value ?? '').trim();
    const quote = String(raw.quote ?? '').trim();
    if (!subject || !value || !quote) return null;
    // quote 必须真实出现在正文里（防模型编造证据）
    if (normalizedBody && !normalizedBody.includes(quote.replace(/\s+/g, ''))) return null;
    const predicate = String(raw.predicate ?? '').trim() || '值';
    const confidence = clamp01(Number(raw.confidence ?? 0.5));
    const validFrom = Number.isFinite(Number(raw.validFrom)) ? Math.trunc(Number(raw.validFrom)) : 0;
    const validToRaw = raw.validTo;
    const validTo = validToRaw === null || validToRaw === undefined || validToRaw === ''
        ? null
        : (Number.isFinite(Number(validToRaw)) ? Math.trunc(Number(validToRaw)) : null);
    const entry: DecomposeEntry = { type, subject, predicate, value, validFrom, validTo, confidence, quote };
    if (Number.isFinite(Number(raw.numeric))) entry.numeric = Number(raw.numeric);
    if (typeof raw.unit === 'string' && raw.unit.trim()) entry.unit = raw.unit.trim();
    return entry;
}

/**
 * 置信度钳制到 [0,1]。
 *
 * @param value - 原值
 * @returns 0–1
 */
export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/**
 * 把拆解条目转成断言（供既有规则层消费）。
 *
 * @param entries - 条目
 * @param chapterKey - 章节 key
 * @param chapterNum - 章节序号
 * @param now - 时间戳
 * @returns 断言列表
 */
export function entriesToAssertions(
    entries: readonly DecomposeEntry[],
    chapterKey: string,
    chapterNum: number,
    now = 0,
): FactAssertion[] {
    return entries.map((entry, index) => {
        const kind = TYPE_TO_KIND[entry.type];
        const assertion: FactAssertion = {
            id: `kb|${kind}|${entry.subject}|${entry.predicate}|${chapterKey}|${index}`,
            kind,
            subject: entry.subject,
            predicate: entry.predicate,
            value: entry.value,
            chapterKey,
            chapterNum,
            quote: entry.quote,
            source: 'llm-decompose',
            extractedAt: now,
        };
        if (entry.numeric !== undefined) {
            assertion.numericValue = entry.numeric;
            if (entry.unit) assertion.unit = entry.unit;
        }
        return assertion;
    });
}

/**
 * 判断两个同主体同谓词的条目是否**有效区间冲突**（而非合法变化）。
 *
 * 合法变化：前一条 validTo 恰好是后一条 validFrom（或前一条已结束）→ 不冲突。
 *
 * @param a - 条目 A
 * @param b - 条目 B
 * @returns 是否真的冲突
 */
export function validRangesConflict(a: DecomposeEntry, b: DecomposeEntry): boolean {
    if (a.value === b.value) return false;
    const aEnd = a.validTo;
    const bEnd = b.validTo;
    // 两条都无终结点 → 两个互斥值同时有效 → 冲突
    if (aEnd === null && bEnd === null) return true;
    // A 在 B 开始前已结束 → 合法变化
    if (aEnd !== null && aEnd <= b.validFrom) return false;
    // B 在 A 开始前已结束 → 合法变化
    if (bEnd !== null && bEnd <= a.validFrom) return false;
    return true;
}

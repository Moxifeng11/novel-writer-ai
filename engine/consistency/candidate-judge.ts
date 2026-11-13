/**
 * candidate-judge.ts — 候选冲突的归一化与语义判定（C 臂阶段三）
 *
 * 背景（阶段二实测）：456 条拆解条目按「同主体+同谓词+有效区间」得到 165 处候选，
 * 抽检 12 条**全是误报**——「约摸十五六岁」vs「十五六岁」、「侍女」vs「小侍女」。
 * 根因：value 是自由文本，字符串比较在自然语言上必然失灵。
 *
 * 因此判定分两步，成本递增：
 *  1. **归一化**（免费）：数字区间化、关系同义词归一、谓词细化 → 压掉明显的同义表述；
 *  2. **语义判定**（付费，只对残余候选）：交 LLM 判「是否真的互斥」，严格 JSON + 双侧引文。
 *
 * 铁律：判定层只能**降级**候选（把误报压掉），不能凭空新增矛盾；
 * 模型说矛盾但没有给出理由/引文的，一律按"非矛盾"处理。
 */

/** 归一化后的值 */
export interface NormalizedValue {
    /** 归一化文本（用于比较） */
    key: string;
    /** 数值下界（区间型，如「十五六岁」→15） */
    low?: number;
    /** 数值上界 */
    high?: number;
    /** 单位 */
    unit?: string;
}

/** 中文数字表（够用即可；完整版在 shared/narrative-number） */
const CN_DIGITS: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/**
 * 解析中文/阿拉伯数字（含「十五」「二十」「十五六」这类区间）。
 *
 * @param text - 文本
 * @returns 数值或区间；无法解析返回 null
 */
export function parseNumericish(text: string): { low: number; high: number } | null {
    const s = (text ?? '').trim();
    if (!s) return null;
    // 阿拉伯数字区间：15-16 / 15~16
    const rangeAr = /^(\d+)\s*[-~—至到]\s*(\d+)$/.exec(s);
    if (rangeAr) return { low: Number(rangeAr[1]), high: Number(rangeAr[2]) };
    // 中文区间：十五六 / 十一二 / 七八
    const rangeCn = /^([零〇一二三四五六七八九两])([零〇一二三四五六七八九])$/.exec(s);
    if (rangeCn) {
        const tens = s.length === 2 && CN_DIGITS[rangeCn[1]] !== undefined ? null : null;
        void tens;
        // 形如「十五六」在下面统一处理，「七八」这类纯个位区间
        if (CN_DIGITS[rangeCn[1]] !== undefined && CN_DIGITS[rangeCn[2]] !== undefined) {
            const low = CN_DIGITS[rangeCn[1]];
            const high = CN_DIGITS[rangeCn[2]];
            if (high > low) return { low, high };
        }
    }
    // 十位中文区间：十五六 → 15..16
    const rangeTens = /^十([零〇一二三四五六七八九])([零〇一二三四五六七八九])?$/.exec(s);
    if (rangeTens) {
        const low = 10 + (CN_DIGITS[rangeTens[1]] ?? 0);
        const high = rangeTens[2] ? 10 + (CN_DIGITS[rangeTens[2]] ?? 0) : low;
        return { low: Math.min(low, high), high: Math.max(low, high) };
    }
    // 单个阿拉伯数字
    const singleAr = /^(\d+)$/.exec(s);
    if (singleAr) return { low: Number(singleAr[1]), high: Number(singleAr[1]) };
    // 单个中文数字
    if (CN_DIGITS[s] !== undefined) return { low: CN_DIGITS[s], high: CN_DIGITS[s] };
    // 「二十」「三十」这类
    const tensCn = /^([一二三四五六七八九])十([零〇一二三四五六七八九])?$/.exec(s);
    if (tensCn) {
        const value = (CN_DIGITS[tensCn[1]] ?? 0) * 10 + (tensCn[2] ? (CN_DIGITS[tensCn[2]] ?? 0) : 0);
        return { low: value, high: value };
    }
    return null;
}

/** 关系同义词归一（同一语义的不同说法） */
const RELATION_SYNONYMS: Array<[RegExp, string]> = [
    [/小?侍女|婢女|丫鬟|丫头/g, '侍女'],
    [/主人|主子/g, '主人'],
    [/师父|师尊/g, '师父'],
    [/徒弟|弟子/g, '弟子'],
    [/父亲|爹|父/g, '父亲'],
    [/母亲|娘|母/g, '母亲'],
];

/** 值里应剔除的模糊修饰词（不改变语义） */
const FUZZY_MODIFIERS = /(?:约摸|大约|大概|似乎|好像|将近|将将|差不多|不过|已经|仍然|依旧)/g;

/**
 * 归一化一个值，用于判断两条候选是否**真的**互斥。
 *
 * @param value - 原始值
 * @returns 归一化结果
 */
export function normalizeValue(value: string): NormalizedValue {
    let s = String(value ?? '').trim();
    // 去掉模糊修饰
    s = s.replace(FUZZY_MODIFIERS, '');
    // 剥单位后解析数字
    const unitMatch = /(\d+|[零〇一二三四五六七八九十两]+)\s*(岁|年|月|日|天|个|人|万|千|百)?/.exec(s);
    const num = parseNumericish((unitMatch?.[1] ?? '').trim());
    const unit = unitMatch?.[2];
    // 关系同义词归一
    let key = s;
    for (const [pattern, canonical] of RELATION_SYNONYMS) key = key.replace(pattern, canonical);
    // 去掉标点与空白，便于比较
    key = key.replace(/[\s，。、；：！？,.;:!?（）()「」『』"']/g, '');
    if (num) return { key, low: num.low, high: num.high, unit };
    return { key };
}

/**
 * 归一化后两条值是否仍可视为「同一事实」（同义表述）。
 *
 * 数字区间重叠 → 同义；归一化文本相同 → 同义。
 *
 * @param a - 值 A
 * @param b - 值 B
 * @returns 是否同义（同义则不需要再做语义判定）
 */
export function valuesLookEquivalent(a: string, b: string): boolean {
    const na = normalizeValue(a);
    const nb = normalizeValue(b);
    if (na.key === nb.key) return true;
    if (na.low !== undefined && nb.low !== undefined) {
        // 区间重叠即视为同一事实（「十五六岁」与「十五六岁」/「十六岁」）
        const low = Math.max(na.low, nb.low);
        const high = Math.min(na.high ?? na.low, nb.high ?? nb.low);
        if (low <= high) return true;
    }
    // 一方包含另一方（「宁缺的侍女」vs「宁缺的小侍女」→ 归一后相同）
    if (na.key && nb.key && (na.key.includes(nb.key) || nb.key.includes(na.key))) return true;
    return false;
}

/** 一个候选冲突（用于判定层） */
export interface ConflictCandidate {
    subject: string;
    predicate: string;
    type: string;
    valueA: string;
    chapterA: number;
    quoteA: string;
    valueB: string;
    chapterB: number;
    quoteB: string;
}

/**
 * 构造语义判定 prompt。
 *
 * @param candidates - 候选（批量给出，一次调用判多条以省 token）
 * @returns prompt
 */
export function buildJudgePrompt(candidates: readonly ConflictCandidate[]): string {
    const lines = [
        '你是小说设定一致性审核员。下面列出若干「疑似矛盾」，每条给出两处原文。',
        '',
        '判断每条是否**真的互斥**：',
        '- 若两处说的是同一事实的不同措辞（如「十五六岁」与「约摸十五六岁」）→ real=false',
        '- 若是同一角色的不同侧面/不同关系（如「户籍上是婢女」与「路边拣的丫头」）→ real=false',
        '- 若是合法变化（先弱后强、先在此处后迁走）→ real=false',
        '- 只有两处**无法同时成立**时才 → real=true',
        '',
        '只输出 JSON：{"verdicts":[{"index":0,"real":true,"reason":"两句话为何无法同时成立","confidence":0.9}]}',
        '',
        '候选：',
    ];
    candidates.forEach((c, i) => {
        lines.push(
            `[${i}] 主体=${c.subject} 属性=${c.predicate} 类型=${c.type}`,
            `  第${c.chapterA}章：「${c.quoteA}」`,
            `  第${c.chapterB}章：「${c.quoteB}」`,
        );
    });
    return lines.join('\n');
}

/** 判定结果 */
export interface JudgeVerdict {
    /** 候选序号 */
    index: number;
    /** 是否真矛盾 */
    real: boolean;
    /** 理由（real=true 必须有） */
    reason: string;
    /** 置信度 */
    confidence: number;
}

/**
 * 严格解析判定结果。
 *
 * 铁律：real=true 但 reason 为空或过短 → 降级为 false（不允许凭空判矛盾）。
 *
 * @param raw - 模型输出
 * @param count - 候选数量（用于校验 index 越界）
 * @returns 判定列表；整体失败返回 null
 */
export function parseJudgeVerdicts(raw: string, count: number): JudgeVerdict[] | null {
    const text = String(raw ?? '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    const list = (parsed as { verdicts?: unknown }).verdicts;
    if (!Array.isArray(list)) return null;
    const out: JudgeVerdict[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const index = Number(raw.index);
        if (!Number.isInteger(index) || index < 0 || index >= count) continue;
        const reason = String(raw.reason ?? '').trim();
        const confidence = Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0;
        // real=true 必须有可核对的理由（≥8 字），否则降级
        const real = raw.real === true && reason.length >= 8;
        out.push({ index, real, reason, confidence: Math.min(1, Math.max(0, confidence)) });
    }
    return out.length > 0 ? out : null;
}

/**
 * 先用归一化压掉同义候选，返回剩余需语义判定的候选。
 *
 * @param candidates - 全部候选
 * @returns 剩余候选（索引与含义保持不变）
 */
export function filterEquivalentCandidates(candidates: readonly ConflictCandidate[]): ConflictCandidate[] {
    return candidates.filter(c => !valuesLookEquivalent(c.valueA, c.valueB));
}

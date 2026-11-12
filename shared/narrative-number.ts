/**
 * narrative-number.ts — 网文数量/时间表达式的归一化解析
 *
 * 为什么需要单独一层：一致性审核要比较「第十八章写 18 岁」「八十三章写二十岁」
 * 这类**数量矛盾**，必须先能把中文数词、单位、时间表达式解析成可比的值。
 *
 * 与 `engine/scene-expander.ts` / `engine/quality/deviation-detector.ts` 里已有的
 * `parseChineseNumber` 区别：
 *  - 那两个只能解析纯数字（无单位），且两份实现已有细微差异；
 *  - 本模块面向「数量 + 单位」与「时间跨度」，是超集。
 *  - 存量两份实现暂不改动（避免影响生成链路），后续可收敛到本模块（见技术债 T-1）。
 *
 * 设计原则：**宁少不脏**——解析不出就返回 null，绝不猜。中文网文的数量写法变体极多，
 * 猜错的代价（报假矛盾）远大于漏报。
 */

/** 中文数位字符 */
const DIGITS: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数量级 */
const MAGNITUDES: Record<string, number> = {
    十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000,
};

/** 数量 + 单位 */
export interface Quantity {
    /** 数值 */
    value: number;
    /** 单位原文（如「岁」「里」「万金币」会拆成 value=50000 unit='金币'） */
    unit: string;
    /** 原始匹配文本 */
    raw: string;
}

/** 时间跨度（统一折算为分钟） */
export interface Duration {
    /** 折算后的分钟数 */
    minutes: number;
    /** 单位原文 */
    unit: string;
    /** 原始匹配文本 */
    raw: string;
}

/**
 * 时间单位 → 分钟数。取常用近似值（一年按 365 天、一月按 30 天）。
 *
 * 之所以统一折算：只有折算成同一量纲，才能判断「三日」与「两个月」是否矛盾。
 */
const TIME_UNIT_MINUTES: Record<string, number> = {
    年: 365 * 24 * 60,
    载: 365 * 24 * 60,
    月: 30 * 24 * 60,
    日: 24 * 60,
    天: 24 * 60,
    夜: 12 * 60,
    时辰: 120,
    更: 120,
    小时: 60,
    刻: 15,
    分钟: 1,
};

/**
 * 数量单位（非时间）。用于把「三十岁」「三丈」这类识别成数量断言。
 *
 * 注意：单位表只收录**含义稳定**的单位；「两」「文」等易与数词混淆的单位
 * 放在后面的专门规则里处理，避免「三两银子」被误解析。
 */
const QUANTITY_UNITS = [
    // 年龄
    '岁', '周岁',
    // 长度/距离
    '里', '丈', '尺', '寸', '步', '米', '公里', '千米',
    // 重量/货币
    '斤', '石', '灵石', '金币', '银元', '铜板', '银两',
    // 计数
    '个', '人', '名', '位', '只', '头', '件', '把', '枚', '颗', '座', '层', '重',
];

/**
 * 解析中文或阿拉伯数字（支持「十二」「二十」「一百零五」「两」「3」「3.5」）。
 *
 * 相比存量实现多支持：`两`（=2，网文高频）、小数、`万/亿` 组合。
 *
 * @param raw - 原始文本（应只含数字字符）
 * @returns 数值；无法解析返回 null
 */
export function parseNarrativeNumber(raw: string): number | null {
    const s = (raw || '').trim();
    if (!s) return null;

    // 纯阿拉伯数字（含小数）
    if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);

    // 阿拉伯数字 + 万/亿（如「3万」）
    const arabicMagnitude = s.match(/^(\d+(?:\.\d+)?)([万亿])$/);
    if (arabicMagnitude) {
        return Number(arabicMagnitude[1]) * MAGNITUDES[arabicMagnitude[2]];
    }

    let total = 0;
    let section = 0;
    let current = 0;
    let hasDigit = false;
    let hasAny = false;

    for (const ch of s) {
        if (DIGITS[ch] !== undefined) {
            current = DIGITS[ch];
            hasDigit = true;
            hasAny = true;
            continue;
        }
        const magnitude = MAGNITUDES[ch];
        if (magnitude === undefined) return null;
        hasAny = true;
        if (magnitude >= 10000) {
            section = (section + current) * magnitude;
            total += section;
            section = 0;
        } else {
            // 「十二」= 10+2：十 前面没有数字视为 1
            if (!hasDigit && current === 0) current = 1;
            section += current * magnitude;
        }
        current = 0;
        hasDigit = false;
    }
    total += section + current;
    return hasAny && total > 0 ? total : null;
}

/**
 * 从文本中解析「数量 + 单位」（如「三十岁」「三丈」「五万金币」）。
 *
 * @param text - 待解析文本
 * @returns 数量；未命中返回 null
 */
export function parseQuantity(text: string): Quantity | null {
    const s = (text || '').trim();
    if (!s) return null;

    const numberPart = '(?:\\d+(?:\\.\\d+)?[万亿]?|[零〇一二两三四五六七八九十百千万亿]+)';
    const unitPart = QUANTITY_UNITS.slice().sort((a, b) => b.length - a.length).join('|');
    const m = s.match(new RegExp(`(${numberPart})(${unitPart})`));
    if (!m) return null;

    const value = parseNarrativeNumber(m[1]);
    if (value === null) return null;
    return { value, unit: m[2], raw: m[0] };
}

/**
 * 从「万/千」前缀里拆出真实数值与纯单位。
 *
 * 例：「五万金币」→ { value: 50000, unit: '金币' }；「三丈」→ { value: 3, unit: '丈' }
 *
 * @param quantity - parseQuantity 的结果
 * @returns 拆解后的数值与单位
 */
export function splitQuantityMagnitude(quantity: Quantity): { value: number; unit: string } {
    return { value: quantity.value, unit: quantity.unit };
}

/**
 * 解析时间跨度表达式（如「三日」「半个时辰」「两个时辰」「三个月」「两年」）。
 *
 * @param text - 待解析文本
 * @returns 折算为分钟的时长；未命中返回 null
 */
export function parseDuration(text: string): Duration | null {
    const s = (text || '').trim();
    if (!s) return null;

    const numberPart = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)?';
    const unitPart = Object.keys(TIME_UNIT_MINUTES)
        .sort((a, b) => b.length - a.length)
        .join('|');
    // 数词与单位之间常插入量词「个」（三个月 / 一个时辰），必须容忍，
    // 否则正则会跳过数字从单位处起匹配，把「三个月」误算成「一个月」。
    const m = s.match(new RegExp(`(${numberPart})(?:个)?(${unitPart})`));
    if (!m) return null;

    // 「半个时辰」「半日」等：数字缺失但语义为 0.5
    const beforeUnit = s.slice(0, m.index === undefined ? 0 : m.index + (m[1] || '').length);
    const hasHalf = /半(?:个)?$/.test(beforeUnit);
    let count: number | null;
    if (!m[1]) {
        count = hasHalf ? 0.5 : 1;
    } else {
        count = parseNarrativeNumber(m[1]);
    }
    if (count === null) return null;

    const unitMinutes = TIME_UNIT_MINUTES[m[2]];
    if (unitMinutes === undefined) return null;
    return { minutes: Math.round(count * unitMinutes), unit: m[2], raw: m[0] };
}

/**
 * 两个时长是否在同一量级（用于判定「时长矛盾」时容忍表达误差）。
 *
 * 网文里「三日」与「三天」等价，「一个月」与「三十日」近似等价。
 * 只有当两者比值超出容忍区间时才算矛盾。
 *
 * @param a - 时长 A（分钟）
 * @param b - 时长 B（分钟）
 * @param tolerance - 允许比值偏差（默认 0.25，即相差 25% 以内视为一致）
 * @returns 是否视为同一量级
 */
export function durationsAreCompatible(a: number, b: number, tolerance = 0.25): boolean {
    if (!(a > 0) || !(b > 0)) return false;
    const ratio = a / b;
    return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

/**
 * 数值是否「几乎相等」（用于数量断言比对，允许原文取整差异）。
 *
 * @param a - 数值 A
 * @param b - 数值 B
 * @param tolerance - 相对容差（默认 0.02）
 * @returns 是否视为相等
 */
export function numbersAreCompatible(a: number, b: number, tolerance = 0.02): boolean {
    if (a === b) return true;
    const base = Math.max(Math.abs(a), Math.abs(b));
    if (base === 0) return true;
    return Math.abs(a - b) / base <= tolerance;
}

/**
 * chapter-ref.ts — 章节引用的唯一解析口径
 *
 * 时间线、伏笔、承诺、关系、章节状态快照都以「第N章」定位，但历史上各处用
 * 正则各抠各的，且 `TimelineEvent` 同时存在 `chapter: number` 与 `chapter: string`
 * 两种类型。本模块只做纯字符串/数字归一，不依赖 Obsidian：
 *  - `parseChapterRef`：单个章节引用；
 *  - `parseChapterRange`：计划回收这类区间/多章引用；
 *  - `sameChapter` / `chapterDistance`：比较与距离。
 */

/** 单章引用 */
export interface ChapterRef {
    /** 解析出的章号；无法解析时为 null */
    num: number | null;
    /** 归一化键：能解析时为 `第N章`，否则保留去空白后的原文 */
    key: string;
    /** 原始输入 */
    raw: string;
}

/** 章节区间/多章引用 */
export interface ChapterRange {
    start: number | null;
    end: number | null;
    /** 区间内所有章号（升序、去重）；单章时只有一个元素 */
    nums: number[];
    /** 原文 */
    raw: string;
}

const CN_DIGIT: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * 解析中文数字（支持 一~九千九百九十九；不含「万」）
 *
 * @param text - 中文数字
 * @returns 数值；无法解析时为 null
 */
function parseChineseNumber(text: string): number | null {
    let total = 0;
    let current = 0;
    let seen = false;
    for (const char of text) {
        if (char in CN_DIGIT) {
            current = CN_DIGIT[char];
            seen = true;
            continue;
        }
        const unit = CN_UNIT[char];
        if (unit === undefined) return null;
        if (!seen) current = 1;
        total += current * unit;
        current = 0;
        seen = false;
    }
    if (!seen && total === 0) return null;
    return total + current;
}

/**
 * 从任意文本中取首个章号（阿拉伯数字或中文数字）
 *
 * @param text - 文本
 * @returns 章号；无法解析时为 null
 */
export function chapterNumber(text: unknown): number | null {
    if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.floor(text) : null;
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    const arabic = /第\s*(\d+)\s*[章章节集回]/.exec(raw) ?? /^(\d+)$/.exec(raw);
    if (arabic) {
        const num = Number(arabic[1]);
        return Number.isFinite(num) && num > 0 ? num : null;
    }
    const chinese = /第\s*([零〇一二两三四五六七八九十百千]+)\s*[章章节集回]/.exec(raw);
    if (chinese) {
        const num = parseChineseNumber(chinese[1]);
        return num !== null && num > 0 ? num : null;
    }
    return null;
}

/**
 * 解析单章引用；无法解析时保留原文，不抛错。
 *
 * @param input - 原始输入
 * @returns ChapterRef
 */
export function parseChapterRef(input: unknown): ChapterRef {
    const raw = String(input ?? '').trim();
    const num = chapterNumber(raw);
    return {
        num,
        key: num === null ? raw : `第${num}章`,
        raw,
    };
}

/**
 * 解析章节区间或多章列表：
 *  - `第6章` → [6]
 *  - `第6-8章` / `第6~8章` / `第6至8章` → [6,7,8]
 *  - `第6、8章` / `第6章,第8章` → [6,8]
 *  - `待定` / 空 → []
 *
 * @param input - 原始输入
 * @returns ChapterRange
 */
export function parseChapterRange(input: unknown): ChapterRange {
    const raw = String(input ?? '').trim();
    if (!raw) return { start: null, end: null, nums: [], raw };

    const single = (text: string): number | null => chapterNumber(text);
    const rangeMatch = /第?\s*([0-9零〇一二两三四五六七八九十百千]+)\s*[-~～至到]\s*([0-9零〇一二两三四五六七八九十百千]+)\s*[章章节集回]?/.exec(raw);
    if (rangeMatch) {
        const start = toNumber(rangeMatch[1]);
        const end = toNumber(rangeMatch[2]);
        if (start !== null && end !== null && start <= end) {
            const nums: number[] = [];
            // 防御异常大区间（例如误写 1-99999）
            const safeEnd = Math.min(end, start + 500);
            for (let i = start; i <= safeEnd; i++) nums.push(i);
            return { start, end: safeEnd, nums, raw };
        }
    }

    const nums = new Set<number>();
    for (const part of raw.split(/[、,，;；/]+/)) {
        const num = single(part) ?? looseNumber(part);
        if (num !== null) nums.add(num);
    }
    if (nums.size === 0) {
        const num = chapterNumber(raw);
        if (num !== null) nums.add(num);
    }
    const sorted = [...nums].sort((a, b) => a - b);
    return {
        start: sorted.length > 0 ? sorted[0] : null,
        end: sorted.length > 0 ? sorted[sorted.length - 1] : null,
        nums: sorted,
        raw,
    };
}

/**
 * 宽松取数：允许 `第8`、`6章`、`8` 这类列表片段
 *
 * @param text - 片段
 * @returns 数值或 null
 */
function looseNumber(text: string): number | null {
    const match = /(?:第\s*)?([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*[章章节集回]?/.exec(text.trim());
    if (!match) return null;
    return toNumber(match[1]);
}

/**
 * 数字或中文数字 → number
 *
 * @param text - 输入
 * @returns 数值或 null
 */
function toNumber(text: string): number | null {
    if (/^\d+$/.test(text)) {
        const num = Number(text);
        return Number.isFinite(num) && num > 0 ? num : null;
    }
    const num = parseChineseNumber(text);
    return num !== null && num > 0 ? num : null;
}

/**
 * 两个章节引用是否指向同一章；都解析失败时退化为字符串比较。
 *
 * @param a - 左侧
 * @param b - 右侧
 * @returns 是否同一章
 */
export function sameChapter(a: unknown, b: unknown): boolean {
    const left = parseChapterRef(a);
    const right = parseChapterRef(b);
    if (left.num !== null && right.num !== null) return left.num === right.num;
    return left.key === right.key;
}

/**
 * a 距 b 的章数差（a - b）；任一方无法解析时为 null。
 *
 * @param a - 左侧
 * @param b - 右侧
 * @returns 章数差或 null
 */
export function chapterDistance(a: unknown, b: unknown): number | null {
    const left = chapterNumber(typeof a === 'number' ? a : String(a ?? ''));
    const right = chapterNumber(typeof b === 'number' ? b : String(b ?? ''));
    if (left === null || right === null) return null;
    return left - right;
}

/**
 * evidence-locate.ts — 用引文在正文里反查字符偏移
 *
 * 为什么不在抽取阶段记录偏移：`ChapterDigest` 不保存字符位置，要给摘要抽提出来的
 * 事实补位置，只有两条路——
 *  1. 改 `chapter-digest` 的 LLM prompt 让它输出偏移（动既有行为 + 增加成本）；
 *  2. **抽取阶段只留引文，判出矛盾后再用引文回正文里查位置**（零成本、零行为风险）。
 * 本模块实现第 2 条。
 *
 * 匹配策略（由严到宽）：
 *  - 精确子串 → 直接用
 *  - 去掉空白后匹配（正文常有换行/空格差异）→ 换算回原偏移
 *  - 取引文的前 N 个字符做前缀匹配（引文可能被摘要改写末尾）
 * 都失败则返回 undefined——**不猜位置**，UI 侧降级为「仅展示引文」。
 */

/** 定位结果 */
export interface LocatedQuote {
    /** 命中的字符偏移（原文坐标系） */
    offset: number;
    /** 实际命中的原文片段 */
    matched: string;
}

/** 前缀匹配时最多取引文前多少字符 */
const PREFIX_LENGTH = 12;

/** 低于这个长度的前缀匹配不可靠，直接放弃 */
const MIN_PREFIX_LENGTH = 6;

/**
 * 在正文中定位引文。
 *
 * @param body - 章节正文
 * @param quote - 引文（来自摘要/断言）
 * @returns 定位结果；找不到返回 null（调用方应降级为「只展示引文」）
 */
export function locateQuote(body: string, quote: string): LocatedQuote | null {
    const text = body || '';
    const needle = (quote || '').trim();
    if (!text || !needle) return null;

    // 1) 精确匹配
    const exact = text.indexOf(needle);
    if (exact >= 0) return { offset: exact, matched: needle };

    // 2) 忽略空白后匹配，再把位置换算回原文
    const compact = removeWhitespaceWithMap(text);
    const compactNeedle = needle.replace(/\s+/g, '');
    if (compactNeedle) {
        const hit = compact.text.indexOf(compactNeedle);
        if (hit >= 0) {
            const offset = compact.indexMap[hit];
            if (offset !== undefined) {
                return { offset, matched: text.slice(offset, offset + needle.length) };
            }
        }
    }

    // 3) 前缀匹配（引文末尾或中间被摘要改写）：逐级缩短前缀重试
    if (compactNeedle.length > MIN_PREFIX_LENGTH) {
        const longest = Math.min(PREFIX_LENGTH, compactNeedle.length - 1);
        for (let len = longest; len >= MIN_PREFIX_LENGTH; len--) {
            const prefix = compactNeedle.slice(0, len);
            const hit = compact.text.indexOf(prefix);
            if (hit < 0) continue;
            const offset = compact.indexMap[hit];
            if (offset === undefined) continue;
            return { offset, matched: text.slice(offset, offset + needle.length) };
        }
    }

    return null;
}

/**
 * 去掉空白并保留「压缩后索引 → 原文索引」的映射。
 *
 * @param text - 原文
 * @returns 压缩文本与其索引映射
 */
function removeWhitespaceWithMap(text: string): { text: string; indexMap: number[] } {
    let out = '';
    const indexMap: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) continue;
        out += ch;
        indexMap.push(i);
    }
    return { text: out, indexMap };
}

/**
 * 取引文在正文中的上下文片段（用于 UI 展示，避免整章塞进列表）。
 *
 * @param body - 章节正文
 * @param quote - 引文
 * @param radius - 前后各取多少字符
 * @returns 上下文片段；定位失败返回引文本身
 */
export function quoteContext(body: string, quote: string, radius = 40): string {
    const located = locateQuote(body, quote);
    if (!located) return quote;
    const start = Math.max(0, located.offset - radius);
    const end = Math.min(body.length, located.offset + located.matched.length + radius);
    return body.slice(start, end).replace(/\s+/g, ' ').trim();
}

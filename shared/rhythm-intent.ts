/**
 * 从规划文本解析「预期节奏」。
 *
 * 监控的节奏偏离检测只有在 `DeviationContext.expectedRhythm` 存在时才会工作
 * （`deviation-detector#detectRhythm` 无期望值直接返回空）。此前没有任何生产调用方
 * 提供该字段，导致「节奏偏离」长期恒空。
 *
 * 这里只做**显式标注**解析，绝不从「战斗 / 爽点 / 日常」等语义猜测节奏：
 * 没有标注就返回 `undefined`（宁可不报，也不误报）。
 */

export type ExpectedRhythm = 'fast' | 'medium' | 'slow';

const LABELED = /节奏[*_`]*\s*[:：=]\s*[*_`\s]*(中等|快|中|慢|平缓|舒缓|紧凑)/;
const FAST_PHRASE = /(快节奏|节奏(?:偏|较|很)?快|节奏紧凑|高速推进)/;
const SLOW_PHRASE = /(慢节奏|节奏(?:偏|较|很)?慢|节奏(?:平缓|舒缓)|慢热)/;
const MEDIUM_PHRASE = /(中等节奏|中速节奏|节奏(?:适中|平稳))/;

function normalizeLabel(label: string): ExpectedRhythm {
    if (label === '快' || label === '紧凑') return 'fast';
    if (label === '慢' || label === '平缓' || label === '舒缓') return 'slow';
    return 'medium';
}

/**
 * 从规划文本中解析预期节奏。
 *
 * @param texts 规划文本（大纲摘要 / 情绪规划 / chapPlan 等），按顺序扫描
 * @returns 明确的预期节奏；无标注或标注互相矛盾时返回 undefined
 */
export function parseExpectedRhythm(...texts: Array<string | undefined | null>): ExpectedRhythm | undefined {
    const joined = texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).join('\n');
    if (!joined) return undefined;

    const labeled = joined.match(LABELED);
    if (labeled) return normalizeLabel(labeled[1]);

    const fast = FAST_PHRASE.test(joined);
    const slow = SLOW_PHRASE.test(joined);
    // 同时出现「快节奏」「慢节奏」说明规划里对不同场景有不同要求：
    // 单值字段表达不了，交给正文分场景判断反而更准，这里直接放弃。
    if (fast && slow) return undefined;
    if (fast) return 'fast';
    if (slow) return 'slow';
    if (MEDIUM_PHRASE.test(joined)) return 'medium';
    return undefined;
}

/**
 * semantic-keywords.ts — A 类「语义判定」词表的统一注册表
 *
 * 为什么需要（2026-11-13 关键词审查结论）：
 * 这些词表用于**判断文本含义**（伤情/剧变/时代错位），输入是自由文本，
 * 天然覆盖不全——这是引擎里最难根治的一类匹配。
 *
 * 本模块不试图"消灭"词表，而是把它们集中管理，并明确两件事：
 *  1. **兜底语义**：词表只在结构化字段缺失时使用；规则应优先读结构化状态
 *  2. **可扩展**：允许调用方（或未来设置项）追加词，避免用户改代码
 *
 * 判定顺序（规则层必须遵守）：
 *   结构化字段（人物状态快照/事实库） → 词表兜底 → 不判定
 */

/** 词表来源标记：写入告警详情，让用户知道"这是词表兜底命中的" */
export const KEYWORD_FALLBACK_SOURCE = '词表兜底';

/** 人物状态剧变分组（无依据检测用） */
export const DRASTIC_CHANGE_GROUPS: ReadonlyArray<{ group: string; words: readonly string[] }> = [
    { group: '死亡', words: ['死了', '身亡', '陨落', '丧命', '气绝'] },
    { group: '重伤', words: ['重伤', '断臂', '重伤垂危'] },
    { group: '能力变化', words: ['突破', '晋升', '进阶', '顿悟'] },
];

/** 伤情词（与行动词同现时提示"重伤后仍高强行动"） */
export const INJURY_WORDS: readonly string[] = [
    '重伤', '昏迷', '断骨', '吐血', '濒死', '气绝', '动弹不得',
];

/** 高强行动词 */
export const ACTION_WORDS: readonly string[] = [
    '飞奔', '狂奔', '纵身', '挥剑', '厮杀', '追上', '跃起', '冲出',
];

/** 现代词（时代错位检测；应优先用项目世界观设定判断） */
export const MODERN_WORDS: readonly string[] = [
    '手机', '电脑', '网络', '电梯', '汽车', '飞机', '微信', '短信', '摄像头',
];

/** 场景/地点词（用于判断"是否有场景锚点"） */
export const LOCATION_WORDS: readonly string[] = [
    '京城', '山门', '客栈', '皇宫', '战场', '密室', '山洞', '街道', '城门', '院子', '大殿',
];

/**
 * 合并词表与用户扩展词（去重，保持原顺序）。
 *
 * 用于把设置里配置的额外词并入内置词表——用户不必改代码即可覆盖新说法。
 *
 * @param base - 内置词表
 * @param extra - 扩展词表（可为空）
 * @returns 合并后的词表
 */
export function mergeKeywordOverrides(
    base: readonly string[],
    extra: readonly string[] | undefined,
): string[] {
    const merged = [...base];
    for (const word of extra ?? []) {
        const trimmed = (word ?? '').trim();
        if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
    }
    return merged;
}

/**
 * 在一段文本里找出命中的词（用于告警详情，让用户看到命中了哪个词）。
 *
 * @param text - 待检查文本
 * @param words - 词表
 * @returns 命中的词（可能为空）
 */
export function findKeywordHits(text: string, words: readonly string[]): string[] {
    if (!text) return [];
    return words.filter(word => word && text.includes(word));
}

/** 用户在设置里追加的词（按类别） */
export interface SemanticKeywordOverrides {
    /** 追加的伤情词 */
    injury?: readonly string[];
    /** 追加的行动词 */
    action?: readonly string[];
    /** 追加的现代词 */
    modern?: readonly string[];
    /** 追加的地点词 */
    location?: readonly string[];
    /** 追加的剧变词（不分组的兜底追加） */
    drastic?: readonly string[];
}

/** 解析后的词表（内置 + 用户追加） */
export interface ResolvedSemanticKeywords {
    injury: string[];
    action: string[];
    modern: string[];
    location: string[];
    drasticGroups: Array<{ group: string; words: string[] }>;
}

/**
 * 把用户追加词并入内置词表。
 *
 * 这是 C 类「统计/风格词表可配置化」与 A 类「词表兜底」的共同入口：
 * 用户发现某个说法没被识别时，不必改代码，在设置里加词即可。
 *
 * @param overrides - 用户追加词（可空）
 * @returns 合并后的词表
 */
export function resolveSemanticKeywords(overrides?: SemanticKeywordOverrides): ResolvedSemanticKeywords {
    const extra = overrides?.drastic;
    return {
        injury: mergeKeywordOverrides(INJURY_WORDS, overrides?.injury),
        action: mergeKeywordOverrides(ACTION_WORDS, overrides?.action),
        modern: mergeKeywordOverrides(MODERN_WORDS, overrides?.modern),
        location: mergeKeywordOverrides(LOCATION_WORDS, overrides?.location),
        drasticGroups: DRASTIC_CHANGE_GROUPS.map(group => ({
            group: group.group,
            words: mergeKeywordOverrides(group.words, extra),
        })),
    };
}

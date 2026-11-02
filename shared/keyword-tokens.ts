/**
 * 轻量关键词分词：英文/数字按词、中文按 2-gram。
 *
 * 用于向量检索后的关键词重排。不引入分词依赖，保证指纹库与知识库
 * 在任何运行环境（含移动端）都能用同一套规则，且结果稳定可测试。
 * @param text - 文本内容
 * @param limit - 上限
 * @returns 结果数组
 */
export function extractKeywordTokens(text: string, limit = 80): string[] {
    const normalized = String(text || '').toLowerCase();
    const tokens = new Set<string>();
    for (const word of normalized.match(/[a-z0-9]{2,}/g) || []) tokens.add(word);
    const cjk = normalized.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i + 1 < cjk.length; i++) tokens.add(cjk.slice(i, i + 2));
    return [...tokens].slice(0, limit);
}

/**
 * 查询词在样本文本中的命中比例，上限 1。
 *
 * @param tokens - token 列表
 * @param sample - 样本
 * @returns 数值结果
 */
export function keywordOverlapRatio(tokens: string[], sample: string): number {
    if (tokens.length === 0) return 0;
    const haystack = String(sample || '').toLowerCase();
    if (!haystack) return 0;
    const hits = tokens.filter(token => haystack.includes(token)).length;
    return Math.min(1, hits / tokens.length);
}

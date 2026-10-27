/**
 * canon-source.ts — 同人考据来源分级与过滤（纯函数）
 *
 * 目标：同人设定只能依据原著/官方资料，不参考同人、改编、外传等衍生作品。
 * 这里不发起网络请求，只负责把 URL/标题/手工标注变成可审计的来源层级。
 */

export type CanonSourceTier = 'official' | 'official-wiki' | 'reference' | 'derivative' | 'unknown';

export interface CanonSource {
    id: string;
    url: string;
    title: string;
    domain: string;
    tier: CanonSourceTier;
    fetchedAt: number;
    /** 审计所需短摘录；不存整本原文 */
    excerpt: string;
    excerptHash: string;
    /** 被设定正文引用的次数，由审核阶段回填 */
    citationCount?: number;
}

export interface CanonSourceInput {
    url: string;
    title?: string;
    excerpt?: string;
    tier?: CanonSourceTier;
    fetchedAt?: number;
    id?: string;
}

export const CANON_TIER_LABEL: Record<CanonSourceTier, string> = {
    official: '官方原著',
    'official-wiki': '官方 Wiki',
    reference: '参考资料',
    derivative: '衍生作品',
    unknown: '未确认来源',
};

/** 只允许这些层级作为设定事实依据 */
export const AUTHORITATIVE_TIERS: ReadonlySet<CanonSourceTier> = new Set(['official', 'official-wiki']);

const DERIVATIVE_RE = /(同人|fan\s*fiction|fanfic|ao3|lofter|衍生|改编|动画|电视剧|影视|电影|游戏|漫画|续写|外传|二次创作|同人文|同人小说|fandom)/i;
const OFFICIAL_HOST_RE = /(^|\.)(qidian\.com|fanqienovel\.com|zongheng\.com|jjwxc\.net|17k\.com|ciweimao\.com|sfacg\.com|chineseall\.com)$/i;
const REFERENCE_HOST_RE = /(^|\.)(wikipedia\.org|baike\.baidu\.com|zhihu\.com)$/i;
const OFFICIAL_HINT_RE = /(官方|原著|作者|出版社|设定集|official|author|publisher)/i;
const OFFICIAL_WIKI_RE = /(官方\s*wiki|official\s*wiki|官方资料站)/i;

export function normalizeSourceUrl(raw: string): string | null {
    const value = (raw || '').trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

export function sourceDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

/** 识别来源层级；衍生作品优先级最高，避免手工误标成 official。 */
export function classifyCanonSource(input: Pick<CanonSourceInput, 'url' | 'title' | 'tier'>): CanonSourceTier {
    const url = normalizeSourceUrl(input.url) || input.url || '';
    const title = (input.title || '').trim();
    const domain = sourceDomain(url);
    const haystack = `${url}\n${title}`;

    if (DERIVATIVE_RE.test(haystack)) return 'derivative';
    if (input.tier && input.tier !== 'unknown') return input.tier;
    if (OFFICIAL_WIKI_RE.test(haystack)) return 'official-wiki';
    if (OFFICIAL_HOST_RE.test(domain) || OFFICIAL_HINT_RE.test(title)) return 'official';
    if (REFERENCE_HOST_RE.test(domain)) return 'reference';
    return 'unknown';
}

export function isAuthoritativeSource(tier: CanonSourceTier): boolean {
    return AUTHORITATIVE_TIERS.has(tier);
}

export function createCanonSource(input: CanonSourceInput, index: number): CanonSource {
    const url = normalizeSourceUrl(input.url) || input.url || '';
    const excerpt = (input.excerpt || '').trim();
    return {
        id: input.id || `S${index + 1}`,
        url,
        title: (input.title || '').trim() || url || `来源 ${index + 1}`,
        domain: sourceDomain(url),
        tier: classifyCanonSource({ url, title: input.title, tier: input.tier }),
        fetchedAt: input.fetchedAt ?? Date.now(),
        excerpt,
        excerptHash: hashText(excerpt),
        citationCount: 0,
    };
}

export function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 来源集合哈希：用于审核通过后检测文件/来源是否被修改。 */
export function computeCanonSourceHash(sources: CanonSource[]): string {
    const stable = [...sources]
        .sort((a, b) => `${a.id}|${a.url}`.localeCompare(`${b.id}|${b.url}`))
        .map(s => `${s.id}|${s.url}|${s.tier}|${s.excerptHash}`)
        .join('\n');
    return hashText(stable);
}

export interface CanonSourceValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
    authoritative: CanonSource[];
    excluded: CanonSource[];
}

/** 生成前的来源闸门：没有官方来源就不允许让模型补内容。 */
export function validateCanonSources(sources: CanonSource[]): CanonSourceValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const authoritative = sources.filter(s => isAuthoritativeSource(s.tier) && s.excerpt.trim().length > 0);
    const excluded = sources.filter(s => !isAuthoritativeSource(s.tier));
    const derivative = sources.filter(s => s.tier === 'derivative');
    const empty = sources.filter(s => !s.excerpt.trim());

    if (sources.length === 0) errors.push('尚未检索或导入任何原作来源');
    if (authoritative.length === 0) errors.push('没有可用的官方原著来源；不能凭模型记忆生成设定内容');
    if (derivative.length > 0) warnings.push(`已排除 ${derivative.length} 条衍生作品来源`);
    if (empty.length > 0) warnings.push(`${empty.length} 条来源没有可用摘录，已跳过`);
    if (authoritative.length > 0 && authoritative.length < 2) {
        warnings.push('官方来源少于 2 条，关键字段可能无法交叉验证');
    }
    return { valid: errors.length === 0, errors, warnings, authoritative, excluded };
}

/** 只把官方来源送进生成 prompt；参考资料/衍生作品一律不送。 */
export function selectAuthoritativeSources(sources: CanonSource[]): CanonSource[] {
    return sources.filter(s => isAuthoritativeSource(s.tier) && s.excerpt.trim().length > 0);
}

export function formatCanonSourcesForPrompt(sources: CanonSource[], maxChars = 12000): string {
    const selected = selectAuthoritativeSources(sources);
    if (selected.length === 0) return '（没有可用的官方原著来源；所有字段必须写“待核实（未找到可靠原作来源）”）';
    let used = 0;
    const lines: string[] = [];
    for (const source of selected) {
        const excerpt = source.excerpt.trim();
        const budget = Math.max(0, Math.min(excerpt.length, maxChars - used));
        if (budget <= 0) break;
        const text = excerpt.slice(0, budget);
        lines.push(`[${source.id}] ${source.title}\n来源：${source.url}\n摘录：${text}`);
        used += text.length;
    }
    return lines.join('\n\n');
}

export function extractCitationIds(text: string): string[] {
    const ids = new Set<string>();
    for (const match of text.matchAll(/\[(S\d+)\]/g)) ids.add(match[1]);
    return [...ids];
}

/** 引用覆盖率：有来源标注的字段比例，用于人工审核摘要。 */
export function citationCoverage(text: string, sources: CanonSource[]): number {
    const validIds = new Set(sources.map(s => s.id));
    const cited = extractCitationIds(text).filter(id => validIds.has(id));
    const placeholders = (text.match(/待核实/g) || []).length;
    const fields = (text.match(/^-\s+\*\*/gm) || []).length + (text.match(/^\|\s*[^|]+\s*\|/gm) || []).length;
    if (fields === 0) return 0;
    const denominator = Math.max(1, fields - placeholders);
    return Math.min(100, Math.round((cited.length / denominator) * 100));
} 

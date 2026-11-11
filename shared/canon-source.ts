/**
 * canon-source.ts — 同人考据来源分级与过滤（纯函数）
 *
 * 目标：同人设定只能依据原著/官方资料，不参考同人、改编、外传等衍生作品。
 * 这里不发起网络请求，只负责把 URL/标题/手工标注变成可审计的来源层级。
 */
import { wrapUntrustedContent } from './untrusted-content';


/**
 * 考据来源等级。
 */
export type CanonSourceTier = 'official' | 'official-wiki' | 'reference' | 'derivative' | 'unknown';

/**
 * 考据来源。
 */
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

/**
 * 来源输入。
 */
export interface CanonSourceInput {
    url: string;
    title?: string;
    excerpt?: string;
    tier?: CanonSourceTier;
    fetchedAt?: number;
    id?: string;
}

/**
 * 等级中文名。
 */
export const CANON_TIER_LABEL: Record<CanonSourceTier, string> = {
    official: '官方原著',
    'official-wiki': '官方 Wiki',
    reference: '参考资料',
    derivative: '衍生作品',
    unknown: '未确认来源',
};

/** 查询串里常见的敏感键：值一律脱敏，避免 token 进入 prompt/缓存/审核记录（S3-11） */
const SENSITIVE_QUERY_KEY = /^(token|access_?token|api_?key|key|secret|password|sig|signature|auth)$/i;

/** 只允许这些层级作为设定事实依据 */
export const AUTHORITATIVE_TIERS: ReadonlySet<CanonSourceTier> = new Set(['official', 'official-wiki']);

/**
 * 可作「次要参考」的层级。
 *
 * FAN-2（v4.83.1）：`official` 收紧后（S3-3 只认发行人域名），同人创作最依赖的
 * wiki/百科全被丢弃，`formatCanonSourcesForPrompt` 于是返回「没有可用的官方原著来源」，
 * 模型只能写「待核实」——这是「同人设定补充不了」的直接原因。
 *
 * 处理方式：**官方仍然优先**；没有官方时允许 `reference` 作为**明确标注的二手参考**
 * 进入 prompt（围栏 + 等级标注 + 冲突时以官方为准）。`derivative`（同人/衍生/改编）
 * **始终排除**——衍生作品不能作为原著设定来源。
 */
export const REFERENCE_TIERS: ReadonlySet<CanonSourceTier> = new Set(['reference']);

const DERIVATIVE_RE = /(同人|fan\s*fiction|fanfic|ao3|lofter|衍生|改编|动画|电视剧|影视|电影|游戏|漫画|续写|外传|二次创作|同人文|同人小说|fandom)/i;
const OFFICIAL_HOST_RE = /(^|\.)(qidian\.com|fanqienovel\.com|zongheng\.com|jjwxc\.net|17k\.com|ciweimao\.com|sfacg\.com|chineseall\.com)$/i;
/** 二手资料站：百科与社区设定库（**不是**衍生作品站，故与 derivative 区分） */
const REFERENCE_HOST_RE = /(^|\.)(wikipedia\.org|baike\.baidu\.com|zhihu\.com|moegirl\.org\.cn|bangumi\.tv|bgm\.tv|zhihu\.com)$/i;
const OFFICIAL_WIKI_RE = /(官方\s*wiki|official\s*wiki|官方资料站)/i;

/**
 * 规范化来源 URL。
 *
 * @param raw - 原始值
 * @returns URL 或 null
 */
export function normalizeSourceUrl(raw: string): string | null {
    const value = (raw || '').trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        // S3-11（安全 r3）：URL 内嵌凭据/签名参数会被写进 system prompt、来源缓存
        // 与审核记录；这里直接剥离 userinfo，并把敏感 query 值脱敏。
        url.username = '';
        url.password = '';
        for (const key of [...url.searchParams.keys()]) {
            if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, 'REDACTED');
        }
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

/**
 * 取来源域名。
 *
 * @param url - 地址
 * @returns 域名
 */
export function sourceDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

/**
 * 识别来源层级；衍生作品优先级最高，避免手工误标成 official。
 *
 * @param input - 输入
  * @returns CanonSourceTier 实例
 */
export function classifyCanonSource(input: Pick<CanonSourceInput, 'url' | 'title' | 'tier'>): CanonSourceTier {
    const url = normalizeSourceUrl(input.url) || input.url || '';
    const title = (input.title || '').trim();
    const domain = sourceDomain(url);
    const haystack = `${url}\n${title}`;

    if (DERIVATIVE_RE.test(haystack)) return 'derivative';
    // S3-3（安全 r3）：标题里的「官方/原著/official」不能授予权威等级——
    // 任意域名都可以在标题里写这些词；official 只认发行人域名白名单。
    if (OFFICIAL_WIKI_RE.test(haystack)) return 'official-wiki';
    if (OFFICIAL_HOST_RE.test(domain)) return 'official';
    if (REFERENCE_HOST_RE.test(domain)) return 'reference';
    return 'unknown';
}

/**
 * 是否权威来源。
 *
 * @param tier - 层级
 * @returns 布尔值
 */
export function isAuthoritativeSource(tier: CanonSourceTier): boolean {
    return AUTHORITATIVE_TIERS.has(tier);
}

/**
 * 创建来源记录。
 *
 * @param input - 输入
 * @param index - 索引
 * @returns 来源
 */
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

/**
 * 计算文本哈希。
 *
 * @param text - 文本内容
 * @returns 哈希
 */
export function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 来源集合哈希：用于审核通过后检测文件/来源是否被修改。
 *
 * @param sources - 来源列表
 * @returns 文本结果
 */
export function computeCanonSourceHash(sources: CanonSource[]): string {
    const stable = [...sources]
        .sort((a, b) => `${a.id}|${a.url}`.localeCompare(`${b.id}|${b.url}`))
        .map(s => `${s.id}|${s.url}|${s.tier}|${s.excerptHash}`)
        .join('\n');
    return hashText(stable);
}

/**
 * 来源校验结果。
 */
export interface CanonSourceValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
    authoritative: CanonSource[];
    excluded: CanonSource[];
}

/**
 * 生成前的来源闸门：没有官方来源就不允许让模型补内容。
 *
 * @param sources - 来源列表
  * @returns CanonSourceValidation 实例
 */
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

/**
 * 只把官方来源送进生成 prompt；参考资料/衍生作品一律不送。
 *
 * @param sources - 来源列表
 * @returns 结果数组
 */
export function selectAuthoritativeSources(sources: CanonSource[]): CanonSource[] {
    return sources.filter(s => isAuthoritativeSource(s.tier) && s.excerpt.trim().length > 0);
}

/**
 * 是否为可作次要参考的来源（`reference`，非官方二手资料）。
 *
 * @param tier - 层级
 * @returns 布尔值
 */
export function isReferenceSource(tier: CanonSourceTier): boolean {
    return REFERENCE_TIERS.has(tier);
}

/**
 * 按「官方优先、二手补充、衍生排除」挑选可用于 prompt 的来源。
 *
 * - 有官方来源时：只用官方（二手不参与，避免稀释权威性）
 * - 无官方来源时：回落到 `reference` 二手资料，由 prompt 显式标注等级
 * - `derivative` / `unknown` **永不入选**（衍生作品不能当原著设定来源）
 *
 * @param sources - 全部来源
 * @returns `authoritative` 官方来源、`references` 二手参考
 */
export function selectSourcesForPrompt(sources: CanonSource[]): {
    authoritative: CanonSource[];
    references: CanonSource[];
} {
    const usable = sources.filter(source => source.excerpt.trim().length > 0);
    const authoritative = usable.filter(source => isAuthoritativeSource(source.tier));
    if (authoritative.length > 0) {
        return { authoritative, references: [] };
    }
    const references = usable.filter(source => isReferenceSource(source.tier));
    return { authoritative: [], references };
}

/**
 * 把来源格式化成 prompt 块（官方优先、二手补充、衍生排除）。
 *
 * FAN-2/FAN-3（v4.83.1）：旧实现只取 `official`/`official-wiki`，没有官方时整块返回
 * 「没有可用的官方原著来源」——而同人创作大量依赖百科/wiki，导致模型只能输出「待核实」，
 * 这是「同人设定补充不了」的直接原因。新实现把官方段与二手段分开展示并标注等级，
 * 写明冲突裁决规则；`derivative`（同人/衍生/改编）依然被排除。
 *
 * @param sources - 来源列表
 * @param maxChars - 字符预算
 * @returns prompt 文本
 */
export function formatCanonSourcesForPrompt(sources: CanonSource[], maxChars = 12000): string {
    const { authoritative, references } = selectSourcesForPrompt(sources);
    if (authoritative.length === 0 && references.length === 0) {
        return '（没有可用的原著来源：既未找到官方资料，也没有可用的百科/wiki 二手资料。'
            + '所有字段必须写“待核实（未找到可靠原作来源）”，不要凭模型记忆编造。）';
    }

    let used = 0;
    const lines: string[] = [];

    /** 按预算逐条渲染来源 */
    const renderBlock = (list: CanonSource[], label: string): void => {
        if (list.length === 0) return;
        lines.push(label);
        for (const source of list) {
            const excerpt = source.excerpt.trim();
            const budget = Math.max(0, Math.min(excerpt.length, maxChars - used));
            if (budget <= 0) break;
            const text = excerpt.slice(0, budget);
            // S3-2（安全 r3）：原著摘录属外部内容，必须围栏后才可进 system prompt
            lines.push(
                `[${source.id}] ${source.title}\n来源：${source.url}\n等级：${CANON_TIER_LABEL[source.tier]}\n`
                + `摘录：${wrapUntrustedContent(text, '原著摘录')}`,
            );
            used += text.length;
        }
    };

    if (authoritative.length > 0) {
        renderBlock(authoritative, '【官方原著资料】以下为官方来源，可直接作为设定事实依据：');
    } else {
        renderBlock(
            references,
            '【二手参考资料】未找到官方来源，以下为百科/wiki 二手资料：'
            + '可用于补充设定，但可能与原作有出入。引用处必须标注「据二手资料」，'
            + '与其他信息冲突时以官方为准。',
        );
    }

    lines.push(
        '【来源使用规则】',
        '1. 官方资料 > 二手资料；两者冲突时一律以官方为准。',
        '2. 同人作品、改编、外传、二次创作等**衍生作品**已从来源中排除，不得作为设定依据。',
        '3. 来源中未提及的设定写「待核实」，不要凭模型记忆补全。',
    );
    return lines.join('\n\n');
}

/**
 * extractCitationIds 函数。
 * @param text - 文本内容
 * @returns 结果数组
 */
export function extractCitationIds(text: string): string[] {
    const ids = new Set<string>();
    for (const match of text.matchAll(/\[(S\d+)\]/g)) ids.add(match[1]);
    return [...ids];
}

/**
 * 引用覆盖率：有来源标注的字段比例，用于人工审核摘要。
 *
 * @param text - 文本内容
 * @param sources - 来源列表
 * @returns 数值结果
 */
export function citationCoverage(text: string, sources: CanonSource[]): number {
    const validIds = new Set(sources.map(s => s.id));
    const cited = extractCitationIds(text).filter(id => validIds.has(id));
    const placeholders = (text.match(/待核实/g) || []).length;
    const fields = (text.match(/^-\s+\*\*/gm) || []).length + (text.match(/^\|\s*[^|]+\s*\|/gm) || []).length;
    if (fields === 0) return 0;
    const denominator = Math.max(1, fields - placeholders);
    return Math.min(100, Math.round((cited.length / denominator) * 100));
} 

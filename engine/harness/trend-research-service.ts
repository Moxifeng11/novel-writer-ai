/**
 * trend-research-service.ts - AI-assisted market/hot-topic research.
 *
 * Uses the configured search provider when available; otherwise falls back to
 * model research with an explicit "unverified" marker. It never pretends that
 * model memory is a live search result.
 */
import { requestUrl } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { requestWithPolicy, SEARCH_REQUEST_POLICY } from '@/shared/http-request';
import { wrapUntrustedContent } from '@/shared/untrusted-content';

const log = createLogger('TrendResearch');

/**
 * 趋势搜索提供方。
 */
// 与 CanonSearchProvider 对齐：设置页已经开放 wikipedia / bangumi 免 Key 通道，
// 类型不补会导致「设置里能选、调研时类型不允许」的不一致。
export type TrendSearchProvider = 'manual' | 'bing' | 'brave' | 'serper' | 'tavily' | 'wikipedia' | 'bangumi';

/**
 * 趋势研究配置。
 */
export interface TrendResearchConfig {
    provider: TrendSearchProvider;
    apiKey?: string;
    maxSources?: number;
}

/**
 * 趋势来源。
 */
export interface TrendSource {
    title: string;
    url: string;
    snippet: string;
}

/**
 * 趋势研究结果。
 */
export interface TrendResearchResult {
    provider: TrendSearchProvider;
    sources: TrendSource[];
    summary: string;
    verified: boolean;
    warnings: string[];
    researchedAt: number;
}

/**
 * 请求函数类型。
 */
export type RequestUrlFn = (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{ status: number; text: string; json?: unknown }>;

const DEFAULT_MAX_SOURCES = 6;

/**
 * 该趋势检索通道是否需要 API Key。
 *
 * wikipedia / bangumi 走公开 API，免 Key 可用；manual 不联网。
 *
 * @param provider - 检索通道
 * @returns 是否需要 Key
 * @example
 * trendProviderNeedsApiKey('wikipedia'); // false
 * trendProviderNeedsApiKey('bing');      // true
 */
export function trendProviderNeedsApiKey(provider: TrendSearchProvider): boolean {
    return provider !== 'manual' && provider !== 'wikipedia' && provider !== 'bangumi';
}

/**
 * 规范化趋势配置。
 * @param config - 配置
  * @returns TrendResearchConfig 实例
 */
export function normalizeTrendConfig(config?: Partial<TrendResearchConfig>): TrendResearchConfig {
    return {
        provider: config?.provider || 'manual',
        apiKey: config?.apiKey || '',
        maxSources: Math.max(1, Math.min(10, config?.maxSources ?? DEFAULT_MAX_SOURCES)),
    };
}

/**
 * buildTrendQuery 函数。
 * @param mode - 模式
 * @param categoryOrGenre - 分类或题材
 * @param audience - 受众
 * @returns 文本结果
 */
export function buildTrendQuery(mode: 'short' | 'script', categoryOrGenre: string, audience?: string): string {
    if (mode === 'short') {
        return [
            categoryOrGenre || '番茄短篇小说',
            audience || '女频 男频',
            '2026 热门 番茄小说 短篇 题材 榜单',
            '-同人 -抄袭',
        ].join(' ');
    }
    return [
        categoryOrGenre || '红果短剧',
        audience || '短剧',
        '2026 热门 红果短剧 题材 榜单 卡点',
        '-同人 -抄袭',
    ].join(' ');
}

async function requestJson(request: RequestUrlFn, options: Parameters<RequestUrlFn>[0]): Promise<{ status: number; text: string; json?: unknown }> {
    const response = await requestWithPolicy(request, options, SEARCH_REQUEST_POLICY);
    let json: unknown;
    try { json = JSON.parse(response.text); } catch { json = undefined; }
    return { status: response.status, text: response.text, json };
}

/**
 * 趋势研究服务。
 */
export class TrendResearchService {
    constructor(
        private readonly config: TrendResearchConfig,
        private readonly request: RequestUrlFn = requestUrl as unknown as RequestUrlFn,
    ) {}

    /**
     * 搜索趋势来源。
     *
     * @param mode - 模式
     * @param categoryOrGenre - 分类或题材
     * @param audience - 参数
     * @returns 来源数组
     */
    async search(mode: 'short' | 'script', categoryOrGenre: string, audience?: string): Promise<TrendSource[]> {
        const config = normalizeTrendConfig(this.config);
        // 免 Key 通道（wikipedia / bangumi）不能用「有没有 Key」当开关：
        // 旧实现会在这里直接 return []，用户选了免 Key 通道也永远搜不到东西，且没有任何提示。
        if (config.provider === 'manual') return [];
        if (trendProviderNeedsApiKey(config.provider) && !String(config.apiKey || '').trim()) return [];
        const query = buildTrendQuery(mode, categoryOrGenre, audience);
        try {
            switch (config.provider) {
                case 'bing': return await this.searchBing(query, config);
                case 'brave': return await this.searchBrave(query, config);
                case 'serper': return await this.searchSerper(query, config);
                case 'tavily': return await this.searchTavily(query, config);
                case 'wikipedia': return await this.searchWikipedia(categoryOrGenre, config);
                case 'bangumi': return await this.searchBangumi(categoryOrGenre, config);
                default: return [];
            }
        } catch (e) {
            log.warn('trend search failed', e instanceof Error ? e.message : String(e));
            return [];
        }
    }

    /**
     * 维基百科检索（免 Key）。
     *
     * @param workName - 作品名/分类关键词
     * @param config - 配置
     * @returns 趋势来源
     */
    private async searchWikipedia(workName: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const url = 'https://zh.wikipedia.org/w/api.php'
            + `?action=query&list=search&srsearch=${encodeURIComponent(workName)}&format=json&srlimit=${config.maxSources ?? 6}`;
        const response = await requestJson(this.request, {
            url,
            method: 'GET',
            headers: { 'User-Agent': `NovelWriterAI/4.83.1 (+https://github.com/novel-writer-ai)`, Accept: 'application/json' },
        });
        const data = response.json as { query?: { search?: Array<{ title?: string; snippet?: string; pageid?: number }> } } | undefined;
        return (data?.query?.search || [])
            .filter(item => item.title)
            .map(item => ({
                title: item.title || '',
                url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title || '')}`,
                snippet: String(item.snippet || '').replace(/<[^>]+>/g, '').slice(0, 300),
            }))
            .slice(0, config.maxSources);
    }

    /**
     * Bangumi 检索（免 Key）。
     *
     * @param workName - 作品名/分类关键词
     * @param config - 配置
     * @returns 趋势来源
     */
    private async searchBangumi(workName: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(workName)}?type=2&responseGroup=small&max_results=${config.maxSources ?? 6}`;
        const response = await requestJson(this.request, {
            url,
            method: 'GET',
            headers: { 'User-Agent': `NovelWriterAI/4.83.1 (https://github.com/novel-writer-ai)`, Accept: 'application/json' },
        });
        const data = response.json as { list?: Array<{ id?: number; name?: string; name_cn?: string; summary?: string; url?: string }> } | undefined;
        return (data?.list || [])
            .filter(item => item.id)
            .map(item => {
                const title = item.name_cn || item.name || '';
                return {
                    title,
                    url: item.url || `https://bgm.tv/subject/${item.id}`,
                    snippet: (item.summary || '').trim().slice(0, 300) || title,
                };
            })
            .slice(0, config.maxSources);
    }

    private async searchBing(query: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const response = await requestJson(this.request, {
            url: `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=8&mkt=zh-CN`,
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': config.apiKey || '' },
        });
        const data = response.json as { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } } | undefined;
        return (data?.webPages?.value || []).map(item => ({
            title: item.name || '', url: item.url || '', snippet: item.snippet || '',
        })).slice(0, config.maxSources);
    }

    private async searchBrave(query: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const response = await requestJson(this.request, {
            url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
            method: 'GET',
            headers: { 'X-Subscription-Token': config.apiKey || '' },
        });
        const data = response.json as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } } | undefined;
        return (data?.web?.results || []).map(item => ({
            title: item.title || '', url: item.url || '', snippet: item.description || '',
        })).slice(0, config.maxSources);
    }

    private async searchSerper(query: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const response = await requestJson(this.request, {
            url: 'https://google.serper.dev/search',
            method: 'POST',
            headers: { 'X-API-KEY': config.apiKey || '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, num: 8, gl: 'cn', hl: 'zh-cn' }),
        });
        const data = response.json as { organic?: Array<{ title?: string; link?: string; snippet?: string }> } | undefined;
        return (data?.organic || []).map(item => ({
            title: item.title || '', url: item.link || '', snippet: item.snippet || '',
        })).slice(0, config.maxSources);
    }

    private async searchTavily(query: string, config: TrendResearchConfig): Promise<TrendSource[]> {
        const response = await requestJson(this.request, {
            url: 'https://api.tavily.com/search',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: config.apiKey || '', query, max_results: 8, search_depth: 'basic' }),
        });
        const data = response.json as { results?: Array<{ title?: string; url?: string; content?: string }> } | undefined;
        return (data?.results || []).map(item => ({
            title: item.title || '', url: item.url || '', snippet: item.content || '',
        })).slice(0, config.maxSources);
    }

    /**
     * 格式化来源。
     *
     * @param sources - 来源列表
     * @returns 文本
     */
    formatSources(sources: TrendSource[]): string {
        return sources.map((source, index) =>
            `[T${index + 1}] ${source.title || '无标题'}\nURL: ${source.url || '（无）'}\n摘要: ${wrapUntrustedContent(source.snippet.slice(0, 300), '网络检索结果')}`
        ).join('\n\n');
    }
}

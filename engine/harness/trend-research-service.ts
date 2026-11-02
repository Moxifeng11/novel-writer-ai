/**
 * trend-research-service.ts - AI-assisted market/hot-topic research.
 *
 * Uses the configured search provider when available; otherwise falls back to
 * model research with an explicit "unverified" marker. It never pretends that
 * model memory is a live search result.
 */
import { requestUrl } from 'obsidian';
import { createLogger } from '../../shared/logger';
import { requestWithPolicy, SEARCH_REQUEST_POLICY } from '../../shared/http-request';

const log = createLogger('TrendResearch');

/**
 * 趋势搜索提供方。
 */
export type TrendSearchProvider = 'manual' | 'bing' | 'brave' | 'serper' | 'tavily';

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

export function normalizeTrendConfig(config?: Partial<TrendResearchConfig>): TrendResearchConfig {
    return {
        provider: config?.provider || 'manual',
        apiKey: config?.apiKey || '',
        maxSources: Math.max(1, Math.min(10, config?.maxSources ?? DEFAULT_MAX_SOURCES)),
    };
}

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
     * @param audience? - 参数
     * @returns 来源数组
     */
    async search(mode: 'short' | 'script', categoryOrGenre: string, audience?: string): Promise<TrendSource[]> {
        const config = normalizeTrendConfig(this.config);
        if (config.provider === 'manual' || !String(config.apiKey || '').trim()) return [];
        const query = buildTrendQuery(mode, categoryOrGenre, audience);
        try {
            switch (config.provider) {
                case 'bing': return await this.searchBing(query, config);
                case 'brave': return await this.searchBrave(query, config);
                case 'serper': return await this.searchSerper(query, config);
                case 'tavily': return await this.searchTavily(query, config);
                default: return [];
            }
        } catch (e) {
            log.warn('trend search failed', e instanceof Error ? e.message : String(e));
            return [];
        }
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
            `[T${index + 1}] ${source.title || '无标题'}\nURL: ${source.url || '（无）'}\n摘要: ${source.snippet.slice(0, 300)}`
        ).join('\n\n');
    }
}

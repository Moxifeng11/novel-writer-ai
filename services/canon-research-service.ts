/**
 * canon-research-service.ts — 同人原作资料检索与来源缓存
 *
 * 原则：
 * - 只做“检索/抓取/缓存”，不生成设定；
 * - 没有可用官方来源时返回空，不调用模型凭记忆补；
 * - 只保存引用元数据与短摘录，不抓整本原文、不绕过付费墙。
 */
import { App, requestUrl } from 'obsidian';
import {
    CanonSource,
    CanonSourceInput,
    computeCanonSourceHash,
    createCanonSource,
    hashText,
    isAuthoritativeSource,
    normalizeSourceUrl,
} from '../shared/canon-source';
import { pjFanficResearchDir } from '../shared/paths';
import { createLogger } from '../shared/logger';
import { GITHUB_REPO_URL } from '../shared/github-repo';
import { requestWithPolicy, SEARCH_REQUEST_POLICY } from '../shared/http-request';

const log = createLogger('CanonResearch');

/** 网页抓取统一策略：15s 超时，不重试（避免对目标站点加压） */
const FETCH_REQUEST_POLICY = { timeoutMs: 15000 };

/**
 * 考据搜索提供方。
 */
export type CanonSearchProvider = 'manual' | 'bing' | 'brave' | 'serper' | 'tavily';

/**
 * 考据配置。
 */
export interface CanonResearchConfig {
    provider: CanonSearchProvider;
    apiKey?: string;
    allowedDomains?: string[];
    blockedDomains?: string[];
    maxSources?: number;
    excerptChars?: number;
}

interface CanonResearchHost {
    settings?: {
        canonResearch?: CanonResearchConfig;
    };
}

/**
 * 考据选项。
 */
export interface CanonResearchOptions {
    project?: string;
    author?: string;
    workType?: string;
    manualSources?: CanonSourceInput[];
}

/**
 * 考据结果。
 */
export interface CanonResearchResult {
    workName: string;
    provider: CanonSearchProvider;
    sources: CanonSource[];
    sourceHash: string;
    warnings: string[];
    updatedAt: number;
}

interface CachedResearch extends CanonResearchResult {
    version: 1;
}

const DEFAULT_CONFIG: CanonResearchConfig = {
    provider: 'manual',
    allowedDomains: [],
    blockedDomains: [],
    maxSources: 6,
    excerptChars: 1200,
};

/**
 * 同人考据服务。
 */
export class CanonResearchService {
    constructor(
        private readonly app: App,
        private readonly host: CanonResearchHost,
    ) {}

    getConfig(): CanonResearchConfig {
        return { ...DEFAULT_CONFIG, ...(this.host.settings?.canonResearch || {}) };
    }

    /** 检索/整理来源；manualSources 优先，缺失摘录时按 URL 抓取短正文。 */
    async research(workName: string, options: CanonResearchOptions = {}): Promise<CanonResearchResult> {
        const config = this.getConfig();
        const warnings: string[] = [];
        const inputs: CanonSourceInput[] = [...(options.manualSources || [])];

        if (inputs.length === 0 && config.provider !== 'manual') {
            if (!config.apiKey?.trim()) {
                warnings.push('未配置搜索 API Key，已退回手动官方来源模式');
            } else {
                try {
                    const searched = await this.search(workName, options, config);
                    inputs.push(...searched);
                } catch (error) {
                    warnings.push(`联网检索失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        if (inputs.length === 0) {
            warnings.push('没有导入任何原作来源；不能凭模型记忆生成设定内容');
        }

        const maxSources = Math.max(1, Math.min(12, config.maxSources ?? 6));
        const excerptChars = Math.max(200, Math.min(4000, config.excerptChars ?? 1200));
        const sources: CanonSource[] = [];
        const seen = new Set<string>();

        for (const input of inputs) {
            if (sources.length >= maxSources) break;
            const url = normalizeSourceUrl(input.url || '');
            if (!url) {
                warnings.push(`已跳过非 http/https 来源：${input.url || '（空）'}`);
                continue;
            }
            if (isPrivateHost(new URL(url).hostname)) {
                warnings.push(`已跳过本机/内网来源：${url}`);
                continue;
            }
            if (seen.has(url)) continue;
            if (this.isBlockedByConfig(url, config)) {
                warnings.push(`已跳过来自排除域名的来源：${url}`);
                continue;
            }
            seen.add(url);

            let excerpt = (input.excerpt || '').trim();
            let title = input.title?.trim() || '';
            if (!excerpt) {
                try {
                    const fetched = await this.fetchPage(url, excerptChars);
                    excerpt = fetched.excerpt;
                    title = title || fetched.title;
                } catch (error) {
                    warnings.push(`抓取失败，保留搜索摘要：${url}`);
                    log.warn('[CanonResearch] 抓取来源失败:', url, error);
                }
            }
            if (!excerpt) {
                warnings.push(`来源没有可用摘录，已跳过：${url}`);
                continue;
            }
            const source = createCanonSource({
                ...input,
                url,
                title,
                excerpt,
            }, sources.length);
            if (!isAuthoritativeSource(source.tier)) {
                warnings.push(`来源不是官方/官方 Wiki，已标记为「${source.tier}」：${source.title}`);
            }
            sources.push(source);
        }

        const result: CanonResearchResult = {
            workName,
            provider: config.provider,
            sources,
            sourceHash: computeCanonSourceHash(sources),
            warnings,
            updatedAt: Date.now(),
        };
        if (options.project) {
            try {
                await this.saveCache(options.project, result);
            } catch (error) {
                warnings.push(`来源缓存写入失败：${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return result;
    }

    async loadCache(project: string, workName: string): Promise<CanonResearchResult | null> {
        const path = `${pjFanficResearchDir(project, workName)}/sources.json`;
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(path))) return null;
            const parsed = JSON.parse(await adapter.read(path)) as CachedResearch;
            if (!Array.isArray(parsed.sources)) return null;
            return parsed;
        } catch (error) {
            log.warn('[CanonResearch] 读取来源缓存失败:', error);
            return null;
        }
    }

    /** 手工添加一条来源（UI 只填 URL/标题/摘录，不抓整本正文）。 */
    async addManualSource(
        url: string,
        title: string,
        excerpt: string,
        config?: CanonResearchConfig,
    ): Promise<CanonSource> {
        const normalized = normalizeSourceUrl(url);
        if (!normalized) throw new Error('只支持 http/https 官方资料 URL');
        if (isPrivateHost(new URL(normalized).hostname)) throw new Error('不允许使用本机/内网地址作为同人资料');
        const effective = { ...this.getConfig(), ...(config || {}) };
        const chars = Math.max(200, Math.min(4000, effective.excerptChars ?? 1200));
        let finalExcerpt = excerpt.trim();
        let finalTitle = title.trim();
        if (!finalExcerpt) {
            const fetched = await this.fetchPage(normalized, chars);
            finalExcerpt = fetched.excerpt;
            finalTitle = finalTitle || fetched.title;
        }
        return createCanonSource({ url: normalized, title: finalTitle, excerpt: finalExcerpt }, 0);
    }

    private async search(
        workName: string,
        options: CanonResearchOptions,
        config: CanonResearchConfig,
    ): Promise<CanonSourceInput[]> {
        const query = this.buildQuery(workName, options);
        switch (config.provider) {
            case 'bing':
                return this.searchBing(query, config);
            case 'brave':
                return this.searchBrave(query, config);
            case 'serper':
                return this.searchSerper(query, config);
            case 'tavily':
                return this.searchTavily(query, config);
            default:
                return [];
        }
    }

    private buildQuery(workName: string, options: CanonResearchOptions): string {
        const parts = [`"${workName}"`];
        if (options.author?.trim()) parts.push(`"${options.author.trim()}"`);
        if (options.workType?.trim()) parts.push(options.workType.trim());
        parts.push('原作', '官方', '设定');
        // 明确排除衍生作品；不同搜索后端对减号支持不同，但至少能降低误召回
        parts.push('-同人', '-衍生', '-改编', '-动画', '-电视剧', '-游戏');
        return parts.join(' ');
    }

    private async searchBing(query: string, config: CanonResearchConfig): Promise<CanonSourceInput[]> {
        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=8&mkt=zh-CN`;
        const response = await requestWithPolicy(requestUrl, {
            url,
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': config.apiKey || '' },
        }, SEARCH_REQUEST_POLICY);
        const data = response.json as { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
        return (data.webPages?.value || []).map(item => ({
            title: item.name || '',
            url: item.url || '',
            excerpt: item.snippet || '',
        }));
    }

    private async searchBrave(query: string, config: CanonResearchConfig): Promise<CanonSourceInput[]> {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`;
        const response = await requestWithPolicy(requestUrl, {
            url,
            method: 'GET',
            headers: { 'X-Subscription-Token': config.apiKey || '' },
        }, SEARCH_REQUEST_POLICY);
        const data = response.json as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
        return (data.web?.results || []).map(item => ({
            title: item.title || '',
            url: item.url || '',
            excerpt: item.description || '',
        }));
    }

    private async searchSerper(query: string, config: CanonResearchConfig): Promise<CanonSourceInput[]> {
        const response = await requestWithPolicy(requestUrl, {
            url: 'https://google.serper.dev/search',
            method: 'POST',
            headers: {
                'X-API-KEY': config.apiKey || '',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: query, num: 8, gl: 'cn', hl: 'zh-cn' }),
        }, SEARCH_REQUEST_POLICY);
        const data = response.json as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
        return (data.organic || []).map(item => ({
            title: item.title || '',
            url: item.link || '',
            excerpt: item.snippet || '',
        }));
    }

    private async searchTavily(query: string, config: CanonResearchConfig): Promise<CanonSourceInput[]> {
        const response = await requestWithPolicy(requestUrl, {
            url: 'https://api.tavily.com/search',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: config.apiKey || '',
                query,
                max_results: 8,
                search_depth: 'basic',
                include_raw_content: false,
            }),
        }, SEARCH_REQUEST_POLICY);
        const data = response.json as { results?: Array<{ title?: string; url?: string; content?: string }> };
        return (data.results || []).map(item => ({
            title: item.title || '',
            url: item.url || '',
            excerpt: item.content || '',
        }));
    }

    private async fetchPage(url: string, maxChars: number): Promise<{ title: string; excerpt: string }> {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('只支持 http/https 来源');
        }
        if (isPrivateHost(parsed.hostname)) {
            throw new Error('不允许抓取本机/内网地址');
        }
        const response = await requestWithPolicy(requestUrl, {
            url,
            method: 'GET',
            headers: {
                'User-Agent': `Mozilla/5.0 (compatible; NovelWriterAI/4.18; +${GITHUB_REPO_URL})`,
                'Accept': 'text/html,application/xhtml+xml,text/plain',
            },
        }, FETCH_REQUEST_POLICY);
        const text = String(response.text || '');
        const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
        return {
            title: decodeHtml(title).slice(0, 160),
            excerpt: extractReadableText(text, maxChars),
        };
    }

    private isBlockedByConfig(url: string, config: CanonResearchConfig): boolean {
        const domain = safeDomain(url);
        if (!domain) return true;
        const blocked = (config.blockedDomains || []).map(d => d.trim().toLowerCase()).filter(Boolean);
        if (blocked.some(item => domain === item || domain.endsWith(`.${item}`))) return true;
        const allowed = (config.allowedDomains || []).map(d => d.trim().toLowerCase()).filter(Boolean);
        if (allowed.length > 0 && !allowed.some(item => domain === item || domain.endsWith(`.${item}`))) return true;
        return false;
    }

    private async saveCache(project: string, result: CanonResearchResult): Promise<void> {
        const dir = pjFanficResearchDir(project, result.workName);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(dir))) {
            await adapter.mkdir(dir);
        }
        const cached: CachedResearch = { version: 1, ...result };
        await adapter.write(`${dir}/sources.json`, JSON.stringify(cached, null, 2));
    }
}

function isPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const [a, b] = [Number(match[1]), Number(match[2])];
    return a === 10 || a === 127 || a === 0
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 198 && (b === 18 || b === 19));
}

function safeDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

/**
 * 从 HTML 提取可读文本。
 *
 * @param html - HTML 片段
 * @param maxChars - 最大字符数
 * @returns 文本
 */
export function extractReadableText(html: string, maxChars: number): string {
    if (!html) return '';
    if (!/<[a-z][\s\S]*>/i.test(html)) return html.trim().slice(0, maxChars);
    const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeHtml(cleaned)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, maxChars);
}

function decodeHtml(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** 把来源集合渲染成审核摘要用的稳定指纹。 */
export function canonSourceFingerprint(sources: CanonSource[]): string {
    return hashText(computeCanonSourceHash(sources));
}
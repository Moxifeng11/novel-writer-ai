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
    classifyCanonSource,
    computeCanonSourceHash,
    createCanonSource,
    hashText,
    isAuthoritativeSource,
    normalizeSourceUrl,
} from '@/shared/canon-source';
import { pjFanficResearchDir } from '@/shared/paths';
import { createLogger } from '@/shared/logger';
import { GITHUB_REPO_URL } from '@/shared/github-repo';
import { requestWithPolicy, SEARCH_REQUEST_POLICY } from '@/shared/http-request';
import { isStoredCiphertext } from '@/shared/secret-value';
import { isPrivateHost } from '@/shared/private-host';
export { isPrivateHost } from '@/shared/private-host';

const log = createLogger('CanonResearch');

/** 网页抓取统一策略：15s 超时，不重试（避免对目标站点加压） */
const FETCH_REQUEST_POLICY = { timeoutMs: 15000 };

/** 维基百科 API 要求的 UA（Wikimedia 会拒绝无标识 UA） */
const WIKI_USER_AGENT = `NovelWriterAI/4.83.1 (+${GITHUB_REPO_URL})`;

/** Bangumi API 要求的 UA（需带联系方式/仓库地址） */
const BANGUMI_USER_AGENT = `NovelWriterAI/4.83.1 (${GITHUB_REPO_URL})`;

/**
 * 该 provider 是否需要 API Key。
 *
 * FAN-1（v4.83.1）：`wikipedia` / `bangumi` 走公开 API，免 Key 即可用；
 * `manual` 本就不联网。其余第三方搜索需要 Key。
 *
 * @param provider - 提供方
 * @returns 是否需要 Key
 */
export function providerNeedsApiKey(provider: CanonSearchProvider): boolean {
    return provider !== 'manual' && provider !== 'wikipedia' && provider !== 'bangumi';
}

/**
 * 考据搜索提供方。
 *
 * `wikipedia` / `bangumi` 为**免 Key** 通道（FAN-1，v4.83.1）：此前 provider 全部需要
 * 第三方搜索 Key，默认 `manual` 等于开箱没有联网检索能力。两者都走公开 API，
 * 结果按 `reference`（二手资料）分级，由 prompt 显式标注等级。
 */
export type CanonSearchProvider = 'manual' | 'bing' | 'brave' | 'serper' | 'tavily' | 'wikipedia' | 'bangumi';

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

    /**
     * 获取配置。
      * @returns CanonResearchConfig 实例
     */
    getConfig(): CanonResearchConfig {
        return { ...DEFAULT_CONFIG, ...(this.host.settings?.canonResearch || {}) };
    }

    /**
     * 检索/整理来源；manualSources 优先，缺失摘录时按 URL 抓取短正文。
     *
     * @param workName - 作品名
     * @param options - 配置项
      * @returns CanonResearchResult 实例
     */
    async research(workName: string, options: CanonResearchOptions = {}): Promise<CanonResearchResult> {
        const config = this.getConfig();
        const warnings: string[] = [];
        const inputs: CanonSourceInput[] = [...(options.manualSources || [])];

        if (inputs.length === 0 && config.provider !== 'manual') {
            if (providerNeedsApiKey(config.provider)
                && (!config.apiKey?.trim() || isStoredCiphertext(config.apiKey))) {
                // S3-4：锁定态密文不能当凭据外发
                warnings.push(config.apiKey?.trim()
                    ? '搜索 API Key 处于加密锁定状态，请先在设置中解锁口令；已退回手动官方来源模式'
                    : `未配置搜索 API Key，无法使用「${config.provider}」检索；已退回手动官方来源模式。`
                        + '可在设置里改用免 Key 的「维基百科」或「Bangumi」通道');
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

    /**
     * 加载缓存。
     * @param project - 项目（路径或对象）
     * @param workName - 作品名
      * @returns CanonResearchResult 或 null
     */
    async loadCache(project: string, workName: string): Promise<CanonResearchResult | null> {
        const path = `${pjFanficResearchDir(project, workName)}/sources.json`;
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(path))) return null;
            const parsed = JSON.parse(await adapter.read(path)) as CachedResearch;
            if (!Array.isArray(parsed.sources)) return null;
            // S3-3（安全 r3）：缓存可被同步/本地篡改；不信任文件里的 tier/excerptHash。
            // URL 只接受 http(s)，标题/摘录限长，tier 按域名重新分级，哈希重算。
            const sources = parsed.sources
                .filter((source): source is CanonSource => Boolean(source) && typeof source === 'object')
                .map((source) => {
                    const url = normalizeSourceUrl(String(source.url || ''));
                    if (!url) return null;
                    const title = String(source.title || '').slice(0, 200);
                    const excerpt = String(source.excerpt || '').slice(0, 20_000);
                    return {
                        ...source,
                        url,
                        title,
                        excerpt,
                        tier: classifyCanonSource({ url, title }),
                        excerptHash: hashText(excerpt),
                    };
                })
                .filter((source): source is CanonSource => source !== null);
            return { ...parsed, sources };
        } catch (error) {
            log.warn('[CanonResearch] 读取来源缓存失败:', error);
            return null;
        }
    }

    /**
     * 手工添加一条来源（UI 只填 URL/标题/摘录，不抓整本正文）。
     *
     * @param url - 地址
     * @param title - 标题
     * @param excerpt - 摘录
     * @param config - 配置
      * @returns CanonSource 实例
     */
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
            case 'wikipedia':
                return this.searchWikipedia(workName);
            case 'bangumi':
                return this.searchBangumi(workName);
            default:
                return [];
        }
    }

    /**
     * 维基百科检索（免 Key）。
     *
     * 两步：先 `list=search` 拿条目 id，再 `prop=extracts&explaintext` 拿纯文本正文。
     * 只取前若干条，正文截断到 `excerptChars`。来源域名 `*.wikipedia.org` 会被
     * `classifyCanonSource` 归为 `reference`（二手资料），由 prompt 标注等级。
     *
     * @param workName - 作品名
     * @returns 来源输入
     */
    private async searchWikipedia(workName: string): Promise<CanonSourceInput[]> {
        const searchUrl = 'https://zh.wikipedia.org/w/api.php'
            + `?action=query&list=search&srsearch=${encodeURIComponent(workName)}&format=json&srlimit=3`;
        const searchRes = await requestWithPolicy(requestUrl, {
            url: searchUrl,
            method: 'GET',
            headers: { 'User-Agent': WIKI_USER_AGENT, 'Accept': 'application/json' },
        }, SEARCH_REQUEST_POLICY);
        const searchData = searchRes.json as {
            query?: { search?: Array<{ title?: string; pageid?: number; snippet?: string }> };
        };
        const hits = (searchData.query?.search || []).filter(item => item.pageid && item.title);
        if (hits.length === 0) return [];

        const pageIds = hits.map(item => String(item.pageid)).join('|');
        const extractUrl = 'https://zh.wikipedia.org/w/api.php'
            + `?action=query&prop=extracts&explaintext=1&format=json&pageids=${pageIds}`;
        const extractRes = await requestWithPolicy(requestUrl, {
            url: extractUrl,
            method: 'GET',
            headers: { 'User-Agent': WIKI_USER_AGENT, 'Accept': 'application/json' },
        }, SEARCH_REQUEST_POLICY);
        const extractData = extractRes.json as {
            query?: { pages?: Record<string, { title?: string; extract?: string }> };
        };
        const pages = extractData.query?.pages || {};
        const results: CanonSourceInput[] = [];
        for (const hit of hits) {
            const page = pages[String(hit.pageid)];
            const excerpt = (page?.extract || '').trim();
            if (!excerpt) continue;
            results.push({
                title: page?.title || hit.title || '',
                url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(hit.title || '')}`,
                excerpt: excerpt.slice(0, 2000),
            });
        }
        return results;
    }

    /**
     * Bangumi 检索（免 Key，番剧/轻小说/动画 IP 覆盖较好）。
     *
     * 搜索接口的 `summary` 常为空，因此再按条目 id 取一次详情补摘要。
     * 来源域名 `bgm.tv` 会被 `classifyCanonSource` 归为 `reference`。
     *
     * @param workName - 作品名
     * @returns 来源输入
     */
    private async searchBangumi(workName: string): Promise<CanonSourceInput[]> {
        const searchUrl = 'https://api.bgm.tv/search/subject/'
            + `${encodeURIComponent(workName)}?type=2&responseGroup=small&max_results=3`;
        const searchRes = await requestWithPolicy(requestUrl, {
            url: searchUrl,
            method: 'GET',
            headers: { 'User-Agent': BANGUMI_USER_AGENT, 'Accept': 'application/json' },
        }, SEARCH_REQUEST_POLICY);
        const searchData = searchRes.json as {
            list?: Array<{ id?: number; name?: string; name_cn?: string; summary?: string; url?: string }>;
        };
        const items = (searchData.list || []).filter(item => item.id);
        const results: CanonSourceInput[] = [];
        for (const item of items) {
            let summary = (item.summary || '').trim();
            if (!summary) {
                try {
                    const detailRes = await requestWithPolicy(requestUrl, {
                        url: `https://api.bgm.tv/v0/subjects/${item.id}`,
                        method: 'GET',
                        headers: { 'User-Agent': BANGUMI_USER_AGENT, 'Accept': 'application/json' },
                    }, SEARCH_REQUEST_POLICY);
                    const detail = detailRes.json as { summary?: string };
                    summary = (detail.summary || '').trim();
                } catch (error) {
                    // 详情失败不影响搜索命中：保留标题与条目 URL 即可
                    log.warn('[CanonResearch] Bangumi 详情获取失败:', item.id, error);
                }
            }
            const title = item.name_cn || item.name || '';
            results.push({
                title,
                url: item.url || `https://bgm.tv/subject/${item.id}`,
                excerpt: summary ? summary.slice(0, 2000) : title,
            });
        }
        return results;
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
        // S3-20（安全 r3）残余说明：Obsidian `requestUrl` 由 Electron net 实现，
        // **强制跟随重定向且不暴露最终 URL/关闭开关**，因此在插件层无法对 3xx 的
        // 目标主机复核，也无法做 DNS 解析校验（renderer 无 dns API）。可做的加固是
        // 拒绝非 2xx 响应，避免把 30x/404 中间页当正文交给模型；重定向与 DNS
        // 重绑定仍需上游 API 支持（见 docs/audits/auto-cross-audit-2026-11-11-security-r3.md）。
        const response = await requestWithPolicy(requestUrl, {
            url,
            method: 'GET',
            headers: {
                'User-Agent': `Mozilla/5.0 (compatible; NovelWriterAI/4.18; +${GITHUB_REPO_URL})`,
                'Accept': 'text/html,application/xhtml+xml,text/plain',
            },
        }, FETCH_REQUEST_POLICY);
        const status = Number(response.status) || 0;
        if (status && (status < 200 || status >= 300)) {
            throw new Error(`抓取失败：HTTP ${status}（${parsed.hostname}）`);
        }
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

/**
 * 把来源集合渲染成审核摘要用的稳定指纹。
 *
 * @param sources - 来源列表
 * @returns 文本结果
 */
export function canonSourceFingerprint(sources: CanonSource[]): string {
    return hashText(computeCanonSourceHash(sources));
}
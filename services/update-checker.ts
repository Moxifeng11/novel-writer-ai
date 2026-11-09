/**
 * update-checker.ts — 插件版本更新检查服务
 *
 * 功能：
 * - 读取当前插件版本（从 manifest.json）
 * - 检查最新版本（GitHub releases / 自定义服务器）
 * - semver 版本号比较
 * - 判断是否有新版本
 * - 记录上次检查时间，避免频繁检查
 */

import { requestUrl, type RequestUrlResponse } from 'obsidian';
import { PluginCacheManager } from '@/shared/plugin-cache';
import {
    GITHUB_BRANCH,
    GITHUB_REPO_SLUG,
    GITHUB_REPO_URL,
    buildGitHubLatestReleaseApi,
    buildGitHubRawManifestUrl,
    buildGitHubReleasesAtomUrl,
    normalizeGitHubRepo,
} from '@/shared/github-repo';
import { requestWithPolicy } from '@/shared/http-request';

/** 更新检查源类型 */
export type UpdateSourceType = 'github' | 'custom';

/** 版本信息 */
export interface VersionInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string;
    downloadUrl?: string;
}

/** 更新检查配置 */
export interface UpdateCheckConfig {
    enabled: boolean;
    source: UpdateSourceType;
    githubRepo?: string;
    /** 私有仓库 Release API 需要 Token；公开仓库可留空。 */
    githubToken?: string;
    customUrl?: string;
    checkIntervalHours: number;
}

/**
 * 解析 GitHub releases.atom 的首个 release 条目。
 *
 * @param xml - Atom 文本
 * @param repo - 仓库标识（拼下载链接）
 * @returns 版本信息；无法解析返回 null
 */
function parseGitHubAtom(xml: string, repo: string): VersionInfo | null {
    const entry = /<entry\b[\s\S]*?<\/entry>/i.exec(xml)?.[0] || xml;
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1] || '';
    const version = title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim().replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return null;
    const updated = /<updated[^>]*>([\s\S]*?)<\/updated>/i.exec(entry)?.[1] || '';
    const href = /<link[^>]*href="([^"]+)"/i.exec(entry)?.[1]
        || `https://github.com/${repo}/releases/tag/${version}`;
    return {
        version,
        releaseDate: updated || undefined,
        releaseNotes: '',
        downloadUrl: href,
    };
}

/** 更新检查错误类型：区分网络/HTTP/解析/配置，避免一律提示"无更新" */
export type UpdateCheckErrorKind = 'config' | 'network' | 'http' | 'parse';

/** 更新检查结果 */
export interface UpdateCheckResult {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseDate?: string;
    releaseNotes?: string;
    downloadUrl?: string;
    error?: string;
    errorKind?: UpdateCheckErrorKind;
    /** 本次检查失败，latestVersion 来自上次成功结果 */
    stale?: boolean;
    /** 成功检查时间（ISO） */
    checkedAt?: string;
    /** 上次成功检查时间（ISO） */
    lastSuccessAt?: string;
}

/** 默认配置 */
export const DEFAULT_UPDATE_CONFIG: UpdateCheckConfig = {
    enabled: false,
    source: 'github',
    githubRepo: GITHUB_REPO_SLUG,
    customUrl: '',
    checkIntervalHours: 168,
};

/** 内部错误：携带可区分的错误类型 */
class UpdateCheckError extends Error {
    readonly kind: UpdateCheckErrorKind;

    constructor(kind: UpdateCheckErrorKind, message: string) {
        super(message);
        this.name = 'UpdateCheckError';
        this.kind = kind;
    }
}

/**
 * SemVer 比较：判断 version1 是否大于 version2
 * 返回值：1=v1>v2, -1=v1<v2, 0=相等
 * @param v1 - 版本 1 的值
 * @param v2 - 版本 2 的值
 * @returns 数值结果
 */
export function compareVersions(v1: string, v2: string): number {
    const parse = (v: string): number[] => {
        const clean = v.replace(/^v/, '').split('-')[0];
        return clean.split('.').map(n => parseInt(n, 10) || 0);
    };
    const p1 = parse(v1);
    const p2 = parse(v2);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

/**
 * 判断是否是大版本更新（major 版本号变化）
 * @param v1 - 版本 1 的值
 * @param v2 - 版本 2 的值
 * @returns 是否成功
 */
export function isMajorUpdate(v1: string, v2: string): boolean {
    const parse = (v: string): number => {
        const clean = v.replace(/^v/, '').split('-')[0];
        return parseInt(clean.split('.')[0] || '0', 10);
    };
    return parse(v2) > parse(v1);
}

/** 更新检查服务 */
export class UpdateChecker {
    private currentVersion: string;
    private cacheManager: PluginCacheManager;
    private config: UpdateCheckConfig;
    /** 同一时刻只允许一个检查请求，避免连点触发 GitHub 次级限流 */
    private inFlight = false;
    private lastForceAt = 0;

    /** 手动检查最小间隔（毫秒） */
    private static readonly MIN_FORCE_INTERVAL_MS = 15_000;
    /** 单次请求超时（毫秒） */
    private static readonly REQUEST_TIMEOUT_MS = 15_000;

    constructor(
        currentVersion: string,
        cacheManager: PluginCacheManager,
        config?: Partial<UpdateCheckConfig>
    ) {
        this.currentVersion = currentVersion;
        this.cacheManager = cacheManager;
        this.config = { ...DEFAULT_UPDATE_CONFIG, ...config };
    }

    /**
     * 更新配置
     *
     * @param config - 配置
     */
    updateConfig(config: Partial<UpdateCheckConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 获取当前版本
     *
     * @returns 文本结果
     */
    getCurrentVersion(): string {
        return this.currentVersion;
    }

    /**
     * 获取上次检查时间
     *
      * @returns Date 或 null
     */
    getLastCheckTime(): Date | null {
        const lastCheck = this.cacheManager.getUpdateLastCheck();
        if (!lastCheck) return null;
        const date = new Date(lastCheck);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    /** 仓库/更新源变更后清空旧结果，避免 About 页继续显示旧仓库的 404。 */
    clearCache(): void {
        this.cacheManager.setUpdateLastResult(undefined);
        this.cacheManager.setUpdateLastCheck('');
    }

    /**
     * 获取上次检查结果。
     * 插件升级后缓存里的 currentVersion 可能还是旧版本（例如从 4.12.4 升到 4.18.0），
     * 直接返回会让更新 UI 显示旧版本号。这里按当前版本重算 hasUpdate；
     * 如果缓存是旧错误结果、连 latestVersion 都没有，则返回 null 触发一次新检查。
      * @returns UpdateCheckResult 或 null
     */
    getLastCheckResult(): UpdateCheckResult | null {
        const cached = this.cacheManager.getUpdateLastResult() as UpdateCheckResult | null;
        if (!cached) return null;
        // 旧版本把仓库写成了 trae-ai/novel-writer-ai，缓存里的 404 不能继续展示。
        if (cached.error?.includes('trae-ai/novel-writer-ai')) {
            this.clearCache();
            return null;
        }
        if (!cached.latestVersion) {
            // 错误结果没有 latestVersion，无法重算 hasUpdate；至少把 currentVersion 纠正并回写，
            // 然后返回 null 让调用方重新检查（而不是继续展示旧错误/旧版本）。
            if (cached.currentVersion !== this.currentVersion) {
                this.cacheManager.setUpdateLastResult({
                    ...cached,
                    currentVersion: this.currentVersion,
                    hasUpdate: false,
                });
            }
            return null;
        }
        if (cached.currentVersion === this.currentVersion) return cached;
        const normalized: UpdateCheckResult = {
            ...cached,
            currentVersion: this.currentVersion,
            hasUpdate: compareVersions(cached.latestVersion, this.currentVersion) > 0,
        };
        // 回写一次，避免缓存文件长期停留在旧 currentVersion。
        this.cacheManager.setUpdateLastResult(normalized);
        return normalized;
    }

    /**
     * 判断是否应该检查更新（基于检查间隔）
     *
     * @returns 是否成功
     */
    shouldCheck(): boolean {
        if (!this.config.enabled) return false;
        const lastCheck = this.getLastCheckTime();
        if (!lastCheck) return true;
        const now = new Date();
        const diffHours = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);
        return diffHours >= this.config.checkIntervalHours;
    }

    /**
     * 检查更新
     * @param force 是否强制检查（忽略检查间隔）
      * @returns UpdateCheckResult 实例
     */
    async checkForUpdates(force: boolean = false): Promise<UpdateCheckResult> {
        const baseResult: UpdateCheckResult = {
            hasUpdate: false,
            currentVersion: this.currentVersion,
        };
        if (this.inFlight) {
            return {
                ...baseResult,
                error: '正在检查更新，请稍候',
                errorKind: 'config',
            };
        }
        const now = Date.now();
        if (force && this.lastForceAt > 0
            && now - this.lastForceAt < UpdateChecker.MIN_FORCE_INTERVAL_MS) {
            const last = this.getLastCheckResult();
            if (last) return last;
            return {
                ...baseResult,
                error: '检查过于频繁，请稍后再试',
                errorKind: 'config',
            };
        }
        this.inFlight = true;
        if (force) this.lastForceAt = now;

        try {
            if (!force && !this.shouldCheck()) {
                const lastResult = this.getLastCheckResult();
                if (lastResult) return lastResult;
            }

            try {
                if (this.config.source === 'github' && !this.config.githubRepo) {
                    throw new UpdateCheckError('config', '未配置 GitHub 仓库（owner/repo）');
                }
                if (this.config.source === 'custom' && !this.config.customUrl) {
                    throw new UpdateCheckError('config', '未配置自定义更新 URL');
                }
                if (this.config.source !== 'github' && this.config.source !== 'custom') {
                    throw new UpdateCheckError('config', `未知的更新源：${String(this.config.source)}`);
                }

                const latestInfo = this.config.source === 'github'
                    ? await this.checkGitHubRelease(this.config.githubRepo as string)
                    : await this.checkCustomSource(this.config.customUrl as string);

                const hasUpdate = compareVersions(latestInfo.version, this.currentVersion) > 0;

                const result: UpdateCheckResult = {
                    hasUpdate,
                    currentVersion: this.currentVersion,
                    latestVersion: latestInfo.version,
                    releaseDate: latestInfo.releaseDate,
                    releaseNotes: latestInfo.releaseNotes,
                    downloadUrl: latestInfo.downloadUrl,
                };

                this.saveCheckResult(result);
                return result;
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                const result: UpdateCheckResult = {
                    ...baseResult,
                    error,
                    errorKind: e instanceof UpdateCheckError ? e.kind : 'network',
                };
                return this.saveCheckResult(result);
            }
        } finally {
            this.inFlight = false;
        }
    }

    /** 从 GitHub Releases 检查更新 */
    private async checkGitHubRelease(repo: string): Promise<VersionInfo> {
        const safeRepo = normalizeGitHubRepo(repo);
        if (!safeRepo) {
            throw new UpdateCheckError('config', `GitHub 仓库格式不正确：${repo || '（空）'}`);
        }
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            // GitHub REST 对无合法 User-Agent 的请求直接 403；显式声明也便于排障
            'User-Agent': `NovelWriterAI/${typeof PLUGIN_VERSION !== 'undefined' ? PLUGIN_VERSION : this.currentVersion || 'unknown'} (+${GITHUB_REPO_URL})`,
        };
        if (this.config.githubToken?.trim()) {
            headers.Authorization = `Bearer ${this.config.githubToken.trim()}`;
        }

        try {
            return await this.checkGitHubReleaseApi(safeRepo, headers);
        } catch (primary) {
            // API 403/429 时 GitHub 仍允许访问公开的 releases.atom 与 raw manifest；
            // 两者都拿不到再抛原始错误，避免把「限流」误报成「仓库不存在」。
            const fallback = await this.tryGitHubFallbacks(safeRepo);
            if (fallback) return fallback;
            throw primary;
        }
    }

    /** GitHub Releases API（主路径） */
    private async checkGitHubReleaseApi(
        safeRepo: string,
        headers: Record<string, string>,
    ): Promise<VersionInfo> {
        const url = buildGitHubLatestReleaseApi(safeRepo);
        let response: RequestUrlResponse;
        try {
            // v4.76.0：改 requestUrl——移动端 fetch 无 CORS 豁免，GitHub API 会直接被拦。
            // v4.81.1：加 15s 超时与一次有限重试，避免代理挂起时永远转圈。
            response = await this.requestWithTimeout(url, headers);
        } catch (e) {
            throw new UpdateCheckError(
                'network',
                `网络不可达（${safeRepo}）：${e instanceof Error ? e.message : String(e)}`
            );
        }

        if (response.status < 200 || response.status >= 300) {
            throw new UpdateCheckError('http', this.describeGitHubError(response, safeRepo));
        }

        let data: Record<string, unknown>;
        try {
            data = response.json as Record<string, unknown>;
        } catch {
            throw new UpdateCheckError('parse', 'GitHub 返回内容无法解析');
        }

        const version = String(data['tag_name'] || data['name'] || '').replace(/^v/, '');
        if (!version) {
            throw new UpdateCheckError('parse', 'GitHub Release 缺少版本号');
        }

        return {
            version,
            releaseDate: typeof data['published_at'] === 'string' ? data['published_at'] : undefined,
            releaseNotes: typeof data['body'] === 'string' ? data['body'] : '',
            downloadUrl: typeof data['html_url'] === 'string' ? data['html_url'] : '',
        };
    }

    /**
     * GitHub API 失败后的公开备用源：releases.atom → raw manifest（master/main）。
     * 只返回版本与链接，不臆造 release notes。
     */
    private async tryGitHubFallbacks(safeRepo: string): Promise<VersionInfo | null> {
        const atomUrl = buildGitHubReleasesAtomUrl(safeRepo);
        try {
            const response = await this.requestWithTimeout(atomUrl, { Accept: 'application/atom+xml' }, 8000);
            if (response.status >= 200 && response.status < 300) {
                const parsed = parseGitHubAtom(response.text || '', safeRepo);
                if (parsed) return parsed;
            }
        } catch {
            // 继续尝试 raw manifest
        }

        for (const branch of [GITHUB_BRANCH, 'main']) {
            try {
                const response = await this.requestWithTimeout(
                    buildGitHubRawManifestUrl(safeRepo, branch),
                    { Accept: 'application/json' },
                    8000,
                );
                if (response.status < 200 || response.status >= 300) continue;
                const data = JSON.parse(response.text || '{}') as Record<string, unknown>;
                const version = String(data.version || '').replace(/^v/, '');
                if (version) {
                    return {
                        version,
                        releaseDate: typeof data.releaseDate === 'string' ? data.releaseDate : undefined,
                        downloadUrl: `https://github.com/${safeRepo}/releases/tag/${version}`,
                    };
                }
            } catch {
                // 下一个分支
            }
        }
        return null;
    }

    /** 统一请求入口：15s 超时 + 一次重试（备用源可传更短超时） */
    private async requestWithTimeout(
        url: string,
        headers: Record<string, string>,
        timeoutMs = UpdateChecker.REQUEST_TIMEOUT_MS,
    ): Promise<RequestUrlResponse> {
        return requestWithPolicy(
            (params) => requestUrl({ ...params, throw: false }),
            { url, headers },
            { timeoutMs, retries: 1, retryDelayMs: 800 },
        );
    }

    /** 把 401/403/429 的 GitHub 响应翻译成可执行提示 */
    private describeGitHubError(response: RequestUrlResponse, safeRepo: string): string {
        const headers = (response.headers || {}) as Record<string, string>;
        const remaining = headers['x-ratelimit-remaining'];
        const resetSeconds = Number(headers['x-ratelimit-reset']);
        const retryAfter = headers['retry-after'];
        let apiMessage = '';
        try {
            const body = response.json as Record<string, unknown>;
            if (typeof body?.message === 'string') apiMessage = body.message;
        } catch {
            // 非 JSON 错误体
        }
        const resetHint = Number.isFinite(resetSeconds) && resetSeconds > 0
            ? `，${new Date(resetSeconds * 1000).toLocaleTimeString('zh-CN')} 重置`
            : retryAfter ? `，${retryAfter}s 后重试` : '';

        if (response.status === 401) {
            return `GitHub Token 无效或已过期（401）：${safeRepo}`;
        }
        if (response.status === 429 || (response.status === 403 && remaining === '0')) {
            return `GitHub API 限流（未认证每小时 60 次）${resetHint}：${safeRepo}。可在设置中配置 GitHub Token，或稍后重试`;
        }
        if (response.status === 403) {
            return `GitHub API 拒绝请求（403）${apiMessage ? `：${apiMessage}` : ''}：${safeRepo}`;
        }
        if (response.status === 404) {
            return `仓库或 Release 不存在或无权访问（404）：${safeRepo}`;
        }
        return `GitHub API 返回 HTTP ${response.status}${apiMessage ? `：${apiMessage}` : ''}`;
    }

    /** 从自定义服务器检查更新 */
    private async checkCustomSource(url: string): Promise<VersionInfo> {
        let response: RequestUrlResponse;
        try {
            // v4.76.0：同 checkGitHub——移动端必须走 requestUrl
            response = await this.requestWithTimeout(url, { Accept: 'application/json' });
        } catch (e) {
            throw new UpdateCheckError(
                'network',
                `网络不可达（${url}）：${e instanceof Error ? e.message : String(e)}`
            );
        }

        if (response.status < 200 || response.status >= 300) {
            throw new UpdateCheckError('http', `更新服务器返回 HTTP ${response.status}`);
        }

        let data: Record<string, unknown>;
        try {
            data = response.json as Record<string, unknown>;
        } catch {
            throw new UpdateCheckError('parse', '更新服务器返回内容无法解析');
        }

        const version = String(data['version'] || '').replace(/^v/, '');
        if (!version) {
            throw new UpdateCheckError('parse', '更新服务器响应缺少 version 字段');
        }

        return {
            version,
            releaseDate: typeof data['releaseDate'] === 'string'
                ? data['releaseDate']
                : typeof data['published_at'] === 'string' ? data['published_at'] : undefined,
            releaseNotes: typeof data['releaseNotes'] === 'string'
                ? data['releaseNotes']
                : typeof data['body'] === 'string' ? data['body'] : '',
            downloadUrl: typeof data['downloadUrl'] === 'string'
                ? data['downloadUrl']
                : typeof data['html_url'] === 'string' ? data['html_url'] : '',
        };
    }

    /** 保存检查结果到缓存，并返回实际落盘的结果（失败时会合并上次成功版本） */
    private saveCheckResult(result: UpdateCheckResult): UpdateCheckResult {
        const now = new Date().toISOString();
        let next = result;
        if (result.error) {
            const previous = this.cacheManager.getUpdateLastResult() as UpdateCheckResult | null;
            if (previous?.latestVersion) {
                // 本次失败不能抹掉上次成功版本；保留版本并标记 stale，About 页可显示
                // 「上次已知 vX / 本次检查失败」，而不是整块变成红色失败。
                next = {
                    ...previous,
                    currentVersion: this.currentVersion,
                    hasUpdate: compareVersions(previous.latestVersion, this.currentVersion) > 0,
                    error: result.error,
                    errorKind: result.errorKind,
                    stale: true,
                    lastSuccessAt: previous.lastSuccessAt || previous.checkedAt,
                };
            }
        } else {
            next = {
                ...result,
                stale: false,
                checkedAt: now,
            };
            delete next.lastSuccessAt;
        }
        this.cacheManager.setUpdateLastCheck(now);
        this.cacheManager.setUpdateLastResult(next);
        return next;
    }

    /**
     * 标记更新通知已读（用户选择稍后提醒）
     *
     * @param version - 版本
     */
    markUpdateNotified(version: string): void {
        this.cacheManager.setUpdateNotifiedVersion(version);
    }

    /**
     * 判断是否已通知过该版本
     *
     * @param version - 版本
     * @returns 是否成功
     */
    hasNotifiedVersion(version: string): boolean {
        return this.cacheManager.getUpdateNotifiedVersion() === version;
    }
}

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

import { PluginCacheManager } from '../shared/plugin-cache';
import { GITHUB_REPO_SLUG, buildGitHubLatestReleaseApi, normalizeGitHubRepo } from '../shared/github-repo';

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

    constructor(
        currentVersion: string,
        cacheManager: PluginCacheManager,
        config?: Partial<UpdateCheckConfig>
    ) {
        this.currentVersion = currentVersion;
        this.cacheManager = cacheManager;
        this.config = { ...DEFAULT_UPDATE_CONFIG, ...config };
    }

    /** 更新配置 */
    updateConfig(config: Partial<UpdateCheckConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /** 获取当前版本 */
    getCurrentVersion(): string {
        return this.currentVersion;
    }

    /** 获取上次检查时间 */
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

    /** 判断是否应该检查更新（基于检查间隔） */
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
     */
    async checkForUpdates(force: boolean = false): Promise<UpdateCheckResult> {
        const baseResult: UpdateCheckResult = {
            hasUpdate: false,
            currentVersion: this.currentVersion,
        };

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
            this.saveCheckResult(result);
            return result;
        }
    }

    /** 从 GitHub Releases 检查更新 */
    private async checkGitHubRelease(repo: string): Promise<VersionInfo> {
        const safeRepo = normalizeGitHubRepo(repo);
        if (!safeRepo) {
            throw new UpdateCheckError('config', `GitHub 仓库格式不正确：${repo || '（空）'}`);
        }
        const url = buildGitHubLatestReleaseApi(safeRepo);
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (this.config.githubToken?.trim()) {
            headers.Authorization = `Bearer ${this.config.githubToken.trim()}`;
        }
        let response: Response;
        try {
            response = await fetch(url, { headers });
        } catch (e) {
            throw new UpdateCheckError(
                'network',
                `网络不可达（${safeRepo}）：${e instanceof Error ? e.message : String(e)}`
            );
        }

        if (!response.ok) {
            if (response.status === 404) {
                throw new UpdateCheckError('http', `仓库或 Release 不存在或无权访问（404）：${safeRepo}`);
            }
            if (response.status === 401 || response.status === 403) {
                throw new UpdateCheckError('http', `仓库无访问权限或 API 限流（${response.status}）：${safeRepo}`);
            }
            throw new UpdateCheckError('http', `GitHub API 返回 HTTP ${response.status}`);
        }

        let data: Record<string, unknown>;
        try {
            data = await response.json() as Record<string, unknown>;
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

    /** 从自定义服务器检查更新 */
    private async checkCustomSource(url: string): Promise<VersionInfo> {
        let response: Response;
        try {
            response = await fetch(url);
        } catch (e) {
            throw new UpdateCheckError(
                'network',
                `网络不可达（${url}）：${e instanceof Error ? e.message : String(e)}`
            );
        }

        if (!response.ok) {
            throw new UpdateCheckError('http', `更新服务器返回 HTTP ${response.status}`);
        }

        let data: Record<string, unknown>;
        try {
            data = await response.json() as Record<string, unknown>;
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

    /** 保存检查结果到缓存 */
    private saveCheckResult(result: UpdateCheckResult): void {
        this.cacheManager.setUpdateLastCheck(new Date().toISOString());
        this.cacheManager.setUpdateLastResult(result);
    }

    /** 标记更新通知已读（用户选择稍后提醒） */
    markUpdateNotified(version: string): void {
        this.cacheManager.setUpdateNotifiedVersion(version);
    }

    /** 判断是否已通知过该版本 */
    hasNotifiedVersion(version: string): boolean {
        return this.cacheManager.getUpdateNotifiedVersion() === version;
    }
}

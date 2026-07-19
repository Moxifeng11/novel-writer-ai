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
    customUrl?: string;
    checkIntervalHours: number;
}

/** 更新检查结果 */
export interface UpdateCheckResult {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseDate?: string;
    releaseNotes?: string;
    downloadUrl?: string;
    error?: string;
}

/** 默认配置 */
export const DEFAULT_UPDATE_CONFIG: UpdateCheckConfig = {
    enabled: false,
    source: 'github',
    githubRepo: 'trae-ai/novel-writer-ai',
    customUrl: '',
    checkIntervalHours: 168,
};

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
        return lastCheck ? new Date(lastCheck) : null;
    }

    /** 获取上次检查结果 */
    getLastCheckResult(): UpdateCheckResult | null {
        return this.cacheManager.getUpdateLastResult() as UpdateCheckResult | null;
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
            let latestInfo: VersionInfo | null = null;

            if (this.config.source === 'github' && this.config.githubRepo) {
                latestInfo = await this.checkGitHubRelease(this.config.githubRepo);
            } else if (this.config.source === 'custom' && this.config.customUrl) {
                latestInfo = await this.checkCustomSource(this.config.customUrl);
            }

            if (!latestInfo) {
                const result: UpdateCheckResult = {
                    ...baseResult,
                    error: '未配置有效的更新源',
                };
                this.saveCheckResult(result);
                return result;
            }

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
            };
            this.saveCheckResult(result);
            return result;
        }
    }

    /** 从 GitHub Releases 检查更新 */
    private async checkGitHubRelease(repo: string): Promise<VersionInfo | null> {
        const url = `https://api.github.com/repos/${repo}/releases/latest`;
        try {
            const response = await fetch(url, {
                headers: { Accept: 'application/vnd.github.v3+json' },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return {
                version: data.tag_name?.replace(/^v/, '') || data.name || '',
                releaseDate: data.published_at,
                releaseNotes: data.body || '',
                downloadUrl: data.html_url || '',
            };
        } catch {
            return null;
        }
    }

    /** 从自定义服务器检查更新 */
    private async checkCustomSource(url: string): Promise<VersionInfo | null> {
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            return {
                version: data.version || '',
                releaseDate: data.releaseDate || data.published_at || '',
                releaseNotes: data.releaseNotes || data.body || '',
                downloadUrl: data.downloadUrl || data.html_url || '',
            };
        } catch {
            return null;
        }
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

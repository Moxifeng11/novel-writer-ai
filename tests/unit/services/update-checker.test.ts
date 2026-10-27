import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    UpdateChecker,
    DEFAULT_UPDATE_CONFIG,
    compareVersions,
} from '../../../services/update-checker';
import type { PluginCacheManager } from '../../../shared/plugin-cache';

/** 构造仅实现更新检查所需方法的内存缓存 */
function makeCache(): PluginCacheManager {
    let lastCheck: string | undefined;
    let lastResult: unknown;
    return {
        getUpdateLastCheck: () => lastCheck,
        setUpdateLastCheck: (time: string) => { lastCheck = time; },
        getUpdateLastResult: () => lastResult,
        setUpdateLastResult: (result: unknown) => { lastResult = result; },
        getUpdateNotifiedVersion: () => undefined,
        setUpdateNotifiedVersion: () => undefined,
    } as unknown as PluginCacheManager;
}

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

describe('UpdateChecker — 默认配置', () => {
    it('默认仓库与真实发布仓库一致', () => {
        expect(DEFAULT_UPDATE_CONFIG.githubRepo).toBe('Moxifeng11/novel-writer-ai');
    });

    it('默认关闭自动检查', () => {
        expect(DEFAULT_UPDATE_CONFIG.enabled).toBe(false);
    });
});

describe('compareVersions', () => {
    it('正确比较版本号', () => {
        expect(compareVersions('4.11.0', '4.10.9')).toBe(1);
        expect(compareVersions('4.11.0', '4.11.0')).toBe(0);
        expect(compareVersions('v4.9.0', '4.10.0')).toBe(-1);
    });
});

describe('UpdateChecker — GitHub 源', () => {
    let cache: PluginCacheManager;

    beforeEach(() => {
        cache = makeCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('新版本 tag 返回 hasUpdate=true', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            tag_name: 'v4.12.0',
            published_at: '2026-10-01T00:00:00Z',
            body: 'release notes',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.12.0',
        })));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.hasUpdate).toBe(true);
        expect(result.latestVersion).toBe('4.12.0');
        expect(result.error).toBeUndefined();
    });

    it('仓库 404 返回 http 错误', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.hasUpdate).toBe(false);
        expect(result.errorKind).toBe('http');
        expect(result.error).toContain('404');
    });

    it('仓库 403 返回 http 错误', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 403)));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('http');
        expect(result.error).toContain('403');
    });

    it('网络不可达返回 network 错误', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('fetch failed');
        }));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('network');
        expect(result.error).toContain('网络不可达');
    });

    it('JSON 解析失败返回 parse 错误', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new Error('invalid json'); },
        } as unknown as Response)));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('parse');
    });

    it('缺少版本号返回 parse 错误', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ body: 'no tag' })));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('parse');
        expect(result.error).toContain('缺少版本号');
    });
});

describe('UpdateChecker — 自定义源', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('缺少自定义 URL 返回 config 错误', async () => {
        const checker = new UpdateChecker('4.11.0', makeCache(), {
            source: 'custom',
            customUrl: '',
        });
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('config');
    });

    it('自定义源正常返回版本', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            version: 'v4.12.0',
            releaseNotes: 'notes',
        })));
        const checker = new UpdateChecker('4.11.0', makeCache(), {
            source: 'custom',
            customUrl: 'https://example.com/update.json',
        });
        const result = await checker.checkForUpdates(true);
        expect(result.hasUpdate).toBe(true);
        expect(result.latestVersion).toBe('4.12.0');
    });
});

describe('UpdateChecker — 缓存版本对齐', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('升级后旧缓存 currentVersion 会被当前版本纠正', () => {
        const cache = makeCache();
        cache.setUpdateLastCheck(new Date().toISOString());
        cache.setUpdateLastResult({
            hasUpdate: false,
            currentVersion: '4.12.4',
            latestVersion: '4.14.0',
        });
        const checker = new UpdateChecker('4.18.0', cache);

        const result = checker.getLastCheckResult();

        expect(result?.currentVersion).toBe('4.18.0');
        expect(result?.hasUpdate).toBe(false);
    });

    it('旧缓存只有错误、没有 latestVersion 时触发新检查', async () => {
        const cache = makeCache();
        cache.setUpdateLastCheck(new Date().toISOString());
        cache.setUpdateLastResult({
            hasUpdate: false,
            currentVersion: '4.12.4',
            error: 'old 404',
            errorKind: 'http',
        });
        const fetchSpy = vi.fn(async () => jsonResponse({
            tag_name: 'v4.18.0',
            published_at: '2026-10-26T00:00:00Z',
            body: '',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.18.0',
        }));
        vi.stubGlobal('fetch', fetchSpy);
        const checker = new UpdateChecker('4.18.0', cache);

        expect(checker.getLastCheckResult()).toBeNull();
        expect((cache.getUpdateLastResult() as { currentVersion: string }).currentVersion).toBe('4.18.0');
        const result = await checker.checkForUpdates(false);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(result.currentVersion).toBe('4.18.0');
        expect(result.error).toBeUndefined();
    });
});

describe('UpdateChecker — 清空旧仓库缓存', () => {
    it('clearCache 后旧结果消失且立即可重新检查', () => {
        const cache = makeCache();
        cache.setUpdateLastCheck('not-a-date');
        cache.setUpdateLastResult({
            hasUpdate: false,
            currentVersion: '4.18.0',
            error: 'old repo 404',
            errorKind: 'http',
        });
        const checker = new UpdateChecker('4.18.0', cache, { enabled: true });

        expect(checker.getLastCheckTime()).toBeNull();
        checker.clearCache();
        expect(checker.getLastCheckResult()).toBeNull();
        expect(checker.shouldCheck()).toBe(true);
    });
});

describe('UpdateChecker — GitHub 仓库与 Token', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('私有仓库 Token 会写入 Authorization 头', async () => {
        const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => jsonResponse({
            tag_name: 'v4.18.0',
            published_at: '2026-10-26T00:00:00Z',
            body: '',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.18.0',
        }));
        vi.stubGlobal('fetch', fetchSpy);
        const checker = new UpdateChecker('4.18.0', makeCache(), {
            enabled: true,
            githubRepo: 'Moxifeng11/novel-writer-ai',
            githubToken: 'secret-token',
        });

        await checker.checkForUpdates(true);

        const [, init] = fetchSpy.mock.calls[0];
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    });

    it('非法仓库格式返回 config 错误且不请求 GitHub', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const checker = new UpdateChecker('4.18.0', makeCache(), {
            enabled: true,
            githubRepo: 'not a repo',
        });

        const result = await checker.checkForUpdates(true);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.errorKind).toBe('config');
    });
});

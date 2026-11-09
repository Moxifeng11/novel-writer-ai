import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * v4.76.0：更新检查改走 `requestUrl`（移动端 fetch 无 CORS 豁免）。
 * 因此这里 mock 的是 obsidian 的 requestUrl，而不是全局 fetch；
 * 返回形状用 `RequestUrlResponse` 的 `{ status, json }`（原实现断言 `response.ok`）。
 */
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual,
        requestUrl: (...args: unknown[]) => requestUrlMock(...args),
    };
});

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

/** RequestUrlResponse 只用到 status 与 json；json 由代码在 try 内同步取值 */
function jsonResponse(body: unknown, status = 200): { status: number; json: unknown } {
    return { status, json: body };
}

function setResponse(body: unknown, status = 200): void {
    requestUrlMock.mockResolvedValue(jsonResponse(body, status));
}

beforeEach(() => {
    requestUrlMock.mockReset();
});

afterEach(() => {
    requestUrlMock.mockReset();
});

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

    it('新版本 tag 返回 hasUpdate=true', async () => {
        setResponse({
            tag_name: 'v4.12.0',
            published_at: '2026-10-01T00:00:00Z',
            body: 'release notes',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.12.0',
        });
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.hasUpdate).toBe(true);
        expect(result.latestVersion).toBe('4.12.0');
        expect(result.error).toBeUndefined();
    });

    it('仓库 404 返回 http 错误', async () => {
        setResponse({}, 404);
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.hasUpdate).toBe(false);
        expect(result.errorKind).toBe('http');
        expect(result.error).toContain('404');
    });

    it('仓库 403 返回 http 错误', async () => {
        setResponse({}, 403);
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('http');
        expect(result.error).toContain('403');
    });

    it('网络不可达返回 network 错误', async () => {
        requestUrlMock.mockRejectedValue(new Error('request failed'));
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('network');
        expect(result.error).toContain('网络不可达');
    });

    it('JSON 解析失败返回 parse 错误', async () => {
        requestUrlMock.mockResolvedValue({
            status: 200,
            get json(): unknown { throw new Error('invalid json'); },
        });
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('parse');
    });

    it('缺少版本号返回 parse 错误', async () => {
        setResponse({ body: 'no tag' });
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('parse');
        expect(result.error).toContain('缺少版本号');
    });

    it('请求带上 User-Agent 与 GitHub JSON Accept', async () => {
        setResponse({ tag_name: '4.12.0' });
        const checker = new UpdateChecker('4.11.0', cache);
        await checker.checkForUpdates(true);
        const init = requestUrlMock.mock.calls[0]?.[0] as { headers?: Record<string, string> };
        expect(init.headers?.['User-Agent']).toContain('NovelWriterAI/');
        expect(init.headers?.Accept).toBe('application/vnd.github+json');
    });

    it('API 403 限流时回退 releases.atom', async () => {
        requestUrlMock.mockImplementation((args: { url: string }) => {
            if (args.url.includes('api.github.com')) {
                return Promise.resolve({
                    status: 403,
                    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4102444800' },
                    json: { message: 'API rate limit exceeded' },
                });
            }
            if (args.url.endsWith('releases.atom')) {
                return Promise.resolve({
                    status: 200,
                    text: '<feed><entry><title>v4.99.0</title><updated>2026-11-09T00:00:00Z</updated><link href="https://github.com/x/y/releases/tag/v4.99.0"/></entry></feed>',
                });
            }
            return Promise.resolve({ status: 404 });
        });
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.error).toBeUndefined();
        expect(result.latestVersion).toBe('4.99.0');
        expect(result.hasUpdate).toBe(true);
    });

    it('401 会明确提示 Token 无效', async () => {
        setResponse({ message: 'Bad credentials' }, 401);
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.error).toContain('Token 无效');
    });

    it('429 会按限流处理并尝试备用源', async () => {
        requestUrlMock.mockImplementation((args: { url: string }) => {
            if (args.url.includes('api.github.com')) {
                return Promise.resolve({ status: 429, headers: { 'retry-after': '30' }, json: {} });
            }
            return Promise.resolve({ status: 404 });
        });
        const checker = new UpdateChecker('4.11.0', cache);
        const result = await checker.checkForUpdates(true);
        expect(result.error).toContain('限流');
        expect(result.error).toContain('30s');
    });

    it('本次失败保留上次成功版本并标记 stale', async () => {
        setResponse({ tag_name: '4.12.0', html_url: 'https://example.com/release' });
        const first = new UpdateChecker('4.11.0', cache);
        const success = await first.checkForUpdates(true);
        expect(success.latestVersion).toBe('4.12.0');

        requestUrlMock.mockImplementation((args: { url: string }) => {
            if (args.url.includes('api.github.com')) {
                return Promise.resolve({ status: 403, headers: {}, json: { message: 'forbidden' } });
            }
            return Promise.resolve({ status: 404 });
        });
        const second = new UpdateChecker('4.11.0', cache);
        const failed = await second.checkForUpdates(true);
        expect(failed.error).toBeTruthy();
        expect(failed.stale).toBe(true);
        expect(failed.latestVersion).toBe('4.12.0');
        expect(failed.hasUpdate).toBe(true);
    });
});

describe('UpdateChecker — 自定义源', () => {
    it('缺少自定义 URL 返回 config 错误', async () => {
        const checker = new UpdateChecker('4.11.0', makeCache(), {
            source: 'custom',
            customUrl: '',
        });
        const result = await checker.checkForUpdates(true);
        expect(result.errorKind).toBe('config');
    });

    it('自定义源正常返回版本', async () => {
        setResponse({
            version: 'v4.12.0',
            releaseNotes: 'notes',
        });
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
        setResponse({
            tag_name: 'v4.18.0',
            published_at: '2026-10-26T00:00:00Z',
            body: '',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.18.0',
        });
        const checker = new UpdateChecker('4.18.0', cache);

        expect(checker.getLastCheckResult()).toBeNull();
        expect((cache.getUpdateLastResult() as { currentVersion: string }).currentVersion).toBe('4.18.0');
        const result = await checker.checkForUpdates(false);

        expect(requestUrlMock).toHaveBeenCalledTimes(1);
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
    it('私有仓库 Token 会写入 Authorization 头', async () => {
        setResponse({
            tag_name: 'v4.18.0',
            published_at: '2026-10-26T00:00:00Z',
            body: '',
            html_url: 'https://github.com/Moxifeng11/novel-writer-ai/releases/tag/v4.18.0',
        });
        const checker = new UpdateChecker('4.18.0', makeCache(), {
            enabled: true,
            githubRepo: 'Moxifeng11/novel-writer-ai',
            githubToken: 'secret-token',
        });

        await checker.checkForUpdates(true);

        const [init] = requestUrlMock.mock.calls[0] as [ { headers?: Record<string, string> } ];
        expect(init?.headers?.Authorization).toBe('Bearer secret-token');
    });

    it('非法仓库格式返回 config 错误且不请求 GitHub', async () => {
        const checker = new UpdateChecker('4.18.0', makeCache(), {
            enabled: true,
            githubRepo: 'not a repo',
        });

        const result = await checker.checkForUpdates(true);

        expect(requestUrlMock).not.toHaveBeenCalled();
        expect(result.errorKind).toBe('config');
    });
});

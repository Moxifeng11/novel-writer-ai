import { describe, it, expect, beforeEach } from 'vitest';
import {
    disposeInlineWorkerUrls,
    getWorkerRuntimeMode,
    probePluginWorkers,
    resolveInlineWorkerUrl,
    resolvePluginWorkerUrl,
    notifyWorkerUnavailable,
    resetWorkerDegradationNotified,
    resetWorkerDiskProbe,
} from '../../../shared/plugin-worker-url';
import { getDegradationNotifier } from '../../../shared/degradation-notifier';
import { setPluginRootDir } from '../../../shared/paths';

function makeApp(adapter: Record<string, unknown>, configDir = '.obsidian') {
    return { vault: { configDir, adapter } } as unknown as Parameters<typeof resolvePluginWorkerUrl>[0];
}

describe('resolvePluginWorkerUrl', () => {
    beforeEach(() => {
        // 路径单源：worker URL 取 onload 注入的插件根目录
        setPluginRootDir('.obsidian/plugins/novel-writer-ai');
    });

    it('优先使用 adapter.getResourcePath 并指向插件 workers 目录', () => {
        const calls: string[] = [];
        const app = makeApp({
            getResourcePath: (path: string) => {
                calls.push(path);
                return `app://vault/${path}`;
            },
        });
        const url = resolvePluginWorkerUrl(app, 'deconstruction-worker.js');
        expect(url).toBe('app://vault/.obsidian/plugins/novel-writer-ai/workers/deconstruction-worker.js');
        expect(calls).toHaveLength(1);
    });

    it('尊重自定义 configDir（根目录由 setPluginRootDir 注入）', () => {
        setPluginRootDir('.config/obsidian/plugins/novel-writer-ai');
        const app = makeApp({
            getResourcePath: (path: string) => `app://vault/${path}`,
        }, '.config/obsidian');
        const url = resolvePluginWorkerUrl(app, 'quality-worker.js');
        expect(url).toContain('.config/obsidian/plugins/novel-writer-ai/workers/quality-worker.js');
    });

    it('BRAT 改插件文件夹名时跟随注入根目录，不再硬拼 plugin id', () => {
        setPluginRootDir('.obsidian/plugins/obsidian-novel-writer-ai');
        const app = makeApp({
            getResourcePath: (path: string) => `app://vault/${path}`,
        });
        const url = resolvePluginWorkerUrl(app, 'quality-worker.js');
        expect(url).toBe('app://vault/.obsidian/plugins/obsidian-novel-writer-ai/workers/quality-worker.js');
    });

    it('缺少 getResourcePath 时回退 getBasePath', () => {
        const app = makeApp({
            getBasePath: () => 'C:\\vault',
        });
        const url = resolvePluginWorkerUrl(app, 'quality-worker.js');
        expect(url).toBe('file:///C:/vault/.obsidian/plugins/novel-writer-ai/workers/quality-worker.js');
    });

    it('adapter 缺路径 API 时退回内联 Blob（3 文件安装/移动端路径）', () => {
        const app = makeApp({});
        const url = resolvePluginWorkerUrl(app, 'quality-worker.js');
        expect(url === null || url.startsWith('blob:')).toBe(true);
    });

    it('没有 vault 时返回 null（宿主不可用）', () => {
        expect(resolvePluginWorkerUrl({} as unknown as Parameters<typeof resolvePluginWorkerUrl>[0], 'quality-worker.js')).toBeNull();
    });
});

describe('notifyWorkerUnavailable', () => {
    beforeEach(() => {
        resetWorkerDegradationNotified();
        getDegradationNotifier().clear();
    });

    it('会话内只发一次降级通知', () => {
        notifyWorkerUnavailable('测试原因 1');
        notifyWorkerUnavailable('测试原因 2');
        const events = getDegradationNotifier().getEvents();
        expect(events).toHaveLength(1);
        expect(events[0].source).toBe('worker');
        expect(events[0].to).toBe('main-thread');
        expect(events[0].reason).toBe('测试原因 1');
    });
});

describe('内联 Worker（社区 3 文件安装）', () => {
    beforeEach(() => {
        setPluginRootDir('.obsidian/plugins/novel-writer-ai');
        resetWorkerDiskProbe();
        disposeInlineWorkerUrls();
    });

    it('探测到磁盘有 workers → runtime=worker，解析走文件 URL', async () => {
        const app = makeApp({
            exists: async () => true,
            getResourcePath: (path: string) => `app://vault/${path}`,
        });
        await expect(probePluginWorkers(app)).resolves.toBe(true);
        expect(getWorkerRuntimeMode()).toBe('worker');
        expect(resolvePluginWorkerUrl(app, 'quality-worker.js')).toContain('/workers/quality-worker.js');
    });

    it('磁盘没有 workers → runtime=worker-inline，解析返回 Blob URL', async () => {
        const created: string[] = [];
        const blobUrls = new Map<string, string>();
        const OriginalURL = globalThis.URL;
        (globalThis as unknown as { URL: typeof URL }).URL = class extends OriginalURL {
            static createObjectURL(blob: Blob): string {
                const url = `blob:nw/${created.length}`;
                created.push(url);
                blobUrls.set(url, String(blob));
                return url;
            }
            static revokeObjectURL(url: string): void {
                blobUrls.delete(url);
            }
        } as unknown as typeof URL;
        try {
            const app = makeApp({
                exists: async () => false,
                getResourcePath: (path: string) => `app://vault/${path}`,
            });
            await expect(probePluginWorkers(app)).resolves.toBe(false);
            expect(getWorkerRuntimeMode()).toBe('worker-inline');
            const url = resolvePluginWorkerUrl(app, 'deconstruction-worker.js');
            expect(url).toMatch(/^blob:nw\//);
            if (!url) throw new Error('expected blob url');
            // 同一 worker 复用同一 Blob URL
            expect(resolvePluginWorkerUrl(app, 'deconstruction-worker.js')).toBe(url);
            // 内联源码非空且是 worker 代码
            expect(resolveInlineWorkerUrl('quality-worker.js')).toMatch(/^blob:nw\//);
            expect(blobUrls.get(url as string) ?? '').not.toHaveLength(0);
            disposeInlineWorkerUrls();
            expect(blobUrls.size).toBe(0);
        } finally {
            (globalThis as unknown as { URL: typeof URL }).URL = OriginalURL;
        }
    });

    it('无内联源码的 worker 名返回 null 而不是抛错', () => {
        expect(resolveInlineWorkerUrl('not-exist.js')).toBeNull();
    });
});

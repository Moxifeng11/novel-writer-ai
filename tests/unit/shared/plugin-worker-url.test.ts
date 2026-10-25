import { describe, it, expect, beforeEach } from 'vitest';
import {
    resolvePluginWorkerUrl,
    notifyWorkerUnavailable,
    resetWorkerDegradationNotified,
} from '../../../shared/plugin-worker-url';
import { getDegradationNotifier } from '../../../shared/degradation-notifier';

function makeApp(adapter: Record<string, unknown>, configDir = '.obsidian') {
    return { vault: { configDir, adapter } } as unknown as Parameters<typeof resolvePluginWorkerUrl>[0];
}

describe('resolvePluginWorkerUrl', () => {
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

    it('尊重自定义 configDir', () => {
        const app = makeApp({
            getResourcePath: (path: string) => `app://vault/${path}`,
        }, '.config/obsidian');
        const url = resolvePluginWorkerUrl(app, 'quality-worker.js');
        expect(url).toContain('.config/obsidian/plugins/novel-writer-ai/workers/quality-worker.js');
    });

    it('缺少 getResourcePath 时回退 getBasePath', () => {
        const app = makeApp({
            getBasePath: () => 'C:\\vault',
        });
        const url = resolvePluginWorkerUrl(app, 'style-worker.js');
        expect(url).toBe('file:///C:/vault/.obsidian/plugins/novel-writer-ai/workers/style-worker.js');
    });

    it('无法解析时返回 null', () => {
        const app = makeApp({});
        expect(resolvePluginWorkerUrl(app, 'style-worker.js')).toBeNull();
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

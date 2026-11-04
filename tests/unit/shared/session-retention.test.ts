import { describe, it, expect, vi } from 'vitest';
import {
    pruneSessions,
    SESSION_RETENTION_DEFAULTS,
    type RetentionTarget,
    type RetentionFileInfo,
} from '../../../shared/session-retention';

/**
 * 内存版 RetentionTarget：用 Map 模拟会话文件落点，可注入删除失败与豁免列表。
 */
function createMemoryPort(
    files: RetentionFileInfo[],
    options?: { failRemove?: Set<string>; keep?: string[] }
): { port: RetentionTarget; existingPaths: () => string[]; removed: string[] } {
    const state = new Map(files.map((f) => [f.path, f]));
    const removed: string[] = [];
    const port: RetentionTarget = {
        list: async () => [...state.values()],
        remove: async (path: string) => {
            if (options?.failRemove?.has(path)) {
                throw new Error(`模拟删除失败: ${path}`);
            }
            if (!state.has(path)) {
                throw new Error(`文件不存在: ${path}`);
            }
            state.delete(path);
            removed.push(path);
        },
        keep: options?.keep,
    };
    return { port, existingPaths: () => [...state.keys()], removed };
}

describe('session-retention', () => {
    describe('SESSION_RETENTION_DEFAULTS', () => {
        it('保守 MVP 默认值为各 30 个', () => {
            expect(SESSION_RETENTION_DEFAULTS.analysisSessions).toBe(30);
            expect(SESSION_RETENTION_DEFAULTS.agentSessions).toBe(30);
        });
    });

    describe('pruneSessions', () => {
        it('按 mtime 降序保留前 maxCount 个，其余删除', async () => {
            const files = [
                { path: 'a.jsonl', mtime: 500 },
                { path: 'b.jsonl', mtime: 400 },
                { path: 'c.jsonl', mtime: 300 },
                { path: 'd.jsonl', mtime: 200 },
                { path: 'e.jsonl', mtime: 100 },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files);
            const results = await pruneSessions([{ label: 'agent', port, maxCount: 3 }]);

            // 最新的 3 个保留，最旧的 2 个删除（从最旧端开始遍历删除）
            expect(existingPaths().sort()).toEqual(['a.jsonl', 'b.jsonl', 'c.jsonl']);
            expect(removed).toEqual(['d.jsonl', 'e.jsonl']);
            expect(results).toEqual([{ label: 'agent', removed: ['d.jsonl', 'e.jsonl'] }]);
        });

        it('mtime 缺失视为最旧（优先被修剪）', async () => {
            const files = [
                { path: 'no-mtime-1.jsonl' },
                { path: 'has-mtime.jsonl', mtime: 100 },
                { path: 'no-mtime-2.jsonl' },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files);
            await pruneSessions([{ label: 'agent', port, maxCount: 1 }]);

            // 唯一有 mtime 的保留，两个缺失 mtime 的都删
            expect(existingPaths()).toEqual(['has-mtime.jsonl']);
            expect(removed.sort()).toEqual(['no-mtime-1.jsonl', 'no-mtime-2.jsonl']);
        });

        it('keep 列表中的路径永不删除（即使排在保留窗口之外）', async () => {
            const files = [
                { path: 'new.jsonl', mtime: 300 },
                { path: 'mid.jsonl', mtime: 200 },
                { path: 'old.jsonl', mtime: 100 },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files, { keep: ['old.jsonl'] });
            await pruneSessions([{ label: 'agent', port, maxCount: 1 }]);

            // new 在窗口内保留；old 虽最旧但被豁免；mid 被删
            expect(existingPaths().sort()).toEqual(['new.jsonl', 'old.jsonl']);
            expect(removed).toEqual(['mid.jsonl']);
        });

        it('keep 中的 mtime 缺失路径同样豁免', async () => {
            const files = [
                { path: 'new.jsonl', mtime: 100 },
                { path: 'keep-me.jsonl' },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files, { keep: ['keep-me.jsonl'] });
            await pruneSessions([{ label: 'agent', port, maxCount: 1 }]);

            expect(existingPaths().sort()).toEqual(['keep-me.jsonl', 'new.jsonl']);
            expect(removed).toEqual([]);
        });

        it('单条删除失败 log.warn 继续，但不计入 removed', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const files = [
                    { path: 'a.jsonl', mtime: 300 },
                    { path: 'b.jsonl', mtime: 250 },
                    { path: 'boom.jsonl', mtime: 100 },
                    { path: 'c.jsonl', mtime: 50 },
                ];
                const { port, existingPaths, removed } = createMemoryPort(files, {
                    failRemove: new Set(['boom.jsonl']),
                });
                const results = await pruneSessions([{ label: 'agent', port, maxCount: 2 }]);

                // a/b 在窗口内保留；boom 删除失败被跳过；c 照常删除
                expect(existingPaths().sort()).toEqual(['a.jsonl', 'b.jsonl', 'boom.jsonl']);
                expect(removed).toEqual(['c.jsonl']);
                expect(results).toEqual([{ label: 'agent', removed: ['c.jsonl'] }]);
                expect(warnSpy).toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('数量未超上限时不删除任何文件', async () => {
            const files = [
                { path: 'a.jsonl', mtime: 200 },
                { path: 'b.jsonl', mtime: 100 },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files);
            await pruneSessions([{ label: 'agent', port, maxCount: 30 }]);

            expect(existingPaths().sort()).toEqual(['a.jsonl', 'b.jsonl']);
            expect(removed).toEqual([]);
        });

        it('多个目标独立修剪，结果按入参顺序返回', async () => {
            const agent = createMemoryPort([
                { path: 'agent-1.jsonl', mtime: 100 },
                { path: 'agent-2.jsonl', mtime: 50 },
            ]);
            const analysis = createMemoryPort([
                { path: 'a1.json', mtime: 100 },
                { path: 'a2.json', mtime: 50 },
            ]);
            const results = await pruneSessions([
                { label: 'analysis', port: analysis.port, maxCount: 1 },
                { label: 'agent', port: agent.port, maxCount: 1 },
            ]);

            expect(results).toEqual([
                { label: 'analysis', removed: ['a2.json'] },
                { label: 'agent', removed: ['agent-2.jsonl'] },
            ]);
            expect(analysis.existingPaths()).toEqual(['a1.json']);
            expect(agent.existingPaths()).toEqual(['agent-1.jsonl']);
        });

        it('某目标 list 失败时跳过该目标，不影响其它目标', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const broken: RetentionTarget = {
                    list: async () => {
                        throw new Error('列举失败');
                    },
                    remove: async () => {
                        throw new Error('不应被调用');
                    },
                };
                const healthy = createMemoryPort([
                    { path: 'a.jsonl', mtime: 100 },
                    { path: 'b.jsonl', mtime: 50 },
                ]);
                const results = await pruneSessions([
                    { label: 'broken', port: broken, maxCount: 1 },
                    { label: 'healthy', port: healthy.port, maxCount: 1 },
                ]);

                expect(results).toEqual([
                    { label: 'broken', removed: [] },
                    { label: 'healthy', removed: ['b.jsonl'] },
                ]);
                expect(warnSpy).toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('maxCount 为 0 时删除全部未豁免文件', async () => {
            const files = [
                { path: 'a.jsonl', mtime: 100 },
                { path: 'keep.jsonl', mtime: 50 },
            ];
            const { port, existingPaths, removed } = createMemoryPort(files, { keep: ['keep.jsonl'] });
            await pruneSessions([{ label: 'agent', port, maxCount: 0 }]);

            expect(existingPaths()).toEqual(['keep.jsonl']);
            expect(removed).toEqual(['a.jsonl']);
        });
    });
});

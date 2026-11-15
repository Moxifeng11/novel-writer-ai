/**
 * C3：断言索引重建（事实库/摘要/档案/台账 → 断言.json 派生）
 */

import { describe, expect, it } from 'vitest';
import { rebuildAssertionsWithDeps } from '@/engine/consistency/consistency-audit-wiring';
import type { ConsistencyAuditDeps } from '@/engine/consistency/consistency-service';
import type { FileSystemPort } from '@/shared/file-system-port';

const PROJECT = '长篇小说/甲';

const makeFs = () => {
    const store = new Map<string, string>();
    const fs = {
        read: async (path: string) => store.get(path) ?? '',
        write: async (path: string, content: string) => { store.set(path, content); },
        exists: async (path: string) => store.has(path),
        rename: async (from: string, to: string) => { const c = store.get(from) ?? ''; store.delete(from); store.set(to, c); },
        mkdir: async () => undefined,
    } as unknown as FileSystemPort;
    return { fs, store };
};

const makeDeps = (fs: FileSystemPort, extra: Partial<ConsistencyAuditDeps> = {}): ConsistencyAuditDeps => ({
    fs,
    listDigests: async () => [],
    listCharacters: async () => [{ name: '林玄', frontmatter: { 年龄: 18, 境界: '练气三层' } }],
    listLedgerEvents: async () => [],
    listConfirmedFacts: async () => [],
    loadChapterBody: async () => '',
    ...extra,
} as ConsistencyAuditDeps);

describe('rebuildAssertionsWithDeps', () => {
    it('从人物档案派生出断言并落盘', async () => {
        const { fs, store } = makeFs();
        const result = await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs), { now: () => new Date('2026-11-15T00:00:00Z') });
        expect(result.dryRun).toBe(false);
        expect(result.count).toBeGreaterThan(0);
        expect(result.path).toContain('断言.json');
        expect(store.has(result.path)).toBe(true);
        const payload = JSON.parse(store.get(result.path) as string);
        expect(payload.assertions.length).toBe(result.count);
    });

    it('重复重建幂等（不重复累积）', async () => {
        const { fs } = makeFs();
        const first = await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs));
        const second = await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs));
        expect(second.count).toBe(first.count);
    });

    it('dry-run 不写盘', async () => {
        const { fs, store } = makeFs();
        const result = await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs), { dryRun: true });
        expect(result.dryRun).toBe(true);
        expect(result.count).toBeGreaterThan(0);
        expect(store.size).toBe(0);
    });

    it('已有断言文件时先备份', async () => {
        const { fs, store } = makeFs();
        await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs));
        const before = [...store.keys()].filter(k => k.includes('断言.json'));
        expect(before).toHaveLength(1);
        const result = await rebuildAssertionsWithDeps(PROJECT, makeDeps(fs), { now: () => new Date('2026-11-15T01:00:00Z') });
        expect(result.backup).toBeTruthy();
        expect(store.has(result.backup as string)).toBe(true);
    });
});

/**
 * M4：上下文装配服务 + request_context 工具测试
 */

import { describe, expect, it, vi } from 'vitest';
import { App, Vault } from 'obsidian';
import { ContextSessionService } from '@/services/context-session-service';
import { createContextTools } from '@/engine/agent/harness/context-tools';

/** 假索引服务：按 id 返回条目。 */
const makeIndex = (entries: Array<{ id: string; path: string; name: string; summary?: string }>) => ({
    query: vi.fn(async (_project: string, query: { ids?: string[] }) => {
        const ids = query.ids ?? [];
        return entries.filter(entry => ids.includes(entry.id)).map(entry => ({
            id: entry.id, path: entry.path, name: entry.name, summary: entry.summary ?? '',
            kind: 'other', size: 1, mtime: 1,
        }));
    }),
});

const makeService = (entries: Array<{ id: string; path: string; name: string; summary?: string }>) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const entry of entries) vault._seedFile(entry.path, `正文：${entry.name}`);
    return new ContextSessionService(app, makeIndex(entries) as never);
};

describe('ContextSessionService', () => {
    it('按 ID 读取并加入批次', async () => {
        const service = makeService([{ id: 'CHR-0001', path: 'p/人物/林玄.md', name: '林玄' }]);
        const session = service.create({ sceneId: 'SC-1' });
        const next = await service.loadBatch('p', session, { kind: 'entity', ids: ['CHR-0001'] }, 'anchor');
        expect(next.batches).toHaveLength(1);
        expect(next.loaded['entity:CHR-0001'].text).toContain('林玄');
    });

    it('assemble 迭代补齐覆盖', async () => {
        const service = makeService([
            { id: 'CHR-0001', path: 'p/人物/林玄.md', name: '林玄' },
            { id: 'CHR-0002', path: 'p/人物/苏婉.md', name: '苏婉' },
        ]);
        const session = service.create({});
        const result = await service.assemble('p', session, [
            { kind: 'entity', ids: ['CHR-0001', 'CHR-0002'] },
        ]);
        expect(result.coverage.missing).toEqual([]);
        expect(result.pending).toEqual([]);
    });

    it('无进展时不死循环', async () => {
        const service = makeService([]);
        const result = await service.assemble('p', service.create({}), [
            { kind: 'entity', ids: ['CHR-9999'] },
        ], 6);
        expect(result.coverage.missing).toEqual(['entity:CHR-9999']);
        expect(result.pending).toHaveLength(1);
    });

    it('预算不足标记 budgetExhausted', async () => {
        const service = makeService([{ id: 'CHR-0001', path: 'p/人物/林玄.md', name: '林玄' }]);
        const session = service.create({ maxTokens: 500 });
        const next = await service.loadBatch('p', session, { kind: 'entity', ids: ['CHR-0001'] }, 'anchor');
        expect(next.unloaded.length).toBeGreaterThanOrEqual(0);
    });
});

describe('request_context 工具', () => {
    it('按 ids 补充并返回内容', async () => {
        const service = makeService([{ id: 'CHR-0001', path: 'p/人物/林玄.md', name: '林玄' }]);
        const tool = createContextTools(() => service, () => 'p', () => service.create({}))[0];
        const result = await tool.execute({ kind: 'entity', ids: ['CHR-0001'], reason: '核对' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('林玄');
    });

    it('缺 ids 时明确提示', async () => {
        const service = makeService([]);
        const tool = createContextTools(() => service, () => 'p', () => service.create({}))[0];
        const result = await tool.execute({ kind: 'entity' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('ids');
    });

    it('是只读工具', () => {
        const service = makeService([]);
        expect(createContextTools(() => service, () => 'p', () => null)[0].kind).toBe('read');
    });
});

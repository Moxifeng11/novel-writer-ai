import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { WritebackAuditService } from '@/services/writeback-audit-service';

const make = () => {
    const vault = new Vault();
    const app = new App();
    app.vault = vault;
    return { app, vault, service: new WritebackAuditService(app) };
};

const result = (over: Partial<{ accepted: number; unresolved: number; conflicts: number; rejected: number }> = {}) => ({
    adapter: { commands: [], unresolved: [] },
    validation: {
        accepted: Array.from({ length: over.accepted ?? 1 }, (_, i) => ({ op: 'update_entity' as const, fields: {}, targetId: `CHR-000${i}` })),
        rejected: Array.from({ length: over.rejected ?? 0 }, () => ({ command: { op: 'update_entity' as const, fields: {} }, reasons: ['x'] })),
        conflicts: Array.from({ length: over.conflicts ?? 0 }, () => ({ targetId: 'CHR-0001', field: 'x', kept: 1, dropped: 0 })),
        unresolved: Array.from({ length: over.unresolved ?? 0 }, () => ({ op: 'update_entity' as const, fields: {} })),
    },
    review: '待确认…',
    summary: '已结构化 1 条',
});

describe('WritebackAuditService', () => {
    it('记录后可按项目读回', async () => {
        const { service } = make();
        await service.record('长篇小说/书A', '第1章', result() as never);
        const entries = await service.load('长篇小说/书A');
        expect(entries).toHaveLength(1);
        expect(entries[0].chapter).toBe('第1章');
        expect(entries[0].counts.accepted).toBe(1);
    });

    it('多次记录累积', async () => {
        const { service } = make();
        await service.record('长篇小说/书A', '第1章', result() as never);
        await service.record('长篇小说/书A', '第2章', result({ accepted: 2 }) as never);
        const entries = await service.load('长篇小说/书A');
        expect(entries).toHaveLength(2);
        expect(entries[1].counts.accepted).toBe(2);
    });

    it('无记录返回空数组', async () => {
        const { service } = make();
        expect(await service.load('长篇小说/不存在')).toEqual([]);
    });

    it('不同项目互不影响', async () => {
        const { service } = make();
        await service.record('长篇小说/A', '第1章', result() as never);
        expect(await service.load('长篇小说/B')).toEqual([]);
    });
});

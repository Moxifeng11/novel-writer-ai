import { describe, expect, it, vi } from 'vitest';
import { WritebackReviewService } from '@/services/writeback-review-service';

const entries = [
    { id: 'CHR-0001', path: 'p/人物/CHR-0001_林玄.md', name: '林玄', type: 'character' as const, aliases: ['林玄'] },
    { id: 'REL-0001', path: 'p/关系/REL-0001_CHR-0001_CHR-0002.md', name: 'REL-0001', type: 'relation' as const, aliases: [] },
    { id: 'CHR-0002', path: 'p/人物/CHR-0002_苏婉.md', name: '苏婉', type: 'character' as const, aliases: ['苏婉'] },
];
const index = { ensure: vi.fn(async () => ({ version: 2, project: 'p', updatedAt: 0, entries: entries.map(e => ({ ...e, kind: 'other', size: 1, mtime: 1 })) })) };

describe('WritebackReviewService', () => {
    it('合法指令通过审查', async () => {
        const service = new WritebackReviewService(index as never);
        const result = await service.review('p', [
            { marker: 'UPDATE_CHARACTER', name: '林玄', fields: { 境界: '筑基' } },
        ]);
        expect(result.validation.accepted).toHaveLength(1);
        expect(result.validation.accepted[0].targetId).toBe('CHR-0001');
        expect(result.summary).toContain('合法 1');
    });

    it('未找到的实体进待确认', async () => {
        const service = new WritebackReviewService(index as never);
        const result = await service.review('p', [
            { marker: 'UPDATE_CHARACTER', name: '路人甲', fields: {} },
        ]);
        expect(result.adapter.unresolved).toHaveLength(1);
        expect(result.review).toContain('名称未解析');
    });

    it('类型不匹配视为未解析（防写错对象）', async () => {
        const service = new WritebackReviewService(index as never);
        const result = await service.review('p', [
            { marker: 'RELATION', name: '林玄', fields: { trust: 60 } },
        ]);
        // 林玄是 character，RELATION 需要关系卡 → 未解析
        expect(result.validation.accepted).toHaveLength(0);
    });

    it('数值越界被拒', async () => {
        const service = new WritebackReviewService(index as never);
        const result = await service.review('p', [
            { marker: 'RELATION', name: 'REL-0001', fields: { trust: 300 } },
        ]);
        expect(result.validation.rejected.length).toBeGreaterThan(0);
    });

    it('冲突记录进审查文本', async () => {
        const service = new WritebackReviewService(index as never);
        const result = await service.review('p', [
            { marker: 'UPDATE_CHARACTER', name: '林玄', fields: { 境界: 'a' } },
            { marker: 'UPDATE_CHARACTER', name: '林玄', fields: { 境界: 'b' } },
        ]);
        expect(result.validation.conflicts).toHaveLength(1);
        expect(result.review).toContain('冲突');
    });
});

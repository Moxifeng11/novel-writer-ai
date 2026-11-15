import { describe, expect, it } from 'vitest';
import { normalizeForeshadowStatus, renderDroppedSummary, sanitizeInstructions } from '@/shared/settlement-instruction-guard';

describe('sanitizeInstructions', () => {
    it('保留合法更新指令', () => {
        const result = sanitizeInstructions({ uc: [{ name: '林玄', field: '境界', value: '筑基' }] });
        expect(result.instructions.uc).toHaveLength(1);
        expect(result.dropped).toEqual([]);
    });

    it('丢弃空值/缺字段的指令', () => {
        const result = sanitizeInstructions({
            uc: [
                { name: '林玄', field: '境界', value: '' },
                { name: '林玄', field: '', value: 'x' },
                { name: '', field: '境界', value: 'y' },
            ],
        });
        expect(result.instructions.uc).toEqual([]);
        expect(result.dropped).toHaveLength(3);
    });

    it('丢弃非法伏笔状态', () => {
        const result = sanitizeInstructions({ uf: [{ name: '断剑', field: '状态', value: '半开' }] });
        expect(result.instructions.uf).toEqual([]);
        expect(result.dropped[0].reason).toContain('伏笔状态非法');
    });

    it('接受中文伏笔状态别名', () => {
        const result = sanitizeInstructions({ uf: [{ name: '断剑', field: '状态', value: '已回收' }] });
        expect(result.instructions.uf).toHaveLength(1);
    });

    it('丢弃缺名称的新建与关系', () => {
        const result = sanitizeInstructions({
            nc: [{ name: '' }],
            rel: [{ entityA: '林玄' }, { entityA: '林玄', entityB: '苏婉' }],
        });
        expect(result.instructions.nc).toEqual([]);
        expect(result.instructions.rel).toHaveLength(1);
        expect(result.dropped).toHaveLength(2);
    });

    it('不修改无关键', () => {
        const result = sanitizeInstructions({ uc: [], nt: [{ desc: 'x', event: 'y' }], extra: 1 });
        expect(result.instructions.nt).toHaveLength(1);
        expect(result.instructions.extra).toBe(1);
    });
});

describe('normalizeForeshadowStatus', () => {
    it('中英文别名归一', () => {
        expect(normalizeForeshadowStatus('已回收')).toBe('resolved');
        expect(normalizeForeshadowStatus('PLANTED')).toBe('planted');
        expect(normalizeForeshadowStatus('未知')).toBeNull();
    });
});

describe('renderDroppedSummary', () => {
    it('空返回空串', () => {
        expect(renderDroppedSummary([])).toBe('');
    });

    it('渲染前几条', () => {
        const text = renderDroppedSummary([{ kind: 'uc', name: '林玄', field: '境界', reason: '字段值为空' }]);
        expect(text).toContain('已丢弃 1 条');
        expect(text).toContain('uc:林玄.境界');
    });
});

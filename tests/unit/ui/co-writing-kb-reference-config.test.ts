import { describe, it, expect } from 'vitest';
import {
    buildReferenceBookConfig,
    normalizeReferenceWeight,
    planToggleReference,
} from '../../../ui/co-writing/kb-reference-config';

/**
 * 参考书开关规则：最多 3 本、首位权重固定 1、其余回落 0.5、权重夹到 0.1–1。
 * 这些规则决定重启后参考书是否还在、注入权重是否生效。
 */
describe('co-writing kb-reference-config 规则', () => {
    it('未达上限时追加到末尾', () => {
        expect(planToggleReference(['a'], 'b', true)).toEqual({
            kind: 'change',
            refs: ['a', 'b'],
            message: '',
        });
    });

    it('达到 3 本时拒绝启用并给出上限提示', () => {
        expect(planToggleReference(['a', 'b', 'c'], 'd', true)).toEqual({
            kind: 'limit',
            refs: ['a', 'b', 'c'],
            message: '最多只能启用 3 本参考书籍',
        });
    });

    it('停用只移除目标书籍', () => {
        expect(planToggleReference(['a', 'b'], 'a', false)).toEqual({
            kind: 'change',
            refs: ['b'],
            message: '',
        });
    });

    it('权重夹到 0.1–1 并保留两位小数', () => {
        expect(normalizeReferenceWeight(0)).toBe(0.1);
        expect(normalizeReferenceWeight(1.5)).toBe(1);
        expect(normalizeReferenceWeight(0.333)).toBe(0.33);
    });

    it('首位主参考权重固定 1，其余取设置值或 0.5', () => {
        expect(buildReferenceBookConfig(['a', 'b', 'c'], { b: 0.7 })).toEqual([
            { bookId: 'a', weight: 1, isPrimary: true },
            { bookId: 'b', weight: 0.7, isPrimary: false },
            { bookId: 'c', weight: 0.5, isPrimary: false },
        ]);
    });
});

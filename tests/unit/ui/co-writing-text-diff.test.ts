/**
 * 建议差异测试（2026-11-16，E-05）
 */
import { describe, expect, it } from 'vitest';
import { describeDiff, diffLines } from '../../../ui/co-writing/text-diff';

describe('diffLines', () => {
    it('完全相同', () => {
        const result = diffLines('a\nb', 'a\nb');
        expect(result.identical).toBe(true);
        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
    });

    it('新增行', () => {
        const result = diffLines('a', 'a\nb');
        expect(result.added).toBe(1);
        expect(result.removed).toBe(0);
        expect(result.identical).toBe(false);
    });

    it('删除行', () => {
        const result = diffLines('a\nb', 'a');
        expect(result.removed).toBe(1);
    });

    it('替换行计为 +1 −1', () => {
        const result = diffLines('a\nold\nz', 'a\nnew\nz');
        expect(result.added).toBe(1);
        expect(result.removed).toBe(1);
    });

    it('保留公共前后缀且行号正确', () => {
        const result = diffLines('h\na\nb\nfi', 'h\na\nc\nfi');
        const adds = result.rows.filter(row => row.kind === 'add');
        expect(adds[0].lineB).toBe(3);
    });

    it('差异行内容可由 rows 还原', () => {
        const result = diffLines('x\ny', 'x\nz');
        const before = result.rows.filter(row => row.kind !== 'add').map(row => row.text).join('\n');
        const after = result.rows.filter(row => row.kind !== 'del').map(row => row.text).join('\n');
        expect(before).toBe('x\ny');
        expect(after).toBe('x\nz');
    });

    it('空输入安全', () => {
        expect(diffLines('', '').identical).toBe(true);
        expect(diffLines('', 'a').added).toBe(1);
    });
});

describe('describeDiff', () => {
    it('一致时给固定文案', () => {
        expect(describeDiff({ rows: [], added: 0, removed: 0, identical: true })).toBe('与正文一致');
    });

    it('有差异时给增删统计', () => {
        expect(describeDiff({ rows: [], added: 3, removed: 1, identical: false })).toBe('+3 −1 行');
    });
});

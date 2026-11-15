import { describe, expect, it } from 'vitest';
import { describeAssertions, parseAssertions } from '@/shared/assertion-source-model';

describe('parseAssertions', () => {
    it('解析数组与常见字段名', () => {
        const list = parseAssertions([
            { id: 'AST-1', text: '林玄左臂有伤', entityIds: ['CHR-0001'], severity: 'high', chapter: 3 },
            { assertion_id: 'AST-2', description: '山门在北', 涉及人物: 'CHR-0002', 严重度: '中', 章节: 2 },
        ]);
        expect(list).toHaveLength(2);
        expect(list[0].severity).toBe('high');
        expect(list[0].chapter).toBe(3);
        expect(list[1].id).toBe('AST-2');
        expect(list[1].entityIds).toEqual(['CHR-0002']);
        expect(list[1].severity).toBe('medium');
    });

    it('支持 {assertions:[...]} 包裹', () => {
        const list = parseAssertions({ assertions: [{ id: 'A', text: 'x' }] });
        expect(list).toHaveLength(1);
    });

    it('名字经 resolveName 转 ID', () => {
        const list = parseAssertions([{ id: 'A', text: 'x', 涉及人物: '林玄、苏婉' }], name =>
            name === '林玄' ? 'CHR-0001' : name === '苏婉' ? 'CHR-0002' : null);
        expect(list[0].entityIds).toEqual(['CHR-0001', 'CHR-0002']);
    });

    it('无法解析的名字被丢弃（不猜）', () => {
        const list = parseAssertions([{ id: 'A', text: 'x', 涉及人物: '路人' }], () => null);
        expect(list[0].entityIds).toEqual([]);
    });

    it('缺 text 的条目跳过', () => {
        expect(parseAssertions([{ id: 'A' }, null, 3])).toEqual([]);
    });

    it('损坏输入返回空', () => {
        expect(parseAssertions(null)).toEqual([]);
        expect(parseAssertions('oops')).toEqual([]);
    });

    it('摘要', () => {
        expect(describeAssertions([])).toBe('无断言');
        expect(describeAssertions(parseAssertions([{ id: 'A', text: 'x', severity: 'high' }]))).toContain('高风险 1');
    });
});

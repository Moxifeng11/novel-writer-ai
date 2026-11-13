/**
 * 事实库视图纯逻辑测试
 *
 * 视图本身（Modal）难以单测，展示逻辑抽到 fact-store-format 后在这里覆盖：
 * 分组、排序、区间格式化、空态、失效判定。
 */

import { describe, expect, it } from 'vitest';
import {
    emptyStateHint,
    formatFactLine,
    formatHeader,
    formatRange,
    formatTypeBadge,
    groupBySubject,
    isExpired,
} from '@/ui/fact-store-format';
import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';

/** 造事实 */
function fact(over: Partial<FactMetadata> = {}): FactMetadata {
    return {
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 1,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七岁',
        chapter: 1,
        ...over,
    };
}

describe('groupBySubject', () => {
    it('按主体分组、组内按章节升序', () => {
        const groups = groupBySubject([
            fact({ chapter: 20, value: '十八' }),
            fact({ chapter: 1 }),
            fact({ subject: '桑桑', chapter: 5 }),
        ]);
        expect(groups).toHaveLength(2);
        const ningque = groups.find(g => g.subject === '宁缺')!;
        expect(ningque.facts.map(f => f.chapter)).toEqual([1, 20]);
    });

    it('按事实数降序（主体多的在前）', () => {
        const groups = groupBySubject([
            fact({ subject: '桑桑' }),
            fact({ subject: '宁缺' }), fact({ subject: '宁缺', predicate: '位置', type: 'location' }),
        ]);
        expect(groups[0].subject).toBe('宁缺');
        expect(groups[0].facts).toHaveLength(2);
    });

    it('空主体归入「未知主体」', () => {
        const groups = groupBySubject([fact({ subject: '  ' })]);
        expect(groups[0].subject).toBe('（未知主体）');
    });

    it('空列表返回空数组', () => {
        expect(groupBySubject([])).toHaveLength(0);
    });
});

describe('formatRange', () => {
    it('无终结点显示「第N章起」', () => {
        expect(formatRange(fact({ validFrom: 3 }))).toBe('第3章起');
    });

    it('有终结点显示区间', () => {
        expect(formatRange(fact({ validFrom: 1, validTo: 10 }))).toBe('第1–10章');
    });

    it('validFrom 缺失时回退到 chapter', () => {
        expect(formatRange(fact({ validFrom: undefined as never, chapter: 7 }))).toBe('第7章起');
    });
});

describe('formatFactLine', () => {
    it('包含谓词、值、区间、置信度', () => {
        const line = formatFactLine(fact({ predicate: '年龄', value: '十七', validFrom: 1 }));
        expect(line).toContain('年龄=十七');
        expect(line).toContain('第1章起');
        expect(line).toContain('0.90');
    });

    it('置信度非法时显示占位符而非 NaN', () => {
        expect(formatFactLine(fact({ confidence: Number.NaN }))).toContain('置信 —');
    });
});

describe('formatHeader', () => {
    it('汇总事实数/主体数/章节范围', () => {
        const header = formatHeader([fact({ chapter: 1 }), fact({ chapter: 30, subject: '桑桑' })]);
        expect(header).toContain('2 条事实');
        expect(header).toContain('2 个主体');
        expect(header).toContain('第1–30章');
    });

    it('空事实库给出空态文案', () => {
        expect(formatHeader([])).toBe('事实库为空');
    });
});

describe('emptyStateHint / formatTypeBadge', () => {
    it('空态提示说明边界与出路', () => {
        const hint = emptyStateHint();
        expect(hint).toContain('结算');
        expect(hint).toContain('一致性审核');
    });

    it('9 类都有中文徽章', () => {
        for (const type of ['age', 'location', 'possession', 'ability', 'relationship', 'timeline', 'world-rule', 'knowledge', 'memory']) {
            expect(formatTypeBadge(type)).not.toBe('其它');
        }
    });

    it('未知类型回退「其它」', () => {
        expect(formatTypeBadge('unknown')).toBe('其它');
    });
});

describe('isExpired', () => {
    it('无终结点不失效', () => {
        expect(isExpired(fact({ validTo: null }), 100)).toBe(false);
    });

    it('终结点早于当前章 → 失效', () => {
        expect(isExpired(fact({ validTo: 10 }), 20)).toBe(true);
    });

    it('终结点晚于当前章 → 未失效', () => {
        expect(isExpired(fact({ validTo: 30 }), 20)).toBe(false);
    });

    it('当前章未知（0）时不判定失效', () => {
        expect(isExpired(fact({ validTo: 10 }), 0)).toBe(false);
    });
});

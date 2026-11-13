/**
 * 事实库编辑逻辑单测
 *
 * 重点：**写前校验**必须挡住所有会把库写坏的情况（空主体/区间倒置/置信越界…）；
 * 编辑必须是纯函数（不修改入参）；忽略而非删除。
 */

import { describe, expect, it } from 'vitest';
import {
    activeFacts,
    removeFact,
    sameFact,
    setIgnored,
    summarizeEditState,
    updateFact,
    validateFactForWrite,
    validateFactList,
} from '@/ui/fact-store-edit';
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

const TARGET = { chapter: 1, subject: '宁缺', predicate: '年龄' };

describe('validateFactForWrite · 写前校验', () => {
    it('合法事实通过', () => {
        expect(validateFactForWrite(fact()).ok).toBe(true);
    });

    it('**空主体被拒**', () => {
        const result = validateFactForWrite(fact({ subject: '  ' }));
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('主体');
    });

    it('**空谓词被拒**', () => {
        expect(validateFactForWrite(fact({ predicate: '' })).ok).toBe(false);
    });

    it('**空值被拒**', () => {
        expect(validateFactForWrite(fact({ value: '   ' })).ok).toBe(false);
    });

    it('**章节号非正数被拒**', () => {
        expect(validateFactForWrite(fact({ chapter: 0 })).ok).toBe(false);
        expect(validateFactForWrite(fact({ chapter: Number.NaN })).ok).toBe(false);
    });

    it('**区间倒置被拒**（validTo < validFrom）', () => {
        const result = validateFactForWrite(fact({ validFrom: 10, validTo: 5 }));
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('不能早于');
    });

    it('**置信度越界被拒**', () => {
        expect(validateFactForWrite(fact({ confidence: 1.5 })).ok).toBe(false);
        expect(validateFactForWrite(fact({ confidence: -0.1 })).ok).toBe(false);
    });

    it('置信度边界 0 与 1 合法', () => {
        expect(validateFactForWrite(fact({ confidence: 0 })).ok).toBe(true);
        expect(validateFactForWrite(fact({ confidence: 1 })).ok).toBe(true);
    });

    it('validTo 为 null 合法（仍未失效）', () => {
        expect(validateFactForWrite(fact({ validTo: null })).ok).toBe(true);
    });
});

describe('validateFactList · 整批校验', () => {
    it('全部合法 → ok', () => {
        expect(validateFactList([fact(), fact({ subject: '桑桑' })]).ok).toBe(true);
    });

    it('指出第一条不合法的事实序号（从 1 开始）', () => {
        const result = validateFactList([fact(), fact({ value: '' })]);
        expect(result.ok).toBe(false);
        expect(result.index).toBe(1);
        expect(result.reason).toContain('第 2 条');
    });

    it('空列表合法', () => {
        expect(validateFactList([]).ok).toBe(true);
    });
});

describe('removeFact · 删除', () => {
    it('删除目标事实，其余保留', () => {
        const facts = [fact(), fact({ subject: '桑桑' })];
        const next = removeFact(facts, TARGET);
        expect(next).toHaveLength(1);
        expect(next[0].subject).toBe('桑桑');
    });

    it('不修改入参（纯函数）', () => {
        const facts = [fact()];
        removeFact(facts, TARGET);
        expect(facts).toHaveLength(1);
    });

    it('目标不存在时原样返回', () => {
        const facts = [fact()];
        expect(removeFact(facts, { chapter: 99, subject: '无', predicate: '无' })).toHaveLength(1);
    });
});

describe('updateFact · 改值/改区间', () => {
    it('只改目标事实的指定字段', () => {
        const facts = [fact(), fact({ subject: '桑桑', value: '十一' })];
        const next = updateFact(facts, TARGET, { value: '十八', validTo: 10 });
        expect(next[0].value).toBe('十八');
        expect(next[0].validTo).toBe(10);
        expect(next[1].value).toBe('十一');
    });

    it('不修改入参（纯函数）', () => {
        const facts = [fact()];
        updateFact(facts, TARGET, { value: '十八' });
        expect(facts[0].value).toBe('十七');
    });

    it('保持数组顺序', () => {
        const facts = [fact({ chapter: 1 }), fact({ chapter: 5 })];
        const next = updateFact(facts, { chapter: 5, subject: '宁缺', predicate: '年龄' }, { value: '二十' });
        expect(next.map(f => f.chapter)).toEqual([1, 5]);
    });
});

describe('setIgnored / activeFacts · 忽略而非删除', () => {
    it('标记忽略后事实仍存在', () => {
        const next = setIgnored([fact()], TARGET, true);
        expect(next).toHaveLength(1);
        expect(next[0].ignored).toBe(true);
    });

    it('activeFacts 排除忽略项', () => {
        const facts = setIgnored([fact(), fact({ subject: '桑桑' })], TARGET, true);
        expect(activeFacts(facts)).toHaveLength(1);
        expect(activeFacts(facts)[0].subject).toBe('桑桑');
    });

    it('可取消忽略（恢复参与判定）', () => {
        const ignored = setIgnored([fact()], TARGET, true);
        const restored = setIgnored(ignored, TARGET, false);
        expect(activeFacts(restored)).toHaveLength(1);
    });
});

describe('sameFact / summarizeEditState', () => {
    it('同章节同主体同谓词视为同一事实', () => {
        expect(sameFact(fact(), TARGET)).toBe(true);
    });

    it('任一字段不同则不是同一事实', () => {
        expect(sameFact(fact({ chapter: 2 }), TARGET)).toBe(false);
        expect(sameFact(fact({ subject: '桑桑' }), TARGET)).toBe(false);
        expect(sameFact(fact({ predicate: '位置' }), TARGET)).toBe(false);
    });

    it('统计总数/忽略数/参与数', () => {
        const facts = setIgnored([fact(), fact({ subject: '桑桑' })], TARGET, true);
        expect(summarizeEditState(facts)).toEqual({ total: 2, ignored: 1, active: 1 });
    });

    it('空库统计为 0', () => {
        expect(summarizeEditState([])).toEqual({ total: 0, ignored: 0, active: 0 });
    });
});

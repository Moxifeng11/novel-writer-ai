/**
 * 谓词匹配器单测
 *
 * 锁住两个真实踩过的坑：
 *  1. 严格等值 → 变体漏报（年龄约/年纪）
 *  2. 包含匹配 → 回溯限定谓词假矛盾（被提亲起始年龄/请求远嫁时年龄）
 */

import { describe, expect, it } from 'vitest';
import {
    filterByConcept,
    isCurrentStatePredicate,
    matchesPredicate,
    matchesPredicateLoose,
    PREDICATE_ALIASES,
    RETROSPECTIVE_MARKERS,
} from '../../../../engine/consistency/predicate-match';

describe('别名表完整性', () => {
    it('8 个概念都有别名', () => {
        for (const concept of Object.keys(PREDICATE_ALIASES)) {
            expect(PREDICATE_ALIASES[concept as keyof typeof PREDICATE_ALIASES].length).toBeGreaterThan(0);
        }
    });

    it('回溯限定词表非空', () => {
        expect(RETROSPECTIVE_MARKERS.length).toBeGreaterThan(5);
    });
});

describe('matchesPredicate · 变体命中（修漏报）', () => {
    it('年龄变体：年龄 / 年龄约 / 年纪 / 岁数', () => {
        for (const predicate of ['年龄', '年龄约', '年纪', '岁数']) {
            expect(matchesPredicate(predicate, 'age'), predicate).toBe(true);
        }
    });

    it('地点变体：位置 / 地点 / 所在', () => {
        for (const predicate of ['位置', '地点', '所在地']) {
            expect(matchesPredicate(predicate, 'location'), predicate).toBe(true);
        }
    });

    it('化名变体：化名 / 道号 / 绰号 / 本名', () => {
        for (const predicate of ['化名', '道号', '绰号', '本名']) {
            expect(matchesPredicate(predicate, 'alias'), predicate).toBe(true);
        }
    });

    it('能力变体：修为 / 境界 / 等级', () => {
        for (const predicate of ['修为', '境界', '等级', '能力']) {
            expect(matchesPredicate(predicate, 'ability'), predicate).toBe(true);
        }
    });
});

describe('matchesPredicate · 回溯限定排除（修假矛盾）', () => {
    it('**「被提亲起始年龄」不算当前年龄**（将夜第6章实例）', () => {
        expect(matchesPredicate('被提亲起始年龄', 'age')).toBe(false);
    });

    it('**「请求远嫁时年龄」不算当前年龄**', () => {
        expect(matchesPredicate('请求远嫁时年龄', 'age')).toBe(false);
    });

    it('**「入初境年龄」不算当前年龄**', () => {
        expect(matchesPredicate('入初境年龄', 'age')).toBe(false);
    });

    it('「七年前年龄尚小」不算当前年龄', () => {
        expect(matchesPredicate('七年前年龄尚小', 'age')).toBe(false);
    });

    it('回溯词出现在中间也算（"记忆中地点"不算当前地点）', () => {
        expect(matchesPredicate('记忆地点', 'location')).toBe(false);
    });
});

describe('matchesPredicate · 负例', () => {
    it('无关概念不命中', () => {
        expect(matchesPredicate('身高', 'age')).toBe(false);
        expect(matchesPredicate('年龄', 'location')).toBe(false);
    });

    it('空前缀为假', () => {
        expect(matchesPredicate('', 'age')).toBe(false);
        expect(matchesPredicate('   ', 'age')).toBe(false);
    });

    it('限定词在核心词**之后**不影响（"年龄上限"仍算年龄类）', () => {
        expect(matchesPredicate('年龄上限', 'age')).toBe(true);
    });
});

describe('isCurrentStatePredicate', () => {
    it('普通谓词是当前状态', () => {
        expect(isCurrentStatePredicate('年龄')).toBe(true);
        expect(isCurrentStatePredicate('位置')).toBe(true);
    });

    it('含回溯词不是当前状态', () => {
        expect(isCurrentStatePredicate('当年年龄')).toBe(false);
        expect(isCurrentStatePredicate('此前位置')).toBe(false);
    });

    it('空谓词为假', () => {
        expect(isCurrentStatePredicate('')).toBe(false);
    });
});

describe('matchesPredicateLoose / filterByConcept', () => {
    it('宽松匹配忽略回溯限定', () => {
        // 宽松：前缀匹配成功即可，不看回溯限定
        expect(matchesPredicateLoose('年龄当年', 'age')).toBe(true);
        expect(matchesPredicate('年龄当年', 'age')).toBe(false);
        // 前缀都没命中时宽松也不命中（「被提亲起始年龄」核心词在后）
        expect(matchesPredicateLoose('被提亲起始年龄', 'age')).toBe(false);
        expect(matchesPredicateLoose('身高', 'age')).toBe(false);
    });

    it('filterByConcept 只保留当前状态断言', () => {
        const assertions = [
            { predicate: '年龄', value: '11' },
            { predicate: '被提亲起始年龄', value: '8' },
            { predicate: '年纪', value: '12' },
        ];
        const hits = filterByConcept(assertions, 'age');
        expect(hits).toHaveLength(2);
        expect(hits.map(h => h.value)).toEqual(['11', '12']);
    });
});

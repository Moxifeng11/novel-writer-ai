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
    isExactNumericValue,
    isRetrospectiveQuote,
} from '../../../../engine/consistency/predicate-match';
import { pairContradictions } from '../../../../engine/consistency/pairing-rules';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

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

describe('引文回溯判定（长篇 100 章评测修复）', () => {
    it('「我那年才四岁」是回溯', () => {
        expect(isRetrospectiveQuote('我那年才四岁')).toBe(true);
    });

    it('「他七年前才六岁」是回溯', () => {
        expect(isRetrospectiveQuote('他七年前才六岁')).toBe(true);
    });

    it('当前状态引文不是回溯（负例）', () => {
        expect(isRetrospectiveQuote('你不过十五六岁，难不成杀过的人比我还多？')).toBe(false);
    });

    it('空引文不判回溯', () => {
        expect(isRetrospectiveQuote('')).toBe(false);
    });
});

describe('R1 排除回溯引文与 0 岁噪声', () => {
    /** 造断言 */
    function ageFact(chapter: number, numeric: number, quote: string, predicate = '年龄'): FactAssertion {
        return {
            id: `f|${chapter}|${numeric}`,
            kind: 'quantitative',
            subject: '宁缺',
            predicate,
            value: String(numeric),
            numericValue: numeric,
            unit: '岁',
            chapterKey: `第${chapter}章`,
            chapterNum: chapter,
            quote,
            source: 'fact-store',
            extractedAt: 0,
        };
    }

    it('**回溯引文不参与**（第92章「我那年才四岁」不算当前年龄）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(68, 16, '你不过十五六岁'),
            ageFact(92, 4, '我那年才四岁'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(false);
    });

    it('**0 岁视为抽取噪声被忽略**', () => {
        const result = pairContradictions({ assertions: [
            ageFact(40, 15, '你不过十五六岁'),
            ageFact(50, 0, '十五六岁年龄便杀过很多人'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(false);
    });

    it('正常当前年龄倒退仍检出（负例对照）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(68, 16, '你今年十六岁'),
            ageFact(92, 8, '你今年八岁'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(true);
    });
});

describe('精确值守卫（200 章评测修复）', () => {
    it('边界值不是精确值', () => {
        for (const v of ['未满二十', '不到六岁', '将近三十', '约二十', '二十左右']) {
            expect(isExactNumericValue(v), v).toBe(false);
        }
    });

    it('精确值是精确值', () => {
        for (const v of ['十八', '16', '四十岁']) {
            expect(isExactNumericValue(v), v).toBe(true);
        }
    });

    it('空值不是精确值', () => {
        expect(isExactNumericValue('')).toBe(false);
    });
});

describe('R1/R2 边界值不参与比较', () => {
    /** 造断言 */
    function ageFact(chapter: number, numeric: number, value: string, quote: string): FactAssertion {
        return {
            id: `f|${chapter}|${numeric}`,
            kind: 'quantitative',
            subject: '宁缺',
            predicate: '年龄',
            value,
            numericValue: numeric,
            unit: '岁',
            chapterKey: `第${chapter}章`,
            chapterNum: chapter,
            quote,
            source: 'fact-store',
            extractedAt: 0,
        };
    }

    it('**「未满二十」与「十八」相容**（200 章评测真实案例）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(170, 20, '未满二十', '未满二十不惑'),
            ageFact(184, 18, '十八', '我已经十八了'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(false);
    });

    it('两个精确值仍正常检出倒退（负例对照）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(170, 20, '二十', '你今年二十'),
            ageFact(184, 18, '十八', '我已经十八了'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(true);
    });
});

/**
 * 扩展 10 子类单测
 *
 * 关键取舍：能用确定性规则判的（记忆自相矛盾 / 核心规则被违反 / 同章人称混用）
 * 才产出矛盾；需要世界知识或等级序的一律进疑似——**不用「值不等即矛盾」**，
 * 否则合法成长（修为进阶、转投门派）全会被判成 bug。
 */

import { describe, expect, it } from 'vitest';
import {
    commonValue,
    extractExtendedAssertions,
    pairExtended,
} from '../../../../engine/consistency/extended-rules';
import {
    ASSERTION_KINDS,
    ASSERTION_KIND_META,
} from '../../../../engine/consistency/assertion-model';

describe('分类学完整性', () => {
    it('19 个子类全部登记（含新增 10 个）', () => {
        expect(ASSERTION_KINDS).toHaveLength(19);
        for (const kind of ['memory', 'knowledge', 'skill-fluctuation', 'forgotten-ability',
            'core-rule', 'social-norm', 'geographical', 'perspective', 'tone', 'style-shift'] as const) {
            expect(ASSERTION_KINDS).toContain(kind);
            expect(ASSERTION_KIND_META[kind].label).toBeTruthy();
        }
    });
});

describe('抽取', () => {
    it('「记得/忘了」抽成记忆断言', () => {
        const out = extractExtendedAssertions(['张三记得那把青铜钥匙'], '第5章', 5);
        expect(out[0].kind).toBe('memory');
        expect(out[0].predicate).toBe('记得');
    });

    it('「不能/禁止」抽成核心规则断言', () => {
        const out = extractExtendedAssertions(['修炼者无法御空飞行'], '第2章', 2);
        expect(out[0].kind).toBe('core-rule');
        expect(out[0].predicate).toBe('禁止');
        expect(out[0].value).toBe('御空飞行');
    });

    it('普通叙述不抽（宁少不脏）', () => {
        expect(extractExtendedAssertions(['张三走进院子'], '第1章', 1)).toHaveLength(0);
    });
});

describe('memory · 记忆自相矛盾', () => {
    it('同一角色跨章「记得」又「忘了」同一事物 → 命中', () => {
        const assertions = extractExtendedAssertions(
            ['张三记得那把青铜钥匙'],
            '第5章',
            5,
        ).concat(extractExtendedAssertions(['张三忘了那把青铜钥匙'], '第20章', 20));
        const out = pairExtended(assertions);
        expect(out.contradictions.some(c => c.kind === 'memory')).toBe(true);
    });

    it('不同角色的记忆互不影响', () => {
        const a = extractExtendedAssertions(['张三记得青铜钥匙'], '第5章', 5);
        const b = extractExtendedAssertions(['李四忘了青铜钥匙'], '第6章', 6);
        expect(pairExtended([...a, ...b]).contradictions).toHaveLength(0);
    });

    it('同一角色、不同事物 → 不命中', () => {
        const a = extractExtendedAssertions(['张三记得青铜钥匙'], '第5章', 5);
        const b = extractExtendedAssertions(['张三忘了那封书信'], '第6章', 6);
        expect(pairExtended([...a, ...b]).contradictions).toHaveLength(0);
    });
});

describe('core-rule · 核心规则被违反', () => {
    it('设定禁止某行为，后文却发生 → 命中', () => {
        const rule = extractExtendedAssertions(['修炼者不能御空飞行'], '第2章', 2);
        // 后文一条普通事实，引文里出现了被禁行为（且没有「不能/无法」前缀）
        const violation = {
            id: 'x',
            kind: 'quantitative' as const,
            subject: '张三',
            predicate: '事件',
            value: '御空飞行',
            chapterKey: '第8章',
            chapterNum: 8,
            quote: '张三御空飞行，掠过山巅',
            source: 'digest-fact' as const,
            extractedAt: 0,
        };
        const out = pairExtended([...rule, violation]);
        expect(out.contradictions.some(c => c.kind === 'core-rule')).toBe(true);
    });

    it('只有规则、没有违反 → 不命中', () => {
        const rule = extractExtendedAssertions(['修炼者不能御空飞行'], '第2章', 2);
        expect(pairExtended(rule).contradictions).toHaveLength(0);
    });
});

describe('perspective · 人称混用', () => {
    it('同章两种人称密度接近 → 命中', () => {
        const body = '我走进院子。我抬头看见他。我心中一紧。他站在门口。他笑了。他转身离开。他走了。';
        const out = pairExtended([], [{ chapterKey: '第1章', body }]);
        expect(out.contradictions.some(c => c.kind === 'perspective')).toBe(true);
    });

    it('单一视角 → 不命中', () => {
        const body = '我走进院子。我抬头。我心中一紧。我转身。我离开。我回头。';
        expect(pairExtended([], [{ chapterKey: '第1章', body }]).contradictions).toHaveLength(0);
    });

    it('人称为零星的短章 → 不命中', () => {
        const body = '我走了。他来了。';
        expect(pairExtended([], [{ chapterKey: '第1章', body }]).contradictions).toHaveLength(0);
    });
});

describe('其余 7 子类 · 一律进疑似而非矛盾', () => {
    it('没有确定性规则支撑的子类不得产出矛盾', () => {
        const kinds = ['knowledge', 'skill-fluctuation', 'forgotten-ability',
            'social-norm', 'geographical', 'tone', 'style-shift'] as const;
        const assertions = kinds.map(k => ({
            id: k, kind: k, subject: '张三', predicate: 'p', value: 'v',
            chapterKey: '第1章', chapterNum: 1, quote: 'q', source: 'digest-fact' as const, extractedAt: 0,
        }));
        const out = pairExtended(assertions);
        expect(out.contradictions).toHaveLength(0);
        expect(out.suspected.length).toBe(kinds.length);
    });
});

describe('commonValue', () => {
    it('取公共子串', () => {
        expect(commonValue('那把青铜钥匙', '青铜钥匙')).toBe('青铜钥匙');
    });

    it('无公共子串返回空', () => {
        expect(commonValue('青铜钥匙', '白玉令牌')).toBe('');
    });

    it('过短不算', () => {
        expect(commonValue('甲', '甲')).toBe('');
    });
});

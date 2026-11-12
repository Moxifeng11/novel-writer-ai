/**
 * 规则层配对单测（S2 第一半）
 *
 * 这一层是「免费全量」的第一道闸，精度直接决定用户是否相信结果。
 * 因此每个规则都同时测**命中**与**不该命中**（误报是最贵的错误）。
 */

import { describe, expect, it } from 'vitest';
import {
    editDistance,
    isNearIdentical,
    pairContradictions,
} from '../../../../engine/consistency/pairing-rules';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

/** 造断言 */
function makeAssertion(overrides: Partial<FactAssertion>): FactAssertion {
    const base: FactAssertion = {
        id: 'id',
        kind: 'quantitative',
        subject: '张三',
        predicate: '年龄',
        value: '',
        numericValue: undefined,
        unit: undefined,
        chapterKey: '第1章',
        chapterNum: 1,
        quote: '引文',
        source: 'digest-fact',
        extractedAt: 1_700_000_000_000,
    };
    const merged = { ...base, ...overrides };
    return { ...merged, id: merged.id === 'id' ? `${merged.kind}|${merged.subject}|${merged.predicate}|${merged.chapterKey}` : merged.id };
}

/** 造年龄断言 */
function age(chapterNum: number, value: number, subject = '张三'): FactAssertion {
    return makeAssertion({
        kind: 'quantitative',
        subject,
        predicate: '年龄',
        value: String(value),
        numericValue: value,
        unit: '岁',
        chapterKey: `第${chapterNum}章`,
        chapterNum,
        quote: `${subject}今年${value}岁`,
    });
}

describe('R1 · 年龄倒退', () => {
    it('后章年龄小于前章 → 命中', () => {
        const { contradictions } = pairContradictions({ assertions: [age(1, 20), age(40, 18)] });
        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].kind).toBe('quantitative');
        expect(contradictions[0].evidenceA.quote).toContain('20');
        expect(contradictions[0].evidenceB.quote).toContain('18');
        expect(contradictions[0].decidedBy).toBe('rule');
    });

    it('年龄增长 → 不命中（正常）', () => {
        const { contradictions } = pairContradictions({ assertions: [age(1, 18), age(40, 20)] });
        expect(contradictions).toHaveLength(0);
    });

    it('年龄不变 → 不命中（可能只是没提长大）', () => {
        const { contradictions } = pairContradictions({ assertions: [age(1, 18), age(40, 18)] });
        expect(contradictions).toHaveLength(0);
    });

    it('不同人物互不影响', () => {
        const { contradictions } = pairContradictions({ assertions: [age(1, 20, '张三'), age(40, 18, '李四')] });
        expect(contradictions).toHaveLength(0);
    });

    it('章节号未知的断言不参与（无法判断先后）', () => {
        const a = makeAssertion({ subject: '张三', predicate: '年龄', numericValue: 30, chapterNum: null, chapterKey: '?' });
        const b = age(5, 18);
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });
});

describe('R2 · 同章数值冲突', () => {
    it('同章同主语同谓语两个不同数值 → 命中', () => {
        const a = makeAssertion({ subject: '张三', predicate: '年龄', value: '18', numericValue: 18, chapterNum: 5, chapterKey: '第5章', quote: '张三今年十八岁' });
        const b = makeAssertion({ subject: '张三', predicate: '年龄', value: '25', numericValue: 25, chapterNum: 5, chapterKey: '第5章', quote: '张三已二十五岁' });
        const { contradictions } = pairContradictions({ assertions: [a, b] });
        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].reasoning).toContain('同一章');
    });

    it('数值相同（容差内）→ 不命中', () => {
        const a = makeAssertion({ subject: '张三', predicate: '年龄', value: '18', numericValue: 18, chapterNum: 5, chapterKey: '第5章' });
        const b = makeAssertion({ subject: '张三', predicate: '年龄', value: '18', numericValue: 18, chapterNum: 5, chapterKey: '第5章' });
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });
});

describe('R3 · 化名冲突', () => {
    it('同一人被写成两个化名 → 命中', () => {
        const a = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张小三', chapterKey: '第3章', quote: '张三本名张小三' });
        const b = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张阿三', chapterKey: '第30章', quote: '张三化名张阿三' });
        const { contradictions } = pairContradictions({ assertions: [a, b] });
        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].kind).toBe('nomenclature');
    });

    it('同章内同化名 → 不命中', () => {
        const a = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张小三', chapterKey: '第3章' });
        const b = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张小三', chapterKey: '第3章' });
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });

    it('相同化名重复出现 → 不命中', () => {
        const a = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张小三', chapterKey: '第3章' });
        const b = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '又名', value: '张小三', chapterKey: '第30章' });
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });
});

describe('R5 · 事件时长不相容', () => {
    it('同一事件三日 vs 两个月 → 命中', () => {
        const a = makeAssertion({ kind: 'absolute-time', subject: '青云试炼', predicate: '时间', value: '三日', numericValue: 3 * 24 * 60, chapterKey: '第10章', quote: '试炼持续三日' });
        const b = makeAssertion({ kind: 'absolute-time', subject: '青云试炼', predicate: '时间', value: '两个月', numericValue: 60 * 24 * 60, chapterKey: '第50章', quote: '试炼历时两个月' });
        const { contradictions } = pairContradictions({ assertions: [a, b] });
        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].kind).toBe('duration');
    });

    it('三日 vs 三天 → 不命中（同量级）', () => {
        const a = makeAssertion({ kind: 'absolute-time', subject: '青云试炼', predicate: '时间', value: '三日', numericValue: 3 * 24 * 60, chapterKey: '第10章' });
        const b = makeAssertion({ kind: 'absolute-time', subject: '青云试炼', predicate: '时间', value: '三天', numericValue: 3 * 24 * 60, chapterKey: '第50章' });
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });
});

describe('R7 · 同章两个地点', () => {
    it('同章同一人两个互斥地点 → 命中', () => {
        const a = makeAssertion({ kind: 'simultaneity', subject: '张三', predicate: '当前位置', value: '青云城', chapterKey: '第8章', quote: '张三身在青云城' });
        const b = makeAssertion({ kind: 'simultaneity', subject: '张三', predicate: '地点', value: '黑风寨', chapterKey: '第8章', quote: '张三深入黑风寨' });
        const { contradictions } = pairContradictions({ assertions: [a, b] });
        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].kind).toBe('simultaneity');
    });

    it('不同章的两处地点 → 不命中（可以移动）', () => {
        const a = makeAssertion({ kind: 'simultaneity', subject: '张三', predicate: '当前位置', value: '青云城', chapterKey: '第8章' });
        const b = makeAssertion({ kind: 'simultaneity', subject: '张三', predicate: '地点', value: '黑风寨', chapterKey: '第9章' });
        expect(pairContradictions({ assertions: [a, b] }).contradictions).toHaveLength(0);
    });
});

describe('R4 · 疑似名称近似（交给 LLM，不直接报）', () => {
    it('张三 vs 张叁（权威）→ 进入疑似而非矛盾', () => {
        const candidate = makeAssertion({ kind: 'nomenclature', subject: '张三', predicate: '权威名称', value: '张三', source: 'digest-fact', chapterKey: '第5章' });
        const auth = makeAssertion({ kind: 'nomenclature', subject: '张叁', predicate: '权威名称', value: '张叁', source: 'fact-index', chapterKey: '' });
        const out = pairContradictions({ assertions: [candidate, auth] });
        expect(out.contradictions).toHaveLength(0);
        expect(out.suspected.length).toBeGreaterThan(0);
        expect(out.suspected[0].kind).toBe('nomenclature');
    });

    it('完全不同的人名 → 不进入疑似', () => {
        const candidate = makeAssertion({ kind: 'nomenclature', subject: '李雷', predicate: '权威名称', value: '李雷', source: 'digest-fact' });
        const auth = makeAssertion({ kind: 'nomenclature', subject: '韩梅梅', predicate: '权威名称', value: '韩梅梅', source: 'fact-index', chapterKey: '' });
        expect(pairContradictions({ assertions: [candidate, auth] }).suspected).toHaveLength(0);
    });
});

describe('R6 · 疑似废弃伏笔', () => {
    it('废弃伏笔 + 后续仍有提及 → 进疑似', () => {
        const mention = makeAssertion({ subject: '青铜钥匙', predicate: '年龄', value: '1', numericValue: 1, chapterKey: '第60章' });
        const out = pairContradictions({
            assertions: [mention],
            abandonedPlots: [{ name: '青铜钥匙', quote: '青铜钥匙 | 已废弃', chapterKey: '第20章' }],
        });
        expect(out.suspected.some(s => s.kind === 'abandoned-plot')).toBe(true);
    });

    it('废弃伏笔无任何提及 → 不进疑似', () => {
        const out = pairContradictions({
            assertions: [age(1, 18)],
            abandonedPlots: [{ name: '青铜钥匙', quote: '青铜钥匙 | 已废弃', chapterKey: '第20章' }],
        });
        expect(out.suspected).toHaveLength(0);
    });
});

describe('证据链完整性（硬要求）', () => {
    it('所有产出的矛盾都带双侧引文与章节', () => {
        const { contradictions } = pairContradictions({ assertions: [age(1, 20), age(40, 18)] });
        for (const c of contradictions) {
            expect(c.evidenceA.quote.trim()).not.toBe('');
            expect(c.evidenceB.quote.trim()).not.toBe('');
            expect(c.evidenceA.chapterKey).not.toBe('');
            expect(c.evidenceB.chapterKey).not.toBe('');
            expect(c.reasoning.trim()).not.toBe('');
        }
    });

    it('空输入不产出任何东西', () => {
        const out = pairContradictions({ assertions: [] });
        expect(out.contradictions).toHaveLength(0);
        expect(out.suspected).toHaveLength(0);
    });
});

describe('名称相似度工具', () => {
    it('编辑距离', () => {
        expect(editDistance('张三', '张三')).toBe(0);
        expect(editDistance('张三', '张叁')).toBe(1);
        expect(editDistance('张三', '李四')).toBe(2);
    });

    it('仅差一字才算近似', () => {
        expect(isNearIdentical('张三', '张叁')).toBe(true);
        expect(isNearIdentical('张三', '李四')).toBe(false);
        expect(isNearIdentical('张三', '张三')).toBe(false);
        // 「张三」vs「张三丰」是插入一字：可能是截断/漏字，算近似——
        // 但它只会进**疑似**（交 LLM 复核），不会直接报成矛盾，所以放宽是安全的
        expect(isNearIdentical('张三', '张三丰')).toBe(true);
        // 长度差超过 1 直接排除
        expect(isNearIdentical('张三', '张三丰真人')).toBe(false);
    });
});

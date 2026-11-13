/**
 * 因果类检测单测（补齐 causal-violation / causeless-effect）
 *
 * 因果判断最容易误报，所以这两条规则的**不该命中**用例比命中用例更重要。
 */

import { describe, expect, it } from 'vitest';
import { extractCausalAssertions, pairCausal } from '../../../../engine/consistency/causal-rules';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

/** 造因果断言（Y 的原因是 X） */
function causal(effect: string, cause: string, chapterNum: number): FactAssertion {
    return {
        id: `causal-violation|${effect}|原因|第${chapterNum}章`,
        kind: 'causal-violation',
        subject: effect,
        predicate: '原因',
        value: cause,
        chapterKey: `第${chapterNum}章`,
        chapterNum,
        quote: `因为${cause}，所以${effect}`,
        source: 'digest-fact',
        extractedAt: 0,
    };
}

/** 造普通事件断言（用于顺序倒置） */
function event(name: string, chapterNum: number): FactAssertion {
    return {
        id: `absolute-time|${name}|时间|第${chapterNum}章`,
        kind: 'absolute-time',
        subject: name,
        predicate: '时间',
        value: '三日',
        chapterKey: `第${chapterNum}章`,
        chapterNum,
        quote: `${name}发生`,
        source: 'ledger-event',
        extractedAt: 0,
    };
}

describe('extractCausalAssertions · 抽取', () => {
    it('「因为X，所以Y」→ subject=Y value=X', () => {
        const out = extractCausalAssertions('因为中毒，所以张三倒下', '第3章', 3);
        expect(out).toHaveLength(1);
        expect(out[0].subject).toBe('张三倒下');
        expect(out[0].value).toBe('中毒');
        expect(out[0].kind).toBe('causal-violation');
    });

    it('「由于X，Y」也能抽', () => {
        const out = extractCausalAssertions('由于大雨，道路中断', '第5章', 5);
        expect(out[0].value).toBe('大雨');
        expect(out[0].subject).toBe('道路中断');
    });

    it('无因果连接词 → 不抽（宁少不脏）', () => {
        expect(extractCausalAssertions('张三走进院子', '第1章', 1)).toHaveLength(0);
        expect(extractCausalAssertions('', '第1章', 1)).toHaveLength(0);
    });

    it('原因与结果相同 → 丢弃', () => {
        expect(extractCausalAssertions('因为下雨，所以下雨', '第1章', 1)).toHaveLength(0);
    });
});

describe('pairCausal · R8 同一结果不同原因', () => {
    it('跨章两个互斥原因 → causal-violation', () => {
        const out = pairCausal([causal('张三倒下', '中毒', 3), causal('张三倒下', '诅咒', 30)]);
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('causal-violation');
        expect(out[0].evidenceA.quote).toContain('中毒');
        expect(out[0].evidenceB.quote).toContain('诅咒');
    });

    it('原因相同 → 不命中', () => {
        expect(pairCausal([causal('张三倒下', '中毒', 3), causal('张三倒下', '中毒', 30)])).toHaveLength(0);
    });

    it('同章不同原因 → 不命中（可能是并列原因）', () => {
        const a = causal('张三倒下', '中毒', 3);
        const b = { ...causal('张三倒下', '诅咒', 3) };
        expect(pairCausal([a, b])).toHaveLength(0);
    });

    it('不同结果的各自原因 → 不命中', () => {
        expect(pairCausal([causal('张三倒下', '中毒', 3), causal('李四发狂', '诅咒', 30)])).toHaveLength(0);
    });
});

describe('pairCausal · R9 原因晚于结果（无因之果）', () => {
    it('结果已发生但原因在更晚章节才出现 → causeless-effect', () => {
        const effectAssertion = causal('道路中断', '山崩', 5);
        const causeEvent = event('山崩', 20);
        const out = pairCausal([effectAssertion, causeEvent]);
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('causeless-effect');
        expect(out[0].reasoning).toContain('因果顺序倒置');
    });

    it('原因出现在更早章节 → 正常，不命中', () => {
        const effectAssertion = causal('道路中断', '山崩', 20);
        const causeEvent = event('山崩', 5);
        expect(pairCausal([effectAssertion, causeEvent])).toHaveLength(0);
    });

    it('原因未被记录为事件 → 不推断（宁少不脏）', () => {
        expect(pairCausal([causal('道路中断', '山崩', 5)])).toHaveLength(0);
    });
});

describe('证据链完整性', () => {
    it('产出的每条都带双侧引文与章节', () => {
        const out = pairCausal([causal('张三倒下', '中毒', 3), causal('张三倒下', '诅咒', 30)]);
        for (const c of out) {
            expect(c.reasoning.trim()).not.toBe('');
            expect(c.evidenceA.quote.trim()).not.toBe('');
            expect(c.evidenceB.quote.trim()).not.toBe('');
            expect(c.evidenceA.chapterKey).not.toBe('');
            expect(c.evidenceB.chapterKey).not.toBe('');
        }
    });

    it('空输入不产出', () => {
        expect(pairCausal([])).toHaveLength(0);
    });
});

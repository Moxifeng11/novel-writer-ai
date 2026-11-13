/**
 * P1 判定层 + P2 第二意见 单测
 */

import { describe, expect, it } from 'vitest';
import { runAudit, verifyLowConfidence } from '../../../../engine/consistency/audit-pipeline';
import { adviseState, effectiveFacts, findConflicts } from '../../../../engine/context/state-advice';
import type { FactMetadata } from '../../../../engine/context/knowledge-fact-nodes';
import type { ConsistencyContradiction } from '../../../../engine/consistency/assertion-model';
import type { LlmCaller } from '../../../../engine/consistency/pairing-llm';

/** 造矛盾 */
function contradiction(over: Partial<ConsistencyContradiction> = {}): ConsistencyContradiction {
    return {
        id: 'c1',
        kind: 'quantitative',
        category: 'factual',
        subject: '宁缺',
        predicate: '年龄',
        reasoning: '年龄不一致',
        evidenceA: { quote: '宁缺今年十七岁', chapterKey: '第1章' },
        evidenceB: { quote: '宁缺今年十六岁', chapterKey: '第20章' },
        decidedBy: 'rule',
        confidence: 0.6,
        ...over,
    };
}

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

/** 造 caller（返回指定 verdicts） */
function callerReturning(verdicts: unknown[]): LlmCaller {
    return async () => ({ content: JSON.stringify({ verdicts }) });
}

describe('P1 verifyLowConfidence · 归一化', () => {
    it('同义表述被剔除，不调模型', async () => {
        const caller = callerReturning([]);
        const result = await verifyLowConfidence(
            [contradiction({ evidenceA: { quote: '约摸十五六岁', chapterKey: '第1章' }, evidenceB: { quote: '十五六岁', chapterKey: '第5章' } })],
            { assertions: [], chapters: [], llm: { caller } },
        );
        expect(result.contradictions).toHaveLength(0);
        expect(result.calls).toBe(0);
    });

    it('高置信矛盾不经判定（不花钱）', async () => {
        const caller = callerReturning([]);
        const result = await verifyLowConfidence(
            [contradiction({ confidence: 0.95 })],
            { assertions: [], chapters: [], llm: { caller } },
        );
        expect(result.contradictions).toHaveLength(1);
        expect(result.calls).toBe(0);
    });
});

describe('P1 verifyLowConfidence · LLM 判定', () => {
    const truly = [contradiction({ evidenceA: { quote: '十七岁', chapterKey: '第1章' }, evidenceB: { quote: '四十岁', chapterKey: '第20章' } })];

    it('模型判 real=false → 剔除', async () => {
        const result = await verifyLowConfidence(truly, {
            assertions: [],
            chapters: [],
            llm: { caller: callerReturning([{ index: 0, real: false, reason: '两位面不同时期，可同时成立', confidence: 0.9 }]) },
        });
        expect(result.contradictions).toHaveLength(0);
        expect(result.calls).toBe(1);
    });

    it('模型判 real=true → 保留且 decidedBy=llm', async () => {
        const result = await verifyLowConfidence(truly, {
            assertions: [],
            chapters: [],
            llm: { caller: callerReturning([{ index: 0, real: true, reason: '同一时期不可能既17岁又40岁', confidence: 0.9 }]) },
        });
        expect(result.contradictions).toHaveLength(1);
        expect(result.contradictions[0].decidedBy).toBe('llm');
    });

    it('**判定失败保留规则结果**（不因模型问题丢矛盾）', async () => {
        const result = await verifyLowConfidence(truly, {
            assertions: [],
            chapters: [],
            llm: {
                caller: async () => {
                    throw new Error('模型超时');
                },
            },
        });
        expect(result.contradictions).toHaveLength(1);
        expect(result.contradictions[0].decidedBy).toBe('rule');
    });

    it('无 LLM 时保留归一化后的结果', async () => {
        const result = await verifyLowConfidence(truly, { assertions: [], chapters: [] });
        expect(result.contradictions).toHaveLength(1);
        expect(result.calls).toBe(0);
    });
});

describe('P2 adviseState · 第二意见', () => {
    const facts = [fact()];

    it('一致：同义表述也算一致', () => {
        const advice = adviseState(facts, { subject: '宁缺', predicate: '年龄', chapter: 5, value: '约摸十七岁' });
        expect(advice.status).toBe('consistent');
    });

    it('冲突：给出权威值与引文', () => {
        const advice = adviseState(facts, { subject: '宁缺', predicate: '年龄', chapter: 5, value: '四十岁' });
        expect(advice.status).toBe('conflict');
        expect(advice.authoritative?.value).toBe('十七');
        expect(advice.reason).toContain('宁缺今年十七岁');
    });

    it('**未知不误判**：查不到事实返回 unknown 而非冲突', () => {
        const advice = adviseState(facts, { subject: '陌生人', predicate: '年龄', chapter: 5, value: '三十岁' });
        expect(advice.status).toBe('unknown');
    });

    it('未来事实不参与（第20章记录不能用于第5章比对）', () => {
        const futureFacts = [fact({ chapter: 20, validFrom: 20, value: '二十' })];
        expect(adviseState(futureFacts, { subject: '宁缺', predicate: '年龄', chapter: 5, value: '六十' }).status).toBe('unknown');
    });
});

describe('P2 effectiveFacts / findConflicts', () => {
    it('同谓词取最晚一条', () => {
        const facts = [fact({ chapter: 1, value: '十七' }), fact({ chapter: 10, value: '十八' })];
        expect(effectiveFacts(facts, '宁缺', '年龄', 15)[0].value).toBe('十八');
    });

    it('findConflicts 只返回冲突项', () => {
        const facts = [fact()];
        const out = findConflicts(facts, [
            { subject: '宁缺', predicate: '年龄', chapter: 5, value: '十七岁' },
            { subject: '宁缺', predicate: '年龄', chapter: 5, value: '五十岁' },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].advice.status).toBe('conflict');
    });
});

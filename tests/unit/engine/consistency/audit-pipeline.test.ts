/**
 * 审核编排单测（S2 收口）
 *
 * 锁三件事：
 *  1. 规则层命中后，能用章节正文把 offset 补上（定位失败不报错）；
 *  2. 不传 LLM 时**零调用**（ruleOnly=true），传了才调，且次数受控；
 *  3. 报告汇总（按类型统计 / 排序 / 摘要）稳定。
 */

import { describe, expect, it, vi } from 'vitest';
import {
    dedupe,
    formatReportSummary,
    locateAll,
    runAudit,
    sortContradictions,
    summarizeByKind,
} from '../../../../engine/consistency/audit-pipeline';
import type { ConsistencyContradiction, FactAssertion } from '../../../../engine/consistency/assertion-model';

/** 造年龄断言 */
function age(chapterNum: number, value: number, subject = '张三'): FactAssertion {
    return {
        id: `quantitative|${subject}|年龄|第${chapterNum}章`,
        kind: 'quantitative',
        subject,
        predicate: '年龄',
        value: String(value),
        numericValue: value,
        unit: '岁',
        chapterKey: `第${chapterNum}章`,
        chapterNum,
        quote: `${subject}今年${value}岁`,
        source: 'digest-fact',
        extractedAt: 0,
    };
}

/** 造一条矛盾（用于纯函数测试） */
function contradiction(overrides: Partial<ConsistencyContradiction> = {}): ConsistencyContradiction {
    return {
        id: 'c|quantitative|张三|年龄|第1章|第40章',
        kind: 'quantitative',
        category: 'factual',
        subject: '张三',
        predicate: '年龄',
        reasoning: '年龄倒退',
        evidenceA: { quote: '张三今年20岁', chapterKey: '第1章' },
        evidenceB: { quote: '张三今年18岁', chapterKey: '第40章' },
        decidedBy: 'rule',
        confidence: 0.9,
        ...overrides,
    };
}

describe('runAudit · 规则层（零 token）', () => {
    it('年龄倒退 → 产出矛盾，ruleOnly=true，零 LLM 调用', async () => {
        const report = await runAudit({ assertions: [age(1, 20), age(40, 18)] });
        expect(report.contradictions).toHaveLength(1);
        expect(report.ruleOnly).toBe(true);
        expect(report.llmCalls).toBe(0);
    });

    it('无矛盾 → 空报告', async () => {
        const report = await runAudit({ assertions: [age(1, 18), age(40, 20)] });
        expect(report.contradictions).toHaveLength(0);
        expect(report.byKind).toHaveLength(0);
        expect(formatReportSummary(report)[0]).toContain('未发现');
    });

    it('用章节正文补上 offset', async () => {
        const report = await runAudit({
            assertions: [age(1, 20), age(40, 18)],
            chapters: [
                { chapterKey: '第1章', body: '开场白。张三今年20岁，站在山巅。' },
                { chapterKey: '第40章', body: '多年后。张三今年18岁，令人费解。' },
            ],
        });
        expect(report.contradictions[0].evidenceA.offset).toBe('开场白。'.length);
        expect(report.contradictions[0].evidenceB.offset).toBe('多年后。'.length);
    });

    it('正文缺失时 offset 保持 undefined（不报错）', async () => {
        const report = await runAudit({ assertions: [age(1, 20), age(40, 18)] });
        expect(report.contradictions[0].evidenceA.offset).toBeUndefined();
    });
});

describe('runAudit · LLM 复核层', () => {
    it('传了 llm 才会调用，且次数受 maxPairs 限制', async () => {
        const caller = vi.fn(async () => ({
            content: '{"contradictory":true,"reasoning":"同一角色两个名字","confidence":0.9}',
        }));
        const candidate: FactAssertion = {
            id: 'n1', kind: 'nomenclature', subject: '张三', predicate: '权威名称', value: '张三',
            chapterKey: '第5章', chapterNum: 5, quote: '张三走进院子', source: 'digest-fact', extractedAt: 0,
        };
        const auth: FactAssertion = {
            id: 'n2', kind: 'nomenclature', subject: '张叁', predicate: '权威名称', value: '张叁',
            chapterKey: '', chapterNum: null, quote: '事实索引已确认：张叁', source: 'fact-index', extractedAt: 0,
        };
        const report = await runAudit({
            assertions: [candidate, auth],
            llm: { caller, maxPairs: 3 },
        });
        expect(report.ruleOnly).toBe(false);
        expect(report.llmCalls).toBe(1);
        expect(caller).toHaveBeenCalledTimes(1);
        expect(report.contradictions.some(c => c.decidedBy === 'llm')).toBe(true);
    });

    it('没有疑似配对时不调用模型', async () => {
        const caller = vi.fn(async () => ({ content: '{}' }));
        const report = await runAudit({ assertions: [age(1, 20), age(40, 18)], llm: { caller } });
        expect(caller).not.toHaveBeenCalled();
        expect(report.llmCalls).toBe(0);
    });
});

describe('报告汇总', () => {
    it('locateAll 保留已有 offset 不覆盖', () => {
        const c = contradiction({ evidenceA: { quote: '张三今年20岁', chapterKey: '第1章', offset: 99 } });
        const located = locateAll([c], [{ chapterKey: '第1章', body: '开头。张三今年20岁。' }]);
        expect(located[0].evidenceA.offset).toBe(99);
    });

    it('dedupe 保留置信度更高的一条', () => {
        const low = contradiction({ id: 'same', confidence: 0.5 });
        const high = contradiction({ id: 'same', confidence: 0.95 });
        expect(dedupe([low, high])).toHaveLength(1);
        expect(dedupe([low, high])[0].confidence).toBe(0.95);
    });

    it('sortContradictions 严重度高的在前', () => {
        const high = contradiction({ kind: 'quantitative', confidence: 0.7 });
        const medium = contradiction({ kind: 'appearance', confidence: 0.99, id: 'other' });
        const sorted = sortContradictions([medium, high]);
        expect(sorted[0].kind).toBe('quantitative');
    });

    it('summarizeByKind 统计并降序', () => {
        const stats = summarizeByKind([
            contradiction({ kind: 'quantitative' }),
            contradiction({ kind: 'quantitative', id: 'x2' }),
            contradiction({ kind: 'duration', id: 'x3' }),
        ]);
        expect(stats[0]).toMatchObject({ kind: 'quantitative', count: 2 });
        expect(stats[0].label).toBe('数量不符');
    });

    it('formatReportSummary 摘要可读', async () => {
        const report = await runAudit({ assertions: [age(1, 20), age(40, 18)] });
        const lines = formatReportSummary(report);
        expect(lines[0]).toContain('1 处');
        expect(lines.some(l => l.includes('数量不符'))).toBe(true);
    });
});

/**
 * 审核消费事实库断言（P0-4 接线验证）
 *
 * 锁住：事实库里的结构化事实会作为断言参与配对（source=fact-store），
 * 且事实库缺失/读失败时审核照常进行（不阻断、有告警）。
 */

import { describe, expect, it } from 'vitest';
import { runProjectConsistencyAudit, type ConsistencyAuditDeps } from '../../../../engine/consistency/consistency-service';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';
import { MockFileSystem } from '../../../../shared/file-system-port';

/** 造事实库断言 */
function factAssertion(chapter: number, value: string): FactAssertion {
    return {
        id: `fact-store|${chapter}|宁缺|年龄|0`,
        kind: 'quantitative',
        subject: '宁缺',
        predicate: '年龄',
        value,
        numericValue: Number(value),
        unit: '岁',
        chapterKey: `第${chapter}章`,
        chapterNum: chapter,
        quote: `宁缺今年${value}岁`,
        source: 'fact-store',
        extractedAt: 0,
    };
}

/** 最小 deps */
function deps(over: Partial<ConsistencyAuditDeps> = {}): ConsistencyAuditDeps {
    return {
        fs: new MockFileSystem(),
        listDigests: async () => [],
        listBodies: async () => [],
        loadChapterBody: async () => '',
        listCharacters: async () => [],
        listLedgerEvents: async () => [],
        listConfirmedFacts: async () => [],
        ...over,
    };
}

describe('审核消费事实库', () => {
    it('事实库的年龄断言能检出跨章倒退（source=fact-store）', async () => {
        const result = await runProjectConsistencyAudit(
            '项目A',
            deps({ listFactStoreAssertions: async () => [factAssertion(1, '18'), factAssertion(20, '16')] }),
            { useLlm: false },
            () => new Date(0),
        );
        const hit = result.report.contradictions.find(c => c.kind === 'quantitative');
        expect(hit).toBeDefined();
        expect(hit!.subject).toBe('宁缺');
    });

    it('事实库缺失时审核照常（不报错、不阻断）', async () => {
        const result = await runProjectConsistencyAudit(
            '项目A',
            deps({ listFactStoreAssertions: async () => [] }),
            { useLlm: false },
            () => new Date(0),
        );
        expect(result.report).toBeDefined();
        expect(result.report.contradictions).toHaveLength(0);
    });

    it('事实库读取抛错时降级（不把审核打死）', async () => {
        const result = await runProjectConsistencyAudit(
            '项目A',
            deps({
                listFactStoreAssertions: async () => {
                    throw new Error('事实库读取失败');
                },
            }),
            { useLlm: false },
            () => new Date(0),
        );
        expect(result.report).toBeDefined();
    });
});

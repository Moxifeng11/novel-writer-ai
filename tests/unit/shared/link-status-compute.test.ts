/**
 * link-status-compute.test.ts — 三条链路判定与 agent 文案回归（DSH-20261112-17）
 *
 * 新增 orphanCount 语义：>0 时「检索」环节级降为 warn 且 detail 附注孤儿数——
 * -08 假绿的环节级呈现（用户扫环节图标即可见，不再依赖被 slice 挤掉的降级文案）。
 * 另锁 formatLinkStatusForAgent 的降级拼接取「末 3 条」（事件按 push 序保留，
 * slice(0,3) 取的是最旧的，与「最近」语义相反）。
 */
import { describe, expect, it } from 'vitest';
import {
    computeKnowledgeFlowStatus,
    formatLinkStatusForAgent,
} from '../../../shared/link-status-compute';

function knowledgeInput(overrides: Record<string, unknown> = {}) {
    return {
        bookTotal: 1,
        breakdownCompleted: 1,
        vectorDone: 1,
        vectorFailed: 0,
        embeddingReady: true,
        storeLoadedBooks: 1,
        storeReady: true,
        ...overrides,
    } as Parameters<typeof computeKnowledgeFlowStatus>[0];
}

describe('computeKnowledgeFlowStatus 孤儿环节级呈现（DSH-20261112-17）', () => {
    it('orphanCount>0：检索环节 warn，detail 附注「其中 M 本不在知识库索引」', () => {
        const status = computeKnowledgeFlowStatus(knowledgeInput({ orphanCount: 1 }));
        const retrieve = status.stages.find(s => s.name === '检索');
        expect(retrieve?.status).toBe('warn');
        expect(retrieve?.detail).toContain('向量库已加载 1 本');
        expect(retrieve?.detail).toContain('其中 1 本不在知识库索引');
        expect(retrieve?.detail).toContain('建议对账清理');
    });

    it('orphanCount 缺省：检索环节 ok，detail 不附注（回归防误伤）', () => {
        const status = computeKnowledgeFlowStatus(knowledgeInput());
        const retrieve = status.stages.find(s => s.name === '检索');
        expect(retrieve?.status).toBe('ok');
        expect(retrieve?.detail).toBe('向量库已加载 1 本');
    });

    it('orphanCount>0 时整体不为 ok（至少 warn）', () => {
        const status = computeKnowledgeFlowStatus(knowledgeInput({ orphanCount: 2 }));
        expect(['warn', 'broken']).toContain(status.overall);
        expect(status.overall).not.toBe('ok');
    });

    it('orphanCount=0：与缺省同语义（不触发 warn）', () => {
        const status = computeKnowledgeFlowStatus(knowledgeInput({ orphanCount: 0 }));
        const retrieve = status.stages.find(s => s.name === '检索');
        expect(retrieve?.status).toBe('ok');
        expect(status.overall).toBe('ok');
    });
});

describe('formatLinkStatusForAgent 降级拼接（DSH-20261112-17）', () => {
    const stages = [{ name: '拆解', status: 'ok' as const, detail: '1 本' }];

    it('降级多于 3 条：拼接取末 3 条（最新的），整体计数仍是全部条数', () => {
        const text = formatLinkStatusForAgent({
            title: '知识流',
            overall: 'warn',
            stages,
            breakpoint: null,
            degradations: ['d1', 'd2', 'd3', 'd4', 'd5'],
        });
        expect(text).toContain('运行时降级（5）');
        expect(text).toContain('d3；d4；d5');
        expect(text).not.toContain('d1；d2');
    });

    it('降级 ≤3 条：全部拼接', () => {
        const text = formatLinkStatusForAgent({
            title: '知识流',
            overall: 'warn',
            stages,
            breakpoint: null,
            degradations: ['only'],
        });
        expect(text).toContain('运行时降级（1）：only');
    });
});

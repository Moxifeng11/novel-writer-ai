import { describe, expect, it } from 'vitest';
import {
    addBatch, checkCoverage, contextKey, createContextSession, estimateTokens,
    hasLoaded, parseContextRequest, pendingRequests, renderSessionSummary,
} from '@/shared/context-session-model';
import type { ContextItem } from '@/shared/context-session-model';

const item = (kind: ContextItem['kind'], id: string, text = '内容'): ContextItem =>
    ({ kind, id, title: id, text, tokens: 10 });

describe('ContextSession 基础', () => {
    it('创建会话默认预算', () => {
        const s = createContextSession({ sceneId: 'SC-1', anchorIds: ['CHR-0001'] });
        expect(s.sceneId).toBe('SC-1');
        expect(s.anchorIds).toEqual(['CHR-0001']);
        expect(s.budget.usedTokens).toBe(0);
    });

    it('token 估算', () => {
        expect(estimateTokens('1234')).toBe(2);
    });
});

describe('addBatch 去重与记账', () => {
    it('加载后 hasLoaded 为真', () => {
        const s = addBatch(createContextSession({}), { reason: 'anchor', items: [item('entity', 'CHR-0001')] });
        expect(hasLoaded(s, 'entity', 'CHR-0001')).toBe(true);
        expect(s.batches).toHaveLength(1);
    });

    it('重复条目不再计入', () => {
        let s = addBatch(createContextSession({}), { reason: 'anchor', items: [item('entity', 'CHR-0001')] });
        s = addBatch(s, { reason: 'coverage-gap', items: [item('entity', 'CHR-0001')] });
        expect(s.batches).toHaveLength(1);
        expect(s.budget.usedTokens).toBe(10);
    });

    it('超预算显式记录未加载（不静默截断）', () => {
        const s = addBatch(createContextSession({ maxTokens: 500 }), {
            reason: 'anchor',
            items: Array.from({ length: 100 }, (_, i) => item('assertion', `AST-${i}`)),
        });
        expect(s.unloaded.length).toBeGreaterThan(0);
        expect(renderSessionSummary(s)).toContain('未加载');
    });
});

describe('覆盖检查', () => {
    it('缺什么列什么', () => {
        const s = addBatch(createContextSession({}), { reason: 'anchor', items: [item('entity', 'CHR-0001')] });
        const report = checkCoverage(s, [
            { kind: 'entity', ids: ['CHR-0001', 'CHR-0002'] },
            { kind: 'relation', ids: ['REL-0001'] },
        ]);
        expect(report.required).toBe(3);
        expect(report.loaded).toBe(1);
        expect(report.missing).toEqual([contextKey('entity', 'CHR-0002'), contextKey('relation', 'REL-0001')]);
    });

    it('pendingRequests 按类别分组', () => {
        const s = createContextSession({});
        const report = checkCoverage(s, [
            { kind: 'entity', ids: ['A', 'B'] },
            { kind: 'foreshadow', ids: ['C'] },
        ]);
        const pending = pendingRequests(report);
        expect(pending).toEqual([
            { kind: 'entity', ids: ['A', 'B'] },
            { kind: 'foreshadow', ids: ['C'] },
        ]);
    });
});

describe('parseContextRequest', () => {
    it('合法请求', () => {
        const result = parseContextRequest({ kind: 'assertion', ids: ['AST-1'], reason: '核对' });
        expect(result.request?.kind).toBe('assertion');
        expect(result.request?.ids).toEqual(['AST-1']);
    });

    it('缺 ids 与 filter 报错', () => {
        expect(parseContextRequest({ kind: 'entity' }).error).toContain('ids 或 filter');
    });

    it('非法 kind 报错', () => {
        expect(parseContextRequest({ kind: 'nope', ids: ['x'] }).error).toContain('kind');
    });

    it('filter 形式可用', () => {
        const result = parseContextRequest({ kind: 'foreshadow', filter: { status: 'planted' }, reason: 'r' });
        expect(result.request?.filter).toEqual({ status: 'planted' });
    });
});

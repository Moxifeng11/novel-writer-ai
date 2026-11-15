import { describe, expect, it } from 'vitest';
import {
    batchAssertions, estimateAssertionTokens, renderAssertionConstraints,
    selectAssertionsForEntities, sortBySeverity, verifyAssertionCoverage,
} from '@/shared/assertion-batch-model';
import type { BatchAssertion } from '@/shared/assertion-batch-model';

const a = (id: string, entityIds: string[], severity?: BatchAssertion['severity'], chapter?: number): BatchAssertion =>
    ({ id, entityIds, text: `约束 ${id} 的说明文字`, severity, chapter });

describe('selectAssertionsForEntities', () => {
    it('命中任一在场实体即全取（不设条数）', () => {
        const all = [a('AST-1', ['CHR-0001']), a('AST-2', ['CHR-0002']), a('AST-3', ['CHR-0009'])];
        expect(selectAssertionsForEntities(all, ['CHR-0001', 'CHR-0002']).map(x => x.id)).toEqual(['AST-1', 'AST-2']);
    });

    it('同一实体多条断言全部返回（不截断）', () => {
        const many = Array.from({ length: 50 }, (_, i) => a(`AST-${i}`, ['CHR-0001']));
        expect(selectAssertionsForEntities(many, ['CHR-0001'])).toHaveLength(50);
    });
});

describe('batchAssertions', () => {
    it('按 token 预算分批，总数不丢', () => {
        const many = Array.from({ length: 40 }, (_, i) => a(`AST-${i}`, ['CHR-0001'], 'medium'));
        const result = batchAssertions(many, { maxTokensPerBatch: 300 });
        expect(result.batches.length).toBeGreaterThan(1);
        expect(result.batches.flat()).toHaveLength(40);
        expect(result.total).toBe(40);
    });

    it('单条超预算独占一批，不丢弃', () => {
        const huge = { id: 'AST-HUGE', entityIds: ['CHR-0001'], text: 'x'.repeat(10_000) };
        const result = batchAssertions([a('AST-1', ['CHR-0001']), huge], { maxTokensPerBatch: 200 });
        expect(result.oversized).toBe(1);
        expect(result.batches.flat().map(x => x.id)).toContain('AST-HUGE');
    });

    it('空输入返回空批次', () => {
        expect(batchAssertions([]).batches).toEqual([]);
    });

    it('token 估算有下限', () => {
        expect(estimateAssertionTokens(a('AST-1', [], 'high'))).toBeGreaterThanOrEqual(8);
    });
});

describe('覆盖与排序', () => {
    it('覆盖核对列出缺失', () => {
        expect(verifyAssertionCoverage(['A', 'B', 'C'], ['A'])).toEqual(['B', 'C']);
    });

    it('高风险优先但不删除', () => {
        const sorted = sortBySeverity([a('L', ['x'], 'low'), a('H', ['x'], 'high'), a('M', ['x'], 'medium')]);
        expect(sorted.map(x => x.id)).toEqual(['H', 'M', 'L']);
        expect(sorted).toHaveLength(3);
    });

    it('渲染约束清单含 ID 与来源', () => {
        const text = renderAssertionConstraints([a('AST-1', ['CHR-0001'], 'high', 3)]);
        expect(text).toContain('[AST-1]');
        expect(text).toContain('第3章');
    });
});

import { describe, expect, it } from 'vitest';
import { buildAssertionConstraintPack, renderAssertionConstraintSection } from '@/services/assertion-context-service';
import type { BatchAssertion } from '@/shared/assertion-batch-model';

const a = (id: string, entityIds: string[], severity?: BatchAssertion['severity']): BatchAssertion =>
    ({ id, entityIds, text: `约束 ${id} 的说明文字`, severity });

describe('buildAssertionConstraintPack', () => {
    it('按在场实体全取并分批', () => {
        const all = Array.from({ length: 30 }, (_, i) => a(`AST-${i}`, ['CHR-0001'], 'medium'));
        const pack = buildAssertionConstraintPack(all, ['CHR-0001'], { maxTokensPerBatch: 300 });
        expect(pack.relevant).toHaveLength(30);
        expect(pack.batches.total).toBe(30);
        expect(pack.sections.length).toBeGreaterThan(1);
        expect(pack.batches.batches.flat()).toHaveLength(30);
    });

    it('高风险排在最前', () => {
        const pack = buildAssertionConstraintPack([
            a('AST-L', ['CHR-0001'], 'low'), a('AST-H', ['CHR-0001'], 'high'),
        ], ['CHR-0001']);
        expect(pack.relevant[0].id).toBe('AST-H');
    });

    it('必需断言缺失时报告数据缺口', () => {
        const pack = buildAssertionConstraintPack([a('AST-1', ['CHR-0001'])], ['CHR-0001'], {
            requiredIds: ['AST-1', 'AST-404'],
        });
        expect(pack.missing).toEqual(['AST-404']);
    });

    it('无相关断言时返回空', () => {
        const pack = buildAssertionConstraintPack([a('AST-1', ['CHR-0009'])], ['CHR-0001']);
        expect(pack.relevant).toEqual([]);
        expect(renderAssertionConstraintSection(pack)).toBe('');
    });
});

describe('renderAssertionConstraintSection', () => {
    it('拼接所有批次并标注批次序号', () => {
        const all = Array.from({ length: 20 }, (_, i) => a(`AST-${i}`, ['CHR-0001'], 'medium'));
        const pack = buildAssertionConstraintPack(all, ['CHR-0001'], { maxTokensPerBatch: 200 });
        const text = renderAssertionConstraintSection(pack);
        expect(text).toContain('一致性约束');
        expect(text).toContain('批次 1/');
        expect(text).toContain('AST-0');
    });

    it('数据缺口显式提示', () => {
        const pack = buildAssertionConstraintPack([a('AST-1', ['CHR-0001'])], ['CHR-0001'], { requiredIds: ['AST-9'] });
        expect(renderAssertionConstraintSection(pack)).toContain('数据缺口');
    });
});

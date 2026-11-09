import { describe, expect, it } from 'vitest';
import { computeKnowledgeCapability } from '../../../ui/views/knowledge-capability';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';

function book(partial: Partial<BookBasicInfo>): BookBasicInfo {
    return {
        id: partial.id || 'b1',
        name: partial.name || '书',
        breakdownStatus: partial.breakdownStatus || 'pending',
        vectorStatus: partial.vectorStatus,
        ...partial,
    } as BookBasicInfo;
}

/** 知识库能力边界：空库/拆解未完成/无向量/部分就绪/就绪 */
describe('computeKnowledgeCapability', () => {
    it('空库为未积累，并提示不会参与检索', () => {
        const result = computeKnowledgeCapability([]);
        expect(result.stage).toBe('empty');
        expect(result.notes.join('')).toContain('导入书籍');
    });

    it('有书但未拆解为积累中', () => {
        const result = computeKnowledgeCapability([book({ breakdownStatus: 'processing' })]);
        expect(result.stage).toBe('accumulating');
        expect(result.notes.join('')).toContain('完成至少 1 本书');
    });

    it('拆解完成但无向量为降级，明确区分可查看与可检索', () => {
        const result = computeKnowledgeCapability([book({ breakdownStatus: 'completed', vectorStatus: 'pending' })]);
        expect(result.stage).toBe('degraded');
        expect(result.notes.join('')).toContain('语义检索尚不可用');
    });

    it('部分书向量就绪为积累中', () => {
        const result = computeKnowledgeCapability([
            book({ id: 'a', breakdownStatus: 'completed', vectorStatus: 'done' }),
            book({ id: 'b', breakdownStatus: 'completed', vectorStatus: 'pending' }),
        ]);
        expect(result.stage).toBe('accumulating');
        expect(result.metrics.find(m => m.label === '向量就绪')?.value).toBe(1);
    });

    it('全部向量就绪为已生效，并说明普通/精准模式的差异', () => {
        const result = computeKnowledgeCapability([
            book({ id: 'a', breakdownStatus: 'completed', vectorStatus: 'done' }),
        ]);
        expect(result.stage).toBe('ready');
        expect(result.notes.join('')).toContain('style');
    });
});

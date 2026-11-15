/**
 * A4：协同与正文统一——知识片段合并规则 + 结构化约束开关
 */

import { describe, expect, it } from 'vitest';
import { composeKnowledgeParts } from '@/engine/co-writer-engine';

describe('composeKnowledgeParts', () => {
    it('按固定顺序拼接并跳过空值', () => {
        const text = composeKnowledgeParts({
            knowledgeInjection: 'K1',
            kbDeepInjection: '',
            associationText: 'A1',
            structuredConstraints: 'C1',
        });
        expect(text).toBe('K1\n\nA1\n\nC1');
    });

    it('相同内容只保留一次（正文/协同共用去重口径）', () => {
        const text = composeKnowledgeParts({
            knowledgeInjection: 'same',
            associationText: 'same',
            structuredConstraints: 'C1',
        });
        expect(text).toBe('same\n\nC1');
    });

    it('全空返回空串', () => {
        expect(composeKnowledgeParts({})).toBe('');
    });

    it('结构化约束排在最后（不打断原有知识顺序）', () => {
        const text = composeKnowledgeParts({ knowledgeInjection: 'K', structuredConstraints: 'C' });
        expect(text.indexOf('K')).toBeLessThan(text.indexOf('C'));
    });
});

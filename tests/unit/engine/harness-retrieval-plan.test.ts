import { describe, it, expect } from 'vitest';
import {
    createCitation,
    createRetrievalPlan,
    formatCitations,
    isCitationUsable,
} from '../../../engine/harness/retrieval-plan';

describe('RetrievalPlan', () => {
    it('生成计划并校验查询', () => {
        const plan = createRetrievalPlan({
            projectId: 'p',
            mode: 'short',
            taskId: 'outline',
            queries: [
                { type: 'structured', query: '反转表', scope: 'project', topK: 3 },
                { type: 'semantic', query: '婚姻财产', scope: 'project', topK: 5 },
            ],
        });
        expect(plan.id).toMatch(/^rp_/);
        expect(plan.queries).toHaveLength(2);
        expect(plan.maxFragments).toBe(12);
        expect(() => createRetrievalPlan({ projectId: 'p', mode: 'long', taskId: 'x', queries: [] })).toThrow();
        expect(() => createRetrievalPlan({
            projectId: 'p', mode: 'long', taskId: 'x',
            queries: [{ type: 'semantic', query: '', scope: 'project', topK: 1 }],
        })).toThrow();
    });

    it('未验证/无 URL 的外部引用不可用', () => {
        const inferred = createCitation({ sourceId: 'm1', title: '模型推断', snippet: '推测', score: 0.9, kind: 'external', verified: false });
        const noUri = createCitation({ sourceId: 'e1', title: '外部来源', snippet: '摘要', score: 0.9, kind: 'external', verified: true });
        const good = createCitation({ sourceId: 'v1', title: '项目设定', snippet: '事实', score: 0.8, kind: 'vault', verified: true });
        expect(isCitationUsable(inferred)).toBe(false);
        expect(isCitationUsable(noUri)).toBe(false);
        expect(isCitationUsable(good)).toBe(true);
        expect(formatCitations([inferred])).toContain('未经实时核实');
    });

    it('无引用时明确提示未找到证据', () => {
        expect(formatCitations([])).toContain('未找到可靠证据');
    });
});
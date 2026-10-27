import { describe, it, expect } from 'vitest';
import { compilePromptArtifact, hashPromptArtifact } from '../../../engine/harness/prompt-artifact';

const base = {
    taskId: 'long.body',
    mode: 'long' as const,
    templateId: 'long.body',
    templateVersion: 'v1',
    variables: { chapter: 3, title: '测试' },
    contextPackId: 'ctx_1',
    ruleSetId: 'rules.long.v1',
    outputContractId: 'body.markdown',
    systemPrompt: 'system',
    userPrompt: 'user',
    tokenBudget: { maxInput: 8000, maxOutput: 4000 },
};

describe('PromptArtifact', () => {
    it('生成稳定 hash，同一输入一致', () => {
        const a = compilePromptArtifact(base);
        const b = compilePromptArtifact(base);
        expect(a.hash).toBe(b.hash);
        expect(a.hash).toMatch(/^pa_[0-9a-f]{8}$/);
    });

    it('模板版本/变量变化导致 hash 变化', () => {
        const a = hashPromptArtifact(base);
        expect(hashPromptArtifact({ ...base, templateVersion: 'v2' })).not.toBe(a);
        expect(hashPromptArtifact({ ...base, variables: { chapter: 4 } })).not.toBe(a);
        expect(hashPromptArtifact({ ...base, userPrompt: 'changed' })).not.toBe(a);
    });

    it('拒绝空任务/空模板/非法预算', () => {
        expect(() => compilePromptArtifact({ ...base, taskId: '' })).toThrow();
        expect(() => compilePromptArtifact({ ...base, templateVersion: '' })).toThrow();
        expect(() => compilePromptArtifact({ ...base, tokenBudget: { maxInput: 0, maxOutput: 1 } })).toThrow();
    });
});
import { describe, expect, it } from 'vitest';
import { computeFingerprintCapability } from '../../../ui/views/fingerprint-capability';

const base = {
    templateCount: 0,
    globalCount: 0,
    projectCount: 0,
    enabledCount: 0,
    totalSamples: 0,
    v2Count: 0,
    vectorReady: true,
    embeddingReady: true,
};

describe('computeFingerprintCapability', () => {
    it('空库为未积累，明确不产生风格注入', () => {
        const result = computeFingerprintCapability(base);
        expect(result.stage).toBe('empty');
        expect(result.notes.join('')).toContain('不会产生风格注入');
    });

    it('有指纹但全部未启用为降级', () => {
        const result = computeFingerprintCapability({ ...base, projectCount: 1 });
        expect(result.stage).toBe('degraded');
        expect(result.notes.join('')).toContain('全部未启用');
    });

    it('有指纹无样本为积累中，提示补 few-shot', () => {
        const result = computeFingerprintCapability({ ...base, projectCount: 1, enabledCount: 1 });
        expect(result.stage).toBe('accumulating');
        expect(result.notes.join('')).toContain('2–3 段');
    });

    it('向量/embedding 未就绪为降级，但说明文本特征仍可注入', () => {
        const result = computeFingerprintCapability({
            ...base,
            projectCount: 1,
            enabledCount: 1,
            totalSamples: 4,
            vectorReady: false,
        });
        expect(result.stage).toBe('degraded');
        expect(result.notes.join('')).toContain('文本特征注入');
    });

    it('样本充足且向量就绪为已生效，并提示评分参考来自知识库 style 向量', () => {
        const result = computeFingerprintCapability({
            ...base,
            projectCount: 1,
            enabledCount: 1,
            totalSamples: 4,
            v2Count: 1,
        });
        expect(result.stage).toBe('ready');
        expect(result.notes.join('')).toContain('知识库 style 向量');
    });
});

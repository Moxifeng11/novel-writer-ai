/**
 * 步骤 prompt 装配的预算作用域（G2-4）
 *
 * 知识注入与分段裁剪都读 activeContextQuotas()。装配必须在「注入之前」把配额设为
 * 本步模型的输入预算，并在结束后还原——否则：
 *  - 小窗口模型步骤会沿用上一个云端流程的配额（注入被撑爆后整段丢弃）
 *  - 云端步骤会沿用本地配额（窗口空着不用，剧情跳步）
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assembleStepPrompt, type StepPromptAssemblyHost } from '../../../engine/step-prompt-assembly';
import {
    getActiveInputBudget,
    resetActiveInputBudget,
    setActiveInputBudget,
} from '../../../shared/context-budget-policy';

afterEach(() => { resetActiveInputBudget(); });

describe('assembleStepPrompt 预算作用域', () => {
    it('注入期间读到的是本步预算，结束后恢复原值', async () => {
        setActiveInputBudget(120_000);
        const seen: number[] = [];
        const host: StepPromptAssemblyHost = {
            loadOutlineKnowledge: async () => '',
            loadBodyKnowledge: async () => '',
            loadBodyKnowledgeParts: async () => {
                seen.push(getActiveInputBudget());
                return { extra: '', system: '' };
            },
            resolveStepBudgetLimits: () => ({ maxContext: 100_000, maxOutput: 2_000, maxInputTokens: 64_000 }),
        };

        const result = await assembleStepPrompt(
            host,
            {} as never,
            'bodyGeneration',
            '系统提示',
            '用户提示',
            'flash-test',
        );

        expect(seen).toEqual([64_000]);
        expect(result.maxInputTokens).toBeLessThanOrEqual(64_000);
        // 流程结束不能把 64K 留给下一个流程
        expect(getActiveInputBudget()).toBe(120_000);
    });

    it('装配抛错也恢复预算（知识注入失败不改变全局配额）', async () => {
        setActiveInputBudget(32_000);
        const host: StepPromptAssemblyHost = {
            loadOutlineKnowledge: async () => '',
            loadBodyKnowledge: async () => '',
            loadBodyKnowledgeParts: async () => {
                throw new Error('inject failed');
            },
            resolveStepBudgetLimits: () => ({ maxContext: 100_000, maxOutput: 2_000, maxInputTokens: 64_000 }),
        };

        await expect(assembleStepPrompt(
            host,
            {} as never,
            'bodyGeneration',
            '系统提示',
            '用户提示',
            'flash-test',
        )).rejects.toThrow('inject failed');

        expect(getActiveInputBudget()).toBe(32_000);
    });
});

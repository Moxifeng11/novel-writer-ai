import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../../shared/token-estimator';
import { planContextBudget } from '../../../shared/context/budget-plan';
import {
    ContextOverflowError,
    compressExtractive,
    recoverOverflow,
} from '../../../engine/context/overflow-recovery';

const longText = Array.from({ length: 40 }, (_, index) => `第${index + 1}句：林惊鸿在青云山练剑，剑气纵横。`).join('');

describe('budget-plan — 缺口计算', () => {
    it('required/optional 分开统计并计算缺口', () => {
        const plan = planContextBudget([
            { key: 'world', role: 'required', priority: 10, minTokens: 100, shrinkable: true, text: '世界观'.repeat(200) },
            { key: 'extra', role: 'optional', priority: 1, minTokens: 20, shrinkable: true, text: '补充'.repeat(200) },
        ], 300);
        expect(plan.totalTokens).toBeGreaterThan(300);
        expect(plan.deficit).toBe(plan.totalTokens - 300);
        expect(plan.requiredTokens).toBeGreaterThan(0);
        expect(plan.optionalTokens).toBeGreaterThan(0);
    });
});

describe('overflow-recovery — 抽取压缩', () => {
    it('保序、保留首尾句、标注压缩比例且不超预算', () => {
        const result = compressExtractive(longText, 120);
        expect(result.compressed).toBe(true);
        expect(result.text).toContain('第1句');
        expect(result.text).toContain('第40句');
        expect(result.text).toContain('〔压缩：');
        expect(result.tokens).toBeLessThanOrEqual(120);
        // 保序：第2句若保留，必须出现在第1句之后
        const first = result.text.indexOf('第1句');
        const second = result.text.indexOf('第2句');
        if (second >= 0) expect(second).toBeGreaterThan(first);
    });

    it('在场人物相关句优先保留', () => {
        const text = [
            '无关的天气描写。', '无关的景物描写。', '无关的闲谈。',
            '林惊鸿拔剑冲向敌人。', '苏雪在远处呼喊。', '最后一句收尾。',
        ].join('');
        const result = compressExtractive(text, 45, ['林惊鸿']);
        expect(result.text).toContain('林惊鸿');
    });

    it('未超预算原样返回', () => {
        const result = compressExtractive('短文本。', 100);
        expect(result.compressed).toBe(false);
        expect(result.text).toBe('短文本。');
    });
});

describe('overflow-recovery — 恢复流程', () => {
    it('先定向补检，再压缩 optional，仍超显式报错', async () => {
        const result = await recoverOverflow({
            system: '系统提示',
            user: `【大纲】\n${'大纲'.repeat(500)}\n【补充】\n${'补充'.repeat(500)}`,
            maxInputTokens: 400,
            focusTerms: ['林惊鸿'],
            retrieve: async () => '【补检】\n林惊鸿当前受伤。',
            modelId: 'default',
        });
        expect(result.retrieved).toBe(true);
        expect(result.user).toContain('补检');
        expect(estimateTokens(result.system) + result.plan.totalTokens).toBeLessThanOrEqual(400);

        await expect(recoverOverflow({
            system: '系统提示',
            user: `【大纲】\n${'大纲'.repeat(2000)}`,
            maxInputTokens: 120,
            modelId: 'default',
        })).rejects.toBeInstanceOf(ContextOverflowError);
    });

    it('mode=off 时超预算直接报错', async () => {
        await expect(recoverOverflow({
            system: '系统',
            user: `【大纲】\n${'内容'.repeat(1000)}`,
            maxInputTokens: 200,
            mode: 'off',
        })).rejects.toBeInstanceOf(ContextOverflowError);
    });
});

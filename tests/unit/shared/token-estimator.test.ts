/**
 * token-estimator.test.ts — token 估算器单元测试
 */
import { describe, it, expect } from 'vitest';
import {
    estimateTokens,
    estimateInputTokens,
    calculateTokenBudget,
    recommendMaxTokens,
    getModelContextWindow,
    getModelMaxOutput,
} from '../../../shared/token-estimator';

describe('TokenEstimator', () => {
    describe('estimateTokens', () => {
        it('空字符串返回 0', () => {
            expect(estimateTokens('')).toBe(0);
        });

        it('纯中文按 1.5 字符/token 估算（默认模型）', () => {
            const text = '中'.repeat(150); // 150 中文字符
            const tokens = estimateTokens(text);
            // 150 / 1.5 = 100
            expect(tokens).toBe(100);
        });

        it('纯英文按 4 字符/token 估算（默认模型）', () => {
            const text = 'a'.repeat(400); // 400 ASCII 字符
            const tokens = estimateTokens(text);
            // 400 / 4 = 100
            expect(tokens).toBe(100);
        });

        it('中英混合文本分层计算', () => {
            const text = '中文abc'; // 2 中文 + 3 英文
            // 默认: cn=2/1.5=1.33, en=3/4=0.75 → ceil(2.08) = 3
            const tokens = estimateTokens(text);
            expect(tokens).toBeGreaterThanOrEqual(2);
            expect(tokens).toBeLessThanOrEqual(4);
        });

        it('GPT 模型使用不同的 tokenizer 系数', () => {
            const cnText = '中'.repeat(180);
            const defaultTokens = estimateTokens(cnText, 'default');
            const gptTokens = estimateTokens(cnText, 'gpt-4-turbo');
            // GPT: 180/1.8=100, default: 180/1.5=120
            expect(gptTokens).toBeLessThan(defaultTokens);
        });

        it('Claude 模型中文效率较低', () => {
            const cnText = '中'.repeat(130);
            const defaultTokens = estimateTokens(cnText, 'default');
            const claudeTokens = estimateTokens(cnText, 'claude-3-opus');
            // Claude: 130/1.3=100, default: 130/1.5=86.7→87
            expect(claudeTokens).toBeGreaterThan(defaultTokens);
        });

        it('国产模型（deepseek/glm/qwen/doubao）使用优化系数', () => {
            const cnText = '中'.repeat(160);
            const dsTokens = estimateTokens(cnText, 'deepseek-v3');
            const glmTokens = estimateTokens(cnText, 'glm-4');
            const qwenTokens = estimateTokens(cnText, 'qwen-max');
            const doubaoTokens = estimateTokens(cnText, 'doubao-seed-2-0');
            // 全部使用 cnRatio=1.6 → 160/1.6=100
            expect(dsTokens).toBe(100);
            expect(glmTokens).toBe(100);
            expect(qwenTokens).toBe(100);
            expect(doubaoTokens).toBe(100);
        });

        it('全角字符按中文计算', () => {
            const text = 'ＡＢＣ'; // 3 全角字符 (0xFF01-0xFFEF)
            const tokens = estimateTokens(text);
            // 3 / 1.5 = 2
            expect(tokens).toBe(2);
        });
    });

    describe('estimateInputTokens', () => {
        it('system prompt 额外加 10%', () => {
            const sys = 'a'.repeat(400); // 100 tokens
            const usr = 'b'.repeat(400); // 100 tokens
            const total = estimateInputTokens(sys, usr);
            // 100*1.1 + 100 = 210
            expect(total).toBe(210);
        });

        it('空 prompt 返回 0', () => {
            expect(estimateInputTokens('', '')).toBe(0);
        });
    });

    describe('getModelContextWindow / getModelMaxOutput', () => {
        it('已知模型返回正确值', () => {
            const ctx = getModelContextWindow('deepseek-chat');
            expect(ctx).toBe(131072);
            const out = getModelMaxOutput('deepseek-chat');
            expect(out).toBe(8192);
        });

        it('未知模型回退到默认值', () => {
            const ctx = getModelContextWindow('unknown-model-xyz');
            expect(ctx).toBeGreaterThan(0);
            const out = getModelMaxOutput('unknown-model-xyz');
            expect(out).toBeGreaterThan(0);
        });
    });

    describe('calculateTokenBudget', () => {
        it('返回完整预算结构', () => {
            const budget = calculateTokenBudget('sys', 'usr', 'deepseek-chat');
            expect(budget).toHaveProperty('input');
            expect(budget).toHaveProperty('maxOutput');
            expect(budget).toHaveProperty('contextWindow');
            expect(budget).toHaveProperty('available');
            expect(budget).toHaveProperty('isSafe');
            expect(budget).toHaveProperty('modelId');
        });

        it('短 prompt 时 isSafe 为 true', () => {
            const budget = calculateTokenBudget('short', 'prompt', 'deepseek-chat');
            expect(budget.isSafe).toBe(true);
            expect(budget.available).toBe(budget.contextWindow - budget.input);
        });

        it('超长 prompt 时 isSafe 为 false', () => {
            const huge = 'x'.repeat(600000); // 600K ASCII → ~150K tokens，超过 131072 窗口
            const budget = calculateTokenBudget(huge, huge, 'deepseek-chat');
            expect(budget.isSafe).toBe(false);
            expect(budget.available).toBeLessThan(0);
        });
    });

    describe('recommendMaxTokens', () => {
        it('正常情况返回可用窗口 80% 与 maxOutput 的较小值', () => {
            const rec = recommendMaxTokens('short', 'prompt', 'deepseek-chat');
            expect(rec).toBeGreaterThan(0);
            expect(rec).toBeLessThanOrEqual(8192); // deepseek-chat maxOutput
        });

        it('最低保底 256 tokens', () => {
            const huge = 'x'.repeat(600000); // 远超窗口
            const rec = recommendMaxTokens(huge, huge, 'deepseek-chat');
            expect(rec).toBe(256);
        });
    });
});

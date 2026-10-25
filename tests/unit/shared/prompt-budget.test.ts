import { describe, it, expect } from 'vitest';
import {
    assemblePromptWithinBudget,
    clampBudgetToModelLimits,
    fitPromptToContext,
    resolvePrecedingCharLimit,
    truncateTextToTokens,
    type PromptSection,
} from '../../../shared/prompt-budget';
import { estimateInputTokens, estimateTokens } from '../../../shared/token-estimator';

const SYSTEM = '你是一位第三人称限视角的叙事者。';

function repeat(ch: string, n: number): string {
    return ch.repeat(n);
}

describe('prompt-budget — truncateTextToTokens', () => {
    it('预算为 0 时返回空串', () => {
        expect(truncateTextToTokens('一段中文', 0)).toBe('');
    });

    it('预算充足时原样返回', () => {
        const text = '前文一句。';
        expect(truncateTextToTokens(text, 1000)).toBe(text);
    });

    it('预算不足时保留前缀且不超预算', () => {
        const text = repeat('中', 1500); // 约 1000 tokens
        const out = truncateTextToTokens(text, 300);
        expect(out.length).toBeGreaterThan(0);
        expect(out.length).toBeLessThan(text.length);
        expect(estimateTokens(out)).toBeLessThanOrEqual(300);
    });
});

describe('prompt-budget — assemblePromptWithinBudget', () => {
    const sections: PromptSection[] = [
        { key: 'memory', priority: 20, shrinkable: true, text: repeat('记', 600) },   // ~400 tokens
        { key: 'context', priority: 40, shrinkable: true, text: repeat('景', 900) },  // ~600 tokens
        { key: 'plot', priority: 100, text: repeat('节', 150) },                      // ~100 tokens
    ];
    const tailParts = ['【已写内容】', repeat('文', 300), '', '【写作方向】', '推进剧情。'];

    it('预算充足时保留全部片段且顺序不变', () => {
        const result = assemblePromptWithinBudget({
            systemPrompt: SYSTEM,
            sections,
            tailParts,
            maxInputTokens: 100_000,
        });
        expect(result.droppedSections).toEqual([]);
        expect(result.trimmedSections).toEqual([]);
        expect(result.overBudget).toBe(false);
        expect(result.user.indexOf('记')).toBeLessThan(result.user.indexOf('景'));
        expect(result.user.indexOf('景')).toBeLessThan(result.user.indexOf('节'));
    });

    it('超预算时优先丢弃最低优先级片段，保留节点片段', () => {
        const result = assemblePromptWithinBudget({
            systemPrompt: SYSTEM,
            sections,
            tailParts,
            maxInputTokens: 900,
        });
        expect(result.droppedSections.length + result.trimmedSections.length).toBeGreaterThan(0);
        expect(result.user).toContain('节');
        expect(result.user).toContain('【已写内容】');
        expect(result.user).toContain('【写作方向】');
        expect(result.estimatedTokens).toBeLessThanOrEqual(900);
    });

    it('可截断片段优先截断而不是整段丢弃', () => {
        const big: PromptSection[] = [
            { key: 'context', priority: 40, shrinkable: true, text: repeat('景', 3000) },
            { key: 'plot', priority: 100, text: '走向下一节点。' },
        ];
        const result = assemblePromptWithinBudget({
            systemPrompt: SYSTEM,
            sections: big,
            tailParts,
            maxInputTokens: 900,
        });
        expect(result.droppedSections).toEqual([]);
        expect(result.trimmedSections).toContain('context');
        expect(result.user).toContain('景');
        expect(result.user).toContain('走向下一节点。');
    });

    it('必保片段在极小预算下也不被裁剪', () => {
        const result = assemblePromptWithinBudget({
            systemPrompt: SYSTEM,
            sections,
            tailParts,
            maxInputTokens: 10,
        });
        expect(result.user).toContain('【已写内容】');
        expect(result.user).toContain('【写作方向】');
        expect(result.overBudget).toBe(true);
    });

    it('空片段不参与预算统计', () => {
        const withEmpty: PromptSection[] = [
            { key: 'empty', priority: 5, text: '   ' },
            { key: 'plot', priority: 100, text: '走向下一节点。' },
        ];
        const result = assemblePromptWithinBudget({
            systemPrompt: SYSTEM,
            sections: withEmpty,
            tailParts,
            maxInputTokens: 100_000,
        });
        expect(result.droppedSections).toEqual([]);
        expect(result.user).not.toContain('empty');
        expect(estimateInputTokens(SYSTEM, result.user)).toBe(result.estimatedTokens);
    });
});

describe('prompt-budget — resolvePrecedingCharLimit', () => {
    it('无预算时保持历史行为 800 字', () => {
        expect(resolvePrecedingCharLimit()).toBe(800);
        expect(resolvePrecedingCharLimit(0)).toBe(800);
    });

    it('本地 8192 窗口取满 2000 字（与快照上限对齐）', () => {
        expect(resolvePrecedingCharLimit(7472)).toBe(2000);
    });

    it('极大窗口不超过 2000 字，极小窗口回落到 800 字', () => {
        expect(resolvePrecedingCharLimit(100_000)).toBe(2000);
        expect(resolvePrecedingCharLimit(600)).toBe(800);
    });

    it('中间窗口按预算线性收紧', () => {
        // 3376 tokens × 0.2 × 1.5 ≈ 1012 字符，落在 (800, 2000) 之间
        const limit = resolvePrecedingCharLimit(3376);
        expect(limit).toBeGreaterThan(800);
        expect(limit).toBeLessThan(2000);
    });
});

describe('prompt-budget — fitPromptToContext（11 步流水线窗口闸门）', () => {
    const base = { maxContext: 2000, maxOutput: 100, safeBuffer: 100 }; // 安全线 1800 tokens

    it('预算充足时保留主体与知识注入', () => {
        const user = repeat('段', 900); // ~600 tokens
        const extra = repeat('知', 300); // ~200 tokens
        const fit = fitPromptToContext({ systemPrompt: SYSTEM, userPrompt: user, extraTail: extra, ...base });
        expect(fit.truncated).toBe(false);
        expect(fit.droppedExtra).toBe(false);
        expect(fit.user).toContain(extra);
    });

    it('注入导致超预算但主体放得下：只丢注入，主体不截断', () => {
        const user = repeat('段', 1500); // ~1000 tokens
        const extra = repeat('知', 3000); // ~2000 tokens
        const fit = fitPromptToContext({ systemPrompt: SYSTEM, userPrompt: user, extraTail: extra, ...base });
        expect(fit.droppedExtra).toBe(true);
        expect(fit.truncated).toBe(false);
        expect(fit.user).toBe(user);
        expect(fit.estimatedTokens).toBeLessThanOrEqual(1800);
    });

    it('主体自身超预算：保留头部与尾部，中间资料被截断', () => {
        // 中间标记放在头部保留区之后（headKeep ≈ 2315 字符），确保落在被丢弃的中段
        const user = repeat('中', 3000) + '【中间资料】' + repeat('料', 1000)
            + repeat('尾', 1500) + '【输出约束】';
        const fit = fitPromptToContext({ systemPrompt: SYSTEM, userPrompt: user, ...base });
        expect(fit.truncated).toBe(true);
        expect(fit.user).toContain('【输出约束】');
        expect(fit.user).not.toContain('【中间资料】');
        expect(fit.user).toContain('已自动保留头部+尾部');
    });

    it('主体与注入都超预算：截断主体并丢弃注入', () => {
        const user = repeat('中', 4000);
        const extra = repeat('知', 1000);
        const fit = fitPromptToContext({ systemPrompt: SYSTEM, userPrompt: user, extraTail: extra, ...base });
        expect(fit.truncated).toBe(true);
        expect(fit.droppedExtra).toBe(true);
        expect(fit.user).not.toContain(extra);
    });

    it('极小窗口下不产生负索引，尾部仍保留', () => {
        const user = '头' + repeat('中', 4000) + '【任务】续写下一段。';
        const fit = fitPromptToContext({
            systemPrompt: SYSTEM,
            userPrompt: user,
            maxContext: 600,
            maxOutput: 100,
            safeBuffer: 100,
        });
        expect(fit.truncated).toBe(true);
        expect(fit.user).toContain('【任务】续写下一段。');
    });

    it('sectionAware：先丢低优先段，保住世界观/设定库', () => {
        const user = [
            '【世界观】' + repeat('世', 1200),
            '【设定库】' + repeat('设', 900),
            '【场景风格参考】' + repeat('风', 1500),
        ].join('\n');
        const fit = fitPromptToContext({
            systemPrompt: SYSTEM,
            userPrompt: user,
            ...base,
            sectionAware: true,
        });

        expect(fit.truncated).toBe(true);
        expect(fit.user).toContain('【世界观】');
        expect(fit.user).toContain('【设定库】');
        expect(fit.user).not.toContain('【场景风格参考】');
        expect(fit.user).toContain('已省略以下段落');
        expect(fit.user).toContain('场景风格参考');
    });
});

describe('prompt-budget — clampBudgetToModelLimits（设置值收窄到模型能力）', () => {
    const configured = { maxContext: 128_000, maxOutput: 32_768 };

    it('模型窗口更小时取模型值（8K 本地模型）', () => {
        const limits = clampBudgetToModelLimits(configured, { maxContext: 8192, maxOutput: 4096 });
        expect(limits.maxContext).toBe(8192);
        expect(limits.maxOutput).toBe(4096);
    });

    it('模型窗口更大时保留设置值（设置是用户成本上限）', () => {
        const limits = clampBudgetToModelLimits(configured, { maxContext: 200_000, maxOutput: 64_000 });
        expect(limits.maxContext).toBe(128_000);
        expect(limits.maxOutput).toBe(32_768);
    });

    it('模型值缺失或非法时回退设置值', () => {
        expect(clampBudgetToModelLimits(configured, undefined)).toEqual(configured);
        expect(clampBudgetToModelLimits(configured, null)).toEqual(configured);
        expect(clampBudgetToModelLimits(configured, { maxContext: 0, maxOutput: NaN })).toEqual(configured);
        expect(clampBudgetToModelLimits(configured, { maxContext: -1, maxOutput: Infinity })).toEqual(configured);
    });

    it('两个字段独立收窄（仅窗口更小）', () => {
        const limits = clampBudgetToModelLimits(configured, { maxContext: 16_000 });
        expect(limits.maxContext).toBe(16_000);
        expect(limits.maxOutput).toBe(32_768);
    });
});

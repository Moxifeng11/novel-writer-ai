/**
 * M7 指标：开启 prompt 内去重后，注入体积下降多少（本地可测，不需要 AI）
 */

import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '@/engine/prompt-builder';
import type { PromptSnapshot } from '@/engine/prompt-builder';

const SNAPSHOT: Partial<PromptSnapshot> = {
    writingRules: '',
    allChars: '【林玄】外门弟子，性格执拗。'.repeat(60),
    allFactions: '【青云宗】正道宗门。'.repeat(30),
    allLocs: '【山门】宗门入口。'.repeat(20),
    allItems: '【青锋剑】下品灵器。'.repeat(20),
    storyContextPack: '【故事上下文】人物：林玄；势力：青云宗；地点：山门；伏笔：断剑来历。'.repeat(40),
};

const build = (skip: boolean) => {
    const builder = new PromptBuilder(() => SNAPSHOT as PromptSnapshot);
    return builder.buildSuggestionPrompt(
        '前文'.repeat(200),
        'action',
        '',
        '',
        '',
        [],
        [],
        '',
        [],
        { maxInputTokens: 100_000, modelId: 'test' },
        skip ? { skipCachedContext: true } : undefined,
    );
};

describe('M7 注入体积对比', () => {
    it('开启去重后 prompt 明显变短', () => {
        const full = build(false);
        const dedup = build(true);
        const fullChars = full.system.length + full.user.length;
        const dedupChars = dedup.system.length + dedup.user.length;
        const reduction = 1 - dedupChars / fullChars;
        // 至少省 10%：storyContext 与缓存上下文块不再重复注入
        expect(reduction).toBeGreaterThan(0.1);
        expect(dedupChars).toBeLessThan(fullChars);
    });

    it('关闭时注入缓存上下文块（人物总览）', () => {
        const full = build(false);
        expect(full.user).toContain('【人物总览】');
    });

    it('开启时不再注入缓存上下文块', () => {
        const dedup = build(true);
        expect(dedup.user).not.toContain('【人物总览】');
    });
});

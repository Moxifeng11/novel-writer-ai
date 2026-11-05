import { describe, expect, it } from 'vitest';
import { buildDirectionalPrompt } from '../../../../engine/co-writer/directional-prompt';
import type { PromptBuilder } from '../../../../engine/prompt-builder';

/**
 * 方向性续写提示词的两条路径：
 * 1) 有 PromptBuilder → 参数逐个透传，返回值原样返回；
 * 2) 无 PromptBuilder → 兜底模板（第三人称限知 + bodyFormat 契约 + 已写内容末 800 字）。
 * 兜底不消费指纹/知识/剧情目标——与抽取前行为一致。
 */

const LONG_TEXT = '前'.repeat(900) + '尾部标记';

function fakeBuilder() {
    const calls: unknown[][] = [];
    const builder = {
        buildSuggestionPrompt: (...args: unknown[]) => {
            calls.push(args);
            return { system: 'SYS_FROM_BUILDER', user: 'USER_FROM_BUILDER' };
        },
    } as unknown as PromptBuilder & { buildSuggestionPrompt: (...args: unknown[]) => unknown };
    return { builder, calls };
}

describe('buildDirectionalPrompt — PromptBuilder 路径', () => {
    it('十个参数按序透传，返回值原样返回', () => {
        const { builder, calls } = fakeBuilder();
        const briefParts = ['【章节简报】', '第1场'];
        const budget = { maxInputTokens: 24000, modelId: 'gpt-test' };
        const result = buildDirectionalPrompt({
            precedingText: LONG_TEXT,
            direction: 'action',
            cursorHint: '落句要收在雨声上',
            fingerprintParts: ['FP'],
            knowledgeParts: ['KN'],
            knowledgeInjection: 'INJ',
            soulInjection: 'SOUL',
            plotTarget: 'PLOT',
            briefParts,
            writingRules: '',
            promptBuilder: builder,
            inputBudget: budget,
        });
        expect(result).toEqual({ system: 'SYS_FROM_BUILDER', user: 'USER_FROM_BUILDER' });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual([
            LONG_TEXT,
            'action',
            '落句要收在雨声上',
            'SOUL',
            'PLOT',
            ['FP'],
            ['KN'],
            'INJ',
            briefParts,
            budget,
        ]);
    });
});

describe('buildDirectionalPrompt — 兜底路径', () => {
    it('system 含第三人称限知规则，且 bodyFormat 跟随 writingRules', () => {
        const result = buildDirectionalPrompt({
            precedingText: LONG_TEXT,
            direction: 'dialogue',
            cursorHint: '',
            soulInjection: '',
            plotTarget: '',
            briefParts: [],
            writingRules: '正文每段开头空两格。',
            promptBuilder: null,
        });
        expect(result.system).toContain('【叙事视角规则】');
        expect(result.system).toContain('严禁使用第一人称「我」叙事');
        expect(result.system).toContain('每段开头空两格（两个全角空格）');
        expect(result.system).toContain('【输出格式】');
    });

    it('user 按顺序装配简报/已写内容末800字/写作方向', () => {
        const result = buildDirectionalPrompt({
            precedingText: LONG_TEXT,
            direction: 'dialogue',
            cursorHint: '',
            soulInjection: '',
            plotTarget: '被忽略的剧情目标',
            briefParts: ['【章节简报】A', '【章节简报】B'],
            writingRules: '',
            promptBuilder: null,
        });
        const user = result.user;
        expect(user.indexOf('【章节简报】A')).toBeLessThan(user.indexOf('【已写内容】'));
        expect(user).toContain('【已写内容】');
        expect(user).toContain('尾部标记');
        expect(user).not.toContain('前'.repeat(850));
        expect(user).toContain('【写作方向】');
        expect(user).toContain('请根据当前写作方向自然地续写一段。');
        // 兜底不消费剧情目标（与抽取前一致）
        expect(user).not.toContain('被忽略的剧情目标');
    });

    it('cursorHint 追加特别指令；正文长短切换开头/续写指令', () => {
        const withHint = buildDirectionalPrompt({
            precedingText: LONG_TEXT,
            direction: 'action',
            cursorHint: '落句收在雨声',
            soulInjection: '',
            plotTarget: '',
            briefParts: [],
            writingRules: '',
            promptBuilder: null,
        });
        expect(withHint.user).toContain('【特别指令】');
        expect(withHint.user).toContain('落句收在雨声');
        expect(withHint.user).toContain('请自然地续写一个自然段');

        const opening = buildDirectionalPrompt({
            precedingText: '  开',
            direction: 'action',
            cursorHint: '',
            soulInjection: '',
            plotTarget: '',
            briefParts: [],
            writingRules: '',
            promptBuilder: null,
        });
        expect(opening.user).toContain('这是本章的开头');
        expect(opening.user).not.toContain('请自然地续写一个自然段');
    });
});

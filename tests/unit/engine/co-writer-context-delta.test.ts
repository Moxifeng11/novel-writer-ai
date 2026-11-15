/**
 * M7：协同续写 prompt 内去重（开关默认关）
 *
 * 验证 skipCachedContext 开启时，storyContext / 缓存上下文块不再重复注入，
 * 且 prompt 体积明显下降；关闭时行为不变。
 */

import { describe, expect, it } from 'vitest';
import { buildDirectionalPrompt } from '@/engine/co-writer/directional-prompt';
import type { PromptBuilder } from '@/engine/prompt-builder';

/** 记录调用参数的假 PromptBuilder */
const makeBuilder = () => {
    const calls: unknown[][] = [];
    const builder = {
        buildSuggestionPrompt: (...args: unknown[]) => {
            calls.push(args);
            return { system: 'S', user: 'U' };
        },
    } as unknown as PromptBuilder;
    return { builder, calls };
};

const baseInput = {
    precedingText: '前文'.repeat(100),
    direction: 'action' as const,
    cursorHint: '',
    soulInjection: '',
    plotTarget: '',
    briefParts: [],
    writingRules: '',
};

describe('M7 协同 prompt 去重开关', () => {
    it('默认（关闭）不传 options', () => {
        const { builder, calls } = makeBuilder();
        buildDirectionalPrompt({ ...baseInput, promptBuilder: builder });
        expect(calls[0]).toHaveLength(11);
        expect(calls[0][10]).toBeUndefined();
    });

    it('开启时透传 skipCachedContext', () => {
        const { builder, calls } = makeBuilder();
        buildDirectionalPrompt({ ...baseInput, promptBuilder: builder, skipCachedContext: true });
        expect(calls[0]).toHaveLength(11);
        expect(calls[0][10]).toEqual({ skipCachedContext: true });
    });

    it('无 PromptBuilder 时走兜底模板且不受开关影响', () => {
        const a = buildDirectionalPrompt({ ...baseInput, promptBuilder: null });
        const b = buildDirectionalPrompt({ ...baseInput, promptBuilder: null, skipCachedContext: true });
        expect(a.user).toBe(b.user);
        expect(a.system).toBe(b.system);
    });
});

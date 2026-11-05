import { describe, it, expect, vi } from 'vitest';
import {
    renderGhostSuggestion,
    resolveGhostTrigger,
    type GhostTriggerInput,
} from '../../../ui/co-writing/ghost-association';

/**
 * 幽灵联想的触发判定是高频后台路径：任何一步放宽都会让本地模型排队，
 * 任何一步收紧都会让联想再也不出现。这里锁定 8 步短路顺序与边界值。
 */
function makeInput(partial: Partial<GhostTriggerInput> = {}): GhostTriggerInput {
    const text = '甲'.repeat(39) + '。';
    return {
        enabled: true,
        isAssociating: false,
        isSuggesting: false,
        suggestionCount: 0,
        text,
        cursor: text.length,
        lastSeed: '',
        now: 10_000,
        lastRequestAt: 0,
        minIntervalMs: 1500,
        ...partial,
    };
}

describe('co-writing ghost-association 触发判定', () => {
    it('满足条件时返回种子、光标与请求时间', () => {
        const input = makeInput();
        expect(resolveGhostTrigger(input)).toEqual({
            seed: input.text,
            cursor: input.text.length,
            requestedAt: 10_000,
        });
    });

    it('开关关闭、在途请求、已有建议一律不触发', () => {
        expect(resolveGhostTrigger(makeInput({ enabled: false }))).toBeNull();
        expect(resolveGhostTrigger(makeInput({ isAssociating: true }))).toBeNull();
        expect(resolveGhostTrigger(makeInput({ isSuggesting: true }))).toBeNull();
        expect(resolveGhostTrigger(makeInput({ suggestionCount: 1 }))).toBeNull();
    });

    it('正文不足 40 字或光标不在尾部不触发', () => {
        const short = '甲'.repeat(39);
        expect(resolveGhostTrigger(makeInput({ text: short, cursor: short.length }))).toBeNull();
        expect(resolveGhostTrigger(makeInput({ cursor: 30 }))).toBeNull();
    });

    it('只在句末触发，句中停顿不触发', () => {
        const mid = '甲'.repeat(41);
        expect(resolveGhostTrigger(makeInput({ text: mid, cursor: mid.length }))).toBeNull();
        const exclamation = '甲'.repeat(40) + '！';
        expect(resolveGhostTrigger(makeInput({ text: exclamation, cursor: exclamation.length }))).not.toBeNull();
    });

    it('同种子不重复请求', () => {
        const input = makeInput();
        expect(resolveGhostTrigger({ ...input, lastSeed: input.text })).toBeNull();
    });

    it('未过最小间隔不触发，达到间隔才触发', () => {
        expect(resolveGhostTrigger(makeInput({ lastRequestAt: 8_800 }))).toBeNull();
        expect(resolveGhostTrigger(makeInput({ lastRequestAt: 8_500 }))).not.toBeNull();
    });

    it('种子最长取光标前 160 字', () => {
        const text = '甲'.repeat(199) + '。';
        const trigger = resolveGhostTrigger(makeInput({ text, cursor: text.length }));
        expect(trigger?.seed).toHaveLength(160);
        expect(trigger?.seed.endsWith('。')).toBe(true);
    });
});

describe('co-writing ghost-association 提示渲染', () => {
    it('null 建议时清空并隐藏，不创建文本节点', () => {
        const container = {
            empty: vi.fn(),
            toggleClass: vi.fn(),
            createSpan: vi.fn(),
        } as unknown as HTMLElement;
        renderGhostSuggestion(container, null);
        expect(container.empty).toHaveBeenCalledTimes(1);
        expect(container.toggleClass).toHaveBeenCalledWith('is-visible', false);
        expect(container.createSpan).not.toHaveBeenCalled();
    });

    it('有建议时显示前缀与文本', () => {
        const container = {
            empty: vi.fn(),
            toggleClass: vi.fn(),
            createSpan: vi.fn(),
        } as unknown as HTMLElement;
        renderGhostSuggestion(container, { text: '下一句' } as never);
        expect(container.toggleClass).toHaveBeenCalledWith('is-visible', true);
        expect(container.createSpan).toHaveBeenNthCalledWith(1, { cls: 'nw-cowrite-ghost-prefix', text: 'Tab 接受联想：' });
        expect(container.createSpan).toHaveBeenNthCalledWith(2, { cls: 'nw-cowrite-ghost-text', text: '下一句' });
    });

    it('容器为空时安全返回', () => {
        expect(renderGhostSuggestion(null, { text: 'x' } as never)).toBeUndefined();
    });
});

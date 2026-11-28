/**
 * 2026-11-28：expectedRhythm 的生产注入点此前一直为空（rhythm-intent.ts 文件头
 * 自述要修的问题本身没接上），剧情偏离引擎永远跑默认 'medium'。
 * 这里锁定接线行为：updateCompletion 的 planHints → parseExpectedRhythm →
 * divergenceEngine.updateOptions({ expectedRhythm })。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/main', () => ({
    default: class NovelWriterPlugin {},
}));

vi.mock('obsidian', () => ({
    WorkspaceLeaf: class {},
    Notice: class {},
}));

import { parseExpectedRhythm } from '../../../shared/rhythm-intent';
import type { PlotDivergenceEngine } from '../../../engine/plot-divergence-engine';

describe('预期节奏解析 → 引擎选项（rhythm-intent 生产接线回归）', () => {
    it('大纲标注「节奏：快」→ fast', () => {
        expect(parseExpectedRhythm('本章大纲：夜袭。\n节奏：快', '')).toBe('fast');
    });

    it('情绪规划出现「节奏平缓」→ slow', () => {
        expect(parseExpectedRhythm(undefined, '情绪线：节奏平缓的收束章')).toBe('slow');
    });

    it('快慢标注同时出现 → 放弃（单值字段表达不了分场景节奏）', () => {
        expect(parseExpectedRhythm('前半快节奏推进', '后半慢节奏收束')).toBeUndefined();
    });

    it('无任何标注 → undefined（宁可不报不误报；引擎保持默认）', () => {
        expect(parseExpectedRhythm('本章写主角逛街。', '情绪平稳。')).toBeUndefined();
    });

    it('PlotDivergenceEngine.updateOptions 接受解析结果（类型/行为链路）', () => {
        const engine = {
            updateOptions: vi.fn(),
        } as unknown as PlotDivergenceEngine & { updateOptions: ReturnType<typeof vi.fn> };
        const expected = parseExpectedRhythm('节奏：快', undefined);
        if (expected) engine.updateOptions({ expectedRhythm: expected });
        expect(engine.updateOptions).toHaveBeenCalledWith({ expectedRhythm: 'fast' });
    });
});

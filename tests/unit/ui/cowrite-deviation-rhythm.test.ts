import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';

function makeController(brief: unknown, chapPlan?: string): RealtimeQualityController {
    const host: RealtimeQualityHost = {
        app: {} as never,
        getText: () => '',
        getProject: () => '书甲',
        getVolume: () => '第1卷',
        getChapterNum: () => 3,
        getChapterName: () => '第3章',
        getBodyPath: () => '书甲/第1卷/第3章_正文.md',
        getChapterBrief: () => brief as never,
        getChapPlan: () => chapPlan,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => {
            throw new Error('偏离上下文测试不应创建 monitor');
        },
    };
    const controller = new RealtimeQualityController(host);
    vi.spyOn(controller as unknown as { loadPreviousChapterContext: () => Promise<unknown[]> }, 'loadPreviousChapterContext')
        .mockResolvedValue([]);
    return controller;
}

function build(controller: RealtimeQualityController): Promise<Record<string, unknown>> {
    return (controller as unknown as {
        buildDeviationContext: () => Promise<Record<string, unknown>>;
    }).buildDeviationContext();
}

/**
 * 节奏偏离检测只在 `expectedRhythm` 存在时工作。此前没有任何生产调用方提供它，
 * 「节奏偏离」在生产里恒空；现在从本章简报 / chapPlan 的显式标注解析。
 * D2 后上下文构建位于 RealtimeQualityController。
 */
describe('RealtimeQualityController — 偏离上下文带上预期节奏', () => {
    it('本章简报里标注了节奏时传给偏离检测', async () => {
        const ctx = build(makeController({ outlineSummary: '本章节奏：快，追捕戏', emotionPlan: '' }));
        await expect(ctx).resolves.toMatchObject({
            chapterId: '书甲/第1卷/第3章_正文.md',
            chapterNum: 3,
            expectedRhythm: 'fast',
        });
    });

    it('简报没标注时回退到快照 chapPlan', async () => {
        const ctx = build(makeController(
            { outlineSummary: '主角进入宗门', emotionPlan: '' },
            '铺垫为主，节奏：慢',
        ));
        await expect(ctx).resolves.toMatchObject({ expectedRhythm: 'slow' });
    });

    it('完全没有标注时保持 undefined（不做节奏偏离）', async () => {
        const ctx = build(makeController({ outlineSummary: '主角进入宗门', emotionPlan: '' }));
        expect((await ctx).expectedRhythm).toBeUndefined();
    });
});

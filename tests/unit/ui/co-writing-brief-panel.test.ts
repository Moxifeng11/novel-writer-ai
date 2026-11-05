import { describe, it, expect } from 'vitest';
import {
    buildBriefRows,
    canColdStart,
    describeBriefProgress,
    formatEmotionLine,
    formatSceneItem,
    sceneMarker,
} from '../../../ui/co-writing/brief-panel';
import type { BriefScene, ChapterBrief } from '../../../engine/chapter-brief';

/**
 * 本章简报的纯格式化：进度摘要、场景状态、字段行、情绪行与冷启动判定。
 * 摘要与场景标记错位会让用户以为当前场景已经写完了。
 */
function makeScene(partial: Partial<BriefScene> = {}): BriefScene {
    return {
        index: 1,
        name: '风起',
        objective: '目标',
        conflict: '冲突',
        sensoryHook: '感官',
        memoryTrigger: '记忆',
        bodyReaction: '身体',
        subtext: '潜台词',
        relationshipShift: '关系',
        keyScene: '名场面',
        dialogueFunction: '',
        cliffhanger: '',
        emotionStart: '平静',
        emotionEnd: '紧张',
        emotionDelta: '+1',
        wordCountEstimate: 800,
        ...partial,
    };
}

describe('co-writing brief-panel 纯格式化', () => {
    it('有场景时显示当前/总数与字数', () => {
        expect(describeBriefProgress(3, 1, 800)).toBe('场景 2/3 · 已写 800 字');
    });

    it('无场景时只显示字数', () => {
        expect(describeBriefProgress(0, -1, 120)).toBe('已写 120 字');
    });

    it('当前场景下标越界时夹到总数', () => {
        expect(describeBriefProgress(2, 5, 0)).toBe('场景 2/2 · 已写 0 字');
    });

    it('场景标记按完成/当前/未开始区分', () => {
        expect(sceneMarker(true, false)).toBe('✅');
        expect(sceneMarker(false, true)).toBe('▶');
        expect(sceneMarker(false, false)).toBe('·');
    });

    it('场景项文本含标记、场号与名称', () => {
        expect(formatSceneItem(makeScene(), false, true)).toBe('▶ 第1场 风起');
        expect(formatSceneItem(makeScene({ name: '' }), false, false)).toBe('· 第1场 未命名');
    });

    it('字段行为空时被过滤', () => {
        const rows = buildBriefRows(makeScene({ conflict: '', keyScene: '' }));
        expect(rows).toEqual([
            ['目标', '目标'],
            ['感官', '感官'],
            ['记忆', '记忆'],
            ['身体', '身体'],
            ['潜台词', '潜台词'],
            ['关系', '关系'],
        ]);
    });

    it('情绪行含起点、终点与变化量', () => {
        expect(formatEmotionLine(makeScene())).toBe('情绪：平静 → 紧张（+1）');
        expect(formatEmotionLine(makeScene({ emotionDelta: '' }))).toBe('情绪：平静 → 紧张');
    });

    it('冷启动仅在存在场景或大纲时为真', () => {
        const empty = { scenes: [], outlineSummary: '' } as unknown as ChapterBrief;
        const withOutline = { scenes: [], outlineSummary: '大纲' } as unknown as ChapterBrief;
        const withScenes = { scenes: [makeScene()], outlineSummary: '' } as unknown as ChapterBrief;
        expect(canColdStart(null)).toBe(false);
        expect(canColdStart(empty)).toBe(false);
        expect(canColdStart(withOutline)).toBe(true);
        expect(canColdStart(withScenes)).toBe(true);
    });
});

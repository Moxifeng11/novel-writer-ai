import { describe, expect, it } from 'vitest';
import {
    extractForeshadowKeywords,
    toForeshadowTrackings,
    parsePlannedRevealChapter,
    applyPlannedRevealChapters,
} from '../../../engine/foreshadow-context';

describe('foreshadow-context — 关键词抽取', () => {
    it('短伏笔整体作为关键词', () => {
        expect(extractForeshadowKeywords('青铜古镜')).toEqual(['青铜古镜']);
    });

    it('长伏笔按标点切分，只保留 4–16 字片段', () => {
        const keywords = extractForeshadowKeywords('青铜古镜上的裂纹，与青铜古镜的开裂原因有关');
        expect(keywords).toContain('青铜古镜上的裂纹');
        expect(keywords.every((k) => k.length >= 4 && k.length <= 16)).toBe(true);
        expect(keywords.length).toBeLessThanOrEqual(4);
    });

    it('空内容与无有效片段返回空数组', () => {
        expect(extractForeshadowKeywords('')).toEqual([]);
        expect(extractForeshadowKeywords('   ')).toEqual([]);
        expect(extractForeshadowKeywords('风，雨')).toEqual([]);
    });
});

describe('foreshadow-context — 追踪条目映射', () => {
    it('未回收的中/高重要度伏笔映射为检测上下文', () => {
        const list = toForeshadowTrackings([
            { id: 'F1', content: '青铜古镜上的裂纹', plantedChapter: 3, status: 'planted', importance: 'high' },
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('F1');
        expect(list[0].plantedChapterNum).toBe(3);
        expect(list[0].recovered).toBe(false);
        expect(list[0].keywords.length).toBeGreaterThan(0);
    });

    it('已回收、低重要度、非法埋设章号的条目被跳过', () => {
        const list = toForeshadowTrackings([
            { id: 'F1', content: '已回收的伏笔', plantedChapter: 3, status: 'resolved', importance: 'high' },
            { id: 'F2', content: '低重要度伏笔', plantedChapter: 3, status: 'planted', importance: 'low' },
            { id: 'F3', content: '没有章号的伏笔', plantedChapter: 0, status: 'planted', importance: 'high' },
            { id: 'F4', content: '章号缺失的伏笔', status: 'planted', importance: 'high' },
            { id: 'F5', content: '  ', plantedChapter: 2, status: 'planted', importance: 'high' },
        ]);
        expect(list).toEqual([]);
    });

    it('缺少 id 时按序号兜底，空输入返回空数组', () => {
        const list = toForeshadowTrackings([
            { content: '无 id 的伏笔', plantedChapter: 2, status: 'planted', importance: 'medium' },
        ]);
        expect(list[0].id).toBe('F1');
        expect(toForeshadowTrackings([])).toEqual([]);
        expect(toForeshadowTrackings(undefined)).toEqual([]);
    });
});

describe('foreshadow-context — 计划回收章', () => {
    it('解析「第 N 章」、带空格与纯数字，非法值返回 null', () => {
        expect(parsePlannedRevealChapter('第12章')).toBe(12);
        expect(parsePlannedRevealChapter('第 12 章')).toBe(12);
        expect(parsePlannedRevealChapter('12')).toBe(12);
        expect(parsePlannedRevealChapter('未定')).toBeNull();
        expect(parsePlannedRevealChapter('第0章')).toBeNull();
        expect(parsePlannedRevealChapter(undefined)).toBeNull();
    });

    it('按名称匹配把计划回收章补到追踪条目，且不覆盖已有值', () => {
        const trackings = toForeshadowTrackings([
            { id: 'F1', content: '青铜古镜上的裂纹', plantedChapter: 3, status: 'planted', importance: 'high' },
            { id: 'F2', content: '神秘黑剑', plantedChapter: 5, status: 'planted', importance: 'high' },
        ]);
        const merged = applyPlannedRevealChapters(trackings, [
            { name: '青铜古镜', plannedReveal: '第12章', status: '未揭示' },
            { name: '神秘黑剑', plannedReveal: '第8章', status: '未揭示' },
        ]);

        expect(merged[0].expectedRecoverChapterNum).toBe(12);
        expect(merged[1].expectedRecoverChapterNum).toBe(8);

        const withExpected = [{ ...trackings[0], expectedRecoverChapterNum: 30 }];
        const kept = applyPlannedRevealChapters(withExpected, [
            { name: '青铜古镜', plannedReveal: '第12章', status: '未揭示' },
        ]);
        expect(kept[0].expectedRecoverChapterNum).toBe(30);
    });

    it('已揭示条目与无计划章条目不参与匹配', () => {
        const trackings = toForeshadowTrackings([
            { id: 'F1', content: '青铜古镜', plantedChapter: 3, status: 'planted', importance: 'high' },
        ]);
        const merged = applyPlannedRevealChapters(trackings, [
            { name: '青铜古镜', plannedReveal: '第12章', status: '已揭示' },
            { name: '青铜古镜', plannedReveal: '未定', status: '未揭示' },
        ]);
        expect(merged[0].expectedRecoverChapterNum).toBeUndefined();
    });

    it('同名包含时取最长名称，避免短名抢走长名的计划章', () => {
        const trackings = toForeshadowTrackings([
            { id: 'F1', content: '玄铁剑鞘的缺口', plantedChapter: 2, status: 'planted', importance: 'high' },
        ]);
        const merged = applyPlannedRevealChapters(trackings, [
            { name: '玄铁剑', plannedReveal: '第10章', status: '未揭示' },
            { name: '玄铁剑鞘', plannedReveal: '第20章', status: '未揭示' },
        ]);
        expect(merged[0].expectedRecoverChapterNum).toBe(20);
    });

    it('空追踪列表或空伏笔库时原样返回', () => {
        expect(applyPlannedRevealChapters([], [{ name: '某伏笔', plannedReveal: '第3章' }])).toEqual([]);
        const trackings = toForeshadowTrackings([
            { id: 'F1', content: '青铜古镜', plantedChapter: 3, status: 'planted', importance: 'high' },
        ]);
        expect(applyPlannedRevealChapters(trackings, [])).toBe(trackings);
        expect(applyPlannedRevealChapters(trackings, undefined)).toBe(trackings);
    });
});

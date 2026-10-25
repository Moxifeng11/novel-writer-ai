/**
 * Rev 186 / T6：story-linkage 纯函数引擎
 */
import { describe, it, expect } from 'vitest';
import {
    parsePlannedRange,
    classifyForeshadow,
    buildStoryLinkage,
    formatStoryLinkageForPrompt,
    LINKAGE_PROMPT_LIMIT,
    type StoryLinkageForeshadowInput,
} from '../../../engine/story-linkage';

describe('parsePlannedRange', () => {
    it('单章：第6章 → 6..6', () => {
        expect(parsePlannedRange('第6章')).toMatchObject({ start: 6, end: 6 });
    });

    it('区间：第6-8章 → 6..8', () => {
        expect(parsePlannedRange('第6-8章')).toMatchObject({ start: 6, end: 8 });
    });

    it('区间：第6章至第8章 → 6..8', () => {
        expect(parsePlannedRange('第6章至第8章')).toMatchObject({ start: 6, end: 8 });
    });

    it('模糊：第6章前后 → 5..7', () => {
        expect(parsePlannedRange('第6章前后')).toMatchObject({ start: 5, end: 7 });
    });

    it('自由文本：待定 / 后续章节 / 空 → null', () => {
        expect(parsePlannedRange('待定')).toMatchObject({ start: null, end: null });
        expect(parsePlannedRange('后续章节')).toMatchObject({ start: null, end: null });
        expect(parsePlannedRange('')).toMatchObject({ start: null, end: null });
    });

    it('倒序区间按起点收敛，不产生负区间', () => {
        expect(parsePlannedRange('第8-6章')).toMatchObject({ start: 8, end: 8 });
    });
});

describe('classifyForeshadow', () => {
    const range = { start: 8, end: 10, raw: '第8-10章' };

    it('落在区间内 → due', () => {
        expect(classifyForeshadow(range, 9)).toBe('due');
    });

    it('区间已过 → overdue', () => {
        expect(classifyForeshadow(range, 11)).toBe('overdue');
    });

    it('3 章内即将开始 → upcoming', () => {
        expect(classifyForeshadow(range, 5)).toBe('upcoming');
    });

    it('更远 → later', () => {
        expect(classifyForeshadow(range, 1)).toBe('later');
    });

    it('无法解析 → unknown', () => {
        expect(classifyForeshadow({ start: null, end: null, raw: '待定' }, 9)).toBe('unknown');
    });
});

describe('buildStoryLinkage', () => {
    function makeInput() {
        const foreshadows: StoryLinkageForeshadowInput[] = Array.from({ length: 6 }, () => ({
            name: '残玉',
            importance: '高',
            buryChapter: '第1章',
            plannedReveal: '第6-8章',
            relatedChars: '沈砚',
            relatedMainline: '青云宗',
        }));
        foreshadows.push(
            { name: '旧剑', importance: '中', buryChapter: '第1章', plannedReveal: '第3章' },
            { name: '密信', importance: '低', buryChapter: '第2章', plannedReveal: '待定' },
            { name: '后山', importance: '中', buryChapter: '第4章', plannedReveal: '第9章前后' },
        );
        const timeline = Array.from({ length: 6 }, () => ({
            eventName: '山门试炼',
            time: '第三年春',
            chapter: '第6章',
            involvedEntities: ['沈砚'],
        }));
        timeline.push({ eventName: '拜师', time: '第一年', chapter: '第2章', involvedEntities: ['沈砚'] });
        return {
            chapterName: '第6章',
            chapterNum: 6,
            volume: '第1卷',
            foreshadows,
            timeline,
            settingTitles: ['沈砚', '青云宗', '无关条目'],
            planningText: '### 第6章 试炼\n- 沈砚参加山门试炼\n- 残玉第一次异动\n### 第7章 其他\n- 不应出现',
        };
    }

    it('同名伏笔 ×6 合并为 1 条并给出告警', () => {
        const linkage = buildStoryLinkage(makeInput());

        expect(linkage.due).toHaveLength(1);
        expect(linkage.due[0].name).toBe('残玉');
        expect(linkage.due[0].range).toMatchObject({ start: 6, end: 8 });
        expect(linkage.warnings.join('\n')).toContain('伏笔库有 5 条重复记录');
    });

    it('逾期 / 即将到期 / 待定 分流正确', () => {
        const linkage = buildStoryLinkage(makeInput());

        expect(linkage.overdue.map(f => f.name)).toEqual(['旧剑']);
        expect(linkage.upcoming.map(f => f.name)).toEqual(['后山']);
        expect(linkage.warnings.join('\n')).toContain('无法解析为章号');
    });

    it('时间线同事件 ×6 去重，保留本章事件与前史', () => {
        const linkage = buildStoryLinkage(makeInput());

        expect(linkage.timelineAll).toHaveLength(2);
        expect(linkage.timeline.map(t => t.eventName)).toEqual(['拜师', '山门试炼']);
        expect(linkage.timeline[1].state).toBe('in-chapter');
        expect(linkage.warnings.join('\n')).toContain('时间线有 5 条重复事件');
    });

    it('设定命中来自人物/主线关键字，规划只取本章段落', () => {
        const linkage = buildStoryLinkage(makeInput());

        expect(linkage.settingHits).toContain('沈砚');
        expect(linkage.settingHits).toContain('青云宗');
        expect(linkage.settingHits).not.toContain('无关条目');
        expect(linkage.planningRefs.join('\n')).toContain('残玉第一次异动');
        expect(linkage.planningRefs.join('\n')).not.toContain('不应出现');
        expect(linkage.due[0].settingRefs).toEqual(expect.arrayContaining(['沈砚', '青云宗']));
    });

    it('promptText 分段有序且不包含「更远期」伏笔', () => {
        const linkage = buildStoryLinkage(makeInput());

        expect(linkage.promptText).toContain('【关联伏笔·本章到期】');
        expect(linkage.promptText).toContain('【关联伏笔·逾期未回收】');
        expect(linkage.promptText).toContain('【设定/规划关联】');
        expect(linkage.promptText).toContain('【本章时间线】');
        expect(linkage.promptText).not.toContain('密信');
        expect(linkage.promptText.length).toBeLessThanOrEqual(LINKAGE_PROMPT_LIMIT);
    });

    it('空输入返回空索引，不抛错', () => {
        const linkage = buildStoryLinkage({ chapterName: '第1章', chapterNum: 1 });

        expect(linkage.due).toEqual([]);
        expect(linkage.timeline).toEqual([]);
        expect(linkage.promptText).toBe('');
        expect(linkage.warnings).toEqual([]);
    });

    it('通用章节标题（如「与主线关联」）不作为关联设定命中', () => {
        const linkage = buildStoryLinkage({
            chapterName: '第6章',
            chapterNum: 6,
            foreshadows: [{ name: '残玉', plannedReveal: '第6章', relatedMainline: '与主线关联' }],
            settingTitles: ['与主线关联', '青云宗'],
        });

        expect(linkage.settingHits).toEqual([]);
    });

    it('分卷大纲表格行去掉行号与竖线后再入索引', () => {
        const linkage = buildStoryLinkage({
            chapterName: '第6章',
            chapterNum: 6,
            planningText: '### 第6章 试炼\n| 6 | 押解队入碎砂渡砂峡 |',
        });

        expect(linkage.planningRefs).toContain('押解队入碎砂渡砂峡');
        expect(linkage.planningRefs.join('\n')).not.toContain('| 6 |');
    });
});

describe('formatStoryLinkageForPrompt', () => {
    it('超限时按段截断而不是中途切段', () => {
        const linkage = buildStoryLinkage({
            chapterName: '第6章',
            chapterNum: 6,
            foreshadows: [
                { name: '很长很长的伏笔名称甲', plannedReveal: '第6章' },
                { name: '很长很长的伏笔名称乙', plannedReveal: '第6章' },
            ],
            timeline: [{ eventName: '很长很长的的事件', time: '很久以前', chapter: '第1章' }],
        });

        const text = formatStoryLinkageForPrompt(linkage, 40);

        expect(text.length).toBeLessThanOrEqual(41);
        expect(text.startsWith('【关联伏笔·本章到期】')).toBe(true);
    });
});

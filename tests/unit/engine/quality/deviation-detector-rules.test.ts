import { describe, it, expect, beforeEach } from 'vitest';
import {
    DeviationDetector,
    parseChineseNumber,
} from '../../../../engine/quality/deviation-detector';

describe('parseChineseNumber', () => {
    it('解析中文数字', () => {
        expect(parseChineseNumber('一')).toBe(1);
        expect(parseChineseNumber('十')).toBe(10);
        expect(parseChineseNumber('十二')).toBe(12);
        expect(parseChineseNumber('二十')).toBe(20);
        expect(parseChineseNumber('一百零五')).toBe(105);
    });

    it('保留阿拉伯数字', () => {
        expect(parseChineseNumber('3')).toBe(3);
        expect(parseChineseNumber('120')).toBe(120);
    });

    it('无法解析时返回 null', () => {
        expect(parseChineseNumber('')).toBeNull();
        expect(parseChineseNumber('abc')).toBeNull();
    });
});

describe('DeviationDetector 时间线判定', () => {
    let detector: DeviationDetector;

    beforeEach(() => {
        detector = new DeviationDetector();
    });

    function timelineIssues(
        currentText: string,
        previousText: string,
    ) {
        return detector.detectByType(currentText, 'contradiction', {
            previousChapters: [{ chapterId: '第1章', chapterNum: 1, text: previousText }],
        });
    }

    it('当前章时间点早于前章时报告倒退', async () => {
        const issues = await timelineIssues(
            '第一天夜里，他站在城门口，望着远处的灯火，心里一片茫然。',
            '第三天清晨，他独自走进酒馆，点了一壶温酒，慢慢喝着。',
        );
        const timeline = issues.filter(issue => issue.id.startsWith('contradiction_timeline_'));
        expect(timeline).toHaveLength(1);
        expect(timeline[0].description).toContain('倒退');
    });

    it('相邻章节重复同一时间点不再误报', async () => {
        const issues = await timelineIssues(
            '第三天傍晚，他回到客栈，把行囊放在桌上，长长舒了一口气。',
            '第三天清晨，他独自走进酒馆，点了一壶温酒，慢慢喝着。',
        );
        expect(issues.some(issue => issue.id.startsWith('contradiction_timeline_'))).toBe(false);
    });

    it('中文数字与阿拉伯数字同值不再误报', async () => {
        const issues = await timelineIssues(
            '第1日清晨，他沿着河岸慢慢走，听见远处传来钟声。',
            '第一日傍晚，他在客栈里收拾行装，准备明日出发。',
        );
        expect(issues.some(issue => issue.id.startsWith('contradiction_timeline_'))).toBe(false);
    });
});

describe('DeviationDetector 主线 2-gram 判定', () => {
    const outline = '主角在酒馆遇见旧友，得知家族秘密，随后决定连夜离开小镇前往京城。';

    it('正文覆盖大纲要点时不报偏离', async () => {
        const detector = new DeviationDetector();
        const text = '他推开酒馆的门，正好遇见多年未见的旧友。两人聊起往事，旧友低声说出家族秘密。听完之后，他决定连夜离开小镇，赶往京城。';
        const issues = await detector.detectByType(text, 'mainline', { chapterOutline: outline });
        expect(issues.some(issue => issue.id === 'mainline_outline_unmatched')).toBe(false);
    });

    it('正文与大纲无关时才报偏离', async () => {
        const detector = new DeviationDetector();
        const text = '清晨的集市人声鼎沸，摊贩叫卖着新鲜蔬菜，孩童追逐打闹，街角的老人在晒太阳。';
        const issues = await detector.detectByType(text, 'mainline', { chapterOutline: outline });
        expect(issues.some(issue => issue.id === 'mainline_outline_unmatched')).toBe(true);
    });

    it('大纲过短（关键词不足 5 个）不报覆盖偏离', async () => {
        const detector = new DeviationDetector();
        const issues = await detector.detectByType('完全无关的一段文字。', 'mainline', {
            chapterOutline: '主角进城。',
        });
        expect(issues.some(issue => issue.id === 'mainline_outline_unmatched')).toBe(false);
    });
});

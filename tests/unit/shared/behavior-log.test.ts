import { describe, expect, it } from 'vitest';
import {
    buildChapterBehaviorRows,
    formatBehaviorLog,
    mergeBehaviorRows,
    parseBehaviorLog,
    type BehaviorRow,
} from '../../../shared/behavior-log';

const existing = [
    { chapter: '第1章', chapterNum: 1, name: '武昭', summary: '在虚空坠落中醒来，发现右眼能看见符文。' },
    { chapter: '第1章', chapterNum: 1, name: '沈青', summary: '在废墟里救下小孩。' },
    { chapter: '第2章', chapterNum: 2, name: '武昭', summary: '进塔问心，看到三百年前的自己。' },
];

describe('behavior-log — 解析与序列化', () => {
    it('解析表格行，跳过表头与分隔行', () => {
        const content = formatBehaviorLog(existing);
        const parsed = parseBehaviorLog(content);
        expect(parsed).toHaveLength(3);
        expect(parsed[0]).toMatchObject({ chapter: '第1章', name: '武昭' });
        expect(parsed.every((row) => row.chapterNum > 0)).toBe(true);
    });

    it('空文件/无表格内容返回空数组', () => {
        expect(parseBehaviorLog('')).toEqual([]);
        expect(parseBehaviorLog('# 角色出场记录\n\n还没有记录。')).toEqual([]);
    });

    it('摘要里的竖线被替换，不破坏表格', () => {
        const content = formatBehaviorLog([
            { chapter: '第3章', chapterNum: 3, name: '武昭', summary: '在 A|B 之间抉择。' },
        ]);
        expect(content).toContain('A／B');
        expect(parseBehaviorLog(content)[0].summary).toBe('在 A／B 之间抉择。');
    });
});

describe('behavior-log — 按章合并', () => {
    it('同章同角色去重，保留更长摘要', () => {
        const incoming: BehaviorRow[] = [
            { chapter: '第2章', chapterNum: 2, name: '武昭', summary: '重跑结算的短摘要。' },
            { chapter: '第3章', chapterNum: 3, name: '沈青', summary: '接过死神的 hundred 词长摘要，描述她在死域门口的抉择与代价。' },
        ];
        const merged = mergeBehaviorRows(existing, incoming);
        const chapter2 = merged.find((row) => row.chapter === '第2章' && row.name === '武昭');
        expect(chapter2?.summary).toBe('进塔问心，看到三百年前的自己。');
        expect(merged).toHaveLength(4);
    });

    it('新章追加，结果按章号与角色名排序', () => {
        const incoming: BehaviorRow[] = [
            { chapter: '第10章', chapterNum: 10, name: '姜无咎', summary: '治好孩子，左手透明区扩大。' },
            { chapter: '第2章', chapterNum: 2, name: '沈青', summary: '拿到黑色石头。' },
        ];
        const merged = mergeBehaviorRows(existing, incoming);
        expect(merged.map((row) => row.chapterNum)).toEqual([1, 1, 2, 2, 10]);
        const chapter2 = merged.filter((row) => row.chapterNum === 2).map((row) => row.name);
        expect(chapter2).toEqual(['沈青', '武昭']);
    });

    it('过滤空名/空摘要', () => {
        const merged = mergeBehaviorRows([], [
            { chapter: '第1章', chapterNum: 1, name: '', summary: '无主' },
            { chapter: '第1章', chapterNum: 1, name: '路人', summary: '' },
        ]);
        expect(merged).toEqual([]);
    });
});

describe('behavior-log — 从结算指令构造', () => {
    it('CHARACTER_BEHAVIOR 指令转行为行，过滤空项', () => {
        const rows = buildChapterBehaviorRows('第12章', [
            { name: '武昭', summary: '擦刀时认出守卫的徽记。' },
            { name: '', summary: '无名' },
            { name: '沈青', summary: '' },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ chapter: '第12章', chapterNum: 12, name: '武昭' });
    });
});

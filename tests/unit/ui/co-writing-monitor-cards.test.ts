import { describe, it, expect } from 'vitest';
import {
    computeTextStats,
    formatEntityStatusLine,
    formatForeshadowItem,
} from '../../../ui/co-writing/monitor-cards';

/**
 * 监控卡的纯计算部分：状态统计必须容忍空正文（除零），
 * 伏笔/人物行必须与原卡片逐字一致，避免摘要与详情对不上。
 */
describe('co-writing monitor-cards 正文统计', () => {
    it('空正文不除零', () => {
        expect(computeTextStats('')).toEqual({
            paragraphs: 0,
            dialogueCount: 0,
            totalChars: 0,
            dialogueRatio: 0,
            averageParagraphLength: 0,
            actionCount: 0,
        });
    });

    it('统计段落、对话比例、平均段长与动作词频', () => {
        const text = '第一段。\n\n第二段。"你好"他打了一拳。';
        const stats = computeTextStats(text);
        expect(stats.paragraphs).toBe(2);
        expect(stats.dialogueCount).toBe(1);
        expect(stats.totalChars).toBe(20);
        expect(stats.dialogueRatio).toBe(100);
        expect(stats.averageParagraphLength).toBe(10);
        expect(stats.actionCount).toBe(1);
    });

    it('动作词按出现次数累加', () => {
        const stats = computeTextStats('他打了又杀，杀完再追。');
        expect(stats.actionCount).toBe(4);
    });
});

describe('co-writing monitor-cards 条目格式化', () => {
    it('伏笔字符串原样输出，对象补预计章节', () => {
        expect(formatForeshadowItem('玉佩')).toBe('玉佩');
        expect(formatForeshadowItem({ name: '玉佩', plannedReveal: '第3章' })).toBe('玉佩 (预计: 第3章)');
        expect(formatForeshadowItem({ name: '玉佩' })).toBe('玉佩');
    });

    it('人物状态行含境界、状态与最近变更', () => {
        expect(formatEntityStatusLine('林凡', {
            当前状态: '受伤',
            境界: '筑基',
            entity_last_changed_at: '第3章',
        })).toBe('林凡 · 筑基 · 受伤 (第3章)');
    });

    it('缺省字段回落未知/空', () => {
        expect(formatEntityStatusLine('林凡', {})).toBe('林凡 · 未知 ');
        expect(formatEntityStatusLine('林凡', { 修为: '炼气' })).toBe('林凡 · 炼气 · 未知 ');
    });
});

/**
 * 字数目标解析测试（2026-11-16，E-03 / D1）
 *
 * 缺陷背景：协同视图字数目标只读全局 defaultWordCount，
 * 分卷大纲「每章字数」定义了却零消费 → 进度百分比失真。
 */
import { describe, expect, it } from 'vitest';
import {
    describeWordGoalSource,
    parseWordsPerChapter,
    resolveChapterWordGoal,
} from '../../../ui/co-writing/word-goal';

describe('parseWordsPerChapter', () => {
    it('区间取上限', () => {
        expect(parseWordsPerChapter('- **每章字数**：2500-3000 字')).toBe(3000);
    });

    it('「约 N 字」', () => {
        expect(parseWordsPerChapter('- **每章字数**：约 2800 字')).toBe(2800);
    });

    it('单个数字', () => {
        expect(parseWordsPerChapter('每章字数: 3200')).toBe(3200);
    });

    it('字段不存在返回 null', () => {
        expect(parseWordsPerChapter('# 大纲\n- 总字数目标：9000')).toBeNull();
    });

    it('空输入返回 null', () => {
        expect(parseWordsPerChapter('')).toBeNull();
        expect(parseWordsPerChapter(null)).toBeNull();
        expect(parseWordsPerChapter(undefined)).toBeNull();
    });

    it('字段存在但无数字返回 null', () => {
        expect(parseWordsPerChapter('每章字数：待定')).toBeNull();
    });
});

describe('resolveChapterWordGoal（D1 优先级）', () => {
    it('优先使用大纲每章字数', () => {
        const goal = resolveChapterWordGoal({
            outlineContent: '每章字数：2500-3000 字',
            modeTargetWords: 80000,
            modeTargetUnits: 20,
            defaultWordCount: 2600,
        });
        expect(goal.goal).toBe(3000);
        expect(goal.source).toBe('outline');
    });

    it('无大纲时用项目配置（目标字数 ÷ 单元数）', () => {
        const goal = resolveChapterWordGoal({
            outlineContent: null,
            modeTargetWords: 80000,
            modeTargetUnits: 20,
            defaultWordCount: 2600,
        });
        expect(goal.goal).toBe(4000);
        expect(goal.source).toBe('project');
    });

    it('都没有时回退全局默认', () => {
        const goal = resolveChapterWordGoal({ defaultWordCount: 2600 });
        expect(goal.goal).toBe(2600);
        expect(goal.source).toBe('global');
    });

    it('全局默认缺失时兜底 3000', () => {
        expect(resolveChapterWordGoal({}).goal).toBe(3000);
    });

    it('非法项目配置被忽略', () => {
        const goal = resolveChapterWordGoal({ modeTargetWords: 80000, modeTargetUnits: 0, defaultWordCount: 2500 });
        expect(goal.source).toBe('global');
        expect(goal.goal).toBe(2500);
    });
});

describe('describeWordGoalSource', () => {
    it('来源短标签', () => {
        expect(describeWordGoalSource('outline')).toBe('大纲');
        expect(describeWordGoalSource('project')).toBe('项目');
        expect(describeWordGoalSource('global')).toBe('默认');
    });
});

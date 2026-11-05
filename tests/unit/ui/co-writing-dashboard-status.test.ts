import { describe, it, expect } from 'vitest';
import {
    computeWordGoalProgress,
    formatStatusLine,
    isDirtyState,
} from '../../../ui/co-writing/dashboard-status';

/**
 * 状态栏与保存状态纯计算：字数进度必须封顶 100，脏状态只排除「已保存/已加载」。
 */
describe('co-writing dashboard-status 状态栏', () => {
    it('未选项目与无章节名时给出回退文案', () => {
        expect(formatStatusLine({
            project: '',
            volume: '第1卷',
            chapterName: '',
            chapterNum: 3,
            wordCount: 0,
        })).toBe('📍 未选择项目 · 第1卷 · 第3章 · 字数 0');
    });

    it('有项目与章节名时直接展示', () => {
        expect(formatStatusLine({
            project: '我的项目',
            volume: '第1卷',
            chapterName: '风起',
            chapterNum: 3,
            wordCount: 1200,
        })).toBe('📍 我的项目 · 第1卷 · 风起 · 字数 1200');
    });

    it('目标进度四舍五入并封顶 100', () => {
        expect(computeWordGoalProgress(1500, 3000)).toBe(50);
        expect(computeWordGoalProgress(5000, 3000)).toBe(100);
        expect(computeWordGoalProgress(1000, 3000)).toBe(33);
    });

    it('只有已保存/已加载不算脏', () => {
        expect(isDirtyState('已保存')).toBe(false);
        expect(isDirtyState('已加载')).toBe(false);
        expect(isDirtyState('编辑中')).toBe(true);
        expect(isDirtyState('未保存')).toBe(true);
    });
});

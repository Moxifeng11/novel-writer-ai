import { describe, expect, it } from 'vitest';
import { buildEvaluationPrompt } from '../../../../engine/co-writer/evaluation-prompt';
import type { PlotNode, PlotProgress } from '../../../../engine/co-writer/co-writer-types';

/**
 * 评估提示词抽取后必须保持原有边界：
 * - 正文只取末尾 1500 字、章节目标截断 500 字；
 * - 未揭示伏笔最多 10 条、已揭示最多 5 条；
 * - 节点状态行按 currentIndex 标记已完成/进行中/未开始。
 */

function node(index: number, goal: string): PlotNode {
    return {
        id: `n${index}`,
        index,
        location: '',
        characters: '',
        conflict: '',
        goal,
        infoIncrement: '',
        source: 'outline',
        completed: false,
    };
}

function progressOf(currentIndex: number, total: number): PlotProgress {
    return {
        totalNodes: total,
        completedNodes: currentIndex,
        currentIndex,
        completionPercent: Math.round((currentIndex / total) * 100),
        nextNode: null,
        allCompleted: currentIndex >= total,
    };
}

describe('buildEvaluationPrompt', () => {
    it('正文取末尾 1500 字、章节目标截断 500 字', () => {
        const body = '头标记' + '前'.repeat(2000) + '尾部标记';
        const prompt = buildEvaluationPrompt({
            body,
            progress: progressOf(0, 1),
            plotNodes: [node(1, '目标')],
            chapterPlan: '纲'.repeat(600) + '截断后标记',
            unrevealed: [],
            revealed: [],
        });
        expect(prompt).toContain('尾部标记');
        expect(prompt).not.toContain('头标记');
        expect(prompt).toContain('纲'.repeat(500));
        expect(prompt).not.toContain('截断后标记');
        expect(prompt).toContain('约 2007 字符');
    });

    it('节点状态按 currentIndex 标记', () => {
        const prompt = buildEvaluationPrompt({
            body: '正文足够长',
            progress: progressOf(1, 3),
            plotNodes: [node(1, '甲目标'), node(2, '乙目标'), node(3, '丙目标')],
            chapterPlan: '',
            unrevealed: [],
            revealed: [],
        });
        expect(prompt).toContain('1. [✓ 已完成] 甲目标');
        expect(prompt).toContain('2. [→ 进行中] 乙目标');
        expect(prompt).toContain('3. [○ 未开始] 丙目标');
    });

    it('伏笔列表分别截断到 10 / 5 条', () => {
        const unrevealed = Array.from({ length: 12 }, (_, i) => ({
            id: `u${i}`,
            name: `未揭示${i + 1}`,
            plannedReveal: `第${i + 1}章`,
        }));
        const revealed = Array.from({ length: 7 }, (_, i) => ({
            id: `r${i}`,
            name: `已揭示${i + 1}`,
            revealChapter: `第${i + 1}章`,
        }));
        const prompt = buildEvaluationPrompt({
            body: '正文',
            progress: progressOf(0, 1),
            plotNodes: [node(1, '目标')],
            chapterPlan: '',
            unrevealed,
            revealed,
        });
        expect(prompt).toContain('未揭示10');
        expect(prompt).not.toContain('未揭示11');
        expect(prompt).toContain('已揭示5');
        expect(prompt).not.toContain('已揭示6');
    });

    it('无节点与无大纲时输出占位文案', () => {
        const prompt = buildEvaluationPrompt({
            body: '正文',
            progress: progressOf(0, 0),
            plotNodes: [],
            chapterPlan: '',
            unrevealed: [],
            revealed: [],
        });
        expect(prompt).toContain('（暂无节点信息）');
        expect(prompt).toContain('（暂无章节目标信息）');
        expect(prompt).not.toContain('【伏笔库');
    });
});

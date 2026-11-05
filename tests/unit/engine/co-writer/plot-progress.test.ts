import { describe, expect, it } from 'vitest';
import {
    buildPlotTargetHint,
    computePlotProgress,
} from '../../../../engine/co-writer/plot-progress';
import type { PlotNode } from '../../../../engine/co-writer/co-writer-types';

/**
 * 从 co-writer-engine 抽出的纯函数必须与抽取前一致：
 * - 节点完成判定是「≥30% 信号且 ≥1 个」，不是任一关键词命中；
 * - 进度以第一个未完成节点为当前位置；
 * - 目标提示在「全部完成」与「无节点」两种情况下返回不同文案。
 */

function node(index: number, over: Partial<PlotNode> = {}): PlotNode {
    return {
        id: `n${index}`,
        index,
        location: '',
        characters: '',
        conflict: '',
        goal: `目标${index}`,
        infoIncrement: '',
        source: 'outline',
        completed: false,
        ...over,
    };
}

describe('computePlotProgress', () => {
    it('命中第一个节点的目标即标记完成，并指向下一个节点', () => {
        const nodes = [node(1, { goal: '林默抵达客栈' }), node(2, { goal: '苏晚拔剑' })];
        const progress = computePlotProgress(nodes, '林默抵达客栈，雨声很大。');
        expect(progress.totalNodes).toBe(2);
        expect(progress.completedNodes).toBe(1);
        expect(progress.currentIndex).toBe(1);
        expect(progress.nextNode).toBe(nodes[1]);
        expect(progress.completionPercent).toBe(50);
        expect(nodes[0].completed).toBe(true);
    });

    it('多信号节点只命中 1 个时不算完成（30% 阈值）', () => {
        const nodes = [node(1, {
            goal: '夺得令牌',
            location: '藏经阁',
            characters: '林默与苏晚',
            conflict: '与守卫交手',
        })];
        // 4 个信号需要 2 个命中；这里只命中地点。
        const progress = computePlotProgress(nodes, '藏经阁外很安静。');
        expect(progress.completedNodes).toBe(0);
        expect(progress.nextNode).toBe(nodes[0]);
        expect(nodes[0].completed).toBe(false);
    });

    it('空节点列表返回零进度且 allCompleted', () => {
        const progress = computePlotProgress([], '任何正文');
        expect(progress.totalNodes).toBe(0);
        expect(progress.completedNodes).toBe(0);
        expect(progress.currentIndex).toBe(0);
        expect(progress.nextNode).toBeNull();
        expect(progress.allCompleted).toBe(true);
    });
});

describe('buildPlotTargetHint', () => {
    it('有下一个节点时输出进度与目标细节', () => {
        const nodes = [node(1, { goal: '林默抵达客栈', location: '客栈', characters: '林默', conflict: '身份暴露' })];
        const hint = buildPlotTargetHint(nodes, computePlotProgress(nodes, ''));
        expect(hint).toContain('第1/1个剧情节点');
        expect(hint).toContain('下一个剧情目标：林默抵达客栈');
        expect(hint).toContain('地点：客栈');
        expect(hint).toContain('涉及人物：林默');
        expect(hint).toContain('冲突焦点：身份暴露');
    });

    it('全部完成时提示收尾', () => {
        const nodes = [node(1, { goal: '林默抵达客栈' })];
        const hint = buildPlotTargetHint(nodes, computePlotProgress(nodes, '林默抵达客栈'));
        expect(hint).toContain('所有剧情节点已推进完毕');
    });

    it('无节点时返回空串', () => {
        expect(buildPlotTargetHint([], computePlotProgress([], '正文'))).toBe('');
    });
});

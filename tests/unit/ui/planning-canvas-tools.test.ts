/**
 * 规划画布工具测试（2026-11-16）
 */
import { describe, expect, it } from 'vitest';
import {
    clampZoom,
    filterPlanningNodes,
    formatZoom,
    nextMatch,
    stepZoom,
    ZOOM_MAX,
    ZOOM_MIN,
} from '../../../ui/planning/canvas-tools';
import type { PlanningNode } from '../../../domains/planning/model';

function node(id: string, title: string, summary = ''): PlanningNode {
    return {
        id,
        title,
        summary,
        kind: 'event',
        status: 'idea',
        parentId: null,
        position: { x: 0, y: 0 },
    };
}

describe('clampZoom / stepZoom / formatZoom', () => {
    it('夹紧到合法范围', () => {
        expect(clampZoom(9)).toBe(ZOOM_MAX);
        expect(clampZoom(0.01)).toBe(ZOOM_MIN);
        expect(clampZoom(1)).toBe(1);
    });

    it('非法值回退 1', () => {
        expect(clampZoom(Number.NaN)).toBe(1);
    });

    it('逐档放大/缩小', () => {
        expect(stepZoom(1, 1)).toBe(1.25);
        expect(stepZoom(1, -1)).toBe(0.75);
    });

    it('到顶/到底后停住', () => {
        expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
        expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    });

    it('百分比文案', () => {
        expect(formatZoom(1)).toBe('100%');
        expect(formatZoom(1.25)).toBe('125%');
    });
});

describe('filterPlanningNodes', () => {
    const nodes = [node('a', '主角登场'), node('b', '反派现身', '在城门相遇'), node('c', '离开')];

    it('空关键字返回空', () => {
        expect(filterPlanningNodes(nodes, '   ')).toEqual([]);
    });

    it('按标题命中', () => {
        expect(filterPlanningNodes(nodes, '主角')).toEqual(['a']);
    });

    it('按摘要命中', () => {
        expect(filterPlanningNodes(nodes, '城门')).toEqual(['b']);
    });

    it('不区分大小写（英文）', () => {
        const en = [node('x', 'Gate opens')];
        expect(filterPlanningNodes(en, 'gate')).toEqual(['x']);
    });

    it('无命中返回空数组', () => {
        expect(filterPlanningNodes(nodes, '不存在')).toEqual([]);
    });
});

describe('nextMatch', () => {
    it('无命中返回 null', () => {
        expect(nextMatch([], null, 1)).toBeNull();
    });

    it('当前不在命中里时取首/尾', () => {
        expect(nextMatch(['a', 'b'], null, 1)).toBe('a');
        expect(nextMatch(['a', 'b'], null, -1)).toBe('b');
    });

    it('顺序循环', () => {
        expect(nextMatch(['a', 'b', 'c'], 'a', 1)).toBe('b');
        expect(nextMatch(['a', 'b', 'c'], 'c', 1)).toBe('a');
        expect(nextMatch(['a', 'b', 'c'], 'a', -1)).toBe('c');
    });
});

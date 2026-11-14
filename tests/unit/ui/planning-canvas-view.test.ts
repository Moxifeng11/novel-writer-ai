/**
 * planning-canvas-view 行为测试（视图门禁要求：>200 行的视图必须有测试）
 *
 * 只测从视图抽出的纯函数：连线几何与状态变更守卫。
 */

import { describe, expect, it } from 'vitest';
import {
    guardStatusChange,
    planningEdgeLine,
    PLANNING_CANVAS_VIEW_TYPE,
} from '@/ui/views/planning-canvas-view';
import type { PlanningNode } from '@/domains/planning/model';

/**
 * 构造测试节点。
 *
 * @param overrides - 覆盖字段
 * @returns 节点
 */
const node = (overrides: Partial<PlanningNode> = {}): PlanningNode => ({
    id: 'n1',
    title: '事件',
    summary: '',
    kind: 'event',
    status: 'idea',
    parentId: null,
    position: { x: 0, y: 0 },
    ...overrides,
});

describe('视图类型常量', () => {
    it('类型 id 稳定（注册与命令依赖它）', () => {
        expect(PLANNING_CANVAS_VIEW_TYPE).toBe('novel-writer-planning-canvas');
    });
});

describe('planningEdgeLine 连线几何', () => {
    it('从起点右侧中点到终点左侧中点', () => {
        expect(planningEdgeLine({ x: 100, y: 50 }, { x: 400, y: 200 }))
            .toEqual({ x1: 280, y1: 88, x2: 400, y2: 238 });
    });

    it('同位置节点产生零长度连线（不崩溃）', () => {
        const line = planningEdgeLine({ x: 10, y: 10 }, { x: 10, y: 10 });
        expect(Number.isFinite(line.x1)).toBe(true);
        expect(line.x1).toBeGreaterThan(line.x2);
    });
});

describe('guardStatusChange 状态守卫', () => {
    it('无证据标记已落文被拒绝', () => {
        expect(guardStatusChange(node(), 'written')).toContain('正文证据');
    });

    it('有证据标记已落文允许', () => {
        expect(guardStatusChange(node({ chapterRefs: [{ chapterId: 'c1', revision: 1 }] }), 'written')).toBeNull();
    });

    it('其他状态变更不受限', () => {
        expect(guardStatusChange(node(), 'selected')).toBeNull();
        expect(guardStatusChange(node(), 'dropped')).toBeNull();
    });
});

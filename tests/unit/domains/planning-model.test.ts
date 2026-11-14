/**
 * planning-model 单测：节点校验 / 包含树 / 环检测 / 连线 / 删除 / 自动布局
 */

import { describe, expect, it } from 'vitest';
import {
    addEdge,
    autoLayout,
    buildContainmentTree,
    canvasStats,
    emptyCanvas,
    hasContainmentCycle,
    planningId,
    PLANNING_CANVAS_VERSION,
    removeNode,
    validateNode,
    type PlanningCanvas,
    type PlanningNode,
} from '@/domains/planning/model';

const node = (id: string, overrides: Partial<PlanningNode> = {}): PlanningNode => ({
    id,
    title: id,
    summary: '',
    kind: 'event',
    status: 'idea',
    parentId: null,
    position: { x: 0, y: 0 },
    ...overrides,
});

const canvasOf = (...nodes: PlanningNode[]): PlanningCanvas => ({
    ...emptyCanvas(1),
    nodes,
});

describe('emptyCanvas / planningId', () => {
    it('空画布带版本与时间戳', () => {
        const canvas = emptyCanvas(123);
        expect(canvas.version).toBe(PLANNING_CANVAS_VERSION);
        expect(canvas.updatedAt).toBe(123);
        expect(canvas.nodes).toEqual([]);
    });

    it('id 可复现且带前缀', () => {
        expect(planningId('node', 1000, 0)).toBe('node-1000-000');
    });
});

describe('validateNode 状态约束', () => {
    it('标题为空不合法', () => {
        expect(validateNode(node('a', { title: '  ' }))).toBe('标题不能为空');
    });

    it('written 无正文证据不合法', () => {
        expect(validateNode(node('a', { status: 'written' }))).toContain('chapterRefs');
    });

    it('written 带正文证据合法', () => {
        expect(validateNode(node('a', { status: 'written', chapterRefs: [{ chapterId: 'c1', revision: 1 }] }))).toBeNull();
    });

    it('idea 无证据也合法', () => {
        expect(validateNode(node('a'))).toBeNull();
    });
});

describe('buildContainmentTree 包含树', () => {
    it('区分顶层、子节点与孤儿', () => {
        const tree = buildContainmentTree([
            node('root'),
            node('child', { parentId: 'root' }),
            node('orphan', { parentId: 'missing' }),
        ]);
        expect(tree.roots.map(item => item.id)).toEqual(['root']);
        expect(tree.childrenOf.get('root')?.map(item => item.id)).toEqual(['child']);
        expect(tree.orphans.map(item => item.id)).toEqual(['orphan']);
    });
});

describe('hasContainmentCycle 环检测', () => {
    it('正常层级无环', () => {
        expect(hasContainmentCycle([node('a'), node('b', { parentId: 'a' })])).toBe(false);
    });

    it('自包含算环', () => {
        expect(hasContainmentCycle([node('a', { parentId: 'a' })])).toBe(true);
    });

    it('互相包含算环', () => {
        expect(hasContainmentCycle([node('a', { parentId: 'b' }), node('b', { parentId: 'a' })])).toBe(true);
    });
});

describe('addEdge 连线', () => {
    const canvas = canvasOf(node('a'), node('b'));

    it('合法连线被加入', () => {
        const next = addEdge(canvas, { id: 'e1', from: 'a', to: 'b', type: 'next' });
        expect(next?.edges).toHaveLength(1);
    });

    it('自环被拒绝', () => {
        expect(addEdge(canvas, { id: 'e1', from: 'a', to: 'a', type: 'next' })).toBeNull();
    });

    it('端点不存在被拒绝', () => {
        expect(addEdge(canvas, { id: 'e1', from: 'a', to: 'zzz', type: 'next' })).toBeNull();
    });

    it('重复连线被拒绝', () => {
        const once = addEdge(canvas, { id: 'e1', from: 'a', to: 'b', type: 'next' })!;
        expect(addEdge(once, { id: 'e2', from: 'a', to: 'b', type: 'next' })).toBeNull();
    });

    it('同端点不同类型允许（顺序 vs 依赖）', () => {
        const once = addEdge(canvas, { id: 'e1', from: 'a', to: 'b', type: 'next' })!;
        expect(addEdge(once, { id: 'e2', from: 'a', to: 'b', type: 'requires' })).not.toBeNull();
    });
});

describe('removeNode 删除', () => {
    it('删除节点并清理相关连线', () => {
        const canvas: PlanningCanvas = {
            ...canvasOf(node('a'), node('b'), node('c')),
            edges: [{ id: 'e1', from: 'a', to: 'b', type: 'next' }, { id: 'e2', from: 'b', to: 'c', type: 'next' }],
        };
        const next = removeNode(canvas, 'b');
        expect(next.nodes.map(item => item.id)).toEqual(['a', 'c']);
        expect(next.edges).toHaveLength(0);
    });

    it('子节点上移到被删节点的父级（不连带删除）', () => {
        const canvas = canvasOf(node('root'), node('mid', { parentId: 'root' }), node('leaf', { parentId: 'mid' }));
        const next = removeNode(canvas, 'mid');
        expect(next.nodes.find(item => item.id === 'leaf')?.parentId).toBe('root');
    });

    it('删除不存在的节点返回原画布', () => {
        const canvas = canvasOf(node('a'));
        expect(removeNode(canvas, 'zzz')).toBe(canvas);
    });
});

describe('autoLayout 自动布局', () => {
    it('按层级分列、同层纵向排开', () => {
        const layout = autoLayout([node('a'), node('b', { parentId: 'a' }), node('c', { parentId: 'a' })]);
        expect(layout.get('a')).toEqual({ x: 80, y: 80 });
        expect(layout.get('b')).toEqual({ x: 320, y: 80 });
        expect(layout.get('c')).toEqual({ x: 320, y: 200 });
    });
});

describe('canvasStats 统计', () => {
    it('按状态计数', () => {
        const stats = canvasStats(canvasOf(
            node('a', { status: 'idea' }),
            node('b', { status: 'written', chapterRefs: [{ chapterId: 'c', revision: 1 }] }),
            node('c', { status: 'written', chapterRefs: [{ chapterId: 'c', revision: 2 }] }),
        ));
        expect(stats).toEqual({ idea: 1, selected: 0, written: 2, dropped: 0 });
    });
});

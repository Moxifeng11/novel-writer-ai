/**
 * planning-model 单测：节点校验 / 包含树 / 环检测 / 连线 / 删除 / 自动布局
 */

import { describe, expect, it } from 'vitest';
import {
    addEdge,
    addNote,
    autoLayout,
    buildContainmentTree,
    canvasStats,
    emptyCanvas,
    normalizeCanvas,
    noteCount,
    planningNoteId,
    removeNote,
    updateNote,
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

describe('画布便签', () => {
    const canvas = emptyCanvas(1);

    it('新增便签带 id/坐标/配色', () => {
        const next = addNote(canvas, '这里埋个伏笔', { x: 10, y: 20 });
        expect(next.notes).toHaveLength(1);
        expect(next.notes[0].text).toBe('这里埋个伏笔');
        expect(next.notes[0].position).toEqual({ x: 10, y: 20 });
        expect(next.notes[0].color).toBe('yellow');
    });

    it('不修改原画布（不可变更新）', () => {
        const next = addNote(canvas, 'x', { x: 0, y: 0 });
        expect(canvas.notes).toHaveLength(0);
        expect(next).not.toBe(canvas);
    });

    it('修改文本与坐标', () => {
        const withNote = addNote(canvas, '旧', { x: 0, y: 0 });
        const id = withNote.notes[0].id;
        const updated = updateNote(withNote, id, { text: '新', position: { x: 50, y: 60 } });
        expect(updated.notes[0].text).toBe('新');
        expect(updated.notes[0].position).toEqual({ x: 50, y: 60 });
    });

    it('修改不存在的便签原样返回', () => {
        const next = updateNote(canvas, 'missing', { text: 'x' });
        expect(next).toBe(canvas);
    });

    it('删除便签', () => {
        const withNote = addNote(canvas, 'x', { x: 0, y: 0 });
        const id = withNote.notes[0].id;
        expect(removeNote(withNote, id).notes).toHaveLength(0);
    });

    it('删除不存在的便签原样返回', () => {
        expect(removeNote(canvas, 'missing')).toBe(canvas);
    });

    it('便签 id 唯一', () => {
        expect(planningNoteId(1, 0.1)).not.toBe(planningNoteId(1, 0.9));
    });

    it('旧画布缺 notes 字段时归一化补空数组', () => {
        const legacy = { version: 1, updatedAt: 1, nodes: [], edges: [] } as never;
        expect(normalizeCanvas(legacy).notes).toEqual([]);
    });

    it('noteCount 统计便签数', () => {
        const two = addNote(addNote(canvas, 'a', { x: 0, y: 0 }), 'b', { x: 1, y: 1 });
        expect(noteCount(two)).toBe(2);
    });
});

describe('chapterNum（规划 ↔ 正文联动字段）', () => {
    it('作为可选字段不破坏既有节点，且不当作落文证据', () => {
        const canvas = emptyCanvas(1);
        const node = {
            id: 'n1',
            title: '开门',
            summary: '',
            kind: 'event' as const,
            status: 'idea' as const,
            parentId: null,
            position: { x: 0, y: 0 },
            chapterNum: 12,
        };
        const next = { ...canvas, nodes: [node] };
        expect(next.nodes[0].chapterNum).toBe(12);
        expect(canvasStats(next).idea).toBe(1);
        // chapterNum 不是落文证据：written 仍需 chapterRefs
        expect(validateNode({ ...node, status: 'written' })).toContain('chapterRefs');
    });
});


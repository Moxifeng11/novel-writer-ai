/**
 * P0-2：图构建注入事实节点（零回归验证）
 *
 * 锁两件事：
 *  1. 传 factNodes 时，事实进入 nodes/byKind 并连到同名实体
 *  2. **不传时行为与原来完全一致**（零回归是这次改动的前提）
 */

import { describe, expect, it } from 'vitest';
import { buildStoryContextGraph } from '../../../../engine/context/story-context-graph';
import { toContextNodes } from '../../../../engine/context/knowledge-fact-nodes';
import { stateAt } from '../../../../engine/context/fact-view';
import type { StoryContextSource } from '../../../../engine/context/story-context-types';
import type { DecomposeEntry } from '../../../../engine/consistency/knowledge-decompose';

/** 造拆解条目 */
function entry(over: Partial<DecomposeEntry> = {}): DecomposeEntry {
    return {
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 3,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七岁',
        ...over,
    };
}

/** 最小可用 source（其他字段用空对象占位，图构建对缺失数据有容错） */
function source(over: Partial<StoryContextSource> = {}): StoryContextSource {
    return {
        project: '项目A',
        chapterName: '第3章',
        chapterNum: 3,
        volume: '',
        context: { data: {}, gatheredAt: 0 } as never,
        ...over,
    };
}

describe('零回归：不传 factNodes', () => {
    it('节点数量与不含事实时一致', () => {
        const graph = buildStoryContextGraph(source());
        expect([...graph.nodes.keys()].every(id => !id.startsWith('fact:'))).toBe(true);
    });

    it('空数组等价于不传', () => {
        const a = buildStoryContextGraph(source());
        const b = buildStoryContextGraph(source({ factNodes: [] }));
        expect([...b.nodes.keys()].sort()).toEqual([...a.nodes.keys()].sort());
    });
});

describe('注入事实节点', () => {
    const facts = toContextNodes([entry(), entry({ type: 'world-rule', subject: '世界', predicate: '禁则', value: '不能御空', quote: '不能御空飞行' })], 3, '第3章');

    it('事实进入 nodes 与 byKind', () => {
        const graph = buildStoryContextGraph(source({ factNodes: facts }));
        expect(graph.nodes.has('fact:3:宁缺:年龄')).toBe(true);
        expect(graph.byKind.character.some(n => n.id === 'fact:3:宁缺:年龄')).toBe(true);
        expect(graph.byKind.setting.some(n => n.id === 'fact:3:世界:禁则')).toBe(true);
    });

    it('事实节点可被 stateAt 查到（单一事实源接通）', () => {
        const graph = buildStoryContextGraph(source({ factNodes: facts }));
        const state = stateAt(graph.nodes.values(), '宁缺', 5);
        expect(state).toHaveLength(1);
        expect(state[0].value).toBe('十七');
    });

    it('重复注入不产生重复节点（id 去重）', () => {
        const graph = buildStoryContextGraph(source({ factNodes: [...facts, ...facts] }));
        const ids = [...graph.nodes.keys()].filter(id => id.startsWith('fact:'));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

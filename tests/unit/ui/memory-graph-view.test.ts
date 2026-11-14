/**
 * memory-graph-view 行为测试（视图门禁要求）
 *
 * 测从视图抽出的纯函数 describeEdge：关系方向与标签展示。
 */

import { describe, expect, it } from 'vitest';
import { describeEdge, MEMORY_GRAPH_VIEW_TYPE } from '@/ui/views/memory-graph-view';
import type { MemoryCard, MemoryEdge } from '@/domains/memory/model';

/** 构造测试卡片。 */
const card = (name: string, id: string): MemoryCard => ({
    id,
    name,
    type: 'character',
    path: `p/${name}.md`,
    summary: '',
});

const cards = [card('林玄', 'character:p/林玄.md'), card('苏婉', 'character:p/苏婉.md')];

/** 构造测试关系。 */
const edge = (from: string, to: string, label = ''): MemoryEdge => ({
    id: 'e1',
    from,
    to,
    type: 'ally',
    label,
});

describe('视图类型常量', () => {
    it('类型 id 稳定', () => {
        expect(MEMORY_GRAPH_VIEW_TYPE).toBe('novel-writer-memory-graph');
    });
});

describe('describeEdge 关系展示', () => {
    it('出边显示「标签 → 对方」', () => {
        expect(describeEdge(edge(cards[0].id, cards[1].id), cards, cards[0].id)).toBe('盟友 → 苏婉');
    });

    it('入边显示「对方 → 标签」', () => {
        expect(describeEdge(edge(cards[0].id, cards[1].id), cards, cards[1].id)).toBe('林玄 → 盟友');
    });

    it('自定义标签优先于类型名', () => {
        expect(describeEdge(edge(cards[0].id, cards[1].id, '青梅竹马'), cards, cards[0].id))
            .toBe('青梅竹马 → 苏婉');
    });

    it('对方卡片不存在时显示已删除', () => {
        expect(describeEdge(edge(cards[0].id, 'missing'), cards, cards[0].id)).toBe('盟友 → （已删除实体）');
    });
});

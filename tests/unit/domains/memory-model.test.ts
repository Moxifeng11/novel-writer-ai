/**
 * memory-model 单测：卡片派生 / 关系校验 / 增删 / 清理 / 分组搜索
 */

import { describe, expect, it } from 'vitest';
import {
    addEdge,
    buildCard,
    edgesOf,
    emptyGraph,
    groupCards,
    MEMORY_GRAPH_VERSION,
    memoryCardId,
    memoryEdgeId,
    pruneEdges,
    removeEdge,
    searchCards,
    validateEdge,
    type MemoryCard,
    type MemoryEdge,
} from '@/domains/memory/model';

const card = (name: string, type: MemoryCard['type'] = 'character', path?: string): MemoryCard =>
    buildCard({ path: path ?? `p/01-世界架构/人物/${name}.md`, name }, type);

const edge = (from: string, to: string, type: MemoryEdge['type'] = 'ally'): MemoryEdge => ({
    id: `${from}->${to}`,
    from,
    to,
    type,
    label: '',
});

describe('卡片派生', () => {
    it('id 由类型 + 路径派生，稳定可复现', () => {
        expect(memoryCardId('character', 'p/人物/林玄.md')).toBe('character:p/人物/林玄.md');
    });

    it('buildCard 生成摘要与类型', () => {
        const built = buildCard({ path: 'p/人物/林玄.md', name: '林玄' }, 'character', '主角');
        expect(built).toEqual({
            id: 'character:p/人物/林玄.md',
            name: '林玄',
            type: 'character',
            path: 'p/人物/林玄.md',
            summary: '主角',
        });
    });

    it('关系 id 可复现', () => {
        expect(memoryEdgeId(1000, 0)).toBe('edge-1000-000');
    });
});

describe('validateEdge 关系校验', () => {
    const cards = [card('林玄'), card('苏婉')];

    it('合法关系通过', () => {
        expect(validateEdge({ from: cards[0].id, to: cards[1].id, type: 'ally' }, cards, [])).toBeNull();
    });

    it('自连被拒绝', () => {
        expect(validateEdge({ from: cards[0].id, to: cards[0].id, type: 'ally' }, cards, []))
            .toContain('自己');
    });

    it('端点不存在被拒绝', () => {
        expect(validateEdge({ from: 'missing', to: cards[1].id, type: 'ally' }, cards, []))
            .toContain('起点');
    });

    it('同类型重复关系被拒绝', () => {
        const existing = [edge(cards[0].id, cards[1].id, 'ally')];
        expect(validateEdge({ from: cards[0].id, to: cards[1].id, type: 'ally' }, cards, existing))
            .toContain('已存在');
    });

    it('不同关系类型允许（盟友 + 亲属）', () => {
        const existing = [edge(cards[0].id, cards[1].id, 'ally')];
        expect(validateEdge({ from: cards[0].id, to: cards[1].id, type: 'family' }, cards, existing)).toBeNull();
    });
});

describe('addEdge / removeEdge', () => {
    const cards = [card('林玄'), card('苏婉')];

    it('合法边被加入', () => {
        const next = addEdge(emptyGraph(1), edge(cards[0].id, cards[1].id), cards);
        expect(next?.edges).toHaveLength(1);
    });

    it('非法边返回 null', () => {
        expect(addEdge(emptyGraph(1), edge(cards[0].id, cards[0].id), cards)).toBeNull();
    });

    it('删除边返回新图', () => {
        const once = addEdge(emptyGraph(1), edge(cards[0].id, cards[1].id), cards)!;
        const next = removeEdge(once, once.edges[0].id);
        expect(next.edges).toHaveLength(0);
    });

    it('删除不存在的边返回原图', () => {
        const graph = emptyGraph(1);
        expect(removeEdge(graph, 'zzz')).toBe(graph);
    });
});

describe('edgesOf 相关边', () => {
    it('起点与终点都能查到', () => {
        const cards = [card('A'), card('B'), card('C')];
        const graph = addEdge(
            addEdge(emptyGraph(1), edge(cards[0].id, cards[1].id), cards)!,
            edge(cards[1].id, cards[2].id),
            cards,
        )!;
        expect(edgesOf(graph, cards[1].id)).toHaveLength(2);
        expect(edgesOf(graph, cards[2].id)).toHaveLength(1);
    });
});

describe('pruneEdges 清理孤儿边', () => {
    it('指向已删卡片的边被移除并计数', () => {
        const cards = [card('A'), card('B')];
        const graph = addEdge(emptyGraph(1), edge(cards[0].id, cards[1].id), cards)!;
        const result = pruneEdges(graph, [cards[0]]);
        expect(result.removed).toBe(1);
        expect(result.graph.edges).toHaveLength(0);
    });

    it('无孤儿边时不改动图', () => {
        const cards = [card('A'), card('B')];
        const graph = addEdge(emptyGraph(1), edge(cards[0].id, cards[1].id), cards)!;
        const result = pruneEdges(graph, cards);
        expect(result.removed).toBe(0);
        expect(result.graph).toBe(graph);
    });
});

describe('groupCards / searchCards', () => {
    const cards = [
        card('林玄', 'character'),
        card('苏婉', 'character'),
        card('青云宗', 'faction', 'p/01-世界架构/势力/青云宗.md'),
        buildCard({ path: 'p/01-世界架构/地点/后山.md', name: '后山' }, 'location', '宗门后山'),
    ];

    it('按类型分组并按名称排序', () => {
        const groups = groupCards(cards);
        // localeCompare 按拼音：林(lín) 在 苏(sū) 之前
        expect(groups.character.map(item => item.name)).toEqual(['林玄', '苏婉']);
        expect(groups.faction).toHaveLength(1);
        expect(groups.item).toHaveLength(0);
    });

    it('空关键字返回全部（受 limit 限制）', () => {
        expect(searchCards(cards, '', 2)).toHaveLength(2);
    });

    it('按名称与摘要搜索', () => {
        expect(searchCards(cards, '林').map(item => item.name)).toEqual(['林玄']);
        expect(searchCards(cards, '后山').map(item => item.name)).toEqual(['后山']);
    });

    it('搜索忽略大小写', () => {
        const en = [buildCard({ path: 'p/人物/Lin.md', name: 'Lin' }, 'character')];
        expect(searchCards(en, 'lin')).toHaveLength(1);
    });
});

describe('emptyGraph', () => {
    it('带版本与时间戳', () => {
        const graph = emptyGraph(99);
        expect(graph.version).toBe(MEMORY_GRAPH_VERSION);
        expect(graph.updatedAt).toBe(99);
        expect(graph.edges).toEqual([]);
    });
});

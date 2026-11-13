/**
 * 事实节点与视图单测（P0）
 *
 * 锁住架构校准后的两条不变量：
 *  1. **单一事实源**：事实只存在于图节点里，不存在独立事实库
 *  2. **权威序**：图可人工修正，摘要只是派生数据（冲突时图优先）
 */

import { describe, expect, it } from 'vitest';
import { summarizeFacts, queryFacts, stateAt } from '../../../../engine/context/fact-view';
import {
    FACT_TYPE_TO_KIND,
    factNodeId,
    formatFactText,
    linkFactsToEntities,
    readAllFacts,
    readFact,
    toContextNodes,
    truncate,
} from '../../../../engine/context/knowledge-fact-nodes';
import type { DecomposeEntry } from '../../../../engine/consistency/knowledge-decompose';
import type { StoryContextNode } from '../../../../engine/context/story-context-types';

/** 造拆解条目 */
function entry(over: Partial<DecomposeEntry> = {}): DecomposeEntry {
    return {
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 1,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七岁',
        ...over,
    };
}

/** 造实体节点 */
function entityNode(id: string, title: string, kind: StoryContextNode['kind'] = 'character'): StoryContextNode {
    return {
        id,
        kind,
        title,
        text: title,
        compactText: title,
        priority: 1,
        required: true,
        tokens: 2,
        compactTokens: 2,
        links: [],
        metadata: {},
    };
}

describe('类型映射（9 → 6，不新增 kind）', () => {
    it('全部拆解类型都有对应图 kind', () => {
        for (const type of Object.keys(FACT_TYPE_TO_KIND)) {
            expect(FACT_TYPE_TO_KIND[type as keyof typeof FACT_TYPE_TO_KIND]).toBeTruthy();
        }
    });

    it('映射到既有 kind（不引入新类型）', () => {
        const kinds = new Set(Object.values(FACT_TYPE_TO_KIND));
        for (const kind of kinds) {
            expect(['character', 'location', 'item', 'timeline', 'setting']).toContain(kind);
        }
    });

    it('年龄/能力/记忆 → character；物品 → item；规则 → setting', () => {
        expect(FACT_TYPE_TO_KIND.age).toBe('character');
        expect(FACT_TYPE_TO_KIND.ability).toBe('character');
        expect(FACT_TYPE_TO_KIND.possession).toBe('item');
        expect(FACT_TYPE_TO_KIND['world-rule']).toBe('setting');
    });
});

describe('toContextNodes · 事实变节点', () => {
    it('生成合法图节点（含 metadata.fact）', () => {
        const [node] = toContextNodes([entry()], 3, '第3章');
        expect(node.id).toBe('fact:3:宁缺:年龄');
        expect(node.kind).toBe('character');
        expect(node.metadata.fact).toMatchObject({ subject: '宁缺', value: '十七', validFrom: 1, validTo: null });
    });

    it('本章出场人物的事实标 required', () => {
        const nodes = toContextNodes([entry(), entry({ subject: '桑桑' })], 3, '第3章', { involved: ['宁缺'] });
        expect(nodes.find(n => n.metadata.fact && (n.metadata.fact as { subject: string }).subject === '宁缺')!.required).toBe(true);
        expect(nodes.find(n => n.metadata.fact && (n.metadata.fact as { subject: string }).subject === '桑桑')!.required).toBe(false);
    });

    it('priority 由置信度与类型权重决定（规则 > 知识）', () => {
        const [rule] = toContextNodes([entry({ type: 'world-rule' })], 1);
        const [knowledge] = toContextNodes([entry({ type: 'knowledge' })], 1);
        expect(rule.priority).toBeGreaterThan(knowledge.priority);
    });

    it('节点 id 稳定可去重', () => {
        expect(factNodeId(3, '宁缺', '年龄')).toBe('fact:3:宁缺:年龄');
        const a = toContextNodes([entry()], 3);
        const b = toContextNodes([entry()], 3);
        expect(a[0].id).toBe(b[0].id);
    });

    it('文本包含有效区间与原文引文', () => {
        const [node] = toContextNodes([entry()], 3);
        expect(node.text).toContain('第3章起');
        expect(node.text).toContain('宁缺今年十七岁');
    });
});

describe('readFact / readAllFacts · 还原', () => {
    it('能从节点还原事实', () => {
        const [node] = toContextNodes([entry()], 3);
        expect(readFact(node)).toMatchObject({ subject: '宁缺', predicate: '年龄', value: '十七' });
    });

    it('非事实节点返回 null', () => {
        expect(readFact(entityNode('n1', '宁缺'))).toBeNull();
    });

    it('批量取事实', () => {
        const nodes = [...toContextNodes([entry(), entry({ subject: '桑桑' })], 1), entityNode('n1', '宁缺')];
        expect(readAllFacts(nodes)).toHaveLength(2);
    });
});

describe('linkFactsToEntities · 复用图的 links', () => {
    it('事实节点连到同名实体节点', () => {
        const facts = toContextNodes([entry()], 3);
        const linked = linkFactsToEntities(facts, [entityNode('char:宁缺', '宁缺')]);
        expect(linked).toBe(1);
        expect(facts[0].links[0].targetId).toBe('char:宁缺');
        expect(facts[0].links[0].reason).toBe('alias');
    });

    it('没有同名实体则不连', () => {
        const facts = toContextNodes([entry()], 3);
        expect(linkFactsToEntities(facts, [entityNode('char:桑桑', '桑桑')])).toBe(0);
    });
});

describe('stateAt · 时间切片（时间线不崩的核心）', () => {
    function nodesOf(items: Array<{ chapter: number; entry: DecomposeEntry }>): StoryContextNode[] {
        return items.flatMap(item => toContextNodes([item.entry], item.chapter));
    }

    it('取该章时点有效状态', () => {
        const nodes = nodesOf([
            { chapter: 1, entry: entry({ predicate: '位置', type: 'location', value: '渭城' }) },
            { chapter: 20, entry: entry({ predicate: '位置', type: 'location', value: '长安' }) },
        ]);
        expect(stateAt(nodes, '宁缺', 5)[0].value).toBe('渭城');
        expect(stateAt(nodes, '宁缺', 25)[0].value).toBe('长安');
    });

    it('未来事实不提前出现', () => {
        const nodes = nodesOf([{ chapter: 20, entry: entry({ predicate: '修为', type: 'ability', value: '筑基' }) }]);
        expect(stateAt(nodes, '宁缺', 5)).toHaveLength(0);
    });

    it('有效区间结束的状态不返回', () => {
        const nodes = nodesOf([
            { chapter: 1, entry: entry({ predicate: '持有', type: 'possession', value: '青铜钥匙', validTo: 10 }) },
        ]);
        expect(stateAt(nodes, '宁缺', 5)).toHaveLength(1);
        expect(stateAt(nodes, '宁缺', 15)).toHaveLength(0);
    });

    it('同谓词取最晚一条', () => {
        const nodes = nodesOf([
            { chapter: 1, entry: entry({ predicate: '位置', type: 'location', value: '渭城' }) },
            { chapter: 10, entry: entry({ predicate: '位置', type: 'location', value: '长安' }) },
        ]);
        const state = stateAt(nodes, '宁缺', 15);
        expect(state).toHaveLength(1);
        expect(state[0].value).toBe('长安');
    });
});

describe('queryFacts · 检索（写作参考）', () => {
    const nodes = [
        ...toContextNodes([entry(), entry({ type: 'location', predicate: '位置', value: '渭城' })], 1),
        ...toContextNodes([entry({ value: '十八' })], 20),
    ];

    it('按主体检索', () => {
        expect(queryFacts(nodes, { subject: '宁缺' }).length).toBe(3);
    });

    it('按类型检索', () => {
        expect(queryFacts(nodes, { type: 'location' })).toHaveLength(1);
    });

    it('按章节窗检索', () => {
        expect(queryFacts(nodes, { toChapter: 5 }).every(f => f.chapter <= 5)).toBe(true);
    });

    it('按关键词检索（含主体）', () => {
        expect(queryFacts(nodes, { keyword: '渭城' }).length).toBeGreaterThanOrEqual(1);
    });

    it('limit 生效', () => {
        expect(queryFacts(nodes, { subject: '宁缺', limit: 1 })).toHaveLength(1);
    });
});

describe('summarizeFacts', () => {
    it('统计事实数/主体数/章节范围', () => {
        const nodes = [
            ...toContextNodes([entry(), entry({ subject: '桑桑' })], 1),
            ...toContextNodes([entry({ predicate: '位置', type: 'location', value: '长安' })], 30),
        ];
        const s = summarizeFacts(nodes);
        expect(s.facts).toBe(3);
        expect(s.subjects).toBe(2);
        expect(s.chapters).toEqual({ from: 1, to: 30 });
    });

    it('空输入不产生 NaN', () => {
        expect(summarizeFacts([]).chapters).toEqual({ from: 0, to: 0 });
    });
});

describe('工具函数', () => {
    it('formatFactText 含区间', () => {
        expect(formatFactText(entry(), 3)).toContain('第3章起');
    });

    it('truncate 截断并加省略号', () => {
        expect([...truncate('一二三四五', 3)]).toHaveLength(4);
    });
});

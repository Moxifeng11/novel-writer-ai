/**
 * 知识库单测（C 臂正式接入第一层）
 *
 * 锁四件事：
 *  1. 追加去重（同章同主体同谓词不重复）
 *  2. 检索（主体/类型/章节窗/关键词）
 *  3. **实体状态查询**——「写到第 N 章时该角色是什么状态」是时间线不崩的核心
 *  4. 容错（损坏 JSON 返回 null，不抛错）
 */

import { describe, expect, it } from 'vitest';
import {
    appendFacts,
    createKnowledgeBase,
    factKey,
    parseKnowledgeBase,
    queryFacts,
    stateAt,
    summarizeKnowledgeBase,
    type KnowledgeFact,
} from '../../../../engine/consistency/knowledge-base';
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
        validFrom: 1,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七',
        ...over,
    };
}

/** 造事实 */
function fact(chapter: number, over: Partial<KnowledgeFact> = {}): KnowledgeFact {
    return { ...entry(), chapter, ...over } as KnowledgeFact;
}

describe('appendFacts · 追加与去重', () => {
    it('新事实被追加', () => {
        const kb = createKnowledgeBase('项目A');
        expect(appendFacts(kb, 1, [entry()])).toBe(1);
        expect(kb.facts).toHaveLength(1);
        expect(kb.facts[0].chapter).toBe(1);
    });

    it('同章同主体同谓词不重复追加（重复拆解安全）', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry()]);
        expect(appendFacts(kb, 1, [entry({ value: '十八' })])).toBe(0);
        expect(kb.facts).toHaveLength(1);
    });

    it('不同章节可追加（状态轨迹）', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry()]);
        expect(appendFacts(kb, 20, [entry()])).toBe(1);
        expect(kb.facts).toHaveLength(2);
    });

    it('追加成功才更新 updatedAt', () => {
        const kb = createKnowledgeBase('项目A', new Date(0));
        appendFacts(kb, 1, [entry()]);
        expect(kb.updatedAt).not.toBe(new Date(0).toISOString());
    });
});

describe('factKey', () => {
    it('由主体/谓词/章节构成', () => {
        expect(factKey({ subject: '宁缺', predicate: '年龄', chapter: 3 })).toBe('宁缺|年龄|3');
    });
});

describe('queryFacts · 检索（RAG 基础）', () => {
    const kb = createKnowledgeBase('项目A');
    appendFacts(kb, 1, [
        entry(),
        entry({ type: 'location', subject: '宁缺', predicate: '位置', value: '渭城', quote: '宁缺在渭城' }),
        entry({ type: 'world-rule', subject: '渭城', predicate: '兵力', value: '三百人', quote: '不超过三百人' }),
    ]);
    appendFacts(kb, 20, [entry({ value: '十八', quote: '宁缺今年十八' })]);

    it('按主体检索', () => {
        expect(queryFacts(kb, { subject: '宁缺' }).length).toBeGreaterThanOrEqual(3);
    });

    it('按类型检索', () => {
        expect(queryFacts(kb, { type: 'location' })).toHaveLength(1);
    });

    it('按章节窗口检索', () => {
        const early = queryFacts(kb, { toChapter: 5 });
        expect(early.every(f => f.chapter <= 5)).toBe(true);
    });

    it('按关键词检索（value 或 quote）', () => {
        const hits = queryFacts(kb, { keyword: '渭城' });
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('结果按章节升序', () => {
        const hits = queryFacts(kb, { subject: '宁缺' });
        const chapters = hits.map(f => f.chapter);
        expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    });

    it('limit 生效', () => {
        expect(queryFacts(kb, { subject: '宁缺', limit: 1 })).toHaveLength(1);
    });

    it('无结果返回空数组', () => {
        expect(queryFacts(kb, { subject: '不存在的人' })).toHaveLength(0);
    });
});

describe('stateAt · 实体状态查询（时间线不崩的关键）', () => {
    it('取该章时点有效的状态', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry({ predicate: '位置', type: 'location', value: '渭城', quote: '在渭城' })]);
        appendFacts(kb, 20, [entry({ predicate: '位置', type: 'location', value: '长安', quote: '到长安' })]);
        const at5 = stateAt(kb, '宁缺', 5);
        expect(at5.find(f => f.predicate === '位置')?.value).toBe('渭城');
        const at25 = stateAt(kb, '宁缺', 25);
        expect(at25.find(f => f.predicate === '位置')?.value).toBe('长安');
    });

    it('未来的事实不提前出现（第 20 章的状态不能在第 5 章被看到）', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 20, [entry({ predicate: '修为', type: 'ability', value: '筑基', quote: '筑基了' })]);
        expect(stateAt(kb, '宁缺', 5)).toHaveLength(0);
    });

    it('有效区间已结束的状态不算', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry({ predicate: '持有', type: 'possession', value: '青铜钥匙', validTo: 10, quote: '拿到钥匙' })]);
        expect(stateAt(kb, '宁缺', 5)).toHaveLength(1);
        expect(stateAt(kb, '宁缺', 15)).toHaveLength(0);
    });

    it('同谓词取最晚一条（后来覆盖先前）', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry({ predicate: '位置', type: 'location', value: '渭城', quote: 'a' })]);
        appendFacts(kb, 10, [entry({ predicate: '位置', type: 'location', value: '长安', quote: 'b' })]);
        appendFacts(kb, 20, [entry({ predicate: '位置', type: 'location', value: '洛阳', quote: 'c' })]);
        const state = stateAt(kb, '宁缺', 15);
        expect(state).toHaveLength(1);
        expect(state[0].value).toBe('长安');
    });

    it('其他主体不影响', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry({ subject: '桑桑' })]);
        expect(stateAt(kb, '宁缺', 10)).toHaveLength(0);
    });
});

describe('summarizeKnowledgeBase', () => {
    it('统计事实数/主体数/章节范围/类型分布', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry(), entry({ subject: '桑桑' })]);
        appendFacts(kb, 30, [entry({ subject: '宁缺', predicate: '位置', type: 'location', value: '长安', quote: 'x' })]);
        const s = summarizeKnowledgeBase(kb);
        expect(s.facts).toBe(3);
        expect(s.subjects).toBe(2);
        expect(s.chapters).toEqual({ from: 1, to: 30 });
        expect(s.byType.age).toBe(2);
    });

    it('空库不产生 NaN', () => {
        const s = summarizeKnowledgeBase(createKnowledgeBase('项目A'));
        expect(s.chapters).toEqual({ from: 0, to: 0 });
        expect(s.facts).toBe(0);
    });
});

describe('parseKnowledgeBase · 容错', () => {
    it('合法 JSON 正常解析', () => {
        const kb = createKnowledgeBase('项目A');
        appendFacts(kb, 1, [entry()]);
        const parsed = parseKnowledgeBase(JSON.stringify(kb));
        expect(parsed?.facts).toHaveLength(1);
    });

    it('损坏 JSON → null（不抛错，由调用方决定重建）', () => {
        expect(parseKnowledgeBase('{broken')).toBeNull();
        expect(parseKnowledgeBase('')).toBeNull();
        expect(parseKnowledgeBase('{"facts":null}')).toBeNull();
    });

    it('缺失字段的条目被过滤掉', () => {
        const parsed = parseKnowledgeBase('{"version":1,"project":"A","updatedAt":"x","facts":[{"subject":"宁缺"},null]}');
        expect(parsed?.facts ?? []).toHaveLength(1);
    });
});

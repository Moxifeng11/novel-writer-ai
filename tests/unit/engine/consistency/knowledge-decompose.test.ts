/**
 * 知识库拆解单测（C 臂）
 *
 * 重点锁三件事：
 *  1. **模型输出不可信**——编造 quote、类型越界、confidence 越界都必须被拦住或钳制；
 *  2. **判定留给规则层**——拆解只产条目，不产"这是矛盾"的结论；
 *  3. **合法变化不报**——有效区间不重叠即视为正常演进（进阶/迁移）。
 */

import { describe, expect, it } from 'vitest';
import {
    DECOMPOSE_TYPES,
    buildDecomposePrompt,
    clamp01,
    entriesToAssertions,
    parseDecomposeResponse,
    validRangesConflict,
    type DecomposeEntry,
} from '../../../../engine/consistency/knowledge-decompose';

const BODY = '宁缺今年十七岁。他出身渭城，如今在长安。他记得那场大雪。';

/** 造条目 */
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

describe('prompt 构造', () => {
    it('包含全部类型白名单与章节号', () => {
        const prompt = buildDecomposePrompt(3, BODY);
        expect(prompt).toContain('第 3 章');
        for (const type of DECOMPOSE_TYPES) expect(prompt).toContain(type);
        expect(prompt).toContain('quote');
    });

    it('要求只输出 JSON 并给出结构示例', () => {
        expect(buildDecomposePrompt(1, BODY)).toContain('{"entries"');
    });
});

describe('parseDecomposeResponse · 严格校验', () => {
    it('合法 JSON 正常解析', () => {
        const raw = JSON.stringify({ entries: [entry()] });
        const out = parseDecomposeResponse(raw, BODY);
        expect(out).not.toBeNull();
        expect(out!.entries).toHaveLength(1);
        expect(out!.rejected).toBe(0);
    });

    it('容忍 ```json 包裹与前后废话', () => {
        const raw = '好的，结果如下：\n```json\n' + JSON.stringify({ entries: [entry()] }) + '\n```\n以上。';
        expect(parseDecomposeResponse(raw, BODY)!.entries).toHaveLength(1);
    });

    it('非 JSON → null（不猜）', () => {
        expect(parseDecomposeResponse('我无法完成', BODY)).toBeNull();
        expect(parseDecomposeResponse('', BODY)).toBeNull();
    });

    it('缺 entries 数组 → null', () => {
        expect(parseDecomposeResponse('{"data":[]}', BODY)).toBeNull();
    });

    it('**编造引文被拒绝**（quote 不在正文中）', () => {
        const raw = JSON.stringify({ entries: [entry({ quote: '宁缺今年九十岁' })] });
        const out = parseDecomposeResponse(raw, BODY);
        expect(out!.entries).toHaveLength(0);
        expect(out!.rejected).toBe(1);
    });

    it('类型越界被拒绝', () => {
        const raw = JSON.stringify({ entries: [{ ...entry(), type: 'unknown-type' }] });
        expect(parseDecomposeResponse(raw, BODY)!.entries).toHaveLength(0);
    });

    it('缺 subject/value/quote 被拒绝', () => {
        const raw = JSON.stringify({ entries: [{ ...entry(), subject: '' }, { ...entry(), quote: '' }] });
        const out = parseDecomposeResponse(raw, BODY);
        expect(out!.entries).toHaveLength(0);
        expect(out!.rejected).toBe(2);
    });

    it('confidence 越界被钳制而非丢弃', () => {
        const raw = JSON.stringify({ entries: [{ ...entry(), confidence: 1.8 }] });
        expect(parseDecomposeResponse(raw, BODY)!.entries[0].confidence).toBe(1);
    });

    it('partial 合法：好条目保留、坏条目拒绝', () => {
        const raw = JSON.stringify({ entries: [entry(), { ...entry(), quote: '编造的句子' }] });
        const out = parseDecomposeResponse(raw, BODY);
        expect(out!.entries).toHaveLength(1);
        expect(out!.rejected).toBe(1);
    });
});

describe('clamp01', () => {
    it('钳制到 0–1', () => {
        expect(clamp01(-1)).toBe(0);
        expect(clamp01(2)).toBe(1);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(Number.NaN)).toBe(0);
    });
});

describe('entriesToAssertions · 交给规则层消费', () => {
    it('映射类型到断言 kind，并带引文与数值', () => {
        const [assertion] = entriesToAssertions([entry()], '第3章', 3);
        expect(assertion.kind).toBe('quantitative');
        expect(assertion.source).toBe('llm-decompose');
        expect(assertion.numericValue).toBe(17);
        expect(assertion.unit).toBe('岁');
        expect(assertion.quote).toBe('宁缺今年十七岁');
    });

    it('不同类型的 kind 映射各不相同', () => {
        const entries = [entry({ type: 'memory' }), entry({ type: 'world-rule' }), entry({ type: 'location' })];
        const kinds = entriesToAssertions(entries, '第1章', 1).map(a => a.kind);
        expect(kinds).toEqual(['memory', 'core-rule', 'geographical']);
    });
});

describe('validRangesConflict · 合法变化不报', () => {
    it('两个无终点的互斥值 → 冲突', () => {
        const a = entry({ value: '十七', validTo: null, validFrom: 1 });
        const b = entry({ value: '十八', validTo: null, validFrom: 50 });
        expect(validRangesConflict(a, b)).toBe(true);
    });

    it('**合法进阶**（前段已结束、后段接续）→ 不冲突', () => {
        const before = entry({ subject: '宁缺', predicate: '修为', value: '练气三层', validFrom: 1, validTo: 50 });
        const after = entry({ subject: '宁缺', predicate: '修为', value: '筑基一层', validFrom: 50, validTo: null });
        expect(validRangesConflict(before, after)).toBe(false);
    });

    it('值相同 → 不冲突', () => {
        expect(validRangesConflict(entry(), entry())).toBe(false);
    });

    it('区间部分重叠 → 冲突（同一时间两个互斥值）', () => {
        const a = entry({ value: 'A', validFrom: 1, validTo: 50 });
        const b = entry({ value: 'B', validFrom: 30, validTo: null });
        expect(validRangesConflict(a, b)).toBe(true);
    });
});

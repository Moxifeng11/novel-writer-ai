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
    CANONICAL_PREDICATES,
    DECOMPOSE_TYPES,
    buildDecomposePrompt,
    clamp01,
    entriesToAssertions,
    parseDecomposeResponse,
    validRangesConflict,
    type DecomposeEntry,
} from '../../../../engine/consistency/knowledge-decompose';
import { pairContradictions } from '../../../../engine/consistency/pairing-rules';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

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

describe('规范谓词枚举（根治关键词匹配）', () => {
    it('每类都有唯一规范谓词', () => {
        for (const type of DECOMPOSE_TYPES) {
            expect(CANONICAL_PREDICATES[type]).toBeTruthy();
        }
    });

    it('规范谓词互不重复', () => {
        const values = Object.values(CANONICAL_PREDICATES);
        expect(new Set(values).size).toBe(values.length);
    });

    it('prompt 要求规范谓词与 isCurrentState', () => {
        const prompt = buildDecomposePrompt(3, '正文');
        expect(prompt).toContain('规范谓词');
        expect(prompt).toContain('isCurrentState');
        expect(prompt).toContain('age=年龄');
    });

    it('**模型给自由谓词时归一化为规范值**（不再进规则层当自由文本）', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '宁缺', predicate: '年龄约', value: '十七',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '宁缺今年十七',
        }] });
        const parsed = parseDecomposeResponse(raw, '宁缺今年十七');
        expect(parsed!.entries[0].predicate).toBe('年龄');
    });

    it('isCurrentState=false 被保留（供规则层排除回溯）', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '宁缺', predicate: '年龄', value: '四',
            validFrom: 1, validTo: null, confidence: 0.9,
            quote: '我那年才四岁', isCurrentState: false,
        }] });
        const parsed = parseDecomposeResponse(raw, '我那年才四岁');
        expect(parsed!.entries[0].isCurrentState).toBe(false);
    });

    it('缺省 isCurrentState 视为 true（兼容旧输出）', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '宁缺', predicate: '年龄', value: '十七',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '宁缺今年十七',
        }] });
        expect(parseDecomposeResponse(raw, '宁缺今年十七')!.entries[0].isCurrentState).toBe(true);
    });

    it('条目转断言时带 isCurrentState', () => {
        const entry: DecomposeEntry = {
            type: 'age', subject: '宁缺', predicate: '年龄', value: '四',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '我那年才四岁', isCurrentState: false,
        };
        const [assertion] = entriesToAssertions([entry], '第1章', 1);
        expect(assertion.isCurrentState).toBe(false);
    });
});

describe('event 事件锚（v4.92 修复）', () => {
    it('prompt 要求 event 字段且强调同事件必须一致', () => {
        const prompt = buildDecomposePrompt(3, '正文');
        expect(prompt).toContain('event');
        expect(prompt).toContain('同一事件');
    });

    it('解析保留模型给的 event', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'timeline', subject: '青云试炼', predicate: '时间', value: '三日',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '试炼持续三日',
            event: '青云试炼', isCurrentState: true,
        }] });
        expect(parseDecomposeResponse(raw, '试炼持续三日')!.entries[0].event).toBe('青云试炼');
    });

    it('缺省 event 用「主体·谓词」兜底（兼容旧输出）', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '宁缺', predicate: '年龄', value: '十七',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '宁缺今年十七',
        }] });
        expect(parseDecomposeResponse(raw, '宁缺今年十七')!.entries[0].event).toBe('宁缺·年龄');
    });
});

describe('R5 按事件锚分组（不再按主体）', () => {
    /** 造时长断言 */
    function durationFact(chapter: number, numeric: number, event: string | undefined, quote: string): FactAssertion {
        return {
            id: `d|${chapter}|${numeric}|${event ?? ''}`,
            kind: 'absolute-time',
            subject: '宁缺',
            predicate: '时间',
            value: String(numeric),
            numericValue: numeric,
            unit: '日',
            chapterKey: `第${chapter}章`,
            chapterNum: chapter,
            quote,
            source: 'fact-store',
            extractedAt: 0,
            event,
        };
    }

    it('**同一主体不同事件不互相比时长**（宁缺入楼 vs 苦求）', () => {
        const result = pairContradictions({ assertions: [
            durationFact(88, 17, '宁缺入楼', '入楼十七日'),
            durationFact(98, 3650, '宁缺苦求', '苦求十余年'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'duration')).toBe(false);
    });

    it('同一事件时长不相容仍检出（负例对照）', () => {
        const result = pairContradictions({ assertions: [
            durationFact(10, 3, '青云试炼', '试炼持续三日'),
            durationFact(50, 60, '青云试炼', '试炼历时两个月'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'duration')).toBe(true);
    });

    it('缺 event 的旧数据回退按主体分组（行为不变）', () => {
        const result = pairContradictions({ assertions: [
            durationFact(10, 3, undefined, '试炼持续三日'),
            durationFact(50, 60, undefined, '试炼历时两个月'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'duration')).toBe(true);
    });
});

describe('slot 子维度（200 章评测修复）', () => {
    it('prompt 要求 slot 与归属约束', () => {
        const prompt = buildDecomposePrompt(3, '正文');
        expect(prompt).toContain('slot');
        expect(prompt).toContain('归属约束');
    });

    it('解析保留模型给的 slot', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '大师兄', predicate: '年龄', value: '十三',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '师兄当年十三岁开悟',
            slot: '开悟年龄', event: '大师兄修行往事',
        }] });
        expect(parseDecomposeResponse(raw, '师兄当年十三岁开悟')!.entries[0].slot).toBe('开悟年龄');
    });

    it('缺省 slot 用谓词兜底（兼容旧输出）', () => {
        const raw = JSON.stringify({ entries: [{
            type: 'age', subject: '宁缺', predicate: '年龄', value: '十七',
            validFrom: 1, validTo: null, confidence: 0.9, quote: '宁缺今年十七',
        }] });
        expect(parseDecomposeResponse(raw, '宁缺今年十七')!.entries[0].slot).toBe('年龄');
    });
});

describe('R1/R2 按 slot 分组（不同侧面不可比）', () => {
    /** 造断言 */
    function ageFact(chapter: number, numeric: number, slot: string, quote: string): FactAssertion {
        return {
            id: `f|${chapter}|${numeric}|${slot}`,
            kind: 'quantitative',
            subject: '大师兄',
            predicate: '年龄',
            value: String(numeric),
            numericValue: numeric,
            unit: '岁',
            chapterKey: `第${chapter}章`,
            chapterNum: chapter,
            quote,
            source: 'fact-store',
            extractedAt: 0,
            slot,
        };
    }

    it('**不同 slot 的数值不互相比较**（开悟年龄 vs 入境界年龄）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(128, 13, '开悟年龄', '师兄当年十三岁开悟'),
            ageFact(128, 30, '入境界年龄', '三十岁才进不惑'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(false);
    });

    it('同一 slot 的倒退仍检出（负例对照）', () => {
        const result = pairContradictions({ assertions: [
            ageFact(10, 16, '当前年龄', '他今年十六'),
            ageFact(40, 12, '当前年龄', '他今年十二'),
        ] });
        expect(result.contradictions.some(c => c.kind === 'quantitative')).toBe(true);
    });
});

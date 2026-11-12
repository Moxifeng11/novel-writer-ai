/**
 * LLM 复核层单测（S2 第二半）
 *
 * 重点锁三件事：
 *  1. **成本上限**：疑似配对再多，模型调用次数也必须有界；
 *  2. **不伪造证据**：引文一律来自真实断言，模型输出只影响「是否矛盾 + 理由」；
 *  3. **脏输出不通过**：非 JSON、缺理由、置信度越界都要被丢弃而不是放行。
 */

import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_MAX_PAIRS,
    judgeSuspectedPairs,
    parseJudgeResponse,
} from '../../../../engine/consistency/pairing-llm';
import type { SuspectedPair } from '../../../../engine/consistency/pairing-rules';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

/** 造断言 */
function assertion(overrides: Partial<FactAssertion> = {}): FactAssertion {
    return {
        id: 'id',
        kind: 'nomenclature',
        subject: '张三',
        predicate: '权威名称',
        value: '张三',
        chapterKey: '第5章',
        chapterNum: 5,
        quote: '张三走进院子',
        source: 'digest-fact',
        extractedAt: 0,
        ...overrides,
    };
}

/** 造疑似配对 */
function pair(index = 0): SuspectedPair {
    return {
        kind: 'nomenclature',
        reason: `近似 ${index}`,
        a: assertion({ subject: `张三${index}`, quote: `张三${index}走进院子` }),
        b: assertion({ subject: '张叁', quote: '张叁站在门口', source: 'fact-index', chapterKey: '' }),
    };
}

describe('parseJudgeResponse · 脏输出防御', () => {
    it('标准 JSON', () => {
        const r = parseJudgeResponse('{"contradictory":true,"reasoning":"同名不同人","confidence":0.9}');
        expect(r).toEqual({ contradictory: true, reasoning: '同名不同人', confidence: 0.9 });
    });

    it('带 Markdown 代码块也能解析', () => {
        const r = parseJudgeResponse('```json\n{"contradictory":false,"reasoning":"合理","confidence":0.2}\n```');
        expect(r?.contradictory).toBe(false);
    });

    it('前后有多余文字也能截取 JSON', () => {
        const r = parseJudgeResponse('判断如下：{"contradictory":true,"reasoning":"x","confidence":0.7} 完毕');
        expect(r?.reasoning).toBe('x');
    });

    it('缺 reasoning → null（没有理由不算证据）', () => {
        expect(parseJudgeResponse('{"contradictory":true,"confidence":0.9}')).toBeNull();
        expect(parseJudgeResponse('{"contradictory":true,"reasoning":"   ","confidence":0.9}')).toBeNull();
    });

    it('contradictory 非布尔 → null', () => {
        expect(parseJudgeResponse('{"contradictory":"yes","reasoning":"x","confidence":0.9}')).toBeNull();
    });

    it('概率越界被夹到 [0,1]', () => {
        expect(parseJudgeResponse('{"contradictory":true,"reasoning":"x","confidence":5}')?.confidence).toBe(1);
        expect(parseJudgeResponse('{"contradictory":true,"reasoning":"x","confidence":-3}')?.confidence).toBe(0);
    });

    it('非数字 confidence → null', () => {
        expect(parseJudgeResponse('{"contradictory":true,"reasoning":"x","confidence":"高"}')).toBeNull();
    });

    it('非 JSON → null', () => {
        expect(parseJudgeResponse('这两条是矛盾的')).toBeNull();
        expect(parseJudgeResponse('')).toBeNull();
    });
});

describe('judgeSuspectedPairs · 成本与结果', () => {
    it('确认矛盾时产出证据链，引文来自真实断言', async () => {
        const caller = vi.fn(async () => ({
            content: '{"contradictory":true,"reasoning":"同一角色两个名字","confidence":0.9}',
        }));
        const result = await judgeSuspectedPairs([pair()], { caller });
        expect(result.calls).toBe(1);
        expect(result.contradictions).toHaveLength(1);
        const c = result.contradictions[0];
        expect(c.decidedBy).toBe('llm');
        expect(c.evidenceA.quote).toBe('张三0走进院子');
        expect(c.evidenceB.quote).toBe('张叁站在门口');
    });

    it('模型说不矛盾 → 丢弃且计入 dropped', async () => {
        const caller = async () => ({
            content: '{"contradictory":false,"reasoning":"合理成长","confidence":0.95}',
        });
        const result = await judgeSuspectedPairs([pair()], { caller });
        expect(result.contradictions).toHaveLength(0);
        expect(result.dropped).toBe(1);
    });

    it('置信度低于阈值 → 丢弃', async () => {
        const caller = async () => ({
            content: '{"contradictory":true,"reasoning":"有点像","confidence":0.3}',
        });
        const result = await judgeSuspectedPairs([pair()], { caller, minConfidence: 0.6 });
        expect(result.contradictions).toHaveLength(0);
        expect(result.dropped).toBe(1);
    });

    it('**调用次数受上限约束**（成本硬要求）', async () => {
        let calls = 0;
        const caller = async () => {
            calls++;
            return { content: '{"contradictory":false,"reasoning":"x","confidence":0.9}' };
        };
        const pairs = Array.from({ length: 50 }, (_, i) => pair(i));
        const result = await judgeSuspectedPairs(pairs, { caller, maxPairs: 5 });
        expect(calls).toBe(5);
        expect(result.calls).toBe(5);
    });

    it('默认上限生效', async () => {
        let calls = 0;
        const caller = async () => {
            calls++;
            return { content: '{"contradictory":false,"reasoning":"x","confidence":0.9}' };
        };
        const pairs = Array.from({ length: DEFAULT_MAX_PAIRS + 10 }, (_, i) => pair(i));
        await judgeSuspectedPairs(pairs, { caller });
        expect(calls).toBe(DEFAULT_MAX_PAIRS);
    });

    it('模型抛错不炸，计为丢弃', async () => {
        const caller = async () => {
            throw new Error('网络错误');
        };
        const result = await judgeSuspectedPairs([pair()], { caller });
        expect(result.contradictions).toHaveLength(0);
        expect(result.dropped).toBe(1);
        expect(result.calls).toBe(1);
    });

    it('模型返回 error 字段 → 丢弃', async () => {
        const caller = async () => ({ content: '', error: 'API密钥未配置' });
        const result = await judgeSuspectedPairs([pair()], { caller });
        expect(result.dropped).toBe(1);
    });

    it('空配对列表 → 零调用', async () => {
        const caller = vi.fn(async () => ({ content: '{}' }));
        const result = await judgeSuspectedPairs([], { caller });
        expect(result.calls).toBe(0);
        expect(caller).not.toHaveBeenCalled();
    });
});

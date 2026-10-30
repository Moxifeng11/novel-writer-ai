import { describe, expect, it } from 'vitest';
import { buildQueryPlan, isQueryPlanEmpty, normalizeQuery } from '../../../shared/rag/query-plan';
import { appendWithoutOverlap, mergeNeighborHits, type RagHit } from '../../../shared/rag/neighbors';
import { bigramSimilarity, mmrSelect } from '../../../shared/rag/diversity';
import { packByBudget } from '../../../shared/rag/budget-pack';

function hit(overrides: Partial<RagHit> = {}): RagHit {
    return {
        sample: '样本正文',
        bookId: 'b1',
        bookName: '参考书',
        dimension: 'style',
        score: 0.8,
        ...overrides,
    };
}

describe('rag/query-plan', () => {
    it('多来源拆成带标签的查询，场景优先', () => {
        const plan = buildQueryPlan({
            sceneObjective: '主角在雨夜堵住叛徒',
            previousSceneEnding: '他把刀收进鞘里',
            emotionPlan: '压抑转为爆发',
            outline: '第三章揭示内鬼身份',
            characterNames: ['武昭', '沈青'],
        });
        expect(plan.map((query) => query.label)).toEqual(['当前场景', '情绪弧', '章纲', '出场人物']);
        expect(plan[0].text).toContain('雨夜');
        expect(plan[3].text).toBe('武昭、沈青');
    });

    it('重复文本只保留权重最高的一条', () => {
        const plan = buildQueryPlan({
            sceneObjective: '同一段文本内容',
            outline: '同一段文本内容',
        });
        expect(plan).toHaveLength(1);
        expect(plan[0].label).toBe('当前场景');
    });

    it('过短/空查询被丢弃', () => {
        expect(isQueryPlanEmpty(buildQueryPlan({ outline: '短' }))).toBe(true);
        expect(isQueryPlanEmpty(buildQueryPlan({}))).toBe(true);
    });

    it('超长查询被截断，空白归一化', () => {
        const plan = buildQueryPlan({ outline: `${'很长'.repeat(2000)}` });
        expect(plan[0].text.length).toBeLessThanOrEqual(1200);
        expect(normalizeQuery('a   b，。！？')).toBe('a b。');
    });
});

describe('rag/neighbors', () => {
    it('同书同维度相邻块合并，分数取最高', () => {
        const hits = [
            hit({ position: 10, sample: '前一段结尾。', score: 0.7 }),
            hit({ position: 11, sample: '前一段结尾。下一段开头。', score: 0.9 }),
            hit({ position: 40, sample: '很远的另一段。', score: 0.5 }),
        ];
        const result = mergeNeighborHits(hits);
        expect(result.mergedGroups).toBe(1);
        expect(result.hits).toHaveLength(2);
        expect(result.hits[0].score).toBe(0.9);
        expect(result.hits[0].sample).toContain('下一段开头');
    });

    it('不同书/不同维度的相邻 position 不合并', () => {
        const hits = [
            hit({ position: 1, bookId: 'b1', dimension: 'style' }),
            hit({ position: 2, bookId: 'b2', dimension: 'style' }),
            hit({ position: 2, bookId: 'b1', dimension: 'rhythm' }),
        ];
        expect(mergeNeighborHits(hits).mergedGroups).toBe(0);
    });

    it('无 position 的命中原样保留', () => {
        const hits = [hit({ position: 1 }), hit({ sample: '无位置', score: 0.6 })];
        expect(mergeNeighborHits(hits).hits).toHaveLength(2);
    });

    it('拼接时裁掉重叠前缀', () => {
        expect(appendWithoutOverlap('前面的话重叠部分', '重叠部分后面的话')).toBe('前面的话重叠部分后面的话');
    });
});

describe('rag/diversity — MMR', () => {
    it('2-gram 相似度能识别近重复', () => {
        expect(bigramSimilarity('主角在雨夜堵住叛徒', '主角在雨夜堵住叛徒。')).toBeGreaterThan(0.8);
        expect(bigramSimilarity('主角在雨夜堵住叛徒', '敌人从城墙外发起进攻')).toBeLessThan(0.2);
    });

    it('三条近重复 + 一条相关时，优先选相关的那条', () => {
        const hits = [
            hit({ sample: '雨夜里主角堵住了叛徒，刀锋抵在他的喉咙上。', score: 0.95 }),
            hit({ sample: '雨夜里主角堵住了叛徒，刀锋抵在喉咙上。', score: 0.94 }),
            hit({ sample: '雨夜里主角堵住了叛徒，刀锋抵在他的咽喉。', score: 0.93 }),
            hit({ sample: '叛徒交代了内鬼的身份，主角沉默许久才收刀。', score: 0.8 }),
        ];
        const picked = mmrSelect(hits, 2, { lambda: 0.6 });
        expect(picked).toHaveLength(2);
        expect(picked[0].score).toBe(0.95);
        expect(picked[1].sample).toContain('内鬼');
    });

    it('k 大于候选数或候选为空时安全', () => {
        expect(mmrSelect([], 3)).toEqual([]);
        expect(mmrSelect([hit()], 3)).toHaveLength(1);
    });
});

describe('rag/budget-pack', () => {
    it('预算内全装，超出预算的丢弃并计数', () => {
        const hits = [
            hit({ sample: 'A'.repeat(100), score: 0.9 }),
            hit({ sample: 'B'.repeat(100), score: 0.8 }),
            hit({ sample: 'C'.repeat(100), score: 0.7 }),
        ];
        const packed = packByBudget(hits, 250);
        // 前两条整条装入，第三条用剩余预算截断（不浪费尾预算）
        expect(packed.picked).toHaveLength(3);
        expect(packed.picked[2].sample.length).toBe(50);
        expect(packed.dropped).toBe(0);
        expect(packed.chars).toBe(250);
    });

    it('最高分那条一定被保留（可截断）', () => {
        const packed = packByBudget([hit({ sample: 'X'.repeat(500), score: 0.99 })], 120);
        expect(packed.picked).toHaveLength(1);
        expect(packed.picked[0].sample.length).toBe(120);
    });

    it('零预算返回空且全部计为丢弃', () => {
        expect(packByBudget([hit()], 0)).toEqual({ picked: [], dropped: 1, chars: 0 });
    });
});
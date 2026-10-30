import { describe, expect, it } from 'vitest';
import {
    duplicateRatioOf,
    formatEvalReport,
    overlapSimilarity,
    scoreQuery,
    scoreRetrieval,
    textSimilarity,
    type EvalQuery,
} from '../../../shared/rag/eval-score';

describe('eval-score — 检索质量评分', () => {
    describe('相似度口径', () => {
        it('Jaccard 对长度差敏感，重叠系数能识别「一段包住另一段」', () => {
            const short = '沈青在药铺里收拾药柜，把当归和黄芪分开码好。';
            const long = '沈青在药铺里收拾药柜，把当归和黄芪分开码好，又数了一遍。';
            expect(textSimilarity(short, long)).toBeLessThan(0.9);
            expect(overlapSimilarity(short, long)).toBeGreaterThanOrEqual(0.9);
        });

        it('空文本相似度为 0，不抛错', () => {
            expect(textSimilarity('', 'abc')).toBe(0);
            expect(overlapSimilarity('abc', '')).toBe(0);
        });
    });

    describe('scoreQuery', () => {
        const query: EvalQuery = { id: 'q1', relevant: ['ch1-p0', 'ch1-p2'], ranked: ['ch0-p1', 'ch1-p0', 'ch1-p2'] };

        it('命中与首个命中位次（1-based）', () => {
            const row = scoreQuery(query, 5);
            expect(row.hit).toBe(true);
            expect(row.firstRank).toBe(2);
        });

        it('k 之外的命中算未命中，但 firstRank 仍然给出', () => {
            const deep: EvalQuery = { id: 'q2', relevant: ['x'], ranked: ['a', 'b', 'c', 'd', 'e', 'x'] };
            const rowK5 = scoreQuery(deep, 5);
            expect(rowK5.hit).toBe(false);
            expect(rowK5.firstRank).toBe(6);
            expect(scoreQuery(deep, 6).hit).toBe(true);
        });

        it('完全未命中时 firstRank 为 null', () => {
            const row = scoreQuery({ id: 'q3', relevant: ['nope'], ranked: ['a', 'b'] }, 5);
            expect(row.hit).toBe(false);
            expect(row.firstRank).toBeNull();
        });

        it('缺字段容忍为空数组', () => {
            const row = scoreQuery({ id: 'q4' } as unknown as EvalQuery, 3);
            expect(row.hit).toBe(false);
            expect(row.duplicateRatio).toBe(0);
        });
    });

    describe('duplicateRatioOf', () => {
        it('无 texts 时按 id 判重', () => {
            expect(duplicateRatioOf(['a', 'a', 'b', 'b'])).toBe(0.5);
        });

        it('有 texts 时按重叠相似度判重（第 3 条与前两条近重复）', () => {
            const texts = [
                '武昭拄刀立在断刃城城头，风把雪粒砸在甲片上。',
                '沈青把药箱搁在案上，先取出的是给武昭配的跌打药。',
                '沈青把药箱搁在案上，先取出的是给武昭配的跌打药，又添了两味。',
            ];
            expect(duplicateRatioOf(['p0', 'p1', 'p2'], texts)).toBeCloseTo(1 / 3, 5);
        });

        it('空列表为 0；重复率按「首条不算重复」计（[a,a] → 50%）', () => {
            expect(duplicateRatioOf([])).toBe(0);
            expect(duplicateRatioOf(['a', 'a'])).toBeCloseTo(0.5, 5);
            expect(duplicateRatioOf(['a', 'a', 'a'])).toBeCloseTo(2 / 3, 5);
        });
    });

    describe('scoreRetrieval', () => {
        const queries: EvalQuery[] = [
            { id: 'q1', relevant: ['a'], ranked: ['a', 'b'] },
            { id: 'q2', relevant: ['c'], ranked: ['b', 'c'] },
            { id: 'q3', relevant: ['d'], ranked: ['x', 'y'] },
        ];

        it('汇总 hitRate / MRR / 近重复', () => {
            const report = scoreRetrieval(queries, { k: 2 });
            expect(report.queries).toBe(3);
            expect(report.hitRate).toBeCloseTo(200 / 3, 5);
            // q1 第 1 位、q2 第 2 位、q3 未命中 → (1 + 0.5 + 0) / 3
            expect(report.mrr).toBeCloseTo(0.5, 5);
            expect(report.duplicateRatio).toBe(0);
            expect(report.rows).toHaveLength(3);
        });

        it('空查询集不抛错且指标为 0', () => {
            const report = scoreRetrieval([], { k: 5 });
            expect(report.queries).toBe(0);
            expect(report.hitRate).toBe(0);
            expect(report.mrr).toBe(0);
            expect(report.duplicateRatio).toBe(0);
        });

        it('非法 k 回退默认 5', () => {
            expect(scoreRetrieval(queries, { k: 0 }).k).toBe(5);
            expect(scoreRetrieval(queries, { k: -3 }).k).toBe(5);
        });

        it('textsByQuery 参与近重复统计', () => {
            const report = scoreRetrieval(
                [{ id: 'q9', relevant: ['a'], ranked: ['a', 'a2'] }],
                {
                    k: 2,
                    textsByQuery: {
                        q9: ['北境的雪化了又冻，边军换防的日子往后推了半个月。', '北境的雪化了又冻，边军换防的日子往后推了半个月。'],
                    },
                },
            );
            expect(report.duplicateRatio).toBeCloseTo(0.5, 5);
        });
    });

    it('formatEvalReport 输出一行可比对文本', () => {
        const text = formatEvalReport(scoreRetrieval([{ id: 'q1', relevant: ['a'], ranked: ['a'] }], { k: 5 }));
        expect(text).toContain('queries=1');
        expect(text).toContain('hit@5=100.0%');
        expect(text).toContain('MRR=1.000');
        expect(text).toContain('近重复=0.0%');
    });
});
/**
 * emotion-curve-local.test.ts — 情绪曲线统一走本地、按片段缓存
 *
 * 契约：实时面板（每 2.5 秒一次）不依赖任何 AI 引擎即可产出曲线；
 * 相同片段命中缓存，正文尾部增长只新增新片段的缓存条目。
 * 历史背景：此前的 AI 分支依赖 `enableDetailedAnalysis`，而该开关没有任何 UI
 * 写入方（分支不可达），已连同开关一起删除。
 */
import { describe, it, expect } from 'vitest';
import { EmotionCurveAnalyzer } from '../../../engine/emotion-curve-analyzer';

const JOY_TEXT = '开心'.repeat(400); // 800 字，无标点 → 分段边界固定
const SAD_TAIL = '悲伤'.repeat(150);   // 300 字

type AnalyzerInternals = { segmentCache: Map<string, unknown> };

function makeAnalyzer(): EmotionCurveAnalyzer {
    return new EmotionCurveAnalyzer();
}

describe('EmotionCurveAnalyzer — 本地优先', () => {
    it('不依赖 AI 引擎即可按关键词给出情绪', async () => {
        const analyzer = makeAnalyzer();

        const curve = await analyzer.analyze(JOY_TEXT);

        expect(curve.points).toHaveLength(1);
        expect(curve.points[0].emotion).toBe('joy');
        expect(curve.points[0].intensity).toBeGreaterThan(50);
        expect(curve.dominantEmotion).toBe('joy');
    });

    it('正文不足 100 字时返回空曲线', async () => {
        const analyzer = makeAnalyzer();

        const curve = await analyzer.analyze('太短了');

        expect(curve.points).toHaveLength(0);
        expect(curve.dominantEmotion).toBe('neutral');
    });

    it('空正文返回空曲线（边界）', async () => {
        const analyzer = makeAnalyzer();

        const curve = await analyzer.analyze('');

        expect(curve.points).toHaveLength(0);
        expect(curve.dominantEmotion).toBe('neutral');
    });

    it('相同正文重复分析命中片段缓存，不重复计算', async () => {
        const analyzer = makeAnalyzer();
        const text = JOY_TEXT + JOY_TEXT.slice(0, 400); // 1200 字 → 2 段

        await analyzer.analyze(text);
        const afterFirst = (analyzer as unknown as AnalyzerInternals).segmentCache.size;
        expect(afterFirst).toBe(2);

        await analyzer.analyze(text);
        expect((analyzer as unknown as AnalyzerInternals).segmentCache.size).toBe(afterFirst);
    });

    it('尾部增长只新增新片段，前面片段复用缓存', async () => {
        const analyzer = makeAnalyzer();
        const text = JOY_TEXT + JOY_TEXT.slice(0, 400); // 1200 字 → 2 段

        const first = await analyzer.analyze(text);
        expect((analyzer as unknown as AnalyzerInternals).segmentCache.size).toBe(2);

        const second = await analyzer.analyze(text + SAD_TAIL);
        expect((analyzer as unknown as AnalyzerInternals).segmentCache.size).toBe(3);
        expect(second.points[0].emotion).toBe(first.points[0].emotion);
    });
});

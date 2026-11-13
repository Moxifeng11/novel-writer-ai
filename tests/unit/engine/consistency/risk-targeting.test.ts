/**
 * 风险定位单测（S3）
 *
 * 目的：确认「只审 40% 段落」仍然挑中该看的地方，且判定可解释（reasons）。
 */

import { describe, expect, it } from 'vitest';
import {
    charEntropy,
    coexistingKinds,
    isHighRiskOffset,
    rareCharDensity,
    selectRiskSegments,
    sentenceLengthVariance,
} from '../../../../engine/consistency/risk-targeting';

/** 造一段文本 */
function text(length: number, filler = '他'): string {
    return filler.repeat(length);
}

describe('本地统计量', () => {
    it('重复字文本熵低', () => {
        expect(charEntropy(text(200))).toBeLessThan(0.3);
    });

    it('丰富字文本熵高', () => {
        const rich = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x4e00 + i * 7)).join('');
        expect(charEntropy(rich)).toBeGreaterThan(0.8);
    });

    it('过短文本熵为 0（样本不足不猜）', () => {
        expect(charEntropy('abc')).toBe(0);
        expect(charEntropy('')).toBe(0);
    });

    it('罕见字密度：全是只出现一次的字 → 1', () => {
        expect(rareCharDensity('山水风云雷电')).toBe(1);
    });

    it('罕见字密度：单字反复出现不算罕见（出现次数多）', () => {
        expect(rareCharDensity('山山山山')).toBe(0);
    });

    it('罕见字密度：高频字重复时低', () => {
        // 每个字都出现多次 → 没有「出现 ≤2 次」的字
        expect(rareCharDensity('他他他我我我你你你'.repeat(2))).toBe(0);
    });

    it('句长方差：等长句子为 0', () => {
        expect(sentenceLengthVariance('一二三。四五六。七八九。')).toBe(0);
    });

    it('句长方差：长度差异大时显著', () => {
        expect(sentenceLengthVariance('短。' + '很'.repeat(60) + '。')).toBeGreaterThan(300);
    });

    it('句长方差：单句为 0', () => {
        expect(sentenceLengthVariance('只有一句话')).toBe(0);
    });
});

describe('selectRiskSegments · 中段加权', () => {
    it('长文中段段落分数高于开头/结尾', () => {
        // 3 段 × 800 字：中段 index=1
        const body = text(2400);
        const segments = selectRiskSegments({ chapters: [{ chapterKey: '第1章', body }], segmentSize: 800, coverage: 1 });
        const middle = segments.find(s => s.start === 800);
        const head = segments.find(s => s.start === 0);
        expect(middle).toBeDefined();
        expect(head).toBeDefined();
        expect((middle!.score)).toBeGreaterThan(head!.score);
        expect(middle!.reasons).toContain('位于故事中段');
    });

    it('短文本（单段）也算中段', () => {
        const segments = selectRiskSegments({ chapters: [{ chapterKey: '第1章', body: text(300) }], coverage: 1 });
        expect(segments).toHaveLength(1);
        expect(segments[0].reasons).toContain('位于故事中段');
    });
});

describe('selectRiskSegments · 覆盖率与截断', () => {
    it('覆盖率 40% 时选取长度不超过总长 40%', () => {
        const body = text(4000);
        const picked = selectRiskSegments({ chapters: [{ chapterKey: '第1章', body }], coverage: 0.4 });
        const used = picked.reduce((acc, s) => acc + (s.end - s.start), 0);
        expect(used).toBeLessThanOrEqual(4000 * 0.4 + 1);
        expect(picked.length).toBeGreaterThan(0);
    });

    it('limit 生效', () => {
        const body = text(4000);
        const picked = selectRiskSegments({ chapters: [{ chapterKey: '第1章', body }], limit: 2 });
        expect(picked).toHaveLength(2);
    });

    it('空正文不产出段落', () => {
        expect(selectRiskSegments({ chapters: [{ chapterKey: '第1章', body: '' }] })).toHaveLength(0);
        expect(selectRiskSegments({ chapters: [] })).toHaveLength(0);
    });

    it('多章时按章节顺序返回（便于呈现）', () => {
        const picked = selectRiskSegments({
            chapters: [
                { chapterKey: '第2章', body: text(1600) },
                { chapterKey: '第1章', body: text(1600) },
            ],
            coverage: 1,
        });
        const firstChapterIndex = picked.findIndex(s => s.chapterKey === '第1章');
        const secondChapterIndex = picked.findIndex(s => s.chapterKey === '第2章');
        expect(firstChapterIndex).toBeLessThan(secondChapterIndex);
    });
});

describe('类型共现与偏移命中', () => {
    it('数量不符 → 建议关注命名/外貌', () => {
        expect(coexistingKinds('quantitative')).toContain('nomenclature');
    });

    it('时间类 → 建议关注因果类', () => {
        expect(coexistingKinds('duration')).toContain('causal-violation');
    });

    it('未知类型 → 空', () => {
        expect(coexistingKinds('unknown-kind')).toHaveLength(0);
    });

    it('偏移落在段内才算高风险', () => {
        const segments = [{ chapterKey: '第1章', start: 100, end: 200, score: 0.8, reasons: [] }];
        expect(isHighRiskOffset(segments, '第1章', 150)).toBe(true);
        expect(isHighRiskOffset(segments, '第1章', 250)).toBe(false);
        expect(isHighRiskOffset(segments, '第2章', 150)).toBe(false);
        expect(isHighRiskOffset(segments, '第1章', undefined)).toBe(false);
    });
});

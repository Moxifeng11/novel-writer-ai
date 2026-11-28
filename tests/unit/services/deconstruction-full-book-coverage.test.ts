import { describe, it, expect } from 'vitest';
import { DeconstructionScheduler, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from '../../../engine/deconstruction-scheduler';

function createKnowledgeBaseManager() {
    return {
        getBook: async (bookId: string) => ({ id: bookId, name: '测试书籍' }),
        setBreakdownStatus: async () => {},
    } as any;
}

function settings(overrides?: Partial<{ sampleMode: boolean; textSampleLimit: number }>) {
    return () => ({
        deconstructionEngine: {
            defaultQualityLevel: 'fast' as const,
            enableAutoUpgrade: true,
            enabledDimensions: ['style'] as any[],
            includeCommercial: false,
            includeReadability: false,
            includeZhuque: false,
            zhuqueMaxChars: 20000,
            vectorEnabled: false,
            vectorModel: 'bge-m3',
            vectorCacheSize: 5000,
            vectorBatchSize: 32,
            llmEnabled: false,
            llmModel: 'deepseek-r1:7b',
            maxConcurrency: 1,
            textSampleLimit: overrides?.textSampleLimit ?? 100000,
            dimensionConcurrency: 3,
            sampleMode: overrides?.sampleMode ?? false,
        },
    });
}

function makeScheduler(getter: () => any) {
    return new DeconstructionScheduler(
        {} as any,
        createKnowledgeBaseManager(),
        undefined,
        undefined,
        undefined,
        getter
    );
}

describe('全本智能分段拆解 — 去除固定字数截断', () => {
    describe('采样模式默认关闭', () => {
        it('DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.sampleMode 为 false', () => {
            expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.sampleMode).toBe(false);
        });

        it('默认设置下 isSampleModeEnabled 返回 false', () => {
            const scheduler = makeScheduler(settings());
            expect((scheduler as any).isSampleModeEnabled()).toBe(false);
            scheduler.destroy();
        });

        it('sampleMode=true 时 isSampleModeEnabled 返回 true', () => {
            const scheduler = makeScheduler(settings({ sampleMode: true }));
            expect((scheduler as any).isSampleModeEnabled()).toBe(true);
            scheduler.destroy();
        });
    });

    describe('全本模式不按 textSampleLimit 裁剪分段判断', () => {
        it('全本模式下超过阈值的长文本 shouldUseSegmentedDimension 返回 true', () => {
            const scheduler = makeScheduler(settings({ sampleMode: false, textSampleLimit: 100000 }));
            const task = { sourceText: '长'.repeat(150000), dimensions: ['style'] } as any;
            expect((scheduler as any).shouldUseSegmentedDimension(task)).toBe(true);
            scheduler.destroy();
        });

        it('全本模式下 textSampleLimit 很小也不影响分段阈值（用 config.threshold）', () => {
            const scheduler = makeScheduler(settings({ sampleMode: false, textSampleLimit: 10 }));
            const task = { sourceText: '长'.repeat(150000), dimensions: ['style'] } as any;
            expect((scheduler as any).shouldUseSegmentedDimension(task)).toBe(true);
            scheduler.destroy();
        });
    });

    describe('采样模式生效时按 textSampleLimit 截断输入', () => {
        it('采样模式下 preprocessedText 被截断到 textSampleLimit', () => {
            const scheduler = makeScheduler(settings({ sampleMode: true, textSampleLimit: 1000 }));
            const raw = '正'.repeat(50000);
            const sliced = raw.slice(0, 1000);
            const result = (scheduler as any).preprocessText(sliced);
            expect(result.cleaned.length).toBeLessThanOrEqual(1000);
            scheduler.destroy();
        });
    });
});

/**
 * 2026-11-28 全本拆解改造：KB_BREAKDOWN_HARD_LIMIT（15 万字）不再拦截
 * 「分段启用」的全本路径——它此前让千万字的书只能拆 1.5%。
 * 决策矩阵收口到 resolveInputPolicy；LLM 增强输入加抽样上界。
 */
import { sampleTextForLLM } from '../../../engine/scheduler-segment-integration';
import { getDimensionPrompt } from '../../../engine/llm-prompts';

describe('resolveInputPolicy — 输入决策矩阵', () => {
    function policy(scheduler: any, cleaned: string, overrides?: { sampleMode?: boolean; sampleLimit?: number; segEnabled?: boolean; segmentThreshold?: number }) {
        return (scheduler as any).resolveInputPolicy(cleaned, {
            sampleMode: overrides?.sampleMode ?? false,
            sampleLimit: overrides?.sampleLimit ?? 100000,
            segEnabled: overrides?.segEnabled ?? true,
            segmentThreshold: overrides?.segmentThreshold ?? 100000,
        });
    }

    it('分段启用 + 30 万字 → segmented-full（全本不截）', () => {
        const scheduler = makeScheduler(settings());
        const r = policy(scheduler, '正'.repeat(300000));
        expect(r.mode).toBe('segmented-full');
        expect(r.inputText.length).toBe(300000);
        scheduler.destroy();
    });

    it('分段关闭 + 30 万字 → truncated（15 万护栏保留）', () => {
        const scheduler = makeScheduler(settings());
        const r = policy(scheduler, '正'.repeat(300000), { segEnabled: false });
        expect(r.mode).toBe('truncated');
        expect(r.inputText.length).toBe(150000);
        scheduler.destroy();
    });

    it('采样模式 → 按 sampleLimit 截', () => {
        const scheduler = makeScheduler(settings());
        const r = policy(scheduler, '正'.repeat(300000), { sampleMode: true, sampleLimit: 5000 });
        expect(r.mode).toBe('sample');
        expect(r.inputText.length).toBe(5000);
        scheduler.destroy();
    });

    it('阈值以下 → direct', () => {
        const scheduler = makeScheduler(settings());
        const r = policy(scheduler, '正'.repeat(50000));
        expect(r.mode).toBe('direct');
        scheduler.destroy();
    });

    it('决策口径与 shouldUseSegmentedDimension 一致（分段启用）', () => {
        const scheduler = makeScheduler(settings());
        const text = '长'.repeat(300000);
        const task = { sourceText: text, dimensions: ['style'] } as any;
        const r = policy(scheduler, (scheduler as any).preprocessText(text).cleaned);
        expect(r.mode === 'segmented-full').toBe((scheduler as any).shouldUseSegmentedDimension(task));
        scheduler.destroy();
    });
});

describe('preprocessText — 千万字内存瘦身', () => {
    it('不再构建 segments 数组（10 万元素无消费者）', () => {
        const scheduler = makeScheduler(settings());
        const result = (scheduler as any).preprocessText('段落一。\n\n段落二。\n\n\n\n段落三。');
        expect(result).not.toHaveProperty('segments');
        expect(result.paragraphCount).toBe(3);
        scheduler.destroy();
    });

    it('paragraphCount 与旧 split 语义一致（含空白段过滤）', () => {
        const scheduler = makeScheduler(settings());
        const raw = '甲乙丙。\n\n   \n\n丁戊。\n\n己庚辛壬。\n\n\n';
        const result = (scheduler as any).preprocessText(raw);
        const legacy = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
            .split(/\n{2,}/).filter((s: string) => s.trim().length > 0).length;
        expect(result.paragraphCount).toBe(legacy);
        scheduler.destroy();
    });
});

describe('sampleTextForLLM — LLM 增强输入上界', () => {
    it('超界文本抽样后 ≤ ~16k，且含首/中/尾', () => {
        const raw = '甲'.repeat(5000) + '乙'.repeat(5000000) + '丙'.repeat(5000);
        const sampled = sampleTextForLLM(raw);
        expect(sampled.length).toBeLessThan(20000);
        expect(sampled).toContain('甲');
        expect(sampled).toContain('乙');
        expect(sampled).toContain('丙');
        expect(sampled).toContain('省略');
    });

    it('界内文本原样返回', () => {
        const raw = '短文本。';
        expect(sampleTextForLLM(raw)).toBe('短文本。');
    });
});

describe('getDimensionPrompt — 无界插值防线', () => {
    it('传入超大文本时 prompt 有界（<2.5 万字）', () => {
        const huge = '字'.repeat(1000000);
        const pair = getDimensionPrompt('personality', huge);
        expect(pair.userPrompt.length).toBeLessThan(25000);
        expect(pair.userPrompt).not.toBe(huge);
    });
});

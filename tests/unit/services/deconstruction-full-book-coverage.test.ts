import { describe, it, expect } from 'vitest';
import { DeconstructionScheduler, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from '../../../services/deconstruction-scheduler';

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

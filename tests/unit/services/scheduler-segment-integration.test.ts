import { describe, it, expect } from 'vitest';
import { SchedulerSegmentIntegration } from '../../../services/scheduler-segment-integration';
import type { DeconstructDimension } from '../../../services/deconstruction-worker-manager';

function createMockWorkerManager() {
    return {
        analyzeStyle: async (text: string, onProgress?: (p: number) => void) => {
            onProgress?.(50);
            await new Promise(r => setTimeout(r, 1));
            onProgress?.(100);
            return { dim: 'style', length: text.length, partial: true };
        },
        analyzeStyleWithVector: async (text: string, onProgress?: (p: number) => void) => {
            onProgress?.(50);
            await new Promise(r => setTimeout(r, 1));
            onProgress?.(100);
            return { dim: 'style', vector: true, length: text.length, partial: true };
        },
        analyzeRhythm: async (text: string, onProgress?: (p: number) => void) => {
            onProgress?.(100);
            return { dim: 'rhythm', length: text.length, partial: true };
        },
        analyzeRhythmWithVector: async () => ({ dim: 'rhythm', vector: true, partial: true }),
        analyzeTechnique: async (text: string) => ({ dim: 'technique', length: text.length, partial: true }),
        analyzeTechniqueWithVector: async () => ({ dim: 'technique', vector: true, partial: true }),
        analyzeStructure: async (text: string) => ({ dim: 'structure', length: text.length, partial: true }),
        analyzeStructureWithVector: async () => ({ dim: 'structure', vector: true, partial: true }),
        analyzeCharacter: async (text: string) => ({ dim: 'character', length: text.length, partial: true }),
        analyzeCharacterWithVector: async () => ({ dim: 'character', vector: true, partial: true }),
        analyzeForeshadow: async (text: string) => ({ dim: 'foreshadow', length: text.length, partial: true }),
        analyzeForeshadowWithVector: async () => ({ dim: 'foreshadow', vector: true, partial: true }),
        analyzeCommercial: async (text: string) => ({ dim: 'commercial', length: text.length, partial: true, isPlaceholder: true }),
        analyzeCommercialWithVector: async () => ({ dim: 'commercial', vector: true, partial: true, isPlaceholder: true }),
        analyzeReadability: async (text: string) => ({ dim: 'readability', length: text.length, partial: true, isPlaceholder: true }),
        analyzeReadabilityWithVector: async () => ({ dim: 'readability', vector: true, partial: true, isPlaceholder: true }),
    } as any;
}

describe('SchedulerSegmentIntegration', () => {
    let mockManager: ReturnType<typeof createMockWorkerManager>;
    let integration: SchedulerSegmentIntegration;

    beforeEachInit();

    function beforeEachInit() {
        // placeholder to keep block above
    }

    it('基础结构', () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);
        expect(integration).toBeDefined();
    });

    it('短文本不分段直通', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const result = await integration.analyzeWithSegments<{ dim: string; length: number; partial: boolean }>(
            'style',
            '短文本',
            controller.signal,
        );

        expect(result.totalSegments).toBe(1);
        expect(result.segments.length).toBe(1);
    });

    it('长文本自动分段', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const longText = '测试内容。'.repeat(200);

        const result = await integration.analyzeWithSegments<{ dim: string; length: number; partial: boolean }>(
            'style',
            longText,
            controller.signal,
            { maxDirectWords: 100, maxSegmentWords: 50 },
        );

        expect(result.totalSegments).toBeGreaterThan(1);
    });

    it('章节标题存在时优先按章节分块', async () => {
        const seenTexts: string[] = [];
        mockManager = {
            ...createMockWorkerManager(),
            analyzeStyle: async (text: string) => {
                seenTexts.push(text);
                return { dim: 'style', length: text.length, partial: true };
            },
        } as any;
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const chapterText = ['第1章 开端', '甲'.repeat(80), '第2章 转折', '乙'.repeat(80), '第3章 结尾', '丙'.repeat(80)].join('\n');

        const result = await integration.analyzeWithSegments<{ dim: string; length: number; partial: boolean }>(
            'style',
            chapterText,
            controller.signal,
            { maxDirectWords: 100, maxSegmentWords: 120, useVector: false },
        );

        expect(result.totalSegments).toBeGreaterThan(1);
        expect(seenTexts.some(text => text.includes('第2章 转折'))).toBe(true);
        expect(seenTexts.some(text => text.includes('第3章 结尾'))).toBe(true);
    });

    it('shouldSegment 判断正确', () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        expect(integration.shouldSegment('短', { maxDirectWords: 100 })).toBe(false);
        expect(integration.shouldSegment('字'.repeat(200), { maxDirectWords: 100 })).toBe(true);
    });

    it('estimateSegments 估算正确', () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        expect(integration.estimateSegments('短', { maxDirectWords: 100, maxSegmentWords: 50 })).toBe(1);
        expect(integration.estimateSegments('字'.repeat(200), { maxDirectWords: 100, maxSegmentWords: 50 })).toBe(4);
    });

    it('支持所有 6 个维度', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const dimensions: DeconstructDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];

        for (const dim of dimensions) {
            const controller = new AbortController();
            const result = await integration.analyzeWithSegments<{ dim: string }>(
                dim,
                '测试',
                controller.signal,
            );
            expect(result.totalSegments).toBe(1);
        }
    });

    it('不支持的维度抛出错误', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        await expect(
            integration.analyzeWithSegments<unknown>(
                'unknown-dim' as DeconstructDimension,
                '文本',
                controller.signal,
            )
        ).rejects.toThrow('不支持的维度');
    });

    it('onSegmentProgress 被调用（长文本）', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const longText = '内容文字。'.repeat(100);

        const segmentProgresses: number[] = [];

        await integration.analyzeWithSegments(
            'style',
            longText,
            controller.signal,
            {
                maxDirectWords: 100,
                maxSegmentWords: 30,
                onSegmentProgress: (dim, idx, total, prog) => {
                    segmentProgresses.push(prog);
                },
            },
        );

        expect(segmentProgresses.length).toBeGreaterThan(0);
    });

    it('onOverallProgress 被调用', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const longText = '内容文字。'.repeat(100);

        const overallProgresses: number[] = [];

        await integration.analyzeWithSegments(
            'style',
            longText,
            controller.signal,
            {
                maxDirectWords: 100,
                maxSegmentWords: 30,
                onOverallProgress: (dim, prog) => {
                    overallProgresses.push(prog);
                },
            },
        );

        expect(overallProgresses.length).toBeGreaterThan(0);
    });

    it('向量模式使用 WithVector handler', async () => {
        mockManager = createMockWorkerManager();
        integration = new SchedulerSegmentIntegration(mockManager);

        const controller = new AbortController();
        const result = await integration.analyzeWithSegments<{ dim: string; vector?: boolean }>(
            'style',
            '短',
            controller.signal,
            { useVector: true },
        );

        expect(result.segments[0].vector).toBe(true);
    });

    it('取消时抛出错误', async () => {
        const manager = {
            ...createMockWorkerManager(),
            analyzeStyle: async (text: string) => {
                await new Promise(r => setTimeout(r, 30));
                return { dim: 'style', length: text.length, partial: true };
            },
        } as any;
        integration = new SchedulerSegmentIntegration(manager);

        const controller = new AbortController();
        const longText = '内容。'.repeat(100);

        const promise = integration.analyzeWithSegments(
            'style',
            longText,
            controller.signal,
            { maxDirectWords: 50, maxSegmentWords: 20 },
        );

        await new Promise(r => setTimeout(r, 10));
        controller.abort();

        await expect(promise).rejects.toThrow();
    });
});

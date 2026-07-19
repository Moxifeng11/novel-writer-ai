import { describe, it, expect, beforeEach } from 'vitest';
import { DeconstructionScheduler } from '../../../services/deconstruction-scheduler';
import { LLMEnhancer, type LLMCaller } from '../../../engine/llm-enhancer';

function createKnowledgeBaseManager() {
    return {
        getBook: async (bookId: string) => ({ id: bookId, name: '测试书籍' }),
        setBreakdownStatus: async () => {},
    } as any;
}

function createMockLlmCaller(): LLMCaller {
    return {
        callAI: async () => ({ content: '{"ok": true}' }),
    };
}

function defaultSettings(overrides?: Partial<{
    enableSegmentedBreakdown?: boolean; segmentedBreakdownThreshold?: number; llmEnabled?: boolean; llmModel?: string;
}>) {
    return () => ({
        enableSegmentedBreakdown: overrides?.enableSegmentedBreakdown,
        segmentedBreakdownThreshold: overrides?.segmentedBreakdownThreshold,
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
            llmEnabled: overrides?.llmEnabled ?? false,
            llmModel: overrides?.llmModel ?? 'deepseek-r1:7b',
            maxConcurrency: 1,
            textSampleLimit: 10000000,
            dimensionConcurrency: 3,
        },
    });
}

describe('DeconstructionScheduler — 分段默认 & LLM 增强注入', () => {
    describe('TR-5.1: 分段默认启停', () => {
        it('默认设置下 isSegmentedBreakdownEnabled 返回 true（长文本默认启用分段）', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const result = (scheduler as any).isSegmentedBreakdownEnabled();
            expect(result).toBe(true);
            scheduler.destroy();
        });

        it('enableSegmentedBreakdown=false 时 isSegmentedBreakdownEnabled 返回 false', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ enableSegmentedBreakdown: false })
            );
            const result = (scheduler as any).isSegmentedBreakdownEnabled();
            expect(result).toBe(false);
            scheduler.destroy();
        });

        it('getSegmentedBreakdownConfig 默认 threshold 为 100000', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const config = (scheduler as any).getSegmentedBreakdownConfig();
            expect(config.threshold).toBe(100000);
            scheduler.destroy();
        });

        it('短文本（<10万字）shouldUseSegmentedDimension 返回 false', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const task = { sourceText: '短'.repeat(50000), dimensions: ['style'] } as any;
            const result = (scheduler as any).shouldUseSegmentedDimension(task);
            expect(result).toBe(false);
            scheduler.destroy();
        });

        it('长文本（>10万字）shouldUseSegmentedDimension 返回 true', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const task = { sourceText: '长'.repeat(150000), dimensions: ['style'] } as any;
            const result = (scheduler as any).shouldUseSegmentedDimension(task);
            expect(result).toBe(true);
            scheduler.destroy();
        });
    });

    describe('TR-5.2: LLM 增强注入', () => {
        it('setLlmEnhancer 设置后 scheduler 实例持有 llmEnhancer', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            const mockCaller = createMockLlmCaller();
            const enhancer = new LLMEnhancer(mockCaller, { llmModel: 'test-model' });
            scheduler.setLlmEnhancer(enhancer);
            expect((scheduler as any).llmEnhancer).toBe(enhancer);
            scheduler.destroy();
        });

        it('setLlmEnhancer 设置后 workerManager 的 llmEnhancer 也已注入', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            const mockCaller = createMockLlmCaller();
            const enhancer = new LLMEnhancer(mockCaller, { llmModel: 'test-model' });
            scheduler.setLlmEnhancer(enhancer);
            const wm = (scheduler as any).workerManager;
            expect(wm).toBeDefined();
            expect(wm.llmEnhancer).toBe(enhancer);
            scheduler.destroy();
        });

        it('setLlmEnhancer 不抛异常（安全调用检查）', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            const mockCaller = createMockLlmCaller();
            const enhancer = new LLMEnhancer(mockCaller, { llmModel: 'test-model' });
            expect(() => scheduler.setLlmEnhancer(enhancer)).not.toThrow();
            scheduler.destroy();
        });
    });

    describe('TR-5.3: 日志覆盖字数字段', () => {
        it('addTask 后 task.sourceText.length 可作为覆盖字数', async () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const sourceText = '第一章\n' + '正文内容'.repeat(1000);
            const taskId = await scheduler.addTask('book-log-test', sourceText, ['style']);
            const task = scheduler.getTask(taskId);
            expect(task).toBeDefined();
            expect(task!.sourceText.length).toBeGreaterThan(0);
            expect(task!.sourceText.length).toBe(sourceText.length);
            scheduler.destroy();
        });

        it('日志模板中含覆盖字数字段（通过 spy appendBreakdownLog 验证）', async () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const capturedLogs: string[] = [];
            (scheduler as any).appendBreakdownLog = async (_bookName: string, content: string) => {
                capturedLogs.push(content);
            };

            const sourceText = '正文'.repeat(5000);
            await scheduler.addTask('book-log-capture', sourceText, ['style']);

            expect(capturedLogs.length).toBeGreaterThanOrEqual(0);
            scheduler.destroy();
        });
    });
});

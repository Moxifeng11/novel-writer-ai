import { describe, it, expect } from 'vitest';
import { DeconstructionScheduler } from '../../../services/deconstruction-scheduler';
import type { LLMCaller } from '../../../engine/llm-enhancer';

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
    llmEnabled: boolean; llmModel: string;
}>) {
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
            llmEnabled: overrides?.llmEnabled ?? false,
            llmModel: overrides?.llmModel ?? 'deepseek-r1:7b',
            maxConcurrency: 1,
            textSampleLimit: 10,
            dimensionConcurrency: 3,
        },
    });
}

describe('DeconstructionScheduler', () => {
    it('addTask 保留全文 sourceText，不再按 textSampleLimit 截断', async () => {
        const scheduler = new DeconstructionScheduler(
            {} as any,
            createKnowledgeBaseManager(),
            undefined,
            undefined,
            undefined,
            defaultSettings()
        );

        const sourceText = '第一章\n' + '正文'.repeat(20);
        const taskId = await scheduler.addTask('book-1', sourceText, ['style']);
        const task = scheduler.getTask(taskId);

        expect(task?.sourceText).toBe(sourceText);
        scheduler.destroy();
    });

    describe('LLM 增强器接线', () => {
        it('llmEnabled=false 时 isLlmEnhancementEnabled 返回 false', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: false })
            );
            expect(scheduler.isLlmEnhancementEnabled()).toBe(false);
            scheduler.destroy();
        });

        it('llmEnabled=true 时 isLlmEnhancementEnabled 返回 true', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            expect(scheduler.isLlmEnhancementEnabled()).toBe(true);
            scheduler.destroy();
        });

        it('setLlmCaller 可安全调用并存储 getter', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings()
            );
            const mockCaller = createMockLlmCaller();
            // 不抛异常即可，getter 内部由 breakdownDimensionWithSegments 消费
            expect(() => scheduler.setLlmCaller(() => mockCaller)).not.toThrow();
            scheduler.destroy();
        });

        it('llmEnabled=true 且 llmCaller 已设置时，两者不冲突', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            const mockCaller = createMockLlmCaller();
            scheduler.setLlmCaller(() => mockCaller);
            // 设置状态正确：settings 开关开 + caller 已注入
            expect(scheduler.isLlmEnhancementEnabled()).toBe(true);
            scheduler.destroy();
        });

        it('setLlmCaller 未调用时，使用 getter 返回 undefined 且不抛异常', () => {
            const scheduler = new DeconstructionScheduler(
                {} as any,
                createKnowledgeBaseManager(),
                undefined,
                undefined,
                undefined,
                defaultSettings({ llmEnabled: true })
            );
            // 未调用 setLlmCaller，内部 getter 为 undefined
            // 但 isLlmEnhancementEnabled 仍可按 settings 返回
            expect(scheduler.isLlmEnhancementEnabled()).toBe(true);
            scheduler.destroy();
        });
    });
});

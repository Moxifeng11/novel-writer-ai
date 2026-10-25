import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
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

    describe('向量样本来源', () => {
        const PARAGRAPH = '雨落在青石板上，檐角的灯笼被风吹得摇摇欲坠，他抬手护住火光，继续往巷子深处走去，脚下的水声渐渐盖过了身后的呼喊。';

        async function seedBook(vault: Vault) {
            await vault.createFolder('写作知识库');
            await vault.createFolder('写作知识库/测试书');
            const sourceText = Array.from({ length: 6 }, () => PARAGRAPH).join('\n');
            await vault.create('写作知识库/测试书/测试书.txt', sourceText);
            const reportFiles: Array<[string, string]> = [
                ['风格指纹.json', `第一段风格说明，长句与短句交替，画面感来自雨声与灯火的对比，节奏偏慢。\n\n第二段风格说明，收束多用短句，避免动词堆叠，情绪留在留白里。`],
                ['节奏分析.md', `开篇节奏偏慢，用环境铺陈建立压迫感，第三段开始加速，冲突集中在中段。\n\n结尾回落，留一个未解决的悬念，避免情绪一次性耗尽。`],
                ['写作技巧.md', `动作描写拆成三段：抬手、护住火光、继续前行，每段只写一个动作，避免合成一句。\n\n对话技巧：用打断和沉默替代解释，让读者从反应里推断情绪。`],
                ['结构拆解.md', `起：雨夜归巷，交代地点与目的。\n\n承：巷子深处传来呼喊，主角犹豫后继续前进。`],
                ['人设提取.md', `主角克制，遇事先护住手里的光，再做判断，不轻易回应身后的呼喊。\n\n配角急噪，习惯用喊声确认对方位置，情绪外露。`],
                ['伏笔库.md', `巷子尽头的灯影反复出现，暗示有人提前等在那里。\n\n被护住的火光与后文的火场呼应，回收点应在第二卷。`],
            ];
            for (const [name, content] of reportFiles) {
                await vault.create(`写作知识库/测试书/${name}`, content);
            }
            return sourceText;
        }

        it('有原文时同时写入原文分块与拆解报告六个维度', async () => {
            const vault = new Vault();
            const sourceText = await seedBook(vault);

            let captured: Array<{ dimension: string }> = [];
            const store = {
                addBookSamples: async () => { throw new Error('应走 replaceBookSamples'); },
                replaceBookSamples: async (_bookId: string, _bookName: string, samples: Array<{ dimension: string }>) => {
                    captured = samples;
                },
            };
            const scheduler = new DeconstructionScheduler(
                { vault } as any,
                { getSourceText: async () => sourceText, getBook: async (bookId: string) => ({ id: bookId, name: '测试书' }) } as any,
                { baseDir: '写作知识库' },
                store as any
            );

            await (scheduler as any).vectorizeBook('book-1', '测试书');
            scheduler.destroy();

            const dimensions = new Set(captured.map(s => s.dimension));
            expect(dimensions.has('original')).toBe(true);
            for (const dimension of ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow']) {
                expect(dimensions.has(dimension)).toBe(true);
            }
        });
    });
});

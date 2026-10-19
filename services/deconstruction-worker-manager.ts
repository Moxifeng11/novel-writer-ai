/**
 * deconstruction-worker-manager.ts — 拆解 Worker 管理器
 *
 * 功能：
 * - 封装 WorkerManager，专门用于拆解任务
 * - 提供 12 个便捷方法（6 个维度 × 2 种模式）
 * - 自动降级：Worker 不可用时回退到主线程执行
 * - 支持取消单个任务和全部任务
 *
 * 设计说明：
 * - 由于 esbuild 单文件打包限制，默认使用主线程降级模式
 * - 如果环境支持 Worker 且配置了 workerUrl，则使用 Worker 模式
 * - 降级模式下直接实例化拆解器并调用，保证功能完整性
 */

import { WorkerManager } from './worker-manager';
import { createLogger } from '../shared/logger';
import { VectorEnhancer } from '../engine/vector-enhancer';
import { LLMEnhancer } from '../engine/llm-enhancer';
import { StyleDeconstructor, StyleAnalysisResult } from '../engine/deconstructors/style-deconstructor';
import { RhythmDeconstructor, RhythmAnalysisResult } from '../engine/deconstructors/rhythm-deconstructor';
import { TechniqueDeconstructor, TechniqueAnalysisResult } from '../engine/deconstructors/technique-deconstructor';
import { StructureDeconstructor, StructureAnalysisResult } from '../engine/deconstructors/structure-deconstructor';
import { CharacterDeconstructor, CharacterAnalysisResult } from '../engine/deconstructors/character-deconstructor';
import { ForeshadowDeconstructor, ForeshadowAnalysisResult } from '../engine/deconstructors/foreshadow-deconstructor';
import { CommercialDeconstructor, CommercialAnalysisResult } from '../engine/deconstructors/commercial-deconstructor';
import { ReadabilityDeconstructor, ReadabilityAnalysisResult } from '../engine/deconstructors/readability-deconstructor';
import { AntiAIDetector } from '../engine/anti-ai-detector';

const log = createLogger('DeconstructionWorkerManager');

export type DeconstructDimension = 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'commercial' | 'readability';

export interface DeconstructionWorkerManagerOptions {
    maxWorkers?: number;
    workerUrl?: string;
    useWorker?: boolean;
}

interface CancelablePromise<T> extends Promise<T> {
    cancel: () => void;
}

export class DeconstructionWorkerManager {
    private workerManager: WorkerManager | null = null;
    private options: Required<Omit<DeconstructionWorkerManagerOptions, 'workerUrl'>> & { workerUrl?: string };

    private styleDeconstructor: StyleDeconstructor | null = null;
    private rhythmDeconstructor: RhythmDeconstructor | null = null;
    private techniqueDeconstructor: TechniqueDeconstructor | null = null;
    private structureDeconstructor: StructureDeconstructor | null = null;
    private characterDeconstructor: CharacterDeconstructor | null = null;
    private foreshadowDeconstructor: ForeshadowDeconstructor | null = null;
    private commercialDeconstructor: CommercialDeconstructor | null = null;
    private readabilityDeconstructor: ReadabilityDeconstructor | null = null;

    private vectorEnhancer: VectorEnhancer | null = null;
    private llmEnhancer: LLMEnhancer | null = null;
    private useWorkerMode: boolean = false;
    private destroyed: boolean = false;

    constructor(
        vectorEnhancer?: VectorEnhancer,
        options?: DeconstructionWorkerManagerOptions
    ) {
        this.options = {
            maxWorkers: options?.maxWorkers ?? 2,
            useWorker: options?.useWorker ?? true,
            workerUrl: options?.workerUrl ?? 'workers/deconstruction-worker.js',
        };

        this.vectorEnhancer = vectorEnhancer || null;
        this.initMainThreadDeconstructors();
        this.initWorkerManager();
    }

    private initMainThreadDeconstructors(): void {
        this.styleDeconstructor = new StyleDeconstructor(this.vectorEnhancer || undefined);
        this.rhythmDeconstructor = new RhythmDeconstructor(this.vectorEnhancer || undefined);
        this.techniqueDeconstructor = new TechniqueDeconstructor(this.vectorEnhancer || undefined);
        this.structureDeconstructor = new StructureDeconstructor(this.vectorEnhancer || undefined);
        this.characterDeconstructor = new CharacterDeconstructor(this.vectorEnhancer || undefined);
        this.foreshadowDeconstructor = new ForeshadowDeconstructor(this.vectorEnhancer || undefined);
        this.commercialDeconstructor = new CommercialDeconstructor(this.vectorEnhancer || undefined);
        this.readabilityDeconstructor = new ReadabilityDeconstructor(this.vectorEnhancer || undefined);
        if (this.llmEnhancer) {
            this.styleDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.rhythmDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.characterDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.foreshadowDeconstructor.setLLMEnhancer(this.llmEnhancer);
        }
    }

    private initWorkerManager(): void {
        if (!this.options.useWorker) {
            log.info('Worker 模式未启用，使用主线程模式');
            this.useWorkerMode = false;
            return;
        }

        try {
            this.workerManager = new WorkerManager({
                maxWorkers: this.options.maxWorkers,
                fallbackToMain: true,
                workerUrl: this.options.workerUrl,
            });

            this.registerFallbackHandlers();
            this.useWorkerMode = this.workerManager.isWorkerAvailable();

            if (this.useWorkerMode) {
                log.info('Worker 模式初始化成功');
            } else {
                log.warn('Worker 不可用，自动降级到主线程模式');
            }
        } catch (e) {
            log.warn('WorkerManager 初始化失败，降级到主线程模式:', e);
            this.useWorkerMode = false;
            this.workerManager = null;
        }
    }

    private registerFallbackHandlers(): void {
        if (!this.workerManager) return;

        this.workerManager.registerFallbackHandler('deconstruct:style', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.styleDeconstructor!.analyze(input.text),
                onProgress,
                '风格分析'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:style:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.styleDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '风格分析（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:rhythm', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.rhythmDeconstructor!.analyze(input.text),
                onProgress,
                '节奏分析'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:rhythm:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.rhythmDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '节奏分析（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:technique', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.techniqueDeconstructor!.analyze(input.text),
                onProgress,
                '写作技巧分析'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:technique:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.techniqueDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '写作技巧分析（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:structure', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.structureDeconstructor!.analyze(input.text),
                onProgress,
                '结构拆解'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:structure:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.structureDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '结构拆解（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:character', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.characterDeconstructor!.analyze(input.text),
                onProgress,
                '人设提取'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:character:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.characterDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '人设提取（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:foreshadow', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.foreshadowDeconstructor!.analyze(input.text),
                onProgress,
                '伏笔梳理'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:foreshadow:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.foreshadowDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '伏笔梳理（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:commercial', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.commercialDeconstructor!.analyze(input.text),
                onProgress,
                '商业价值分析'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:commercial:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.commercialDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '商业价值分析（向量增强）'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:readability', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.readabilityDeconstructor!.analyze(input.text),
                onProgress,
                '可读性分析'
            );
        });

        this.workerManager.registerFallbackHandler('deconstruct:readability:vector', (input, onProgress) => {
            return this.executeWithProgress(
                () => this.readabilityDeconstructor!.analyzeWithVector(input.text),
                onProgress,
                '可读性分析（向量增强）'
            );
        });
    }

    private async executeWithProgress<T>(
        fn: () => T | Promise<T>,
        onProgress?: (progress: number, message?: string) => void,
        taskName: string = '任务'
    ): Promise<T> {
        onProgress?.(0, `开始${taskName}...`);
        const result = await fn();
        onProgress?.(100, `${taskName}完成`);
        return result;
    }

    isWorkerAvailable(): boolean {
        return this.useWorkerMode && this.workerManager?.isWorkerAvailable() === true;
    }

    setVectorEnhancer(vectorEnhancer?: VectorEnhancer): void {
        this.vectorEnhancer = vectorEnhancer || null;
        this.styleDeconstructor = new StyleDeconstructor(this.vectorEnhancer || undefined);
        this.rhythmDeconstructor = new RhythmDeconstructor(this.vectorEnhancer || undefined);
        this.techniqueDeconstructor = new TechniqueDeconstructor(this.vectorEnhancer || undefined);
        this.structureDeconstructor = new StructureDeconstructor(this.vectorEnhancer || undefined);
        this.characterDeconstructor = new CharacterDeconstructor(this.vectorEnhancer || undefined);
        this.foreshadowDeconstructor = new ForeshadowDeconstructor(this.vectorEnhancer || undefined);
        this.commercialDeconstructor = new CommercialDeconstructor(this.vectorEnhancer || undefined);
        this.readabilityDeconstructor = new ReadabilityDeconstructor(this.vectorEnhancer || undefined);
        if (this.llmEnhancer) {
            this.styleDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.rhythmDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.characterDeconstructor.setLLMEnhancer(this.llmEnhancer);
            this.foreshadowDeconstructor.setLLMEnhancer(this.llmEnhancer);
        }
    }

    setLlmEnhancer(llmEnhancer: LLMEnhancer): void {
        this.llmEnhancer = llmEnhancer;
        this.styleDeconstructor?.setLLMEnhancer(llmEnhancer);
        this.rhythmDeconstructor?.setLLMEnhancer(llmEnhancer);
        this.characterDeconstructor?.setLLMEnhancer(llmEnhancer);
        this.foreshadowDeconstructor?.setLLMEnhancer(llmEnhancer);
    }

    analyzeStyle(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('deconstruct:style', text, onProgress);
    }

    analyzeStyleWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('deconstruct:style:vector', text, onProgress);
    }

    analyzeRhythm(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<RhythmAnalysisResult> {
        return this.executeTask('deconstruct:rhythm', text, onProgress);
    }

    analyzeRhythmWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<RhythmAnalysisResult> {
        return this.executeTask('deconstruct:rhythm:vector', text, onProgress);
    }

    analyzeTechnique(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<TechniqueAnalysisResult> {
        return this.executeTask('deconstruct:technique', text, onProgress);
    }

    analyzeTechniqueWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<TechniqueAnalysisResult> {
        return this.executeTask('deconstruct:technique:vector', text, onProgress);
    }

    analyzeStructure(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StructureAnalysisResult> {
        return this.executeTask('deconstruct:structure', text, onProgress);
    }

    analyzeStructureWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StructureAnalysisResult> {
        return this.executeTask('deconstruct:structure:vector', text, onProgress);
    }

    analyzeCharacter(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<CharacterAnalysisResult> {
        return this.executeTask('deconstruct:character', text, onProgress);
    }

    analyzeCharacterWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<CharacterAnalysisResult> {
        return this.executeTask('deconstruct:character:vector', text, onProgress);
    }

    analyzeForeshadow(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<ForeshadowAnalysisResult> {
        return this.executeTask('deconstruct:foreshadow', text, onProgress);
    }

    analyzeForeshadowWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<ForeshadowAnalysisResult> {
        return this.executeTask('deconstruct:foreshadow:vector', text, onProgress);
    }

    analyzeCommercial(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<CommercialAnalysisResult> {
        return this.executeTask('deconstruct:commercial', text, onProgress);
    }

    analyzeCommercialWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<CommercialAnalysisResult> {
        return this.executeTask('deconstruct:commercial:vector', text, onProgress);
    }

    analyzeReadability(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<ReadabilityAnalysisResult> {
        return this.executeTask('deconstruct:readability', text, onProgress);
    }

    analyzeReadabilityWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<ReadabilityAnalysisResult> {
        return this.executeTask('deconstruct:readability:vector', text, onProgress);
    }

    private executeTask<T>(
        taskType: string,
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<T> {
        if (this.destroyed) {
            const promise = Promise.reject(new Error('DeconstructionWorkerManager has been destroyed')) as CancelablePromise<T>;
            promise.cancel = () => {};
            return promise;
        }

        if (this.useWorkerMode && this.workerManager) {
            // R2: Worker 是独立 bundle，主线程设置的扩充词无法自动抵达，
            // 因此随任务载荷下发（空数组时不带该字段，载荷与改造前一致）。
            const extraAiWords = AntiAIDetector.getExtraHighFreqWords();
            return this.workerManager.executeTask<{ text: string; antiAiWords?: string[] }, T>(
                taskType,
                extraAiWords.length > 0 ? { text, antiAiWords: extraAiWords } : { text },
                onProgress
            ) as CancelablePromise<T>;
        }

        return this.executeMainThreadTask<T>(taskType, text, onProgress);
    }

    private executeMainThreadTask<T>(
        taskType: string,
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<T> {
        let cancelled = false;

        const promise = new Promise<T>(async (resolve, reject) => {
            try {
                const taskMap: Record<string, () => any> = {
                    'deconstruct:style': () => this.styleDeconstructor!.analyze(text),
                    'deconstruct:style:vector': () => this.styleDeconstructor!.analyzeWithVector(text),
                    'deconstruct:rhythm': () => this.rhythmDeconstructor!.analyze(text),
                    'deconstruct:rhythm:vector': () => this.rhythmDeconstructor!.analyzeWithVector(text),
                    'deconstruct:technique': () => this.techniqueDeconstructor!.analyze(text),
                    'deconstruct:technique:vector': () => this.techniqueDeconstructor!.analyzeWithVector(text),
                    'deconstruct:structure': () => this.structureDeconstructor!.analyze(text),
                    'deconstruct:structure:vector': () => this.structureDeconstructor!.analyzeWithVector(text),
                    'deconstruct:character': () => this.characterDeconstructor!.analyze(text),
                    'deconstruct:character:vector': () => this.characterDeconstructor!.analyzeWithVector(text),
                    'deconstruct:foreshadow': () => this.foreshadowDeconstructor!.analyze(text),
                    'deconstruct:foreshadow:vector': () => this.foreshadowDeconstructor!.analyzeWithVector(text),
                    'deconstruct:commercial': () => this.commercialDeconstructor!.analyze(text),
                    'deconstruct:commercial:vector': () => this.commercialDeconstructor!.analyzeWithVector(text),
                    'deconstruct:readability': () => this.readabilityDeconstructor!.analyze(text),
                    'deconstruct:readability:vector': () => this.readabilityDeconstructor!.analyzeWithVector(text),
                };

                const fn = taskMap[taskType];
                if (!fn) {
                    throw new Error(`Unknown task type: ${taskType}`);
                }

                if (cancelled) {
                    throw new Error('Task cancelled');
                }

                onProgress?.(0, '⚠️ 主线程模式 — 开始分析...');

                const result = await fn();

                if (cancelled) {
                    throw new Error('Task cancelled');
                }

                onProgress?.(100, '分析完成');
                resolve(result as T);
            } catch (error) {
                reject(error);
            }
        }) as CancelablePromise<T>;

        promise.cancel = () => {
            cancelled = true;
        };

        return promise;
    }

    cancelAll(): void {
        if (this.workerManager) {
            this.workerManager.cancelAll();
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.cancelAll();

        if (this.workerManager) {
            this.workerManager.destroy();
            this.workerManager = null;
        }

        this.styleDeconstructor = null;
        this.rhythmDeconstructor = null;
        this.techniqueDeconstructor = null;
        this.structureDeconstructor = null;
        this.characterDeconstructor = null;
        this.foreshadowDeconstructor = null;
        this.commercialDeconstructor = null;
        this.readabilityDeconstructor = null;
        this.vectorEnhancer = null;

        log.info('DeconstructionWorkerManager 已销毁');
    }

}

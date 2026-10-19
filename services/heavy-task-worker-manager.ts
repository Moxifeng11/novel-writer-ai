import { WorkerManager } from './worker-manager';
import { createLogger } from '../shared/logger';
import { getDegradationNotifier } from '../shared/degradation-notifier';
import { VectorEnhancer } from '../engine/vector-enhancer';
import { StyleDeconstructor, StyleAnalysisResult } from '../engine/deconstructors/style-deconstructor';
import { StyleDeconstructorV2, StyleAnalysisResultV2 } from '../engine/style/style-deconstructor-v2';
import { QualityScoreEngine, QualityScore, EvaluationContext } from '../engine/quality/quality-score-engine';
import { DeviationDetector, DeviationReport, DeviationContext } from '../engine/quality/deviation-detector';
import { CharacterConsistencyChecker } from '../engine/character-consistency-checker';
import { PlotDivergenceEngine } from '../engine/plot-divergence-engine';

const log = createLogger('HeavyTaskWorkerManager');

export interface HeavyTaskWorkerManagerOptions {
    maxWorkers?: number;
    useWorker?: boolean;
}

interface CancelablePromise<T> extends Promise<T> {
    cancel: () => void;
}

export class HeavyTaskWorkerManager {
    private workerManager: WorkerManager | null = null;
    private useWorkerMode: boolean = false;
    private destroyed: boolean = false;

    private styleDeconstructor: StyleDeconstructor | null = null;
    private styleDeconstructorV2: StyleDeconstructorV2 | null = null;
    private qualityScoreEngine: QualityScoreEngine | null = null;
    private deviationDetector: DeviationDetector | null = null;

    constructor(options?: HeavyTaskWorkerManagerOptions) {
        const useWorker = options?.useWorker ?? true;
        const maxWorkers = options?.maxWorkers ?? 2;

        this.initMainThreadEngines();

        if (useWorker) {
            try {
                this.workerManager = new WorkerManager({
                    maxWorkers,
                    fallbackToMain: true,
                });

                this.registerFallbackHandlers();
                this.useWorkerMode = this.workerManager.isWorkerAvailable();

                if (this.useWorkerMode) {
                    log.info('HeavyTaskWorkerManager 初始化成功（Worker 模式）');
                } else {
                    log.warn('HeavyTaskWorkerManager Worker 不可用，降级到主线程模式');
                }
            } catch (e) {
                log.warn('HeavyTaskWorkerManager 初始化失败，降级到主线程模式:', e);
                this.useWorkerMode = false;
                this.workerManager = null;
            }
        } else {
            this.useWorkerMode = false;
            log.info('HeavyTaskWorkerManager 使用主线程模式');
        }
    }

    private initMainThreadEngines(): void {
        this.styleDeconstructor = new StyleDeconstructor();
        this.styleDeconstructorV2 = new StyleDeconstructorV2();
        // 注入纯计算分析器（characterChecker）。rhythmAnalyzer / emotionAnalyzer
        // 依赖 AIEngine，会将 AI 调用引入统计快路径，与"快速统计评估"设计相悖，故保持未注入。
        this.qualityScoreEngine = new QualityScoreEngine({
            characterChecker: new CharacterConsistencyChecker(),
        });
        this.checkQualityEngineInjection();
        this.deviationDetector = new DeviationDetector({
            plotDivergenceEngine: new PlotDivergenceEngine(),
            characterChecker: new CharacterConsistencyChecker(),
        });
        this.checkDeviationDetectorInjection();
    }

    /** 检查 QualityScoreEngine 的条件分析器注入状态 */
    private checkQualityEngineInjection(): void {
        const qe = this.qualityScoreEngine as any;
        const qeMissing = ['rhythmAnalyzer', 'emotionAnalyzer', 'characterChecker'].filter((k) => !qe[k]);
        if (qeMissing.length > 0) {
            log.warn(
                `[质量引擎] 条件分析器未注入: ${qeMissing.join(', ')}（依赖主线程 AI 能力），相关维度使用内置规则`
            );
            getDegradationNotifier().notify({
                source: 'injection',
                from: 'full',
                to: 'keyword_stats',
                reason: `QualityScoreEngine 条件分析器未注入: ${qeMissing.join(', ')}`,
                severity: 'warning',
                recoverable: false,
            });
        }
    }

    /** 检查 DeviationDetector 的条件分析器注入状态 */
    private checkDeviationDetectorInjection(): void {
        const dd = this.deviationDetector as any;
        const ddMissing = ['plotDivergenceEngine', 'characterChecker', 'rhythmAnalyzer'].filter((k) => !dd[k]);
        if (ddMissing.length > 0) {
            log.warn(
                `[偏离检测引擎] 条件分析器未注入: ${ddMissing.join(', ')}（依赖主线程 AI 能力），相关维度使用内置规则`
            );
            getDegradationNotifier().notify({
                source: 'injection',
                from: 'full',
                to: 'keyword_stats',
                reason: `DeviationDetector 条件分析器未注入: ${ddMissing.join(', ')}`,
                severity: 'warning',
                recoverable: false,
            });
        }
    }

    private registerFallbackHandlers(): void {
        if (!this.workerManager) return;

        this.workerManager.registerFallbackHandler('style:analyze', async (input, onProgress) => {
            onProgress?.(0, '开始风格分析');
            const result = await this.styleDeconstructor!.analyze(input.text);
            onProgress?.(100, '风格分析完成');
            return result;
        });

        this.workerManager.registerFallbackHandler('style:analyze:vector', (input, onProgress) => {
            onProgress?.(0, '开始风格分析（向量增强）');
            return this.styleDeconstructor!.analyzeWithVector(input.text).then((result) => {
                onProgress?.(100, '风格分析完成（向量增强）');
                return result;
            });
        });

        this.workerManager.registerFallbackHandler('style:analyze:v2', async (input, onProgress) => {
            onProgress?.(0, '开始风格分析 V2');
            const result = await this.styleDeconstructorV2!.analyze(input.text);
            onProgress?.(100, '风格分析 V2 完成');
            return result;
        });

        this.workerManager.registerFallbackHandler('quality:evaluate', (input, onProgress) => {
            onProgress?.(0, '开始质量评分');
            return this.qualityScoreEngine!.evaluate(input.text, input.context).then((result) => {
                onProgress?.(100, '质量评分完成');
                return result;
            });
        });

        this.workerManager.registerFallbackHandler('deviation:detect', (input, onProgress) => {
            onProgress?.(0, '开始偏离检测');
            return this.deviationDetector!.detect(input.text, input.context).then((result) => {
                onProgress?.(100, '偏离检测完成');
                return result;
            });
        });
    }

    analyzeStyle(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('style:analyze', { text }, onProgress);
    }

    analyzeStyleWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('style:analyze:vector', { text }, onProgress);
    }

    analyzeStyleV2(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResultV2> {
        return this.executeTask('style:analyze:v2', { text }, onProgress);
    }

    evaluateQuality(
        text: string,
        context: EvaluationContext,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<QualityScore> {
        return this.executeTask('quality:evaluate', { text, context }, onProgress);
    }

    detectDeviation(
        text: string,
        context: DeviationContext,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<DeviationReport> {
        return this.executeTask('deviation:detect', { text, context }, onProgress);
    }

    private executeTask<T>(
        taskType: string,
        input: any,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<T> {
        if (this.destroyed) {
            const promise = Promise.reject(new Error('HeavyTaskWorkerManager has been destroyed')) as CancelablePromise<T>;
            promise.cancel = () => {};
            return promise;
        }

        if (this.useWorkerMode && this.workerManager) {
            return this.workerManager.executeTask(taskType, input, onProgress) as CancelablePromise<T>;
        }

        return this.executeMainThreadTask(taskType, input, onProgress);
    }

    private executeMainThreadTask<T>(
        taskType: string,
        input: any,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<T> {
        let cancelled = false;

        const promise = new Promise<T>(async (resolve, reject) => {
            try {
                const taskMap: Record<string, () => any> = {
                    'style:analyze': () => this.styleDeconstructor!.analyze(input.text),
                    'style:analyze:vector': () => this.styleDeconstructor!.analyzeWithVector(input.text),
                    'style:analyze:v2': () => this.styleDeconstructorV2!.analyze(input.text),
                    'quality:evaluate': () => this.qualityScoreEngine!.evaluate(input.text, input.context),
                    'deviation:detect': () => this.deviationDetector!.detect(input.text, input.context),
                };

                const fn = taskMap[taskType];
                if (!fn) {
                    throw new Error(`Unknown task type: ${taskType}`);
                }

                if (cancelled) {
                    throw new Error('Task cancelled');
                }

                const result = await fn();

                if (cancelled) {
                    throw new Error('Task cancelled');
                }

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

    isWorkerAvailable(): boolean {
        return this.useWorkerMode && this.workerManager?.isWorkerAvailable() === true;
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
        log.info('HeavyTaskWorkerManager 已销毁');
    }

    /**
     * M1（技术审计）：EngineRegistry 的 Disposable 契约只认 dispose()，
     * 原类仅有 destroy() 导致 disposeAll() 无法清理 Worker 池。
     * dispose 作为契约入口，内部复用幂等的 destroy()。
     */
    dispose(): void {
        this.destroy();
    }
}
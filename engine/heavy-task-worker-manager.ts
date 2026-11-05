import { WorkerManager } from '@/services/worker-manager';
import { createLogger } from '@/shared/logger';
import { getDegradationNotifier } from '@/shared/degradation-notifier';
import { notifyWorkerUnavailable } from '@/shared/plugin-worker-url';
import { VectorEnhancer } from './vector-enhancer';
import { StyleDeconstructor, StyleAnalysisResult } from './deconstructors/style-deconstructor';
import { QualityScoreEngine, QualityScore, EvaluationContext } from './quality/quality-score-engine';
import { getScopedPlotDivergenceEngine, getScopedWritingQualityEngine } from './quality/quality-engine-factory';
import { DeviationDetector, DeviationReport, DeviationContext } from './quality/deviation-detector';
import { CharacterConsistencyChecker } from './character-consistency-checker';


const log = createLogger('HeavyTaskWorkerManager');

/**
 * 重任务 Worker 管理器选项。
 */
export interface HeavyTaskWorkerManagerOptions {
    maxWorkers?: number;
    useWorker?: boolean;
    /** Worker 脚本绝对 URL；缺省时直接使用主线程模式 */
    workerUrl?: string;
}

interface CancelablePromise<T> extends Promise<T> {
    cancel: () => void;
}

/**
 * 重任务 Worker 管理器。
 */
export class HeavyTaskWorkerManager {
    private workerManager: WorkerManager | null = null;
    private useWorkerMode: boolean = false;
    private destroyed: boolean = false;

    private styleDeconstructor: StyleDeconstructor | null = null;
    private qualityScoreEngine: QualityScoreEngine | null = null;
    private deviationDetector: DeviationDetector | null = null;

    constructor(options?: HeavyTaskWorkerManagerOptions) {
        const useWorker = options?.useWorker ?? true;
        const maxWorkers = options?.maxWorkers ?? 2;
        const workerUrl = options?.workerUrl;

        this.initMainThreadEngines();

        if (useWorker && !workerUrl) {
            this.useWorkerMode = false;
            log.warn('未解析到 Worker 资源路径，使用主线程模式');
            notifyWorkerUnavailable('未找到重任务 Worker 资源（workers/quality-worker.js）');
            return;
        }

        if (useWorker && workerUrl) {
            try {
                this.workerManager = new WorkerManager({
                    maxWorkers,
                    fallbackToMain: true,
                    workerUrl,
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
        // C1: QSE 只保留 V1 统一内核，六维与总分全部来自 WritingQualityEngine；
        // rhythmAnalyzer / emotionAnalyzer / characterChecker 注入后不会生效，这里不再注入。
        // 人物逐条比对由下面的 DeviationDetector 负责。
        this.qualityScoreEngine = new QualityScoreEngine({
            v1Engine: getScopedWritingQualityEngine('heavy-task'),
        });
        this.deviationDetector = new DeviationDetector({
            plotDivergenceEngine: getScopedPlotDivergenceEngine('heavy-task'),
            characterChecker: new CharacterConsistencyChecker(),
        });
        this.checkDeviationDetectorInjection();
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

    /**
     * 文风拆解。
     *
     * @param text - 文本内容
     * @param onProgress - 参数
     * @returns 结果
     */
    analyzeStyle(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('style:analyze', { text }, onProgress);
    }

    /**
     * 带向量增强的文风拆解。
     *
     * @param text - 文本内容
     * @param onProgress - 参数
     * @returns 结果
     */
    analyzeStyleWithVector(
        text: string,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<StyleAnalysisResult> {
        return this.executeTask('style:analyze:vector', { text }, onProgress);
    }

    /**
     * 质量评估。
     *
     * @param text - 文本内容
     * @param context - 上下文
     * @param onProgress - 参数
     * @returns 结果
     */
    evaluateQuality(
        text: string,
        context: EvaluationContext,
        onProgress?: (progress: number, message?: string) => void
    ): CancelablePromise<QualityScore> {
        return this.executeTask('quality:evaluate', { text, context }, onProgress);
    }

    /**
     * 偏离检测。
     *
     * @param text - 文本内容
     * @param context - 上下文
     * @param onProgress - 参数
     * @returns 结果
     */
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

    /**
     * Worker 是否可用。
     * @returns 布尔值
     */
    isWorkerAvailable(): boolean {
        return this.useWorkerMode && this.workerManager?.isWorkerAvailable() === true;
    }

    /**
     * 取消全部任务。
     */
    cancelAll(): void {
        if (this.workerManager) {
            this.workerManager.cancelAll();
        }
    }

    /**
     * 销毁管理器。
     */
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
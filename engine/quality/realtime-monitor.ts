/**
 * quality/realtime-monitor.ts — 实时监控总控制器（实时监控 V2 Task 3）
 *
 * 职责：
 *   1. 协调 QualityScoreEngine（六维评分）+ DeviationDetector（偏离检测）
 *   2. 事件总线：start / complete / failed / cancelled
 *   3. 状态机：idle → evaluating → success/failed/cancelled → idle
 *   4. 并发保护：evaluate 时若状态非 idle，返回 'busy'
 *   5. 支持取消：AbortSignal 透传到子引擎
 *
 * 降级策略：
 *   - score 失败 → 仅返回 deviations + 标记 partialFailure
 *   - deviation 失败 → 仅返回 score + 标记 partialFailure
 *   - 都失败 → 返回空报告 + error 事件
 *
 * 设计原则：
 *   - 零外部依赖
 *   - 外科手术式：不修改 QualityScoreEngine / DeviationDetector
 *   - 依赖注入：所有外部依赖通过构造函数传入
 */

import type { QualityScoreEngine, QualityScore, EvaluationContext } from './quality-score-engine';
import type { DeviationDetector, DeviationReport, DeviationContext } from './deviation-detector';
import { createLogger } from '../../shared/logger';


const log = createLogger('RealtimeMonitor');
// ============================================================
// 一、状态机与事件
// ============================================================

export type MonitorState = 'idle' | 'evaluating' | 'success' | 'failed' | 'cancelled';

export type MonitorEventType =
    | 'state-change'   // 状态变更
    | 'start'           // 评估开始
    | 'complete'        // 评估成功
    | 'failed'          // 评估失败
    | 'cancelled';      // 评估取消

export interface MonitorEvent<T = unknown> {
    type: MonitorEventType;
    timestamp: number;
    /** 当前状态 */
    state: MonitorState;
    /** 评估 ID（一次 evaluate 调用对应一个） */
    evaluationId?: string;
    /** 评估结果（complete 事件携带） */
    result?: MonitorResult;
    /** 错误信息（failed 事件携带） */
    error?: string;
    /** 附加数据 */
    data?: T;
}

export type MonitorEventHandler = (event: MonitorEvent) => void;

// ============================================================
// 二、监控结果模型
// ============================================================

export interface MonitorContext {
    projectId: string;
    chapterId: string;
    /** 评估上下文（透传给 QualityScoreEngine） */
    qualityContext?: EvaluationContext;
    /** 偏离上下文（透传给 DeviationDetector） */
    deviationContext?: DeviationContext;
    /** 是否跳过偏离检测（默认 false） */
    skipDeviations?: boolean;
    /** 是否跳过质量评分（默认 false） */
    skipQuality?: boolean;
}

export interface MonitorResult {
    evaluationId: string;
    projectId: string;
    chapterId: string;
    timestamp: number;
    /** 质量评分（若跳过或失败则为 undefined） */
    qualityScore?: QualityScore;
    /** 偏离检测（若跳过或失败则为 undefined） */
    deviations?: DeviationReport;
    /** 总评估耗时 */
    durationMs: number;
    /** 文本字数 */
    wordCount: number;
    /** 内容 hash */
    contentHash: string;
    /** 是否部分失败 */
    partialFailure: boolean;
    /** 失败说明（partialFailure=true 时给出） */
    failures?: string[];
    /** 是否被取消 */
    cancelled: boolean;
    /** 是否命中缓存（来自 QualityScoreEngine） */
    fromCache: boolean;
}

// ============================================================
// 三、RealtimeMonitor 主类
// ============================================================

export class RealtimeMonitor {
    private readonly scoreEngine: QualityScoreEngine;
    private readonly deviationDetector: DeviationDetector;

    /** 当前状态 */
    private state: MonitorState = 'idle';
    /** 当前评估的 AbortController */
    private currentAbort?: AbortController;
    /**
     * 外部 signal 上的 abort 监听。正常结束/取消时必须移除：
     * 长生命周期 signal（视图级 controller）会跨多次评估复用，不移除会累积闭包。
     */
    private externalAbortListener?: { signal: AbortSignal; handler: () => void };
    /** 当前评估 ID */
    private currentEvaluationId?: string;
    /** 事件订阅者 */
    private subscribers: Map<MonitorEventType, Set<MonitorEventHandler>> = new Map();

    constructor(options: {
        scoreEngine: QualityScoreEngine;
        deviationDetector: DeviationDetector;
    }) {
        this.scoreEngine = options.scoreEngine;
        this.deviationDetector = options.deviationDetector;
    }

    // ----------------------------------------------------------
    // 状态查询
    // ----------------------------------------------------------

    /** 获取当前状态 */
    getState(): MonitorState {
        return this.state;
    }

    /** 是否正在评估 */
    isEvaluating(): boolean {
        return this.state === 'evaluating';
    }

    /** 当前评估 ID（无评估时为 undefined） */
    getCurrentEvaluationId(): string | undefined {
        return this.currentEvaluationId;
    }

    // ----------------------------------------------------------
    // 事件订阅
    // ----------------------------------------------------------

    /** 订阅事件 */
    on(eventType: MonitorEventType, handler: MonitorEventHandler): () => void {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Set());
        }
        this.subscribers.get(eventType)!.add(handler);
        // 返回取消订阅函数
        return () => this.off(eventType, handler);
    }

    /** 取消订阅 */
    off(eventType: MonitorEventType, handler: MonitorEventHandler): void {
        const set = this.subscribers.get(eventType);
        if (set) {
            set.delete(handler);
        }
    }

    /** 订阅所有事件 */
    onAll(handler: MonitorEventHandler): () => void {
        const unsubscribers = (['state-change', 'start', 'complete', 'failed', 'cancelled'] as MonitorEventType[])
            .map(type => this.on(type, handler));
        return () => unsubscribers.forEach(u => u());
    }

    /** 发布事件 */
    private emit(event: MonitorEvent): void {
        // 类型特定订阅者
        const set = this.subscribers.get(event.type);
        if (set) {
            for (const handler of set) {
                try {
                    handler(event);
                } catch (e) {
                    log.warn('[RealtimeMonitor] 事件处理器异常', e);
                }
            }
        }
    }

    /** 设置状态（带事件发射） */
    private setState(newState: MonitorState, evaluationId?: string): void {
        const oldState = this.state;
        this.state = newState;
        if (evaluationId !== undefined) {
            this.currentEvaluationId = evaluationId;
        }
        this.emit({
            type: 'state-change',
            timestamp: Date.now(),
            state: newState,
            evaluationId: this.currentEvaluationId,
            data: { oldState },
        });
    }

    // ----------------------------------------------------------
    // 评估主流程
    // ----------------------------------------------------------

    /**
     * 执行评估
     * - 若当前正在评估 → 抛错 'busy'
     * - 返回完整结果（含 score + deviations）
     */
    async evaluate(
        text: string,
        context: MonitorContext,
        externalSignal?: AbortSignal
    ): Promise<MonitorResult> {
        // 并发保护
        if (this.state === 'evaluating') {
            throw new Error('busy: monitor is already evaluating');
        }

        // 生成评估 ID
        const evaluationId = `${context.projectId}::${context.chapterId}::${Date.now()}`;
        const startTime = Date.now();
        const wordCount = this.countWords(text);
        const contentHash = this.hashText(text);

        // 创建内部 AbortController，便于取消
        const internalAbort = new AbortController();
        this.currentAbort = internalAbort;

        // 监听外部 signal
        if (externalSignal) {
            if (externalSignal.aborted) {
                // 未进入 evaluating，只需清掉内部 controller，避免残留
                this.currentAbort = undefined;
                this.handleCancel(evaluationId, context, startTime, wordCount, contentHash);
                return this.buildCancelledResult(evaluationId, context, startTime, wordCount, contentHash);
            }
            const handler = () => internalAbort.abort();
            externalSignal.addEventListener('abort', handler, { once: true });
            this.externalAbortListener = { signal: externalSignal, handler };
        }

        // 进入评估状态
        this.setState('evaluating', evaluationId);
        this.emit({
            type: 'start',
            timestamp: Date.now(),
            state: 'evaluating',
            evaluationId,
            data: { projectId: context.projectId, chapterId: context.chapterId, wordCount },
        });

        const failures: string[] = [];
        let qualityScore: QualityScore | undefined;
        let deviations: DeviationReport | undefined;

        // 并行执行（除非显式跳过）
        const tasks: Promise<void>[] = [];

        if (!context.skipQuality) {
            tasks.push(
                this.scoreEngine
                    .evaluate(text, context.qualityContext, internalAbort.signal)
                    .then(score => {
                        qualityScore = score;
                    })
                    .catch(e => {
                        if (this.isAbortError(e)) {
                            throw e; // 取消异常向上抛
                        }
                        failures.push(`quality: ${String(e?.message || e)}`);
                    })
            );
        }

        if (!context.skipDeviations) {
            tasks.push(
                this.deviationDetector
                    .detect(text, context.deviationContext || ({} as DeviationContext), internalAbort.signal)
                    .then(report => {
                        deviations = report;
                    })
                    .catch(e => {
                        if (this.isAbortError(e)) {
                            throw e;
                        }
                        failures.push(`deviations: ${String(e?.message || e)}`);
                    })
            );
        }

        // 等待所有任务完成
        try {
            await Promise.allSettled(tasks);
        } catch (e) {
            // 取消异常 → 处理取消
            if (this.isAbortError(e)) {
                return this.handleCancel(evaluationId, context, startTime, wordCount, contentHash);
            }
            // 其他异常 → 记录
            failures.push(`unknown: ${String(e)}`);
        }

        // 检查内部 signal 是否被取消
        if (internalAbort.signal.aborted) {
            return this.handleCancel(evaluationId, context, startTime, wordCount, contentHash);
        }

        // 构建结果
        const durationMs = Date.now() - startTime;
        const allFailed = !qualityScore && !deviations;
        // partialFailure 仅在"有失败但至少一个成功"时为 true
        const partialFailure = !allFailed && failures.length > 0;

        const result: MonitorResult = {
            evaluationId,
            projectId: context.projectId,
            chapterId: context.chapterId,
            timestamp: Date.now(),
            qualityScore,
            deviations,
            durationMs,
            wordCount,
            contentHash,
            partialFailure,
            // 全部失败时也要返回原因：否则 UI 只能靠「质量 --」猜，无法区分
            // 「正文过短、暂不评估」与「评分 + 偏离都挂了」。
            failures: failures.length > 0 ? failures : undefined,
            cancelled: false,
            fromCache: qualityScore?.fromCache ?? false,
        };

        // 完成状态
        if (allFailed) {
            this.setState('failed', evaluationId);
            this.emit({
                type: 'failed',
                timestamp: Date.now(),
                state: 'failed',
                evaluationId,
                error: failures.join('; '),
            });
        } else {
            this.setState('success', evaluationId);
            this.emit({
                type: 'complete',
                timestamp: Date.now(),
                state: 'success',
                evaluationId,
                result,
            });
        }

        // 回到 idle
        this.cleanup();

        return result;
    }

    /** 主动取消当前评估 */
    cancel(): void {
        if (this.currentAbort) {
            this.currentAbort.abort();
        }
    }

    /** 处理取消逻辑 */
    private handleCancel(
        evaluationId: string,
        context: MonitorContext,
        startTime: number,
        wordCount: number,
        contentHash: string
    ): MonitorResult {
        const result: MonitorResult = {
            evaluationId,
            projectId: context.projectId,
            chapterId: context.chapterId,
            timestamp: Date.now(),
            durationMs: Date.now() - startTime,
            wordCount,
            contentHash,
            partialFailure: false,
            cancelled: true,
            fromCache: false,
        };
        this.setState('cancelled', evaluationId);
        this.emit({
            type: 'cancelled',
            timestamp: Date.now(),
            state: 'cancelled',
            evaluationId,
        });
        this.cleanup();
        return result;
    }

    /** 构建取消时的结果 */
    private buildCancelledResult(
        evaluationId: string,
        context: MonitorContext,
        startTime: number,
        wordCount: number,
        contentHash: string
    ): MonitorResult {
        return {
            evaluationId,
            projectId: context.projectId,
            chapterId: context.chapterId,
            timestamp: Date.now(),
            durationMs: Date.now() - startTime,
            wordCount,
            contentHash,
            partialFailure: false,
            cancelled: true,
            fromCache: false,
        };
    }

    /**
     * 移除外部 signal 上的 abort 监听。
     * 视图级 controller 会在多次评估间复用，不移除会累积闭包。
     */
    private detachExternalAbort(): void {
        if (!this.externalAbortListener) return;
        const { signal, handler } = this.externalAbortListener;
        signal.removeEventListener('abort', handler);
        this.externalAbortListener = undefined;
    }

    /** 清理内部状态 */
    private cleanup(): void {
        this.detachExternalAbort();
        this.currentAbort = undefined;
        // 异步回 idle（同步会引起事件顺序问题）
        // 这里直接同步 setState(idle)，但保留 evaluationId 以便最后一个事件可读
        this.setState('idle');
        this.currentEvaluationId = undefined;
    }

    // ----------------------------------------------------------
    // 工具方法
    // ----------------------------------------------------------

    /** 判断是否 AbortError */
    private isAbortError(e: unknown): boolean {
        if (!e) return false;
        if (e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'))) {
            return true;
        }
        return false;
    }

    /** 简易字数统计（中文按字，英文按词） */
    private countWords(text: string): number {
        if (!text) return 0;
        // 中文字符
        const cjkCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        // 英文单词
        const enCount = (text.match(/[a-zA-Z]+/g) || []).length;
        // 数字
        const digitCount = (text.match(/\d+/g) || []).length;
        return cjkCount + enCount + digitCount;
    }

    /** 简易文本 hash（FNV-1a） */
    private hashText(text: string): string {
        if (!text) return '';
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
    }

    // ----------------------------------------------------------
    // 配置与重置
    // ----------------------------------------------------------

    /** 重置状态（用于异常恢复） */
    reset(): void {
        this.detachExternalAbort();
        this.currentAbort = undefined;
        this.currentEvaluationId = undefined;
        this.setState('idle');
    }

    /** 销毁（中止在途评估并清理订阅） */
    dispose(): void {
        // 只清引用会让引擎继续算完并把结果推给已分离的 UI
        this.currentAbort?.abort();
        this.detachExternalAbort();
        this.subscribers.clear();
        this.currentAbort = undefined;
        this.currentEvaluationId = undefined;
        this.state = 'idle';
    }
}

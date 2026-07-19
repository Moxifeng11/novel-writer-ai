import { createLogger } from './logger';

const log = createLogger('ProgressEmitter');
/**
 * progress-emitter.ts — 统一进度状态模型与事件发射器
 *
 * 功能：
 * - 统一的进度状态模型（pending / running / paused / completed / failed / cancelled）
 * - 事件订阅/取消订阅机制
 * - 步骤管理（注册步骤、推进步骤、步骤进度）
 * - 时间统计（已用时间、ETA 预估）
 * - 节流控制（进度更新最多 10 次/秒，状态变化立即发送）
 * - AbortSignal 集成（支持取消操作）
 *
 * 设计原则：
 * - 纯 TypeScript，零依赖（不依赖 Obsidian API）
 * - 状态不可变，每次更新生成新状态快照
 * - 节流仅针对进度数值更新，状态跃迁不受限制
 */

// ============================================================
// 1. 类型定义
// ============================================================

/** 进度状态枚举 */
export type ProgressStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** 单个步骤的进度信息 */
export interface ProgressStep {
    name: string;
    status: ProgressStatus;
    progress: number;
    message?: string;
}

/** 完整进度状态快照 */
export interface ProgressState {
    id: string;
    name: string;
    status: ProgressStatus;
    progress: number;
    currentStep?: string;
    message?: string;
    elapsed: number;
    eta?: number;
    etaMin?: number;
    etaMax?: number;
    error?: string;
    steps?: ProgressStep[];
}

/** 进度事件回调函数类型 */
export type ProgressCallback = (state: ProgressState) => void;

// ============================================================
// 2. ProgressEmitter 类
// ============================================================

/**
 * 进度事件发射器
 *
 * 提供统一的进度状态管理和事件通知机制，支持：
 * - 基本进度更新
 * - 多步骤进度管理
 * - 时间统计与 ETA 预估
 * - 节流控制（避免频繁 UI 重绘）
 * - AbortSignal 取消支持
 *
 * @example
 * ```ts
 * const emitter = new ProgressEmitter('task-1', '生成章节');
 * const off = emitter.on((state) => {
 *     log.info(`${state.name}: ${state.progress}%`);
 * });
 * emitter.start();
 * emitter.setProgress(50, '正在处理...');
 * emitter.complete();
 * off();
 * ```
 */
export class ProgressEmitter {
    private readonly id: string;
    private readonly name: string;

    private state: ProgressState;
    private callbacks = new Set<ProgressCallback>();

    private startTime: number = 0;
    private pauseTime: number = 0;
    private pausedElapsed: number = 0;

    private steps: ProgressStep[] = [];
    private currentStepIndex: number = -1;

    private abortController: AbortController;

    private throttleTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingState: ProgressState | null = null;
    private lastEmitTime: number = 0;

    private readonly throttleInterval: number = 100;

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.abortController = new AbortController();

        this.state = {
            id,
            name,
            status: 'pending',
            progress: 0,
            elapsed: 0,
        };
    }

    // ========================================================
    // 2.1 事件订阅
    // ========================================================

    /**
     * 订阅进度事件
     * @param callback 进度状态变化时的回调函数
     * @returns 取消订阅函数
     */
    on(callback: ProgressCallback): () => void {
        this.callbacks.add(callback);
        return () => this.off(callback);
    }

    /**
     * 取消订阅进度事件
     * @param callback 要取消的回调函数
     */
    off(callback: ProgressCallback): void {
        this.callbacks.delete(callback);
    }

    // ========================================================
    // 2.2 状态控制
    // ========================================================

    /**
     * 开始运行
     * 将状态从 pending 改为 running，记录开始时间
     */
    start(): void {
        if (this.state.status !== 'pending' && this.state.status !== 'paused') return;

        const now = Date.now();
        if (this.state.status === 'pending') {
            this.startTime = now;
            this.pausedElapsed = 0;
        } else if (this.state.status === 'paused') {
            this.pausedElapsed += now - this.pauseTime;
        }

        this.updateState({
            status: 'running',
            elapsed: this.calculateElapsed(),
        }, true);
    }

    /**
     * 暂停进度
     */
    pause(): void {
        if (this.state.status !== 'running') return;

        this.pauseTime = Date.now();
        this.updateState({
            status: 'paused',
            elapsed: this.calculateElapsed(),
        }, true);
    }

    /**
     * 设置进度
     * @param progress 进度值（0-100）
     * @param message 可选的进度消息
     */
    setProgress(progress: number, message?: string): void {
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        const clampedProgress = Math.max(0, Math.min(100, progress));
        const elapsed = this.calculateElapsed();
        const eta = this.calculateEta(clampedProgress, elapsed);

        this.updateState({
            progress: clampedProgress,
            message,
            elapsed,
            eta,
        }, false);
    }

    /**
     * 标记失败
     * @param error 错误信息
     */
    fail(error: string): void {
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        this.abortController.abort();
        this.flushPending();

        this.updateState({
            status: 'failed',
            error,
            progress: this.state.progress,
            elapsed: this.calculateElapsed(),
            eta: undefined,
        }, true);
    }

    /**
     * 标记完成
     */
    complete(): void {
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        this.flushPending();

        this.updateState({
            status: 'completed',
            progress: 100,
            elapsed: this.calculateElapsed(),
            eta: 0,
        }, true);
    }

    /**
     * 取消进度
     */
    cancel(): void {
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        this.abortController.abort();
        this.flushPending();

        this.updateState({
            status: 'cancelled',
            elapsed: this.calculateElapsed(),
            eta: undefined,
        }, true);
    }

    /**
     * 获取当前状态快照
     */
    getState(): ProgressState {
        return { ...this.state };
    }

    /**
     * 获取 AbortSignal，用于取消关联的异步操作
     */
    getSignal(): AbortSignal {
        return this.abortController.signal;
    }

    // ========================================================
    // 2.3 步骤管理
    // ========================================================

    /**
     * 注册步骤（预定义所有步骤）
     * @param stepNames 步骤名称列表
     */
    registerSteps(stepNames: string[]): void {
        if (this.state.status !== 'pending') return;

        this.steps = stepNames.map(name => ({
            name,
            status: 'pending',
            progress: 0,
        }));
        this.currentStepIndex = -1;

        this.updateState({
            steps: [...this.steps],
        }, false);
    }

    /**
     * 推进到下一步
     * 标记当前步骤完成，进入下一步并将其设为 running
     * @param message 可选的消息
     */
    nextStep(message?: string): void {
        if (this.steps.length === 0) return;
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        if (this.currentStepIndex >= 0) {
            this.steps[this.currentStepIndex].status = 'completed';
            this.steps[this.currentStepIndex].progress = 100;
        }

        this.currentStepIndex++;

        if (this.currentStepIndex >= this.steps.length) {
            this.complete();
            return;
        }

        this.steps[this.currentStepIndex].status = 'running';
        this.steps[this.currentStepIndex].progress = 0;

        const totalProgress = (this.currentStepIndex / this.steps.length) * 100;
        const elapsed = this.calculateElapsed();
        const eta = this.calculateEta(totalProgress, elapsed);

        this.updateState({
            currentStep: this.steps[this.currentStepIndex].name,
            progress: totalProgress,
            message: message || this.steps[this.currentStepIndex].name,
            steps: [...this.steps],
            elapsed,
            eta,
        }, true);
    }

    /**
     * 设置当前步骤的进度
     * @param stepProgress 步骤内进度（0-100）
     * @param message 可选的消息
     */
    setStepProgress(stepProgress: number, message?: string): void {
        if (this.steps.length === 0) return;
        if (this.currentStepIndex < 0 || this.currentStepIndex >= this.steps.length) return;
        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return;
        }

        const clampedStepProgress = Math.max(0, Math.min(100, stepProgress));
        this.steps[this.currentStepIndex].progress = clampedStepProgress;
        if (message) {
            this.steps[this.currentStepIndex].message = message;
        }

        const baseProgress = (this.currentStepIndex / this.steps.length) * 100;
        const stepContribution = (clampedStepProgress / 100) * (100 / this.steps.length);
        const totalProgress = baseProgress + stepContribution;

        const elapsed = this.calculateElapsed();
        const eta = this.calculateEta(totalProgress, elapsed);

        this.updateState({
            progress: totalProgress,
            message: message || this.state.message,
            steps: [...this.steps],
            elapsed,
            eta,
        }, false);
    }

    // ========================================================
    // 2.4 内部方法
    // ========================================================

    /**
     * 计算已用时间（毫秒）
     */
    private calculateElapsed(): number {
        if (this.startTime === 0) return 0;

        if (this.state.status === 'paused') {
            return this.pauseTime - this.startTime - this.pausedElapsed;
        }

        if (this.state.status === 'completed' ||
            this.state.status === 'failed' ||
            this.state.status === 'cancelled') {
            return this.state.elapsed;
        }

        return Date.now() - this.startTime - this.pausedElapsed;
    }

    /**
     * 计算预估剩余时间（毫秒）
     * 基于线性预估：eta = elapsed / progress * (100 - progress)
     */
    private calculateEta(progress: number, elapsed: number): number | undefined {
        if (progress <= 0 || progress >= 100) return undefined;
        if (elapsed <= 0) return undefined;

        const eta = (elapsed / progress) * (100 - progress);
        return Math.round(eta);
    }

    /**
     * 更新状态并触发事件
     * @param updates 状态更新字段
     * @param immediate 是否立即发送（跳过节流）
     */
    private updateState(updates: Partial<ProgressState>, immediate: boolean): void {
        this.state = {
            ...this.state,
            ...updates,
        };

        if (immediate) {
            this.flushPending();
            this.emit(this.state);
        } else {
            this.throttledEmit(this.state);
        }
    }

    /**
     * 节流发射：进度更新最多 10 次/秒
     */
    private throttledEmit(state: ProgressState): void {
        this.pendingState = state;

        const now = Date.now();
        const timeSinceLastEmit = now - this.lastEmitTime;

        if (timeSinceLastEmit >= this.throttleInterval) {
            this.flushPending();
            return;
        }

        if (this.throttleTimer) return;

        const remaining = this.throttleInterval - timeSinceLastEmit;
        this.throttleTimer = setTimeout(() => {
            this.throttleTimer = null;
            this.flushPending();
        }, remaining);
    }

    /**
     * 立即发送待处理的进度更新
     */
    private flushPending(): void {
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }

        if (this.pendingState) {
            this.emit(this.pendingState);
            this.pendingState = null;
        }
    }

    /**
     * 发射进度事件到所有订阅者
     */
    private emit(state: ProgressState): void {
        this.lastEmitTime = Date.now();
        const snapshot = { ...state };

        for (const callback of this.callbacks) {
            try {
                callback(snapshot);
            } catch (e) {
                log.warn('[ProgressEmitter] callback error:', e);
            }
        }
    }
}

// ============================================================
// 3. 使用示例
// ============================================================

/*
// 示例 1: 基本用法
const progress = new ProgressEmitter('task-001', 'AI 生成章节');

const unsubscribe = progress.on((state) => {
    log.info(`[${state.status}] ${state.name}: ${state.progress}%`);
    if (state.message) log.info('  ' + state.message);
    if (state.eta !== undefined) log.info(`  剩余: ${Math.round(state.eta / 1000)}s`);
});

progress.start();
progress.setProgress(30, '正在构思情节...');
progress.setProgress(60, '正在生成正文...');
progress.setProgress(90, '正在润色...');
progress.complete();
unsubscribe();

// 示例 2: 多步骤进度
const pipeline = new ProgressEmitter('pipeline-001', '章节生成流水线');

pipeline.registerSteps([
    '情节构思',
    '场景展开',
    '正文生成',
    '连贯性审查',
    '质量润色',
]);

pipeline.on((state) => {
    log.info(`步骤: ${state.currentStep} | 总进度: ${state.progress.toFixed(1)}%`);
});

pipeline.start();
pipeline.nextStep();
pipeline.setStepProgress(50, '正在构思冲突点...');
pipeline.setStepProgress(100);
pipeline.nextStep('开始场景展开');
// ... 依次推进
pipeline.nextStep();
pipeline.nextStep();
pipeline.nextStep(); // 最后一步完成后自动 complete

// 示例 3: 取消与 AbortSignal
const task = new ProgressEmitter('cancel-demo', '可取消任务');
const signal = task.getSignal();

// 在异步操作中使用 signal
// const result = await fetch('/api/generate', { signal });

task.cancel(); // 取消任务，同时触发 signal abort

// 示例 4: 失败处理
const task2 = new ProgressEmitter('fail-demo', '可能失败的任务');
task2.start();
task2.fail('网络连接超时，请重试');
log.info(task2.getState().error); // '网络连接超时，请重试'
*/

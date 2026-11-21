/**
 * chapter-orchestrator.ts — 单章一键编排
 *
 * 只负责“下一步该跑什么、什么时候停”，不重写 StepRunner。
 * 所有步骤仍走 StepRunner.executeCurrentStep / executeStepsSequential，
 * 因此步骤文件、校验、截断标记、失效传播、手动重生成全部保留。
 */
import { ALL_FULL_STEPS } from '@/engine/step-definitions';
import { t } from '@/i18n';
import type { StepRunCtx } from '@/engine/step-definitions';
import { isBodySettled } from './batch-targets';
import type { ChapterRunMode } from '@/shared/chapter-run';
import { STEP_KEYS } from '@/shared/step-keys';

export type { ChapterRunMode } from '@/shared/chapter-run';

/** 仅描述编排器实际用到的 StepRunner 能力，避免 UI -> engine 的运行时/类型环。 */
interface ChapterStepRunner {
    executePlanningCombined(ctx: StepRunCtx, options?: { signal?: AbortSignal; force?: boolean }): Promise<{ success: boolean; error?: string }>;
    executeStepsSequential(stepKeys: string[], ctx: StepRunCtx): Promise<unknown>;
}

interface ChapterRunState {
    stepCompleted: Set<string>;
    stepResults: Record<string, string>;
    currentStepIndex: number;
}

/**
 * 章节规划步骤键。
 */
export const CHAPTER_PLANNING_KEYS = [
    'infoPlan',
    'plotDistill',
    'outline',
    'emotionPlan',
    'sceneExpand',
] as const;

/**
 * 单章执行选项。
 */
export interface ChapterRunOptions {
    mode?: ChapterRunMode;
    includeQuality?: boolean;
    includeAnalysis?: boolean;
    includeSettlement?: boolean;
    /** 每个逻辑动作结束后暂停，等待 resume()。 */
    pauseBetweenSteps?: boolean;
}

/**
 * 执行进度。
 */
export interface ChapterRunProgress {
    phase: string;
    current: number;
    total: number;
    message: string;
    aiCalls: number;
}

/**
 * 执行结果。
 */
export interface ChapterRunResult {
    status: 'completed' | 'paused' | 'cancelled' | 'failed' | 'nothing';
    failedStep?: string;
    message?: string;
    aiCalls: number;
}

/**
 * 编排器依赖。
 */
export interface ChapterOrchestratorDeps {
    stepRunner: ChapterStepRunner;
    state: ChapterRunState;
    makeCtx: () => StepRunCtx;
    loadContext: () => Promise<void>;
    render: (container: HTMLElement) => Promise<void>;
    getTabContent: () => HTMLElement;
    settle: () => Promise<void>;
    showNotice: (message: string, duration?: number) => void;
    showError: (message: string, duration?: number) => void;
    /** 可选；缺省回落 showError（v4.25 修订闭环新增的软警告出口） */
    showWarning?: (message: string, duration?: number) => void;
    showSuccess: (message: string, duration?: number) => void;
    onProgress?: (progress: ChapterRunProgress) => void;
    /** 可重试错误的等待时长（毫秒）；缺省 3000。测试注入 0 用。 */
    retryDelayMs?: number;
    /** 单步硬超时（毫秒）；缺省 8 分钟。超时会中止请求并给出可重试错误，避免流程无限滞留。 */
    stepTimeoutMs?: number;
}

/**
 * 执行计划。
 */
export interface ChapterRunPlan {
    missingPlanning: string[];
    useCombinedPlanning: boolean;
    runBody: boolean;
    runQuality: boolean;
    runAnalysis: boolean;
    runSettlement: boolean;
    aiCalls: number;
    plannedActions: number;
}

const PLANNING_SET = new Set<string>(CHAPTER_PLANNING_KEYS);
const SETTLEMENT_DIRECTIVE_RE = /(UPDATE_|NEW_|RELATION:|GROWTH:|EMOTION:|PROMISE_|ARC:)/;

/**
 * 纯函数：根据当前完成态推导本次要跑的动作。
 *
 * @param completed - 完成状态
 * @param bodyText - 正文文本
 * @param analysisReport - 分析报告
 * @param options - 配置项
  * @returns ChapterRunPlan 实例
 */
export function buildChapterRunPlan(
    completed: Set<string>,
    bodyText: string,
    analysisReport: string,
    options: ChapterRunOptions = {},
): ChapterRunPlan {
    const mode = options.mode ?? 'recommended';
    const missingPlanning = CHAPTER_PLANNING_KEYS.filter(k => !completed.has(k));
    const useCombinedPlanning = mode === 'recommended'
        && missingPlanning.length === CHAPTER_PLANNING_KEYS.length;
    const runBody = !completed.has(STEP_KEYS.BODY_GENERATION);
    const runQuality = options.includeQuality !== false && !completed.has(STEP_KEYS.QUALITY_CONTROL);
    const runAnalysis = options.includeAnalysis !== false && !completed.has(STEP_KEYS.ANALYSIS_REPORT);
    const analysisHasDirectives = SETTLEMENT_DIRECTIVE_RE.test(analysisReport || '');
    const runSettlement = options.includeSettlement !== false
        && !isBodySettled(bodyText || '')
        && analysisHasDirectives;

    const planningCalls = useCombinedPlanning
        ? 1
        : missingPlanning.length;
    const aiCalls = planningCalls
        + (runBody ? 1 : 0)
        + (runQuality ? 1 : 0)
        + (runAnalysis ? 1 : 0);
    const plannedActions = (missingPlanning.length > 0 ? 1 : 0)
        + (runBody ? 1 : 0)
        + (runQuality ? 1 : 0)
        + (runAnalysis ? 1 : 0)
        + (runSettlement ? 1 : 0);

    return {
        missingPlanning,
        useCombinedPlanning,
        runBody,
        runQuality,
        runAnalysis,
        runSettlement,
        aiCalls,
        plannedActions,
    };
}

/**
 * countRemainingChapterActions 函数。
 * @param completed - 完成状态
 * @param bodyText - 正文文本
 * @param analysisReport - 分析报告
 * @returns 数值结果
 */
export function countRemainingChapterActions(
    completed: Set<string>,
    bodyText: string,
    analysisReport: string,
): number {
    const plan = buildChapterRunPlan(completed, bodyText, analysisReport, {
        includeQuality: true,
        includeAnalysis: true,
        includeSettlement: true,
    });
    return plan.plannedActions;
}

/**
 * 单章执行编排器。
 */
export class ChapterOrchestrator {
    private abortController: AbortController | null = null;
    private pauseRequested = false;
    private resumeResolver: (() => void) | null = null;
    private resumeTimer: number | null = null;
    private running = false;
    private _retriedThisRun = false;

    constructor(private readonly deps: ChapterOrchestratorDeps) {}

    get isRunning(): boolean {
        return this.running;
    }

    /**
     * 暂停执行。
     */
    pause(): void {
        if (this.running) this.pauseRequested = true;
    }

    /**
     * 恢复执行。
     */
    resume(): void {
        this.pauseRequested = false;
        if (this.resumeTimer !== null) {
            window.clearTimeout(this.resumeTimer);
            this.resumeTimer = null;
        }
        const resolver = this.resumeResolver;
        this.resumeResolver = null;
        resolver?.();
    }

    /**
     * 取消执行。
     */
    cancel(): void {
        this.abortController?.abort();
        this.resume();
    }

    /**
     * 执行计划。
     *
     * @param options - 配置项
     * @returns 结果
     */
    async run(options: ChapterRunOptions = {}): Promise<ChapterRunResult> {
        if (this.running) {
            return { status: 'failed', message: t('fullwriter.co.jobRunning'), aiCalls: 0 };
        }
        this.running = true;
        this.pauseRequested = false;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        let aiCalls = 0;
        let currentStepKey = '';

        const state = this.deps.state;
        const ctx = this.deps.makeCtx();
        ctx.getAbortController = () => this.abortController;
        const tabContent = this.deps.getTabContent();

        const report = (phase: string, current: number, total: number, message: string) => {
            this.deps.onProgress?.({ phase, current, total, message, aiCalls });
        };

        try {
            // 1) 上下文
            if (!state.stepCompleted.has('context')) {
                report('context', 1, 1, t('fullwriter.co.loadingContext'));
                await this.deps.loadContext();
                await this.render(tabContent);
            }
            if (signal.aborted) return this.finish('cancelled', aiCalls);

            let plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults[STEP_KEYS.BODY_GENERATION] || '',
                state.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                options,
            );
            const total = 11;
            let cursor = 0;

            const beforeAction = async (phase: string, message: string) => {
                cursor++;
                report(phase, cursor, total, message);
                await this.waitIfPaused();
                if (signal.aborted) throw new Error('cancelled');
            };

            // 2) 规划
            if (plan.missingPlanning.length > 0) {
                if (plan.useCombinedPlanning) {
                    currentStepKey = 'infoPlan';
                    await this.activateStep('infoPlan', ctx);
                    await beforeAction('planning', t('fullwriter.co.mergedPlanning'));
                    aiCalls += 1;
                    const result = await this.deps.stepRunner.executePlanningCombined(ctx, { signal });
                    await this.render(tabContent);
                    await this.afterAction();
                    if (signal.aborted) return this.finish('cancelled', aiCalls);
                    // 合并成功但缺模块（输出被截断/结构校验未过）时同样要补：
                    // 旧实现只在 !success 时回退，但合并规划只要 infoPlan+outline 完整就返回 success，
                    // 于是「提示缺少 X 可继续」后紧接着在这里硬失败，缺失模块永远不会被补齐。
                    const missingAfterCombined = CHAPTER_PLANNING_KEYS.filter(k => !state.stepCompleted.has(k));
                    for (const key of missingAfterCombined) {
                        currentStepKey = key;
                        await beforeAction('planning', t('fullwriter.co.fillPlanning', { key }));
                        aiCalls += 1;
                        await this.runOneStep(key, ctx, tabContent);
                        await this.afterAction();
                        if (signal.aborted) return this.finish('cancelled', aiCalls);
                    }
                    if (!result.success && missingAfterCombined.length === 0) {
                        // 合并接口报失败但模块齐全（例如只是尾部解析告警）：继续后续流程
                        this.deps.showNotice?.(t('fullwriter.co.planningWarnContinue'));
                    }
                } else {
                    for (const key of [...plan.missingPlanning]) {
                        currentStepKey = key;
                        await beforeAction('planning', t('fullwriter.co.generateModule', { key }));
                        aiCalls += 1;
                        await this.runOneStep(key, ctx, tabContent);
                        await this.afterAction();
                        if (signal.aborted) return this.finish('cancelled', aiCalls);
                    }
                }
            }
            if (signal.aborted) return this.finish('cancelled', aiCalls);

            // 规划必须 5 步齐全才进入正文；缺任何一步都停在这里，避免正文基于残缺规划生成
            const missingPlanning = CHAPTER_PLANNING_KEYS.filter(k => !state.stepCompleted.has(k));
            if (missingPlanning.length > 0) {
                this.deps.showError(t('fullwriter.co.planningIncomplete', { missing: missingPlanning.join('、') }), 8000);
                return this.finish('failed', aiCalls, missingPlanning[0]);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults[STEP_KEYS.BODY_GENERATION] || '',
                state.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                options,
            );

            // 3) 正文
            if (plan.runBody) {
                currentStepKey = STEP_KEYS.BODY_GENERATION;
                await beforeAction('body', t('fullwriter.co.generateBody'));
                aiCalls += 1;
                await this.runOneStep(STEP_KEYS.BODY_GENERATION, ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults[STEP_KEYS.BODY_GENERATION] || '',
                state.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                options,
            );

            // 4) 质量控制
            if (plan.runQuality) {
                currentStepKey = STEP_KEYS.QUALITY_CONTROL;
                await beforeAction('quality', t('fullwriter.co.qualityControl'));
                aiCalls += 1;
                await this.runOneStep(STEP_KEYS.QUALITY_CONTROL, ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults[STEP_KEYS.BODY_GENERATION] || '',
                state.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                options,
            );

            // 5) 分析报告
            if (plan.runAnalysis) {
                currentStepKey = STEP_KEYS.ANALYSIS_REPORT;
                await beforeAction('analysis', t('fullwriter.co.analysisReport'));
                aiCalls += 1;
                await this.runOneStep(STEP_KEYS.ANALYSIS_REPORT, ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            // 6) 结算（无 AI；守卫防重复追加）
            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults[STEP_KEYS.BODY_GENERATION] || '',
                state.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                options,
            );
            if (plan.runSettlement) {
                currentStepKey = 'settlement';
                ctx.setCurrentStepIndex(10);
                state.currentStepIndex = 10;
                await this.render(tabContent);
                await beforeAction('settlement', t('fullwriter.co.settlement'));
                await this.deps.settle();
                await this.render(tabContent);
                await this.afterAction();
            }

            this.deps.showSuccess(t('fullwriter.co.chapterDone', { settled: state.stepCompleted.has('settlement') ? t('fullwriter.co.withSettlement') : t('fullwriter.co.bodyReviewDone'), calls: aiCalls }), 6000);
            return this.finish('completed', aiCalls);
        } catch (e) {
            if (signal.aborted) return this.finish('cancelled', aiCalls);
            const message = e instanceof Error ? e.message : String(e);
            // P0-3（v4.27）：对可重试错误自动重试一次（网络超时/5xx/空响应）
            const retryable = /timeout|ECONNREFUSED|5\d{2}|socket hang up|network|fetch failed/i.test(message)
                && !this._retriedThisRun;
            if (retryable) {
                this._retriedThisRun = true;
                this.deps.showNotice?.(t('fullwriter.co.autoRetry', { msg: message }), 6000);
                await new Promise(resolve => window.setTimeout(resolve, this.deps.retryDelayMs ?? 3000));
                if (signal.aborted) return this.finish('cancelled', aiCalls);
                // 递归重跑前必须先释放运行锁：外层 finally 还没执行，running 仍为 true，
                // 不释放会让 run() 命中「已有任务在运行」守卫，重试必然瞬时失败。
                this.running = false;
                this.abortController = null;
                try {
                    return await this.run(options);
                } catch (retryError) {
                    const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
                    this.deps.showError(t('fullwriter.co.retryStillFailed', { msg: retryMsg }), 8000);
                    return this.finish('failed', aiCalls, currentStepKey || undefined, retryMsg);
                }
            }
            this.deps.showError(t('fullwriter.co.genInterrupted', { reason: message }), 8000);
            return this.finish('failed', aiCalls, currentStepKey || undefined, message);
        } finally {
            this.running = false;
            this.abortController = null;
        }
    }

    private async activateStep(stepKey: string, ctx: StepRunCtx): Promise<void> {
        const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
        if (!step) return;
        ctx.setCurrentStepIndex(step.index);
        this.deps.state.currentStepIndex = step.index;
        await this.deps.render(this.deps.getTabContent());
    }

    private async runOneStep(stepKey: string, ctx: StepRunCtx, tabContent: HTMLElement): Promise<void> {
        await this.activateStep(stepKey, ctx);
        // 单步看门狗：网络/模型无响应时不再无限停留，超时主动取消并抛可重试错误。
        const timeoutMs = this.deps.stepTimeoutMs ?? 8 * 60_000;
        let timer: number | null = null;
        const work = this.deps.stepRunner.executeStepsSequential([stepKey], ctx);
        const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => {
                this.abortController?.abort();
                reject(new Error(t('fullwriter.co.stepTimeout', { step: stepKey, minutes: Math.round(timeoutMs / 60000) })));
            }, timeoutMs);
        });
        try {
            await Promise.race([work, timeout]);
        } finally {
            if (timer) window.clearTimeout(timer);
        }
        await this.deps.render(tabContent);
        if (!this.deps.state.stepCompleted.has(stepKey)) {
            // v4.25 流程缺陷修复：只有「必须步骤」（正文）不完整才中止一键成文。
            // 实测 QC 少一个小节就把整条链打断，正文/结算全不落盘——
            // 可选步骤（质量控制/分析报告）保存 partial 内容后应继续，让结算与修订闭环照常走。
            const stepDef = ALL_FULL_STEPS.find(s => s.key === stepKey);
            if (stepDef?.required) {
                throw new Error(t('fullwriter.bp.belowStandard', { step: stepKey }));
            }
            const warn = this.deps.showWarning ?? this.deps.showError;
            warn(t('fullwriter.co.savedBelowStandard', { step: stepKey }), 8000);
        }
    }

    private async render(container: HTMLElement): Promise<void> {
        await this.deps.render(container);
    }

    private async afterAction(): Promise<void> {
        await this.waitIfPaused();
    }

    private async waitIfPaused(): Promise<void> {
        if (!this.pauseRequested) return;
        this.deps.showNotice(t('fullwriter.co.pausedNotice'), 6000);
        await new Promise<void>(resolve => {
            this.resumeResolver = resolve;
            this.resumeTimer = window.setTimeout(() => {
                this.resumeTimer = null;
                this.pauseRequested = false;
                this.resumeResolver = null;
                this.deps.showNotice(t('fullwriter.co.pauseAutoResume'), 8000);
                resolve();
            }, 10 * 60_000);
        });
    }

    private finish(
        status: ChapterRunResult['status'],
        aiCalls: number,
        failedStep?: string,
        message?: string,
    ): ChapterRunResult {
        this.running = false;
        this.abortController = null;
        this._retriedThisRun = false;
        return { status, aiCalls, failedStep, message };
    }
}

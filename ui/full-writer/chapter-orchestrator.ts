/**
 * chapter-orchestrator.ts — 单章一键编排
 *
 * 只负责“下一步该跑什么、什么时候停”，不重写 StepRunner。
 * 所有步骤仍走 StepRunner.executeCurrentStep / executeStepsSequential，
 * 因此步骤文件、校验、截断标记、失效传播、手动重生成全部保留。
 */
import { ALL_FULL_STEPS } from '@/engine/step-definitions';
import { isBodySettled } from './batch-targets';
import type { ChapterRunMode } from '@/shared/chapter-run';

export type { ChapterRunMode } from '@/shared/chapter-run';

/** 仅描述编排器实际用到的 StepRunner 能力，避免 UI -> engine 的运行时/类型环。 */
interface ChapterStepRunner {
    executePlanningCombined(ctx: any, options?: { signal?: AbortSignal; force?: boolean }): Promise<{ success: boolean; error?: string }>;
    executeStepsSequential(stepKeys: string[], ctx: any): Promise<unknown>;
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
    makeCtx: () => any;
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
    const runBody = !completed.has('bodyGeneration');
    const runQuality = options.includeQuality !== false && !completed.has('qualityControl');
    const runAnalysis = options.includeAnalysis !== false && !completed.has('analysisReport');
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
            return { status: 'failed', message: '已有章节生成任务在运行', aiCalls: 0 };
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
                report('context', 1, 1, '加载上下文...');
                await this.deps.loadContext();
                await this.render(tabContent);
            }
            if (signal.aborted) return this.finish('cancelled', aiCalls);

            let plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults['bodyGeneration'] || '',
                state.stepResults['analysisReport'] || '',
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
                    await beforeAction('planning', '合并生成全章规划（1 次 AI）...');
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
                        await beforeAction('planning', `补生成 ${key}（1 次 AI）...`);
                        aiCalls += 1;
                        await this.runOneStep(key, ctx, tabContent);
                        await this.afterAction();
                        if (signal.aborted) return this.finish('cancelled', aiCalls);
                    }
                    if (!result.success && missingAfterCombined.length === 0) {
                        // 合并接口报失败但模块齐全（例如只是尾部解析告警）：继续后续流程
                        this.deps.showNotice?.('合并规划有告警，但必要的规划模块已齐全，继续生成');
                    }
                } else {
                    for (const key of [...plan.missingPlanning]) {
                        currentStepKey = key;
                        await beforeAction('planning', `生成 ${key}（1 次 AI）...`);
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
                this.deps.showError(`规划不完整（缺少 ${missingPlanning.join('、')}），已停止在本步；可重试或单独生成`, 8000);
                return this.finish('failed', aiCalls, missingPlanning[0]);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults['bodyGeneration'] || '',
                state.stepResults['analysisReport'] || '',
                options,
            );

            // 3) 正文
            if (plan.runBody) {
                currentStepKey = 'bodyGeneration';
                await beforeAction('body', '生成正文（1 次 AI，流式）...');
                aiCalls += 1;
                await this.runOneStep('bodyGeneration', ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults['bodyGeneration'] || '',
                state.stepResults['analysisReport'] || '',
                options,
            );

            // 4) 质量控制
            if (plan.runQuality) {
                currentStepKey = 'qualityControl';
                await beforeAction('quality', '质量控制（1 次 AI）...');
                aiCalls += 1;
                await this.runOneStep('qualityControl', ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults['bodyGeneration'] || '',
                state.stepResults['analysisReport'] || '',
                options,
            );

            // 5) 分析报告
            if (plan.runAnalysis) {
                currentStepKey = 'analysisReport';
                await beforeAction('analysis', '分析报告（1 次 AI）...');
                aiCalls += 1;
                await this.runOneStep('analysisReport', ctx, tabContent);
                await this.afterAction();
                if (signal.aborted) return this.finish('cancelled', aiCalls);
            }

            // 6) 结算（无 AI；守卫防重复追加）
            plan = buildChapterRunPlan(
                state.stepCompleted,
                state.stepResults['bodyGeneration'] || '',
                state.stepResults['analysisReport'] || '',
                options,
            );
            if (plan.runSettlement) {
                currentStepKey = 'settlement';
                ctx.setCurrentStepIndex(10);
                state.currentStepIndex = 10;
                await this.render(tabContent);
                await beforeAction('settlement', '章节结算...');
                await this.deps.settle();
                await this.render(tabContent);
                await this.afterAction();
            }

            this.deps.showSuccess(`本章完成：${state.stepCompleted.has('settlement') ? '含结算' : '正文/审查已完成'}（${aiCalls} 次 AI）`, 6000);
            return this.finish('completed', aiCalls);
        } catch (e) {
            if (signal.aborted) return this.finish('cancelled', aiCalls);
            const message = e instanceof Error ? e.message : String(e);
            // P0-3（v4.27）：对可重试错误自动重试一次（网络超时/5xx/空响应）
            const retryable = /timeout|ECONNREFUSED|5\d{2}|socket hang up|network|fetch failed/i.test(message)
                && !this._retriedThisRun;
            if (retryable) {
                this._retriedThisRun = true;
                this.deps.showNotice?.(`⚠️ ${message}，3 秒后自动重试…`, 6000);
                await new Promise(resolve => setTimeout(resolve, this.deps.retryDelayMs ?? 3000));
                if (signal.aborted) return this.finish('cancelled', aiCalls);
                // 递归重跑前必须先释放运行锁：外层 finally 还没执行，running 仍为 true，
                // 不释放会让 run() 命中「已有任务在运行」守卫，重试必然瞬时失败。
                this.running = false;
                this.abortController = null;
                try {
                    return await this.run(options);
                } catch (retryError) {
                    const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
                    this.deps.showError(`重试后仍失败：${retryMsg}`, 8000);
                    return this.finish('failed', aiCalls, currentStepKey || undefined, retryMsg);
                }
            }
            this.deps.showError(`章节生成中断：${message}`, 8000);
            return this.finish('failed', aiCalls, currentStepKey || undefined, message);
        } finally {
            this.running = false;
            this.abortController = null;
        }
    }

    private async activateStep(stepKey: string, ctx: any): Promise<void> {
        const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
        if (!step) return;
        ctx.setCurrentStepIndex(step.index);
        this.deps.state.currentStepIndex = step.index;
        await this.deps.render(this.deps.getTabContent());
    }

    private async runOneStep(stepKey: string, ctx: any, tabContent: HTMLElement): Promise<void> {
        await this.activateStep(stepKey, ctx);
        // 单步看门狗：网络/模型无响应时不再无限停留，超时主动取消并抛可重试错误。
        const timeoutMs = this.deps.stepTimeoutMs ?? 8 * 60_000;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const work = this.deps.stepRunner.executeStepsSequential([stepKey], ctx);
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                this.abortController?.abort();
                reject(new Error(`步骤 ${stepKey} 超时（${Math.round(timeoutMs / 60000)} 分钟），已中止请求`));
            }, timeoutMs);
        });
        try {
            await Promise.race([work, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
        await this.deps.render(tabContent);
        if (!this.deps.state.stepCompleted.has(stepKey)) {
            // v4.25 流程缺陷修复：只有「必须步骤」（正文）不完整才中止一键成文。
            // 实测 QC 少一个小节就把整条链打断，正文/结算全不落盘——
            // 可选步骤（质量控制/分析报告）保存 partial 内容后应继续，让结算与修订闭环照常走。
            const stepDef = ALL_FULL_STEPS.find(s => s.key === stepKey);
            if (stepDef?.required) {
                throw new Error(`${stepKey} 未达到完成标准`);
            }
            const warn = this.deps.showWarning ?? this.deps.showError;
            warn(`⚠️ ${stepKey} 已保存但未达完成标准（部分小节缺失），已继续后续步骤；可单独重跑本步补齐`, 8000);
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
        this.deps.showNotice('⏸️ 已在当前步骤结束后暂停；点击“继续”恢复', 6000);
        await new Promise<void>(resolve => {
            this.resumeResolver = resolve;
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

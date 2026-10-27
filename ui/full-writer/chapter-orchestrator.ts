/**
 * chapter-orchestrator.ts — 单章一键编排
 *
 * 只负责“下一步该跑什么、什么时候停”，不重写 StepRunner。
 * 所有步骤仍走 StepRunner.executeCurrentStep / executeStepsSequential，
 * 因此步骤文件、校验、截断标记、失效传播、手动重生成全部保留。
 */
import { ALL_FULL_STEPS } from '../../engine/step-definitions';
import { isBodySettled } from './batch-targets';
import type { ChapterRunMode } from '../../shared/chapter-run';

export type { ChapterRunMode } from '../../shared/chapter-run';

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

export const CHAPTER_PLANNING_KEYS = [
    'infoPlan',
    'plotDistill',
    'outline',
    'emotionPlan',
    'sceneExpand',
] as const;

export interface ChapterRunOptions {
    mode?: ChapterRunMode;
    includeQuality?: boolean;
    includeAnalysis?: boolean;
    includeSettlement?: boolean;
    /** 每个逻辑动作结束后暂停，等待 resume()。 */
    pauseBetweenSteps?: boolean;
}

export interface ChapterRunProgress {
    phase: string;
    current: number;
    total: number;
    message: string;
    aiCalls: number;
}

export interface ChapterRunResult {
    status: 'completed' | 'paused' | 'cancelled' | 'failed' | 'nothing';
    failedStep?: string;
    message?: string;
    aiCalls: number;
}

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
    showSuccess: (message: string, duration?: number) => void;
    onProgress?: (progress: ChapterRunProgress) => void;
}

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

/** 纯函数：根据当前完成态推导本次要跑的动作。 */
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

export class ChapterOrchestrator {
    private abortController: AbortController | null = null;
    private pauseRequested = false;
    private resumeResolver: (() => void) | null = null;
    private running = false;

    constructor(private readonly deps: ChapterOrchestratorDeps) {}

    get isRunning(): boolean {
        return this.running;
    }

    pause(): void {
        if (this.running) this.pauseRequested = true;
    }

    resume(): void {
        this.pauseRequested = false;
        const resolver = this.resumeResolver;
        this.resumeResolver = null;
        resolver?.();
    }

    cancel(): void {
        this.abortController?.abort();
        this.resume();
    }

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
                    // 合并失败/缺模块时回退到缺失模块单步，避免整章停在规划
                    if (!result.success) {
                        const missing = CHAPTER_PLANNING_KEYS.filter(k => !state.stepCompleted.has(k));
                        for (const key of missing) {
                            currentStepKey = key;
                            await beforeAction('planning', `补生成 ${key}（1 次 AI）...`);
                            aiCalls += 1;
                            await this.runOneStep(key, ctx, tabContent);
                            await this.afterAction();
                            if (signal.aborted) return this.finish('cancelled', aiCalls);
                        }
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
        await this.deps.stepRunner.executeStepsSequential([stepKey], ctx);
        await this.deps.render(tabContent);
        if (!this.deps.state.stepCompleted.has(stepKey)) {
            throw new Error(`${stepKey} 未达到完成标准`);
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
        return { status, aiCalls, failedStep, message };
    }
}

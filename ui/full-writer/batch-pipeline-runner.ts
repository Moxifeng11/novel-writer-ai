/**
 * batch-pipeline-runner.ts — 正式「批量 N 章」流水线（无 UI 版本）
 *
 * 与章节工作台共用同一套步骤定义、同一套 prompt 模板、同一套落盘入口：
 *   - 步骤：信息规划 → 情节蒸馏 → 大纲摘要 → 情绪规划 → Scene展开 → 正文 → 分析报告
 *   - 正文落盘：StepResultSaver → BodyWriter（与工作台完全一致）
 *   - 结算：SettlementEngine（与工作台步骤 10 一致）
 *
 * 不依赖 FullWriterView 的 DOM 状态：每个步骤执行前用模板重新填充 prompt。
 */
import { App, TFile } from 'obsidian';
import { writeSettlementArtifacts } from '@/engine/settlement/settlement-coordinator';
import type NovelWriterPlugin from '@/main';
import { ALL_FULL_STEPS, StepRunner } from '@/engine/step-runner';
import type { StepRunCtx } from '@/engine/step-definitions';
import { getStepTemplateAuto, fillTemplate } from '@/engine/prompts/template-utils';
import { CHAPTER_FILE_TYPES, findChapterFile } from '@/engine/chapter-utils';
import { SettlementEngine } from '@/engine/settlement-engine';
import { writeChapterStateSnapshot } from '@/engine/chapter-state-snapshot-service';
import { ENGINE_NAMES } from '@/engine/engine-registry';
import { pjStepDir, pjNarrativeOverview, pjBodyFile } from '@/shared/paths';
import { stripFrontmatter } from '@/utils/helpers';
import { isTemplateSkeleton, isStepResultComplete } from '@/engine/step-validator';
import { createLogger } from '@/shared/logger';
import { writeVaultText } from '@/shared/file-system-port';
import { buildTemplateVars } from './template-vars-builder';
import {
    BATCH_STEP_KEYS,
    buildBatchTargets,
    isBodySettled,
    type BatchChapterTarget,
} from './batch-targets';
import { shouldRetryBatchStep } from './batch-step-retry';

export { BATCH_STEP_KEYS, buildBatchTargets };
export type { BatchChapterTarget };

const log = createLogger('BatchPipeline');

/**
 * BatchChapterStatus 类型定义。
 */
export type BatchChapterStatus = 'done' | 'skipped' | 'failed';

/**
 * BatchChapterResult 类型定义。
 */
export interface BatchChapterResult {
    target: BatchChapterTarget;
    status: BatchChapterStatus;
    completedSteps: string[];
    failedStep?: string;
    error?: string;
}

/**
 * BatchPipelineOptions 类型定义。
 */
export interface BatchPipelineOptions {
    /** 只补缺失步骤，已完成的跳过（默认 true） */
    resume?: boolean;
    /** 是否执行章节结算（默认 true） */
    runSettlement?: boolean;
    signal?: AbortSignal;
    onChapterStart?: (target: BatchChapterTarget, index: number, total: number) => void;
    onStepStart?: (target: BatchChapterTarget, stepKey: string) => void;
    onStepComplete?: (target: BatchChapterTarget, stepKey: string) => void;
    onChapterDone?: (result: BatchChapterResult) => void;
}

/**
 * BatchPipelineRunner 类。
 */
export class BatchPipelineRunner {
    private readonly stepRunner: StepRunner;
    private lastError = '';
    /** 当前章的取消器：外部 signal 只在 run() 里绑定一次，避免按章累积监听器 */
    private currentChapterAbort: AbortController | null = null;
    /** 本章读取失败的步骤文件（读不出来 ≠ 没有结果，不能覆盖） */
    private stepReadFailures: string[] = [];

    constructor(
        private readonly app: App,
        private readonly plugin: NovelWriterPlugin,
    ) {
        this.stepRunner = new StepRunner(app, plugin, {
            showError: (msg) => { this.lastError = msg; },
            showWarning: (msg) => { this.lastError = msg; },
            showNotice: () => {},
            showSuccess: () => {},
            showProgress: () => {},
            hideProgress: () => {},
        });
    }

    /**
     * 执行。
     * @param project - 项目（路径或对象）
     * @param targets - 参数值
     * @param options - 配置项
     * @returns 结果数组
     */
    async run(
        project: string,
        targets: BatchChapterTarget[],
        options: BatchPipelineOptions = {},
    ): Promise<BatchChapterResult[]> {
        const results: BatchChapterResult[] = [];
        const externalSignal = options.signal;
        const onAbort = () => this.currentChapterAbort?.abort();
        if (externalSignal && !externalSignal.aborted) {
            externalSignal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            for (let i = 0; i < targets.length; i++) {
                if (options.signal?.aborted) break;
                const target = targets[i];
                options.onChapterStart?.(target, i, targets.length);
                let result: BatchChapterResult;
                try {
                    result = await this.runChapter(project, target, options);
                } catch (e) {
                    result = {
                        target,
                        status: 'failed',
                        completedSteps: [],
                        error: e instanceof Error ? e.message : String(e),
                    };
                }
                results.push(result);
                options.onChapterDone?.(result);
            }
        } finally {
            externalSignal?.removeEventListener('abort', onAbort);
            this.currentChapterAbort = null;
        }
        return results;
    }

    private async runChapter(
        project: string,
        target: BatchChapterTarget,
        options: BatchPipelineOptions,
    ): Promise<BatchChapterResult> {
        const ctx = await this.buildCtx(project, target, options);
        const completed: string[] = [];

        // 步骤文件存在却读不出来（同步冲突/权限）：继续跑会用「空结果」重新生成并覆盖原文，
        // 直接中止本章并把路径报给用户是最安全的选择。
        if (this.stepReadFailures.length > 0) {
            return {
                target,
                status: 'failed',
                completedSteps: [],
                error: `读取步骤文件失败（已中止以避免覆盖）：${this.stepReadFailures.slice(0, 3).join('、')}`,
            };
        }

        // 已结算章节：结算的伏笔/关系/时间线写入都是追加语义，重跑会写出重复行。
        // 断点续跑时整章跳过；resume=false（用户显式强制重跑）才允许再走一遍。
        const settled = isBodySettled(ctx.stepResults['bodyGeneration']);
        const allStepsCompleted = BATCH_STEP_KEYS.every(key => ctx.stepCompleted.has(key));
        if (options.resume !== false && settled && allStepsCompleted) {
            log.info(`[BatchPipeline] ${target.chapterName} 已结算，跳过`);
            return { target, status: 'skipped', completedSteps: [...BATCH_STEP_KEYS] };
        }

        for (const stepKey of BATCH_STEP_KEYS) {
            if (options.signal?.aborted) {
                return { target, status: 'failed', completedSteps: completed, error: '已取消' };
            }
            if (options.resume !== false && ctx.stepCompleted.has(stepKey)) {
                completed.push(stepKey);
                options.onStepComplete?.(target, stepKey);
                continue;
            }

            options.onStepStart?.(target, stepKey);
            let attempts = 1;
            let outcome = await this.runStepOnce(ctx, stepKey);
            while (shouldRetryBatchStep({
                produced: outcome.ok,
                cancelled: !!options.signal?.aborted,
                attempts,
            })) {
                log.warn(
                    `[BatchPipeline] ${target.chapterName} 步骤 ${stepKey} 未产出内容，重试一次：`,
                    outcome.error || '空内容',
                );
                attempts += 1;
                outcome = await this.runStepOnce(ctx, stepKey);
            }

            if (!outcome.ok) {
                return {
                    target,
                    status: 'failed',
                    completedSteps: completed,
                    failedStep: stepKey,
                    error: options.signal?.aborted ? '已取消' : (outcome.error || `${stepKey} 未产出内容`),
                };
            }
            completed.push(stepKey);
            ctx.stepCompleted.add(stepKey);
            options.onStepComplete?.(target, stepKey);
        }

        if (options.runSettlement !== false && !(options.resume !== false && settled)) {
            try {
                await this.settle(project, ctx, target);
            } catch (e) {
                return {
                    target,
                    status: 'failed',
                    completedSteps: completed,
                    failedStep: 'settlement',
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        }

        return { target, status: 'done', completedSteps: completed };
    }

    /**
     * 执行一次步骤并判定是否产出内容。
     * 异常不再直接冒泡（旧实现会让 run() 的兜底把 completedSteps 清空），
     * 而是转成失败结果，交给调用方决定是否重试。
     */
    private async runStepOnce(ctx: StepRunCtx, stepKey: string): Promise<{ ok: boolean; error?: string }> {
        this.lastError = '';
        if (ctx.getAbortController?.()?.signal.aborted) return { ok: false, error: '已取消' };
        try {
            await this.preparePrompt(ctx, stepKey);
            const step = ALL_FULL_STEPS.find(s => s.key === stepKey);
            if (!step) throw new Error(`未找到步骤定义: ${stepKey}`);
            ctx.currentStepIndex = step.index;
            await this.stepRunner.executeCurrentStep(ctx);
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            return { ok: false, error: this.lastError };
        }

        // A6: abort 后本次调用可能仍残留部分输出（流式半章），必须在保存前判定取消，
        // 否则会被当成正常结果，后续 chapter 也会基于错误状态继续。
        if (ctx.getAbortController?.()?.signal.aborted) return { ok: false, error: '已取消' };
        const meta = ctx.stepMeta?.[stepKey];
        if (meta?.truncated) {
            return { ok: false, error: `${stepKey} 输出被截断（${meta.model || '模型'} 上限 ${meta.maxTokens || '?'} tokens）` };
        }
        const content = (ctx.stepResults[stepKey] || '').trim();
        if (!content) return { ok: false, error: this.lastError || `${stepKey} 未产出内容` };
        // A4: 非空不等于已生成，模板骨架必须视为未产出并重试
        const pure = stripFrontmatter(content);
        if (isTemplateSkeleton(pure, stepKey)) {
            return { ok: false, error: `${stepKey} 仍是模板骨架` };
        }
        // 截断/半成品即使有内容也不能进入下一步或结算；StepRunner 只在 complete 时标记。
        if (!ctx.stepCompleted.has(stepKey)) {
            return { ok: false, error: `${stepKey} 未达到完成标准` };
        }
        return { ok: true };
    }

    /** 用与工作台完全相同的模板重建当前步骤的 system / user prompt */
    private async preparePrompt(ctx: StepRunCtx, stepKey: string): Promise<void> {
        const vars = await ctx.buildTemplateVars();
        Object.assign(ctx.vars, vars);

        if (stepKey === 'characterSoul') {
            // 角色灵魂步骤不经过模板（由 StepRunner 内部处理）
            return;
        }
        const template = getStepTemplateAuto(stepKey, vars);
        if (!template) throw new Error(`缺少步骤模板: ${stepKey}`);
        ctx.systemPromptEl.value = fillTemplate(template.systemPrompt, vars);
        ctx.userPromptEl.value = fillTemplate(template.userPrompt, vars);
    }

    private async buildCtx(
        project: string,
        target: BatchChapterTarget,
        options: BatchPipelineOptions,
    ): Promise<StepRunCtx> {
        const chapDir = pjStepDir(project, target.volumeNum, target.chapterNum);
        const context = await this.plugin.ctxManager.gatherAll(project, target.chapterName);
        this.stepReadFailures = [];
        const stepResults = await this.loadStepResults(
            chapDir,
            target.chapterName,
            project,
            target.volumeNum,
            target.chapterNum,
        );
        // A4: 续跑跳过必须由内容结构决定，不能只看「文件非空」——
        // 批量预生成的模板文件非空但没有实质内容，旧逻辑会整步跳过。
        // resume=false（显式强制重跑）时不能用磁盘上的完成态：
        // 一旦本次 AI 调用失败，旧内容仍满足「非空 + 未截断」，会被判定为成功。
        const stepCompleted = options.resume === false
            ? new Set<string>()
            : new Set(
                Object.keys(stepResults).filter(key => isStepResultComplete(key, stepResults[key]))
            );

        const tabContent = document.createElement('div');
        const systemPromptEl = document.createElement('textarea');
        const userPromptEl = document.createElement('textarea');
        const temperatureSlider = document.createElement('input');
        temperatureSlider.type = 'range';
        temperatureSlider.value = '1.4';

        // 每章一个 AbortController；外部 signal 由 run() 统一桥接，
        // 旧实现每次 getAbortController() 都 addEventListener，批量跑多章会累积监听器（MaxListeners/泄漏）。
        const abortController = new AbortController();
        this.currentChapterAbort = abortController;
        if (options.signal?.aborted) abortController.abort();

        const ctx: StepRunCtx = {
            stepResults,
            stepCompleted,
            stepMeta: {},
            currentStepIndex: 0,
            setCurrentStepIndex: (v) => { ctx.currentStepIndex = v; },
            tabContent,
            systemPromptEl,
            userPromptEl,
            temperatureSlider,
            chapDir,
            chapterName: target.chapterName,
            volume: target.volume,
            chapterNum: target.chapterNum,
            project,
            vars: {},
            isLoading: false,
            buildTemplateVars: () => buildTemplateVars({
                app: this.app,
                plugin: this.plugin,
                project,
                chapterName: target.chapterName,
                chapterNum: target.chapterNum,
                volume: target.volume,
                chapDir,
                context,
                viewVars: {},
                stepResults,
            }),
            saveStepResult: async (key, content, meta) => {
                await this.stepRunner.saveStepResult(key, content, chapDir, target.chapterName, target.volume, meta);
            },
            renderInContainer: async () => {},
            setIsLoading: (v) => { ctx.isLoading = v; },
            getAbortController: () => abortController,
            refreshWorkspace: () => {},
            // 空实现会让「正文/规划变更 → 下游失效」在批量模式下静默失效：
            // 断点续跑时旧的 analysisReport 仍算完成，回环会跳过它，
            // 最终用旧分析报告结算新正文。这里与工作台保持同一语义。
            invalidateSteps: (stepKeys: string[]) => {
                for (const key of stepKeys) {
                    ctx.stepCompleted.delete(key);
                    delete ctx.stepResults[key];
                    if (ctx.stepMeta) delete ctx.stepMeta[key];
                }
            },
            generatedThisSession: new Set<string>(),
        };
        return ctx;
    }

    /** 从磁盘恢复已有步骤结果，用于断点续跑 */
    private async loadStepResults(
        chapDir: string,
        chapterName: string,
        project: string,
        volumeNum: number,
        chapterNum: number,
    ): Promise<Record<string, string>> {
        const results: Record<string, string> = {};
        const folder = this.app.vault.getAbstractFileByPath(chapDir);
        if (!folder) return results;

        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(`${chapDir}/`));
        for (const [stepKey, type] of Object.entries(CHAPTER_FILE_TYPES)) {
            if (stepKey === 'body') continue;
            const file = findChapterFile(files, chapDir, type, this.app);
            if (file instanceof TFile) {
                try {
                    results[stepKey] = await this.app.vault.read(file);
                } catch (e) {
                    // 文件存在但读不出来（同步冲突/权限）：不能当成「没有结果」，
                    // 否则续跑会重新生成并覆盖这份读不到的原文。
                    this.stepReadFailures.push(file.path);
                    log.warn('[BatchPipeline] 读取步骤文件失败:', file.path, e);
                }
            }
        }

        // 正文：v4 路径由卷号+章号唯一确定，不在 chapDir 下。
        // 旧实现只在 chapDir 里找，导致续跑读不到正文并重新生成/结算失败。
        let bodyFile: TFile | null = null;
        if (project && volumeNum > 0 && chapterNum > 0) {
            const v4File = this.app.vault.getAbstractFileByPath(pjBodyFile(project, volumeNum, chapterNum));
            if (v4File instanceof TFile) bodyFile = v4File;
        }
        if (!bodyFile) {
            // 兼容 v3/旧项目：正文仍与步骤结果同目录
            bodyFile = findChapterFile(files, chapDir, CHAPTER_FILE_TYPES.body, this.app) || null;
        }
        if (bodyFile) {
            try {
                results['bodyGeneration'] = await this.app.vault.read(bodyFile);
            } catch (e) {
                this.stepReadFailures.push(bodyFile.path);
                log.warn('[BatchPipeline] 读取正文失败:', bodyFile.path, e);
            }
        }
        return results;
    }

    private async settle(project: string, ctx: StepRunCtx, target: BatchChapterTarget): Promise<void> {
        const analysisReport = ctx.stepResults['analysisReport'] || '';
        const bodyText = stripFrontmatter(ctx.stepResults['bodyGeneration'] || '');
        if (!analysisReport.trim() || !bodyText.trim()) {
            throw new Error('结算缺少分析报告或正文');
        }

        const engine = this.plugin.engineRegistry.get(ENGINE_NAMES.SETTLEMENT_ENGINE);
        const result = await engine.settle(project, ctx.chapDir, target.chapterName, analysisReport, bodyText);

        // 空指令集：引擎未执行任何写入，不能继续写快照/叙事总览，也不应把本章当已结算
        if (result.mode === 'empty') {
            throw new Error('分析报告未解析出可应用指令（UPDATE_*/NEW_*/RELATION 等），结算未执行');
        }

        const artifactReport = await writeSettlementArtifacts({
            chapterName: target.chapterName,
            volume: target.volume || '',
            mode: 'full',
            result,
        }, {
            writeSnapshot: async () => {
                await writeChapterStateSnapshot(this.app, {
                    project,
                    chapterNum: target.chapterNum,
                    chapterName: target.chapterName,
                    bodyText: ctx.stepResults['bodyGeneration'] || '',
                    sceneExpansion: ctx.stepResults['sceneExpand'] || '',
                    updatedChars: result.chars,
                });
            },
            refreshNarrativeOverview: async () => {
                const overview = await engine.generateNarrativeOverview(project);
                if (overview.trim()) {
                    await writeVaultText(this.app, pjNarrativeOverview(project), overview);
                }
            },
        });
        for (const warning of artifactReport.warnings) {
            log.warn('[BatchPipeline] 结算产物未完全写入:', warning);
        }
    }
}

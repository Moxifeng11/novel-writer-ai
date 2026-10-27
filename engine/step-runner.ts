import { App, TFile } from 'obsidian';
import { AIEngine, APIResponse } from './ai-engine';
import { DEAI_CHECK_SYSTEM_PROMPT, DEAI_CHECK_USER_TEMPLATE, DEAI_REWRITE_SYSTEM_PROMPT, DEAI_REWRITE_USER_TEMPLATE, SELF_CHECK_PROMPTS } from './prompt-templates';
import { findChapterFile } from './chapter-utils';
import { mkdirp, stripFrontmatter } from '../utils/helpers';
import { SettlementEngine } from './settlement-engine';
import { ENGINE_NAMES } from './engine-registry';
import { NOTICE_WARNING, NOTICE_CRITICAL, getBusinessThreshold } from '../shared/thresholds';
import { fitPromptToContext } from '../shared/prompt-budget';
import { resolveTaskForStep, resolveTaskModelConfig, type ThinkingMode } from '../shared/task-model';
import { auditEmotions } from './emotion-auditor';
import { KnowledgeInjector } from './knowledge-injector';
import { WritingProfileManager } from './writing-profile';
import { pjBodyFile, pjBodyDir, pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir } from '../shared/paths';
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { StepResultSaver, type StepSaveMeta } from './step-result-saver';
import { StepModalController } from './step-modal-controller';
import { AnalysisSessionManager } from './analysis-session-manager';
import { StyleFingerprintLibrary } from './style-fingerprint-library';
import { selectBodyStyleSamples, formatStyleSamplesForPrompt } from './style/style-sample-service';
import { parseContrastLibrary, selectContrastPair, formatContrastPairForPrompt } from '../shared/contrast-library';
import { writeChapterStateSnapshot } from './chapter-state-snapshot-service';
import { parseQualityControlReport } from './revision/quality-issue-parser';
import { runTargetedRevision } from './revision/targeted-revision';
import { LongNovelSingleCallTasks } from './harness/long-novel-tasks';
import { pjContrastLibrary } from '../shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { runCharacterSoulStep, runEmotionPlanStep, runSceneExpandStep, type StepSpecialsHost } from './step-specials';
import { executeSettlement as executeSettlementPrimitive, type StepSettlementHost } from './step-settlement';
import { executeStepsSequential as executeStepsSequentialPrimitive } from './step-sequential';
import { getStepTemplateAuto, fillTemplate } from './prompts/template-utils';
import { assembleStepPrompt, type StepPromptAssemblyHost } from './step-prompt-assembly';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';

// ============================================================
// 步骤定义（从 step-definitions.ts 重新导出，保持外部零修改）
// ============================================================
export { ALL_FULL_STEPS, STEP_INDEX_MIGRATION_MAP, migrateStepIndex, preCheckQualityControl } from './step-definitions';
export type { FullStep, StepRunCtx, ModelStrategy, PreValidationFn, PostValidationFn } from './step-definitions';
import type { StepRunCtx, StepRunMeta } from './step-definitions';
import { ALL_FULL_STEPS, preCheckQualityControl } from './step-definitions';
import { calcStepIndexAfterPlanning, downstreamStepsAfterPlanningChange } from './planning-step-advance';
import {
    callAIWithRetry as callAIWithRetryPrimitive,
    callAIStreamWithRetry as callAIStreamWithRetryPrimitive,
    warnIfTruncated as warnIfTruncatedPrimitive,
    type StepRunnerRetryHost,
} from './step-runner-retry';
import {
    COMBINED_PLANNING_STEP_KEYS,
    buildCombinedPlanningPrompts,
    evaluateCombinedPlanning,
    parseCombinedPlanning,
} from './planning-combined';
import { createLogger } from '../shared/logger';
import { createStepFailure, type StepFailureKind } from '../shared/execution-events';
import { validateStepResult } from './step-validator';


const log = createLogger('StepRunner');
/**
 * step-runner.ts — 步骤执行引擎
 *
 * 职责：步骤编排、AI 调用、结果保存、步骤推进、章节结算
 *
 * 架构说明（v4.1.1 重构）：
 * - engine 层纯逻辑：通过 callbacks 与 UI 层解耦
 * - Notice / 进度通知 → 通过 StepRunnerCallbacks 回调
 * - DOM 渲染方法（renderErrorResult / showDeaiTwoPhaseModal 等）→ 保留在 engine 层供 UI 层调用
 *
 * @see step-runner-callbacks.ts — 回调接口定义
 * @see step-definitions.ts — 步骤元数据与废弃说明
 *
 * 关于正文生成（bodyGeneration）的重要说明：
 * - Step 7（bodyGeneration）已接入新流程：有角色灵魂 / Scene 规划时自动使用 V2 小说家模板
 * - 与 CoWriterEngine（句级协同写作）共享同一正文文件、同一格式契约与同一落盘入口（BodyWriter）
 * - 两条路径可随时切换，不再区分「新旧模式」
 */
export class StepRunner {
    private aiEngine: AIEngine;
    private settlementEngine: SettlementEngine;
    private callbacks: StepRunnerCallbacks;
    private resultSaver: StepResultSaver;
    private modalController: StepModalController;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    /**
     * 业务级重试与流式续写已迁至 step-runner-retry.ts：
     * 本类保留同名委托方法，调用方与既有测试无需改动。
     */
    private retryHost(): StepRunnerRetryHost {
        return {
            aiEngine: this.aiEngine,
            showProgress: (message: string) => this.callbacks.showProgress(message),
            showNotice: (message: string, duration?: number) => this.callbacks.showNotice(message, duration),
        };
    }

    /** 特例步骤（characterSoul / emotionPlan / sceneExpand）的宿主能力 */
    private specialHost(): StepSpecialsHost {
        return {
            aiEngine: this.aiEngine,
            app: this.app,
            showError: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showError(message) : this.callbacks.showError(message, duration),
            showSuccess: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showSuccess(message) : this.callbacks.showSuccess(message, duration),
            showNotice: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showNotice(message) : this.callbacks.showNotice(message, duration),
            hideProgress: () => this.callbacks.hideProgress(),
            saveStepResult: (key, content, chapDir, chapterName, volume) =>
                this.saveStepResult(key, content, chapDir, chapterName, volume),
            resolveStepBudgetLimits: (model: string) => this.resolveStepBudgetLimits(model),
            injectEmotionPlanKnowledge: (ctx: StepRunCtx) => this.injectEmotionPlanKnowledge(ctx),
            injectSceneExpandKnowledge: (ctx: StepRunCtx) => this.injectSceneExpandKnowledge(ctx),
            getSceneExpandCustomPrompt: async () => {
                try {
                    const svc = this.plugin.engineRegistry.get<{
                        hasCustomPrompt(key: string): Promise<boolean>;
                        getCustomPrompt(key: string): Promise<{ system: string; user: string }>;
                    }>(ENGINE_NAMES.TEMPLATE_SERVICE);
                    if (!svc?.hasCustomPrompt || !(await svc.hasCustomPrompt('sceneExpand'))) return null;
                    const prompt = await svc.getCustomPrompt('sceneExpand');
                    if (!prompt?.system && !prompt?.user) return null;
                    return { systemPrompt: prompt.system || '', userPrompt: prompt.user || '' };
                } catch (e) {
                    log.warn('[StepRunner] 读取自定义 sceneExpand prompt 失败，使用内置模板:', e);
                    return null;
                }
            },
        };
    }

    /** 情绪规划知识注入：画像读取 / 强度判断 / 失败降级集中在本类，避免特例模块反向依赖 engine-registry */
    private async injectEmotionPlanKnowledge(ctx: StepRunCtx): Promise<string> {
        try {
            // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
            const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(ctx.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                const injection = await injector.injectForEmotionPlan(profile, {
                    projectPath: ctx.project,
                    chapterIndex: ctx.chapterNum,
                    outline: ctx.vars.outlineContent || ctx.stepResults['outline'] || '',
                });
                return injection || '';
            }
        } catch (e) {
            log.warn('[StepRunner] 情绪规划知识注入失败，跳过:', e);
        }
        return '';
    }

    /** Scene 展开知识注入：与情绪规划同一套降级语义 */
    private async injectSceneExpandKnowledge(ctx: StepRunCtx): Promise<string> {
        try {
            // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
            const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(ctx.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                const injection = await injector.injectForSceneExpand(profile, {
                    projectPath: ctx.project,
                    chapterIndex: ctx.chapterNum,
                    outline: ctx.vars.outlineContent || ctx.stepResults['outline'] || '',
                    emotionPlan: ctx.vars.emotionPlan || ctx.stepResults['emotionPlan'] || '',
                });
                return injection || '';
            }
        } catch (e) {
            log.warn('[StepRunner] Scene展开知识注入失败，跳过:', e);
        }
        return '';
    }

    /** 章节结算链路的宿主能力（懒加载文件系统，避免无结算时创建实例） */
    private settlementHost(plugin: NovelWriterPluginAPI): StepSettlementHost {
        return {
            settlementEngine: this.settlementEngine,
            readTextFile: async (path: string) => {
                const file = this.getVaultMeta().getAbstractFileByPath(path);
                if (!(file instanceof TFile)) return null;
                return this.getFS().read(path);
            },
            writeTextFile: (path: string, content: string) => this.getFS().write(path, content),
            hideProgress: () => this.callbacks.hideProgress(),
            showProgress: (message: string) => this.callbacks.showProgress(message),
            showError: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showError(message) : this.callbacks.showError(message, duration),
            showSuccess: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showSuccess(message) : this.callbacks.showSuccess(message, duration),
            showNotice: (message: string, duration?: number) =>
                duration === undefined ? this.callbacks.showNotice(message) : this.callbacks.showNotice(message, duration),
            triggerContextRefresh: () => plugin.app.workspace.trigger('novel-writer:refresh-context-panel', {}),
        };
    }

    /** 通用步骤 prompt 装配的宿主能力 */
    private promptAssemblyHost(): StepPromptAssemblyHost {
        return {
            loadOutlineKnowledge: (ctx: StepRunCtx) => this.loadOutlineKnowledge(ctx),
            loadBodyKnowledge: (ctx: StepRunCtx) => this.loadBodyKnowledge(ctx),
            loadBodyKnowledgeParts: (ctx: StepRunCtx) => this.loadBodyKnowledgeParts(ctx),
            resolveStepBudgetLimits: (model: string) => this.resolveStepBudgetLimits(model),
        };
    }

    /**
     * 正文硬约束尾部：真实 prose 样章 + 弱/强对照。
     * 放在 system prompt，避免被 prompt-budget 的 extraTail 优先后裁掉。
     */
    private async loadBodyKnowledgeParts(ctx: StepRunCtx): Promise<{ extra: string; system: string }> {
        const extra = await this.loadBodyKnowledge(ctx);
        const blocks: string[] = [];
        try {
            const library = new StyleFingerprintLibrary(this.app, ctx.project);
            await library.loadGlobal();
            await library.loadProject();
            await library.loadGlobalState(ctx.project);
            await library.loadIntensityConfigs();
            const enabled = await library.getEnabledFingerprints();
            const query = [
                (ctx.stepResults['bodyGeneration'] || '').slice(-800),
                ctx.stepResults['outline'] || '',
                (ctx.stepResults['sceneExpand'] || '').slice(0, 1200),
            ].filter(Boolean).join('\n');
            const selection = await selectBodyStyleSamples(
                this.app,
                ctx.project,
                enabled,
                query || ctx.vars.outlineContent || '',
                3,
            );
            const sampleBlock = formatStyleSamplesForPrompt(selection);
            if (sampleBlock) blocks.push(sampleBlock);

            // 弱/强对照：只注入一对，失败静默（用户没建对照库时不产生噪音）
            try {
                const contrastFile = this.app.vault.getAbstractFileByPath(pjContrastLibrary(ctx.project));
                if (contrastFile instanceof TFile) {
                    const raw = await this.app.vault.read(contrastFile);
                    const pair = selectContrastPair(parseContrastLibrary(raw), ctx.vars._sceneType);
                    const contrast = formatContrastPairForPrompt(pair);
                    if (contrast) blocks.push(contrast);
                }
            } catch (e) {
                log.debug('[StepRunner] 读取写作对照库失败，跳过:', e);
            }
        } catch (e) {
            log.warn('[StepRunner] 正文样章注入失败，跳过:', e);
        }
        return { extra, system: blocks.join('\n\n') };
    }

    /**
     * 正文生成知识注入：文笔指纹（风格/节奏/技巧/人物要点）。
     * 以前只有旧路径 AIEngine.generateChapter 调用 injectForBodyGeneration，
     * 11 步流水线的正文因此拿不到向导/指纹库生成的文笔信息。
     */
    private async loadBodyKnowledge(ctx: StepRunCtx): Promise<string> {
        const parts: string[] = [];
        try {
            const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(ctx.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                const injection = await injector.injectForBodyGeneration(profile, {
                    projectPath: ctx.project,
                    chapterIndex: ctx.chapterNum,
                    outline: ctx.vars.outlineContent || ctx.stepResults['outline'] || '',
                    emotionPlan: ctx.vars.emotionPlan || ctx.stepResults['emotionPlan'] || '',
                    sceneType: ctx.vars._sceneType || undefined,
                });
                if (injection) parts.push(injection);
            }
        } catch (e) {
            log.warn('[StepRunner] 正文知识注入失败，跳过:', e);
        }

        // 记忆碎片：此前 11 步正文恒为空（gatherAll 没传场景文本），V2 的「记忆触发」从未生效
        try {
            const sceneText = [ctx.stepResults['outline'], ctx.stepResults['sceneExpand']]
                .filter((s) => s && s.trim())
                .join('\n')
                .slice(0, 6000);
            const protagonistName = ctx.vars.protagonistName || '';
            const presentCharacters = (ctx.vars.allChars || '')
                .split('\n')
                .map((line) => line.match(/^-\s*([^：:]+)/)?.[1]?.trim())
                .filter((name): name is string => Boolean(name))
                .slice(0, 12);
            if (sceneText && protagonistName && presentCharacters.length > 0) {
                const memory = await this.plugin.ctxManager.gatherMemories(
                    ctx.project,
                    sceneText,
                    presentCharacters,
                    protagonistName,
                    ctx.chapterNum,
                );
                if (memory.triggered_memories_prompt) {
                    parts.push(memory.triggered_memories_prompt);
                }
            }
        } catch (e) {
            log.warn('[StepRunner] 记忆碎片匹配失败，跳过:', e);
        }

        return parts.join('\n\n');
    }

    /** 大纲摘要知识注入：画像读取 / 强度判断 / 失败降级集中在本类，避免装配模块反向依赖 engine-registry */
    private async loadOutlineKnowledge(ctx: StepRunCtx): Promise<string> {
        try {
            // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
            const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(ctx.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                const injection = await injector.injectForOutline(profile, {
                    projectPath: ctx.project,
                    chapterIndex: ctx.chapterNum,
                    outline: ctx.vars.outlineContent || '',
                });
                return injection || '';
            }
        } catch (e) {
            log.warn('[StepRunner] 大纲摘要知识注入失败，跳过:', e);
        }
        return '';
    }

    constructor(
        private app: App,
        private plugin: NovelWriterPluginAPI,
        callbacks?: Partial<StepRunnerCallbacks>,
    ) {
        this.aiEngine = plugin.aiEngine;
        this.settlementEngine = plugin.engineRegistry.get<SettlementEngine>(ENGINE_NAMES.SETTLEMENT_ENGINE);
        // 合并默认空实现与传入的回调
        this.callbacks = { ...NOOP_CALLBACKS, ...callbacks };
        // 初始化结果持久化模块
        this.resultSaver = new StepResultSaver({
            app,
            deps: {
                getPlugin: () => this.plugin,
                showNotice: (msg, dur) => this.callbacks.showNotice?.(msg, dur),
            },
        });
        // 初始化弹窗控制器
        this.modalController = new StepModalController(app, {
            getAIEngine: () => this.aiEngine,
            getPlugin: () => this.plugin,
            saveStepResult: (k, c, d, n, v) => this.saveStepResult(k, c, d, n, v),
            callbacks: this.callbacks,
            invalidateSteps: this.callbacks.invalidateSteps,
        });
    }

    private async callAIWithRetry(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        stepLabel: string,
        signal?: AbortSignal,
        thinking?: { thinkingMode?: ThinkingMode; thinkingBudget?: number; endpoint?: string; apiKey?: string; disableFallback?: boolean },
    ): Promise<APIResponse> {
        return callAIWithRetryPrimitive(
            this.retryHost(),
            systemPrompt,
            userPrompt,
            model,
            temperature,
            maxTokens,
            stepLabel,
            signal,
            thinking,
        );
    }

    private async callAIStreamWithRetry(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        stepLabel: string,
        onChunk: (text: string, done: boolean) => void,
        signal?: AbortSignal,
        thinking?: { thinkingMode?: ThinkingMode; thinkingBudget?: number; endpoint?: string; apiKey?: string; disableFallback?: boolean },
    ): Promise<APIResponse> {
        return callAIStreamWithRetryPrimitive(
            this.retryHost(),
            systemPrompt,
            userPrompt,
            model,
            temperature,
            maxTokens,
            stepLabel,
            onChunk,
            signal,
            thinking,
        );
    }

    /**
     * 输出仍被截断时给用户可见提示。
     * 只写日志会让「半章」被当成完整章节保存，用户无从判断结尾是否缺失。
     */
    warnIfTruncated(result: APIResponse, label: string): void {
        warnIfTruncatedPrimitive(this.retryHost(), result, label);
    }

    /** 统一失效传播：优先走 ChapterStateManager 的同步实现 */
    private invalidateSteps(ctx: StepRunCtx, stepKeys: string[]): void {
        if (ctx.invalidateSteps) {
            ctx.invalidateSteps(stepKeys);
            return;
        }
        for (const key of stepKeys) ctx.stepCompleted.delete(key);
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    // ============================================================
    // 结构化执行事件 / 失败 / 调试日志
    // ============================================================
    private emitEvent(
        type: string,
        level: 'debug' | 'info' | 'success' | 'warning' | 'error',
        message: string,
        stepKey: string,
        stepLabel: string,
        detail?: string,
    ): void {
        this.callbacks.onExecutionEvent?.({ type, level, message, stepKey, stepLabel, detail });
    }

    private emitDiagnostic(
        level: 'debug' | 'info' | 'success' | 'warning' | 'error',
        scope: 'step' | 'run' | 'api' | 'save' | 'prompt' | 'ui',
        message: string,
        stepKey?: string,
        stepLabel?: string,
        extra?: { detail?: string; stack?: string },
    ): void {
        this.callbacks.onDiagnostic?.({
            level,
            scope,
            message,
            stepKey,
            stepLabel,
            detail: extra?.detail,
            stack: extra?.stack,
        });
    }

    /**
     * 两种执行模式共用的失败上报入口。
     * showError/showNotice 仍保留给旧调用方与测试；UI 层会把重复文本合并成一条。
     */
    private reportFailure(input: {
        stepKey: string;
        stepLabel: string;
        message: string;
        kind?: StepFailureKind;
        detail?: string;
        missing?: string[];
        retryable?: boolean;
        stack?: string;
    }): void {
        const failure = createStepFailure(input);
        this.callbacks.onStepFailure?.(failure);
        this.emitDiagnostic('error', 'step', input.message, input.stepKey, input.stepLabel, {
            detail: [input.detail, failure.suggestion].filter(Boolean).join('\n'),
            stack: input.stack,
        });
    }

    // ============================================================
    // 结果持久化（委托给 StepResultSaver）
    // ============================================================
    async saveStepResult(
        stepKey: string,
        content: string,
        chapDir: string,
        chapterName: string,
        volume: string,
        meta?: StepSaveMeta,
    ): Promise<boolean> {
        return this.resultSaver.saveStepResult(stepKey, content, chapDir, chapterName, volume, meta);
    }

    async writeFixToBody(fixContent: string, chapDir: string, chapterName: string, volume: string): Promise<void> {
        return this.resultSaver.writeFixToBody(fixContent, chapDir, chapterName, volume);
    }

    async getEntityNames(project: string) {
        return this.resultSaver.getEntityNames(project);
    }

    /**
     * 提取实体名称（内部使用）
     */
    private async extractEntityNames(project: string) {
        return this.resultSaver.getEntityNames(project);
    }

    // ============================================================
    // 弹窗控制器（委托给 StepModalController）
    // ============================================================
    async executeDeaiRewrite(
        stepResults: Record<string, string>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir: string,
        chapterName: string,
        volume: string,
        stepCompleted: Set<string>,
    ): Promise<void> {
        return this.modalController.executeDeaiRewrite(stepResults, renderInContainer, tabContent, setIsLoading, chapDir, chapterName, volume, stepCompleted);
    }

    async executeIterativeRefine(
        stepResults: Record<string, string>,
        vars: Record<string, string>,
        chapterNum: number,
        buildTemplateVars: () => Promise<Record<string, string>>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir?: string,
        chapterName?: string,
        volume?: string,
        stepCompleted?: Set<string>,
    ): Promise<void> {
        return this.modalController.executeIterativeRefine(stepResults, vars, chapterNum, buildTemplateVars, renderInContainer, tabContent, setIsLoading, chapDir, chapterName, volume, stepCompleted);
    }

    createStepOverlay(tabContent: HTMLElement): { overlay: HTMLElement; panel: HTMLElement } {
        return this.modalController.createStepOverlay(tabContent);
    }

    /**
     * 定向修订：用 qualityControl 的结构化问题驱动维度化 pass。
     * 只替换命中片段，失败/评分下降自动回滚，不会整章重写。
     */
    async executeTargetedRevision(
        stepResults: Record<string, string>,
        chapDir: string,
        chapterName: string,
        volume: string,
        stepCompleted: Set<string>,
    ): Promise<void> {
        const body = stepResults['bodyGeneration'] || '';
        if (!body.trim()) {
            this.callbacks.showError('没有正文可修订');
            return;
        }
        const issues = parseQualityControlReport(stepResults['qualityControl'] || '');
        if (issues.length === 0) {
            this.callbacks.showError('没有可执行的结构化质量问题：请先完成「质量控制」步骤');
            return;
        }

        const config = resolveTaskModelConfig(
            this.plugin.settings,
            'body',
            (model, endpoint) => this.plugin.resolveModelLimits(model, endpoint),
        );
        const tasks = new LongNovelSingleCallTasks(this.aiEngine);
        const issueLines = issues.map(issue => [
            `维度: ${issue.dimension}`,
            `严重级: ${issue.severity}`,
            `证据: ${issue.evidence}`,
            issue.location ? `位置: ${issue.location}` : '',
            issue.suggestion ? `建议: ${issue.suggestion}` : '',
        ].filter(Boolean).join('；'));
        const result = await tasks.targetedRevision(body, issueLines, {
            projectId: chapDir ? chapDir.split('/')[0] : undefined,
        });

        if (!result.ok) {
            const details = [
                result.error,
                ...result.violations.map(v => `${v.ruleId}: ${v.message}`),
            ].filter(Boolean).join('；');
            this.callbacks.showNotice(`定向修订失败：${details}`, NOTICE_WARNING);
            return;
        }

        const changed = (result.value?.dimensions || [])
            .filter(item => item.changed)
            .map(item => item.dimension)
            .join('、');
        const nextBody = result.value?.body || result.raw;
        stepResults['bodyGeneration'] = nextBody;
        await this.saveStepResult('bodyGeneration', nextBody, chapDir, chapterName, volume, {
            model: config.model,
            finishReason: 'stop',
            truncated: false,
        });
        const invalidated = ['qualityControl', 'analysisReport', 'settlement'];
        for (const key of invalidated) stepCompleted.delete(key);
        this.callbacks.invalidateSteps?.(invalidated, true);
        this.callbacks.showSuccess(`定向修订完成：${changed || '已更新正文'}（单次调用，${result.durationMs}ms）`);
    }

    injectDeaiModalStyles(): void {
        this.modalController.injectDeaiModalStyles();
    }

    injectRefineModalStyles(): void {
        this.modalController.injectRefineModalStyles();
    }

    injectRoundSelectStyles(): void {
        this.modalController.injectRoundSelectStyles();
    }

    /**
     * 本步实际可用的窗口/输出上限。
     *
     * 不再从全局 maxContext/maxOutput 起算：全局值会被「最后选择的模型」覆盖，
     * 导致 Flash 的 4K 上限截断正文，或 Pro 的 131K 上限被规划步骤继承。
     * 这里直接取该模型自己的能力值（用户覆盖/本地探测/静态表由 resolveModelLimits 统一）。
     */
    private resolveStepBudgetLimits(model: string): { maxContext: number; maxOutput: number } {
        try {
            const resolved = this.plugin.resolveModelLimits(model);
            return {
                maxContext: resolved.maxContext,
                maxOutput: resolved.maxOutput,
            };
        } catch {
            return { maxContext: 32768, maxOutput: 8192 };
        }
    }

    /**
     * 执行当前步骤的 AI 请求（策略驱动分发）
     */
    async executeCurrentStep(ctx: StepRunCtx): Promise<void> {
        // D3：重试按钮依赖「最近一次执行的上下文」，必须在入口记录，
        // 且要在任何早退分支之前——否则请求失败后按钮拿到的永远是 null。
        this._lastCtx = ctx;

        if (ctx.isLoading) return;

        const currentStep = ALL_FULL_STEPS.find(s => s.index === ctx.currentStepIndex);
        if (!currentStep) return;
        const stepKey = currentStep.key;
        if (!stepKey) return;
        const stepLabel = currentStep.label;
        this.emitEvent('step-start', 'info', `开始执行：${stepLabel}`, stepKey, stepLabel);

        const systemPrompt = ctx.systemPromptEl?.value || '';
        const userPrompt = ctx.userPromptEl?.value || '';
        const temperature = Math.max(0, Math.min(2, parseFloat(ctx.temperatureSlider?.value || '1.4') || 1.4));

        if (!userPrompt.trim()) {
            const message = '用户提示词不能为空';
            this.reportFailure({ stepKey, stepLabel, message, kind: 'validation' });
            this.callbacks.showError(message);
            return;
        }

        ctx.setIsLoading(true);
        this.callbacks.showProgress(`⏳ 执行中: ${currentStep.label}...`);

        const sendBtns = ctx.tabContent.querySelectorAll('.novel-writer-fw-btn-primary, .nw-step-action-primary');
        const originalTexts: string[] = [];
        sendBtns.forEach((b, i) => {
            const btn = b as HTMLButtonElement;
            originalTexts[i] = btn.textContent || '';
            btn.disabled = true;
            btn.classList.add('nw-btn-loading');
            btn.textContent = `⏳ 执行中：${currentStep.label}...`;
        });
        const restoreButtons = () => {
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });
        };

        // 任务级模型/预算：正文用 pro 的输出上限，规划用 flash 的上限，
        // 不再让某一个模型的全局 maxOutput 决定所有步骤。
        const task = resolveTaskForStep(stepKey, currentStep.modelStrategy);
        const taskConfig = resolveTaskModelConfig(
            this.plugin.settings,
            task,
            (modelName, endpoint) => this.plugin.resolveModelLimits(modelName, endpoint),
        );
        const stepModel = taskConfig.model;
        const stepMaxOutput = taskConfig.maxOutput;
        const stepThinking = {
            thinkingMode: taskConfig.thinkingMode,
            thinkingBudget: taskConfig.thinkingBudget,
            endpoint: taskConfig.endpoint,
            apiKey: taskConfig.apiKey,
            disableFallback: taskConfig.sourceType === 'local',
        };

        // fix / finalFix 防御性前置校验（不在 ALL_FULL_STEPS 中，保留兼容）
        if (stepKey === 'fix' || stepKey === 'finalFix') {
            const preResult = preCheckQualityControl(ctx);
            if (!preResult.passed) {
                const message = preResult.error || '前置校验失败';
                this.reportFailure({ stepKey, stepLabel, message, kind: 'validation' });
                this.callbacks.showError(message);
                ctx.setIsLoading(false);
                this.callbacks.hideProgress();
                sendBtns.forEach((b, i) => {
                    const btn = b as HTMLButtonElement;
                    btn.disabled = false;
                    btn.classList.remove('nw-btn-loading');
                    btn.textContent = originalTexts[i] || '';
                });
                return;
            }
            if (preResult.warning) {
                this.callbacks.showNotice(preResult.warning, NOTICE_CRITICAL);
            }
        }

        try {
            // === 特例步骤：独立处理流程（不经过 callAI） ===

            if (stepKey === 'characterSoul') {
                await runCharacterSoulStep(this.specialHost(), ctx, restoreButtons);
                return;
            }

            if (stepKey === 'emotionPlan') {
                await runEmotionPlanStep(this.specialHost(), ctx, stepModel, restoreButtons);
                return;
            }

            if (stepKey === 'sceneExpand') {
                await runSceneExpandStep(this.specialHost(), ctx, stepModel, restoreButtons);
                return;
            }

            // === 策略驱动分发：通用步骤 ===

            // 前置校验
            if (currentStep.preValidation) {
                const preResult = currentStep.preValidation(ctx);
                if (!preResult.passed) {
                    const message = preResult.error || '前置校验失败';
                    this.reportFailure({ stepKey, stepLabel, message, kind: 'validation' });
                    this.callbacks.showError(message);
                    ctx.setIsLoading(false);
                    this.callbacks.hideProgress();
                    sendBtns.forEach((b, i) => {
                        const btn = b as HTMLButtonElement;
                        btn.disabled = false;
                        btn.classList.remove('nw-btn-loading');
                        btn.textContent = originalTexts[i] || '';
                    });
                    return;
                }
                if (preResult.warning) {
                    this.callbacks.showNotice(preResult.warning, NOTICE_CRITICAL);
                }
            }

            // analysisReport 特例：正文变动提示
            if (stepKey === 'analysisReport') {
                if (!ctx.stepCompleted.has('analysisReport') && ctx.stepResults['analysisReport']) {
                    this.callbacks.showNotice('⚠️ 正文内容已变动，分析报告将基于最新正文重新生成', NOTICE_CRITICAL);
                }
            }

            this.callbacks.showProgress(`⏳ AI 请求中: ${currentStep.label}（模型: ${stepModel}）...`);
            this.emitDiagnostic('debug', 'step', `模型=${stepModel}，输出上限=${stepMaxOutput}，温度=${temperature}`, stepKey, stepLabel, {
                detail: `systemPrompt=${systemPrompt.length} 字；userPrompt=${userPrompt.length} 字`,
            });

            // 大纲知识注入 + prompt 预算闸门（装配逻辑见 step-prompt-assembly.ts）
            const promptAssembly = await assembleStepPrompt(
                this.promptAssemblyHost(),
                ctx,
                stepKey,
                systemPrompt,
                userPrompt,
                stepModel,
            );
            const effectiveUserPrompt = promptAssembly.effectiveUserPrompt;
            const effectiveSystemPrompt = promptAssembly.effectiveSystemPrompt;

            const abortCtrl = ctx.getAbortController?.() ?? null;
            const aiStartedAt = Date.now();
            let result: APIResponse;
            if (stepKey === 'bodyGeneration') {
                result = await this.callAIStreamWithRetry(
                    effectiveSystemPrompt,
                    effectiveUserPrompt,
                    stepModel,
                    temperature,
                    stepMaxOutput,
                    currentStep.label,
                    (text, _done) => {
                        this.callbacks.showProgress(`✍️ ${currentStep.label} 实时生成中... (${text.length} 字)`);
                    },
                    abortCtrl?.signal ?? undefined,
                    stepThinking,
                );
            } else {
                result = await this.callAIWithRetry(
                    effectiveSystemPrompt,
                    effectiveUserPrompt,
                    stepModel,
                    temperature,
                    stepMaxOutput,
                    currentStep.label,
                    abortCtrl?.signal ?? undefined,
                    stepThinking,
                );
            }

            this.emitDiagnostic('info', 'api', `AI 返回：finishReason=${result.finishReason || 'unknown'}，输出 ${(result.content || '').length} 字，耗时 ${Date.now() - aiStartedAt}ms`, stepKey, stepLabel, {
                detail: result.usage ? JSON.stringify(result.usage) : undefined,
            });

            if (promptAssembly.truncated) {
                this.emitEvent('step-warning', 'warning', `上下文过长，已截断中间资料（~${promptAssembly.estimatedTokens} tokens）`, stepKey, stepLabel);
                this.callbacks.showNotice(`⚠️ 上下文过长（~${promptAssembly.estimatedTokens} tokens），已自动保留头部+尾部，中间资料已截断。建议在设置中增加上下文上限（maxContext）或精简前文内容。`, NOTICE_CRITICAL);
            }

            ctx.setIsLoading(false);
            this.callbacks.hideProgress();
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });

            // A6: 用户取消后不能把「半章」当成功结果落盘/标记完成
            if (result.finishReason === 'aborted' || abortCtrl?.signal.aborted) {
                this.emitEvent('step-cancelled', 'warning', `${currentStep.label} 已取消，结果未保存`, stepKey, stepLabel);
                this.callbacks.showNotice(`⏹️ ${currentStep.label} 已取消，结果未保存`, NOTICE_WARNING);
                return;
            }

            if (result.error) {
                const message = `${currentStep.label} 失败: ${result.error}`;
                this.reportFailure({
                    stepKey,
                    stepLabel,
                    message,
                    detail: result.error,
                });
                this.callbacks.showError(message);
                return;
            }

            this.warnIfTruncated(result, currentStep.label);

            const truncated = result.finishReason === 'length';
            const stepMeta: StepRunMeta = {
                model: stepModel,
                finishReason: result.finishReason,
                truncated,
                usage: result.usage,
                maxTokens: stepMaxOutput,
            };
            if (!ctx.stepMeta) ctx.stepMeta = {};
            ctx.stepMeta[stepKey] = stepMeta;

            const pendingOutputLen = (result.content || '').length;
            let finalContent = result.content || '';

            // 后置校验
            if (currentStep.postValidation) {
                const postResult = currentStep.postValidation(finalContent, ctx);
                if (!postResult.passed) {
                    const message = postResult.error || '后置校验失败';
                    this.reportFailure({ stepKey, stepLabel, message, kind: 'validation' });
                    this.callbacks.showError(message);
                }
                if (postResult.warning) {
                    this.callbacks.showNotice(postResult.warning, NOTICE_WARNING);
                }
            }

            // qualityControl 情绪审计
            if (stepKey === 'qualityControl' && ctx.stepResults['bodyGeneration']) {
                try {
                    const bodyText = stripFrontmatter(ctx.stepResults['bodyGeneration']);
                    const audit = auditEmotions(bodyText);
                    const auditLines: string[] = [];
                    if (!audit.emotionChange.passed) auditLines.push(`⚠️ 情绪变化: ${audit.emotionChange.detail}`);
                    if (!audit.psychDensity.passed) auditLines.push(`⚠️ 心理密度: ${audit.psychDensity.detail}（连续${audit.psychDensity.consecutiveEmptyCount}段无心理活动）`);
                    if (!audit.relationshipShift.passed) auditLines.push(`⚠️ 关系变化: ${audit.relationshipShift.detail}`);
                    if (!audit.emotionHook.passed) auditLines.push(`⚠️ 情绪钩子: ${audit.emotionHook.detail}`);
                    if (auditLines.length > 0) {
                        finalContent += '\n\n---\n【V2 情绪审计（程序自动检测）】\n' + auditLines.join('\n');
                    }
                    log.info(`[V2] 情绪审计完成: 综合评分 ${audit.overallScore}/100, ${auditLines.length} 项警告`);
                } catch (e) {
                    log.warn('[V2] 情绪审计异常（不影响主流程）:', e);
                }
            }

            // 存储结果
            ctx.stepResults[stepKey] = finalContent;
            if (ctx.generatedThisSession) ctx.generatedThisSession.add(stepKey);

            // fix / finalFix 产出修正后的正文 → 同步更新 bodyGeneration
            // 截断的修正稿不能覆盖内存中的完整正文，否则后续质量/结算会基于半章继续。
            if (!truncated && (stepKey === 'fix' || stepKey === 'finalFix')) {
                ctx.stepResults['bodyGeneration'] = finalContent;
            }

            // 规划变更 → 已生成正文与下游全部失效（正文未生成时不标脏）
            const hasBody = ctx.stepCompleted.has('bodyGeneration')
                || Boolean((ctx.stepResults['bodyGeneration'] || '').trim());
            this.invalidateSteps(ctx, downstreamStepsAfterPlanningChange(stepKey, hasBody));

            // 正文或修正变更 → 标记质量控制/分析/结算失效
            if (['fix', 'finalFix', 'bodyGeneration'].includes(stepKey)) {
                this.invalidateSteps(ctx, ['qualityControl', 'analysisReport', 'settlement']);
            }

            // qualityControl 完成 → 标脏 fix
            if (stepKey === 'qualityControl') {
                this.invalidateSteps(ctx, ['fix']);
            }
            // analysisReport 完成 → 标脏 settlement
            if (stepKey === 'analysisReport') {
                this.invalidateSteps(ctx, ['settlement']);
            }

            // 自动保存文件
            this.callbacks.showProgress(`💾 保存 ${currentStep.label} 结果...`);
            const saved = await this.saveStepResult(stepKey, finalContent, ctx.chapDir, ctx.chapterName, ctx.volume, stepMeta);

            if (saved) {
                // Rev 185：保存成功 ≠ 结构完整。旧实现只要写盘成功就标完成，
                // 模板骨架/残缺输出也会让导航显示 ✅（情节蒸馏、大纲摘要尤甚）。
                const verdict = validateStepResult(stepKey, finalContent);
                if (truncated) {
                    // finish_reason=length 比内容校验更权威：正文可能恰好以句号结尾、
                    // 报告也可能包含“问题/总结”关键词，但结尾仍是被硬截断的。
                    verdict.level = 'partial';
                    verdict.valid = false;
                    if (!verdict.missing.includes('输出被截断')) verdict.missing.push('输出被截断');
                }
                if (verdict.level === 'complete') {
                    ctx.stepCompleted.add(stepKey);
                } else {
                    ctx.stepCompleted.delete(stepKey);
                    // 让工作台的 stepLevels 同步降级，避免导航仍显示“已完成”。
                    ctx.invalidateSteps?.([stepKey], true);
                    const missingHint = verdict.missing.length > 0 ? `：缺少 ${verdict.missing.join('、')}` : '';
                    const truncHint = truncated ? '（输出达到模型上限，已保存草稿）' : '';
                    const noticeMessage = `⚠️ ${currentStep.label} 已保存但内容不完整${missingHint}${truncHint}，可重新生成`;
                    if (truncated) {
                        const truncMessage = `⚠️ ${currentStep.label} 输出被截断（${stepModel} 上限 ${stepMaxOutput} tokens），已保存草稿；请提高该任务输出上限或续写`;
                        this.reportFailure({
                            stepKey,
                            stepLabel,
                            message: truncMessage,
                            kind: 'truncated',
                            missing: verdict.missing,
                            detail: `模型 ${stepModel} 的输出上限为 ${stepMaxOutput} tokens；已保存 ${finalContent.length} 字草稿。`,
                        });
                        this.callbacks.showError(truncMessage, 8000);
                    } else {
                        this.reportFailure({
                            stepKey,
                            stepLabel,
                            message: noticeMessage,
                            kind: 'incomplete',
                            missing: verdict.missing,
                            detail: `步骤 ${stepKey} 已保存 ${finalContent.length} 字，但结构校验未通过。`,
                        });
                        this.callbacks.showNotice(noticeMessage, NOTICE_WARNING);
                    }
                }
                if (ctx.onStepComplete && verdict.level === 'complete') {
                    try {
                        await ctx.onStepComplete(stepKey, finalContent);
                    } catch (e) {
                        log.warn('[StepRunner] onStepComplete 回调异常:', e);
                    }
                }
                if (verdict.level === 'complete') {
                    const successMessage = `${currentStep.label} 完成（输出 ${pendingOutputLen} 字）`;
                    this.emitEvent('step-complete', 'success', successMessage, stepKey, stepLabel);
                    this.emitDiagnostic('info', 'step', successMessage, stepKey, stepLabel);
                    this.callbacks.showSuccess(successMessage);
                }
            } else {
                log.warn(`[StepRunner] ${stepKey} 文件写入失败，stepCompleted 未标记`);
                const message = `❌ ${currentStep.label} 保存失败，请重试`;
                this.reportFailure({ stepKey, stepLabel, message, kind: 'save' });
                this.callbacks.showError(message);
            }

            // analysisReport 成功落盘后记录会话快照（供分析历史/对比）
            if (stepKey === 'analysisReport' && saved) {
                await this.recordAnalysisSession(ctx, finalContent);
            }

            // fix / finalFix 修正后正文覆写 body
            if (!truncated && (stepKey === 'fix' || stepKey === 'finalFix') && ctx.chapDir && ctx.chapterName) {
                await this.writeFixToBody(finalContent, ctx.chapDir, ctx.chapterName, ctx.volume);
            }

            this.callbacks.hideProgress();
            await ctx.renderInContainer(ctx.tabContent);

        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const stack = e instanceof Error ? e.stack : undefined;
            log.error(`[小说工坊] ${currentStep.label} 异常:`, e);
            ctx.setIsLoading(false);
            this.callbacks.hideProgress();
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });
            const message = `${currentStep.label} 异常: ${errMsg}`;
            this.reportFailure({ stepKey, stepLabel, message, detail: errMsg, stack });
            this.callbacks.showError(message);
        }
    }

    /**
     * 记录一次分析会话快照。
     * 快照写入插件数据目录 `.sessions/`，失败不阻断主流程。
     */
    private async recordAnalysisSession(ctx: StepRunCtx, content: string): Promise<void> {
        try {
            const pluginDir = this.plugin.manifest?.dir
                ?? `${this.app.vault.configDir}/plugins/novel-writer-ai`;
            const manager = new AnalysisSessionManager({
                app: { vault: this.app.vault },
                manifest: { dir: pluginDir },
            });
            await manager.loadFromDisk();
            const session = manager.createSession({
                file: `${ctx.chapDir}/${ctx.chapterName}`,
                title: `${ctx.chapterName} · 分析报告`,
                suggestions: [],
                otherResults: { analysisReport: content },
                metadata: {
                    wordCount: content.length,
                    characterCount: 0,
                    layersUsed: ['analysisReport'],
                    durationMs: 0,
                },
            });
            await manager.saveSession(session.id);
        } catch (e) {
            log.warn('[StepRunner] 分析会话快照保存失败（不影响主流程）:', e);
        }
    }

    /**
     * 渲染 AI 请求失败的错误信息
     */
    renderErrorResult(errorMsg: string, stepKey: string, tabContent: HTMLElement): void {
        const promptArea = tabContent.querySelector('.novel-writer-fw-prompt-area');
        if (!promptArea) return;

        // 移除旧的结果区
        const oldResult = promptArea.querySelector('.novel-writer-fw-result-section');
        if (oldResult) oldResult.remove();

        const errorContainer = promptArea.createDiv({ cls: 'novel-writer-fw-result-section' });
        errorContainer.createEl('h4', { text: '❌ AI 请求失败', cls: 'novel-writer-fw-error-title' });
        const errorCard = errorContainer.createDiv({ cls: 'novel-writer-fw-result-card novel-writer-fw-error-card' });
        errorCard.createDiv({ text: errorMsg });

        const retryBtn = errorCard.createEl('button', {
            text: '🔄 重试',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-danger'
        });
        const ctx = this._lastCtx;
        if (!ctx) {
            // 没有上下文时重试必然无反应，直接禁用并说明原因，避免「点了没反应」。
            retryBtn.disabled = true;
            retryBtn.setAttribute('title', '缺少步骤上下文，请重新执行该步骤');
            return;
        }
        retryBtn.onclick = () => {
            errorContainer.remove();
            void this.executeCurrentStep(ctx);
        };
    }

    private _lastCtx: StepRunCtx | null = null;

    /**
     * 移动到下一步骤
     */
    async moveToNextStep(ctx: StepRunCtx): Promise<void> {
        // P2-5: 按 index 字段查找当前步骤，再从 ALL_FULL_STEPS 顺序中取下一个
        const orderIdx = ALL_FULL_STEPS.findIndex(s => s.index === ctx.currentStepIndex);
        const currentStep = orderIdx >= 0 ? ALL_FULL_STEPS[orderIdx] : undefined;
        const stepKey = currentStep?.key;
        const nextStep = orderIdx >= 0 ? ALL_FULL_STEPS[orderIdx + 1] : undefined;
        const nextIndex = nextStep?.index ?? -1;

        if (!nextStep) {
            this.callbacks.showSuccess('所有步骤已完成！');
            return;
        }

        // 回写 currentStepIndex 到实际状态（ctx 是值拷贝，需要回调写回）
        ctx.setCurrentStepIndex(nextIndex);
        ctx.setIsLoading(false);
        await ctx.renderInContainer(ctx.tabContent);
    }

    /**
     * 执行章节结算
     */
    async executeSettlement(
        project: string,
        chapDir: string,
        chapterName: string,
        stepResults: Record<string, string>,
        stepCompleted: Set<string>,
        vars: Record<string, string>,
        plugin: NovelWriterPluginAPI,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        options: { force?: boolean } = {},
    ): Promise<void> {
        const result = await executeSettlementPrimitive(
            this.settlementHost(plugin),
            project,
            chapDir,
            chapterName,
            stepResults,
            stepCompleted,
            vars,
            renderInContainer,
            tabContent,
            options,
        );
        if (result) {
            const chapterNum = parseInt(chapterName.match(/第(\d+)章/)?.[1] || '0', 10);
            await writeChapterStateSnapshot(this.app, {
                project,
                chapterNum,
                chapterName,
                bodyText: stepResults['bodyGeneration'] || '',
                sceneExpansion: stepResults['sceneExpand'] || '',
                updatedChars: result.chars,
            });
        }
    }

    async executeStepsSequential(
        stepKeys: string[],
        baseCtx: StepRunCtx,
        options?: {
            onStepStart?: (stepKey: string) => void;
            onStepComplete?: (stepKey: string, content: string) => void;
            onStepError?: (stepKey: string, error: string) => void;
        }
    ): Promise<{ successful: string[]; failed: string | null; failedAt: number }> {
        return executeStepsSequentialPrimitive(
            {
                executeStep: (ctx: StepRunCtx) => this.executeCurrentStep(ctx),
                prepareStepInputs: (stepKey, ctx) => this.prepareStepInputs(stepKey, ctx),
                createStepInputs: () => {
                    const systemPromptEl = document.createElement('textarea');
                    const userPromptEl = document.createElement('textarea');
                    const temperatureSlider = document.createElement('input');
                    temperatureSlider.type = 'range';
                    temperatureSlider.value = '1.4';
                    return { systemPromptEl, userPromptEl, temperatureSlider };
                },
            },
            stepKeys,
            baseCtx,
            options,
        );
    }

    /**
     * 为“继续生成剩余”装配真实 prompt。
     *
     * 旧实现只创建空 textarea，executeCurrentStep 在空 prompt 处早退，
     * 调用方却把这一步计入 successful。这里复用与批量/单步相同的模板变量。
     */
    private async prepareStepInputs(stepKey: string, ctx: StepRunCtx): Promise<void> {
        if (stepKey === 'characterSoul') {
            // 角色灵魂由 StepRunner 特例流程处理，不经过模板
            return;
        }
        const vars = await ctx.buildTemplateVars();
        Object.assign(ctx.vars, vars);
        const template = getStepTemplateAuto(stepKey, vars);
        if (!template) throw new Error(`缺少步骤模板: ${stepKey}`);
        ctx.systemPromptEl.value = fillTemplate(template.systemPrompt, vars);
        ctx.userPromptEl.value = fillTemplate(template.userPrompt, vars);
    }

    async executePlanningCombined(
        ctx: StepRunCtx,
        options: { signal?: AbortSignal; force?: boolean } = {},
    ): Promise<{ success: boolean; error?: string }> {
        const planningSteps = COMBINED_PLANNING_STEP_KEYS;
        const alreadyDone = planningSteps.filter(s => ctx.stepCompleted.has(s));
        if (alreadyDone.length === planningSteps.length && !options.force) {
            return { success: true };
        }
        if (options.signal?.aborted) return { success: false, error: 'aborted' };

        const vars = await ctx.buildTemplateVars();
        const { system: sysFilled, user: userFilled } = buildCombinedPlanningPrompts(vars);

        // 合一规划也要吃指纹知识：单步路径会分别注入大纲/情绪/Scene 知识，一键路径此前完全没有
        let knowledgeTail = '';
        try {
            const parts = await Promise.all([
                this.loadOutlineKnowledge(ctx),
                this.injectEmotionPlanKnowledge(ctx),
                this.injectSceneExpandKnowledge(ctx),
            ]);
            knowledgeTail = parts.filter((p) => p && p.trim()).join('\n\n');
        } catch (e) {
            log.warn('[PlanningCombined] 知识注入失败，跳过:', e);
        }

        // 合并规划同样要过预算闸门：模板现在带世界观/设定库/文笔，本地小窗口模型必须裁剪
        const planningConfig = resolveTaskModelConfig(
            this.plugin.settings,
            'planning',
            (modelName, endpoint) => this.plugin.resolveModelLimits(modelName, endpoint),
        );
        const flashModel = planningConfig.model;
        const flashLimits = {
            maxContext: planningConfig.maxContext,
            maxOutput: planningConfig.maxOutput,
        };
        const fit = fitPromptToContext({
            systemPrompt: sysFilled,
            userPrompt: userFilled,
            extraTail: knowledgeTail,
            maxContext: flashLimits.maxContext,
            maxOutput: flashLimits.maxOutput,
            modelId: flashModel,
            headRatio: getBusinessThreshold('promptSplitRatio'),
            sectionAware: true,
        });
        if (fit.truncated) {
            this.callbacks.showNotice('⚠️ 合并规划 prompt 过长，已按优先级省略部分段落', NOTICE_WARNING);
        }
        if (fit.droppedExtra) {
            this.callbacks.showNotice('⚠️ 上下文不足，已跳过合并规划的知识注入', NOTICE_WARNING);
        }
        const effectiveUserPrompt = fit.user;

        const sendBtns = ctx.tabContent.querySelectorAll('.novel-writer-fw-btn-primary, .nw-step-action-primary');
        const originalTexts: string[] = [];
        sendBtns.forEach((b, i) => {
            const btn = b as HTMLButtonElement;
            originalTexts[i] = btn.textContent || '';
            btn.disabled = true;
            btn.classList.add('nw-btn-loading');
            btn.textContent = '⏳ 生成全章规划中...';
        });

        ctx.setIsLoading(true);
        this.callbacks.showProgress('⏳ 生成全章规划（合并模式）...');

        try {
            const result: APIResponse = await this.callAIWithRetry(
                sysFilled,
                effectiveUserPrompt,
                flashModel,
                1.4,
                flashLimits.maxOutput,
                '章节规划（合并）',
                options.signal,
                {
                    thinkingMode: planningConfig.thinkingMode,
                    thinkingBudget: planningConfig.thinkingBudget,
                    endpoint: planningConfig.endpoint,
                    apiKey: planningConfig.apiKey,
                    disableFallback: planningConfig.sourceType === 'local',
                },
            );

            if (result.error) {
                this.callbacks.showError(`章节规划失败: ${result.error}`);
                return { success: false, error: result.error };
            }

            const content = result.content || '';
            const parsed = parseCombinedPlanning(content);
            // 完整性判定单独成纯函数：本次有效产出、仍缺失、是否满足继续写正文的最低条件
            // Rev 185：generated 必须再通过结构校验，否则「字符数够但缺模块」的残缺输出也会被标完成
            const evaluation = evaluateCombinedPlanning(
                parsed,
                options.force ? new Set<string>() : ctx.stepCompleted,
                undefined,
                (key, moduleContent) => validateStepResult(key, moduleContent).level === 'complete',
            );

            const combinedMeta: StepRunMeta = {
                model: flashModel,
                finishReason: result.finishReason,
                truncated: result.finishReason === 'length',
                usage: result.usage,
                maxTokens: flashLimits.maxOutput,
            };
            for (const stepKey of evaluation.generated) {
                const stepContent = parsed[stepKey];
                ctx.stepResults[stepKey] = stepContent;
                ctx.stepCompleted.add(stepKey);
                if (!ctx.stepMeta) ctx.stepMeta = {};
                ctx.stepMeta[stepKey] = combinedMeta;
                try {
                    await ctx.saveStepResult(stepKey, stepContent, combinedMeta);
                } catch (e) {
                    log.warn(`[PlanningCombined] 保存 ${stepKey} 失败:`, e);
                }
                if (ctx.onStepComplete) {
                    try {
                        await ctx.onStepComplete(stepKey, stepContent);
                    } catch (e) {
                        log.warn(`[PlanningCombined] onStepComplete ${stepKey} 异常:`, e);
                    }
                }
            }

            if (result.finishReason === 'length') {
                this.callbacks.showNotice('⚠️ 合并规划输出被截断，缺失模块请单独生成', NOTICE_WARNING);
            }

            // 合并规划与单步路径共用同一条失效传播：规划内容变了，
            // 已生成的正文/质量/分析/结算都必须降级，避免旧正文被当成有效结果。
            const hasBody = ctx.stepCompleted.has('bodyGeneration')
                || Boolean((ctx.stepResults['bodyGeneration'] || '').trim());
            for (const generatedKey of evaluation.generated) {
                this.invalidateSteps(ctx, downstreamStepsAfterPlanningChange(generatedKey, hasBody));
            }

            const { missing, requiredReady } = evaluation;
            if (requiredReady) {
                this.advanceAfterPlanning(ctx);
                if (missing.length > 0) {
                    this.callbacks.showNotice(`⚠️ 合并规划完成，但缺少：${missing.join('、')}。可点击「继续生成剩余」补齐`, NOTICE_WARNING);
                } else {
                    this.callbacks.showProgress('✅ 全章规划生成完成');
                }
                setTimeout(() => this.callbacks.hideProgress(), 1500);
                return { success: true };
            }

            const missingText = missing.length > 0 ? missing.join('、') : '信息规划或大纲';
            this.callbacks.showError(`⚠️ 规划生成不完整（缺少 ${missingText}）。请单独生成缺失步骤后再写正文`);
            return { success: false, error: 'incomplete' };

        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            this.callbacks.showError(`章节规划失败: ${errMsg}`);
            return { success: false, error: errMsg };
        } finally {
            ctx.setIsLoading(false);
            this.callbacks.hideProgress();
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });
        }
    }

    /**
     * 规划阶段生成结束后推进步骤：
     * - 5 个规划步骤全部完成 → 直接进入正文写作（index 7）
     * - 仍有缺失 → 定位到第一个缺失的规划步骤，避免停留在旧步骤反复生成
     */
    private advanceAfterPlanning(ctx: StepRunCtx): void {
        const targetIndex = calcStepIndexAfterPlanning(ctx.stepCompleted);
        if (targetIndex >= 0) ctx.setCurrentStepIndex(targetIndex);
    }

}

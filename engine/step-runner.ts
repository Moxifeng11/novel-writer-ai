import { App, TFile } from 'obsidian';
import { AIEngine, APIResponse } from './ai-engine';
import { DEAI_CHECK_SYSTEM_PROMPT, DEAI_CHECK_USER_TEMPLATE, DEAI_REWRITE_SYSTEM_PROMPT, DEAI_REWRITE_USER_TEMPLATE, SELF_CHECK_PROMPTS } from './prompt-templates';
import { getChapterFileName, CHAPTER_FILE_TYPES, findChapterFile } from './chapter-utils';
import { mkdirp, stripFrontmatter } from '../utils/helpers';
import { SettlementEngine } from './settlement-engine';
import { ENGINE_NAMES } from './engine-registry';
import { DEFAULT_CONTEXT_WINDOW, CHAR_TO_TOKEN_RATIO, TOKEN_SAFE_BUFFER, PROMPT_SPLIT_RATIO, NOTICE_ERROR, NOTICE_WARNING, NOTICE_CRITICAL } from '../shared/thresholds';
import { generateEmotionPlan, validateEmotionPlan } from './emotion-planner';
import { generateSceneExpansion, validateSceneExpansion } from './scene-expander';
import { auditEmotions } from './emotion-auditor';
import { KnowledgeInjector } from './knowledge-injector';
import { WritingProfileManager } from './writing-profile';
import { pjBodyFile, pjBodyDir, pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir, pjNarrativeOverview } from '../shared/paths';
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { StepResultSaver } from './step-result-saver';
import { StepModalController } from './step-modal-controller';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';

// ============================================================
// 步骤定义（从 step-definitions.ts 重新导出，保持外部零修改）
// ============================================================
export { ALL_FULL_STEPS, STEP_INDEX_MIGRATION_MAP, migrateStepIndex, preCheckQualityControl } from './step-definitions';
export type { FullStep, StepRunCtx, ModelStrategy, PreValidationFn, PostValidationFn } from './step-definitions';
import type { StepRunCtx, ModelStrategy } from './step-definitions';
import { ALL_FULL_STEPS, preCheckQualityControl } from './step-definitions';
import { createLogger } from '../shared/logger';


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
 * - Step 7（bodyGeneration）已标记为 deprecated，为 v5.0 之前的旧模式
 * - 推荐使用 CoWriterEngine（句级协同写作）生成正文
 * - 两条路径数据完全兼容：共享同一正文文件和 stepResults['bodyGeneration']
 * - 本类中的 bodyGeneration 处理逻辑仅作兼容保留，不再新增功能
 */
export class StepRunner {
    private aiEngine: AIEngine;
    private settlementEngine: SettlementEngine;
    private callbacks: StepRunnerCallbacks;
    private resultSaver: StepResultSaver;
    private modalController: StepModalController;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_DELAY_MS = 1000;

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
        });
    }

    private async callAIWithRetry(
        systemPrompt: string,
        userPrompt: string,
        model: string,
        temperature: number,
        maxTokens: number,
        stepLabel: string
    ): Promise<APIResponse> {
        let lastError: Error | undefined;
        const maxRetries = StepRunner.MAX_RETRIES;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    const delay = StepRunner.RETRY_DELAY_MS * Math.pow(2, attempt - 2);
                    this.callbacks.showProgress(`⏳ ${stepLabel} 重试中 (${attempt}/${maxRetries})，等待 ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const result = await this.aiEngine.callAI(
                    systemPrompt,
                    userPrompt,
                    model,
                    temperature,
                    maxTokens
                );

                if (!result.error) {
                    return result;
                }

                lastError = new Error(result.error);
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
            }

            if (attempt < maxRetries) {
                log.warn(`[StepRunner] ${stepLabel} 第 ${attempt} 次调用失败:`, lastError?.message);
            }
        }

        log.error(`[StepRunner] ${stepLabel} 调用失败，已重试 ${maxRetries} 次:`, lastError?.message);
        throw lastError || new Error('AI 调用失败');
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
    // 结果持久化（委托给 StepResultSaver）
    // ============================================================
    async saveStepResult(
        stepKey: string,
        content: string,
        chapDir: string,
        chapterName: string,
        volume: string,
    ): Promise<boolean> {
        return this.resultSaver.saveStepResult(stepKey, content, chapDir, chapterName, volume);
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
     * 执行当前步骤的 AI 请求（策略驱动分发）
     */
    async executeCurrentStep(ctx: StepRunCtx): Promise<void> {
        if (ctx.isLoading) return;

        const currentStep = ALL_FULL_STEPS.find(s => s.index === ctx.currentStepIndex);
        if (!currentStep) return;
        const stepKey = currentStep.key;
        if (!stepKey) return;

        const systemPrompt = ctx.systemPromptEl?.value || '';
        const userPrompt = ctx.userPromptEl?.value || '';
        const temperature = Math.max(0, Math.min(2, parseFloat(ctx.temperatureSlider?.value || '1.4') || 1.4));

        if (!userPrompt.trim()) {
            this.callbacks.showError('用户提示词不能为空');
            return;
        }

        ctx.setIsLoading(true);
        this.callbacks.showProgress(`⏳ 执行中: ${currentStep.label}...`);

        const sendBtns = ctx.tabContent.querySelectorAll('.novel-writer-fw-btn-primary');
        const originalTexts: string[] = [];
        sendBtns.forEach((b, i) => {
            const btn = b as HTMLButtonElement;
            originalTexts[i] = btn.textContent || '';
            btn.disabled = true;
            btn.classList.add('nw-btn-loading');
            btn.textContent = `⏳ 执行中：${currentStep.label}...`;
        });

        // 策略模型映射
        const strategyModelMap: Record<ModelStrategy, string> = {
            'pro': this.plugin.settings.proModel,
            'flash': this.plugin.settings.flashModel,
            'default': this.plugin.settings.defaultModel,
        };
        const stepModel = strategyModelMap[currentStep.modelStrategy];

        // fix / finalFix 防御性前置校验（不在 ALL_FULL_STEPS 中，保留兼容）
        if (stepKey === 'fix' || stepKey === 'finalFix') {
            const preResult = preCheckQualityControl(ctx);
            if (!preResult.passed) {
                this.callbacks.showError(preResult.error || '前置校验失败');
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
                ctx.setIsLoading(false);
                this.callbacks.hideProgress();
                sendBtns.forEach((b, i) => {
                    const btn = b as HTMLButtonElement;
                    btn.disabled = false;
                    btn.classList.remove('nw-btn-loading');
                    btn.textContent = originalTexts[i] || '';
                });
                const coresData = ctx.vars.characterCores || '';
                ctx.stepResults['characterSoul'] = coresData;
                const saved = await this.saveStepResult('characterSoul', coresData, ctx.chapDir, ctx.chapterName, ctx.volume);
                if (saved) {
                    ctx.stepCompleted.add('characterSoul');
                    if (ctx.onStepComplete) {
                        try {
                            await ctx.onStepComplete('characterSoul', coresData);
                        } catch (e) {
                            log.warn('[StepRunner] onStepComplete 回调异常:', e);
                        }
                    }
                    this.callbacks.showSuccess('🫀 角色灵魂提取完成');
                } else {
                    log.warn('[StepRunner] characterSoul 文件写入失败，stepCompleted 未标记');
                    this.callbacks.showError('❌ 角色灵魂提取保存失败，请重试');
                }
                await ctx.renderInContainer(ctx.tabContent);
                return;
            }

            if (stepKey === 'emotionPlan') {
                let emotionKnowledgeInjection = '';
                try {
                    // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
                    const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
                    const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
                    const profile = await profileManager.load(ctx.project);
                    if (profile && profile.fingerprint.injectionStrength > 0) {
                        emotionKnowledgeInjection = await injector.injectForEmotionPlan(profile, {
                            projectPath: ctx.project,
                            chapterIndex: ctx.chapterNum,
                            outline: ctx.vars.outlineContent || ctx.stepResults['outline'] || '',
                        });
                    }
                } catch (e) {
                    log.warn('[StepRunner] 情绪规划知识注入失败，跳过:', e);
                }

                const varsWithInjection = { ...ctx.vars };
                if (emotionKnowledgeInjection) {
                    varsWithInjection.emotionKnowledge = emotionKnowledgeInjection;
                }

                const emoContent = await generateEmotionPlan(this.aiEngine, this.app, varsWithInjection, stepModel);
                const validation = validateEmotionPlan(emoContent);
                if (!validation.valid) {
                    this.callbacks.showNotice(`⚠️ 情绪规划校验异常：${validation.errors.join('；')}`, NOTICE_CRITICAL);
                }
                ctx.stepResults['emotionPlan'] = emoContent;
                const saved = await this.saveStepResult('emotionPlan', emoContent, ctx.chapDir, ctx.chapterName, ctx.volume);
                ctx.vars.emotionPlan = emoContent;
                ctx.setIsLoading(false);
                this.callbacks.hideProgress();
                sendBtns.forEach((b, i) => {
                    const btn = b as HTMLButtonElement;
                    btn.disabled = false;
                    btn.classList.remove('nw-btn-loading');
                    btn.textContent = originalTexts[i] || '';
                });
                if (saved) {
                    ctx.stepCompleted.add('emotionPlan');
                    if (ctx.onStepComplete) {
                        try {
                            await ctx.onStepComplete('emotionPlan', emoContent);
                        } catch (e) {
                            log.warn('[StepRunner] onStepComplete 回调异常:', e);
                        }
                    }
                    this.callbacks.showSuccess('🎭 情绪规划完成');
                } else {
                    log.warn('[StepRunner] emotionPlan 文件写入失败，stepCompleted 未标记');
                    this.callbacks.showError('❌ 情绪规划保存失败，请重试');
                }
                await ctx.renderInContainer(ctx.tabContent);
                return;
            }

            if (stepKey === 'sceneExpand') {
                let sceneKnowledgeInjection = '';
                try {
                    // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
                    const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
                    const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
                    const profile = await profileManager.load(ctx.project);
                    if (profile && profile.fingerprint.injectionStrength > 0) {
                        sceneKnowledgeInjection = await injector.injectForSceneExpand(profile, {
                            projectPath: ctx.project,
                            chapterIndex: ctx.chapterNum,
                            outline: ctx.vars.outlineContent || ctx.stepResults['outline'] || '',
                            emotionPlan: ctx.vars.emotionPlan || ctx.stepResults['emotionPlan'] || '',
                        });
                    }
                } catch (e) {
                    log.warn('[StepRunner] Scene展开知识注入失败，跳过:', e);
                }

                const varsWithInjection = { ...ctx.vars };
                if (sceneKnowledgeInjection) {
                    varsWithInjection.sceneKnowledge = sceneKnowledgeInjection;
                }

                const sceneContent = await generateSceneExpansion(this.aiEngine, varsWithInjection, stepModel);
                const validation = validateSceneExpansion(sceneContent);
                if (!validation.valid) {
                    this.callbacks.showNotice(`⚠️ Scene展开校验异常：${validation.errors.join('；')}`, NOTICE_CRITICAL);
                }
                ctx.stepResults['sceneExpand'] = sceneContent;
                const saved = await this.saveStepResult('sceneExpand', sceneContent, ctx.chapDir, ctx.chapterName, ctx.volume);
                ctx.vars.sceneExpansion = sceneContent;
                ctx.setIsLoading(false);
                this.callbacks.hideProgress();
                sendBtns.forEach((b, i) => {
                    const btn = b as HTMLButtonElement;
                    btn.disabled = false;
                    btn.classList.remove('nw-btn-loading');
                    btn.textContent = originalTexts[i] || '';
                });
                if (saved) {
                    ctx.stepCompleted.add('sceneExpand');
                    if (ctx.onStepComplete) {
                        try {
                            await ctx.onStepComplete('sceneExpand', sceneContent);
                        } catch (e) {
                            log.warn('[StepRunner] onStepComplete 回调异常:', e);
                        }
                    }
                    this.callbacks.showSuccess('🎬 Scene展开完成');
                } else {
                    log.warn('[StepRunner] sceneExpand 文件写入失败，stepCompleted 未标记');
                    this.callbacks.showError('❌ Scene展开保存失败，请重试');
                }
                await ctx.renderInContainer(ctx.tabContent);
                return;
            }

            // === 策略驱动分发：通用步骤 ===

            // 前置校验
            if (currentStep.preValidation) {
                const preResult = currentStep.preValidation(ctx);
                if (!preResult.passed) {
                    this.callbacks.showError(preResult.error || '前置校验失败');
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

            // 大纲摘要步骤注入知识（风格 + 节奏 + 题材）
            let outlineKnowledgeInjection = '';
            if (stepKey === 'outline') {
                try {
                    // 通过 EngineRegistry 获取共享实例，避免多实例状态不同步
                    const profileManager = this.plugin.engineRegistry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
                    const injector = this.plugin.engineRegistry.get<KnowledgeInjector>(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
                    const profile = await profileManager.load(ctx.project);
                    if (profile && profile.fingerprint.injectionStrength > 0) {
                        outlineKnowledgeInjection = await injector.injectForOutline(profile, {
                            projectPath: ctx.project,
                            chapterIndex: ctx.chapterNum,
                            outline: ctx.vars.outlineContent || '',
                        });
                    }
                } catch (e) {
                    log.warn('[StepRunner] 大纲摘要知识注入失败，跳过:', e);
                }
            }

            // prompt 长度校验
            let effectiveUserPrompt = userPrompt;
            if (outlineKnowledgeInjection) {
                effectiveUserPrompt = effectiveUserPrompt + '\n\n' + outlineKnowledgeInjection;
            }
            const totalChars = systemPrompt.length + userPrompt.length;
            const maxContext = this.plugin.settings.maxContext || DEFAULT_CONTEXT_WINDOW;
            const estimatedTokens = Math.ceil(totalChars / CHAR_TO_TOKEN_RATIO);
            const safeThreshold = maxContext - (this.plugin.settings.maxOutput || 4096) - TOKEN_SAFE_BUFFER;
            if (estimatedTokens > safeThreshold) {
                log.warn(`[StepRunner] prompt 过长: ~${estimatedTokens}t > ${safeThreshold}t 安全线, 截断尾部变量`);
                const splitPoint = Math.floor(userPrompt.length * PROMPT_SPLIT_RATIO);
                const tailKeep = Math.min(2500, Math.floor(userPrompt.length * 0.25));
                const headKeep = Math.max(0, splitPoint - tailKeep);
                effectiveUserPrompt = userPrompt.slice(0, headKeep)
                    + `\n\n[⚠️ 上下文过长（~${estimatedTokens} tokens），已自动保留头部+尾部，中间资料已截断]\n\n`
                    + userPrompt.slice(userPrompt.length - tailKeep);
            }

            const result: APIResponse = await this.callAIWithRetry(
                systemPrompt,
                effectiveUserPrompt,
                stepModel,
                temperature,
                this.plugin.settings.maxOutput,
                currentStep.label
            );

            if (estimatedTokens > safeThreshold) {
                this.callbacks.showNotice(`⚠️ 上下文过长（~${estimatedTokens} tokens），已自动保留头部+尾部，中间资料已截断。建议在设置中增加上下文上限（maxContext）或精简前文内容。`, NOTICE_CRITICAL);
            }

            ctx.setIsLoading(false);
            this.callbacks.hideProgress();
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });

            if (result.error) {
                this.callbacks.showError(`${currentStep.label} 失败: ${result.error}`);
                this.renderErrorResult(result.error, stepKey, ctx.tabContent);
                return;
            }

            const pendingOutputLen = (result.content || '').length;
            let finalContent = result.content || '';

            // 后置校验
            if (currentStep.postValidation) {
                const postResult = currentStep.postValidation(finalContent, ctx);
                if (!postResult.passed) {
                    this.callbacks.showError(postResult.error || '后置校验失败');
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
            if (stepKey === 'fix' || stepKey === 'finalFix') {
                ctx.stepResults['bodyGeneration'] = finalContent;
            }

            // 正文或修正变更 → 标记质量控制/分析/结算失效
            if (['fix', 'finalFix', 'bodyGeneration'].includes(stepKey)) {
                ctx.stepCompleted.delete('qualityControl');
                ctx.stepCompleted.delete('analysisReport');
                ctx.stepCompleted.delete('settlement');
            }

            // qualityControl 完成 → 标脏 fix
            if (stepKey === 'qualityControl') {
                ctx.stepCompleted.delete('fix');
            }
            // analysisReport 完成 → 标脏 settlement
            if (stepKey === 'analysisReport') {
                ctx.stepCompleted.delete('settlement');
            }

            // 自动保存文件
            this.callbacks.showProgress(`💾 保存 ${currentStep.label} 结果...`);
            const saved = await this.saveStepResult(stepKey, finalContent, ctx.chapDir, ctx.chapterName, ctx.volume);

            if (saved) {
                ctx.stepCompleted.add(stepKey);
                if (ctx.onStepComplete) {
                    try {
                        await ctx.onStepComplete(stepKey, finalContent);
                    } catch (e) {
                        log.warn('[StepRunner] onStepComplete 回调异常:', e);
                    }
                }
                this.callbacks.showSuccess(`${currentStep.label} 完成（输出 ${pendingOutputLen} 字）`);
            } else {
                log.warn(`[StepRunner] ${stepKey} 文件写入失败，stepCompleted 未标记`);
                this.callbacks.showError(`❌ ${currentStep.label} 保存失败，请重试`);
            }

            // fix / finalFix 修正后正文覆写 body
            if ((stepKey === 'fix' || stepKey === 'finalFix') && ctx.chapDir && ctx.chapterName) {
                await this.writeFixToBody(finalContent, ctx.chapDir, ctx.chapterName, ctx.volume);
            }

            this.callbacks.hideProgress();
            await ctx.renderInContainer(ctx.tabContent);

        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`[小说工坊] ${currentStep.label} 异常:`, e);
            ctx.setIsLoading(false);
            this.callbacks.hideProgress();
            sendBtns.forEach((b, i) => {
                const btn = b as HTMLButtonElement;
                btn.disabled = false;
                btn.classList.remove('nw-btn-loading');
                btn.textContent = originalTexts[i] || '';
            });
            this.callbacks.showError(`${currentStep.label} 异常: ${errMsg}`);
            this.renderErrorResult(`执行异常: ${errMsg}`, stepKey, ctx.tabContent);
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
        retryBtn.onclick = () => {
            errorContainer.remove();
            if (ctx) this.executeCurrentStep(ctx);
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
    ): Promise<void> {
        if (!chapDir) return;

        // v1.3.0: 从内存读取分析报告，如果为空则尝试从磁盘文件恢复（P0修复）
        let reportContent = stepResults['analysisReport'] || '';
        if (!reportContent) {
            // 回退：从磁盘读取分析报告文件（重启后内存丢失但文件仍存在）
            const reportPath = `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.analysisReport)}`;
            const reportFile = this.getVaultMeta().getAbstractFileByPath(reportPath);
            if (reportFile instanceof TFile) {
                try {
                    reportContent = await this.getFS().read(reportPath);
                    // 将读取到的内容也恢复到内存 stepResults 中
                    stepResults['analysisReport'] = reportContent;
                } catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    log.warn('[StepRunner] 无法从磁盘读取分析报告:', e);
                    this.callbacks.showNotice(`⚠️ 读取分析报告失败：${errMsg}`, NOTICE_ERROR);
                }
            }
        }

        // v1.3.0: 前置检查 — 分析报告必须包含有效指令才能结算
        if (!reportContent.match(/(UPDATE_|NEW_|RELATION:|GROWTH:|EMOTION:)/)) {
            this.callbacks.hideProgress();
            this.callbacks.showError('⚠️ 分析报告为空或不含有效更新指令。请先执行「📊 分析报告」步骤，确保 AI 提取了元素变化后再执行结算。');
            return; // 不标记 settlement 完成，允许用户补跑分析报告后重新触发
        }

        this.callbacks.showProgress('⏳ 执行章节结算...');
        const bodyText = stepResults['bodyGeneration'] || '';
        const chapName = chapterName;

        // 解析强制揭示
        const forcedRevealHint = vars?.['forcedRevealHint'] || '';
        const forceReveal: string[] = [];
        if (forcedRevealHint) {
            const nameMatches = forcedRevealHint.match(/揭示[：:]\s*(.+?)(?=\n|$)/)?.[1];
            if (nameMatches) {
                for (const name of nameMatches.split(/[,，、]/)) {
                    const n = name.trim();
                    if (n) forceReveal.push(n);
                }
            }
            // P2-3: 空结果检测 — forcedRevealHint 非空但未解析出任何名字时反馈
            if (forceReveal.length === 0) {
                log.warn('[小说工坊] forcedRevealHint 非空但未解析出名字，输入:', forcedRevealHint.slice(0, 100));
                this.callbacks.showNotice('⚠️ 强制揭示提示未识别出任何名字（请用「揭示：名字1, 名字2」格式）', NOTICE_ERROR);
            }
        }

        try {
            const result = await this.settlementEngine.settle(
                project, chapDir, chapName, reportContent, bodyText,
                { forceReveal: forceReveal.length > 0 ? forceReveal : undefined }
            );

            stepCompleted.add('settlement');
            this.callbacks.hideProgress();
            // v3.4.8 Batch-2: 结算结果汇总通知（settlement引擎 22+ 处静默吞错 → 汇总为1条Notice）
            const summary: string[] = [];
            if (result.created > 0) summary.push(`新创 ${result.created} 项`);
            if (result.updated > 0) summary.push(`更新 ${result.updated} 项`);
            if (result.created === 0 && result.updated === 0) {
                this.callbacks.showSuccess('章节结算完成（无新增或更新）');
            } else {
                this.callbacks.showSuccess(`章节结算完成（${summary.join('，')}）`);
            }

            // v3.5.0: 结算后生成叙事总览
            try {
                const overview = await this.settlementEngine.generateNarrativeOverview(project);
                const overviewPath = pjNarrativeOverview(project);
                const existing = this.getVaultMeta().getAbstractFileByPath(overviewPath);
                if (existing) {
                    await this.getFS().write(overviewPath, overview);
                } else {
                    await this.getFS().write(overviewPath, overview);
                }
                log.warn('[StepRunner] 叙事总览已更新:', overviewPath);
            } catch (e) { log.warn('[StepRunner] 叙事总览生成失败（不影响结算）:', e); this.callbacks.showNotice('[StepRunner] 叙事总览生成失败，请稍后重试'); }

            // 通过事件总线通知统一工作台刷新上下文
            plugin.app.workspace.trigger('novel-writer:refresh-context-panel', {});
        } catch (e) {
            this.callbacks.hideProgress();
            this.callbacks.showError(`章节结算失败: ${(e as Error).message}`);
        }

        await renderInContainer(tabContent);
    }

}

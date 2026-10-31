import { App } from 'obsidian';
import NovelWriterPlugin from '../main';
import type { ChapterContext, ReviewContext, OutlineSettings, WorldElements } from './ai-types';
import { buildChapterPrompts as buildChapterPromptsFn, buildUserPrompt as buildUserPromptFn } from './ai-prompt-builder';
import { clampBudgetToModelLimits } from '../shared/prompt-budget';
import { DEFAULT_CONTEXT_WINDOW } from '../shared/thresholds';
import { BodyWriter } from './body-writer';
import type { BodyFormatContract } from '../shared/body-format';
import { AIApiClient } from './ai-api-client';
import { ChapterHelpers } from './ai-chapter-helpers';
import { WorldviewGenerator } from './ai-worldview-generator';
import type { WorldviewGenerationResult } from './ai-worldview-generator';
import { OutlineGenerator } from './ai-outline-generator';
import { CharacterGenerator } from './ai-character-generator';
import { EntityGenerator } from './ai-entity-generator';
import { BatchEntityGenerator } from './ai-batch-entity-generator';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { KnowledgeInjector } from './knowledge-injector';
import { WritingProfileManager } from './writing-profile';
import { ENGINE_NAMES } from '../shared/engine-names';
import { WorldviewCacheService } from '../services/worldview-cache-service';
import { createLogger } from '../shared/logger';
import type { ThinkingMode } from '../shared/task-model';
import type { APIResponse } from '../shared/api-types';

export type { APIResponse } from '../shared/api-types';


const log = createLogger('AiEngine');
export interface BatchEntityResult {
    name: string;
    content: string;
}

export class AIEngine {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private chapterHelpers: ChapterHelpers;
    private worldviewGen: WorldviewGenerator;
    private outlineGen: OutlineGenerator;
    private characterGen: CharacterGenerator;
    private entityGen: EntityGenerator;
    private batchEntityGen: BatchEntityGenerator;
    private bodyWriter: BodyWriter | null = null;

    static getMaxConcurrent(modelId: string): number {
        return AIApiClient.getMaxConcurrent(modelId);
    }

    get sessionTokens() { return this.apiClient.sessionTokens; }

    resetSessionTokens(): void {
        this.apiClient.resetSessionTokens();
    }

    getPlugin(): NovelWriterPlugin {
        return this.plugin;
    }

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
        this.plugin = plugin;
        this.notifier = notifier || NOOP_NOTIFIER;
        this.apiClient = new AIApiClient(plugin, this.notifier);
        this.chapterHelpers = new ChapterHelpers(plugin, this.apiClient, this.notifier);
        this.worldviewGen = new WorldviewGenerator(plugin, this.apiClient, this.notifier);
        this.outlineGen = new OutlineGenerator(plugin, this.apiClient, this.notifier);
        this.characterGen = plugin.engineRegistry.get(ENGINE_NAMES.CHARACTER_GENERATOR);
        this.entityGen = new EntityGenerator(plugin, this.apiClient, this.notifier);
        this.batchEntityGen = new BatchEntityGenerator(plugin, this.apiClient, this.notifier);

        const cacheService = plugin.engineRegistry.getOrNull(ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE);
        if (cacheService) {
            this.worldviewGen.setCacheService(cacheService);
        }
    }

    /** 正文 prompt 与落盘共用同一份格式契约（来自项目「写作规则.md」），懒加载以兼容原型实例化 */
    private getBodyWriter(): BodyWriter {
        if (!this.bodyWriter) {
            this.bodyWriter = new BodyWriter({ app: this.plugin?.app });
        }
        return this.bodyWriter;
    }

    async callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens?: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; bypassCache?: boolean; allowKeyPrompt?: boolean; numCtx?: number; disableFallback?: boolean; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): Promise<APIResponse> {
        // 输出预算交给 AIApiClient#resolveMaxOutput 统一处理：
        // 优先用户为具体模型配置的 maxOutput，其次静态能力表。
        // 这里不再用静态表预截断，否则 deepseek-flash 这类未登记模型会被压到 4096。
        const effectiveMaxTokens = maxTokens ?? this.plugin.settings.maxOutput ?? 4096;
        return this.apiClient.callAI(systemPrompt, userPrompt, model, temperature, effectiveMaxTokens, options);
    }

    /**
     * 实体补全统一入口：人物走 CharacterGenerator，其余走 BatchEntityGenerator。
     * 返回 null 表示补全失败；调用方必须复检后才允许落盘。
     */
    async repairEntity(
        kind: 'characters' | 'factions' | 'locations' | 'items',
        name: string,
        content: string,
        missingFields: string[],
        worldview = ''
    ): Promise<string | null> {
        try {
            if (kind === 'characters') {
                const completed = await this.characterGen.completeCharacter(content, missingFields, undefined, {
                    worldview,
                });
                return completed?.trim() || null;
            }
            const entityType = kind === 'factions' ? '势力' : kind === 'locations' ? '地点' : '物品/功法';
            return await this.batchEntityGen.repairEntity(entityType, name, content, missingFields, worldview);
        } catch (e) {
            log.warn('[AiEngine] 实体补全失败:', e instanceof Error ? e.message : e);
            return null;
        }
    }

    async callAIStream(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens?: number,
        onChunk?: (text: string, done: boolean) => void,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): Promise<APIResponse> {
        const effectiveMaxTokens = maxTokens ?? this.plugin.settings.maxOutput ?? 4096;
        return this.apiClient.callAIStream(systemPrompt, userPrompt, model, temperature, effectiveMaxTokens, onChunk, options);
    }

    async *callAIAsyncIterator(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens?: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean; forceSimulated?: boolean; thinkingMode?: ThinkingMode; thinkingBudget?: number }
    ): AsyncGenerator<string, APIResponse, unknown> {
        const effectiveMaxTokens = maxTokens ?? this.plugin.settings.maxOutput ?? 4096;
        return yield* this.apiClient.callAIAsyncIterator(systemPrompt, userPrompt, model, temperature, effectiveMaxTokens, options);
    }

    async generateChapter(context: ChapterContext): Promise<APIResponse> {
        let knowledgeInjection = '';
        try {
            // 通过 EngineRegistry 获取共享的 WritingProfileManager 实例，避免多实例状态不同步
            const profileManager = this.plugin.engineRegistry.get(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(context.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                knowledgeInjection = await injector.injectForBodyGeneration(profile, {
                    projectPath: context.project,
                    chapterIndex: context.chapterNumber,
                    outline: context.outline,
                });
            }
        } catch (e) {
            log.warn('[AIEngine] 知识注入失败，跳过:', e);
        }

        const bodyFormat = await this.getBodyWriter().resolveContract(context.project);
        const prompts = this.buildChapterPrompts(context, knowledgeInjection, bodyFormat);
        return this.callAI(prompts.system, prompts.user, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput, { isWritingTask: true });
    }

    async generateChapterStream(
        context: ChapterContext,
        onChunk: (text: string, done: boolean) => void,
        signal?: AbortSignal
    ): Promise<APIResponse> {
        const MAX_CONTINUATIONS = 3;
        const CONTINUE_PROMPT = '\n\n[继续无缝衔接上述内容，保持相同的风格、语气和叙事视角，不要重复已写内容，直接从中断处接续：]\n\n';

        let knowledgeInjection = '';
        try {
            const profileManager = this.plugin.engineRegistry.get(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const injector = this.plugin.engineRegistry.get(ENGINE_NAMES.KNOWLEDGE_INJECTOR);
            const profile = await profileManager.load(context.project);
            if (profile && profile.fingerprint.injectionStrength > 0) {
                knowledgeInjection = await injector.injectForBodyGeneration(profile, {
                    projectPath: context.project,
                    chapterIndex: context.chapterNumber,
                    outline: context.outline,
                });
            }
        } catch (e) {
            log.warn('[AIEngine] 知识注入失败，跳过:', e);
        }

        const bodyFormat = await this.getBodyWriter().resolveContract(context.project);
        const prompts = this.buildChapterPrompts(context, knowledgeInjection, bodyFormat);
        const systemPrompt = prompts.system;
        const userPrompt = prompts.user;

        let fullContent = '';
        let totalUsage = { prompt: 0, completion: 0, total: 0 };
        let finalFinishReason: 'stop' | 'length' | 'error' | 'aborted' | undefined;

        let currentUserPrompt = userPrompt;
        let previousChunkContent = '';

        for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
            if (signal?.aborted) {
                finalFinishReason = 'aborted';
                break;
            }

            const result = await this.callAIStream(
                systemPrompt,
                currentUserPrompt,
                this.plugin.settings.proModel,
                0.7,
                this.plugin.settings.maxOutput,
                (chunkText, _isDone) => {
                    if (!signal?.aborted) {
                        onChunk(fullContent + chunkText, false);
                    }
                },
                { isWritingTask: true, signal }
            );

            if (result.error) {
                return { content: fullContent, error: result.error, finishReason: 'error' };
            }

            const chunkContent = result.content || '';
            fullContent += chunkContent;
            finalFinishReason = (result as any).finishReason || 'stop';

            if (result.usage) {
                totalUsage.prompt += result.usage.prompt;
                totalUsage.completion += result.usage.completion;
                totalUsage.total += result.usage.total;
            }

            if (finalFinishReason !== 'length') {
                break;
            }

            if (chunkContent.length < 50 || chunkContent === previousChunkContent) {
                break;
            }

            previousChunkContent = chunkContent;
            currentUserPrompt = `${fullContent.slice(-500)}${CONTINUE_PROMPT}`;
        }

        onChunk(fullContent, true);

        return {
            content: fullContent,
            finishReason: finalFinishReason,
            usage: totalUsage,
        };
    }

    async generateWorldviewSkeleton(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        return this.worldviewGen.generateWorldviewSkeleton(worldName, projectName, genre, theme, customPrompt);
    }

    async generateWorldviewModule(
        moduleName: string,
        skeleton: string,
        worldName: string,
        genre: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        return this.worldviewGen.generateWorldviewModule(moduleName, skeleton, worldName, genre, customPrompt);
    }

    async generateWorldview(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        return this.worldviewGen.generateWorldview(worldName, projectName, genre, theme, customPrompt, onProgress);
    }

    async generateWorldviewForProject(app: App, project: string, genre?: string, onProgress?: (phase: string, module?: string) => void): Promise<WorldviewGenerationResult> {
        return this.worldviewGen.generateWorldviewForProject(app, project, genre, onProgress);
    }

    async generateSettingLibForProject(app: App, project: string, worldview?: string): Promise<string> {
        return this.worldviewGen.generateSettingLibForProject(app, project, worldview);
    }

    async generateFanficWorldviewForProject(app: App, project: string, onProgress?: (phase: string) => void): Promise<string> {
        return this.worldviewGen.generateFanficWorldviewForProject(app, project, onProgress);
    }

    async generateCharacters(worldview: string, count: number = 5, customPrompt?: string, templateContent?: string, isFirstCharacter?: boolean, names?: string[], settingLib?: string, signal?: AbortSignal, existingEntities?: string): Promise<APIResponse> {
        return this.characterGen.generateCharacters(worldview, count, customPrompt, templateContent, isFirstCharacter, names, settingLib, signal, existingEntities);
    }

    async generateVolumeOutline(
        worldview: string,
        globalSkeleton: string,
        volumeNumber: number,
        totalVolumes: number,
        chaptersPerVolume: number,
        contextPrompt?: string,
        existingElements?: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string }
    ): Promise<APIResponse> {
        return this.outlineGen.generateVolumeOutline(worldview, globalSkeleton, volumeNumber, totalVolumes, chaptersPerVolume, contextPrompt, existingElements);
    }

    async generateOutline(
        worldview: string,
        settings: OutlineSettings,
        existingWorldElements?: WorldElements,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        return this.outlineGen.generateOutline(worldview, settings, existingWorldElements, customPrompt, onProgress);
    }

    async generateFaction(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateFaction(worldview, name, description, templateContent, settingLib);
    }

    async generateLocation(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateLocation(worldview, name, description, templateContent, settingLib);
    }

    async generateItem(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateItem(worldview, name, description, templateContent, settingLib);
    }

    async generateFactionsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateFactionsBatch(worldview, names, description, count, customSystemPrompt, settingLib);
    }

    async generateLocationsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateLocationsBatch(worldview, names, description, count, customSystemPrompt, settingLib);
    }

    async generateItemsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        itemType?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateItemsBatch(worldview, names, description, count, customSystemPrompt, itemType, settingLib);
    }

    async reviewChapter(chapterContent: string, context: ReviewContext): Promise<APIResponse> {
        return this.chapterHelpers.reviewChapter(chapterContent, context);
    }

    async generateChapterPlan(context: ChapterContext): Promise<APIResponse> {
        return this.chapterHelpers.generateChapterPlan(context);
    }

    async generateAnalysisReport(bodyText: string): Promise<APIResponse> {
        return this.chapterHelpers.generateAnalysisReport(bodyText);
    }

    async extractElements(bodyText: string): Promise<APIResponse> {
        return this.chapterHelpers.extractElements(bodyText);
    }

    async analyzeStyle(novelName: string, signal?: AbortSignal): Promise<APIResponse> {
        return this.chapterHelpers.analyzeStyle(novelName, signal);
    }

    async deaiRewrite(bodyText: string): Promise<{
        original: string;
        checkReport: string;
        rewritten: string;
    }> {
        return this.chapterHelpers.deaiRewrite(bodyText);
    }

    async iterativeRefine(
        bodyText: string, 
        contextPrompt: string,
        maxRounds: number = 3,
        chapNum?: string,
        onProgress?: (msg: string) => void,
    ): Promise<{
        finalBody: string;
        rounds: number;
        diffs: string[];
        roundBodies: string[];
    }> {
        return this.chapterHelpers.iterativeRefine(bodyText, contextPrompt, maxRounds, chapNum, onProgress);
    }

    /** 当前模型可用于输入的窗口（设置值作为成本上限，模型能力作为硬上限） */
    private resolvePromptLimits(model: string): { maxContext: number; maxOutput: number } {
        const configured = {
            maxContext: this.plugin.settings.maxContext || DEFAULT_CONTEXT_WINDOW,
            maxOutput: this.plugin.settings.maxOutput || 4096,
        };
        try {
            return clampBudgetToModelLimits(configured, this.plugin.resolveModelLimits(model));
        } catch {
            return configured;
        }
    }

    /** 供其他生成器复用同一套预算口径（设置值 + 模型能力取小） */
    getPromptLimits(model?: string): { maxContext: number; maxOutput: number } {
        return this.resolvePromptLimits(model || this.plugin.settings.proModel);
    }

    private buildChapterPrompts(
        context: ChapterContext,
        knowledgeInjection?: string,
        bodyFormat?: BodyFormatContract,
    ) {
        return buildChapterPromptsFn(
            context,
            { minWordCount: this.plugin.settings.minWordCount, maxWordCount: this.plugin.settings.maxWordCount },
            bodyFormat,
            knowledgeInjection,
            this.resolvePromptLimits(this.plugin.settings.proModel),
        );
    }

    private buildUserPrompt(context: ChapterContext, bodyFormat?: BodyFormatContract): string {
        return buildUserPromptFn(context, { minWordCount: this.plugin.settings.minWordCount }, bodyFormat);
    }

    async callAIWithTemplate(
        templateId: string,
        variables: Record<string, string>,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string }
    ): Promise<APIResponse & { templateVersion?: string; abTestId?: string; abVariant?: 'a' | 'b' }> {
        const promptManager = this.plugin.promptManager;
        let systemPrompt = '';
        let userPrompt = '';
        let templateVersion: string | undefined;
        let abTestId: string | undefined;
        let abVariant: 'a' | 'b' | undefined;

        if (promptManager) {
            const result = promptManager.getPromptWithABTest(templateId, variables);
            if (result) {
                systemPrompt = result.systemPrompt;
                userPrompt = result.userPrompt;
                templateVersion = result.version;
                abTestId = result.abTestId;
                abVariant = result.abVariant;
            }
        }

        if (!systemPrompt && !userPrompt) {
            return {
                content: '',
                error: `Prompt template not found: ${templateId}`,
            };
        }

        const startTime = Date.now();
        const response = await this.callAI(systemPrompt, userPrompt, model, temperature, maxTokens, options);
        const durationMs = Date.now() - startTime;

        if (promptManager && templateVersion) {
            try {
                await promptManager.recordUsage({
                    templateId,
                    version: templateVersion,
                    durationMs,
                    tokensUsed: response.usage,
                    abTestId,
                    abVariant,
                });
            } catch (e) {
                log.warn('[AIEngine] Failed to record prompt usage:', e);
            }
        }

        return {
            ...response,
            templateVersion,
            abTestId,
            abVariant,
        };
    }
}

export type { ChapterContext, ReviewContext, OutlineSettings, WorldElements, NarrativeMetric, NarrativeSnapshot } from './ai-types';

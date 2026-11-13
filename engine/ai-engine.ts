import { App } from 'obsidian';
import NovelWriterPlugin from '@/main';
import type { ChapterContext, ReviewContext, OutlineSettings, WorldElements } from './ai-types';
import { buildChapterPrompts as buildChapterPromptsFn, buildUserPrompt as buildUserPromptFn } from './ai-prompt-builder';
import { clampBudgetToModelLimits } from '@/shared/prompt-budget';
import { DEFAULT_CONTEXT_WINDOW } from '@/shared/thresholds';
import { BodyWriter } from './body-writer';
import { RulesService } from '@/services/rules-service';
import type { BodyFormatContract } from '@/shared/body-format';
import { AIApiClient } from './ai-api-client';
import { ChapterHelpers } from './ai-chapter-helpers';
import { WorldviewGenerator } from './ai-worldview-generator';
import type { WorldviewGenerationResult } from './ai-worldview-generator';
import { OutlineGenerator } from './ai-outline-generator';
import { CharacterGenerator } from './ai-character-generator';
import { EntityGenerator } from './ai-entity-generator';
import { BatchEntityGenerator } from './ai-batch-entity-generator';
import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
import { KnowledgeInjector } from './knowledge-injector';
import { WritingProfileManager } from './writing-profile';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { WorldviewCacheService } from '@/services/worldview-cache-service';
import { createLogger } from '@/shared/logger';
import type { ThinkingMode } from '@/shared/task-model';
import type { APIResponse } from '@/shared/api-types';

export type { APIResponse } from '@/shared/api-types';


const log = createLogger('AiEngine');
/**
 * 批量实体生成结果。
 */
export interface BatchEntityResult {
    name: string;
    content: string;
}

/**
 * AI 引擎门面：聚合生成器与 API 客户端。
 *
 * @example
 * ```ts
 * const ai = new AIEngine(plugin);
 * const outline = await ai.generateOutline(project, { genre: '都市', chapters: 120 });
 * ```
 */
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

    /**
     * 当前最大并发数。
     *
     * @param modelId - 模型 ID
     * @returns 并发数
     */
    static getMaxConcurrent(modelId: string): number {
        return AIApiClient.getMaxConcurrent(modelId);
    }

    get sessionTokens() { return this.apiClient.sessionTokens; }

    /**
     * 重置本次会话的 token 用量累计。
     */
    resetSessionTokens(): void {
        this.apiClient.resetSessionTokens();
    }

    /**
     * 取所属插件实例（部分引擎调用需要组合根能力）。
     * @returns 插件实例
     */
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

    /**
     * 调用模型（非流式），带缓存/重试/降级。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 参数
     * @param temperature - 采样温度
     * @param maxTokens - 参数
     * @param options - 参数
     * @returns API 响应
     */
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
     * @param kind - 种类
     * @param name - 名称
     * @param content - 内容
     * @param missingFields - 缺失字段列表
     * @param worldview - 世界观
      * @returns 文本结果 或 null
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

    /**
     * 调用模型（流式）。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 参数
     * @param temperature - 采样温度
     * @param maxTokens - 参数
     * @param onChunk - 参数
     * @param options - 配置项
     * @returns API 响应
     */
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

    /**
     * 发起流式调用并返回异步迭代器。
     *
     * @param systemPrompt - 系统提示词
     * @param userPrompt - 用户提示词
     * @param model - 模型标识
     * @param temperature - 采样温度
     * @param maxTokens - 最大 token 数
     * @param options - 调用选项
     * @returns 逐块产出文本，最终返回完整响应
     */
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

    /**
     * 生成一章正文（非流式）。
     *
     * @param context - 上下文
     * @returns API 响应
     */
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
        const prompts = await this.buildChapterPrompts(context, knowledgeInjection, bodyFormat);
        return this.callAI(prompts.system, prompts.user, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput, { isWritingTask: true });
    }

    /**
     * 流式生成章节正文。
     *
     * @param context - 上下文
     * @param onChunk - 分片回调
     * @param signal - 取消信号
     * @returns API 响应
     */
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
        const prompts = await this.buildChapterPrompts(context, knowledgeInjection, bodyFormat);
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
            // DSH-20261113-20 缺陷：缺失的 finishReason 不得兜成 'stop'——
            // undefined 只在流被截断/异常时出现，兜底会让续写逻辑失效、
            // 半截正文被当作完整章节落盘。保持 undefined，循环按非 length 收尾。
            finalFinishReason = (result as any).finishReason;

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

    /**
     * 生成世界观骨架。
     *
     * @param worldName - 世界名
     * @param projectName - 项目名
     * @param genre - 题材
     * @param theme - 主题
     * @param customPrompt - 自定义提示词
     * @returns 骨架文本
     */
    async generateWorldviewSkeleton(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        return this.worldviewGen.generateWorldviewSkeleton(worldName, projectName, genre, theme, customPrompt);
    }

    /**
     * 生成单个世界观模块。
     *
     * @param moduleName - 模块名
     * @param skeleton - 骨架文本
     * @param worldName - 世界名
     * @param genre - 题材
     * @param customPrompt - 自定义提示词
     * @returns 模块文本
     */
    async generateWorldviewModule(
        moduleName: string,
        skeleton: string,
        worldName: string,
        genre: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        return this.worldviewGen.generateWorldviewModule(moduleName, skeleton, worldName, genre, customPrompt);
    }

    /**
     * 生成完整世界观。
     *
     * @param worldName - 世界名
     * @param projectName - 项目名
     * @param genre - 题材
     * @param theme - 主题
     * @param customPrompt - 自定义提示词
     * @param onProgress - 进度回调
     * @returns 世界观文本
     */
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

    /**
     * 为项目生成世界观并写入文件。
     *
     * @param app - Obsidian 应用实例
     * @param project - 项目（路径或对象）
     * @param genre - 参数
     * @param onProgress - 参数
     * @returns 生成结果
     */
    async generateWorldviewForProject(app: App, project: string, genre?: string, onProgress?: (phase: string, module?: string) => void): Promise<WorldviewGenerationResult> {
        return this.worldviewGen.generateWorldviewForProject(app, project, genre, onProgress);
    }

    /**
     * 为项目生成设定库。
     *
     * @param app - Obsidian 应用实例
     * @param project - 项目（路径或对象）
     * @param worldview - 参数
     * @returns 设定库文本
     */
    async generateSettingLibForProject(app: App, project: string, worldview?: string): Promise<string> {
        return this.worldviewGen.generateSettingLibForProject(app, project, worldview);
    }

    /**
     * 为同人项目生成世界观。
     *
     * @param app - Obsidian 应用实例
     * @param project - 项目（路径或对象）
     * @param onProgress - 参数
     * @returns 世界观文本
     */
    async generateFanficWorldviewForProject(app: App, project: string, onProgress?: (phase: string) => void): Promise<string> {
        return this.worldviewGen.generateFanficWorldviewForProject(app, project, onProgress);
    }

    /**
     * 批量生成角色卡。
     *
     * @param worldview - 世界观
     * @param count - 数量
     * @param customPrompt - 参数
     * @param templateContent - 参数
     * @param isFirstCharacter - 参数
     * @param names - 参数
     * @param settingLib - 参数
     * @param signal - 参数
     * @param existingEntities - 参数
     * @returns API 响应
     */
    async generateCharacters(worldview: string, count: number = 5, customPrompt?: string, templateContent?: string, isFirstCharacter?: boolean, names?: string[], settingLib?: string, signal?: AbortSignal, existingEntities?: string): Promise<APIResponse> {
        return this.characterGen.generateCharacters(worldview, count, customPrompt, templateContent, isFirstCharacter, names, settingLib, signal, existingEntities);
    }

    /**
     * 生成分卷大纲。
     *
     * @param worldview - 世界观
     * @param globalSkeleton - 全局骨架
     * @param volumeNumber - 卷号
     * @param totalVolumes - 总卷数
     * @param chaptersPerVolume - 每卷章数
     * @param contextPrompt - 参数
     * @param existingElements - 参数
     * @returns API 响应
     */
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

    /**
     * 生成全书大纲。
     *
     * @param worldview - 世界观
     * @param settings - 设置
     * @param existingWorldElements - 参数
     * @param customPrompt - 参数
     * @param onProgress - 参数
     * @returns API 响应
     */
    async generateOutline(
        worldview: string,
        settings: OutlineSettings,
        existingWorldElements?: WorldElements,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        return this.outlineGen.generateOutline(worldview, settings, existingWorldElements, customPrompt, onProgress);
    }

    /**
     * 生成单个势力卡。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
    async generateFaction(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateFaction(worldview, name, description, templateContent, settingLib);
    }

    /**
     * 生成单个地点卡。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
    async generateLocation(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateLocation(worldview, name, description, templateContent, settingLib);
    }

    /**
     * 生成单个物品/功法卡。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
    async generateItem(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.entityGen.generateItem(worldview, name, description, templateContent, settingLib);
    }

    /**
     * 批量生成势力卡。
     *
     * @param worldview - 世界观
     * @param names - 名称列表
     * @param description - 描述
     * @param count - 数量
     * @param customSystemPrompt - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
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

    /**
     * 批量生成地点卡。
     *
     * @param worldview - 世界观
     * @param names - 名称列表
     * @param description - 描述
     * @param count - 数量
     * @param customSystemPrompt - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
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

    /**
     * 批量生成物品/功法卡。
     *
     * @param worldview - 世界观
     * @param names - 名称列表
     * @param description - 描述
     * @param count - 数量
     * @param customSystemPrompt - 参数
     * @param itemType - 参数
     * @param settingLib - 参数
     * @returns API 响应
     */
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

    /**
     * 审阅章节正文并返回质量问题。
     *
     * @param chapterContent - 章节正文
     * @param context - 上下文
     * @returns API 响应
     */
    async reviewChapter(chapterContent: string, context: ReviewContext): Promise<APIResponse> {
        return this.chapterHelpers.reviewChapter(chapterContent, context);
    }

    /**
     * 生成章节计划/细纲。
     *
     * @param context - 上下文
     * @returns API 响应
     */
    async generateChapterPlan(context: ChapterContext): Promise<APIResponse> {
        return this.chapterHelpers.generateChapterPlan(context);
    }

    /**
     * 生成章节分析报告（结算输入）。
     *
     * @param bodyText - 正文文本
     * @returns API 响应
     */
    async generateAnalysisReport(bodyText: string): Promise<APIResponse> {
        return this.chapterHelpers.generateAnalysisReport(bodyText);
    }

    /**
     * 从正文抽取实体/要素。
     *
     * @param bodyText - 正文文本
     * @returns API 响应
     */
    async extractElements(bodyText: string): Promise<APIResponse> {
        return this.chapterHelpers.extractElements(bodyText);
    }

    /**
     * 分析作品文笔风格。
     *
     * @param novelName - 小说名
     * @param signal - 参数
     * @returns API 响应
     */
    async analyzeStyle(novelName: string, signal?: AbortSignal): Promise<APIResponse> {
        return this.chapterHelpers.analyzeStyle(novelName, signal);
    }

    /**
     * 执行去 AI 味改写。
     *
     * @param bodyText - 正文文本
     * @returns 改写结果
     */
    async deaiRewrite(bodyText: string): Promise<{
        original: string;
        checkReport: string;
        rewritten: string;
    }> {
        return this.chapterHelpers.deaiRewrite(bodyText);
    }

    /**
     * 迭代精修（审查-修复循环）。
     *
     * @param bodyText - 正文文本
     * @param contextPrompt - 上下文提示词
     * @param maxRounds - 最大轮次
     * @param chapNum - 参数
     * @param onProgress - 参数
     * @returns 精修结果
     */
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

    /**
     * 供其他生成器复用同一套预算口径（设置值 + 模型能力取小）
     *
     * @param model - 模型标识
      * @returns number } 结果
     */
    getPromptLimits(model?: string): { maxContext: number; maxOutput: number } {
        return this.resolvePromptLimits(model || this.plugin.settings.proModel);
    }

    private async buildChapterPrompts(
        context: ChapterContext,
        knowledgeInjection?: string,
        bodyFormat?: BodyFormatContract,
    ) {
        // v4.26：规则文本唯一来源 RulesService（含模式附录），不再内嵌第二份
        let writingRules = '';
        try {
            writingRules = await RulesService.getInstance(this.plugin.app).getWritingRules(context.project);
        } catch (e) {
            log.warn('[AIEngine] 读取写作规则失败，使用镜头兜底:', e);
        }
        return buildChapterPromptsFn(
            context,
            { minWordCount: this.plugin.settings.minWordCount, maxWordCount: this.plugin.settings.maxWordCount },
            bodyFormat,
            knowledgeInjection,
            this.resolvePromptLimits(this.plugin.settings.proModel),
            writingRules,
        );
    }

    private buildUserPrompt(context: ChapterContext, bodyFormat?: BodyFormatContract): string {
        return buildUserPromptFn(context, { minWordCount: this.plugin.settings.minWordCount }, bodyFormat);
    }

}

export type { ChapterContext, ReviewContext, OutlineSettings, WorldElements, NarrativeMetric, NarrativeSnapshot } from './ai-types';

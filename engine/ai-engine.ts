import { App } from 'obsidian';
import NovelWriterPlugin from '../main';
import type { ChapterContext, ReviewContext, OutlineSettings, WorldElements } from './ai-types';
import { buildSystemPrompt as buildSystemPromptFn, buildUserPrompt as buildUserPromptFn } from './ai-prompt-builder';
import { AIApiClient } from './ai-api-client';
import { ChapterHelpers } from './ai-chapter-helpers';
import { WorldviewGenerator } from './ai-worldview-generator';
import { OutlineGenerator } from './ai-outline-generator';
import { CharacterGenerator } from './ai-character-generator';
import { EntityGenerator } from './ai-entity-generator';
import { BatchEntityGenerator } from './ai-batch-entity-generator';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';

export interface BatchEntityResult {
    name: string;
    content: string;
}

export interface APIResponse {
    content: string;
    error?: string;
    usage?: {
        prompt: number;
        completion: number;
        total: number;
    };
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
        this.characterGen = new CharacterGenerator(plugin, this.apiClient, this.notifier);
        this.entityGen = new EntityGenerator(plugin, this.apiClient, this.notifier);
        this.batchEntityGen = new BatchEntityGenerator(plugin, this.apiClient, this.notifier);
    }

    async callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        options?: { isWritingTask?: boolean; signal?: AbortSignal; endpoint?: string; apiKey?: string }
    ): Promise<APIResponse> {
        return this.apiClient.callAI(systemPrompt, userPrompt, model, temperature, maxTokens, options);
    }

    async callAIStream(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096,
        onChunk?: (text: string, done: boolean) => void,
        options?: { isWritingTask?: boolean }
    ): Promise<APIResponse> {
        return this.apiClient.callAIStream(systemPrompt, userPrompt, model, temperature, maxTokens, onChunk, options);
    }

    async generateChapter(context: ChapterContext): Promise<APIResponse> {
        const systemPrompt = this.buildSystemPrompt(context);
        const userPrompt = this.buildUserPrompt(context);
        return this.callAI(systemPrompt, userPrompt, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput, { isWritingTask: true });
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

    async generateWorldviewForProject(app: App, project: string, genre?: string, onProgress?: (phase: string, module?: string) => void): Promise<string> {
        return this.worldviewGen.generateWorldviewForProject(app, project, genre, onProgress);
    }

    async generateSettingLibForProject(app: App, project: string): Promise<string> {
        return this.worldviewGen.generateSettingLibForProject(app, project);
    }

    async generateFanficWorldviewForProject(app: App, project: string, onProgress?: (phase: string) => void): Promise<string> {
        return this.worldviewGen.generateFanficWorldviewForProject(app, project, onProgress);
    }

    async generateCharacters(worldview: string, count: number = 5, customPrompt?: string, templateContent?: string, isFirstCharacter?: boolean, names?: string[]): Promise<APIResponse> {
        return this.characterGen.generateCharacters(worldview, count, customPrompt, templateContent, isFirstCharacter, names);
    }

    async generateGlobalSkeleton(
        worldview: string,
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string; },
        settings: { totalWords: number; volumes: number; wordsPerChapter: number; chaptersPerVolume: number; theme: string; genre: string; },
        customPrompt?: string
    ): Promise<APIResponse> {
        return this.outlineGen.generateGlobalSkeleton(worldview, existingElements, settings, customPrompt);
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

    async generateFaction(worldview: string, name: string, description: string, templateContent?: string): Promise<APIResponse> {
        return this.entityGen.generateFaction(worldview, name, description, templateContent);
    }

    async generateLocation(worldview: string, name: string, description: string, templateContent?: string): Promise<APIResponse> {
        return this.entityGen.generateLocation(worldview, name, description, templateContent);
    }

    async generateItem(worldview: string, name: string, description: string, templateContent?: string): Promise<APIResponse> {
        return this.entityGen.generateItem(worldview, name, description, templateContent);
    }

    async generateFactionsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateFactionsBatch(worldview, names, description, count, customSystemPrompt);
    }

    async generateLocationsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateLocationsBatch(worldview, names, description, count, customSystemPrompt);
    }

    async generateItemsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        itemType?: string
    ): Promise<BatchEntityResult[]> {
        return this.batchEntityGen.generateItemsBatch(worldview, names, description, count, customSystemPrompt, itemType);
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

    async analyzeStyle(novelName: string): Promise<APIResponse> {
        return this.chapterHelpers.analyzeStyle(novelName);
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

    private buildSystemPrompt(context: ChapterContext): string {
        return buildSystemPromptFn(context, { minWordCount: this.plugin.settings.minWordCount, maxWordCount: this.plugin.settings.maxWordCount });
    }

    private buildUserPrompt(context: ChapterContext): string {
        return buildUserPromptFn(context, { minWordCount: this.plugin.settings.minWordCount });
    }
}

export type { ChapterContext, ReviewContext, OutlineSettings, WorldElements, NarrativeMetric, NarrativeSnapshot } from './ai-types';

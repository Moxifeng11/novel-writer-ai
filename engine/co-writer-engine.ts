/**
 * co-writer-engine.ts — 句级协同写作引擎 (v5.0)
 *
 * 核心职责：
 * - suggestNext(): 基于上下文+完成度，生成 3 条不同方向的续写建议
 * - validateEdit(): 验证用户手动编辑的一致性/风格/剧情对齐
 * - evaluatePlotComplete(): 评估四维剧情完成度
 * - adjustDirection(): 基于完成度短板动态调整建议方向
 * - recordInteraction(): 记录完整交互历史
 *
 * 设计原则：只调用现有模块的公开方法，不修改任何现有代码。
 */

import { App, TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import NovelWriterPlugin, { PROVIDERS } from '../main';
import { ContextManager } from './context-manager';
import { StyleLearner } from './style-learner';
import { PreferenceMemory } from './preference-memory';
import { PromptBuilder, type PromptSnapshot } from './prompt-builder';
import { CharacterPairRelation, loadRelationshipStates } from './relationship-engine';
import { CrossVolumeIntegrator } from './cross-volume-integration';
import { analyzeCoherence, CoherenceReport } from './coherence-checker';
import { analyzePlotRedundancy, loadPreviousChapterBodies, PlotRedundancyReport } from './plot-redundancy-checker';
import { analyzeLogicConsistency, LogicConsistencyReport } from './logic-consistency-checker';
import { analyzeContentSafety, ContentSafetyReport } from './content-safety-checker';
import { pjCharsDir } from '../shared/paths';
import { 
     CharacterSoul, 
     CharacterSoulSummary, 
     gatherAllCharacterCores, 
     buildCharacterSoulSummary, 
     formatSoulForPrompt, 
     getProtagonistSoulDetail 
 } from './character-soul';
 import { EntityStateManager, EntityStateChange } from './entity-state-manager';
 import { OOCCheckResult, EmotionCurve, RhythmAnalysis, AssociationSuggestion } from '../shared/co-writer-types';
import {
    SuggestionRecord,
    SuggestionDirection,
    EditValidation,
    PlotCompletionMetrics,
    SentenceEditRecord,
    CoWritingSession
} from '../shared/types';
import { extractResponseText } from '../shared/api-response-utils';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';

// ============================================================
// 类型导出 — 已迁移至 ./co-writer/co-writer-types.ts (P1-4 拆分阶段一)
// 此处通过 re-export 保持外部 import 路径向后兼容。
// ============================================================
export type {
    WritingMode,
    PlotNode,
    PlotProgress,
    Suggestion,
    ContextSnapshot,
    SettingGuardReport,
} from './co-writer/co-writer-types';
import type {
    WritingMode,
    PlotNode,
    PlotProgress,
    Suggestion,
    ContextSnapshot,
    SettingGuardReport,
} from './co-writer/co-writer-types';

// ============================================================
// CoWriterEngine
// ============================================================

export class CoWriterEngine {
    private app: App;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private snapshot: ContextSnapshot | null = null;
    private session: CoWritingSession | null = null;
    private interactionHistory: SentenceEditRecord[] = [];
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;
     
     // A1: 角色灵魂数据
     private soulData: CharacterSoulSummary | null = null;
     
     // D1: 实体状态管理器
     private entityStateManager: EntityStateManager | null = null;
     private pendingStateChanges: EntityStateChange[] = [];

     // E1/E3: 风格自学习与偏好记忆
     private styleLearner: StyleLearner | null = null;
     private preferenceMemory: PreferenceMemory | null = null;
    private promptBuilder: PromptBuilder | null = null;

    constructor(app: App, aiEngine: AIEngine, contextManager: ContextManager) {
        this.app = app;
        this.aiEngine = aiEngine;
        this.contextManager = contextManager;
    }

    /**
     * v6.5: 获取协同写作使用的模型（强制本地，不回退远程）
     */
    private getCoWriteModel(): string | undefined {
        const settings = this.aiEngine.getPlugin()?.settings;
        return settings?.coWriteModel || undefined;
    }

    private async callCoWriteAI(
        prompt: { system: string; user: string },
        tempDelta: number,
        signal?: AbortSignal
    ): ReturnType<AIEngine['callAI']> {
        const settings = this.aiEngine.getPlugin()?.settings;
        const temperature = (settings?.coWriteTemperature ?? 0.7) + tempDelta;
        const maxTokens = settings?.coWriteMaxTokens ?? 600;
        return this.aiEngine.callAI(
            prompt.system,
            prompt.user,
            this.getCoWriteModel(),
            temperature,
            maxTokens,
            this.getCoWriteOptions({ signal })
        );
    }

    /**
     * v6.5: 获取协同写作的 callAI options（本地模型使用 Ollama 端点 + settings 参数）
     */
    private getCoWriteOptions(base?: { signal?: AbortSignal }): { signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean } {
        const opts: { signal?: AbortSignal; endpoint?: string; apiKey?: string; disableFallback?: boolean } = { disableFallback: true };
        if (base?.signal) opts.signal = base.signal;
        const settings = this.aiEngine.getPlugin()?.settings;
        const model = this.getCoWriteModel();
        if (model && settings) {
            const ollamaPreset = PROVIDERS.ollama;
            if (ollamaPreset?.endpoint) {
                opts.endpoint = ollamaPreset.endpoint;
                opts.apiKey = 'ollama';
            }
        }
        return opts;
    }

    private hasCoWriteModel(): boolean {
        return !!this.getCoWriteModel();
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
    // 初始化
    // ============================================================

    async init(
        project: string,
        chapterName: string,
        volume: string = '第1卷',
        chapterNum: number = 1
    ): Promise<void> {
        try {
            // 1. 采集上下文
            const ctx = await this.contextManager.gatherAll(project, chapterName);
            this.snapshot = this.buildSnapshot(ctx, project, chapterName);

            // 2. 初始化会话
            this.session = {
                project,
                chapterName,
                volume,
                chapterNum,
                startedAt: Date.now(),
                interactions: [],
                currentMetrics: this.getEmptyMetrics(),
                totalWordCount: 0
            };

            console.log('[CoWriterEngine] 初始化完成:', project, chapterName);
        } catch (e) {
            console.warn('[CoWriterEngine] 初始化失败，使用降级模式:', e);
            // 降级：创建一个最小 snapshot
            this.snapshot = {
                project,
                chapterName,
                allChars: '',
                allFactions: '',
                allLocs: '',
                allItems: '',
                foreshadows: { unrevealed: [], revealed: [], abandoned: [] },
                relationshipStates: [],
                crossVolumeContext: '',
                worldView: '',
                worldType: '',
                writingStyle: '',
                writingRules: '',
                protagonistSoulDetail: '',
                emotionPlan: '',
                sceneExpansion: '',
                chapPlan: '',
                prevChaptersSummary: '',
                settingLib: '',
                timeline: '',
                characterCores: '',
                triggeredMemories: '',
                precedingText: '',
                cursorHint: '',
                currentMode: 'continue',
                gatheredAt: Date.now(),
                dirtyFields: new Set()
            };
        }
        
        // ===== A1: 角色灵魂层采集 =====
        try {
            // v4.0：使用不带前导斜杠的标准 vault 路径（与 context-manager 一致）。
            const charFolderPath = pjCharsDir(project);
            const mdFiles = this.getVaultMeta().getFiles().filter((f: TFile) =>
                f.path.startsWith(charFolderPath + '/') && f.path.endsWith('.md'));

            if (mdFiles.length > 0) {
                const souls = await gatherAllCharacterCores(mdFiles, this.app.vault);
                const protagonistName = this.getProtagonistName(project);
                this.soulData = buildCharacterSoulSummary(souls, protagonistName);
                console.log('[CoWriterEngine] A1: 角色灵魂层采集完成:', souls.length, '个角色');
            }
        } catch (e) {
            console.warn('[CoWriterEngine] A1: 灵魂层采集失败，继续无灵魂模式:', e);
        }

        // ===== A4: 加载角色关系状态 =====
        try {
            if (this.snapshot) {
                this.snapshot.relationshipStates = await loadRelationshipStates(this.app, project);
                console.log('[CoWriterEngine] A4: 关系状态加载完成:', this.snapshot.relationshipStates.length, '组关系');
            }
        } catch (e) {
            console.warn('[CoWriterEngine] A4: 关系状态加载失败，继续无关系驱动:', e);
        }

        // ===== D2: 加载跨卷状态快照上下文（仅非首卷需要） =====
        try {
            if (this.snapshot && volume && volume !== '第1卷') {
                const integrator = new CrossVolumeIntegrator(this.app);
                const ctx = await integrator.getSnapshotContext(project, volume);
                if (ctx && ctx.trim()) {
                    this.snapshot.crossVolumeContext = ctx.trim();
                    console.log('[CoWriterEngine] D2: 跨卷状态快照加载完成，', this.snapshot.crossVolumeContext.length, '字');
                }
            }
        } catch (e) {
            console.warn('[CoWriterEngine] D2: 跨卷状态快照加载失败，继续无跨卷上下文:', e);
        }
        
        // ===== D1: 初始化实体状态管理器 =====
        try {
            this.entityStateManager = new EntityStateManager({
                app: this.app,
                plugin: this.aiEngine.getPlugin(),
                aiEngine: this.aiEngine
            });
        } catch (e) {
            console.warn('[CoWriterEngine] D1: 实体状态管理器初始化失败:', e);
        }

        // ===== E1/E3: 初始化风格自学习与偏好记忆 =====
        try {
            const plugin = this.aiEngine.getPlugin();
            this.styleLearner = new StyleLearner({ app: this.app, aiEngine: this.aiEngine, plugin, project });
            await this.styleLearner.loadPatterns();

            this.preferenceMemory = new PreferenceMemory({ app: this.app, plugin, project });
            await this.preferenceMemory.loadPreferences();

            // 装配 PromptBuilder：此前仅声明字段从未实例化，导致 A2/A3/A4/D2/E1/E3
            // 所有注入片段在协同写作中被 ?. 短路成空数组（注入逻辑长期静默失效）。
            this.promptBuilder = new PromptBuilder(
                () => this.snapshot as unknown as PromptSnapshot | null,
                this.styleLearner,
                this.preferenceMemory
            );

            console.log('[CoWriterEngine] E1/E3: 风格与偏好记忆加载完成');
        } catch (e) {
            console.warn('[CoWriterEngine] E1/E3: 风格与偏好记忆初始化失败:', e);
        }

        // ===== v6.4: 提取剧情节点，初始化进度追踪 =====
        try {
            this.plotNodes = this.extractPlotNodes();
            console.log('[CoWriterEngine] v6.4: 剧情节点提取完成，共', this.plotNodes.length, '个节点');
        } catch (e) {
            console.warn('[CoWriterEngine] v6.4: 剧情节点提取失败:', e);
            this.plotNodes = [];
        }
    }

    // ============================================================
    // 核心 API 1：生成 3 条建议（含方向标记）
    // ============================================================

    async suggestNext(
        precedingText: string,
        cursorHint: string = '',
        mode: WritingMode = 'continue',
        count: number = 3,
        signal?: AbortSignal
    ): Promise<SuggestionRecord[]> {
        if (!this.snapshot) {
            console.warn('[CoWriterEngine] 未初始化，返回空建议');
            return [];
        }
        if (!this.hasCoWriteModel()) {
            console.warn('[CoWriterEngine] 协同写作未配置本地模型，跳过建议生成');
            return [];
        }

        // 获取推荐方向（基于完成度动态调整）
        const directions = this.getRecommendDirections(count);

        const suggestions: SuggestionRecord[] = [];
        const settings = this.aiEngine.getPlugin()?.settings;

        for (let i = 0; i < Math.min(count, directions.length); i++) {
            const direction = directions[i];
            const prompt = this.buildDirectionalPrompt(precedingText, direction, cursorHint);

            try {
                if (signal?.aborted) return suggestions;
                const response = await this.callCoWriteAI(prompt, i * 0.05, signal);

                const text = extractResponseText(response);

                if (text) {
                    suggestions.push({
                        id: `sug_${Date.now()}_${i}`,
                        text,
                        direction,
                        style: i === 0 ? 'default' : (i === 1 ? 'creative' : 'conservative'),
                        temperature: (settings?.coWriteTemperature ?? 0.7) + i * 0.05,
                        preview: text.slice(0, 30) + (text.length > 30 ? '...' : '')
                    });
                }
            } catch (e) {
                console.warn(`[CoWriterEngine] 建议生成失败 (方向: ${direction}):`, e);
            }
        }

        // C1: 提前剧透检测——为每条建议标注剧透/越界风险
        return suggestions.map(s => this.annotateSuggestionRisk(s));
    }

    async rewriteSelection(
        selectedText: string,
        beforeContext: string,
        afterContext: string,
        cursorHint: string = '',
        count: number = 3
    ): Promise<SuggestionRecord[]> {
        if (!this.snapshot || !selectedText.trim() || !this.hasCoWriteModel()) return [];

        const directions: SuggestionDirection[] = ['description', 'emotion', 'dialogue'];
        const suggestions: SuggestionRecord[] = [];
        const settings = this.aiEngine.getPlugin()?.settings;
        for (let i = 0; i < Math.min(count, directions.length); i++) {
            const direction = directions[i];
            const prompt = this.promptBuilder
                ? this.promptBuilder.buildRewritePrompt(selectedText, beforeContext, afterContext, cursorHint, direction)
                : [
                    '你是小说协同编辑。请对用户选中的片段给出一个可直接替换的改写版本。',
                    '',
                    '【前文】',
                    beforeContext.slice(-500),
                    '',
                    '【选中文本】',
                    selectedText,
                    '',
                    '【后文】',
                    afterContext.slice(0, 300),
                    '',
                    '请输出 1 个改写版本，保持剧情事实不变，不要解释。'
                ].filter(Boolean).join('\n');

            try {
                const response = await this.callCoWriteAI({ system: '', user: prompt }, i * 0.1);
                const text = extractResponseText(response);
                if (text) {
                    suggestions.push({
                        id: `rewrite_${Date.now()}_${i}`,
                        text,
                        direction,
                        style: i === 0 ? 'default' : (i === 1 ? 'creative' : 'conservative'),
                        temperature: (settings?.coWriteTemperature ?? 0.7) + i * 0.1,
                        reasoning: '选区改写候选',
                        preview: text.slice(0, 30) + (text.length > 30 ? '...' : '')
                    });
                }
            } catch (e) {
                console.warn(`[CoWriterEngine] 选区改写失败 (方向: ${direction}):`, e);
            }
        }
        return suggestions.map(sg => this.annotateSuggestionRisk(sg));
    }

    async iterateSuggestion(
        originalSuggestion: SuggestionRecord,
        instruction: string,
        precedingContext: string,
        cursorHint: string = ''
    ): Promise<SuggestionRecord | null> {
        if (!this.snapshot || !instruction.trim() || !this.hasCoWriteModel()) return null;

        const settings = this.aiEngine.getPlugin()?.settings;
        const prompt = [
            '你是小说句级协同写作助手。用户不想重新生成整组建议，而是要基于当前候选做一次定向迭代。',
            '',
            ...this.promptBuilder?.getMemoryPromptParts() ?? [],
            ...this.promptBuilder?.getNarrativeDriverPromptParts(precedingContext) ?? [],
            '【已写前文】',
            precedingContext.slice(-800),
            '',
            '【原候选】',
            originalSuggestion.text,
            '',
            '【用户迭代指令】',
            instruction,
            cursorHint ? `\n【临时写作方向】\n${cursorHint}` : '',
            '',
            '请只输出 1 个新版候选，保持剧情事实连续，不要解释，不要列点。'
        ].filter(Boolean).join('\n');

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
            const text = extractResponseText(response);
            if (!text) return null;

            return this.annotateSuggestionRisk({
                ...originalSuggestion,
                id: `iter_${Date.now()}`,
                text,
                temperature: settings?.coWriteTemperature ?? 0.7,
                reasoning: `基于指令迭代：${instruction}`,
                preview: text.slice(0, 30) + (text.length > 30 ? '...' : '')
            });
        } catch (e) {
            console.warn('[CoWriterEngine] B2: 建议迭代失败:', e);
            return null;
        }
    }

    // ============================================================
    // 核心 API 2：验证用户编辑
    // ============================================================

    async validateEdit(
        modifiedText: string,
        originalSuggestion: SuggestionRecord,
        precedingContext: string
    ): Promise<EditValidation> {
        if (!this.hasCoWriteModel()) {
            return {
                isValid: false,
                consistencyScore: 0,
                styleScore: 0,
                plotAlignmentScore: 0,
                overallScore: 0,
                warnings: ['协同写作未配置本地模型，无法验证编辑'],
                suggestions: [],
                validatedAt: Date.now()
            };
        }
        // 先进行基础验证
        const prompt = this.buildValidationPrompt(modifiedText, originalSuggestion, precedingContext);

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);

            const raw = extractResponseText(response);
            const baseValidation = this.parseValidationResponse(raw);
            
            // A1: OOC 检测
            if (this.soulData?.protagonist?.hasSoul) {
                const oocResult = await this.checkOOC(modifiedText, this.soulData.protagonist);
                if (oocResult.hasOOC) {
                    baseValidation.warnings.push(...oocResult.warnings);
                    baseValidation.consistencyScore = Math.min(baseValidation.consistencyScore, oocResult.score);
                    baseValidation.overallScore = Math.round(
                        (baseValidation.consistencyScore + baseValidation.styleScore + baseValidation.plotAlignmentScore) / 3
                    );
                    console.log('[CoWriterEngine] A1: OOC检测警告:', oocResult.warnings);
                }
            }
            
            return baseValidation;
        } catch (e) {
            console.warn('[CoWriterEngine] 验证失败，默认通过:', e);
            return {
                isValid: true,
                consistencyScore: 70,
                styleScore: 70,
                plotAlignmentScore: 70,
                overallScore: 70,
                warnings: ['验证服务暂时不可用，默认通过'],
                suggestions: [],
                validatedAt: Date.now()
            };
        }
    }

    // ============================================================
    // 核心 API 3：评估剧情完成度
    // ============================================================

    async evaluatePlotComplete(currentBody: string): Promise<PlotCompletionMetrics> {
        if (!this.snapshot || !this.hasCoWriteModel()) return this.getEmptyMetrics();

        const nodeProgress = this.computePlotProgress(currentBody);

        const prompt = this.buildEvaluationPrompt(currentBody, nodeProgress);

        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);

            const raw = extractResponseText(response);
            const aiMetrics = this.parseEvaluationResponse(raw);

            const baseCompletion = nodeProgress.completionPercent;
            const aiAdjustment = (aiMetrics.overallCompletion - 50) * 0.2;
            const overallCompletion = Math.max(0, Math.min(100, Math.round(baseCompletion + aiAdjustment)));

            const metrics: PlotCompletionMetrics = {
                sceneObjectivesMet: nodeProgress.totalNodes > 0
                    ? Math.round((nodeProgress.completedNodes / nodeProgress.totalNodes) * 100)
                    : aiMetrics.sceneObjectivesMet,
                characterArcsAdvanced: aiMetrics.characterArcsAdvanced,
                foreshadowingSeeded: aiMetrics.foreshadowingSeeded,
                emotionalArcProgress: aiMetrics.emotionalArcProgress,
                overallCompletion,
                suggestionAdvice: nodeProgress.nextNode
                    ? `当前推进到第 ${nodeProgress.currentIndex + 1}/${nodeProgress.totalNodes} 个节点：${nodeProgress.nextNode.goal}。${aiMetrics.suggestionAdvice}`
                    : aiMetrics.suggestionAdvice,
                nextDirectionHints: aiMetrics.nextDirectionHints,
                evaluatedAt: Date.now()
            };

            if (this.session) {
                this.session.currentMetrics = metrics;
                this.session.totalWordCount = currentBody.length;
            }

            return metrics;
        } catch (e) {
            console.warn('[CoWriterEngine] 完成度评估失败:', e);
            if (nodeProgress.totalNodes > 0) {
                const fallbackMetrics: PlotCompletionMetrics = {
                    sceneObjectivesMet: nodeProgress.completionPercent,
                    characterArcsAdvanced: 50,
                    foreshadowingSeeded: 50,
                    emotionalArcProgress: 50,
                    overallCompletion: nodeProgress.completionPercent,
                    suggestionAdvice: nodeProgress.nextNode
                        ? `当前推进到第 ${nodeProgress.currentIndex + 1}/${nodeProgress.totalNodes} 个节点：${nodeProgress.nextNode.goal}`
                        : '所有剧情节点已完成',
                    nextDirectionHints: ['action', 'dialogue', 'description'],
                    evaluatedAt: Date.now()
                };
                if (this.session) {
                    this.session.currentMetrics = fallbackMetrics;
                    this.session.totalWordCount = currentBody.length;
                }
                return fallbackMetrics;
            }
            return this.session?.currentMetrics || this.getEmptyMetrics();
        }
    }

    // ============================================================
    // 核心 API 4：动态调整建议方向
    // ============================================================

    adjustDirection(metrics: PlotCompletionMetrics): SuggestionDirection[] {
        const directions: SuggestionDirection[] = [];

        // 短板优先
        if (metrics.sceneObjectivesMet < 50) directions.push('action');
        if (metrics.emotionalArcProgress < 40) directions.push('emotion');
        if (metrics.foreshadowingSeeded < 30) directions.push('foreshadow');
        if (metrics.characterArcsAdvanced < 45) directions.push('emotion');

        // 如果 AI 推荐的方向和短板不重复，加入
        if (metrics.nextDirectionHints) {
            for (const hint of metrics.nextDirectionHints) {
                if (!directions.includes(hint)) {
                    directions.push(hint);
                }
            }
        }

        // 确保至少 3 个方向
        const fallbacks: SuggestionDirection[] = ['dialogue', 'description', 'conflict'];
        while (directions.length < 3) {
            const next = fallbacks.shift()!;
            if (!directions.includes(next)) directions.push(next);
        }

        // 更新到 session
        if (this.session) {
            this.session.currentMetrics.nextDirectionHints = directions.slice(0, 3);
        }

        return directions.slice(0, 3);
    }

    // ============================================================
    // 核心 API 5：记录交互
    // ============================================================

    recordInteraction(record: SentenceEditRecord): void {
        this.interactionHistory.push(record);
        if (this.session) {
            this.session.interactions.push(record);
        }
        void this.learnFromInteraction(record);
    }

    getMemorySnapshot(): {
        styleGuide: string;
        stylePatterns: ReturnType<StyleLearner['getAllPatterns']>;
        preferencePrompt: string;
        preferences: ReturnType<PreferenceMemory['getAllPreferences']>;
    } {
        return {
            styleGuide: this.styleLearner?.getStyleGuide() || '',
            stylePatterns: this.styleLearner?.getAllPatterns() || [],
            preferencePrompt: this.preferenceMemory?.generatePreferencePrompt() || '',
            preferences: this.preferenceMemory?.getAllPreferences() || []
        };
    }

    async addExplicitPreference(
        category: Parameters<PreferenceMemory['recordPreference']>[0],
        key: string,
        value: string
    ): Promise<void> {
        await this.preferenceMemory?.recordPreference(category, key, value, 'explicit');
    }

    private async learnFromInteraction(record: SentenceEditRecord): Promise<void> {
        try {
            const chosen = record.suggestions.find(s => s.id === record.chosenSuggestionId);
            const finalText = record.humanModifiedText?.trim();
            if (!chosen || !finalText) return;

            const chosenText = chosen.text.trim();
            if (finalText !== chosenText) {
                await this.styleLearner?.learnFromEdit(chosenText, finalText, record.triggerText || '');
                await this.preferenceMemory?.recordPreference('style', '接受建议后的人工编辑', {
                    direction: chosen.direction,
                    style: chosen.style,
                    editedLength: finalText.length
                }, 'learned');
            } else {
                await this.preferenceMemory?.recordPreference('style', `偏好方向:${chosen.direction}`, {
                    direction: chosen.direction,
                    style: chosen.style,
                    acceptedWithoutEdit: true
                }, 'learned');
            }
        } catch (e) {
            console.warn('[CoWriterEngine] E1/E3: 从协同交互学习失败:', e);
        }
    }

    // ============================================================
    // 上下文快照方法
    // ============================================================

    updateSnapshot(confirmedText: string): void {
        if (this.snapshot) {
            this.snapshot.precedingText = confirmedText.slice(-2000);
        }
        if (this.session) {
            this.session.totalWordCount = confirmedText.length;
        }
    }

    setCursorHint(hint: string): void {
        if (this.snapshot) this.snapshot.cursorHint = hint;
    }

    getSnapshot(): ContextSnapshot | null {
        return this.snapshot;
    }

    getSession(): CoWritingSession | null {
        return this.session;
    }

    getHistory(): SentenceEditRecord[] {
        return this.interactionHistory;
    }

    async refreshStaticContext(): Promise<void> {
        if (!this.snapshot) return;
        try {
            const ctx = await this.contextManager.gatherAll(
                this.snapshot.project,
                this.snapshot.chapterName
            );
            this.snapshot = this.buildSnapshot(ctx, this.snapshot.project, this.snapshot.chapterName);
            console.log('[CoWriterEngine] 静态上下文已刷新');
        } catch (e) {
            console.warn('[CoWriterEngine] 刷新静态上下文失败:', e);
        }
    }

    // ============================================================
    // 私有方法：构建 Snapshot
    // ============================================================

    private buildSnapshot(ctx: any, project: string, chapterName: string): ContextSnapshot {
        const data = ctx?.data || {};
        const getRaw = (obj: any) => obj?.raw || '';
        const getCharSummary = (chars: any[]) => {
            if (!Array.isArray(chars) || chars.length === 0) return '';
            return chars.map((c: any) => `${c.name || ''}：${c.description || c.state || ''}`.trim()).join('\n');
        };
        const worldViewRaw = getRaw(data.world_view);
        let worldType = '';
        const typeMatch = worldViewRaw.match(/题材[：:]\s*([^\n]+)/);
        if (typeMatch) worldType = typeMatch[1].trim();
        return {
            project,
            chapterName,
            allChars: getCharSummary(data.character_state),
            allFactions: getCharSummary(data.factions),
            allLocs: getCharSummary(data.locations),
            allItems: getCharSummary(data.items),
            foreshadows: data.foreshadows || { unrevealed: [], revealed: [], abandoned: [] },
            relationshipStates: [],
            crossVolumeContext: '',
            worldView: worldViewRaw,
            worldType,
            writingStyle: getRaw(data.writing_style),
            writingRules: data.writing_rules?.mandatory?.join('\n') || '',
            protagonistSoulDetail: '',
            emotionPlan: getRaw(data.emotion_plan),
            sceneExpansion: getRaw(data.scene_expansion),
            chapPlan: getRaw(data.outline),
            prevChaptersSummary: (() => {
                const prev = data.previous_chapter;
                if (!prev) return '';
                return [
                    prev.bodySummary ? `【前章概要】\n${prev.bodySummary}` : '',
                    prev.outline ? `【前章大纲】\n${prev.outline}` : '',
                    prev.ending ? `【前章结尾】\n${prev.ending}` : '',
                    prev.analysisReport ? `【前章分析报告】\n${prev.analysisReport}` : '',
                ].filter(Boolean).join('\n\n');
            })(),
            settingLib: getRaw(data.setting_lib),
            timeline: (() => {
                const tl = data.timeline as any[];
                if (!Array.isArray(tl) || tl.length === 0) return '';
                return tl.map((t: any) => `${t.time || ''}|${t.chapter || ''}|${t.event || ''}|${t.impact || ''}`).join('\n');
            })(),
            characterCores: (() => {
                const cores = data.character_cores;
                if (!cores) return '';
                if (typeof cores === 'string') return cores;
                if (Array.isArray(cores)) {
                    return cores.map((c: any) => `${c.name || ''}: ${c.coreTraits || c.summary || ''}`).join('\n');
                }
                return String(cores);
            })(),
            triggeredMemories: data.triggered_memories_prompt || (Array.isArray(data.triggered_memories)
                ? (data.triggered_memories as any[]).map((m: any) => `${m.character || ''}: ${m.content || m.text || ''}`).join('\n')
                : ''),
            precedingText: '',
            cursorHint: '',
            currentMode: 'continue',
            gatheredAt: Date.now(),
            dirtyFields: new Set()
        };
    }

    // ============================================================
    // 私有方法：获取推荐方向
    // ============================================================

    private getRecommendDirections(count: number): SuggestionDirection[] {
        // 优先使用 session 中的动态方向
        if (this.session?.currentMetrics?.nextDirectionHints?.length) {
            return this.session.currentMetrics.nextDirectionHints.slice(0, count);
        }

        // 默认方向：动作、情绪、对话
        return ['action', 'emotion', 'dialogue'].slice(0, count) as SuggestionDirection[];
    }

    // ============================================================
    // C3：连贯 / 冗余轻审查（同步，不走 AI）
    checkCoherence(body: string): CoherenceReport {
        return analyzeCoherence(body);
    }

    // C1：逻辑一致性轻审查（同步，不走 AI）
    checkLogicConsistency(body: string): LogicConsistencyReport {
        return analyzeLogicConsistency(body);
    }

    // C4：敏感 / 违和内容预警（同步，不走 AI）
    checkContentSafety(body: string): ContentSafetyReport {
        return analyzeContentSafety(body);
    }

    // D3：跨章节剧情冗余度检查（只读当前项目/当前卷前 10 章）
    async checkPlotRedundancy(body: string): Promise<PlotRedundancyReport> {
        if (!this.session) {
            return analyzePlotRedundancy(body, []);
        }
        const previousBodies = await loadPreviousChapterBodies(
            this.app,
            this.session.project,
            this.session.volume,
            this.session.chapterNum,
            10
        );
        return analyzePlotRedundancy(body, previousBodies);
    }

    // ============================================================
    // C1：提前剧透 / 越界风险检测（同步启发式，不走 AI）
    // ============================================================

    // 为单条建议标注 riskLevel / riskWarnings，不修改文本本身
    annotateSuggestionRisk(suggestion: SuggestionRecord): SuggestionRecord {
        try {
            const warnings: string[] = [];
            const text = (suggestion.text || '').trim();
            if (!text) return suggestion;

            // 1. 未揭示伏笔被提前点名（高风险）
            const fs: any = this.snapshot?.foreshadows;
            const unrevealed: any[] = Array.isArray(fs?.unrevealed) ? fs.unrevealed : [];
            for (const item of unrevealed) {
                const name = (item?.name || '').trim();
                if (name.length >= 2 && text.includes(name)) {
                    warnings.push(`可能提前揭示未揭示伏笔：「${name}」（计划揭示：${item?.plannedReveal || '未定'}）`);
                }
            }

            // 2. 越界“上帝视角/提前下结论”剧透句式（中高风险）
            const spoilerPatterns: Array<{ re: RegExp; msg: string }> = [
                { re: /(其实|原来)[^。！？]{0,12}(就是|才是|是|并非)/, msg: '“其实/原来…是…”可能提前揭谜' },
                { re: /(最终|结局|到最后|多年后|日后)[^。！？]{0,16}(死|胜|败|分开|在一起|统一|灭亡)/, msg: '提前交代结局走向，可能越界剧透' },
                { re: /(会发现|将会|日后会|未来会)[^。！？]{0,12}(背叛|死去|真相|身世)/, msg: '预告未来关键转折，谨防提前剧透' },
            ];
            for (const { re, msg } of spoilerPatterns) {
                if (re.test(text)) warnings.push(msg);
            }

            if (warnings.length === 0) {
                suggestion.riskLevel = 'low';
                suggestion.riskWarnings = [];
                return suggestion;
            }

            // 命中伏笔点名視为高风险；仅句式命中为中风险
            const hitsForeshadow = warnings.some(w => w.startsWith('可能提前揭示未揭示伏笔'));
            suggestion.riskLevel = hitsForeshadow ? 'high' : 'medium';
            suggestion.riskWarnings = warnings;
        } catch (e) {
            console.warn('[CoWriterEngine] C1: 剧透风险标注失败:', e);
        }
        return suggestion;
    }

    // ============================================================
    // 剧情节点提取与进度追踪 (v6.4)
    // ============================================================

    private plotNodes: PlotNode[] = [];
    private currentNodeIndex: number = 0;

    /** 从大纲摘要和Scene展开中提取剧情节点 */
    private extractPlotNodes(): PlotNode[] {
        const nodes: PlotNode[] = [];
        const outline = this.snapshot?.chapPlan || '';
        const sceneExp = this.snapshot?.sceneExpansion || '';

        // 1. 从大纲摘要的"关键场景"表格提取
        const keySceneSection = this.extractSection(outline, /##\s*关键场景/i);
        if (keySceneSection) {
            const tableRows = keySceneSection.match(/^\|\s*\d+\s*\|.*$/gm) || [];
            for (const row of tableRows) {
                const cells = row.split('|').map(c => c.trim()).filter(Boolean);
                if (cells.length >= 3) {
                    nodes.push({
                        id: `outline_${nodes.length + 1}`,
                        index: nodes.length + 1,
                        location: cells[1] || '',
                        characters: cells[2] || '',
                        conflict: cells[3] || '',
                        goal: cells[4] || cells[3] || '',
                        infoIncrement: cells[5] || '',
                        source: 'outline',
                        completed: false
                    });
                }
            }
        }

        // 2. 从Scene展开中提取场景（按## 场景N拆分）
        if (sceneExp) {
            const sceneSections = sceneExp.split(/##\s*场景\s*\d+/i).slice(1);
            let sceneIdx = 0;
            for (const section of sceneSections) {
                sceneIdx++;
                const titleMatch = section.match(/^[^\n]+/);
                const title = titleMatch ? titleMatch[0].trim() : `场景${sceneIdx}`;
                const locationMatch = section.match(/地点[：:]\s*([^\n]+)/i);
                const charMatch = section.match(/人物[：:]\s*([^\n]+)/i);
                const goalMatch = section.match(/(叙事目标|场景目标|核心事件)[：:]\s*([^\n]+)/i);

                nodes.push({
                    id: `scene_${sceneIdx}`,
                    index: nodes.length + 1,
                    location: locationMatch ? locationMatch[1].trim() : '',
                    characters: charMatch ? charMatch[1].trim() : '',
                    conflict: '',
                    goal: goalMatch ? goalMatch[2].trim() : title,
                    infoIncrement: '',
                    source: 'scene_expand',
                    completed: false
                });
            }
        }

        // 3. 如果都没有，从情节蒸馏的"情节节点规划"提取
        if (nodes.length === 0) {
            const plotDistill = this.snapshot?.chapPlan || '';
            const nodeSection = this.extractSection(plotDistill, /##\s*情节节点规划/i);
            if (nodeSection) {
                const nodeMatches = nodeSection.match(/^-\s*节点\d+[：:]\s*.+$/gm) || [];
                let idx = 0;
                for (const m of nodeMatches) {
                    idx++;
                    const text = m.replace(/^-\s*节点\d+[：:]\s*/, '').trim();
                    nodes.push({
                        id: `node_${idx}`,
                        index: idx,
                        location: '',
                        characters: '',
                        conflict: '',
                        goal: text,
                        infoIncrement: '',
                        source: 'plot_distill',
                        completed: false
                    });
                }
            }
        }

        return nodes;
    }

    /** 提取Markdown中指定标题下的内容 */
    private extractSection(content: string, headingRegex: RegExp): string | null {
        const lines = content.split('\n');
        let start = -1;
        for (let i = 0; i < lines.length; i++) {
            if (headingRegex.test(lines[i])) {
                start = i + 1;
                break;
            }
        }
        if (start < 0) return null;
        const result: string[] = [];
        for (let i = start; i < lines.length; i++) {
            if (/^##+\s+/.test(lines[i])) break;
            result.push(lines[i]);
        }
        return result.join('\n').trim();
    }

    /** 计算当前剧情进度：已完成哪些节点，下一个目标是什么 */
    private computePlotProgress(currentBody: string): PlotProgress {
        if (this.plotNodes.length === 0) {
            this.plotNodes = this.extractPlotNodes();
        }

        const bodyLower = currentBody.toLowerCase();
        let completedCount = 0;
        let firstIncomplete = -1;

        for (let i = 0; i < this.plotNodes.length; i++) {
            const node = this.plotNodes[i];
            const signals = [node.goal, node.location, node.characters, node.conflict]
                .filter(Boolean)
                .map(s => s.toLowerCase())
                .filter(s => s.length >= 3);

            let hitCount = 0;
            for (const sig of signals) {
                if (bodyLower.includes(sig)) hitCount++;
            }

            const completed = signals.length > 0 && hitCount >= Math.min(1, Math.ceil(signals.length * 0.3));
            node.completed = completed;
            if (completed) {
                completedCount++;
            } else if (firstIncomplete < 0) {
                firstIncomplete = i;
            }
        }

        const total = this.plotNodes.length;
        const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        const nextNode = firstIncomplete >= 0 && firstIncomplete < total
            ? this.plotNodes[firstIncomplete]
            : null;

        return {
            totalNodes: total,
            completedNodes: completedCount,
            currentIndex: firstIncomplete >= 0 ? firstIncomplete : total,
            completionPercent: percent,
            nextNode,
            allCompleted: firstIncomplete < 0
        };
    }

    /** 获取当前应该推进的剧情节点描述（用于注入prompt） */
    private getCurrentPlotTarget(precedingText: string): string {
        const progress = this.computePlotProgress(precedingText);
        if (!progress.nextNode) {
            const lastNode = this.plotNodes[this.plotNodes.length - 1];
            if (lastNode) {
                return `本章所有剧情节点已推进完毕，当前处于收尾阶段。请为当前场景画上句号并自然过渡到章末钩子。`;
            }
            return '';
        }

        const node = progress.nextNode;
        const parts: string[] = [];
        parts.push(`当前进度：第${progress.currentIndex + 1}/${progress.totalNodes}个剧情节点（已完成${progress.completionPercent}%）`);
        parts.push(`下一个剧情目标：${node.goal || '推进当前场景'}`);
        if (node.location) parts.push(`地点：${node.location}`);
        if (node.characters) parts.push(`涉及人物：${node.characters}`);
        if (node.conflict) parts.push(`冲突焦点：${node.conflict}`);

        return parts.join('\n');
    }

    // ============================================================
    // 私有方法：构建 AI 提示词
    // ============================================================

    private buildDirectionalPrompt(
        precedingText: string,
        direction: SuggestionDirection,
        cursorHint: string
    ): { system: string; user: string } {
        let soulInjection = '';
        if (this.soulData?.protagonist?.hasSoul) {
            soulInjection = getProtagonistSoulDetail(this.soulData.protagonist);
        }

        const plotTarget = this.getCurrentPlotTarget(precedingText);

        if (this.promptBuilder) {
            return this.promptBuilder.buildSuggestionPrompt(
                precedingText,
                direction,
                cursorHint,
                soulInjection,
                plotTarget
            );
        }

        const dirPrompt = '请根据当前写作方向自然地续写一段。';
        const snap = this.snapshot;
        const systemPrompt = [
            '你是一位第三人称限知视角的叙事者。你不是在"写小说"，你是在用镜头紧贴主角，把他/她正在经历的一切原样呈现出来。',
            '',
            '【叙事视角规则】',
            '- 严格第三人称限知：只写主角能看到、听到、摸到、感受到的东西。',
            '- 不跳其他角色的内心，不写上帝视角的全局解释。',
            '- 心理活动用自由间接引语，不用"他心想""他觉得"这种标签。',
            '- 所有认知都从主角的感官出发，有温度、有重量、有气味。',
            '',
            '【怎么写才像活人经历的】',
            '- 不说教，不总结，不解释。事情在发生，不是在被讲述。',
            '- 情绪不说出口。不讲"他很难过"，讲"他指尖无意识掐进掌心"。',
            '- 不用排比，不用华丽辞藻堆砌。活人眼里的世界没那么多修辞。',
            '- 每句只讲一件事。一句话就是一个画面。',
            '- 不重复。同样的意思不说第二遍。',
            '- 不用"然后""接着""就在这时"这种过渡词。画面直接跳。',
            '',
            '【番茄小说分段风格】',
            '- 段落极短，大多只有一句话。',
            '- 一句话就是一段，换行直接切下一个画面。',
            '- 对话单独成段，前后各留呼吸。',
            '- 感官细节单独成段，一个细节就是一记重锤。',
        ].filter(Boolean).join('\n');

        const userParts: string[] = [
            '【已写内容】',
            precedingText.slice(-800),
            '',
            '【写作方向】',
            dirPrompt
        ].filter(Boolean);

        if (cursorHint) {
            userParts.push('', '【特别指令】', cursorHint);
        }

        userParts.push('', '请自然地续写一段。不需要多，但要让人感觉这一瞬间是真实的。只输出正文，不要标注、不要解释、不要写标题。');
        return { system: systemPrompt, user: userParts.join('\n') };
    }
    // D2: 跨卷一致性——注入前面卷的状态快照（人物/势力/伏笔/时间线）
    getCrossVolumePromptParts(): string[] {
        const ctx = (this.snapshot?.crossVolumeContext || '').trim();
        if (!ctx) return [];
        return ['【D2 跨卷状态快照（请保持与前面卷的人物/势力/伏笔/时间线一致）】', ctx.slice(0, 1200), ''];
    }

    private buildValidationPrompt(
        modifiedText: string,
        original: SuggestionRecord,
        context: string
    ): string {
        if (this.promptBuilder) {
            return this.promptBuilder.buildValidationPrompt(modifiedText, original.text, context);
        }
        return [
            '你是一个小说编辑。请验证以下编辑是否符合故事的整体一致性。',
            '',
            '【原文建议】',
            original.text,
            '',
            '【用户修改后】',
            modifiedText,
            '',
            '【上下文】',
            context.slice(-500),
            '',
            '请评估三个方面（各 0-100 分）：',
            '1. 设定一致性：是否与已有世界观/人物设定冲突',
            '2. 文风对齐：是否与整体文风一致',
            '3. 剧情对齐：是否推动当前场景目标',
            '',
            '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
            '{',
            '  "consistencyScore": 85,',
            '  "styleScore": 78,',
            '  "plotAlignmentScore": 90,',
            '  "warnings": ["警告信息"],',
            '  "suggestions": ["改进建议"]',
            '}'
        ].join('\n');
    }

    private buildEvaluationPrompt(body: string, progress: PlotProgress): string {
        const wordCount = body.length;
        const chapterPlan = this.snapshot?.chapPlan || '';

        const nodeList = this.plotNodes.map((node, i) => {
            const status = i < progress.currentIndex ? '✓ 已完成' : (i === progress.currentIndex ? '→ 进行中' : '○ 未开始');
            return `${i + 1}. [${status}] ${node.goal}${node.location ? `（${node.location}）` : ''}`;
        }).join('\n');

        return [
            '你是一个小说结构分析师。请评估当前正文的剧情完成度。',
            '',
            '【本章剧情节点（按顺序）】',
            nodeList || '（暂无节点信息）',
            '',
            '【章节目标】',
            chapterPlan.slice(0, 500) || '（暂无章节目标信息）',
            '',
            `【当前正文】（约 ${wordCount} 字符）`,
            body.slice(-1500),
            '',
            '请评估以下维度（各 0-100 分）：',
            '1. sceneObjectivesMet：场景目标完成度（基于剧情节点完成情况）',
            '2. characterArcsAdvanced：人物弧推进度（主角内心变化/成长推进了多少）',
            '3. foreshadowingSeeded：伏笔埋设程度（是否埋设了足够的伏笔/铺垫）',
            '4. emotionalArcProgress：情绪弧进度（情绪变化是否按预期推进）',
            '5. overallCompletion：总体完成度（综合以上所有维度的加权平均）',
            '',
            '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
            '{',
            '  "sceneObjectivesMet": 80,',
            '  "characterArcsAdvanced": 52,',
            '  "foreshadowingSeeded": 30,',
            '  "emotionalArcProgress": 65,',
            '  "overallCompletion": 57,',
            '  "suggestionAdvice": "一句话建议，指出当前最应该推进的内容",',
            '  "nextDirectionHints": ["action", "dialogue", "description"]',
            '}'
        ].join('\n');
    }

    // ============================================================
    // 私有方法：解析 AI 返回
    // ============================================================

    private parseValidationResponse(raw: string): EditValidation {
        try {
            // 清理可能的 markdown 代码块标记
            const cleaned = raw
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            const json = JSON.parse(cleaned);

            const consistencyScore = Number(json.consistencyScore) || 0;
            const styleScore = Number(json.styleScore) || 0;
            const plotAlignmentScore = Number(json.plotAlignmentScore) || 0;

            return {
                isValid: consistencyScore >= 60 && styleScore >= 60 && plotAlignmentScore >= 60,
                consistencyScore,
                styleScore,
                plotAlignmentScore,
                overallScore: Math.round((consistencyScore + styleScore + plotAlignmentScore) / 3),
                warnings: Array.isArray(json.warnings) ? json.warnings : [],
                suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
                validatedAt: Date.now()
            };
        } catch (e) {
            console.warn('[CoWriterEngine] 验证结果 JSON 解析失败，使用默认值:', e);
            return {
                isValid: true,
                consistencyScore: 70,
                styleScore: 70,
                plotAlignmentScore: 70,
                overallScore: 70,
                warnings: [],
                suggestions: ['验证结果解析失败，默认通过'],
                validatedAt: Date.now()
            };
        }
    }

    private parseEvaluationResponse(raw: string): PlotCompletionMetrics {
        try {
            const cleaned = raw
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            const json = JSON.parse(cleaned);

            const scores = [
                Number(json.sceneObjectivesMet) || 0,
                Number(json.characterArcsAdvanced) || 0,
                Number(json.foreshadowingSeeded) || 0,
                Number(json.emotionalArcProgress) || 0
            ];

            const aiOverall = Number(json.overallCompletion);
            const avgOverall = Math.round(scores.reduce((a, b) => a + b, 0) / 4);
            const overallCompletion = !isNaN(aiOverall) && aiOverall > 0 ? aiOverall : avgOverall;

            return {
                sceneObjectivesMet: scores[0],
                characterArcsAdvanced: scores[1],
                foreshadowingSeeded: scores[2],
                emotionalArcProgress: scores[3],
                overallCompletion,
                suggestionAdvice: json.suggestionAdvice || '',
                nextDirectionHints: Array.isArray(json.nextDirectionHints)
                    ? json.nextDirectionHints as SuggestionDirection[]
                    : ['action', 'emotion', 'dialogue'],
                evaluatedAt: Date.now()
            };
        } catch (e) {
            console.warn('[CoWriterEngine] 完成度 JSON 解析失败，使用默认值:', e);
            return this.getEmptyMetrics();
        }
    }

    // ============================================================
   // 私有方法：空指标
   // ============================================================

   private getEmptyMetrics(): PlotCompletionMetrics {
       return {
           sceneObjectivesMet: 0,
           characterArcsAdvanced: 0,
           foreshadowingSeeded: 0,
           emotionalArcProgress: 0,
           overallCompletion: 0,
           suggestionAdvice: '尚未评估',
           nextDirectionHints: ['action', 'emotion', 'dialogue'],
           evaluatedAt: Date.now()
       };
   }
    
    // ============================================================
    // A1: OOC 检测方法
    // ============================================================
    
    /**
     * 检测文本是否违背角色灵魂层设定
     */
    private async checkOOC(text: string, soul: CharacterSoul): Promise<OOCCheckResult> {
        if (!soul.hasSoul || !this.hasCoWriteModel()) {
            return { hasOOC: false, warnings: [], score: 100, violatedFields: [], checkedAt: Date.now() };
        }

        const prompt = this.promptBuilder
            ? this.promptBuilder.buildOOCPrompt(text, soul)
            : [
                '你是角色设定审查员。检查以下文本是否违背角色的核心特质。',
                '',
                '【角色灵魂层】',
                `- 最渴望: ${soul.desire}`,
                `- 最恐惧: ${soul.fear}`,
                `- 执念: ${soul.obsession}`,
                `- 创伤: ${soul.trauma}`,
                `- 弱点: ${soul.weakness}`,
                `- 软处: ${soul.soft_spot}`,
                `- 暴走红线: ${soul.rage_trigger}`,
                `- 底线: ${soul.moral_boundary}`,
                '',
                '【待检查文本】',
                text,
                '',
                '请判断：该角色在此文本中的行为/心理是否符合其核心特质？',
                '以 JSON 格式返回（不要包含 markdown 代码块）：',
                '{',
                '  "hasOOC": false,',
                '  "warnings": ["如果违背，列出具体问题"],',
                '  "score": 85,',
                '  "violatedFields": ["desire", "fear"] // 违背的字段名',
                '}'
            ].join('\n');
        
        try {
            const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
            const raw = extractResponseText(response);
            const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const json = JSON.parse(cleaned);
            
            return {
                hasOOC: json.hasOOC || false,
                warnings: json.warnings || [],
                score: Number(json.score) || 70,
                violatedFields: json.violatedFields || [],
                checkedAt: Date.now()
            };
        } catch (e) {
            console.warn('[CoWriterEngine] A1: OOC检测解析失败:', e);
            return { hasOOC: false, warnings: ['OOC检测解析失败'], score: 70, violatedFields: [], checkedAt: Date.now() };
        }
    }
    
    // ============================================================
    // D1: 实体状态追踪方法
    // ============================================================
    
    /**
     * 追踪当前正文中的实体状态变化
     */
    async trackEntityStates(bodyContent: string): Promise<EntityStateChange[]> {
        if (!this.entityStateManager || !this.session) return [];
        
        try {
            const changes = await this.entityStateManager.detectStateChanges(
                bodyContent,
                this.session.project,
                this.session.chapterNum,
                this.session.chapterName
            );
            this.pendingStateChanges = changes;
            return changes;
        } catch (e) {
            console.warn('[CoWriterEngine] D1: 实体状态追踪失败:', e);
            return [];
        }
    }
    
    /**
     * 确认并应用待处理的状态变更
     */
    async confirmStateChanges(): Promise<void> {
        if (!this.entityStateManager || !this.pendingStateChanges.length || !this.session) return;

        try {
            await this.entityStateManager.applyStateChanges(
                this.session.project,
                this.pendingStateChanges,
                this.session.chapterNum,
                this.session.chapterName
            );
            this.pendingStateChanges = [];
        } catch (e) {
            console.warn('[CoWriterEngine] D1: 状态变更应用失败:', e);
        }
    }
    
    /**
     * A1+D1: 检查正文是否触发角色 OOC 或实体状态变更。
     */
    async inspectSettingGuard(bodyContent: string): Promise<SettingGuardReport> {
        let oocResult: OOCCheckResult | null = null;
        let entityChanges: EntityStateChange[] = [];

        if (this.soulData?.protagonist?.hasSoul && bodyContent.trim()) {
            oocResult = await this.checkOOC(bodyContent.slice(-1200), this.soulData.protagonist);
        }

        if (bodyContent.trim()) {
            entityChanges = await this.trackEntityStates(bodyContent);
        }

        return {
            oocResult,
            entityChanges,
            checkedAt: Date.now()
        };
    }
    /**
     * 获取待处理的状态变更列表
     */
    getPendingStateChanges(): EntityStateChange[] {
        return [...this.pendingStateChanges];
    }
    
    // ============================================================
    // 辅助方法
    // ============================================================
    
    private getProtagonistName(project: string): string {
        // 优先：扫描 01-世界架构/人物/*.md 的 frontmatter，
        // 若「身份」字段含「主角」/「主人公」，取该文件名（去 .md）作为主角名。
        const charsDir = pjCharsDir(project);
        try {
            const files = this.getVaultMeta().getFiles();
            for (const f of files) {
                if (!f.path.startsWith(charsDir + '/') || !f.path.endsWith('.md')) continue;
                const cache = this.app.metadataCache.getFileCache(f);
                const role = cache?.frontmatter?.['身份'];
                const roleStr = Array.isArray(role) ? role.join('') : String(role || '');
                if (roleStr.includes('主角') || roleStr.includes('主人公')) {
                    const name = f.name.replace(/\.md$/, '');
                    if (name) return name;
                }
            }
        } catch { /* 回退到下方默认逻辑 */ }

        // 回退1：工作台状态（保留向后兼容）
        const state = this.aiEngine.getPlugin()?._workbenchState;
        if (state?.protagonistName) return state.protagonistName;
        if (state?.protagonist) return state.protagonist;
        return '主角'; // 回退2：默认值
    }
 
    // ============================================================
    // B1: 联想输入 Copilot
    // ============================================================
    
    /**
     * 基于上下文的智能联想输入
     */
    async suggestAssociation(
        cursorPosition: number,
        fullText: string,
        trigger: 'space' | 'enter' | 'period' | 'manual' = 'manual'
    ): Promise<AssociationSuggestion[]> {
        if (!this.snapshot || !this.hasCoWriteModel()) return [];
        
        // 获取光标前后的上下文
        const beforeCursor = fullText.slice(Math.max(0, cursorPosition - 500), cursorPosition);
        const afterCursor = fullText.slice(cursorPosition, cursorPosition + 200);
        
        // 分析可能的联想方向
        const hints = await this.analyzeAssociationContext(beforeCursor);
        
        // 生成联想建议
        const suggestions: AssociationSuggestion[] = [];
        
        for (let i = 0; i < Math.min(3, hints.length); i++) {
            const hint = hints[i];
            try {
                const text = await this.generateAssociationText(beforeCursor, hint);
                suggestions.push({
                    text,
                    type: hint.type,
                    confidence: hint.confidence,
                    preview: text.slice(0, 50) + (text.length > 50 ? '...' : '')
                });
            } catch (e) {
                console.warn('[CoWriterEngine] B1: 联想生成失败:', e);
            }
        }
        
        return suggestions;
    }
    
    /**
     * 分析联想上下文
     */
    private async analyzeAssociationContext(text: string): Promise<import('../shared/co-writer-types').AssociationHint[]> {
        const hints: import('../shared/co-writer-types').AssociationHint[] = [];
        
        // 检测最后提及的实体
        const recentEntities = this.extractRecentEntities(text);
        if (recentEntities.length > 0) {
            hints.push({ type: 'entity-action', entity: recentEntities[0], confidence: 0.8 });
        }
        
        // 检测当前情绪走向
        const lastPunctuation = Math.max(
            text.lastIndexOf('。'),
            text.lastIndexOf('！'),
            text.lastIndexOf('？')
        );
        const lastSentence = lastPunctuation >= 0 ? text.slice(lastPunctuation) : text;
        
        // 简单情绪检测
        if (/[愤怒恨杀]/.test(lastSentence)) {
            hints.push({ type: 'escalate', emotion: 'anger', confidence: 0.7 });
        } else if (/[恐惧怕惊]/.test(lastSentence)) {
            hints.push({ type: 'escalate', emotion: 'fear', confidence: 0.7 });
        }
        
        // 检测未完成的对话
        const hasOpenDialogue = /["「『"][^"'」』]*$/.test(text);
        if (hasOpenDialogue) {
            hints.push({ type: 'dialogue', confidence: 0.9 });
        }
        
        // 默认建议
        if (hints.length === 0) {
            hints.push({ type: 'emotion', emotion: 'neutral', confidence: 0.5 });
        }
        
        return hints;
    }
    
    /**
     * 提取最近提及的实体
     */
    private extractRecentEntities(text: string): string[] {
        const entities: string[] = [];
        
        // 从灵魂数据中获取所有角色名
        const allChars = this.soulData?.allSouls || '';
        const charNames = allChars.match(/【[^】]+】/g)?.map(s => s.replace(/[【】]/g, '')) || [];
        
        // 找出最近提及的角色
        for (const name of charNames) {
             const lastMention = text.lastIndexOf(name);
             if (lastMention >= 0 && lastMention >= text.length - 200) {
                 entities.push(name);
             }
        }
        
        return entities;
    }
    
    /**
     * 生成联想文本
     */
    private async generateAssociationText(
        context: string, 
        hint: import('../shared/co-writer-types').AssociationHint
    ): Promise<string> {
        const prompt = this.promptBuilder
            ? this.promptBuilder.buildAssociationPrompt(context, hint)
            : [
                '根据上下文，续写1-2句话（30-80字）。',
                '',
                '【上下文】',
                context.slice(-300),
                '',
                '直接输出续写内容，不要解释：'
            ].join('\n');
        
        const response = await this.callCoWriteAI({ system: '', user: prompt }, 0);
        
        return extractResponseText(response);
    }
}

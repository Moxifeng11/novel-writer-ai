/**
 * co-write-facade.ts — 协同写作 UI 数据访问门面
 *
 * 封装对 EngineRegistry、CoWriterEngine 和各 Repository 的访问，
 * 为 UI 层提供统一的数据获取和操作接口，隐藏底层实现细节。
 *
 * 设计原则：
 * - UI 层只与 Facade 交互，不直接访问 plugin.engine.*
 * - Facade 不可用时回退到直接访问 plugin（向后兼容）
 * - 只封装数据访问，不包含 UI 渲染逻辑
 */

import type NovelWriterPlugin from '../../main';
import type { EngineRegistry } from '../../engine/engine-registry';
import { ENGINE_NAMES } from '../../engine/engine-registry';
import type { CoWriterEngine } from '../../engine/co-writer-engine';
import type { ChapterBrief, ChapterBriefInput } from '../../engine/chapter-brief';
import type {
    SuggestionRecord,
    SuggestionDirection,
    EditValidation,
    PlotCompletionMetrics,
    SentenceEditRecord,
} from '../../shared/types';
import type { AssociationSuggestion } from '../../shared/co-writer-types';
import type {
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from '../../engine/repository';
import { EmotionCurveAnalyzer } from '../../engine/emotion-curve-analyzer';
import { RhythmAnalyzer } from '../../engine/rhythm-analyzer';
import { EndingTractionEngine } from '../../engine/ending-traction-engine';
import type { KnowledgeBaseManager } from '../../services/knowledge-base-manager';
import type { StyleLearner } from '../../engine/style-learner';
import type { PreferenceMemory } from '../../engine/preference-memory';
import type { BookBasicInfo } from '../../services/knowledge-base-manager';
import { createCoWritingSessionStore } from '../../engine/co-writer';
import type { CoWritingSessionStore } from '../../engine/co-writer';
import type { CoWritingSessionState } from '../../engine/co-writer/session-state';
import type { StateListener } from '../../shared/store/types';
import { createLogger } from '../../shared/logger';


const log = createLogger('CoWriteFacade');
export interface CoWriteFacadeOptions {
    plugin: NovelWriterPlugin;
}

export class CoWriteFacade {
    private plugin: NovelWriterPlugin;
    private _engine: CoWriterEngine | null = null;
    private _registry: EngineRegistry | null = null;
    private _sessionStore: CoWritingSessionStore | null = null;

    constructor(options: CoWriteFacadeOptions) {
        this.plugin = options.plugin;
        this._initSessionStore();
    }

    private _initSessionStore(): void {
        try {
            const isDev = (this.plugin as any)._isDevMode || false;
            this._sessionStore = createCoWritingSessionStore({
                plugin: this.plugin as any,
                enableLogger: isDev,
                enableDevtools: isDev,
            });
            if (this._registry) {
                this._registry.register(ENGINE_NAMES.CO_WRITING_SESSION_STORE, this._sessionStore);
            }
        } catch (e) {
            log.warn('[CoWriteFacade] 初始化 session store 失败:', e);
            this._sessionStore = null;
        }
    }

    // ============================================================
    // 基础访问器：获取底层引擎实例（向后兼容）
    // ============================================================

    get engine(): CoWriterEngine {
        if (!this._engine) {
            this._engine = this.plugin.coWriterEngine;
        }
        return this._engine;
    }

    get registry(): EngineRegistry | null {
        if (!this._registry) {
            const registry = (this.plugin as any).engineRegistry as EngineRegistry | undefined;
            this._registry = registry || null;
            if (this._registry && this._sessionStore) {
                this._tryRegisterStore();
            }
        }
        return this._registry;
    }

    get pluginRef(): NovelWriterPlugin {
        return this.plugin;
    }

    private _tryRegisterStore(): void {
        if (!this._registry || !this._sessionStore) return;
        try {
            if (!this._registry.has(ENGINE_NAMES.CO_WRITING_SESSION_STORE)) {
                this._registry.register(ENGINE_NAMES.CO_WRITING_SESSION_STORE, this._sessionStore);
            }
        } catch (e) {
            log.warn('[CoWriteFacade] 注册 session store 到 registry 失败:', e);
        }
    }

    // ============================================================
    // Session Store 访问（渐进式迁移用）
    // ============================================================

    getStore(): CoWritingSessionStore | null {
        return this._sessionStore;
    }

    subscribe(listener: StateListener<CoWritingSessionState>): (() => void) | null {
        if (!this._sessionStore) return null;
        return this._sessionStore.subscribe(listener);
    }

    // ============================================================
    // CoWriterEngine 核心方法封装
    // ============================================================

    async initEngine(project: string, chapterName: string, volume: string, chapterNum: number): Promise<void> {
        await this.engine.init(project, chapterName, volume, chapterNum);
    }

    updateSnapshot(confirmedText: string): void {
        this.engine.updateSnapshot(confirmedText);
    }

    /** 设置本章简报（承接规划阶段成果） */
    setChapterBrief(input: ChapterBriefInput): void {
        this.engine.setChapterBrief(input);
    }

    /** 获取本章简报 */
    getChapterBrief(): ChapterBrief | null {
        return this.engine.getChapterBrief();
    }

    /** 手动切换当前场景 */
    setCurrentSceneIndex(index: number): void {
        this.engine.setCurrentSceneIndex(index);
    }

    setCursorHint(hint: string): void {
        this.engine.setCursorHint(hint);
    }

    setPrecisionMode(enabled: boolean): void {
        this.engine.setPrecisionMode(enabled);
    }

    getPrecisionMode(): boolean {
        return this.engine.getPrecisionMode();
    }

    getSession() {
        return this.engine.getSession();
    }

    getSnapshot() {
        return this.engine.getSnapshot();
    }

    getHistory(): SentenceEditRecord[] {
        return this.engine.getHistory();
    }

    async suggestNext(
        precedingText: string,
        cursorHint: string,
        mode: string,
        count: number,
        signal?: AbortSignal,
        onChunk?: (index: number, cumulativeText: string) => void
    ): Promise<SuggestionRecord[]> {
        return this.engine.suggestNext(precedingText, cursorHint, mode as any, count, signal, onChunk);
    }

    /** 最近一次建议生成的失败原因（null 表示无错误或已成功） */
    getLastSuggestError(): string | null {
        return this.engine.lastSuggestError;
    }

    /** 当前串行候选进度（第几条 / 共几条）；并行模式或未生成时为 null */
    getSuggestProgress(): { current: number; total: number } | null {
        return this.engine.suggestProgress;
    }

    async *suggestStream(
        precedingText: string,
        cursorHint: string,
        mode: string,
        directionIndex: number,
        signal?: AbortSignal
    ): AsyncGenerator<string, SuggestionRecord | null, unknown> {
        return yield* this.engine.suggestStream(precedingText, cursorHint, mode as any, directionIndex, signal);
    }

    async iterateSuggestion(
        suggestion: SuggestionRecord,
        instruction: string,
        precedingText: string,
        cursorHint: string,
        signal?: AbortSignal
    ): Promise<SuggestionRecord | null> {
        return this.engine.iterateSuggestion(suggestion, instruction, precedingText, cursorHint, signal);
    }

    async rewriteSelection(
        selectedText: string,
        beforeContext: string,
        afterContext: string,
        cursorHint: string,
        count: number,
        onChunk?: (index: number, cumulativeText: string) => void,
        signal?: AbortSignal
    ): Promise<SuggestionRecord[]> {
        return this.engine.rewriteSelection(selectedText, beforeContext, afterContext, cursorHint, count, onChunk, signal);
    }

    async suggestAssociation(
        cursor: number,
        text: string,
        trigger: string,
        signal?: AbortSignal
    ): Promise<AssociationSuggestion[]> {
        return this.engine.suggestAssociation(cursor, text, trigger as any, signal);
    }

    async validateEdit(
        modifiedText: string,
        suggestion: SuggestionRecord,
        context: string,
        signal?: AbortSignal,
    ): Promise<EditValidation> {
        return this.engine.validateEdit(modifiedText, suggestion, context, signal);
    }

    async evaluatePlotComplete(
        currentBody: string,
        signal?: AbortSignal
    ): Promise<PlotCompletionMetrics> {
        return this.engine.evaluatePlotComplete(currentBody, signal);
    }

    adjustDirection(metrics: PlotCompletionMetrics): SuggestionDirection[] {
        return this.engine.adjustDirection(metrics);
    }

    recordInteraction(record: SentenceEditRecord): void {
        this.engine.recordInteraction(record);
    }

    getMemorySnapshot() {
        return this.engine.getMemorySnapshot();
    }

    async addExplicitPreference(
        category: Parameters<PreferenceMemory['recordPreference']>[0],
        key: string,
        value: string
    ): Promise<void> {
        await this.engine.addExplicitPreference(category, key, value);
    }

    get directionKnowledgeCounts(): Record<string, number> {
        return this.engine.directionKnowledgeCounts || {};
    }

    get lastKnowledgeCount(): number {
        return this.engine.lastKnowledgeCount || 0;
    }

    get lastKnowledgeDroppedCount(): number {
        return this.engine.lastKnowledgeDroppedCount || 0;
    }

    getReferenceBooks(): string[] {
        return this.engine.getReferenceBooks();
    }

    setReferenceBooks(bookIds: string[]): void {
        this.engine.setReferenceBooks(bookIds);
    }

    async setReferenceBooksWithWeight(books: Array<{ bookId: string; weight: number; isPrimary: boolean }>): Promise<void> {
        await this.engine.setReferenceBooksWithWeight(books);
    }

    getKnowledgeMatchScore(text: string): Array<{ bookName: string; score: number; dimensions: string[] }> {
        return this.engine.getKnowledgeMatchScore(text);
    }

    getFingerprintLibrary() {
        return this.engine.getFingerprintLibrary();
    }

    getPlotProgress(body: string) {
        return (this.engine as any).getPlotProgress?.(body) || { totalNodes: 0, completedNodes: 0, completionPercent: 0 };
    }

    getRepositoryPerfStats() {
        return (this.engine as any).getRepositoryPerfStats?.() || {};
    }

    resetRepositoryPerfStats(): void {
        (this.engine as any).resetRepositoryPerfStats?.();
    }

    async refreshStaticContext(): Promise<void> {
        await this.engine.refreshStaticContext();
    }

    // ============================================================
    // Repository 访问封装
    // ============================================================

    getCharacterRepository(project: string): CharacterRepository | null {
        if (this.registry) {
            return this.registry.getCharacterRepository(project);
        }
        return null;
    }

    getChapterRepository(project: string): ChapterRepository | null {
        if (this.registry) {
            return this.registry.getChapterRepository(project);
        }
        return null;
    }

    getProjectRepository(): ProjectRepository | null {
        if (this.registry) {
            return this.registry.getOrNull(ENGINE_NAMES.PROJECT_REPOSITORY);
        }
        return null;
    }

    getFactionRepository(project: string): FactionRepository | null {
        if (this.registry) {
            return this.registry.getFactionRepository(project);
        }
        return null;
    }

    getLocationRepository(project: string): LocationRepository | null {
        if (this.registry) {
            return this.registry.getLocationRepository(project);
        }
        return null;
    }

    getItemRepository(project: string): ItemRepository | null {
        if (this.registry) {
            return this.registry.getItemRepository(project);
        }
        return null;
    }

    // ============================================================
    // 分析引擎访问封装
    // ============================================================

    createEmotionCurveAnalyzer(): EmotionCurveAnalyzer {
        return new EmotionCurveAnalyzer();
    }

    createRhythmAnalyzer(): RhythmAnalyzer {
        return new RhythmAnalyzer();
    }

    async createEndingTractionEngine(project: string): Promise<EndingTractionEngine> {
        const engine = new EndingTractionEngine({
            app: this.plugin.app,
            aiEngine: this.plugin.aiEngine,
            plugin: this.plugin,
        });
        await engine.initialize(project);
        return engine;
    }

    async getStyleLearner(project: string): Promise<StyleLearner | null> {
        if (this.registry) {
            try {
                return await this.registry.getStyleLearner(project);
            } catch {
                return null;
            }
        }
        return null;
    }

    // ============================================================
    // 知识库访问封装
    // ============================================================

    get knowledgeBaseManager(): KnowledgeBaseManager | null {
        return this.plugin.knowledgeBaseManager || null;
    }

    async getAllBooks(): Promise<BookBasicInfo[]> {
        if (!this.plugin.knowledgeBaseManager) return [];
        return this.plugin.knowledgeBaseManager.getAllBooks();
    }

    // ============================================================
    // 设置访问封装
    // ============================================================

    get settings() {
        return this.plugin.settings;
    }

    get aiEngine() {
        return this.plugin.aiEngine;
    }

    get app() {
        return this.plugin.app;
    }

    // ============================================================
    // 状态同步（渐进式迁移：只写不读）
    // ============================================================

    private _syncChapterState(partial: Partial<CoWritingSessionState>): void {
        if (!this._sessionStore) return;
        try {
            this._sessionStore.setState(partial);
        } catch (e) {
            log.warn('[CoWriteFacade] 同步 chapter 状态失败:', e);
        }
    }

    private _syncSuggestionState(partial: Partial<CoWritingSessionState>): void {
        if (!this._sessionStore) return;
        try {
            this._sessionStore.setState(partial);
        } catch (e) {
            log.warn('[CoWriteFacade] 同步 suggestion 状态失败:', e);
        }
    }

    private _syncEditorState(partial: Partial<CoWritingSessionState>): void {
        if (!this._sessionStore) return;
        try {
            this._sessionStore.setState(partial);
        } catch (e) {
            log.warn('[CoWriteFacade] 同步 editor 状态失败:', e);
        }
    }

    private _syncMetricsState(partial: Partial<CoWritingSessionState>): void {
        if (!this._sessionStore) return;
        try {
            this._sessionStore.setState(partial);
        } catch (e) {
            log.warn('[CoWriteFacade] 同步 metrics 状态失败:', e);
        }
    }

    private _syncUiState(partial: Partial<CoWritingSessionState>): void {
        if (!this._sessionStore) return;
        try {
            this._sessionStore.setState(partial);
        } catch (e) {
            log.warn('[CoWriteFacade] 同步 ui 状态失败:', e);
        }
    }

    syncChapterLoaded(project: string, volume: number, chapter: number, title: string, content: string, wordCount: number): void {
        this._syncChapterState({
            currentProject: project,
            currentVolume: volume,
            currentChapter: chapter,
            chapterTitle: title,
            chapterContent: content,
            wordCount: wordCount,
        });
    }

    syncChapterContent(content: string, wordCount: number): void {
        this._syncChapterState({
            chapterContent: content,
            wordCount: wordCount,
        });
    }

    syncSuggestionsGenerating(isGenerating: boolean): void {
        this._syncSuggestionState({ isGenerating });
    }

    syncSuggestionsReady(suggestions: SuggestionRecord[], direction?: SuggestionDirection): void {
        this._syncSuggestionState({
            isGenerating: false,
            generationError: null,
            ...(direction ? { currentDirection: direction } : {}),
        });
    }

    syncSuggestionsError(error: string): void {
        this._syncSuggestionState({
            isGenerating: false,
            generationError: error,
        });
    }

    syncEditorCursor(position: number): void {
        this._syncEditorState({ cursorPosition: position });
    }

    syncEditorEditing(isEditing: boolean, editBuffer?: string): void {
        this._syncEditorState({
            isEditing,
            ...(editBuffer !== undefined ? { editBuffer } : {}),
        });
    }

    syncPlotCompletion(metrics: PlotCompletionMetrics | null): void {
        this._syncMetricsState({ plotCompletion: metrics });
    }

    syncEditRecord(record: SentenceEditRecord): void {
        if (!this._sessionStore) return;
        try {
            const actions = this._sessionStore.actions;
            if (actions?.addEditRecord) {
                this._sessionStore.setState(actions.addEditRecord(record));
            }
        } catch (e) {
            log.warn('[CoWriteFacade] 同步编辑记录失败:', e);
        }
    }

    syncRightPanelTab(tab: string): void {
        this._syncUiState({ rightPanelTab: tab });
    }

    syncPanelExpanded(expanded: boolean): void {
        this._syncUiState({ isPanelExpanded: expanded });
    }

    // ============================================================
    // 项目信息封装
    // ============================================================

    getActiveProject(): string {
        return (this.plugin as any).getActiveProject?.() || '';
    }
}

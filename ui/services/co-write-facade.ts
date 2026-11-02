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
/**
 * 协同门面选项。
 */
export interface CoWriteFacadeOptions {
    plugin: NovelWriterPlugin;
}

/**
 * 协同写作门面。
 *
 * @example
 * ```ts
 * const facade = new CoWriteFacade({ plugin });
 * await facade.engine.init('长篇小说/书名', '第3章 试炼', '第1卷', 3);
 * const snapshot = facade.getSnapshot();
 * ```
 */
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

    /**
     * 取协同写作会话 store。
     * @returns store 或 null
     */
    getStore(): CoWritingSessionStore | null {
        return this._sessionStore;
    }

    /**
     * 订阅会话状态变化。
     *
     * @param listener - 监听器
     * @returns 取消订阅函数或 null
     */
    subscribe(listener: StateListener<CoWritingSessionState>): (() => void) | null {
        if (!this._sessionStore) return null;
        return this._sessionStore.subscribe(listener);
    }

    // ============================================================
    // CoWriterEngine 核心方法封装
    // ============================================================

    /**
     * 初始化协同写作引擎（项目/章节/卷/章号）。
     *
     * @param project - 项目（路径或对象）
     * @param chapterName - 章节名
     * @param volume - 卷
     * @param chapterNum - 章号
     */
    async initEngine(project: string, chapterName: string, volume: string, chapterNum: number): Promise<void> {
        await this.engine.init(project, chapterName, volume, chapterNum);
    }

    /**
     * 更新已确认正文快照。
     *
     * @param confirmedText - 已确认文本
     */
    updateSnapshot(confirmedText: string): void {
        this.engine.updateSnapshot(confirmedText);
    }

    /**
     * 设置本章简报（承接规划阶段成果）
     *
     * @param input - 输入
     */
    setChapterBrief(input: ChapterBriefInput): void {
        this.engine.setChapterBrief(input);
    }

    /**
     * 获取本章简报
     *
      * @returns ChapterBrief 或 null
     */
    getChapterBrief(): ChapterBrief | null {
        return this.engine.getChapterBrief();
    }

    /**
     * 手动切换当前场景
     *
     * @param index - 索引
     */
    setCurrentSceneIndex(index: number): void {
        this.engine.setCurrentSceneIndex(index);
    }

    /**
     * 设置光标提示。
     *
     * @param hint - 提示
     */
    setCursorHint(hint: string): void {
        this.engine.setCursorHint(hint);
    }

    /**
     * 开关精准模式。
     *
     * @param enabled - 是否启用
     */
    setPrecisionMode(enabled: boolean): void {
        this.engine.setPrecisionMode(enabled);
    }

    /**
     * 精准模式是否开启。
     * @returns 布尔值
     */
    getPrecisionMode(): boolean {
        return this.engine.getPrecisionMode();
    }

    /**
     * 取当前会话。
     * @returns 会话或 null
     */
    getSession() {
        return this.engine.getSession();
    }

    /**
     * 取正文快照。
     * @returns 快照或 null
     */
    getSnapshot() {
        return this.engine.getSnapshot();
    }

    /**
     * 取句子编辑历史。
     * @returns 编辑记录数组
     */
    getHistory(): SentenceEditRecord[] {
        return this.engine.getHistory();
    }

    /**
     * 生成下一句建议。
     *
     * @param precedingText - 前文
     * @param cursorHint - 光标提示
     * @param mode - 模式
     * @param count - 数量
     * @param signal - 参数
     * @param onChunk - 参数
     * @returns 建议结果
     */
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

    /**
     * 最近一次建议生成的失败原因（null 表示无错误或已成功）
     *
      * @returns 文本结果 或 null
     */
    getLastSuggestError(): string | null {
        return this.engine.lastSuggestError;
    }

    /**
     * 当前串行候选进度（第几条 / 共几条）；并行模式或未生成时为 null
     *
      * @returns number } 结果 或 null
     */
    getSuggestProgress(): { current: number; total: number } | null {
        return this.engine.suggestProgress;
    }

    /**
     * 流式生成写作建议。
     *
     * @param precedingText - 前文
     * @param cursorHint - 光标位置提示
     * @param mode - 写作模式
     * @param directionIndex - 方向索引
     * @param signal - 取消信号
     * @returns 逐块产出建议文本，最终返回建议记录
     */
    async *suggestStream(
        precedingText: string,
        cursorHint: string,
        mode: string,
        directionIndex: number,
        signal?: AbortSignal
    ): AsyncGenerator<string, SuggestionRecord | null, unknown> {
        return yield* this.engine.suggestStream(precedingText, cursorHint, mode as any, directionIndex, signal);
    }

    /**
     * 对建议做迭代精修。
     *
     * @param suggestion - 建议
     * @param instruction - 指令
     * @param precedingText - 前文
     * @param cursorHint - 光标提示
     * @param signal - 参数
     * @returns 迭代结果
     */
    async iterateSuggestion(
        suggestion: SuggestionRecord,
        instruction: string,
        precedingText: string,
        cursorHint: string,
        signal?: AbortSignal
    ): Promise<SuggestionRecord | null> {
        return this.engine.iterateSuggestion(suggestion, instruction, precedingText, cursorHint, signal);
    }

    /**
     * 对选中文本做定向改写。
     *
     * @param selectedText - 选中文本
     * @param beforeContext - 前文上下文
     * @param afterContext - 后文上下文
     * @param cursorHint - 光标提示
     * @param count - 数量
     * @param onChunk - 参数
     * @param signal - 取消信号
     * @returns 改写结果
     */
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

    /**
     * 生成联想建议。
     *
     * @param cursor - 光标位置
     * @param text - 文本内容
     * @param trigger - 触发器
     * @param signal - 参数
     * @returns 联想结果
     */
    async suggestAssociation(
        cursor: number,
        text: string,
        trigger: string,
        signal?: AbortSignal
    ): Promise<AssociationSuggestion[]> {
        return this.engine.suggestAssociation(cursor, text, trigger as any, signal);
    }

    /**
     * 校验编辑是否可采纳。
     *
     * @param modifiedText - 修改后文本
     * @param suggestion - 建议
     * @param context - 上下文
     * @param signal - 参数
     * @returns 校验结果
     */
    async validateEdit(
        modifiedText: string,
        suggestion: SuggestionRecord,
        context: string,
        signal?: AbortSignal,
    ): Promise<EditValidation> {
        return this.engine.validateEdit(modifiedText, suggestion, context, signal);
    }

    /**
     * 评估情节完成度。
     *
     * @param currentBody - 当前正文
     * @param signal - 参数
     * @returns 指标
     */
    async evaluatePlotComplete(
        currentBody: string,
        signal?: AbortSignal
    ): Promise<PlotCompletionMetrics> {
        return this.engine.evaluatePlotComplete(currentBody, signal);
    }

    /**
     * 根据情节完成度调整建议方向。
     *
     * @param metrics - 指标
     * @returns 方向数组
     */
    adjustDirection(metrics: PlotCompletionMetrics): SuggestionDirection[] {
        return this.engine.adjustDirection(metrics);
    }

    /**
     * 记录一次句子编辑交互。
     *
     * @param record - 记录
     */
    recordInteraction(record: SentenceEditRecord): void {
        this.engine.recordInteraction(record);
    }

    /**
     * 取记忆快照。
     * @returns 快照
     */
    getMemorySnapshot() {
        return this.engine.getMemorySnapshot();
    }

    /**
     * 记录显式偏好。
     *
     * @param category - 分类
     * @param key - 键
     * @param value - 值
     */
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

    /**
     * 取参考书 id 列表。
     * @returns id 数组
     */
    getReferenceBooks(): string[] {
        return this.engine.getReferenceBooks();
    }

    /**
     * 设置参考书（默认权重）。
     *
     * @param bookIds - 书籍 ID 列表
     */
    setReferenceBooks(bookIds: string[]): void {
        this.engine.setReferenceBooks(bookIds);
    }

    /**
     * 设置参考书及权重。
     *
     * @param books - 书籍列表
     */
    async setReferenceBooksWithWeight(books: Array<{ bookId: string; weight: number; isPrimary: boolean }>): Promise<void> {
        await this.engine.setReferenceBooksWithWeight(books);
    }

    /**
     * 计算文本与知识库匹配分。
     *
     * @param text - 文本内容
     * @returns 匹配结果
     */
    getKnowledgeMatchScore(text: string): Array<{ bookName: string; score: number; dimensions: string[] }> {
        return this.engine.getKnowledgeMatchScore(text);
    }

    /**
     * 取指纹库。
     * @returns 指纹库
     */
    getFingerprintLibrary() {
        return this.engine.getFingerprintLibrary();
    }

    /**
     * 取情节完成度。
     *
     * @param body - 正文
     * @returns 指标
     */
    getPlotProgress(body: string) {
        return (this.engine as any).getPlotProgress?.(body) || { totalNodes: 0, completedNodes: 0, completionPercent: 0 };
    }

    /**
     * 取仓储性能统计。
     * @returns 统计
     */
    getRepositoryPerfStats() {
        return (this.engine as any).getRepositoryPerfStats?.() || {};
    }

    /**
     * 重置 Repository 性能统计。
     */
    resetRepositoryPerfStats(): void {
        (this.engine as any).resetRepositoryPerfStats?.();
    }

    /**
     * 刷新静态上下文（项目设定/角色等）。
     */
    async refreshStaticContext(): Promise<void> {
        await this.engine.refreshStaticContext();
    }

    // ============================================================
    // Repository 访问封装
    // ============================================================

    /**
     * 取角色 Repository。
     *
     * @param project - 项目（路径或对象）
     * @returns Repository 或 null
     */
    getCharacterRepository(project: string): CharacterRepository | null {
        if (this.registry) {
            return this.registry.getCharacterRepository(project);
        }
        return null;
    }

    /**
     * 取章节 Repository。
     *
     * @param project - 项目（路径或对象）
     * @returns Repository 或 null
     */
    getChapterRepository(project: string): ChapterRepository | null {
        if (this.registry) {
            return this.registry.getChapterRepository(project);
        }
        return null;
    }

    /**
     * 取项目 Repository。
     * @returns Repository 或 null
     */
    getProjectRepository(): ProjectRepository | null {
        if (this.registry) {
            return this.registry.getOrNull(ENGINE_NAMES.PROJECT_REPOSITORY);
        }
        return null;
    }

    /**
     * 取势力 Repository。
     *
     * @param project - 项目（路径或对象）
     * @returns Repository 或 null
     */
    getFactionRepository(project: string): FactionRepository | null {
        if (this.registry) {
            return this.registry.getFactionRepository(project);
        }
        return null;
    }

    /**
     * 取地点 Repository。
     *
     * @param project - 项目（路径或对象）
     * @returns Repository 或 null
     */
    getLocationRepository(project: string): LocationRepository | null {
        if (this.registry) {
            return this.registry.getLocationRepository(project);
        }
        return null;
    }

    /**
     * 取物品 Repository。
     *
     * @param project - 项目（路径或对象）
     * @returns Repository 或 null
     */
    getItemRepository(project: string): ItemRepository | null {
        if (this.registry) {
            return this.registry.getItemRepository(project);
        }
        return null;
    }

    // ============================================================
    // 分析引擎访问封装
    // ============================================================

    /**
     * 创建情绪曲线分析器。
     * @returns 分析器
     */
    createEmotionCurveAnalyzer(): EmotionCurveAnalyzer {
        return new EmotionCurveAnalyzer();
    }

    /**
     * 创建节奏分析器。
     * @returns 分析器
     */
    createRhythmAnalyzer(): RhythmAnalyzer {
        return new RhythmAnalyzer();
    }

    /**
     * 创建结尾牵引力引擎。
     *
     * @param project - 项目（路径或对象）
     * @returns 引擎实例
     */
    async createEndingTractionEngine(project: string): Promise<EndingTractionEngine> {
        const engine = new EndingTractionEngine({
            app: this.plugin.app,
            aiEngine: this.plugin.aiEngine,
            plugin: this.plugin,
        });
        await engine.initialize(project);
        return engine;
    }

    /**
     * 取项目文风学习器。
     *
     * @param project - 项目（路径或对象）
     * @returns 学习器或 null
     */
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

    /**
     * 取知识库全部书籍。
     * @returns 书籍数组
     */
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

    /**
     * 同步章节加载状态。
     *
     * @param project - 项目（路径或对象）
     * @param volume - 卷
     * @param chapter - 章节
     * @param title - 标题
     * @param content - 内容
     * @param wordCount - 字数
     */
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

    /**
     * 同步正文内容与字数。
     *
     * @param content - 内容
     * @param wordCount - 字数
     */
    syncChapterContent(content: string, wordCount: number): void {
        this._syncChapterState({
            chapterContent: content,
            wordCount: wordCount,
        });
    }

    /**
     * 同步建议生成中状态。
     *
     * @param isGenerating - 是否生成中
     */
    syncSuggestionsGenerating(isGenerating: boolean): void {
        this._syncSuggestionState({ isGenerating });
    }

    /**
     * 同步建议生成完成。
     *
     * @param suggestions - 建议列表
     * @param direction - 参数
     */
    syncSuggestionsReady(suggestions: SuggestionRecord[], direction?: SuggestionDirection): void {
        this._syncSuggestionState({
            isGenerating: false,
            generationError: null,
            ...(direction ? { currentDirection: direction } : {}),
        });
    }

    /**
     * 同步建议生成失败。
     *
     * @param error - 错误
     */
    syncSuggestionsError(error: string): void {
        this._syncSuggestionState({
            isGenerating: false,
            generationError: error,
        });
    }

    /**
     * 同步编辑器光标位置。
     *
     * @param position - 位置
     */
    syncEditorCursor(position: number): void {
        this._syncEditorState({ cursorPosition: position });
    }

    /**
     * 同步编辑中状态与缓冲。
     *
     * @param isEditing - 是否编辑中
     * @param editBuffer - 参数
     */
    syncEditorEditing(isEditing: boolean, editBuffer?: string): void {
        this._syncEditorState({
            isEditing,
            ...(editBuffer !== undefined ? { editBuffer } : {}),
        });
    }

    /**
     * 同步情节完成度指标。
     *
     * @param metrics - 指标
     */
    syncPlotCompletion(metrics: PlotCompletionMetrics | null): void {
        this._syncMetricsState({ plotCompletion: metrics });
    }

    /**
     * 同步一条编辑记录。
     *
     * @param record - 记录
     */
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

    /**
     * 同步右栏页签。
     *
     * @param tab - 页签
     */
    syncRightPanelTab(tab: string): void {
        this._syncUiState({ rightPanelTab: tab });
    }

    /**
     * 同步面板展开状态。
     *
     * @param expanded - 是否展开
     */
    syncPanelExpanded(expanded: boolean): void {
        this._syncUiState({ isPanelExpanded: expanded });
    }

    // ============================================================
    // 项目信息封装
    // ============================================================

    /**
     * 取当前活动项目。
     * @returns 项目路径
     */
    getActiveProject(): string {
        return (this.plugin as any).getActiveProject?.() || '';
    }
}

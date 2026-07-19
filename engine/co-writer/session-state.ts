/**
 * engine/co-writer/session-state.ts — 协同写作会话状态模型
 *
 * 基于轻量级 Store，定义协同写作会话的完整状态模型，包括：
 * - 状态接口定义（5 个切片：chapter / suggestion / editor / metrics / ui）
 * - 各切片 action creators
 * - 异步 thunk actions
 * - 持久化策略配置
 * - Store 工厂函数
 *
 * 设计原则：
 * - 零外部依赖
 * - 按切片组织，职责清晰
 * - 持久化/内存态分离
 * - 类型安全
 */

import type {
    SuggestionDirection,
    PlotCompletionMetrics,
    SentenceEditRecord,
} from '../../shared/types';
import type { Suggestion } from './co-writer-types';

// ============================================================
// 一、状态接口定义
// ============================================================

/** Chapter 切片（持久化） */
export interface ChapterState {
    currentProject: string;
    currentVolume: number;
    currentChapter: number;
    chapterTitle: string;
    chapterContent: string;
    wordCount: number;
    chapterStatus: string;
}

/** Suggestion 切片（内存态） */
export interface SuggestionState {
    suggestions: Suggestion[];
    selectedSuggestionIndex: number;
    isGenerating: boolean;
    generationError: string | null;
    currentDirection: SuggestionDirection;
}

/** Editor 切片（内存态） */
export interface EditorState {
    cursorPosition: number;
    selectedText: string;
    isEditing: boolean;
    editBuffer: string;
}

/** Metrics 切片（持久化） */
export interface MetricsState {
    plotCompletion: PlotCompletionMetrics | null;
    qualityScore: number;
    editHistory: SentenceEditRecord[];
    sessionWordCount: number;
}

/** UI 切片（持久化：用户偏好） */
export interface UiState {
    rightPanelTab: string;
    isPanelExpanded: boolean;
    fontSize: number;
}

/** 协同写作会话完整状态 */
export interface CoWritingSessionState
    extends ChapterState,
        SuggestionState,
        EditorState,
        MetricsState,
        UiState {}

// ============================================================
// 二、初始状态
// ============================================================

export const initialChapterState: ChapterState = {
    currentProject: '',
    currentVolume: 1,
    currentChapter: 1,
    chapterTitle: '',
    chapterContent: '',
    wordCount: 0,
    chapterStatus: 'draft',
};

export const initialSuggestionState: SuggestionState = {
    suggestions: [],
    selectedSuggestionIndex: -1,
    isGenerating: false,
    generationError: null,
    currentDirection: 'action',
};

export const initialEditorState: EditorState = {
    cursorPosition: 0,
    selectedText: '',
    isEditing: false,
    editBuffer: '',
};

export const initialMetricsState: MetricsState = {
    plotCompletion: null,
    qualityScore: 0,
    editHistory: [],
    sessionWordCount: 0,
};

export const initialUiState: UiState = {
    rightPanelTab: 'suggestions',
    isPanelExpanded: true,
    fontSize: 16,
};

export const initialCoWritingSessionState: CoWritingSessionState = {
    ...initialChapterState,
    ...initialSuggestionState,
    ...initialEditorState,
    ...initialMetricsState,
    ...initialUiState,
};

// ============================================================
// 三、Action Types
// ============================================================

export type CoWritingActionType =
    | 'chapter/loadChapter'
    | 'chapter/updateChapterContent'
    | 'chapter/updateWordCount'
    | 'chapter/setChapterStatus'
    | 'suggestion/setSuggestions'
    | 'suggestion/selectSuggestion'
    | 'suggestion/setGenerating'
    | 'suggestion/setGenerationError'
    | 'suggestion/clearSuggestions'
    | 'editor/setCursorPosition'
    | 'editor/setSelectedText'
    | 'editor/setEditing'
    | 'editor/setEditBuffer'
    | 'metrics/setPlotCompletion'
    | 'metrics/setQualityScore'
    | 'metrics/addEditRecord'
    | 'metrics/incrementSessionWordCount'
    | 'ui/setRightPanelTab'
    | 'ui/setPanelExpanded'
    | 'ui/setFontSize';

// ============================================================
// 四、Chapter Slice Action Creators
// ============================================================

export interface ChapterActionCreators {
    loadChapter: (project: string, volume: number, chapter: number) => Partial<CoWritingSessionState>;
    updateChapterContent: (content: string) => Partial<CoWritingSessionState>;
    updateWordCount: (count: number) => Partial<CoWritingSessionState>;
    setChapterStatus: (status: string) => Partial<CoWritingSessionState>;
}

export const chapterActions: ChapterActionCreators = {
    loadChapter: (project, volume, chapter) => ({
        currentProject: project,
        currentVolume: volume,
        currentChapter: chapter,
    }),

    updateChapterContent: (content) => ({
        chapterContent: content,
    }),

    updateWordCount: (count) => ({
        wordCount: count,
    }),

    setChapterStatus: (status) => ({
        chapterStatus: status,
    }),
};

// ============================================================
// 五、Suggestion Slice Action Creators
// ============================================================

export interface SuggestionActionCreators {
    setSuggestions: (suggestions: Suggestion[]) => Partial<CoWritingSessionState>;
    selectSuggestion: (index: number) => Partial<CoWritingSessionState>;
    setGenerating: (isGenerating: boolean) => Partial<CoWritingSessionState>;
    setGenerationError: (error: string | null) => Partial<CoWritingSessionState>;
    clearSuggestions: () => Partial<CoWritingSessionState>;
}

export const suggestionActions: SuggestionActionCreators = {
    setSuggestions: (suggestions) => ({
        suggestions,
        selectedSuggestionIndex: suggestions.length > 0 ? 0 : -1,
    }),

    selectSuggestion: (index) => ({
        selectedSuggestionIndex: index,
    }),

    setGenerating: (isGenerating) => ({
        isGenerating,
    }),

    setGenerationError: (error) => ({
        generationError: error,
    }),

    clearSuggestions: () => ({
        suggestions: [],
        selectedSuggestionIndex: -1,
        generationError: null,
    }),
};

// ============================================================
// 六、Editor Slice Action Creators
// ============================================================

export interface EditorActionCreators {
    setCursorPosition: (pos: number) => Partial<CoWritingSessionState>;
    setSelectedText: (text: string) => Partial<CoWritingSessionState>;
    setEditing: (isEditing: boolean) => Partial<CoWritingSessionState>;
    setEditBuffer: (text: string) => Partial<CoWritingSessionState>;
}

export const editorActions: EditorActionCreators = {
    setCursorPosition: (pos) => ({
        cursorPosition: pos,
    }),

    setSelectedText: (text) => ({
        selectedText: text,
    }),

    setEditing: (isEditing) => ({
        isEditing,
    }),

    setEditBuffer: (text) => ({
        editBuffer: text,
    }),
};

// ============================================================
// 七、Metrics Slice Action Creators
// ============================================================

const MAX_EDIT_HISTORY = 100;

export interface MetricsActionCreators {
    setPlotCompletion: (metrics: PlotCompletionMetrics | null) => Partial<CoWritingSessionState>;
    setQualityScore: (score: number) => Partial<CoWritingSessionState>;
    addEditRecord: (record: SentenceEditRecord) => (state: CoWritingSessionState) => Partial<CoWritingSessionState>;
    incrementSessionWordCount: (delta: number) => (state: CoWritingSessionState) => Partial<CoWritingSessionState>;
}

export const metricsActions: MetricsActionCreators = {
    setPlotCompletion: (metrics) => ({
        plotCompletion: metrics,
    }),

    setQualityScore: (score) => ({
        qualityScore: score,
    }),

    addEditRecord: (record) => (state) => {
        const newHistory = [record, ...state.editHistory].slice(0, MAX_EDIT_HISTORY);
        return { editHistory: newHistory };
    },

    incrementSessionWordCount: (delta) => (state) => ({
        sessionWordCount: state.sessionWordCount + delta,
    }),
};

// ============================================================
// 八、UI Slice Action Creators
// ============================================================

export interface UiActionCreators {
    setRightPanelTab: (tab: string) => Partial<CoWritingSessionState>;
    setPanelExpanded: (expanded: boolean) => Partial<CoWritingSessionState>;
    setFontSize: (size: number) => Partial<CoWritingSessionState>;
}

export const uiActions: UiActionCreators = {
    setRightPanelTab: (tab) => ({
        rightPanelTab: tab,
    }),

    setPanelExpanded: (expanded) => ({
        isPanelExpanded: expanded,
    }),

    setFontSize: (size) => ({
        fontSize: size,
    }),
};

// ============================================================
// 九、所有 Action Creators 汇总
// ============================================================

export interface AllActionCreators
    extends ChapterActionCreators,
        SuggestionActionCreators,
        EditorActionCreators,
        MetricsActionCreators,
        UiActionCreators {}

export const allActions: AllActionCreators = {
    ...chapterActions,
    ...suggestionActions,
    ...editorActions,
    ...metricsActions,
    ...uiActions,
};

// ============================================================
// 十、持久化策略配置
// ============================================================

/** 持久化状态类型（chapter + metrics + ui） */
export type PersistedCoWritingState = ChapterState & MetricsState & UiState;

/**
 * 从完整状态中提取需要持久化的部分
 * - 持久化：chapter / metrics / ui
 * - 内存态：suggestion / editor
 */
export function partializeCoWritingState(
    state: CoWritingSessionState,
): PersistedCoWritingState {
    const {
        // 持久化字段
        currentProject,
        currentVolume,
        currentChapter,
        chapterTitle,
        chapterContent,
        wordCount,
        chapterStatus,
        plotCompletion,
        qualityScore,
        editHistory,
        sessionWordCount,
        rightPanelTab,
        isPanelExpanded,
        fontSize,
    } = state;

    return {
        currentProject,
        currentVolume,
        currentChapter,
        chapterTitle,
        chapterContent,
        wordCount,
        chapterStatus,
        plotCompletion,
        qualityScore,
        editHistory: editHistory.slice(0, MAX_EDIT_HISTORY),
        sessionWordCount,
        rightPanelTab,
        isPanelExpanded,
        fontSize,
    };
}

/** 判断一个字段是否属于持久化切片 */
export function isPersistedField(key: string): boolean {
    const persistedKeys = [
        'currentProject',
        'currentVolume',
        'currentChapter',
        'chapterTitle',
        'chapterContent',
        'wordCount',
        'chapterStatus',
        'plotCompletion',
        'qualityScore',
        'editHistory',
        'sessionWordCount',
        'rightPanelTab',
        'isPanelExpanded',
        'fontSize',
    ];
    return persistedKeys.includes(key);
}

/** 判断一个字段是否属于内存态切片 */
export function isMemoryOnlyField(key: string): boolean {
    const memoryKeys = [
        'suggestions',
        'selectedSuggestionIndex',
        'isGenerating',
        'generationError',
        'currentDirection',
        'cursorPosition',
        'selectedText',
        'isEditing',
        'editBuffer',
    ];
    return memoryKeys.includes(key);
}

// ============================================================
// 十一、Thunk Action Types
// ============================================================

export interface ThunkDependencies {
    chapterRepository?: {
        loadChapter: (project: string, volume: number, chapter: number) => Promise<{
            title: string;
            content: string;
            wordCount: number;
            status: string;
        }>;
        saveChapter: (project: string, volume: number, chapter: number, content: string) => Promise<void>;
    };
    coWriterEngine?: {
        generateSuggestions: (context: unknown, direction: SuggestionDirection) => Promise<Suggestion[]>;
    };
}

// ============================================================
// 十二、异步 Thunk Action Creators
// ============================================================

import type { StoreApi, PartialState } from '../../shared/store/types';
import { createLogger } from '../../shared/logger';


const log = createLogger('SessionState');
/**
 * 异步加载章节
 * 调用 Repository 加载章节内容并更新状态
 */
export function fetchChapterThunk(
    project: string,
    volume: number,
    chapter: number,
    deps: ThunkDependencies,
) {
    return async (
        set: StoreApi<CoWritingSessionState>['setState'],
        get: StoreApi<CoWritingSessionState>['getState'],
    ): Promise<void> => {
        if (!deps.chapterRepository) {
            throw new Error('chapterRepository is required for fetchChapter');
        }

        set({ currentProject: project, currentVolume: volume, currentChapter: chapter });

        try {
            const result = await deps.chapterRepository.loadChapter(project, volume, chapter);
            set({
                chapterTitle: result.title,
                chapterContent: result.content,
                wordCount: result.wordCount,
                chapterStatus: result.status,
            });
        } catch (error) {
            log.error('[CoWritingSession] 加载章节失败:', error);
            throw error;
        }
    };
}

/**
 * 异步生成建议
 * 调用 CoWriterEngine 生成建议并更新状态
 */
export function generateSuggestionsThunk(
    context: unknown,
    direction: SuggestionDirection,
    deps: ThunkDependencies,
) {
    return async (
        set: StoreApi<CoWritingSessionState>['setState'],
        get: StoreApi<CoWritingSessionState>['getState'],
    ): Promise<Suggestion[]> => {
        if (!deps.coWriterEngine) {
            throw new Error('coWriterEngine is required for generateSuggestions');
        }

        set({
            isGenerating: true,
            generationError: null,
            currentDirection: direction,
        });

        try {
            const suggestions = await deps.coWriterEngine.generateSuggestions(context, direction);
            set({
                suggestions,
                selectedSuggestionIndex: suggestions.length > 0 ? 0 : -1,
                isGenerating: false,
                generationError: null,
            });
            return suggestions;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            set({
                isGenerating: false,
                generationError: errorMessage,
                suggestions: [],
                selectedSuggestionIndex: -1,
            });
            throw error;
        }
    };
}

/**
 * 异步应用建议
 * 写回文件 + 更新状态
 */
export function applySuggestionThunk(
    suggestionId: string,
    deps: ThunkDependencies,
) {
    return async (
        set: StoreApi<CoWritingSessionState>['setState'],
        get: StoreApi<CoWritingSessionState>['getState'],
    ): Promise<void> => {
        const state = get();
        const suggestion = state.suggestions.find((s) => s.id === suggestionId);

        if (!suggestion) {
            throw new Error(`Suggestion not found: ${suggestionId}`);
        }

        if (!deps.chapterRepository) {
            throw new Error('chapterRepository is required for applySuggestion');
        }

        const newContent = state.chapterContent + suggestion.text;

        try {
            await deps.chapterRepository.saveChapter(
                state.currentProject,
                state.currentVolume,
                state.currentChapter,
                newContent,
            );

            const delta = suggestion.text.length;

            set((prev) => ({
                chapterContent: newContent,
                wordCount: prev.wordCount + delta,
                sessionWordCount: prev.sessionWordCount + delta,
                cursorPosition: newContent.length,
            }));
        } catch (error) {
            log.error('[CoWritingSession] 应用建议失败:', error);
            throw error;
        }
    };
}

// ============================================================
// 十三、Thunk Action Creators 工厂
// ============================================================

/**
 * 创建绑定了依赖的 thunk action creators
 */
export function createThunkActions(deps: ThunkDependencies) {
    return {
        fetchChapter: (project: string, volume: number, chapter: number) =>
            fetchChapterThunk(project, volume, chapter, deps),

        generateSuggestions: (context: unknown, direction: SuggestionDirection) =>
            generateSuggestionsThunk(context, direction, deps),

        applySuggestion: (suggestionId: string) =>
            applySuggestionThunk(suggestionId, deps),
    };
}

// ============================================================
// 十四、常量导出
// ============================================================

export { MAX_EDIT_HISTORY };

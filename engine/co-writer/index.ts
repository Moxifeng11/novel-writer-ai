/**
 * engine/co-writer/index.ts — 协同写作模块入口
 *
 * 统一导出协同写作相关的所有类型、状态模型和工具函数。
 */

export type {
    WritingMode,
    PlotNode,
    PlotProgress,
    Suggestion,
    ContextSnapshot,
    SettingGuardReport,
} from './co-writer-types';

export type {
    ChapterState,
    SuggestionState,
    EditorState,
    MetricsState,
    UiState,
    CoWritingSessionState,
    CoWritingActionType,
    ChapterActionCreators,
    SuggestionActionCreators,
    EditorActionCreators,
    MetricsActionCreators,
    UiActionCreators,
    AllActionCreators,
    PersistedCoWritingState,
    ThunkDependencies,
} from './session-state';

export {
    initialChapterState,
    initialSuggestionState,
    initialEditorState,
    initialMetricsState,
    initialUiState,
    initialCoWritingSessionState,
    chapterActions,
    suggestionActions,
    editorActions,
    metricsActions,
    uiActions,
    allActions,
    partializeCoWritingState,
    isPersistedField,
    isMemoryOnlyField,
    fetchChapterThunk,
    generateSuggestionsThunk,
    applySuggestionThunk,
    createThunkActions,
    MAX_EDIT_HISTORY,
} from './session-state';

export {
    createCoWritingSessionStore,
    createUseCoWritingStore,
    shallow,
} from './create-session-store';

export type {
    CoWritingSessionStore,
    CreateCoWritingSessionStoreOptions,
} from './create-session-store';

export type {
    ParallelSuggestionOptions,
    SuggestionStreamHandle,
    ParallelSuggestionResult,
    QualityScoreResult,
    StreamGeneratorFactory,
} from './parallel-suggestions';

export {
    scoreSuggestionQuality,
    sortSuggestionsByQuality,
    ParallelSuggestionGenerator,
} from './parallel-suggestions';

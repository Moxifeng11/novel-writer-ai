import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    initialCoWritingSessionState,
    initialChapterState,
    initialSuggestionState,
    initialEditorState,
    initialMetricsState,
    initialUiState,
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
} from '../../../../engine/co-writer/session-state';
import type {
    CoWritingSessionState,
    ChapterState,
    SuggestionState,
    EditorState,
    MetricsState,
    UiState,
    ThunkDependencies,
} from '../../../../engine/co-writer/session-state';
import type { Suggestion } from '../../../../engine/co-writer/co-writer-types';
import type { SentenceEditRecord, PlotCompletionMetrics } from '../../../../shared/types';

describe('协同写作会话状态模型', () => {
    // ============================================================
    // 一、状态接口与初始状态测试
    // ============================================================
    describe('状态接口与初始状态', () => {
        it('初始状态包含所有切片字段', () => {
            const state = initialCoWritingSessionState;

            expect(state).toHaveProperty('currentProject');
            expect(state).toHaveProperty('currentVolume');
            expect(state).toHaveProperty('currentChapter');
            expect(state).toHaveProperty('chapterTitle');
            expect(state).toHaveProperty('chapterContent');
            expect(state).toHaveProperty('wordCount');
            expect(state).toHaveProperty('chapterStatus');

            expect(state).toHaveProperty('suggestions');
            expect(state).toHaveProperty('selectedSuggestionIndex');
            expect(state).toHaveProperty('isGenerating');
            expect(state).toHaveProperty('generationError');
            expect(state).toHaveProperty('currentDirection');

            expect(state).toHaveProperty('cursorPosition');
            expect(state).toHaveProperty('selectedText');
            expect(state).toHaveProperty('isEditing');
            expect(state).toHaveProperty('editBuffer');

            expect(state).toHaveProperty('plotCompletion');
            expect(state).toHaveProperty('qualityScore');
            expect(state).toHaveProperty('editHistory');
            expect(state).toHaveProperty('sessionWordCount');

            expect(state).toHaveProperty('rightPanelTab');
            expect(state).toHaveProperty('isPanelExpanded');
            expect(state).toHaveProperty('fontSize');
        });

        it('初始状态各切片默认值正确', () => {
            expect(initialChapterState.currentProject).toBe('');
            expect(initialChapterState.currentVolume).toBe(1);
            expect(initialChapterState.currentChapter).toBe(1);
            expect(initialChapterState.chapterTitle).toBe('');
            expect(initialChapterState.chapterContent).toBe('');
            expect(initialChapterState.wordCount).toBe(0);
            expect(initialChapterState.chapterStatus).toBe('draft');

            expect(initialSuggestionState.suggestions).toEqual([]);
            expect(initialSuggestionState.selectedSuggestionIndex).toBe(-1);
            expect(initialSuggestionState.isGenerating).toBe(false);
            expect(initialSuggestionState.generationError).toBeNull();
            expect(initialSuggestionState.currentDirection).toBe('action');

            expect(initialEditorState.cursorPosition).toBe(0);
            expect(initialEditorState.selectedText).toBe('');
            expect(initialEditorState.isEditing).toBe(false);
            expect(initialEditorState.editBuffer).toBe('');

            expect(initialMetricsState.plotCompletion).toBeNull();
            expect(initialMetricsState.qualityScore).toBe(0);
            expect(initialMetricsState.editHistory).toEqual([]);
            expect(initialMetricsState.sessionWordCount).toBe(0);

            expect(initialUiState.rightPanelTab).toBe('suggestions');
            expect(initialUiState.isPanelExpanded).toBe(true);
            expect(initialUiState.fontSize).toBe(16);
        });

        it('完整初始状态由各切片组合而成', () => {
            const state = initialCoWritingSessionState;
            expect(state.currentProject).toBe(initialChapterState.currentProject);
            expect(state.suggestions).toEqual(initialSuggestionState.suggestions);
            expect(state.cursorPosition).toBe(initialEditorState.cursorPosition);
            expect(state.plotCompletion).toBe(initialMetricsState.plotCompletion);
            expect(state.rightPanelTab).toBe(initialUiState.rightPanelTab);
        });
    });

    // ============================================================
    // 二、Chapter Slice Action Creators 测试
    // ============================================================
    describe('Chapter Slice Action Creators', () => {
        it('loadChapter 更新项目、卷、章节', () => {
            const result = chapterActions.loadChapter('测试项目', 2, 5);
            expect(result.currentProject).toBe('测试项目');
            expect(result.currentVolume).toBe(2);
            expect(result.currentChapter).toBe(5);
        });

        it('updateChapterContent 更新章节内容', () => {
            const result = chapterActions.updateChapterContent('新内容');
            expect(result.chapterContent).toBe('新内容');
        });

        it('updateWordCount 更新字数', () => {
            const result = chapterActions.updateWordCount(1000);
            expect(result.wordCount).toBe(1000);
        });

        it('setChapterStatus 设置章节状态', () => {
            const result = chapterActions.setChapterStatus('reviewing');
            expect(result.chapterStatus).toBe('reviewing');
        });
    });

    // ============================================================
    // 三、Suggestion Slice Action Creators 测试
    // ============================================================
    describe('Suggestion Slice Action Creators', () => {
        const mockSuggestions: Suggestion[] = [
            { id: '1', text: '建议1', temperature: 0.7, style: 'default' },
            { id: '2', text: '建议2', temperature: 0.8, style: 'creative' },
        ];

        it('setSuggestions 设置建议列表并默认选中第一条', () => {
            const result = suggestionActions.setSuggestions(mockSuggestions);
            expect(result.suggestions).toEqual(mockSuggestions);
            expect(result.selectedSuggestionIndex).toBe(0);
        });

        it('setSuggestions 空列表时选中索引为 -1', () => {
            const result = suggestionActions.setSuggestions([]);
            expect(result.suggestions).toEqual([]);
            expect(result.selectedSuggestionIndex).toBe(-1);
        });

        it('selectSuggestion 选中指定索引', () => {
            const result = suggestionActions.selectSuggestion(1);
            expect(result.selectedSuggestionIndex).toBe(1);
        });

        it('setGenerating 设置生成状态', () => {
            const result = suggestionActions.setGenerating(true);
            expect(result.isGenerating).toBe(true);
        });

        it('setGenerationError 设置生成错误', () => {
            const result = suggestionActions.setGenerationError('出错了');
            expect(result.generationError).toBe('出错了');
        });

        it('setGenerationError 可以设置为 null', () => {
            const result = suggestionActions.setGenerationError(null);
            expect(result.generationError).toBeNull();
        });

        it('clearSuggestions 清空所有建议相关状态', () => {
            const result = suggestionActions.clearSuggestions();
            expect(result.suggestions).toEqual([]);
            expect(result.selectedSuggestionIndex).toBe(-1);
            expect(result.generationError).toBeNull();
        });
    });

    // ============================================================
    // 四、Editor Slice Action Creators 测试
    // ============================================================
    describe('Editor Slice Action Creators', () => {
        it('setCursorPosition 设置光标位置', () => {
            const result = editorActions.setCursorPosition(500);
            expect(result.cursorPosition).toBe(500);
        });

        it('setSelectedText 设置选中文本', () => {
            const result = editorActions.setSelectedText('选中的文本');
            expect(result.selectedText).toBe('选中的文本');
        });

        it('setEditing 设置编辑状态', () => {
            const result = editorActions.setEditing(true);
            expect(result.isEditing).toBe(true);
        });

        it('setEditBuffer 设置编辑缓存', () => {
            const result = editorActions.setEditBuffer('缓存内容');
            expect(result.editBuffer).toBe('缓存内容');
        });
    });

    // ============================================================
    // 五、Metrics Slice Action Creators 测试
    // ============================================================
    describe('Metrics Slice Action Creators', () => {
        const mockMetrics: PlotCompletionMetrics = {
            sceneObjectivesMet: 80,
            characterArcsAdvanced: 70,
            foreshadowingSeeded: 60,
            emotionalArcProgress: 75,
            overallCompletion: 72,
            suggestionAdvice: '继续推进剧情',
            nextDirectionHints: ['action', 'dialogue'],
            evaluatedAt: Date.now(),
        };

        it('setPlotCompletion 设置剧情完成度', () => {
            const result = metricsActions.setPlotCompletion(mockMetrics);
            expect(result.plotCompletion).toEqual(mockMetrics);
        });

        it('setPlotCompletion 可以设置为 null', () => {
            const result = metricsActions.setPlotCompletion(null);
            expect(result.plotCompletion).toBeNull();
        });

        it('setQualityScore 设置质量分', () => {
            const result = metricsActions.setQualityScore(85);
            expect(result.qualityScore).toBe(85);
        });

        it('addEditRecord 添加编辑记录到开头', () => {
            const mockRecord: SentenceEditRecord = {
                id: 'rec-1',
                triggerText: '前文',
                cursorPosition: 100,
                suggestions: [],
                humanModifiedText: '修改后',
                editDurationMs: 5000,
                createdAt: Date.now(),
            };

            const state: CoWritingSessionState = {
                ...initialCoWritingSessionState,
                editHistory: [],
            };

            const updater = metricsActions.addEditRecord(mockRecord);
            const result = updater(state);
            expect(result.editHistory).toHaveLength(1);
            expect(result.editHistory![0]).toEqual(mockRecord);
        });

        it('addEditRecord 限制最多 100 条记录', () => {
            const records: SentenceEditRecord[] = [];
            for (let i = 0; i < 150; i++) {
                records.push({
                    id: `rec-${i}`,
                    triggerText: `前文${i}`,
                    cursorPosition: i * 10,
                    suggestions: [],
                    humanModifiedText: `修改${i}`,
                    editDurationMs: 1000,
                    createdAt: Date.now(),
                });
            }

            let state: CoWritingSessionState = {
                ...initialCoWritingSessionState,
                editHistory: records.slice(0, 99),
            };

            const updater = metricsActions.addEditRecord(records[99]);
            let result = updater(state);
            expect(result.editHistory).toHaveLength(100);

            state = { ...state, editHistory: result.editHistory! };
            const updater2 = metricsActions.addEditRecord(records[100]);
            result = updater2(state);
            expect(result.editHistory).toHaveLength(MAX_EDIT_HISTORY);
            expect(result.editHistory![0].id).toBe('rec-100');
            expect(result.editHistory![1].id).toBe('rec-99');
            expect(result.editHistory![99].id).toBe('rec-97');
        });

        it('incrementSessionWordCount 增加会话字数', () => {
            const state: CoWritingSessionState = {
                ...initialCoWritingSessionState,
                sessionWordCount: 100,
            };

            const updater = metricsActions.incrementSessionWordCount(50);
            const result = updater(state);
            expect(result.sessionWordCount).toBe(150);
        });
    });

    // ============================================================
    // 六、UI Slice Action Creators 测试
    // ============================================================
    describe('UI Slice Action Creators', () => {
        it('setRightPanelTab 设置右侧面板 Tab', () => {
            const result = uiActions.setRightPanelTab('metrics');
            expect(result.rightPanelTab).toBe('metrics');
        });

        it('setPanelExpanded 设置面板展开状态', () => {
            const result = uiActions.setPanelExpanded(false);
            expect(result.isPanelExpanded).toBe(false);
        });

        it('setFontSize 设置字号', () => {
            const result = uiActions.setFontSize(18);
            expect(result.fontSize).toBe(18);
        });
    });

    // ============================================================
    // 七、所有 Action Creators 汇总测试
    // ============================================================
    describe('所有 Action Creators 汇总', () => {
        it('allActions 包含所有切片的 actions', () => {
            expect(allActions.loadChapter).toBeDefined();
            expect(allActions.updateChapterContent).toBeDefined();
            expect(allActions.setSuggestions).toBeDefined();
            expect(allActions.setCursorPosition).toBeDefined();
            expect(allActions.setPlotCompletion).toBeDefined();
            expect(allActions.setRightPanelTab).toBeDefined();
        });
    });

    // ============================================================
    // 八、持久化策略测试
    // ============================================================
    describe('持久化策略', () => {
        const fullState: CoWritingSessionState = {
            ...initialCoWritingSessionState,
            currentProject: '测试项目',
            currentVolume: 1,
            currentChapter: 1,
            chapterTitle: '测试章节',
            chapterContent: '章节内容',
            wordCount: 100,
            chapterStatus: 'draft',
            suggestions: [{ id: '1', text: '建议', temperature: 0.7, style: 'default' }],
            selectedSuggestionIndex: 0,
            isGenerating: true,
            generationError: null,
            currentDirection: 'action',
            cursorPosition: 50,
            selectedText: '选中',
            isEditing: true,
            editBuffer: '缓存',
            plotCompletion: null,
            qualityScore: 80,
            editHistory: [],
            sessionWordCount: 50,
            rightPanelTab: 'suggestions',
            isPanelExpanded: true,
            fontSize: 16,
        };

        it('partializeCoWritingState 只包含持久化字段', () => {
            const persisted = partializeCoWritingState(fullState);

            expect(persisted).toHaveProperty('currentProject');
            expect(persisted).toHaveProperty('currentVolume');
            expect(persisted).toHaveProperty('currentChapter');
            expect(persisted).toHaveProperty('chapterTitle');
            expect(persisted).not.toHaveProperty('chapterContent');
            expect(persisted).toHaveProperty('wordCount');
            expect(persisted).toHaveProperty('chapterStatus');
            expect(persisted).toHaveProperty('plotCompletion');
            expect(persisted).toHaveProperty('qualityScore');
            expect(persisted).toHaveProperty('editHistory');
            expect(persisted).toHaveProperty('sessionWordCount');
            expect(persisted).toHaveProperty('rightPanelTab');
            expect(persisted).toHaveProperty('isPanelExpanded');
            expect(persisted).toHaveProperty('fontSize');

            expect(persisted).not.toHaveProperty('suggestions');
            expect(persisted).not.toHaveProperty('selectedSuggestionIndex');
            expect(persisted).not.toHaveProperty('isGenerating');
            expect(persisted).not.toHaveProperty('generationError');
            expect(persisted).not.toHaveProperty('currentDirection');
            expect(persisted).not.toHaveProperty('cursorPosition');
            expect(persisted).not.toHaveProperty('selectedText');
            expect(persisted).not.toHaveProperty('isEditing');
            expect(persisted).not.toHaveProperty('editBuffer');
        });

        it('持久化字段值正确', () => {
            const persisted = partializeCoWritingState(fullState);
            expect(persisted.currentProject).toBe('测试项目');
            expect(persisted).not.toHaveProperty('chapterContent');
            expect(persisted.qualityScore).toBe(80);
            expect(persisted.fontSize).toBe(16);
        });

        it('isPersistedField 判断持久化字段正确', () => {
            expect(isPersistedField('currentProject')).toBe(true);
            expect(isPersistedField('wordCount')).toBe(true);
            expect(isPersistedField('chapterContent')).toBe(false);
            expect(isPersistedField('plotCompletion')).toBe(true);
            expect(isPersistedField('rightPanelTab')).toBe(true);
            expect(isPersistedField('suggestions')).toBe(false);
            expect(isPersistedField('isGenerating')).toBe(false);
            expect(isPersistedField('cursorPosition')).toBe(false);
        });

        it('isMemoryOnlyField 判断内存态字段正确', () => {
            expect(isMemoryOnlyField('suggestions')).toBe(true);
            expect(isMemoryOnlyField('isGenerating')).toBe(true);
            expect(isMemoryOnlyField('cursorPosition')).toBe(true);
            expect(isMemoryOnlyField('editBuffer')).toBe(true);
            expect(isMemoryOnlyField('currentProject')).toBe(false);
            expect(isMemoryOnlyField('wordCount')).toBe(false);
            expect(isMemoryOnlyField('fontSize')).toBe(false);
        });
    });

    // ============================================================
    // 九、Thunk Action 测试
    // ============================================================
    describe('Thunk Actions', () => {
        let mockSet: any;
        let mockGet: any;
        let mockChapterRepo: any;
        let mockCoWriterEngine: any;
        let deps: ThunkDependencies;

        beforeEach(() => {
            mockSet = vi.fn();
            mockGet = vi.fn();
            mockChapterRepo = {
                loadChapter: vi.fn(),
                saveChapter: vi.fn(),
            };
            mockCoWriterEngine = {
                generateSuggestions: vi.fn(),
            };
            deps = {
                chapterRepository: mockChapterRepo,
                coWriterEngine: mockCoWriterEngine,
            };
        });

        describe('fetchChapterThunk', () => {
            it('成功加载章节', async () => {
                mockChapterRepo.loadChapter.mockResolvedValue({
                    title: '测试章节',
                    content: '章节内容测试',
                    wordCount: 500,
                    status: 'draft',
                });

                const thunk = fetchChapterThunk('项目1', 1, 3, deps);
                await thunk(mockSet, mockGet);

                expect(mockSet).toHaveBeenCalledTimes(2);
                expect(mockSet).toHaveBeenNthCalledWith(1, {
                    currentProject: '项目1',
                    currentVolume: 1,
                    currentChapter: 3,
                });
                expect(mockSet).toHaveBeenNthCalledWith(2, {
                    chapterTitle: '测试章节',
                    chapterContent: '章节内容测试',
                    wordCount: 500,
                    chapterStatus: 'draft',
                });
            });

            it('加载失败时抛出错误', async () => {
                mockChapterRepo.loadChapter.mockRejectedValue(new Error('加载失败'));

                const thunk = fetchChapterThunk('项目1', 1, 3, deps);
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('加载失败');
            });

            it('缺少 chapterRepository 时抛出错误', async () => {
                const thunk = fetchChapterThunk('项目1', 1, 3, {});
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('chapterRepository is required');
            });
        });

        describe('generateSuggestionsThunk', () => {
            const mockSuggestions: Suggestion[] = [
                { id: 's1', text: '建议1', temperature: 0.7, style: 'default' },
                { id: 's2', text: '建议2', temperature: 0.8, style: 'creative' },
            ];

            it('成功生成建议', async () => {
                mockCoWriterEngine.generateSuggestions.mockResolvedValue(mockSuggestions);

                const thunk = generateSuggestionsThunk({}, 'action', deps);
                const result = await thunk(mockSet, mockGet);

                expect(result).toEqual(mockSuggestions);
                expect(mockSet).toHaveBeenCalledTimes(2);
                expect(mockSet).toHaveBeenNthCalledWith(1, {
                    isGenerating: true,
                    generationError: null,
                    currentDirection: 'action',
                });
                expect(mockSet).toHaveBeenNthCalledWith(2, {
                    suggestions: mockSuggestions,
                    selectedSuggestionIndex: 0,
                    isGenerating: false,
                    generationError: null,
                });
            });

            it('生成失败时设置错误状态', async () => {
                mockCoWriterEngine.generateSuggestions.mockRejectedValue(new Error('生成失败'));

                const thunk = generateSuggestionsThunk({}, 'action', deps);
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('生成失败');

                expect(mockSet).toHaveBeenCalledTimes(2);
                expect(mockSet).toHaveBeenLastCalledWith({
                    isGenerating: false,
                    generationError: '生成失败',
                    suggestions: [],
                    selectedSuggestionIndex: -1,
                });
            });

            it('缺少 coWriterEngine 时抛出错误', async () => {
                const thunk = generateSuggestionsThunk({}, 'action', {});
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('coWriterEngine is required');
            });
        });

        describe('applySuggestionThunk', () => {
            const mockSuggestion: Suggestion = {
                id: 's1',
                text: '追加的建议文本',
                temperature: 0.7,
                style: 'default',
            };

            beforeEach(() => {
                mockGet.mockReturnValue({
                    ...initialCoWritingSessionState,
                    currentProject: '项目1',
                    currentVolume: 1,
                    currentChapter: 1,
                    chapterContent: '原有内容',
                    wordCount: 100,
                    suggestions: [mockSuggestion],
                });
                mockChapterRepo.saveChapter.mockResolvedValue(undefined);
            });

            it('成功应用建议', async () => {
                const thunk = applySuggestionThunk('s1', deps);
                await thunk(mockSet, mockGet);

                expect(mockChapterRepo.saveChapter).toHaveBeenCalledWith(
                    '项目1',
                    1,
                    1,
                    '原有内容追加的建议文本',
                );
                expect(mockSet).toHaveBeenCalled();
            });

            it('建议不存在时抛出错误', async () => {
                const thunk = applySuggestionThunk('nonexistent', deps);
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('Suggestion not found');
            });

            it('缺少 chapterRepository 时抛出错误', async () => {
                const thunk = applySuggestionThunk('s1', {});
                await expect(thunk(mockSet, mockGet)).rejects.toThrow('chapterRepository is required');
            });
        });

        describe('createThunkActions', () => {
            it('创建绑定依赖的 thunk actions', () => {
                const thunkActions = createThunkActions(deps);
                expect(thunkActions.fetchChapter).toBeDefined();
                expect(thunkActions.generateSuggestions).toBeDefined();
                expect(thunkActions.applySuggestion).toBeDefined();
            });
        });
    });
});

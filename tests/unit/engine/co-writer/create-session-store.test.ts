import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createCoWritingSessionStore,
    createUseCoWritingStore,
} from '../../../../engine/co-writer/create-session-store';
import type { CoWritingSessionStore } from '../../../../engine/co-writer/create-session-store';
import {
    initialCoWritingSessionState,
    partializeCoWritingState,
} from '../../../../engine/co-writer/session-state';
import type { PersistStorage } from '../../../../shared/store/types';

describe('createCoWritingSessionStore 工厂函数', () => {
    let memoryStorage: PersistStorage<ReturnType<typeof partializeCoWritingState>>;
    let storedData: Map<string, any>;

    beforeEach(() => {
        storedData = new Map();
        memoryStorage = {
            getItem: (name: string) => {
                return storedData.get(name) ?? null;
            },
            setItem: (name: string, value: any) => {
                storedData.set(name, value);
            },
            removeItem: (name: string) => {
                storedData.delete(name);
            },
        };
    });

    describe('基本功能', () => {
        it('创建的 Store 具有正确的初始状态', () => {
            const store = createCoWritingSessionStore();
            expect(store.getState()).toEqual(initialCoWritingSessionState);
        });

        it('可以自定义初始状态', () => {
            const store = createCoWritingSessionStore({
                initialState: {
                    currentProject: '自定义项目',
                    fontSize: 18,
                },
            });
            expect(store.getState().currentProject).toBe('自定义项目');
            expect(store.getState().fontSize).toBe(18);
            expect(store.getState().currentVolume).toBe(1);
        });

        it('Store 具有 actions 属性', () => {
            const store = createCoWritingSessionStore();
            expect(store.actions).toBeDefined();
            expect(store.actions.updateChapterContent).toBeDefined();
            expect(store.actions.setSuggestions).toBeDefined();
        });

        it('Store 具有 thunks 属性', () => {
            const store = createCoWritingSessionStore();
            expect(store.thunks).toBeDefined();
            expect(store.thunks.fetchChapter).toBeDefined();
            expect(store.thunks.generateSuggestions).toBeDefined();
            expect(store.thunks.applySuggestion).toBeDefined();
        });
    });

    describe('setState 功能', () => {
        it('setState 可以更新状态', () => {
            const store = createCoWritingSessionStore();
            store.setState({ chapterContent: '新内容' });
            expect(store.getState().chapterContent).toBe('新内容');
        });

        it('setState 传入函数时基于前一个状态计算', () => {
            const store = createCoWritingSessionStore();
            store.setState({ wordCount: 100 });
            store.setState((state) => ({ wordCount: state.wordCount + 50 }));
            expect(store.getState().wordCount).toBe(150);
        });
    });

    describe('dispatch / thunk 功能', () => {
        it('dispatch 可以执行同步 thunk', () => {
            const store = createCoWritingSessionStore();
            const result = store.dispatch((set, get) => {
                set({ chapterContent: 'thunk 内容' });
                return 'done';
            });
            expect(result).toBe('done');
            expect(store.getState().chapterContent).toBe('thunk 内容');
        });
    });

    describe('subscribe 功能', () => {
        it('状态变化时通知订阅者', () => {
            const store = createCoWritingSessionStore();
            const listener = vi.fn();
            store.subscribe(listener);
            store.setState({ chapterContent: '新内容' });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('取消订阅后不再接收通知', () => {
            const store = createCoWritingSessionStore();
            const listener = vi.fn();
            const unsubscribe = store.subscribe(listener);

            store.setState({ chapterContent: '第一次' });
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            store.setState({ chapterContent: '第二次' });
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('persist 中间件', () => {
        it('使用自定义 storage 时状态持久化', async () => {
            const store = createCoWritingSessionStore({
                storage: memoryStorage,
                persistName: 'test-store',
            });

            store.setState({
                currentProject: '持久化项目',
                chapterContent: '持久化内容',
                wordCount: 100,
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            const saved = storedData.get('test-store');
            expect(saved).toBeDefined();
            expect(saved.state.currentProject).toBe('持久化项目');
            expect(saved.state.chapterContent).toBe('持久化内容');
            expect(saved.state.wordCount).toBe(100);
        });

        it('内存态字段不被持久化', async () => {
            const store = createCoWritingSessionStore({
                storage: memoryStorage,
                persistName: 'test-store-memory',
            });

            store.setState({
                currentProject: '测试',
                suggestions: [{ id: '1', text: 'test', temperature: 0.7, style: 'default' }],
                isGenerating: true,
                cursorPosition: 100,
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            const saved = storedData.get('test-store-memory');
            expect(saved).toBeDefined();
            expect(saved.state.currentProject).toBe('测试');
            expect(saved.state.suggestions).toBeUndefined();
            expect(saved.state.isGenerating).toBeUndefined();
            expect(saved.state.cursorPosition).toBeUndefined();
        });

        it('persist.hasHydrated 返回正确状态', async () => {
            const store = createCoWritingSessionStore({
                storage: memoryStorage,
                persistName: 'test-hydrate',
            });

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(store.persist.hasHydrated()).toBe(true);
        });

        it('persist.rehydrate 可以手动恢复状态', async () => {
            storedData.set('test-rehydrate', {
                state: {
                    currentProject: '恢复的项目',
                    currentVolume: 2,
                    currentChapter: 3,
                    chapterTitle: '恢复的标题',
                    chapterContent: '恢复的内容',
                    wordCount: 200,
                    chapterStatus: 'reviewing',
                    qualityScore: 90,
                    editHistory: [],
                    sessionWordCount: 150,
                    rightPanelTab: 'metrics',
                    isPanelExpanded: false,
                    fontSize: 18,
                },
                version: 1,
            });

            const store = createCoWritingSessionStore({
                storage: memoryStorage,
                persistName: 'test-rehydrate',
            });

            await store.persist.rehydrate();

            expect(store.getState().currentProject).toBe('恢复的项目');
            expect(store.getState().currentVolume).toBe(2);
            expect(store.getState().currentChapter).toBe(3);
            expect(store.getState().chapterTitle).toBe('恢复的标题');
            expect(store.getState().chapterContent).toBe('恢复的内容');
            expect(store.getState().wordCount).toBe(200);
            expect(store.getState().chapterStatus).toBe('reviewing');
            expect(store.getState().qualityScore).toBe(90);
            expect(store.getState().sessionWordCount).toBe(150);
            expect(store.getState().rightPanelTab).toBe('metrics');
            expect(store.getState().isPanelExpanded).toBe(false);
            expect(store.getState().fontSize).toBe(18);

            expect(store.getState().suggestions).toEqual([]);
            expect(store.getState().isGenerating).toBe(false);
            expect(store.getState().cursorPosition).toBe(0);
        });
    });

    describe('选择器订阅', () => {
        it('支持选择器订阅', () => {
            const store = createCoWritingSessionStore();
            const listener = vi.fn();

            store.subscribe(
                (state) => state.chapterContent,
                listener,
            );

            store.setState({ chapterContent: '新内容' });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('选择器未变化时不触发', () => {
            const store = createCoWritingSessionStore();
            const listener = vi.fn();

            store.subscribe(
                (state) => state.chapterContent,
                listener,
            );

            store.setState({ fontSize: 18 });
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('createUseCoWritingStore', () => {
        it('创建的 hook 返回选择器的值', () => {
            const store = createCoWritingSessionStore();
            const useStore = createUseCoWritingStore(store);

            const project = useStore((state) => state.currentProject);
            expect(project).toBe('');
        });

        it('hook 值随状态变化更新', () => {
            const store = createCoWritingSessionStore();
            const useStore = createUseCoWritingStore(store);

            let value = useStore((state) => state.chapterContent);
            expect(value).toBe('');

            store.setState({ chapterContent: '更新后' });
            value = useStore((state) => state.chapterContent);
            expect(value).toBe('更新后');
        });
    });

    describe('logger 中间件', () => {
        it('启用 logger 时不报错', () => {
            expect(() => {
                createCoWritingSessionStore({
                    enableLogger: true,
                });
            }).not.toThrow();
        });
    });

    describe('devtools 中间件', () => {
        it('启用 devtools 时不报错', () => {
            expect(() => {
                createCoWritingSessionStore({
                    enableDevtools: true,
                });
            }).not.toThrow();
        });

        it('可以自定义 devtools 名称', () => {
            expect(() => {
                createCoWritingSessionStore({
                    enableDevtools: true,
                    devtoolsName: 'CustomDevtoolsName',
                });
            }).not.toThrow();
        });

        it('禁用 devtools 时不报错', () => {
            expect(() => {
                createCoWritingSessionStore({
                    enableDevtools: false,
                });
            }).not.toThrow();
        });
    });

    describe('状态同步（渐进式迁移验证）', () => {
        it('chapter slice 可以正确更新', () => {
            const store = createCoWritingSessionStore();

            store.setState(store.actions.loadChapter('测试项目', 2, 5));
            expect(store.getState().currentProject).toBe('测试项目');
            expect(store.getState().currentVolume).toBe(2);
            expect(store.getState().currentChapter).toBe(5);

            store.setState(store.actions.updateChapterContent('新内容'));
            expect(store.getState().chapterContent).toBe('新内容');

            store.setState(store.actions.updateWordCount(500));
            expect(store.getState().wordCount).toBe(500);

            store.setState(store.actions.setChapterStatus('reviewing'));
            expect(store.getState().chapterStatus).toBe('reviewing');
        });

        it('suggestion slice 可以正确更新', () => {
            const store = createCoWritingSessionStore();

            store.setState(store.actions.setGenerating(true));
            expect(store.getState().isGenerating).toBe(true);

            store.setState(store.actions.setGenerationError('测试错误'));
            expect(store.getState().generationError).toBe('测试错误');

            const suggestions: any[] = [
                { id: 's1', text: '建议1' },
                { id: 's2', text: '建议2' },
            ];
            store.setState(store.actions.setSuggestions(suggestions));
            expect(store.getState().suggestions.length).toBe(2);
            expect(store.getState().selectedSuggestionIndex).toBe(0);

            store.setState(store.actions.setGenerating(false));
            store.setState(store.actions.setGenerationError(null));
            expect(store.getState().isGenerating).toBe(false);
            expect(store.getState().generationError).toBeNull();

            store.setState(store.actions.selectSuggestion(1));
            expect(store.getState().selectedSuggestionIndex).toBe(1);

            store.setState(store.actions.clearSuggestions());
            expect(store.getState().suggestions.length).toBe(0);
            expect(store.getState().selectedSuggestionIndex).toBe(-1);
        });

        it('editor slice 可以正确更新', () => {
            const store = createCoWritingSessionStore();

            store.setState(store.actions.setCursorPosition(100));
            expect(store.getState().cursorPosition).toBe(100);

            store.setState(store.actions.setSelectedText('选中的文本'));
            expect(store.getState().selectedText).toBe('选中的文本');

            store.setState(store.actions.setEditing(true));
            expect(store.getState().isEditing).toBe(true);

            store.setState(store.actions.setEditBuffer('编辑缓冲区'));
            expect(store.getState().editBuffer).toBe('编辑缓冲区');
        });

        it('metrics slice 可以正确更新', () => {
            const store = createCoWritingSessionStore();

            const metrics = {
                overallCompletion: 75,
                sceneObjectivesMet: 80,
            } as any;
            store.setState(store.actions.setPlotCompletion(metrics));
            expect(store.getState().plotCompletion).toEqual(metrics);

            store.setState(store.actions.setQualityScore(95));
            expect(store.getState().qualityScore).toBe(95);

            const record1: any = { id: 'r1', createdAt: 1000 };
            const record2: any = { id: 'r2', createdAt: 2000 };
            store.setState(store.actions.addEditRecord(record1));
            store.setState(store.actions.addEditRecord(record2));
            expect(store.getState().editHistory.length).toBe(2);
            expect(store.getState().editHistory[0].id).toBe('r2');

            store.setState(store.actions.incrementSessionWordCount(100));
            store.setState(store.actions.incrementSessionWordCount(50));
            expect(store.getState().sessionWordCount).toBe(150);
        });

        it('ui slice 可以正确更新', () => {
            const store = createCoWritingSessionStore();

            store.setState(store.actions.setRightPanelTab('metrics'));
            expect(store.getState().rightPanelTab).toBe('metrics');

            store.setState(store.actions.setPanelExpanded(false));
            expect(store.getState().isPanelExpanded).toBe(false);

            store.setState(store.actions.setFontSize(18));
            expect(store.getState().fontSize).toBe(18);
        });

        it('多个切片状态互不干扰', () => {
            const store = createCoWritingSessionStore();

            store.setState(store.actions.loadChapter('项目A', 1, 1));
            store.setState(store.actions.setRightPanelTab('knowledge'));
            store.setState(store.actions.setQualityScore(80));

            const state = store.getState();
            expect(state.currentProject).toBe('项目A');
            expect(state.rightPanelTab).toBe('knowledge');
            expect(state.qualityScore).toBe(80);
            expect(state.isGenerating).toBe(false);
            expect(state.suggestions).toEqual([]);
        });
    });
});

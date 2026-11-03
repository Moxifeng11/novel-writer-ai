import { createLogger } from '@/shared/logger';

const log = createLogger('CreateSessionStore');
/**
 * engine/co-writer/create-session-store.ts — 协同写作会话 Store 工厂
 *
 * 基于轻量级 Store 中间件系统，创建配置好的协同写作会话 Store：
 * - 应用 persist 中间件（Obsidian 插件设置存储）
 * - 应用 logger 中间件（开发调试）
 * - 应用 thunk 中间件（异步 action）
 *
 * 导出：
 * - createCoWritingSessionStore() - 工厂函数
 * - CoWritingSessionStore - Store 实例类型
 * - useCoWritingStore - Hook 生成器（供 UI 组件使用）
 */

import {
    createStore,
    compose,
    logger,
    devtools,
    persist,
    thunk,
    createObsidianSettingStorage,
    subscribeWithSelector,
    shallow,
} from '@/shared/store';
import type {
    StoreApi,
    PersistApi,
    ThunkApi,
    DevtoolsApi,
    PersistStorage,
    SubscribeWithSelector,
} from '@/shared/store/types';
import {
    initialCoWritingSessionState,
    partializeCoWritingState,
    createThunkActions,
    allActions,
} from './session-state';
import type {
    CoWritingSessionState,
    ThunkDependencies,
    AllActionCreators,
} from './session-state';

// ============================================================
// 一、Store 实例类型
// ============================================================

/**
 * CoWritingSessionStore 类型定义。
 */
export type CoWritingSessionStore =
    & StoreApi<CoWritingSessionState>
    & PersistApi<CoWritingSessionState>
    & ThunkApi<CoWritingSessionState>
    & DevtoolsApi<CoWritingSessionState>
    & SubscribeWithSelector<CoWritingSessionState>
    & {
        actions: AllActionCreators;
        thunks: ReturnType<typeof createThunkActions>;
    };

// ============================================================
// 二、Store 工厂配置
// ============================================================

/**
 * CreateCoWritingSessionStoreOptions 类型定义。
 */
export interface CreateCoWritingSessionStoreOptions {
    plugin?: {
        settings: Record<string, unknown>;
        saveSettings: () => Promise<void> | void;
        loadSettings: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    };
    storage?: PersistStorage<ReturnType<typeof partializeCoWritingState>>;
    persistName?: string;
    persistVersion?: number;
    enableLogger?: boolean;
    enableDevtools?: boolean;
    devtoolsName?: string;
    deps?: ThunkDependencies;
    initialState?: Partial<CoWritingSessionState>;
}

// ============================================================
// 三、Store 工厂函数
// ============================================================

/**
 * 创建协同写作会话 Store
 *
 * @param options 配置选项
 * @returns 配置好的 Store 实例
 *
 * @example
 * ```ts
 * // 基本用法（带 Obsidian 持久化）
 * const store = createCoWritingSessionStore({
 *     plugin: pluginInstance,
 *     deps: { chapterRepository, coWriterEngine },
 * });
 *
 * // 使用 actions
 * store.setState(store.actions.setRightPanelTab('metrics'));
 *
 * // 使用 thunks
 * await store.dispatch(store.thunks.fetchChapter('project1', 1, 1));
 *
 * // 订阅选择器
 * store.subscribe(
 *     (state) => state.suggestions,
 *     (suggestions) => log.info('suggestions changed'),
 *     { equalityFn: shallow }
 * );
 * ```
 */
export function createCoWritingSessionStore(
    options: CreateCoWritingSessionStoreOptions = {},
): CoWritingSessionStore {
    const {
        plugin,
        storage,
        persistName = 'co-writing-session',
        persistVersion = 1,
        enableLogger = false,
        enableDevtools = false,
        devtoolsName = 'CoWritingSession',
        deps = {},
        initialState: customInitialState = {},
    } = options;

    const mergedInitialState: CoWritingSessionState = {
        ...initialCoWritingSessionState,
        ...customInitialState,
    };

    const baseStore = createStore(mergedInitialState);
    const storeWithSelector = subscribeWithSelector(baseStore);

    const middlewares: Array<
        (store: StoreApi<CoWritingSessionState>) => StoreApi<CoWritingSessionState>
    > = [];

    if (enableLogger) {
        middlewares.push(logger({ name: 'CoWritingSession' }));
    }

    if (enableDevtools) {
        middlewares.push(devtools({ name: devtoolsName, enabled: true }));
    }

    if (plugin || storage) {
        let persistStorage: any;

        if (storage) {
            persistStorage = storage;
        } else if (plugin) {
            persistStorage = createObsidianSettingStorage({ plugin, key: 'coWritingStore' });
        }

        if (persistStorage) {
            middlewares.push(
                persist({
                    name: persistName,
                    storage: persistStorage,
                    version: persistVersion,
                    partialize: partializeCoWritingState,
                }) as unknown as (
                    store: StoreApi<CoWritingSessionState>
                ) => StoreApi<CoWritingSessionState>,
            );
        }
    }

    middlewares.push(thunk() as unknown as (
        store: StoreApi<CoWritingSessionState>
    ) => StoreApi<CoWritingSessionState>);

    const enhancedStore = compose<CoWritingSessionState>(
        ...middlewares,
    )(storeWithSelector as StoreApi<CoWritingSessionState>);

    const thunkActions = createThunkActions(deps);

    const finalStore = enhancedStore as CoWritingSessionStore;
    finalStore.actions = allActions;
    finalStore.thunks = thunkActions;

    return finalStore;
}

// ============================================================
// 四、Hook 生成器（供 UI 组件使用）
// ============================================================

/**
 * 创建一个 useStore hook 生成器
 * 类似 Zustand 的使用方式，但基于 subscribeWithSelector
 *
 * @param store Store 实例
 * @returns useStore hook 函数
 *
 * @example
 * ```ts
 * const useStore = createUseCoWritingStore(store);
 *
 * // 在组件中
 * const suggestions = useStore((state) => state.suggestions);
 * const { isGenerating, currentDirection } = useStore(
 *     (state) => ({ isGenerating: state.isGenerating, currentDirection: state.currentDirection }),
 *     shallow
 * );
 * ```
 */
export function createUseCoWritingStore(store: CoWritingSessionStore) {
    return function useStore<U>(
        selector: (state: CoWritingSessionState) => U,
        equalityFn?: (a: U, b: U) => boolean,
    ): U {
        let currentValue = selector(store.getState());

        const listener = (state: CoWritingSessionState) => {
            const nextValue = selector(state);
            const isEqual = equalityFn
                ? equalityFn(nextValue, currentValue)
                : Object.is(nextValue, currentValue);

            if (!isEqual) {
                currentValue = nextValue;
            }
        };

        store.subscribe(listener);

        return currentValue;
    };
}

// ============================================================
// 五、便捷导出
// ============================================================

export { shallow };

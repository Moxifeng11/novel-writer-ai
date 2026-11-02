/**
 * store/types.ts — 状态管理类型定义
 *
 * 零外部依赖的轻量级状态管理，灵感来自 Zustand。
 */

// ============================================================
// 一、核心 Store API 类型
// ============================================================

/**
 * 状态基类型。
 */
export type State = object;

/**
 * 状态的部分更新。
 */
export type PartialState<T extends State> =
    | Partial<T>
    | ((state: T) => Partial<T>);

/**
 * 状态订阅回调。
 */
export type StateListener<T extends State> = (state: T, prevState: T) => void;

/**
 * 状态选择器。
 */
export type StateSelector<T extends State, U> = (state: T) => U;

/**
 * 相等比较函数。
 */
export type EqualityChecker<U> = (a: U, b: U) => boolean;

/**
 * Store 公共 API。
 */
export interface StoreApi<T extends State> {
    getState: () => T;
    setState: (partial: PartialState<T>, replace?: boolean) => void;
    subscribe: (listener: StateListener<T>) => () => void;
    destroy: () => void;
}

/**
 * Store 创建器。
 */
export type StoreCreator<T extends State> = (
    set: StoreApi<T>['setState'],
    get: StoreApi<T>['getState'],
    api: StoreApi<T>,
) => T;

// ============================================================
// 二、选择器订阅类型
// ============================================================

/**
 * 带选择器订阅的 Store API。
 */
export interface SubscribeWithSelector<T extends State> extends StoreApi<T> {
    subscribe: {
        (listener: StateListener<T>): () => void;
        <U>(
            selector: StateSelector<T, U>,
            listener: (selectedState: U, prevSelectedState: U) => void,
            options?: {
                equalityFn?: EqualityChecker<U>;
                fireImmediately?: boolean;
            },
        ): () => void;
    };
}

// ============================================================
// 三、中间件类型
// ============================================================

/**
 * 可变 Store 类型。
 */
export type MutateStore<S, Ms extends [...unknown[]]> = Ms extends [
    infer M,
    ...infer Rest,
]
    ? M extends (s: unknown) => infer T
        ? MutateStore<T, Rest>
        : never
    : S;

/**
 * Store 中间件。
 */
export type Middleware<T extends State, U extends StoreApi<T> = StoreApi<T>> = (
    config: StoreApi<T>,
) => U;

// ============================================================
// 四、Persist 中间件类型
// ============================================================

/**
 * 持久化存储值。
 */
export type PersistStorageValue<S> = {
    state: S;
    version?: number;
};

/**
 * 持久化存储适配器。
 */
export interface PersistStorage<S> {
    getItem: (name: string) => PersistStorageValue<S> | null | Promise<PersistStorageValue<S> | null>;
    setItem: (name: string, value: PersistStorageValue<S>) => void | Promise<void>;
    removeItem: (name: string) => void | Promise<void>;
}

/**
 * 持久化选项。
 */
export interface PersistOptions<T extends State, PersistedState extends State = T> {
    name: string;
    storage?: PersistStorage<PersistedState>;
    partialize?: (state: T) => PersistedState;
    version?: number;
    migrate?: (persistedState: unknown, version: number) => PersistedState | Promise<PersistedState>;
    merge?: (persistedState: PersistedState, currentState: T) => T;
    onRehydrateStorage?: (state: T) => ((state: T, error?: unknown) => void) | void;
}

/**
 * 持久化 Store API。
 */
export interface PersistApi<T extends State> extends StoreApi<T> {
    persist: {
        setOptions: (options: Partial<PersistOptions<T>>) => void;
        rehydrate: () => Promise<void>;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: T) => void) => () => void;
        onFinishHydration: (fn: (state: T) => void) => () => void;
    };
}

// ============================================================
// 五、Devtools 中间件类型
// ============================================================

/**
 * Devtools 选项。
 */
export interface DevtoolsOptions {
    name?: string;
    enabled?: boolean;
}

/**
 * Devtools 状态。
 */
export interface DevtoolsState {
    type: string;
}

/**
 * Devtools Store API。
 */
export interface DevtoolsApi<T extends State> extends StoreApi<T> {
    devtools: {
        send: (action: string, state: T) => void;
    };
}

// ============================================================
// 六、Logger 中间件类型
// ============================================================

/**
 * 日志中间件选项。
 */
export interface LoggerOptions {
    name?: string;
    enabled?: boolean;
}

// ============================================================
// 七、Thunk 类型（可选）
// ============================================================

/**
 * Thunk dispatch 类型。
 */
export type ThunkDispatch<T extends State> = <R>(
    thunk: (
        set: StoreApi<T>['setState'],
        get: StoreApi<T>['getState'],
    ) => R,
) => R;

/**
 * Thunk API。
 */
export interface ThunkApi<T extends State> extends StoreApi<T> {
    dispatch: ThunkDispatch<T>;
}

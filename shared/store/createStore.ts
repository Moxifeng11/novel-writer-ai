/**
 * store/createStore.ts — 核心 Store 实现
 *
 * 零外部依赖的轻量级状态管理，灵感来自 Zustand。
 * 支持：getState / setState / subscribe / destroy / 选择器订阅
 */

import type {
    State,
    PartialState,
    StoreApi,
    StateListener,
    StateSelector,
    EqualityChecker,
    SubscribeWithSelector,
} from './types';
import { shallow } from './shallow';

/**
 * 创建基础 Store
 *
 * @param initialState 初始状态
 * @returns Store API 对象
 */
export function createStore<T extends State>(
    initialState: T | (() => T),
): StoreApi<T> {
    let state: T = typeof initialState === 'function'
        ? (initialState as () => T)()
        : initialState;

    const listeners = new Set<StateListener<T>>();

    const getState: StoreApi<T>['getState'] = () => state;

    const setState: StoreApi<T>['setState'] = (partial, replace) => {
        const nextPartial = typeof partial === 'function'
            ? (partial as (state: T) => Partial<T>)(state)
            : partial;

        const nextState: T = replace
            ? (nextPartial as T)
            : ({ ...state, ...nextPartial } as T);

        if (shallow(state, nextState)) return;

        const prevState = state;
        state = nextState;

        if (listeners.size > 0) {
            listeners.forEach(listener => listener(state, prevState));
        }
    };

    const subscribe: StoreApi<T>['subscribe'] = listener => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };

    const destroy: StoreApi<T>['destroy'] = () => {
        listeners.clear();
    };

    return {
        getState,
        setState,
        subscribe,
        destroy,
    };
}

/**
 * 为 Store 添加选择器订阅能力
 *
 * 扩展 subscribe 方法，支持：
 * - 传统订阅（传 listener）
 * - 选择器订阅（传 selector + listener + options）
 *
 * @param store 基础 Store
 * @returns 增强后的 Store
 */
export function subscribeWithSelector<T extends State>(
    store: StoreApi<T>,
): SubscribeWithSelector<T> {
    const originalSubscribe = store.subscribe;

    const subscribe = ((
        selectorOrListener: StateListener<T> | StateSelector<T, unknown>,
        listenerOrOptions?:
            | ((selectedState: unknown, prevSelectedState: unknown) => void)
            | { equalityFn?: EqualityChecker<unknown>; fireImmediately?: boolean },
        maybeOptions?: { equalityFn?: EqualityChecker<unknown>; fireImmediately?: boolean },
    ): (() => void) => {
        if (typeof selectorOrListener === 'function' && listenerOrOptions === undefined) {
            return originalSubscribe(selectorOrListener as StateListener<T>);
        }

        const selector = selectorOrListener as StateSelector<T, unknown>;
        const listener = listenerOrOptions as (
            selectedState: unknown,
            prevSelectedState: unknown,
        ) => void;
        const options = maybeOptions || {};
        const equalityFn = options.equalityFn || Object.is;
        const fireImmediately = options.fireImmediately || false;

        let currentSlice = selector(store.getState());

        if (fireImmediately) {
            listener(currentSlice, currentSlice);
        }

        const unsubscribe = originalSubscribe((state, prevState) => {
            const nextSlice = selector(state);
            const prevSlice = selector(prevState);

            if (!equalityFn(nextSlice, prevSlice)) {
                const prevSliceForListener = currentSlice;
                currentSlice = nextSlice;
                listener(nextSlice, prevSliceForListener);
            }
        });

        return unsubscribe;
    }) as SubscribeWithSelector<T>['subscribe'];

    return {
        ...store,
        subscribe,
    };
}

/**
 * store/compose.ts — 中间件组合工具
 *
 * 支持两种使用方式：
 * 1. compose(m1, m2, m3)(store) - 直接应用于 store 实例
 * 2. createStoreWithMiddleware = applyMiddleware(m1, m2)(createStore) - 包装 createStore 函数
 */

import type { State, StoreApi } from './types';
import { createStore as baseCreateStore } from './createStore';

/**
 * 组合多个中间件并应用于 store
 *
 * 从左到右依次应用中间件。
 *
 * @example
 * ```ts
 * const store = compose(
 *   logger(),
 *   persist({ name: 'my-store' }),
 * )(createStore({ count: 0 }));
 * ```
 *
 * @param middlewares 中间件数组
 * @returns 接收 store 的函数
 */
export function compose<T extends State>(
    ...middlewares: Array<(store: StoreApi<T>) => StoreApi<T>>
): (store: StoreApi<T>) => StoreApi<T> {
    return (store: StoreApi<T>): StoreApi<T> => {
        return middlewares.reduceRight(
            (acc, middleware) => middleware(acc),
            store,
        );
    };
}

/**
 * 应用中间件到 createStore 函数
 *
 * 返回一个新的 createStore 函数，该函数创建的 store 会自动应用所有中间件。
 *
 * @example
 * ```ts
 * const createStoreWithMiddleware = applyMiddleware(
 *   logger(),
 *   persist({ name: 'my-store' }),
 * );
 * const store = createStoreWithMiddleware({ count: 0 });
 * ```
 *
 * @param middlewares 中间件数组
 * @returns 增强后的 createStore 函数
 */
export function applyMiddleware<T extends State>(
    ...middlewares: Array<(store: StoreApi<T>) => StoreApi<T>>
): (initialState: T | (() => T)) => StoreApi<T> {
    return (initialState: T | (() => T)): StoreApi<T> => {
        const store = baseCreateStore<T>(initialState);
        return compose<T>(...middlewares)(store);
    };
}

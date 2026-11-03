/**
 * store/middleware/thunk.ts — 异步 Thunk 中间件
 *
 * 支持异步 action，类似 Redux Thunk。
 * 提供 dispatch 方法来执行 thunk 函数。
 */

import type { State, StoreApi, ThunkApi, ThunkDispatch } from '@/shared/store/types';

/**
 * Thunk 中间件
 *
 * 为 Store 添加 dispatch 方法，支持异步 action。
 * thunk 函数接收 set 和 get 作为参数，可以是同步或异步的。
 *
 * @returns 中间件函数
 */
export function thunk<T extends State>() {
    return (store: StoreApi<T>): ThunkApi<T> => {
        const dispatch: ThunkDispatch<T> = (thunk) => {
            return thunk(store.setState, store.getState);
        };

        return {
            ...store,
            dispatch,
        };
    };
}

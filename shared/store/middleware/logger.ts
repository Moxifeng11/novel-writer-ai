/**
 * store/middleware/logger.ts — Logger 中间件
 *
 * 状态变更时输出日志，便于调试。
 */

import type { State, StoreApi, LoggerOptions } from '../types';
/**
 * Logger 中间件
 *
 * 在每次 setState 时输出状态变更日志。
 *
 * @param options 配置选项
 * @returns 中间件函数
 */
export function logger<T extends State>(
    options: LoggerOptions = {},
) {
    return (store: StoreApi<T>): StoreApi<T> => {
        const { name = 'Store', enabled = true } = options;

        if (!enabled) return store;

        const originalSetState = store.setState;

        const setState: StoreApi<T>['setState'] = (partial, replace) => {
            const prevState = store.getState();

            const nextState = typeof partial === 'function'
                ? (partial as (state: T) => Partial<T>)(prevState)
                : partial;

            const action = typeof partial === 'function'
                ? (partial as any).name || 'setState (function)'
                : 'setState (object)';

            console.log(
                `%c[${name}] ${action}`,
                'color: #767676; font-weight: bold;',
                '\nprev:', prevState,
                '\nnext:', replace ? nextState : { ...prevState, ...nextState },
            );

            originalSetState(partial, replace);
        };

        return {
            ...store,
            setState,
        };
    };
}

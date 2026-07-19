/**
 * store/middleware/devtools.ts — Redux DevTools 中间件
 *
 * 支持 Redux DevTools Extension，有就支持，没有就跳过。
 */

import type { State, StoreApi, DevtoolsOptions } from '../types';
import { createLogger } from '../../logger';


const log = createLogger('Devtools');
interface DevtoolsExtension {
    connect: (options?: { name?: string }) => DevtoolsConnection;
}

interface DevtoolsConnection {
    init: (state: unknown) => void;
    send: (action: string | { type: string }, state: unknown) => void;
    subscribe: (listener: (message: { type: string; state?: string }) => void) => void;
    unsubscribe: () => void;
}

declare global {
    interface Window {
        __REDUX_DEVTOOLS_EXTENSION__?: DevtoolsExtension;
    }
}

/**
 * Devtools 中间件
 *
 * 连接 Redux DevTools Extension，支持时间旅行调试。
 * 环境中没有 DevTools 时自动跳过，不影响功能。
 *
 * @param options 配置选项
 * @returns 中间件函数
 */
export function devtools<T extends State>(
    options: DevtoolsOptions = {},
) {
    return (store: StoreApi<T>): StoreApi<T> => {
        const { name = 'Store', enabled = true } = options;

        if (!enabled || typeof window === 'undefined' || !window.__REDUX_DEVTOOLS_EXTENSION__) {
            return store;
        }

        const devtoolsExtension = window.__REDUX_DEVTOOLS_EXTENSION__;
        const connection = devtoolsExtension.connect({ name });

        connection.init(store.getState());

        let isExternalUpdate = false;

        const unsubscribeFromStore = store.subscribe((state) => {
            if (!isExternalUpdate) {
                connection.send('setState', state);
            }
            isExternalUpdate = false;
        });

        connection.subscribe((message) => {
            if (message.type === 'DISPATCH' && message.state) {
                isExternalUpdate = true;
                try {
                    const newState = JSON.parse(message.state) as T;
                    store.setState(newState, true);
                } catch (e) {
                    log.warn('[Devtools] 状态解析失败:', e);
                }
            }
        });

        const originalDestroy = store.destroy;

        const destroy: StoreApi<T>['destroy'] = () => {
            unsubscribeFromStore();
            connection.unsubscribe();
            originalDestroy();
        };

        return {
            ...store,
            destroy,
        };
    };
}

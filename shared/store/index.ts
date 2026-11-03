import { createLogger } from '@/shared/logger';

const log = createLogger('Index');
/**
 * store/index.ts — 状态管理主入口
 *
 * 零外部依赖的轻量级状态管理，灵感来自 Zustand。
 *
 * 核心特性：
 * - 极简 API：getState / setState / subscribe / destroy
 * - 选择器订阅：按需订阅部分状态，支持浅比较优化
 * - 中间件机制：logger / persist / devtools / thunk
 * - 持久化：Obsidian 设置 + IndexedDB 双介质支持
 * - 类型安全：完整的 TypeScript 泛型支持
 *
 * @example
 * ```ts
 * // 基础用法
 * const store = createStore({ count: 0, name: 'test' });
 *
 * store.subscribe((state, prev) => log.info('changed'));
 * store.setState({ count: 1 });
 * log.info(store.getState().count); // 1
 *
 * // 选择器订阅
 * const storeWithSelector = subscribeWithSelector(store);
 * storeWithSelector.subscribe(
 *   (state) => state.count,
 *   (count, prevCount) => log.info('count changed:', count),
 *   { equalityFn: shallow }
 * );
 *
 * // 带中间件
 * const store = compose(
 *   logger({ name: 'CounterStore' }),
 *   persist({ name: 'counter', storage: createObsidianSettingStorage({ plugin }) }),
 * )(createStore({ count: 0 }));
 * ```
 */

export { createStore, subscribeWithSelector } from './createStore';
export { compose, applyMiddleware } from './compose';
export { shallow } from './shallow';
export { logger } from './middleware/logger';
export { devtools } from './middleware/devtools';
export {
    persist,
    createObsidianSettingStorage,
    createIndexedDbStorage,
} from './middleware/persist';
export { thunk } from './middleware/thunk';

export type {
    State,
    PartialState,
    StoreApi,
    StateListener,
    StateSelector,
    EqualityChecker,
    SubscribeWithSelector,
    Middleware,
    PersistOptions,
    PersistApi,
    PersistStorage,
    PersistStorageValue,
    DevtoolsOptions,
    DevtoolsApi,
    LoggerOptions,
    ThunkApi,
    ThunkDispatch,
} from './types';

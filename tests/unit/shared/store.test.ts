import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    createStore,
    subscribeWithSelector,
    shallow,
    compose as _compose,
    logger,
    persist,
    thunk,
    createObsidianSettingStorage,
    createIndexedDbStorage,
} from '../../../shared/store';
import type { StoreApi, PersistStorage, PersistApi, ThunkApi } from '../../../shared/store/types';

const compose = _compose as unknown as (...args: any[]) => (store: any) => any;

describe('Store', () => {
    // ============================================================
    // 一、核心 Store API 测试
    // ============================================================
    describe('核心 Store API', () => {
        interface TestState {
            count: number;
            name: string;
            nested: { value: number };
        }

        const initialState: TestState = {
            count: 0,
            name: 'test',
            nested: { value: 42 },
        };

        it('getState 返回当前状态', () => {
            const store = createStore(initialState);
            expect(store.getState()).toEqual(initialState);
        });

        it('setState 传入对象时合并状态', () => {
            const store = createStore(initialState);
            store.setState({ count: 1 });
            expect(store.getState()).toEqual({
                ...initialState,
                count: 1,
            });
        });

        it('setState 传入函数时基于前一个状态计算', () => {
            const store = createStore(initialState);
            store.setState((state) => ({ count: state.count + 1 }));
            expect(store.getState().count).toBe(1);
        });

        it('setState replace=true 时替换整个状态', () => {
            const store = createStore(initialState);
            store.setState({ count: 99 } as Partial<TestState>, true);
            expect(store.getState()).toEqual({ count: 99 } as TestState);
        });

        it('相同状态不会触发更新', () => {
            const store = createStore(initialState);
            const listener = vi.fn();
            store.subscribe(listener);
            store.setState({ count: 0 });
            expect(listener).not.toHaveBeenCalled();
        });
    });

    // ============================================================
    // 二、订阅/通知机制测试
    // ============================================================
    describe('订阅/通知机制', () => {
        interface TestState {
            count: number;
            name: string;
        }

        let store: StoreApi<TestState>;

        beforeEach(() => {
            store = createStore({ count: 0, name: 'test' });
        });

        it('状态变化时通知所有订阅者', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            store.subscribe(listener1);
            store.subscribe(listener2);

            store.setState({ count: 1 });

            expect(listener1).toHaveBeenCalledTimes(1);
            expect(listener2).toHaveBeenCalledTimes(1);
        });

        it('listener 接收新状态和旧状态', () => {
            const listener = vi.fn();
            store.subscribe(listener);

            store.setState({ count: 1 });

            expect(listener).toHaveBeenCalledWith(
                { count: 1, name: 'test' },
                { count: 0, name: 'test' },
            );
        });

        it('取消订阅后不再接收通知', () => {
            const listener = vi.fn();
            const unsubscribe = store.subscribe(listener);

            store.setState({ count: 1 });
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();

            store.setState({ count: 2 });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('多次订阅都能收到通知', () => {
            const listener = vi.fn();
            store.subscribe(listener);

            store.setState({ count: 1 });
            store.setState({ count: 2 });
            store.setState({ name: 'new' });

            expect(listener).toHaveBeenCalledTimes(3);
        });

        it('destroy 清理所有订阅', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            store.subscribe(listener1);
            store.subscribe(listener2);

            store.destroy();

            store.setState({ count: 1 });

            expect(listener1).not.toHaveBeenCalled();
            expect(listener2).not.toHaveBeenCalled();
        });

        it('支持初始状态下 setState 中再 setState，所有订阅者都能收到最新状态', () => {
            const results: number[] = [];

            store.subscribe((state) => {
                results.push(state.count);
            });

            store.subscribe((state) => {
                if (state.count === 1) {
                    store.setState({ count: 2 });
                }
            });

            store.setState({ count: 1 });

            expect(results).toContain(1);
            expect(results).toContain(2);
        });
    });

    // ============================================================
    // 三、选择器订阅测试
    // ============================================================
    describe('选择器订阅 (subscribeWithSelector)', () => {
        interface TestState {
            count: number;
            name: string;
            nested: { value: number };
        }

        let store: ReturnType<typeof subscribeWithSelector<TestState>>;

        beforeEach(() => {
            const baseStore = createStore<TestState>({
                count: 0,
                name: 'test',
                nested: { value: 42 },
            });
            store = subscribeWithSelector(baseStore);
        });

        it('传统订阅方式仍然可用', () => {
            const listener = vi.fn();
            store.subscribe(listener);

            store.setState({ count: 1 });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('选择器订阅只监听指定状态切片', () => {
            const countListener = vi.fn();
            const nameListener = vi.fn();

            store.subscribe(
                (state: TestState) => state.count,
                countListener,
            );
            store.subscribe(
                (state: TestState) => state.name,
                nameListener,
            );

            store.setState({ count: 1 });
            expect(countListener).toHaveBeenCalledTimes(1);
            expect(nameListener).not.toHaveBeenCalled();

            store.setState({ name: 'new' });
            expect(countListener).toHaveBeenCalledTimes(1);
            expect(nameListener).toHaveBeenCalledTimes(1);
        });

        it('选择器 listener 接收选择后的新值和旧值', () => {
            const listener = vi.fn();

            store.subscribe(
                (state: TestState) => state.count,
                listener,
            );

            store.setState({ count: 5 });

            expect(listener).toHaveBeenCalledWith(5, 0);
        });

        it('状态未变化时不触发 listener', () => {
            const listener = vi.fn();

            store.subscribe(
                (state: TestState) => state.count,
                listener,
            );

            store.setState({ name: 'other' });
            expect(listener).not.toHaveBeenCalled();
        });

        it('fireImmediately 立即触发一次', () => {
            const listener = vi.fn();

            store.subscribe(
                (state: TestState) => state.count,
                listener,
                { fireImmediately: true },
            );

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(0, 0);
        });

        it('自定义 equalityFn', () => {
            const listener = vi.fn();
            const customEquality = (a: number, b: number) => Math.abs(a - b) < 2;

            store.subscribe(
                (state: TestState) => state.count,
                listener,
                { equalityFn: customEquality },
            );

            store.setState({ count: 1 });
            expect(listener).not.toHaveBeenCalled();

            store.setState({ count: 3 });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('shallow 浅比较优化嵌套对象', () => {
            const listener = vi.fn();

            store.subscribe(
                (state: TestState) => state.nested,
                listener,
                { equalityFn: shallow },
            );

            store.setState({ nested: { value: 42 } });
            expect(listener).not.toHaveBeenCalled();

            store.setState({ nested: { value: 100 } });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('选择器返回新对象引用但内容相同时，shallow 不触发', () => {
            const listener = vi.fn();

            store.subscribe(
                (state: TestState) => ({ count: state.count, name: state.name }),
                listener,
                { equalityFn: shallow },
            );

            store.setState({ count: 0 });
            expect(listener).not.toHaveBeenCalled();

            store.setState({ count: 1 });
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    // ============================================================
    // 四、shallow 浅比较测试
    // ============================================================
    describe('shallow 浅比较', () => {
        it('原始类型比较', () => {
            expect(shallow(1, 1)).toBe(true);
            expect(shallow('a', 'a')).toBe(true);
            expect(shallow(1, 2)).toBe(false);
            expect(shallow('a', 'b')).toBe(false);
            expect(shallow(null, null)).toBe(true);
            expect(shallow(undefined, undefined)).toBe(true);
            expect(shallow(null, undefined)).toBe(false);
            expect(shallow(NaN, NaN)).toBe(true);
            expect(shallow(0, -0)).toBe(false);
        });

        it('对象浅比较', () => {
            expect(shallow({ a: 1 }, { a: 1 })).toBe(true);
            expect(shallow({ a: 1 }, { a: 2 })).toBe(false);
            expect(shallow({ a: 1, b: 2 }, { a: 1 })).toBe(false);
            expect(shallow({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        });

        it('数组浅比较', () => {
            expect(shallow([1, 2, 3], [1, 2, 3])).toBe(true);
            expect(shallow([1, 2, 3], [1, 2, 4])).toBe(false);
            expect(shallow([1, 2], [1, 2, 3])).toBe(false);
        });

        it('嵌套对象只比较第一层', () => {
            const obj = { nested: { value: 1 } };
            expect(shallow(obj, obj)).toBe(true);
            expect(shallow({ nested: { value: 1 } }, { nested: { value: 1 } })).toBe(false);
        });

        it('null / undefined 与对象比较', () => {
            expect(shallow(null, { a: 1 })).toBe(false);
            expect(shallow({ a: 1 }, null)).toBe(false);
            expect(shallow(undefined, { a: 1 })).toBe(false);
        });

        it('同一个对象引用相同返回 true', () => {
            const obj = { a: 1, b: 2 };
            expect(shallow(obj, obj)).toBe(true);
        });
    });

    // ============================================================
    // 五、Logger 中间件测试
    // ============================================================
    describe('Logger 中间件', () => {
        interface TestState {
            count: number;
        }

        beforeEach(() => {
            vi.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('状态变更时输出日志', () => {
            const store = compose(
                logger<TestState>({ name: 'TestStore', enabled: true }),
            )(createStore<TestState>({ count: 0 }));

            store.setState({ count: 1 });

            expect(console.log).toHaveBeenCalled();
        });

        it('enabled=false 时不输出日志', () => {
            const store = compose(
                logger<TestState>({ name: 'TestStore', enabled: false }),
            )(createStore<TestState>({ count: 0 }));

            store.setState({ count: 1 });

            expect(console.log).not.toHaveBeenCalled();
        });
    });

    // ============================================================
    // 六、Persist 中间件测试
    // ============================================================
    describe('Persist 中间件', () => {
        interface TestState {
            count: number;
            name: string;
            secret: string;
        }

        type PersistTestStore = PersistApi<TestState>;

        function createMockStorage<S>() {
            const data = new Map<string, { state: S; version?: number }>();
            return {
                data,
                getItem: (name: string) => data.get(name) ?? null,
                setItem: (name: string, value: { state: S; version?: number }) => {
                    data.set(name, value);
                },
                removeItem: (name: string) => { data.delete(name); },
            };
        }

        function createPersistStore(
            initialState: TestState,
            persistOptions: Partial<Parameters<typeof persist<TestState>>[0]> = {},
        ): PersistTestStore {
            const mockStorage = createMockStorage<TestState>();
            return compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage, ...persistOptions }),
            )(createStore<TestState>(initialState)) as unknown as PersistTestStore;
        }

        it('状态变更后持久化到 storage', async () => {
            const mockStorage = createMockStorage<TestState>();
            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            store.setState({ count: 42 });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockStorage.data.has('test-store')).toBe(true);
            const saved = mockStorage.data.get('test-store')!;
            expect(saved.state.count).toBe(42);
        });

        it('初始化时从 storage 恢复状态', async () => {
            const mockStorage = createMockStorage<TestState>();
            mockStorage.data.set('test-store', {
                state: { count: 99, name: 'restored', secret: 'restored-secret' },
                version: 0,
            });

            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage }),
            )(createStore<TestState>({ count: 0, name: 'initial', secret: 'initial-secret' }));

            await store.persist.rehydrate();

            expect(store.getState().count).toBe(99);
            expect(store.getState().name).toBe('restored');
        });

        it('partialize 只持久化指定状态切片', async () => {
            const mockStorage = createMockStorage<{ count: number }>();
            const store = compose(
                persist<TestState, { count: number }>({
                    name: 'test-store',
                    storage: mockStorage,
                    partialize: (state) => ({ count: state.count }),
                }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            store.setState({ count: 42, name: 'changed' });

            await new Promise(resolve => setTimeout(resolve, 10));

            const saved = mockStorage.data.get('test-store')!;
            expect(saved.state).toEqual({ count: 42 });
            expect((saved.state as any).name).toBeUndefined();
            expect((saved.state as any).secret).toBeUndefined();
        });

        it('版本迁移', async () => {
            type V1State = { oldCount: number };
            type V2State = { count: number; name: string };

            const mockStorage = createMockStorage<V2State>();
            mockStorage.data.set('test-store', {
                state: { oldCount: 77 } as unknown as V2State,
                version: 1,
            });

            const store = compose(
                persist<TestState, V2State>({
                    name: 'test-store',
                    storage: mockStorage,
                    version: 2,
                    migrate: (persistedState: unknown, version: number) => {
                        if (version === 1) {
                            const v1 = persistedState as V1State;
                            return { count: v1.oldCount, name: 'migrated' };
                        }
                        return persistedState as V2State;
                    },
                }),
            )(createStore<TestState>({ count: 0, name: 'initial', secret: 'secret' }));

            await store.persist.rehydrate();

            expect(store.getState().count).toBe(77);
            expect(store.getState().name).toBe('migrated');
        });

        it('hasHydrated 状态跟踪', async () => {
            const mockStorage = createMockStorage<TestState>();
            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            expect(store.persist.hasHydrated()).toBe(false);

            await store.persist.rehydrate();

            expect(store.persist.hasHydrated()).toBe(true);
        });

        it('onHydrate / onFinishHydration 回调', async () => {
            const mockStorage = createMockStorage<TestState>();
            mockStorage.data.set('test-store', {
                state: { count: 99, name: 'restored', secret: 's' },
                version: 0,
            });

            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            const onHydrateFn = vi.fn();
            const onFinishFn = vi.fn();

            store.persist.onHydrate(onHydrateFn);
            store.persist.onFinishHydration(onFinishFn);

            await store.persist.rehydrate();

            expect(onHydrateFn).toHaveBeenCalled();
            expect(onFinishFn).toHaveBeenCalled();
        });

        it('storage 出错时降级到内存态', async () => {
            const failingStorage: PersistStorage<TestState> = {
                getItem: () => { throw new Error('read error'); },
                setItem: () => { throw new Error('write error'); },
                removeItem: () => { throw new Error('remove error'); },
            };

            const store = compose(
                persist<TestState>({ name: 'test-store', storage: failingStorage }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            await store.persist.rehydrate();

            expect(store.persist.hasHydrated()).toBe(true);
            expect(store.getState().count).toBe(0);
        });

        it('手动 rehydrate 触发恢复', async () => {
            const mockStorage = createMockStorage<TestState>();
            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            mockStorage.data.set('test-store', {
                state: { count: 123, name: 'manual', secret: 's' },
                version: 0,
            });

            await store.persist.rehydrate();

            expect(store.getState().count).toBe(123);
        });

        it('setOptions 动态修改配置', async () => {
            const mockStorage1 = createMockStorage<TestState>();
            const mockStorage2 = createMockStorage<TestState>();

            const store = compose(
                persist<TestState>({ name: 'test-store', storage: mockStorage1 }),
            )(createStore<TestState>({ count: 0, name: 'test', secret: 'secret' }));

            store.setState({ count: 1 });
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockStorage1.data.has('test-store')).toBe(true);

            store.persist.setOptions({ storage: mockStorage2 });

            store.setState({ count: 2 });
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockStorage2.data.has('test-store')).toBe(true);
        });
    });

    // ============================================================
    // 七、Obsidian 设置存储适配器测试
    // ============================================================
    describe('Obsidian 设置存储适配器', () => {
        it('getItem / setItem / removeItem', () => {
            const settings: Record<string, unknown> = {};
            let saved = false;

            const plugin = {
                settings,
                saveSettings: () => { saved = true; },
                loadSettings: () => settings,
            };

            const storage = createObsidianSettingStorage<{ count: number }>({ plugin });

            expect(storage.getItem('test')).toBeNull();

            storage.setItem('test', { state: { count: 42 }, version: 0 });
            expect(saved).toBe(true);

            saved = false;

            const result = storage.getItem('test');
            expect(result).not.toBeNull();
            expect((result as { state: { count: number } }).state.count).toBe(42);

            storage.removeItem('test');
            expect(storage.getItem('test')).toBeNull();
        });

        it('自定义 key', () => {
            const settings: Record<string, unknown> = {};
            const plugin = {
                settings,
                saveSettings: () => {},
                loadSettings: () => settings,
            };

            const storage = createObsidianSettingStorage<{ count: number }>({
                plugin,
                key: 'custom-key',
            });

            storage.setItem('test', { state: { count: 1 }, version: 0 });
            expect(settings['custom-key']).toBeDefined();
            expect((settings['custom-key'] as any).test.state.count).toBe(1);
        });
    });

    // ============================================================
    // 八、Thunk 中间件测试
    // ============================================================
    describe('Thunk 中间件', () => {
        interface TestState {
            count: number;
            loading: boolean;
            error: string | null;
        }

        it('dispatch 同步 thunk', () => {
            const store = compose(
                thunk<TestState>(),
            )(createStore<TestState>({ count: 0, loading: false, error: null }));

            const result = store.dispatch((set: (partial: Partial<TestState>) => void, get: () => TestState) => {
                set({ count: get().count + 10 });
                return 'done';
            });

            expect(store.getState().count).toBe(10);
            expect(result).toBe('done');
        });

        it('dispatch 异步 thunk', async () => {
            const store = compose(
                thunk<TestState>(),
            )(createStore<TestState>({ count: 0, loading: false, error: null }));

            const asyncThunk = async (
                set: (typeof store)['setState'],
                get: (typeof store)['getState'],
            ) => {
                set({ loading: true });
                await new Promise(resolve => setTimeout(resolve, 10));
                set({ count: get().count + 5, loading: false });
                return 'async done';
            };

            const result = await store.dispatch(asyncThunk);

            expect(store.getState().count).toBe(5);
            expect(store.getState().loading).toBe(false);
            expect(result).toBe('async done');
        });
    });

    // ============================================================
    // 九、中间件组合测试
    // ============================================================
    describe('中间件组合 (compose)', () => {
        interface TestState {
            count: number;
        }

        it('组合多个中间件', () => {
            const mockStorage = new Map<string, { state: TestState; version?: number }>();
            const storage = {
                data: mockStorage,
                getItem: (name: string) => mockStorage.get(name) ?? null,
                setItem: (name: string, value: { state: TestState; version?: number }) => {
                    mockStorage.set(name, value);
                },
                removeItem: (name: string) => { mockStorage.delete(name); },
            };

            const store = compose(
                logger<TestState>({ enabled: false }),
                persist<TestState>({ name: 'composed', storage }),
                thunk<TestState>(),
            )(createStore<TestState>({ count: 0 }));

            expect(store.getState().count).toBe(0);
            expect(typeof store.dispatch).toBe('function');
            expect(typeof store.persist).toBe('object');

            store.dispatch((set: (partial: Partial<{ count: number }>) => void) => {
                set({ count: 100 });
            });

            expect(store.getState().count).toBe(100);
        });

        it('零中间件时直接返回原 store', () => {
            const store = compose()(createStore({ count: 0 }));
            expect(store.getState().count).toBe(0);
            store.setState({ count: 1 });
            expect(store.getState().count).toBe(1);
        });
    });

    // ============================================================
    // 十、初始状态函数形式测试
    // ============================================================
    describe('初始状态函数形式', () => {
        it('支持函数形式的初始状态', () => {
            const store = createStore(() => ({
                count: 42,
                name: 'from-fn',
            }));

            expect(store.getState().count).toBe(42);
            expect(store.getState().name).toBe('from-fn');
        });
    });
});

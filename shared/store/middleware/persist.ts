import { createLogger } from '../../logger';

const log = createLogger('Persist');
/**
 * store/middleware/persist.ts — 持久化中间件
 *
 * 支持多种存储介质：
 * - Obsidian 插件设置（小数据，如用户偏好）
 * - IndexedDB（大数据，如编辑历史、缓存数据）
 * - 自定义 storage 接口
 *
 * 特性：
 * - partialize: 选择需要持久化的状态切片
 * - version + migrate: 版本迁移
 * - merge: 合并持久化状态和当前状态
 * - rehydrate: 手动触发恢复
 * - 错误降级：持久化失败时回退到内存态
 */

import type {
    State,
    StoreApi,
    PersistOptions,
    PersistApi,
    PersistStorage,
    PersistStorageValue,
} from '../types';

// ============================================================
// 一、Obsidian 插件设置存储适配器
// ============================================================

export interface ObsidianPluginSettingStorageOptions {
    plugin: {
        settings: Record<string, unknown>;
        saveSettings: () => Promise<void> | void;
        loadSettings: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    };
    key?: string;
}

/**
 * 创建 Obsidian 插件设置存储适配器
 *
 * 适用于小数据量（用户偏好、当前项目等），数据保存在 data.json 中。
 *
 * @param options 配置选项
 * @returns PersistStorage 实例
 */
export function createObsidianSettingStorage<S extends State>(
    options: ObsidianPluginSettingStorageOptions,
): PersistStorage<S> {
    const { plugin, key = 'store' } = options;

    return {
        getItem: (name: string): PersistStorageValue<S> | null => {
            try {
                const data = plugin.settings[key] as Record<string, PersistStorageValue<S>> | undefined;
                return data?.[name] ?? null;
            } catch {
                return null;
            }
        },
        setItem: (name: string, value: PersistStorageValue<S>): void => {
            try {
                if (!plugin.settings[key]) {
                    plugin.settings[key] = {};
                }
                (plugin.settings[key] as Record<string, PersistStorageValue<S>>)[name] = value;
                plugin.saveSettings();
            } catch {
                // 持久化失败，静默降级
            }
        },
        removeItem: (name: string): void => {
            try {
                const data = plugin.settings[key] as Record<string, PersistStorageValue<S>> | undefined;
                if (data) {
                    delete data[name];
                    plugin.saveSettings();
                }
            } catch {
                // 忽略删除失败
            }
        },
    };
}

// ============================================================
// 二、IndexedDB 存储适配器
// ============================================================

export interface IndexedDbStorageOptions {
    dbName?: string;
    storeName?: string;
    version?: number;
}

/**
 * 创建 IndexedDB 存储适配器
 *
 * 适用于大数据量（编辑历史、缓存数据等）。
 * 环境不支持 IndexedDB 时自动降级为内存存储。
 *
 * @param options 配置选项
 * @returns PersistStorage 实例
 */
export function createIndexedDbStorage<S extends State>(
    options: IndexedDbStorageOptions = {},
): PersistStorage<S> {
    const {
        dbName = 'novel-writer-store',
        storeName = 'persist',
        version = 1,
    } = options;

    const isSupported = typeof indexedDB !== 'undefined';

    const memoryFallback = new Map<string, PersistStorageValue<S>>();

    let dbPromise: Promise<IDBDatabase> | null = null;

    const openDb = (): Promise<IDBDatabase> => {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            if (!isSupported) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(dbName, version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
        });

        dbPromise.catch(() => {
            dbPromise = null;
        });

        return dbPromise;
    };

    return {
        getItem: async (name: string): Promise<PersistStorageValue<S> | null> => {
            if (!isSupported) {
                return memoryFallback.get(name) ?? null;
            }

            try {
                const db = await openDb();
                return new Promise((resolve) => {
                    const transaction = db.transaction(storeName, 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.get(name);

                    request.onsuccess = () => {
                        resolve((request.result as PersistStorageValue<S>) ?? null);
                    };
                    request.onerror = () => {
                        resolve(null);
                    };
                });
            } catch {
                return memoryFallback.get(name) ?? null;
            }
        },
        setItem: async (name: string, value: PersistStorageValue<S>): Promise<void> => {
            if (!isSupported) {
                memoryFallback.set(name, value);
                return;
            }

            try {
                const db = await openDb();
                return new Promise((resolve) => {
                    const transaction = db.transaction(storeName, 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.put(value, name);

                    request.onsuccess = () => resolve();
                    request.onerror = () => {
                        memoryFallback.set(name, value);
                        resolve();
                    };
                });
            } catch {
                memoryFallback.set(name, value);
            }
        },
        removeItem: async (name: string): Promise<void> => {
            if (!isSupported) {
                memoryFallback.delete(name);
                return;
            }

            try {
                const db = await openDb();
                return new Promise((resolve) => {
                    const transaction = db.transaction(storeName, 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.delete(name);

                    request.onsuccess = () => resolve();
                    request.onerror = () => {
                        memoryFallback.delete(name);
                        resolve();
                    };
                });
            } catch {
                memoryFallback.delete(name);
            }
        },
    };
}

// ============================================================
// 三、Persist 中间件核心实现
// ============================================================

/**
 * Persist 中间件
 *
 * 将 Store 状态持久化到存储介质中，并在初始化时自动恢复。
 *
 * @param options 持久化配置
 * @returns 中间件函数
 */
export function persist<T extends State, PersistedState extends State = T>(
    options: PersistOptions<T, PersistedState>,
) {
    return (store: StoreApi<T>): PersistApi<T> => {
        const {
            name,
            storage,
            partialize = ((state: T) => state as unknown as PersistedState),
            version = 0,
            migrate,
            merge = (persistedState: PersistedState, currentState: T): T =>
                ({ ...currentState, ...persistedState } as T),
            onRehydrateStorage,
        } = options;

        let hydrated = false;
        let currentStorage: PersistStorage<PersistedState> | undefined = storage;

        const hydrateListeners = new Set<(state: T) => void>();
        const finishHydrateListeners = new Set<(state: T) => void>();

        const persistApi: PersistApi<T>['persist'] = {
            setOptions: (newOptions: Partial<PersistOptions<T>>) => {
                const opts = newOptions as Partial<PersistOptions<T, PersistedState>>;
                if (opts.storage !== undefined) {
                    currentStorage = opts.storage;
                }
                Object.assign(options, opts);
            },
            rehydrate: async (): Promise<void> => {
                if (!currentStorage) return;

                try {
                    const value = await currentStorage.getItem(name);

                    if (value) {
                        const onHydrate = onRehydrateStorage?.(store.getState());

                        hydrateListeners.forEach(fn => fn(store.getState()));

                        let persistedState: PersistedState;

                        if (migrate && value.version !== undefined && value.version !== version) {
                            persistedState = await migrate(value.state, value.version);
                        } else {
                            persistedState = value.state as PersistedState;
                        }

                        const mergedState = merge(persistedState, store.getState());
                        store.setState(mergedState, true);

                        finishHydrateListeners.forEach(fn => fn(store.getState()));
                        onHydrate?.(store.getState());
                    }

                    hydrated = true;
                } catch (error) {
                    log.warn(`[Persist:${name}] 恢复状态失败，使用内存态:`, error);
                    hydrated = true;
                }
            },
            hasHydrated: () => hydrated,
            onHydrate: (fn: (state: T) => void) => {
                hydrateListeners.add(fn);
                return () => hydrateListeners.delete(fn);
            },
            onFinishHydration: (fn: (state: T) => void) => {
                finishHydrateListeners.add(fn);
                return () => finishHydrateListeners.delete(fn);
            },
        };

        let saveTimeout: ReturnType<typeof setTimeout> | null = null;
        let pendingSave = false;

        const scheduleSave = () => {
            if (!currentStorage) return;

            pendingSave = true;

            if (saveTimeout) return;

            saveTimeout = setTimeout(() => {
                saveTimeout = null;
                if (pendingSave) {
                    pendingSave = false;
                    saveToStorage();
                }
            }, 0);
        };

        const saveToStorage = async () => {
            if (!currentStorage) return;

            try {
                const partialState = partialize(store.getState());
                await currentStorage.setItem(name, {
                    state: partialState,
                    version,
                });
            } catch (error) {
                log.warn(`[Persist:${name}] 保存状态失败:`, error);
            }
        };

        const unsubscribe = store.subscribe(() => {
            scheduleSave();
        });

        const originalDestroy = store.destroy;

        const destroy: StoreApi<T>['destroy'] = () => {
            unsubscribe();
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            if (pendingSave) {
                saveToStorage();
            }
            originalDestroy();
        };

        setTimeout(() => {
            persistApi.rehydrate();
        }, 0);

        return {
            ...store,
            destroy,
            persist: persistApi,
        };
    };
}

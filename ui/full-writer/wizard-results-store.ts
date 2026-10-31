import { Notice } from 'obsidian';
import { createLogger } from '../../shared/logger';
import { STORAGE_KEY_PREFIXES, projectScopedKey } from '../../shared/storage-keys';


const log = createLogger('WizardResultsStore');
/**
 * v3.4.6 向导结果持久化：使用 Proxy 自动写入 localStorage（按项目分桶）。
 *
 * 关键行为：**每次读写都按当前项目重新解析存储桶**。
 * 旧实现只在构造时读一次（此刻 project 还是空串 → 'global'），
 * 之后切项目既不重新加载也不清空，却把整个对象写进「当前项目」的 key：
 * - 项目 B 会命中项目 A 留下的世界观/设定库（跨项目数据污染）；
 * - A 的结果重启后读不回来（读取用的是 global key）。
 *
 * @param getProject 返回当前项目名的惰性取值器。
 */
export function createPersistentWizardResults(
    getProject: () => string
): Record<string, string> {
    const storageKey = (): string => projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, getProject());
    let loadedKey = '';
    let bucket: Record<string, string> = {};

    const load = (key: string): Record<string, string> => {
        if (key === loadedKey) return bucket;
        loadedKey = key;
        bucket = {};
        try {
            const saved = localStorage.getItem(key);
            if (saved) bucket = JSON.parse(saved) as Record<string, string>;
        } catch (e) {
            log.warn('[FullWriter] 存储失败:', e);
            new Notice('FullWriter：数据读取异常，部分功能可能受限');
        }
        return bucket;
    };

    const current = (): Record<string, string> => load(storageKey());

    const persist = (): void => {
        try {
            localStorage.setItem(storageKey(), JSON.stringify(bucket));
        } catch (e) {
            log.warn('[FullWriter] 存储失败:', e);
            new Notice('FullWriter：数据读取异常，部分功能可能受限');
        }
    };

    return new Proxy({} as Record<string, string>, {
        get(_target, prop) {
            const data = current();
            if (prop === 'toJSON') return () => ({ ...data });
            return Reflect.get(data, prop);
        },
        set(_target, prop, value) {
            const data = current();
            data[String(prop)] = value as string;
            persist();
            return true;
        },
        deleteProperty(_target, prop) {
            const data = current();
            delete data[String(prop)];
            persist();
            return true;
        },
        has(_target, prop) {
            return prop in current();
        },
        ownKeys() {
            return Reflect.ownKeys(current());
        },
        getOwnPropertyDescriptor(_target, prop) {
            return Reflect.getOwnPropertyDescriptor(current(), prop)
                ?? { configurable: true, enumerable: true, writable: true, value: undefined };
        },
    });
}

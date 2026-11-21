/**
 * shared/local-storage —— App 级存储适配器与旧全局键迁移。
 *
 * 背景：Obsidian 1.8.7 起推荐 `App#loadLocalStorage` / `App#saveLocalStorage`（按 vault 隔离），
 * 旧版直接读写 `window.localStorage` 会把所有 vault 的草稿混在一个命名空间。
 * 迁移必须保住老用户的草稿：App 存储没有值时回退读旧键，并把它写回 App 存储。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import { registerVaultStorageHost, vaultClear, vaultLoad, vaultSave } from '../../../shared/local-storage';

interface MemoryStorage {
    data: Map<string, string>;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function installLegacyStorage(): MemoryStorage {
    const storage: MemoryStorage = {
        data: new Map<string, string>(),
        getItem(key) { return this.data.has(key) ? this.data.get(key)! : null; },
        setItem(key, value) { this.data.set(key, value); },
        removeItem(key) { this.data.delete(key); },
    };
    (globalThis as unknown as { window?: { localStorage: MemoryStorage } }).window = { localStorage: storage };
    return storage;
}

describe('shared/local-storage — vault 级存储适配器', () => {
    beforeEach(() => {
        registerVaultStorageHost(null);
        installLegacyStorage();
    });

    it('有 App 宿主时读写都走 App 存储，不碰旧全局键', () => {
        const app = new App();
        registerVaultStorageHost(app);
        const legacy = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;

        vaultSave('nw:test', '{"a":1}');

        expect(app.loadLocalStorage('nw:test')).toBe('{"a":1}');
        expect(legacy.data.size).toBe(0);
        expect(vaultLoad('nw:test')).toBe('{"a":1}');
    });

    it('App 存储为空时回退旧全局键，并一次性迁移到 App 存储（旧键保留）', () => {
        const app = new App();
        registerVaultStorageHost(app);
        const legacy = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
        legacy.setItem('nw:legacy', 'old-draft');

        expect(vaultLoad('nw:legacy')).toBe('old-draft');
        expect(app.loadLocalStorage('nw:legacy')).toBe('old-draft');
        expect(legacy.getItem('nw:legacy')).toBe('old-draft');
    });

    it('没有 App 宿主时退回旧全局键（测试与降级路径）', () => {
        const legacy = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
        vaultSave('nw:fallback', 'plain');
        expect(legacy.getItem('nw:fallback')).toBe('plain');
        expect(vaultLoad('nw:fallback')).toBe('plain');
    });

    it('App 存储里的非字符串值序列化成字符串返回', () => {
        const app = new App();
        registerVaultStorageHost(app);
        app.saveLocalStorage('nw:obj', { collapsed: ['a'] });
        expect(vaultLoad('nw:obj')).toBe('{"collapsed":["a"]}');
    });

    it('vaultClear 同时清掉 App 存储与旧全局键', () => {
        const app = new App();
        registerVaultStorageHost(app);
        const legacy = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
        vaultSave('nw:clear', '1');
        legacy.setItem('nw:clear', '1');

        vaultClear('nw:clear');

        expect(app.loadLocalStorage('nw:clear')).toBeNull();
        expect(legacy.getItem('nw:clear')).toBeNull();
    });

    it('App 存储抛错时不冒泡，写入退回旧全局键', () => {
        const app = new App();
        app.saveLocalStorage = () => { throw new Error('quota'); };
        registerVaultStorageHost(app);
        const legacy = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;

        expect(() => vaultSave('nw:throw', 'v')).not.toThrow();
        expect(legacy.getItem('nw:throw')).toBe('v');
    });
});

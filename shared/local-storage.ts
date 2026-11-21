import type { App } from 'obsidian';

/**
 * Vault 级键值存储的唯一入口。
 *
 * Obsidian 1.8.7 起提供 `App#loadLocalStorage` / `App#saveLocalStorage`，
 * 它把数据存进**按 vault 隔离**的命名空间；直接读 `window.localStorage` 会让同一台机器上
 * 多个 vault 互相串数据，社区审核也会把裸 `localStorage` 判为 warn。
 *
 * 迁移口径：第一次读取某个键时，如果 vault 存储里没有值而旧全局键有值，
 * 就把旧值写进 vault 存储再返回。旧键**不删除**（回滚到旧版本时仍可读，且重复迁移无副作用）。
 */

/** 适配器只依赖 App 的这两个方法，便于测试注入。 */
export type VaultStorageHost = Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>;

/** 插件启动时注册的应用实例；测试与早期初始化阶段可能为空。 */
let host: VaultStorageHost | null = null;

/**
 * 注册 vault 存储宿主（插件 onload 时调用一次）。
 *
 * @param app - Obsidian 应用实例；传 null 解除注册（测试清理用）
 */
export function registerVaultStorageHost(app: VaultStorageHost | null): void {
    host = app;
}

/**
 * 取旧版全局 localStorage；node 单测与移动端可能没有。
 *
 * @returns 可用的 Storage，或 null
 */
function legacyStorage(): Storage | null {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
        return null;
    }
}

/**
 * 把旧全局键的值迁进 vault 存储。
 *
 * @param app - 应用实例
 * @param key - 键名
 * @param raw - 旧值
 */
function migrateLegacy(app: VaultStorageHost | null, key: string, raw: string): void {
    if (!app) return;
    try {
        app.saveLocalStorage(key, raw);
    } catch { // silent-ok: 迁移失败只影响下次再迁一次，不影响本次读取
        // 迁移失败不影响本次读取，下次读取会再试一次。
    }
}

/**
 * 读取 vault 级字符串值（含旧全局键的一次性迁移）。
 *
 * @param key - 键名
 * @param app - 应用实例；省略时用 {@link registerVaultStorageHost} 注册的实例
 * @returns 存储的字符串，或 null
 */
export function vaultLoad(key: string, app?: VaultStorageHost | null): string | null {
    const hostApp = app ?? host;
    try {
        if (hostApp) {
            const value = hostApp.loadLocalStorage(key);
            if (typeof value === 'string' && value.length > 0) return value;
            if (value !== null && value !== undefined && typeof value !== 'string') {
                return JSON.stringify(value);
            }
        }
        const raw = legacyStorage()?.getItem(key) ?? null;
        if (raw !== null && raw !== undefined) {
            migrateLegacy(hostApp, key, raw);
        }
        return raw;
    } catch {
        return null;
    }
}

/**
 * 写入 vault 级字符串值。
 *
 * @param key - 键名
 * @param value - 要保存的字符串（内部按原样存取，调用方自行 JSON.stringify）
 * @param app - 应用实例；省略时用注册的实例
 */
export function vaultSave(key: string, value: string, app?: VaultStorageHost | null): void {
    const hostApp = app ?? host;
    if (hostApp) {
        try {
            hostApp.saveLocalStorage(key, value);
            return;
        } catch { // silent-ok: vault 存储不可用时退回全局 localStorage，保证本次写入不丢
            // 退回旧存储。
        }
    }
    legacyStorage()?.setItem(key, value);
}

/**
 * 清空 vault 级键（旧全局键也一并清掉）。
 *
 * @param key - 键名
 * @param app - 应用实例；省略时用注册的实例
 */
export function vaultClear(key: string, app?: VaultStorageHost | null): void {
    const hostApp = app ?? host;
    try {
        hostApp?.saveLocalStorage(key, null);
    } catch { // silent-ok: 清理失败不影响主流程，键值只是体验数据
        // 忽略清理失败。
    }
    legacyStorage()?.removeItem(key);
}

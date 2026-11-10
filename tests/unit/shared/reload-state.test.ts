import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    consumePendingReloadState,
    PENDING_RELOAD_TTL_MS,
    savePendingReloadState,
    type PendingReloadState,
} from '../../../shared/reload-state';

/**
 * O-3（2026-11-10 生命周期审计）：设置页承诺「关闭再启用插件后工作台状态自动恢复」，
 * 但旧实现只写旧实例的内存字段。这里锁住跨实例交接契约：
 * 同一窗口 sessionStorage、10 分钟 TTL、读取即删除、结构/时间戳非法不恢复。
 */

class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length(): number { return this.map.size; }
    clear(): void { this.map.clear(); }
    getItem(key: string): string | null { return this.map.get(key) ?? null; }
    key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
    removeItem(key: string): void { this.map.delete(key); }
    setItem(key: string, value: string): void { this.map.set(key, value); }
}

const STATE: PendingReloadState = {
    project: '长篇小说/测试书',
    chapterFileName: '第3章',
    volume: '第1卷',
    chapDir: '第1卷',
};

describe('热重载状态交接', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('sessionStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('保存后新实例可消费一次，字段完整；再次消费为 null', () => {
        savePendingReloadState(STATE);
        expect(consumePendingReloadState()).toEqual(STATE);
        expect(consumePendingReloadState()).toBeNull();
    });

    it('缺少可选字段时只返回存在的字段', () => {
        savePendingReloadState({ project: '短篇小说/书', chapterFileName: '' });
        expect(consumePendingReloadState()).toEqual({ project: '短篇小说/书', chapterFileName: '' });
    });

    it('超过 TTL 不恢复，且已清除残留', () => {
        savePendingReloadState(STATE);
        expect(consumePendingReloadState(Date.now() + PENDING_RELOAD_TTL_MS + 1)).toBeNull();
        expect(storage.getItem('nw:pending-reload:v1')).toBeNull();
    });

    it('时间戳来自未来（时钟回拨）不恢复', () => {
        storage.setItem('nw:pending-reload:v1', JSON.stringify({
            state: STATE,
            savedAt: Date.now() + 5 * 60_000,
        }));
        expect(consumePendingReloadState()).toBeNull();
    });

    it('损坏 JSON / 缺项目 / 缺时间戳均不恢复', () => {
        storage.setItem('nw:pending-reload:v1', 'not-json');
        expect(consumePendingReloadState()).toBeNull();

        storage.setItem('nw:pending-reload:v1', JSON.stringify({ state: { project: '' }, savedAt: Date.now() }));
        expect(consumePendingReloadState()).toBeNull();

        storage.setItem('nw:pending-reload:v1', JSON.stringify({ state: STATE }));
        expect(consumePendingReloadState()).toBeNull();
    });

    it('存储不可用/写入抛错时静默降级，不影响重载', () => {
        vi.stubGlobal('sessionStorage', undefined);
        expect(() => savePendingReloadState(STATE)).not.toThrow();
        expect(consumePendingReloadState()).toBeNull();

        vi.stubGlobal('sessionStorage', {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('quota'); },
            removeItem: () => { throw new Error('denied'); },
        });
        expect(() => savePendingReloadState(STATE)).not.toThrow();
        expect(consumePendingReloadState()).toBeNull();
    });
});

import { createLogger } from './logger';

const log = createLogger('AdaptiveDebounceManager');
/**
 * AdaptiveDebounceManager — 自适应防抖管理器
 *
 * 功能：
 * - 自适应防抖：根据最近调用间隔动态调整延迟
 *   - 快速输入 (< fastThreshold): 使用长延迟（减少更新）
 *   - 中速输入: 使用中等延迟
 *   - 慢速输入 (> slowThreshold): 使用短延迟（提高响应）
 * - 固定延迟防抖：兼容现有场景
 * - 内存保护：超过最大 key 数量自动清理一半旧的
 * - 完整的 cancel / flush / dispose API
 *
 * 设计参考: WebNovelAssistant AdaptiveDebounceManager
 */

export interface DebounceOptions {
    /** 快速输入时的延迟（ms），默认 500 */
    fastDelay?: number;
    /** 中速输入时的延迟（ms），默认 300 */
    mediumDelay?: number;
    /** 慢速输入时的延迟（ms），默认 150 */
    slowDelay?: number;
    /** 快速输入阈值（ms），低于此值视为快速，默认 200 */
    fastThreshold?: number;
    /** 慢速输入阈值（ms），高于此值视为慢速，默认 500 */
    slowThreshold?: number;
    /** 用于计算平均间隔的历史记录数，默认 5 */
    historySize?: number;
    /** 最大 key 数量，超过后清理一半旧的，默认 500 */
    maxKeys?: number;
    /** 是否输出调试日志 */
    debug?: boolean;
}

interface TimerEntry {
    timer: ReturnType<typeof setTimeout>;
    fn: () => void | Promise<void>;
    lastAccessed: number;
}

export class AdaptiveDebounceManager {
    private readonly fastDelay: number;
    private readonly mediumDelay: number;
    private readonly slowDelay: number;
    private readonly fastThreshold: number;
    private readonly slowThreshold: number;
    private readonly historySize: number;
    private readonly maxKeys: number;
    private readonly debug: boolean;

    private timers = new Map<string, TimerEntry>();
    private callHistory = new Map<string, number[]>();

    constructor(options: DebounceOptions = {}) {
        this.fastDelay = options.fastDelay ?? 500;
        this.mediumDelay = options.mediumDelay ?? 300;
        this.slowDelay = options.slowDelay ?? 150;
        this.fastThreshold = options.fastThreshold ?? 200;
        this.slowThreshold = options.slowThreshold ?? 500;
        this.historySize = options.historySize ?? 5;
        this.maxKeys = options.maxKeys ?? 500;
        this.debug = options.debug ?? false;
    }

    /**
     * 自适应防抖 - 根据最近调用间隔自动调整延迟
     * @param key 唯一标识
     * @param fn 要执行的函数
     */
    debounce(key: string, fn: () => void | Promise<void>): void {
        const delay = this.calculateAdaptiveDelay(key);

        if (this.debug) {
            log.info(`[AdaptiveDebounce] debounce '${key}', delay=${delay}ms`);
        }

        this.schedule(key, fn, delay);
    }

    /**
     * 固定延迟防抖
     * @param key 唯一标识
     * @param fn 要执行的函数
     * @param delay 延迟（ms）
     */
    debounceFixed(key: string, fn: () => void | Promise<void>, delay: number): void {
        if (this.debug) {
            log.info(`[AdaptiveDebounce] debounceFixed '${key}', delay=${delay}ms`);
        }

        this.schedule(key, fn, delay);
    }

    /**
     * 取消指定 key 的防抖
     * @param key - 键
     */
    cancel(key: string): void {
        const entry = this.timers.get(key);
        if (entry) {
            clearTimeout(entry.timer);
            this.timers.delete(key);
            if (this.debug) {
                log.info(`[AdaptiveDebounce] cancel '${key}'`);
            }
        }
    }

    /**
     * 立即执行指定 key 的防抖（如果有待执行）
     * @param key - 键
     */
    flush(key: string): void {
        const entry = this.timers.get(key);
        if (entry) {
            clearTimeout(entry.timer);
            this.timers.delete(key);

            if (this.debug) {
                log.info(`[AdaptiveDebounce] flush '${key}'`);
            }

            try {
                const result = entry.fn();
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch(e =>
                        log.warn(`[AdaptiveDebounce] flush '${key}' error:`, e)
                    );
                }
            } catch (e) {
                log.warn(`[AdaptiveDebounce] flush '${key}' error:`, e);
            }
        }
    }

    /**
     * 取消所有防抖
     */
    cancelAll(): void {
        for (const [key, entry] of this.timers) {
            clearTimeout(entry.timer);
        }
        this.timers.clear();

        if (this.debug) {
            log.info(`[AdaptiveDebounce] cancelAll`);
        }
    }

    /**
     * 立即执行所有待执行的防抖
     */
    flushAll(): void {
        const entries = Array.from(this.timers.entries());
        this.timers.clear();

        for (const [key, entry] of entries) {
            clearTimeout(entry.timer);
            try {
                const result = entry.fn();
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch(e =>
                        log.warn(`[AdaptiveDebounce] flushAll '${key}' error:`, e)
                    );
                }
            } catch (e) {
                log.warn(`[AdaptiveDebounce] flushAll '${key}' error:`, e);
            }
        }

        if (this.debug) {
            log.info(`[AdaptiveDebounce] flushAll, flushed ${entries.length} keys`);
        }
    }

    /**
     * 获取待执行的 key 数量
     * @returns 数值结果
     */
    getPendingCount(): number {
        return this.timers.size;
    }

    /**
     * 检查指定 key 是否有待执行的防抖
     * @param key - 键
     * @returns 是否成功
     */
    hasPending(key: string): boolean {
        return this.timers.has(key);
    }

    /**
     * 销毁实例，清理所有资源
     */
    dispose(): void {
        this.cancelAll();
        this.callHistory.clear();

        if (this.debug) {
            log.info(`[AdaptiveDebounce] dispose`);
        }
    }

    /**
     * 核心调度逻辑
     */
    private schedule(key: string, fn: () => void | Promise<void>, delay: number): void {
        // 清除旧的 timer
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing.timer);
        }

        // 检查 key 数量，超过则清理一半旧的
        if (!existing && this.timers.size >= this.maxKeys) {
            this.cleanupOldKeys();
        }

        // 设置新的 timer
        const timer = setTimeout(() => {
            this.timers.delete(key);

            if (this.debug) {
                log.info(`[AdaptiveDebounce] execute '${key}'`);
            }

            try {
                const result = fn();
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch(e =>
                        log.warn(`[AdaptiveDebounce] '${key}' error:`, e)
                    );
                }
            } catch (e) {
                log.warn(`[AdaptiveDebounce] '${key}' error:`, e);
            }
        }, delay);

        this.timers.set(key, {
            timer,
            fn,
            lastAccessed: Date.now()
        });
    }

    /**
     * 计算自适应延迟
     * 根据最近几次调用的平均间隔决定延迟档位
     */
    private calculateAdaptiveDelay(key: string): number {
        const now = Date.now();

        // 获取或初始化历史记录
        let history = this.callHistory.get(key);
        if (!history) {
            history = [];
            this.callHistory.set(key, history);
        }

        // 添加当前时间戳
        history.push(now);
        if (history.length > this.historySize) {
            history.shift();
        }

        // 历史记录不足时使用中速延迟
        if (history.length < 2) {
            return this.mediumDelay;
        }

        // 计算平均间隔
        let totalInterval = 0;
        for (let i = 1; i < history.length; i++) {
            totalInterval += history[i] - history[i - 1];
        }
        const avgInterval = totalInterval / (history.length - 1);

        // 根据平均间隔决定延迟档位
        if (avgInterval < this.fastThreshold) {
            return this.fastDelay;
        } else if (avgInterval > this.slowThreshold) {
            return this.slowDelay;
        } else {
            return this.mediumDelay;
        }
    }

    /**
     * 清理一半旧的 key（按 lastAccessed 排序）
     */
    private cleanupOldKeys(): void {
        const entries = Array.from(this.timers.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        const toRemove = Math.floor(entries.length / 2);
        for (let i = 0; i < toRemove; i++) {
            const [key, entry] = entries[i];
            clearTimeout(entry.timer);
            this.timers.delete(key);
            this.callHistory.delete(key);
        }

        if (this.debug) {
            log.info(`[AdaptiveDebounce] cleanupOldKeys, removed ${toRemove} keys`);
        }
    }
}

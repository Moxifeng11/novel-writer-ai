/**
 * SerializedWriter - 串行写入器
 *
 * 保证异步写操作按顺序执行，单个操作失败不阻塞后续操作。
 * 用于设置保存、缓存写入等需要原子性的场景。
 *
 * 设计参考: WebNovelAssistant AdaptiveDebounceManager
 * - Promise 队列保证顺序执行
 * - 错误隔离确保单次失败不影响整体
 * - 脏标记追踪待写入状态
 */

import { createLogger, Logger } from './logger';

/**
 * SerializedWriterOptions 类型定义。
 */
export interface SerializedWriterOptions {
    /** 队列满时的最大等待时间 (ms)，超时后丢弃旧操作 */
    maxWaitMs?: number;
    /** 是否在控制台输出调试信息 */
    debug?: boolean;
}

/**
 * SerializedWriter 类。
 */
export class SerializedWriter {
    private queue: Promise<void> = Promise.resolve();
    private _isDirty = false;
    private pendingCount = 0;
    private readonly maxWaitMs: number;
    private readonly log: Logger;

    constructor(options: SerializedWriterOptions = {}) {
        this.maxWaitMs = options.maxWaitMs ?? 5000;
        this.log = createLogger('SerializedWriter', options.debug ? 'debug' : 'warn');
    }

    /**
     * 将写入操作加入队列，按顺序执行
     * @param operation 异步写入操作
     * @returns 操作结果
     */
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        this._isDirty = true;
        this.pendingCount++;

        this.log.debug(`入队操作，当前待处理: ${this.pendingCount}`);

        // 关键设计：错误解耦 - 失败不阻塞队列
        const resultPromise = this.queue.then(async () => {
            this.log.debug(`开始执行操作，剩余: ${this.pendingCount}`);

            try {
                const result = await operation();
                this.pendingCount--;
                this.log.debug(`操作成功完成，剩余待处理: ${this.pendingCount}`);
                return result;
            } catch (error) {
                this.pendingCount--;
                this.log.warn(`操作失败，剩余待处理: ${this.pendingCount}`, error);
                throw error;
            }
        });

        // 关键设计：错误解耦 - 失败不阻塞队列
        // 即使操作失败，也继续处理队列中的下一个操作
        this.queue = resultPromise.then(
            () => {},
            () => {}  // 吞掉错误，不影响队列继续
        );

        return resultPromise;
    }

    /**
     * 同步操作（无返回值）
     * @param operation - 操作名
     */
    enqueueVoid(operation: () => Promise<void>): Promise<void> {
        return this.enqueue(async () => {
            await operation();
        });
    }

    /**
     * 检查是否有待处理的操作
     * @returns 是否成功
     */
    get isDirty(): boolean {
        return this._isDirty;
    }

    /**
     * 获取当前待处理操作数量
     * @returns 数值结果
     */
    get pending(): number {
        return this.pendingCount;
    }

    /**
     * 等待所有排队操作完成。
     *
     * 不能无限等：底层写盘若卡住（Vault 锁 / 只读盘 / 网络盘），flush 会在
     * 插件卸载或切章时永久挂起。超过 maxWaitMs 即返回并留下告警日志。
     * @param timeoutMs - 超时时间（毫秒）
     */
    async flush(timeoutMs: number = this.maxWaitMs): Promise<void> {
        this.log.debug(`等待刷新，剩余: ${this.pendingCount}，超时 ${timeoutMs}ms`);

        const deadline = Date.now() + timeoutMs;
        // 等待当前队列处理完毕（带超时）
        await Promise.race([
            this.queue,
            new Promise<void>(resolve => setTimeout(resolve, Math.max(0, timeoutMs))),
        ]);

        // 额外等待确保所有 pendingCount 归零
        while (this.pendingCount > 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (this.pendingCount > 0) {
            this.log.warn(`刷新超时（${timeoutMs}ms）：仍有 ${this.pendingCount} 个操作未完成，放行以避免阻塞`);
            return;
        }
        this.log.debug(`刷新完成`);
    }

    /**
     * 清除脏标记（在写入成功后调用）
     */
    markClean(): void {
        this._isDirty = false;
        this.log.debug(`标记为已清洁`);
    }

    /**
     * 插件卸载 / 组件销毁前调用：尽量把队列写完，超时放行。
     * 持有者（批量导入、指纹、偏好记忆、知识库）都必须在 onunload 里调用，
     * 否则最后一批写入会随进程退出丢失。
     * @param timeoutMs - 超时时间（毫秒）
     */
    async dispose(timeoutMs: number = this.maxWaitMs): Promise<void> {
        await this.flush(timeoutMs);
        this.reset();
    }

    /**
     * 重置写入器状态
     */
    reset(): void {
        this._isDirty = false;
        this.pendingCount = 0;
        this.log.debug(`重置状态`);
    }

    /**
     * 创建带有自动脏标记管理的包装器
     * 操作成功完成后自动清除脏标记
     * @param operation - 操作名
      * @returns T 实例
     */
    enqueueAutoClean<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueue(async () => {
            try {
                const result = await operation();
                this._isDirty = false;
                return result;
            } catch (error) {
                // 错误时不清除脏标记，保留重试机会
                throw error;
            }
        });
    }
}

/**
 * 创建单例 SerializedWriter 的工厂函数
 * 适用于全局唯一的写入器（如设置保存）
 */
let globalWriter: SerializedWriter | null = null;

/**
 * getGlobalSerializedWriter 函数。
  * @returns SerializedWriter 实例
 */
export function getGlobalSerializedWriter(): SerializedWriter {
    if (!globalWriter) {
        globalWriter = new SerializedWriter({
            debug: false,
            maxWaitMs: 5000
        });
    }
    return globalWriter;
}

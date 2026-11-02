/**
 * token-bucket-rate-limiter.ts — 令牌桶限流器
 *
 * 功能：基于令牌桶算法控制向量计算等耗时操作的速率，
 *       支持多任务共享、优先级队列、批次消耗、动态调速。
 *
 * 设计目标：
 * - GPU 利用率稳定在 60-80%，不打满也不闲置
 * - 高优先级任务优先获取令牌
 * - 支持批次消耗，一次性分配多段令牌
 * - 可动态调整速率，配合降级策略
 */

export interface RateLimiterOptions {
    tokensPerSecond: number;
    maxTokens: number;
    initialTokens?: number;
}

/**
 * 获取令牌选项。
 */
export interface AcquireOptions {
    priority?: number;
    signal?: AbortSignal;
}

interface PendingRequest {
    tokenAmount: number;
    priority: number;
    resolve: () => void;
    reject: (reason: Error) => void;
    signal?: AbortSignal;
    queuedAt: number;
}

/**
 * 令牌桶限流器。
 */
export class TokenBucketRateLimiter {
    private tokensPerSecond: number;
    private maxTokens: number;
    private currentTokens: number;
    private lastRefillTime: number;
    private pendingQueue: PendingRequest[];
    private isProcessingQueue: boolean;
    private paused: boolean;

    constructor(options: RateLimiterOptions) {
        this.tokensPerSecond = options.tokensPerSecond;
        this.maxTokens = options.maxTokens;
        this.currentTokens = options.initialTokens ?? options.maxTokens;
        this.lastRefillTime = Date.now();
        this.pendingQueue = [];
        this.isProcessingQueue = false;
        this.paused = false;
    }

    /**
     * 获取令牌（等待）。
     *
     * @param tokenAmount - token 数量
     * @param options - 配置项
     * @returns 是否获取
     */
    async acquire(tokenAmount: number = 1, options: AcquireOptions = {}): Promise<void> {
        if (tokenAmount <= 0) {
            return;
        }

        if (tokenAmount > this.maxTokens) {
            throw new Error(`请求令牌数 ${tokenAmount} 超过最大容量 ${this.maxTokens}`);
        }

        this.refillTokens();

        if (!this.paused && this.currentTokens >= tokenAmount) {
            this.currentTokens -= tokenAmount;
            return;
        }

        return new Promise<void>((resolve, reject) => {
            const request: PendingRequest = {
                tokenAmount,
                priority: options.priority ?? 0,
                resolve,
                reject,
                signal: options.signal,
                queuedAt: Date.now(),
            };

            if (options.signal) {
                if (options.signal.aborted) {
                    reject(new Error('请求已取消'));
                    return;
                }
                options.signal.addEventListener('abort', () => {
                    this.removeFromQueue(request);
                    reject(new Error('请求已取消'));
                }, { once: true });
            }

            this.pendingQueue.push(request);
            this.sortQueue();
            this.scheduleProcessQueue();
        });
    }

    /**
     * 尝试获取令牌。
     *
     * @param tokenAmount - token 数量
     * @returns 布尔值
     */
    tryAcquire(tokenAmount: number = 1): boolean {
        if (tokenAmount <= 0 || this.paused) {
            return false;
        }

        this.refillTokens();

        if (this.currentTokens >= tokenAmount) {
            this.currentTokens -= tokenAmount;
            return true;
        }

        return false;
    }

    /**
     * 归还令牌。
     *
     * @param tokenAmount - token 数量
     */
    release(tokenAmount: number = 1): void {
        if (tokenAmount <= 0) return;
        this.currentTokens = Math.min(this.maxTokens, this.currentTokens + tokenAmount);
        this.scheduleProcessQueue();
    }

    /**
     * 设置速率。
     *
     * @param tokensPerSecond - 每秒 token 数
     */
    setRate(tokensPerSecond: number): void {
        if (tokensPerSecond < 0) {
            throw new Error('速率不能为负数');
        }
        this.refillTokens();
        this.tokensPerSecond = tokensPerSecond;
    }

    /**
     * 设置桶容量。
     *
     * @param maxTokens - 最大 token 数
     */
    setMaxTokens(maxTokens: number): void {
        if (maxTokens <= 0) {
            throw new Error('最大令牌数必须大于 0');
        }
        this.maxTokens = maxTokens;
        if (this.currentTokens > maxTokens) {
            this.currentTokens = maxTokens;
        }
    }

    /**
     * 暂停。
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * 恢复。
     */
    resume(): void {
        if (this.paused) {
            this.paused = false;
            this.scheduleProcessQueue();
        }
    }

    get availableTokens(): number {
        this.refillTokens();
        return this.currentTokens;
    }

    get queueLength(): number {
        return this.pendingQueue.length;
    }

    get currentRate(): number {
        return this.tokensPerSecond;
    }

    get isPaused(): boolean {
        return this.paused;
    }

    private refillTokens(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefillTime) / 1000;

        if (elapsed > 0) {
            const tokensToAdd = elapsed * this.tokensPerSecond;
            this.currentTokens = Math.min(this.maxTokens, this.currentTokens + tokensToAdd);
            this.lastRefillTime = now;
        }
    }

    private sortQueue(): void {
        this.pendingQueue.sort((a, b) => {
            if (b.priority !== a.priority) {
                return b.priority - a.priority;
            }
            return a.queuedAt - b.queuedAt;
        });
    }

    private scheduleProcessQueue(): void {
        if (this.isProcessingQueue || this.paused) {
            return;
        }

        if (this.pendingQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        setTimeout(() => this.processQueue(), 0);
    }

    private processQueue(): void {
        this.isProcessingQueue = false;

        if (this.paused || this.pendingQueue.length === 0) {
            return;
        }

        this.refillTokens();

        let processed = false;

        for (let i = 0; i < this.pendingQueue.length; i++) {
            const request = this.pendingQueue[i];

            if (request.signal?.aborted) {
                this.pendingQueue.splice(i, 1);
                i--;
                continue;
            }

            if (this.currentTokens >= request.tokenAmount) {
                this.currentTokens -= request.tokenAmount;
                this.pendingQueue.splice(i, 1);
                request.resolve();
                processed = true;
                break;
            }
        }

        if (processed && this.pendingQueue.length > 0) {
            this.scheduleProcessQueue();
        } else if (this.pendingQueue.length > 0) {
            const nextRequest = this.pendingQueue[0];
            const tokensNeeded = nextRequest.tokenAmount - this.currentTokens;
            const waitTime = (tokensNeeded / this.tokensPerSecond) * 1000;

            if (isFinite(waitTime) && waitTime > 0 && waitTime < 60000) {
                setTimeout(() => this.processQueue(), Math.min(waitTime, 1000));
            }
        }
    }

    private removeFromQueue(request: PendingRequest): void {
        const index = this.pendingQueue.indexOf(request);
        if (index !== -1) {
            this.pendingQueue.splice(index, 1);
        }
    }
}

/**
 * 本地 AI 调用串行队列。
 *
 * Ollama 单机默认只有一个并行槽：建议、幽灵、守卫、验证同时发起时，
 * 后到的请求只会排队到超时，用户看到的是“卡住”而不是“慢”。
 * 这里用进程级信号量把本地调用串起来；云端调用不经过此队列。
 */

const MAX_LOCAL_CONCURRENCY = 1;

let active = 0;

interface Waiter {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
}

const waiters: Waiter[] = [];

function createRelease(): () => void {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        pump();
    };
}

function pump(): void {
    while (active < MAX_LOCAL_CONCURRENCY && waiters.length > 0) {
        const waiter = waiters.shift();
        if (!waiter) return;
        waiter.cleanup();
        active++;
        waiter.resolve(createRelease());
    }
}

/**
 * 获取一个本地调用槽；signal 中止时从队列移除并 reject。
 *
 * @param signal - 取消信号
 */
export function acquireLocalAiSlot(signal?: AbortSignal, timeoutMs = 300_000): Promise<() => void> {
    if (signal?.aborted) {
        return Promise.reject(new Error('aborted'));
    }
    if (active < MAX_LOCAL_CONCURRENCY) {
        active++;
        return Promise.resolve(createRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const waiter: Waiter = {
            resolve,
            reject,
            cleanup: () => {
                if (signal) signal.removeEventListener('abort', onAbort);
                if (timer) clearTimeout(timer);
            },
        };
        const remove = () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            waiter.cleanup();
        };
        const onAbort = () => {
            remove();
            reject(new Error('aborted'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                remove();
                reject(new Error('本地 AI 队列等待超时'));
            }, timeoutMs);
        }
        waiters.push(waiter);
    });
}

/** 测试辅助：清空队列状态，避免跨用例串扰。 */
export function resetLocalAiQueueForTests(): void {
    active = 0;
    waiters.length = 0;
}
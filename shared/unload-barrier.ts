/**
 * unload-barrier.ts — 插件卸载期的有界异步收尾
 *
 * 背景（2026-11-10 维度①二轮）：`leaf.detach()` 只触发视图 `onClose`，不等待其
 * 返回的 Promise；协同写作的 saveBody 最坏可跑数十秒。旧实例的保存可能在
 * `disposeAll` 之后、甚至重新 enable 之后落盘，覆盖新实例刚写的正文。
 *
 * 口径：
 * - `close()` 后仍允许 `track`（卸载流程内部还会发起保存），但调用方应在 close 前
 *   登记所有重任务；
 * - `drain(ms)` 有界等待：超时返回 false，绝不无限拖延宿主卸载；
 * - `track` 不改变原 Promise 的语义，只额外登记等待。
 */

/** 插件卸载屏障：登记在途异步任务并在卸载时有界等待 */
export class UnloadBarrier {
    private closed = false;
    private pending = new Set<Promise<unknown>>();

    /** 进入卸载态（不阻塞后续 track，便于 onClose 内部继续登记保存） */
    close(): void {
        this.closed = true;
    }

    get isClosed(): boolean {
        return this.closed;
    }

    /**
     * 登记一个在途任务（返回原 Promise，调用方仍可自行 await）。
     *
     * @param promise - 在途任务
     * @returns 原 Promise
     */
    track<T>(promise: Promise<T>): Promise<T> {
        const settled = promise.then(
            () => undefined,
            () => undefined,
        );
        this.pending.add(settled);
        void settled.then(() => { this.pending.delete(settled); });
        return promise;
    }

    /**
     * 等待所有已登记任务结束。
     *
     * @param deadlineMs - 最长等待时间，默认 2500ms
     * @returns 是否在期限内全部结束
     */
    async drain(deadlineMs = 2500): Promise<boolean> {
        const deadline = Date.now() + Math.max(0, deadlineMs);
        while (this.pending.size > 0) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) return false;
            const batch = [...this.pending];
            const allSettled = Promise.all(batch).then(() => true);
            const timeout = new Promise<false>((resolve) => {
                setTimeout(() => resolve(false), remaining);
            });
            const finished = await Promise.race([allSettled, timeout]);
            if (!finished) return false;
        }
        return true;
    }

    /** 仅供测试/诊断：当前在途任务数 */
    get pendingCount(): number {
        return this.pending.size;
    }
}

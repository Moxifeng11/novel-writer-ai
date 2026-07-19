import { describe, it, expect, vi } from 'vitest';
import { withWriteLock } from '../../../engine/write-lock';

// 测试辅助：返回一个可控的 deferred Promise，便于精确控制锁的释放时机
function createDeferred<T = void>(): {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
} {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('withWriteLock — 锁获取与返回值传递', () => {
    it('执行传入函数并返回其结果', async () => {
        const result = await withWriteLock('file/a.md', async () => 42);
        expect(result).toBe(42);
    });

    it('支持字符串与对象返回值', async () => {
        const result = await withWriteLock('file/b.md', async () => ({ ok: true, n: 7 }));
        expect(result).toEqual({ ok: true, n: 7 });
    });
});

describe('withWriteLock — 并发控制（同一资源串行化）', () => {
    it('同一文件路径的两次调用按顺序执行，不并发', async () => {
        const order: string[] = [];
        const d1 = createDeferred<void>();

        // 任务1：持有锁直到 d1 被 resolve
        const task1 = withWriteLock('same/file.md', async () => {
            order.push('task1-start');
            await d1.promise;
            order.push('task1-end');
        });

        // 任务2：必须等任务1释放锁后才能开始
        const task2 = withWriteLock('same/file.md', async () => {
            order.push('task2-start');
            order.push('task2-end');
        });

        // 此时任务1仍在持有锁，任务2尚未开始
        await Promise.resolve();
        expect(order).toEqual(['task1-start']);

        d1.resolve(undefined);
        await Promise.all([task1, task2]);

        // 串行执行：task1 全部完成后 task2 才开始
        expect(order).toEqual([
            'task1-start',
            'task1-end',
            'task2-start',
            'task2-end',
        ]);
    });

    it('不同文件路径可并发执行', async () => {
        const order: string[] = [];
        const d1 = createDeferred<void>();

        const task1 = withWriteLock('file/x.md', async () => {
            order.push('x-start');
            await d1.promise;
            order.push('x-end');
        });
        const task2 = withWriteLock('file/y.md', async () => {
            order.push('y-start');
            order.push('y-end');
        });

        // 不同路径：task2 不必等 task1
        await task2;
        expect(order).toEqual(['x-start', 'y-start', 'y-end']);

        d1.resolve(undefined);
        await task1;
    });
});

describe('withWriteLock — 锁释放与重新获取', () => {
    it('锁释放后同路径可立即重新获取', async () => {
        const r1 = await withWriteLock('reusable.md', async () => 'first');
        expect(r1).toBe('first');

        // 第二次获取应无需等待
        const r2 = await withWriteLock('reusable.md', async () => 'second');
        expect(r2).toBe('second');
    });

    it('多轮串行获取均能正确返回', async () => {
        const results: number[] = [];
        for (let i = 0; i < 5; i++) {
            results.push(await withWriteLock('loop.md', async () => i));
        }
        expect(results).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('withWriteLock — 异常情况下的锁释放', () => {
    it('任务抛错时锁被释放，后续任务可正常执行', async () => {
        const failing = withWriteLock('err.md', async () => {
            throw new Error('boom');
        });
        await expect(failing).rejects.toThrow('boom');

        // 锁应已释放，后续任务可正常获取并返回
        const next = await withWriteLock('err.md', async () => 'recovered');
        expect(next).toBe('recovered');
    });

    it('任务抛错后同路径串行队列仍按序执行', async () => {
        const order: string[] = [];
        const d1 = createDeferred<void>();

        const task1 = withWriteLock('err2.md', async () => {
            order.push('t1-start');
            await d1.promise;
            throw new Error('t1-fail');
        });
        const task2 = withWriteLock('err2.md', async () => {
            order.push('t2');
        });

        d1.resolve(undefined);
        await expect(task1).rejects.toThrow('t1-fail');
        await task2;

        // task1 失败后 task2 仍执行
        expect(order).toEqual(['t1-start', 't2']);
    });
});

describe('withWriteLock — 串行化语义验证', () => {
    it('并发提交 3 个任务，全部按提交顺序执行', async () => {
        const order: number[] = [];
        const deferreds = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];

        const tasks = [
            withWriteLock('seq.md', async () => {
                order.push(0);
                await deferreds[0].promise;
            }),
            withWriteLock('seq.md', async () => {
                order.push(1);
                await deferreds[1].promise;
            }),
            withWriteLock('seq.md', async () => {
                order.push(2);
                await deferreds[2].promise;
            }),
        ];

        // 依次释放锁
        deferreds[0].resolve(undefined);
        await tasks[0];
        expect(order).toEqual([0, 1]);

        deferreds[1].resolve(undefined);
        await tasks[1];
        expect(order).toEqual([0, 1, 2]);

        deferreds[2].resolve(undefined);
        await tasks[2];
        expect(order).toEqual([0, 1, 2]);
    });
});

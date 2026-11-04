import { describe, expect, it, vi } from 'vitest';
import { JobService } from '../../../services/job-service';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('JobService — 任务生命周期', () => {
    it('启动、进度与成功完成', async () => {
        const gate = deferred<void>();
        const service = new JobService({ now: () => 100 });
        const events: string[] = [];
        service.subscribe(event => events.push(event.type));

        const job = service.start({
            kind: 'batch',
            title: '批量生成',
            project: '长篇小说/甲',
            run: async (ctx) => {
                ctx.update({ current: 1, total: 3, label: '第1章' });
                await gate.promise;
                return 'ok';
            },
        });

        expect(job.status).toBe('queued');
        await tick();
        expect(service.get(job.id)?.status).toBe('running');
        expect(service.get(job.id)?.progress).toMatchObject({ current: 1, total: 3, label: '第1章' });

        gate.resolve();
        await tick();
        const done = service.get(job.id)!;
        expect(done.status).toBe('succeeded');
        expect(done.result).toBe('ok');
        expect(done.progress.current).toBe(3);
        expect(events).toContain('started');
        expect(events).toContain('progress');
        expect(events).toContain('finished');
    });

    it('失败记录错误，重试创建新任务并保留旧记录', async () => {
        const service = new JobService();
        let attempts = 0;
        const job = service.start({
            kind: 'export',
            title: '导出',
            run: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('磁盘已满');
                return 'done';
            },
        });
        await tick();
        expect(service.get(job.id)?.status).toBe('failed');
        expect(service.get(job.id)?.error).toBe('磁盘已满');

        const retried = service.retry(job.id);
        expect(retried).not.toBeNull();
        expect(retried!.id).not.toBe(job.id);
        await tick();
        expect(service.get(retried!.id)?.status).toBe('succeeded');
        expect(service.get(job.id)?.status).toBe('failed');
    });

    it('取消运行中任务：触发 abort 与 onCancel，完成回调不再改状态', async () => {
        const gate = deferred<void>();
        let aborted = false;
        const onCancel = vi.fn();
        const service = new JobService();
        const job = service.start({
            kind: 'chapter-run',
            title: '一键跑章',
            onCancel,
            run: async (ctx) => {
                ctx.signal.addEventListener('abort', () => { aborted = true; });
                await gate.promise;
                return 'late';
            },
        });
        await tick();

        expect(service.cancel(job.id)).toBe(true);
        expect(aborted).toBe(true);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(service.get(job.id)?.status).toBe('cancelled');

        gate.resolve();
        await tick();
        expect(service.get(job.id)?.status).toBe('cancelled');
        expect(service.get(job.id)?.result).toBeUndefined();
    });

    it('waitFor 等到任务结束并返回最终快照', async () => {
        const gate = deferred<void>();
        const service = new JobService();
        const job = service.start({ kind: 'custom', title: '等待', run: async () => { await gate.promise; return 7; } });
        const waiting = service.waitFor(job.id);
        gate.resolve();
        const final = await waiting;
        expect(final.status).toBe('succeeded');
        expect(final.result).toBe(7);
    });

    it('列表运行中优先，历史超过上限时淘汰最旧', async () => {
        const service = new JobService({ maxHistory: 2 });
        const finished = [];
        for (let i = 0; i < 4; i++) {
            const job = service.start({ kind: 'custom', title: `任务${i}`, run: async () => i });
            finished.push(job);
            await tick();
        }
        const list = service.list();
        expect(list.filter(item => item.status === 'succeeded')).toHaveLength(2);
        expect(service.get(finished[0].id)).toBeUndefined();

        const gate = deferred<void>();
        const running = service.start({ kind: 'custom', title: '运行中', run: () => gate.promise });
        await tick();
        expect(service.list()[0].id).toBe(running.id);
        service.dispose();
        gate.resolve();
    });
});

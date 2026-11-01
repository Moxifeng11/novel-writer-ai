import { describe, expect, it } from 'vitest';
import { FileCache } from '../../../shared/file-cache';
import { MockFileSystem } from '../../../shared/file-system-port';
import { SerializedWriter } from '../../../shared/serialized-writer';

async function readIndex(fs: MockFileSystem, dir = '.cache'): Promise<string> {
    // persistIndex 是 fire-and-forget（mkdir.then(write)），轮询等它落盘
    for (let i = 0; i < 50; i++) {
        if (await fs.exists(`${dir}/index.json`)) {
            return fs.read(`${dir}/index.json`);
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('index.json 未生成');
}

describe('FileCache — index 只落元数据', () => {
    it('index.json 不含 value，但 get 仍能读回完整值', async () => {
        const fs = new MockFileSystem();
        const cache = new FileCache(fs, { cacheDir: '.cache' });
        const value = { style: '冷静', samples: ['一段很长的样本文本'.repeat(50)] };

        await cache.set('k1', value);

        const index = await readIndex(fs);
        expect(index).toContain('k1');
        expect(index).not.toContain('一段很长的样本文本');

        expect(await cache.get('k1')).toEqual(value);
    });

    it('覆盖写不会让 index 体积随 value 增长', async () => {
        const fs = new MockFileSystem();
        const cache = new FileCache(fs, { cacheDir: '.cache' });
        await cache.set('k1', { payload: 'x'.repeat(1000) });
        const small = (await readIndex(fs)).length;
        await cache.set('k1', { payload: 'x'.repeat(20000) });
        const larger = (await readIndex(fs)).length;
        // 只有元数据，两次 index 体积基本一致（允许键名/时间戳带来的极小抖动）
        expect(larger - small).toBeLessThan(64);
        expect(await cache.get('k1')).toEqual({ payload: 'x'.repeat(20000) });
    });
});

describe('SerializedWriter.flush — 有超时上限', () => {
    it('操作卡死时 flush 在超时后返回而不是永久挂起', async () => {
        const writer = new SerializedWriter({ maxWaitMs: 50 });
        // 永不 resolve 的操作
        void writer.enqueue(() => new Promise<void>(() => {}));

        const started = Date.now();
        await writer.flush(60);
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(2000);
        expect(writer.pending).toBeGreaterThan(0);
    });

    it('正常队列会全部落盘且 pending 归零', async () => {
        const writer = new SerializedWriter({ maxWaitMs: 1000 });
        const done: number[] = [];
        for (let i = 0; i < 5; i++) {
            void writer.enqueue(async () => { done.push(i); });
        }
        await writer.flush(1000);
        expect(done).toEqual([0, 1, 2, 3, 4]);
        expect(writer.pending).toBe(0);
    });
});

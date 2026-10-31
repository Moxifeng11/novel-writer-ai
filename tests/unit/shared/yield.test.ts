import { describe, expect, it } from 'vitest';
import { nextFrame, yieldToUI } from '../../../shared/yield';

type RafFn = (cb: FrameRequestCallback) => number;
const rafHost = globalThis as unknown as { requestAnimationFrame?: RafFn };

describe('shared/yield', () => {
    it('yieldToUI 让出事件循环后 resolve', async () => {
        await expect(yieldToUI()).resolves.toBeUndefined();
    });

    it('无 rAF 环境（node 单测）退化为 setTimeout(16) 并 resolve', async () => {
        const saved = rafHost.requestAnimationFrame;
        delete rafHost.requestAnimationFrame;
        try {
            await expect(nextFrame()).resolves.toBeUndefined();
        } finally {
            if (saved) rafHost.requestAnimationFrame = saved;
        }
    });

    it('有 rAF 时等待两帧后 resolve', async () => {
        const saved = rafHost.requestAnimationFrame;
        let calls = 0;
        rafHost.requestAnimationFrame = (cb: FrameRequestCallback) => {
            calls++;
            return setTimeout(() => cb(Date.now()), 5) as unknown as number;
        };
        try {
            await nextFrame();
            expect(calls).toBe(2);
        } finally {
            if (saved) rafHost.requestAnimationFrame = saved;
            else delete rafHost.requestAnimationFrame;
        }
    });

    it('后台窗口 rAF 永不触发时，50ms 超时兜底 resolve（P0-2 回归守卫）', async () => {
        const saved = rafHost.requestAnimationFrame;
        rafHost.requestAnimationFrame = () => 0;
        try {
            const start = Date.now();
            await nextFrame();
            expect(Date.now() - start).toBeGreaterThanOrEqual(45);
        } finally {
            if (saved) rafHost.requestAnimationFrame = saved;
            else delete rafHost.requestAnimationFrame;
        }
    });
});

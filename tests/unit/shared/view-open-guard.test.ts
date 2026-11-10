/**
 * L3-1：视图 onOpen 代次守卫的行为回归。
 *
 * 背景：ItemView.onOpen 里有多个 await（恢复状态/加载上下文/读配置），
 * 用户在此期间关标签或禁用插件时，续体会继续渲染并往已 unload 的 Component
 * 注册监听。守卫必须在 onClose/invalidate 后让所有旧代次失效。
 */

import { describe, expect, it } from 'vitest';
import { createViewOpenGuard } from '../../../shared/view-open-guard';

describe('createViewOpenGuard', () => {
    it('begin 返回递增代次，旧代次随即失效', () => {
        const guard = createViewOpenGuard();
        const first = guard.begin();
        expect(guard.isCurrent(first)).toBe(true);

        const second = guard.begin();
        expect(second).toBeGreaterThan(first);
        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    it('invalidate 作废当前代次，重复调用无副作用', () => {
        const guard = createViewOpenGuard();
        const token = guard.begin();

        guard.invalidate();
        expect(guard.isCurrent(token)).toBe(false);

        guard.invalidate();
        expect(guard.isCurrent(token)).toBe(false);

        // 重新 onOpen 后拿到新代次，仍可正常工作
        const next = guard.begin();
        expect(guard.isCurrent(next)).toBe(true);
    });

    it('await 期间关闭视图：续体核对发现代次过期，不再继续渲染', async () => {
        const guard = createViewOpenGuard();
        const rendered: string[] = [];

        async function onOpen(close: () => void): Promise<void> {
            const token = guard.begin();
            await Promise.resolve(); // 模拟 restoreChapterState / loadContext
            close(); // 用户在 await 期间关闭视图
            if (!guard.isCurrent(token)) return;
            rendered.push('应被丢弃的渲染');
        }

        await onOpen(() => guard.invalidate());
        expect(rendered).toEqual([]);
    });
});

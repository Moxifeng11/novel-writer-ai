import { describe, it, expect, vi } from 'vitest';
import { detachPluginLeaves } from '../../../shared/plugin-leaves';

/**
 * 卸载时摘除插件视图 leaf（v4.79.0 交叉审计修复）。
 *
 * 背景：`onunload` 此前只关闭 4 类浮窗，7 个主视图 leaf 依赖宿主回收；禁用/热重载后
 * 会留下空白页签。这里钉住「逐个类型调用」「单个类型失败不影响其余」「返回计数」。
 */
describe('detachPluginLeaves', () => {
    it('对每个类型各调用一次并返回处理数量', () => {
        const detachLeavesOfType = vi.fn();
        const count = detachPluginLeaves({ detachLeavesOfType }, [
            'novel-writer-home',
            'novel-writer-full-writer',
            'novel-writer-co-writing',
        ]);

        expect(count).toBe(3);
        expect(detachLeavesOfType).toHaveBeenCalledTimes(3);
        expect(detachLeavesOfType.mock.calls.map((c) => c[0])).toEqual([
            'novel-writer-home',
            'novel-writer-full-writer',
            'novel-writer-co-writing',
        ]);
    });

    it('某个类型抛错时继续处理其余类型，只统计成功的', () => {
        const detachLeavesOfType = vi.fn((type: string) => {
            if (type === 'broken') throw new Error('unknown view type');
        });

        const count = detachPluginLeaves({ detachLeavesOfType }, ['a', 'broken', 'b']);

        expect(count).toBe(2);
        expect(detachLeavesOfType).toHaveBeenCalledTimes(3);
    });

    it('空清单不调用也不报错', () => {
        const detachLeavesOfType = vi.fn();
        expect(detachPluginLeaves({ detachLeavesOfType }, [])).toBe(0);
        expect(detachLeavesOfType).not.toHaveBeenCalled();
    });
});

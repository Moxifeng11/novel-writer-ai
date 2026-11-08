import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { TabController } from '../../../ui/full-writer/tab-controller';

/**
 * TabController.dispose（v4.79.0 交叉审计修复）。
 *
 * 背景：模型快速切换器的句柄只在 `renderTabBar()` 下一次重绘时销毁；完整写作视图
 * 直接关闭时若未 dispose，句柄留在 model-quick-switcher 的模块级 refreshers 集合里，
 * 之后每次模型/供应商变更都会刷新已脱离 DOM 的按钮（随开关次数线性增长）。
 *
 * TabController 的构造依赖很重，这里只针对 dispose 的契约做最小化验证：
 * 通过原型 + Reflect 注入私有句柄，不引入 any。
 */
describe('TabController.dispose', () => {
    function makeController(): { controller: TabController; destroy: ReturnType<typeof vi.fn> } {
        const destroy = vi.fn();
        const controller = Object.create(TabController.prototype) as TabController;
        Reflect.set(controller, 'modelSwitcher', { destroy, refresh: vi.fn(), button: {} });
        return { controller, destroy };
    }

    it('销毁模型切换器并清空句柄', () => {
        const { controller, destroy } = makeController();

        controller.dispose();

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(Reflect.get(controller, 'modelSwitcher')).toBeNull();
    });

    it('没有切换器时 dispose 不抛错（视图打开失败也可能走到 onClose）', () => {
        const controller = Object.create(TabController.prototype) as TabController;
        expect(() => controller.dispose()).not.toThrow();
    });

    it('重复 dispose 只销毁一次（句柄已清空）', () => {
        const { controller, destroy } = makeController();

        controller.dispose();
        controller.dispose();

        expect(destroy).toHaveBeenCalledTimes(1);
    });
});

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * 面板关闭路径此前缺失：`dispose()` 无任何调用方，防抖计时器会带着已脱离 DOM 的
 * 引用继续跑；`persistQualityHistory` 注释里的「force 用于切章/关闭」也没有关闭入口。
 * 这里锁定「先冲刷、再释放、最后走基类收尾」。
 */

type PanelCtx = {
    persistQualityHistory: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    saveLayout: ReturnType<typeof vi.fn>;
    activeProject: string;
    currentBaselineProject: string;
    facade: { getActiveProject: () => string };
    onClose: () => Promise<void>;
};

function makeCtx(): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.persistQualityHistory = vi.fn();
    ctx.dispose = vi.fn();
    // 基类 onClose 会保存布局；这里替换掉避免依赖真实 DOM
    ctx.saveLayout = vi.fn();
    // resolveProject 的原型实现读 activeProject / facade，默认给一个「另一本书」
    ctx.activeProject = '';
    ctx.currentBaselineProject = '';
    ctx.facade = { getActiveProject: () => 'B书' };
    return ctx;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('MonitorPanelB — 关闭时冲刷与释放', () => {
    it('关闭面板先冲刷质量历史，再释放防抖资源，最后走基类收尾', async () => {
        const removeEventListener = vi.fn();
        vi.stubGlobal('document', { removeEventListener });

        const ctx = makeCtx();
        ctx.currentBaselineProject = 'A书';
        await ctx.onClose();

        // 冲刷必须写回「记录所属项目」，而不是关闭时 activeFile 指向的 B 书
        expect(ctx.persistQualityHistory).toHaveBeenCalledWith(true, 'A书');
        expect(ctx.dispose).toHaveBeenCalledTimes(1);
        // 顺序：flush 在 dispose 之前，避免冲刷时的待写任务被取消
        expect(ctx.persistQualityHistory.mock.invocationCallOrder[0])
            .toBeLessThan(ctx.dispose.mock.invocationCallOrder[0]);
        // 基类收尾：摘掉两个 document 监听并保存布局
        expect(removeEventListener).toHaveBeenCalledTimes(2);
        expect(ctx.saveLayout).toHaveBeenCalledTimes(1);
    });

    it('尚无基线项目时回退到当前项目', async () => {
        const removeEventListener = vi.fn();
        vi.stubGlobal('document', { removeEventListener });

        const ctx = makeCtx();
        await ctx.onClose();

        expect(ctx.persistQualityHistory).toHaveBeenCalledWith(true, 'B书');
    });
});

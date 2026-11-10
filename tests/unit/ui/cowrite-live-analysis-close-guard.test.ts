import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LiveAnalysisController } from '../../../ui/cowrite/live-analysis-controller';

/**
 * F1（2026-11-10 维度①审计）：协同写作 onClose 先 clearTimers() 再 await saveBody()，
 * 保存成功的 onSaved 又会 scheduleRefresh('save')；AdaptiveDebounceManager.dispose()
 * 只取消现有定时器、不阻止后续 schedule，于是关闭后的视图继续排实时分析并可能
 * 发 AI 请求。这里锁住「关闭即拒绝排程，重开才恢复」。
 */
type DebounceStub = {
    dispose: ReturnType<typeof vi.fn>;
    debounceFixed: ReturnType<typeof vi.fn>;
};

function makeController(autoPlotEvaluation = false): { controller: LiveAnalysisController; debounce: DebounceStub } {
    const controller = Object.create(LiveAnalysisController.prototype) as LiveAnalysisController;
    const debounce: DebounceStub = { dispose: vi.fn(), debounceFixed: vi.fn() };
    Reflect.set(controller, 'debounceManager', debounce);
    Reflect.set(controller, 'view', {
        rightEditor: { value: '林玄推门而入，屋里只剩一盏灯。'.repeat(10) },
        plugin: { settings: { autoPlotEvaluation } },
    });
    return { controller, debounce };
}

describe('LiveAnalysisController — 关闭后不再排程', () => {
    it('markClosed 清理定时器后，save 触发的再次排程被拒绝', () => {
        const { controller, debounce } = makeController();

        controller.markClosed();
        controller.scheduleRefresh('save');

        expect(debounce.dispose).toHaveBeenCalledTimes(1);
        expect(debounce.debounceFixed).not.toHaveBeenCalled();
    });

    it('markOpened 后恢复排程（视图实例复用时）', () => {
        const { controller, debounce } = makeController();

        controller.markClosed();
        controller.markOpened();
        controller.scheduleRefresh('save');

        expect(debounce.debounceFixed).toHaveBeenCalledWith('live-analysis', expect.any(Function), 500);
        expect(debounce.debounceFixed).toHaveBeenCalledWith('guard-check', expect.any(Function), 1200);
    });

    it('视图接线使用 markClosed（不是只清定时器的 clearTimers）', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../../ui/co-writing-view.ts'), 'utf8');
        expect(src).toContain('this.liveAnalysis.markClosed()');
        expect(src).not.toContain('this.liveAnalysis.clearTimers()');
        expect(src).toContain('this.liveAnalysis.markOpened()');
    });
});

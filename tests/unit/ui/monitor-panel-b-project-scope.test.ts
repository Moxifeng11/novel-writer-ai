import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * 协同写作视图不是 Markdown 文件，`getActiveProject()` 依赖 activeFile，切到该视图后通常为 null；
 * 首次切章时若拿不到项目名，面板 B 会用空串跳过 `restoreQualityHistory` → 整章没有历史/基线。
 * 这里锁定「协同写作同步注入的项目名优先」，以及「无注入 + 无 activeFile 时不恢复任何项目」。
 */

type PanelCtx = {
    completionEngine: object | null;
    completionContent: object | null;
    qualityEngine: object | null;
    divergenceEngine: object | null;
    currentBaselineProject: string;
    currentChapterKey: string;
    baselineHistory: unknown[];
    history: unknown[];
    divergenceHistory: unknown[];
    qualityHistory: unknown[];
    lastResult: unknown;
    lastDivergenceResult: unknown;
    lastQualityResult: unknown;
    debounceManager: { debounceFixed: ReturnType<typeof vi.fn> };
    facade: { getActiveProject: () => string | null };
    persistQualityHistory: ReturnType<typeof vi.fn>;
    restoreQualityHistory: ReturnType<typeof vi.fn>;
    setActiveProject: (project: string) => void;
    updateCompletion: (text: string, chapterKey?: string) => void;
};

function makeCtx(activeFileProject: string | null): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.completionEngine = {};
    ctx.completionContent = {};
    ctx.qualityEngine = null;
    ctx.divergenceEngine = null;
    ctx.currentBaselineProject = '';
    ctx.currentChapterKey = '';
    ctx.baselineHistory = [];
    ctx.history = [];
    ctx.divergenceHistory = [];
    ctx.qualityHistory = [];
    ctx.lastResult = null;
    ctx.lastDivergenceResult = null;
    ctx.lastQualityResult = null;
    ctx.debounceManager = { debounceFixed: vi.fn() };
    ctx.facade = { getActiveProject: () => activeFileProject };
    ctx.persistQualityHistory = vi.fn();
    ctx.restoreQualityHistory = vi.fn();
    return ctx;
}

describe('MonitorPanelB — 质量历史的项目归属', () => {
    it('协同写作同步注入的项目优先于空 activeFile', () => {
        const ctx = makeCtx(null);

        ctx.setActiveProject('B书');
        ctx.updateCompletion('这是一段正文', 'B书-第1章');

        expect(ctx.currentBaselineProject).toBe('B书');
        expect(ctx.baselineHistory).toEqual([]);
        expect(ctx.restoreQualityHistory).toHaveBeenCalledTimes(1);
    });

    it('未注入且 activeFile 为空时不认领任何项目，避免把别的书写进基线', () => {
        const ctx = makeCtx(null);

        ctx.updateCompletion('这是一段正文', 'A书-第1章');

        expect(ctx.currentBaselineProject).toBe('');
    });

    it('activeFile 推导出的项目仍可作为兜底（独立打开面板的场景）', () => {
        const ctx = makeCtx('C书');

        ctx.updateCompletion('这是一段正文', 'C书-第1章');

        expect(ctx.currentBaselineProject).toBe('C书');
    });

    it('项目名两侧空白会被去掉，避免与磁盘路径不一致', () => {
        const ctx = makeCtx(null);

        ctx.setActiveProject('  B书  ');
        ctx.updateCompletion('这是一段正文', 'B书-第1章');

        expect(ctx.currentBaselineProject).toBe('B书');
    });
});

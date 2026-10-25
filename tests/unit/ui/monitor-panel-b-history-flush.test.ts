import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const { appendQualityHistory, loadQualityHistory } = vi.hoisted(() => ({
    appendQualityHistory: vi.fn(() => Promise.resolve()),
    loadQualityHistory: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../../services/quality-history-store', () => ({
    appendQualityHistory,
    loadQualityHistory,
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * 切章冲刷必须写回「记录所属的项目」，而不是刚注入的新项目。
 *
 * 协同写作从 A 书切到 B 书时，`updatePlotCompletion` 会先 `setActiveProject(B)`
 * 再 `updateCompletion(...)`；若冲刷用 resolveProject()，A 书的最后一条质量记录
 * 会被写进 B 书的 `质量历史.json`。
 */

type PanelCtx = {
    app: object;
    completionEngine: object | null;
    completionContent: object | null;
    qualityEngine: object | null;
    divergenceEngine: object | null;
    currentBaselineProject: string;
    currentChapterKey: string;
    baselineHistory: unknown[];
    qualityHistory: unknown[];
    history: unknown[];
    divergenceHistory: unknown[];
    lastQualityPersistAt: number;
    lastResult: unknown;
    lastDivergenceResult: unknown;
    lastQualityResult: unknown;
    debounceManager: { debounceFixed: ReturnType<typeof vi.fn> };
    facade: { getActiveProject: () => string | null };
    restoreQualityHistory: ReturnType<typeof vi.fn>;
    setActiveProject: (project: string) => void;
    updateCompletion: (text: string, chapterKey?: string) => void;
};

function makeRecord() {
    return {
        chapterKey: '第3章',
        timestamp: 1_700_000_000_000,
        wordCount: 1200,
        overallScore: 78,
        languageScore: 80,
        rhythmScore: 75,
        characterScore: 77,
        plotScore: 79,
        atmosphereScore: 76,
        structureScore: 78,
        grade: 'B',
        trend: 'stable',
    };
}

function makeCtx(baselineProject: string, chapterKey: string): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.app = {};
    ctx.completionEngine = {};
    ctx.completionContent = {};
    ctx.qualityEngine = null;
    ctx.divergenceEngine = null;
    ctx.currentBaselineProject = baselineProject;
    ctx.currentChapterKey = chapterKey;
    ctx.baselineHistory = [];
    ctx.qualityHistory = [];
    ctx.history = [];
    ctx.divergenceHistory = [];
    ctx.lastQualityPersistAt = 0;
    ctx.lastResult = null;
    ctx.lastDivergenceResult = null;
    ctx.lastQualityResult = null;
    ctx.debounceManager = { debounceFixed: vi.fn() };
    ctx.facade = { getActiveProject: () => null };
    ctx.restoreQualityHistory = vi.fn();
    return ctx;
}

describe('MonitorPanelB — 切章冲刷的项目归属', () => {
    it('从 A 书切到 B 书时，A 书的最后一条记录仍写回 A 书', () => {
        const record = makeRecord();
        const ctx = makeCtx('A书', 'A书-第3章');
        ctx.qualityHistory = [record];
        ctx.baselineHistory = [record];
        appendQualityHistory.mockClear();

        // 调用方先注入新书，再切章（与 CoWritingView#updatePlotCompletion 一致）
        ctx.setActiveProject('B书');
        ctx.updateCompletion('新书正文', 'B书-第1章');

        expect(appendQualityHistory).toHaveBeenCalledTimes(1);
        const [, project, saved] = appendQualityHistory.mock.calls[0] as unknown as [unknown, string, unknown];
        expect(project).toBe('A书');
        expect(saved).toBe(record);
        // 基线属于 A 书：换书时必须清空，避免污染 B 书基线
        expect(ctx.baselineHistory).toEqual([]);
    });

    it('同书切章时仍写回同一本书', () => {
        const record = makeRecord();
        const ctx = makeCtx('A书', 'A书-第3章');
        ctx.qualityHistory = [record];
        appendQualityHistory.mockClear();

        ctx.setActiveProject('A书');
        ctx.updateCompletion('正文', 'A书-第4章');

        expect(appendQualityHistory).toHaveBeenCalledTimes(1);
        const [, project] = appendQualityHistory.mock.calls[0] as unknown as [unknown, string];
        expect(project).toBe('A书');
    });
});

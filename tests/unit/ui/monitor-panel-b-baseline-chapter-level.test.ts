import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const { appendQualityHistory } = vi.hoisted(() => ({
    appendQualityHistory: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../services/quality-history-store', () => ({
    appendQualityHistory,
    loadQualityHistory: vi.fn(() => Promise.resolve([])),
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * 面板 B 的内存基线样本必须与磁盘同口径：一章一条。
 *
 * `baselineHistory` 是基线比较与章级趋势唯一的样本源，`QUALITY_HISTORY_MAX_RECORDS = 200`
 * 若按「评估次数」计数，同一章约 200 次打字停顿就会把其他章样本全部挤掉，
 * 排除当前章后基线没有样本 → 「高于/低于基线」整行消失。
 */

type PanelCtx = {
    app: object;
    activeProject: string;
    currentChapterKey: string;
    baselineHistory: Array<Record<string, unknown>>;
    qualityHistory: Array<Record<string, unknown>>;
    lastQualityPersistAt: number;
    maxQualityHistory: number;
    QUALITY_PERSIST_INTERVAL: number;
};

function makeCtx(chapterKey: string): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.app = {};
    ctx.activeProject = 'A书';
    ctx.currentChapterKey = chapterKey;
    ctx.baselineHistory = [];
    ctx.qualityHistory = [];
    ctx.lastQualityPersistAt = 0;
    ctx.maxQualityHistory = 20;
    ctx.QUALITY_PERSIST_INTERVAL = 30_000;
    return ctx;
}

function makeResult(score: number, at: number) {
    return {
        wordCount: 1200,
        evaluatedAt: at,
        overallScore: score,
        grade: 'B',
        languageQuality: { score },
        rhythmQuality: { score },
        characterQuality: { score },
        plotQuality: { score },
        atmosphereQuality: { score },
        structureQuality: { score },
    };
}

function makeRecord(chapterKey: string, at: number) {
    return {
        chapterKey,
        timestamp: at,
        wordCount: 1200,
        overallScore: 75,
        languageScore: 75,
        rhythmScore: 75,
        characterScore: 75,
        plotScore: 75,
        atmosphereScore: 75,
        structureScore: 75,
        grade: 'B',
        trend: 'stable',
    };
}

function add(ctx: PanelCtx, score: number, at: number): void {
    (ctx as unknown as { addToQualityHistory: (r: unknown) => void }).addToQualityHistory(makeResult(score, at));
}

function chapterKeys(ctx: PanelCtx): string[] {
    return ctx.baselineHistory.map(entry => String(entry.chapterKey));
}

describe('MonitorPanelB — 内存基线样本按章收敛', () => {
    it('同一章多次评估只保留最后一条，其他章样本不受影响', () => {
        const ctx = makeCtx('第1章');
        ctx.baselineHistory = [makeRecord('第2章', 1), makeRecord('第3章', 2)];

        add(ctx, 70, 1000);
        add(ctx, 80, 2000);
        add(ctx, 90, 3000);

        expect(chapterKeys(ctx).filter(k => k === '第1章')).toHaveLength(1);
        expect(chapterKeys(ctx)).toEqual(['第2章', '第3章', '第1章']);
        const first = ctx.baselineHistory[ctx.baselineHistory.length - 1];
        expect(first.overallScore).toBe(90);
        // 展示用的「最近历史」仍按评估次数保留
        expect(ctx.qualityHistory).toHaveLength(3);
    });

    it('单章高频评估不会把其他章挤出 200 条配额', () => {
        const ctx = makeCtx('第1章');
        ctx.baselineHistory = Array.from({ length: 199 }, (_, i) => makeRecord(`第${i + 2}章`, i));

        for (let i = 0; i < 200; i++) {
            add(ctx, 80, 10_000 + i);
        }

        const keys = chapterKeys(ctx);
        expect(keys.length).toBeLessThanOrEqual(200);
        expect(keys.filter(k => k === '第1章')).toHaveLength(1);
        expect(keys).toContain('第2章');
        expect(keys).toContain('第200章');
    });

    it('没有章键时不合并，避免把不同章节误算成一章', () => {
        const ctx = makeCtx('');

        add(ctx, 70, 1000);
        add(ctx, 80, 2000);

        expect(ctx.baselineHistory).toHaveLength(2);
    });
});

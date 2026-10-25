import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';
import {
    DEVIATION_MIN_EVALUABLE_CHARS,
    PLOT_COMPLETION_MIN_EVALUABLE_CHARS,
} from '../../../shared/thresholds';

/**
 * 完成度 / 偏离引擎在正文过短时返回全 0 空结果：
 * - 完成度 0 分会被展示成「0分 · 待开始」
 * - 偏离 0% 会被展示成「完全贴合大纲」
 * 两者都不是真实结论，面板 B 必须按「无数据」处理，且不能写入会话历史，
 * 否则新开空章会把趋势曲线打成 0。
 *
 * 同时锁定详情面板的复用：render*Summary 里的 empty() 会连带移除详情面板，
 * 展开状态下必须重建，否则每 500ms 一次评估后详情都会消失。
 */

type FakeEl = {
    tag: string;
    text: string;
    cls: string;
    children: FakeEl[];
    detached: boolean;
    empty: () => void;
    createDiv: (opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => FakeEl;
    createSpan: (opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => FakeEl;
    setText: (text: string) => void;
    contains: (el: FakeEl) => boolean;
    remove: () => void;
    allText: () => string;
};

function createFakeEl(tag = 'div'): FakeEl {
    const el: FakeEl = {
        tag,
        text: '',
        cls: '',
        children: [],
        detached: false,
        empty() {
            el.children.length = 0;
            el.text = '';
        },
        createDiv(opts) {
            const child = createFakeEl('div');
            applyOpts(child, opts);
            el.children.push(child);
            return child;
        },
        createSpan(opts) {
            const child = createFakeEl('span');
            applyOpts(child, opts);
            el.children.push(child);
            return child;
        },
        setText(text) {
            el.text = text;
            el.children.length = 0;
        },
        contains(target) {
            return el.children.includes(target);
        },
        remove() {
            el.detached = true;
        },
        allText() {
            return [el.text, ...el.children.map(c => c.allText())].filter(Boolean).join(' | ');
        },
    };
    return el;
}

function applyOpts(el: FakeEl, opts?: { text?: string; cls?: string }): void {
    if (!opts) return;
    if (typeof opts.text === 'string') el.text = opts.text;
    if (opts.cls) el.cls = opts.cls;
}

type PanelCtx = {
    completionEngine: { evaluate: (text: string) => unknown } | null;
    divergenceEngine: { evaluate: (text: string) => unknown } | null;
    completionContent: FakeEl;
    divergenceContent: FakeEl;
    completionDetailPanel: FakeEl | null;
    divergenceDetailPanel: FakeEl | null;
    completionExpanded: boolean;
    divergenceExpanded: boolean;
    currentChapterText: string;
    lastResult: unknown;
    lastDivergenceResult: unknown;
    history: unknown[];
    divergenceHistory: unknown[];
    showDivergenceAlert: (reason: string) => void;
    runCompletionEval: () => void;
    runDivergenceEval: () => void;
    renderCompletionSummary: (result: unknown) => void;
    renderDivergenceSummary: (result: unknown) => void;
    ensureCompletionDetailPanel: () => void;
    ensureDivergenceDetailPanel: () => void;
};

function makeCtx(): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.completionEngine = null;
    ctx.divergenceEngine = null;
    ctx.completionContent = createFakeEl();
    ctx.divergenceContent = createFakeEl();
    ctx.completionDetailPanel = null;
    ctx.divergenceDetailPanel = null;
    ctx.completionExpanded = false;
    ctx.divergenceExpanded = false;
    ctx.currentChapterText = '';
    ctx.lastResult = null;
    ctx.lastDivergenceResult = null;
    ctx.history = [];
    ctx.divergenceHistory = [];
    ctx.showDivergenceAlert = vi.fn();
    return ctx;
}

function completionResult(wordCount: number) {
    const dim = { score: 60, details: {}, suggestions: [] };
    return {
        sceneCompletion: dim,
        goalCompletion: dim,
        characterEngagement: dim,
        foreshadowProgress: dim,
        emotionArcProgress: dim,
        overallCompletion: {
            score: 60,
            details: { wordCount, paragraphs: 2, sentences: 5, evalTimeMs: 1 },
            suggestions: [],
        },
        plotTraction: dim,
        evaluatedAt: Date.now(),
        wordCount,
    };
}

function divergenceResult(wordCount: number) {
    const dim = { score: 10, level: 'normal' as const, details: {}, issues: [], suggestions: [] };
    return {
        mainlineDivergence: dim,
        characterDivergence: dim,
        rhythmDivergence: dim,
        foreshadowDivergence: dim,
        settingDivergence: dim,
        overallDivergence: 10,
        overallLevel: 'normal' as const,
        evaluatedAt: Date.now(),
        wordCount,
        shouldAlert: false,
    };
}

describe('MonitorPanelB — 完成度短正文口径', () => {
    it('正文不足门槛时不写会话历史，摘要显示无数据', () => {
        const ctx = makeCtx();
        const short = PLOT_COMPLETION_MIN_EVALUABLE_CHARS - 1;
        ctx.completionEngine = { evaluate: () => completionResult(short) };

        ctx.runCompletionEval();

        expect(ctx.history).toHaveLength(0);
        const text = ctx.completionContent.allText();
        expect(text).toContain('综合完成度 --');
        expect(text).toContain('暂不评估');
        expect(text).toContain(`当前 ${short} 字`);
        expect(text).not.toContain('0分');
    });

    it('正文达到门槛时正常写入历史', () => {
        const ctx = makeCtx();
        ctx.completionEngine = { evaluate: () => completionResult(800) };

        ctx.runCompletionEval();

        expect(ctx.history).toHaveLength(1);
        expect(ctx.completionContent.allText()).toContain('综合完成度');
    });

    it('展开状态下短正文只写「暂无详情」，不渲染六维', () => {
        const ctx = makeCtx();
        ctx.completionEngine = { evaluate: () => completionResult(20) };
        ctx.completionExpanded = true;

        ctx.runCompletionEval();

        expect(ctx.completionDetailPanel).not.toBeNull();
        expect(ctx.completionDetailPanel!.allText()).toContain('正文过短，暂无完成度详情');
        expect(ctx.completionDetailPanel!.allText()).not.toContain('场景完成度');
    });

    it('长正文展开时，摘要重建后详情面板仍挂在容器上', () => {
        const ctx = makeCtx();
        ctx.completionExpanded = true;
        const existing = createFakeEl();
        existing.cls = 'nw-completion-detail';
        ctx.completionDetailPanel = existing;
        ctx.completionContent.children.push(existing);

        ctx.renderCompletionSummary(completionResult(800));

        expect(ctx.completionDetailPanel).not.toBe(existing);
        expect(ctx.completionContent.contains(ctx.completionDetailPanel!)).toBe(true);
        expect(ctx.completionDetailPanel!.cls).toContain('nw-completion-detail');
    });
});

describe('MonitorPanelB — 偏离短正文口径', () => {
    it('正文不足门槛时不写会话历史、不预警，摘要显示无数据', () => {
        const ctx = makeCtx();
        const short = DEVIATION_MIN_EVALUABLE_CHARS - 1;
        ctx.divergenceEngine = { evaluate: () => divergenceResult(short) };

        ctx.runDivergenceEval();

        expect(ctx.divergenceHistory).toHaveLength(0);
        expect(ctx.showDivergenceAlert).not.toHaveBeenCalled();
        const text = ctx.divergenceContent.allText();
        expect(text).toContain('整体偏离度 --');
        expect(text).toContain('暂不检测');
        expect(text).not.toContain('0%');
    });

    it('正文达到门槛时正常写入历史', () => {
        const ctx = makeCtx();
        ctx.divergenceEngine = { evaluate: () => divergenceResult(800) };

        ctx.runDivergenceEval();

        expect(ctx.divergenceHistory).toHaveLength(1);
    });

    it('展开状态下短正文只写「暂无详情」，不渲染五维', () => {
        const ctx = makeCtx();
        ctx.divergenceEngine = { evaluate: () => divergenceResult(20) };
        ctx.divergenceExpanded = true;

        ctx.runDivergenceEval();

        expect(ctx.divergenceDetailPanel).not.toBeNull();
        expect(ctx.divergenceDetailPanel!.allText()).toContain('正文过短，暂无偏离详情');
        expect(ctx.divergenceDetailPanel!.allText()).not.toContain('主线偏离');
    });

    it('长正文展开时，摘要重建后详情面板仍挂在容器上', () => {
        const ctx = makeCtx();
        ctx.divergenceExpanded = true;
        const existing = createFakeEl();
        existing.cls = 'nw-divergence-detail';
        ctx.divergenceDetailPanel = existing;
        ctx.divergenceContent.children.push(existing);

        ctx.renderDivergenceSummary(divergenceResult(800));

        expect(ctx.divergenceDetailPanel).not.toBe(existing);
        expect(ctx.divergenceContent.contains(ctx.divergenceDetailPanel!)).toBe(true);
        expect(ctx.divergenceDetailPanel!.cls).toContain('nw-divergence-detail');
    });
});

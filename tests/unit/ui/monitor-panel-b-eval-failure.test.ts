import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * 面板 B 的两条评估都是同步本地计算，但引擎内部仍可能抛错（数据形状异常、
 * 正则/分词边界等）。此前两处 catch 只写日志，卡片继续显示上一次的分数——
 * 切章后尤其容易被误读成「当前正文的结论」。失败必须清空旧值并显式告知。
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
    divergenceEngine: { evaluate: (text: string) => unknown } | null;
    qualityEngine: { evaluate: (text: string) => unknown } | null;
    completionEngine: { evaluate: (text: string) => unknown } | null;
    divergenceContent: FakeEl;
    qualityContent: FakeEl;
    completionContent: FakeEl;
    divergenceDetailPanel: FakeEl | null;
    qualityDetailPanel: FakeEl | null;
    completionDetailPanel: FakeEl | null;
    divergenceExpanded: boolean;
    qualityExpanded: boolean;
    completionExpanded: boolean;
    currentChapterText: string;
    divergenceHistory: unknown[];
    qualityHistory: unknown[];
    history: unknown[];
    lastQualityResult: unknown;
    lastDivergenceResult: unknown;
    lastResult: unknown;
    showDivergenceAlert: (reason: string) => void;
    runDivergenceEval: () => void;
    runQualityEval: () => void;
    runCompletionEval: () => void;
};

function makeCtx(): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.divergenceEngine = null;
    ctx.qualityEngine = null;
    ctx.completionEngine = null;
    ctx.divergenceContent = createFakeEl();
    ctx.qualityContent = createFakeEl();
    ctx.completionContent = createFakeEl();
    ctx.divergenceDetailPanel = null;
    ctx.qualityDetailPanel = null;
    ctx.completionDetailPanel = null;
    ctx.divergenceExpanded = false;
    ctx.qualityExpanded = false;
    ctx.completionExpanded = false;
    ctx.currentChapterText = '正文内容。'.repeat(40);
    ctx.divergenceHistory = [];
    ctx.qualityHistory = [];
    ctx.history = [];
    ctx.lastQualityResult = null;
    ctx.lastDivergenceResult = null;
    ctx.lastResult = null;
    ctx.showDivergenceAlert = vi.fn();
    return ctx;
}

describe('MonitorPanelB — 评估异常必须显式告知', () => {
    it('偏离检测抛错时清掉旧结果并显示「整体偏离度 --」', () => {
        const ctx = makeCtx();
        ctx.divergenceContent.setText('整体偏离度 12%');
        ctx.divergenceEngine = {
            evaluate: () => {
                throw new Error('engine boom');
            },
        };

        ctx.runDivergenceEval();

        const text = ctx.divergenceContent.allText();
        expect(text).toContain('整体偏离度 --');
        expect(text).toContain('本次评估失败');
        expect(text).not.toContain('12%');
        expect(ctx.divergenceHistory).toHaveLength(0);
    });

    it('质量评估抛错时清掉旧分数并显示「综合质量 --」', () => {
        const ctx = makeCtx();
        ctx.qualityContent.setText('综合质量 86分');
        ctx.qualityEngine = {
            evaluate: () => {
                throw new Error('engine boom');
            },
        };

        ctx.runQualityEval();

        const text = ctx.qualityContent.allText();
        expect(text).toContain('综合质量 --');
        expect(text).toContain('本次评估失败');
        expect(text).not.toContain('86分');
        expect(ctx.qualityHistory).toHaveLength(0);
    });

    it('完成度评估抛错时清掉旧分数并显示「综合完成度 --」', () => {
        const ctx = makeCtx();
        ctx.completionContent.setText('综合完成度 78分');
        ctx.completionEngine = {
            evaluate: () => {
                throw new Error('engine boom');
            },
        };

        ctx.runCompletionEval();

        const text = ctx.completionContent.allText();
        expect(text).toContain('综合完成度 --');
        expect(text).toContain('本次评估失败');
        expect(text).not.toContain('78分');
        expect(ctx.history).toHaveLength(0);
    });

    it('展开状态下偏离失败只写「暂无偏离详情」，不再显示旧维度', () => {
        const ctx = makeCtx();
        ctx.divergenceExpanded = true;
        ctx.divergenceEngine = {
            evaluate: () => {
                throw new Error('engine boom');
            },
        };

        ctx.runDivergenceEval();

        expect(ctx.divergenceDetailPanel).toBeTruthy();
        expect(ctx.divergenceDetailPanel?.allText()).toContain('本次评估失败，暂无偏离详情');
    });
});

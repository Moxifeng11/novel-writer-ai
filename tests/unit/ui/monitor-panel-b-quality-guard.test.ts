import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

/**
 * WritingQualityEngine 在正文 < QUALITY_MIN_EVALUABLE_CHARS 时返回 0 分 / D 的空结果。
 * 面板 B 必须把它当「无法评估」处理：不能渲染 0 分、不能让基线判成「低于」、
 * 展开详情时也不能渲染成六维全 0。
 *
 * 同时锁定详情面板的复用：renderQualitySummary 里的 qualityContent.empty()
 * 会连带把详情面板移出 DOM，展开状态下必须重建，否则详情每次评估后都会消失。
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
    qualityContent: FakeEl;
    qualityDetailPanel: FakeEl | null;
    qualityExpanded: boolean;
    currentChapterKey: string;
    baselineHistory: unknown[];
    renderQualityNoData: (wordCount: number) => void;
    renderQualitySummary: (result: unknown) => void;
    renderQualityDetail: (result: unknown) => void;
    ensureQualityDetailPanel: () => void;
};

function makeCtx(): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.qualityContent = createFakeEl();
    ctx.qualityDetailPanel = null;
    ctx.qualityExpanded = false;
    ctx.currentChapterKey = '第1章';
    ctx.baselineHistory = [];
    return ctx;
}

function qualityResult(wordCount: number) {
    const dim = { score: 80, details: {}, suggestions: [] };
    return {
        wordCount,
        overallScore: 80,
        grade: 'B',
        evalTimeMs: 12,
        comparedToAverage: 0,
        evaluatedAt: Date.now(),
        languageQuality: dim,
        rhythmQuality: dim,
        characterQuality: dim,
        plotQuality: dim,
        atmosphereQuality: dim,
        structureQuality: dim,
        topSuggestions: [],
    };
}

describe('MonitorPanelB — 正文不足可评估长度时的展示口径', () => {
    it('短正文不渲染分数，直接走「无数据」分支', () => {
        const ctx = makeCtx();
        const noData = vi.fn();
        ctx.renderQualityNoData = noData;

        ctx.renderQualitySummary(qualityResult(50));

        expect(noData).toHaveBeenCalledWith(50);
        // 摘要区不得留下任何分数/基线节点
        expect(ctx.qualityContent.children).toHaveLength(0);
    });

    it('「无数据」分支显示 -- 与原因，不出现 0 分', () => {
        const ctx = makeCtx();

        ctx.renderQualitySummary(qualityResult(50));

        const text = ctx.qualityContent.allText();
        expect(text).toContain('综合质量 --');
        expect(text).toContain('暂不评估');
        expect(text).toContain('当前 50 字');
        expect(text).not.toContain('0 分');
        // 未展开时不创建详情面板
        expect(ctx.qualityDetailPanel).toBeNull();
    });

    it('展开状态下短正文只写「暂无详情」，不渲染六维', () => {
        const ctx = makeCtx();
        ctx.qualityExpanded = true;
        ctx.qualityDetailPanel = createFakeEl();
        ctx.qualityContent.children.push(ctx.qualityDetailPanel);

        ctx.renderQualitySummary(qualityResult(50));

        expect(ctx.qualityDetailPanel).not.toBeNull();
        const text = ctx.qualityDetailPanel!.allText();
        expect(text).toContain('正文过短，暂无质量详情');
        expect(text).not.toContain('语言质量');
        // 摘要区同时给出原因，详情区只说明没有内容
        expect(ctx.qualityContent.allText()).toContain('暂不评估');
    });

    it('ensureQualityDetailPanel 在节点已挂载时复用，不重复创建', () => {
        const ctx = makeCtx();
        const existing = createFakeEl();
        existing.cls = 'nw-quality-detail';
        ctx.qualityContent.children.push(existing);
        ctx.qualityDetailPanel = existing;

        ctx.ensureQualityDetailPanel();

        expect(ctx.qualityDetailPanel).toBe(existing);
        expect(ctx.qualityContent.children).toHaveLength(1);
    });

    it('ensureQualityDetailPanel 在节点已脱离 DOM 时重建', () => {
        const ctx = makeCtx();
        const detached = createFakeEl();
        detached.detached = true;
        ctx.qualityDetailPanel = detached;

        ctx.ensureQualityDetailPanel();

        expect(ctx.qualityDetailPanel).not.toBe(detached);
        expect(ctx.qualityContent.contains(ctx.qualityDetailPanel!)).toBe(true);
        expect(ctx.qualityContent.children).toHaveLength(1);
    });

    it('长正文展开时，摘要重建后详情面板仍挂在容器上', () => {
        const ctx = makeCtx();
        ctx.qualityExpanded = true;
        ctx.qualityDetailPanel = createFakeEl();
        ctx.qualityContent.children.push(ctx.qualityDetailPanel);

        ctx.renderQualitySummary(qualityResult(800));

        // empty() 会清空子节点：详情面板引用必须指向重新挂载的新节点
        expect(ctx.qualityDetailPanel).not.toBeNull();
        expect(ctx.qualityContent.contains(ctx.qualityDetailPanel!)).toBe(true);
        expect(ctx.qualityDetailPanel!.cls).toContain('nw-quality-detail');
    });
});

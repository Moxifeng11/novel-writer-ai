/**
 * book-detail-renderer-tabs2.test.ts — 节奏页签与概览页签渲染回归（阶段 D2 / DSH-20261112-11）
 *
 * 与 tabs 测试同一范式：注入 deps + 假 DOM 直跑 renderBookRhythmTab /
 * renderBookOverviewTab。节奏页签是 SmartChart 多视图路径首次被单测覆盖的地方。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { BookDetailRenderer, type BookDetailRendererDeps } from '../../../ui/views/book-detail-renderer';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';

function makeDeps(overrides: Partial<BookDetailRendererDeps> = {}): BookDetailRendererDeps {
    return {
        app: {} as never,
        getKb: () => null,
        getKbManager: () => null,
        getStyleData: () => null,
        getRhythmData: () => null,
        getTechniqueData: () => null,
        getStructureData: () => null,
        getCharacterData: () => null,
        getForeshadowData: () => null,
        getCommercialData: () => null,
        getReadabilityData: () => null,
        getCurrentBook: () => undefined,
        formatWordCount: (n?: number) => `${n ?? 0} 字`,
        formatDateTime: () => '2026-01-02 03:04',
        formatDuration: (ms: number) => `${ms}ms`,
        getChannelLabel: (c: string) => c,
        getStatusLabel: (s: string) => s,
        getDeconstructionScheduler: () => null,
        getExpandedItems: () => ({}),
        getForeshadowFilter: () => 'all',
        setForeshadowFilter: () => {},
        getDimensionLabels: () => ({}) as never,
        onClassifyBook: async () => {},
        ...overrides,
    } as unknown as BookDetailRendererDeps;
}

function rhythmData() {
    return {
        stats: { avgRhythm: 0.62, climaxCount: 3, coolPointCount: 5, hookRate: 0.65, avgTension: 0.55 },
        emotionPoints: [
            { chapterIndex: 1, intensity: 0.7, type: 'reversal', position: 0.1, description: '灭门反转' },
            { chapterIndex: 2, intensity: 0.4, type: 'trough', position: 0.3, description: '流亡低谷' },
        ],
        chapterRhythm: [{ chapterIndex: 1, emotionScore: 0.7, tensionScore: 0.6, densityScore: 0.5 }],
        coolPoints: [{ x: 10, y: 80, label: '金手指爆发' }],
        plotStages: [{ name: '铺垫', start: 0, end: 30 }],
        structureMatches: [{ label: '三幕式', value: 80 }],
        hookAnalysis: { typeDistribution: { 悬念: 2, 冲突: 1 }, hookRate: 0.65, noHookChapters: [2, 3], avgIntensity: 0.7 },
    };
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('renderBookRhythmTab', () => {
    it('无数据：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookRhythmTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('节奏分析数据');
    });

    it('完整节奏数据：统计/情绪曲线/类型分布/章节评分/散点/爽点/阶段/钩子全渲染', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getCurrentBook: () => ({ id: 'b1', name: '赤潮', wordCount: 120000 } as never),
            getRhythmData: () => rhythmData() as never,
        })).renderBookRhythmTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('基于全书 120000 字');
        expect(text).toContain('节奏统计摘要');
        expect(text).toContain('0.62'); // avgRhythm.toFixed(2)
        expect(text).toContain('高潮点');
        expect(text).toContain('钩子率');
        expect(text).toContain('65.0%'); // hookRate*100.toFixed(1)
        expect(text).toContain('情绪变化曲线');
        expect(text).toContain('章节节奏评分');
        expect(text).toContain('节奏事件分布 (2)');
        expect(text).toContain('爽点/燃点分布 (1)');
        expect(text).toContain('未分类 · 位置 10.0%'); // coolPoint 无 category → 未分类
        expect(text).toContain('金手指爆发');
        expect(text).toContain('铺垫 (0% - 30%)');
        expect(text).toContain('钩子分析');
        expect(text).toContain('无钩子章节: 2 章');
        expect(text).toContain('平均强度: 0.70');
        // 情绪类型与折线在 SVG（innerHTML 拼接）
        const htmls = collectHtml(root).join('\n');
        expect(htmls).toContain('<svg');
    });

    it('钩子率缺失：给 - 占位而不是 NaN', () => {
        const data = rhythmData() as { stats: Record<string, unknown> };
        delete data.stats.hookRate;
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({ getRhythmData: () => data as never }))
            .renderBookRhythmTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('-');
        expect(root.allText()).not.toContain('NaN');
    });
});

describe('renderBookOverviewTab', () => {
    const book = {
        id: 'b1',
        name: '赤潮',
        author: '林三',
        wordCount: 120000,
        createdAt: Date.UTC(2026, 0, 2),
        updatedAt: Date.UTC(2026, 0, 3),
        breakdownStatus: 'completed',
        synopsis: '少年在末法时代重启修行文明。',
        qualityScores: { character: 80, foreshadow: 70, technique: 75, style: 66, rhythm: 72, structure: 78, overall: 74 },
    } as unknown as BookBasicInfo;

    it('概览：简介/题材分类/质量评分/拆解维度全渲染，无知识库时流派名给「未分类」', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({ getCurrentBook: () => book }))
            .renderBookOverviewTab(root as unknown as HTMLElement, book);

        const text = root.allText();
        expect(text).toContain('简介');
        expect(text).toContain('少年在末法时代重启修行文明。');
        expect(text).toContain('题材分类');
        expect(text).toContain('未分类');
        expect(text).toContain('🔍 自动分类');
        expect(text).toContain('✏️ 编辑');
        expect(text).toContain('质量评分');
        expect(text).toContain('拆解维度');
        expect(text).toContain('风格分析');
        expect(text).toContain('伏笔梳理');
        expect(text).toContain('拆解状态');
    });

    it('拆解中且有进度发射器：渲染进度条/当前步骤/耗时/剩余', () => {
        const scheduler = {
            getActiveTasks: () => [{ id: 't1', bookId: 'b1' }],
            getTaskEmitter: (id: string) => id === 't1'
                ? { getState: () => ({ progress: 45.6, currentStep: '风格分析', message: '正在统计句长', elapsed: 12000, eta: 8000 }) }
                : undefined,
        };
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getCurrentBook: () => ({ ...book, breakdownStatus: 'processing' }),
            getDeconstructionScheduler: () => scheduler as never,
        })).renderBookOverviewTab(root as unknown as HTMLElement, { ...book, breakdownStatus: 'processing' });

        const text = root.allText();
        expect(text).toContain('拆解进度：46%');
        expect(text).toContain('📍 风格分析');
        expect(text).toContain('正在统计句长');
        expect(text).toContain('⏱️ 已用：12000ms');
        expect(text).toContain('⏳ 剩余：8000ms');
    });

    it('拆解中但任务不在跑：不出现进度条，维度网格照常', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getCurrentBook: () => ({ ...book, breakdownStatus: 'processing' }),
        })).renderBookOverviewTab(root as unknown as HTMLElement, { ...book, breakdownStatus: 'processing' });
        expect(root.allText()).not.toContain('拆解进度');
        expect(root.allText()).toContain('风格分析');
    });
});

/** 收集子树里的 innerHTML（图表 SVG 走 sanitize 替身拼接） */
function collectHtml(el: FakeEl): string[] {
    return [el.innerHTML, ...el.children.flatMap(c => collectHtml(c))].filter(Boolean);
}

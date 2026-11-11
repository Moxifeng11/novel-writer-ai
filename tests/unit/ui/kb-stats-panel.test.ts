/**
 * kb-stats-panel.test.ts — 质量统计页签 DOM 构建回归（阶段 D2 / DSH-20261112-07）
 *
 * 统计口径与分布数据由 kb-panels-logic 承担（已有单测），这里锁的是三种
 * 「数据为空/非空」组合下的页面结构：无已拆解书籍时不出现质量分布区、
 * 无题材数据时给占位文案、无状态数据时环图不出现但图例仍在。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv } from './support/fake-dom';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';

let buildKbStatsPanel: typeof import('../../../ui/views/kb-stats-panel').buildKbStatsPanel;

function book(overrides: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: 'b1',
        name: '赤潮',
        themeTags: [],
        techniqueTags: [],
        customTags: [],
        createdAt: 1,
        updatedAt: 1,
        breakdownStatus: 'completed',
        ...overrides,
    } as BookBasicInfo;
}

function makeHost(books: BookBasicInfo[], genreName: (id?: string) => string = id => id ?? '未分类') {
    const charts: string[] = [];
    return {
        charts,
        host: {
            allBooks: books,
            renderChart: (_container: HTMLElement, svgHtml: string) => { charts.push(svgHtml); },
            getGenreName: genreName,
        },
    };
}

beforeEach(async () => {
    stubCreateDiv();
    ({ buildKbStatsPanel } = await import('../../../ui/views/kb-stats-panel'));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildKbStatsPanel 结构', () => {
    it('先清空容器再重建，标题固定为「质量统计」', () => {
        const root = new FakeEl('div');
        root.createDiv({ text: '旧内容' });
        const { host } = makeHost([]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).not.toContain('旧内容');
        expect(root.findAll('nw-kb-stats-tab')).toHaveLength(1);
        expect(root.allText()).toContain('质量统计');
    });

    it('概览四张指标卡按 icon/value/label 渲染', () => {
        const root = new FakeEl('div');
        const { host } = makeHost([book()]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        const grid = root.findAll('nw-u-gtc-repeat-4-1fr')[0];
        expect(grid.children).toHaveLength(4);
        expect(grid.children[0].children).toHaveLength(3); // icon / value / label
    });

    it('无已拆解书籍：不出现「各维度质量分布」区', () => {
        const root = new FakeEl('div');
        const { host } = makeHost([book({ breakdownStatus: 'pending' })]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).not.toContain('各维度质量分布');
    });

    it('有已拆解书籍：雷达图 + 每维度平均分横条', () => {
        const root = new FakeEl('div');
        const { host, charts } = makeHost([book({ qualityScores: { overall: 80 } as BookBasicInfo['qualityScores'] })]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).toContain('各维度质量分布');
        // 雷达图 + 题材柱状图 + 状态环图
        expect(charts.length).toBeGreaterThanOrEqual(2);
        expect(charts[0]).toContain('<svg');
        expect(root.allText()).toMatch(/分/);
    });
});

describe('buildKbStatsPanel 空数据分支', () => {
    it('无题材数据：给占位文案且不画柱状图', () => {
        const root = new FakeEl('div');
        const { host, charts } = makeHost([]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).toContain('暂无题材数据');
        expect(charts).toHaveLength(0);
    });

    it('题材存在但名称为空：仍按回退名渲染柱状图', () => {
        const root = new FakeEl('div');
        const { host, charts } = makeHost([book({ breakdownStatus: 'pending', primaryGenre: 'g1' })], () => '');

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).not.toContain('暂无题材数据');
        // 柱状图 + 状态环图（无已拆解书籍 → 无雷达图）
        expect(charts.length).toBe(2);
        expect(charts.some(svg => svg.includes('Top 10'))).toBe(true);
    });

    it('拆解状态分布：图例逐条渲染 label 与数量', () => {
        const root = new FakeEl('div');
        const { host } = makeHost([
            book({ breakdownStatus: 'completed' }),
            book({ id: 'b2', breakdownStatus: 'completed' }),
            book({ id: 'b3', breakdownStatus: 'failed' }),
        ]);

        buildKbStatsPanel(root as unknown as HTMLElement, host as never);

        expect(root.allText()).toContain('拆解状态分布');
        // 两条图例（完成 / 失败），数值分别为 2 与 1
        const legend = root.findAll('nw-u-fwt-600').map(el => el.textContent);
        expect(legend).toContain('2');
        expect(legend).toContain('1');
    });
});

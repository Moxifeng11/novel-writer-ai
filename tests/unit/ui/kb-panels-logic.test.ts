/**
 * kb-panels-logic 单测（v4.83.0 UI 可测性治理）
 *
 * `kb-detail-actions.ts` 与 `kb-stats-panel.ts` 原本覆盖率 0%——按钮该不该出现、
 * 统计卡该显示什么数字，都埋在 createElement 里，只能打开知识库逐本书人工确认。
 * 本文件锁定这两块面板的规则：状态→按钮、统计聚合、分布口径。
 */

import { describe, expect, it } from 'vitest';
import type { BookBasicInfo, QualityScores } from '../../../services/knowledge-base-manager';
import {
    KB_QUALITY_DIMENSIONS,
    KB_STATUS_STYLES,
    resolveDetailActionButtons,
    selectCompletedBooks,
    computeAverageQuality,
    buildStatsOverviewCards,
    computeDimensionAverages,
    aggregateGenreCounts,
    buildGenreBarData,
    computeStatusCounts,
    buildStatusDonutData,
    buildStatusLegendData,
} from '../../../ui/views/kb-panels-logic';

/** 构造只含所需字段的书籍 */
function book(partial: Partial<BookBasicInfo> & { id?: string }): BookBasicInfo {
    return {
        id: partial.id ?? 'b1',
        name: partial.name ?? '书',
        author: partial.author ?? '作者',
        wordCount: partial.wordCount ?? 1000,
        breakdownStatus: partial.breakdownStatus ?? 'pending',
        createdAt: partial.createdAt ?? 0,
        customTags: partial.customTags ?? [],
        ...partial,
    } as BookBasicInfo;
}

/** 构造质量分（六个维度 + overall） */
function quality(overall: number, fill = overall): QualityScores {
    return {
        overall,
        character: fill,
        foreshadow: fill,
        technique: fill,
        style: fill,
        rhythm: fill,
        structure: fill,
        vectorEnabled: true,
    } as QualityScores;
}

describe('resolveDetailActionButtons — 状态 → 按钮', () => {
    const keys = (status: string, busy = false): string[] =>
        resolveDetailActionButtons(status, busy).map(b => b.key);

    it('pending → 开始拆解（主按钮）', () => {
        const [start] = resolveDetailActionButtons('pending', false);
        expect(start.key).toBe('start-deconstruction');
        expect(start.text).toBe('🚀 开始拆解');
        expect(start.cls).toContain('nw-btn-primary');
        expect(start.disabled).toBe(false);
    });

    it('failed → 重新拆解为主按钮；completed → 重新拆解为次按钮', () => {
        const failed = resolveDetailActionButtons('failed', false)[0];
        const completed = resolveDetailActionButtons('completed', false)[0];
        expect(failed.key).toBe('restart-deconstruction');
        expect(failed.cls).toContain('nw-btn-primary');
        expect(completed.key).toBe('restart-deconstruction');
        expect(completed.cls).toContain('nw-btn-secondary');
    });

    it('processing → 禁用指示 + 强制取消', () => {
        const buttons = resolveDetailActionButtons('processing', false);
        expect(buttons[0].key).toBe('processing-indicator');
        expect(buttons[0].disabled).toBe(true);
        expect(buttons[0].text).toBe('⏳ 拆解中...');
        expect(buttons[1].key).toBe('force-cancel');
        expect(buttons[1].text).toBe('⚠️ 强制取消');
    });

    it('interrupted → 恢复拆解（警示色）+ 清除状态', () => {
        const buttons = resolveDetailActionButtons('interrupted', false);
        expect(buttons[0].key).toBe('resume-deconstruction');
        expect(buttons[0].cls).toContain('nw-btn-warning');
        expect(buttons[1].key).toBe('clear-status');
    });

    it('拆解在途时开始/重试按钮变准备中且禁用', () => {
        for (const status of ['pending', 'failed', 'completed']) {
            const first = resolveDetailActionButtons(status, true)[0];
            expect(first.text, status).toBe('⏳ 准备中...');
            expect(first.disabled, status).toBe(true);
        }
    });

    it('尾部固定按钮在任何状态都存在且顺序恒定', () => {
        for (const status of ['pending', 'processing', 'interrupted', 'unknown-status']) {
            const tail = keys(status).slice(-3);
            expect(tail, status).toEqual(['dimension-tags', 'edit', 'delete']);
        }
        // 未知状态只有尾部三个
        expect(keys('unknown-status')).toHaveLength(3);
    });

    it('删除按钮用危险样式', () => {
        const del = resolveDetailActionButtons('pending', false).find(b => b.key === 'delete');
        expect(del?.cls).toContain('nw-btn-danger');
    });
});

describe('selectCompletedBooks — 统计口径', () => {
    it('只收 completed 且有质量分的书', () => {
        const list = [
            book({ id: 'a', breakdownStatus: 'completed', qualityScores: quality(80) }),
            book({ id: 'b', breakdownStatus: 'completed' }),                 // 无质量分，排除
            book({ id: 'c', breakdownStatus: 'processing', qualityScores: quality(90) }),
            book({ id: 'd', breakdownStatus: 'failed', qualityScores: quality(70) }),
        ];
        expect(selectCompletedBooks(list).map(b => b.id)).toEqual(['a']);
    });

    it('空输入返回空数组', () => {
        expect(selectCompletedBooks(undefined)).toEqual([]);
        expect(selectCompletedBooks([])).toEqual([]);
    });
});

describe('computeAverageQuality / buildStatsOverviewCards', () => {
    it('无书时平均分显示 -', () => {
        expect(computeAverageQuality([])).toBe('-');
        expect(computeAverageQuality(undefined)).toBe('-');
    });

    it('平均分保留一位小数', () => {
        const books = [book({ qualityScores: quality(80) }), book({ qualityScores: quality(90) })];
        expect(computeAverageQuality(books)).toBe('85.0');
        const books2 = [book({ qualityScores: quality(80) }), book({ qualityScores: quality(81) })];
        expect(computeAverageQuality(books2)).toBe('80.5');
    });

    it('概览四张卡顺序与文案固定', () => {
        const cards = buildStatsOverviewCards([
            book({ breakdownStatus: 'completed', qualityScores: quality(80) }),
            book({ breakdownStatus: 'processing' }),
        ]);
        expect(cards.map(c => c.label)).toEqual(['书籍总数', '已拆解', '拆解中', '平均质量分']);
        expect(cards.map(c => c.value)).toEqual(['2', '1', '1', '80.0']);
    });

    it('空列表时数值归零且平均分为 -', () => {
        expect(buildStatsOverviewCards([]).map(c => c.value)).toEqual(['0', '0', '0', '-']);
    });
});

describe('computeDimensionAverages — 六维均分', () => {
    it('维度数量与顺序固定', () => {
        expect(KB_QUALITY_DIMENSIONS.map(d => d.label)).toEqual(['人设', '伏笔', '技巧', '风格', '节奏', '结构']);
    });

    it('逐维求平均', () => {
        const a = book({ qualityScores: { ...quality(0, 0), character: 80, foreshadow: 60 } as QualityScores });
        const b = book({ qualityScores: { ...quality(0, 0), character: 40, foreshadow: 40 } as QualityScores });
        const avgs = computeDimensionAverages([a, b]);
        expect(avgs.find(d => d.key === 'character')?.avg).toBe(60);
        expect(avgs.find(d => d.key === 'foreshadow')?.avg).toBe(50);
    });

    it('无书时每维为 0（不产生 NaN）', () => {
        const avgs = computeDimensionAverages([]);
        expect(avgs).toHaveLength(6);
        expect(avgs.every(d => d.avg === 0)).toBe(true);
        expect(avgs.every(d => Number.isFinite(d.avg))).toBe(true);
    });
});

describe('aggregateGenreCounts / buildGenreBarData — 题材分布', () => {
    it('按题材聚合、降序、忽略无题材', () => {
        const list = [
            book({ primaryGenre: 'xuanhuan' }),
            book({ primaryGenre: 'xuanhuan' }),
            book({ primaryGenre: 'dushi' }),
            book({}),
        ];
        expect(aggregateGenreCounts(list)).toEqual([
            { id: 'xuanhuan', count: 2 },
            { id: 'dushi', count: 1 },
        ]);
    });

    it('柱状图取前 10 并用宿主名称', () => {
        const list = Array.from({ length: 12 }, (_, i) => book({ primaryGenre: `g${i}` }));
        const data = buildGenreBarData(list, id => `题材-${id}`);
        expect(data).toHaveLength(10);
        expect(data[0].label).toBe('题材-g0');
    });

    it('空输入返回空数组', () => {
        expect(aggregateGenreCounts(undefined)).toEqual([]);
        expect(buildGenreBarData([], id => id)).toEqual([]);
    });
});

describe('computeStatusCounts / 状态分布', () => {
    const list = [
        book({ breakdownStatus: 'pending' }),
        book({ breakdownStatus: 'pending' }),
        book({ breakdownStatus: 'completed' }),
        book({ breakdownStatus: 'failed' }),
        book({ breakdownStatus: 'weird' as unknown as BookBasicInfo['breakdownStatus'] }),   // 未知状态不计入
    ];

    it('五种状态计数，未知状态忽略', () => {
        expect(computeStatusCounts(list)).toEqual({
            pending: 2, processing: 0, completed: 1, failed: 1, interrupted: 0,
        });
    });

    it('环图过滤 0 值，图例保留 0 值', () => {
        const counts = computeStatusCounts(list);
        const donut = buildStatusDonutData(counts);
        const legend = buildStatusLegendData(counts);
        expect(donut.every(d => d.value > 0)).toBe(true);
        expect(donut).toHaveLength(3);
        expect(legend).toHaveLength(5);
        expect(legend.find(l => l.label === '拆解中')?.value).toBe(0);
    });

    it('配色与顺序固定', () => {
        expect(KB_STATUS_STYLES.map(s => s.label)).toEqual(['待拆解', '拆解中', '已完成', '失败', '拆解中断']);
        expect(KB_STATUS_STYLES.map(s => s.color)).toEqual(['#f59e0b', '#3b82f6', '#2ecc71', '#e74c3c', '#f97316']);
    });
});

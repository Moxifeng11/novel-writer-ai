/**
 * four-check-trend.test.ts — 四项校验历史趋势（P1-1，2026-11-25）
 *
 * 锁四件事：
 * 1. **取尾 N 章**：按输入（自然序）取末尾，即书内进度最新的 N 章（不是按写入时间）；
 * 2. **四项固定顺序**：每行 statuses 恒为 字数/格式/视角/钩子 四格，缺项补 skip；
 * 3. **文本形态**：行文本含章名、四图标、待关注计数，时间可选；
 * 4. **空态**：无记录时返回空数组（面板走占位文案）。
 */
import { describe, expect, it } from 'vitest';
import {
    FOUR_CHECK_ORDER,
    FOUR_CHECK_TREND_LIMIT,
    buildFourCheckTrend,
    describeFourCheckTrendRow,
    describeFourCheckTrendTitle,
    type FourCheckReport,
    type FourCheckStatus,
} from '../../../shared/chapter-four-checks-model';

/** 构造一份最小报告：只给指定四项的状态 */
function report(chapterName: string, statuses: [FourCheckStatus, FourCheckStatus, FourCheckStatus, FourCheckStatus], checkedAt = 1000): FourCheckReport {
    const labels: Record<string, string> = { wordCount: '字数', format: '格式', perspective: '视角', hook: '钩子' };
    const items = FOUR_CHECK_ORDER.map((id, index) => ({
        id,
        label: labels[id],
        status: statuses[index],
        message: `${labels[id]} ${statuses[index]}`,
    }));
    return {
        chapterName,
        checkedAt,
        items,
        warnCount: items.filter(item => item.status === 'warn' || item.status === 'fail').length,
        summary: '四项校验',
    };
}

/** 按自然序构造 N 章（模拟 FourCheckStore.view 的返回顺序） */
function viewOf(count: number, statuses: [FourCheckStatus, FourCheckStatus, FourCheckStatus, FourCheckStatus] = ['pass', 'pass', 'pass', 'pass']) {
    const view: Record<string, FourCheckReport> = {};
    for (let i = 1; i <= count; i += 1) view[`第${i}章`] = report(`第${i}章`, statuses, 1000 + i);
    return view;
}

describe('四项校验历史趋势（P1-1）', () => {
    it('取末尾 N 章（自然序 = 书内最新进度）', () => {
        const trend = buildFourCheckTrend(viewOf(15), 10);
        expect(trend).toHaveLength(10);
        expect(trend[0].chapterName).toBe('第6章');
        expect(trend[9].chapterName).toBe('第15章');
    });

    it('章数不足 N 时全量返回', () => {
        const trend = buildFourCheckTrend(viewOf(3), 10);
        expect(trend.map(row => row.chapterName)).toEqual(['第1章', '第2章', '第3章']);
    });

    it('最大章数缺省为 FOUR_CHECK_TREND_LIMIT', () => {
        expect(FOUR_CHECK_TREND_LIMIT).toBe(10);
        expect(buildFourCheckTrend(viewOf(20))).toHaveLength(10);
    });

    it('每行按四项固定顺序，缺项补 skip', () => {
        const view: Record<string, FourCheckReport> = {
            '第1章': report('第1章', ['pass', 'warn', 'pass', 'skip']),
        };
        const [row] = buildFourCheckTrend(view);
        expect(row.statuses).toHaveLength(4);
        expect(row.statuses[1]).toBe('warn');
        expect(row.statuses[3]).toBe('skip');

        // 缺 format/perspective/hook 项的报告
        const partial: FourCheckReport = {
            chapterName: '第2章', checkedAt: 2, warnCount: 0, summary: 'x',
            items: [{ id: 'wordCount', label: '字数', status: 'pass', message: 'ok' }],
        };
        const [partialRow] = buildFourCheckTrend({ '第2章': partial });
        expect(partialRow.statuses).toEqual(['pass', 'skip', 'skip', 'skip']);
    });

    it('行文本：章名 + 四图标 + 待关注计数（时间可选）', () => {
        const view: Record<string, FourCheckReport> = {
            '第3章': report('第3章', ['pass', 'pass', 'warn', 'pass'], 5000),
        };
        const [row] = buildFourCheckTrend(view);
        expect(describeFourCheckTrendRow(row, '')).toBe('第3章  ✅✅⚠️✅  1 项待关注');
        expect(describeFourCheckTrendRow(row, '11-25 10:05')).toBe('第3章  ✅✅⚠️✅  1 项待关注（11-25 10:05）');
    });

    it('全部通过时显示「全部通过」而不是 0 项待关注', () => {
        const view: Record<string, FourCheckReport> = {
            '第1章': report('第1章', ['pass', 'pass', 'pass', 'pass']),
        };
        const [row] = buildFourCheckTrend(view);
        expect(describeFourCheckTrendRow(row, '')).toContain('全部通过');
    });

    it('空态：无记录返回空数组', () => {
        expect(buildFourCheckTrend({})).toEqual([]);
    });

    it('标题带上实际章数', () => {
        expect(describeFourCheckTrendTitle(7)).toBe('最近 7 章四项校验');
    });
});

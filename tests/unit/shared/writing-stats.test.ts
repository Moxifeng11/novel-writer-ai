import { describe, expect, it } from 'vitest';
import {
    addDays,
    buildReport,
    computeStreak,
    createEmptyWritingStats,
    dailySeries,
    formatWords,
    localDayKey,
    monthlySeries,
    normalizeWritingStats,
    pruneMissingFiles,
    recordFileWords,
    startOfWeek,
    summarize,
    weeklySeries,
} from '../../../shared/writing-stats';

/** 固定「现在」：2026-11-01 是周日，本周一为 2026-10-26 */
const NOW = new Date(2026, 10, 1, 15, 30, 0).getTime();

describe('日期口径', () => {
    it('日期键用本地时区', () => {
        expect(localDayKey(new Date(2026, 10, 1, 0, 0, 0))).toBe('2026-11-01');
        expect(localDayKey(new Date(2026, 10, 1, 23, 59, 59))).toBe('2026-11-01');
    });

    it('周一为一周起点', () => {
        expect(localDayKey(startOfWeek(NOW))).toBe('2026-10-26');
        expect(localDayKey(startOfWeek(new Date(2026, 9, 26)))).toBe('2026-10-26');
        expect(localDayKey(startOfWeek(new Date(2026, 9, 25)))).toBe('2026-10-19');
    });
});

describe('summarize', () => {
    const days = {
        '2026-09-15': 1200,
        '2026-10-25': 800,   // 上周日
        '2026-10-26': 2000,  // 本周一
        '2026-10-28': 1500,
        '2026-10-31': 500,
        '2026-11-01': 900,
    };

    it('今日 / 本周（周一起）/ 本月（自然月）/ 累计', () => {
        const summary = summarize(days, NOW);
        expect(summary.today).toBe(900);
        // 2000 + 1500 + 500 + 900
        expect(summary.week).toBe(4900);
        // 11 月只有 11-01
        expect(summary.month).toBe(900);
        expect(summary.total).toBe(6900);
    });

    it('最佳一天取最大值', () => {
        expect(summarize(days, NOW).best).toEqual({ date: '2026-10-26', words: 2000 });
    });

    it('连续写作天数：今天写了就从今天数', () => {
        expect(computeStreak(days, NOW)).toBe(2); // 10-31、11-01
    });

    it('今天没写则从昨天开始数', () => {
        const noToday = { ...days, '2026-11-01': 0 };
        expect(computeStreak(noToday, NOW)).toBe(1); // 只剩 10-31
    });

    it('中间断档即停', () => {
        expect(computeStreak({ '2026-10-30': 100, '2026-11-01': 100 }, NOW)).toBe(1);
    });

    it('日序列补零且按日期升序', () => {
        const series = dailySeries(days, NOW, 7);
        expect(series).toHaveLength(7);
        expect(series[6]).toEqual({ date: '2026-11-01', words: 900 });
        expect(series[5]).toEqual({ date: '2026-10-31', words: 500 });
        expect(series[0].date).toBe('2026-10-26');
    });

    it('周序列按周一聚合', () => {
        const weeks = weeklySeries(days, NOW, 3);
        expect(weeks).toHaveLength(3);
        expect(weeks[2]).toEqual({ date: '2026-10-26', words: 4900 });
        expect(weeks[1]).toEqual({ date: '2026-10-19', words: 800 });
    });

    it('月序列按自然月聚合', () => {
        const months = monthlySeries(days, NOW, 3);
        expect(months[2]).toEqual({ date: '2026-11-01', words: 900 });
        expect(months[1]).toEqual({ date: '2026-10-01', words: 4800 });
    });
});

describe('recordFileWords — 增量归因', () => {
    it('首次见到的文件整份记到 mtime 当天', () => {
        const data = createEmptyWritingStats();
        const mtime = new Date(2026, 9, 30, 21, 0, 0).getTime();
        const { delta, day } = recordFileWords(data, 'p/第1章_正文.md', '长篇小说/书A', 2500, mtime, NOW);
        expect(delta).toBe(2500);
        expect(day).toBe('2026-10-30');
        expect(data.days['2026-10-30']).toBe(2500);
        expect(data.projects['长篇小说/书A']['2026-10-30']).toBe(2500);
    });

    it('字数增长只记差值', () => {
        const data = createEmptyWritingStats();
        const mtime1 = new Date(2026, 9, 30, 21, 0, 0).getTime();
        const mtime2 = new Date(2026, 10, 1, 9, 0, 0).getTime();
        recordFileWords(data, 'a.md', 'P', 1000, mtime1, NOW);
        const { delta } = recordFileWords(data, 'a.md', 'P', 1800, mtime2, NOW);
        expect(delta).toBe(800);
        expect(data.days['2026-10-30']).toBe(1000);
        expect(data.days['2026-11-01']).toBe(800);
    });

    it('字数下降不扣减历史，只更新快照', () => {
        const data = createEmptyWritingStats();
        recordFileWords(data, 'a.md', 'P', 2000, new Date(2026, 9, 31).getTime(), NOW);
        const { delta } = recordFileWords(data, 'a.md', 'P', 1200, new Date(2026, 10, 1).getTime(), NOW);
        expect(delta).toBe(0);
        expect(data.days['2026-10-31']).toBe(2000);
        expect(data.days['2026-11-01']).toBeUndefined();
        expect(data.files['a.md'].count).toBe(1200);
    });

    it('非法 mtime 归到今天', () => {
        const data = createEmptyWritingStats();
        recordFileWords(data, 'a.md', 'P', 300, 0, NOW);
        expect(data.days['2026-11-01']).toBe(300);
    });

    it('分项目与全局同步累加', () => {
        const data = createEmptyWritingStats();
        recordFileWords(data, 'x1.md', 'P1', 100, NOW, NOW);
        recordFileWords(data, 'x2.md', 'P2', 200, NOW, NOW);
        const report = buildReport(data, NOW);
        expect(report.global.today).toBe(300);
        expect(report.byProject.P1.today).toBe(100);
        expect(report.byProject.P2.today).toBe(200);
    });
});

describe('清理与格式化', () => {
    it('删除已不存在的文件快照，但保留历史日产出', () => {
        const data = createEmptyWritingStats();
        recordFileWords(data, 'gone.md', 'P', 500, NOW, NOW);
        const removed = pruneMissingFiles(data, new Set(['kept.md']));
        expect(removed).toBe(1);
        expect(data.files['gone.md']).toBeUndefined();
        expect(data.days['2026-11-01']).toBe(500);
    });

    it('formatWords 使用万为单位', () => {
        expect(formatWords(0)).toBe('0');
        expect(formatWords(1234)).toBe('1,234');
        expect(formatWords(10000)).toBe('1万');
        expect(formatWords(12345)).toBe('1.2万');
        expect(formatWords(1234567)).toBe('123万');
        expect(formatWords(-5)).toBe('0');
    });

    it('addDays 跨月正确', () => {
        expect(localDayKey(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01');
    });
});

describe('normalizeWritingStats', () => {
    it('损坏/异形输入回落空台账', () => {
        expect(normalizeWritingStats(null).days).toEqual({});
        expect(normalizeWritingStats('x').files).toEqual({});
        expect(normalizeWritingStats([]).projects).toEqual({});
    });

    it('过滤非法日期键与非正数，保留合法快照', () => {
        const data = normalizeWritingStats({
            days: { '2026-11-01': 100, '2026-11-02': -3, bad: 10, '2026-11-03': 'x' },
            projects: { P: { '2026-11-01': 100 } },
            files: { 'a.md': { count: 5, mtime: 1, project: 'P' }, 'b.md': { count: 'x' } },
            updatedAt: 123,
        });
        expect(data.days).toEqual({ '2026-11-01': 100 });
        expect(Object.keys(data.files)).toEqual(['a.md']);
        expect(data.updatedAt).toBe(123);
    });
});

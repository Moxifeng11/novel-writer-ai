/**
 * kb-format 单测（v4.83.0 UI 可测性治理 · 第 5 批）
 *
 * 这 7 个格式化函数原本是 KnowledgeBaseView 的私有方法，覆盖率 0.34% 的文件里
 * 无法单独验证。它们的输出遍布书籍卡、详情页、任务面板——改一个符号就会静默走样。
 *
 * 特别锁定（勘察报告记录的风险点）：
 * - formatWordCount 的 `0` 与 `undefined` **都**显示「未知」（不是只在 undefined 时）
 * - formatDuration 各分支信息量不同（小时不带秒、分钟不带小时）
 * - 拆解状态 5 档 / 任务状态 6 档是两套映射，任务多「已暂停」，拆解多「拆解中断」
 * - 频道只有 male/female/neutral → 男频/女频/中性（不存在 other→综合）
 */

import { describe, expect, it } from 'vitest';
import {
    WORD_COUNT_WAN_THRESHOLD,
    UNKNOWN_WORD_COUNT_LABEL,
    INVALID_DATE_LABEL,
    formatBreakdownStatusLabel,
    formatTaskStatusLabel,
    formatChannelLabel,
    formatWordCount,
    formatDate,
    formatDateTime,
    formatDuration,
} from '../../../ui/views/kb-format';

describe('formatBreakdownStatusLabel — 拆解状态 5 档', () => {
    it('五档全映射', () => {
        expect(formatBreakdownStatusLabel('pending')).toBe('待拆解');
        expect(formatBreakdownStatusLabel('processing')).toBe('拆解中');
        expect(formatBreakdownStatusLabel('completed')).toBe('已完成');
        expect(formatBreakdownStatusLabel('failed')).toBe('失败');
        expect(formatBreakdownStatusLabel('interrupted')).toBe('拆解中断');
    });

    it('未知状态原样返回（不吞掉新状态）', () => {
        expect(formatBreakdownStatusLabel('brand-new')).toBe('brand-new');
    });

    it('与任务状态是两套映射：拆解没有「已暂停」，任务没有「拆解中断」', () => {
        // 同一个字符串在不同映射下应给出各自语义
        expect(formatBreakdownStatusLabel('interrupted')).toBe('拆解中断');
        expect(formatTaskStatusLabel('paused')).toBe('已暂停');
        expect(formatBreakdownStatusLabel('paused')).toBe('paused');   // 拆解态不存在此值 → 原样
        expect(formatTaskStatusLabel('interrupted')).toBe('interrupted'); // 任务态不存在此值 → 原样
    });
});

describe('formatTaskStatusLabel — 任务状态 6 档', () => {
    it('六档全映射', () => {
        expect(formatTaskStatusLabel('pending')).toBe('等待中');
        expect(formatTaskStatusLabel('running')).toBe('运行中');
        expect(formatTaskStatusLabel('paused')).toBe('已暂停');
        expect(formatTaskStatusLabel('completed')).toBe('已完成');
        expect(formatTaskStatusLabel('failed')).toBe('失败');
        expect(formatTaskStatusLabel('cancelled')).toBe('已取消');
    });

    it('未知状态原样返回', () => {
        expect(formatTaskStatusLabel('weird')).toBe('weird');
    });
});

describe('formatChannelLabel — 频道 3 值', () => {
    it('三值映射', () => {
        expect(formatChannelLabel('male')).toBe('男频');
        expect(formatChannelLabel('female')).toBe('女频');
        expect(formatChannelLabel('neutral')).toBe('中性');
    });

    it('不存在 other→综合 的旧映射（与已删除的死代码语义不同）', () => {
        expect(formatChannelLabel('other')).toBe('other');
    });

    it('未知值原样返回', () => {
        expect(formatChannelLabel('x')).toBe('x');
        expect(formatChannelLabel('')).toBe('');
    });
});

describe('formatWordCount — 字数展示', () => {
    it('一万以内显示「n 字」', () => {
        expect(formatWordCount(1)).toBe('1 字');
        expect(formatWordCount(9800)).toBe('9800 字');
        expect(formatWordCount(WORD_COUNT_WAN_THRESHOLD - 1)).toBe('9999 字');
    });

    it('一万及以上显示「x.x 万字」', () => {
        expect(formatWordCount(10000)).toBe('1.0 万字');
        expect(formatWordCount(123400)).toBe('12.3 万字');
    });

    it('0 与 undefined 都显示「未知」（沿用原实现，0 视为未统计）', () => {
        expect(formatWordCount(0)).toBe(UNKNOWN_WORD_COUNT_LABEL);
        expect(formatWordCount(undefined)).toBe(UNKNOWN_WORD_COUNT_LABEL);
        expect(UNKNOWN_WORD_COUNT_LABEL).toBe('未知');
    });
});

describe('formatDate / formatDateTime — 本地时间格式', () => {
    // 用本地时间构造，避免时区导致断言漂移
    const ts = new Date(2026, 10, 11, 9, 5, 30).getTime();

    it('formatDate 输出 yyyy-MM-dd', () => {
        expect(formatDate(ts)).toBe('2026-11-11');
    });

    it('formatDateTime 输出 yyyy-MM-dd HH:mm（补零）', () => {
        expect(formatDateTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
    });

    it('非法时间返回占位符而非 Invalid Date', () => {
        expect(formatDate(Number.NaN)).toBe(INVALID_DATE_LABEL);
        expect(formatDateTime(Number.NaN)).toBe(INVALID_DATE_LABEL);
        expect(formatDate(Number.POSITIVE_INFINITY)).toBe(INVALID_DATE_LABEL);
        expect(INVALID_DATE_LABEL).toBe('-');
    });
});

describe('formatDuration — 时长中文', () => {
    it('秒级', () => {
        expect(formatDuration(1000)).toBe('1秒');
        expect(formatDuration(45_000)).toBe('45秒');
        expect(formatDuration(59_999)).toBe('59秒');
    });

    it('分钟级不带小时、保留秒', () => {
        expect(formatDuration(60_000)).toBe('1分0秒');
        expect(formatDuration(200_000)).toBe('3分20秒');
        expect(formatDuration(3_599_000)).toBe('59分59秒');
    });

    it('小时级不带秒（只保留分钟余数）', () => {
        expect(formatDuration(3_600_000)).toBe('1小时0分');
        expect(formatDuration(7_500_000)).toBe('2小时5分');
    });

    it('0 / 负数 / 非法值归「0秒」', () => {
        expect(formatDuration(0)).toBe('0秒');
        expect(formatDuration(-1000)).toBe('0秒');
        expect(formatDuration(Number.NaN)).toBe('0秒');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0秒');
    });
});

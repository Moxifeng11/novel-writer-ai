/**
 * writing-stats.ts — 每日/每周/每月字数产出统计（纯函数）
 *
 * 数据来源与口径：
 * - 只统计「正文字数变化」：每个正文文件保存一份 { count, mtime } 快照，
 *   下次扫描时 `count` 增长的部分记为**该文件 mtime 当天**的产出。
 * - 只记增长：改写/删章造成的字数下降不扣减（否则「今天写了 3000 又删了 2000」
 *   会显示 -2000，且历史日期的数字会被后来的一次删改污染）。
 * - 日期一律按本地时区取 `YYYY-MM-DD`，不做 UTC 换算——用户认知里的「今天」是本地今天。
 */

/**
 * 日期→字数映射。
 */
export type DayMap = Record<string, number>;

/**
 * 统计文件快照。
 */
export interface WritingStatsFileSnapshot {
    /** 最近一次见到的字数 */
    count: number;
    /** 最近一次见到的 mtime（毫秒） */
    mtime: number;
    /** 所属项目（类别/项目名），用于分项目统计 */
    project: string;
}

/**
 * 写作统计数据。
 */
export interface WritingStatsData {
    version: 1;
    /** 全局：日期 → 当日新增字数 */
    days: DayMap;
    /** 分项目：project → 日期 → 当日新增字数 */
    projects: Record<string, DayMap>;
    /** 文件路径 → 字数快照 */
    files: Record<string, WritingStatsFileSnapshot>;
    updatedAt: number;
}

/**
 * 单日数据点。
 */
export interface DayPoint {
    date: string;
    words: number;
}

/**
 * 统计摘要。
 */
export interface StatsSummary {
    today: number;
    week: number;
    month: number;
    total: number;
    /** 连续写作天数（今天没写则从昨天往前数） */
    streak: number;
    best: DayPoint | null;
    /** 最近 7 天（含今天），按日期升序 */
    daily: DayPoint[];
    /** 最近 8 周，按周一起算 */
    weekly: DayPoint[];
    /** 最近 6 个月 */
    monthly: DayPoint[];
}

/**
 * 创建空统计。
 * @returns 统计数据
 */
export function createEmptyWritingStats(): WritingStatsData {
    return { version: 1, days: {}, projects: {}, files: {}, updatedAt: 0 };
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/** 本地时区日期键 YYYY-MM-DD */
export function localDayKey(date: Date | number): string {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 当天起点。
 *
 * @param date - 日期
 * @returns 日期
 */
export function startOfDay(date: Date | number): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** 周一为一周起点（符合中文使用习惯，而非周日） */
export function startOfWeek(date: Date | number): Date {
    const d = startOfDay(date);
    const day = d.getDay(); // 0=周日
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
}

/**
 * 本月起点。
 *
 * @param date - 日期
 * @returns 日期
 */
export function startOfMonth(date: Date | number): Date {
    const d = startOfDay(date);
    d.setDate(1);
    return d;
}

/**
 * 加/减天数。
 *
 * @param date - 日期
 * @param days - 天数
 * @returns 日期
 */
export function addDays(date: Date | number, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

/**
 * 加/减月数。
 *
 * @param date - 日期
 * @param months - 月数
 * @returns 日期
 */
export function addMonths(date: Date | number, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

/** 安全读取某天字数 */
function wordsOn(days: DayMap, key: string): number {
    const value = days[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 区间求和：左闭右开 */
export function sumBetween(days: DayMap, from: Date, toExclusive: Date): number {
    let total = 0;
    const cursor = startOfDay(from);
    const end = startOfDay(toExclusive);
    while (cursor.getTime() < end.getTime()) {
        total += wordsOn(days, localDayKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return total;
}

/** 连续写作天数：今天没写则从昨天开始数 */
export function computeStreak(days: DayMap, now: Date | number = Date.now()): number {
    let cursor = startOfDay(now);
    if (wordsOn(days, localDayKey(cursor)) === 0) {
        cursor = addDays(cursor, -1);
    }
    let streak = 0;
    while (wordsOn(days, localDayKey(cursor)) > 0) {
        streak++;
        cursor = addDays(cursor, -1);
        if (streak > 3650) break; // 防御：异常数据不至于死循环
    }
    return streak;
}

/**
 * 最佳单日。
 *
 * @param days - 天数
 * @returns 数据点或 null
 */
export function findBestDay(days: DayMap): DayPoint | null {
    let best: DayPoint | null = null;
    for (const [date, words] of Object.entries(days)) {
        if (typeof words !== 'number' || !Number.isFinite(words) || words <= 0) continue;
        if (!best || words > best.words) best = { date, words };
    }
    return best;
}

/** 最近 7 天（含今天），补零保证图表连续 */
export function dailySeries(days: DayMap, now: Date | number = Date.now(), count = 7): DayPoint[] {
    const points: DayPoint[] = [];
    const today = startOfDay(now);
    for (let i = count - 1; i >= 0; i--) {
        const date = localDayKey(addDays(today, -i));
        points.push({ date, words: wordsOn(days, date) });
    }
    return points;
}

/** 最近 N 周（周一为一周起点），label 形如 10-27 */
export function weeklySeries(days: DayMap, now: Date | number = Date.now(), count = 8): DayPoint[] {
    const points: DayPoint[] = [];
    const thisWeek = startOfWeek(now);
    for (let i = count - 1; i >= 0; i--) {
        const weekStart = addDays(thisWeek, -7 * i);
        const weekEnd = addDays(weekStart, 7);
        const date = localDayKey(weekStart);
        points.push({ date, words: sumBetween(days, weekStart, weekEnd) });
    }
    return points;
}

/** 最近 N 个月（自然月），date 为月初 */
export function monthlySeries(days: DayMap, now: Date | number = Date.now(), count = 6): DayPoint[] {
    const points: DayPoint[] = [];
    const thisMonth = startOfMonth(now);
    for (let i = count - 1; i >= 0; i--) {
        const monthStart = addMonths(thisMonth, -i);
        const monthEnd = addMonths(monthStart, 1);
        points.push({ date: localDayKey(monthStart), words: sumBetween(days, monthStart, monthEnd) });
    }
    return points;
}

/**
 * 生成统计摘要。
 *
 * @param days - 天数
 * @param now - 当前时间
 * @returns 摘要
 */
export function summarize(days: DayMap, now: Date | number = Date.now()): StatsSummary {
    const todayDate = new Date(now);
    const today = wordsOn(days, localDayKey(todayDate));
    const weekStart = startOfWeek(todayDate);
    const monthStart = startOfMonth(todayDate);
    const total = Object.values(days).reduce(
        (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0),
        0,
    );
    return {
        today,
        week: sumBetween(days, weekStart, addDays(startOfDay(todayDate), 1)),
        month: sumBetween(days, monthStart, addDays(startOfDay(todayDate), 1)),
        total,
        streak: computeStreak(days, todayDate),
        best: findBestDay(days),
        daily: dailySeries(days, todayDate),
        weekly: weeklySeries(days, todayDate),
        monthly: monthlySeries(days, todayDate),
    };
}

/**
 * 统计报告。
 */
export interface StatsReport {
    global: StatsSummary;
    byProject: Record<string, StatsSummary>;
}

/**
 * 生成统计报告。
 *
 * @param data - 数据
 * @param now - 当前时间
 * @returns 报告
 */
export function buildReport(data: WritingStatsData, now: Date | number = Date.now()): StatsReport {
    const byProject: Record<string, StatsSummary> = {};
    for (const [project, days] of Object.entries(data.projects || {})) {
        byProject[project] = summarize(days, now);
    }
    return { global: summarize(data.days || {}, now), byProject };
}

/**
 * 记录一个正文文件的当前字数，返回增量与归因日期。
 *
 * - 首次见到的文件：整份字数归到其 mtime 当天（视为「那天写的」）
 * - 字数增长：差值归到 mtime 当天
 * - 字数减少/不变：不动台账，只更新快照
 */
export function recordFileWords(
    data: WritingStatsData,
    filePath: string,
    project: string,
    count: number,
    mtime: number,
    now: Date | number = Date.now(),
): { delta: number; day: string } {
    const safeCount = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
    const safeMtime = Number.isFinite(mtime) && mtime > 0 ? mtime : new Date(now).getTime();
    const day = localDayKey(safeMtime);
    const previous = data.files[filePath];
    const previousCount = previous ? Math.max(0, previous.count) : 0;
    const delta = Math.max(0, safeCount - previousCount);

    if (delta > 0) {
        data.days[day] = (data.days[day] || 0) + delta;
        if (!data.projects[project]) data.projects[project] = {};
        data.projects[project][day] = (data.projects[project][day] || 0) + delta;
    }
    data.files[filePath] = { count: safeCount, mtime: safeMtime, project };
    data.updatedAt = new Date(now).getTime();
    return { delta, day };
}

/** 清理已删除文件的快照，避免 files 无限增长 */
export function pruneMissingFiles(data: WritingStatsData, existingPaths: ReadonlySet<string>): number {
    let removed = 0;
    for (const path of Object.keys(data.files)) {
        if (!existingPaths.has(path)) {
            delete data.files[path];
            removed++;
        }
    }
    return removed;
}

/** 1,234 / 1.2万 / 12.3万，用于状态栏与宠物冒泡 */
export function formatWords(value: number): string {
    const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    if (n < 10000) return n.toLocaleString('zh-CN');
    const wan = n / 10000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')}万`;
}

/** 解析台账，容忍损坏/旧结构 */
export function normalizeWritingStats(raw: unknown): WritingStatsData {
    const empty = createEmptyWritingStats();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    const obj = raw as Record<string, unknown>;
    const data = empty;

    const readDayMap = (value: unknown): DayMap => {
        const out: DayMap = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
        for (const [key, words] of Object.entries(value as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
            if (typeof words !== 'number' || !Number.isFinite(words) || words <= 0) continue;
            out[key] = Math.round(words);
        }
        return out;
    };

    data.days = readDayMap(obj.days);
    const projects: Record<string, DayMap> = {};
    if (obj.projects && typeof obj.projects === 'object' && !Array.isArray(obj.projects)) {
        for (const [project, days] of Object.entries(obj.projects as Record<string, unknown>)) {
            const parsed = readDayMap(days);
            if (Object.keys(parsed).length > 0) projects[project] = parsed;
        }
    }
    data.projects = projects;

    const files: Record<string, WritingStatsFileSnapshot> = {};
    if (obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)) {
        for (const [path, snapshot] of Object.entries(obj.files as Record<string, unknown>)) {
            if (!snapshot || typeof snapshot !== 'object') continue;
            const s = snapshot as Record<string, unknown>;
            const count = typeof s.count === 'number' && Number.isFinite(s.count) && s.count >= 0 ? Math.round(s.count) : null;
            if (count === null) continue;
            files[path] = {
                count,
                mtime: typeof s.mtime === 'number' && Number.isFinite(s.mtime) ? s.mtime : 0,
                project: typeof s.project === 'string' ? s.project : '',
            };
        }
    }
    data.files = files;
    data.updatedAt = typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;
    return data;
}

/**
 * kb-format.ts — 知识库视图的纯格式化与查表（无 DOM、无实例状态）
 *
 * 背景（v4.83.0 UI 可测性治理）：`knowledge-base-view.ts`（2,938 行 / 覆盖率 0.34%）
 * 里有 7 个纯格式化方法，输出的文案在书籍卡、详情页、任务面板到处显示，
 * 却因为嵌在 ItemView 里无法单测——改一个符号就会静默走样。
 *
 * 口径提醒（抽取时必须逐字保持，见 docs/audits/knowledge-base-view-structure-survey.md）：
 * - `formatWordCount` 用 `!count` 判定：`0` 与 `undefined` **都**显示「未知」，不要改成 `=== undefined`
 * - `formatDuration` 各分支信息量不同：小时分支不带秒、分钟分支不带小时
 * - `formatTaskStatusLabel`（6 档，含「已暂停」）与 `formatBreakdownStatusLabel`（5 档，含「拆解中断」）
 *   是**两套不同映射**，不可互相复用
 * - 频道只有 male/female/neutral 三值 → 男频/女频/中性（不是 other→综合）
 */

import type { BreakdownStatus } from '@/services/knowledge-base-manager';
import type { TaskStatus } from '@/engine/deconstruction-scheduler';

/** 拆解状态 → 中文标签（5 档） */
const BREAKDOWN_STATUS_LABELS: Record<BreakdownStatus, string> = {
    pending: '待拆解',
    processing: '拆解中',
    completed: '已完成',
    failed: '失败',
    interrupted: '拆解中断',
};

/** 后台任务状态 → 中文标签（6 档，比拆解状态多「已暂停」，语义也不同） */
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
    pending: '等待中',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
};

/** 频道 → 中文标签（3 值） */
const CHANNEL_LABELS: Record<string, string> = {
    male: '男频',
    female: '女频',
    neutral: '中性',
};

/** 万字换算阈值 */
export const WORD_COUNT_WAN_THRESHOLD = 10000;

/** 字数未知时的展示文案 */
export const UNKNOWN_WORD_COUNT_LABEL = '未知';

/** 日期未知/非法时的展示文案 */
export const INVALID_DATE_LABEL = '-';

/**
 * 拆解状态标签。
 *
 * @param status - 拆解状态
 * @returns 中文标签；未知值原样返回
 *
 * @example
 * formatBreakdownStatusLabel('processing') // => '拆解中'
 */
export function formatBreakdownStatusLabel(status: BreakdownStatus | string): string {
    return BREAKDOWN_STATUS_LABELS[status as BreakdownStatus] || status;
}

/**
 * 后台任务状态标签（6 档）。
 *
 * @param status - 任务状态
 * @returns 中文标签；未知值原样返回
 */
export function formatTaskStatusLabel(status: TaskStatus | string): string {
    return TASK_STATUS_LABELS[status as TaskStatus] || status;
}

/**
 * 频道标签。
 *
 * @param channel - 频道（male/female/neutral）
 * @returns 中文标签；未知值原样返回
 */
export function formatChannelLabel(channel: string): string {
    return CHANNEL_LABELS[channel] || channel;
}

/**
 * 字数展示：一万以内「n 字」，一万以上「x.x 万字」。
 *
 * 注意：`0` 与 `undefined` 都显示「未知」（沿用原实现，`0` 视为未统计）。
 *
 * @param count - 字数
 * @returns 展示文案
 *
 * @example
 * formatWordCount(9800)   // => '9800 字'
 * formatWordCount(123400) // => '12.3 万字'
 * formatWordCount(0)      // => '未知'
 */
export function formatWordCount(count?: number): string {
    if (!count) return UNKNOWN_WORD_COUNT_LABEL;
    if (count >= WORD_COUNT_WAN_THRESHOLD) {
        return `${(count / WORD_COUNT_WAN_THRESHOLD).toFixed(1)} 万字`;
    }
    return `${count} 字`;
}

/**
 * 把时间戳格式化为本地 yyyy-MM-dd。
 *
 * @param timestamp - 毫秒时间戳
 * @returns 日期字符串；非法时间返回 `-`
 */
export function formatDate(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return INVALID_DATE_LABEL;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return INVALID_DATE_LABEL;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 把时间戳格式化为本地 yyyy-MM-dd HH:mm。
 *
 * @param timestamp - 毫秒时间戳
 * @returns 日期时间字符串；非法时间返回 `-`
 */
export function formatDateTime(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return INVALID_DATE_LABEL;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return INVALID_DATE_LABEL;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * 把毫秒时长格式化为中文（小时级不带秒，分钟级不带小时）。
 *
 * @param ms - 毫秒；`<=0` 或非有限值归「0秒」
 * @returns 形如 `2小时5分` / `3分20秒` / `45秒`
 *
 * @example
 * formatDuration(45_000)    // => '45秒'
 * formatDuration(200_000)   // => '3分20秒'
 * formatDuration(7_500_000) // => '2小时5分'
 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0秒';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}小时${remainingMinutes}分`;
    }
    if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}分${remainingSeconds}秒`;
    }
    return `${seconds}秒`;
}

/**
 * time-context.ts — 当前时间上下文（吸收 dsh context/time-context）
 *
 * 让模型知道「现在是几点/周几」，否则它会写出「今天是周一」这类与真实时间脱节的内容，
 * 也无法判断「还有 3 天截稿」之类的期限。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/**
 * `2026-10-27 14:03（周二）`
 *
 * @param now - 当前时间
 * @returns 文本结果
 */
export function formatTimeContext(now: Date = new Date()): string {
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return `${date} ${time}（${WEEKDAYS[now.getDay()]}）`;
}

/**
 * 分钟级去重键：同一分钟内的多轮对话不重复注入
 *
 * @param now - 当前时间
 * @returns 文本结果
 */
export function timeContextKey(now: Date = new Date()): string {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * 注入到会话日志里的那条上下文（模型可见）
 *
 * @param now - 当前时间
 * @returns 文本结果
 */
export function buildTimeContextMessage(now: Date = new Date()): string {
    return `【当前时间】${formatTimeContext(now)}。涉及日期/季节/期限的描述以此为准。`;
}
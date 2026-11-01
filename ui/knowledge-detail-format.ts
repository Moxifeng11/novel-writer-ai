export function normalizeDetailNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function formatDetailNumber(value: unknown, digits: number, suffix = ''): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '数据缺失';
    return `${value.toFixed(digits)}${suffix}`;
}

/** 0–1 比例 → 百分比文案；旧数据/AI 漏字段不会抛异常 */
export function formatDetailPercent(value: unknown, digits = 0, suffix = '%'): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '数据缺失';
    return `${(value * 100).toFixed(digits)}${suffix}`;
}

/** 千分位计数；缺字段返回「数据缺失」 */
export function formatDetailCount(value: unknown): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '数据缺失';
    return value.toLocaleString();
}

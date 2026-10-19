export function normalizeDetailNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function formatDetailNumber(value: unknown, digits: number, suffix = ''): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '数据缺失';
    return `${value.toFixed(digits)}${suffix}`;
}

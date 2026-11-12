/**
 * gate-sanity-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 扫描范围健全性 */
export function evaluateScanScope(input: { count: number; label: string }): string[];

/** 量具有效性 */
export function evaluateMeasurement(input: {
    total: number;
    baselineTotal: number;
    label: string;
}): string[];

/** 基线对象是否仍存在 */
export function findVanishedBaselineFiles(input: {
    baselineFiles: string[];
    exists: (rel: string) => boolean;
    limit?: number;
}): { vanished: string[]; truncated: boolean; limit: number };

/** 渲染消失文件文案 */
export function describeVanishedFiles(input: {
    vanished: string[];
    truncated: boolean;
    limit?: number;
    label: string;
}): string[];

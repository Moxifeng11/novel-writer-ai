/**
 * prod-smoke-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 冒烟结果状态 */
export const SMOKE_STATUS: {
    PASS: 'pass';
    FAIL: 'fail';
    SKIP: 'skip';
};

/** 单步结果 */
export interface SmokeStep {
    name: string;
    status: 'pass' | 'fail' | 'skip';
    detail?: string;
}

/** 解析 plugin info 输出 */
export function parsePluginInfo(stdout: string): Record<string, string> | null;

/** 版本一致性判定 */
export function evaluateVersionMatch(input: {
    runningVersion: string | null | undefined;
    expectedVersion: string | null | undefined;
}): { ok: boolean; reason?: string };

/** AI 调用判定 */
export function evaluateAiCall(input: {
    label?: string;
    result: { content?: string; error?: string; finishReason?: string } | null | undefined;
    minContentLength?: number;
}): { ok: boolean; reason?: string; contentLength?: number; finishReason?: string };

/** 解析 dev:errors 输出 */
export function countCapturedErrors(stdout: string): number | null;

/** 汇总冒烟结果 */
export function summarizeSmoke(steps: SmokeStep[]): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    ok: boolean;
    hasFailure: boolean;
    hasSkip: boolean;
};

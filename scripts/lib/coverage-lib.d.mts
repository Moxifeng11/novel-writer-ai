/**
 * coverage-lib.d.mts — coverage-lib.mjs 的类型声明（TS 测试静态 import 用）
 */

export const METRICS: string[];
export const RATCHET_TOLERANCE_PCT: number;

export interface MetricEntry {
    total: number;
    covered: number;
    pct: number;
}

export interface DirAggregate {
    dir: string;
    files: number;
    lines: MetricEntry;
    statements: MetricEntry;
    branches: MetricEntry;
    functions: MetricEntry;
}

export interface CoverageBaseline {
    gitHead?: string;
    generatedAt?: string;
    nodeVersion?: string;
    dirs?: Record<string, Record<string, any>>;
}

export function toRelativePath(filePath: string, root: string): string;

export function isInDir(relPath: string, dir: string): boolean;

export function aggregateByDir(summary: Record<string, any>, dir: string, root: string): DirAggregate;

export function compareCoverage(
    baseline: CoverageBaseline | null,
    current: Record<string, any>,
): { ok: boolean; decreased: Array<{ dir: string; baseline: number; actual: number }> };

export function checkProvenance(
    baseline: CoverageBaseline | null,
    head: string,
): { ok: boolean; reason?: string };

export function validateBaselineUpdate(input: {
    oldBaseline: CoverageBaseline | null;
    current: Record<string, any>;
    note: string;
    allowDecrease: boolean;
}): { ok: boolean; errors: string[]; decreased: string[] };

export function toBaselineDirs(current: Record<string, DirAggregate>): CoverageBaseline['dirs'];

export function evaluateProvenance(input: {
    baselineHead: string;
    head: string;
    isAncestor: boolean;
    sourcesChanged: boolean;
}): { ok: boolean; code: number; reason?: string; note?: string };

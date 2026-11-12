/**
 * silent-failures-lib.d.mts — silent-failures-lib.mjs 的类型声明（TS 测试静态 import 用）
 */

export interface SilentFailureCandidate {
    /** 1 基行号 */
    line: number;
    kind: 'read-as-empty' | 'write-as-success';
    exempt: boolean;
    body: string;
}

export interface SilentFailureViolation {
    path: string;
    line: number;
    kind: 'read-as-empty' | 'write-as-success';
}

export interface SilentFailuresBaseline {
    total?: number;
    generatedAt?: string;
    note?: string;
    files?: Record<string, number>;
}

export interface SilentFailuresResult {
    violations: SilentFailureViolation[];
    added: SilentFailureViolation[];
    fixed: string[];
    exempted: number;
    total: number;
}

export function isInWriteContext(lines: string[], line: number): boolean;
export function classifyCatchBody(body: string): { silent: boolean; kind: 'read-as-empty' | 'write-as-success' | null };
export function collectSilentFailures(text: string): SilentFailureCandidate[];
export function evaluateSilentFailures(input: {
    files: Record<string, string>;
    baseline: SilentFailuresBaseline;
}): SilentFailuresResult;

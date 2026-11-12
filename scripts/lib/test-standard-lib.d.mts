/**
 * test-standard-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 测试替身忠实性守卫的标记 */
export const MOCK_FIDELITY_MARKER: string;

/** 单条违规 */
export interface TestStandardViolation {
    rel: string;
    line: number;
    rule: string;
    detail: string;
}

/** 扫描一个测试文件 */
export function scanTestFile(input: { rel: string; text: string }): TestStandardViolation[];

/** 校验测试替身忠实性 */
export function checkMockFidelity(input: { rel: string; text: string }): TestStandardViolation[];

/** 汇总违规 */
export function summarizeViolations(violations: TestStandardViolation[]): {
    total: number;
    byRule: Record<string, number>;
};

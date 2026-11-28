/**
 * standard-map-lib.mjs 类型声明（开发规矩 ↔ 门禁 双向完整性校验）
 */

/** 标准文档必备章节关键词 */
export const REQUIRED_SECTIONS: readonly string[];

/** 从 package.json scripts 收集需要登记的准入门禁（check* 与核心命令） */
export function collectGateScripts(scripts?: Record<string, string> | undefined): string[];

/** 解析 §三 门禁表：| `门禁` | 规矩(R-xx) | 时机 | */
export function parseGateTable(markdown: string): Array<{
    gate: string;
    rules: string[];
    timing: string;
}>;

/** 解析 §一 定义的规则 ID（表格首列为 R-XX） */
export function extractDefinedRules(markdown: string): string[];

/** 校验章节骨架，返回缺失的章节关键词 */
export function findMissingSections(markdown: string): string[];

/** 双向差异 + 规则引用一致性 */
export function diffGateMapping(input: {
    pkgGates: string[];
    docRows: Array<{ gate: string; rules: string[]; timing?: string }>;
    definedRules: string[];
    exemptGateScripts?: string[];
}): {
    missingInDoc: string[];
    missingInPkg: string[];
    unknownRules: Array<{ gate: string; rule: string }>;
    undocumentedRulesInTable: string[];
};

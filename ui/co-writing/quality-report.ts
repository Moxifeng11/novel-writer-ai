/**
 * quality-report.ts — 协同视图「质量控制报告」的解析（自 co-writing-view 抽出）
 *
 * 只负责「把《章节名>_质量控制.md 的 markdown 文本解析为结构化问题列表」这一件事：
 *  - 无 DOM、无状态写入、无视图依赖：输入正文文本，输出 QualityIssue 数组
 *  - 解析规则（与抽取前完全一致）：
 *    1. `#`~`###` 标题行作为后续问题的分类（category）
 *    2. 以 ❌ / ⚠️ 开头的行记为问题（✅ 行跳过；❌→high、⚠️→medium）
 *    3. 问题行内提取定位文本（第 N 段 / 第 N 字 / 「…」/ 【…】）
 *    4. 问题行后 3 行内的非问题行合并为修复建议（截断至 120 字）
 *    5. 全文无任何问题时，回落解析「【修改建议…】」汇总区里带 🔴/🟡/🟢 优先级的条目
 */

/**
 * 质量问题结构定义。
 */
export interface QualityIssue {
    /** 问题唯一标识（按解析顺序生成，如 `qc_1` / `qc_sum_1`）。 */
    id: string;
    /** 优先级：❌→high、⚠️→medium、汇总区 🟢→low。 */
    priority: 'high' | 'medium' | 'low';
    /** 问题所属分类（取自报告中的 `#`~`###` 标题；汇总区条目为「修改建议」）。 */
    category: string;
    /** 问题描述（去除 emoji 前缀后的问题行文本）。 */
    problem: string;
    /** 修复建议（问题行后 3 行合并，截断至 120 字；无独立建议行时回落为问题文本）。 */
    suggestion: string;
    /** 定位文本（第 N 段 / 第 N 字 / 「…」/ 【…】内文本，取不到时为问题文本前缀）。 */
    locationText: string;
    /** 严重度图标：❌ 有问题 / ⚠️ 待关注 / ✅ 通过。 */
    severity: '❌' | '⚠️' | '✅';
}

/**
 * 解析质量控制报告 markdown 为结构化问题列表（纯函数，与抽取前行为完全一致）。
 *
 * 报告过短（< 50 字符）视为无有效内容，直接返回空数组；
 * 正文逐行提取 ❌/⚠️ 问题条目，全部缺失时回落解析「修改建议」汇总区。
 *
 * @param content - 质量控制报告的 markdown 全文
 * @returns 问题列表（✅ 通过项不产出条目；无问题时可能为空数组）
 * @example
 * ```ts
 * const issues = parseQualityReport('# 情节\n❌ 第3段节奏拖沓，建议压缩打斗铺垫\n删去重复的环境描写');
 * // [{ id: 'qc_1', priority: 'high', category: '情节', problem: '第3段节奏拖沓…',
 * //     suggestion: '删去重复的环境描写', locationText: '3', severity: '❌' }]
 * ```
 */
export function parseQualityReport(content: string): QualityIssue[] {
    if (!content || content.length < 50) return [];
    const issues: QualityIssue[] = [];
    const lines = content.split('\n');
    let currentCategory = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (/^#{1,3}\s+/.test(line)) {
            currentCategory = line.replace(/^#+\s*/, '').trim();
            continue;
        }

        let severity: '❌' | '⚠️' | '✅' | null = null;
        if (line.startsWith('❌')) severity = '❌';
        else if (line.startsWith('⚠️')) severity = '⚠️';
        else if (line.startsWith('✅')) severity = '✅';
        if (!severity) continue;

        const priority: 'high' | 'medium' | 'low' = severity === '❌' ? 'high' : severity === '⚠️' ? 'medium' : 'low';

        // 与抽取前保持逐字节等价：字符类只含 ❌(U+274C)、⚠(U+26A0)、✅(U+2705) 三个码点
        const problemText = line.replace(/^[\u274C\u26A0\u2705]\s*/, '').trim();

        if (severity === '✅') continue;

        const locationMatch = problemText.match(/第(\d+)段|第(\d+)字|「([^」]+)」|【([^】]+)】/);
        const locationText = locationMatch
            ? (locationMatch[3] || locationMatch[4] || problemText.slice(0, 20))
            : '';

        const nextLines = lines.slice(i + 1, Math.min(i + 4, lines.length));
        let suggestion = nextLines
            .filter(l => l.trim() && !l.trim().startsWith('❌') && !l.trim().startsWith('⚠') && !l.trim().startsWith('✅'))
            .map(l => l.trim())
            .join(' ');

        if (!suggestion && problemText.length > 10) {
            suggestion = problemText;
        }

        issues.push({
            id: `qc_${issues.length + 1}`,
            priority,
            category: currentCategory,
            problem: problemText,
            suggestion: suggestion.slice(0, 120) + (suggestion.length > 120 ? '...' : ''),
            locationText: locationText || (problemText.length > 8 ? problemText.slice(0, 8) : problemText),
            severity,
        });
    }

    if (issues.length === 0) {
        const sugMatch = content.match(/【[修改建议汇总|修改建议|建议].*?】\s*([\s\S]*)/i);
        if (sugMatch) {
            const sugLines = sugMatch[1].split('\n').filter(l => l.trim());
            for (const s of sugLines) {
                const trimmed = s.trim();
                if (!trimmed || trimmed.startsWith('---')) continue;
                const hasPriority = trimmed.includes('🔴') || trimmed.includes('🟡') || trimmed.includes('🟢');
                if (!hasPriority) continue;
                const priority: 'high' | 'medium' | 'low' = trimmed.includes('🔴') ? 'high' : trimmed.includes('🟡') ? 'medium' : 'low';
                const text = trimmed.replace(/^-\s*/, '').replace(/[🔴🟡🟢]/g, '').trim();
                if (text.length < 5) continue;
                issues.push({
                    id: `qc_sum_${issues.length + 1}`,
                    priority,
                    category: '修改建议',
                    problem: text.slice(0, 80),
                    suggestion: text,
                    locationText: '',
                    severity: priority === 'high' ? '❌' : '⚠️',
                });
            }
        }
    }

    return issues;
}

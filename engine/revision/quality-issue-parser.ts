/**
 * quality-issue-parser.ts — 把质量报告转成结构化修订问题
 */
import type { RevisionDimension, RevisionIssue, RevisionPlan, RevisionSeverity } from './revision-types';

const DIMENSION_KEYWORDS: Array<{ dimension: RevisionDimension; keywords: string[] }> = [
    { dimension: 'dialogue', keywords: ['对话', '台词', '说话', '语气', '对白', '潜台词'] },
    { dimension: 'rhythm', keywords: ['节奏', '拖沓', '仓促', '信息密度', '爽点', '铺垫', '段落长度'] },
    { dimension: 'description', keywords: ['描写', '感官', '环境', '细节', '具体', '形容词', '比喻'] },
    { dimension: 'hook', keywords: ['钩子', '结尾', '悬念', '开篇', '吸引力', '追读'] },
    { dimension: 'continuity', keywords: ['连贯', '矛盾', '设定', 'OOC', '伏笔', '时间线', '逻辑', '前后'] },
    { dimension: 'style', keywords: ['AI', '文风', '用词', '句式', '模板', '重复', '套话', '书面'] },
];

function detectDimension(line: string): RevisionDimension {
    for (const rule of DIMENSION_KEYWORDS) {
        if (rule.keywords.some(k => line.includes(k))) return rule.dimension;
    }
    return 'style';
}

function detectLocation(line: string): string | undefined {
    const scene = line.match(/(?:场景|Scene)\s*(\d+)/i);
    if (scene) return `场景${scene[1]}`;
    const para = line.match(/第\s*(\d+)\s*段/);
    if (para) return `第${para[1]}段`;
    const lineNo = line.match(/\bL(\d+)\b/i);
    if (lineNo) return `L${lineNo[1]}`;
    return undefined;
}

function stripMarkers(line: string): string {
    return line
        .replace(/^[\s>*\-]+/, '')
        .replace(/^[❌⚠️✅]+\s*/, '')
        .replace(/^\[[^\]]+\]\s*/, '')
        .trim();
}

/**
 * 解析 qualityControl 的自由 Markdown 报告。
 * 只收 ❌/⚠️ 行；✅ 与普通说明不进入修订计划。
 * @param report - 报告
 * @returns 结果数组
 */
export function parseQualityControlReport(report: string): RevisionIssue[] {
    if (!report || !report.trim()) return [];
    const issues: RevisionIssue[] = [];
    const seen = new Set<string>();

    for (const raw of report.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || (!line.includes('❌') && !line.includes('⚠️'))) continue;
        // 排除“无问题/全部通过”这类结论行
        if (/无问题|未发现|全部通过|无需修改/.test(line)) continue;

        const evidence = stripMarkers(line);
        if (!evidence || evidence.length < 4) continue;
        const key = `${evidence}|${line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const suggestionMatch = evidence.match(/建议[：:]\s*(.+)$/);
        issues.push({
            dimension: detectDimension(line),
            severity: line.includes('❌') ? 'high' : 'medium',
            evidence: evidence.slice(0, 300),
            suggestion: suggestionMatch?.[1]?.slice(0, 200),
            location: detectLocation(line),
            source: 'quality-report',
        });
    }
    return issues;
}

/**
 * 合并来自 QSE/WQE 的结构化 issues（它们通常带 dimension/severity/location）。
 *
 * @returns 结果数组
 */
export function mergeQualityIssues(
    ...groups: Array<Array<{
        dimension?: string;
        severity?: string;
        evidence?: string;
        description?: string;
        suggestion?: string;
        location?: string;
    }> | undefined>
): RevisionIssue[] {
    const result: RevisionIssue[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        for (const item of group || []) {
            const evidence = (item.evidence || item.description || '').trim();
            if (!evidence) continue;
            const dimension = (item.dimension && (item.dimension as RevisionDimension)) || detectDimension(evidence);
            const severity: RevisionSeverity = item.severity === 'high' || item.severity === 'critical'
                ? 'high'
                : item.severity === 'low' ? 'low' : 'medium';
            const key = `${dimension}|${evidence}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({
                dimension,
                severity,
                evidence: evidence.slice(0, 300),
                suggestion: item.suggestion,
                location: item.location,
                source: 'quality-score',
            });
        }
    }
    return result;
}

/**
 * 把问题合并为分轮修订计划。
 *
 * @param issues - 问题列表
 * @param maxPasses = 3 - 参数
 * @returns 修订计划
 */
export function buildRevisionPlan(issues: RevisionIssue[], maxPasses = 3): RevisionPlan {
    if (issues.length === 0) {
        return { passes: [], reason: '没有可执行的结构化问题' };
    }
    const rank: Record<RevisionSeverity, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
    const passes: RevisionDimension[] = [];
    for (const issue of sorted) {
        if (!passes.includes(issue.dimension)) passes.push(issue.dimension);
        if (passes.length >= maxPasses) break;
    }
    return {
        passes,
        reason: `${issues.length} 条问题，按严重度选择 ${passes.length} 个修订维度`,
    };
}

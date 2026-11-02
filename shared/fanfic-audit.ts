/**
 * fanfic-audit.ts — 同人设定规则审核、来源审计与补全提示词（纯函数）
 *
 * 不发起 AI 调用，不写文件。UI 只负责展示 issues / 触发补全。
 * 硬规则：没有官方来源依据时，只能标记“待核实”，不能让模型凭记忆补。
 */
import {
    CanonSource,
    citationCoverage,
    computeCanonSourceHash,
    formatCanonSourcesForPrompt,
    isAuthoritativeSource,
    selectAuthoritativeSources,
    validateCanonSources,
} from './canon-source';
import {
    parseFanficReviewStatus,
    parseFanficReviewMeta,
    parseFanficTimeline,
} from './fanfic-rules';
import { validateFanficSettings } from './template-validator';

export type FanficAuditSeverity = 'error' | 'warning' | 'info';

export interface FanficAuditIssue {
    severity: FanficAuditSeverity;
    code: string;
    field?: string;
    line?: number;
    message: string;
    suggestion?: string;
}

export interface FanficAuditStats {
    missingFields: number;
    placeholderCount: number;
    unresolvedCount: number;
    timelineRows: number;
    sourceCount: number;
    authoritativeSourceCount: number;
    derivativeSourceCount: number;
    citationCoveragePct: number;
    reviewStatus: string;
}

export interface FanficAuditResult {
    overall: 'pass' | 'warn' | 'fail';
    issues: FanficAuditIssue[];
    stats: FanficAuditStats;
}

export interface FanficAuditOptions {
    /** 审核通过时记录在 frontmatter 的来源哈希；用于检测审核后修改 */
    expectedSourceHash?: string;
    requireApproved?: boolean;
}

const PLACEHOLDER_RE = /（待补充）|\(待补充\)|（待核实[^）]*）|\(待核实[^)]*\)/g;
const DERIVATIVE_SOURCE_RE = /(同人|fanfic|fanfiction|衍生|改编|动画|电视剧|影视|电影|游戏|漫画|续写|外传|二次创作|fandom|lofter|ao3)/i;

/**
 * 规则审核：0 次 AI，覆盖字段、占位、时间线、来源、引用、审核状态。
 *
 * @param content - 内容
 * @param sources - 来源列表
 * @param options - 配置项
  * @returns FanficAuditResult 实例
 */
export function auditFanficSettings(
    content: string,
    sources: CanonSource[] = [],
    options: FanficAuditOptions = {},
): FanficAuditResult {
    const issues: FanficAuditIssue[] = [];
    const validation = validateFanficSettings(content);
    for (const field of validation.missingFields) {
        issues.push({
            severity: 'error',
            code: 'missing-field',
            field,
            line: findFieldLine(content, field),
            message: `缺少或未填写：${field}`,
            suggestion: '按官方来源补全；找不到来源时写“待核实（未找到可靠原作来源）”并保留审核标记。',
        });
    }

    const placeholderCount = (content.match(PLACEHOLDER_RE) || []).length;
    const unresolvedCount = (content.match(/待核实/g) || []).length;
    if (placeholderCount > 0) {
        issues.push({
            severity: 'warning',
            code: 'placeholder',
            message: `仍有 ${placeholderCount} 处占位内容（待补充/待核实）`,
            suggestion: '人工审核确认这些字段是否必须保留；能由官方来源确认的请补全。',
        });
    }

    const canonTimeline = parseFanficTimeline(content, '原作剧情时间线');
    if (canonTimeline.length === 0) {
        issues.push({
            severity: 'error',
            code: 'timeline-empty',
            field: '原作剧情时间线',
            message: '原作剧情时间线没有真实数据行',
            suggestion: '至少从官方来源整理 2 条事件；找不到来源时保留待核实，不要编造。',
        });
    }

    const reviewStatus = parseFanficReviewStatus(content);
    const reviewMeta = parseFanficReviewMeta(content);
    if (options.requireApproved && reviewStatus !== 'approved' && reviewStatus !== 'legacy') {
        issues.push({
            severity: 'error',
            code: 'unreviewed',
            message: '同人设定尚未通过人工审核',
            suggestion: '完成人工审核并在审核页勾选全部检查项后再绑定项目。',
        });
    }

    const derivativeSources = sources.filter(source => source.tier === 'derivative');
    if (derivativeSources.length > 0) {
        issues.push({
            severity: 'error',
            code: 'derivative-source',
            message: `引用了 ${derivativeSources.length} 条衍生作品来源`,
            suggestion: `移除以下来源后重新审核：${derivativeSources.map(s => s.title || s.url).join('、')}`,
        });
    }

    const unknownSources = sources.filter(source => source.tier === 'unknown' || source.tier === 'reference');
    if (unknownSources.length > 0) {
        issues.push({
            severity: 'warning',
            code: 'non-authoritative-source',
            message: `${unknownSources.length} 条来源不是官方/官方 Wiki，只能作为参考资料`,
            suggestion: '关键事实必须由官方来源确认；参考资料不能单独支撑设定。',
        });
    }

    const sourceValidation = validateCanonSources(sources);
    if (sources.length === 0) {
        issues.push({
            severity: 'error',
            code: 'no-source',
            message: '没有任何原作来源记录',
            suggestion: '先检索或手动导入官方来源；没有来源时只能生成骨架，不能生成事实内容。',
        });
    } else if (!sourceValidation.valid) {
        for (const error of sourceValidation.errors) {
            issues.push({ severity: 'error', code: 'source-invalid', message: error });
        }
    }

    const unknownCitationIds = findUnknownCitations(content, sources);
    if (unknownCitationIds.length > 0) {
        issues.push({
            severity: 'warning',
            code: 'unknown-citation',
            message: `正文引用了不存在的来源编号：${unknownCitationIds.join('、')}`,
            suggestion: '删除无效引用，或把对应来源加入资料库。',
        });
    }

    if (reviewStatus === 'approved' && options.expectedSourceHash) {
        const actualHash = computeCanonSourceHash(sources);
        if (options.expectedSourceHash !== actualHash) {
            issues.push({
                severity: 'error',
                code: 'source-hash-stale',
                message: '审核通过后来源资料发生变化，审核结论已失效',
                suggestion: '重新核对来源并再次人工审核。',
            });
        }
    }
    if (reviewStatus === 'approved' && reviewMeta.sourceHash) {
        const actualHash = computeCanonSourceHash(sources);
        if (reviewMeta.sourceHash !== actualHash) {
            issues.push({
                severity: 'error',
                code: 'source-hash-mismatch',
                message: '文件记录来源哈希与当前来源不一致',
                suggestion: '重新审核后再继续使用。',
            });
        }
    }

    const duplicates = findDuplicateEntries(content);
    for (const name of duplicates) {
        issues.push({
            severity: 'warning',
            code: 'duplicate-entry',
            message: `人物/势力条目重复：${name}`,
            suggestion: '合并重复条目，避免后续关系与状态解析错乱。',
        });
    }

    const authoritativeCount = sources.filter(source => isAuthoritativeSource(source.tier)).length;
    const stats: FanficAuditStats = {
        missingFields: validation.missingFields.length,
        placeholderCount,
        unresolvedCount,
        timelineRows: canonTimeline.length,
        sourceCount: sources.length,
        authoritativeSourceCount: authoritativeCount,
        derivativeSourceCount: derivativeSources.length,
        citationCoveragePct: sources.length > 0 ? citationCoverage(content, sources) : 0,
        reviewStatus,
    };
    const hasError = issues.some(issue => issue.severity === 'error');
    const hasWarning = issues.some(issue => issue.severity === 'warning');
    return {
        overall: hasError ? 'fail' : hasWarning ? 'warn' : 'pass',
        issues,
        stats,
    };
}

export function buildFanficCompletionPrompt(
    content: string,
    missingFields: string[],
    sources: CanonSource[],
): { system: string; user: string } {
    const authoritative = selectAuthoritativeSources(sources);
    return {
        system: `你是同人设定补全助手。你只能使用下面提供的官方原著资料，不能使用模型记忆，不能引用同人/改编/外传等衍生作品。

【硬性规则】
1. 只补全缺失字段：${missingFields.join('、') || '（未指定，按缺失字段处理）'}
2. 每个补全内容后必须标注来源编号，例如 [S1]。
3. 资料中没有的内容写“待核实（未找到可靠原作来源）”，禁止猜测或编造。
4. 保留原有 Markdown 结构、YAML frontmatter、表格列名；不要改写已填写内容。
5. 只输出完整文件内容，不要解释。

【官方来源】
${formatCanonSourcesForPrompt(authoritative)}`,
        user: `请补全以下同人设定。未指定字段时，只处理明显的缺失/待核实项。\n\n${content}`,
    };
}

export function buildFanficAuditPrompt(
    content: string,
    sources: CanonSource[],
): { system: string; user: string } {
    const authoritative = selectAuthoritativeSources(sources);
    return {
        system: `你是同人设定审核员。你只能依据下面提供的官方原著资料判断，不能使用模型记忆，不能参考同人/改编/外传等衍生作品。

【任务】
找出设定与官方资料不一致、无来源支撑、或引用了衍生作品的地方。只报告，不要改写文件。

【输出 JSON】
{
  "overall": "pass|warn|fail",
  "issues": [
    {
      "severity": "error|warning|info",
      "field": "字段名",
      "line": 1,
      "problem": "问题描述",
      "suggestion": "修改建议",
      "sourceId": "S1"
    }
  ]
}

【判定规则】
- 资料中没有依据的内容 → severity=warning, problem 写“资料未覆盖，无法确认”
- 与资料冲突 → severity=error
- 引用衍生作品 → severity=error
- 不要因为“你觉得不像原作”就报错，必须有来源依据。

【官方来源】
${formatCanonSourcesForPrompt(authoritative)}`,
        user: `请审核以下同人设定：\n\n${content}`,
    };
}

function findFieldLine(content: string, field: string): number | undefined {
    const needle = field.replace(/^frontmatter\./, '');
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex(line => line.includes(needle));
    return index >= 0 ? index + 1 : undefined;
}

function findUnknownCitations(content: string, sources: CanonSource[]): string[] {
    const valid = new Set(sources.map(source => source.id));
    const unknown = new Set<string>();
    for (const match of content.matchAll(/\[(S\d+)\]/g)) {
        if (!valid.has(match[1])) unknown.add(match[1]);
    }
    return [...unknown];
}

function findDuplicateEntries(content: string): string[] {
    const names = new Map<string, number>();
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^-\s+\*\*(.+?)\*\*[：:]/);
        if (!match) continue;
        const name = match[1].trim();
        if (name.length < 2 || /待补充|待核实|人物名|势力名/.test(name)) continue;
        names.set(name, (names.get(name) || 0) + 1);
    }
    return [...names.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

/**
 * 人工审核通过时建议写入 frontmatter 的字段（供 UI 拼装）。
 *
 * @param input - 输入
 * @returns 映射结果
 */
export function buildFanficApprovalMeta(input: {
    reviewer: string;
    sources: CanonSource[];
    reviewedAt?: number;
}): Record<string, string> {
    const time = new Date(input.reviewedAt ?? Date.now()).toISOString();
    return {
        '审核状态': 'approved',
        '审核人': input.reviewer.trim() || '未署名',
        '审核时间': time,
        '来源数量': String(input.sources.length),
        '来源哈希': computeCanonSourceHash(input.sources),
    };
}

/**
 * 写入/替换审核元数据；保留正文其余内容。
 *
 * @param content - 内容
 * @param meta - 元数据
 * @returns 文本结果
 */
export function applyFanficReviewMeta(content: string, meta: Record<string, string>): string {
    const lines = Object.entries(meta).map(([key, value]) => `${key}: ${value}`);
    const keys = new Set(Object.keys(meta));
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!fmMatch) {
        return `---\n${lines.join('\n')}\n---\n\n${stripReviewKeys(content, keys)}`;
    }
    const existing = fmMatch[1]
        .split(/\r?\n/)
        .filter(line => {
            const match = line.match(/^([^:]+):/);
            return !match || !keys.has(match[1].trim());
        })
        .filter(line => line.trim().length > 0);
    const merged = [...existing, ...lines].join('\n');
    return `---\n${merged}\n---\n\n${stripReviewKeys(content.slice(fmMatch[0].length), keys)}`;
}

function stripReviewKeys(content: string, keys: Set<string>): string {
    return content
        .split(/\r?\n/)
        .filter(line => {
            const match = line.match(/^([^:]+):/);
            return !match || !keys.has(match[1].trim());
        })
        .join('\n')
        .trim();
}

export function isDerivativeSource(source: CanonSource): boolean {
    return source.tier === 'derivative' || DERIVATIVE_SOURCE_RE.test(`${source.title}\n${source.url}`);
}
/**
 * audit-pipeline.ts — 一致性审核的纯函数编排（S2 收口）
 *
 * 把「规则层 → LLM 复核 → 证据定位 → 汇总」串成一次调用，
 * 但**不碰 IO**：章节正文、断言、废弃伏笔都由调用方传入。
 * 这样整条链路可以在单测里跑完，UI/命令层只负责取数据与展示。
 */

import type {
    AssertionKind,
    ConsistencyContradiction,
} from './assertion-model';
import { ASSERTION_KIND_META } from './assertion-model';
import { locateQuote } from './evidence-locate';
import { judgeSuspectedPairs, type LlmCaller } from './pairing-llm';
import { pairContradictions, type SuspectedPair } from './pairing-rules';
import { summarizeConsistencyMetrics, formatMetricsLine, type ConsistencyMetrics } from './consistency-metrics';
import { selectRiskSegments, type RiskSegment } from './risk-targeting';
import type { FactAssertion } from './assertion-model';

/** 章节正文（用于把引文定位回字符偏移） */
export interface ChapterBody {
    chapterKey: string;
    body: string;
}

/** 审核输入 */
export interface AuditInput {
    /** 跨章累积的断言 */
    assertions: readonly FactAssertion[];
    /** 原始事实文本（扩展规则用：违规句可能不成断言） */
    factTexts?: ReadonlyArray<{ chapterKey: string; chapterNum: number | null; text: string; quote: string }>;
    /** 章节正文（可缺；缺了只是没有 offset，不影响产出） */
    chapters?: readonly ChapterBody[];
    /** 已废弃伏笔 */
    abandonedPlots?: ReadonlyArray<{ name: string; quote: string; chapterKey: string }>;
    /** 可选的 LLM 复核器；不传则只跑规则层（零 token） */
    llm?: {
        caller: LlmCaller;
        maxPairs?: number;
        minConfidence?: number;
    };
}

/** 按类型统计 */
export interface KindStat {
    kind: AssertionKind;
    label: string;
    count: number;
}

/** 审核报告 */
export interface AuditReport {
    /** 全部矛盾（按严重度/章节排序后） */
    contradictions: ConsistencyContradiction[];
    /** 按类型统计 */
    byKind: KindStat[];
    /** 未解决的疑似配对数量（规则层判不了、未送 LLM 或 LLM 未确认） */
    suspectedCount: number;
    /** 实际 LLM 调用次数 */
    llmCalls: number;
    /** 是否只跑了规则层 */
    ruleOnly: boolean;
    /** 一致性指标（CED 每万字符错误数，S5） */
    metrics: ConsistencyMetrics;
    /** 高风险段落（S3：优先复核/呈现） */
    riskSegments: RiskSegment[];
    /** 生成时间（ISO） */
    generatedAt: string;
}

/**
 * 执行审核（纯函数，无 IO）。
 *
 * @param input - 审核输入
 * @param now - 时间戳（测试可注入）
 * @returns 审核报告
 */
export async function runAudit(
    input: AuditInput,
    now: () => Date = () => new Date(),
): Promise<AuditReport> {
    const paired = pairContradictions({
        assertions: input.assertions,
        abandonedPlots: input.abandonedPlots,
        chapters: input.chapters,
        factTexts: input.factTexts,
    });

    let llmContradictions: ConsistencyContradiction[] = [];
    let llmCalls = 0;
    let suspectedCount = paired.suspected.length;

    if (input.llm && paired.suspected.length > 0) {
        const judged = await judgeSuspectedPairs(paired.suspected, {
            caller: input.llm.caller,
            maxPairs: input.llm.maxPairs,
            minConfidence: input.llm.minConfidence,
        });
        llmContradictions = judged.contradictions;
        llmCalls = judged.calls;
        suspectedCount = judged.dropped;
    }

    const merged = dedupe([...paired.contradictions, ...llmContradictions]);
    const located = locateAll(merged, input.chapters ?? []);
    const sorted = sortContradictions(located);

    const charCount = (input.chapters ?? []).reduce((acc, c) => acc + (c.body?.length ?? 0), 0);
    return {
        contradictions: sorted,
        byKind: summarizeByKind(sorted),
        metrics: summarizeConsistencyMetrics(sorted, charCount),
        riskSegments: selectRiskSegments({ chapters: input.chapters ?? [], limit: 20 }),
        suspectedCount,
        llmCalls,
        ruleOnly: !input.llm,
        generatedAt: now().toISOString(),
    };
}

/**
 * 用章节正文给矛盾补字符偏移（找不到就留 undefined，UI 降级展示）。
 *
 * @param contradictions - 矛盾列表
 * @param chapters - 章节正文
 * @returns 补过偏移的矛盾列表
 */
export function locateAll(
    contradictions: readonly ConsistencyContradiction[],
    chapters: readonly ChapterBody[],
): ConsistencyContradiction[] {
    const byKey = new Map<string, string>();
    for (const chapter of chapters) byKey.set(chapter.chapterKey, chapter.body);

    return contradictions.map((c) => {
        const bodyA = byKey.get(c.evidenceA.chapterKey);
        const bodyB = byKey.get(c.evidenceB.chapterKey);
        const hitA = bodyA ? locateQuote(bodyA, c.evidenceA.quote) : null;
        const hitB = bodyB ? locateQuote(bodyB, c.evidenceB.quote) : null;
        return {
            ...c,
            evidenceA: { ...c.evidenceA, offset: c.evidenceA.offset ?? hitA?.offset },
            evidenceB: { ...c.evidenceB, offset: c.evidenceB.offset ?? hitB?.offset },
        };
    });
}

/**
 * 去重（同 id 保留置信度更高的一条）。
 *
 * @param contradictions - 矛盾列表
 * @returns 去重结果
 */
export function dedupe(contradictions: readonly ConsistencyContradiction[]): ConsistencyContradiction[] {
    const byId = new Map<string, ConsistencyContradiction>();
    for (const c of contradictions) {
        const existing = byId.get(c.id);
        if (!existing || c.confidence > existing.confidence) byId.set(c.id, c);
    }
    return [...byId.values()];
}

/**
 * 排序：严重度高的在前，其次按置信度降序，最后按类型稳定排序。
 *
 * @param contradictions - 矛盾列表
 * @returns 排序结果
 */
export function sortContradictions(
    contradictions: readonly ConsistencyContradiction[],
): ConsistencyContradiction[] {
    const severityRank: Record<string, number> = { high: 0, medium: 1 };
    return contradictions.slice().sort((a, b) => {
        const sa = severityRank[ASSERTION_KIND_META[a.kind].severity] ?? 2;
        const sb = severityRank[ASSERTION_KIND_META[b.kind].severity] ?? 2;
        if (sa !== sb) return sa - sb;
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.evidenceA.chapterKey.localeCompare(b.evidenceB.chapterKey);
    });
}

/**
 * 按类型统计（只列出有命中的类型，保持稳定顺序）。
 *
 * @param contradictions - 矛盾列表
 * @returns 统计
 */
export function summarizeByKind(
    contradictions: readonly ConsistencyContradiction[],
): KindStat[] {
    const counts = new Map<AssertionKind, number>();
    for (const c of contradictions) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    return [...counts.entries()]
        .map(([kind, count]) => ({ kind, label: ASSERTION_KIND_META[kind].label, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * 供 UI 展示：把报告压成人类可读的几行摘要。
 *
 * @param report - 审核报告
 * @returns 摘要行
 */
export function formatReportSummary(report: AuditReport): string[] {
    const lines: string[] = [];
    if (report.contradictions.length === 0) {
        lines.push('未发现跨章一致性矛盾。');
    } else {
        lines.push(`共发现 ${report.contradictions.length} 处跨章一致性矛盾：`);
        for (const stat of report.byKind) {
            lines.push(`· ${stat.label}：${stat.count} 处`);
        }
    }
    lines.push(formatMetricsLine(report.metrics));
    if (report.riskSegments.length > 0) {
        lines.push(`已定位 ${report.riskSegments.length} 个高风险段（中段/高熵优先复核）`);
    }
    if (report.ruleOnly) {
        lines.push('（仅规则层检测，未启用模型复核）');
    } else {
        lines.push(`模型复核 ${report.llmCalls} 次，未确认 ${report.suspectedCount} 处疑似。`);
    }
    return lines;
}

export type { SuspectedPair };
